export type HomeFeedVideoWarmMode = "active" | "preload" | "warm" | "off";

function isVideoFeedRow(item: any) {
  const videoUrl = String(item?.videoUrl || item?.mediaUri || "").trim();
  if (!videoUrl) return false;
  return item?.mediaType === "video" || item?.type === "video";
}

// V1 perf: only the active video and the single next video are warmed.
// No warming for offscreen videos below the first two rows, and no warming
// for videos above the active one.
const WINDOW_OFFSETS = [0, 1] as const;

export function resolveHomeFeedVideoWarmMode(
  index: number,
  activeIndex: number
): HomeFeedVideoWarmMode {
  const delta = index - activeIndex;
  if (delta === 0) return "active";
  if (delta === 1) return "preload";
  return "off";
}

export function isHomeFeedVideoWarmIndex(index: number, activeIndex: number) {
  return resolveHomeFeedVideoWarmMode(index, activeIndex) !== "off";
}

export function collectHomeFeedVideoWindowIds(rows: any[], activeIndex: number) {
  const warmIds: string[] = [];

  for (const offset of WINDOW_OFFSETS) {
    const idx = activeIndex + offset;
    if (idx < 0 || idx >= rows.length) continue;
    const item = rows[idx];
    if (!item || !isVideoFeedRow(item)) continue;
    const id = String(item?.id || "").trim();
    if (id) warmIds.push(id);
  }

  return warmIds;
}
