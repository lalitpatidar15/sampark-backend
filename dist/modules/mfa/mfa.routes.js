"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mfaRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const mfa_service_1 = require("./mfa.service");
const tokenSchema = zod_1.z.object({ token: zod_1.z.string().min(6).max(6) });
exports.mfaRouter = (0, express_1.Router)();
exports.mfaRouter.use(auth_1.authenticate);
exports.mfaRouter.get("/status", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const enabled = await mfa_service_1.mfaService.isEnabled(req.user.id);
    res.json({ data: { enabled } });
}));
exports.mfaRouter.post("/setup", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await mfa_service_1.mfaService.generateSetup(req.user.id, req.ip);
    res.json({ data: { uri: result.uri, recoveryCodes: result.recoveryCodes } });
}));
exports.mfaRouter.post("/confirm", (0, validation_1.validate)(tokenSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await mfa_service_1.mfaService.confirmSetup(req.user.id, req.body.token, req.ip);
    res.json({ data: { enabled: true } });
}));
exports.mfaRouter.post("/verify", (0, validation_1.validate)(tokenSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const ok = await mfa_service_1.mfaService.verifyToken(req.user.id, req.body.token, req.ip);
    res.json({ data: { valid: ok } });
}));
exports.mfaRouter.post("/disable", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await mfa_service_1.mfaService.disable(req.user.id, req.user.id, req.ip);
    res.json({ data: { disabled: true } });
}));
//# sourceMappingURL=mfa.routes.js.map