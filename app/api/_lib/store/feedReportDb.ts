import { neon, neonConfig } from "@neondatabase/serverless";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";
import {
  classifyFeedReportSeverity,
  feedReportSeverityLabel,
  isAutoHideEligibleReport,
  normalizeFeedReportReason,
  type FeedReportSeverity,
} from "@/app/api/_lib/feedReportPolicy";
import { getFeedItemById, upsertFeedItem } from "@/app/api/_lib/store/feedDb";

neonConfig.fetchConnectionCache = true;

export type FeedPostReport = {
  id: string;
  churchId: string;
  postId: string;
  reporterUserId: string;
  reporterChurchId: string;
  reason: string;
  details?: string;
  status: "pending" | "dismissed";
  createdAt: string;
};

export type FeedReportQueueRow = {
  postId: string;
  churchId: string;
  title: string;
  posterUri?: string;
  videoUrl?: string;
  pendingReportCount: number;
  uniqueReporterCount: number;
  uniqueChurchCount: number;
  primaryReason: string;
  primarySeverity: FeedReportSeverity;
  severityLabel: string;
  latestReportAt: string;
  topReasons: string[];
  reasonBreakdown: Array<{
    reason: string;
    severity: FeedReportSeverity;
    severityLabel: string;
    pendingCount: number;
    uniqueUsers: number;
    uniqueChurches: number;
  }>;
  autoHideEligible: boolean;
  hiddenByReports: boolean;
  reports: Array<{
    id: string;
    reason: string;
    details?: string;
    reporterUserId: string;
    reporterChurchId?: string;
    createdAt: string;
  }>;
};

const LOCAL_REPORTS_FILE = "church-feed-reports.json";

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

function usePostgres() {
  return hasDurableStore();
}

function nowIso() {
  return new Date().toISOString();
}

function reportId() {
  return `freport_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export async function ensureFeedReportStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Feed report database not configured");
  }
  if (usePostgres()) {
    await ensureFeedReportSchema();
  }
}

export function isFeedReportDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("feed report database not configured") ||
    message.includes("database_url not configured")
  );
}

export async function ensureFeedReportSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_church_feed_reports (
          id TEXT PRIMARY KEY,
          church_id TEXT NOT NULL,
          post_id TEXT NOT NULL,
          reporter_user_id TEXT NOT NULL,
          reporter_church_id TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL,
          details TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_reports_post_idx
        ON kristo_church_feed_reports (post_id, status)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_reports_church_idx
        ON kristo_church_feed_reports (church_id, status, created_at DESC)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_church_feed_reports_unique_user_post
        ON kristo_church_feed_reports (post_id, reporter_user_id)
      `;
    })();
  }
  await schemaReady;
}

async function readLocalReports(): Promise<FeedPostReport[]> {
  const rows = await readJsonFile<FeedPostReport[]>(LOCAL_REPORTS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalReports(rows: FeedPostReport[]) {
  await writeJsonFile(LOCAL_REPORTS_FILE, rows);
}

function rowToReport(row: any): FeedPostReport {
  return {
    id: String(row.id || ""),
    churchId: String(row.church_id || row.churchId || ""),
    postId: String(row.post_id || row.postId || ""),
    reporterUserId: String(row.reporter_user_id || row.reporterUserId || ""),
    reporterChurchId: String(row.reporter_church_id || row.reporterChurchId || ""),
    reason: String(row.reason || ""),
    details: String(row.details || "").trim() || undefined,
    status: String(row.status || "pending") === "dismissed" ? "dismissed" : "pending",
    createdAt: String(row.created_at || row.createdAt || nowIso()),
  };
}

export async function hasUserReportedPost(userId: string, postId: string): Promise<boolean> {
  await ensureFeedReportStoreReady();
  const uid = String(userId || "").trim();
  const pid = String(postId || "").trim();
  if (!uid || !pid) return false;

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT id
      FROM kristo_church_feed_reports
      WHERE post_id = ${pid} AND reporter_user_id = ${uid}
      LIMIT 1
    `;
    return (rows as any[]).length > 0;
  }

  const all = await readLocalReports();
  return all.some((row) => row.postId === pid && row.reporterUserId === uid);
}

export async function getReportedPostIdsForUser(
  userId: string,
  postIds: string[]
): Promise<string[]> {
  await ensureFeedReportStoreReady();
  const uid = String(userId || "").trim();
  const ids = [...new Set(postIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (!uid || !ids.length) return [];

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT post_id
      FROM kristo_church_feed_reports
      WHERE reporter_user_id = ${uid}
        AND post_id = ANY(${ids})
    `;
    return (rows as any[]).map((row) => String(row.post_id || "")).filter(Boolean);
  }

  const all = await readLocalReports();
  const wanted = new Set(ids);
  return all
    .filter((row) => row.reporterUserId === uid && wanted.has(row.postId))
    .map((row) => row.postId);
}

export async function submitFeedPostReport(args: {
  postId: string;
  reporterUserId: string;
  reporterChurchId: string;
  reason: string;
  details?: string;
}): Promise<{ created: boolean; duplicate: boolean; report: FeedPostReport | null }> {
  await ensureFeedReportStoreReady();

  const pid = String(args.postId || "").trim();
  const uid = String(args.reporterUserId || "").trim();
  const reporterChurchId = String(args.reporterChurchId || "").trim();
  const reason = normalizeFeedReportReason(args.reason);
  const details = String(args.details || "").trim();

  if (!pid || !uid || !reason) {
    throw new Error("postId, reporterUserId, and reason are required");
  }

  const feedItem = await getFeedItemById(pid);
  const churchId = String(feedItem?.churchId || reporterChurchId || "").trim();
  if (!churchItemExists(feedItem)) {
    throw new Error("Post not found");
  }

  const duplicate = await hasUserReportedPost(uid, pid);
  if (duplicate) {
    return { created: false, duplicate: true, report: null };
  }

  const next: FeedPostReport = {
    id: reportId(),
    churchId,
    postId: pid,
    reporterUserId: uid,
    reporterChurchId,
    reason,
    details: details || undefined,
    status: "pending",
    createdAt: nowIso(),
  };

  if (usePostgres()) {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_church_feed_reports (
        id, church_id, post_id, reporter_user_id, reporter_church_id, reason, details, status, created_at
      ) VALUES (
        ${next.id},
        ${next.churchId},
        ${next.postId},
        ${next.reporterUserId},
        ${next.reporterChurchId},
        ${next.reason},
        ${next.details || null},
        ${next.status},
        ${next.createdAt}
      )
      ON CONFLICT (post_id, reporter_user_id) DO NOTHING
    `;
  } else {
    const all = await readLocalReports();
    all.push(next);
    await writeLocalReports(all);
  }

  await maybeAutoHideFeedPost(pid);

  return { created: true, duplicate: false, report: next };
}

function churchItemExists(item: unknown) {
  return Boolean(item && typeof item === "object" && String((item as any).id || "").trim());
}

async function listPendingReportsForPost(postId: string): Promise<FeedPostReport[]> {
  const pid = String(postId || "").trim();
  if (!pid) return [];

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT id, church_id, post_id, reporter_user_id, reporter_church_id, reason, details, status, created_at
      FROM kristo_church_feed_reports
      WHERE post_id = ${pid} AND status = 'pending'
      ORDER BY created_at DESC
    `;
    return (rows as any[]).map(rowToReport);
  }

  const all = await readLocalReports();
  return all.filter((row) => row.postId === pid && row.status === "pending");
}

async function maybeAutoHideFeedPost(postId: string) {
  const item = await getFeedItemById(postId);
  if (!item || item.hiddenByReports === true) return;

  const pending = await listPendingReportsForPost(postId);
  if (!pending.length) return;

  const uniqueReporterCount = new Set(pending.map((row) => row.reporterUserId)).size;
  const uniqueChurchCount = new Set(
    pending.map((row) => String(row.reporterChurchId || row.churchId || "").trim()).filter(Boolean)
  ).size;

  const reasonCounts = new Map<string, number>();
  for (const row of pending) {
    reasonCounts.set(row.reason, (reasonCounts.get(row.reason) || 0) + 1);
  }
  const primaryReason =
    [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || pending[0]?.reason || "Other";
  const severity = classifyFeedReportSeverity(primaryReason);

  if (
    !isAutoHideEligibleReport({
      severity,
      uniqueReporterCount,
      uniqueChurchCount,
      primaryReason,
    })
  ) {
    return;
  }

  await upsertFeedItem({
    ...item,
    hiddenByReports: true,
    hiddenByReportsAt: nowIso(),
  });
}

function buildQueueRow(postId: string, reports: FeedPostReport[], item: any): FeedReportQueueRow {
  const pending = reports.filter((row) => row.status === "pending");
  const reasonMap = new Map<
    string,
    { pendingCount: number; users: Set<string>; churches: Set<string> }
  >();

  for (const row of pending) {
    const bucket = reasonMap.get(row.reason) || {
      pendingCount: 0,
      users: new Set<string>(),
      churches: new Set<string>(),
    };
    bucket.pendingCount += 1;
    bucket.users.add(row.reporterUserId);
    const church = String(row.reporterChurchId || row.churchId || "").trim();
    if (church) bucket.churches.add(church);
    reasonMap.set(row.reason, bucket);
  }

  const reasonBreakdown = [...reasonMap.entries()]
    .map(([reason, bucket]) => {
      const severity = classifyFeedReportSeverity(reason);
      return {
        reason,
        severity,
        severityLabel: feedReportSeverityLabel(severity),
        pendingCount: bucket.pendingCount,
        uniqueUsers: bucket.users.size,
        uniqueChurches: bucket.churches.size,
      };
    })
    .sort((a, b) => b.pendingCount - a.pendingCount);

  const primaryReason = reasonBreakdown[0]?.reason || pending[0]?.reason || "Other";
  const primarySeverity = classifyFeedReportSeverity(primaryReason);
  const uniqueReporterCount = new Set(pending.map((row) => row.reporterUserId)).size;
  const uniqueChurchCount = new Set(
    pending.map((row) => String(row.reporterChurchId || row.churchId || "").trim()).filter(Boolean)
  ).size;

  return {
    postId,
    churchId: String(item?.churchId || pending[0]?.churchId || ""),
    title: String(item?.title || item?.text || "Reported post"),
    posterUri: String(item?.posterUri || item?.videoPosterUri || item?.thumbnailUri || ""),
    videoUrl: String(item?.videoUrl || item?.mediaUri || ""),
    pendingReportCount: pending.length,
    uniqueReporterCount,
    uniqueChurchCount,
    primaryReason,
    primarySeverity,
    severityLabel: feedReportSeverityLabel(primarySeverity),
    latestReportAt: pending[0]?.createdAt || "",
    topReasons: reasonBreakdown.slice(0, 3).map((row) => row.reason),
    reasonBreakdown,
    autoHideEligible: isAutoHideEligibleReport({
      severity: primarySeverity,
      uniqueReporterCount,
      uniqueChurchCount,
      primaryReason,
    }),
    hiddenByReports: item?.hiddenByReports === true,
    reports: pending.slice(0, 20).map((row) => ({
      id: row.id,
      reason: row.reason,
      details: row.details,
      reporterUserId: row.reporterUserId,
      reporterChurchId: row.reporterChurchId,
      createdAt: row.createdAt,
    })),
  };
}

export async function listFeedReportQueueForChurch(churchId: string): Promise<FeedReportQueueRow[]> {
  await ensureFeedReportStoreReady();
  const cid = String(churchId || "").trim();
  if (!cid) return [];

  let reports: FeedPostReport[] = [];

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT id, church_id, post_id, reporter_user_id, reporter_church_id, reason, details, status, created_at
      FROM kristo_church_feed_reports
      WHERE church_id = ${cid} AND status = 'pending'
      ORDER BY created_at DESC
    `;
    reports = (rows as any[]).map(rowToReport);
  } else {
    const all = await readLocalReports();
    reports = all.filter((row) => row.churchId === cid && row.status === "pending");
  }

  const byPost = new Map<string, FeedPostReport[]>();
  for (const row of reports) {
    const bucket = byPost.get(row.postId) || [];
    bucket.push(row);
    byPost.set(row.postId, bucket);
  }

  const items: FeedReportQueueRow[] = [];
  for (const [postId, postReports] of byPost.entries()) {
    const item = await getFeedItemById(postId);
    if (!item) continue;
    items.push(buildQueueRow(postId, postReports, item));
  }

  items.sort((a, b) => String(b.latestReportAt).localeCompare(String(a.latestReportAt)));
  return items;
}

export async function dismissFeedReportsForPost(postId: string): Promise<number> {
  await ensureFeedReportStoreReady();
  const pid = String(postId || "").trim();
  if (!pid) return 0;

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      UPDATE kristo_church_feed_reports
      SET status = 'dismissed'
      WHERE post_id = ${pid} AND status = 'pending'
      RETURNING id
    `;
    return (rows as any[]).length;
  }

  const all = await readLocalReports();
  let count = 0;
  for (const row of all) {
    if (row.postId === pid && row.status === "pending") {
      row.status = "dismissed";
      count += 1;
    }
  }
  if (count) await writeLocalReports(all);
  return count;
}

export async function clearFeedReportHiddenFlag(postId: string) {
  const item = await getFeedItemById(postId);
  if (!item || item.hiddenByReports !== true) return;
  await upsertFeedItem({
    ...item,
    hiddenByReports: false,
    hiddenByReportsAt: undefined,
  });
}
