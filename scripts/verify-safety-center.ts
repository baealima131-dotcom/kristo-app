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

describe("10. Supervisor Reliability facts (Phase 2A)", () => {
  const historyDb = read(
    "app/api/_lib/store/safetyIntelligenceHistoryDb.ts"
  );
  const reliabilityModule = read(
    "app/api/_lib/safetySupervisorReliability.ts"
  );

  function row(overrides: Record<string, unknown> = {}) {
    return {
      decidedByUserId: "sup_a",
      eventKind: "decision",
      outcomeType: "warning",
      decisionAt: "2026-01-01T00:00:00.000Z",
      resolutionMinutes: 30,
      reportId: "rep_" + Math.random().toString(36).slice(2),
      appealFiled: false,
      appealOutcome: null,
      ...overrides,
    };
  }

  it("supervisor with no finalized decisions → insufficient_data, all zero", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const r = computeSupervisorReliabilityFacts("sup_a", []);
    assert.equal(r.status, "insufficient_data");
    assert.equal(r.finalizedDecisionCount, 0);
    assert.equal(r.warningCount, 0);
    assert.equal(r.averageResolutionMinutes, null);
    assert.equal(r.reliabilityScore, null);
    assert.ok(r.limitations.includes("no_finalized_decisions_for_supervisor"));
  });

  it("finalized outcomes are counted correctly", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const r = computeSupervisorReliabilityFacts("sup_a", [
      row({ outcomeType: "warning" }),
      row({ outcomeType: "remove_content" }),
      row({ outcomeType: "restrict_account" }),
      row({ outcomeType: "suspend_account" }),
      row({ outcomeType: "permanent_ban" }),
      row({ outcomeType: "no_violation" }),
    ]);
    assert.equal(r.status, "ready");
    assert.equal(r.finalizedDecisionCount, 6);
    assert.equal(r.warningCount, 1);
    assert.equal(r.removalCount, 1);
    assert.equal(r.restrictionCount, 1);
    assert.equal(r.suspensionCount, 1);
    assert.equal(r.permanentBanCount, 1);
    assert.equal(r.noViolationCount, 1);
  });

  it("open / escalated / non-decision rows are excluded", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const r = computeSupervisorReliabilityFacts("sup_a", [
      row({ outcomeType: "warning" }),
      row({ outcomeType: "escalate" }),
      row({ outcomeType: "open" }),
      row({ eventKind: "enforcement", outcomeType: "warning" }),
    ]);
    assert.equal(r.finalizedDecisionCount, 1);
    assert.equal(r.warningCount, 1);
  });

  it("averageResolutionMinutes ignores null values only", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const r = computeSupervisorReliabilityFacts("sup_a", [
      row({ resolutionMinutes: 30 }),
      row({ resolutionMinutes: 90 }),
      row({ resolutionMinutes: null }),
    ]);
    assert.equal(r.finalizedDecisionCount, 3);
    assert.equal(r.averageResolutionMinutes, 60);
  });

  it("appeal + reversal facts remain zero without appeal events", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const r = computeSupervisorReliabilityFacts("sup_a", [
      row({ outcomeType: "warning" }),
      row({ outcomeType: "suspend_account" }),
    ]);
    assert.equal(r.appealCount, 0);
    assert.equal(r.reversedDecisionCount, 0);
  });

  it("reliabilityScore + FP/FN/agreement stay null (no synthetic baselines)", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const many = Array.from({ length: 40 }, () =>
      row({ outcomeType: "suspend_account", resolutionMinutes: 10 })
    );
    const r = computeSupervisorReliabilityFacts("sup_a", many);
    assert.equal(r.status, "ready");
    assert.equal(r.finalizedDecisionCount, 40);
    assert.equal(r.reliabilityScore, null);
    assert.equal(r.agreementCount, null);
    assert.equal(r.falsePositiveCount, null);
    assert.equal(r.falseNegativeCount, null);
    assert.ok(
      r.limitations.includes(
        "reliability_score_requires_appeal_or_reversal_ground_truth"
      )
    );
  });

  it("duplicate ledger rows cannot inflate facts", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const dup = {
      decidedByUserId: "sup_a",
      eventKind: "decision",
      outcomeType: "warning",
      decisionAt: "2026-01-01T00:00:00.000Z",
      resolutionMinutes: 30,
      reportId: "rep_same",
      appealFiled: false,
      appealOutcome: null,
    };
    const r = computeSupervisorReliabilityFacts("sup_a", [
      { ...dup },
      { ...dup },
      { ...dup },
    ]);
    assert.equal(r.finalizedDecisionCount, 1);
    assert.equal(r.warningCount, 1);
  });

  it("supervisor A data does not leak into supervisor B", async () => {
    const { computeSupervisorReliabilityFacts } = await import(
      "../app/api/_lib/safetySupervisorReliability.ts"
    );
    const rows = [
      row({ decidedByUserId: "sup_a", outcomeType: "warning" }),
      row({ decidedByUserId: "sup_a", outcomeType: "suspend_account" }),
      row({ decidedByUserId: "sup_b", outcomeType: "permanent_ban" }),
    ];
    const a = computeSupervisorReliabilityFacts("sup_a", rows);
    const b = computeSupervisorReliabilityFacts("sup_b", rows);
    assert.equal(a.finalizedDecisionCount, 2);
    assert.equal(a.permanentBanCount, 0);
    assert.equal(b.finalizedDecisionCount, 1);
    assert.equal(b.permanentBanCount, 1);
  });

  it("malformed / null decider IDs are excluded", async () => {
    const {
      computeSupervisorReliabilityFacts,
      emptySupervisorReliability,
    } = await import("../app/api/_lib/safetySupervisorReliability.ts");
    const r = computeSupervisorReliabilityFacts("sup_a", [
      row({ decidedByUserId: null, outcomeType: "warning" }),
      row({ decidedByUserId: "", outcomeType: "warning" }),
      row({ decidedByUserId: "   ", outcomeType: "warning" }),
      row({ decidedByUserId: "sup_a", outcomeType: "warning" }),
    ]);
    assert.equal(r.finalizedDecisionCount, 1);

    // Missing target id yields insufficient_data with a clear limitation.
    const none = emptySupervisorReliability("", ["missing_supervisor_identifier"]);
    assert.equal(none.status, "insufficient_data");
    assert.ok(none.limitations.includes("missing_supervisor_identifier"));
    const blank = computeSupervisorReliabilityFacts("", [
      row({ outcomeType: "warning" }),
    ]);
    assert.equal(blank.status, "insufficient_data");
    assert.ok(blank.limitations.includes("missing_supervisor_identifier"));
  });

  it("module has no DB / provider / capture imports", () => {
    assertNotIncludes(reliabilityModule, "@neondatabase/serverless", "no neon");
    assertNotIncludes(reliabilityModule, "getDatabaseUrl", "no db url");
    // Severity/volume must never feed a reliability score.
    assertNotIncludes(reliabilityModule, "safetyOutcomeLearning", "no severity import");
    assertNotIncludes(reliabilityModule, "computeSeverityScore", "severity not used");
  });

  it("store loader uses one indexed aggregation query (no N+1)", () => {
    assertIncludes(
      historyDb,
      "export async function dbGetSafetySupervisorReliability",
      "reliability loader"
    );
    assertIncludes(
      historyDb,
      "supervisorReliabilityFromAggregate",
      "loader uses shared contract builder"
    );
    // Single aggregation + DISTINCT ON dedupe mirroring the unique index.
    assertIncludes(historyDb, "DISTINCT ON (report_id, event_kind, outcome_type)", "dedupe subquery");
    assertIncludes(historyDb, "AVG(resolution_minutes) FILTER (", "avg ignores null");
    assertIncludes(historyDb, "WHERE decided_by_user_id = ${supervisorUserId}", "scoped by decider");
    // Reliability score is not computed in SQL either.
    assertNotIncludes(historyDb, "reliabilityScore =", "no sql reliability score");
  });
});

describe("11. Cross-Case Pattern Signals (Phase 2A)", () => {
  const historyDb = read(
    "app/api/_lib/store/safetyIntelligenceHistoryDb.ts"
  );
  const graphModule = read("app/api/_lib/safetyCrossCaseGraph.ts");

  function crow(overrides: Record<string, unknown> = {}) {
    return {
      reportId: "rep_" + Math.random().toString(36).slice(2),
      reporterUserId: "rep_user",
      targetOwnerUserId: "t1",
      targetId: "t1",
      category: "harassment",
      sourceType: "feed_post",
      targetType: "account",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "open",
      outcomeType: null,
      isConfirmedViolation: false,
      evidenceUrlHash: null,
      ...overrides,
    };
  }

  function find(signals: any[], type: string) {
    return signals.find((s) => s.type === type);
  }

  it("detects repeated_reporter_targeting and dedupes supporting ids", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1" }),
      crow({ reportId: "a", reporterUserId: "r1" }), // duplicate id
      crow({ reportId: "b", reporterUserId: "r1" }),
      crow({ reportId: "c", reporterUserId: "r1" }),
    ]);
    const s = find(signals, "repeated_reporter_targeting_signal");
    assert.ok(s, "signal present");
    assert.equal(s.confidence, null);
    assert.deepEqual([...s.supportingCaseIds].sort(), ["a", "b", "c"]);
    assert.equal(s.supportingCount, 3);
  });

  it("detects multi_reporter_target with unique reporters", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1" }),
      crow({ reportId: "b", reporterUserId: "r2" }),
      crow({ reportId: "c", reporterUserId: "r3" }),
    ]);
    const s = find(signals, "multi_reporter_target_signal");
    assert.ok(s);
    assert.equal(s.confidence, null);
  });

  it("detects recurring_category", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", category: "spam" }),
      crow({ reportId: "b", reporterUserId: "r2", category: "spam" }),
      crow({ reportId: "c", reporterUserId: "r3", category: "spam" }),
    ]);
    assert.ok(find(signals, "recurring_category_signal"));
  });

  it("open reports support burst but are NOT counted as confirmed", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", status: "open", createdAt: "2026-01-01T00:00:00.000Z" }),
      crow({ reportId: "b", reporterUserId: "r1", status: "open", createdAt: "2026-01-01T01:00:00.000Z" }),
      crow({ reportId: "c", reporterUserId: "r1", status: "open", createdAt: "2026-01-01T02:00:00.000Z" }),
    ]);
    assert.ok(find(signals, "report_burst_signal"), "burst from open reports");
    assert.equal(
      find(signals, "repeated_confirmed_violation_signal"),
      undefined,
      "no confirmed from open reports"
    );
  });

  it("detects repeated_confirmed_violation from finalized confirmed only", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", status: "resolved", isConfirmedViolation: true, outcomeType: "warning" }),
      crow({ reportId: "b", reporterUserId: "r2", status: "resolved", isConfirmedViolation: true, outcomeType: "suspend_account" }),
      crow({ reportId: "c", reporterUserId: "r3", status: "open" }),
    ]);
    const s = find(signals, "repeated_confirmed_violation_signal");
    assert.ok(s);
    assert.deepEqual([...s.supportingCaseIds].sort(), ["a", "b"]);
  });

  it("detects multi_surface_owner across distinct surfaces", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", sourceType: "feed_post" }),
      crow({ reportId: "b", reporterUserId: "r2", sourceType: "feed_comment" }),
    ]);
    assert.ok(find(signals, "multi_surface_owner_signal"));
  });

  it("detects duplicate_evidence_url across cases", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", evidenceUrlHash: "hashX" }),
      crow({ reportId: "b", reporterUserId: "r2", evidenceUrlHash: "hashX" }),
    ]);
    const s = find(signals, "duplicate_evidence_url_signal");
    assert.ok(s);
    assert.deepEqual([...s.supportingCaseIds].sort(), ["a", "b"]);
    assert.ok(
      s.limitations.includes("matches_identical_url_only_not_visual_similarity")
    );
  });

  it("coordinated_reporting_signal only emerges after facts converge", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    // 3 unique reporters within 24h -> coordinated.
    const converge = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", createdAt: "2026-01-01T00:00:00.000Z" }),
      crow({ reportId: "b", reporterUserId: "r2", createdAt: "2026-01-01T01:00:00.000Z" }),
      crow({ reportId: "c", reporterUserId: "r3", createdAt: "2026-01-01T02:00:00.000Z" }),
    ]);
    const s = find(converge, "coordinated_reporting_signal");
    assert.ok(s, "coordinated present when facts converge");
    assert.equal(s.confidence, null);
    assert.ok(
      s.limitations.includes(
        "coordinated_label_is_a_signal_not_confirmed_abuse"
      )
    );

    // Same 3 reports but ONE reporter -> burst, but NOT coordinated.
    const single = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", createdAt: "2026-01-01T00:00:00.000Z" }),
      crow({ reportId: "b", reporterUserId: "r1", createdAt: "2026-01-01T01:00:00.000Z" }),
      crow({ reportId: "c", reporterUserId: "r1", createdAt: "2026-01-01T02:00:00.000Z" }),
    ]);
    assert.equal(
      find(single, "coordinated_reporting_signal"),
      undefined,
      "no coordinated from a single reporter"
    );
  });

  it("all signals expose null confidence and are not accusations", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", status: "resolved", isConfirmedViolation: true, evidenceUrlHash: "h" }),
      crow({ reportId: "b", reporterUserId: "r2", status: "resolved", isConfirmedViolation: true, evidenceUrlHash: "h" }),
      crow({ reportId: "c", reporterUserId: "r3" }),
    ]);
    assert.ok(signals.length > 0);
    for (const s of signals) {
      assert.equal(s.confidence, null);
      assert.ok(
        s.limitations.includes("signal_is_not_proof_of_violation")
      );
    }
  });

  it("malformed rows (no target) are excluded", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      { reportId: "a", reporterUserId: "r1", category: "spam" },
      { reportId: "b", reporterUserId: "r2", category: "spam" },
      { reportId: "c", reporterUserId: "r3", category: "spam" },
    ] as any);
    assert.equal(signals.length, 0, "no target key => dropped");
  });

  it("target A data does not leak into target B", async () => {
    const { computeCrossCasePatternSignals } = await import(
      "../app/api/_lib/safetyCrossCaseGraph.ts"
    );
    const signals = computeCrossCasePatternSignals([
      crow({ reportId: "a", reporterUserId: "r1", targetOwnerUserId: "t1", targetId: "t1" }),
      crow({ reportId: "b", reporterUserId: "r1", targetOwnerUserId: "t1", targetId: "t1" }),
      crow({ reportId: "c", reporterUserId: "r1", targetOwnerUserId: "t1", targetId: "t1" }),
      crow({ reportId: "z", reporterUserId: "r1", targetOwnerUserId: "t2", targetId: "t2" }),
    ]);
    const s = find(signals, "repeated_reporter_targeting_signal");
    assert.ok(s);
    assert.equal(s.supportingCaseIds.includes("z"), false, "t2 not in t1 signal");
    assert.equal(s.supportingCount, 3);
  });

  it("uses versioned named thresholds", async () => {
    const graph = await import("../app/api/_lib/safetyCrossCaseGraph.ts");
    assert.equal(graph.SAFETY_CROSS_CASE_SIGNALS_VERSION, "v1");
    assert.equal(graph.SAFETY_REPORT_BURST_WINDOW_HOURS, 24);
    assert.equal(graph.SAFETY_REPORT_BURST_MIN_REPORTS, 3);
    assertIncludes(graphModule, "SAFETY_REPORT_BURST_WINDOW_HOURS = 24", "burst window const");
    assertIncludes(graphModule, "SAFETY_REPORT_BURST_MIN_REPORTS = 3", "burst min const");
    // No prohibited signals.
    assertNotIncludes(graphModule, "ipAddress", "no ip");
    assertNotIncludes(graphModule, "deviceId", "no device");
    assertNotIncludes(graphModule, "userAgent", "no user agent");
  });

  it("store loader uses scoped indexed queries (no N+1)", () => {
    assertIncludes(
      historyDb,
      "export async function dbGetSafetyCrossCaseSignals",
      "cross-case loader"
    );
    assertIncludes(
      historyDb,
      "computeCrossCasePatternSignals",
      "loader uses pure engine"
    );
    assertIncludes(historyDb, "FROM kristo_safety_reports", "reports query");
    assertIncludes(
      historyDb,
      "FROM kristo_safety_intelligence_events",
      "ledger query"
    );
    assertIncludes(historyDb, "Promise.all", "batched two-query load");
  });
});

describe("12. Confidence Calibration (Phase 2A)", () => {
  const calibrationModule = read(
    "app/api/_lib/safetyConfidenceCalibration.ts"
  );
  const engine = read("app/api/_lib/safetyCaseIntelligenceEngine.ts");
  const reportDb = read("app/api/_lib/store/safetyReportDb.ts");

  const MOD = "../app/api/_lib/safetyConfidenceCalibration.ts";

  function verifiedInput(overrides: Record<string, unknown> = {}) {
    return {
      reporterFinalizedCases: 4,
      targetFinalizedCases: 4,
      uniqueReporterCount: 3,
      evidenceMachineVerified: true,
      evidenceProvider: "acme-vision",
      evidenceProviderVersion: "2.1.0",
      evidenceAnalyzedAt: "2026-01-01T00:00:00.000Z",
      hasOriginalEvidence: true,
      hasSnapshotEvidence: true,
      hasHistoricalOutcomeCoverage: true,
      ...overrides,
    };
  }

  it("unverified evidence => insufficient_data, confidence null", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration(
      verifiedInput({ evidenceMachineVerified: false })
    );
    assert.equal(r.confidenceLevel, "insufficient_data");
    assert.equal(r.confidence, null);
    assert.equal(r.gates.evidenceGatePassed, false);
    assert.ok(r.limitations.includes("evidence_not_machine_verified"));
  });

  it("missing provider/version => insufficient_data", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration(
      verifiedInput({ evidenceProvider: null, evidenceProviderVersion: null })
    );
    assert.equal(r.confidenceLevel, "insufficient_data");
    assert.equal(r.confidence, null);
    assert.equal(r.dataCoverage.evidenceVerified, false);
    assert.ok(
      r.limitations.includes("evidence_provider_or_version_missing")
    );
  });

  it("provider metadata alone (not machine-verified) does not pass", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration(
      verifiedInput({ evidenceMachineVerified: false })
    );
    assert.equal(r.gates.evidenceGatePassed, false);
    assert.equal(r.dataCoverage.evidenceVerified, false);
  });

  it("original content alone does not pass evidence gate", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration({
      reporterFinalizedCases: 4,
      targetFinalizedCases: 4,
      uniqueReporterCount: 3,
      evidenceMachineVerified: false,
      evidenceProvider: null,
      evidenceProviderVersion: null,
      evidenceAnalyzedAt: null,
      hasOriginalEvidence: true,
      hasSnapshotEvidence: true,
      hasHistoricalOutcomeCoverage: true,
    });
    assert.equal(r.gates.evidenceGatePassed, false);
    assert.equal(r.confidenceLevel, "insufficient_data");
  });

  it("insufficient reporter history => insufficient_data", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration(
      verifiedInput({ reporterFinalizedCases: 1 })
    );
    assert.equal(r.gates.reporterHistoryGatePassed, false);
    assert.equal(r.confidenceLevel, "insufficient_data");
    assert.ok(
      r.limitations.includes("reporter_finalized_history_below_minimum")
    );
  });

  it("insufficient target history => insufficient_data", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration(
      verifiedInput({ targetFinalizedCases: 1 })
    );
    assert.equal(r.gates.targetHistoryGatePassed, false);
    assert.equal(r.confidenceLevel, "insufficient_data");
    assert.ok(
      r.limitations.includes("target_finalized_history_below_minimum")
    );
  });

  it("insufficient corroboration is disclosed", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration(
      verifiedInput({ uniqueReporterCount: 1 })
    );
    assert.equal(r.gates.corroborationGatePassed, false);
    assert.ok(
      r.limitations.includes("insufficient_unique_reporter_corroboration")
    );
  });

  it("malformed/null counts normalize safely", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration({
      reporterFinalizedCases: -5 as any,
      targetFinalizedCases: "x" as any,
      uniqueReporterCount: null as any,
      evidenceMachineVerified: "yes" as any,
      evidenceProvider: "   " as any,
      evidenceProviderVersion: undefined as any,
      evidenceAnalyzedAt: null,
      hasOriginalEvidence: undefined as any,
      hasSnapshotEvidence: undefined as any,
      hasHistoricalOutcomeCoverage: undefined as any,
    });
    assert.equal(r.dataCoverage.finalizedReporterCases, 0);
    assert.equal(r.dataCoverage.finalizedTargetCases, 0);
    assert.equal(r.dataCoverage.uniqueReporterCount, 0);
    assert.equal(r.dataCoverage.evidenceVerified, false);
    assert.equal(r.confidenceLevel, "insufficient_data");
    assert.equal(r.confidence, null);
  });

  it("all gates pass => non-insufficient level but numeric confidence stays null", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration(verifiedInput());
    assert.notEqual(r.confidenceLevel, "insufficient_data");
    assert.equal(r.confidence, null);
    assert.equal(r.gates.numericConfidenceAllowed, false);
    assert.ok(
      r.limitations.includes(
        "numeric_confidence_requires_approved_versioned_formula"
      )
    );
  });

  it("low/moderate/high ladder is deterministic", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    // Base gates pass, minimal coverage (no corroboration, no history coverage,
    // minimum counts) => low.
    const low = computeSafetyConfidenceCalibration(
      verifiedInput({
        reporterFinalizedCases: 2,
        targetFinalizedCases: 2,
        uniqueReporterCount: 1,
        hasHistoricalOutcomeCoverage: false,
      })
    );
    assert.equal(low.confidenceLevel, "low");

    // Some coverage => moderate.
    const moderate = computeSafetyConfidenceCalibration(
      verifiedInput({
        reporterFinalizedCases: 2,
        targetFinalizedCases: 2,
        uniqueReporterCount: 2,
        hasHistoricalOutcomeCoverage: false,
      })
    );
    assert.equal(moderate.confidenceLevel, "moderate");

    // Strong coverage => high.
    const high = computeSafetyConfidenceCalibration(
      verifiedInput({
        reporterFinalizedCases: 4,
        targetFinalizedCases: 4,
        uniqueReporterCount: 3,
        hasHistoricalOutcomeCoverage: true,
      })
    );
    assert.equal(high.confidenceLevel, "high");

    // Determinism: same input, same output.
    const again = computeSafetyConfidenceCalibration(
      verifiedInput({
        reporterFinalizedCases: 4,
        targetFinalizedCases: 4,
        uniqueReporterCount: 3,
        hasHistoricalOutcomeCoverage: true,
      })
    );
    assert.deepEqual(again, high);
  });

  it("never emits a default percentage / synthetic baseline", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    // Across many gate combinations, confidence must always be null in v1.
    const cases = [
      verifiedInput(),
      verifiedInput({ evidenceMachineVerified: false }),
      verifiedInput({ reporterFinalizedCases: 1 }),
      verifiedInput({ uniqueReporterCount: 1 }),
    ];
    for (const c of cases) {
      const r = computeSafetyConfidenceCalibration(c);
      assert.equal(r.confidence, null);
    }
    // No hardcoded percentage baseline in source.
    assertNotIncludes(calibrationModule, "confidence = 50", "no 50 baseline");
    assertNotIncludes(calibrationModule, "confidence = 75", "no 75 baseline");
    assertNotIncludes(calibrationModule, "confidence = 100", "no 100 baseline");
  });

  it("exposes versioned constant", async () => {
    const mod = await import(MOD);
    assert.equal(mod.SAFETY_CONFIDENCE_CALIBRATION_VERSION, "v1");
    assert.equal(mod.SAFETY_MIN_REPORTER_FINALIZED_CASES, 2);
    assert.equal(mod.SAFETY_MIN_TARGET_FINALIZED_CASES, 2);
    assert.equal(mod.SAFETY_MIN_UNIQUE_REPORTERS_FOR_CORROBORATION, 2);
    assert.equal(mod.SAFETY_NUMERIC_CONFIDENCE_FORMULA_APPROVED, false);
    const r = mod.computeSafetyConfidenceCalibration(verifiedInput());
    assert.equal(r.version, "v1");
  });

  it("limitations explain every failed gate simultaneously", async () => {
    const { computeSafetyConfidenceCalibration } = await import(MOD);
    const r = computeSafetyConfidenceCalibration({
      reporterFinalizedCases: 0,
      targetFinalizedCases: 0,
      uniqueReporterCount: 0,
      evidenceMachineVerified: false,
      evidenceProvider: null,
      evidenceProviderVersion: null,
      evidenceAnalyzedAt: null,
      hasOriginalEvidence: false,
      hasSnapshotEvidence: false,
      hasHistoricalOutcomeCoverage: false,
    });
    assert.ok(r.limitations.includes("evidence_not_machine_verified"));
    assert.ok(
      r.limitations.includes("reporter_finalized_history_below_minimum")
    );
    assert.ok(
      r.limitations.includes("target_finalized_history_below_minimum")
    );
    assert.ok(
      r.limitations.includes("insufficient_unique_reporter_corroboration")
    );
    assert.ok(
      r.limitations.includes("historical_outcome_coverage_missing")
    );
  });

  it("has no device/IP/location/provider implementation imports", () => {
    assertNotIncludes(calibrationModule, "@neondatabase/serverless", "no neon");
    assertNotIncludes(calibrationModule, "getDatabaseUrl", "no db url");
    assertNotIncludes(calibrationModule, "x-forwarded-for", "no ip capture");
    assertNotIncludes(calibrationModule, "deviceId", "no device capture");
    assertNotIncludes(calibrationModule, "userAgent", "no user agent");
    assertNotIncludes(calibrationModule, "latitude", "no location");
    assertNotIncludes(calibrationModule, "ocr(", "no ocr impl");
  });

  it("integrates as additive block without changing recommendation engine", () => {
    // Type exposed on the Case Intelligence contract.
    assertIncludes(
      engine,
      "calibration?: SafetyConfidenceCalibration",
      "calibration field on contract"
    );
    // Loader attaches calibration facts.
    assertIncludes(
      reportDb,
      "computeSafetyConfidenceCalibration",
      "loader computes calibration"
    );
    assertIncludes(
      reportDb,
      "intelligence.calibration =",
      "calibration attached to result"
    );
    // requiresHumanReview remains hardcoded true in the engine.
    assertIncludes(
      engine,
      "requiresHumanReview: true",
      "human review unchanged"
    );
  });
});

describe("13. Analytics Aggregates (Phase 2A)", () => {
  const analyticsModule = read(
    "app/api/_lib/safetyAnalyticsAggregates.ts"
  );
  const historyDb = read(
    "app/api/_lib/store/safetyIntelligenceHistoryDb.ts"
  );

  const MOD = "../app/api/_lib/safetyAnalyticsAggregates.ts";
  const NOW = Date.parse("2026-06-01T00:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  function led(overrides: Record<string, unknown> = {}) {
    return {
      reportId: "rep_" + Math.random().toString(36).slice(2),
      eventKind: "decision",
      outcomeType: "warning",
      category: "harassment",
      decidedByUserId: "sup1",
      decisionAt: "2026-05-01T00:00:00.000Z",
      resolutionMinutes: 30,
      ...overrides,
    };
  }

  function rep(overrides: Record<string, unknown> = {}) {
    return {
      id: "r_" + Math.random().toString(36).slice(2),
      reporterUserId: "reporter1",
      targetOwnerUserId: "target1",
      churchId: "church1",
      category: "harassment",
      status: "open",
      decisionType: null,
      createdAt: "2026-05-15T00:00:00.000Z",
      ...overrides,
    };
  }

  it("zero data => counts 0, nullable rates null", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      generatedAt: "2026-06-01T00:00:00.000Z",
      nowMs: NOW,
      ledgerRows: [],
      reportRows: [],
    });
    assert.equal(r.finalizedDecisionCount, 0);
    assert.equal(r.averageResolutionMinutes, null);
    assert.deepEqual(r.categoryTrends, []);
    assert.deepEqual(r.supervisorDistribution, []);
    assert.equal(r.falsePositiveRate, null);
    assert.equal(r.falseNegativeRate, null);
    assert.equal(r.appealSuccessRate, null);
    assert.equal(r.supervisorReliabilityTrend, null);
    assert.equal(r.targetRecurrence.totalReports, 0);
    assert.equal(r.reporterOutcomes.accuracyPercent, null);
  });

  it("open reports are excluded from finalized", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      churchId: "church1",
      reportRows: [
        rep({ status: "open", decisionType: null }),
        rep({ status: "in_review", decisionType: null }),
        rep({ status: "resolved", decisionType: "warning" }),
      ],
    });
    assert.equal(r.churchSafetyVolume.totalReports, 3);
    assert.equal(r.churchSafetyVolume.openReports, 2);
    assert.equal(r.churchSafetyVolume.finalizedReports, 1);
  });

  it("confirmed outcomes counted correctly", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      targetUserId: "target1",
      reportRows: [
        rep({ status: "resolved", decisionType: "warning" }),
        rep({ status: "resolved", decisionType: "remove_content" }),
        rep({ status: "resolved", decisionType: "suspend_account" }),
        rep({ status: "open", decisionType: null }),
      ],
    });
    assert.equal(r.targetRecurrence.confirmedViolations, 3);
    assert.equal(r.targetRecurrence.finalizedReports, 3);
    assert.equal(r.targetRecurrence.totalReports, 4);
  });

  it("no_violation and dismissed status counted as dismissed", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      reporterUserId: "reporter1",
      reportRows: [
        rep({ status: "resolved", decisionType: "no_violation" }),
        rep({ status: "dismissed", decisionType: null }),
        rep({ status: "resolved", decisionType: "warning" }),
      ],
    });
    assert.equal(r.reporterOutcomes.dismissedReports, 2);
    assert.equal(r.reporterOutcomes.confirmedReports, 1);
    assert.equal(r.reporterOutcomes.finalizedReports, 3);
    // accuracy = 1 / (1 + 2) = 33
    assert.equal(r.reporterOutcomes.accuracyPercent, 33);
  });

  it("accuracy denominator zero => null", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      reporterUserId: "reporter1",
      reportRows: [rep({ status: "open", decisionType: null })],
    });
    assert.equal(r.reporterOutcomes.confirmedReports, 0);
    assert.equal(r.reporterOutcomes.dismissedReports, 0);
    assert.equal(r.reporterOutcomes.accuracyPercent, null);
  });

  it("average resolution ignores null values", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      ledgerRows: [
        led({ reportId: "a", resolutionMinutes: 10 }),
        led({ reportId: "b", resolutionMinutes: 20 }),
        led({ reportId: "c", resolutionMinutes: null }),
        led({ reportId: "d", resolutionMinutes: "bad" }),
      ],
    });
    assert.equal(r.finalizedDecisionCount, 4);
    // avg of 10 and 20 only.
    assert.equal(r.averageResolutionMinutes, 15);
  });

  it("7/30/90-day window boundaries are deterministic", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      targetUserId: "target1",
      reportRows: [
        rep({ createdAt: new Date(NOW - 3 * DAY).toISOString() }),
        rep({ createdAt: new Date(NOW - 7 * DAY).toISOString() }),
        rep({ createdAt: new Date(NOW - 8 * DAY).toISOString() }),
        rep({ createdAt: new Date(NOW - 29 * DAY).toISOString() }),
        rep({ createdAt: new Date(NOW - 31 * DAY).toISOString() }),
        rep({ createdAt: new Date(NOW - 89 * DAY).toISOString() }),
        rep({ createdAt: new Date(NOW - 120 * DAY).toISOString() }),
      ],
    });
    assert.equal(r.targetRecurrence.reportsLast7Days, 2); // 3d + exactly 7d
    assert.equal(r.targetRecurrence.reportsLast30Days, 4); // +8d +29d
    assert.equal(r.targetRecurrence.reportsLast90Days, 6); // +31d +89d
  });

  it("category trends normalize malformed values", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      reportRows: [
        rep({ category: "Harassment", status: "resolved", decisionType: "warning" }),
        rep({ category: "harassment", status: "open", decisionType: null }),
        rep({ category: "  ", status: "resolved", decisionType: "no_violation" }),
        rep({ category: null, status: "dismissed", decisionType: null }),
      ],
    });
    const harassment = r.categoryTrends.find((c: any) => c.category === "harassment");
    const unknown = r.categoryTrends.find((c: any) => c.category === "unknown");
    assert.ok(harassment, "normalized case-insensitively");
    assert.equal(harassment.reportCount, 2);
    assert.equal(harassment.confirmedViolationCount, 1);
    assert.ok(unknown, "blank/null grouped as unknown");
    assert.equal(unknown.reportCount, 2);
    assert.equal(unknown.dismissedCount, 2);
  });

  it("target recurrence isolated by target", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      targetUserId: "target1",
      reportRows: [
        rep({ targetOwnerUserId: "target1", reporterUserId: "ra" }),
        rep({ targetOwnerUserId: "target1", reporterUserId: "rb" }),
        rep({ targetOwnerUserId: "target2", reporterUserId: "rc" }),
      ],
    });
    assert.equal(r.targetRecurrence.targetUserId, "target1");
    assert.equal(r.targetRecurrence.totalReports, 2);
    assert.equal(r.targetRecurrence.uniqueReporters, 2);
  });

  it("reporter outcomes isolated by reporter", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      reporterUserId: "reporter1",
      reportRows: [
        rep({ reporterUserId: "reporter1", status: "resolved", decisionType: "warning" }),
        rep({ reporterUserId: "reporter2", status: "resolved", decisionType: "warning" }),
      ],
    });
    assert.equal(r.reporterOutcomes.reporterUserId, "reporter1");
    assert.equal(r.reporterOutcomes.confirmedReports, 1);
    assert.equal(r.reporterOutcomes.finalizedReports, 1);
  });

  it("supervisor distributions isolated by supervisor", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      ledgerRows: [
        led({ reportId: "a", decidedByUserId: "sup1", outcomeType: "warning" }),
        led({ reportId: "b", decidedByUserId: "sup1", outcomeType: "suspend_account" }),
        led({ reportId: "c", decidedByUserId: "sup2", outcomeType: "no_violation" }),
        led({ reportId: "d", decidedByUserId: "", outcomeType: "warning" }),
      ],
    });
    const sup1 = r.supervisorDistribution.find((s: any) => s.supervisorUserId === "sup1");
    const sup2 = r.supervisorDistribution.find((s: any) => s.supervisorUserId === "sup2");
    assert.ok(sup1 && sup2);
    assert.equal(sup1.finalizedDecisionCount, 2);
    assert.equal(sup1.warningCount, 1);
    assert.equal(sup1.suspensionCount, 1);
    assert.equal(sup2.noViolationCount, 1);
    // blank supervisor id excluded.
    assert.equal(
      r.supervisorDistribution.find((s: any) => s.supervisorUserId === ""),
      undefined
    );
  });

  it("church volume isolated by church", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      churchId: "church1",
      reportRows: [
        rep({ churchId: "church1", targetOwnerUserId: "t1", reporterUserId: "r1" }),
        rep({ churchId: "church1", targetOwnerUserId: "t2", reporterUserId: "r1" }),
        rep({ churchId: "church2", targetOwnerUserId: "t3", reporterUserId: "r9" }),
      ],
    });
    assert.equal(r.churchSafetyVolume.churchId, "church1");
    assert.equal(r.churchSafetyVolume.totalReports, 2);
    assert.equal(r.churchSafetyVolume.uniqueTargets, 2);
    assert.equal(r.churchSafetyVolume.uniqueReporters, 1);
  });

  it("repeated pattern counts use provided facts only", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      patternCounts: [
        { patternType: "repeated_reporter_targeting_signal", count: 3 },
        { patternType: "  ", count: 5 },
        { patternType: "report_burst_signal", count: -2 },
      ],
    });
    // Blank pattern dropped; negative normalized to 0.
    assert.equal(r.repeatedPatternCounts.length, 2);
    const burst = r.repeatedPatternCounts.find(
      (p: any) => p.patternType === "report_burst_signal"
    );
    assert.equal(burst.count, 0);
    // No confidence field is emitted.
    for (const p of r.repeatedPatternCounts) {
      assert.equal("confidence" in p, false);
    }
  });

  it("never emits synthetic FP/FN/appeal/reliability values", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      ledgerRows: [led({ reportId: "a" }), led({ reportId: "b" })],
      reportRows: [rep({ status: "resolved", decisionType: "warning" })],
    });
    assert.equal(r.falsePositiveRate, null);
    assert.equal(r.falseNegativeRate, null);
    assert.equal(r.appealSuccessRate, null);
    assert.equal(r.supervisorReliabilityTrend, null);
    assert.ok(
      r.limitations.includes(
        "rates_require_appeals_and_final_review_ground_truth"
      )
    );
    assertNotIncludes(analyticsModule, "falsePositiveRate: 0", "no fp baseline");
    assertNotIncludes(analyticsModule, "appealSuccessRate: 0", "no appeal baseline");
  });

  it("duplicate ledger rows cannot inflate counts", async () => {
    const { computeSafetyAnalyticsAggregates } = await import(MOD);
    const r = computeSafetyAnalyticsAggregates({
      nowMs: NOW,
      ledgerRows: [
        led({ reportId: "dup", eventKind: "decision", outcomeType: "warning", resolutionMinutes: 40 }),
        led({ reportId: "dup", eventKind: "decision", outcomeType: "warning", resolutionMinutes: 40 }),
        led({ reportId: "dup2", eventKind: "decision", outcomeType: "warning", resolutionMinutes: 40 }),
      ],
    });
    assert.equal(r.finalizedDecisionCount, 2, "duplicate collapsed");
    const sup = r.supervisorDistribution.find((s: any) => s.supervisorUserId === "sup1");
    assert.equal(sup.finalizedDecisionCount, 2);
  });

  it("has no device/IP/location/provider implementation imports", () => {
    assertNotIncludes(analyticsModule, "@neondatabase/serverless", "no neon");
    assertNotIncludes(analyticsModule, "getDatabaseUrl", "no db url");
    assertNotIncludes(analyticsModule, "x-forwarded-for", "no ip capture");
    assertNotIncludes(analyticsModule, "deviceId", "no device capture");
    assertNotIncludes(analyticsModule, "userAgent", "no user agent");
    assertNotIncludes(analyticsModule, "latitude", "no location");
    assertNotIncludes(analyticsModule, "ocr(", "no ocr impl");
  });

  it("loader uses bounded/indexed parallel queries and no N+1", () => {
    assertIncludes(
      historyDb,
      "export async function dbGetSafetyAnalyticsAggregates",
      "analytics loader"
    );
    assertIncludes(
      historyDb,
      "computeSafetyAnalyticsAggregates",
      "loader uses pure engine"
    );
    assertIncludes(historyDb, "FROM kristo_safety_reports", "reports query");
    assertIncludes(
      historyDb,
      "FROM kristo_safety_intelligence_events",
      "ledger query"
    );
    assertIncludes(historyDb, "Promise.all", "batched parallel load");
    assertIncludes(historyDb, "LIMIT ${limit}", "bounded query");
    assertIncludes(
      historyDb,
      "SAFETY_ANALYTICS_QUERY_LIMIT",
      "documented bound constant"
    );
  });

  it("uses versioned constant", async () => {
    const mod = await import(MOD);
    assert.equal(mod.SAFETY_ANALYTICS_AGGREGATES_VERSION, "v1");
  });
});

describe("14. Evidence Intelligence + Privacy contracts (Phase 2B)", () => {
  const evidenceModule = read(
    "app/api/_lib/safetyEvidenceIntelligence.ts"
  );
  const historyDb = read(
    "app/api/_lib/store/safetyIntelligenceHistoryDb.ts"
  );
  const engine = read("app/api/_lib/safetyCaseIntelligenceEngine.ts");
  const reportDb = read("app/api/_lib/store/safetyReportDb.ts");

  const EVID = "../app/api/_lib/safetyEvidenceIntelligence.ts";
  const CALIB = "../app/api/_lib/safetyConfidenceCalibration.ts";

  function validProvider(overrides: Record<string, unknown> = {}) {
    return {
      provider: "acme-vision",
      providerVersion: "2.1.0",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("no provider => all null and machineVerified false", async () => {
    const { emptyEvidenceClassifierResult, normalizeEvidenceClassifierResult } =
      await import(EVID);
    for (const r of [
      emptyEvidenceClassifierResult(),
      normalizeEvidenceClassifierResult(null),
      normalizeEvidenceClassifierResult(undefined),
    ]) {
      assert.equal(r.machineVerified, false);
      assert.equal(r.ocrConfidence, null);
      assert.equal(r.overallEvidenceConfidence, null);
      assert.ok(
        r.limitations.includes("no_evidence_classifier_provider_connected")
      );
    }
  });

  it("blank provider/version is rejected", async () => {
    const { normalizeEvidenceClassifierResult } = await import(EVID);
    const r = normalizeEvidenceClassifierResult(
      validProvider({ provider: "  ", providerVersion: "", ocrConfidence: 80 })
    );
    assert.equal(r.machineVerified, false);
    assert.ok(r.limitations.includes("missing_provider"));
    assert.ok(r.limitations.includes("missing_provider_version"));
  });

  it("invalid analyzedAt is rejected", async () => {
    const { normalizeEvidenceClassifierResult } = await import(EVID);
    const r = normalizeEvidenceClassifierResult(
      validProvider({ analyzedAt: "not-a-date", ocrConfidence: 80 })
    );
    assert.equal(r.analyzedAt, "");
    assert.equal(r.machineVerified, false);
    assert.ok(r.limitations.includes("invalid_analyzed_at"));
  });

  it("confidence under 0 / over 100 handled safely (null, not fabricated)", async () => {
    const { normalizeEvidenceClassifierResult } = await import(EVID);
    const r = normalizeEvidenceClassifierResult(
      validProvider({ ocrConfidence: -5, imageClassificationConfidence: 150 })
    );
    assert.equal(r.ocrConfidence, null);
    assert.equal(r.imageClassificationConfidence, null);
    assert.ok(r.limitations.includes("ocrConfidence_out_of_range"));
    assert.ok(
      r.limitations.includes("imageClassificationConfidence_out_of_range")
    );
  });

  it("provider metadata alone does not verify evidence", async () => {
    const { normalizeEvidenceClassifierResult } = await import(EVID);
    const r = normalizeEvidenceClassifierResult(validProvider());
    assert.equal(r.machineVerified, false);
    assert.ok(r.limitations.includes("no_real_classifier_signal"));
  });

  it("one real signal + valid provider metadata can verify", async () => {
    const { normalizeEvidenceClassifierResult } = await import(EVID);
    const r = normalizeEvidenceClassifierResult(
      validProvider({ imageClassificationConfidence: 92 })
    );
    assert.equal(r.machineVerified, true);
    assert.equal(r.imageClassificationConfidence, 92);
  });

  it("overall confidence stays null unless provider supplies it (no averaging)", async () => {
    const { normalizeEvidenceClassifierResult } = await import(EVID);
    const noOverall = normalizeEvidenceClassifierResult(
      validProvider({ ocrConfidence: 40, imageClassificationConfidence: 80 })
    );
    assert.equal(noOverall.overallEvidenceConfidence, null);

    const withOverall = normalizeEvidenceClassifierResult(
      validProvider({ ocrConfidence: 40, overallEvidenceConfidence: 55 })
    );
    assert.equal(withOverall.overallEvidenceConfidence, 55);
  });

  it("unknown/raw provider fields are stripped", async () => {
    const { normalizeEvidenceClassifierResult } = await import(EVID);
    const r: any = normalizeEvidenceClassifierResult(
      validProvider({ ocrConfidence: 70, foo: "bar", debugTrace: [1, 2, 3] })
    );
    assert.equal("foo" in r, false);
    assert.equal("debugTrace" in r, false);
    assert.ok(r.limitations.includes("unknown_provider_fields_stripped"));
  });

  it("secrets/tokens are rejected and never persisted", async () => {
    const {
      normalizeEvidenceClassifierResult,
      serializeEvidenceClassifierForPersist,
    } = await import(EVID);
    const r: any = normalizeEvidenceClassifierResult(
      validProvider({
        ocrConfidence: 70,
        apiToken: "sk-secret-123",
        authorization: "Bearer abc",
      })
    );
    assert.equal(r.machineVerified, false, "secret payload rejected");
    assert.ok(r.limitations.includes("raw_provider_payload_rejected"));
    assert.equal("apiToken" in r, false);
    const json = serializeEvidenceClassifierForPersist(r);
    assert.equal(json.includes("sk-secret-123"), false, "secret not persisted");
    assert.equal(json.includes("Bearer"), false);
  });

  it("schemaVersion is always present", async () => {
    const { emptyEvidenceClassifierResult, normalizeEvidenceClassifierResult } =
      await import(EVID);
    assert.equal(
      emptyEvidenceClassifierResult().schemaVersion,
      "v1"
    );
    assert.equal(
      normalizeEvidenceClassifierResult(
        validProvider({ ocrConfidence: 50 })
      ).schemaVersion,
      "v1"
    );
  });

  it("persisted JSON contains only allowlisted keys", async () => {
    const {
      normalizeEvidenceClassifierResult,
      serializeEvidenceClassifierForPersist,
      SAFETY_EVIDENCE_ALLOWED_KEYS,
    } = await import(EVID);
    const r = normalizeEvidenceClassifierResult(
      validProvider({ ocrConfidence: 60 })
    );
    const parsed = JSON.parse(serializeEvidenceClassifierForPersist(r));
    for (const key of Object.keys(parsed)) {
      assert.ok(
        SAFETY_EVIDENCE_ALLOWED_KEYS.has(key),
        `unexpected persisted key: ${key}`
      );
    }
  });

  it("privacy capture status defaults to not_collected; device/IP/geo null", async () => {
    const { emptyPrivacyGatedSignals } = await import(EVID);
    const p = emptyPrivacyGatedSignals();
    assert.equal(p.captureStatus, "not_collected");
    assert.equal(p.reporterDeviceHash, null);
    assert.equal(p.reporterIpHash, null);
    assert.equal(p.reporterGeoCoarse, null);
    assert.equal(p.retentionPolicyVersion, null);
    assert.equal(p.hashingPolicyVersion, null);
    assert.equal(p.consentDisclosureVersion, null);
  });

  it("no header/device/location/network capture code exists", () => {
    assertNotIncludes(evidenceModule, "@neondatabase/serverless", "no neon");
    assertNotIncludes(evidenceModule, "getDatabaseUrl", "no db url");
    assertNotIncludes(evidenceModule, "x-forwarded-for", "no ip capture");
    assertNotIncludes(evidenceModule, "req.headers", "no header capture");
    assertNotIncludes(evidenceModule, "request.headers", "no header capture");
    assertNotIncludes(evidenceModule, "deviceId", "no device capture");
    assertNotIncludes(evidenceModule, "navigator", "no navigator");
    assertNotIncludes(evidenceModule, "userAgent", "no user agent");
    assertNotIncludes(evidenceModule, "geolocation", "no geolocation");
    assertNotIncludes(evidenceModule, "latitude", "no location");
    assertNotIncludes(evidenceModule, "fetch(", "no network");
  });

  it("nullable evidence + privacy DB columns exist (no destructive migration)", () => {
    for (const col of [
      "evidence_classifier_json",
      "reporter_device_hash",
      "reporter_ip_hash",
      "reporter_geo_coarse",
      "privacy_capture_status",
      "retention_policy_version",
      "hashing_policy_version",
      "consent_disclosure_version",
    ]) {
      assertIncludes(
        historyDb,
        `ADD COLUMN IF NOT EXISTS ${col}`,
        `nullable column ${col}`
      );
    }
    assertIncludes(
      historyDb,
      "'not_collected'",
      "privacy capture default"
    );
    // No code path fills device/IP/geo columns.
    assertNotIncludes(historyDb, "reporter_device_hash =", "no device write");
    assertNotIncludes(historyDb, "reporter_ip_hash =", "no ip write");
    assertNotIncludes(historyDb, "reporter_geo_coarse =", "no geo write");
  });

  it("calibration still returns insufficient_data without a provider", async () => {
    const { computeSafetyConfidenceCalibration } = await import(CALIB);
    const { emptyEvidenceClassifierResult } = await import(EVID);
    const evidence = emptyEvidenceClassifierResult();
    const r = computeSafetyConfidenceCalibration({
      reporterFinalizedCases: 4,
      targetFinalizedCases: 4,
      uniqueReporterCount: 3,
      evidenceMachineVerified: evidence.machineVerified,
      evidenceProvider: evidence.provider || null,
      evidenceProviderVersion: evidence.providerVersion || null,
      evidenceAnalyzedAt: evidence.analyzedAt || null,
      hasOriginalEvidence: true,
      hasSnapshotEvidence: true,
      hasHistoricalOutcomeCoverage: true,
    });
    assert.equal(r.confidenceLevel, "insufficient_data");
    assert.equal(r.confidence, null);
  });

  it("integrates as additive block; recommendation unchanged", () => {
    assertIncludes(
      engine,
      "evidenceIntelligence?: SafetyEvidenceClassifierResult",
      "evidence field on contract"
    );
    assertIncludes(
      reportDb,
      "intelligence.evidenceIntelligence = emptyEvidenceClassifierResult()",
      "loader attaches evidence contract"
    );
    assertIncludes(
      engine,
      "requiresHumanReview: true",
      "human review unchanged"
    );
  });
});
