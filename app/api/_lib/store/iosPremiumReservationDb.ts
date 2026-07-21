import { neon, neonConfig } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";
import type {
  IosPremiumPurchaseSlotGroup,
  IosPremiumRotationGroup,
} from "@/lib/churchPremiumRevenueCat";

export type { IosPremiumPurchaseSlotGroup, IosPremiumRotationGroup };

neonConfig.fetchConnectionCache = true;

export type IosPremiumReservationStatus =
  | "reserved"
  | "consumed"
  | "expired"
  | "released";

/**
 * Architecture (honest):
 *
 * - subscriptionLineageIdentity = App Store originalTransactionId (ONE subscription
 *   lineage in ONE subscription group). Never treat this as Apple ID / purchaser identity.
 *   G2 and G3 bought by the same Apple ID have DIFFERENT originalTransactionIds.
 *
 * - appOwnerScope = Kristo ownerUserId (verified via session/RBAC).
 *
 * - devicePurchaseScope = best-effort non-sensitive app installation id from the device.
 *   Coordinates slot selection with deviceOwnedProductIds. NOT cryptographically tied
 *   to Apple ID. Apple does not expose Apple ID identity to the app/backend.
 *
 * - purchaseSessionId = opaque id for one prepurchase→purchase attempt chain.
 */
export type IosPremiumReservationRecord = {
  id: string;
  purchaseSessionId: string;
  churchId: string;
  ownerUserId: string;
  /** Best-effort device/app installation scope (NOT Apple ID). */
  devicePurchaseScope: string;
  productId: string;
  group: IosPremiumPurchaseSlotGroup;
  /** Snapshot of Kristo iOS product IDs observed on device at reserve time. */
  deviceOwnedProductIds: string[];
  status: IosPremiumReservationStatus;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  consumedAt?: number | null;
  releasedAt?: number | null;
  /**
   * Set only after verified purchase confirmation.
   * Maps this ONE subscription lineage → churchId. Not a purchaser/Apple ID key.
   */
  subscriptionLineageIdentity?: string | null;
  releaseReason?:
    | "expired"
    | "replaced"
    | "consumed"
    | "already_subscribed"
    | "admin"
    | null;
};

const STORE_FILE = "ios-premium-reservations.json";
const DEFAULT_TTL_MS = 20 * 60 * 1000;

type ReservationRow = {
  id: string;
  church_id: string;
  owner_user_id: string;
  purchase_session_id: string;
  data: IosPremiumReservationRecord;
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

export function resolveIosPremiumReservationStoreMode():
  | "postgres"
  | "local-json"
  | "missing-db-on-vercel" {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return usePostgres() ? "postgres" : "local-json";
}

export async function ensureIosPremiumReservationStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("iOS premium reservation database not configured");
  }
  if (usePostgres()) {
    await ensureReservationSchema();
  }
}

async function ensureReservationSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_ios_premium_reservations (
          id TEXT PRIMARY KEY,
          church_id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          purchase_session_id TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_ios_premium_res_church_idx
        ON kristo_ios_premium_reservations (LOWER(church_id))
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_ios_premium_res_session_idx
        ON kristo_ios_premium_reservations (purchase_session_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_ios_premium_res_owner_idx
        ON kristo_ios_premium_reservations (LOWER(owner_user_id))
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_ios_premium_res_status_idx
        ON kristo_ios_premium_reservations ((data->>'status'))
      `;
      // One active reserved slot per owner+device+product (prevents concurrent double-assign).
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_ios_premium_res_active_slot_uidx
        ON kristo_ios_premium_reservations (
          LOWER(owner_user_id),
          LOWER(COALESCE(data->>'devicePurchaseScope', '')),
          COALESCE(data->>'productId', '')
        )
        WHERE (data->>'status') = 'reserved'
      `;
    })();
  }
  await schemaReady;
}

/** Postgres unique-violation / local conflict when two reserved rows share a slot. */
export function isIosPremiumReservationSlotConflict(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  const code = String(err?.code || "");
  const message = String(err?.message || error || "");
  return (
    code === "23505" ||
    /kristo_ios_premium_res_active_slot_uidx/i.test(message) ||
    /ios premium reservation slot conflict/i.test(message)
  );
}

/** Best-effort coordination key: owner + device installation (NOT Apple ID). */
export function buildDevicePurchaseCoordinationKey(args: {
  ownerUserId: string;
  devicePurchaseScope: string;
}): string {
  const owner = String(args.ownerUserId || "").trim().toLowerCase();
  const device = String(args.devicePurchaseScope || "").trim().toLowerCase();
  if (!owner) throw new Error("ownerUserId required");
  if (!device) throw new Error("devicePurchaseScope required");
  return `owner:${owner}|device:${device}`;
}

function normalizeChurchId(value: string) {
  return String(value || "").trim();
}

function normalizeUserId(value: string) {
  return String(value || "").trim();
}

function rowToReservation(row: ReservationRow): IosPremiumReservationRecord {
  const data =
    row.data && typeof row.data === "object"
      ? row.data
      : ({} as IosPremiumReservationRecord);
  return {
    ...data,
    id: String(data.id || row.id || "").trim(),
    purchaseSessionId: String(
      data.purchaseSessionId || row.purchase_session_id || ""
    ).trim(),
    churchId: normalizeChurchId(data.churchId || row.church_id),
    ownerUserId: normalizeUserId(data.ownerUserId || row.owner_user_id),
    devicePurchaseScope: String(data.devicePurchaseScope || "").trim(),
    status: data.status || "reserved",
    createdAt: Number(data.createdAt || Date.parse(row.created_at) || Date.now()),
    updatedAt: Number(data.updatedAt || Date.parse(String(row.updated_at || "")) || Date.now()),
  };
}

async function readLocalReservations(): Promise<IosPremiumReservationRecord[]> {
  const raw = await readJsonFile<unknown>(STORE_FILE, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object") as IosPremiumReservationRecord[];
}

async function writeLocalReservations(records: IosPremiumReservationRecord[]) {
  await writeJsonFile(STORE_FILE, records);
}

export async function listAllIosPremiumReservations(): Promise<IosPremiumReservationRecord[]> {
  if (usePostgres()) {
    await ensureReservationSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT id, church_id, owner_user_id, purchase_session_id, data, created_at, updated_at
      FROM kristo_ios_premium_reservations
      ORDER BY updated_at DESC
    `) as ReservationRow[];
    return rows.map(rowToReservation);
  }
  return readLocalReservations();
}

export async function getIosPremiumReservationById(
  id: string
): Promise<IosPremiumReservationRecord | null> {
  const reservationId = String(id || "").trim();
  if (!reservationId) return null;

  if (usePostgres()) {
    await ensureReservationSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT id, church_id, owner_user_id, purchase_session_id, data, created_at, updated_at
      FROM kristo_ios_premium_reservations
      WHERE id = ${reservationId}
      LIMIT 1
    `) as ReservationRow[];
    return rows[0] ? rowToReservation(rows[0]) : null;
  }

  const all = await readLocalReservations();
  return all.find((r) => r.id === reservationId) || null;
}

export async function listIosPremiumReservationsByChurchId(
  churchId: string
): Promise<IosPremiumReservationRecord[]> {
  const cid = normalizeChurchId(churchId);
  if (!cid) return [];

  if (usePostgres()) {
    await ensureReservationSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT id, church_id, owner_user_id, purchase_session_id, data, created_at, updated_at
      FROM kristo_ios_premium_reservations
      WHERE LOWER(church_id) = LOWER(${cid})
      ORDER BY updated_at DESC
    `) as ReservationRow[];
    return rows.map(rowToReservation);
  }

  const target = cid.toUpperCase();
  const all = await readLocalReservations();
  return all.filter((r) => normalizeChurchId(r.churchId).toUpperCase() === target);
}

function matchesOwnerDevice(
  record: IosPremiumReservationRecord,
  ownerUserId: string,
  devicePurchaseScope: string
): boolean {
  if (normalizeUserId(record.ownerUserId).toLowerCase() !== ownerUserId.toLowerCase()) {
    return false;
  }
  return String(record.devicePurchaseScope || "").trim() === devicePurchaseScope;
}

/**
 * Reservations that must block a G2–G5 slot for this owner+device:
 * - status=reserved and not past expiresAt
 * - status=released + reason=already_subscribed and not past expiresAt
 *   (keeps Apple already-owned products blocked even if CustomerInfo lags)
 */
export async function listSlotBlockingIosPremiumReservationsForOwnerDevice(args: {
  ownerUserId: string;
  devicePurchaseScope: string;
  purchaseSessionId?: string | null;
}): Promise<IosPremiumReservationRecord[]> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const devicePurchaseScope = String(args.devicePurchaseScope || "").trim();
  if (!ownerUserId || !devicePurchaseScope) return [];
  const now = Date.now();

  const all = await listAllIosPremiumReservations();
  return all.filter((r) => {
    if (!matchesOwnerDevice(r, ownerUserId, devicePurchaseScope)) return false;
    if (Number(r.expiresAt) <= now) return false;
    if (r.status === "reserved") return true;
    if (r.status === "released" && r.releaseReason === "already_subscribed") return true;
    return false;
  });
}

export async function listActiveIosPremiumReservationsForOwnerDevice(args: {
  ownerUserId: string;
  devicePurchaseScope: string;
  purchaseSessionId?: string | null;
}): Promise<IosPremiumReservationRecord[]> {
  const blocking = await listSlotBlockingIosPremiumReservationsForOwnerDevice(args);
  return blocking.filter((r) => r.status === "reserved");
}

export async function saveIosPremiumReservation(
  record: IosPremiumReservationRecord
): Promise<IosPremiumReservationRecord> {
  const next: IosPremiumReservationRecord = {
    ...record,
    churchId: normalizeChurchId(record.churchId),
    ownerUserId: normalizeUserId(record.ownerUserId),
    purchaseSessionId: String(record.purchaseSessionId || "").trim(),
    devicePurchaseScope: String(record.devicePurchaseScope || "").trim(),
    updatedAt: Date.now(),
  };

  if (usePostgres()) {
    await ensureReservationSchema();
    const sql = getSql();
    try {
      await sql`
        INSERT INTO kristo_ios_premium_reservations (
          id, church_id, owner_user_id, purchase_session_id, data, created_at, updated_at
        ) VALUES (
          ${next.id},
          ${next.churchId},
          ${next.ownerUserId},
          ${next.purchaseSessionId},
          ${JSON.stringify(next)}::jsonb,
          TO_TIMESTAMP(${next.createdAt / 1000.0}),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          church_id = EXCLUDED.church_id,
          owner_user_id = EXCLUDED.owner_user_id,
          purchase_session_id = EXCLUDED.purchase_session_id,
          data = EXCLUDED.data,
          updated_at = NOW()
      `;
    } catch (error) {
      if (isIosPremiumReservationSlotConflict(error)) {
        throw new Error(
          `iOS premium reservation slot conflict for product ${next.productId}`
        );
      }
      throw error;
    }
    return next;
  }

  const all = await readLocalReservations();
  const now = Date.now();
  if (next.status === "reserved") {
    const conflict = all.find(
      (r) =>
        r.id !== next.id &&
        r.status === "reserved" &&
        Number(r.expiresAt) > now &&
        normalizeUserId(r.ownerUserId).toLowerCase() === next.ownerUserId.toLowerCase() &&
        String(r.devicePurchaseScope || "").trim() === next.devicePurchaseScope &&
        String(r.productId || "").trim() === String(next.productId || "").trim()
    );
    if (conflict) {
      throw new Error(
        `iOS premium reservation slot conflict for product ${next.productId}`
      );
    }
  }
  const idx = all.findIndex((r) => r.id === next.id);
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  await writeLocalReservations(all);
  return next;
}

export function createIosPremiumReservationId(): string {
  return `iosres_${randomUUID().replace(/-/g, "")}`;
}

export function createIosPremiumPurchaseSessionId(): string {
  return `ps_${randomUUID().replace(/-/g, "")}`;
}

export function defaultIosPremiumReservationTtlMs(): number {
  return DEFAULT_TTL_MS;
}

export async function expireStaleIosPremiumReservations(): Promise<IosPremiumReservationRecord[]> {
  const now = Date.now();
  const all = await listAllIosPremiumReservations();
  const updated: IosPremiumReservationRecord[] = [];
  for (const record of all) {
    if (record.status !== "reserved") continue;
    if (Number(record.expiresAt) > now) continue;
    const expired = await saveIosPremiumReservation({
      ...record,
      status: "expired",
      releaseReason: "expired",
      releasedAt: now,
    });
    updated.push(expired);
  }
  return updated;
}
