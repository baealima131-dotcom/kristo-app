/** Full bypass: EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS=1 */
export const BYPASS_SUBSCRIPTION_FOR_TESTING =
  process.env.EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS === "1";

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
  return BYPASS_SUBSCRIPTION_FOR_TESTING;
}

/** Pastor schedule/live-media gate bypass for local testing only. */
export function isScheduleSubscriptionBypassEnabled(isPastor = false) {
  if (isSubscriptionBypassEnabled()) {
    return true;
  }

  if (__DEV__ && isDevScheduleBypassFlagEnabled() && isPastor) {
    logSubscriptionGateBypassedForTest("schedule", { isPastor: true });
    return true;
  }

  return false;
}

/** When true, skip premium alerts, paywall redirects, and purchase prompts. */
export function shouldSuppressPremiumPrompts() {
  return isSubscriptionBypassEnabled();
}
