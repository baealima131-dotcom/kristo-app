import { NextResponse } from "next/server";

import {
  getChurchMediaByChurchId,
  isMediaDatabaseError,
  patchChurchMediaSubscription,
  resolveMediaStoreMode,
  upsertChurchMedia,
  confirmChurchMediaPersisted,
} from "@/app/api/_lib/store/mediaDb";
import {
  ChurchMediaAutoCreateForbiddenError,
  ensureChurchMediaProfileForPastor,
  evaluateChurchMediaAccess,
} from "@/app/api/_lib/churchMediaAccess";
import { resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";
import { verifyChurchPremiumEntitlement } from "@/app/api/_lib/revenuecat";

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

export async function GET(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const media = await getChurchMediaByChurchId(a.churchId);
    const access = await evaluateChurchMediaAccess({
      churchId: a.churchId,
      userId: a.userId,
    });
    const hasProfile = Boolean(String(media?.mediaName || "").trim());
    const canOpenMediaScreen = access.canOpenMediaScreen;
    const canViewProfile = hasProfile && canOpenMediaScreen;
    const subscriptionActive = access.subscriptionActive;

    if (hasProfile) {
      await confirmChurchMediaPersisted(a.churchId, media?.mediaName);
    }

    if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
      console.log("[MediaProfile] backend result", {
        churchId: a.churchId,
        userId: a.userId,
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

    return NextResponse.json({
      ok: true,
      media: canViewProfile ? media : null,
      profileMissing: !hasProfile,
      subscriptionActive,
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

    if (action !== "activate_church_subscription") {
      return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
    }

    const existing = await getChurchMediaByChurchId(a.churchId);
    if (!existing?.mediaName) {
      try {
        await ensureChurchMediaProfileForPastor({
          churchId: a.churchId,
          actualPastorUserId: access.actualPastorUserId,
          requesterUserId: a.userId,
        });
      } catch (error: any) {
        if (error instanceof ChurchMediaAutoCreateForbiddenError) {
          return NextResponse.json(
            {
              ok: false,
              error: "Only the church Pastor can activate a church subscription",
            },
            { status: 403 }
          );
        }
        return NextResponse.json(
          {
            ok: false,
            error: "Church media profile required before activating subscription",
            reason: String(error?.message || error || "profile-create-failed"),
          },
          { status: 400 }
        );
      }
    }

    // Never trust the client's `subscriptionActive: true`. Verify the pastor's
    // RevenueCat `church_premium` entitlement server-side before activating.
    const verification = await verifyChurchPremiumEntitlement(a.userId);
    if (!verification.active) {
      console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_REJECTED", {
        churchId: a.churchId,
        userId: a.userId,
        reason: verification.reason,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Subscription could not be verified with the App Store.",
          reason: verification.reason,
        },
        { status: 402 }
      );
    }

    // Prefer the plan from the verified RevenueCat product; fall back to the
    // requested plan only when the product id was not resolvable.
    const requestedPlan = String(body?.subscriptionPlan || "").trim();
    const resolvedPlan = verification.plan || requestedPlan || "monthly";

    console.log("KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_VERIFIED", {
      churchId: a.churchId,
      userId: a.userId,
      plan: resolvedPlan,
      productId: verification.productId,
      bypassed: verification.bypassed,
      reason: verification.reason,
    });

    const next = await patchChurchMediaSubscription(a.churchId, {
      subscriptionActive: true,
      subscriptionPlan: resolvedPlan,
    });

    return NextResponse.json({ ok: true, media: next, storeMode: resolveMediaStoreMode() });
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
