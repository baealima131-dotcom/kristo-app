/**
 * Safety Intelligence historical ledger + target/reporter timelines.
 *
 * Append-only learning store for finalized Safety Center outcomes.
 * Case Intelligence reads these timelines — no synthetic scores.
 */

import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  SAFETY_INTEL_BACKFILL_BATCH_SIZE,
  SAFETY_INTEL_BACKFILL_META_KEY,
  buildReporterAccuracyProgression,
  emptySafetyIntelligenceTimelines,
  isConfirmedViolationOutcome,
  isFinalizedLearningDecisionType,
  isMaliciousReportSignal,
  summarizeTargetFinalizedOutcomes,
  type LedgerOutcomeEvent,
  type SafetyIntelligenceEventKind,
  type SafetyIntelligenceOutcomeType,
  type SafetyIntelligenceTimelines,
  type SafetyReporterAccuracyPoint,
  type SafetyReporterIntelligenceTimeline,
  type SafetyReporterRepeatedTarget,
  type SafetyTargetEnforcementHistoryItem,
  type SafetyTargetIntelligenceTimeline,
} from "@/app/api/_lib/safetyIntelligenceHistory";
import {
  SAFETY_SEVERITY_MAP_VERSION,
  computeEvidenceUrlHash,
  computeOutcomeLearningMetadata,
  computeResolutionMinutes,
  computeSeverityScore,
  normalizeInvestigatorConfidence,
  type SafetyOutcomeAppealOutcome,
} from "@/app/api/_lib/safetyOutcomeLearning";
import {
  getDatabaseUrl,
} from "@/app/api/_lib/store/authDb";

export type {
  SafetyIntelligenceEventKind,
  SafetyIntelligenceOutcomeType,
  SafetyIntelligenceTimelines,
  SafetyReporterAccuracyPoint,
  SafetyReporterIntelligenceTimeline,
  SafetyReporterRepeatedTarget,
  SafetyTargetEnforcementHistoryItem,
  SafetyTargetIntelligenceTimeline,
};

export {
  emptySafetyIntelligenceTimelines,
  isConfirmedViolationOutcome,
  isFinalizedLearningDecisionType,
  isMaliciousReportSignal,
};

neonConfig.fetchConnectionCache = true;

/**
 * Versioned, run-once enrichment of Outcome Learning columns on existing rows.
 * Separate from the v1 row-insert backfill so it can be gated independently.
 */
export const SAFETY_INTEL_OUTCOME_BACKFILL_META_KEY =
  "intelligence_events_backfill_v2";

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady = false;
/** Process-local cache of DB-versioned backfill completion. */
let backfillCompleteCached = false;
/** Process-local cache of DB-versioned outcome-learning enrichment (v2). */
let outcomeBackfillCompleteCached = false;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) {
      throw new Error("DATABASE_URL not configured");
    }
    sqlClient = neon(url);
  }
  return sqlClient;
}

function safeText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function safeLower(value: unknown) {
  return safeText(value).toLowerCase();
}

function nonNegInt(value: unknown) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function asRowArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function createIntelligenceEventId() {
  return `sie_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export async function ensureSafetyIntelligenceEventsSchema() {
  if (schemaReady) return;

  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS kristo_safety_intelligence_events (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_kind TEXT NOT NULL,
      outcome_type TEXT NOT NULL,
      report_id TEXT,
      report_code TEXT,
      reporter_user_id TEXT,
      target_type TEXT,
      target_id TEXT,
      target_owner_user_id TEXT,
      category TEXT,
      reason TEXT,
      decision_type TEXT,
      decision_reason TEXT,
      decided_by_user_id TEXT,
      decided_by_role TEXT,
      decision_at TIMESTAMPTZ,
      enforcement_id TEXT,
      is_confirmed_violation BOOLEAN NOT NULL DEFAULT FALSE,
      is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
      is_malicious_report BOOLEAN NOT NULL DEFAULT FALSE,
      metadata_json TEXT
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_safety_intel_events_owner_decision
    ON kristo_safety_intelligence_events (
      target_owner_user_id,
      decision_at DESC
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_safety_intel_events_target_decision
    ON kristo_safety_intelligence_events (
      target_type,
      target_id,
      decision_at DESC
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_safety_intel_events_reporter_decision
    ON kristo_safety_intelligence_events (
      reporter_user_id,
      decision_at DESC
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_safety_intel_events_report_kind_outcome
    ON kristo_safety_intelligence_events (
      report_id,
      event_kind,
      outcome_type
    )
    WHERE report_id IS NOT NULL
  `;

  /*
   * Phase 2A — Outcome Learning metadata (additive, all nullable).
   * Derived from real finalized data only; no synthetic scores.
   *   severity_score        -> versioned decision+category map (0..100)
   *   severity_map_version  -> map revision tag (also the "enriched" marker)
   *   resolution_minutes    -> created_at -> decision_at
   *   investigator_confidence-> human decision_confidence only
   *   appeal_*              -> appeals not built (reserved contract)
   *   final_outcome_weight  -> null until an explainable policy exists
   *   evidence_url_hash     -> sha256 of an already-stored media URL
   */
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS severity_score INTEGER
  `;
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS severity_map_version TEXT
  `;
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS resolution_minutes INTEGER
  `;
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS investigator_confidence INTEGER
  `;
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS appeal_filed BOOLEAN NOT NULL DEFAULT FALSE
  `;
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS appeal_outcome TEXT
  `;
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS final_outcome_weight NUMERIC
  `;
  await sql`
    ALTER TABLE kristo_safety_intelligence_events
    ADD COLUMN IF NOT EXISTS evidence_url_hash TEXT
  `;

  // Supervisor reliability facts (Commit #2 reads this; index added now).
  await sql`
    CREATE INDEX IF NOT EXISTS idx_safety_intel_events_decider_decision
    ON kristo_safety_intelligence_events (
      decided_by_user_id,
      decision_at DESC
    )
  `;

  // Category trends / analytics aggregates.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_safety_intel_events_category_decision
    ON kristo_safety_intelligence_events (
      category,
      decision_at DESC
    )
  `;

  // Exact-URL evidence linking across cases (cross-case graph).
  await sql`
    CREATE INDEX IF NOT EXISTS idx_safety_intel_events_evidence_hash
    ON kristo_safety_intelligence_events (
      evidence_url_hash
    )
    WHERE evidence_url_hash IS NOT NULL
  `;

  /*
   * Versioned backfill completion marker — PK lookup only on hot paths.
   * Prevents full-table rescans on every report GET after v1 completes.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS kristo_safety_intelligence_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  schemaReady = true;
}

export type RecordSafetyIntelligenceEventInput = {
  eventKind?: SafetyIntelligenceEventKind;
  outcomeType: SafetyIntelligenceOutcomeType | string;
  reportId?: string;
  reportCode?: string;
  reporterUserId?: string;
  targetType?: string;
  targetId?: string;
  targetOwnerUserId?: string;
  category?: string;
  reason?: string;
  decisionType?: string;
  decisionReason?: string;
  decidedByUserId?: string;
  decidedByRole?: string;
  decisionAt?: string;
  enforcementId?: string;
  isConfirmedViolation?: boolean;
  isDismissed?: boolean;
  isMaliciousReport?: boolean;
  metadata?: Record<string, unknown>;
  /** Phase 2A outcome-learning columns (all derived from real data, nullable). */
  severityScore?: number | null;
  severityMapVersion?: string | null;
  resolutionMinutes?: number | null;
  investigatorConfidence?: number | null;
  appealFiled?: boolean;
  appealOutcome?: SafetyOutcomeAppealOutcome;
  finalOutcomeWeight?: number | null;
  evidenceUrlHash?: string | null;
};

function nullableInt(value: unknown): number | null {
  if (value == null) return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : null;
}

function nullableNumeric(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function dbRecordSafetyIntelligenceEvent(
  input: RecordSafetyIntelligenceEventInput
): Promise<{ id: string; inserted: boolean }> {
  await ensureSafetyIntelligenceEventsSchema();
  const sql = getSql();

  const decisionType = safeLower(input.decisionType || input.outcomeType);
  const outcomeType = safeLower(input.outcomeType || decisionType);
  if (!outcomeType) {
    return { id: "", inserted: false };
  }

  if (
    input.eventKind !== "appeal" &&
    decisionType &&
    !isFinalizedLearningDecisionType(decisionType) &&
    outcomeType !== "dismissed"
  ) {
    return { id: "", inserted: false };
  }

  const eventKind: SafetyIntelligenceEventKind =
    input.eventKind || "decision";
  const isDismissed =
    input.isDismissed ??
    (outcomeType === "no_violation" ||
      outcomeType === "dismissed" ||
      decisionType === "no_violation");
  const isConfirmedViolation =
    input.isConfirmedViolation ??
    isConfirmedViolationOutcome(decisionType || outcomeType);
  const isMaliciousReport =
    input.isMaliciousReport ??
    isMaliciousReportSignal(
      input.decisionReason || input.reason,
      input.metadata?.notes
    );

  const id = createIntelligenceEventId();
  const decisionAt =
    safeText(input.decisionAt) || new Date().toISOString();
  const metadataJson = input.metadata
    ? JSON.stringify(input.metadata)
    : null;

  const reportId = safeText(input.reportId) || null;

  /*
   * Race-safe idempotency via partial unique index:
   * idx_safety_intel_events_report_kind_outcome
   * Covers retries, recovery, backfill∩live, and concurrent writers.
   */
  try {
    const rows = asRowArray<{ id: string }>(
      await sql`
        INSERT INTO kristo_safety_intelligence_events (
          id,
          created_at,
          event_kind,
          outcome_type,
          report_id,
          report_code,
          reporter_user_id,
          target_type,
          target_id,
          target_owner_user_id,
          category,
          reason,
          decision_type,
          decision_reason,
          decided_by_user_id,
          decided_by_role,
          decision_at,
          enforcement_id,
          is_confirmed_violation,
          is_dismissed,
          is_malicious_report,
          metadata_json,
          severity_score,
          severity_map_version,
          resolution_minutes,
          investigator_confidence,
          appeal_filed,
          appeal_outcome,
          final_outcome_weight,
          evidence_url_hash
        )
        VALUES (
          ${id}::text,
          NOW(),
          ${eventKind}::text,
          ${outcomeType}::text,
          ${reportId}::text,
          ${safeText(input.reportCode) || null}::text,
          ${safeText(input.reporterUserId) || null}::text,
          ${safeText(input.targetType) || null}::text,
          ${safeText(input.targetId) || null}::text,
          ${safeText(input.targetOwnerUserId) || null}::text,
          ${safeText(input.category) || null}::text,
          ${safeText(input.reason) || null}::text,
          ${decisionType || null}::text,
          ${safeText(input.decisionReason) || null}::text,
          ${safeText(input.decidedByUserId) || null}::text,
          ${safeText(input.decidedByRole) || null}::text,
          ${decisionAt}::timestamptz,
          ${safeText(input.enforcementId) || null}::text,
          ${isConfirmedViolation}::boolean,
          ${isDismissed}::boolean,
          ${isMaliciousReport}::boolean,
          ${metadataJson}::text,
          ${nullableInt(input.severityScore)}::integer,
          ${safeText(input.severityMapVersion) || null}::text,
          ${nullableInt(input.resolutionMinutes)}::integer,
          ${nullableInt(input.investigatorConfidence)}::integer,
          ${Boolean(input.appealFiled)}::boolean,
          ${safeText(input.appealOutcome) || null}::text,
          ${nullableNumeric(input.finalOutcomeWeight)}::numeric,
          ${safeText(input.evidenceUrlHash) || null}::text
        )
        ON CONFLICT (report_id, event_kind, outcome_type)
        WHERE report_id IS NOT NULL
        DO NOTHING
        RETURNING id
      `
    );

    return {
      id: rows[0]?.id || id,
      inserted: Boolean(rows[0]?.id),
    };
  } catch (error: any) {
    // Unique violation under concurrent writers (23505) → treat as idempotent hit.
    if (
      String(error?.code || "") === "23505" ||
      /duplicate key|unique/i.test(String(error?.message || ""))
    ) {
      return { id, inserted: false };
    }
    throw error;
  }
}

/** Record a finalized report decision into the intelligence ledger. */
export async function dbRecordSafetyIntelligenceFromDecision(input: {
  report: {
    id: string;
    reportCode?: string;
    reporterUserId?: string;
    targetType?: string;
    targetId?: string;
    targetOwnerUserId?: string;
    reportedUserId?: string;
    category?: string;
    reason?: string;
    decisionType?: string;
    decisionReason?: string;
    decisionNotes?: string;
    decidedByUserId?: string;
    decidedByRole?: string;
    decisionAt?: string;
    status?: string;
    createdAt?: string;
    decisionConfidence?: number;
    targetThumbnailUri?: string;
  };
  enforcementId?: string | null;
}): Promise<void> {
  const decisionType = safeLower(input.report.decisionType);
  if (!isFinalizedLearningDecisionType(decisionType)) {
    return;
  }

  // Outcome-learning metadata — derived from real report fields only.
  const outcome = computeOutcomeLearningMetadata({
    decisionType,
    category: input.report.category,
    createdAt: input.report.createdAt,
    decisionAt: input.report.decisionAt,
    investigatorConfidence: input.report.decisionConfidence,
    evidenceUrl: input.report.targetThumbnailUri,
  });

  await dbRecordSafetyIntelligenceEvent({
    eventKind: "decision",
    outcomeType: decisionType as SafetyIntelligenceOutcomeType,
    reportId: input.report.id,
    reportCode: input.report.reportCode,
    reporterUserId: input.report.reporterUserId,
    targetType: input.report.targetType,
    targetId: input.report.targetId,
    targetOwnerUserId:
      input.report.targetOwnerUserId || input.report.reportedUserId,
    category: input.report.category,
    reason: input.report.reason,
    decisionType,
    decisionReason: input.report.decisionReason,
    decidedByUserId: input.report.decidedByUserId,
    decidedByRole: input.report.decidedByRole,
    decisionAt: input.report.decisionAt,
    enforcementId: input.enforcementId || undefined,
    isConfirmedViolation: isConfirmedViolationOutcome(decisionType),
    isDismissed:
      decisionType === "no_violation" ||
      safeLower(input.report.status) === "dismissed",
    isMaliciousReport: isMaliciousReportSignal(
      input.report.decisionReason,
      input.report.decisionNotes
    ),
    metadata: {
      notes: input.report.decisionNotes || null,
      status: input.report.status || null,
    },
    severityScore: outcome.severityScore,
    severityMapVersion: outcome.severityMapVersion,
    resolutionMinutes: outcome.resolutionMinutes,
    investigatorConfidence: outcome.investigatorConfidence,
    appealFiled: outcome.appealFiled,
    appealOutcome: outcome.appealOutcome,
    finalOutcomeWeight: outcome.finalOutcomeWeight,
    evidenceUrlHash: outcome.evidenceUrlHash,
  });
}

/**
 * Idempotent batched backfill from finalized reports (+ linked enforcements).
 * Uses ON CONFLICT so live decision writes colliding with backfill stay one event.
 */
export async function dbBackfillSafetyIntelligenceEvents(
  batchSize: number = SAFETY_INTEL_BACKFILL_BATCH_SIZE
): Promise<{ inserted: number; done: boolean }> {
  await ensureSafetyIntelligenceEventsSchema();
  const sql = getSql();
  const limit = Math.max(
    1,
    Math.min(2000, Math.floor(Number(batchSize) || SAFETY_INTEL_BACKFILL_BATCH_SIZE))
  );

  const rows = asRowArray<{ id: string }>(
    await sql`
      INSERT INTO kristo_safety_intelligence_events (
        id,
        created_at,
        event_kind,
        outcome_type,
        report_id,
        report_code,
        reporter_user_id,
        target_type,
        target_id,
        target_owner_user_id,
        category,
        reason,
        decision_type,
        decision_reason,
        decided_by_user_id,
        decided_by_role,
        decision_at,
        enforcement_id,
        is_confirmed_violation,
        is_dismissed,
        is_malicious_report,
        metadata_json
      )
      SELECT
        'sie_bf_' || r.id,
        COALESCE(r.decision_at, r.resolved_at, r.updated_at, r.created_at, NOW()),
        'decision',
        LOWER(r.decision_type),
        r.id,
        r.report_code,
        r.reporter_user_id,
        r.target_type,
        r.target_id,
        COALESCE(r.target_owner_user_id, r.reported_user_id),
        r.category,
        r.reason,
        LOWER(r.decision_type),
        r.decision_reason,
        r.decided_by_user_id,
        r.decided_by_role,
        COALESCE(r.decision_at, r.resolved_at, r.updated_at, r.created_at, NOW()),
        e.id,
        CASE
          WHEN LOWER(r.decision_type) IN (
            'warning',
            'remove_content',
            'restrict_account',
            'suspend_account',
            'permanent_ban'
          ) THEN TRUE
          ELSE FALSE
        END,
        CASE
          WHEN LOWER(r.decision_type) = 'no_violation'
            OR LOWER(r.status) = 'dismissed'
          THEN TRUE
          ELSE FALSE
        END,
        CASE
          WHEN LOWER(COALESCE(r.decision_reason, '') || ' ' || COALESCE(r.decision_notes, ''))
            LIKE '%false report%'
            OR LOWER(COALESCE(r.decision_reason, '') || ' ' || COALESCE(r.decision_notes, ''))
            LIKE '%false reporting%'
            OR LOWER(COALESCE(r.decision_reason, '') || ' ' || COALESCE(r.decision_notes, ''))
            LIKE '%malicious report%'
            OR LOWER(COALESCE(r.decision_reason, '') || ' ' || COALESCE(r.decision_notes, ''))
            LIKE '%bad faith report%'
          THEN TRUE
          ELSE FALSE
        END,
        json_build_object(
          'source', 'backfill',
          'status', r.status,
          'enforcementType', e.enforcement_type
        )::text
      FROM kristo_safety_reports r
      LEFT JOIN LATERAL (
        SELECT id, enforcement_type
        FROM kristo_safety_account_enforcements
        WHERE report_id = r.id
        ORDER BY created_at DESC
        LIMIT 1
      ) e ON TRUE
      WHERE r.decision_type IS NOT NULL
        AND LOWER(r.decision_type) <> 'escalate'
        AND LOWER(r.decision_type) IN (
          'warning',
          'remove_content',
          'restrict_account',
          'suspend_account',
          'permanent_ban',
          'no_violation'
        )
        AND LOWER(r.status) IN ('resolved', 'dismissed')
        AND NOT EXISTS (
          SELECT 1
          FROM kristo_safety_intelligence_events existing
          WHERE existing.report_id = r.id
            AND existing.event_kind = 'decision'
            AND existing.outcome_type = LOWER(r.decision_type)
        )
      ORDER BY COALESCE(r.decision_at, r.resolved_at, r.created_at) ASC NULLS LAST
      LIMIT ${limit}
      ON CONFLICT (report_id, event_kind, outcome_type)
      WHERE report_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `
  );

  const remaining = asRowArray<{ remaining: number }>(
    await sql`
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM kristo_safety_reports r
          WHERE r.decision_type IS NOT NULL
            AND LOWER(r.decision_type) <> 'escalate'
            AND LOWER(r.decision_type) IN (
              'warning',
              'remove_content',
              'restrict_account',
              'suspend_account',
              'permanent_ban',
              'no_violation'
            )
            AND LOWER(r.status) IN ('resolved', 'dismissed')
            AND NOT EXISTS (
              SELECT 1
              FROM kristo_safety_intelligence_events existing
              WHERE existing.report_id = r.id
                AND existing.event_kind = 'decision'
                AND existing.outcome_type = LOWER(r.decision_type)
            )
          LIMIT 1
        ) THEN 1
        ELSE 0
      END::int AS remaining
    `
  )[0];

  return {
    inserted: rows.length,
    done: nonNegInt(remaining?.remaining) === 0,
  };
}

async function readBackfillMetaValue(
  metaKey: string = SAFETY_INTEL_BACKFILL_META_KEY
): Promise<string | null> {
  const sql = getSql();
  const rows = asRowArray<{ meta_value: string }>(
    await sql`
      SELECT meta_value
      FROM kristo_safety_intelligence_meta
      WHERE meta_key = ${metaKey}
      LIMIT 1
    `
  );
  return rows[0]?.meta_value ? String(rows[0].meta_value) : null;
}

async function markBackfillCompleted(
  metaKey: string = SAFETY_INTEL_BACKFILL_META_KEY
) {
  const sql = getSql();
  await sql`
    INSERT INTO kristo_safety_intelligence_meta (
      meta_key,
      meta_value,
      updated_at
    )
    VALUES (
      ${metaKey},
      'completed',
      NOW()
    )
    ON CONFLICT (meta_key)
    DO UPDATE SET
      meta_value = 'completed',
      updated_at = NOW()
  `;
}

/**
 * Phase 2A — versioned, batched, idempotent enrichment of Outcome Learning
 * columns on pre-existing ledger rows (rows inserted before this deploy, incl.
 * v1-backfilled rows which had no severity/resolution set).
 *
 * Idempotency: only rows WHERE severity_map_version IS NULL are enriched, and
 * each UPDATE re-checks that guard, so repeated runs and concurrent workers
 * converge to a single write per row. Never full-scans on every report GET —
 * gated by SAFETY_INTEL_OUTCOME_BACKFILL_META_KEY once done.
 *
 * Severity/resolution/confidence/hash are computed in JS via the single
 * versioned map (safetyOutcomeLearning.ts) so SQL and app logic cannot drift.
 */
export async function dbBackfillSafetyOutcomeLearning(
  batchSize: number = SAFETY_INTEL_BACKFILL_BATCH_SIZE
): Promise<{ updated: number; done: boolean }> {
  await ensureSafetyIntelligenceEventsSchema();
  const sql = getSql();
  const limit = Math.max(
    1,
    Math.min(
      2000,
      Math.floor(Number(batchSize) || SAFETY_INTEL_BACKFILL_BATCH_SIZE)
    )
  );

  type EnrichRow = {
    id: string;
    outcome_type: string;
    decision_type: string | null;
    category: string | null;
    event_decision_at: string | null;
    report_created_at: string | null;
    report_decision_at: string | null;
    decision_confidence: number | null;
    target_thumbnail_uri: string | null;
  };

  const rows = asRowArray<EnrichRow>(
    await sql`
      SELECT
        e.id,
        e.outcome_type,
        e.decision_type,
        e.category,
        e.decision_at::text AS event_decision_at,
        r.created_at::text AS report_created_at,
        r.decision_at::text AS report_decision_at,
        r.decision_confidence,
        r.target_thumbnail_uri
      FROM kristo_safety_intelligence_events e
      LEFT JOIN kristo_safety_reports r ON r.id = e.report_id
      WHERE e.event_kind = 'decision'
        AND e.severity_map_version IS NULL
      ORDER BY e.created_at ASC
      LIMIT ${limit}
    `
  );

  let updated = 0;
  const chunkSize = 25;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (row) => {
        const decisionType = safeLower(row.decision_type || row.outcome_type);
        const decisionAt =
          safeText(row.report_decision_at) ||
          safeText(row.event_decision_at);
        const severityScore = computeSeverityScore(decisionType, row.category);
        const resolutionMinutes = computeResolutionMinutes(
          row.report_created_at,
          decisionAt
        );
        const investigatorConfidence = normalizeInvestigatorConfidence(
          row.decision_confidence
        );
        const evidenceUrlHash = computeEvidenceUrlHash(
          row.target_thumbnail_uri
        );

        const res = asRowArray<{ id: string }>(
          await sql`
            UPDATE kristo_safety_intelligence_events
            SET
              severity_score = ${nullableInt(severityScore)}::integer,
              severity_map_version = ${SAFETY_SEVERITY_MAP_VERSION}::text,
              resolution_minutes = ${nullableInt(resolutionMinutes)}::integer,
              investigator_confidence = ${nullableInt(
                investigatorConfidence
              )}::integer,
              evidence_url_hash = COALESCE(
                evidence_url_hash,
                ${evidenceUrlHash || null}::text
              )
            WHERE id = ${row.id}
              AND severity_map_version IS NULL
            RETURNING id
          `
        );
        return res.length > 0 ? 1 : 0;
      })
    );
    updated += results.reduce<number>((sum, n) => sum + n, 0);
  }

  const remaining = asRowArray<{ remaining: number }>(
    await sql`
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM kristo_safety_intelligence_events e
          WHERE e.event_kind = 'decision'
            AND e.severity_map_version IS NULL
          LIMIT 1
        ) THEN 1
        ELSE 0
      END::int AS remaining
    `
  )[0];

  return {
    updated,
    done: nonNegInt(remaining?.remaining) === 0,
  };
}

/**
 * Versioned/batched backfill gate.
 * After meta=completed, hot paths only do a PK lookup (or process cache hit).
 * Does NOT full-scan kristo_safety_reports on every report GET once done.
 */
export async function ensureSafetyIntelligenceHistoryReady() {
  await ensureSafetyIntelligenceEventsSchema();
  if (backfillCompleteCached && outcomeBackfillCompleteCached) return;

  try {
    // Stage 1 — v1 row-insert backfill from finalized reports/enforcements.
    if (!backfillCompleteCached) {
      const meta = await readBackfillMetaValue();
      if (meta === "completed") {
        backfillCompleteCached = true;
      } else {
        const result = await dbBackfillSafetyIntelligenceEvents(
          SAFETY_INTEL_BACKFILL_BATCH_SIZE
        );

        console.log("KRISTO_SAFETY_INTEL_BACKFILL", {
          inserted: result.inserted,
          done: result.done,
          metaKey: SAFETY_INTEL_BACKFILL_META_KEY,
        });

        if (result.done) {
          await markBackfillCompleted();
          backfillCompleteCached = true;
        }
      }
    }

    // Stage 2 — v2 outcome-learning enrichment (only after v1 rows exist).
    if (backfillCompleteCached && !outcomeBackfillCompleteCached) {
      const outcomeMeta = await readBackfillMetaValue(
        SAFETY_INTEL_OUTCOME_BACKFILL_META_KEY
      );
      if (outcomeMeta === "completed") {
        outcomeBackfillCompleteCached = true;
      } else {
        const enrich = await dbBackfillSafetyOutcomeLearning(
          SAFETY_INTEL_BACKFILL_BATCH_SIZE
        );

        console.log("KRISTO_SAFETY_INTEL_OUTCOME_BACKFILL", {
          updated: enrich.updated,
          done: enrich.done,
          metaKey: SAFETY_INTEL_OUTCOME_BACKFILL_META_KEY,
          severityMapVersion: SAFETY_SEVERITY_MAP_VERSION,
        });

        if (enrich.done) {
          await markBackfillCompleted(SAFETY_INTEL_OUTCOME_BACKFILL_META_KEY);
          outcomeBackfillCompleteCached = true;
        }
      }
    }
  } catch (error: any) {
    console.log("KRISTO_SAFETY_INTEL_BACKFILL_FAILED", {
      error: safeText(error?.message || "backfill_failed"),
    });
  }
}

function emptyTargetTimeline(): SafetyTargetIntelligenceTimeline {
  return emptySafetyIntelligenceTimelines().target;
}

function emptyReporterTimeline(): SafetyReporterIntelligenceTimeline {
  return emptySafetyIntelligenceTimelines().reporter;
}

function trendDirection(
  reports7d: number,
  reports30d: number,
  reports90d: number
):
  | "increasing"
  | "stable"
  | "declining"
  | "insufficient_data" {
  if (reports90d <= 0 && reports30d <= 0 && reports7d <= 0) {
    return "insufficient_data";
  }
  const recentRate = reports7d;
  const midRate = reports30d / 4; // approx per-week in 30d
  if (reports30d < 2 && reports90d < 3) {
    return "insufficient_data";
  }
  if (recentRate > midRate + 0.75) return "increasing";
  if (recentRate + 0.75 < midRate) return "declining";
  return "stable";
}

export async function dbGetSafetyTargetIntelligenceTimeline(input: {
  targetType?: string;
  targetId?: string;
  targetOwnerUserId?: string;
}): Promise<SafetyTargetIntelligenceTimeline> {
  await ensureSafetyIntelligenceHistoryReady();
  const sql = getSql();

  const targetType = safeLower(input.targetType);
  const targetId = safeText(input.targetId);
  const ownerUserId = safeText(input.targetOwnerUserId);

  if (!targetId && !ownerUserId) {
    return emptyTargetTimeline();
  }

  type BoundRow = {
    first_report_at: string | null;
    last_report_at: string | null;
    lifetime: number;
    reports_7d: number;
    reports_30d: number;
    reports_90d: number;
  };

  let bounds: BoundRow = {
    first_report_at: null,
    last_report_at: null,
    lifetime: 0,
    reports_7d: 0,
    reports_30d: 0,
    reports_90d: 0,
  };

  try {
    if (targetId && ownerUserId) {
      bounds =
        asRowArray<BoundRow>(
          await sql`
            SELECT
              MIN(created_at)::text AS first_report_at,
              MAX(created_at)::text AS last_report_at,
              COUNT(*)::int AS lifetime,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '7 days'
              )::int AS reports_7d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '30 days'
              )::int AS reports_30d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '90 days'
              )::int AS reports_90d
            FROM kristo_safety_reports
            WHERE target_id = ${targetId}
              OR target_owner_user_id = ${ownerUserId}
              OR reported_user_id = ${ownerUserId}
          `
        )[0] || bounds;
    } else if (targetId) {
      bounds =
        asRowArray<BoundRow>(
          await sql`
            SELECT
              MIN(created_at)::text AS first_report_at,
              MAX(created_at)::text AS last_report_at,
              COUNT(*)::int AS lifetime,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '7 days'
              )::int AS reports_7d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '30 days'
              )::int AS reports_30d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '90 days'
              )::int AS reports_90d
            FROM kristo_safety_reports
            WHERE target_id = ${targetId}
          `
        )[0] || bounds;
    } else {
      bounds =
        asRowArray<BoundRow>(
          await sql`
            SELECT
              MIN(created_at)::text AS first_report_at,
              MAX(created_at)::text AS last_report_at,
              COUNT(*)::int AS lifetime,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '7 days'
              )::int AS reports_7d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '30 days'
              )::int AS reports_30d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '90 days'
              )::int AS reports_90d
            FROM kristo_safety_reports
            WHERE target_owner_user_id = ${ownerUserId}
              OR reported_user_id = ${ownerUserId}
          `
        )[0] || bounds;
    }
  } catch {
    // keep empty bounds
  }

  type EventRow = {
    outcome_type: string;
    decision_type: string | null;
    decision_at: string | null;
    report_id: string | null;
    decision_reason: string | null;
    category: string | null;
    is_confirmed_violation: boolean;
    is_dismissed: boolean;
  };

  let events: EventRow[] = [];
  try {
    if (targetId && ownerUserId) {
      events = asRowArray<EventRow>(
        await sql`
          SELECT
            outcome_type,
            decision_type,
            decision_at::text,
            report_id,
            decision_reason,
            category,
            is_confirmed_violation,
            is_dismissed
          FROM kristo_safety_intelligence_events
          WHERE event_kind = 'decision'
            AND (
              (target_type = ${targetType || null} AND target_id = ${targetId})
              OR target_owner_user_id = ${ownerUserId}
            )
          ORDER BY decision_at ASC NULLS LAST, created_at ASC
        `
      );
    } else if (targetId) {
      events = asRowArray<EventRow>(
        await sql`
          SELECT
            outcome_type,
            decision_type,
            decision_at::text,
            report_id,
            decision_reason,
            category,
            is_confirmed_violation,
            is_dismissed
          FROM kristo_safety_intelligence_events
          WHERE event_kind = 'decision'
            AND target_id = ${targetId}
          ORDER BY decision_at ASC NULLS LAST, created_at ASC
        `
      );
    } else {
      events = asRowArray<EventRow>(
        await sql`
          SELECT
            outcome_type,
            decision_type,
            decision_at::text,
            report_id,
            decision_reason,
            category,
            is_confirmed_violation,
            is_dismissed
          FROM kristo_safety_intelligence_events
          WHERE event_kind = 'decision'
            AND target_owner_user_id = ${ownerUserId}
          ORDER BY decision_at ASC NULLS LAST, created_at ASC
        `
      );
    }
  } catch {
    events = [];
  }

  const categoryCounts = new Map<string, number>();
  const ledgerEvents: LedgerOutcomeEvent[] = events.map((event) => {
    const outcome = safeLower(event.outcome_type || event.decision_type);
    const category = safeText(event.category);
    if (category) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
    return {
      outcomeType: outcome,
      decisionAt: safeText(event.decision_at) || undefined,
      reportId: safeText(event.report_id) || undefined,
      decisionReason: safeText(event.decision_reason) || undefined,
      category: category || undefined,
      isConfirmedViolation: Boolean(event.is_confirmed_violation),
      isDismissed: Boolean(event.is_dismissed),
      isMaliciousReport: false,
      isOpen: false,
    };
  });

  const finalized = summarizeTargetFinalizedOutcomes(ledgerEvents);
  const {
    previousWarnings,
    previousSuspensions,
    previousRestrictions,
    previousRemovals,
    previousPermanentBans,
    confirmedViolations,
    noViolationDismissals,
    enforcementHistory,
  } = finalized;

  const repeatedCategories = [...categoryCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([category]) => category)
    .sort();

  const reports7d = nonNegInt(bounds.reports_7d);
  const reports30d = nonNegInt(bounds.reports_30d);
  const reports90d = nonNegInt(bounds.reports_90d);
  const lifetime = nonNegInt(bounds.lifetime);

  return {
    firstReportAt: bounds.first_report_at
      ? String(bounds.first_report_at)
      : null,
    lastReportAt: bounds.last_report_at
      ? String(bounds.last_report_at)
      : null,
    previousWarnings,
    previousSuspensions,
    previousRestrictions,
    previousRemovals,
    previousPermanentBans,
    confirmedViolations,
    noViolationDismissals,
    repeatedCategories,
    trend: {
      reports7d,
      reports30d,
      reports90d,
      lifetime,
      direction: trendDirection(reports7d, reports30d, reports90d),
    },
    enforcementHistory,
  };
}

export async function dbGetSafetyReporterIntelligenceTimeline(input: {
  reporterUserId?: string;
}): Promise<SafetyReporterIntelligenceTimeline> {
  await ensureSafetyIntelligenceHistoryReady();
  const sql = getSql();
  const reporterUserId = safeText(input.reporterUserId);
  if (!reporterUserId) return emptyReporterTimeline();

  let lifetimeReports = 0;
  try {
    lifetimeReports = nonNegInt(
      asRowArray<{ c: number }>(
        await sql`
          SELECT COUNT(*)::int AS c
          FROM kristo_safety_reports
          WHERE reporter_user_id = ${reporterUserId}
        `
      )[0]?.c
    );
  } catch {
    lifetimeReports = 0;
  }

  type EventRow = {
    report_id: string | null;
    decision_at: string | null;
    outcome_type: string;
    decision_type: string | null;
    category: string | null;
    target_type: string | null;
    target_id: string | null;
    target_owner_user_id: string | null;
    is_confirmed_violation: boolean;
    is_dismissed: boolean;
    is_malicious_report: boolean;
  };

  let events: EventRow[] = [];
  try {
    events = asRowArray<EventRow>(
      await sql`
        SELECT
          report_id,
          decision_at::text,
          outcome_type,
          decision_type,
          category,
          target_type,
          target_id,
          target_owner_user_id,
          is_confirmed_violation,
          is_dismissed,
          is_malicious_report
        FROM kristo_safety_intelligence_events
        WHERE event_kind = 'decision'
          AND reporter_user_id = ${reporterUserId}
        ORDER BY decision_at ASC NULLS LAST, created_at ASC
      `
    );
  } catch {
    events = [];
  }

  let confirmedReports = 0;
  let dismissedReports = 0;
  let maliciousReports = 0;
  const reports: SafetyReporterIntelligenceTimeline["reports"] = [];
  const targetCounts = new Map<string, SafetyReporterRepeatedTarget>();
  const ledgerEvents: LedgerOutcomeEvent[] = [];

  for (const event of events) {
    const outcome = safeLower(event.outcome_type || event.decision_type);
    const at = safeText(event.decision_at) || "";
    const reportId = safeText(event.report_id) || "unknown";
    const isConfirmed = Boolean(event.is_confirmed_violation);
    const isDismissed =
      Boolean(event.is_dismissed) || outcome === "no_violation";
    const isMalicious = Boolean(event.is_malicious_report);

    // Ledger rows are finalized only — open reports never appear here.
    ledgerEvents.push({
      outcomeType: outcome,
      decisionAt: at || undefined,
      reportId,
      category: safeText(event.category) || undefined,
      targetType: safeText(event.target_type) || undefined,
      targetId: safeText(event.target_id) || undefined,
      targetOwnerUserId: safeText(event.target_owner_user_id) || undefined,
      isConfirmedViolation: isConfirmed,
      isDismissed,
      isMaliciousReport: isMalicious,
      isOpen: false,
    });

    if (isConfirmed) confirmedReports += 1;
    if (isDismissed) dismissedReports += 1;
    if (isMalicious) maliciousReports += 1;

    const targetKey =
      safeText(event.target_id) ||
      safeText(event.target_owner_user_id) ||
      "";
    if (targetKey) {
      const existing = targetCounts.get(targetKey);
      if (existing) {
        existing.count += 1;
      } else {
        targetCounts.set(targetKey, {
          targetKey,
          targetType: safeText(event.target_type) || undefined,
          targetId: safeText(event.target_id) || undefined,
          targetOwnerUserId:
            safeText(event.target_owner_user_id) || undefined,
          count: 1,
        });
      }
    }

    reports.push({
      reportId,
      at,
      outcomeType: outcome,
      category: safeText(event.category) || undefined,
      targetKey: targetKey || undefined,
      isConfirmedViolation: isConfirmed,
      isDismissed,
      isMaliciousReport: isMalicious,
    });
  }

  const accuracyProgression =
    buildReporterAccuracyProgression(ledgerEvents);

  const repeatedTargetingPattern = [...targetCounts.values()]
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.count - a.count);

  return {
    lifetimeReports,
    confirmedReports,
    dismissedReports,
    maliciousReports,
    accuracyProgression,
    repeatedTargetingPattern,
    reports,
  };
}

export async function dbGetSafetyIntelligenceTimelines(input: {
  reporterUserId?: string;
  targetType?: string;
  targetId?: string;
  targetOwnerUserId?: string;
}): Promise<SafetyIntelligenceTimelines> {
  const [target, reporter] = await Promise.all([
    dbGetSafetyTargetIntelligenceTimeline({
      targetType: input.targetType,
      targetId: input.targetId,
      targetOwnerUserId: input.targetOwnerUserId,
    }),
    dbGetSafetyReporterIntelligenceTimeline({
      reporterUserId: input.reporterUserId,
    }),
  ]);
  return { target, reporter };
}

/** Prefer ledger timeline facts when they exist; never invent values. */
export function applyTimelinesToCaseIntelligenceRaw(
  raw: {
    reporterLifetimeReports: number;
    reporterConfirmedReports: number;
    reporterDismissedReports: number;
    reporterHasFalseReportingPenalty: boolean;
    targetConfirmedViolations: number;
    targetWarnings: number;
    targetRemovals: number;
    targetRestrictions: number;
    targetSuspensions: number;
    targetPermanentBans: number;
    targetReportsLast7d: number;
    targetReportsLast30d: number;
    targetReportsLast90d: number;
    targetDismissedReports: number;
    repeatedCategories: string[];
  },
  timelines: SafetyIntelligenceTimelines
) {
  const { target, reporter } = timelines;

  if (reporter.lifetimeReports > 0) {
    raw.reporterLifetimeReports = Math.max(
      raw.reporterLifetimeReports,
      reporter.lifetimeReports
    );
  }
  if (reporter.confirmedReports > 0) {
    raw.reporterConfirmedReports = Math.max(
      raw.reporterConfirmedReports,
      reporter.confirmedReports
    );
  }
  if (reporter.dismissedReports > 0) {
    raw.reporterDismissedReports = Math.max(
      raw.reporterDismissedReports,
      reporter.dismissedReports
    );
  }
  if (reporter.maliciousReports > 0) {
    raw.reporterHasFalseReportingPenalty = true;
  }

  if (target.confirmedViolations > 0) {
    raw.targetConfirmedViolations = Math.max(
      raw.targetConfirmedViolations,
      target.confirmedViolations
    );
  }
  if (target.previousWarnings > 0) {
    raw.targetWarnings = Math.max(
      raw.targetWarnings,
      target.previousWarnings
    );
  }
  if (target.previousRemovals > 0) {
    raw.targetRemovals = Math.max(
      raw.targetRemovals,
      target.previousRemovals
    );
  }
  if (target.previousRestrictions > 0) {
    raw.targetRestrictions = Math.max(
      raw.targetRestrictions,
      target.previousRestrictions
    );
  }
  if (target.previousSuspensions > 0) {
    raw.targetSuspensions = Math.max(
      raw.targetSuspensions,
      target.previousSuspensions
    );
  }
  if (target.previousPermanentBans > 0) {
    raw.targetPermanentBans = Math.max(
      raw.targetPermanentBans,
      target.previousPermanentBans
    );
  }
  if (target.noViolationDismissals > 0) {
    raw.targetDismissedReports = Math.max(
      raw.targetDismissedReports,
      target.noViolationDismissals
    );
  }
  if (target.trend.lifetime > 0) {
    raw.targetReportsLast7d = Math.max(
      raw.targetReportsLast7d,
      target.trend.reports7d
    );
    raw.targetReportsLast30d = Math.max(
      raw.targetReportsLast30d,
      target.trend.reports30d
    );
    raw.targetReportsLast90d = Math.max(
      raw.targetReportsLast90d,
      target.trend.reports90d
    );
  }
  if (target.repeatedCategories.length) {
    raw.repeatedCategories = Array.from(
      new Set([
        ...(raw.repeatedCategories || []),
        ...target.repeatedCategories,
      ])
    );
  }

  return raw;
}
