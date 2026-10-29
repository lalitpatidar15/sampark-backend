"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const document_service_1 = require("./document.service");
const uploadUrlSchema = zod_1.z.object({
    assetId: zod_1.z.string().uuid(),
    documentType: zod_1.z.enum(["REGISTRATION_CERTIFICATE", "INSURANCE", "PUC", "FASTAG", "SERVICE_RECORD", "IDENTITY", "OTHER"]),
    fileName: zod_1.z.string().min(1).max(255),
    contentType: zod_1.z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    fileSize: zod_1.z.number().int().positive().max(10 * 1024 * 1024),
});
const createDocumentSchema = zod_1.z.object({
    assetId: zod_1.z.string().uuid(),
    documentType: zod_1.z.enum(["REGISTRATION_CERTIFICATE", "INSURANCE", "PUC", "FASTAG", "SERVICE_RECORD", "IDENTITY", "OTHER"]),
    objectKey: zod_1.z.string().min(1),
    originalName: zod_1.z.string().min(1).max(255),
    fileSize: zod_1.z.number().int().positive(),
    mimeType: zod_1.z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
});
const documentIdSchema = zod_1.z.object({ documentId: zod_1.z.string().uuid() });
exports.documentRouter = (0, express_1.Router)();
exports.documentRouter.use(auth_1.authenticate);
exports.documentRouter.post("/upload-url", (0, validation_1.validate)(uploadUrlSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await document_service_1.documentService.getUploadUrl({ ...req.body, ownerId: req.user.id, ip: req.ip });
    res.json({ data: result });
}));
exports.documentRouter.post("/", (0, validation_1.validate)(createDocumentSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await document_service_1.documentService.createDocument({ ...req.body, ownerId: req.user.id, ip: req.ip });
    res.status(201).json({ data: result });
}));
exports.documentRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const assetId = req.query.assetId;
    res.json({ data: await document_service_1.documentService.listDocuments(req.user.id, assetId) });
}));
exports.documentRouter.get("/:documentId", (0, validation_1.validate)(documentIdSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { documentId } = req.params;
    res.json({ data: await document_service_1.documentService.getDocument(req.user.id, documentId) });
}));
exports.documentRouter.get("/:documentId/download", (0, validation_1.validate)(documentIdSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { documentId } = req.params;
    res.json({ data: await document_service_1.documentService.getDownloadUrl(documentId, req.user.id) });
}));
exports.documentRouter.delete("/:documentId", (0, validation_1.validate)(documentIdSchema, "params"), (0, auth_1.requirePermission)(permissions_1.Permission.DOCUMENTS_MANAGE_SELF), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { documentId } = req.params;
    await document_service_1.documentService.deleteDocument(req.user.id, documentId, req.ip);
    res.status(204).send();
}));
//# sourceMappingURL=document.routes.js.map