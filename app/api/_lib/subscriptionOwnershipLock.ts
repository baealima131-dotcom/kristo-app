import { parseSubscriptionExpiresAtMs } from "@/app/api/_lib/churchMediaNotifications";
import { resolveActualChurchPastorUserId } from "@/app/api/_lib/churchMediaAccess";
import { getChurchById } from "@/app/api/_lib/churches";
import { getMembershipsForUser } from "@/app/api/_lib/memberships";
import {
  isVerifiedChurchPremiumReason,
  isRevenueCatSubscriberAliasedFromChurch,
  hasVerifiedStoreSubscriptionIdentity,
  verifiedStoreSubscriptionRequiresIdentity,
  verifyChurchPremiumEntitlement,
  type ChurchPremiumVerification,
} from "@/app/api/_lib/revenuecat";
import {
  acquireActiveSubscriptionOwnershipLock,
  listActiveDeletedChurchSubscriptionLocks,
  listActiveSubscriptionOwnershipLocksByStoreIdentity,
  listSubscriptionOwnershipLocksByOwnerUserId,
  resolveSubscriptionOwnershipLockStoreMode,
  saveSubscriptionOwnershipLock,
  type SubscriptionOwnershipLockRecord,
  type SubscriptionOwnershipLockStatus,
} from "@/app/api/_lib/store/subscriptionOwnershipLockDb";
import {
  getChurchMediaByChurchId,
  listChurchMediaByOwnerUserId,
  type ChurchMediaProfile,
} from "@/app/api/_lib/store/mediaDb";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";

export type SubscriptionOwnershipLockApiPayload = {
  blocked: boolean;
  isLockHolder: boolean;
  lockedChurchId: string | null;
  lockedChurchName: string | null;
  expiresAt: number | null;
  expiresAtLabel: string | null;
  platform: "ios" | "android" | null;
  store: "app_store" | "play_store" | null;
  willRenew: boolean | null;
  status: SubscriptionOwnershipLockStatus | null;
  canPurchase: boolean;
  canActivate: boolean;
  message: string | null;
};

function isPastorChurchRole(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "pastor" || normalized.includes("pastor");
}

function isOfflineActivationSubscription(media: ChurchMediaProfile | null | undefined): boolean {
  return media?.subscriptionSource === "offline_activation";
}

function isBackendActivationSubscription(media: ChurchMediaProfile | null | undefined): boolean {
  return media?.subscriptionSource === "backend_activation";
}

function hasOfflineActivationMarkers(media: ChurchMediaProfile | null | undefined): boolean {
  return Boolean(
    String(media?.offlineActivationCode || "").trim() ||
      String(media?.offlineActivationBatchId || "").trim()
  );
}

function resolveSubscriptionPlan(
  media: ChurchMediaProfile,
  verification?: ChurchPremiumVerification | null
): "monthly" | "yearly" | null {
  const fromVerification = String(verification?.plan || "").trim().toLowerCase();
  if (fromVerification === "yearly" || fromVerification === "monthly") {
    return fromVerification;
  }
  const fromMedia = String(media.subscriptionPlan || "").trim().toLowerCase();
  if (fromMedia === "yearly" || fromMedia === "monthly") {
    return fromMedia;
  }
  return null;
}

function mediaProfileForAppStoreLock(
  media: ChurchMediaProfile,
  verification?: ChurchPremiumVerification | null
): ChurchMediaProfile {
  const expiresAtMs =
    parseSubscriptionExpiresAtMs(verification?.expiresAt) ?? media.subscriptionExpiresAt ?? null;
  const plan = resolveSubscriptionPlan(media, verification);
  return {
    ...media,
    subscriptionActive: true,
    subscriptionSource: "app_store",
    subscriptionExpiresAt: expiresAtMs ?? undefined,
    subscriptionPlan: plan ?? media.subscriptionPlan,
  };
}

async function pastorOwnsChurchMedia(ownerUserId: string, churchId: string): Promise<boolean> {
  const uid = normalizeUserId(ownerUserId);
  const cid = normalizeChurchId(churchId);
  if (!uid || !cid) return false;

  const actualPastorUserId = await resolveActualChurchPastorUserId(cid);
  return (
    normalizeUserId(actualPastorUserId).toLowerCase() === uid.toLowerCase()
  );
}

export type PastorOwnedChurchSummary = {
  churchId: string;
  churchName: string | null;
};

/** Churches the user still owns/manages as the actual pastor. */
export async function listPastorOwnedChurches(
  ownerUserId: string
): Promise<PastorOwnedChurchSummary[]> {
  const uid = normalizeUserId(ownerUserId);
  if (!uid) return [];

  const byChurchId = new Map<string, PastorOwnedChurchSummary>();

  const memberships = await getMembershipsForUser(uid);
  for (const membership of memberships) {
    if (String(membership.status || "").trim() !== "Active") continue;
    if (!isPastorChurchRole(membership.churchRole)) continue;

    const churchId = normalizeChurchId(membership.churchId);
    if (!churchId) continue;
    if (!(await pastorOwnsChurchMedia(uid, churchId))) continue;

    const media = await getChurchMediaByChurchId(churchId);
    byChurchId.set(churchId.toUpperCase(), {
      churchId,
      churchName: String(media?.mediaName || "").trim() || null,
    });
  }

  const ownerIndexed = await listChurchMediaByOwnerUserId(uid);
  for (const media of ownerIndexed) {
    const churchId = normalizeChurchId(media.churchId);
    if (!churchId || byChurchId.has(churchId.toUpperCase())) continue;
    if (!(await pastorOwnsChurchMedia(uid, churchId))) continue;
    byChurchId.set(churchId.toUpperCase(), {
      churchId,
      churchName: String(media?.mediaName || "").trim() || null,
    });
  }

  return Array.from(byChurchId.values());
}

/** Authoritative pastor-owned media profiles with active subscriptions. */
export async function listAuthoritativePastorMediaProfiles(
  ownerUserId: string
): Promise<ChurchMediaProfile[]> {
  const uid = normalizeUserId(ownerUserId);
  if (!uid) return [];

  const byChurchId = new Map<string, ChurchMediaProfile>();

  const memberships = await getMembershipsForUser(uid);
  for (const membership of memberships) {
    if (String(membership.status || "").trim() !== "Active") continue;
    if (!isPastorChurchRole(membership.churchRole)) continue;

    const churchId = normalizeChurchId(membership.churchId);
    if (!churchId) continue;

    const actualPastorUserId = await resolveActualChurchPastorUserId(churchId);
    if (normalizeUserId(actualPastorUserId).toLowerCase() !== uid.toLowerCase()) continue;

    const media = await getChurchMediaByChurchId(churchId);
    if (!media || !String(media.mediaName || "").trim()) continue;
    if (!isChurchSubscriptionActiveFromRecord(media)) continue;

    byChurchId.set(churchId.toUpperCase(), media);
  }

  const ownerIndexed = await listChurchMediaByOwnerUserId(uid);
  for (const media of ownerIndexed) {
    const churchId = normalizeChurchId(media.churchId);
    if (!churchId || byChurchId.has(churchId.toUpperCase())) continue;
    if (!isChurchSubscriptionActiveFromRecord(media)) continue;
    if (!(await pastorOwnsChurchMedia(uid, churchId))) continue;
    byChurchId.set(churchId.toUpperCase(), media);
  }

  return Array.from(byChurchId.values());
}

type AppStoreBackfillCandidate = {
  media: ChurchMediaProfile;
  verification: ChurchPremiumVerification | null;
  revenueCatVerified: boolean;
};

async function evaluateAppStoreBackfillCandidate(
  media: ChurchMediaProfile
): Promise<{ eligible: boolean; reason: string; candidate: AppStoreBackfillCandidate | null }> {
  const churchId = normalizeChurchId(media.churchId);
  if (!churchId || !isChurchSubscriptionActiveFromRecord(media)) {
    return { eligible: false, reason: "inactive-profile", candidate: null };
  }

  if (
    isOfflineActivationSubscription(media) ||
    isBackendActivationSubscription(media) ||
    hasOfflineActivationMarkers(media)
  ) {
    return { eligible: false, reason: "offline-or-backend-activation", candidate: null };
  }

  if (media.subscriptionSource === "stripe") {
    return { eligible: false, reason: "stripe-source", candidate: null };
  }

  const verification = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });
  const candidate: AppStoreBackfillCandidate = {
    media,
    verification,
    revenueCatVerified:
      verification.active === true &&
      !verification.bypassed &&
      isVerifiedChurchPremiumReason(verification.reason),
  };

  if (media.subscriptionSource === "app_store") {
    if (candidate.revenueCatVerified) {
      return { eligible: true, reason: "app-store-rc-verified", candidate };
    }
    if (verification.bypassed || isTransientRevenueCatLockReason(verification.reason)) {
      const expiresAt = media.subscriptionExpiresAt ?? null;
      if (expiresAt != null && expiresAt > Date.now()) {
        return { eligible: true, reason: "app-store-profile-expiry-rc-deferred", candidate };
      }
      return { eligible: false, reason: "app-store-rc-deferred-no-expiry", candidate };
    }
    const graceExpiresAt =
      media.subscriptionExpiresAt ?? parseSubscriptionExpiresAtMs(verification.expiresAt);
    if (graceExpiresAt != null && graceExpiresAt > Date.now()) {
      return { eligible: true, reason: "app-store-grace-period", candidate };
    }
    return { eligible: false, reason: "app-store-rc-inactive-expired", candidate };
  }

  if (media.subscriptionSource) {
    return { eligible: false, reason: "non-app-store-source", candidate };
  }

  if (candidate.revenueCatVerified) {
    return { eligible: true, reason: "legacy-rc-verified", candidate };
  }
  if (verification.bypassed || isTransientRevenueCatLockReason(verification.reason)) {
    return { eligible: false, reason: "legacy-rc-deferred", candidate };
  }
  return { eligible: false, reason: "legacy-rc-inactive", candidate };
}

function pickCanonicalAppStoreHolderCandidate(
  candidates: AppStoreBackfillCandidate[]
): AppStoreBackfillCandidate | null {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const rcDelta = Number(b.revenueCatVerified) - Number(a.revenueCatVerified);
    if (rcDelta !== 0) return rcDelta;

    const aUpdated = a.media.subscriptionUpdatedAt ?? a.media.updatedAt ?? 0;
    const bUpdated = b.media.subscriptionUpdatedAt ?? b.media.updatedAt ?? 0;
    if (bUpdated !== aUpdated) return bUpdated - aUpdated;

    return normalizeChurchId(a.media.churchId).localeCompare(
      normalizeChurchId(b.media.churchId)
    );
  });

  return sorted[0] || null;
}

export type SubscriptionOwnershipLockBackfillTrigger = "resolve" | "assert" | "migration";

export async function backfillSubscriptionOwnershipLockFromPastorChurches(args: {
  ownerUserId: string;
  contextChurchId?: string;
  trigger: SubscriptionOwnershipLockBackfillTrigger;
  dryRun?: boolean;
}): Promise<SubscriptionOwnershipLockRecord | null> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const contextChurchId = normalizeChurchId(args.contextChurchId || "");
  if (!ownerUserId) return null;

  const existing = await resolveCanonicalActiveSubscriptionOwnershipLock(ownerUserId);
  if (existing) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_BACKFILL_SKIPPED", {
      ownerUserId,
      contextChurchId: contextChurchId || null,
      trigger: args.trigger,
      reason: "active-lock-exists",
      lockedChurchId: existing.lockedChurchId,
    });
    return existing;
  }

  const profiles = await listAuthoritativePastorMediaProfiles(ownerUserId);
  console.log("KRISTO_SUBSCRIPTION_LOCK_BACKFILL_ATTEMPT", {
    ownerUserId,
    contextChurchId: contextChurchId || null,
    trigger: args.trigger,
    candidateProfileCount: profiles.length,
    candidateChurchIds: profiles.map((media) => normalizeChurchId(media.churchId)),
  });

  if (profiles.length === 0) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_BACKFILL_SKIPPED", {
      ownerUserId,
      contextChurchId: contextChurchId || null,
      trigger: args.trigger,
      reason: "no-active-pastor-media-profiles",
    });
    return null;
  }

  const eligible: AppStoreBackfillCandidate[] = [];
  for (const media of profiles) {
    const evaluated = await evaluateAppStoreBackfillCandidate(media);
    if (!evaluated.eligible || !evaluated.candidate) {
      console.log("KRISTO_SUBSCRIPTION_LOCK_BACKFILL_SKIPPED", {
        ownerUserId,
        contextChurchId: contextChurchId || null,
        trigger: args.trigger,
        reason: evaluated.reason,
        churchId: normalizeChurchId(media.churchId),
      });
      continue;
    }
    eligible.push(evaluated.candidate);
  }

  const winner = pickCanonicalAppStoreHolderCandidate(eligible);
  if (!winner) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_BACKFILL_SKIPPED", {
      ownerUserId,
      contextChurchId: contextChurchId || null,
      trigger: args.trigger,
      reason: "no-eligible-app-store-holder",
      evaluatedProfileCount: profiles.length,
    });
    return null;
  }

  const holderChurchId = normalizeChurchId(winner.media.churchId);
  const holderMedia = mediaProfileForAppStoreLock(winner.media, winner.verification);

  if (args.dryRun) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_BACKFILL_CREATED", {
      ownerUserId,
      contextChurchId: contextChurchId || null,
      trigger: args.trigger,
      lockedChurchId: holderChurchId,
      dryRun: true,
      revenueCatVerified: winner.revenueCatVerified,
      subscriptionPlan: holderMedia.subscriptionPlan ?? null,
      expiresAt: holderMedia.subscriptionExpiresAt ?? null,
    });
    return null;
  }

  const created = await ensureSubscriptionOwnershipLockFromActiveMediaProfile({
    ownerUserId,
    media: holderMedia,
  });

  if (created) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_BACKFILL_CREATED", {
      ownerUserId,
      contextChurchId: contextChurchId || null,
      trigger: args.trigger,
      lockedChurchId: created.lockedChurchId,
      lockedChurchName: created.lockedChurchName,
      revenueCatVerified: winner.revenueCatVerified,
      subscriptionPlan: created.subscriptionPlan,
      expiresAt: created.expiresAt,
      productId: created.productId,
    });
  }

  return created;
}

async function ensureActiveSubscriptionOwnershipLockForPastor(args: {
  ownerUserId: string;
  contextChurchId?: string;
  contextMedia?: ChurchMediaProfile | null;
  backfillTrigger: SubscriptionOwnershipLockBackfillTrigger;
}): Promise<SubscriptionOwnershipLockRecord | null> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  if (!ownerUserId) return null;

  if (args.contextMedia?.subscriptionActive && args.contextMedia.subscriptionSource === "app_store") {
    await ensureSubscriptionOwnershipLockFromActiveMediaProfile({
      ownerUserId,
      media: args.contextMedia,
    });
  }

  let active = await resolveCanonicalActiveSubscriptionOwnershipLock(ownerUserId);
  if (active) return active;

  await backfillSubscriptionOwnershipLockFromPastorChurches({
    ownerUserId,
    contextChurchId: args.contextChurchId,
    trigger: args.backfillTrigger,
  });

  return resolveCanonicalActiveSubscriptionOwnershipLock(ownerUserId);
}

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
  lockedChurchDeleted?: boolean;
  expiresAtLabel: string | null;
  cancelledAllowsPurchaseAttempt?: boolean;
}): string {
  const churchLabel = args.lockedChurchDeleted
    ? `a previous church (${args.lockedChurchName})`
    : args.lockedChurchName;
  const expirySuffix = args.expiresAtLabel
    ? ` Paid access remains reserved until ${args.expiresAtLabel}.`
    : " Paid access remains reserved until the original billing period ends.";
  if (args.cancelledAllowsPurchaseAttempt) {
    return (
      `Your previous store subscription is cancelled but still active until the paid period ends.${expirySuffix} ` +
      "You can try subscribing this church if Apple or Google allows a new purchase. " +
      "The previous subscription will not transfer to this church."
    );
  }
  return (
    `This store subscription is already linked to ${churchLabel}. ` +
    `It cannot be moved to another church.${expirySuffix} ` +
    "Manage or cancel that subscription in the App Store or Google Play."
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
    willRenew: null,
    status: null,
    canPurchase: true,
    canActivate: true,
    message: null,
  };
}

export const CANCELLED_SUBSCRIPTION_NEW_PURCHASE_PERMITTED =
  "cancelled-subscription-new-purchase-permitted";

function cancelledSubscriptionAllowsNewPurchaseAttempt(args: {
  lock?: SubscriptionOwnershipLockRecord | null;
  verification?: ChurchPremiumVerification | null;
}): boolean {
  const willRenew = args.lock?.willRenew ?? args.verification?.willRenew ?? null;
  return willRenew === false;
}

function payloadFromLock(args: {
  lock: SubscriptionOwnershipLockRecord;
  churchId: string;
}): SubscriptionOwnershipLockApiPayload {
  const isLockHolder = churchIdsMatch(args.lock.lockedChurchId, args.churchId);
  const blocked = !isLockHolder;
  const cancelledAllowsPurchaseAttempt =
    blocked && cancelledSubscriptionAllowsNewPurchaseAttempt({ lock: args.lock });
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
    willRenew: args.lock.willRenew ?? null,
    status: args.lock.status,
    canPurchase: !blocked || cancelledAllowsPurchaseAttempt,
    canActivate: !blocked,
    message: blocked
      ? buildLockMessage({
          lockedChurchName: args.lock.lockedChurchName,
          lockedChurchDeleted: args.lock.lockedChurchDeleted === true,
          expiresAtLabel,
          cancelledAllowsPurchaseAttempt,
        })
      : null,
  };
}

export async function buildPrepurchaseOwnershipConflictResponse(args: {
  churchId: string;
  reason?: string;
  lock: SubscriptionOwnershipLockRecord;
  verification?: ChurchPremiumVerification | null;
}) {
  const churchMeta = await resolveLockedChurchName(
    args.lock.lockedChurchId,
    args.lock.lockedChurchName
  );
  const resolvedLock: SubscriptionOwnershipLockRecord = {
    ...args.lock,
    lockedChurchName: churchMeta.name,
    lockedChurchDeleted: churchMeta.deleted,
    willRenew: args.lock.willRenew ?? args.verification?.willRenew ?? null,
    store: args.lock.store ?? args.verification?.store ?? null,
  };
  const subscriptionOwnershipLock = payloadFromLock({
    lock: resolvedLock,
    churchId: args.churchId,
  });

  return {
    ok: false as const,
    allowed: false as const,
    reason: args.reason ?? "store-subscription-ownership-conflict",
    lockedChurchId: resolvedLock.lockedChurchId,
    lockedChurchName: churchMeta.name,
    store: subscriptionOwnershipLock.store,
    expiresAt: subscriptionOwnershipLock.expiresAt,
    willRenew: subscriptionOwnershipLock.willRenew,
    subscriptionOwnershipLock,
    productId: args.verification?.productId ?? resolvedLock.productId ?? null,
  };
}

export function listActiveSubscriptionOwnershipLocks(
  locks: SubscriptionOwnershipLockRecord[]
): SubscriptionOwnershipLockRecord[] {
  return locks.filter((lock) => lock.status === "active");
}

/** @deprecated Prefer resolveCanonicalActiveSubscriptionOwnershipLock for RC-safe reconciliation. */
export function getActiveSubscriptionOwnershipLock(
  locks: SubscriptionOwnershipLockRecord[]
): SubscriptionOwnershipLockRecord | null {
  return listActiveSubscriptionOwnershipLocks(locks)[0] || null;
}

function isTransientRevenueCatLockReason(reason: string): boolean {
  const normalized = String(reason || "").trim().toLowerCase();
  return (
    normalized.startsWith("revenuecat-http-") ||
    normalized === "no-secret" ||
    normalized === "timeout" ||
    normalized === "fetch-error" ||
    normalized === "missing-app-user-id"
  );
}

function lockEntitlementStillInGrace(args: {
  lock: SubscriptionOwnershipLockRecord;
  verification: ChurchPremiumVerification;
}): boolean {
  const now = Date.now();
  const candidates = [
    args.lock.expiresAt,
    parseSubscriptionExpiresAtMs(args.verification.expiresAt),
  ].filter((value): value is number => value != null && Number.isFinite(value));

  return candidates.some((expiresAt) => expiresAt > now);
}

async function resolveLockedChurchName(
  churchId: string,
  fallback?: string | null
): Promise<{ name: string; deleted: boolean }> {
  const cid = normalizeChurchId(churchId);
  if (!cid) {
    const name = String(fallback || "another church").trim() || "another church";
    return { name, deleted: true };
  }
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

async function reconcileActiveLockWithRevenueCat(
  lock: SubscriptionOwnershipLockRecord
): Promise<SubscriptionOwnershipLockRecord> {
  if (lock.status !== "active") return lock;

  const lockedChurchId = normalizeChurchId(lock.lockedChurchId);
  if (!lockedChurchId) return lock;

  const verification = await verifyChurchPremiumEntitlement(lockedChurchId, {
    forActivation: true,
  });

  if (verification.bypassed || isTransientRevenueCatLockReason(verification.reason)) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_RECONCILE_DEFERRED", {
      ownerUserId: lock.ownerUserId,
      lockedChurchId,
      revenueCatReason: verification.reason,
      revenueCatActive: verification.active,
      bypassed: verification.bypassed === true,
    });
    return lock;
  }

  const verifiedActive =
    verification.active && isVerifiedChurchPremiumReason(verification.reason);

  if (verifiedActive) {
    const expiresAtMs = parseSubscriptionExpiresAtMs(verification.expiresAt);
    const nextExpiresAt = expiresAtMs ?? lock.expiresAt ?? null;
    const nextPlan = verification.plan ?? lock.subscriptionPlan;
    const nextProductId = verification.productId ?? lock.productId;

    if (
      nextExpiresAt !== lock.expiresAt ||
      nextPlan !== lock.subscriptionPlan ||
      nextProductId !== lock.productId
    ) {
      return saveSubscriptionOwnershipLock({
        ...lock,
        expiresAt: nextExpiresAt,
        subscriptionPlan: nextPlan,
        productId: nextProductId,
        updatedAt: Date.now(),
      });
    }
    return lock;
  }

  if (lockEntitlementStillInGrace({ lock, verification })) {
    const rcExpiresAt = parseSubscriptionExpiresAtMs(verification.expiresAt);
    if (rcExpiresAt != null && rcExpiresAt !== lock.expiresAt) {
      return saveSubscriptionOwnershipLock({
        ...lock,
        expiresAt: rcExpiresAt,
        updatedAt: Date.now(),
      });
    }

    console.log("KRISTO_SUBSCRIPTION_LOCK_RECONCILE_KEEP_GRACE", {
      ownerUserId: lock.ownerUserId,
      lockedChurchId,
      expiresAt: lock.expiresAt ?? rcExpiresAt ?? null,
      revenueCatReason: verification.reason,
    });
    return lock;
  }

  return markLockStatus(lock, "expired", "expired");
}

export async function resolveCanonicalActiveSubscriptionOwnershipLock(
  ownerUserId: string,
  locks?: SubscriptionOwnershipLockRecord[]
): Promise<SubscriptionOwnershipLockRecord | null> {
  const uid = normalizeUserId(ownerUserId);
  if (!uid) return null;

  const allLocks = locks ?? (await listSubscriptionOwnershipLocksByOwnerUserId(uid));
  const actives = listActiveSubscriptionOwnershipLocks(allLocks);
  if (actives.length === 0) return null;

  let winner = actives[0];
  if (actives.length > 1) {
    const sorted = [...actives].sort((a, b) => {
      const lockedAtDelta = (b.lockedAt || 0) - (a.lockedAt || 0);
      if (lockedAtDelta !== 0) return lockedAtDelta;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    winner = sorted[0];
    const losers = sorted.slice(1);

    console.log("KRISTO_SUBSCRIPTION_LOCK_CONFLICT", {
      ownerUserId: uid,
      winnerChurchId: winner.lockedChurchId,
      loserChurchIds: losers.map((lock) => lock.lockedChurchId),
      activeCount: actives.length,
    });

    for (const loser of losers) {
      await markLockStatus(loser, "released", "replaced");
    }
  }

  const reconciled = await reconcileActiveLockWithRevenueCat(winner);
  return reconciled.status === "active" ? reconciled : null;
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
  const active = await resolveCanonicalActiveSubscriptionOwnershipLock(ownerUserId, locks);
  if (active && churchIdsMatch(active.lockedChurchId, churchId)) {
    return saveSubscriptionOwnershipLock({
      ...active,
      expiresAt: media.subscriptionExpiresAt ?? active.expiresAt ?? null,
      subscriptionPlan:
        media.subscriptionPlan === "yearly"
          ? "yearly"
          : media.subscriptionPlan === "monthly"
            ? "monthly"
            : active.subscriptionPlan,
      updatedAt: Date.now(),
    });
  }
  if (active && !churchIdsMatch(active.lockedChurchId, churchId)) {
    return active;
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

  console.log("KRISTO_SUBSCRIPTION_LOCK_CREATED", {
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    source: "media-profile-backfill",
  });

  return acquireActiveSubscriptionOwnershipLock(record);
}

export async function assertAppStoreSubscriptionActivationAllowed(args: {
  churchId: string;
  ownerUserId: string;
  verification?: ChurchPremiumVerification | null;
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

  const active = await ensureActiveSubscriptionOwnershipLockForPastor({
    ownerUserId,
    contextChurchId: churchId,
    backfillTrigger: "assert",
  });
  if (!active) {
    return { allowed: true, lock: null };
  }

  if (churchIdsMatch(active.lockedChurchId, churchId)) {
    return { allowed: true, lock: active };
  }

  const incomingIdentity = String(args.verification?.storeSubscriptionIdentity || "").trim();
  const lockedIdentity = String(active.storeSubscriptionIdentity || "").trim();
  if (incomingIdentity && lockedIdentity && incomingIdentity !== lockedIdentity) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_ALLOWED_NEW_STORE_IDENTITY", {
      ownerUserId,
      churchId,
      lockedChurchId: active.lockedChurchId,
      lockedChurchName: active.lockedChurchName,
      lockedStoreSubscriptionIdentity: lockedIdentity,
      incomingStoreSubscriptionIdentity: incomingIdentity,
      willRenew: active.willRenew ?? null,
    });
    return { allowed: true, lock: active };
  }
  if (incomingIdentity && !lockedIdentity && active.willRenew === false) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_ALLOWED_CANCELLED_NEW_IDENTITY", {
      ownerUserId,
      churchId,
      lockedChurchId: active.lockedChurchId,
      incomingStoreSubscriptionIdentity: incomingIdentity,
      willRenew: active.willRenew ?? null,
    });
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

function lockIsExpired(lock: SubscriptionOwnershipLockRecord, now = Date.now()): boolean {
  if (lock.status !== "active") return true;
  if (lock.expiresAt == null || !Number.isFinite(lock.expiresAt)) return false;
  return lock.expiresAt <= now;
}

async function releaseExpiredStoreSubscriptionLock(
  lock: SubscriptionOwnershipLockRecord
): Promise<SubscriptionOwnershipLockRecord> {
  const released = await markLockStatus(lock, "expired", "expired");
  console.log("KRISTO_SUBSCRIPTION_LOCK_EXPIRED_RELEASED", {
    ownerUserId: released.ownerUserId,
    lockedChurchId: released.lockedChurchId,
    lockedChurchName: released.lockedChurchName,
    lockedChurchDeleted: released.lockedChurchDeleted === true,
    storeSubscriptionIdentity: released.storeSubscriptionIdentity ?? null,
    expiresAt: released.expiresAt,
    productId: released.productId,
    store: released.store,
  });
  return released;
}

export function assertVerifiedStoreSubscriptionIdentityForOwnership(args: {
  churchId: string;
  verification: ChurchPremiumVerification;
}): {
  verified: boolean;
  reason?: string;
} {
  const churchId = normalizeChurchId(args.churchId);
  const verification = args.verification;

  if (!verifiedStoreSubscriptionRequiresIdentity(verification)) {
    return { verified: true };
  }

  const aliased = isRevenueCatSubscriberAliasedFromChurch({
    churchId,
    revenueCatOriginalAppUserId: verification.revenueCatOriginalAppUserId,
  });

  if (!hasVerifiedStoreSubscriptionIdentity(verification)) {
    console.log("KRISTO_SUBSCRIPTION_ACTIVATION_BLOCKED_UNVERIFIED_STORE_IDENTITY", {
      churchId,
      productId: verification.productId ?? null,
      store: verification.store ?? null,
      revenueCatOriginalAppUserId: verification.revenueCatOriginalAppUserId ?? null,
      revenueCatSubscriberAliased: aliased,
      revenueCatLane: verification.revenueCatLane ?? null,
      blockLayer: "missing-store-subscription-identity",
    });
    return {
      verified: false,
      reason: aliased ? "conflict-pending-verification" : "unverified-store-identity",
    };
  }

  if (aliased) {
    console.log("KRISTO_SUBSCRIPTION_ACTIVATION_BLOCKED_UNVERIFIED_STORE_IDENTITY", {
      churchId,
      productId: verification.productId ?? null,
      store: verification.store ?? null,
      storeSubscriptionIdentity: verification.storeSubscriptionIdentity ?? null,
      revenueCatOriginalAppUserId: verification.revenueCatOriginalAppUserId ?? null,
      revenueCatSubscriberAliased: true,
      blockLayer: "revenuecat-subscriber-alias",
    });
  }

  return { verified: true };
}

export async function assertStoreSubscriptionOwnershipForActivation(args: {
  churchId: string;
  ownerUserId: string;
  verification: ChurchPremiumVerification;
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

  const pastorCheck = await assertAppStoreSubscriptionActivationAllowed({
    churchId,
    ownerUserId,
    verification: args.verification,
  });
  if (!pastorCheck.allowed) {
    console.log("KRISTO_SUBSCRIPTION_ACTIVATION_BLOCKED_OWNER_MISMATCH", {
      churchId,
      ownerUserId,
      blockLayer: "pastor-lock",
      lockedChurchId: pastorCheck.lock?.lockedChurchId ?? null,
      lockOwnerUserId: pastorCheck.lock?.ownerUserId ?? null,
      lockedChurchDeleted: pastorCheck.lock?.lockedChurchDeleted === true,
      expiresAt: pastorCheck.lock?.expiresAt ?? null,
      productId: pastorCheck.lock?.productId ?? null,
      store: pastorCheck.lock?.store ?? null,
      storeSubscriptionIdentity: pastorCheck.lock?.storeSubscriptionIdentity ?? null,
    });
    return {
      allowed: false,
      reason: pastorCheck.reason || "subscription-ownership-lock",
      lock: pastorCheck.lock,
    };
  }

  const identityCheck = assertVerifiedStoreSubscriptionIdentityForOwnership({
    churchId,
    verification: args.verification,
  });
  if (!identityCheck.verified) {
    return {
      allowed: false,
      reason: identityCheck.reason || "unverified-store-identity",
      lock: pastorCheck.lock,
    };
  }

  const store = args.verification.store;
  const storeSubscriptionIdentity = String(args.verification.storeSubscriptionIdentity || "").trim();
  if (!store || !storeSubscriptionIdentity) {
    console.log("KRISTO_SUBSCRIPTION_ACTIVATION_BLOCKED_UNVERIFIED_STORE_IDENTITY", {
      churchId,
      ownerUserId,
      productId: args.verification.productId ?? null,
      store: store ?? null,
      blockLayer: "missing-store-or-identity-after-check",
    });
    return {
      allowed: false,
      reason: "unverified-store-identity",
      lock: pastorCheck.lock,
    };
  }

  const storeLocks = await listActiveSubscriptionOwnershipLocksByStoreIdentity({
    store,
    storeSubscriptionIdentity,
  });

  for (const lock of storeLocks) {
    if (lockIsExpired(lock)) {
      await releaseExpiredStoreSubscriptionLock(lock);
      continue;
    }

    const churchMatch = churchIdsMatch(lock.lockedChurchId, churchId);
    const ownerMatch =
      normalizeUserId(lock.ownerUserId).toLowerCase() === ownerUserId.toLowerCase();

    if (churchMatch && ownerMatch) {
      console.log("KRISTO_SUBSCRIPTION_LOCK_MATCH_CURRENT_CHURCH", {
        churchId,
        ownerUserId,
        lockedChurchId: lock.lockedChurchId,
        lockedChurchDeleted: lock.lockedChurchDeleted === true,
        storeSubscriptionIdentity,
        productId: lock.productId,
        expiresAt: lock.expiresAt,
        willRenew: lock.willRenew ?? null,
        matchLayer: "store-identity",
      });
      return { allowed: true, lock };
    }

    console.log("KRISTO_SUBSCRIPTION_ACTIVATION_BLOCKED_OWNER_MISMATCH", {
      churchId,
      ownerUserId,
      blockLayer: "store-identity",
      storeSubscriptionIdentity,
      lockedChurchId: lock.lockedChurchId,
      lockedChurchName: lock.lockedChurchName,
      lockOwnerUserId: lock.ownerUserId,
      lockedChurchDeleted: lock.lockedChurchDeleted === true,
      expiresAt: lock.expiresAt,
      willRenew: lock.willRenew ?? null,
      productId: lock.productId,
      store: lock.store,
    });

    return {
      allowed: false,
      reason: "store-subscription-ownership-conflict",
      lock,
    };
  }

  if (
    pastorCheck.lock &&
    churchIdsMatch(pastorCheck.lock.lockedChurchId, churchId) &&
    normalizeUserId(pastorCheck.lock.ownerUserId).toLowerCase() === ownerUserId.toLowerCase()
  ) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_MATCH_CURRENT_CHURCH", {
      churchId,
      ownerUserId,
      lockedChurchId: pastorCheck.lock.lockedChurchId,
      lockedChurchDeleted: pastorCheck.lock.lockedChurchDeleted === true,
      storeSubscriptionIdentity,
      matchLayer: "pastor-lock",
    });
  }

  return { allowed: true, lock: pastorCheck.lock };
}

export async function checkStoreSubscriptionPrepurchaseOwnership(args: {
  churchId: string;
  ownerUserId: string;
}): Promise<{
  allowed: boolean;
  reason?: string;
  lock: SubscriptionOwnershipLockRecord | null;
  verification: ChurchPremiumVerification | null;
  payload: SubscriptionOwnershipLockApiPayload;
}> {
  const churchId = normalizeChurchId(args.churchId);
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const emptyPayload = emptyLockPayload();

  console.log("KRISTO_SUBSCRIPTION_PREPURCHASE_OWNERSHIP_CHECK", {
    churchId,
    ownerUserId,
  });

  if (!churchId || !ownerUserId) {
    return {
      allowed: true,
      reason: "missing-ids",
      lock: null,
      verification: null,
      payload: emptyPayload,
    };
  }

  const pastorCheck = await assertAppStoreSubscriptionActivationAllowed({
    churchId,
    ownerUserId,
  });
  const verification = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });

  if (!pastorCheck.allowed && pastorCheck.lock) {
    if (
      cancelledSubscriptionAllowsNewPurchaseAttempt({
        lock: pastorCheck.lock,
        verification,
      })
    ) {
      const payload = payloadFromLock({ lock: pastorCheck.lock, churchId });
      console.log("KRISTO_SUBSCRIPTION_CANCELLED_OVERLAP_PURCHASE_PERMITTED", {
        churchId,
        ownerUserId,
        reason: CANCELLED_SUBSCRIPTION_NEW_PURCHASE_PERMITTED,
        blockLayer: "pastor-lock-prepurchase",
        lockedChurchId: pastorCheck.lock.lockedChurchId,
        lockedChurchName: pastorCheck.lock.lockedChurchName,
        willRenew: pastorCheck.lock.willRenew ?? verification.willRenew ?? null,
        expiresAt: pastorCheck.lock.expiresAt,
        store: pastorCheck.lock.store,
      });
      return {
        allowed: true,
        reason: CANCELLED_SUBSCRIPTION_NEW_PURCHASE_PERMITTED,
        lock: pastorCheck.lock,
        verification,
        payload,
      };
    }

    const payload = payloadFromLock({ lock: pastorCheck.lock, churchId });
    console.log("KRISTO_SUBSCRIPTION_EXISTING_STORE_CONFLICT", {
      churchId,
      ownerUserId,
      reason: pastorCheck.reason ?? "subscription-ownership-lock",
      blockLayer: "pastor-lock-prepurchase",
      lockedChurchId: pastorCheck.lock.lockedChurchId,
      lockedChurchName: pastorCheck.lock.lockedChurchName,
      lockedChurchDeleted: pastorCheck.lock.lockedChurchDeleted === true,
      storeSubscriptionIdentity: pastorCheck.lock.storeSubscriptionIdentity ?? null,
      expiresAt: pastorCheck.lock.expiresAt,
      productId: pastorCheck.lock.productId,
      store: pastorCheck.lock.store,
    });
    return {
      allowed: false,
      reason: pastorCheck.reason || "subscription-ownership-lock",
      lock: pastorCheck.lock,
      verification,
      payload,
    };
  }

  if (
    !verification.active ||
    verification.bypassed ||
    !isVerifiedChurchPremiumReason(verification.reason)
  ) {
    return {
      allowed: true,
      reason: "no-verified-store-entitlement",
      lock: null,
      verification,
      payload: emptyPayload,
    };
  }

  const identityCheck = assertVerifiedStoreSubscriptionIdentityForOwnership({
    churchId,
    verification,
  });
  if (!identityCheck.verified) {
    if (
      identityCheck.reason === "conflict-pending-verification" &&
      cancelledSubscriptionAllowsNewPurchaseAttempt({ verification })
    ) {
      console.log("KRISTO_SUBSCRIPTION_CANCELLED_OVERLAP_PURCHASE_PERMITTED", {
        churchId,
        ownerUserId,
        reason: CANCELLED_SUBSCRIPTION_NEW_PURCHASE_PERMITTED,
        blockLayer: "conflict-pending-verification",
        willRenew: verification.willRenew ?? null,
        productId: verification.productId ?? null,
        store: verification.store ?? null,
      });
      return {
        allowed: true,
        reason: CANCELLED_SUBSCRIPTION_NEW_PURCHASE_PERMITTED,
        lock: pastorCheck.lock,
        verification,
        payload: pastorCheck.lock
          ? payloadFromLock({ lock: pastorCheck.lock, churchId })
          : emptyPayload,
      };
    }

    return {
      allowed: false,
      reason: identityCheck.reason || "unverified-store-identity",
      lock: null,
      verification,
      payload: emptyPayload,
    };
  }

  let ownership = await assertStoreSubscriptionOwnershipForActivation({
    churchId,
    ownerUserId,
    verification,
  });

  if (
    ownership.allowed &&
    !verification.storeSubscriptionIdentity &&
    verification.productId
  ) {
    const tombstones = await listActiveDeletedChurchSubscriptionLocks();
    const tombstoneConflict = tombstones.find((lock) => {
      if (lockIsExpired(lock)) return false;
      if (churchIdsMatch(lock.lockedChurchId, churchId)) return false;
      if (lock.productId && lock.productId !== verification.productId) return false;
      if (verification.store && lock.store && lock.store !== verification.store) return false;
      return true;
    });
    if (tombstoneConflict) {
      ownership = {
        allowed: false,
        reason: "store-subscription-ownership-conflict",
        lock: tombstoneConflict,
      };
      console.log("KRISTO_SUBSCRIPTION_EXISTING_STORE_CONFLICT", {
        churchId,
        ownerUserId,
        reason: "deleted-church-tombstone-product-match",
        blockLayer: "tombstone-fallback",
        lockedChurchId: tombstoneConflict.lockedChurchId,
        lockedChurchName: tombstoneConflict.lockedChurchName,
        storeSubscriptionIdentity: tombstoneConflict.storeSubscriptionIdentity ?? null,
        productId: verification.productId,
        store: verification.store ?? null,
      });
    }
  }

  if (!ownership.allowed && ownership.lock) {
    if (
      cancelledSubscriptionAllowsNewPurchaseAttempt({
        lock: ownership.lock,
        verification,
      })
    ) {
      const payload = payloadFromLock({ lock: ownership.lock, churchId });
      console.log("KRISTO_SUBSCRIPTION_CANCELLED_OVERLAP_PURCHASE_PERMITTED", {
        churchId,
        ownerUserId,
        reason: CANCELLED_SUBSCRIPTION_NEW_PURCHASE_PERMITTED,
        blockLayer: "store-identity-prepurchase",
        lockedChurchId: ownership.lock.lockedChurchId,
        lockedChurchName: ownership.lock.lockedChurchName,
        willRenew: ownership.lock.willRenew ?? verification.willRenew ?? null,
        storeSubscriptionIdentity: ownership.lock.storeSubscriptionIdentity ?? null,
        expiresAt: ownership.lock.expiresAt,
      });
      return {
        allowed: true,
        reason: CANCELLED_SUBSCRIPTION_NEW_PURCHASE_PERMITTED,
        lock: ownership.lock,
        verification,
        payload,
      };
    }

    const payload = payloadFromLock({ lock: ownership.lock, churchId });
    console.log("KRISTO_SUBSCRIPTION_EXISTING_STORE_CONFLICT", {
      churchId,
      ownerUserId,
      reason: ownership.reason ?? null,
      lockedChurchId: ownership.lock.lockedChurchId,
      lockedChurchName: ownership.lock.lockedChurchName,
      lockedChurchDeleted: ownership.lock.lockedChurchDeleted === true,
      storeSubscriptionIdentity:
        ownership.lock.storeSubscriptionIdentity ??
        verification.storeSubscriptionIdentity ??
        null,
      expiresAt: ownership.lock.expiresAt,
      willRenew: ownership.lock.willRenew ?? null,
      productId: ownership.lock.productId,
      store: ownership.lock.store,
    });
    return {
      allowed: false,
      reason: ownership.reason,
      lock: ownership.lock,
      verification,
      payload,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    lock: ownership.lock,
    verification,
    payload: ownership.lock
      ? payloadFromLock({ lock: ownership.lock, churchId })
      : emptyPayload,
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

  const record: SubscriptionOwnershipLockRecord = {
    id: `sub-lock-${ownerUserId.toLowerCase()}-${churchId.toLowerCase()}`,
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    lockedChurchDeleted: churchMeta.deleted,
    revenueCatAppUserId: churchId,
    revenueCatOriginalAppUserId: churchId,
    productId: args.verification.productId ?? null,
    store: args.verification.store ?? "app_store",
    storeSubscriptionIdentity: args.verification.storeSubscriptionIdentity ?? null,
    storeTransactionId: args.verification.storeTransactionId ?? null,
    willRenew: args.verification.willRenew ?? null,
    platform: null,
    subscriptionPlan: args.subscriptionPlan,
    expiresAt: args.expiresAtMs,
    lockedAt: now,
    updatedAt: now,
    status: "active",
    releasedAt: null,
    releaseReason: null,
  };

  console.log("KRISTO_SUBSCRIPTION_LOCK_CREATED", {
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    productId: record.productId,
    storeSubscriptionIdentity: record.storeSubscriptionIdentity ?? null,
    expiresAt: record.expiresAt,
    source: "app-store-activation",
  });

  return acquireActiveSubscriptionOwnershipLock(record);
}

/** Keep the pastor's store subscription lock on the deleted church until expiry. */
export async function preserveSubscriptionOwnershipLockTombstoneForChurchDelete(args: {
  ownerUserId: string;
  churchId: string;
}): Promise<{
  preserved: boolean;
  reason?: string;
  lock: SubscriptionOwnershipLockRecord | null;
}> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const churchId = normalizeChurchId(args.churchId);
  if (!ownerUserId || !churchId) {
    return { preserved: false, reason: "missing-ids", lock: null };
  }

  if (!(await pastorOwnsChurchMedia(ownerUserId, churchId))) {
    return { preserved: false, reason: "not-pastor", lock: null };
  }

  const media = await getChurchMediaByChurchId(churchId);
  let active = await ensureActiveSubscriptionOwnershipLockForPastor({
    ownerUserId,
    contextChurchId: churchId,
    contextMedia: media,
    backfillTrigger: "assert",
  });

  if (active && !churchIdsMatch(active.lockedChurchId, churchId)) {
    return { preserved: false, reason: "lock-held-by-other-church", lock: active };
  }

  if (!active && media && isChurchSubscriptionActiveFromRecord(media)) {
    active = await ensureSubscriptionOwnershipLockFromActiveMediaProfile({
      ownerUserId,
      media,
    });
  }

  if (!active || !churchIdsMatch(active.lockedChurchId, churchId)) {
    return {
      preserved: false,
      reason: active ? "lock-mismatch" : "no-active-lock",
      lock: active,
    };
  }

  const expiresAt =
    active.expiresAt ??
    media?.subscriptionExpiresAt ??
    null;
  const churchMeta = await resolveLockedChurchName(
    churchId,
    active.lockedChurchName || media?.mediaName
  );

  let storeSubscriptionIdentity = active.storeSubscriptionIdentity ?? null;
  let storeTransactionId = active.storeTransactionId ?? null;
  let store = active.store ?? null;
  let willRenew = active.willRenew ?? null;
  let productId = active.productId ?? null;

  try {
    const verification = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });
    if (verification.active && isVerifiedChurchPremiumReason(verification.reason)) {
      storeSubscriptionIdentity =
        verification.storeSubscriptionIdentity ?? storeSubscriptionIdentity;
      storeTransactionId = verification.storeTransactionId ?? storeTransactionId;
      store = verification.store ?? store;
      willRenew = verification.willRenew ?? willRenew;
      productId = verification.productId ?? productId;
    }
  } catch {
    // keep existing lock store identity when RC verify is unavailable
  }

  const preserved = await saveSubscriptionOwnershipLock({
    ...active,
    lockedChurchName: churchMeta.name,
    lockedChurchDeleted: true,
    expiresAt,
    storeSubscriptionIdentity,
    storeTransactionId,
    store,
    willRenew,
    productId,
    status: "active",
    releasedAt: null,
    releaseReason: null,
    updatedAt: Date.now(),
  });

  console.log("KRISTO_CHURCH_DELETE_LOCK_TOMBSTONE_PRESERVED", {
    ownerUserId,
    churchId,
    lockedChurchId: preserved.lockedChurchId,
    lockedChurchName: preserved.lockedChurchName,
    lockedChurchDeleted: preserved.lockedChurchDeleted === true,
    expiresAt: preserved.expiresAt,
    store: preserved.store,
    status: preserved.status,
  });

  return { preserved: true, lock: preserved };
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

    const reconciled = await reconcileActiveLockWithRevenueCat(lock);
    if (reconciled.status === "active") {
      console.log("KRISTO_SUBSCRIPTION_LOCK_RELEASE_SKIPPED_RC_ACTIVE", {
        ownerUserId,
        lockedChurchId: churchId,
        expiresAt: reconciled.expiresAt,
        requestedReleaseReason: args.releaseReason ?? null,
      });
      return;
    }

    if (args.releaseReason === "admin") {
      await markLockStatus(reconciled, "released", "admin");
    }
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

  console.log("KRISTO_SUBSCRIPTION_LOCK_STORE_MODE", {
    ownerUserId,
    churchId,
    storeMode: resolveSubscriptionOwnershipLockStoreMode(),
  });

  const active = await ensureActiveSubscriptionOwnershipLockForPastor({
    ownerUserId,
    contextChurchId: churchId,
    contextMedia: args.media,
    backfillTrigger: "resolve",
  });

  if (!active) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_NOT_FOUND", {
      ownerUserId,
      churchId,
      reason: "no-active-lock-after-backfill",
    });
    return { lock: null, payload: emptyLockPayload() };
  }

  const churchMeta = await resolveLockedChurchName(active.lockedChurchId, active.lockedChurchName);
  let resolvedActive = active;
  if (
    active.lockedChurchName !== churchMeta.name ||
    active.lockedChurchDeleted !== churchMeta.deleted
  ) {
    resolvedActive = await saveSubscriptionOwnershipLock({
      ...active,
      lockedChurchName: churchMeta.name,
      lockedChurchDeleted: churchMeta.deleted,
    });
  }

  const payload = payloadFromLock({ lock: resolvedActive, churchId });

  console.log("KRISTO_SUBSCRIPTION_LOCK_DETECTED", {
    ownerUserId,
    churchId,
    blocked: payload.blocked,
    isLockHolder: payload.isLockHolder,
    lockedChurchId: resolvedActive.lockedChurchId,
    lockedChurchName: resolvedActive.lockedChurchName,
    expiresAt: resolvedActive.expiresAt,
    status: resolvedActive.status,
    store: resolvedActive.store,
    platform: resolvedActive.platform,
  });

  return { lock: resolvedActive, payload };
}

export function payloadFromLockForChurch(args: {
  lock: SubscriptionOwnershipLockRecord;
  churchId: string;
}): SubscriptionOwnershipLockApiPayload {
  return payloadFromLock(args);
}
