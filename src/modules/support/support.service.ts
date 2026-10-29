import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";

const log = childLogger("support");

export const supportService = {
  async listSupportTickets(input: { userId?: string; status?: string }) {
    return prisma.supportTicket.findMany({
      where: {
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async createSupportTicket(input: {
    userId: string;
    category: string;
    priority: string;
    subject: string;
    body?: string;
  }) {
    return prisma.supportTicket.create({
      data: {
        userId: input.userId,
        category: input.category,
        priority: input.priority,
        subject: input.subject,
        body: input.body || "",
      },
    });
  },

  async updateTicket(input: { id: string; data: any }) {
    return prisma.supportTicket.update({
      where: { id: input.id },
      data: input.data,
    });
  },
};
