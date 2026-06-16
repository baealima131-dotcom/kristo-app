import { getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { requestJoinChurch } from "@/src/lib/churchMembersApi";

export type ChurchJoinStatus = "member" | "pending" | "none";

export type ChurchProfileViewerState = {
  joinStatus: ChurchJoinStatus;
  memberOfOtherChurch: boolean;
  activeChurchId: string | null;
  canJoin: boolean;
};

const V1_OTHER_CHURCH_JOIN_MESSAGE =
  "You are already a member of another church. You can follow this church, but joining another church is not available in V1.";

export { V1_OTHER_CHURCH_JOIN_MESSAGE };

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
  followerCount?: number;
  viewerFollowing?: boolean;
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
    followerCount: Number(profile.followerCount ?? profile.followersCount ?? 0),
    viewerFollowing: Boolean(profile.viewerFollowing),
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
  return resolveChurchProfileViewerState(churchId, memberships, preferred).joinStatus;
}

export function resolveChurchProfileViewerState(
  churchId: string,
  memberships: Array<{ churchId?: string; status?: string }> = [],
  preferred?: ChurchJoinStatus
): ChurchProfileViewerState {
  const target = normalizeChurchId(churchId);
  if (!target) {
    return { joinStatus: "none", memberOfOtherChurch: false, activeChurchId: null, canJoin: false };
  }

  if (preferred === "member") {
    return { joinStatus: "member", memberOfOtherChurch: false, activeChurchId: target, canJoin: false };
  }
  if (preferred === "pending") {
    return { joinStatus: "pending", memberOfOtherChurch: false, activeChurchId: null, canJoin: false };
  }

  const session = getSessionSync();
  const sessionChurchId = normalizeChurchId(String(session?.churchId || ""));

  let pendingForTarget = false;
  let activeChurchId: string | null = null;

  for (const row of memberships) {
    const cid = normalizeChurchId(String(row?.churchId || ""));
    const status = String(row?.status || "").trim();
    if (!cid) continue;
    if (status === "Active") {
      if (cid === target) {
        return {
          joinStatus: "member",
          memberOfOtherChurch: false,
          activeChurchId: cid,
          canJoin: false,
        };
      }
      if (!activeChurchId) activeChurchId = cid;
    }
    if (status === "Requested" && cid === target) {
      pendingForTarget = true;
    }
  }

  if (sessionChurchId === target) {
    return {
      joinStatus: "member",
      memberOfOtherChurch: false,
      activeChurchId: target,
      canJoin: false,
    };
  }

  if (!activeChurchId && sessionChurchId) {
    activeChurchId = sessionChurchId;
  }

  if (pendingForTarget) {
    return {
      joinStatus: "pending",
      memberOfOtherChurch: Boolean(activeChurchId && activeChurchId !== target),
      activeChurchId,
      canJoin: false,
    };
  }

  const memberOfOtherChurch = Boolean(activeChurchId && activeChurchId !== target);
  return {
    joinStatus: "none",
    memberOfOtherChurch,
    activeChurchId,
    canJoin: !memberOfOtherChurch,
  };
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
    profile.viewerMembershipStatus = resolveChurchProfileViewerState(
      target,
      Array.isArray(me.memberships) ? me.memberships : [],
      "member"
    ).joinStatus;
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
    viewerMembershipStatus: resolveChurchProfileViewerState(
      target,
      Array.isArray(me.memberships) ? me.memberships : [],
      "member"
    ).joinStatus,
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

function authedHeaders() {
  const session = getSessionSync();
  const userId = String(session?.userId || "").trim();
  if (!userId) return null;
  return getKristoHeaders({
    userId,
    role: (session?.role as any) || "Member",
    churchId: String(session?.churchId || ""),
    sessionToken: session?.sessionToken,
  });
}

export type ChurchFollowMutationResult = {
  ok: boolean;
  following?: boolean;
  followerCount?: number;
  status?: number;
  error?: string;
  responseBody?: unknown;
  resolvedUserId?: string;
};

function followEndpoint(churchId: string, method: "GET" | "POST") {
  if (method === "POST") return kristoUrl("/api/church/follow");
  return kristoUrl(`/api/church/follow?churchId=${encodeURIComponent(churchId)}`);
}

function parseFollowPayload(responseBody: any) {
  const followerCount = Number(
    responseBody?.followerCount ??
      responseBody?.followersCount ??
      responseBody?.data?.followerCount ??
      responseBody?.data?.followersCount ??
      NaN
  );
  const following =
    typeof responseBody?.following === "boolean"
      ? responseBody.following
      : typeof responseBody?.data?.following === "boolean"
        ? responseBody.data.following
        : undefined;
  return {
    following,
    followerCount: Number.isFinite(followerCount) ? followerCount : undefined,
  };
}

function followErrorMessage(status: number, body: any): string {
  const apiError = String(body?.error || "").trim();
  if (status === 404) {
    return "Follow API is not available on this server yet (404). Deploy /api/church/follow.";
  }
  if (status === 401) {
    return apiError || "Sign in required or session expired.";
  }
  if (status === 403) {
    return apiError || "Not allowed to update follow status.";
  }
  if (apiError) return apiError;
  if (status) return `Request failed (${status}).`;
  return "Network error.";
}

async function churchFollowRequest(
  churchId: string,
  method: "GET" | "POST",
  following?: boolean
): Promise<ChurchFollowMutationResult> {
  const id = normalizeChurchId(churchId);
  const headers = authedHeaders();
  const resolvedUserId = String(headers?.["x-kristo-user-id"] || "").trim();
  const url = followEndpoint(id, method);
  const hasSessionToken = Boolean(headers?.["x-kristo-session-token"]);

  console.log("KRISTO_CHURCH_FOLLOW_REQUEST", {
    churchId: id,
    method,
    url,
    following: following ?? null,
    resolvedUserId: resolvedUserId || null,
    hasSessionToken,
    apiBase: getApiBase(),
  });

  if (!id || !headers || !resolvedUserId) {
    const error = !resolvedUserId ? "Sign in required." : "churchId missing.";
    console.log("KRISTO_CHURCH_FOLLOW_ERROR", {
      churchId: id || null,
      method,
      status: 0,
      error,
      resolvedUserId: resolvedUserId || null,
      responseBody: null,
    });
    return { ok: false, status: 0, error, resolvedUserId: resolvedUserId || undefined };
  }

  let res: Response;
  let responseBody: any = null;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...headers,
        accept: "application/json",
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify({ churchId: id, following: Boolean(following) }) : undefined,
    });
    const text = await res.text();
    if (text) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { ok: false, error: text.slice(0, 280) };
      }
    }
  } catch (e: any) {
    const error = String(e?.message || e || "Network error.");
    console.log("KRISTO_CHURCH_FOLLOW_ERROR", {
      churchId: id,
      method,
      status: 0,
      error,
      resolvedUserId,
      responseBody: null,
    });
    return { ok: false, status: 0, error, resolvedUserId, responseBody: null };
  }

  const { following: nextFollowing, followerCount } = parseFollowPayload(responseBody);
  const ok = Boolean(res.ok && responseBody?.ok);

  if (ok) {
    console.log("KRISTO_CHURCH_FOLLOW_RESPONSE", {
      churchId: id,
      method,
      status: res.status,
      following: nextFollowing ?? null,
      followerCount: followerCount ?? null,
      resolvedUserId,
      responseBody,
    });
    return {
      ok: true,
      following: nextFollowing,
      followerCount,
      status: res.status,
      resolvedUserId,
      responseBody,
    };
  }

  const error = followErrorMessage(res.status, responseBody);
  console.log("KRISTO_CHURCH_FOLLOW_ERROR", {
    churchId: id,
    method,
    status: res.status,
    error,
    resolvedUserId,
    responseBody,
  });
  return {
    ok: false,
    status: res.status,
    error,
    resolvedUserId,
    responseBody,
  };
}

export async function fetchChurchFollowStatus(churchId: string): Promise<boolean> {
  const result = await churchFollowRequest(churchId, "GET");
  return Boolean(result.ok && result.following);
}

export async function setChurchFollow(
  churchId: string,
  following: boolean
): Promise<ChurchFollowMutationResult> {
  return churchFollowRequest(churchId, "POST", following);
}
