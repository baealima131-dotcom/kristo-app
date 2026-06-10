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

// ---- RevenueCat diagnostics helpers --------------------------------------

function describeApiKey(): { kind: "missing" | "placeholder" | "present"; masked: string } {
  const v = String(getRevenueCatApiKey() || "").trim();
  if (!v) return { kind: "missing", masked: "" };
  if (isPlaceholderKey(v)) return { kind: "placeholder", masked: v.slice(0, 6) + "..." };
  return { kind: "present", masked: `${v.slice(0, 8)}...(len ${v.length})` };
}

function revenueCatRuntimeInfo() {
  const key = describeApiKey();
  return {
    platform: Platform.OS,
    dev: __DEV__,
    hasExpoConfig: Boolean(Constants.expoConfig),
    hasExtra: Boolean(Constants.expoConfig?.extra),
    apiKeyKind: key.kind,
    apiKeyMasked: key.masked,
    purchasingDisabled: isRevenueCatPurchasingDisabled(),
  };
}

/** Human-readable reason the live purchase path is blocked, or null if fine. */
function revenueCatUnavailableReason(): string | null {
  if (isRevenueCatPurchasingDisabled()) {
    return "subscription-bypass: EXPO_PUBLIC_KRISTO_SUBSCRIPTION_BYPASS=1";
  }
  if (isLiveRoomActive()) return "live-room-active";
  const key = describeApiKey();
  if (key.kind !== "present") return `ios/android RevenueCat api key is ${key.kind}`;
  return null;
}

function getRevenueCatErrorDetail(error: unknown) {
  const e = error as any;
  return {
    message: String(e?.message || e || "unknown"),
    code: e?.code ?? e?.userInfo?.code ?? null,
    underlyingErrorMessage:
      e?.underlyingErrorMessage ?? e?.userInfo?.readableErrorCode ?? null,
    userCancelled: Boolean(e?.userCancelled),
  };
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
  console.log("KRISTO_RC_CONFIG_START", revenueCatRuntimeInfo());

  if (isRevenueCatPurchasingDisabled()) {
    console.log("KRISTO_RC_CONFIG_FAILED", {
      reason: "subscription-bypass",
      ...revenueCatRuntimeInfo(),
    });
    return false;
  }

  if (isLiveRoomActive()) {
    console.log("KRISTO_RC_CONFIG_FAILED", { reason: "live-room-active" });
    return false;
  }

  if (await purchasesIsConfigured()) {
    console.log("KRISTO_RC_CONFIG_SUCCESS", { reason: "already-configured" });
    return true;
  }

  if (configurePromise) {
    return configurePromise;
  }

  const apiKey = getRevenueCatApiKey();
  if (isPlaceholderKey(apiKey)) {
    console.log("KRISTO_RC_CONFIG_FAILED", {
      reason: "missing-or-placeholder-api-key",
      ...revenueCatRuntimeInfo(),
    });
    return false;
  }

  configurePromise = (async () => {
    applyRevenueCatLogLevel();
    try {
      await Purchases.configure({ apiKey });
      const ok = await purchasesIsConfigured();
      console.log(ok ? "KRISTO_RC_CONFIG_SUCCESS" : "KRISTO_RC_CONFIG_FAILED", {
        reason: ok ? "configured" : "configure-returned-not-configured",
        platform: Platform.OS,
        apiKeyMasked: describeApiKey().masked,
      });
      return ok;
    } catch (error) {
      console.log("KRISTO_RC_CONFIG_FAILED", {
        reason: "configure-threw",
        ...getRevenueCatErrorDetail(error),
      });
      throw error;
    }
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
    console.log("KRISTO_RC_LOGIN_START", { appUserId: safeAppUserId });
    try {
      await Purchases.logIn(safeAppUserId);
      configuredAppUserId = safeAppUserId;
      console.log("KRISTO_RC_LOGIN_SUCCESS", { appUserId: safeAppUserId });
    } catch (error) {
      console.log("KRISTO_RC_LOGIN_FAILED", {
        appUserId: safeAppUserId,
        ...getRevenueCatErrorDetail(error),
      });
      throw error;
    }
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
    const reason = revenueCatUnavailableReason() || "configure-incomplete";
    throw new Error(`RevenueCat is not configured yet. (reason: ${reason})`);
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
  const detail = getRevenueCatErrorDetail(error);
  const message = detail.message.trim();
  const codeSuffix = detail.code != null ? ` (code ${detail.code})` : "";

  if (message.includes("not configured")) {
    // Surface the actual reason instead of a vague "still starting".
    return message;
  }

  if (isOfferingsConfigurationError(error)) {
    return (
      "App Store products are not available yet. Submit premium_monthly and " +
      "premium_yearly in App Store Connect (or attach a StoreKit config in Xcode). " +
      `Details: ${message}${codeSuffix}`
    );
  }

  return message ? `${message}${codeSuffix}` : "Subscription setup could not be completed. Try again later.";
}

export async function getSubscriptionOfferings(): Promise<PurchasesOfferings> {
  if (isRevenueCatPurchasingDisabled()) {
    throw new Error("RevenueCat offerings skipped during subscription bypass testing");
  }

  await requireConfiguredPurchases("offerings");

  console.log("KRISTO_RC_OFFERINGS_START", { platform: Platform.OS });
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    console.log("KRISTO_RC_OFFERINGS_SUCCESS", {
      currentOfferingId: current?.identifier || null,
      allOfferingIds: Object.keys(offerings.all || {}),
      currentPackageCount: current?.availablePackages?.length || 0,
      currentProductIds: (current?.availablePackages || []).map((p) => p.product.identifier),
    });
    return offerings;
  } catch (error) {
    const detail = getRevenueCatErrorDetail(error);
    console.log("KRISTO_RC_OFFERINGS_FAILED", detail);
    // Preserve the real RevenueCat message/code so the UI shows the true cause.
    throw new Error(`${detail.message}${detail.code != null ? ` (code ${detail.code})` : ""}`);
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
