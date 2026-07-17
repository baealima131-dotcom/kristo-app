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

describe("5. Case Intelligence Engine — heuristic decision-support", () => {
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
      reporterLifetimeReports: 1,
      reporterConfirmedReports: 0,
      reporterDismissedReports: 0,
      reporterDuplicateOnThisTarget: 0,
      reporterReportsOnThisTarget: 1,
      reporterHasFalseReportingPenalty: false,
      targetTotalReports: 1,
      targetUniqueReporters: 1,
      targetActiveReports: 1,
      targetResolvedReports: 0,
      targetDismissedReports: 0,
      targetEscalatedReports: 0,
      targetConfirmedViolations: 0,
      targetWarnings: 0,
      targetRemovals: 0,
      targetRestrictions: 0,
      targetSuspensions: 0,
      targetPermanentBans: 0,
      targetReportsLast7d: 1,
      targetReportsLast30d: 1,
      targetReportsLast90d: 1,
      targetUniqueReportersLast24h: 1,
      targetUniqueReportersLast7d: 1,
      repeatedCategories: [] as string[],
      ...overrides,
    };
  }

  it("wires dbGetSafetyCaseIntelligence into report detail hydrate", () => {
    assertIncludes(
      decisionDb,
      "export async function dbGetSafetyCaseIntelligence",
      "db loader"
    );
    assertIncludes(route, "dbGetSafetyCaseIntelligence", "route import/use");
    assertIncludes(route, "caseIntelligence", "API field");
    assertIncludes(engine, 'analysisMode: "heuristic"', "heuristic mode");
    assertIncludes(engine, "requiresHumanReview: true", "human review");
    assertIncludes(engine, "CASE_INTELLIGENCE_WEIGHTS", "named weights");
    assertIncludes(
      decisionDb,
      "KRISTO_SAFETY_CASE_INTELLIGENCE_INPUT",
      "db input log"
    );
    assertIncludes(
      decisionDb,
      "KRISTO_SAFETY_CASE_INTELLIGENCE_READY",
      "db ready log"
    );
    assertIncludes(
      decisionDb,
      "KRISTO_SAFETY_CASE_INTELLIGENCE_FAILED",
      "db failure log"
    );
    assertIncludes(
      route,
      'console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_INPUT"',
      "route input log before call"
    );
    assertIncludes(
      route,
      'console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_READY"',
      "route ready log after call"
    );
    assertIncludes(
      route,
      "hydrated.caseIntelligence = caseIntelligence",
      "explicit caseIntelligence attach"
    );
    assertIncludes(
      route,
      "hydrate_route_before_call",
      "route stages the intelligence call"
    );

    const fnStart = decisionDb.indexOf(
      "export async function dbGetSafetyCaseIntelligence"
    );
    const fnEnd = decisionDb.indexOf(
      "export type SafetyAccountEnforcementType",
      fnStart
    );
    const fnBody = decisionDb.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
    assert.ok(
      !fnBody.includes("await ensureSafetyAccountEnforcementSchema()"),
      "report-detail intelligence must not migrate enforcement schema/indexes"
    );
    assert.ok(
      !fnBody.includes("${targetId} <> ''"),
      "must not use ${id} <> '' Neon parameter comparisons"
    );
  });

  it("trusted reporter + repeated confirmed target behavior", async () => {
    const {
      computeSafetyCaseIntelligence,
    } = await import("../app/api/_lib/safetyCaseIntelligenceEngine.ts");

    const result = computeSafetyCaseIntelligence(
      baseRaw({
        reporterLifetimeReports: 20,
        reporterConfirmedReports: 16,
        reporterDismissedReports: 2,
        targetConfirmedViolations: 4,
        targetWarnings: 2,
        targetRestrictions: 1,
        targetTotalReports: 12,
        targetUniqueReporters: 5,
        targetReportsLast7d: 4,
        targetReportsLast30d: 8,
        repeatedCategories: ["harassment"],
        originalContentAvailable: true,
        hasThumbnail: true,
        hasPreview: true,
      })
    );

    assert.equal(result.status, "ready");
    assert.equal(result.analysisMode, "heuristic");
    assert.equal(result.assessment.requiresHumanReview, true);
    assert.ok(result.reporter.credibilityScore >= 70);
    assert.ok(["high", "trusted"].includes(result.reporter.credibilityLevel));
    assert.ok(result.target.riskScore >= 40);
    assert.ok(result.assessment.caseRiskScore >= 40);
    assert.ok(
      ["warning", "remove_content", "restrict_account", "suspend_account", "escalate", "permanent_ban"].includes(
        result.assessment.recommendation
      )
    );
    assert.ok(
      result.patterns.some((p) => p.type === "repeated_confirmed_violations")
    );
  });

  it("unreliable reporter + clean target history stays cautious", async () => {
    const {
      computeSafetyCaseIntelligence,
    } = await import("../app/api/_lib/safetyCaseIntelligenceEngine.ts");

    const result = computeSafetyCaseIntelligence(
      baseRaw({
        reporterLifetimeReports: 12,
        reporterConfirmedReports: 1,
        reporterDismissedReports: 9,
        reporterHasFalseReportingPenalty: true,
        targetConfirmedViolations: 0,
        targetWarnings: 0,
        targetTotalReports: 1,
        targetUniqueReporters: 1,
        originalContentAvailable: false,
        hasThumbnail: false,
        hasPreview: false,
        hasMediaUri: false,
      })
    );

    assert.equal(result.status, "ready");
    assert.ok(result.reporter.credibilityScore < 45);
    assert.equal(result.reporter.credibilityLevel, "low");
    assert.ok(result.target.riskScore < 35);
    assert.ok(
      ["no_violation", "monitor", "escalate"].includes(
        result.assessment.recommendation
      )
    );
    assert.ok(
      result.assessment.mitigatingFactors.includes("low_reporter_credibility") ||
        result.assessment.mitigatingFactors.includes("weak_or_incomplete_evidence") ||
        result.assessment.mitigatingFactors.includes("limited_target_history")
    );
  });

  it("coordinated-report suspicion surfaces as pattern and escalate path", async () => {
    const {
      computeSafetyCaseIntelligence,
    } = await import("../app/api/_lib/safetyCaseIntelligenceEngine.ts");

    const result = computeSafetyCaseIntelligence(
      baseRaw({
        targetUniqueReportersLast24h: 5,
        targetUniqueReportersLast7d: 7,
        targetUniqueReporters: 7,
        targetTotalReports: 8,
        originalContentAvailable: true,
        hasPreview: true,
      })
    );

    assert.ok(
      result.patterns.some(
        (p) => p.type === "coordinated_reporting_suspicion"
      )
    );
    assert.equal(result.assessment.recommendation, "escalate");
    assert.ok(
      result.assessment.aggravatingFactors.includes(
        "coordinated_reporting_suspicion"
      )
    );
  });

  it("repeated confirmed harassment after warning", async () => {
    const {
      computeSafetyCaseIntelligence,
    } = await import("../app/api/_lib/safetyCaseIntelligenceEngine.ts");

    const result = computeSafetyCaseIntelligence(
      baseRaw({
        category: "harassment",
        reporterLifetimeReports: 8,
        reporterConfirmedReports: 6,
        reporterDismissedReports: 1,
        targetConfirmedViolations: 3,
        targetWarnings: 2,
        targetSuspensions: 0,
        targetRestrictions: 0,
        targetTotalReports: 9,
        targetUniqueReporters: 4,
        repeatedCategories: ["harassment"],
        originalContentAvailable: true,
        hasPreview: true,
        hasThumbnail: true,
      })
    );

    assert.ok(
      result.patterns.some((p) => p.type === "prior_warning_ignored")
    );
    assert.ok(result.assessment.caseRiskScore >= 45);
    assert.notEqual(result.assessment.recommendation, "no_violation");
  });

  it("insufficient data when identifiers are missing", async () => {
    const {
      computeSafetyCaseIntelligence,
    } = await import("../app/api/_lib/safetyCaseIntelligenceEngine.ts");

    const result = computeSafetyCaseIntelligence(
      baseRaw({
        reporterUserId: "",
        targetId: "",
        targetOwnerUserId: "",
      })
    );

    assert.equal(result.status, "insufficient_data");
    assert.equal(result.assessment.confidence, 0);
    assert.ok(
      result.evidence.limitations.includes(
        "missing_reporter_and_target_identifiers"
      )
    );
  });

  it("does not fabricate 0/1/100% volume fallbacks as decision scores", () => {
    assertNotIncludes(
      engine,
      'recommendation: "permanent_ban"\n    reasoning.push(\n      "High report volume"',
      "volume-only ban"
    );
    assertIncludes(engine, "PERMANENT_BAN_MIN_CASE_RISK", "ban gate");
    assertIncludes(engine, "PERMANENT_BAN_MIN_EVIDENCE", "evidence gate");
    assertIncludes(route, "caseIntelligence", "hydrate caseIntelligence");
    assertNotIncludes(
      route,
      "weightedScore: 1,\n      weightedPercent: 10",
      "fake hydrate fallback"
    );
    assertIncludes(decisionDb, "return emptyRiskAssessment();", "legacy empty");
  });

  it("permanent ban is not triggered by report volume alone", async () => {
    const {
      computeSafetyCaseIntelligence,
      CASE_INTELLIGENCE_WEIGHTS,
    } = await import("../app/api/_lib/safetyCaseIntelligenceEngine.ts");

    const volumeOnly = computeSafetyCaseIntelligence(
      baseRaw({
        targetTotalReports: 40,
        targetUniqueReporters: 1,
        targetConfirmedViolations: 0,
        targetWarnings: 0,
        targetRestrictions: 0,
        targetSuspensions: 0,
        targetPermanentBans: 0,
        targetReportsLast7d: 20,
        targetReportsLast30d: 30,
        reporterLifetimeReports: 1,
        reporterConfirmedReports: 0,
        reporterDismissedReports: 0,
        originalContentAvailable: false,
        hasThumbnail: false,
        hasPreview: true,
        hasMediaUri: false,
      })
    );

    assert.notEqual(volumeOnly.assessment.recommendation, "permanent_ban");
    assert.ok(
      volumeOnly.assessment.caseRiskScore <
        CASE_INTELLIGENCE_WEIGHTS.PERMANENT_BAN_MIN_CASE_RISK ||
        volumeOnly.evidence.strengthScore <
          CASE_INTELLIGENCE_WEIGHTS.PERMANENT_BAN_MIN_EVIDENCE
    );
  });

  it("mobile CASE INTELLIGENCE UI avoids eternal CALCULATING", () => {
    assertIncludes(mobile, "CASE INTELLIGENCE", "section title");
    assertIncludes(mobile, "Heuristic Case Intelligence", "honest label");
    assertIncludes(mobile, "INSUFFICIENT DATA", "insufficient state");
    assertIncludes(mobile, "ANALYSIS UNAVAILABLE", "error state");
    assertIncludes(mobile, "Human review required", "human review copy");
    assertNotIncludes(
      mobile,
      "setDecisionConfidence(90)",
      "fake default confidence 90"
    );
    assertNotIncludes(
      mobile,
      "AI analyzed video",
      "no fabricated video analysis"
    );
  });

  it("recommendation boundaries stay within the allowed set", async () => {
    const {
      computeSafetyCaseIntelligence,
    } = await import("../app/api/_lib/safetyCaseIntelligenceEngine.ts");

    const allowed = new Set([
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
        targetConfirmedViolations: 5,
        targetSuspensions: 2,
        targetWarnings: 3,
        originalContentAvailable: true,
        hasMediaUri: true,
        hasThumbnail: true,
        mediaType: "video",
        reporterConfirmedReports: 10,
        reporterLifetimeReports: 12,
        reporterDismissedReports: 1,
        targetUniqueReporters: 6,
      }),
    ];

    for (const sample of samples) {
      const result = computeSafetyCaseIntelligence(sample as any);
      assert.ok(
        allowed.has(result.assessment.recommendation),
        `unexpected recommendation ${result.assessment.recommendation}`
      );
      assert.equal(result.assessment.requiresHumanReview, true);
      assert.ok(result.assessment.confidence >= 0);
      assert.ok(result.assessment.confidence <= 100);
      assert.ok(result.assessment.caseRiskScore >= 0);
      assert.ok(result.assessment.caseRiskScore <= 100);
    }
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
