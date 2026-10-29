import { Redis, type RedisOptions } from "ioredis";
import { env } from "../config";
import { childLogger } from "../common/logger";

const log = childLogger("redis");

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
};

/**
 * BullMQ needs a plain host/port/password object, and it wants its own
 * connections rather than the shared command client. Parsed once here so the
 * queue definitions and workers cannot drift from the app's Redis URL.
 */
export const redisConnection = (() => {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.pathname && url.pathname.length > 1
      ? { db: Number(url.pathname.slice(1)) || 0 }
      : {}),
  };
})();

export const createRedisConnection = (name = "default"): Redis => {
  const client = new Redis(env.REDIS_URL, {
    ...baseOptions,
    connectionName: name,
  });
  client.on("error", (err) => log.error({ err, name }, "Redis error"));
  client.on("ready", () => log.info({ name }, "Redis ready"));
  return client;
};

export const redis = createRedisConnection();

export const connectRedis = async (): Promise<void> => {
  await redis.connect();
  log.info("Redis connected");
};

export const disconnectRedis = async (): Promise<void> => {
  await redis.quit();
};

export { Redis };
