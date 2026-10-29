"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("support");
exports.supportService = {
    async listSupportTickets(input) {
        return prisma_1.prisma.supportTicket.findMany({
            where: {
                ...(input.userId ? { userId: input.userId } : {}),
                ...(input.status ? { status: input.status } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
    },
    async createSupportTicket(input) {
        return prisma_1.prisma.supportTicket.create({
            data: {
                userId: input.userId,
                category: input.category,
                priority: input.priority,
                subject: input.subject,
                body: input.body || "",
            },
        });
    },
    async updateTicket(input) {
        return prisma_1.prisma.supportTicket.update({
            where: { id: input.id },
            data: input.data,
        });
    },
};
//# sourceMappingURL=support.service.js.map