"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nfcPublicRouter = exports.nfcOwnerRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const crypto_1 = require("../../common/utils/crypto");
const prisma_1 = require("../../db/prisma");
const nfc_service_1 = require("./nfc.service");
const uidParam = zod_1.z.object({ uid: zod_1.z.string().min(1) });
const linkBody = zod_1.z.object({ nfcUid: zod_1.z.string().min(4) });
/** Owner-authenticated NFC binding routes. Mounted under /tags. */
exports.nfcOwnerRouter = (0, express_1.Router)();
exports.nfcOwnerRouter.use(auth_1.authenticate);
exports.nfcOwnerRouter.post("/:tagId/nfc", (0, validation_1.validate)(zod_1.z.object({ tagId: zod_1.z.string().uuid() }), "params"), (0, validation_1.validate)(linkBody), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const updated = await nfc_service_1.nfcService.linkNfc(req.params.tagId, req.user.id, req.body.nfcUid, req.ip);
    res.json({ data: updated });
}));
exports.nfcOwnerRouter.delete("/:tagId/nfc", (0, validation_1.validate)(zod_1.z.object({ tagId: zod_1.z.string().uuid() }), "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await nfc_service_1.nfcService.unlinkNfc(req.params.tagId, req.user.id, req.ip);
    res.status(204).send();
}));
/** Public NFC resolve route. Mounted under /s/nfc. No account required. */
exports.nfcPublicRouter = (0, express_1.Router)();
exports.nfcPublicRouter.get("/:uid", (0, validation_1.validate)(uidParam, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const resolved = await nfc_service_1.nfcService.resolveNfc(req.params.uid);
    // Re-fetch the tag to decrypt its public token so an NFC tap can open the
    // tag's public page at /t/{publicToken}.
    const tag = await prisma_1.prisma.tag.findUnique({ where: { id: resolved.tagId } });
    const publicToken = tag?.publicTokenEncrypted
        ? (0, crypto_1.decryptField)(tag.publicTokenEncrypted, "tag_token")
        : undefined;
    res.json({ data: { ...resolved, publicToken } });
}));
//# sourceMappingURL=nfc.routes.js.map