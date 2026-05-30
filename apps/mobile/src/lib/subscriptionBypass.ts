/** Default off for V1 launch. Set EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS=1 to bypass in dev. */
export const BYPASS_SUBSCRIPTION_FOR_TESTING = false;

export function isSubscriptionBypassEnabled() {
  if (BYPASS_SUBSCRIPTION_FOR_TESTING === true) return true;
  return process.env.EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS === "1";
}

/** When true, skip premium alerts, paywall redirects, and purchase prompts. */
export function shouldSuppressPremiumPrompts() {
  return isSubscriptionBypassEnabled();
}
