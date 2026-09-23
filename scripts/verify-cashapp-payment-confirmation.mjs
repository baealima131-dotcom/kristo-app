import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const webhook = read("app/api/soko/webhooks/cash-app/route.ts");
const boundary = read("app/api/_lib/cashAppCapturedPaymentBoundary.ts");
const orders = read("app/api/_lib/store/sokoOrdersDb.ts");
const mobile = read(
  "apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx"
);

test("production captured apply is not behind the test-only gate", () => {
  assert.match(webhook, /applyStoredCashAppCapturedWebhook/);
  assert.doesNotMatch(webhook, /capturedAutoApplyTestOnly/);
  assert.doesNotMatch(
    webhook,
    /CASH_APP_CAPTURED_AUTO_APPLY_TEST_ONLY ===/
  );
  assert.match(webhook, /KRISTO_SOKO_CASHAPP_CAPTURED_APPLIED/);
});

test("recipient is resolved from seller payment configuration", () => {
  assert.match(orders, /resolveApprovedCashAppRecipient/);
  assert.match(orders, /SokoPaymentAccountMismatchError/);
  assert.match(orders, /dbGetVerifiedSellerPaymentMerchant/);
});

test("checkout attempt id is stable across taps and minted on open", () => {
  assert.match(mobile, /checkoutAttemptIdRef/);
  assert.match(mobile, /newCheckoutAttemptId/);
  assert.doesNotMatch(
    mobile,
    /checkoutClientKey\([^)]*Date\.now\(\)/
  );
});

test("cashtag fallback is blocked in checkout launch", () => {
  assert.match(mobile, /Cash App checkout is not available yet/);
  assert.doesNotMatch(mobile, /buildPrefillCashAppPayUrl/);
  assert.match(mobile, /isCashAppCashtagPrefillPath/);
  assert.match(mobile, /checkoutPollTicksRef/);
});

test("webhook is deployable: raw body, signature first, 2xx duplicate", () => {
  assert.match(webhook, /const rawBody = await req\.text\(\)/);
  assert.match(webhook, /verifyCashAppWebhookSignature/);
  const signatureIndex = webhook.indexOf("verifyCashAppWebhookSignature");
  const parseIndex = webhook.indexOf("JSON.parse(rawBody)");
  assert.ok(signatureIndex > 0 && parseIndex > signatureIndex);
  assert.match(webhook, /environment_mismatch/);
  assert.match(webhook, /duplicatePayloadConflict/);
  assert.match(webhook, /received: true/);
});

test("atomic captured transition writes payment_approved", () => {
  assert.match(boundary, /applyCashAppCapturedPaymentToOrder/);
  assert.match(orders, /status = 'payment_approved'/);
  assert.match(orders, /payment_date = COALESCE\(payment_date, NOW\(\)\)/);
  assert.match(orders, /captureAudit/);
});
