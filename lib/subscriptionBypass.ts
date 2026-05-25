/** TEMP: flip to false before production release. Mirrors mobile testing bypass. */
export const BYPASS_SUBSCRIPTION_FOR_TESTING = true;

export function isSubscriptionBypassEnabled() {
  if (BYPASS_SUBSCRIPTION_FOR_TESTING === true) return true;
  return process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING === "1";
}
