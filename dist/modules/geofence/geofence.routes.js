"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geofencePublicRouter = exports.geofenceOwnerRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const geofence_service_1 = require("./geofence.service");
const idParam = zod_1.z.object({ tagId: zod_1.z.string().uuid() });
const upsertBody = zod_1.z.object({
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
    radiusMeters: zod_1.z.number().int().min(10).max(50_000).optional(),
    allowedChannels: zod_1.z
        .array(zod_1.z.enum(["CHAT", "VOICE"]))
        .min(1)
        .optional(),
    activeSchedule: zod_1.z.string().optional(),
    cooldownMinutes: zod_1.z.number().int().min(1).optional(),
    alertOnProximity: zod_1.z.boolean().optional(),
    enabled: zod_1.z.boolean().optional(),
});
const proximityBody = zod_1.z.object({
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
});
/** Owner: configure a tag's geo-fence. Mounted under /tags/:tagId/geofence. */
exports.geofenceOwnerRouter = (0, express_1.Router)();
exports.geofenceOwnerRouter.use(auth_1.authenticate);
exports.geofenceOwnerRouter.post("/:tagId/geofence", (0, validation_1.validate)(idParam, "params"), (0, validation_1.validate)(upsertBody), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await geofence_service_1.geofenceService.upsert({
        tagId: req.params.tagId,
        ownerId: req.user.id,
        ...req.body,
        ip: req.ip,
    });
    res.json({ data: result });
}));
exports.geofenceOwnerRouter.get("/:tagId/geofence", (0, validation_1.validate)(idParam, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await geofence_service_1.geofenceService.get(req.params.tagId, req.user.id);
    res.json({ data: result });
}));
exports.geofenceOwnerRouter.delete("/:tagId/geofence", (0, validation_1.validate)(idParam, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await geofence_service_1.geofenceService.remove(req.params.tagId, req.user.id, req.ip);
    res.status(204).send();
}));
/** Public: proximity check for a tag's geo-fence (no account). */
exports.geofencePublicRouter = (0, express_1.Router)();
exports.geofencePublicRouter.post("/:tagId/proximity", (0, validation_1.validate)(zod_1.z.object({ tagId: zod_1.z.string().uuid() }), "params"), (0, validation_1.validate)(proximityBody), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await geofence_service_1.geofenceService.checkProximity(req.params.tagId, req.body.latitude, req.body.longitude);
    res.json({ data: result });
}));
//# sourceMappingURL=geofence.routes.js.map