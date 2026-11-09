import { fetchDirectMessageInbox } from "@/src/lib/directMessagesApi";
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
  relationshipStatus?: string;
  isRequestReceiver?: boolean;
  isRequestInitiator?: boolean;
};

/** What the server shows for a conversation that has no message yet. */
const NO_MESSAGE_PREVIEWS = new Set(["Message request", "No messages yet"]);

function currentUserId(): string {
  const headers = getKristoHeaders() as Record<string, string>;

  return String(
    headers?.["x-kristo-user-id"] ||
      headers?.["X-Kristo-User-Id"] ||
      ""
  ).trim();
}

/**
 * Newest last message first. A conversation without any message yet goes below every
 * conversation that has one (its time is only when the thread was opened or changed).
 */
export function compareInboxConversationsByLastMessage(
  a: { lastMessageMs: number; timestampMs: number; title: string },
  b: { lastMessageMs: number; timestampMs: number; title: string }
): number {
  return (
    b.lastMessageMs - a.lastMessageMs ||
    b.timestampMs - a.timestampMs ||
    a.title.localeCompare(b.title)
  );
}

/**
 * V1 person-to-person Messages inbox, the same for every role: direct-message threads, ordered
 * by the time of their last message (calls are listed in Calls, not here).
 * Pending message requests are never filtered out locally.
 */
export async function fetchMessagesInboxConversations(_args: {
  base: string;
}): Promise<MessagesInboxConversation[]> {
  const dmRows = await fetchDirectMessageInbox();

  const viewerUserId = currentUserId();

  console.log("KRISTO_DM_INBOX_API_ROWS", {
    viewerUserId,
    totalRows: dmRows.length,
    roomIds: dmRows.map((row) => row.roomId).filter(Boolean),
    pendingRequestRows: dmRows.filter(
      (row) =>
        row.relationshipStatus === "request_pending" ||
        row.isRequestReceiver === true
    ).length,
  });

  const beforeCount = dmRows.length;
  // Keep every API row that has a room identity. Pending requests may arrive
  // with a peerUserId even when preview metadata is sparse — never drop them.
  const kept = dmRows.filter((row) => {
    if (!row.roomId) return false;
    if (row.peerUserId) return true;
    return (
      row.relationshipStatus === "request_pending" ||
      row.isRequestReceiver === true ||
      row.isRequestInitiator === true
    );
  });
  const keptIds = new Set(kept.map((row) => row.roomId));
  const removedRoomIds = dmRows
    .map((row) => row.roomId)
    .filter((roomId) => roomId && !keptIds.has(roomId));

  console.log("KRISTO_DM_INBOX_VISIBLE_ROWS", {
    beforeCount,
    afterCount: kept.length,
    removedRoomIds,
  });

  return kept
    .map((row) => {
      const isRequestReceiver = row.isRequestReceiver === true;
      const timestampMs = Number(row.timestampMs || 0) || 0;
      const previewFromApi = String(
        row.lastMessageText ||
          row.lastMessagePreview ||
          ""
      ).trim();

      return {
        conversation: {
          id: row.roomId,
          title: String(row.peerName || row.title || "Member"),
          subtitle: isRequestReceiver
            ? "Message request"
            : String(row.subtitle || "Direct message"),
          avatarUri: row.avatarUri,
          lastMessagePreview:
            previewFromApi ||
            (isRequestReceiver ? "Message request" : "No messages yet"),
          timestampLabel: row.timestampLabel,
          timestampMs,
          unreadCount: row.unreadCount,
          peerUserId: row.peerUserId,
          churchId: row.churchId,
          roomKind: "direct" as const,
          relationshipStatus: row.relationshipStatus,
          isRequestReceiver,
          isRequestInitiator: row.isRequestInitiator === true,
        },
        // The server's time is the last message's when there is one.
        lastMessageMs: previewFromApi && !NO_MESSAGE_PREVIEWS.has(previewFromApi) ? timestampMs : 0,
      };
    })
    .sort((a, b) =>
      compareInboxConversationsByLastMessage(
        { lastMessageMs: a.lastMessageMs, timestampMs: a.conversation.timestampMs, title: a.conversation.title },
        { lastMessageMs: b.lastMessageMs, timestampMs: b.conversation.timestampMs, title: b.conversation.title }
      )
    )
    .map((entry) => entry.conversation);
}
