export function isSubscriptionBypassEnabled() {
  return (
    typeof __DEV__ !== "undefined" &&
    __DEV__ &&
    String(process.env.EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS || "").trim() === "1"
  );
}

export function shouldSuppressPremiumPrompts() {
  return false;
}
