import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getChurchById, searchChurches, type ChurchProfile } from "@/app/api/_lib/churches";
import { resolveChurchAvatarFields } from "@/app/api/_lib/churchAvatar";
import { getMembershipsForChurch, getMembershipsForUser } from "@/app/api/_lib/memberships";
import { getChurchFollowerCount, getViewerFollowingChurch } from "@/app/api/_lib/churchFollows";
import { readMinistryJsonFile } from "@/app/api/_lib/store/ministryDb";
import { listFeedItems, listFeedItemsForChurch } from "@/app/api/_lib/store/feedDb";
import { isChurchDatabaseError } from "@/app/api/_lib/store/churchDb";
import { isUsableVideoPosterUri } from "@/app/api/_lib/media/videoPoster";
import { verifySessionToken } from "@/app/api/auth/_lib/sessionToken";

export const runtime = "nodejs";

type ViewerMembershipStatus = "member" | "pending" | "none";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function normalizeChurchId(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function feedItemVisibility(item: any) {
  return String(item?.visibility || item?.audience || "public").toLowerCase();
}

function isPublicFeedItem(item: any) {
  const visibility = feedItemVisibility(item);
  if (visibility.includes("private") || visibility.includes("members")) return false;
  if (visibility.includes("church") && !visibility.includes("public") && !visibility.includes("global")) {
    return false;
  }
  return (
    visibility.includes("public") ||
    visibility.includes("global") ||
    (!visibility.includes("church") && !visibility.includes("private"))
  );
}

function buildLocation(profile: Partial<ChurchProfile> & Record<string, unknown>) {
  const parts = [profile?.city, profile?.province, profile?.country].filter(Boolean);
  if (parts.length) return parts.join(" • ");
  return String(profile?.address || "").trim();
}

function buildDescription(profile: Partial<ChurchProfile> & Record<string, unknown>) {
  const description = String((profile as any)?.description || "").trim();
  if (description) return description;
  const address = String(profile?.address || "").trim();
  if (address && !address.includes("•")) return address;
  return buildLocation(profile);
}

function resolveOptionalViewerUserId(req: NextRequest): string {
  const token = String(req.headers.get("x-kristo-session-token") || "").trim();
  if (!token) return "";
  const verified = verifySessionToken(token);
  return verified.ok && verified.userId ? String(verified.userId).trim() : "";
}

async function resolveViewerMembershipStatus(
  req: NextRequest,
  churchId: string
): Promise<ViewerMembershipStatus> {
  const userId = resolveOptionalViewerUserId(req);
  if (!userId) return "none";

  const memberships = await getMembershipsForUser(userId);
  const target = normalizeChurchId(churchId);

  for (const row of memberships) {
    if (normalizeChurchId(row?.churchId) !== target) continue;
    const status = String(row?.status || "").trim();
    if (status === "Active") return "member";
    if (status === "Requested") return "pending";
  }

  return "none";
}

async function resolveChurchRecord(churchId: string): Promise<(ChurchProfile & Record<string, unknown>) | null> {
  const id = normalizeChurchId(churchId);
  if (!id) return null;

  const direct = await getChurchById(id);
  if (direct) return direct as ChurchProfile & Record<string, unknown>;

  const hits = await searchChurches({ q: id, limit: 8, includeDev: true });
  const exact = hits.find((hit) => normalizeChurchId(hit.id) === id);
  if (exact) return exact as ChurchProfile & Record<string, unknown>;

  let rows = await listFeedItemsForChurch(id);
  if (!rows.length) {
    const all = await listFeedItems();
    rows = all.filter((row) => normalizeChurchId(row?.churchId) === id);
  }
  if (!rows.length) return null;

  const sorted = rows
    .slice()
    .sort((a, b) => {
      const aMs = Date.parse(String(a?.createdAt || a?.updatedAt || "")) || 0;
      const bMs = Date.parse(String(b?.createdAt || b?.updatedAt || "")) || 0;
      return bMs - aMs;
    });

  const sample = sorted[0] as any;
  const avatarUri = String(
    sample?.churchAvatarUri ||
      sample?.churchAvatarUrl ||
      sample?.churchLogoUri ||
      sample?.churchLogoUrl ||
      sample?.avatarUri ||
      sample?.avatarUrl ||
      ""
  ).trim();

  return {
    id,
    name: String(sample?.churchName || sample?.churchLabel || id).trim() || id,
    address: String(sample?.churchAddress || sample?.address || "").trim() || undefined,
    country: String(sample?.churchCountry || sample?.country || "").trim() || undefined,
    province: String(sample?.churchProvince || sample?.province || "").trim() || undefined,
    city: String(sample?.churchCity || sample?.city || "").trim() || undefined,
    avatarUri: avatarUri || undefined,
    avatarUrl: avatarUri || undefined,
    createdAt: String(sample?.createdAt || new Date().toISOString()),
    updatedAt: String(sample?.updatedAt || sample?.createdAt || new Date().toISOString()),
  };
}

function inferPosterUriFromVideoUrl(videoUrl: string) {
  const raw = String(videoUrl || "").trim();
  if (!raw) return "";

  const uploadsMatch = raw.match(/\/uploads\/media\/(?:[^/]+\/)*([^/]+)\.(mp4|mov|m4v|webm|mkv)$/i);
  if (uploadsMatch?.[1]) {
    return `/uploads/media/posters/${uploadsMatch[1]}.jpg`;
  }

  const r2Marker = "/church-videos/";
  const r2Idx = raw.indexOf(r2Marker);
  if (r2Idx >= 0) {
    const tail = raw.slice(r2Idx + r2Marker.length);
    const match = tail.match(/^([^/]+)\/([^/]+)\.(mp4|mov|m4v|webm|mkv)$/i);
    if (match?.[1] && match?.[2]) {
      const base = raw.slice(0, r2Idx);
      return `${base}/church-video-posters/${match[1]}/${match[2]}.jpg`;
    }
  }

  return "";
}

function firstImageCandidate(item: any): string {
  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "video") return "";

  const candidates: unknown[] = [
    item?.imageUrl,
    item?.mediaUri,
    item?.imageUri,
    item?.photoUrl,
    ...(Array.isArray(item?.images) ? item.images : []),
    ...(Array.isArray(item?.attachments) ? item.attachments : []),
    ...(Array.isArray(item?.mediaUrls) ? item.mediaUrls : []),
  ];

  for (const raw of candidates) {
    const value =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object"
          ? String((raw as any)?.uri || (raw as any)?.url || (raw as any)?.imageUrl || "")
          : "";
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(trimmed)) continue;
    return trimmed;
  }

  return "";
}

function resolvePublicPostCover(item: any): string {
  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  const videoUrl = String(item?.videoUrl || item?.videoUri || item?.mediaUrl || "").trim();
  const isVideo =
    Boolean(videoUrl) ||
    mediaType === "video" ||
    String(item?.type || item?.kind || "").trim().toLowerCase() === "video";

  if (isVideo && videoUrl) {
    for (const raw of [
      item?.posterUri,
      item?.videoPosterUri,
      item?.thumbnailUri,
      item?.thumbnailUrl,
      item?.posterUrl,
      item?.coverUrl,
      item?.coverImageUrl,
    ]) {
      const candidate = String(raw || "").trim();
      if (candidate && isUsableVideoPosterUri(candidate, videoUrl)) {
        return candidate;
      }
    }

    const inferred = inferPosterUriFromVideoUrl(videoUrl);
    if (inferred && isUsableVideoPosterUri(inferred, videoUrl)) {
      return inferred;
    }
  }

  const image = firstImageCandidate(item);
  if (image) return image;

  for (const raw of [item?.coverUrl, item?.coverImageUrl, item?.coverImage, item?.thumbnailUrl]) {
    const candidate = String(raw || "").trim();
    if (candidate && !/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(candidate)) {
      return candidate;
    }
  }

  return "";
}

function mapPublicRecentPost(item: any, churchName: string) {
  const coverUri = resolvePublicPostCover(item);
  const videoUrl = String(item?.videoUrl || item?.videoUri || item?.mediaUrl || "").trim() || undefined;
  const imageUrl = firstImageCandidate(item) || undefined;

  return {
    id: String(item?.id || ""),
    title: String(item?.title || item?.postTitle || "").trim(),
    body: String(item?.body || item?.text || item?.caption || "").trim(),
    type: String(item?.type || item?.kind || "").trim(),
    createdAt: item?.createdAt || item?.updatedAt || null,
    mediaType: String(item?.mediaType || "").trim() || undefined,
    videoUrl,
    imageUrl,
    mediaUri: String(item?.mediaUri || "").trim() || undefined,
    imageUri: String(item?.imageUri || "").trim() || undefined,
    photoUrl: String(item?.photoUrl || "").trim() || undefined,
    posterUri: String(item?.posterUri || "").trim() || undefined,
    videoPosterUri: String(item?.videoPosterUri || "").trim() || undefined,
    thumbnailUri: String(item?.thumbnailUri || "").trim() || undefined,
    thumbnailUrl: String(item?.thumbnailUrl || "").trim() || undefined,
    posterUrl: String(item?.posterUrl || "").trim() || undefined,
    coverUrl: String(item?.coverUrl || "").trim() || undefined,
    coverImageUrl: String(item?.coverImageUrl || "").trim() || undefined,
    coverUri: coverUri || undefined,
    images: Array.isArray(item?.images)
      ? item.images.map((row: unknown) => String(row || "").trim()).filter(Boolean)
      : undefined,
    attachments: Array.isArray(item?.attachments) ? item.attachments : undefined,
    mediaUrls: Array.isArray(item?.mediaUrls)
      ? item.mediaUrls.map((row: unknown) => String(row || "").trim()).filter(Boolean)
      : undefined,
    churchName: String(item?.churchName || item?.churchLabel || churchName).trim(),
    likeCount: Number(item?.likeCount || 0) || undefined,
    commentCount: Number(item?.commentCount || item?.totalDiscussionCount || 0) || undefined,
    shareCount: Number(item?.shareCount || 0) || undefined,
  };
}

async function loadRecentPosts(churchId: string, churchName: string) {
  let feedRows = await listFeedItemsForChurch(churchId);
  if (!feedRows.length) {
    const all = await listFeedItems();
    feedRows = all.filter((row) => normalizeChurchId(row?.churchId) === churchId);
  }

  return feedRows
    .filter((item: any) => isPublicFeedItem(item))
    .filter((item: any) => !String(item?.deletedAt || item?.isDeleted || "").trim())
    .slice()
    .sort((a: any, b: any) => {
      const aMs = Date.parse(String(a?.createdAt || a?.updatedAt || "")) || 0;
      const bMs = Date.parse(String(b?.createdAt || b?.updatedAt || "")) || 0;
      return bMs - aMs;
    })
    .slice(0, 8)
    .map((item: any) => mapPublicRecentPost(item, churchName))
    .filter((item) => item.id);
}

export async function GET(req: NextRequest) {
  try {
    const id = normalizeChurchId(new URL(req.url).searchParams.get("id"));
    if (!id) return json({ ok: false, error: "id missing" }, { status: 400 });

    const profile = await resolveChurchRecord(id);
    if (!profile) return json({ ok: false, error: "Church not found" }, { status: 404 });

    const avatar = resolveChurchAvatarFields(profile);
    const avatarUrl = avatar.avatarUrl || avatar.finalAvatarUri || avatar.avatarUri || avatar.churchAvatarUri || "";
    const logoUrl = avatar.logoUrl || avatar.churchLogoUrl || avatarUrl;

    let memberCount = 0;
    let ministryCount = 0;
    let followerCount = 0;
    try {
      const activeMembers = await getMembershipsForChurch(id, "Active");
      memberCount = activeMembers.length;
    } catch {}

    try {
      followerCount = await getChurchFollowerCount(id);
    } catch {}

    try {
      const ministries = await readMinistryJsonFile<Array<{ id: string; churchId: string }>>(
        "ministries.json",
        []
      );
      ministryCount = ministries.filter((m) => normalizeChurchId(m.churchId) === id).length;
    } catch {}

    const recentPosts = await loadRecentPosts(id, String(profile.name || id)).catch(() => []);
    const viewerMembershipStatus = await resolveViewerMembershipStatus(req, id);
    const viewerUserId = resolveOptionalViewerUserId(req);
    const viewerFollowing = viewerUserId
      ? await getViewerFollowingChurch(viewerUserId, id).catch(() => false)
      : false;

    return json({
      ok: true,
      data: {
        id: profile.id,
        name: profile.name || profile.id,
        description: buildDescription(profile),
        location: buildLocation(profile),
        address: String(profile.address || "").trim(),
        country: String((profile as any).country || "").trim(),
        province: String((profile as any).province || "").trim(),
        city: String((profile as any).city || "").trim(),
        avatarUri: avatar.finalAvatarUri || avatar.avatarUri || avatar.churchAvatarUri || avatarUrl,
        avatarUrl,
        logoUrl,
        memberCount,
        ministryCount,
        ministriesCount: ministryCount,
        followerCount,
        followersCount: followerCount,
        viewerFollowing,
        viewerMembershipStatus,
        recentPosts,
      },
    });
  } catch (error: any) {
    if (isChurchDatabaseError(error)) {
      return json({ ok: false, error: "Church database not configured", reason: "missing_db" }, { status: 503 });
    }
    console.error("[church/public-profile] GET failed", error);
    return json(
      { ok: false, error: String(error?.message || error || "Failed to load church profile") },
      { status: 500 }
    );
  }
}
