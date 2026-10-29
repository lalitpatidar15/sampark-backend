"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("assets");
exports.assetService = {
    async listAssets(input) {
        return prisma_1.prisma.asset.findMany({
            where: input.ownerId ? { ownerId: input.ownerId } : {},
            orderBy: { createdAt: "desc" },
            include: { vehicle: true, tags: true },
        });
    },
    async createAsset(input) {
        return prisma_1.prisma.asset.create({
            data: {
                ownerId: input.ownerId,
                assetType: input.assetType,
                displayName: input.displayName,
                status: input.status || "ACTIVE",
            },
        });
    },
    async updateAsset(input) {
        return prisma_1.prisma.asset.update({
            where: { id: input.id },
            data: input.data,
        });
    },
    async deleteAsset(input) {
        return prisma_1.prisma.asset.delete({ where: { id: input.id } });
    },
};
//# sourceMappingURL=assets.service.js.map