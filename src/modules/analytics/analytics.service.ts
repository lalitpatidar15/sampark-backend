import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";

const log = childLogger("analytics");

export const analyticsService = {
  async listMetrics(input: { days?: number; metric?: string }) {
    const days = input.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return prisma.dailyMetric.findMany({
      where: {
        ...(input.metric ? { metric: input.metric } : {}),
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  async rollup(input: { date: string }) {
    // Placeholder for analytics rollup worker
    return { date: input.date, status: "rolled_up" };
  },
};
