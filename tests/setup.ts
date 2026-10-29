import { PrismaClient } from "@prisma/client";

/**
 * Integration tests need a live Postgres + Redis. They are opt-in so the default
 * `npm test` run stays fast and hermetic. Set `RUN_INTEGRATION=1` (with the
 * services running) to execute them.
 */
export const integrationEnabled = process.env.RUN_INTEGRATION === "1";

export const prisma = new PrismaClient();

export const TABLES_TO_TRUNCATE = [
  "users",
  "tags",
  "vehicles",
  "assets",
  "documents",
  "communication_sessions",
  "scanner_sessions",
  "emergency_contacts",
  "emergency_alerts",
  "location_shares",
  "family_members",
  "orders",
  "subscriptions",
  "audit_logs",
  "abuse_reports",
  "feature_flags",
  "webhook_events",
  "devices",
  "reminders",
  "daily_metrics",
] as const;

export async function truncateAll(): Promise<void> {
  const tables = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
