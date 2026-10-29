"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("analytics");
exports.analyticsService = {
    async listMetrics(input) {
        const days = input.days ?? 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return prisma_1.prisma.dailyMetric.findMany({
            where: {
                ...(input.metric ? { metric: input.metric } : {}),
                createdAt: { gte: since },
            },
            orderBy: { createdAt: "asc" },
        });
    },
    async rollup(input) {
        // Placeholder for analytics rollup worker
        return { date: input.date, status: "rolled_up" };
    },
};
//# sourceMappingURL=analytics.service.js.map