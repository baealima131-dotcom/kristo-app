import { wasHomeFeedVideoWatched } from "@/src/lib/homeFeedVideoRetention";
import { homeFeedMediaUrl, resolveVideoUri } from "@/src/lib/homeFeedVideoUri";

export function resolveHomeFeedRowPlaybackUrl(row: any): string {
  const original = resolveVideoUri(row);
  return homeFeedMediaUrl(original) || original;
}

export type HomeFeedVideoWarmMode = "active" | "preload" | "warm" | "cache" | "off";

function isVideoFeedRow(item: any) {
  const videoUrl = String(item?.videoUrl || item?.mediaUri || "").trim();
  if (!videoUrl) return false;
  return item?.mediaType === "video" || item?.type === "video";
}

/** Active + next 3 + previous 4 video rows (by video rank, not raw feed index). */
export const HOME_FEED_PLAYER_WARM_BEHIND = 4;
export const HOME_FEED_PLAYER_WARM_AHEAD = 3;
/** Drop mount/disk retention once a watched row is farther than this many video ranks. */
export const HOME_FEED_VIDEO_EVICTION_DISTANCE = 6;

export const HOME_FEED_MAX_MOUNTED_PLAYERS = 12;

export function collectVideoFeedIndexes(rows: any[]): number[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  const indexes: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (isVideoFeedRow(rows[i])) indexes.push(i);
  }
  return indexes;
}

export function resolveActiveVideoRank(videoIndexes: number[], activeIndex: number): number {
  if (!videoIndexes.length) return 0;
  const direct = videoIndexes.indexOf(activeIndex);
  if (direct >= 0) return direct;
  for (let i = videoIndexes.length - 1; i >= 0; i -= 1) {
    if (videoIndexes[i] <= activeIndex) return i;
  }
  return 0;
}

function videoRankDelta(
  rows: any[],
  index: number,
  activeIndex: number
): number | null {
  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return null;
  const indexRank = videoIndexes.indexOf(index);
  if (indexRank < 0) return null;
  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  return indexRank - activeRank;
}

function offsetPriority(delta: number): number {
  if (delta === 0) return 0;
  if (delta === -1) return 1;
  if (delta === 1) return 2;
  if (delta === -2) return 3;
  if (delta === 2) return 4;
  if (delta === -3) return 5;
  if (delta === 3) return 6;
  if (delta === -4) return 7;
  if (delta === 4) return 8;
  return 100 + Math.abs(delta);
}

function collectRetainedWatchedIndexes(
  rows: any[],
  videoIndexes: number[],
  activeRank: number
): number[] {
  const pinned: number[] = [];
  for (let rank = 0; rank < videoIndexes.length; rank += 1) {
    const feedIndex = videoIndexes[rank];
    const row = rows[feedIndex];
    const postId = String(row?.id || "").trim();
    if (!postId || !wasHomeFeedVideoWatched(postId)) continue;
    if (Math.abs(rank - activeRank) > HOME_FEED_VIDEO_EVICTION_DISTANCE) continue;
    pinned.push(feedIndex);
  }
  return pinned;
}

export function computeHomeFeedMountedVideoIndexes(
  rows: any[],
  activeIndex: number,
  maxPlayers = HOME_FEED_MAX_MOUNTED_PLAYERS
): number[] {
  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return [];

  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  const keep = new Map<number, number>();

  for (
    let rank = activeRank - HOME_FEED_PLAYER_WARM_BEHIND;
    rank <= activeRank + HOME_FEED_PLAYER_WARM_AHEAD;
    rank += 1
  ) {
    if (rank < 0 || rank >= videoIndexes.length) continue;
    const feedIndex = videoIndexes[rank];
    keep.set(feedIndex, offsetPriority(rank - activeRank));
  }

  for (const feedIndex of collectRetainedWatchedIndexes(rows, videoIndexes, activeRank)) {
    const rank = videoIndexes.indexOf(feedIndex);
    if (rank < 0) continue;
    const delta = rank - activeRank;
    if (!keep.has(feedIndex)) {
      keep.set(feedIndex, offsetPriority(delta) + 20);
    }
  }

  return Array.from(keep.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, maxPlayers)
    .map(([index]) => index);
}

export function resolveHomeFeedVideoWarmMode(
  index: number,
  activeIndex: number,
  mountedIndexes?: number[],
  rows?: any[]
): HomeFeedVideoWarmMode {
  if (mountedIndexes && !mountedIndexes.includes(index)) return "off";
  if (index === activeIndex) return "active";

  const delta =
    rows && rows.length ? videoRankDelta(rows, index, activeIndex) : index - activeIndex;
  if (delta == null) return "off";

  if (delta >= 1 && delta <= HOME_FEED_PLAYER_WARM_AHEAD) return "preload";
  if (delta <= -1 && delta >= -HOME_FEED_PLAYER_WARM_BEHIND) {
    return delta <= -3 ? "cache" : "warm";
  }
  return "off";
}

export function isHomeFeedVideoWarmIndex(
  index: number,
  activeIndex: number,
  mountedIndexes?: number[],
  rows?: any[]
) {
  return resolveHomeFeedVideoWarmMode(index, activeIndex, mountedIndexes, rows) !== "off";
}

export function collectHomeFeedVideoWindowIds(rows: any[], activeIndex: number) {
  const mountedIndexes = computeHomeFeedMountedVideoIndexes(rows, activeIndex);
  const warmIds: string[] = [];

  for (const idx of mountedIndexes) {
    const item = rows[idx];
    if (!item || !isVideoFeedRow(item)) continue;
    const id = String(item?.id || "").trim();
    if (id) warmIds.push(id);
  }

  return warmIds;
}

/** Video ranks to keep on disk: rolling window + watched rows within eviction distance. */
export function collectHomeFeedVideoDiskCacheRanks(
  rows: any[],
  activeIndex: number
): number[] {
  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return [];

  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  const keep = new Set<number>();

  for (
    let rank = activeRank - HOME_FEED_PLAYER_WARM_BEHIND;
    rank <= activeRank + HOME_FEED_PLAYER_WARM_AHEAD;
    rank += 1
  ) {
    if (rank >= 0 && rank < videoIndexes.length) keep.add(rank);
  }

  for (const feedIndex of collectRetainedWatchedIndexes(rows, videoIndexes, activeRank)) {
    const rank = videoIndexes.indexOf(feedIndex);
    if (rank >= 0) keep.add(rank);
  }

  return Array.from(keep).sort((a, b) => a - b);
}

export function collectHomeFeedVideoDiskCacheUrls(rows: any[], activeIndex: number): string[] {
  return collectPrioritizedDiskCacheUrls(rows, activeIndex);
}

/** Active video first, then +1/+2/+3, then behind — for download priority. */
export function collectPrioritizedDiskCacheUrls(rows: any[], activeIndex: number): string[] {
  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return [];

  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  const rankOrder: number[] = [];
  const seenRanks = new Set<number>();

  const pushRank = (rank: number) => {
    if (rank < 0 || rank >= videoIndexes.length || seenRanks.has(rank)) return;
    seenRanks.add(rank);
    rankOrder.push(rank);
  };

  pushRank(activeRank);
  for (let delta = 1; delta <= HOME_FEED_PLAYER_WARM_AHEAD; delta += 1) {
    pushRank(activeRank + delta);
  }
  for (let delta = 1; delta <= HOME_FEED_PLAYER_WARM_BEHIND; delta += 1) {
    pushRank(activeRank - delta);
  }

  for (const feedIndex of collectRetainedWatchedIndexes(rows, videoIndexes, activeRank)) {
    pushRank(videoIndexes.indexOf(feedIndex));
  }

  const urls: string[] = [];
  const seenUrls = new Set<string>();

  for (const rank of rankOrder) {
    const row = rows[videoIndexes[rank]];
    if (!row) continue;
    const url = String(resolveHomeFeedRowPlaybackUrl(row) || "").trim();
    const normalized = url.split("?")[0];
    if (!url || !/^https?:\/\//i.test(url) || !normalized || seenUrls.has(normalized)) continue;
    seenUrls.add(normalized);
    urls.push(url);
  }

  return urls;
}

export function collectForwardVideoDiskCacheUrls(rows: any[], activeIndex: number): string[] {
  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return [];

  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  const urls: string[] = [];
  const seen = new Set<string>();

  for (let delta = 1; delta <= HOME_FEED_PLAYER_WARM_AHEAD; delta += 1) {
    const rank = activeRank + delta;
    if (rank < 0 || rank >= videoIndexes.length) continue;
    const row = rows[videoIndexes[rank]];
    if (!row) continue;
    const url = String(resolveHomeFeedRowPlaybackUrl(row) || "").trim();
    const normalized = url.split("?")[0];
    if (!url || !/^https?:\/\//i.test(url) || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(url);
  }

  return urls;
}

/** Every video row in feed order — deduped network URLs. */
export function collectAllFeedVideoDiskCacheUrls(rows: any[]): string[] {
  const videoIndexes = collectVideoFeedIndexes(rows);
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const feedIndex of videoIndexes) {
    const row = rows[feedIndex];
    if (!row) continue;
    const url = String(resolveHomeFeedRowPlaybackUrl(row) || "").trim();
    const normalized = url.split("?")[0];
    if (!url || !/^https?:\/\//i.test(url) || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(url);
  }

  return urls;
}

/** True when a feed row should stay on disk (not evicted on window shift). */
export function shouldRetainHomeFeedVideoDiskCache(
  rows: any[],
  activeIndex: number,
  remoteUrl: string
): boolean {
  const normalized = String(remoteUrl || "").trim().split("?")[0];
  if (!normalized) return false;

  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return false;

  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  const keepUrls = new Set(collectHomeFeedVideoDiskCacheUrls(rows, activeIndex).map((u) => u.split("?")[0]));

  if (keepUrls.has(normalized)) return true;

  for (const feedIndex of videoIndexes) {
    const row = rows[feedIndex];
    const url = String(resolveHomeFeedRowPlaybackUrl(row) || "").trim().split("?")[0];
    if (url !== normalized) continue;
    const postId = String(row?.id || "").trim();
    if (!postId || !wasHomeFeedVideoWatched(postId)) return false;
    const rank = videoIndexes.indexOf(feedIndex);
    return Math.abs(rank - activeRank) <= HOME_FEED_VIDEO_EVICTION_DISTANCE;
  }

  return false;
}
