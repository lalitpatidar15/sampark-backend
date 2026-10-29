"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fraudService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("fraud");
exports.fraudService = {
    async listAbuseReports(input) {
        return prisma_1.prisma.abuseReport.findMany({
            where: input.state ? { state: input.state } : {},
            orderBy: { createdAt: "desc" },
        });
    },
    async reviewReport(input) {
        return prisma_1.prisma.abuseReport.update({
            where: { id: input.reportId },
            data: { state: input.state, actionTaken: input.actionTaken },
        });
    },
    async autoSuspendTags() {
        // Auto-suspend tags with repeated abuse
        return { suspended: 0 };
    },
};
//# sourceMappingURL=fraud.service.js.map