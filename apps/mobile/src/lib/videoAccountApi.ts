import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export type VideoAccountOverview = {
  account: { key: string; provider: string; name: string; avatarUrl: string };
  /** Video links of this account that are in Kristo App (not the platform's own totals). */
  videoCount: number;
  /** Feed rows (same shape as the Home Feed) — opened in the Home Watch as they are. */
  items: any[];
};

const cache = new Map<string, { at: number; data: VideoAccountOverview }>();
const CACHE_TTL_MS = 2 * 60 * 1000;

export function peekVideoAccountOverview(key: string): VideoAccountOverview | null {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.data : null;
}

/** Read-only: GET /api/video-accounts. */
export async function fetchVideoAccountOverview(params: {
  key: string;
  provider?: string;
  name?: string;
}): Promise<VideoAccountOverview> {
  const query = new URLSearchParams({ key: params.key });
  if (params.provider) query.set("provider", params.provider);
  if (params.name) query.set("name", params.name);
  const response: any = await apiGet(`/api/video-accounts?${query.toString()}`, {
    headers: getKristoHeaders() as any,
  });
  if (!response || response.ok !== true || !Array.isArray(response.items)) {
    throw new Error(String(response?.error || "Video za akaunti hii hazikupatikana."));
  }
  const data: VideoAccountOverview = {
    account: {
      key: String(response.account?.key || params.key),
      provider: String(response.account?.provider || params.provider || ""),
      name: String(response.account?.name || params.name || ""),
      avatarUrl: String(response.account?.avatarUrl || ""),
    },
    videoCount: Number(response.videoCount) || 0,
    items: response.items,
  };
  cache.set(params.key, { at: Date.now(), data });
  return data;
}
