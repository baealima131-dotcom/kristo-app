import { getChurchMediaByChurchId, type ChurchMediaProfile } from "@/app/api/_lib/store/mediaDb";
import {
  resolveSubscriptionOwnershipLockForChurch,
  type SubscriptionOwnershipLockApiPayload,
} from "@/app/api/_lib/subscriptionOwnershipLock";
import { verifyChurchPremiumEntitlement } from "@/app/api/_lib/revenuecat";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";

export type ChurchDeleteSubscriptionBlockReason =
  | "none"
  | "active_will_renew"
  | "cancelled_until_expiry"
  | "active_store_subscription";

export type ChurchDeleteSubscriptionGuardResult = {
  blocked: boolean;
  blockReason: ChurchDeleteSubscriptionBlockReason;
  requiresCancellationWarning: boolean;
  willRenew: boolean | null;
  serverSubscriptionActive: boolean;
  subscriptionExpiresAt: number | null;
  store: "app_store" | "play_store" | null;
};

export function churchHasDeleteBlockingStoreSubscription(args: {
  media: ChurchMediaProfile | null;
  lock: SubscriptionOwnershipLockApiPayload | null;
}): boolean {
  const media = args.media;
  if (
    media &&
    isChurchSubscriptionActiveFromRecord(media) &&
    media.subscriptionSource === "app_store"
  ) {
    return true;
  }

  const lock = args.lock;
  if (!lock || lock.status !== "active") return false;
  if (lock.isLockHolder !== true) return false;
  return lock.store === "app_store" || lock.store === "play_store";
}

export function isChurchSubscriptionPeriodEnded(args: {
  media: ChurchMediaProfile | null;
  lock: SubscriptionOwnershipLockApiPayload | null;
}): boolean {
  const media = args.media;
  const lock = args.lock;

  if (!media || !isChurchSubscriptionActiveFromRecord(media)) {
    if (!lock || lock.status !== "active") return true;
  }

  const now = Date.now();
  const expiresAt =
    media?.subscriptionExpiresAt ??
    lock?.expiresAt ??
    null;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && now >= expiresAt) {
    return true;
  }

  return false;
}

export function evaluateChurchDeleteSubscriptionGuard(args: {
  hasBlockingStoreSubscription: boolean;
  subscriptionPeriodEnded: boolean;
  willRenew: boolean | null;
}): Pick<
  ChurchDeleteSubscriptionGuardResult,
  "blocked" | "blockReason" | "requiresCancellationWarning"
> {
  if (!args.hasBlockingStoreSubscription) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }

  if (args.subscriptionPeriodEnded) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }

  if (args.willRenew === true) {
    return {
      blocked: true,
      blockReason: "active_will_renew",
      requiresCancellationWarning: false,
    };
  }

  if (args.willRenew === false) {
    return {
      blocked: false,
      blockReason: "cancelled_until_expiry",
      requiresCancellationWarning: true,
    };
  }

  return {
    blocked: true,
    blockReason: "active_store_subscription",
    requiresCancellationWarning: false,
  };
}

export async function resolveWillRenewForChurchDelete(args: {
  churchId: string;
  lock: SubscriptionOwnershipLockApiPayload | null;
  hasBlockingStoreSubscription: boolean;
  subscriptionPeriodEnded: boolean;
}): Promise<boolean | null> {
  const lockWillRenew = args.lock?.willRenew ?? null;
  if (lockWillRenew === true || lockWillRenew === false) return lockWillRenew;
  if (!args.hasBlockingStoreSubscription || args.subscriptionPeriodEnded) return null;

  try {
    const verification = await verifyChurchPremiumEntitlement(args.churchId, {
      forActivation: false,
    });
    if (verification.willRenew === true || verification.willRenew === false) {
      return verification.willRenew;
    }
  } catch {
    // fail closed below when willRenew stays unknown
  }

  return null;
}

function resolveStoreForChurchDelete(args: {
  media: ChurchMediaProfile | null;
  lock: SubscriptionOwnershipLockApiPayload | null;
}): "app_store" | "play_store" | null {
  if (args.media?.subscriptionSource === "app_store") {
    return args.lock?.store === "play_store" ? "play_store" : "app_store";
  }

  const lockStore = args.lock?.store;
  if (lockStore === "app_store" || lockStore === "play_store") {
    return lockStore;
  }

  return null;
}

/** Server-side guard for pastor church deletion (membership leave). */
export async function evaluateChurchDeleteSubscriptionGuardForPastor(args: {
  ownerUserId: string;
  churchId: string;
}): Promise<ChurchDeleteSubscriptionGuardResult> {
  const churchId = String(args.churchId || "").trim();
  const ownerUserId = String(args.ownerUserId || "").trim();

  if (!churchId || !ownerUserId) {
    return {
      blocked: false,
      blockReason: "none",
      requiresCancellationWarning: false,
      willRenew: null,
      serverSubscriptionActive: false,
      subscriptionExpiresAt: null,
      store: null,
    };
  }

  const media = await getChurchMediaByChurchId(churchId);
  const { payload: lock } = await resolveSubscriptionOwnershipLockForChurch({
    churchId,
    ownerUserId,
    media,
  });

  const hasBlockingStoreSubscription = churchHasDeleteBlockingStoreSubscription({ media, lock });
  const subscriptionPeriodEnded = isChurchSubscriptionPeriodEnded({ media, lock });
  const willRenew = await resolveWillRenewForChurchDelete({
    churchId,
    lock,
    hasBlockingStoreSubscription,
    subscriptionPeriodEnded,
  });

  const evaluation = evaluateChurchDeleteSubscriptionGuard({
    hasBlockingStoreSubscription,
    subscriptionPeriodEnded,
    willRenew,
  });

  const result: ChurchDeleteSubscriptionGuardResult = {
    blocked: evaluation.blocked,
    blockReason: evaluation.blockReason,
    requiresCancellationWarning: evaluation.requiresCancellationWarning,
    willRenew,
    serverSubscriptionActive: Boolean(media && isChurchSubscriptionActiveFromRecord(media)),
    subscriptionExpiresAt: media?.subscriptionExpiresAt ?? lock?.expiresAt ?? null,
    store: hasBlockingStoreSubscription
      ? resolveStoreForChurchDelete({ media, lock })
      : null,
  };

  console.log("KRISTO_CHURCH_DELETE_SUBSCRIPTION_GUARD_SERVER", {
    churchId,
    ownerUserId,
    blocked: result.blocked,
    blockReason: result.blockReason,
    requiresCancellationWarning: result.requiresCancellationWarning,
    willRenew: result.willRenew,
    serverSubscriptionActive: result.serverSubscriptionActive,
    subscriptionExpiresAt: result.subscriptionExpiresAt,
    store: result.store,
  });

  return result;
}
