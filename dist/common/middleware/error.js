"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.notFoundHandler = exports.httpLogger = exports.requestId = void 0;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const errors_1 = require("../errors");
const logger_1 = require("../logger");
const config_1 = require("../../config");
const log = (0, logger_1.childLogger)("http");
const requestId = (req, res, next) => {
    const id = req.header("x-request-id") ?? (0, node_crypto_1.randomUUID)();
    req.requestId = id;
    res.setHeader("x-request-id", id);
    next();
};
exports.requestId = requestId;
const httpLogger = (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
        log[level]({
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl.split("?")[0],
            status: res.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            userId: req.user?.id,
            ip: req.ip,
        }, "request");
    });
    next();
};
exports.httpLogger = httpLogger;
const notFoundHandler = (req, res) => {
    res.status(404).json({
        error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
    });
};
exports.notFoundHandler = notFoundHandler;
const errorHandler = (err, req, res, _next) => {
    if (res.headersSent)
        return;
    if (err instanceof zod_1.ZodError)
        return void handleZod(err, req, res);
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError)
        return void handlePrisma(err, req, res);
    if (err instanceof errors_1.AppError)
        return void handleAppError(err, req, res);
    log.error({ err, requestId: req.requestId, path: req.originalUrl, userId: req.user?.id }, "unhandled error");
    res.status(500).json({
        error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong. Please try again.",
            ...(config_1.env.NODE_ENV === "development" ? { debug: String(err?.message ?? err) } : {}),
        },
    });
};
exports.errorHandler = errorHandler;
const handleZod = (err, req, res) => {
    log.warn({ err: err.issues, requestId: req.requestId }, "validation error");
    res.status(422).json({
        error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
    });
};
const handlePrisma = (err, req, res) => {
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
const handleAppError = (err, req, res) => {
    const level = err.status >= 500 ? "error" : "warn";
    log[level]({ code: err.code, message: err.message, requestId: req.requestId }, "app error");
    res.status(err.status).json({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
};
//# sourceMappingURL=error.js.map