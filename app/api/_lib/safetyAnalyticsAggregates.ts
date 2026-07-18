/**
 * Safety Analytics Aggregates (Phase 2A).
 *
 * Pure, deterministic backend FACTS for future dashboards/system endpoints.
 * No DB / path-alias imports so the harness can unit-test it directly.
 *
 * Honesty rules (enforced here):
 *  - Open reports are never counted as finalized.
 *  - Confirmed violations come only from finalized confirmed outcomes.
 *  - Dismissed = no_violation outcome OR dismissed status.
 *  - Accuracy = confirmed / (confirmed + dismissed); null when denominator 0.
 *  - Average resolution uses rows with a real resolution_minutes only.
 *  - Duplicate ledger rows (same report_id + event_kind + outcome_type) are
 *    de-duplicated before counting so they cannot inflate facts.
 *  - false-positive / false-negative / appeal-success / reliability trend stay
 *    null until appeals/final-review ground truth exists. No synthetic metrics.
 *  - repeatedPatternCounts pass through pre-computed pattern facts only; no
 *    confidence is (re)computed here.
 */

export const SAFETY_ANALYTICS_AGGREGATES_VERSION = "v1";
export const SAFETY_ANALYTICS_DAY_MS = 24 * 60 * 60 * 1000;

const CONFIRMED_VIOLATION_OUTCOMES = new Set([
  "warning",
  "remove_content",
  "restrict_account",
  "suspend_account",
  "permanent_ban",
]);

/** Finalized decision outcomes (confirmed set + no_violation). */
const FINALIZED_OUTCOMES = new Set([
  "warning",
  "remove_content",
  "restrict_account",
  "suspend_account",
  "permanent_ban",
  "no_violation",
]);

export type SafetyAnalyticsCategoryTrend = {
  category: string;
  reportCount: number;
  finalizedCount: number;
  confirmedViolationCount: number;
  dismissedCount: number;
};

export type SafetyAnalyticsSupervisorDistribution = {
  supervisorUserId: string;
  finalizedDecisionCount: number;
  warningCount: number;
  removalCount: number;
  restrictionCount: number;
  suspensionCount: number;
  permanentBanCount: number;
  noViolationCount: number;
  averageResolutionMinutes: number | null;
};

export type SafetyAnalyticsPatternCount = {
  patternType: string;
  count: number;
};

export type SafetyAnalyticsAggregates = {
  generatedAt: string;
  finalizedDecisionCount: number;
  averageResolutionMinutes: number | null;
  categoryTrends: SafetyAnalyticsCategoryTrend[];
  targetRecurrence: {
    targetUserId: string | null;
    totalReports: number;
    finalizedReports: number;
    confirmedViolations: number;
    uniqueReporters: number;
    reportsLast7Days: number;
    reportsLast30Days: number;
    reportsLast90Days: number;
  };
  reporterOutcomes: {
    reporterUserId: string | null;
    finalizedReports: number;
    confirmedReports: number;
    dismissedReports: number;
    accuracyPercent: number | null;
  };
  supervisorDistribution: SafetyAnalyticsSupervisorDistribution[];
  churchSafetyVolume: {
    churchId: string | null;
    totalReports: number;
    openReports: number;
    finalizedReports: number;
    confirmedViolations: number;
    uniqueTargets: number;
    uniqueReporters: number;
  };
  repeatedPatternCounts: SafetyAnalyticsPatternCount[];
  falsePositiveRate: null;
  falseNegativeRate: null;
  appealSuccessRate: null;
  supervisorReliabilityTrend: null;
  limitations: string[];
};

/** One finalized decision row from kristo_safety_intelligence_events. */
export type AnalyticsLedgerRow = {
  reportId?: unknown;
  eventKind?: unknown;
  outcomeType?: unknown;
  category?: unknown;
  decidedByUserId?: unknown;
  decisionAt?: unknown;
  resolutionMinutes?: unknown;
};

/** One report row from kristo_safety_reports. */
export type AnalyticsReportRow = {
  id?: unknown;
  reporterUserId?: unknown;
  targetOwnerUserId?: unknown;
  churchId?: unknown;
  category?: unknown;
  status?: unknown;
  decisionType?: unknown;
  createdAt?: unknown;
};

export type SafetyAnalyticsAggregatesInput = {
  generatedAt?: string;
  nowMs?: number;
  ledgerRows?: AnalyticsLedgerRow[];
  reportRows?: AnalyticsReportRow[];
  targetUserId?: string | null;
  reporterUserId?: string | null;
  churchId?: string | null;
  patternCounts?: Array<{ patternType?: unknown; count?: unknown }>;
};

function safeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function safeLower(value: unknown): string {
  return safeText(value).toLowerCase();
}

function nonNegInt(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function realNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMs(value: unknown): number | null {
  const t = safeText(value);
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** confirmed / (confirmed + dismissed); null when the denominator is 0. */
export function computeAccuracyPercent(
  confirmed: unknown,
  dismissed: unknown
): number | null {
  const c = nonNegInt(confirmed);
  const d = nonNegInt(dismissed);
  const denom = c + d;
  if (denom <= 0) return null;
  return Math.round((c / denom) * 100);
}

/** Normalize a category label; blank/malformed becomes "unknown". */
export function normalizeAnalyticsCategory(value: unknown): string {
  const c = safeLower(value);
  return c || "unknown";
}

function reportIsConfirmed(row: AnalyticsReportRow): boolean {
  return CONFIRMED_VIOLATION_OUTCOMES.has(safeLower(row.decisionType));
}

function reportIsDismissed(row: AnalyticsReportRow): boolean {
  return (
    safeLower(row.decisionType) === "no_violation" ||
    safeLower(row.status) === "dismissed"
  );
}

function reportIsFinalized(row: AnalyticsReportRow): boolean {
  return reportIsConfirmed(row) || reportIsDismissed(row);
}

/** Count report rows created within the last `days` relative to `nowMs`. */
export function countReportsInWindow(
  rows: AnalyticsReportRow[],
  nowMs: number,
  days: number
): number {
  if (!Array.isArray(rows)) return 0;
  const cutoff = nowMs - days * SAFETY_ANALYTICS_DAY_MS;
  let count = 0;
  for (const row of rows) {
    const created = parseMs(row.createdAt);
    if (created == null) continue;
    if (created >= cutoff && created <= nowMs) count += 1;
  }
  return count;
}

/**
 * De-duplicate ledger rows by (report_id, event_kind, outcome_type),
 * mirroring the DB unique index so duplicates cannot inflate counts.
 */
function dedupeLedgerRows(rows: AnalyticsLedgerRow[]): AnalyticsLedgerRow[] {
  const seen = new Set<string>();
  const out: AnalyticsLedgerRow[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const reportId = safeText(row.reportId);
    const eventKind = safeLower(row.eventKind) || "decision";
    const outcome = safeLower(row.outcomeType);
    if (!outcome) continue;
    // Only finalized decision outcomes participate in analytics counts.
    if (eventKind !== "decision" || !FINALIZED_OUTCOMES.has(outcome)) continue;
    const key = reportId
      ? `${reportId}|${eventKind}|${outcome}`
      : `__norid__|${out.length}`;
    if (reportId) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(row);
  }
  return out;
}

export function summarizeCategoryTrends(
  reportRows: AnalyticsReportRow[]
): SafetyAnalyticsCategoryTrend[] {
  const map = new Map<string, SafetyAnalyticsCategoryTrend>();
  for (const row of Array.isArray(reportRows) ? reportRows : []) {
    const category = normalizeAnalyticsCategory(row.category);
    let entry = map.get(category);
    if (!entry) {
      entry = {
        category,
        reportCount: 0,
        finalizedCount: 0,
        confirmedViolationCount: 0,
        dismissedCount: 0,
      };
      map.set(category, entry);
    }
    entry.reportCount += 1;
    if (reportIsFinalized(row)) entry.finalizedCount += 1;
    if (reportIsConfirmed(row)) entry.confirmedViolationCount += 1;
    if (reportIsDismissed(row)) entry.dismissedCount += 1;
  }
  return [...map.values()].sort(
    (a, b) => b.reportCount - a.reportCount || a.category.localeCompare(b.category)
  );
}

export function summarizeSupervisorDistribution(
  ledgerRows: AnalyticsLedgerRow[]
): SafetyAnalyticsSupervisorDistribution[] {
  const deduped = dedupeLedgerRows(ledgerRows);
  type Acc = {
    supervisorUserId: string;
    finalizedDecisionCount: number;
    warningCount: number;
    removalCount: number;
    restrictionCount: number;
    suspensionCount: number;
    permanentBanCount: number;
    noViolationCount: number;
    resolutionSum: number;
    resolutionCount: number;
  };
  const map = new Map<string, Acc>();
  for (const row of deduped) {
    const supervisorUserId = safeText(row.decidedByUserId);
    if (!supervisorUserId) continue;
    let acc = map.get(supervisorUserId);
    if (!acc) {
      acc = {
        supervisorUserId,
        finalizedDecisionCount: 0,
        warningCount: 0,
        removalCount: 0,
        restrictionCount: 0,
        suspensionCount: 0,
        permanentBanCount: 0,
        noViolationCount: 0,
        resolutionSum: 0,
        resolutionCount: 0,
      };
      map.set(supervisorUserId, acc);
    }
    const outcome = safeLower(row.outcomeType);
    acc.finalizedDecisionCount += 1;
    if (outcome === "warning") acc.warningCount += 1;
    else if (outcome === "remove_content") acc.removalCount += 1;
    else if (outcome === "restrict_account") acc.restrictionCount += 1;
    else if (outcome === "suspend_account") acc.suspensionCount += 1;
    else if (outcome === "permanent_ban") acc.permanentBanCount += 1;
    else if (outcome === "no_violation") acc.noViolationCount += 1;

    const resolution = realNumberOrNull(row.resolutionMinutes);
    if (resolution != null) {
      acc.resolutionSum += resolution;
      acc.resolutionCount += 1;
    }
  }
  return [...map.values()]
    .map((acc) => ({
      supervisorUserId: acc.supervisorUserId,
      finalizedDecisionCount: acc.finalizedDecisionCount,
      warningCount: acc.warningCount,
      removalCount: acc.removalCount,
      restrictionCount: acc.restrictionCount,
      suspensionCount: acc.suspensionCount,
      permanentBanCount: acc.permanentBanCount,
      noViolationCount: acc.noViolationCount,
      averageResolutionMinutes:
        acc.resolutionCount > 0
          ? Math.round(acc.resolutionSum / acc.resolutionCount)
          : null,
    }))
    .sort(
      (a, b) =>
        b.finalizedDecisionCount - a.finalizedDecisionCount ||
        a.supervisorUserId.localeCompare(b.supervisorUserId)
    );
}

function summarizeTargetRecurrence(
  reportRows: AnalyticsReportRow[],
  targetUserId: string | null,
  nowMs: number
): SafetyAnalyticsAggregates["targetRecurrence"] {
  const scopeId = safeText(targetUserId) || null;
  const scoped = scopeId
    ? (Array.isArray(reportRows) ? reportRows : []).filter(
        (r) => safeText(r.targetOwnerUserId) === scopeId
      )
    : [];
  const uniqueReporters = new Set<string>();
  let finalizedReports = 0;
  let confirmedViolations = 0;
  for (const row of scoped) {
    const reporter = safeText(row.reporterUserId);
    if (reporter) uniqueReporters.add(reporter);
    if (reportIsFinalized(row)) finalizedReports += 1;
    if (reportIsConfirmed(row)) confirmedViolations += 1;
  }
  return {
    targetUserId: scopeId,
    totalReports: scoped.length,
    finalizedReports,
    confirmedViolations,
    uniqueReporters: uniqueReporters.size,
    reportsLast7Days: countReportsInWindow(scoped, nowMs, 7),
    reportsLast30Days: countReportsInWindow(scoped, nowMs, 30),
    reportsLast90Days: countReportsInWindow(scoped, nowMs, 90),
  };
}

function summarizeReporterOutcomes(
  reportRows: AnalyticsReportRow[],
  reporterUserId: string | null
): SafetyAnalyticsAggregates["reporterOutcomes"] {
  const scopeId = safeText(reporterUserId) || null;
  const scoped = scopeId
    ? (Array.isArray(reportRows) ? reportRows : []).filter(
        (r) => safeText(r.reporterUserId) === scopeId
      )
    : [];
  let finalizedReports = 0;
  let confirmedReports = 0;
  let dismissedReports = 0;
  for (const row of scoped) {
    if (reportIsFinalized(row)) finalizedReports += 1;
    if (reportIsConfirmed(row)) confirmedReports += 1;
    if (reportIsDismissed(row)) dismissedReports += 1;
  }
  return {
    reporterUserId: scopeId,
    finalizedReports,
    confirmedReports,
    dismissedReports,
    accuracyPercent: computeAccuracyPercent(confirmedReports, dismissedReports),
  };
}

function summarizeChurchVolume(
  reportRows: AnalyticsReportRow[],
  churchId: string | null
): SafetyAnalyticsAggregates["churchSafetyVolume"] {
  const scopeId = safeText(churchId) || null;
  const scoped = scopeId
    ? (Array.isArray(reportRows) ? reportRows : []).filter(
        (r) => safeText(r.churchId) === scopeId
      )
    : [];
  const uniqueTargets = new Set<string>();
  const uniqueReporters = new Set<string>();
  let openReports = 0;
  let finalizedReports = 0;
  let confirmedViolations = 0;
  for (const row of scoped) {
    const target = safeText(row.targetOwnerUserId);
    if (target) uniqueTargets.add(target);
    const reporter = safeText(row.reporterUserId);
    if (reporter) uniqueReporters.add(reporter);
    if (reportIsFinalized(row)) finalizedReports += 1;
    else openReports += 1;
    if (reportIsConfirmed(row)) confirmedViolations += 1;
  }
  return {
    churchId: scopeId,
    totalReports: scoped.length,
    openReports,
    finalizedReports,
    confirmedViolations,
    uniqueTargets: uniqueTargets.size,
    uniqueReporters: uniqueReporters.size,
  };
}

function normalizePatternCounts(
  input: Array<{ patternType?: unknown; count?: unknown }> | undefined
): SafetyAnalyticsPatternCount[] {
  const out: SafetyAnalyticsPatternCount[] = [];
  for (const row of Array.isArray(input) ? input : []) {
    const patternType = safeText(row?.patternType);
    if (!patternType) continue;
    out.push({ patternType, count: nonNegInt(row?.count) });
  }
  return out.sort(
    (a, b) => b.count - a.count || a.patternType.localeCompare(b.patternType)
  );
}

/**
 * Assemble analytics-ready facts from real rows. Deterministic given inputs.
 * FP/FN/appeal-success/reliability-trend remain null by contract.
 */
export function computeSafetyAnalyticsAggregates(
  input: SafetyAnalyticsAggregatesInput
): SafetyAnalyticsAggregates {
  const generatedAt = safeText(input.generatedAt) || new Date().toISOString();
  const nowMs =
    typeof input.nowMs === "number" && Number.isFinite(input.nowMs)
      ? input.nowMs
      : Date.now();

  const dedupedLedger = dedupeLedgerRows(input.ledgerRows || []);
  const finalizedDecisionCount = dedupedLedger.length;

  let resolutionSum = 0;
  let resolutionCount = 0;
  for (const row of dedupedLedger) {
    const resolution = realNumberOrNull(row.resolutionMinutes);
    if (resolution != null) {
      resolutionSum += resolution;
      resolutionCount += 1;
    }
  }
  const averageResolutionMinutes =
    resolutionCount > 0 ? Math.round(resolutionSum / resolutionCount) : null;

  const reportRows = Array.isArray(input.reportRows) ? input.reportRows : [];

  const limitations: string[] = [
    "rates_require_appeals_and_final_review_ground_truth",
  ];
  if (finalizedDecisionCount === 0) {
    limitations.push("no_finalized_decisions_in_ledger");
  }
  if (reportRows.length === 0) {
    limitations.push("no_report_rows_available");
  }

  return {
    generatedAt,
    finalizedDecisionCount,
    averageResolutionMinutes,
    categoryTrends: summarizeCategoryTrends(reportRows),
    targetRecurrence: summarizeTargetRecurrence(
      reportRows,
      input.targetUserId ?? null,
      nowMs
    ),
    reporterOutcomes: summarizeReporterOutcomes(
      reportRows,
      input.reporterUserId ?? null
    ),
    supervisorDistribution: summarizeSupervisorDistribution(
      input.ledgerRows || []
    ),
    churchSafetyVolume: summarizeChurchVolume(
      reportRows,
      input.churchId ?? null
    ),
    repeatedPatternCounts: normalizePatternCounts(input.patternCounts),
    falsePositiveRate: null,
    falseNegativeRate: null,
    appealSuccessRate: null,
    supervisorReliabilityTrend: null,
    limitations,
  };
}
