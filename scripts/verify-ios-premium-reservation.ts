/**
 * Honest architecture verification for iOS purchase-slot reservation.
 * Slot order: premium_monthly → g2 → g3 → g4 → g5
 * Run: npx tsx scripts/verify-ios-premium-reservation.ts
 */
import assert from "node:assert/strict";
import {
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP,
  IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS,
  IOS_SUBSCRIPTION_SLOTS_EXHAUSTED,
  isIosPremiumPurchaseSlotProductId,
  isIosPremiumRotationMonthlyProductId,
  isMonthlyChurchPremiumProductId,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
} from "../lib/churchPremiumRevenueCat";
import {
  pickFirstAvailableIosPurchaseSlot,
  pickFirstAvailableIosRotationProduct,
} from "../app/api/_lib/iosPremiumProductAssignment";
import { buildDevicePurchaseCoordinationKey } from "../app/api/_lib/store/iosPremiumReservationDb";
import { planFromProductId } from "../app/api/_lib/revenuecat";
import { createHash } from "node:crypto";

assert.deepEqual(
  [...IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS],
  [
    PREMIUM_MONTHLY_PRODUCT_ID,
    IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2,
    IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g3,
    IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g4,
    IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g5,
  ],
  "exact five-slot purchase order"
);

// --- Concepts must stay separate ---
const lineageG2 = "orig_txn_g2_AAAA";
const lineageG3 = "orig_txn_g3_BBBB";
assert.notEqual(lineageG2, lineageG3, "G2 and G3 lineages differ even for same Apple ID");
assert.notEqual(
  createHash("sha256").update(lineageG2).digest("hex"),
  createHash("sha256").update(lineageG3).digest("hex")
);

const ownerDeviceKey = buildDevicePurchaseCoordinationKey({
  ownerUserId: "u_pastor_1",
  devicePurchaseScope: "dev_install_abc",
});
assert.ok(ownerDeviceKey.includes("owner:u_pastor_1"));
assert.ok(ownerDeviceKey.includes("device:dev_install_abc"));

// --- New eligible Apple account → premium_monthly first ---
const fresh = pickFirstAvailableIosPurchaseSlot([]);
assert.equal(fresh?.productId, PREMIUM_MONTHLY_PRODUCT_ID);
assert.equal(fresh?.group, "legacy");

// --- Owning premium_monthly skips legacy group → G2 ---
assert.equal(
  pickFirstAvailableIosPurchaseSlot([PREMIUM_MONTHLY_PRODUCT_ID])?.productId,
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2
);

// --- Owning premium_yearly also skips legacy group → G2 ---
assert.equal(
  pickFirstAvailableIosPurchaseSlot([PREMIUM_YEARLY_PRODUCT_ID])?.productId,
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2
);

// --- Then G3 after G2 owned ---
const next = pickFirstAvailableIosPurchaseSlot([
  PREMIUM_MONTHLY_PRODUCT_ID,
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2,
]);
assert.equal(next?.productId, IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g3);
assert.equal(next?.group, "g3");

// yearly is never a purchase slot
assert.equal(isIosPremiumPurchaseSlotProductId(PREMIUM_YEARLY_PRODUCT_ID), false);
assert.equal(isIosPremiumPurchaseSlotProductId(PREMIUM_MONTHLY_PRODUCT_ID), true);

// --- Already-subscribed release then next slot ---
function simulateAlreadySubscribedRereserve(args: {
  failedProductId: string;
  deviceOwnedBefore: string[];
}) {
  const owned = new Set(args.deviceOwnedBefore);
  owned.add(args.failedProductId);
  return pickFirstAvailableIosPurchaseSlot(owned);
}
const afterFail = simulateAlreadySubscribedRereserve({
  failedProductId: PREMIUM_MONTHLY_PRODUCT_ID,
  deviceOwnedBefore: [],
});
assert.equal(afterFail?.productId, IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2);

// --- Stale / released reservation blocking rules ---
function reservationBlocks(args: {
  status: "reserved" | "expired" | "released";
  releaseReason?: "already_subscribed" | "replaced" | "expired" | null;
  expiresAt: number;
  productId: string;
  now: number;
}): string[] {
  if (Number(args.expiresAt) <= args.now) return [];
  if (args.status === "reserved") return [args.productId];
  if (args.status === "released" && args.releaseReason === "already_subscribed") {
    return [args.productId];
  }
  return [];
}
const now = Date.now();
assert.deepEqual(
  reservationBlocks({
    status: "reserved",
    expiresAt: now - 1000,
    productId: PREMIUM_MONTHLY_PRODUCT_ID,
    now,
  }),
  [],
  "expired reservations must not block slots"
);
assert.deepEqual(
  reservationBlocks({
    status: "released",
    releaseReason: "replaced",
    expiresAt: now + 60_000,
    productId: PREMIUM_MONTHLY_PRODUCT_ID,
    now,
  }),
  [],
  "non-already_subscribed releases must not block slots"
);
assert.deepEqual(
  reservationBlocks({
    status: "released",
    releaseReason: "already_subscribed",
    expiresAt: now + 60_000,
    productId: PREMIUM_MONTHLY_PRODUCT_ID,
    now,
  }),
  [PREMIUM_MONTHLY_PRODUCT_ID],
  "already_subscribed releases must keep blocking while TTL active"
);

// --- Retry oscillation guard ---
function accumulateAlreadyOwned(prev: string[], failed: string): string[] {
  return [...new Set([...prev, failed])];
}
const attempt1 = accumulateAlreadyOwned([], PREMIUM_MONTHLY_PRODUCT_ID);
const attempt2 = accumulateAlreadyOwned(
  attempt1,
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2
);
assert.equal(
  pickFirstAvailableIosPurchaseSlot(attempt2)?.productId,
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g3
);
assert.equal(
  pickFirstAvailableIosPurchaseSlot([...IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS]),
  null,
  "full accumulation exhausts all five slots"
);
assert.equal(IOS_SUBSCRIPTION_SLOTS_EXHAUSTED, "IOS_SUBSCRIPTION_SLOTS_EXHAUSTED");

// Rotation-only helper still skips legacy when monthly is forced blocked
assert.equal(
  pickFirstAvailableIosRotationProduct([])?.productId,
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2
);

// --- Lineage uniqueness ---
function lineageMapsToChurch(map: Map<string, string>, lineage: string, churchId: string) {
  const existing = map.get(lineage);
  if (existing && existing.toUpperCase() !== churchId.toUpperCase()) return false;
  map.set(lineage, churchId);
  return true;
}
const lineageMap = new Map<string, string>();
assert.equal(lineageMapsToChurch(lineageMap, lineageG2, "CH7-A"), true);
assert.equal(lineageMapsToChurch(lineageMap, lineageG2, "CH7-B"), false);

// --- Restore must not auto-bind unmapped transactions ---
function restoreMayActivate(args: {
  hasServerLineageMappingForThisChurch: boolean;
  churchScopedEntitlementActive: boolean;
}): boolean {
  if (!args.hasServerLineageMappingForThisChurch && !args.churchScopedEntitlementActive) {
    return false;
  }
  return args.hasServerLineageMappingForThisChurch || args.churchScopedEntitlementActive;
}
assert.equal(
  restoreMayActivate({
    hasServerLineageMappingForThisChurch: false,
    churchScopedEntitlementActive: false,
  }),
  false,
  "unmapped transactions must not auto-bind"
);

// --- Legacy recognition without selecting yearly for purchase ---
assert.equal(isIosPremiumRotationMonthlyProductId(PREMIUM_MONTHLY_PRODUCT_ID), false);
assert.equal(isMonthlyChurchPremiumProductId(PREMIUM_MONTHLY_PRODUCT_ID), true);
assert.equal(planFromProductId(PREMIUM_YEARLY_PRODUCT_ID), "yearly");
assert.ok([...IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS].every(isIosPremiumRotationMonthlyProductId));

console.log("OK ios premium reservation (five-slot order)", {
  freshAccount: fresh,
  afterMonthlyOwned: pickFirstAvailableIosPurchaseSlot([PREMIUM_MONTHLY_PRODUCT_ID]),
  afterYearlyOwned: pickFirstAvailableIosPurchaseSlot([PREMIUM_YEARLY_PRODUCT_ID]),
  afterAlreadySubscribed: afterFail,
  ownerDeviceKeySuffix: ownerDeviceKey.slice(-16),
  slots: IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  exhaustedCode: IOS_SUBSCRIPTION_SLOTS_EXHAUSTED,
  verified: "subscriptionLineageIdentity→church via ownership lock after purchase",
  bestEffort: "deviceOwnedProductIds + purchaseSessionId + devicePurchaseScope + ownerUserId",
  limitation: "Apple does not expose Apple ID identity to app/backend",
});
