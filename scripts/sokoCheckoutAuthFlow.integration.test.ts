import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  issueSessionToken,
  peekSessionTokenMeta,
  resolveCheckoutMobileIdentity,
  KRISTO_SESSION_TOKEN_ISSUER,
  KRISTO_SESSION_TOKEN_VERSION,
  verifySessionToken,
} from "../app/api/auth/_lib/sessionToken.ts";
import { setSessionSync, getSessionSync } from "../apps/mobile/src/lib/kristoSessionSync.ts";
import {
  getKristoLoginValidationError,
  supportedKristoLoginIdentifierType,
} from "../apps/mobile/src/lib/kristoLoginValidation.ts";
import {
  checkoutAfterSessionRenewed,
  checkoutAuthPresentation,
  checkoutRequestAllowedWhileReconnecting,
  evaluateSessionRenewal,
  homeCheckoutUnauthorizedOutcome,
  KRISTO_SESSION_REISSUE_MESSAGE,
  sellerAccessAllowedFor,
  shouldProbeCheckoutProfileSession,
  snapshotCheckoutDraft,
} from "../apps/mobile/src/lib/sokoCheckoutReconnect.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = "canonical-kristo-session-secret-32";
const uid = "u_996c19a3aad35819e9614ead1";
const SIGNIN_CONTRACT_KEYS = [
  "ok",
  "userId",
  "kristoId",
  "publicKristoId",
  "email",
  "phone",
  "sessionToken",
  "role",
  "churchId",
  "churchRole",
  "platformRole",
  "offlineActivationRole",
];

const PRODUCTION_RATES_401 = {
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

const draftSeed = {
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
};

function withSecret(run: () => void) {
  const previous = process.env.KRISTO_SESSION_SECRET;
  process.env.KRISTO_SESSION_SECRET = secret;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.KRISTO_SESSION_SECRET;
    else process.env.KRISTO_SESSION_SECRET = previous;
  }
}

function headerReq(headers: Record<string, string>) {
  return {
    headers: {
      get(key: string) {
        return headers[key.toLowerCase()] || headers[key] || null;
      },
    },
  };
}

type FlowSession = {
  userId: string;
  sessionToken: string;
  role: string;
  churchId: string;
  churchRole: string;
};

type FlowState = {
  reconnecting: boolean;
  reconnectingRef: boolean;
  kristoCheckoutReauth: boolean;
  sessionExpiredRef: boolean;
  resumeDeliveryRatesOnceRef: boolean;
  blockedToken: string;
  disk: string;
  reactSession: FlowSession | null;
  delivery: typeof draftSeed.delivery;
  checkoutDraftRef: ReturnType<typeof snapshotCheckoutDraft> | null;
  events: string[];
  rateCalls: Array<{ token: string; path: string }>;
  profileCalls: number;
  signinCalls: Array<{ identifier: string; passwordLength: number }>;
  sellerAccessOpened: boolean;
};

function persistSession(state: FlowState, session: FlowSession) {
  const next = { ...session };
  state.disk = JSON.stringify(next);
  setSessionSync(next as any);
  state.reactSession = next;
}

function restoreFromDisk(state: FlowState) {
  setSessionSync(null);
  state.reactSession = null;
  const parsed = JSON.parse(state.disk) as FlowSession;
  setSessionSync(parsed as any);
  state.reactSession = parsed;
  return parsed;
}

function sendRates(state: FlowState, ratesByToken: Map<string, any>) {
  if (!checkoutRequestAllowedWhileReconnecting(state.reconnectingRef)) {
    throw new Error("blocked_while_reconnecting");
  }
  if (state.sessionExpiredRef && !state.resumeDeliveryRatesOnceRef) {
    throw new Error("blocked_expired_without_resume");
  }
  const session = getSessionSync() as FlowSession | null;
  const userId = String(session?.userId || "").trim();
  const sessionToken = String(session?.sessionToken || "").trim();
  const tokenKey = `${userId}:${sessionToken}`;
  if (!checkoutRequestAllowedWhileReconnecting(state.reconnecting)) {
    throw new Error("blocked_module_reconnecting");
  }
  if (state.blockedToken && state.blockedToken === tokenKey) {
    throw new Error("blocked_quarantined_token");
  }
  if (state.blockedToken && state.blockedToken !== tokenKey) {
    state.blockedToken = "";
  }
  state.rateCalls.push({ token: sessionToken, path: "/api/soko/delivery/rates" });
  const result = ratesByToken.get(sessionToken) || PRODUCTION_RATES_401;
  if (Number(result.status || 0) === 401 || result.ok === false) {
    const canProbe = shouldProbeCheckoutProfileSession(result);
    if (canProbe) state.profileCalls += 1;
    const outcome = homeCheckoutUnauthorizedOutcome({
      checkoutResult: result,
      profileFallbackOk: canProbe,
    });
    if (outcome.mismatch) {
      state.events.push("CHECKOUT_AUTH_MISMATCH");
      throw new Error("mismatch");
    }
    state.blockedToken = tokenKey;
    state.events.push(outcome.event);
    if (outcome.throwMessage === KRISTO_SESSION_REISSUE_MESSAGE) {
      throw new Error(KRISTO_SESSION_REISSUE_MESSAGE);
    }
    throw new Error(String(outcome.throwMessage));
  }
  return result;
}

function beginReauth(state: FlowState) {
  state.checkoutDraftRef = snapshotCheckoutDraft({
    ...draftSeed,
    delivery: { ...state.delivery },
  });
  const session = getSessionSync() as FlowSession | null;
  state.blockedToken =
    state.blockedToken ||
    `${String(session?.userId || "")}:${String(session?.sessionToken || "")}`;
  state.reconnecting = true;
  state.reconnectingRef = true;
  state.kristoCheckoutReauth = true;
  state.events.push("REAUTH_STARTED");
  assert.equal(
    checkoutAuthPresentation({ source: "home-checkout", role: "Pastor" }).route,
    "kristo-member-auth"
  );
  assert.equal(sellerAccessAllowedFor("buyer-checkout"), false);
  state.sellerAccessOpened = false;
}

function renewSession(
  state: FlowState,
  input: { identifier: string; password: string; nextToken: string }
) {
  const previous = getSessionSync() as FlowSession | null;
  const previousKey =
    state.blockedToken ||
    `${String(previous?.userId || "")}:${String(previous?.sessionToken || "")}`;
  const validationError = getKristoLoginValidationError(
    input.identifier,
    input.password
  );
  if (validationError) {
    state.events.push("REAUTH_SUBMIT_FAILED");
    throw new Error(validationError);
  }
  state.events.push("REAUTH_SUBMIT_STARTED");
  state.signinCalls.push({
    identifier: input.identifier,
    passwordLength: input.password.length,
  });
  const data = {
    ok: true,
    userId: uid,
    kristoId: "KR7-TEST1",
    publicKristoId: "KR7-TEST1",
    email: input.identifier.includes("@") ? input.identifier : "",
    phone: input.identifier.includes("@") ? "" : input.identifier,
    sessionToken: input.nextToken,
    role: "Pastor",
    churchId: "CH7-57M90Y",
    churchRole: "Pastor",
    platformRole: "Pastor",
    offlineActivationRole: "Pastor",
  };
  for (const key of SIGNIN_CONTRACT_KEYS) {
    assert.equal(key in data, true, `missing sign-in key ${key}`);
  }
  state.events.push("REAUTH_SIGNIN_RESPONSE");
  const nextKey = `${data.userId}:${data.sessionToken}`;
  const renewal = evaluateSessionRenewal({
    blockedToken: previousKey,
    nextToken: nextKey,
  });
  assert.equal(renewal.accepted, true);
  const nextSession: FlowSession = {
    userId: data.userId,
    sessionToken: data.sessionToken,
    role: data.role,
    churchId: data.churchId,
    churchRole: data.churchRole,
  };
  persistSession(state, nextSession);
  state.reconnecting = false;
  state.events.push("REAUTH_SUCCEEDED");
  return nextSession;
}

function submitReauth(
  state: FlowState,
  input: { identifier: string; password: string; nextToken: string }
) {
  const draft = state.checkoutDraftRef;
  const rejectedToken = state.blockedToken;
  const next = renewSession(state, input);
  persistSession(state, next);
  const outcome = checkoutAfterSessionRenewed({
    draft: draft!,
    blockedToken: rejectedToken,
    nextToken: `${next.userId}:${next.sessionToken}`,
  });
  assert.equal(outcome.tokenChanged, true);
  assert.equal(outcome.shouldReloadDeliveryRates, true);
  assert.deepEqual(outcome.restoreDraft?.delivery, draftSeed.delivery);
  state.sessionExpiredRef = false;
  state.reconnectingRef = false;
  state.reconnecting = false;
  state.kristoCheckoutReauth = false;
  return outcome;
}

test("home checkout auth flow completes end to end from legacy token through v2 retry and restart", () => {
  const loginHandler = fs.readFileSync(
    path.join(root, "app/api/auth/_lib/loginHandler.ts"),
    "utf8"
  );
  const api = fs.readFileSync(
    path.join(root, "apps/mobile/src/lib/sokoCheckoutApi.ts"),
    "utf8"
  );
  const home = fs.readFileSync(
    path.join(root, "apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx"),
    "utf8"
  );
  for (const key of SIGNIN_CONTRACT_KEYS) {
    assert.match(loginHandler, new RegExp(key));
  }
  assert.match(api, /await saveSession\(nextSession as any\)/);
  assert.match(api, /reconnecting = false/);
  assert.match(home, /await setSession\(next as any\)/);
  assert.match(home, /reconnectingRef\.current=false/);
  assert.match(home, /resumeDeliveryRatesOnceRef\.current=true/);
  assert.match(home, /await loadDeliveryRatesRef\.current\(\)/);
  assert.doesNotMatch(home, /setMorePage\("access"\)/);
  assert.doesNotMatch(home, /Seller Access/);

  withSecret(() => {
    const goodToken = issueSessionToken(uid);
    const peeked = peekSessionTokenMeta(goodToken);
    assert.equal(peeked.version, KRISTO_SESSION_TOKEN_VERSION);
    assert.equal(peeked.issuer, KRISTO_SESSION_TOKEN_ISSUER);
    assert.equal(verifySessionToken(goodToken).ok, true);

    const ratesByToken = new Map<string, any>([
      [
        goodToken,
        { ok: true, status: 200, rates: [{ id: "rate-1", amount: 12 }] },
      ],
    ]);

    const state: FlowState = {
      reconnecting: false,
      reconnectingRef: false,
      kristoCheckoutReauth: false,
      sessionExpiredRef: false,
      resumeDeliveryRatesOnceRef: false,
      blockedToken: "",
      disk: "",
      reactSession: null,
      delivery: { ...draftSeed.delivery },
      checkoutDraftRef: null,
      events: [],
      rateCalls: [],
      profileCalls: 0,
      signinCalls: [],
      sellerAccessOpened: false,
    };

    persistSession(state, {
      userId: uid,
      sessionToken: goodToken,
      role: "Pastor",
      churchId: "CH7-57M90Y",
      churchRole: "Pastor",
    });

    const happy = sendRates(state, ratesByToken);
    assert.equal(happy.status, 200);
    assert.equal(state.events.includes("CHECKOUT_REAUTH_REQUIRED"), false);
    assert.equal(state.kristoCheckoutReauth, false);
    assert.equal(state.rateCalls.length, 1);

    const previousSecret = process.env.KRISTO_SESSION_SECRET;
    process.env.KRISTO_SESSION_SECRET = "other-canonical-session-secret-32";
    const staleToken = issueSessionToken(uid);
    process.env.KRISTO_SESSION_SECRET = previousSecret;
    assert.equal(verifySessionToken(staleToken).ok, false);
    persistSession(state, {
      userId: uid,
      sessionToken: staleToken,
      role: "Pastor",
      churchId: "CH7-57M90Y",
      churchRole: "Pastor",
    });

    const checkout = resolveCheckoutMobileIdentity(
      headerReq({
        "x-kristo-user-id": uid,
        "x-kristo-session-token": staleToken,
      })
    );
    assert.equal(checkout.userId, "");
    assert.equal(checkout.reason, "bad-signature");

    assert.throws(
      () => sendRates(state, ratesByToken),
      (error: Error) => error.message === KRISTO_SESSION_REISSUE_MESSAGE
    );
    assert.equal(state.profileCalls, 0);
    assert.equal(state.events.at(-1), "CHECKOUT_REAUTH_REQUIRED");
    assert.equal(state.blockedToken, `${uid}:${staleToken}`);
    state.sessionExpiredRef = true;
    beginReauth(state);

    const shortPassword = "pass7";
    assert.equal(shortPassword.length < 8, true);
    assert.equal(supportedKristoLoginIdentifierType("pastor@gmail.com"), "email");
    assert.equal(supportedKristoLoginIdentifierType("2145550101"), "phone");
    assert.equal(getKristoLoginValidationError("pastor@gmail.com", shortPassword), null);
    assert.equal(getKristoLoginValidationError("2145550101", shortPassword), null);

    const v2Token = issueSessionToken(uid);
    ratesByToken.set(v2Token, {
      ok: true,
      status: 200,
      rates: [{ id: "rate-2", amount: 15 }],
    });

    const emailOutcome = submitReauth(state, {
      identifier: "pastor@gmail.com",
      password: shortPassword,
      nextToken: v2Token,
    });
    assert.equal(emailOutcome.restoreDraft?.delivery.apartment, "4B");
    assert.equal(getSessionSync()?.sessionToken, v2Token);
    assert.equal(JSON.parse(state.disk).sessionToken, v2Token);
    assert.equal(state.reactSession?.sessionToken, v2Token);
    assert.equal(state.blockedToken, `${uid}:${staleToken}`);

    state.resumeDeliveryRatesOnceRef = true;
    const retried = sendRates(state, ratesByToken);
    assert.equal(retried.status, 200);
    assert.equal(state.blockedToken, "");
    assert.equal(state.rateCalls.at(-1)?.token, v2Token);
    assert.equal(
      state.rateCalls.filter((row) => row.token === v2Token).length,
      1
    );

    const phoneToken = issueSessionToken(uid);
    ratesByToken.set(phoneToken, {
      ok: true,
      status: 200,
      rates: [{ id: "rate-3", amount: 18 }],
    });
    persistSession(state, {
      userId: uid,
      sessionToken: staleToken,
      role: "Pastor",
      churchId: "CH7-57M90Y",
      churchRole: "Pastor",
    });
    state.blockedToken = `${uid}:${staleToken}`;
    state.reconnecting = false;
    state.reconnectingRef = false;
    state.sessionExpiredRef = false;
    beginReauth(state);
    submitReauth(state, {
      identifier: "2145550101",
      password: shortPassword,
      nextToken: phoneToken,
    });
    state.resumeDeliveryRatesOnceRef = true;
    const phoneRetry = sendRates(state, ratesByToken);
    assert.equal(phoneRetry.status, 200);
    assert.equal(state.rateCalls.at(-1)?.token, phoneToken);

    const restarted = restoreFromDisk(state);
    assert.equal(restarted.sessionToken, phoneToken);
    assert.equal(verifySessionToken(restarted.sessionToken).ok, true);
    assert.equal(peekSessionTokenMeta(restarted.sessionToken).version, 2);
    const afterRestart = sendRates(state, ratesByToken);
    assert.equal(afterRestart.status, 200);
    assert.equal(state.sellerAccessOpened, false);
    assert.equal(
      state.signinCalls.map((row) => row.identifier).join(","),
      "pastor@gmail.com,2145550101"
    );
    assert.equal(
      state.signinCalls.every((row) => row.passwordLength === shortPassword.length),
      true
    );
    assert.deepEqual(
      state.events.filter((event) => event === "REAUTH_SUBMIT_STARTED"),
      ["REAUTH_SUBMIT_STARTED", "REAUTH_SUBMIT_STARTED"]
    );
    assert.equal(state.events.includes("CHECKOUT_AUTH_MISMATCH"), false);
    assert.equal(
      checkoutAuthPresentation({ source: "home-checkout", role: "Pastor" })
        .usesSellerAccess,
      false
    );
  });
});
