"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const logger_1 = require("./common/logger");
const rateLimit_1 = require("./common/middleware/rateLimit");
const prisma_1 = require("./db/prisma");
const redis_1 = require("./db/redis");
const workers_1 = require("./workers");
const log = (0, logger_1.childLogger)("server");
const bootstrap = async () => {
    await (0, prisma_1.connectDatabase)();
    await (0, redis_1.connectRedis)();
    // Must happen before createApp, because the limiters capture their store at
    // construction time. Serving traffic with an in-memory store would silently
    // make every rate limit per-instance.
    await (0, rateLimit_1.initRateLimiters)();
    const app = (0, app_1.createApp)();
    const server = app.listen(config_1.env.PORT, () => {
        log.info({ port: config_1.env.PORT, env: config_1.env.NODE_ENV, web: config_1.env.WEB_BASE_URL, admin: config_1.env.ADMIN_BASE_URL }, `Sampark API listening on :${config_1.env.PORT}`);
    });
    // Workers run in-process for the modular monolith; they can be split out
    // later without changing the queue contracts.
    await (0, workers_1.startWorkers)();
    const shutdown = async (signal) => {
        log.info({ signal }, "shutting down");
        server.close();
        await (0, workers_1.stopWorkers)();
        await Promise.allSettled([(0, prisma_1.disconnectDatabase)(), (0, redis_1.disconnectRedis)()]);
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
};
bootstrap().catch((error) => {
    log.fatal({ err: error }, "failed to start server");
    process.exit(1);
});
//# sourceMappingURL=server.js.map