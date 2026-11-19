import {
  homeFeedRowKey,
  stableMergeHomeFeedRows,
  dedupeHomeFeedRowsByKey,
  shouldSkipHomeFeedRowsStateUpdate,
  refreshHomeFeedRowsPlatformFields,
} from "@/src/components/homeFeed/homeFeedPagination";
import { HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE } from "@/src/components/homeFeed/homeFeedPageCache";
import { isManualHomeFeedRefresh } from "@/src/lib/homeFeedRefreshReason";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { isHomeFeedYouTubeStyleVideo } from "@/src/lib/homeFeedVideoMode";

export type HomeFeedYoutubeStreamSession = {
  rows: any[];
  activeIndex: number;
  scrollY: number;
  nextCursor: string | null;
  hasMore: boolean;
  loadedPageCount: number;
  pageRevealComplete: boolean;
  pageVisualReady: boolean;
  refreshAvailable: boolean;
  pendingPage0Rows: any[] | null;
};

const EMPTY_SESSION: HomeFeedYoutubeStreamSession = {
  rows: [],
  activeIndex: 0,
  scrollY: 0,
  nextCursor: null,
  hasMore: true,
  loadedPageCount: 0,
  pageRevealComplete: false,
  pageVisualReady: false,
  refreshAvailable: false,
  pendingPage0Rows: null,
};

let session: HomeFeedYoutubeStreamSession = { ...EMPTY_SESSION, rows: [] };

const refreshListeners = new Set<(available: boolean) => void>();

export function peekHomeFeedYoutubeStreamSession(): HomeFeedYoutubeStreamSession {
  return session;
}

export function peekHomeFeedYoutubeStreamSessionRows(): any[] {
  if (session.rows.length <= 1) return session.rows;
  const before = session.rows.length;
  const deduped = dedupeHomeFeedRowsByKey(session.rows);
  if (deduped.length !== before) {
    session = { ...session, rows: deduped };
    console.log("KRISTO_HOME_FEED_SESSION_DEDUPED", {
      before,
      after: deduped.length,
      removed: before - deduped.length,
    });
  }
  return session.rows;
}

export function isPartialHomeFeedYoutubeStreamSession(
  snap: Pick<HomeFeedYoutubeStreamSession, "rows" | "hasMore"> = session
): boolean {
  return (
    snap.hasMore === true &&
    snap.rows.length > 0 &&
    snap.rows.length < HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE
  );
}

export function hasHomeFeedYoutubeStreamSession(): boolean {
  return (
    isHomeFeedYouTubeStyleVideo() &&
    session.rows.length > 0 &&
    !isPartialHomeFeedYoutubeStreamSession(session)
  );
}

export function peekHomeFeedYoutubeRefreshAvailable(): boolean {
  return session.refreshAvailable;
}

export function subscribeHomeFeedYoutubeRefreshAvailable(
  listener: (available: boolean) => void
): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

function notifyRefreshListeners() {
  for (const listener of [...refreshListeners]) {
    try {
      listener(session.refreshAvailable);
    } catch {}
  }
}

function normalizeHomeFeedSessionScrollY(scrollY: number | undefined): number | undefined {
  if (scrollY === undefined) return undefined;
  const value = Number(scrollY);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function saveHomeFeedYoutubeStreamSession(
  patch: Partial<HomeFeedYoutubeStreamSession>
): void {
  if (!isHomeFeedYouTubeStyleVideo()) return;
  const prevRowCount = session.rows.length;
  const nextRefreshAvailable =
    patch.refreshAvailable !== undefined ? patch.refreshAvailable : session.refreshAvailable;
  const nextScrollY = normalizeHomeFeedSessionScrollY(patch.scrollY);
  const nextHasMore = patch.hasMore !== undefined ? patch.hasMore : session.hasMore;

  if (patch.rows !== undefined) {
    const dedupedRows = dedupeHomeFeedRowsByKey(patch.rows);
    if (shouldSkipHomeFeedRowsStateUpdate(session.rows, dedupedRows)) {
      console.log("KRISTO_HOME_FEED_SKIP_IDENTICAL_ROWS", {
        reason: "youtube-session-save",
        rowCount: session.rows.length,
      });
      const rowlessPatch = { ...patch };
      delete rowlessPatch.rows;
      if (Object.keys(rowlessPatch).length === 0) return;
      session = {
        ...session,
        ...rowlessPatch,
        rows: session.rows,
        scrollY: nextScrollY !== undefined ? nextScrollY : session.scrollY,
        refreshAvailable: nextRefreshAvailable,
        pendingPage0Rows:
          patch.pendingPage0Rows !== undefined ? patch.pendingPage0Rows : session.pendingPage0Rows,
      };
      if (patch.refreshAvailable !== undefined) {
        notifyRefreshListeners();
      }
      return;
    }
    if (isPartialHomeFeedYoutubeStreamSession({ rows: dedupedRows, hasMore: nextHasMore })) {
      console.log("KRISTO_HOME_FEED_SESSION_PARTIAL_IGNORED", {
        rowCount: dedupedRows.length,
        hasMore: nextHasMore,
        firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
      });
      const rowlessPatch = { ...patch };
      delete rowlessPatch.rows;
      if (Object.keys(rowlessPatch).length === 0) return;
      session = {
        ...session,
        ...rowlessPatch,
        scrollY: nextScrollY !== undefined ? nextScrollY : session.scrollY,
        refreshAvailable: nextRefreshAvailable,
        pendingPage0Rows:
          patch.pendingPage0Rows !== undefined ? patch.pendingPage0Rows : session.pendingPage0Rows,
      };
      if (patch.refreshAvailable !== undefined) {
        notifyRefreshListeners();
      }
      return;
    }
  }

  session = {
    ...session,
    ...patch,
    rows: patch.rows !== undefined ? dedupeHomeFeedRowsByKey(patch.rows) : session.rows,
    scrollY: nextScrollY !== undefined ? nextScrollY : session.scrollY,
    refreshAvailable: nextRefreshAvailable,
    pendingPage0Rows:
      patch.pendingPage0Rows !== undefined ? patch.pendingPage0Rows : session.pendingPage0Rows,
  };
  if (
    patch.rows !== undefined &&
    session.rows.length > 0 &&
    prevRowCount === 0
  ) {
    console.log("KRISTO_HOME_FEED_SESSION_ORDER_CREATED", {
      rowCount: session.rows.length,
      loadedPageCount: session.loadedPageCount,
      nextCursor: session.nextCursor,
      hasMore: session.hasMore,
    });
  }
  if (patch.refreshAvailable !== undefined) {
    notifyRefreshListeners();
  }
}

export function replaceHomeFeedYoutubeStreamRows(rows: any[]): void {
  const deduped = dedupeHomeFeedRowsByKey(rows);
  if (shouldSkipHomeFeedRowsStateUpdate(session.rows, deduped)) {
    console.log("KRISTO_HOME_FEED_SKIP_IDENTICAL_ROWS", {
      reason: "youtube-session-replace",
      rowCount: session.rows.length,
    });
    return;
  }
  saveHomeFeedYoutubeStreamSession({
    rows: deduped,
    loadedPageCount: deduped.length > 0 ? Math.max(session.loadedPageCount, 1) : 0,
  });
}

export function appendHomeFeedYoutubeStreamRows(incoming: any[]): number {
  if (!incoming.length) return 0;
  const before = session.rows.length;
  const result = stableMergeHomeFeedRows(session.rows, incoming);
  if (result.appended <= 0) return 0;
  saveHomeFeedYoutubeStreamSession({ rows: result.merged });
  console.log("KRISTO_HOME_FEED_PAGE_APPEND", {
    before,
    incoming: incoming.length,
    appended: result.appended,
    after: result.merged.length,
    nextCursor: session.nextCursor,
    hasMore: session.hasMore,
    loadedPageCount: session.loadedPageCount,
  });
  return result.appended;
}

const rowsRefreshedListeners = new Set<(fresh: any[], sessionUpdated: number) => void>();

/**
 * Called with fresh server rows after a background refresh, so screens can give rows they
 * already show the new platform counts (same ids, same order). sessionUpdated: rows changed here.
 */
export function subscribeHomeFeedYoutubeStreamRowsRefreshed(
  listener: (fresh: any[], sessionUpdated: number) => void
): () => void {
  rowsRefreshedListeners.add(listener);
  return () => {
    rowsRefreshedListeners.delete(listener);
  };
}

/**
 * Update the platform counts of video links already in the session from fresh server rows.
 * Same ids, same order, nothing appended; only rows whose counts changed get a new object.
 */
export function refreshHomeFeedYoutubeStreamPlatformFields(fresh: any[]): number {
  if (!fresh.length) return 0;
  const current = refreshHomeFeedRowsPlatformFields(session.rows, fresh);
  const pending = session.pendingPage0Rows?.length
    ? refreshHomeFeedRowsPlatformFields(session.pendingPage0Rows, fresh)
    : null;
  if (current.updated || pending?.updated) {
    session = {
      ...session,
      rows: current.rows,
      pendingPage0Rows: pending ? pending.rows : session.pendingPage0Rows,
    };
    console.log("KRISTO_HOME_FEED_PLATFORM_COUNTS_REFRESHED", {
      updated: current.updated,
      pendingUpdated: pending?.updated ?? 0,
      rowCount: session.rows.length,
    });
  }
  for (const listener of [...rowsRefreshedListeners]) {
    try {
      listener(fresh, current.updated);
    } catch {}
  }
  return current.updated;
}

export function removeHomeFeedYoutubeStreamPost(postId: string): boolean {
  const target = String(postId || "").trim();
  if (!target || !session.rows.length) return false;

  const before = session.rows.length;
  const next = session.rows.filter((row) => {
    const rowId = String(row?.id || "").trim();
    if (!rowId) return true;
    if (rowId === target) return false;
    return baseFeedId(rowId) !== baseFeedId(target);
  });

  if (next.length === before) return false;
  saveHomeFeedYoutubeStreamSession({ rows: next });
  return true;
}

export function markHomeFeedYoutubeRefreshAvailable(pendingPage0Rows: any[]): void {
  if (!pendingPage0Rows.length) return;
  saveHomeFeedYoutubeStreamSession({
    refreshAvailable: true,
    pendingPage0Rows,
  });
  console.log("KRISTO_HOME_FEED_REFRESH_AVAILABLE", {
    rowCount: session.rows.length,
    pendingPage0Count: pendingPage0Rows.length,
    currentTopId: homeFeedRowKey(session.rows[0]) || null,
    freshTopId: homeFeedRowKey(pendingPage0Rows[0]) || null,
  });
}

export function clearHomeFeedYoutubeRefreshAvailable(): void {
  if (!session.refreshAvailable && !session.pendingPage0Rows?.length) return;
  saveHomeFeedYoutubeStreamSession({
    refreshAvailable: false,
    pendingPage0Rows: null,
  });
}

export function clearHomeFeedYoutubeStreamSession(): void {
  session = { ...EMPTY_SESSION, rows: [] };
  notifyRefreshListeners();
}

/** UI may replace visible stream rows (cold start or explicit user refresh). */
/**
 * UI may replace visible stream rows: cold start, the viewer's own refresh, or the viewer's own
 * new post. Background refreshes (focus, poll, schedule / claim / live-room syncs — forced or
 * not) never replace the rows of a live session: the posts already shown keep their order and
 * the mix queue is kept (schedule rows are not part of the video stream; a deleted post is
 * removed in place).
 */
export function shouldReplaceHomeFeedYoutubeStreamUi(reason: string, _force?: boolean): boolean {
  if (!hasHomeFeedYoutubeStreamSession()) return true;
  const r = String(reason || "").trim();
  return (
    isManualHomeFeedRefresh(r) ||
    r.includes("post-create") ||
    r.includes("new-post") ||
    r === "local-post-created" ||
    r === "first-install" ||
    r === "cold-start-rotate"
  );
}

/** Background fetch / tab focus must never touch visible rows while session is alive. */
export function shouldBlockHomeFeedYoutubeBackgroundUiMutation(
  reason: string,
  force?: boolean
): boolean {
  if (!hasHomeFeedYoutubeStreamSession()) return false;
  return !shouldReplaceHomeFeedYoutubeStreamUi(reason, force);
}

export function logHomeFeedSessionRestored(source: "mount" | "focus"): void {
  if (!session.rows.length) return;
  console.log("KRISTO_HOME_FEED_SESSION_ORDER_HYDRATED", {
    rowCount: session.rows.length,
    loadedPages: session.loadedPageCount,
    nextCursor: session.nextCursor,
    hasMore: session.hasMore,
    source,
  });
  if (source === "mount") {
    console.log("KRISTO_HOME_FEED_BACK_NAVIGATION_PRESERVED", {
      rowCount: session.rows.length,
      activeIndex: session.activeIndex,
      scrollY: session.scrollY,
      nextCursor: session.nextCursor,
    });
  }
  console.log("KRISTO_HOME_FEED_SESSION_RESTORED", {
    rowCount: session.rows.length,
    loadedPages: session.loadedPageCount,
    nextCursor: session.nextCursor,
    scrollOffset: session.scrollY,
    activeIndex: session.activeIndex,
    source,
  });
}
