import { prisma } from "../../db/prisma";
import { conflict, forbidden, notFound } from "../../common/errors";
import {
  decryptField,
  encryptField,
  lookupHmac,
  normalizeRegistration,
} from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";

const log = childLogger("vehicles");

export const assetService = {
  async createAsset(input: { ownerId: string; assetType: string; displayName: string; ip?: string }) {
    const asset = await prisma.asset.create({
      data: { ownerId: input.ownerId, assetType: input.assetType as never, displayName: input.displayName },
    });
    await audit({
      actorUserId: input.ownerId,
      action: "asset.create",
      resourceType: "asset",
      resourceId: asset.id,
      ip: input.ip,
      metadata: { assetType: input.assetType },
    });
    return asset;
  },

  async listAssets(ownerId: string) {
    return prisma.asset.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      include: {
        vehicle: {
          select: {
            id: true,
            make: true,
            model: true,
            variant: true,
            color: true,
            year: true,
            vehicleType: true,
            fuelType: true,
            status: true,
            registrationEnding: true,
            insuranceExpiry: true,
            pucExpiry: true,
            fastagStatus: true,
          },
        },
        tags: { select: { id: true, publicTagId: true, status: true, tagType: true } },
      },
    });
  },
};

export const vehicleService = {
  /**
   * Vehicle registration is personal data: stored encrypted with a keyed lookup
   * HMAC, and only the last four characters are ever exposed publicly
   * (spec 20, 9.2).
   */
  async createVehicle(input: {
    ownerId: string;
    assetId: string;
    registration: string;
    make?: string;
    model?: string;
    variant?: string;
    color?: string;
    year?: number;
    vehicleType?: string;
    fuelType?: string;
    insuranceExpiry?: Date;
    pucExpiry?: Date;
    fastagStatus?: string;
    ip?: string;
  }) {
    const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw notFound("Asset not found");
    if (asset.ownerId !== input.ownerId) throw forbidden("You do not own this asset");

    const registration = normalizeRegistration(input.registration);
    const existing = await prisma.vehicle.findUnique({
      where: { registrationLookupHmac: lookupHmac(registration, "registration") },
    });
    if (existing && existing.ownerId === input.ownerId) {
      throw conflict("A vehicle with this registration already exists on your account");
    }
    if (existing) {
      throw conflict("That registration is already registered with another Sampark account");
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        assetId: input.assetId,
        ownerId: input.ownerId,
        registrationEncrypted: encryptField(registration, "registration"),
        registrationLookupHmac: lookupHmac(registration, "registration"),
        registrationEnding: registration.slice(-4),
        make: input.make,
        model: input.model,
        variant: input.variant,
        color: input.color,
        year: input.year,
        vehicleType: input.vehicleType,
        fuelType: input.fuelType,
        insuranceExpiry: input.insuranceExpiry,
        pucExpiry: input.pucExpiry,
        fastagStatus: input.fastagStatus,
      },
    });

    await audit({
      actorUserId: input.ownerId,
      action: "vehicle.create",
      resourceType: "vehicle",
      resourceId: vehicle.id,
      ip: input.ip,
      metadata: { assetId: input.assetId },
    });

    log.info({ vehicleId: vehicle.id, ownerId: input.ownerId }, "vehicle created");
    return this.toOwnerView(vehicle);
  },

  toOwnerView(vehicle: {
    id: string;
    registrationEncrypted: string;
    registrationEnding: string;
    make: string | null;
    model: string | null;
    variant: string | null;
    color: string | null;
    year: number | null;
    vehicleType: string | null;
    fuelType: string | null;
    status: string;
    insuranceExpiry: Date | null;
    pucExpiry: Date | null;
    fastagStatus: string | null;
    createdAt: Date;
  }) {
    return {
      id: vehicle.id,
      registration: decryptField(vehicle.registrationEncrypted, "registration"),
      registrationEnding: vehicle.registrationEnding,
      make: vehicle.make,
      model: vehicle.model,
      variant: vehicle.variant,
      color: vehicle.color,
      year: vehicle.year,
      vehicleType: vehicle.vehicleType,
      fuelType: vehicle.fuelType,
      status: vehicle.status,
      insuranceExpiry: vehicle.insuranceExpiry,
      pucExpiry: vehicle.pucExpiry,
      fastagStatus: vehicle.fastagStatus,
      createdAt: vehicle.createdAt,
    };
  },

  async listVehicles(ownerId: string) {
    const vehicles = await prisma.vehicle.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
    });
    return vehicles.map((v) => this.toOwnerView(v));
  },

  async updateVehicle(input: {
    ownerId: string;
    vehicleId: string;
    patch: Record<string, unknown>;
    ip?: string;
  }) {
    const vehicle = await this.ownedVehicle(input.vehicleId, input.ownerId);

    // Registration changes need re-encryption; other fields pass through.
    const data: Record<string, unknown> = {};
    if (typeof input.patch.registration === "string") {
      const registration = normalizeRegistration(input.patch.registration);
      data.registrationEncrypted = encryptField(registration, "registration");
      data.registrationLookupHmac = lookupHmac(registration, "registration");
      data.registrationEnding = registration.slice(-4);
    }
    for (const key of ["make", "model", "variant", "color", "year", "vehicleType", "fuelType", "status", "insuranceExpiry", "pucExpiry", "fastagStatus"]) {
      if (key in input.patch) data[key] = input.patch[key];
    }

    const updated = await prisma.vehicle.update({ where: { id: vehicle.id }, data: data as never });
    await audit({
      actorUserId: input.ownerId,
      action: "vehicle.update",
      resourceType: "vehicle",
      resourceId: vehicle.id,
      ip: input.ip,
      metadata: { fields: Object.keys(data) },
    });
    return this.toOwnerView(updated);
  },

  async deleteVehicle(input: { ownerId: string; vehicleId: string; ip?: string }) {
    const vehicle = await this.ownedVehicle(input.vehicleId, input.ownerId);
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    await audit({
      actorUserId: input.ownerId,
      action: "vehicle.delete",
      resourceType: "vehicle",
      resourceId: vehicle.id,
      ip: input.ip,
    });
  },

  async ownedVehicle(vehicleId: string, ownerId: string) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw notFound("Vehicle not found");
    if (vehicle.ownerId !== ownerId) throw forbidden("You do not own this vehicle");
    return vehicle;
  },

  /** Activity log (spec 23). */
  async activity(vehicleId: string, ownerId: string, limit = 100) {
    await this.ownedVehicle(vehicleId, ownerId);
    return prisma.vehicleEvent.findMany({
      where: { vehicleId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, eventType: true, description: true, createdAt: true },
    });
  },

  async recordEvent(input: { vehicleId: string; tagId?: string; eventType: string; description?: string; geo?: unknown }) {
    return prisma.vehicleEvent.create({
      data: {
        vehicleId: input.vehicleId,
        tagId: input.tagId,
        eventType: input.eventType as never,
        description: input.description,
        geo: (input.geo ?? null) as never,
      },
    });
  },

  /**
   * Vehicle search (spec 22). Requires an authorized external provider; this
   * service never queries public or scraped registries, and every access is
   * logged for audit.
   */
  async searchRegistration(input: { ownerId: string; registration: string; ip?: string }) {
    await audit({
      actorUserId: input.ownerId,
      action: "vehicle.search",
      resourceType: "vehicle_registration",
      ip: input.ip,
      metadata: { registrationEnding: normalizeRegistration(input.registration).slice(-4) },
    });

    log.warn({ ownerId: input.ownerId }, "vehicle search requires an authorized external provider adapter");

    return {
      available: false,
      reason: "VEHICLE_SEARCH_PROVIDER_NOT_CONFIGURED",
      message:
        "Vehicle search needs an authorized registry provider under a signed agreement. No unofficial or scraped data source is used.",
    };
  },
};
