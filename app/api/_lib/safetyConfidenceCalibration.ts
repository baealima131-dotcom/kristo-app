/**
 * Safety Confidence Calibration (Phase 2A).
 *
 * Pure, deterministic. Separates data coverage, source quality, historical
 * sufficiency and evidence verification, then reports an HONEST confidence
 * level. No DB / path-alias imports so the harness can unit-test it directly.
 *
 * Honesty rules (enforced here):
 *  - Numeric `confidence` stays null until ALL gates pass AND a versioned
 *    numeric formula is approved. No approved formula exists in v1, so
 *    `confidence` is always null. Level still degrades deterministically.
 *  - Evidence is "verified" only when machine-verified AND it carries a real
 *    provider + version. Original content / snapshot / provider metadata alone
 *    never pass the evidence gate.
 *  - Every failed gate is disclosed in `limitations`.
 */

export const SAFETY_CONFIDENCE_CALIBRATION_VERSION = "v1";
export const SAFETY_MIN_REPORTER_FINALIZED_CASES = 2;
export const SAFETY_MIN_TARGET_FINALIZED_CASES = 2;
export const SAFETY_MIN_UNIQUE_REPORTERS_FOR_CORROBORATION = 2;

/**
 * Versioned approval flag for emitting a NUMERIC confidence score.
 * Stays false until a documented numeric formula is reviewed and approved.
 */
export const SAFETY_NUMERIC_CONFIDENCE_FORMULA_APPROVED = false;

export type SafetyConfidenceLevel =
  | "high"
  | "moderate"
  | "low"
  | "insufficient_data";

export type SafetyConfidenceCalibration = {
  version: string;
  confidenceLevel: SafetyConfidenceLevel;
  confidence: number | null;
  dataCoverage: {
    reporterHistoryAvailable: boolean;
    targetHistoryAvailable: boolean;
    evidenceVerified: boolean;
    corroborationAvailable: boolean;
    finalizedReporterCases: number;
    finalizedTargetCases: number;
    uniqueReporterCount: number;
  };
  gates: {
    reporterHistoryGatePassed: boolean;
    targetHistoryGatePassed: boolean;
    evidenceGatePassed: boolean;
    corroborationGatePassed: boolean;
    numericConfidenceAllowed: boolean;
  };
  limitations: string[];
};

export type SafetyConfidenceCalibrationInput = {
  reporterFinalizedCases: number;
  targetFinalizedCases: number;
  uniqueReporterCount: number;
  evidenceMachineVerified: boolean;
  evidenceProvider: string | null;
  evidenceProviderVersion: string | null;
  evidenceAnalyzedAt: string | null;
  hasOriginalEvidence: boolean;
  hasSnapshotEvidence: boolean;
  hasHistoricalOutcomeCoverage: boolean;
};

function nonNegInt(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/**
 * Compute honest confidence calibration from FACTS (never raw DB rows).
 * Malformed / null inputs normalize to safe defaults.
 */
export function computeSafetyConfidenceCalibration(
  input: Partial<SafetyConfidenceCalibrationInput>
): SafetyConfidenceCalibration {
  const reporterFinalizedCases = nonNegInt(input.reporterFinalizedCases);
  const targetFinalizedCases = nonNegInt(input.targetFinalizedCases);
  const uniqueReporterCount = nonNegInt(input.uniqueReporterCount);

  const provider = safeText(input.evidenceProvider);
  const providerVersion = safeText(input.evidenceProviderVersion);
  const machineVerified = input.evidenceMachineVerified === true;

  // Evidence is verified ONLY with machine verification + real provider/version.
  const evidenceVerified =
    machineVerified && provider.length > 0 && providerVersion.length > 0;

  const reporterHistoryGatePassed =
    reporterFinalizedCases >= SAFETY_MIN_REPORTER_FINALIZED_CASES;
  const targetHistoryGatePassed =
    targetFinalizedCases >= SAFETY_MIN_TARGET_FINALIZED_CASES;
  const evidenceGatePassed = evidenceVerified;
  const corroborationGatePassed =
    uniqueReporterCount >= SAFETY_MIN_UNIQUE_REPORTERS_FOR_CORROBORATION;

  const allBaseGatesPassed =
    evidenceGatePassed &&
    reporterHistoryGatePassed &&
    targetHistoryGatePassed;

  // Numeric confidence requires ALL gates AND an approved versioned formula.
  const numericConfidenceAllowed =
    allBaseGatesPassed &&
    corroborationGatePassed &&
    SAFETY_NUMERIC_CONFIDENCE_FORMULA_APPROVED;

  const limitations: string[] = [];
  if (!evidenceGatePassed) {
    if (!machineVerified) {
      limitations.push("evidence_not_machine_verified");
    } else if (!provider || !providerVersion) {
      limitations.push("evidence_provider_or_version_missing");
    }
  }
  if (!reporterHistoryGatePassed) {
    limitations.push("reporter_finalized_history_below_minimum");
  }
  if (!targetHistoryGatePassed) {
    limitations.push("target_finalized_history_below_minimum");
  }
  if (!corroborationGatePassed) {
    limitations.push("insufficient_unique_reporter_corroboration");
  }
  if (!input.hasHistoricalOutcomeCoverage) {
    limitations.push("historical_outcome_coverage_missing");
  }

  // Deterministic level from gates (independent of any numeric score).
  let confidenceLevel: SafetyConfidenceLevel;
  if (!allBaseGatesPassed) {
    confidenceLevel = "insufficient_data";
  } else {
    const strongReporter =
      reporterFinalizedCases >= SAFETY_MIN_REPORTER_FINALIZED_CASES * 2;
    const strongTarget =
      targetFinalizedCases >= SAFETY_MIN_TARGET_FINALIZED_CASES * 2;
    const historicalCoverage = input.hasHistoricalOutcomeCoverage === true;
    const coveragePoints = [
      corroborationGatePassed,
      historicalCoverage,
      strongReporter,
      strongTarget,
    ].filter(Boolean).length;

    if (corroborationGatePassed && historicalCoverage && coveragePoints >= 3) {
      confidenceLevel = "high";
    } else if (coveragePoints >= 1) {
      confidenceLevel = "moderate";
    } else {
      confidenceLevel = "low";
    }
  }

  // No approved numeric formula exists, so confidence is always null in v1.
  // When numericConfidenceAllowed becomes true (formula approved), a versioned
  // numeric score would be computed here instead.
  const confidence: number | null = null;
  if (!numericConfidenceAllowed) {
    limitations.push("numeric_confidence_requires_approved_versioned_formula");
  }

  return {
    version: SAFETY_CONFIDENCE_CALIBRATION_VERSION,
    confidenceLevel,
    confidence,
    dataCoverage: {
      reporterHistoryAvailable: reporterFinalizedCases > 0,
      targetHistoryAvailable: targetFinalizedCases > 0,
      evidenceVerified,
      corroborationAvailable: corroborationGatePassed,
      finalizedReporterCases: reporterFinalizedCases,
      finalizedTargetCases: targetFinalizedCases,
      uniqueReporterCount,
    },
    gates: {
      reporterHistoryGatePassed,
      targetHistoryGatePassed,
      evidenceGatePassed,
      corroborationGatePassed,
      numericConfidenceAllowed,
    },
    limitations,
  };
}
