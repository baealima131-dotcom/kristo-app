/**
 * Mobile-local RevenueCat church premium identifiers.
 * Values must match lib/churchPremiumRevenueCat.ts (server) and RevenueCat Dashboard.
 */
export const CHURCH_PREMIUM_ENTITLEMENT = "Premium";

/** Legacy RevenueCat dashboard entitlement identifier. */
export const LEGACY_PREMIUM_ENTITLEMENT = "church_premium";

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
