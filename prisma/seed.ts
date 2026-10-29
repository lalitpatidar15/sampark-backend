/**
 * Development and review seed data.
 *
 * Creates the staff accounts the admin console needs to sign in, plus a small
 * amount of realistic operational data so the dashboard is not empty. Staff sign
 * in with an OTP exactly like any other user; no credential is ever stored here.
 *
 *   npm run prisma:seed
 */

import { PrismaClient, type UserRole } from "@prisma/client";
import {
  encryptField,
  FIELD,
  lookupHmac,
  normalizePhone,
  randomToken,
  sha256,
} from "../src/common/utils/crypto";

const prisma = new PrismaClient();

const STAFF: {
  role: Extract<UserRole, "SUPER_ADMIN" | "ADMIN" | "SUPPORT_AGENT" | "SOCIETY_OPERATOR">;
  phone: string;
  name: string;
}[] = [
  // Super admin exists so the console's super-admin-only screens (feature
  // flags, provider credentials) are reachable in local development.
  { role: "SUPER_ADMIN", phone: "9000000000", name: "Sampark Super Admin" },
  { role: "ADMIN", phone: "9000000001", name: "Sampark Admin" },
  { role: "SUPPORT_AGENT", phone: "9000000002", name: "Support Desk" },
  { role: "SOCIETY_OPERATOR", phone: "9000000003", name: "Society Operator" },
];

const OWNERS: { phone: string; name: string; registration: string; make: string; model: string }[] = [
  { phone: "9100000001", name: "Ananya Sharma", registration: "MH12AB1001", make: "Hyundai", model: "Creta" },
  { phone: "9100000002", name: "Rohit Verma", registration: "MH12AB1002", make: "Maruti", model: "Swift" },
  { phone: "9100000003", name: "Meera Iyer", registration: "KA01AB1003", make: "Tata", model: "Nexon" },
];

const publicId = (prefix: string): string => `${prefix}_${randomToken(9).replace(/[^a-zA-Z0-9]/g, "")}`;

async function upsertUser(input: { role: UserRole; phone: string; name: string }): Promise<string> {
  const phone = normalizePhone(input.phone);
  const hmac = lookupHmac(phone, "phone");

  // The AAD context must match the one the application decrypts with, or the
  // row is written successfully and can never be read again.
  const existing = await prisma.user.findUnique({ where: { phoneLookupHmac: hmac } });
  if (existing) {
    // Re-encrypt on every run so a seed written by an older version is repaired.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: input.role,
        status: "ACTIVE",
        nameEncrypted: encryptField(input.name, FIELD.userName),
        phoneEncrypted: encryptField(phone, FIELD.userPhone),
      },
    });
    return existing.id;
  }

  const created = await prisma.user.create({
    data: {
      publicId: publicId("usr"),
      role: input.role,
      status: "ACTIVE",
      nameEncrypted: encryptField(input.name, FIELD.userName),
      phoneEncrypted: encryptField(phone, FIELD.userPhone),
      phoneLookupHmac: hmac,
      lastLoginAt: new Date(),
    },
  });
  return created.id;
}

/** Finds the owner's vehicle for a registration, or creates the asset for it. */
async function ensureAsset(userId: string, model: string): Promise<string> {
  const vehicles = await prisma.vehicle.findMany({
    where: { ownerId: userId },
    include: { asset: true },
  });
  const existing = vehicles[0];
  if (existing) {
    await prisma.asset.update({ where: { id: existing.assetId }, data: { displayName: model } });
    return existing.assetId;
  }
  const asset = await prisma.asset.create({
    data: { ownerId: userId, assetType: "VEHICLE", displayName: model },
  });
  return asset.id;
}

async function seedOwners(): Promise<void> {
  for (const owner of OWNERS) {
    const userId = await upsertUser({ role: "OWNER", phone: owner.phone, name: owner.name });
    const assetId = await ensureAsset(userId, owner.model);

    const registration = owner.registration.toUpperCase();
    const vehicle = await prisma.vehicle.upsert({
      where: { registrationLookupHmac: lookupHmac(registration, "registration") },
      update: {
        // Re-encrypt so a row written by an older seed becomes readable again.
        registrationEncrypted: encryptField(registration, FIELD.vehicleRegistration),
      },
      create: {
        ownerId: userId,
        assetId,
        registrationEncrypted: encryptField(registration, FIELD.vehicleRegistration),
        registrationLookupHmac: lookupHmac(registration, "registration"),
        registrationEnding: registration.slice(-4),
        make: owner.make,
        model: owner.model,
        color: "White",
      },
    });

    // The plaintext QR token is only ever shown once at creation time, so the
    // seed mints its own and never needs to be recovered.
    const publicToken = randomToken(24);
    const existingTag = await prisma.tag.findFirst({ where: { assetId, ownerId: userId } });
    if (existingTag) {
      // Repair rows written by an older seed so the owner can re-render the QR.
      await prisma.tag.update({
        where: { id: existingTag.id },
        data: { publicTokenEncrypted: encryptField(publicToken, FIELD.tagPublicToken) },
      });
    } else {
      await prisma.tag.create({
        data: {
          publicTagId: publicId("tag"),
          publicTokenHash: sha256(publicToken),
          publicTokenEncrypted: encryptField(publicToken, FIELD.tagPublicToken),
          tagType: "VEHICLE",
          status: "ACTIVE",
          assetId,
          ownerId: userId,
          label: `${owner.make} ${owner.model}`,
          activatedAt: new Date(),
        },
      });
    }

    process.stdout.write(`  owner  ${owner.name.padEnd(16)} ${registration}  ${owner.make} ${owner.model}\n`);
    void vehicle;
  }
}

async function seedFeatureFlags(): Promise<void> {
  const flags: { key: string; enabled: boolean; rolloutPct: number; rules: object }[] = [
    { key: "emergency_alerts", enabled: true, rolloutPct: 100, rules: {} },
    { key: "location_share", enabled: true, rolloutPct: 100, rules: {} },
    { key: "video_calls", enabled: false, rolloutPct: 0, rules: {} },
    { key: "nfc_tag_linking", enabled: true, rolloutPct: 100, rules: {} },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { enabled: flag.enabled, rolloutPct: flag.rolloutPct },
      create: { key: flag.key, enabled: flag.enabled, rolloutPct: flag.rolloutPct, rules: flag.rules },
    });
  }
  process.stdout.write(`  flags  ${flags.length} feature flags\n`);
}

async function main(): Promise<void> {
  process.stdout.write("Seeding Sampark data\n");

  for (const member of STAFF) {
    await upsertUser(member);
    process.stdout.write(`  staff  ${member.role.padEnd(17)} ${member.phone}  ${member.name}\n`);
  }

  await seedOwners();
  await seedFeatureFlags();

  process.stdout.write(
    "\nDone. Sign in to the admin console with a staff phone above. In local\n" +
      "development the mock provider returns the OTP as `devCode` in the API response.\n",
  );
}

main()
  .catch((err) => {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
