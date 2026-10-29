import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { mfaService } from "./mfa.service";

const tokenSchema = z.object({ token: z.string().min(6).max(6) });

export const mfaRouter = Router();

mfaRouter.use(authenticate);

mfaRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const enabled = await mfaService.isEnabled(req.user!.id);
    res.json({ data: { enabled } });
  }),
);

mfaRouter.post(
  "/setup",
  asyncHandler(async (req, res) => {
    const result = await mfaService.generateSetup(req.user!.id, req.ip);
    res.json({ data: { uri: result.uri, recoveryCodes: result.recoveryCodes } });
  }),
);

mfaRouter.post(
  "/confirm",
  validate(tokenSchema),
  asyncHandler(async (req, res) => {
    await mfaService.confirmSetup(req.user!.id, req.body.token, req.ip);
    res.json({ data: { enabled: true } });
  }),
);

mfaRouter.post(
  "/verify",
  validate(tokenSchema),
  asyncHandler(async (req, res) => {
    const ok = await mfaService.verifyToken(req.user!.id, req.body.token, req.ip);
    res.json({ data: { valid: ok } });
  }),
);

mfaRouter.post(
  "/disable",
  asyncHandler(async (req, res) => {
    await mfaService.disable(req.user!.id, req.user!.id, req.ip);
    res.json({ data: { disabled: true } });
  }),
);
