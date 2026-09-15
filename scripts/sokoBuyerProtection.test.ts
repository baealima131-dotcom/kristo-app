/**
 * Stage 0 SOKO Buyer Protection — policy, snapshot, route, and source guards.
 *
 * Run: node --experimental-strip-types --test scripts/sokoBuyerProtection.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assertPartyCannotSetOutcome,
  canTransitionProtectionCase,
  classifyPaymentVerification,
  deadlineEscalationTarget,
  evaluateProtectionCaseEligibility,
  forbiddenHonestLanguagePatterns,
  initialStateForRequestType,
  listProtectionTransitions,
  parseOpenProtectionCaseBody,
  paymentClaimLabel,
  protectionBlocksOrderFulfillment,
  publicProtectionCaseLanguage,
  SOKO_PROTECTION_DEFAULT_ELIGIBILITY,
  SOKO_PROTECTION_ENFORCEMENT_OBSERVE,
  sokoProtectionEnforcementMode,
  stripProtectionClientSpoof,
} from "../app/api/_lib/sokoProtectionPolicy.ts";
import {
  buildImmutableProtectionOrderSnapshot,
  hashImmutableProtectionSnapshot,
} from "../app/api/_lib/sokoProtectionSnapshot.ts";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("enforcement defaults to observe and does not block fulfillment", () => {
  const previous = process.env.SOKO_PROTECTION_ENFORCEMENT;
  delete process.env.SOKO_PROTECTION_ENFORCEMENT;
  try {
    assert.equal(sokoProtectionEnforcementMode(), SOKO_PROTECTION_ENFORCEMENT_OBSERVE);
    assert.equal(protectionBlocksOrderFulfillment(), false);
  } finally {
    if (previous === undefined) delete process.env.SOKO_PROTECTION_ENFORCEMENT;
    else process.env.SOKO_PROTECTION_ENFORCEMENT = previous;
  }
});

test("open body parser ignores UI-spoofed party, money, product, and outcome fields", () => {
  const parsed = parseOpenProtectionCaseBody({
    orderId: "ord_1",
    requestType: "dispute",
    reasonCode: "item_not_received",
    description: "Never arrived",
    buyerUserId: "spoof_buyer",
    sellerUserId: "spoof_seller",
    amount: 999999,
    currency: "XYZ",
    productId: "spoof_product",
    paymentStatus: "payment_approved",
    deliveryState: "delivered",
    resolutionCode: "recommend_external_refund",
    outcome: "buyer_wins",
    state: "case_closed",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.orderId, "ord_1");
    assert.equal(parsed.requestType, "dispute");
    assert.equal(parsed.reasonCode, "item_not_received");
    assert.equal("buyerUserId" in parsed, false);
    assert.equal("amount" in parsed, false);
    assert.equal("resolutionCode" in parsed, false);
  }

  const stripped = stripProtectionClientSpoof({
    orderId: "ord_1",
    buyerId: "x",
    amount: 1,
    resolutionCode: "nope",
  });
  assert.equal(stripped.orderId, "ord_1");
  assert.equal("buyerId" in stripped, false);
  assert.equal("amount" in stripped, false);
  assert.equal("resolutionCode" in stripped, false);
});

test("buyer and seller cannot set outcomes or admin-close", () => {
  const buyer = assertPartyCannotSetOutcome({
    actorRole: "buyer",
    resolutionCode: "recommend_external_refund",
  });
  assert.equal(buyer.ok, false);
  if (buyer.ok === false) assert.equal(buyer.code, "outcome_forbidden");

  const seller = assertPartyCannotSetOutcome({
    actorRole: "seller",
    closeCase: true,
  });
  assert.equal(seller.ok, false);

  const refundClaim = assertPartyCannotSetOutcome({
    actorRole: "seller",
    markExternalRefundCompleted: true,
  });
  assert.equal(refundClaim.ok, false);

  const admin = assertPartyCannotSetOutcome({
    actorRole: "admin",
    resolutionCode: "recommend_external_refund",
  });
  assert.equal(admin.ok, true);
});

test("eligibility: cancellation before ship; return/dispute after payment approval", () => {
  assert.equal(
    evaluateProtectionCaseEligibility({
      requestType: "cancellation",
      orderStatus: "payment_approved",
    }).ok,
    true
  );
  assert.equal(
    evaluateProtectionCaseEligibility({
      requestType: "cancellation",
      orderStatus: "shipped",
    }).ok,
    false
  );
  assert.equal(
    evaluateProtectionCaseEligibility({
      requestType: "return",
      orderStatus: "awaiting_payment",
    }).ok,
    false
  );
  assert.equal(
    evaluateProtectionCaseEligibility({
      requestType: "dispute",
      orderStatus: "payment_approved",
    }).ok,
    true
  );

  const closed = evaluateProtectionCaseEligibility({
    requestType: "return",
    orderStatus: "delivered",
    deliveredAt: new Date(
      Date.now() -
        (SOKO_PROTECTION_DEFAULT_ELIGIBILITY.returnWindowDaysAfterDelivery + 2) *
          24 *
          60 *
          60 *
          1000
    ).toISOString(),
  });
  assert.equal(closed.ok, false);
  if (closed.ok === false) assert.equal(closed.code, "window_closed");
});

test("payment classification: provider vs seller attestation vs unverified", () => {
  assert.equal(
    classifyPaymentVerification({
      orderStatus: "payment_submitted",
      paymentMethod: "cash_app",
    }),
    "unverified"
  );
  assert.equal(
    classifyPaymentVerification({
      orderStatus: "payment_approved",
      paymentMethod: "cash_app",
      paymentProvider: "",
      providerPaymentId: "",
    }),
    "seller_attested"
  );
  assert.equal(
    classifyPaymentVerification({
      orderStatus: "payment_approved",
      paymentMethod: "cash_app",
      paymentProvider: "cash_app",
      providerPaymentId: "pay_123",
    }),
    "provider_verified"
  );
  assert.equal(
    classifyPaymentVerification({
      orderStatus: "payment_approved",
      paymentMethod: "stripe_card",
      paymentProvider: "stripe",
      providerPaymentId: "pi_123",
    }),
    "provider_verified"
  );
  assert.equal(
    paymentClaimLabel({
      orderStatus: "payment_submitted",
      verificationKind: "unverified",
    }),
    "payment_submitted_claim"
  );
  assert.equal(
    paymentClaimLabel({
      orderStatus: "payment_approved",
      verificationKind: "seller_attested",
    }),
    "seller_attested_payment"
  );
  assert.equal(
    paymentClaimLabel({
      orderStatus: "payment_approved",
      verificationKind: "provider_verified",
    }),
    "provider_verified_payment"
  );
});

test("state transition matrix and initial states", () => {
  assert.equal(initialStateForRequestType("cancellation"), "cancellation_requested");
  assert.equal(initialStateForRequestType("return"), "return_requested");
  assert.equal(initialStateForRequestType("dispute"), "dispute_opened");

  assert.equal(
    canTransitionProtectionCase({
      from: "dispute_opened",
      to: "awaiting_seller_response",
      actor: "system",
    }),
    true
  );
  assert.equal(
    canTransitionProtectionCase({
      from: "awaiting_seller_response",
      to: "evidence_review",
      actor: "seller",
    }),
    true
  );
  assert.equal(
    canTransitionProtectionCase({
      from: "awaiting_seller_response",
      to: "case_closed",
      actor: "seller",
    }),
    false
  );
  assert.equal(
    canTransitionProtectionCase({
      from: "evidence_review",
      to: "resolution_recommended",
      actor: "buyer",
    }),
    false
  );
  assert.equal(
    canTransitionProtectionCase({
      from: "evidence_review",
      to: "resolution_recommended",
      actor: "admin",
    }),
    true
  );
  assert.equal(
    canTransitionProtectionCase({
      from: "resolution_recommended",
      to: "refund_external_pending",
      actor: "admin",
    }),
    true
  );

  const transitions = listProtectionTransitions();
  assert.ok(transitions.length >= 10);
  assert.equal(
    transitions.some(
      (row) =>
        row.eventType === "seller_deadline_missed" &&
        row.to === "evidence_review"
    ),
    true
  );
  assert.equal(
    transitions.some((row) => /refund/i.test(row.to) && row.actor === "system"),
    false
  );
});

test("deadline escalation never auto-refunds", () => {
  const due = new Date(Date.now() - 60_000).toISOString();
  assert.equal(
    deadlineEscalationTarget({
      state: "awaiting_seller_response",
      sellerResponseDeadline: due,
    }),
    "evidence_review"
  );
  assert.equal(
    deadlineEscalationTarget({
      state: "awaiting_seller_response",
      sellerResponseDeadline: new Date(Date.now() + 60_000).toISOString(),
    }),
    null
  );
  assert.notEqual(
    deadlineEscalationTarget({
      state: "awaiting_seller_response",
      sellerResponseDeadline: due,
    }),
    "refund_external_pending"
  );
});

test("immutable snapshot hash is stable across shipping mutation of live order facts", () => {
  const baseline = {
    id: "ord_hash",
    productId: "prod_1",
    buyerUserId: "buyer_1",
    sellerUserId: "seller_1",
    paymentMethod: "cash_app",
    status: "payment_approved",
    snapshot: {
      title: "Watch",
      price: 120,
      currency: "USD",
      seller: { userId: "seller_1", name: "Sam" },
    },
    buyerNote: "",
    sellerNote: "",
    transactionReference: "ref-1",
    paymentProvider: "",
    providerPaymentId: "",
    providerReference: "",
    paymentDate: "2026-09-01T00:00:00.000Z",
    trackingNumber: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  const first = buildImmutableProtectionOrderSnapshot(baseline);
  const afterShippingMutation = buildImmutableProtectionOrderSnapshot({
    ...baseline,
    status: "shipped",
    trackingNumber: "1Z999",
    updatedAt: "2026-09-10T00:00:00.000Z",
    snapshot: {
      ...baseline.snapshot,
      shipping: { shippedAt: "2026-09-10T00:00:00.000Z", labelId: "lbl" },
    },
  });

  // Live order mutated — a newly frozen pack differs, which is expected at a
  // later open. The stored case hash must remain the original frozen pack.
  assert.equal(
    hashImmutableProtectionSnapshot(first.snapshot as Record<string, unknown>),
    first.hash
  );
  assert.notEqual(first.hash, afterShippingMutation.hash);

  // Deleted product cannot erase the frozen pack: product payload lives in case.
  const withoutLiveProduct = {
    ...first.snapshot,
    product: { ...(first.snapshot as any).product, title: "Watch" },
  };
  assert.equal(
    hashImmutableProtectionSnapshot(withoutLiveProduct as Record<string, unknown>),
    first.hash
  );
});

test("public language never claims escrow, guaranteed refund, or verified delivery", () => {
  const language = publicProtectionCaseLanguage({
    state: "resolution_recommended",
    paymentClaim: "seller_attested_payment",
    resolutionCode: "recommend_external_refund",
  });
  assert.equal(language.isEscrow, false);
  assert.equal(language.isGuaranteedRefund, false);
  assert.equal(language.isVerifiedDelivery, false);
  assert.equal(language.holdsBuyerFunds, false);
  assert.equal(language.resolutionNotice, "resolution_recommended");
  const blob = JSON.stringify(language);
  for (const pattern of forbiddenHonestLanguagePatterns()) {
    assert.equal(pattern.test(blob), false, String(pattern));
  }
});

test("routes use checkout auth for parties and System_Admin platform guard for admin", () => {
  const partyRoutes = [
    "app/api/soko/protection/cases/route.ts",
    "app/api/soko/protection/cases/[caseId]/route.ts",
    "app/api/soko/protection/cases/[caseId]/response/route.ts",
    "app/api/soko/protection/cases/[caseId]/evidence/route.ts",
  ];
  for (const file of partyRoutes) {
    const src = read(file);
    assert.match(src, /guardCheckoutAuth/);
    assert.doesNotMatch(src, /x-kristo-role|role header|headers\.get\(["']role/i);
  }

  const adminRoutes = [
    "app/api/soko/admin/protection/cases/route.ts",
    "app/api/soko/admin/protection/cases/[caseId]/route.ts",
    "app/api/soko/admin/protection/cases/[caseId]/action/route.ts",
  ];
  for (const file of adminRoutes) {
    const src = read(file);
    assert.match(src, /guardPlatformOfflineActivation/);
    assert.match(src, /System_Admin/);
    assert.doesNotMatch(src, /x-kristo-role/);
  }
});

test("schema is additive with open-case uniqueness and append-only events", () => {
  const db = read("app/api/_lib/store/sokoProtectionDb.ts");
  assert.match(db, /CREATE TABLE IF NOT EXISTS soko_protection_cases/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS soko_protection_case_events/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS soko_protection_evidence/);
  assert.match(
    db,
    /soko_protection_cases_open_type_uidx[\s\S]*WHERE closed_at IS NULL/
  );
  assert.match(db, /soko_protection_cases_buyer_idx/);
  assert.match(db, /soko_protection_cases_seller_idx/);
  assert.match(db, /soko_protection_cases_admin_queue_idx/);
  assert.doesNotMatch(db, /DELETE FROM soko_protection_case_events/);
  assert.doesNotMatch(db, /UPDATE soko_protection_case_events/);
  assert.match(db, /Only the buyer on this order can open/);
  assert.match(db, /ignoredClientBuyerId/);
  assert.match(db, /proof_base64/);
  assert.match(db, /Intentionally omit proof_base64/);
  assert.match(db, /autoRefund: false/);
  assert.match(db, /fundsMovedBySoko: false/);
  assert.match(db, /unique|duplicate/i);
});

test("confirm-delivery is intentionally omitted from protection routes", () => {
  const protectionRoot = path.join(root, "app/api/soko/protection");
  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walk(full));
      else files.push(full);
    }
    return files;
  };
  const files = walk(protectionRoot).map((file) =>
    path.relative(root, file)
  );
  assert.equal(
    files.some((file) => file.includes("confirm-delivery")),
    false
  );
  const orders = read("app/api/soko/orders/route.ts");
  assert.match(orders, /updateSokoOrder/);
  const ordersDb = read("app/api/_lib/store/sokoOrdersDb.ts");
  assert.match(ordersDb, /mark_delivered/);
});

test("existing order status machine is untouched by protection schema", () => {
  const ordersDb = read("app/api/_lib/store/sokoOrdersDb.ts");
  assert.match(ordersDb, /awaiting_payment/);
  assert.match(ordersDb, /payment_approved/);
  assert.doesNotMatch(ordersDb, /dispute_opened|refund_external_pending/);
  assert.doesNotMatch(
    read("app/api/_lib/store/sokoProtectionDb.ts"),
    /ALTER TABLE soko_orders/
  );
});

test("honest language strings are present in public case views", () => {
  const language = publicProtectionCaseLanguage({
    state: "refund_external_pending",
    paymentClaim: "provider_verified_payment",
    resolutionCode: "recommend_external_refund",
  });
  assert.match(language.summary, /does not hold buyer funds/i);
  assert.match(language.summary, /does not process refunds/i);
  assert.equal(language.resolutionNotice, "external_refund_pending");
  assert.doesNotMatch(language.summary, /SOKO refunded/i);
  assert.doesNotMatch(language.summary, /guaranteed refund/i);
  assert.doesNotMatch(language.summary, /verified delivery/i);

  const db = read("app/api/_lib/store/sokoProtectionDb.ts");
  assert.match(db, /paymentClaim/);
  assert.match(db, /resolution_recommended|external_refund_pending/);
});
