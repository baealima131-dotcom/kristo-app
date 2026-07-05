import { parseSubscriptionExpiresAtMs } from "@/app/api/_lib/churchMediaNotifications";
import { resolveActualChurchPastorUserId } from "@/app/api/_lib/churchMediaAccess";
import { getChurchById } from "@/app/api/_lib/churches";
import { getMembershipsForUser } from "@/app/api/_lib/memberships";
import {
  isVerifiedChurchPremiumReason,
  verifyChurchPremiumEntitlement,
  type ChurchPremiumVerification,
} from "@/app/api/_lib/revenuecat";
import {
  acquireActiveSubscriptionOwnershipLock,
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

  console.log("KRISTO_SUBSCRIPTION_LOCK_CREATED", {
    ownerUserId,
    lockedChurchId: churchId,
    lockedChurchName: churchMeta.name,
    productId: record.productId,
    expiresAt: record.expiresAt,
    source: "app-store-activation",
  });

  return acquireActiveSubscriptionOwnershipLock(record);
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
