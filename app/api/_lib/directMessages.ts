import { readRoomMessagesJsonFile } from "@/app/api/_lib/store/roomMessageDb";
import {
  readDirectMessageThreadStore,
  updateDirectMessageThreadStore,
} from "@/app/api/_lib/store/directMessageThreadDb";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  getActiveMembership,
  getMembershipsForChurch,
} from "@/app/api/_lib/memberships";
import {
  getProfile,
  getProfileByUserCode,
  resolveCanonicalUserIdentity,
} from "@/app/api/auth/_lib/profile";
import {
  buildDmRequestQuota,
  claimDirectMessageRequestOutboundSlot,
  DM_REQUEST_MESSAGE_LIMIT,
  DM_REQUEST_MESSAGE_LIMIT_REACHED,
  findThreadEntryByRoomId,
  relationshipToThreadOverlay,
  releaseDirectMessageRequestOutboundSlot,
  resolveDmRelationshipStatus,
  threadStoreKey as requestThreadStoreKey,
  usersShareActiveChurch,
  type DmRelationshipStatus,
  type DmRequestQuota,
} from "@/app/api/_lib/directMessageRequests";
import {
  ensurePendingRequestForInitiator,
  getDirectMessageRelationshipByRoomId,
  listDirectMessageRelationshipsForParticipant,
  repairReversedEmptyPendingInitiator,
  resetDirectMessageRelationshipToNone,
  restartMessageRequestAsPending,
  updateDirectMessageRelationshipStatus,
  upsertDirectMessageRelationship,
  type DirectMessageRelationshipRecord,
} from "@/app/api/_lib/store/directMessageRelationshipDb";

export type DirectMessageReportRecord = {
  reporterUserId: string;
  reportedUserId: string;
  reason: string;
  details?: string;
  createdAt: number;
};

export type DirectMessageThreadRecord = {
  roomId: string;
  churchId: string;
  participantUserIds: [string, string];
  createdAt: number;
  updatedAt: number;
  readAtByUserId: Record<string, number>;
  createdByUserId?: string;
  mutedByUserId?: Record<string, boolean>;
  blockedByUserId?: Record<string, boolean>;
  clearedAtByUserId?: Record<string, number>;
  deletedAtByUserId?: Record<string, number>;
  reports?: DirectMessageReportRecord[];
  /** Durable request state for outside-church DMs. */
  requestStatus?: "pending" | "accepted" | "declined";
  requestInitiatorUserId?: string;
  sameChurchAtCreation?: boolean;
  requestOutboundCountByUserId?: Record<string, number>;
  acceptedAt?: number;
  declinedAt?: number;
};

export type DirectMessageConversationSettings = {
  roomId: string;
  churchId: string;
  peerUserId: string;
  muted: boolean;
  blockedByMe: boolean;
  blockedByPeer: boolean;
  blocked: boolean;
  clearedAt: number;
  deletedAt: number;
  relationshipStatus: DmRelationshipStatus;
  requestInitiatorUserId: string;
  outgoingMessageCount: number;
  outgoingMessageLimit: number;
  remainingMessages: number;
  canSend: boolean;
  isRequestInitiator: boolean;
  isRequestReceiver: boolean;
  canAcceptDecline: boolean;
  /** Declined (and not blocked): viewer may start a fresh invitation. */
  canRestartRequest: boolean;
};

export type {
  DmRelationshipStatus,
  DmRequestQuota,
};

export type DirectMessagePeerPreview = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  kristoId: string;
  churchId: string;
  churchName: string;
};

export type DirectMessageInboxItem = {
  roomId: string;
  churchId: string;
  peerUserId: string;
  /** Display name for the peer (alias of title). */
  peerName: string;
  title: string;
  subtitle: string;
  avatarUri: string;
  lastMessagePreview: string;
  /** Latest message text preview (alias of lastMessagePreview). */
  lastMessageText: string;
  timestampLabel: string;
  timestampMs: number;
  unreadCount: number;
  relationshipStatus?: DmRelationshipStatus;
  requestInitiatorUserId?: string;
  isRequestInitiator?: boolean;
  isRequestReceiver?: boolean;
};

export type DirectMessageThreadView = {
  roomId: string;
  churchId: string;
  peerUserId: string;
  title: string;
  subtitle: string;
  avatarUri: string;
};

function normUserId(value: string) {
  return String(value || "").trim();
}

function threadStoreKey(churchId: string, roomId: string) {
  return requestThreadStoreKey(churchId, roomId);
}

function mergeRelationshipIntoRecord(
  record: DirectMessageThreadRecord,
  rel: DirectMessageRelationshipRecord | null
): DirectMessageThreadRecord {
  if (!rel) return record;
  const overlay = relationshipToThreadOverlay(rel);
  const next: DirectMessageThreadRecord = {
    ...record,
    churchId: overlay.churchId || record.churchId,
    requestStatus: overlay.requestStatus,
    requestInitiatorUserId: overlay.requestInitiatorUserId,
    sameChurchAtCreation: overlay.sameChurchAtCreation,
    requestOutboundCountByUserId: overlay.requestOutboundCountByUserId || {},
    acceptedAt: overlay.acceptedAt,
    declinedAt: overlay.declinedAt,
  };
  // Durable relationship is source of truth — clear stale declined/accepted
  // markers from the JSON thread blob when the row has moved on.
  if (rel.requestStatus === "pending" || rel.requestStatus === "none") {
    delete next.acceptedAt;
    delete next.declinedAt;
  }
  if (rel.requestStatus === "pending") {
    next.requestStatus = "pending";
    next.requestInitiatorUserId = normUserId(rel.requestInitiatorUserId);
    next.requestOutboundCountByUserId = {
      [normUserId(rel.requestInitiatorUserId)]: Math.max(
        0,
        Number(rel.initiatorOutboundCount || 0) || 0
      ),
    };
  }
  return next;
}

async function syncThreadRecordFromRelationship(
  roomId: string,
  rel: DirectMessageRelationshipRecord
) {
  const store = await readThreadStore();
  const found = findThreadEntryByRoomId(store, roomId);
  if (!found) return;
  const prior = found.record as DirectMessageThreadRecord;
  const initiator = normUserId(rel.requestInitiatorUserId || "");
  // Relationship is source of truth — overwrite every request field.
  // Never leave stale declined/accepted markers from the JSON blob.
  const next: DirectMessageThreadRecord = {
    ...prior,
    churchId: String(rel.storageChurchId || prior.churchId || "").trim(),
    requestStatus:
      rel.requestStatus === "none"
        ? undefined
        : (rel.requestStatus as "pending" | "accepted" | "declined"),
    requestInitiatorUserId: initiator,
    sameChurchAtCreation: rel.sameChurchAtCreation === true,
    requestOutboundCountByUserId: initiator
      ? { [initiator]: Math.max(0, Number(rel.initiatorOutboundCount || 0) || 0) }
      : {},
    acceptedAt: rel.acceptedAt ?? undefined,
    declinedAt: rel.declinedAt ?? undefined,
    updatedAt: Date.now(),
  };
  if (rel.requestStatus === "pending" || rel.requestStatus === "none") {
    delete next.acceptedAt;
    delete next.declinedAt;
  }
  if (rel.requestStatus === "pending") {
    next.requestStatus = "pending";
    next.requestOutboundCountByUserId = initiator ? { [initiator]: 0 } : {};
  }
  await upsertThreadRecord(found.key, next);
  console.log("KRISTO_DM_THREAD_SYNCED_AFTER_RESTART", {
    roomId,
    viewerUserId: initiator,
    previousStatus: String(prior.requestStatus || "none"),
    newStatus: String(next.requestStatus || rel.requestStatus || ""),
    initiatorUserId: initiator,
    requestStatus: next.requestStatus || "",
    requestInitiatorUserId: next.requestInitiatorUserId || "",
    initiatorOutboundCount: Number(
      next.requestOutboundCountByUserId?.[initiator] || 0
    ),
  });
}

async function ensureDurableRelationship(args: {
  roomId: string;
  storageChurchId: string;
  participantUserIds: [string, string];
  viewerUserId: string;
  sameChurch: boolean;
}): Promise<DirectMessageRelationshipRecord> {
  const existing = await getDirectMessageRelationshipByRoomId(args.roomId);
  if (existing) {
    // Cross-church rows with missing initiator must become pending for the
    // authenticated opener — never leave empty initiator (shows Accept to both).
    if (
      !args.sameChurch &&
      (existing.requestStatus === "none" ||
        !normUserId(existing.requestInitiatorUserId || ""))
    ) {
      const pending = await ensurePendingRequestForInitiator({
        roomId: args.roomId,
        senderUserId: args.viewerUserId,
        storageChurchId: String(
          existing.storageChurchId || args.storageChurchId
        ),
        participantUserIds: args.participantUserIds,
      });
      if (pending) return pending;
    }
    return existing;
  }

  return upsertDirectMessageRelationship({
    roomId: args.roomId,
    storageChurchId: args.storageChurchId,
    participantUserIds: args.participantUserIds,
    sameChurchAtCreation: args.sameChurch,
    ...(args.sameChurch
      ? { requestStatus: "none" as const, requestInitiatorUserId: "" }
      : {
          requestStatus: "pending" as const,
          requestInitiatorUserId: args.viewerUserId,
        }),
  });
}

function roomMessagesKey(churchId: string, roomId: string) {
  return `${String(churchId || "").trim()}::${String(roomId || "").trim()}`;
}

export function buildDirectRoomId(userIdA: string, userIdB: string) {
  const [a, b] = [normUserId(userIdA), normUserId(userIdB)].sort();
  if (!a || !b) return "";
  if (a === b) return "";
  return `dm:${a}::${b}`;
}

export function isDirectRoomId(roomId: string) {
  const raw = String(roomId || "").trim();
  return raw.startsWith("dm:") || raw.startsWith("dm_");
}

export function parseDirectRoomParticipants(roomId: string): [string, string] | null {
  const raw = String(roomId || "").trim();
  if (raw.startsWith("dm:")) {
    const body = raw.slice(3);
    const parts = body.split("::");
    if (parts.length !== 2) return null;
    const a = parts[0].trim();
    const b = parts[1].trim();
    if (!a || !b) return null;
    return [a, b];
  }

  if (!raw.startsWith("dm_")) return null;
  const body = raw.slice(3);
  const splitAt = body.indexOf("_");
  if (splitAt <= 0) return null;
  const a = body.slice(0, splitAt).trim();
  const b = body.slice(splitAt + 1).trim();
  if (!a || !b) return null;
  return [a, b];
}

export function isParticipantInDirectRoom(roomId: string, userId: string) {
  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) return false;
  const uid = normUserId(userId);
  return participants[0] === uid || participants[1] === uid;
}

function peerUserIdFromParticipants(participants: [string, string], viewerUserId: string) {
  return participants[0] === viewerUserId ? participants[1] : participants[0];
}

async function readThreadStore(): Promise<Record<string, DirectMessageThreadRecord>> {
  const data = await readDirectMessageThreadStore<Record<string, DirectMessageThreadRecord>>({});
  return data && typeof data === "object" ? data : {};
}

/** CAS-safe single-key upsert — never blind-replace the whole document. */
async function upsertThreadRecord(
  key: string,
  record: DirectMessageThreadRecord
) {
  const storeKey = String(key || "").trim();
  if (!storeKey) return;
  await updateDirectMessageThreadStore((current) => {
    const base =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, DirectMessageThreadRecord>) }
        : {};
    base[storeKey] = record;
    return base;
  }, {});
}

function formatTimestampLabel(ms: number) {
  if (!ms || !Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pickDisplayName(profile: any, fallback = "Kristo member") {
  return String(
    profile?.fullName || profile?.displayName || profile?.name || profile?.email || fallback
  ).trim();
}

function pickAvatar(profile: any) {
  return String(profile?.avatarUrl || profile?.avatarUri || "").trim();
}

async function activeMemberUserIdsForChurch(churchId: string) {
  const rows = await getMembershipsForChurch(churchId, "Active");
  return new Set(rows.map((row) => normUserId(row.userId)).filter(Boolean));
}

export async function assertActiveChurchMember(churchId: string, userId: string) {
  const cid = String(churchId || "").trim();
  const uid = normUserId(userId);
  if (!cid || !uid) return false;
  const active = await activeMemberUserIdsForChurch(cid);
  return active.has(uid);
}

async function buildThreadView(args: {
  roomId: string;
  churchId: string;
  peerUserId: string;
}): Promise<DirectMessageThreadView> {
  const peerProfile = await getProfile(args.peerUserId).catch(() => null);
  const church = await getChurchById(args.churchId).catch(() => null);
  return {
    roomId: args.roomId,
    churchId: args.churchId,
    peerUserId: args.peerUserId,
    title: pickDisplayName(peerProfile),
    subtitle: String(church?.name || church?.name || "Direct message").trim(),
    avatarUri: pickAvatar(peerProfile),
  };
}

export async function resolveDirectMessagePeerPreview(args: {
  kristoId: string;
  churchId: string;
}): Promise<DirectMessagePeerPreview | null> {
  const kristoId = String(args.kristoId || "").trim().toUpperCase();
  const churchId = String(args.churchId || "").trim();
  if (!kristoId || !churchId) return null;

  const profile = await getProfileByUserCode(kristoId);
  if (!profile?.userId) return null;

  const isMember = await assertActiveChurchMember(churchId, profile.userId);
  if (!isMember) return null;

  const church = await getChurchById(churchId).catch(() => null);
  return {
    userId: profile.userId,
    displayName: pickDisplayName(profile),
    avatarUrl: pickAvatar(profile),
    kristoId: String(profile.userCode || kristoId).trim().toUpperCase(),
    churchId,
    churchName: String(church?.name || church?.name || "Church").trim(),
  };
}

export async function ensureDirectMessageThreadFromRoomId(args: {
  viewerUserId: string;
  churchId: string;
  roomId: string;
  intent?: "create" | "repair";
}): Promise<DirectMessageThreadView | null> {
  const viewerUserId = normUserId(args.viewerUserId);
  const requestedChurchId = String(args.churchId || "").trim();
  const rawRoomId = String(args.roomId || "").trim();
  const intent = args.intent === "create" ? "create" : "repair";

  if (!viewerUserId || !rawRoomId || !isDirectRoomId(rawRoomId)) {
    console.log("KRISTO_DM_READ_MARK_SKIPPED_NO_THREAD", {
      reason: "invalid_room_or_context",
      roomId: rawRoomId,
      churchId: requestedChurchId,
      viewerUserId,
    });
    return null;
  }

  const participants = parseDirectRoomParticipants(rawRoomId);
  if (!participants) {
    console.log("KRISTO_DM_READ_MARK_SKIPPED_NO_THREAD", {
      reason: "invalid_room_participants",
      roomId: rawRoomId,
      churchId: requestedChurchId,
      viewerUserId,
    });
    return null;
  }

  const canonicalRoomId = buildDirectRoomId(participants[0], participants[1]);
  if (!canonicalRoomId || canonicalRoomId !== rawRoomId) {
    console.log("KRISTO_DM_READ_MARK_SKIPPED_NO_THREAD", {
      reason: "room_id_not_canonical",
      roomId: rawRoomId,
      canonicalRoomId,
      churchId: requestedChurchId,
      viewerUserId,
    });
    return null;
  }

  if (!isParticipantInDirectRoom(canonicalRoomId, viewerUserId)) {
    console.log("KRISTO_DM_READ_MARK_SKIPPED_NO_THREAD", {
      reason: "viewer_not_participant",
      roomId: canonicalRoomId,
      churchId: requestedChurchId,
      viewerUserId,
    });
    return null;
  }

  const peerUserId = peerUserIdFromParticipants(participants, viewerUserId);
  const now = Date.now();
  const store = await readThreadStore();
  const existingEntry = findThreadEntryByRoomId(store, canonicalRoomId);
  const sharedChurchId = await usersShareActiveChurch(viewerUserId, peerUserId);
  const sameChurchNow = Boolean(sharedChurchId);

  if (existingEntry) {
    const priorChurchId = String(
      existingEntry.record.churchId || requestedChurchId || ""
    ).trim();
    const existingRecord = existingEntry.record as DirectMessageThreadRecord;
    const rel = await ensureDurableRelationship({
      roomId: canonicalRoomId,
      storageChurchId: priorChurchId,
      participantUserIds: participants,
      // Authenticated caller only — never mint initiator from stale createdBy.
      viewerUserId,
      // Ongoing same-church only — historical sameChurchAtCreation must not
      // mint an unlimited "none" relationship after users leave the church.
      sameChurch: sameChurchNow,
    });
    const churchId = String(rel.storageChurchId || priorChurchId).trim();
    existingRecord.updatedAt = Math.max(
      Number(existingRecord.updatedAt || 0),
      now
    );
    existingRecord.churchId = churchId;
    await upsertThreadRecord(existingEntry.key, existingRecord);
    console.log("KRISTO_DM_THREAD_FOUND", {
      roomId: canonicalRoomId,
      churchId,
      viewerUserId,
      peerUserId,
    });
    return buildThreadView({ roomId: canonicalRoomId, churchId, peerUserId });
  }

  // Durable relationship may already exist even if metadata JSON was lost.
  const existingRel = await getDirectMessageRelationshipByRoomId(canonicalRoomId);
  if (existingRel) {
    const churchId = String(
      existingRel.storageChurchId || requestedChurchId || ""
    ).trim();
    if (!churchId) return null;
    const key = threadStoreKey(churchId, canonicalRoomId);
    await upsertThreadRecord(key, {
      roomId: canonicalRoomId,
      churchId,
      participantUserIds: participants,
      createdAt: existingRel.createdAt || now,
      updatedAt: now,
      readAtByUserId: {},
      createdByUserId: viewerUserId,
      sameChurchAtCreation: existingRel.sameChurchAtCreation,
    });
    return buildThreadView({ roomId: canonicalRoomId, churchId, peerUserId });
  }

  // Creation no longer requires shared/active church membership.
  // Status is same_church when they share Active membership; else request_pending.
  const peerIdentity = await resolveCanonicalUserIdentity(peerUserId);
  if (!peerIdentity?.userId) {
    console.log("KRISTO_DM_READ_MARK_SKIPPED_NO_THREAD", {
      reason: "peer_identity_missing",
      roomId: canonicalRoomId,
      viewerUserId,
      peerUserId,
    });
    return null;
  }

  const viewerActive = await getActiveMembership(viewerUserId).catch(() => null);
  const churchId = String(
    sharedChurchId ||
      requestedChurchId ||
      viewerActive?.churchId ||
      "dm"
  ).trim();
  const rel = await ensureDurableRelationship({
    roomId: canonicalRoomId,
    storageChurchId: churchId,
    participantUserIds: participants,
    viewerUserId,
    sameChurch: sameChurchNow,
  });
  const durableChurchId = String(rel.storageChurchId || churchId).trim();
  const key = threadStoreKey(durableChurchId, canonicalRoomId);
  const record: DirectMessageThreadRecord = {
    roomId: canonicalRoomId,
    churchId: durableChurchId,
    participantUserIds: participants,
    createdAt: now,
    updatedAt: now,
    readAtByUserId: {},
    createdByUserId: viewerUserId,
    sameChurchAtCreation: sameChurchNow,
  };
  await upsertThreadRecord(key, record);

  if (intent === "create") {
    console.log("KRISTO_DM_THREAD_CREATED", {
      roomId: canonicalRoomId,
      churchId: durableChurchId,
      viewerUserId,
      peerUserId,
      requestStatus: rel.requestStatus,
      sameChurchAtCreation: rel.sameChurchAtCreation === true,
    });
  } else {
    console.log("KRISTO_DM_THREAD_REPAIRED_FROM_ROOM_ID", {
      roomId: canonicalRoomId,
      churchId: durableChurchId,
      viewerUserId,
      peerUserId,
    });
  }

  return buildThreadView({
    roomId: canonicalRoomId,
    churchId: durableChurchId,
    peerUserId,
  });
}

export async function openDirectMessageThread(args: {
  viewerUserId: string;
  targetUserId: string;
  churchId: string;
}) {
  const viewerUserId = normUserId(args.viewerUserId);
  const rawTargetUserId = normUserId(args.targetUserId);
  const requestedChurchId = String(args.churchId || "").trim();

  if (!viewerUserId || !rawTargetUserId) {
    throw new Error("Missing viewer or target.");
  }

  const targetIdentity = await resolveCanonicalUserIdentity(rawTargetUserId);
  if (!targetIdentity?.userId) {
    throw new Error("Target user not found.");
  }
  const targetUserId = normUserId(targetIdentity.userId);

  if (viewerUserId === targetUserId) {
    throw new Error("You cannot start a chat with yourself.");
  }

  const roomId = buildDirectRoomId(viewerUserId, targetUserId);
  if (!roomId) throw new Error("Invalid conversation participants.");

  const store = await readThreadStore();
  const existing = findThreadEntryByRoomId(store, roomId);
  if (existing) {
    const record = existing.record as DirectMessageThreadRecord;
    const blocked =
      record.blockedByUserId?.[viewerUserId] === true ||
      record.blockedByUserId?.[targetUserId] === true;
    if (blocked) {
      throw new Error("conversation_blocked");
    }
  }

  const sharedChurchId = await usersShareActiveChurch(
    viewerUserId,
    targetUserId
  );
  const existingRel = await getDirectMessageRelationshipByRoomId(roomId);

  const viewerActive = await getActiveMembership(viewerUserId).catch(() => null);
  const storageChurchId = String(
    existingRel?.storageChurchId ||
      sharedChurchId ||
      requestedChurchId ||
      viewerActive?.churchId ||
      "dm"
  ).trim();

  // Profile Message: reverse/empty repair, or restart declined/none as a new invite.
  if (!sharedChurchId) {
    const repair = await repairReversedEmptyPendingInitiator({
      roomId,
      authenticatedOpenerUserId: viewerUserId,
    });
    if (repair.repaired) {
      console.log("KRISTO_DM_REQUEST_INITIATOR_REPAIRED", {
        roomId,
        authenticatedOpenerUserId: viewerUserId,
        previousInitiatorUserId: repair.previousInitiatorUserId,
        requestInitiatorUserId: repair.record?.requestInitiatorUserId || "",
        reason: repair.reason,
      });
    }

    const relBefore = await getDirectMessageRelationshipByRoomId(roomId);
    const statusBefore = String(relBefore?.requestStatus || "none");
    if (!relBefore || statusBefore === "none" || statusBefore === "declined") {
      const restarted = await restartMessageRequestAsPending({
        roomId,
        initiatorUserId: viewerUserId,
        storageChurchId,
        participantUserIds: [viewerUserId, targetUserId],
      });
      if (restarted.ok) {
        await syncThreadRecordFromRelationship(roomId, restarted.record);
        console.log("KRISTO_DM_REQUEST_RESTARTED", {
          roomId,
          authenticatedOpenerUserId: viewerUserId,
          targetUserId,
          previousStatus: statusBefore,
          requestInitiatorUserId: restarted.record.requestInitiatorUserId,
          initiatorOutboundCount: restarted.record.initiatorOutboundCount,
          source: "profile_open",
        });
      }
    }
  }

  // Always ensure metadata + durable relationship (never early-return without initiator).
  const ensured = await ensureDirectMessageThreadFromRoomId({
    viewerUserId,
    churchId: storageChurchId,
    roomId,
    intent: "create",
  });
  if (!ensured) {
    throw new Error("Target user not found.");
  }

  const rel = await getDirectMessageRelationshipByRoomId(roomId);
  const relationshipStatus = rel
    ? resolveDmRelationshipStatus({
        record: {
          roomId,
          churchId: String(rel.storageChurchId || storageChurchId),
          requestStatus:
            rel.requestStatus === "none"
              ? undefined
              : (rel.requestStatus as "pending" | "accepted" | "declined"),
          requestInitiatorUserId: rel.requestInitiatorUserId,
          sameChurchAtCreation: rel.sameChurchAtCreation,
        },
        viewerUserId,
        peerUserId: targetUserId,
        shareActiveChurch: Boolean(sharedChurchId),
      })
    : sharedChurchId
      ? ("same_church" as const)
      : ("request_pending" as const);

  console.log("KRISTO_DM_REQUEST_CREATED", {
    roomId,
    authenticatedSenderUserId: viewerUserId,
    targetUserId,
    requestInitiatorUserId: String(rel?.requestInitiatorUserId || "").trim(),
    relationshipStatus,
  });

  return ensured;
}

export async function markDirectMessageThreadRead(args: {
  churchId: string;
  roomId: string;
  userId: string;
}) {
  const churchId = String(args.churchId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const userId = normUserId(args.userId);
  if (!churchId || !roomId || !userId) return false;

  const ensured = await ensureDirectMessageThreadFromRoomId({
    viewerUserId: userId,
    churchId,
    roomId,
  });
  if (!ensured) return false;

  const store = await readThreadStore();
  const key = threadStoreKey(churchId, ensured.roomId);
  const record = store[key];
  if (!record) return false;

  record.readAtByUserId = {
    ...(record.readAtByUserId || {}),
    [userId]: Date.now(),
  };
  record.updatedAt = Date.now();
  await upsertThreadRecord(key, record);
  return true;
}


/** Canonical storage church for a DM room — never the viewer's session church. */
export async function resolveDirectMessageStorageChurchId(args: {
  roomId: string;
  fallbackChurchId?: string;
}): Promise<string> {
  const roomId = String(args.roomId || "").trim();
  if (!roomId || !isDirectRoomId(roomId)) {
    return String(args.fallbackChurchId || "").trim();
  }
  const rel = await getDirectMessageRelationshipByRoomId(roomId).catch(
    () => null
  );
  if (rel?.storageChurchId) return String(rel.storageChurchId).trim();
  const store = await readThreadStore();
  const found = findThreadEntryByRoomId(store, roomId);
  const fromThread = String(found?.record?.churchId || "").trim();
  if (fromThread) return fromThread;
  return String(args.fallbackChurchId || "").trim();
}

export async function getDirectMessageConversationSettings(args: {
  churchId: string;
  roomId: string;
  userId: string;
}): Promise<DirectMessageConversationSettings | null> {
  const requestedChurchId = String(args.churchId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const userId = normUserId(args.userId);

  if (
    !roomId ||
    !userId ||
    !isDirectRoomId(roomId) ||
    !isParticipantInDirectRoom(roomId, userId)
  ) {
    return null;
  }

  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) return null;

  const rel = await getDirectMessageRelationshipByRoomId(roomId).catch(
    () => null
  );
  let store = await readThreadStore();
  let found = findThreadEntryByRoomId(store, roomId);
  let baseRecord = found?.record as DirectMessageThreadRecord | undefined;

  // Relationship can exist before the receiver's session ever wrote a thread
  // blob — repair from durable storageChurchId, not the header church.
  if (!baseRecord) {
    const repairChurchId = String(
      rel?.storageChurchId || requestedChurchId || ""
    ).trim();
    if (!repairChurchId) return null;
    await ensureDirectMessageThreadFromRoomId({
      viewerUserId: userId,
      churchId: repairChurchId,
      roomId,
      intent: "repair",
    });
    store = await readThreadStore();
    found = findThreadEntryByRoomId(store, roomId);
    baseRecord = found?.record as DirectMessageThreadRecord | undefined;
    if (!baseRecord) return null;
  }

  const record = mergeRelationshipIntoRecord(baseRecord, rel);
  const churchId = String(
    rel?.storageChurchId || record.churchId || requestedChurchId || ""
  ).trim();
  const peerUserId = peerUserIdFromParticipants(participants, userId);

  const blockedByMe = record.blockedByUserId?.[userId] === true;
  const blockedByPeer = record.blockedByUserId?.[peerUserId] === true;
  const shareActiveChurch = Boolean(
    await usersShareActiveChurch(userId, peerUserId)
  );
  const relationshipStatus = resolveDmRelationshipStatus({
    record,
    viewerUserId: userId,
    peerUserId,
    shareActiveChurch,
  });
  const requestInitiatorUserId = normUserId(
    record.requestInitiatorUserId || ""
  );
  const isPendingRequest = relationshipStatus === "request_pending";
  const isRequestInitiator =
    isPendingRequest &&
    Boolean(requestInitiatorUserId) &&
    requestInitiatorUserId === userId;
  const isRequestReceiver =
    isPendingRequest &&
    Boolean(requestInitiatorUserId) &&
    requestInitiatorUserId !== userId;
  const quotaSenderUserId =
    isPendingRequest && requestInitiatorUserId
      ? requestInitiatorUserId
      : userId;
  const quota = buildDmRequestQuota({
    relationshipStatus,
    record,
    senderUserId: quotaSenderUserId,
  });
  const canAcceptDecline =
    isRequestReceiver && !blockedByMe && !blockedByPeer;
  const canRestartRequest =
    relationshipStatus === "declined" && !blockedByMe && !blockedByPeer;
  // Viewer-specific sendability: initiator uses quota; recipient can reply
  // without consuming the initiator's message allowance.
  const viewerCanSend =
    relationshipStatus === "same_church" ||
    relationshipStatus === "accepted" ||
    (isRequestInitiator && quota.canSend) ||
    isRequestReceiver;

  return {
    roomId,
    churchId,
    peerUserId,
    muted: record.mutedByUserId?.[userId] === true,
    blockedByMe,
    blockedByPeer,
    blocked: blockedByMe || blockedByPeer,
    clearedAt: Number(record.clearedAtByUserId?.[userId] || 0),
    deletedAt: Number(record.deletedAtByUserId?.[userId] || 0),
    relationshipStatus: quota.relationshipStatus,
    requestInitiatorUserId,
    outgoingMessageCount: quota.outgoingMessageCount,
    outgoingMessageLimit: quota.outgoingMessageLimit,
    remainingMessages: isRequestInitiator
      ? quota.remainingMessages
      : isRequestReceiver
        ? quota.outgoingMessageLimit
        : quota.remainingMessages,
    canSend:
      relationshipStatus === "blocked" ||
      relationshipStatus === "declined"
        ? false
        : viewerCanSend,
    isRequestInitiator,
    isRequestReceiver,
    canAcceptDecline,
    canRestartRequest,
  };
}

export async function updateDirectMessageConversationSettings(args: {
  churchId: string;
  roomId: string;
  userId: string;
  action:
    | "mute"
    | "unmute"
    | "block"
    | "unblock"
    | "clear"
    | "delete"
    | "restore"
    | "accept"
    | "decline"
    | "restart_request";
}): Promise<DirectMessageConversationSettings | null> {
  const requestedChurchId = String(args.churchId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const userId = normUserId(args.userId);

  if (
    !roomId ||
    !userId ||
    !isDirectRoomId(roomId) ||
    !isParticipantInDirectRoom(roomId, userId)
  ) {
    return null;
  }

  const storeBefore = await readThreadStore();
  const existing = findThreadEntryByRoomId(storeBefore, roomId);
  const churchId = String(
    existing?.record.churchId || requestedChurchId || ""
  ).trim();
  if (!churchId) return null;

  const ensured = await ensureDirectMessageThreadFromRoomId({
    viewerUserId: userId,
    churchId,
    roomId,
    intent: "repair",
  });

  if (!ensured) return null;

  const now = Date.now();
  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) return null;
  const peerUserId = peerUserIdFromParticipants(participants, userId);

  if (args.action === "accept" || args.action === "decline") {
    const statusUpdate = await updateDirectMessageRelationshipStatus({
      roomId,
      actorUserId: userId,
      action: args.action,
    });
    if (!statusUpdate.ok) {
      return null;
    }
    return getDirectMessageConversationSettings({
      churchId: ensured.churchId,
      roomId,
      userId,
    });
  }

  if (args.action === "restart_request") {
    const shareActiveChurch = Boolean(
      await usersShareActiveChurch(userId, peerUserId)
    );
    if (shareActiveChurch) {
      return getDirectMessageConversationSettings({
        churchId: ensured.churchId,
        roomId,
        userId,
      });
    }
    const settingsBefore = await getDirectMessageConversationSettings({
      churchId: ensured.churchId,
      roomId,
      userId,
    });
    if (settingsBefore?.blocked) return null;

    const relBefore = await getDirectMessageRelationshipByRoomId(roomId);
    const previousStatus = String(relBefore?.requestStatus || "none");
    if (previousStatus === "accepted") return null;

    const restarted = await restartMessageRequestAsPending({
      roomId,
      initiatorUserId: userId,
      storageChurchId: ensured.churchId,
      participantUserIds: participants,
    });
    if (!restarted.ok) {
      console.log("KRISTO_DM_REQUEST_RESTART_FAILED", {
        roomId,
        viewerUserId: userId,
        previousStatus: restarted.previousStatus || previousStatus,
        newStatus: restarted.record?.requestStatus || "",
        initiatorUserId: userId,
        code: restarted.code,
      });
      return null;
    }

    await syncThreadRecordFromRelationship(roomId, restarted.record);

    const settingsAfter = await getDirectMessageConversationSettings({
      churchId: ensured.churchId,
      roomId,
      userId,
    });
    // Fail closed: never return OK unless settings prove pending for viewer.
    const freshQuotaOk =
      !restarted.restarted ||
      (Number(settingsAfter?.remainingMessages || 0) ===
        Number(
          settingsAfter?.outgoingMessageLimit || DM_REQUEST_MESSAGE_LIMIT
        ) &&
        Number(settingsAfter?.outgoingMessageCount || 0) === 0);
    if (
      !settingsAfter ||
      settingsAfter.relationshipStatus !== "request_pending" ||
      settingsAfter.isRequestInitiator !== true ||
      settingsAfter.isRequestReceiver === true ||
      normUserId(settingsAfter.requestInitiatorUserId || "") !== userId ||
      !freshQuotaOk
    ) {
      console.log("KRISTO_DM_REQUEST_RESTART_FAILED", {
        roomId,
        viewerUserId: userId,
        previousStatus,
        newStatus: settingsAfter?.relationshipStatus || "",
        initiatorUserId: userId,
        code: "DM_REQUEST_RESTART_PERSISTENCE_FAILED",
        settings: settingsAfter
          ? {
              relationshipStatus: settingsAfter.relationshipStatus,
              requestInitiatorUserId: settingsAfter.requestInitiatorUserId,
              isRequestInitiator: settingsAfter.isRequestInitiator,
              isRequestReceiver: settingsAfter.isRequestReceiver,
              remainingMessages: settingsAfter.remainingMessages,
              outgoingMessageCount: settingsAfter.outgoingMessageCount,
            }
          : null,
      });
      return null;
    }

    return settingsAfter;
  }

  await updateDirectMessageThreadStore<
    Record<string, DirectMessageThreadRecord>
  >((current) => {
    const next = current && typeof current === "object"
      ? { ...current }
      : {};

    const found = findThreadEntryByRoomId(next, roomId);
    if (!found) return next;
    const record = found.record as DirectMessageThreadRecord;

    if (args.action === "mute" || args.action === "unmute") {
      record.mutedByUserId = {
        ...(record.mutedByUserId || {}),
        [userId]: args.action === "mute",
      };
    }

    if (args.action === "block" || args.action === "unblock") {
      record.blockedByUserId = {
        ...(record.blockedByUserId || {}),
        [userId]: args.action === "block",
      };
    }

    if (args.action === "clear") {
      record.clearedAtByUserId = {
        ...(record.clearedAtByUserId || {}),
        [userId]: now,
      };
      record.readAtByUserId = {
        ...(record.readAtByUserId || {}),
        [userId]: now,
      };
    }

    if (args.action === "delete") {
      record.deletedAtByUserId = {
        ...(record.deletedAtByUserId || {}),
        [userId]: now,
      };
      record.readAtByUserId = {
        ...(record.readAtByUserId || {}),
        [userId]: now,
      };
    }

    if (args.action === "restore") {
      record.deletedAtByUserId = {
        ...(record.deletedAtByUserId || {}),
        [userId]: 0,
      };
    }

    record.updatedAt = Math.max(Number(record.updatedAt || 0), now);
    next[found.key] = record;
    return next;
  }, {});

  // Unblock clears relationship to none — next Message opener becomes initiator.
  // Does NOT restore accepted.
  if (args.action === "unblock") {
    const reset = await resetDirectMessageRelationshipToNone(roomId);
    console.log("KRISTO_DM_REQUEST_RESET_AFTER_UNBLOCK", {
      roomId,
      userId,
      peerUserId,
      requestStatus: reset?.requestStatus || "none",
    });
  }

  console.log("KRISTO_DM_CONVERSATION_SETTING_UPDATED", {
    churchId: ensured.churchId,
    roomId,
    userId,
    peerUserId,
    action: args.action,
    ts: now,
  });

  return getDirectMessageConversationSettings({
    churchId: ensured.churchId,
    roomId,
    userId,
  });
}

export async function reportDirectMessageUser(args: {
  churchId: string;
  roomId: string;
  reporterUserId: string;
  reason: string;
  details?: string;
}) {
  const churchId = String(args.churchId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const reporterUserId = normUserId(args.reporterUserId);
  const reason = String(args.reason || "").trim();
  const details = String(args.details || "").trim();

  if (
    !churchId ||
    !roomId ||
    !reporterUserId ||
    !reason ||
    !isParticipantInDirectRoom(roomId, reporterUserId)
  ) {
    return false;
  }

  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) return false;

  const reportedUserId = peerUserIdFromParticipants(
    participants,
    reporterUserId
  );

  const createdAt = Date.now();

  await updateDirectMessageThreadStore<
    Record<string, DirectMessageThreadRecord>
  >((current) => {
    const next = current && typeof current === "object"
      ? { ...current }
      : {};

    const found = findThreadEntryByRoomId(next, roomId);
    if (!found) return next;
    const record = found.record as DirectMessageThreadRecord;

    record.reports = [
      ...(record.reports || []),
      {
        reporterUserId,
        reportedUserId,
        reason,
        ...(details ? { details } : {}),
        createdAt,
      },
    ].slice(-200);

    next[found.key] = record;
    return next;
  }, {});

  console.log("KRISTO_DM_USER_REPORTED", {
    churchId,
    roomId,
    reporterUserId,
    reportedUserId,
    reason,
    createdAt,
  });

  return true;
}

export async function isDirectMessageBlocked(args: {
  churchId: string;
  roomId: string;
  userId: string;
}) {
  const settings =
    await getDirectMessageConversationSettings(args);
  return settings?.blocked === true;
}

export type DirectMessageSendGateResult =
  | {
      ok: true;
      churchId: string;
      relationshipStatus: DmRelationshipStatus;
      claimedOutboundSlot: boolean;
      quota: DmRequestQuota;
    }
  | {
      ok: false;
      status: number;
      body: {
        ok: false;
        error: string;
        code?: string;
        message?: string;
        details?: {
          limit: number;
          remainingMessages: number;
        };
      };
    };

/**
 * Enforce block + relationship/request limit before persisting a DM.
 * When a pending request slot is claimed, caller must release on persist failure.
 */
export async function assertDirectMessageSendAllowed(args: {
  churchId: string;
  roomId: string;
  senderUserId: string;
}): Promise<DirectMessageSendGateResult> {
  const roomId = String(args.roomId || "").trim();
  const senderUserId = normUserId(args.senderUserId);
  const requestedChurchId = String(args.churchId || "").trim();

  if (
    !roomId ||
    !senderUserId ||
    !isDirectRoomId(roomId) ||
    !isParticipantInDirectRoom(roomId, senderUserId)
  ) {
    return {
      ok: false,
      status: 403,
      body: { ok: false, error: "Forbidden" },
    };
  }

  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: "Invalid direct message room." },
    };
  }

  const peerUserId = peerUserIdFromParticipants(participants, senderUserId);
  const store = await readThreadStore();
  const found = findThreadEntryByRoomId(store, roomId);
  if (!found) {
    return {
      ok: false,
      status: 404,
      body: { ok: false, error: "Conversation not found." },
    };
  }

  // Block is checked before any quota claim so blocked attempts never consume.
  const baseRecord = found.record as DirectMessageThreadRecord;
  const blockedByMe = baseRecord.blockedByUserId?.[senderUserId] === true;
  const blockedByPeer = baseRecord.blockedByUserId?.[peerUserId] === true;
  if (blockedByMe || blockedByPeer) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: "conversation_blocked",
        message:
          "Messages cannot be sent in this blocked conversation.",
      },
    };
  }

  let rel = await getDirectMessageRelationshipByRoomId(roomId);
  if (!rel) {
    const shareNow = Boolean(
      await usersShareActiveChurch(senderUserId, peerUserId)
    );
    rel = await ensureDurableRelationship({
      roomId,
      storageChurchId: String(
        baseRecord.churchId || requestedChurchId || ""
      ).trim(),
      participantUserIds: participants,
      viewerUserId: senderUserId,
      sameChurch: shareNow,
    });
  }

  const record = mergeRelationshipIntoRecord(baseRecord, rel);
  const churchId = String(
    rel.storageChurchId || record.churchId || requestedChurchId || ""
  ).trim();
  const shareActiveChurch = Boolean(
    await usersShareActiveChurch(senderUserId, peerUserId)
  );
  const relationshipStatus = resolveDmRelationshipStatus({
    record,
    viewerUserId: senderUserId,
    peerUserId,
    shareActiveChurch,
  });
  const quota = buildDmRequestQuota({
    relationshipStatus,
    record,
    senderUserId,
  });

  if (relationshipStatus === "declined") {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error:
          "This message request was declined. Tap Request again to start a new invitation.",
        code: "DM_REQUEST_DECLINED",
      },
    };
  }

  if (
    relationshipStatus === "same_church" ||
    relationshipStatus === "accepted"
  ) {
    return {
      ok: true,
      churchId,
      relationshipStatus,
      claimedOutboundSlot: false,
      quota,
    };
  }

  // request_pending: only the initiator consumes the message quota.
  // Receiver may reply before Accept without consuming initiator quota.
  const initiatorUserId = normUserId(record.requestInitiatorUserId || "");
  if (initiatorUserId && initiatorUserId !== senderUserId) {
    return {
      ok: true,
      churchId,
      relationshipStatus: "request_pending",
      claimedOutboundSlot: false,
      quota: buildDmRequestQuota({
        relationshipStatus: "request_pending",
        record,
        senderUserId: initiatorUserId,
      }),
    };
  }

  // If relationship was "none"/legacy and no longer same-church, mint pending
  // for this authenticated sender as initiator before claiming (server-set only).
  if (!initiatorUserId || rel.requestStatus === "none") {
    const pending = await ensurePendingRequestForInitiator({
      roomId,
      senderUserId,
      storageChurchId: churchId,
      participantUserIds: participants,
    });
    if (pending) {
      rel = pending;
    }
  }

  const claim = await claimDirectMessageRequestOutboundSlot({
    roomId,
    senderUserId,
    limit: DM_REQUEST_MESSAGE_LIMIT,
  });

  if (!claim.ok) {
    if (claim.code === DM_REQUEST_MESSAGE_LIMIT_REACHED) {
      return {
        ok: false,
        status: 403,
        body: {
          ok: false,
          error: claim.error,
          code: DM_REQUEST_MESSAGE_LIMIT_REACHED,
          details: {
            limit: claim.limit,
            remainingMessages: 0,
          },
        },
      };
    }
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error: claim.error || "Could not send message request.",
        code: claim.code,
      },
    };
  }

  return {
    ok: true,
    churchId: claim.churchId || churchId,
    relationshipStatus: "request_pending",
    claimedOutboundSlot: true,
    quota: {
      relationshipStatus: "request_pending",
      outgoingMessageCount: claim.count,
      outgoingMessageLimit: DM_REQUEST_MESSAGE_LIMIT,
      remainingMessages: claim.remainingMessages,
      canSend: claim.remainingMessages > 0,
    },
  };
}

export { releaseDirectMessageRequestOutboundSlot };

export async function touchDirectMessageThread(args: {
  churchId: string;
  roomId: string;
  senderUserId: string;
  previewText?: string;
  createdAt?: number;
}) {
  const churchId = String(args.churchId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const senderUserId = normUserId(args.senderUserId);
  if (!churchId || !roomId || !senderUserId || !isDirectRoomId(roomId)) return;

  const ensured = await ensureDirectMessageThreadFromRoomId({
    viewerUserId: senderUserId,
    churchId,
    roomId,
  });
  if (!ensured) return;

  const now = args.createdAt || Date.now();
  const store = await readThreadStore();
  const key = threadStoreKey(churchId, ensured.roomId);
  const record = store[key];
  if (!record) return;

  record.updatedAt = now;
  record.readAtByUserId = {
    ...(record.readAtByUserId || {}),
    [senderUserId]: now,
  };
  await upsertThreadRecord(key, record);
}

async function unreadCountForThread(args: {
  churchId: string;
  roomId: string;
  viewerUserId: string;
  readAt: number;
}) {
  const store = await readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {});
  const rows = Array.isArray(store[roomMessagesKey(args.churchId, args.roomId)])
    ? store[roomMessagesKey(args.churchId, args.roomId)]
    : [];
  const viewerUserId = normUserId(args.viewerUserId);
  const readAt = Number(args.readAt || 0);

  return rows.reduce((count, row) => {
    const senderUserId = normUserId(row?.senderUserId || "");
    const createdAt = Number(row?.createdAt || 0);
    const deletedFor = Array.isArray(row?.deletedFor) ? row.deletedFor.map(String) : [];
    if (!senderUserId || senderUserId === viewerUserId) return count;
    if (deletedFor.includes(viewerUserId)) return count;
    if (createdAt <= readAt) return count;
    return count + 1;
  }, 0);
}

async function lastMessageForThread(
  churchId: string,
  roomId: string,
  viewerUserId = "",
  clearedAt = 0
) {
  const store = await readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {});
  const rows = Array.isArray(store[roomMessagesKey(churchId, roomId)])
    ? store[roomMessagesKey(churchId, roomId)]
    : [];
  const normalizedViewerUserId =
    normUserId(viewerUserId);

  const sorted = rows
    .filter((row: any) => {
      const createdAt = Number(row?.createdAt || 0);
      const deletedFor = Array.isArray(row?.deletedFor)
        ? row.deletedFor.map(String)
        : [];

      if (
        normalizedViewerUserId &&
        deletedFor.includes(normalizedViewerUserId)
      ) {
        return false;
      }

      if (createdAt <= Number(clearedAt || 0)) {
        return false;
      }

      return true;
    })
    .slice()
    .sort(
      (a, b) =>
        Number(b?.createdAt || 0) -
        Number(a?.createdAt || 0)
    );
  const latest = sorted[0];
  if (!latest) return null;
  return {
    preview:
      String(latest?.text || "").trim() ||
      (Array.isArray(latest?.attachments) && latest.attachments.length ? "Attachment" : ""),
    timestampMs: Number(latest?.createdAt || 0),
  };
}

async function discoverDirectRoomIdsFromMessages(
  churchId: string,
  viewerUserId: string
) {
  const store = await readRoomMessagesJsonFile<Record<string, any[]>>(
    "room-messages.json",
    {}
  );
  const roomIds = new Set<string>();
  const churchPrefix = `${churchId}::`;

  for (const key of Object.keys(store || {})) {
    const sep = key.indexOf("::");
    if (sep <= 0) continue;
    const roomId = key.slice(sep + 2);
    if (!isDirectRoomId(roomId)) continue;
    if (!isParticipantInDirectRoom(roomId, viewerUserId)) continue;
    // Prefer same-church discoveries for repair, but include all participant DMs.
    if (key.startsWith(churchPrefix) || isDirectRoomId(roomId)) {
      roomIds.add(roomId);
    }
  }

  return Array.from(roomIds);
}

function viewerIsThreadParticipant(
  thread: DirectMessageThreadRecord | null | undefined,
  viewerUserId: string
) {
  if (!thread) return false;
  if (isParticipantInDirectRoom(String(thread.roomId || ""), viewerUserId)) {
    return true;
  }
  const participants = Array.isArray(thread.participantUserIds)
    ? thread.participantUserIds.map(normUserId)
    : [];
  return participants.includes(viewerUserId);
}

async function collectThreadRecordsForViewer(
  churchId: string,
  viewerUserId: string
) {
  const store = await readThreadStore();
  // Include soft-deleted threads here — enrichment decides whether a pending
  // request / newer message should surface them again in the inbox.
  const fromStore = Object.values(store).filter((thread) =>
    viewerIsThreadParticipant(thread, viewerUserId)
  );

  const knownRoomIds = new Set(
    fromStore.map((thread) => String(thread.roomId || "").trim()).filter(Boolean)
  );

  // Durable relationships are authoritative for cross-church discovery.
  // storageChurchId is metadata only — never an inbox membership filter.
  const relationships = await listDirectMessageRelationshipsForParticipant(
    viewerUserId
  ).catch(() => [] as DirectMessageRelationshipRecord[]);

  for (const rel of relationships) {
    const roomId = String(rel.roomId || "").trim();
    if (!roomId) continue;
    const participantA = normUserId(rel.participantA);
    const participantB = normUserId(rel.participantB);
    const viewerIsParticipant =
      participantA === viewerUserId || participantB === viewerUserId;
    if (!viewerIsParticipant) continue;
    // Always repair so soft-deleted / sparse thread blobs are refreshed from
    // the relationship — do not skip merely because a stale key exists.
    const repairChurchId = String(
      rel.storageChurchId || churchId || ""
    ).trim();
    if (!repairChurchId) continue;
    await ensureDirectMessageThreadFromRoomId({
      viewerUserId,
      churchId: repairChurchId,
      roomId,
      intent: "repair",
    });
    knownRoomIds.add(roomId);
  }

  const discoveredRoomIds = await discoverDirectRoomIdsFromMessages(
    churchId,
    viewerUserId
  );

  for (const roomId of discoveredRoomIds) {
    if (knownRoomIds.has(roomId)) continue;
    const existing = findThreadEntryByRoomId(store, roomId);
    const rel = await getDirectMessageRelationshipByRoomId(roomId).catch(
      () => null
    );
    const repairChurchId = String(
      rel?.storageChurchId ||
        existing?.record.churchId ||
        churchId ||
        ""
    ).trim();
    if (!repairChurchId) continue;
    await ensureDirectMessageThreadFromRoomId({
      viewerUserId,
      churchId: repairChurchId,
      roomId,
      intent: "repair",
    });
    knownRoomIds.add(roomId);
  }

  const refreshed = await readThreadStore();
  const byRoomId = new Map<string, DirectMessageThreadRecord>();

  for (const thread of Object.values(refreshed)) {
    if (!viewerIsThreadParticipant(thread, viewerUserId)) continue;
    const roomId = String(thread.roomId || "").trim();
    if (!roomId) continue;
    byRoomId.set(roomId, thread);
  }

  // Relationship-only rooms must still produce an inbox candidate even if the
  // thread store write failed — synthesize a minimal participant record.
  for (const rel of relationships) {
    const roomId = String(rel.roomId || "").trim();
    if (!roomId || byRoomId.has(roomId)) continue;
    const participantA = normUserId(rel.participantA);
    const participantB = normUserId(rel.participantB);
    if (
      participantA !== viewerUserId &&
      participantB !== viewerUserId
    ) {
      continue;
    }
    byRoomId.set(roomId, {
      roomId,
      churchId: String(rel.storageChurchId || churchId || "").trim(),
      participantUserIds: [participantA, participantB],
      createdAt: Number(rel.createdAt || Date.now()) || Date.now(),
      updatedAt: Number(rel.updatedAt || Date.now()) || Date.now(),
      readAtByUserId: {},
      requestStatus:
        rel.requestStatus === "pending" ||
        rel.requestStatus === "accepted" ||
        rel.requestStatus === "declined"
          ? rel.requestStatus
          : undefined,
      requestInitiatorUserId: rel.requestInitiatorUserId || undefined,
      sameChurchAtCreation: rel.sameChurchAtCreation === true,
      requestOutboundCountByUserId: rel.requestInitiatorUserId
        ? {
            [normUserId(rel.requestInitiatorUserId)]: Math.max(
              0,
              Number(rel.initiatorOutboundCount || 0) || 0
            ),
          }
        : {},
    });
  }

  return Array.from(byRoomId.values());
}

export async function listDirectMessageInbox(args: {
  churchId: string;
  viewerUserId: string;
}): Promise<DirectMessageInboxItem[]> {
  const headerChurchId = String(args.churchId || "").trim();
  const viewerUserId = normUserId(args.viewerUserId);

  // Viewer session church is only needed for same-church subtitle labels.
  // Inbox inclusion must not require churchId — participant identity is enough.
  if (!viewerUserId) {
    return [];
  }

  let threads: DirectMessageThreadRecord[] = [];

  try {
    threads = await collectThreadRecordsForViewer(
      headerChurchId,
      viewerUserId
    );
  } catch (error) {
    console.error("KRISTO_DM_INBOX_THREAD_COLLECTION_FAILED", {
      churchId: headerChurchId,
      viewerUserId,
      error: String((error as any)?.message || error),
    });
    return [];
  }

  const settledItems = await Promise.allSettled(
    threads.map(async (thread) => {
      const participants = Array.isArray(thread.participantUserIds)
        ? (thread.participantUserIds.map(normUserId) as [string, string])
        : (parseDirectRoomParticipants(thread.roomId) as
            | [string, string]
            | null);
      const participantA = String(participants?.[0] || "").trim();
      const participantB = String(participants?.[1] || "").trim();
      const viewerIsParticipant =
        participantA === viewerUserId || participantB === viewerUserId;

      const rel = await getDirectMessageRelationshipByRoomId(
        thread.roomId
      ).catch(() => null);

      const storageChurchId = String(
        rel?.storageChurchId || thread.churchId || headerChurchId || ""
      ).trim();

      if (!viewerIsParticipant) {
        console.log("KRISTO_DM_INBOX_ROOM_VISIBILITY", {
          roomId: thread.roomId,
          viewerUserId,
          participantA,
          participantB,
          viewerIsParticipant: false,
          relationshipStatus: rel?.requestStatus || "",
          requestInitiatorUserId: rel?.requestInitiatorUserId || "",
          storageChurchId,
          included: false,
          excludedReason: "viewer_not_participant",
          lastMessageId: "",
        });
        return null;
      }

      if (!participants) {
        console.log("KRISTO_DM_INBOX_ROOM_VISIBILITY", {
          roomId: thread.roomId,
          viewerUserId,
          participantA,
          participantB,
          viewerIsParticipant,
          relationshipStatus: rel?.requestStatus || "",
          requestInitiatorUserId: rel?.requestInitiatorUserId || "",
          storageChurchId,
          included: false,
          excludedReason: "invalid_participants",
          lastMessageId: "",
        });
        return null;
      }

      const peerUserId = peerUserIdFromParticipants(
        participants,
        viewerUserId
      );

      const profile = await getProfile(peerUserId).catch((error) => {
        console.warn("KRISTO_DM_INBOX_PROFILE_LOOKUP_FAILED", {
          roomId: thread.roomId,
          peerUserId,
          error: String((error as any)?.message || error),
        });
        return null;
      });

      const clearedAt = Number(
        thread.clearedAtByUserId?.[viewerUserId] || 0
      );
      const deletedAt = Number(
        thread.deletedAtByUserId?.[viewerUserId] || 0
      );

      // Message store is keyed by storageChurchId::roomId — never header church.
      const lastMessage = storageChurchId
        ? await lastMessageForThread(
            storageChurchId,
            thread.roomId,
            viewerUserId,
            clearedAt
          )
        : null;

      const shareActiveChurch = Boolean(
        await usersShareActiveChurch(viewerUserId, peerUserId).catch(
          () => null
        )
      );
      const merged = mergeRelationshipIntoRecord(thread, rel);
      const relationshipStatus = resolveDmRelationshipStatus({
        record: merged,
        viewerUserId,
        peerUserId,
        shareActiveChurch,
      });
      const requestInitiatorUserId = normUserId(
        merged.requestInitiatorUserId || ""
      );
      const isPendingRequest = relationshipStatus === "request_pending";
      const isRequestInitiator =
        isPendingRequest &&
        Boolean(requestInitiatorUserId) &&
        requestInitiatorUserId === viewerUserId;
      const isRequestReceiver =
        isPendingRequest &&
        Boolean(requestInitiatorUserId) &&
        requestInitiatorUserId !== viewerUserId;

      const hasPersistedMessage = Boolean(lastMessage);
      const isListableRelationship =
        relationshipStatus === "request_pending" ||
        relationshipStatus === "accepted" ||
        relationshipStatus === "declined";

      // Inclusion: participant + (message OR pending/accepted/declined).
      // Never hide pending because preview/church/thread metadata is sparse.
      const shouldInclude =
        viewerIsParticipant &&
        (hasPersistedMessage || isListableRelationship);

      if (!shouldInclude) {
        const excludedReason = !hasPersistedMessage
          ? "no_listable_activity"
          : "not_included";
        console.log("KRISTO_DM_INBOX_ITEM_BUILT", {
          viewerUserId,
          roomId: thread.roomId,
          relationshipStatus,
          isRequestReceiver,
          hasLastMessage: hasPersistedMessage,
          included: false,
          excludedReason,
        });
        console.log("KRISTO_DM_INBOX_ROOM_VISIBILITY", {
          roomId: thread.roomId,
          viewerUserId,
          participantA,
          participantB,
          viewerIsParticipant,
          relationshipStatus,
          requestInitiatorUserId,
          storageChurchId,
          included: false,
          excludedReason,
          lastMessageId: "",
        });
        return null;
      }

      // Soft-delete only hides non-request rows with no newer activity.
      // Pending/accepted/declined must remain listable for the receiver.
      if (
        deletedAt > 0 &&
        !isListableRelationship &&
        (!lastMessage || Number(lastMessage.timestampMs || 0) <= deletedAt)
      ) {
        console.log("KRISTO_DM_INBOX_ITEM_BUILT", {
          viewerUserId,
          roomId: thread.roomId,
          relationshipStatus,
          isRequestReceiver,
          hasLastMessage: hasPersistedMessage,
          included: false,
          excludedReason: "deleted_for_viewer",
        });
        console.log("KRISTO_DM_INBOX_ROOM_VISIBILITY", {
          roomId: thread.roomId,
          viewerUserId,
          participantA,
          participantB,
          viewerIsParticipant,
          relationshipStatus,
          requestInitiatorUserId,
          storageChurchId,
          included: false,
          excludedReason: "deleted_for_viewer",
          lastMessageId: "",
        });
        return null;
      }

      const readAt = Math.max(
        Number(thread.readAtByUserId?.[viewerUserId] || 0),
        clearedAt
      );

      const unreadCount = storageChurchId
        ? await unreadCountForThread({
            churchId: storageChurchId,
            roomId: thread.roomId,
            viewerUserId,
            readAt,
          })
        : 0;

      const timestampMs = Number(
        lastMessage?.timestampMs ||
          thread.updatedAt ||
          thread.createdAt ||
          0
      );

      const storageChurch = storageChurchId
        ? await getChurchById(storageChurchId).catch(() => null)
        : null;

      const peerName = pickDisplayName(profile);
      const previewText = String(
        lastMessage?.preview ||
          (isRequestReceiver || isPendingRequest
            ? "Message request"
            : "No messages yet")
      );

      const item = {
        roomId: thread.roomId,
        churchId: storageChurchId || headerChurchId,
        peerUserId,
        peerName,
        title: peerName,
        subtitle: isRequestReceiver
          ? "Message request"
          : String(
              storageChurch?.name || "Direct message"
            ).trim(),
        avatarUri: pickAvatar(profile),
        lastMessagePreview: previewText,
        lastMessageText: previewText,
        timestampLabel: formatTimestampLabel(timestampMs),
        timestampMs,
        unreadCount,
        relationshipStatus,
        requestInitiatorUserId,
        isRequestInitiator,
        isRequestReceiver,
      } satisfies DirectMessageInboxItem;

      console.log("KRISTO_DM_INBOX_ITEM_BUILT", {
        viewerUserId,
        roomId: thread.roomId,
        relationshipStatus,
        isRequestReceiver,
        hasLastMessage: hasPersistedMessage,
        included: true,
        excludedReason: "",
      });
      console.log("KRISTO_DM_INBOX_ROOM_VISIBILITY", {
        roomId: thread.roomId,
        viewerUserId,
        participantA,
        participantB,
        viewerIsParticipant,
        relationshipStatus,
        requestInitiatorUserId,
        storageChurchId,
        included: true,
        excludedReason: "",
        lastMessageId: "",
        lastMessagePreviewPresent: Boolean(lastMessage?.preview),
        unreadCount,
      });

      return item;
    })
  );

  const items: DirectMessageInboxItem[] = [];

  settledItems.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value) items.push(result.value);
      return;
    }

    const thread = threads[index];
    console.error("KRISTO_DM_INBOX_THREAD_ENRICHMENT_FAILED", {
      churchId: headerChurchId,
      viewerUserId,
      roomId: String(thread?.roomId || ""),
      error: String((result.reason as any)?.message || result.reason),
    });
  });

  return items.sort(
    (a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0)
  );
}
