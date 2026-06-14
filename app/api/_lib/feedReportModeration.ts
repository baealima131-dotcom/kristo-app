import { getActiveMembership } from "@/app/api/_lib/memberships";
import { notifyContentAutoHidden } from "@/app/api/_lib/feedReportNotifications";
import { getFeedItemById, upsertFeedItem } from "@/app/api/_lib/store/feedDb";
import {
  FEED_REPORT_REASONS,
  listNonDismissedReportsForPost,
  listReportsForPost,
  normalizeFeedReportPostId,
  type FeedReportRecord,
  type FeedReportReason,
} from "@/app/api/_lib/store/feedReportDb";

export type ReportSeverityTier = "critical" | "ai" | "medium" | "low";

export type ReportSeverityRule = {
  tier: ReportSeverityTier;
  reasons: Set<FeedReportReason>;
  minUniqueUsers: number;
  minUniqueChurches: number;
  churchesOnly?: boolean;
  requireBoth?: boolean;
  logCode: string;
};

export const CRITICAL_REPORT_REASONS = new Set<FeedReportReason>([
  "Sexual Content",
  "Violence",
  "Harassment or Bullying",
  "Hate Speech",
]);

export const AI_REPORT_REASONS = new Set<FeedReportReason>([
  "AI-Generated Video or Audio",
]);

export const MEDIUM_REPORT_REASONS = new Set<FeedReportReason>([
  "Spam",
  "Copyright Violation",
  "Other",
]);

export const LOW_REPORT_REASONS = new Set<FeedReportReason>(["False Teaching"]);

export const REPORT_SEVERITY_RULES: ReportSeverityRule[] = [
  {
    tier: "critical",
    reasons: CRITICAL_REPORT_REASONS,
    minUniqueUsers: 10,
    minUniqueChurches: 5,
    logCode: "KRISTO_MEDIA_AUTO_HIDE_BY_REPORTS",
  },
  {
    tier: "ai",
    reasons: AI_REPORT_REASONS,
    minUniqueUsers: 0,
    minUniqueChurches: 5,
    churchesOnly: true,
    logCode: "KRISTO_MEDIA_AUTO_HIDE_AI_REPORTS",
  },
  {
    tier: "medium",
    reasons: MEDIUM_REPORT_REASONS,
    minUniqueUsers: 10,
    minUniqueChurches: 5,
    logCode: "KRISTO_MEDIA_AUTO_HIDE_BY_REPORTS",
  },
  {
    tier: "low",
    reasons: LOW_REPORT_REASONS,
    minUniqueUsers: 30,
    minUniqueChurches: 5,
    requireBoth: true,
    logCode: "KRISTO_MEDIA_FALSE_TEACHING_REVIEW_THRESHOLD",
  },
];

export function classifyReportReason(reason: unknown): ReportSeverityTier | "unknown" {
  const value = String(reason || "").trim() as FeedReportReason;
  if (CRITICAL_REPORT_REASONS.has(value)) return "critical";
  if (AI_REPORT_REASONS.has(value)) return "ai";
  if (MEDIUM_REPORT_REASONS.has(value)) return "medium";
  if (LOW_REPORT_REASONS.has(value)) return "low";
  if ((FEED_REPORT_REASONS as readonly string[]).includes(value)) return "medium";
  return "unknown";
}

export function severityLabel(tier: ReportSeverityTier | "unknown"): string {
  switch (tier) {
    case "critical":
      return "Critical";
    case "ai":
      return "AI content";
    case "medium":
      return "Medium";
    case "low":
      return "Theological review";
    default:
      return "Report";
  }
}

async function resolveReporterChurchIdMap(
  reports: FeedReportRecord[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const row of reports) {
    const reporterUserId = String(row.reporterUserId || "").trim();
    if (!reporterUserId || map.has(reporterUserId)) continue;

    const stored = String(row.reporterChurchId || "").trim();
    if (stored) {
      map.set(reporterUserId, stored);
      continue;
    }

    const active = await getActiveMembership(reporterUserId);
    const churchId = String(active?.churchId || "").trim();
    if (churchId) map.set(reporterUserId, churchId);
  }

  return map;
}

export type ReportAggregateStats = {
  uniqueUsers: number;
  uniqueChurches: number;
  reporterUserIds: string[];
  reporterChurchIds: string[];
};

export async function aggregateReportStats(
  reports: FeedReportRecord[]
): Promise<ReportAggregateStats> {
  const reporterChurchByUser = await resolveReporterChurchIdMap(reports);
  const reporterUserIds = [
    ...new Set(
      reports.map((row) => String(row.reporterUserId || "").trim()).filter(Boolean)
    ),
  ];
  const reporterChurchIds = [
    ...new Set(
      reporterUserIds
        .map((userId) => String(reporterChurchByUser.get(userId) || "").trim())
        .filter(Boolean)
    ),
  ];

  return {
    uniqueUsers: reporterUserIds.length,
    uniqueChurches: reporterChurchIds.length,
    reporterUserIds,
    reporterChurchIds,
  };
}

function reportsMatchingRule(reports: FeedReportRecord[], rule: ReportSeverityRule) {
  return reports.filter((row) =>
    rule.reasons.has(String(row.reason || "").trim() as FeedReportReason)
  );
}

function meetsSeverityRule(stats: ReportAggregateStats, rule: ReportSeverityRule): boolean {
  if (rule.churchesOnly) {
    return stats.uniqueChurches >= rule.minUniqueChurches;
  }
  if (rule.requireBoth) {
    return (
      stats.uniqueUsers >= rule.minUniqueUsers &&
      stats.uniqueChurches >= rule.minUniqueChurches
    );
  }
  return (
    stats.uniqueUsers >= rule.minUniqueUsers ||
    stats.uniqueChurches >= rule.minUniqueChurches
  );
}

export type PostReportModerationSummary = {
  postId: string;
  uniqueUsers: number;
  uniqueChurches: number;
  primaryReason: string;
  primarySeverity: ReportSeverityTier | "unknown";
  severityLabel: string;
  topReasons: string[];
  reasonBreakdown: Array<{
    reason: string;
    severity: ReportSeverityTier | "unknown";
    severityLabel: string;
    pendingCount: number;
    uniqueUsers: number;
    uniqueChurches: number;
  }>;
  autoHideEligible: boolean;
  triggeringRule?: ReportSeverityRule;
};

export async function buildPostReportModerationSummary(
  postId: string
): Promise<PostReportModerationSummary | null> {
  const cleanPostId = normalizeFeedReportPostId(postId);
  if (!cleanPostId) return null;

  const activeReports = listNonDismissedReportsForPost(await listReportsForPost(cleanPostId));
  if (!activeReports.length) return null;

  const globalStats = await aggregateReportStats(activeReports);
  const reasonCounts = new Map<string, number>();
  for (const row of activeReports) {
    const reason = String(row.reason || "").trim();
    if (!reason) continue;
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }

  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason]) => reason);

  const primaryReason = topReasons[0] || String(activeReports[0]?.reason || "").trim();
  const primarySeverity = classifyReportReason(primaryReason);

  const reasonBreakdown = await Promise.all(
    [...reasonCounts.keys()].map(async (reason) => {
      const subset = activeReports.filter((row) => String(row.reason || "").trim() === reason);
      const stats = await aggregateReportStats(subset);
      const severity = classifyReportReason(reason);
      return {
        reason,
        severity,
        severityLabel: severityLabel(severity),
        pendingCount: subset.length,
        uniqueUsers: stats.uniqueUsers,
        uniqueChurches: stats.uniqueChurches,
      };
    })
  );

  reasonBreakdown.sort((a, b) => b.pendingCount - a.pendingCount);

  let triggeringRule: ReportSeverityRule | undefined;
  for (const rule of REPORT_SEVERITY_RULES) {
    const subset = reportsMatchingRule(activeReports, rule);
    if (!subset.length) continue;
    const stats = await aggregateReportStats(subset);
    if (meetsSeverityRule(stats, rule)) {
      triggeringRule = rule;
      break;
    }
  }

  return {
    postId: cleanPostId,
    uniqueUsers: globalStats.uniqueUsers,
    uniqueChurches: globalStats.uniqueChurches,
    primaryReason,
    primarySeverity,
    severityLabel: severityLabel(primarySeverity),
    topReasons,
    reasonBreakdown,
    autoHideEligible: Boolean(triggeringRule),
    triggeringRule,
  };
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
  delete (next as any).reportHideUniqueChurchCount;
  delete (next as any).reportHideReason;
  delete (next as any).reportHideSeverity;
  delete (next as any).reportHideLogCode;
  await upsertFeedItem(next);
  return true;
}

export async function maybeAutoHideFeedItemByReports(args: {
  postId: string;
  churchId: string;
}): Promise<{
  hidden: boolean;
  uniqueUsers: number;
  uniqueChurches: number;
  logCode?: string;
}> {
  const cleanPostId = normalizeFeedReportPostId(args.postId);
  const cleanChurchId = String(args.churchId || "").trim();
  if (!cleanPostId || !cleanChurchId) {
    return { hidden: false, uniqueUsers: 0, uniqueChurches: 0 };
  }

  const summary = await buildPostReportModerationSummary(cleanPostId);
  if (!summary?.triggeringRule) {
    return {
      hidden: false,
      uniqueUsers: summary?.uniqueUsers || 0,
      uniqueChurches: summary?.uniqueChurches || 0,
    };
  }

  const item = await getFeedItemById(cleanPostId);
  if (!item) {
    return {
      hidden: false,
      uniqueUsers: summary.uniqueUsers,
      uniqueChurches: summary.uniqueChurches,
    };
  }
  if (isFeedItemHiddenByReports(item)) {
    return {
      hidden: false,
      uniqueUsers: summary.uniqueUsers,
      uniqueChurches: summary.uniqueChurches,
      logCode: summary.triggeringRule.logCode,
    };
  }

  const rule = summary.triggeringRule;
  const activeReports = listNonDismissedReportsForPost(await listReportsForPost(cleanPostId));
  const subset = reportsMatchingRule(activeReports, rule);
  const stats = await aggregateReportStats(subset);
  const stamp = new Date().toISOString();
  const primaryReason =
    [...new Set(subset.map((row) => String(row.reason || "").trim()).filter(Boolean))][0] ||
    summary.primaryReason;

  const authorUserId = String(
    (item as any)?.createdBy ||
      (item as any)?.authorId ||
      (item as any)?.actorUserId ||
      (item as any)?.postedByUserId ||
      ""
  ).trim();

  await upsertFeedItem({
    ...item,
    hiddenByReports: true,
    hiddenByReportsAt: stamp,
    reportHideUniqueCount: stats.uniqueUsers,
    reportHideUniqueChurchCount: stats.uniqueChurches,
    reportHideReason: primaryReason,
    reportHideSeverity: rule.tier,
    reportHideLogCode: rule.logCode,
  });

  console.log(rule.logCode, {
    postId: cleanPostId,
    churchId: cleanChurchId,
    severity: rule.tier,
    reason: primaryReason,
    uniqueUsers: stats.uniqueUsers,
    uniqueChurches: stats.uniqueChurches,
    minUniqueUsers: rule.minUniqueUsers,
    minUniqueChurches: rule.minUniqueChurches,
  });

  try {
    const notifyResult = await notifyContentAutoHidden({
      churchId: cleanChurchId,
      postId: cleanPostId,
      feedItem: item,
      authorUserId,
    });
    console.log("KRISTO_AUTO_HIDE_NOTIFY", {
      postId: cleanPostId,
      churchId: cleanChurchId,
      ...notifyResult,
    });
  } catch (notifyError: any) {
    console.log("KRISTO_AUTO_HIDE_NOTIFY_FAILED", {
      postId: cleanPostId,
      churchId: cleanChurchId,
      message: String(notifyError?.message || notifyError),
    });
  }

  return {
    hidden: true,
    uniqueUsers: stats.uniqueUsers,
    uniqueChurches: stats.uniqueChurches,
    logCode: rule.logCode,
  };
}

/** @deprecated Use buildPostReportModerationSummary for display counts. */
export async function countUniqueChurchMemberReportersForPost(
  postId: string,
  _churchId: string
): Promise<number> {
  const summary = await buildPostReportModerationSummary(postId);
  return summary?.uniqueUsers || 0;
}
