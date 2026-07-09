import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

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
  lastMessagePreview: string;
  timestampLabel: string;
  timestampMs: number;
  unreadCount: number;
};

function authHeaders() {
  return getKristoHeaders();
}

export async function fetchDirectMessageInbox(): Promise<DirectMessageInboxRow[]> {
  const res: any = await apiGet("/api/church/direct-messages", { headers: authHeaders() });
  if (!res?.ok) {
    throw new Error(String(res?.error || "Could not load conversations."));
  }
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows.map((row: any) => ({
    roomId: String(row?.roomId || ""),
    churchId: String(row?.churchId || ""),
    peerUserId: String(row?.peerUserId || ""),
    title: String(row?.title || "Member"),
    subtitle: String(row?.subtitle || "Direct message"),
    avatarUri: String(row?.avatarUri || row?.avatarUrl || ""),
    lastMessagePreview: String(row?.lastMessagePreview || "No messages yet"),
    timestampLabel: String(row?.timestampLabel || ""),
    timestampMs: Number(row?.timestampMs || 0),
    unreadCount: Math.max(0, Number(row?.unreadCount || 0)),
  }));
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

export async function markDirectMessageThreadRead(args: {
  roomId: string;
  churchId?: string;
}) {
  const roomId = String(args.roomId || "").trim();
  const churchId = String(args.churchId || "").trim();
  if (!roomId) return;

  await apiPatch(
    "/api/church/direct-messages",
    {
      action: "read",
      roomId,
      ...(churchId ? { churchId } : {}),
    },
    { headers: authHeaders() }
  ).catch(() => null);
}
