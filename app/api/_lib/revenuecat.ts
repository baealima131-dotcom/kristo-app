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

export const CHURCH_PREMIUM_ENTITLEMENT = "Premium";
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
  /** ISO timestamp from RevenueCat entitlement, null for lifetime / unknown. */
  expiresAt: string | null;
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
 * entitlement. For church premium, `appUserId` is the Kristo churchId (the app
 * calls `Purchases.logIn(churchId)`), so the server looks the subscriber up by church.
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
    const entitlement = data?.subscriber?.entitlements?.[CHURCH_PREMIUM_ENTITLEMENT];

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
