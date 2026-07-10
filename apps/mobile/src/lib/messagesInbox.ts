import { fetchDirectMessageInbox } from "@/src/lib/directMessagesApi";
import {
  fetchPrivateCallHistory,
  type PrivateCallSession,
} from "@/src/lib/privateCallService";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export type MessagesInboxConversation = {
  id: string;
  title: string;
  subtitle: string;
  avatarUri: string;
  lastMessagePreview: string;
  timestampLabel: string;
  timestampMs: number;
  unreadCount: number;
  peerUserId: string;
  churchId: string;
  roomKind: "direct";
};

function currentUserId(): string {
  const headers = getKristoHeaders() as Record<string, string>;

  return String(
    headers?.["x-kristo-user-id"] ||
      headers?.["X-Kristo-User-Id"] ||
      ""
  ).trim();
}

function formatInboxTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";

  const d = new Date(timestampMs);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  if (isYesterday) return "Yesterday";

  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function callPeerUserId(
  call: PrivateCallSession,
  viewerUserId: string
): string {
  const callerUserId = String(call.callerUserId || "").trim();
  const pastorUserId = String(call.pastorUserId || "").trim();

  if (callerUserId === viewerUserId) return pastorUserId;
  if (pastorUserId === viewerUserId) return callerUserId;

  return "";
}

function callPreview(
  call: PrivateCallSession,
  viewerUserId: string
): string {
  const callerUserId = String(call.callerUserId || "").trim();
  const pastorUserId = String(call.pastorUserId || "").trim();
  const status = String(call.status || "").trim();

  const outgoing = callerUserId === viewerUserId;
  const incoming = pastorUserId === viewerUserId;

  if (
    incoming &&
    (status === "timeout" ||
      status === "failed" ||
      status === "declined")
  ) {
    return "↙ Missed voice call";
  }

  if (outgoing) {
    return "↗ Outgoing voice call";
  }

  if (incoming) {
    return "↙ Incoming voice call";
  }

  return "Voice call";
}

function callTimestampMs(call: PrivateCallSession): number {
  const value =
    call.endedAt ||
    call.updatedAt ||
    call.createdAt;

  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * V1 person-to-person Messages inbox.
 *
 * Direct-message threads remain the source of conversation rows.
 * Private call history may replace the visible preview and timestamp
 * when the newest call activity is newer than the newest DM activity.
 */
export async function fetchMessagesInboxConversations(_args: {
  base: string;
}): Promise<MessagesInboxConversation[]> {
  const [dmRows, calls] = await Promise.all([
    fetchDirectMessageInbox(),
    fetchPrivateCallHistory().catch(() => []),
  ]);

  const viewerUserId = currentUserId();

  const latestCallByPeer = new Map<
    string,
    PrivateCallSession
  >();

  for (const call of calls) {
    const peerUserId = callPeerUserId(
      call,
      viewerUserId
    );

    if (!peerUserId) continue;

    const existing = latestCallByPeer.get(peerUserId);

    if (
      !existing ||
      callTimestampMs(call) >
        callTimestampMs(existing)
    ) {
      latestCallByPeer.set(peerUserId, call);
    }
  }

  return dmRows
    .filter((row) => row.roomId && row.peerUserId)
    .map((row) => {
      const call = latestCallByPeer.get(
        String(row.peerUserId || "").trim()
      );

      const dmTimestampMs = Number(row.timestampMs || 0);
      const callMs = call ? callTimestampMs(call) : 0;

      const callIsNewest =
        Boolean(call) && callMs > dmTimestampMs;

      return {
        id: row.roomId,
        title: row.title,
        subtitle: row.subtitle,
        avatarUri: row.avatarUri,
        lastMessagePreview:
          callIsNewest && call
            ? callPreview(call, viewerUserId)
            : row.lastMessagePreview,
        timestampLabel:
          callIsNewest
            ? formatInboxTimestamp(callMs)
            : row.timestampLabel,
        timestampMs:
          callIsNewest
            ? callMs
            : dmTimestampMs,
        unreadCount: row.unreadCount,
        peerUserId: row.peerUserId,
        churchId: row.churchId,
        roomKind: "direct" as const,
      };
    })
    .sort(
      (a, b) =>
        Number(b.timestampMs || 0) -
        Number(a.timestampMs || 0)
    );
}
