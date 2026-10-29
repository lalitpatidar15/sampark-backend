"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicLocationRouter = exports.scannerLocationRouter = exports.locationRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const rateLimit_1 = require("../../common/middleware/rateLimit");
const permissions_1 = require("../../common/guards/permissions");
const location_service_1 = require("./location.service");
exports.locationRouter = (0, express_1.Router)();
// Owner: review and respond to location requests.
exports.locationRouter.use(auth_1.authenticate);
exports.locationRouter.get("/requests", (0, auth_1.requirePermission)(permissions_1.Permission.LOCATION_SHARE_SELF), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await location_service_1.locationService.listRequests(req.user.id) });
}));
exports.locationRouter.post("/requests/:requestId/respond", (0, auth_1.requirePermission)(permissions_1.Permission.LOCATION_SHARE_SELF), (0, validation_1.validate)(zod_1.z.object({
    approve: zod_1.z.boolean(),
    latitude: zod_1.z.number().min(-90).max(90).optional(),
    longitude: zod_1.z.number().min(-180).max(180).optional(),
    accuracy: zod_1.z.number().int().min(0).max(100_000).optional(),
    ttlMinutes: zod_1.z.number().int().min(5).max(1440).optional(),
})), (0, validation_1.validate)(zod_1.z.object({ requestId: zod_1.z.string().uuid() }), "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { requestId } = req.params;
    res.json({
        data: await location_service_1.locationService.respond({
            ownerId: req.user.id,
            requestId,
            ...req.body,
            ip: req.ip,
        }),
    });
}));
exports.locationRouter.post("/shares/:shareId/revoke", (0, auth_1.requirePermission)(permissions_1.Permission.LOCATION_SHARE_SELF), (0, validation_1.validate)(zod_1.z.object({ shareId: zod_1.z.string().uuid() }), "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { shareId } = req.params;
    await location_service_1.locationService.revoke(shareId, req.user.id, req.ip);
    res.status(204).send();
}));
// ---------------------------------------------------------------------------
// Scanner: request a share
// ---------------------------------------------------------------------------
exports.scannerLocationRouter = (0, express_1.Router)();
exports.scannerLocationRouter.use((0, rateLimit_1.scannerLimiter)());
exports.scannerLocationRouter.post("/request", (0, validation_1.validate)(zod_1.z.object({ sessionToken: zod_1.z.string().min(20), reasonCode: zod_1.z.string().max(48).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { sessionToken, reasonCode } = req.body;
    res.status(201).json({ data: await location_service_1.locationService.requestShare({ sessionToken, reasonCode }) });
}));
// ---------------------------------------------------------------------------
// Public: resolve an expiring share link (spec 16)
// ---------------------------------------------------------------------------
exports.publicLocationRouter = (0, express_1.Router)();
exports.publicLocationRouter.use((0, rateLimit_1.scannerLimiter)());
exports.publicLocationRouter.get("/:publicShareId", (0, validation_1.validate)(zod_1.z.object({ publicShareId: zod_1.z.string().min(8).max(64) }), "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { publicShareId } = req.params;
    res.json({ data: await location_service_1.locationService.resolveShare(publicShareId) });
}));
//# sourceMappingURL=location.routes.js.map