"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vehicleService = exports.assetService = void 0;
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const log = (0, logger_1.childLogger)("vehicles");
exports.assetService = {
    async createAsset(input) {
        const asset = await prisma_1.prisma.asset.create({
            data: { ownerId: input.ownerId, assetType: input.assetType, displayName: input.displayName },
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "asset.create",
            resourceType: "asset",
            resourceId: asset.id,
            ip: input.ip,
            metadata: { assetType: input.assetType },
        });
        return asset;
    },
    async listAssets(ownerId) {
        return prisma_1.prisma.asset.findMany({
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
exports.vehicleService = {
    /**
     * Vehicle registration is personal data: stored encrypted with a keyed lookup
     * HMAC, and only the last four characters are ever exposed publicly
     * (spec 20, 9.2).
     */
    async createVehicle(input) {
        const asset = await prisma_1.prisma.asset.findUnique({ where: { id: input.assetId } });
        if (!asset)
            throw (0, errors_1.notFound)("Asset not found");
        if (asset.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("You do not own this asset");
        const registration = (0, crypto_1.normalizeRegistration)(input.registration);
        const existing = await prisma_1.prisma.vehicle.findUnique({
            where: { registrationLookupHmac: (0, crypto_1.lookupHmac)(registration, "registration") },
        });
        if (existing && existing.ownerId === input.ownerId) {
            throw (0, errors_1.conflict)("A vehicle with this registration already exists on your account");
        }
        if (existing) {
            throw (0, errors_1.conflict)("That registration is already registered with another Sampark account");
        }
        const vehicle = await prisma_1.prisma.vehicle.create({
            data: {
                assetId: input.assetId,
                ownerId: input.ownerId,
                registrationEncrypted: (0, crypto_1.encryptField)(registration, "registration"),
                registrationLookupHmac: (0, crypto_1.lookupHmac)(registration, "registration"),
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
        await (0, audit_service_1.audit)({
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
    toOwnerView(vehicle) {
        return {
            id: vehicle.id,
            registration: (0, crypto_1.decryptField)(vehicle.registrationEncrypted, "registration"),
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
    async listVehicles(ownerId) {
        const vehicles = await prisma_1.prisma.vehicle.findMany({
            where: { ownerId },
            orderBy: { createdAt: "desc" },
        });
        return vehicles.map((v) => this.toOwnerView(v));
    },
    async updateVehicle(input) {
        const vehicle = await this.ownedVehicle(input.vehicleId, input.ownerId);
        // Registration changes need re-encryption; other fields pass through.
        const data = {};
        if (typeof input.patch.registration === "string") {
            const registration = (0, crypto_1.normalizeRegistration)(input.patch.registration);
            data.registrationEncrypted = (0, crypto_1.encryptField)(registration, "registration");
            data.registrationLookupHmac = (0, crypto_1.lookupHmac)(registration, "registration");
            data.registrationEnding = registration.slice(-4);
        }
        for (const key of ["make", "model", "variant", "color", "year", "vehicleType", "fuelType", "status", "insuranceExpiry", "pucExpiry", "fastagStatus"]) {
            if (key in input.patch)
                data[key] = input.patch[key];
        }
        const updated = await prisma_1.prisma.vehicle.update({ where: { id: vehicle.id }, data: data });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "vehicle.update",
            resourceType: "vehicle",
            resourceId: vehicle.id,
            ip: input.ip,
            metadata: { fields: Object.keys(data) },
        });
        return this.toOwnerView(updated);
    },
    async deleteVehicle(input) {
        const vehicle = await this.ownedVehicle(input.vehicleId, input.ownerId);
        await prisma_1.prisma.vehicle.delete({ where: { id: vehicle.id } });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "vehicle.delete",
            resourceType: "vehicle",
            resourceId: vehicle.id,
            ip: input.ip,
        });
    },
    async ownedVehicle(vehicleId, ownerId) {
        const vehicle = await prisma_1.prisma.vehicle.findUnique({ where: { id: vehicleId } });
        if (!vehicle)
            throw (0, errors_1.notFound)("Vehicle not found");
        if (vehicle.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("You do not own this vehicle");
        return vehicle;
    },
    /** Activity log (spec 23). */
    async activity(vehicleId, ownerId, limit = 100) {
        await this.ownedVehicle(vehicleId, ownerId);
        return prisma_1.prisma.vehicleEvent.findMany({
            where: { vehicleId },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { id: true, eventType: true, description: true, createdAt: true },
        });
    },
    async recordEvent(input) {
        return prisma_1.prisma.vehicleEvent.create({
            data: {
                vehicleId: input.vehicleId,
                tagId: input.tagId,
                eventType: input.eventType,
                description: input.description,
                geo: (input.geo ?? null),
            },
        });
    },
    /**
     * Vehicle search (spec 22). Requires an authorized external provider; this
     * service never queries public or scraped registries, and every access is
     * logged for audit.
     */
    async searchRegistration(input) {
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "vehicle.search",
            resourceType: "vehicle_registration",
            ip: input.ip,
            metadata: { registrationEnding: (0, crypto_1.normalizeRegistration)(input.registration).slice(-4) },
        });
        log.warn({ ownerId: input.ownerId }, "vehicle search requires an authorized external provider adapter");
        return {
            available: false,
            reason: "VEHICLE_SEARCH_PROVIDER_NOT_CONFIGURED",
            message: "Vehicle search needs an authorized registry provider under a signed agreement. No unofficial or scraped data source is used.",
        };
    },
};
//# sourceMappingURL=vehicle.service.js.map