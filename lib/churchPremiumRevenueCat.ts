/**
 * Single source of truth for RevenueCat church premium identifiers.
 * Must match RevenueCat Dashboard → Entitlements → Identifier.
 *
 * Products must be attached to this entitlement in RevenueCat.
 * StoreKit / App Store Connect product IDs: premium_monthly, premium_yearly.
 */
export const CHURCH_PREMIUM_ENTITLEMENT = "church_premium";

/** Legacy RevenueCat dashboard entitlement identifier. */
export const LEGACY_PREMIUM_ENTITLEMENT = "Premium";

/** All RevenueCat entitlement keys that grant church media premium. */
export const CHURCH_PREMIUM_ENTITLEMENT_IDS = [
  CHURCH_PREMIUM_ENTITLEMENT,
  LEGACY_PREMIUM_ENTITLEMENT,
] as const;

export function isChurchPremiumEntitlementId(value: string | null | undefined): boolean {
  const id = String(value || "").trim();
  return (CHURCH_PREMIUM_ENTITLEMENT_IDS as readonly string[]).includes(id);
}

export function detectPremiumEntitlementKey(
  activeEntitlementKeys: string[]
): (typeof CHURCH_PREMIUM_ENTITLEMENT_IDS)[number] | null {
  for (const id of CHURCH_PREMIUM_ENTITLEMENT_IDS) {
    if (activeEntitlementKeys.includes(id)) return id;
  }
  return null;
}

export function hasPremiumEntitlementFromKeys(activeEntitlementKeys: string[]): boolean {
  return detectPremiumEntitlementKey(activeEntitlementKeys) !== null;
}

export const PREMIUM_MONTHLY_PRODUCT_ID = "premium_monthly";
export const PREMIUM_YEARLY_PRODUCT_ID = "premium_yearly";

/** Expected monthly intro trial length (matches KristoSubscriptions.storekit). */
export const PREMIUM_MONTHLY_INTRO_TRIAL_DAYS = 14;

export const CHURCH_PREMIUM_PRODUCT_IDS = [
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
] as const;
