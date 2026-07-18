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
  DM_REQUEST_MESSAGE_LIMIT_REACHED,
  DM_REQUEST_OUTGOING_MESSAGE_LIMIT,
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
  outgoingMessageCount: number;
  outgoingMessageLimit: number;
  remainingMessages: number;
  canSend: boolean;
  isRequestInitiator: boolean;
  canAcceptDecline: boolean;
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
  title: string;
  subtitle: string;
  avatarUri: string;
  lastMessagePreview: string;
  timestampLabel: string;
  timestampMs: number;
  unreadCount: number;
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
  return {
    ...record,
    churchId: overlay.churchId || record.churchId,
    requestStatus: overlay.requestStatus,
    requestInitiatorUserId: overlay.requestInitiatorUserId,
    sameChurchAtCreation: overlay.sameChurchAtCreation,
    requestOutboundCountByUserId: overlay.requestOutboundCountByUserId,
    acceptedAt: overlay.acceptedAt,
    declinedAt: overlay.declinedAt,
  };
}

async function ensureDurableRelationship(args: {
  roomId: string;
  storageChurchId: string;
  participantUserIds: [string, string];
  viewerUserId: string;
  sameChurch: boolean;
}): Promise<DirectMessageRelationshipRecord> {
  const existing = await getDirectMessageRelationshipByRoomId(args.roomId);
  if (existing) return existing;

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

async function writeThreadStore(data: Record<string, DirectMessageThreadRecord>) {
  await updateDirectMessageThreadStore(() => data, {});
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
      viewerUserId:
        normUserId(existingRecord.createdByUserId || "") || viewerUserId,
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
    store[existingEntry.key] = existingRecord;
    await writeThreadStore(store);
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
    store[key] = {
      roomId: canonicalRoomId,
      churchId,
      participantUserIds: participants,
      createdAt: existingRel.createdAt || now,
      updatedAt: now,
      readAtByUserId: {},
      createdByUserId: viewerUserId,
      sameChurchAtCreation: existingRel.sameChurchAtCreation,
    };
    await writeThreadStore(store);
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
  store[key] = record;
  await writeThreadStore(store);

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
    const existingRel = await getDirectMessageRelationshipByRoomId(roomId);
    return buildThreadView({
      roomId,
      churchId: String(
        existingRel?.storageChurchId || record.churchId || requestedChurchId || "dm"
      ),
      peerUserId: targetUserId,
    });
  }

  const existingRel = await getDirectMessageRelationshipByRoomId(roomId);
  if (existingRel) {
    // Recreate metadata row under the durable storage church.
    const ensuredExisting = await ensureDirectMessageThreadFromRoomId({
      viewerUserId,
      churchId: String(
        existingRel.storageChurchId || requestedChurchId || "dm"
      ),
      roomId,
      intent: "repair",
    });
    if (ensuredExisting) return ensuredExisting;
  }

  const sharedChurchId = await usersShareActiveChurch(
    viewerUserId,
    targetUserId
  );
  const viewerActive = await getActiveMembership(viewerUserId).catch(() => null);
  const storageChurchId = String(
    sharedChurchId ||
      requestedChurchId ||
      viewerActive?.churchId ||
      "dm"
  ).trim();

  const ensured = await ensureDirectMessageThreadFromRoomId({
    viewerUserId,
    churchId: storageChurchId,
    roomId,
    intent: "create",
  });
  if (!ensured) {
    throw new Error("Target user not found.");
  }

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
  store[key] = record;
  await writeThreadStore(store);
  return true;
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

  const store = await readThreadStore();
  const found = findThreadEntryByRoomId(store, roomId);
  const baseRecord = found?.record as DirectMessageThreadRecord | undefined;
  if (!baseRecord) return null;

  const rel = await getDirectMessageRelationshipByRoomId(roomId);
  const record = mergeRelationshipIntoRecord(baseRecord, rel);
  const churchId = String(
    record.churchId || requestedChurchId || ""
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
  const isRequestInitiator =
    normUserId(record.requestInitiatorUserId || "") === userId;
  const quotaSenderUserId =
    relationshipStatus === "request_pending"
      ? normUserId(record.requestInitiatorUserId || "") || userId
      : userId;
  const quota = buildDmRequestQuota({
    relationshipStatus,
    record,
    senderUserId: quotaSenderUserId,
  });
  const canAcceptDecline =
    relationshipStatus === "request_pending" &&
    !isRequestInitiator &&
    !blockedByMe &&
    !blockedByPeer;
  // Viewer-specific sendability: initiator uses quota; recipient can reply
  // without consuming the initiator's 7-message allowance.
  const viewerCanSend =
    relationshipStatus === "same_church" ||
    relationshipStatus === "accepted" ||
    (relationshipStatus === "request_pending" &&
      (isRequestInitiator ? quota.canSend : true));

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
    outgoingMessageCount: quota.outgoingMessageCount,
    outgoingMessageLimit: quota.outgoingMessageLimit,
    remainingMessages: isRequestInitiator
      ? quota.remainingMessages
      : relationshipStatus === "request_pending"
        ? quota.outgoingMessageLimit
        : quota.remainingMessages,
    canSend:
      relationshipStatus === "blocked" ||
      relationshipStatus === "declined"
        ? false
        : viewerCanSend,
    isRequestInitiator,
    canAcceptDecline,
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
    | "decline";
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
          "This message request was declined. The recipient must accept before you can continue.",
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

  // request_pending: only the initiator consumes the 7-message quota.
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
    limit: DM_REQUEST_OUTGOING_MESSAGE_LIMIT,
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
      outgoingMessageLimit: DM_REQUEST_OUTGOING_MESSAGE_LIMIT,
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
  store[key] = record;
  await writeThreadStore(store);
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

async function collectThreadRecordsForViewer(churchId: string, viewerUserId: string) {
  const store = await readThreadStore();
  const fromStore = Object.values(store).filter(
    (thread) =>
      Array.isArray(thread?.participantUserIds) &&
      thread.participantUserIds.includes(viewerUserId) &&
      !Number(thread?.deletedAtByUserId?.[viewerUserId] || 0)
  );

  const discoveredRoomIds = await discoverDirectRoomIdsFromMessages(
    churchId,
    viewerUserId
  );
  const knownRoomIds = new Set(fromStore.map((thread) => thread.roomId));

  for (const roomId of discoveredRoomIds) {
    if (knownRoomIds.has(roomId)) continue;
    const existing = findThreadEntryByRoomId(store, roomId);
    const repairChurchId = String(
      existing?.record.churchId || churchId || ""
    ).trim();
    if (!repairChurchId) continue;
    await ensureDirectMessageThreadFromRoomId({
      viewerUserId,
      churchId: repairChurchId,
      roomId,
    });
  }

  const refreshed = await readThreadStore();
  return Object.values(refreshed).filter(
    (thread) =>
      Array.isArray(thread?.participantUserIds) &&
      thread.participantUserIds.includes(viewerUserId) &&
      !Number(thread?.deletedAtByUserId?.[viewerUserId] || 0)
  );
}

export async function listDirectMessageInbox(args: {
  churchId: string;
  viewerUserId: string;
}): Promise<DirectMessageInboxItem[]> {
  const churchId =
    String(args.churchId || "").trim();

  const viewerUserId =
    normUserId(args.viewerUserId);

  if (!churchId || !viewerUserId) {
    return [];
  }

  let threads: DirectMessageThreadRecord[] = [];

  try {
    threads =
      await collectThreadRecordsForViewer(
        churchId,
        viewerUserId
      );
  } catch (error) {
    console.error(
      "KRISTO_DM_INBOX_THREAD_COLLECTION_FAILED",
      {
        churchId,
        viewerUserId,
        error:
          String(
            (error as any)?.message ||
            error
          ),
      }
    );

    return [];
  }

  const church =
    await getChurchById(churchId)
      .catch((error) => {
        console.warn(
          "KRISTO_DM_INBOX_CHURCH_LOOKUP_FAILED",
          {
            churchId,
            error:
              String(
                (error as any)?.message ||
                error
              ),
          }
        );

        return null;
      });

  const settledItems =
    await Promise.allSettled(
      threads.map(async (thread) => {
        const peerUserId =
          peerUserIdFromParticipants(
            thread.participantUserIds,
            viewerUserId
          );

        const profile =
          await getProfile(peerUserId)
            .catch((error) => {
              console.warn(
                "KRISTO_DM_INBOX_PROFILE_LOOKUP_FAILED",
                {
                  roomId:
                    thread.roomId,
                  peerUserId,
                  error:
                    String(
                      (error as any)?.message ||
                      error
                    ),
                }
              );

              return null;
            });

        const clearedAt =
          Number(
            thread
              .clearedAtByUserId
              ?.[viewerUserId] || 0
          );

        const deletedAt =
          Number(
            thread
              .deletedAtByUserId
              ?.[viewerUserId] || 0
          );

        const lastMessage =
          await lastMessageForThread(
            churchId,
            thread.roomId,
            viewerUserId,
            clearedAt
          );

        if (!lastMessage) {
          return null;
        }

        if (
          deletedAt > 0 &&
          Number(
            lastMessage.timestampMs || 0
          ) <= deletedAt
        ) {
          return null;
        }

        const readAt =
          Math.max(
            Number(
              thread
                .readAtByUserId
                ?.[viewerUserId] || 0
            ),
            clearedAt
          );

        const unreadCount =
          await unreadCountForThread({
            churchId,
            roomId:
              thread.roomId,
            viewerUserId,
            readAt,
          });

        const timestampMs =
          Number(
            lastMessage.timestampMs ||
            thread.updatedAt ||
            thread.createdAt ||
            0
          );

        return {
          roomId:
            thread.roomId,
          churchId,
          peerUserId,
          title:
            pickDisplayName(profile),
          subtitle:
            String(
              church?.name ||
              "Direct message"
            ).trim(),
          avatarUri:
            pickAvatar(profile),
          lastMessagePreview:
            String(
              lastMessage.preview ||
              "No messages yet"
            ),
          timestampLabel:
            formatTimestampLabel(
              timestampMs
            ),
          timestampMs,
          unreadCount,
        } satisfies DirectMessageInboxItem;
      })
    );

  const items:
    DirectMessageInboxItem[] = [];

  settledItems.forEach(
    (result, index) => {
      if (
        result.status === "fulfilled"
      ) {
        if (result.value) {
          items.push(result.value);
        }

        return;
      }

      const thread =
        threads[index];

      console.error(
        "KRISTO_DM_INBOX_THREAD_ENRICHMENT_FAILED",
        {
          churchId,
          viewerUserId,
          roomId:
            String(
              thread?.roomId || ""
            ),
          error:
            String(
              (result.reason as any)
                ?.message ||
              result.reason
            ),
        }
      );
    }
  );

  return items.sort(
    (a, b) =>
      Number(b.timestampMs || 0) -
      Number(a.timestampMs || 0)
  );
}
