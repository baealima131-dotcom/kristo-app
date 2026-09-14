import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  describeCheckoutAuthDiag,
  issueSessionToken,
  resolveRequestUserId,
  shortAuthHash,
  verifySessionToken,
} from "../app/api/auth/_lib/sessionToken.ts";
import {
  invalidateSafetyEnforcementCache,
  loadSafetyEnforcementCached,
  readSafetyEnforcementCache,
  writeSafetyEnforcementCache,
} from "../app/api/_lib/safetyEnforcementCache.ts";

const secret = "soko-checkout-auth-test-secret-32";

function withProductionAuth(run: () => void, sessionSecret = secret) {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDevHeader = process.env.KRISTO_DEV_HEADER_AUTH;
  const previousSecret = process.env.KRISTO_SESSION_SECRET;
  const previousOtp = process.env.KRISTO_OTP_SECRET;
  const previousResend = process.env.RESEND_API_KEY;
  const previousLegacy = process.env.KRISTO_SESSION_LEGACY_VERIFY;
  process.env.NODE_ENV = "production";
  delete process.env.KRISTO_DEV_HEADER_AUTH;
  process.env.KRISTO_SESSION_LEGACY_VERIFY = "0";
  delete process.env.KRISTO_OTP_SECRET;
  delete process.env.RESEND_API_KEY;
  if (sessionSecret) process.env.KRISTO_SESSION_SECRET = sessionSecret;
  else delete process.env.KRISTO_SESSION_SECRET;
  try {
    run();
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousDevHeader === undefined) delete process.env.KRISTO_DEV_HEADER_AUTH;
    else process.env.KRISTO_DEV_HEADER_AUTH = previousDevHeader;
    if (previousSecret === undefined) delete process.env.KRISTO_SESSION_SECRET;
    else process.env.KRISTO_SESSION_SECRET = previousSecret;
    if (previousOtp === undefined) delete process.env.KRISTO_OTP_SECRET;
    else process.env.KRISTO_OTP_SECRET = previousOtp;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    if (previousLegacy === undefined) delete process.env.KRISTO_SESSION_LEGACY_VERIFY;
    else process.env.KRISTO_SESSION_LEGACY_VERIFY = previousLegacy;
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

test("signed session token is bound to user id and expires", () => {
  withProductionAuth(() => {
    const token = issueSessionToken("u_buyer_real");
    assert.equal(verifySessionToken(token).ok, true);
    assert.equal(verifySessionToken(token).userId, "u_buyer_real");
    assert.equal(verifySessionToken(token, "u_buyer_real").ok, true);
    assert.equal(verifySessionToken(token, "u_spoofed").ok, false);
    assert.equal(verifySessionToken(token, "u_spoofed").reason, "uid-mismatch");

    const expired = issueSessionToken("u_buyer_real", -1);
    assert.equal(verifySessionToken(expired).ok, false);
    assert.equal(verifySessionToken(expired).reason, "expired");
  });
});

test("production checkout identity rejects unsigned and mismatched headers", () => {
  withProductionAuth(() => {
    const unsigned = resolveRequestUserId(
      headerReq({ "x-kristo-user-id": "u_spoofed" })
    );
    assert.equal(unsigned.userId, "");
    assert.equal(unsigned.via, "none");

    const token = issueSessionToken("u_buyer_real");
    const mismatch = resolveRequestUserId(
      headerReq({
        "x-kristo-user-id": "u_spoofed",
        "x-kristo-session-token": token,
      })
    );
    assert.equal(mismatch.userId, "");

    const matched = resolveRequestUserId(
      headerReq({
        "x-kristo-user-id": "u_buyer_real",
        "x-kristo-session-token": token,
      })
    );
    assert.equal(matched.userId, "u_buyer_real");
    assert.equal(matched.via, "token");
  });
});

test("safety enforcement cache is bounded and invalidated on write", async () => {
  const userId = "u_cache_buyer";
  invalidateSafetyEnforcementCache(userId);
  writeSafetyEnforcementCache(userId, {
    permanentBan: false,
    suspension: false,
    restriction: false,
  });
  assert.equal(readSafetyEnforcementCache(userId)?.restriction, false);

  let loads = 0;
  const first = await loadSafetyEnforcementCached(userId, async () => {
    loads += 1;
    return { permanentBan: false, suspension: false, restriction: false };
  });
  assert.equal(first.cacheHit, true);
  assert.equal(loads, 0);

  invalidateSafetyEnforcementCache(userId);
  const second = await loadSafetyEnforcementCached(userId, async () => {
    loads += 1;
    return { permanentBan: true, suspension: false, restriction: false };
  });
  assert.equal(second.cacheHit, false);
  assert.equal(second.value.permanentBan, true);
  assert.equal(loads, 1);
});

test("checkout auth diagnostics cover valid token and failure reasons", () => {
  const uid = "u_buyer_real";
  withProductionAuth(() => {
    const token = issueSessionToken(uid);
    const valid = describeCheckoutAuthDiag(
      headerReq({
        "x-kristo-user-id": uid,
        "x-kristo-session-token": token,
      })
    );
    assert.equal(valid.verifyOk, true);
    assert.equal(valid.verifyReason, null);
    assert.equal(valid.verifiedVia, "current");
    assert.equal(valid.hasSessionSecret, true);
    assert.equal(valid.resolveOk, true);
    assert.equal(valid.resolveVia, "token");
    assert.equal(valid.sessionTokenLen, token.length);
    assert.equal(valid.headerUidHash, shortAuthHash(uid));
    assert.equal(valid.tokenUidHash, shortAuthHash(uid));
    assert.equal(valid.headerUidHash, valid.tokenUidHash);

    const mismatch = describeCheckoutAuthDiag(
      headerReq({
        "x-kristo-user-id": "u_spoofed",
        "x-kristo-session-token": token,
      })
    );
    assert.equal(mismatch.verifyOk, false);
    assert.equal(mismatch.verifyReason, "uid-mismatch");
    assert.equal(mismatch.resolveOk, false);
    assert.equal(mismatch.headerUidHash, shortAuthHash("u_spoofed"));
    assert.equal(mismatch.tokenUidHash, shortAuthHash(uid));
    assert.notEqual(mismatch.headerUidHash, mismatch.tokenUidHash);

    const expiredToken = issueSessionToken(uid, -1);
    const expired = describeCheckoutAuthDiag(
      headerReq({
        "x-kristo-user-id": uid,
        "x-kristo-session-token": expiredToken,
      })
    );
    assert.equal(expired.verifyOk, false);
    assert.equal(expired.verifyReason, "expired");
    assert.equal(expired.resolveOk, false);
    assert.equal(expired.tokenUidHash, shortAuthHash(uid));
  });

  let forged = "";
  withProductionAuth(() => {
    forged = issueSessionToken(uid);
  });
  withProductionAuth(() => {
    const bad = describeCheckoutAuthDiag(
      headerReq({
        "x-kristo-user-id": uid,
        "x-kristo-session-token": forged,
      })
    );
    assert.equal(bad.verifyOk, false);
    assert.equal(bad.verifyReason, "bad-signature");
    assert.equal(bad.resolveOk, false);
    assert.equal(bad.hasSessionSecret, true);
    assert.equal(bad.tokenUidHash, shortAuthHash(uid));
  }, "soko-checkout-auth-other-secret-32");

  withProductionAuth(() => {
    const missing = describeCheckoutAuthDiag(
      headerReq({
        "x-kristo-user-id": uid,
        "x-kristo-session-token": "payload.signature",
      })
    );
    assert.equal(missing.hasSessionSecret, false);
    assert.equal(missing.verifyOk, false);
    assert.equal(missing.verifyReason, "no-secret");
    assert.equal(missing.resolveOk, false);
  }, "");
});

test("checkout auth path skips profile hydrate and still enforces safety", () => {
  const auth = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/auth.ts"),
    "utf8"
  );
  assert.match(auth, /export async function getCheckoutViewer/);
  assert.match(auth, /profileHydrated: false/);
  assert.doesNotMatch(
    auth.slice(auth.indexOf("getCheckoutViewer")),
    /seedUserIfMissing|getUserById/
  );

  const rbac = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/rbac.ts"),
    "utf8"
  );
  const sessionToken = fs.readFileSync(
    path.join(process.cwd(), "app/api/auth/_lib/sessionToken.ts"),
    "utf8"
  );
  assert.match(rbac, /export async function guardCheckoutAuth/);
  assert.match(rbac, /getCheckoutViewer/);
  assert.match(rbac, /describeCheckoutAuthDiag/);
  assert.match(rbac, /KRISTO_SOKO_CHECKOUT_AUTH_DIAG/);
  assert.match(rbac, /verifyReason/);
  assert.match(rbac, /verifiedVia/);
  assert.match(rbac, /sessionTokenLen/);
  assert.match(rbac, /hasSessionSecret/);
  assert.match(rbac, /headerUidHash/);
  assert.match(rbac, /tokenUidHash/);
  assert.match(rbac, /assertSafetyEnforcementAllows/);
  assert.match(rbac, /token_verify/);
  assert.doesNotMatch(rbac, /tokenPrefix/);
  assert.doesNotMatch(
    rbac.slice(rbac.indexOf("export async function guardCheckoutAuth")),
    /sessionToken:/
  );
  assert.match(sessionToken, /export function describeCheckoutAuthDiag/);
  assert.match(sessionToken, /verifySessionToken\(token, headerUserId \|\| undefined\)/);
});

test("mobile checkout uses kristoApi auth headers and does not retry 401", () => {
  const helper = fs.readFileSync(
    path.join(process.cwd(), "apps/mobile/src/lib/sokoCheckoutApi.ts"),
    "utf8"
  );
  const home = fs.readFileSync(
    path.join(
      process.cwd(),
      "apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx"
    ),
    "utf8"
  );
  const track = fs.readFileSync(
    path.join(process.cwd(), "apps/mobile/app/(tabs)/more/track-order.tsx"),
    "utf8"
  );
  const dm = fs.readFileSync(
    path.join(process.cwd(), "apps/mobile/src/lib/directMessagesApi.ts"),
    "utf8"
  );
  const rates = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/delivery/rates/route.ts"),
    "utf8"
  );
  const orders = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/orders/route.ts"),
    "utf8"
  );
  const intent = fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/soko/payments/stripe/payment-intent/route.ts"
    ),
    "utf8"
  );
  const conversations = fs.readFileSync(
    path.join(process.cwd(), "app/api/soko/conversations/route.ts"),
    "utf8"
  );

  assert.match(helper, /from "@\/src\/lib\/kristoApi"/);
  assert.match(helper, /loadSession/);
  assert.match(helper, /getKristoHeaders/);
  assert.match(helper, /logKristoAuthHeadersDiag/);
  assert.match(helper, /x-kristo-user-id/);
  assert.match(helper, /x-kristo-session-token/);
  assert.match(helper, /x-kristo-role/);
  assert.match(helper, /x-kristo-church-id/);
  assert.match(helper, /application\/json/);
  assert.match(helper, /blockedToken/);
  assert.match(helper, /SOKO_SESSION_EXPIRED_MESSAGE/);
  assert.match(helper, /Sign in again to continue checkout/);
  assert.match(helper, /hasUserId: Boolean\(headers\["x-kristo-user-id"\]\)/);
  assert.match(helper, /sokoListBuyerSellerConversations/);
  assert.match(helper, /sokoOpenBuyerSellerConversation/);
  assert.match(helper, /sokoListBuyerSellerMessages/);
  assert.match(helper, /sokoSendBuyerSellerMessage/);
  assert.match(helper, /\/api\/soko\/conversations/);
  assert.match(helper, /\/api\/soko\/conversations\/messages/);
  assert.match(helper, /JSON\.stringify\(\{ productId: listingId \}\)/);
  assert.doesNotMatch(helper, /sellerUserId|targetUserId/);
  assert.doesNotMatch(helper, /AsyncStorage/);
  assert.doesNotMatch(helper, /soko\.session|sokoSession/);
  assert.doesNotMatch(
    helper,
    /console\.(log|warn)\([^)]*sessionToken:/
  );

  assert.match(home, /sokoCheckoutJson/);
  assert.match(home, /\/api\/soko\/delivery\/rates/);
  assert.match(home, /\/api\/soko\/orders/);
  assert.match(home, /\/api\/soko\/payments\/stripe\/payment-intent/);
  assert.match(home, /openSokoProductConversation/);
  assert.match(home, /SokoBuyerSellerChat/);
  assert.doesNotMatch(home, /openDirectMessageThread/);
  assert.doesNotMatch(home, /fetch\(\s*\n\s*base\s*\+\s*path/);
  assert.doesNotMatch(home, /apiJson=async\(path:string,init:RequestInit\)=>\{/);

  assert.match(track, /sokoCheckoutJson/);
  assert.match(track, /\/api\/soko\/orders\?mode=buying/);
  assert.doesNotMatch(track, /getKristoHeaders/);
  assert.doesNotMatch(track, /EXPO_PUBLIC_API_BASE/);
  assert.doesNotMatch(track, /fetch\(/);

  assert.match(dm, /apiPost/);
  assert.match(dm, /getKristoHeaders/);
  assert.match(dm, /\/api\/church\/direct-messages/);

  assert.match(rates, /guardCheckoutAuth/);
  assert.match(orders, /guardCheckoutAuth/);
  assert.match(intent, /guardCheckoutAuth/);
  assert.match(conversations, /guardCheckoutAuth/);
});

