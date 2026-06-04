import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  churchAvatarUpdatedAtMs,
  logChurchOverviewGetAvatar,
  resolveChurchAvatarFields,
} from "@/app/api/_lib/churchAvatar";
import { listNotifications } from "@/app/api/_lib/notifications";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { readJsonFile } from "@/app/api/_lib/store/fs";
import {
  getUserJoinedMinistries,
  logMinistryScope,
  resolveMinistryStatsScope,
} from "@/app/api/_lib/ministryMembership";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function buildOverviewProfile(churchId: string, churchProfile: Awaited<ReturnType<typeof getChurchById>>, pastorName: string) {
  const avatar = logChurchOverviewGetAvatar(churchId, churchProfile);
  const avatarUpdatedAt = churchAvatarUpdatedAtMs(churchProfile);
  return {
    id: churchId,
    name: churchProfile?.name || churchId,
    address: churchProfile?.address || "",
    phone: churchProfile?.phone || "",
    pastorName,
    avatarUri: avatar.finalAvatarUri,
    avatarUrl: avatar.avatarUrl || avatar.finalAvatarUri,
    churchAvatarUri: avatar.churchAvatarUri || avatar.finalAvatarUri,
    churchLogoUrl: avatar.churchLogoUrl || avatar.logoUrl || undefined,
    avatarUpdatedAt,
    updatedAt: String(churchProfile?.updatedAt || churchProfile?.createdAt || ""),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const invitePreview = url.searchParams.get("invitePreview") === "1";
  const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();

  if (invitePreview) {
    const churchId = headerChurchId;
    if (!churchId) {
      return json({ ok: false, error: "churchId missing" }, { status: 400 });
    }

    const activeMembers = await getMembershipsForChurch(churchId, "Active");
    const churchProfile = await getChurchById(churchId);

    const pastorMembership =
      activeMembers.find((m: any) => String(m?.churchRole || "") === "Pastor");

    const pastorProfile = pastorMembership?.userId
      ? await getProfile(String(pastorMembership.userId))
      : null;

    const pastorName = String(
      (pastorProfile as any)?.fullName ||
      (pastorProfile as any)?.displayName ||
      (pastorProfile as any)?.email ||
      pastorMembership?.name ||
      churchProfile?.pastorName ||
      ""
    ).trim();

    const ministriesAll = await readJsonFile<any[]>("ministries.json", []);
    const ministryMembersAll = await readJsonFile<any[]>("ministry-members.json", []);

    const ministriesCount = Array.isArray(ministriesAll)
      ? ministriesAll.filter((m: any) => String(m?.churchId || "") === churchId).length
      : 0;

    const ministryMembersCount = Array.isArray(ministryMembersAll)
      ? new Set(
          ministryMembersAll
            .filter((m: any) => String(m?.churchId || "") === churchId)
            .map((m: any) => String(m?.userId || "").toLowerCase())
            .filter(Boolean)
        ).size
      : 0;

    return json({
      ok: true,
      data: {
        churchId,
        viewer: {
          userId: String(req.headers.get("x-kristo-user-id") || "preview-user"),
          role: "Member",
          preview: true,
        },
        profile: buildOverviewProfile(churchId, churchProfile, pastorName),
        stats: {
          activeMembers: activeMembers.length,
          ministries: ministriesCount,
          ministryMembers: ministryMembersCount,
          unreadNotifications: 0,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  }

  const uid = String(req.headers.get("x-kristo-user-id") || "").trim();
  const roleHdr = String(req.headers.get("x-kristo-role") || "").trim();
  const cidHdr = String(req.headers.get("x-kristo-church-id") || "").trim();
  if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
    console.log("[church/overview] request headers", {
      "x-kristo-user-id": uid,
      "x-kristo-role": roleHdr,
      "x-kristo-church-id": cidHdr,
    });
  }

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "Ministry_Leader", "Member", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) {
    if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
      console.log("[church/overview] guard rejected", { status: ctxOrRes.status });
    }
    return ctxOrRes;
  }

  const churchId = ctxOrRes.churchId;

  const activeMembers = await getMembershipsForChurch(churchId, "Active");
  const churchProfile = await getChurchById(churchId);

  const pastorMembership =
    activeMembers.find((m: any) => String(m?.churchRole || "") === "Pastor");

  const pastorProfile = pastorMembership?.userId
    ? await getProfile(String(pastorMembership.userId))
    : null;

  const pastorName = String(
    (pastorProfile as any)?.fullName ||
    (pastorProfile as any)?.displayName ||
    (pastorProfile as any)?.email ||
    pastorMembership?.name ||
    churchProfile?.pastorName ||
    ""
  ).trim();

  const role = String(ctxOrRes.viewer.role || "");

  const ministryScope = await resolveMinistryStatsScope({
    churchId,
    userId: ctxOrRes.viewer.userId,
    serverRole: role,
  });

  logMinistryScope("KRISTO_OVERVIEW_MINISTRY_SCOPE", {
    userId: ministryScope.userId,
    resolvedUserId: ministryScope.resolvedUserId,
    matchUserIds: ministryScope.matchUserIds,
    churchId: ministryScope.churchId,
    serverRole: ministryScope.serverRole,
    scope: ministryScope.scope,
    joinedMinistryIds: ministryScope.joinedMinistryIds,
    count: ministryScope.ministriesCount,
    ministryMembersCount: ministryScope.ministryMembersCount,
  });

  const ministriesCount = ministryScope.ministriesCount;
  const ministryMembersCount = ministryScope.ministryMembersCount;

  const canSeeAllTargets =
    role === "Pastor" || role === "Church_Admin" || role === "System_Admin";

  const unreadNotifications = listNotifications({
    churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: true,
    limit: 9999,
    includeAllTargets: canSeeAllTargets,
  }).length;

  return json({
    ok: true,
    data: {
      churchId,
      viewer: ctxOrRes.viewer,
      profile: buildOverviewProfile(churchId, churchProfile, pastorName),
      stats: {
        activeMembers: activeMembers.length,
        ministries: ministriesCount,
        ministryMembers: ministryMembersCount,
        unreadNotifications,
      },
      generatedAt: new Date().toISOString(),
    },
  });
}
