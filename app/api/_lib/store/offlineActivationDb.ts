import { AsyncLocalStorage } from "node:async_hooks";
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
/** Program extension: supervisor limits, agent invite codes, church onboardings, leader confirmations. */
export const OFFLINE_ACTIVATION_PROGRAM_STORE_KEY = "offline_activation_program.json";
/** Append-only audit history for the program (invitations, role changes, submissions, confirmations). */
export const OFFLINE_ACTIVATION_AUDIT_STORE_KEY = "offline_activation_audit.json";

type OfflineActivationStoreKey =
  | typeof OFFLINE_ACTIVATION_CODES_STORE_KEY
  | typeof OFFLINE_ACTIVATION_AGENTS_STORE_KEY
  | typeof OFFLINE_ACTIVATION_INVITATIONS_STORE_KEY
  | typeof OFFLINE_ACTIVATION_PROGRAM_STORE_KEY
  | typeof OFFLINE_ACTIVATION_AUDIT_STORE_KEY;

const SUPPORTED_KEYS = new Set<string>([
  OFFLINE_ACTIVATION_CODES_STORE_KEY,
  OFFLINE_ACTIVATION_AGENTS_STORE_KEY,
  OFFLINE_ACTIVATION_INVITATIONS_STORE_KEY,
  OFFLINE_ACTIVATION_PROGRAM_STORE_KEY,
  OFFLINE_ACTIVATION_AUDIT_STORE_KEY,
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
      // Single transaction behind an advisory lock so concurrent cold starts
      // cannot collide on CREATE/ALTER. The version column is additive (rows keep data).
      await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(hashtext('kristo_offline_activation_store_schema'))`,
        sql`
          CREATE TABLE IF NOT EXISTS kristo_offline_activation_store (
            key TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        sql`
          ALTER TABLE kristo_offline_activation_store
          ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0
        `,
      ]);
      console.log("KRISTO_OFFLINE_ACTIVATION_DURABLE_STORE_READY", {
        mode: "postgres",
        table: "kristo_offline_activation_store",
      });
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
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
  // Blind writes still bump the version so concurrent compare-and-swap updates notice them.
  await sql`
    INSERT INTO kristo_offline_activation_store (key, data, updated_at)
    VALUES (${key}, ${payload}::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET
      data = EXCLUDED.data,
      updated_at = NOW(),
      version = kristo_offline_activation_store.version + 1
  `;
}

async function readDocumentVersion(key: OfflineActivationStoreKey): Promise<number | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT version FROM kristo_offline_activation_store WHERE key = ${key} LIMIT 1
  `) as { version: string | number }[];
  return rows[0] ? Number(rows[0].version) : null;
}

const CAS_MAX_ATTEMPTS = 12;

function backoff(attempt: number) {
  const ms = Math.min(250, 8 * 2 ** attempt) * (0.5 + Math.random());
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compare-and-swap update: read data + version, apply the mutator, write only
 * if nobody else wrote in between; otherwise re-read and retry. No update is
 * lost under concurrent requests, on any number of server instances.
 */
async function updateDocumentAtomically<T>(
  key: OfflineActivationStoreKey,
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  const sql = getSql();
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt += 1) {
    // readDocument keeps the one-time local-JSON migration behaviour.
    const current = await readDocument<T>(key, fallback);
    let version = await readDocumentVersion(key);
    if (version === null) {
      await sql`
        INSERT INTO kristo_offline_activation_store (key, data, updated_at, version)
        VALUES (${key}, ${JSON.stringify(current ?? null)}::jsonb, NOW(), 0)
        ON CONFLICT (key) DO NOTHING
      `;
      continue;
    }
    // The data read above may predate this version; re-read both together.
    const rows = (await sql`
      SELECT data, version FROM kristo_offline_activation_store WHERE key = ${key} LIMIT 1
    `) as { data: T; version: string | number }[];
    const snapshot = rows[0];
    if (!snapshot) continue;
    version = Number(snapshot.version);
    const base =
      key === OFFLINE_ACTIVATION_CODES_STORE_KEY
        ? (normalizeActivationCodesStorePayload(snapshot.data) as T)
        : hasStoredContent(snapshot.data, fallback)
          ? snapshot.data
          : current;

    const next = mutator(base);
    const updated = (await sql`
      UPDATE kristo_offline_activation_store
      SET data = ${JSON.stringify(next ?? null)}::jsonb, updated_at = NOW(), version = version + 1
      WHERE key = ${key} AND version = ${version}
      RETURNING version
    `) as unknown[];
    if (updated.length === 1) return next;
    await backoff(attempt);
  }
  console.warn("KRISTO_OFFLINE_ACTIVATION_STORE_CONTENDED", { storeKey: key });
  throw new Error("Offline activation store is busy. Please try again.");
}

/* =========================
   Cross-document lock
   ========================= */

const lockContext = new AsyncLocalStorage<Set<string>>();
const localLockTails = new Map<string, Promise<void>>();

async function withLocalMutex<R>(name: string, fn: () => Promise<R>): Promise<R> {
  const previous = localLockTails.get(name) || Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => (release = resolve));
  const chained = previous.then(() => tail);
  localLockTails.set(name, chained);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (localLockTails.get(name) === chained) localLockTails.delete(name);
  }
}

/**
 * Filesystem mode (single process): serialises multi-document program writes
 * in-process. In Postgres mode every such write is one PL/pgSQL transaction
 * (see offlineActivationProgramSql.ts), so this is only a local queue there.
 * Re-entrant within one async call chain.
 */
export async function withOfflineActivationLock<R>(name: string, fn: () => Promise<R>): Promise<R> {
  const held = lockContext.getStore();
  if (held?.has(name)) return fn();
  const nextHeld = new Set(held || []);
  nextHeld.add(name);
  return withLocalMutex(name, () => lockContext.run(nextHeld, fn));
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
  return updateDocumentAtomically<T>(key, mutator, fallback);
}

export function isOfflineActivationDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("offline activation database not configured") ||
    message.includes("database_url not configured")
  );
}
