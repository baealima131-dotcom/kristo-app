import {
  emitChurchPremiumAccessChanged,
  type ChurchPremiumAccessChangedPayload,
} from "@/src/lib/kristoProfileEvents";
import { clearChurchPremiumResourceRefreshCaches } from "@/src/lib/churchResourceRefresh";
import {
  applyImmediateChurchPremiumMediaAccessUnlock,
  applyImmediateChurchPremiumMediaAccessRevoke,
  clearCoordinatedRefreshLanesForChurch,
  refreshChurchFeatureBundle,
} from "@/src/lib/refreshCoordinator";
import { invalidateChurchProfileCaches } from "@/src/lib/screenDataCache";

const seededByChurch = new Map<string, ChurchPremiumAccessChangedPayload & { activatedAt?: number }>();

/** Grace window where a lagging inactive media GET must not revoke a just-persisted activation. */
export const PREMIUM_UNLOCK_REVOKE_GRACE_MS = 20_000;

export function churchIdsMatch(a: string, b: string) {
  return String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
}

function normalizeChurchId(churchId: string) {
  return String(churchId || "").trim().toUpperCase();
}

export function getSeededChurchPremiumAccess(
  churchId: string
): ChurchPremiumAccessChangedPayload | null {
  return seededByChurch.get(normalizeChurchId(churchId)) ?? null;
}

export function clearSeededChurchPremiumAccess(churchId: string) {
  seededByChurch.delete(normalizeChurchId(churchId));
}

/**
 * Broadcast premium unlock only after backend persisted church activation.
 * Callers must pass persistedChurchActivation=true from a successful activate response.
 * Never unlock from RevenueCat entitlement, purchase success, or optimistic UI alone.
 */
export function announceChurchPremiumAccessUnlocked(args: {
  churchId: string;
  userId: string;
  role?: string;
  churchRole?: string;
  headers?: Record<string, string>;
  subscriptionPlan?: "monthly" | "yearly" | null;
  subscriptionActive?: boolean;
  backendSubscriptionActive?: boolean;
  canUseMediaTools?: boolean;
  /** Required: true only when PATCH activate_church_subscription persisted active. */
  persistedChurchActivation: boolean;
  source?: string;
}): boolean {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!churchId || !userId) return false;
  if (args.persistedChurchActivation !== true) return false;

  clearChurchPremiumResourceRefreshCaches(churchId, userId);
  clearCoordinatedRefreshLanesForChurch(churchId, userId);

  applyImmediateChurchPremiumMediaAccessUnlock({
    churchId,
    userId,
    role: args.role,
    churchRole: args.churchRole,
    subscriptionActive: true,
    canUseMediaTools: true,
  });

  const payload: ChurchPremiumAccessChangedPayload & { activatedAt?: number } = {
    churchId,
    userId,
    subscriptionActive: true,
    backendSubscriptionActive: true,
    canUseMediaTools: true,
    subscriptionPlan: args.subscriptionPlan ?? null,
    updatedAt: Date.now(),
    activatedAt: Date.now(),
  };

  seededByChurch.set(normalizeChurchId(churchId), payload);
  emitChurchPremiumAccessChanged(payload);

  void invalidateChurchProfileCaches(churchId, {
    userId,
    source: args.source || "subscription-purchase-activated",
  });

  void refreshChurchFeatureBundle({
    churchId,
    userId,
    role: args.role,
    churchRole: args.churchRole,
    headers: args.headers,
    force: true,
    lanes: ["overview", "mediaAccess", "ministries"],
    source: args.source || "subscription-purchase-activated",
  });

  return true;
}

/**
 * Reconcile local optimistic Premium against an authoritative backend status.
 * Revokes temporary unlock when the server reports inactive (after grace).
 */
export function reconcileChurchPremiumAccessFromServer(args: {
  churchId: string;
  userId?: string;
  role?: string;
  churchRole?: string;
  serverSubscriptionActive: boolean | null;
  canUseMediaTools?: boolean | null;
  routeFailed?: boolean;
  source?: string;
}): "unlocked" | "revoked" | "unchanged" | "ignored" {
  const churchId = String(args.churchId || "").trim();
  if (!churchId) return "ignored";
  if (args.routeFailed === true) return "ignored";
  if (args.serverSubscriptionActive == null) return "ignored";

  const key = normalizeChurchId(churchId);
  const seed = seededByChurch.get(key);

  if (args.serverSubscriptionActive === true) {
    if (seed?.subscriptionActive === true) return "unchanged";
    return "unchanged";
  }

  // Server inactive.
  if (seed?.subscriptionActive === true && seed.activatedAt) {
    const age = Date.now() - Number(seed.activatedAt || 0);
    if (age < PREMIUM_UNLOCK_REVOKE_GRACE_MS) {
      return "ignored";
    }
  }

  if (seed?.subscriptionActive !== true && args.serverSubscriptionActive === false) {
    // Still emit revoke so screens that unlocked from a prior event clear.
  }

  return announceChurchPremiumAccessRevoked({
    churchId,
    userId: args.userId,
    role: args.role,
    churchRole: args.churchRole,
    source: args.source || "server-status-inactive",
  });
}

/** Clear temporary local Premium for a church after authoritative backend inactive. */
export function announceChurchPremiumAccessRevoked(args: {
  churchId: string;
  userId?: string;
  role?: string;
  churchRole?: string;
  source?: string;
}): "revoked" | "unchanged" {
  const churchId = String(args.churchId || "").trim();
  if (!churchId) return "unchanged";

  const key = normalizeChurchId(churchId);
  const hadSeed = seededByChurch.has(key);
  clearSeededChurchPremiumAccess(churchId);

  if (args.userId) {
    clearChurchPremiumResourceRefreshCaches(churchId, args.userId);
    clearCoordinatedRefreshLanesForChurch(churchId, args.userId);
    applyImmediateChurchPremiumMediaAccessRevoke({
      churchId,
      userId: args.userId,
      role: args.role,
      churchRole: args.churchRole,
    });
  }

  const payload: ChurchPremiumAccessChangedPayload = {
    churchId,
    userId: args.userId,
    subscriptionActive: false,
    backendSubscriptionActive: false,
    canUseMediaTools: false,
    subscriptionPlan: null,
    updatedAt: Date.now(),
  };
  emitChurchPremiumAccessChanged(payload);

  if (args.userId) {
    void invalidateChurchProfileCaches(churchId, {
      userId: args.userId,
      source: args.source || "server-status-inactive",
    });
  }

  return hadSeed ? "revoked" : "unchanged";
}
