import crypto from "crypto";

/**
 * V1 auth hardening (item #1): signed session tokens.
 *
 * Mobile authenticates with credentials/OTP and then sends `x-kristo-user-id`
 * on every request. Historically that header was trusted verbatim, which let
 * any client impersonate any user. We now bind the user id to a short HMAC
 * token (`x-kristo-session-token`) signed with KRISTO_SESSION_SECRET.
 *
 * - Production: a raw `x-kristo-user-id` is ONLY honored when accompanied by a
 *   valid signed token for that exact user id.
 * - Development (or explicit `KRISTO_DEV_HEADER_AUTH=1`): the raw header is
 *   still trusted so local tooling / curl keep working.
 *
 * This is intentionally stateless (no server session store needed) so it works
 * across serverless instances without extra infrastructure.
 */

const DEV_FALLBACK_SECRET = "kristo-dev-session-secret-not-for-production";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches mobile session

export function getSessionSecret(): string {
  const dedicated = String(process.env.KRISTO_SESSION_SECRET || "").trim();
  if (dedicated) return dedicated;

  // Production may already have KRISTO_OTP_SECRET or RESEND_API_KEY configured
  // (same chain as OTP signing) before KRISTO_SESSION_SECRET is added explicitly.
  const shared = String(
    process.env.KRISTO_OTP_SECRET?.trim() ||
      process.env.RESEND_API_KEY?.trim() ||
      ""
  ).trim();
  if (shared) return shared;

  // In dev we fall back so local flows work; in prod we return "" which makes
  // verification fail closed (and we log loudly below).
  if (process.env.NODE_ENV !== "production") return DEV_FALLBACK_SECRET;
  return "";
}

/**
 * Dev / explicit-header-auth mode may trust the raw user id header without a
 * signed token. Production must not.
 */
export function shouldTrustRawHeaderIdentity(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.KRISTO_DEV_HEADER_AUTH === "1"
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): string {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
}

/** Issue a signed token binding `userId`. Returns "" if it cannot be signed. */
export function issueSessionToken(userId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const uid = String(userId || "").trim();
  if (!uid) return "";

  const secret = getSessionSecret();
  if (!secret) {
    console.error("KRISTO_SESSION_SECRET_MISSING", {
      phase: "issue",
      note: "Set KRISTO_SESSION_SECRET in the production environment.",
    });
    return "";
  }

  const now = Date.now();
  const payloadB64 = base64url(JSON.stringify({ uid, iat: now, exp: now + ttlMs }));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type SessionTokenVerification = {
  ok: boolean;
  userId?: string;
  reason?: string;
};

/** Verify a signed token; optionally assert it belongs to `expectedUserId`. */
export function verifySessionToken(
  token: string,
  expectedUserId?: string
): SessionTokenVerification {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, reason: "missing" };

  const secret = getSessionSecret();
  if (!secret) return { ok: false, reason: "no-secret" };

  const dot = raw.indexOf(".");
  if (dot <= 0 || dot >= raw.length - 1) return { ok: false, reason: "malformed" };

  const payloadB64 = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);
  const expectedSig = sign(payloadB64, secret);

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  let payload: { uid?: string; exp?: number };
  try {
    payload = JSON.parse(base64urlDecode(payloadB64));
  } catch {
    return { ok: false, reason: "bad-payload" };
  }

  const uid = String(payload?.uid || "").trim();
  if (!uid) return { ok: false, reason: "no-uid" };
  if (Number(payload?.exp || 0) < Date.now()) return { ok: false, reason: "expired" };
  if (expectedUserId && String(expectedUserId).trim() !== uid) {
    return { ok: false, reason: "uid-mismatch" };
  }

  return { ok: true, userId: uid };
}

type HeaderBag = { headers?: { get?: (key: string) => string | null } };

/**
 * Central identity resolver for header-authenticated requests.
 * Returns a trusted userId or "" when the request must be treated as anonymous.
 */
export function resolveRequestUserId(req: HeaderBag | undefined): {
  userId: string;
  via: "dev-header" | "token" | "none";
  reason?: string;
} {
  const headerUserId = String(req?.headers?.get?.("x-kristo-user-id") || "").trim();
  if (!headerUserId) return { userId: "", via: "none", reason: "no-header" };

  const token = String(req?.headers?.get?.("x-kristo-session-token") || "").trim();

  if (shouldTrustRawHeaderIdentity()) {
    // Dev path: prefer a valid token if present, otherwise trust the raw header.
    if (token) {
      const v = verifySessionToken(token, headerUserId);
      if (v.ok) return { userId: headerUserId, via: "token" };
    }
    return { userId: headerUserId, via: "dev-header" };
  }

  // Production: require a valid signed token bound to the header user id.
  const v = verifySessionToken(token, headerUserId);
  if (v.ok) return { userId: headerUserId, via: "token" };

  console.warn("KRISTO_AUTH_HEADER_REJECTED", {
    headerUserId,
    hasToken: Boolean(token),
    reason: v.reason || "invalid",
  });
  return { userId: "", via: "none", reason: v.reason || "invalid-token" };
}
