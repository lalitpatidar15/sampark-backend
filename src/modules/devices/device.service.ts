import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";

const log = childLogger("devices");

export const deviceService = {
  async listDevices(input: { userId?: string }) {
    return prisma.device.findMany({
      where: input.userId ? { userId: input.userId } : undefined,
      orderBy: { lastSeenAt: "desc" },
    });
  },

  async createDevice(input: {
    userId: string;
    devicePublicId: string;
    platform: string;
    pushToken?: string;
  }) {
    return prisma.device.create({
      data: {
        userId: input.userId,
        devicePublicId: input.devicePublicId,
        platform: input.platform,
        pushTokenEncrypted: input.pushToken,
      },
    });
  },

  async updateDevice(input: { id: string; data: any }) {
    return prisma.device.update({ where: { id: input.id }, data: input.data });
  },

  async deleteDevice(input: { id: string }) {
    return prisma.device.delete({ where: { id: input.id } });
  },
};
