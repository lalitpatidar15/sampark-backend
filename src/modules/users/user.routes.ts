import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRecentReauth, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { userService } from "./user.service";

const privacySchema = z.object({
  enabledChannels: z
    .array(z.enum(["VOICE", "VIDEO", "SMS", "WHATSAPP", "CHAT", "PUSH"]))
    .optional(),
  allowLocationShare: z.boolean().optional(),
  allowVideoCalls: z.boolean().optional(),
  allowUnknownCallers: z.boolean().optional(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});

export const userRouter = Router();
userRouter.use(authenticate);

userRouter.get(
  "/me",
  requirePermission(Permission.USERS_READ_SELF),
  asyncHandler(async (req, res) => {
    res.json({ data: await userService.getProfile(req.user!.id) });
  }),
);

userRouter.patch(
  "/me",
  requirePermission(Permission.USERS_WRITE_SELF),
  validate(z.object({ name: z.string().trim().min(1).max(120) })),
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name: string };
    res.json({ data: await userService.updateName(req.user!.id, name, req.ip) });
  }),
);

userRouter.patch(
  "/me/privacy",
  requirePermission(Permission.USERS_WRITE_SELF),
  validate(privacySchema),
  asyncHandler(async (req, res) => {
    res.json({
      data: await userService.updatePrivacySettings({
        userId: req.user!.id,
        ...(req.body as z.infer<typeof privacySchema>),
        ip: req.ip,
      }),
    });
  }),
);

userRouter.post(
  "/me/email",
  requirePermission(Permission.USERS_WRITE_SELF),
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    res.json({ data: await userService.addEmail(req.user!.id, email, req.ip) });
  }),
);

userRouter.post(
  "/me/devices",
  requirePermission(Permission.USERS_WRITE_SELF),
  validate(
    z.object({
      devicePublicId: z.string().min(8).max(64),
      platform: z.enum(["ios", "android"]),
      appVersion: z.string().max(32).optional(),
      pushToken: z.string().max(512).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      devicePublicId: string;
      platform: "ios" | "android";
      appVersion?: string;
      pushToken?: string;
    };
    res.status(201).json({ data: await userService.registerDevice({ userId: req.user!.id, ...body }) });
  }),
);

/** GDPR/ DPDP-style export. Requires a fresh OTP (spec 30). */
userRouter.get(
  "/me/export",
  requirePermission(Permission.USERS_EXPORT_SELF),
  requireRecentReauth,
  asyncHandler(async (req, res) => {
    res.json({ data: await userService.exportData(req.user!.id) });
  }),
);

/** Account deletion. Requires a fresh OTP (spec 30). */
userRouter.post(
  "/me/delete",
  requirePermission(Permission.USERS_EXPORT_SELF),
  requireRecentReauth,
  asyncHandler(async (req, res) => {
    res.json({ data: await userService.deleteAccount({ userId: req.user!.id, ip: req.ip }) });
  }),
);
