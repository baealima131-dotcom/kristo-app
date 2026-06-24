import {
  emitChurchPremiumAccessChanged,
  type ChurchPremiumAccessChangedPayload,
} from "@/src/lib/kristoProfileEvents";
import { clearChurchPremiumResourceRefreshCaches } from "@/src/lib/churchResourceRefresh";
import {
  applyImmediateChurchPremiumMediaAccessUnlock,
  clearCoordinatedRefreshLanesForChurch,
  refreshChurchFeatureBundle,
} from "@/src/lib/refreshCoordinator";
import { invalidateChurchProfileCaches } from "@/src/lib/screenDataCache";

const seededByChurch = new Map<string, ChurchPremiumAccessChangedPayload>();

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

/** Broadcast premium unlock to all listeners and warm caches without waiting for app restart. */
export function announceChurchPremiumAccessUnlocked(args: {
  churchId: string;
  userId: string;
  role?: string;
  churchRole?: string;
  headers?: Record<string, string>;
  subscriptionPlan?: "monthly" | "yearly" | null;
  subscriptionActive?: boolean;
  canUseMediaTools?: boolean;
  source?: string;
}) {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!churchId || !userId) return;

  const subscriptionActive = args.subscriptionActive !== false;
  const canUseMediaTools = args.canUseMediaTools !== false;

  clearChurchPremiumResourceRefreshCaches(churchId, userId);
  clearCoordinatedRefreshLanesForChurch(churchId, userId);

  applyImmediateChurchPremiumMediaAccessUnlock({
    churchId,
    userId,
    role: args.role,
    churchRole: args.churchRole,
    subscriptionActive,
    canUseMediaTools,
  });

  const payload: ChurchPremiumAccessChangedPayload = {
    churchId,
    userId,
    subscriptionActive,
    backendSubscriptionActive: true,
    canUseMediaTools,
    subscriptionPlan: args.subscriptionPlan ?? null,
    updatedAt: Date.now(),
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
}
