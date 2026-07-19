import { neon, neonConfig } from "@neondatabase/serverless";
import {
  getDatabaseUrl,
  hasDurableStore,
  isVercelRuntime,
} from "@/app/api/_lib/store/authDb";
import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import {
  MESSAGE_LOCK_PIN_VERSION,
  type MessageLockPinLength,
  type MessageLockRecord,
  type MessageLockTimeoutSeconds,
} from "@/app/api/_lib/messageLock";

neonConfig.fetchConnectionCache = true;

const LOCAL_FILE = "message-lock.json";

export class MessageLockStoreUnavailableError extends Error {
  readonly code = "MESSAGE_LOCK_STORE_UNAVAILABLE";
  constructor(message = "Message Lock is temporarily unavailable.") {
    super(message);
    this.name = "MessageLockStoreUnavailableError";
  }
}

type LocalStore = Record<string, MessageLockRecord>;

type DbRow = {
  user_id: string;
  pin_version: number;
  pin_length: number;
  pin_hash: string;
  enabled: boolean;
  timeout_seconds: number;
  failed_attempts: number;
  cooldown_until: string | null;
  credential_updated_at: string | null;
  updated_at: string | null;
};

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new MessageLockStoreUnavailableError();
    sqlClient = neon(url);
  }
  return sqlClient;
}

/** Production / serverless: Neon only. Never write PIN credentials to temp FS. */
export function isProductionLikeMessageLockRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NODE_ENV === "production"
  );
}

/**
 * Local JSON fallback is allowed only in explicit non-production development/test.
 * Never activates when Vercel/production-like, even if DATABASE_URL is missing.
 */
export function canUseMessageLockLocalFallback(): boolean {
  if (isProductionLikeMessageLockRuntime()) return false;
  if (process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL === "0") return false;
  if (process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL === "1") return true;
  if (process.env.NODE_ENV === "test") return true;
  // Local `next dev` without DATABASE_URL
  return !hasDurableStore() && !isVercelRuntime();
}

function usePostgres(): boolean {
  return hasDurableStore();
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_message_lock (
          user_id TEXT PRIMARY KEY,
          pin_version INT NOT NULL DEFAULT 1,
          pin_length INT NOT NULL,
          pin_hash TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          timeout_seconds INT NOT NULL DEFAULT 0,
          failed_attempts INT NOT NULL DEFAULT 0,
          cooldown_until TIMESTAMPTZ NULL,
          credential_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT kristo_message_lock_pin_length_chk
            CHECK (pin_length IN (4, 6, 8)),
          CONSTRAINT kristo_message_lock_timeout_chk
            CHECK (timeout_seconds IN (0, 60, 300, 900))
        )
      `;
    })();
  }
  await schemaReady;
}

async function ensureReady() {
  if (usePostgres()) {
    try {
      await ensureSchema();
      return;
    } catch (e) {
      throw new MessageLockStoreUnavailableError(
        e instanceof Error ? e.message : "Message Lock database unavailable."
      );
    }
  }

  if (canUseMessageLockLocalFallback()) {
    return;
  }

  throw new MessageLockStoreUnavailableError();
}

function normUserId(userId: string) {
  return String(userId || "").trim();
}

function tsToMs(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function rowToRecord(row: DbRow): MessageLockRecord {
  return {
    userId: row.user_id,
    pinVersion: Number(row.pin_version || MESSAGE_LOCK_PIN_VERSION),
    pinLength: Number(row.pin_length) as MessageLockPinLength,
    pinHash: String(row.pin_hash || ""),
    enabled: Boolean(row.enabled),
    timeoutSeconds: Number(row.timeout_seconds || 0) as MessageLockTimeoutSeconds,
    failedAttempts: Math.max(0, Number(row.failed_attempts || 0)),
    cooldownUntil: row.cooldown_until ? tsToMs(row.cooldown_until) : null,
    credentialUpdatedAt: tsToMs(row.credential_updated_at) || Date.now(),
    updatedAt: tsToMs(row.updated_at) || Date.now(),
  };
}

export async function getMessageLockRecord(
  userId: string
): Promise<MessageLockRecord | null> {
  await ensureReady();
  const uid = normUserId(userId);
  if (!uid) return null;

  if (!usePostgres()) {
    const store = await readJsonFile<LocalStore>(LOCAL_FILE, {});
    return store[uid] || null;
  }

  try {
    const sql = getSql();
    const rows = (await sql`
      SELECT
        user_id,
        pin_version,
        pin_length,
        pin_hash,
        enabled,
        timeout_seconds,
        failed_attempts,
        cooldown_until,
        credential_updated_at,
        updated_at
      FROM kristo_message_lock
      WHERE user_id = ${uid}
      LIMIT 1
    `) as DbRow[];
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  } catch {
    throw new MessageLockStoreUnavailableError();
  }
}

export async function upsertMessageLockCredential(args: {
  userId: string;
  pinHash: string;
  pinLength: MessageLockPinLength;
  pinVersion?: number;
  timeoutSeconds: MessageLockTimeoutSeconds;
  enabled: boolean;
}): Promise<MessageLockRecord> {
  await ensureReady();
  const uid = normUserId(args.userId);
  if (!uid) throw new Error("userId is required");

  const now = Date.now();
  const record: MessageLockRecord = {
    userId: uid,
    pinVersion: args.pinVersion ?? MESSAGE_LOCK_PIN_VERSION,
    pinLength: args.pinLength,
    pinHash: args.pinHash,
    enabled: Boolean(args.enabled),
    timeoutSeconds: args.timeoutSeconds,
    failedAttempts: 0,
    cooldownUntil: null,
    credentialUpdatedAt: now,
    updatedAt: now,
  };

  if (!usePostgres()) {
    await updateJsonFile<LocalStore>(
      LOCAL_FILE,
      (store) => ({ ...store, [uid]: record }),
      {}
    );
    return record;
  }

  try {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_message_lock (
        user_id,
        pin_version,
        pin_length,
        pin_hash,
        enabled,
        timeout_seconds,
        failed_attempts,
        cooldown_until,
        credential_updated_at,
        updated_at
      )
      VALUES (
        ${uid},
        ${record.pinVersion},
        ${record.pinLength},
        ${record.pinHash},
        ${record.enabled},
        ${record.timeoutSeconds},
        0,
        NULL,
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        pin_version = EXCLUDED.pin_version,
        pin_length = EXCLUDED.pin_length,
        pin_hash = EXCLUDED.pin_hash,
        enabled = EXCLUDED.enabled,
        timeout_seconds = EXCLUDED.timeout_seconds,
        failed_attempts = 0,
        cooldown_until = NULL,
        credential_updated_at = NOW(),
        updated_at = NOW()
    `;
    const next = await getMessageLockRecord(uid);
    if (!next) throw new MessageLockStoreUnavailableError();
    return next;
  } catch (e) {
    if (e instanceof MessageLockStoreUnavailableError) throw e;
    throw new MessageLockStoreUnavailableError();
  }
}

export async function updateMessageLockTimeout(args: {
  userId: string;
  timeoutSeconds: MessageLockTimeoutSeconds;
}): Promise<MessageLockRecord> {
  await ensureReady();
  const uid = normUserId(args.userId);
  if (!uid) throw new Error("userId is required");

  const current = await getMessageLockRecord(uid);
  if (!current || !current.enabled) {
    throw new Error("Message Lock is not enabled.");
  }

  const now = Date.now();
  const next: MessageLockRecord = {
    ...current,
    timeoutSeconds: args.timeoutSeconds,
    failedAttempts: 0,
    cooldownUntil: null,
    updatedAt: now,
  };

  if (!usePostgres()) {
    await updateJsonFile<LocalStore>(
      LOCAL_FILE,
      (store) => ({ ...store, [uid]: next }),
      {}
    );
    return next;
  }

  try {
    const sql = getSql();
    await sql`
      UPDATE kristo_message_lock
      SET
        timeout_seconds = ${args.timeoutSeconds},
        failed_attempts = 0,
        cooldown_until = NULL,
        updated_at = NOW()
      WHERE user_id = ${uid}
    `;
    const row = await getMessageLockRecord(uid);
    if (!row) throw new MessageLockStoreUnavailableError();
    return row;
  } catch (e) {
    if (e instanceof MessageLockStoreUnavailableError) throw e;
    throw new MessageLockStoreUnavailableError();
  }
}

export async function recordMessageLockFailure(args: {
  userId: string;
  failedAttempts: number;
  cooldownUntil: number | null;
}): Promise<MessageLockRecord | null> {
  await ensureReady();
  const uid = normUserId(args.userId);
  if (!uid) return null;

  const current = await getMessageLockRecord(uid);
  if (!current) return null;

  const next: MessageLockRecord = {
    ...current,
    failedAttempts: Math.max(0, args.failedAttempts),
    cooldownUntil: args.cooldownUntil,
    updatedAt: Date.now(),
  };

  if (!usePostgres()) {
    await updateJsonFile<LocalStore>(
      LOCAL_FILE,
      (store) => ({ ...store, [uid]: next }),
      {}
    );
    return next;
  }

  try {
    const sql = getSql();
    const cooldownIso = args.cooldownUntil
      ? new Date(args.cooldownUntil).toISOString()
      : null;
    await sql`
      UPDATE kristo_message_lock
      SET
        failed_attempts = ${next.failedAttempts},
        cooldown_until = ${cooldownIso},
        updated_at = NOW()
      WHERE user_id = ${uid}
    `;
    return (await getMessageLockRecord(uid)) || next;
  } catch {
    throw new MessageLockStoreUnavailableError();
  }
}

export async function resetMessageLockFailures(
  userId: string
): Promise<MessageLockRecord | null> {
  await ensureReady();
  const uid = normUserId(userId);
  if (!uid) return null;

  const current = await getMessageLockRecord(uid);
  if (!current) return null;

  const next: MessageLockRecord = {
    ...current,
    failedAttempts: 0,
    cooldownUntil: null,
    updatedAt: Date.now(),
  };

  if (!usePostgres()) {
    await updateJsonFile<LocalStore>(
      LOCAL_FILE,
      (store) => ({ ...store, [uid]: next }),
      {}
    );
    return next;
  }

  try {
    const sql = getSql();
    await sql`
      UPDATE kristo_message_lock
      SET
        failed_attempts = 0,
        cooldown_until = NULL,
        updated_at = NOW()
      WHERE user_id = ${uid}
    `;
    return (await getMessageLockRecord(uid)) || next;
  } catch {
    throw new MessageLockStoreUnavailableError();
  }
}

/** Disable clears the credential entirely (re-enable requires full setup). */
export async function clearMessageLockCredential(
  userId: string
): Promise<void> {
  await ensureReady();
  const uid = normUserId(userId);
  if (!uid) return;

  if (!usePostgres()) {
    await updateJsonFile<LocalStore>(
      LOCAL_FILE,
      (store) => {
        const next = { ...store };
        delete next[uid];
        return next;
      },
      {}
    );
    return;
  }

  try {
    const sql = getSql();
    await sql`
      DELETE FROM kristo_message_lock
      WHERE user_id = ${uid}
    `;
  } catch {
    throw new MessageLockStoreUnavailableError();
  }
}
