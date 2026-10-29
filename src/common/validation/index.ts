import { ZodError, type ZodTypeAny } from "zod";
import type { RequestHandler } from "express";
import { validationError } from "../errors";

type Source = "body" | "query" | "params";

export const validate = (schema: ZodTypeAny, source: Source = "body"): RequestHandler => {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(validationError("Request validation failed", formatZodError(result.error)));
    }
    if (source === "body") {
      req.body = result.data;
    } else {
      // req.query / req.params are getter-only in Express 5, so the coerced
      // value is exposed on a namespaced property instead of being reassigned.
      Object.defineProperty(req, `validated${source}`, { value: result.data, configurable: true });
    }
    return next();
  };
};

const formatZodError = (error: ZodError) =>
  error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code }));
