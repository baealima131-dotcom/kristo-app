/**
 * iOS premium purchase-slot reservation — architecture notes
 *
 * Slot order for new iOS monthly purchases:
 *   1) premium_monthly
 *   2) church_premium_monthly_g2
 *   3) church_premium_monthly_g3
 *   4) church_premium_monthly_g4
 *   5) church_premium_monthly_g5
 *
 * premium_yearly is recognition-only and is never reserved/offered.
 * Owning premium_monthly OR premium_yearly skips the legacy monthly slot → G2.
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
  IOS_SUBSCRIPTION_SLOTS_EXHAUSTED,
  iosPremiumPurchaseSlotGroupFromProductId,
  isIosPremiumPurchaseSlotProductId,
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

export class IosSubscriptionSlotsExhaustedError extends Error {
  readonly code = IOS_SUBSCRIPTION_SLOTS_EXHAUSTED;

  constructor(
    message = "No available Kristo Premium monthly slot for this device/account context. Refresh owned products or wait for an existing subscription period to end."
  ) {
    super(message);
    this.name = "IosSubscriptionSlotsExhaustedError";
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
};

/** Kristo iOS product IDs the device should report when present. */
export const IOS_KRISTO_TRACKED_PRODUCT_IDS = [
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
  ...IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS.filter((id) => id !== PREMIUM_MONTHLY_PRODUCT_ID),
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

/**
 * Pure slot picker: first free product in
 * premium_monthly → g2 → g3 → g4 → g5.
 * Never selects premium_yearly.
 */
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

/**
 * @deprecated Prefer pickFirstAvailableIosPurchaseSlot (includes premium_monthly).
 * Kept for callers that only walk G2–G5.
 */
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
    if (isIosPremiumPurchaseSlotProductId(id) || id === PREMIUM_YEARLY_PRODUCT_ID) {
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
    if (isIosPremiumPurchaseSlotProductId(reservation.productId)) {
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
    if (isIosPremiumPurchaseSlotProductId(productId) || productId === PREMIUM_YEARLY_PRODUCT_ID) {
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
  if (isIosPremiumPurchaseSlotProductId(productId)) return productId;
  return null;
}

export async function reserveIosPremiumPurchaseProduct(
  args: ReserveIosPremiumPurchaseProductArgs
): Promise<IosPremiumPurchaseProductAssignment> {
  const churchId = String(args.churchId || "").trim();
  const ownerUserId = String(args.ownerUserId || "").trim();
  const devicePurchaseScope = String(args.devicePurchaseScope || "").trim();
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

  // Never change the product of a church that already has an active subscription.
  const activeChurchProductId = resolveActiveChurchProductId(existingMedia);
  if (activeChurchProductId) {
    chosenProductId = activeChurchProductId;
    chosenGroup = iosPremiumPurchaseSlotGroupFromProductId(activeChurchProductId);
    sticky = true;
    reservationToRefresh =
      churchReservations.find(
        (r) =>
          r.status === "reserved" &&
          Number(r.expiresAt) > now &&
          r.ownerUserId.toLowerCase() === ownerUserId.toLowerCase() &&
          r.devicePurchaseScope === devicePurchaseScope &&
          r.productId === activeChurchProductId
      ) || null;
  } else {
    const activeChurchReservation = churchReservations.find(
      (r) =>
        r.status === "reserved" &&
        Number(r.expiresAt) > now &&
        r.ownerUserId.toLowerCase() === ownerUserId.toLowerCase() &&
        r.devicePurchaseScope === devicePurchaseScope &&
        isIosPremiumPurchaseSlotProductId(r.productId) &&
        !blocked.has(r.productId)
    );

    if (activeChurchReservation) {
      chosenProductId = activeChurchReservation.productId;
      chosenGroup =
        iosPremiumPurchaseSlotGroupFromProductId(activeChurchReservation.productId) ||
        activeChurchReservation.group;
      sticky = true;
      reservationToRefresh = activeChurchReservation;
    } else {
      const stickyProductId = String(existingMedia?.iosPremiumProductId || "").trim();
      if (
        isIosPremiumPurchaseSlotProductId(stickyProductId) &&
        !blocked.has(stickyProductId)
      ) {
        chosenProductId = stickyProductId;
        chosenGroup = iosPremiumPurchaseSlotGroupFromProductId(stickyProductId);
        sticky = true;
      }
    }
  }

  if (!chosenProductId || !chosenGroup) {
    const picked = pickFirstAvailableIosPurchaseSlot(blocked);
    if (!picked) {
      console.log("KRISTO_IOS_PREMIUM_RESERVATION_NO_SLOT", {
        churchId,
        ownerUserId,
        devicePurchaseScopeSuffix: devicePurchaseScope.slice(-8),
        purchaseSessionId,
        blockedProductIds: blockedList,
        deviceOwnedProductIds,
        code: IOS_SUBSCRIPTION_SLOTS_EXHAUSTED,
        note: "best_effort_device_coordination_not_apple_id",
      });
      throwSlotsExhausted();
    }
    chosenProductId = picked.productId;
    chosenGroup = picked.group;
    sticky = false;
  }

  let reservation: IosPremiumReservationRecord | null = null;

  // Concurrent reserve races: unique owner+device+product constraint may reject.
  // Re-pick next free slot (bounded by the five monthly slots).
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
      // Do not rotate away from an already-active church product.
      if (activeChurchProductId) {
        throw error;
      }
      blocked.add(candidate.productId);
      sticky = false;
      if (reservationToRefresh) {
        try {
          await saveIosPremiumReservation({
            ...reservationToRefresh,
            status: "released",
            releaseReason: "replaced",
            releasedAt: Date.now(),
          });
        } catch {
          // best-effort; TTL expiry still clears stale reserved rows
        }
        reservationToRefresh = null;
      }
      const picked = pickFirstAvailableIosPurchaseSlot(blocked);
      if (!picked) {
        throwSlotsExhausted();
      }
      chosenProductId = picked.productId;
      chosenGroup = picked.group;
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
          isIosPremiumPurchaseSlotProductId(r.productId))
    ) ||
    reservations.find((r) => r.status === "reserved") ||
    null;

  const now = Date.now();
  if (!candidate) {
    const group =
      iosPremiumPurchaseSlotGroupFromProductId(productId) ||
      (isIosPremiumRotationMonthlyProductId(productId) ? "g2" : "legacy");
    const boundProductId = isIosPremiumPurchaseSlotProductId(productId)
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
