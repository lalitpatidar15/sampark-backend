import { prisma } from "../../db/prisma";
import { env } from "../../config";
import { badRequest, forbidden, notFound } from "../../common/errors";
import { randomToken } from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";
import { storageProvider } from "../../providers";

const log = childLogger("documents");

export const documentService = {
  async getUploadUrl(input: {
    ownerId: string;
    assetId: string;
    documentType: string;
    fileName: string;
    contentType: string;
    fileSize: number;
  }) {
    const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw notFound("Asset not found");
    if (asset.ownerId !== input.ownerId) throw forbidden("Not your asset");

    if (input.fileSize > 10 * 1024 * 1024) {
      throw badRequest("File size must be less than 10MB");
    }

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(input.contentType)) {
      throw badRequest("Only PDF, JPEG, PNG, and WebP files are allowed");
    }

    const objectKey = `documents/${input.ownerId}/${input.assetId}/${randomToken(16)}-${input.fileName}`;

    const signed = await storageProvider.createSignedUploadUrl({
      objectKey,
      contentType: input.contentType,
      contentLength: input.fileSize,
      ttlSeconds: 15 * 60,
    });

    return { uploadUrl: signed.uploadUrl, objectKey, method: signed.method, headers: signed.headers };
  },

  async createDocument(input: {
    ownerId: string;
    assetId: string;
    documentType: string;
    objectKey: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    ip?: string;
  }) {
    const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw notFound("Asset not found");
    if (asset.ownerId !== input.ownerId) throw forbidden("Not your asset");

    const document = await prisma.document.create({
      data: {
        ownerId: input.ownerId,
        assetId: input.assetId,
        documentType: input.documentType as any,
        objectKey: input.objectKey,
        checksum: "", // Will be computed by virus scan worker
        status: "PENDING_SCAN",
      },
    });

    await audit({
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

  async listDocuments(ownerId: string, assetId?: string) {
    return prisma.document.findMany({
      where: { ownerId, ...(assetId ? { assetId } : {}) },
      orderBy: { createdAt: "desc" },
      include: { asset: { select: { id: true, displayName: true, assetType: true } } },
    });
  },

  async getDocument(ownerId: string, documentId: string) {
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw notFound("Document not found");
    if (document.ownerId !== ownerId) throw forbidden("Not your document");
    return document;
  },

  async getDownloadUrl(documentId: string, ownerId: string) {
    const document = await this.getDocument(ownerId, documentId);
    if (document.status !== "AVAILABLE") throw badRequest("Document is not available for download");
    const downloadUrl = await storageProvider.createSignedDownloadUrl({ objectKey: document.objectKey, ttlSeconds: 60 * 60 });
    const fileName = document.objectKey.split("/").pop() || "document";
    return { downloadUrl, fileName };
  },

  async deleteDocument(ownerId: string, documentId: string, ip?: string) {
    const document = await this.getDocument(ownerId, documentId);
    await storageProvider.deleteObject(document.objectKey);
    await prisma.document.delete({ where: { id: documentId } });
    await audit({
      actorUserId: ownerId,
      action: "document.delete",
      resourceType: "document",
      resourceId: documentId,
      ip,
    });
  },
};