/** TEMP: flip to false before production release. */
export const BYPASS_SUBSCRIPTION_FOR_TESTING = true;

export function isSubscriptionBypassEnabled() {
  return BYPASS_SUBSCRIPTION_FOR_TESTING === true;
}

/** When true, skip premium alerts, paywall redirects, and purchase prompts. */
export function shouldSuppressPremiumPrompts() {
  return isSubscriptionBypassEnabled();
}
