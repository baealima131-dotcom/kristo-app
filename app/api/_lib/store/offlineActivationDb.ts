import { neon, neonConfig } from "@neondatabase/serverless";

import {
  getKristoDataDir,
  getJsonStoreDebugInfo,
  readJsonFile,
  updateJsonFile,
  writeJsonFile,
} from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

/**
 * Durable JSON store for offline activation data (codes, agents, invitations).
 *
 * Raw fs.ts writes to /tmp on Vercel, which is ephemeral per serverless instance.
 * Generated activation codes appeared to vanish because generate wrote to /tmp while
 * other reads could fall back to bundled JSON — or because /tmp was wiped on cold start.
 *
 * When DATABASE_URL is configured, persist each activation JSON document in Postgres.
 * Otherwise delegate to the filesystem store with runtime seeding (see fs.ts).
 */

export const OFFLINE_ACTIVATION_CODES_STORE_KEY = "offline_activation_codes.json";
export const OFFLINE_ACTIVATION_AGENTS_STORE_KEY = "offline_activation_agents.json";
export const OFFLINE_ACTIVATION_INVITATIONS_STORE_KEY = "offline_activation_invitations.json";

type OfflineActivationStoreKey =
  | typeof OFFLINE_ACTIVATION_CODES_STORE_KEY
  | typeof OFFLINE_ACTIVATION_AGENTS_STORE_KEY
  | typeof OFFLINE_ACTIVATION_INVITATIONS_STORE_KEY;

const SUPPORTED_KEYS = new Set<string>([
  OFFLINE_ACTIVATION_CODES_STORE_KEY,
  OFFLINE_ACTIVATION_AGENTS_STORE_KEY,
  OFFLINE_ACTIVATION_INVITATIONS_STORE_KEY,
]);

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

export type OfflineActivationStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveOfflineActivationStoreMode(): OfflineActivationStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return usePostgres() ? "postgres" : "local-json";
}

function normalizeStoreKey(fileName: string): OfflineActivationStoreKey {
  const f = String(fileName || "").trim();
  if (SUPPORTED_KEYS.has(f)) return f as OfflineActivationStoreKey;
  throw new Error(`Unsupported offline activation store file: ${fileName}`);
}

export function getOfflineActivationStoreDebugInfo(fileName: string) {
  const key = normalizeStoreKey(fileName);
  return {
    storeKey: key,
    mode: resolveOfflineActivationStoreMode(),
    dataDir: getKristoDataDir(),
    ...getJsonStoreDebugInfo(key),
  };
}

export async function ensureOfflineActivationStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Offline activation database not configured");
  }
  if (usePostgres()) {
    await ensureOfflineActivationSchema();
  }
}

async function ensureOfflineActivationSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_offline_activation_store (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      console.log("KRISTO_OFFLINE_ACTIVATION_DURABLE_STORE_READY", {
        mode: "postgres",
        table: "kristo_offline_activation_store",
      });
    })();
  }
  await schemaReady;
}

function hasStoredContent<T>(value: T, fallback: T): boolean {
  if (value == null) return false;
  try {
    return JSON.stringify(value) !== JSON.stringify(fallback);
  } catch {
    return true;
  }
}

type ActivationCodesStorePayload = { batches?: unknown[] };

function normalizeActivationCodesStorePayload(raw: unknown): ActivationCodesStorePayload {
  if (!raw || typeof raw !== "object") return { batches: [] };
  const batches = (raw as ActivationCodesStorePayload).batches;
  return { batches: Array.isArray(batches) ? batches : [] };
}

function activationCodesStoreHasCodes(store: ActivationCodesStorePayload): boolean {
  return (store.batches || []).some(
    (batch) => batch && typeof batch === "object" && Array.isArray((batch as { codes?: unknown[] }).codes) &&
      ((batch as { codes?: unknown[] }).codes || []).length > 0
  );
}

async function readDocument<T>(key: OfflineActivationStoreKey, fallback: T): Promise<T> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM kristo_offline_activation_store WHERE key = ${key} LIMIT 1
  `;
  const row = (rows as { data: T }[])[0];
  const fromDbRaw = row && row.data != null ? row.data : null;
  const fromDb =
    key === OFFLINE_ACTIVATION_CODES_STORE_KEY
      ? (normalizeActivationCodesStorePayload(fromDbRaw) as T)
      : ((fromDbRaw ?? fallback) as T);

  if (
    key === OFFLINE_ACTIVATION_CODES_STORE_KEY
      ? activationCodesStoreHasCodes(fromDb as ActivationCodesStorePayload)
      : hasStoredContent(fromDb, fallback)
  ) {
    return fromDb;
  }

  // One-time migration from local runtime/bundled JSON into Postgres.
  const localRaw = await readJsonFile<T>(key, fallback);
  const local =
    key === OFFLINE_ACTIVATION_CODES_STORE_KEY
      ? (normalizeActivationCodesStorePayload(localRaw) as T)
      : localRaw;

  if (
    key === OFFLINE_ACTIVATION_CODES_STORE_KEY
      ? activationCodesStoreHasCodes(local as ActivationCodesStorePayload)
      : hasStoredContent(local, fallback)
  ) {
    await writeDocument(key, local);
    console.log("KRISTO_OFFLINE_ACTIVATION_STORE_MIGRATED", {
      storeKey: key,
      mode: "postgres",
      batchCount: (local as ActivationCodesStorePayload).batches?.length || 0,
    });
    return local;
  }

  return fallback;
}

async function writeDocument<T>(key: OfflineActivationStoreKey, data: T): Promise<void> {
  const sql = getSql();
  const payload = JSON.stringify(data ?? null);
  await sql`
    INSERT INTO kristo_offline_activation_store (key, data, updated_at)
    VALUES (${key}, ${payload}::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

export async function readOfflineActivationJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Offline activation database not configured");
  }

  if (!usePostgres()) {
    return readJsonFile<T>(key, fallback);
  }

  await ensureOfflineActivationStoreReady();
  return readDocument<T>(key, fallback);
}

export async function writeOfflineActivationJsonFile<T>(fileName: string, data: T): Promise<void> {
  const key = normalizeStoreKey(fileName);

  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Offline activation database not configured");
  }

  if (!usePostgres()) {
    await writeJsonFile<T>(key, data);
    return;
  }

  await ensureOfflineActivationStoreReady();
  await writeDocument<T>(key, data);
}

export async function updateOfflineActivationJsonFile<T>(
  fileName: string,
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  const key = normalizeStoreKey(fileName);

  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Offline activation database not configured");
  }

  if (!usePostgres()) {
    return updateJsonFile<T>(key, mutator, fallback);
  }

  await ensureOfflineActivationStoreReady();
  const current = await readDocument<T>(key, fallback);
  const next = mutator(current);
  await writeDocument<T>(key, next);
  return next;
}

export function isOfflineActivationDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("offline activation database not configured") ||
    message.includes("database_url not configured")
  );
}
