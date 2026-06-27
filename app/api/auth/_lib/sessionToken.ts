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
 * Secret rotation bridge: tokens issued before KRISTO_SESSION_SECRET was set
 * may have been signed with RESEND_API_KEY / KRISTO_OTP_SECRET. Verification
 * temporarily accepts those legacy signatures; issuance always uses the
 * dedicated secret. Remove legacy acceptance once users have migrated.
 */

const DEV_FALLBACK_SECRET = "kristo-dev-session-secret-not-for-production";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches mobile session

type VerificationSecret = {
  secret: string;
  kind: "current" | "legacy";
  label: string;
};

function getDedicatedSessionSecret(): string {
  return String(process.env.KRISTO_SESSION_SECRET || "").trim();
}

function getSharedFallbackSecret(): string {
  return String(
    process.env.KRISTO_OTP_SECRET?.trim() ||
      process.env.RESEND_API_KEY?.trim() ||
      ""
  ).trim();
}

/** Legacy signing secrets from before KRISTO_SESSION_SECRET rotation (verify-only). */
function getLegacyVerificationSecrets(): VerificationSecret[] {
  if (process.env.KRISTO_SESSION_LEGACY_VERIFY === "0") return [];

  const current = getDedicatedSessionSecret();
  if (!current) return [];

  const seen = new Set<string>([current]);
  const out: VerificationSecret[] = [];

  const otp = String(process.env.KRISTO_OTP_SECRET || "").trim();
  if (otp && !seen.has(otp)) {
    seen.add(otp);
    out.push({ secret: otp, kind: "legacy", label: "KRISTO_OTP_SECRET" });
  }

  const resend = String(process.env.RESEND_API_KEY || "").trim();
  if (resend && !seen.has(resend)) {
    seen.add(resend);
    out.push({ secret: resend, kind: "legacy", label: "RESEND_API_KEY" });
  }

  return out;
}

/** Primary secret for issuing new tokens. Production requires KRISTO_SESSION_SECRET. */
export function getIssueSessionSecret(): string {
  const dedicated = getDedicatedSessionSecret();
  if (dedicated) return dedicated;

  if (process.env.NODE_ENV !== "production") {
    const shared = getSharedFallbackSecret();
    if (shared) return shared;
    return DEV_FALLBACK_SECRET;
  }

  return "";
}

/** Primary verification secret (first attempt). Kept for existing diagnostics. */
export function getSessionSecret(): string {
  const dedicated = getDedicatedSessionSecret();
  if (dedicated) return dedicated;

  const shared = getSharedFallbackSecret();
  if (shared) return shared;

  if (process.env.NODE_ENV !== "production") return DEV_FALLBACK_SECRET;
  return "";
}

function getVerificationSecrets(): VerificationSecret[] {
  const out: VerificationSecret[] = [];
  const seen = new Set<string>();

  const push = (entry: VerificationSecret) => {
    if (!entry.secret || seen.has(entry.secret)) return;
    seen.add(entry.secret);
    out.push(entry);
  };

  const issue = getIssueSessionSecret();
  if (issue) {
    push({
      secret: issue,
      kind: "current",
      label: getDedicatedSessionSecret() ? "KRISTO_SESSION_SECRET" : "dev-or-shared",
    });
  } else {
    const verify = getSessionSecret();
    if (verify) {
      push({ secret: verify, kind: "current", label: "shared-or-dev" });
    }
  }

  for (const legacy of getLegacyVerificationSecrets()) {
    push(legacy);
  }

  return out;
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

function signatureMatches(payloadB64: string, providedSig: string, secret: string): boolean {
  const expectedSig = sign(payloadB64, secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Issue a signed token binding `userId`. Returns "" if it cannot be signed. */
export function issueSessionToken(userId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const uid = String(userId || "").trim();
  if (!uid) return "";

  const secret = getIssueSessionSecret();
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
  verifiedVia?: "current" | "legacy";
  legacySecretLabel?: string;
};

function validateVerifiedPayload(
  payload: { uid?: string; exp?: number },
  expectedUserId?: string
): SessionTokenVerification {
  const uid = String(payload?.uid || "").trim();
  if (!uid) return { ok: false, reason: "no-uid" };
  if (Number(payload?.exp || 0) < Date.now()) return { ok: false, reason: "expired" };
  if (expectedUserId && String(expectedUserId).trim() !== uid) {
    return { ok: false, reason: "uid-mismatch" };
  }
  return { ok: true, userId: uid };
}

/** Verify a signed token; optionally assert it belongs to `expectedUserId`. */
export function verifySessionToken(
  token: string,
  expectedUserId?: string
): SessionTokenVerification {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, reason: "missing" };

  const secrets = getVerificationSecrets();
  if (!secrets.length) return { ok: false, reason: "no-secret" };

  const dot = raw.indexOf(".");
  if (dot <= 0 || dot >= raw.length - 1) return { ok: false, reason: "malformed" };

  const payloadB64 = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);

  for (const candidate of secrets) {
    if (!signatureMatches(payloadB64, providedSig, candidate.secret)) continue;

    let payload: { uid?: string; exp?: number };
    try {
      payload = JSON.parse(base64urlDecode(payloadB64));
    } catch {
      return { ok: false, reason: "bad-payload" };
    }

    const validated = validateVerifiedPayload(payload, expectedUserId);
    if (!validated.ok) return validated;

    if (candidate.kind === "legacy") {
      return {
        ...validated,
        verifiedVia: "legacy",
        legacySecretLabel: candidate.label,
      };
    }

    return { ...validated, verifiedVia: "current" };
  }

  return { ok: false, reason: "bad-signature" };
}

type HeaderBag = { headers?: { get?: (key: string) => string | null } };

/**
 * Central identity resolver for header-authenticated requests.
 * Returns a trusted userId or "" when the request must be treated as anonymous.
 */
export function resolveRequestUserId(req: HeaderBag | undefined): {
  userId: string;
  via: "dev-header" | "token" | "token-only" | "none";
  reason?: string;
} {
  const headerUserId = String(req?.headers?.get?.("x-kristo-user-id") || "").trim();
  const token = String(req?.headers?.get?.("x-kristo-session-token") || "").trim();

  if (headerUserId) {
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
    if (v.ok) {
      if (v.verifiedVia === "legacy") {
        console.log("KRISTO_AUTH_LEGACY_TOKEN_ACCEPTED", {
          userId: headerUserId,
          legacySecretLabel: v.legacySecretLabel || null,
        });
      }
      return { userId: headerUserId, via: "token" };
    }

    console.warn("KRISTO_AUTH_HEADER_REJECTED", {
      headerUserId,
      hasToken: Boolean(token),
      reason: v.reason || "invalid",
      verifiedVia: v.verifiedVia || null,
      legacySecretLabel: v.legacySecretLabel || null,
    });
    return { userId: "", via: "none", reason: v.reason || "invalid-token" };
  }

  // Production-safe fallback: resolve uid from signed session token when header is missing.
  if (token) {
    const v = verifySessionToken(token);
    if (v.ok && v.userId) {
      if (v.verifiedVia === "legacy") {
        console.log("KRISTO_AUTH_LEGACY_TOKEN_ACCEPTED", {
          userId: v.userId,
          legacySecretLabel: v.legacySecretLabel || null,
          via: "token-only",
        });
      }
      return { userId: v.userId, via: "token-only" };
    }
    return { userId: "", via: "none", reason: v.reason || "invalid-token" };
  }

  return { userId: "", via: "none", reason: "no-header" };
}

/** Structured auth diagnostics for mobile/server mismatch tracing. */
export function logAuthRequestDiag(
  req: HeaderBag | undefined,
  label: string,
  extra?: Record<string, unknown>
) {
  const headerUserId = String(req?.headers?.get?.("x-kristo-user-id") || "").trim();
  const token = String(req?.headers?.get?.("x-kristo-session-token") || "").trim();
  const authorization = String(req?.headers?.get?.("authorization") || "").trim();
  const resolved = resolveRequestUserId(req);
  const verify = token
    ? verifySessionToken(token, headerUserId || undefined)
    : ({ ok: false, reason: "missing" } as SessionTokenVerification);

  console.log("KRISTO_AUTH_REQUEST_DIAG", {
    label,
    hasAuthorization: Boolean(authorization),
    authorizationPrefix: authorization ? authorization.slice(0, 12) : "",
    hasHeaderUserId: Boolean(headerUserId),
    headerUserId: headerUserId || null,
    hasSessionToken: Boolean(token),
    tokenLen: token.length,
    tokenPrefix: token.slice(0, 10),
    headerChurchId: String(req?.headers?.get?.("x-kristo-church-id") || "").trim() || null,
    headerRole: String(req?.headers?.get?.("x-kristo-role") || "").trim() || null,
    resolveVia: resolved.via,
    resolveOk: Boolean(resolved.userId),
    resolveReason: resolved.reason || null,
    verifyOk: verify.ok,
    verifyReason: verify.reason || null,
    verifiedVia: verify.verifiedVia || null,
    legacySecretLabel: verify.legacySecretLabel || null,
    trustRawHeader: shouldTrustRawHeaderIdentity(),
    hasSessionSecret: Boolean(getVerificationSecrets().length),
    legacyVerifyEnabled: getLegacyVerificationSecrets().length > 0,
    ...(extra || {}),
  });

  return { resolved, verify, token, headerUserId, authorization };
}
