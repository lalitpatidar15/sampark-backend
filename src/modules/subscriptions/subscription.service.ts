import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";
import { SubscriptionStatus } from "@prisma/client";

const log = childLogger("subscriptions");

export const subscriptionService = {
  async listSubscriptions(input: { userId?: string }) {
    return prisma.subscription.findMany({
      where: input.userId ? { userId: input.userId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  },

  async createSubscription(input: {
    userId: string;
    planCode: string;
    status?: SubscriptionStatus;
  }) {
    return (prisma.subscription.create as any)({
      data: {
        userId: input.userId,
        planCode: input.planCode,
        status: (input.status || "ACTIVE") as SubscriptionStatus,
      },
    });
  },

  async updateSubscription(input: { id: string; data: any }) {
    return prisma.subscription.update({
      where: { id: input.id },
      data: input.data,
    });
  },

  async cancelSubscription(input: { id: string }) {
    return prisma.subscription.update({
      where: { id: input.id },
      data: { status: "CANCELLED", canceledAt: new Date() },
    });
  },
};
