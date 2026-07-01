/**
 * V1 subscription hardening (launch-blocker item #2).
 *
 * Server-side verification of the RevenueCat church premium entitlement
 * before we activate a church subscription. The mobile checkout flow performs a
 * client-side entitlement check, but the server must not trust it: previously
 * `PATCH /api/church/media` accepted `subscriptionActive: true` from the client
 * verbatim, so anyone with pastor identity could unlock premium for free.
 *
 * This calls the RevenueCat REST API (v1 subscribers endpoint) with a SERVER
 * secret key (`REVENUECAT_SECRET_API_KEY`) and confirms the entitlement is
 * present and not expired. No webhooks (that is a V2 concern).
 */

import {
  CHURCH_PREMIUM_ENTITLEMENT,
  CHURCH_PREMIUM_ENTITLEMENT_IDS,
  CHURCH_PREMIUM_PRODUCT_IDS,
  IOS_REVENUECAT_PUBLIC_API_KEY,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
} from "@/lib/churchPremiumRevenueCat";

export {
  CHURCH_PREMIUM_ENTITLEMENT,
  CHURCH_PREMIUM_ENTITLEMENT_IDS,
  LEGACY_PREMIUM_ENTITLEMENT,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
} from "@/lib/churchPremiumRevenueCat";

const REVENUECAT_API_BASE = "https://api.revenuecat.com/v1";
const REQUEST_TIMEOUT_MS = 8000;
const ACTIVATION_VERIFY_RETRY_MS = 1500;
const ACTIVATION_VERIFY_MAX_ATTEMPTS = 3;

const VERIFIED_REASONS = new Set(["verified", "verified-subscription"]);

export type SubscriptionPlan = "monthly" | "yearly";

export type ChurchPremiumVerification = {
  active: boolean;
  plan: SubscriptionPlan | null;
  productId: string | null;
  reason: string;
  bypassed: boolean;
  /** ISO timestamp from RevenueCat entitlement, null for lifetime / unknown. */
  expiresAt: string | null;
  /** True when verification came from RevenueCat sandbox / StoreKit test data. */
  sandboxPurchase?: boolean;
  /** RevenueCat REST lane that produced this result. */
  revenueCatLane?: "production" | "sandbox";
};

type RevenueCatFetchLane = "production" | "sandbox";

function getSecretKey(): string {
  return String(process.env.REVENUECAT_SECRET_API_KEY || "").trim();
}

type RevenueCatServerKeyKind = "secret" | "public-ios" | "public-android" | "public-amazon" | "unknown" | "missing";

function maskRevenueCatKeyPrefix(value: string): string {
  const key = String(value || "").trim();
  if (!key) return "";
  return `${key.slice(0, 7)}...`;
}

function classifyRevenueCatServerKey(value: string): RevenueCatServerKeyKind {
  const key = String(value || "").trim();
  if (!key) return "missing";
  if (key.startsWith("sk_")) return "secret";
  if (key.startsWith("appl_")) return "public-ios";
  if (key.startsWith("goog_")) return "public-android";
  if (key.startsWith("amzn_")) return "public-amazon";
  return "unknown";
}

function logRevenueCatServerKeyAudit() {
  const secret = getSecretKey();
  const secretKeyKind = classifyRevenueCatServerKey(secret);
  const iosPublicKeyPrefix = maskRevenueCatKeyPrefix(IOS_REVENUECAT_PUBLIC_API_KEY);
  const serverKeyPrefix = maskRevenueCatKeyPrefix(secret);
  const likelyWrongKeyType = secretKeyKind !== "secret" && secretKeyKind !== "missing";

  console.log("KRISTO_REVENUECAT_KEY_AUDIT", {
    serverKeyKind: secretKeyKind,
    serverKeyPrefix,
    expectedIosPublicKeyPrefix: iosPublicKeyPrefix,
    sameProjectRequirement:
      "REVENUECAT_SECRET_API_KEY must be an sk_ secret from the same RevenueCat project as the iOS appl_ SDK key.",
    likelyMisconfigured: likelyWrongKeyType,
    misconfigurationHint: likelyWrongKeyType
      ? "Server is not using an sk_ secret key — REST verification may hit the wrong project or be rejected."
      : null,
  });
}

function logRevenueCatSubscriberResponse(args: {
  lane: RevenueCatFetchLane;
  httpStatus: number;
  data: any;
  requestHeaders: Record<string, string>;
}) {
  const subscriber = args.data?.subscriber || {};
  const entitlementKeys = Object.keys(subscriber.entitlements || {});
  const subscriptionKeys = Object.keys(subscriber.subscriptions || {});
  const subscriberId =
    String(subscriber.original_app_user_id || subscriber.app_user_id || "").trim() || null;

  console.log("KRISTO_REVENUECAT_FETCH_RESPONSE", {
    lane: args.lane,
    httpStatus: args.httpStatus,
    requestXIsSandbox: args.requestHeaders["X-Is-Sandbox"] ?? null,
    requestXPlatform: args.requestHeaders["X-Platform"] ?? null,
    entitlementKeys,
    subscriptionKeys,
    subscriberId,
    requestDate: args.data?.request_date ?? null,
  });
}

/**
 * Server-controlled bypass ONLY for non-activation reads. Never driven by a client header/flag.
 * - Non-production environments bypass entitlement reads (not activation).
 * - Production bypasses reads only when KRISTO_SUBSCRIPTION_BYPASS=1 is explicitly set.
 */
export function isSubscriptionVerificationBypassed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const bypass = process.env.KRISTO_SUBSCRIPTION_BYPASS === "1";
  if (bypass) {
    console.warn("KRISTO_SUBSCRIPTION_BYPASS_ENABLED", {
      kristoSubscriptionBypass: process.env.KRISTO_SUBSCRIPTION_BYPASS ?? null,
      nodeEnv: process.env.NODE_ENV,
    });
  }
  return bypass;
}

export function planFromProductId(productId: string | null | undefined): SubscriptionPlan | null {
  const id = String(productId || "").trim();
  if (!id) return null;
  if (id === PREMIUM_YEARLY_PRODUCT_ID || /yearly|annual|\$rc_annual/i.test(id)) {
    return "yearly";
  }
  if (id === PREMIUM_MONTHLY_PRODUCT_ID || /monthly|\$rc_monthly/i.test(id)) {
    return "monthly";
  }
  return null;
}

function entitlementIsActive(expiresDate: unknown): boolean {
  // RevenueCat returns `expires_date` as an ISO string, or null for lifetime.
  if (expiresDate === null || expiresDate === undefined) return true;
  const ms = Date.parse(String(expiresDate));
  if (Number.isNaN(ms)) return false;
  return ms > Date.now();
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isVerifiedChurchPremiumReason(reason: string): boolean {
  return VERIFIED_REASONS.has(String(reason || "").trim());
}

type RevenueCatSubscriberSnapshot = {
  entitlements: Record<string, any>;
  subscriptions: Record<string, any>;
};

function parseSubscriberSnapshot(data: any): RevenueCatSubscriberSnapshot {
  return {
    entitlements: data?.subscriber?.entitlements || {},
    subscriptions: data?.subscriber?.subscriptions || {},
  };
}

function resolvePremiumFromEntitlements(entitlements: Record<string, any>): {
  detectedEntitlement: string | null;
  entitlement: any | null;
  active: boolean;
} {
  let detectedEntitlement: string | null = null;
  let entitlement: any = null;

  for (const id of CHURCH_PREMIUM_ENTITLEMENT_IDS) {
    const candidate = entitlements[id];
    if (!candidate) continue;
    if (entitlementIsActive(candidate.expires_date)) {
      return {
        detectedEntitlement: id,
        entitlement: candidate,
        active: true,
      };
    }
    if (!entitlement) {
      detectedEntitlement = id;
      entitlement = candidate;
    }
  }

  return {
    detectedEntitlement,
    entitlement,
    active: Boolean(entitlement && entitlementIsActive(entitlement.expires_date)),
  };
}

function resolvePremiumFromSubscriptions(subscriptions: Record<string, any>): {
  productId: string | null;
  subscription: any | null;
  active: boolean;
} {
  for (const productId of CHURCH_PREMIUM_PRODUCT_IDS) {
    const candidate = subscriptions[productId];
    if (!candidate) continue;
    if (entitlementIsActive(candidate.expires_date)) {
      return {
        productId,
        subscription: candidate,
        active: true,
      };
    }
  }

  return { productId: null, subscription: null, active: false };
}

async function fetchRevenueCatSubscriber(
  uid: string,
  secret: string,
  lane: RevenueCatFetchLane = "production"
): Promise<{ ok: true; data: any; lane: RevenueCatFetchLane } | { ok: false; reason: string; lane: RevenueCatFetchLane }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    };
    // Xcode / StoreKit Configuration purchases are sandbox-only in the REST API
    // unless X-Is-Sandbox is set. Without this header, activation always fails
    // with no-entitlement while the mobile SDK still shows Premium active.
    if (lane === "sandbox") {
      headers["X-Is-Sandbox"] = "true";
      headers["X-Platform"] = "ios";
    }

    const url = `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(uid)}`;
    console.log("KRISTO_REVENUECAT_FETCH_START", {
      lane,
      churchId: uid,
      url,
      requestXIsSandbox: headers["X-Is-Sandbox"] ?? null,
      requestXPlatform: headers["X-Platform"] ?? null,
      sandboxHeadersSent: lane === "sandbox",
    });

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.log("KRISTO_REVENUECAT_FETCH_HTTP_ERROR", {
        lane,
        churchId: uid,
        httpStatus: res.status,
        requestXIsSandbox: headers["X-Is-Sandbox"] ?? null,
        requestXPlatform: headers["X-Platform"] ?? null,
        entitlementKeys: Object.keys(data?.subscriber?.entitlements || {}),
        subscriptionKeys: Object.keys(data?.subscriber?.subscriptions || {}),
        subscriberId:
          String(data?.subscriber?.original_app_user_id || data?.subscriber?.app_user_id || "").trim() ||
          null,
        revenueCatMessage: typeof data?.message === "string" ? data.message : null,
      });
      return { ok: false, reason: `revenuecat-http-${res.status}`, lane };
    }

    logRevenueCatSubscriberResponse({
      lane,
      httpStatus: res.status,
      data,
      requestHeaders: headers,
    });
    return { ok: true, data, lane };
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "timeout" : "fetch-error";
    console.error("KRISTO_REVENUECAT_VERIFY_FAILED", {
      reason,
      lane,
      churchId: uid,
      requestXIsSandbox: lane === "sandbox" ? "true" : null,
      requestXPlatform: lane === "sandbox" ? "ios" : null,
      error: String(error?.message || error || "unknown"),
    });
    return { ok: false, reason, lane };
  } finally {
    clearTimeout(timer);
  }
}

function subscriptionLooksSandbox(subscription: any): boolean {
  return subscription?.is_sandbox === true;
}

function verifySubscriberSnapshot(
  uid: string,
  snapshot: RevenueCatSubscriberSnapshot,
  lane: RevenueCatFetchLane
): ChurchPremiumVerification {
  const activeEntitlementKeys = Object.keys(snapshot.entitlements);
  const activeSubscriptionKeys = Object.keys(snapshot.subscriptions);
  const entitlementMatch = resolvePremiumFromEntitlements(snapshot.entitlements);

  console.log("KRISTO_ENTITLEMENT_AUDIT", {
    source: "server-verifyChurchPremiumEntitlement",
    revenueCatLane: lane,
    activeEntitlementKeys,
    activeSubscriptionKeys,
    detectedEntitlement: entitlementMatch.detectedEntitlement,
    hasPremiumEntitlement: entitlementMatch.active,
    currentChurchId: uid,
  });

  if (entitlementMatch.entitlement) {
    const expiresAtRaw = entitlementMatch.entitlement.expires_date;
    const expiresAt =
      expiresAtRaw === null || expiresAtRaw === undefined
        ? null
        : String(expiresAtRaw).trim() || null;
    const productId = String(entitlementMatch.entitlement.product_identifier || "").trim() || null;
    const sandboxPurchase = lane === "sandbox";

    if (!entitlementMatch.active) {
      return {
        active: false,
        plan: planFromProductId(productId),
        productId,
        reason: "expired",
        bypassed: false,
        expiresAt,
        sandboxPurchase,
        revenueCatLane: lane,
      };
    }

    return {
      active: true,
      plan: planFromProductId(productId),
      productId,
      reason: "verified",
      bypassed: false,
      expiresAt,
      sandboxPurchase,
      revenueCatLane: lane,
    };
  }

  const subscriptionMatch = resolvePremiumFromSubscriptions(snapshot.subscriptions);
  if (subscriptionMatch.active && subscriptionMatch.productId) {
    const expiresAtRaw = subscriptionMatch.subscription?.expires_date;
    const expiresAt =
      expiresAtRaw === null || expiresAtRaw === undefined
        ? null
        : String(expiresAtRaw).trim() || null;
    const sandboxPurchase =
      lane === "sandbox" || subscriptionLooksSandbox(subscriptionMatch.subscription);

    console.log("KRISTO_ENTITLEMENT_AUDIT", {
      source: "server-verifyChurchPremiumEntitlement:subscription-fallback",
      revenueCatLane: lane,
      activeSubscriptionKeys,
      productId: subscriptionMatch.productId,
      sandboxPurchase,
      currentChurchId: uid,
    });

    return {
      active: true,
      plan: planFromProductId(subscriptionMatch.productId),
      productId: subscriptionMatch.productId,
      reason: "verified-subscription",
      bypassed: false,
      expiresAt,
      sandboxPurchase,
      revenueCatLane: lane,
    };
  }

  return {
    active: false,
    plan: null,
    productId: null,
    reason: "no-entitlement",
    bypassed: false,
    expiresAt: null,
    revenueCatLane: lane,
  };
}

async function verifyRevenueCatLane(
  uid: string,
  secret: string,
  lane: RevenueCatFetchLane
): Promise<ChurchPremiumVerification | { fetchFailed: true; reason: string; lane: RevenueCatFetchLane }> {
  const fetched = await fetchRevenueCatSubscriber(uid, secret, lane);
  if (!fetched.ok) {
    console.log("KRISTO_REVENUECAT_LANE_FETCH_FAILED", {
      lane,
      churchId: uid,
      reason: fetched.reason,
      requestXIsSandbox: lane === "sandbox" ? "true" : null,
      requestXPlatform: lane === "sandbox" ? "ios" : null,
    });
    return { fetchFailed: true, reason: fetched.reason, lane };
  }

  return verifySubscriberSnapshot(uid, parseSubscriberSnapshot(fetched.data), lane);
}

/**
 * Verify the given RevenueCat app user id has an active church premium
 * entitlement (`church_premium` or legacy `Premium`). For church premium, `appUserId` is the Kristo churchId (the app
 * calls `Purchases.logIn(churchId)`), so the server looks the subscriber up by church.
 */
export async function verifyChurchPremiumEntitlement(
  appUserId: string,
  opts?: { forActivation?: boolean }
): Promise<ChurchPremiumVerification> {
  const uid = String(appUserId || "").trim();
  const forActivation = opts?.forActivation !== false;

  // Activation and entitlement checks used to activate/deactivate subscriptions always
  // require a real RevenueCat lookup — server bypass must never block or fake activation.
  if (!forActivation && isSubscriptionVerificationBypassed()) {
    console.warn("KRISTO_SUBSCRIPTION_BYPASS_ENABLED", {
      kristoSubscriptionBypass: process.env.KRISTO_SUBSCRIPTION_BYPASS ?? null,
      nodeEnv: process.env.NODE_ENV,
      forActivation,
      note: "Read-only entitlement check bypassed; activation paths always verify RevenueCat.",
    });
    return {
      active: true,
      plan: null,
      productId: null,
      reason: "bypass",
      bypassed: true,
      expiresAt: null,
    };
  }

  if (!uid) {
    return {
      active: false,
      plan: null,
      productId: null,
      reason: "missing-app-user-id",
      bypassed: false,
      expiresAt: null,
    };
  }

  const secret = getSecretKey();
  if (!secret) {
    console.error("KRISTO_REVENUECAT_SECRET_MISSING", {
      note: "Set REVENUECAT_SECRET_API_KEY in the production environment.",
    });
    return { active: false, plan: null, productId: null, reason: "no-secret", bypassed: false, expiresAt: null };
  }

  logRevenueCatServerKeyAudit();

  const maxAttempts = forActivation ? ACTIVATION_VERIFY_MAX_ATTEMPTS : 1;
  const lanes: RevenueCatFetchLane[] = forActivation ? ["production", "sandbox"] : ["production"];
  let lastVerification: ChurchPremiumVerification = {
    active: false,
    plan: null,
    productId: null,
    reason: "no-entitlement",
    bypassed: false,
    expiresAt: null,
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const lane of lanes) {
      const result = await verifyRevenueCatLane(uid, secret, lane);
      if ("fetchFailed" in result) {
        if (lane === "production") {
          return {
            active: false,
            plan: null,
            productId: null,
            reason: result.reason,
            bypassed: false,
            expiresAt: null,
            revenueCatLane: lane,
          };
        }
        console.log("KRISTO_REVENUECAT_SANDBOX_LANE_SKIPPED", {
          churchId: uid,
          attempt,
          reason: result.reason,
          note: "Sandbox fetch failed; continuing with next retry attempt.",
        });
        continue;
      }

      lastVerification = result;
      if (result.active) {
        console.log("KRISTO_REVENUECAT_VERIFY_OK", {
          churchId: uid,
          lane,
          attempt,
          reason: result.reason,
          productId: result.productId,
          sandboxPurchase: result.sandboxPurchase === true,
        });
        return result;
      }

      if (result.reason !== "no-entitlement") {
        return result;
      }
    }

    if (attempt < maxAttempts - 1) {
      console.log("KRISTO_REVENUECAT_VERIFY_RETRY", {
        churchId: uid,
        attempt,
        lanes,
        reason: lastVerification.reason,
        delayMs: ACTIVATION_VERIFY_RETRY_MS,
      });
      await sleepMs(ACTIVATION_VERIFY_RETRY_MS);
      continue;
    }

    console.log("KRISTO_REVENUECAT_VERIFY_NO_ENTITLEMENT", {
      churchId: uid,
      attempt,
      maxAttempts,
      lanes,
      revenueCatLane: lastVerification.revenueCatLane ?? null,
      sandboxLaneAttempted: lanes.includes("sandbox"),
    });
  }

  return lastVerification;
}
