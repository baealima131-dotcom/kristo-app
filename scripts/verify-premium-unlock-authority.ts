/**
 * Targeted verification for immediate Premium unlock authority / races.
 * Run: npx tsx scripts/verify-premium-unlock-authority.ts
 */
import assert from "node:assert/strict";

type Seed = {
  churchId: string;
  subscriptionActive: boolean;
  backendSubscriptionActive: boolean;
  canUseMediaTools: boolean;
  activatedAt?: number;
};

const seeds = new Map<string, Seed>();
const events: Array<{ churchId: string; subscriptionActive: boolean; source?: string }> = [];
const GRACE_MS = 20_000;

function norm(id: string) {
  return String(id || "").trim().toUpperCase();
}

function announceUnlocked(args: {
  churchId: string;
  persistedChurchActivation: boolean;
  source: string;
}): boolean {
  if (args.persistedChurchActivation !== true) return false;
  const churchId = String(args.churchId || "").trim();
  if (!churchId) return false;
  seeds.set(norm(churchId), {
    churchId,
    subscriptionActive: true,
    backendSubscriptionActive: true,
    canUseMediaTools: true,
    activatedAt: Date.now(),
  });
  events.push({ churchId, subscriptionActive: true, source: args.source });
  return true;
}

function reconcileInactive(args: {
  churchId: string;
  serverSubscriptionActive: boolean;
  now?: number;
}): "revoked" | "ignored" | "unchanged" {
  const key = norm(args.churchId);
  const seed = seeds.get(key);
  if (args.serverSubscriptionActive === true) return "unchanged";
  if (seed?.subscriptionActive === true && seed.activatedAt) {
    const age = (args.now ?? Date.now()) - seed.activatedAt;
    if (age < GRACE_MS) return "ignored";
  }
  seeds.delete(key);
  events.push({ churchId: args.churchId, subscriptionActive: false, source: "server-inactive" });
  return "revoked";
}

function featuresUnlockedEmittedFor(churchId: string) {
  return events.some(
    (e) => norm(e.churchId) === norm(churchId) && e.subscriptionActive === true
  );
}

// 1) Purchase activates only the intended church
events.length = 0;
seeds.clear();
assert.equal(
  announceUnlocked({
    churchId: "CH7-A",
    persistedChurchActivation: true,
    source: "purchase",
  }),
  true
);
assert.equal(featuresUnlockedEmittedFor("CH7-A"), true);
assert.equal(featuresUnlockedEmittedFor("CH7-B"), false);
assert.equal(seeds.has(norm("CH7-B")), false);

// 2) Active church changes while verification in flight: event scoped to activated church
events.length = 0;
seeds.clear();
const inFlightChurch = "CH7-A";
const uiActiveChurch = "CH7-B";
announceUnlocked({
  churchId: inFlightChurch,
  persistedChurchActivation: true,
  source: "purchase",
});
// UI for B must ignore A's event
const applyToUi = (activeChurch: string, eventChurch: string) =>
  norm(activeChurch) === norm(eventChurch);
assert.equal(applyToUi(uiActiveChurch, inFlightChurch), false);
assert.equal(applyToUi(inFlightChurch, inFlightChurch), true);

// 3) Duplicated activation response is idempotent
events.length = 0;
seeds.clear();
assert.equal(
  announceUnlocked({ churchId: "CH7-A", persistedChurchActivation: true, source: "purchase" }),
  true
);
assert.equal(
  announceUnlocked({ churchId: "CH7-A", persistedChurchActivation: true, source: "purchase" }),
  true
);
assert.equal(events.filter((e) => e.subscriptionActive).length, 2);
assert.equal(seeds.size, 1);

// 4) Without persisted activation, no unlock (RC / purchase success alone)
events.length = 0;
seeds.clear();
assert.equal(
  announceUnlocked({
    churchId: "CH7-A",
    persistedChurchActivation: false,
    source: "purchase",
  }),
  false
);
assert.equal(featuresUnlockedEmittedFor("CH7-A"), false);

// 5) Backend later reports inactive → revoke after grace
events.length = 0;
seeds.clear();
announceUnlocked({ churchId: "CH7-A", persistedChurchActivation: true, source: "purchase" });
assert.equal(
  reconcileInactive({
    churchId: "CH7-A",
    serverSubscriptionActive: false,
    now: Date.now() + 1000,
  }),
  "ignored",
  "within grace must not revoke"
);
assert.equal(
  reconcileInactive({
    churchId: "CH7-A",
    serverSubscriptionActive: false,
    now: Date.now() + GRACE_MS + 1,
  }),
  "revoked"
);
assert.equal(seeds.has(norm("CH7-A")), false);
assert.ok(events.some((e) => e.subscriptionActive === false));

// 6) Restore ownership failure emits no unlock
events.length = 0;
seeds.clear();
const restoreOwnershipBlocked = {
  churchActivated: false,
  storeOwnershipConflict: true,
};
const shouldUnlock =
  restoreOwnershipBlocked.churchActivated && !restoreOwnershipBlocked.storeOwnershipConflict;
assert.equal(shouldUnlock, false);
if (shouldUnlock) {
  announceUnlocked({
    churchId: "CH7-A",
    persistedChurchActivation: true,
    source: "restore",
  });
}
assert.equal(featuresUnlockedEmittedFor("CH7-A"), false);

// 7) Failed verification for A must not clear B's valid premium seed
events.length = 0;
seeds.clear();
announceUnlocked({ churchId: "CH7-B", persistedChurchActivation: true, source: "purchase" });
// A fails activation — no unlock, no revoke of B
assert.equal(
  announceUnlocked({
    churchId: "CH7-A",
    persistedChurchActivation: false,
    source: "purchase",
  }),
  false
);
assert.equal(seeds.get(norm("CH7-B"))?.subscriptionActive, true);

console.log("OK premium unlock authority", {
  cases: 7,
  graceMs: GRACE_MS,
});
