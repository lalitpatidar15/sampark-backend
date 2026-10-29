"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geofenceService = void 0;
const prisma_1 = require("../../db/prisma");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const errors_1 = require("../../common/errors");
const log = (0, logger_1.childLogger)("geofence");
/** Haversine distance in meters between two lat/lng points. */
function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6_371_000; // earth radius in meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
exports.geofenceService = {
    async upsert(input) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id: input.tagId } });
        if (!tag)
            throw (0, errors_1.notFound)("Tag not found");
        if (tag.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("Not your tag");
        const existing = await prisma_1.prisma.geofence.findUnique({ where: { tagId: input.tagId } });
        const center = (0, crypto_1.encryptField)(JSON.stringify({ latitude: input.latitude, longitude: input.longitude }), "location");
        const geofence = existing
            ? await prisma_1.prisma.geofence.update({
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
            : await prisma_1.prisma.geofence.create({
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
        await (0, audit_service_1.audit)({
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
    async get(tagId, ownerId) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id: tagId } });
        if (!tag)
            throw (0, errors_1.notFound)("Tag not found");
        if (tag.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your tag");
        const geofence = await prisma_1.prisma.geofence.findUnique({ where: { tagId } });
        if (!geofence)
            return null;
        const { latitude, longitude } = JSON.parse((0, crypto_1.decryptField)(geofence.centerCiphertext, "location"));
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
    async remove(tagId, ownerId, ip) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { id: tagId } });
        if (!tag)
            throw (0, errors_1.notFound)("Tag not found");
        if (tag.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your tag");
        const existing = await prisma_1.prisma.geofence.findUnique({ where: { tagId } });
        if (!existing)
            throw (0, errors_1.badRequest)("No geofence configured for this tag");
        await prisma_1.prisma.geofence.delete({ where: { tagId } });
        await (0, audit_service_1.audit)({
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
    async checkProximity(tagId, latitude, longitude) {
        const geofence = await prisma_1.prisma.geofence.findUnique({ where: { tagId } });
        if (!geofence || !geofence.enabled)
            return { inside: false };
        const { latitude: centerLat, longitude: centerLng } = JSON.parse((0, crypto_1.decryptField)(geofence.centerCiphertext, "location"));
        const distance = haversineMeters(centerLat, centerLng, latitude, longitude);
        const inside = distance <= geofence.radiusMeters;
        const now = Date.now();
        const cooldownElapsed = !geofence.lastTriggeredAt ||
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
    async recordTrigger(tagId) {
        await prisma_1.prisma.geofence.update({
            where: { tagId },
            data: { lastTriggeredAt: new Date() },
        });
        await (0, audit_service_1.audit)({
            action: "geofence.triggered",
            resourceType: "geofence",
            resourceId: tagId,
            metadata: { tagId },
        });
    },
};
//# sourceMappingURL=geofence.service.js.map