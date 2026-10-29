import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../config";
import { unauthenticated } from "../errors";
import { permissionsForRole, type UserRoleType } from "../guards/permissions";

export interface AccessTokenPayload {
  sub: string;
  role: UserRoleType;
  perms: string[];
  typ: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  typ: "refresh";
}

const sign = (payload: object, secret: string, ttl: string): string =>
  jwt.sign(payload, secret, { expiresIn: ttl } as SignOptions);

export const signAccessToken = (userId: string, role: UserRoleType): string =>
  sign(
    { sub: userId, role, perms: permissionsForRole(role), typ: "access" },
    env.JWT_ACCESS_SECRET,
    env.JWT_ACCESS_TTL,
  );

export const signRefreshToken = (userId: string, jti: string): string =>
  sign({ sub: userId, jti, typ: "refresh" }, env.JWT_REFRESH_SECRET, env.JWT_REFRESH_TTL);

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    if (payload.typ !== "access") throw unauthenticated("Invalid token type");
    return payload;
  } catch {
    throw unauthenticated("Invalid or expired access token");
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    if (payload.typ !== "refresh") throw unauthenticated("Invalid token type");
    return payload;
  } catch {
    throw unauthenticated("Invalid or expired refresh token");
  }
};

export const refreshTokenTtlSeconds = (): number => {
  const ttl = env.JWT_REFRESH_TTL;
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 60 * 60 * 24 * 30;
  const value = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return value * multiplier;
};
