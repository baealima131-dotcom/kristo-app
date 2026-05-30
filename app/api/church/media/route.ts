import { NextResponse } from "next/server";

import {
  getChurchMediaByChurchId,
  isMediaDatabaseError,
  patchChurchMediaSubscription,
  resolveMediaStoreMode,
  upsertChurchMedia,
  confirmChurchMediaPersisted,
} from "@/app/api/_lib/store/mediaDb";
import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";

export const runtime = "nodejs";

function auth(req: Request) {
  return {
    userId: String(req.headers.get("x-kristo-user-id") || "").trim(),
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
    const canViewProfile = hasProfile && access.canAccessChurchMedia;
    const subscriptionActive = isChurchSubscriptionActiveFromRecord(media);

    if (hasProfile) {
      await confirmChurchMediaPersisted(a.churchId, media?.mediaName);
    }

    if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
      console.log("[MediaProfile] backend result", {
        churchId: a.churchId,
        userId: a.userId,
        found: hasProfile,
        subscriptionActive,
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
    if (!existing) {
      return NextResponse.json(
        {
          ok: false,
          error: "Church media profile required before activating subscription",
        },
        { status: 400 }
      );
    }

    const next = await patchChurchMediaSubscription(a.churchId, {
      subscriptionActive: true,
      subscriptionPlan: String(body?.subscriptionPlan || "monthly").trim(),
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
