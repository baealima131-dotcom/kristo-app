import Purchases, {
  LOG_LEVEL,
  CustomerInfo,
  INTRO_ELIGIBILITY_STATUS,
  PurchasesIntroPrice,
  PurchasesOfferings,
  PurchasesPackage,
  PACKAGE_TYPE,
} from "react-native-purchases";
import Constants from "expo-constants";
import { Linking, Platform } from "react-native";
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
export const MONTHLY_INTRO_TRIAL_DAYS = 14;

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
  try {
    if (!__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.WARN);
      return;
    }
    const debug = shouldEnableRevenueCatDebug(revenueCatDebugRouteEnabled ? "payments" : null);
    Purchases.setLogLevel(debug ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
  } catch (error) {
    console.log("KRISTO_RC_SET_LOG_LEVEL_FAILED", getRevenueCatErrorDetail(error));
  }
}

function isRevenueCatNativePlatform() {
  return Platform.OS === "ios" || Platform.OS === "android";
}

async function runRevenueCatNativeStep<T>(
  step: "CONFIGURE" | "LOGIN" | "CUSTOMER_INFO" | "IS_CONFIGURED" | "SYNC_PURCHASES",
  fn: () => Promise<T> | T,
  meta: Record<string, unknown> = {}
): Promise<T> {
  console.log(`KRISTO_RC_BEFORE_${step}`, meta);
  try {
    const result = await fn();
    console.log(`KRISTO_RC_AFTER_${step}`, { ok: true, ...meta });
    return result;
  } catch (error) {
    console.log(`KRISTO_RC_AFTER_${step}`, {
      ok: false,
      ...meta,
      ...getRevenueCatErrorDetail(error),
    });
    throw error;
  }
}

export function getDefaultAppUserId(appUserID?: string) {
  const raw = String(appUserID || "").trim();
  return raw;
}

async function purchasesIsConfigured(): Promise<boolean> {
  if (!isRevenueCatNativePlatform()) return false;
  try {
    return Boolean(
      await runRevenueCatNativeStep("IS_CONFIGURED", () => Purchases.isConfigured())
    );
  } catch {
    return false;
  }
}

export async function ensurePurchasesConfigured(): Promise<boolean> {
  console.log("KRISTO_RC_CONFIG_START", revenueCatRuntimeInfo());

  if (!isRevenueCatNativePlatform()) {
    console.log("KRISTO_RC_CONFIG_FAILED", {
      reason: "unsupported-platform",
      platform: Platform.OS,
    });
    return false;
  }

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
    try {
      await runRevenueCatNativeStep(
        "CONFIGURE",
        () => Purchases.configure({ apiKey }),
        {
          platform: Platform.OS,
          apiKeyMasked: describeApiKey().masked,
        }
      );
      applyRevenueCatLogLevel();
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
    console.log("RevenueCat logIn skipped: missing app user id");
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
      await runRevenueCatNativeStep(
        "LOGIN",
        () => Purchases.logIn(safeAppUserId),
        { appUserId: safeAppUserId }
      );
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

/** Church premium subscriptions use churchId as the RevenueCat App User ID. */
export async function logInRevenueCatForChurchSubscription(
  churchId: string
): Promise<CustomerInfo | null> {
  const cid = String(churchId || "").trim();
  if (!cid) return null;
  if (isRevenueCatPurchasingDisabled()) return null;

  const ready = await ensurePurchasesConfigured();
  if (!ready) return null;

  console.log("KRISTO_RC_LOGIN_FOR_CHURCH_SUBSCRIPTION", { churchId: cid });

  try {
    if (configuredAppUserId !== cid) {
      if (loginPromise && loginAppUserId === cid) {
        await loginPromise;
      } else {
        loginAppUserId = cid;
        loginPromise = (async () => {
          await runRevenueCatNativeStep("LOGIN", () => Purchases.logIn(cid), { churchId: cid });
          configuredAppUserId = cid;
        })();
        try {
          await loginPromise;
        } finally {
          loginPromise = null;
          loginAppUserId = null;
        }
      }
    }

    await runRevenueCatNativeStep("SYNC_PURCHASES", () => Purchases.syncPurchases(), {
      churchId: cid,
    });
    return await runRevenueCatNativeStep("CUSTOMER_INFO", () => Purchases.getCustomerInfo(), {
      churchId: cid,
    });
  } catch (error) {
    console.log("KRISTO_RC_LOGIN_FOR_CHURCH_SUBSCRIPTION_FAILED", {
      churchId: cid,
      ...getRevenueCatErrorDetail(error),
    });
    return null;
  }
}

export async function configureChurchMobileSubscriptions(churchId: string): Promise<boolean> {
  const cid = String(churchId || "").trim();
  if (!cid) return false;

  const ready = await ensurePurchasesConfigured();
  if (!ready) return false;

  const info = await logInRevenueCatForChurchSubscription(cid);
  return Boolean(info) || (await purchasesIsConfigured());
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
  const result = await Purchases.purchasePackage(pkg);
  try {
    await Purchases.syncPurchases();
  } catch (error) {
    console.log("KRISTO_RC_SYNC_PURCHASES_FAILED", getRevenueCatErrorDetail(error));
  }
  return result;
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll RevenueCat after StoreKit purchase until `church_premium` appears. */
export async function refreshCustomerInfoAfterStorePurchase(
  initialInfo?: CustomerInfo | null,
  opts?: { maxAttempts?: number; delayMs?: number }
): Promise<{ info: CustomerInfo; entitlementActive: boolean }> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 8);
  const delayMs = Math.max(0, opts?.delayMs ?? 1500);

  let info = initialInfo ?? (await getCustomerSubscriptionInfo());
  let entitlementActive = hasRealActiveEntitlement(info);

  for (let i = 0; i < maxAttempts && !entitlementActive; i++) {
    try {
      await Purchases.syncPurchases();
    } catch (error) {
      console.log("KRISTO_RC_SYNC_PURCHASES_FAILED", getRevenueCatErrorDetail(error));
    }
    await sleepMs(delayMs);
    info = await getCustomerSubscriptionInfo();
    entitlementActive = hasRealActiveEntitlement(info);
  }

  return { info, entitlementActive };
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
  return runRevenueCatNativeStep("CUSTOMER_INFO", () => Purchases.getCustomerInfo());
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
  customerInfo: CustomerInfo | null | undefined,
  entitlementId = CHURCH_PREMIUM_ENTITLEMENT
) {
  return Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
}

function isPremiumProductIdentifier(productId: string): boolean {
  const id = String(productId || "").trim();
  if (!id) return false;
  return (
    id === PREMIUM_MONTHLY_PRODUCT_ID ||
    id === PREMIUM_YEARLY_PRODUCT_ID ||
    /premium_monthly|premium_yearly|monthly|\$rc_monthly|yearly|annual|\$rc_annual/i.test(id)
  );
}

function subscriptionExpirationIsActive(expires: string | null | undefined): boolean {
  if (expires === null || expires === undefined) return true;
  const ms = Date.parse(String(expires));
  if (Number.isNaN(ms)) return false;
  return ms > Date.now();
}

/** True when StoreKit/RC shows an active premium_monthly or premium_yearly product, even if church_premium entitlement is delayed. */
export function hasActivePremiumProduct(
  customerInfo: CustomerInfo | null | undefined
): boolean {
  if (!customerInfo) return false;

  if ((customerInfo.activeSubscriptions || []).some(isPremiumProductIdentifier)) {
    return true;
  }

  for (const [productId, expires] of Object.entries(
    customerInfo.allExpirationDates || {}
  )) {
    if (isPremiumProductIdentifier(productId) && subscriptionExpirationIsActive(expires)) {
      return true;
    }
  }

  for (const [productId, subscription] of Object.entries(
    customerInfo.subscriptionsByProductIdentifier || {}
  )) {
    if (
      isPremiumProductIdentifier(productId) &&
      subscriptionExpirationIsActive(subscription?.expiresDate)
    ) {
      return true;
    }
  }

  if (
    subscriptionExpirationIsActive(customerInfo.latestExpirationDate) &&
    (customerInfo.allPurchasedProductIdentifiers || []).some(isPremiumProductIdentifier)
  ) {
    return true;
  }

  for (const entitlement of Object.values(customerInfo.entitlements?.all || {})) {
    const productId = String(entitlement?.productIdentifier || "").trim();
    if (
      isPremiumProductIdentifier(productId) &&
      subscriptionExpirationIsActive(entitlement?.expirationDate)
    ) {
      return true;
    }
  }

  return false;
}

export function resolvePremiumPlanFromCustomerInfo(
  customerInfo: CustomerInfo | null | undefined
): SubscriptionPlanKey | null {
  if (!customerInfo) return null;

  const candidates = [
    ...(customerInfo.activeSubscriptions || []),
    ...Object.keys(customerInfo.subscriptionsByProductIdentifier || {}),
    ...(customerInfo.allPurchasedProductIdentifiers || []),
  ];

  for (const productId of candidates) {
    if (!isPremiumProductIdentifier(productId)) continue;

    const subscription = customerInfo.subscriptionsByProductIdentifier?.[productId];
    if (subscription && !subscriptionExpirationIsActive(subscription.expiresDate)) {
      continue;
    }

    const expires = customerInfo.allExpirationDates?.[productId];
    if (expires !== undefined && !subscriptionExpirationIsActive(expires)) {
      continue;
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
  }

  return null;
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

export function describeIntroOffer(
  intro: PurchasesIntroPrice | null | undefined
): string {
  if (!intro) return "none";
  return [
    `price=${intro.price}`,
    `priceString=${intro.priceString}`,
    `period=${intro.period}`,
    `periodUnit=${intro.periodUnit}`,
    `periodNumberOfUnits=${intro.periodNumberOfUnits}`,
    `cycles=${intro.cycles}`,
  ].join(" | ");
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
          `introOffer=${describeIntroOffer(pkg.product.introPrice)}`,
          `title=${String(pkg.product.title || "")}`,
        ].join(" | ")
    )
    .join("\n");
}

/** True when the user has never purchased a church premium product before. */
export function isEligibleForMonthlyIntroTrial(
  customerInfo: CustomerInfo | null | undefined
): boolean {
  if (!customerInfo) return true;
  if (hasRealActiveEntitlement(customerInfo)) return false;

  const purchased = customerInfo.allPurchasedProductIdentifiers ?? [];
  if (
    purchased.includes(PREMIUM_MONTHLY_PRODUCT_ID) ||
    purchased.includes(PREMIUM_YEARLY_PRODUCT_ID)
  ) {
    return false;
  }

  if (customerInfo.entitlements?.all?.[CHURCH_PREMIUM_ENTITLEMENT]) {
    return false;
  }

  return true;
}

export function packageHasIntroductoryOffer(
  pkg: PurchasesPackage | null | undefined
): boolean {
  return Boolean(pkg?.product?.introPrice);
}

export function getMonthlyIntroOffer(
  pkg: PurchasesPackage | null | undefined
): PurchasesIntroPrice | null {
  return pkg?.product?.introPrice ?? null;
}

export function isIntroOfferFreeTrial(
  intro: PurchasesIntroPrice | null | undefined
): boolean {
  if (!intro) return false;
  return intro.price === 0;
}

function parseIso8601PeriodDays(period: string): number | null {
  const raw = String(period || "").trim().toUpperCase();
  if (!raw.startsWith("P")) return null;

  const match = raw.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/);
  if (!match) return null;

  const years = Number(match[1] || 0);
  const months = Number(match[2] || 0);
  const weeks = Number(match[3] || 0);
  const days = Number(match[4] || 0);
  const total = years * 365 + months * 30 + weeks * 7 + days;
  return total > 0 ? total : null;
}

export function resolveIntroTrialDays(
  intro: PurchasesIntroPrice | null | undefined
): number | null {
  if (!intro) return null;

  const fromPeriod = parseIso8601PeriodDays(intro.period);
  if (fromPeriod) return fromPeriod;

  const units = Number(intro.periodNumberOfUnits || 0);
  const cycles = Number(intro.cycles || 1);
  const unit = String(intro.periodUnit || "").toUpperCase();
  if (!units) return null;

  const unitDays =
    unit === "DAY"
      ? 1
      : unit === "WEEK"
        ? 7
        : unit === "MONTH"
          ? 30
          : unit === "YEAR"
            ? 365
            : 0;
  if (!unitDays) return null;

  return units * cycles * unitDays;
}

export function formatIntroTrialLabel(
  intro: PurchasesIntroPrice | null | undefined,
  fallbackDays = MONTHLY_INTRO_TRIAL_DAYS
): string | null {
  if (!intro || !isIntroOfferFreeTrial(intro)) return null;

  const days = resolveIntroTrialDays(intro) ?? fallbackDays;
  const dayLabel = days === 1 ? "Day" : "Days";
  return `${days} ${dayLabel} Free Trial`;
}

export function logMonthlyIntroOfferFromStoreKit(
  monthlyPackage: PurchasesPackage | null | undefined
) {
  const intro = getMonthlyIntroOffer(monthlyPackage);
  console.log("KRISTO_RC_PRODUCT_INTRO_OFFER", {
    productId: monthlyPackage?.product.identifier || null,
    hasIntroPrice: Boolean(intro),
    introOffer: describeIntroOffer(intro),
    isFreeTrial: isIntroOfferFreeTrial(intro),
    trialDays: resolveIntroTrialDays(intro),
  });
}

export async function fetchMonthlyIntroTrialEligibility(): Promise<INTRO_ELIGIBILITY_STATUS | null> {
  if (isRevenueCatPurchasingDisabled()) return null;

  const ready = await ensurePurchasesConfigured();
  if (!ready) return null;

  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility([
      PREMIUM_MONTHLY_PRODUCT_ID,
    ]);
    return result[PREMIUM_MONTHLY_PRODUCT_ID]?.status ?? null;
  } catch (error) {
    console.log("KRISTO_RC_INTRO_ELIGIBILITY_FAILED", getRevenueCatErrorDetail(error));
    return null;
  }
}

export function resolveMonthlyIntroTrialEligible(
  customerInfo: CustomerInfo | null | undefined,
  monthlyPackage: PurchasesPackage | null | undefined,
  introEligibilityStatus?: INTRO_ELIGIBILITY_STATUS | null
): boolean {
  const intro = getMonthlyIntroOffer(monthlyPackage);
  if (!intro || !isIntroOfferFreeTrial(intro)) {
    return false;
  }

  if (introEligibilityStatus === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE) {
    return false;
  }
  if (
    introEligibilityStatus ===
    INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS
  ) {
    return false;
  }
  if (introEligibilityStatus === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) {
    return true;
  }

  return isEligibleForMonthlyIntroTrial(customerInfo);
}

export function resolveMonthlyIntroTrialLabel(
  monthlyPackage: PurchasesPackage | null | undefined
): string | null {
  return formatIntroTrialLabel(getMonthlyIntroOffer(monthlyPackage));
}

export function formatMonthlySubscriptionPrice(
  priceString: string,
  monthlyPackage: PurchasesPackage | null | undefined,
  eligibleForTrial: boolean
): string {
  const price = String(priceString || "").trim() || "$49.99";
  if (!eligibleForTrial) {
    return `${price}/month`;
  }

  const intro = getMonthlyIntroOffer(monthlyPackage);
  const days = resolveIntroTrialDays(intro) ?? MONTHLY_INTRO_TRIAL_DAYS;
  return `${days} days free, then ${price}/month`;
}

export function formatYearlySubscriptionPrice(
  priceString: string,
  pkg: PurchasesPackage | null | undefined
): string {
  const price = String(priceString || "").trim() || "$499.99";
  if (!packageHasIntroductoryOffer(pkg)) {
    return `${price}/year`;
  }

  const intro = pkg?.product?.introPrice;
  const introPrice = String(intro?.priceString || "").trim();
  if (!introPrice) {
    return `${price}/year`;
  }

  const units = intro?.periodNumberOfUnits;
  const unit = String(intro?.periodUnit || "").toLowerCase();
  const trialLabel =
    units && unit ? `${units} ${unit}${units === 1 ? "" : "s"}` : "intro offer";
  return `${introPrice} for ${trialLabel}, then ${price}/year`;
}

/** Opens native subscription management (StoreKit sheet or store URL). */
export async function openSubscriptionManagement(
  customerInfo?: CustomerInfo | null
): Promise<boolean> {
  try {
    const showManage = (Purchases as { showManageSubscriptions?: () => Promise<void> })
      .showManageSubscriptions;
    if (typeof showManage === "function") {
      await showManage.call(Purchases);
      return true;
    }
  } catch (error) {
    console.log("KRISTO_RC_MANAGE_SUBSCRIPTIONS_FAILED", getRevenueCatErrorDetail(error));
  }

  let info = customerInfo ?? null;
  if (!info) {
    try {
      info = await getCustomerSubscriptionInfo();
    } catch {
      info = null;
    }
  }

  const managementUrl = String(info?.managementURL || "").trim();
  if (managementUrl) {
    await Linking.openURL(managementUrl);
    return true;
  }

  if (Platform.OS === "ios") {
    await Linking.openURL("https://apps.apple.com/account/subscriptions");
    return true;
  }

  if (Platform.OS === "android") {
    await Linking.openURL("https://play.google.com/store/account/subscriptions");
    return true;
  }

  return false;
}
