import Purchases, {
  LOG_LEVEL,
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
  PACKAGE_TYPE,
} from "react-native-purchases";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { PlanStatus, SubscriptionPlanKey } from "../../store/paymentsStore";
import {
  isRevenueCatPurchasingDisabled,
  isSubscriptionBypassEnabled,
} from "../subscriptionBypass";
import { shouldEnableRevenueCatDebug } from "../kristoDebugFlags";

const extra =
  (Constants.expoConfig?.extra as Record<string, string | undefined> | undefined) || {};

const IOS_REVENUECAT_API_KEY = extra.revenuecatIosApiKey || "";
const ANDROID_REVENUECAT_API_KEY = extra.revenuecatAndroidApiKey || "";

export const CHURCH_PREMIUM_ENTITLEMENT = "church_premium";
export const PREMIUM_MONTHLY_PRODUCT_ID = "premium_monthly";
export const PREMIUM_YEARLY_PRODUCT_ID = "premium_yearly";

function getRevenueCatApiKey() {
  if (Platform.OS === "ios") return IOS_REVENUECAT_API_KEY;
  if (Platform.OS === "android") return ANDROID_REVENUECAT_API_KEY;
  return "";
}

function isPlaceholderKey(value: string) {
  const v = String(value || "").trim();
  return !v || /REPLACE_ME|WEKA_|HAPA|placeholder/i.test(v);
}

function isLiveRoomActive() {
  return (
    (globalThis as any).__KRISTO_LIVE_ACTIVE__ ||
    Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0) > 0
  );
}

let configuredAppUserId: string | null = null;
let configurePromise: Promise<boolean> | null = null;
let loginPromise: Promise<void> | null = null;
let loginAppUserId: string | null = null;
let revenueCatDebugRouteEnabled = false;

export function setRevenueCatDebugRouteEnabled(enabled: boolean) {
  revenueCatDebugRouteEnabled = enabled;
  applyRevenueCatLogLevel();
}

function applyRevenueCatLogLevel() {
  if (!__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.WARN);
    return;
  }
  const debug = shouldEnableRevenueCatDebug(revenueCatDebugRouteEnabled ? "payments" : null);
  Purchases.setLogLevel(debug ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
}

export function getDefaultAppUserId(appUserID?: string) {
  const raw = String(appUserID || "").trim();
  return raw;
}

async function purchasesIsConfigured(): Promise<boolean> {
  try {
    return Boolean(await Purchases.isConfigured());
  } catch {
    return false;
  }
}

export async function ensurePurchasesConfigured(): Promise<boolean> {
  if (isRevenueCatPurchasingDisabled()) {
    return false;
  }

  if (isLiveRoomActive()) {
    console.log("RevenueCat skipped during live room");
    return false;
  }

  if (await purchasesIsConfigured()) {
    return true;
  }

  if (configurePromise) {
    return configurePromise;
  }

  const apiKey = getRevenueCatApiKey();
  if (isPlaceholderKey(apiKey)) {
    console.log("RevenueCat configure skipped: missing or placeholder API key");
    return false;
  }

  configurePromise = (async () => {
    applyRevenueCatLogLevel();
    await Purchases.configure({ apiKey });
    return purchasesIsConfigured();
  })();

  try {
    return await configurePromise;
  } finally {
    configurePromise = null;
  }
}

export async function syncPurchasesAppUser(appUserID?: string): Promise<void> {
  if (isRevenueCatPurchasingDisabled()) return;

  const ready = await ensurePurchasesConfigured();
  if (!ready) return;

  const safeAppUserId = getDefaultAppUserId(appUserID);
  if (!safeAppUserId) {
    console.log("RevenueCat logIn skipped: missing real userId");
    return;
  }

  if (configuredAppUserId === safeAppUserId) {
    return;
  }

  if (loginPromise && loginAppUserId === safeAppUserId) {
    await loginPromise;
    return;
  }

  loginAppUserId = safeAppUserId;
  loginPromise = (async () => {
    await Purchases.logIn(safeAppUserId);
    configuredAppUserId = safeAppUserId;
  })();

  try {
    await loginPromise;
  } finally {
    loginPromise = null;
    loginAppUserId = null;
  }
}

export async function configureMobileSubscriptions(appUserID?: string): Promise<boolean> {
  const ready = await ensurePurchasesConfigured();
  if (!ready) return false;

  await syncPurchasesAppUser(appUserID);
  return purchasesIsConfigured();
}

async function requireConfiguredPurchases(action: string): Promise<void> {
  if (isLiveRoomActive()) {
    throw new Error(`RevenueCat ${action} skipped during live room`);
  }

  const ready = await ensurePurchasesConfigured();
  if (!ready || !(await purchasesIsConfigured())) {
    throw new Error("RevenueCat is not configured yet.");
  }
}

export function isOfferingsConfigurationError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("offerings") ||
    message.includes("app store connect") ||
    message.includes("storekit") ||
    message.includes("couldn't be fetched") ||
    message.includes("configuration")
  );
}

export function formatSubscriptionSetupError(error: unknown): string {
  const message = String((error as any)?.message || error || "").trim();

  if (message.includes("not configured")) {
    return "RevenueCat is still starting. Close this screen and try again in a moment.";
  }

  if (isOfferingsConfigurationError(error)) {
    return (
      "RevenueCat is connected, but App Store products are not available yet. " +
      "In App Store Connect, submit premium_monthly and premium_yearly " +
      "with an app version (or attach a StoreKit Configuration file in Xcode for local testing)."
    );
  }

  return message || "Subscription setup could not be completed. Try again later.";
}

export async function getSubscriptionOfferings(): Promise<PurchasesOfferings> {
  if (isRevenueCatPurchasingDisabled()) {
    throw new Error("RevenueCat offerings skipped during subscription bypass testing");
  }

  await requireConfiguredPurchases("offerings");

  try {
    return await Purchases.getOfferings();
  } catch (error) {
    throw new Error(formatSubscriptionSetupError(error));
  }
}

export async function prefetchSubscriptionOfferings(): Promise<boolean> {
  try {
    await getSubscriptionOfferings();
    return true;
  } catch (error) {
    console.log("RevenueCat offerings prefetch error", error);
    return false;
  }
}

export async function purchaseSubscriptionPackage(pkg: PurchasesPackage) {
  await requireConfiguredPurchases("purchase");
  return Purchases.purchasePackage(pkg);
}

export async function restoreSubscriptionPurchases() {
  await requireConfiguredPurchases("restore");
  return Purchases.restorePurchases();
}

export async function getCustomerSubscriptionInfo(): Promise<CustomerInfo> {
  if (isRevenueCatPurchasingDisabled()) {
    throw new Error("RevenueCat customer info skipped during subscription bypass testing");
  }

  await requireConfiguredPurchases("customer info");
  return Purchases.getCustomerInfo();
}

export function hasActiveEntitlement(
  customerInfo: CustomerInfo,
  entitlementId = CHURCH_PREMIUM_ENTITLEMENT
) {
  if (isSubscriptionBypassEnabled()) return true;
  return Boolean(customerInfo.entitlements.active[entitlementId]);
}

/**
 * Real entitlement check that IGNORES every dev/review bypass. Use this to drive
 * the purchase UI ("Active" badge, post-purchase confirmation) so the screen can
 * never claim a plan is active without an actual StoreKit purchase.
 */
export function hasRealActiveEntitlement(
  customerInfo: CustomerInfo,
  entitlementId = CHURCH_PREMIUM_ENTITLEMENT
) {
  return Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
}

export function resolveActiveSubscriptionPlan(
  customerInfo: CustomerInfo
): SubscriptionPlanKey | null {
  if (!hasActiveEntitlement(customerInfo)) {
    return null;
  }

  const churchPremium = customerInfo.entitlements.active[CHURCH_PREMIUM_ENTITLEMENT];
  const productId = String(churchPremium?.productIdentifier || "").trim();

  if (!productId) {
    return null;
  }

  if (
    productId === PREMIUM_YEARLY_PRODUCT_ID ||
    /premium_yearly|yearly|annual|\$rc_annual/i.test(productId)
  ) {
    return "yearly";
  }

  if (
    productId === PREMIUM_MONTHLY_PRODUCT_ID ||
    /premium_monthly|monthly|\$rc_monthly/i.test(productId)
  ) {
    return "monthly";
  }

  return null;
}

export function resolveSubscriptionStatusFromCustomerInfo(
  customerInfo: CustomerInfo
): PlanStatus {
  return hasActiveEntitlement(customerInfo) ? "active" : "expired";
}

export function getEffectiveSubscriptionState(customerInfo: CustomerInfo): {
  selectedPlan: SubscriptionPlanKey;
  planStatus: PlanStatus;
} {
  const resolvedPlan = resolveActiveSubscriptionPlan(customerInfo);
  const resolvedStatus = resolveSubscriptionStatusFromCustomerInfo(customerInfo);

  if (!resolvedPlan || resolvedStatus !== "active") {
    return {
      selectedPlan: "monthly",
      planStatus: "expired",
    };
  }

  return {
    selectedPlan: resolvedPlan,
    planStatus: "active",
  };
}

export function isPlanActive(
  _selectedPlan: SubscriptionPlanKey,
  planStatus: PlanStatus
) {
  if (isSubscriptionBypassEnabled()) return true;
  return planStatus === "active";
}

export function resolveMonthlyPackage(
  offerings: PurchasesOfferings
): PurchasesPackage | null {
  const current = offerings.current;
  if (!current) return null;

  const byProductId =
    current.availablePackages?.find(
      (pkg) => String(pkg.product.identifier || "") === PREMIUM_MONTHLY_PRODUCT_ID
    ) || null;
  if (byProductId) return byProductId;

  if (current.monthly) return current.monthly;

  const byType =
    current.availablePackages?.find((pkg) => pkg.packageType === PACKAGE_TYPE.MONTHLY) || null;
  if (byType) return byType;

  const byText =
    current.availablePackages?.find((pkg) =>
      /premium_monthly|month|monthly/i.test(
        `${pkg.packageType} ${pkg.identifier} ${pkg.product.identifier} ${pkg.product.title} ${pkg.product.description}`
      )
    ) || null;

  return byText;
}

export function resolveYearlyPackage(
  offerings: PurchasesOfferings
): PurchasesPackage | null {
  const current = offerings.current;
  if (!current) return null;

  const byProductId =
    current.availablePackages?.find(
      (pkg) => String(pkg.product.identifier || "") === PREMIUM_YEARLY_PRODUCT_ID
    ) || null;
  if (byProductId) return byProductId;

  if (current.annual) return current.annual;

  const byType =
    current.availablePackages?.find((pkg) => pkg.packageType === PACKAGE_TYPE.ANNUAL) || null;
  if (byType) return byType;

  const byText =
    current.availablePackages?.find((pkg) =>
      /premium_yearly|year|yearly|annual/i.test(
        `${pkg.packageType} ${pkg.identifier} ${pkg.product.identifier} ${pkg.product.title} ${pkg.product.description}`
      )
    ) || null;

  return byText;
}

export function describeCurrentOfferingPackages(offerings: PurchasesOfferings) {
  const current = offerings.current;
  if (!current?.availablePackages?.length) return "No available packages in current offering.";

  return current.availablePackages
    .map(
      (pkg) =>
        [
          `packageType=${String(pkg.packageType)}`,
          `identifier=${String(pkg.identifier)}`,
          `productIdentifier=${String(pkg.product.identifier)}`,
          `price=${String(pkg.product.priceString || "")}`,
          `title=${String(pkg.product.title || "")}`,
        ].join(" | ")
    )
    .join("\n");
}
