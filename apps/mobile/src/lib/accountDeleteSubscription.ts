import { Platform } from "react-native";
import type { CustomerInfo } from "react-native-purchases";

import {
  fetchChurchMediaPremiumServerStatus,
  type ChurchMediaPremiumServerStatus,
} from "./churchSubscription";
import {
  configureChurchMobileSubscriptions,
  getCustomerSubscriptionInfo,
  openSubscriptionManagement,
} from "./payments/mobileSubscriptions";

export type AccountDeleteSubscriptionCheck = {
  status: ChurchMediaPremiumServerStatus;
  requiresStoreCancellation: boolean;
  subscriptionChurchId: string | null;
  store: "app_store" | "play_store" | null;
  detection:
    | "current_church_app_store"
    | "ownership_lock_active"
    | "none";
};

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

export function getAccountDeleteStoreCancellationMessage(): string {
  if (Platform.OS === "android") {
    return "Your Google Play subscription must be cancelled before deleting your account to prevent future renewal charges.";
  }
  return (
    "We'll open your Apple Subscriptions screen. Select Kristo App there and cancel it.\n\n" +
    "For sandbox testing, open Settings → App Store → Sandbox Account → Manage."
  );
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
      subscriptionChurchId: null,
      store: null,
      detection: "none",
      skipped: "no_church_id",
    });

    return {
      status: emptyStatus,
      requiresStoreCancellation: false,
      subscriptionChurchId: null,
      store: null,
      detection: "none",
    };
  }

  const status = await fetchChurchMediaPremiumServerStatus(churchId, args.headers, {
    bustCache: true,
  });

  const requiresStoreCancellation = isActiveDeviceStoreSubscription(status);
  const subscriptionChurchId = requiresStoreCancellation
    ? resolveSubscriptionChurchId(status)
    : null;
  const store = requiresStoreCancellation ? resolveStoreForDeleteCheck(status) : null;

  let detection: AccountDeleteSubscriptionCheck["detection"] = "none";
  if (requiresStoreCancellation) {
    if (
      status.serverSubscriptionActive &&
      status.subscriptionSource === "app_store"
    ) {
      detection = "current_church_app_store";
    } else {
      detection = "ownership_lock_active";
    }
  }

  console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_CHECK", {
    churchId,
    requiresStoreCancellation,
    subscriptionChurchId,
    store,
    detection,
    serverSubscriptionActive: status.serverSubscriptionActive,
    subscriptionSource: status.subscriptionSource,
    ownershipLockStatus: status.subscriptionOwnershipLock?.status ?? null,
    ownershipLockStore: status.subscriptionOwnershipLock?.store ?? null,
    lockedChurchId: status.subscriptionOwnershipLock?.lockedChurchId ?? null,
    isLockHolder: status.subscriptionOwnershipLock?.isLockHolder ?? false,
    routeFailed: status.routeFailed,
  });

  return {
    status,
    requiresStoreCancellation,
    subscriptionChurchId,
    store,
    detection,
  };
}

export async function openAccountDeleteSubscriptionManagement(
  check: AccountDeleteSubscriptionCheck
): Promise<{ opened: boolean; customerInfo: CustomerInfo | null }> {
  const subscriptionChurchId = String(check.subscriptionChurchId || "").trim();
  let customerInfo: CustomerInfo | null = null;

  if (subscriptionChurchId) {
    try {
      await configureChurchMobileSubscriptions(subscriptionChurchId, {
        syncPurchases: false,
      });
      customerInfo = await getCustomerSubscriptionInfo();
    } catch {
      customerInfo = null;
    }
  }

  const manageResult = await openSubscriptionManagement(customerInfo, {
    allowGenericFallback: Platform.OS === "ios" || Platform.OS === "android",
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
  });

  return { opened: manageResult.opened, customerInfo };
}
