"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("devices");
exports.deviceService = {
    async listDevices(input) {
        return prisma_1.prisma.device.findMany({
            where: input.userId ? { userId: input.userId } : undefined,
            orderBy: { lastSeenAt: "desc" },
        });
    },
    async createDevice(input) {
        return prisma_1.prisma.device.create({
            data: {
                userId: input.userId,
                devicePublicId: input.devicePublicId,
                platform: input.platform,
                pushTokenEncrypted: input.pushToken,
            },
        });
    },
    async updateDevice(input) {
        return prisma_1.prisma.device.update({ where: { id: input.id }, data: input.data });
    },
    async deleteDevice(input) {
        return prisma_1.prisma.device.delete({ where: { id: input.id } });
    },
};
//# sourceMappingURL=device.service.js.map