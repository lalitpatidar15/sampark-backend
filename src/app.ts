import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config";
import { apiLimiter } from "./common/middleware/rateLimit";
import { errorHandler, httpLogger, notFoundHandler, requestId } from "./common/middleware/error";
import { registerRoutes } from "./routes";

export const createApp = (): Express => {
  const app = express();

  // Required for correct client IPs (and therefore rate limiting) behind Cloudflare/nginx.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
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
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Native apps (React Native) send no Origin header.
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin not allowed: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Reauth-Token", "X-Scanner-Session", "X-Request-Id"],
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());

  app.use(requestId);
  app.use(httpLogger);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "sampark-backend", env: env.NODE_ENV, time: new Date().toISOString() });
  });

  app.use("/api", apiLimiter());
  app.use("/api", registerRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
