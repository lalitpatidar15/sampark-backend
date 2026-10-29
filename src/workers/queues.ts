import { Queue, type JobsOptions } from "bullmq";
import { redisConnection } from "../db/redis";

export const QUEUE_NAMES = {
  COMMUNICATION: "communication",
  NOTIFICATION: "notification",
  DOCUMENT: "document",
  REMINDER: "reminder",
  FRAUD: "fraud",
  ANALYTICS: "analytics",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const connection = redisConnection;

const createQueue = <T>(name: QueueName, defaultJobOptions: JobsOptions): Queue<T> =>
  new Queue<T>(name, {
    connection,
    defaultJobOptions,
  });

/**
 * Provider dispatch is queued so a slow or hanging telecom provider cannot
 * block a scanner's HTTP request, and so delivery can be retried independently.
 */
export const communicationQueue = createQueue<{ communicationSessionId: string; channel: string }>(
  QUEUE_NAMES.COMMUNICATION,
  { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
);

export const notificationQueue = createQueue<{ userId: string; kind: string; payload?: Record<string, unknown> }>(
  QUEUE_NAMES.NOTIFICATION,
  { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000 },
);

export const documentQueue = createQueue<{ documentId: string }>(QUEUE_NAMES.DOCUMENT, {
  attempts: 3,
  removeOnComplete: 500,
});

export const reminderQueue = createQueue<{ sweep: boolean }>(QUEUE_NAMES.REMINDER, {
  attempts: 2,
  removeOnComplete: 100,
});

export const fraudQueue = createQueue<{ tagId: string; reason: string; metadata?: Record<string, unknown> }>(
  QUEUE_NAMES.FRAUD,
  { attempts: 3, removeOnComplete: 2000 },
);

export const analyticsQueue = createQueue<{ date: string }>(QUEUE_NAMES.ANALYTICS, {
  attempts: 2,
  removeOnComplete: 100,
});

export const enqueueCommunicationJob = async (payload: { communicationSessionId: string; channel: string }): Promise<void> => {
  await communicationQueue.add("dispatch", payload, { jobId: `comm-${payload.communicationSessionId}` });
};

export const enqueueNotification = async (payload: { userId: string; kind: string; payload?: Record<string, unknown> }): Promise<void> => {
  // BullMQ rejects ":" inside a jobId, so the dedupe key uses "-" separators.
  await notificationQueue.add("notify", payload, {
    jobId: `notif-${payload.userId}-${payload.kind}-${Date.now()}`,
  });
};

export const enqueueFraudReview = async (payload: { tagId: string; reason: string; metadata?: Record<string, unknown> }): Promise<void> => {
  await fraudQueue.add("review", payload);
};

export const closeQueues = async (): Promise<void> => {
  await Promise.allSettled([
    communicationQueue.close(),
    notificationQueue.close(),
    documentQueue.close(),
    reminderQueue.close(),
    fraudQueue.close(),
    analyticsQueue.close(),
  ]);
};
