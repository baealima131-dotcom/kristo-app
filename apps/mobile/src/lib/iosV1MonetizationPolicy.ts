/**
 * Client iOS V1 monetization policy — FREE launch.
 *
 * Media Premium IAP / paywall / trial / purchase / restore are disabled on iOS
 * for V1. Features that were subscription-gated unlock because monetization is
 * off — not because we fake RevenueCat entitlements or flip DB subscriptionActive.
 *
 * Server trust for gated APIs requires HMAC proof (see mintIosV1FreeProofHeaderValue)
 * plus KRISTO_IOS_V1_FREE_MONETIZATION=1. Platform header alone is never enough.
 *
 * Android keeps the full purchase + entitlement path.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { hmacSha256Hex } from "./iosV1FreeProofHmac";

/** True when this build is running on iOS and V1 free monetization applies. */
export function isIosV1MonetizationDisabled(): boolean {
  return Platform.OS === "ios";
}

/** Hide Payments / Subscriptions / paywall / trial / price CTAs on iOS V1. */
export function shouldHideIosSubscriptionUi(): boolean {
  return isIosV1MonetizationDisabled();
}

/**
 * Skip RevenueCat configure / offerings / purchase / restore on iOS V1.
 * Android is unchanged.
 */
export function shouldSkipRevenueCatPurchasingOnIos(): boolean {
  return isIosV1MonetizationDisabled();
}

/**
 * Client-side feature gates: allow media/live/ministry tools on iOS V1 when the
 * user has the right role, without requiring churchSubscriptionActive.
 */
export function isIosV1PremiumFeatureUnlocked(): boolean {
  return isIosV1MonetizationDisabled();
}

/** Header value sent to the API so server can apply the same policy. */
export const KRISTO_CLIENT_PLATFORM_HEADER = "x-kristo-client-platform" as const;
export const KRISTO_IOS_V1_FREE_PROOF_HEADER = "x-kristo-ios-v1-free-proof" as const;

export function getKristoClientPlatformHeaderValue(): "ios" | "android" | "web" | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "web") return "web";
  return "unknown";
}

const PROOF_PURPOSE = "ios_v1_free";
const PROOF_VERSION = "v1";
const DEV_FALLBACK_PROOF_SECRET = "kristo-dev-ios-v1-free-proof-not-for-production";

function utcDayString(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function getIosV1FreeProofSecret(): string {
  // iOS EAS profile only — Android builds must leave this unset.
  // Prefer expoConfig.extra, then legacy manifest extras (dev client can expose either).
  const expoExtra =
    (Constants.expoConfig?.extra as Record<string, string | undefined> | undefined) || {};
  const manifestExtra =
    ((Constants.manifest as { extra?: Record<string, string | undefined> } | null)?.extra) || {};
  const manifest2Extra =
    (
      (Constants as { manifest2?: { extra?: { expoClient?: { extra?: Record<string, string | undefined> } } } })
        .manifest2?.extra?.expoClient?.extra
    ) || {};
  const fromExtra = String(
    expoExtra.iosV1FreeProofSecret ||
      manifestExtra.iosV1FreeProofSecret ||
      manifest2Extra.iosV1FreeProofSecret ||
      ""
  ).trim();
  if (fromExtra) return fromExtra;
  const fromEnv = String(process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  if (__DEV__) return DEV_FALLBACK_PROOF_SECRET;
  return "";
}

/** Presence-only — never log secret or proof values. */
export function describeIosV1FreeProofSecretSource(): "extra" | "env" | "dev_fallback" | "missing" {
  const expoExtra =
    (Constants.expoConfig?.extra as Record<string, string | undefined> | undefined) || {};
  const manifestExtra =
    ((Constants.manifest as { extra?: Record<string, string | undefined> } | null)?.extra) || {};
  const manifest2Extra =
    (
      (Constants as { manifest2?: { extra?: { expoClient?: { extra?: Record<string, string | undefined> } } } })
        .manifest2?.extra?.expoClient?.extra
    ) || {};
  if (
    String(
      expoExtra.iosV1FreeProofSecret ||
        manifestExtra.iosV1FreeProofSecret ||
        manifest2Extra.iosV1FreeProofSecret ||
        ""
    ).trim()
  ) {
    return "extra";
  }
  if (String(process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET || "").trim()) return "env";
  if (__DEV__) return "dev_fallback";
  return "missing";
}

/**
 * Mint daily HMAC proof for authenticated iOS V1 free API calls.
 * Empty on Android / when secret is absent (fail closed server-side).
 */
export function mintIosV1FreeProofHeaderValue(userId: string): string {
  if (!isIosV1MonetizationDisabled()) return "";
  const uid = String(userId || "").trim();
  const secret = getIosV1FreeProofSecret();
  if (!uid || !secret) return "";

  const day = utcDayString(0);
  const message = `${PROOF_PURPOSE}|${PROOF_VERSION}|${uid}|${day}`;
  const mac = hmacSha256Hex(secret, message);
  if (!mac) return "";
  return `${PROOF_VERSION}.${day}.${mac}`;
}
