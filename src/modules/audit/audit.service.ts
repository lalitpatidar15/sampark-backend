import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";

const log = childLogger("audit");

export interface AuditInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: "SUCCESS" | "FAILURE" | "DENIED";
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit trail. Never throws into the request path: a failure to
 * record an audit entry is logged loudly but must not break the user's action.
 * Records are written with hashed IPs and no private contact fields.
 */
export const audit = async (input: AuditInput): Promise<void> => {
  try {
    const { sha256 } = await import("../../common/utils/crypto");
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        outcome: input.outcome ?? "SUCCESS",
        ipHash: input.ip ? sha256(input.ip) : null,
        metadata: (input.metadata ?? {}) as never,
      },
    });
  } catch (error) {
    log.error({ err: error, action: input.action, resourceType: input.resourceType }, "failed to write audit log");
  }
};
