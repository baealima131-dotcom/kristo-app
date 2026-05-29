import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { getChurchById } from "@/app/api/_lib/churches";
import { listNotifications } from "@/app/api/_lib/notifications";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { readJsonFile } from "@/app/api/_lib/store/fs";
import {
  countChurchFollowers,
  countMutualFollowersFromChurch,
} from "@/app/api/_lib/churchFollows";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function forwardAuthHeaders(req: NextRequest): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/json",
    cookie: req.headers.get("cookie") || "",
  };

  // DEV header-auth passthrough (safe even if empty)
  const uid = req.headers.get("x-kristo-user-id");
  const role = req.headers.get("x-kristo-role");
  const cid = req.headers.get("x-kristo-church-id");

  if (uid) h["x-kristo-user-id"] = uid;
  if (role) h["x-kristo-role"] = role;
  if (cid) h["x-kristo-church-id"] = cid;

  return h;
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

    const publicPreview = url.searchParams.get("publicPreview") === "1";
    const mediaTeamNameParam = String(url.searchParams.get("mediaTeamName") || "").trim();
    const viewerChurchId = String(
      url.searchParams.get("viewerChurchId") ||
      req.headers.get("x-kristo-viewer-church-id") ||
      ""
    ).trim();

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

    const churchMinistries = Array.isArray(ministriesAll)
      ? ministriesAll.filter((m: any) => String(m?.churchId || "") === churchId)
      : [];

    const ministriesCount = churchMinistries.length;

    const ministryMembersCount = Array.isArray(ministryMembersAll)
      ? new Set(
          ministryMembersAll
            .filter((m: any) => String(m?.churchId || "") === churchId)
            .map((m: any) => String(m?.userId || "").toLowerCase())
            .filter(Boolean)
        ).size
      : 0;

    const mediaTeamMinistry = churchMinistries.find((m: any) => Boolean(m?.mediaAccess));
    const mediaTeamName =
      mediaTeamNameParam ||
      String(mediaTeamMinistry?.name || "").trim();

    const avatarUri = String(
      (churchProfile as any)?.avatarUri ||
      (churchProfile as any)?.avatarUrl ||
      (churchProfile as any)?.profileImage ||
      (churchProfile as any)?.profilePhoto ||
      (churchProfile as any)?.photo ||
      (churchProfile as any)?.image ||
      ""
    ).trim();

    const coverUri = String(
      (churchProfile as any)?.coverUri ||
      (churchProfile as any)?.coverImage ||
      (churchProfile as any)?.bannerUri ||
      avatarUri
    ).trim();

    const [followerCount, mutualFollowersFromViewerChurch] = await Promise.all([
      countChurchFollowers(churchId),
      viewerChurchId && viewerChurchId !== churchId
        ? countMutualFollowersFromChurch({ targetChurchId: churchId, viewerChurchId })
        : Promise.resolve(0),
    ]);

    const collaboratingMinistriesCount =
      viewerChurchId && viewerChurchId !== churchId
        ? (Array.isArray(ministriesAll)
            ? ministriesAll.filter(
                (m: any) =>
                  String(m?.churchId || "") === viewerChurchId &&
                  String(m?.partnerChurchId || "") === churchId
              ).length
            : 0)
        : 0;

    return json({
      ok: true,
      data: {
        churchId,
        viewer: {
          userId: String(req.headers.get("x-kristo-user-id") || "preview-user"),
          role: "Member",
          preview: true,
          publicPreview,
        },
        profile: {
          id: churchId,
          name: churchProfile?.name || churchId,
          address: publicPreview ? "" : (churchProfile?.address || ""),
          phone: publicPreview ? "" : (churchProfile?.phone || ""),
          pastorName: publicPreview ? "" : pastorName,
          avatarUri,
          coverUri,
        },
        stats: {
          activeMembers: activeMembers.length,
          ministries: ministriesCount,
          ministryMembers: ministryMembersCount,
          unreadNotifications: 0,
        },
        publicDiscovery: {
          followerCount,
          mutualFollowersFromViewerChurch,
          collaboratingMinistriesCount,
          mediaTeamName,
          coverUri,
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

  const headers = forwardAuthHeaders(req);
  const role = String(ctxOrRes.viewer.role || "");

  const canSeeLeadershipOverview =
    role === "Pastor" ||
    role === "Church_Admin" ||
    role === "Leader" ||
    role === "Ministry_Leader" ||
    role === "System_Admin";

  let ministriesCount = 0;
  if (canSeeLeadershipOverview) {
    try {
      const res = await fetch(new URL("/api/church/ministries", req.url), {
        headers,
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      const list = j && j.ok === true && Array.isArray(j.data) ? j.data : [];
      ministriesCount = list.length;
    } catch {
      ministriesCount = 0;
    }
  }

  // NOTE: ministry-members endpoint might require ministryId; keep safe.
  let ministryMembersCount = 0;
  if (canSeeLeadershipOverview) {
    try {
      const res = await fetch(new URL("/api/church/ministry-members?all=1", req.url), {
        headers,
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      const list = j && j.ok === true && Array.isArray(j.data) ? j.data : [];
      ministryMembersCount = new Set(
        list.map((x: any) => String(x?.userId || "").toLowerCase()).filter(Boolean)
      ).size;
    } catch {
      ministryMembersCount = 0;
    }
  }

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
      profile: {
        id: churchId,
        name: churchProfile?.name || churchId,
        address: churchProfile?.address || "",
        phone: churchProfile?.phone || "",
        pastorName,
        avatarUri: String(
          (churchProfile as any)?.avatarUri ||
          (churchProfile as any)?.avatarUrl ||
          (churchProfile as any)?.profileImage ||
          (churchProfile as any)?.profilePhoto ||
          (churchProfile as any)?.photo ||
          (churchProfile as any)?.image ||
          ""
        ).trim(),
      },
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
