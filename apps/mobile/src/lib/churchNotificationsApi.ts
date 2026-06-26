import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  safeBody,
  safeDisplayName,
  type NotificationLike,
  type NotificationListScope,
} from "@/src/lib/notificationDisplay";

let lastCardUnreadCount: number | null = null;
let lastCardForMeUnread = 0;
let lastCardChurchAdminUnread = 0;

export function setNotificationCardUnreadCount(count: number) {
  lastCardUnreadCount = Math.max(0, Number(count) || 0);
}

export function setNotificationCardUnreadBreakdown(args: {
  totalUnread: number;
  forMeUnread: number;
  churchAdminUnread: number;
}) {
  lastCardUnreadCount = Math.max(0, Number(args.totalUnread) || 0);
  lastCardForMeUnread = Math.max(0, Number(args.forMeUnread) || 0);
  lastCardChurchAdminUnread = Math.max(0, Number(args.churchAdminUnread) || 0);
}

export function peekNotificationCardUnreadCount(scope?: NotificationListScope): number | null {
  if (lastCardUnreadCount == null) return null;
  if (scope === "churchAdmin") return lastCardChurchAdminUnread;
  if (scope === "forMe") return lastCardForMeUnread;
  return lastCardUnreadCount;
}

export type ChurchNotificationItem = NotificationLike & {
  membershipId?: string;
  ministryId?: string;
  id: string;
  title: string;
  body: string;
  createdAt?: string;
  read?: boolean;
  type?: string;
};

export type ChurchNotificationsFetchResult = {
  scope: NotificationListScope;
  rawCount: number;
  filteredCount: number;
  filteredUnreadCount: number;
  apiUnreadCount: number;
  items: ChurchNotificationItem[];
};

function isInviteLikeNotice(x: any): boolean {
  const title = String(x?.title || x?.subject || "").toLowerCase();
  const body = String(x?.body || x?.message || x?.text || "").toLowerCase();
  const type = String(x?.type || x?.kind || x?.category || "").toLowerCase();
  return (
    title.includes("invite") ||
    title.includes("invitation") ||
    body.includes("invited") ||
    body.includes("invite") ||
    body.includes("invitation") ||
    type.includes("invite") ||
    type.includes("invitation") ||
    Boolean(x?.membershipId || x?.meta?.membershipId)
  );
}

export function filterInviteSafeNotices(raw: any[]): any[] {
  return raw.filter((x) => !isInviteLikeNotice(x));
}

function mapApiNotice(x: any, i: number): ChurchNotificationItem {
  const raw: NotificationLike = {
    title: String(x?.title || x?.subject || "Notification"),
    body: String(x?.body || x?.message || x?.text || ""),
    message: String(x?.message || x?.body || x?.text || ""),
    actorName: x?.actorName,
    actorUserId: x?.actorUserId,
    actorAvatarUri: x?.actorAvatarUri,
    actorRole: x?.actorRole,
    avatarUri: x?.avatarUri,
    avatarUrl: x?.avatarUrl,
    profileImage: x?.profileImage,
    type: String(x?.type || ""),
    ministryId: x?.ministryId,
  };

  return {
    membershipId: x?.membershipId || x?.meta?.membershipId,
    ministryId: x?.ministryId,
    id: String(x?.id || `n-${i}`),
    title: String(raw.title || "Notification"),
    body: safeBody(raw),
    createdAt: String(x?.createdAt || x?.date || ""),
    read: !!(x?.readAt || x?.isRead || x?.read),
    type: String(x?.type || ""),
    actorName: safeDisplayName(raw),
    actorUserId: raw.actorUserId,
    actorAvatarUri: raw.actorAvatarUri,
    actorRole: raw.actorRole,
    avatarUri: raw.avatarUri,
    avatarUrl: raw.avatarUrl,
    profileImage: raw.profileImage,
  };
}

export function mapNoticesFromApi(raw: any[]): ChurchNotificationItem[] {
  return filterInviteSafeNotices(raw)
    .map((x, i) => mapApiNotice(x, i))
    .sort((a, b) => {
      const aa = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bb - aa;
    });
}

export async function fetchChurchNotifications(args: {
  base: string;
  scope: NotificationListScope;
  limit?: number;
  signal?: AbortSignal;
  logPrefix?: "screen" | "card";
}): Promise<ChurchNotificationsFetchResult> {
  const { base, scope, limit = 200, signal, logPrefix = "screen" } = args;
  const url = `${base.replace(/\/+$/, "")}/api/church/notifications?scope=${encodeURIComponent(scope)}&limit=${limit}`;

  if (logPrefix === "screen") {
    console.log("KRISTO_NOTIFICATIONS_SCREEN_FETCH_START", { scope, url });
  }

  const r = await fetch(url, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...getKristoHeaders(),
    },
    signal,
  });

  const j = await r.json().catch(() => ({} as any));
  if (r.status === 401) {
    throw new Error(String(j?.error || "Unauthorized"));
  }
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || `Request failed (${r.status})`));
  }

  const raw = Array.isArray(j?.notifications)
    ? j.notifications
    : Array.isArray(j?.data)
      ? j.data
      : Array.isArray(j?.items)
        ? j.items
        : [];
  const filtered = filterInviteSafeNotices(raw);
  const items = mapNoticesFromApi(raw);
  const apiUnreadCount = Number(j?.meta?.unreadCount ?? 0);
  const filteredUnreadCount = items.filter((x) => !x.read).length;

  if (logPrefix === "screen") {
    console.log("KRISTO_NOTIFICATIONS_SCREEN_FETCH_RESULT", {
      scope,
      rawCount: raw.length,
      apiUnreadCount,
      ok: true,
    });
    console.log("KRISTO_NOTIFICATIONS_SCREEN_FILTER_RESULT", {
      scope,
      filteredCount: filtered.length,
      filteredUnreadCount,
      removedCount: Math.max(0, raw.length - filtered.length),
    });
  }

  return {
    scope,
    rawCount: raw.length,
    filteredCount: filtered.length,
    filteredUnreadCount,
    apiUnreadCount,
    items,
  };
}

export async function fetchNotificationCardUnreadCount(args: {
  base: string;
  canUseChurchAdmin: boolean;
  signal?: AbortSignal;
}): Promise<{
  totalUnread: number;
  forMeUnread: number;
  churchAdminUnread: number;
  source: string;
}> {
  const { base, canUseChurchAdmin, signal } = args;

  const forMe = await fetchChurchNotifications({
    base,
    scope: "forMe",
    limit: 200,
    signal,
    logPrefix: "card",
  });

  let churchAdminUnread = 0;
  let totalUnread = forMe.filteredUnreadCount;
  let source = "notifications-api:forMe(filtered)";

  if (canUseChurchAdmin) {
    const churchAdmin = await fetchChurchNotifications({
      base,
      scope: "churchAdmin",
      limit: 200,
      signal,
      logPrefix: "card",
    });
    churchAdminUnread = churchAdmin.filteredUnreadCount;
    totalUnread = forMe.filteredUnreadCount + churchAdminUnread;
    source = "notifications-api:forMe+churchAdmin(filtered)";
  }

  console.log("KRISTO_NOTIFICATIONS_CARD_COUNT_SOURCE", {
    source,
    forMeUnread: forMe.filteredUnreadCount,
    churchAdminUnread,
    totalUnread,
    forMeApiUnread: forMe.apiUnreadCount,
    forMeRawCount: forMe.rawCount,
  });

  return {
    totalUnread,
    forMeUnread: forMe.filteredUnreadCount,
    churchAdminUnread,
    source,
  };
}

export function setCardUnreadFromFetchResult(result: Awaited<ReturnType<typeof fetchNotificationCardUnreadCount>>) {
  setNotificationCardUnreadBreakdown({
    totalUnread: result.totalUnread,
    forMeUnread: result.forMeUnread,
    churchAdminUnread: result.churchAdminUnread,
  });
}

export function logNotificationCountMismatch(args: {
  scope: NotificationListScope;
  cardUnread?: number;
  screenUnread: number;
  itemCount: number;
  apiUnreadCount: number;
}) {
  const { scope, cardUnread, screenUnread, itemCount, apiUnreadCount } = args;
  if (cardUnread == null) return;

  if (itemCount === 0 && screenUnread > 0) {
    console.log("KRISTO_NOTIFICATIONS_COUNT_MISMATCH", {
      scope,
      cardUnread,
      screenUnread,
      itemCount,
      apiUnreadCount,
      reason: "filtered_items_empty",
    });
    return;
  }

  if (cardUnread === screenUnread) return;

  console.log("KRISTO_NOTIFICATIONS_COUNT_MISMATCH", {
    scope,
    cardUnread,
    screenUnread,
    itemCount,
    apiUnreadCount,
    reason: "card_screen_delta",
  });
}
