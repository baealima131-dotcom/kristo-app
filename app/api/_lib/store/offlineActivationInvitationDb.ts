import { neon, neonConfig } from "@neondatabase/serverless";

import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type OfflineActivationInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled";

export type OfflineActivationInvitationRole = "Supervisor";

export type OfflineActivationInvitationRecord = {
  id: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
  role: OfflineActivationInvitationRole;
  status: OfflineActivationInvitationStatus;
  createdAt: string;
  respondedAt?: string | null;
};

export type OfflineActivationInvitationStoreMode =
  | "postgres"
  | "local-json"
  | "missing-db-on-vercel";

type InvitationRow = {
  id: string;
  invitee_user_id: string;
  invitee_kristo_id: string;
  church_id: string;
  invited_by_user_id: string;
  role: string;
  status: string;
  created_at: string | Date;
  responded_at: string | Date | null;
};

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

function usePostgres() {
  return hasDurableStore();
}

function nowIso() {
  return new Date().toISOString();
}

function newInvitationId(): string {
  return `oactinv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(value: unknown): OfflineActivationInvitationStatus {
  const status = String(value || "pending").trim();
  if (
    status === "accepted" ||
    status === "declined" ||
    status === "cancelled" ||
    status === "pending"
  ) {
    return status;
  }
  return "pending";
}

function rowToRecord(row: InvitationRow): OfflineActivationInvitationRecord {
  return {
    id: String(row.id || "").trim(),
    inviteeUserId: String(row.invitee_user_id || "").trim(),
    inviteeKristoId: String(row.invitee_kristo_id || "").trim().toUpperCase(),
    churchId: String(row.church_id || "").trim(),
    invitedByUserId: String(row.invited_by_user_id || "").trim(),
    role: "Supervisor",
    status: normalizeStatus(row.status),
    createdAt: new Date(row.created_at).toISOString(),
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null,
  };
}

export function resolveOfflineActivationInvitationStoreMode(): OfflineActivationInvitationStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

export async function ensureOfflineActivationInvitationStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Offline activation invitation database not configured");
  }
  if (usePostgres()) {
    await ensureOfflineActivationInvitationSchema();
  }
}

export async function ensureOfflineActivationInvitationSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_offline_activation_invitations (
          id TEXT PRIMARY KEY,
          invitee_user_id TEXT NOT NULL,
          invitee_kristo_id TEXT NOT NULL,
          church_id TEXT NOT NULL,
          invited_by_user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'Supervisor',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          responded_at TIMESTAMPTZ,
          CONSTRAINT kristo_offline_activation_invitations_status_check
            CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
          CONSTRAINT kristo_offline_activation_invitations_role_check
            CHECK (role IN ('Supervisor'))
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_offline_activation_invitations_pending_unique_idx
        ON kristo_offline_activation_invitations (invitee_user_id, church_id, role)
        WHERE status = 'pending'
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_offline_activation_invitations_invitee_status_idx
        ON kristo_offline_activation_invitations (invitee_user_id, status)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_offline_activation_invitations_status_role_idx
        ON kristo_offline_activation_invitations (status, role)
      `;
    })();
  }
  await schemaReady;
}

export async function dbFindPendingSupervisorInvitation(input: {
  inviteeUserId: string;
  churchId: string;
}): Promise<OfflineActivationInvitationRecord | null> {
  const inviteeUserId = String(input.inviteeUserId || "").trim();
  const churchId = String(input.churchId || "").trim();
  if (!inviteeUserId || !churchId) return null;

  await ensureOfflineActivationInvitationSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT id, invitee_user_id, invitee_kristo_id, church_id, invited_by_user_id, role, status, created_at, responded_at
    FROM kristo_offline_activation_invitations
    WHERE invitee_user_id = ${inviteeUserId}
      AND church_id = ${churchId}
      AND role = 'Supervisor'
      AND status = 'pending'
    LIMIT 1
  `) as InvitationRow[];

  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

export async function dbCreateSupervisorInvitation(input: {
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
}): Promise<OfflineActivationInvitationRecord> {
  const inviteeUserId = String(input.inviteeUserId || "").trim();
  const inviteeKristoId = String(input.inviteeKristoId || "").trim().toUpperCase();
  const churchId = String(input.churchId || "").trim();
  const invitedByUserId = String(input.invitedByUserId || "").trim();

  if (!inviteeUserId) throw new Error("inviteeUserId required");
  if (!inviteeKristoId) throw new Error("inviteeKristoId required");
  if (!churchId) throw new Error("churchId required");
  if (!invitedByUserId) throw new Error("invitedByUserId required");

  const existing = await dbFindPendingSupervisorInvitation({ inviteeUserId, churchId });
  if (existing) return existing;

  await ensureOfflineActivationInvitationSchema();
  const sql = getSql();
  const id = newInvitationId();
  const createdAt = nowIso();

  try {
    const rows = (await sql`
      INSERT INTO kristo_offline_activation_invitations (
        id,
        invitee_user_id,
        invitee_kristo_id,
        church_id,
        invited_by_user_id,
        role,
        status,
        created_at,
        responded_at
      ) VALUES (
        ${id},
        ${inviteeUserId},
        ${inviteeKristoId},
        ${churchId},
        ${invitedByUserId},
        'Supervisor',
        'pending',
        ${createdAt},
        NULL
      )
      RETURNING id, invitee_user_id, invitee_kristo_id, church_id, invited_by_user_id, role, status, created_at, responded_at
    `) as InvitationRow[];

    const row = rows[0];
    if (row) return rowToRecord(row);
  } catch (error: any) {
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("duplicate") || message.includes("unique")) {
      const deduped = await dbFindPendingSupervisorInvitation({ inviteeUserId, churchId });
      if (deduped) return deduped;
    }
    throw error;
  }

  const deduped = await dbFindPendingSupervisorInvitation({ inviteeUserId, churchId });
  if (deduped) return deduped;

  throw new Error("Failed to create supervisor invitation");
}

export async function dbListPendingInvitationsForUser(
  userId: string
): Promise<OfflineActivationInvitationRecord[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];

  await ensureOfflineActivationInvitationSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT id, invitee_user_id, invitee_kristo_id, church_id, invited_by_user_id, role, status, created_at, responded_at
    FROM kristo_offline_activation_invitations
    WHERE invitee_user_id = ${uid}
      AND status = 'pending'
    ORDER BY created_at DESC
  `) as InvitationRow[];

  return rows.map(rowToRecord);
}

export async function dbListPendingSupervisorInvitations(): Promise<OfflineActivationInvitationRecord[]> {
  await ensureOfflineActivationInvitationSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT id, invitee_user_id, invitee_kristo_id, church_id, invited_by_user_id, role, status, created_at, responded_at
    FROM kristo_offline_activation_invitations
    WHERE role = 'Supervisor'
      AND status = 'pending'
    ORDER BY created_at DESC
  `) as InvitationRow[];

  return rows.map(rowToRecord);
}

export async function dbGetInvitationById(
  invitationId: string
): Promise<OfflineActivationInvitationRecord | null> {
  const id = String(invitationId || "").trim();
  if (!id) return null;

  await ensureOfflineActivationInvitationSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT id, invitee_user_id, invitee_kristo_id, church_id, invited_by_user_id, role, status, created_at, responded_at
    FROM kristo_offline_activation_invitations
    WHERE id = ${id}
    LIMIT 1
  `) as InvitationRow[];

  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

export async function dbUpdateInvitationStatus(input: {
  invitationId: string;
  status: OfflineActivationInvitationStatus;
  respondedAt: string;
}): Promise<OfflineActivationInvitationRecord> {
  const invitationId = String(input.invitationId || "").trim();
  if (!invitationId) throw new Error("invitationId required");

  await ensureOfflineActivationInvitationSchema();
  const sql = getSql();
  const rows = (await sql`
    UPDATE kristo_offline_activation_invitations
    SET status = ${input.status}, responded_at = ${input.respondedAt}
    WHERE id = ${invitationId}
    RETURNING id, invitee_user_id, invitee_kristo_id, church_id, invited_by_user_id, role, status, created_at, responded_at
  `) as InvitationRow[];

  const row = rows[0];
  if (!row) throw new Error("Invitation not found");
  return rowToRecord(row);
}
