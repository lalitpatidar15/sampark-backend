"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.societyService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("society");
exports.societyService = {
    async listSocieties() {
        return prisma_1.prisma.society.findMany({
            orderBy: { createdAt: "desc" },
            include: { buildings: true },
        });
    },
    async createSociety(input) {
        return prisma_1.prisma.society.create({
            data: {
                name: input.name,
                ownerId: input.ownerId,
            },
        });
    },
    async listResidents(input) {
        if (input.societyId) {
            const buildings = await prisma_1.prisma.building.findMany({
                where: { societyId: input.societyId },
                select: { id: true },
            });
            const buildingIds = buildings.map((b) => b.id);
            const flats = await prisma_1.prisma.flat.findMany({
                where: { buildingId: { in: buildingIds } },
                select: { id: true },
            });
            const flatIds = flats.map((f) => f.id);
            return prisma_1.prisma.resident.findMany({
                where: { flatId: { in: flatIds } },
                include: { user: true, flat: true },
            });
        }
        return prisma_1.prisma.resident.findMany({
            include: { user: true, flat: true },
        });
    },
};
//# sourceMappingURL=society.service.js.map