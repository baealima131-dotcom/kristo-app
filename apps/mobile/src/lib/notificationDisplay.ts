import { CHURCH_LIVE_CONTROL_ROOM_NAV_PARAMS } from "@/src/lib/churchLiveControlSchedule";

function parseFeedEngagementNotificationDeepLink(notification: NotificationLike): {
  postId?: string;
  commentId?: string;
  actorUserId?: string;
} {
  const directPostId = String(notification?.postId || "").trim();
  const directCommentId = String(notification?.commentId || "").trim();
  const directActorUserId = String(notification?.actorUserId || "").trim();
  if (directPostId) {
    return {
      postId: directPostId,
      commentId: directCommentId || undefined,
      actorUserId: directActorUserId || undefined,
    };
  }

  const raw = String(notification?.id || "").trim();
  if (raw.startsWith("ntf_feed_eng::")) {
    const [, , postId, commentId, actorUserId] = raw.split("::");
    return {
      postId: String(postId || "").trim() || undefined,
      commentId:
        String(commentId || "").trim() && String(commentId || "").trim() !== "-"
          ? String(commentId || "").trim()
          : undefined,
      actorUserId: String(actorUserId || "").trim() || undefined,
    };
  }

  if (raw.startsWith("ntf_feed_comment::") || raw.startsWith("ntf_feed_reply::")) {
    const [, postId, commentId] = raw.split("::");
    return {
      postId: String(postId || "").trim() || undefined,
      commentId: String(commentId || "").trim() || undefined,
    };
  }

  return {};
}

function isFeedEngagementNotificationType(type: string) {
  return (
    type === "FeedCommentOnPost" ||
    type === "FeedReplyToComment" ||
    type === "FeedPostLiked" ||
    type === "FeedCommentLiked" ||
    type === "FeedMention"
  );
}

function churchLiveControlRoomHref(): string {
  const params = CHURCH_LIVE_CONTROL_ROOM_NAV_PARAMS;
  return `/more/my-church-room/messages/${encodeURIComponent(params.id)}`;
}

function isLegacyGlobalLiveSlotsNotification(notification: NotificationLike): boolean {
  const extra = notification as NotificationLike & {
    isGlobalMediaSlot?: boolean;
    audience?: string;
  };
  if (extra.isGlobalMediaSlot === true) return true;
  return String(extra.audience || "").toLowerCase().includes("global");
}

export type NotificationLike = {
  title?: string;
  body?: string;
  message?: string;
  text?: string;
  actorName?: string;
  actorUserId?: string;
  actorAvatarUri?: string;
  actorRole?: string;
  avatarUri?: string;
  avatarUrl?: string;
  profileImage?: string;
  type?: string;
  ministryId?: string;
  postId?: string;
  commentId?: string;
  id?: string;
};

export type NotificationListScope = "forMe" | "churchAdmin";

export type NotificationCategory =
  | "Admin"
  | "Safety"
  | "Ministry"
  | "Live"
  | "Prayer"
  | "Subscription"
  | "Feed"
  | "General";

export type NotificationCategoryStyle = {
  label: NotificationCategory;
  icon: string;
  accent: string;
  border: string;
  background: string;
};

const CATEGORY_ICONS = {
  Admin: "shield-checkmark-outline",
  Safety: "alert-circle-outline",
  Ministry: "people-outline",
  Live: "radio-outline",
  Prayer: "heart-outline",
  Subscription: "card-outline",
  Feed: "newspaper-outline",
  General: "notifications-outline",
} as const;

const CATEGORY_STYLES: Record<
  NotificationCategory,
  Omit<NotificationCategoryStyle, "label" | "icon"> & { icon: string }
> = {
  Admin: {
    icon: CATEGORY_ICONS.Admin,
    accent: "#7DB7FF",
    border: "rgba(96,165,250,0.35)",
    background: "rgba(18,30,55,0.95)",
  },
  Safety: {
    icon: CATEGORY_ICONS.Safety,
    accent: "#FF8A8A",
    border: "rgba(248,113,113,0.35)",
    background: "rgba(45,16,16,0.95)",
  },
  Ministry: {
    icon: CATEGORY_ICONS.Ministry,
    accent: "#B794F6",
    border: "rgba(167,139,250,0.35)",
    background: "rgba(28,18,48,0.95)",
  },
  Live: {
    icon: CATEGORY_ICONS.Live,
    accent: "#FF7A9E",
    border: "rgba(255,122,158,0.35)",
    background: "rgba(45,14,28,0.95)",
  },
  Prayer: {
    icon: CATEGORY_ICONS.Prayer,
    accent: "#63D18C",
    border: "rgba(52,211,153,0.35)",
    background: "rgba(12,45,32,0.95)",
  },
  Subscription: {
    icon: CATEGORY_ICONS.Subscription,
    accent: "#D9B35F",
    border: "rgba(217,179,95,0.35)",
    background: "rgba(35,28,14,0.95)",
  },
  Feed: {
    icon: CATEGORY_ICONS.Feed,
    accent: "#F4B860",
    border: "rgba(245,158,11,0.35)",
    background: "rgba(45,32,12,0.92)",
  },
  General: {
    icon: CATEGORY_ICONS.General,
    accent: "#D9B35F",
    border: "rgba(255,255,255,0.10)",
    background: "rgba(14,18,28,0.95)",
  },
};

const RAW_USER_ID_RX = /^u_[a-f0-9]{8,}$/i;
const EMAIL_LIKE_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const EMAIL_IN_TEXT_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function isRawUserId(value?: string | null): boolean {
  const s = String(value || "").trim();
  if (!s) return false;
  return RAW_USER_ID_RX.test(s);
}

export function isEmailLike(value?: string | null): boolean {
  const s = String(value || "").trim();
  if (!s) return false;
  return EMAIL_LIKE_RX.test(s);
}

export function isUnsafeActorDisplayName(value?: string | null): boolean {
  const s = String(value || "").trim();
  if (!s) return true;
  return isRawUserId(s) || isEmailLike(s);
}

export function roleFallbackLabel(role?: string | null): string {
  const r = String(role || "").trim();
  if (r === "Pastor") return "Pastor";
  if (r === "Church_Admin") return "Church Admin";
  if (r === "System_Admin") return "System Admin";
  if (r === "Ministry_Leader") return "Ministry Leader";
  if (r === "Leader") return "Leader";
  if (r === "Member") return "Member";
  return "Church Admin";
}

function notificationTitleLower(notification: NotificationLike): string {
  return String(notification?.title || "").trim().toLowerCase();
}

function notificationType(notification: NotificationLike): string {
  return String(notification?.type || "").trim();
}

export function resolveNotificationCategory(notification: NotificationLike): NotificationCategory {
  const type = notificationType(notification);
  const title = notificationTitleLower(notification);

  if (
    type === "ContentReportReceived" ||
    type === "ContentAutoHiddenAdmin" ||
    (type === "Generic" && title.includes("membership request"))
  ) {
    return "Admin";
  }

  if (type === "ContentAutoHiddenAuthor" || type === "MembershipRejected") {
    return "Safety";
  }

  if (
    type.startsWith("Ministry") ||
    type === "MinistryChatMessageCreated"
  ) {
    return "Ministry";
  }

  if (
    type === "LiveEventScheduled" ||
    type === "LiveSlotAssigned" ||
    type === "LiveSlotCancelled" ||
    (type === "Generic" &&
      (title.includes("live") || title.includes("schedule updated")))
  ) {
    return "Live";
  }

  if (type === "ChurchPrayerRequestPosted" || type === "PrayerRequestPrayedFor") {
    return "Prayer";
  }

  if (type.startsWith("ChurchSubscription")) {
    return "Subscription";
  }

  if (
    type === "ChurchAnnouncementPosted" ||
    type === "ChurchTestimonyPosted" ||
    type === "ChurchMediaPosted" ||
    isFeedEngagementNotificationType(type) ||
    type === "ChurchProfileUpdated"
  ) {
    return "Feed";
  }

  return "General";
}

export function resolveNotificationCategoryStyle(
  notification: NotificationLike
): NotificationCategoryStyle {
  const label = resolveNotificationCategory(notification);
  const style = CATEGORY_STYLES[label];
  return {
    label,
    icon: style.icon,
    accent: style.accent,
    border: style.border,
    background: style.background,
  };
}

export function resolveNotificationRoute(notification: NotificationLike): string | null {
  const type = notificationType(notification);
  const title = notificationTitleLower(notification);

  if (type === "ContentReportReceived" || type === "ContentAutoHiddenAdmin") {
    return "/more/media-reports";
  }

  if (type === "PastorPrivateCallIncoming") {
    const message = String(notification.message || notification.body || "");
    const match = message.match(/private-call:([A-Za-z0-9_-]+)/);
    if (match?.[1]) {
      return `/more/private-call/${encodeURIComponent(match[1])}`;
    }
    const idMatch = String(notification.id || "").match(/^ntf_private_call_([A-Za-z0-9_-]+)_/);
    if (idMatch?.[1]) {
      return `/more/private-call/${encodeURIComponent(idMatch[1])}`;
    }
  }

  if (type === "TrustedMediaHostAdded" || type === "TrustedMediaHostRemoved") {
    return "/more/media";
  }

  if (type.startsWith("ChurchSubscription")) {
    return "/more/media";
  }

  if (
    type === "LiveEventScheduled" ||
    type === "LiveSlotAssigned" ||
    type === "LiveSlotCancelled"
  ) {
    if (notification.ministryId) {
      return `/more/my-church-room/messages/${encodeURIComponent(String(notification.ministryId))}`;
    }
    if (isLegacyGlobalLiveSlotsNotification(notification)) {
      return "/more/live-slots";
    }
    return churchLiveControlRoomHref();
  }

  if (type === "ChurchProfileUpdated") {
    return "/church/overview";
  }

  if (type === "Generic" && title.includes("membership request")) {
    return "/church/members?tab=requests";
  }

  if (isFeedEngagementNotificationType(type)) {
    const deepLink = parseFeedEngagementNotificationDeepLink(notification);
    if (deepLink.postId) {
      return `/post/${encodeURIComponent(deepLink.postId)}`;
    }
  }

  if (notification.ministryId && type === "MinistryChatMessageCreated") {
    return `/more/my-church-room/messages/${encodeURIComponent(String(notification.ministryId))}`;
  }

  return null;
}

function extractActorNameFromBody(body: string): string {
  const text = String(body || "").trim();
  if (!text) return "";

  const patterns = [
    /^(.+?)\s+replied\b/i,
    /^(.+?)\s+commented\b/i,
    /^(.+?)\s+requested\b/i,
    /^(.+?)\s+updated\b/i,
    /^(.+?)\s+added\b/i,
    /^(.+?)\s+removed\b/i,
    /^(.+?)\s+changed\b/i,
    /^(.+?)\s+liked\b/i,
    /^([^:]+):/,
  ];

  for (const rx of patterns) {
    const m = text.match(rx);
    const candidate = String(m?.[1] || "").trim();
    if (candidate && !isUnsafeActorDisplayName(candidate)) return candidate;
  }

  return "";
}

function sanitizeUserIdsInText(text: string, replacement = "Church Admin"): string {
  let out = String(text || "");
  out = out.replace(/\bu_[a-f0-9]{8,}\b/gi, replacement);
  return out.trim();
}

function redactEmailsInText(text: string, replacement = "Member"): string {
  const safe = String(replacement || "").trim() || "Member";
  const redacted = isEmailLike(safe) ? "Member" : safe;
  return String(text || "")
    .replace(EMAIL_IN_TEXT_RX, redacted)
    .trim();
}

export function safeDisplayName(notification: NotificationLike): string {
  const actorName = String(notification?.actorName || "").trim();
  if (actorName && !isUnsafeActorDisplayName(actorName)) return actorName;

  const body = String(notification?.body || notification?.message || notification?.text || "");
  const fromBody = extractActorNameFromBody(body);
  if (fromBody) return fromBody;

  if (notification?.type === "ChurchProfileUpdated") {
    return roleFallbackLabel(notification?.actorRole || "Church_Admin");
  }

  return roleFallbackLabel(notification?.actorRole);
}

export function safeBody(notification: NotificationLike): string {
  const raw = String(notification?.body || notification?.message || notification?.text || "");
  const displayName = safeDisplayName(notification);
  const replacement = isUnsafeActorDisplayName(displayName)
    ? roleFallbackLabel(notification?.actorRole)
    : displayName;
  const withoutIds = sanitizeUserIdsInText(raw, replacement || "Church Admin");
  return redactEmailsInText(withoutIds, replacement || "Church Admin");
}

export function safeNotificationTitle(notification: NotificationLike): string {
  const raw = String(notification?.title || "Notification").trim() || "Notification";
  return redactEmailsInText(raw, safeDisplayName(notification));
}

export function safeNotificationPreview(notification: NotificationLike): string {
  return safeBody(notification);
}

function toAbsoluteAvatarUri(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("file://") || v.startsWith("data:image/")) return v;
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (!base) return v;
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

export function safeAvatarUri(notification: NotificationLike): string {
  const candidates = [
    notification?.actorAvatarUri,
    notification?.avatarUri,
    notification?.avatarUrl,
    notification?.profileImage,
  ];

  for (const raw of candidates) {
    const uri = toAbsoluteAvatarUri(String(raw || "").trim());
    if (uri) return uri;
  }

  return "";
}

export function safeInitial(notification: NotificationLike): string {
  const name = safeDisplayName(notification);
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return "N";
  return parts.map((x) => x[0]?.toUpperCase() || "").join("");
}

export function canUseChurchAdminNotificationScope(role: string): boolean {
  const r = String(role || "").trim();
  return r === "Pastor" || r === "Church_Admin" || r === "System_Admin";
}
