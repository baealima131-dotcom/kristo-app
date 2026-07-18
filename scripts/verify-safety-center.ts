/**
 * Safety Center production-hardening verification harness.
 * Run: node --experimental-strip-types --test scripts/verify-safety-center.ts
 *
 * Does NOT add Appeals or notification features.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function assertIncludes(haystack: string, needle: string, label: string) {
  assert.ok(
    haystack.includes(needle),
    `${label}: missing required pattern:\n  ${needle}`
  );
}

function assertNotIncludes(haystack: string, needle: string, label: string) {
  assert.ok(
    !haystack.includes(needle),
    `${label}: forbidden pattern still present:\n  ${needle}`
  );
}

describe("1. Decision concurrency + atomic commit", () => {
  const decisionDb = read("app/api/_lib/store/safetyReportDb.ts");
  const route = read(
    "app/api/safety/supervisor/reports/[reportId]/route.ts"
  );

  it("claims decision with status guard (no double final decision)", () => {
    assertIncludes(
      decisionDb,
      "AND status NOT IN (\n            'resolved',\n            'dismissed'\n          )",
      "decision claim"
    );
    assertIncludes(
      decisionDb,
      "This case already has a final decision.",
      "conflict message"
    );
  });

  it("maps concurrent conflict to HTTP 409", () => {
    assertIncludes(route, "conflict", "conflict variable");
    assertIncludes(route, "? 409", "409 ternary");
    assertIncludes(
      route,
      "already has a final decision",
      "conflict detection"
    );
  });

  it("writes decision + enforcement + audit event in one CTE", () => {
    assertIncludes(decisionDb, "WITH updated AS (", "atomic CTE");
    assertIncludes(decisionDb, "inserted_enf AS (", "enforcement in CTE");
    assertIncludes(decisionDb, "inserted_evt AS (", "audit event in CTE");
    assertIncludes(
      decisionDb,
      "FROM updated\n      RETURNING id",
      "event only if decision updated"
    );
  });

  it("covers required decision types in SafetyReportDecisionType", () => {
    for (const type of [
      "no_violation",
      "warning",
      "remove_content",
      "restrict_account",
      "suspend_account",
      "permanent_ban",
    ]) {
      assertIncludes(decisionDb, `| "${type}"`, `decision type ${type}`);
    }
  });
});

describe("2. Authentication enforcement", () => {
  const rbac = read("app/api/_lib/rbac.ts");
  const login = read("app/api/auth/_lib/loginHandler.ts");
  const verify = read("app/api/auth/login/verify/route.ts");

  it("guard() applies the same Safety enforcement gate as guardAuth()", () => {
    assertIncludes(rbac, "async function assertSafetyEnforcementAllows", "shared gate");
    assertIncludes(rbac, "export async function guard(", "guard export");
    const guardBody = rbac.slice(rbac.indexOf("export async function guard("));
    assertIncludes(guardBody, "assertSafetyEnforcementAllows", "guard calls gate");
    assertIncludes(rbac, "export async function guardAuth(", "guardAuth export");
    const authBody = rbac.slice(
      rbac.indexOf("export async function guardAuth("),
      rbac.indexOf("export async function guard(")
    );
    assertIncludes(authBody, "assertSafetyEnforcementAllows", "guardAuth calls gate");
  });

  it("permanent ban and suspend block all methods; restrict blocks writes only", () => {
    assertIncludes(rbac, "SAFETY_PERMANENT_BAN", "ban code");
    assertIncludes(rbac, "SAFETY_ACCOUNT_SUSPENDED", "suspend code");
    assertIncludes(rbac, "SAFETY_ACCOUNT_RESTRICTED", "restrict code");
    assertIncludes(
      rbac,
      'normalizedMethod !== "GET" &&\n    normalizedMethod !== "HEAD" &&\n    normalizedMethod !== "OPTIONS"',
      "write detection"
    );
    assertIncludes(
      rbac,
      "writeRequest && enforcement.restriction",
      "restrict write-only"
    );
  });

  it("login password and OTP verify refuse ban/suspend before token issue", () => {
    assertIncludes(login, "assertSafetyAllowsAuthentication", "login gate");
    assertIncludes(verify, "assertSafetyAllowsAuthentication", "verify gate");
    assertIncludes(
      rbac,
      "Block sign-in / token issue for banned or suspended accounts only",
      "auth allows restrict login"
    );
  });

  it("expiry is applied lazily on enforcement lookup", () => {
    const decisionDb = read("app/api/_lib/store/safetyReportDb.ts");
    assertIncludes(
      decisionDb,
      "expires_at <= NOW()",
      "expiry cleanup"
    );
    assertIncludes(
      decisionDb,
      "status = 'expired'",
      "stale → expired"
    );
  });
});

describe("3. Content removal", () => {
  const route = read(
    "app/api/safety/supervisor/reports/[reportId]/route.ts"
  );
  const feedDb = read("app/api/_lib/store/feedDb.ts");
  const comments = read("app/api/_lib/store/feedCommentDb.ts");

  it("deletes content before recording the decision", () => {
    const removeIdx = route.indexOf('decisionType ===\n        "remove_content"');
    const deleteIdx = route.indexOf("deleteFeedItemById", removeIdx);
    const decisionIdx = route.indexOf("dbIssueSafetyReportDecision", removeIdx);
    assert.ok(removeIdx >= 0, "remove_content branch exists");
    assert.ok(deleteIdx > removeIdx, "delete exists in remove branch");
    assert.ok(
      deleteIdx < decisionIdx,
      "deleteFeedItemById must run before dbIssueSafetyReportDecision"
    );
  });

  it("returns 409 for unsupported targets without issuing a decision", () => {
    assertIncludes(
      route,
      "Remove Content currently supports feed posts, images and videos only.",
      "unsupported 409 copy"
    );
    const unsupportedBlock = route.slice(
      route.indexOf("Remove Content currently supports"),
      route.indexOf("Remove Content currently supports") + 400
    );
    assertIncludes(unsupportedBlock, "status: 409", "409 status");
  });

  it("returns 409 when content already gone (no false success)", () => {
    assertIncludes(
      route,
      "The original content is already unavailable.",
      "already gone"
    );
    assertIncludes(
      route,
      "No decision was recorded.",
      "failed delete without decision"
    );
  });

  it("deleteFeedItemById returns false when no row deleted (Postgres)", () => {
    assertIncludes(feedDb, "RETURNING id", "delete returning");
    assertIncludes(feedDb, "return rows.length > 0", "truthful delete result");
    assertNotIncludes(
      feedDb,
      "await sql`DELETE FROM kristo_church_feed WHERE id = ${feedId}`;\n    return true;",
      "old always-true delete"
    );
  });

  it("engagement cleanup removes comments, comment likes, and post likes", () => {
    assertIncludes(
      comments,
      "DELETE FROM kristo_church_feed_comment_likes",
      "comment likes"
    );
    assertIncludes(
      comments,
      "DELETE FROM kristo_church_feed_comments WHERE post_id",
      "comments"
    );
    assertIncludes(
      comments,
      "DELETE FROM kristo_church_feed_post_likes WHERE post_id",
      "post likes"
    );
  });
});

describe("4. Identity integrity", () => {
  const feedReport = read("app/api/church/feed/report/route.ts");

  it("uses session reporter identity only", () => {
    assertIncludes(
      feedReport,
      "Identity is session-only — never trust client-supplied reporter IDs.",
      "session-only comment"
    );
    assertIncludes(
      feedReport,
      "const reporterUserId = String(ctxOrRes.viewer.userId || \"\").trim();",
      "session reporter"
    );
    assertNotIncludes(
      feedReport,
      "body?.reporterUserId || ctxOrRes.viewer.userId",
      "client reporter spoof path"
    );
  });

  it("resolves owner from canonical feed/comment records", () => {
    assertIncludes(feedReport, "getFeedItemById", "feed canonical");
    assertIncludes(feedReport, "findFeedCommentById", "comment canonical");
    assertIncludes(feedReport, "trustedOwnerUserId", "trusted owner");
    assertIncludes(
      feedReport,
      "Client-supplied owner IDs are ignored for authority.",
      "ignore client owner"
    );
  });
});

describe("5. Case Intelligence Engine — real-data gates only", () => {
  const decisionDb = read("app/api/_lib/store/safetyReportDb.ts");
  const route = read(
    "app/api/safety/supervisor/reports/[reportId]/route.ts"
  );
  const mobile = read(
    "apps/mobile/app/(tabs)/more/safety-supervisor/reports/[reportId].tsx"
  );
  const engine = read("app/api/_lib/safetyCaseIntelligenceEngine.ts");

  function baseRaw(overrides: Record<string, unknown> = {}) {
    return {
      reportId: "rep_test",
      category: "harassment",
      reason: "harassment",
      description: "Repeated hostile comments",
      priority: "high",
      targetType: "account",
      targetId: "user_target",
      targetOwnerUserId: "user_target",
      reporterUserId: "user_reporter",
      originalContentAvailable: true,
      hasThumbnail: true,
      hasPreview: true,
      hasTitle: true,
      hasMediaUri: false,
      mediaType: "text",
      createdAt: new Date().toISOString(),
      evidenceMachineVerified: false,
      evidenceAttachmentCount: 1,
      reporterLifetimeReports: 1,
      reporterConfirmedReports: 0,
      reporterDismissedReports: 0,
      reporterDuplicateOnThisTarget: 0,
      reporterReportsOnThisTarget: 1,
      reporterHasFalseReportingPenalty: false,
      targetTotalReports: 2,
      targetUniqueReporters: 2,
      targetActiveReports: 2,
      targetResolvedReports: 0,
      targetDismissedReports: 0,
      targetEscalatedReports: 0,
      targetConfirmedViolations: 0,
      targetWarnings: 0,
      targetRemovals: 0,
      targetRestrictions: 0,
      targetSuspensions: 0,
      targetPermanentBans: 0,
      targetReportsLast7d: 2,
      targetReportsLast30d: 2,
      targetReportsLast90d: 2,
      targetUniqueReportersLast24h: 2,
      targetUniqueReportersLast7d: 2,
      repeatedCategories: [] as string[],
      ...overrides,
    };
  }

  it("wires db loader + FACTS/RESULT diagnostics", () => {
    assertIncludes(
      decisionDb,
      "export async function dbGetSafetyCaseIntelligence",
      "db loader"
    );
    assertIncludes(
      decisionDb,
      "KRISTO_SAFETY_CASE_INTELLIGENCE_FACTS",
      "facts log"
    );
    assertIncludes(
      decisionDb,
      "KRISTO_SAFETY_CASE_INTELLIGENCE_RESULT",
      "result log"
    );
    assertIncludes(
      decisionDb,
      "KRISTO_CASE_DB_FUNCTION_ENTERED",
      "db enter forensic"
    );
    assertIncludes(
      decisionDb,
      "KRISTO_CASE_DB_FUNCTION_EXIT",
      "db exit forensic"
    );
    assertIncludes(
      route,
      "KRISTO_CASE_BEFORE_INTELLIGENCE_CALL",
      "route before call"
    );
    assertIncludes(
      route,
      "KRISTO_CASE_AFTER_INTELLIGENCE_CALL",
      "route after call"
    );
    assertIncludes(route, "dbGetSafetyCaseIntelligence", "route import/use");
    assertIncludes(engine, 'recommendation: "human_review"', "human_review");
    assertIncludes(engine, "credibilityScore: number | null", "nullable cred");
    assertNotIncludes(engine, "let score = 55;", "no baseline 55");
    assertNotIncludes(engine, "score = 52;", "no baseline 52");
    assertNotIncludes(engine, "score = 50;", "no baseline 50");
    assertNotIncludes(engine, "score = 58;", "no baseline 58");
  });

  it("new reporter with no finalized history → credibility null", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(baseRaw());
    assert.equal(result.reporter.credibilityScore, null);
    assert.equal(result.reporter.accuracyPercent, null);
    assert.equal(result.reporter.credibilityLevel, "unknown");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.assessment.recommendation, "human_review");
  });

  it("target with reports but zero confirmed violations → risk null", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(
      baseRaw({
        reporterConfirmedReports: 3,
        reporterDismissedReports: 1,
        reporterLifetimeReports: 6,
        targetTotalReports: 8,
        targetUniqueReporters: 4,
        targetConfirmedViolations: 0,
      })
    );
    assert.equal(result.target.riskScore, null);
    assert.equal(result.target.confirmedViolations, 0);
    assert.equal(result.target.trend, "insufficient_data");
    assert.equal(result.assessment.caseRiskScore, null);
  });

  it("original content alone → evidence null/not verified", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(
      baseRaw({
        originalContentAvailable: true,
        hasThumbnail: true,
        hasPreview: true,
        hasMediaUri: true,
        mediaType: "video",
        evidenceMachineVerified: false,
      })
    );
    assert.equal(result.evidence.strengthScore, null);
    assert.equal(result.dataQuality.evidenceVerified, false);
    assert.ok(
      result.evidence.limitations.includes(
        "evidence_quality_not_machine_verified"
      )
    );
  });

  it("incomplete inputs → status insufficient_data", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(baseRaw());
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.assessment.confidence, null);
    assert.equal(result.assessment.caseRiskScore, null);
    assert.equal(result.assessment.recommendation, "human_review");
  });

  it("no default numeric baselines for thin history", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(baseRaw());
    assert.notEqual(result.reporter.credibilityScore, 52);
    assert.notEqual(result.target.riskScore, 12);
    assert.notEqual(result.evidence.strengthScore, 79);
    assert.notEqual(result.assessment.caseRiskScore, 31);
    assert.notEqual(result.assessment.confidence, 68);
  });

  it("open reports do not count as confirmed", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(
      baseRaw({
        targetTotalReports: 10,
        targetActiveReports: 10,
        targetConfirmedViolations: 0,
        targetResolvedReports: 0,
      })
    );
    assert.equal(result.target.confirmedViolations, 0);
    assert.equal(result.target.riskScore, null);
  });

  it("dismissed reports reduce credibility only after finalized denominator exists", async () => {
    const { computeReporterCredibility } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const thin = computeReporterCredibility({
      lifetimeReports: 1,
      confirmedReports: 0,
      dismissedReports: 0,
      duplicateOnThisTarget: 0,
      reportsOnThisTarget: 1,
      hasFalseReportingPenalty: false,
    });
    assert.equal(thin.credibilityScore, null);

    const finalized = computeReporterCredibility({
      lifetimeReports: 10,
      confirmedReports: 2,
      dismissedReports: 8,
      duplicateOnThisTarget: 0,
      reportsOnThisTarget: 1,
      hasFalseReportingPenalty: false,
    });
    assert.ok(finalized.credibilityScore != null);
    assert.ok((finalized.accuracyPercent as number) < 50);
    assert.ok((finalized.credibilityScore as number) < 50);
  });

  it("recommendation requires minimum data gates", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const gated = computeSafetyCaseIntelligence(
      baseRaw({
        reporterConfirmedReports: 8,
        reporterDismissedReports: 2,
        reporterLifetimeReports: 12,
        targetConfirmedViolations: 3,
        targetWarnings: 1,
        evidenceMachineVerified: false,
      })
    );
    assert.equal(gated.status, "insufficient_data");
    assert.equal(gated.assessment.recommendation, "human_review");
  });

  it("permanent ban cannot come from volume", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const volumeOnly = computeSafetyCaseIntelligence(
      baseRaw({
        targetTotalReports: 40,
        targetUniqueReporters: 1,
        targetConfirmedViolations: 0,
        targetReportsLast7d: 20,
        reporterConfirmedReports: 0,
        reporterDismissedReports: 0,
      })
    );
    assert.notEqual(volumeOnly.assessment.recommendation, "permanent_ban");
    assert.equal(volumeOnly.assessment.recommendation, "human_review");
  });

  it("real historical fixture produces deterministic score", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const fixture = {
      reporterLifetimeReports: 20,
      reporterConfirmedReports: 16,
      reporterDismissedReports: 2,
      targetConfirmedViolations: 4,
      targetWarnings: 2,
      targetRestrictions: 1,
      targetSuspensions: 1,
      targetTotalReports: 12,
      targetUniqueReporters: 5,
      targetReportsLast7d: 4,
      targetReportsLast30d: 8,
      repeatedCategories: ["harassment"],
      evidenceMachineVerified: true,
      originalContentAvailable: true,
      hasThumbnail: true,
      hasPreview: true,
      hasMediaUri: true,
      mediaType: "video",
      evidenceAttachmentCount: 3,
    };
    const a = computeSafetyCaseIntelligence(baseRaw(fixture));
    const b = computeSafetyCaseIntelligence(baseRaw(fixture));
    assert.equal(a.status, "ready");
    assert.equal(a.assessment.caseRiskScore, b.assessment.caseRiskScore);
    assert.equal(a.assessment.confidence, b.assessment.confidence);
    assert.equal(a.assessment.recommendation, b.assessment.recommendation);
    assert.ok(a.reporter.credibilityScore != null);
    assert.ok(a.target.riskScore != null);
    assert.ok(a.evidence.strengthScore != null);
    assert.ok(a.assessment.confidence != null);
    assert.notEqual(a.assessment.recommendation, "human_review");
  });

  it("mobile CASE INTELLIGENCE UI keeps insufficient/error honesty", () => {
    assertIncludes(mobile, "CASE INTELLIGENCE", "section title");
    assertIncludes(mobile, "INSUFFICIENT DATA", "insufficient state");
    assertIncludes(mobile, "HUMAN REVIEW", "human review action");
    assertIncludes(mobile, "ACTIVE REPORTS", "active reports statistic");
    assertIncludes(mobile, "UNIQUE REPORTERS", "unique reporters statistic");
    assertIncludes(
      mobile,
      "No verified evidence analysis",
      "no verified evidence"
    );
    assertIncludes(mobile, "ANALYSIS UNAVAILABLE", "error state");
    assertNotIncludes(mobile, "AI analyzed video", "no fabricated video");
    assertNotIncludes(mobile, "aiWeightedReportScore", "no legacy weighted score");
    assertNotIncludes(mobile, "aiWeightedReportPercent", "no legacy percent");
    assertNotIncludes(mobile, "reporterVoteWeightPercent", "no legacy vote weight");
    assertNotIncludes(mobile, "aiActionThreshold", "no legacy threshold");
    assertNotIncludes(mobile, "aiActionRequired", "no legacy action flag");
    assertNotIncludes(mobile, "legacySignals", "UI ignores legacySignals");
    assertNotIncludes(mobile, "AI confidence", "no hero AI confidence");
  });

  it("report detail nests legacy AI fields under legacySignals only", () => {
    assertIncludes(route, "legacySignals:", "legacySignals nest");
    assertIncludes(
      route,
      "aiWeightedReportScore: safeWeightedScore",
      "legacy weighted score nested"
    );
    assertIncludes(
      route,
      "reporterVoteWeightPercent:",
      "legacy vote weight nested"
    );
    assertIncludes(route, "hasLegacySignals:", "hydrated log notes legacy nest");
    // Must not re-export legacy fields at the hydrated root.
    assertNotIncludes(
      route,
      "aiWeightedReportScore: safeWeightedScore,\n    aiWeightedReportPercent",
      "legacy fields stay inside legacySignals object"
    );
    // Confirm the nesting pattern: legacySignals { ... aiWeighted... }
    const nestedBlock = route.includes(
      "legacySignals: {\n      aiIntelligenceAvailable:"
    );
    assert.equal(nestedBlock, true, "legacySignals opens before AI fields");
  });

  it("recommendation boundaries include human_review", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const allowed = new Set([
      "human_review",
      "no_violation",
      "monitor",
      "warning",
      "remove_content",
      "restrict_account",
      "suspend_account",
      "permanent_ban",
      "escalate",
    ]);
    const samples = [
      baseRaw({}),
      baseRaw({
        evidenceMachineVerified: true,
        reporterConfirmedReports: 10,
        reporterDismissedReports: 1,
        reporterLifetimeReports: 12,
        targetConfirmedViolations: 5,
        targetSuspensions: 2,
        targetWarnings: 3,
        targetUniqueReporters: 6,
        hasMediaUri: true,
        mediaType: "video",
      }),
    ];
    for (const sample of samples) {
      const result = computeSafetyCaseIntelligence(sample as any);
      assert.ok(
        allowed.has(result.assessment.recommendation),
        `unexpected ${result.assessment.recommendation}`
      );
      assert.equal(result.assessment.requiresHumanReview, true);
    }
  });

  it("wires Safety Intelligence ledger + timelines into Case Intelligence", () => {
    const historyDb = read(
      "app/api/_lib/store/safetyIntelligenceHistoryDb.ts"
    );
    const historyPure = read(
      "app/api/_lib/safetyIntelligenceHistory.ts"
    );
    assertIncludes(
      historyPure,
      "isFinalizedLearningDecisionType",
      "pure helpers module"
    );
    assertIncludes(
      historyDb,
      "kristo_safety_intelligence_events",
      "ledger table"
    );
    assertIncludes(
      historyDb,
      "idx_safety_intel_events_report_kind_outcome",
      "unique ledger constraint"
    );
    assertIncludes(
      historyDb,
      "ON CONFLICT (report_id, event_kind, outcome_type)",
      "conflict-safe insert"
    );
    assertIncludes(
      historyDb,
      "kristo_safety_intelligence_meta",
      "versioned backfill meta"
    );
    assertIncludes(
      historyDb,
      "SAFETY_INTEL_BACKFILL_META_KEY",
      "backfill version key"
    );
    assertIncludes(
      historyDb,
      "SAFETY_INTEL_BACKFILL_BATCH_SIZE",
      "batched backfill"
    );
    assertIncludes(
      historyDb,
      "ensureSafetyIntelligenceEventsSchema",
      "schema ensure"
    );
    assertIncludes(
      historyDb,
      "dbBackfillSafetyIntelligenceEvents",
      "backfill"
    );
    assertIncludes(
      historyDb,
      "dbGetSafetyTargetIntelligenceTimeline",
      "target timeline"
    );
    assertIncludes(
      historyDb,
      "dbGetSafetyReporterIntelligenceTimeline",
      "reporter timeline"
    );
    assertIncludes(
      historyDb,
      "summarizeTargetFinalizedOutcomes",
      "target finalized-only summary"
    );
    assertIncludes(
      historyDb,
      "buildReporterAccuracyProgression",
      "reporter accuracy helper"
    );
    assertIncludes(
      historyPure,
      "appeal_upheld",
      "appeal outcome reserved"
    );
    assertNotIncludes(
      historyDb,
      "dbRecordAppeal",
      "no appeals feature writer"
    );
    assertIncludes(
      decisionDb,
      "dbRecordSafetyIntelligenceFromDecision",
      "decision write records ledger"
    );
    assertIncludes(
      decisionDb,
      "KRISTO_SAFETY_INTEL_EVENT_WRITE_FAILED",
      "ledger failure is logged"
    );
    assertIncludes(
      decisionDb,
      "Failures must not roll back the decision commit",
      "ledger failure isolated"
    );
    assertIncludes(
      decisionDb,
      "WITH updated AS (",
      "atomic decision CTE unchanged"
    );
    assertIncludes(
      decisionDb,
      "dbGetSafetyIntelligenceTimelines",
      "CI loads timelines"
    );
    assertIncludes(
      decisionDb,
      "applyTimelinesToCaseIntelligenceRaw",
      "CI applies timeline facts"
    );
    assertIncludes(engine, "timelines", "engine exposes timelines");
    assertIncludes(
      engine,
      "timelineReasoning",
      "explainable timeline reasoning"
    );
    assertNotIncludes(
      mobile,
      "Safety Intelligence Timeline",
      "UI does not render timeline section"
    );
    assertNotIncludes(
      mobile,
      "accuracyProgression",
      "UI does not render accuracy progression"
    );
  });

  it("ledger helpers classify finalized outcomes without guessing malice", async () => {
    const {
      isFinalizedLearningDecisionType,
      isMaliciousReportSignal,
      isConfirmedViolationOutcome,
    } = await import(
      "../app/api/_lib/safetyIntelligenceHistory.ts"
    );
    for (const type of [
      "warning",
      "remove_content",
      "restrict_account",
      "suspend_account",
      "permanent_ban",
      "no_violation",
    ]) {
      assert.equal(isFinalizedLearningDecisionType(type), true, type);
    }
    assert.equal(isFinalizedLearningDecisionType("escalate"), false);
    assert.equal(isConfirmedViolationOutcome("warning"), true);
    assert.equal(isConfirmedViolationOutcome("no_violation"), false);
    assert.equal(
      isMaliciousReportSignal("No policy breach found"),
      false
    );
    assert.equal(
      isMaliciousReportSignal("This was a false report"),
      true
    );
  });

  it("engine attaches timelines and stays insufficient without gates", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(
      baseRaw({
        timelines: {
          target: {
            firstReportAt: "2026-01-01T00:00:00.000Z",
            lastReportAt: "2026-07-01T00:00:00.000Z",
            previousWarnings: 0,
            previousSuspensions: 0,
            previousRestrictions: 0,
            previousRemovals: 0,
            previousPermanentBans: 0,
            confirmedViolations: 0,
            noViolationDismissals: 0,
            repeatedCategories: [],
            trend: {
              reports7d: 2,
              reports30d: 2,
              reports90d: 2,
              lifetime: 2,
              direction: "insufficient_data",
            },
            enforcementHistory: [],
          },
          reporter: {
            lifetimeReports: 2,
            confirmedReports: 0,
            dismissedReports: 0,
            maliciousReports: 0,
            accuracyProgression: [],
            repeatedTargetingPattern: [],
            reports: [],
          },
        },
      }) as any
    );
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.assessment.recommendation, "human_review");
    assert.equal(result.assessment.caseRiskScore, null);
    assert.equal(result.assessment.confidence, null);
    assert.equal(result.assessment.requiresHumanReview, true);
    assert.ok(result.timelines);
    assert.equal(
      result.timelines?.target.firstReportAt,
      "2026-01-01T00:00:00.000Z"
    );
    assert.ok(
      result.assessment.reasoning.some((line) =>
        line.includes("Target first report")
      )
    );
  });

  it("repeated decision / backfill / live collision stay one ledger event", async () => {
    const {
      tryInsertLedgerDedupeKey,
      isFinalizedLearningDecisionType,
    } = await import("../app/api/_lib/safetyIntelligenceHistory.ts");

    const store = new Set<string>();
    const first = tryInsertLedgerDedupeKey(
      store,
      "rep_1",
      "decision",
      "warning"
    );
    const retry = tryInsertLedgerDedupeKey(
      store,
      "rep_1",
      "decision",
      "warning"
    );
    const recovery = tryInsertLedgerDedupeKey(
      store,
      "rep_1",
      "decision",
      "warning"
    );
    const backfillCollision = tryInsertLedgerDedupeKey(
      store,
      "rep_1",
      "decision",
      "warning"
    );
    const concurrent = tryInsertLedgerDedupeKey(
      store,
      "rep_1",
      "decision",
      "warning"
    );

    assert.equal(first.inserted, true);
    assert.equal(retry.inserted, false);
    assert.equal(recovery.inserted, false);
    assert.equal(backfillCollision.inserted, false);
    assert.equal(concurrent.inserted, false);
    assert.equal(store.size, 1);

    assert.equal(isFinalizedLearningDecisionType("escalate"), false);
    const escalate = tryInsertLedgerDedupeKey(
      store,
      "rep_2",
      "decision",
      "escalate"
    );
    // escalate may insert into the in-memory set, but production skips
    // via isFinalizedLearningDecisionType before write.
    assert.equal(isFinalizedLearningDecisionType("escalate"), false);
    assert.ok(escalate.key.includes("escalate"));
  });

  it("backfill twice remains idempotent at the dedupe layer", async () => {
    const { tryInsertLedgerDedupeKey } = await import(
      "../app/api/_lib/safetyIntelligenceHistory.ts"
    );
    const store = new Set<string>();
    const batchA = ["r1", "r2", "r3"].map((id) =>
      tryInsertLedgerDedupeKey(store, id, "decision", "no_violation")
    );
    const batchB = ["r1", "r2", "r3"].map((id) =>
      tryInsertLedgerDedupeKey(store, id, "decision", "no_violation")
    );
    assert.equal(batchA.filter((x) => x.inserted).length, 3);
    assert.equal(batchB.filter((x) => x.inserted).length, 0);
    assert.equal(store.size, 3);
  });

  it("ledger failure does not undo successful enforcement/decision", async () => {
    const { decisionSurvivesLedgerFailure } = await import(
      "../app/api/_lib/safetyIntelligenceHistory.ts"
    );
    assert.equal(decisionSurvivesLedgerFailure(true, false), true);
    assert.equal(decisionSurvivesLedgerFailure(true, true), true);
    assert.equal(decisionSurvivesLedgerFailure(false, false), false);

    const decisionDbSrc = read("app/api/_lib/store/safetyReportDb.ts");
    const writeIdx = decisionDbSrc.indexOf(
      "dbRecordSafetyIntelligenceFromDecision"
    );
    const returnIdx = decisionDbSrc.indexOf(
      "return {\n    report,\n    enforcement: enforcementRecord,",
      writeIdx
    );
    assert.ok(writeIdx > 0, "ledger write present");
    assert.ok(returnIdx > writeIdx, "decision returns after ledger attempt");
    assert.ok(
      decisionDbSrc.includes("KRISTO_SAFETY_INTEL_EVENT_WRITE_FAILED"),
      "failure logged"
    );
  });

  it("target timeline uses finalized outcomes only", async () => {
    const { summarizeTargetFinalizedOutcomes } = await import(
      "../app/api/_lib/safetyIntelligenceHistory.ts"
    );
    const summary = summarizeTargetFinalizedOutcomes([
      {
        outcomeType: "warning",
        isConfirmedViolation: true,
        isDismissed: false,
        isMaliciousReport: false,
        reportId: "a",
        decisionAt: "2026-01-01T00:00:00.000Z",
      },
      {
        outcomeType: "suspend_account",
        isConfirmedViolation: true,
        isDismissed: false,
        isMaliciousReport: false,
        reportId: "b",
      },
      {
        outcomeType: "open",
        isConfirmedViolation: false,
        isDismissed: false,
        isMaliciousReport: false,
        isOpen: true,
        reportId: "open_1",
      },
      {
        outcomeType: "escalate",
        isConfirmedViolation: false,
        isDismissed: false,
        isMaliciousReport: false,
        reportId: "esc_1",
      },
    ]);
    assert.equal(summary.previousWarnings, 1);
    assert.equal(summary.previousSuspensions, 1);
    assert.equal(summary.confirmedViolations, 2);
    assert.equal(summary.enforcementHistory.length, 2);
    assert.equal(
      summary.enforcementHistory.some((e) => e.reportId === "open_1"),
      false
    );
  });

  it("reporter timeline excludes open reports from accuracy", async () => {
    const { buildReporterAccuracyProgression } = await import(
      "../app/api/_lib/safetyIntelligenceHistory.ts"
    );
    const progression = buildReporterAccuracyProgression([
      {
        outcomeType: "warning",
        isConfirmedViolation: true,
        isDismissed: false,
        isMaliciousReport: false,
        reportId: "fin_1",
        decisionAt: "2026-01-01T00:00:00.000Z",
      },
      {
        outcomeType: "pending",
        isConfirmedViolation: false,
        isDismissed: false,
        isMaliciousReport: false,
        isOpen: true,
        reportId: "open_1",
      },
      {
        outcomeType: "no_violation",
        isConfirmedViolation: false,
        isDismissed: true,
        isMaliciousReport: false,
        reportId: "fin_2",
        decisionAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    assert.equal(progression.length, 2);
    assert.equal(progression[0].reportId, "fin_1");
    assert.equal(progression[1].reportId, "fin_2");
    assert.equal(progression[1].runningConfirmed, 1);
    assert.equal(progression[1].runningDismissed, 1);
    assert.equal(
      progression.some((p) => p.reportId === "open_1"),
      false
    );
  });

  it("thin history remains insufficient_data with human_review", async () => {
    const { computeSafetyCaseIntelligence } = await import(
      "../app/api/_lib/safetyCaseIntelligenceEngine.ts"
    );
    const result = computeSafetyCaseIntelligence(baseRaw() as any);
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.assessment.recommendation, "human_review");
    assert.equal(result.assessment.caseRiskScore, null);
    assert.equal(result.assessment.confidence, null);
    assert.equal(result.reporter.credibilityScore, null);
    assert.equal(result.target.riskScore, null);
    assert.equal(result.evidence.strengthScore, null);
    assert.equal(result.assessment.requiresHumanReview, true);
  });
});

describe("6. Database integrity", () => {
  const decisionDb = read("app/api/_lib/store/safetyReportDb.ts");

  it("has unique active ban/suspend/restrict indexes + duplicate cleanup", () => {
    assertIncludes(
      decisionDb,
      "kristo_safety_enforcement_one_active_ban_idx",
      "ban unique"
    );
    assertIncludes(
      decisionDb,
      "kristo_safety_enforcement_one_active_suspend_idx",
      "suspend unique"
    );
    assertIncludes(
      decisionDb,
      "kristo_safety_enforcement_one_active_restrict_idx",
      "restrict unique"
    );
    assertIncludes(
      decisionDb,
      "newer.created_at > e.created_at",
      "duplicate cleanup keeps newest"
    );
  });

  it("warnings are not unique-constrained (multiple allowed)", () => {
    assertNotIncludes(
      decisionDb,
      "enforcement_type =\n        'warning'",
      "no unique warning index filter"
    );
    // unique indexes only mention ban/suspend/restrict
    const banIdx = decisionDb.indexOf(
      "kristo_safety_enforcement_one_active_ban_idx"
    );
    const warningUnique = decisionDb.includes(
      "one_active_warning"
    );
    assert.equal(warningUnique, false, "must not unique-constrain warnings");
    assert.ok(banIdx > 0);
  });

  it("queue/target/source indexes exist", () => {
    assertIncludes(decisionDb, "kristo_safety_reports_queue_idx", "queue idx");
    assertIncludes(decisionDb, "kristo_safety_reports_target_idx", "target idx");
    assertIncludes(decisionDb, "kristo_safety_reports_source_idx", "source idx");
  });
});

describe("7. Authorization matrix", () => {
  const decisionDb = read("app/api/_lib/store/safetyReportDb.ts");
  const route = read(
    "app/api/safety/supervisor/reports/[reportId]/route.ts"
  );
  const mobile = read(
    "apps/mobile/app/(tabs)/more/safety-supervisor/reports/[reportId].tsx"
  );

  it("agents cannot permanent ban; supervisors can", () => {
    assertIncludes(
      decisionDb,
      "Permanent bans require Supervisor approval.",
      "agent ban blocked in DB"
    );
    assertIncludes(mobile, "supervisorOnly", "UI supervisor-only flag");
    assertIncludes(mobile, "canIssueDecision", "supervisor decision center");
  });

  it("decision requires assigned agent or assigned supervisor", () => {
    assertIncludes(
      decisionDb,
      "This case is not assigned to your Safety Agent account.",
      "agent scope"
    );
    assertIncludes(
      decisionDb,
      "This case is not assigned to your Safety Supervisor account.",
      "supervisor scope"
    );
  });

  it("PATCH requires Safety role and loads case from actor dashboard only", () => {
    assertIncludes(route, "dbHasSafetyRole", "supervisor role check");
    assertIncludes(
      route,
      "dbHasActiveSafetyAgentRelationship",
      "agent relationship"
    );
    assertIncludes(
      route,
      "dbGetSafetySupervisorDashboard",
      "supervisor scoped dashboard"
    );
    assertIncludes(
      route,
      "dbGetSafetyAgentDashboard",
      "agent scoped dashboard"
    );
    assertIncludes(
      route,
      "This case is not available to your Safety account.",
      "out-of-scope 404"
    );
  });
});

describe("8. remove_content reconciliation", () => {
  const decisionDb = read("app/api/_lib/store/safetyReportDb.ts");
  const route = read(
    "app/api/safety/supervisor/reports/[reportId]/route.ts"
  );

  it("supports recovery_required / enforcement_pending statuses", () => {
    assertIncludes(decisionDb, '"recovery_required"', "recovery status type");
    assertIncludes(decisionDb, '"enforcement_pending"', "pending status type");
    assertIncludes(
      decisionDb,
      "kristo_safety_reconciliations",
      "reconciliation table"
    );
  });

  it("records reconciliation when decision fails after content deletion", () => {
    assertIncludes(
      route,
      "dbRecordRemoveContentReconciliation",
      "route records recon"
    );
    assertIncludes(route, "SAFETY_RECOVERY_REQUIRED", "recovery code");
    assertIncludes(
      route,
      "dbMarkSafetyReportEnforcementPending",
      "pending mark after delete"
    );
  });

  it("exposes idempotent recovery job helpers", () => {
    assertIncludes(
      decisionDb,
      "export async function dbRecoverRemoveContentDecision",
      "recover function"
    );
    assertIncludes(
      decisionDb,
      "export async function dbProcessPendingRemoveContentReconciliations",
      "batch processor"
    );
    assertIncludes(
      decisionDb,
      "without deleting content again",
      "no second delete"
    );
  });
});

describe("9. Outcome Learning metadata (Phase 2A)", () => {
  const historyDb = read(
    "app/api/_lib/store/safetyIntelligenceHistoryDb.ts"
  );
  const outcomeModule = read("app/api/_lib/safetyOutcomeLearning.ts");

  it("severity map is versioned, documented and deterministic", async () => {
    const {
      SAFETY_SEVERITY_MAP_VERSION,
      computeSeverityScore,
    } = await import("../app/api/_lib/safetyOutcomeLearning.ts");

    assert.equal(SAFETY_SEVERITY_MAP_VERSION, "v1");

    // Base decision severity + documented category modifier, clamped 0..100.
    assert.equal(computeSeverityScore("warning", "harassment"), 25);
    assert.equal(computeSeverityScore("suspend_account", "child_safety"), 95);
    assert.equal(computeSeverityScore("permanent_ban", "spam"), 95);
    assert.equal(computeSeverityScore("remove_content", "other"), 40);

    // no_violation is always 0 regardless of category (no harm attributable).
    assert.equal(computeSeverityScore("no_violation", "child_safety"), 0);

    // Deterministic across calls.
    assert.equal(
      computeSeverityScore("restrict_account", "violence"),
      computeSeverityScore("restrict_account", "violence")
    );
  });

  it("severity is null for non-finalized decisions (no synthetic score)", async () => {
    const { computeSeverityScore } = await import(
      "../app/api/_lib/safetyOutcomeLearning.ts"
    );
    assert.equal(computeSeverityScore("escalate", "harassment"), null);
    assert.equal(computeSeverityScore("open"), null);
    assert.equal(computeSeverityScore(""), null);
    assert.equal(computeSeverityScore(undefined), null);
  });

  it("resolutionMinutes derives from real timestamps only", async () => {
    const { computeResolutionMinutes } = await import(
      "../app/api/_lib/safetyOutcomeLearning.ts"
    );
    assert.equal(
      computeResolutionMinutes(
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T01:30:00.000Z"
      ),
      90
    );
    // Missing timestamp -> null.
    assert.equal(
      computeResolutionMinutes("2026-01-01T00:00:00.000Z", undefined),
      null
    );
    assert.equal(computeResolutionMinutes(null, null), null);
    // Clock skew (decision before creation) -> null, never negative.
    assert.equal(
      computeResolutionMinutes(
        "2026-01-01T02:00:00.000Z",
        "2026-01-01T01:00:00.000Z"
      ),
      null
    );
  });

  it("investigatorConfidence is human-only and clamped", async () => {
    const { normalizeInvestigatorConfidence } = await import(
      "../app/api/_lib/safetyOutcomeLearning.ts"
    );
    assert.equal(normalizeInvestigatorConfidence(undefined), null);
    assert.equal(normalizeInvestigatorConfidence(null), null);
    assert.equal(normalizeInvestigatorConfidence(""), null);
    assert.equal(normalizeInvestigatorConfidence("not-a-number"), null);
    assert.equal(normalizeInvestigatorConfidence(75), 75);
    assert.equal(normalizeInvestigatorConfidence(120), 100);
    assert.equal(normalizeInvestigatorConfidence(-5), 0);
  });

  it("evidence URL hash is deterministic, normalized, null-safe", async () => {
    const { computeEvidenceUrlHash } = await import(
      "../app/api/_lib/safetyOutcomeLearning.ts"
    );
    assert.equal(computeEvidenceUrlHash(""), null);
    assert.equal(computeEvidenceUrlHash(null), null);
    const a = computeEvidenceUrlHash("https://cdn.kristo.app/x.jpg");
    const b = computeEvidenceUrlHash("  HTTPS://CDN.KRISTO.APP/X.JPG  ");
    const c = computeEvidenceUrlHash("https://cdn.kristo.app/y.jpg");
    assert.ok(typeof a === "string" && a.length === 64);
    assert.equal(a, b); // trimmed + lowercased normalization
    assert.notEqual(a, c);
  });

  it("appeals + finalOutcomeWeight stay reserved/null in Phase 2A", async () => {
    const { computeOutcomeLearningMetadata } = await import(
      "../app/api/_lib/safetyOutcomeLearning.ts"
    );
    const meta = computeOutcomeLearningMetadata({
      decisionType: "warning",
      category: "harassment",
      createdAt: "2026-01-01T00:00:00.000Z",
      decisionAt: "2026-01-01T00:30:00.000Z",
      investigatorConfidence: 60,
      evidenceUrl: "https://cdn.kristo.app/x.jpg",
    });
    assert.equal(meta.severityScore, 25);
    assert.equal(meta.severityMapVersion, "v1");
    assert.equal(meta.resolutionMinutes, 30);
    assert.equal(meta.investigatorConfidence, 60);
    assert.equal(meta.appealFiled, false);
    assert.equal(meta.appealOutcome, null);
    assert.equal(meta.finalOutcomeWeight, null);
    assert.ok(typeof meta.evidenceUrlHash === "string");
  });

  it("thin/unset metadata degrades to null (no fabricated values)", async () => {
    const { computeOutcomeLearningMetadata } = await import(
      "../app/api/_lib/safetyOutcomeLearning.ts"
    );
    const meta = computeOutcomeLearningMetadata({
      decisionType: "escalate",
    });
    assert.equal(meta.severityScore, null);
    assert.equal(meta.resolutionMinutes, null);
    assert.equal(meta.investigatorConfidence, null);
    assert.equal(meta.evidenceUrlHash, null);
    assert.equal(meta.finalOutcomeWeight, null);
  });

  it("module has no DB / provider / capture imports", () => {
    assertNotIncludes(outcomeModule, "@neondatabase/serverless", "no neon");
    assertNotIncludes(outcomeModule, "getDatabaseUrl", "no db url");
    assertNotIncludes(outcomeModule, "evidenceMachineVerified = true", "no fake verify");
    assertNotIncludes(outcomeModule, "x-forwarded-for", "no ip capture");
    assertNotIncludes(outcomeModule, "deviceId", "no device capture");
  });

  it("ledger schema adds all outcome-learning columns", () => {
    for (const col of [
      "severity_score INTEGER",
      "severity_map_version TEXT",
      "resolution_minutes INTEGER",
      "investigator_confidence INTEGER",
      "appeal_filed BOOLEAN NOT NULL DEFAULT FALSE",
      "appeal_outcome TEXT",
      "final_outcome_weight NUMERIC",
      "evidence_url_hash TEXT",
    ]) {
      assertIncludes(historyDb, col, `column ${col}`);
    }
  });

  it("adds decider/category/evidence-hash indexes", () => {
    assertIncludes(
      historyDb,
      "idx_safety_intel_events_decider_decision",
      "decider index"
    );
    assertIncludes(
      historyDb,
      "idx_safety_intel_events_category_decision",
      "category index"
    );
    assertIncludes(
      historyDb,
      "idx_safety_intel_events_evidence_hash",
      "evidence hash index"
    );
  });

  it("live decision write enriches ledger with real metadata", () => {
    assertIncludes(
      historyDb,
      "computeOutcomeLearningMetadata",
      "live write computes metadata"
    );
    assertIncludes(historyDb, "severityScore: outcome.severityScore", "severity wired");
    assertIncludes(
      historyDb,
      "investigatorConfidence: outcome.investigatorConfidence",
      "confidence wired"
    );
  });

  it("v2 backfill is versioned, batched and idempotent (no full-scan per GET)", () => {
    assertIncludes(
      historyDb,
      "intelligence_events_backfill_v2",
      "v2 meta key value"
    );
    assertIncludes(
      historyDb,
      "SAFETY_INTEL_OUTCOME_BACKFILL_META_KEY",
      "v2 meta key const"
    );
    assertIncludes(
      historyDb,
      "export async function dbBackfillSafetyOutcomeLearning",
      "v2 backfill function"
    );
    assertIncludes(
      historyDb,
      "AND e.severity_map_version IS NULL",
      "idempotent enrichment guard"
    );
    assertIncludes(
      historyDb,
      "AND severity_map_version IS NULL",
      "per-row idempotency guard on update"
    );
    assertIncludes(
      historyDb,
      "SAFETY_INTEL_BACKFILL_BATCH_SIZE",
      "batched enrichment"
    );
    // Gated by process cache + meta so it does not rescan on every GET.
    assertIncludes(
      historyDb,
      "outcomeBackfillCompleteCached",
      "process-cache gate"
    );
  });
});
