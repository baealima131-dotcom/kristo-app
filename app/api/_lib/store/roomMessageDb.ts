import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, updateJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

/**
 * Durable JSON store for room messages (ministry / live-control chat, assignment
 * cards and schedule slots).
 *
 * Room messages previously persisted through the filesystem store (fs.ts), which
 * writes to /tmp on Vercel. That storage is ephemeral and per serverless
 * instance, so attachments, cards and schedule slots vanished across polls,
 * instances, redeploys and devices. This wrapper mirrors the read/write/update
 * primitives of fs.ts but persists the room-messages document as a single JSONB
 * row in the same Postgres database used by feed/media/ministry/live data.
 *
 * When no database is configured locally it transparently delegates to the
 * filesystem store so local dev keeps working. On Vercel without a database it
 * refuses to fall back to /tmp and throws instead, so we never silently lose
 * durability.
 */

export const ROOM_MESSAGES_STORE_KEY = "room-messages.json";

type RoomMessageStoreKey = typeof ROOM_MESSAGES_STORE_KEY;

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

export type RoomMessageStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveRoomMessageStoreMode(): RoomMessageStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

function normalizeStoreKey(fileName: string): RoomMessageStoreKey {
  const f = String(fileName || "").trim().toLowerCase();
  if (f === "room-messages.json") return ROOM_MESSAGES_STORE_KEY;
  throw new Error(`Unsupported room message store file: ${fileName}`);
}

export async function ensureRoomMessageStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    console.log("KRISTO_ROOM_MESSAGES_DURABLE_STORE_MISSING_DB", {
      mode: "missing-db-on-vercel",
      vercel: true,
      hasDatabaseUrl: false,
    });
    throw new Error("Room messages database not configured");
  }
  if (usePostgres()) {
    await ensureRoomMessageSchema();
  }
}

async function ensureRoomMessageSchema() {
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
      console.log("KRISTO_ROOM_MESSAGES_DURABLE_STORE_READY", {
        mode: "postgres",
        table: "kristo_room_message_store",
      });
    })();
  }
  await schemaReady;
}

async function readDocument<T>(key: RoomMessageStoreKey, fallback: T): Promise<T> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM kristo_room_message_store WHERE key = ${key} LIMIT 1
  `;
  const row = (rows as { data: T }[])[0];
  const data = row && row.data != null ? (row.data as T) : fallback;

  console.log("KRISTO_ROOM_MESSAGES_DURABLE_READ", {
    key,
    mode: "postgres",
    hit: Boolean(row && row.data != null),
  });

  return data;
}

async function writeDocument<T>(key: RoomMessageStoreKey, data: T): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO kristo_room_message_store (key, data, updated_at)
    VALUES (${key}, ${data as any}, NOW())
    ON CONFLICT (key)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;

  console.log("KRISTO_ROOM_MESSAGES_DURABLE_WRITE", {
    key,
    mode: "postgres",
  });
}

/** Durable replacement for fs.readJsonFile for room messages. */
export async function readRoomMessagesJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const key = normalizeStoreKey(fileName);

  // Guard first: on Vercel without a database this throws (and logs) instead of
  // silently delegating to the /tmp filesystem store.
  await ensureRoomMessageStoreReady();

  if (!usePostgres()) {
    return readJsonFile<T>(key, fallback);
  }

  return readDocument<T>(key, fallback);
}

/** Durable replacement for fs.writeJsonFile for room messages. */
export async function writeRoomMessagesJsonFile<T>(fileName: string, data: T): Promise<void> {
  const key = normalizeStoreKey(fileName);

  await ensureRoomMessageStoreReady();

  if (!usePostgres()) {
    await writeJsonFile<T>(key, data);
    return;
  }

  await writeDocument<T>(key, data);
}

/** Durable replacement for fs.updateJsonFile for room messages. */
export async function updateRoomMessagesJsonFile<T>(
  fileName: string,
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  const key = normalizeStoreKey(fileName);

  await ensureRoomMessageStoreReady();

  if (!usePostgres()) {
    return updateJsonFile<T>(key, mutator, fallback);
  }

  const current = await readDocument<T>(key, fallback);
  const next = mutator(current);
  await writeDocument<T>(key, next);
  return next;
}

export function isRoomMessageDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("room messages database not configured") ||
    message.includes("database_url not configured")
  );
}
