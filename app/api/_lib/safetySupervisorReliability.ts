/**
 * Safety Supervisor Reliability — FACTS FIRST (Phase 2A).
 *
 * Pure, deterministic aggregation over finalized intelligence-ledger rows for a
 * single supervisor/agent (decided_by_user_id). No DB / path-alias imports so
 * the harness can unit-test it directly.
 *
 * Honesty rules (enforced here):
 *  - reliabilityScore stays null: no appeals/reversals or final-review ground
 *    truth exists yet, and a versioned formula is not defined.
 *  - agreementCount / falsePositiveCount / falseNegativeCount stay null for the
 *    same reason — they require appeal outcomes or QA labels we do not have.
 *  - appealCount / reversedDecisionCount are REAL facts; they read reserved
 *    columns and are 0 until appeal/reversal events exist.
 *  - Decision volume and severityScore are NEVER used to synthesize a score.
 *  - Open / escalated / unfinalized cases are excluded.
 */

/** Finalized learning outcomes stored in the ledger (outcome_type values). */
const FINALIZED_OUTCOME_TYPES = new Set([
  "warning",
  "remove_content",
  "restrict_account",
  "suspend_account",
  "permanent_ban",
  "no_violation",
]);

/** Reserved appeal outcomes that represent a reversal of the original decision. */
const REVERSAL_APPEAL_OUTCOMES = new Set(["upheld", "modified"]);

export type SafetySupervisorReliability = {
  supervisorUserId: string;
  finalizedDecisionCount: number;
  warningCount: number;
  removalCount: number;
  restrictionCount: number;
  suspensionCount: number;
  permanentBanCount: number;
  noViolationCount: number;
  averageResolutionMinutes: number | null;
  appealCount: number;
  reversedDecisionCount: number;
  agreementCount: number | null;
  falsePositiveCount: number | null;
  falseNegativeCount: number | null;
  reliabilityScore: number | null;
  status: "ready" | "insufficient_data";
  limitations: string[];
};

export type SupervisorReliabilityLedgerRow = {
  decidedByUserId?: unknown;
  eventKind?: unknown;
  outcomeType?: unknown;
  decisionType?: unknown;
  decisionAt?: unknown;
  resolutionMinutes?: unknown;
  reportId?: unknown;
  appealFiled?: unknown;
  appealOutcome?: unknown;
};

function safeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function safeLower(value: unknown): string {
  return safeText(value).toLowerCase();
}

/** Why reliabilityScore + derived error rates are null (always disclosed). */
const SCORE_NULL_LIMITATIONS = Object.freeze([
  "reliability_score_requires_appeal_or_reversal_ground_truth",
  "no_final_review_agreement_labels",
  "false_positive_negative_requires_appeal_outcomes",
]);

export function emptySupervisorReliability(
  supervisorUserId: string,
  extraLimitations: string[] = []
): SafetySupervisorReliability {
  return {
    supervisorUserId: safeText(supervisorUserId),
    finalizedDecisionCount: 0,
    warningCount: 0,
    removalCount: 0,
    restrictionCount: 0,
    suspensionCount: 0,
    permanentBanCount: 0,
    noViolationCount: 0,
    averageResolutionMinutes: null,
    appealCount: 0,
    reversedDecisionCount: 0,
    agreementCount: null,
    falsePositiveCount: null,
    falseNegativeCount: null,
    reliabilityScore: null,
    status: "insufficient_data",
    limitations: [...extraLimitations, ...SCORE_NULL_LIMITATIONS],
  };
}

/**
 * Aggregate reliability FACTS for one supervisor from ledger rows.
 * Rows for other supervisors, non-finalized outcomes, and duplicates
 * (same reportId+eventKind+outcomeType) are excluded.
 */
export function computeSupervisorReliabilityFacts(
  supervisorUserId: string,
  rows: SupervisorReliabilityLedgerRow[]
): SafetySupervisorReliability {
  const targetId = safeText(supervisorUserId);
  if (!targetId) {
    return emptySupervisorReliability("", ["missing_supervisor_identifier"]);
  }

  const result = emptySupervisorReliability(targetId);

  const seen = new Set<string>();
  let resolutionSum = 0;
  let resolutionCount = 0;

  for (const row of rows || []) {
    // Strict supervisor scoping — no cross-supervisor leakage, no null deciders.
    const decider = safeText(row.decidedByUserId);
    if (!decider || decider !== targetId) continue;

    const eventKind = safeLower(row.eventKind) || "decision";
    const outcome = safeLower(row.outcomeType || row.decisionType);

    // Only finalized decision outcomes count toward reliability facts.
    if (eventKind !== "decision" || !FINALIZED_OUTCOME_TYPES.has(outcome)) {
      // Appeal events (reserved) are counted separately below, then skipped.
      if (eventKind === "appeal") {
        result.appealCount += 1;
        if (REVERSAL_APPEAL_OUTCOMES.has(safeLower(row.appealOutcome))) {
          result.reversedDecisionCount += 1;
        }
      }
      continue;
    }

    // Defensive dedupe mirroring the DB unique index.
    const dedupeKey = `${safeText(row.reportId)}|${eventKind}|${outcome}`;
    if (safeText(row.reportId) && seen.has(dedupeKey)) continue;
    if (safeText(row.reportId)) seen.add(dedupeKey);

    result.finalizedDecisionCount += 1;
    switch (outcome) {
      case "warning":
        result.warningCount += 1;
        break;
      case "remove_content":
        result.removalCount += 1;
        break;
      case "restrict_account":
        result.restrictionCount += 1;
        break;
      case "suspend_account":
        result.suspensionCount += 1;
        break;
      case "permanent_ban":
        result.permanentBanCount += 1;
        break;
      case "no_violation":
        result.noViolationCount += 1;
        break;
      default:
        break;
    }

    // Reserved appeal facts stored on the decision row (0 until events exist).
    if (row.appealFiled === true) {
      result.appealCount += 1;
      if (REVERSAL_APPEAL_OUTCOMES.has(safeLower(row.appealOutcome))) {
        result.reversedDecisionCount += 1;
      }
    }

    // Average uses only rows with a real resolution value.
    const minutes = Number(row.resolutionMinutes);
    if (
      row.resolutionMinutes != null &&
      Number.isFinite(minutes) &&
      minutes >= 0
    ) {
      resolutionSum += minutes;
      resolutionCount += 1;
    }
  }

  result.averageResolutionMinutes =
    resolutionCount > 0 ? Math.round(resolutionSum / resolutionCount) : null;

  // reliabilityScore / agreement / FP / FN stay null by contract.
  result.status =
    result.finalizedDecisionCount > 0 ? "ready" : "insufficient_data";
  if (result.status === "insufficient_data") {
    result.limitations = [
      "no_finalized_decisions_for_supervisor",
      ...SCORE_NULL_LIMITATIONS,
    ];
  }

  return result;
}

/**
 * Build the facts object from a pre-aggregated ledger row (single SQL query,
 * no N+1). Kept in sync with computeSupervisorReliabilityFacts so the store
 * loader and the pure contract cannot drift.
 */
export function supervisorReliabilityFromAggregate(input: {
  supervisorUserId: string;
  finalizedDecisionCount: number;
  warningCount: number;
  removalCount: number;
  restrictionCount: number;
  suspensionCount: number;
  permanentBanCount: number;
  noViolationCount: number;
  averageResolutionMinutes: number | null;
  appealCount: number;
  reversedDecisionCount: number;
}): SafetySupervisorReliability {
  const targetId = safeText(input.supervisorUserId);
  if (!targetId) {
    return emptySupervisorReliability("", ["missing_supervisor_identifier"]);
  }

  const finalizedDecisionCount = Math.max(
    0,
    Math.floor(Number(input.finalizedDecisionCount) || 0)
  );

  const avg =
    input.averageResolutionMinutes == null ||
    !Number.isFinite(Number(input.averageResolutionMinutes))
      ? null
      : Math.round(Number(input.averageResolutionMinutes));

  const base = emptySupervisorReliability(targetId);
  const nn = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

  const facts: SafetySupervisorReliability = {
    ...base,
    finalizedDecisionCount,
    warningCount: nn(input.warningCount),
    removalCount: nn(input.removalCount),
    restrictionCount: nn(input.restrictionCount),
    suspensionCount: nn(input.suspensionCount),
    permanentBanCount: nn(input.permanentBanCount),
    noViolationCount: nn(input.noViolationCount),
    averageResolutionMinutes: finalizedDecisionCount > 0 ? avg : null,
    appealCount: nn(input.appealCount),
    reversedDecisionCount: nn(input.reversedDecisionCount),
    status: finalizedDecisionCount > 0 ? "ready" : "insufficient_data",
  };

  facts.limitations =
    facts.status === "insufficient_data"
      ? ["no_finalized_decisions_for_supervisor", ...SCORE_NULL_LIMITATIONS]
      : [...SCORE_NULL_LIMITATIONS];

  return facts;
}
