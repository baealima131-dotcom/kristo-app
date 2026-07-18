import { neon, neonConfig } from "@neondatabase/serverless";
import type { UserProfile } from "@/app/api/auth/_lib/profile";

neonConfig.fetchConnectionCache = true;

export type UserRecord = {
  id: string;
  kristoId?: string;
  email?: string;
  phone?: string;
  password: string;
  lastSeenAt?: number;
  lastOtpAt?: number;
};

type UserRow = {
  id: string;
  kristo_id: string | null;
  email: string | null;
  phone: string | null;
  password: string;
  last_seen_at: string | number | null;
  last_otp_at: string | number | null;
};

type ProfileRow = {
  user_id: string;
  data: UserProfile;
};

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

export function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    ""
  ).trim();
}

export function hasDurableStore(): boolean {
  return Boolean(getDatabaseUrl());
}

export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function ensureAuthStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Auth database not configured");
  }
  if (hasDurableStore()) {
    await ensureAuthSchema();
  }
}

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

function rowToUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    kristoId: row.kristo_id || undefined,
    email: row.email || undefined,
    phone: row.phone || undefined,
    password: row.password,
    lastSeenAt: Number(row.last_seen_at || 0) || 0,
    lastOtpAt: Number(row.last_otp_at || 0) || 0,
  };
}

export async function ensureAuthSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_users (
          id TEXT PRIMARY KEY,
          kristo_id TEXT,
          email TEXT,
          phone TEXT,
          password TEXT NOT NULL,
          last_seen_at BIGINT NOT NULL DEFAULT 0,
          last_otp_at BIGINT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_users_email_unique_idx
        ON kristo_users (LOWER(email))
        WHERE email IS NOT NULL AND email <> ''
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_users_phone_idx
        ON kristo_users (phone)
        WHERE phone IS NOT NULL AND phone <> ''
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_profiles (
          user_id TEXT PRIMARY KEY REFERENCES kristo_users(id) ON DELETE CASCADE,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_profiles_user_code_idx
        ON kristo_profiles ((UPPER(data->>'userCode')))
        WHERE data ? 'userCode'
      `;
    })();
  }
  await schemaReady;
}

export async function dbCountUsers(): Promise<number> {
  await ensureAuthSchema();
  const sql = getSql();
  const rows = await sql`SELECT COUNT(*)::int AS count FROM kristo_users`;
  return Number((rows as any[])?.[0]?.count || 0);
}

export async function dbEmailTaken(email: string): Promise<boolean> {
  await ensureAuthSchema();
  const sql = getSql();
  const key = email.trim().toLowerCase();
  const rows = await sql`
    SELECT id FROM kristo_users WHERE LOWER(email) = ${key} LIMIT 1
  `;
  return (rows as any[]).length > 0;
}

export async function dbPhoneTaken(phone: string): Promise<boolean> {
  await ensureAuthSchema();
  const sql = getSql();
  const key = phone.trim();
  const rows = await sql`
    SELECT id FROM kristo_users WHERE phone = ${key} LIMIT 1
  `;
  return (rows as any[]).length > 0;
}

export async function dbCreateUser(user: UserRecord): Promise<UserRecord> {
  await ensureAuthSchema();
  const sql = getSql();
  const email = user.email ? user.email.trim().toLowerCase() : null;
  const phone = user.phone ? user.phone.trim() : null;
  const rows = await sql`
    INSERT INTO kristo_users (
      id, kristo_id, email, phone, password, last_seen_at, last_otp_at, updated_at
    ) VALUES (
      ${user.id},
      ${user.kristoId || null},
      ${email},
      ${phone},
      ${user.password},
      ${user.lastSeenAt || 0},
      ${user.lastOtpAt || 0},
      NOW()
    )
    RETURNING *
  `;
  return rowToUser((rows as UserRow[])[0]);
}

export async function dbGetUserById(userId: string): Promise<UserRecord | null> {
  await ensureAuthSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM kristo_users WHERE id = ${userId} LIMIT 1`;
  const row = (rows as UserRow[])[0];
  return row ? rowToUser(row) : null;
}

export async function dbFindUserByKristoId(
  kristoId: string
): Promise<UserRecord | null> {
  await ensureAuthSchema();
  const key = String(kristoId || "").trim().toUpperCase();
  if (!key) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM kristo_users
    WHERE UPPER(COALESCE(kristo_id, '')) = ${key}
    LIMIT 1
  `;
  const row = (rows as UserRow[])[0];
  return row ? rowToUser(row) : null;
}

export async function dbFindUserByEmail(email: string): Promise<UserRecord | null> {
  await ensureAuthSchema();
  const sql = getSql();
  const key = email.trim().toLowerCase();
  const rows = await sql`
    SELECT * FROM kristo_users WHERE LOWER(email) = ${key} LIMIT 1
  `;
  const row = (rows as UserRow[])[0];
  return row ? rowToUser(row) : null;
}

export async function dbFindUserByPhone(rawPhone: string): Promise<UserRecord | null> {
  await ensureAuthSchema();
  const key = rawPhone.trim();
  const digits = key.replace(/\D/g, "");
  const candidates = Array.from(
    new Set([
      key,
      digits,
      digits.length === 10 ? `1${digits}` : digits,
      digits.length === 10 ? `+1 ${digits}` : key,
    ])
  ).filter(Boolean);

  for (const candidate of candidates) {
    const sql = getSql();
    const rows = await sql`
      SELECT * FROM kristo_users WHERE phone = ${candidate.trim()} LIMIT 1
    `;
    const row = (rows as UserRow[])[0];
    if (row) return rowToUser(row);
  }
  return null;
}

export async function dbUpdateUser(userId: string, patch: Partial<UserRecord>): Promise<UserRecord | null> {
  await ensureAuthSchema();
  const current = await dbGetUserById(userId);
  if (!current) return null;

  const next: UserRecord = {
    ...current,
    ...patch,
    id: userId,
    email: patch.email !== undefined ? (patch.email ? patch.email.trim().toLowerCase() : undefined) : current.email,
    phone: patch.phone !== undefined ? (patch.phone ? patch.phone.trim() : undefined) : current.phone,
  };

  const sql = getSql();
  const rows = await sql`
    UPDATE kristo_users
    SET
      kristo_id = ${next.kristoId || null},
      email = ${next.email ? next.email.trim().toLowerCase() : null},
      phone = ${next.phone || null},
      password = ${next.password},
      last_seen_at = ${next.lastSeenAt || 0},
      last_otp_at = ${next.lastOtpAt || 0},
      updated_at = NOW()
    WHERE id = ${userId}
    RETURNING *
  `;
  const row = (rows as UserRow[])[0];
  return row ? rowToUser(row) : null;
}

export async function dbDeleteUser(userId: string): Promise<void> {
  await ensureAuthSchema();
  const sql = getSql();
  await sql`DELETE FROM kristo_users WHERE id = ${userId}`;
}

export async function dbGetProfile(userId: string): Promise<UserProfile | null> {
  await ensureAuthSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT user_id, data FROM kristo_profiles WHERE user_id = ${userId} LIMIT 1
  `;
  const row = (rows as ProfileRow[])[0];
  return row?.data ? (row.data as UserProfile) : null;
}

export async function dbUpsertProfile(profile: UserProfile): Promise<UserProfile> {
  await ensureAuthSchema();
  const sql = getSql();
  const payload = { ...profile, updatedAt: Date.now() };
  await sql`
    INSERT INTO kristo_profiles (user_id, data, updated_at)
    VALUES (${profile.userId}, ${payload as any}, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
  return payload;
}

export async function dbDeleteProfile(userId: string): Promise<void> {
  await ensureAuthSchema();
  const sql = getSql();
  await sql`DELETE FROM kristo_profiles WHERE user_id = ${userId}`;
}

export async function dbFindProfileByUserCode(code: string): Promise<UserProfile | null> {
  await ensureAuthSchema();
  const key = code.trim().toUpperCase();
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM kristo_profiles
    WHERE
      UPPER(data->>'userCode') = ${key}
      OR UPPER(data->>'userId') = ${key}
      OR UPPER(data->>'coreId') = ${key}
      OR UPPER(data->>'coreIdBirth') = ${key}
    LIMIT 1
  `;
  const row = (rows as { data: UserProfile }[])[0];
  return row?.data ? (row.data as UserProfile) : null;
}

export type AuthStoreMode = "postgres" | "local-json";

export function resolveAuthStoreMode(): AuthStoreMode {
  return hasDurableStore() ? "postgres" : "local-json";
}

export async function getAuthStoreDiagnostics() {
  const hasDatabaseUrl = hasDurableStore();
  const storeMode = resolveAuthStoreMode();
  const vercel = isVercelRuntime();

  let usersTableReachable = false;
  let userCount: number | null = null;
  let storeError: string | null = null;

  if (hasDatabaseUrl) {
    try {
      userCount = await dbCountUsers();
      usersTableReachable = true;
    } catch (error: any) {
      storeError = String(error?.message || error || "postgres_unreachable");
    }
  } else if (vercel) {
    storeError = "Auth database not configured";
  }

  return {
    ok: vercel ? hasDatabaseUrl && usersTableReachable : true,
    hasDatabaseUrl,
    storeMode: vercel && !hasDatabaseUrl ? "missing-db-on-vercel" : storeMode,
    usersTableReachable,
    userCount,
    storeError,
    nodeEnv: process.env.NODE_ENV || "unknown",
    vercel: Boolean(process.env.VERCEL),
    vercelEnv: process.env.VERCEL_ENV || null,
    databaseUrlConfigured: hasDatabaseUrl,
    databaseEnvKeysPresent: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
      POSTGRES_URL_NON_POOLING: Boolean(process.env.POSTGRES_URL_NON_POOLING),
      POSTGRES_PRISMA_URL: Boolean(process.env.POSTGRES_PRISMA_URL),
    },
    authDbModule: "authDb.v1",
  };
}

export function isAuthDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("auth database not configured") ||
    message.includes("database_url not configured") ||
    message.includes("database_url is required")
  );
}
