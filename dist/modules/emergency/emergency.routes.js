"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emergencyRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const emergency_service_1 = require("./emergency.service");
const contactSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(80),
    relationship: zod_1.z.string().trim().min(1).max(40),
    phone: zod_1.z.string().trim().regex(/^\+?[0-9]{10,15}$/),
    priority: zod_1.z.number().int().min(1).max(10),
    enabled: zod_1.z.boolean(),
});
const profileSchema = zod_1.z.object({
    assetId: zod_1.z.string().uuid(),
    bloodGroup: zod_1.z.string().trim().max(8).optional(),
    insuranceProvider: zod_1.z.string().trim().max(80).optional(),
    insurancePolicy: zod_1.z.string().trim().max(60).optional(),
    firstResponderNote: zod_1.z.string().trim().max(500).optional(),
    enabled: zod_1.z.boolean(),
});
const idParamSchema = zod_1.z.object({ id: zod_1.z.string().uuid() });
exports.emergencyRouter = (0, express_1.Router)();
exports.emergencyRouter.use(auth_1.authenticate);
exports.emergencyRouter.get("/contacts", (0, auth_1.requirePermission)(permissions_1.Permission.EMERGENCY_MANAGE), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await emergency_service_1.emergencyService.listContacts(req.user.id) });
}));
/** Changing an emergency contact is a sensitive operation (spec 30). */
exports.emergencyRouter.post("/contacts", (0, auth_1.requirePermission)(permissions_1.Permission.EMERGENCY_MANAGE), auth_1.requireRecentReauth, (0, validation_1.validate)(contactSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.status(201).json({
        data: await emergency_service_1.emergencyService.upsertContact({ ownerId: req.user.id, ...req.body, ip: req.ip }),
    });
}));
exports.emergencyRouter.put("/contacts/:id", (0, auth_1.requirePermission)(permissions_1.Permission.EMERGENCY_MANAGE), auth_1.requireRecentReauth, (0, validation_1.validate)(idParamSchema, "params"), (0, validation_1.validate)(contactSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({
        data: await emergency_service_1.emergencyService.upsertContact({
            ownerId: req.user.id,
            id,
            ...req.body,
            ip: req.ip,
        }),
    });
}));
exports.emergencyRouter.delete("/contacts/:id", (0, auth_1.requirePermission)(permissions_1.Permission.EMERGENCY_MANAGE), auth_1.requireRecentReauth, (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    await emergency_service_1.emergencyService.deleteContact({ ownerId: req.user.id, contactId: id, ip: req.ip });
    res.status(204).send();
}));
exports.emergencyRouter.get("/profiles/:assetId", (0, auth_1.requirePermission)(permissions_1.Permission.EMERGENCY_MANAGE), (0, validation_1.validate)(zod_1.z.object({ assetId: zod_1.z.string().uuid() }), "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { assetId } = req.params;
    res.json({ data: await emergency_service_1.emergencyService.getProfile(req.user.id, assetId) });
}));
exports.emergencyRouter.put("/profiles", (0, auth_1.requirePermission)(permissions_1.Permission.EMERGENCY_MANAGE), auth_1.requireRecentReauth, (0, validation_1.validate)(profileSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({
        data: await emergency_service_1.emergencyService.upsertProfile({ ownerId: req.user.id, ...req.body, ip: req.ip }),
    });
}));
//# sourceMappingURL=emergency.routes.js.map