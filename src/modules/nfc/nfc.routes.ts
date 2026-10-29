import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { decryptField } from "../../common/utils/crypto";
import { prisma } from "../../db/prisma";
import { nfcService } from "./nfc.service";

const uidParam = z.object({ uid: z.string().min(1) });
const linkBody = z.object({ nfcUid: z.string().min(4) });

/** Owner-authenticated NFC binding routes. Mounted under /tags. */
export const nfcOwnerRouter = Router();
nfcOwnerRouter.use(authenticate);

nfcOwnerRouter.post(
  "/:tagId/nfc",
  validate(z.object({ tagId: z.string().uuid() }), "params"),
  validate(linkBody),
  asyncHandler(async (req, res) => {
    const updated = await nfcService.linkNfc(
      req.params.tagId,
      req.user!.id,
      req.body.nfcUid,
      req.ip,
    );
    res.json({ data: updated });
  }),
);

nfcOwnerRouter.delete(
  "/:tagId/nfc",
  validate(z.object({ tagId: z.string().uuid() }), "params"),
  asyncHandler(async (req, res) => {
    await nfcService.unlinkNfc(req.params.tagId, req.user!.id, req.ip);
    res.status(204).send();
  }),
);

/** Public NFC resolve route. Mounted under /s/nfc. No account required. */
export const nfcPublicRouter = Router();

nfcPublicRouter.get(
  "/:uid",
  validate(uidParam, "params"),
  asyncHandler(async (req, res) => {
    const resolved = await nfcService.resolveNfc(req.params.uid);

    // Re-fetch the tag to decrypt its public token so an NFC tap can open the
    // tag's public page at /t/{publicToken}.
    const tag = await prisma.tag.findUnique({ where: { id: resolved.tagId } });
    const publicToken = tag?.publicTokenEncrypted
      ? decryptField(tag.publicTokenEncrypted, "tag_token")
      : undefined;

    res.json({ data: { ...resolved, publicToken } });
  }),
);
