import { logSubscriptionGateBlocked } from "./churchSubscriptionGate";

/** Full testing bypass: EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS=1 */
export const BYPASS_SUBSCRIPTION_FOR_TESTING =
  process.env.EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS === "1";

const APP_STORE_REVIEW_EAS_PROFILE = "app-store-review";
const PRODUCTION_EAS_PROFILE = "production";

function getEasBuildProfile(): string {
  return String(process.env.EAS_BUILD_PROFILE || "").trim();
}

function isProductionEasBuildProfile(): boolean {
  return getEasBuildProfile() === PRODUCTION_EAS_PROFILE;
}

function isAppStoreReviewEasBuildProfile(): boolean {
  return getEasBuildProfile() === APP_STORE_REVIEW_EAS_PROFILE;
}

function isAppReviewModeEnvEnabled(): boolean {
  return process.env.EXPO_PUBLIC_KRISTO_APP_REVIEW_MODE === "1";
}

/**
 * True only for the dedicated App Store review EAS profile (never production/TestFlight).
 * EXPO_PUBLIC_KRISTO_DEV_BYPASS_SUBSCRIPTION is intentionally unused — schedule gates stay strict.
 */
export function isAppleReviewBypassEnabled() {
  logAppleReviewBypassCheckOnce();

  if (BYPASS_SUBSCRIPTION_FOR_TESTING) {
    if (isProductionEasBuildProfile()) {
      return false;
    }
    return true;
  }

  if (!isAppReviewModeEnvEnabled()) {
    return false;
  }

  return isAppStoreReviewEasBuildProfile();
}

let loggedSubscriptionBypassWarning = false;

/** Loud warning when subscription bypass env vars are enabled — never silent in production. */
export function logSubscriptionBypassIfEnabled() {
  if (loggedSubscriptionBypassWarning) return;

  const mobileBypass = BYPASS_SUBSCRIPTION_FOR_TESTING;
  const appReviewMode = isAppReviewModeEnvEnabled();
  const backendBypassNote =
    "KRISTO_SUBSCRIPTION_BYPASS is server-only; mobile cannot read it — check server logs.";

  if (mobileBypass || appReviewMode) {
    loggedSubscriptionBypassWarning = true;
    console.warn("KRISTO_SUBSCRIPTION_BYPASS_ENABLED", {
      mobileBypass,
      appReviewMode,
      easBuildProfile: getEasBuildProfile() || null,
      bypassActiveInThisBuild: isSubscriptionBypassEnabled(),
      expoPublicKristoSubscriptionBypass: process.env.EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS ?? null,
      expoPublicKristoAppReviewMode: process.env.EXPO_PUBLIC_KRISTO_APP_REVIEW_MODE ?? null,
      dev: __DEV__,
      backendBypassNote,
    });
  }
}

let loggedAppleReviewBypassCheck = false;

export function logAppleReviewBypassCheckOnce() {
  if (loggedAppleReviewBypassCheck) return;
  loggedAppleReviewBypassCheck = true;
  logSubscriptionBypassIfEnabled();
  console.log("KRISTO_APP_REVIEW_BYPASS_CHECK", {
    enabled: isAppleReviewBypassEnabled(),
    dev: __DEV__,
    easBuildProfile: getEasBuildProfile() || null,
    appReviewMode: isAppReviewModeEnvEnabled(),
    subscriptionBypassEnv: BYPASS_SUBSCRIPTION_FOR_TESTING,
    productionBuildProfile: isProductionEasBuildProfile(),
    appStoreReviewBuildProfile: isAppStoreReviewEasBuildProfile(),
  });
}

const loggedBypassScopes = new Set<string>();

export function logSubscriptionGateBypassedForTest(
  scope: string,
  details: Record<string, unknown> = {}
) {
  const key = `${scope}:${JSON.stringify(details)}`;
  if (loggedBypassScopes.has(key)) return;
  loggedBypassScopes.add(key);
  console.log("KRISTO_SUBSCRIPTION_GATE_BYPASSED_FOR_TEST", {
    scope,
    ...details,
  });
}

export function isSubscriptionBypassEnabled() {
  return isAppleReviewBypassEnabled();
}

/**
 * Whether the live RevenueCat purchase path (configure / offerings / purchase /
 * customer info) should be DISABLED.
 *
 * Only the explicit full-testing bypass disables RevenueCat, and never on the
 * production EAS profile (App Store / Play store releases).
 */
export function isRevenueCatPurchasingDisabled() {
  if (!BYPASS_SUBSCRIPTION_FOR_TESTING) return false;
  if (isProductionEasBuildProfile()) return false;
  return true;
}

export type ChurchMediaSubscriptionGateResult = {
  subscriptionAllowed: boolean;
  bypassed: boolean;
  reason: string;
};

export type ChurchMediaSubscriptionGateContext = {
  isPastor?: boolean;
  isApprovedMediaHost?: boolean;
  churchSubscriptionActive?: boolean | null;
  screen?: string;
  gate?: string;
  churchId?: string;
};

/**
 * Church-level subscription entitlement for media/live.
 * V1: always requires churchSubscriptionActive === true — dev/review bypass never applies here.
 */
export function evaluateChurchMediaSubscriptionGate(
  ctx: ChurchMediaSubscriptionGateContext
): ChurchMediaSubscriptionGateResult {
  const isPastor = ctx.isPastor === true;
  const isApprovedMediaHost = ctx.isApprovedMediaHost === true;
  const churchSubscriptionActive = ctx.churchSubscriptionActive ?? null;
  const gate = String(ctx.gate || "unknown");

  console.log("KRISTO_SUBSCRIPTION_GATE_CHECK", {
    screen: ctx.screen || null,
    gate,
    churchId: ctx.churchId || null,
    isPastor,
    isApprovedMediaHost,
    testingBypass: false,
    churchSubscriptionActive,
  });

  if (isPastor || isApprovedMediaHost) {
    if (churchSubscriptionActive === true) {
      if (isApprovedMediaHost && !isPastor) {
        console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_ALLOWED", {
          mode: "church_subscription_active",
          gate,
          churchId: ctx.churchId || null,
        });
      }
      return {
        subscriptionAllowed: true,
        bypassed: false,
        reason: "church_active",
      };
    }

    logSubscriptionGateBlocked(gate, churchSubscriptionActive, {
      screen: ctx.screen || null,
      churchId: ctx.churchId || null,
      isPastor,
      isApprovedMediaHost,
      reason: "church_subscription_inactive",
    });
    return {
      subscriptionAllowed: false,
      bypassed: false,
      reason: "church_inactive",
    };
  }

  logSubscriptionGateBlocked(gate, churchSubscriptionActive, {
    screen: ctx.screen || null,
    reason: "not_pastor_or_approved_host",
  });
  return {
    subscriptionAllowed: false,
    bypassed: false,
    reason: "not_media_role",
  };
}

/** Media/live schedule gates never honor dev or review subscription bypass in V1. */
export function isScheduleSubscriptionBypassEnabled(
  _isPastor = false,
  _isApprovedMediaHost = false
) {
  return false;
}

/** Skip premium alerts for Pastor/approved host when testing bypass is on. */
export function shouldSuppressPremiumPrompts(
  isPastor = false,
  isApprovedMediaHost = false
) {
  if (!isAppleReviewBypassEnabled()) return false;
  return isPastor || isApprovedMediaHost;
}
