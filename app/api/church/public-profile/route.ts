import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getChurchById, searchChurches, type ChurchProfile } from "@/app/api/_lib/churches";
import { resolveChurchAvatarFields } from "@/app/api/_lib/churchAvatar";
import { getMembershipsForChurch, getMembershipsForUser } from "@/app/api/_lib/memberships";
import { readMinistryJsonFile } from "@/app/api/_lib/store/ministryDb";
import { listFeedItems, listFeedItemsForChurch } from "@/app/api/_lib/store/feedDb";
import { isChurchDatabaseError } from "@/app/api/_lib/store/churchDb";
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
    .map((item: any) => ({
      id: String(item?.id || ""),
      title: String(item?.title || item?.postTitle || "").trim(),
      body: String(item?.body || item?.text || item?.caption || "").trim(),
      type: String(item?.type || item?.kind || "").trim(),
      createdAt: item?.createdAt || item?.updatedAt || null,
      videoUrl: String(item?.videoUrl || item?.videoUri || item?.mediaUrl || "").trim() || undefined,
      imageUrl: String(item?.imageUrl || item?.mediaUri || "").trim() || undefined,
      churchName: String(item?.churchName || item?.churchLabel || churchName).trim(),
    }))
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
    try {
      const activeMembers = await getMembershipsForChurch(id, "Active");
      memberCount = activeMembers.length;
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
