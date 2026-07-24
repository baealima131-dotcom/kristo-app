/**
 * iOS premium purchase-slot reservation — architecture notes
 *
 * New iOS monthly purchases use premium_monthly only.
 *
 * premium_yearly and church_premium_monthly_g2…g5 are recognition-only.
 * They remain valid for entitlement, ownership inspection, and restore, but are
 * never reserved or assigned for a new purchase.
 *
 * Concepts (do not conflate):
 * 1) subscriptionLineageIdentity = App Store originalTransactionId
 *    Identifies ONE subscription lineage in ONE ASC group. Never call this a
 *    "purchaser identity" or Apple ID.
 *
 * 2) appOwnerScope = Kristo ownerUserId (session-authenticated pastor).
 *
 * 3) devicePurchaseScope = best-effort app installation id from the device.
 *    Coordinates reservations + deviceOwnedProductIds. NOT Apple ID.
 *
 * Verified (server):
 * - After purchase: originalTransactionId → churchId via ownership lock
 * - Entitlement + store lineage required to activate (not entitlement alone)
 *
 * Best-effort (device):
 * - deviceOwnedProductIds from StoreKit/RevenueCat CustomerInfo
 * - purchaseSessionId / devicePurchaseScope coordination
 *
 * Remaining limitation: Apple does not expose Apple ID identity to app/backend.
 */
import {
  IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP,
  IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS,
  IOS_SUBSCRIPTION_SLOTS_EXHAUSTED,
  iosPremiumPurchaseSlotGroupFromProductId,
  isIosPremiumPurchaseSlotProductId,
  isIosPremiumRecognizedMonthlyProductId,
  isIosPremiumRotationMonthlyProductId,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
  type IosPremiumPurchaseSlotGroup,
} from "@/lib/churchPremiumRevenueCat";
import {
  getChurchMediaByChurchId,
  upsertChurchMedia,
  type ChurchMediaProfile,
} from "@/app/api/_lib/store/mediaDb";
import {
  createIosPremiumPurchaseSessionId,
  createIosPremiumReservationId,
  defaultIosPremiumReservationTtlMs,
  ensureIosPremiumReservationStoreReady,
  expireStaleIosPremiumReservations,
  getIosPremiumReservationById,
  isIosPremiumReservationSlotConflict,
  listIosPremiumReservationsByChurchId,
  listSlotBlockingIosPremiumReservationsForOwnerDevice,
  saveIosPremiumReservation,
  type IosPremiumReservationRecord,
} from "@/app/api/_lib/store/iosPremiumReservationDb";
import { listSubscriptionOwnershipLocksByOwnerUserId } from "@/app/api/_lib/store/subscriptionOwnershipLockDb";
import type { ChurchPremiumVerification } from "@/app/api/_lib/revenuecat";
import { shortIdentityHash } from "@/app/api/_lib/storeIdentityHash";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";
import {
  areAllIosPremiumSlotsOccupied,
  iosPremiumSlotLabel,
  iosPremiumSubscriptionGroupName,
  resolveAllIosPremiumSlotStatuses,
  type IosPremiumSlotStatusCode,
} from "@/lib/iosPremiumSlotStatus";

export class IosSubscriptionSlotsExhaustedError extends Error {
  readonly code = IOS_SUBSCRIPTION_SLOTS_EXHAUSTED;

  constructor(
    message = "premium_monthly is not available for a new iOS purchase in this device/account context."
  ) {
    super(message);
    this.name = "IosSubscriptionSlotsExhaustedError";
  }
}

export class IosPremiumMonthlyOwnershipConflictError extends Error {
  readonly code = "IOS_PREMIUM_MONTHLY_OWNERSHIP_CONFLICT";
  readonly productId = PREMIUM_MONTHLY_PRODUCT_ID;

  constructor(
    message =
      "premium_monthly is already owned or assigned in this Apple purchase context. Restore it for its permanently mapped Church ID or manage the existing subscription. Kristo will not substitute a legacy G2–G5 product."
  ) {
    super(message);
    this.name = "IosPremiumMonthlyOwnershipConflictError";
  }
}

export type IosPremiumPurchaseProductAssignment = {
  platform: "ios";
  plan: "monthly";
  group: IosPremiumPurchaseSlotGroup;
  productId: string;
  subscriptionGroupName: string;
  sticky: boolean;
  reservationId: string;
  purchaseSessionId: string;
  devicePurchaseScope: string;
  appOwnerScope: string;
  /** Best-effort only — never claim this proves Apple ID. */
  coordination: "best_effort_device_and_owner";
  blockedProductIds: string[];
  deviceOwnedProductIds: string[];
  expiresAt: number;
};

export type ReserveIosPremiumPurchaseProductArgs = {
  churchId: string;
  ownerUserId: string;
  /** Opaque purchase-attempt chain id (client may reuse within one flow). */
  purchaseSessionId?: string | null;
  /** Non-sensitive app installation scope from device (NOT Apple ID). */
  devicePurchaseScope: string;
  /**
   * Complete set of currently owned/active Kristo iOS product IDs from
   * StoreKit/RevenueCat on this device (legacy + G2–G5).
   */
  deviceOwnedProductIds?: string[] | null;
  /**
   * Pastor-selected monthly slot from the five-card paywall.
   * When set, reserve exactly this product (no silent rotation to another slot).
   */
  preferredProductId?: string | null;
};

/**
 * Where a slot's ownership signal originated. Separates authoritative Church ID
 * mappings from device/reservation-only signals and truly free slots.
 */
export type IosPremiumSlotAssignmentSource =
  /** Active subscription ownership lock (originalTransactionId → productId → Church ID). */
  | "ownership_lock"
  /** church_media.iosPremiumProductId sticky assignment for this church. */
  | "church_media_sticky"
  /** Device/RevenueCat reported the product owned, but no Church ID mapping exists. */
  | "device_owned"
  /** Blocked by another church's active reservation (no Church ID mapping exposed). */
  | "reservation"
  /** No ownership signal — slot is free. */
  | "none";

export type IosPremiumPurchaseSlotInspectionSlot = {
  productId: string;
  group: IosPremiumPurchaseSlotGroup;
  slotLabel: string;
  subscriptionGroupName: string;
  status: IosPremiumSlotStatusCode;
  statusLabel: string;
  purchaseEnabled: boolean;
  /** True only for premium_monthly; G2–G5 are legacy diagnostics. */
  purchasable: boolean;
  /** True for legacy G2–G5 products; never offered for new purchases. */
  legacy: boolean;
  mappedChurchId: string | null;
  assignmentSource: IosPremiumSlotAssignmentSource;
};

export type IosPremiumPurchaseSlotInspection = {
  platform: "ios";
  churchId: string;
  slots: IosPremiumPurchaseSlotInspectionSlot[];
  blockedProductIds: string[];
  deviceOwnedProductIds: string[];
  thisChurchProductIds: string[];
  otherChurchProductIds: string[];
  mappedByProductId: Record<string, string>;
  allSlotsOccupied: boolean;
};

export class IosPreferredProductUnavailableError extends Error {
  readonly code = "IOS_PREFERRED_PRODUCT_UNAVAILABLE";
  readonly preferredProductId: string;

  constructor(preferredProductId: string, message?: string) {
    super(
      message ||
        `Preferred iOS premium product ${preferredProductId} is not available for reservation.`
    );
    this.name = "IosPreferredProductUnavailableError";
    this.preferredProductId = preferredProductId;
  }
}

/** Kristo iOS product IDs the device should report when present. */
export const IOS_KRISTO_TRACKED_PRODUCT_IDS = [
  ...IOS_PREMIUM_RECOGNIZED_MONTHLY_PRODUCT_IDS,
  PREMIUM_YEARLY_PRODUCT_ID,
] as const;

function normalizeProductIdList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const id = String(value || "").trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function subscriptionGroupNameFor(group: IosPremiumPurchaseSlotGroup): string {
  if (group === "legacy") return "Kristo Premium";
  return `Kristo Premium ${group.toUpperCase()}`;
}

function throwSlotsExhausted(): never {
  throw new IosSubscriptionSlotsExhaustedError();
}

/**
 * Apply ownership rules that skip the legacy monthly slot when the Apple account
 * already owns premium_monthly or premium_yearly.
 */
export function applyIosLegacyGroupSkipRules(blockedProductIds: Set<string>): void {
  if (
    blockedProductIds.has(PREMIUM_MONTHLY_PRODUCT_ID) ||
    blockedProductIds.has(PREMIUM_YEARLY_PRODUCT_ID)
  ) {
    blockedProductIds.add(PREMIUM_MONTHLY_PRODUCT_ID);
  }
}

/** Pure new-purchase picker: premium_monthly or null. Never selects legacy IDs. */
export function pickFirstAvailableIosPurchaseSlot(
  blockedProductIds: Iterable<string>
): {
  group: IosPremiumPurchaseSlotGroup;
  productId: (typeof IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS)[number];
} | null {
  const blocked = new Set(
    [...blockedProductIds].map((id) => String(id || "").trim()).filter(Boolean)
  );
  applyIosLegacyGroupSkipRules(blocked);

  for (const productId of IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS) {
    if (!blocked.has(productId)) {
      const group = iosPremiumPurchaseSlotGroupFromProductId(productId);
      if (!group) continue;
      return { group, productId };
    }
  }
  return null;
}

/** @deprecated Legacy G2–G5 products are no longer eligible for reservation. */
export function pickFirstAvailableIosRotationProduct(
  blockedProductIds: Iterable<string>
): {
  group: Exclude<IosPremiumPurchaseSlotGroup, "legacy">;
  productId: string;
} | null {
  const picked = pickFirstAvailableIosPurchaseSlot([
    PREMIUM_MONTHLY_PRODUCT_ID,
    PREMIUM_YEARLY_PRODUCT_ID,
    ...blockedProductIds,
  ]);
  if (!picked || picked.group === "legacy") return null;
  return {
    group: picked.group,
    productId: picked.productId,
  };
}

/**
 * Collect product IDs blocked for THIS app-owner + device purchase session.
 * Never keys off originalTransactionId as a shared Apple ID.
 */
export async function collectBlockedIosPremiumProductIds(args: {
  ownerUserId: string;
  devicePurchaseScope: string;
  purchaseSessionId?: string | null;
  deviceOwnedProductIds: string[];
  exceptChurchId?: string | null;
}): Promise<string[]> {
  const blocked = new Set<string>();
  const exceptChurchId = String(args.exceptChurchId || "").trim().toUpperCase();

  for (const id of args.deviceOwnedProductIds) {
    if (isIosPremiumRecognizedMonthlyProductId(id) || id === PREMIUM_YEARLY_PRODUCT_ID) {
      blocked.add(id);
    }
  }

  const blockingReservations = await listSlotBlockingIosPremiumReservationsForOwnerDevice({
    ownerUserId: args.ownerUserId,
    devicePurchaseScope: args.devicePurchaseScope,
    purchaseSessionId: args.purchaseSessionId,
  });
  for (const reservation of blockingReservations) {
    if (
      exceptChurchId &&
      String(reservation.churchId || "").trim().toUpperCase() === exceptChurchId
    ) {
      // Allow refreshing this church's own active reservation, but still honor
      // already_subscribed releases so Apple-owned slots stay blocked.
      if (!(reservation.status === "released" && reservation.releaseReason === "already_subscribed")) {
        continue;
      }
    }
    if (isIosPremiumRecognizedMonthlyProductId(reservation.productId)) {
      blocked.add(reservation.productId);
    }
  }

  // Products already mapped to churches owned/managed by this Kristo owner.
  const ownerLocks = await listSubscriptionOwnershipLocksByOwnerUserId(args.ownerUserId);
  for (const lock of ownerLocks) {
    if (lock.status !== "active") continue;
    if (
      exceptChurchId &&
      String(lock.lockedChurchId || "").trim().toUpperCase() === exceptChurchId
    ) {
      continue;
    }
    const productId = String(lock.productId || "").trim();
    if (isIosPremiumRecognizedMonthlyProductId(productId) || productId === PREMIUM_YEARLY_PRODUCT_ID) {
      blocked.add(productId);
    }
  }

  applyIosLegacyGroupSkipRules(blocked);
  return [...blocked];
}

async function persistChurchProductAssignment(
  profile: ChurchMediaProfile | null,
  productId: string
): Promise<void> {
  if (!profile?.mediaName) return;
  // Never overwrite the product of a church that already has an active subscription.
  if (isChurchSubscriptionActiveFromRecord(profile)) return;
  try {
    await upsertChurchMedia({
      churchId: profile.churchId,
      ownerUserId: profile.ownerUserId,
      patch: {
        mediaName: profile.mediaName,
        iosPremiumProductId: productId,
      },
    });
  } catch (error) {
    console.warn("KRISTO_IOS_PREMIUM_PRODUCT_ASSIGN_PERSIST_FAILED", {
      churchId: profile.churchId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function resolveActiveChurchProductId(
  profile: ChurchMediaProfile | null
): string | null {
  if (!profile || !isChurchSubscriptionActiveFromRecord(profile)) return null;
  const productId = String(profile.iosPremiumProductId || "").trim();
  if (isIosPremiumRecognizedMonthlyProductId(productId)) return productId;
  return null;
}

async function collectOwnerMappedChurchProductIds(args: {
  ownerUserId: string;
  churchId: string;
}): Promise<{
  thisChurchProductIds: string[];
  otherChurchProductIds: string[];
  mappedByProductId: Record<string, string>;
  sourceByProductId: Record<string, IosPremiumSlotAssignmentSource>;
}> {
  const churchId = String(args.churchId || "").trim().toUpperCase();
  const thisChurchProductIds: string[] = [];
  const otherChurchProductIds: string[] = [];
  const mappedByProductId: Record<string, string> = {};
  const sourceByProductId: Record<string, IosPremiumSlotAssignmentSource> = {};

  const ownerLocks = await listSubscriptionOwnershipLocksByOwnerUserId(args.ownerUserId);
  for (const lock of ownerLocks) {
    if (lock.status !== "active") continue;
    const productId = String(lock.productId || "").trim();
    if (!isIosPremiumRecognizedMonthlyProductId(productId) && productId !== PREMIUM_YEARLY_PRODUCT_ID) {
      continue;
    }
    const lockedChurchId = String(lock.lockedChurchId || "").trim().toUpperCase();
    if (!lockedChurchId) continue;
    mappedByProductId[productId] = lockedChurchId;
    sourceByProductId[productId] = "ownership_lock";
    if (lockedChurchId === churchId) {
      if (!thisChurchProductIds.includes(productId)) thisChurchProductIds.push(productId);
    } else if (!otherChurchProductIds.includes(productId)) {
      otherChurchProductIds.push(productId);
    }
  }

  const media = await getChurchMediaByChurchId(args.churchId);
  const stickyProductId = String(media?.iosPremiumProductId || "").trim();
  if (isIosPremiumRecognizedMonthlyProductId(stickyProductId)) {
    mappedByProductId[stickyProductId] = churchId;
    // Only downgrade the source to sticky if no authoritative ownership lock exists.
    if (sourceByProductId[stickyProductId] !== "ownership_lock") {
      sourceByProductId[stickyProductId] = "church_media_sticky";
    }
    if (!thisChurchProductIds.includes(stickyProductId)) {
      thisChurchProductIds.push(stickyProductId);
    }
  }

  return { thisChurchProductIds, otherChurchProductIds, mappedByProductId, sourceByProductId };
}

/**
 * Inspect all five monthly slots without reserving.
 * Apple StoreKit availability is applied on-device after this response.
 */
export async function inspectIosPremiumPurchaseSlots(args: {
  churchId: string;
  ownerUserId: string;
  devicePurchaseScope: string;
  purchaseSessionId?: string | null;
  deviceOwnedProductIds?: string[] | null;
}): Promise<IosPremiumPurchaseSlotInspection> {
  const churchId = String(args.churchId || "").trim();
  const ownerUserId = String(args.ownerUserId || "").trim();
  const devicePurchaseScope = String(args.devicePurchaseScope || "").trim();
  if (!churchId) throw new Error("churchId is required");
  if (!ownerUserId) throw new Error("ownerUserId is required");
  if (!devicePurchaseScope) throw new Error("devicePurchaseScope is required");

  await ensureIosPremiumReservationStoreReady();
  await expireStaleIosPremiumReservations();

  const deviceOwnedProductIds = normalizeProductIdList(args.deviceOwnedProductIds);
  const purchaseSessionId = String(args.purchaseSessionId || "").trim() || null;

  const blockedList = await collectBlockedIosPremiumProductIds({
    ownerUserId,
    devicePurchaseScope,
    purchaseSessionId,
    deviceOwnedProductIds,
    exceptChurchId: churchId,
  });

  const mapped = await collectOwnerMappedChurchProductIds({ ownerUserId, churchId });
  const resolved = resolveAllIosPremiumSlotStatuses({
    appleAvailableProductIds: null,
    thisChurchProductIds: mapped.thisChurchProductIds,
    otherChurchProductIds: mapped.otherChurchProductIds,
    deviceOwnedProductIds,
    blockedProductIds: blockedList,
  });

  const deviceOwnedSet = new Set(deviceOwnedProductIds);
  const blockedSet = new Set(blockedList);

  const slots: IosPremiumPurchaseSlotInspectionSlot[] = resolved.map((slot) => {
    const mappedChurchId = mapped.mappedByProductId[slot.productId] || null;
    const purchasable = slot.productId === PREMIUM_MONTHLY_PRODUCT_ID;
    let assignmentSource: IosPremiumSlotAssignmentSource =
      mapped.sourceByProductId[slot.productId] || "none";
    // No authoritative Church ID mapping — attribute the non-owning signal, if any.
    if (!mappedChurchId) {
      if (deviceOwnedSet.has(slot.productId)) {
        assignmentSource = "device_owned";
      } else if (blockedSet.has(slot.productId)) {
        assignmentSource = "reservation";
      } else {
        assignmentSource = "none";
      }
    }
    return {
      productId: slot.productId,
      group: slot.group,
      slotLabel: slot.slotLabel || iosPremiumSlotLabel(slot.productId),
      subscriptionGroupName:
        slot.subscriptionGroupName || iosPremiumSubscriptionGroupName(slot.group),
      status: slot.status,
      statusLabel: slot.statusLabel,
      purchaseEnabled: purchasable && slot.purchaseEnabled,
      purchasable,
      legacy: !purchasable,
      mappedChurchId,
      assignmentSource,
    };
  });

  return {
    platform: "ios",
    churchId,
    slots,
    blockedProductIds: blockedList,
    deviceOwnedProductIds,
    thisChurchProductIds: mapped.thisChurchProductIds,
    otherChurchProductIds: mapped.otherChurchProductIds,
    mappedByProductId: mapped.mappedByProductId,
    allSlotsOccupied: areAllIosPremiumSlotsOccupied(slots),
  };
}

export async function reserveIosPremiumPurchaseProduct(
  args: ReserveIosPremiumPurchaseProductArgs
): Promise<IosPremiumPurchaseProductAssignment> {
  const churchId = String(args.churchId || "").trim();
  const ownerUserId = String(args.ownerUserId || "").trim();
  const devicePurchaseScope = String(args.devicePurchaseScope || "").trim();
  const preferredProductId = String(args.preferredProductId || "").trim();
  if (!churchId) throw new Error("churchId is required");
  if (!ownerUserId) throw new Error("ownerUserId is required");
  if (!devicePurchaseScope) throw new Error("devicePurchaseScope is required");

  await ensureIosPremiumReservationStoreReady();
  await expireStaleIosPremiumReservations();

  const deviceOwnedProductIds = normalizeProductIdList(args.deviceOwnedProductIds);
  const purchaseSessionId =
    String(args.purchaseSessionId || "").trim() || createIosPremiumPurchaseSessionId();

  const blockedList = await collectBlockedIosPremiumProductIds({
    ownerUserId,
    devicePurchaseScope,
    purchaseSessionId,
    deviceOwnedProductIds,
    exceptChurchId: churchId,
  });
  const blocked = new Set(blockedList);

  const existingMedia = await getChurchMediaByChurchId(churchId);
  const churchReservations = await listIosPremiumReservationsByChurchId(churchId);
  const now = Date.now();

  let chosenProductId: string | null = null;
  let chosenGroup: IosPremiumPurchaseSlotGroup | null = null;
  let sticky = false;
  let reservationToRefresh: IosPremiumReservationRecord | null = null;

  // This endpoint creates purchase reservations. Existing subscribers (including
  // legacy G2–G5) must use inspect/restore/current-plan flows, never a new reserve.
  const activeChurchProductId = resolveActiveChurchProductId(existingMedia);
  if (activeChurchProductId) {
    throw new IosPremiumMonthlyOwnershipConflictError(
      `This Church ID already has an active ${activeChurchProductId} subscription. Existing subscriptions cannot be replaced or migrated through a new purchase reservation.`
    );
  }
  if (existingMedia && isChurchSubscriptionActiveFromRecord(existingMedia)) {
    throw new IosPremiumMonthlyOwnershipConflictError(
      "This Church ID already has an active subscription. Start, replace, or migrate it through its existing Current Plan/restore flow, not a new purchase reservation."
    );
  }

  if (preferredProductId && preferredProductId !== PREMIUM_MONTHLY_PRODUCT_ID) {
    throw new IosPreferredProductUnavailableError(
      preferredProductId,
      `${preferredProductId} is a legacy recognition-only product. New iOS purchases use premium_monthly only.`
    );
  }

  if (blocked.has(PREMIUM_MONTHLY_PRODUCT_ID)) {
    console.log("KRISTO_IOS_PREMIUM_MONTHLY_CONFLICT", {
      churchId,
      ownerUserId,
      devicePurchaseScopeSuffix: devicePurchaseScope.slice(-8),
      purchaseSessionId,
      blockedProductIds: blockedList,
      deviceOwnedProductIds,
      code: "IOS_PREMIUM_MONTHLY_OWNERSHIP_CONFLICT",
      note: "no_legacy_product_fallback",
    });
    throw new IosPremiumMonthlyOwnershipConflictError();
  }

  const activeChurchReservation = churchReservations.find(
    (r) =>
      r.status === "reserved" &&
      Number(r.expiresAt) > now &&
      r.ownerUserId.toLowerCase() === ownerUserId.toLowerCase() &&
      r.devicePurchaseScope === devicePurchaseScope &&
      r.productId === PREMIUM_MONTHLY_PRODUCT_ID
  );

  chosenProductId = PREMIUM_MONTHLY_PRODUCT_ID;
  chosenGroup = "legacy";
  sticky = Boolean(activeChurchReservation);
  reservationToRefresh = activeChurchReservation || null;

  let reservation: IosPremiumReservationRecord | null = null;

  // Concurrent reserve races fail closed. There is no G2–G5 fallback.
  for (let attempt = 0; attempt < IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS.length; attempt++) {
    if (!chosenProductId || !chosenGroup) {
      throwSlotsExhausted();
    }
    const attemptNow = Date.now();
    const candidate: IosPremiumReservationRecord = {
      id:
        attempt === 0 && reservationToRefresh
          ? reservationToRefresh.id
          : createIosPremiumReservationId(),
      purchaseSessionId:
        (attempt === 0 && reservationToRefresh?.purchaseSessionId) || purchaseSessionId,
      churchId,
      ownerUserId,
      devicePurchaseScope,
      productId: chosenProductId,
      group: chosenGroup,
      deviceOwnedProductIds,
      status: "reserved",
      expiresAt: attemptNow + defaultIosPremiumReservationTtlMs(),
      createdAt:
        (attempt === 0 && reservationToRefresh?.createdAt) || attemptNow,
      updatedAt: attemptNow,
      consumedAt: null,
      releasedAt: null,
      subscriptionLineageIdentity: null,
      releaseReason: null,
    };
    try {
      reservation = await saveIosPremiumReservation(candidate);
      break;
    } catch (error) {
      if (!isIosPremiumReservationSlotConflict(error)) throw error;
      throw new IosPremiumMonthlyOwnershipConflictError(
        "premium_monthly could not be reserved because another active reservation or ownership context already holds it. No legacy product was substituted."
      );
    }
  }

  if (!reservation || !chosenProductId || !chosenGroup) {
    throwSlotsExhausted();
  }

  const finalBlockedList = [...blocked];
  await persistChurchProductAssignment(existingMedia, chosenProductId);

  console.log("KRISTO_IOS_PREMIUM_PRODUCT_RESERVED", {
    churchId,
    ownerUserId,
    reservationId: reservation.id,
    purchaseSessionId: reservation.purchaseSessionId,
    productId: chosenProductId,
    group: chosenGroup,
    sticky,
    coordination: "best_effort_device_and_owner",
    devicePurchaseScopeSuffix: devicePurchaseScope.slice(-8),
    blockedProductIds: finalBlockedList,
    deviceOwnedCount: deviceOwnedProductIds.length,
    expiresAt: reservation.expiresAt,
  });

  return {
    platform: "ios",
    plan: "monthly",
    group: chosenGroup,
    productId: chosenProductId,
    subscriptionGroupName: subscriptionGroupNameFor(chosenGroup),
    sticky,
    reservationId: reservation.id,
    purchaseSessionId: reservation.purchaseSessionId,
    devicePurchaseScope,
    appOwnerScope: ownerUserId,
    coordination: "best_effort_device_and_owner",
    blockedProductIds: finalBlockedList,
    deviceOwnedProductIds,
    expiresAt: reservation.expiresAt,
  };
}

/** Release a reservation (e.g. Apple already-subscribed on that group). */
export async function releaseIosPremiumReservation(args: {
  reservationId: string;
  ownerUserId: string;
  reason?: IosPremiumReservationRecord["releaseReason"];
}): Promise<IosPremiumReservationRecord | null> {
  const reservationId = String(args.reservationId || "").trim();
  const ownerUserId = String(args.ownerUserId || "").trim();
  if (!reservationId || !ownerUserId) return null;

  await ensureIosPremiumReservationStoreReady();
  const existing = await getIosPremiumReservationById(reservationId);
  if (!existing) return null;
  if (existing.ownerUserId.toLowerCase() !== ownerUserId.toLowerCase()) {
    return null;
  }
  if (existing.status !== "reserved") return existing;

  const reason = args.reason || "already_subscribed";
  const releasedAt = Date.now();
  // Keep already_subscribed products blocked for a fresh TTL so retries cannot
  // re-select the same slot while CustomerInfo is still catching up.
  const expiresAt =
    reason === "already_subscribed"
      ? releasedAt + defaultIosPremiumReservationTtlMs()
      : existing.expiresAt;

  const released = await saveIosPremiumReservation({
    ...existing,
    status: "released",
    releaseReason: reason,
    releasedAt,
    expiresAt,
  });

  console.log("KRISTO_IOS_PREMIUM_RESERVATION_RELEASED", {
    reservationId: released.id,
    churchId: released.churchId,
    productId: released.productId,
    reason: released.releaseReason,
  });

  return released;
}

/**
 * After verified purchase: bind subscriptionLineageIdentity (originalTransactionId)
 * to this church reservation. This is lineage→church mapping only — not Apple ID.
 */
export async function confirmIosPremiumReservationAfterPurchase(args: {
  churchId: string;
  ownerUserId: string;
  verification: ChurchPremiumVerification;
}): Promise<IosPremiumReservationRecord | null> {
  const churchId = String(args.churchId || "").trim();
  const ownerUserId = String(args.ownerUserId || "").trim();
  /** Verified subscription lineage — NOT purchaser/Apple ID. */
  const subscriptionLineageIdentity = String(
    args.verification.storeSubscriptionIdentity || ""
  ).trim();
  const productId = String(args.verification.productId || "").trim();

  if (!churchId || !subscriptionLineageIdentity) {
    console.log("KRISTO_IOS_PREMIUM_RESERVATION_CONFIRM_SKIPPED", {
      churchId,
      ownerUserId,
      hasSubscriptionLineageIdentity: Boolean(subscriptionLineageIdentity),
      productId: productId || null,
      reason: "missing-subscription-lineage-identity",
    });
    return null;
  }

  await ensureIosPremiumReservationStoreReady();
  const reservations = await listIosPremiumReservationsByChurchId(churchId);
  const candidate =
    reservations.find(
      (r) =>
        r.status === "reserved" &&
        (!productId ||
          r.productId === productId ||
          isIosPremiumRecognizedMonthlyProductId(r.productId))
    ) ||
    reservations.find((r) => r.status === "reserved") ||
    null;

  const now = Date.now();
  if (!candidate) {
    const group =
      iosPremiumPurchaseSlotGroupFromProductId(productId) ||
      (isIosPremiumRotationMonthlyProductId(productId) ? "g2" : "legacy");
    const boundProductId = isIosPremiumRecognizedMonthlyProductId(productId)
      ? productId
      : group === "legacy"
        ? PREMIUM_MONTHLY_PRODUCT_ID
        : IOS_PREMIUM_MONTHLY_PRODUCT_IDS_BY_GROUP[group];
    const synthetic: IosPremiumReservationRecord = {
      id: createIosPremiumReservationId(),
      purchaseSessionId: createIosPremiumPurchaseSessionId(),
      churchId,
      ownerUserId,
      devicePurchaseScope: "server_confirm",
      productId: boundProductId,
      group,
      deviceOwnedProductIds: [],
      status: "consumed",
      expiresAt: now,
      createdAt: now,
      updatedAt: now,
      consumedAt: now,
      subscriptionLineageIdentity,
      releaseReason: "consumed",
    };
    await saveIosPremiumReservation(synthetic);
    console.log("KRISTO_IOS_PREMIUM_RESERVATION_CONFIRM_SYNTHETIC", {
      churchId,
      ownerUserId,
      reservationId: synthetic.id,
      productId: synthetic.productId,
      subscriptionLineageIdentityHash: shortIdentityHash(subscriptionLineageIdentity),
      note: "lineage_not_purchaser_identity",
    });
    return synthetic;
  }

  const consumed = await saveIosPremiumReservation({
    ...candidate,
    status: "consumed",
    releaseReason: "consumed",
    consumedAt: now,
    subscriptionLineageIdentity,
  });

  console.log("KRISTO_IOS_PREMIUM_RESERVATION_CONFIRMED", {
    churchId,
    ownerUserId,
    reservationId: consumed.id,
    productId: consumed.productId,
    group: consumed.group,
    subscriptionLineageIdentityHash: shortIdentityHash(subscriptionLineageIdentity),
    note: "lineage_maps_to_one_church_only",
  });

  return consumed;
}
