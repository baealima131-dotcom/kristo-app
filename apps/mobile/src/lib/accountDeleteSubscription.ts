import { Platform } from "react-native";
import type { CustomerInfo } from "react-native-purchases";

import {
  fetchChurchMediaPremiumServerStatus,
  isPastorSessionRole,
  type ChurchMediaPremiumServerStatus,
} from "./churchSubscription";
import {
  configureChurchMobileSubscriptions,
  getActivePremiumEntitlement,
  getCustomerSubscriptionInfo,
  getRevenueCatConfiguredAppUserId,
  hasActivePremiumProduct,
  hasPremiumEntitlement,
  openSubscriptionManagement,
  restoreSubscriptionPurchases,
} from "./payments/mobileSubscriptions";

export type AccountDeleteSubscriptionCheck = {
  status: ChurchMediaPremiumServerStatus;
  /** True only when the store subscription is active and set to renew. */
  requiresStoreCancellation: boolean;
  /** Active until expiry but auto-renew is off (user already cancelled in the store). */
  cancelledUntilExpiry: boolean;
  storeSubscriptionWillRenew: boolean | null;
  subscriptionChurchId: string | null;
  store: "app_store" | "play_store" | null;
  detection:
    | "current_church_app_store"
    | "ownership_lock_active"
    | "none";
  customerInfo: CustomerInfo | null;
};

export type AccountDeleteModalType =
  | "owner_choice"
  | "lock_holder_non_pastor"
  | "member_confirm"
  | "standard";

export type PastorOwnedChurchSummary = {
  churchId: string;
  churchName: string | null;
};

export type AccountDeletePastorOwnershipCheck = {
  blocked: boolean;
  churches: PastorOwnedChurchSummary[];
};

export type AccountDeleteSubscriptionOwnerGate = {
  isPastor: boolean;
  isLockHolder: boolean;
  deviceCanManageSubscription: boolean;
  /** Church owner may choose how deletion affects church subscription. */
  canManageSubscription: boolean;
  modalType: AccountDeleteModalType;
};

export function isChurchOwnerRoleForAccountDelete(role?: string): boolean {
  const normalized = String(role || "").trim().toLowerCase();
  return (
    isPastorSessionRole(role) ||
    normalized.includes("admin") ||
    normalized === "church_admin"
  );
}

export function hasDeleteAccountStoreSubscriptionConcern(
  check: AccountDeleteSubscriptionCheck
): boolean {
  return check.detection !== "none";
}

export function isDeleteAccountStoreCancellationComplete(
  check: AccountDeleteSubscriptionCheck
): boolean {
  return check.cancelledUntilExpiry || check.storeSubscriptionWillRenew === false;
}

/** Church has a store-managed subscription — informational for members, not management authority. */
export function churchHasManagedStoreSubscription(
  status: ChurchMediaPremiumServerStatus
): boolean {
  if (
    status.serverSubscriptionActive &&
    status.subscriptionSource === "app_store"
  ) {
    return true;
  }

  const lock = status.subscriptionOwnershipLock;
  if (!lock || lock.status !== "active") return false;

  return lock.store === "app_store" || lock.store === "play_store";
}

function mayManageAccountDeleteStoreSubscription(
  status: ChurchMediaPremiumServerStatus
): boolean {
  return (
    status.isActualChurchPastor === true ||
    status.subscriptionOwnershipLock?.isLockHolder === true
  );
}

/**
 * True only when backend authority exists AND this device has a verified church-scoped
 * RevenueCat subscription identity. Never true for members inheriting a shared entitlement.
 */
export function resolveAccountDeleteDeviceCanManageSubscription(
  check: AccountDeleteSubscriptionCheck,
  churchId: string
): boolean {
  const status = check.status;
  const isActualChurchPastor = status.isActualChurchPastor === true;
  const isLockHolder = status.subscriptionOwnershipLock?.isLockHolder === true;

  if (!isActualChurchPastor && !isLockHolder) return false;

  const cid = String(churchId || status.churchId || "").trim();
  if (!cid || !status.serverSubscriptionActive) return false;

  const customerInfo = check.customerInfo;
  if (!customerInfo || !hasActiveStoreSubscriptionOnDevice(customerInfo)) return false;

  const configuredId = String(getRevenueCatConfiguredAppUserId() || "").trim();
  const originalAppUserId = String(customerInfo.originalAppUserId || "").trim();

  return configuredId === cid && originalAppUserId === cid;
}

export function resolveAccountDeleteSubscriptionOwnerGate(args: {
  check: AccountDeleteSubscriptionCheck;
  userId: string;
  churchId: string;
  role?: string;
}): AccountDeleteSubscriptionOwnerGate {
  const status = args.check.status;
  const isActualPastor = status.isActualChurchPastor === true;
  const isChurchOwnerRole = isChurchOwnerRoleForAccountDelete(args.role);
  const isPastor = isActualPastor || isChurchOwnerRole;
  const isLockHolder = status.subscriptionOwnershipLock?.isLockHolder === true;
  const deviceCanManageSubscription = resolveAccountDeleteDeviceCanManageSubscription(
    args.check,
    args.churchId
  );
  const canManageSubscription = isPastor;

  let modalType: AccountDeleteModalType = "standard";
  if (isPastor && hasDeleteAccountStoreSubscriptionConcern(args.check)) {
    modalType = "owner_choice";
  } else if (isLockHolder && hasDeleteAccountStoreSubscriptionConcern(args.check)) {
    modalType = "lock_holder_non_pastor";
  } else if (!isPastor && !isLockHolder && churchHasManagedStoreSubscription(status)) {
    modalType = "member_confirm";
  }

  const gate: AccountDeleteSubscriptionOwnerGate = {
    isPastor,
    isLockHolder,
    deviceCanManageSubscription,
    canManageSubscription,
    modalType,
  };

  console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_OWNER_GATE", {
    userId: String(args.userId || "").trim() || null,
    churchId: String(args.churchId || "").trim() || null,
    isPastor: gate.isPastor,
    isLockHolder: gate.isLockHolder,
    deviceCanManageSubscription: gate.deviceCanManageSubscription,
    canManageSubscription: gate.canManageSubscription,
    modalType: gate.modalType,
    detection: args.check.detection,
    churchHasManagedStoreSubscription: churchHasManagedStoreSubscription(status),
    isActualChurchPastor: isActualPastor,
    isChurchOwnerRole,
  });

  return gate;
}

function isActiveDeviceStoreSubscription(
  status: ChurchMediaPremiumServerStatus
): boolean {
  if (
    status.serverSubscriptionActive &&
    status.subscriptionSource === "app_store"
  ) {
    return true;
  }

  const lock = status.subscriptionOwnershipLock;
  if (!lock || lock.status !== "active") return false;

  if (lock.store === "app_store" || lock.store === "play_store") {
    return true;
  }

  return lock.isLockHolder === true;
}

function resolveSubscriptionChurchId(
  status: ChurchMediaPremiumServerStatus
): string | null {
  const churchId = String(status.churchId || "").trim() || null;

  if (
    status.serverSubscriptionActive &&
    status.subscriptionSource === "app_store" &&
    churchId
  ) {
    return churchId;
  }

  const lock = status.subscriptionOwnershipLock;
  if (lock?.isLockHolder && churchId) return churchId;

  const lockedChurchId = String(lock?.lockedChurchId || "").trim();
  return lockedChurchId || churchId;
}

function resolveStoreForDeleteCheck(
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

/** Read StoreKit / RevenueCat auto-renew for the active premium subscription. */
export function resolveStoreSubscriptionWillRenew(
  customerInfo: CustomerInfo | null | undefined
): boolean | null {
  if (!customerInfo) return null;

  const entitlement = getActivePremiumEntitlement(customerInfo);
  if (entitlement) {
    if (entitlement.willRenew === true) return true;
    if (entitlement.willRenew === false) return false;
  }

  for (const subscription of Object.values(
    customerInfo.subscriptionsByProductIdentifier || {}
  )) {
    if (!subscription?.isActive) continue;
    if (subscription.willRenew === true) return true;
    if (subscription.willRenew === false) return false;
  }

  if (hasActiveStoreSubscriptionOnDevice(customerInfo)) return null;
  return null;
}

export function getAccountDeleteStoreCancellationMessage(): string {
  if (Platform.OS === "android") {
    return "Your Google Play subscription must be cancelled before deleting your account to prevent future renewal charges.";
  }
  return (
    "We'll open your Apple Subscriptions screen. Select Kristo App there and cancel it.\n\n" +
    "For sandbox testing, open Settings → App Store → Sandbox Account → Manage."
  );
}

export function getAccountDeleteCancelledUntilExpiryMessage(): string {
  return "Subscription is cancelled. You can continue deleting your account; access may remain until expiry.";
}

export function getAccountDeleteStoreManagementFallbackMessage(): string {
  if (Platform.OS === "android") {
    return "Open Google Play → Payments & subscriptions → Subscriptions, cancel Kristo App, then return here to continue account deletion.";
  }
  return (
    "Open Settings → App Store → Subscriptions, select Kristo App, and cancel it.\n\n" +
    "For sandbox testing, open Settings → App Store → Sandbox Account → Manage."
  );
}

export function getAccountDeleteStoreCancellationTitle(): string {
  if (Platform.OS === "android") {
    return "Cancel Google Play Subscription";
  }
  return "Cancel Apple Subscription";
}

export function getAccountDeleteCancelledUntilExpiryTitle(): string {
  if (Platform.OS === "android") {
    return "Google Play subscription cancelled";
  }
  return "Apple subscription cancelled";
}

export function getAccountDeleteOpenStoreButtonLabel(): string {
  if (Platform.OS === "android") {
    return "Open Google Play Subscriptions";
  }
  return "Open Apple Subscriptions";
}

export function getAccountDeleteFinalConfirmMessage(): string {
  if (Platform.OS === "android") {
    return "Deleting your Kristo account does not cancel your Google Play subscription. You may still be charged until you cancel billing in Google Play.";
  }
  return "Deleting your Kristo account does not cancel your Apple subscription. You may still be charged until you cancel billing in Apple Settings.";
}

async function refreshAccountDeleteCustomerInfo(
  subscriptionChurchId: string
): Promise<CustomerInfo | null> {
  const cid = String(subscriptionChurchId || "").trim();
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
      const info = await getCustomerSubscriptionInfo();
      return info;
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

export async function checkAccountDeleteSubscription(args: {
  churchId: string;
  headers: Record<string, string>;
}): Promise<AccountDeleteSubscriptionCheck> {
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

    console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_CHECK", {
      churchId: null,
      requiresStoreCancellation: false,
      cancelledUntilExpiry: false,
      subscriptionChurchId: null,
      store: null,
      detection: "none",
      skipped: "no_church_id",
    });

    return {
      status: emptyStatus,
      requiresStoreCancellation: false,
      cancelledUntilExpiry: false,
      storeSubscriptionWillRenew: null,
      subscriptionChurchId: null,
      store: null,
      detection: "none",
      customerInfo: null,
    };
  }

  console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_REFRESH_START", {
    churchId,
    platform: Platform.OS,
  });

  let status = await fetchChurchMediaPremiumServerStatus(churchId, args.headers, {
    bustCache: true,
  });

  const mayManageStoreSubscription = mayManageAccountDeleteStoreSubscription(status);
  const preliminaryDeviceStoreConcern =
    mayManageStoreSubscription && isActiveDeviceStoreSubscription(status);
  const subscriptionChurchId = preliminaryDeviceStoreConcern
    ? resolveSubscriptionChurchId(status)
    : null;

  let customerInfo: CustomerInfo | null = null;
  if (mayManageStoreSubscription && subscriptionChurchId) {
    customerInfo = await refreshAccountDeleteCustomerInfo(subscriptionChurchId);
  }

  status = await fetchChurchMediaPremiumServerStatus(churchId, args.headers, {
    bustCache: true,
  });

  let requiresStoreCancellation = false;
  let cancelledUntilExpiry = false;
  let storeSubscriptionWillRenew: boolean | null = null;
  let resolvedSubscriptionChurchId: string | null = null;
  let store: "app_store" | "play_store" | null = null;
  let detection: AccountDeleteSubscriptionCheck["detection"] = "none";
  let hasActiveStoreSub = false;
  let deviceStoreConcern = false;

  if (mayManageAccountDeleteStoreSubscription(status)) {
    deviceStoreConcern = isActiveDeviceStoreSubscription(status);
    storeSubscriptionWillRenew = resolveStoreSubscriptionWillRenew(customerInfo);
    hasActiveStoreSub = hasActiveStoreSubscriptionOnDevice(customerInfo);
    cancelledUntilExpiry =
      deviceStoreConcern && storeSubscriptionWillRenew === false && hasActiveStoreSub;
    requiresStoreCancellation =
      deviceStoreConcern &&
      (storeSubscriptionWillRenew === true ||
        (storeSubscriptionWillRenew === null && hasActiveStoreSub));

    resolvedSubscriptionChurchId =
      requiresStoreCancellation || cancelledUntilExpiry
        ? resolveSubscriptionChurchId(status)
        : null;
    store =
      requiresStoreCancellation || cancelledUntilExpiry
        ? resolveStoreForDeleteCheck(status)
        : null;

    if (requiresStoreCancellation || cancelledUntilExpiry) {
      if (
        status.serverSubscriptionActive &&
        status.subscriptionSource === "app_store"
      ) {
        detection = "current_church_app_store";
      } else {
        detection = "ownership_lock_active";
      }
    }
  }

  console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_REFRESH_DONE", {
    churchId,
    mayManageStoreSubscription,
    subscriptionChurchId: resolvedSubscriptionChurchId,
    deviceStoreConcern,
    storeSubscriptionWillRenew,
    hasActiveStoreSub,
    requiresStoreCancellation,
    cancelledUntilExpiry,
    serverSubscriptionActive: status.serverSubscriptionActive,
    subscriptionSource: status.subscriptionSource,
    hasCustomerInfo: Boolean(customerInfo),
    skippedRevenueCatRefresh: !mayManageStoreSubscription,
  });

  if (cancelledUntilExpiry) {
    console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_CANCELLED_UNTIL_EXPIRY", {
      churchId,
      subscriptionChurchId: resolvedSubscriptionChurchId,
      storeSubscriptionWillRenew,
      serverSubscriptionActive: status.serverSubscriptionActive,
      subscriptionExpiresAt: status.subscriptionExpiresAt,
    });
  }

  console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_CHECK", {
    churchId,
    requiresStoreCancellation,
    cancelledUntilExpiry,
    storeSubscriptionWillRenew,
    subscriptionChurchId: resolvedSubscriptionChurchId,
    store,
    detection,
    serverSubscriptionActive: status.serverSubscriptionActive,
    subscriptionSource: status.subscriptionSource,
    ownershipLockStatus: status.subscriptionOwnershipLock?.status ?? null,
    ownershipLockStore: status.subscriptionOwnershipLock?.store ?? null,
    lockedChurchId: status.subscriptionOwnershipLock?.lockedChurchId ?? null,
    isLockHolder: status.subscriptionOwnershipLock?.isLockHolder ?? false,
    routeFailed: status.routeFailed,
    hasCustomerInfo: Boolean(customerInfo),
  });

  return {
    status,
    requiresStoreCancellation,
    cancelledUntilExpiry,
    storeSubscriptionWillRenew,
    subscriptionChurchId: resolvedSubscriptionChurchId,
    store,
    detection,
    customerInfo,
  };
}

export async function openAccountDeleteSubscriptionManagement(
  check: AccountDeleteSubscriptionCheck
): Promise<{ opened: boolean; customerInfo: CustomerInfo | null }> {
  const subscriptionChurchId = String(check.subscriptionChurchId || "").trim();
  let customerInfo = check.customerInfo;

  if (subscriptionChurchId && !customerInfo) {
    customerInfo = await refreshAccountDeleteCustomerInfo(subscriptionChurchId);
  }

  const manageResult = await openSubscriptionManagement(customerInfo, {
    allowGenericFallback: Platform.OS === "ios" || Platform.OS === "android",
    source: "account-delete",
  });

  console.log("KRISTO_ACCOUNT_DELETE_OPEN_MANAGEMENT", {
    subscriptionChurchId: subscriptionChurchId || null,
    opened: manageResult.opened,
    path: manageResult.path,
    fallbackUsed: manageResult.fallbackUsed,
    hasCustomerInfo: Boolean(customerInfo),
    managementURL: String(customerInfo?.managementURL || "").trim() || null,
    store: check.store,
    detection: check.detection,
    storeSubscriptionWillRenew: check.storeSubscriptionWillRenew,
  });

  return { opened: manageResult.opened, customerInfo: customerInfo ?? null };
}

export async function checkAccountDeletePastorOwnership(args: {
  headers: Record<string, string>;
}): Promise<AccountDeletePastorOwnershipCheck> {
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (!base) {
    return { blocked: false, churches: [] };
  }

  const url = `${base}/api/auth/delete-account/precheck`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...args.headers,
    },
    body: "{}",
  });

  const rawText = await res.text();
  let body: {
    ok?: boolean;
    canDeleteAccount?: boolean;
    pastorOwnsChurches?: PastorOwnedChurchSummary[];
    error?: string;
  } | null = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  if (!res.ok || body?.ok === false) {
    throw new Error(String(body?.error || rawText || `HTTP ${res.status}`));
  }

  const churches = Array.isArray(body?.pastorOwnsChurches) ? body.pastorOwnsChurches : [];
  const blocked = body?.canDeleteAccount === false || churches.length > 0;

  console.log("KRISTO_ACCOUNT_DELETE_PASTOR_OWNERSHIP_CHECK", {
    blocked,
    churchCount: churches.length,
    churchIds: churches.map((row) => row.churchId),
  });

  return { blocked, churches };
}

