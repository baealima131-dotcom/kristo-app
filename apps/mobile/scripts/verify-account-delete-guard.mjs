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

function evaluate(status) {
  const requiresStoreCancellation = isActiveDeviceStoreSubscription(status);
  let detection = "none";
  if (requiresStoreCancellation) {
    if (status.serverSubscriptionActive && status.subscriptionSource === "app_store") {
      detection = "current_church_app_store";
    } else {
      detection = "ownership_lock_active";
    }
  }
  return {
    requiresStoreCancellation,
    subscriptionChurchId: requiresStoreCancellation ? resolveSubscriptionChurchId(status) : null,
    detection,
  };
}

const base = {
  churchId: "CH7-TEST01",
  serverSubscriptionActive: false,
  subscriptionSource: null,
  subscriptionOwnershipLock: null,
};

const cases = [
  {
    name: "no subscription",
    status: { ...base },
    want: { requiresStoreCancellation: false, detection: "none", subscriptionChurchId: null },
  },
  {
    name: "current church app_store active",
    status: {
      ...base,
      serverSubscriptionActive: true,
      subscriptionSource: "app_store",
    },
    want: {
      requiresStoreCancellation: true,
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
    want: { requiresStoreCancellation: false, detection: "none", subscriptionChurchId: null },
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
    want: {
      requiresStoreCancellation: true,
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
    want: { requiresStoreCancellation: false, detection: "none", subscriptionChurchId: null },
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
    want: {
      requiresStoreCancellation: true,
      detection: "ownership_lock_active",
      subscriptionChurchId: "CH7-TEST01",
    },
  },
];

let failed = 0;
for (const c of cases) {
  const got = evaluate(c.status);
  const ok =
    got.requiresStoreCancellation === c.want.requiresStoreCancellation &&
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
