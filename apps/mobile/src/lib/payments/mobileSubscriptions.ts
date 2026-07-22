import Purchases, {
  LOG_LEVEL,
  CustomerInfo,
  INTRO_ELIGIBILITY_STATUS,
  PRODUCT_CATEGORY,
  PURCHASES_ERROR_CODE,
  PurchasesIntroPrice,
  PurchasesOfferings,
  PurchasesPackage,
  PurchasesStoreProduct,
  PACKAGE_TYPE,
  STORE_REPLACEMENT_MODE,
} from "react-native-purchases";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Alert, Linking, Platform } from "react-native";
import type { PlanStatus, SubscriptionPlanKey } from "../../store/paymentsStore";
import {
  isRevenueCatPurchasingDisabled,
  isSubscriptionBypassEnabled,
} from "../subscriptionBypass";
import { shouldEnableRevenueCatDebug } from "../kristoDebugFlags";
import {
  CHURCH_PREMIUM_ENTITLEMENT,
  CHURCH_PREMIUM_ENTITLEMENT_IDS,
  CHURCH_PREMIUM_PRODUCT_IDS,
  detectPremiumEntitlementKey,
  isChurchPremiumEntitlementId,
  isChurchPremiumProductId,
  isIosPremiumRotationMonthlyProductId,
  isMonthlyChurchPremiumProductId,
  isYearlyChurchPremiumProductId,
  LEGACY_PREMIUM_ENTITLEMENT,
  PREMIUM_MONTHLY_INTRO_TRIAL_DAYS,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
  IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS,
} from "./churchPremiumRevenueCat";

export {
  CHURCH_PREMIUM_ENTITLEMENT,
  CHURCH_PREMIUM_ENTITLEMENT_IDS,
  CHURCH_PREMIUM_PRODUCT_IDS,
  LEGACY_PREMIUM_ENTITLEMENT,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
  isChurchPremiumProductId,
  isMonthlyChurchPremiumProductId,
  isYearlyChurchPremiumProductId,
} from "./churchPremiumRevenueCat";

const extra =
  (Constants.expoConfig?.extra as Record<string, string | undefined> | undefined) || {};

const IOS_REVENUECAT_API_KEY =
  String(process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || extra.revenuecatIosApiKey || "").trim();
const ANDROID_REVENUECAT_API_KEY =
  String(
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || extra.revenuecatAndroidApiKey || ""
  ).trim();

export const MONTHLY_INTRO_TRIAL_DAYS = PREMIUM_MONTHLY_INTRO_TRIAL_DAYS;

function isAndroidPlatform() {
  return Platform.OS === "android";
}

function getRevenueCatApiKey() {
  if (Platform.OS === "ios") return IOS_REVENUECAT_API_KEY;
  if (Platform.OS === "android") return ANDROID_REVENUECAT_API_KEY;
  return "";
}

function androidRevenueCatProductConfig() {
  return {
    monthlyProductId: PREMIUM_MONTHLY_PRODUCT_ID,
    yearlyProductId: PREMIUM_YEARLY_PRODUCT_ID,
    entitlementIds: [...CHURCH_PREMIUM_ENTITLEMENT_IDS],
  };
}

function isPlaceholderKey(value: string) {
  const v = String(value || "").trim();
  return !v || /REPLACE_ME|WEKA_|HAPA|placeholder/i.test(v);
}

function maskRevenueCatPublicKeyPrefix(value: string): string {
  const key = String(value || "").trim();
  if (!key) return "";
  return `${key.slice(0, 7)}...`;
}

type RevenueCatPublicKeyPlatform = "google" | "apple" | "amazon" | "unknown";

function classifyRevenueCatPublicKeyPlatform(value: string): RevenueCatPublicKeyPlatform {
  const key = String(value || "").trim();
  if (key.startsWith("goog_")) return "google";
  if (key.startsWith("appl_")) return "apple";
  if (key.startsWith("amzn_")) return "amazon";
  return "unknown";
}

function describeRevenueCatKeyForPlatform(key: string) {
  const trimmed = String(key || "").trim();
  const keyPlatform = classifyRevenueCatPublicKeyPlatform(trimmed);
  const expectedPlatform: RevenueCatPublicKeyPlatform =
    Platform.OS === "android" ? "google" : Platform.OS === "ios" ? "apple" : "unknown";
  const correctForCurrentPlatform =
    expectedPlatform !== "unknown" && keyPlatform === expectedPlatform;

  let wrongKeyWarning: string | null = null;
  if (Platform.OS === "android" && keyPlatform === "apple") {
    wrongKeyWarning =
      "Android build is using an Apple (appl_) RevenueCat key — configure goog_ via EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY or app.json extra.revenuecatAndroidApiKey.";
  } else if (Platform.OS === "ios" && keyPlatform === "google") {
    wrongKeyWarning =
      "iOS build is using a Google (goog_) RevenueCat key — configure appl_ via EXPO_PUBLIC_REVENUECAT_IOS_API_KEY or app.json extra.revenuecatIosApiKey.";
  } else if (Platform.OS === "android" && keyPlatform === "amazon") {
    wrongKeyWarning = "Amazon (amzn_) key detected on a standard Google Play build.";
  }

  return {
    keyPrefix: maskRevenueCatPublicKeyPrefix(trimmed),
    keyPlatform,
    expectedPlatform,
    expectedStore: Platform.OS === "android" ? "PLAY_STORE" : Platform.OS === "ios" ? "APP_STORE" : "UNKNOWN",
    correctForCurrentPlatform,
    wrongKeyWarning,
  };
}

function parseGooglePlayBillingClientFields(message: string | null | undefined): {
  billingResponseCode: string | null;
  billingDebugMessage: string | null;
  billingSubResponseCode: string | null;
} {
  const msg = String(message || "");
  if (!msg) {
    return {
      billingResponseCode: null,
      billingDebugMessage: null,
      billingSubResponseCode: null,
    };
  }

  const errorCodeMatch = msg.match(/ErrorCode:\s*([A-Z0-9_]+)/i);
  const subCodeMatch = msg.match(/SubResponseCode:\s*([A-Z0-9_]+)/i);
  const debugMatch = msg.match(/DebugMessage:\s*(.+?)(?:\.\s*ErrorCode:|$)/i);

  return {
    billingResponseCode: errorCodeMatch?.[1]?.toUpperCase() ?? null,
    billingDebugMessage: debugMatch?.[1]?.trim() ?? null,
    billingSubResponseCode: subCodeMatch?.[1]?.toUpperCase() ?? null,
  };
}

function sanitizeRevenueCatErrorSnapshot(error: unknown): Record<string, unknown> {
  const e = error as Record<string, unknown> | null | undefined;
  if (!e || typeof e !== "object") {
    return { value: String(error ?? "unknown") };
  }

  const preserveFull = new Set([
    "underlyingErrorMessage",
    "message",
    "readableErrorCode",
    "readable_error_code",
  ]);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(e)) {
    if (typeof value === "function") continue;
    if (key === "userInfo" && value && typeof value === "object") {
      out.userInfo = sanitizeRevenueCatErrorSnapshot(value);
      continue;
    }
    if (typeof value === "string" && value.length > 600 && !preserveFull.has(key)) {
      out[key] = `${value.slice(0, 600)}…`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function extractErrorStackTrace(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error && error.stack) {
    return error.stack;
  }
  const e = error as Record<string, unknown>;
  const candidates = [
    e?.stack,
    e?.nativeStackAndroid,
    e?.componentStack,
    (e?.userInfo as Record<string, unknown> | undefined)?.stack,
  ];
  for (const candidate of candidates) {
    const stack = String(candidate || "").trim();
    if (stack) return stack;
  }
  return null;
}

function getAndroidPackageName(): string {
  return String(
    Constants.expoConfig?.android?.package ||
      (Constants as { manifest?: { package?: string } }).manifest?.package ||
      ""
  ).trim();
}

/** Shared Android RevenueCat context attached to configure / offerings / products logs. */
function getRevenueCatAndroidDiagnosticsContext() {
  const runtimeKey = getRevenueCatApiKey();
  const keyForPlatform = describeRevenueCatKeyForPlatform(runtimeKey);
  const androidKey = describeAndroidRevenueCatApiKeySource();
  const install = describeAndroidInstallContext();

  return {
    packageName: getAndroidPackageName(),
    store: keyForPlatform.expectedStore,
    storeLabel: "Google Play",
    revenueCatApiKeyPrefix: keyForPlatform.keyPrefix,
    revenueCatApiKeyPlatform: keyForPlatform.keyPlatform,
    revenueCatApiKeySource: androidKey.source,
    revenueCatApiKeyConfigured: androidKey.configured,
    revenueCatKeyCorrectForAndroid: keyForPlatform.correctForCurrentPlatform,
    nativeAppVersion: install.nativeAppVersion,
    nativeBuildVersion: install.nativeBuildVersion,
    expectedProductIds: [PREMIUM_MONTHLY_PRODUCT_ID, PREMIUM_YEARLY_PRODUCT_ID],
    ...androidRevenueCatProductConfig(),
  };
}

function getFullRevenueCatErrorDetail(error: unknown) {
  const e = error as Record<string, unknown> & {
    userInfo?: Record<string, unknown>;
  };
  const userInfo = (e?.userInfo || {}) as Record<string, unknown>;
  const underlyingErrorMessage = String(
    e?.underlyingErrorMessage ??
      userInfo?.underlyingErrorMessage ??
      userInfo?.NSLocalizedDescription ??
      ""
  ).trim();
  const billingClient = parseGooglePlayBillingClientFields(underlyingErrorMessage || null);
  const base = {
    message: String(e?.message || e || "unknown"),
    code: e?.code ?? userInfo?.code ?? null,
    readableErrorCode:
      e?.readableErrorCode ??
      userInfo?.readableErrorCode ??
      userInfo?.readable_error_code ??
      null,
    underlyingErrorMessage: underlyingErrorMessage || null,
    billingResponseCode: billingClient.billingResponseCode,
    billingDebugMessage: billingClient.billingDebugMessage,
    billingSubResponseCode: billingClient.billingSubResponseCode,
    userCancelled: Boolean(e?.userCancelled ?? userInfo?.userCancelled),
    stackTrace: extractErrorStackTrace(error),
    errorSnapshot: sanitizeRevenueCatErrorSnapshot(error),
    rawUserInfo: userInfo && Object.keys(userInfo).length > 0 ? userInfo : null,
  };

  if (isInvalidCredentialsRevenueCatError(base) && Platform.OS === "android") {
    return {
      ...base,
      invalidCredentialsHint:
        "RevenueCat code 11 on Android usually means RevenueCat cannot authenticate with Google Play using the service account JSON in the RevenueCat dashboard (not the client goog_ SDK key). Verify Play Console package com.princefariji.kristoapp, subscription product IDs premium_monthly/premium_yearly, and that the tester installed from Play internal testing.",
    };
  }

  return base;
}

export function logRevenueCatException(
  phase: string,
  error: unknown,
  meta: Record<string, unknown> = {}
) {
  const detail = getFullRevenueCatErrorDetail(error);
  const androidContext = isAndroidPlatform() ? getRevenueCatAndroidDiagnosticsContext() : null;

  console.log("KRISTO_RC_EXCEPTION", {
    phase,
    ...meta,
    ...(androidContext || {}),
    ...detail,
  });

  if (isAndroidPlatform()) {
    console.log("KRISTO_ANDROID_RC_EXCEPTION", {
      phase,
      ...meta,
      ...(androidContext || {}),
      code: detail.code,
      readableErrorCode: detail.readableErrorCode,
      message: detail.message,
      underlyingErrorMessage: detail.underlyingErrorMessage,
      billingResponseCode: detail.billingResponseCode,
      billingDebugMessage: detail.billingDebugMessage,
      billingSubResponseCode: detail.billingSubResponseCode,
      stackTrace: detail.stackTrace,
      errorSnapshot: detail.errorSnapshot,
      invalidCredentialsHint:
        "invalidCredentialsHint" in detail ? detail.invalidCredentialsHint : null,
    });
  }
}

function isInvalidCredentialsRevenueCatError(detail: {
  code: unknown;
  readableErrorCode: unknown;
}) {
  const code = String(detail.code ?? "");
  const readable = String(detail.readableErrorCode ?? "").toUpperCase();
  return (
    code === PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR ||
    code === "11" ||
    readable === "INVALID_CREDENTIALS_ERROR"
  );
}

/** Public RevenueCat Android SDK key source for launch diagnostics (prefix only). */
export function describeAndroidRevenueCatApiKeySource(): {
  configured: boolean;
  source: "env" | "app-json" | "missing";
  keyPrefix: string;
} {
  const fromEnv = String(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || "").trim();
  const fromExtra = String(extra.revenuecatAndroidApiKey || "").trim();
  const resolved = fromEnv || fromExtra;
  if (!resolved) {
    return { configured: false, source: "missing", keyPrefix: "" };
  }
  if (isPlaceholderKey(resolved)) {
    return {
      configured: false,
      source: fromEnv ? "env" : "app-json",
      keyPrefix: maskRevenueCatPublicKeyPrefix(resolved),
    };
  }
  return {
    configured: true,
    source: fromEnv ? "env" : "app-json",
    keyPrefix: maskRevenueCatPublicKeyPrefix(resolved),
  };
}

function isLiveRoomActive() {
  return (
    (globalThis as any).__KRISTO_LIVE_ACTIVE__ ||
    Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0) > 0
  );
}

// ---- RevenueCat diagnostics helpers --------------------------------------

function describeApiKey(): { kind: "missing" | "placeholder" | "present"; keyPrefix: string } {
  const v = String(getRevenueCatApiKey() || "").trim();
  if (!v) return { kind: "missing", keyPrefix: "" };
  if (isPlaceholderKey(v)) return { kind: "placeholder", keyPrefix: maskRevenueCatPublicKeyPrefix(v) };
  return { kind: "present", keyPrefix: maskRevenueCatPublicKeyPrefix(v) };
}

function describeRevenueCatAndroidKeyUsedLog(source: string, configured: boolean) {
  const androidKey = describeAndroidRevenueCatApiKeySource();
  console.log("KRISTO_REVENUECAT_ANDROID_KEY_USED", {
    source,
    configured,
    keySource: androidKey.source,
    keyPrefix: androidKey.keyPrefix || null,
  });
}

function revenueCatRuntimeInfo() {
  const key = describeApiKey();
  return {
    platform: Platform.OS,
    dev: __DEV__,
    hasExpoConfig: Boolean(Constants.expoConfig),
    hasExtra: Boolean(Constants.expoConfig?.extra),
    apiKeyKind: key.kind,
    apiKeyPrefix: key.keyPrefix,
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
  return getFullRevenueCatErrorDetail(error);
}

export function getRevenueCatPurchaseErrorDetail(error: unknown) {
  return getRevenueCatErrorDetail(error);
}

function describeAndroidInstallContext() {
  const ownership = String(Constants.appOwnership || "unknown");
  const executionEnvironment = String(
    (Constants as { executionEnvironment?: string }).executionEnvironment || "unknown"
  );
  const isExpoGo = ownership === "expo";
  const isDevClient = executionEnvironment === "storeClient" && !isExpoGo;
  const packageName = String(
    Constants.expoConfig?.android?.package ||
      (Constants as { manifest?: { package?: string } }).manifest?.package ||
      ""
  ).trim();

  return {
    platform: Platform.OS,
    appOwnership: ownership,
    executionEnvironment,
    isExpoGo,
    isDevClient,
    isDev: __DEV__,
    packageName,
    nativeAppVersion: Constants.nativeAppVersion ?? null,
    nativeBuildVersion: Constants.nativeBuildVersion ?? null,
    playBillingLikelySupported:
      !isExpoGo && ownership !== "expo" && Boolean(packageName),
    playStoreInstallRequired:
      "Google Play subscriptions require an internal/closed/production build installed from Play Store (not Expo Go or sideloaded APK unless Play Billing is wired).",
  };
}

/** Launch diagnostics for Google Play + RevenueCat on Android. */
export function logAndroidBillingConfigDiagnostics(source = "boot") {
  if (!isAndroidPlatform()) return;

  const androidKey = describeAndroidRevenueCatApiKeySource();
  const apiKey = describeApiKey();
  const install = describeAndroidInstallContext();

  const runtimeKey = getRevenueCatApiKey();
  const keyForPlatform = describeRevenueCatKeyForPlatform(runtimeKey);

  console.log("KRISTO_ANDROID_BILLING_CONFIG", {
    source,
    ...install,
    ...androidRevenueCatProductConfig(),
    revenueCatApiKeyKind: apiKey.kind,
    revenueCatApiKeyPrefix: apiKey.keyPrefix,
    revenueCatKeyPlatform: keyForPlatform.keyPlatform,
    revenueCatExpectedStore: keyForPlatform.expectedStore,
    revenueCatKeyCorrectForAndroid: keyForPlatform.correctForCurrentPlatform,
    revenueCatWrongKeyWarning: keyForPlatform.wrongKeyWarning,
    revenueCatAndroidKeySource: androidKey.source,
    revenueCatAndroidKeyConfigured: androidKey.configured,
    iosKeyWouldBeWrongOnAndroid:
      classifyRevenueCatPublicKeyPlatform(IOS_REVENUECAT_API_KEY) === "apple" &&
      classifyRevenueCatPublicKeyPlatform(runtimeKey) === "apple",
    purchasingDisabled: isRevenueCatPurchasingDisabled(),
    checklist: {
      realPlayBuild: install.playBillingLikelySupported && !install.isExpoGo,
      androidApiKeyPresent: apiKey.kind === "present",
      androidApiKeyIsGoogPrefix: keyForPlatform.keyPlatform === "google",
      packageNameMatchesPlayConsole:
        install.packageName === "com.princefariji.kristoapp",
      productsExpected: [PREMIUM_MONTHLY_PRODUCT_ID, PREMIUM_YEARLY_PRODUCT_ID],
    },
  });

  describeRevenueCatAndroidKeyUsedLog(source, androidKey.configured);
}

function summarizeStoreProducts(products: PurchasesStoreProduct[]) {
  return products.map((product) => ({
    identifier: product.identifier,
    title: product.title,
    priceString: product.priceString,
    productCategory: (product as { productCategory?: string }).productCategory ?? null,
    subscriptionPeriod: (product as { subscriptionPeriod?: string }).subscriptionPeriod ?? null,
    store: (product as { store?: string }).store ?? "PLAY_STORE",
  }));
}

async function runRevenueCatGetProducts(
  productIds: string[],
  source: string
): Promise<PurchasesStoreProduct[]> {
  const androidContext = isAndroidPlatform() ? getRevenueCatAndroidDiagnosticsContext() : null;

  console.log("KRISTO_RC_GET_PRODUCTS_BEFORE", {
    source,
    requestedProductIds: productIds,
    productCategory: PRODUCT_CATEGORY.SUBSCRIPTION,
    ...(androidContext || {}),
  });

  try {
    const products = await Purchases.getProducts(productIds, PRODUCT_CATEGORY.SUBSCRIPTION);
    const loadedProductIds = products.map((product) => product.identifier);

    console.log("KRISTO_RC_GET_PRODUCTS_AFTER", {
      source,
      ok: true,
      requestedProductIds: productIds,
      googlePlayProductIds: loadedProductIds,
      missingProductIds: productIds.filter((id) => !loadedProductIds.includes(id)),
      productSummary: summarizeStoreProducts(products),
      ...(androidContext || {}),
    });

    if (isAndroidPlatform()) {
      console.log("KRISTO_ANDROID_GOOGLE_PLAY_PRODUCT_IDS", {
        source,
        store: androidContext?.store ?? "PLAY_STORE",
        packageName: androidContext?.packageName ?? null,
        revenueCatApiKeyPrefix: androidContext?.revenueCatApiKeyPrefix ?? null,
        googlePlayProductIds: loadedProductIds,
        productSummary: summarizeStoreProducts(products),
      });
    }

    return products;
  } catch (error) {
    logRevenueCatException("getProducts", error, {
      source,
      requestedProductIds: productIds,
    });
    console.log("KRISTO_RC_GET_PRODUCTS_AFTER", {
      source,
      ok: false,
      requestedProductIds: productIds,
      ...(androidContext || {}),
      ...getFullRevenueCatErrorDetail(error),
    });
    throw error;
  }
}

async function runRevenueCatGetOfferings(source: string): Promise<PurchasesOfferings> {
  const androidContext = isAndroidPlatform() ? getRevenueCatAndroidDiagnosticsContext() : null;

  console.log("KRISTO_RC_GET_OFFERINGS_BEFORE", {
    source,
    ...(androidContext || {}),
  });

  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    const offeringProductIds = (current?.availablePackages || []).map(
      (pkg) => pkg.product.identifier
    );

    console.log("KRISTO_RC_GET_OFFERINGS_AFTER", {
      source,
      ok: true,
      currentOfferingId: current?.identifier || null,
      allOfferingIds: Object.keys(offerings.all || {}),
      currentPackageCount: current?.availablePackages?.length || 0,
      offeringProductIds,
      ...(androidContext || {}),
    });

    return offerings;
  } catch (error) {
    logRevenueCatException("getOfferings", error, { source });
    console.log("KRISTO_RC_GET_OFFERINGS_AFTER", {
      source,
      ok: false,
      ...(androidContext || {}),
      ...getFullRevenueCatErrorDetail(error),
    });
    throw error;
  }
}

async function runRevenueCatPurchasesConfigure(apiKey: string): Promise<void> {
  const keyDiagnostics = describeRevenueCatKeyForPlatform(apiKey);
  const androidContext = isAndroidPlatform() ? getRevenueCatAndroidDiagnosticsContext() : null;

  console.log("KRISTO_RC_PURCHASES_CONFIGURE_BEFORE", {
    platform: Platform.OS,
    apiKeyPrefix: keyDiagnostics.keyPrefix,
    revenueCatKeyPlatform: keyDiagnostics.keyPlatform,
    revenueCatExpectedStore: keyDiagnostics.expectedStore,
    revenueCatKeyCorrectForPlatform: keyDiagnostics.correctForCurrentPlatform,
    wrongKeyWarning: keyDiagnostics.wrongKeyWarning,
    ...(androidContext || {}),
  });

  try {
    await Purchases.configure({ apiKey });
    console.log("KRISTO_RC_PURCHASES_CONFIGURE_AFTER", {
      ok: true,
      platform: Platform.OS,
      apiKeyPrefix: keyDiagnostics.keyPrefix,
      ...(androidContext || {}),
    });
  } catch (error) {
    logRevenueCatException("Purchases.configure", error, {
      apiKeyPrefix: keyDiagnostics.keyPrefix,
      revenueCatKeyPlatform: keyDiagnostics.keyPlatform,
    });
    console.log("KRISTO_RC_PURCHASES_CONFIGURE_AFTER", {
      ok: false,
      platform: Platform.OS,
      apiKeyPrefix: keyDiagnostics.keyPrefix,
      ...(androidContext || {}),
      ...getFullRevenueCatErrorDetail(error),
    });
    throw error;
  }
}

async function probeAndroidGooglePlayBillingBeforeOfferings(
  source = "pre-offerings"
): Promise<void> {
  if (!isAndroidPlatform()) return;

  const expectedProductIds = [PREMIUM_MONTHLY_PRODUCT_ID, PREMIUM_YEARLY_PRODUCT_ID];
  const keyForPlatform = describeRevenueCatKeyForPlatform(getRevenueCatApiKey());
  let canMakePayments: boolean | null = null;
  let storefrontCountryCode: string | null = null;

  console.log("KRISTO_ANDROID_RC_STORE", {
    source,
    platform: Platform.OS,
    expectedStore: keyForPlatform.expectedStore,
    revenueCatKeyPlatform: keyForPlatform.keyPlatform,
    revenueCatKeyPrefix: keyForPlatform.keyPrefix,
    revenueCatKeyCorrectForAndroid: keyForPlatform.correctForCurrentPlatform,
    wrongKeyWarning: keyForPlatform.wrongKeyWarning,
    note: "Kristo uses Google Play (PLAY_STORE), not Amazon Appstore.",
  });

  try {
    canMakePayments = await Purchases.canMakePayments();
  } catch (error) {
    logRevenueCatException("canMakePayments", error, { source });
  }

  try {
    const storefront = await Purchases.getStorefront();
    storefrontCountryCode = storefront?.countryCode ?? null;
  } catch (error) {
    logRevenueCatException("getStorefront", error, { source });
  }

  try {
    const products = await runRevenueCatGetProducts(expectedProductIds, `${source}-probe`);
    const loadedIds = products.map((product) => product.identifier);
    const missingIds = expectedProductIds.filter((id) => !loadedIds.includes(id));
    const androidContext = getRevenueCatAndroidDiagnosticsContext();

    console.log("KRISTO_ANDROID_BILLING_CLIENT_PROBE", {
      source,
      billingClientConnected: true,
      canMakePayments,
      storefrontCountryCode,
      googlePlayProductIds: loadedIds,
      missingProductIds: missingIds,
      productsMatchPlayConsole:
        missingIds.length === 0 &&
        loadedIds.includes(PREMIUM_MONTHLY_PRODUCT_ID) &&
        loadedIds.includes(PREMIUM_YEARLY_PRODUCT_ID),
      productSummary: summarizeStoreProducts(products),
      ...androidContext,
    });
  } catch (error) {
    const detail = getFullRevenueCatErrorDetail(error);
    console.log("KRISTO_ANDROID_BILLING_CLIENT_PROBE", {
      source,
      billingClientConnected: false,
      canMakePayments,
      storefrontCountryCode,
      googlePlayProductIds: [],
      ...getRevenueCatAndroidDiagnosticsContext(),
      ...detail,
    });
  }
}

function logAndroidGooglePlayProductsLoaded(offerings: PurchasesOfferings) {
  const current = offerings.current;
  const packages = current?.availablePackages || [];
  const productIds = packages.map((pkg) => String(pkg.product.identifier || ""));
  const monthly = resolveMonthlyPackage(offerings);
  const yearly = resolveYearlyPackage(offerings);

  console.log("KRISTO_GOOGLE_PLAY_PRODUCTS_LOADED", {
    currentOfferingId: current?.identifier || null,
    packageCount: packages.length,
    productIds,
    monthlyProductId: monthly?.product.identifier || null,
    yearlyProductId: yearly?.product.identifier || null,
    monthlyMatchesExpected:
      String(monthly?.product.identifier || "") === PREMIUM_MONTHLY_PRODUCT_ID,
    yearlyMatchesExpected:
      String(yearly?.product.identifier || "") === PREMIUM_YEARLY_PRODUCT_ID,
  });
}

export function logAndroidPurchaseError(error: unknown, meta: Record<string, unknown> = {}) {
  if (!isAndroidPlatform()) return;
  logRevenueCatException(meta.phase ? String(meta.phase) : "purchase", error, meta);
}

let configuredAppUserId: string | null = null;

/** RevenueCat App User ID last configured for church premium (equals churchId). */
export function getRevenueCatConfiguredAppUserId(): string | null {
  return configuredAppUserId;
}

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
    logRevenueCatException("setLogLevel", error);
  }
}

function isRevenueCatNativePlatform() {
  return Platform.OS === "ios" || Platform.OS === "android";
}

async function runRevenueCatNativeStep<T>(
  step:
    | "CONFIGURE"
    | "LOGIN"
    | "LOGOUT"
    | "CUSTOMER_INFO"
    | "IS_CONFIGURED"
    | "SYNC_PURCHASES",
  fn: () => Promise<T> | T,
  meta: Record<string, unknown> = {}
): Promise<T> {
  console.log(`KRISTO_RC_BEFORE_${step}`, meta);
  try {
    const result = await fn();
    console.log(`KRISTO_RC_AFTER_${step}`, { ok: true, ...meta });
    return result;
  } catch (error) {
    logRevenueCatException(step, error, meta);
    console.log(`KRISTO_RC_AFTER_${step}`, {
      ok: false,
      ...meta,
      ...getFullRevenueCatErrorDetail(error),
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
  if (isAndroidPlatform()) {
    logAndroidBillingConfigDiagnostics("ensure-configured");
    console.log("KRISTO_RC_ANDROID_CONFIG_START", {
      ...revenueCatRuntimeInfo(),
      androidApiKey: describeAndroidRevenueCatApiKeySource(),
      ...androidRevenueCatProductConfig(),
    });
  }

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
      await runRevenueCatPurchasesConfigure(apiKey);
      if (isAndroidPlatform()) {
        describeRevenueCatAndroidKeyUsedLog("configure-success", true);
      }
      applyRevenueCatLogLevel();
      const ok = await purchasesIsConfigured();
      console.log(ok ? "KRISTO_RC_CONFIG_SUCCESS" : "KRISTO_RC_CONFIG_FAILED", {
        reason: ok ? "configured" : "configure-returned-not-configured",
        platform: Platform.OS,
        apiKeyPrefix: describeApiKey().keyPrefix,
        ...(isAndroidPlatform() ? getRevenueCatAndroidDiagnosticsContext() : {}),
      });
      return ok;
    } catch (error) {
      logRevenueCatException("ensurePurchasesConfigured", error, {
        reason: "configure-threw",
      });
      console.log("KRISTO_RC_CONFIG_FAILED", {
        reason: "configure-threw",
        ...getFullRevenueCatErrorDetail(error),
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
      logRevenueCatException("logIn", error, { appUserId: safeAppUserId });
      console.log("KRISTO_RC_LOGIN_FAILED", {
        appUserId: safeAppUserId,
        ...getFullRevenueCatErrorDetail(error),
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

export type RevenueCatChurchLoginOptions = {
  /** Run StoreKit receipt sync — only for purchase, restore, or explicit server activation. */
  syncPurchases?: boolean;
};

/** Church premium subscriptions use churchId as the RevenueCat App User ID. */
export async function logInRevenueCatForChurchSubscription(
  churchId: string,
  opts?: RevenueCatChurchLoginOptions
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

    if (opts?.syncPurchases === true) {
      await runRevenueCatNativeStep("SYNC_PURCHASES", () => Purchases.syncPurchases(), {
        churchId: cid,
      });
    }
    return await runRevenueCatNativeStep("CUSTOMER_INFO", () => Purchases.getCustomerInfo(), {
      churchId: cid,
    });
  } catch (error) {
    logRevenueCatException("logInRevenueCatForChurchSubscription", error, { churchId: cid });
    console.log("KRISTO_RC_LOGIN_FOR_CHURCH_SUBSCRIPTION_FAILED", {
      churchId: cid,
      ...getFullRevenueCatErrorDetail(error),
    });
    return null;
  }
}

function resetRevenueCatLocalIdentityState() {
  configuredAppUserId = null;
  loginPromise = null;
  loginAppUserId = null;
  invalidateSubscriptionOfferingsCache();
}

/** Clear RevenueCat church identity — required on logout, account delete, and church switch. */
export async function logOutRevenueCat(): Promise<void> {
  if (isRevenueCatPurchasingDisabled()) {
    resetRevenueCatLocalIdentityState();
    return;
  }

  const previousAppUserId = configuredAppUserId;
  try {
    if (!(await purchasesIsConfigured())) {
      resetRevenueCatLocalIdentityState();
      return;
    }

    console.log("KRISTO_RC_LOGOUT_START", { previousAppUserId });
    await runRevenueCatNativeStep("LOGOUT", () => Purchases.logOut(), {
      previousAppUserId,
    });
    console.log("KRISTO_RC_LOGOUT_SUCCESS", { previousAppUserId });
  } catch (error) {
    logRevenueCatException("logOut", error, { previousAppUserId });
    console.log("KRISTO_RC_LOGOUT_FAILED", {
      previousAppUserId,
      ...getFullRevenueCatErrorDetail(error),
    });
  } finally {
    resetRevenueCatLocalIdentityState();
  }
}

export async function getRevenueCatSdkAppUserId(): Promise<string | null> {
  if (!isRevenueCatNativePlatform() || isRevenueCatPurchasingDisabled()) return null;
  try {
    if (!(await purchasesIsConfigured())) return null;
    const id = String(await Purchases.getAppUserID()).trim();
    return id || null;
  } catch (error) {
    logRevenueCatException("getAppUserID", error);
    return null;
  }
}

export type RevenueCatIdentityVerificationArgs = {
  churchId: string;
  userId?: string | null;
  customerInfo?: CustomerInfo | null;
  serverSubscriptionActive?: boolean | null;
  source: string;
};

/** Log full RC identity chain — run on login hydration and immediately before purchase. */
export async function logRevenueCatIdentityVerification(
  args: RevenueCatIdentityVerificationArgs
): Promise<void> {
  const churchId = String(args.churchId || "").trim() || null;
  const userId = String(args.userId || "").trim() || null;
  const configuredId = String(getRevenueCatConfiguredAppUserId() || "").trim() || null;
  const sdkAppUserId = await getRevenueCatSdkAppUserId();
  const info = args.customerInfo ?? null;
  const originalAppUserId = String(info?.originalAppUserId || "").trim() || null;
  const rcDebug = describeCustomerInfoSubscriptionDebug(info);
  const churchScopedEntitlementActive = Boolean(
    churchId &&
      sdkAppUserId === churchId &&
      configuredId === churchId &&
      originalAppUserId === churchId &&
      hasPremiumEntitlement(info)
  );
  const serverActive = args.serverSubscriptionActive === true;
  const entitlementTrusted =
    churchScopedEntitlementActive && serverActive;

  console.log("KRISTO_RC_IDENTITY_VERIFICATION", {
    source: args.source,
    appUserId: userId,
    churchId,
    purchasesGetAppUserID: sdkAppUserId,
    revenueCatConfiguredAppUserId: configuredId,
    originalAppUserId,
    activeEntitlementIds: rcDebug.activeEntitlementKeys,
    activeProductIdentifiers: rcDebug.activeProductIdentifiers,
    hasPremiumEntitlement: rcDebug.hasPremiumEntitlement,
    serverSubscriptionActive: args.serverSubscriptionActive ?? null,
    churchScopedEntitlementActive,
    identityMatchesChurchId: Boolean(churchId && sdkAppUserId === churchId && configuredId === churchId),
    originalAppUserIdMatchesChurchId: Boolean(churchId && originalAppUserId === churchId),
    entitlementTrustedWithServer: entitlementTrusted,
    policy: "never_trust_rc_entitlement_without_server_and_church_match",
  });

  if (churchId && sdkAppUserId && sdkAppUserId !== churchId) {
    console.log("KRISTO_RC_IDENTITY_MISMATCH", {
      source: args.source,
      churchId,
      purchasesGetAppUserID: sdkAppUserId,
      revenueCatConfiguredAppUserId: configuredId,
      originalAppUserId,
    });
  }
}

/**
 * After session hydration: log out stale RC church identity when needed, then log in for current churchId.
 */
export async function realignRevenueCatIdentityForChurch(args: {
  churchId: string;
  userId?: string | null;
  reason: string;
  forceLogOut?: boolean;
  serverSubscriptionActive?: boolean | null;
}): Promise<CustomerInfo | null> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim() || null;

  if (isRevenueCatPurchasingDisabled()) return null;

  if (!churchId) {
    await logOutRevenueCat();
    return null;
  }

  const configuredId = String(getRevenueCatConfiguredAppUserId() || "").trim();
  const needsLogOut = args.forceLogOut === true || (configuredId && configuredId !== churchId);

  if (needsLogOut) {
    await logOutRevenueCat();
  }

  const info = await logInRevenueCatForChurchSubscription(churchId);
  await logRevenueCatIdentityVerification({
    churchId,
    userId,
    customerInfo: info,
    serverSubscriptionActive: args.serverSubscriptionActive,
    source: args.reason,
  });
  return info;
}

/** Verify RC identity immediately before a store purchase for the current church. */
export async function verifyRevenueCatIdentityBeforePurchase(args: {
  churchId: string;
  userId?: string | null;
  serverSubscriptionActive?: boolean | null;
  source?: string;
}): Promise<CustomerInfo | null> {
  const churchId = String(args.churchId || "").trim();
  if (!churchId) return null;

  const configuredId = String(getRevenueCatConfiguredAppUserId() || "").trim();
  if (configuredId && configuredId !== churchId) {
    await logOutRevenueCat();
  }

  const info = await logInRevenueCatForChurchSubscription(churchId);
  await logRevenueCatIdentityVerification({
    churchId,
    userId: args.userId,
    customerInfo: info,
    serverSubscriptionActive: args.serverSubscriptionActive,
    source: args.source || "pre-purchase",
  });
  return info;
}

export type ConfigureChurchMobileSubscriptionsOptions = RevenueCatChurchLoginOptions;

export type ConfigureChurchMobileSubscriptionsResult = {
  configured: boolean;
  customerInfo: CustomerInfo | null;
};

export async function configureChurchMobileSubscriptions(
  churchId: string,
  opts?: ConfigureChurchMobileSubscriptionsOptions
): Promise<ConfigureChurchMobileSubscriptionsResult> {
  const cid = String(churchId || "").trim();
  if (!cid) return { configured: false, customerInfo: null };

  const ready = await ensurePurchasesConfigured();
  if (!ready) return { configured: false, customerInfo: null };

  const info = await logInRevenueCatForChurchSubscription(cid, opts);
  if (isAndroidPlatform() && info) {
    logRevenueCatAndroidEntitlementDebug(info, "configure-church-subscriptions", { churchId: cid });
  }
  const configured = Boolean(info) || (await purchasesIsConfigured());
  return { configured, customerInfo: info };
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
    message.includes("google play") ||
    message.includes("play console") ||
    message.includes("storekit") ||
    message.includes("couldn't be fetched") ||
    message.includes("configuration")
  );
}

function subscriptionStoreSetupHint(): string {
  if (Platform.OS === "android") {
    return (
      "Google Play products are not available yet. Create premium_monthly and premium_yearly " +
      "in Google Play Console, link them in RevenueCat (entitlement Premium), and publish a test track build."
    );
  }
  return (
    "App Store products are not available yet. Configure church_premium_monthly_g2…g5 " +
    "in App Store Connect (Kristo Premium G2–G5), attach them to RevenueCat entitlement Premium, " +
    "and ensure the backend purchase-product assignment is reachable."
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
    return `${subscriptionStoreSetupHint()} Details: ${message}${codeSuffix}`;
  }

  return message ? `${message}${codeSuffix}` : "Subscription setup could not be completed. Try again later.";
}

const SUBSCRIPTION_OFFERINGS_CACHE_TTL_MS = 5 * 60 * 1000;
let subscriptionOfferingsCache: { value: PurchasesOfferings; at: number } | null = null;

export function invalidateSubscriptionOfferingsCache() {
  subscriptionOfferingsCache = null;
}

export async function getSubscriptionOfferings(opts?: {
  force?: boolean;
}): Promise<PurchasesOfferings> {
  if (isRevenueCatPurchasingDisabled()) {
    throw new Error("RevenueCat offerings skipped during subscription bypass testing");
  }

  if (
    !opts?.force &&
    subscriptionOfferingsCache &&
    Date.now() - subscriptionOfferingsCache.at < SUBSCRIPTION_OFFERINGS_CACHE_TTL_MS
  ) {
    console.log("KRISTO_RC_GET_OFFERINGS_CACHE_HIT", { source: "getSubscriptionOfferings" });
    return subscriptionOfferingsCache.value;
  }

  await requireConfiguredPurchases("offerings");

  console.log("KRISTO_RC_OFFERINGS_START", {
    platform: Platform.OS,
    ...(isAndroidPlatform() ? getRevenueCatAndroidDiagnosticsContext() : {}),
  });
  if (isAndroidPlatform()) {
    await probeAndroidGooglePlayBillingBeforeOfferings("get-offerings");
  }
  try {
    const offerings = await runRevenueCatGetOfferings("getSubscriptionOfferings");
    const current = offerings.current;
    console.log("KRISTO_RC_OFFERINGS_SUCCESS", {
      currentOfferingId: current?.identifier || null,
      allOfferingIds: Object.keys(offerings.all || {}),
      currentPackageCount: current?.availablePackages?.length || 0,
      currentProductIds: (current?.availablePackages || []).map((p) => p.product.identifier),
    });
    if (isAndroidPlatform()) {
      console.log("KRISTO_REVENUECAT_OFFERINGS", {
        currentOfferingId: current?.identifier || null,
        allOfferingIds: Object.keys(offerings.all || {}),
        packageCount: current?.availablePackages?.length || 0,
        productIds: (current?.availablePackages || []).map((p) => p.product.identifier),
        packageSummary: describeCurrentOfferingPackages(offerings),
      });
      logAndroidGooglePlayProductsLoaded(offerings);
      const monthly = resolveMonthlyPackage(offerings);
      const yearly = resolveYearlyPackage(offerings);
      console.log("KRISTO_RC_ANDROID_OFFERINGS_SUCCESS", {
        currentOfferingId: current?.identifier || null,
        monthlyProductId: monthly?.product.identifier || null,
        yearlyProductId: yearly?.product.identifier || null,
        monthlyResolved: monthly?.product.identifier === PREMIUM_MONTHLY_PRODUCT_ID,
        yearlyResolved: yearly?.product.identifier === PREMIUM_YEARLY_PRODUCT_ID,
        monthlyIntroOffer: describeIntroOffer(resolveMonthlyProductIntro(monthly)),
        monthlyHasIntroOffer: monthlyPackageHasIntroOffer(monthly),
        packageSummary: describeCurrentOfferingPackages(offerings),
      });
    }
    subscriptionOfferingsCache = { value: offerings, at: Date.now() };
    return offerings;
  } catch (error) {
    logRevenueCatException("getSubscriptionOfferings", error, { phase: "offerings" });
    const detail = getFullRevenueCatErrorDetail(error);
    console.log("KRISTO_RC_OFFERINGS_FAILED", detail);
    if (isAndroidPlatform()) {
      console.log("KRISTO_REVENUECAT_OFFERINGS_FAILED", {
        ...detail,
        ...getRevenueCatAndroidDiagnosticsContext(),
      });
    }
    // Preserve the real RevenueCat message/code so the UI shows the true cause.
    throw new Error(`${detail.message}${detail.code != null ? ` (code ${detail.code})` : ""}`);
  }
}

export async function prefetchSubscriptionOfferings(): Promise<boolean> {
  try {
    await getSubscriptionOfferings();
    return true;
  } catch (error) {
    logRevenueCatException("prefetchSubscriptionOfferings", error);
    return false;
  }
}

export type PurchaseSubscriptionPackageOptions = {
  /** Replace an existing in-group subscription (monthly → yearly). */
  upgradeFromProductId?: string | null;
};

export async function purchaseSubscriptionPackage(
  pkg: PurchasesPackage,
  opts?: PurchaseSubscriptionPackageOptions & {
    identityContext?: {
      churchId: string;
      userId?: string | null;
      serverSubscriptionActive?: boolean | null;
    };
  }
) {
  if (opts?.identityContext?.churchId) {
    await verifyRevenueCatIdentityBeforePurchase({
      churchId: opts.identityContext.churchId,
      userId: opts.identityContext.userId,
      serverSubscriptionActive: opts.identityContext.serverSubscriptionActive,
      source: "purchaseSubscriptionPackage",
    });
  }

  await requireConfiguredPurchases("purchase");

  const fromProductId = String(opts?.upgradeFromProductId || "").trim();
  let result;

  if (isAndroidPlatform()) {
    console.log("KRISTO_ANDROID_PURCHASE_START", {
      productId: String(pkg.product.identifier || ""),
      packageIdentifier: String(pkg.identifier || ""),
      upgradeFromProductId: fromProductId || null,
      priceString: String(pkg.product.priceString || ""),
    });
  }

  try {
    if (fromProductId && Platform.OS === "android") {
      console.log("KRISTO_RC_PURCHASE_UPGRADE", {
        fromProductId,
        toProductId: String(pkg.product.identifier || ""),
        replacementMode: STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
      });
      result = await Purchases.purchasePackage(pkg, null, {
        oldProductIdentifier: fromProductId,
        replacementMode: STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
      });
    } else {
      if (fromProductId) {
        console.log("KRISTO_RC_PURCHASE_IOS_SUBSCRIPTION_GROUP", {
          fromProductId,
          toProductId: String(pkg.product.identifier || ""),
        });
      }
      result = await Purchases.purchasePackage(pkg);
    }
  } catch (error) {
    logAndroidPurchaseError(error, {
      phase: "purchasePackage",
      productId: String(pkg.product.identifier || ""),
      upgradeFromProductId: fromProductId || null,
    });
    throw error;
  }

  try {
    await Purchases.syncPurchases();
  } catch (error) {
    logRevenueCatException("syncPurchases", error, { phase: "after-purchase" });
  }

  if (isAndroidPlatform()) {
    console.log("KRISTO_RC_ANDROID_PURCHASE_SUCCESS", {
      productId: String(pkg.product.identifier || ""),
      upgradeFromProductId: fromProductId || null,
      entitlementActive: hasPremiumEntitlement(result.customerInfo),
      activePlan: resolveActiveSubscriptionPlan(result.customerInfo),
    });
    logRevenueCatAndroidEntitlementDebug(result.customerInfo, "purchase-success", {
      productId: String(pkg.product.identifier || ""),
      upgradeFromProductId: fromProductId || null,
    });
  }

  return result;
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll RevenueCat after StoreKit purchase until a premium entitlement appears. */
export async function refreshCustomerInfoAfterStorePurchase(
  initialInfo?: CustomerInfo | null,
  opts?: { maxAttempts?: number; delayMs?: number }
): Promise<{ info: CustomerInfo; entitlementActive: boolean }> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 8);
  const delayMs = Math.max(0, opts?.delayMs ?? 1500);

  let info = initialInfo ?? (await getCustomerSubscriptionInfo());
  let entitlementActive = hasPremiumEntitlement(info);

  for (let i = 0; i < maxAttempts && !entitlementActive; i++) {
    try {
      await Purchases.syncPurchases();
    } catch (error) {
      logRevenueCatException("syncPurchases", error, { phase: "refresh-after-store-purchase" });
    }
    await sleepMs(delayMs);
    info = await getCustomerSubscriptionInfo();
    entitlementActive = hasPremiumEntitlement(info);
  }

  return { info, entitlementActive };
}

/** Poll RevenueCat until the active entitlement product is premium_yearly. */
export async function refreshCustomerInfoUntilYearlyActive(
  initialInfo?: CustomerInfo | null,
  opts?: { maxAttempts?: number; delayMs?: number }
): Promise<{ info: CustomerInfo; activeYearly: boolean }> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 10);
  const delayMs = Math.max(0, opts?.delayMs ?? 1200);

  let info = initialInfo ?? (await getCustomerSubscriptionInfo());
  let activeYearly = resolveActiveSubscriptionPlan(info) === "yearly";

  for (let i = 0; i < maxAttempts && !activeYearly; i++) {
    try {
      await Purchases.syncPurchases();
    } catch (error) {
      logRevenueCatException("syncPurchases", error, { phase: "refresh-after-store-purchase" });
    }
    await sleepMs(delayMs);
    info = await getCustomerSubscriptionInfo();
    activeYearly = resolveActiveSubscriptionPlan(info) === "yearly";
  }

  console.log("KRISTO_RC_YEARLY_ACTIVE_POLL_RESULT", {
    activeYearly,
    activeProductId: String(getActivePremiumEntitlement(info)?.productIdentifier || ""),
  });

  return { info, activeYearly };
}

export async function restoreSubscriptionPurchases() {
  await requireConfiguredPurchases("restore");
  const result = await Purchases.restorePurchases();
  try {
    await Purchases.syncPurchases();
  } catch (error) {
    logRevenueCatException("syncPurchases", error, { phase: "after-restore" });
  }
  return result;
}

export const EXISTING_STORE_SUBSCRIPTION_SYNC_TITLE = "Subscription found";
export const EXISTING_STORE_SUBSCRIPTION_SYNC_MESSAGE =
  "Syncing with your church…";

/** True when StoreKit / Play reports the tester already owns this subscription product. */
export function isExistingStoreSubscriptionError(error: unknown): boolean {
  const detail = getFullRevenueCatErrorDetail(error);
  const readable = String(detail.readableErrorCode || "").toUpperCase();
  const blob = [
    detail.message,
    detail.underlyingErrorMessage,
    JSON.stringify(detail.errorSnapshot || null),
    JSON.stringify(detail.rawUserInfo || null),
  ]
    .join(" ")
    .toLowerCase();

  if (
    readable.includes("PRODUCT_ALREADY_PURCHASED") ||
    readable.includes("ALREADY_OWNED") ||
    readable.includes("ITEM_ALREADY_OWNED") ||
    readable.includes("PURCHASE_ALREADY_OWNED")
  ) {
    return true;
  }

  return (
    /already subscribed/.test(blob) ||
    /you.?re already subscribed/.test(blob) ||
    /product.?already.?purchased/.test(blob) ||
    /subscription is active/.test(blob) ||
    /already own/.test(blob) ||
    /unable to purchase.*already/.test(blob) ||
    /has an active subscription/.test(blob)
  );
}

function isChurchScopedPremiumEntitlementForRecovery(
  churchId: string,
  customerInfo: CustomerInfo | null | undefined
): boolean {
  const cid = String(churchId || "").trim();
  if (!cid) return false;
  const configured = String(getRevenueCatConfiguredAppUserId() || "").trim();
  if (!configured || configured !== cid) return false;
  return hasPremiumEntitlement(customerInfo);
}

export type RecoverStoreSubscriptionForChurchResult = {
  customerInfo: CustomerInfo | null;
  entitlementActive: boolean;
  churchScopedEntitlementActive: boolean;
  resolvedPlan: SubscriptionPlanKey | null;
};

/**
 * Restore + sync an Apple/Google subscription already on the device onto the current church RC user.
 */
export async function recoverStoreSubscriptionForChurch(args: {
  churchId: string;
  source?: string;
}): Promise<RecoverStoreSubscriptionForChurchResult> {
  const churchId = String(args.churchId || "").trim();
  const empty: RecoverStoreSubscriptionForChurchResult = {
    customerInfo: null,
    entitlementActive: false,
    churchScopedEntitlementActive: false,
    resolvedPlan: null,
  };
  if (!churchId) return empty;

  console.log("KRISTO_RC_EXISTING_SUBSCRIPTION_RECOVER_START", {
    churchId,
    source: args.source || "recover",
  });

  await logInRevenueCatForChurchSubscription(churchId, { syncPurchases: true });

  let info: CustomerInfo | null = null;
  try {
    const restored = await restoreSubscriptionPurchases();
    info =
      restored && typeof restored === "object" && "customerInfo" in restored
        ? (restored as { customerInfo: CustomerInfo }).customerInfo
        : (restored as CustomerInfo);
  } catch (error) {
    logRevenueCatException("restorePurchases", error, {
      churchId,
      phase: "existing-subscription-recover",
    });
    try {
      await runRevenueCatNativeStep("SYNC_PURCHASES", () => Purchases.syncPurchases(), {
        churchId,
      });
      info = await getCustomerSubscriptionInfo();
    } catch (syncError) {
      logRevenueCatException("syncPurchases", syncError, {
        churchId,
        phase: "existing-subscription-recover-fallback",
      });
    }
  }

  const refreshed = await refreshCustomerInfoAfterStorePurchase(info, {
    maxAttempts: __DEV__ ? 6 : 8,
    delayMs: __DEV__ ? 1000 : 1500,
  });
  info = refreshed.info;

  const churchScoped = isChurchScopedPremiumEntitlementForRecovery(churchId, info);
  const resolvedPlan =
    resolveActiveSubscriptionPlan(info) || resolvePremiumPlanFromCustomerInfo(info);

  console.log("KRISTO_RC_EXISTING_SUBSCRIPTION_RECOVER_DONE", {
    churchId,
    churchScopedEntitlementActive: churchScoped,
    hasPremiumEntitlement: hasPremiumEntitlement(info),
    resolvedPlan,
    originalAppUserId: info?.originalAppUserId ?? null,
    activeEntitlementIds: getActiveEntitlementKeys(info),
  });

  return {
    customerInfo: info,
    entitlementActive: hasPremiumEntitlement(info),
    churchScopedEntitlementActive: churchScoped,
    resolvedPlan,
  };
}

export async function getCustomerSubscriptionInfo(): Promise<CustomerInfo> {
  if (isRevenueCatPurchasingDisabled()) {
    throw new Error("RevenueCat customer info skipped during subscription bypass testing");
  }

  await requireConfiguredPurchases("customer info");
  return runRevenueCatNativeStep("CUSTOMER_INFO", () => Purchases.getCustomerInfo());
}

export function getActiveEntitlementKeys(
  customerInfo: CustomerInfo | null | undefined
): string[] {
  return Object.keys(customerInfo?.entitlements?.active || {});
}

export { detectPremiumEntitlementKey } from "./churchPremiumRevenueCat";

/** Single source of truth: Premium or church_premium from RevenueCat. */
export function hasPremiumEntitlement(
  customerInfo: CustomerInfo | null | undefined
): boolean {
  return detectPremiumEntitlementKey(getActiveEntitlementKeys(customerInfo)) !== null;
}

export function getActivePremiumEntitlement(
  customerInfo: CustomerInfo | null | undefined
) {
  const active = customerInfo?.entitlements?.active || {};
  for (const id of CHURCH_PREMIUM_ENTITLEMENT_IDS) {
    if (active[id]) return active[id];
  }
  return null;
}

export function logEntitlementAudit(args: {
  customerInfo?: CustomerInfo | null;
  churchId?: string | null;
  source?: string;
}) {
  const activeEntitlementKeys = getActiveEntitlementKeys(args.customerInfo);
  const detectedEntitlement = detectPremiumEntitlementKey(activeEntitlementKeys);
  console.log("KRISTO_ENTITLEMENT_AUDIT", {
    source: args.source || null,
    activeEntitlementKeys,
    detectedEntitlement,
    hasPremiumEntitlement: hasPremiumEntitlement(args.customerInfo),
    currentChurchId: String(args.churchId || "").trim() || null,
  });
}

export function hasActiveEntitlement(
  customerInfo: CustomerInfo,
  entitlementId?: string
) {
  if (isSubscriptionBypassEnabled()) return true;
  if (entitlementId && !isChurchPremiumEntitlementId(entitlementId)) {
    return Boolean(customerInfo.entitlements.active[entitlementId]);
  }
  return hasPremiumEntitlement(customerInfo);
}

/**
 * Real entitlement check that IGNORES every dev/review bypass. Use this to drive
 * the purchase UI ("Active" badge, post-purchase confirmation) so the screen can
 * never claim a plan is active without an actual StoreKit purchase.
 */
export function hasRealActiveEntitlement(
  customerInfo: CustomerInfo | null | undefined,
  entitlementId?: string
) {
  if (entitlementId && !isChurchPremiumEntitlementId(entitlementId)) {
    return Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
  }
  return hasPremiumEntitlement(customerInfo);
}

function isPremiumProductIdentifier(productId: string): boolean {
  return isChurchPremiumProductId(productId);
}

function subscriptionExpirationIsActive(expires: string | null | undefined): boolean {
  if (expires === null || expires === undefined) return true;
  const ms = Date.parse(String(expires));
  if (Number.isNaN(ms)) return false;
  return ms > Date.now();
}

/** True when StoreKit/RC shows an active church premium product (G2–G5 or legacy), even if entitlement is delayed. */
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

/** True when the signed-in store account on this device can open subscription management. */
export function isDeviceManageableAppStoreSubscription(
  customerInfo: CustomerInfo | null | undefined
): boolean {
  if (!customerInfo) return false;
  if (hasActivePremiumProduct(customerInfo)) return true;
  const managementURL = String(customerInfo.managementURL || "").trim();
  return Platform.OS === "ios" && Boolean(managementURL);
}

/** Android Play manage gate: active Kristo product or RevenueCat management URL on this device. */
export function canOpenAndroidPlaySubscriptionManagement(
  customerInfo: CustomerInfo | null | undefined
): boolean {
  if (!customerInfo) return false;
  if (hasActivePremiumProduct(customerInfo)) return true;
  return Boolean(String(customerInfo.managementURL || "").trim());
}

export function resolveAppStoreBillingFooterText(opts?: { subscribed?: boolean }): string {
  const subscribedSuffix =
    opts?.subscribed === true ? " Changes apply on your next billing date." : "";
  if (Platform.OS === "android") {
    return `Billing is managed in Google Play. Cancel anytime from Play Store subscriptions.${subscribedSuffix}`;
  }
  return `Billing is managed in Apple Subscriptions. Cancel anytime from Settings → Apple ID → Subscriptions.${subscribedSuffix}`;
}

export function resolveAppStoreManageFallbackMessage(): string {
  if (Platform.OS === "android") {
    return "This premium access is active, but there is no Google Play subscription to manage on this device. It may be managed through offline activation, backend activation, or a different Google Play account.";
  }
  if (isRevenueCatSandboxSubscriptionEnvironment()) {
    return "For sandbox subscriptions, open Settings → App Store → Sandbox Account → Manage.";
  }
  return "Open Settings → Apple ID → Subscriptions to manage or cancel your plan.";
}

export const IOS_SANDBOX_MANAGE_SUBSCRIPTION_MESSAGE =
  "For sandbox subscriptions, open Settings → App Store → Sandbox Account → Manage.";

const IOS_APP_STORE_SETTINGS_URLS = ["App-Prefs:STORE", "prefs:root=STORE"] as const;

/** Best-effort deep link to iOS App Store settings (undocumented; may fail on some OS versions). */
export async function openIosAppStoreSettings(): Promise<{
  opened: boolean;
  path: string | null;
}> {
  if (Platform.OS !== "ios") return { opened: false, path: null };

  for (const url of IOS_APP_STORE_SETTINGS_URLS) {
    try {
      await Linking.openURL(url);
      return { opened: true, path: url };
    } catch {
      // try next candidate
    }
  }

  return { opened: false, path: null };
}

export function presentIosSandboxSubscriptionManageInstructions(args?: {
  source?: string;
  customerInfo?: CustomerInfo | null;
}): void {
  Alert.alert("Manage / Cancel subscription", IOS_SANDBOX_MANAGE_SUBSCRIPTION_MESSAGE, [
    {
      text: "Open App Store Settings",
      onPress: () => {
        void openIosAppStoreSettings();
      },
    },
    { text: "OK", style: "cancel" },
  ]);
}

export function resolveCheckoutFooterText(args: {
  subscribed: boolean;
  monthlyTrialEligible: boolean;
}): string {
  if (args.subscribed) {
    return resolveAppStoreBillingFooterText({ subscribed: true });
  }
  if (Platform.OS === "android") {
    return args.monthlyTrialEligible
      ? "No charge during the free trial. Cancel anytime in Google Play subscriptions."
      : "Secure checkout through Google Play. Cancel anytime.";
  }
  return args.monthlyTrialEligible
    ? "No charge during the free trial. Cancel anytime in Apple Subscriptions."
    : "Secure checkout through Apple. Cancel anytime.";
}

export function resolveSubscriptionPackagesLoadingMessage(): string {
  if (Platform.OS === "android") {
    return "Google Play plans are still loading. Tap retry in a moment.";
  }
  return "App Store packages are still loading. Tap retry in a moment.";
}

export function resolveSubscriptionPackagesUnavailableMessage(): string {
  if (Platform.OS === "android") {
    return "Google Play plans are not available yet. Tap retry, then try again.";
  }
  return "App Store packages are not available yet. Tap retry, then try again.";
}

/** True when this church has a verified RC purchase that still needs backend activation. */
export function canShowChurchSubscriptionRestore(args: {
  churchId: string;
  customerInfo: CustomerInfo | null | undefined;
  backendSubscriptionActive?: boolean | null;
}): boolean {
  const churchId = String(args.churchId || "").trim();
  if (!churchId) return false;
  if (args.backendSubscriptionActive === true) return false;

  const info = args.customerInfo;
  if (!info) return false;

  const originalAppUserId = String(info.originalAppUserId || "").trim();
  if (!originalAppUserId || originalAppUserId !== churchId) return false;
  if (!hasPremiumEntitlement(info)) return false;

  const activeSubscriptions = info.activeSubscriptions || [];
  return activeSubscriptions.some(isPremiumProductIdentifier);
}

/** Re-check RC App User ID ownership before allowing restore/sync for the current church. */
export function verifyChurchSubscriptionRestoreOwnership(
  churchId: string,
  customerInfo: CustomerInfo | null | undefined
): boolean {
  const resolvedChurchId = String(churchId || "").trim();
  if (!resolvedChurchId) return false;

  const configuredAppUserId = String(getRevenueCatConfiguredAppUserId() || "").trim();
  if (configuredAppUserId && configuredAppUserId !== resolvedChurchId) {
    return false;
  }

  return canShowChurchSubscriptionRestore({
    churchId: resolvedChurchId,
    customerInfo,
    backendSubscriptionActive: false,
  });
}

export function describeCustomerInfoSubscriptionDebug(
  customerInfo: CustomerInfo | null | undefined
) {
  const activeEntitlementKeys = Object.keys(customerInfo?.entitlements?.active || {});
  const activeProductIdentifiers = new Set<string>();

  for (const productId of customerInfo?.activeSubscriptions || []) {
    if (productId) activeProductIdentifiers.add(String(productId));
  }
  for (const entitlement of Object.values(customerInfo?.entitlements?.active || {})) {
    const productId = String(entitlement?.productIdentifier || "").trim();
    if (productId) activeProductIdentifiers.add(productId);
  }

  return {
    activeEntitlementKeys,
    activeProductIdentifiers: [...activeProductIdentifiers],
    detectedEntitlement: detectPremiumEntitlementKey(activeEntitlementKeys),
    hasPremiumEntitlement: hasPremiumEntitlement(customerInfo),
    hasRealEntitlement: hasPremiumEntitlement(customerInfo),
    hasActivePremiumProduct: hasActivePremiumProduct(customerInfo),
  };
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

    if (isYearlyChurchPremiumProductId(productId)) {
      return "yearly";
    }

    if (isMonthlyChurchPremiumProductId(productId)) {
      return "monthly";
    }
  }

  return null;
}

export function resolveChurchPremiumRenewalDate(
  customerInfo: CustomerInfo | null | undefined
): Date | null {
  if (!customerInfo) return null;

  const entitlement = getActivePremiumEntitlement(customerInfo);
  const raw =
    entitlement?.expirationDate ||
    customerInfo.latestExpirationDate ||
    null;

  if (raw === null || raw === undefined) return null;
  const ms = Date.parse(String(raw));
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

export function formatPremiumRenewalDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** True in dev builds or when RevenueCat reports a sandbox / test store purchase. */
export function isRevenueCatSandboxSubscriptionEnvironment(
  customerInfo?: CustomerInfo | null
): boolean {
  if (__DEV__) return true;

  const entitlement = getActivePremiumEntitlement(customerInfo);
  const store = String(entitlement?.store || "").trim().toUpperCase();
  if (store === "SANDBOX" || store === "TEST_STORE") return true;

  for (const subscription of Object.values(
    customerInfo?.subscriptionsByProductIdentifier || {}
  )) {
    const subStore = String((subscription as any)?.store || "").trim().toUpperCase();
    if (subStore === "SANDBOX" || subStore === "TEST_STORE") return true;
  }

  return false;
}

/** iOS dev/sandbox builds should not use RevenueCat managementURL (production Apple ID subscriptions UI). */
export function shouldUseIosSandboxSubscriptionManageInstructions(
  customerInfo?: CustomerInfo | null
): boolean {
  return Platform.OS === "ios" && isRevenueCatSandboxSubscriptionEnvironment(customerInfo);
}

export function formatPremiumSubscriptionExpiryLabel(
  date: Date | null | undefined,
  opts?: { customerInfo?: CustomerInfo | null; sandbox?: boolean }
): string | null {
  if (!date) return null;
  const formatted = formatPremiumRenewalDate(date);
  const sandbox =
    opts?.sandbox === true ||
    isRevenueCatSandboxSubscriptionEnvironment(opts?.customerInfo);
  return sandbox ? `Sandbox expires ${formatted}` : `Expires ${formatted}`;
}

export function formatPremiumSubscriptionRenewalLabel(
  date: Date | null | undefined,
  opts?: { customerInfo?: CustomerInfo | null; sandbox?: boolean }
): string | null {
  if (!date) return null;
  const formatted = formatPremiumRenewalDate(date);
  const sandbox =
    opts?.sandbox === true ||
    isRevenueCatSandboxSubscriptionEnvironment(opts?.customerInfo);
  return sandbox ? `Sandbox renews ${formatted}` : `Renews ${formatted}`;
}

export type PremiumIntroTrialBilling = {
  isActive: boolean;
  badgeLabel: string | null;
  trialDays: number | null;
  trialEndsAt: Date | null;
  firstPaymentAmount: string | null;
  periodType: "TRIAL" | "INTRO" | null;
};

function parseRevenueCatDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(String(value));
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function normalizeRevenueCatPeriodType(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function isActiveIntroOrTrialPeriodType(value: unknown): boolean {
  const periodType = normalizeRevenueCatPeriodType(value);
  return periodType === "TRIAL" || periodType === "INTRO";
}

function findActiveMonthlySubscriptionInfo(
  customerInfo: CustomerInfo | null | undefined
) {
  if (!customerInfo) return null;

  const entitlement = getActivePremiumEntitlement(customerInfo);
  const preferredProductId = String(entitlement?.productIdentifier || "").trim();

  if (preferredProductId) {
    const preferred = customerInfo.subscriptionsByProductIdentifier?.[preferredProductId];
    if (preferred?.isActive && isActiveIntroOrTrialPeriodType(preferred.periodType)) {
      return preferred;
    }
  }

  for (const [productId, subscription] of Object.entries(
    customerInfo.subscriptionsByProductIdentifier || {}
  )) {
    if (!isMonthlyPremiumProductId(productId)) continue;
    if (subscription?.isActive && isActiveIntroOrTrialPeriodType(subscription.periodType)) {
      return subscription;
    }
  }

  return null;
}

/** Detect an active StoreKit / RevenueCat introductory free-trial period on the church premium plan. */
export function resolveActivePremiumIntroTrialState(
  customerInfo: CustomerInfo | null | undefined,
  monthlyPackage?: PurchasesPackage | null
): PremiumIntroTrialBilling {
  const inactive: PremiumIntroTrialBilling = {
    isActive: false,
    badgeLabel: null,
    trialDays: null,
    trialEndsAt: null,
    firstPaymentAmount: null,
    periodType: null,
  };

  if (!customerInfo || !hasPremiumEntitlement(customerInfo)) {
    return inactive;
  }

  if (resolveActiveSubscriptionPlan(customerInfo) !== "monthly") {
    return inactive;
  }

  const entitlement = getActivePremiumEntitlement(customerInfo);
  const subscription = findActiveMonthlySubscriptionInfo(customerInfo);
  const periodTypeRaw =
    subscription?.periodType || entitlement?.periodType || null;

  if (!isActiveIntroOrTrialPeriodType(periodTypeRaw)) {
    return inactive;
  }

  const periodType = normalizeRevenueCatPeriodType(periodTypeRaw) as "TRIAL" | "INTRO";
  const trialEndsAt = parseRevenueCatDate(
    subscription?.expiresDate || entitlement?.expirationDate || null
  );

  const intro = resolveMonthlyProductIntro(monthlyPackage || null);
  const trialDays = resolveIntroTrialDays(intro) ?? MONTHLY_INTRO_TRIAL_DAYS;
  const badgeLabel = `${trialDays}-Day Free Trial Active`;
  const firstPaymentAmount =
    String(monthlyPackage?.product?.priceString || "").trim() || "$49.99";

  console.log("KRISTO_RC_ACTIVE_INTRO_TRIAL", {
    periodType,
    trialDays,
    trialEndsAt: trialEndsAt?.toISOString() || null,
    firstPaymentAmount,
    productIdentifier:
      subscription?.productIdentifier || entitlement?.productIdentifier || null,
  });

  return {
    isActive: true,
    badgeLabel,
    trialDays,
    trialEndsAt,
    firstPaymentAmount,
    periodType,
  };
}

export function formatPremiumIntroTrialBillingLine(
  introTrial: PremiumIntroTrialBilling
): string | null {
  if (!introTrial.isActive) return null;

  const endsLabel = introTrial.trialEndsAt
    ? formatPremiumRenewalDate(introTrial.trialEndsAt)
    : null;

  if (endsLabel && introTrial.firstPaymentAmount) {
    return `First payment: ${introTrial.firstPaymentAmount} on ${endsLabel}`;
  }

  if (endsLabel) {
    return `Trial ends ${endsLabel}`;
  }

  return introTrial.badgeLabel;
}

export type PremiumSubscriptionBillingDetails = {
  status: "Active" | "Inactive";
  autoRenew: "On" | "Off" | "—";
  renewalDate: Date | null;
  billingCycle: "Monthly" | "Yearly" | null;
  introTrial: PremiumIntroTrialBilling;
};

export function resolvePremiumSubscriptionBillingDetails(
  customerInfo: CustomerInfo | null | undefined,
  opts?: { monthlyPackage?: PurchasesPackage | null }
): PremiumSubscriptionBillingDetails {
  const introTrial = resolveActivePremiumIntroTrialState(
    customerInfo,
    opts?.monthlyPackage
  );
  const inactive: PremiumSubscriptionBillingDetails = {
    status: "Inactive",
    autoRenew: "—",
    renewalDate: null,
    billingCycle: null,
    introTrial,
  };

  if (!customerInfo || !hasPremiumEntitlement(customerInfo)) {
    return inactive;
  }

  const entitlement = getActivePremiumEntitlement(customerInfo);
  const plan = resolveActiveSubscriptionPlan(customerInfo);
  const willRenew = entitlement?.willRenew;
  const renewalDate = introTrial.isActive
    ? introTrial.trialEndsAt
    : resolveChurchPremiumRenewalDate(customerInfo);

  return {
    status: "Active",
    autoRenew: willRenew === true ? "On" : willRenew === false ? "Off" : "—",
    renewalDate,
    billingCycle: plan === "yearly" ? "Yearly" : plan === "monthly" ? "Monthly" : null,
    introTrial,
  };
}

export function formatYearlyUpgradeSavingsLabel(
  monthlyPackage: PurchasesPackage | null | undefined,
  yearlyPackage: PurchasesPackage | null | undefined
): string {
  const monthlyPrice = monthlyPackage?.product?.price;
  const yearlyPrice = yearlyPackage?.product?.price;
  const currency = yearlyPackage?.product?.priceString?.replace(/[\d.,\s]/g, "").trim() || "$";

  if (typeof monthlyPrice === "number" && typeof yearlyPrice === "number" && yearlyPrice > 0) {
    const savings = Math.max(0, monthlyPrice * 12 - yearlyPrice);
    if (savings >= 1) {
      return `Save ${currency}${Math.round(savings)}/year compared to monthly billing`;
    }
  }

  return "Save about $100/year compared to monthly billing";
}

export function formatShortYearlySavingsLabel(
  monthlyPackage: PurchasesPackage | null | undefined,
  yearlyPackage: PurchasesPackage | null | undefined
): string {
  return resolveYearlySavingsDisplay(monthlyPackage, yearlyPackage).amountLabel;
}

export function resolveYearlySavingsDisplay(
  monthlyPackage: PurchasesPackage | null | undefined,
  yearlyPackage: PurchasesPackage | null | undefined
): { percentLabel: string; amountLabel: string } {
  const monthlyPrice = monthlyPackage?.product?.price ?? 49.99;
  const yearlyPrice = yearlyPackage?.product?.price ?? 499.99;
  const currency = yearlyPackage?.product?.priceString?.replace(/[\d.,\s]/g, "").trim() || "$";
  const annualMonthly = monthlyPrice * 12;
  const savings = Math.max(0, annualMonthly - yearlyPrice);
  const percent =
    annualMonthly > 0 ? Math.round((savings / annualMonthly) * 100) : 17;

  const amountText =
    savings >= 0.01
      ? `Save ${currency}${savings.toFixed(2)}/year`
      : "Save $99.89/year";

  return {
    percentLabel: `Save ${percent}%`,
    amountLabel: amountText,
  };
}

export function getSubscriptionStoreLabel(): string {
  if (Platform.OS === "android") return "Google Play Subscriptions";
  return "Apple Subscriptions";
}

export function resolveActiveSubscriptionPlan(
  customerInfo: CustomerInfo
): SubscriptionPlanKey | null {
  if (!hasActiveEntitlement(customerInfo)) {
    return null;
  }

  const premiumEntitlement = getActivePremiumEntitlement(customerInfo);
  const productId = String(premiumEntitlement?.productIdentifier || "").trim();

  if (!productId) {
    return null;
  }

  if (isYearlyPremiumProductId(productId)) {
    return "yearly";
  }

  if (isMonthlyPremiumProductId(productId)) {
    return "monthly";
  }

  return null;
}

function isYearlyPremiumProductId(productId: string): boolean {
  return isYearlyChurchPremiumProductId(productId);
}

function isMonthlyPremiumProductId(productId: string): boolean {
  return isMonthlyChurchPremiumProductId(productId);
}

export type MediaPremiumPlanUiState = {
  hasPremium: boolean;
  activeMonthly: boolean;
  activeYearly: boolean;
};

function summarizeSubscriptionOwnership(
  customerInfo: CustomerInfo | null | undefined,
  matchesProductId: (productId: string) => boolean
) {
  if (!customerInfo) return null;

  const subscriptions = customerInfo.subscriptionsByProductIdentifier || {};
  for (const [productId, subscription] of Object.entries(subscriptions)) {
    if (!matchesProductId(productId)) continue;
    return {
      productIdentifier: productId,
      isActive: subscription?.isActive ?? null,
      willRenew: subscription?.willRenew ?? null,
      expiresDate: subscription?.expiresDate ?? null,
      ownershipType: subscription?.ownershipType ?? null,
      store: subscription?.store ?? null,
    };
  }

  return null;
}

function collectAllRevenueCatProductIdentifiers(
  customerInfo: CustomerInfo | null | undefined
): string[] {
  if (!customerInfo) return [];

  const ids = new Set<string>();
  for (const id of customerInfo.activeSubscriptions || []) {
    if (id) ids.add(String(id));
  }
  for (const id of customerInfo.allPurchasedProductIdentifiers || []) {
    if (id) ids.add(String(id));
  }
  for (const id of Object.keys(customerInfo.subscriptionsByProductIdentifier || {})) {
    if (id) ids.add(String(id));
  }
  for (const entitlement of Object.values(customerInfo.entitlements?.active || {})) {
    const productId = String(entitlement?.productIdentifier || "").trim();
    if (productId) ids.add(productId);
  }
  for (const entitlement of Object.values(customerInfo.entitlements?.all || {})) {
    const productId = String(entitlement?.productIdentifier || "").trim();
    if (productId) ids.add(productId);
  }

  return [...ids].sort();
}

export type SubscriptionOwnershipChainDiag = {
  platform: string;
  sessionUserId: string | null;
  churchId: string | null;
  revenueCatConfiguredAppUserId: string | null;
  revenueCatLoggedInAsChurchId: boolean;
  server: {
    subscriptionActive: boolean;
    subscriptionSource: string | null;
    subscriptionPlan: string | null;
    subscriptionExpiresAt: number | null;
    subscriptionEnvironment: "sandbox" | "production" | "unknown" | "dev_build_label";
    note: string;
  };
  deviceCustomerInfo: {
    hasCustomerInfo: boolean;
    originalAppUserId: string | null;
    activeSubscriptions: string[];
    allPurchasedProductIdentifiers: string[];
    activeEntitlementIds: string[];
    activeEntitlements: Record<
      string,
      {
        productIdentifier: string | null;
        store: string | null;
        expirationDate: string | null;
        isActive: boolean | null;
        willRenew: boolean | null;
      }
    >;
    managementURL: string | null;
    hasPremiumEntitlement: boolean;
    hasActivePremiumProduct: boolean;
    identityMatchesChurchId: boolean;
    originalAppUserIdMatchesChurchId: boolean;
  };
  manageability: {
    wouldPassManageGate: boolean;
    gateBlockReason: string | null;
  };
  identityChain: string[];
};

/** Read-only ownership snapshot for server vs device subscription mismatch diagnosis. */
export function buildSubscriptionOwnershipChainDiag(args: {
  churchId: string;
  sessionUserId?: string | null;
  mediaPremiumStatus: {
    serverSubscriptionActive: boolean;
    subscriptionSource: string | null;
    subscriptionPlan: string | null;
    subscriptionExpiresAt: number | null;
  } | null;
  customerInfo?: CustomerInfo | null;
}): SubscriptionOwnershipChainDiag {
  const churchId = String(args.churchId || "").trim() || null;
  const sessionUserId = String(args.sessionUserId || "").trim() || null;
  const configuredAppUserId = String(getRevenueCatConfiguredAppUserId() || "").trim() || null;
  const info = args.customerInfo ?? null;
  const status = args.mediaPremiumStatus;

  const activeEntitlements = info?.entitlements?.active || {};
  const activeEntitlementSummary = Object.fromEntries(
    Object.entries(activeEntitlements).map(([key, entitlement]) => [
      key,
      {
        productIdentifier: entitlement?.productIdentifier ?? null,
        store: entitlement?.store ?? null,
        expirationDate: entitlement?.expirationDate ?? null,
        isActive: entitlement?.isActive ?? null,
        willRenew: entitlement?.willRenew ?? null,
      },
    ])
  );

  const premiumEntitlement = getActivePremiumEntitlement(info);
  const entitlementStore = String(premiumEntitlement?.store || "").trim().toUpperCase();
  const sandboxFromEntitlement =
    entitlementStore === "SANDBOX" || entitlementStore === "TEST_STORE";
  const subscriptionEnvironment: SubscriptionOwnershipChainDiag["server"]["subscriptionEnvironment"] =
    __DEV__
      ? "dev_build_label"
      : sandboxFromEntitlement
        ? "sandbox"
        : premiumEntitlement
          ? "production"
          : "unknown";

  const originalAppUserId = String(info?.originalAppUserId || "").trim() || null;
  const managementURL = String(info?.managementURL || "").trim() || null;
  const hasPlayPremiumOnDevice = hasActivePremiumProduct(info);
  const serverActive = status?.serverSubscriptionActive === true;
  const subscriptionSource = status?.subscriptionSource ?? null;

  let gateBlockReason: string | null = null;
  if (subscriptionSource === "offline_activation") {
    gateBlockReason = "offline_activation";
  } else if (serverActive && !hasPlayPremiumOnDevice && !managementURL) {
    gateBlockReason = "no_play_subscription_on_device";
  }

  const storeAccountLabel =
    Platform.OS === "ios"
      ? "Apple/App Store account (device-local, not readable by app)"
      : Platform.OS === "android"
        ? "Google Play account (device-local, not readable by app)"
        : "App store account (device-local, not readable by app)";

  const identityChain: string[] = [
    `${storeAccountLabel} →`,
    `RevenueCat originalAppUserId=${originalAppUserId || "null"} →`,
    `RevenueCat configuredAppUserId=${configuredAppUserId || "null"} →`,
    `Kristo churchId=${churchId || "null"} →`,
    `Kristo sessionUserId=${sessionUserId || "null"} →`,
    `backend subscriptionSource=${subscriptionSource || "null"}`,
  ];

  if (churchId && configuredAppUserId && configuredAppUserId !== churchId) {
    identityChain.push(
      `MISMATCH: RC configured as ${configuredAppUserId} but screen churchId is ${churchId}`
    );
  }
  if (churchId && originalAppUserId && originalAppUserId !== churchId) {
    const configuredMatchesChurch = configuredAppUserId === churchId;
    if (configuredMatchesChurch && serverActive) {
      identityChain.push(
        `DIAG: RC originalAppUserId ${originalAppUserId} !== churchId ${churchId} (aliased/restored customer — configuredAppUserId matches church and server confirms active)`
      );
    } else {
      identityChain.push(
        `MISMATCH: RC originalAppUserId ${originalAppUserId} !== churchId ${churchId} (aliased/restored customer)`
      );
    }
  }
  if (serverActive && !hasPlayPremiumOnDevice && !managementURL) {
    identityChain.push(
      Platform.OS === "ios"
        ? "Server profile active but device has no manageable App Store subscription (wrong Apple ID, sandbox/prod lane split, or backend-only activation)"
        : "Server profile active but device has no manageable Play subscription (wrong Play account, sandbox/prod lane split, or backend-only activation)"
    );
  }

  return {
    platform: Platform.OS,
    sessionUserId,
    churchId,
    revenueCatConfiguredAppUserId: configuredAppUserId,
    revenueCatLoggedInAsChurchId: Boolean(churchId && configuredAppUserId === churchId),
    server: {
      subscriptionActive: serverActive,
      subscriptionSource,
      subscriptionPlan: status?.subscriptionPlan ?? null,
      subscriptionExpiresAt: status?.subscriptionExpiresAt ?? null,
      subscriptionEnvironment,
      note: "subscriptionEnvironment is inferred on device; /api/church/media does not expose subscriptionEnvironment field",
    },
    deviceCustomerInfo: {
      hasCustomerInfo: !!info,
      originalAppUserId,
      activeSubscriptions: [...(info?.activeSubscriptions || [])],
      allPurchasedProductIdentifiers: [...(info?.allPurchasedProductIdentifiers || [])],
      activeEntitlementIds: Object.keys(activeEntitlements),
      activeEntitlements: activeEntitlementSummary,
      managementURL: managementURL || null,
      hasPremiumEntitlement: hasPremiumEntitlement(info),
      hasActivePremiumProduct: hasPlayPremiumOnDevice,
      identityMatchesChurchId: Boolean(churchId && configuredAppUserId === churchId),
      originalAppUserIdMatchesChurchId: Boolean(churchId && originalAppUserId === churchId),
    },
    manageability: {
      wouldPassManageGate: gateBlockReason === null,
      gateBlockReason,
    },
    identityChain,
  };
}

export function logSubscriptionOwnershipChainDiag(
  args: Parameters<typeof buildSubscriptionOwnershipChainDiag>[0] & { source?: string }
) {
  const diag = buildSubscriptionOwnershipChainDiag(args);
  console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHAIN", {
    source: args.source || "subscriptions",
    ...diag,
  });
  return diag;
}

/** Debug snapshot to distinguish Apple defer vs missing RevenueCat yearly entitlement. */
export function logRevenueCatSubscriptionOwnershipDebug(
  customerInfo: CustomerInfo | null | undefined,
  source: string,
  meta: Record<string, unknown> = {}
) {
  const activeEntitlements = customerInfo?.entitlements?.active || {};
  const activeEntitlementSummary = Object.fromEntries(
    Object.entries(activeEntitlements).map(([key, entitlement]) => [
      key,
      {
        productIdentifier: entitlement?.productIdentifier ?? null,
        isActive: entitlement?.isActive ?? null,
        willRenew: entitlement?.willRenew ?? null,
        expirationDate: entitlement?.expirationDate ?? null,
        periodType: entitlement?.periodType ?? null,
        store: entitlement?.store ?? null,
      },
    ])
  );

  console.log("KRISTO_RC_SUBSCRIPTION_OWNERSHIP_DEBUG", {
    source,
    ...meta,
    originalAppUserId: customerInfo?.originalAppUserId ?? null,
    activeSubscriptions: customerInfo?.activeSubscriptions || [],
    activeEntitlementKeys: Object.keys(activeEntitlements),
    activeEntitlements: activeEntitlementSummary,
    premiumMonthlyOwnership: summarizeSubscriptionOwnership(
      customerInfo,
      isMonthlyPremiumProductId
    ),
    premiumYearlyOwnership: summarizeSubscriptionOwnership(
      customerInfo,
      isYearlyPremiumProductId
    ),
    allProductIdentifiers: collectAllRevenueCatProductIdentifiers(customerInfo),
    resolvedActivePlan: customerInfo ? resolveActiveSubscriptionPlan(customerInfo) : null,
    introTrial: resolveActivePremiumIntroTrialState(customerInfo),
  });

  if (isAndroidPlatform()) {
    logRevenueCatAndroidEntitlementDebug(customerInfo, source, meta);
  }
}

/** Android-only entitlement snapshot for Google Play / RevenueCat launch diagnostics. */
export function logRevenueCatAndroidEntitlementDebug(
  customerInfo: CustomerInfo | null | undefined,
  source: string,
  meta: Record<string, unknown> = {}
) {
  if (!isAndroidPlatform()) return;

  const entitlement = getActivePremiumEntitlement(customerInfo);
  const monthlySubscription = summarizeSubscriptionOwnership(
    customerInfo,
    isMonthlyPremiumProductId
  );
  const yearlySubscription = summarizeSubscriptionOwnership(
    customerInfo,
    isYearlyPremiumProductId
  );

  console.log("KRISTO_RC_ANDROID_ENTITLEMENT_DEBUG", {
    source,
    ...meta,
    churchAppUserId: configuredAppUserId,
    originalAppUserId: customerInfo?.originalAppUserId ?? null,
    activeSubscriptions: customerInfo?.activeSubscriptions || [],
    resolvedActivePlan: customerInfo ? resolveActiveSubscriptionPlan(customerInfo) : null,
    detectedEntitlement: detectPremiumEntitlementKey(
      Object.keys(customerInfo?.entitlements?.active || {})
    ),
    entitlement: entitlement
      ? {
          productIdentifier: entitlement.productIdentifier ?? null,
          periodType: entitlement.periodType ?? null,
          expirationDate: entitlement.expirationDate ?? null,
          willRenew: entitlement.willRenew ?? null,
          store: entitlement.store ?? null,
        }
      : null,
    premiumMonthlySubscription: monthlySubscription,
    premiumYearlySubscription: yearlySubscription,
    introTrial: resolveActivePremiumIntroTrialState(customerInfo),
  });
}

/** Kristo V1: only active monthly vs active yearly (entitlement product only). */
export function resolveMediaPremiumPlanUiState(
  customerInfo: CustomerInfo | null | undefined
): MediaPremiumPlanUiState {
  const empty: MediaPremiumPlanUiState = {
    hasPremium: false,
    activeMonthly: false,
    activeYearly: false,
  };

  if (!customerInfo || !hasPremiumEntitlement(customerInfo)) {
    return empty;
  }

  const activePlan = resolveActiveSubscriptionPlan(customerInfo);
  const activeMonthly = activePlan === "monthly";
  const activeYearly = activePlan === "yearly";

  console.log("KRISTO_MEDIA_PREMIUM_PLAN_UI_STATE", {
    activeMonthly,
    activeYearly,
    activePlan,
    activeProductId: String(getActivePremiumEntitlement(customerInfo)?.productIdentifier || ""),
  });

  return {
    hasPremium: true,
    activeMonthly,
    activeYearly,
  };
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

export function collectDeviceOwnedPremiumProductIds(
  customerInfo: CustomerInfo | null | undefined
): string[] {
  if (!customerInfo) return [];
  const tracked = new Set<string>([
    PREMIUM_MONTHLY_PRODUCT_ID,
    ...IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS,
    PREMIUM_YEARLY_PRODUCT_ID,
  ]);
  const ids = new Set<string>();

  const consider = (raw: string) => {
    const id = String(raw || "").trim();
    if (!id) return;
    if (tracked.has(id) || isChurchPremiumProductId(id)) ids.add(id);
  };

  for (const id of customerInfo.activeSubscriptions || []) consider(String(id));
  for (const id of customerInfo.allPurchasedProductIdentifiers || []) consider(String(id));
  for (const id of Object.keys(customerInfo.subscriptionsByProductIdentifier || {})) {
    consider(id);
  }
  for (const entitlement of Object.values(customerInfo.entitlements?.all || {})) {
    consider(String(entitlement?.productIdentifier || ""));
  }
  return [...ids];
}

/** G2–G5 product IDs currently visible in CustomerInfo (for restore enumeration). */
export function enumerateIosRotationProductsInCustomerInfo(
  customerInfo: CustomerInfo | null | undefined
): string[] {
  return collectDeviceOwnedPremiumProductIds(customerInfo).filter((id) =>
    isIosPremiumRotationMonthlyProductId(id)
  );
}

const DEVICE_PURCHASE_SCOPE_KEY = "kristo.ios.devicePurchaseScope.v1";
const PURCHASE_SESSION_KEY_PREFIX = "kristo.ios.purchaseSession.v1:";

/**
 * Best-effort non-sensitive app installation scope for reservation coordination.
 * This is NOT an Apple ID and must never be described as verified purchaser identity.
 */
export async function getOrCreateDevicePurchaseScope(): Promise<string> {
  try {
    const existing = String((await AsyncStorage.getItem(DEVICE_PURCHASE_SCOPE_KEY)) || "").trim();
    if (existing) return existing;
    const next = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_PURCHASE_SCOPE_KEY, next);
    return next;
  } catch {
    return `dev_ephemeral_${Date.now().toString(36)}`;
  }
}

export async function getOrCreateIosPurchaseSessionId(churchId: string): Promise<string> {
  const cid = String(churchId || "").trim();
  const key = `${PURCHASE_SESSION_KEY_PREFIX}${cid || "unknown"}`;
  try {
    const existing = String((await AsyncStorage.getItem(key)) || "").trim();
    if (existing) return existing;
    const next = `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(key, next);
    return next;
  } catch {
    return `ps_ephemeral_${Date.now().toString(36)}`;
  }
}

export async function clearIosPurchaseSessionId(churchId: string): Promise<void> {
  const cid = String(churchId || "").trim();
  if (!cid) return;
  try {
    await AsyncStorage.removeItem(`${PURCHASE_SESSION_KEY_PREFIX}${cid}`);
  } catch {
    // ignore
  }
}

/**
 * Store transaction id from CustomerInfo when present.
 * This is a subscription lineage hint at best — NOT Apple ID / purchaser identity.
 * Server still verifies original_transaction_id via RevenueCat REST after purchase.
 */
export function extractSubscriptionLineageHintFromCustomerInfo(
  customerInfo: CustomerInfo | null | undefined
): string | null {
  if (!customerInfo) return null;

  const subscriptions = customerInfo.subscriptionsByProductIdentifier || {};
  for (const [productId, subscription] of Object.entries(subscriptions)) {
    if (!isPremiumProductIdentifier(productId)) continue;
    const storeTransactionId = String(
      (subscription as { storeTransactionId?: string | null })?.storeTransactionId || ""
    ).trim();
    if (storeTransactionId) return storeTransactionId;
  }
  return null;
}

/** @deprecated Use extractSubscriptionLineageHintFromCustomerInfo — never call this purchaser identity. */
export function extractKnownStoreSubscriptionIdentityFromCustomerInfo(
  customerInfo: CustomerInfo | null | undefined
): string | null {
  return extractSubscriptionLineageHintFromCustomerInfo(customerInfo);
}

export function findPackageByProductId(
  offerings: PurchasesOfferings | null | undefined,
  productId: string | null | undefined
): PurchasesPackage | null {
  const target = String(productId || "").trim();
  if (!target || !offerings) return null;

  const searchOffering = (offering: PurchasesOfferings["current"]) => {
    if (!offering?.availablePackages?.length) return null;
    return (
      offering.availablePackages.find(
        (pkg) => String(pkg.product.identifier || "") === target
      ) || null
    );
  };

  const fromCurrent = searchOffering(offerings.current);
  if (fromCurrent) return fromCurrent;

  for (const offering of Object.values(offerings.all || {})) {
    const match = searchOffering(offering);
    if (match) return match;
  }

  return null;
}

/**
 * Resolve the monthly package for purchase.
 * When preferredProductId is set, ONLY an exact product.identifier match is valid —
 * never silently fall through to premium_monthly / current.monthly.
 */
export function resolveMonthlyPackage(
  offerings: PurchasesOfferings,
  preferredProductId?: string | null
): PurchasesPackage | null {
  const preferred = String(preferredProductId || "").trim();
  if (preferred) {
    const byAssigned = findPackageByProductId(offerings, preferred);
    if (byAssigned && String(byAssigned.product.identifier || "") === preferred) {
      return byAssigned;
    }
    // Assigned ID present but not in offerings — caller must use getProducts / fail closed.
    return null;
  }

  // No assigned preference (Android / legacy): match any known monthly premium product.
  for (const productId of CHURCH_PREMIUM_PRODUCT_IDS) {
    if (!isMonthlyChurchPremiumProductId(productId)) continue;
    const match = findPackageByProductId(offerings, productId);
    if (match) return match;
  }

  const current = offerings.current;
  if (!current) return null;

  if (current.monthly) return current.monthly;

  const byType =
    current.availablePackages?.find((pkg) => pkg.packageType === PACKAGE_TYPE.MONTHLY) || null;
  if (byType) return byType;

  const byText =
    current.availablePackages?.find((pkg) =>
      /church_premium_monthly_g[2-5]|premium_monthly|month|monthly/i.test(
        `${pkg.packageType} ${pkg.identifier} ${pkg.product.identifier} ${pkg.product.title} ${pkg.product.description}`
      )
    ) || null;

  return byText;
}

export type IosAssignedProductPurchasePath = "package" | "store_product" | "unavailable";

export type IosAssignedProductPurchaseResolution = {
  assignedProductId: string;
  resolvedPackageProductId: string | null;
  resolvedStoreProductId: string | null;
  path: IosAssignedProductPurchasePath;
  package: PurchasesPackage | null;
  storeProduct: PurchasesStoreProduct | null;
};

/** True only when package productIdentifier exactly equals the assigned Product ID. */
export function packageMatchesAssignedProductId(
  pkg: PurchasesPackage | null | undefined,
  assignedProductId: string | null | undefined
): boolean {
  const assigned = String(assignedProductId || "").trim();
  const resolved = String(pkg?.product?.identifier || "").trim();
  return Boolean(assigned && resolved && assigned === resolved);
}

/**
 * Exact-match purchase resolution for a backend-assigned iOS Product ID.
 * Order: offerings package (exact) → Purchases.getProducts([id], SUBS) → unavailable.
 * Never returns premium_monthly unless that is the assigned ID.
 */
export async function resolveIosAssignedProductPurchasePath(
  assignedProductId: string,
  offerings?: PurchasesOfferings | null
): Promise<IosAssignedProductPurchaseResolution> {
  const assigned = String(assignedProductId || "").trim();
  if (!assigned) {
    const empty: IosAssignedProductPurchaseResolution = {
      assignedProductId: "",
      resolvedPackageProductId: null,
      resolvedStoreProductId: null,
      path: "unavailable",
      package: null,
      storeProduct: null,
    };
    console.log("KRISTO_IOS_ASSIGNED_PRODUCT_PURCHASE_PATH", {
      assignedProductId: empty.assignedProductId,
      resolvedPackageProductId: empty.resolvedPackageProductId,
      resolvedStoreProductId: empty.resolvedStoreProductId,
      path: empty.path,
    });
    return empty;
  }

  let offeringsResolved = offerings || null;
  if (!offeringsResolved) {
    try {
      offeringsResolved = await getSubscriptionOfferings({ force: true });
    } catch {
      offeringsResolved = null;
    }
  }

  const pkg = findPackageByProductId(offeringsResolved, assigned);
  if (packageMatchesAssignedProductId(pkg, assigned)) {
    const resolution: IosAssignedProductPurchaseResolution = {
      assignedProductId: assigned,
      resolvedPackageProductId: assigned,
      resolvedStoreProductId: null,
      path: "package",
      package: pkg,
      storeProduct: pkg!.product,
    };
    console.log("KRISTO_IOS_ASSIGNED_PRODUCT_PURCHASE_PATH", {
      assignedProductId: resolution.assignedProductId,
      resolvedPackageProductId: resolution.resolvedPackageProductId,
      resolvedStoreProductId: resolution.resolvedStoreProductId,
      path: resolution.path,
    });
    return resolution;
  }

  try {
    const products = await runRevenueCatGetProducts(
      [assigned],
      "resolveIosAssignedProductPurchasePath"
    );
    const storeProduct =
      products.find((p) => String(p.identifier || "").trim() === assigned) || null;
    if (storeProduct) {
      const resolution: IosAssignedProductPurchaseResolution = {
        assignedProductId: assigned,
        resolvedPackageProductId: null,
        resolvedStoreProductId: assigned,
        path: "store_product",
        package: null,
        storeProduct,
      };
      console.log("KRISTO_IOS_ASSIGNED_PRODUCT_PURCHASE_PATH", {
        assignedProductId: resolution.assignedProductId,
        resolvedPackageProductId: resolution.resolvedPackageProductId,
        resolvedStoreProductId: resolution.resolvedStoreProductId,
        path: resolution.path,
      });
      return resolution;
    }
  } catch {
    // fall through to unavailable
  }

  const unavailable: IosAssignedProductPurchaseResolution = {
    assignedProductId: assigned,
    resolvedPackageProductId: null,
    resolvedStoreProductId: null,
    path: "unavailable",
    package: null,
    storeProduct: null,
  };
  console.log("KRISTO_IOS_ASSIGNED_PRODUCT_PURCHASE_PATH", {
    assignedProductId: unavailable.assignedProductId,
    resolvedPackageProductId: unavailable.resolvedPackageProductId,
    resolvedStoreProductId: unavailable.resolvedStoreProductId,
    path: unavailable.path,
  });
  return unavailable;
}

export const IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE =
  "This subscription product isn’t available in the App Store configuration yet. Try again later.";

export function resolveYearlyPackage(
  offerings: PurchasesOfferings,
  preferredProductId?: string | null
): PurchasesPackage | null {
  // iOS no longer offers yearly for new purchases — do not expose a yearly package.
  // Legacy premium_yearly recognition for existing subscribers remains elsewhere.
  if (Platform.OS === "ios") return null;

  const preferred = String(preferredProductId || "").trim();
  if (preferred) {
    const byAssigned = findPackageByProductId(offerings, preferred);
    if (byAssigned) return byAssigned;
  }

  for (const productId of CHURCH_PREMIUM_PRODUCT_IDS) {
    if (!isYearlyChurchPremiumProductId(productId)) continue;
    const match = findPackageByProductId(offerings, productId);
    if (match) return match;
  }

  const current = offerings.current;
  if (!current) return null;

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

/**
 * Build / resolve the purchase target from a backend-assigned Product ID.
 * Searches all RevenueCat offerings; falls back to StoreKit/Play getProducts.
 * Exact product ID only — never substitutes another monthly SKU.
 */
export async function resolvePurchaseTargetForProductId(productId: string): Promise<{
  package: PurchasesPackage | null;
  storeProduct: PurchasesStoreProduct | null;
  productId: string;
  path: IosAssignedProductPurchasePath;
}> {
  const target = String(productId || "").trim();
  if (!target) {
    return { package: null, storeProduct: null, productId: "", path: "unavailable" };
  }

  // iOS assigned buys use the exact-match path (package → getProducts → unavailable).
  if (Platform.OS === "ios") {
    const resolved = await resolveIosAssignedProductPurchasePath(target);
    return {
      package: resolved.package,
      storeProduct: resolved.storeProduct,
      productId: target,
      path: resolved.path,
    };
  }

  const offerings = await getSubscriptionOfferings({ force: true });
  const pkg = findPackageByProductId(offerings, target);
  if (pkg && String(pkg.product.identifier || "") === target) {
    return { package: pkg, storeProduct: pkg.product, productId: target, path: "package" };
  }

  try {
    const products = await runRevenueCatGetProducts([target], "resolvePurchaseTargetForProductId");
    const storeProduct = products.find((p) => String(p.identifier || "") === target) || null;
    return {
      package: null,
      storeProduct,
      productId: target,
      path: storeProduct ? "store_product" : "unavailable",
    };
  } catch {
    return { package: null, storeProduct: null, productId: target, path: "unavailable" };
  }
}

export async function purchaseSubscriptionProductId(
  productId: string,
  opts?: PurchaseSubscriptionPackageOptions & {
    identityContext?: {
      churchId: string;
      userId?: string | null;
      serverSubscriptionActive?: boolean | null;
    };
  }
) {
  const target = await resolvePurchaseTargetForProductId(productId);
  if (target.path === "unavailable" || (!target.package && !target.storeProduct)) {
    throw new Error(IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE);
  }

  if (target.package && packageMatchesAssignedProductId(target.package, productId)) {
    return purchaseSubscriptionPackage(target.package, opts);
  }

  if (!target.storeProduct || String(target.storeProduct.identifier || "") !== String(productId || "").trim()) {
    throw new Error(IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE);
  }

  if (opts?.identityContext?.churchId) {
    await verifyRevenueCatIdentityBeforePurchase({
      churchId: opts.identityContext.churchId,
      userId: opts.identityContext.userId,
      serverSubscriptionActive: opts.identityContext.serverSubscriptionActive,
      source: "purchaseSubscriptionProductId",
    });
  }

  await requireConfiguredPurchases("purchase");

  console.log("KRISTO_RC_PURCHASE_STORE_PRODUCT", {
    productId: target.storeProduct.identifier,
    platform: Platform.OS,
    path: target.path,
  });

  const result = await Purchases.purchaseStoreProduct(target.storeProduct);

  try {
    await Purchases.syncPurchases();
  } catch (error) {
    logRevenueCatException("syncPurchases", error, { phase: "after-store-product-purchase" });
  }

  return result;
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
  if (hasPremiumEntitlement(customerInfo)) return false;

  const purchased = customerInfo.allPurchasedProductIdentifiers ?? [];
  if (purchased.some(isPremiumProductIdentifier)) {
    return false;
  }

  const allEntitlements = customerInfo.entitlements?.all || {};
  if (CHURCH_PREMIUM_ENTITLEMENT_IDS.some((id) => Boolean(allEntitlements[id]))) {
    return false;
  }

  return true;
}

export function packageHasIntroductoryOffer(
  pkg: PurchasesPackage | null | undefined
): boolean {
  return monthlyPackageHasIntroOffer(pkg);
}

export function resolveMonthlyProductIntro(
  pkg: PurchasesPackage | null | undefined
): PurchasesIntroPrice | null {
  const product = pkg?.product as Record<string, unknown> | undefined;
  if (!product) return null;

  return (
    (product.introPrice as PurchasesIntroPrice | undefined) ??
    (product.introductoryPrice as PurchasesIntroPrice | undefined) ??
    null
  );
}

/** True when StoreKit / RevenueCat monthly product exposes any intro offer (e.g. P2W free trial). */
export function monthlyPackageHasIntroOffer(
  monthlyPackage: PurchasesPackage | null | undefined
): boolean {
  const product = monthlyPackage?.product as Record<string, unknown> | undefined;
  if (!product) return false;

  if (product.introPrice) return true;
  if (product.introductoryPrice) return true;

  const intro = resolveMonthlyProductIntro(monthlyPackage);
  if (intro) return true;

  const period = String((intro as any)?.period || "").trim().toUpperCase();
  return period === "P2W";
}

export function getMonthlyIntroOffer(
  pkg: PurchasesPackage | null | undefined
): PurchasesIntroPrice | null {
  return resolveMonthlyProductIntro(pkg);
}

export function isIntroOfferFreeTrial(
  intro: PurchasesIntroPrice | null | undefined
): boolean {
  if (!intro) return false;
  return Number(intro.price) === 0;
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

export async function fetchMonthlyIntroTrialEligibility(
  productId?: string | null
): Promise<INTRO_ELIGIBILITY_STATUS | null> {
  if (isRevenueCatPurchasingDisabled()) return null;

  const ready = await ensurePurchasesConfigured();
  if (!ready) return null;

  const targetProductId = String(productId || "").trim();
  if (!targetProductId) return null;

  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility([
      targetProductId,
    ]);
    return result[targetProductId]?.status ?? null;
  } catch (error) {
    logRevenueCatException("checkTrialOrIntroductoryPriceEligibility", error);
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

export type OpenSubscriptionManagementOptions = {
  /** When false, skip account-wide App Store / Play subscription pages. Default true. */
  allowGenericFallback?: boolean;
  /** Diagnostic source for sandbox manage instructions. */
  source?: string;
};

export type OpenSubscriptionManagementResult = {
  opened: boolean;
  fallbackUsed: boolean;
  path:
    | "management_url"
    | "show_manage_subscriptions"
    | "ios_generic"
    | "ios_sandbox_instructions"
    | "android_generic"
    | "android_play_product_deeplink"
    | "none";
};

const KRISTO_ANDROID_PACKAGE_NAME = "com.princefariji.kristoapp";

function isGenericGooglePlaySubscriptionsManagementUrl(url: string): boolean {
  const raw = String(url || "").trim();
  if (!raw) return false;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "play.google.com") return false;
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (path !== "/store/account/subscriptions") return false;
    return !parsed.searchParams.has("sku");
  } catch {
    return /^https:\/\/play\.google\.com\/store\/account\/subscriptions(?:\/)?(?:\?.*)?$/i.test(
      raw
    ) && !/[?&]sku=/i.test(raw);
  }
}

function normalizeKristoPlayProductSku(
  productId: string
): typeof PREMIUM_MONTHLY_PRODUCT_ID | typeof PREMIUM_YEARLY_PRODUCT_ID | null {
  const id = String(productId || "").trim();
  if (!id) return null;
  if (id === PREMIUM_MONTHLY_PRODUCT_ID || id === `${PREMIUM_MONTHLY_PRODUCT_ID}:monthly`) {
    return PREMIUM_MONTHLY_PRODUCT_ID;
  }
  if (id === PREMIUM_YEARLY_PRODUCT_ID || id === `${PREMIUM_YEARLY_PRODUCT_ID}:yearly`) {
    return PREMIUM_YEARLY_PRODUCT_ID;
  }
  return null;
}

function resolveActiveKristoPlayProductSku(
  customerInfo: CustomerInfo | null | undefined
): typeof PREMIUM_MONTHLY_PRODUCT_ID | typeof PREMIUM_YEARLY_PRODUCT_ID | null {
  if (!customerInfo) return null;

  for (const productId of customerInfo.activeSubscriptions || []) {
    const sku = normalizeKristoPlayProductSku(productId);
    if (sku) return sku;
  }

  for (const [productId, subscription] of Object.entries(
    customerInfo.subscriptionsByProductIdentifier || {}
  )) {
    const sku = normalizeKristoPlayProductSku(productId);
    if (!sku) continue;
    if (
      subscription?.isActive === true ||
      subscriptionExpirationIsActive(subscription?.expiresDate)
    ) {
      return sku;
    }
  }

  const entitlement = getActivePremiumEntitlement(customerInfo);
  const sku = normalizeKristoPlayProductSku(String(entitlement?.productIdentifier || ""));
  if (sku && subscriptionExpirationIsActive(entitlement?.expirationDate)) {
    return sku;
  }

  return null;
}

function buildAndroidPlayProductSubscriptionManagementUrl(
  sku: typeof PREMIUM_MONTHLY_PRODUCT_ID | typeof PREMIUM_YEARLY_PRODUCT_ID
): string {
  const params = new URLSearchParams({
    sku,
    package: KRISTO_ANDROID_PACKAGE_NAME,
  });
  return `https://play.google.com/store/account/subscriptions?${params.toString()}`;
}

type NativeManageSubscriptionLogOpts = {
  source?: string;
  logAttempt?: boolean;
  logOpened?: boolean;
};

/** iOS StoreKit manage sheet via RevenueCat / RNPurchases (sandbox + production). */
async function tryOpenNativeIosManageSubscriptions(
  opts?: NativeManageSubscriptionLogOpts
): Promise<OpenSubscriptionManagementResult | null> {
  if (Platform.OS !== "ios") return null;

  const source = opts?.source || null;
  const apis = ["Purchases.showManageSubscriptions", "RNPurchases.showManageSubscriptions"];

  if (opts?.logAttempt) {
    console.log("KRISTO_SUBSCRIPTION_MANAGE_NATIVE_ATTEMPT", {
      platform: Platform.OS,
      source,
      apis,
    });
  }

  try {
    const showManage = (
      Purchases as typeof Purchases & { showManageSubscriptions?: () => Promise<void> }
    ).showManageSubscriptions;
    if (typeof showManage === "function") {
      await showManage.call(Purchases);
      if (opts?.logOpened) {
        console.log("KRISTO_SUBSCRIPTION_MANAGE_NATIVE_OPENED", {
          platform: Platform.OS,
          source,
          api: "Purchases.showManageSubscriptions",
        });
      }
      return { opened: true, fallbackUsed: false, path: "show_manage_subscriptions" };
    }
  } catch (error) {
    logRevenueCatException("showManageSubscriptions", error, { source });
  }

  try {
    const { NativeModules } = require("react-native") as typeof import("react-native");
    const nativeShowManage = NativeModules.RNPurchases?.showManageSubscriptions;
    if (typeof nativeShowManage === "function") {
      await nativeShowManage();
      if (opts?.logOpened) {
        console.log("KRISTO_SUBSCRIPTION_MANAGE_NATIVE_OPENED", {
          platform: Platform.OS,
          source,
          api: "RNPurchases.showManageSubscriptions",
        });
      }
      return { opened: true, fallbackUsed: false, path: "show_manage_subscriptions" };
    }
  } catch (error) {
    logRevenueCatException("RNPurchases.showManageSubscriptions", error, { source });
  }

  return null;
}

/** Opens native subscription management (StoreKit sheet or store URL). */
export async function openSubscriptionManagement(
  customerInfo?: CustomerInfo | null,
  opts?: OpenSubscriptionManagementOptions
): Promise<OpenSubscriptionManagementResult> {
  const allowGenericFallback = opts?.allowGenericFallback !== false;
  const none: OpenSubscriptionManagementResult = {
    opened: false,
    fallbackUsed: false,
    path: "none",
  };

  let info = customerInfo ?? null;
  if (!info) {
    try {
      info = await getCustomerSubscriptionInfo();
    } catch {
      info = null;
    }
  }

  if (shouldUseIosSandboxSubscriptionManageInstructions(info)) {
    const managementURL = String(info?.managementURL || "").trim() || null;
    const nativeResult = await tryOpenNativeIosManageSubscriptions({
      source: opts?.source,
      logAttempt: true,
      logOpened: true,
    });
    if (nativeResult) {
      return nativeResult;
    }

    console.log("KRISTO_SUBSCRIPTION_MANAGE_NATIVE_FALLBACK", {
      platform: Platform.OS,
      source: opts?.source || null,
      dev: __DEV__,
      sandboxEnvironment: true,
      managementURLSkipped: Boolean(managementURL),
      managementURL,
      reason: "native_manage_unavailable_or_failed",
    });

    presentIosSandboxSubscriptionManageInstructions({
      source: opts?.source,
      customerInfo: info,
    });
    return { opened: true, fallbackUsed: true, path: "ios_sandbox_instructions" };
  }

  const managementUrl = String(info?.managementURL || "").trim();
  if (managementUrl) {
    if (Platform.OS === "android") {
      const activeSku = resolveActiveKristoPlayProductSku(info);
      if (activeSku && isGenericGooglePlaySubscriptionsManagementUrl(managementUrl)) {
        const productUrl = buildAndroidPlayProductSubscriptionManagementUrl(activeSku);
        await Linking.openURL(productUrl);
        return { opened: true, fallbackUsed: false, path: "android_play_product_deeplink" };
      }
    }

    await Linking.openURL(managementUrl);
    return { opened: true, fallbackUsed: false, path: "management_url" };
  }

  const nativeResult = await tryOpenNativeIosManageSubscriptions({ source: opts?.source });
  if (nativeResult) {
    return nativeResult;
  }

  if (Platform.OS === "ios") {
    if (!allowGenericFallback) return none;
    await Linking.openURL("https://apps.apple.com/account/subscriptions");
    return { opened: true, fallbackUsed: true, path: "ios_generic" };
  }

  if (Platform.OS === "android") {
    if (!allowGenericFallback) return none;
    await Linking.openURL("https://play.google.com/store/account/subscriptions");
    return { opened: true, fallbackUsed: true, path: "android_generic" };
  }

  return none;
}
