/**
 * Quick verification of single-product purchase + legacy recognition helpers.
 * Run: npx tsx scripts/verify-ios-premium-rotation.ts
 */
import assert from "node:assert/strict";
import {
  assignIosPremiumMonthlyProduct,
  CHURCH_PREMIUM_PRODUCT_IDS,
  IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS,
  IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS,
  isChurchPremiumProductId,
  isIosPremiumPurchaseSlotProductId,
  isIosPremiumRecognizedMonthlyProductId,
  isIosPremiumRotationMonthlyProductId,
  isMonthlyChurchPremiumProductId,
  isYearlyChurchPremiumProductId,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
} from "../lib/churchPremiumRevenueCat";
import { pickFirstAvailableIosPurchaseSlot } from "../app/api/_lib/iosPremiumProductAssignment";
import { planFromProductId } from "../app/api/_lib/revenuecat";

assert.deepEqual(
  [...IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS],
  ["premium_monthly"]
);
assert.deepEqual(
  [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
  [
    "premium_monthly",
    "church_premium_monthly_g2",
    "church_premium_monthly_g3",
    "church_premium_monthly_g4",
    "church_premium_monthly_g5",
  ]
);

assert.equal(pickFirstAvailableIosPurchaseSlot([])?.productId, PREMIUM_MONTHLY_PRODUCT_ID);
assert.equal(
  pickFirstAvailableIosPurchaseSlot([PREMIUM_MONTHLY_PRODUCT_ID, PREMIUM_YEARLY_PRODUCT_ID]),
  null
);

const a = assignIosPremiumMonthlyProduct("CH7-TEST");
const b = assignIosPremiumMonthlyProduct("CH7-TEST");
assert.equal(a.productId, b.productId, "hash helper sticky per churchId");
assert.ok(
  (IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS as readonly string[]).includes(a.productId),
  "hash helper stays within G2–G5"
);
assert.equal(isIosPremiumRotationMonthlyProductId(PREMIUM_MONTHLY_PRODUCT_ID), false);
assert.equal(isIosPremiumPurchaseSlotProductId(PREMIUM_MONTHLY_PRODUCT_ID), true);
assert.equal(isIosPremiumPurchaseSlotProductId(PREMIUM_YEARLY_PRODUCT_ID), false);
assert.equal(isIosPremiumPurchaseSlotProductId("church_premium_monthly_g3"), false);
assert.equal(isIosPremiumRecognizedMonthlyProductId("church_premium_monthly_g3"), true);
assert.equal(isMonthlyChurchPremiumProductId("church_premium_monthly_g3"), true);
assert.equal(isMonthlyChurchPremiumProductId(PREMIUM_MONTHLY_PRODUCT_ID), true);
assert.equal(isYearlyChurchPremiumProductId(PREMIUM_YEARLY_PRODUCT_ID), true);
assert.equal(planFromProductId("church_premium_monthly_g4"), "monthly");
assert.equal(planFromProductId(PREMIUM_YEARLY_PRODUCT_ID), "yearly");
assert.equal(planFromProductId(PREMIUM_MONTHLY_PRODUCT_ID), "monthly");
assert.ok(isChurchPremiumProductId("church_premium_monthly_g5"));
assert.ok(CHURCH_PREMIUM_PRODUCT_IDS.includes(PREMIUM_MONTHLY_PRODUCT_ID));
assert.ok(CHURCH_PREMIUM_PRODUCT_IDS.includes(PREMIUM_YEARLY_PRODUCT_ID));

console.log("OK ios premium single-product policy", {
  newPurchaseProducts: IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  hashHelperSample: a,
  rotationCount: IOS_PREMIUM_ROTATION_MONTHLY_PRODUCT_IDS.length,
  purchaseSlotCount: IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS.length,
  recognizedCount: CHURCH_PREMIUM_PRODUCT_IDS.length,
});
