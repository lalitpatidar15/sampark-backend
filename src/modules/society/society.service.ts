import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";

const log = childLogger("society");

export const societyService = {
  async listSocieties() {
    return prisma.society.findMany({
      orderBy: { createdAt: "desc" },
      include: { buildings: true },
    });
  },

  async createSociety(input: {
    name: string;
    ownerId: string;
  }) {
    return prisma.society.create({
      data: {
        name: input.name,
        ownerId: input.ownerId,
      },
    });
  },

  async listResidents(input: { societyId?: string }) {
    if (input.societyId) {
      const buildings = await prisma.building.findMany({
        where: { societyId: input.societyId },
        select: { id: true },
      });
      const buildingIds = buildings.map((b) => b.id);
      const flats = await prisma.flat.findMany({
        where: { buildingId: { in: buildingIds } },
        select: { id: true },
      });
      const flatIds = flats.map((f) => f.id);
      return prisma.resident.findMany({
        where: { flatId: { in: flatIds } },
        include: { user: true, flat: true },
      });
    }
    return prisma.resident.findMany({
      include: { user: true, flat: true },
    });
  },
};
