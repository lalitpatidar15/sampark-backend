"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("subscriptions");
exports.subscriptionService = {
    async listSubscriptions(input) {
        return prisma_1.prisma.subscription.findMany({
            where: input.userId ? { userId: input.userId } : undefined,
            orderBy: { createdAt: "desc" },
        });
    },
    async createSubscription(input) {
        return prisma_1.prisma.subscription.create({
            data: {
                userId: input.userId,
                planCode: input.planCode,
                status: (input.status || "ACTIVE"),
            },
        });
    },
    async updateSubscription(input) {
        return prisma_1.prisma.subscription.update({
            where: { id: input.id },
            data: input.data,
        });
    },
    async cancelSubscription(input) {
        return prisma_1.prisma.subscription.update({
            where: { id: input.id },
            data: { status: "CANCELLED", canceledAt: new Date() },
        });
    },
};
//# sourceMappingURL=subscription.service.js.map