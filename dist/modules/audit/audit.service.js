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
exports.audit = void 0;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("audit");
/**
 * Append-only audit trail. Never throws into the request path: a failure to
 * record an audit entry is logged loudly but must not break the user's action.
 * Records are written with hashed IPs and no private contact fields.
 */
const audit = async (input) => {
    try {
        const { sha256 } = await Promise.resolve().then(() => __importStar(require("../../common/utils/crypto")));
        await prisma_1.prisma.auditLog.create({
            data: {
                actorUserId: input.actorUserId ?? null,
                actorRole: input.actorRole ?? null,
                action: input.action,
                resourceType: input.resourceType,
                resourceId: input.resourceId ?? null,
                outcome: input.outcome ?? "SUCCESS",
                ipHash: input.ip ? sha256(input.ip) : null,
                metadata: (input.metadata ?? {}),
            },
        });
    }
    catch (error) {
        log.error({ err: error, action: input.action, resourceType: input.resourceType }, "failed to write audit log");
    }
};
exports.audit = audit;
//# sourceMappingURL=audit.service.js.map