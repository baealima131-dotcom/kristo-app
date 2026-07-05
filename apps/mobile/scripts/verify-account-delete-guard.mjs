#!/usr/bin/env node
/**
 * Verifies delete-account subscription guard detection (mirrors accountDeleteSubscription.ts).
 * Run: node apps/mobile/scripts/verify-account-delete-guard.mjs
 */

function isActiveDeviceStoreSubscription(status) {
  if (status.serverSubscriptionActive && status.subscriptionSource === "app_store") {
    return true;
  }
  const lock = status.subscriptionOwnershipLock;
  if (!lock || lock.status !== "active") return false;
  if (lock.store === "app_store" || lock.store === "play_store") return true;
  return lock.isLockHolder === true;
}

function resolveSubscriptionChurchId(status) {
  const churchId = String(status.churchId || "").trim() || null;
  if (status.serverSubscriptionActive && status.subscriptionSource === "app_store" && churchId) {
    return churchId;
  }
  const lock = status.subscriptionOwnershipLock;
  if (lock?.isLockHolder && churchId) return churchId;
  const lockedChurchId = String(lock?.lockedChurchId || "").trim();
  return lockedChurchId || churchId;
}

function hasActiveStoreSubscriptionOnDevice(customerInfo) {
  if (!customerInfo) return false;
  const active = customerInfo.entitlements?.active || {};
  if (Object.keys(active).length > 0) return true;
  return Boolean(customerInfo.activeSubscriptions?.length);
}

function resolveStoreSubscriptionWillRenew(customerInfo) {
  if (!customerInfo) return null;
  const active = customerInfo.entitlements?.active || {};
  for (const entitlement of Object.values(active)) {
    if (entitlement?.willRenew === true) return true;
    if (entitlement?.willRenew === false) return false;
  }
  for (const subscription of Object.values(customerInfo.subscriptionsByProductIdentifier || {})) {
    if (!subscription?.isActive) continue;
    if (subscription.willRenew === true) return true;
    if (subscription.willRenew === false) return false;
  }
  if (hasActiveStoreSubscriptionOnDevice(customerInfo)) return null;
  return null;
}

function evaluate(status, customerInfo = null) {
  const deviceStoreConcern = isActiveDeviceStoreSubscription(status);
  const storeSubscriptionWillRenew = resolveStoreSubscriptionWillRenew(customerInfo);
  const hasActiveStoreSub = hasActiveStoreSubscriptionOnDevice(customerInfo);
  const cancelledUntilExpiry =
    deviceStoreConcern && storeSubscriptionWillRenew === false && hasActiveStoreSub;
  const requiresStoreCancellation =
    deviceStoreConcern &&
    (storeSubscriptionWillRenew === true ||
      (storeSubscriptionWillRenew === null && hasActiveStoreSub));

  let detection = "none";
  if (requiresStoreCancellation || cancelledUntilExpiry) {
    if (status.serverSubscriptionActive && status.subscriptionSource === "app_store") {
      detection = "current_church_app_store";
    } else {
      detection = "ownership_lock_active";
    }
  }

  return {
    requiresStoreCancellation,
    cancelledUntilExpiry,
    storeSubscriptionWillRenew,
    subscriptionChurchId:
      requiresStoreCancellation || cancelledUntilExpiry
        ? resolveSubscriptionChurchId(status)
        : null,
    detection,
  };
}

const base = {
  churchId: "CH7-TEST01",
  serverSubscriptionActive: false,
  subscriptionSource: null,
  subscriptionOwnershipLock: null,
};

const activeWillRenew = {
  entitlements: {
    active: {
      Premium: {
        willRenew: true,
        isActive: true,
      },
    },
  },
  activeSubscriptions: ["premium_monthly"],
  subscriptionsByProductIdentifier: {
    premium_monthly: { isActive: true, willRenew: true },
  },
};

const activeCancelledUntilExpiry = {
  entitlements: {
    active: {
      Premium: {
        willRenew: false,
        isActive: true,
      },
    },
  },
  activeSubscriptions: ["premium_monthly"],
  subscriptionsByProductIdentifier: {
    premium_monthly: { isActive: true, willRenew: false },
  },
};

const cases = [
  {
    name: "no subscription",
    status: { ...base },
    customerInfo: null,
    want: {
      requiresStoreCancellation: false,
      cancelledUntilExpiry: false,
      detection: "none",
      subscriptionChurchId: null,
    },
  },
  {
    name: "current church app_store active with willRenew true",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
    },
    customerInfo: activeWillRenew,
    want: {
      requiresStoreCancellation: true,
      cancelledUntilExpiry: false,
      detection: "current_church_app_store",
      subscriptionChurchId: "CH7-TEST01",
    },
  },
  {
    name: "current church app_store active but cancelled until expiry",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
    },
    customerInfo: activeCancelledUntilExpiry,
    want: {
      requiresStoreCancellation: false,
      cancelledUntilExpiry: true,
      detection: "current_church_app_store",
      subscriptionChurchId: "CH7-TEST01",
    },
  },
  {
    name: "offline activation should not trigger guard",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "offline_activation",
    },
    customerInfo: activeWillRenew,
    want: {
      requiresStoreCancellation: false,
      cancelledUntilExpiry: false,
      detection: "none",
      subscriptionChurchId: null,
    },
  },
  {
    name: "ownership lock active on another church",
    status: {
      ...base,
      churchId: "CH7-NEWCH",
      subscriptionOwnershipLock: {
        blocked: true,
        isLockHolder: false,
        lockedChurchId: "CH7-OLDCH",
        status: "active",
        store: "app_store",
      },
    },
    customerInfo: activeWillRenew,
    want: {
      requiresStoreCancellation: true,
      cancelledUntilExpiry: false,
      detection: "ownership_lock_active",
      subscriptionChurchId: "CH7-OLDCH",
    },
  },
  {
    name: "expired ownership lock ignored",
    status: {
      ...base,
      subscriptionOwnershipLock: {
        blocked: false,
        isLockHolder: false,
        lockedChurchId: "CH7-OLDCH",
        status: "expired",
        store: "app_store",
      },
    },
    customerInfo: activeWillRenew,
    want: {
      requiresStoreCancellation: false,
      cancelledUntilExpiry: false,
      detection: "none",
      subscriptionChurchId: null,
    },
  },
  {
    name: "lock holder on current church",
    status: {
      ...base,
      subscriptionOwnershipLock: {
        blocked: false,
        isLockHolder: true,
        lockedChurchId: "CH7-TEST01",
        status: "active",
        store: "app_store",
      },
    },
    customerInfo: activeWillRenew,
    want: {
      requiresStoreCancellation: true,
      cancelledUntilExpiry: false,
      detection: "ownership_lock_active",
      subscriptionChurchId: "CH7-TEST01",
    },
  },
  {
    name: "server active but no customer info still requires cancellation",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
    },
    customerInfo: null,
    want: {
      requiresStoreCancellation: false,
      cancelledUntilExpiry: false,
      detection: "none",
      subscriptionChurchId: null,
    },
  },
];

let failed = 0;
for (const c of cases) {
  const got = evaluate(c.status, c.customerInfo);
  const ok =
    got.requiresStoreCancellation === c.want.requiresStoreCancellation &&
    got.cancelledUntilExpiry === c.want.cancelledUntilExpiry &&
    got.detection === c.want.detection &&
    got.subscriptionChurchId === c.want.subscriptionChurchId;
  if (!ok) {
    failed += 1;
    console.error("FAIL", c.name, { want: c.want, got });
  } else {
    console.log("PASS", c.name);
  }
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} delete-account guard cases passed.`);
