export const DM_REQUEST_OUTGOING_MESSAGE_LIMIT = 7;

export const DM_REQUEST_MESSAGE_LIMIT_REACHED =
  "DM_REQUEST_MESSAGE_LIMIT_REACHED";

export type DmRelationshipStatus =
  | "same_church"
  | "request_pending"
  | "accepted"
  | "declined"
  | "blocked";

export type DmRequestQuota = {
  relationshipStatus: DmRelationshipStatus;
  outgoingMessageCount: number;
  outgoingMessageLimit: number;
  remainingMessages: number;
  canSend: boolean;
};

export type DmRequestThreadRecord = {
  roomId: string;
  churchId: string;
  participantUserIds?: [string, string] | string[];
  updatedAt?: number;
  blockedByUserId?: Record<string, boolean>;
  requestStatus?: "pending" | "accepted" | "declined";
  requestInitiatorUserId?: string;
  sameChurchAtCreation?: boolean;
  requestOutboundCountByUserId?: Record<string, number>;
  acceptedAt?: number;
  declinedAt?: number;
};

function normUserId(value: string) {
  return String(value || "").trim();
}

export function threadStoreKey(churchId: string, roomId: string) {
  return `${String(churchId || "").trim()}::${String(roomId || "").trim()}`;
}

export function findThreadEntryByRoomId(
  store: Record<string, DmRequestThreadRecord>,
  roomId: string
): { key: string; record: DmRequestThreadRecord } | null {
  const rid = String(roomId || "").trim();
  if (!rid || !store || typeof store !== "object") return null;

  for (const [key, record] of Object.entries(store)) {
    if (!record || typeof record !== "object") continue;
    if (String(record.roomId || "").trim() === rid) {
      return { key, record };
    }
    if (key.endsWith(`::${rid}`)) {
      return { key, record };
    }
  }
  return null;
}

export function resolveDmRelationshipStatus(args: {
  record: DmRequestThreadRecord;
  viewerUserId: string;
  peerUserId: string;
  shareActiveChurch: boolean;
}): DmRelationshipStatus {
  const viewerUserId = normUserId(args.viewerUserId);
  const peerUserId = normUserId(args.peerUserId);
  const blockedByMe =
    args.record.blockedByUserId?.[viewerUserId] === true;
  const blockedByPeer =
    args.record.blockedByUserId?.[peerUserId] === true;
  if (blockedByMe || blockedByPeer) return "blocked";

  // Ongoing same-church is computed from durable Active memberships only.
  // sameChurchAtCreation is historical metadata and must NOT preserve unlimited
  // access after users stop sharing an active church.
  if (args.shareActiveChurch) return "same_church";

  const requestStatus = String(args.record.requestStatus || "").trim();
  if (requestStatus === "accepted") return "accepted";
  if (requestStatus === "declined") return "declined";
  if (requestStatus === "pending") return "request_pending";

  // Explicit initiator without status still means an outside-church request.
  if (normUserId(args.record.requestInitiatorUserId || "")) {
    return "request_pending";
  }

  // No longer same-church and never accepted → treat as request (limited).
  return "request_pending";
}

export function buildDmRequestQuota(args: {
  relationshipStatus: DmRelationshipStatus;
  record: DmRequestThreadRecord;
  senderUserId: string;
  limit?: number;
}): DmRequestQuota {
  const limit = Math.max(
    1,
    Number(args.limit || DM_REQUEST_OUTGOING_MESSAGE_LIMIT) ||
      DM_REQUEST_OUTGOING_MESSAGE_LIMIT
  );
  const senderUserId = normUserId(args.senderUserId);
  const count = Math.max(
    0,
    Number(args.record.requestOutboundCountByUserId?.[senderUserId] || 0) || 0
  );

  if (
    args.relationshipStatus === "same_church" ||
    args.relationshipStatus === "accepted"
  ) {
    return {
      relationshipStatus: args.relationshipStatus,
      outgoingMessageCount: count,
      outgoingMessageLimit: limit,
      remainingMessages: limit,
      canSend: true,
    };
  }

  if (
    args.relationshipStatus === "blocked" ||
    args.relationshipStatus === "declined"
  ) {
    return {
      relationshipStatus: args.relationshipStatus,
      outgoingMessageCount: count,
      outgoingMessageLimit: limit,
      remainingMessages: 0,
      canSend: false,
    };
  }

  const remaining = Math.max(0, limit - count);
  return {
    relationshipStatus: "request_pending",
    outgoingMessageCount: count,
    outgoingMessageLimit: limit,
    remainingMessages: remaining,
    canSend: remaining > 0,
  };
}

/**
 * Pure mutator used by atomic claim + concurrency tests.
 * Increments sender outbound count only when under the limit.
 */
export function claimOutboundSlotInStore(args: {
  store: Record<string, DmRequestThreadRecord>;
  roomId: string;
  senderUserId: string;
  limit?: number;
}): {
  next: Record<string, DmRequestThreadRecord>;
  result:
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
} {
  const roomId = String(args.roomId || "").trim();
  const senderUserId = normUserId(args.senderUserId);
  const limit = Math.max(
    1,
    Number(args.limit || DM_REQUEST_OUTGOING_MESSAGE_LIMIT) ||
      DM_REQUEST_OUTGOING_MESSAGE_LIMIT
  );
  const store =
    args.store && typeof args.store === "object" ? { ...args.store } : {};
  const found = findThreadEntryByRoomId(store, roomId);

  if (!found) {
    return {
      next: store,
      result: {
        ok: false,
        code: "DM_THREAD_NOT_FOUND",
        error: "Conversation not found.",
        count: 0,
        limit,
        remainingMessages: 0,
      },
    };
  }

  const record: DmRequestThreadRecord = { ...found.record };
  const churchId = String(record.churchId || "").trim();
  const counts = {
    ...(record.requestOutboundCountByUserId || {}),
  };
  const current = Math.max(0, Number(counts[senderUserId] || 0) || 0);

  if (current >= limit) {
    return {
      next: store,
      result: {
        ok: false,
        code: DM_REQUEST_MESSAGE_LIMIT_REACHED,
        error:
          "This message request has reached its 7-message limit. Wait for the recipient to accept the conversation.",
        churchId,
        count: current,
        limit,
        remainingMessages: 0,
      },
    };
  }

  const nextCount = current + 1;
  counts[senderUserId] = nextCount;
  record.requestOutboundCountByUserId = counts;
  record.updatedAt = Date.now();
  store[found.key] = record;

  return {
    next: store,
    result: {
      ok: true,
      count: nextCount,
      churchId,
      remainingMessages: Math.max(0, limit - nextCount),
    },
  };
}
