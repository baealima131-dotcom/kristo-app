import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import { getDatabaseUrl } from "./authDb";

let schemaReady: Promise<void> | null = null;
function client() {
  const url = getDatabaseUrl();
  if (!url) throw new Error("Account registration is temporarily unavailable.");
  return neon(url);
}
export async function ensureZporaIdentitySchema() {
  if (!schemaReady) {
    schemaReady = client()`CREATE TABLE IF NOT EXISTS zpora_identity_origins (
      user_id TEXT PRIMARY KEY,
      shared_with_kristo BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at TIMESTAMPTZ,
      challenge_id TEXT UNIQUE,
      code_hash TEXT,
      code_expires_at TIMESTAMPTZ,
      attempts INTEGER NOT NULL DEFAULT 0,
      code_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`.then(() => undefined).catch(error => { schemaReady = null; throw error; });
  }
  await schemaReady;
}
function hashCode(challengeId: string, code: string) {
  const secret = process.env.KRISTO_SESSION_SECRET || process.env.KRISTO_OTP_SECRET || process.env.RESEND_API_KEY;
  if (!secret) throw new Error("Verification is temporarily unavailable.");
  return crypto.createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}
function makeChallenge() {
  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(100000, 1000000));
  return { challengeId, code, codeHash: hashCode(challengeId, code) };
}
export async function createZporaIdentity(userId: string) {
  await ensureZporaIdentitySchema();
  const c = makeChallenge();
  await client()`INSERT INTO zpora_identity_origins (user_id, challenge_id, code_hash, code_expires_at)
    VALUES (${userId}, ${c.challengeId}, ${c.codeHash}, NOW() + INTERVAL '10 minutes')`;
  return c;
}
export async function resendZporaChallenge(userId: string) {
  await ensureZporaIdentitySchema();
  const c = makeChallenge();
  const rows = await client()`UPDATE zpora_identity_origins SET challenge_id = ${c.challengeId},
    code_hash = ${c.codeHash}, code_expires_at = NOW() + INTERVAL '10 minutes', attempts = 0, code_sent_at = NOW()
    WHERE user_id = ${userId} AND verified_at IS NULL
      AND code_sent_at < NOW() - INTERVAL '60 seconds' RETURNING user_id`;
  if (!rows.length) throw new Error("Wait 60 seconds before requesting another code, or sign in if already verified.");
  return c;
}
export async function verifyZporaChallenge(challengeId: string, code: string) {
  await ensureZporaIdentitySchema();
  // Atomic attempt allocation prevents concurrent requests bypassing the limit.
  const rows = await client()`UPDATE zpora_identity_origins SET attempts = attempts + 1
    WHERE challenge_id = ${challengeId} AND verified_at IS NULL
      AND code_expires_at > NOW() AND attempts < 5 RETURNING user_id, code_hash`;
  if (!rows.length) throw new Error("Code expired or too many attempts. Request a new code.");
  const expected = Buffer.from(String(rows[0].code_hash), "hex");
  const actual = Buffer.from(hashCode(challengeId, code), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error("Incorrect verification code.");
  const consumed = await client()`UPDATE zpora_identity_origins SET verified_at = NOW(), code_hash = NULL,
    challenge_id = NULL, code_expires_at = NULL WHERE user_id = ${rows[0].user_id}
      AND challenge_id = ${challengeId} AND verified_at IS NULL RETURNING user_id`;
  if (!consumed.length) throw new Error("This code has already been used.");
  return String(consumed[0].user_id);
}
export async function getZporaIdentity(userId: string) {
  await ensureZporaIdentitySchema();
  const rows = await client()`SELECT shared_with_kristo, verified_at FROM zpora_identity_origins WHERE user_id = ${userId}`;
  return rows[0] || null;
}
export async function markZporaIdentityShared(userId: string) {
  await ensureZporaIdentitySchema();
  await client()`UPDATE zpora_identity_origins SET shared_with_kristo = TRUE, verified_at = COALESCE(verified_at, NOW()) WHERE user_id = ${userId}`;
}
export async function deleteZporaIdentity(userId: string) {
  await ensureZporaIdentitySchema();
  await client()`DELETE FROM zpora_identity_origins WHERE user_id = ${userId}`;
}
