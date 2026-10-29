"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.qrSizeService = void 0;
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../../common/errors");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const log = (0, logger_1.childLogger)("qr-sizes");
exports.qrSizeService = {
    async list() {
        return prisma_1.prisma.qrSizeConfig.findMany({
            orderBy: { sortOrder: "asc" },
        });
    },
    async getActive() {
        return prisma_1.prisma.qrSizeConfig.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
        });
    },
    async getById(id) {
        const size = await prisma_1.prisma.qrSizeConfig.findUnique({ where: { id } });
        if (!size)
            throw (0, errors_1.notFound)("QR size config not found");
        return size;
    },
    async create(input) {
        const existing = await prisma_1.prisma.qrSizeConfig.findUnique({ where: { size: input.size } });
        if (existing)
            throw new Error("QR size already exists");
        const created = await prisma_1.prisma.qrSizeConfig.create({
            data: {
                size: input.size,
                label: input.label,
                isActive: input.isActive ?? true,
                sortOrder: input.sortOrder ?? 0,
                description: input.description,
            },
        });
        await (0, audit_service_1.audit)({
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
    async update(input) {
        const existing = await prisma_1.prisma.qrSizeConfig.findUnique({ where: { id: input.id } });
        if (!existing)
            throw (0, errors_1.notFound)("QR size config not found");
        const updated = await prisma_1.prisma.qrSizeConfig.update({
            where: { id: input.id },
            data: input.patch,
        });
        await (0, audit_service_1.audit)({
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
    async delete(input) {
        const existing = await prisma_1.prisma.qrSizeConfig.findUnique({ where: { id: input.id } });
        if (!existing)
            throw (0, errors_1.notFound)("QR size config not found");
        await prisma_1.prisma.qrSizeConfig.delete({ where: { id: input.id } });
        await (0, audit_service_1.audit)({
            actorUserId: input.actorUserId,
            action: "qr_size.delete",
            resourceType: "qr_size_config",
            resourceId: input.id,
            ip: input.ip,
            metadata: { size: existing.size, label: existing.label },
        });
        log.info({ qrSizeId: input.id }, "QR size deleted");
    },
    async getSizesForTag(tagId, ownerId) {
        // Get all active QR sizes, sorted by sortOrder
        return this.getActive();
    },
};
//# sourceMappingURL=qr-size.service.js.map