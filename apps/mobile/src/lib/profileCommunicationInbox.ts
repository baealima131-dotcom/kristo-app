import {
  fetchChurchNotifications,
  type ChurchNotificationItem,
} from "@/src/lib/churchNotificationsApi";
import {
  fetchPrivateCallSession,
  type PrivateCallSession,
} from "@/src/lib/privateCallService";

export type ProfileCommunicationInboxSnapshot = {
  unreadMessages: number;
  missedCalls: number;
  total: number;
};

export function parsePrivateCallIdFromNotification(
  notification: Pick<ChurchNotificationItem, "id" | "message" | "body" | "type">
): string | null {
  if (String(notification.type || "") !== "PastorPrivateCallIncoming") return null;

  const message = String(notification.message || notification.body || "");
  const match = message.match(/private-call:([A-Za-z0-9_-]+)/);
  if (match?.[1]) return match[1];

  const idMatch = String(notification.id || "").match(/^ntf_private_call_([A-Za-z0-9_-]+)_/);
  return idMatch?.[1] || null;
}

function isAnsweredPrivateCallSession(session: PrivateCallSession | null): boolean {
  if (!session) return false;
  if (session.status === "accepted") return true;
  if (String(session.acceptedAt || "").trim()) return true;
  return false;
}

function isMissedOrUnansweredCallStatus(status: PrivateCallSession["status"] | "missing"): boolean {
  if (status === "missing") return true;
  if (status === "accepted") return false;
  return (
    status === "ringing" ||
    status === "declined" ||
    status === "timeout" ||
    status === "failed" ||
    status === "ended"
  );
}

export function countProfileCommunicationInboxFromItems(
  items: ChurchNotificationItem[],
  callStatusById: Record<string, PrivateCallSession["status"] | "missing">
): ProfileCommunicationInboxSnapshot {
  let unreadMessages = 0;
  let missedCalls = 0;
  const countedCallIds = new Set<string>();

  for (const item of items) {
    if (item.read) continue;

    const type = String(item.type || "");
    if (type !== "PastorPrivateCallIncoming") continue;

    const callId = parsePrivateCallIdFromNotification(item);
    if (!callId || countedCallIds.has(callId)) continue;
    countedCallIds.add(callId);

    const status = callStatusById[callId] ?? "missing";
    if (!isMissedOrUnansweredCallStatus(status)) continue;
    missedCalls += 1;
  }

  return {
    unreadMessages,
    missedCalls,
    total: unreadMessages + missedCalls,
  };
}

async function resolveCallStatusesForNotifications(
  items: ChurchNotificationItem[]
): Promise<Record<string, PrivateCallSession["status"] | "missing">> {
  const callIds = new Set<string>();

  for (const item of items) {
    if (item.read) continue;
    if (String(item.type || "") !== "PastorPrivateCallIncoming") continue;
    const callId = parsePrivateCallIdFromNotification(item);
    if (callId) callIds.add(callId);
  }

  const entries = await Promise.all(
    Array.from(callIds).map(async (callId) => {
      const session = await fetchPrivateCallSession(callId).catch(() => null);
      if (isAnsweredPrivateCallSession(session)) {
        return [callId, "accepted" as const] as const;
      }
      return [callId, (session?.status || "missing") as PrivateCallSession["status"] | "missing"] as const;
    })
  );

  return Object.fromEntries(entries);
}

export async function fetchProfileCommunicationInboxSnapshot(args: {
  base: string;
  signal?: AbortSignal;
}): Promise<ProfileCommunicationInboxSnapshot> {
  const { base, signal } = args;
  const result = await fetchChurchNotifications({
    base,
    scope: "forMe",
    limit: 200,
    signal,
    logPrefix: "card",
  });

  const callStatusById = await resolveCallStatusesForNotifications(result.items);
  return countProfileCommunicationInboxFromItems(result.items, callStatusById);
}

export function formatProfileCommunicationBadgeCount(count: number): string {
  const safe = Math.max(0, Number(count) || 0);
  if (safe <= 0) return "";
  if (safe > 99) return "99+";
  return String(safe);
}
