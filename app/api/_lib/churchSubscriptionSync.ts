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
import { verifyChurchPremiumEntitlement } from "@/app/api/_lib/revenuecat";
import {
  getChurchMediaByChurchId,
  patchChurchMediaSubscription,
  type ChurchMediaProfile,
} from "@/app/api/_lib/store/mediaDb";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";

export type ChurchSubscriptionSyncResult = {
  synced: boolean;
  reason: string;
  media: ChurchMediaProfile | null;
  profileCreated: boolean;
  subscriptionActivated: boolean;
};

function resolveRequestedPlan(value?: string | null): "monthly" | "yearly" | null {
  const plan = String(value || "").trim().toLowerCase();
  if (plan === "yearly" || plan === "monthly") return plan;
  return null;
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
  };

  if (!churchId || !requesterUserId) return empty;

  const access = await evaluateChurchMediaAccess({ churchId, userId: requesterUserId });
  if (!access.canManageMediaHosts) {
    return {
      ...empty,
      reason: "not-pastor",
    };
  }

  console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_START", {
    churchId,
    requesterUserId,
    actualPastorUserId: access.actualPastorUserId,
    hasProfile: Boolean(String((await getChurchMediaByChurchId(churchId))?.mediaName || "").trim()),
    subscriptionActive: access.subscriptionActive,
  });

  const verification = await verifyChurchPremiumEntitlement(churchId);
  if (!verification.active) {
    console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_SKIPPED", {
      churchId,
      requesterUserId,
      reason: verification.reason,
    });
    return {
      ...empty,
      reason: verification.reason,
    };
  }

  let media = await getChurchMediaByChurchId(churchId);
  const hadProfile = Boolean(String(media?.mediaName || "").trim());
  let profileCreated = false;

  if (!hadProfile) {
    const pastorUserId = access.actualPastorUserId || requesterUserId;
    try {
      media = await ensureChurchMediaProfileForPastor({
        churchId,
        actualPastorUserId: pastorUserId,
        requesterUserId,
      });
      profileCreated = true;
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
      };
    }
  }

  let subscriptionActivated = false;
  if (!isChurchSubscriptionActiveFromRecord(media)) {
    const resolvedPlan =
      verification.plan || resolveRequestedPlan(args.requestedPlan) || "monthly";
    const expiresAtMs = verification.bypassed
      ? null
      : parseSubscriptionExpiresAtMs(verification.expiresAt);

    const wasActive = media?.subscriptionActive === true;
    const next = await patchChurchMediaSubscription(churchId, {
      subscriptionActive: true,
      subscriptionPlan: resolvedPlan,
      subscriptionExpiresAt: expiresAtMs,
    });

    if (!next) {
      return {
        synced: false,
        reason: "subscription-patch-failed",
        media,
        profileCreated,
        subscriptionActivated: false,
      };
    }

    media = next;
    subscriptionActivated = true;

    console.log("KRISTO_CHURCH_SUBSCRIPTION_SYNC_ACTIVATED", {
      churchId,
      requesterUserId,
      plan: resolvedPlan,
      productId: verification.productId,
      profileCreated,
    });

    const notifyPastorId = access.actualPastorUserId || requesterUserId;
    if (!wasActive && notifyPastorId) {
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
  };
}
