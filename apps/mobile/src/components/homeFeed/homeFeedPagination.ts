import { feedRenderKey } from "./homeFeedUtils";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

export function homeFeedBackendRowsDigest(rows: any[]): string {
  return rows.map((row) => homeFeedRowCardFingerprint(row)).join("\n");
}

export function homeFeedLocalRowsDigest(rows: any[]): string {
  return rows.map((row) => homeFeedRowKey(row)).join("|");
}

/** First paint window — TikTok-style fast initial load. */
export const HOME_FEED_INITIAL_LIMIT = 20;

/** Grow visible window by this many rows per prefetch. */
export const HOME_FEED_PAGE_SIZE = 15;

/** Prefetch when activeIndex reaches this row (near end of first page). */
export const HOME_FEED_NEXT_PAGE_THRESHOLD = 15;

/** Expand window when within this many rows of the visible tail. */
export const HOME_FEED_PREFETCH_LEAD = 5;

/** Trigger staged near-end loading once activeIndex passes this fraction of the window. */
export const HOME_FEED_NEAR_END_FACTOR = 0.7;

/** Row index (~70% through the visible window) where the next batch should start loading. */
export function homeFeedNearEndTriggerIndex(visibleCount: number): number {
  if (visibleCount <= 1) return 0;
  return Math.max(1, Math.ceil(visibleCount * HOME_FEED_NEAR_END_FACTOR));
}

/** True when activeIndex is ~70% through the visible window (e.g. 7/10, 14/20). */
export function isHomeFeedNearEnd(activeIndex: number, visibleCount: number): boolean {
  if (visibleCount <= 0) return false;
  return activeIndex >= homeFeedNearEndTriggerIndex(visibleCount);
}

export function homeFeedRowKey(row: any): string {
  return feedRenderKey(row) || String(row?.id || "").trim();
}

/** Stable fingerprint for card render props — ignores object identity churn. */
export function homeFeedRowCardFingerprint(row: any): string {
  if (!row || typeof row !== "object") return "";
  return [
    String(row?.id || "").trim(),
    String(row?.updatedAt || ""),
    String(row?.createdAt || ""),
    String(row?.mediaStatus || row?.status || ""),
    String(row?.videoUrl || row?.mediaUrl || row?.mediaUri || ""),
    String(row?.posterUri || ""),
    String(row?.videoPosterUri || ""),
    String(row?.thumbnailUri || ""),
    String(row?.thumbnailUrl || ""),
    String(row?.posterUrl || ""),
    String(row?.title || row?.postTitle || ""),
    String(row?.likeCount || ""),
    row?.likedByMe ? "1" : "0",
    row?.liked ? "1" : "0",
    row?.saved ? "1" : "0",
    String(row?.commentCount || ""),
    String(row?.shareCount || ""),
    String(row?.homeFeedRecycleKey || ""),
  ].join("|");
}

function mergeHomeFeedRowPreservingReference(existing: any, fresh: any) {
  if (!fresh) return existing;
  const merged = { ...existing, ...fresh, id: existing.id ?? fresh.id };
  if (homeFeedRowCardFingerprint(existing) === homeFeedRowCardFingerprint(merged)) {
    return existing;
  }
  return merged;
}

export type HomeFeedStableMergeResult = {
  merged: any[];
  before: number;
  incoming: number;
  after: number;
  appended: number;
};

/** Preserve existing order, refresh in-place, append unseen rows at the end. */
export function stableMergeHomeFeedRows(
  existing: any[],
  incoming: any[]
): HomeFeedStableMergeResult {
  const incomingById = new Map<string, any>();
  for (const row of incoming) {
    const id = homeFeedRowKey(row);
    if (id) incomingById.set(id, row);
  }

  const seen = new Set<string>();
  const merged: any[] = [];
  let appended = 0;

  for (const row of existing) {
    const id = homeFeedRowKey(row);
    if (!id) continue;
    seen.add(id);
    const fresh = incomingById.get(id);
    merged.push(fresh ? mergeHomeFeedRowPreservingReference(row, fresh) : row);
  }

  for (const row of incoming) {
    const id = homeFeedRowKey(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
    appended += 1;
  }

  return {
    merged,
    before: existing.length,
    incoming: incoming.length,
    after: merged.length,
    appended,
  };
}

/** Drop cached backend rows the latest API snapshot no longer includes. */
export function pruneHomeFeedBackendRowsNotInSnapshot(existing: any[], incoming: any[]) {
  const incomingIds = new Set<string>();
  for (const row of incoming) {
    const id = homeFeedRowKey(row);
    if (id) incomingIds.add(id);
  }

  const { merged } = stableMergeHomeFeedRows(existing, incoming);
  if (!incomingIds.size) return merged;

  return merged.filter((row) => {
    const id = homeFeedRowKey(row);
    if (!id) return false;
    return incomingIds.has(id);
  });
}

export function shouldPrefetchHomeFeedPage(
  activeIndex: number,
  visibleCount: number,
  lead = HOME_FEED_PREFETCH_LEAD
): boolean {
  if (visibleCount <= 0) return false;
  return activeIndex >= visibleCount - lead;
}

export function nextHomeFeedVisibleWindowSize(
  current: number,
  totalAvailable: number,
  pageSize = HOME_FEED_PAGE_SIZE
): number {
  if (totalAvailable <= 0) return current;
  return Math.min(totalAvailable, current + pageSize);
}

export function initialHomeFeedVisibleWindowSize(totalAvailable: number): number {
  return Math.min(HOME_FEED_INITIAL_LIMIT, Math.max(0, totalAvailable));
}

/**
 * Endless-feed fallback: when the backend has no more posts, build a fresh cycle
 * of existing posts so the feed never dead-ends. Recycled rows keep their real
 * post `id` (so likes/comments stay correct) but get a unique `homeFeedRecycleKey`
 * (`${id}:cycle:${cycle}`) so FlatList treats them as distinct rows. The order is
 * reshuffled per cycle and we avoid repeating the post that's currently at the tail.
 */
export function buildRecycledHomeFeedRows(
  sourceRows: any[],
  cycle: number,
  opts?: { isRecyclable?: (row: any) => boolean; avoidLeadingId?: string }
): any[] {
  const recyclable = (sourceRows || []).filter((row) => {
    if (!row || typeof row !== "object") return false;
    if (row.homeFeedRecycleKey) return false;
    if (!String(row?.id || "").trim()) return false;
    if (opts?.isRecyclable && !opts.isRecyclable(row)) return false;
    return true;
  });
  if (!recyclable.length) return [];

  // Deterministic per-cycle reshuffle: rotate by cycle, then reverse for variety.
  const shift = ((cycle % recyclable.length) + recyclable.length) % recyclable.length;
  let ordered = [...recyclable.slice(shift), ...recyclable.slice(0, shift)].reverse();

  const avoid = baseFeedId(String(opts?.avoidLeadingId || ""));
  if (avoid && ordered.length > 1) {
    const firstBase = baseFeedId(String(ordered[0]?.id || ""));
    if (firstBase && firstBase === avoid) {
      ordered = [...ordered.slice(1), ordered[0]];
    }
  }

  return ordered.map((row) => {
    const base = baseFeedId(String(row?.id || "")) || String(row?.id || "");
    return {
      ...row,
      homeFeedRecycleKey: `${base}:cycle:${cycle}`,
      homeFeedRecycleCycle: cycle,
    };
  });
}
