import type { Redis } from "ioredis";
import { MemoryStore, type ClientRateLimitInfo, type IncrementResponse, type Store } from "express-rate-limit";
import { redis } from "../../db/redis";
import { childLogger } from "../logger";

const log = childLogger("rate-limit-store");

/**
 * Redis-backed counter store for express-rate-limit.
 *
 * The default MemoryStore keeps counts inside a single Node process, which is
 * the wrong place for them here: the API scales horizontally, so an attacker
 * would get a fresh budget on every instance behind the load balancer, and a
 * restart or deploy would silently clear the counter. Redis makes the limit
 * both shared and durable, which matters most for the OTP limiter because that
 * is the thing standing between an attacker and a phone-number takeover.
 *
 * Counts live in a Redis hash so a key's TTL is set once, on creation, instead
 * of being extended on every hit (which would let a patient attacker keep a
 * counter alive indefinitely).
 */
export class RedisRateLimitStore implements Store {
  private keyPrefix: string;
  private windowMs = 60_000;

  constructor(
    private readonly client: Redis = redis,
    prefix = "rl",
  ) {
    this.keyPrefix = prefix;
  }

  init(options: { windowMs?: number; prefix?: string }): void {
    this.windowMs = options.windowMs ?? 60_000;
    if (options.prefix) this.keyPrefix = options.prefix;
  }

  private key(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redisKey = this.key(key);
    const windowSeconds = Math.max(1, Math.ceil(this.windowMs / 1000));

    // INCR then conditionally set the TTL. Redis has no atomic "set ttl if new",
    // so this uses MULTI and accepts that two concurrent first-hits may both try
    // to set the expiry; both write the same value, so the window is unaffected.
    const results = await this.client
      .multi()
      .incr(redisKey)
      .ttl(redisKey)
      .exec();

    const totalHits = Number(results?.[0]?.[1] ?? 1);
    const ttl = Number(results?.[1]?.[1] ?? -1);

    if (totalHits === 1 || ttl < 0) {
      await this.client.expire(redisKey, windowSeconds);
    }

    const resetTime = new Date(Date.now() + Math.max(ttl, windowSeconds) * 1000);
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    const redisKey = this.key(key);
    const totalHits = await this.client.decr(redisKey);
    // Guard against a negative counter leaving a key that blocks the client
    // until the window rolls over.
    if (totalHits <= 0) await this.client.del(redisKey);
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const redisKey = this.key(key);
    const [rawTotal, ttl] = await Promise.all([this.client.get(redisKey), this.client.ttl(redisKey)]);
    if (rawTotal === null) return undefined;
    return {
      totalHits: Number(rawTotal),
      resetTime: new Date(Date.now() + Math.max(ttl, 0) * 1000),
    };
  }
}

/**
 * Returns a shared store when Redis is reachable, otherwise an in-memory store.
 *
 * A Redis outage must not turn the OTP limiter off, so the caller keeps the
 * per-process MemoryStore as a degraded fallback and the failure is logged
 * loudly rather than swallowed.
 */
export const createRateLimitStore = async (prefix: string): Promise<Store> => {
  try {
    if (redis.status === "wait" || redis.status === "connecting") await redis.connect();
    if (redis.status !== "ready") throw new Error(`redis status is ${redis.status}`);
    await redis.ping();
    log.info({ prefix }, "rate limits backed by redis");
    return new RedisRateLimitStore(redis, prefix);
  } catch (err) {
    log.error({ err, prefix }, "redis unavailable; rate limits are per-process until it recovers");
    return new MemoryStore();
  }
};
