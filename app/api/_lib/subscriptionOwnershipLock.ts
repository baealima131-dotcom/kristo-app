import { getChurchById } from "@/app/api/_lib/churches";
import type { ChurchPremiumVerification } from "@/app/api/_lib/revenuecat";
import {
  listSubscriptionOwnershipLocksByOwnerUserId,
  saveSubscriptionOwnershipLock,
  type SubscriptionOwnershipLockRecord,
  type SubscriptionOwnershipLockStatus,
} from "@/app/api/_lib/store/subscriptionOwnershipLockDb";
import type { ChurchMediaProfile } from "@/app/api/_lib/store/mediaDb";

export type SubscriptionOwnershipLockApiPayload = {
  blocked: boolean;
  isLockHolder: boolean;
  lockedChurchId: string | null;
  lockedChurchName: string | null;
  expiresAt: number | null;
  expiresAtLabel: string | null;
  platform: "ios" | "android" | null;
  store: "app_store" | "play_store" | null;
  status: SubscriptionOwnershipLockStatus | null;
  canPurchase: boolean;
  canActivate: boolean;
  message: string | null;
};

function normalizeUserId(value: string) {
  return String(value || "").trim();
}

function normalizeChurchId(value: string) {
  return String(value || "").trim();
}

function churchIdsMatch(a: string, b: string) {
  const left = normalizeChurchId(a).toUpperCase();
  const right = normalizeChurchId(b).toUpperCase();
  return Boolean(left && right && left === right);
}

function formatExpiresAtLabel(expiresAt: number | null): string | null {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return null;
  return new Date(expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildLockMessage(args: {
  lockedChurchName: string;
  expiresAtLabel: string | null;
}): string {
  const expirySuffix = args.expiresAtLabel
    ? ` You can subscribe this church after ${args.expiresAtLabel}.`
    : " You can subscribe this church after your current billing period ends.";
  return (
    `This Kristo ID already has an active subscription for ${args.lockedChurchName}. ` +
    `You can manage or cancel that subscription from that church.${expirySuffix}`
  );
}

function emptyLockPayload(): SubscriptionOwnershipLockApiPayload {
  return {
    blocked: false,
    isLockHolder: false,
    lockedChurchId: null,
    lockedChurchName: null,
    expiresAt: null,
    expiresAtLabel: null,
    platform: null,
    store: null,
    status: null,
    canPurchase: true,
    canActivate: true,
    message: null,
  };
}

function payloadFromLock(args: {
  lock: SubscriptionOwnershipLockRecord;
  churchId: string;
}): SubscriptionOwnershipLockApiPayload {
  const isLockHolder = churchIdsMatch(args.lock.lockedChurchId, args.churchId);
  const blocked = !isLockHolder;
  const expiresAtLabel = formatExpiresAtLabel(args.lock.expiresAt);
  return {
    blocked,
    isLockHolder,
    lockedChurchId: args.lock.lockedChurchId,
    lockedChurchName: args.lock.lockedChurchName,
    expiresAt: args.lock.expiresAt,
    expiresAtLabel,
    platform: args.lock.platform,
    store: args.lock.store,
    status: args.lock.status,
    canPurchase: !blocked,
    canActivate: !blocked,
    message: blocked
      ? buildLockMessage({
          lockedChurchName: args.lock.lockedChurchName,
          expiresAtLabel,
        })
      : null,
  };
}

export function getActiveSubscriptionOwnershipLock(
  locks: SubscriptionOwnershipLockRecord[]
): SubscriptionOwnershipLockRecord | null {
  return locks.find((lock) => lock.status === "active") || null;
}

async function resolveLockedChurchName(churchId: string, fallback?: string | null) {
  const cid = normalizeChurchId(churchId);
  if (!cid) return String(fallback || "another church").trim() || "another church";
  try {
    const church = await getChurchById(cid);
    const liveName = String(church?.name || "").trim();
    if (liveName) {
      return { name: liveName, deleted: false };
    }
  } catch {
    // ignore lookup failures
  }
  const snapshot = String(fallback || cid).trim() || cid;
  return { name: snapshot, deleted: true };
}

async function markLockStatus(
  lock: SubscriptionOwnershipLockRecord,
  status: SubscriptionOwnershipLockStatus,
  releaseReason: SubscriptionOwnershipLockRecord["releaseReason"]
) {
  const previousStatus = lock.status;
  const next: SubscriptionOwnershipLockRecord = {
    ...lock,
    status,
    releaseReason: releaseReason ?? null,
    releasedAt: status === "active" ? lock.releasedAt ?? null : Date.now(),
    updatedAt: Date.now(),
  };
  await saveSubscriptionOwnershipLock(next);
  if (previousStatus === "active" && status !== "active") {
    console.log("KRISTO_SUBSCRIPTION_LOCK_RELEASED_OR_EXPIRED", {
      ownerUserId: next.ownerUserId,
      lockedChurchId: next.lockedChurchId,
      lockedChurchName: next.lockedChurchName,
      previousStatus,
      status: next.status,
      releaseReason: next.releaseReason,
      expiresAt: next.expiresAt,
    });
  }
  return next;
}

async function reconcileActiveLockExpiry(
  lock: SubscriptionOwnershipLockRecord
): Promise<SubscriptionOwnershipLockRecord> {
  if (lock.status !== "active") return lock;
  if (lock.expiresAt != null && Number.isFinite(lock.expiresAt) && lock.expiresAt <= Date.now()) {
    return markLockStatus(lock, "expired", "expired");
  }
  return lock;
}

export async function ensureSubscriptionOwnershipLockFromActiveMediaProfile(args: {
  ownerUserId: string;
  media: ChurchMediaProfile | null | undefined;
}): Promise<SubscriptionOwnershipLockRecord | null> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const media = args.media;
  if (!ownerUserId || !media?.subscriptionActive) return null;
  if (media.subscriptionSource !== "app_store") return null;

  const churchId = normalizeChurchId(media.churchId);
  if (!churchId) return null;

  const locks = await listSubscriptionOwnershipLocksByOwnerUserId(ownerUserId);
  const active = getActiveSubscriptionOwnershipLock(locks);
  if (active && churchIdsMatch(active.lockedChurchId, churchId)) {
    const refreshed = await reconcileActiveLockExpiry(active);
    if (refreshed.status !== "active") return null;
    return saveSubscriptionOwnershipLock({
      ...refreshed,
      expiresAt: media.subscriptionExpiresAt ?? refreshed.expiresAt ?? null,
      subscriptionPlan:
        media.subscriptionPlan === "yearly"
          ? "yearly"
          : media.subscriptionPlan === "monthly"
            ? "monthly"
            : refreshed.subscriptionPlan,
      updatedAt: Date.now(),
    });
  }
  if (active && !churchIdsMatch(active.lockedChurchId, churchId)) {
    return reconcileActiveLockExpiry(active);
  }

  const churchMeta = await resolveLockedChurchName(churchId, media.mediaName);
  const now = Date.now();
  const record: SubscriptionOwnershipLockRecord = {
    id: `sub-lock-${ownerUserId.toLowerCase()}-${churchId.toLowerCase()}`,
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    lockedChurchDeleted: churchMeta.deleted,
    revenueCatAppUserId: churchId,
    revenueCatOriginalAppUserId: churchId,
    productId: null,
    store: "app_store",
    platform: null,
    subscriptionPlan:
      media.subscriptionPlan === "yearly"
        ? "yearly"
        : media.subscriptionPlan === "monthly"
          ? "monthly"
          : null,
    expiresAt: media.subscriptionExpiresAt ?? null,
    lockedAt: now,
    updatedAt: now,
    status: "active",
    releasedAt: null,
    releaseReason: null,
  };
  return saveSubscriptionOwnershipLock(record);
}

export async function assertAppStoreSubscriptionActivationAllowed(args: {
  churchId: string;
  ownerUserId: string;
}): Promise<{
  allowed: boolean;
  reason?: string;
  lock: SubscriptionOwnershipLockRecord | null;
}> {
  const churchId = normalizeChurchId(args.churchId);
  const ownerUserId = normalizeUserId(args.ownerUserId);
  if (!churchId || !ownerUserId) {
    return { allowed: true, lock: null };
  }

  const locks = await listSubscriptionOwnershipLocksByOwnerUserId(ownerUserId);
  let active = getActiveSubscriptionOwnershipLock(locks);
  if (!active) {
    return { allowed: true, lock: null };
  }

  active = await reconcileActiveLockExpiry(active);
  if (active.status !== "active") {
    return { allowed: true, lock: null };
  }

  if (churchIdsMatch(active.lockedChurchId, churchId)) {
    return { allowed: true, lock: active };
  }

  console.log("KRISTO_SUBSCRIPTION_LOCK_BLOCKED_ACTIVATION", {
    ownerUserId,
    churchId,
    lockedChurchId: active.lockedChurchId,
    lockedChurchName: active.lockedChurchName,
    expiresAt: active.expiresAt,
    productId: active.productId,
    store: active.store,
    platform: active.platform,
    reason: "subscription-ownership-lock",
  });

  return {
    allowed: false,
    reason: "subscription-ownership-lock",
    lock: active,
  };
}

export async function upsertSubscriptionOwnershipLockAfterAppStoreActivation(args: {
  ownerUserId: string;
  churchId: string;
  verification: ChurchPremiumVerification;
  subscriptionPlan: "monthly" | "yearly";
  expiresAtMs: number | null;
}): Promise<SubscriptionOwnershipLockRecord> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const churchId = normalizeChurchId(args.churchId);
  const churchMeta = await resolveLockedChurchName(churchId);
  const now = Date.now();
  const locks = await listSubscriptionOwnershipLocksByOwnerUserId(ownerUserId);

  for (const lock of locks) {
    if (lock.status !== "active") continue;
    if (churchIdsMatch(lock.lockedChurchId, churchId)) continue;
    await markLockStatus(lock, "released", "replaced");
  }

  const record: SubscriptionOwnershipLockRecord = {
    id: `sub-lock-${ownerUserId.toLowerCase()}-${churchId.toLowerCase()}`,
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    lockedChurchDeleted: churchMeta.deleted,
    revenueCatAppUserId: churchId,
    revenueCatOriginalAppUserId: churchId,
    productId: args.verification.productId ?? null,
    store: "app_store",
    platform: null,
    subscriptionPlan: args.subscriptionPlan,
    expiresAt: args.expiresAtMs,
    lockedAt: now,
    updatedAt: now,
    status: "active",
    releasedAt: null,
    releaseReason: null,
  };

  return saveSubscriptionOwnershipLock(record);
}

export async function releaseSubscriptionOwnershipLockForChurch(args: {
  ownerUserId: string;
  churchId: string;
  releaseReason: SubscriptionOwnershipLockRecord["releaseReason"];
}): Promise<void> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const churchId = normalizeChurchId(args.churchId);
  if (!ownerUserId || !churchId) return;

  const locks = await listSubscriptionOwnershipLocksByOwnerUserId(ownerUserId);
  for (const lock of locks) {
    if (lock.status !== "active") continue;
    if (!churchIdsMatch(lock.lockedChurchId, churchId)) continue;
    await markLockStatus(lock, args.releaseReason === "admin" ? "released" : "expired", args.releaseReason);
  }
}

export async function resolveSubscriptionOwnershipLockForChurch(args: {
  churchId: string;
  ownerUserId: string;
  media?: ChurchMediaProfile | null;
}): Promise<{
  lock: SubscriptionOwnershipLockRecord | null;
  payload: SubscriptionOwnershipLockApiPayload;
}> {
  const churchId = normalizeChurchId(args.churchId);
  const ownerUserId = normalizeUserId(args.ownerUserId);
  if (!churchId || !ownerUserId) {
    return { lock: null, payload: emptyLockPayload() };
  }

  if (args.media?.subscriptionActive && args.media.subscriptionSource === "app_store") {
    await ensureSubscriptionOwnershipLockFromActiveMediaProfile({
      ownerUserId,
      media: args.media,
    });
  }

  const locks = await listSubscriptionOwnershipLocksByOwnerUserId(ownerUserId);
  let active = getActiveSubscriptionOwnershipLock(locks);
  if (!active) {
    return { lock: null, payload: emptyLockPayload() };
  }

  active = await reconcileActiveLockExpiry(active);
  if (active.status !== "active") {
    return { lock: null, payload: emptyLockPayload() };
  }

  const churchMeta = await resolveLockedChurchName(active.lockedChurchId, active.lockedChurchName);
  if (active.lockedChurchName !== churchMeta.name || active.lockedChurchDeleted !== churchMeta.deleted) {
    active = await saveSubscriptionOwnershipLock({
      ...active,
      lockedChurchName: churchMeta.name,
      lockedChurchDeleted: churchMeta.deleted,
    });
  }

  const payload = payloadFromLock({ lock: active, churchId });

  console.log("KRISTO_SUBSCRIPTION_LOCK_DETECTED", {
    ownerUserId,
    churchId,
    blocked: payload.blocked,
    isLockHolder: payload.isLockHolder,
    lockedChurchId: active.lockedChurchId,
    lockedChurchName: active.lockedChurchName,
    expiresAt: active.expiresAt,
    status: active.status,
    store: active.store,
    platform: active.platform,
  });

  return { lock: active, payload };
}
