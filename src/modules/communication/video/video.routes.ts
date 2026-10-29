import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../../common/middleware/auth";
import { validate } from "../../../common/validation";
import { asyncHandler } from "../../../common/utils/asyncHandler";
import { videoService } from "./video.service";

const createVideoSchema = z.object({
  scannerSessionId: z.string().uuid(),
  reasonCode: z.string().min(1),
});

const joinRoomSchema = z.object({
  roomId: z.string().min(1),
  roomToken: z.string().min(1),
});

export const videoRouter = Router();

videoRouter.post(
  "/create",
  authenticate,
  validate(createVideoSchema),
  asyncHandler(async (req, res) => {
    const { scannerSessionId, reasonCode } = req.body as z.infer<typeof createVideoSchema>;
    const result = await videoService.createVideoSession({
      scannerSessionId,
      ownerId: req.user!.id,
      tagId: req.body.tagId, // This should come from the scanner session
      reasonCode,
      ip: req.ip,
    });
    res.json({ data: result });
  }),
);

videoRouter.post(
  "/join",
  validate(joinRoomSchema),
  asyncHandler(async (req, res) => {
    const { roomId, roomToken } = req.body as z.infer<typeof joinRoomSchema>;
    const isOwner = Boolean(req.headers["x-owner-token"]);
    const userId = isOwner ? req.headers["x-user-id"] as string : req.headers["x-scanner-session"] as string;

    if (!userId) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing identity" } });
    }

    const result = await videoService.joinRoom({ roomId, roomToken, userId, isOwner });
    res.json({ data: result });
  }),
);

videoRouter.post(
  "/leave",
  asyncHandler(async (req, res) => {
    const { roomId } = req.body as { roomId: string };
    const userId = req.headers["x-user-id"] as string || req.headers["x-scanner-session"] as string;
    if (!userId) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing identity" } });
    }
    await videoService.leaveRoom({ roomId, userId });
    res.status(204).send();
  }),
);