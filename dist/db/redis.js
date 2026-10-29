"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Redis = exports.disconnectRedis = exports.connectRedis = exports.redis = exports.createRedisConnection = exports.redisConnection = void 0;
const ioredis_1 = require("ioredis");
Object.defineProperty(exports, "Redis", { enumerable: true, get: function () { return ioredis_1.Redis; } });
const config_1 = require("../config");
const logger_1 = require("../common/logger");
const log = (0, logger_1.childLogger)("redis");
const baseOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
};
/**
 * BullMQ needs a plain host/port/password object, and it wants its own
 * connections rather than the shared command client. Parsed once here so the
 * queue definitions and workers cannot drift from the app's Redis URL.
 */
exports.redisConnection = (() => {
    const url = new URL(config_1.env.REDIS_URL);
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
const createRedisConnection = (name = "default") => {
    const client = new ioredis_1.Redis(config_1.env.REDIS_URL, {
        ...baseOptions,
        connectionName: name,
    });
    client.on("error", (err) => log.error({ err, name }, "Redis error"));
    client.on("ready", () => log.info({ name }, "Redis ready"));
    return client;
};
exports.createRedisConnection = createRedisConnection;
exports.redis = (0, exports.createRedisConnection)();
const connectRedis = async () => {
    await exports.redis.connect();
    log.info("Redis connected");
};
exports.connectRedis = connectRedis;
const disconnectRedis = async () => {
    await exports.redis.quit();
};
exports.disconnectRedis = disconnectRedis;
//# sourceMappingURL=redis.js.map