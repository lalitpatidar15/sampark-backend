import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { documentService } from "./document.service";

const uploadUrlSchema = z.object({
  assetId: z.string().uuid(),
  documentType: z.enum(["REGISTRATION_CERTIFICATE", "INSURANCE", "PUC", "FASTAG", "SERVICE_RECORD", "IDENTITY", "OTHER"]),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  fileSize: z.number().int().positive().max(10 * 1024 * 1024),
});

const createDocumentSchema = z.object({
  assetId: z.string().uuid(),
  documentType: z.enum(["REGISTRATION_CERTIFICATE", "INSURANCE", "PUC", "FASTAG", "SERVICE_RECORD", "IDENTITY", "OTHER"]),
  objectKey: z.string().min(1),
  originalName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
});

const documentIdSchema = z.object({ documentId: z.string().uuid() });

export const documentRouter = Router();

documentRouter.use(authenticate);

documentRouter.post(
  "/upload-url",
  validate(uploadUrlSchema),
  asyncHandler(async (req, res) => {
    const result = await documentService.getUploadUrl({ ...req.body, ownerId: req.user!.id, ip: req.ip });
    res.json({ data: result });
  }),
);

documentRouter.post(
  "/",
  validate(createDocumentSchema),
  asyncHandler(async (req, res) => {
    const result = await documentService.createDocument({ ...req.body, ownerId: req.user!.id, ip: req.ip });
    res.status(201).json({ data: result });
  }),
);

documentRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const assetId = req.query.assetId as string | undefined;
    res.json({ data: await documentService.listDocuments(req.user!.id, assetId) });
  }),
);

documentRouter.get(
  "/:documentId",
  validate(documentIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params as unknown as z.infer<typeof documentIdSchema>;
    res.json({ data: await documentService.getDocument(req.user!.id, documentId) });
  }),
);

documentRouter.get(
  "/:documentId/download",
  validate(documentIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params as unknown as z.infer<typeof documentIdSchema>;
    res.json({ data: await documentService.getDownloadUrl(documentId, req.user!.id) });
  }),
);

documentRouter.delete(
  "/:documentId",
  validate(documentIdSchema, "params"),
  requirePermission(Permission.DOCUMENTS_MANAGE_SELF),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params as unknown as z.infer<typeof documentIdSchema>;
    await documentService.deleteDocument(req.user!.id, documentId, req.ip);
    res.status(204).send();
  }),
);