/** Global toggle for extra home-feed logging in dev (off by default). */
export const KRISTO_VERBOSE_FEED_DEBUG = false;

/** Global toggle for extra RevenueCat logging in dev (off by default). */
export const KRISTO_VERBOSE_REVENUECAT_DEBUG = false;

export function isKristoVerboseFeedDebug(): boolean {
  return KRISTO_VERBOSE_FEED_DEBUG;
}

/** Slot time / expiry diagnostics (off by default). */
export const KRISTO_VERBOSE_SLOT_TIME_DEBUG = false;

export function isKristoVerboseSlotTimeDebug(): boolean {
  return KRISTO_VERBOSE_SLOT_TIME_DEBUG || KRISTO_VERBOSE_FEED_DEBUG;
}

export function shouldEnableRevenueCatDebug(_route?: string | null): boolean {
  if (process.env.EXPO_PUBLIC_KRISTO_REVENUECAT_DEBUG === "1") return true;
  if (!__DEV__) return false;
  if (_route === "payments") return true;
  return KRISTO_VERBOSE_REVENUECAT_DEBUG;
}
