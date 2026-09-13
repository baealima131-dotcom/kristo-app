import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  getChurchMediaByChurchId,
  isMediaDatabaseError,
  resolveMediaStoreMode,
  upsertChurchMedia,
  confirmChurchMediaPersisted,
} from "@/app/api/_lib/store/mediaDb";
import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";
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
      headers: req.headers,
    });
    const mediaForResponse = media;
    const hasProfile = Boolean(String(media?.mediaName || "").trim());

    // Church media is free. This flag is not a billing check.
    const churchMediaAvailable = true;

    const canOpenMediaScreen = access.canOpenMediaScreen;
    const canViewProfile = hasProfile && canOpenMediaScreen;

    if (hasProfile) {
      await confirmChurchMediaPersisted(churchId, mediaForResponse?.mediaName);
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
        churchMediaAvailable,
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
      hasProfile,
      profileMissing: !hasProfile,
      canOpenMediaScreen,
      canUseMediaTools: access.canUseMediaTools,
      monetizationPolicy: "free_all_platforms",
    });

    return NextResponse.json({
      ok: true,
      media: canViewProfile ? mediaForResponse : null,
      profileMissing: !hasProfile,
      churchMediaAvailable,
      monetizationPolicy: "free_all_platforms",
      viewerCanManage: access.canManageMediaHosts,
      viewerIsHost: access.isMediaHost,
      canOpenMediaScreen: access.canOpenMediaScreen,
      canUseMediaTools: access.canUseMediaTools,
      canAccessChurchMedia: access.canAccessChurchMedia,
      isActualChurchPastor: access.isActualChurchPastor,
      hasPastorRole: access.hasPastorRole,
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
      headers: req.headers,
  });
  if (!access.canManageMediaHosts) {
    return NextResponse.json(
      {
        ok: false,
        error: "Only the current church Pastor can manage Church Media",
        reason: access.hasPastorRole ? "not-canonical-pastor" : "not-pastor",
      },
      { status: 403 }
    );
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
      headers: req.headers,
  });
  if (!access.canManageChurchMedia) {
    return NextResponse.json(
      {
        ok: false,
        error: "Only the current church Pastor can manage Church Media",
        reason: access.hasPastorRole ? "not-canonical-pastor" : "not-pastor",
      },
      { status: 403 }
    );
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported action" },
    { status: 400 }
  );
}
