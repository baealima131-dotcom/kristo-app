import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, updateJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

/**
 * Durable JSON store for live / MC-host data.
 *
 * The live system previously persisted through the filesystem store (fs.ts),
 * which writes to /tmp on Vercel. That storage is ephemeral per serverless
 * instance, so live state, suspended live-control members and MC hosts vanished
 * on redeploy / cold start. This wrapper mirrors the read/write/update
 * primitives of fs.ts but persists each live JSON file as a single JSONB
 * document in the same Postgres database used by feed/media/ministry data.
 *
 * When no database is configured (local dev) it transparently delegates to the
 * filesystem store so existing local workflows keep working.
 */

export const CHURCH_LIVE_STORE_KEY = "church-live.json";
export const LIVE_CONTROL_MEMBERS_STORE_KEY = "church-live-control-members.json";
export const MC_HOSTS_STORE_KEY = "mc-hosts.json";

type LiveStoreKey =
  | typeof CHURCH_LIVE_STORE_KEY
  | typeof LIVE_CONTROL_MEMBERS_STORE_KEY
  | typeof MC_HOSTS_STORE_KEY;

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

export type LiveStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveLiveStoreMode(): LiveStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

function normalizeStoreKey(fileName: string): LiveStoreKey {
  const f = String(fileName || "").trim().toLowerCase();

  if (f === "church-live.json") return CHURCH_LIVE_STORE_KEY;
  if (f === "church-live-control-members.json") return LIVE_CONTROL_MEMBERS_STORE_KEY;
  if (f === "mc-hosts.json") return MC_HOSTS_STORE_KEY;

  throw new Error(`Unsupported live store file: ${fileName}`);
}

export async function ensureLiveStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    console.log("KRISTO_LIVE_DURABLE_STORE_MISSING_DB", {
      mode: "missing-db-on-vercel",
      vercel: true,
      hasDatabaseUrl: false,
    });
    throw new Error("Live database not configured");
  }
  if (usePostgres()) {
    await ensureLiveSchema();
  }
}

async function ensureLiveSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_live_store (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      console.log("KRISTO_LIVE_DURABLE_STORE_READY", {
        mode: "postgres",
        table: "kristo_live_store",
      });
    })();
  }
  await schemaReady;
}

async function readDocument<T>(key: LiveStoreKey, fallback: T): Promise<T> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM kristo_live_store WHERE key = ${key} LIMIT 1
  `;
  const row = (rows as { data: T }[])[0];
  return row && row.data != null ? (row.data as T) : fallback;
}

async function writeDocument<T>(key: LiveStoreKey, data: T): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO kristo_live_store (key, data, updated_at)
    VALUES (${key}, ${data as any}, NOW())
    ON CONFLICT (key)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

/** Durable replacement for fs.readJsonFile for live documents. */
export async function readLiveJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    return readJsonFile<T>(key, fallback);
  }

  await ensureLiveStoreReady();
  return readDocument<T>(key, fallback);
}

/** Durable replacement for fs.writeJsonFile for live documents. */
export async function writeLiveJsonFile<T>(fileName: string, data: T): Promise<void> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    await writeJsonFile<T>(key, data);
    return;
  }

  await ensureLiveStoreReady();
  await writeDocument<T>(key, data);
}

/** Durable replacement for fs.updateJsonFile for live documents. */
export async function updateLiveJsonFile<T>(
  fileName: string,
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (!usePostgres()) {
    return updateJsonFile<T>(key, mutator, fallback);
  }

  await ensureLiveStoreReady();
  const current = await readDocument<T>(key, fallback);
  const next = mutator(current);
  await writeDocument<T>(key, next);
  return next;
}

export function isLiveDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("live database not configured") ||
    message.includes("database_url not configured")
  );
}
