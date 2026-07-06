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
  listAllSubscriptionOwnershipLocks,
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
  lockedChurchAvatarUrl: string | null;
  lockedChurchDeleted: boolean;
  lockedChurchDeletedAt: number | null;
  lockedChurchDeletedAtLabel: string | null;
  expiresAt: number | null;
  expiresAtLabel: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionExpiresAtLabel: string | null;
  platform: "ios" | "android" | null;
  store: "app_store" | "play_store" | null;
  willRenew: boolean | null;
  status: SubscriptionOwnershipLockStatus | null;
  canPurchase: boolean;
  canActivate: boolean;
  hasLinkedChurchDisplay: boolean;
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
    lockedChurchAvatarUrl: null,
    lockedChurchDeleted: false,
    lockedChurchDeletedAt: null,
    lockedChurchDeletedAtLabel: null,
    expiresAt: null,
    expiresAtLabel: null,
    subscriptionExpiresAt: null,
    subscriptionExpiresAtLabel: null,
    platform: null,
    store: null,
    willRenew: null,
    status: null,
    canPurchase: true,
    canActivate: true,
    hasLinkedChurchDisplay: false,
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
  const lockedChurchName = String(args.lock.lockedChurchName || "").trim() || null;
  const lockedChurchDeleted = args.lock.lockedChurchDeleted === true;
  const lockedChurchDeletedAt =
    typeof args.lock.lockedChurchDeletedAt === "number" &&
    Number.isFinite(args.lock.lockedChurchDeletedAt)
      ? args.lock.lockedChurchDeletedAt
      : null;
  const lockedChurchAvatarUrl =
    String(args.lock.lockedChurchAvatarUrl || "").trim() || null;
  return {
    blocked,
    isLockHolder,
    lockedChurchId: args.lock.lockedChurchId,
    lockedChurchName,
    lockedChurchAvatarUrl,
    lockedChurchDeleted,
    lockedChurchDeletedAt,
    lockedChurchDeletedAtLabel: formatExpiresAtLabel(lockedChurchDeletedAt),
    expiresAt: args.lock.expiresAt,
    expiresAtLabel,
    subscriptionExpiresAt: args.lock.expiresAt,
    subscriptionExpiresAtLabel: expiresAtLabel,
    platform: args.lock.platform,
    store: args.lock.store,
    willRenew: args.lock.willRenew ?? null,
    status: args.lock.status,
    canPurchase: !blocked || cancelledAllowsPurchaseAttempt,
    canActivate: !blocked,
    hasLinkedChurchDisplay: Boolean(lockedChurchName),
    message: blocked
      ? buildLockMessage({
          lockedChurchName: lockedChurchName || "a previous church",
          lockedChurchDeleted,
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
  const churchMeta = await resolveLockedChurchSnapshot(args.lock.lockedChurchId, {
    name: args.lock.lockedChurchName,
    avatarUrl: args.lock.lockedChurchAvatarUrl,
    deleted: args.lock.lockedChurchDeleted,
    deletedAt: args.lock.lockedChurchDeletedAt,
  });
  const resolvedLock: SubscriptionOwnershipLockRecord = {
    ...args.lock,
    lockedChurchName: churchMeta.name,
    lockedChurchAvatarUrl: churchMeta.avatarUrl ?? args.lock.lockedChurchAvatarUrl ?? null,
    lockedChurchDeleted: churchMeta.deleted || args.lock.lockedChurchDeleted === true,
    lockedChurchDeletedAt:
      args.lock.lockedChurchDeletedAt ??
      (churchMeta.deleted ? churchMeta.deletedAt : null),
    willRenew: args.lock.willRenew ?? args.verification?.willRenew ?? null,
    store: args.lock.store ?? args.verification?.store ?? null,
    expiresAt:
      args.lock.expiresAt ??
      parseSubscriptionExpiresAtMs(args.verification?.expiresAt) ??
      null,
  };
  const subscriptionOwnershipLock = payloadFromLock({
    lock: resolvedLock,
    churchId: args.churchId,
  });

  return {
    ok: false as const,
    allowed: false as const,
    reason: args.reason ?? "store-subscription-ownership-conflict",
    lockedChurchId: subscriptionOwnershipLock.lockedChurchId,
    lockedChurchName: subscriptionOwnershipLock.lockedChurchName,
    lockedChurchAvatarUrl: subscriptionOwnershipLock.lockedChurchAvatarUrl,
    lockedChurchDeleted: subscriptionOwnershipLock.lockedChurchDeleted,
    lockedChurchDeletedAt: subscriptionOwnershipLock.lockedChurchDeletedAt,
    subscriptionExpiresAt: subscriptionOwnershipLock.subscriptionExpiresAt,
    willRenew: subscriptionOwnershipLock.willRenew,
    store: subscriptionOwnershipLock.store,
    subscriptionOwnershipLock,
    productId: args.verification?.productId ?? resolvedLock.productId ?? null,
  };
}

function subscriptionLockHasDisplayMetadata(
  lock: SubscriptionOwnershipLockRecord | null | undefined
): boolean {
  return Boolean(lock && String(lock.lockedChurchName || "").trim());
}

function lockNeedsDisplayMetadataEnrichment(lock: SubscriptionOwnershipLockRecord): boolean {
  const needsName = !String(lock.lockedChurchName || "").trim();
  const needsAvatar = !String(lock.lockedChurchAvatarUrl || "").trim();
  const needsDeletedAt = lock.lockedChurchDeleted === true && lock.lockedChurchDeletedAt == null;
  const needsExpiry = lock.expiresAt == null;
  return needsName || needsAvatar || needsDeletedAt || needsExpiry;
}

function expiryTimestampsMatch(
  left: number | null | undefined,
  right: number | null | undefined,
  toleranceMs = 120_000
): boolean {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.abs(left - right) <= toleranceMs;
}

function sortLocksByRecency(
  locks: SubscriptionOwnershipLockRecord[]
): SubscriptionOwnershipLockRecord[] {
  return [...locks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function lockMatchesVerificationSnapshot(
  lock: SubscriptionOwnershipLockRecord,
  verification?: ChurchPremiumVerification | null
): boolean {
  if (!verification) return false;
  const verificationExpiry = parseSubscriptionExpiresAtMs(verification.expiresAt);
  if (expiryTimestampsMatch(lock.expiresAt, verificationExpiry)) return true;
  const productId = String(verification.productId || "").trim();
  const store = verification.store;
  if (productId && lock.productId === productId && (!store || !lock.store || lock.store === store)) {
    return true;
  }
  return false;
}

async function enrichSubscriptionOwnershipLockDisplayMetadata(args: {
  lock: SubscriptionOwnershipLockRecord;
  verification?: ChurchPremiumVerification | null;
  persist?: boolean;
  source: string;
}): Promise<SubscriptionOwnershipLockRecord> {
  const lock = args.lock;
  const needsEnrichment = lockNeedsDisplayMetadataEnrichment(lock);
  const churchMeta = await resolveLockedChurchSnapshot(lock.lockedChurchId, {
    name: lock.lockedChurchName,
    avatarUrl: lock.lockedChurchAvatarUrl,
    deleted: lock.lockedChurchDeleted,
    deletedAt: lock.lockedChurchDeletedAt,
  });

  let expiresAt = lock.expiresAt ?? parseSubscriptionExpiresAtMs(args.verification?.expiresAt) ?? null;
  let willRenew = lock.willRenew ?? args.verification?.willRenew ?? null;
  let productId = lock.productId ?? args.verification?.productId ?? null;
  let store = lock.store ?? args.verification?.store ?? null;
  let storeSubscriptionIdentity =
    lock.storeSubscriptionIdentity ?? args.verification?.storeSubscriptionIdentity ?? null;
  let storeTransactionId = lock.storeTransactionId ?? args.verification?.storeTransactionId ?? null;

  if (needsEnrichment || expiresAt == null || !storeSubscriptionIdentity) {
    try {
      const verification = await verifyChurchPremiumEntitlement(lock.lockedChurchId, {
        forActivation: true,
      });
      if (verification.active && isVerifiedChurchPremiumReason(verification.reason)) {
        expiresAt = expiresAt ?? parseSubscriptionExpiresAtMs(verification.expiresAt) ?? null;
        willRenew = willRenew ?? verification.willRenew ?? null;
        productId = productId ?? verification.productId ?? null;
        store = store ?? verification.store ?? null;
        storeSubscriptionIdentity =
          storeSubscriptionIdentity ?? verification.storeSubscriptionIdentity ?? null;
        storeTransactionId = storeTransactionId ?? verification.storeTransactionId ?? null;
      }
    } catch {
      // keep snapshot fields when RC verify is unavailable
    }
  }

  const enriched: SubscriptionOwnershipLockRecord = {
    ...lock,
    lockedChurchName: churchMeta.name,
    lockedChurchAvatarUrl: churchMeta.avatarUrl ?? lock.lockedChurchAvatarUrl ?? null,
    lockedChurchDeleted: churchMeta.deleted || lock.lockedChurchDeleted === true,
    lockedChurchDeletedAt:
      lock.lockedChurchDeletedAt ?? (churchMeta.deleted ? churchMeta.deletedAt : null),
    expiresAt,
    willRenew,
    productId,
    store,
    storeSubscriptionIdentity,
    storeTransactionId,
  };

  const shouldPersist =
    args.persist !== false &&
    lock.status === "active" &&
    (needsEnrichment ||
      enriched.lockedChurchName !== lock.lockedChurchName ||
      enriched.lockedChurchAvatarUrl !== lock.lockedChurchAvatarUrl ||
      enriched.expiresAt !== lock.expiresAt);

  if (shouldPersist) {
    const saved = await saveSubscriptionOwnershipLock({
      ...enriched,
      updatedAt: Date.now(),
    });
    console.log("KRISTO_SUBSCRIPTION_LOCK_DISPLAY_METADATA_BACKFILLED", {
      source: args.source,
      ownerUserId: saved.ownerUserId,
      lockedChurchId: saved.lockedChurchId,
      lockedChurchName: saved.lockedChurchName,
      lockedChurchDeleted: saved.lockedChurchDeleted === true,
      persisted: true,
    });
    return saved;
  }

  if (needsEnrichment || subscriptionLockHasDisplayMetadata(enriched)) {
    console.log("KRISTO_SUBSCRIPTION_LOCK_DISPLAY_METADATA_BACKFILLED", {
      source: args.source,
      ownerUserId: enriched.ownerUserId,
      lockedChurchId: enriched.lockedChurchId,
      lockedChurchName: enriched.lockedChurchName,
      lockedChurchDeleted: enriched.lockedChurchDeleted === true,
      persisted: false,
    });
  }

  return enriched;
}

async function buildDisplayLockFromChurchCandidate(args: {
  ownerUserId: string;
  contextChurchId: string;
  lockedChurchId: string;
  verification?: ChurchPremiumVerification | null;
  media?: ChurchMediaProfile | null;
  preferDeleted?: boolean;
  source: string;
}): Promise<SubscriptionOwnershipLockRecord | null> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const contextChurchId = normalizeChurchId(args.contextChurchId);
  const lockedChurchId = normalizeChurchId(args.lockedChurchId);
  if (!ownerUserId || !contextChurchId || !lockedChurchId) return null;
  if (churchIdsMatch(lockedChurchId, contextChurchId)) return null;

  const media = args.media ?? (await getChurchMediaByChurchId(lockedChurchId));
  const churchMeta = await resolveLockedChurchSnapshot(lockedChurchId, {
    name: media?.mediaName,
    deleted: args.preferDeleted,
  });
  const now = Date.now();

  const record: SubscriptionOwnershipLockRecord = {
    id: `display-${ownerUserId.toLowerCase()}-${lockedChurchId.toLowerCase()}`,
    ownerUserId,
    lockedChurchId,
    lockedChurchName: churchMeta.name,
    lockedChurchAvatarUrl: churchMeta.avatarUrl,
    lockedChurchDeleted: churchMeta.deleted || args.preferDeleted === true,
    lockedChurchDeletedAt: churchMeta.deleted ? churchMeta.deletedAt : null,
    revenueCatAppUserId: lockedChurchId,
    revenueCatOriginalAppUserId: lockedChurchId,
    productId: args.verification?.productId ?? null,
    store: args.verification?.store ?? (media?.subscriptionSource === "app_store" ? "app_store" : null),
    storeSubscriptionIdentity: args.verification?.storeSubscriptionIdentity ?? null,
    storeTransactionId: args.verification?.storeTransactionId ?? null,
    willRenew: args.verification?.willRenew ?? null,
    platform: null,
    subscriptionPlan:
      media?.subscriptionPlan === "yearly"
        ? "yearly"
        : media?.subscriptionPlan === "monthly"
          ? "monthly"
          : null,
    expiresAt:
      parseSubscriptionExpiresAtMs(args.verification?.expiresAt) ??
      media?.subscriptionExpiresAt ??
      null,
    lockedAt: now,
    updatedAt: now,
    status: "active",
    releasedAt: null,
    releaseReason: null,
  };

  return enrichSubscriptionOwnershipLockDisplayMetadata({
    lock: record,
    verification: args.verification,
    persist: false,
    source: args.source,
  });
}

async function resolveDisplayLockFromPastorMediaProfiles(args: {
  ownerUserId: string;
  churchId: string;
  verification?: ChurchPremiumVerification | null;
}): Promise<SubscriptionOwnershipLockRecord | null> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const churchId = normalizeChurchId(args.churchId);
  if (!ownerUserId || !churchId) return null;

  const profiles = await listChurchMediaByOwnerUserId(ownerUserId);
  const candidates = profiles.filter((media) => {
    const candidateChurchId = normalizeChurchId(media.churchId);
    if (!candidateChurchId || churchIdsMatch(candidateChurchId, churchId)) return false;
    return (
      media.subscriptionSource === "app_store" ||
      isChurchSubscriptionActiveFromRecord(media) ||
      media.subscriptionExpiresAt != null
    );
  });

  const sorted = [...candidates].sort(
    (a, b) => (b.subscriptionExpiresAt ?? 0) - (a.subscriptionExpiresAt ?? 0)
  );

  for (const media of sorted) {
    const candidateChurchId = normalizeChurchId(media.churchId);
    if (!candidateChurchId) continue;

    const candidateLock: SubscriptionOwnershipLockRecord = {
      id: `media-${candidateChurchId.toLowerCase()}`,
      ownerUserId,
      lockedChurchId: candidateChurchId,
      lockedChurchName: String(media.mediaName || "").trim(),
      lockedChurchDeleted: false,
      revenueCatAppUserId: candidateChurchId,
      revenueCatOriginalAppUserId: candidateChurchId,
      productId: null,
      store: media.subscriptionSource === "app_store" ? "app_store" : null,
      platform: null,
      subscriptionPlan:
        media.subscriptionPlan === "yearly"
          ? "yearly"
          : media.subscriptionPlan === "monthly"
            ? "monthly"
            : null,
      expiresAt: media.subscriptionExpiresAt ?? null,
      lockedAt: 0,
      updatedAt: media.subscriptionExpiresAt ?? 0,
      status: "active",
      releasedAt: null,
      releaseReason: null,
    };

    if (args.verification && !lockMatchesVerificationSnapshot(candidateLock, args.verification)) {
      continue;
    }

    const built = await buildDisplayLockFromChurchCandidate({
      ownerUserId,
      contextChurchId: churchId,
      lockedChurchId: candidateChurchId,
      verification: args.verification,
      media,
      source: "pastor-media-profile",
    });
    if (built && subscriptionLockHasDisplayMetadata(built)) {
      return built;
    }
  }

  const fallbackMedia = sorted[0];
  if (!fallbackMedia) return null;

  return buildDisplayLockFromChurchCandidate({
    ownerUserId,
    contextChurchId: churchId,
    lockedChurchId: normalizeChurchId(fallbackMedia.churchId),
    verification: args.verification,
    media: fallbackMedia,
    source: "pastor-media-profile-fallback",
  });
}

async function resolveVerificationStoreIdentityForDisplay(
  churchId: string,
  verification?: ChurchPremiumVerification | null
): Promise<string | null> {
  const existing = String(verification?.storeSubscriptionIdentity || "").trim();
  if (existing) return existing;

  try {
    const refreshed = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });
    return String(refreshed.storeSubscriptionIdentity || "").trim() || null;
  } catch {
    return null;
  }
}

export async function resolveBlockingLockForPrepurchaseDisplay(args: {
  ownerUserId: string;
  churchId: string;
  verification?: ChurchPremiumVerification | null;
}): Promise<SubscriptionOwnershipLockRecord | null> {
  const ownerUserId = normalizeUserId(args.ownerUserId);
  const churchId = normalizeChurchId(args.churchId);
  if (!ownerUserId || !churchId) return null;

  const verification = args.verification ?? null;
  const store = verification?.store ?? null;
  const productId = String(verification?.productId || "").trim() || null;
  const storeIdentity = await resolveVerificationStoreIdentityForDisplay(churchId, verification);

  const allOwnerLocks = await listSubscriptionOwnershipLocksByOwnerUserId(ownerUserId);
  const activeOwnerLocks = allOwnerLocks.filter(
    (lock) => lock.status === "active" && !lockIsExpired(lock)
  );
  const otherChurchActiveLocks = activeOwnerLocks.filter(
    (lock) => !churchIdsMatch(lock.lockedChurchId, churchId)
  );

  const pickAndEnrich = async (
    lock: SubscriptionOwnershipLockRecord | null | undefined,
    source: string
  ) => {
    if (!lock) return null;
    return enrichSubscriptionOwnershipLockDisplayMetadata({
      lock,
      verification,
      persist: lock.status === "active",
      source,
    });
  };

  if (storeIdentity && (store === "app_store" || store === "play_store")) {
    const identityLocks = await listActiveSubscriptionOwnershipLocksByStoreIdentity({
      store,
      storeSubscriptionIdentity: storeIdentity,
    });
    const ownerIdentityLock = identityLocks.find(
      (lock) =>
        normalizeUserId(lock.ownerUserId).toLowerCase() === ownerUserId.toLowerCase() &&
        !churchIdsMatch(lock.lockedChurchId, churchId) &&
        !lockIsExpired(lock)
    );
    const identityLock =
      ownerIdentityLock ||
      identityLocks.find(
        (lock) => !churchIdsMatch(lock.lockedChurchId, churchId) && !lockIsExpired(lock)
      );
    const enriched = await pickAndEnrich(identityLock, "store-identity");
    if (enriched && subscriptionLockHasDisplayMetadata(enriched)) {
      return enriched;
    }
  }

  const otherActive = sortLocksByRecency(otherChurchActiveLocks)[0];
  if (otherActive) {
    const enriched = await pickAndEnrich(otherActive, "owner-active-other-church");
    if (enriched) return enriched;
  }

  const ownerTombstones = sortLocksByRecency(
    activeOwnerLocks.filter((lock) => lock.lockedChurchDeleted === true)
  );
  const blockingTombstone =
    ownerTombstones.find((lock) => !churchIdsMatch(lock.lockedChurchId, churchId)) ||
    ownerTombstones[0];
  if (blockingTombstone) {
    const enriched = await pickAndEnrich(blockingTombstone, "owner-tombstone");
    if (enriched) return enriched;
  }

  const globalTombstones = sortLocksByRecency(await listActiveDeletedChurchSubscriptionLocks());
  const globalOwnerTombstone = globalTombstones.find(
    (lock) =>
      normalizeUserId(lock.ownerUserId).toLowerCase() === ownerUserId.toLowerCase() &&
      !churchIdsMatch(lock.lockedChurchId, churchId) &&
      !lockIsExpired(lock)
  );
  if (globalOwnerTombstone) {
    const enriched = await pickAndEnrich(globalOwnerTombstone, "global-tombstone");
    if (enriched) return enriched;
  }

  if (productId && (store === "app_store" || store === "play_store")) {
    const productMatch = sortLocksByRecency(
      otherChurchActiveLocks.filter(
        (lock) =>
          (!lock.productId || lock.productId === productId) &&
          (!lock.store || lock.store === store)
      )
    )[0];
    if (productMatch) {
      const enriched = await pickAndEnrich(productMatch, "owner-product-store");
      if (enriched) return enriched;
    }
  }

  const verificationExpiry = parseSubscriptionExpiresAtMs(verification?.expiresAt);
  if (verificationExpiry != null) {
    const expiryMatch = sortLocksByRecency(
      otherChurchActiveLocks.filter((lock) =>
        expiryTimestampsMatch(lock.expiresAt, verificationExpiry)
      )
    )[0];
    if (expiryMatch) {
      const enriched = await pickAndEnrich(expiryMatch, "owner-expiry-match");
      if (enriched) return enriched;
    }
  }

  const releasedLocks = sortLocksByRecency(
    allOwnerLocks.filter(
      (lock) =>
        lock.status === "released" &&
        !churchIdsMatch(lock.lockedChurchId, churchId) &&
        (lock.lockedChurchDeleted === true ||
          lock.store === "app_store" ||
          lock.store === "play_store" ||
          Boolean(lock.productId) ||
          lock.expiresAt != null)
    )
  );
  if (releasedLocks[0]) {
    const enriched = await pickAndEnrich(releasedLocks[0], "owner-released-lock");
    if (enriched && subscriptionLockHasDisplayMetadata(enriched)) {
      return enriched;
    }
  }

  const historicalOwnerLocks = sortLocksByRecency(
    allOwnerLocks.filter(
      (lock) =>
        !churchIdsMatch(lock.lockedChurchId, churchId) &&
        (subscriptionLockHasDisplayMetadata(lock) ||
          lock.lockedChurchDeleted === true ||
          lockMatchesVerificationSnapshot(lock, verification))
    )
  );
  if (historicalOwnerLocks[0]) {
    const enriched = await pickAndEnrich(historicalOwnerLocks[0], "owner-historical-lock");
    if (enriched && subscriptionLockHasDisplayMetadata(enriched)) {
      return enriched;
    }
  }

  const rcOriginalChurchId = String(verification?.revenueCatOriginalAppUserId || "").trim();
  if (rcOriginalChurchId && /^CH7-/i.test(rcOriginalChurchId)) {
    const built = await buildDisplayLockFromChurchCandidate({
      ownerUserId,
      contextChurchId: churchId,
      lockedChurchId: rcOriginalChurchId,
      verification,
      source: "revenuecat-original-app-user-id",
    });
    if (built && subscriptionLockHasDisplayMetadata(built)) {
      return built;
    }
  }

  const mediaLock = await resolveDisplayLockFromPastorMediaProfiles({
    ownerUserId,
    churchId,
    verification,
  });
  if (mediaLock && subscriptionLockHasDisplayMetadata(mediaLock)) {
    return mediaLock;
  }

  return null;
}

export async function backfillSubscriptionOwnershipLockDisplayMetadataBatch(args?: {
  ownerUserId?: string;
  dryRun?: boolean;
}): Promise<{ enriched: number; skipped: number; missing: number }> {
  const ownerFilter = String(args?.ownerUserId || "").trim();
  const dryRun = args?.dryRun === true;
  const locks = ownerFilter
    ? await listSubscriptionOwnershipLocksByOwnerUserId(ownerFilter)
    : await listAllSubscriptionOwnershipLocks();

  let enriched = 0;
  let skipped = 0;
  let missing = 0;

  for (const lock of locks) {
    if (!lockNeedsDisplayMetadataEnrichment(lock) && subscriptionLockHasDisplayMetadata(lock)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      if (subscriptionLockHasDisplayMetadata(lock)) {
        skipped += 1;
      } else {
        missing += 1;
      }
      continue;
    }

    const next = await enrichSubscriptionOwnershipLockDisplayMetadata({
      lock,
      persist: lock.status === "active",
      source: "batch-backfill",
    });

    if (subscriptionLockHasDisplayMetadata(next)) {
      enriched += 1;
    } else {
      missing += 1;
      console.log("KRISTO_SUBSCRIPTION_LOCK_DISPLAY_METADATA_MISSING", {
        ownerUserId: lock.ownerUserId,
        lockedChurchId: lock.lockedChurchId,
        status: lock.status,
        source: "batch-backfill",
      });
    }
  }

  console.log("KRISTO_SUBSCRIPTION_LOCK_DISPLAY_METADATA_BACKFILLED", {
    source: "batch-backfill-summary",
    total: locks.length,
    enriched,
    skipped,
    missing,
    dryRun,
  });

  return { enriched, skipped, missing };
}

export async function buildPrepurchaseDeniedDisplayResponse(args: {
  churchId: string;
  ownerUserId: string;
  reason: string;
  lock: SubscriptionOwnershipLockRecord | null;
  verification: ChurchPremiumVerification | null;
}) {
  let displayLock = args.lock;
  if (!displayLock) {
    displayLock = await resolveBlockingLockForPrepurchaseDisplay({
      ownerUserId: args.ownerUserId,
      churchId: args.churchId,
      verification: args.verification,
    });
  }

  if (displayLock) {
    const enrichedDisplayLock = await enrichSubscriptionOwnershipLockDisplayMetadata({
      lock: displayLock,
      verification: args.verification,
      persist: displayLock.status === "active",
      source: "prepurchase-denied",
    });
    const churchMeta = await resolveLockedChurchSnapshot(enrichedDisplayLock.lockedChurchId, {
      name: enrichedDisplayLock.lockedChurchName,
      avatarUrl: enrichedDisplayLock.lockedChurchAvatarUrl,
      deleted: enrichedDisplayLock.lockedChurchDeleted,
      deletedAt: enrichedDisplayLock.lockedChurchDeletedAt,
    });
    const resolvedLock: SubscriptionOwnershipLockRecord = {
      ...enrichedDisplayLock,
      lockedChurchName: churchMeta.name,
      lockedChurchAvatarUrl:
        churchMeta.avatarUrl ?? enrichedDisplayLock.lockedChurchAvatarUrl ?? null,
      lockedChurchDeleted:
        churchMeta.deleted || enrichedDisplayLock.lockedChurchDeleted === true,
      lockedChurchDeletedAt:
        enrichedDisplayLock.lockedChurchDeletedAt ??
        (churchMeta.deleted ? churchMeta.deletedAt : null),
      willRenew: enrichedDisplayLock.willRenew ?? args.verification?.willRenew ?? null,
      store: enrichedDisplayLock.store ?? args.verification?.store ?? null,
      expiresAt:
        enrichedDisplayLock.expiresAt ??
        parseSubscriptionExpiresAtMs(args.verification?.expiresAt) ??
        null,
    };
    const subscriptionOwnershipLock = payloadFromLock({
      lock: resolvedLock,
      churchId: args.churchId,
    });

    if (!subscriptionOwnershipLock.hasLinkedChurchDisplay) {
      console.log("KRISTO_SUBSCRIPTION_LOCK_DISPLAY_METADATA_MISSING", {
        churchId: args.churchId,
        ownerUserId: args.ownerUserId,
        reason: args.reason,
        lockedChurchId: resolvedLock.lockedChurchId,
        productId: args.verification?.productId ?? resolvedLock.productId ?? null,
        store: subscriptionOwnershipLock.store,
        source: "prepurchase-denied-partial",
      });
    }

    return {
      ok: false as const,
      allowed: false as const,
      reason: args.reason,
      lockedChurchId: subscriptionOwnershipLock.lockedChurchId,
      lockedChurchName: subscriptionOwnershipLock.lockedChurchName,
      lockedChurchAvatarUrl: subscriptionOwnershipLock.lockedChurchAvatarUrl,
      lockedChurchDeleted: subscriptionOwnershipLock.lockedChurchDeleted,
      lockedChurchDeletedAt: subscriptionOwnershipLock.lockedChurchDeletedAt,
      subscriptionExpiresAt: subscriptionOwnershipLock.subscriptionExpiresAt,
      willRenew: subscriptionOwnershipLock.willRenew,
      store: subscriptionOwnershipLock.store,
      subscriptionOwnershipLock,
      productId: args.verification?.productId ?? resolvedLock.productId ?? null,
    };
  }

  const fallbackExpiresAt = parseSubscriptionExpiresAtMs(args.verification?.expiresAt) ?? null;
  const fallbackPayload: SubscriptionOwnershipLockApiPayload = {
    ...emptyLockPayload(),
    blocked: true,
    canPurchase: false,
    canActivate: false,
    expiresAt: fallbackExpiresAt,
    expiresAtLabel: formatExpiresAtLabel(fallbackExpiresAt),
    subscriptionExpiresAt: fallbackExpiresAt,
    subscriptionExpiresAtLabel: formatExpiresAtLabel(fallbackExpiresAt),
    willRenew: args.verification?.willRenew ?? null,
    store: args.verification?.store ?? null,
    hasLinkedChurchDisplay: false,
    status: "active",
  };

  console.log("KRISTO_SUBSCRIPTION_LOCK_DISPLAY_METADATA_MISSING", {
    churchId: args.churchId,
    ownerUserId: args.ownerUserId,
    reason: args.reason,
    productId: args.verification?.productId ?? null,
    store: args.verification?.store ?? null,
    subscriptionExpiresAt: fallbackExpiresAt,
    willRenew: args.verification?.willRenew ?? null,
    source: "prepurchase-denied",
  });

  return {
    ok: false as const,
    allowed: false as const,
    reason: args.reason,
    lockedChurchId: null,
    lockedChurchName: null,
    lockedChurchAvatarUrl: null,
    lockedChurchDeleted: false,
    lockedChurchDeletedAt: null,
    subscriptionExpiresAt: fallbackPayload.subscriptionExpiresAt,
    willRenew: fallbackPayload.willRenew,
    store: fallbackPayload.store,
    subscriptionOwnershipLock: fallbackPayload,
    productId: args.verification?.productId ?? null,
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

async function resolveLockedChurchSnapshot(
  churchId: string,
  fallback?: {
    name?: string | null;
    avatarUrl?: string | null;
    deleted?: boolean;
    deletedAt?: number | null;
  }
): Promise<{
  name: string;
  deleted: boolean;
  avatarUrl: string | null;
  deletedAt: number | null;
}> {
  const snapshotName = String(fallback?.name || "").trim();
  const snapshotAvatar = String(fallback?.avatarUrl || "").trim() || null;
  const snapshotDeletedAt =
    typeof fallback?.deletedAt === "number" && Number.isFinite(fallback.deletedAt)
      ? fallback.deletedAt
      : null;

  if (fallback?.deleted === true) {
    const name = snapshotName || normalizeChurchId(churchId) || "a previous church";
    return {
      name,
      deleted: true,
      avatarUrl: snapshotAvatar,
      deletedAt: snapshotDeletedAt,
    };
  }

  const cid = normalizeChurchId(churchId);
  if (!cid) {
    const name = snapshotName || "another church";
    return { name, deleted: true, avatarUrl: snapshotAvatar, deletedAt: snapshotDeletedAt };
  }

  try {
    const church = await getChurchById(cid);
    const liveName = String(church?.name || "").trim();
    const liveAvatar =
      String(church?.avatarUrl || church?.avatarUri || "").trim() || snapshotAvatar || null;
    if (liveName) {
      return {
        name: liveName,
        deleted: false,
        avatarUrl: liveAvatar,
        deletedAt: null,
      };
    }
  } catch {
    // ignore lookup failures
  }

  const name = snapshotName || cid;
  return {
    name,
    deleted: true,
    avatarUrl: snapshotAvatar,
    deletedAt: snapshotDeletedAt,
  };
}

async function resolveLockedChurchName(
  churchId: string,
  fallback?: string | null
): Promise<{ name: string; deleted: boolean }> {
  const snapshot = await resolveLockedChurchSnapshot(churchId, { name: fallback });
  return { name: snapshot.name, deleted: snapshot.deleted };
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

  const churchMeta = await resolveLockedChurchSnapshot(churchId, { name: media.mediaName });
  const now = Date.now();
  const record: SubscriptionOwnershipLockRecord = {
    id: `sub-lock-${ownerUserId.toLowerCase()}-${churchId.toLowerCase()}`,
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    lockedChurchAvatarUrl: churchMeta.avatarUrl,
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
  const churchMeta = await resolveLockedChurchSnapshot(churchId);
  const now = Date.now();

  const record: SubscriptionOwnershipLockRecord = {
    id: `sub-lock-${ownerUserId.toLowerCase()}-${churchId.toLowerCase()}`,
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    lockedChurchAvatarUrl: churchMeta.avatarUrl,
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
  const ownerLocks = await listSubscriptionOwnershipLocksByOwnerUserId(ownerUserId);

  let active = await ensureActiveSubscriptionOwnershipLockForPastor({
    ownerUserId,
    contextChurchId: churchId,
    contextMedia: media,
    backfillTrigger: "assert",
  });

  if (active && !churchIdsMatch(active.lockedChurchId, churchId)) {
    return { preserved: false, reason: "lock-held-by-other-church", lock: active };
  }

  if (!active || !churchIdsMatch(active.lockedChurchId, churchId)) {
    const priorLock = sortLocksByRecency(
      ownerLocks.filter((lock) => churchIdsMatch(lock.lockedChurchId, churchId))
    )[0];
    if (priorLock) {
      active = priorLock;
    }
  }

  if (!active && media && isChurchSubscriptionActiveFromRecord(media)) {
    active = await ensureSubscriptionOwnershipLockFromActiveMediaProfile({
      ownerUserId,
      media,
    });
  }

  let verification: ChurchPremiumVerification | null = null;
  try {
    verification = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });
  } catch {
    verification = null;
  }

  if (!active || !churchIdsMatch(active.lockedChurchId, churchId)) {
    const hasStoreSubscription =
      (verification?.active && isVerifiedChurchPremiumReason(verification.reason)) ||
      media?.subscriptionSource === "app_store" ||
      isChurchSubscriptionActiveFromRecord(media);

    if (hasStoreSubscription) {
      const churchMetaForCreate = await resolveLockedChurchSnapshot(churchId, {
        name: media?.mediaName,
      });
      const now = Date.now();
      active = {
        id: `sub-lock-${ownerUserId.toLowerCase()}-${churchId.toLowerCase()}`,
        ownerUserId,
        lockedChurchId: churchId,
        lockedChurchName: churchMetaForCreate.name,
        lockedChurchAvatarUrl: churchMetaForCreate.avatarUrl,
        lockedChurchDeleted: false,
        revenueCatAppUserId: churchId,
        revenueCatOriginalAppUserId: churchId,
        productId: verification?.productId ?? null,
        store:
          verification?.store ??
          (media?.subscriptionSource === "app_store" ? "app_store" : null),
        storeSubscriptionIdentity: verification?.storeSubscriptionIdentity ?? null,
        storeTransactionId: verification?.storeTransactionId ?? null,
        willRenew: verification?.willRenew ?? null,
        platform: null,
        subscriptionPlan:
          media?.subscriptionPlan === "yearly"
            ? "yearly"
            : media?.subscriptionPlan === "monthly"
              ? "monthly"
              : null,
        expiresAt:
          parseSubscriptionExpiresAtMs(verification?.expiresAt) ??
          media?.subscriptionExpiresAt ??
          null,
        lockedAt: now,
        updatedAt: now,
        status: "active",
        releasedAt: null,
        releaseReason: null,
      };
    }
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
    parseSubscriptionExpiresAtMs(verification?.expiresAt) ??
    media?.subscriptionExpiresAt ??
    null;
  const churchMeta = await resolveLockedChurchSnapshot(churchId, {
    name: active.lockedChurchName || media?.mediaName,
    avatarUrl: active.lockedChurchAvatarUrl,
  });
  const deletedAt = Date.now();

  let storeSubscriptionIdentity = active.storeSubscriptionIdentity ?? null;
  let storeTransactionId = active.storeTransactionId ?? null;
  let store = active.store ?? null;
  let willRenew = active.willRenew ?? null;
  let productId = active.productId ?? null;

  if (verification?.active && isVerifiedChurchPremiumReason(verification.reason)) {
    storeSubscriptionIdentity =
      verification.storeSubscriptionIdentity ?? storeSubscriptionIdentity;
    storeTransactionId = verification.storeTransactionId ?? storeTransactionId;
    store = verification.store ?? store;
    willRenew = verification.willRenew ?? willRenew;
    productId = verification.productId ?? productId;
  }

  const preserved = await saveSubscriptionOwnershipLock({
    ...active,
    lockedChurchName: churchMeta.name,
    lockedChurchAvatarUrl: churchMeta.avatarUrl ?? active.lockedChurchAvatarUrl ?? null,
    lockedChurchDeleted: true,
    lockedChurchDeletedAt: deletedAt,
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
    lockedChurchAvatarUrl: preserved.lockedChurchAvatarUrl ?? null,
    lockedChurchDeleted: preserved.lockedChurchDeleted === true,
    lockedChurchDeletedAt: preserved.lockedChurchDeletedAt ?? null,
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

  const churchMeta = await resolveLockedChurchSnapshot(active.lockedChurchId, {
    name: active.lockedChurchName,
    avatarUrl: active.lockedChurchAvatarUrl,
    deleted: active.lockedChurchDeleted,
    deletedAt: active.lockedChurchDeletedAt,
  });
  let resolvedActive = active;
  if (
    active.lockedChurchName !== churchMeta.name ||
    active.lockedChurchDeleted !== churchMeta.deleted ||
    active.lockedChurchAvatarUrl !== churchMeta.avatarUrl
  ) {
    resolvedActive = await saveSubscriptionOwnershipLock({
      ...active,
      lockedChurchName: churchMeta.name,
      lockedChurchAvatarUrl: churchMeta.avatarUrl ?? active.lockedChurchAvatarUrl ?? null,
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
