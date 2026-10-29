"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentService = void 0;
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const providers_1 = require("../../providers");
const log = (0, logger_1.childLogger)("documents");
exports.documentService = {
    async getUploadUrl(input) {
        const asset = await prisma_1.prisma.asset.findUnique({ where: { id: input.assetId } });
        if (!asset)
            throw (0, errors_1.notFound)("Asset not found");
        if (asset.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("Not your asset");
        if (input.fileSize > 10 * 1024 * 1024) {
            throw (0, errors_1.badRequest)("File size must be less than 10MB");
        }
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
        if (!allowedTypes.includes(input.contentType)) {
            throw (0, errors_1.badRequest)("Only PDF, JPEG, PNG, and WebP files are allowed");
        }
        const objectKey = `documents/${input.ownerId}/${input.assetId}/${(0, crypto_1.randomToken)(16)}-${input.fileName}`;
        const signed = await providers_1.storageProvider.createSignedUploadUrl({
            objectKey,
            contentType: input.contentType,
            contentLength: input.fileSize,
            ttlSeconds: 15 * 60,
        });
        return { uploadUrl: signed.uploadUrl, objectKey, method: signed.method, headers: signed.headers };
    },
    async createDocument(input) {
        const asset = await prisma_1.prisma.asset.findUnique({ where: { id: input.assetId } });
        if (!asset)
            throw (0, errors_1.notFound)("Asset not found");
        if (asset.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("Not your asset");
        const document = await prisma_1.prisma.document.create({
            data: {
                ownerId: input.ownerId,
                assetId: input.assetId,
                documentType: input.documentType,
                objectKey: input.objectKey,
                checksum: "", // Will be computed by virus scan worker
                status: "PENDING_SCAN",
            },
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "document.upload",
            resourceType: "document",
            resourceId: document.id,
            ip: input.ip,
            metadata: { documentType: input.documentType, fileName: input.originalName },
        });
        log.info({ documentId: document.id, ownerId: input.ownerId }, "document uploaded, pending scan");
        return document;
    },
    async listDocuments(ownerId, assetId) {
        return prisma_1.prisma.document.findMany({
            where: { ownerId, ...(assetId ? { assetId } : {}) },
            orderBy: { createdAt: "desc" },
            include: { asset: { select: { id: true, displayName: true, assetType: true } } },
        });
    },
    async getDocument(ownerId, documentId) {
        const document = await prisma_1.prisma.document.findUnique({ where: { id: documentId } });
        if (!document)
            throw (0, errors_1.notFound)("Document not found");
        if (document.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your document");
        return document;
    },
    async getDownloadUrl(documentId, ownerId) {
        const document = await this.getDocument(ownerId, documentId);
        if (document.status !== "AVAILABLE")
            throw (0, errors_1.badRequest)("Document is not available for download");
        const downloadUrl = await providers_1.storageProvider.createSignedDownloadUrl({ objectKey: document.objectKey, ttlSeconds: 60 * 60 });
        const fileName = document.objectKey.split("/").pop() || "document";
        return { downloadUrl, fileName };
    },
    async deleteDocument(ownerId, documentId, ip) {
        const document = await this.getDocument(ownerId, documentId);
        await providers_1.storageProvider.deleteObject(document.objectKey);
        await prisma_1.prisma.document.delete({ where: { id: documentId } });
        await (0, audit_service_1.audit)({
            actorUserId: ownerId,
            action: "document.delete",
            resourceType: "document",
            resourceId: documentId,
            ip,
        });
    },
};
//# sourceMappingURL=document.service.js.map