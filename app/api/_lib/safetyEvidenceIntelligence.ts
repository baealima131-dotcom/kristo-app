/**
 * Safety Evidence Intelligence — contracts + validation ONLY (Phase 2B).
 *
 * Pure, deterministic. No DB / path-alias / network imports so the harness can
 * unit-test it directly, and so it CANNOT capture device/IP/geo/user-agent.
 *
 * This is a schema/contract layer. There is NO classifier provider wired yet:
 *  - No fake provider, no hardcoded confidence values.
 *  - machineVerified is DERIVED, never trusted from the raw payload.
 *  - Every confidence field is nullable; malformed/out-of-range → null (never
 *    fabricated, never averaged into a synthetic overall score).
 *  - Unknown / secret / raw provider fields are stripped before persistence.
 *  - Privacy-gated signals are reserved-only: captureStatus "not_collected"
 *    and all values null. No collection code path exists.
 */

export const SAFETY_EVIDENCE_SCHEMA_VERSION = "v1";

export type SafetyEvidenceClassifierResult = {
  schemaVersion: string;
  provider: string;
  providerVersion: string;
  analyzedAt: string;
  ocrConfidence: number | null;
  imageClassificationConfidence: number | null;
  videoClassificationConfidence: number | null;
  manipulationDetectionConfidence: number | null;
  duplicateEvidenceConfidence: number | null;
  metadataConsistencyConfidence: number | null;
  overallEvidenceConfidence: number | null;
  machineVerified: boolean;
  limitations: string[];
};

export type SafetyPrivacyCaptureStatus =
  | "not_collected"
  | "privacy_review_required"
  | "approved";

export type SafetyPrivacyGatedSignals = {
  reporterDeviceHash: string | null;
  reporterIpHash: string | null;
  reporterGeoCoarse: string | null;
  captureStatus: SafetyPrivacyCaptureStatus;
  retentionPolicyVersion: string | null;
  hashingPolicyVersion: string | null;
  consentDisclosureVersion: string | null;
  limitations: string[];
};

/** Component classifier signals (overall is provider-supplied, not a signal). */
export const SAFETY_EVIDENCE_CONFIDENCE_FIELDS = [
  "ocrConfidence",
  "imageClassificationConfidence",
  "videoClassificationConfidence",
  "manipulationDetectionConfidence",
  "duplicateEvidenceConfidence",
  "metadataConsistencyConfidence",
] as const;

/** Only these keys may ever be persisted for a classifier result. */
export const SAFETY_EVIDENCE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "provider",
  "providerVersion",
  "analyzedAt",
  ...SAFETY_EVIDENCE_CONFIDENCE_FIELDS,
  "overallEvidenceConfidence",
  "machineVerified",
  "limitations",
]);

const SECRET_KEY_PATTERN =
  /(token|secret|api[_-]?key|authorization|password|passwd|credential|bearer|raw[_-]?payload|access[_-]?key|private[_-]?key|session)/i;

function safeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/** True only for a non-blank, parseable timestamp string. */
export function isValidEvidenceTimestamp(value: unknown): boolean {
  const t = safeText(value);
  if (!t) return false;
  const ms = Date.parse(t);
  return Number.isFinite(ms);
}

/**
 * A confidence value is valid only within 0..100. Anything else (missing,
 * malformed, out of range) becomes null. Never clamped, never fabricated.
 */
export function normalizeConfidenceValue(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/** Trimmed provider metadata (no defaults invented). */
export function normalizeProviderMetadata(input: {
  provider?: unknown;
  providerVersion?: unknown;
  analyzedAt?: unknown;
}): { provider: string; providerVersion: string; analyzedAt: string } {
  const provider = safeText(input?.provider);
  const providerVersion = safeText(input?.providerVersion);
  const analyzedAtRaw = safeText(input?.analyzedAt);
  const analyzedAt = isValidEvidenceTimestamp(analyzedAtRaw)
    ? new Date(analyzedAtRaw).toISOString()
    : "";
  return { provider, providerVersion, analyzedAt };
}

/** True when at least one real component classifier signal is present. */
export function hasRealClassifierSignal(
  confidences: Partial<
    Record<(typeof SAFETY_EVIDENCE_CONFIDENCE_FIELDS)[number], number | null>
  >
): boolean {
  return SAFETY_EVIDENCE_CONFIDENCE_FIELDS.some(
    (field) => confidences[field] != null
  );
}

/** The empty / no-provider result: everything null, unverified, disclosed. */
export function emptyEvidenceClassifierResult(
  extraLimitations: string[] = []
): SafetyEvidenceClassifierResult {
  return {
    schemaVersion: SAFETY_EVIDENCE_SCHEMA_VERSION,
    provider: "",
    providerVersion: "",
    analyzedAt: "",
    ocrConfidence: null,
    imageClassificationConfidence: null,
    videoClassificationConfidence: null,
    manipulationDetectionConfidence: null,
    duplicateEvidenceConfidence: null,
    metadataConsistencyConfidence: null,
    overallEvidenceConfidence: null,
    machineVerified: false,
    limitations: [
      "no_evidence_classifier_provider_connected",
      ...extraLimitations,
    ],
  };
}

/** Reserved-only privacy signals for Phase 2B — never collected here. */
export function emptyPrivacyGatedSignals(): SafetyPrivacyGatedSignals {
  return {
    reporterDeviceHash: null,
    reporterIpHash: null,
    reporterGeoCoarse: null,
    captureStatus: "not_collected",
    retentionPolicyVersion: null,
    hashingPolicyVersion: null,
    consentDisclosureVersion: null,
    limitations: [
      "privacy_signals_reserved_not_collected",
      "requires_privacy_review_before_capture",
    ],
  };
}

/**
 * Normalize an untrusted provider payload into the auditable contract.
 *
 * - Unknown keys are stripped (limitation disclosed).
 * - Secret-like keys or raw payload keys cause the result to be REJECTED
 *   (machineVerified forced false) and are never persisted.
 * - machineVerified is derived, never trusted from input.
 */
export function normalizeEvidenceClassifierResult(
  raw: unknown
): SafetyEvidenceClassifierResult {
  if (raw == null || typeof raw !== "object") {
    return emptyEvidenceClassifierResult();
  }

  const obj = raw as Record<string, unknown>;
  const limitations: string[] = [];

  const presentKeys = Object.keys(obj);
  const unknownKeys = presentKeys.filter(
    (k) => !SAFETY_EVIDENCE_ALLOWED_KEYS.has(k)
  );
  const secretKeys = unknownKeys.filter((k) => SECRET_KEY_PATTERN.test(k));
  let rejected = false;
  if (secretKeys.length > 0) {
    limitations.push("raw_provider_payload_rejected");
    rejected = true;
  } else if (unknownKeys.length > 0) {
    limitations.push("unknown_provider_fields_stripped");
  }

  const { provider, providerVersion, analyzedAt } = normalizeProviderMetadata({
    provider: obj.provider,
    providerVersion: obj.providerVersion,
    analyzedAt: obj.analyzedAt,
  });

  if (!provider) limitations.push("missing_provider");
  if (!providerVersion) limitations.push("missing_provider_version");
  if (!analyzedAt) limitations.push("invalid_analyzed_at");

  const confidences: Record<string, number | null> = {};
  for (const field of SAFETY_EVIDENCE_CONFIDENCE_FIELDS) {
    const original = obj[field];
    const normalized = normalizeConfidenceValue(original);
    if (original != null && normalized == null) {
      limitations.push(`${field}_out_of_range`);
    }
    confidences[field] = normalized;
  }

  const overallOriginal = obj.overallEvidenceConfidence;
  const overallEvidenceConfidence = normalizeConfidenceValue(overallOriginal);
  if (overallOriginal != null && overallEvidenceConfidence == null) {
    limitations.push("overall_evidence_confidence_out_of_range");
  }

  const hasSignal = hasRealClassifierSignal(confidences);
  if (!hasSignal) limitations.push("no_real_classifier_signal");

  // machineVerified is DERIVED — never taken from the payload.
  const machineVerified =
    !rejected &&
    provider.length > 0 &&
    providerVersion.length > 0 &&
    analyzedAt.length > 0 &&
    hasSignal;

  return {
    schemaVersion: SAFETY_EVIDENCE_SCHEMA_VERSION,
    provider,
    providerVersion,
    analyzedAt,
    ocrConfidence: confidences.ocrConfidence,
    imageClassificationConfidence: confidences.imageClassificationConfidence,
    videoClassificationConfidence: confidences.videoClassificationConfidence,
    manipulationDetectionConfidence:
      confidences.manipulationDetectionConfidence,
    duplicateEvidenceConfidence: confidences.duplicateEvidenceConfidence,
    metadataConsistencyConfidence: confidences.metadataConsistencyConfidence,
    overallEvidenceConfidence,
    machineVerified,
    limitations,
  };
}

/**
 * Allowlist-only projection for persistence. Guarantees no unknown/secret/raw
 * keys ever reach storage, even if a caller hand-builds a result object with
 * extra runtime keys. Values are re-validated but the derived machineVerified
 * flag and disclosed limitations are preserved.
 */
export function sanitizeEvidenceClassifierForPersist(
  result: SafetyEvidenceClassifierResult
): SafetyEvidenceClassifierResult {
  const src = (result || {}) as Record<string, unknown>;
  const limitations = Array.isArray(src.limitations)
    ? src.limitations.map((l) => safeText(l)).filter(Boolean)
    : [];
  return {
    schemaVersion: safeText(src.schemaVersion) || SAFETY_EVIDENCE_SCHEMA_VERSION,
    provider: safeText(src.provider),
    providerVersion: safeText(src.providerVersion),
    analyzedAt: isValidEvidenceTimestamp(src.analyzedAt)
      ? new Date(safeText(src.analyzedAt)).toISOString()
      : "",
    ocrConfidence: normalizeConfidenceValue(src.ocrConfidence),
    imageClassificationConfidence: normalizeConfidenceValue(
      src.imageClassificationConfidence
    ),
    videoClassificationConfidence: normalizeConfidenceValue(
      src.videoClassificationConfidence
    ),
    manipulationDetectionConfidence: normalizeConfidenceValue(
      src.manipulationDetectionConfidence
    ),
    duplicateEvidenceConfidence: normalizeConfidenceValue(
      src.duplicateEvidenceConfidence
    ),
    metadataConsistencyConfidence: normalizeConfidenceValue(
      src.metadataConsistencyConfidence
    ),
    overallEvidenceConfidence: normalizeConfidenceValue(
      src.overallEvidenceConfidence
    ),
    machineVerified: src.machineVerified === true,
    limitations,
  };
}

/** JSON string safe to persist in evidence_classifier_json (allowlisted). */
export function serializeEvidenceClassifierForPersist(
  result: SafetyEvidenceClassifierResult
): string {
  return JSON.stringify(sanitizeEvidenceClassifierForPersist(result));
}
