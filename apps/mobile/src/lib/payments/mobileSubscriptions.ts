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
import Constants from "expo-constants";
import { Linking, Platform } from "react-native";
import type { PlanStatus, SubscriptionPlanKey } from "../../store/paymentsStore";
import {
  isRevenueCatPurchasingDisabled,
  isSubscriptionBypassEnabled,
} from "../subscriptionBypass";
import { shouldEnableRevenueCatDebug } from "../kristoDebugFlags";
import {
  CHURCH_PREMIUM_ENTITLEMENT,
  CHURCH_PREMIUM_ENTITLEMENT_IDS,
  detectPremiumEntitlementKey,
  isChurchPremiumEntitlementId,
  LEGACY_PREMIUM_ENTITLEMENT,
  PREMIUM_MONTHLY_INTRO_TRIAL_DAYS,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
} from "./churchPremiumRevenueCat";

export {
  CHURCH_PREMIUM_ENTITLEMENT,
  CHURCH_PREMIUM_ENTITLEMENT_IDS,
  LEGACY_PREMIUM_ENTITLEMENT,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
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
    "App Store products are not available yet. Submit premium_monthly and premium_yearly " +
    "in App Store Connect (or attach a StoreKit config in Xcode)."
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
  opts?: PurchaseSubscriptionPackageOptions
) {
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
  return (
    activeSubscriptions.includes(PREMIUM_MONTHLY_PRODUCT_ID) ||
    activeSubscriptions.includes(PREMIUM_YEARLY_PRODUCT_ID)
  );
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
  return (
    productId === PREMIUM_YEARLY_PRODUCT_ID ||
    /premium_yearly|yearly|annual|\$rc_annual/i.test(productId)
  );
}

function isMonthlyPremiumProductId(productId: string): boolean {
  return (
    productId === PREMIUM_MONTHLY_PRODUCT_ID ||
    /premium_monthly|monthly|\$rc_monthly/i.test(productId)
  );
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
  if (hasPremiumEntitlement(customerInfo)) return false;

  const purchased = customerInfo.allPurchasedProductIdentifiers ?? [];
  if (
    purchased.includes(PREMIUM_MONTHLY_PRODUCT_ID) ||
    purchased.includes(PREMIUM_YEARLY_PRODUCT_ID)
  ) {
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
};

export type OpenSubscriptionManagementResult = {
  opened: boolean;
  fallbackUsed: boolean;
  path: "management_url" | "show_manage_subscriptions" | "ios_generic" | "android_generic" | "none";
};

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

  const managementUrl = String(info?.managementURL || "").trim();
  if (managementUrl) {
    await Linking.openURL(managementUrl);
    return { opened: true, fallbackUsed: false, path: "management_url" };
  }

  try {
    const showManage = (Purchases as { showManageSubscriptions?: () => Promise<void> })
      .showManageSubscriptions;
    if (typeof showManage === "function") {
      await showManage.call(Purchases);
      return { opened: true, fallbackUsed: false, path: "show_manage_subscriptions" };
    }
  } catch (error) {
    logRevenueCatException("showManageSubscriptions", error);
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
