import { Worker, type Job } from "bullmq";
import { prisma } from "../db/prisma";
import { redisConnection } from "../db/redis";
import { childLogger } from "../common/logger";
import { communicationService } from "../modules/communication/communication.service";
import { emergencyService } from "../modules/emergency/emergency.service";
import { pushProvider } from "../providers";
import {
  analyticsQueue,
  closeQueues,
  communicationQueue,
  documentQueue,
  fraudQueue,
  notificationQueue,
  reminderQueue,
  type QueueName,
} from "./queues";

const log = childLogger("worker");

/**
 * Workers run in-process with the API (spec 32: modular monolith + workers).
 * They are isolated behind queue contracts so they can be split into a separate
 * deployment later without changing producers.
 */

const connection = redisConnection;

const started: Worker[] = [];

const register = (queue: QueueName, worker: Worker): void => {
  started.push(worker);
  worker.on("completed", (job: Job) => log.debug({ queue, jobId: job.id }, "job completed"));
  worker.on("failed", (job: Job | undefined, err: Error) =>
    log.error({ queue, jobId: job?.id, err: err.message }, "job failed"),
  );
};

/** Provider dispatch: allocate relays, send alerts, open chats. */
const communicationWorker = new Worker<{ communicationSessionId: string; channel: string }>(
  "communication",
  async (job) => {
    await communicationService.dispatch(job.data.communicationSessionId);
  },
  { connection, concurrency: 20 },
);

/** Owner notifications: push, SMS and WhatsApp fan-out. */
const notificationWorker = new Worker<{ userId: string; kind: string; payload?: Record<string, unknown> }>(
  "notification",
  async (job) => {
    const { userId, kind, payload } = job.data;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") {
      log.debug({ userId, kind }, "skipping notification for inactive user");
      return;
    }

    const devices = await prisma.device.findMany({ where: { userId } });
    const pushTokens = devices
      .map((d) => d.pushTokenEncrypted)
      .filter((t): t is string => Boolean(t));

    if (pushTokens.length > 0) {
      await pushProvider.send({
        deviceTokens: pushTokens,
        title: String(payload?.title ?? "Sampark"),
        body: String(payload?.body ?? "You have a new alert"),
        data: { kind },
      });
    }

    // Emergency fan-out is dispatched through the same queue so an alert is
    // never lost if a provider is down.
    if (kind === "EMERGENCY" && typeof payload?.alertId === "string") {
      await emergencyService.notifyPriorityContacts(userId, payload.alertId);
    }
  },
  { connection, concurrency: 10 },
);

const documentWorker = new Worker<{ documentId: string }>(
  "document",
  async (job) => {
    // Malware scanning integration point (spec 21). A quarantined object is
    // never downloadable until a scanner adapter is configured.
    await prisma.document.update({
      where: { id: job.data.documentId },
      data: { status: "PENDING_SCAN", scanFinding: "scanner_not_configured" },
    });
    log.warn({ documentId: job.data.documentId }, "no virus scanner configured; document held in PENDING_SCAN");
  },
  { connection, concurrency: 5 },
);

const reminderWorker = new Worker<{ sweep: boolean }>(
  "reminder",
  async () => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const due = await prisma.reminder.findMany({
      where: { status: "PENDING", dueAt: { lte: horizon } },
      take: 500,
    });

    for (const reminder of due) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { status: "QUEUED", sentAt: now } });
      await notificationQueue.add("notify", {
        userId: reminder.userId,
        kind: "REMINDER",
        payload: { title: reminder.title, body: `${reminder.reminderType} reminder`, reminderId: reminder.id },
      });
    }
    log.info({ count: due.length }, "reminder sweep complete");
  },
  { connection, concurrency: 1 },
);

const fraudWorker = new Worker<{ tagId: string; reason: string; metadata?: Record<string, unknown> }>(
  "fraud",
  async (job) => {
    const { tagId, reason, metadata } = job.data;
    const recent = await prisma.scannerSession.count({
      where: { tagId, riskState: { in: ["MEDIUM", "HIGH"] }, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
    });

    if (recent >= 5) {
      await prisma.tag.updateMany({
        where: { id: tagId, status: "ACTIVE" },
        data: { status: "SUSPENDED" },
      });
      await prisma.abuseReport.create({
        data: {
          reporterType: "SYSTEM",
          reporterRef: "fraud-worker",
          tagId,
          reason: `AUTO_SUSPEND:${reason}`,
          riskScore: 100,
          details: JSON.stringify(metadata ?? {}).slice(0, 500),
          state: "ACTIONED",
          actionTaken: "TAG_SUSPENDED",
        },
      });
      log.error({ tagId, recent, reason }, "tag auto-suspended for abuse");
    } else {
      log.warn({ tagId, recent, reason }, "abuse signal recorded below suspension threshold");
    }
  },
  { connection, concurrency: 5 },
);

const analyticsWorker = new Worker<{ date: string }>(
  "analytics",
  async (job) => {
    const date = new Date(job.data.date);
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [
      sessionsCreated,
      communicationsCreated,
      emergencyRaised,
      tagsActivated,
      usersRegistered,
      callsCompleted,
    ] = await Promise.all([
      prisma.scannerSession.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      prisma.communicationSession.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      prisma.emergencyAlert.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      prisma.tagEvent.count({ where: { eventType: "TAG_ACTIVATED", createdAt: { gte: dayStart, lt: dayEnd } } }),
      prisma.user.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
      prisma.communicationSession.count({ where: { channel: "VOICE", status: "COMPLETED", startedAt: { gte: dayStart, lt: dayEnd } } }),
    ]);

    const rows: [string, number][] = [
      ["scanner_sessions", sessionsCreated],
      ["communications", communicationsCreated],
      ["emergency_alerts", emergencyRaised],
      ["tags_activated", tagsActivated],
      ["users_registered", usersRegistered],
      ["calls_completed", callsCompleted],
    ];

    for (const [metric, value] of rows) {
      await prisma.dailyMetric.upsert({
        where: { date_metric: { date: dayStart, metric } },
        create: { date: dayStart, metric, value },
        update: { value },
      });
    }
    log.info({ date: dayStart.toISOString().slice(0, 10) }, "analytics rollup complete");
  },
  { connection, concurrency: 2 },
);

export const startWorkers = async (): Promise<void> => {
  register("communication", communicationWorker);
  register("notification", notificationWorker);
  register("document", documentWorker);
  register("reminder", reminderWorker);
  register("fraud", fraudWorker);
  register("analytics", analyticsWorker);

  // Repeatable rollups and reminder sweeps.
  await reminderQueue.add("sweep", { sweep: true }, { repeat: { every: 60 * 60 * 1000 } });
  await analyticsQueue.add(
    "rollup",
    { date: new Date().toISOString() },
    { repeat: { every: 5 * 60 * 1000 } },
  );

  log.info({ workers: started.length }, "workers started");
};

export const stopWorkers = async (): Promise<void> => {
  await Promise.allSettled(started.map((w) => w.close()));
  await closeQueues();
  await prisma.$disconnect();
};
