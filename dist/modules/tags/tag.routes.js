"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tagRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const etag_routes_1 = require("./etag.routes");
const tag_service_1 = require("./tag.service");
const qr_service_1 = require("../qr/qr.service");
const tagTypeSchema = zod_1.z.enum([
    "PHYSICAL_QR",
    "DIGITAL_QR",
    "NFC",
    "QR_NFC",
    "DOOR",
    "VEHICLE",
    "BIKE",
    "PARKING",
    "PROFESSIONAL",
    "BUSINESS",
]);
const createTagSchema = zod_1.z.object({
    tagType: tagTypeSchema,
    assetId: zod_1.z.string().uuid().optional(),
    label: zod_1.z.string().trim().max(64).optional(),
});
const idParamSchema = zod_1.z.object({ id: zod_1.z.string().uuid() });
exports.tagRouter = (0, express_1.Router)();
exports.tagRouter.use(auth_1.authenticate);
exports.tagRouter.post("", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(createTagSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    const result = await tag_service_1.tagService.createTag({ ...body, ownerId: req.user.id, ip: req.ip });
    res.status(201).json({ data: result });
}));
exports.tagRouter.get("", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await tag_service_1.tagService.listTags(req.user.id) });
}));
exports.tagRouter.post("/:id/activate", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({ data: await tag_service_1.tagService.activateTag({ tagId: id, ownerId: req.user.id, ip: req.ip }) });
}));
exports.tagRouter.post("/:id/deactivate", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({
        data: await tag_service_1.tagService.deactivateTag({
            tagId: id,
            ownerId: req.user.id,
            reason: req.body?.reason,
            ip: req.ip,
        }),
    });
}));
exports.tagRouter.post("/:id/rotate-token", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const rotated = await tag_service_1.tagService.rotateToken({ tagId: id, ownerId: req.user.id, ip: req.ip });
    // The public token is only ever returned here, to the authenticated owner.
    res.json({ data: { ...rotated, url: tag_service_1.tagService.qrPayloadFor(rotated.publicToken) } });
}));
exports.tagRouter.post("/:id/nfc", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(zod_1.z.object({ nfcUid: zod_1.z.string().trim().min(4).max(64) })), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { nfcUid } = req.body;
    res.json({ data: await tag_service_1.tagService.linkNfc({ tagId: id, ownerId: req.user.id, nfcUid, ip: req.ip }) });
}));
exports.tagRouter.post("/:id/asset", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(zod_1.z.object({ assetId: zod_1.z.string().uuid() })), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { assetId } = req.body;
    res.json({ data: await tag_service_1.tagService.linkAsset({ tagId: id, ownerId: req.user.id, assetId, ip: req.ip }) });
}));
exports.tagRouter.get("/:id/history", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    res.json({ data: await tag_service_1.tagService.history(id, req.user.id) });
}));
exports.tagRouter.get("/:id/qr", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const format = req.query.format ?? "svg";
    const size = Math.min(1024, Math.max(128, Number(req.query.size) || 512));
    res.type(format === "svg" ? "image/svg+xml" : "image/png").send(await (0, qr_service_1.buildQrPayload)({ tagId: id, ownerId: req.user.id, format, size }));
}));
const generateCustomQRSchema = zod_1.z.object({
    size: zod_1.z.number().int().min(128).max(2048).optional(),
    errorCorrectionLevel: zod_1.z.enum(['L', 'M', 'Q', 'H']).optional(),
    margin: zod_1.z.number().int().min(0).max(10).optional(),
    colorDark: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    colorLight: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    shape: zod_1.z.enum(['square', 'rounded', 'dots', 'classy', 'classy-rounded', 'custom']).optional(),
    theme: zod_1.z.string().optional(),
    logo: zod_1.z.object({
        src: zod_1.z.string().url().or(zod_1.z.string().startsWith('data:image/')),
        size: zod_1.z.number().min(0.1).max(0.5).optional(),
        background: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        borderRadius: zod_1.z.number().min(0).optional(),
    }).optional(),
    format: zod_1.z.enum(['png', 'svg', 'jpeg', 'webp']).optional(),
    quality: zod_1.z.number().min(0.1).max(1).optional(),
});
exports.tagRouter.post("/:id/qr/custom", (0, auth_1.requirePermission)(permissions_1.Permission.TAGS_MANAGE_SELF), (0, validation_1.validate)(idParamSchema, "params"), (0, validation_1.validate)(generateCustomQRSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const options = req.body;
    const result = await tag_service_1.tagService.generateCustomQR({ ...options, ownerId: req.user.id, tagId: id });
    res.json({ data: result });
}));
exports.tagRouter.use("/etag", etag_routes_1.etagRouter);
//# sourceMappingURL=tag.routes.js.map