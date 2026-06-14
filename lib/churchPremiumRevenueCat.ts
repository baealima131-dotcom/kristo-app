/**
 * Single source of truth for RevenueCat church premium identifiers.
 * Must match RevenueCat Dashboard → Entitlements → Identifier.
 *
 * Products must be attached to this entitlement in RevenueCat.
 * StoreKit / App Store Connect product IDs: premium_monthly, premium_yearly.
 */
export const CHURCH_PREMIUM_ENTITLEMENT = "church_premium";

export const PREMIUM_MONTHLY_PRODUCT_ID = "premium_monthly";
export const PREMIUM_YEARLY_PRODUCT_ID = "premium_yearly";

/** Expected monthly intro trial length (matches KristoSubscriptions.storekit). */
export const PREMIUM_MONTHLY_INTRO_TRIAL_DAYS = 14;

export const CHURCH_PREMIUM_PRODUCT_IDS = [
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
] as const;
