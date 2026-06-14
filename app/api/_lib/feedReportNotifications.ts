import { getStoredMediaHosts, resolveActualChurchPastorUserId } from "@/app/api/_lib/churchMediaAccess";
import { createNotification } from "@/app/api/_lib/notifications";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";

const REPORT_ADMIN_BODY =
  "A church member reported a video/post. Review it in Media Studio → Reports.";

const AUTO_HIDE_ADMIN_TITLE = "Content auto-hidden after reports";
const AUTO_HIDE_ADMIN_BODY =
  "A post was auto-hidden after crossing the report threshold. Review it in Media Studio → Reports.";

const AUTO_HIDE_AUTHOR_TITLE = "Your content was hidden";
const AUTO_HIDE_AUTHOR_BODY =
  "Your post was hidden after multiple reports. Review details in Media Studio → Reports or contact your church leaders.";

function reportReceivedNotificationId(reportId: string, targetUserId: string) {
  return `ntf_report_${reportId}_${targetUserId}`;
}

function autoHideAdminNotificationId(postId: string, targetUserId: string) {
  return `ntf_autohide_admin_${postId}_${targetUserId}`;
}

function autoHideAuthorNotificationId(postId: string, authorUserId: string) {
  return `ntf_autohide_author_${postId}_${authorUserId}`;
}

function resolveFeedAuthorUserId(feedItem: unknown): string {
  return String(
    (feedItem as any)?.createdBy ||
      (feedItem as any)?.authorId ||
      (feedItem as any)?.actorUserId ||
      (feedItem as any)?.postedByUserId ||
      ""
  ).trim();
}

export async function listContentReportAdminRecipientIds(
  churchId: string,
  excludeUserIds: Iterable<string> = []
): Promise<string[]> {
  const cid = String(churchId || "").trim();
  if (!cid) return [];

  const excluded = new Set(
    [...excludeUserIds].map((id) => String(id || "").trim()).filter(Boolean)
  );
  const ids = new Set<string>();

  const members = await getMembershipsForChurch(cid, "Active");
  for (const member of members) {
    const role = String(member.churchRole || "").trim();
    if (role !== "Pastor" && role !== "Church_Admin" && role !== "System_Admin") continue;
    const userId = String(member.userId || "").trim();
    if (userId && !excluded.has(userId)) ids.add(userId);
  }

  const pastorUserId = await resolveActualChurchPastorUserId(cid);
  if (pastorUserId && !excluded.has(pastorUserId)) ids.add(pastorUserId);

  const hosts = await getStoredMediaHosts(cid);
  for (const host of hosts) {
    const userId = String(host.userId || "").trim();
    if (userId && !excluded.has(userId)) ids.add(userId);
  }

  return [...ids];
}

export async function notifyContentReportReceived(args: {
  churchId: string;
  reportId: string;
  postId: string;
  reporterUserId: string;
}): Promise<number> {
  const churchId = String(args.churchId || "").trim();
  const reportId = String(args.reportId || "").trim();
  const reporterUserId = String(args.reporterUserId || "").trim();
  if (!churchId || !reportId) return 0;

  const recipients = await listContentReportAdminRecipientIds(churchId, [reporterUserId]);
  let sent = 0;

  for (const targetUserId of recipients) {
    await createNotification({
      id: reportReceivedNotificationId(reportId, targetUserId),
      churchId,
      type: "ContentReportReceived",
      title: "New content report",
      message: REPORT_ADMIN_BODY,
      targetUserId,
    });
    sent += 1;
  }

  return sent;
}

export async function notifyContentAutoHidden(args: {
  churchId: string;
  postId: string;
  feedItem?: unknown;
  authorUserId?: string;
}): Promise<{ adminCount: number; authorNotified: boolean }> {
  const churchId = String(args.churchId || "").trim();
  const postId = String(args.postId || "").trim();
  if (!churchId || !postId) return { adminCount: 0, authorNotified: false };

  const authorUserId =
    String(args.authorUserId || "").trim() || resolveFeedAuthorUserId(args.feedItem);

  let adminCount = 0;
  const adminRecipients = await listContentReportAdminRecipientIds(churchId);

  for (const targetUserId of adminRecipients) {
    await createNotification({
      id: autoHideAdminNotificationId(postId, targetUserId),
      churchId,
      type: "ContentAutoHiddenAdmin",
      title: AUTO_HIDE_ADMIN_TITLE,
      message: AUTO_HIDE_ADMIN_BODY,
      targetUserId,
    });
    adminCount += 1;
  }

  let authorNotified = false;
  if (authorUserId) {
    await createNotification({
      id: autoHideAuthorNotificationId(postId, authorUserId),
      churchId,
      type: "ContentAutoHiddenAuthor",
      title: AUTO_HIDE_AUTHOR_TITLE,
      message: AUTO_HIDE_AUTHOR_BODY,
      targetUserId: authorUserId,
    });
    authorNotified = true;
  }

  return { adminCount, authorNotified };
}
