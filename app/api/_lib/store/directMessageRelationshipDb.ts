import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, updateJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";
import {
  DM_REQUEST_MESSAGE_LIMIT,
  DM_REQUEST_MESSAGE_LIMIT_REACHED,
  dmRequestLimitReachedError,
} from "@/app/api/_lib/directMessageRequestLogic";

neonConfig.fetchConnectionCache = true;

/**
 * Durable per-pair DM relationship + request quota.
 * Canonical uniqueness: room_id = dm:{sortedA}::{sortedB} (PRIMARY KEY).
 * Production: Neon/Postgres. Local without DATABASE_URL: JSON under data/.
 * Vercel without DATABASE_URL: hard fail (no /tmp fallback).
 */
export const DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY =
  "direct-message-relationships.json";

export type DmRequestStatus = "none" | "pending" | "accepted" | "declined";

export type DirectMessageRelationshipRecord = {
  roomId: string;
  storageChurchId: string;
  participantA: string;
  participantB: string;
  requestStatus: DmRequestStatus;
  requestInitiatorUserId: string;
  sameChurchAtCreation: boolean;
  initiatorOutboundCount: number;
  acceptedAt: number | null;
  declinedAt: number | null;
  createdAt: number;
  updatedAt: number;
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

function norm(value: string) {
  return String(value || "").trim();
}

function orderedParticipants(
  userIdA: string,
  userIdB: string
): [string, string] | null {
  const a = norm(userIdA);
  const b = norm(userIdB);
  if (!a || !b || a === b) return null;
  return a < b ? [a, b] : [b, a];
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_direct_message_relationships (
          room_id TEXT PRIMARY KEY,
          storage_church_id TEXT NOT NULL,
          participant_a TEXT NOT NULL,
          participant_b TEXT NOT NULL,
          request_status TEXT NOT NULL DEFAULT 'none',
          request_initiator_user_id TEXT NOT NULL DEFAULT '',
          same_church_at_creation BOOLEAN NOT NULL DEFAULT FALSE,
          initiator_outbound_count INTEGER NOT NULL DEFAULT 0,
          accepted_at TIMESTAMPTZ NULL,
          declined_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT kristo_dm_rel_participants_ordered
            CHECK (participant_a < participant_b),
          CONSTRAINT kristo_dm_rel_request_status_check
            CHECK (request_status IN ('none', 'pending', 'accepted', 'declined')),
          CONSTRAINT kristo_dm_rel_outbound_nonneg
            CHECK (initiator_outbound_count >= 0)
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_dm_rel_participants_uidx
        ON kristo_direct_message_relationships (participant_a, participant_b)
      `;
    })();
  }
  await schemaReady;
}

async function ensureReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error(
      "Direct message relationship database not configured (DATABASE_URL required on Vercel)"
    );
  }
  if (usePostgres()) {
    await ensureSchema();
  }
}

function rowToRecord(row: any): DirectMessageRelationshipRecord {
  return {
    roomId: norm(row.room_id || row.roomId),
    storageChurchId: norm(row.storage_church_id || row.storageChurchId),
    participantA: norm(row.participant_a || row.participantA),
    participantB: norm(row.participant_b || row.participantB),
    requestStatus: (norm(row.request_status || row.requestStatus || "none") ||
      "none") as DmRequestStatus,
    requestInitiatorUserId: norm(
      row.request_initiator_user_id || row.requestInitiatorUserId
    ),
    sameChurchAtCreation: Boolean(
      row.same_church_at_creation ?? row.sameChurchAtCreation
    ),
    initiatorOutboundCount: Math.max(
      0,
      Number(row.initiator_outbound_count ?? row.initiatorOutboundCount ?? 0) || 0
    ),
    acceptedAt: row.accepted_at
      ? Date.parse(String(row.accepted_at)) || Number(row.acceptedAt) || null
      : row.acceptedAt != null
        ? Number(row.acceptedAt) || null
        : null,
    declinedAt: row.declined_at
      ? Date.parse(String(row.declined_at)) || Number(row.declinedAt) || null
      : row.declinedAt != null
        ? Number(row.declinedAt) || null
        : null,
    createdAt: row.created_at
      ? Date.parse(String(row.created_at)) || Number(row.createdAt) || Date.now()
      : Number(row.createdAt || Date.now()),
    updatedAt: row.updated_at
      ? Date.parse(String(row.updated_at)) || Number(row.updatedAt) || Date.now()
      : Number(row.updatedAt || Date.now()),
  };
}

async function readLocalStore(): Promise<
  Record<string, DirectMessageRelationshipRecord>
> {
  return readJsonFile<Record<string, DirectMessageRelationshipRecord>>(
    DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY,
    {}
  );
}

async function writeLocalStore(
  data: Record<string, DirectMessageRelationshipRecord>
) {
  await writeJsonFile(DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY, data);
}

export async function getDirectMessageRelationshipByRoomId(
  roomId: string
): Promise<DirectMessageRelationshipRecord | null> {
  await ensureReady();
  const rid = norm(roomId);
  if (!rid) return null;

  if (!usePostgres()) {
    const store = await readLocalStore();
    return store[rid] || null;
  }

  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM kristo_direct_message_relationships
    WHERE room_id = ${rid}
    LIMIT 1
  `;
  const row = (rows as any[])[0];
  return row ? rowToRecord(row) : null;
}

export async function upsertDirectMessageRelationship(args: {
  roomId: string;
  storageChurchId: string;
  participantUserIds: [string, string];
  requestStatus?: DmRequestStatus;
  requestInitiatorUserId?: string;
  sameChurchAtCreation?: boolean;
}): Promise<DirectMessageRelationshipRecord> {
  await ensureReady();
  const roomId = norm(args.roomId);
  const storageChurchId = norm(args.storageChurchId);
  const ordered = orderedParticipants(
    args.participantUserIds[0],
    args.participantUserIds[1]
  );
  if (!roomId || !storageChurchId || !ordered) {
    throw new Error("Invalid direct message relationship identity.");
  }

  const now = Date.now();
  const requestStatus = (args.requestStatus || "none") as DmRequestStatus;
  const requestInitiatorUserId = norm(args.requestInitiatorUserId || "");
  const sameChurchAtCreation = Boolean(args.sameChurchAtCreation);

  if (!usePostgres()) {
    const next = await updateJsonFile<
      Record<string, DirectMessageRelationshipRecord>
    >(
      DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY,
      (current) => {
        const store =
          current && typeof current === "object" ? { ...current } : {};
        const existing = store[roomId];
        if (existing) {
          // Never let a second churchId create a parallel relationship.
          store[roomId] = {
            ...existing,
            storageChurchId: existing.storageChurchId || storageChurchId,
            updatedAt: now,
          };
          return store;
        }
        store[roomId] = {
          roomId,
          storageChurchId,
          participantA: ordered[0],
          participantB: ordered[1],
          requestStatus,
          requestInitiatorUserId,
          sameChurchAtCreation,
          initiatorOutboundCount: 0,
          acceptedAt: null,
          declinedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        return store;
      },
      {}
    );
    return next[roomId];
  }

  const sql = getSql();
  const rows = await sql`
    INSERT INTO kristo_direct_message_relationships (
      room_id,
      storage_church_id,
      participant_a,
      participant_b,
      request_status,
      request_initiator_user_id,
      same_church_at_creation,
      initiator_outbound_count,
      accepted_at,
      declined_at,
      created_at,
      updated_at
    )
    VALUES (
      ${roomId},
      ${storageChurchId},
      ${ordered[0]},
      ${ordered[1]},
      ${requestStatus},
      ${requestInitiatorUserId},
      ${sameChurchAtCreation},
      0,
      NULL,
      NULL,
      ${new Date(now).toISOString()}::timestamptz,
      ${new Date(now).toISOString()}::timestamptz
    )
    ON CONFLICT (room_id) DO UPDATE
    SET
      updated_at = NOW()
    RETURNING *
  `;
  return rowToRecord((rows as any[])[0]);
}

/**
 * Transition a non-request row into a pending request for the authenticated sender.
 * Never overwrites an existing initiator / accepted / declined relationship.
 */
export async function ensurePendingRequestForInitiator(args: {
  roomId: string;
  senderUserId: string;
  storageChurchId: string;
  participantUserIds: [string, string];
}): Promise<DirectMessageRelationshipRecord | null> {
  await ensureReady();
  const roomId = norm(args.roomId);
  const senderUserId = norm(args.senderUserId);
  const storageChurchId = norm(args.storageChurchId);
  const ordered = orderedParticipants(
    args.participantUserIds[0],
    args.participantUserIds[1]
  );
  if (!roomId || !senderUserId || !storageChurchId || !ordered) return null;

  if (!usePostgres()) {
    let record: DirectMessageRelationshipRecord | null = null;
    await updateJsonFile<Record<string, DirectMessageRelationshipRecord>>(
      DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY,
      (current) => {
        const store =
          current && typeof current === "object" ? { ...current } : {};
        const existing = store[roomId];
        const now = Date.now();
        if (!existing) {
          record = {
            roomId,
            storageChurchId,
            participantA: ordered[0],
            participantB: ordered[1],
            requestStatus: "pending",
            requestInitiatorUserId: senderUserId,
            sameChurchAtCreation: false,
            initiatorOutboundCount: 0,
            acceptedAt: null,
            declinedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          store[roomId] = record;
          return store;
        }
        if (
          existing.requestStatus === "accepted" ||
          existing.requestStatus === "declined" ||
          (existing.requestStatus === "pending" &&
            norm(existing.requestInitiatorUserId) &&
            norm(existing.requestInitiatorUserId) !== senderUserId)
        ) {
          record = existing;
          return store;
        }
        if (
          existing.requestStatus === "none" ||
          !norm(existing.requestInitiatorUserId)
        ) {
          record = {
            ...existing,
            requestStatus: "pending",
            requestInitiatorUserId: senderUserId,
            updatedAt: now,
          };
          store[roomId] = record;
          return store;
        }
        record = existing;
        return store;
      },
      {}
    );
    return record;
  }

  const sql = getSql();
  await sql`
    INSERT INTO kristo_direct_message_relationships (
      room_id,
      storage_church_id,
      participant_a,
      participant_b,
      request_status,
      request_initiator_user_id,
      same_church_at_creation,
      initiator_outbound_count,
      accepted_at,
      declined_at,
      created_at,
      updated_at
    )
    VALUES (
      ${roomId},
      ${storageChurchId},
      ${ordered[0]},
      ${ordered[1]},
      'pending',
      ${senderUserId},
      FALSE,
      0,
      NULL,
      NULL,
      NOW(),
      NOW()
    )
    ON CONFLICT (room_id) DO UPDATE
    SET
      request_status = CASE
        WHEN kristo_direct_message_relationships.request_status = 'none'
          OR COALESCE(kristo_direct_message_relationships.request_initiator_user_id, '') = ''
        THEN 'pending'
        ELSE kristo_direct_message_relationships.request_status
      END,
      request_initiator_user_id = CASE
        WHEN kristo_direct_message_relationships.request_status = 'none'
          OR COALESCE(kristo_direct_message_relationships.request_initiator_user_id, '') = ''
        THEN ${senderUserId}
        ELSE kristo_direct_message_relationships.request_initiator_user_id
      END,
      updated_at = NOW()
  `;
  return getDirectMessageRelationshipByRoomId(roomId);
}

export async function updateDirectMessageRelationshipStatus(args: {
  roomId: string;
  actorUserId: string;
  action: "accept" | "decline";
}): Promise<
  | { ok: true; record: DirectMessageRelationshipRecord }
  | { ok: false; code: "DM_REQUEST_RECEIVER_ONLY" | "DM_THREAD_NOT_FOUND" | "DM_REQUEST_NOT_PENDING" }
> {
  await ensureReady();
  const roomId = norm(args.roomId);
  const actorUserId = norm(args.actorUserId);
  if (!roomId || !actorUserId) {
    return { ok: false, code: "DM_THREAD_NOT_FOUND" };
  }

  const now = Date.now();
  const nextStatus = args.action === "accept" ? "accepted" : "declined";

  if (!usePostgres()) {
    let result:
      | { ok: true; record: DirectMessageRelationshipRecord }
      | {
          ok: false;
          code:
            | "DM_REQUEST_RECEIVER_ONLY"
            | "DM_THREAD_NOT_FOUND"
            | "DM_REQUEST_NOT_PENDING";
        } = { ok: false, code: "DM_THREAD_NOT_FOUND" };

    await updateJsonFile<Record<string, DirectMessageRelationshipRecord>>(
      DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY,
      (current) => {
        const store =
          current && typeof current === "object" ? { ...current } : {};
        const existing = store[roomId];
        if (!existing) {
          result = { ok: false, code: "DM_THREAD_NOT_FOUND" };
          return store;
        }
        const initiator = norm(existing.requestInitiatorUserId);
        if (!initiator || initiator === actorUserId) {
          result = { ok: false, code: "DM_REQUEST_RECEIVER_ONLY" };
          return store;
        }
        if (existing.requestStatus !== "pending") {
          result = { ok: false, code: "DM_REQUEST_NOT_PENDING" };
          return store;
        }
        const record: DirectMessageRelationshipRecord = {
          ...existing,
          requestStatus: nextStatus,
          acceptedAt: args.action === "accept" ? now : existing.acceptedAt,
          declinedAt: args.action === "decline" ? now : existing.declinedAt,
          updatedAt: now,
        };
        store[roomId] = record;
        result = { ok: true, record };
        return store;
      },
      {}
    );
    return result;
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE kristo_direct_message_relationships
    SET
      request_status = ${nextStatus},
      accepted_at = CASE
        WHEN ${nextStatus} = 'accepted' THEN ${new Date(now).toISOString()}::timestamptz
        ELSE accepted_at
      END,
      declined_at = CASE
        WHEN ${nextStatus} = 'declined' THEN ${new Date(now).toISOString()}::timestamptz
        ELSE declined_at
      END,
      updated_at = NOW()
    WHERE room_id = ${roomId}
      AND request_status = 'pending'
      AND request_initiator_user_id <> ''
      AND request_initiator_user_id <> ${actorUserId}
    RETURNING *
  `;
  const row = (rows as any[])[0];
  if (row) return { ok: true, record: rowToRecord(row) };

  const existing = await getDirectMessageRelationshipByRoomId(roomId);
  if (!existing) return { ok: false, code: "DM_THREAD_NOT_FOUND" };
  const initiator = norm(existing.requestInitiatorUserId);
  if (!initiator || initiator === actorUserId) {
    return { ok: false, code: "DM_REQUEST_RECEIVER_ONLY" };
  }
  return { ok: false, code: "DM_REQUEST_NOT_PENDING" };
}

export type ClaimOutboundSlotResult =
  | {
      ok: true;
      count: number;
      churchId: string;
      remainingMessages: number;
    }
  | {
      ok: false;
      code: string;
      error: string;
      churchId?: string;
      count: number;
      limit: number;
      remainingMessages: number;
    };

/**
 * Database-level atomic claim of one outbound request slot.
 * Postgres: single conditional UPDATE (safe across Vercel instances).
 */
export async function claimInitiatorOutboundSlotAtomic(args: {
  roomId: string;
  senderUserId: string;
  limit?: number;
}): Promise<ClaimOutboundSlotResult> {
  await ensureReady();
  const roomId = norm(args.roomId);
  const senderUserId = norm(args.senderUserId);
  const limit = Math.max(
    1,
    Number(args.limit || DM_REQUEST_MESSAGE_LIMIT) || DM_REQUEST_MESSAGE_LIMIT
  );

  if (!roomId || !senderUserId) {
    return {
      ok: false,
      code: "DM_THREAD_NOT_FOUND",
      error: "Conversation not found.",
      count: 0,
      limit,
      remainingMessages: 0,
    };
  }

  if (!usePostgres()) {
    let result!: ClaimOutboundSlotResult;
    await updateJsonFile<Record<string, DirectMessageRelationshipRecord>>(
      DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY,
      (current) => {
        const store =
          current && typeof current === "object" ? { ...current } : {};
        const existing = store[roomId];
        if (!existing) {
          result = {
            ok: false,
            code: "DM_THREAD_NOT_FOUND",
            error: "Conversation not found.",
            count: 0,
            limit,
            remainingMessages: 0,
          };
          return store;
        }
        if (existing.requestStatus !== "pending") {
          result = {
            ok: false,
            code: "DM_REQUEST_NOT_PENDING",
            error: "This conversation is not an open message request.",
            churchId: existing.storageChurchId,
            count: existing.initiatorOutboundCount,
            limit,
            remainingMessages: 0,
          };
          return store;
        }
        if (norm(existing.requestInitiatorUserId) !== senderUserId) {
          result = {
            ok: false,
            code: "DM_REQUEST_NOT_INITIATOR",
            error: "Only the request initiator consumes the request quota.",
            churchId: existing.storageChurchId,
            count: existing.initiatorOutboundCount,
            limit,
            remainingMessages: Math.max(
              0,
              limit - existing.initiatorOutboundCount
            ),
          };
          return store;
        }
        if (existing.initiatorOutboundCount >= limit) {
          result = {
            ok: false,
            code: DM_REQUEST_MESSAGE_LIMIT_REACHED,
            error: dmRequestLimitReachedError(limit),
            churchId: existing.storageChurchId,
            count: existing.initiatorOutboundCount,
            limit,
            remainingMessages: 0,
          };
          return store;
        }
        const count = existing.initiatorOutboundCount + 1;
        store[roomId] = {
          ...existing,
          initiatorOutboundCount: count,
          updatedAt: Date.now(),
        };
        result = {
          ok: true,
          count,
          churchId: existing.storageChurchId,
          remainingMessages: Math.max(0, limit - count),
        };
        return store;
      },
      {}
    );
    return result;
  }

  const sql = getSql();
  // Exact atomic SQL for the seventh-message slot (and all prior slots):
  // increments only when status=pending, sender=initiator, and count < limit.
  const rows = await sql`
    UPDATE kristo_direct_message_relationships
    SET
      initiator_outbound_count = initiator_outbound_count + 1,
      updated_at = NOW()
    WHERE room_id = ${roomId}
      AND request_status = 'pending'
      AND request_initiator_user_id = ${senderUserId}
      AND initiator_outbound_count < ${limit}
    RETURNING
      initiator_outbound_count,
      storage_church_id,
      request_status
  `;
  const row = (rows as any[])[0];
  if (row) {
    const count = Math.max(0, Number(row.initiator_outbound_count || 0) || 0);
    return {
      ok: true,
      count,
      churchId: norm(row.storage_church_id),
      remainingMessages: Math.max(0, limit - count),
    };
  }

  const existing = await getDirectMessageRelationshipByRoomId(roomId);
  if (!existing) {
    return {
      ok: false,
      code: "DM_THREAD_NOT_FOUND",
      error: "Conversation not found.",
      count: 0,
      limit,
      remainingMessages: 0,
    };
  }
  if (existing.requestStatus !== "pending") {
    return {
      ok: false,
      code: "DM_REQUEST_NOT_PENDING",
      error: "This conversation is not an open message request.",
      churchId: existing.storageChurchId,
      count: existing.initiatorOutboundCount,
      limit,
      remainingMessages: 0,
    };
  }
  if (norm(existing.requestInitiatorUserId) !== senderUserId) {
    return {
      ok: false,
      code: "DM_REQUEST_NOT_INITIATOR",
      error: "Only the request initiator consumes the request quota.",
      churchId: existing.storageChurchId,
      count: existing.initiatorOutboundCount,
      limit,
      remainingMessages: Math.max(0, limit - existing.initiatorOutboundCount),
    };
  }
  return {
    ok: false,
    code: DM_REQUEST_MESSAGE_LIMIT_REACHED,
    error: dmRequestLimitReachedError(limit),
    churchId: existing.storageChurchId,
    count: existing.initiatorOutboundCount,
    limit,
    remainingMessages: 0,
  };
}

/**
 * Safe repair for empty/reversed pending request initiator.
 * Only when: pending, outbound count 0, never accepted/declined,
 * and authenticated profile opener is a participant.
 * Never trusts client-provided initiator ids outside authenticated opener.
 */
export async function repairReversedEmptyPendingInitiator(args: {
  roomId: string;
  authenticatedOpenerUserId: string;
}): Promise<{
  repaired: boolean;
  reason: string;
  record: DirectMessageRelationshipRecord | null;
  previousInitiatorUserId: string;
}> {
  await ensureReady();
  const roomId = norm(args.roomId);
  const openerUserId = norm(args.authenticatedOpenerUserId);
  if (!roomId || !openerUserId) {
    return {
      repaired: false,
      reason: "invalid_args",
      record: null,
      previousInitiatorUserId: "",
    };
  }

  const existing = await getDirectMessageRelationshipByRoomId(roomId);
  if (!existing) {
    return {
      repaired: false,
      reason: "not_found",
      record: null,
      previousInitiatorUserId: "",
    };
  }

  const previousInitiatorUserId = norm(existing.requestInitiatorUserId);
  const isParticipant =
    existing.participantA === openerUserId ||
    existing.participantB === openerUserId;
  if (!isParticipant) {
    return {
      repaired: false,
      reason: "opener_not_participant",
      record: existing,
      previousInitiatorUserId,
    };
  }

  if (existing.requestStatus !== "pending") {
    return {
      repaired: false,
      reason: "not_pending",
      record: existing,
      previousInitiatorUserId,
    };
  }
  if (existing.initiatorOutboundCount !== 0) {
    return {
      repaired: false,
      reason: "outbound_count_nonzero",
      record: existing,
      previousInitiatorUserId,
    };
  }
  if (existing.acceptedAt != null) {
    return {
      repaired: false,
      reason: "already_accepted",
      record: existing,
      previousInitiatorUserId,
    };
  }
  if (existing.declinedAt != null) {
    return {
      repaired: false,
      reason: "already_declined",
      record: existing,
      previousInitiatorUserId,
    };
  }
  if (previousInitiatorUserId === openerUserId) {
    return {
      repaired: false,
      reason: "already_correct",
      record: existing,
      previousInitiatorUserId,
    };
  }
  // Empty initiator or reversed initiator (peer stored as opener).
  if (
    previousInitiatorUserId &&
    previousInitiatorUserId !== openerUserId &&
    previousInitiatorUserId !== existing.participantA &&
    previousInitiatorUserId !== existing.participantB
  ) {
    return {
      repaired: false,
      reason: "initiator_not_participant",
      record: existing,
      previousInitiatorUserId,
    };
  }

  const now = Date.now();
  if (!usePostgres()) {
    let record: DirectMessageRelationshipRecord = existing;
    await updateJsonFile<Record<string, DirectMessageRelationshipRecord>>(
      DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY,
      (current) => {
        const store =
          current && typeof current === "object" ? { ...current } : {};
        const row = store[roomId];
        if (!row) return store;
        if (
          row.requestStatus !== "pending" ||
          row.initiatorOutboundCount !== 0 ||
          row.acceptedAt != null ||
          row.declinedAt != null
        ) {
          record = row;
          return store;
        }
        const prior = norm(row.requestInitiatorUserId);
        if (prior === openerUserId) {
          record = row;
          return store;
        }
        record = {
          ...row,
          requestInitiatorUserId: openerUserId,
          updatedAt: now,
        };
        store[roomId] = record;
        return store;
      },
      {}
    );
    const repaired =
      norm(record.requestInitiatorUserId) === openerUserId &&
      previousInitiatorUserId !== openerUserId;
    return {
      repaired,
      reason: repaired ? "repaired" : "unchanged",
      record,
      previousInitiatorUserId,
    };
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE kristo_direct_message_relationships
    SET
      request_initiator_user_id = ${openerUserId},
      updated_at = NOW()
    WHERE room_id = ${roomId}
      AND request_status = 'pending'
      AND initiator_outbound_count = 0
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND COALESCE(request_initiator_user_id, '') <> ${openerUserId}
      AND (
        participant_a = ${openerUserId}
        OR participant_b = ${openerUserId}
      )
    RETURNING *
  `;
  const row = (rows as any[])[0];
  if (!row) {
    const latest = await getDirectMessageRelationshipByRoomId(roomId);
    return {
      repaired: false,
      reason: "cas_miss_or_unsafe",
      record: latest,
      previousInitiatorUserId,
    };
  }
  return {
    repaired: true,
    reason: "repaired",
    record: rowToRecord(row),
    previousInitiatorUserId,
  };
}

export async function releaseInitiatorOutboundSlotAtomic(args: {
  roomId: string;
  senderUserId: string;
}): Promise<boolean> {
  await ensureReady();
  const roomId = norm(args.roomId);
  const senderUserId = norm(args.senderUserId);
  if (!roomId || !senderUserId) return false;

  if (!usePostgres()) {
    let released = false;
    await updateJsonFile<Record<string, DirectMessageRelationshipRecord>>(
      DIRECT_MESSAGE_RELATIONSHIPS_STORE_KEY,
      (current) => {
        const store =
          current && typeof current === "object" ? { ...current } : {};
        const existing = store[roomId];
        if (!existing) return store;
        if (norm(existing.requestInitiatorUserId) !== senderUserId) return store;
        if (existing.initiatorOutboundCount <= 0) return store;
        store[roomId] = {
          ...existing,
          initiatorOutboundCount: existing.initiatorOutboundCount - 1,
          updatedAt: Date.now(),
        };
        released = true;
        return store;
      },
      {}
    );
    return released;
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE kristo_direct_message_relationships
    SET
      initiator_outbound_count = GREATEST(initiator_outbound_count - 1, 0),
      updated_at = NOW()
    WHERE room_id = ${roomId}
      AND request_initiator_user_id = ${senderUserId}
      AND initiator_outbound_count > 0
    RETURNING room_id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

/** Test helper: wipe one room from the durable relationship store. */
export async function deleteDirectMessageRelationshipForTests(
  roomId: string
): Promise<void> {
  await ensureReady();
  const rid = norm(roomId);
  if (!rid) return;
  if (!usePostgres()) {
    const store = await readLocalStore();
    delete store[rid];
    await writeLocalStore(store);
    return;
  }
  const sql = getSql();
  await sql`
    DELETE FROM kristo_direct_message_relationships
    WHERE room_id = ${rid}
  `;
}

export function getDirectMessageRelationshipPersistenceBackend():
  | "neon-postgres"
  | "local-json-data-dir" {
  return usePostgres() ? "neon-postgres" : "local-json-data-dir";
}
