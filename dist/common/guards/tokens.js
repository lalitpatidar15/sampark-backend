"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshTokenTtlSeconds = exports.verifyRefreshToken = exports.verifyAccessToken = exports.signRefreshToken = exports.signAccessToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../../config");
const errors_1 = require("../errors");
const permissions_1 = require("../guards/permissions");
const sign = (payload, secret, ttl) => jsonwebtoken_1.default.sign(payload, secret, { expiresIn: ttl });
const signAccessToken = (userId, role) => sign({ sub: userId, role, perms: (0, permissions_1.permissionsForRole)(role), typ: "access" }, config_1.env.JWT_ACCESS_SECRET, config_1.env.JWT_ACCESS_TTL);
exports.signAccessToken = signAccessToken;
const signRefreshToken = (userId, jti) => sign({ sub: userId, jti, typ: "refresh" }, config_1.env.JWT_REFRESH_SECRET, config_1.env.JWT_REFRESH_TTL);
exports.signRefreshToken = signRefreshToken;
const verifyAccessToken = (token) => {
    try {
        const payload = jsonwebtoken_1.default.verify(token, config_1.env.JWT_ACCESS_SECRET);
        if (payload.typ !== "access")
            throw (0, errors_1.unauthenticated)("Invalid token type");
        return payload;
    }
    catch {
        throw (0, errors_1.unauthenticated)("Invalid or expired access token");
    }
};
exports.verifyAccessToken = verifyAccessToken;
const verifyRefreshToken = (token) => {
    try {
        const payload = jsonwebtoken_1.default.verify(token, config_1.env.JWT_REFRESH_SECRET);
        if (payload.typ !== "refresh")
            throw (0, errors_1.unauthenticated)("Invalid token type");
        return payload;
    }
    catch {
        throw (0, errors_1.unauthenticated)("Invalid or expired refresh token");
    }
};
exports.verifyRefreshToken = verifyRefreshToken;
const refreshTokenTtlSeconds = () => {
    const ttl = config_1.env.JWT_REFRESH_TTL;
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match)
        return 60 * 60 * 24 * 30;
    const value = Number(match[1]);
    const unit = match[2];
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
    return value * multiplier;
};
exports.refreshTokenTtlSeconds = refreshTokenTtlSeconds;
//# sourceMappingURL=tokens.js.map