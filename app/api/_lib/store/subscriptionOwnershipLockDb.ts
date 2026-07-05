import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type SubscriptionOwnershipLockStatus = "active" | "expired" | "released";

export type SubscriptionOwnershipLockRecord = {
  id: string;
  ownerUserId: string;
  lockedChurchId: string;
  lockedChurchName: string;
  lockedChurchDeleted?: boolean;
  revenueCatAppUserId: string;
  revenueCatOriginalAppUserId: string | null;
  productId: string | null;
  store: "app_store" | "play_store" | null;
  platform: "ios" | "android" | null;
  subscriptionPlan: "monthly" | "yearly" | null;
  expiresAt: number | null;
  lockedAt: number;
  updatedAt: number;
  status: SubscriptionOwnershipLockStatus;
  releasedAt?: number | null;
  releaseReason?: "expired" | "cancelled" | "admin" | "replaced" | null;
};

const STORE_FILE = "subscription-ownership-locks.json";

type LockRow = {
  id: string;
  owner_user_id: string;
  data: SubscriptionOwnershipLockRecord;
  created_at: string;
  updated_at: string | null;
};

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

export function resolveSubscriptionOwnershipLockStoreMode():
  | "postgres"
  | "local-json"
  | "missing-db-on-vercel" {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return usePostgres() ? "postgres" : "local-json";
}

export async function ensureSubscriptionOwnershipLockStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Subscription ownership lock database not configured");
  }
  if (usePostgres()) {
    await ensureLockSchema();
  }
}

async function ensureLockSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_subscription_ownership_locks (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_sub_lock_owner_idx
        ON kristo_subscription_ownership_locks (LOWER(owner_user_id))
      `;
    })();
  }
  await schemaReady;
}

function normalizeUserId(value: string) {
  return String(value || "").trim();
}

function normalizeChurchId(value: string) {
  return String(value || "").trim();
}

function rowToLock(row: LockRow): SubscriptionOwnershipLockRecord {
  const data =
    row.data && typeof row.data === "object"
      ? row.data
      : ({} as SubscriptionOwnershipLockRecord);
  return {
    ...data,
    id: String(data.id || row.id || "").trim(),
    ownerUserId: normalizeUserId(data.ownerUserId || row.owner_user_id),
    lockedChurchId: normalizeChurchId(data.lockedChurchId),
    lockedChurchName: String(data.lockedChurchName || "").trim(),
    status: data.status || "active",
    lockedAt: Number(data.lockedAt || Date.parse(row.created_at) || Date.now()),
    updatedAt: Number(data.updatedAt || Date.parse(String(row.updated_at || "")) || Date.now()),
  };
}

async function readLocalLocks(): Promise<SubscriptionOwnershipLockRecord[]> {
  const raw = await readJsonFile<unknown>(STORE_FILE, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object") as SubscriptionOwnershipLockRecord[];
}

async function writeLocalLocks(locks: SubscriptionOwnershipLockRecord[]) {
  await writeJsonFile(STORE_FILE, locks);
}

export async function listSubscriptionOwnershipLocksByOwnerUserId(
  ownerUserId: string
): Promise<SubscriptionOwnershipLockRecord[]> {
  const uid = normalizeUserId(ownerUserId);
  if (!uid) return [];

  if (usePostgres()) {
    await ensureLockSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT id, owner_user_id, data, created_at, updated_at
      FROM kristo_subscription_ownership_locks
      WHERE LOWER(owner_user_id) = LOWER(${uid})
      ORDER BY updated_at DESC
    `) as LockRow[];
    return rows.map(rowToLock);
  }

  const target = uid.toUpperCase();
  const locks = await readLocalLocks();
  return locks.filter((lock) => normalizeUserId(lock.ownerUserId).toUpperCase() === target);
}

export async function saveSubscriptionOwnershipLock(
  record: SubscriptionOwnershipLockRecord
): Promise<SubscriptionOwnershipLockRecord> {
  const next: SubscriptionOwnershipLockRecord = {
    ...record,
    ownerUserId: normalizeUserId(record.ownerUserId),
    lockedChurchId: normalizeChurchId(record.lockedChurchId),
    updatedAt: Date.now(),
  };

  if (usePostgres()) {
    await ensureLockSchema();
    const sql = getSql();
    await sql`
      INSERT INTO kristo_subscription_ownership_locks (id, owner_user_id, data, created_at, updated_at)
      VALUES (
        ${next.id},
        ${next.ownerUserId},
        ${JSON.stringify(next)}::jsonb,
        to_timestamp(${next.lockedAt / 1000.0}),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        owner_user_id = EXCLUDED.owner_user_id,
        data = EXCLUDED.data,
        updated_at = NOW()
    `;
    return next;
  }

  const locks = await readLocalLocks();
  const idx = locks.findIndex((lock) => lock.id === next.id);
  if (idx >= 0) {
    locks[idx] = next;
  } else {
    locks.push(next);
  }
  await writeLocalLocks(locks);
  return next;
}
