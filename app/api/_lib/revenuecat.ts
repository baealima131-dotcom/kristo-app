/**
 * V1 subscription hardening (launch-blocker item #2).
 *
 * Server-side verification of a user's RevenueCat `church_premium` entitlement
 * before we activate a church subscription. The mobile checkout flow performs a
 * client-side entitlement check, but the server must not trust it: previously
 * `PATCH /api/church/media` accepted `subscriptionActive: true` from the client
 * verbatim, so anyone with pastor identity could unlock premium for free.
 *
 * This calls the RevenueCat REST API (v1 subscribers endpoint) with a SERVER
 * secret key (`REVENUECAT_SECRET_API_KEY`) and confirms the entitlement is
 * present and not expired. No webhooks (that is a V2 concern).
 */

export const CHURCH_PREMIUM_ENTITLEMENT = "church_premium";
export const PREMIUM_MONTHLY_PRODUCT_ID = "premium_monthly";
export const PREMIUM_YEARLY_PRODUCT_ID = "premium_yearly";

const REVENUECAT_API_BASE = "https://api.revenuecat.com/v1";
const REQUEST_TIMEOUT_MS = 8000;

export type SubscriptionPlan = "monthly" | "yearly";

export type ChurchPremiumVerification = {
  active: boolean;
  plan: SubscriptionPlan | null;
  productId: string | null;
  reason: string;
  bypassed: boolean;
};

function getSecretKey(): string {
  return String(process.env.REVENUECAT_SECRET_API_KEY || "").trim();
}

/**
 * Server-controlled bypass ONLY. Never driven by a client header/flag.
 * - Non-production environments always bypass (local/dev/test).
 * - Production bypasses only when KRISTO_SUBSCRIPTION_BYPASS=1 is explicitly set.
 */
export function isSubscriptionVerificationBypassed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.KRISTO_SUBSCRIPTION_BYPASS === "1";
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
 * Verify the given RevenueCat app user id has an active `church_premium`
 * entitlement. `appUserId` is the Kristo user id (the app calls
 * `Purchases.logIn(userId)`), so the server can look the subscriber up directly.
 */
export async function verifyChurchPremiumEntitlement(
  appUserId: string
): Promise<ChurchPremiumVerification> {
  const uid = String(appUserId || "").trim();

  if (isSubscriptionVerificationBypassed()) {
    return {
      active: true,
      plan: null,
      productId: null,
      reason: "bypass",
      bypassed: true,
    };
  }

  if (!uid) {
    return { active: false, plan: null, productId: null, reason: "missing-app-user-id", bypassed: false };
  }

  const secret = getSecretKey();
  if (!secret) {
    console.error("KRISTO_REVENUECAT_SECRET_MISSING", {
      note: "Set REVENUECAT_SECRET_API_KEY in the production environment.",
    });
    return { active: false, plan: null, productId: null, reason: "no-secret", bypassed: false };
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
      };
    }

    const data: any = await res.json().catch(() => ({}));
    const entitlement = data?.subscriber?.entitlements?.[CHURCH_PREMIUM_ENTITLEMENT];

    if (!entitlement) {
      return { active: false, plan: null, productId: null, reason: "no-entitlement", bypassed: false };
    }

    const active = entitlementIsActive(entitlement.expires_date);
    const productId = String(entitlement.product_identifier || "").trim() || null;

    if (!active) {
      return { active: false, plan: planFromProductId(productId), productId, reason: "expired", bypassed: false };
    }

    return {
      active: true,
      plan: planFromProductId(productId),
      productId,
      reason: "verified",
      bypassed: false,
    };
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "timeout" : "fetch-error";
    console.error("KRISTO_REVENUECAT_VERIFY_FAILED", {
      reason,
      error: String(error?.message || error || "unknown"),
    });
    return { active: false, plan: null, productId: null, reason, bypassed: false };
  } finally {
    clearTimeout(timer);
  }
}
