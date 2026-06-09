import { markHomeFeedActiveFirstFrame } from "@/src/lib/homeFeedVideoReadiness";
import { markHomeFeedFirstPlaying, markHomeFirstVideoReady } from "@/src/lib/firstPaint";

/**
 * Single owner/controller for Home Feed video playback (TikTok-style).
 *
 * Contract (the whole point of the rebuild):
 *  - Exactly ONE video is "active" at a time and is the ONLY player allowed to
 *    call play().
 *  - Every non-active player is paused + muted (no hidden/background playback,
 *    no currentTime advance).
 *  - Preload rows are buffered but PAUSED — they never call play(), so they
 *    never advance currentTime.
 *
 * The React player (HomeFeedVideoPlayer) is intentionally thin: it registers a
 * handle here and reports intent ("I am the active row" / "I am no longer
 * active" / "I painted my first frame"). This module is the single source of
 * truth and the single place that silences everyone else.
 *
 * Public functions whose NAMES match the legacy controller are re-exported from
 * homeFeedVideoController in Stage 4 so live-room and HomeFeedScreen keep
 * working without edits.
 */

export type HomeFeedPlayerHandle = {
  /** recycleKey || postId — unique per mounted row. */
  key: string;
  postId: string;
  index: number;
  play: () => void;
  pause: () => void;
  setMuted: (muted: boolean) => void;
};

const registry = new Map<string, HomeFeedPlayerHandle>();
let activeKey: string | null = null;

// Recovery hand-off used by live-room exit (compat surface).
let pendingRecoveryReason: string | null = null;
const recoveryListeners = new Set<() => void>();

function silence(handle: HomeFeedPlayerHandle | undefined) {
  if (!handle) return;
  try {
    handle.pause();
  } catch {}
  try {
    handle.setMuted(true);
  } catch {}
}

function logPausedInactive(handle: HomeFeedPlayerHandle | undefined, reason: string) {
  if (!handle) return;
  console.log("KRISTO_VIDEO_PAUSED_INACTIVE", {
    key: handle.key,
    postId: handle.postId,
    reason,
  });
}

export function registerHomeFeedPlayer(handle: HomeFeedPlayerHandle): void {
  registry.set(handle.key, handle);
  // Newly mounted players must never start hot: only the active row may play.
  if (handle.key !== activeKey) {
    silence(handle);
  }
}

export function unregisterHomeFeedPlayer(key: string): void {
  const handle = registry.get(key);
  silence(handle);
  registry.delete(key);
  if (activeKey === key) {
    activeKey = null;
  }
}

export function getActiveHomeFeedVideoKey(): string | null {
  return activeKey;
}

/** Legacy-compatible: callers outside the feed expect the active POST id. */
export function getActiveHomeFeedVideoId(): string | null {
  if (!activeKey) return null;
  return registry.get(activeKey)?.postId ?? null;
}

/**
 * Promote `key` to the single active video. Pauses + mutes every other player
 * and emits KRISTO_VIDEO_ACTIVE_CHANGED. Does NOT call play() on the new active
 * player — the player itself starts playback (muted until its first frame) so
 * audio policy stays in one place. We only guarantee single-ownership here.
 */
export function setActiveHomeFeedVideo(
  key: string,
  meta: { postId: string; index: number }
): void {
  if (activeKey === key) return;

  const prevKey = activeKey;
  activeKey = key;

  if (prevKey && prevKey !== key) {
    const prev = registry.get(prevKey);
    silence(prev);
    logPausedInactive(prev, "active-changed");
  }

  // Defensive: silence any stray player that isn't the new active row.
  registry.forEach((handle, k) => {
    if (k === key || k === prevKey) return;
    silence(handle);
  });

  console.log("KRISTO_VIDEO_ACTIVE_CHANGED", {
    key,
    postId: meta.postId,
    index: meta.index,
    prevKey: prevKey ?? null,
  });
}

/** Release active ownership for `key` (e.g. it scrolled off / lost focus). */
export function clearActiveHomeFeedVideo(key: string, reason = "cleared"): void {
  if (activeKey !== key) return;
  const handle = registry.get(key);
  silence(handle);
  logPausedInactive(handle, reason);
  activeKey = null;
}

/**
 * The active player painted its first real frame. Opens the background-warm gate
 * and resolves the cross-app "home first video ready" promise so deferred
 * startup work (church/media preload, etc.) can run.
 */
export function markHomeFeedVideoFirstFrame(
  key: string,
  meta: { postId: string; msFromMount?: number | null }
): void {
  console.log("KRISTO_VIDEO_FIRST_FRAME", {
    key,
    postId: meta.postId,
    msFromMount: meta.msFromMount ?? null,
    isActive: activeKey === key,
  });
  markHomeFeedActiveFirstFrame();
  markHomeFirstVideoReady("first-frame");
  markHomeFeedFirstPlaying("home-feed-video-first-frame", { postId: meta.postId });
}

/**
 * Compat no-op: legacy callers "bumped" ownership to a post id before recovery.
 * In the owner model the active row is asserted by the player's own effect (and
 * by recoverHomeFeedPlaybackAfterLiveExit), so this no longer needs to mutate
 * state. Kept so HomeFeedScreen stays unchanged.
 */
export function bumpHomeFeedVideoOwnership(_postId: string): void {}

/** Pause + mute every player and drop active ownership (live-room open, blur, etc.). */
export function pauseAllHomeFeedVideos(meta: { reason?: string } = {}): void {
  const reason = meta.reason || "pause-all";
  registry.forEach((handle) => {
    silence(handle);
    logPausedInactive(handle, reason);
  });
  activeKey = null;
}

// ---------------------------------------------------------------------------
// Live-room exit recovery (compat surface — names match the legacy controller).
// ---------------------------------------------------------------------------

export function markHomeFeedVideoNeedsRecovery(reason: string): void {
  pendingRecoveryReason = String(reason || "unknown").trim() || "unknown";
  console.log("KRISTO_LIVE_ROOM_EXIT_VIDEO_RECOVERY_MARKED", {
    reason: pendingRecoveryReason,
  });
  recoveryListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

export function peekHomeFeedVideoRecovery(): string | null {
  return pendingRecoveryReason;
}

export function consumeHomeFeedVideoRecovery(): string | null {
  const reason = pendingRecoveryReason;
  pendingRecoveryReason = null;
  return reason;
}

export function subscribeHomeFeedVideoRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener);
  return () => {
    recoveryListeners.delete(listener);
  };
}

/**
 * Re-assert playback on the active row after returning from a live room. The
 * normal active-row effect usually handles this on refocus; this is the explicit
 * hook HomeFeedScreen calls. Returns true when a matching player was found.
 */
export function recoverHomeFeedPlaybackAfterLiveExit(
  meta: { postId?: string; reason?: string; [key: string]: unknown } = {}
): boolean {
  const targetPostId = String(meta.postId || getActiveHomeFeedVideoId() || "").trim();
  const reason = String(meta.reason || "live-room-exit").trim();

  if (!targetPostId) {
    console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_SKIPPED", { reason, why: "no-post-id" });
    return false;
  }

  let target: HomeFeedPlayerHandle | undefined;
  registry.forEach((handle) => {
    if (!target && handle.postId === targetPostId) target = handle;
  });

  if (!target) {
    console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_SKIPPED", {
      postId: targetPostId,
      reason,
      why: "not-registered",
    });
    return false;
  }

  setActiveHomeFeedVideo(target.key, { postId: target.postId, index: target.index });
  try {
    target.setMuted(false);
    target.play();
  } catch {}

  console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_ACTIVE", { postId: targetPostId, reason });
  return true;
}

/** Test/diagnostic helper: reset all owner state. */
export function __resetHomeFeedVideoOwnerForTest(): void {
  registry.clear();
  activeKey = null;
  pendingRecoveryReason = null;
  recoveryListeners.clear();
}
