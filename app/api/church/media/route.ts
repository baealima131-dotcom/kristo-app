import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  getChurchMediaByChurchId,
  isMediaDatabaseError,
  patchChurchMediaSubscription,
  resolveMediaStoreMode,
  upsertChurchMedia,
  confirmChurchMediaPersisted,
} from "@/app/api/_lib/store/mediaDb";
import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { reconcileChurchSubscriptionExpiryNotifications } from "@/app/api/_lib/churchMediaNotifications";
import { resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";
import {
  reconcileChurchMediaSubscriptionSource,
  shouldPreserveActiveSubscriptionWithoutRevenueCat,
  syncChurchSubscriptionFromRevenueCat,
} from "@/app/api/_lib/churchSubscriptionSync";
import {
  payloadFromLockForChurch,
  resolveSubscriptionOwnershipLockForChurch,
} from "@/app/api/_lib/subscriptionOwnershipLock";
import { verifyChurchPremiumEntitlement } from "@/app/api/_lib/revenuecat";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";

export const runtime = "nodejs";

function auth(req: Request) {
  return {
    // Identity comes from the signed session token in production (dev still
    // trusts the raw header). Role/church-id stay header-derived; the actual
    // pastor authority is verified server-side via evaluateChurchMediaAccess.
    userId: resolveRequestUserId(req).userId,
    role: String(req.headers.get("x-kristo-role") || "").trim(),
    churchId: String(req.headers.get("x-kristo-church-id") || "").trim(),
  };
}

function logMediaCenterGate(payload: {
  userId: string;
  churchId: string;
  hasMedia: boolean;
  mediaId: string;
  isActualChurchPastor: boolean;
  viewerIsHost: boolean;
  canAccessChurchMedia: boolean;
  canOpenMediaScreen: boolean;
  canUseMediaTools: boolean;
  viewerCanManage: boolean;
  showNotSetup: boolean;
  mode: "pastor" | "host" | "blocked";
}) {
  console.log("KRISTO_MEDIA_CENTER_GATE", payload);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, [
    "Pastor",
    "Church_Admin",
    "Leader",
    "Ministry_Leader",
    "System_Admin",
    "Member",
  ]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId = ctxOrRes.churchId;
  const userId = ctxOrRes.viewer.userId;

  try {
    const media = await getChurchMediaByChurchId(churchId);
    let access = await evaluateChurchMediaAccess({
      churchId,
      userId,
    });
    let mediaForResponse = media;
    let hasProfile = Boolean(String(media?.mediaName || "").trim());
    let subscriptionActive = access.subscriptionActive;

    console.log("KRISTO_CHURCH_MEDIA_GET_BEFORE_SYNC", {
      churchId,
      userId,
      hasProfile,
      subscriptionActive,
      canManageMediaHosts: access.canManageMediaHosts,
      profileSubscriptionPlan: media?.subscriptionPlan ?? null,
      profileSubscriptionSource: media?.subscriptionSource ?? null,
      profileSubscriptionExpiresAt: media?.subscriptionExpiresAt ?? null,
      profileSubscriptionUpdatedAt: media?.subscriptionUpdatedAt ?? null,
    });

    if (hasProfile && subscriptionActive && !mediaForResponse?.subscriptionSource) {
      const classified = await reconcileChurchMediaSubscriptionSource({
        churchId,
        media: mediaForResponse,
      });
      if (classified.media) {
        mediaForResponse = classified.media;
        subscriptionActive = isChurchSubscriptionActiveFromRecord(classified.media);
        if (classified.classified) {
          access = await evaluateChurchMediaAccess({ churchId, userId });
        }
      }
      console.log("KRISTO_CHURCH_MEDIA_SUBSCRIPTION_SOURCE_RECONCILE", {
        churchId,
        userId,
        classified: classified.classified,
        classification: classified.classification,
        reason: classified.reason,
        profileSubscriptionSource: mediaForResponse?.subscriptionSource ?? null,
      });
    }

    // Reconcile only when a profile already exists but subscription is inactive.
    // Missing profiles are created via PATCH activate_church_subscription after an
    // explicit purchase or restore — never from passive GET + RevenueCat login.
    if (access.canManageMediaHosts && hasProfile && !subscriptionActive) {
      console.log("KRISTO_CHURCH_MEDIA_GET_SYNC_ATTEMPT", {
        churchId,
        userId,
        reason: "existing-profile-inactive-reconcile",
      });
      const sync = await syncChurchSubscriptionFromRevenueCat({
        churchId,
        requesterUserId: userId,
      });
      if (sync.media) {
        mediaForResponse = sync.media;
        hasProfile = Boolean(String(sync.media.mediaName || "").trim());
        subscriptionActive = isChurchSubscriptionActiveFromRecord(sync.media);
        if (sync.synced) {
          access = await evaluateChurchMediaAccess({ churchId, userId });
        }
      }
      console.log("KRISTO_CHURCH_MEDIA_GET_AFTER_SYNC", {
        churchId,
        userId,
        syncReason: sync.reason,
        syncSynced: sync.synced,
        subscriptionActivated: sync.subscriptionActivated,
        profileSubscriptionActive: sync.media?.subscriptionActive ?? null,
        profileSubscriptionPlan: sync.media?.subscriptionPlan ?? null,
        revenueCatActive: sync.synced,
        reason: sync.reason,
      });
    } else if (access.canManageMediaHosts && hasProfile && subscriptionActive) {
      const preserveWithoutRevenueCat =
        shouldPreserveActiveSubscriptionWithoutRevenueCat(mediaForResponse);

      if (!preserveWithoutRevenueCat) {
        const verification = await verifyChurchPremiumEntitlement(churchId, { forActivation: true });
        if (!verification.active) {
          console.log("KRISTO_CHURCH_MEDIA_DEACTIVATE_STALE_SUBSCRIPTION", {
            churchId,
            userId,
            profileSubscriptionActive: mediaForResponse?.subscriptionActive ?? null,
            profileSubscriptionPlan: mediaForResponse?.subscriptionPlan ?? null,
            revenueCatActive: verification.active,
            revenueCatReason: verification.reason,
            reason: "profile-active-without-verified-entitlement",
          });
          const deactivated = await patchChurchMediaSubscription(churchId, {
            subscriptionActive: false,
            subscriptionPlan: null,
          });
          if (deactivated) {
            mediaForResponse = deactivated;
            subscriptionActive = false;
            access = await evaluateChurchMediaAccess({ churchId, userId });
            console.log("KRISTO_CHURCH_MEDIA_PROFILE_AFTER_DEACTIVATE", {
              churchId,
              profileSubscriptionActive: deactivated.subscriptionActive ?? false,
              profileSubscriptionPlan: deactivated.subscriptionPlan ?? null,
              revenueCatActive: verification.active,
              reason: "stale-subscription-cleared",
            });
          }
        }
      }
    }

    const canOpenMediaScreen = access.canOpenMediaScreen;
    const canViewProfile = hasProfile && canOpenMediaScreen;

    if (hasProfile) {
      await confirmChurchMediaPersisted(churchId, mediaForResponse?.mediaName);
    }

    if (access.canManageMediaHosts && access.actualPastorUserId && hasProfile && mediaForResponse) {
      try {
        const reconcileResult = await reconcileChurchSubscriptionExpiryNotifications({
          churchId,
          pastorUserId: access.actualPastorUserId,
          media: mediaForResponse,
        });
        if (reconcileResult.expired) {
          mediaForResponse = await getChurchMediaByChurchId(churchId);
          hasProfile = Boolean(String(mediaForResponse?.mediaName || "").trim());
          subscriptionActive = isChurchSubscriptionActiveFromRecord(mediaForResponse);
          access = await evaluateChurchMediaAccess({ churchId, userId });
        }
      } catch (notifyError: any) {
        console.log("KRISTO_SUBSCRIPTION_RECONCILE_FAILED", {
          churchId,
          message: String(notifyError?.message || notifyError),
        });
      }
    }

    const mode: "pastor" | "host" | "blocked" = access.isActualChurchPastor
      ? "pastor"
      : access.isMediaHost
        ? "host"
        : "blocked";
    const showNotSetup = !hasProfile && access.isMediaHost;

    logMediaCenterGate({
      userId,
      churchId,
      hasMedia: hasProfile,
      mediaId: String(mediaForResponse?.id || "").trim(),
      isActualChurchPastor: access.isActualChurchPastor,
      viewerIsHost: access.isMediaHost,
      canAccessChurchMedia: access.canAccessChurchMedia,
      canOpenMediaScreen: access.canOpenMediaScreen,
      canUseMediaTools: access.canUseMediaTools,
      viewerCanManage: access.canManageMediaHosts,
      showNotSetup,
      mode,
    });

    if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
      console.log("[MediaProfile] backend result", {
        churchId,
        userId,
        found: hasProfile,
        subscriptionActive,
        canOpenMediaScreen,
        canUseMediaTools: access.canUseMediaTools,
        canAccessChurchMedia: access.canAccessChurchMedia,
        isActualChurchPastor: access.isActualChurchPastor,
        isMediaHost: access.isMediaHost,
        profileMissing: !hasProfile,
        storeMode: resolveMediaStoreMode(),
      });
    }

    console.log("KRISTO_CHURCH_MEDIA_GET_RESPONSE", {
      churchId,
      userId,
      subscriptionActive,
      subscriptionPlan: mediaForResponse?.subscriptionPlan ?? null,
      subscriptionSource: mediaForResponse?.subscriptionSource ?? null,
      subscriptionExpiresAt: mediaForResponse?.subscriptionExpiresAt ?? null,
      subscriptionUpdatedAt: mediaForResponse?.subscriptionUpdatedAt ?? null,
      hasProfile,
      profileMissing: !hasProfile,
    });

    const lockOwnerUserId = String(access.actualPastorUserId || userId || "").trim();
    const { payload: subscriptionOwnershipLock } = await resolveSubscriptionOwnershipLockForChurch({
      churchId,
      ownerUserId: lockOwnerUserId,
      media: mediaForResponse,
    });

    return NextResponse.json({
      ok: true,
      media: canViewProfile ? mediaForResponse : null,
      profileMissing: !hasProfile,
      subscriptionActive,
      subscriptionOwnershipLock,
      viewerCanManage: access.canManageMediaHosts,
      viewerIsHost: access.isMediaHost,
      canOpenMediaScreen: access.canOpenMediaScreen,
      canUseMediaTools: access.canUseMediaTools,
      canAccessChurchMedia: access.canAccessChurchMedia,
      isActualChurchPastor: access.isActualChurchPastor,
      actualPastorUserId: access.actualPastorUserId,
      mediaHostUserIds: access.mediaHostUserIds,
      storeMode: resolveMediaStoreMode(),
    });
  } catch (error: any) {
    if (isMediaDatabaseError(error)) {
      return NextResponse.json(
        { ok: false, error: "Media database not configured", reason: "missing_db" },
        { status: 503 }
      );
    }
    console.error("[church/media] GET failed", error);
    return NextResponse.json(
      { ok: false, error: String(error?.message || error || "Failed to load media profile") },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const access = await evaluateChurchMediaAccess({
    churchId: a.churchId,
    userId: a.userId,
  });
  if (!access.canManageMediaHosts) {
    return NextResponse.json({ ok: false, error: "Only the church Pastor can manage Church Media" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const existing = await getChurchMediaByChurchId(a.churchId);
    const mediaName = String(body.mediaName || "").trim();

    if (!mediaName) {
      return NextResponse.json({ ok: false, error: "Media name required" }, { status: 400 });
    }

    const requestedId = String(body.id || "").trim();

    // HARD RULE: one church can have only one Church Media.
    if (existing && requestedId && requestedId !== existing.id) {
      return NextResponse.json(
        { ok: false, error: "This church already has one Church Media" },
        { status: 409 }
      );
    }

    const next = await upsertChurchMedia({
      churchId: a.churchId,
      ownerUserId: existing?.ownerUserId || a.userId,
      patch: {
        ...body,
        mediaName,
      },
    });

    console.log("[MediaProfile] create/upsert result", {
      churchId: a.churchId,
      userId: a.userId,
      mediaId: next.id,
      mediaName: next.mediaName,
      created: !existing,
      storeMode: resolveMediaStoreMode(),
    });

    return NextResponse.json({ ok: true, media: next, storeMode: resolveMediaStoreMode() });
  } catch (error: any) {
    if (isMediaDatabaseError(error)) {
      return NextResponse.json(
        { ok: false, error: "Media database not configured", reason: "missing_db" },
        { status: 503 }
      );
    }
    console.error("[church/media] POST failed", error);
    return NextResponse.json(
      { ok: false, error: String(error?.message || error || "Failed to save media profile") },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const access = await evaluateChurchMediaAccess({
    churchId: a.churchId,
    userId: a.userId,
  });
  if (!access.canManageMediaHosts) {
    return NextResponse.json({ ok: false, error: "Only the church Pastor can manage Church Media" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const isSyncAction =
      action === "activate_church_subscription" ||
      action === "sync_church_subscription_from_revenuecat";

    if (!isSyncAction) {
      return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
    }

    const sync = await syncChurchSubscriptionFromRevenueCat({
      churchId: a.churchId,
      requesterUserId: a.userId,
      requestedPlan: body?.subscriptionPlan,
    });

    if (!sync.synced) {
      if (sync.reason === "not-pastor" || sync.reason === "profile-create-forbidden") {
        return NextResponse.json(
          {
            ok: false,
            error: "Only the church Pastor can activate a church subscription",
            reason: sync.reason,
          },
          { status: 403 }
        );
      }

      if (
        sync.reason === "no-entitlement" ||
        sync.reason === "expired" ||
        sync.reason.startsWith("revenuecat-http-") ||
        sync.reason === "no-secret" ||
        sync.reason === "timeout" ||
        sync.reason === "fetch-error" ||
        sync.reason === "missing-app-user-id"
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "Subscription could not be verified with the App Store.",
            reason: sync.reason,
            revenueCatLane: sync.revenueCatLane ?? null,
            sandboxPurchase: sync.sandboxPurchase === true,
          },
          { status: 402 }
        );
      }

      if (
        sync.reason === "subscription-ownership-lock" ||
        sync.reason === "store-subscription-ownership-conflict"
      ) {
        const subscriptionOwnershipLock = sync.ownershipLock
          ? payloadFromLockForChurch({ lock: sync.ownershipLock, churchId: a.churchId })
          : null;
        return NextResponse.json(
          {
            ok: false,
            error:
              sync.reason === "store-subscription-ownership-conflict"
                ? "An existing Media Premium subscription is still linked to a previous church and cannot be moved here."
                : "This Kristo ID already has an active subscription for another church. Manage or cancel that subscription first.",
            reason: sync.reason,
            subscriptionOwnershipLock,
          },
          { status: 409 }
        );
      }

      if (
        sync.reason === "profile-create-forbidden" ||
        sync.reason === "profile-create-failed" ||
        sync.reason === "subscription-patch-failed" ||
        sync.reason === "partial"
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "Church media profile required before activating subscription",
            reason: sync.reason,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          ok: false,
          error: "Subscription activation could not be completed.",
          reason: sync.reason,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      media: sync.media,
      storeMode: resolveMediaStoreMode(),
      profileCreated: sync.profileCreated,
      subscriptionActivated: sync.subscriptionActivated,
    });
  } catch (error: any) {
    if (isMediaDatabaseError(error)) {
      return NextResponse.json(
        { ok: false, error: "Media database not configured", reason: "missing_db" },
        { status: 503 }
      );
    }
    console.error("[church/media] PATCH failed", error);
    return NextResponse.json(
      { ok: false, error: String(error?.message || error || "Failed to update media profile") },
      { status: 500 }
    );
  }
}
