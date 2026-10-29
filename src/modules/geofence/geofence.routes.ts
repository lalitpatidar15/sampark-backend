import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { geofenceService } from "./geofence.service";

const idParam = z.object({ tagId: z.string().uuid() });

const upsertBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(50_000).optional(),
  allowedChannels: z
    .array(z.enum(["CHAT", "VOICE"]))
    .min(1)
    .optional(),
  activeSchedule: z.string().optional(),
  cooldownMinutes: z.number().int().min(1).optional(),
  alertOnProximity: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const proximityBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** Owner: configure a tag's geo-fence. Mounted under /tags/:tagId/geofence. */
export const geofenceOwnerRouter = Router();
geofenceOwnerRouter.use(authenticate);

geofenceOwnerRouter.post(
  "/:tagId/geofence",
  validate(idParam, "params"),
  validate(upsertBody),
  asyncHandler(async (req, res) => {
    const result = await geofenceService.upsert({
      tagId: req.params.tagId,
      ownerId: req.user!.id,
      ...req.body,
      ip: req.ip,
    });
    res.json({ data: result });
  }),
);

geofenceOwnerRouter.get(
  "/:tagId/geofence",
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const result = await geofenceService.get(req.params.tagId, req.user!.id);
    res.json({ data: result });
  }),
);

geofenceOwnerRouter.delete(
  "/:tagId/geofence",
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    await geofenceService.remove(req.params.tagId, req.user!.id, req.ip);
    res.status(204).send();
  }),
);

/** Public: proximity check for a tag's geo-fence (no account). */
export const geofencePublicRouter = Router();

geofencePublicRouter.post(
  "/:tagId/proximity",
  validate(z.object({ tagId: z.string().uuid() }), "params"),
  validate(proximityBody),
  asyncHandler(async (req, res) => {
    const result = await geofenceService.checkProximity(
      req.params.tagId,
      req.body.latitude,
      req.body.longitude,
    );
    res.json({ data: result });
  }),
);
