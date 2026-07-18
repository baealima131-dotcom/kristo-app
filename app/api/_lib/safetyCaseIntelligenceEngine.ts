/**
 * Heuristic Case Intelligence Engine.
 *
 * Decision-support only — never auto-enforces.
 * Scores are computed only from real finalized history / verified evidence.
 * Missing denominators → null + insufficient_data (no fabricated baselines).
 * analysisMode stays "heuristic" until an LLM/classifier is wired.
 */

import type { SafetyIntelligenceTimelines } from "./safetyIntelligenceHistory.ts";
import type { SafetyConfidenceCalibration } from "./safetyConfidenceCalibration.ts";
import type { SafetyEvidenceClassifierResult } from "./safetyEvidenceIntelligence.ts";
import type { SafetySupervisorReliability } from "./safetySupervisorReliability.ts";
import type { SafetyCrossCaseGraphResult } from "./safetyCrossCaseGraph.ts";

export type { SafetyIntelligenceTimelines };
export type { SafetyConfidenceCalibration };
export type { SafetyEvidenceClassifierResult };
export type { SafetySupervisorReliability };
export type { SafetyCrossCaseGraphResult };

/**
 * Outcome-learning facts surfaced on the Case Intelligence contract.
 * Mirrors SafetyOutcomeLearningMetadata but excludes evidenceUrlHash (the hash
 * is a storage/linking detail and is never exposed in the response).
 */
export type SafetyCaseOutcomeLearning = {
  severityScore: number | null;
  severityMapVersion: string | null;
  resolutionMinutes: number | null;
  investigatorConfidence: number | null;
  appealFiled: boolean;
  appealOutcome: string | null;
  finalOutcomeWeight: number | null;
};

function emptySafetyIntelligenceTimelines(): SafetyIntelligenceTimelines {
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

export type CaseIntelligenceStatus =
  | "ready"
  | "insufficient_data"
  | "error";

export type CaseIntelligenceCredibilityLevel =
  | "low"
  | "medium"
  | "high"
  | "trusted"
  | "unknown";

export type CaseIntelligenceSignalLevel =
  | "low"
  | "moderate"
  | "high"
  | "critical"
  | "unknown";

export type CaseIntelligenceRecommendation =
  | "human_review"
  | "no_violation"
  | "monitor"
  | "warning"
  | "remove_content"
  | "restrict_account"
  | "suspend_account"
  | "permanent_ban"
  | "escalate";

export type CaseIntelligencePattern = {
  type: string;
  severity: "low" | "medium" | "high";
  title: string;
  explanation: string;
  supportingCount?: number;
};

export type CaseIntelligenceDataQuality = {
  reporterHistoryAvailable: boolean;
  targetHistoryAvailable: boolean;
  evidenceVerified: boolean;
  finalizedReporterCases: number;
  finalizedTargetCases: number;
  limitations: string[];
};

export type SafetyCaseIntelligence = {
  status: CaseIntelligenceStatus;
  analysisMode: "heuristic";
  generatedAt: string;
  dataQuality: CaseIntelligenceDataQuality;
  reporter: {
    credibilityScore: number | null;
    credibilityLevel: CaseIntelligenceCredibilityLevel;
    lifetimeReports: number;
    confirmedReports: number;
    dismissedReports: number;
    accuracyPercent: number | null;
    abuseFlags: string[];
  };
  target: {
    riskScore: number | null;
    totalReports: number;
    uniqueReporters: number;
    activeReports: number;
    confirmedViolations: number;
    warnings: number;
    removals: number;
    restrictions: number;
    suspensions: number;
    permanentBans: number;
    repeatedCategories: string[];
    trend:
      | "increasing"
      | "stable"
      | "declining"
      | "unknown"
      | "insufficient_data";
    reportsLast7d: number;
    reportsLast30d: number;
    reportsLast90d: number;
  };
  evidence: {
    strengthScore: number | null;
    originalAvailable: boolean;
    snapshotAvailable: boolean;
    signals: string[];
    limitations: string[];
  };
  patterns: CaseIntelligencePattern[];
  assessment: {
    caseRiskScore: number | null;
    signalLevel: CaseIntelligenceSignalLevel;
    recommendation: CaseIntelligenceRecommendation;
    confidence: number | null;
    reasoning: string[];
    aggravatingFactors: string[];
    mitigatingFactors: string[];
    requiresHumanReview: true;
  };
  /** Historical timelines from the Safety Intelligence ledger (API/data only). */
  timelines?: SafetyIntelligenceTimelines;
  /** Honest confidence calibration facts (API/data only; recommendation unchanged). */
  calibration?: SafetyConfidenceCalibration;
  /**
   * Evidence classifier contract (Phase 2B). No provider is connected yet, so
   * this is an unverified, all-null result. API/data only; does not influence
   * the recommendation.
   */
  evidenceIntelligence?: SafetyEvidenceClassifierResult;
  /** Outcome-learning facts for the current finalized report (API/data only). */
  outcomeLearning?: SafetyCaseOutcomeLearning;
  /** Supervisor reliability facts for the decider (API/data only; null score). */
  supervisorReliability?: SafetySupervisorReliability;
  /** Cross-case pattern signals for the target scope (leads, not proof). */
  crossCaseGraph?: SafetyCrossCaseGraphResult;
};

/**
 * Named constants used only when real denominators exist.
 * No baseline fill-ins (no 50/52/68/79 defaults).
 */
export const CASE_INTELLIGENCE_WEIGHTS = {
  /** Minimum finalized reporter decisions before credibility is numeric. */
  MIN_FINALIZED_REPORTER_CASES: 2,

  CREDIBILITY_ACCURACY_WEIGHT: 0.7,
  CREDIBILITY_CONFIRMATION_WEIGHT: 0.3,
  CREDIBILITY_FALSE_REPORT_PENALTY: 35,
  CREDIBILITY_REPEAT_TARGET_PENALTY: 12,
  CREDIBILITY_DUPLICATE_BURST_PENALTY: 10,
  CREDIBILITY_LOW_ACCURACY_PENALTY: 20,

  TARGET_CONFIRMED_WEIGHT: 0.45,
  TARGET_ENFORCEMENT_WEIGHT: 0.35,
  TARGET_UNIQUE_REPORTERS_WEIGHT: 0.12,
  TARGET_FREQUENCY_WEIGHT: 0.08,

  CASE_RISK_TARGET_HISTORY: 0.4,
  CASE_RISK_EVIDENCE: 0.3,
  CASE_RISK_CORROBORATION: 0.15,
  CASE_RISK_PRIOR_ENFORCEMENT: 0.15,

  PERMANENT_BAN_MIN_CASE_RISK: 88,
  PERMANENT_BAN_MIN_EVIDENCE: 70,
  PERMANENT_BAN_MIN_CONFIRMED: 2,

  SUSPEND_MIN_CASE_RISK: 72,
  RESTRICT_MIN_CASE_RISK: 58,
  REMOVE_MIN_CASE_RISK: 48,
  WARNING_MIN_CASE_RISK: 34,
  MONITOR_MIN_CASE_RISK: 18,

  COORDINATED_UNIQUE_REPORTERS_24H: 4,
  COORDINATED_UNIQUE_REPORTERS_7D: 6,
  REPEAT_SAME_TARGET_BY_REPORTER: 3,
  DUPLICATE_BURST_SAME_REPORTER: 2,
} as const;

export type CaseIntelligenceRawInput = {
  reportId: string;
  category: string;
  reason: string;
  description?: string;
  priority: string;
  targetType: string;
  targetId?: string;
  targetOwnerUserId?: string;
  reporterUserId: string;
  originalContentAvailable: boolean;
  hasThumbnail: boolean;
  hasPreview: boolean;
  hasTitle: boolean;
  hasMediaUri: boolean;
  mediaType?: string;
  createdAt?: string;
  /** True only when a real classifier/LLM verified case evidence. */
  evidenceMachineVerified?: boolean;
  evidenceAttachmentCount?: number;

  reporterLifetimeReports: number;
  reporterConfirmedReports: number;
  reporterDismissedReports: number;
  reporterDuplicateOnThisTarget: number;
  reporterReportsOnThisTarget: number;
  reporterHasFalseReportingPenalty: boolean;

  targetTotalReports: number;
  targetUniqueReporters: number;
  targetActiveReports: number;
  targetResolvedReports: number;
  targetDismissedReports: number;
  targetEscalatedReports: number;
  targetConfirmedViolations: number;
  targetWarnings: number;
  targetRemovals: number;
  targetRestrictions: number;
  targetSuspensions: number;
  targetPermanentBans: number;
  targetReportsLast7d: number;
  targetReportsLast30d: number;
  targetReportsLast90d: number;
  targetUniqueReportersLast24h: number;
  targetUniqueReportersLast7d: number;
  repeatedCategories: string[];

  /** Optional ledger-backed timelines used for explainable reasoning. */
  timelines?: SafetyIntelligenceTimelines;
};

function timelineReasoning(
  timelines?: SafetyIntelligenceTimelines
): string[] {
  if (!timelines) return [];
  const lines: string[] = [];
  const { target, reporter } = timelines;

  if (target.firstReportAt) {
    lines.push(`Target first report at ${target.firstReportAt}.`);
  }
  if (target.lastReportAt) {
    lines.push(`Target last report at ${target.lastReportAt}.`);
  }
  if (target.previousWarnings > 0) {
    lines.push(
      `Target has ${target.previousWarnings} prior warning(s) in Safety history.`
    );
  }
  if (target.previousSuspensions > 0) {
    lines.push(
      `Target has ${target.previousSuspensions} prior suspension(s) in Safety history.`
    );
  }
  if (target.previousRestrictions > 0) {
    lines.push(
      `Target has ${target.previousRestrictions} prior restriction(s) in Safety history.`
    );
  }
  if (target.previousRemovals > 0) {
    lines.push(
      `Target has ${target.previousRemovals} prior content removal(s) in Safety history.`
    );
  }
  if (target.previousPermanentBans > 0) {
    lines.push(
      `Target has ${target.previousPermanentBans} prior permanent ban record(s).`
    );
  }
  if (target.confirmedViolations > 0) {
    lines.push(
      `Target has ${target.confirmedViolations} confirmed violation outcome(s).`
    );
  }
  if (target.repeatedCategories.length) {
    lines.push(
      `Repeated categories: ${target.repeatedCategories.join(", ")}.`
    );
  }
  if (target.trend.direction !== "insufficient_data") {
    lines.push(
      `Report trend (${target.trend.direction}) across 7d=${target.trend.reports7d}, 30d=${target.trend.reports30d}, 90d=${target.trend.reports90d}, lifetime=${target.trend.lifetime}.`
    );
  }

  if (reporter.confirmedReports > 0 || reporter.dismissedReports > 0) {
    lines.push(
      `Reporter finalized outcomes: ${reporter.confirmedReports} confirmed, ${reporter.dismissedReports} dismissed.`
    );
  }
  if (reporter.maliciousReports > 0) {
    lines.push(
      `Reporter has ${reporter.maliciousReports} malicious/false-report flag(s) from prior decisions.`
    );
  }
  if (reporter.repeatedTargetingPattern.length) {
    lines.push(
      `Reporter repeated targeting pattern on ${reporter.repeatedTargetingPattern.length} target(s).`
    );
  }
  if (reporter.accuracyProgression.length >= 2) {
    const last =
      reporter.accuracyProgression[
        reporter.accuracyProgression.length - 1
      ];
    lines.push(
      `Reporter accuracy progression through ${reporter.accuracyProgression.length} finalized cases (running confirmed=${last.runningConfirmed}, dismissed=${last.runningDismissed}).`
    );
  }

  return lines.slice(0, 8);
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function nonNegInt(value: unknown) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function categorySeverityBoost(category: unknown): number {
  const c = safeText(category).toLowerCase();
  if (!c) return 0;
  if (
    c.includes("child") ||
    c.includes("exploit") ||
    c.includes("terror") ||
    c.includes("violence")
  ) {
    return 18;
  }
  if (
    c.includes("harass") ||
    c.includes("hate") ||
    c.includes("threat") ||
    c.includes("sexual")
  ) {
    return 12;
  }
  if (c.includes("spam") || c.includes("scam") || c.includes("fraud")) {
    return 8;
  }
  return 0;
}

export function computeReporterCredibility(input: {
  lifetimeReports: number;
  confirmedReports: number;
  dismissedReports: number;
  duplicateOnThisTarget: number;
  reportsOnThisTarget: number;
  hasFalseReportingPenalty: boolean;
}): {
  credibilityScore: number | null;
  credibilityLevel: CaseIntelligenceCredibilityLevel;
  accuracyPercent: number | null;
  abuseFlags: string[];
  limitations: string[];
  finalizedDecisionCount: number;
} {
  const lifetime = nonNegInt(input.lifetimeReports);
  const confirmed = nonNegInt(input.confirmedReports);
  const dismissed = nonNegInt(input.dismissedReports);
  const finalizedDecisionCount = confirmed + dismissed;
  const abuseFlags: string[] = [];
  const limitations: string[] = [];

  if (finalizedDecisionCount === 0) {
    return {
      credibilityScore: null,
      credibilityLevel: "unknown",
      accuracyPercent: null,
      abuseFlags,
      limitations: ["insufficient_finalized_reporter_history"],
      finalizedDecisionCount: 0,
    };
  }

  if (
    finalizedDecisionCount <
    CASE_INTELLIGENCE_WEIGHTS.MIN_FINALIZED_REPORTER_CASES
  ) {
    limitations.push("insufficient_finalized_reporter_history");
    return {
      credibilityScore: null,
      credibilityLevel: "unknown",
      accuracyPercent:
        Math.round((confirmed / finalizedDecisionCount) * 1000) / 10,
      abuseFlags,
      limitations,
      finalizedDecisionCount,
    };
  }

  const accuracyPercent =
    Math.round((confirmed / finalizedDecisionCount) * 1000) / 10;

  let score =
    accuracyPercent * CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_ACCURACY_WEIGHT +
    Math.min(100, confirmed * 8) *
      CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_CONFIRMATION_WEIGHT;

  if (input.hasFalseReportingPenalty) {
    score -= CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_FALSE_REPORT_PENALTY;
    abuseFlags.push("prior_false_or_malicious_reporting_penalty");
  }

  if (
    input.reportsOnThisTarget >=
    CASE_INTELLIGENCE_WEIGHTS.REPEAT_SAME_TARGET_BY_REPORTER
  ) {
    score -= CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_REPEAT_TARGET_PENALTY;
    abuseFlags.push("repeated_reports_against_same_target");
  }

  if (
    input.duplicateOnThisTarget >=
    CASE_INTELLIGENCE_WEIGHTS.DUPLICATE_BURST_SAME_REPORTER
  ) {
    score -= CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_DUPLICATE_BURST_PENALTY;
    abuseFlags.push("duplicate_report_burst");
  }

  if (finalizedDecisionCount >= 5 && accuracyPercent < 25) {
    score -= CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_LOW_ACCURACY_PENALTY;
    abuseFlags.push("low_historical_accuracy");
  }

  const credibilityScore = clampScore(score);
  const credibilityLevel: CaseIntelligenceCredibilityLevel =
    credibilityScore >= 85
      ? "trusted"
      : credibilityScore >= 70
        ? "high"
        : credibilityScore >= 45
          ? "medium"
          : "low";

  return {
    credibilityScore,
    credibilityLevel,
    accuracyPercent,
    abuseFlags,
    limitations,
    finalizedDecisionCount,
  };
}

export function computeTargetRisk(input: {
  totalReports: number;
  uniqueReporters: number;
  confirmedViolations: number;
  warnings: number;
  removals: number;
  restrictions: number;
  suspensions: number;
  permanentBans: number;
  reportsLast7d: number;
  reportsLast30d: number;
  reportsLast90d: number;
}): {
  riskScore: number | null;
  trend:
    | "increasing"
    | "stable"
    | "declining"
    | "unknown"
    | "insufficient_data";
  finalizedTargetCases: number;
} {
  const confirmed = nonNegInt(input.confirmedViolations);
  const warnings = nonNegInt(input.warnings);
  const removals = nonNegInt(input.removals);
  const restrictions = nonNegInt(input.restrictions);
  const suspensions = nonNegInt(input.suspensions);
  const bans = nonNegInt(input.permanentBans);

  /*
   * Open/unresolved volume must not invent target risk.
   * Risk requires at least one confirmed violation or prior enforcement action.
   */
  const finalizedTargetCases =
    confirmed + warnings + removals + restrictions + suspensions + bans;

  if (confirmed === 0 && restrictions === 0 && suspensions === 0 && bans === 0) {
    return {
      riskScore: null,
      trend: "insufficient_data",
      finalizedTargetCases,
    };
  }

  const confirmedComponent = Math.min(
    100,
    confirmed * 18 + removals * 10 + warnings * 6
  );
  const enforcementComponent = Math.min(
    100,
    restrictions * 16 + suspensions * 22 + bans * 40
  );
  const uniqueComponent = Math.min(100, nonNegInt(input.uniqueReporters) * 12);
  const frequencyComponent = Math.min(
    100,
    nonNegInt(input.reportsLast7d) * 14 +
      nonNegInt(input.reportsLast30d) * 4 +
      Math.min(40, nonNegInt(input.reportsLast90d))
  );

  const riskScore = clampScore(
    confirmedComponent * CASE_INTELLIGENCE_WEIGHTS.TARGET_CONFIRMED_WEIGHT +
      enforcementComponent *
        CASE_INTELLIGENCE_WEIGHTS.TARGET_ENFORCEMENT_WEIGHT +
      uniqueComponent *
        CASE_INTELLIGENCE_WEIGHTS.TARGET_UNIQUE_REPORTERS_WEIGHT +
      frequencyComponent * CASE_INTELLIGENCE_WEIGHTS.TARGET_FREQUENCY_WEIGHT
  );

  let trend:
    | "increasing"
    | "stable"
    | "declining"
    | "unknown"
    | "insufficient_data" = "unknown";
  if (input.reportsLast90d > 0 || input.reportsLast30d > 0) {
    const recentRate = input.reportsLast7d;
    const olderWindow = Math.max(0, input.reportsLast30d - input.reportsLast7d);
    const olderWeekly = olderWindow / 3;
    if (recentRate > olderWeekly * 1.35 + 0.5) trend = "increasing";
    else if (recentRate + 0.5 < olderWeekly * 0.65) trend = "declining";
    else trend = "stable";
  }

  return { riskScore, trend, finalizedTargetCases };
}

export function computeEvidenceStrength(input: {
  originalAvailable: boolean;
  hasThumbnail: boolean;
  hasPreview: boolean;
  hasTitle: boolean;
  hasMediaUri: boolean;
  mediaType?: string;
  uniqueReporters: number;
  category: string;
  reason: string;
  description?: string;
  evidenceMachineVerified?: boolean;
  evidenceAttachmentCount?: number;
}): {
  strengthScore: number | null;
  snapshotAvailable: boolean;
  signals: string[];
  limitations: string[];
  evidenceVerified: boolean;
} {
  const signals: string[] = [];
  const limitations: string[] = [];

  if (input.originalAvailable) signals.push("original_content_available");
  else limitations.push("original_content_unavailable");

  const snapshotAvailable = Boolean(
    input.hasThumbnail || input.hasPreview || input.hasMediaUri
  );
  if (snapshotAvailable) signals.push("saved_snapshot_or_media_reference");
  else limitations.push("no_saved_media_snapshot");

  const mediaType = safeText(input.mediaType).toLowerCase();
  if (
    mediaType === "video" ||
    mediaType === "image" ||
    mediaType === "audio" ||
    input.hasMediaUri
  ) {
    signals.push(`media_type_${mediaType || "present"}`);
  } else if (input.hasPreview) {
    signals.push("text_or_comment_preview");
  } else {
    limitations.push("limited_media_or_text_evidence");
  }

  if (nonNegInt(input.evidenceAttachmentCount) > 0) {
    signals.push("evidence_attachments_present");
  }

  if (input.uniqueReporters > 1) {
    signals.push("corroborating_unique_reporters");
  }

  limitations.push("no_automated_content_classifier_or_llm_review_connected");
  limitations.push("evidence_quality_not_machine_verified");

  /*
   * Presence of original media alone is NOT a scored evidence strength.
   * Numeric strength requires machine-verified analysis.
   */
  if (!input.evidenceMachineVerified) {
    return {
      strengthScore: null,
      snapshotAvailable,
      signals,
      limitations,
      evidenceVerified: false,
    };
  }

  let score = 0;
  if (input.originalAvailable) score += 28;
  if (snapshotAvailable) score += 18;
  if (
    mediaType === "video" ||
    mediaType === "image" ||
    mediaType === "audio" ||
    input.hasMediaUri
  ) {
    score += 16;
  } else if (input.hasPreview) {
    score += 12;
  }
  const metadataBits = [
    input.hasTitle,
    Boolean(safeText(input.category)),
    Boolean(safeText(input.reason)),
    Boolean(safeText(input.description)),
  ].filter(Boolean).length;
  score += (metadataBits / 4) * 12;
  score += Math.min(14, Math.max(0, input.uniqueReporters - 1) * 5);
  score += Math.min(10, nonNegInt(input.evidenceAttachmentCount) * 2);

  return {
    strengthScore: clampScore(score),
    snapshotAvailable,
    signals,
    limitations: limitations.filter(
      (item) => item !== "evidence_quality_not_machine_verified"
    ),
    evidenceVerified: true,
  };
}

export function detectCasePatterns(
  input: CaseIntelligenceRawInput
): CaseIntelligencePattern[] {
  const patterns: CaseIntelligencePattern[] = [];

  if (input.targetConfirmedViolations >= 2) {
    patterns.push({
      type: "repeated_confirmed_violations",
      severity: input.targetConfirmedViolations >= 4 ? "high" : "medium",
      title: "Repeated confirmed violations",
      explanation:
        "This account/content lineage has multiple prior confirmed Safety decisions.",
      supportingCount: input.targetConfirmedViolations,
    });
  }

  if (input.repeatedCategories.length) {
    patterns.push({
      type: "recurring_category",
      severity: "medium",
      title: "Recurring report category",
      explanation: `Category pattern continues around: ${input.repeatedCategories
        .slice(0, 3)
        .join(", ")}.`,
      supportingCount: input.repeatedCategories.length,
    });
  }

  if (
    input.targetUniqueReportersLast24h >=
    CASE_INTELLIGENCE_WEIGHTS.COORDINATED_UNIQUE_REPORTERS_24H
  ) {
    patterns.push({
      type: "coordinated_reporting_suspicion",
      severity: "high",
      title: "Coordinated reporting suspicion",
      explanation:
        "Multiple unique reporters filed against the same target within 24 hours.",
      supportingCount: input.targetUniqueReportersLast24h,
    });
  } else if (
    input.targetUniqueReportersLast7d >=
    CASE_INTELLIGENCE_WEIGHTS.COORDINATED_UNIQUE_REPORTERS_7D
  ) {
    patterns.push({
      type: "multi_reporter_short_window",
      severity: "medium",
      title: "Multiple unique reporters in a short window",
      explanation:
        "Several distinct reporters targeted the same account/content within 7 days.",
      supportingCount: input.targetUniqueReportersLast7d,
    });
  }

  if (
    input.reporterReportsOnThisTarget >=
    CASE_INTELLIGENCE_WEIGHTS.REPEAT_SAME_TARGET_BY_REPORTER
  ) {
    patterns.push({
      type: "reporter_target_conflict",
      severity: "medium",
      title: "Reporter repeatedly targets the same user",
      explanation:
        "The current reporter has filed multiple reports against this same target.",
      supportingCount: input.reporterReportsOnThisTarget,
    });
  }

  if (
    input.reporterDuplicateOnThisTarget >=
    CASE_INTELLIGENCE_WEIGHTS.DUPLICATE_BURST_SAME_REPORTER
  ) {
    patterns.push({
      type: "duplicate_report_burst",
      severity: "low",
      title: "Duplicate report burst",
      explanation:
        "Duplicate or near-duplicate filings from the same reporter were detected on this target.",
      supportingCount: input.reporterDuplicateOnThisTarget,
    });
  }

  if (input.targetWarnings > 0 && input.targetConfirmedViolations > 0) {
    patterns.push({
      type: "prior_warning_ignored",
      severity: "high",
      title: "Prior warning followed by new violation",
      explanation:
        "The target previously received a warning and later accumulated confirmed violations.",
      supportingCount: input.targetWarnings,
    });
  }

  if (
    (input.targetRestrictions > 0 || input.targetSuspensions > 0) &&
    input.targetConfirmedViolations > 0
  ) {
    patterns.push({
      type: "prior_enforcement_then_violation",
      severity: "high",
      title: "Prior restriction/suspension then new violation",
      explanation:
        "Account enforcement history exists and new confirmed violations followed.",
      supportingCount: input.targetRestrictions + input.targetSuspensions,
    });
  }

  return patterns;
}

function signalLevelFromRisk(
  caseRiskScore: number | null
): CaseIntelligenceSignalLevel {
  if (caseRiskScore == null) return "unknown";
  if (caseRiskScore >= 80) return "critical";
  if (caseRiskScore >= 60) return "high";
  if (caseRiskScore >= 35) return "moderate";
  return "low";
}

export function computeInputConfidence(input: {
  reporterHistoryAvailable: boolean;
  targetHistoryAvailable: boolean;
  evidenceVerified: boolean;
  uniqueReporters: number;
  finalizedReporterCases: number;
  finalizedTargetCases: number;
}): number | null {
  const coverageBits = [
    input.reporterHistoryAvailable,
    input.targetHistoryAvailable,
    input.evidenceVerified,
  ];
  const availableCount = coverageBits.filter(Boolean).length;
  if (availableCount === 0) return null;

  let score = 0;
  if (input.reporterHistoryAvailable) {
    score += 30;
    score += Math.min(15, input.finalizedReporterCases * 3);
  }
  if (input.targetHistoryAvailable) {
    score += 30;
    score += Math.min(15, input.finalizedTargetCases * 3);
  }
  if (input.evidenceVerified) {
    score += 25;
  }
  if (input.uniqueReporters > 1) {
    score += Math.min(10, (input.uniqueReporters - 1) * 3);
  }

  const missingPenalty = (3 - availableCount) * 18;
  score -= missingPenalty;

  if (!input.evidenceVerified) return null;
  if (!input.reporterHistoryAvailable || !input.targetHistoryAvailable) {
    return null;
  }

  return clampScore(score);
}

export function computeCaseRecommendation(input: {
  caseRiskScore: number;
  evidenceScore: number;
  credibilityScore: number | null;
  confirmedViolations: number;
  suspensions: number;
  permanentBans: number;
  restrictions: number;
  category: string;
  targetType: string;
  coordinatedSuspicion: boolean;
}): {
  recommendation: CaseIntelligenceRecommendation;
  reasoning: string[];
  aggravatingFactors: string[];
  mitigatingFactors: string[];
} {
  const reasoning: string[] = [];
  const aggravatingFactors: string[] = [];
  const mitigatingFactors: string[] = [];

  const categoryBoost = categorySeverityBoost(input.category);
  if (categoryBoost >= 12) aggravatingFactors.push("elevated_category_severity");
  if (input.confirmedViolations > 0) {
    aggravatingFactors.push("prior_confirmed_violations");
  }
  if (input.suspensions > 0 || input.permanentBans > 0) {
    aggravatingFactors.push("prior_serious_enforcement");
  }
  if (input.coordinatedSuspicion) {
    aggravatingFactors.push("coordinated_reporting_suspicion");
  }
  if (input.credibilityScore != null && input.credibilityScore < 40) {
    mitigatingFactors.push("low_reporter_credibility");
  }

  let recommendation: CaseIntelligenceRecommendation = "monitor";
  const risk = input.caseRiskScore + Math.min(10, categoryBoost / 2);

  const priorSerious =
    input.suspensions > 0 ||
    input.permanentBans > 0 ||
    input.confirmedViolations >=
      CASE_INTELLIGENCE_WEIGHTS.PERMANENT_BAN_MIN_CONFIRMED;

  if (
    risk >= CASE_INTELLIGENCE_WEIGHTS.PERMANENT_BAN_MIN_CASE_RISK &&
    input.evidenceScore >= CASE_INTELLIGENCE_WEIGHTS.PERMANENT_BAN_MIN_EVIDENCE &&
    priorSerious
  ) {
    recommendation = "permanent_ban";
    reasoning.push(
      "Case risk, verified evidence, and prior serious enforcement jointly support permanent ban consideration."
    );
  } else if (risk >= CASE_INTELLIGENCE_WEIGHTS.SUSPEND_MIN_CASE_RISK) {
    recommendation =
      input.targetType === "account" || input.confirmedViolations >= 1
        ? "suspend_account"
        : "escalate";
    reasoning.push(
      "Elevated case risk and history support temporary suspension or escalation."
    );
  } else if (risk >= CASE_INTELLIGENCE_WEIGHTS.RESTRICT_MIN_CASE_RISK) {
    recommendation = "restrict_account";
    reasoning.push(
      "Moderate-high risk with recurring signals supports account restriction."
    );
  } else if (risk >= CASE_INTELLIGENCE_WEIGHTS.REMOVE_MIN_CASE_RISK) {
    recommendation =
      input.targetType === "account" ? "warning" : "remove_content";
    reasoning.push(
      "Verified evidence and case risk support content removal or a formal warning."
    );
  } else if (risk >= CASE_INTELLIGENCE_WEIGHTS.WARNING_MIN_CASE_RISK) {
    recommendation = "warning";
    reasoning.push(
      "Early verified violation signals are present but do not yet justify heavy enforcement."
    );
  } else if (risk >= CASE_INTELLIGENCE_WEIGHTS.MONITOR_MIN_CASE_RISK) {
    recommendation = "monitor";
    reasoning.push(
      "Signals are present but remain below warning thresholds; continue monitoring."
    );
  } else {
    recommendation = "no_violation";
    reasoning.push(
      "Available verified signals do not currently support a policy violation finding."
    );
  }

  if (
    input.coordinatedSuspicion &&
    recommendation !== "permanent_ban" &&
    recommendation !== "escalate"
  ) {
    recommendation = "escalate";
    reasoning.push(
      "Coordinated reporting suspicion requires supervisor escalation before heavy action."
    );
  }

  return {
    recommendation,
    reasoning,
    aggravatingFactors,
    mitigatingFactors,
  };
}

function emptyIntelligence(
  generatedAt: string,
  limitations: string[],
  timelines?: SafetyIntelligenceTimelines
): SafetyCaseIntelligence {
  return {
    status: "insufficient_data",
    analysisMode: "heuristic",
    generatedAt,
    dataQuality: {
      reporterHistoryAvailable: false,
      targetHistoryAvailable: false,
      evidenceVerified: false,
      finalizedReporterCases: 0,
      finalizedTargetCases: 0,
      limitations,
    },
    reporter: {
      credibilityScore: null,
      credibilityLevel: "unknown",
      lifetimeReports: 0,
      confirmedReports: 0,
      dismissedReports: 0,
      accuracyPercent: null,
      abuseFlags: [],
    },
    target: {
      riskScore: null,
      totalReports: 0,
      uniqueReporters: 0,
      activeReports: 0,
      confirmedViolations: 0,
      warnings: 0,
      removals: 0,
      restrictions: 0,
      suspensions: 0,
      permanentBans: 0,
      repeatedCategories: [],
      trend: "insufficient_data",
      reportsLast7d: 0,
      reportsLast30d: 0,
      reportsLast90d: 0,
    },
    evidence: {
      strengthScore: null,
      originalAvailable: false,
      snapshotAvailable: false,
      signals: [],
      limitations,
    },
    patterns: [],
    assessment: {
      caseRiskScore: null,
      signalLevel: "unknown",
      recommendation: "human_review",
      confidence: null,
      reasoning: [
        "Insufficient real finalized history / verified evidence for scored Case Intelligence.",
        ...timelineReasoning(timelines),
      ],
      aggravatingFactors: [],
      mitigatingFactors: ["insufficient_data"],
      requiresHumanReview: true,
    },
    timelines: timelines || emptySafetyIntelligenceTimelines(),
  };
}

export function computeSafetyCaseIntelligence(
  input: CaseIntelligenceRawInput
): SafetyCaseIntelligence {
  const generatedAt = new Date().toISOString();
  const timelines = input.timelines || emptySafetyIntelligenceTimelines();

  if (!input.reporterUserId && !input.targetId && !input.targetOwnerUserId) {
    return emptyIntelligence(
      generatedAt,
      ["missing_reporter_and_target_identifiers"],
      timelines
    );
  }

  const reporter = computeReporterCredibility({
    lifetimeReports: input.reporterLifetimeReports,
    confirmedReports: input.reporterConfirmedReports,
    dismissedReports: input.reporterDismissedReports,
    duplicateOnThisTarget: input.reporterDuplicateOnThisTarget,
    reportsOnThisTarget: input.reporterReportsOnThisTarget,
    hasFalseReportingPenalty: input.reporterHasFalseReportingPenalty,
  });

  const target = computeTargetRisk({
    totalReports: input.targetTotalReports,
    uniqueReporters: input.targetUniqueReporters,
    confirmedViolations: input.targetConfirmedViolations,
    warnings: input.targetWarnings,
    removals: input.targetRemovals,
    restrictions: input.targetRestrictions,
    suspensions: input.targetSuspensions,
    permanentBans: input.targetPermanentBans,
    reportsLast7d: input.targetReportsLast7d,
    reportsLast30d: input.targetReportsLast30d,
    reportsLast90d: input.targetReportsLast90d,
  });

  const evidence = computeEvidenceStrength({
    originalAvailable: input.originalContentAvailable,
    hasThumbnail: input.hasThumbnail,
    hasPreview: input.hasPreview,
    hasTitle: input.hasTitle,
    hasMediaUri: input.hasMediaUri,
    mediaType: input.mediaType,
    uniqueReporters: input.targetUniqueReporters,
    category: input.category,
    reason: input.reason,
    description: input.description,
    evidenceMachineVerified: Boolean(input.evidenceMachineVerified),
    evidenceAttachmentCount: input.evidenceAttachmentCount,
  });

  const patterns = detectCasePatterns(input);
  const coordinatedSuspicion = patterns.some(
    (p) =>
      p.type === "coordinated_reporting_suspicion" ||
      p.type === "multi_reporter_short_window"
  );

  const reporterHistoryAvailable = reporter.credibilityScore != null;
  const targetHistoryAvailable = target.riskScore != null;
  const evidenceVerified = evidence.evidenceVerified;

  const limitations = Array.from(
    new Set([
      ...reporter.limitations,
      ...evidence.limitations,
      ...(target.riskScore == null
        ? ["insufficient_confirmed_target_history"]
        : []),
    ])
  );

  const dataQuality: CaseIntelligenceDataQuality = {
    reporterHistoryAvailable,
    targetHistoryAvailable,
    evidenceVerified,
    finalizedReporterCases: reporter.finalizedDecisionCount,
    finalizedTargetCases: target.finalizedTargetCases,
    limitations,
  };

  const confidence = computeInputConfidence({
    reporterHistoryAvailable,
    targetHistoryAvailable,
    evidenceVerified,
    uniqueReporters: input.targetUniqueReporters,
    finalizedReporterCases: reporter.finalizedDecisionCount,
    finalizedTargetCases: target.finalizedTargetCases,
  });

  const canRecommendEnforcement =
    evidence.strengthScore != null &&
    target.riskScore != null &&
    confidence != null;

  if (!canRecommendEnforcement) {
    return {
      status: "insufficient_data",
      analysisMode: "heuristic",
      generatedAt,
      dataQuality,
      reporter: {
        credibilityScore: reporter.credibilityScore,
        credibilityLevel: reporter.credibilityLevel,
        lifetimeReports: nonNegInt(input.reporterLifetimeReports),
        confirmedReports: nonNegInt(input.reporterConfirmedReports),
        dismissedReports: nonNegInt(input.reporterDismissedReports),
        accuracyPercent: reporter.accuracyPercent,
        abuseFlags: reporter.abuseFlags,
      },
      target: {
        riskScore: target.riskScore,
        totalReports: nonNegInt(input.targetTotalReports),
        uniqueReporters: nonNegInt(input.targetUniqueReporters),
        activeReports: nonNegInt(input.targetActiveReports),
        confirmedViolations: nonNegInt(input.targetConfirmedViolations),
        warnings: nonNegInt(input.targetWarnings),
        removals: nonNegInt(input.targetRemovals),
        restrictions: nonNegInt(input.targetRestrictions),
        suspensions: nonNegInt(input.targetSuspensions),
        permanentBans: nonNegInt(input.targetPermanentBans),
        repeatedCategories: input.repeatedCategories || [],
        trend: target.trend,
        reportsLast7d: nonNegInt(input.targetReportsLast7d),
        reportsLast30d: nonNegInt(input.targetReportsLast30d),
        reportsLast90d: nonNegInt(input.targetReportsLast90d),
      },
      evidence: {
        strengthScore: evidence.strengthScore,
        originalAvailable: Boolean(input.originalContentAvailable),
        snapshotAvailable: evidence.snapshotAvailable,
        signals: evidence.signals,
        limitations: evidence.limitations,
      },
      patterns,
      assessment: {
        caseRiskScore: null,
        signalLevel: "unknown",
        recommendation: "human_review",
        confidence: null,
        reasoning: [
          "Minimum real-data gates were not met for an enforcement recommendation.",
          "Reporter credibility, target risk, and evidence strength require finalized/verified history — not open-report volume or presence-only media.",
          ...timelineReasoning(timelines),
          ...limitations.slice(0, 4),
        ],
        aggravatingFactors: [],
        mitigatingFactors: ["insufficient_data"],
        requiresHumanReview: true,
      },
      timelines,
    };
  }

  const corroborationScore = Math.min(
    100,
    Math.max(0, input.targetUniqueReporters - 1) * 18
  );
  const priorEnforcementScore = Math.min(
    100,
    input.targetWarnings * 10 +
      input.targetRestrictions * 18 +
      input.targetSuspensions * 28 +
      input.targetPermanentBans * 40
  );

  let caseRiskScore =
    (target.riskScore as number) *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_TARGET_HISTORY +
    (evidence.strengthScore as number) *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_EVIDENCE +
    corroborationScore * CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_CORROBORATION +
    priorEnforcementScore *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_PRIOR_ENFORCEMENT;

  caseRiskScore = clampScore(
    caseRiskScore + categorySeverityBoost(input.category) * 0.35
  );

  const recommendation = computeCaseRecommendation({
    caseRiskScore,
    evidenceScore: evidence.strengthScore as number,
    credibilityScore: reporter.credibilityScore,
    confirmedViolations: input.targetConfirmedViolations,
    suspensions: input.targetSuspensions,
    permanentBans: input.targetPermanentBans,
    restrictions: input.targetRestrictions,
    category: input.category,
    targetType: input.targetType,
    coordinatedSuspicion,
  });

  recommendation.reasoning.push(
    `Case risk ${caseRiskScore}/100 from verified target history and machine-verified evidence.`
  );
  recommendation.reasoning.push(
    ...timelineReasoning(timelines)
  );
  recommendation.reasoning.push(
    "Heuristic engine — recommendation still requires human review before enforcement."
  );

  return {
    status: "ready",
    analysisMode: "heuristic",
    generatedAt,
    dataQuality,
    reporter: {
      credibilityScore: reporter.credibilityScore,
      credibilityLevel: reporter.credibilityLevel,
      lifetimeReports: nonNegInt(input.reporterLifetimeReports),
      confirmedReports: nonNegInt(input.reporterConfirmedReports),
      dismissedReports: nonNegInt(input.reporterDismissedReports),
      accuracyPercent: reporter.accuracyPercent,
      abuseFlags: reporter.abuseFlags,
    },
    target: {
      riskScore: target.riskScore,
      totalReports: nonNegInt(input.targetTotalReports),
      uniqueReporters: nonNegInt(input.targetUniqueReporters),
      activeReports: nonNegInt(input.targetActiveReports),
      confirmedViolations: nonNegInt(input.targetConfirmedViolations),
      warnings: nonNegInt(input.targetWarnings),
      removals: nonNegInt(input.targetRemovals),
      restrictions: nonNegInt(input.targetRestrictions),
      suspensions: nonNegInt(input.targetSuspensions),
      permanentBans: nonNegInt(input.targetPermanentBans),
      repeatedCategories: input.repeatedCategories || [],
      trend: target.trend,
      reportsLast7d: nonNegInt(input.targetReportsLast7d),
      reportsLast30d: nonNegInt(input.targetReportsLast30d),
      reportsLast90d: nonNegInt(input.targetReportsLast90d),
    },
    evidence: {
      strengthScore: evidence.strengthScore,
      originalAvailable: Boolean(input.originalContentAvailable),
      snapshotAvailable: evidence.snapshotAvailable,
      signals: evidence.signals,
      limitations: evidence.limitations,
    },
    patterns,
    assessment: {
      caseRiskScore,
      signalLevel: signalLevelFromRisk(caseRiskScore),
      recommendation: recommendation.recommendation,
      confidence,
      reasoning: recommendation.reasoning,
      aggravatingFactors: recommendation.aggravatingFactors,
      mitigatingFactors: recommendation.mitigatingFactors,
      requiresHumanReview: true,
    },
    timelines,
  };
}
