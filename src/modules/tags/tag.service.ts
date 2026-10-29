import { prisma } from "../../db/prisma";
import { env } from "../../config";
import { AppError, conflict, forbidden, notFound } from "../../common/errors";
import {
  decryptField,
  encryptField,
  generatePublicTagToken,
  lookupHmac,
  sha256,
} from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";

const log = childLogger("tags");

export const CONTACT_REASONS = [
  { code: "VEHICLE_NEEDS_ATTENTION", label: "Vehicle needs attention", assetTypes: ["VEHICLE", "BIKE", "EQUIPMENT"] },
  { code: "LIGHTS_ON", label: "Lights are ON", assetTypes: ["VEHICLE", "BIKE"] },
  { code: "BLOCKING", label: "This is blocking an entrance", assetTypes: ["VEHICLE", "BIKE", "PARKING"] },
  { code: "ACCIDENT_EMERGENCY", label: "Accident / emergency", assetTypes: ["VEHICLE", "BIKE", "HOME_DOOR", "OFFICE", "PARKING", "EQUIPMENT"] },
  { code: "DELIVERY", label: "I am at the door with a delivery", assetTypes: ["HOME_DOOR", "OFFICE", "SOCIETY", "BUSINESS"] },
  { code: "PROFESSIONAL_ENQUIRY", label: "Professional enquiry", assetTypes: ["PROFESSIONAL", "BUSINESS"] },
  { code: "PARKING_DISPUTE", label: "Parking dispute", assetTypes: ["PARKING", "SOCIETY"] },
  { code: "OTHER", label: "Something else", assetTypes: [] },
] as const;

export type ReasonCode = (typeof CONTACT_REASONS)[number]["code"];

const reasonFor = (code: string) => CONTACT_REASONS.find((r) => r.code === code);

export const tagService = {
  /**
   * Creates a tag in CREATED state. The public token is generated server-side
   * and returned exactly once, to the owner only — the QR encodes nothing but
   * this token (spec 6.4).
   */
  async createTag(input: {
    ownerId: string;
    tagType: string;
    assetId?: string;
    label?: string;
    ip?: string;
  }): Promise<{ tagId: string; publicTagId: string; publicToken: string; status: string }> {
    if (input.assetId) {
      const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
      if (!asset) throw notFound("Asset not found");
      if (asset.ownerId !== input.ownerId) throw forbidden("You do not own this asset");
    }

    const publicToken = generatePublicTagToken();
    const publicTagId = `tag_${sha256(publicToken).slice(0, 20)}`;

    const tag = await prisma.tag.create({
      data: {
        publicTagId,
        publicTokenHash: sha256(publicToken),
        publicTokenEncrypted: encryptField(publicToken, "tag_token"),
        tagType: input.tagType as never,
        status: "CREATED",
        assetId: input.assetId ?? null,
        ownerId: input.ownerId,
        label: input.label,
      },
    });

    await audit({
      actorUserId: input.ownerId,
      action: "tag.create",
      resourceType: "tag",
      resourceId: tag.id,
      ip: input.ip,
      metadata: { tagType: input.tagType },
    });

    log.info({ tagId: tag.id, ownerId: input.ownerId }, "tag created");
    return { tagId: tag.id, publicTagId: tag.publicTagId, publicToken, status: tag.status };
  },

  async listTags(ownerId: string) {
    return prisma.tag.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        publicTagId: true,
        tagType: true,
        status: true,
        label: true,
        assetId: true,
        activatedAt: true,
        deactivatedAt: true,
        createdAt: true,
        asset: { select: { id: true, assetType: true, displayName: true } },
      },
    });
  },

  async activateTag(input: { tagId: string; ownerId: string; ip?: string }) {
    const tag = await this.ownedTag(input.tagId, input.ownerId);

    if (tag.status === "ACTIVE") return { id: tag.id, status: tag.status, activatedAt: tag.activatedAt };
    if (["DEACTIVATED", "TRANSFERRED"].includes(tag.status)) {
      throw conflict("This tag cannot be reactivated. Create a replacement tag.");
    }

    const updated = await prisma.tag.update({
      where: { id: tag.id },
      data: { status: "ACTIVE", activatedAt: new Date(), deactivatedAt: null },
    });
    await prisma.tagEvent.create({ data: { tagId: tag.id, eventType: "TAG_ACTIVATED" } });
    await audit({
      actorUserId: input.ownerId,
      action: "tag.activate",
      resourceType: "tag",
      resourceId: tag.id,
      ip: input.ip,
    });
    return { id: updated.id, status: updated.status, activatedAt: updated.activatedAt };
  },

  async deactivateTag(input: { tagId: string; ownerId: string; reason?: string; ip?: string }) {
    const tag = await this.ownedTag(input.tagId, input.ownerId);
    if (tag.status === "DEACTIVATED") return { id: tag.id, status: tag.status };

    const updated = await prisma.tag.update({
      where: { id: tag.id },
      data: { status: "DEACTIVATED", deactivatedAt: new Date() },
    });
    await prisma.tagEvent.create({ data: { tagId: tag.id, eventType: "TAG_DEACTIVATED" } });
    await audit({
      actorUserId: input.ownerId,
      action: "tag.deactivate",
      resourceType: "tag",
      resourceId: tag.id,
      ip: input.ip,
      metadata: { reason: input.reason },
    });
    return { id: updated.id, status: updated.status };
  },

  /**
   * Rotating the public token is the response to a lost or stolen tag: the old
   * QR stops resolving immediately, and only the new one works.
   */
  async rotateToken(input: { tagId: string; ownerId: string; ip?: string }) {
    const tag = await this.ownedTag(input.tagId, input.ownerId);
    const publicToken = generatePublicTagToken();

    await prisma.tag.update({
      where: { id: tag.id },
      data: {
        publicTokenHash: sha256(publicToken),
        publicTokenEncrypted: encryptField(publicToken, "tag_token"),
      },
    });

    await audit({
      actorUserId: input.ownerId,
      action: "tag.rotate_token",
      resourceType: "tag",
      resourceId: tag.id,
      ip: input.ip,
    });
    log.warn({ tagId: tag.id, ownerId: input.ownerId }, "public token rotated");
    return { tagId: tag.id, publicToken };
  },

  /**
   * Owner-only access to the tag's public token, used to re-render the QR/eTag
   * later. Requires ownership; the scanner path only ever uses the hash.
   */
  async publicTokenForOwner(tagId: string, ownerId: string): Promise<string> {
    const tag = await this.ownedTag(tagId, ownerId);
    return decryptField(tag.publicTokenEncrypted, "tag_token");
  },

  /**
   * NFC association. The UID is stored as a keyed hash; a raw NFC UID is a
   * physical identifier that must not be recoverable from a database dump.
   */
  async linkNfc(input: { tagId: string; ownerId: string; nfcUid: string; ip?: string }) {
    const tag = await this.ownedTag(input.tagId, input.ownerId);
    const nfcUidHash = lookupHmac(input.nfcUid.toUpperCase(), "nfc");

    const existing = await prisma.tag.findUnique({ where: { nfcUidHash } });
    if (existing && existing.id !== tag.id) {
      throw conflict("This NFC tag is already linked to another Sampark tag");
    }

    await prisma.tag.update({ where: { id: tag.id }, data: { nfcUidHash } });
    await audit({
      actorUserId: input.ownerId,
      action: "tag.link_nfc",
      resourceType: "tag",
      resourceId: tag.id,
      ip: input.ip,
    });
    return { tagId: tag.id, nfcLinked: true };
  },

  async linkAsset(input: { tagId: string; ownerId: string; assetId: string; ip?: string }) {
    const tag = await this.ownedTag(input.tagId, input.ownerId);
    const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw notFound("Asset not found");
    if (asset.ownerId !== input.ownerId) throw forbidden("You do not own this asset");

    await prisma.tag.update({ where: { id: tag.id }, data: { assetId: asset.id } });
    await audit({
      actorUserId: input.ownerId,
      action: "tag.link_asset",
      resourceType: "tag",
      resourceId: tag.id,
      ip: input.ip,
      metadata: { assetId: asset.id },
    });
    return { tagId: tag.id, assetId: asset.id };
  },

  async history(tagId: string, ownerId: string) {
    const tag = await this.ownedTag(tagId, ownerId);
    return prisma.tagEvent.findMany({
      where: { tagId: tag.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, eventType: true, createdAt: true, metadata: true },
    });
  },

  async ownedTag(tagId: string, ownerId: string) {
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag || tag.deletedAt) throw notFound("Tag not found");
    if (tag.ownerId !== ownerId) throw forbidden("You do not own this tag");
    return tag;
  },

  /**
   * Public resolution used by the privacy gateway. Returns ONLY the authorized
   * display projection plus enabled channels — never name, phone, email or
   * address (spec 8.1, 32.2).
   */
  async resolveForScanner(publicToken: string) {
    const tag = await prisma.tag.findUnique({
      where: { publicTokenHash: sha256(publicToken) },
      include: { owner: true, asset: { include: { vehicle: true } } },
    });

    if (!tag || tag.deletedAt) throw notFound("This code is not valid");

    // A tag that exists but is deactivated, suspended, or whose owner is gone is
    // reported exactly like a code that never existed. Distinguishing the two
    // would turn this endpoint into an oracle for testing stolen or guessed
    // tokens, and would confirm a tag ever existed after the owner retired it.
    if (tag.status !== "ACTIVE") {
      throw notFound("This code is not valid");
    }

    const owner = tag.owner;
    if (owner.status !== "ACTIVE" || owner.deletedAt) {
      throw notFound("This code is not valid");
    }

    const vehicle = tag.asset?.vehicle ?? null;
    const assetType = tag.asset?.assetType ?? null;

    const reasons = CONTACT_REASONS.filter(
      (r) => r.assetTypes.length === 0 || (assetType ? (r.assetTypes as readonly string[]).includes(assetType) : true),
    ).map((r) => ({ code: r.code, label: r.label }));

    const enabledChannels = (owner.enabledChannels ?? []).filter((c) => c !== "PUSH");

    return {
      tag: {
        publicTagId: tag.publicTagId,
        tagType: tag.tagType,
        status: tag.status,
      },
      display: {
        assetType,
        displayName: tag.asset?.displayName ?? null,
        make: vehicle?.make ?? null,
        model: vehicle?.model ?? null,
        color: vehicle?.color ?? null,
        // Only the last four characters are ever exposed.
        registrationEnding: vehicle?.registrationEnding ?? null,
      },
      channels: {
        voice: enabledChannels.includes("VOICE") && owner.allowUnknownCallers,
        sms: enabledChannels.includes("SMS"),
        whatsapp: enabledChannels.includes("WHATSAPP"),
        chat: enabledChannels.includes("CHAT"),
        video: enabledChannels.includes("VIDEO") && owner.allowVideoCalls,
        emergency: true,
        locationShare: owner.allowLocationShare,
      },
      reasons,
      owner: {
        // Display name is an owner choice; defaults to a neutral label.
        displayName: owner.nameEncrypted ? null : "Tag owner",
        businessHours: null,
      },
    };
  },

  qrPayloadFor(publicToken: string): string {
    return `${env.WEB_BASE_URL.replace(/\/$/, "")}/t/${publicToken}`;
  },

  /**
   * Generate custom QR code with theme, shape, size, and logo options
   */
  async generateCustomQR(input: {
    ownerId: string;
    tagId: string;
    size?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    colorDark?: string;
    colorLight?: string;
    shape?: 'square' | 'rounded' | 'dots' | 'classy' | 'classy-rounded' | 'custom';
    theme?: string;
    logo?: { src: string; size?: number; background?: string; borderRadius?: number };
    format?: 'png' | 'svg' | 'jpeg' | 'webp';
    quality?: number;
  }): Promise<{ qrCodeDataUrl: string; publicToken: string }> {
    const tag = await this.ownedTag(input.tagId, input.ownerId);
    const publicToken = await this.publicTokenForOwner(input.tagId, input.ownerId);
    const qrPayload = this.qrPayloadFor(publicToken);

    // For now, we'll return the basic QR payload and let the frontend handle customization
    // In a full implementation, this would use a QR code library with customization options
    // and return a base64 encoded image
    const { QRCodeGenerator } = await import('../qr/qr-generator');

    const result = await QRCodeGenerator.generate({
      data: qrPayload,
      size: input.size || 512,
      errorCorrectionLevel: input.errorCorrectionLevel || 'H',
      margin: input.margin || 2,
      colorDark: input.colorDark,
      colorLight: input.colorLight,
      shape: input.shape,
      theme: input.theme,
      logo: input.logo,
      format: input.format,
      quality: input.quality,
    });

    return { qrCodeDataUrl: result.dataUrl, publicToken };
  },

  reasonIsAllowed(reasonCode: string, assetType: string | null): boolean {
    const reason = reasonFor(reasonCode);
    if (!reason) return false;
    if (reason.assetTypes.length === 0) return true;
    return assetType ? (reason.assetTypes as readonly string[]).includes(assetType) : false;
  },
};
