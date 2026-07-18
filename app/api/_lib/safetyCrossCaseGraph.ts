/**
 * Safety Cross-Case Pattern Signals (Phase 2A).
 *
 * Pure, deterministic relationship analysis over EXISTING Safety Center data.
 * No DB / path-alias imports so the harness can unit-test it directly.
 *
 * Uses ONLY already-persisted identifiers: reporter user id, target/owner user
 * id, church id, category, source/target type, report id, created/decision
 * timestamps, finalized outcomes, and evidence_url_hash. It NEVER uses device,
 * IP, location, user-agent, OCR, or classifier data.
 *
 * Honesty rules (enforced here):
 *  - Every signal.confidence is null (no versioned formula/coverage yet).
 *  - Signals are facts/leads, NOT proof of a violation or of guilt.
 *  - Open reports can support volume/burst but are NEVER counted as confirmed
 *    violations.
 *  - coordinated_reporting_signal only emerges when multiple facts converge.
 *  - Grouping is per-target, so one target's data cannot leak into another's.
 */

export const SAFETY_CROSS_CASE_SIGNALS_VERSION = "v1";

// Versioned, named thresholds (auditable — change with a version bump).
export const SAFETY_REPORT_BURST_WINDOW_HOURS = 24;
export const SAFETY_REPORT_BURST_MIN_REPORTS = 3;
export const SAFETY_REPEATED_REPORTER_MIN_REPORTS = 3;
export const SAFETY_MULTI_REPORTER_MIN_UNIQUE = 3;
export const SAFETY_RECURRING_CATEGORY_MIN_REPORTS = 3;
export const SAFETY_REPEATED_CONFIRMED_MIN = 2;
export const SAFETY_MULTI_SURFACE_MIN_DISTINCT = 2;
export const SAFETY_DUPLICATE_EVIDENCE_MIN_CASES = 2;
export const SAFETY_COORDINATED_WINDOW_HOURS = 24;
export const SAFETY_COORDINATED_MIN_UNIQUE_REPORTERS = 3;

export type SafetyCrossCaseSignalType =
  | "repeated_reporter_targeting_signal"
  | "multi_reporter_target_signal"
  | "recurring_category_signal"
  | "report_burst_signal"
  | "repeated_confirmed_violation_signal"
  | "multi_surface_owner_signal"
  | "duplicate_evidence_url_signal"
  | "coordinated_reporting_signal";

export type SafetyCrossCaseSeverity = "low" | "medium" | "high";

export type SafetyCrossCasePatternSignal = {
  type: SafetyCrossCaseSignalType;
  /** Always null — no versioned confidence formula exists yet. */
  confidence: number | null;
  severity: SafetyCrossCaseSeverity;
  supportingCaseIds: string[];
  supportingCount: number;
  explanation: string;
  limitations: string[];
};

export type CrossCaseRow = {
  reportId?: unknown;
  reporterUserId?: unknown;
  targetId?: unknown;
  targetOwnerUserId?: unknown;
  churchId?: unknown;
  category?: unknown;
  sourceType?: unknown;
  targetType?: unknown;
  createdAt?: unknown;
  decisionAt?: unknown;
  status?: unknown;
  outcomeType?: unknown;
  isConfirmedViolation?: unknown;
  evidenceUrlHash?: unknown;
};

const SIGNAL_SEVERITY: Record<
  SafetyCrossCaseSignalType,
  SafetyCrossCaseSeverity
> = {
  repeated_reporter_targeting_signal: "medium",
  multi_reporter_target_signal: "medium",
  recurring_category_signal: "low",
  report_burst_signal: "medium",
  repeated_confirmed_violation_signal: "high",
  multi_surface_owner_signal: "low",
  duplicate_evidence_url_signal: "medium",
  coordinated_reporting_signal: "high",
};

const BASE_LIMITATIONS = Object.freeze([
  "confidence_requires_versioned_formula_and_coverage",
  "signal_is_not_proof_of_violation",
]);

const FINALIZED_STATUSES = new Set(["resolved", "dismissed"]);

function safeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function safeLower(value: unknown): string {
  return safeText(value).toLowerCase();
}

function parseMs(value: unknown): number | null {
  const ms = Date.parse(safeText(value));
  return Number.isFinite(ms) ? ms : null;
}

function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => safeText(id)))];
}

type NormalizedRow = {
  reportId: string;
  reporterUserId: string;
  targetKey: string;
  category: string;
  surface: string;
  createdMs: number | null;
  isConfirmedViolation: boolean;
  isOpen: boolean;
  evidenceUrlHash: string;
};

function normalizeRow(row: CrossCaseRow): NormalizedRow | null {
  const targetKey =
    safeText(row.targetOwnerUserId) || safeText(row.targetId);
  // Malformed rows (no target identity) are dropped.
  if (!targetKey) return null;

  const status = safeLower(row.status);
  const outcome = safeLower(row.outcomeType);
  const isFinalized =
    FINALIZED_STATUSES.has(status) ||
    outcome === "no_violation" ||
    row.isConfirmedViolation === true;

  return {
    reportId: safeText(row.reportId),
    reporterUserId: safeText(row.reporterUserId),
    targetKey,
    category: safeLower(row.category),
    surface: safeLower(row.sourceType) || safeLower(row.targetType),
    createdMs: parseMs(row.createdAt),
    isConfirmedViolation: row.isConfirmedViolation === true,
    isOpen: !isFinalized,
    evidenceUrlHash: safeText(row.evidenceUrlHash),
  };
}

function makeSignal(
  type: SafetyCrossCaseSignalType,
  supportingCaseIds: string[],
  explanation: string,
  extraLimitations: string[] = []
): SafetyCrossCasePatternSignal {
  const ids = dedupeIds(supportingCaseIds);
  return {
    type,
    confidence: null,
    severity: SIGNAL_SEVERITY[type],
    supportingCaseIds: ids,
    supportingCount: ids.length,
    explanation,
    limitations: [...BASE_LIMITATIONS, ...extraLimitations],
  };
}

/**
 * Best rolling time window: returns the row indices inside the densest window
 * of `windowMs`. Rows without a timestamp are ignored for windowing.
 */
function densestWindow(
  rows: NormalizedRow[],
  windowMs: number
): NormalizedRow[] {
  const timed = rows
    .filter((r) => r.createdMs != null)
    .sort((a, b) => (a.createdMs as number) - (b.createdMs as number));
  let best: NormalizedRow[] = [];
  let start = 0;
  for (let end = 0; end < timed.length; end += 1) {
    while (
      (timed[end].createdMs as number) - (timed[start].createdMs as number) >
      windowMs
    ) {
      start += 1;
    }
    const windowRows = timed.slice(start, end + 1);
    if (windowRows.length > best.length) best = windowRows;
  }
  return best;
}

function computeTargetSignals(
  targetKey: string,
  rows: NormalizedRow[]
): SafetyCrossCasePatternSignal[] {
  const signals: SafetyCrossCasePatternSignal[] = [];

  // 1. repeated_reporter_targeting — one reporter repeatedly on this target.
  const byReporter = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (!r.reporterUserId) continue;
    const list = byReporter.get(r.reporterUserId) || [];
    list.push(r);
    byReporter.set(r.reporterUserId, list);
  }
  for (const [reporter, list] of byReporter) {
    const ids = dedupeIds(list.map((r) => r.reportId));
    if (ids.length >= SAFETY_REPEATED_REPORTER_MIN_REPORTS) {
      signals.push(
        makeSignal(
          "repeated_reporter_targeting_signal",
          ids,
          `Reporter ${reporter} filed ${ids.length} reports against the same target.`,
          ["may_indicate_harassment_or_revenge_reporting_not_confirmed"]
        )
      );
    }
  }

  // 2. multi_reporter_target — many unique reporters on one target.
  const uniqueReporters = new Set(
    rows.map((r) => r.reporterUserId).filter((id) => id)
  );
  if (uniqueReporters.size >= SAFETY_MULTI_REPORTER_MIN_UNIQUE) {
    signals.push(
      makeSignal(
        "multi_reporter_target_signal",
        rows.map((r) => r.reportId),
        `${uniqueReporters.size} unique reporters filed reports against this target.`,
        ["includes_open_reports_for_volume"]
      )
    );
  }

  // 3. recurring_category — same category recurring for this target.
  const byCategory = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (!r.category) continue;
    const list = byCategory.get(r.category) || [];
    list.push(r);
    byCategory.set(r.category, list);
  }
  for (const [category, list] of byCategory) {
    const ids = dedupeIds(list.map((r) => r.reportId));
    if (ids.length >= SAFETY_RECURRING_CATEGORY_MIN_REPORTS) {
      signals.push(
        makeSignal(
          "recurring_category_signal",
          ids,
          `Category "${category}" recurs across ${ids.length} reports for this target.`
        )
      );
    }
  }

  // 4. report_burst — dense volume in a time window (open reports allowed).
  const burstWindow = densestWindow(
    rows,
    SAFETY_REPORT_BURST_WINDOW_HOURS * 3600_000
  );
  if (burstWindow.length >= SAFETY_REPORT_BURST_MIN_REPORTS) {
    signals.push(
      makeSignal(
        "report_burst_signal",
        burstWindow.map((r) => r.reportId),
        `${burstWindow.length} reports within ${SAFETY_REPORT_BURST_WINDOW_HOURS}h against this target.`,
        ["includes_open_reports_for_volume"]
      )
    );
  }

  // 5. repeated_confirmed_violation — finalized confirmed outcomes only.
  const confirmed = rows.filter((r) => r.isConfirmedViolation);
  const confirmedIds = dedupeIds(confirmed.map((r) => r.reportId));
  if (confirmedIds.length >= SAFETY_REPEATED_CONFIRMED_MIN) {
    signals.push(
      makeSignal(
        "repeated_confirmed_violation_signal",
        confirmedIds,
        `${confirmedIds.length} finalized confirmed violations for this target.`,
        ["confirmed_outcomes_only_open_reports_excluded"]
      )
    );
  }

  // 6. multi_surface_owner — reports across distinct surfaces for one owner.
  const surfaces = new Set(rows.map((r) => r.surface).filter((s) => s));
  if (surfaces.size >= SAFETY_MULTI_SURFACE_MIN_DISTINCT) {
    signals.push(
      makeSignal(
        "multi_surface_owner_signal",
        rows.filter((r) => r.surface).map((r) => r.reportId),
        `Reports span ${surfaces.size} distinct surfaces (${[...surfaces].join(", ")}) for this owner.`
      )
    );
  }

  // 7. duplicate_evidence_url — same evidence hash across multiple cases.
  const byHash = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (!r.evidenceUrlHash) continue;
    const list = byHash.get(r.evidenceUrlHash) || [];
    list.push(r);
    byHash.set(r.evidenceUrlHash, list);
  }
  for (const [, list] of byHash) {
    const ids = dedupeIds(list.map((r) => r.reportId));
    if (ids.length >= SAFETY_DUPLICATE_EVIDENCE_MIN_CASES) {
      signals.push(
        makeSignal(
          "duplicate_evidence_url_signal",
          ids,
          `Identical evidence URL appears across ${ids.length} cases for this target.`,
          ["matches_identical_url_only_not_visual_similarity"]
        )
      );
    }
  }

  // 8. coordinated_reporting — multiple facts converge: many unique reporters
  //    concentrated in a short window (label is a SIGNAL, not confirmed abuse).
  const coordinatedWindow = densestWindow(
    rows,
    SAFETY_COORDINATED_WINDOW_HOURS * 3600_000
  );
  const windowReporters = new Set(
    coordinatedWindow.map((r) => r.reporterUserId).filter((id) => id)
  );
  if (
    windowReporters.size >= SAFETY_COORDINATED_MIN_UNIQUE_REPORTERS &&
    coordinatedWindow.length >= SAFETY_REPORT_BURST_MIN_REPORTS
  ) {
    signals.push(
      makeSignal(
        "coordinated_reporting_signal",
        coordinatedWindow.map((r) => r.reportId),
        `${windowReporters.size} unique reporters filed ${coordinatedWindow.length} reports within ${SAFETY_COORDINATED_WINDOW_HOURS}h against this target.`,
        [
          "coordinated_label_is_a_signal_not_confirmed_abuse",
          "requires_human_review_before_any_action",
        ]
      )
    );
  }

  return signals;
}

/**
 * Compute cross-case pattern signals from existing case rows.
 * Rows are grouped strictly per target so signals never mix targets.
 */
export function computeCrossCasePatternSignals(
  rows: CrossCaseRow[]
): SafetyCrossCasePatternSignal[] {
  const normalized: NormalizedRow[] = [];
  for (const row of rows || []) {
    const n = normalizeRow(row);
    if (n) normalized.push(n);
  }

  const byTarget = new Map<string, NormalizedRow[]>();
  for (const r of normalized) {
    const list = byTarget.get(r.targetKey) || [];
    list.push(r);
    byTarget.set(r.targetKey, list);
  }

  const signals: SafetyCrossCasePatternSignal[] = [];
  for (const [targetKey, list] of byTarget) {
    signals.push(...computeTargetSignals(targetKey, list));
  }
  return signals;
}
