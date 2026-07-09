import { fetchDirectMessageInbox } from "@/src/lib/directMessagesApi";

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

/**
 * V1 person-to-person Messages inbox.
 * Ministry and assignment threads are intentionally excluded here.
 */
export async function fetchMessagesInboxConversations(_args: {
  base: string;
}): Promise<MessagesInboxConversation[]> {
  const rows = await fetchDirectMessageInbox();
  return rows
    .filter((row) => row.roomId && row.peerUserId)
    .map((row) => ({
      id: row.roomId,
      title: row.title,
      subtitle: row.subtitle,
      avatarUri: row.avatarUri,
      lastMessagePreview: row.lastMessagePreview,
      timestampLabel: row.timestampLabel,
      timestampMs: row.timestampMs,
      unreadCount: row.unreadCount,
      peerUserId: row.peerUserId,
      churchId: row.churchId,
      roomKind: "direct" as const,
    }));
}
