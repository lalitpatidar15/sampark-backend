import { PrismaClient } from "@prisma/client";
import { env } from "../config";
import { childLogger } from "../common/logger";

const log = childLogger("prisma");

export const prisma = new PrismaClient({
  log:
    env.NODE_ENV === "development"
      ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }]
      : [{ emit: "event", level: "error" }],
});

prisma.$on("warn" as never, (e: { message: string }) => log.warn({ e }, "prisma warning"));
prisma.$on("error" as never, (e: { message: string }) => log.error({ e }, "prisma error"));

export const connectDatabase = async (): Promise<void> => {
  await prisma.$connect();
  log.info("Database connected");
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};

export type { PrismaClient };
