import { createNotification, type NotificationType } from "@/app/api/_lib/notifications";
import { isUnsafeActorDisplayName } from "@/app/api/_lib/notificationActor";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";

export type ChurchFeedPostNotificationKind = "testimony" | "prayer_request" | "media";

function announcementNotificationId(announcementId: string, targetUserId: string) {
  return `ntf_church_ann_${announcementId}_${targetUserId}`;
}

function feedPostNotificationId(kind: ChurchFeedPostNotificationKind, postId: string, targetUserId: string) {
  return `ntf_church_${kind}_${postId}_${targetUserId}`;
}

function shortCaption(item: unknown): string {
  const title = String((item as any)?.title || "").trim();
  const text = String((item as any)?.text || (item as any)?.body || "").trim();
  const caption = title || text;
  return caption.slice(0, 140);
}

function publicActorName(actorName?: string | null): string | undefined {
  const raw = String(actorName || "").trim();
  if (!raw || isUnsafeActorDisplayName(raw)) return undefined;
  return raw;
}

export async function listActiveChurchMemberUserIds(
  churchId: string,
  excludeUserId?: string
): Promise<string[]> {
  const cid = String(churchId || "").trim();
  if (!cid) return [];

  const excluded = String(excludeUserId || "").trim();
  const members = await getMembershipsForChurch(cid, "Active");
  return [
    ...new Set(
      members
        .map((member) => String(member.userId || "").trim())
        .filter((userId) => userId && userId !== excluded)
    ),
  ];
}

async function fanOutChurchMemberNotifications(args: {
  churchId: string;
  authorUserId: string;
  buildId: (targetUserId: string) => string;
  type: NotificationType;
  title: string;
  message: string;
  actorName?: string;
  actorUserId?: string;
}): Promise<number> {
  const churchId = String(args.churchId || "").trim();
  const authorUserId = String(args.authorUserId || "").trim();
  if (!churchId) return 0;

  const recipients = await listActiveChurchMemberUserIds(churchId, authorUserId);
  let sent = 0;

  for (const targetUserId of recipients) {
    await createNotification({
      id: args.buildId(targetUserId),
      churchId,
      type: args.type,
      title: args.title,
      message: args.message,
      targetUserId,
      actorName: publicActorName(args.actorName),
      actorUserId: args.actorUserId || authorUserId || undefined,
    });
    sent += 1;
  }

  return sent;
}

export async function notifyChurchAnnouncementPosted(args: {
  churchId: string;
  announcementId: string;
  title: string;
  authorUserId: string;
}): Promise<number> {
  const churchId = String(args.churchId || "").trim();
  const announcementId = String(args.announcementId || "").trim();
  const authorUserId = String(args.authorUserId || "").trim();
  const title = String(args.title || "").trim();
  if (!churchId || !announcementId) return 0;

  const body = title || "A new announcement was shared with your church.";

  return fanOutChurchMemberNotifications({
    churchId,
    authorUserId,
    buildId: (targetUserId) => announcementNotificationId(announcementId, targetUserId),
    type: "ChurchAnnouncementPosted",
    title: "New church announcement",
    message: body,
  });
}

function readFeedField(item: unknown, body: unknown, key: string): string {
  return String((item as any)?.[key] || (body as any)?.[key] || "").trim().toLowerCase();
}

export function classifyChurchFeedPostForNotification(
  item: unknown,
  body?: unknown
): ChurchFeedPostNotificationKind | null {
  const source = readFeedField(item, body, "source");
  const kind = readFeedField(item, body, "kind") || readFeedField(item, body, "postType");
  const type = readFeedField(item, body, "type");

  if (source.includes("media-schedule")) return null;

  if (kind === "testimony" || source === "testimony" || type === "testimony") {
    return "testimony";
  }

  if (
    kind === "prayer_request" ||
    kind === "prayer" ||
    source === "prayer" ||
    source.includes("prayer")
  ) {
    return "prayer_request";
  }

  const hasVideo =
    type === "video" ||
    source === "media-upload" ||
    Boolean(String((item as any)?.videoUrl || (body as any)?.videoUrl || "").trim());

  if (hasVideo) {
    return "media";
  }

  return null;
}

function feedPostNotificationCopy(
  kind: ChurchFeedPostNotificationKind,
  item: unknown
): { type: NotificationType; title: string; message: string } {
  const caption = shortCaption(item);

  switch (kind) {
    case "testimony":
      return {
        type: "ChurchTestimonyPosted",
        title: "New testimony shared",
        message: caption ? caption : "A church member shared a new testimony.",
      };
    case "prayer_request":
      return {
        type: "ChurchPrayerRequestPosted",
        title: "New prayer request",
        message: caption ? caption : "A church member shared a prayer request.",
      };
    case "media":
      return {
        type: "ChurchMediaPosted",
        title: "New church media",
        message: caption ? caption : "New media was shared with your church.",
      };
  }
}

export async function notifyChurchFeedPostPublished(args: {
  churchId: string;
  postId: string;
  authorUserId: string;
  item: unknown;
  body?: unknown;
  actorName?: string;
}): Promise<number> {
  const churchId = String(args.churchId || "").trim();
  const postId = String(args.postId || "").trim();
  const authorUserId = String(args.authorUserId || "").trim();
  if (!churchId || !postId) return 0;

  const kind = classifyChurchFeedPostForNotification(args.item, args.body);
  if (!kind) return 0;

  const copy = feedPostNotificationCopy(kind, args.item);

  return fanOutChurchMemberNotifications({
    churchId,
    authorUserId,
    buildId: (targetUserId) => feedPostNotificationId(kind, postId, targetUserId),
    type: copy.type,
    title: copy.title,
    message: copy.message,
    actorName: publicActorName(args.actorName),
    actorUserId: authorUserId,
  });
}
