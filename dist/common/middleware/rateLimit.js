"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.otpLimiter = exports.scannerLimiter = exports.apiLimiter = exports.initRateLimiters = void 0;
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
const config_1 = require("../../config");
const logger_1 = require("../logger");
const redisRateLimitStore_1 = require("./redisRateLimitStore");
const log = (0, logger_1.childLogger)("rate-limit");
/**
 * The real, shared store for each limiter, populated once at boot.
 */
const stores = {};
/**
 * Options each limiter passed to `init`, captured while the real store did not
 * exist yet. They must be replayed once it does, because the store derives the
 * key TTL from `windowMs`; without this every limit silently falls back to a
 * 60 second window.
 */
const pendingOptions = new Map();
let initialised = false;
const initRateLimiters = async () => {
    if (initialised)
        return;
    const [api, scanner, otp] = await Promise.all([
        (0, redisRateLimitStore_1.createRateLimitStore)("rl:api"),
        (0, redisRateLimitStore_1.createRateLimitStore)("rl:scanner"),
        (0, redisRateLimitStore_1.createRateLimitStore)("rl:otp"),
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
exports.initRateLimiters = initRateLimiters;
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
const lazyStore = (name) => {
    const fallback = new express_rate_limit_1.MemoryStore();
    return {
        init(received) {
            stores[name]?.init?.(received);
            if (!stores[name])
                pendingOptions.set(name, received);
        },
        async get(key) {
            return stores[name]?.get?.(key);
        },
        increment(key) {
            return stores[name]?.increment(key) ?? fallback.increment(key);
        },
        decrement(key) {
            return stores[name]?.decrement(key) ?? fallback.decrement(key);
        },
        resetKey(key) {
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
const apiLimiter = (options = {}) => (0, express_rate_limit_1.default)({
    windowMs: config_1.env.RATE_LIMIT_WINDOW_MS,
    max: config_1.env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    store: apiStore,
    keyGenerator: (req) => req.ip ?? "unknown",
    handler: (_req, res) => {
        res.status(429).json({
            error: { code: "RATE_LIMITED", message: "Too many requests. Please try again shortly." },
        });
    },
    ...options,
});
exports.apiLimiter = apiLimiter;
/**
 * Scanner-facing limiter. Applied to every public privacy-gateway endpoint.
 *
 * The key prefers the scanner session or the public tag over the raw IP so that
 * several people behind one corporate or mobile-carrier NAT each get their own
 * budget, while a single abusive session cannot hide behind a shared IP.
 *
 * The token is read from the parsed body, or parsed out of the path, because a
 * limiter mounted with `router.use(...)` runs before route parameters exist. An
 * earlier version read `req.params` here, which was always empty, so every
 * request silently fell through to the IP bucket.
 */
const scannerLimiter = (max = config_1.env.SCANNER_RATE_LIMIT_MAX, windowMs = 60_000) => (0, express_rate_limit_1.default)({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: scannerStore,
    keyGenerator: (req) => {
        const withBody = req;
        const sessionToken = withBody.body?.sessionToken;
        if (typeof sessionToken === "string" && sessionToken.length > 0) {
            return `session:${sessionToken.slice(0, 40)}`;
        }
        // e.g. /api/s/tags/<publicToken> or /api/s/session/<token>/...
        const path = req.originalUrl.split("?")[0] ?? "";
        const match = /\/s\/(?:tags|session|chat\/sessions)\/([A-Za-z0-9_-]{8,})/.exec(path);
        if (match?.[1])
            return `token:${match[1].slice(0, 40)}`;
        // Scoped to the route as well, so a scanner walking one endpoint cannot
        // spend another endpoint's budget.
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
exports.scannerLimiter = scannerLimiter;
/**
 * OTP endpoints get a much tighter budget keyed on the target phone so a single
 * number cannot be brute-forced from many IPs.
 *
 * The key deliberately combines both the IP and the phone: keying on the phone
 * alone lets one attacker lock a real user out of their own account, and keying
 * on the IP alone lets a botnet spread attempts across a target number.
 */
const otpLimiter = () => (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    store: otpStore,
    keyGenerator: (req) => {
        const body = (req.body ?? {});
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
exports.otpLimiter = otpLimiter;
//# sourceMappingURL=rateLimit.js.map