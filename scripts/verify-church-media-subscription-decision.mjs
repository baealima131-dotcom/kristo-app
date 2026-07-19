#!/usr/bin/env node
/**
 * Verifies the church-media subscription DECISION diagnostic.
 *
 * This mirrors the pure logic in:
 *   - app/api/_lib/churchSubscriptionDecisionDiagnostics.ts  (buildSyncDiagnostics, classify)
 *   - app/api/_lib/revenuecat.ts                             (isRevenueCatSubscriberAliasedFromChurch)
 *   - app/api/church/media/route.ts                          (snapshot field mapping)
 *   - app/api/_lib/churchSubscriptionSync.ts                 (which reason is returned per branch)
 *
 * The repo has no TS test runner and server modules pull in the DB layer, so — as with
 * the other verify-*.mjs guards — this reimplements the PURE decision logic and drives
 * one scenario per branch, asserting the diagnostic fields + the classified blocker.
 *
 * Run: node scripts/verify-church-media-subscription-decision.mjs
 */

// ---- mirror: revenuecat.ts -------------------------------------------------
function isRevenueCatSubscriberAliasedFromChurch({ churchId, revenueCatOriginalAppUserId }) {
  const cid = String(churchId || "").trim();
  const original = String(revenueCatOriginalAppUserId || "").trim();
  if (!cid || !original) return false;
  if (original === cid) return false;
  if (original.startsWith("$RCAnonymousID:")) return true;
  if (/^CH7-/i.test(original) && original.toUpperCase() !== cid.toUpperCase()) return true;
  return true;
}

// ---- mirror: churchSubscriptionDecisionDiagnostics.ts ----------------------
function buildSyncDiagnostics({ churchId, verification, ownershipLockAllowed, ownershipLockReason }) {
  const v = verification;
  const cid = String(churchId || "").trim();
  return {
    revenueCatActive: v?.active ?? false,
    revenueCatReason: v?.reason ?? "not-evaluated",
    detectedEntitlement: v?.detectedEntitlement ?? null,
    revenueCatAppUserId: cid || null,
    revenueCatSubscriberAliased: v
      ? isRevenueCatSubscriberAliasedFromChurch({
          churchId: cid,
          revenueCatOriginalAppUserId: v.revenueCatOriginalAppUserId,
        })
      : false,
    store: v?.store ?? null,
    storeSubscriptionIdentityPresent: Boolean(String(v?.storeSubscriptionIdentity || "").trim()),
    ownershipLockAllowed: ownershipLockAllowed,
    ownershipLockReason: ownershipLockReason ?? null,
  };
}

const STORE_IDENTITY_BLOCK_REASONS = new Set(["unverified-store-identity"]);
const ALIAS_BLOCK_REASONS = new Set(["conflict-pending-verification"]);
const OWNERSHIP_CONFLICT_REASONS = new Set([
  "subscription-ownership-lock",
  "store-subscription-ownership-conflict",
]);
const NO_ENTITLEMENT_REASONS = new Set(["no-entitlement", "expired"]);

function classifyChurchSubscriptionDecisionBlocker(s) {
  if (s.subscriptionActiveAfterSync) return "active";
  if (!s.canManageMediaHosts || !s.isActualPastor) return "not-actual-pastor";
  if (!s.hasProfile) return "missing-profile";

  const reason = String(s.syncReason || "").trim();
  if (ALIAS_BLOCK_REASONS.has(reason)) return "revenuecat-alias-mismatch";
  if (STORE_IDENTITY_BLOCK_REASONS.has(reason)) return "missing-store-identity";
  if (OWNERSHIP_CONFLICT_REASONS.has(reason)) return "ownership-conflict";
  if (NO_ENTITLEMENT_REASONS.has(reason)) return "no-entitlement";

  if (s.revenueCatActive === false) return "no-entitlement";
  if (s.revenueCatActive === true && s.storeSubscriptionIdentityPresent === false) {
    return s.revenueCatSubscriberAliased === true
      ? "revenuecat-alias-mismatch"
      : "missing-store-identity";
  }
  if (s.ownershipLockAllowed === false) return "ownership-conflict";
  return "unknown";
}

// ---- mirror: sync return reason + route snapshot mapping -------------------
const VERIFIED_REASONS = new Set(["verified", "verified-subscription"]);

/** Given the runtime inputs a request would see, produce (syncReason, diagnostics, synced). */
function simulateSync(churchId, verification, ownershipLock) {
  const verified =
    verification &&
    verification.active === true &&
    verification.bypassed !== true &&
    VERIFIED_REASONS.has(String(verification.reason || ""));

  if (!verified) {
    return {
      synced: false,
      reason: verification ? verification.reason : "not-pastor",
      diagnostics: buildSyncDiagnostics({
        churchId,
        verification,
        ownershipLockAllowed: null,
        ownershipLockReason: null,
      }),
    };
  }

  if (ownershipLock && ownershipLock.allowed === false) {
    return {
      synced: false,
      reason: ownershipLock.reason || "subscription-ownership-lock",
      diagnostics: buildSyncDiagnostics({
        churchId,
        verification,
        ownershipLockAllowed: false,
        ownershipLockReason: ownershipLock.reason || "subscription-ownership-lock",
      }),
    };
  }

  return {
    synced: true,
    reason: "ok",
    diagnostics: buildSyncDiagnostics({
      churchId,
      verification,
      ownershipLockAllowed: true,
      ownershipLockReason: (ownershipLock && ownershipLock.reason) || "ok",
    }),
  };
}

/** Mirror of the snapshot assembled at the end of GET /api/church/media. */
function buildDecisionSnapshot(rt) {
  const subscriptionActiveBeforeSync = rt.subscriptionActiveBeforeSync === true;
  const syncEligible =
    rt.canManageMediaHosts === true && rt.hasProfile === true && !subscriptionActiveBeforeSync;

  let syncRan = false;
  let syncSynced = null;
  let syncReason = null;
  let d = null;

  if (syncEligible) {
    syncRan = true;
    const sync = simulateSync(rt.churchId, rt.verification, rt.ownershipLock);
    syncSynced = sync.synced;
    syncReason = sync.reason;
    d = sync.diagnostics;
  }

  return {
    churchId: rt.churchId,
    requesterUserId: rt.requesterUserId,
    hasProfile: rt.hasProfile === true,
    isActualPastor: rt.isActualPastor === true,
    canManageMediaHosts: rt.canManageMediaHosts === true,
    subscriptionActiveBeforeSync,
    syncEligible,
    syncRan,
    syncSynced,
    syncReason,
    revenueCatActive: d?.revenueCatActive ?? null,
    revenueCatReason: d?.revenueCatReason ?? null,
    detectedEntitlement: d?.detectedEntitlement ?? null,
    revenueCatAppUserId: d?.revenueCatAppUserId ?? null,
    revenueCatSubscriberAliased: d?.revenueCatSubscriberAliased ?? null,
    store: d?.store ?? null,
    storeSubscriptionIdentityPresent: d?.storeSubscriptionIdentityPresent ?? null,
    ownershipLockAllowed: d?.ownershipLockAllowed ?? null,
    ownershipLockReason: d?.ownershipLockReason ?? null,
    subscriptionActiveAfterSync: rt.subscriptionActiveAfterSync === true,
    canUseMediaToolsAfterSync: rt.canUseMediaToolsAfterSync === true,
    __diagnostics: d,
  };
}

// ---- test harness ----------------------------------------------------------
let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CHURCH = "CH7-ABC123";
const SECRET_IDENTITY = "1000000999888777"; // fake original_transaction_id — must never appear in the log

const scenarios = [
  {
    name: "requester not the actual pastor",
    rt: {
      churchId: CHURCH,
      requesterUserId: "USER-HOST",
      canManageMediaHosts: false,
      isActualPastor: false,
      hasProfile: true,
      subscriptionActiveBeforeSync: false,
      verification: null,
      ownershipLock: null,
      subscriptionActiveAfterSync: false,
      canUseMediaToolsAfterSync: false,
    },
    expectBlocker: "not-actual-pastor",
    checks: (s) => {
      assert("sync did not run", s.syncRan === false);
      assert("no RC call", s.revenueCatReason === null);
    },
  },
  {
    name: "missing media profile",
    rt: {
      churchId: CHURCH,
      requesterUserId: "USER-PASTOR",
      canManageMediaHosts: true,
      isActualPastor: true,
      hasProfile: false,
      subscriptionActiveBeforeSync: false,
      verification: null,
      ownershipLock: null,
      subscriptionActiveAfterSync: false,
      canUseMediaToolsAfterSync: false,
    },
    expectBlocker: "missing-profile",
    checks: (s) => {
      assert("sync eligible false", s.syncEligible === false);
      assert("sync did not run", s.syncRan === false);
    },
  },
  {
    name: "no entitlement from RevenueCat REST",
    rt: {
      churchId: CHURCH,
      requesterUserId: "USER-PASTOR",
      canManageMediaHosts: true,
      isActualPastor: true,
      hasProfile: true,
      subscriptionActiveBeforeSync: false,
      verification: { active: false, reason: "no-entitlement", detectedEntitlement: null },
      ownershipLock: null,
      subscriptionActiveAfterSync: false,
      canUseMediaToolsAfterSync: false,
    },
    expectBlocker: "no-entitlement",
    checks: (s) => {
      assert("sync ran", s.syncRan === true);
      assert("revenueCatActive false", s.revenueCatActive === false);
      assert("ownership never reached", s.ownershipLockAllowed === null);
    },
  },
  {
    name: "active entitlement but missing store identity (not aliased)",
    rt: {
      churchId: CHURCH,
      requesterUserId: "USER-PASTOR",
      canManageMediaHosts: true,
      isActualPastor: true,
      hasProfile: true,
      subscriptionActiveBeforeSync: false,
      verification: {
        active: true,
        reason: "verified",
        detectedEntitlement: "Premium",
        productId: "premium_monthly",
        store: null,
        storeSubscriptionIdentity: "",
        revenueCatOriginalAppUserId: CHURCH,
      },
      ownershipLock: { allowed: false, reason: "unverified-store-identity" },
      subscriptionActiveAfterSync: false,
      canUseMediaToolsAfterSync: false,
    },
    expectBlocker: "missing-store-identity",
    checks: (s) => {
      assert("RC active", s.revenueCatActive === true);
      assert("detected entitlement Premium", s.detectedEntitlement === "Premium");
      assert("store identity absent", s.storeSubscriptionIdentityPresent === false);
      assert("not aliased", s.revenueCatSubscriberAliased === false);
      assert("ownership blocked", s.ownershipLockAllowed === false);
    },
  },
  {
    name: "active entitlement, aliased subscriber, missing identity",
    rt: {
      churchId: CHURCH,
      requesterUserId: "USER-PASTOR",
      canManageMediaHosts: true,
      isActualPastor: true,
      hasProfile: true,
      subscriptionActiveBeforeSync: false,
      verification: {
        active: true,
        reason: "verified",
        detectedEntitlement: "Premium",
        productId: "premium_monthly",
        store: null,
        storeSubscriptionIdentity: "",
        revenueCatOriginalAppUserId: "$RCAnonymousID:9f8e7d6c",
      },
      ownershipLock: { allowed: false, reason: "conflict-pending-verification" },
      subscriptionActiveAfterSync: false,
      canUseMediaToolsAfterSync: false,
    },
    expectBlocker: "revenuecat-alias-mismatch",
    checks: (s) => {
      assert("aliased true", s.revenueCatSubscriberAliased === true);
      assert("store identity absent", s.storeSubscriptionIdentityPresent === false);
    },
  },
  {
    name: "active entitlement, identity present, locked to another church",
    rt: {
      churchId: CHURCH,
      requesterUserId: "USER-PASTOR",
      canManageMediaHosts: true,
      isActualPastor: true,
      hasProfile: true,
      subscriptionActiveBeforeSync: false,
      verification: {
        active: true,
        reason: "verified",
        detectedEntitlement: "Premium",
        productId: "premium_yearly",
        store: "app_store",
        storeSubscriptionIdentity: SECRET_IDENTITY,
        revenueCatOriginalAppUserId: CHURCH,
      },
      ownershipLock: { allowed: false, reason: "store-subscription-ownership-conflict" },
      subscriptionActiveAfterSync: false,
      canUseMediaToolsAfterSync: false,
    },
    expectBlocker: "ownership-conflict",
    checks: (s) => {
      assert("store identity present", s.storeSubscriptionIdentityPresent === true);
      assert("store app_store", s.store === "app_store");
    },
  },
  {
    name: "active entitlement, identity present, allowed -> activated",
    rt: {
      churchId: CHURCH,
      requesterUserId: "USER-PASTOR",
      canManageMediaHosts: true,
      isActualPastor: true,
      hasProfile: true,
      subscriptionActiveBeforeSync: false,
      verification: {
        active: true,
        reason: "verified",
        detectedEntitlement: "Premium",
        productId: "premium_monthly",
        store: "app_store",
        storeSubscriptionIdentity: SECRET_IDENTITY,
        revenueCatOriginalAppUserId: CHURCH,
      },
      ownershipLock: { allowed: true, reason: "ok" },
      subscriptionActiveAfterSync: true,
      canUseMediaToolsAfterSync: true,
    },
    expectBlocker: "active",
    checks: (s) => {
      assert("sync synced", s.syncSynced === true);
      assert("active after sync", s.subscriptionActiveAfterSync === true);
      assert("tools usable", s.canUseMediaToolsAfterSync === true);
    },
  },
];

console.log("KRISTO_CHURCH_MEDIA_SUBSCRIPTION_DECISION verification\n");
for (const scenario of scenarios) {
  console.log(`• ${scenario.name}`);
  const snapshot = buildDecisionSnapshot(scenario.rt);
  const blocker = classifyChurchSubscriptionDecisionBlocker(snapshot);

  assert(
    `blocker = ${scenario.expectBlocker}`,
    blocker === scenario.expectBlocker,
    `got "${blocker}"`
  );
  scenario.checks(snapshot);

  // PII safety: the secret store identity must never appear in the diagnostic payload.
  const serialized = JSON.stringify({
    ...snapshot,
    blocker,
    __diagnostics: undefined,
  });
  assert(
    "no raw store identity leaked",
    !serialized.includes(SECRET_IDENTITY),
    "raw original_transaction_id found in diagnostic payload"
  );
  if (snapshot.__diagnostics) {
    assert(
      "diagnostics expose only boolean identity",
      !JSON.stringify(snapshot.__diagnostics).includes(SECRET_IDENTITY)
    );
  }
  console.log("");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
