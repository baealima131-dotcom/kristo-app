import { logSubscriptionGateBlocked } from "./churchSubscriptionGate";

/** Full testing bypass: EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS=1 */
export const BYPASS_SUBSCRIPTION_FOR_TESTING =
  process.env.EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS === "1";

let loggedAppleReviewBypassCheck = false;

/**
 * App Review / testing: avoid subscription, schedule, media, and church-lock blockers.
 * Production reviewer builds: EXPO_PUBLIC_KRISTO_APP_REVIEW_MODE=1
 */
export function isAppleReviewBypassEnabled() {
  const enabled =
    process.env.EXPO_PUBLIC_KRISTO_APP_REVIEW_MODE === "1" ||
    BYPASS_SUBSCRIPTION_FOR_TESTING;

  if (!loggedAppleReviewBypassCheck) {
    loggedAppleReviewBypassCheck = true;
    console.log("KRISTO_APP_REVIEW_BYPASS_CHECK", {
      enabled,
      dev: __DEV__,
      appReviewMode: process.env.EXPO_PUBLIC_KRISTO_APP_REVIEW_MODE === "1",
      subscriptionBypassEnv: BYPASS_SUBSCRIPTION_FOR_TESTING,
    });
  }

  return enabled;
}

/** Schedule-only dev bypass (Pastor): EXPO_PUBLIC_KRISTO_DEV_BYPASS_SUBSCRIPTION=true */
function isDevScheduleBypassFlagEnabled() {
  const value = String(process.env.EXPO_PUBLIC_KRISTO_DEV_BYPASS_SUBSCRIPTION || "")
    .trim()
    .toLowerCase();
  return value === "true" || value === "1";
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
  return BYPASS_SUBSCRIPTION_FOR_TESTING || isAppleReviewBypassEnabled();
}

/**
 * Whether the live RevenueCat purchase path (configure / offerings / purchase /
 * customer info) should be DISABLED.
 *
 * Only the explicit full-testing bypass disables RevenueCat. Dev clients and
 * App Store review builds may still configure Purchases and load StoreKit
 * offerings; church/media subscription gates remain strict separately.
 */
export function isRevenueCatPurchasingDisabled() {
  return BYPASS_SUBSCRIPTION_FOR_TESTING;
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
  if (isAppleReviewBypassEnabled() && (isPastor || isApprovedMediaHost)) {
    return true;
  }
  if (BYPASS_SUBSCRIPTION_FOR_TESTING) {
    return isPastor || isApprovedMediaHost;
  }
  return false;
}
