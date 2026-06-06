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
    __DEV__ ||
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
 * IMPORTANT: App Store review builds use EXPO_PUBLIC_KRISTO_APP_REVIEW_MODE=1 to
 * relax church feature gating, but reviewers MUST still be able to load store
 * packages and complete a real StoreKit purchase. So review mode does NOT
 * disable purchasing here. We only disable RevenueCat for local dev (no StoreKit
 * configured) or the explicit full-testing bypass.
 */
export function isRevenueCatPurchasingDisabled() {
  return __DEV__ || BYPASS_SUBSCRIPTION_FOR_TESTING;
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
 * Church-level subscription entitlement.
 * Testing bypass: Pastor OR approved Media Host of the church.
 * Production: Pastor pays; hosts use Media/Schedule only when church subscription is active.
 */
export function evaluateChurchMediaSubscriptionGate(
  ctx: ChurchMediaSubscriptionGateContext
): ChurchMediaSubscriptionGateResult {
  const isPastor = ctx.isPastor === true;
  const isApprovedMediaHost = ctx.isApprovedMediaHost === true;
  const testingBypass = isAppleReviewBypassEnabled();
  const churchActive = ctx.churchSubscriptionActive === true;

  console.log("KRISTO_SUBSCRIPTION_GATE_CHECK", {
    screen: ctx.screen || null,
    gate: ctx.gate || null,
    churchId: ctx.churchId || null,
    isPastor,
    isApprovedMediaHost,
    testingBypass,
    churchSubscriptionActive: ctx.churchSubscriptionActive ?? null,
  });

  if (testingBypass) {
    if (isPastor || isApprovedMediaHost) {
      console.log("KRISTO_SUBSCRIPTION_BYPASSED_FOR_TESTING", {
        screen: ctx.screen || null,
        gate: ctx.gate || null,
        churchId: ctx.churchId || null,
        isPastor,
        isApprovedMediaHost,
      });
      if (isApprovedMediaHost && !isPastor) {
        console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_ALLOWED", {
          mode: "testing_bypass",
          gate: ctx.gate || null,
          churchId: ctx.churchId || null,
        });
      }
      return {
        subscriptionAllowed: true,
        bypassed: true,
        reason: "testing_bypass",
      };
    }

    console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_BLOCKED", {
      reason: "testing_bypass_requires_pastor_or_approved_host",
      screen: ctx.screen || null,
      gate: ctx.gate || null,
      isPastor,
      isApprovedMediaHost,
    });
    return {
      subscriptionAllowed: false,
      bypassed: false,
      reason: "not_media_role",
    };
  }

  if (isPastor || isApprovedMediaHost) {
    if (churchActive) {
      if (isApprovedMediaHost && !isPastor) {
        console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_ALLOWED", {
          mode: "church_subscription_active",
          gate: ctx.gate || null,
          churchId: ctx.churchId || null,
        });
      }
      return {
        subscriptionAllowed: true,
        bypassed: false,
        reason: "church_active",
      };
    }

    console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_BLOCKED", {
      reason: "church_subscription_inactive",
      screen: ctx.screen || null,
      gate: ctx.gate || null,
      isPastor,
      isApprovedMediaHost,
    });
    return {
      subscriptionAllowed: false,
      bypassed: false,
      reason: "church_inactive",
    };
  }

  console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_BLOCKED", {
    reason: "not_pastor_or_approved_host",
    gate: ctx.gate || null,
  });
  return {
    subscriptionAllowed: false,
    bypassed: false,
    reason: "not_media_role",
  };
}

/** Schedule/live-media gate bypass for Pastor or approved Media Host during testing. */
export function isScheduleSubscriptionBypassEnabled(
  isPastor = false,
  isApprovedMediaHost = false
) {
  if (isAppleReviewBypassEnabled() && (isPastor || isApprovedMediaHost)) {
    logSubscriptionGateBypassedForTest("schedule-review", { isPastor, isApprovedMediaHost });
    return true;
  }

  if (BYPASS_SUBSCRIPTION_FOR_TESTING) {
    return evaluateChurchMediaSubscriptionGate({
      isPastor,
      isApprovedMediaHost,
      gate: "isScheduleSubscriptionBypassEnabled",
    }).bypassed;
  }

  if (__DEV__ && isDevScheduleBypassFlagEnabled() && isPastor) {
    logSubscriptionGateBypassedForTest("schedule-dev-pastor", { isPastor: true });
    return true;
  }

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
