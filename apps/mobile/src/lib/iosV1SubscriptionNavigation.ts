/**
 * Safe navigation helpers for Church Subscription screens.
 * On iOS V1 free, never open paywall / payments / checkout routes.
 */
import type { Router } from "expo-router";
import { shouldHideIosSubscriptionUi } from "@/src/lib/iosV1MonetizationPolicy";

export const CHURCH_SUBSCRIPTIONS_HREF = "/more/payments/subscriptions";
export const CHURCH_PAYMENTS_HREF = "/more/payments";
export const CHURCH_CHECKOUT_HREF = "/more/payments/checkout";

export function isChurchSubscriptionRoute(pathname: string | null | undefined): boolean {
  const path = String(pathname || "").trim();
  if (!path) return false;
  return (
    path.includes("/more/payments/subscriptions") ||
    path.includes("/more/payments/checkout") ||
    path === "/more/payments" ||
    path.endsWith("/payments")
  );
}

/**
 * Open the Church Subscription screen on Android only.
 * iOS V1 free: no-op (optionally send Pastor to Media instead).
 */
export function openChurchSubscriptionScreen(
  router: Pick<Router, "push" | "replace">,
  opts?: { replace?: boolean; fallbackHref?: string }
): boolean {
  if (shouldHideIosSubscriptionUi()) {
    const fallback = String(opts?.fallbackHref || "").trim();
    if (fallback) {
      if (opts?.replace) router.replace(fallback as never);
      else router.push(fallback as never);
    }
    return false;
  }
  if (opts?.replace) router.replace(CHURCH_SUBSCRIPTIONS_HREF as never);
  else router.push(CHURCH_SUBSCRIPTIONS_HREF as never);
  return true;
}
