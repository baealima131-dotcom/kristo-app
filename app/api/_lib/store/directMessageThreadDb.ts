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

async function readDocumentWithVersion<T>(
  fallback: T
): Promise<{ data: T; version: string | null; exists: boolean }> {
  const sql = getSql();
  // Use epoch-micros as the CAS token. Avoid timestamptz string round-trips
  // (JS Date/toISOString truncates microseconds and makes CAS always miss).
  const rows = await sql`
    SELECT
      data,
      (EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint AS version
    FROM kristo_room_message_store
    WHERE key = ${DIRECT_MESSAGE_THREADS_STORE_KEY}
    LIMIT 1
  `;
  const row = (rows as { data: T; version: string | number | bigint | null }[])[0];
  if (!row || row.data == null) {
    return { data: fallback, version: null, exists: false };
  }
  const version =
    row.version == null || row.version === ""
      ? null
      : String(row.version);
  return { data: row.data as T, version, exists: true };
}

async function readDocument<T>(fallback: T): Promise<T> {
  const snap = await readDocumentWithVersion<T>(fallback);
  return snap.data;
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

async function compareAndSwapDocument<T>(
  next: T,
  expectedVersion: string | null,
  exists: boolean
): Promise<boolean> {
  const sql = getSql();
  if (!exists || !expectedVersion) {
    const inserted = await sql`
      INSERT INTO kristo_room_message_store (key, data, updated_at)
      VALUES (${DIRECT_MESSAGE_THREADS_STORE_KEY}, ${next as any}, NOW())
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `;
    return Array.isArray(inserted) && inserted.length > 0;
  }

  const updated = await sql`
    UPDATE kristo_room_message_store
    SET data = ${next as any}, updated_at = NOW()
    WHERE key = ${DIRECT_MESSAGE_THREADS_STORE_KEY}
      AND (EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint = ${expectedVersion}::bigint
    RETURNING key
  `;
  return Array.isArray(updated) && updated.length > 0;
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
  return updateDirectMessageThreadStoreWithResult<T, T>(
    (current) => {
      const next = mutator(current);
      return { next, result: next };
    },
    fallback
  );
}

/**
 * Compare-and-swap update for concurrency-safe DM request slot claims.
 * File store uses the existing in-process lock; Postgres retries on version mismatch.
 */
export async function updateDirectMessageThreadStoreWithResult<T, R>(
  mutator: (current: T) => { next: T; result: R },
  fallback: T,
  options?: { maxRetries?: number }
): Promise<R> {
  await ensureReady();
  const maxRetries = Math.max(1, Number(options?.maxRetries || 12) || 12);

  if (!usePostgres()) {
    let result!: R;
    await updateJsonFile<T>(
      DIRECT_MESSAGE_THREADS_STORE_KEY,
      (current) => {
        const out = mutator(current);
        result = out.result;
        return out.next;
      },
      fallback
    );
    return result;
  }

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const snap = await readDocumentWithVersion<T>(fallback);
    const out = mutator(snap.data);
    const swapped = await compareAndSwapDocument(
      out.next,
      snap.version,
      snap.exists
    );
    if (swapped) return out.result;
  }

  throw new Error("Direct message thread store update conflicted too many times");
}
