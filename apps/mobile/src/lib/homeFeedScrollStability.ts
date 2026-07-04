import { shouldHardRefreshHomeFeed } from "@/src/lib/homeFeedRefreshReason";
import {
  hasHomeFeedYoutubeStreamSession,
  shouldReplaceHomeFeedYoutubeStreamUi,
} from "@/src/lib/homeFeedYoutubeStreamSession";
import { isHomeFeedYouTubeStyleVideo } from "@/src/lib/homeFeedVideoMode";

const SCROLL_IDLE_MS = 800;
const BACKGROUND_WORK_MAX_WAIT_MS = 20_000;

let orderFrozen = false;
let frozenRows: any[] = [];
let userScrolling = false;
let homeFeedIdle = false;
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
const idleListeners = new Set<() => void>();

export function isHomeFeedScrollStabilityEnabled(): boolean {
  return isHomeFeedYouTubeStyleVideo();
}

export function freezeHomeFeedDisplayOrder(rows: any[]): void {
  if (!isHomeFeedScrollStabilityEnabled()) return;
  if (!rows.length) return;
  orderFrozen = true;
  frozenRows = rows;
}

export function getFrozenHomeFeedDisplayRows(): any[] {
  return frozenRows;
}

export function isHomeFeedDisplayOrderFrozen(): boolean {
  return isHomeFeedScrollStabilityEnabled() && orderFrozen && frozenRows.length > 0;
}

export function unfreezeHomeFeedDisplayOrder(): void {
  orderFrozen = false;
  frozenRows = [];
}

export function notifyHomeFeedUserScrollActivity(): void {
  if (!isHomeFeedScrollStabilityEnabled()) return;
  userScrolling = true;
  homeFeedIdle = false;
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => {
    userScrolling = false;
    homeFeedIdle = true;
    scrollIdleTimer = null;
    for (const listener of [...idleListeners]) {
      try {
        listener();
      } catch {}
    }
  }, SCROLL_IDLE_MS);
}

export function markHomeFeedReadyForBackgroundWork(): void {
  if (!isHomeFeedScrollStabilityEnabled()) return;
  homeFeedIdle = true;
  for (const listener of [...idleListeners]) {
    try {
      listener();
    } catch {}
  }
}

export function isHomeFeedUserScrolling(): boolean {
  return isHomeFeedScrollStabilityEnabled() && userScrolling;
}

export function isHomeFeedIdleForBackgroundWork(): boolean {
  if (!isHomeFeedScrollStabilityEnabled()) return true;
  return homeFeedIdle && !userScrolling;
}

export function shouldDeferHomeFeedBackgroundWork(): boolean {
  if (!isHomeFeedScrollStabilityEnabled()) return false;
  return userScrolling || !homeFeedIdle;
}

/** Visible FlatList data: cold start, forced reload, or before first freeze only. */
export function shouldApplyHomeFeedVisibleRowUpdate(reason: string, force?: boolean): boolean {
  if (!isHomeFeedScrollStabilityEnabled()) return true;
  if (force || shouldHardRefreshHomeFeed(reason, force)) return true;

  const r = String(reason || "").trim();
  if (hasHomeFeedYoutubeStreamSession()) {
    if (!shouldReplaceHomeFeedYoutubeStreamUi(reason, force)) return false;
    return true;
  }

  if (!orderFrozen) {
    return r === "load" || r === "focus" || r === "required";
  }
  return false;
}

export function runWhenHomeFeedIdle(fn: () => void, opts?: { maxWaitMs?: number }): void {
  if (!isHomeFeedScrollStabilityEnabled() || isHomeFeedIdleForBackgroundWork()) {
    fn();
    return;
  }

  let done = false;
  const runOnce = () => {
    if (done) return;
    if (!isHomeFeedIdleForBackgroundWork()) return;
    done = true;
    idleListeners.delete(runOnce);
    fn();
  };

  idleListeners.add(runOnce);
  const maxWaitMs = Math.max(1000, opts?.maxWaitMs ?? BACKGROUND_WORK_MAX_WAIT_MS);
  setTimeout(() => {
    if (done) return;
    done = true;
    idleListeners.delete(runOnce);
    homeFeedIdle = true;
    userScrolling = false;
    fn();
  }, maxWaitMs);
}
