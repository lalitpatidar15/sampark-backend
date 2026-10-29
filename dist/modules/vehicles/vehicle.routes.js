"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vehicleRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const vehicle_service_1 = require("./vehicle.service");
const assetTypeSchema = zod_1.z.enum([
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
const createAssetSchema = zod_1.z.object({
    assetType: assetTypeSchema,
    displayName: zod_1.z.string().trim().min(1).max(80),
});
const createVehicleSchema = zod_1.z.object({
    assetId: zod_1.z.string().uuid(),
    registration: zod_1.z.string().trim().min(6).max(20),
    make: zod_1.z.string().trim().max(40).optional(),
    model: zod_1.z.string().trim().max(40).optional(),
    variant: zod_1.z.string().trim().max(40).optional(),
    color: zod_1.z.string().trim().max(30).optional(),
    year: zod_1.z.number().int().min(1900).max(2100).optional(),
    vehicleType: zod_1.z.string().trim().max(30).optional(),
    fuelType: zod_1.z.string().trim().max(30).optional(),
    insuranceExpiry: zod_1.z.coerce.date().optional(),
    pucExpiry: zod_1.z.coerce.date().optional(),
    fastagStatus: zod_1.z.enum(["ACTIVE", "EXPIRED", "NOT_LINKED"]).optional(),
});
const idParamSchema = zod_1.z.object({ id: zod_1.z.string().uuid() });
exports.vehicleRouter = (0, express_1.Router)();
exports.vehicleRouter.use(auth_1.authenticate);
exports.vehicleRouter.get("/assets", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_READ_SELF), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await vehicle_service_1.assetService.listAssets(req.user.id) });
}));
exports.vehicleRouter.post("/assets", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_WRITE_SELF), (0, validation_1.validate)(createAssetSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    res.status(201).json({ data: await vehicle_service_1.assetService.createAsset({ ...body, ownerId: req.user.id, ip: req.ip }) });
}));
exports.vehicleRouter.get("", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_READ_SELF), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await vehicle_service_1.vehicleService.listVehicles(req.user.id) });
}));
exports.vehicleRouter.post("", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_WRITE_SELF), (0, validation_1.validate)(createVehicleSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    res.status(201).json({ data: await vehicle_service_1.vehicleService.createVehicle({ ...body, ownerId: req.user.id, ip: req.ip }) });
}));
exports.vehicleRouter.patch("/:id", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_WRITE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, validation_1.validate)(createVehicleSchema.omit({ assetId: true, registration: true }).partial().extend({ registration: zod_1.z.string().trim().min(6).max(20).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({
        data: await vehicle_service_1.vehicleService.updateVehicle({
            ownerId: req.user.id,
            vehicleId: id,
            patch: req.body,
            ip: req.ip,
        }),
    });
}));
exports.vehicleRouter.delete("/:id", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_WRITE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    await vehicle_service_1.vehicleService.deleteVehicle({ ownerId: req.user.id, vehicleId: id, ip: req.ip });
    res.status(204).send();
}));
exports.vehicleRouter.get("/:id/activity", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_READ_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({ data: await vehicle_service_1.vehicleService.activity(id, req.user.id) });
}));
exports.vehicleRouter.post("/search", (0, auth_1.requirePermission)(permissions_1.Permission.VEHICLES_READ_SELF), (0, validation_1.validate)(zod_1.z.object({ registration: zod_1.z.string().trim().min(6).max(20) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { registration } = req.body;
    res.json({ data: await vehicle_service_1.vehicleService.searchRegistration({ ownerId: req.user.id, registration, ip: req.ip }) });
}));
//# sourceMappingURL=vehicle.routes.js.map