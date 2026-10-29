import { prisma } from "../../db/prisma";
import { encryptField, decryptField } from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";
import { notFound, badRequest, conflict, forbidden } from "../../common/errors";

const log = childLogger("geofence");

/** Haversine distance in meters between two lat/lng points. */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000; // earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const geofenceService = {
  async upsert(input: {
    tagId: string;
    ownerId: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    allowedChannels?: ("CHAT" | "VOICE")[];
    activeSchedule?: string;
    cooldownMinutes?: number;
    alertOnProximity?: boolean;
    enabled?: boolean;
    ip?: string;
  }) {
    const tag = await prisma.tag.findUnique({ where: { id: input.tagId } });
    if (!tag) throw notFound("Tag not found");
    if (tag.ownerId !== input.ownerId) throw forbidden("Not your tag");

    const existing = await prisma.geofence.findUnique({ where: { tagId: input.tagId } });

    const center = encryptField(
      JSON.stringify({ latitude: input.latitude, longitude: input.longitude }),
      "location",
    );

    const geofence = existing
      ? await prisma.geofence.update({
          where: { tagId: input.tagId },
          data: {
            centerCiphertext: center,
            radiusMeters: input.radiusMeters ?? 150,
            allowedChannels: input.allowedChannels ?? ["CHAT", "VOICE"],
            activeSchedule: input.activeSchedule ?? null,
            cooldownMinutes: input.cooldownMinutes ?? 60,
            alertOnProximity: input.alertOnProximity ?? false,
            enabled: input.enabled ?? true,
          },
        })
      : await prisma.geofence.create({
          data: {
            tagId: input.tagId,
            centerCiphertext: center,
            radiusMeters: input.radiusMeters ?? 150,
            allowedChannels: input.allowedChannels ?? ["CHAT", "VOICE"],
            activeSchedule: input.activeSchedule ?? null,
            cooldownMinutes: input.cooldownMinutes ?? 60,
            alertOnProximity: input.alertOnProximity ?? false,
            enabled: input.enabled ?? true,
          },
        });

    await audit({
      actorUserId: input.ownerId,
      action: existing ? "geofence.update" : "geofence.create",
      resourceType: "geofence",
      resourceId: geofence.id,
      ip: input.ip,
      metadata: { tagId: input.tagId, radiusMeters: geofence.radiusMeters },
    });

    log.info({ tagId: input.tagId, geofenceId: geofence.id }, "geofence saved");
    return geofence;
  },

  async get(tagId: string, ownerId: string) {
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw notFound("Tag not found");
    if (tag.ownerId !== ownerId) throw forbidden("Not your tag");

    const geofence = await prisma.geofence.findUnique({ where: { tagId } });
    if (!geofence) return null;

    const { latitude, longitude } = JSON.parse(
      decryptField(geofence.centerCiphertext, "location"),
    ) as { latitude: number; longitude: number };

    return {
      tagId: geofence.tagId,
      latitude,
      longitude,
      radiusMeters: geofence.radiusMeters,
      allowedChannels: geofence.allowedChannels,
      activeSchedule: geofence.activeSchedule,
      cooldownMinutes: geofence.cooldownMinutes,
      alertOnProximity: geofence.alertOnProximity,
      enabled: geofence.enabled,
      lastTriggeredAt: geofence.lastTriggeredAt,
    };
  },

  async remove(tagId: string, ownerId: string, ip?: string) {
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw notFound("Tag not found");
    if (tag.ownerId !== ownerId) throw forbidden("Not your tag");

    const existing = await prisma.geofence.findUnique({ where: { tagId } });
    if (!existing) throw badRequest("No geofence configured for this tag");

    await prisma.geofence.delete({ where: { tagId } });

    await audit({
      actorUserId: ownerId,
      action: "geofence.delete",
      resourceType: "geofence",
      resourceId: tagId,
      ip,
      metadata: { tagId },
    });

    log.info({ tagId }, "geofence removed");
    return { removed: true };
  },

  /**
   * Check whether a point is inside an active geofence and whether the cooldown
   * has elapsed. Used by the scanner gateway to gate proximity-triggered alerts.
   */
  async checkProximity(tagId: string, latitude: number, longitude: number) {
    const geofence = await prisma.geofence.findUnique({ where: { tagId } });
    if (!geofence || !geofence.enabled) return { inside: false };

    const { latitude: centerLat, longitude: centerLng } = JSON.parse(
      decryptField(geofence.centerCiphertext, "location"),
    ) as { latitude: number; longitude: number };

    const distance = haversineMeters(centerLat, centerLng, latitude, longitude);
    const inside = distance <= geofence.radiusMeters;

    const now = Date.now();
    const cooldownElapsed =
      !geofence.lastTriggeredAt ||
      now - geofence.lastTriggeredAt.getTime() >= geofence.cooldownMinutes * 60 * 1000;

    return {
      inside,
      distanceMeters: Math.round(distance),
      radiusMeters: geofence.radiusMeters,
      cooldownElapsed,
      allowedChannels: geofence.allowedChannels,
      alertOnProximity: geofence.alertOnProximity,
    };
  },

  async recordTrigger(tagId: string) {
    await prisma.geofence.update({
      where: { tagId },
      data: { lastTriggeredAt: new Date() },
    });
    await audit({
      action: "geofence.triggered",
      resourceType: "geofence",
      resourceId: tagId,
      metadata: { tagId },
    });
  },
};
