import { prisma } from "../../db/prisma";
import { notFound } from "../../common/errors";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";

const log = childLogger("qr-sizes");

export const qrSizeService = {
  async list() {
    return prisma.qrSizeConfig.findMany({
      orderBy: { sortOrder: "asc" },
    });
  },

  async getActive() {
    return prisma.qrSizeConfig.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  },

  async getById(id: string) {
    const size = await prisma.qrSizeConfig.findUnique({ where: { id } });
    if (!size) throw notFound("QR size config not found");
    return size;
  },

  async create(input: {
    size: number;
    label: string;
    isActive?: boolean;
    sortOrder?: number;
    description?: string;
    actorUserId: string;
    ip?: string;
  }) {
    const existing = await prisma.qrSizeConfig.findUnique({ where: { size: input.size } });
    if (existing) throw new Error("QR size already exists");

    const created = await prisma.qrSizeConfig.create({
      data: {
        size: input.size,
        label: input.label,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        description: input.description,
      },
    });

    await audit({
      actorUserId: input.actorUserId,
      action: "qr_size.create",
      resourceType: "qr_size_config",
      resourceId: created.id,
      ip: input.ip,
      metadata: { size: input.size, label: input.label },
    });

    log.info({ qrSizeId: created.id, size: created.size }, "QR size created");
    return created;
  },

  async update(input: {
    id: string;
    patch: Partial<{ label: string; isActive: boolean; sortOrder: number; description: string }>;
    actorUserId: string;
    ip?: string;
  }) {
    const existing = await prisma.qrSizeConfig.findUnique({ where: { id: input.id } });
    if (!existing) throw notFound("QR size config not found");

    const updated = await prisma.qrSizeConfig.update({
      where: { id: input.id },
      data: input.patch,
    });

    await audit({
      actorUserId: input.actorUserId,
      action: "qr_size.update",
      resourceType: "qr_size_config",
      resourceId: input.id,
      ip: input.ip,
      metadata: { patch: input.patch },
    });

    log.info({ qrSizeId: input.id }, "QR size updated");
    return updated;
  },

  async delete(input: { id: string; actorUserId: string; ip?: string }) {
    const existing = await prisma.qrSizeConfig.findUnique({ where: { id: input.id } });
    if (!existing) throw notFound("QR size config not found");

    await prisma.qrSizeConfig.delete({ where: { id: input.id } });

    await audit({
      actorUserId: input.actorUserId,
      action: "qr_size.delete",
      resourceType: "qr_size_config",
      resourceId: input.id,
      ip: input.ip,
      metadata: { size: existing.size, label: existing.label },
    });

    log.info({ qrSizeId: input.id }, "QR size deleted");
  },

  async getSizesForTag(tagId: string, ownerId: string) {
    // Get all active QR sizes, sorted by sortOrder
    return this.getActive();
  },
};