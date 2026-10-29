"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const admin_service_1 = require("./admin.service");
const uuidParam = zod_1.z.object({ id: zod_1.z.string().uuid() });
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_1.authenticate);
exports.adminRouter.get("/dashboard", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_ANALYTICS_READ), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.dashboard(req.user.role) });
}));
exports.adminRouter.get("/users", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_USERS_READ), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listUsers(req.query) });
}));
exports.adminRouter.post("/users/:id/status", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_USERS_WRITE), (0, validation_1.validate)(uuidParam, "params"), (0, validation_1.validate)(zod_1.z.object({ status: zod_1.z.enum(["ACTIVE", "SUSPENDED"]), reason: zod_1.z.string().trim().min(3).max(280) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;
    res.json({
        data: await admin_service_1.adminService.setUserStatus({
            actorUserId: req.user.id,
            actorRole: req.user.role,
            userId: id,
            status,
            reason,
            ip: req.ip,
        }),
    });
}));
exports.adminRouter.get("/tags", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_TAGS_READ), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listTags(req.query) });
}));
exports.adminRouter.post("/tags/:id/suspend", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_TAGS_SUSPEND), (0, validation_1.validate)(uuidParam, "params"), (0, validation_1.validate)(zod_1.z.object({ reason: zod_1.z.string().trim().min(3).max(280) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    res.json({
        data: await admin_service_1.adminService.suspendTag({
            actorUserId: req.user.id,
            actorRole: req.user.role,
            tagId: id,
            reason,
            ip: req.ip,
        }),
    });
}));
exports.adminRouter.get("/communications", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_COMMUNICATIONS_READ), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listCommunications(req.query) });
}));
exports.adminRouter.get("/abuse-reports", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_FRAUD_MANAGE), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listAbuseReports(req.query) });
}));
exports.adminRouter.post("/abuse-reports/:id/review", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_FRAUD_MANAGE), (0, validation_1.validate)(uuidParam, "params"), (0, validation_1.validate)(zod_1.z.object({ state: zod_1.z.enum(["CONFIRMED", "DISMISSED", "ACTIONED"]), actionTaken: zod_1.z.string().max(280).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    res.json({
        data: await admin_service_1.adminService.reviewAbuse({
            actorUserId: req.user.id,
            reportId: id,
            state: body.state,
            actionTaken: body.actionTaken,
            ip: req.ip,
        }),
    });
}));
exports.adminRouter.get("/emergencies", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_COMMUNICATIONS_READ), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listEmergencies(req.query) });
}));
exports.adminRouter.post("/emergencies/:id/resolve", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_COMMUNICATIONS_READ), (0, validation_1.validate)(zod_1.z.object({ id: zod_1.z.string().uuid() }), "params"), (0, validation_1.validate)(zod_1.z.object({ note: zod_1.z.string().max(500).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { note } = req.body;
    res.json({ data: await admin_service_1.adminService.resolveEmergency({ alertId: id, actorUserId: req.user.id, note, ip: req.ip }) });
}));
exports.adminRouter.get("/audit-logs", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_AUDIT_READ), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listAuditLogs(req.query) });
}));
exports.adminRouter.get("/analytics", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_ANALYTICS_READ), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.analytics(req.query) });
}));
// --- Super admin only -------------------------------------------------------
exports.adminRouter.get("/providers", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_PROVIDER_CREDENTIALS), (0, auth_1.requireRole)(permissions_1.UserRole.SUPER_ADMIN), (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    res.json({ data: await admin_service_1.adminService.providers() });
}));
exports.adminRouter.patch("/providers/:id", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_PROVIDER_CREDENTIALS), (0, auth_1.requireRole)(permissions_1.UserRole.SUPER_ADMIN), (0, validation_1.validate)(zod_1.z.object({ key: zod_1.z.string().min(3).max(64) }), "params"), (0, validation_1.validate)(zod_1.z.object({ isActive: zod_1.z.boolean(), secretRef: zod_1.z.string().max(256).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { key } = req.params;
    const body = req.body;
    res.json({
        data: await admin_service_1.adminService.setProviderActive({ actorUserId: req.user.id, key, ...body, ip: req.ip }),
    });
}));
exports.adminRouter.get("/feature-flags", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_FEATURE_FLAGS), (0, auth_1.requireRole)(permissions_1.UserRole.SUPER_ADMIN), (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    res.json({ data: await admin_service_1.adminService.featureFlags() });
}));
exports.adminRouter.patch("/feature-flags/:id", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_FEATURE_FLAGS), (0, auth_1.requireRole)(permissions_1.UserRole.SUPER_ADMIN), (0, validation_1.validate)(zod_1.z.object({ id: zod_1.z.string().min(2).max(64) }), "params"), (0, validation_1.validate)(zod_1.z.object({ enabled: zod_1.z.boolean() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { enabled } = req.body;
    res.json({ data: await admin_service_1.adminService.setFeatureFlag({ actorUserId: req.user.id, key: id, enabled, ip: req.ip }) });
}));
// QR Size management
exports.adminRouter.get("/qr-sizes", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_QR_SIZE_MANAGE), (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    res.json({ data: await admin_service_1.adminService.listQrSizes() });
}));
exports.adminRouter.post("/qr-sizes", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_QR_SIZE_MANAGE), (0, validation_1.validate)(zod_1.z.object({ size: zod_1.z.number().int().min(32).max(2048), label: zod_1.z.string().min(1).max(64), isActive: zod_1.z.boolean().optional(), sortOrder: zod_1.z.number().int().min(0).optional(), description: zod_1.z.string().max(256).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.status(201).json({ data: await admin_service_1.adminService.createQrSize({ ...req.body, actorUserId: req.user.id, ip: req.ip }) });
}));
exports.adminRouter.patch("/qr-sizes/:id", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_QR_SIZE_MANAGE), (0, validation_1.validate)(zod_1.z.object({ id: zod_1.z.string().uuid() }), "params"), (0, validation_1.validate)(zod_1.z.object({ label: zod_1.z.string().min(1).max(64).optional(), isActive: zod_1.z.boolean().optional(), sortOrder: zod_1.z.number().int().min(0).optional(), description: zod_1.z.string().max(256).optional() })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({ data: await admin_service_1.adminService.updateQrSize({ actorUserId: req.user.id, id, patch: req.body, ip: req.ip }) });
}));
exports.adminRouter.delete("/qr-sizes/:id", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_QR_SIZE_MANAGE), (0, validation_1.validate)(zod_1.z.object({ id: zod_1.z.string().uuid() }), "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    await admin_service_1.adminService.deleteQrSize({ actorUserId: req.user.id, id, ip: req.ip });
    res.status(204).send();
}));
exports.adminRouter.get("/qr-sizes/active", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    res.json({ data: await admin_service_1.adminService.getActiveQrSizes() });
}));
// --- NFC admin ---
exports.adminRouter.get("/nfc", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_NFC_MANAGE), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listNfcTags(req.query) });
}));
exports.adminRouter.post("/nfc/:tagId/link", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_NFC_MANAGE), (0, validation_1.validate)(uuidParam, "params"), (0, validation_1.validate)(zod_1.z.object({ nfcUid: zod_1.z.string().min(4) })), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { tagId } = req.params;
    const { nfcUid } = req.body;
    res.json({ data: await admin_service_1.adminService.linkNfcTag({ actorUserId: req.user.id, tagId, nfcUid, ip: req.ip }) });
}));
exports.adminRouter.delete("/nfc/:tagId", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_NFC_MANAGE), (0, validation_1.validate)(uuidParam, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { tagId } = req.params;
    res.json({ data: await admin_service_1.adminService.unlinkNfcTag({ actorUserId: req.user.id, tagId, ip: req.ip }) });
}));
// --- Geo-fence admin ---
exports.adminRouter.get("/geofences", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_GEOFENCE_MANAGE), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await admin_service_1.adminService.listGeofences(req.query) });
}));
exports.adminRouter.post("/geofences/:tagId", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_GEOFENCE_MANAGE), (0, validation_1.validate)(uuidParam, "params"), (0, validation_1.validate)(zod_1.z.object({
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
    radiusMeters: zod_1.z.number().int().min(10).max(50_000).optional(),
    allowedChannels: zod_1.z.array(zod_1.z.enum(["CHAT", "VOICE"])).min(1).optional(),
    activeSchedule: zod_1.z.string().optional(),
    cooldownMinutes: zod_1.z.number().int().min(1).optional(),
    alertOnProximity: zod_1.z.boolean().optional(),
    enabled: zod_1.z.boolean().optional(),
})), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { tagId } = req.params;
    res.json({ data: await admin_service_1.adminService.upsertGeofence({ actorUserId: req.user.id, tagId, ...req.body, ip: req.ip }) });
}));
exports.adminRouter.delete("/geofences/:tagId", (0, auth_1.requirePermission)(permissions_1.Permission.ADMIN_GEOFENCE_MANAGE), (0, validation_1.validate)(uuidParam, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { tagId } = req.params;
    res.json({ data: await admin_service_1.adminService.removeGeofence({ actorUserId: req.user.id, tagId, ip: req.ip }) });
}));
//# sourceMappingURL=admin.routes.js.map