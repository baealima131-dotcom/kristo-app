import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, updateJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export const DIRECT_MESSAGE_THREADS_STORE_KEY = "direct-message-threads.json";

type DirectMessageThreadStoreKey = typeof DIRECT_MESSAGE_THREADS_STORE_KEY;

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

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_room_message_store (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })();
  }
  await schemaReady;
}

async function ensureReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Direct message thread database not configured");
  }
  if (usePostgres()) {
    await ensureSchema();
  }
}

async function readDocument<T>(fallback: T): Promise<T> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM kristo_room_message_store WHERE key = ${DIRECT_MESSAGE_THREADS_STORE_KEY} LIMIT 1
  `;
  const row = (rows as { data: T }[])[0];
  return row && row.data != null ? (row.data as T) : fallback;
}

async function writeDocument<T>(data: T): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO kristo_room_message_store (key, data, updated_at)
    VALUES (${DIRECT_MESSAGE_THREADS_STORE_KEY}, ${data as any}, NOW())
    ON CONFLICT (key)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

export async function readDirectMessageThreadStore<T>(fallback: T): Promise<T> {
  await ensureReady();
  if (!usePostgres()) {
    return readJsonFile<T>(DIRECT_MESSAGE_THREADS_STORE_KEY, fallback);
  }
  return readDocument<T>(fallback);
}

export async function writeDirectMessageThreadStore<T>(data: T): Promise<void> {
  await ensureReady();
  if (!usePostgres()) {
    await writeJsonFile<T>(DIRECT_MESSAGE_THREADS_STORE_KEY, data);
    return;
  }
  await writeDocument<T>(data);
}

export async function updateDirectMessageThreadStore<T>(
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  await ensureReady();
  if (!usePostgres()) {
    return updateJsonFile<T>(DIRECT_MESSAGE_THREADS_STORE_KEY, mutator, fallback);
  }
  const current = await readDocument<T>(fallback);
  const next = mutator(current);
  await writeDocument<T>(next);
  return next;
}
