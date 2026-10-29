import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { storeService } from "./store.service";
import { prisma } from "../../db/prisma";
import { forbidden } from "../../common/errors";

const uuidParam = z.object({ id: z.string().uuid() });

const checkoutSchema = z.object({
  items: z.array(
    z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10) }),
  ),
  address: z.object({
    name: z.string().min(1).max(100),
    phone: z.string().min(5).max(20),
    addressLines: z.string().min(1).max(200),
    city: z.string().min(1).max(50),
    state: z.string().min(1).max(50),
    postalCode: z.string().min(3).max(20),
  }),
});

const createPaymentOrderSchema = z.object({
  orderId: z.string().uuid(),
});

const verifyPaymentSchema = z.object({
  orderId: z.string().uuid(),
  providerOrderId: z.string(),
  providerPaymentId: z.string(),
  signature: z.string(),
});

const updateOrderStatusSchema = z.object({
  status: z.enum(["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]),
});

const assignTagSchema = z.object({
  orderItemId: z.string().uuid(),
});

const shipOrderSchema = z.object({
  carrier: z.string().min(1).max(50),
  trackingNumber: z.string().optional(),
});

const refundOrderSchema = z.object({
  paymentId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
});

const receiveInventorySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const storeRouter = Router();

// ------------------------------------------------------------------
// Public catalogue
// ------------------------------------------------------------------
storeRouter.get(
  "/products",
  asyncHandler(async (_req, res) => {
    const products = await storeService.listProducts();
    res.json({ data: products });
  }),
);

// ------------------------------------------------------------------
// Public checkout (guest or authenticated)
// ------------------------------------------------------------------
storeRouter.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    const { items, address } = checkoutSchema.parse(req.body);
    const result = await storeService.createOrder({
      userId: req.user?.id ?? undefined,
      items,
      address,
    });
    res.status(201).json({ data: result });
  }),
);

// ------------------------------------------------------------------
// Payment (guest or authenticated)
// ------------------------------------------------------------------
storeRouter.post(
  "/payments/create-order",
  validate(createPaymentOrderSchema),
  asyncHandler(async (req, res) => {
    const result = await storeService.createPaymentOrder({
      orderId: req.body.orderId,
      accessToken: req.body.accessToken,
    });
    res.json({ data: result });
  }),
);

storeRouter.post(
  "/payments/verify",
  validate(verifyPaymentSchema),
  asyncHandler(async (req, res) => {
    const result = await storeService.verifyPayment({
      orderId: req.body.orderId,
      providerOrderId: req.body.providerOrderId,
      providerPaymentId: req.body.providerPaymentId,
      signature: req.body.signature,
      accessToken: req.body.accessToken,
    });
    res.json({ data: result });
  }),
);

// ------------------------------------------------------------------
// Razorpay webhook (signature verified against raw body; idempotent)
// ------------------------------------------------------------------
storeRouter.post(
  "/webhooks/razorpay",
  asyncHandler(async (req, res) => {
    const signature = req.headers["x-razorpay-signature"] as string;
    const rawBody = (req as any).rawBody;
    const result = await storeService.handleWebhook({
      providerEventId: req.body?.id ?? req.body?.event_id ?? "unknown",
      payload: req.body,
      signature,
      rawBody,
    });
    res.json({ status: result.status });
  }),
);

// ------------------------------------------------------------------
// Public order lookup by access token (guest)
// ------------------------------------------------------------------
storeRouter.get(
  "/orders/:accessToken",
  asyncHandler(async (req, res) => {
    const order = await storeService.getOrder({ accessToken: req.params.accessToken });
    res.json({ data: order });
  }),
);

// ------------------------------------------------------------------
// Everything below requires authentication
// ------------------------------------------------------------------
storeRouter.use(authenticate);

storeRouter.get(
  "/account/orders",
  asyncHandler(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },
      include: { items: true, payments: true, shipments: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: orders });
  }),
);

storeRouter.get(
  "/orders/:orderId",
  validate(uuidParam, "params"),
  asyncHandler(async (req, res) => {
    const order = await storeService.getOrder({ orderId: req.params.orderId });
    if (order.userId && order.userId !== req.user!.id) {
      throw forbidden("Not your order");
    }
    res.json({ data: order });
  }),
);

// ------------------------------------------------------------------
// Admin routes
// ------------------------------------------------------------------
storeRouter.get(
  "/admin/orders",
  requirePermission(Permission.STORE_ORDERS_READ),
  asyncHandler(async (_req, res) => {
    const orders = await storeService.listOrders();
    res.json({ data: orders });
  }),
);

storeRouter.patch(
  "/admin/orders/:id/status",
  requirePermission(Permission.STORE_ORDERS_WRITE),
  validate(uuidParam, "params"),
  validate(updateOrderStatusSchema),
  asyncHandler(async (req, res) => {
    const order = await storeService.updateOrderStatus({
      orderId: req.params.id,
      status: req.body.status,
      actorUserId: req.user!.id,
    });
    res.json({ data: order });
  }),
);

storeRouter.post(
  "/admin/orders/:orderId/assign-tag",
  requirePermission(Permission.STORE_ORDERS_WRITE),
  validate(z.object({ orderId: z.string().uuid() }), "params"),
  validate(assignTagSchema),
  asyncHandler(async (req, res) => {
    const result = await storeService.assignPhysicalTag({
      orderItemId: req.body.orderItemId,
      actorUserId: req.user!.id,
    });
    res.json({ data: result });
  }),
);

storeRouter.post(
  "/admin/orders/:orderId/ship",
  requirePermission(Permission.STORE_ORDERS_WRITE),
  validate(z.object({ orderId: z.string().uuid() }), "params"),
  validate(shipOrderSchema),
  asyncHandler(async (req, res) => {
    const result = await storeService.shipOrder({
      orderId: req.params.orderId,
      carrier: req.body.carrier,
      trackingNumber: req.body.trackingNumber,
      actorUserId: req.user!.id,
    });
    res.json({ data: result });
  }),
);

storeRouter.post(
  "/admin/orders/:orderId/refund",
  requirePermission(Permission.STORE_REFUNDS_WRITE),
  validate(z.object({ orderId: z.string().uuid() }), "params"),
  validate(refundOrderSchema),
  asyncHandler(async (req, res) => {
    const result = await storeService.refundOrder({
      paymentId: req.body.paymentId,
      amountPaise: req.body.amountPaise,
      actorUserId: req.user!.id,
    });
    res.json({ data: result });
  }),
);

storeRouter.get(
  "/admin/inventory",
  requirePermission(Permission.STORE_INVENTORY_READ),
  asyncHandler(async (_req, res) => {
    const inventory = await storeService.listInventory();
    res.json({ data: inventory });
  }),
);

storeRouter.post(
  "/admin/inventory/receive",
  requirePermission(Permission.STORE_INVENTORY_WRITE),
  validate(receiveInventorySchema),
  asyncHandler(async (req, res) => {
    const result = await storeService.receiveInventory({
      productId: req.body.productId,
      quantity: req.body.quantity,
      actorUserId: req.user!.id,
    });
    res.json({ data: result });
  }),
);

storeRouter.get(
  "/admin/revenue",
  requirePermission(Permission.STORE_REVENUE_READ),
  asyncHandler(async (_req, res) => {
    const revenue = await storeService.revenue();
    res.json({ data: revenue });
  }),
);
