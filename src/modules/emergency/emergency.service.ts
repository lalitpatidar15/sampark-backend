import { prisma } from "../../db/prisma";
import { env } from "../../config";
import { decryptField, encryptField, lookupHmac, normalizePhone } from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { smsProvider } from "../../providers";
import { forbidden, notFound } from "../../common/errors";
import { audit } from "../audit/audit.service";

const log = childLogger("emergency");

export const emergencyService = {
  /**
   * Emergency contacts are stored encrypted and decrypted only for the owner
   * (spec 15). Contacts are never exposed on any public response.
   */
  async listContacts(ownerId: string) {
    const contacts = await prisma.emergencyContact.findMany({
      where: { ownerId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return contacts.map((c) => ({
      id: c.id,
      name: decryptField(c.nameEncrypted, "name"),
      relationship: decryptField(c.relationshipEncrypted, "relationship"),
      phone: decryptField(c.phoneEncrypted, "phone"),
      priority: c.priority,
      enabled: c.enabled,
    }));
  },

  async upsertContact(input: {
    ownerId: string;
    id?: string;
    name: string;
    relationship: string;
    phone: string;
    priority: number;
    enabled: boolean;
    ip?: string;
  }) {
    if (input.id) {
      const existing = await prisma.emergencyContact.findUnique({ where: { id: input.id } });
      if (!existing) throw notFound("Emergency contact not found");
      if (existing.ownerId !== input.ownerId) throw forbidden("Not your contact");
    }

    const phone = normalizePhone(input.phone);
    const data = {
      nameEncrypted: encryptField(input.name, "name"),
      relationshipEncrypted: encryptField(input.relationship, "relationship"),
      phoneEncrypted: encryptField(phone, "phone"),
      phoneLookupHmac: lookupHmac(phone, "phone"),
      priority: input.priority,
      enabled: input.enabled,
    };

    const contact = input.id
      ? await prisma.emergencyContact.update({ where: { id: input.id }, data })
      : await prisma.emergencyContact.create({ data: { ...data, ownerId: input.ownerId } });

    await audit({
      actorUserId: input.ownerId,
      action: input.id ? "emergency.contact_update" : "emergency.contact_create",
      resourceType: "emergency_contact",
      resourceId: contact.id,
      ip: input.ip,
    });

    return { id: contact.id, priority: contact.priority, enabled: contact.enabled };
  },

  async deleteContact(input: { ownerId: string; contactId: string; ip?: string }) {
    const contact = await prisma.emergencyContact.findUnique({ where: { id: input.contactId } });
    if (!contact) throw notFound("Emergency contact not found");
    if (contact.ownerId !== input.ownerId) throw forbidden("Not your contact");

    await prisma.emergencyContact.delete({ where: { id: input.contactId } });
    await audit({
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
  async getProfile(ownerId: string, assetId: string) {
    const profile = await prisma.emergencyProfile.findUnique({ where: { assetId } });
    if (!profile) return null;

    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { ownerId: true } });
    if (!asset || asset.ownerId !== ownerId) throw forbidden("Not your asset");

    return {
      assetId: profile.assetId,
      enabled: profile.enabled,
      bloodGroup: profile.bloodGroupEncrypted ? decryptField(profile.bloodGroupEncrypted, "blood_group") : null,
      insuranceProvider: profile.insuranceProviderEncrypted
        ? decryptField(profile.insuranceProviderEncrypted, "insurance_provider")
        : null,
      insurancePolicy: profile.insurancePolicyEncrypted
        ? decryptField(profile.insurancePolicyEncrypted, "insurance_policy")
        : null,
      firstResponderNote: profile.firstResponderNoteEncrypted
        ? decryptField(profile.firstResponderNoteEncrypted, "responder_note")
        : null,
    };
  },

  async upsertProfile(input: {
    ownerId: string;
    assetId: string;
    bloodGroup?: string;
    insuranceProvider?: string;
    insurancePolicy?: string;
    firstResponderNote?: string;
    enabled: boolean;
    ip?: string;
  }) {
    const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw notFound("Asset not found");
    if (asset.ownerId !== input.ownerId) throw forbidden("Not your asset");

    const data = {
      bloodGroupEncrypted: input.bloodGroup ? encryptField(input.bloodGroup, "blood_group") : null,
      insuranceProviderEncrypted: input.insuranceProvider
        ? encryptField(input.insuranceProvider, "insurance_provider")
        : null,
      insurancePolicyEncrypted: input.insurancePolicy
        ? encryptField(input.insurancePolicy, "insurance_policy")
        : null,
      firstResponderNoteEncrypted: input.firstResponderNote
        ? encryptField(input.firstResponderNote, "responder_note")
        : null,
      enabled: input.enabled,
    };

    const profile = await prisma.emergencyProfile.upsert({
      where: { assetId: input.assetId },
      create: { assetId: input.assetId, ...data },
      update: data,
    });

    await audit({
      actorUserId: input.ownerId,
      action: "emergency.profile_update",
      resourceType: "emergency_profile",
      resourceId: profile.id,
      ip: input.ip,
    });
    return { assetId: profile.assetId, enabled: profile.enabled };
  },

  async listForOwner(ownerId: string) {
    const alerts = await prisma.emergencyAlert.findMany({
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

  async resolve(alertId: string, ownerId: string) {
    const alert = await prisma.emergencyAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw notFound("Alert not found");
    if (alert.ownerId !== ownerId) throw forbidden("Not your alert");

    const updated = await prisma.emergencyAlert.update({
      where: { id: alertId },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    return { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt };
  },

  /**
   * Fan-out to priority contacts. Called by the notification worker, not from a
   * request handler. The alert text is deliberately minimal — no medical data.
   */
  async notifyPriorityContacts(ownerId: string, alertId: string): Promise<number> {
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) return 0;

    const contacts = await prisma.emergencyContact.findMany({
      where: { ownerId, enabled: true },
      orderBy: { priority: "asc" },
      take: 3,
    });

    let notified = 0;
    const base = `${env.APP_NAME} emergency alert: someone requested emergency help via one of your linked tags. Open the app to review.`;

    for (const contact of contacts) {
      try {
        const phone = decryptField(contact.phoneEncrypted, "phone");
        await smsProvider.send({
          to: phone,
          body: `${base}\nAlert ${alertId.slice(0, 8)}`,
          templateKey: "EMERGENCY_PRIORITY_CONTACT",
          idempotencyKey: `emergency:${alertId}:${contact.id}`,
        });
        notified += 1;
      } catch (error) {
        log.error({ err: error, alertId, contactId: contact.id }, "failed to notify priority contact");
      }
    }

    await prisma.emergencyAlert.update({
      where: { id: alertId },
      data: { notifiedContactIds: contacts.map((c) => c.id) },
    });

    log.warn({ alertId, notified }, "emergency fan-out complete");
    return notified;
  },
};
