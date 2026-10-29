"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scannerRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const rateLimit_1 = require("../../common/middleware/rateLimit");
const scanner_service_1 = require("./scanner.service");
const communication_service_1 = require("../communication/communication.service");
const otp_service_1 = require("../auth/otp.service");
const publicTokenSchema = zod_1.z.object({
    publicToken: zod_1.z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9]+$/, "Invalid tag code"),
});
const sessionBodySchema = zod_1.z.object({
    sessionToken: zod_1.z.string().min(20),
});
const reasonSchema = sessionBodySchema.extend({
    reasonCode: zod_1.z.string().trim().min(2).max(48),
});
const verifySchema = sessionBodySchema.extend({
    phone: zod_1.z.string().trim().regex(/^\+?[0-9]{10,15}$/),
    code: zod_1.z.string().trim().regex(/^\d{6}$/),
});
exports.scannerRouter = (0, express_1.Router)();
// Every public scanner operation is rate limited (spec 32.2).
exports.scannerRouter.use((0, rateLimit_1.scannerLimiter)());
/**
 * STEP 1 — the visitor scans. No account, no app, no OTP for a low-risk read.
 * The response is the masked display projection only.
 */
exports.scannerRouter.get("/tags/:publicToken", (0, validation_1.validate)(publicTokenSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { publicToken } = req.params;
    const { view, scannerSession } = await scanner_service_1.scannerService.resolveTag({
        publicToken,
        ip: req.ip,
        userAgent: req.header("user-agent") ?? undefined,
    });
    res.json({
        data: { view, session: scannerSession },
    });
}));
/** STEP 2 — the visitor picks why they are making contact. */
exports.scannerRouter.post("/session/reason", (0, validation_1.validate)(reasonSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionToken, reasonCode } = req.body;
    res.json({ data: await scanner_service_1.scannerService.setReason(sessionToken, reasonCode) });
}));
/** STEP 2b — optional phone verification before a higher-risk action. */
exports.scannerRouter.post("/session/verify", (0, validation_1.validate)(verifySchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    res.json({ data: await scanner_service_1.scannerService.verifyScannerPhone(body) });
}));
/** Request an OTP for scanner verification (spec 7.3). */
exports.scannerRouter.post("/session/verify/request", (0, validation_1.validate)(zod_1.z.object({ sessionToken: zod_1.z.string().min(20), phone: zod_1.z.string().trim().regex(/^\+?[0-9]{10,15}$/) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionToken, phone } = req.body;
    await scanner_service_1.scannerService.authorizeSession(sessionToken);
    const result = await (0, otp_service_1.requestOtp)({ phone, purpose: "SCANNER_VERIFY" });
    res.status(202).json({ data: result });
}));
/**
 * STEP 3 — the visitor picks a channel. The privacy gateway creates a
 * communication session; real numbers are never exposed to the scanner.
 */
exports.scannerRouter.post("/contact", (0, validation_1.validate)(reasonSchema.extend({ channel: zod_1.z.enum(["VOICE", "VIDEO", "SMS", "WHATSAPP", "CHAT"]) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionToken, reasonCode, channel } = req.body;
    res.status(201).json({
        data: await communication_service_1.communicationService.startFromScanner({
            sessionToken,
            reasonCode,
            channel,
            ip: req.ip,
            userAgent: req.header("user-agent") ?? undefined,
        }),
    });
}));
/** Emergency path. Raises an alert for the owner and their priority contacts. */
exports.scannerRouter.post("/emergency", (0, validation_1.validate)(reasonSchema.extend({ note: zod_1.z.string().trim().max(280).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    res.status(201).json({ data: await communication_service_1.communicationService.raiseEmergency(body) });
}));
/**
 * Polls the state of the scan. The session token travels in a header, not the
 * URL, so it is not written to access logs or browser history.
 */
exports.scannerRouter.post("/session/status", (0, validation_1.validate)(zod_1.z.object({ sessionToken: zod_1.z.string().min(20) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionToken } = req.body;
    res.json({ data: await communication_service_1.communicationService.scannerStatus(sessionToken) });
}));
/** Ends a scanner session early (e.g. the visitor closed the page). */
exports.scannerRouter.post("/session/end", (0, validation_1.validate)(sessionBodySchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionToken } = req.body;
    await communication_service_1.communicationService.endScannerSession(sessionToken);
    res.status(204).send();
}));
//# sourceMappingURL=scanner.routes.js.map