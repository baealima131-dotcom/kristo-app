/** Default off for V1 launch. Set env to enable dev bypass only. */
export const BYPASS_SUBSCRIPTION_FOR_TESTING = false;

export function isSubscriptionBypassEnabled() {
  if (BYPASS_SUBSCRIPTION_FOR_TESTING === true) return true;
  return process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING === "1";
}
