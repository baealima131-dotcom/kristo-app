import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

import {
  assertSokoStripeSellerGate,
  canApproveSokoStripePayment,
  eventModeMatchesSecret,
  isReusableStripePaymentIntentStatus,
  isTerminalFailedStripePaymentIntentStatus,
  opaqueBuyerReference,
  sokoStripeCardAvailableOnListing,
  stripeModeFromPublishableKey,
  stripeModeFromSecretKey,
  stripeModesMatch,
  stripePaymentIntentIdempotencyKey,
  toStripeAmountMinor,
} from "../app/api/_lib/sokoStripeCheckout.ts";
import { canReuseSokoShippingQuote } from "../app/api/_lib/sokoShippingQuotePolicy.ts";

const sellerId = "seller-1-example";
const buyerId = "buyer-9-example";

function approvalBase(overrides: Record<string, unknown> = {}) {
  return {
    orderStatus: "awaiting_payment",
    orderPaymentMethod: "stripe_card",
    orderProvider: "stripe",
    storedPaymentIntentId: "pi_123",
    eventPaymentIntentId: "pi_123",
    metadataOrderId: "order-1",
    orderId: "order-1",
    amountReceived: 2599,
    orderAmountMinor: 2599,
    eventCurrency: "usd",
    orderCurrency: "USD",
    orderSellerUserId: sellerId,
    allowedSellerUserId: sellerId,
    livemode: false,
    secretKey: "sk_test_example",
    paymentIntentAlreadyUsedOnOtherOrder: false,
    ...overrides,
  };
}

test("existing Seller 1 listings expose Card without stripe in paymentOptions.methods", () => {
  const existingHandbag = sokoStripeCardAvailableOnListing({
    serverConfigured: true,
    sellerUserId: sellerId,
    productStatus: "Active",
    stockAvailable: 1,
    currency: "USD",
    allowedSellerUserId: sellerId,
  });
  const newSeller1Listing = sokoStripeCardAvailableOnListing({
    serverConfigured: true,
    sellerUserId: sellerId,
    productStatus: "Active",
    stockAvailable: 3,
    currency: "USD",
    allowedSellerUserId: sellerId,
  });
  const otherSeller = sokoStripeCardAvailableOnListing({
    serverConfigured: true,
    sellerUserId: "seller-2-example",
    productStatus: "Active",
    stockAvailable: 1,
    currency: "USD",
    allowedSellerUserId: sellerId,
  });
  const unconfigured = sokoStripeCardAvailableOnListing({
    serverConfigured: false,
    sellerUserId: sellerId,
    productStatus: "Active",
    currency: "USD",
    allowedSellerUserId: sellerId,
  });
  assert.equal(existingHandbag, true);
  assert.equal(newSeller1Listing, true);
  assert.equal(otherSeller, false);
  assert.equal(unconfigured, false);

  const products = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/store/sokoProductsDb.ts"),
    "utf8"
  );
  assert.match(products, /sokoStripeCardAvailableOnListing/);
  assert.match(products, /paymentOptions\.stripeCardAvailable/);
  assert.doesNotMatch(
    products.slice(products.indexOf("paymentOptions.stripeCardAvailable")),
    /methods\.includes\(["']stripe/
  );
  assert.match(
    products,
    /!methods\.length \|\| methods\.some\(m => !\["cash", "cash_app", "mobile_money"\]/
  );

  const access = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/seller/access/route.ts"),
    "utf8"
  );
  assert.match(access, /stripeCardAvailable/);
  assert.match(access, /sokoStripeCardAvailableOnListing/);

  const mobile = fs.readFileSync(
    path.join(
      process.cwd(),
      "apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx"
    ),
    "utf8"
  );
  assert.match(mobile, /stripeCardAvailable===true/);
  assert.match(mobile, /Buy with Card/);
  assert.match(mobile, /Card — Secured by Stripe/);
  assert.match(mobile, /openSecureCheckout\("stripe_card"\)/);
  assert.match(mobile, /openSecureCheckout\("cash_app"\)/);
  assert.match(mobile, /Buy with Cash App/);
  assert.doesNotMatch(mobile, /setCheckoutPaymentPhase\("paid"\)[\s\S]{0,120}initPaymentSheet/);
});

test("Seller 1 is accepted and a different seller is rejected", () => {
  const accepted = assertSokoStripeSellerGate({
    sellerUserId: sellerId,
    buyerUserId: buyerId,
    productStatus: "Active",
    currency: "USD",
    allowedSellerUserId: sellerId,
  });
  const rejected = assertSokoStripeSellerGate({
    sellerUserId: "someone-else",
    buyerUserId: buyerId,
    productStatus: "Active",
    currency: "USD",
    allowedSellerUserId: sellerId,
  });
  assert.equal(accepted.ok, true);
  assert.equal(rejected.ok, false);
  assert.equal(
    rejected.ok === false && rejected.code,
    "STRIPE_SELLER_NOT_ALLOWED"
  );
});

test("buyer cannot buy own product", () => {
  const result = assertSokoStripeSellerGate({
    sellerUserId: sellerId,
    buyerUserId: sellerId,
    productStatus: "Active",
    currency: "USD",
    allowedSellerUserId: sellerId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "STRIPE_OWN_PRODUCT");
});

test("recent server shipping quotes can be reused only for the same checkout", () => {
  const now = 1_700_000_000_000;
  const base = {
    rateId: "rate_abc",
    shipmentId: "ship_abc",
    buyerUserId: buyerId,
    productId: "soko-handbag",
    addressFp: "addr-fp",
    originFp: "origin-fp",
    amount: 5.99,
    currency: "USD",
    provider: "USPS",
    service: "Priority",
    estimatedDays: 2,
    fulfillmentType: "parcel",
    expiresAtMs: now + 60_000,
  };
  const reused = canReuseSokoShippingQuote({
    quote: base,
    nowMs: now,
    buyerUserId: buyerId,
    productId: "soko-handbag",
    rateId: "rate_abc",
    shipmentId: "ship_abc",
    addressFp: "addr-fp",
    originFp: "origin-fp",
  });
  assert.equal(reused.ok, true);
  if (reused.ok) assert.equal(reused.quote.amount, 5.99);

  assert.equal(
    canReuseSokoShippingQuote({
      quote: base,
      nowMs: now,
      buyerUserId: "other-buyer",
      productId: "soko-handbag",
      rateId: "rate_abc",
      shipmentId: "ship_abc",
      addressFp: "addr-fp",
      originFp: "origin-fp",
    }).ok,
    false
  );
  assert.equal(
    canReuseSokoShippingQuote({
      quote: { ...base, expiresAtMs: now - 1 },
      nowMs: now,
      buyerUserId: buyerId,
      productId: "soko-handbag",
      rateId: "rate_abc",
      shipmentId: "ship_abc",
      addressFp: "addr-fp",
      originFp: "origin-fp",
    }).ok,
    false
  );
  assert.equal(
    canReuseSokoShippingQuote({
      quote: { ...base, amount: 0 },
      nowMs: now,
      buyerUserId: buyerId,
      productId: "soko-handbag",
      rateId: "rate_abc",
      shipmentId: "ship_abc",
      addressFp: "addr-fp",
      originFp: "origin-fp",
    }).ok,
    false
  );

  const ordersDb = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/store/sokoOrdersDb.ts"),
    "utf8"
  );
  assert.match(ordersDb, /__kristoSokoOrdersSchema/);
  assert.match(ordersDb, /ensureSokoOrdersSchema/);
  assert.match(ordersDb, /getSokoNeonSql/);
  const ordersRoute = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/orders/route.ts"),
    "utf8"
  );
  assert.match(ordersRoute, /timer\.stage\("auth"\)/);
  assert.match(ordersRoute, /timer\.stage\("body"\)/);
  assert.match(ordersRoute, /timer\.stage\("createSokoOrder"\)/);
  const neonHelper = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/store/sokoNeon.ts"),
    "utf8"
  );
  assert.match(neonHelper, /__kristoSokoNeon/);
  const ratesRoute = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/delivery/rates/route.ts"),
    "utf8"
  );
  assert.match(ratesRoute, /ensureSokoOrdersSchema/);
  assert.match(ratesRoute, /guardCheckoutAuth/);
  assert.match(ordersRoute, /guardCheckoutAuth/);
  const paymentIntentRoute = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/payments/stripe/payment-intent/route.ts"),
    "utf8"
  );
  assert.match(paymentIntentRoute, /guardCheckoutAuth/);
  assert.doesNotMatch(paymentIntentRoute, /guardAuth\(/);
  const rbac = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/rbac.ts"),
    "utf8"
  );
  assert.match(rbac, /getCheckoutViewer/);
  assert.match(rbac, /assertSafetyEnforcementAllows/);
  assert.match(rbac, /KRISTO_GUARD_AUTH_TIMING/);
  const safetyDb = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/store/safetyReportDb.ts"),
    "utf8"
  );
  assert.match(safetyDb, /__kristoSafetyEnforcementSchema/);
  assert.match(safetyDb, /__kristoSafetyNeon/);

  const orders = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/store/sokoOrdersDb.ts"),
    "utf8"
  );
  assert.match(orders, /findReusableSokoShippingQuote/);
  assert.match(orders, /verifyShippoParcelRate/);
  assert.doesNotMatch(
    orders.slice(orders.indexOf("export async function createSokoOrder")),
    /selection\.amount|deliverySelection\.amount|clientAmount/
  );
  const rates = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/delivery/rates/route.ts"),
    "utf8"
  );
  assert.match(rates, /saveSokoShippingQuotes/);
  assert.match(rates, /listReusableSokoShippingQuotes/);
  const intent = fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/soko/payments/stripe/payment-intent/route.ts"
    ),
    "utf8"
  );
  assert.match(intent, /alreadyBound/);
  assert.match(intent, /stripePaymentIntentIdempotencyKey/);
  assert.match(intent, /KRISTO_SOKO_CHECKOUT_TIMING|sokoCheckoutTimer/);
  assert.match(intent, /timer\.stage\("auth"\)/);
  const mobile = fs.readFileSync(
    path.join(
      process.cwd(),
      "apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx"
    ),
    "utf8"
  );
  assert.match(mobile, /Verifying delivery/);
  assert.match(mobile, /Creating secure order/);
  assert.match(mobile, /Opening card payment/);
  assert.doesNotMatch(
    mobile,
    /setCheckoutPaymentPhase\("paid"\)[\s\S]{0,80}presentPaymentSheet/
  );
});

test("server shipping revalidation and client amount are not trusted", () => {
  const orders = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/store/sokoOrdersDb.ts"),
    "utf8"
  );
  assert.match(orders, /verifiedDelivery/);
  assert.match(orders, /SOKO_STRIPE_PAYMENT_METHOD/);
  assert.match(orders, /assertSokoStripeSellerGate/);
  assert.doesNotMatch(
    orders.slice(orders.indexOf("export async function createSokoOrder")),
    /body\.amount|clientAmount|authoritativeAmount/
  );
  const itemPrice = 20;
  const deliveryPrice = 5.99;
  const clientAmount = 1;
  const authoritative = toStripeAmountMinor(itemPrice + deliveryPrice, "USD");
  const ignored = toStripeAmountMinor(clientAmount, "USD");
  assert.equal(authoritative, 2599);
  assert.notEqual(authoritative, ignored);
});

test("PaymentIntent idempotency key is stable per order", () => {
  assert.equal(
    stripePaymentIntentIdempotencyKey("order-1"),
    stripePaymentIntentIdempotencyKey("order-1")
  );
  assert.notEqual(
    stripePaymentIntentIdempotencyKey("order-1"),
    stripePaymentIntentIdempotencyKey("order-1", 1)
  );
});

test("invalid order ownership requires the authenticated buyer", () => {
  const intent = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/payments/stripe/payment-intent/route.ts"),
    "utf8"
  );
  assert.match(intent, /buyerUserId: auth\.viewer\.userId/);
  assert.match(intent, /getSokoStripePaymentContext/);
});

test("invalid webhook signature is rejected by the official Stripe SDK", () => {
  const stripe = new Stripe("sk_test_placeholder");
  assert.throws(() => {
    stripe.webhooks.constructEvent(
      JSON.stringify({ id: "evt_1" }),
      "t=1,v1=deadbeef",
      "whsec_test_secret"
    );
  });
});

test("valid Stripe test header verifies with the official SDK", () => {
  const payload = JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type: "payment_intent.succeeded",
  });
  const header = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_test_secret",
  });
  const event = Stripe.webhooks.constructEvent(
    payload,
    header,
    "whsec_test_secret"
  );
  assert.equal(event.id, "evt_test_1");
});

test("correct succeeded event approves exactly once", () => {
  const order = {
    status: "awaiting_payment",
    appliedEventIds: new Set<string>(),
  };

  const apply = (eventId: string) => {
    const decision = canApproveSokoStripePayment(approvalBase());
    if (!decision.ok) return { applied: false, alreadyApplied: false };
    if (order.appliedEventIds.has(eventId) || order.status === "payment_approved") {
      return { applied: false, alreadyApplied: true };
    }
    order.appliedEventIds.add(eventId);
    order.status = "payment_approved";
    return { applied: true, alreadyApplied: false };
  };

  const first = apply("evt_1");
  const second = apply("evt_1");
  assert.deepEqual(first, { applied: true, alreadyApplied: false });
  assert.deepEqual(second, { applied: false, alreadyApplied: true });
  assert.equal(order.status, "payment_approved");
});

test("wrong amount is rejected", () => {
  const decision = canApproveSokoStripePayment(
    approvalBase({ amountReceived: 1 })
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.code, "STRIPE_AMOUNT_MISMATCH");
});

test("wrong currency is rejected", () => {
  const decision = canApproveSokoStripePayment(
    approvalBase({ eventCurrency: "eur" })
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.code, "STRIPE_CURRENCY_MISMATCH");
});

test("wrong PaymentIntent ID is rejected", () => {
  const decision = canApproveSokoStripePayment(
    approvalBase({ eventPaymentIntentId: "pi_other" })
  );
  assert.equal(decision.ok, false);
  assert.equal(
    decision.ok === false && decision.code,
    "STRIPE_PAYMENT_INTENT_MISMATCH"
  );
});

test("reused PaymentIntent on another order is rejected", () => {
  const decision = canApproveSokoStripePayment(
    approvalBase({ paymentIntentAlreadyUsedOnOtherOrder: true })
  );
  assert.equal(decision.ok, false);
  assert.equal(
    decision.ok === false && decision.code,
    "STRIPE_PAYMENT_INTENT_REUSED"
  );
});

test("duplicate already-approved webhook does not approve again", () => {
  const decision = canApproveSokoStripePayment(
    approvalBase({ orderStatus: "payment_approved" })
  );
  assert.equal(decision.ok, false);
  assert.equal(
    decision.ok === false && "alreadyApproved" in decision && decision.alreadyApproved,
    true
  );
});

test("failed and canceled PaymentIntents never approve", () => {
  assert.equal(isTerminalFailedStripePaymentIntentStatus("canceled"), true);
  assert.equal(isReusableStripePaymentIntentStatus("requires_payment_method"), true);
  const failedOrder = canApproveSokoStripePayment(
    approvalBase({ orderStatus: "payment_rejected" })
  );
  assert.equal(failedOrder.ok, false);
});

test("test/live mismatch is rejected", () => {
  assert.equal(eventModeMatchesSecret(true, "sk_test_example"), false);
  assert.equal(eventModeMatchesSecret(false, "sk_test_example"), true);
  assert.equal(stripeModesMatch("pk_test_x", "sk_live_x"), false);
  assert.equal(stripeModeFromPublishableKey("pk_test_x"), "test");
  assert.equal(stripeModeFromSecretKey("sk_live_x"), "live");
  const decision = canApproveSokoStripePayment(
    approvalBase({ livemode: true, secretKey: "sk_test_example" })
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.code, "STRIPE_MODE_MISMATCH");
});

test("opaque buyer metadata is not the raw user id", () => {
  const ref = opaqueBuyerReference(buyerId);
  assert.equal(ref.includes(buyerId), false);
  assert.equal(ref.length, 24);
});

test("PaymentSheet success without webhook remains awaiting_payment in source", () => {
  const root = process.cwd();
  const mobile = fs.readFileSync(
    path.join(root, "apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx"),
    "utf8"
  );
  const webhook = fs.readFileSync(
    path.join(root, "app/api/soko/webhooks/stripe/route.ts"),
    "utf8"
  );
  const intent = fs.readFileSync(
    path.join(root, "app/api/soko/payments/stripe/payment-intent/route.ts"),
    "utf8"
  );
  assert.match(mobile, /presentPaymentSheet/);
  assert.match(mobile, /Confirming payment/);
  assert.match(mobile, /Payment was cancelled\. The order is still unpaid/);
  assert.doesNotMatch(mobile, /setCheckoutPaymentPhase\("paid"\)[\s\S]{0,80}presentPaymentSheet/);
  assert.match(webhook, /verifyStripeWebhookEvent/);
  assert.match(webhook, /applySokoStripeCapturedPaymentToOrder/);
  assert.match(intent, /body\.orderId/);
  assert.doesNotMatch(intent, /body\.amount/);
  assert.match(intent, /payment_method_types: \["card"\]/);
  assert.doesNotMatch(intent, /apple_pay/);
  assert.doesNotMatch(intent, /google_pay/);
});

test("Cash App confirmation files were not edited by this Stripe checkout path", () => {
  const confirmation = fs.readFileSync(
    path.join(rootFromCwd(), "app/api/_lib/cashAppPaymentConfirmation.ts"),
    "utf8"
  );
  assert.match(confirmation, /isFinalSuccessfulCashAppPaymentStatus/);
});

function rootFromCwd() {
  return process.cwd();
}
