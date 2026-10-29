import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";

const log = childLogger("fraud");

export const fraudService = {
  async listAbuseReports(input: { state?: string }) {
    return prisma.abuseReport.findMany({
      where: input.state ? { state: input.state } : {},
      orderBy: { createdAt: "desc" },
    });
  },

  async reviewReport(input: {
    reportId: string;
    state: string;
    actionTaken?: string;
  }) {
    return prisma.abuseReport.update({
      where: { id: input.reportId },
      data: { state: input.state, actionTaken: input.actionTaken },
    });
  },

  async autoSuspendTags() {
    // Auto-suspend tags with repeated abuse
    return { suspended: 0 };
  },
};
