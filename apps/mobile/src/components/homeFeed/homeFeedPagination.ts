import { feedRenderKey } from "./homeFeedUtils";

/** First paint window — TikTok-style fast initial load. */
export const HOME_FEED_INITIAL_LIMIT = 20;

/** Grow visible window by this many rows per prefetch. */
export const HOME_FEED_PAGE_SIZE = 15;

/** Prefetch when activeIndex reaches this row (near end of first page). */
export const HOME_FEED_NEXT_PAGE_THRESHOLD = 15;

/** Expand window when within this many rows of the visible tail. */
export const HOME_FEED_PREFETCH_LEAD = 5;

export function homeFeedRowKey(row: any): string {
  return feedRenderKey(row) || String(row?.id || "").trim();
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
    merged.push(fresh ? { ...row, ...fresh, id: row.id ?? fresh.id } : row);
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
