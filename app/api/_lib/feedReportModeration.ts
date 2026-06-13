import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { getFeedItemById, upsertFeedItem } from "@/app/api/_lib/store/feedDb";
import {
  listReportsForChurch,
  MEDIA_REPORT_AUTO_HIDE_THRESHOLD,
  normalizeFeedReportPostId,
  uniqueReporterIdsFromReports,
} from "@/app/api/_lib/store/feedReportDb";

async function activeChurchMemberIdSet(churchId: string): Promise<Set<string>> {
  const cleanChurchId = String(churchId || "").trim();
  if (!cleanChurchId) return new Set();

  const members = await getMembershipsForChurch(cleanChurchId, "Active");
  return new Set(
    members.map((member) => String(member.userId || "").trim()).filter(Boolean)
  );
}

export async function countUniqueChurchMemberReportersForPost(
  postId: string,
  churchId: string
): Promise<number> {
  const cleanPostId = normalizeFeedReportPostId(postId);
  const cleanChurchId = String(churchId || "").trim();
  if (!cleanPostId || !cleanChurchId) return 0;

  const rows = (await listReportsForChurch(cleanChurchId)).filter(
    (row) => normalizeFeedReportPostId(row.postId) === cleanPostId
  );
  const reporterIds = uniqueReporterIdsFromReports(rows);
  if (!reporterIds.length) return 0;

  const memberIds = await activeChurchMemberIdSet(cleanChurchId);
  return reporterIds.filter((id) => memberIds.has(id)).length;
}

export function isFeedItemHiddenByReports(item: any): boolean {
  return item?.hiddenByReports === true;
}

export async function clearFeedItemHiddenByReports(postId: string): Promise<boolean> {
  const cleanPostId = normalizeFeedReportPostId(postId);
  if (!cleanPostId) return false;

  const item = await getFeedItemById(cleanPostId);
  if (!item || !isFeedItemHiddenByReports(item)) return false;

  const next = { ...item };
  delete (next as any).hiddenByReports;
  delete (next as any).hiddenByReportsAt;
  delete (next as any).reportHideUniqueCount;
  await upsertFeedItem(next);
  return true;
}

export async function maybeAutoHideFeedItemByReports(args: {
  postId: string;
  churchId: string;
}): Promise<{ hidden: boolean; uniqueReporterCount: number }> {
  const cleanPostId = normalizeFeedReportPostId(args.postId);
  const cleanChurchId = String(args.churchId || "").trim();
  if (!cleanPostId || !cleanChurchId) {
    return { hidden: false, uniqueReporterCount: 0 };
  }

  const uniqueReporterCount = await countUniqueChurchMemberReportersForPost(
    cleanPostId,
    cleanChurchId
  );
  if (uniqueReporterCount < MEDIA_REPORT_AUTO_HIDE_THRESHOLD) {
    return { hidden: false, uniqueReporterCount };
  }

  const item = await getFeedItemById(cleanPostId);
  if (!item) return { hidden: false, uniqueReporterCount };
  if (isFeedItemHiddenByReports(item)) {
    return { hidden: false, uniqueReporterCount };
  }

  const stamp = new Date().toISOString();
  await upsertFeedItem({
    ...item,
    hiddenByReports: true,
    hiddenByReportsAt: stamp,
    reportHideUniqueCount: uniqueReporterCount,
  });

  console.log("KRISTO_MEDIA_AUTO_HIDE_BY_REPORTS", {
    postId: cleanPostId,
    churchId: cleanChurchId,
    uniqueReporterCount,
    threshold: MEDIA_REPORT_AUTO_HIDE_THRESHOLD,
  });

  return { hidden: true, uniqueReporterCount };
}
