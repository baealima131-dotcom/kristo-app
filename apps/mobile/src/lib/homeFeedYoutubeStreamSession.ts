import { homeFeedRowKey } from "@/src/components/homeFeed/homeFeedPagination";
import { stableMergeHomeFeedRows, dedupeHomeFeedRowsByKey } from "@/src/components/homeFeed/homeFeedPagination";
import { shouldHardRefreshHomeFeed } from "@/src/lib/homeFeedRefreshReason";
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

export function hasHomeFeedYoutubeStreamSession(): boolean {
  return isHomeFeedYouTubeStyleVideo() && session.rows.length > 0;
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
  const nextRefreshAvailable =
    patch.refreshAvailable !== undefined ? patch.refreshAvailable : session.refreshAvailable;
  const nextScrollY = normalizeHomeFeedSessionScrollY(patch.scrollY);
  session = {
    ...session,
    ...patch,
    rows: patch.rows !== undefined ? dedupeHomeFeedRowsByKey(patch.rows) : session.rows,
    scrollY: nextScrollY !== undefined ? nextScrollY : session.scrollY,
    refreshAvailable: nextRefreshAvailable,
    pendingPage0Rows:
      patch.pendingPage0Rows !== undefined ? patch.pendingPage0Rows : session.pendingPage0Rows,
  };
  if (patch.refreshAvailable !== undefined) {
    notifyRefreshListeners();
  }
}

export function replaceHomeFeedYoutubeStreamRows(rows: any[]): void {
  const deduped = dedupeHomeFeedRowsByKey(rows);
  saveHomeFeedYoutubeStreamSession({
    rows: deduped,
    loadedPageCount: deduped.length > 0 ? Math.max(session.loadedPageCount, 1) : 0,
  });
}

export function appendHomeFeedYoutubeStreamRows(incoming: any[]): number {
  if (!incoming.length) return 0;
  const result = stableMergeHomeFeedRows(session.rows, incoming);
  if (result.appended <= 0) return 0;
  saveHomeFeedYoutubeStreamSession({ rows: result.merged });
  return result.appended;
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
export function shouldReplaceHomeFeedYoutubeStreamUi(reason: string, force?: boolean): boolean {
  if (!hasHomeFeedYoutubeStreamSession()) return true;
  if (force) return true;
  const r = String(reason || "").trim();
  if (
    r.includes("pull-refresh") ||
    r.includes("post-create") ||
    r.includes("new-post") ||
    r === "local-post-created" ||
    r === "user-refresh" ||
    r === "first-install" ||
    r === "cold-start-rotate"
  ) {
    return true;
  }
  return shouldHardRefreshHomeFeed(reason, force);
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
  console.log("KRISTO_HOME_FEED_SESSION_RESTORED", {
    rowCount: session.rows.length,
    loadedPages: session.loadedPageCount,
    nextCursor: session.nextCursor,
    scrollOffset: session.scrollY,
    activeIndex: session.activeIndex,
    source,
  });
}
