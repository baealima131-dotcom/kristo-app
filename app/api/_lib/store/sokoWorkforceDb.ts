import { randomUUID } from "crypto";
import { neon, neonConfig } from "@neondatabase/serverless";
import { getDatabaseUrl } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type SokoWorkStage =
  | "supply"
  | "setup"
  | "costing"
  | "payments"
  | "review";

export type SokoWorkforceStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "removed";

export type SokoWorkforceRecord = {
  id: string;
  sellerUserId: string;
  sellerKristoId: string;
  sellerDisplayName: string;
  storeName: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  inviteeDisplayName: string;
  churchId: string;
  stage: SokoWorkStage;
  status: SokoWorkforceStatus;
  createdAt: string;
  respondedAt: string | null;
  updatedAt: string;
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

function clean(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function dateText(value: unknown) {
  if (!value) return "";
  try {
    return new Date(value as any).toISOString();
  } catch {
    return String(value || "");
  }
}

export function isSokoWorkStage(value: unknown): value is SokoWorkStage {
  return (
    value === "supply" ||
    value === "setup" ||
    value === "costing" ||
    value === "payments" ||
    value === "review"
  );
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS soko_workforce_invitations (
          id TEXT PRIMARY KEY,
          seller_user_id TEXT NOT NULL,
          seller_kristo_id TEXT NOT NULL,
          seller_display_name TEXT NOT NULL,
          store_name TEXT NOT NULL DEFAULT '',
          invitee_user_id TEXT NOT NULL,
          invitee_kristo_id TEXT NOT NULL,
          invitee_display_name TEXT NOT NULL,
          church_id TEXT NOT NULL,
          stage TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          responded_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        ALTER TABLE soko_workforce_invitations
        ADD COLUMN IF NOT EXISTS store_name TEXT NOT NULL DEFAULT ''
      `;

      await sql`
        UPDATE soko_workforce_invitations workforce
        SET store_name = application.business_name
        FROM soko_seller_applications application
        WHERE application.user_id = workforce.seller_user_id
          AND TRIM(COALESCE(workforce.store_name, '')) = ''
          AND TRIM(COALESCE(application.business_name, '')) <> ''
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_workforce_invitee_status_idx
        ON soko_workforce_invitations (
          invitee_user_id,
          status,
          updated_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_workforce_seller_status_idx
        ON soko_workforce_invitations (
          seller_user_id,
          status,
          updated_at DESC
        )
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  await schemaReady;
}

function fromRow(row: Record<string, any>): SokoWorkforceRecord {
  return {
    id: String(row.id || ""),
    sellerUserId: String(row.seller_user_id || ""),
    sellerKristoId: String(row.seller_kristo_id || "").toUpperCase(),
    sellerDisplayName: String(row.seller_display_name || ""),
    storeName: String(
      row.store_name ||
        row.seller_display_name ||
        "SOKO Store"
    ),
    inviteeUserId: String(row.invitee_user_id || ""),
    inviteeKristoId: String(row.invitee_kristo_id || "").toUpperCase(),
    inviteeDisplayName: String(row.invitee_display_name || ""),
    churchId: String(row.church_id || ""),
    stage: row.stage as SokoWorkStage,
    status: row.status as SokoWorkforceStatus,
    createdAt: dateText(row.created_at),
    respondedAt: row.responded_at ? dateText(row.responded_at) : null,
    updatedAt: dateText(row.updated_at),
  };
}

export async function dbCreateSokoWorkforceInvitation(input: {
  sellerUserId: string;
  sellerKristoId: string;
  sellerDisplayName: string;
  storeName: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  inviteeDisplayName: string;
  churchId: string;
  stage: SokoWorkStage;
}) {
  await ensureSchema();
  const sql = getSql();

  const sellerUserId = clean(input.sellerUserId, 180);
  const sellerKristoId = clean(input.sellerKristoId, 120).toUpperCase();
  const sellerDisplayName =
    clean(input.sellerDisplayName, 180) ||
    "SOKO Seller";

  const storeName =
    clean(input.storeName, 180) ||
    sellerDisplayName ||
    "SOKO Store";

  const inviteeUserId = clean(input.inviteeUserId, 180);
  const inviteeKristoId = clean(input.inviteeKristoId, 120).toUpperCase();
  const inviteeDisplayName = clean(input.inviteeDisplayName, 180) || "Kristo Member";
  const churchId = clean(input.churchId, 180);

  if (
    !sellerUserId ||
    !sellerKristoId ||
    !inviteeUserId ||
    !inviteeKristoId ||
    !churchId ||
    !isSokoWorkStage(input.stage)
  ) {
    throw new Error("Missing or invalid workforce invitation fields");
  }

  const existingRows = (await sql`
    SELECT *
    FROM soko_workforce_invitations
    WHERE seller_user_id = ${sellerUserId}
      AND invitee_user_id = ${inviteeUserId}
      AND status IN ('pending', 'accepted')
    ORDER BY updated_at DESC
    LIMIT 1
  `) as Array<Record<string, any>>;

  const existing = existingRows[0];

  if (existing) {
    if (String(existing.status) === "accepted") {
      return fromRow(existing);
    }

    const updated = (await sql`
      UPDATE soko_workforce_invitations
      SET
        seller_kristo_id = ${sellerKristoId},
        seller_display_name = ${sellerDisplayName},
        store_name = ${storeName},
        invitee_kristo_id = ${inviteeKristoId},
        invitee_display_name = ${inviteeDisplayName},
        church_id = ${churchId},
        stage = ${input.stage},
        updated_at = NOW()
      WHERE id = ${String(existing.id)}
      RETURNING *
    `) as Array<Record<string, any>>;

    return fromRow(updated[0]);
  }

  const id = `sokow_${randomUUID()}`;

  const rows = (await sql`
    INSERT INTO soko_workforce_invitations (
      id,
      seller_user_id,
      seller_kristo_id,
      seller_display_name,
      store_name,
      invitee_user_id,
      invitee_kristo_id,
      invitee_display_name,
      church_id,
      stage,
      status
    ) VALUES (
      ${id},
      ${sellerUserId},
      ${sellerKristoId},
      ${sellerDisplayName},
      ${storeName},
      ${inviteeUserId},
      ${inviteeKristoId},
      ${inviteeDisplayName},
      ${churchId},
      ${input.stage},
      'pending'
    )
    RETURNING *
  `) as Array<Record<string, any>>;

  return fromRow(rows[0]);
}

export async function dbListPendingSokoWorkforceInvitationsForUser(
  userId: string
): Promise<SokoWorkforceRecord[]> {
  await ensureSchema();
  const sql = getSql();
  const uid = clean(userId, 180);
  if (!uid) return [];

  const rows = (await sql`
    SELECT *
    FROM soko_workforce_invitations
    WHERE invitee_user_id = ${uid}
      AND status = 'pending'
    ORDER BY created_at DESC
  `) as Array<Record<string, any>>;

  return rows.map(fromRow);
}

export async function dbListAcceptedSokoWorkforceAssignmentsForUser(
  userId: string
): Promise<SokoWorkforceRecord[]> {
  await ensureSchema();
  const sql = getSql();
  const uid = clean(userId, 180);
  if (!uid) return [];

  const rows = (await sql`
    SELECT *
    FROM soko_workforce_invitations
    WHERE invitee_user_id = ${uid}
      AND status = 'accepted'
    ORDER BY updated_at DESC
  `) as Array<Record<string, any>>;

  return rows.map(fromRow);
}

export async function dbListSokoWorkforceTeamForSeller(
  sellerUserId: string
): Promise<SokoWorkforceRecord[]> {
  await ensureSchema();
  const sql = getSql();
  const uid = clean(sellerUserId, 180);
  if (!uid) return [];

  const rows = (await sql`
    SELECT *
    FROM soko_workforce_invitations
    WHERE seller_user_id = ${uid}
      AND status IN ('pending', 'accepted')
    ORDER BY
      CASE status WHEN 'accepted' THEN 1 ELSE 2 END,
      updated_at DESC
  `) as Array<Record<string, any>>;

  return rows.map(fromRow);
}

export async function dbGetSokoWorkforceInvitationById(
  invitationId: string
): Promise<SokoWorkforceRecord | null> {
  await ensureSchema();
  const sql = getSql();
  const id = clean(invitationId, 240);
  if (!id) return null;

  const rows = (await sql`
    SELECT *
    FROM soko_workforce_invitations
    WHERE id = ${id}
    LIMIT 1
  `) as Array<Record<string, any>>;

  return rows[0] ? fromRow(rows[0]) : null;
}

export async function dbRespondToSokoWorkforceInvitation(input: {
  invitationId: string;
  inviteeUserId: string;
  action: "accept" | "decline";
}): Promise<SokoWorkforceRecord> {
  await ensureSchema();
  const sql = getSql();

  const invitationId = clean(input.invitationId, 240);
  const inviteeUserId = clean(input.inviteeUserId, 180);
  const nextStatus = input.action === "accept" ? "accepted" : "declined";

  const rows = (await sql`
    UPDATE soko_workforce_invitations
    SET
      status = ${nextStatus},
      responded_at = NOW(),
      updated_at = NOW()
    WHERE id = ${invitationId}
      AND invitee_user_id = ${inviteeUserId}
      AND status = 'pending'
    RETURNING *
  `) as Array<Record<string, any>>;

  if (rows[0]) return fromRow(rows[0]);

  const existing = await dbGetSokoWorkforceInvitationById(invitationId);

  if (!existing) throw new Error("Work invitation not found");
  if (existing.inviteeUserId !== inviteeUserId) {
    throw new Error("This invitation belongs to another Kristo account");
  }

  return existing;
}

export async function dbRemoveSokoWorkforceMember(input: {
  invitationId: string;
  sellerUserId: string;
}): Promise<SokoWorkforceRecord> {
  await ensureSchema();
  const sql = getSql();

  const invitationId = clean(input.invitationId, 240);
  const sellerUserId = clean(input.sellerUserId, 180);

  const rows = (await sql`
    UPDATE soko_workforce_invitations
    SET
      status = 'removed',
      updated_at = NOW()
    WHERE id = ${invitationId}
      AND seller_user_id = ${sellerUserId}
      AND status IN ('pending', 'accepted')
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!rows[0]) throw new Error("Worker assignment not found");
  return fromRow(rows[0]);
}
