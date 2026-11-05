import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { badRequest } from "../../common/errors";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { scannerLimiter } from "../../common/middleware/rateLimit";
import { Permission } from "../../common/guards/permissions";
import { communicationService } from "./communication.service";
import { emergencyService } from "../emergency/emergency.service";

const sessionParamSchema = z.object({ sessionId: z.string().min(8).max(64) });
const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export const communicationRouter = Router();

// ---------------------------------------------------------------------------
// Owner-facing: incoming contacts and replies
// ---------------------------------------------------------------------------

communicationRouter.use(authenticate);

communicationRouter.get(
  "/sessions",
  requirePermission(Permission.COMMUNICATIONS_RECEIVE),
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    res.json({ data: await communicationService.listForOwner(req.user!.id, limit) });
  }),
);

communicationRouter.get(
  "/sessions/:sessionId/messages",
  requirePermission(Permission.COMMUNICATIONS_RECEIVE),
  validate(sessionParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params as unknown as z.infer<typeof sessionParamSchema>;
    res.json({
      data: await communicationService.messages({
        communicationSessionId: sessionId,
        actor: "OWNER",
        ownerId: req.user!.id,
      }),
    });
  }),
);

communicationRouter.post(
  "/sessions/:sessionId/reply",
  requirePermission(Permission.COMMUNICATIONS_REPLY),
  validate(messageSchema),
  validate(sessionParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params as unknown as z.infer<typeof sessionParamSchema>;
    const { body } = req.body as z.infer<typeof messageSchema>;
    res.status(201).json({
      data: await communicationService.reply({ ownerId: req.user!.id, communicationSessionId: sessionId, body }),
    });
  }),
);

communicationRouter.get(
  "/emergency-alerts",
  requirePermission(Permission.COMMUNICATIONS_RECEIVE),
  asyncHandler(async (req, res) => {
    res.json({ data: await emergencyService.listForOwner(req.user!.id) });
  }),
);

communicationRouter.post(
  "/emergency-alerts/:alertId/resolve",
  requirePermission(Permission.COMMUNICATIONS_RECEIVE),
  validate(z.object({ alertId: z.string().uuid() }), "params"),
  asyncHandler(async (req, res) => {
    const { alertId } = req.params as unknown as { alertId: string };
    res.json({ data: await emergencyService.resolve(alertId, req.user!.id) });
  }),
);

// ---------------------------------------------------------------------------
// Scanner-facing: transcript polling for an in-progress conversation
//
// The scanner session token travels in a header, never in the URL, so it is not
// captured in access logs, browser history or Referer headers.
// ---------------------------------------------------------------------------

export const scannerChatRouter = Router();
scannerChatRouter.use(scannerLimiter);

const scannerSessionToken = (req: Request): string => {
  const token = req.header("x-scanner-session");
  if (!token) throw badRequest("Missing x-scanner-session header");
  return token;
};

scannerChatRouter.get(
  "/sessions/:sessionId/messages",
  validate(sessionParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params as unknown as z.infer<typeof sessionParamSchema>;
    res.json({
      data: await communicationService.messages({
        communicationSessionId: sessionId,
        actor: "SCANNER",
        sessionToken: scannerSessionToken(req),
      }),
    });
  }),
);

scannerChatRouter.post(
  "/sessions/:sessionId/messages",
  validate(sessionParamSchema, "params"),
  validate(z.object({ body: z.string().trim().min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params as unknown as z.infer<typeof sessionParamSchema>;
    const { body } = req.body as { body: string };
    res.status(201).json({
      data: await communicationService.sendFromScanner({
        sessionToken: scannerSessionToken(req),
        communicationSessionId: sessionId,
        body,
      }),
    });
  }),
);
