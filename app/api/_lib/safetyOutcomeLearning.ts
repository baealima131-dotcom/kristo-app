/**
 * Safety Outcome Learning metadata (Phase 2A).
 *
 * Pure, deterministic helpers — no DB / path-alias imports so the harness can
 * unit-test them directly. Every field is derived from REAL finalized data or
 * left null. No synthetic scores, no guessed confidence, no invented weights.
 *
 * Sources of truth:
 *  - severityScore         -> documented, versioned decision+category map
 *  - resolutionMinutes     -> report.createdAt -> decisionAt (real timestamps)
 *  - investigatorConfidence-> human-entered decision_confidence ONLY
 *  - appealFiled/outcome   -> appeals not built; always false / null
 *  - finalOutcomeWeight    -> null until an explainable policy + data exist
 *  - evidenceUrlHash       -> sha256 of an already-stored media URL (no new capture)
 */

import { createHash } from "node:crypto";

/**
 * Version tag persisted alongside every severity_score. Bump this ONLY when the
 * documented map below changes, so historical rows stay auditable and any
 * recompute is traceable to a specific map revision.
 */
export const SAFETY_SEVERITY_MAP_VERSION = "v1";

/**
 * Base severity per finalized human decision. The decision a human issued is
 * itself the strongest real signal of how severe the case was. 0..100.
 * Non-finalized decisions (escalate/open/etc.) have no mapping -> null.
 */
export const SAFETY_SEVERITY_BASE_BY_DECISION: Readonly<
  Record<string, number>
> = Object.freeze({
  no_violation: 0,
  warning: 20,
  remove_content: 40,
  restrict_account: 60,
  suspend_account: 80,
  permanent_ban: 100,
});

/**
 * Documented category modifiers (points added to the base, then clamped 0..100).
 * These reflect inherent category harm and are intentionally small so the human
 * decision remains dominant. Not applied to no_violation (no harm attributable).
 */
export const SAFETY_SEVERITY_CATEGORY_MODIFIER: Readonly<
  Record<string, number>
> = Object.freeze({
  child_safety: 15,
  csam: 15,
  violence: 10,
  threat: 10,
  hate_speech: 10,
  sexual_content: 10,
  nudity: 10,
  self_harm: 10,
  harassment: 5,
  bullying: 5,
  spam: -5,
});

export type SafetyOutcomeAppealOutcome =
  | "upheld"
  | "rejected"
  | "modified"
  | null;

export type SafetyOutcomeLearningMetadata = {
  severityScore: number | null;
  /** Version of the severity map used to produce severityScore. */
  severityMapVersion: string | null;
  resolutionMinutes: number | null;
  investigatorConfidence: number | null;
  /** Appeals feature is not built — reserved contract only. */
  appealFiled: boolean;
  appealOutcome: SafetyOutcomeAppealOutcome;
  /** Null until a documented, data-backed weighting policy exists. */
  finalOutcomeWeight: number | null;
  /** sha256 hex of an already-stored media URL, or null. */
  evidenceUrlHash: string | null;
};

function safeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function safeLower(value: unknown): string {
  return safeText(value).toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * severityScore from the versioned decision+category map.
 * Returns null when the decision is not a finalized learning outcome.
 */
export function computeSeverityScore(
  decisionType: unknown,
  category?: unknown
): number | null {
  const decision = safeLower(decisionType);
  if (!(decision in SAFETY_SEVERITY_BASE_BY_DECISION)) {
    return null;
  }
  const base = SAFETY_SEVERITY_BASE_BY_DECISION[decision];
  // No violation found -> zero severity regardless of the reported category.
  if (decision === "no_violation") return 0;
  const modifier =
    SAFETY_SEVERITY_CATEGORY_MODIFIER[safeLower(category)] ?? 0;
  return Math.round(clamp(base + modifier, 0, 100));
}

/**
 * Minutes between report creation and the finalized decision.
 * Null when either timestamp is missing or the interval is invalid (clock skew).
 */
export function computeResolutionMinutes(
  createdAt: unknown,
  decisionAt: unknown
): number | null {
  const created = Date.parse(safeText(createdAt));
  const decided = Date.parse(safeText(decisionAt));
  if (!Number.isFinite(created) || !Number.isFinite(decided)) {
    return null;
  }
  const diffMs = decided - created;
  if (diffMs < 0) return null;
  return Math.round(diffMs / 60000);
}

/**
 * Investigator confidence is a HUMAN input only (decision_confidence slider).
 * Never derived. Returns null when unset; clamps a present value to 0..100.
 */
export function normalizeInvestigatorConfidence(
  value: unknown
): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(clamp(n, 0, 100));
}

/**
 * Deterministic sha256 hex of an already-stored media URL. Enables exact-URL
 * evidence linking across cases WITHOUT any new data capture or ML. Normalizes
 * by trim + lowercase so the same URL always yields the same hash. Returns null
 * for empty input. This is NOT perceptual/visual matching.
 */
export function computeEvidenceUrlHash(url: unknown): string | null {
  const normalized = safeLower(url);
  if (!normalized) return null;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export type OutcomeLearningInput = {
  decisionType?: unknown;
  category?: unknown;
  createdAt?: unknown;
  decisionAt?: unknown;
  /** Human-entered decision confidence (0..100) or null/undefined. */
  investigatorConfidence?: unknown;
  /** Already-stored media/evidence URL (e.g. target_thumbnail_uri). */
  evidenceUrl?: unknown;
};

/**
 * Build the full outcome-learning metadata bundle from real fields only.
 * Appeals stay false/null; finalOutcomeWeight stays null in Phase 2A.
 */
export function computeOutcomeLearningMetadata(
  input: OutcomeLearningInput
): SafetyOutcomeLearningMetadata {
  const severityScore = computeSeverityScore(
    input.decisionType,
    input.category
  );
  return {
    severityScore,
    // Always tag the map version once processed under v1, even if the decision
    // had no mapping — so backfill can reliably skip already-processed rows.
    severityMapVersion: SAFETY_SEVERITY_MAP_VERSION,
    resolutionMinutes: computeResolutionMinutes(
      input.createdAt,
      input.decisionAt
    ),
    investigatorConfidence: normalizeInvestigatorConfidence(
      input.investigatorConfidence
    ),
    appealFiled: false,
    appealOutcome: null,
    finalOutcomeWeight: null,
    evidenceUrlHash: computeEvidenceUrlHash(input.evidenceUrl),
  };
}
