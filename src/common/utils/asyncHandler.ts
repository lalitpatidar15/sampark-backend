import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps async route handlers so rejected promises reach the Express error
 * middleware instead of becoming unhandled rejections.
 */
export const asyncHandler =
  <T>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
