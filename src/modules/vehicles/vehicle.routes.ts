import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { assetService, vehicleService } from "./vehicle.service";

const assetTypeSchema = z.enum([
  "VEHICLE",
  "BIKE",
  "HOME_DOOR",
  "OFFICE",
  "SOCIETY",
  "PARKING",
  "PROFESSIONAL",
  "BUSINESS",
  "DELIVERY",
  "EQUIPMENT",
  "OTHER",
]);

const createAssetSchema = z.object({
  assetType: assetTypeSchema,
  displayName: z.string().trim().min(1).max(80),
});

const createVehicleSchema = z.object({
  assetId: z.string().uuid(),
  registration: z.string().trim().min(6).max(20),
  make: z.string().trim().max(40).optional(),
  model: z.string().trim().max(40).optional(),
  variant: z.string().trim().max(40).optional(),
  color: z.string().trim().max(30).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  vehicleType: z.string().trim().max(30).optional(),
  fuelType: z.string().trim().max(30).optional(),
  insuranceExpiry: z.coerce.date().optional(),
  pucExpiry: z.coerce.date().optional(),
  fastagStatus: z.enum(["ACTIVE", "EXPIRED", "NOT_LINKED"]).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export const vehicleRouter = Router();
vehicleRouter.use(authenticate);

vehicleRouter.get(
  "/assets",
  requirePermission(Permission.VEHICLES_READ_SELF),
  asyncHandler(async (req, res) => {
    res.json({ data: await assetService.listAssets(req.user!.id) });
  }),
);

vehicleRouter.post(
  "/assets",
  requirePermission(Permission.VEHICLES_WRITE_SELF),
  validate(createAssetSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createAssetSchema>;
    res.status(201).json({ data: await assetService.createAsset({ ...body, ownerId: req.user!.id, ip: req.ip }) });
  }),
);

vehicleRouter.get(
  "",
  requirePermission(Permission.VEHICLES_READ_SELF),
  asyncHandler(async (req, res) => {
    res.json({ data: await vehicleService.listVehicles(req.user!.id) });
  }),
);

vehicleRouter.post(
  "",
  requirePermission(Permission.VEHICLES_WRITE_SELF),
  validate(createVehicleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createVehicleSchema>;
    res.status(201).json({ data: await vehicleService.createVehicle({ ...body, ownerId: req.user!.id, ip: req.ip }) });
  }),
);

vehicleRouter.patch(
  "/:id",
  requirePermission(Permission.VEHICLES_WRITE_SELF),
  validate(idParamSchema, "params"),
  validate(
    createVehicleSchema.omit({ assetId: true, registration: true }).partial().extend({ registration: z.string().trim().min(6).max(20).optional() }),
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    res.json({
      data: await vehicleService.updateVehicle({
        ownerId: req.user!.id,
        vehicleId: id,
        patch: req.body as Record<string, unknown>,
        ip: req.ip,
      }),
    });
  }),
);

vehicleRouter.delete(
  "/:id",
  requirePermission(Permission.VEHICLES_WRITE_SELF),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await vehicleService.deleteVehicle({ ownerId: req.user!.id, vehicleId: id, ip: req.ip });
    res.status(204).send();
  }),
);

vehicleRouter.get(
  "/:id/activity",
  requirePermission(Permission.VEHICLES_READ_SELF),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    res.json({ data: await vehicleService.activity(id, req.user!.id) });
  }),
);

vehicleRouter.post(
  "/search",
  requirePermission(Permission.VEHICLES_READ_SELF),
  validate(z.object({ registration: z.string().trim().min(6).max(20) })),
  asyncHandler(async (req, res) => {
    const { registration } = req.body as { registration: string };
    res.json({ data: await vehicleService.searchRegistration({ ownerId: req.user!.id, registration, ip: req.ip }) });
  }),
);
