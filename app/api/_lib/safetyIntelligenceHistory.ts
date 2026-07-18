/**
 * Pure Safety Intelligence history helpers + timeline types.
 * No DB / path-alias runtime imports — safe for harness unit tests.
 */

export type SafetyIntelligenceEventKind =
  | "decision"
  | "enforcement"
  | "appeal";

export type SafetyIntelligenceOutcomeType =
  | "warning"
  | "remove_content"
  | "restrict_account"
  | "suspend_account"
  | "permanent_ban"
  | "no_violation"
  | "dismissed"
  | "appeal_upheld"
  | "appeal_rejected";

export type SafetyTargetEnforcementHistoryItem = {
  at: string;
  type: SafetyIntelligenceOutcomeType | string;
  reportId?: string;
  reason?: string;
};

export type SafetyTargetIntelligenceTimeline = {
  firstReportAt: string | null;
  lastReportAt: string | null;
  previousWarnings: number;
  previousSuspensions: number;
  previousRestrictions: number;
  previousRemovals: number;
  previousPermanentBans: number;
  confirmedViolations: number;
  noViolationDismissals: number;
  repeatedCategories: string[];
  trend: {
    reports7d: number;
    reports30d: number;
    reports90d: number;
    lifetime: number;
    direction:
      | "increasing"
      | "stable"
      | "declining"
      | "insufficient_data";
  };
  enforcementHistory: SafetyTargetEnforcementHistoryItem[];
};

export type SafetyReporterAccuracyPoint = {
  at: string;
  reportId: string;
  outcomeType: string;
  isConfirmedViolation: boolean;
  isDismissed: boolean;
  isMaliciousReport: boolean;
  runningConfirmed: number;
  runningDismissed: number;
};

export type SafetyReporterRepeatedTarget = {
  targetKey: string;
  targetType?: string;
  targetId?: string;
  targetOwnerUserId?: string;
  count: number;
};

export type SafetyReporterIntelligenceTimeline = {
  lifetimeReports: number;
  confirmedReports: number;
  dismissedReports: number;
  maliciousReports: number;
  accuracyProgression: SafetyReporterAccuracyPoint[];
  repeatedTargetingPattern: SafetyReporterRepeatedTarget[];
  reports: Array<{
    reportId: string;
    at: string;
    outcomeType: string;
    category?: string;
    targetKey?: string;
    isConfirmedViolation: boolean;
    isDismissed: boolean;
    isMaliciousReport: boolean;
  }>;
};

export type SafetyIntelligenceTimelines = {
  target: SafetyTargetIntelligenceTimeline;
  reporter: SafetyReporterIntelligenceTimeline;
};

const FINALIZED_OUTCOME_TYPES = new Set([
  "warning",
  "remove_content",
  "restrict_account",
  "suspend_account",
  "permanent_ban",
  "no_violation",
]);

function safeText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function safeLower(value: unknown) {
  return safeText(value).toLowerCase();
}

/** True when decision_type should become a learning ledger row. */
export function isFinalizedLearningDecisionType(
  decisionType: unknown
): boolean {
  return FINALIZED_OUTCOME_TYPES.has(safeLower(decisionType));
}

/**
 * Malicious / false-report flag — only when reason/notes clearly say so.
 * No guessing from dismissals alone.
 */
export function isMaliciousReportSignal(
  reason?: unknown,
  notes?: unknown
): boolean {
  const text = `${safeLower(reason)} ${safeLower(notes)}`;
  if (!text.trim()) return false;
  return (
    text.includes("false report") ||
    text.includes("false reporting") ||
    text.includes("malicious report") ||
    text.includes("malicious reporting") ||
    text.includes("bad faith report") ||
    text.includes("fabricated report") ||
    text.includes("abuse of reporting")
  );
}

export function isConfirmedViolationOutcome(
  decisionType: unknown
): boolean {
  const t = safeLower(decisionType);
  return (
    t === "warning" ||
    t === "remove_content" ||
    t === "restrict_account" ||
    t === "suspend_account" ||
    t === "permanent_ban"
  );
}

export function emptySafetyIntelligenceTimelines(): SafetyIntelligenceTimelines {
  return {
    target: {
      firstReportAt: null,
      lastReportAt: null,
      previousWarnings: 0,
      previousSuspensions: 0,
      previousRestrictions: 0,
      previousRemovals: 0,
      previousPermanentBans: 0,
      confirmedViolations: 0,
      noViolationDismissals: 0,
      repeatedCategories: [],
      trend: {
        reports7d: 0,
        reports30d: 0,
        reports90d: 0,
        lifetime: 0,
        direction: "insufficient_data",
      },
      enforcementHistory: [],
    },
    reporter: {
      lifetimeReports: 0,
      confirmedReports: 0,
      dismissedReports: 0,
      maliciousReports: 0,
      accuracyProgression: [],
      repeatedTargetingPattern: [],
      reports: [],
    },
  };
}

/** Unique ledger identity for one finalized report outcome. */
export function ledgerEventDedupeKey(
  reportId: unknown,
  eventKind: unknown,
  outcomeType: unknown
): string {
  return `${safeText(reportId)}|${safeLower(eventKind)}|${safeLower(outcomeType)}`;
}

/**
 * In-memory model of the unique index:
 * (report_id, event_kind, outcome_type) WHERE report_id IS NOT NULL
 */
export function tryInsertLedgerDedupeKey(
  store: Set<string>,
  reportId: unknown,
  eventKind: unknown,
  outcomeType: unknown
): { inserted: boolean; key: string } {
  const key = ledgerEventDedupeKey(reportId, eventKind, outcomeType);
  if (!safeText(reportId) || store.has(key)) {
    return { inserted: false, key };
  }
  store.add(key);
  return { inserted: true, key };
}

export type LedgerOutcomeEvent = {
  outcomeType: string;
  decisionAt?: string;
  reportId?: string;
  decisionReason?: string;
  category?: string;
  targetType?: string;
  targetId?: string;
  targetOwnerUserId?: string;
  isConfirmedViolation: boolean;
  isDismissed: boolean;
  isMaliciousReport: boolean;
  /** Open/unfinalized rows must never enter accuracy progression. */
  isOpen?: boolean;
};

/** Target enforcement/confirmed counts — finalized ledger outcomes only. */
export function summarizeTargetFinalizedOutcomes(
  events: LedgerOutcomeEvent[]
): {
  previousWarnings: number;
  previousSuspensions: number;
  previousRestrictions: number;
  previousRemovals: number;
  previousPermanentBans: number;
  confirmedViolations: number;
  noViolationDismissals: number;
  enforcementHistory: SafetyTargetEnforcementHistoryItem[];
} {
  let previousWarnings = 0;
  let previousSuspensions = 0;
  let previousRestrictions = 0;
  let previousRemovals = 0;
  let previousPermanentBans = 0;
  let confirmedViolations = 0;
  let noViolationDismissals = 0;
  const enforcementHistory: SafetyTargetEnforcementHistoryItem[] = [];

  for (const event of events) {
    if (event.isOpen) continue;
    const outcome = safeLower(event.outcomeType);
    if (!isFinalizedLearningDecisionType(outcome) && outcome !== "dismissed") {
      continue;
    }
    if (event.isConfirmedViolation) confirmedViolations += 1;
    if (event.isDismissed || outcome === "no_violation") {
      noViolationDismissals += 1;
    }
    if (outcome === "warning") previousWarnings += 1;
    if (outcome === "suspend_account") previousSuspensions += 1;
    if (outcome === "restrict_account") previousRestrictions += 1;
    if (outcome === "remove_content") previousRemovals += 1;
    if (outcome === "permanent_ban") previousPermanentBans += 1;
    if (isConfirmedViolationOutcome(outcome)) {
      enforcementHistory.push({
        at: safeText(event.decisionAt),
        type: outcome,
        reportId: safeText(event.reportId) || undefined,
        reason: safeText(event.decisionReason) || undefined,
      });
    }
  }

  return {
    previousWarnings,
    previousSuspensions,
    previousRestrictions,
    previousRemovals,
    previousPermanentBans,
    confirmedViolations,
    noViolationDismissals,
    enforcementHistory,
  };
}

/** Reporter accuracy — finalized ledger rows only; open reports excluded. */
export function buildReporterAccuracyProgression(
  events: LedgerOutcomeEvent[]
): SafetyReporterAccuracyPoint[] {
  let runningConfirmed = 0;
  let runningDismissed = 0;
  const progression: SafetyReporterAccuracyPoint[] = [];

  for (const event of events) {
    if (event.isOpen) continue;
    const outcome = safeLower(event.outcomeType);
    if (!isFinalizedLearningDecisionType(outcome) && outcome !== "dismissed") {
      continue;
    }
    if (event.isConfirmedViolation) runningConfirmed += 1;
    if (event.isDismissed || outcome === "no_violation") {
      runningDismissed += 1;
    }
    progression.push({
      at: safeText(event.decisionAt),
      reportId: safeText(event.reportId) || "unknown",
      outcomeType: outcome,
      isConfirmedViolation: Boolean(event.isConfirmedViolation),
      isDismissed:
        Boolean(event.isDismissed) || outcome === "no_violation",
      isMaliciousReport: Boolean(event.isMaliciousReport),
      runningConfirmed,
      runningDismissed,
    });
  }

  return progression;
}

/** Decision commit must succeed even when ledger persistence throws. */
export function decisionSurvivesLedgerFailure(
  decisionCommitted: boolean,
  ledgerWriteSucceeded: boolean
): boolean {
  return decisionCommitted === true;
}

export const SAFETY_INTEL_BACKFILL_VERSION = "v1";
export const SAFETY_INTEL_BACKFILL_BATCH_SIZE = 500;
export const SAFETY_INTEL_BACKFILL_META_KEY = "intelligence_events_backfill_v1";
