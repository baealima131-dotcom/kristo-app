#!/usr/bin/env node
/**
 * Verifies server-side church-delete subscription guard (mirrors churchDeleteSubscription.ts).
 * Run: node scripts/verify-church-delete-guard-server.mjs
 */

function churchHasDeleteBlockingStoreSubscription({ media, lock }) {
  if (media?.subscriptionActive && media.subscriptionSource === "app_store") {
    return true;
  }
  if (!lock || lock.status !== "active") return false;
  if (lock.isLockHolder !== true) return false;
  return lock.store === "app_store" || lock.store === "play_store";
}

function isChurchSubscriptionPeriodEnded({ media, lock }) {
  if (!media?.subscriptionActive) {
    if (!lock || lock.status !== "active") return true;
  }
  const now = Date.now();
  const expiresAt = media?.subscriptionExpiresAt ?? lock?.expiresAt ?? null;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && now >= expiresAt) {
    return true;
  }
  return false;
}

function evaluateChurchDeleteSubscriptionGuard({
  hasBlockingStoreSubscription,
  subscriptionPeriodEnded,
  willRenew,
}) {
  if (!hasBlockingStoreSubscription) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }
  if (subscriptionPeriodEnded) {
    return { blocked: false, blockReason: "none", requiresCancellationWarning: false };
  }
  if (willRenew === true) {
    return {
      blocked: true,
      blockReason: "active_will_renew",
      requiresCancellationWarning: false,
    };
  }
  if (willRenew === false) {
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

function evaluate({ media = null, lock = null, willRenew = null }) {
  const hasBlockingStoreSubscription = churchHasDeleteBlockingStoreSubscription({ media, lock });
  const subscriptionPeriodEnded = isChurchSubscriptionPeriodEnded({ media, lock });
  return {
    ...evaluateChurchDeleteSubscriptionGuard({
      hasBlockingStoreSubscription,
      subscriptionPeriodEnded,
      willRenew,
    }),
    hasBlockingStoreSubscription,
    willRenew,
  };
}

const futureExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

const cases = [
  {
    name: "no subscription/no lock => allowed",
    input: { media: null, lock: null, willRenew: null },
    want: { blocked: false, hasBlockingStoreSubscription: false },
  },
  {
    name: "current church + active renewing => BLOCKED",
    input: {
      media: {
        subscriptionActive: true,
        subscriptionSource: "app_store",
        subscriptionExpiresAt: futureExpiry,
      },
      lock: {
        status: "active",
        isLockHolder: true,
        store: "app_store",
        willRenew: true,
        expiresAt: futureExpiry,
      },
      willRenew: true,
    },
    want: {
      blocked: true,
      blockReason: "active_will_renew",
      requiresCancellationWarning: false,
    },
  },
  {
    name: "current church + cancelled until expiry => allowed with warning",
    input: {
      media: {
        subscriptionActive: true,
        subscriptionSource: "app_store",
        subscriptionExpiresAt: futureExpiry,
      },
      lock: {
        status: "active",
        isLockHolder: true,
        store: "app_store",
        willRenew: false,
        expiresAt: futureExpiry,
      },
      willRenew: false,
    },
    want: {
      blocked: false,
      blockReason: "cancelled_until_expiry",
      requiresCancellationWarning: true,
    },
  },
  {
    name: "current church + unknown renewal => BLOCKED",
    input: {
      media: {
        subscriptionActive: true,
        subscriptionSource: "app_store",
        subscriptionExpiresAt: futureExpiry,
      },
      lock: {
        status: "active",
        isLockHolder: true,
        store: "app_store",
        expiresAt: futureExpiry,
      },
      willRenew: null,
    },
    want: {
      blocked: true,
      blockReason: "active_store_subscription",
      requiresCancellationWarning: false,
    },
  },
  {
    name: "foreign church lock => current church allowed",
    input: {
      media: { subscriptionActive: false, subscriptionSource: null },
      lock: {
        status: "active",
        isLockHolder: false,
        lockedChurchId: "CH7-OTHER",
        store: "app_store",
        willRenew: true,
        expiresAt: futureExpiry,
      },
      willRenew: true,
    },
    want: {
      blocked: false,
      hasBlockingStoreSubscription: false,
      blockReason: "none",
    },
  },
];

let failed = 0;
for (const c of cases) {
  const got = evaluate(c.input);
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

console.log(`\nAll ${cases.length} server church-delete guard cases passed.`);
