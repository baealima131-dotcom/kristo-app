/**
 * Focused tests for all five iOS Church Subscription slot states.
 * Run: npx tsx scripts/verify-ios-premium-slot-statuses.ts
 */
import assert from "node:assert/strict";
import {
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP,
  IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
  isIosPremiumPurchaseSlotProductId,
} from "../lib/churchPremiumRevenueCat";
import {
  areAllIosPremiumSlotsOccupied,
  buildIosPremiumSlotOwnershipAttribution,
  iosPremiumSlotLabel,
  iosPremiumSlotStatusLabel,
  listIosPremiumSlotDescriptors,
  resolveAllIosPremiumSlotStatuses,
  resolveIosPremiumSlotOwnershipDisplay,
  resolveIosPremiumSlotStatus,
} from "../lib/iosPremiumSlotStatus";
import { selectIosPremiumNewPurchaseCatalogSlots } from "../apps/mobile/src/lib/payments/iosPremiumSlotStatus";

const G2 = IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g2;
const G3 = IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g3;
const G4 = IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g4;
const G5 = IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP.g5;

const CURRENT = "CH7-8ST0D5";
const OTHER_A = "CH1-AAAAAA";
const OTHER_B = "CH2-BBBBBB";

assert.deepEqual(
  [...IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS],
  [PREMIUM_MONTHLY_PRODUCT_ID],
  "only premium_monthly is purchasable"
);
assert.deepEqual(
  [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
  [PREMIUM_MONTHLY_PRODUCT_ID, G2, G3, G4, G5],
  "exactly five monthly products remain inspectable"
);

assert.equal(listIosPremiumSlotDescriptors().length, 5);
assert.deepEqual(
  listIosPremiumSlotDescriptors()
    .filter((slot) => isIosPremiumPurchaseSlotProductId(slot.productId))
    .map((slot) => slot.productId),
  [PREMIUM_MONTHLY_PRODUCT_ID],
  "legacy G2–G5 inspect cards are never purchasable"
);
assert.deepEqual(
  selectIosPremiumNewPurchaseCatalogSlots(listIosPremiumSlotDescriptors()).map(
    (slot) => slot.productId
  ),
  [PREMIUM_MONTHLY_PRODUCT_ID],
  "mobile renders one premium_monthly purchase card"
);
assert.equal(iosPremiumSlotLabel(PREMIUM_MONTHLY_PRODUCT_ID), "Monthly");
assert.equal(iosPremiumSlotLabel(G2), "G2");
assert.equal(iosPremiumSlotLabel(G5), "G5");

// 1) Available — fresh Apple catalog, nothing blocked
{
  const status = resolveIosPremiumSlotStatus({
    productId: G3,
    appleProductAvailable: true,
  });
  assert.equal(status, "available");
  assert.equal(iosPremiumSlotStatusLabel(status), "Available");
}

// 2) Already purchased for this church
{
  const status = resolveIosPremiumSlotStatus({
    productId: G2,
    appleProductAvailable: true,
    thisChurchProductIds: [G2],
    deviceOwnedProductIds: [G2],
  });
  assert.equal(status, "purchased_for_this_church");
  assert.equal(
    iosPremiumSlotStatusLabel(status),
    "Already purchased for this church"
  );
}

// 3) Already used by another Church ID (ownership mapping)
{
  const status = resolveIosPremiumSlotStatus({
    productId: G4,
    appleProductAvailable: true,
    otherChurchProductIds: [G4],
  });
  assert.equal(status, "used_by_another_church");
  assert.equal(
    iosPremiumSlotStatusLabel(status),
    "Already used by another Church ID"
  );
}

// 4) Unavailable from Apple — only when no ownership mapping claims the slot
{
  const status = resolveIosPremiumSlotStatus({
    productId: G5,
    appleProductAvailable: false,
  });
  assert.equal(status, "unavailable_from_apple");
  assert.equal(iosPremiumSlotStatusLabel(status), "Unavailable from Apple");
}

// StoreKit failure renders one unavailable purchase card, not five product errors.
{
  const resolved = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [],
  });
  const displayed = selectIosPremiumNewPurchaseCatalogSlots(resolved);
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0]?.productId, PREMIUM_MONTHLY_PRODUCT_ID);
  assert.equal(displayed[0]?.status, "unavailable_from_apple");
  assert.equal(displayed[0]?.purchaseEnabled, false);
}

// Ownership beats StoreKit unavailability (do not hide purchased/assigned behind Apple miss)
{
  assert.equal(
    resolveIosPremiumSlotStatus({
      productId: G2,
      appleProductAvailable: false,
      thisChurchProductIds: [G2],
    }),
    "purchased_for_this_church"
  );
  assert.equal(
    resolveIosPremiumSlotStatus({
      productId: G3,
      appleProductAvailable: false,
      otherChurchProductIds: [G3],
    }),
    "used_by_another_church"
  );
}

// Device-owned without this-church mapping → used by another / not purchasable
{
  const status = resolveIosPremiumSlotStatus({
    productId: PREMIUM_MONTHLY_PRODUCT_ID,
    appleProductAvailable: true,
    deviceOwnedProductIds: [PREMIUM_MONTHLY_PRODUCT_ID],
  });
  assert.equal(status, "used_by_another_church");
}

// Legacy yearly ownership blocks legacy monthly slot
{
  const status = resolveIosPremiumSlotStatus({
    productId: PREMIUM_MONTHLY_PRODUCT_ID,
    appleProductAvailable: true,
    deviceOwnedProductIds: [PREMIUM_YEARLY_PRODUCT_ID],
  });
  assert.equal(status, "used_by_another_church");
}

// Full five-card matrix for an unsubscribed church with mixed states
{
  const slots = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [
      PREMIUM_MONTHLY_PRODUCT_ID,
      G2,
      G3,
      G4,
      // G5 missing from Apple catalog
    ],
    thisChurchProductIds: [],
    otherChurchProductIds: [G2],
    deviceOwnedProductIds: [PREMIUM_MONTHLY_PRODUCT_ID],
    blockedProductIds: [G4],
  });

  assert.equal(slots.length, 5);
  assert.equal(slots[0]?.status, "used_by_another_church"); // monthly owned
  assert.equal(slots[1]?.status, "used_by_another_church"); // G2 other church
  assert.equal(slots[2]?.status, "available"); // G3 recognized, never purchasable
  assert.equal(slots[2]?.purchaseEnabled, false);
  assert.equal(slots[3]?.status, "used_by_another_church"); // G4 blocked
  assert.equal(slots[4]?.status, "unavailable_from_apple"); // G5 missing
  // New-purchase pool is only premium_monthly; when it is occupied, catalog is exhausted
  // even if legacy G slots still report status "available".
  assert.equal(areAllIosPremiumSlotsOccupied(slots), true);
  assert.equal(
    areAllIosPremiumSlotsOccupied(selectIosPremiumNewPurchaseCatalogSlots(slots)),
    true
  );
}

// All slots occupied
{
  const slots = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
    deviceOwnedProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
  });
  assert.equal(slots.every((slot) => slot.status !== "available"), true);
  assert.equal(areAllIosPremiumSlotsOccupied(slots), true);
}

// Purchase button only on premium_monthly when available — never on G2–G5
{
  const slots = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
    otherChurchProductIds: [G2, G3],
    deviceOwnedProductIds: [PREMIUM_MONTHLY_PRODUCT_ID],
  });
  const purchasable = slots.filter((slot) => slot.purchaseEnabled).map((s) => s.productId);
  assert.deepEqual(purchasable, [], "owned premium_monthly blocks new purchase");

  const freeMonthly = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
    otherChurchProductIds: [G2, G3],
  });
  assert.deepEqual(
    freeMonthly.filter((slot) => slot.purchaseEnabled).map((s) => s.productId),
    [PREMIUM_MONTHLY_PRODUCT_ID],
    "only premium_monthly can be purchase-enabled"
  );
  assert.equal(
    freeMonthly.filter((slot) => slot.productId !== PREMIUM_MONTHLY_PRODUCT_ID).every(
      (slot) => slot.purchaseEnabled === false
    ),
    true,
    "legacy G2–G5 never purchase-enabled even when available"
  );
}

// Subscribed church catalog: all five stay visible, none purchasable here
{
  const slots = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [
      PREMIUM_MONTHLY_PRODUCT_ID,
      G2,
      G3,
      G4,
      // G5 missing from Apple catalog
    ],
    thisChurchProductIds: [G3],
    otherChurchProductIds: [G2],
    currentChurchSubscribed: true,
  });

  assert.equal(slots.length, 5);
  assert.equal(slots[0]?.status, "available_for_another_church"); // monthly free
  assert.equal(slots[0]?.statusLabel, "Available for another Church ID");
  assert.equal(slots[1]?.status, "used_by_another_church"); // G2 other church
  assert.equal(slots[2]?.status, "purchased_for_this_church"); // G3 active plan
  assert.equal(slots[3]?.status, "available_for_another_church"); // G4 free
  assert.equal(slots[4]?.status, "unavailable_from_apple"); // G5 missing
  assert.equal(
    slots.every((slot) => slot.purchaseEnabled === false),
    true
  );
  // A subscribed church must not be told the Apple ID is exhausted.
  assert.equal(areAllIosPremiumSlotsOccupied(slots), true);
}

// currentChurchSubscribed=false keeps premium_monthly purchasable only
{
  const slots = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
    thisChurchProductIds: [],
    otherChurchProductIds: [G2],
    currentChurchSubscribed: false,
  });
  assert.equal(
    slots.filter((slot) => slot.status === "available_for_another_church").length,
    0
  );
  assert.equal(slots.filter((slot) => slot.purchaseEnabled).length, 1);
  assert.equal(slots.find((slot) => slot.purchaseEnabled)?.productId, PREMIUM_MONTHLY_PRODUCT_ID);
}

// --- Ownership attribution ---
// One mapped slot shows exactly that Church ID; unassigned slots do not repeat currentChurchId.
{
  const statuses = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
    thisChurchProductIds: [PREMIUM_MONTHLY_PRODUCT_ID],
    otherChurchProductIds: [G2],
    currentChurchSubscribed: true,
  });
  const rows = buildIosPremiumSlotOwnershipAttribution({
    currentChurchId: CURRENT,
    ownershipInspectionOk: true,
    mappedByProductId: {
      [PREMIUM_MONTHLY_PRODUCT_ID]: CURRENT,
      [G2]: OTHER_A,
    },
    slots: statuses.map((slot) => ({
      productId: slot.productId,
      status: slot.status,
      mappedChurchId: null,
    })),
  });

  assert.equal(rows[0]?.ownership.label, "SUBSCRIBED CHURCH ID");
  assert.equal(rows[0]?.ownership.value, CURRENT);
  assert.equal(rows[1]?.ownership.label, "ASSIGNED CHURCH ID");
  assert.equal(rows[1]?.ownership.value, OTHER_A);
  assert.equal(rows[2]?.ownership.value, "No Church ID assigned");
  assert.equal(rows[3]?.ownership.value, "No Church ID assigned");
  assert.equal(rows[4]?.ownership.value, "No Church ID assigned");

  const displayedIds = rows
    .map((row) => row.ownership.value)
    .filter((value) => /^CH/i.test(value));
  assert.deepEqual(displayedIds, [CURRENT, OTHER_A]);
  assert.equal(
    rows.filter((row) => row.ownership.value === CURRENT).length,
    1,
    "current Church ID appears on exactly one mapped slot"
  );
}

// StoreKit-unavailable cards do not appear purchased / do not claim current Church ID
{
  const ownership = resolveIosPremiumSlotOwnershipDisplay({
    status: "unavailable_from_apple",
    currentChurchId: CURRENT,
    mappedChurchId: null,
    ownershipInspectionOk: true,
  });
  assert.equal(ownership.value, "No Church ID assigned");
  assert.notEqual(ownership.value, CURRENT);
  assert.notEqual(ownership.label, "SUBSCRIBED CHURCH ID");
}

// Inspect failure never fabricates Church ID ownership across slots
{
  const statuses = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
    // Inspect failed → client must not pass fabricated this/other mappings
    thisChurchProductIds: [],
    otherChurchProductIds: [],
    currentChurchSubscribed: true,
  });
  const rows = buildIosPremiumSlotOwnershipAttribution({
    currentChurchId: CURRENT,
    ownershipInspectionOk: false,
    mappedByProductId: {
      // Stale local map must be ignored when inspect failed
      [PREMIUM_MONTHLY_PRODUCT_ID]: CURRENT,
      [G2]: CURRENT,
      [G3]: CURRENT,
      [G4]: CURRENT,
      [G5]: CURRENT,
    },
    slots: statuses.map((slot) => ({
      productId: slot.productId,
      status: slot.status,
      mappedChurchId: CURRENT, // must be ignored
    })),
  });

  for (const row of rows) {
    assert.equal(row.mappedChurchId, null);
    assert.notEqual(row.ownership.value, CURRENT);
    assert.match(
      row.ownership.value,
      /^(No Church ID assigned|Ownership unavailable)$/
    );
  }
}

// Duplicate Church ID across slots only when backend truly mapped both
{
  const statuses = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
    thisChurchProductIds: [PREMIUM_MONTHLY_PRODUCT_ID, G3],
    otherChurchProductIds: [G2],
    currentChurchSubscribed: true,
  });
  const rows = buildIosPremiumSlotOwnershipAttribution({
    currentChurchId: CURRENT,
    ownershipInspectionOk: true,
    mappedByProductId: {
      [PREMIUM_MONTHLY_PRODUCT_ID]: CURRENT,
      [G3]: CURRENT,
      [G2]: OTHER_B,
    },
    slots: statuses.map((slot) => ({
      productId: slot.productId,
      status: slot.status,
    })),
  });
  assert.equal(
    rows.filter((row) => row.ownership.value === CURRENT).length,
    2,
    "duplicate current Church ID only when backend mapped two slots"
  );
  assert.equal(rows.find((row) => row.productId === G2)?.status, "used_by_another_church");
  assert.equal(rows.find((row) => row.productId === G2)?.ownership.value, OTHER_B);
}

// available (purchase flow) may show current Church ID; available_for_another_church must not
{
  const purchaseFlow = resolveIosPremiumSlotOwnershipDisplay({
    status: "available",
    currentChurchId: CURRENT,
    mappedChurchId: null,
    ownershipInspectionOk: true,
  });
  assert.equal(purchaseFlow.label, "AVAILABLE FOR CHURCH ID");
  assert.equal(purchaseFlow.value, CURRENT);

  const catalogFree = resolveIosPremiumSlotOwnershipDisplay({
    status: "available_for_another_church",
    currentChurchId: CURRENT,
    mappedChurchId: null,
    ownershipInspectionOk: true,
  });
  assert.equal(catalogFree.value, "No Church ID assigned");
  assert.match(catalogFree.note || "", /unsubscribed church/i);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      slotCount: 5,
      productIds: [...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS],
      statusesCovered: [
        "available",
        "available_for_another_church",
        "purchased_for_this_church",
        "used_by_another_church",
        "unavailable_from_apple",
      ],
      ownershipAttributionCovered: true,
    },
    null,
    2
  )
);
