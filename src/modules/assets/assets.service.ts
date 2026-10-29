import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";
import { AssetType } from "@prisma/client";

const log = childLogger("assets");

export const assetService = {
  async listAssets(input: { ownerId?: string }) {
    return prisma.asset.findMany({
      where: input.ownerId ? { ownerId: input.ownerId } : {},
      orderBy: { createdAt: "desc" },
      include: { vehicle: true, tags: true },
    });
  },

  async createAsset(input: {
    ownerId: string;
    assetType: AssetType;
    displayName: string;
    status?: string;
  }) {
    return prisma.asset.create({
      data: {
        ownerId: input.ownerId,
        assetType: input.assetType,
        displayName: input.displayName,
        status: input.status || "ACTIVE",
      },
    });
  },

  async updateAsset(input: { id: string; ownerId: string; data: any }) {
    return prisma.asset.update({
      where: { id: input.id },
      data: input.data,
    });
  },

  async deleteAsset(input: { id: string }) {
    return prisma.asset.delete({ where: { id: input.id } });
  },
};
