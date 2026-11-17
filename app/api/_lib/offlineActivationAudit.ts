import crypto from "crypto";

import {
  OFFLINE_ACTIVATION_AUDIT_STORE_KEY,
  readOfflineActivationJsonFile,
  updateOfflineActivationJsonFile,
} from "@/app/api/_lib/store/offlineActivationDb";
import { dbAppendAudit, dbListAudit, useProgramPostgres } from "@/app/api/_lib/store/offlineActivationProgramDb";

/**
 * Append-only audit history for the offline-activation program.
 * Events are never edited or removed; details must not contain secrets
 * (invite codes, login codes, tokens) — only ids and previews.
 */

export type OfflineActivationAuditAction =
  | "supervisor.invited"
  | "supervisor.invitation_responded"
  | "agent.invited"
  | "agent.invitation_responded"
  | "agent.code_redeemed"
  | "role.granted"
  | "role.removed"
  | "member.status_changed"
  | "supervisor.limit_changed"
  | "invite_code.created"
  | "invite_code.revoked"
  | "onboarding.created"
  | "onboarding.church_registered"
  | "onboarding.report_submitted"
  | "confirmation.requested"
  | "confirmation.responded"
  | "admin.login_code_created"
  | "admin.session_issued";

export type OfflineActivationAuditEvent = {
  id: string;
  at: string;
  actorUserId: string;
  actorRole: string;
  action: OfflineActivationAuditAction;
  targetType: "user" | "invitation" | "invite_code" | "onboarding" | "confirmation" | "admin_session";
  targetId: string;
  details?: Record<string, string | number | boolean | null>;
};

type AuditStore = { events: OfflineActivationAuditEvent[] };

const STORE_FILE = OFFLINE_ACTIVATION_AUDIT_STORE_KEY;

function cleanDetails(
  details: Record<string, unknown> | undefined
): Record<string, string | number | boolean | null> | undefined {
  if (!details) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value as number | boolean | null;
    } else if (typeof value === "string") {
      out[key] = value.slice(0, 300);
    }
  }
  return out;
}

export async function appendOfflineActivationAudit(input: {
  actorUserId: string;
  actorRole: string;
  action: OfflineActivationAuditAction;
  targetType: OfflineActivationAuditEvent["targetType"];
  targetId: string;
  details?: Record<string, unknown>;
}): Promise<OfflineActivationAuditEvent> {
  const event: OfflineActivationAuditEvent = {
    id: `oaudit_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
    at: new Date().toISOString(),
    actorUserId: String(input.actorUserId || "").trim() || "system",
    actorRole: String(input.actorRole || "").trim() || "unknown",
    action: input.action,
    targetType: input.targetType,
    targetId: String(input.targetId || "").trim(),
    details: cleanDetails(input.details),
  };

  if (useProgramPostgres()) {
    await dbAppendAudit(event);
    return event;
  }

  await updateOfflineActivationJsonFile<AuditStore>(
    STORE_FILE,
    (current) => {
      const events = Array.isArray(current?.events) ? current.events : [];
      return { events: [...events, event] };
    },
    { events: [] }
  );

  return event;
}

export async function listOfflineActivationAudit(filter: {
  limit?: number;
  targetIds?: string[];
  actorUserIds?: string[];
} = {}): Promise<OfflineActivationAuditEvent[]> {
  if (useProgramPostgres()) {
    const limit = Math.max(1, Math.min(1000, Math.floor(Number(filter.limit) || 200)));
    const ids = filter.targetIds || filter.actorUserIds
      ? [...new Set([...(filter.targetIds || []), ...(filter.actorUserIds || [])])]
      : undefined;
    return (await dbListAudit(limit, ids)) as OfflineActivationAuditEvent[];
  }
  const store = await readOfflineActivationJsonFile<AuditStore>(STORE_FILE, { events: [] });
  const events = Array.isArray(store?.events) ? store.events : [];
  const targets = filter.targetIds ? new Set(filter.targetIds) : null;
  const actors = filter.actorUserIds ? new Set(filter.actorUserIds) : null;
  const matching = events.filter((event) => {
    if (!targets && !actors) return true;
    return Boolean(
      (targets && targets.has(event.targetId)) || (actors && actors.has(event.actorUserId))
    );
  });
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(filter.limit) || 200)));
  return matching.slice(-limit).reverse();
}
