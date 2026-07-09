export type MessagesInboxConversation = {
  id: string;
  title: string;
  subtitle: string;
  avatarUri: string;
  lastMessagePreview: string;
  timestampLabel: string;
  timestampMs: number;
  unreadCount: number;
};

/**
 * V1 person-to-person Messages inbox.
 * Ministry and assignment threads are intentionally excluded here.
 * DM/direct messaging is not enabled in V1, so this returns an empty list
 * until a real person-to-person conversation API is wired for this screen.
 */
export async function fetchMessagesInboxConversations(_args: {
  base: string;
}): Promise<MessagesInboxConversation[]> {
  return [];
}
