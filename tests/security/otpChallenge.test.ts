// Signed OTP challenges must not be forgeable with RESEND_API_KEY (a copy was uploaded with
// past CLI deploys). Legitimate challenges keep verifying.
//   node --import ./tests/security/_appResolve.mjs --test tests/security/otpChallenge.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.KRISTO_SESSION_SECRET = "test-session-secret-current";
process.env.RESEND_API_KEY = "re_test_not_a_real_key";
delete process.env.KRISTO_OTP_SECRET;
const { createChallenge, verifyChallenge } = await import("../../app/api/auth/_lib/session.ts");

function forgeChallenge(key: string, userId: string, code: string) {
  const now = Date.now();
  const payload = {
    v: 1, userId, identifier: "victim@example.invalid", identifierType: "email",
    codeHash: crypto.createHmac("sha256", key).update(code).digest("hex"),
    expiresAt: now + 600_000, issuedAt: now,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `otpt.v1.${body}.${crypto.createHmac("sha256", key).update(body).digest("base64url")}`;
}

test("a real challenge verifies with its code", () => {
  const ch = createChallenge({ identifierType: "email", identifier: "alice@example.invalid", userId: "u_alice" });
  assert.ok(String(ch.id).startsWith("otpt.v1."));
  assert.deepEqual(verifyChallenge(ch.id, ch.code), { ok: true, userId: "u_alice" });
});
test("a challenge forged with the Resend key is rejected", () => {
  assert.equal(verifyChallenge(forgeChallenge("re_test_not_a_real_key", "u_victim", "123456"), "123456").ok, false);
});
test("a wrong code is rejected", () => {
  const ch = createChallenge({ identifierType: "email", identifier: "bob@example.invalid", userId: "u_bob" });
  const wrong = ch.code === "111111" ? "222222" : "111111";
  assert.equal(verifyChallenge(ch.id, wrong).ok, false);
});
