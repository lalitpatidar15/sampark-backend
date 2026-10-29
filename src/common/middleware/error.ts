import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../errors";
import { childLogger } from "../logger";
import { env } from "../../config";

const log = childLogger("http");

export const requestId: RequestHandler = (req, res, next) => {
  const id = req.header("x-request-id") ?? randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
};

export const httpLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log[level](
      {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user?.id,
        ip: req.ip,
      },
      "request",
    );
  });
  next();
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof ZodError) return void handleZod(err, req, res);
  if (err instanceof Prisma.PrismaClientKnownRequestError) return void handlePrisma(err, req, res);
  if (err instanceof AppError) return void handleAppError(err, req, res);

  log.error(
    { err, requestId: req.requestId, path: req.originalUrl, userId: req.user?.id },
    "unhandled error",
  );
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
      ...(env.NODE_ENV === "development" ? { debug: String(err?.message ?? err) } : {}),
    },
  });
};

const handleZod = (err: ZodError, req: RequestLike, res: ResponseLike) => {
  log.warn({ err: err.issues, requestId: req.requestId }, "validation error");
  res.status(422).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    },
  });
};

const handlePrisma = (err: Prisma.PrismaClientKnownRequestError, req: RequestLike, res: ResponseLike) => {
  if (err.code === "P2002") {
    res.status(409).json({
      error: { code: "CONFLICT", message: "Resource already exists" },
    });
    return;
  }
  if (err.code === "P2025") {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
    return;
  }
  log.error({ err, requestId: req.requestId }, "prisma error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Database error" } });
};

const handleAppError = (err: AppError, req: RequestLike, res: ResponseLike) => {
  const level = err.status >= 500 ? "error" : "warn";
  log[level]({ code: err.code, message: err.message, requestId: req.requestId }, "app error");
  res.status(err.status).json({
    error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
  });
};

type RequestLike = { requestId?: string; originalUrl?: string };
type ResponseLike = { status: (n: number) => ResponseLike; json: (b: unknown) => unknown };
