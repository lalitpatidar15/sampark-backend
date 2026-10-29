"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = void 0;
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/utils/crypto");
const auth_service_1 = require("../auth/auth.service");
const audit_service_1 = require("../audit/audit.service");
const auth_repository_1 = require("../auth/auth.repository");
const SENSITIVE_CHANNELS = ["PUSH"];
exports.userService = {
    async getProfile(userId) {
        const user = await auth_repository_1.authRepository.findById(userId);
        if (!user)
            throw (0, errors_1.notFound)("Account not found");
        return (0, auth_service_1.toSafeUser)(user);
    },
    /**
     * Owner-controlled privacy preferences (spec 4.1, 8.1). Channels are
     * intersected with the platform's supported set so an unknown value can never
     * be persisted and later trusted by the privacy gateway.
     */
    async updatePrivacySettings(input) {
        const data = {};
        if (input.enabledChannels) {
            const allowed = ["VOICE", "VIDEO", "SMS", "WHATSAPP", "CHAT", ...SENSITIVE_CHANNELS];
            const cleaned = input.enabledChannels.filter((c) => allowed.includes(c));
            data.enabledChannels = cleaned;
        }
        if (input.allowLocationShare !== undefined)
            data.allowLocationShare = input.allowLocationShare;
        if (input.allowVideoCalls !== undefined)
            data.allowVideoCalls = input.allowVideoCalls;
        if (input.allowUnknownCallers !== undefined)
            data.allowUnknownCallers = input.allowUnknownCallers;
        if (input.quietHoursStart !== undefined)
            data.quietHoursStart = input.quietHoursStart;
        if (input.quietHoursEnd !== undefined)
            data.quietHoursEnd = input.quietHoursEnd;
        // A channel that is switched on must also be permitted at the owner level.
        if (input.enabledChannels?.includes("VIDEO") && input.allowVideoCalls === false) {
            throw new errors_1.AppError("BAD_REQUEST", "Enable video calls before adding VIDEO to your channels");
        }
        const user = await prisma_1.prisma.user.update({ where: { id: input.userId }, data: data });
        await (0, audit_service_1.audit)({
            actorUserId: input.userId,
            action: "user.privacy_update",
            resourceType: "user",
            resourceId: input.userId,
            ip: input.ip,
            metadata: { fields: Object.keys(data) },
        });
        return (0, auth_service_1.toSafeUser)(user);
    },
    async updateName(userId, name, ip) {
        const user = await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { nameEncrypted: (0, crypto_1.encryptField)(name.trim(), "name") },
        });
        await (0, audit_service_1.audit)({ actorUserId: userId, action: "user.update_name", resourceType: "user", resourceId: userId, ip });
        return (0, auth_service_1.toSafeUser)(user);
    },
    /**
     * Email is optional contact metadata. It is not exposed to scanners and is
     * stored with a keyed lookup HMAC so it is not enumerable from a dump.
     */
    async addEmail(userId, email, ip) {
        const normalized = (0, crypto_1.normalizeEmail)(email);
        const existing = await prisma_1.prisma.user.findUnique({ where: { emailLookupHmac: (0, crypto_1.lookupHmac)(normalized, "email") } });
        if (existing && existing.id !== userId) {
            throw new errors_1.AppError("CONFLICT", "That email is already linked to another account");
        }
        await auth_repository_1.authRepository.attachEmail(userId, normalized);
        await (0, audit_service_1.audit)({ actorUserId: userId, action: "user.add_email", resourceType: "user", resourceId: userId, ip });
        return { email: normalized };
    },
    /**
     * Data export (spec 30, requires re-auth at the route layer). Returns
     * decrypted personal data for the requesting owner only.
     */
    async exportData(userId) {
        const user = await auth_repository_1.authRepository.findById(userId);
        if (!user)
            throw (0, errors_1.notFound)("Account not found");
        const [assets, tags, vehicles, contacts, communications, locationShares, documents] = await Promise.all([
            prisma_1.prisma.asset.findMany({ where: { ownerId: userId } }),
            prisma_1.prisma.tag.findMany({ where: { ownerId: userId }, select: { id: true, publicTagId: true, tagType: true, status: true, createdAt: true } }),
            prisma_1.prisma.vehicle.findMany({ where: { ownerId: userId } }),
            prisma_1.prisma.emergencyContact.findMany({ where: { ownerId: userId } }),
            prisma_1.prisma.communicationSession.findMany({ where: { ownerId: userId }, select: { id: true, channel: true, status: true, reasonCode: true, createdAt: true } }),
            prisma_1.prisma.locationShare.findMany({ where: { ownerId: userId }, select: { id: true, createdAt: true, expiresAt: true, status: true } }),
            prisma_1.prisma.document.findMany({ where: { ownerId: userId }, select: { id: true, documentType: true, status: true, createdAt: true, expiresAt: true } }),
        ]);
        return {
            exportedAt: new Date().toISOString(),
            account: (0, auth_service_1.toSafeUser)(user),
            assets,
            tags,
            vehicles: vehicles.map((v) => ({
                id: v.id,
                registration: v.registrationEnding,
                make: v.make,
                model: v.model,
                createdAt: v.createdAt,
            })),
            emergencyContacts: contacts.length,
            communications,
            locationShares,
            documents,
            note: "Encrypted fields are exported decrypted for your own account only. Document binaries are not included; request signed download URLs instead.",
        };
    },
    /**
     * Soft delete. Personal identifiers are anonymised immediately while rows are
     * retained for fraud/audit obligations, per the retention policy a super admin
     * configures (spec 4.7, 33).
     */
    async deleteAccount(input) {
        const user = await auth_repository_1.authRepository.findById(input.userId);
        if (!user)
            throw (0, errors_1.notFound)("Account not found");
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.tag.updateMany({ where: { ownerId: input.userId, status: "ACTIVE" }, data: { status: "DEACTIVATED", deactivatedAt: new Date() } }),
            prisma_1.prisma.user.update({
                where: { id: input.userId },
                data: {
                    status: "DELETED",
                    deletedAt: new Date(),
                    nameEncrypted: null,
                    emailEncrypted: null,
                    emailLookupHmac: null,
                    pushTokenEncrypted: null,
                },
            }),
            prisma_1.prisma.refreshToken.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
        ]);
        await (0, audit_service_1.audit)({
            actorUserId: input.userId,
            action: "user.delete_account",
            resourceType: "user",
            resourceId: input.userId,
            ip: input.ip,
            metadata: { hard: input.hard ?? false },
        });
        return { deleted: true, anonymisedRetained: !input.hard };
    },
    async registerDevice(input) {
        const device = await prisma_1.prisma.device.upsert({
            where: { devicePublicId: input.devicePublicId },
            create: {
                userId: input.userId,
                devicePublicId: input.devicePublicId,
                platform: input.platform,
                appVersion: input.appVersion,
                pushTokenEncrypted: input.pushToken ? (0, crypto_1.encryptField)(input.pushToken, "push_token") : null,
            },
            update: {
                userId: input.userId,
                appVersion: input.appVersion,
                lastSeenAt: new Date(),
                ...(input.pushToken ? { pushTokenEncrypted: (0, crypto_1.encryptField)(input.pushToken, "push_token") } : {}),
            },
        });
        return { devicePublicId: device.devicePublicId, platform: device.platform };
    },
    async assertSelf(userId, targetId) {
        if (userId !== targetId)
            throw (0, errors_1.forbidden)("You can only access your own data");
    },
};
//# sourceMappingURL=user.service.js.map