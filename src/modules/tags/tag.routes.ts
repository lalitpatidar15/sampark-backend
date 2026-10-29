import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { etagRouter } from "./etag.routes";
import { tagService } from "./tag.service";
import { buildQrPayload } from "../qr/qr.service";

const tagTypeSchema = z.enum([
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

const createTagSchema = z.object({
  tagType: tagTypeSchema,
  assetId: z.string().uuid().optional(),
  label: z.string().trim().max(64).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export const tagRouter = Router();

tagRouter.use(authenticate);

tagRouter.post(
  "",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(createTagSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createTagSchema>;
    const result = await tagService.createTag({ ...body, ownerId: req.user!.id, ip: req.ip });
    res.status(201).json({ data: result });
  }),
);

tagRouter.get(
  "",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  asyncHandler(async (req, res) => {
    res.json({ data: await tagService.listTags(req.user!.id) });
  }),
);

tagRouter.post(
  "/:id/activate",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    res.json({ data: await tagService.activateTag({ tagId: id, ownerId: req.user!.id, ip: req.ip }) });
  }),
);

tagRouter.post(
  "/:id/deactivate",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    res.json({
      data: await tagService.deactivateTag({
        tagId: id,
        ownerId: req.user!.id,
        reason: (req.body as { reason?: string } | undefined)?.reason,
        ip: req.ip,
      }),
    });
  }),
);

tagRouter.post(
  "/:id/rotate-token",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const rotated = await tagService.rotateToken({ tagId: id, ownerId: req.user!.id, ip: req.ip });
    // The public token is only ever returned here, to the authenticated owner.
    res.json({ data: { ...rotated, url: tagService.qrPayloadFor(rotated.publicToken) } });
  }),
);

tagRouter.post(
  "/:id/nfc",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(z.object({ nfcUid: z.string().trim().min(4).max(64) })),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { nfcUid } = req.body as { nfcUid: string };
    res.json({ data: await tagService.linkNfc({ tagId: id, ownerId: req.user!.id, nfcUid, ip: req.ip }) });
  }),
);

tagRouter.post(
  "/:id/asset",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(z.object({ assetId: z.string().uuid() })),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { assetId } = req.body as { assetId: string };
    res.json({ data: await tagService.linkAsset({ tagId: id, ownerId: req.user!.id, assetId, ip: req.ip }) });
  }),
);

tagRouter.get(
  "/:id/history",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    res.json({ data: await tagService.history(id, req.user!.id) });
  }),
);

tagRouter.get(
  "/:id/qr",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(idParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const format = (req.query.format as string) ?? "svg";
    const size = Math.min(1024, Math.max(128, Number(req.query.size) || 512));
    res.type(format === "svg" ? "image/svg+xml" : "image/png").send(await buildQrPayload({ tagId: id, ownerId: req.user!.id, format, size }));
  }),
);

const generateCustomQRSchema = z.object({
  size: z.number().int().min(128).max(2048).optional(),
  errorCorrectionLevel: z.enum(['L', 'M', 'Q', 'H']).optional(),
  margin: z.number().int().min(0).max(10).optional(),
  colorDark: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  colorLight: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  shape: z.enum(['square', 'rounded', 'dots', 'classy', 'classy-rounded', 'custom']).optional(),
  theme: z.string().optional(),
  logo: z.object({
    src: z.string().url().or(z.string().startsWith('data:image/')),
    size: z.number().min(0.1).max(0.5).optional(),
    background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    borderRadius: z.number().min(0).optional(),
  }).optional(),
  format: z.enum(['png', 'svg', 'jpeg', 'webp']).optional(),
  quality: z.number().min(0.1).max(1).optional(),
});

tagRouter.post(
  "/:id/qr/custom",
  requirePermission(Permission.TAGS_MANAGE_SELF),
  validate(idParamSchema, "params"),
  validate(generateCustomQRSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const options = req.body as z.infer<typeof generateCustomQRSchema>;
    const result = await tagService.generateCustomQR({ ...options, ownerId: req.user!.id, tagId: id });
    res.json({ data: result });
  }),
);

tagRouter.use("/etag", etagRouter);
