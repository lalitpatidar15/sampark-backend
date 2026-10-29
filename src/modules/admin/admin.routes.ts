import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission, requireRole } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission, UserRole } from "../../common/guards/permissions";
import { adminService } from "./admin.service";
import { qrSizeService } from "../qr-sizes/qr-size.service";

const uuidParam = z.object({ id: z.string().uuid() });

export const adminRouter = Router();
adminRouter.use(authenticate);

adminRouter.get(
  "/dashboard",
  requirePermission(Permission.ADMIN_ANALYTICS_READ),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.dashboard(req.user!.role) });
  }),
);

adminRouter.get(
  "/users",
  requirePermission(Permission.ADMIN_USERS_READ),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listUsers(req.query as Record<string, unknown>) });
  }),
);

adminRouter.post(
  "/users/:id/status",
  requirePermission(Permission.ADMIN_USERS_WRITE),
  validate(uuidParam, "params"),
  validate(z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().min(3).max(280) })),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParam>;
    const { status, reason } = req.body as { status: "ACTIVE" | "SUSPENDED"; reason: string };
    res.json({
      data: await adminService.setUserStatus({
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        userId: id,
        status,
        reason,
        ip: req.ip,
      }),
    });
  }),
);

adminRouter.get(
  "/tags",
  requirePermission(Permission.ADMIN_TAGS_READ),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listTags(req.query as Record<string, unknown>) });
  }),
);

adminRouter.post(
  "/tags/:id/suspend",
  requirePermission(Permission.ADMIN_TAGS_SUSPEND),
  validate(uuidParam, "params"),
  validate(z.object({ reason: z.string().trim().min(3).max(280) })),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParam>;
    const { reason } = req.body as { reason: string };
    res.json({
      data: await adminService.suspendTag({
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        tagId: id,
        reason,
        ip: req.ip,
      }),
    });
  }),
);

adminRouter.get(
  "/communications",
  requirePermission(Permission.ADMIN_COMMUNICATIONS_READ),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listCommunications(req.query as Record<string, unknown>) });
  }),
);

adminRouter.get(
  "/abuse-reports",
  requirePermission(Permission.ADMIN_FRAUD_MANAGE),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listAbuseReports(req.query as Record<string, unknown>) });
  }),
);

adminRouter.post(
  "/abuse-reports/:id/review",
  requirePermission(Permission.ADMIN_FRAUD_MANAGE),
  validate(uuidParam, "params"),
  validate(z.object({ state: z.enum(["CONFIRMED", "DISMISSED", "ACTIONED"]), actionTaken: z.string().max(280).optional() })),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParam>;
    const body = req.body as { state: "CONFIRMED" | "DISMISSED" | "ACTIONED"; actionTaken?: string };
    res.json({
      data: await adminService.reviewAbuse({
        actorUserId: req.user!.id,
        reportId: id,
        state: body.state,
        actionTaken: body.actionTaken,
        ip: req.ip,
      }),
    });
  }),
);

adminRouter.get(
  "/emergencies",
  requirePermission(Permission.ADMIN_COMMUNICATIONS_READ),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listEmergencies(req.query as Record<string, unknown>) });
  }),
);

adminRouter.post(
  "/emergencies/:id/resolve",
  requirePermission(Permission.ADMIN_COMMUNICATIONS_READ),
  validate(z.object({ id: z.string().uuid() }), "params"),
  validate(z.object({ note: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    const { note } = req.body as { note?: string };
    res.json({ data: await adminService.resolveEmergency({ alertId: id, actorUserId: req.user!.id, note, ip: req.ip }) });
  }),
);

adminRouter.get(
  "/audit-logs",
  requirePermission(Permission.ADMIN_AUDIT_READ),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listAuditLogs(req.query as Record<string, unknown>) });
  }),
);

adminRouter.get(
  "/analytics",
  requirePermission(Permission.ADMIN_ANALYTICS_READ),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.analytics(req.query as Record<string, unknown>) });
  }),
);

// --- Super admin only -------------------------------------------------------

adminRouter.get(
  "/providers",
  requirePermission(Permission.ADMIN_PROVIDER_CREDENTIALS),
  requireRole(UserRole.SUPER_ADMIN),
  asyncHandler(async (_req, res) => {
    res.json({ data: await adminService.providers() });
  }),
);

adminRouter.patch(
  "/providers/:id",
  requirePermission(Permission.ADMIN_PROVIDER_CREDENTIALS),
  requireRole(UserRole.SUPER_ADMIN),
  validate(z.object({ key: z.string().min(3).max(64) }), "params"),
  validate(z.object({ isActive: z.boolean(), secretRef: z.string().max(256).optional() })),
  asyncHandler(async (req, res) => {
    const { key } = req.params as unknown as { key: string };
    const body = req.body as { isActive: boolean; secretRef?: string };
    res.json({
      data: await adminService.setProviderActive({ actorUserId: req.user!.id, key, ...body, ip: req.ip }),
    });
  }),
);

adminRouter.get(
  "/feature-flags",
  requirePermission(Permission.ADMIN_FEATURE_FLAGS),
  requireRole(UserRole.SUPER_ADMIN),
  asyncHandler(async (_req, res) => {
    res.json({ data: await adminService.featureFlags() });
  }),
);

adminRouter.patch(
  "/feature-flags/:id",
  requirePermission(Permission.ADMIN_FEATURE_FLAGS),
  requireRole(UserRole.SUPER_ADMIN),
  validate(z.object({ id: z.string().min(2).max(64) }), "params"),
  validate(z.object({ enabled: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    const { enabled } = req.body as { enabled: boolean };
    res.json({ data: await adminService.setFeatureFlag({ actorUserId: req.user!.id, key: id, enabled, ip: req.ip }) });
  }),
);

// QR Size management
adminRouter.get(
  "/qr-sizes",
  requirePermission(Permission.ADMIN_QR_SIZE_MANAGE),
  asyncHandler(async (_req, res) => {
    res.json({ data: await adminService.listQrSizes() });
  }),
);

adminRouter.post(
  "/qr-sizes",
  requirePermission(Permission.ADMIN_QR_SIZE_MANAGE),
  validate(z.object({ size: z.number().int().min(32).max(2048), label: z.string().min(1).max(64), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).optional(), description: z.string().max(256).optional() })),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await adminService.createQrSize({ ...req.body, actorUserId: req.user!.id, ip: req.ip }) });
  }),
);

adminRouter.patch(
  "/qr-sizes/:id",
  requirePermission(Permission.ADMIN_QR_SIZE_MANAGE),
  validate(z.object({ id: z.string().uuid() }), "params"),
  validate(z.object({ label: z.string().min(1).max(64).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).optional(), description: z.string().max(256).optional() })),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    res.json({ data: await adminService.updateQrSize({ actorUserId: req.user!.id, id, patch: req.body, ip: req.ip }) });
  }),
);

adminRouter.delete(
  "/qr-sizes/:id",
  requirePermission(Permission.ADMIN_QR_SIZE_MANAGE),
  validate(z.object({ id: z.string().uuid() }), "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    await adminService.deleteQrSize({ actorUserId: req.user!.id, id, ip: req.ip });
    res.status(204).send();
  }),
);

adminRouter.get(
  "/qr-sizes/active",
  asyncHandler(async (_req, res) => {
    res.json({ data: await adminService.getActiveQrSizes() });
  }),
);

// --- NFC admin ---
adminRouter.get(
  "/nfc",
  requirePermission(Permission.ADMIN_NFC_MANAGE),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listNfcTags(req.query as Record<string, unknown>) });
  }),
);

adminRouter.post(
  "/nfc/:tagId/link",
  requirePermission(Permission.ADMIN_NFC_MANAGE),
  validate(uuidParam, "params"),
  validate(z.object({ nfcUid: z.string().min(4) })),
  asyncHandler(async (req, res) => {
    const { tagId } = req.params as unknown as { tagId: string };
    const { nfcUid } = req.body as { nfcUid: string };
    res.json({ data: await adminService.linkNfcTag({ actorUserId: req.user!.id, tagId, nfcUid, ip: req.ip }) });
  }),
);

adminRouter.delete(
  "/nfc/:tagId",
  requirePermission(Permission.ADMIN_NFC_MANAGE),
  validate(uuidParam, "params"),
  asyncHandler(async (req, res) => {
    const { tagId } = req.params as unknown as { tagId: string };
    res.json({ data: await adminService.unlinkNfcTag({ actorUserId: req.user!.id, tagId, ip: req.ip }) });
  }),
);

// --- Geo-fence admin ---
adminRouter.get(
  "/geofences",
  requirePermission(Permission.ADMIN_GEOFENCE_MANAGE),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminService.listGeofences(req.query as Record<string, unknown>) });
  }),
);

adminRouter.post(
  "/geofences/:tagId",
  requirePermission(Permission.ADMIN_GEOFENCE_MANAGE),
  validate(uuidParam, "params"),
  validate(z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(10).max(50_000).optional(),
    allowedChannels: z.array(z.enum(["CHAT", "VOICE"])).min(1).optional(),
    activeSchedule: z.string().optional(),
    cooldownMinutes: z.number().int().min(1).optional(),
    alertOnProximity: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })),
  asyncHandler(async (req, res) => {
    const { tagId } = req.params as unknown as { tagId: string };
    res.json({ data: await adminService.upsertGeofence({ actorUserId: req.user!.id, tagId, ...req.body, ip: req.ip }) });
  }),
);

adminRouter.delete(
  "/geofences/:tagId",
  requirePermission(Permission.ADMIN_GEOFENCE_MANAGE),
  validate(uuidParam, "params"),
  asyncHandler(async (req, res) => {
    const { tagId } = req.params as unknown as { tagId: string };
    res.json({ data: await adminService.removeGeofence({ actorUserId: req.user!.id, tagId, ip: req.ip }) });
  }),
);
