"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const user_service_1 = require("./user.service");
const privacySchema = zod_1.z.object({
    enabledChannels: zod_1.z
        .array(zod_1.z.enum(["VOICE", "VIDEO", "SMS", "WHATSAPP", "CHAT", "PUSH"]))
        .optional(),
    allowLocationShare: zod_1.z.boolean().optional(),
    allowVideoCalls: zod_1.z.boolean().optional(),
    allowUnknownCallers: zod_1.z.boolean().optional(),
    quietHoursStart: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    quietHoursEnd: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});
exports.userRouter = (0, express_1.Router)();
exports.userRouter.use(auth_1.authenticate);
exports.userRouter.get("/me", (0, auth_1.requirePermission)(permissions_1.Permission.USERS_READ_SELF), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await user_service_1.userService.getProfile(req.user.id) });
}));
exports.userRouter.patch("/me", (0, auth_1.requirePermission)(permissions_1.Permission.USERS_WRITE_SELF), (0, validation_1.validate)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(120) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { name } = req.body;
    res.json({ data: await user_service_1.userService.updateName(req.user.id, name, req.ip) });
}));
exports.userRouter.patch("/me/privacy", (0, auth_1.requirePermission)(permissions_1.Permission.USERS_WRITE_SELF), (0, validation_1.validate)(privacySchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({
        data: await user_service_1.userService.updatePrivacySettings({
            userId: req.user.id,
            ...req.body,
            ip: req.ip,
        }),
    });
}));
exports.userRouter.post("/me/email", (0, auth_1.requirePermission)(permissions_1.Permission.USERS_WRITE_SELF), (0, validation_1.validate)(zod_1.z.object({ email: zod_1.z.string().email() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email } = req.body;
    res.json({ data: await user_service_1.userService.addEmail(req.user.id, email, req.ip) });
}));
exports.userRouter.post("/me/devices", (0, auth_1.requirePermission)(permissions_1.Permission.USERS_WRITE_SELF), (0, validation_1.validate)(zod_1.z.object({
    devicePublicId: zod_1.z.string().min(8).max(64),
    platform: zod_1.z.enum(["ios", "android"]),
    appVersion: zod_1.z.string().max(32).optional(),
    pushToken: zod_1.z.string().max(512).optional(),
})), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    res.status(201).json({ data: await user_service_1.userService.registerDevice({ userId: req.user.id, ...body }) });
}));
/** GDPR/ DPDP-style export. Requires a fresh OTP (spec 30). */
exports.userRouter.get("/me/export", (0, auth_1.requirePermission)(permissions_1.Permission.USERS_EXPORT_SELF), auth_1.requireRecentReauth, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await user_service_1.userService.exportData(req.user.id) });
}));
/** Account deletion. Requires a fresh OTP (spec 30). */
exports.userRouter.post("/me/delete", (0, auth_1.requirePermission)(permissions_1.Permission.USERS_EXPORT_SELF), auth_1.requireRecentReauth, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await user_service_1.userService.deleteAccount({ userId: req.user.id, ip: req.ip }) });
}));
//# sourceMappingURL=user.routes.js.map