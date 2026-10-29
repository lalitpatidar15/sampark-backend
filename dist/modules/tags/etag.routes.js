"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.etagRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const etag_service_1 = require("./etag.service");
const generateETagSchema = zod_1.z.object({
    tagId: zod_1.z.string().uuid(),
    format: zod_1.z.enum(["html", "pdf", "png"]).default("html"),
});
const sendETagSchema = zod_1.z.object({
    tagId: zod_1.z.string().uuid(),
    channel: zod_1.z.enum(["email", "whatsapp"]),
    recipient: zod_1.z.string().min(1),
    format: zod_1.z.enum(["html", "pdf", "png"]).default("html"),
});
exports.etagRouter = (0, express_1.Router)();
exports.etagRouter.use(auth_1.authenticate);
exports.etagRouter.post("/generate", (0, validation_1.validate)(generateETagSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { tagId, format } = req.body;
    const result = await etag_service_1.etagService.generateETagForOwner({
        ownerId: req.user.id,
        tagId,
        format,
        ip: req.ip,
    });
    res.json({ data: result });
}));
exports.etagRouter.post("/send", (0, validation_1.validate)(sendETagSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { tagId, channel, recipient, format } = req.body;
    if (channel === "email") {
        await etag_service_1.etagService.sendETagViaEmail({
            ownerId: req.user.id,
            tagId,
            email: recipient,
            format,
            ip: req.ip,
        });
    }
    else if (channel === "whatsapp") {
        await etag_service_1.etagService.sendETagViaWhatsApp({
            ownerId: req.user.id,
            tagId,
            phone: recipient,
            format,
            ip: req.ip,
        });
    }
    res.json({ data: { sent: true, channel, recipient } });
}));
//# sourceMappingURL=etag.routes.js.map