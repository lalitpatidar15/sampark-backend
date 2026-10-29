import { createApp } from "./app";
import { env } from "./config";
import { childLogger } from "./common/logger";
import { initRateLimiters } from "./common/middleware/rateLimit";
import { connectDatabase, disconnectDatabase } from "./db/prisma";
import { connectRedis, disconnectRedis } from "./db/redis";
import { startWorkers, stopWorkers } from "./workers";

const log = childLogger("server");

const bootstrap = async (): Promise<void> => {
  await connectDatabase();
  await connectRedis();
  // Must happen before createApp, because the limiters capture their store at
  // construction time. Serving traffic with an in-memory store would silently
  // make every rate limit per-instance.
  await initRateLimiters();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    log.info(
      { port: env.PORT, env: env.NODE_ENV, web: env.WEB_BASE_URL, admin: env.ADMIN_BASE_URL },
      `Sampark API listening on :${env.PORT}`,
    );
  });

  // Workers run in-process for the modular monolith; they can be split out
  // later without changing the queue contracts.
  await startWorkers();

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    server.close();
    await stopWorkers();
    await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

bootstrap().catch((error) => {
  log.fatal({ err: error }, "failed to start server");
  process.exit(1);
});
