"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = void 0;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const config_1 = require("./config");
const rateLimit_1 = require("./common/middleware/rateLimit");
const error_1 = require("./common/middleware/error");
const routes_1 = require("./routes");
const createApp = () => {
    const app = (0, express_1.default)();
    // Required for correct client IPs (and therefore rate limiting) behind Cloudflare/nginx.
    app.set("trust proxy", 1);
    app.disable("x-powered-by");
    app.use((0, helmet_1.default)({
        // The scanner web app is served from a different origin and loads inline
        // bootstrap data; CSP is set by the frontend host, not here.
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "http://localhost:4000", "https://api.razorpay.com"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"],
            },
        },
        crossOriginResourcePolicy: { policy: "cross-origin" },
    }));
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            // Native apps (React Native) send no Origin header.
            if (!origin)
                return callback(null, true);
            if (config_1.env.CORS_ORIGINS.includes(origin))
                return callback(null, true);
            return callback(new Error(`Origin not allowed: ${origin}`));
        },
        credentials: true,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Reauth-Token", "X-Scanner-Session", "X-Request-Id"],
    }));
    app.use(express_1.default.json({ limit: "1mb" }));
    app.use(express_1.default.urlencoded({ extended: true, limit: "1mb" }));
    app.use((0, cookie_parser_1.default)());
    app.use(error_1.requestId);
    app.use(error_1.httpLogger);
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "sampark-backend", env: config_1.env.NODE_ENV, time: new Date().toISOString() });
    });
    app.use("/api", (0, rateLimit_1.apiLimiter)());
    app.use("/api", (0, routes_1.registerRoutes)());
    app.use(error_1.notFoundHandler);
    app.use(error_1.errorHandler);
    return app;
};
exports.createApp = createApp;
//# sourceMappingURL=app.js.map