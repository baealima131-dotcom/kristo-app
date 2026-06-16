import { getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";

export type ChurchFollower = {
  userId: string;
  displayName: string;
  avatarUri: string;
  followedAt: string;
};

function kristoUrl(path: string) {
  const base = getApiBase();
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
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

export function resolveFollowerAvatarUrl(raw?: string) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^(https?:|file:|data:image\/)/i.test(v)) return v;
  const base = getApiBase();
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

export async function fetchChurchFollowers(churchId?: string): Promise<{
  followerCount: number;
  followers: ChurchFollower[];
}> {
  const session = getSessionSync();
  const cid = String(churchId || session?.churchId || "").trim().toUpperCase();
  const headers = authedHeaders();
  if (!cid || !headers) {
    return { followerCount: 0, followers: [] };
  }

  const res = await fetch(
    kristoUrl(`/api/church/followers?churchId=${encodeURIComponent(cid)}`),
    { method: "GET", headers }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    return { followerCount: 0, followers: [] };
  }

  const rows = Array.isArray(data?.data?.followers) ? data.data.followers : [];
  const followerCount = Number(data?.data?.followerCount ?? data?.data?.followersCount ?? rows.length ?? 0);

  return {
    followerCount,
    followers: rows.map((row: any) => ({
      userId: String(row?.userId || ""),
      displayName: String(row?.displayName || row?.userId || "Follower").trim(),
      avatarUri: resolveFollowerAvatarUrl(row?.avatarUri || row?.avatarUrl),
      followedAt: String(row?.followedAt || row?.createdAt || ""),
    })),
  };
}
