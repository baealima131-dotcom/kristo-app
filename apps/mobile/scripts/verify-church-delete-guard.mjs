#!/usr/bin/env node
/**
 * Verifies church-delete subscription guard (mirrors churchDeleteSubscription.ts).
 * Run: node apps/mobile/scripts/verify-church-delete-guard.mjs
 */

function churchHasDeleteBlockingStoreSubscription(status) {
  if (status.serverSubscriptionActive && status.subscriptionSource === "app_store") {
    return true;
  }
  const lock = status.subscriptionOwnershipLock;
  if (!lock || lock.status !== "active") return false;
  if (lock.isLockHolder !== true) return false;
  return lock.store === "app_store" || lock.store === "play_store";
}

function isChurchSubscriptionPeriodEnded(status) {
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
  const hasActive =
    Object.keys(active).length > 0 || Boolean(customerInfo.activeSubscriptions?.length);
  if (hasActive) return null;
  return null;
}

function resolveWillRenewForChurchDelete(status, customerInfo) {
  const lockWillRenew = status.subscriptionOwnershipLock?.willRenew ?? null;
  if (lockWillRenew === true || lockWillRenew === false) return lockWillRenew;
  const fromCustomer = resolveStoreSubscriptionWillRenew(customerInfo);
  if (fromCustomer === true || fromCustomer === false) return fromCustomer;
  return null;
}

function evaluateChurchDeleteSubscriptionGuard(status, storeSubscriptionWillRenew) {
  if (!churchHasDeleteBlockingStoreSubscription(status)) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }
  if (isChurchSubscriptionPeriodEnded(status)) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }
  if (storeSubscriptionWillRenew === true) {
    return {
      blocked: true,
      blockReason: "active_will_renew",
      requiresCancellationWarning: false,
    };
  }
  if (storeSubscriptionWillRenew === false) {
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

function evaluate(status, customerInfo = null) {
  const willRenew = resolveWillRenewForChurchDelete(status, customerInfo);
  return {
    ...evaluateChurchDeleteSubscriptionGuard(status, willRenew),
    storeSubscriptionWillRenew: willRenew,
    hasBlockingStoreSubscription: churchHasDeleteBlockingStoreSubscription(status),
  };
}

const futureExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

const base = {
  churchId: "CH7-CURRENT",
  serverSubscriptionActive: false,
  subscriptionSource: null,
  subscriptionExpiresAt: futureExpiry,
  subscriptionOwnershipLock: null,
};

const activeWillRenew = {
  entitlements: {
    active: {
      Premium: { willRenew: true, isActive: true },
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
      Premium: { willRenew: false, isActive: true },
    },
  },
  activeSubscriptions: ["premium_monthly"],
  subscriptionsByProductIdentifier: {
    premium_monthly: { isActive: true, willRenew: false },
  },
};

const activeUnknownRenewal = {
  entitlements: {
    active: {
      Premium: { isActive: true },
    },
  },
  activeSubscriptions: ["premium_monthly"],
  subscriptionsByProductIdentifier: {
    premium_monthly: { isActive: true },
  },
};

const cases = [
  {
    name: "no subscription / no lock => deletion allowed",
    status: { ...base },
    customerInfo: null,
    want: {
      blocked: false,
      blockReason: "none",
      requiresCancellationWarning: false,
      hasBlockingStoreSubscription: false,
    },
  },
  {
    name: "current church lock holder + active renewing subscription => BLOCKED",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
      subscriptionOwnershipLock: {
        blocked: false,
        isLockHolder: true,
        lockedChurchId: "CH7-CURRENT",
        status: "active",
        store: "app_store",
        willRenew: true,
        expiresAt: futureExpiry,
      },
    },
    customerInfo: activeWillRenew,
    want: {
      blocked: true,
      blockReason: "active_will_renew",
      requiresCancellationWarning: false,
      hasBlockingStoreSubscription: true,
      storeSubscriptionWillRenew: true,
    },
  },
  {
    name: "current church + active cancelled subscription => allowed with tombstone warning",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
      subscriptionOwnershipLock: {
        blocked: false,
        isLockHolder: true,
        lockedChurchId: "CH7-CURRENT",
        status: "active",
        store: "app_store",
        willRenew: false,
        expiresAt: futureExpiry,
      },
    },
    customerInfo: activeCancelledUntilExpiry,
    want: {
      blocked: false,
      blockReason: "cancelled_until_expiry",
      requiresCancellationWarning: true,
      hasBlockingStoreSubscription: true,
      storeSubscriptionWillRenew: false,
    },
  },
  {
    name: "current church + active subscription + unknown renewal => BLOCKED (fail closed)",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
      subscriptionOwnershipLock: {
        blocked: false,
        isLockHolder: true,
        lockedChurchId: "CH7-CURRENT",
        status: "active",
        store: "app_store",
        expiresAt: futureExpiry,
      },
    },
    customerInfo: activeUnknownRenewal,
    want: {
      blocked: true,
      blockReason: "active_store_subscription",
      requiresCancellationWarning: false,
      hasBlockingStoreSubscription: true,
      storeSubscriptionWillRenew: null,
    },
  },
  {
    name: "CustomerInfo missing but lock willRenew false => allowed with warning (server lock authoritative)",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
      subscriptionOwnershipLock: {
        blocked: false,
        isLockHolder: true,
        lockedChurchId: "CH7-CURRENT",
        status: "active",
        store: "app_store",
        willRenew: false,
        expiresAt: futureExpiry,
      },
    },
    customerInfo: null,
    want: {
      blocked: false,
      blockReason: "cancelled_until_expiry",
      requiresCancellationWarning: true,
      storeSubscriptionWillRenew: false,
    },
  },
  {
    name: "CustomerInfo missing and lock willRenew unknown => BLOCKED (fail closed)",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
      subscriptionOwnershipLock: {
        blocked: false,
        isLockHolder: true,
        lockedChurchId: "CH7-CURRENT",
        status: "active",
        store: "app_store",
        expiresAt: futureExpiry,
      },
    },
    customerInfo: null,
    want: {
      blocked: true,
      blockReason: "active_store_subscription",
      requiresCancellationWarning: false,
      storeSubscriptionWillRenew: null,
    },
  },
  {
    name: "foreign church lock => current church deletion allowed",
    status: {
      ...base,
      churchId: "CH7-Y4J58M",
      serverSubscriptionActive: false,
      subscriptionOwnershipLock: {
        blocked: true,
        isLockHolder: false,
        lockedChurchId: "CH7-BOPS76",
        status: "active",
        store: "app_store",
        willRenew: true,
        expiresAt: futureExpiry,
      },
    },
    customerInfo: activeWillRenew,
    want: {
      blocked: false,
      blockReason: "none",
      requiresCancellationWarning: false,
      hasBlockingStoreSubscription: false,
    },
  },
  {
    name: "foreign lock tombstone skip reason is non-fatal",
    tombstoneReason: "lock-held-by-other-church-skipped",
    wantSkippable: true,
  },
];

let failed = 0;
for (const c of cases) {
  if (c.tombstoneReason) {
    const skippable = new Set(["no-active-lock", "lock-held-by-other-church-skipped"]);
    const ok = skippable.has(c.tombstoneReason) === c.wantSkippable;
    if (!ok) {
      failed += 1;
      console.error("FAIL", c.name, { want: c.wantSkippable, got: skippable.has(c.tombstoneReason) });
    } else {
      console.log("PASS", c.name);
    }
    continue;
  }

  const got = evaluate(c.status, c.customerInfo);
  const keys = Object.keys(c.want);
  const ok = keys.every((key) => got[key] === c.want[key]);
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

console.log(`\nAll ${cases.length} church-delete guard cases passed.`);
