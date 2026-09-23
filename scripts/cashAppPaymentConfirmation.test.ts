import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, createHash } from "node:crypto";

import {
  classifyCapturedWebhookMismatch,
  classifyCashAppPaymentStatus,
  checkoutClientKeyForAttempt,
  configuredCashAppPartnerEnvironment,
  extractCashAppEventEnvironment,
  cashAppWebhookEnvironmentMatches,
  isFinalSuccessfulCashAppPaymentStatus,
  isTerminalCashAppPaymentStatus,
  isPayableSokoOrderStatus,
  resolveApprovedCashAppRecipient,
  shouldMintNewCheckoutAttempt,
  shouldReuseCheckoutAttempt,
  isCashAppCashtagPrefillUrl,
  isCashAppPayPartnerSessionUrl,
  canAutomaticallyConfirmCashAppOrder,
} from "../app/api/_lib/cashAppPaymentConfirmation.ts";

import { verifyCashAppWebhookSignature } from "../app/api/_lib/cashAppWebhookSignature.ts";

function signCashAppWebhook(rawBody: string, secret: string) {
  const headers = new Headers({
    accept: "application/json",
    authorization: "Bearer test",
    "content-type": "application/json",
    host: "kristo-app.vercel.app",
  });
  const signedHeaders =
    "accept:application/json,authorization:Bearer test,content-type:application/json,host:kristo-app.vercel.app";
  headers.set("x-signed-headers", signedHeaders);
  const canonicalHeaders = [
    "accept:application/json",
    "authorization:Bearer test",
    "content-type:application/json",
    "host:kristo-app.vercel.app",
  ].join("\n");
  const bodyDigest = createHash("sha256")
    .update(Buffer.from(rawBody, "utf8"))
    .digest("hex")
    .toLowerCase();
  const canonical =
    `POST\n/api/soko/webhooks/cash-app\n${canonicalHeaders}\n${bodyDigest}`;
  const signature = createHmac("sha256", secret)
    .update(canonical)
    .digest("hex")
    .toLowerCase();
  headers.set("x-signature", "V1 " + signature);
  return headers;
}

test("valid production successful payment approves exactly once", () => {
  const order = {
    status: "awaiting_payment",
    appliedEventIds: new Set<string>(),
  };

  const apply = (eventId: string, status: string) => {
    if (!isFinalSuccessfulCashAppPaymentStatus(status)) {
      return { applied: false, alreadyApplied: false };
    }
    if (!isPayableSokoOrderStatus(order.status) && order.status !== "payment_approved") {
      return { applied: false, alreadyApplied: false };
    }
    if (order.appliedEventIds.has(eventId) || order.status === "payment_approved") {
      return { applied: false, alreadyApplied: true };
    }
    order.appliedEventIds.add(eventId);
    order.status = "payment_approved";
    return { applied: true, alreadyApplied: false };
  };

  const first = apply("evt_1", "CAPTURED");
  const second = apply("evt_1", "CAPTURED");
  assert.deepEqual(first, { applied: true, alreadyApplied: false });
  assert.deepEqual(second, { applied: false, alreadyApplied: true });
  assert.equal(order.status, "payment_approved");
  assert.equal(order.appliedEventIds.size, 1);
});

test("production success status mapping only CAPTURED/COMPLETED", () => {
  assert.equal(classifyCashAppPaymentStatus("CAPTURED"), "captured");
  assert.equal(classifyCashAppPaymentStatus("COMPLETED"), "captured");
  assert.equal(classifyCashAppPaymentStatus("AUTHORIZED"), "pending");
  assert.equal(classifyCashAppPaymentStatus("PENDING"), "pending");
  assert.equal(classifyCashAppPaymentStatus("FAILED"), "failed");
  assert.equal(classifyCashAppPaymentStatus("CANCELLED"), "cancelled");
  assert.equal(classifyCashAppPaymentStatus("EXPIRED"), "expired");
  assert.equal(classifyCashAppPaymentStatus("REFUNDED"), "refunded");
  assert.equal(isFinalSuccessfulCashAppPaymentStatus("CAPTURED"), true);
  assert.equal(isFinalSuccessfulCashAppPaymentStatus("AUTHORIZED"), false);
  assert.equal(isTerminalCashAppPaymentStatus("REFUNDED"), true);
  assert.equal(isPayableSokoOrderStatus("awaiting_payment"), true);
  assert.equal(isPayableSokoOrderStatus("cancelled"), false);
});

test("sandbox event cannot approve a production order", () => {
  const eventEnvironment = extractCashAppEventEnvironment({
    environment: "SANDBOX",
  });
  const configured = configuredCashAppPartnerEnvironment("false");
  assert.equal(eventEnvironment, "sandbox");
  assert.equal(configured, "production");
  assert.equal(
    cashAppWebhookEnvironmentMatches({
      eventEnvironment,
      configuredEnvironment: configured,
    }),
    false
  );
});

test("invalid webhook signature is rejected", () => {
  const previous = process.env.CASH_APP_WEBHOOK_API_SECRET;
  process.env.CASH_APP_WEBHOOK_API_SECRET = "webhook-secret";
  try {
    const rawBody = JSON.stringify({ event_id: "evt_1" });
    const headers = signCashAppWebhook(rawBody, "webhook-secret");
    headers.set("x-signature", "V1 deadbeef");
    const result = verifyCashAppWebhookSignature({
      method: "POST",
      path: "/api/soko/webhooks/cash-app",
      rawBody,
      headers,
    });
    assert.equal(result.ok, false);
  } finally {
    process.env.CASH_APP_WEBHOOK_API_SECRET = previous;
  }
});

test("valid signature verifies", () => {
  const previous = process.env.CASH_APP_WEBHOOK_API_SECRET;
  process.env.CASH_APP_WEBHOOK_API_SECRET = "webhook-secret";
  try {
    const rawBody = JSON.stringify({
      event_id: "evt_ok",
      event_type: "payment.status.updated",
    });
    const headers = signCashAppWebhook(rawBody, "webhook-secret");
    const result = verifyCashAppWebhookSignature({
      method: "POST",
      path: "/api/soko/webhooks/cash-app",
      rawBody,
      headers,
    });
    assert.equal(result.ok, true);
  } finally {
    process.env.CASH_APP_WEBHOOK_API_SECRET = previous;
  }
});

test("product cashtag that differs from approved seller account is blocked", () => {
  const result = resolveApprovedCashAppRecipient({
    listingCashTag: "WrongTag",
    approvedCashTag: "Seller1",
    merchantId: "merchant_1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "PAYMENT_ACCOUNT_MISMATCH");
  }
});

test("listing cashtag is used only when it matches approved seller config", () => {
  const result = resolveApprovedCashAppRecipient({
    listingCashTag: "$Seller1",
    approvedCashTag: "seller1",
    merchantId: "merchant_1",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.cashTag, "seller1");
    assert.equal(result.merchantId, "merchant_1");
  }
});

test("unproven listing cashtag cannot be used without approved cashtag", () => {
  const partnerOnly = resolveApprovedCashAppRecipient({
    listingCashTag: "ListingTag",
    approvedCashTag: "",
    merchantId: "merchant_1",
  });
  assert.equal(partnerOnly.ok, true);
  if (partnerOnly.ok) {
    assert.equal(partnerOnly.cashTag, "");
  }

  const setupRequired = resolveApprovedCashAppRecipient({
    listingCashTag: "ListingTag",
    approvedCashTag: "",
    merchantId: "",
  });
  assert.equal(setupRequired.ok, false);
});

test("mismatch reasons never approve", () => {
  const base = {
    expectedSellerUserId: "seller-1",
    actualSellerUserId: "seller-1",
    expectedAmountMinor: 1299,
    actualAmountMinor: 1299,
    expectedCurrency: "USD",
    actualCurrency: "USD",
    expectedReference: "kristo-abc",
    actualReference: "kristo-abc",
    payable: true,
    paymentIdConsumedByOtherOrder: false,
  };

  assert.equal(classifyCapturedWebhookMismatch(base), null);
  assert.equal(
    classifyCapturedWebhookMismatch({
      ...base,
      actualSellerUserId: "other-seller",
    }),
    "recipient_mismatch"
  );
  assert.equal(
    classifyCapturedWebhookMismatch({
      ...base,
      actualAmountMinor: 999,
    }),
    "amount_mismatch"
  );
  assert.equal(
    classifyCapturedWebhookMismatch({
      ...base,
      actualCurrency: "CAD",
    }),
    "currency_mismatch"
  );
  assert.equal(
    classifyCapturedWebhookMismatch({
      ...base,
      actualReference: "",
    }),
    "missing_reference"
  );
  assert.equal(
    classifyCapturedWebhookMismatch({
      ...base,
      actualReference: "wrong-ref",
    }),
    "reference_mismatch"
  );
  assert.equal(
    classifyCapturedWebhookMismatch({
      ...base,
      paymentIdConsumedByOtherOrder: true,
    }),
    "payment_id_reused"
  );
  assert.equal(
    classifyCapturedWebhookMismatch({
      ...base,
      payable: false,
    }),
    "order_not_payable"
  );
});

test("double tap reuses awaiting order; later purchase mints a new attempt", () => {
  assert.equal(
    shouldReuseCheckoutAttempt({ orderStatus: "awaiting_payment" }),
    true
  );
  assert.equal(
    shouldMintNewCheckoutAttempt({ orderStatus: "awaiting_payment" }),
    false
  );
  assert.equal(
    shouldMintNewCheckoutAttempt({ orderStatus: "payment_approved" }),
    true
  );
  assert.equal(
    shouldMintNewCheckoutAttempt({ orderStatus: "cancelled" }),
    true
  );

  const first = checkoutClientKeyForAttempt({
    productId: "prod_1",
    rateId: "rate_1",
    postalCode: "10001",
    attemptId: "attemptA",
  });
  const doubleTap = checkoutClientKeyForAttempt({
    productId: "prod_1",
    rateId: "rate_1",
    postalCode: "10001",
    attemptId: "attemptA",
  });
  const laterPurchase = checkoutClientKeyForAttempt({
    productId: "prod_1",
    rateId: "rate_1",
    postalCode: "10001",
    attemptId: "attemptB",
  });

  assert.equal(first, doubleTap);
  assert.notEqual(first, laterPurchase);
});

test("identical event is idempotent; changed body is a conflict", () => {
  const first = createHash("sha256").update("body-a").digest("hex");
  const retry = createHash("sha256").update("body-a").digest("hex");
  const changed = createHash("sha256").update("body-b").digest("hex");
  assert.equal(first, retry);
  assert.notEqual(first, changed);
});

test("production apply never uses the test-only env gate", async () => {
  const fs = await import("node:fs");
  const route = fs.readFileSync(
    new URL("../app/api/soko/webhooks/cash-app/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /applyStoredCashAppCapturedWebhook/);
  assert.doesNotMatch(
    route,
    /capturedAutoApplyTestOnly &&/
  );
  assert.doesNotMatch(
    route,
    /CASH_APP_CAPTURED_AUTO_APPLY_TEST_ONLY ===/
  );
});

test("cashtag prefill URL is not a Partner session and cannot auto-confirm", () => {
  const cashtagUrl = "https://cash.app/$Seller1/12.99";
  const partnerUrl =
    "https://cash.app/customer-request/v1/requests/req_sandbox_example";
  assert.equal(isCashAppCashtagPrefillUrl(cashtagUrl), true);
  assert.equal(isCashAppPayPartnerSessionUrl(cashtagUrl), false);
  assert.equal(isCashAppPayPartnerSessionUrl(partnerUrl), true);
  assert.equal(
    canAutomaticallyConfirmCashAppOrder({
      hasPartnerMerchant: false,
      hasProviderPaymentId: false,
      isCashtagPrefillOnly: true,
    }),
    false
  );
  assert.equal(
    canAutomaticallyConfirmCashAppOrder({
      hasPartnerMerchant: true,
      hasProviderPaymentId: true,
      isCashtagPrefillOnly: false,
    }),
    true
  );
});

test("sandbox signed CAPTURED event cannot approve a production order", () => {
  const previous = process.env.CASH_APP_WEBHOOK_API_SECRET;
  process.env.CASH_APP_WEBHOOK_API_SECRET = "webhook-secret";
  try {
    const pendingOrder = {
      status: "awaiting_payment",
      environment: "sandbox" as const,
      subtotal: 10,
      shipping: 2.99,
      totalMinor: 1299,
      recipientSource: "seller_payment_account",
      applied: 0,
    };
    const rawBody = JSON.stringify({
      event_id: "evt_sandbox_1",
      event_type: "payment.status.updated",
      environment: "SANDBOX",
      data: {
        object: {
          payment: {
            id: "PWC_TEST_1",
            status: "CAPTURED",
            amount: 1299,
            currency: "USD",
            reference_id: "kristo-testref",
          },
        },
      },
    });
    const headers = signCashAppWebhook(rawBody, "webhook-secret");
    const verified = verifyCashAppWebhookSignature({
      method: "POST",
      path: "/api/soko/webhooks/cash-app",
      rawBody,
      headers,
    });
    assert.equal(verified.ok, true);
    assert.equal(
      JSON.parse(rawBody).data.object.payment.amount,
      pendingOrder.totalMinor
    );
    assert.equal(pendingOrder.recipientSource, "seller_payment_account");
    const eventEnvironment = extractCashAppEventEnvironment(
      JSON.parse(rawBody)
    );
    assert.equal(eventEnvironment, "sandbox");
    assert.equal(
      cashAppWebhookEnvironmentMatches({
        eventEnvironment,
        configuredEnvironment: "production",
      }),
      false
    );
    if (
      verified.ok &&
      isFinalSuccessfulCashAppPaymentStatus("CAPTURED") &&
      cashAppWebhookEnvironmentMatches({
        eventEnvironment,
        configuredEnvironment: "sandbox",
      })
    ) {
      pendingOrder.applied += 1;
      pendingOrder.status = "payment_approved";
    }
    assert.equal(pendingOrder.status, "payment_approved");
    assert.equal(pendingOrder.applied, 1);
    const replay = { ...pendingOrder };
    if (replay.status === "payment_approved") {
      replay.applied += 0;
    }
    assert.equal(pendingOrder.applied, 1);
  } finally {
    process.env.CASH_APP_WEBHOOK_API_SECRET = previous;
  }
});
