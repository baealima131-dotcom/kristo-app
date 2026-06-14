import { createNotification } from "@/app/api/_lib/notifications";

function commentOnPostNotificationId(commentId: string, targetUserId: string) {
  return `ntf_feed_comment_${commentId}_${targetUserId}`;
}

function replyToCommentNotificationId(replyCommentId: string, targetUserId: string) {
  return `ntf_feed_reply_${replyCommentId}_${targetUserId}`;
}

function prayerRequestPrayedNotificationId(postId: string, actorUserId: string, targetUserId: string) {
  return `ntf_prayer_pray_${postId}_${actorUserId}_${targetUserId}`;
}

function previewText(raw: unknown, max = 120): string {
  return String(raw || "")
    .trim()
    .slice(0, max);
}

export function resolveFeedPostAuthorUserId(item: unknown): string {
  return String(
    (item as any)?.createdBy ||
      (item as any)?.authorId ||
      (item as any)?.actorUserId ||
      (item as any)?.postedByUserId ||
      ""
  ).trim();
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

export async function notifyFeedCommentOnPost(args: {
  churchId: string;
  postId: string;
  commentId: string;
  commenterUserId: string;
  commentText: string;
  feedItem: unknown;
  actorName?: string;
}): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const commentId = String(args.commentId || "").trim();
  const commenterUserId = String(args.commenterUserId || "").trim();
  const postAuthorUserId = resolveFeedPostAuthorUserId(args.feedItem);

  if (!churchId || !commentId || !postAuthorUserId) return false;
  if (!commenterUserId || commenterUserId === postAuthorUserId) return false;

  const snippet = previewText(args.commentText);
  const actorLabel = String(args.actorName || "Someone").trim() || "Someone";
  const message = snippet
    ? `${actorLabel}: ${snippet}`
    : `${actorLabel} commented on your post.`;

  await createNotification({
    id: commentOnPostNotificationId(commentId, postAuthorUserId),
    churchId,
    type: "FeedCommentOnPost",
    title: "New comment on your post",
    message,
    targetUserId: postAuthorUserId,
    actorName: args.actorName,
    actorUserId: commenterUserId,
  });

  return true;
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
  const churchId = String(args.churchId || "").trim();
  const replyCommentId = String(args.replyCommentId || "").trim();
  const replierUserId = String(args.replierUserId || "").trim();
  const parentAuthorUserId = String(args.parentCommentAuthorUserId || "").trim();

  if (!churchId || !replyCommentId || !parentAuthorUserId) return false;
  if (!replierUserId || replierUserId === parentAuthorUserId) return false;

  const snippet = previewText(args.replyText);
  const actorLabel = String(args.actorName || "Someone").trim() || "Someone";
  const message = snippet
    ? `${actorLabel}: ${snippet}`
    : `${actorLabel} replied to your comment.`;

  await createNotification({
    id: replyToCommentNotificationId(replyCommentId, parentAuthorUserId),
    churchId,
    type: "FeedReplyToComment",
    title: "New reply to your comment",
    message,
    targetUserId: parentAuthorUserId,
    actorName: args.actorName,
    actorUserId: replierUserId,
  });

  return true;
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

  const actorLabel = String(args.actorName || "Someone").trim() || "Someone";
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
    actorName: args.actorName,
    actorUserId,
  });

  return true;
}
