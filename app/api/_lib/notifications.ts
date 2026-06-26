import {
  extractLeadingActorUserId,
  isRawUserId,
  resolveActorIdentity,
  roleFallbackLabel,
  sanitizeActorInText,
  type ActorIdentity,
} from "@/app/api/_lib/notificationActor";
import {
  dbCountNotifications,
  dbCreateNotification,
  dbGetNotificationById,
  dbListNotifications,
  dbMarkAllRead,
  dbRemoveNotification,
  dbSetRead,
  resolveNotificationStoreMode,
} from "@/app/api/_lib/store/notificationDb";
import type { NotificationStoreScope } from "@/app/api/_lib/notificationScope";
import { parseFeedEngagementNotificationDeepLink } from "@/app/api/_lib/feedEngagementNotifications";

export type NotificationType =
  | "MinistryMemberAdded"
  | "MinistryMemberRemoved"
  | "MinistryLeaderAssigned"
  | "MinistryLeaderRemoved"
  | "MinistryMemberRoleChanged"
  | "MembershipRejected"
  | "ChurchProfileUpdated"
  | "ContentReportReceived"
  | "ContentAutoHiddenAdmin"
  | "ContentAutoHiddenAuthor"
  | "ChurchAnnouncementPosted"
  | "ChurchTestimonyPosted"
  | "ChurchPrayerRequestPosted"
  | "ChurchMediaPosted"
  | "FeedCommentOnPost"
  | "FeedReplyToComment"
  | "FeedPostLiked"
  | "FeedCommentLiked"
  | "FeedMention"
  | "PrayerRequestPrayedFor"
  | "TrustedMediaHostAdded"
  | "TrustedMediaHostRemoved"
  | "ChurchSubscriptionActivated"
  | "ChurchSubscriptionExpiringSoon"
  | "ChurchSubscriptionExpired"
  | "LiveEventScheduled"
  | "LiveSlotAssigned"
  | "LiveSlotCancelled"
  | "Generic";

export type AppNotification = {
  id: string;
  churchId: string;

  type: NotificationType | string;
  title: string;
  message?: string;

  actorName?: string;
  actorUserId?: string;
  actorAvatarUri?: string;
  actorRole?: string;

  ministryId?: string;
  ministryMemberId?: string;
  targetUserId?: string;

  isRead: boolean;
  createdAt: string;
  readAt?: string;
};

export type ClientNotification = {
  id: string;
  churchId: string;
  type: NotificationType | string;
  title: string;
  body: string;
  message: string;
  actorName: string;
  actorUserId?: string;
  actorAvatarUri?: string;
  actorRole?: string;
  read: boolean;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
  ministryId?: string;
  ministryMemberId?: string;
  targetUserId?: string;
  postId?: string;
  commentId?: string;
};

export { resolveNotificationStoreMode };

export async function createNotification(
  input: Omit<AppNotification, "id" | "createdAt" | "isRead"> & { id?: string }
): Promise<AppNotification> {
  return dbCreateNotification(input);
}

export async function toClientNotification(n: AppNotification): Promise<ClientNotification> {
  let actorUserId = String(n.actorUserId || "").trim();
  let actorName = String(n.actorName || "").trim();
  let actorAvatarUri = String(n.actorAvatarUri || "").trim();
  let actorRole = String(n.actorRole || "").trim();
  const rawMessage = String(n.message || "");

  if (!actorUserId) {
    actorUserId = extractLeadingActorUserId(rawMessage);
  }

  if ((!actorName || isRawUserId(actorName)) && actorUserId) {
    const identity = await resolveActorIdentity(actorUserId);
    if (!actorName || isRawUserId(actorName)) {
      actorName = identity.name;
    }
    if (!actorAvatarUri) {
      actorAvatarUri = identity.avatar;
    }
  }

  if (!actorName || isRawUserId(actorName)) {
    const fallbackRole =
      actorRole ||
      (n.type === "ChurchProfileUpdated" ? "Church_Admin" : "");
    actorName = roleFallbackLabel(fallbackRole);
  }

  const body = sanitizeActorInText(rawMessage, actorUserId, actorName);
  const deepLink = parseFeedEngagementNotificationDeepLink(n.id);

  return {
    id: n.id,
    churchId: n.churchId,
    type: n.type,
    title: String(n.title || "Notification"),
    body,
    message: body,
    actorName,
    actorUserId: actorUserId || undefined,
    actorAvatarUri: actorAvatarUri || undefined,
    actorRole: actorRole || undefined,
    read: !!n.isRead,
    isRead: !!n.isRead,
    createdAt: n.createdAt,
    readAt: n.readAt,
    ministryId: n.ministryId,
    ministryMemberId: n.ministryMemberId,
    targetUserId: n.targetUserId,
    postId: deepLink.postId,
    commentId: deepLink.commentId,
  };
}

export async function toClientNotifications(items: AppNotification[]): Promise<ClientNotification[]> {
  return Promise.all(items.map((n) => toClientNotification(n)));
}

export async function listNotifications(args: {
  churchId: string;
  userId: string;
  unreadOnly?: boolean;
  limit?: number;
  storeScope?: NotificationStoreScope;
}): Promise<AppNotification[]> {
  return dbListNotifications(args);
}

export async function countNotifications(args: {
  churchId: string;
  userId: string;
  unreadOnly?: boolean;
  storeScope?: NotificationStoreScope;
}): Promise<number> {
  return dbCountNotifications(args);
}

export async function getNotificationById(id: string): Promise<AppNotification | null> {
  return dbGetNotificationById(id);
}

export async function setRead(id: string, isRead: boolean): Promise<AppNotification | null> {
  return dbSetRead(id, isRead);
}

export async function removeNotification(id: string): Promise<AppNotification | null> {
  return dbRemoveNotification(id);
}

export const addNotification = createNotification;

export async function markAllRead(args: {
  churchId: string;
  userId: string;
  storeScope?: NotificationStoreScope;
}): Promise<{ updated: number }> {
  return dbMarkAllRead(args);
}

export type { ActorIdentity };
