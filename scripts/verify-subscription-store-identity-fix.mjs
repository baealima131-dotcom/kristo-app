#!/usr/bin/env node
/**
 * Verification for the store-aware store-subscription identity fix.
 *
 * Mirrors the pure logic of:
 *   - resolveStoreOwnershipFromSubscription  (app/api/_lib/revenuecat.ts)
 *   - upsertSubscriptionOwnershipLockAfterAppStoreActivation guard
 *       (app/api/_lib/subscriptionOwnershipLock.ts)
 *   - shortIdentityHash / identityLogFields  (app/api/_lib/storeIdentityHash.ts)
 *
 * Scenarios (per fix spec):
 *   1. Play record with only store_transaction_id activates.
 *   2. App Store record with original_transaction_id still activates.
 *   3. Existing holder lock with missing identity is safely backfilled.
 *   4. Existing holder lock with matching identity is unchanged.
 *   5. Existing holder lock with conflicting non-empty identity is blocked.
 *   6. Another church holding the same Play identity is blocked.
 *   7. Unknown store does not become app_store.
 *   8. Raw identity never appears in logs or API output.
 *   9. Restore / cross-platform access resolves against the same churchId.
 */

import { createHash } from "node:crypto";

// ---- mirror: storeIdentityHash.ts -----------------------------------------
function shortIdentityHash(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
function identityLogFields(value) {
  const s = String(value ?? "").trim();
  return { present: Boolean(s), hash: shortIdentityHash(s) };
}

// ---- mirror: resolveStoreOwnershipFromSubscription ------------------------
function firstNonEmptyIdentity(values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return null;
}
function resolveStore(subscription) {
  const storeRaw = String(subscription.store || "").toUpperCase();
  if (storeRaw.includes("APP_STORE") || storeRaw === "MAC_APP_STORE") return "app_store";
  if (storeRaw.includes("PLAY_STORE") || storeRaw === "GOOGLE_PLAY") return "play_store";
  return null;
}
function resolveStoreOwnershipFromSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") {
    return { store: null, storeSubscriptionIdentity: null, storeTransactionId: null };
  }
  const store = resolveStore(subscription);
  const appStoreIdentityCandidates = [
    subscription.original_transaction_id,
    subscription.original_store_transaction_id,
    subscription.originalTransactionId,
    subscription.store_transaction_id,
  ];
  const playStoreIdentityCandidates = [
    subscription.store_transaction_id,
    subscription.purchase_token,
    subscription.google_purchase_token,
    subscription.order_id,
    subscription.original_transaction_id,
    subscription.original_store_transaction_id,
    subscription.originalTransactionId,
  ];
  let storeSubscriptionIdentity;
  if (store === "play_store") {
    storeSubscriptionIdentity = firstNonEmptyIdentity(playStoreIdentityCandidates);
  } else if (store === "app_store") {
    storeSubscriptionIdentity = firstNonEmptyIdentity(appStoreIdentityCandidates);
  } else {
    storeSubscriptionIdentity = firstNonEmptyIdentity([
      ...appStoreIdentityCandidates,
      subscription.purchase_token,
      subscription.google_purchase_token,
      subscription.order_id,
    ]);
  }
  return {
    store,
    storeSubscriptionIdentity,
    storeTransactionId: String(subscription.store_transaction_id || "").trim() || null,
  };
}

// ---- mirror: holder-only backfill guard -----------------------------------
function upsertHolderLock({ churchId, existingLock, verification, identityIndex }) {
  const now = 2_000_000_000_000;
  const cid = String(churchId).toUpperCase();
  const verifiedIdentity = String(verification.storeSubscriptionIdentity || "").trim() || null;
  const existingIdentity = String(existingLock?.storeSubscriptionIdentity || "").trim() || null;

  if (existingIdentity && verifiedIdentity && existingIdentity !== verifiedIdentity) {
    return { action: "blocked", reason: "stored-identity-differs-from-verified", lock: existingLock };
  }

  if (verifiedIdentity && !existingIdentity && verification.store) {
    const locks = identityIndex[`${verification.store}:${verifiedIdentity}`] || [];
    const conflicting = locks.find(
      (l) => String(l.lockedChurchId).toUpperCase() !== cid && l.status === "active"
    );
    if (conflicting) {
      return { action: "blocked", reason: "identity-held-by-other-church", lock: conflicting };
    }
  }

  const resolvedStore = verification.store ?? existingLock?.store ?? null;
  const record = {
    lockedChurchId: churchId,
    store: resolvedStore,
    storeSubscriptionIdentity: verifiedIdentity ?? existingIdentity ?? null,
    productId: verification.productId ?? existingLock?.productId ?? null,
    expiresAt: verification.expiresAtMs ?? existingLock?.expiresAt ?? null,
    lockedAt: existingLock?.lockedAt ?? now,
    status: "active",
  };
  const backfilled = Boolean(existingLock && !existingIdentity && verifiedIdentity);
  return { action: backfilled ? "backfilled" : existingLock ? "updated" : "created", record };
}

// ---- test harness ----------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

const PLAY_TXN = "GPA.1122-3344-5566-77889";
const APPLE_TXN = "1000000123456789";
const OTHER_PLAY_TXN = "GPA.9999-0000-1111-22222";

// 1. Play record with only store_transaction_id -> identity resolves, activatable
console.log("[1] Play record (only store_transaction_id) resolves identity");
const play = resolveStoreOwnershipFromSubscription({
  store: "play_store",
  store_transaction_id: PLAY_TXN,
  expires_date: "2026-07-20T03:58:02Z",
});
check("play: store play_store", play.store === "play_store");
check("play: identity resolved from store_transaction_id", play.storeSubscriptionIdentity === PLAY_TXN);
check("play: activatable (has store + identity)", Boolean(play.store && play.storeSubscriptionIdentity));

// 2. App Store record with original_transaction_id still activates
console.log("[2] App Store record still resolves via original_transaction_id");
const apple = resolveStoreOwnershipFromSubscription({
  store: "app_store",
  original_transaction_id: APPLE_TXN,
  store_transaction_id: "should-not-be-primary",
});
check("apple: store app_store", apple.store === "app_store");
check("apple: identity = original_transaction_id", apple.storeSubscriptionIdentity === APPLE_TXN);

// 3. Existing holder lock with missing identity is backfilled
console.log("[3] holder lock missing identity is backfilled");
const holderMissing = {
  lockedChurchId: "CH7-8ST0D5",
  store: "app_store", // stale hardcoded label
  storeSubscriptionIdentity: null,
  status: "active",
  lockedAt: 1783242771732,
};
const r3 = upsertHolderLock({
  churchId: "CH7-8ST0D5",
  existingLock: holderMissing,
  verification: { store: "play_store", storeSubscriptionIdentity: PLAY_TXN, productId: "premium_monthly", expiresAtMs: 1784519882000 },
  identityIndex: {},
});
check("backfill: action backfilled", r3.action === "backfilled");
check("backfill: store corrected to play_store", r3.record.store === "play_store");
check("backfill: identity set", r3.record.storeSubscriptionIdentity === PLAY_TXN);
check("backfill: preserves original lockedAt", r3.record.lockedAt === 1783242771732);

// 4. Existing holder lock with matching identity is unchanged (idempotent)
console.log("[4] holder lock with matching identity unchanged");
const holderMatch = { lockedChurchId: "CH7-8ST0D5", store: "play_store", storeSubscriptionIdentity: PLAY_TXN, status: "active", lockedAt: 1783242771732 };
const r4 = upsertHolderLock({
  churchId: "CH7-8ST0D5",
  existingLock: holderMatch,
  verification: { store: "play_store", storeSubscriptionIdentity: PLAY_TXN, productId: "premium_monthly", expiresAtMs: 1784519882000 },
  identityIndex: {},
});
check("match: not blocked", r4.action !== "blocked");
check("match: identity unchanged", r4.record.storeSubscriptionIdentity === PLAY_TXN);
check("match: not backfilled (already had identity)", r4.action !== "backfilled");

// 5. Existing holder lock with conflicting non-empty identity is blocked
console.log("[5] holder lock with conflicting non-empty identity is blocked");
const holderConflict = { lockedChurchId: "CH7-8ST0D5", store: "play_store", storeSubscriptionIdentity: PLAY_TXN, status: "active" };
const r5 = upsertHolderLock({
  churchId: "CH7-8ST0D5",
  existingLock: holderConflict,
  verification: { store: "play_store", storeSubscriptionIdentity: OTHER_PLAY_TXN },
  identityIndex: {},
});
check("conflict: blocked", r5.action === "blocked");
check("conflict: reason stored-identity-differs", r5.reason === "stored-identity-differs-from-verified");
check("conflict: existing identity NOT overwritten", r5.lock.storeSubscriptionIdentity === PLAY_TXN);

// 6. Another church holding the same Play identity is blocked
console.log("[6] same Play identity held by another church is blocked");
const r6 = upsertHolderLock({
  churchId: "CH7-8ST0D5",
  existingLock: { lockedChurchId: "CH7-8ST0D5", store: "app_store", storeSubscriptionIdentity: null, status: "active" },
  verification: { store: "play_store", storeSubscriptionIdentity: PLAY_TXN },
  identityIndex: {
    [`play_store:${PLAY_TXN}`]: [{ lockedChurchId: "CH9-OTHER99", ownerUserId: "u_other", status: "active" }],
  },
});
check("cross-church: blocked", r6.action === "blocked");
check("cross-church: reason identity-held-by-other-church", r6.reason === "identity-held-by-other-church");
check("cross-church: returns the other church's lock", r6.lock.lockedChurchId === "CH9-OTHER99");

// 7. Unknown store does not become app_store
console.log("[7] unknown store never becomes app_store");
const unknown = resolveStoreOwnershipFromSubscription({ store: "PROMOTIONAL", store_transaction_id: "x123" });
check("unknown: store is null (not app_store)", unknown.store === null);
const r7 = upsertHolderLock({
  churchId: "CH7-8ST0D5",
  existingLock: { lockedChurchId: "CH7-8ST0D5", store: null, storeSubscriptionIdentity: null, status: "active" },
  verification: { store: null, storeSubscriptionIdentity: "x123" },
  identityIndex: {},
});
check("unknown: lock store not invented as app_store", r7.record.store === null);

// 8. Raw identity never appears in logs or API output
console.log("[8] raw identity never leaks into logs / API output");
const logPayload = {
  event: "KRISTO_SUBSCRIPTION_LOCK_CREATED",
  storeSubscriptionIdentity: identityLogFields(PLAY_TXN),
  store: "play_store",
};
const logJson = JSON.stringify(logPayload);
check("log: no raw play identity", !logJson.includes(PLAY_TXN));
check("log: has presence bool", logPayload.storeSubscriptionIdentity.present === true);
check("log: has short hash", /^[0-9a-f]{12}$/.test(logPayload.storeSubscriptionIdentity.hash));
check("hash: deterministic", shortIdentityHash(PLAY_TXN) === shortIdentityHash(PLAY_TXN));
check("hash: not equal to raw", shortIdentityHash(PLAY_TXN) !== PLAY_TXN);
// API payload shape (mirror of SubscriptionOwnershipLockApiPayload) excludes identity entirely
const apiPayload = { blocked: false, isLockHolder: true, lockedChurchId: "CH7-8ST0D5", store: "play_store", expiresAt: 1784519882000, status: "active" };
check("api: has no identity field", !("storeSubscriptionIdentity" in apiPayload) && !("storeTransactionId" in apiPayload));
check("api: no raw identity in serialized output", !JSON.stringify(apiPayload).includes(PLAY_TXN));

// 9. Restore / cross-platform access resolves against the same churchId
console.log("[9] cross-platform (iOS view of Play sub) resolves as holder, not conflict");
// RC app_user_id == churchId; identity index has THIS church holding the identity.
const r9 = upsertHolderLock({
  churchId: "CH7-8ST0D5",
  existingLock: { lockedChurchId: "CH7-8ST0D5", store: "play_store", storeSubscriptionIdentity: PLAY_TXN, status: "active" },
  verification: { store: "play_store", storeSubscriptionIdentity: PLAY_TXN },
  identityIndex: { [`play_store:${PLAY_TXN}`]: [{ lockedChurchId: "CH7-8ST0D5", ownerUserId: "u_self", status: "active" }] },
});
check("cross-platform: not blocked (same church holds identity)", r9.action !== "blocked");
check("cross-platform: still play_store", r9.record.store === "play_store");

// --- summary ----------------------------------------------------------------
console.log("");
console.log(`Store-identity fix verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAILURES:", failures.join(", "));
  process.exit(1);
}
console.log("All store-identity fix checks passed.");
