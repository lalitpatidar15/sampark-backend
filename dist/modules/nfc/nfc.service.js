"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nfcService = void 0;
const prisma_1 = require("../../db/prisma");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const errors_1 = require("../../common/errors");
const log = (0, logger_1.childLogger)("nfc");
/** Hash an NFC UID before persisting so a DB dump cannot be scanned for tags. */
function hashNfcUid(nfcUid) {
    return (0, crypto_1.sha256)(`nfc:${nfcUid.trim()}`);
}
exports.nfcService = {
    async linkNfc(tagId, ownerId, nfcUid, ip) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id: tagId } });
        if (!tag)
            throw (0, errors_1.notFound)("Tag not found");
        if (tag.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your tag");
        const uidHash = hashNfcUid(nfcUid);
        // An NFC UID may only be bound to one tag.
        const existing = await prisma_1.prisma.tag.findFirst({ where: { nfcUidHash: uidHash } });
        if (existing && existing.id !== tagId) {
            throw (0, errors_1.conflict)("This NFC UID is already bound to another tag");
        }
        const updated = await prisma_1.prisma.tag.update({
            where: { id: tagId },
            data: { nfcUidHash: uidHash },
        });
        await (0, audit_service_1.audit)({
            actorUserId: ownerId,
            action: "nfc.link",
            resourceType: "tag",
            resourceId: tagId,
            ip,
            metadata: { nfcUidHash: uidHash },
        });
        log.info({ tagId, ownerId }, "NFC UID linked to tag");
        return updated;
    },
    async unlinkNfc(tagId, ownerId, ip) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id: tagId } });
        if (!tag)
            throw (0, errors_1.notFound)("Tag not found");
        if (tag.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your tag");
        if (!tag.nfcUidHash)
            throw (0, errors_1.badRequest)("Tag has no NFC UID linked");
        await prisma_1.prisma.tag.update({
            where: { id: tagId },
            data: { nfcUidHash: null },
        });
        await (0, audit_service_1.audit)({
            actorUserId: ownerId,
            action: "nfc.unlink",
            resourceType: "tag",
            resourceId: tagId,
            ip,
            metadata: { nfcUidHash: tag.nfcUidHash },
        });
        log.info({ tagId, ownerId }, "NFC UID unlinked from tag");
        return { unlinked: true };
    },
    async resolveNfc(nfcUid) {
        const uidHash = hashNfcUid(nfcUid);
        const tag = await prisma_1.prisma.tag.findFirst({
            where: { nfcUidHash: uidHash, status: "ACTIVE" },
            include: { asset: true, owner: { select: { publicId: true, role: true } } },
        });
        if (!tag)
            throw (0, errors_1.notFound)("No active tag is bound to this NFC UID");
        return { tagId: tag.id, publicTagId: tag.publicTagId, tagType: tag.tagType, asset: tag.asset };
    },
};
//# sourceMappingURL=nfc.service.js.map