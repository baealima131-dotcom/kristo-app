import { neon, neonConfig } from "@neondatabase/serverless";

import {
  getDatabaseUrl,
  hasDurableStore,
  isVercelRuntime,
} from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type SafetyRole =
  | "Safety_Supervisor"
  | "Safety_Agent";

export type SafetyInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled";

export type SafetyInvitation = {
  id: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
  role: SafetyRole;
  status: SafetyInvitationStatus;
  createdAt: string;
  respondedAt?: string | null;
};

export type SafetyRoleRecord = {
  userId: string;
  churchId: string;
  role: SafetyRole;
  createdAt: string;
  updatedAt: string;
};

let sqlClient: ReturnType<typeof neon> | null =
  null;

let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();

    if (!url) {
      throw new Error(
        "DATABASE_URL not configured"
      );
    }

    sqlClient = neon(url);
  }

  return sqlClient;
}

function invitationId() {
  return `safeinv_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export async function ensureSafetySchema() {
  if (
    isVercelRuntime() &&
    !hasDurableStore()
  ) {
    throw new Error(
      "Safety database not configured"
    );
  }

  if (!hasDurableStore()) return;

  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_safety_roles (
          user_id TEXT NOT NULL,
          church_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, role),
          CONSTRAINT kristo_safety_roles_role_check
            CHECK (
              role IN (
                'Safety_Supervisor',
                'Safety_Agent'
              )
            )
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_safety_invitations (
          id TEXT PRIMARY KEY,
          invitee_user_id TEXT NOT NULL,
          invitee_kristo_id TEXT NOT NULL,
          church_id TEXT NOT NULL,
          invited_by_user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          responded_at TIMESTAMPTZ,
          CONSTRAINT kristo_safety_invite_role_check
            CHECK (
              role IN (
                'Safety_Supervisor',
                'Safety_Agent'
              )
            ),
          CONSTRAINT kristo_safety_invite_status_check
            CHECK (
              status IN (
                'pending',
                'accepted',
                'declined',
                'cancelled'
              )
            )
        )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_safety_invite_pending_unique
        ON kristo_safety_invitations (
          invitee_user_id,
          church_id,
          role
        )
        WHERE status = 'pending'
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_roles_role_idx
        ON kristo_safety_roles (role)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_invite_user_status_idx
        ON kristo_safety_invitations (
          invitee_user_id,
          status
        )
      `;
    })();
  }

  await schemaReady;
}

export async function dbHasSafetyRole(
  userId: string,
  role: SafetyRole
) {
  await ensureSafetySchema();

  const sql = getSql();
  const uid = String(userId || "").trim();

  const rows = (await sql`
    SELECT user_id
    FROM kristo_safety_roles
    WHERE user_id = ${uid}
      AND role = ${role}
    LIMIT 1
  `) as Array<{
    user_id: string;
  }>;

  return rows.length > 0;
}

export async function dbListSafetyRoles(
  role: SafetyRole
): Promise<SafetyRoleRecord[]> {
  await ensureSafetySchema();

  const sql = getSql();

  const rows = (await sql`
    SELECT
      user_id,
      church_id,
      role,
      created_at,
      updated_at
    FROM kristo_safety_roles
    WHERE role = ${role}
    ORDER BY created_at DESC
  `) as Array<{
    user_id: string;
    church_id: string;
    role: string;
    created_at: string | Date;
    updated_at: string | Date;
  }>;

  return rows.map((row) => ({
    userId: String(row.user_id || ""),
    churchId: String(row.church_id || ""),
    role: row.role as SafetyRole,
    createdAt: new Date(
      row.created_at
    ).toISOString(),
    updatedAt: new Date(
      row.updated_at
    ).toISOString(),
  }));
}

export async function dbFindPendingSafetyInvite(input: {
  inviteeUserId: string;
  churchId: string;
  role: SafetyRole;
}): Promise<SafetyInvitation | null> {
  await ensureSafetySchema();

  const sql = getSql();

  const rows = (await sql`
    SELECT *
    FROM kristo_safety_invitations
    WHERE invitee_user_id = ${input.inviteeUserId}
      AND church_id = ${input.churchId}
      AND role = ${input.role}
      AND status = 'pending'
    LIMIT 1
  `) as Array<Record<string, any>>;

  const row = rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    inviteeUserId: String(
      row.invitee_user_id
    ),
    inviteeKristoId: String(
      row.invitee_kristo_id
    ),
    churchId: String(row.church_id),
    invitedByUserId: String(
      row.invited_by_user_id
    ),
    role: row.role as SafetyRole,
    status:
      row.status as SafetyInvitationStatus,
    createdAt: new Date(
      row.created_at
    ).toISOString(),
    respondedAt: row.responded_at
      ? new Date(
          row.responded_at
        ).toISOString()
      : null,
  };
}

export async function dbCreateSafetyInvite(input: {
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
  role: SafetyRole;
}): Promise<SafetyInvitation> {
  const existing =
    await dbFindPendingSafetyInvite({
      inviteeUserId:
        input.inviteeUserId,
      churchId: input.churchId,
      role: input.role,
    });

  if (existing) return existing;

  await ensureSafetySchema();

  const sql = getSql();
  const id = invitationId();

  try {
    const rows = (await sql`
      INSERT INTO kristo_safety_invitations (
        id,
        invitee_user_id,
        invitee_kristo_id,
        church_id,
        invited_by_user_id,
        role,
        status
      ) VALUES (
        ${id},
        ${input.inviteeUserId},
        ${input.inviteeKristoId},
        ${input.churchId},
        ${input.invitedByUserId},
        ${input.role},
        'pending'
      )
      RETURNING *
    `) as Array<Record<string, any>>;

    const row = rows[0];

    return {
      id: String(row.id),
      inviteeUserId: String(
        row.invitee_user_id
      ),
      inviteeKristoId: String(
        row.invitee_kristo_id
      ),
      churchId: String(row.church_id),
      invitedByUserId: String(
        row.invited_by_user_id
      ),
      role: row.role as SafetyRole,
      status:
        row.status as SafetyInvitationStatus,
      createdAt: new Date(
        row.created_at
      ).toISOString(),
      respondedAt: null,
    };
  } catch (error: any) {
    const message = String(
      error?.message || error || ""
    ).toLowerCase();

    if (
      message.includes("unique") ||
      message.includes("duplicate")
    ) {
      const deduped =
        await dbFindPendingSafetyInvite({
          inviteeUserId:
            input.inviteeUserId,
          churchId: input.churchId,
          role: input.role,
        });

      if (deduped) return deduped;
    }

    throw error;
  }
}
