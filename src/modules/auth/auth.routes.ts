import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth";
import { otpLimiter } from "../../common/middleware/rateLimit";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { authService } from "./auth.service";

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number with country code");

const requestOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(["LOGIN", "REAUTH", "REGISTRATION", "SCANNER_VERIFY", "TAG_TRANSFER"]).default("LOGIN"),
});

const loginSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const refreshSchema = z.object({ refreshToken: z.string().min(20) });

const reauthSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const authRouter = Router();

authRouter.post(
  "/otp/request",
  otpLimiter(),
  validate(requestOtpSchema),
  asyncHandler(async (req, res) => {
    const { phone, purpose } = req.body as z.infer<typeof requestOtpSchema>;
    const result = await authService.requestOtp(phone, purpose);
    res.status(202).json({ data: result });
  }),
);

authRouter.post(
  "/login",
  otpLimiter(),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { phone, code } = req.body as z.infer<typeof loginSchema>;
    const result = await authService.login({
      phone,
      code,
      userAgent: req.header("user-agent") ?? undefined,
      ip: req.ip,
    });
    res.json({ data: result });
  }),
);

authRouter.post(
  "/refresh",
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    res.json({ data: await authService.refresh(refreshToken) });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const refreshToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    await authService.logout(refreshToken);
    res.status(204).send();
  }),
);

authRouter.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logoutAll(req.user!.id);
    res.status(204).send();
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ data: await authService.me(req.user!.id) });
  }),
);

authRouter.post(
  "/reauth/request",
  otpLimiter(),
  validate(z.object({ phone: phoneSchema })),
  asyncHandler(async (req, res) => {
    const { phone } = req.body as { phone: string };
    res.status(202).json({ data: await authService.requestOtp(phone, "REAUTH") });
  }),
);

authRouter.post(
  "/reauth/verify",
  otpLimiter(),
  authenticate,
  validate(reauthSchema),
  asyncHandler(async (req, res) => {
    const { phone, code } = req.body as z.infer<typeof reauthSchema>;
    res.json({ data: await authService.reauthenticate(req.user!.id, phone, code) });
  }),
);
