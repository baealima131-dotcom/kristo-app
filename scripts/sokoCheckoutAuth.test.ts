import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  issueSessionToken,
  resolveRequestUserId,
  verifySessionToken,
} from "../app/api/auth/_lib/sessionToken.ts";
import {
  invalidateSafetyEnforcementCache,
  loadSafetyEnforcementCached,
  readSafetyEnforcementCache,
  writeSafetyEnforcementCache,
} from "../app/api/_lib/safetyEnforcementCache.ts";

const secret = "soko-checkout-auth-test-secret-32";

function withProductionAuth(run: () => void) {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDevHeader = process.env.KRISTO_DEV_HEADER_AUTH;
  const previousSecret = process.env.KRISTO_SESSION_SECRET;
  process.env.NODE_ENV = "production";
  delete process.env.KRISTO_DEV_HEADER_AUTH;
  process.env.KRISTO_SESSION_SECRET = secret;
  try {
    run();
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousDevHeader === undefined) delete process.env.KRISTO_DEV_HEADER_AUTH;
    else process.env.KRISTO_DEV_HEADER_AUTH = previousDevHeader;
    if (previousSecret === undefined) delete process.env.KRISTO_SESSION_SECRET;
    else process.env.KRISTO_SESSION_SECRET = previousSecret;
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
  assert.match(rbac, /export async function guardCheckoutAuth/);
  assert.match(rbac, /getCheckoutViewer/);
  assert.match(rbac, /assertSafetyEnforcementAllows/);
  assert.match(rbac, /token_verify/);
});
