/** Global toggle for extra home-feed logging in dev (off by default). */
export const KRISTO_VERBOSE_FEED_DEBUG = false;

export function isKristoVerboseFeedDebug(): boolean {
  return __DEV__ && KRISTO_VERBOSE_FEED_DEBUG;
}

/** Slot time / expiry diagnostics (off by default). */
export const KRISTO_VERBOSE_SLOT_TIME_DEBUG = false;

export function isKristoVerboseSlotTimeDebug(): boolean {
  return KRISTO_VERBOSE_SLOT_TIME_DEBUG || KRISTO_VERBOSE_FEED_DEBUG;
}

/** Video controller register/pause/guard logs (off by default). */
export function isKristoVerboseVideoControllerDebug(): boolean {
  return KRISTO_VERBOSE_FEED_DEBUG;
}

/** Avatar resolve + comment count source logs (off by default). */
export function isKristoVerboseFeedIdentityDebug(): boolean {
  return KRISTO_VERBOSE_FEED_DEBUG;
}
