import type { CustomerInfo } from "react-native-purchases";
import { getSessionSync } from "./kristoSession";
import {
  getRevenueCatConfiguredAppUserId,
  hasPremiumEntitlement,
} from "./payments/mobileSubscriptions";

export type ChurchSubscriptionRecord = {
  subscriptionActive?: boolean;
  subscriptionPlan?: string;
  subscriptionUpdatedAt?: number;
  subscriptionStatus?: string;
  premiumTrialUsedAt?: number;
  subscriptionSource?: "app_store" | "stripe" | "offline_activation" | "backend_activation";
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

/** Parse subscription from a successful /api/church/media body only — never infer inactive from failures. */
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

/**
 * RevenueCat entitlement is church-scoped: only trust premium when RC is logged in for this churchId.
 * Never use global payments-store plan state here — that leaks across churches.
 */
export function readChurchScopedEntitlementActive(args: {
  churchId: string;
  customerInfo?: CustomerInfo | null;
  revenueCatAppUserId?: string | null;
}): boolean {
  const churchId = String(args.churchId || "").trim();
  if (!churchId) return false;

  const rcUser = String(
    args.revenueCatAppUserId ?? getRevenueCatConfiguredAppUserId() ?? ""
  ).trim();
  if (!rcUser || rcUser !== churchId) return false;

  return Boolean(args.customerInfo && hasPremiumEntitlement(args.customerInfo));
}

/** @deprecated Prefer readChurchScopedEntitlementActive — global entitlement leaks across churches. */
export function readLocalScheduleEntitlementActive(
  customerInfo?: CustomerInfo | null,
  churchId?: string
): boolean {
  const cid = String(churchId || "").trim();
  if (cid) {
    return readChurchScopedEntitlementActive({ churchId: cid, customerInfo });
  }
  return Boolean(customerInfo && hasPremiumEntitlement(customerInfo));
}

/**
 * Session mediaProfile subscription — only when profile belongs to the same churchId.
 * Missing churchId on profile → unknown (null), never active.
 */
export function readSessionMediaProfileSubscriptionActive(churchId?: string): boolean | null {
  const cid = String(churchId || "").trim();
  const session = getSessionSync() as any;
  const profile = session?.mediaProfile;
  if (!profile || typeof profile !== "object") return null;

  const profileChurchId = String(
    profile.churchId || profile.churchID || session?.churchId || session?.activeChurchId || ""
  ).trim();
  if (!profileChurchId) return null;
  if (cid && profileChurchId.toUpperCase() !== cid.toUpperCase()) return null;

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

export function mergeScheduleSubscriptionSignals(input: {
  churchId?: string;
  explicitServerActive: boolean | null;
  routeFailed: boolean;
  entitlementActive: boolean;
  revenueCatScopedToChurch?: boolean;
  sessionProfileActive?: boolean | null;
}): {
  churchSubscriptionActive: boolean | null;
  hasSubscription: boolean | null;
  source: string;
} {
  const sessionProfileActive =
    input.sessionProfileActive ??
    readSessionMediaProfileSubscriptionActive(input.churchId);

  // Server truth wins when explicitly active.
  if (input.explicitServerActive === true) {
    return {
      churchSubscriptionActive: true,
      hasSubscription: true,
      source: "server_media_api",
    };
  }

  // Server explicitly inactive — never override with RevenueCat or session profile.
  if (input.explicitServerActive === false) {
    return {
      churchSubscriptionActive: false,
      hasSubscription: false,
      source: "server_media_api",
    };
  }

  const rcTrusted = input.entitlementActive;

  if (rcTrusted) {
    return {
      churchSubscriptionActive: true,
      hasSubscription: true,
      source: input.routeFailed
        ? "revenuecat_entitlement_route_failed"
        : "revenuecat_entitlement_scoped",
    };
  }

  if (sessionProfileActive === true) {
    return {
      churchSubscriptionActive: true,
      hasSubscription: true,
      source: input.routeFailed
        ? "session_media_profile_route_failed"
        : "session_media_profile_scoped",
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

export type ChurchMediaSubscriptionSource =
  | "app_store"
  | "stripe"
  | "offline_activation"
  | "backend_activation";

export type ChurchMediaSubscriptionOwnershipLock = {
  blocked: boolean;
  isLockHolder: boolean;
  lockedChurchId: string | null;
  lockedChurchName: string | null;
  expiresAt: number | null;
  expiresAtLabel: string | null;
  platform: "ios" | "android" | null;
  store: "app_store" | "play_store" | null;
  status: "active" | "expired" | "released" | null;
  canPurchase: boolean;
  canActivate: boolean;
  message: string | null;
};

export function parseChurchMediaSubscriptionOwnershipLock(
  res: any | null | undefined
): ChurchMediaSubscriptionOwnershipLock | null {
  const raw = res?.subscriptionOwnershipLock;
  if (!raw || typeof raw !== "object") return null;

  const blocked = raw.blocked === true;
  const isLockHolder = raw.isLockHolder === true;
  const lockedChurchId = String(raw.lockedChurchId || "").trim() || null;
  const lockedChurchName = String(raw.lockedChurchName || "").trim() || null;
  const expiresAt =
    typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt) ? raw.expiresAt : null;
  const expiresAtLabel = String(raw.expiresAtLabel || "").trim() || null;
  const platform = raw.platform === "ios" || raw.platform === "android" ? raw.platform : null;
  const store =
    raw.store === "app_store" || raw.store === "play_store" ? raw.store : null;
  const status =
    raw.status === "active" || raw.status === "expired" || raw.status === "released"
      ? raw.status
      : null;
  const canPurchase = raw.canPurchase !== false;
  const canActivate = raw.canActivate !== false;
  const message = String(raw.message || "").trim() || null;

  if (
    !blocked &&
    !isLockHolder &&
    !lockedChurchId &&
    !lockedChurchName &&
    !message
  ) {
    return null;
  }

  return {
    blocked,
    isLockHolder,
    lockedChurchId,
    lockedChurchName,
    expiresAt,
    expiresAtLabel,
    platform,
    store,
    status,
    canPurchase,
    canActivate,
    message,
  };
}

export function isSubscriptionOwnershipLockBlockingPurchase(
  lock: ChurchMediaSubscriptionOwnershipLock | null | undefined
): boolean {
  return lock?.blocked === true && lock?.canPurchase === false;
}

export function isSubscriptionOwnershipLockBlockingActivation(
  lock: ChurchMediaSubscriptionOwnershipLock | null | undefined
): boolean {
  return lock?.blocked === true && lock?.canActivate === false;
}

export function isChurchMediaPremiumLockStatusKnown(
  status: { routeFailed?: boolean; lockStatusKnown?: boolean } | null | undefined
): boolean {
  if (!status) return false;
  if (status.routeFailed === true) return false;
  return status.lockStatusKnown === true;
}

/** Fail-closed: block purchase CTAs until server lock/subscription status is known. */
export function shouldFailClosedSubscriptionPurchase(args: {
  status: { routeFailed?: boolean; lockStatusKnown?: boolean } | null | undefined;
  packagesLoading?: boolean;
}): boolean {
  if (args.packagesLoading === true) return true;
  return !isChurchMediaPremiumLockStatusKnown(args.status);
}

export function parseChurchMediaSubscriptionSource(
  media: ChurchSubscriptionRecord | null | undefined,
  res?: { subscriptionSource?: unknown } | null
): ChurchMediaSubscriptionSource | null {
  const raw = String(media?.subscriptionSource ?? res?.subscriptionSource ?? "")
    .trim()
    .toLowerCase();
  if (raw === "offline_activation") return "offline_activation";
  if (raw === "backend_activation") return "backend_activation";
  if (raw === "app_store") return "app_store";
  if (raw === "stripe") return "stripe";
  return null;
}

/** True when premium is active on the server but not billed through the device app store. */
export function isBackendManagedMediaPremiumStatus(
  status: { serverSubscriptionActive?: boolean; subscriptionSource?: ChurchMediaSubscriptionSource | null } | null | undefined
): boolean {
  if (status?.serverSubscriptionActive !== true) return false;
  const source = status.subscriptionSource ?? null;
  return source === "backend_activation" || source === null;
}

/** True when `/api/church/media` reports active access from an offline activation code. */
export function isOfflineActivationFromMediaRouteResponse(res: any): boolean {
  if (parseExplicitServerSubscriptionFromMediaRoute(res) !== true) return false;
  return parseChurchMediaSubscriptionSource(res?.media, res) === "offline_activation";
}
