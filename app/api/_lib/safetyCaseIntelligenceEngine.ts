/**
 * Heuristic Case Intelligence Engine.
 *
 * Decision-support only — never auto-enforces.
 * Uses real report/enforcement/evidence signals only.
 * analysisMode is always "heuristic" until an LLM/classifier is wired.
 */

export type CaseIntelligenceStatus =
  | "ready"
  | "insufficient_data"
  | "error";

export type CaseIntelligenceCredibilityLevel =
  | "low"
  | "medium"
  | "high"
  | "trusted";

export type CaseIntelligenceSignalLevel =
  | "low"
  | "moderate"
  | "high"
  | "critical";

export type CaseIntelligenceRecommendation =
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

export type SafetyCaseIntelligence = {
  status: CaseIntelligenceStatus;
  analysisMode: "heuristic";
  generatedAt: string;
  reporter: {
    credibilityScore: number;
    credibilityLevel: CaseIntelligenceCredibilityLevel;
    lifetimeReports: number;
    confirmedReports: number;
    dismissedReports: number;
    accuracyPercent: number | null;
    abuseFlags: string[];
  };
  target: {
    riskScore: number;
    totalReports: number;
    uniqueReporters: number;
    confirmedViolations: number;
    warnings: number;
    removals: number;
    restrictions: number;
    suspensions: number;
    permanentBans: number;
    repeatedCategories: string[];
    trend: "increasing" | "stable" | "declining" | "unknown";
    reportsLast7d: number;
    reportsLast30d: number;
    reportsLast90d: number;
  };
  evidence: {
    strengthScore: number;
    originalAvailable: boolean;
    snapshotAvailable: boolean;
    signals: string[];
    limitations: string[];
  };
  patterns: CaseIntelligencePattern[];
  assessment: {
    caseRiskScore: number;
    signalLevel: CaseIntelligenceSignalLevel;
    recommendation: CaseIntelligenceRecommendation;
    confidence: number;
    reasoning: string[];
    aggravatingFactors: string[];
    mitigatingFactors: string[];
    requiresHumanReview: true;
  };
};

/** Named weight constants — no hidden magic numbers in scoring. */
export const CASE_INTELLIGENCE_WEIGHTS = {
  CASE_RISK_TARGET_HISTORY: 0.32,
  CASE_RISK_EVIDENCE: 0.22,
  CASE_RISK_CORROBORATION: 0.14,
  CASE_RISK_RECENCY: 0.1,
  CASE_RISK_REPEAT_BEHAVIOR: 0.1,
  CASE_RISK_PRIOR_ENFORCEMENT: 0.08,
  CASE_RISK_REPORTER_CREDIBILITY: 0.04,

  COORDINATED_ABUSE_PENALTY_MAX: 18,
  DISMISSED_HISTORY_PENALTY_MAX: 12,
  LOW_CREDIBILITY_PENALTY_MAX: 10,

  CREDIBILITY_ACCURACY_WEIGHT: 0.55,
  CREDIBILITY_VOLUME_TRUST_WEIGHT: 0.2,
  CREDIBILITY_CONFIRMATION_WEIGHT: 0.25,

  TARGET_CONFIRMED_WEIGHT: 0.35,
  TARGET_UNIQUE_REPORTERS_WEIGHT: 0.2,
  TARGET_ENFORCEMENT_WEIGHT: 0.25,
  TARGET_FREQUENCY_WEIGHT: 0.2,

  EVIDENCE_ORIGINAL_POINTS: 28,
  EVIDENCE_SNAPSHOT_POINTS: 18,
  EVIDENCE_MEDIA_POINTS: 16,
  EVIDENCE_TEXT_POINTS: 12,
  EVIDENCE_METADATA_POINTS: 12,
  EVIDENCE_CORROBORATION_POINTS: 14,

  PERMANENT_BAN_MIN_CASE_RISK: 88,
  PERMANENT_BAN_MIN_EVIDENCE: 70,
  PERMANENT_BAN_MIN_CONFIRMED: 2,
  PERMANENT_BAN_REQUIRES_PRIOR_SERIOUS: true,

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
};

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
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
  credibilityScore: number;
  credibilityLevel: CaseIntelligenceCredibilityLevel;
  accuracyPercent: number | null;
  abuseFlags: string[];
} {
  const lifetime = Math.max(0, Math.floor(input.lifetimeReports || 0));
  const confirmed = Math.max(0, Math.floor(input.confirmedReports || 0));
  const dismissed = Math.max(0, Math.floor(input.dismissedReports || 0));
  const decided = confirmed + dismissed;
  const accuracyPercent =
    decided > 0
      ? Math.round((confirmed / decided) * 1000) / 10
      : null;

  const abuseFlags: string[] = [];

  /*
   * Accuracy dominates. High-volume accurate reporters stay credible.
   * Volume alone does not reduce credibility.
   */
  let score = 55;
  if (accuracyPercent !== null) {
    score =
      accuracyPercent *
        CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_ACCURACY_WEIGHT +
      Math.min(100, confirmed * 8) *
        CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_CONFIRMATION_WEIGHT +
      Math.min(100, lifetime * 2) *
        CASE_INTELLIGENCE_WEIGHTS.CREDIBILITY_VOLUME_TRUST_WEIGHT;
  } else if (lifetime === 0) {
    score = 50;
  } else if (lifetime === 1) {
    score = 58;
  } else {
    score = 52;
  }

  if (input.hasFalseReportingPenalty) {
    score -= 35;
    abuseFlags.push("prior_false_or_malicious_reporting_penalty");
  }

  if (
    input.reportsOnThisTarget >=
    CASE_INTELLIGENCE_WEIGHTS.REPEAT_SAME_TARGET_BY_REPORTER
  ) {
    score -= 12;
    abuseFlags.push("repeated_reports_against_same_target");
  }

  if (
    input.duplicateOnThisTarget >=
    CASE_INTELLIGENCE_WEIGHTS.DUPLICATE_BURST_SAME_REPORTER
  ) {
    score -= 10;
    abuseFlags.push("duplicate_report_burst");
  }

  if (decided >= 5 && accuracyPercent !== null && accuracyPercent < 25) {
    score -= 20;
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
  riskScore: number;
  trend: "increasing" | "stable" | "declining" | "unknown";
} {
  const confirmedComponent = Math.min(
    100,
    input.confirmedViolations * 18 +
      input.removals * 10 +
      input.warnings * 6
  );
  const uniqueComponent = Math.min(100, input.uniqueReporters * 12);
  const enforcementComponent = Math.min(
    100,
    input.restrictions * 16 +
      input.suspensions * 22 +
      input.permanentBans * 40
  );
  const frequencyComponent = Math.min(
    100,
    input.reportsLast7d * 14 +
      input.reportsLast30d * 4 +
      Math.min(40, input.reportsLast90d)
  );

  const riskScore = clampScore(
    confirmedComponent *
      CASE_INTELLIGENCE_WEIGHTS.TARGET_CONFIRMED_WEIGHT +
      uniqueComponent *
        CASE_INTELLIGENCE_WEIGHTS.TARGET_UNIQUE_REPORTERS_WEIGHT +
      enforcementComponent *
        CASE_INTELLIGENCE_WEIGHTS.TARGET_ENFORCEMENT_WEIGHT +
      frequencyComponent *
        CASE_INTELLIGENCE_WEIGHTS.TARGET_FREQUENCY_WEIGHT
  );

  let trend: "increasing" | "stable" | "declining" | "unknown" = "unknown";
  if (input.reportsLast90d > 0 || input.reportsLast30d > 0) {
    const recentRate = input.reportsLast7d;
    const olderWindow = Math.max(
      0,
      input.reportsLast30d - input.reportsLast7d
    );
    const olderWeekly = olderWindow / 3;
    if (recentRate > olderWeekly * 1.35 + 0.5) trend = "increasing";
    else if (recentRate + 0.5 < olderWeekly * 0.65) trend = "declining";
    else trend = "stable";
  }

  return { riskScore, trend };
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
}): {
  strengthScore: number;
  snapshotAvailable: boolean;
  signals: string[];
  limitations: string[];
} {
  const signals: string[] = [];
  const limitations: string[] = [];
  let score = 0;

  if (input.originalAvailable) {
    score += CASE_INTELLIGENCE_WEIGHTS.EVIDENCE_ORIGINAL_POINTS;
    signals.push("original_content_available");
  } else {
    limitations.push("original_content_unavailable");
  }

  const snapshotAvailable = Boolean(
    input.hasThumbnail || input.hasPreview || input.hasMediaUri
  );
  if (snapshotAvailable) {
    score += CASE_INTELLIGENCE_WEIGHTS.EVIDENCE_SNAPSHOT_POINTS;
    signals.push("saved_snapshot_or_media_reference");
  } else {
    limitations.push("no_saved_media_snapshot");
  }

  const mediaType = safeText(input.mediaType).toLowerCase();
  if (
    mediaType === "video" ||
    mediaType === "image" ||
    mediaType === "audio" ||
    input.hasMediaUri
  ) {
    score += CASE_INTELLIGENCE_WEIGHTS.EVIDENCE_MEDIA_POINTS;
    signals.push(`media_type_${mediaType || "present"}`);
  } else if (input.hasPreview) {
    score += CASE_INTELLIGENCE_WEIGHTS.EVIDENCE_TEXT_POINTS;
    signals.push("text_or_comment_preview");
  } else {
    limitations.push("limited_media_or_text_evidence");
  }

  const metadataBits = [
    input.hasTitle,
    Boolean(safeText(input.category)),
    Boolean(safeText(input.reason)),
    Boolean(safeText(input.description)),
  ].filter(Boolean).length;
  score +=
    (metadataBits / 4) * CASE_INTELLIGENCE_WEIGHTS.EVIDENCE_METADATA_POINTS;
  if (metadataBits >= 3) signals.push("metadata_mostly_complete");
  else limitations.push("incomplete_report_metadata");

  const corroboration = Math.min(
    CASE_INTELLIGENCE_WEIGHTS.EVIDENCE_CORROBORATION_POINTS,
    Math.max(0, input.uniqueReporters - 1) * 5
  );
  score += corroboration;
  if (input.uniqueReporters > 1) {
    signals.push("corroborating_unique_reporters");
  }

  limitations.push(
    "no_automated_content_classifier_or_llm_review_connected"
  );

  return {
    strengthScore: clampScore(score),
    snapshotAvailable,
    signals,
    limitations,
  };
}

export function detectCasePatterns(input: CaseIntelligenceRawInput): CaseIntelligencePattern[] {
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
      supportingCount:
        input.targetRestrictions + input.targetSuspensions,
    });
  }

  return patterns;
}

function signalLevelFromRisk(
  caseRiskScore: number
): CaseIntelligenceSignalLevel {
  if (caseRiskScore >= 80) return "critical";
  if (caseRiskScore >= 60) return "high";
  if (caseRiskScore >= 35) return "moderate";
  return "low";
}

export function computeCaseRecommendation(input: {
  caseRiskScore: number;
  evidenceScore: number;
  credibilityScore: number;
  confirmedViolations: number;
  suspensions: number;
  permanentBans: number;
  restrictions: number;
  category: string;
  targetType: string;
  coordinatedSuspicion: boolean;
  patterns: CaseIntelligencePattern[];
}): {
  recommendation: CaseIntelligenceRecommendation;
  confidence: number;
  reasoning: string[];
  aggravatingFactors: string[];
  mitigatingFactors: string[];
} {
  const reasoning: string[] = [];
  const aggravatingFactors: string[] = [];
  const mitigatingFactors: string[] = [];

  const categoryBoost = categorySeverityBoost(input.category);
  if (categoryBoost >= 12) {
    aggravatingFactors.push("elevated_category_severity");
  }

  if (input.confirmedViolations > 0) {
    aggravatingFactors.push("prior_confirmed_violations");
  }
  if (input.suspensions > 0 || input.permanentBans > 0) {
    aggravatingFactors.push("prior_serious_enforcement");
  }
  if (input.coordinatedSuspicion) {
    aggravatingFactors.push("coordinated_reporting_suspicion");
  }
  if (input.evidenceScore < 35) {
    mitigatingFactors.push("weak_or_incomplete_evidence");
  }
  if (input.credibilityScore < 40) {
    mitigatingFactors.push("low_reporter_credibility");
  }
  if (input.confirmedViolations === 0 && input.caseRiskScore < 40) {
    mitigatingFactors.push("limited_target_history");
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
    input.evidenceScore >=
      CASE_INTELLIGENCE_WEIGHTS.PERMANENT_BAN_MIN_EVIDENCE &&
    priorSerious
  ) {
    recommendation = "permanent_ban";
    reasoning.push(
      "Case risk, evidence strength, and prior serious enforcement jointly support permanent ban consideration."
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
      "Evidence and case risk support content removal or a formal warning."
    );
  } else if (risk >= CASE_INTELLIGENCE_WEIGHTS.WARNING_MIN_CASE_RISK) {
    recommendation = "warning";
    reasoning.push(
      "Early violation signals are present but do not yet justify heavy enforcement."
    );
  } else if (risk >= CASE_INTELLIGENCE_WEIGHTS.MONITOR_MIN_CASE_RISK) {
    recommendation = "monitor";
    reasoning.push(
      "Signals are present but remain below warning thresholds; continue monitoring."
    );
  } else {
    recommendation = "no_violation";
    reasoning.push(
      "Available signals do not currently support a policy violation finding."
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

  if (
    input.evidenceScore < 30 &&
    recommendation !== "monitor" &&
    recommendation !== "no_violation" &&
    recommendation !== "escalate"
  ) {
    recommendation = "escalate";
    reasoning.push(
      "Evidence is too thin for a durable enforcement recommendation without human review."
    );
  }

  if (input.credibilityScore < 35 && recommendation === "no_violation") {
    // keep
  } else if (
    input.credibilityScore < 35 &&
    ["warning", "remove_content", "restrict_account"].includes(
      recommendation
    )
  ) {
    recommendation = "monitor";
    reasoning.push(
      "Low reporter credibility reduces confidence; monitor pending stronger corroboration."
    );
  }

  const confidence = clampScore(
    40 +
      input.evidenceScore * 0.25 +
      input.credibilityScore * 0.15 +
      Math.min(20, input.confirmedViolations * 5) -
      (input.coordinatedSuspicion ? 8 : 0) -
      (input.evidenceScore < 35 ? 12 : 0)
  );

  reasoning.push(
    `Case risk ${input.caseRiskScore}/100, evidence ${input.evidenceScore}/100, reporter credibility ${input.credibilityScore}/100.`
  );
  reasoning.push(
    "Heuristic analysis only — no automated video/audio content classifier was used."
  );

  return {
    recommendation,
    confidence,
    reasoning,
    aggravatingFactors,
    mitigatingFactors,
  };
}

export function computeSafetyCaseIntelligence(
  input: CaseIntelligenceRawInput
): SafetyCaseIntelligence {
  const generatedAt = new Date().toISOString();

  if (!input.reporterUserId && !input.targetId && !input.targetOwnerUserId) {
    return {
      status: "insufficient_data",
      analysisMode: "heuristic",
      generatedAt,
      reporter: {
        credibilityScore: 0,
        credibilityLevel: "low",
        lifetimeReports: 0,
        confirmedReports: 0,
        dismissedReports: 0,
        accuracyPercent: null,
        abuseFlags: [],
      },
      target: {
        riskScore: 0,
        totalReports: 0,
        uniqueReporters: 0,
        confirmedViolations: 0,
        warnings: 0,
        removals: 0,
        restrictions: 0,
        suspensions: 0,
        permanentBans: 0,
        repeatedCategories: [],
        trend: "unknown",
        reportsLast7d: 0,
        reportsLast30d: 0,
        reportsLast90d: 0,
      },
      evidence: {
        strengthScore: 0,
        originalAvailable: false,
        snapshotAvailable: false,
        signals: [],
        limitations: ["missing_reporter_and_target_identifiers"],
      },
      patterns: [],
      assessment: {
        caseRiskScore: 0,
        signalLevel: "low",
        recommendation: "monitor",
        confidence: 0,
        reasoning: [
          "Insufficient identifiers to compute Case Intelligence.",
        ],
        aggravatingFactors: [],
        mitigatingFactors: ["insufficient_data"],
        requiresHumanReview: true,
      },
    };
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
  });

  const patterns = detectCasePatterns(input);
  const coordinatedSuspicion = patterns.some(
    (p) =>
      p.type === "coordinated_reporting_suspicion" ||
      p.type === "multi_reporter_short_window"
  );

  const corroborationScore = Math.min(
    100,
    Math.max(0, input.targetUniqueReporters - 1) * 18
  );
  const recencyScore = Math.min(
    100,
    input.targetReportsLast7d * 20 + input.targetReportsLast30d * 3
  );
  const repeatBehaviorScore = Math.min(
    100,
    input.targetConfirmedViolations * 20 +
      input.repeatedCategories.length * 10
  );
  const priorEnforcementScore = Math.min(
    100,
    input.targetWarnings * 10 +
      input.targetRestrictions * 18 +
      input.targetSuspensions * 28 +
      input.targetPermanentBans * 40
  );

  let caseRiskScore =
    target.riskScore *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_TARGET_HISTORY +
    evidence.strengthScore * CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_EVIDENCE +
    corroborationScore *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_CORROBORATION +
    recencyScore * CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_RECENCY +
    repeatBehaviorScore *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_REPEAT_BEHAVIOR +
    priorEnforcementScore *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_PRIOR_ENFORCEMENT +
    reporter.credibilityScore *
      CASE_INTELLIGENCE_WEIGHTS.CASE_RISK_REPORTER_CREDIBILITY;

  if (coordinatedSuspicion) {
    caseRiskScore -=
      CASE_INTELLIGENCE_WEIGHTS.COORDINATED_ABUSE_PENALTY_MAX *
      (input.targetUniqueReportersLast24h >=
      CASE_INTELLIGENCE_WEIGHTS.COORDINATED_UNIQUE_REPORTERS_24H
        ? 1
        : 0.55);
  }

  if (input.targetDismissedReports > input.targetConfirmedViolations) {
    caseRiskScore -= Math.min(
      CASE_INTELLIGENCE_WEIGHTS.DISMISSED_HISTORY_PENALTY_MAX,
      (input.targetDismissedReports - input.targetConfirmedViolations) * 3
    );
  }

  if (reporter.credibilityLevel === "low") {
    caseRiskScore -=
      CASE_INTELLIGENCE_WEIGHTS.LOW_CREDIBILITY_PENALTY_MAX *
      ((45 - reporter.credibilityScore) / 45);
  }

  caseRiskScore = clampScore(
    caseRiskScore + categorySeverityBoost(input.category) * 0.35
  );

  const recommendation = computeCaseRecommendation({
    caseRiskScore,
    evidenceScore: evidence.strengthScore,
    credibilityScore: reporter.credibilityScore,
    confirmedViolations: input.targetConfirmedViolations,
    suspensions: input.targetSuspensions,
    permanentBans: input.targetPermanentBans,
    restrictions: input.targetRestrictions,
    category: input.category,
    targetType: input.targetType,
    coordinatedSuspicion,
    patterns,
  });

  return {
    status: "ready",
    analysisMode: "heuristic",
    generatedAt,
    reporter: {
      credibilityScore: reporter.credibilityScore,
      credibilityLevel: reporter.credibilityLevel,
      lifetimeReports: input.reporterLifetimeReports,
      confirmedReports: input.reporterConfirmedReports,
      dismissedReports: input.reporterDismissedReports,
      accuracyPercent: reporter.accuracyPercent,
      abuseFlags: reporter.abuseFlags,
    },
    target: {
      riskScore: target.riskScore,
      totalReports: input.targetTotalReports,
      uniqueReporters: input.targetUniqueReporters,
      confirmedViolations: input.targetConfirmedViolations,
      warnings: input.targetWarnings,
      removals: input.targetRemovals,
      restrictions: input.targetRestrictions,
      suspensions: input.targetSuspensions,
      permanentBans: input.targetPermanentBans,
      repeatedCategories: input.repeatedCategories,
      trend: target.trend,
      reportsLast7d: input.targetReportsLast7d,
      reportsLast30d: input.targetReportsLast30d,
      reportsLast90d: input.targetReportsLast90d,
    },
    evidence: {
      strengthScore: evidence.strengthScore,
      originalAvailable: input.originalContentAvailable,
      snapshotAvailable: evidence.snapshotAvailable,
      signals: evidence.signals,
      limitations: evidence.limitations,
    },
    patterns,
    assessment: {
      caseRiskScore,
      signalLevel: signalLevelFromRisk(caseRiskScore),
      recommendation: recommendation.recommendation,
      confidence: recommendation.confidence,
      reasoning: recommendation.reasoning,
      aggravatingFactors: recommendation.aggravatingFactors,
      mitigatingFactors: recommendation.mitigatingFactors,
      requiresHumanReview: true,
    },
  };
}
