import { getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { requestJoinChurch } from "@/src/lib/churchMembersApi";

export type ChurchJoinStatus = "member" | "pending" | "none";

export type ChurchPublicPost = {
  id: string;
  title: string;
  body: string;
  type: string;
  createdAt: string | null;
  videoUrl?: string;
  imageUrl?: string;
  churchName: string;
};

export type ChurchPublicProfile = {
  id: string;
  name: string;
  description: string;
  location: string;
  address: string;
  country: string;
  province: string;
  city: string;
  avatarUri: string;
  avatarUrl: string;
  logoUrl: string;
  memberCount: number;
  ministriesCount: number;
  viewerMembershipStatus?: ChurchJoinStatus;
  recentPosts: ChurchPublicPost[];
};

function normalizeChurchId(churchId: string) {
  return String(churchId || "").trim().toUpperCase();
}

function kristoUrl(path: string) {
  const base = getApiBase();
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Public lookup — optional session token only; no identity headers required. */
function publicProfileHeaders(): Record<string, string> {
  const session = getSessionSync();
  const sessionToken = String(session?.sessionToken || "").trim();
  return {
    accept: "application/json",
    ...(sessionToken ? { "x-kristo-session-token": sessionToken } : {}),
  };
}

async function publicApiGet(path: string) {
  try {
    const res = await fetch(kristoUrl(path), {
      method: "GET",
      headers: publicProfileHeaders(),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false as const, status: res.status, error: String(body?.error || `Request failed (${res.status})`), body };
    }
    return { ok: true as const, status: res.status, body };
  } catch (error: any) {
    return {
      ok: false as const,
      status: 0,
      error: String(error?.message || error || "Network error"),
      body: null,
    };
  }
}

function mapPublicProfilePayload(profile: any): ChurchPublicProfile {
  const ministryCount = Number(profile.ministryCount ?? profile.ministriesCount ?? 0);
  const viewerMembershipStatus = String(profile.viewerMembershipStatus || "").trim() as ChurchJoinStatus;

  return {
    id: String(profile.id),
    name: String(profile.name || profile.id),
    description: String(profile.description || "").trim(),
    location: String(profile.location || "").trim(),
    address: String(profile.address || "").trim(),
    country: String(profile.country || "").trim(),
    province: String(profile.province || "").trim(),
    city: String(profile.city || "").trim(),
    avatarUri: String(profile.avatarUri || profile.avatarUrl || profile.logoUrl || "").trim(),
    avatarUrl: String(profile.avatarUrl || profile.avatarUri || profile.logoUrl || "").trim(),
    logoUrl: String(profile.logoUrl || profile.avatarUrl || profile.avatarUri || "").trim(),
    memberCount: Number(profile.memberCount || 0),
    ministriesCount: ministryCount,
    viewerMembershipStatus:
      viewerMembershipStatus === "member" || viewerMembershipStatus === "pending"
        ? viewerMembershipStatus
        : "none",
    recentPosts: Array.isArray(profile.recentPosts)
      ? profile.recentPosts.map((post: any) => ({
          id: String(post?.id || ""),
          title: String(post?.title || "").trim(),
          body: String(post?.body || "").trim(),
          type: String(post?.type || "").trim(),
          createdAt: post?.createdAt ? String(post.createdAt) : null,
          videoUrl: post?.videoUrl ? String(post.videoUrl) : undefined,
          imageUrl: post?.imageUrl ? String(post.imageUrl) : undefined,
          churchName: String(post?.churchName || profile.name || profile.id).trim(),
        }))
      : [],
  };
}

function mapDirectoryToProfile(data: any, churchId: string): ChurchPublicProfile {
  const avatarUri = String(data?.avatarUri || data?.avatarUrl || data?.logoUrl || "").trim();
  const location = [data?.city, data?.province, data?.country].filter(Boolean).join(" • ");
  return {
    id: String(data?.id || churchId),
    name: String(data?.name || churchId),
    description: String(data?.address || location || "").trim(),
    location,
    address: String(data?.address || "").trim(),
    country: String(data?.country || "").trim(),
    province: String(data?.province || "").trim(),
    city: String(data?.city || "").trim(),
    avatarUri,
    avatarUrl: avatarUri,
    logoUrl: String(data?.logoUrl || avatarUri).trim(),
    memberCount: 0,
    ministriesCount: 0,
    recentPosts: [],
  };
}

export function resolveChurchJoinStatus(
  churchId: string,
  memberships: Array<{ churchId?: string; status?: string }> = [],
  preferred?: ChurchJoinStatus
): ChurchJoinStatus {
  if (preferred === "member" || preferred === "pending") return preferred;

  const target = normalizeChurchId(churchId);
  if (!target) return "none";

  const session = getSessionSync();
  const sessionChurchId = normalizeChurchId(String(session?.churchId || ""));
  if (sessionChurchId && sessionChurchId === target) return "member";

  for (const row of memberships) {
    if (normalizeChurchId(String(row?.churchId || "")) !== target) continue;
    const status = String(row?.status || "").trim();
    if (status === "Active") return "member";
    if (status === "Requested") return "pending";
  }

  return "none";
}

async function fetchViewerChurchFallback(churchId: string): Promise<ChurchPublicProfile | null> {
  const session = getSessionSync();
  const target = normalizeChurchId(churchId);
  const viewerChurchId = normalizeChurchId(String(session?.churchId || ""));
  if (!target || !viewerChurchId || viewerChurchId !== target) return null;

  const userId = String(session?.userId || "").trim();
  if (!userId) return null;

  const me = await fetch(kristoUrl("/api/me/church"), {
    method: "GET",
    headers: getKristoHeaders({
      userId,
      role: (session?.role as any) || "Member",
      churchId: String(session?.churchId || ""),
      sessionToken: session?.sessionToken,
    }),
  }).then(async (res) => {
    const body = await res.json().catch(() => null);
    return res.ok && body?.ok ? body : null;
  }).catch(() => null);

  if (!me) return null;

  const directory = await publicApiGet(`/api/church/directory?id=${encodeURIComponent(target)}`);
  if (directory.ok && directory.body?.ok && directory.body?.data?.id) {
    const profile = mapDirectoryToProfile(directory.body.data, target);
    profile.viewerMembershipStatus = resolveChurchJoinStatus(
      target,
      Array.isArray(me.memberships) ? me.memberships : [],
      "member"
    );
    return profile;
  }

  return {
    id: target,
    name: String(session?.churchName || (session as any)?.churchLabel || target),
    description: "",
    location: "",
    address: "",
    country: "",
    province: "",
    city: "",
    avatarUri: String((session as any)?.churchAvatarUri || (session as any)?.churchAvatarUrl || "").trim(),
    avatarUrl: String((session as any)?.churchAvatarUri || (session as any)?.churchAvatarUrl || "").trim(),
    logoUrl: String((session as any)?.churchLogoUrl || "").trim(),
    memberCount: 0,
    ministriesCount: 0,
    viewerMembershipStatus: resolveChurchJoinStatus(
      target,
      Array.isArray(me.memberships) ? me.memberships : [],
      "member"
    ),
    recentPosts: [],
  };
}

export async function fetchChurchPublicProfile(churchId: string): Promise<ChurchPublicProfile | null> {
  const id = normalizeChurchId(churchId);
  if (!id) return null;

  const primary = await publicApiGet(`/api/church/public-profile?id=${encodeURIComponent(id)}`);
  if (primary.ok && primary.body?.ok && primary.body?.data?.id) {
    return mapPublicProfilePayload(primary.body.data);
  }

  const directory = await publicApiGet(`/api/church/directory?id=${encodeURIComponent(id)}`);
  if (directory.ok && directory.body?.ok && directory.body?.data?.id) {
    return mapDirectoryToProfile(directory.body.data, id);
  }

  return fetchViewerChurchFallback(id);
}

export async function fetchViewerChurchMemberships(): Promise<
  Array<{ churchId?: string; status?: string }>
> {
  const session = getSessionSync();
  const userId = String(session?.userId || "").trim();
  if (!userId) return [];

  const res = await fetch(kristoUrl("/api/me/church"), {
    method: "GET",
    headers: getKristoHeaders({
      userId,
      role: (session?.role as any) || "Member",
      churchId: String(session?.churchId || ""),
      sessionToken: session?.sessionToken,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) return [];
  return Array.isArray(data.memberships) ? data.memberships : [];
}

export async function sendChurchJoinRequest(churchId: string, displayName?: string) {
  return requestJoinChurch(churchId, displayName);
}
