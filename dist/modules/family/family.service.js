"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.familyService = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("family");
exports.familyService = {
    async listFamilyMembers(input) {
        return prisma_1.prisma.familyMember.findMany({
            where: input.ownerId ? { ownerId: input.ownerId } : {},
            orderBy: { createdAt: "desc" },
        });
    },
    async createFamilyMember(input) {
        return prisma_1.prisma.familyMember.create({
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
    async updateFamilyMember(input) {
        return prisma_1.prisma.familyMember.update({
            where: { id: input.id },
            data: input.data,
        });
    },
    async deleteFamilyMember(input) {
        return prisma_1.prisma.familyMember.delete({ where: { id: input.id } });
    },
};
//# sourceMappingURL=family.service.js.map