import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  describeSessionSecretConfig,
  issueSessionToken,
  KRISTO_SESSION_TOKEN_ISSUER,
  KRISTO_SESSION_TOKEN_VERSION,
  peekSessionTokenMeta,
  resolveCheckoutMobileIdentity,
  resolvePresentedMobileSession,
  resolveRequestUserId,
  verifySessionToken,
} from "../app/api/auth/_lib/sessionToken.ts";

const secret = "canonical-kristo-session-secret-32";
const previous = "canonical-kristo-session-previous-32";

function withProductionAuth(run: () => void, sessionSecret = secret) {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDevHeader = process.env.KRISTO_DEV_HEADER_AUTH;
  const previousSecret = process.env.KRISTO_SESSION_SECRET;
  const previousPrevious = process.env.KRISTO_SESSION_SECRET_PREVIOUS;
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
    if (previousPrevious === undefined) delete process.env.KRISTO_SESSION_SECRET_PREVIOUS;
    else process.env.KRISTO_SESSION_SECRET_PREVIOUS = previousPrevious;
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

test("login-issued v2 token is accepted by the production verifier", () => {
  const uid = "u_996c19a3aad35819e9614ead1";
  withProductionAuth(() => {
    const token = issueSessionToken(uid);
    const peeked = peekSessionTokenMeta(token);
    assert.equal(peeked.version, KRISTO_SESSION_TOKEN_VERSION);
    assert.equal(peeked.issuer, KRISTO_SESSION_TOKEN_ISSUER);
    assert.equal(peeked.uid, uid);
    const verified = verifySessionToken(token);
    assert.equal(verified.ok, true);
    assert.equal(verified.userId, uid);
    assert.equal(verified.verifiedVia, "current");
  });
});

test("one verified token works for profile, church, checkout, and orders identity", () => {
  const uid = "u_996c19a3aad35819e9614ead1";
  withProductionAuth(() => {
    const token = issueSessionToken(uid);
    const req = headerReq({
      "x-kristo-user-id": uid,
      "x-kristo-session-token": token,
      "x-kristo-role": "Pastor",
      "x-kristo-church-id": "CH7-57M90Y",
    });
    const profile = resolveRequestUserId(req);
    const checkout = resolveCheckoutMobileIdentity(req);
    const presented = resolvePresentedMobileSession(req);
    assert.equal(profile.userId, uid);
    assert.equal(profile.via, "token");
    assert.equal(checkout.userId, uid);
    assert.equal(checkout.tokenVerified, true);
    assert.equal(presented.userId, uid);
    assert.equal(presented.via, "verified-token");
    assert.equal(presented.tokenVerified, true);
  });
});

test("wrong secret, modified token, spoofed uid, expired token, and synthetic sessions are rejected", () => {
  const uid = "u_996c19a3aad35819e9614ead1";
  let issued = "";
  withProductionAuth(() => {
    issued = issueSessionToken(uid);
    const v1 = issueSessionToken(uid, undefined, 1);
    assert.equal(verifySessionToken(v1).ok, true);
    assert.equal(peekSessionTokenMeta(v1).version, 1);

    const expired = issueSessionToken(uid, -1);
    assert.equal(verifySessionToken(expired).ok, false);
    assert.equal(verifySessionToken(expired).reason, "expired");

    const mutated = `${issued.slice(0, -2)}ab`;
    assert.equal(verifySessionToken(mutated).ok, false);
    assert.equal(verifySessionToken(mutated).reason, "bad-signature");

    const spoofed = resolveRequestUserId(
      headerReq({
        "x-kristo-user-id": "u_spoofed_buyer",
        "x-kristo-session-token": issued,
      })
    );
    assert.equal(spoofed.userId, "");
    const checkout = resolveCheckoutMobileIdentity(
      headerReq({
        "x-kristo-user-id": "u_spoofed_buyer",
        "x-kristo-session-token": issued,
      })
    );
    assert.equal(checkout.userId, uid);
  });

  withProductionAuth(() => {
    assert.equal(verifySessionToken(issued).ok, false);
    assert.equal(verifySessionToken(issued).reason, "bad-signature");
    const presented = resolvePresentedMobileSession(
      headerReq({
        "x-kristo-user-id": uid,
        "x-kristo-session-token": issued,
      })
    );
    assert.equal(presented.userId, "");
    assert.equal(presented.reason, "bad-signature");
  }, "other-canonical-session-secret-32");
});

test("previous dedicated secret can verify rotated tokens without trusting headers", () => {
  const uid = "u_buyer_pastor";
  let rotated = "";
  withProductionAuth(() => {
    rotated = issueSessionToken(uid);
  }, previous);
  withProductionAuth(() => {
    process.env.KRISTO_SESSION_SECRET_PREVIOUS = previous;
    const verified = verifySessionToken(rotated);
    assert.equal(verified.ok, true);
    assert.equal(verified.userId, uid);
    assert.equal(verified.verifiedVia, "legacy");
    assert.equal(verified.legacySecretLabel, "KRISTO_SESSION_SECRET_PREVIOUS");
  });
});

test("secret config logs names and fingerprints only", () => {
  withProductionAuth(() => {
    const config = describeSessionSecretConfig();
    assert.equal(config.hasKristoSessionSecret, true);
    assert.equal(config.issueLabel, "KRISTO_SESSION_SECRET");
    assert.equal(String(config.fingerprints.KRISTO_SESSION_SECRET).length, 8);
    const serialized = JSON.stringify(config);
    assert.doesNotMatch(serialized, new RegExp(secret));
    assert.doesNotMatch(serialized, /sessionToken/);
  });
});

test("login and checkout share the canonical issuer", () => {
  const login = fs.readFileSync(
    path.join(process.cwd(), "app/api/auth/_lib/loginHandler.ts"),
    "utf8"
  );
  const verify = fs.readFileSync(
    path.join(process.cwd(), "app/api/auth/login/verify/route.ts"),
    "utf8"
  );
  const auth = fs.readFileSync(
    path.join(process.cwd(), "app/api/_lib/auth.ts"),
    "utf8"
  );
  const session = fs.readFileSync(
    path.join(process.cwd(), "app/api/auth/_lib/session.ts"),
    "utf8"
  );
  const profile = fs.readFileSync(
    path.join(process.cwd(), "app/api/auth/profile/route.ts"),
    "utf8"
  );
  const checkoutFn = auth.slice(auth.indexOf("export async function getCheckoutViewer"));
  const viewerFn = auth.slice(
    auth.indexOf("export async function getViewer"),
    auth.indexOf("export async function getCheckoutViewer")
  );
  assert.match(login, /issueSessionToken\(user\.id\)/);
  assert.match(verify, /issueSessionToken\(v\.userId\)/);
  assert.doesNotMatch(checkoutFn, /await readSession\(/);
  assert.match(viewerFn, /await readSession\(/);
  assert.match(session, /header-session-\$\{headerUserId\}/);
  assert.match(session, /logDeprecatedHeaderSession/);
  assert.match(session, /token-session-/);
  assert.match(profile, /verifySessionToken\(token\)/);
  assert.match(profile, /headerUserId\.startsWith\("u_"\)/);
  assert.match(profile, /logDeprecatedHeaderSession/);
});

test("stage-1 checkout rejects unverified tokens while profile/church keep header-session fallback", () => {
  const uid = "u_996c19a3aad35819e9614ead1";
  let issued = "";
  withProductionAuth(() => {
    issued = issueSessionToken(uid);
  });
  withProductionAuth(() => {
    const req = headerReq({
      "x-kristo-user-id": uid,
      "x-kristo-session-token": issued,
    });
    const checkout = resolveCheckoutMobileIdentity(req);
    const presented = resolvePresentedMobileSession(req);
    assert.equal(checkout.userId, "");
    assert.equal(checkout.tokenVerified, false);
    assert.equal(checkout.reason, "bad-signature");
    assert.equal(presented.userId, "");
    assert.equal(presented.reason, "bad-signature");
  }, "other-canonical-session-secret-32");

  const sessionToken = fs.readFileSync(
    path.join(process.cwd(), "app/api/auth/_lib/sessionToken.ts"),
    "utf8"
  );
  assert.match(sessionToken, /KRISTO_HEADER_SESSION_DEPRECATED/);
  assert.match(sessionToken, /export function logDeprecatedHeaderSession/);
});
