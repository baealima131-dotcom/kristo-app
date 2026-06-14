import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, updateJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

/**
 * Durable JSON store for core user / church data.
 *
 * Several core stores historically persisted through the filesystem store
 * (fs.ts), which writes to /tmp on Vercel — ephemeral per serverless instance.
 * This wrapper mirrors the read/write/update primitives of fs.ts but persists
 * each core JSON file as a single JSONB document in the same Postgres database
 * used by feed/media/ministry/live data.
 *
 * Notes on scope:
 * - profiles.json / churches.json / memberships.json already have dedicated
 *   Postgres tables (authDb/churchDb). Their callers only reach the JSON store
 *   in local (no-DB) mode, where this wrapper transparently delegates to fs.ts.
 *   In production those callers use their dedicated tables and never touch this
 *   wrapper. Routing them here keeps the local fallback consistent and removes
 *   the direct fs dependency.
 * - members.json / church_banked.json had no durable backing at all, so this
 *   wrapper is what makes them survive redeploys on Vercel.
 *
 * When no database is configured (local dev) it transparently delegates to the
 * filesystem store so existing local workflows keep working.
 */

export const PROFILES_STORE_KEY = "profiles.json";
export const CHURCHES_STORE_KEY = "churches.json";
export const MEMBERSHIPS_STORE_KEY = "memberships.json";
export const MEMBERS_STORE_KEY = "members.json";
export const CHURCH_BANKED_STORE_KEY = "church_banked.json";
export const FOLLOWS_STORE_KEY = "follows.json";
export const MY_WAY_SETTINGS_STORE_KEY = "my_way_settings.json";

type CoreStoreKey =
  | typeof PROFILES_STORE_KEY
  | typeof CHURCHES_STORE_KEY
  | typeof MEMBERSHIPS_STORE_KEY
  | typeof MEMBERS_STORE_KEY
  | typeof CHURCH_BANKED_STORE_KEY
  | typeof FOLLOWS_STORE_KEY
  | typeof MY_WAY_SETTINGS_STORE_KEY;

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

export type CoreStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveCoreStoreMode(): CoreStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

/** Canonicalize legacy file-name variants to a single durable key. */
function normalizeStoreKey(fileName: string): CoreStoreKey {
  const f = String(fileName || "").trim().toLowerCase();

  if (f === "profiles.json") return PROFILES_STORE_KEY;
  if (f === "churches.json") return CHURCHES_STORE_KEY;

  if (
    f === "memberships.json" ||
    f === "membership.json" ||
    f === "church-memberships.json"
  ) {
    return MEMBERSHIPS_STORE_KEY;
  }

  if (f === "members.json") return MEMBERS_STORE_KEY;
  if (f === "church_banked.json" || f === "church-banked.json") return CHURCH_BANKED_STORE_KEY;

  if (f === "follows.json" || f === "followers.json" || f === "social.json") {
    return FOLLOWS_STORE_KEY;
  }

  if (f === "my_way_settings.json" || f === "my-way-settings.json") {
    return MY_WAY_SETTINGS_STORE_KEY;
  }

  throw new Error(`Unsupported core store file: ${fileName}`);
}

export async function ensureCoreStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    console.log("KRISTO_CORE_DURABLE_STORE_MISSING_DB", {
      mode: "missing-db-on-vercel",
      vercel: true,
      hasDatabaseUrl: false,
    });
    throw new Error("Core database not configured");
  }
  if (usePostgres()) {
    await ensureCoreSchema();
  }
}

async function ensureCoreSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_core_store (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      console.log("KRISTO_CORE_DURABLE_STORE_READY", {
        mode: "postgres",
        table: "kristo_core_store",
      });
    })();
  }
  await schemaReady;
}

async function readDocument<T>(key: CoreStoreKey, fallback: T): Promise<T> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM kristo_core_store WHERE key = ${key} LIMIT 1
  `;
  const row = (rows as { data: T }[])[0];
  return row && row.data != null ? (row.data as T) : fallback;
}

async function writeDocument<T>(key: CoreStoreKey, data: T): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO kristo_core_store (key, data, updated_at)
    VALUES (${key}, ${data as any}, NOW())
    ON CONFLICT (key)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

/** Durable replacement for fs.readJsonFile for core documents. */
export async function readCoreJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    return readJsonFile<T>(key, fallback);
  }

  await ensureCoreStoreReady();
  return readDocument<T>(key, fallback);
}

/** Durable replacement for fs.writeJsonFile for core documents. */
export async function writeCoreJsonFile<T>(fileName: string, data: T): Promise<void> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    await writeJsonFile<T>(key, data);
    return;
  }

  await ensureCoreStoreReady();
  await writeDocument<T>(key, data);
}

/** Durable replacement for fs.updateJsonFile for core documents. */
export async function updateCoreJsonFile<T>(
  fileName: string,
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    return updateJsonFile<T>(key, mutator, fallback);
  }

  await ensureCoreStoreReady();
  const current = await readDocument<T>(key, fallback);
  const next = mutator(current);
  await writeDocument<T>(key, next);
  return next;
}

export function isCoreDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("core database not configured") ||
    message.includes("database_url not configured")
  );
}
