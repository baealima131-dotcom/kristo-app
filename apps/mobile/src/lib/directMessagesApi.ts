import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { normalizePersonRingCategory, type PersonRingCategory } from "@/src/components/PersonAvatarRing";

export type DirectMessagePeerPreview = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  kristoId: string;
  churchId: string;
  churchName: string;
};

export type DirectMessageThread = {
  roomId: string;
  churchId: string;
  peerUserId: string;
  title: string;
  subtitle: string;
  avatarUri: string;
};

export type DirectMessageInboxRow = DirectMessageThread & {
  peerName?: string;
  lastMessagePreview: string;
  lastMessageText?: string;
  timestampLabel: string;
  timestampMs: number;
  unreadCount: number;
  relationshipStatus?: string;
  requestInitiatorUserId?: string;
  isRequestInitiator?: boolean;
  isRequestReceiver?: boolean;
  /** Receipt state of the latest message when the viewer sent it (newer servers). */
  lastMessageFromViewer?: boolean;
  lastMessageAt?: number;
  peerDeliveredAt?: number;
  peerReadAt?: number;
  showReadReceipts?: boolean;
  /** Verified avatar-ring category of the peer (newer servers; "unknown" otherwise). */
  peerRingCategory?: PersonRingCategory;
};

function authHeaders() {
  return getKristoHeaders();
}

export async function fetchDirectMessageInbox(): Promise<DirectMessageInboxRow[]> {
  const headers = authHeaders() as Record<string, string>;
  const viewerUserId = String(
    headers?.["x-kristo-user-id"] || headers?.["X-Kristo-User-Id"] || ""
  ).trim();
  const res: any = await apiGet("/api/church/direct-messages", { headers });
  if (!res?.ok) {
    throw new Error(String(res?.error || "Could not load conversations."));
  }
  const rows = Array.isArray(res?.data) ? res.data : [];
  const mapped = rows.map((row: any) => {
    const isRequestReceiver = row?.isRequestReceiver === true;
    const preview = String(
      row?.lastMessageText ||
        row?.lastMessagePreview ||
        (isRequestReceiver ? "Message request" : "No messages yet")
    );
    const peerName = String(
      row?.peerName || row?.title || "Member"
    );
    return {
      roomId: String(row?.roomId || ""),
      churchId: String(row?.churchId || ""),
      peerUserId: String(row?.peerUserId || ""),
      peerName,
      title: peerName,
      subtitle: isRequestReceiver
        ? "Message request"
        : String(row?.subtitle || "Direct message"),
      avatarUri: String(row?.avatarUri || row?.avatarUrl || ""),
      lastMessagePreview: preview,
      lastMessageText: preview,
      timestampLabel: String(row?.timestampLabel || ""),
      timestampMs: Number(row?.timestampMs || 0),
      unreadCount: Math.max(0, Number(row?.unreadCount || 0)),
      relationshipStatus: String(row?.relationshipStatus || ""),
      requestInitiatorUserId: String(row?.requestInitiatorUserId || ""),
      isRequestInitiator: row?.isRequestInitiator === true,
      isRequestReceiver,
      lastMessageFromViewer: row?.lastMessageFromViewer === true,
      lastMessageAt: Number(row?.lastMessageAt || 0) || 0,
      peerDeliveredAt: Number(row?.peerDeliveredAt || 0) || 0,
      peerReadAt: Number(row?.peerReadAt || 0) || 0,
      showReadReceipts: row?.showReadReceipts === true,
      peerRingCategory: normalizePersonRingCategory(row?.peerRingCategory),
    };
  });
  console.log("KRISTO_DM_INBOX_RESPONSE", {
    viewerUserId,
    conversationCount: mapped.length,
    roomIds: mapped.map((row: DirectMessageInboxRow) => row.roomId).filter(Boolean),
    pendingRequestCount: mapped.filter(
      (row: DirectMessageInboxRow) =>
        row.relationshipStatus === "request_pending" ||
        row.isRequestReceiver === true
    ).length,
  });
  console.log("KRISTO_DM_INBOX_API_ROWS", {
    viewerUserId,
    totalRows: mapped.length,
    roomIds: mapped.map((row: DirectMessageInboxRow) => row.roomId).filter(Boolean),
    pendingRequestRows: mapped.filter(
      (row: DirectMessageInboxRow) =>
        row.relationshipStatus === "request_pending" ||
        row.isRequestReceiver === true
    ).length,
  });
  return mapped;
}

export async function resolveDirectMessagePeer(args: {
  kristoId: string;
  churchId: string;
}): Promise<DirectMessagePeerPreview> {
  const kristoId = String(args.kristoId || "").trim().toUpperCase();
  const churchId = String(args.churchId || "").trim();
  const query = new URLSearchParams({
    action: "resolve",
    kristoId,
    churchId,
  });

  const res: any = await apiGet(`/api/church/direct-messages?${query.toString()}`, {
    headers: authHeaders(),
  });

  if (!res?.ok || !res?.data) {
    throw new Error(
      String(res?.error || "We could not find an active member with that Kristo ID in that church.")
    );
  }

  const row = res.data;
  return {
    userId: String(row?.userId || ""),
    displayName: String(row?.displayName || "Member"),
    avatarUrl: String(row?.avatarUrl || row?.avatarUri || ""),
    kristoId: String(row?.kristoId || kristoId),
    churchId: String(row?.churchId || churchId),
    churchName: String(row?.churchName || "Church"),
  };
}

export async function openDirectMessageThread(args: {
  targetUserId: string;
  churchId?: string;
}): Promise<DirectMessageThread> {
  const targetUserId = String(args.targetUserId || "").trim();
  const churchId = String(args.churchId || "").trim();

  const res: any = await apiPost(
    "/api/church/direct-messages",
    {
      targetUserId,
      ...(churchId ? { churchId } : {}),
    },
    { headers: authHeaders() }
  );

  if (!res?.ok || !res?.data) {
    throw new Error(String(res?.error || "Could not start chat."));
  }

  const row = res.data;
  return {
    roomId: String(row?.roomId || ""),
    churchId: String(row?.churchId || churchId),
    peerUserId: String(row?.peerUserId || targetUserId),
    title: String(row?.title || "Member"),
    subtitle: String(row?.subtitle || "Direct message"),
    avatarUri: String(row?.avatarUri || row?.avatarUrl || ""),
  };
}

export async function ensureDirectMessageThreadFromRoomId(args: {
  roomId: string;
  churchId?: string;
}): Promise<DirectMessageThread | null> {
  const roomId = String(args.roomId || "").trim();
  const churchId = String(args.churchId || "").trim();
  if (!roomId) return null;

  const res: any = await apiPost(
    "/api/church/direct-messages",
    {
      action: "ensure",
      roomId,
      ...(churchId ? { churchId } : {}),
    },
    { headers: authHeaders() }
  );

  if (!res?.ok || !res?.data) {
    if (__DEV__) {
      console.warn("KRISTO_DM_ENSURE_FAILED", {
        roomId,
        churchId,
        error: String(res?.error || "ensure failed"),
      });
    }
    return null;
  }

  const row = res.data;
  return {
    roomId: String(row?.roomId || roomId),
    churchId: String(row?.churchId || churchId),
    peerUserId: String(row?.peerUserId || ""),
    title: String(row?.title || "Member"),
    subtitle: String(row?.subtitle || "Direct message"),
    avatarUri: String(row?.avatarUri || row?.avatarUrl || ""),
  };
}

export async function markDirectMessageThreadRead(args: {
  roomId: string;
  churchId?: string;
}) {
  const roomId = String(args.roomId || "").trim();
  const churchId = String(args.churchId || "").trim();
  if (!roomId) return;

  const ensured = await ensureDirectMessageThreadFromRoomId({ roomId, churchId });
  if (!ensured) return;

  await apiPatch(
    "/api/church/direct-messages",
    {
      action: "read",
      roomId: ensured.roomId,
      ...(ensured.churchId ? { churchId: ensured.churchId } : churchId ? { churchId } : {}),
    },
    { headers: authHeaders() }
  ).catch(() => null);
}

export type DmRelationshipStatus =
  | "same_church"
  | "request_pending"
  | "accepted"
  | "declined"
  | "blocked";

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
  relationshipStatus?: DmRelationshipStatus;
  requestInitiatorUserId?: string;
  outgoingMessageCount?: number;
  outgoingMessageLimit?: number;
  remainingMessages?: number;
  canSend?: boolean;
  isRequestInitiator?: boolean;
  isRequestReceiver?: boolean;
  canAcceptDecline?: boolean;
  canRestartRequest?: boolean;
  viewerChurchId?: string;
  peerChurchId?: string;
  sharesActiveChurch?: boolean;
  peerChurchName?: string;
  peerChurchRole?: string;
  peerReadAt?: number;
  /** The viewer's messages with createdAt <= this reached the peer's device (newer servers). */
  peerDeliveredAt?: number;
  showReadReceipts?: boolean;
};

/** Canonical cross-church DM request outbound limit (must match backend). */
export const DM_REQUEST_MESSAGE_LIMIT = 5;

export async function fetchDirectMessageConversationSettings(
  args: {
    roomId: string;
    churchId?: string;
  }
): Promise<DirectMessageConversationSettings> {
  const roomId = String(args.roomId || "").trim();
  const churchId = String(args.churchId || "").trim();

  const query = new URLSearchParams({
    action: "settings",
    roomId,
    ...(churchId ? { churchId } : {}),
  });

  const res: any = await apiGet(
    `/api/church/direct-messages?${query.toString()}`,
    { headers: authHeaders() }
  );

  if (!res?.ok || !res?.data) {
    throw new Error(
      String(res?.error || "Could not load conversation settings.")
    );
  }

  return res.data as DirectMessageConversationSettings;
}

export async function updateDirectMessageConversationSetting(
  args: {
    roomId: string;
    churchId?: string;
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
  }
): Promise<DirectMessageConversationSettings> {
  const res: any = await apiPatch(
    "/api/church/direct-messages",
    {
      roomId: String(args.roomId || "").trim(),
      ...(args.churchId
        ? { churchId: String(args.churchId).trim() }
        : {}),
      action: args.action,
    },
    { headers: authHeaders() }
  );

  if (!res?.ok || !res?.data) {
    throw new Error(
      String(res?.error || "Could not update conversation.")
    );
  }

  return res.data as DirectMessageConversationSettings;
}

export async function reportDirectMessageConversation(args: {
  roomId: string;
  churchId?: string;
  reason: string;
  details?: string;
}) {
  const res: any = await apiPatch(
    "/api/church/direct-messages",
    {
      roomId: String(args.roomId || "").trim(),
      ...(args.churchId
        ? { churchId: String(args.churchId).trim() }
        : {}),
      action: "report",
      reason: String(args.reason || "").trim(),
      details: String(args.details || "").trim(),
    },
    { headers: authHeaders() }
  );

  if (!res?.ok) {
    throw new Error(
      String(res?.error || "Could not report this user.")
    );
  }

  const reportCode =
    String(
      res?.report?.reportCode || ""
    )
      .trim()
      .toUpperCase();

  if (!reportCode) {
    throw new Error(
      "The report was submitted, but its Report Command Code was not returned."
    );
  }

  return {
    id:
      String(
        res?.report?.id || ""
      ).trim(),

    reportCode,

    status:
      String(
        res?.report?.status ||
          "open"
      ).trim(),

    createdAt:
      String(
        res?.report?.createdAt || ""
      ).trim(),
  };
}

