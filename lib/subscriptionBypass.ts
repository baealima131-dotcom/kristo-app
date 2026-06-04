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

/** Default off for V1 launch. Set KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING=1 for full bypass. */
export const BYPASS_SUBSCRIPTION_FOR_TESTING =
  process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING === "1";

export function isSubscriptionBypassEnabled() {
  if (BYPASS_SUBSCRIPTION_FOR_TESTING) return true;
  if (isNonProductionRuntime() && isDevScheduleBypassFlagEnabled()) {
    console.log("KRISTO_SUBSCRIPTION_GATE_BYPASSED_FOR_TEST", {
      scope: "server-church-subscription",
    });
    return true;
  }
  return false;
}
