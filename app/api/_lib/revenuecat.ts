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

export type SubscriptionPlan = "monthly" | "yearly";

export type ChurchPremiumVerification = {
  active: boolean;
  plan: SubscriptionPlan | null;
  productId: string | null;
  reason: string;
  bypassed: boolean;
  /** ISO timestamp from RevenueCat entitlement, null for lifetime / unknown. */
  expiresAt: string | null;
};

function getSecretKey(): string {
  return String(process.env.REVENUECAT_SECRET_API_KEY || "").trim();
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(uid)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      // 404 => RevenueCat has no record of this subscriber (never purchased).
      return {
        active: false,
        plan: null,
        productId: null,
        reason: `revenuecat-http-${res.status}`,
        bypassed: false,
        expiresAt: null,
      };
    }

    const data: any = await res.json().catch(() => ({}));
    const entitlements = data?.subscriber?.entitlements || {};
    const activeEntitlementKeys = Object.keys(entitlements);

    let detectedEntitlement: string | null = null;
    let entitlement: any = null;
    for (const id of CHURCH_PREMIUM_ENTITLEMENT_IDS) {
      const candidate = entitlements[id];
      if (!candidate) continue;
      if (entitlementIsActive(candidate.expires_date)) {
        detectedEntitlement = id;
        entitlement = candidate;
        break;
      }
      if (!entitlement) {
        detectedEntitlement = id;
        entitlement = candidate;
      }
    }

    console.log("KRISTO_ENTITLEMENT_AUDIT", {
      source: "server-verifyChurchPremiumEntitlement",
      activeEntitlementKeys,
      detectedEntitlement,
      hasPremiumEntitlement: Boolean(detectedEntitlement && entitlementIsActive(entitlement?.expires_date)),
      currentChurchId: uid,
    });

    if (!entitlement) {
      return {
        active: false,
        plan: null,
        productId: null,
        reason: "no-entitlement",
        bypassed: false,
        expiresAt: null,
      };
    }

    const expiresAtRaw = entitlement.expires_date;
    const expiresAt =
      expiresAtRaw === null || expiresAtRaw === undefined
        ? null
        : String(expiresAtRaw).trim() || null;

    const active = entitlementIsActive(expiresAtRaw);
    const productId = String(entitlement.product_identifier || "").trim() || null;

    if (!active) {
      return {
        active: false,
        plan: planFromProductId(productId),
        productId,
        reason: "expired",
        bypassed: false,
        expiresAt,
      };
    }

    return {
      active: true,
      plan: planFromProductId(productId),
      productId,
      reason: "verified",
      bypassed: false,
      expiresAt,
    };
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "timeout" : "fetch-error";
    console.error("KRISTO_REVENUECAT_VERIFY_FAILED", {
      reason,
      error: String(error?.message || error || "unknown"),
    });
    return { active: false, plan: null, productId: null, reason, bypassed: false, expiresAt: null };
  } finally {
    clearTimeout(timer);
  }
}
