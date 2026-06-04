/** Server dev bypass: KRISTO_DEV_BYPASS_SUBSCRIPTION=true (non-production only). */
function isDevScheduleBypassFlagEnabled() {
  const value = String(process.env.KRISTO_DEV_BYPASS_SUBSCRIPTION || "")
    .trim()
    .toLowerCase();
  return value === "true" || value === "1";
}

function isNonProductionRuntime() {
  return process.env.NODE_ENV !== "production";
}

/** Testing: KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING=1 */
export const BYPASS_SUBSCRIPTION_FOR_TESTING =
  process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING === "1";

let loggedServerReviewBypassCheck = false;

export function isAppleReviewBypassEnabled() {
  const enabled = BYPASS_SUBSCRIPTION_FOR_TESTING;
  if (!loggedServerReviewBypassCheck) {
    loggedServerReviewBypassCheck = true;
    console.log("KRISTO_APP_REVIEW_BYPASS_CHECK", {
      scope: "server",
      enabled,
      bypassEnv: BYPASS_SUBSCRIPTION_FOR_TESTING,
    });
  }
  return enabled;
}

export function isSubscriptionBypassEnabled() {
  if (isAppleReviewBypassEnabled()) return true;
  if (isNonProductionRuntime() && isDevScheduleBypassFlagEnabled()) {
    console.log("KRISTO_SUBSCRIPTION_BYPASSED_FOR_TESTING", {
      scope: "server-dev-schedule-env",
    });
    return true;
  }
  return false;
}

export type ServerSubscriptionGateContext = {
  churchId?: string;
  isPastor?: boolean;
  isMediaHost?: boolean;
  gate?: string;
};

export function logServerSubscriptionGateCheck(ctx: ServerSubscriptionGateContext) {
  console.log("KRISTO_SUBSCRIPTION_GATE_CHECK", {
    scope: "server",
    churchId: ctx.churchId || null,
    gate: ctx.gate || null,
    isPastor: ctx.isPastor === true,
    isMediaHost: ctx.isMediaHost === true,
    testingBypass: isSubscriptionBypassEnabled(),
  });
}

export function isServerSubscriptionGateBypassed(ctx: ServerSubscriptionGateContext = {}) {
  if (!isSubscriptionBypassEnabled()) return false;

  logServerSubscriptionGateCheck(ctx);

  const isPastor = ctx.isPastor === true;
  const isMediaHost = ctx.isMediaHost === true;

  if (isPastor || isMediaHost || (ctx.isPastor === undefined && ctx.isMediaHost === undefined)) {
    console.log("KRISTO_SUBSCRIPTION_BYPASSED_FOR_TESTING", {
      scope: "server",
      churchId: ctx.churchId || null,
      gate: ctx.gate || null,
      isPastor,
      isMediaHost,
      globalBypass: ctx.isPastor === undefined && ctx.isMediaHost === undefined,
    });
    if (isMediaHost && !isPastor) {
      console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_ALLOWED", {
        scope: "server",
        churchId: ctx.churchId || null,
        gate: ctx.gate || null,
      });
    }
    return true;
  }

  console.log("KRISTO_MEDIA_HOST_SUBSCRIPTION_BLOCKED", {
    scope: "server",
    reason: "testing_bypass_requires_pastor_or_media_host",
    churchId: ctx.churchId || null,
    gate: ctx.gate || null,
  });
  return false;
}
