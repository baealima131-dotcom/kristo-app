import { createNotification, getNotificationById } from "@/app/api/_lib/notifications";
import { isUnsafeActorDisplayName } from "@/app/api/_lib/notificationActor";

export type FeedEngagementNotificationType =
  | "FeedCommentOnPost"
  | "FeedReplyToComment"
  | "FeedPostLiked"
  | "FeedCommentLiked"
  | "FeedMention";

const FEED_ENGAGEMENT_ID_PREFIX = "ntf_feed_eng::";
const LEGACY_FEED_COMMENT_ID_PREFIX = "ntf_feed_comment::";
const LEGACY_FEED_REPLY_ID_PREFIX = "ntf_feed_reply::";

function previewText(raw: unknown, max = 120): string {
  return String(raw || "")
    .trim()
    .slice(0, max);
}

function publicActorLabel(actorName?: string | null, fallback = "Someone"): string {
  const raw = String(actorName || "").trim();
  if (raw && !isUnsafeActorDisplayName(raw)) return raw;
  return fallback;
}

function normalizeCommentId(commentId?: string | null) {
  const value = String(commentId || "").trim();
  return value || "-";
}

export function buildFeedEngagementNotificationId(args: {
  type: FeedEngagementNotificationType;
  postId: string;
  commentId?: string | null;
  actorUserId: string;
  targetUserId: string;
}): string {
  const type = String(args.type || "").trim();
  const postId = String(args.postId || "").trim();
  const commentId = normalizeCommentId(args.commentId);
  const actorUserId = String(args.actorUserId || "").trim();
  const targetUserId = String(args.targetUserId || "").trim();
  return `${FEED_ENGAGEMENT_ID_PREFIX}${type}::${postId}::${commentId}::${actorUserId}::${targetUserId}`;
}

export function parseFeedEngagementNotificationDeepLink(id: string): {
  type?: string;
  postId?: string;
  commentId?: string;
  actorUserId?: string;
  targetUserId?: string;
} {
  const raw = String(id || "").trim();
  if (!raw) return {};

  if (raw.startsWith(FEED_ENGAGEMENT_ID_PREFIX)) {
    const [, type, postId, commentId, actorUserId, targetUserId] = raw.split("::");
    return {
      type: String(type || "").trim() || undefined,
      postId: String(postId || "").trim() || undefined,
      commentId:
        String(commentId || "").trim() && String(commentId || "").trim() !== "-"
          ? String(commentId || "").trim()
          : undefined,
      actorUserId: String(actorUserId || "").trim() || undefined,
      targetUserId: String(targetUserId || "").trim() || undefined,
    };
  }

  if (raw.startsWith(LEGACY_FEED_COMMENT_ID_PREFIX)) {
    const [, postId, commentId, targetUserId] = raw.split("::");
    return {
      type: "FeedCommentOnPost",
      postId: String(postId || "").trim() || undefined,
      commentId: String(commentId || "").trim() || undefined,
      targetUserId: String(targetUserId || "").trim() || undefined,
    };
  }

  if (raw.startsWith(LEGACY_FEED_REPLY_ID_PREFIX)) {
    const [, postId, commentId, targetUserId] = raw.split("::");
    return {
      type: "FeedReplyToComment",
      postId: String(postId || "").trim() || undefined,
      commentId: String(commentId || "").trim() || undefined,
      targetUserId: String(targetUserId || "").trim() || undefined,
    };
  }

  return {};
}

export function resolveFeedPostAuthorUserId(item: unknown): string {
  const row = item as Record<string, unknown> | null | undefined;
  if (!row) return "";

  const candidates = [
    row.createdBy,
    row.authorUserId,
    row.authorId,
    row.actorUserId,
    row.postedByUserId,
    row.userId,
    row.scheduleCreatedByUserId,
  ];

  for (const candidate of candidates) {
    const userId = String(candidate || "").trim();
    if (userId && userId.startsWith("u_")) return userId;
  }

  return "";
}

export function isPrayerRequestFeedItem(item: unknown): boolean {
  const kind = String((item as any)?.kind || "").trim().toLowerCase();
  const source = String((item as any)?.source || "").trim().toLowerCase();
  const postType = String((item as any)?.postType || "").trim().toLowerCase();

  return (
    kind === "prayer_request" ||
    kind === "prayer" ||
    postType === "prayer_request" ||
    postType === "prayer" ||
    source === "prayer" ||
    source.includes("prayer")
  );
}

function prayerRequestPrayedNotificationId(postId: string, actorUserId: string, targetUserId: string) {
  return `ntf_prayer_pray_${postId}_${actorUserId}_${targetUserId}`;
}

type CreateFeedEngagementNotificationArgs = {
  type: FeedEngagementNotificationType;
  churchId: string;
  postId: string;
  commentId?: string;
  actorUserId: string;
  targetUserId: string;
  actorName?: string;
  title: string;
  message: string;
  skipSelf?: boolean;
  logStartEvent?: string;
  logCreatedEvent?: string;
  logSkippedSelfEvent?: string;
};

export async function createFeedEngagementNotification(
  args: CreateFeedEngagementNotificationArgs
): Promise<"created" | "duplicate_skipped" | "skipped_self" | "error"> {
  const churchId = String(args.churchId || "").trim();
  const postId = String(args.postId || "").trim();
  const commentId = String(args.commentId || "").trim() || undefined;
  const actorUserId = String(args.actorUserId || "").trim();
  const targetUserId = String(args.targetUserId || "").trim();

  const baseLog = {
    type: args.type,
    churchId,
    postId,
    commentId: commentId || null,
    actorUserId,
    targetUserId,
  };

  if (args.logStartEvent) {
    console.log(args.logStartEvent, baseLog);
  }

  try {
    if (!churchId || !postId || !actorUserId || !targetUserId) {
      console.log("KRISTO_FEED_COMMENT_NOTIFICATION_ERROR", {
        ...baseLog,
        reason: "missing_required_fields",
      });
      return "error";
    }

    if (args.skipSelf !== false && actorUserId === targetUserId) {
      if (args.logSkippedSelfEvent) {
        console.log(args.logSkippedSelfEvent, baseLog);
      }
      return "skipped_self";
    }

    const notificationId = buildFeedEngagementNotificationId({
      type: args.type,
      postId,
      commentId,
      actorUserId,
      targetUserId,
    });

    const existing = await getNotificationById(notificationId);
    if (existing && !existing.isRead) {
      console.log("KRISTO_FEED_NOTIFICATION_DUPLICATE_SKIPPED", {
        ...baseLog,
        notificationId,
      });
      return "duplicate_skipped";
    }

    const notification = await createNotification({
      id: notificationId,
      churchId,
      type: args.type,
      title: args.title,
      message: args.message,
      targetUserId,
      actorName: args.actorName,
      actorUserId,
    });

    if (args.logCreatedEvent) {
      console.log(args.logCreatedEvent, {
        ...baseLog,
        notificationId: notification.id,
      });
    }

    return "created";
  } catch (error) {
    console.log("KRISTO_FEED_COMMENT_NOTIFICATION_ERROR", {
      ...baseLog,
      message: error instanceof Error ? error.message : String(error),
    });
    return "error";
  }
}

export async function notifyFeedCommentOnPost(args: {
  churchId: string;
  postId: string;
  commentId: string;
  commenterUserId: string;
  commentText: string;
  feedItem: unknown;
  actorName?: string;
}): Promise<boolean> {
  const postAuthorUserId = resolveFeedPostAuthorUserId(args.feedItem);
  if (!postAuthorUserId) {
    console.log("KRISTO_FEED_COMMENT_NOTIFICATION_ERROR", {
      type: "FeedCommentOnPost",
      churchId: args.churchId,
      postId: args.postId,
      commentId: args.commentId,
      commenterUserId: args.commenterUserId,
      reason: "missing_post_author",
    });
    return false;
  }

  const snippet = previewText(args.commentText);
  const actorLabel = publicActorLabel(args.actorName);
  const message = snippet
    ? `${actorLabel}: ${snippet}`
    : `${actorLabel} commented on your post.`;

  const result = await createFeedEngagementNotification({
    type: "FeedCommentOnPost",
    churchId: args.churchId,
    postId: args.postId,
    commentId: args.commentId,
    actorUserId: args.commenterUserId,
    targetUserId: postAuthorUserId,
    actorName: actorLabel,
    title: "New comment on your post",
    message,
    logStartEvent: "KRISTO_FEED_COMMENT_NOTIFICATION_CREATE_START",
    logCreatedEvent: "KRISTO_FEED_COMMENT_NOTIFICATION_CREATED",
    logSkippedSelfEvent: "KRISTO_FEED_COMMENT_NOTIFICATION_SKIPPED_SELF_COMMENT",
  });

  return result === "created" || result === "duplicate_skipped";
}

export async function notifyFeedReplyToComment(args: {
  churchId: string;
  postId: string;
  replyCommentId: string;
  replierUserId: string;
  replyText: string;
  parentCommentAuthorUserId: string;
  actorName?: string;
}): Promise<boolean> {
  const snippet = previewText(args.replyText);
  const actorLabel = publicActorLabel(args.actorName);
  const message = snippet
    ? `${actorLabel}: ${snippet}`
    : `${actorLabel} replied to your comment.`;

  const result = await createFeedEngagementNotification({
    type: "FeedReplyToComment",
    churchId: args.churchId,
    postId: args.postId,
    commentId: args.replyCommentId,
    actorUserId: args.replierUserId,
    targetUserId: args.parentCommentAuthorUserId,
    actorName: actorLabel,
    title: "New reply to your comment",
    message,
  });

  return result === "created" || result === "duplicate_skipped";
}

export async function notifyFeedPostLiked(args: {
  churchId: string;
  postId: string;
  actorUserId: string;
  feedItem: unknown;
  actorName?: string;
}): Promise<boolean> {
  const postAuthorUserId = resolveFeedPostAuthorUserId(args.feedItem);
  if (!postAuthorUserId) return false;

  const actorLabel = publicActorLabel(args.actorName);
  const message = `${actorLabel} liked your post.`;

  const result = await createFeedEngagementNotification({
    type: "FeedPostLiked",
    churchId: args.churchId,
    postId: args.postId,
    actorUserId: args.actorUserId,
    targetUserId: postAuthorUserId,
    actorName: actorLabel,
    title: "New like on your post",
    message,
  });

  return result === "created" || result === "duplicate_skipped";
}

export async function notifyFeedCommentLiked(args: {
  churchId: string;
  postId: string;
  commentId: string;
  actorUserId: string;
  commentAuthorUserId: string;
  actorName?: string;
}): Promise<boolean> {
  const actorLabel = publicActorLabel(args.actorName);
  const message = `${actorLabel} liked your comment.`;

  const result = await createFeedEngagementNotification({
    type: "FeedCommentLiked",
    churchId: args.churchId,
    postId: args.postId,
    commentId: args.commentId,
    actorUserId: args.actorUserId,
    targetUserId: args.commentAuthorUserId,
    actorName: actorLabel,
    title: "New like on your comment",
    message,
  });

  return result === "created" || result === "duplicate_skipped";
}

export async function notifyFeedMention(args: {
  churchId: string;
  postId: string;
  commentId?: string;
  actorUserId: string;
  targetUserId: string;
  actorName?: string;
  previewText?: string;
}): Promise<boolean> {
  const actorLabel = publicActorLabel(args.actorName);
  const snippet = previewText(args.previewText);
  const message = snippet
    ? `${actorLabel} mentioned you: ${snippet}`
    : `${actorLabel} mentioned you in a post.`;

  const result = await createFeedEngagementNotification({
    type: "FeedMention",
    churchId: args.churchId,
    postId: args.postId,
    commentId: args.commentId,
    actorUserId: args.actorUserId,
    targetUserId: args.targetUserId,
    actorName: actorLabel,
    title: "You were mentioned",
    message,
  });

  return result === "created" || result === "duplicate_skipped";
}

export async function notifyPrayerRequestPrayedFor(args: {
  churchId: string;
  postId: string;
  actorUserId: string;
  feedItem: unknown;
  actorName?: string;
}): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const postId = String(args.postId || "").trim();
  const actorUserId = String(args.actorUserId || "").trim();
  const authorUserId = resolveFeedPostAuthorUserId(args.feedItem);

  if (!churchId || !postId || !authorUserId) return false;
  if (!actorUserId || actorUserId === authorUserId) return false;
  if (!isPrayerRequestFeedItem(args.feedItem)) return false;

  const actorLabel = publicActorLabel(args.actorName);
  const caption = previewText((args.feedItem as any)?.title || (args.feedItem as any)?.text);
  const message = caption
    ? `${actorLabel} prayed for your request: ${caption}`
    : `${actorLabel} prayed for your request.`;

  await createNotification({
    id: prayerRequestPrayedNotificationId(postId, actorUserId, authorUserId),
    churchId,
    type: "PrayerRequestPrayedFor",
    title: "Someone prayed for your request",
    message,
    targetUserId: authorUserId,
    actorName: actorLabel,
    actorUserId,
  });

  return true;
}
