/**
 * Server-side iOS V1 monetization policy — FREE launch.
 *
 * Trust model (do NOT trust client platform header alone):
 * 1. Kill switch: KRISTO_IOS_V1_FREE_MONETIZATION=1 (fail closed when unset)
 * 2. HMAC proof: x-kristo-ios-v1-free-proof bound to verified userId
 *    using KRISTO_IOS_V1_FREE_PROOF_SECRET (iOS EAS builds only; Android
 *    builds must not receive this secret)
 *
 * Residual risk: a determined attacker who extracts the proof secret from an
 * IPA can mint proofs. App Attest / DeviceCheck is the hardening path for V1.5.
 * Spoofing via `x-kristo-client-platform: ios` alone is rejected.
 *
 * Does not write subscriptionActive or fabricate RevenueCat entitlements.
 */
import crypto from "crypto";

export const KRISTO_CLIENT_PLATFORM_HEADER = "x-kristo-client-platform";
export const KRISTO_IOS_V1_FREE_PROOF_HEADER = "x-kristo-ios-v1-free-proof";

export type KristoClientPlatform = "ios" | "android" | "web" | "unknown";

/** Sanitized gate outcomes — never include secret, proof, or raw HMAC. */
export type IosV1SubscriptionGateReason =
  | "kill_switch_disabled"
  | "proof_missing"
  | "proof_malformed"
  | "proof_expired"
  | "user_mismatch"
  | "invalid_mac"
  | "gate_allowed";

const PROOF_PURPOSE = "ios_v1_free";
const PROOF_VERSION = "v1";
const DEV_FALLBACK_PROOF_SECRET = "kristo-dev-ios-v1-free-proof-not-for-production";

function normalizePlatform(value: unknown): KristoClientPlatform {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "ios") return "ios";
  if (raw === "android") return "android";
  if (raw === "web") return "web";
  return "unknown";
}

function readHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined,
  name: string
): string {
  if (!headers) return "";

  if (typeof (headers as Headers).get === "function") {
    return String((headers as Headers).get(name) || "").trim();
  }

  const record = headers as Record<string, string | string[] | undefined>;
  const direct =
    record[name] ??
    record[name.toLowerCase()] ??
    record[name.replace(/(^|-)([a-z])/g, (_, p1, p2) => p1 + String(p2).toUpperCase())];
  if (Array.isArray(direct)) return String(direct[0] || "").trim();
  return String(direct || "").trim();
}

export function readKristoClientPlatform(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined
): KristoClientPlatform {
  return normalizePlatform(readHeaderValue(headers, KRISTO_CLIENT_PLATFORM_HEADER));
}

/** True when server ops explicitly enabled iOS V1 free monetization. */
export function isIosV1FreeMonetizationEnabled(): boolean {
  const raw = String(process.env.KRISTO_IOS_V1_FREE_MONETIZATION || "").trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  // Unset: fail closed in production; allow local/dev without extra env.
  return process.env.NODE_ENV !== "production";
}

function getIosV1FreeProofSecret(): string {
  const dedicated = String(process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET || "").trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV !== "production") return DEV_FALLBACK_PROOF_SECRET;
  return "";
}

function utcDayString(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function buildIosV1FreeProofMessage(userId: string, day: string): string {
  return `${PROOF_PURPOSE}|${PROOF_VERSION}|${String(userId || "").trim()}|${day}`;
}

export function mintIosV1FreeProof(userId: string, day = utcDayString(0), secret?: string): string {
  const key = String(secret || getIosV1FreeProofSecret() || "").trim();
  const uid = String(userId || "").trim();
  if (!key || !uid) return "";
  const mac = crypto
    .createHmac("sha256", key)
    .update(buildIosV1FreeProofMessage(uid, day), "utf8")
    .digest("hex");
  return `${PROOF_VERSION}.${day}.${mac}`;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(String(a || ""), "utf8");
    const right = Buffer.from(String(b || ""), "utf8");
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/** Advisory only — never sufficient for subscription bypass. */
export function isIosV1ClientRequest(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined
): boolean {
  return readKristoClientPlatform(headers) === "ios";
}

export type IosV1BypassContext = {
  /** Verified user id from auth/guard — not an untrusted spoofable claim alone. */
  userId?: string | null;
};

/**
 * Full sanitized diagnosis for subscription-gate bypass decisions.
 * Safe to log — never includes secret, proof header, or MAC bytes.
 */
export function diagnoseIosV1SubscriptionGateBypass(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined,
  ctx?: IosV1BypassContext
): { allowed: boolean; reason: IosV1SubscriptionGateReason } {
  if (!isIosV1FreeMonetizationEnabled()) {
    return { allowed: false, reason: "kill_switch_disabled" };
  }

  const userId = String(ctx?.userId || "").trim();
  if (!userId) {
    return { allowed: false, reason: "user_mismatch" };
  }

  const proof = readHeaderValue(headers, KRISTO_IOS_V1_FREE_PROOF_HEADER);
  if (!proof) {
    return { allowed: false, reason: "proof_missing" };
  }

  const parts = proof.split(".");
  if (parts.length !== 3) {
    return { allowed: false, reason: "proof_malformed" };
  }
  const [version, day, mac] = parts;
  if (version !== PROOF_VERSION || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[a-f0-9]{64}$/i.test(mac)) {
    return { allowed: false, reason: "proof_malformed" };
  }

  const today = utcDayString(0);
  const yesterday = utcDayString(-1);
  if (day !== today && day !== yesterday) {
    return { allowed: false, reason: "proof_expired" };
  }

  const secret = getIosV1FreeProofSecret();
  if (!secret) {
    return { allowed: false, reason: "invalid_mac" };
  }

  const expected = mintIosV1FreeProof(userId, day, secret);
  if (!expected) {
    return { allowed: false, reason: "invalid_mac" };
  }
  const expectedMac = expected.split(".")[2] || "";
  if (!timingSafeEqualHex(mac.toLowerCase(), expectedMac.toLowerCase())) {
    return { allowed: false, reason: "invalid_mac" };
  }

  return { allowed: true, reason: "gate_allowed" };
}

export function verifyIosV1FreeProof(proof: string, userId: string): boolean {
  return diagnoseIosV1SubscriptionGateBypass(
    { [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof },
    { userId }
  ).allowed;
}

/**
 * Subscription feature gates may allow iOS V1 free clients through when:
 * - kill switch is on, AND
 * - HMAC proof verifies for the authenticated userId.
 *
 * Platform header alone is never enough (Android/API clients can spoof it).
 */
export function isIosV1SubscriptionGateBypassed(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined,
  ctx?: IosV1BypassContext
): boolean {
  return diagnoseIosV1SubscriptionGateBypass(headers, ctx).allowed;
}
