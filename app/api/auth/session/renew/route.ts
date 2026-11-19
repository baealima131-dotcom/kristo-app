import { NextResponse } from "next/server";
import { issueSessionToken, verifySessionToken } from "@/app/api/auth/_lib/sessionToken";
import { getUserById } from "@/app/api/auth/_lib/session";
import { assertSafetyAllowsAuthentication } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Legacy signers that may only be *verified* (old store apps), never renewed. Renewing them
 * would turn a token anyone holding the OTP/Resend key could forge into a current-secret token
 * that outlives KRISTO_SESSION_LEGACY_VERIFY=0. The previous dedicated secret is renewable so a
 * KRISTO_SESSION_SECRET rotation does not sign active users out.
 */
const RENEWABLE_LEGACY_LABELS = new Set(["KRISTO_SESSION_SECRET_PREVIOUS"]);

function reauth(error: string) {
  return NextResponse.json(
    { ok: false, error, reason: "session_expired", reauth: true },
    { status: 401, headers: NO_STORE }
  );
}

/**
 * Exchange a still-valid signed session token for a fresh 30-day one, so active
 * users never reach expiry. An expired, invalid or legacy-signed token is never
 * renewed: that user signs in again (401 with reauth: true). Suspended or banned
 * accounts get the same 403 as sign-in and no new token.
 */
export async function POST(req: Request) {
  const token = String(req.headers.get("x-kristo-session-token") || "").trim();
  const v = token ? verifySessionToken(token) : { ok: false as const, reason: "missing" };
  if (!v.ok || !v.userId) {
    return reauth("Session expired. Please sign in again.");
  }
  if (v.verifiedVia === "legacy" && !RENEWABLE_LEGACY_LABELS.has(String(v.legacySecretLabel || ""))) {
    return reauth("Please sign in again to refresh your session.");
  }
  const user = await getUserById(v.userId).catch(() => null);
  if (!user) {
    return reauth("Account not found. Please sign in again.");
  }

  let safetyBlock: NextResponse | null;
  try {
    safetyBlock = await assertSafetyAllowsAuthentication(v.userId);
  } catch {
    // Enforcement could not be checked: do not extend the session (and do not sign the user out).
    return NextResponse.json({ ok: false, error: "Could not renew session" }, { status: 503, headers: NO_STORE });
  }
  if (safetyBlock) {
    safetyBlock.headers.set("Cache-Control", "no-store");
    return safetyBlock;
  }

  const sessionToken = issueSessionToken(v.userId, TTL_MS);
  if (!sessionToken) {
    return NextResponse.json({ ok: false, error: "Could not renew session" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(
    { ok: true, userId: v.userId, sessionToken, expiresAt: Date.now() + TTL_MS },
    { headers: NO_STORE }
  );
}
