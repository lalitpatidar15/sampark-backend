"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopWorkers = exports.startWorkers = void 0;
const bullmq_1 = require("bullmq");
const prisma_1 = require("../db/prisma");
const redis_1 = require("../db/redis");
const logger_1 = require("../common/logger");
const communication_service_1 = require("../modules/communication/communication.service");
const emergency_service_1 = require("../modules/emergency/emergency.service");
const providers_1 = require("../providers");
const queues_1 = require("./queues");
const log = (0, logger_1.childLogger)("worker");
/**
 * Workers run in-process with the API (spec 32: modular monolith + workers).
 * They are isolated behind queue contracts so they can be split into a separate
 * deployment later without changing producers.
 */
const connection = redis_1.redisConnection;
const started = [];
const register = (queue, worker) => {
    started.push(worker);
    worker.on("completed", (job) => log.debug({ queue, jobId: job.id }, "job completed"));
    worker.on("failed", (job, err) => log.error({ queue, jobId: job?.id, err: err.message }, "job failed"));
};
/** Provider dispatch: allocate relays, send alerts, open chats. */
const communicationWorker = new bullmq_1.Worker("communication", async (job) => {
    await communication_service_1.communicationService.dispatch(job.data.communicationSessionId);
}, { connection, concurrency: 20 });
/** Owner notifications: push, SMS and WhatsApp fan-out. */
const notificationWorker = new bullmq_1.Worker("notification", async (job) => {
    const { userId, kind, payload } = job.data;
    const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") {
        log.debug({ userId, kind }, "skipping notification for inactive user");
        return;
    }
    const devices = await prisma_1.prisma.device.findMany({ where: { userId } });
    const pushTokens = devices
        .map((d) => d.pushTokenEncrypted)
        .filter((t) => Boolean(t));
    if (pushTokens.length > 0) {
        await providers_1.pushProvider.send({
            deviceTokens: pushTokens,
            title: String(payload?.title ?? "Sampark"),
            body: String(payload?.body ?? "You have a new alert"),
            data: { kind },
        });
    }
    // Emergency fan-out is dispatched through the same queue so an alert is
    // never lost if a provider is down.
    if (kind === "EMERGENCY" && typeof payload?.alertId === "string") {
        await emergency_service_1.emergencyService.notifyPriorityContacts(userId, payload.alertId);
    }
}, { connection, concurrency: 10 });
const documentWorker = new bullmq_1.Worker("document", async (job) => {
    // Malware scanning integration point (spec 21). A quarantined object is
    // never downloadable until a scanner adapter is configured.
    await prisma_1.prisma.document.update({
        where: { id: job.data.documentId },
        data: { status: "PENDING_SCAN", scanFinding: "scanner_not_configured" },
    });
    log.warn({ documentId: job.data.documentId }, "no virus scanner configured; document held in PENDING_SCAN");
}, { connection, concurrency: 5 });
const reminderWorker = new bullmq_1.Worker("reminder", async () => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const due = await prisma_1.prisma.reminder.findMany({
        where: { status: "PENDING", dueAt: { lte: horizon } },
        take: 500,
    });
    for (const reminder of due) {
        await prisma_1.prisma.reminder.update({ where: { id: reminder.id }, data: { status: "QUEUED", sentAt: now } });
        await queues_1.notificationQueue.add("notify", {
            userId: reminder.userId,
            kind: "REMINDER",
            payload: { title: reminder.title, body: `${reminder.reminderType} reminder`, reminderId: reminder.id },
        });
    }
    log.info({ count: due.length }, "reminder sweep complete");
}, { connection, concurrency: 1 });
const fraudWorker = new bullmq_1.Worker("fraud", async (job) => {
    const { tagId, reason, metadata } = job.data;
    const recent = await prisma_1.prisma.scannerSession.count({
        where: { tagId, riskState: { in: ["MEDIUM", "HIGH"] }, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
    });
    if (recent >= 5) {
        await prisma_1.prisma.tag.updateMany({
            where: { id: tagId, status: "ACTIVE" },
            data: { status: "SUSPENDED" },
        });
        await prisma_1.prisma.abuseReport.create({
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
    }
    else {
        log.warn({ tagId, recent, reason }, "abuse signal recorded below suspension threshold");
    }
}, { connection, concurrency: 5 });
const analyticsWorker = new bullmq_1.Worker("analytics", async (job) => {
    const date = new Date(job.data.date);
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const [sessionsCreated, communicationsCreated, emergencyRaised, tagsActivated, usersRegistered, callsCompleted,] = await Promise.all([
        prisma_1.prisma.scannerSession.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
        prisma_1.prisma.communicationSession.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
        prisma_1.prisma.emergencyAlert.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
        prisma_1.prisma.tagEvent.count({ where: { eventType: "TAG_ACTIVATED", createdAt: { gte: dayStart, lt: dayEnd } } }),
        prisma_1.prisma.user.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
        prisma_1.prisma.communicationSession.count({ where: { channel: "VOICE", status: "COMPLETED", startedAt: { gte: dayStart, lt: dayEnd } } }),
    ]);
    const rows = [
        ["scanner_sessions", sessionsCreated],
        ["communications", communicationsCreated],
        ["emergency_alerts", emergencyRaised],
        ["tags_activated", tagsActivated],
        ["users_registered", usersRegistered],
        ["calls_completed", callsCompleted],
    ];
    for (const [metric, value] of rows) {
        await prisma_1.prisma.dailyMetric.upsert({
            where: { date_metric: { date: dayStart, metric } },
            create: { date: dayStart, metric, value },
            update: { value },
        });
    }
    log.info({ date: dayStart.toISOString().slice(0, 10) }, "analytics rollup complete");
}, { connection, concurrency: 2 });
const startWorkers = async () => {
    register("communication", communicationWorker);
    register("notification", notificationWorker);
    register("document", documentWorker);
    register("reminder", reminderWorker);
    register("fraud", fraudWorker);
    register("analytics", analyticsWorker);
    // Repeatable rollups and reminder sweeps.
    await queues_1.reminderQueue.add("sweep", { sweep: true }, { repeat: { every: 60 * 60 * 1000 } });
    await queues_1.analyticsQueue.add("rollup", { date: new Date().toISOString() }, { repeat: { every: 5 * 60 * 1000 } });
    log.info({ workers: started.length }, "workers started");
};
exports.startWorkers = startWorkers;
const stopWorkers = async () => {
    await Promise.allSettled(started.map((w) => w.close()));
    await (0, queues_1.closeQueues)();
    await prisma_1.prisma.$disconnect();
};
exports.stopWorkers = stopWorkers;
//# sourceMappingURL=index.js.map