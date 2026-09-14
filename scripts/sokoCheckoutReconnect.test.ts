import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

import {
  checkoutAfterReconnectCancelled,
  checkoutAfterSessionRenewed,
  checkoutAuthLifecycleEvent,
  checkoutAuthPresentation,
  checkoutDeliveryRecoveryActions,
  checkoutRequestAllowedWhileReconnecting,
  classifyCheckoutDeliveryFailure,
  CHECKOUT_AUTH_MISMATCH_MESSAGE,
  CHECKOUT_REAUTH_CANCELLED_MESSAGE,
  KRISTO_SESSION_REISSUE_MESSAGE,
  evaluateSessionRenewal,
  homeCheckoutUnauthorizedOutcome,
  isLiveCheckoutUnauthorized,
  isUnverifiableCheckoutToken,
  logCheckoutAuthEvent,
  logCheckoutReauthSubmitEvent,
  restoreCheckoutDraft,
  sellerAccessAllowedFor,
  shouldProbeCheckoutProfileSession,
  snapshotCheckoutDraft,
  SOKO_SESSION_EXPIRED_MESSAGE,
} from "../apps/mobile/src/lib/sokoCheckoutReconnect.ts";
import {
  getKristoLoginValidationError,
  getLoginIdentifierValidationError,
  INCOMPLETE_EMAIL_MESSAGE,
  supportedKristoLoginIdentifierType,
} from "../apps/mobile/src/lib/kristoLoginValidation.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const draft = snapshotCheckoutDraft({
  productId: "prod-watch",
  quantity: 2,
  variant: "black-leather",
  paymentMethod: "cash_app",
  step: "choose_delivery",
  delivery: {
    fullName: "Amina Buyer",
    phone: "2145550101",
    country: "United States",
    state: "TX",
    city: "Dallas",
    streetAddress: "1200 Main St",
    apartment: "4B",
    postalCode: "75201",
    instructions: "Gate code 1122",
  },
});

test("expired session is classified separately from retryable delivery failures", () => {
  const live401 = {
    ok: false,
    error: "Unauthorized",
    status: 401,
    details: { hint: "You must be signed in." },
  };
  assert.equal(isLiveCheckoutUnauthorized(live401), true);
  assert.equal(classifyCheckoutDeliveryFailure(live401), "retryable");
  assert.equal(
    classifyCheckoutDeliveryFailure(new Error("Unauthorized")),
    "retryable"
  );
  assert.equal(
    classifyCheckoutDeliveryFailure(new Error(CHECKOUT_AUTH_MISMATCH_MESSAGE)),
    "retryable"
  );
  assert.equal(
    checkoutDeliveryRecoveryActions(
      classifyCheckoutDeliveryFailure(new Error(CHECKOUT_AUTH_MISMATCH_MESSAGE)),
      "home-checkout"
    ).primaryAction,
    "Retry"
  );
  assert.equal(
    checkoutDeliveryRecoveryActions(
      classifyCheckoutDeliveryFailure(new Error(CHECKOUT_AUTH_MISMATCH_MESSAGE)),
      "home-checkout"
    ).route,
    "none"
  );
  assert.equal(
    classifyCheckoutDeliveryFailure({
      status: 401,
      error: "Unauthorized",
      details: {
        hint: "You must be signed in.",
        code: "CHECKOUT_SESSION_EXPIRED",
      },
    }),
    "session_expired"
  );
  assert.equal(
    classifyCheckoutDeliveryFailure(new Error(SOKO_SESSION_EXPIRED_MESSAGE)),
    "session_expired"
  );
  assert.equal(
    classifyCheckoutDeliveryFailure({
      status: 401,
      error: "Unauthorized",
      details: {
        hint: "You must be signed in.",
        code: "CHECKOUT_UNAUTHENTICATED",
        reason: "bad-signature",
      },
    }),
    "session_expired"
  );
  assert.equal(
    classifyCheckoutDeliveryFailure(new Error(KRISTO_SESSION_REISSUE_MESSAGE)),
    "session_expired"
  );
  assert.equal(
    checkoutDeliveryRecoveryActions("session_expired", "home-checkout")
      .primaryAction,
    "Sign in again to continue checkout"
  );
  assert.equal(
    checkoutDeliveryRecoveryActions("session_expired", "home-checkout").route,
    "kristo-member-auth"
  );
  assert.equal(
    checkoutDeliveryRecoveryActions("session_expired", "home-checkout")
      .showRetry,
    false
  );
  assert.equal(
    checkoutDeliveryRecoveryActions("session_expired", "soko-standalone")
      .primaryAction,
    "Reconnect Kristo Account"
  );
  assert.equal(
    classifyCheckoutDeliveryFailure(new Error("Could not reach the server.")),
    "retryable"
  );
  assert.equal(checkoutDeliveryRecoveryActions("retryable").primaryAction, "Retry");
  assert.equal(checkoutDeliveryRecoveryActions("retryable").showRetry, true);
});

test("successful renewal restores checkout draft and reloads delivery quotes", () => {
  const outcome = checkoutAfterSessionRenewed({
    draft,
    blockedToken: "u_buyer:stale-token",
    nextToken: "u_buyer:fresh-token",
  });
  assert.equal(outcome.tokenChanged, true);
  assert.equal(outcome.shouldReloadDeliveryRates, true);
  assert.equal(outcome.stayOnStep, "choose_delivery");
  assert.deepEqual(outcome.restoreDraft, draft);
  assert.equal(outcome.restoreDraft?.delivery.apartment, "4B");
  assert.equal(outcome.restoreDraft?.delivery.instructions, "Gate code 1122");
  assert.equal(outcome.restoreDraft?.paymentMethod, "cash_app");
  assert.equal(outcome.restoreDraft?.quantity, 2);
  assert.equal(outcome.restoreDraft?.variant, "black-leather");
});

test("cancelled reauth keeps checkout draft and is non-destructive", () => {
  const outcome = checkoutAfterReconnectCancelled(draft, "home-checkout");
  assert.equal(outcome.shouldReloadDeliveryRates, false);
  assert.equal(outcome.message, CHECKOUT_REAUTH_CANCELLED_MESSAGE);
  assert.deepEqual(outcome.restoreDraft, draft);
  assert.equal(restoreCheckoutDraft(draft)?.productId, "prod-watch");
});

test("stale-token requests are blocked while reconnecting", () => {
  assert.equal(checkoutRequestAllowedWhileReconnecting(true), false);
  assert.equal(checkoutRequestAllowedWhileReconnecting(false), true);
  const unchanged = evaluateSessionRenewal({
    blockedToken: "u_buyer:stale-token",
    nextToken: "u_buyer:stale-token",
  });
  assert.equal(unchanged.accepted, false);
  const renewed = evaluateSessionRenewal({
    blockedToken: "u_buyer:stale-token",
    nextToken: "u_buyer:fresh-token",
  });
  assert.equal(renewed.accepted, true);
});

test("Kristo buyer checkout never uses Seller Access, including seller-capable roles", () => {
  for (const role of ["Member", "Pastor", "Supervisor"]) {
    const flow = checkoutAuthPresentation({
      source: "home-checkout",
      role,
    });
    assert.equal(flow.route, "kristo-member-auth");
    assert.equal(flow.usesSellerAccess, false);
    assert.equal(flow.lifecycle, "reauth");
    assert.equal(flow.primaryAction, "Sign in again to continue checkout");
  }
  assert.equal(sellerAccessAllowedFor("buyer-checkout"), false);
  assert.equal(sellerAccessAllowedFor("seller-orders"), true);
  assert.equal(
    checkoutAuthPresentation({ source: "seller-orders", role: "Pastor" }).route,
    "seller-access"
  );
  assert.equal(
    checkoutAuthPresentation({ source: "soko-standalone", role: "Member" })
      .usesSellerAccess,
    false
  );
});

test("home checkout reauthenticates through Kristo member sign-in and keeps Retry for ordinary failures", () => {
  const home = read(
    "apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx"
  );
  const api = read("apps/mobile/src/lib/sokoCheckoutApi.ts");
  const helper = read("apps/mobile/src/lib/sokoCheckoutReconnect.ts");
  const login = read("apps/mobile/app/(auth)/login.tsx");
  assert.match(home, /beginCheckoutKristoReauthRef/);
  assert.match(home, /KRISTO_SESSION_REISSUE_MESSAGE/);
  assert.match(home, /setKristoCheckoutReauth\(true\)/);
  assert.match(home, /Sign in again to continue checkout/);
  assert.match(home, /beginCheckoutKristoReauth/);
  assert.match(home, /beginForcedCheckoutReauth/);
  assert.match(home, /cancelCheckoutKristoReauth/);
  assert.match(home, /renewKristoCheckoutSession/);
  assert.match(home, /CHECKOUT_REAUTH_CANCELLED_MESSAGE/);
  assert.match(home, /accessibilityLabel="Retry delivery rates"/);
  assert.match(home, /Your delivery details stay saved/);
  assert.match(home, /resumeDeliveryRatesOnceRef/);
  assert.match(home, /sessionExpiredRef/);
  assert.match(home, /DELIVERY_RATES_RESUMED|phase: "resumed"|\"resumed\"/);
  assert.match(home, /logCheckoutAuthEvent\("home-checkout","cancelled"/);
  assert.match(home, /sessionExpiredRef\.current=true/);
  assert.match(home, /setCheckoutOpen\(true\)/);
  assert.match(home, /\/api\/auth\/signin|renewKristoCheckoutSession/);
  assert.match(home, /Sign in with your Kristo email or phone/);
  assert.doesNotMatch(home, /phone or Kristo ID/);
  assert.match(login, /apiPost\("\/api\/auth\/signin"/);
  assert.match(login, /getLoginIdentifierValidationError/);
  assert.match(login, /kristoLoginValidation/);
  assert.doesNotMatch(login, /password\.length >= 8/);
  assert.doesNotMatch(home, /Reconnect Kristo Account/);
  assert.doesNotMatch(home, /setForceKristoSessionRenew/);
  assert.doesNotMatch(home, /setMorePage\("access"\)/);
  assert.doesNotMatch(home, /Seller Access/);
  assert.doesNotMatch(home, /soko-seller/);
  assert.match(api, /setCheckoutReconnecting/);
  assert.match(api, /quarantineRejectedCheckoutToken/);
  assert.match(api, /beginForcedCheckoutReauth/);
  assert.match(api, /trySilentCheckoutSessionRestore/);
  assert.match(api, /CHECKOUT_REAUTH_REQUIRED|phase: "required"|\"required\"/);
  assert.match(api, /logCheckoutAuthEvent\("home-checkout", "started"/);
  assert.match(api, /logCheckoutAuthEvent\("home-checkout", "succeeded"/);
  assert.match(api, /checkoutRequestAllowedWhileReconnecting/);
  assert.match(api, /evaluateSessionRenewal/);
  assert.match(api, /\/api\/auth\/signin/);
  assert.doesNotMatch(api, /CHECKOUT_RECONNECT_REQUIRED/);
  assert.doesNotMatch(api, /RECONNECT_STARTED/);
  assert.match(api, /CHECKOUT_AUTH_MISMATCH/);
  assert.match(api, /checkoutProfileSessionStillValid/);
  assert.match(api, /\/api\/auth\/profile/);
  assert.match(api, /KRISTO_SESSION_REISSUE_MESSAGE/);
  assert.match(api, /homeCheckoutUnauthorizedOutcome/);
  assert.match(api, /shouldProbeCheckoutProfileSession/);
  assert.match(helper, /CHECKOUT_AUTH_MISMATCH_MESSAGE/);
  assert.match(helper, /CHECKOUT_REAUTH_REQUIRED/);
  assert.match(helper, /homeCheckoutUnauthorizedOutcome/);
  assert.match(helper, /shouldProbeCheckoutProfileSession/);
  assert.match(helper, /isUnverifiableCheckoutToken/);
  assert.match(helper, /you must be signed in/);
  assert.match(api, /getKristoLoginValidationError/);
  assert.match(api, /REAUTH_SUBMIT_STARTED/);
  assert.match(api, /REAUTH_SIGNIN_RESPONSE/);
  assert.match(api, /REAUTH_SUBMIT_FAILED/);
  assert.doesNotMatch(api, /password\.length < 8/);
  assert.doesNotMatch(api, /Kristo ID and password/);
  assert.match(helper, /logCheckoutReauthSubmitEvent/);
  assert.doesNotMatch(
    api,
    /console\.(log|warn)\([^)]*sessionToken:/
  );
});

test("reauth logs never include token values and use Kristo checkout names", () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const original = console.log;
  console.log = (event: string, payload: Record<string, unknown>) => {
    logs.push({ event, payload });
  };
  try {
    logCheckoutAuthEvent("home-checkout", "required", {
      path: "/api/soko/delivery/rates",
      status: 401,
      reason: "expired_session",
      quarantined: true,
      hasSessionToken: true,
      hasUserId: true,
    });
    logCheckoutAuthEvent("home-checkout", "started", {
      quarantined: true,
      reason: "member_reauth",
    });
    logCheckoutAuthEvent("home-checkout", "succeeded", {
      tokenChanged: true,
      restoredDraft: true,
    });
    logCheckoutAuthEvent("home-checkout", "resumed", {
      once: true,
      tokenChanged: true,
    });
    logCheckoutAuthEvent("soko-standalone", "required", {
      path: "/api/soko/delivery/rates",
      status: 401,
      reason: "expired_session",
    });
    logCheckoutReauthSubmitEvent("REAUTH_SUBMIT_STARTED", {
      hasIdentifier: true,
      hasPassword: true,
    });
    logCheckoutReauthSubmitEvent("REAUTH_SIGNIN_RESPONSE", {
      status: 200,
      ok: true,
      hasUserId: true,
      hasSessionTokenKey: true,
      hasRole: true,
      hasChurchId: true,
    });
    logCheckoutReauthSubmitEvent("REAUTH_SUBMIT_FAILED", {
      reason: "validation",
      hasIdentifier: true,
      hasPassword: true,
    });
  } finally {
    console.log = original;
  }
  assert.deepEqual(
    logs.map((row) => row.event),
    [
      "CHECKOUT_REAUTH_REQUIRED",
      "REAUTH_STARTED",
      "REAUTH_SUCCEEDED",
      "DELIVERY_RATES_RESUMED",
      "CHECKOUT_RECONNECT_REQUIRED",
      "REAUTH_SUBMIT_STARTED",
      "REAUTH_SIGNIN_RESPONSE",
      "REAUTH_SUBMIT_FAILED",
    ]
  );
  assert.equal(
    checkoutAuthLifecycleEvent("home-checkout", "cancelled"),
    "REAUTH_CANCELLED"
  );
  assert.equal(
    checkoutAuthLifecycleEvent("soko-standalone", "started"),
    "RECONNECT_STARTED"
  );
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(
    serialized,
    /stale-token|fresh-token|sessionToken":"|password":"|identifier":"|email":"|phone":"/
  );
  assert.equal(logs[0].payload.status, 401);
  assert.equal(logs[0].payload.hasSessionToken, true);
  assert.equal(logs[0].payload.source, "home-checkout");
  assert.equal(logs[3].payload.once, true);
  assert.equal(logs[4].payload.source, "soko-standalone");
  assert.equal(logs[5].payload.hasPassword, true);
  assert.equal(logs[6].payload.ok, true);
  assert.equal(logs[6].payload.hasSessionTokenKey, true);
  assert.equal(logs[7].payload.reason, "validation");
});

test("known bad-signature checkout 401 requires reauth even if profile legacy fallback succeeds", () => {
  const productionRates = {
    ok: false,
    error: "Unauthorized",
    details: {
      code: "CHECKOUT_UNAUTHENTICATED",
      hint: "You must be signed in.",
      reason: "bad-signature",
    },
  };
  const kristoApiShaped = {
    ok: false,
    error: "Unauthorized",
    code: "CHECKOUT_UNAUTHENTICATED",
    reason: "http_error",
    status: 401,
    debug: {
      code: "CHECKOUT_UNAUTHENTICATED",
      hint: "You must be signed in.",
      reason: "bad-signature",
    },
  };
  const profileLegacyFallbackOk = true;

  for (const checkoutResult of [productionRates, kristoApiShaped]) {
    assert.equal(isUnverifiableCheckoutToken(checkoutResult), true);
    assert.equal(shouldProbeCheckoutProfileSession(checkoutResult), false);
    const outcome = homeCheckoutUnauthorizedOutcome({
      checkoutResult,
      profileFallbackOk: profileLegacyFallbackOk,
    });
    assert.equal(outcome.reauthRequired, true);
    assert.equal(outcome.probeProfile, false);
    assert.equal(outcome.mismatch, false);
    assert.equal(outcome.quarantined, true);
    assert.equal(outcome.event, "CHECKOUT_REAUTH_REQUIRED");
    assert.equal(outcome.throwMessage, KRISTO_SESSION_REISSUE_MESSAGE);
    assert.equal(outcome.reason, "bad-signature");
    assert.equal(
      classifyCheckoutDeliveryFailure(new Error(outcome.throwMessage)),
      "session_expired"
    );
  }

  const genericUnauthorized = {
    ok: false,
    error: "Unauthorized",
    status: 401,
    details: { hint: "You must be signed in." },
    reason: "http_error",
  };
  assert.equal(isUnverifiableCheckoutToken(genericUnauthorized), false);
  assert.equal(shouldProbeCheckoutProfileSession(genericUnauthorized), true);
  const mismatch = homeCheckoutUnauthorizedOutcome({
    checkoutResult: genericUnauthorized,
    profileFallbackOk: true,
  });
  assert.equal(mismatch.mismatch, true);
  assert.equal(mismatch.reauthRequired, false);
  assert.equal(mismatch.event, "CHECKOUT_AUTH_MISMATCH");
});

test("checkout reauth accepts existing short passwords and only email or phone identifiers", () => {
  const shortPassword = "pass7";
  assert.equal(shortPassword.length < 8, true);
  assert.equal(
    getKristoLoginValidationError("pastor@gmail.com", shortPassword),
    null
  );
  assert.equal(
    getKristoLoginValidationError("2145550101", shortPassword),
    null
  );
  assert.equal(
    supportedKristoLoginIdentifierType("pastor@gmail.com"),
    "email"
  );
  assert.equal(supportedKristoLoginIdentifierType("2145550101"), "phone");
  assert.equal(
    supportedKristoLoginIdentifierType("+1 (214) 555-0101"),
    "phone"
  );
  assert.equal(
    getLoginIdentifierValidationError("baealima131.com"),
    INCOMPLETE_EMAIL_MESSAGE
  );
  assert.equal(
    getKristoLoginValidationError("baealima131.com", shortPassword),
    INCOMPLETE_EMAIL_MESSAGE
  );
  assert.equal(
    supportedKristoLoginIdentifierType("KR7-DEMO1"),
    "invalid"
  );
  assert.equal(
    getKristoLoginValidationError("", shortPassword),
    "Enter your email or phone number."
  );
  assert.equal(
    getKristoLoginValidationError("pastor@gmail.com", ""),
    "Enter your password."
  );

  const api = read("apps/mobile/src/lib/sokoCheckoutApi.ts");
  const startedAt = api.indexOf('logCheckoutReauthSubmitEvent("REAUTH_SUBMIT_STARTED"');
  const fetchAt = api.indexOf('fetch(`${resolveApiBase()}/api/auth/signin`');
  assert.equal(startedAt > 0, true);
  assert.equal(fetchAt > startedAt, true);
  assert.doesNotMatch(api, /password\.length < 8/);
  assert.match(api, /getKristoLoginValidationError\(identifier, password\)/);
});

