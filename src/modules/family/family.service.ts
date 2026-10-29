import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";
import { FamilyPermission } from "@prisma/client";

const log = childLogger("family");

export const familyService = {
  async listFamilyMembers(input: { ownerId?: string }) {
    return prisma.familyMember.findMany({
      where: input.ownerId ? { ownerId: input.ownerId } : {},
      orderBy: { createdAt: "desc" },
    });
  },

  async createFamilyMember(input: {
    ownerId: string;
    name: string;
    relationship: string;
    phone: string;
    linkedUserId?: string;
    permissions?: FamilyPermission[];
  }) {
    return prisma.familyMember.create({
      data: {
        ownerId: input.ownerId,
        nameEncrypted: input.name,
        relationshipEncrypted: input.relationship,
        phoneEncrypted: input.phone,
        linkedUserId: input.linkedUserId,
        permissions: input.permissions || ["VIEW"],
      },
    });
  },

  async updateFamilyMember(input: { id: string; data: any }) {
    return prisma.familyMember.update({
      where: { id: input.id },
      data: input.data,
    });
  },

  async deleteFamilyMember(input: { id: string }) {
    return prisma.familyMember.delete({ where: { id: input.id } });
  },
};
