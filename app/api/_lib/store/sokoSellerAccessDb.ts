import { randomBytes } from "node:crypto";

import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
} from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type SokoSellerApplicationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked";

export type SokoSellerApplication = {
  id: string;
  userId: string;
  kristoId: string;
  displayName: string;
  email?: string;
  phone?: string;
  businessName: string;
  category: string;
  location: string;
  reason: string;
  status: SokoSellerApplicationStatus;
  adminNotes?: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  commandCode?: string;
  codeExpiresAt?: string;
};

export type SokoSellerAccess = {
  approved: boolean;
  userId: string;
  kristoId: string;
  activatedAt?: string;
  applicationId?: string;
};

let sqlClient:
  | ReturnType<typeof neon>
  | null = null;

let schemaReady:
  | Promise<void>
  | null = null;

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

function cleanText(
  value: unknown,
  limit: number
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function applicationId() {
  return (
    `soko_app_${Date.now().toString(36)}_` +
    randomBytes(5).toString("hex")
  );
}

function codeId() {
  return (
    `soko_code_${Date.now().toString(36)}_` +
    randomBytes(5).toString("hex")
  );
}

const CODE_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCommandCode() {
  const bytes = randomBytes(10);
  let body = "";

  for (let index = 0; index < 10; index += 1) {
    body +=
      CODE_ALPHABET[
        bytes[index] % CODE_ALPHABET.length
      ];
  }

  return `SOKO-${body.slice(0, 5)}-${body.slice(5)}`;
}

function normalizeCode(value: unknown) {
  const compact = cleanText(value, 40)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (
    compact.startsWith("SOKO") &&
    compact.length === 14
  ) {
    return `SOKO-${compact.slice(4, 9)}-${compact.slice(9)}`;
  }

  return compact;
}

function dateText(value: unknown) {
  if (!value) return undefined;
  const parsed = new Date(value as any);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : undefined;
}

type ApplicationRow = {
  id: string;
  user_id: string;
  kristo_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  business_name: string;
  category: string;
  location: string;
  reason: string;
  status: string;
  admin_notes: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  command_code?: string | null;
  code_expires_at?: string | Date | null;
};

function rowToApplication(
  row: ApplicationRow
): SokoSellerApplication {
  return {
    id: row.id,
    userId: row.user_id,
    kristoId: row.kristo_id,
    displayName: row.display_name,
    email: row.email || undefined,
    phone: row.phone || undefined,
    businessName: row.business_name,
    category: row.category,
    location: row.location,
    reason: row.reason,
    status:
      row.status as SokoSellerApplicationStatus,
    adminNotes:
      row.admin_notes || undefined,
    reviewedByUserId:
      row.reviewed_by_user_id || undefined,
    reviewedAt:
      dateText(row.reviewed_at),
    createdAt:
      dateText(row.created_at) ||
      new Date(0).toISOString(),
    updatedAt:
      dateText(row.updated_at) ||
      new Date(0).toISOString(),
    commandCode:
      row.command_code || undefined,
    codeExpiresAt:
      dateText(row.code_expires_at),
  };
}

export async function ensureSokoSellerAccessSchema() {
  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const sql = getSql();

    await sql`
      CREATE TABLE IF NOT EXISTS
        soko_seller_applications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          kristo_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          business_name TEXT NOT NULL,
          category TEXT NOT NULL,
          location TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          admin_notes TEXT,
          reviewed_by_user_id TEXT,
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS
        soko_seller_applications_status_idx
      ON soko_seller_applications (
        status,
        created_at DESC
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS
        soko_seller_command_codes (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          kristo_id TEXT NOT NULL,
          code_value TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active',
          expires_at TIMESTAMPTZ NOT NULL,
          issued_by_user_id TEXT NOT NULL,
          redeemed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS
        soko_seller_codes_owner_status_idx
      ON soko_seller_command_codes (
        user_id,
        status,
        expires_at DESC
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS
        soko_seller_accounts (
          user_id TEXT PRIMARY KEY,
          kristo_id TEXT NOT NULL,
          application_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          activated_with_code_id TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS
        soko_seller_accounts_kristo_id_uidx
      ON soko_seller_accounts (
        kristo_id
      )
    `;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

export async function dbGetMySokoSellerApplication(
  userId: string
) {
  await ensureSokoSellerAccessSchema();
  const sql = getSql();
  const uid = cleanText(userId, 180);

  const rows = (await sql`
    SELECT
      application.*,
      code.code_value AS command_code,
      code.expires_at AS code_expires_at
    FROM soko_seller_applications application
    LEFT JOIN LATERAL (
      SELECT
        code_value,
        expires_at
      FROM soko_seller_command_codes
      WHERE application_id = application.id
        AND user_id = application.user_id
        AND status = 'active'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    ) code ON TRUE
    WHERE application.user_id = ${uid}
    LIMIT 1
  `) as ApplicationRow[];

  return rows[0]
    ? rowToApplication(rows[0])
    : null;
}

export async function dbSubmitSokoSellerApplication(
  input: {
    userId: string;
    kristoId: string;
    displayName: string;
    email?: string;
    phone?: string;
    businessName: string;
    category: string;
    location: string;
    reason: string;
  }
) {
  await ensureSokoSellerAccessSchema();
  const sql = getSql();

  const userId = cleanText(input.userId, 180);
  const kristoId = cleanText(
    input.kristoId,
    120
  ).toUpperCase();
  const displayName = cleanText(
    input.displayName,
    180
  );
  const businessName = cleanText(
    input.businessName,
    180
  );
  const category = cleanText(
    input.category,
    100
  );
  const location = cleanText(
    input.location,
    180
  );
  const reason = cleanText(input.reason, 1500);

  if (
    !userId ||
    !kristoId ||
    !displayName ||
    businessName.length < 2 ||
    !category ||
    location.length < 2 ||
    reason.length < 10
  ) {
    throw new Error(
      "Complete the seller application before submitting."
    );
  }

  const rows = (await sql`
    INSERT INTO soko_seller_applications (
      id,
      user_id,
      kristo_id,
      display_name,
      email,
      phone,
      business_name,
      category,
      location,
      reason,
      status,
      created_at,
      updated_at
    ) VALUES (
      ${applicationId()},
      ${userId},
      ${kristoId},
      ${displayName},
      ${cleanText(input.email, 240) || null},
      ${cleanText(input.phone, 80) || null},
      ${businessName},
      ${category},
      ${location},
      ${reason},
      'pending',
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
      kristo_id = EXCLUDED.kristo_id,
      display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      business_name = EXCLUDED.business_name,
      category = EXCLUDED.category,
      location = EXCLUDED.location,
      reason = EXCLUDED.reason,
      status = CASE
        WHEN soko_seller_applications.status IN (
          'rejected',
          'revoked'
        ) THEN 'pending'
        ELSE soko_seller_applications.status
      END,
      admin_notes = CASE
        WHEN soko_seller_applications.status IN (
          'rejected',
          'revoked'
        ) THEN NULL
        ELSE soko_seller_applications.admin_notes
      END,
      updated_at = NOW()
    RETURNING *
  `) as ApplicationRow[];

  return rowToApplication(rows[0]);
}

export async function dbListSokoSellerApplications(
  status?: string
) {
  await ensureSokoSellerAccessSchema();
  const sql = getSql();
  const normalizedStatus = cleanText(
    status,
    40
  ).toLowerCase();

  const rows = (await sql`
    SELECT
      application.*,
      code.code_value AS command_code,
      code.expires_at AS code_expires_at
    FROM soko_seller_applications application
    LEFT JOIN LATERAL (
      SELECT
        code_value,
        expires_at
      FROM soko_seller_command_codes
      WHERE application_id = application.id
        AND status = 'active'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    ) code ON TRUE
    WHERE (
      ${normalizedStatus} = ''
      OR application.status = ${normalizedStatus}
    )
    ORDER BY
      CASE application.status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        WHEN 'rejected' THEN 2
        ELSE 3
      END,
      application.created_at DESC
    LIMIT 300
  `) as ApplicationRow[];

  return rows.map(rowToApplication);
}

export async function dbReviewSokoSellerApplication(
  input: {
    applicationId: string;
    actorUserId: string;
    decision:
      | "approve"
      | "reject"
      | "revoke"
      | "regenerate_code";
    notes?: string;
  }
) {
  await ensureSokoSellerAccessSchema();
  const sql = getSql();
  const id = cleanText(input.applicationId, 180);
  const actorUserId = cleanText(
    input.actorUserId,
    180
  );
  const notes = cleanText(input.notes, 2000);
  const decision = input.decision;

  if (!id || !actorUserId) {
    throw new Error(
      "Complete review information is required."
    );
  }

  if (
    decision !== "approve" &&
    decision !== "reject" &&
    decision !== "revoke" &&
    decision !== "regenerate_code"
  ) {
    throw new Error(
      "Choose a valid seller application decision."
    );
  }

  const newStatus =
    decision === "reject"
      ? "rejected"
      : decision === "revoke"
        ? "revoked"
        : "approved";

  const commandCode =
    decision === "approve" ||
    decision === "regenerate_code"
      ? createCommandCode()
      : "";
  const normalizedCode = normalizeCode(
    commandCode
  );
  const newCodeId = commandCode
    ? codeId()
    : "";

  const rows = (await sql`
    WITH target AS (
      SELECT
        id,
        user_id,
        kristo_id
      FROM soko_seller_applications
      WHERE id = ${id}
      LIMIT 1
    ),
    revoke_codes AS (
      UPDATE soko_seller_command_codes
      SET
        status = 'revoked',
        updated_at = NOW()
      WHERE application_id = ${id}
        AND status = 'active'
      RETURNING id
    ),
    update_application AS (
      UPDATE soko_seller_applications
      SET
        status = ${newStatus},
        admin_notes = ${notes || null},
        reviewed_by_user_id = ${actorUserId},
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}
        AND EXISTS (SELECT 1 FROM target)
      RETURNING *
    ),
    revoke_account AS (
      UPDATE soko_seller_accounts
      SET
        status = 'revoked',
        updated_at = NOW()
      WHERE application_id = ${id}
        AND ${decision === "revoke"}::boolean
      RETURNING user_id
    ),
    insert_code AS (
      INSERT INTO soko_seller_command_codes (
        id,
        application_id,
        user_id,
        kristo_id,
        code_value,
        status,
        expires_at,
        issued_by_user_id,
        created_at,
        updated_at
      )
      SELECT
        ${newCodeId || null},
        target.id,
        target.user_id,
        target.kristo_id,
        ${normalizedCode || null},
        'active',
        NOW() + INTERVAL '7 days',
        ${actorUserId},
        NOW(),
        NOW()
      FROM target
      WHERE ${Boolean(commandCode)}::boolean
      RETURNING code_value, expires_at
    )
    SELECT
      update_application.*,
      insert_code.code_value AS command_code,
      insert_code.expires_at AS code_expires_at
    FROM update_application
    LEFT JOIN insert_code ON TRUE
  `) as ApplicationRow[];

  if (!rows[0]) {
    throw new Error(
      "Seller application was not found."
    );
  }

  return rowToApplication(rows[0]);
}

export async function dbGetSokoSellerAccess(
  input: {
    userId: string;
    kristoId?: string;
  }
): Promise<SokoSellerAccess> {
  await ensureSokoSellerAccessSchema();
  const sql = getSql();
  const userId = cleanText(input.userId, 180);
  const kristoId = cleanText(
    input.kristoId,
    120
  ).toUpperCase();

  const rows = (await sql`
    SELECT
      user_id,
      kristo_id,
      application_id,
      activated_at
    FROM soko_seller_accounts
    WHERE user_id = ${userId}
      AND status = 'active'
      AND (
        ${kristoId} = ''
        OR kristo_id = ${kristoId}
      )
    LIMIT 1
  `) as Array<{
    user_id: string;
    kristo_id: string;
    application_id: string;
    activated_at: string | Date;
  }>;

  const row = rows[0];

  return {
    approved: Boolean(row),
    userId,
    kristoId:
      row?.kristo_id || kristoId,
    activatedAt:
      dateText(row?.activated_at),
    applicationId:
      row?.application_id || undefined,
  };
}

export async function dbRedeemSokoSellerCommandCode(
  input: {
    userId: string;
    kristoId: string;
    commandCode: string;
  }
) {
  await ensureSokoSellerAccessSchema();
  const sql = getSql();
  const userId = cleanText(input.userId, 180);
  const kristoId = cleanText(
    input.kristoId,
    120
  ).toUpperCase();
  const commandCode = normalizeCode(
    input.commandCode
  );

  if (!userId || !kristoId || !commandCode) {
    throw new Error(
      "Sign in with Kristo and enter your seller command code."
    );
  }

  const rows = (await sql`
    WITH claimed AS (
      UPDATE soko_seller_command_codes code
      SET
        status = 'redeemed',
        redeemed_at = NOW(),
        updated_at = NOW()
      WHERE code.code_value = ${commandCode}
        AND code.user_id = ${userId}
        AND code.kristo_id = ${kristoId}
        AND code.status = 'active'
        AND code.expires_at > NOW()
        AND EXISTS (
          SELECT 1
          FROM soko_seller_applications application
          WHERE application.id = code.application_id
            AND application.user_id = ${userId}
            AND application.kristo_id = ${kristoId}
            AND application.status = 'approved'
        )
      RETURNING
        code.id,
        code.application_id,
        code.user_id,
        code.kristo_id
    ),
    activate AS (
      INSERT INTO soko_seller_accounts (
        user_id,
        kristo_id,
        application_id,
        status,
        activated_at,
        activated_with_code_id,
        updated_at
      )
      SELECT
        user_id,
        kristo_id,
        application_id,
        'active',
        NOW(),
        id,
        NOW()
      FROM claimed
      ON CONFLICT (user_id) DO UPDATE
      SET
        kristo_id = EXCLUDED.kristo_id,
        application_id = EXCLUDED.application_id,
        status = 'active',
        activated_at = NOW(),
        activated_with_code_id =
          EXCLUDED.activated_with_code_id,
        updated_at = NOW()
      RETURNING
        user_id,
        kristo_id,
        application_id,
        activated_at
    )
    SELECT * FROM activate
  `) as Array<{
    user_id: string;
    kristo_id: string;
    application_id: string;
    activated_at: string | Date;
  }>;

  const row = rows[0];

  if (!row) {
    throw new Error(
      "This seller code is invalid, expired, already used, or belongs to another Kristo ID."
    );
  }

  return {
    approved: true as const,
    userId: row.user_id,
    kristoId: row.kristo_id,
    applicationId: row.application_id,
    activatedAt:
      dateText(row.activated_at),
  };
}
