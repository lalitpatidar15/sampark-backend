import { prisma } from "../../db/prisma";
import { sha256 } from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";
import { notFound, badRequest, conflict, forbidden } from "../../common/errors";

const log = childLogger("nfc");

/** Hash an NFC UID before persisting so a DB dump cannot be scanned for tags. */
function hashNfcUid(nfcUid: string): string {
  return sha256(`nfc:${nfcUid.trim()}`);
}

export const nfcService = {
  async linkNfc(tagId: string, ownerId: string, nfcUid: string, ip?: string) {
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw notFound("Tag not found");
    if (tag.ownerId !== ownerId) throw forbidden("Not your tag");

    const uidHash = hashNfcUid(nfcUid);

    // An NFC UID may only be bound to one tag.
    const existing = await prisma.tag.findFirst({ where: { nfcUidHash: uidHash } });
    if (existing && existing.id !== tagId) {
      throw conflict("This NFC UID is already bound to another tag");
    }

    const updated = await prisma.tag.update({
      where: { id: tagId },
      data: { nfcUidHash: uidHash },
    });

    await audit({
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

  async unlinkNfc(tagId: string, ownerId: string, ip?: string) {
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw notFound("Tag not found");
    if (tag.ownerId !== ownerId) throw forbidden("Not your tag");
    if (!tag.nfcUidHash) throw badRequest("Tag has no NFC UID linked");

    await prisma.tag.update({
      where: { id: tagId },
      data: { nfcUidHash: null },
    });

    await audit({
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

  async resolveNfc(nfcUid: string) {
    const uidHash = hashNfcUid(nfcUid);
    const tag = await prisma.tag.findFirst({
      where: { nfcUidHash: uidHash, status: "ACTIVE" },
      include: { asset: true, owner: { select: { publicId: true, role: true } } },
    });
    if (!tag) throw notFound("No active tag is bound to this NFC UID");

    return { tagId: tag.id, publicTagId: tag.publicTagId, tagType: tag.tagType, asset: tag.asset };
  },
};
