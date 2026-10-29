"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeQueues = exports.enqueueFraudReview = exports.enqueueNotification = exports.enqueueCommunicationJob = exports.analyticsQueue = exports.fraudQueue = exports.reminderQueue = exports.documentQueue = exports.notificationQueue = exports.communicationQueue = exports.QUEUE_NAMES = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../db/redis");
exports.QUEUE_NAMES = {
    COMMUNICATION: "communication",
    NOTIFICATION: "notification",
    DOCUMENT: "document",
    REMINDER: "reminder",
    FRAUD: "fraud",
    ANALYTICS: "analytics",
};
const connection = redis_1.redisConnection;
const createQueue = (name, defaultJobOptions) => new bullmq_1.Queue(name, {
    connection,
    defaultJobOptions,
});
/**
 * Provider dispatch is queued so a slow or hanging telecom provider cannot
 * block a scanner's HTTP request, and so delivery can be retried independently.
 */
exports.communicationQueue = createQueue(exports.QUEUE_NAMES.COMMUNICATION, { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 });
exports.notificationQueue = createQueue(exports.QUEUE_NAMES.NOTIFICATION, { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000 });
exports.documentQueue = createQueue(exports.QUEUE_NAMES.DOCUMENT, {
    attempts: 3,
    removeOnComplete: 500,
});
exports.reminderQueue = createQueue(exports.QUEUE_NAMES.REMINDER, {
    attempts: 2,
    removeOnComplete: 100,
});
exports.fraudQueue = createQueue(exports.QUEUE_NAMES.FRAUD, { attempts: 3, removeOnComplete: 2000 });
exports.analyticsQueue = createQueue(exports.QUEUE_NAMES.ANALYTICS, {
    attempts: 2,
    removeOnComplete: 100,
});
const enqueueCommunicationJob = async (payload) => {
    await exports.communicationQueue.add("dispatch", payload, { jobId: `comm-${payload.communicationSessionId}` });
};
exports.enqueueCommunicationJob = enqueueCommunicationJob;
const enqueueNotification = async (payload) => {
    // BullMQ rejects ":" inside a jobId, so the dedupe key uses "-" separators.
    await exports.notificationQueue.add("notify", payload, {
        jobId: `notif-${payload.userId}-${payload.kind}-${Date.now()}`,
    });
};
exports.enqueueNotification = enqueueNotification;
const enqueueFraudReview = async (payload) => {
    await exports.fraudQueue.add("review", payload);
};
exports.enqueueFraudReview = enqueueFraudReview;
const closeQueues = async () => {
    await Promise.allSettled([
        exports.communicationQueue.close(),
        exports.notificationQueue.close(),
        exports.documentQueue.close(),
        exports.reminderQueue.close(),
        exports.fraudQueue.close(),
        exports.analyticsQueue.close(),
    ]);
};
exports.closeQueues = closeQueues;
//# sourceMappingURL=queues.js.map