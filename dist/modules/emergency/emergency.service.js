"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emergencyService = void 0;
const prisma_1 = require("../../db/prisma");
const config_1 = require("../../config");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const providers_1 = require("../../providers");
const errors_1 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
const log = (0, logger_1.childLogger)("emergency");
exports.emergencyService = {
    /**
     * Emergency contacts are stored encrypted and decrypted only for the owner
     * (spec 15). Contacts are never exposed on any public response.
     */
    async listContacts(ownerId) {
        const contacts = await prisma_1.prisma.emergencyContact.findMany({
            where: { ownerId },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        });
        return contacts.map((c) => ({
            id: c.id,
            name: (0, crypto_1.decryptField)(c.nameEncrypted, "name"),
            relationship: (0, crypto_1.decryptField)(c.relationshipEncrypted, "relationship"),
            phone: (0, crypto_1.decryptField)(c.phoneEncrypted, "phone"),
            priority: c.priority,
            enabled: c.enabled,
        }));
    },
    async upsertContact(input) {
        if (input.id) {
            const existing = await prisma_1.prisma.emergencyContact.findUnique({ where: { id: input.id } });
            if (!existing)
                throw (0, errors_1.notFound)("Emergency contact not found");
            if (existing.ownerId !== input.ownerId)
                throw (0, errors_1.forbidden)("Not your contact");
        }
        const phone = (0, crypto_1.normalizePhone)(input.phone);
        const data = {
            nameEncrypted: (0, crypto_1.encryptField)(input.name, "name"),
            relationshipEncrypted: (0, crypto_1.encryptField)(input.relationship, "relationship"),
            phoneEncrypted: (0, crypto_1.encryptField)(phone, "phone"),
            phoneLookupHmac: (0, crypto_1.lookupHmac)(phone, "phone"),
            priority: input.priority,
            enabled: input.enabled,
        };
        const contact = input.id
            ? await prisma_1.prisma.emergencyContact.update({ where: { id: input.id }, data })
            : await prisma_1.prisma.emergencyContact.create({ data: { ...data, ownerId: input.ownerId } });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: input.id ? "emergency.contact_update" : "emergency.contact_create",
            resourceType: "emergency_contact",
            resourceId: contact.id,
            ip: input.ip,
        });
        return { id: contact.id, priority: contact.priority, enabled: contact.enabled };
    },
    async deleteContact(input) {
        const contact = await prisma_1.prisma.emergencyContact.findUnique({ where: { id: input.contactId } });
        if (!contact)
            throw (0, errors_1.notFound)("Emergency contact not found");
        if (contact.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("Not your contact");
        await prisma_1.prisma.emergencyContact.delete({ where: { id: input.contactId } });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "emergency.contact_delete",
            resourceType: "emergency_contact",
            resourceId: input.contactId,
            ip: input.ip,
        });
    },
    /**
     * Per-asset emergency profile (blood group, insurer, responder note). These
     * are highly sensitive and are only surfaced after an emergency is raised and
     * only to the owner — never to the scanner (spec 15, 9.1).
     */
    async getProfile(ownerId, assetId) {
        const profile = await prisma_1.prisma.emergencyProfile.findUnique({ where: { assetId } });
        if (!profile)
            return null;
        const asset = await prisma_1.prisma.asset.findUnique({ where: { id: assetId }, select: { ownerId: true } });
        if (!asset || asset.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your asset");
        return {
            assetId: profile.assetId,
            enabled: profile.enabled,
            bloodGroup: profile.bloodGroupEncrypted ? (0, crypto_1.decryptField)(profile.bloodGroupEncrypted, "blood_group") : null,
            insuranceProvider: profile.insuranceProviderEncrypted
                ? (0, crypto_1.decryptField)(profile.insuranceProviderEncrypted, "insurance_provider")
                : null,
            insurancePolicy: profile.insurancePolicyEncrypted
                ? (0, crypto_1.decryptField)(profile.insurancePolicyEncrypted, "insurance_policy")
                : null,
            firstResponderNote: profile.firstResponderNoteEncrypted
                ? (0, crypto_1.decryptField)(profile.firstResponderNoteEncrypted, "responder_note")
                : null,
        };
    },
    async upsertProfile(input) {
        const asset = await prisma_1.prisma.asset.findUnique({ where: { id: input.assetId } });
        if (!asset)
            throw (0, errors_1.notFound)("Asset not found");
        if (asset.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("Not your asset");
        const data = {
            bloodGroupEncrypted: input.bloodGroup ? (0, crypto_1.encryptField)(input.bloodGroup, "blood_group") : null,
            insuranceProviderEncrypted: input.insuranceProvider
                ? (0, crypto_1.encryptField)(input.insuranceProvider, "insurance_provider")
                : null,
            insurancePolicyEncrypted: input.insurancePolicy
                ? (0, crypto_1.encryptField)(input.insurancePolicy, "insurance_policy")
                : null,
            firstResponderNoteEncrypted: input.firstResponderNote
                ? (0, crypto_1.encryptField)(input.firstResponderNote, "responder_note")
                : null,
            enabled: input.enabled,
        };
        const profile = await prisma_1.prisma.emergencyProfile.upsert({
            where: { assetId: input.assetId },
            create: { assetId: input.assetId, ...data },
            update: data,
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "emergency.profile_update",
            resourceType: "emergency_profile",
            resourceId: profile.id,
            ip: input.ip,
        });
        return { assetId: profile.assetId, enabled: profile.enabled };
    },
    async listForOwner(ownerId) {
        const alerts = await prisma_1.prisma.emergencyAlert.findMany({
            where: { ownerId },
            orderBy: { createdAt: "desc" },
            take: 50,
            include: {
                scannerSession: {
                    select: { publicSessionId: true, riskState: true, createdAt: true, tag: { select: { publicTagId: true, tagType: true } } },
                },
            },
        });
        return alerts.map((a) => ({
            id: a.id,
            status: a.status,
            reasonCode: a.reasonCode,
            note: a.note,
            riskScore: a.riskScore,
            tag: a.scannerSession.tag,
            createdAt: a.createdAt,
            resolvedAt: a.resolvedAt,
        }));
    },
    async resolve(alertId, ownerId) {
        const alert = await prisma_1.prisma.emergencyAlert.findUnique({ where: { id: alertId } });
        if (!alert)
            throw (0, errors_1.notFound)("Alert not found");
        if (alert.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your alert");
        const updated = await prisma_1.prisma.emergencyAlert.update({
            where: { id: alertId },
            data: { status: "RESOLVED", resolvedAt: new Date() },
        });
        return { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt };
    },
    /**
     * Fan-out to priority contacts. Called by the notification worker, not from a
     * request handler. The alert text is deliberately minimal — no medical data.
     */
    async notifyPriorityContacts(ownerId, alertId) {
        const owner = await prisma_1.prisma.user.findUnique({ where: { id: ownerId } });
        if (!owner)
            return 0;
        const contacts = await prisma_1.prisma.emergencyContact.findMany({
            where: { ownerId, enabled: true },
            orderBy: { priority: "asc" },
            take: 3,
        });
        let notified = 0;
        const base = `${config_1.env.APP_NAME} emergency alert: someone requested emergency help via one of your linked tags. Open the app to review.`;
        for (const contact of contacts) {
            try {
                const phone = (0, crypto_1.decryptField)(contact.phoneEncrypted, "phone");
                await providers_1.smsProvider.send({
                    to: phone,
                    body: `${base}\nAlert ${alertId.slice(0, 8)}`,
                    templateKey: "EMERGENCY_PRIORITY_CONTACT",
                    idempotencyKey: `emergency:${alertId}:${contact.id}`,
                });
                notified += 1;
            }
            catch (error) {
                log.error({ err: error, alertId, contactId: contact.id }, "failed to notify priority contact");
            }
        }
        await prisma_1.prisma.emergencyAlert.update({
            where: { id: alertId },
            data: { notifiedContactIds: contacts.map((c) => c.id) },
        });
        log.warn({ alertId, notified }, "emergency fan-out complete");
        return notified;
    },
};
//# sourceMappingURL=emergency.service.js.map