const EXPO_STRIPE_PUBLISHABLE_KEY = String(
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
).trim();

export const STRIPE_URL_SCHEME = "mobile";

export function getExpoStripePublishableKey() {
  return EXPO_STRIPE_PUBLISHABLE_KEY;
}

export function expoStripePublishableMode() {
  if (EXPO_STRIPE_PUBLISHABLE_KEY.startsWith("pk_test_")) return "test" as const;
  if (EXPO_STRIPE_PUBLISHABLE_KEY.startsWith("pk_live_")) return "live" as const;
  return null;
}

export function isExpoStripePublishableConfigured() {
  return expoStripePublishableMode() !== null;
}

export function expoStripeModeMatchesLivemode(livemode: boolean) {
  const mode = expoStripePublishableMode();
  if (!mode) return false;
  return livemode ? mode === "live" : mode === "test";
}

export function stripeCardCheckoutConfigMessage() {
  if (!isExpoStripePublishableConfigured()) {
    return "Card checkout is not configured yet.";
  }
  return "";
}
