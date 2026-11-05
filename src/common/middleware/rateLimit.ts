import rateLimit, { type Options, type Store, MemoryStore } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../../config";
import { childLogger } from "../logger";
import { createRateLimitStore } from "./redisRateLimitStore";

const log = childLogger("rate-limit");

/**
 * The real, shared store for each limiter, populated once at boot.
 */
const stores: Record<string, Store> = {};
/**
 * Options each limiter passed to `init`, captured while the real store did not
 * exist yet. They must be replayed once it does, because the store derives the
 * key TTL from `windowMs`; without this every limit silently falls back to a
 * 60 second window.
 */
const pendingOptions = new Map<string, Options>();
let initialised = false;

export const initRateLimiters = async (): Promise<void> => {
  if (initialised) return;
  const [api, scanner, otp] = await Promise.all([
    createRateLimitStore("rl:api"),
    createRateLimitStore("rl:scanner"),
    createRateLimitStore("rl:otp"),
  ]);
  stores.api = api;
  stores.scanner = scanner;
  stores.otp = otp;

  for (const [name, options] of pendingOptions) {
    stores[name]?.init?.(options);
  }
  pendingOptions.clear();

  initialised = true;
  log.info({ limiters: Object.keys(stores).length }, "rate limiters initialised");
};

/**
 * Defers store lookup to first use instead of construction time.
 *
 * Route modules call these factories at import time, and ES module imports are
 * evaluated before any of server.ts runs, so resolving the store eagerly handed
 * every limiter an `undefined` store. express-rate-limit treats that as "use
 * the default MemoryStore", which silently made the OTP limit per-process.
 *
 * Until the real store arrives this falls back to a private memory store so a
 * request is never rejected outright, and it replays the limiter options on as
 * soon as the shared store is ready.
 */
const lazyStore = (name: string): Store => {
  const fallback = new MemoryStore();

  return {
    init(received) {
      stores[name]?.init?.(received);
      if (!stores[name]) pendingOptions.set(name, received);
    },
    async get(key: string) {
      return stores[name]?.get?.(key);
    },
    increment(key: string) {
      return stores[name]?.increment(key) ?? fallback.increment(key);
    },
    decrement(key: string) {
      return stores[name]?.decrement(key) ?? fallback.decrement(key);
    },
    resetKey(key: string) {
      return stores[name]?.resetKey(key) ?? fallback.resetKey(key);
    },
    async resetAll() {
      await stores[name]?.resetAll?.();
      await fallback.resetAll?.();
    },
    shutdown() {
      return fallback.shutdown?.();
    },
  };
};

const apiStore = lazyStore("api");
const scannerStore = lazyStore("scanner");
const otpStore = lazyStore("otp");

/**
 * IP-based limiter for the general API surface.
 */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: apiStore,
  keyGenerator: (req: Request) => req.ip ?? "unknown",
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many requests. Please try again shortly." },
    });
  },
});

/**
 * Scanner-facing limiter. Applied to every public privacy-gateway endpoint.
 */
export const scannerLimiter = rateLimit({
  windowMs: 60_000,
  max: env.SCANNER_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: scannerStore,
  keyGenerator: (req: Request) => {
    const withBody = req as Request & { body?: Record<string, unknown> };
    const sessionToken = withBody.body?.sessionToken;
    if (typeof sessionToken === "string" && sessionToken.length > 0) {
      return `session:${sessionToken.slice(0, 40)}`;
    }

    const path = req.originalUrl.split("?")[0] ?? "";
    const match = /\/s\/(?:tags|session|chat\/sessions)\/([A-Za-z0-9_-]{8,})/.exec(path);
    if (match?.[1]) return `token:${match[1].slice(0, 40)}`;

    return `ip:${req.ip ?? "unknown"}:${path}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many attempts from this device. Please wait and try again.",
      },
    });
  },
});

/**
 * OTP endpoints get a much tighter budget keyed on the target phone.
 */
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  store: otpStore,
  keyGenerator: (req: Request) => {
    const body = (req.body ?? {}) as { phone?: string };
    const ip = req.ip ?? "unknown";
    const phone = typeof body.phone === "string" ? body.phone.slice(-4) : "none";
    return `${ip}:${phone}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many OTP attempts. Try again later." },
    });
  },
});
