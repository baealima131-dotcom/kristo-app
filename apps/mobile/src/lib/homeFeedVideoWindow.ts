export type HomeFeedVideoWarmMode = "active" | "preload" | "warm" | "cache" | "off";

function isVideoFeedRow(item: any) {
  const videoUrl = String(item?.videoUrl || item?.mediaUri || "").trim();
  if (!videoUrl) return false;
  return item?.mediaType === "video" || item?.type === "video";
}

/** Rolling mount window: 2 behind, active, 3 ahead (video rows only). */
const DESIRED_OFFSETS = [-2, -1, 0, 1, 2, 3] as const;

export const HOME_FEED_MAX_MOUNTED_PLAYERS = 6;
export const HOME_FEED_PLAYER_WARM_BEHIND = 2;
export const HOME_FEED_PLAYER_WARM_AHEAD = 3;

function offsetPriority(offset: number): number {
  if (offset === 0) return 0;
  if (offset === -1) return 1;
  if (offset === 1) return 2;
  if (offset === -2) return 3;
  if (offset === 2) return 4;
  if (offset === 3) return 5;
  return 100 + Math.abs(offset);
}

export function computeHomeFeedMountedVideoIndexes(
  rows: any[],
  activeIndex: number,
  maxPlayers = HOME_FEED_MAX_MOUNTED_PLAYERS
): number[] {
  const candidates: Array<{ index: number; priority: number }> = [];

  for (const offset of DESIRED_OFFSETS) {
    const idx = activeIndex + offset;
    if (idx < 0 || idx >= rows.length) continue;
    const item = rows[idx];
    if (!item || !isVideoFeedRow(item)) continue;
    candidates.push({ index: idx, priority: offsetPriority(offset) });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.slice(0, maxPlayers).map((candidate) => candidate.index);
}

export function resolveHomeFeedVideoWarmMode(
  index: number,
  activeIndex: number,
  mountedIndexes?: number[]
): HomeFeedVideoWarmMode {
  if (mountedIndexes && !mountedIndexes.includes(index)) return "off";

  const delta = index - activeIndex;
  if (delta === 0) return "active";
  if (delta === 1 || delta === 2 || delta === 3) return "preload";
  if (delta === -1) return "warm";
  if (delta === -2) return "cache";
  return "off";
}

export function isHomeFeedVideoWarmIndex(
  index: number,
  activeIndex: number,
  mountedIndexes?: number[]
) {
  return resolveHomeFeedVideoWarmMode(index, activeIndex, mountedIndexes) !== "off";
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
