#!/usr/bin/env node
/**
 * Verification for the TEMPORARY, PII-safe subscriber/lock audit diagnostic.
 *
 * Proves (without a live backend):
 *   1. Audit gate is church-scoped: another church yields NO audit.
 *   2. Emitted payloads never carry raw identity / token / receipt values.
 *   3. Dates and booleans normalize safely (string passthrough or null; strict bool).
 *   4. Missing / malformed fields do not throw and degrade to null/false.
 *   5. Diagnostic is pure: it never mutates the input record.
 *
 * The helpers below MIRROR app/api/_lib/churchSubscriberAudit.ts. The short hash
 * uses the same algorithm (sha256, first 12 hex chars) so drift is detectable.
 */

import { createHash } from "node:crypto";

// ---- mirror of churchSubscriberAudit.ts -----------------------------------

const AUDIT_CHURCH_IDS = new Set(["CH7-8ST0D5"]);

function isSubscriberAuditChurch(churchId) {
  const cid = String(churchId || "").trim().toUpperCase();
  if (!cid) return false;
  if (AUDIT_CHURCH_IDS.has(cid)) return true;
  const envCid = String(process.env.KRISTO_SUBSCRIBER_AUDIT_CHURCH_ID || "").trim().toUpperCase();
  return Boolean(envCid && envCid === cid);
}

const IDENTITY_FIELDS = [
  "original_transaction_id",
  "original_store_transaction_id",
  "store_transaction_id",
  "transaction_id",
  "purchase_token",
  "google_purchase_token",
  "order_id",
];

function trimmedOrNull(value) {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function hasValue(value) {
  return Boolean(String(value ?? "").trim());
}

function shortIdentityHash(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function summarizeSubscriptionIdentity(record) {
  const presence = {};
  const names = [];
  for (const field of IDENTITY_FIELDS) {
    const present = hasValue(record?.[field]);
    presence[field] = present;
    if (present) names.push(field);
  }
  let chosen = null;
  for (const field of IDENTITY_FIELDS) {
    if (hasValue(record?.[field])) {
      chosen = String(record?.[field]).trim();
      break;
    }
  }
  return {
    identityFieldNamesPresent: names,
    identityPresence: presence,
    identityPresent: names.length > 0,
    identityHash: shortIdentityHash(chosen),
  };
}

function buildSubscriptionRecordAudit(record) {
  if (!record || typeof record !== "object") return null;
  return {
    store: trimmedOrNull(record.store),
    periodType: trimmedOrNull(record.period_type),
    ownershipType: trimmedOrNull(record.ownership_type),
    isSandbox: record.is_sandbox === true,
    purchaseDate: trimmedOrNull(record.purchase_date),
    originalPurchaseDate: trimmedOrNull(record.original_purchase_date),
    expiresDate: trimmedOrNull(record.expires_date),
    unsubscribeDetectedAtPresent: hasValue(record.unsubscribe_detected_at),
    billingIssuesDetectedAtPresent: hasValue(record.billing_issues_detected_at),
    ...summarizeSubscriptionIdentity(record),
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildLockAudit(lock, churchId) {
  const cid = String(churchId || "").trim();
  if (!lock || typeof lock !== "object") {
    return {
      churchId: cid,
      lockedChurchId: null,
      isLockHolder: false,
      store: null,
      productId: null,
      status: null,
      expiresAt: null,
      lockedAt: null,
      updatedAt: null,
      identityPresent: false,
      identityHash: null,
    };
  }
  const lockedChurchId = trimmedOrNull(lock.lockedChurchId);
  const identity = trimmedOrNull(lock.storeSubscriptionIdentity);
  return {
    churchId: cid,
    lockedChurchId,
    isLockHolder: Boolean(
      lockedChurchId && cid && lockedChurchId.toUpperCase() === cid.toUpperCase()
    ),
    store: trimmedOrNull(lock.store),
    productId: trimmedOrNull(lock.productId),
    status: trimmedOrNull(lock.status),
    expiresAt: numberOrNull(lock.expiresAt),
    lockedAt: numberOrNull(lock.lockedAt),
    updatedAt: numberOrNull(lock.updatedAt),
    identityPresent: Boolean(identity),
    identityHash: shortIdentityHash(identity),
  };
}

// ---- test harness ----------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

// Secret values that must NEVER appear in serialized audit output.
const SECRET_TXN = "1000000999888777";
const SECRET_TOKEN = "abcdefg.PLAY.PURCHASE.TOKEN.zzzz";
const SECRET_ORDER = "GPA.3311-0022-1122-33445";

// --- 1. Gate is church-scoped ----------------------------------------------
console.log("[1] audit gate is scoped to the target church");
check("gate: CH7-8ST0D5 audited", isSubscriberAuditChurch("CH7-8ST0D5") === true);
check("gate: lowercase match audited", isSubscriberAuditChurch("ch7-8st0d5") === true);
check("gate: other church NOT audited", isSubscriberAuditChurch("CH0-OTHER1") === false);
check("gate: empty NOT audited", isSubscriberAuditChurch("") === false);
check("gate: null NOT audited", isSubscriberAuditChurch(null) === false);

// --- 2. No raw identity/token/receipt leaks --------------------------------
console.log("[2] audit payloads never carry raw identity/token/receipt");
const playRecord = {
  store: "play_store",
  period_type: "trial",
  ownership_type: "PURCHASED",
  is_sandbox: false,
  purchase_date: "2026-07-06T03:58:02Z",
  original_purchase_date: "2026-07-06T03:58:02Z",
  expires_date: "2026-07-20T03:58:02Z",
  unsubscribe_detected_at: null,
  billing_issues_detected_at: null,
  store_transaction_id: SECRET_TXN,
  purchase_token: SECRET_TOKEN,
  order_id: SECRET_ORDER,
};
const recordAudit = buildSubscriptionRecordAudit(playRecord);
const recordJson = JSON.stringify(recordAudit);
check("record: no raw transaction id", !recordJson.includes(SECRET_TXN));
check("record: no raw purchase token", !recordJson.includes(SECRET_TOKEN));
check("record: no raw order id", !recordJson.includes(SECRET_ORDER));
check(
  "record: identity present names listed",
  recordAudit.identityFieldNamesPresent.includes("store_transaction_id") &&
    recordAudit.identityFieldNamesPresent.includes("purchase_token") &&
    recordAudit.identityFieldNamesPresent.includes("order_id")
);
check("record: identityPresent true", recordAudit.identityPresent === true);
check(
  "record: presence booleans strict",
  recordAudit.identityPresence.store_transaction_id === true &&
    recordAudit.identityPresence.original_transaction_id === false
);

// hash is one-way, short, deterministic, and not the raw value
const h1 = shortIdentityHash(SECRET_TXN);
const h2 = shortIdentityHash(SECRET_TXN);
check("hash: deterministic", h1 === h2);
check("hash: short (12 hex)", typeof h1 === "string" && /^[0-9a-f]{12}$/.test(h1));
check("hash: not equal to input", h1 !== SECRET_TXN);
check("hash: does not contain input", !h1.includes(SECRET_TXN.slice(0, 8)));
check("hash: empty -> null", shortIdentityHash("") === null && shortIdentityHash(null) === null);
// chosen identity for hash follows priority order (store_transaction_id before purchase_token)
check(
  "record: chosen identity hash = first present in priority",
  recordAudit.identityHash === shortIdentityHash(SECRET_TXN)
);

// lock audit
const lockRecord = {
  lockedChurchId: "CH7-8ST0D5",
  store: "app_store",
  productId: "premium_monthly",
  status: "active",
  expiresAt: 1784520000000,
  lockedAt: 1783310000000,
  updatedAt: 1783310000000,
  storeSubscriptionIdentity: SECRET_TXN,
  storeTransactionId: SECRET_TXN,
};
const lockAudit = buildLockAudit(lockRecord, "CH7-8ST0D5");
const lockJson = JSON.stringify(lockAudit);
check("lock: no raw identity", !lockJson.includes(SECRET_TXN));
check("lock: identityPresent true", lockAudit.identityPresent === true);
check("lock: identityHash short hex", /^[0-9a-f]{12}$/.test(lockAudit.identityHash));
check("lock: isLockHolder true for same church", lockAudit.isLockHolder === true);
check(
  "lock: isLockHolder false for different church",
  buildLockAudit(lockRecord, "CH0-OTHER1").isLockHolder === false
);

// --- 3. Dates & booleans normalize safely ----------------------------------
console.log("[3] dates and booleans normalize safely");
check("date: passthrough string", recordAudit.purchaseDate === "2026-07-06T03:58:02Z");
check("bool: is_sandbox=false -> false", recordAudit.isSandbox === false);
check(
  "bool: is_sandbox='true' string is NOT treated as true",
  buildSubscriptionRecordAudit({ is_sandbox: "true" }).isSandbox === false
);
check(
  "bool: unsubscribe present",
  buildSubscriptionRecordAudit({ unsubscribe_detected_at: "2026-07-10T00:00:00Z" })
    .unsubscribeDetectedAtPresent === true
);
check(
  "bool: unsubscribe absent",
  recordAudit.unsubscribeDetectedAtPresent === false
);
check("num: lock expiresAt kept", lockAudit.expiresAt === 1784520000000);
check(
  "num: lock non-number -> null",
  buildLockAudit({ ...lockRecord, expiresAt: "soon" }, "CH7-8ST0D5").expiresAt === null
);

// --- 4. Missing / malformed fields do not throw ----------------------------
console.log("[4] missing/malformed fields degrade safely (no throw)");
let threw = false;
try {
  const emptyRecord = buildSubscriptionRecordAudit({});
  check("empty record: store null", emptyRecord.store === null);
  check("empty record: isSandbox false", emptyRecord.isSandbox === false);
  check("empty record: no identity names", emptyRecord.identityFieldNamesPresent.length === 0);
  check("empty record: identityHash null", emptyRecord.identityHash === null);
  check("null record -> null audit", buildSubscriptionRecordAudit(null) === null);
  check("undefined record -> null audit", buildSubscriptionRecordAudit(undefined) === null);

  const noLock = buildLockAudit(null, "CH7-8ST0D5");
  check("no lock: identityPresent false", noLock.identityPresent === false);
  check("no lock: lockedChurchId null", noLock.lockedChurchId === null);
  check("no lock: isLockHolder false", noLock.isLockHolder === false);
} catch (err) {
  threw = true;
  console.error("  threw:", err);
}
check("no throw on missing fields", threw === false);

// --- 5. Purity: input record is not mutated --------------------------------
console.log("[5] audit builders are pure (no input mutation)");
const before = JSON.stringify(playRecord);
buildSubscriptionRecordAudit(playRecord);
check("record not mutated", JSON.stringify(playRecord) === before);
const lockBefore = JSON.stringify(lockRecord);
buildLockAudit(lockRecord, "CH7-8ST0D5");
check("lock not mutated", JSON.stringify(lockRecord) === lockBefore);

// --- summary ----------------------------------------------------------------
console.log("");
console.log(`Subscriber audit verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAILURES:", failures.join(", "));
  process.exit(1);
}
console.log("All subscriber-audit diagnostic checks passed.");
