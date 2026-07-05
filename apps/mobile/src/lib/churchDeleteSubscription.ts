import { Platform } from "react-native";
import type { CustomerInfo } from "react-native-purchases";

import {
  churchHasManagedStoreSubscription,
  resolveStoreSubscriptionWillRenew,
} from "./accountDeleteSubscription";
import {
  fetchChurchMediaPremiumServerStatus,
  type ChurchMediaPremiumServerStatus,
} from "./churchSubscription";
import {
  configureChurchMobileSubscriptions,
  getCustomerSubscriptionInfo,
  hasActivePremiumProduct,
  hasPremiumEntitlement,
  openSubscriptionManagement,
  restoreSubscriptionPurchases,
} from "./payments/mobileSubscriptions";

export type ChurchDeleteSubscriptionBlockReason =
  | "none"
  | "active_will_renew"
  | "cancelled_until_expiry"
  | "active_store_subscription";

export type ChurchDeleteSubscriptionGuard = {
  status: ChurchMediaPremiumServerStatus;
  blocked: boolean;
  blockReason: ChurchDeleteSubscriptionBlockReason;
  requiresCancellationWarning: boolean;
  storeSubscriptionWillRenew: boolean | null;
  subscriptionChurchId: string | null;
  store: "app_store" | "play_store" | null;
  customerInfo: CustomerInfo | null;
};

export function churchHasDeleteBlockingStoreSubscription(
  status: ChurchMediaPremiumServerStatus
): boolean {
  if (churchHasManagedStoreSubscription(status)) return true;

  const lock = status.subscriptionOwnershipLock;
  return (
    status.serverSubscriptionActive === true &&
    lock?.status === "active" &&
    (lock.store === "app_store" || lock.store === "play_store")
  );
}

export function isChurchSubscriptionPeriodEnded(
  status: ChurchMediaPremiumServerStatus
): boolean {
  if (!status.serverSubscriptionActive) {
    const lock = status.subscriptionOwnershipLock;
    if (!lock || lock.status !== "active") return true;
  }

  const now = Date.now();
  const expiresAt = status.subscriptionExpiresAt;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && now >= expiresAt) {
    return true;
  }

  const lockExpiresAt = status.subscriptionOwnershipLock?.expiresAt;
  if (
    typeof lockExpiresAt === "number" &&
    Number.isFinite(lockExpiresAt) &&
    now >= lockExpiresAt
  ) {
    return true;
  }

  return false;
}

export function evaluateChurchDeleteSubscriptionGuard(args: {
  status: ChurchMediaPremiumServerStatus;
  storeSubscriptionWillRenew: boolean | null;
}): Pick<
  ChurchDeleteSubscriptionGuard,
  "blocked" | "blockReason" | "requiresCancellationWarning"
> {
  if (!churchHasDeleteBlockingStoreSubscription(args.status)) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }

  if (isChurchSubscriptionPeriodEnded(args.status)) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }

  if (args.storeSubscriptionWillRenew === true) {
    return {
      blocked: true,
      blockReason: "active_will_renew",
      requiresCancellationWarning: false,
    };
  }

  if (args.storeSubscriptionWillRenew === false) {
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

function resolveStoreForChurchDelete(
  status: ChurchMediaPremiumServerStatus
): "app_store" | "play_store" | null {
  if (status.subscriptionSource === "app_store") {
    return Platform.OS === "android" ? "play_store" : "app_store";
  }

  const lockStore = status.subscriptionOwnershipLock?.store;
  if (lockStore === "app_store" || lockStore === "play_store") {
    return lockStore;
  }

  return Platform.OS === "android" ? "play_store" : "app_store";
}

function hasActiveStoreSubscriptionOnDevice(
  customerInfo: CustomerInfo | null | undefined
): boolean {
  if (!customerInfo) return false;
  return hasPremiumEntitlement(customerInfo) || hasActivePremiumProduct(customerInfo);
}

async function refreshChurchDeleteCustomerInfo(
  churchId: string
): Promise<CustomerInfo | null> {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  try {
    await configureChurchMobileSubscriptions(cid, { syncPurchases: true });
  } catch {
    return null;
  }

  try {
    await restoreSubscriptionPurchases();
  } catch {
    try {
      return await getCustomerSubscriptionInfo();
    } catch {
      return null;
    }
  }

  try {
    return await getCustomerSubscriptionInfo();
  } catch {
    return null;
  }
}

export async function checkChurchDeleteSubscriptionGuard(args: {
  churchId: string;
  headers: Record<string, string>;
}): Promise<ChurchDeleteSubscriptionGuard> {
  const churchId = String(args.churchId || "").trim();

  if (!churchId) {
    const emptyStatus: ChurchMediaPremiumServerStatus = {
      churchId: "",
      serverSubscriptionActive: false,
      canUseMediaTools: null,
      isActualChurchPastor: null,
      subscriptionPlan: null,
      subscriptionExpiresAt: null,
      subscriptionSource: null,
      subscriptionOwnershipLock: null,
      lockStatusKnown: false,
      routeFailed: false,
      source: "server_media_api",
    };

    const evaluation = evaluateChurchDeleteSubscriptionGuard({
      status: emptyStatus,
      storeSubscriptionWillRenew: null,
    });

    console.log("KRISTO_CHURCH_DELETE_SUBSCRIPTION_GUARD", {
      churchId: null,
      blocked: evaluation.blocked,
      blockReason: evaluation.blockReason,
      skipped: "no_church_id",
    });

    return {
      status: emptyStatus,
      blocked: evaluation.blocked,
      blockReason: evaluation.blockReason,
      requiresCancellationWarning: evaluation.requiresCancellationWarning,
      storeSubscriptionWillRenew: null,
      subscriptionChurchId: null,
      store: null,
      customerInfo: null,
    };
  }

  let status = await fetchChurchMediaPremiumServerStatus(churchId, args.headers, {
    bustCache: true,
  });

  const shouldRefreshStore =
    churchHasDeleteBlockingStoreSubscription(status) && !isChurchSubscriptionPeriodEnded(status);

  let customerInfo: CustomerInfo | null = null;
  if (shouldRefreshStore) {
    customerInfo = await refreshChurchDeleteCustomerInfo(churchId);
  }

  status = await fetchChurchMediaPremiumServerStatus(churchId, args.headers, {
    bustCache: true,
  });

  const storeSubscriptionWillRenew = resolveStoreSubscriptionWillRenew(customerInfo);
  const evaluation = evaluateChurchDeleteSubscriptionGuard({
    status,
    storeSubscriptionWillRenew,
  });

  const guard: ChurchDeleteSubscriptionGuard = {
    status,
    blocked: evaluation.blocked,
    blockReason: evaluation.blockReason,
    requiresCancellationWarning: evaluation.requiresCancellationWarning,
    storeSubscriptionWillRenew,
    subscriptionChurchId: churchId,
    store: churchHasDeleteBlockingStoreSubscription(status)
      ? resolveStoreForChurchDelete(status)
      : null,
    customerInfo,
  };

  console.log("KRISTO_CHURCH_DELETE_SUBSCRIPTION_GUARD", {
    churchId,
    blocked: guard.blocked,
    blockReason: guard.blockReason,
    requiresCancellationWarning: guard.requiresCancellationWarning,
    storeSubscriptionWillRenew: guard.storeSubscriptionWillRenew,
    serverSubscriptionActive: status.serverSubscriptionActive,
    subscriptionSource: status.subscriptionSource,
    subscriptionExpiresAt: status.subscriptionExpiresAt,
    ownershipLockStatus: status.subscriptionOwnershipLock?.status ?? null,
    ownershipLockStore: status.subscriptionOwnershipLock?.store ?? null,
    isLockHolder: status.subscriptionOwnershipLock?.isLockHolder ?? false,
    hasCustomerInfo: Boolean(customerInfo),
    hasActiveStoreSub: hasActiveStoreSubscriptionOnDevice(customerInfo),
    subscriptionPeriodEnded: isChurchSubscriptionPeriodEnded(status),
  });

  if (guard.blocked) {
    console.log("KRISTO_CHURCH_DELETE_BLOCKED_ACTIVE_SUBSCRIPTION", {
      churchId,
      blockReason: guard.blockReason,
      storeSubscriptionWillRenew: guard.storeSubscriptionWillRenew,
      subscriptionExpiresAt: status.subscriptionExpiresAt,
      lockExpiresAt: status.subscriptionOwnershipLock?.expiresAt ?? null,
    });
  } else if (guard.requiresCancellationWarning) {
    console.log("KRISTO_CHURCH_DELETE_ALLOWED_AFTER_CANCELLATION", {
      churchId,
      storeSubscriptionWillRenew: guard.storeSubscriptionWillRenew,
      subscriptionExpiresAt: status.subscriptionExpiresAt,
      lockExpiresAt: status.subscriptionOwnershipLock?.expiresAt ?? null,
      serverSubscriptionActive: status.serverSubscriptionActive,
    });
  } else if (
    churchHasDeleteBlockingStoreSubscription(status) &&
    isChurchSubscriptionPeriodEnded(status)
  ) {
    console.log("KRISTO_CHURCH_DELETE_ALLOWED_AFTER_EXPIRY", {
      churchId,
      subscriptionExpiresAt: status.subscriptionExpiresAt,
      lockExpiresAt: status.subscriptionOwnershipLock?.expiresAt ?? null,
      serverSubscriptionActive: status.serverSubscriptionActive,
    });
  }

  return guard;
}

export async function openChurchDeleteSubscriptionManagement(
  guard: ChurchDeleteSubscriptionGuard
): Promise<{ opened: boolean; customerInfo: CustomerInfo | null }> {
  const churchId = String(guard.subscriptionChurchId || guard.status.churchId || "").trim();
  let customerInfo = guard.customerInfo;

  if (churchId && !customerInfo) {
    customerInfo = await refreshChurchDeleteCustomerInfo(churchId);
  }

  const manageResult = await openSubscriptionManagement(customerInfo, {
    allowGenericFallback: Platform.OS === "ios" || Platform.OS === "android",
    source: "church-delete",
  });

  console.log("KRISTO_CHURCH_DELETE_OPEN_MANAGEMENT", {
    churchId: churchId || null,
    opened: manageResult.opened,
    path: manageResult.path,
    fallbackUsed: manageResult.fallbackUsed,
    hasCustomerInfo: Boolean(customerInfo),
    store: guard.store,
    blockReason: guard.blockReason,
    storeSubscriptionWillRenew: guard.storeSubscriptionWillRenew,
  });

  return { opened: manageResult.opened, customerInfo: customerInfo ?? null };
}

export function getChurchDeleteSubscriptionResumeMessage(
  guard: ChurchDeleteSubscriptionGuard
): string | null {
  if (!guard.blocked) return null;

  if (guard.storeSubscriptionWillRenew === true) {
    return "Renewal is still active. Cancel it first to delete this church.";
  }

  return null;
}

export function buildChurchDeleteCancellationWarningMessage(
  guard: ChurchDeleteSubscriptionGuard | null | undefined
): string {
  const expiryLabel =
    resolveChurchDeletePaidAccessExpiryLabel(guard) || "the end of your billing period";
  return (
    `Renewal is off. This church still has paid access until ${expiryLabel}. ` +
    "If you delete this church now, remaining paid access for this church may be lost and cannot be moved to another church."
  );
}

export async function preserveChurchDeleteSubscriptionLockTombstone(args: {
  churchId: string;
  headers: Record<string, string>;
}): Promise<{ preserved: boolean; reason?: string | null }> {
  const churchId = String(args.churchId || "").trim();
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (!base || !churchId) {
    return { preserved: false, reason: "missing-api-base-or-church-id" };
  }

  const url = `${base}/api/church/subscription/preserve-delete-lock`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...args.headers,
    },
    body: JSON.stringify({ churchId }),
  });

  const rawText = await res.text();
  let body: { ok?: boolean; preserved?: boolean; reason?: string | null } | null = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  if (!res.ok || body?.ok === false) {
    throw new Error(String(body?.reason || rawText || `HTTP ${res.status}`));
  }

  return {
    preserved: body?.preserved === true,
    reason: body?.reason ?? null,
  };
}

export function resolveChurchDeletePaidAccessExpiryLabel(
  guard: ChurchDeleteSubscriptionGuard | null | undefined
): string | null {
  if (!guard) return null;

  const status = guard.status;
  const lockLabel = String(status.subscriptionOwnershipLock?.expiresAtLabel || "").trim();
  if (lockLabel) return lockLabel;

  const expiresAt =
    status.subscriptionExpiresAt ?? status.subscriptionOwnershipLock?.expiresAt ?? null;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return new Date(expiresAt).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  return null;
}
