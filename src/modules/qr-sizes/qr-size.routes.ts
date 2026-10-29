import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { qrSizeService } from "./qr-size.service";

const createSchema = z.object({
  size: z.number().int().min(32).max(2048),
  label: z.string().min(1).max(64),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  description: z.string().max(256).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  description: z.string().max(256).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export const qrSizeRouter = Router();

qrSizeRouter.use(authenticate);

// Get active QR sizes for tag customization
qrSizeRouter.get(
  "/active",
  asyncHandler(async (_req, res) => {
    const sizes = await qrSizeService.getActive();
    res.json({ data: sizes });
  }),
);

// Admin endpoints
qrSizeRouter.use(requirePermission(Permission.ADMIN_QR_SIZE_MANAGE));

qrSizeRouter.get(
  "",
  asyncHandler(async (_req, res) => {
    const sizes = await qrSizeService.list();
    res.json({ data: sizes });
  }),
);

qrSizeRouter.post(
  "",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const result = await qrSizeService.create({ ...req.body, ownerId: req.user!.id, ip: req.ip });
    res.status(201).json({ data: result });
  }),
);

qrSizeRouter.get(
  "/:id",
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    res.json({ data: await qrSizeService.getById(id) });
  }),
);

qrSizeRouter.patch(
  "/:id",
  validate(idParamSchema, "params"),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    res.json({ data: await qrSizeService.update({ id, patch: req.body, actorUserId: req.user!.id, ip: req.ip }) });
  }),
);

qrSizeRouter.delete(
  "/:id",
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    await qrSizeService.delete({ id, actorUserId: req.user!.id, ip: req.ip });
    res.status(204).send();
  }),
);