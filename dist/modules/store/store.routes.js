"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const store_service_1 = require("./store.service");
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../../common/errors");
const uuidParam = zod_1.z.object({ id: zod_1.z.string().uuid() });
const checkoutSchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({ productId: zod_1.z.string().uuid(), quantity: zod_1.z.number().int().min(1).max(10) })),
    address: zod_1.z.object({
        name: zod_1.z.string().min(1).max(100),
        phone: zod_1.z.string().min(5).max(20),
        addressLines: zod_1.z.string().min(1).max(200),
        city: zod_1.z.string().min(1).max(50),
        state: zod_1.z.string().min(1).max(50),
        postalCode: zod_1.z.string().min(3).max(20),
    }),
});
const createPaymentOrderSchema = zod_1.z.object({
    orderId: zod_1.z.string().uuid(),
});
const verifyPaymentSchema = zod_1.z.object({
    orderId: zod_1.z.string().uuid(),
    providerOrderId: zod_1.z.string(),
    providerPaymentId: zod_1.z.string(),
    signature: zod_1.z.string(),
});
const updateOrderStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]),
});
const assignTagSchema = zod_1.z.object({
    orderItemId: zod_1.z.string().uuid(),
});
const shipOrderSchema = zod_1.z.object({
    carrier: zod_1.z.string().min(1).max(50),
    trackingNumber: zod_1.z.string().optional(),
});
const refundOrderSchema = zod_1.z.object({
    paymentId: zod_1.z.string().uuid(),
    amountPaise: zod_1.z.number().int().positive(),
});
const receiveInventorySchema = zod_1.z.object({
    productId: zod_1.z.string().uuid(),
    quantity: zod_1.z.number().int().positive(),
});
exports.storeRouter = (0, express_1.Router)();
// ------------------------------------------------------------------
// Public catalogue
// ------------------------------------------------------------------
exports.storeRouter.get("/products", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const products = await store_service_1.storeService.listProducts();
    res.json({ data: products });
}));
// ------------------------------------------------------------------
// Public checkout (guest or authenticated)
// ------------------------------------------------------------------
exports.storeRouter.post("/checkout", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { items, address } = checkoutSchema.parse(req.body);
    const result = await store_service_1.storeService.createOrder({
        userId: req.user?.id ?? undefined,
        items,
        address,
    });
    res.status(201).json({ data: result });
}));
// ------------------------------------------------------------------
// Payment (guest or authenticated)
// ------------------------------------------------------------------
exports.storeRouter.post("/payments/create-order", (0, validation_1.validate)(createPaymentOrderSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await store_service_1.storeService.createPaymentOrder({
        orderId: req.body.orderId,
        accessToken: req.body.accessToken,
    });
    res.json({ data: result });
}));
exports.storeRouter.post("/payments/verify", (0, validation_1.validate)(verifyPaymentSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await store_service_1.storeService.verifyPayment({
        orderId: req.body.orderId,
        providerOrderId: req.body.providerOrderId,
        providerPaymentId: req.body.providerPaymentId,
        signature: req.body.signature,
        accessToken: req.body.accessToken,
    });
    res.json({ data: result });
}));
// ------------------------------------------------------------------
// Razorpay webhook (signature verified against raw body; idempotent)
// ------------------------------------------------------------------
exports.storeRouter.post("/webhooks/razorpay", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.rawBody;
    const result = await store_service_1.storeService.handleWebhook({
        providerEventId: req.body?.id ?? req.body?.event_id ?? "unknown",
        payload: req.body,
        signature,
        rawBody,
    });
    res.json({ status: result.status });
}));
// ------------------------------------------------------------------
// Public order lookup by access token (guest)
// ------------------------------------------------------------------
exports.storeRouter.get("/orders/:accessToken", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const order = await store_service_1.storeService.getOrder({ accessToken: req.params.accessToken });
    res.json({ data: order });
}));
// ------------------------------------------------------------------
// Everything below requires authentication
// ------------------------------------------------------------------
exports.storeRouter.use(auth_1.authenticate);
exports.storeRouter.get("/account/orders", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const orders = await prisma_1.prisma.order.findMany({
        where: { userId: req.user.id },
        include: { items: true, payments: true, shipments: true },
        orderBy: { createdAt: "desc" },
    });
    res.json({ data: orders });
}));
exports.storeRouter.get("/orders/:orderId", (0, validation_1.validate)(uuidParam, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const order = await store_service_1.storeService.getOrder({ orderId: req.params.orderId });
    if (order.userId && order.userId !== req.user.id) {
        throw (0, errors_1.forbidden)("Not your order");
    }
    res.json({ data: order });
}));
// ------------------------------------------------------------------
// Admin routes
// ------------------------------------------------------------------
exports.storeRouter.get("/admin/orders", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_ORDERS_READ), (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const orders = await store_service_1.storeService.listOrders();
    res.json({ data: orders });
}));
exports.storeRouter.patch("/admin/orders/:id/status", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_ORDERS_WRITE), (0, validation_1.validate)(uuidParam, "params"), (0, validation_1.validate)(updateOrderStatusSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const order = await store_service_1.storeService.updateOrderStatus({
        orderId: req.params.id,
        status: req.body.status,
        actorUserId: req.user.id,
    });
    res.json({ data: order });
}));
exports.storeRouter.post("/admin/orders/:orderId/assign-tag", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_ORDERS_WRITE), (0, validation_1.validate)(zod_1.z.object({ orderId: zod_1.z.string().uuid() }), "params"), (0, validation_1.validate)(assignTagSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await store_service_1.storeService.assignPhysicalTag({
        orderItemId: req.body.orderItemId,
        actorUserId: req.user.id,
    });
    res.json({ data: result });
}));
exports.storeRouter.post("/admin/orders/:orderId/ship", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_ORDERS_WRITE), (0, validation_1.validate)(zod_1.z.object({ orderId: zod_1.z.string().uuid() }), "params"), (0, validation_1.validate)(shipOrderSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await store_service_1.storeService.shipOrder({
        orderId: req.params.orderId,
        carrier: req.body.carrier,
        trackingNumber: req.body.trackingNumber,
        actorUserId: req.user.id,
    });
    res.json({ data: result });
}));
exports.storeRouter.post("/admin/orders/:orderId/refund", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_REFUNDS_WRITE), (0, validation_1.validate)(zod_1.z.object({ orderId: zod_1.z.string().uuid() }), "params"), (0, validation_1.validate)(refundOrderSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await store_service_1.storeService.refundOrder({
        paymentId: req.body.paymentId,
        amountPaise: req.body.amountPaise,
        actorUserId: req.user.id,
    });
    res.json({ data: result });
}));
exports.storeRouter.get("/admin/inventory", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_INVENTORY_READ), (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const inventory = await store_service_1.storeService.listInventory();
    res.json({ data: inventory });
}));
exports.storeRouter.post("/admin/inventory/receive", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_INVENTORY_WRITE), (0, validation_1.validate)(receiveInventorySchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await store_service_1.storeService.receiveInventory({
        productId: req.body.productId,
        quantity: req.body.quantity,
        actorUserId: req.user.id,
    });
    res.json({ data: result });
}));
exports.storeRouter.get("/admin/revenue", (0, auth_1.requirePermission)(permissions_1.Permission.STORE_REVENUE_READ), (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const revenue = await store_service_1.storeService.revenue();
    res.json({ data: revenue });
}));
//# sourceMappingURL=store.routes.js.map