import { neon, neonConfig } from "@neondatabase/serverless";

import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type PlatformRole = "System_Admin" | "Supervisor" | "Agent";

export type PlatformRoleRecord = {
  userId: string;
  platformRole: PlatformRole;
  updatedAt?: string;
  note?: string;
};

export type PlatformRoleStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

type PlatformRoleRow = {
  user_id: string;
  platform_role: string;
  note: string | null;
  created_at: string;
  updated_at: string;
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

function rowToRecord(row: PlatformRoleRow): PlatformRoleRecord {
  return {
    userId: row.user_id,
    platformRole: row.platform_role as PlatformRole,
    note: row.note || undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function resolvePlatformRoleStoreMode(): PlatformRoleStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

export async function ensurePlatformRoleStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Platform role database not configured");
  }
  if (usePostgres()) {
    await ensurePlatformRoleSchema();
  }
}

export async function ensurePlatformRoleSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_platform_roles (
          user_id TEXT PRIMARY KEY,
          platform_role TEXT NOT NULL,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT kristo_platform_roles_role_check
            CHECK (platform_role IN ('System_Admin', 'Supervisor', 'Agent'))
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_platform_roles_role_idx
        ON kristo_platform_roles (platform_role)
      `;
    })();
  }
  await schemaReady;
}

export async function dbGetPlatformRole(userId: string): Promise<PlatformRole | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  await ensurePlatformRoleSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT user_id, platform_role, note, created_at, updated_at
    FROM kristo_platform_roles
    WHERE user_id = ${uid}
    LIMIT 1
  `) as PlatformRoleRow[];

  const row = rows[0];
  if (!row) return null;
  const role = String(row.platform_role || "").trim();
  if (role === "System_Admin" || role === "Supervisor" || role === "Agent") {
    return role;
  }
  return null;
}

export async function dbUpsertPlatformRole(
  userId: string,
  platformRole: PlatformRole,
  note?: string
): Promise<PlatformRoleRecord> {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("userId required");

  await ensurePlatformRoleSchema();
  const sql = getSql();
  const noteValue = String(note || "").trim() || null;
  const now = nowIso();

  const rows = (await sql`
    INSERT INTO kristo_platform_roles (user_id, platform_role, note, created_at, updated_at)
    VALUES (${uid}, ${platformRole}, ${noteValue}, ${now}, ${now})
    ON CONFLICT (user_id) DO UPDATE SET
      platform_role = EXCLUDED.platform_role,
      note = COALESCE(EXCLUDED.note, kristo_platform_roles.note),
      updated_at = EXCLUDED.updated_at
    RETURNING user_id, platform_role, note, created_at, updated_at
  `) as PlatformRoleRow[];

  const row = rows[0];
  if (!row) throw new Error("Failed to upsert platform role");
  return rowToRecord(row);
}

export async function dbListPlatformRoles(limit = 500): Promise<PlatformRoleRecord[]> {
  await ensurePlatformRoleSchema();
  const sql = getSql();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 5000));
  const rows = (await sql`
    SELECT user_id, platform_role, note, created_at, updated_at
    FROM kristo_platform_roles
    ORDER BY updated_at DESC
    LIMIT ${safeLimit}
  `) as PlatformRoleRow[];

  return rows.map(rowToRecord);
}
