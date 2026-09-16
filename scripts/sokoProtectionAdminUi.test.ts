/**
 * Stage 2 Kristo System Admin Buyer Protection review queue — UI source + label guards.
 *
 * Run: node --experimental-strip-types --test scripts/sokoProtectionAdminUi.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  adminActionsForState,
  canConfirmAdminNote,
  CURRENT_ORDER_STATUS_UNAVAILABLE,
  currentOrderStatusDisplay,
  evidenceBelongsToCase,
  filterAdminQueueRows,
  filterToApiState,
  frozenProductTitle,
  isSellerResponseOverdue,
  ORDER_AT_CASE_OPENING_LABEL,
  orderAtCaseOpeningDisplay,
  paymentClaimLabelText,
  paymentVerificationKindLabel,
  protectionAdminForbiddenLanguageHits,
  protectionCaseStateLabel,
  requireAdminActionNote,
  sortProtectionEventsChronologically,
  SOKO_PROTECTION_ADMIN_HONEST_DISCLAIMER,
} from "../apps/mobile/src/lib/sokoProtectionAdminLabels.ts";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const UI_FILES = [
  "apps/mobile/app/(tabs)/more/system-admin/index.tsx",
  "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/index.tsx",
  "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx",
  "apps/mobile/src/lib/sokoProtectionAdminApi.ts",
  "apps/mobile/src/lib/sokoProtectionAdminLabels.ts",
];

test("System Admin nav includes Buyer Protection route", () => {
  const index = read("apps/mobile/app/(tabs)/more/system-admin/index.tsx");
  assert.match(index, /buyer_protection/);
  assert.match(index, /Buyer Protection/);
  assert.match(index, /\/more\/system-admin\/buyer-protection/);
});

test("non-admin cannot render queue or case detail without System_Admin gate", () => {
  const queue = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/index.tsx"
  );
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  for (const source of [queue, detail]) {
    assert.match(source, /hasOfflineActivationRole/);
    assert.match(source, /System_Admin/);
    assert.match(source, /System Admin only/);
    assert.match(source, /resolveSessionPlatformRole/);
    assert.doesNotMatch(source, /x-kristo-role["']\s*:\s*["']System_Admin/);
  }
});

test("admin client uses deployed admin protection routes and session headers", () => {
  const api = read("apps/mobile/src/lib/sokoProtectionAdminApi.ts");
  assert.match(api, /\/api\/soko\/admin\/protection\/cases/);
  assert.match(api, /\/action/);
  assert.match(api, /getKristoHeaders/);
  assert.doesNotMatch(api, /buyer\/protection\/admin/);
  assert.match(api, /An admin note is required/);
});

test("admin actions are limited by server transition state", () => {
  assert.deepEqual(adminActionsForState("evidence_review"), [
    "request_evidence",
    "recommend_resolution",
    "close_case",
  ]);
  assert.deepEqual(adminActionsForState("resolution_recommended"), [
    "mark_external_refund_pending",
    "close_case",
  ]);
  assert.deepEqual(adminActionsForState("refund_external_pending"), [
    "report_external_refund_logged",
    "close_case",
  ]);
  assert.deepEqual(adminActionsForState("awaiting_seller_response"), []);
  assert.deepEqual(adminActionsForState("case_closed"), []);
});

test("buyer and seller cannot access admin actions from this UI surface", () => {
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  assert.match(detail, /adminActionsForState/);
  assert.match(detail, /postAdminProtectionAction/);
  assert.doesNotMatch(detail, /role:\s*["']buyer["']/);
  assert.doesNotMatch(detail, /role:\s*["']seller["']/);
  assert.match(detail, /hasOfflineActivationRole\(platformRole \|\| "", "System_Admin"\)/);
});

test("duplicate action submission is blocked with an action lock", () => {
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  assert.match(detail, /actionLock/);
  assert.match(detail, /actionPending/);
  assert.match(detail, /if \(actionLock\.current \|\| actionPending\) return/);
});

test("evidence from unrelated cases is never shown", () => {
  assert.equal(
    evidenceBelongsToCase({ caseId: "sokoprot_a" }, "sokoprot_a"),
    true
  );
  assert.equal(
    evidenceBelongsToCase({ caseId: "sokoprot_b" }, "sokoprot_a"),
    false
  );
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  assert.match(detail, /evidenceBelongsToCase/);
});

test("frozen snapshot remains read-only in admin UI", () => {
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  assert.match(detail, /Frozen product snapshot/);
  assert.match(detail, /immutableSnapshotHash/);
  assert.match(detail, /cannot edit the frozen snapshot/);
  assert.doesNotMatch(detail, /immutableOrderSnapshot\s*=/);
  assert.doesNotMatch(detail, /updateOrder|patchOrder|markPaid|createShipping/);
});

test("timeline remains chronological", () => {
  const sorted = sortProtectionEventsChronologically([
    { createdAt: "2026-09-15T16:09:03.000Z", id: "c" },
    { createdAt: "2026-09-15T16:09:00.000Z", id: "a" },
    { createdAt: "2026-09-15T16:09:00.500Z", id: "b" },
  ]);
  assert.deepEqual(
    sorted.map((row) => row.id),
    ["a", "b", "c"]
  );
});

test("honest payment and refund labels are mapped correctly", () => {
  assert.equal(
    paymentVerificationKindLabel("provider_verified"),
    "Provider-verified payment"
  );
  assert.equal(
    paymentVerificationKindLabel("seller_attested"),
    "Seller-attested payment"
  );
  assert.equal(paymentVerificationKindLabel("unverified"), "Payment not verified");
  assert.equal(
    paymentClaimLabelText("payment_not_approved"),
    "Payment not verified"
  );
  assert.equal(
    protectionAdminForbiddenLanguageHits(SOKO_PROTECTION_ADMIN_HONEST_DISCLAIMER)
      .length,
    0
  );
  assert.ok(
    protectionAdminForbiddenLanguageHits("SOKO refunded the buyer via escrow")
      .length >= 2
  );
});

test("queue filters map to API state and overdue client filter", () => {
  assert.equal(filterToApiState("awaiting_seller"), "awaiting_seller_response");
  assert.equal(filterToApiState("external_refund_pending"), "refund_external_pending");
  assert.equal(filterToApiState("overdue"), null);
  const now = new Date("2026-09-16T12:00:00.000Z");
  const rows = [
    {
      id: "1",
      state: "awaiting_seller_response",
      sellerResponseDeadline: "2026-09-15T12:00:00.000Z",
    },
    {
      id: "2",
      state: "evidence_review",
      sellerResponseDeadline: "2026-09-15T12:00:00.000Z",
    },
  ];
  assert.equal(
    isSellerResponseOverdue({
      state: rows[0].state,
      sellerResponseDeadline: rows[0].sellerResponseDeadline,
      now,
    }),
    true
  );
  assert.equal(
    isSellerResponseOverdue({
      state: rows[1].state,
      sellerResponseDeadline: rows[1].sellerResponseDeadline,
      now,
    }),
    false
  );
  assert.deepEqual(
    filterAdminQueueRows(rows, "overdue", now).map((row) => row.id),
    ["1"]
  );
});

test("frozen product title helper reads snapshot product fields", () => {
  assert.equal(
    frozenProductTitle({
      product: { title: "SOKO PROTECTION TEST — DO NOT PURCHASE" },
    }),
    "SOKO PROTECTION TEST — DO NOT PURCHASE"
  );
});

test("admin UI sources avoid forbidden payout claims and order mutation", () => {
  const scanFiles = UI_FILES.filter(
    (file) => !file.endsWith("sokoProtectionAdminLabels.ts")
  );
  for (const file of scanFiles) {
    const source = read(file);
    assert.equal(
      protectionAdminForbiddenLanguageHits(source).length,
      0,
      file
    );
    assert.doesNotMatch(source, /guaranteed refund/i);
    assert.doesNotMatch(source, /\bescrow\b/i);
    assert.doesNotMatch(source, /SOKO refunded/i);
  }
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  assert.match(detail, /does not move funds/);
  assert.match(detail, /Confirm admin action/);
});

test("honest labels use Evidence under review and Order at case opening", () => {
  assert.equal(protectionCaseStateLabel("evidence_review"), "Evidence under review");
  assert.equal(ORDER_AT_CASE_OPENING_LABEL, "Order at case opening");
  const queue = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/index.tsx"
  );
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  const labels = read("apps/mobile/src/lib/sokoProtectionAdminLabels.ts");
  assert.match(queue, /Evidence under review/);
  assert.match(queue, /ORDER_AT_CASE_OPENING_LABEL/);
  assert.doesNotMatch(queue, /Order at open:/);
  assert.doesNotMatch(queue, /Current order status/);
  assert.doesNotMatch(detail, /Order at open:/);
  assert.match(labels, /evidence_review: "Evidence under review"/);
  assert.doesNotMatch(labels, /evidence_review: "Evidence review"/);
});

test("frozen and live order statuses cannot silently substitute", () => {
  const snapshot = { orderStatusAtOpen: "awaiting_payment" };
  assert.equal(orderAtCaseOpeningDisplay(snapshot), "awaiting_payment");
  assert.equal(
    currentOrderStatusDisplay("payment_approved"),
    "payment_approved"
  );
  assert.equal(currentOrderStatusDisplay(null), CURRENT_ORDER_STATUS_UNAVAILABLE);
  assert.equal(currentOrderStatusDisplay(""), CURRENT_ORDER_STATUS_UNAVAILABLE);
  assert.equal(
    currentOrderStatusDisplay("   "),
    CURRENT_ORDER_STATUS_UNAVAILABLE
  );
  assert.notEqual(
    currentOrderStatusDisplay(null),
    orderAtCaseOpeningDisplay(snapshot)
  );

  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  const queue = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/index.tsx"
  );
  assert.match(detail, /orderAtCaseOpeningDisplay\(row\.immutableOrderSnapshot\)/);
  assert.match(detail, /currentOrderStatusDisplay\(row\.liveOrderStatus\)/);
  assert.doesNotMatch(
    detail,
    /liveOrderStatus \|\| .*immutableOrderSnapshot|immutableOrderSnapshot.*liveOrderStatus \|\|/
  );
  assert.match(queue, /orderAtCaseOpeningDisplay\(row\.immutableOrderSnapshot\)/);
  assert.doesNotMatch(queue, /liveOrderStatus/);
});

test("Confirm is disabled and submit rejects empty or whitespace notes", () => {
  assert.equal(canConfirmAdminNote(""), false);
  assert.equal(canConfirmAdminNote("   "), false);
  assert.equal(canConfirmAdminNote(" note "), true);
  assert.throws(() => requireAdminActionNote(""), /admin note is required/i);
  assert.throws(() => requireAdminActionNote(" \n\t "), /admin note is required/i);
  assert.equal(requireAdminActionNote("  keep this  "), "keep this");

  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  assert.match(detail, /disabled=\{actionPending \|\| !canConfirmAdminNote\(note\)\}/);
  assert.match(detail, /requireAdminActionNote\(note\)/);
  assert.match(detail, /actionLock\.current \|\| actionPending/);
  assert.match(detail, /An admin note is required/);
});

test("stale responses are discarded via load sequence tokens", () => {
  const queue = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/index.tsx"
  );
  const detail = read(
    "apps/mobile/app/(tabs)/more/system-admin/buyer-protection/[caseId].tsx"
  );
  assert.match(queue, /loadSeq/);
  assert.match(detail, /loadSeq/);
  assert.match(queue, /seq !== loadSeq\.current/);
  assert.match(detail, /seq !== loadSeq\.current/);
});
