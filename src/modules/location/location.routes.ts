import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { scannerLimiter } from "../../common/middleware/rateLimit";
import { Permission } from "../../common/guards/permissions";
import { locationService } from "./location.service";

export const locationRouter = Router();

// Owner: review and respond to location requests.
locationRouter.use(authenticate);

locationRouter.get(
  "/requests",
  requirePermission(Permission.LOCATION_SHARE_SELF),
  asyncHandler(async (req, res) => {
    res.json({ data: await locationService.listRequests(req.user!.id) });
  }),
);

locationRouter.post(
  "/requests/:requestId/respond",
  requirePermission(Permission.LOCATION_SHARE_SELF),
  validate(
    z.object({
      approve: z.boolean(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      accuracy: z.number().int().min(0).max(100_000).optional(),
      ttlMinutes: z.number().int().min(5).max(1440).optional(),
    }),
  ),
  validate(z.object({ requestId: z.string().uuid() }), "params"),
  asyncHandler(async (req, res) => {
    const { requestId } = req.params as unknown as { requestId: string };
    res.json({
      data: await locationService.respond({
        ownerId: req.user!.id,
        requestId,
        ...(req.body as {
          approve: boolean;
          latitude?: number;
          longitude?: number;
          accuracy?: number;
          ttlMinutes?: number;
        }),
        ip: req.ip,
      }),
    });
  }),
);

locationRouter.post(
  "/shares/:shareId/revoke",
  requirePermission(Permission.LOCATION_SHARE_SELF),
  validate(z.object({ shareId: z.string().uuid() }), "params"),
  asyncHandler(async (req, res) => {
    const { shareId } = req.params as unknown as { shareId: string };
    await locationService.revoke(shareId, req.user!.id, req.ip);
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// Scanner: request a share
// ---------------------------------------------------------------------------

export const scannerLocationRouter = Router();
scannerLocationRouter.use(scannerLimiter);

scannerLocationRouter.post(
  "/request",
  validate(z.object({ sessionToken: z.string().min(20), reasonCode: z.string().max(48).optional() })),
  asyncHandler(async (req, res) => {
    const { sessionToken, reasonCode } = req.body as { sessionToken: string; reasonCode?: string };
    res.status(201).json({ data: await locationService.requestShare({ sessionToken, reasonCode }) });
  }),
);

// ---------------------------------------------------------------------------
// Public: resolve an expiring share link (spec 16)
// ---------------------------------------------------------------------------

export const publicLocationRouter = Router();
publicLocationRouter.use(scannerLimiter);

publicLocationRouter.get(
  "/:publicShareId",
  validate(z.object({ publicShareId: z.string().min(8).max(64) }), "params"),
  asyncHandler(async (req, res) => {
    const { publicShareId } = req.params as unknown as { publicShareId: string };
    res.json({ data: await locationService.resolveShare(publicShareId) });
  }),
);
