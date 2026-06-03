import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type FeedReportStatus = "pending" | "reviewed" | "actioned" | "dismissed";

export type FeedReportRecord = {
  id: string;
  postId: string;
  reporterUserId: string;
  reportedUserId?: string;
  churchId?: string;
  mediaId?: string;
  reason: string;
  details?: string;
  status: FeedReportStatus;
  createdAt: string;
  updatedAt: string;
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
