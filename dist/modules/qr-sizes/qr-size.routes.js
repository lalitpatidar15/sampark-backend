"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.qrSizeRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const qr_size_service_1 = require("./qr-size.service");
const createSchema = zod_1.z.object({
    size: zod_1.z.number().int().min(32).max(2048),
    label: zod_1.z.string().min(1).max(64),
    isActive: zod_1.z.boolean().optional(),
    sortOrder: zod_1.z.number().int().min(0).optional(),
    description: zod_1.z.string().max(256).optional(),
});
const updateSchema = zod_1.z.object({
    label: zod_1.z.string().min(1).max(64).optional(),
    isActive: zod_1.z.boolean().optional(),
    sortOrder: zod_1.z.number().int().min(0).optional(),
    description: zod_1.z.string().max(256).optional(),
});
const idParamSchema = zod_1.z.object({ id: zod_1.z.string().uuid() });
exports.qrSizeRouter = (0, express_1.Router)();
exports.qrSizeRouter.use(auth_1.authenticate);
// Get active QR sizes for tag customization
exports.qrSizeRouter.get("/active", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const sizes = await qr_size_service_1.qrSizeService.getActive();
    res.json({ data: sizes });
}));
// Admin endpoints
exports.qrSizeRouter.use((0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_QR_SIZE_MANAGE));
exports.qrSizeRouter.get("", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const sizes = await qr_size_service_1.qrSizeService.list();
    res.json({ data: sizes });
}));
exports.qrSizeRouter.post("", (0, validation_1.validate)(createSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await qr_size_service_1.qrSizeService.create({ ...req.body, ownerId: req.user.id, ip: req.ip });
    res.status(201).json({ data: result });
}));
exports.qrSizeRouter.get("/:id", (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({ data: await qr_size_service_1.qrSizeService.getById(id) });
}));
exports.qrSizeRouter.patch("/:id", (0, validation_1.validate)(idParamSchema, "params"), (0, validation_1.validate)(updateSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({ data: await qr_size_service_1.qrSizeService.update({ id, patch: req.body, actorUserId: req.user.id, ip: req.ip }) });
}));
exports.qrSizeRouter.delete("/:id", (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    await qr_size_service_1.qrSizeService.delete({ id, actorUserId: req.user.id, ip: req.ip });
    res.status(204).send();
}));
//# sourceMappingURL=qr-size.routes.js.map