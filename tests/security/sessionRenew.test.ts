// POST /api/auth/session/renew against a LOCAL throw-away Postgres (never a hosted database).
// Needs the local Neon HTTP adapter in front of it (see .review-tools/neonHttpProxy.mjs):
//   KRISTO_TEST_DATABASE_URL=postgresql://<you>@127.0.0.1:5432/kristo_local_test \
//   KRISTO_REVIEW_LOCAL_NEON_HTTP_ENDPOINT=http://127.0.0.1:55443/sql \
//   node --import ./tests/security/_appResolve.mjs --test tests/security/sessionRenew.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const dbUrl = String(process.env.KRISTO_TEST_DATABASE_URL || "").trim();
const endpoint = String(process.env.KRISTO_REVIEW_LOCAL_NEON_HTTP_ENDPOINT || "").trim();
const localOnly = /^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/kristo_local_test$/.test(dbUrl) && /^http:\/\/127\.0\.0\.1:\d+\/sql$/.test(endpoint);

const CURRENT = "test-renew-current-secret-0123456789";
const PREVIOUS = "test-renew-previous-secret-0123456789";
const RESEND = "re_test_renew_not_a_real_key";
const OTP = "test-renew-otp-secret-0123456789";

function b64url(s: string) {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signToken(secret: string, uid: string, { iatAgoMs = 0, ttlMs = 30 * 864e5 } = {}) {
  const now = Date.now() - iatAgoMs;
  const p = b64url(JSON.stringify({ v: 2, iss: "kristo", uid, iat: now, exp: now + ttlMs }));
  return `${p}.${crypto.createHmac("sha256", secret).update(p).digest("hex")}`;
}

test("session renew", { skip: localOnly ? false : "set KRISTO_TEST_DATABASE_URL to the local kristo_local_test DB" }, async (t) => {
  process.env.DATABASE_URL = dbUrl;
  process.env.KRISTO_SESSION_SECRET = CURRENT;
  process.env.KRISTO_SESSION_SECRET_PREVIOUS = PREVIOUS;
  process.env.RESEND_API_KEY = RESEND;
  process.env.KRISTO_OTP_SECRET = OTP;
  delete process.env.KRISTO_SESSION_LEGACY_VERIFY;

  const { POST } = await import("../../app/api/auth/session/renew/route.ts");
  const { createUser, findUserByIdentifier, createChallenge } = await import("../../app/api/auth/_lib/session.ts");
  const { verifySessionToken } = await import("../../app/api/auth/_lib/sessionToken.ts");
  const { dbApplySafetyAccountEnforcement } = await import("../../app/api/_lib/store/safetyReportDb.ts");

  async function user(email: string) {
    const found = await findUserByIdentifier("email", email);
    if (found) return found.id as string;
    const r: any = await createUser({ email, password: "Password123" });
    assert.ok(r.ok, String(r.error || "createUser failed"));
    return r.user.id as string;
  }
  const renew = (token: string) =>
    POST(new Request("http://localhost/api/auth/session/renew", { method: "POST", headers: token ? { "x-kristo-session-token": token } : {} }));

  const active = await user("renew-active@kristo.local");

  await t.test("a current token is exchanged for a fresh current-secret token", async () => {
    const res = await renew(signToken(CURRENT, active, { iatAgoMs: 10 * 864e5 }));
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.userId, active);
    const v = verifySessionToken(body.sessionToken, active);
    assert.equal(v.ok, true);
    assert.equal(v.verifiedVia, "current");
  });

  await t.test("a token from the previous dedicated secret is renewable (rotation)", async () => {
    const res = await renew(signToken(PREVIOUS, active));
    assert.equal(res.status, 200);
  });

  for (const [label, secret] of [["RESEND_API_KEY", RESEND], ["KRISTO_OTP_SECRET", OTP]] as const) {
    await t.test(`a ${label}-signed legacy token is verified elsewhere but never renewed`, async () => {
      const token = signToken(secret, active);
      assert.equal(verifySessionToken(token).verifiedVia, "legacy");
      const res = await renew(token);
      assert.equal(res.status, 401);
      const body: any = await res.json();
      assert.equal(body.reauth, true);
      assert.equal(body.sessionToken, undefined);
    });
  }

  await t.test("expired, tampered, missing and OTP challenge ids are refused", async () => {
    for (const token of [
      signToken(CURRENT, active, { iatAgoMs: 40 * 864e5 }),
      signToken(CURRENT, active).replace(/.$/, (c) => (c === "0" ? "1" : "0")),
      "",
      String(createChallenge({ identifierType: "email", identifier: "renew-active@kristo.local", userId: active }).id),
    ]) {
      const res = await renew(token);
      assert.equal(res.status, 401);
      assert.equal(((await res.json()) as any).reauth, true);
    }
  });

  await t.test("a deleted/unknown account is refused", async () => {
    const res = await renew(signToken(CURRENT, "u_does_not_exist_renew"));
    assert.equal(res.status, 401);
  });

  await t.test("a suspended account gets the sign-in 403 and no token", async () => {
    const suspended = await user("renew-suspended@kristo.local");
    await dbApplySafetyAccountEnforcement({
      userId: suspended,
      reportId: "local-test-renew",
      enforcementType: "suspend_account",
      reason: "local test",
      durationDays: 1,
      issuedByUserId: "u-demo-1",
      issuedByRole: "system_admin",
    });
    const res = await renew(signToken(CURRENT, suspended));
    assert.equal(res.status, 403);
    const body: any = await res.json();
    assert.equal(body.sessionToken, undefined);
    assert.notEqual(body.reauth, true);
  });
});
