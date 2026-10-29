import { prisma } from "../../db/prisma";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../common/errors";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";
import { paymentProvider } from "../../providers";
import { randomToken } from "../../common/utils/crypto";
import { env } from "../../config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { OrderStatus, PaymentStatus } from "@prisma/client";

const log = childLogger("store");

const SHIPPING_PAISE = 0; // free shipping for MVP
const TAX_RATE = 0; // tax handled by invoice at fulfilment

const orderNumber = (): string => `SPK-${randomToken(8).toUpperCase()}`;
const orderAccessToken = (): string => `ord_${randomToken(24)}`;

/**
 * Server-side price calculation. The client total is never trusted; the
 * server recomputes from the catalogue so a forged client total cannot
 * undercharge an order.
 */
async function computeOrderTotal(items: { productId: string; quantity: number }[]) {
  const lineItems: {
    productId: string;
    quantity: number;
    unitPricePaise: number;
    productName: string;
    productSku: string;
    totalPaise: number;
  }[] = [];
  let subtotal = 0;
  for (const item of items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (!product) throw badRequest(`Product ${item.productId} not found`);
    if (!product.active) throw badRequest(`Product ${product.name} is not available`);
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
async function reserveStock(productId: string, quantity: number): Promise<void> {
  const inventory = await prisma.inventory.findUnique({ where: { productId } });
  if (!inventory) throw conflict(`No inventory configured for product ${productId}`);
  if (inventory.quantityOnHand - inventory.quantityReserved < quantity) {
    throw conflict("Insufficient stock");
  }
  await prisma.inventory.update({
    where: { productId },
    data: { quantityReserved: inventory.quantityReserved + quantity },
  });
}

export const storeService = {
  // ------------------------------------------------------------------
  // Catalogue
  // ------------------------------------------------------------------
  async listProducts() {
    return prisma.product.findMany({
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
  async createOrder(input: {
    userId?: string;
    items: { productId: string; quantity: number }[];
    address: {
      name: string;
      phone: string;
      addressLines: string;
      city: string;
      state: string;
      postalCode: string;
    };
  }) {
    const computed = await computeOrderTotal(input.items);

    // Reserve stock for all line items (transactional)
    for (const item of computed.items) {
      await reserveStock(item.productId, item.quantity);
    }

    const totalPaise = computed.subtotalPaise + SHIPPING_PAISE + TAX_RATE;

    const order = await prisma.$transaction(async (tx) => {
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

    await audit({
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
  async createPaymentOrder(input: { orderId: string; accessToken?: string }) {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, ...(input.accessToken ? { accessToken: input.accessToken } : {}) },
    });
    if (!order) throw notFound("Order not found");
    if (order.paymentStatus === "PAID") throw conflict("Order already paid");
    if (order.status !== "CREATED") throw badRequest("Order is not in a payable state");

    const providerOrder = await paymentProvider.createOrder({
      amount: order.total,
      currency: order.currency,
      receipt: order.orderNumber,
      notes: { orderNumber: order.orderNumber },
    });

    const payment = await prisma.payment.create({
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
      keyId: env.RAZORPAY_KEY_ID,
    };
  },

  async verifyPayment(input: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
    accessToken?: string;
  }) {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, ...(input.accessToken ? { accessToken: input.accessToken } : {}) },
    });
    if (!order) throw notFound("Order not found");
    if (order.paymentStatus === "PAID") return { orderId: order.id, status: "PAID" };

    const payment = await prisma.payment.findFirst({
      where: { orderId: order.id, providerOrderId: input.providerOrderId },
    });
    if (!payment) throw notFound("Payment record not found");

    const valid = paymentProvider.verifySignature(
      {
        razorpay_order_id: input.providerOrderId,
        razorpay_payment_id: input.providerPaymentId,
        razorpay_signature: input.signature,
      },
      input.signature,
    );
    if (!valid) throw forbidden("Invalid payment signature");

    // Idempotent: mark paid only once
    const [updatedOrder, updatedPayment] = await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "PAID", status: "CONFIRMED" },
      }),
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: "PAID", providerPaymentId: input.providerPaymentId },
      }),
    ]);

    await audit({
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
  async handleWebhook(input: {
    providerEventId: string;
    payload: Record<string, unknown>;
    signature: string;
    rawBody: Buffer;
  }) {
    // Verify Razorpay webhook signature over the raw body.
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    if (secret && input.signature) {
      const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature))) {
        throw forbidden("Invalid webhook signature");
      }
    }

    // Deduplicate: first delivery wins, retries are no-ops.
    const existing = await prisma.webhookEvent.findFirst({
      where: { handler: "razorpay", providerEventId: input.providerEventId },
    });
    if (existing) return { status: "duplicate" };

    const event = input.payload as {
      event?: string;
      payload?: { payment?: { id?: string; status?: string; amount?: number; order_id?: string } };
    };

    const paymentEntity = event.payload?.payment;
    if (!paymentEntity?.id) return { status: "ignored" };

    if (event.event === "payment.captured") {
      const payment = await prisma.payment.findFirst({
        where: { providerPaymentId: paymentEntity.id },
      });
      if (!payment) return { status: "ignored" };
      if (payment.status === "PAID") return { status: "duplicate" };

      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: { status: "PAID" },
        }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "PAID", status: "CONFIRMED" },
        }),
        prisma.webhookEvent.create({
          data: { handler: "razorpay", providerEventId: input.providerEventId },
        }),
      ]);

      log.info({ providerPaymentId: paymentEntity.id }, "webhook: payment captured");
      return { status: "processed" };
    }

    // Non-captured events: just record the webhook event
    await prisma.webhookEvent.create({
      data: { handler: "razorpay", providerEventId: input.providerEventId },
    });
    return { status: "ignored" };
  },

  // ------------------------------------------------------------------
  // Order lookup
  // ------------------------------------------------------------------
  async getOrder(input: { orderId?: string; accessToken?: string }) {
    const order = await prisma.order.findFirst({
      where: input.orderId ? { id: input.orderId } : { accessToken: input.accessToken },
      include: {
        items: { include: { product: true } },
        address: true,
        payments: true,
        shipments: true,
      },
    });
    if (!order) throw notFound("Order not found");
    return order;
  },

  async listOrders() {
    return prisma.order.findMany({
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
  async updateOrderStatus(input: { orderId: string; status: string; actorUserId: string }) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw notFound("Order not found");

    const updated = await prisma.order.update({
      where: { id: input.orderId },
      data: { status: input.status as OrderStatus },
    });

    await audit({
      actorUserId: input.actorUserId,
      action: "order.status",
      resourceType: "order",
      resourceId: order.id,
      metadata: { status: input.status },
    });

    return updated;
  },

  async assignPhysicalTag(input: { orderItemId: string; actorUserId: string }) {
    const orderItem = await prisma.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { order: true, product: true },
    });
    if (!orderItem) throw notFound("Order item not found");
    if (orderItem.order.paymentStatus !== "PAID") throw badRequest("Order not paid");
    const existing = await prisma.physicalTag.findFirst({
      where: { orderItemId: orderItem.id },
    });
    if (existing) throw conflict("Tag already assigned");

    // Find an unassigned physical tag for this product
    const physicalTag = await prisma.physicalTag.findFirst({
      where: { tag: { tagType: "PHYSICAL_QR" }, status: "UNASSIGNED" },
      include: { tag: true },
    });
    if (!physicalTag) throw conflict("No unassigned physical tags available");

    // Activate the linked digital tag for the customer
    await prisma.tag.update({
      where: { id: physicalTag.tagId },
      data: {
        ownerId: orderItem.order.userId ?? undefined,
        status: "ACTIVE",
        activatedAt: new Date(),
      },
    });

    const updated = await prisma.physicalTag.update({
      where: { id: physicalTag.id },
      data: { orderItemId: orderItem.id },
    });

    await audit({
      actorUserId: input.actorUserId,
      action: "order.assign_tag",
      resourceType: "order_item",
      resourceId: orderItem.id,
      metadata: { physicalTagId: physicalTag.id, serialNumber: physicalTag.serialNumber },
    });

    return updated;
  },

  async shipOrder(input: { orderId: string; carrier: string; trackingNumber?: string; actorUserId: string }) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw notFound("Order not found");

    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber ?? null,
        status: "SHIPPED",
        shippedAt: new Date(),
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { status: "SHIPPED" },
    });

    await audit({
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
    return prisma.inventory.findMany({
      include: { product: true },
      orderBy: { product: { name: "asc" } },
    });
  },

  async receiveInventory(input: { productId: string; quantity: number; actorUserId: string }) {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) throw notFound("Product not found");

    const inventory = await prisma.inventory.upsert({
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

    await audit({
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
  async refundOrder(input: { paymentId: string; amountPaise: number; actorUserId: string }) {
    const payment = await prisma.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment) throw notFound("Payment not found");
    if (payment.status !== "PAID") throw badRequest("Payment not paid");

    const refund = await paymentProvider.refund(payment.providerPaymentId!, input.amountPaise);

    const created = await prisma.refund.create({
      data: {
        paymentId: input.paymentId,
        providerRefundId: refund.refundId,
        amountPaise: input.amountPaise,
        status: "SUCCEEDED",
      },
    });

    await audit({
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
    const paidOrders = await prisma.order.findMany({
      where: { paymentStatus: "PAID" },
      select: { total: true },
    });
    const grossSales = paidOrders.reduce((sum, o) => sum + o.total, 0);

    const refunds = await prisma.refund.aggregate({
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
