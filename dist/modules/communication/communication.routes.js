"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scannerChatRouter = exports.communicationRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const errors_1 = require("../../common/errors");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const rateLimit_1 = require("../../common/middleware/rateLimit");
const permissions_1 = require("../../common/guards/permissions");
const communication_service_1 = require("./communication.service");
const emergency_service_1 = require("../emergency/emergency.service");
const sessionParamSchema = zod_1.z.object({ sessionId: zod_1.z.string().min(8).max(64) });
const messageSchema = zod_1.z.object({ body: zod_1.z.string().trim().min(1).max(2000) });
exports.communicationRouter = (0, express_1.Router)();
// ---------------------------------------------------------------------------
// Owner-facing: incoming contacts and replies
// ---------------------------------------------------------------------------
exports.communicationRouter.use(auth_1.authenticate);
exports.communicationRouter.get("/sessions", (0, auth_1.requirePermission)(permissions_1.Permission.COMMUNICATIONS_RECEIVE), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    res.json({ data: await communication_service_1.communicationService.listForOwner(req.user.id, limit) });
}));
exports.communicationRouter.get("/sessions/:sessionId/messages", (0, auth_1.requirePermission)(permissions_1.Permission.COMMUNICATIONS_RECEIVE), (0, validation_1.validate)(sessionParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionId } = req.params;
    res.json({
        data: await communication_service_1.communicationService.messages({
            communicationSessionId: sessionId,
            actor: "OWNER",
            ownerId: req.user.id,
        }),
    });
}));
exports.communicationRouter.post("/sessions/:sessionId/reply", (0, auth_1.requirePermission)(permissions_1.Permission.COMMUNICATIONS_REPLY), (0, validation_1.validate)(messageSchema), (0, validation_1.validate)(sessionParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionId } = req.params;
    const { body } = req.body;
    res.status(201).json({
        data: await communication_service_1.communicationService.reply({ ownerId: req.user.id, communicationSessionId: sessionId, body }),
    });
}));
exports.communicationRouter.get("/emergency-alerts", (0, auth_1.requirePermission)(permissions_1.Permission.COMMUNICATIONS_RECEIVE), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await emergency_service_1.emergencyService.listForOwner(req.user.id) });
}));
exports.communicationRouter.post("/emergency-alerts/:alertId/resolve", (0, auth_1.requirePermission)(permissions_1.Permission.COMMUNICATIONS_RECEIVE), (0, validation_1.validate)(zod_1.z.object({ alertId: zod_1.z.string().uuid() }), "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { alertId } = req.params;
    res.json({ data: await emergency_service_1.emergencyService.resolve(alertId, req.user.id) });
}));
// ---------------------------------------------------------------------------
// Scanner-facing: transcript polling for an in-progress conversation
//
// The scanner session token travels in a header, never in the URL, so it is not
// captured in access logs, browser history or Referer headers.
// ---------------------------------------------------------------------------
exports.scannerChatRouter = (0, express_1.Router)();
exports.scannerChatRouter.use((0, rateLimit_1.scannerLimiter)());
const scannerSessionToken = (req) => {
    const token = req.header("x-scanner-session");
    if (!token)
        throw (0, errors_1.badRequest)("Missing x-scanner-session header");
    return token;
};
exports.scannerChatRouter.get("/sessions/:sessionId/messages", (0, validation_1.validate)(sessionParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionId } = req.params;
    res.json({
        data: await communication_service_1.communicationService.messages({
            communicationSessionId: sessionId,
            actor: "SCANNER",
            sessionToken: scannerSessionToken(req),
        }),
    });
}));
exports.scannerChatRouter.post("/sessions/:sessionId/messages", (0, validation_1.validate)(sessionParamSchema, "params"), (0, validation_1.validate)(zod_1.z.object({ body: zod_1.z.string().trim().min(1).max(2000) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionId } = req.params;
    const { body } = req.body;
    res.status(201).json({
        data: await communication_service_1.communicationService.sendFromScanner({
            sessionToken: scannerSessionToken(req),
            communicationSessionId: sessionId,
            body,
        }),
    });
}));
//# sourceMappingURL=communication.routes.js.map