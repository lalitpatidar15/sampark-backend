import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission, requireRecentReauth } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { emergencyService } from "./emergency.service";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  relationship: z.string().trim().min(1).max(40),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  priority: z.number().int().min(1).max(10),
  enabled: z.boolean(),
});

const profileSchema = z.object({
  assetId: z.string().uuid(),
  bloodGroup: z.string().trim().max(8).optional(),
  insuranceProvider: z.string().trim().max(80).optional(),
  insurancePolicy: z.string().trim().max(60).optional(),
  firstResponderNote: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export const emergencyRouter = Router();
emergencyRouter.use(authenticate);

emergencyRouter.get(
  "/contacts",
  requirePermission(Permission.EMERGENCY_MANAGE),
  asyncHandler(async (req, res) => {
    res.json({ data: await emergencyService.listContacts(req.user!.id) });
  }),
);

/** Changing an emergency contact is a sensitive operation (spec 30). */
emergencyRouter.post(
  "/contacts",
  requirePermission(Permission.EMERGENCY_MANAGE),
  requireRecentReauth,
  validate(contactSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      data: await emergencyService.upsertContact({ ownerId: req.user!.id, ...(req.body as z.infer<typeof contactSchema>), ip: req.ip }),
    });
  }),
);

emergencyRouter.put(
  "/contacts/:id",
  requirePermission(Permission.EMERGENCY_MANAGE),
  requireRecentReauth,
  validate(idParamSchema, "params"),
  validate(contactSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    res.json({
      data: await emergencyService.upsertContact({
        ownerId: req.user!.id,
        id,
        ...(req.body as z.infer<typeof contactSchema>),
        ip: req.ip,
      }),
    });
  }),
);

emergencyRouter.delete(
  "/contacts/:id",
  requirePermission(Permission.EMERGENCY_MANAGE),
  requireRecentReauth,
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await emergencyService.deleteContact({ ownerId: req.user!.id, contactId: id, ip: req.ip });
    res.status(204).send();
  }),
);

emergencyRouter.get(
  "/profiles/:assetId",
  requirePermission(Permission.EMERGENCY_MANAGE),
  validate(z.object({ assetId: z.string().uuid() }), "params"),
  asyncHandler(async (req, res) => {
    const { assetId } = req.params as unknown as { assetId: string };
    res.json({ data: await emergencyService.getProfile(req.user!.id, assetId) });
  }),
);

emergencyRouter.put(
  "/profiles",
  requirePermission(Permission.EMERGENCY_MANAGE),
  requireRecentReauth,
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    res.json({
      data: await emergencyService.upsertProfile({ ownerId: req.user!.id, ...(req.body as z.infer<typeof profileSchema>), ip: req.ip }),
    });
  }),
);
