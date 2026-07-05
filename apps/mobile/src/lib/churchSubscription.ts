import { Alert } from "react-native";
import type { CustomerInfo } from "react-native-purchases";
import { apiGet, apiPatch } from "./kristoApi";
import { clearResponseCacheForRequest } from "./kristoTraffic";
import {
  evaluateStrictChurchMediaLiveSubscriptionGate,
  logSubscriptionGateBlocked,
} from "./churchSubscriptionGate";
import { refreshChurchMediaIfNeeded } from "./churchResourceRefresh";
import { refreshChurchMediaAccess } from "./refreshCoordinator";
import { announceChurchPremiumAccessUnlocked, churchIdsMatch } from "./churchPremiumAccess";
import { getSessionSync } from "./kristoSession";
import { getPaymentsState, type SubscriptionPlanKey } from "../store/paymentsStore";
import {
  isChurchMediaRouteFailure,
  isChurchSubscriptionActiveFromRecord,
  mergeScheduleSubscriptionSignals,
  parseExplicitServerSubscriptionFromMediaRoute,
  readChurchScopedEntitlementActive,
  readLocalScheduleEntitlementActive,
  readSessionMediaProfileSubscriptionActive,
  isOfflineActivationFromMediaRouteResponse,
  parseChurchMediaSubscriptionOwnershipLock,
  parseChurchMediaSubscriptionSource,
  isSubscriptionOwnershipLockBlockingActivation,
  type ChurchMediaSubscriptionOwnershipLock,
  type ChurchSubscriptionRecord,
} from "./churchSubscriptionMediaSignals";
export type { ChurchMediaSubscriptionSource } from "./churchSubscriptionMediaSignals";
export {
  isBackendManagedMediaPremiumStatus,
  isSubscriptionOwnershipLockBlockingPurchase,
  isChurchMediaPremiumLockStatusKnown,
  shouldFailClosedSubscriptionPurchase,
} from "./churchSubscriptionMediaSignals";
import type { ChurchMediaSubscriptionSource } from "./churchSubscriptionMediaSignals";
import { logSubscriptionBypassIfEnabled } from "./subscriptionBypass";
import {
  describeCustomerInfoSubscriptionDebug,
  getActivePremiumEntitlement,
  getCustomerSubscriptionInfo,
  getRevenueCatConfiguredAppUserId,
  hasPremiumEntitlement,
  isPlanActive,
  logEntitlementAudit,
  logInRevenueCatForChurchSubscription,
  refreshCustomerInfoAfterStorePurchase,
  recoverStoreSubscriptionForChurch,
  resolveActiveSubscriptionPlan,
} from "./payments/mobileSubscriptions";

export const CHURCH_SUBSCRIPTION_REQUIRED_CODE = "CHURCH_SUBSCRIPTION_REQUIRED";
export const CHURCH_SUBSCRIPTION_REQUIRED_TITLE = "Subscription required";
export const CHURCH_SUBSCRIPTION_PREMIUM_TITLE = "Premium subscription required";
export const CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE =
  "Subscription required to schedule Live, Media, or Ministry activity.";
export const CHURCH_SUBSCRIPTION_MEMBER_MESSAGE =
  "This church needs an active subscription before live scheduling is available.";
export const CHURCH_SUBSCRIPTION_MINISTRY_MESSAGE =
  "Subscription required to create ministries or schedule Live, Media, or Ministry activity.";

export type { ChurchSubscriptionRecord } from "./churchSubscriptionMediaSignals";
export {
  isChurchMediaRouteFailure,
  isChurchSubscriptionActiveFromRecord,
  mergeScheduleSubscriptionSignals,
  parseExplicitServerSubscriptionFromMediaRoute,
  readLocalScheduleEntitlementActive,
  readChurchScopedEntitlementActive,
  readSessionMediaProfileSubscriptionActive,
} from "./churchSubscriptionMediaSignals";

export const CHURCH_SUBSCRIPTION_REQUIRED_MESSAGE = CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE;

export type ScheduleGateLogContext = {
  screen: string;
  gate: string;
  isPastor?: boolean;
  isApprovedMediaHost?: boolean;
  viewerIsHost?: boolean;
  canUseMediaTools?: boolean;
  canOpenMediaScreen?: boolean;
  ministryRole?: string;
  ministryToolAllowed?: boolean;
  toolKey?: string;
  hasSubscription?: boolean | null;
  subscriptionLocked?: boolean | null;
  headers?: Record<string, string>;
};

export type ScheduleSubscriptionGateOptions = ScheduleGateLogContext & {
  onUpgrade?: () => void;
};

function logAssignmentToolAccessDecision(meta: {
  toolKey?: string;
  gate: string;
  hasSubscription: boolean | null;
  isPastor: boolean;
  ministryRole?: string;
  viewerIsHost?: boolean;
  canUseMediaTools?: boolean | null;
  canOpenMediaScreen?: boolean;
  ministryToolAllowed?: boolean;
  allowed: boolean;
}) {
  console.log(
    "KRISTO_ASSIGNMENT_TOOL_ACCESS_DECISION",
    {
      toolKey: meta.toolKey || null,
      gate: meta.gate,
      hasSubscription: meta.hasSubscription,
      isPastor: meta.isPastor,
      ministryRole: meta.ministryRole || null,
      viewerIsHost: meta.viewerIsHost === true,
      canUseMediaTools: meta.canUseMediaTools ?? null,
      canOpenMediaScreen: meta.canOpenMediaScreen === true,
      ministryToolAllowed: meta.ministryToolAllowed === true,
      allowed: meta.allowed,
    }
  );
}

export function isPastorSessionRole(role?: string) {
  return String(role || "").toLowerCase().includes("pastor");
}

export function resolveScheduleGateIsPastor(
  opts?: { isPastor?: boolean },
  headers?: Record<string, string>
) {
  if (opts?.isPastor === true) return true;

  const session = getSessionSync() as any;
  const headerRole = String(
    headers?.["x-kristo-role"] || headers?.["X-Kristo-Role"] || ""
  )
    .trim()
    .toLowerCase();
  const sessionRole = String(session?.role || "").trim().toLowerCase();
  const churchRole = String(session?.churchRole || "").trim().toLowerCase();

  return (
    headerRole.includes("pastor") ||
    headerRole.includes("admin") ||
    sessionRole.includes("pastor") ||
    sessionRole.includes("admin") ||
    churchRole === "pastor" ||
    churchRole === "church_admin"
  );
}

export function isScheduleSubscriptionGateBypassed(
  opts?: { isPastor?: boolean; isApprovedMediaHost?: boolean },
  headers?: Record<string, string>
) {
  const isPastor = resolveScheduleGateIsPastor(opts, headers);
  const isApprovedMediaHost = opts?.isApprovedMediaHost === true;
  return { bypassed: false, isPastor, isApprovedMediaHost };
}

function logScheduleGate(meta: {
  kind: "check" | "bypassed" | "blocked";
  screen: string;
  gate: string;
  isPastor: boolean;
  bypassEnabled: boolean;
  hasSubscription?: boolean | null;
  subscriptionLocked?: boolean | null;
  allowed: boolean;
}) {
  const payload = {
    screen: meta.screen,
    gate: meta.gate,
    isPastor: meta.isPastor,
    bypassEnabled: meta.bypassEnabled,
    hasSubscription: meta.hasSubscription ?? null,
    subscriptionLocked: meta.subscriptionLocked ?? null,
    allowed: meta.allowed,
  };

  if (meta.kind === "check") {
    console.log("KRISTO_SCHEDULE_GATE_CHECK", payload);
    return;
  }
  if (meta.kind === "bypassed") {
    console.log("KRISTO_SCHEDULE_GATE_BYPASSED", payload);
    return;
  }
  console.log("KRISTO_SCHEDULE_GATE_BLOCKED", payload);
}

export function evaluateScheduleSubscriptionGate(ctx: ScheduleGateLogContext) {
  const isPastor = resolveScheduleGateIsPastor({ isPastor: ctx.isPastor }, ctx.headers);
  const isApprovedMediaHost = ctx.isApprovedMediaHost === true;
  const viewerIsHost = ctx.viewerIsHost === true || isApprovedMediaHost;
  const churchSubscriptionActive =
    ctx.hasSubscription === true ? true : ctx.hasSubscription === false ? false : null;

  const strict = evaluateStrictChurchMediaLiveSubscriptionGate({
    gate: ctx.gate,
    screen: ctx.screen,
    churchSubscriptionActive,
    isPastor,
    isApprovedMediaHost,
    viewerIsHost,
    canUseMediaTools: ctx.canUseMediaTools,
    canOpenMediaScreen: ctx.canOpenMediaScreen,
    ministryRole: ctx.ministryRole,
    ministryToolAllowed: ctx.ministryToolAllowed,
    toolKey: ctx.toolKey,
  });
  const allowed = strict.allowed;

  if (String(ctx.gate || "").startsWith("assignment-tool.")) {
    logAssignmentToolAccessDecision({
      toolKey: ctx.toolKey,
      gate: ctx.gate,
      hasSubscription: ctx.hasSubscription ?? null,
      isPastor,
      ministryRole: ctx.ministryRole,
      viewerIsHost,
      canUseMediaTools: ctx.canUseMediaTools ?? null,
      canOpenMediaScreen: ctx.canOpenMediaScreen,
      ministryToolAllowed: ctx.ministryToolAllowed,
      allowed,
    });
  }

  logScheduleGate({
    kind: "check",
    screen: ctx.screen,
    gate: ctx.gate,
    isPastor,
    bypassEnabled: false,
    hasSubscription: ctx.hasSubscription ?? null,
    subscriptionLocked: ctx.subscriptionLocked ?? null,
    allowed,
  });

  if (!allowed) {
    logScheduleGate({
      kind: "blocked",
      screen: ctx.screen,
      gate: ctx.gate,
      isPastor,
      bypassEnabled: false,
      hasSubscription: ctx.hasSubscription ?? null,
      subscriptionLocked: ctx.subscriptionLocked ?? null,
      allowed: false,
    });
  }

  return { allowed, isPastor, bypassEnabled: false };
}

export type ScheduleMediaRouteProbe = {
  endpoint: string;
  churchId: string;
  appUserId: string;
  endpointStatus: number | null;
  responseBody: any | null;
  routeFailed: boolean;
  explicitServerActive: boolean | null;
};

function resolveScheduleAppUserId(headers?: Record<string, string>) {
  const session = getSessionSync() as any;
  return String(
    headers?.["x-kristo-user-id"] ||
      headers?.["X-Kristo-User-Id"] ||
      session?.userId ||
      ""
  ).trim();
}

function resolveScheduleChurchId(churchId?: string, headers?: Record<string, string>) {
  const session = getSessionSync() as any;
  return String(
    churchId ||
      headers?.["x-kristo-church-id"] ||
      headers?.["X-Kristo-Church-Id"] ||
      session?.churchId ||
      ""
  ).trim();
}

export type ScheduleSubscriptionResolution = {
  churchSubscriptionActive: boolean | null;
  hasSubscription: boolean | null;
  canUseMediaTools: boolean | null;
  entitlementActive: boolean;
  source: string;
  churchId: string;
  appUserId: string;
  endpointStatus: number | null;
  routeFailed: boolean;
  /** Explicit /api/church/media subscription flag — not inferred from RevenueCat. */
  backendSubscriptionActive: boolean | null;
  subscriptionPlan?: string | null;
};

export async function probeChurchMediaScheduleRoute(args: {
  churchId?: string;
  headers?: Record<string, string>;
  cache?: RequestCache;
}): Promise<ScheduleMediaRouteProbe> {
  const churchId = resolveScheduleChurchId(args.churchId, args.headers);
  const appUserId = resolveScheduleAppUserId(args.headers);
  const endpoint = "/api/church/media";

  const res: any = await apiGet(endpoint, {
    headers: args.headers,
    cache: args.cache || "no-store",
  });

  const endpointStatus =
    typeof res?.status === "number"
      ? res.status
      : res?.ok === false
        ? Number(res?.status || 0) || null
        : 200;
  const routeFailed = isChurchMediaRouteFailure(res);
  const explicitServerActive = parseExplicitServerSubscriptionFromMediaRoute(res);

  console.log("KRISTO_SCHEDULE_ROUTE_RESPONSE", {
    churchId,
    appUserId,
    endpoint,
    endpointStatus,
    routeFailed,
    explicitServerActive,
    responseBody: res,
  });

  return {
    endpoint,
    churchId,
    appUserId,
    endpointStatus,
    responseBody: res,
    routeFailed,
    explicitServerActive,
  };
}

export async function resolveScheduleSubscriptionState(args: {
  churchId?: string;
  headers?: Record<string, string>;
  customerInfo?: CustomerInfo | null;
  fetchCustomerInfo?: boolean;
}): Promise<ScheduleSubscriptionResolution> {
  logSubscriptionBypassIfEnabled();

  const churchId = resolveScheduleChurchId(args.churchId, args.headers);
  const appUserId = resolveScheduleAppUserId(args.headers);

  const route = await probeChurchMediaScheduleRoute({
    churchId,
    headers: args.headers,
  });

  let customerInfo = args.customerInfo ?? null;
  let revenueCatAppUserId: string | null = null;
  const offlineActivationActive = isOfflineActivationFromMediaRouteResponse(route.responseBody);
  if (args.fetchCustomerInfo !== false && churchId && !offlineActivationActive) {
    try {
      customerInfo = await logInRevenueCatForChurchSubscription(churchId);
      revenueCatAppUserId = getRevenueCatConfiguredAppUserId();
    } catch {
      customerInfo = args.customerInfo ?? null;
    }
  }

  const revenueCatScopedToChurch = Boolean(
    churchId && revenueCatAppUserId && revenueCatAppUserId === churchId
  );
  const entitlementActive = readChurchScopedEntitlementActive({
    churchId,
    customerInfo,
    revenueCatAppUserId,
  });
  const sessionProfileActive = readSessionMediaProfileSubscriptionActive(churchId);

  const merged = mergeScheduleSubscriptionSignals({
    churchId,
    explicitServerActive: route.explicitServerActive,
    routeFailed: route.routeFailed,
    entitlementActive,
    revenueCatScopedToChurch,
    sessionProfileActive,
  });

  const canUseMediaTools =
    route.routeFailed || route.responseBody?.canUseMediaTools == null
      ? merged.hasSubscription
      : route.responseBody?.canUseMediaTools === true
        ? true
        : route.responseBody?.canUseMediaTools === false
          ? false
          : merged.hasSubscription;

  console.log("KRISTO_CHURCH_SUBSCRIPTION_SCOPE", {
    churchId,
    revenueCatAppUserId,
    revenueCatScopedToChurch,
    entitlementActive,
    serverSubscriptionActive: route.explicitServerActive,
  });

  console.log("KRISTO_SCHEDULE_SUBSCRIPTION_SOURCE", {
    churchId,
    appUserId,
    entitlementActive,
    revenueCatAppUserId,
    revenueCatScopedToChurch,
    endpointStatus: route.endpointStatus,
    routeFailed: route.routeFailed,
    explicitServerActive: route.explicitServerActive,
    sessionProfileActive,
    source: merged.source,
  });

  const result: ScheduleSubscriptionResolution = {
    ...merged,
    canUseMediaTools,
    entitlementActive,
    churchId,
    appUserId,
    endpointStatus: route.endpointStatus,
    routeFailed: route.routeFailed,
    backendSubscriptionActive: route.explicitServerActive,
    subscriptionPlan:
      route.routeFailed || !route.responseBody
        ? null
        : route.responseBody?.media?.subscriptionPlan ||
          route.responseBody?.subscriptionPlan ||
          null,
  };

  console.log("KRISTO_SCHEDULE_SUBSCRIPTION_RESULT", {
    churchId: result.churchId,
    appUserId: result.appUserId,
    entitlementActive: result.entitlementActive,
    endpointStatus: result.endpointStatus,
    routeFailed: result.routeFailed,
    churchSubscriptionActive: result.churchSubscriptionActive,
    hasSubscription: result.hasSubscription,
    canUseMediaTools: result.canUseMediaTools,
    source: result.source,
    responseBody: route.responseBody,
  });

  return result;
}

export function resolveScheduleGateSubscriptionInputs(input: {
  churchId?: string;
  serverSubscriptionActive: boolean | null;
  entitlementActive?: boolean;
  customerInfo?: CustomerInfo | null;
}): {
  hasSubscription: boolean | null;
  subscriptionLocked: boolean;
  churchSubscriptionActive: boolean | null;
} {
  const churchId = resolveScheduleChurchId(input.churchId);
  const revenueCatAppUserId = getRevenueCatConfiguredAppUserId();
  const revenueCatScopedToChurch = Boolean(
    churchId && revenueCatAppUserId && revenueCatAppUserId === churchId
  );
  const entitlementActive =
    input.entitlementActive ??
    readChurchScopedEntitlementActive({
      churchId,
      customerInfo: input.customerInfo,
      revenueCatAppUserId,
    });
  const sessionProfileActive = readSessionMediaProfileSubscriptionActive(churchId);

  const merged = mergeScheduleSubscriptionSignals({
    churchId,
    explicitServerActive: input.serverSubscriptionActive,
    routeFailed: input.serverSubscriptionActive === null,
    entitlementActive,
    revenueCatScopedToChurch,
    sessionProfileActive,
  });

  const subscriptionLocked = merged.hasSubscription === false;

  console.log("KRISTO_SCHEDULE_SUBSCRIPTION_SOURCE", {
    churchId,
    appUserId: resolveScheduleAppUserId(),
    revenueCatAppUserId,
    revenueCatScopedToChurch,
    entitlementActive,
    endpointStatus: null,
    routeFailed: input.serverSubscriptionActive === null,
    explicitServerActive: input.serverSubscriptionActive,
    sessionProfileActive,
    source: merged.source,
    mode: "sync_gate",
  });

  console.log("KRISTO_SCHEDULE_SUBSCRIPTION_RESULT", {
    churchId: resolveScheduleChurchId(),
    appUserId: resolveScheduleAppUserId(),
    entitlementActive,
    endpointStatus: null,
    hasSubscription: merged.hasSubscription,
    subscriptionLocked,
    churchSubscriptionActive: merged.churchSubscriptionActive,
    source: merged.source,
    mode: "sync_gate",
  });

  return {
    hasSubscription: merged.hasSubscription,
    subscriptionLocked,
    churchSubscriptionActive: merged.churchSubscriptionActive,
  };
}

export function alertChurchSubscriptionRequired(opts?: {
  isPastor?: boolean;
  isApprovedMediaHost?: boolean;
  screen?: string;
  gate?: string;
  onUpgrade?: () => void;
}) {
  const isPastor = resolveScheduleGateIsPastor(opts);
  const isApprovedMediaHost = opts?.isApprovedMediaHost === true;
  const gate = String(opts?.gate || "alertChurchSubscriptionRequired");
  const screen = String(opts?.screen || "alertChurchSubscriptionRequired");

  logScheduleGate({
    kind: "blocked",
    screen,
    gate,
    isPastor,
    bypassEnabled: false,
    allowed: false,
  });

  if (isPastor) {
    Alert.alert(
      CHURCH_SUBSCRIPTION_PREMIUM_TITLE,
      CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE,
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Upgrade",
          onPress: () => opts?.onUpgrade?.(),
        },
      ]
    );
    return;
  }

  Alert.alert(CHURCH_SUBSCRIPTION_REQUIRED_TITLE, CHURCH_SUBSCRIPTION_MEMBER_MESSAGE);
}

export async function fetchChurchSubscriptionActive(
  churchId: string,
  headers?: Record<string, string>,
  _opts?: { isPastor?: boolean; isApprovedMediaHost?: boolean }
): Promise<boolean | null> {
  const status = await fetchChurchSubscriptionStatus(headers, churchId);
  return status.subscriptionActive;
}

export type ChurchSubscriptionServerStatus = {
  subscriptionActive: boolean | null;
  /** True only when /api/church/media explicitly reports an active church subscription. */
  backendSubscriptionActive: boolean | null;
  canUseMediaTools: boolean | null;
  subscriptionPlan?: string | null;
  source?: string;
  routeFailed?: boolean;
};

/** Media Premium screen: raw `/api/church/media` only — no RevenueCat or session merge. */
export type ChurchMediaPremiumServerStatus = {
  churchId: string;
  serverSubscriptionActive: boolean;
  /** From `/api/church/media` — pastor/media-host tools access for this viewer. */
  canUseMediaTools: boolean | null;
  /** From `/api/church/media` — whether this viewer is the church's actual pastor. */
  isActualChurchPastor: boolean | null;
  subscriptionPlan: SubscriptionPlanKey | null;
  subscriptionExpiresAt: number | null;
  subscriptionSource: ChurchMediaSubscriptionSource | null;
  subscriptionOwnershipLock: ChurchMediaSubscriptionOwnershipLock | null;
  lockStatusKnown: boolean;
  routeFailed: boolean;
  source: "server_media_api";
};

export function isOfflineActivationMediaPremiumStatus(
  status: ChurchMediaPremiumServerStatus | null | undefined
): boolean {
  return (
    status?.serverSubscriptionActive === true &&
    status?.subscriptionSource === "offline_activation"
  );
}

function parseServerSubscriptionExpiresAt(media: any, res: any): number | null {
  const raw =
    media?.subscriptionExpiresAt ??
    media?.subscription_expires_at ??
    res?.subscriptionExpiresAt ??
    null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** Church-scoped media profile expiry from `/api/church/media` (RevenueCat or offline activation). */
export function parseChurchMediaSubscriptionExpiresAt(
  media: ChurchSubscriptionRecord | null | undefined
): number | null {
  return parseServerSubscriptionExpiresAt(media, null);
}

export type FetchChurchMediaPremiumServerStatusOptions = {
  /** When true, bypass client cache and force a fresh server read (e.g. after purchase). */
  bustCache?: boolean;
};

export async function fetchChurchMediaPremiumServerStatus(
  churchId: string,
  headers?: Record<string, string>,
  opts?: FetchChurchMediaPremiumServerStatusOptions
): Promise<ChurchMediaPremiumServerStatus> {
  const cid = String(churchId || "").trim();
  const userId = String(
    headers?.["x-kristo-user-id"] || headers?.["X-Kristo-User-Id"] || ""
  ).trim();
  const bustCache = opts?.bustCache === true;

  if (bustCache && userId && cid) {
    clearResponseCacheForRequest("GET", "/api/church/media", userId, cid);
  }

  const res: any = await apiGet(
    "/api/church/media",
    { headers },
    bustCache
      ? { screen: "MediaPremiumScreen", dedupe: false, throttleMs: 0 }
      : { screen: "MediaPremiumScreen" }
  );

  const routeFailed = isChurchMediaRouteFailure(res);
  const explicitActive = parseExplicitServerSubscriptionFromMediaRoute(res);
  const serverSubscriptionActive = explicitActive === true;
  const media = res?.media;
  const planRaw = String(media?.subscriptionPlan || res?.subscriptionPlan || "")
    .trim()
    .toLowerCase();
  const subscriptionPlan: SubscriptionPlanKey | null =
    planRaw === "yearly" ? "yearly" : planRaw === "monthly" ? "monthly" : null;
  const subscriptionExpiresAt = serverSubscriptionActive
    ? parseServerSubscriptionExpiresAt(media, res)
    : null;
  const subscriptionSource = serverSubscriptionActive
    ? parseChurchMediaSubscriptionSource(media, res)
    : null;
  const subscriptionOwnershipLock = parseChurchMediaSubscriptionOwnershipLock(res);
  const lockStatusKnown =
    !routeFailed &&
    res?.subscriptionOwnershipLock != null &&
    typeof res.subscriptionOwnershipLock === "object";
  const canUseMediaTools =
    routeFailed || typeof res?.canUseMediaTools !== "boolean" ? null : res.canUseMediaTools === true;
  const isActualChurchPastor =
    routeFailed || typeof res?.isActualChurchPastor !== "boolean"
      ? null
      : res.isActualChurchPastor === true;

  console.log("KRISTO_CHURCH_MEDIA_SERVER_RESPONSE", {
    churchId: cid,
    subscriptionActive: serverSubscriptionActive,
    canUseMediaTools,
    subscriptionExpiresAt,
    subscriptionPlan,
    subscriptionSource,
    subscriptionOwnershipLockBlocked: subscriptionOwnershipLock?.blocked === true,
    lockStatusKnown,
    source: "server_media_api",
    routeFailed,
    explicitServerActive: explicitActive,
  });

  return {
    churchId: cid,
    serverSubscriptionActive,
    canUseMediaTools,
    isActualChurchPastor,
    subscriptionPlan,
    subscriptionExpiresAt,
    subscriptionSource,
    subscriptionOwnershipLock,
    lockStatusKnown,
    routeFailed,
    source: "server_media_api",
  };
}

export async function fetchChurchSubscriptionStatus(
  headers?: Record<string, string>,
  churchId?: string
): Promise<ChurchSubscriptionServerStatus> {
  const resolved = await resolveScheduleSubscriptionState({
    churchId,
    headers,
    fetchCustomerInfo: true,
  });

  return {
    subscriptionActive: resolved.churchSubscriptionActive,
    backendSubscriptionActive: resolved.backendSubscriptionActive,
    canUseMediaTools: resolved.canUseMediaTools,
    subscriptionPlan: resolved.subscriptionPlan ?? null,
    source: resolved.source,
    routeFailed: resolved.routeFailed,
  };
}

export type ChurchSubscriptionScreenState = "none" | "monthly" | "yearly" | "sync";

/** Kristo V1 subscriptions screen: backend media route is source of truth for active UI. */
export function resolveChurchSubscriptionScreenState(
  serverStatus: ChurchSubscriptionServerStatus | null | undefined,
  customerInfo: CustomerInfo | null | undefined
): {
  screenState: ChurchSubscriptionScreenState;
  backendActive: boolean;
  backendPlan: SubscriptionPlanKey | null;
  rcHasPremium: boolean;
} {
  const backendActive = serverStatus?.backendSubscriptionActive === true;
  const rcHasPremium = hasPremiumEntitlement(customerInfo);

  if (!backendActive) {
    return {
      screenState: rcHasPremium ? "sync" : "none",
      backendActive: false,
      backendPlan: null,
      rcHasPremium,
    };
  }

  const planRaw = String(serverStatus?.subscriptionPlan || "").trim().toLowerCase();
  let backendPlan: SubscriptionPlanKey | null =
    planRaw === "yearly" ? "yearly" : planRaw === "monthly" ? "monthly" : null;

  if (!backendPlan) {
    backendPlan = customerInfo ? resolveActiveSubscriptionPlan(customerInfo) : null;
  }
  if (!backendPlan) {
    backendPlan = "monthly";
  }

  return {
    screenState: backendPlan === "yearly" ? "yearly" : "monthly",
    backendActive: true,
    backendPlan,
    rcHasPremium,
  };
}

export function logChurchSubscriptionContext(args: {
  screen: string;
  churchId: string;
  customerInfo?: CustomerInfo | null;
  churchSubscriptionActive?: boolean;
  canUseMediaTools?: boolean;
}) {
  const churchId = String(args.churchId || "").trim();
  const revenueCatAppUserId = getRevenueCatConfiguredAppUserId();
  const rcDebug = describeCustomerInfoSubscriptionDebug(args.customerInfo);
  logEntitlementAudit({
    customerInfo: args.customerInfo,
    churchId,
    source: `church-subscription-context:${args.screen}`,
  });

  console.log("KRISTO_CHURCH_SUBSCRIPTION_CONTEXT", {
    screen: args.screen,
    currentChurchId: churchId,
    revenueCatAppUserId,
    churchIdMatchesRcAppUserId: Boolean(churchId && revenueCatAppUserId === churchId),
    activeEntitlementKeys: rcDebug.activeEntitlementKeys,
    activeProductIdentifiers: rcDebug.activeProductIdentifiers,
    detectedEntitlement: rcDebug.detectedEntitlement,
    hasPremiumEntitlement: rcDebug.hasPremiumEntitlement,
    hasRealEntitlement: rcDebug.hasRealEntitlement,
    hasActivePremiumProduct: rcDebug.hasActivePremiumProduct,
    serverChurchSubscriptionActive: args.churchSubscriptionActive === true,
    canUseMediaTools: args.canUseMediaTools === true,
    note: "RevenueCat App User ID is churchId — subscription is per church, not per user.",
  });
}

/** @deprecated Prefer resolveScheduleSubscriptionState — never treats route failures as inactive. */
export async function fetchChurchMediaTrialDebug(
  headers?: Record<string, string>
): Promise<{ response: any | null; error: string | null }> {
  const route = await probeChurchMediaScheduleRoute({ headers });
  if (route.routeFailed) {
    return {
      response: route.responseBody,
      error: String(route.responseBody?.error || `route_failed_${route.endpointStatus || "unknown"}`),
    };
  }
  return { response: route.responseBody, error: null };
}

export async function fetchChurchMonthlyTrialEligibility(
  headers?: Record<string, string>
): Promise<{
  eligible: boolean;
  premiumTrialUsedAt?: number | null;
} | null> {
  const debug = await fetchChurchMediaTrialDebug(headers);
  if (!debug.response || typeof debug.response?.monthlyTrialEligible !== "boolean") {
    return null;
  }

  return {
    eligible: Boolean(debug.response.monthlyTrialEligible),
    premiumTrialUsedAt: debug.response?.media?.premiumTrialUsedAt ?? null,
  };
}

export type ChurchSubscriptionActivationSource = "purchase" | "restore" | "explicit_sync";

export type ChurchSubscriptionActivationResult = {
  activated: boolean;
  stopRetry?: boolean;
  ownershipConflict?: boolean;
  ownershipLock?: ChurchMediaSubscriptionOwnershipLock | null;
  error?: string | null;
  status?: number | null;
  reason?: string | null;
};

const PASTOR_MEDIA_FORBIDDEN_ERROR = "Only the church Pastor can manage Church Media";

function isPastorMediaForbiddenResponse(res: any): boolean {
  const status = Number(res?.status || 0);
  const error = String(res?.error || res?.message || "").trim();
  return status === 403 && error.includes(PASTOR_MEDIA_FORBIDDEN_ERROR);
}

function resolveActivationRequestScope(args: {
  churchId: string;
  userId: string;
  headers?: Record<string, string>;
}) {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const headerChurchId = String(
    args.headers?.["x-kristo-church-id"] || args.headers?.["X-Kristo-Church-Id"] || ""
  ).trim();
  const headerUserId = String(
    args.headers?.["x-kristo-user-id"] || args.headers?.["X-Kristo-User-Id"] || ""
  ).trim();

  const session = getSessionSync() as any;
  const sessionChurchId = String(session?.churchId || session?.activeChurchId || "").trim();
  const sessionUserId = String(session?.userId || "").trim();

  const headerChurchMatches =
    !headerChurchId || !churchId || churchIdsMatch(headerChurchId, churchId);
  const headerUserMatches = !headerUserId || !userId || headerUserId === userId;
  const sessionChurchMatches =
    !sessionChurchId || !churchId || churchIdsMatch(sessionChurchId, churchId);
  const sessionUserMatches = !sessionUserId || !userId || sessionUserId === userId;

  return {
    churchId,
    userId,
    allowed: headerChurchMatches && headerUserMatches && sessionChurchMatches && sessionUserMatches,
    headerChurchId: headerChurchId || null,
    sessionChurchId: sessionChurchId || null,
  };
}

export function canRunExplicitChurchSubscriptionActivation(args: {
  churchId: string;
  userId: string;
  role?: string;
  churchRole?: string;
  headers: Record<string, string>;
  activationSource: ChurchSubscriptionActivationSource;
  customerInfo?: CustomerInfo | null;
  purchaseConfirmed?: boolean;
}): { allowed: boolean; reason?: string } {
  if (!resolvePastorForSubscriptionSync(args)) {
    return { allowed: false, reason: "not-pastor" };
  }

  const scope = resolveActivationRequestScope(args);
  if (!scope.allowed) {
    return { allowed: false, reason: "church-user-scope-mismatch" };
  }

  if (args.activationSource === "purchase" && args.purchaseConfirmed === true) {
    return { allowed: true };
  }

  const revenueCatAppUserId = getRevenueCatConfiguredAppUserId();
  const entitlementScoped = readChurchScopedEntitlementActive({
    churchId: scope.churchId,
    customerInfo: args.customerInfo,
    revenueCatAppUserId,
  });
  if (!entitlementScoped) {
    return { allowed: false, reason: "entitlement-not-scoped-to-church" };
  }

  return { allowed: true };
}

export async function activateChurchSubscriptionForPastor(
  churchId: string,
  subscriptionPlan: "monthly" | "yearly",
  headers?: Record<string, string>
): Promise<boolean> {
  const result = await syncChurchSubscriptionFromRevenueCat(churchId, subscriptionPlan, headers);
  return result.activated;
}

/** Reconcile backend church media profile + subscription from RevenueCat entitlement. */
export async function syncChurchSubscriptionFromRevenueCat(
  churchId: string,
  subscriptionPlan: "monthly" | "yearly" = "monthly",
  headers?: Record<string, string>
): Promise<ChurchSubscriptionActivationResult> {
  const cid = String(churchId || "").trim();
  if (!cid) return { activated: false };

  console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_REQUEST", {
    churchId: cid,
    subscriptionPlan,
  });

  try {
    const res: any = await apiPatch(
      "/api/church/media",
      {
        action: "activate_church_subscription",
        subscriptionPlan,
        subscriptionActive: true,
      },
      { headers }
    );
    const activated = Boolean(res?.ok && res?.media?.subscriptionActive);
    if (activated) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_OK", {
        churchId: cid,
        subscriptionPlan,
      });
      return { activated: true };
    }

    const ownershipLock = parseChurchMediaSubscriptionOwnershipLock(res);
    const reason = String(res?.reason || "").trim();
    const ownershipConflict =
      Number(res?.status || 0) === 409 &&
      (reason === "store-subscription-ownership-conflict" ||
        reason === "subscription-ownership-lock");
    const unverifiedOwnership =
      Number(res?.status || 0) === 423 && isUnverifiedOwnershipReason(reason);
    if (ownershipConflict) {
      console.log("KRISTO_SUBSCRIPTION_ACTIVATION_BLOCKED_OWNER_MISMATCH", {
        churchId: cid,
        subscriptionPlan,
        reason,
        lockedChurchId: ownershipLock?.lockedChurchId ?? null,
        lockedChurchName: ownershipLock?.lockedChurchName ?? null,
        expiresAt: ownershipLock?.expiresAt ?? null,
      });
    }

    if (unverifiedOwnership) {
      console.log("KRISTO_SUBSCRIPTION_ACTIVATION_BLOCKED_UNVERIFIED_STORE_IDENTITY", {
        churchId: cid,
        subscriptionPlan,
        reason,
        status: res?.status ?? null,
      });
    }

    const stopRetry =
      isPastorMediaForbiddenResponse(res) || ownershipConflict || unverifiedOwnership;
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_FAILED", {
      churchId: cid,
      subscriptionPlan,
      ok: res?.ok,
      error: res?.error,
      reason: res?.reason,
      status: res?.status,
      code: res?.code,
      revenueCatLane: res?.revenueCatLane ?? null,
      sandboxPurchase: res?.sandboxPurchase === true,
      stopRetry,
    });
    return {
      activated: false,
      stopRetry,
      ownershipConflict,
      ownershipLock,
      error: String(res?.error || res?.reason || "").trim() || null,
      status: Number(res?.status || 0) || null,
      reason: reason || null,
    };
  } catch (error: any) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_FAILED", {
      churchId: cid,
      subscriptionPlan,
      error: String(error?.message || error || "unknown"),
    });
    return {
      activated: false,
      error: String(error?.message || error || "unknown"),
    };
  }
}

function resolvePastorForSubscriptionSync(args: {
  role?: string;
  churchRole?: string;
}) {
  return isPastorSessionRole(args.role) || isPastorSessionRole(args.churchRole);
}

export type SyncChurchSubscriptionAfterPurchaseResult = {
  entitlementActive: boolean;
  churchActivated: boolean;
  churchSubscriptionActive: boolean;
  canUseMediaTools: boolean;
  subscriptionPlan?: "monthly" | "yearly";
  storeOwnershipConflict?: boolean;
  ownershipLock?: ChurchMediaSubscriptionOwnershipLock | null;
};

export type SubscriptionPrepurchaseOwnershipResult =
  | { status: "allowed"; reason?: string | null }
  | {
      status: "conflict";
      reason?: string | null;
      ownershipLock: ChurchMediaSubscriptionOwnershipLock | null;
    }
  | { status: "unavailable"; reason?: string | null; httpStatus?: number | null };

const PREPURCHASE_OWNERSHIP_ENDPOINT = "/api/church/subscription/prepurchase-ownership-check";

function isStructuredOwnershipConflictBody(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (body.allowed === true) return false;
  const reason = String(body.reason || "").trim();
  if (
    reason === "store-subscription-ownership-conflict" ||
    reason === "subscription-ownership-lock"
  ) {
    return true;
  }
  const lock = parseChurchMediaSubscriptionOwnershipLock(body);
  return lock?.blocked === true;
}

function isUnverifiedOwnershipReason(reason: string | null | undefined): boolean {
  const normalized = String(reason || "").trim();
  return (
    normalized === "unverified-store-identity" ||
    normalized === "conflict-pending-verification"
  );
}

async function assertDeviceStoreSubscriptionAllowsPurchase(churchId: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const info = await getCustomerSubscriptionInfo().catch(() => null);
  const revenueCatAppUserId = getRevenueCatConfiguredAppUserId();
  const entitlementActive = readChurchScopedEntitlementActive({
    churchId,
    customerInfo: info,
    revenueCatAppUserId,
  });
  if (!entitlementActive || !info) {
    return { allowed: true };
  }

  const originalAppUserId = String(info.originalAppUserId || "").trim();
  const aliased =
    Boolean(originalAppUserId) &&
    originalAppUserId !== churchId &&
    (originalAppUserId.startsWith("$RCAnonymousID:") || /^CH7-/i.test(originalAppUserId));

  if (aliased) {
    console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
      churchId,
      reason: "device-subscription-alias-unverified",
      revenueCatOriginalAppUserId: originalAppUserId,
    });
    return { allowed: false, reason: "conflict-pending-verification" };
  }

  return { allowed: true };
}

export async function runSubscriptionPrepurchaseOwnershipGate(args: {
  churchId: string;
  headers: Record<string, string>;
}): Promise<SubscriptionPrepurchaseOwnershipResult> {
  const churchId = String(args.churchId || "").trim();
  const endpoint = PREPURCHASE_OWNERSHIP_ENDPOINT;

  console.log("KRISTO_SUBSCRIPTION_PREPURCHASE_OWNERSHIP_CHECK_START", {
    churchId,
    endpoint,
  });

  if (!churchId) {
    console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
      churchId: null,
      reason: "missing-church-id",
      endpoint,
    });
    return { status: "unavailable", reason: "missing-church-id" };
  }

  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (!base) {
    console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
      churchId,
      reason: "missing-api-base",
      endpoint,
    });
    return { status: "unavailable", reason: "missing-api-base" };
  }

  await logInRevenueCatForChurchSubscription(churchId, { syncPurchases: true });

  const url = `${base}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...args.headers,
      },
      body: JSON.stringify({ churchId }),
    });
    const rawText = await res.text();
    let body: any = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = null;
    }

    console.log("KRISTO_SUBSCRIPTION_PREPURCHASE_ROUTE_RESPONSE", {
      status: res.status,
      body: body ?? (rawText ? rawText.slice(0, 500) : null),
      churchId,
      endpoint,
    });

    if (res.status === 404 || res.status === 423 || res.status >= 500 || body == null) {
      console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
        churchId,
        status: res.status,
        reason:
          res.status === 404
            ? "route-not-found"
            : isUnverifiedOwnershipReason(body?.reason)
              ? String(body.reason)
              : res.status === 423
                ? "ownership-check-unverified"
                : "invalid-or-error-response",
        endpoint,
      });
      return {
        status: "unavailable",
        reason:
          isUnverifiedOwnershipReason(body?.reason)
            ? String(body.reason)
            : res.status === 404
              ? "route-not-found"
              : "ownership-check-unavailable",
        httpStatus: res.status,
      };
    }

    if (res.status === 409 && isStructuredOwnershipConflictBody(body)) {
      const ownershipLock = parseChurchMediaSubscriptionOwnershipLock(body);
      console.log("KRISTO_SUBSCRIPTION_EXISTING_STORE_CONFLICT", {
        churchId,
        reason: body?.reason ?? null,
        lockedChurchId: ownershipLock?.lockedChurchId ?? null,
        lockedChurchName: ownershipLock?.lockedChurchName ?? null,
        expiresAt: ownershipLock?.expiresAt ?? null,
        store: ownershipLock?.store ?? body?.store ?? null,
        willRenew: ownershipLock?.willRenew ?? body?.willRenew ?? null,
        endpoint,
      });
      return {
        status: "conflict",
        reason: body?.reason ?? null,
        ownershipLock,
      };
    }

    if (!res.ok) {
      if (isUnverifiedOwnershipReason(body?.reason)) {
        console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
          churchId,
          status: res.status,
          reason: body?.reason ?? "ownership-check-unverified",
          endpoint,
        });
        return {
          status: "unavailable",
          reason: String(body?.reason || "ownership-check-unverified"),
          httpStatus: res.status,
        };
      }
      console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
        churchId,
        status: res.status,
        reason: body?.reason ?? body?.error ?? "ownership-check-failed",
        endpoint,
      });
      return {
        status: "unavailable",
        reason: String(body?.reason || body?.error || "ownership-check-failed"),
        httpStatus: res.status,
      };
    }

    if (body?.allowed === false && isStructuredOwnershipConflictBody(body)) {
      const ownershipLock = parseChurchMediaSubscriptionOwnershipLock(body);
      console.log("KRISTO_SUBSCRIPTION_EXISTING_STORE_CONFLICT", {
        churchId,
        reason: body?.reason ?? null,
        lockedChurchId: ownershipLock?.lockedChurchId ?? null,
        lockedChurchName: ownershipLock?.lockedChurchName ?? null,
        expiresAt: ownershipLock?.expiresAt ?? null,
        store: ownershipLock?.store ?? body?.store ?? null,
        willRenew: ownershipLock?.willRenew ?? body?.willRenew ?? null,
        endpoint,
      });
      return {
        status: "conflict",
        reason: body?.reason ?? null,
        ownershipLock,
      };
    }

    console.log("KRISTO_SUBSCRIPTION_PREPURCHASE_OWNERSHIP_CHECK", {
      churchId,
      allowed: true,
      reason: body?.reason ?? "ok",
      storeSubscriptionIdentity: body?.storeSubscriptionIdentity ?? null,
      endpoint,
    });

    if (body?.productId && !body?.storeSubscriptionIdentity) {
      console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
        churchId,
        reason: "allowed-without-store-identity",
        productId: body.productId,
        store: body?.store ?? null,
        endpoint,
      });
      return { status: "unavailable", reason: "unverified-store-identity" };
    }

    const deviceCheck = await assertDeviceStoreSubscriptionAllowsPurchase(churchId);
    if (!deviceCheck.allowed) {
      return {
        status: "unavailable",
        reason: deviceCheck.reason ?? "conflict-pending-verification",
      };
    }

    return { status: "allowed", reason: body?.reason ?? "ok" };
  } catch (error: any) {
    console.log("KRISTO_SUBSCRIPTION_OWNERSHIP_CHECK_UNAVAILABLE", {
      churchId,
      reason: "network-error",
      message: String(error?.message || error || "unknown"),
      endpoint,
    });
    return { status: "unavailable", reason: "network-error" };
  }
}

/** @deprecated Use runSubscriptionPrepurchaseOwnershipGate before purchase. */
export async function checkSubscriptionPrepurchaseOwnership(args: {
  churchId: string;
  headers: Record<string, string>;
}): Promise<{
  allowed: boolean;
  reason?: string | null;
  ownershipLock: ChurchMediaSubscriptionOwnershipLock | null;
}> {
  const result = await runSubscriptionPrepurchaseOwnershipGate(args);
  if (result.status === "allowed") {
    return { allowed: true, reason: result.reason ?? null, ownershipLock: null };
  }
  if (result.status === "conflict") {
    return {
      allowed: false,
      reason: result.reason ?? null,
      ownershipLock: result.ownershipLock,
    };
  }
  return { allowed: false, reason: result.reason ?? null, ownershipLock: null };
}

const purchaseSyncInflight = new Map<string, Promise<SyncChurchSubscriptionAfterPurchaseResult>>();

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptChurchSubscriptionActivationWithRetries(args: {
  churchId: string;
  userId: string;
  subscriptionPlan: "monthly" | "yearly";
  headers: Record<string, string>;
  purchaseConfirmed: boolean;
  activationSource: ChurchSubscriptionActivationSource;
}): Promise<{
  activated: boolean;
  ownershipConflict?: boolean;
  ownershipLock?: ChurchMediaSubscriptionOwnershipLock | null;
}> {
  const maxAttempts = args.purchaseConfirmed ? (__DEV__ ? 8 : 6) : 3;
  const baseDelayMs = args.purchaseConfirmed ? 1500 : 800;

  console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_START", {
    churchId: args.churchId,
    userId: args.userId,
    subscriptionPlan: args.subscriptionPlan,
    purchaseConfirmed: args.purchaseConfirmed,
    activationSource: args.activationSource,
    maxAttempts,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_ATTEMPT", {
      churchId: args.churchId,
      userId: args.userId,
      attempt,
      subscriptionPlan: args.subscriptionPlan,
      activationSource: args.activationSource,
    });

    const result = await syncChurchSubscriptionFromRevenueCat(
      args.churchId,
      args.subscriptionPlan,
      args.headers
    );
    if (result.activated) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATED_AFTER_PURCHASE", {
        churchId: args.churchId,
        userId: args.userId,
        subscriptionPlan: args.subscriptionPlan,
        activationSource: args.activationSource,
        attempt,
      });
      return { activated: true };
    }

    if (result.ownershipConflict) {
      return {
        activated: false,
        ownershipConflict: true,
        ownershipLock: result.ownershipLock ?? null,
      };
    }

    if (result.stopRetry) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_STOP_RETRY", {
        churchId: args.churchId,
        userId: args.userId,
        attempt,
        error: result.error,
        status: result.status,
      });
      return { activated: false };
    }

    if (attempt < maxAttempts - 1) {
      const delayMs = baseDelayMs * (attempt < 2 ? 1 : 1.25);
      await sleepMs(delayMs);
    }
  }

  console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_PENDING", {
    churchId: args.churchId,
    userId: args.userId,
    subscriptionPlan: args.subscriptionPlan,
    purchaseConfirmed: args.purchaseConfirmed,
    activationSource: args.activationSource,
  });
  return { activated: false };
}

async function syncChurchSubscriptionAfterPurchaseInner(
  args: {
    churchId: string;
    userId: string;
    role?: string;
    churchRole?: string;
    subscriptionPlan: "monthly" | "yearly";
    headers: Record<string, string>;
    purchaseConfirmed?: boolean;
    activationSource?: ChurchSubscriptionActivationSource;
    initialCustomerInfo?: CustomerInfo | null;
  }
): Promise<SyncChurchSubscriptionAfterPurchaseResult> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const purchaseConfirmed = args.purchaseConfirmed === true;
  const activationSource = args.activationSource;
  const isPastor = resolvePastorForSubscriptionSync(args);

  console.log("KRISTO_SUBSCRIPTION_PURCHASE_SUCCESS", {
    churchId,
    userId,
    subscriptionPlan: args.subscriptionPlan,
    purchaseConfirmed,
    activationSource: activationSource || null,
    isPastor,
  });

  const premiumStatus = await fetchChurchMediaPremiumServerStatus(churchId, args.headers, {
    bustCache: true,
  });
  if (isSubscriptionOwnershipLockBlockingActivation(premiumStatus.subscriptionOwnershipLock)) {
    const lock = premiumStatus.subscriptionOwnershipLock;
    console.log("KRISTO_SUBSCRIPTION_LOCK_BLOCKED_ACTIVATION", {
      churchId,
      userId,
      activationSource: activationSource || null,
      lockedChurchId: lock?.lockedChurchId ?? null,
      lockedChurchName: lock?.lockedChurchName ?? null,
      expiresAt: lock?.expiresAt ?? null,
    });
    return {
      entitlementActive: false,
      churchActivated: false,
      churchSubscriptionActive: premiumStatus.serverSubscriptionActive === true,
      canUseMediaTools: false,
    };
  }

  const churchCustomerInfo = await logInRevenueCatForChurchSubscription(churchId, {
    syncPurchases:
      purchaseConfirmed ||
      activationSource === "restore" ||
      activationSource === "explicit_sync",
  });
  let info: CustomerInfo | null = churchCustomerInfo ?? args.initialCustomerInfo ?? null;
  let entitlementActive = readChurchScopedEntitlementActive({
    churchId,
    customerInfo: info,
    revenueCatAppUserId: getRevenueCatConfiguredAppUserId(),
  });
  let churchActivated = false;

  const activationGate =
    activationSource &&
    canRunExplicitChurchSubscriptionActivation({
      churchId,
      userId,
      role: args.role,
      churchRole: args.churchRole,
      headers: args.headers,
      activationSource,
      customerInfo: info,
      purchaseConfirmed,
    });
  const shouldAttemptChurchActivation = Boolean(activationGate?.allowed);

  if (!activationSource) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_SKIPPED", {
      churchId,
      userId,
      reason: "no-explicit-activation-source",
    });
  } else if (!shouldAttemptChurchActivation) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_SKIPPED", {
      churchId,
      userId,
      activationSource,
      reason: activationGate?.reason || "activation-gate-blocked",
    });
  }

  if (purchaseConfirmed && shouldAttemptChurchActivation) {
    // Give RevenueCat time to finish posting the StoreKit receipt before the server verifies.
    await sleepMs(__DEV__ ? 1200 : 800);
  }

  const shouldPollEntitlement = purchaseConfirmed || Boolean(activationSource);

  if (shouldPollEntitlement) {
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_START", {
      mode: purchaseConfirmed ? "post-purchase" : "explicit-sync",
      purchaseConfirmed,
      activationSource: activationSource || null,
      isPastor,
      hasInitialInfo: Boolean(info),
      initialEntitlementActive: entitlementActive,
    });
    const refreshed = await refreshCustomerInfoAfterStorePurchase(info, {
      maxAttempts: purchaseConfirmed ? (__DEV__ ? 5 : 8) : __DEV__ ? 2 : 4,
      delayMs: purchaseConfirmed ? (__DEV__ ? 1200 : 1500) : __DEV__ ? 500 : 1200,
    });
    info = refreshed.info;
    entitlementActive = readChurchScopedEntitlementActive({
      churchId,
      customerInfo: info,
      revenueCatAppUserId: getRevenueCatConfiguredAppUserId(),
    });
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_DONE", {
      mode: purchaseConfirmed ? "post-purchase" : "explicit-sync",
      entitlementActive,
      activationSource: activationSource || null,
    });
  }

  if (entitlementActive) {
    const churchPremium = getActivePremiumEntitlement(info);
    console.log("KRISTO_SUBSCRIPTION_ENTITLEMENT_ACTIVE", {
      churchId,
      userId,
      productId: churchPremium?.productIdentifier || null,
    });
  } else if (purchaseConfirmed) {
    console.log("KRISTO_SUBSCRIPTION_ENTITLEMENT_PENDING", {
      churchId,
      userId,
      purchaseConfirmed,
    });
  }

  let storeOwnershipConflict = false;
  let ownershipConflictLock: ChurchMediaSubscriptionOwnershipLock | null = null;

  if (shouldAttemptChurchActivation && activationSource) {
    const activationResult = await attemptChurchSubscriptionActivationWithRetries({
      churchId,
      userId,
      subscriptionPlan: args.subscriptionPlan,
      headers: args.headers,
      purchaseConfirmed,
      activationSource,
    });
    churchActivated = activationResult.activated;
    if (activationResult.ownershipConflict) {
      storeOwnershipConflict = true;
      ownershipConflictLock = activationResult.ownershipLock ?? ownershipConflictLock;
    }
  } else if (purchaseConfirmed && !isPastor) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_SKIPPED", {
      churchId,
      userId,
      reason: "not-pastor",
    });
  }

  if (
    !churchActivated &&
    !storeOwnershipConflict &&
    purchaseConfirmed &&
    shouldAttemptChurchActivation &&
    activationSource === "purchase"
  ) {
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_AFTER_ACTIVATION_START");
    try {
      const refreshed = await refreshCustomerInfoAfterStorePurchase(info, {
        maxAttempts: __DEV__ ? 3 : 4,
        delayMs: __DEV__ ? 1200 : 1500,
      });
      info = refreshed.info;
      entitlementActive = readChurchScopedEntitlementActive({
        churchId,
        customerInfo: info,
        revenueCatAppUserId: getRevenueCatConfiguredAppUserId(),
      });
      console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_AFTER_ACTIVATION_DONE", {
        entitlementActive,
      });
      if (!churchActivated && entitlementActive) {
        const activationResult = await attemptChurchSubscriptionActivationWithRetries({
          churchId,
          userId,
          subscriptionPlan: args.subscriptionPlan,
          headers: args.headers,
          purchaseConfirmed: true,
          activationSource: "purchase",
        });
        churchActivated = activationResult.activated;
        if (activationResult.ownershipConflict) {
          storeOwnershipConflict = true;
          ownershipConflictLock = activationResult.ownershipLock ?? ownershipConflictLock;
        }
      }
    } catch (error: any) {
      console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_AFTER_ACTIVATION_FAILED", {
        error: String(error?.message || error || "unknown"),
      });
    }
  }

  console.log("KRISTO_MEDIA_ACCESS_REFRESH_START", { churchId, userId });

  const mediaRefresh = await refreshChurchMediaIfNeeded({
    churchId,
    userId,
    headers: args.headers,
    screen: "PostPurchaseSubscriptionSync",
    force: true,
    includeHosts: true,
  });

  const mediaAccess = await refreshChurchMediaAccess({
    churchId,
    userId,
    role: args.role,
    churchRole: args.churchRole,
    headers: args.headers,
    force: true,
  });

  const churchSubscriptionActive = Boolean(
    mediaRefresh.mediaRes?.subscriptionActive ||
      mediaRefresh.mediaRes?.media?.subscriptionActive ||
      mediaAccess.subscriptionActive === true
  );

  const canUseMediaTools = Boolean(
    mediaAccess.canUseMediaTools ||
      mediaRefresh.mediaRes?.canUseMediaTools ||
      mediaRefresh.hostsRes?.canUseMediaTools
  );

  console.log("KRISTO_MEDIA_ACCESS_REFRESH_AFTER_PURCHASE", {
    churchId,
    userId,
    churchSubscriptionActive,
    canUseMediaTools,
    churchActivated,
    entitlementActive,
  });

  if (churchSubscriptionActive || canUseMediaTools || churchActivated) {
    announceChurchPremiumAccessUnlocked({
      churchId,
      userId,
      role: args.role,
      churchRole: args.churchRole,
      headers: args.headers,
      subscriptionPlan: args.subscriptionPlan,
      subscriptionActive: churchSubscriptionActive,
      backendSubscriptionActive: Boolean(
        mediaRefresh.mediaRes?.media?.subscriptionActive ||
          mediaRefresh.mediaRes?.subscriptionActive ||
          churchActivated
      ),
      canUseMediaTools,
      source: "subscription-purchase-activated",
    });
  }

  return {
    entitlementActive,
    churchActivated,
    churchSubscriptionActive,
    canUseMediaTools,
    subscriptionPlan: args.subscriptionPlan,
    storeOwnershipConflict,
    ownershipLock: ownershipConflictLock,
  };
}

/** Reconcile backend church media profile + subscription from RevenueCat after explicit pastor action. */
export async function syncChurchSubscriptionAfterPurchase(args: {
  churchId: string;
  userId: string;
  role?: string;
  churchRole?: string;
  subscriptionPlan: "monthly" | "yearly";
  headers: Record<string, string>;
  /** StoreKit purchase completed; keep syncing even if RC entitlement is delayed. */
  purchaseConfirmed?: boolean;
  /** Required for backend activation — purchase, restore, or explicit sync button only. */
  activationSource?: ChurchSubscriptionActivationSource;
  initialCustomerInfo?: CustomerInfo | null;
}): Promise<SyncChurchSubscriptionAfterPurchaseResult> {
  const churchId = String(args.churchId || "").trim();
  if (!churchId) {
    return {
      entitlementActive: false,
      churchActivated: false,
      churchSubscriptionActive: false,
      canUseMediaTools: false,
      subscriptionPlan: args.subscriptionPlan,
    };
  }

  const inflight = purchaseSyncInflight.get(churchId);
  if (inflight) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_COALESCED", { churchId });
    return inflight;
  }

  const promise = syncChurchSubscriptionAfterPurchaseInner(args);
  purchaseSyncInflight.set(churchId, promise);
  try {
    return await promise;
  } finally {
    if (purchaseSyncInflight.get(churchId) === promise) {
      purchaseSyncInflight.delete(churchId);
    }
  }
}

/** Link an existing device store subscription to the current church and activate on the backend. */
export async function recoverChurchSubscriptionFromExistingStore(args: {
  churchId: string;
  userId: string;
  role?: string;
  churchRole?: string;
  headers: Record<string, string>;
  subscriptionPlan?: "monthly" | "yearly";
}): Promise<{
  sync: SyncChurchSubscriptionAfterPurchaseResult;
  customerInfo: CustomerInfo | null;
  churchScopedEntitlementActive: boolean;
}> {
  const churchId = String(args.churchId || "").trim();
  const fallbackPlan = args.subscriptionPlan || "monthly";
  const emptySync: SyncChurchSubscriptionAfterPurchaseResult = {
    entitlementActive: false,
    churchActivated: false,
    churchSubscriptionActive: false,
    canUseMediaTools: false,
    subscriptionPlan: fallbackPlan,
  };

  if (!churchId) {
    return {
      sync: emptySync,
      customerInfo: null,
      churchScopedEntitlementActive: false,
    };
  }

  console.log("KRISTO_CHURCH_SUBSCRIPTION_EXISTING_STORE_RECOVER", {
    churchId,
    userId: args.userId,
    subscriptionPlan: args.subscriptionPlan || null,
  });

  const recovered = await recoverStoreSubscriptionForChurch({
    churchId,
    source: "existing-store-subscription",
  });

  if (!recovered.churchScopedEntitlementActive) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_EXISTING_STORE_RECOVER_NO_ENTITLEMENT", {
      churchId,
      entitlementActive: recovered.entitlementActive,
      resolvedPlan: recovered.resolvedPlan,
    });
    return {
      sync: emptySync,
      customerInfo: recovered.customerInfo,
      churchScopedEntitlementActive: false,
    };
  }

  const plan = recovered.resolvedPlan || args.subscriptionPlan || "monthly";
  const sync = await syncChurchSubscriptionAfterPurchase({
    churchId,
    userId: args.userId,
    role: args.role,
    churchRole: args.churchRole,
    subscriptionPlan: plan,
    headers: args.headers,
    activationSource: "restore",
    purchaseConfirmed: false,
    initialCustomerInfo: recovered.customerInfo,
  });

  return {
    sync,
    customerInfo: recovered.customerInfo,
    churchScopedEntitlementActive: true,
  };
}

export async function requireActiveChurchSubscriptionForSchedule(
  churchId: string,
  headers?: Record<string, string>,
  opts?: ScheduleSubscriptionGateOptions
) {
  const screen = String(opts?.screen || "requireActiveChurchSubscriptionForSchedule");
  const gate = String(opts?.gate || "requireActiveChurchSubscriptionForSchedule");
  const isPastor = resolveScheduleGateIsPastor(opts, headers);
  const isApprovedMediaHost = opts?.isApprovedMediaHost === true;
  const viewerIsHost = opts?.viewerIsHost === true || isApprovedMediaHost;

  const resolved = await resolveScheduleSubscriptionState({
    churchId,
    headers,
    fetchCustomerInfo: true,
  });
  const churchSubscriptionActive = resolved.hasSubscription;
  const canUseMediaTools =
    resolved.canUseMediaTools == null ? undefined : resolved.canUseMediaTools === true;
  const canOpenMediaScreen =
    opts?.canOpenMediaScreen === true ||
    resolved.routeFailed === false && resolved.canUseMediaTools === true;

  const strict = evaluateStrictChurchMediaLiveSubscriptionGate({
    gate,
    screen,
    churchId,
    churchSubscriptionActive,
    isPastor,
    isApprovedMediaHost,
    viewerIsHost,
    canUseMediaTools: opts?.canUseMediaTools ?? canUseMediaTools,
    canOpenMediaScreen: opts?.canOpenMediaScreen ?? canOpenMediaScreen,
    ministryRole: opts?.ministryRole,
    ministryToolAllowed: opts?.ministryToolAllowed,
    toolKey: opts?.toolKey,
  });

  logScheduleGate({
    kind: "check",
    screen,
    gate,
    isPastor,
    bypassEnabled: false,
    hasSubscription: churchSubscriptionActive,
    allowed: strict.allowed,
  });

  if (String(gate).startsWith("assignment-tool.")) {
    logAssignmentToolAccessDecision({
      toolKey: opts?.toolKey,
      gate,
      hasSubscription: churchSubscriptionActive,
      isPastor,
      ministryRole: opts?.ministryRole,
      viewerIsHost,
      canUseMediaTools: opts?.canUseMediaTools ?? resolved.canUseMediaTools,
      canOpenMediaScreen: opts?.canOpenMediaScreen ?? canOpenMediaScreen,
      ministryToolAllowed: opts?.ministryToolAllowed,
      allowed: strict.allowed,
    });
  }

  if (!strict.allowed) {
    logScheduleGate({
      kind: "blocked",
      screen,
      gate,
      isPastor,
      bypassEnabled: false,
      hasSubscription: churchSubscriptionActive,
      allowed: false,
    });
    alertChurchSubscriptionRequired({ isPastor, isApprovedMediaHost, screen, gate, onUpgrade: opts?.onUpgrade });
    return false;
  }

  return true;
}

export function isChurchSubscriptionRequiredError(
  res: any,
  opts?: { isPastor?: boolean; isApprovedMediaHost?: boolean; screen?: string; gate?: string }
) {
  const isPastor = resolveScheduleGateIsPastor(opts);
  const error = String(res?.error || res?.message || "").trim();
  const status = Number(res?.status || 0);
  const code = String(res?.code || "").trim();
  const blocked =
    code === CHURCH_SUBSCRIPTION_REQUIRED_CODE ||
    error === "Subscription required" ||
    (status === 403 && error.includes("Subscription")) ||
    status === 402 ||
    error.toUpperCase() === "CHURCH_SUBSCRIPTION_REQUIRED";

  if (blocked) {
    logScheduleGate({
      kind: "blocked",
      screen: String(opts?.screen || "isChurchSubscriptionRequiredError"),
      gate: String(opts?.gate || "isChurchSubscriptionRequiredError"),
      isPastor,
      bypassEnabled: false,
      allowed: false,
    });
    logSubscriptionGateBlocked(
      String(opts?.gate || "isChurchSubscriptionRequiredError"),
      false,
      { screen: opts?.screen || null, isPastor }
    );
  }

  return blocked;
}
