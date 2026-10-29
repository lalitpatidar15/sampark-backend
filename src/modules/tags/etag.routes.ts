import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { etagService } from "./etag.service";

const generateETagSchema = z.object({
  tagId: z.string().uuid(),
  format: z.enum(["html", "pdf", "png"]).default("html"),
});

const sendETagSchema = z.object({
  tagId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]),
  recipient: z.string().min(1),
  format: z.enum(["html", "pdf", "png"]).default("html"),
});

export const etagRouter = Router();

etagRouter.use(authenticate);

etagRouter.post(
  "/generate",
  validate(generateETagSchema),
  asyncHandler(async (req, res) => {
    const { tagId, format } = req.body as z.infer<typeof generateETagSchema>;
    const result = await etagService.generateETagForOwner({
      ownerId: req.user!.id,
      tagId,
      format,
      ip: req.ip,
    });
    res.json({ data: result });
  }),
);

etagRouter.post(
  "/send",
  validate(sendETagSchema),
  asyncHandler(async (req, res) => {
    const { tagId, channel, recipient, format } = req.body as z.infer<typeof sendETagSchema>;
    
    if (channel === "email") {
      await etagService.sendETagViaEmail({
        ownerId: req.user!.id,
        tagId,
        email: recipient,
        format,
        ip: req.ip,
      });
    } else if (channel === "whatsapp") {
      await etagService.sendETagViaWhatsApp({
        ownerId: req.user!.id,
        tagId,
        phone: recipient,
        format,
        ip: req.ip,
      });
    }

    res.json({ data: { sent: true, channel, recipient } });
  }),
);