import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, updateJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

/**
 * Durable JSON store for ministries data.
 *
 * Ministries previously persisted through the filesystem store (fs.ts), which
 * writes to /tmp on Vercel. That storage is ephemeral per serverless instance,
 * so ministries vanished on redeploy / cold start. This wrapper mirrors the
 * read/write/update primitives of fs.ts but persists each ministry JSON file as
 * a single JSONB document in the same Postgres database used by feed/media data.
 *
 * When no database is configured (local dev) it transparently delegates to the
 * filesystem store so existing local workflows keep working.
 */

export const MINISTRIES_STORE_KEY = "ministries.json";
export const MINISTRY_MEMBERS_STORE_KEY = "ministry-members.json";

type MinistryStoreKey = typeof MINISTRIES_STORE_KEY | typeof MINISTRY_MEMBERS_STORE_KEY;

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

export type MinistryStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveMinistryStoreMode(): MinistryStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

/**
 * Canonicalize the legacy file name variants that exist across routes
 * (e.g. KPI route reads "ministry_members.json") to a single durable key so
 * every consumer reads/writes the same document.
 */
function normalizeStoreKey(fileName: string): MinistryStoreKey {
  const f = String(fileName || "").trim().toLowerCase();

  if (f === "ministries.json") return MINISTRIES_STORE_KEY;

  if (
    f === "ministry-members.json" ||
    f === "ministry_members.json" ||
    f === "ministrymembers.json"
  ) {
    return MINISTRY_MEMBERS_STORE_KEY;
  }

  throw new Error(`Unsupported ministry store file: ${fileName}`);
}

export async function ensureMinistryStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Ministry database not configured");
  }
  if (usePostgres()) {
    await ensureMinistrySchema();
  }
}

async function ensureMinistrySchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_ministry_store (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })();
  }
  await schemaReady;
}

async function readDocument<T>(key: MinistryStoreKey, fallback: T): Promise<T> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM kristo_ministry_store WHERE key = ${key} LIMIT 1
  `;
  const row = (rows as { data: T }[])[0];
  return row && row.data != null ? (row.data as T) : fallback;
}

async function writeDocument<T>(key: MinistryStoreKey, data: T): Promise<void> {
  const sql = getSql();
  const payload = JSON.stringify(data ?? null);
  await sql`
    INSERT INTO kristo_ministry_store (key, data, updated_at)
    VALUES (${key}, ${payload}::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

/** Durable replacement for fs.readJsonFile for ministry documents. */
export async function readMinistryJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    return readJsonFile<T>(key, fallback);
  }

  await ensureMinistryStoreReady();
  return readDocument<T>(key, fallback);
}

/** Durable replacement for fs.writeJsonFile for ministry documents. */
export async function writeMinistryJsonFile<T>(fileName: string, data: T): Promise<void> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    await writeJsonFile<T>(key, data);
    return;
  }

  await ensureMinistryStoreReady();
  await writeDocument<T>(key, data);
}

/** Durable replacement for fs.updateJsonFile for ministry documents. */
export async function updateMinistryJsonFile<T>(
  fileName: string,
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    return updateJsonFile<T>(key, mutator, fallback);
  }

  await ensureMinistryStoreReady();
  const current = await readDocument<T>(key, fallback);
  const next = mutator(current);
  await writeDocument<T>(key, next);
  return next;
}

export function isMinistryDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("ministry database not configured") ||
    message.includes("database_url not configured")
  );
}
