import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { scannerLimiter } from "../../common/middleware/rateLimit";
import { scannerService } from "./scanner.service";
import { communicationService } from "../communication/communication.service";
import { requestOtp } from "../auth/otp.service";

const publicTokenSchema = z.object({
  publicToken: z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9]+$/, "Invalid tag code"),
});

const sessionBodySchema = z.object({
  sessionToken: z.string().min(20),
});

const reasonSchema = sessionBodySchema.extend({
  reasonCode: z.string().trim().min(2).max(48),
});

const verifySchema = sessionBodySchema.extend({
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  code: z.string().trim().regex(/^\d{6}$/),
});

export const scannerRouter = Router();

// Every public scanner operation is rate limited (spec 32.2).
scannerRouter.use(scannerLimiter);

/**
 * STEP 1 — the visitor scans. No account, no app, no OTP for a low-risk read.
 * The response is the masked display projection only.
 */
scannerRouter.get(
  "/tags/:publicToken",
  validate(publicTokenSchema, "params"),
  asyncHandler(async (req, res) => {
    const { publicToken } = req.params as unknown as z.infer<typeof publicTokenSchema>;
    const { view, scannerSession } = await scannerService.resolveTag({
      publicToken,
      ip: req.ip,
      userAgent: req.header("user-agent") ?? undefined,
    });
    res.json({
      data: { view, session: scannerSession },
    });
  }),
);

/** STEP 2 — the visitor picks why they are making contact. */
scannerRouter.post(
  "/session/reason",
  validate(reasonSchema),
  asyncHandler(async (req, res) => {
    const { sessionToken, reasonCode } = req.body as z.infer<typeof reasonSchema>;
    res.json({ data: await scannerService.setReason(sessionToken, reasonCode) });
  }),
);

/** STEP 2b — optional phone verification before a higher-risk action. */
scannerRouter.post(
  "/session/verify",
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof verifySchema>;
    res.json({ data: await scannerService.verifyScannerPhone(body) });
  }),
);

/** Request an OTP for scanner verification (spec 7.3). */
scannerRouter.post(
  "/session/verify/request",
  validate(z.object({ sessionToken: z.string().min(20), phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/) })),
  asyncHandler(async (req, res) => {
    const { sessionToken, phone } = req.body as { sessionToken: string; phone: string };
    await scannerService.authorizeSession(sessionToken);
    const result = await requestOtp({ phone, purpose: "SCANNER_VERIFY" });
    res.status(202).json({ data: result });
  }),
);

/**
 * STEP 3 — the visitor picks a channel. The privacy gateway creates a
 * communication session; real numbers are never exposed to the scanner.
 */
scannerRouter.post(
  "/contact",
  validate(reasonSchema.extend({ channel: z.enum(["VOICE", "VIDEO", "SMS", "WHATSAPP", "CHAT"]) })),
  asyncHandler(async (req, res) => {
    const { sessionToken, reasonCode, channel } = req.body as z.infer<typeof reasonSchema> & {
      channel: "VOICE" | "VIDEO" | "SMS" | "WHATSAPP" | "CHAT";
    };
    res.status(201).json({
      data: await communicationService.startFromScanner({
        sessionToken,
        reasonCode,
        channel,
        ip: req.ip,
        userAgent: req.header("user-agent") ?? undefined,
      }),
    });
  }),
);

/** Emergency path. Raises an alert for the owner and their priority contacts. */
scannerRouter.post(
  "/emergency",
  validate(reasonSchema.extend({ note: z.string().trim().max(280).optional() })),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reasonSchema> & { note?: string };
    res.status(201).json({ data: await communicationService.raiseEmergency(body) });
  }),
);

/**
 * Polls the state of the scan. The session token travels in a header, not the
 * URL, so it is not written to access logs or browser history.
 */
scannerRouter.post(
  "/session/status",
  validate(z.object({ sessionToken: z.string().min(20) })),
  asyncHandler(async (req, res) => {
    const { sessionToken } = req.body as { sessionToken: string };
    res.json({ data: await communicationService.scannerStatus(sessionToken) });
  }),
);

/** Ends a scanner session early (e.g. the visitor closed the page). */
scannerRouter.post(
  "/session/end",
  validate(sessionBodySchema),
  asyncHandler(async (req, res) => {
    const { sessionToken } = req.body as z.infer<typeof sessionBodySchema>;
    await communicationService.endScannerSession(sessionToken);
    res.status(204).send();
  }),
);
