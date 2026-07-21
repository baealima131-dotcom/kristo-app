import {
  ChurchMediaAutoCreateForbiddenError,
  ensureChurchMediaProfileForPastor,
  evaluateChurchMediaAccess,
} from "@/app/api/_lib/churchMediaAccess";
import {
  notifyChurchSubscriptionActivated,
  parseSubscriptionExpiresAtMs,
  reconcileChurchSubscriptionExpiryNotifications,
} from "@/app/api/_lib/churchMediaNotifications";
import {
  assertStoreSubscriptionOwnershipForActivation,
  ensureSubscriptionOwnershipLockFromActiveMediaProfile,
  upsertSubscriptionOwnershipLockAfterAppStoreActivation,
} from "@/app/api/_lib/subscriptionOwnershipLock";
import { confirmIosPremiumReservationAfterPurchase } from "@/app/api/_lib/iosPremiumProductAssignment";
import { verifyChurchPremiumEntitlement, isVerifiedChurchPremiumReason } from "@/app/api/_lib/revenuecat";
import {
  buildSyncDiagnostics,
  type ChurchSubscriptionSyncDiagnostics,
} from "@/app/api/_lib/churchSubscriptionDecisionDiagnostics";
import {
  getChurchMediaByChurchId,
  patchChurchMediaSubscription,
  type ChurchMediaProfile,
} from "@/app/api/_lib/store/mediaDb";
import { type SubscriptionOwnershipLockRecord } from "@/app/api/_lib/store/subscriptionOwnershipLockDb";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";

export type ChurchSubscriptionSyncResult = {
  synced: boolean;
  reason: string;
  media: ChurchMediaProfile | null;
  profileCreated: boolean;
  subscriptionActivated: boolean;
  revenueCatLane?: "production" | "sandbox" | null;
  sandboxPurchase?: boolean;
  ownershipLock?: SubscriptionOwnershipLockRecord | null;
  /** TEMPORARY diagnostic: PII-safe snapshot of the RevenueCat + ownership decision. */
  diagnostics?: ChurchSubscriptionSyncDiagnostics;
};

function resolveRequestedPlan(value?: string | null): "monthly" | "yearly" | null {
  const plan = String(value || "").trim().toLowerCase();
  if (plan === "yearly" || plan === "monthly") return plan;
  return null;
}

function resolveSubscriptionPlan(
  ...candidates: (string | null | undefined)[]
): "monthly" | "yearly" {
  for (const candidate of candidates) {
    const resolved = resolveRequestedPlan(candidate);
    if (resolved) return resolved;
  }
  return "monthly";
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

export type ChurchMediaSubscriptionSourceClassification =
  | "app_store"
  | "offline_activation"
  | "backend_activation";

/**
 * Backfill subscriptionSource on legacy profiles that were activated before the field
 * existed, or via paths that set subscriptionActive without a source tag.
 */
export async function reconcileChurchMediaSubscriptionSource(args: {
  churchId: string;
  media: ChurchMediaProfile | null;
}): Promise<{
  media: ChurchMediaProfile | null;
  classified: boolean;
  classification: ChurchMediaSubscriptionSourceClassification | null;
  reason: string;
}> {
  const churchId = String(args.churchId || "").trim();
  const media = args.media;
  const empty = {
    media,
    classified: false,
    classification: null as ChurchMediaSubscriptionSourceClassification | null,
    reason: "not-needed",
  };

  if (!churchId || !media?.subscriptionActive || media.subscriptionSource) {
    return empty;
  }

  if (hasOfflineActivationMarkers(media) || isOfflineActivationSubscription(media)) {
    const next = await patchChurchMediaSubscription(churchId, {
      subscriptionActive: true,
      subscriptionSource: "offline_activation",
      subscriptionPlan: media.subscriptionPlan ?? null,
      subscriptionExpiresAt: media.subscriptionExpiresAt ?? null,
    });
    console.log("KRISTO_CHURCH_MEDIA_SUBSCRIPTION_SOURCE_CLASSIFIED", {
      churchId,
      classification: "offline_activation",
      reason: "offline-activation-markers",
      profileSubscriptionPlan: next?.subscriptionPlan ?? null,
    });
    return {
      media: next,
      classified: true,
      classification: "offline_activation",
      reason: "offline-activation-markers",
    };
  }

  const verification = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });
  if (
    verification.active &&
    !verification.bypassed &&
    isVerifiedChurchPremiumReason(verification.reason)
  ) {
    const resolvedPlan = resolveSubscriptionPlan(
      verification.plan,
      media.subscriptionPlan
    );
    const expiresAtMs = parseSubscriptionExpiresAtMs(verification.expiresAt);
    const next = await patchChurchMediaSubscription(churchId, {
      subscriptionActive: true,
      subscriptionSource: "app_store",
      subscriptionPlan: resolvedPlan,
      subscriptionExpiresAt: expiresAtMs,
    });
    console.log("KRISTO_CHURCH_MEDIA_SUBSCRIPTION_SOURCE_CLASSIFIED", {
      churchId,
      classification: "app_store",
      reason: "revenuecat-verified-backfill",
      profileSubscriptionPlan: next?.subscriptionPlan ?? null,
      revenueCatLane: verification.revenueCatLane ?? null,
      productId: verification.productId,
    });
    if (next?.ownerUserId) {
      await ensureSubscriptionOwnershipLockFromActiveMediaProfile({
        ownerUserId: next.ownerUserId,
        media: next,
      });
    }
    return {
      media: next,
      classified: true,
      classification: "app_store",
      reason: "revenuecat-verified-backfill",
    };
  }

  const next = await patchChurchMediaSubscription(churchId, {
    subscriptionActive: true,
    subscriptionSource: "backend_activation",
    subscriptionPlan: media.subscriptionPlan ?? null,
    subscriptionExpiresAt: media.subscriptionExpiresAt ?? null,
  });
  console.log("KRISTO_CHURCH_MEDIA_SUBSCRIPTION_SOURCE_CLASSIFIED", {
    churchId,
    classification: "backend_activation",
    reason: "legacy-active-without-verified-app-store",
    profileSubscriptionPlan: next?.subscriptionPlan ?? null,
    revenueCatActive: verification.active,
    revenueCatReason: verification.reason,
  });
  return {
    media: next,
    classified: true,
    classification: "backend_activation",
    reason: "legacy-active-without-verified-app-store",
  };
}

export function shouldPreserveActiveSubscriptionWithoutRevenueCat(
  media: ChurchMediaProfile | null | undefined
): boolean {
  return (
    isOfflineActivationSubscription(media) ||
    isBackendActivationSubscription(media) ||
    hasOfflineActivationMarkers(media)
  );
}

/**
 * Server-side reconcile: RevenueCat church_premium entitlement → media profile row
 * with subscriptionActive=true. Safe to call when profile is missing or inactive.
 */
export async function syncChurchSubscriptionFromRevenueCat(args: {
  churchId: string;
  requesterUserId: string;
  requestedPlan?: string | null;
}): Promise<ChurchSubscriptionSyncResult> {
  const churchId = String(args.churchId || "").trim();
  const requesterUserId = String(args.requesterUserId || "").trim();
  const empty: ChurchSubscriptionSyncResult = {
    synced: false,
    reason: "missing-ids",
    media: null,
    profileCreated: false,
    subscriptionActivated: false,
    revenueCatLane: null,
    sandboxPurchase: false,
    diagnostics: buildSyncDiagnostics({
      churchId,
      verification: null,
      ownershipLockAllowed: null,
      ownershipLockReason: null,
    }),
  };

  if (!churchId || !requesterUserId) return empty;

  const access = await evaluateChurchMediaAccess({ churchId, userId: requesterUserId });
  if (!access.canManageChurchSubscription) {
    return {
      ...empty,
      reason: access.hasPastorRole ? "not-canonical-pastor" : "not-pastor",
    };
  }

  console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_START", {
    churchId,
    requesterUserId,
    actualPastorUserId: access.actualPastorUserId,
    hasProfile: Boolean(String((await getChurchMediaByChurchId(churchId))?.mediaName || "").trim()),
    subscriptionActive: access.subscriptionActive,
  });

  const mediaBefore = await getChurchMediaByChurchId(churchId);
  console.log("KRISTO_CHURCH_MEDIA_PROFILE_BEFORE_SYNC", {
    churchId,
    profileSubscriptionActive: mediaBefore?.subscriptionActive ?? null,
    profileSubscriptionPlan: mediaBefore?.subscriptionPlan ?? null,
    profileSubscriptionUpdatedAt: mediaBefore?.subscriptionUpdatedAt ?? null,
    revenueCatActive: null,
    reason: "before-revenuecat-verify",
  });

  const verification = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });

  console.log("KRISTO_CHURCH_MEDIA_REVENUECAT_VERIFY", {
    churchId,
    revenueCatActive: verification.active,
    revenueCatReason: verification.reason,
    revenueCatBypassed: verification.bypassed,
    revenueCatPlan: verification.plan,
    productId: verification.productId,
    revenueCatLane: verification.revenueCatLane ?? null,
    sandboxPurchase: verification.sandboxPurchase === true,
  });

  if (!verification.active || verification.bypassed || !isVerifiedChurchPremiumReason(verification.reason)) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_SKIPPED", {
      churchId,
      requesterUserId,
      reason: verification.reason,
      revenueCatActive: verification.active,
      bypassed: verification.bypassed,
    });
    return {
      ...empty,
      reason: verification.reason,
      media: mediaBefore,
      revenueCatLane: verification.revenueCatLane ?? null,
      sandboxPurchase: verification.sandboxPurchase === true,
      diagnostics: buildSyncDiagnostics({
        churchId,
        verification,
        ownershipLockAllowed: null,
        ownershipLockReason: null,
      }),
    };
  }

  const ownerUserId = String(access.actualPastorUserId || requesterUserId || "").trim();
  if (mediaBefore?.subscriptionActive && mediaBefore.subscriptionSource === "app_store") {
    await ensureSubscriptionOwnershipLockFromActiveMediaProfile({
      ownerUserId,
      media: mediaBefore,
    });
  }

  const lockCheck = await assertStoreSubscriptionOwnershipForActivation({
    churchId,
    ownerUserId,
    verification,
  });
  if (!lockCheck.allowed) {
    return {
      ...empty,
      reason: lockCheck.reason || "subscription-ownership-lock",
      media: mediaBefore,
      revenueCatLane: verification.revenueCatLane ?? null,
      sandboxPurchase: verification.sandboxPurchase === true,
      ownershipLock: lockCheck.lock,
      diagnostics: buildSyncDiagnostics({
        churchId,
        verification,
        ownershipLockAllowed: false,
        ownershipLockReason: lockCheck.reason || "subscription-ownership-lock",
      }),
    };
  }

  // Ownership check passed: reuse this outcome for all remaining diagnostics.
  const ownershipLockAllowed = lockCheck.allowed;
  const ownershipLockReason = lockCheck.reason ?? "ok";

  let media = await getChurchMediaByChurchId(churchId);
  const hadProfile = Boolean(String(media?.mediaName || "").trim());
  let profileCreated = false;

  if (!hadProfile) {
    const pastorUserId = access.actualPastorUserId || requesterUserId;
    console.log("KRISTO_CHURCH_MEDIA_PROFILE_BEFORE_CREATE", {
      churchId,
      profileSubscriptionActive: media?.subscriptionActive ?? null,
      profileSubscriptionPlan: media?.subscriptionPlan ?? null,
      revenueCatActive: verification.active,
      reason: "verified-entitlement-create-profile",
    });
    try {
      media = await ensureChurchMediaProfileForPastor({
        churchId,
        actualPastorUserId: pastorUserId,
        requesterUserId,
      });
      profileCreated = true;
      console.log("KRISTO_CHURCH_MEDIA_PROFILE_AFTER_CREATE", {
        churchId,
        profileSubscriptionActive: media?.subscriptionActive ?? false,
        profileSubscriptionPlan: media?.subscriptionPlan ?? null,
        profileSubscriptionUpdatedAt: media?.subscriptionUpdatedAt ?? null,
        revenueCatActive: verification.active,
        reason: "profile-created-awaiting-activation",
      });
    } catch (error: any) {
      const reason =
        error instanceof ChurchMediaAutoCreateForbiddenError
          ? "profile-create-forbidden"
          : String(error?.message || error || "profile-create-failed");
      console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_PROFILE_FAILED", {
        churchId,
        requesterUserId,
        reason,
      });
      return {
        ...empty,
        reason,
        diagnostics: buildSyncDiagnostics({
          churchId,
          verification,
          ownershipLockAllowed,
          ownershipLockReason,
        }),
      };
    }
  }

  let subscriptionActivated = false;

  if (isOfflineActivationSubscription(media) && isChurchSubscriptionActiveFromRecord(media)) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_SKIPPED", {
      churchId,
      requesterUserId,
      reason: "offline_activation-preserved",
      profileSubscriptionPlan: media?.subscriptionPlan ?? null,
      profileSubscriptionExpiresAt: media?.subscriptionExpiresAt ?? null,
    });
  } else {
    const resolvedPlan = resolveSubscriptionPlan(
      verification.plan,
      resolveRequestedPlan(args.requestedPlan),
      media?.subscriptionPlan
    );
    const expiresAtMs = verification.bypassed
      ? null
      : parseSubscriptionExpiresAtMs(verification.expiresAt);
    const wasActive = isChurchSubscriptionActiveFromRecord(media);

    const next = await patchChurchMediaSubscription(churchId, {
      subscriptionActive: true,
      subscriptionPlan: resolvedPlan,
      subscriptionExpiresAt: expiresAtMs,
      subscriptionSource: "app_store",
    });

    if (!next) {
      return {
        synced: false,
        reason: "subscription-patch-failed",
        media,
        profileCreated,
        subscriptionActivated: false,
        revenueCatLane: verification.revenueCatLane ?? null,
        sandboxPurchase: verification.sandboxPurchase === true,
        diagnostics: buildSyncDiagnostics({
          churchId,
          verification,
          ownershipLockAllowed,
          ownershipLockReason,
        }),
      };
    }

    media = next;

    if (!wasActive) {
      subscriptionActivated = true;

      console.log("KRISTO_CHURCH_MEDIA_PROFILE_AFTER_SYNC", {
        churchId,
        profileSubscriptionActive: media?.subscriptionActive ?? false,
        profileSubscriptionPlan: media?.subscriptionPlan ?? null,
        profileSubscriptionUpdatedAt: media?.subscriptionUpdatedAt ?? null,
        revenueCatActive: verification.active,
        reason: "subscription-activated-from-verified-entitlement",
        plan: resolvedPlan,
        productId: verification.productId,
      });

      console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_ACTIVATED", {
        churchId,
        requesterUserId,
        plan: resolvedPlan,
        productId: verification.productId,
        profileCreated,
      });

      const notifyPastorId = access.actualPastorUserId || requesterUserId;
      if (notifyPastorId) {
        try {
          await notifyChurchSubscriptionActivated({
            churchId,
            pastorUserId: notifyPastorId,
            plan: resolvedPlan,
          });
        } catch (notifyError: any) {
          console.log("KRISTO_SUBSCRIPTION_NOTIFY_FAILED", {
            churchId,
            action: "sync-activated",
            message: String(notifyError?.message || notifyError),
          });
        }
      }
    } else {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_REFRESHED_EXPIRY", {
        churchId,
        plan: resolvedPlan,
        expiresAtMs,
        productId: verification.productId,
      });

      console.log("KRISTO_CHURCH_MEDIA_PROFILE_AFTER_SYNC", {
        churchId,
        profileSubscriptionActive: media?.subscriptionActive ?? false,
        profileSubscriptionPlan: media?.subscriptionPlan ?? null,
        profileSubscriptionUpdatedAt: media?.subscriptionUpdatedAt ?? null,
        profileSubscriptionExpiresAt: media?.subscriptionExpiresAt ?? null,
        revenueCatActive: verification.active,
        reason: "subscription-expiry-refreshed-from-verified-entitlement",
        plan: resolvedPlan,
        productId: verification.productId,
      });
    }

    const notifyPastorId = access.actualPastorUserId || requesterUserId;
    if (expiresAtMs && notifyPastorId && !verification.bypassed && media) {
      try {
        await reconcileChurchSubscriptionExpiryNotifications({
          churchId,
          pastorUserId: notifyPastorId,
          media,
        });
      } catch (notifyError: any) {
        console.log("KRISTO_SUBSCRIPTION_NOTIFY_FAILED", {
          churchId,
          action: "sync-reconcile",
          message: String(notifyError?.message || notifyError),
        });
      }
    }

    if (ownerUserId && isChurchSubscriptionActiveFromRecord(media)) {
      await upsertSubscriptionOwnershipLockAfterAppStoreActivation({
        ownerUserId,
        churchId,
        verification,
        subscriptionPlan: resolvedPlan,
        expiresAtMs,
      });
      try {
        await confirmIosPremiumReservationAfterPurchase({
          churchId,
          ownerUserId,
          verification,
        });
      } catch (confirmError: any) {
        console.log("KRISTO_IOS_PREMIUM_RESERVATION_CONFIRM_FAILED", {
          churchId,
          ownerUserId,
          message: String(confirmError?.message || confirmError),
        });
      }
    }
  }

  const synced =
    Boolean(String(media?.mediaName || "").trim()) &&
    isChurchSubscriptionActiveFromRecord(media);

  console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_DONE", {
    churchId,
    requesterUserId,
    synced,
    profileCreated,
    subscriptionActivated,
    subscriptionActive: isChurchSubscriptionActiveFromRecord(media),
  });

  return {
    synced,
    reason: synced ? "ok" : "partial",
    media: media || null,
    profileCreated,
    subscriptionActivated,
    revenueCatLane: verification.revenueCatLane ?? null,
    sandboxPurchase: verification.sandboxPurchase === true,
    diagnostics: buildSyncDiagnostics({
      churchId,
      verification,
      ownershipLockAllowed,
      ownershipLockReason,
    }),
  };
}
