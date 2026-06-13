import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type FeedReportStatus = "pending" | "reviewed" | "actioned" | "dismissed";

export const MEDIA_REPORT_AUTO_HIDE_THRESHOLD = 10;

export type FeedReportRecord = {
  id: string;
  postId: string;
  reporterUserId: string;
  reporterChurchId?: string;
  reportedUserId?: string;
  churchId?: string;
  mediaId?: string;
  reason: string;
  details?: string;
  status: FeedReportStatus;
  createdAt: string;
  updatedAt: string;
  reviewedByUserId?: string;
};

const REPORTS_FILE = "church-feed-reports.json";

export const FEED_REPORT_REASONS = [
  "Spam",
  "Harassment or Bullying",
  "Hate Speech",
  "Violence",
  "Sexual Content",
  "False Teaching",
  "Copyright Violation",
  "AI-Generated Video or Audio",
  "Other",
] as const;

export type FeedReportReason = (typeof FEED_REPORT_REASONS)[number];

function nowIso() {
  return new Date().toISOString();
}

function newReportId() {
  return `report_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeFeedReportPostId(raw: unknown) {
  const id = String(raw || "")
    .trim()
    .replace(/__fy_\d+$/g, "");
  if (!id) return "";
  return id.split("__slot_")[0];
}

async function readReports(): Promise<FeedReportRecord[]> {
  const rows = await readJsonFile<FeedReportRecord[]>(REPORTS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

export async function findFeedReport(postId: string, reporterUserId: string) {
  const cleanPostId = normalizeFeedReportPostId(postId);
  const cleanReporter = String(reporterUserId || "").trim();
  if (!cleanPostId || !cleanReporter) return null;

  const rows = await readReports();
  return (
    rows.find(
      (row) =>
        normalizeFeedReportPostId(row.postId) === cleanPostId &&
        String(row.reporterUserId || "").trim() === cleanReporter
    ) || null
  );
}

export async function listReportedPostIdsForUser(
  reporterUserId: string,
  postIds: string[]
) {
  const cleanReporter = String(reporterUserId || "").trim();
  if (!cleanReporter) return [] as string[];

  const wanted = new Set(
    postIds.map((id) => normalizeFeedReportPostId(id)).filter(Boolean)
  );
  if (!wanted.size) return [] as string[];

  const rows = await readReports();
  const reported: string[] = [];
  for (const row of rows) {
    if (String(row.reporterUserId || "").trim() !== cleanReporter) continue;
    const pid = normalizeFeedReportPostId(row.postId);
    if (pid && wanted.has(pid)) reported.push(pid);
  }
  return reported;
}

export type CreateFeedReportInput = {
  postId: string;
  reporterUserId: string;
  reporterChurchId?: string;
  reportedUserId?: string;
  churchId?: string;
  mediaId?: string;
  reason: string;
  details?: string;
};

export type CreateFeedReportResult =
  | { ok: true; duplicate: false; record: FeedReportRecord }
  | { ok: true; duplicate: true; alreadyReported: true; record: FeedReportRecord };

export async function createFeedReport(
  input: CreateFeedReportInput
): Promise<CreateFeedReportResult> {
  const postId = normalizeFeedReportPostId(input.postId);
  const reporterUserId = String(input.reporterUserId || "").trim();
  const reason = String(input.reason || "").trim();
  const details = String(input.details || "").trim();

  if (!postId) throw new Error("postId is required");
  if (!reporterUserId) throw new Error("reporterUserId is required");
  if (!reason) throw new Error("reason is required");
  if (!FEED_REPORT_REASONS.includes(reason as FeedReportReason)) {
    throw new Error("Invalid report reason");
  }

  const existing = await findFeedReport(postId, reporterUserId);
  if (existing) {
    return {
      ok: true,
      duplicate: true,
      alreadyReported: true,
      record: existing,
    };
  }

  const stamp = nowIso();
  const record: FeedReportRecord = {
    id: newReportId(),
    postId,
    reporterUserId,
    reporterChurchId: String(input.reporterChurchId || "").trim() || undefined,
    reportedUserId: String(input.reportedUserId || "").trim() || undefined,
    churchId: String(input.churchId || "").trim() || undefined,
    mediaId: String(input.mediaId || "").trim() || undefined,
    reason,
    details: details || undefined,
    status: "pending",
    createdAt: stamp,
    updatedAt: stamp,
  };

  await updateJsonFile<FeedReportRecord[]>(
    REPORTS_FILE,
    (current) => {
      const rows = Array.isArray(current) ? current : [];
      return [record, ...rows];
    },
    []
  );

  return { ok: true, duplicate: false, record };
}

export async function listReportsForChurch(churchId: string): Promise<FeedReportRecord[]> {
  const cleanChurchId = String(churchId || "").trim();
  if (!cleanChurchId) return [];

  const rows = await readReports();
  return rows.filter((row) => String(row.churchId || "").trim() === cleanChurchId);
}

export async function listPendingReportsForPost(
  postId: string,
  churchId?: string
): Promise<FeedReportRecord[]> {
  const cleanPostId = normalizeFeedReportPostId(postId);
  if (!cleanPostId) return [];

  const cleanChurchId = String(churchId || "").trim();
  const rows = await readReports();
  return rows.filter((row) => {
    if (normalizeFeedReportPostId(row.postId) !== cleanPostId) return false;
    if (String(row.status || "").trim() !== "pending") return false;
    if (cleanChurchId && String(row.churchId || "").trim() !== cleanChurchId) return false;
    return true;
  });
}

export function uniqueReporterIdsFromReports(rows: FeedReportRecord[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    const reporterUserId = String(row.reporterUserId || "").trim();
    if (!reporterUserId || seen.has(reporterUserId)) continue;
    seen.add(reporterUserId);
    ids.push(reporterUserId);
  }
  return ids;
}

export function uniqueReporterChurchIdsFromReports(rows: FeedReportRecord[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    const reporterChurchId = String(row.reporterChurchId || "").trim();
    if (!reporterChurchId || seen.has(reporterChurchId)) continue;
    seen.add(reporterChurchId);
    ids.push(reporterChurchId);
  }
  return ids;
}

export async function listReportsForPost(postId: string): Promise<FeedReportRecord[]> {
  const cleanPostId = normalizeFeedReportPostId(postId);
  if (!cleanPostId) return [];

  const rows = await readReports();
  return rows.filter((row) => normalizeFeedReportPostId(row.postId) === cleanPostId);
}

export function listNonDismissedReportsForPost(rows: FeedReportRecord[]): FeedReportRecord[] {
  return rows.filter((row) => String(row.status || "").trim() !== "dismissed");
}

export async function dismissPendingReportsForPost(args: {
  postId: string;
  churchId: string;
  reviewerUserId: string;
}): Promise<number> {
  const cleanPostId = normalizeFeedReportPostId(args.postId);
  const cleanChurchId = String(args.churchId || "").trim();
  const reviewerUserId = String(args.reviewerUserId || "").trim();
  if (!cleanPostId || !cleanChurchId) return 0;

  const stamp = nowIso();
  let updatedCount = 0;

  await updateJsonFile<FeedReportRecord[]>(
    REPORTS_FILE,
    (current) => {
      const rows = Array.isArray(current) ? current : [];
      return rows.map((row) => {
        if (normalizeFeedReportPostId(row.postId) !== cleanPostId) return row;
        if (String(row.churchId || "").trim() !== cleanChurchId) return row;
        if (String(row.status || "").trim() !== "pending") return row;

        updatedCount += 1;
        return {
          ...row,
          status: "dismissed" as FeedReportStatus,
          updatedAt: stamp,
          reviewedByUserId: reviewerUserId,
        };
      });
    },
    []
  );

  return updatedCount;
}

export async function markPendingReportsActionedForPost(args: {
  postId: string;
  churchId: string;
  reviewerUserId: string;
}): Promise<number> {
  const cleanPostId = normalizeFeedReportPostId(args.postId);
  const cleanChurchId = String(args.churchId || "").trim();
  const reviewerUserId = String(args.reviewerUserId || "").trim();
  if (!cleanPostId || !cleanChurchId) return 0;

  const stamp = nowIso();
  let updatedCount = 0;

  await updateJsonFile<FeedReportRecord[]>(
    REPORTS_FILE,
    (current) => {
      const rows = Array.isArray(current) ? current : [];
      return rows.map((row) => {
        if (normalizeFeedReportPostId(row.postId) !== cleanPostId) return row;
        if (String(row.churchId || "").trim() !== cleanChurchId) return row;
        if (String(row.status || "").trim() !== "pending") return row;

        updatedCount += 1;
        return {
          ...row,
          status: "actioned" as FeedReportStatus,
          updatedAt: stamp,
          reviewedByUserId: reviewerUserId,
        };
      });
    },
    []
  );

  return updatedCount;
}

export type MediaReportQueueItem = {
  postId: string;
  churchId: string;
  pendingReportCount: number;
  uniqueReporterCount: number;
  latestReportAt: string;
  topReasons: string[];
  hiddenByReports: boolean;
  reports: FeedReportRecord[];
};

export async function listMediaReportQueueForChurch(
  churchId: string,
  options?: { hiddenByPostId?: Record<string, boolean> }
): Promise<MediaReportQueueItem[]> {
  const cleanChurchId = String(churchId || "").trim();
  if (!cleanChurchId) return [];

  const rows = await listReportsForChurch(cleanChurchId);
  const grouped = new Map<string, FeedReportRecord[]>();

  for (const row of rows) {
    if (String(row.status || "").trim() !== "pending") continue;
    const postId = normalizeFeedReportPostId(row.postId);
    if (!postId) continue;
    const bucket = grouped.get(postId) || [];
    bucket.push(row);
    grouped.set(postId, bucket);
  }

  const queue: MediaReportQueueItem[] = [];
  for (const [postId, reports] of grouped.entries()) {
    const sorted = reports
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const reasonCounts = new Map<string, number>();
    for (const report of sorted) {
      const reason = String(report.reason || "").trim();
      if (!reason) continue;
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    const topReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason]) => reason);

    queue.push({
      postId,
      churchId: cleanChurchId,
      pendingReportCount: sorted.length,
      uniqueReporterCount: uniqueReporterIdsFromReports(sorted).length,
      latestReportAt: String(sorted[0]?.createdAt || ""),
      topReasons,
      hiddenByReports: Boolean(options?.hiddenByPostId?.[postId]),
      reports: sorted,
    });
  }

  return queue.sort((a, b) => String(b.latestReportAt).localeCompare(String(a.latestReportAt)));
}
