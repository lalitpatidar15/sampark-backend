"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const rateLimit_1 = require("../../common/middleware/rateLimit");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const auth_service_1 = require("./auth.service");
const phoneSchema = zod_1.z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number with country code");
const requestOtpSchema = zod_1.z.object({
    phone: phoneSchema,
    purpose: zod_1.z.enum(["LOGIN", "REAUTH", "REGISTRATION", "SCANNER_VERIFY", "TAG_TRANSFER"]).default("LOGIN"),
});
const loginSchema = zod_1.z.object({
    phone: phoneSchema,
    code: zod_1.z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
const refreshSchema = zod_1.z.object({ refreshToken: zod_1.z.string().min(20) });
const reauthSchema = zod_1.z.object({
    phone: phoneSchema,
    code: zod_1.z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post("/otp/request", (0, rateLimit_1.otpLimiter)(), (0, validation_1.validate)(requestOtpSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { phone, purpose } = req.body;
    const result = await auth_service_1.authService.requestOtp(phone, purpose);
    res.status(202).json({ data: result });
}));
exports.authRouter.post("/login", (0, rateLimit_1.otpLimiter)(), (0, validation_1.validate)(loginSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { phone, code } = req.body;
    const result = await auth_service_1.authService.login({
        phone,
        code,
        userAgent: req.header("user-agent") ?? undefined,
        ip: req.ip,
    });
    res.json({ data: result });
}));
exports.authRouter.post("/refresh", (0, validation_1.validate)(refreshSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { refreshToken } = req.body;
    res.json({ data: await auth_service_1.authService.refresh(refreshToken) });
}));
exports.authRouter.post("/logout", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const refreshToken = req.body?.refreshToken;
    await auth_service_1.authService.logout(refreshToken);
    res.status(204).send();
}));
exports.authRouter.post("/logout-all", auth_1.authenticate, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await auth_service_1.authService.logoutAll(req.user.id);
    res.status(204).send();
}));
exports.authRouter.get("/me", auth_1.authenticate, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await auth_service_1.authService.me(req.user.id) });
}));
exports.authRouter.post("/reauth/request", (0, rateLimit_1.otpLimiter)(), (0, validation_1.validate)(zod_1.z.object({ phone: phoneSchema })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { phone } = req.body;
    res.status(202).json({ data: await auth_service_1.authService.requestOtp(phone, "REAUTH") });
}));
exports.authRouter.post("/reauth/verify", (0, rateLimit_1.otpLimiter)(), auth_1.authenticate, (0, validation_1.validate)(reauthSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { phone, code } = req.body;
    res.json({ data: await auth_service_1.authService.reauthenticate(req.user.id, phone, code) });
}));
//# sourceMappingURL=auth.routes.js.map