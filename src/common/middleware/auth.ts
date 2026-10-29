import type { NextFunction, Request, RequestHandler, Response } from "express";
import { prisma } from "../../db/prisma";
import { forbidden, unauthenticated } from "../errors";
import { permissionsForRole, type PermissionType, type UserRoleType } from "../guards/permissions";
import { verifyAccessToken } from "../guards/tokens";

export interface AuthenticatedUser {
  id: string;
  role: UserRoleType;
  perms: PermissionType[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

const extractBearer = (req: Request): string | undefined => {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return undefined;
};

/**
 * Verifies the access token and confirms the account is still usable.
 * Authorization is re-checked against the database on every request; a token
 * signed before a suspension must not keep working.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const token = extractBearer(req);
      if (!token) throw unauthenticated();

      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true, deletedAt: true },
      });

      if (!user || user.deletedAt) throw unauthenticated("Account not found");
      if (user.status === "SUSPENDED") throw forbidden("Account is suspended");
      if (user.status === "DELETED") throw unauthenticated("Account is deleted");

      req.user = {
        id: user.id,
        role: user.role as UserRoleType,
        perms: permissionsForRole(user.role as UserRoleType),
      };
      next();
    } catch (error) {
      next(error);
    }
  })();
};

export const requirePermission = (...required: PermissionType[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthenticated());
    const granted = new Set(req.user.perms);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      return next(forbidden(`Missing permission: ${missing.join(", ")}`));
    }
    return next();
  };

export const requireRole = (...roles: UserRoleType[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthenticated());
    if (!roles.includes(req.user.role)) {
      return next(forbidden("Insufficient role for this operation"));
    }
    return next();
  };

/**
 * Sensitive operations (phone change, tag transfer, account deletion, data
 * export, emergency contact change, document reveal) require a fresh OTP
 * within the last few minutes.
 */
const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export const requireRecentReauth: RequestHandler = (req, _res, next) => {
  const header = req.header("x-reauth-token");
  if (!header) {
    return next(
      forbidden("This operation requires re-authentication. Verify an OTP and resend the x-reauth-token header."),
    );
  }
  const payload = verifyAccessToken(header);
  if (payload.typ !== "access") return next(forbidden("Invalid re-auth token"));
  if (!req.user || payload.sub !== req.user.id) {
    return next(forbidden("Re-auth token does not match the authenticated user"));
  }
  if (Date.now() - (payload as { iat?: number }).iat! * 1000 > REAUTH_WINDOW_MS) {
    return next(forbidden("Re-authentication has expired. Please verify your OTP again."));
  }
  return next();
};
