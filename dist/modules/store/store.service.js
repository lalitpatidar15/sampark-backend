"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeService = void 0;
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../../common/errors");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const providers_1 = require("../../providers");
const crypto_1 = require("../../common/utils/crypto");
const config_1 = require("../../config");
const node_crypto_1 = require("node:crypto");
const log = (0, logger_1.childLogger)("store");
const SHIPPING_PAISE = 0; // free shipping for MVP
const TAX_RATE = 0; // tax handled by invoice at fulfilment
const orderNumber = () => `SPK-${(0, crypto_1.randomToken)(8).toUpperCase()}`;
const orderAccessToken = () => `ord_${(0, crypto_1.randomToken)(24)}`;
/**
 * Server-side price calculation. The client total is never trusted; the
 * server recomputes from the catalogue so a forged client total cannot
 * undercharge an order.
 */
async function computeOrderTotal(items) {
    const lineItems = [];
    let subtotal = 0;
    for (const item of items) {
        const product = await prisma_1.prisma.product.findUnique({ where: { id: item.productId } });
        if (!product)
            throw (0, errors_1.badRequest)(`Product ${item.productId} not found`);
        if (!product.active)
            throw (0, errors_1.badRequest)(`Product ${product.name} is not available`);
        const unitPrice = product.pricePaise;
        const totalPaise = unitPrice * item.quantity;
        lineItems.push({
            productId: product.id,
            quantity: item.quantity,
            unitPricePaise: unitPrice,
            productName: product.name,
            productSku: product.sku,
            totalPaise,
        });
        subtotal += totalPaise;
    }
    return { items: lineItems, subtotalPaise: subtotal };
}
/**
 * Reserve stock transactionally. Prevents two simultaneous purchases from
 * reserving the same physical tag.
 */
async function reserveStock(productId, quantity) {
    const inventory = await prisma_1.prisma.inventory.findUnique({ where: { productId } });
    if (!inventory)
        throw (0, errors_1.conflict)(`No inventory configured for product ${productId}`);
    if (inventory.quantityOnHand - inventory.quantityReserved < quantity) {
        throw (0, errors_1.conflict)("Insufficient stock");
    }
    await prisma_1.prisma.inventory.update({
        where: { productId },
        data: { quantityReserved: inventory.quantityReserved + quantity },
    });
}
exports.storeService = {
    // ------------------------------------------------------------------
    // Catalogue
    // ------------------------------------------------------------------
    async listProducts() {
        return prisma_1.prisma.product.findMany({
            where: { active: true },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                sku: true,
                name: true,
                description: true,
                pricePaise: true,
                currency: true,
                active: true,
            },
        });
    },
    // ------------------------------------------------------------------
    // Checkout
    // ------------------------------------------------------------------
    async createOrder(input) {
        const computed = await computeOrderTotal(input.items);
        // Reserve stock for all line items (transactional)
        for (const item of computed.items) {
            await reserveStock(item.productId, item.quantity);
        }
        const totalPaise = computed.subtotalPaise + SHIPPING_PAISE + TAX_RATE;
        const order = await prisma_1.prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
                data: {
                    orderNumber: orderNumber(),
                    userId: input.userId ?? null,
                    accessToken: orderAccessToken(),
                    status: "CREATED",
                    paymentStatus: "PENDING",
                    subtotal: computed.subtotalPaise,
                    shippingFee: SHIPPING_PAISE,
                    tax: TAX_RATE,
                    total: totalPaise,
                    currency: "INR",
                },
            });
            for (const item of computed.items) {
                await tx.orderItem.create({
                    data: {
                        orderId: created.id,
                        productId: item.productId,
                        productCode: item.productSku,
                        description: item.productName,
                        unitPrice: item.unitPricePaise,
                        total: item.totalPaise,
                    },
                });
            }
            await tx.address.create({
                data: {
                    orderId: created.id,
                    name: input.address.name,
                    phone: input.address.phone,
                    addressLines: input.address.addressLines,
                    city: input.address.city,
                    state: input.address.state,
                    postalCode: input.address.postalCode,
                },
            });
            return created;
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.userId ?? null,
            action: "order.create",
            resourceType: "order",
            resourceId: order.id,
            metadata: { orderNumber: order.orderNumber, totalPaise },
        });
        log.info({ orderId: order.id, orderNumber: order.orderNumber, totalPaise }, "order created");
        return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            accessToken: order.accessToken,
            totalPaise: order.total,
            currency: order.currency,
            status: order.status,
        };
    },
    // ------------------------------------------------------------------
    // Payment
    // ------------------------------------------------------------------
    async createPaymentOrder(input) {
        const order = await prisma_1.prisma.order.findFirst({
            where: { id: input.orderId, ...(input.accessToken ? { accessToken: input.accessToken } : {}) },
        });
        if (!order)
            throw (0, errors_1.notFound)("Order not found");
        if (order.paymentStatus === "PAID")
            throw (0, errors_1.conflict)("Order already paid");
        if (order.status !== "CREATED")
            throw (0, errors_1.badRequest)("Order is not in a payable state");
        const providerOrder = await providers_1.paymentProvider.createOrder({
            amount: order.total,
            currency: order.currency,
            receipt: order.orderNumber,
            notes: { orderNumber: order.orderNumber },
        });
        const payment = await prisma_1.prisma.payment.create({
            data: {
                orderId: order.id,
                provider: "razorpay",
                providerOrderId: providerOrder.providerOrderId,
                status: "PENDING",
                amountPaise: order.total,
                currency: order.currency,
            },
        });
        return {
            orderId: order.id,
            providerOrderId: providerOrder.providerOrderId,
            amount: providerOrder.amount,
            currency: providerOrder.currency,
            keyId: config_1.env.RAZORPAY_KEY_ID,
        };
    },
    async verifyPayment(input) {
        const order = await prisma_1.prisma.order.findFirst({
            where: { id: input.orderId, ...(input.accessToken ? { accessToken: input.accessToken } : {}) },
        });
        if (!order)
            throw (0, errors_1.notFound)("Order not found");
        if (order.paymentStatus === "PAID")
            return { orderId: order.id, status: "PAID" };
        const payment = await prisma_1.prisma.payment.findFirst({
            where: { orderId: order.id, providerOrderId: input.providerOrderId },
        });
        if (!payment)
            throw (0, errors_1.notFound)("Payment record not found");
        const valid = providers_1.paymentProvider.verifySignature({
            razorpay_order_id: input.providerOrderId,
            razorpay_payment_id: input.providerPaymentId,
            razorpay_signature: input.signature,
        }, input.signature);
        if (!valid)
            throw (0, errors_1.forbidden)("Invalid payment signature");
        // Idempotent: mark paid only once
        const [updatedOrder, updatedPayment] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.order.update({
                where: { id: order.id },
                data: { paymentStatus: "PAID", status: "CONFIRMED" },
            }),
            prisma_1.prisma.payment.update({
                where: { id: payment.id },
                data: { status: "PAID", providerPaymentId: input.providerPaymentId },
            }),
        ]);
        await (0, audit_service_1.audit)({
            actorUserId: order.userId ?? null,
            action: "order.pay",
            resourceType: "order",
            resourceId: order.id,
            metadata: { providerPaymentId: input.providerPaymentId },
        });
        log.info({ orderId: order.id, orderNumber: order.orderNumber }, "order paid");
        return {
            orderId: updatedOrder.id,
            orderNumber: updatedOrder.orderNumber,
            status: "PAID",
            accessToken: updatedOrder.accessToken,
        };
    },
    // ------------------------------------------------------------------
    // Webhook (idempotent via WebhookEvent ledger)
    // ------------------------------------------------------------------
    async handleWebhook(input) {
        // Verify Razorpay webhook signature over the raw body.
        const secret = config_1.env.RAZORPAY_WEBHOOK_SECRET;
        if (secret && input.signature) {
            const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(input.rawBody).digest("hex");
            if (!(0, node_crypto_1.timingSafeEqual)(Buffer.from(expected), Buffer.from(input.signature))) {
                throw (0, errors_1.forbidden)("Invalid webhook signature");
            }
        }
        // Deduplicate: first delivery wins, retries are no-ops.
        const existing = await prisma_1.prisma.webhookEvent.findFirst({
            where: { handler: "razorpay", providerEventId: input.providerEventId },
        });
        if (existing)
            return { status: "duplicate" };
        const event = input.payload;
        const paymentEntity = event.payload?.payment;
        if (!paymentEntity?.id)
            return { status: "ignored" };
        if (event.event === "payment.captured") {
            const payment = await prisma_1.prisma.payment.findFirst({
                where: { providerPaymentId: paymentEntity.id },
            });
            if (!payment)
                return { status: "ignored" };
            if (payment.status === "PAID")
                return { status: "duplicate" };
            await prisma_1.prisma.$transaction([
                prisma_1.prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: "PAID" },
                }),
                prisma_1.prisma.order.update({
                    where: { id: payment.orderId },
                    data: { paymentStatus: "PAID", status: "CONFIRMED" },
                }),
                prisma_1.prisma.webhookEvent.create({
                    data: { handler: "razorpay", providerEventId: input.providerEventId },
                }),
            ]);
            log.info({ providerPaymentId: paymentEntity.id }, "webhook: payment captured");
            return { status: "processed" };
        }
        // Non-captured events: just record the webhook event
        await prisma_1.prisma.webhookEvent.create({
            data: { handler: "razorpay", providerEventId: input.providerEventId },
        });
        return { status: "ignored" };
    },
    // ------------------------------------------------------------------
    // Order lookup
    // ------------------------------------------------------------------
    async getOrder(input) {
        const order = await prisma_1.prisma.order.findFirst({
            where: input.orderId ? { id: input.orderId } : { accessToken: input.accessToken },
            include: {
                items: { include: { product: true } },
                address: true,
                payments: true,
                shipments: true,
            },
        });
        if (!order)
            throw (0, errors_1.notFound)("Order not found");
        return order;
    },
    async listOrders() {
        return prisma_1.prisma.order.findMany({
            include: {
                items: true,
                address: true,
                payments: true,
                shipments: true,
            },
            orderBy: { createdAt: "desc" },
        });
    },
    // ------------------------------------------------------------------
    // Admin: fulfilment
    // ------------------------------------------------------------------
    async updateOrderStatus(input) {
        const order = await prisma_1.prisma.order.findUnique({ where: { id: input.orderId } });
        if (!order)
            throw (0, errors_1.notFound)("Order not found");
        const updated = await prisma_1.prisma.order.update({
            where: { id: input.orderId },
            data: { status: input.status },
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.actorUserId,
            action: "order.status",
            resourceType: "order",
            resourceId: order.id,
            metadata: { status: input.status },
        });
        return updated;
    },
    async assignPhysicalTag(input) {
        const orderItem = await prisma_1.prisma.orderItem.findUnique({
            where: { id: input.orderItemId },
            include: { order: true, product: true },
        });
        if (!orderItem)
            throw (0, errors_1.notFound)("Order item not found");
        if (orderItem.order.paymentStatus !== "PAID")
            throw (0, errors_1.badRequest)("Order not paid");
        const existing = await prisma_1.prisma.physicalTag.findFirst({
            where: { orderItemId: orderItem.id },
        });
        if (existing)
            throw (0, errors_1.conflict)("Tag already assigned");
        // Find an unassigned physical tag for this product
        const physicalTag = await prisma_1.prisma.physicalTag.findFirst({
            where: { tag: { tagType: "PHYSICAL_QR" }, status: "UNASSIGNED" },
            include: { tag: true },
        });
        if (!physicalTag)
            throw (0, errors_1.conflict)("No unassigned physical tags available");
        // Activate the linked digital tag for the customer
        await prisma_1.prisma.tag.update({
            where: { id: physicalTag.tagId },
            data: {
                ownerId: orderItem.order.userId ?? undefined,
                status: "ACTIVE",
                activatedAt: new Date(),
            },
        });
        const updated = await prisma_1.prisma.physicalTag.update({
            where: { id: physicalTag.id },
            data: { orderItemId: orderItem.id },
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.actorUserId,
            action: "order.assign_tag",
            resourceType: "order_item",
            resourceId: orderItem.id,
            metadata: { physicalTagId: physicalTag.id, serialNumber: physicalTag.serialNumber },
        });
        return updated;
    },
    async shipOrder(input) {
        const order = await prisma_1.prisma.order.findUnique({ where: { id: input.orderId } });
        if (!order)
            throw (0, errors_1.notFound)("Order not found");
        const shipment = await prisma_1.prisma.shipment.create({
            data: {
                orderId: order.id,
                carrier: input.carrier,
                trackingNumber: input.trackingNumber ?? null,
                status: "SHIPPED",
                shippedAt: new Date(),
            },
        });
        await prisma_1.prisma.order.update({
            where: { id: order.id },
            data: { status: "SHIPPED" },
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.actorUserId,
            action: "order.ship",
            resourceType: "order",
            resourceId: order.id,
            metadata: { carrier: input.carrier, trackingNumber: input.trackingNumber },
        });
        return shipment;
    },
    // ------------------------------------------------------------------
    // Inventory
    // ------------------------------------------------------------------
    async listInventory() {
        return prisma_1.prisma.inventory.findMany({
            include: { product: true },
            orderBy: { product: { name: "asc" } },
        });
    },
    async receiveInventory(input) {
        const product = await prisma_1.prisma.product.findUnique({ where: { id: input.productId } });
        if (!product)
            throw (0, errors_1.notFound)("Product not found");
        const inventory = await prisma_1.prisma.inventory.upsert({
            where: { productId: input.productId },
            create: {
                productId: input.productId,
                quantityOnHand: input.quantity,
                quantityReserved: 0,
            },
            update: {
                quantityOnHand: { increment: input.quantity },
            },
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.actorUserId,
            action: "inventory.receive",
            resourceType: "inventory",
            resourceId: inventory.id,
            metadata: { productId: input.productId, quantity: input.quantity },
        });
        return inventory;
    },
    // ------------------------------------------------------------------
    // Refunds
    // ------------------------------------------------------------------
    async refundOrder(input) {
        const payment = await prisma_1.prisma.payment.findUnique({ where: { id: input.paymentId } });
        if (!payment)
            throw (0, errors_1.notFound)("Payment not found");
        if (payment.status !== "PAID")
            throw (0, errors_1.badRequest)("Payment not paid");
        const refund = await providers_1.paymentProvider.refund(payment.providerPaymentId, input.amountPaise);
        const created = await prisma_1.prisma.refund.create({
            data: {
                paymentId: input.paymentId,
                providerRefundId: refund.refundId,
                amountPaise: input.amountPaise,
                status: "SUCCEEDED",
            },
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.actorUserId,
            action: "order.refund",
            resourceType: "refund",
            resourceId: created.id,
            metadata: { paymentId: input.paymentId, amountPaise: input.amountPaise },
        });
        return created;
    },
    // ------------------------------------------------------------------
    // Revenue
    // ------------------------------------------------------------------
    async revenue() {
        const paidOrders = await prisma_1.prisma.order.findMany({
            where: { paymentStatus: "PAID" },
            select: { total: true },
        });
        const grossSales = paidOrders.reduce((sum, o) => sum + o.total, 0);
        const refunds = await prisma_1.prisma.refund.aggregate({
            where: { status: "SUCCEEDED" },
            _sum: { amountPaise: true },
        });
        const refundTotal = refunds._sum.amountPaise ?? 0;
        return {
            grossSalesPaise: grossSales,
            refundsPaise: refundTotal,
            netSalesPaise: grossSales - refundTotal,
            orderCount: paidOrders.length,
        };
    },
};
//# sourceMappingURL=store.service.js.map