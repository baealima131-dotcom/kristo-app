import { Alert } from "react-native";
import type { CustomerInfo } from "react-native-purchases";
import { apiGet, apiPatch } from "./kristoApi";
import { getSessionSync } from "./kristoSession";
import {
  evaluateStrictChurchMediaLiveSubscriptionGate,
  logSubscriptionGateBlocked,
} from "./churchSubscriptionGate";
import { refreshChurchMediaIfNeeded } from "./churchResourceRefresh";
import { refreshChurchMediaAccess } from "./refreshCoordinator";
import { getPaymentsState } from "../store/paymentsStore";
import {
  isChurchMediaRouteFailure,
  isChurchSubscriptionActiveFromRecord,
  mergeScheduleSubscriptionSignals,
  parseExplicitServerSubscriptionFromMediaRoute,
  readLocalScheduleEntitlementActive,
  readSessionMediaProfileSubscriptionActive,
  type ChurchSubscriptionRecord,
} from "./churchSubscriptionMediaSignals";
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
  readSessionMediaProfileSubscriptionActive,
} from "./churchSubscriptionMediaSignals";

export const CHURCH_SUBSCRIPTION_REQUIRED_MESSAGE = CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE;

export type ScheduleGateLogContext = {
  screen: string;
  gate: string;
  isPastor?: boolean;
  isApprovedMediaHost?: boolean;
  hasSubscription?: boolean | null;
  subscriptionLocked?: boolean | null;
  headers?: Record<string, string>;
};

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
  const churchSubscriptionActive =
    ctx.hasSubscription === true ? true : ctx.hasSubscription === false ? false : null;

  const strict = evaluateStrictChurchMediaLiveSubscriptionGate({
    gate: ctx.gate,
    screen: ctx.screen,
    churchSubscriptionActive,
    isPastor,
    isApprovedMediaHost,
  });
  const allowed = strict.allowed;

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
    entitlementActive: readLocalScheduleEntitlementActive(),
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
  const churchId = resolveScheduleChurchId(args.churchId, args.headers);
  const appUserId = resolveScheduleAppUserId(args.headers);

  const route = await probeChurchMediaScheduleRoute({
    churchId,
    headers: args.headers,
  });

  let customerInfo = args.customerInfo ?? null;
  if (args.fetchCustomerInfo !== false && !customerInfo) {
    try {
      customerInfo = await getCustomerSubscriptionInfo();
    } catch {
      customerInfo = null;
    }
  }

  const entitlementActive = readLocalScheduleEntitlementActive(customerInfo);
  const merged = mergeScheduleSubscriptionSignals({
    explicitServerActive: route.explicitServerActive,
    routeFailed: route.routeFailed,
    entitlementActive,
  });

  const canUseMediaTools =
    route.routeFailed || route.responseBody?.canUseMediaTools == null
      ? merged.hasSubscription
      : route.responseBody?.canUseMediaTools === true
        ? true
        : route.responseBody?.canUseMediaTools === false
          ? false
          : merged.hasSubscription;

  console.log("KRISTO_SCHEDULE_SUBSCRIPTION_SOURCE", {
    churchId,
    appUserId,
    entitlementActive,
    endpointStatus: route.endpointStatus,
    routeFailed: route.routeFailed,
    explicitServerActive: route.explicitServerActive,
    sessionProfileActive: readSessionMediaProfileSubscriptionActive(),
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
  serverSubscriptionActive: boolean | null;
  entitlementActive?: boolean;
}): {
  hasSubscription: boolean | null;
  subscriptionLocked: boolean;
  churchSubscriptionActive: boolean | null;
} {
  const entitlementActive =
    input.entitlementActive ?? readLocalScheduleEntitlementActive();
  const merged = mergeScheduleSubscriptionSignals({
    explicitServerActive: input.serverSubscriptionActive,
    routeFailed: input.serverSubscriptionActive === null,
    entitlementActive,
  });

  const subscriptionLocked = merged.hasSubscription === false;

  console.log("KRISTO_SCHEDULE_SUBSCRIPTION_SOURCE", {
    churchId: resolveScheduleChurchId(),
    appUserId: resolveScheduleAppUserId(),
    entitlementActive,
    endpointStatus: null,
    routeFailed: input.serverSubscriptionActive === null,
    explicitServerActive: input.serverSubscriptionActive,
    sessionProfileActive: readSessionMediaProfileSubscriptionActive(),
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
  canUseMediaTools: boolean | null;
  subscriptionPlan?: string | null;
  source?: string;
  routeFailed?: boolean;
};

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
    canUseMediaTools: resolved.canUseMediaTools,
    subscriptionPlan: resolved.subscriptionPlan ?? null,
    source: resolved.source,
    routeFailed: resolved.routeFailed,
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

export async function activateChurchSubscriptionForPastor(
  churchId: string,
  subscriptionPlan: "monthly" | "yearly",
  headers?: Record<string, string>
): Promise<boolean> {
  const cid = String(churchId || "").trim();
  if (!cid) return false;

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
      return true;
    }

    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_FAILED", {
      churchId: cid,
      subscriptionPlan,
      ok: res?.ok,
      error: res?.error,
      reason: res?.reason,
      status: res?.status,
      code: res?.code,
    });
    return false;
  } catch (error: any) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_FAILED", {
      churchId: cid,
      subscriptionPlan,
      error: String(error?.message || error || "unknown"),
    });
    return false;
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
};

export async function syncChurchSubscriptionAfterPurchase(args: {
  churchId: string;
  userId: string;
  role?: string;
  churchRole?: string;
  subscriptionPlan: "monthly" | "yearly";
  headers: Record<string, string>;
  /** StoreKit purchase completed; keep syncing even if RC entitlement is delayed. */
  purchaseConfirmed?: boolean;
  initialCustomerInfo?: CustomerInfo | null;
}): Promise<SyncChurchSubscriptionAfterPurchaseResult> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const purchaseConfirmed = args.purchaseConfirmed !== false;
  const isPastor = resolvePastorForSubscriptionSync(args);

  console.log("KRISTO_SUBSCRIPTION_PURCHASE_SUCCESS", {
    churchId,
    userId,
    subscriptionPlan: args.subscriptionPlan,
    purchaseConfirmed,
    isPastor,
  });

  const churchCustomerInfo = await logInRevenueCatForChurchSubscription(churchId);
  let info: CustomerInfo | null = churchCustomerInfo ?? args.initialCustomerInfo ?? null;
  let entitlementActive = hasPremiumEntitlement(info);
  let churchActivated = false;
  const shouldAttemptChurchActivation =
    isPastor && (entitlementActive || purchaseConfirmed);

  if (shouldAttemptChurchActivation && purchaseConfirmed) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_START", {
      churchId,
      userId,
      subscriptionPlan: args.subscriptionPlan,
      purchaseConfirmed,
      entitlementActive,
      mode: "immediate",
    });

    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts && !churchActivated; attempt++) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_ATTEMPT", {
        churchId,
        userId,
        attempt,
        subscriptionPlan: args.subscriptionPlan,
      });

      churchActivated = await activateChurchSubscriptionForPastor(
        churchId,
        args.subscriptionPlan,
        args.headers
      );

      if (!churchActivated && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }

    if (churchActivated) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATED_AFTER_PURCHASE", {
        churchId,
        userId,
        subscriptionPlan: args.subscriptionPlan,
      });
    } else {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_PENDING", {
        churchId,
        userId,
        subscriptionPlan: args.subscriptionPlan,
        entitlementActive,
        purchaseConfirmed,
      });
    }
  }

  const skipLongEntitlementPoll = purchaseConfirmed && (__DEV__ || isPastor);

  if (skipLongEntitlementPoll) {
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_START", {
      mode: "quick",
      purchaseConfirmed,
      isPastor,
      hasInitialInfo: Boolean(info),
      initialEntitlementActive: entitlementActive,
    });
    if (!info) {
      try {
        info = await getCustomerSubscriptionInfo();
        entitlementActive = hasPremiumEntitlement(info);
      } catch (error: any) {
        console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_FAILED", {
          mode: "quick",
          error: String(error?.message || error || "unknown"),
        });
      }
    }
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_DONE", {
      mode: "quick",
      entitlementActive,
    });
  } else {
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_START", { mode: "poll" });
    const refreshed = await refreshCustomerInfoAfterStorePurchase(info, {
      maxAttempts: __DEV__ ? 2 : 8,
      delayMs: __DEV__ ? 500 : 1500,
    });
    info = refreshed.info;
    entitlementActive = refreshed.entitlementActive;
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_DONE", {
      mode: "poll",
      entitlementActive,
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

  if (shouldAttemptChurchActivation && !purchaseConfirmed) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_START", {
      churchId,
      userId,
      subscriptionPlan: args.subscriptionPlan,
      purchaseConfirmed,
      entitlementActive,
      mode: "after-entitlement-poll",
    });

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts && !churchActivated; attempt++) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_ATTEMPT", {
        churchId,
        userId,
        attempt,
        subscriptionPlan: args.subscriptionPlan,
      });

      churchActivated = await activateChurchSubscriptionForPastor(
        churchId,
        args.subscriptionPlan,
        args.headers
      );

      if (!churchActivated && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    if (churchActivated) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATED_AFTER_PURCHASE", {
        churchId,
        userId,
        subscriptionPlan: args.subscriptionPlan,
      });
    } else if (!churchActivated) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_PENDING", {
        churchId,
        userId,
        subscriptionPlan: args.subscriptionPlan,
        entitlementActive,
        purchaseConfirmed,
      });
    }
  } else if (purchaseConfirmed && !isPastor) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_SKIPPED", {
      churchId,
      userId,
      reason: "not-pastor",
    });
  }

  if (!entitlementActive && purchaseConfirmed && info) {
    console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_AFTER_ACTIVATION_START");
    try {
      const refreshed = await refreshCustomerInfoAfterStorePurchase(info, {
        maxAttempts: __DEV__ ? 1 : 3,
        delayMs: __DEV__ ? 0 : 1000,
      });
      info = refreshed.info;
      entitlementActive = refreshed.entitlementActive;
      console.log("KRISTO_RC_CUSTOMER_INFO_REFRESH_AFTER_ACTIVATION_DONE", {
        entitlementActive,
      });
      if (entitlementActive) {
        const churchPremium = getActivePremiumEntitlement(info);
        console.log("KRISTO_SUBSCRIPTION_ENTITLEMENT_ACTIVE", {
          churchId,
          userId,
          productId: churchPremium?.productIdentifier || null,
          afterActivation: true,
        });
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

  return {
    entitlementActive,
    churchActivated,
    churchSubscriptionActive,
    canUseMediaTools,
  };
}

export async function requireActiveChurchSubscriptionForSchedule(
  churchId: string,
  headers?: Record<string, string>,
  opts?: {
    isPastor?: boolean;
    isApprovedMediaHost?: boolean;
    screen?: string;
    gate?: string;
    onUpgrade?: () => void;
  }
) {
  const screen = String(opts?.screen || "requireActiveChurchSubscriptionForSchedule");
  const gate = String(opts?.gate || "requireActiveChurchSubscriptionForSchedule");
  const isPastor = resolveScheduleGateIsPastor(opts, headers);
  const isApprovedMediaHost = opts?.isApprovedMediaHost === true;

  const resolved = await resolveScheduleSubscriptionState({
    churchId,
    headers,
    fetchCustomerInfo: true,
  });
  const churchSubscriptionActive = resolved.hasSubscription;

  const strict = evaluateStrictChurchMediaLiveSubscriptionGate({
    gate,
    screen,
    churchId,
    churchSubscriptionActive,
    isPastor,
    isApprovedMediaHost,
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
