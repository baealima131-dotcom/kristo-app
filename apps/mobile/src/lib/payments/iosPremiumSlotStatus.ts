/**
 * Mobile-local iOS Church Subscription slot-status helpers.
 * Values/logic must match lib/iosPremiumSlotStatus.ts (server).
 */
import {
  IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
  iosPremiumPurchaseSlotGroupFromProductId,
  type IosPremiumPurchaseSlotGroup,
} from "./churchPremiumRevenueCat";

export type IosPremiumSlotStatusCode =
  | "available"
  /** Free slot, but the viewing Church ID is already subscribed — catalog display only. */
  | "available_for_another_church"
  | "purchased_for_this_church"
  | "used_by_another_church"
  | "unavailable_from_apple";

export type IosPremiumSlotDescriptor = {
  productId: (typeof IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS)[number];
  group: IosPremiumPurchaseSlotGroup;
  slotLabel: string;
  subscriptionGroupName: string;
};

function toIdSet(values: Iterable<string> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!values) return out;
  for (const value of values) {
    const id = String(value || "").trim();
    if (id) out.add(id);
  }
  return out;
}

export function iosPremiumSlotLabel(productId: string | null | undefined): string {
  const id = String(productId || "").trim();
  if (id === PREMIUM_MONTHLY_PRODUCT_ID) return "Monthly";
  const group = iosPremiumPurchaseSlotGroupFromProductId(id);
  if (group && group !== "legacy") return group.toUpperCase();
  return id || "Unknown";
}

export function iosPremiumSubscriptionGroupName(
  group: IosPremiumPurchaseSlotGroup | null | undefined
): string {
  if (!group || group === "legacy") return "Kristo Premium";
  return `Kristo Premium ${group.toUpperCase()}`;
}

export function iosPremiumSlotStatusLabel(status: IosPremiumSlotStatusCode): string {
  switch (status) {
    case "available":
      return "Available";
    case "available_for_another_church":
      return "Available for another Church ID";
    case "purchased_for_this_church":
      return "Already purchased for this church";
    case "used_by_another_church":
      return "Already used by another Church ID";
    case "unavailable_from_apple":
      return "Unavailable from Apple";
    default:
      return "Unavailable from Apple";
  }
}

export function listIosPremiumSlotDescriptors(): IosPremiumSlotDescriptor[] {
  return IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS.map((productId) => {
    const group = iosPremiumPurchaseSlotGroupFromProductId(productId) || "legacy";
    return {
      productId,
      group,
      slotLabel: iosPremiumSlotLabel(productId),
      subscriptionGroupName: iosPremiumSubscriptionGroupName(group),
    };
  });
}

export function resolveIosPremiumSlotStatus(args: {
  productId: string;
  appleProductAvailable: boolean;
  thisChurchProductIds?: Iterable<string> | null;
  otherChurchProductIds?: Iterable<string> | null;
  deviceOwnedProductIds?: Iterable<string> | null;
  blockedProductIds?: Iterable<string> | null;
}): IosPremiumSlotStatusCode {
  const productId = String(args.productId || "").trim();
  if (!productId) return "unavailable_from_apple";

  const thisChurch = toIdSet(args.thisChurchProductIds);
  if (thisChurch.has(productId)) return "purchased_for_this_church";

  const otherChurch = toIdSet(args.otherChurchProductIds);
  if (otherChurch.has(productId)) return "used_by_another_church";

  // StoreKit/catalog availability is independent of ownership.
  if (!args.appleProductAvailable) return "unavailable_from_apple";

  const owned = toIdSet(args.deviceOwnedProductIds);
  if (owned.has(productId)) return "used_by_another_church";
  if (
    productId === PREMIUM_MONTHLY_PRODUCT_ID &&
    owned.has(PREMIUM_YEARLY_PRODUCT_ID)
  ) {
    return "used_by_another_church";
  }

  const blocked = toIdSet(args.blockedProductIds);
  if (blocked.has(PREMIUM_YEARLY_PRODUCT_ID) || blocked.has(PREMIUM_MONTHLY_PRODUCT_ID)) {
    blocked.add(PREMIUM_MONTHLY_PRODUCT_ID);
  }
  if (blocked.has(productId)) return "used_by_another_church";

  return "available";
}

export function resolveAllIosPremiumSlotStatuses(args: {
  /**
   * null/undefined = Apple catalog not supplied (do not mark unavailable_from_apple).
   * Provided set (even empty) = only listed IDs are available from Apple.
   */
  appleAvailableProductIds?: Iterable<string> | null;
  thisChurchProductIds?: Iterable<string> | null;
  otherChurchProductIds?: Iterable<string> | null;
  deviceOwnedProductIds?: Iterable<string> | null;
  blockedProductIds?: Iterable<string> | null;
  /**
   * True when the viewing Church ID already has an active subscription.
   * Free slots stay visible for App Review but are never purchasable here.
   */
  currentChurchSubscribed?: boolean;
}): Array<
  IosPremiumSlotDescriptor & {
    status: IosPremiumSlotStatusCode;
    statusLabel: string;
    purchaseEnabled: boolean;
  }
> {
  const appleCatalogProvided = args.appleAvailableProductIds != null;
  const available = toIdSet(args.appleAvailableProductIds);
  return listIosPremiumSlotDescriptors().map((slot) => {
    const resolved = resolveIosPremiumSlotStatus({
      productId: slot.productId,
      appleProductAvailable: appleCatalogProvided ? available.has(slot.productId) : true,
      thisChurchProductIds: args.thisChurchProductIds,
      otherChurchProductIds: args.otherChurchProductIds,
      deviceOwnedProductIds: args.deviceOwnedProductIds,
      blockedProductIds: args.blockedProductIds,
    });
    const status: IosPremiumSlotStatusCode =
      args.currentChurchSubscribed === true && resolved === "available"
        ? "available_for_another_church"
        : resolved;
    const purchasable = slot.productId === PREMIUM_MONTHLY_PRODUCT_ID;
    return {
      ...slot,
      status,
      statusLabel: iosPremiumSlotStatusLabel(status),
      // Only premium_monthly may ever be purchased. G2–G5 stay recognition-only.
      purchaseEnabled: purchasable && status === "available",
    };
  });
}

/**
 * True when no new-purchase product remains.
 * Only premium_monthly counts; legacy G2–G5 "available" status is ignored.
 */
export function areAllIosPremiumSlotsOccupied(
  slots: Array<{
    status: IosPremiumSlotStatusCode;
    purchaseEnabled?: boolean;
    productId?: string;
  }>
): boolean {
  if (!slots.length) return false;
  const purchasePool = slots.filter((slot) => {
    const id = String(slot.productId || "").trim();
    if (!id) return true; // caller already filtered to the purchase catalog
    return id === PREMIUM_MONTHLY_PRODUCT_ID;
  });
  const relevant = purchasePool.length ? purchasePool : slots;
  return relevant.every(
    (slot) => slot.status !== "available" && slot.purchaseEnabled !== true
  );
}

/** Mobile purchase UI policy: display premium_monthly only; legacy slots stay diagnostic. */
export function selectIosPremiumNewPurchaseCatalogSlots<
  T extends { productId: string },
>(slots: readonly T[]): T[] {
  return slots.filter(
    (slot) => String(slot.productId || "").trim() === PREMIUM_MONTHLY_PRODUCT_ID
  );
}

export type IosPremiumSlotOwnershipDisplay = {
  /** Uppercase field label shown above the Church ID value. */
  label: string;
  /** Mapped Church ID, current Church ID (purchase flow only), or a non-ID placeholder. */
  value: string;
  /** Optional guidance under the value (catalog free slots). */
  note: string | null;
};

function normalizeChurchId(value: string | null | undefined): string | null {
  const id = String(value || "").trim().toUpperCase();
  return id || null;
}

/**
 * Per-card Church ID attribution for the five-slot catalog.
 * Never copies currentChurchId onto unassigned / unknown / other-church slots.
 */
export function resolveIosPremiumSlotOwnershipDisplay(args: {
  status: IosPremiumSlotStatusCode;
  currentChurchId?: string | null;
  mappedChurchId?: string | null;
  /** False when backend inspect failed — do not invent ownership. */
  ownershipInspectionOk: boolean;
}): IosPremiumSlotOwnershipDisplay {
  const current = normalizeChurchId(args.currentChurchId);
  const mapped = normalizeChurchId(args.mappedChurchId);

  switch (args.status) {
    case "purchased_for_this_church":
      if (!args.ownershipInspectionOk) {
        return {
          label: "CHURCH ID ASSIGNMENT",
          value: "Ownership unavailable",
          note: null,
        };
      }
      return {
        label: "SUBSCRIBED CHURCH ID",
        // Prefer backend mapping; status itself already means this church owns the slot.
        value: mapped || current || "—",
        note: null,
      };
    case "used_by_another_church":
      return {
        label: "ASSIGNED CHURCH ID",
        value: mapped || "Ownership unavailable",
        note: null,
      };
    case "available":
      return {
        label: "AVAILABLE FOR CHURCH ID",
        value: current || "—",
        note: null,
      };
    case "available_for_another_church":
      return {
        label: "CHURCH ID ASSIGNMENT",
        value: "No Church ID assigned",
        note: "Switch to or create an unsubscribed church to use this slot.",
      };
    case "unavailable_from_apple":
      if (!args.ownershipInspectionOk) {
        return {
          label: "CHURCH ID ASSIGNMENT",
          value: "Ownership unavailable",
          note: null,
        };
      }
      if (mapped) {
        const isThisChurch = Boolean(current && mapped === current);
        return {
          label: isThisChurch ? "SUBSCRIBED CHURCH ID" : "ASSIGNED CHURCH ID",
          value: mapped,
          note: null,
        };
      }
      return {
        label: "CHURCH ID ASSIGNMENT",
        value: "No Church ID assigned",
        note: null,
      };
    default:
      return {
        label: "CHURCH ID ASSIGNMENT",
        value: args.ownershipInspectionOk ? "No Church ID assigned" : "Ownership unavailable",
        note: null,
      };
  }
}

/**
 * Build attribution rows for tests / logging. Does not invent Church IDs on inspect failure.
 */
export function buildIosPremiumSlotOwnershipAttribution(args: {
  currentChurchId: string;
  ownershipInspectionOk: boolean;
  mappedByProductId?: Record<string, string> | null;
  slots: Array<{
    productId: string;
    status: IosPremiumSlotStatusCode;
    mappedChurchId?: string | null;
  }>;
}): Array<{
  productId: string;
  status: IosPremiumSlotStatusCode;
  mappedChurchId: string | null;
  ownership: IosPremiumSlotOwnershipDisplay;
}> {
  const mappedByProductId = args.mappedByProductId || {};
  return args.slots.map((slot) => {
    const fromMap = normalizeChurchId(mappedByProductId[slot.productId]);
    const fromSlot = normalizeChurchId(slot.mappedChurchId);
    const mappedChurchId = args.ownershipInspectionOk ? fromSlot || fromMap : null;
    return {
      productId: slot.productId,
      status: slot.status,
      mappedChurchId,
      ownership: resolveIosPremiumSlotOwnershipDisplay({
        status: slot.status,
        currentChurchId: args.currentChurchId,
        mappedChurchId,
        ownershipInspectionOk: args.ownershipInspectionOk,
      }),
    };
  });
}
