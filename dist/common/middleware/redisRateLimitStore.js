"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRateLimitStore = exports.RedisRateLimitStore = void 0;
const express_rate_limit_1 = require("express-rate-limit");
const redis_1 = require("../../db/redis");
const logger_1 = require("../logger");
const log = (0, logger_1.childLogger)("rate-limit-store");
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
class RedisRateLimitStore {
    client;
    keyPrefix;
    windowMs = 60_000;
    constructor(client = redis_1.redis, prefix = "rl") {
        this.client = client;
        this.keyPrefix = prefix;
    }
    init(options) {
        this.windowMs = options.windowMs ?? 60_000;
        if (options.prefix)
            this.keyPrefix = options.prefix;
    }
    key(key) {
        return `${this.keyPrefix}:${key}`;
    }
    async increment(key) {
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
    async decrement(key) {
        const redisKey = this.key(key);
        const totalHits = await this.client.decr(redisKey);
        // Guard against a negative counter leaving a key that blocks the client
        // until the window rolls over.
        if (totalHits <= 0)
            await this.client.del(redisKey);
    }
    async resetKey(key) {
        await this.client.del(this.key(key));
    }
    async get(key) {
        const redisKey = this.key(key);
        const [rawTotal, ttl] = await Promise.all([this.client.get(redisKey), this.client.ttl(redisKey)]);
        if (rawTotal === null)
            return undefined;
        return {
            totalHits: Number(rawTotal),
            resetTime: new Date(Date.now() + Math.max(ttl, 0) * 1000),
        };
    }
}
exports.RedisRateLimitStore = RedisRateLimitStore;
/**
 * Returns a shared store when Redis is reachable, otherwise an in-memory store.
 *
 * A Redis outage must not turn the OTP limiter off, so the caller keeps the
 * per-process MemoryStore as a degraded fallback and the failure is logged
 * loudly rather than swallowed.
 */
const createRateLimitStore = async (prefix) => {
    try {
        if (redis_1.redis.status === "wait" || redis_1.redis.status === "connecting")
            await redis_1.redis.connect();
        if (redis_1.redis.status !== "ready")
            throw new Error(`redis status is ${redis_1.redis.status}`);
        await redis_1.redis.ping();
        log.info({ prefix }, "rate limits backed by redis");
        return new RedisRateLimitStore(redis_1.redis, prefix);
    }
    catch (err) {
        log.error({ err, prefix }, "redis unavailable; rate limits are per-process until it recovers");
        return new express_rate_limit_1.MemoryStore();
    }
};
exports.createRateLimitStore = createRateLimitStore;
//# sourceMappingURL=redisRateLimitStore.js.map