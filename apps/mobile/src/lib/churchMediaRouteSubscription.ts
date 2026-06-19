import type { CustomerInfo } from "react-native-purchases";
import { getSessionSync } from "@/lib/kristoSession";
import { getPaymentsState } from "@/store/paymentsStore";
import {
  hasPremiumEntitlement,
  isPlanActive,
} from "@/lib/payments/mobileSubscriptions";

export type ChurchSubscriptionRecord = {
  subscriptionActive?: boolean;
  subscriptionPlan?: string;
  subscriptionUpdatedAt?: number;
  subscriptionStatus?: string;
  premiumTrialUsedAt?: number;
  subscriptionSource?: "app_store" | "stripe";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

export function isChurchSubscriptionActiveFromRecord(
  record: ChurchSubscriptionRecord | null | undefined,
  _opts?: { isPastor?: boolean; isApprovedMediaHost?: boolean; gate?: string }
): boolean {
  if (record?.subscriptionActive === true) return true;

  const status = String(record?.subscriptionStatus || "")
    .trim()
    .toLowerCase();

  return status === "active" || status === "trialing";
}

export function isChurchMediaRouteFailure(res: any | null | undefined): boolean {
  if (!res) return true;
  if (res.ok === false) return true;
  const status = Number(res.status || 0);
  if (status === 404 || status >= 500) return true;
  if (String(res.reason || "").trim() === "network_error") return true;
  return false;
}

export function parseExplicitServerSubscriptionFromMediaRoute(
  res: any | null | undefined
): boolean | null {
  if (isChurchMediaRouteFailure(res)) return null;

  if (isChurchSubscriptionActiveFromRecord(res?.media) || res?.subscriptionActive === true) {
    return true;
  }

  if (res?.subscriptionActive === false || res?.media?.subscriptionActive === false) {
    const status = String(res?.media?.subscriptionStatus || res?.subscriptionStatus || "")
      .trim()
      .toLowerCase();
    if (status === "active" || status === "trialing") return true;
    return false;
  }

  return null;
}

export function readLocalScheduleEntitlementActive(
  customerInfo?: CustomerInfo | null
): boolean {
  if (customerInfo && hasPremiumEntitlement(customerInfo)) return true;

  const payments = getPaymentsState();
  return isPlanActive(
    payments.subscriptions.selectedPlan,
    payments.subscriptions.planStatus
  );
}

export function readSessionMediaProfileSubscriptionActive(): boolean | null {
  const session = getSessionSync() as any;
  const profile = session?.mediaProfile;
  if (!profile || typeof profile !== "object") return null;
  if (profile.subscriptionActive === true) return true;
  if (profile.subscriptionActive === false) {
    const status = String(profile.subscriptionStatus || "")
      .trim()
      .toLowerCase();
    if (status === "active" || status === "trialing") return true;
    return false;
  }
  const status = String(profile.subscriptionStatus || "")
    .trim()
    .toLowerCase();
  if (status === "active" || status === "trialing") return true;
  return null;
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

export function mergeScheduleSubscriptionSignals(input: {
  explicitServerActive: boolean | null;
  routeFailed: boolean;
  entitlementActive: boolean;
  sessionProfileActive?: boolean | null;
}): Pick<
  ScheduleSubscriptionResolution,
  "churchSubscriptionActive" | "hasSubscription" | "source"
> {
  const sessionProfileActive = input.sessionProfileActive ?? readSessionMediaProfileSubscriptionActive();

  if (input.explicitServerActive === true) {
    return {
      churchSubscriptionActive: true,
      hasSubscription: true,
      source: "server_media_api",
    };
  }

  if (input.explicitServerActive === false && !input.entitlementActive && sessionProfileActive !== true) {
    return {
      churchSubscriptionActive: false,
      hasSubscription: false,
      source: "server_media_api",
    };
  }

  if (input.entitlementActive) {
    return {
      churchSubscriptionActive: true,
      hasSubscription: true,
      source: input.routeFailed ? "revenuecat_entitlement_route_failed" : "revenuecat_entitlement",
    };
  }

  if (sessionProfileActive === true) {
    return {
      churchSubscriptionActive: true,
      hasSubscription: true,
      source: input.routeFailed ? "session_media_profile_route_failed" : "session_media_profile",
    };
  }

  if (input.routeFailed || input.explicitServerActive === null) {
    return {
      churchSubscriptionActive: null,
      hasSubscription: null,
      source: input.routeFailed ? "route_failed_unknown" : "server_unknown",
    };
  }

  return {
    churchSubscriptionActive: false,
    hasSubscription: false,
    source: "server_media_api",
  };
}
