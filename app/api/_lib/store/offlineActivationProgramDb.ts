import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

import { getDatabaseUrl, hasDurableStore } from "@/app/api/_lib/store/authDb";
import { ensureOfflineActivationInvitationSchema } from "@/app/api/_lib/store/offlineActivationInvitationDb";
import { ensureOfflineActivationStoreReady } from "@/app/api/_lib/store/offlineActivationDb";
import {
  PROGRAM_SCHEMA_LOCK_KEY,
  PROGRAM_SCHEMA_SQL,
} from "@/app/api/_lib/store/offlineActivationProgramSql";
import { ensurePlatformRoleStoreReady } from "@/app/api/_lib/store/platformRoleDb";

/**
 * Postgres access for the offline-activation program. Writes are single calls
 * to the PL/pgSQL functions in offlineActivationProgramSql.ts (one transaction
 * each); reads come straight from the tables.
 */

export class ProgramDbError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<unknown> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

export function useProgramPostgres(): boolean {
  return hasDurableStore();
}

export async function ensureProgramSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureOfflineActivationStoreReady();
      await ensurePlatformRoleStoreReady();
      await ensureOfflineActivationInvitationSchema();
      const sql = getSql();
      const schemaVersion = `schema_${crypto.createHash("sha256").update(PROGRAM_SCHEMA_SQL.join("\n")).digest("hex").slice(0, 16)}`;
      // Fast path: this exact schema (tables + functions) is already installed.
      const installed = await sql`
        SELECT to_regclass('kristo_oact_migrations') IS NOT NULL AS has_table
      `.then(async (rows: any) =>
        rows[0]?.has_table
          ? ((await sql`SELECT 1 FROM kristo_oact_migrations WHERE name = ${schemaVersion}`) as unknown[]).length > 0
          : false
      );
      if (installed) return;
      // One transaction behind an advisory lock: concurrent cold starts wait instead of racing,
      // and the one-time JSON import runs exactly once.
      const results = await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(hashtext(${PROGRAM_SCHEMA_LOCK_KEY}))`,
        ...PROGRAM_SCHEMA_SQL.map((statement) => sql.query(statement)),
        sql`SELECT oact_migrate_json_documents() AS migration`,
        sql`INSERT INTO kristo_oact_migrations (name) VALUES (${schemaVersion}) ON CONFLICT DO NOTHING`,
      ]);
      const migration = (results[results.length - 2] as { migration: unknown }[])[0]?.migration;
      console.log("KRISTO_OACT_PROGRAM_SCHEMA_READY", { migration });
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function mapDbError(error: unknown): never {
  const message = String((error as any)?.message || error || "");
  const match = /OACT\|(\d{3})\|([\s\S]*)$/.exec(message);
  if (match) throw new ProgramDbError(Number(match[1]), match[2].trim());
  const code = String((error as any)?.code || "");
  if (code === "23505") throw new ProgramDbError(409, "Duplicate request (already exists)");
  if (code === "23514") throw new ProgramDbError(409, "Request conflicts with current data");
  if (code === "40P01" || code === "40001") throw new ProgramDbError(503, "Busy, please try again");
  throw error;
}

/** Calls one program function = one transaction. `types` are SQL casts for each argument. */
export async function callProgramFunction<T = Record<string, unknown>>(
  name: string,
  args: unknown[],
  types: string[]
): Promise<T> {
  if (!/^oact_[a-z_]+$/.test(name)) throw new Error("invalid program function");
  await ensureProgramSchema();
  const sql = getSql();
  const placeholders = args.map((_, i) => `$${i + 1}::${types[i]}`).join(", ");
  try {
    const rows = (await sql.query(`SELECT ${name}(${placeholders}) AS result`, args.map((a) =>
      a === undefined ? null : a !== null && typeof a === "object" ? JSON.stringify(a) : a
    ))) as { result: T }[];
    return rows[0]?.result as T;
  } catch (error) {
    mapDbError(error);
  }
}

export async function programQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureProgramSchema();
  const sql = getSql();
  try {
    return (await sql.query(text, params)) as T[];
  } catch (error) {
    mapDbError(error);
  }
}

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : undefined);

/** Snapshot in the same shape the filesystem store uses, so read models are shared. */
export async function readProgramSnapshot() {
  const [members, codes, uses, onboardings, confirmations] = await Promise.all([
    programQuery<any>("SELECT * FROM kristo_oact_members"),
    programQuery<any>("SELECT * FROM kristo_oact_invite_codes ORDER BY created_at"),
    programQuery<any>("SELECT * FROM kristo_oact_invite_code_uses ORDER BY used_at"),
    programQuery<any>("SELECT * FROM kristo_oact_onboardings ORDER BY created_at"),
    programQuery<any>("SELECT * FROM kristo_oact_confirmations ORDER BY requested_at"),
  ]);

  const memberMap: Record<string, any> = {};
  for (const m of members) {
    memberMap[m.user_id] = {
      userId: m.user_id,
      role: m.role,
      status: m.status,
      agentLimit: m.agent_limit === null ? undefined : Number(m.agent_limit),
      supervisorUserId: m.supervisor_user_id || undefined,
      statusReason: m.status_reason || undefined,
      statusChangedAt: iso(m.status_changed_at),
      statusChangedBy: m.status_changed_by || undefined,
      limitUpdatedAt: iso(m.limit_updated_at),
      limitUpdatedBy: m.limit_updated_by || undefined,
      createdAt: iso(m.created_at)!,
      updatedAt: iso(m.updated_at)!,
    };
  }

  const usesByCode = new Map<string, { userId: string; at: string }[]>();
  for (const u of uses) {
    const list = usesByCode.get(u.code_id) || [];
    list.push({ userId: u.user_id, at: iso(u.used_at)! });
    usesByCode.set(u.code_id, list);
  }

  const confirmationsByOnboarding = new Map<string, any[]>();
  for (const c of confirmations) {
    const list = confirmationsByOnboarding.get(c.onboarding_id) || [];
    list.push({
      requestId: c.request_id,
      status: c.status,
      question: c.question,
      requestedAt: iso(c.requested_at)!,
      reportVersion: Number(c.report_version),
      respondedAt: iso(c.responded_at),
      respondedByUserId: c.responded_by || undefined,
      note: c.note || undefined,
    });
    confirmationsByOnboarding.set(c.onboarding_id, list);
  }

  return {
    version: 1 as const,
    members: memberMap,
    agentInviteCodes: codes.map((c) => ({
      id: c.id,
      codeHash: c.code_hash,
      codePreview: c.code_preview,
      supervisorUserId: c.supervisor_user_id,
      maxUses: Number(c.max_uses),
      uses: usesByCode.get(c.id) || [],
      expiresAt: iso(c.expires_at)!,
      createdAt: iso(c.created_at)!,
      createdBy: c.created_by,
      revokedAt: iso(c.revoked_at),
      revokedBy: c.revoked_by || undefined,
    })),
    onboardings: onboardings.map((o) => {
      const rounds = confirmationsByOnboarding.get(o.id) || [];
      return {
        id: o.id,
        agentUserId: o.agent_user_id,
        supervisorUserId: o.supervisor_user_id,
        leaderUserId: o.leader_user_id,
        leaderKristoId: o.leader_kristo_id,
        churchId: o.church_id || undefined,
        registeredAt: iso(o.registered_at),
        status: o.status,
        agentReport: o.agent_report || null,
        leaderConfirmation: rounds.length ? rounds[rounds.length - 1] : null,
        confirmationHistory: rounds.slice(0, -1),
        createdAt: iso(o.created_at)!,
        updatedAt: iso(o.updated_at)!,
      };
    }),
    adminLoginCodes: [],
  };
}

export async function dbAppendAudit(event: {
  id: string;
  at: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}) {
  await programQuery(
    `INSERT INTO kristo_oact_audit (id, at, actor_user_id, actor_role, action, target_type, target_id, details)
     VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb)`,
    [event.id, event.at, event.actorUserId, event.actorRole, event.action, event.targetType, event.targetId,
      event.details ? JSON.stringify(event.details) : null]
  );
}

export async function dbListAudit(limit: number, ids?: string[]) {
  const rows = ids
    ? await programQuery<any>(
        `SELECT * FROM kristo_oact_audit WHERE target_id = ANY($1::text[]) OR actor_user_id = ANY($1::text[])
         ORDER BY at DESC, id DESC LIMIT $2`,
        [ids, limit]
      )
    : await programQuery<any>("SELECT * FROM kristo_oact_audit ORDER BY at DESC, id DESC LIMIT $1", [limit]);
  return rows.map((r) => ({
    id: r.id,
    at: iso(r.at)!,
    actorUserId: r.actor_user_id,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details || undefined,
  }));
}

/** Single statement, so it is atomic: a second exchange of the same code finds it used. */
export async function dbConsumeAdminLoginCode(codeHash: string): Promise<string | null> {
  const rows = await programQuery<{ user_id: string }>(
    `UPDATE kristo_oact_admin_login_codes SET used_at = NOW()
     WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`,
    [codeHash]
  );
  return rows[0]?.user_id || null;
}
