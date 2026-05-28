import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  ChurchMediaAutoCreateForbiddenError,
  MAX_CHURCH_MEDIA_HOSTS,
  buildMediaHostRecord,
  ensureChurchMediaProfileForPastor,
  evaluateChurchMediaAccess,
  getStoredMediaHosts,
  parseMediaHostUserIds,
  type MediaHostRecord,
} from "@/app/api/_lib/churchMediaAccess";
import { guard } from "@/app/api/_lib/rbac";
import { getChurchMediaByChurchId, upsertChurchMedia } from "@/app/api/_lib/store/mediaDb";

export const runtime = "nodejs";

function json(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function cleanText(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}

async function saveHosts(args: {
  churchId: string;
  actualPastorUserId: string;
  requesterUserId: string;
  hosts: MediaHostRecord[];
  autoCreateProfile?: boolean;
}) {
  let media = await getChurchMediaByChurchId(args.churchId);

  if (!media?.mediaName) {
    if (!args.autoCreateProfile) {
      throw new Error("Create Church Media profile first");
    }

    media = await ensureChurchMediaProfileForPastor({
      churchId: args.churchId,
      actualPastorUserId: args.actualPastorUserId,
      requesterUserId: args.requesterUserId,
    });
  }

  const nextHosts = args.hosts.slice(0, MAX_CHURCH_MEDIA_HOSTS);
  const saved = await upsertChurchMedia({
    churchId: args.churchId,
    ownerUserId: media.ownerUserId || args.actualPastorUserId,
    patch: {
      ...media,
      mediaName: media.mediaName,
      hosts: nextHosts,
    },
  });

  const confirmedHosts = await getStoredMediaHosts(args.churchId);
  console.log("KRISTO_MEDIA_HOSTS_PERSISTED", {
    churchId: args.churchId,
    requestedCount: nextHosts.length,
    confirmedCount: confirmedHosts.length,
    mediaId: saved.id,
    mediaName: saved.mediaName,
  });

  if (confirmedHosts.length !== nextHosts.length) {
    throw new Error("Failed to persist trusted media hosts");
  }

  return { saved, confirmedHosts };
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const access = await evaluateChurchMediaAccess({
      churchId: ctxOrRes.churchId,
      userId: ctxOrRes.viewer.userId,
    });

    console.log("[MediaHosts] GET", {
      churchId: ctxOrRes.churchId,
      userId: ctxOrRes.viewer.userId,
      hostCount: access.hosts.length,
      canAccessChurchMedia: access.canAccessChurchMedia,
      isActualChurchPastor: access.isActualChurchPastor,
    });

    return json({
      ok: true,
      hosts: access.hosts,
      mediaHostUserIds: access.mediaHostUserIds,
      actualPastorUserId: access.actualPastorUserId,
      isActualChurchPastor: access.isActualChurchPastor,
      isMediaHost: access.isMediaHost,
      canAccessChurchMedia: access.canAccessChurchMedia,
      canManageMediaHosts: access.canManageMediaHosts,
      maxHosts: MAX_CHURCH_MEDIA_HOSTS,
    });
  } catch (error: any) {
    console.error("[MediaHosts] GET failed", error);
    return json(
      { ok: false, error: String(error?.message || error || "Failed to load media hosts") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const access = await evaluateChurchMediaAccess({
      churchId: ctxOrRes.churchId,
      userId: ctxOrRes.viewer.userId,
    });

    if (!access.canManageMediaHosts) {
      return json({ ok: false, error: "Only the church Pastor can manage media hosts" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    if (Array.isArray(body?.hosts)) {
      const requested = body.hosts.slice(0, MAX_CHURCH_MEDIA_HOSTS);
      const nextHosts: MediaHostRecord[] = [];
      const hadProfileBeforeSave = Boolean(await getChurchMediaByChurchId(ctxOrRes.churchId));

      for (const row of requested) {
        const userId = cleanText(row?.userId || row?.id, 120);
        if (!userId) continue;
        nextHosts.push(
          await buildMediaHostRecord(ctxOrRes.churchId, userId, {
            name: cleanText(row?.name, 240),
            role: cleanText(row?.role || row?.roleLabel, 120),
            avatarUri: cleanText(row?.avatarUri || row?.avatarUrl, 2000),
            avatarUrl: cleanText(row?.avatarUrl || row?.avatarUri, 2000),
            kristoId: cleanText(row?.kristoId || row?.userCode, 80),
          })
        );
      }

      const { saved: media, confirmedHosts } = await saveHosts({
        churchId: ctxOrRes.churchId,
        actualPastorUserId: access.actualPastorUserId,
        requesterUserId: ctxOrRes.viewer.userId,
        hosts: nextHosts,
        autoCreateProfile: true,
      });

      console.log("[MediaHosts] replace", {
        churchId: ctxOrRes.churchId,
        pastorUserId: ctxOrRes.viewer.userId,
        hostCount: confirmedHosts.length,
        mediaAutoCreated: Boolean(media?.mediaName),
      });

      return json({
        ok: true,
        hosts: confirmedHosts,
        mediaHostUserIds: parseMediaHostUserIds(confirmedHosts),
        media,
        mediaAutoCreated: !hadProfileBeforeSave,
      });
    }

    const userId = cleanText(body?.userId, 120);
    if (!userId) {
      return json({ ok: false, error: "userId is required" }, { status: 400 });
    }

    const current = await getStoredMediaHosts(ctxOrRes.churchId);
    if (current.some((host) => host.userId === userId)) {
      return json({ ok: false, error: "Member is already a media host" }, { status: 409 });
    }
    if (current.length >= MAX_CHURCH_MEDIA_HOSTS) {
      return json({ ok: false, error: `Maximum ${MAX_CHURCH_MEDIA_HOSTS} media hosts allowed` }, { status: 409 });
    }

    const nextHost = await buildMediaHostRecord(ctxOrRes.churchId, userId, {
      name: cleanText(body?.name, 240),
      role: cleanText(body?.role || body?.roleLabel, 120),
      avatarUri: cleanText(body?.avatarUri || body?.avatarUrl, 2000),
      avatarUrl: cleanText(body?.avatarUrl || body?.avatarUri, 2000),
      kristoId: cleanText(body?.kristoId || body?.userCode, 80),
    });

    const nextHosts = [...current, nextHost];
    const hadProfileBeforeSave = Boolean(await getChurchMediaByChurchId(ctxOrRes.churchId));
    const { saved: media, confirmedHosts } = await saveHosts({
      churchId: ctxOrRes.churchId,
      actualPastorUserId: access.actualPastorUserId,
      requesterUserId: ctxOrRes.viewer.userId,
      hosts: nextHosts,
      autoCreateProfile: true,
    });

    console.log("[MediaHosts] add", {
      churchId: ctxOrRes.churchId,
      pastorUserId: ctxOrRes.viewer.userId,
      hostUserId: userId,
      hostCount: confirmedHosts.length,
    });

    return json({
      ok: true,
      host: nextHost,
      hosts: confirmedHosts,
      mediaHostUserIds: parseMediaHostUserIds(confirmedHosts),
      media,
      mediaAutoCreated: !hadProfileBeforeSave,
    });
  } catch (error: any) {
    if (error instanceof ChurchMediaAutoCreateForbiddenError) {
      return json({ ok: false, error: error.message }, { status: 403 });
    }

    console.error("[MediaHosts] POST failed", error);
    const message = String(error?.message || error || "Failed to save media host");
    const status = message.includes("Create Church Media profile first") ? 400 : 500;
    return json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const access = await evaluateChurchMediaAccess({
      churchId: ctxOrRes.churchId,
      userId: ctxOrRes.viewer.userId,
    });

    if (!access.canManageMediaHosts) {
      return json({ ok: false, error: "Only the church Pastor can manage media hosts" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const userId = cleanText(body?.userId, 120);
    if (!userId) {
      return json({ ok: false, error: "userId is required" }, { status: 400 });
    }

    const existingMedia = await getChurchMediaByChurchId(ctxOrRes.churchId);
    if (!existingMedia?.mediaName) {
      return json({
        ok: true,
        removedUserId: userId,
        hosts: [],
        mediaHostUserIds: [],
        media: null,
      });
    }

    const current = await getStoredMediaHosts(ctxOrRes.churchId);
    const nextHosts = current.filter((host) => host.userId !== userId);
    if (nextHosts.length === current.length) {
      return json({ ok: false, error: "Media host not found" }, { status: 404 });
    }

    const { saved: media, confirmedHosts } = await saveHosts({
      churchId: ctxOrRes.churchId,
      actualPastorUserId: access.actualPastorUserId,
      requesterUserId: ctxOrRes.viewer.userId,
      hosts: nextHosts,
      autoCreateProfile: false,
    });

    console.log("[MediaHosts] remove", {
      churchId: ctxOrRes.churchId,
      pastorUserId: ctxOrRes.viewer.userId,
      hostUserId: userId,
      hostCount: confirmedHosts.length,
    });

    return json({
      ok: true,
      removedUserId: userId,
      hosts: confirmedHosts,
      mediaHostUserIds: parseMediaHostUserIds(confirmedHosts),
      media,
    });
  } catch (error: any) {
    console.error("[MediaHosts] DELETE failed", error);
    return json(
      { ok: false, error: String(error?.message || error || "Failed to remove media host") },
      { status: 500 }
    );
  }
}
