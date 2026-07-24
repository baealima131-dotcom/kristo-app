/**
 * Mobile-local RevenueCat church premium identifiers.
 * Values must match lib/churchPremiumRevenueCat.ts (server) and RevenueCat Dashboard.
 *
 * iOS new-purchase slot order (monthly only):
 *   1) premium_monthly
 *   2–5) church_premium_monthly_g2…g5
 * premium_yearly is recognition-only and is never offered for new iOS purchases.
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

/** The only product offered for new iOS monthly purchases + Android monthly product. */
export const PREMIUM_MONTHLY_PRODUCT_ID = "premium_monthly";
/** Recognition only on iOS — never offered or purchased for new iOS subs. */
export const PREMIUM_YEARLY_PRODUCT_ID = "premium_yearly";

/** Expected monthly intro trial length (matches StoreKit intro offers on premium_monthly). */
export const PREMIUM_MONTHLY_INTRO_TRIAL_DAYS = 14;

export const IOS_PREMIUM_ROTATION_GROUPS = ["g2", "g3", "g4", "g5"] as const;
export type IosPremiumRotationGroup = (typeof IOS_PREMIUM_ROTATION_GROUPS)[number];

export type IosPremiumPurchaseSlotGroup = "legacy" | IosPremiumRotationGroup;

export const IOS_PREMIUM_MONTHLY_PRODUCT_ID_G2 = "church_premium_monthly_g2";
export const IOS_PREMIUM_MONTHLY_PRODUCT_ID_G3 = "church_premium_monthly_g3";
export const IOS_PREMIUM_MONTHLY_PRODUCT_ID_G4 = "church_premium_monthly_g4";
export const IOS_PREMIUM_MONTHLY_PRODUCT_ID_G5 = "church_premium_monthly_g5";

export const IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP = {
  g2: IOS_PREMIUM_MONTHLY_PRODUCT_ID_G2,
  g3: IOS_PREMIUM_MONTHLY_PRODUCT_ID_G3,
  g4: IOS_PREMIUM_MONTHLY_PRODUCT_ID_G4,
  g5: IOS_PREMIUM_MONTHLY_PRODUCT_ID_G5,
} as const satisfies Record<IosPremiumRotationGroup, string>;

export const IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS = [
  IOS_PREMIUM_MONTHLY_PRODUCT_ID_G2,
  IOS_PREMIUM_MONTHLY_PRODUCT_ID_G3,
  IOS_PREMIUM_MONTHLY_PRODUCT_ID_G4,
  IOS_PREMIUM_MONTHLY_PRODUCT_ID_G5,
] as const;

export const IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS = [
  PREMIUM_MONTHLY_PRODUCT_ID,
] as const;

export const IOS_SUBSCRIPTION_SLOTS_EXHAUSTED = "IOS_SUBSCRIPTION_SLOTS_EXHAUSTED";

/** Monthly IDs retained for legacy entitlement, ownership inspection, and restore. */
export const IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS = [
  PREMIUM_MONTHLY_PRODUCT_ID,
  ...IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS,
] as const;

export const LEGACY_CHURCH_PREMIUM_PRODUCT_IDS = [
  PREMIUM_MONTHLY_PRODUCT_ID,
  ...IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS,
  PREMIUM_YEARLY_PRODUCT_ID,
] as const;

export const CHURCH_PREMIUM_PRODUCT_IDS = [
  ...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS,
  PREMIUM_YEARLY_PRODUCT_ID,
] as const;

export function isIosPremiumRotationMonthlyProductId(
  productId: string | null | undefined
): boolean {
  const id = String(productId || "").trim();
  return (IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS as readonly string[]).includes(id);
}

export function isIosPremiumPurchaseSlotProductId(
  productId: string | null | undefined
): boolean {
  const id = String(productId || "").trim();
  return (IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS as readonly string[]).includes(id);
}

export function isIosPremiumRecognizedMonthlyProductId(
  productId: string | null | undefined
): boolean {
  const id = String(productId || "").trim();
  return (IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS as readonly string[]).includes(id);
}

export function isLegacyChurchPremiumProductId(
  productId: string | null | undefined
): boolean {
  const id = String(productId || "").trim();
  return (LEGACY_CHURCH_PREMIUM_PRODUCT_IDS as readonly string[]).includes(id);
}

export function isChurchPremiumProductId(productId: string | null | undefined): boolean {
  const id = String(productId || "").trim();
  if (!id) return false;
  if ((CHURCH_PREMIUM_PRODUCT_IDS as readonly string[]).includes(id)) return true;
  return (
    /^church_premium_monthly_g[2-5]$/i.test(id) ||
    /premium_monthly|premium_yearly|\$rc_monthly|\$rc_annual/i.test(id)
  );
}

export function isYearlyChurchPremiumProductId(
  productId: string | null | undefined
): boolean {
  const id = String(productId || "").trim();
  if (!id) return false;
  if (id === PREMIUM_YEARLY_PRODUCT_ID) return true;
  return /premium_yearly|yearly|annual|\$rc_annual/i.test(id);
}

export function isMonthlyChurchPremiumProductId(
  productId: string | null | undefined
): boolean {
  const id = String(productId || "").trim();
  if (!id) return false;
  if (isYearlyChurchPremiumProductId(id)) return false;
  if (isIosPremiumRecognizedMonthlyProductId(id)) return true;
  return /church_premium_monthly_g[2-5]|premium_monthly|monthly|\$rc_monthly/i.test(id);
}

export function iosPremiumGroupFromProductId(
  productId: string | null | undefined
): IosPremiumRotationGroup | null {
  const id = String(productId || "").trim();
  for (const group of IOS_PREMIUM_ROTATION_GROUPS) {
    if (IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP[group] === id) return group;
  }
  return null;
}

export function iosPremiumPurchaseSlotGroupFromProductId(
  productId: string | null | undefined
): IosPremiumPurchaseSlotGroup | null {
  const id = String(productId || "").trim();
  if (id === PREMIUM_MONTHLY_PRODUCT_ID) return "legacy";
  return iosPremiumGroupFromProductId(id);
}
