import { InteractionManager } from "react-native";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";

const loggedScreens = new Set<string>();

const HOME_STARTUP_DEFER_MS = 3000;
const HOME_WARMUP_DELAY_MS = 1500;
const HOME_FIRST_FRAME_MAX_WAIT_MS = 8000;
const HOME_FIRST_VIDEO_MAX_WAIT_MS = 8000;

export function logFirstPaintReady(screen: string, extra?: Record<string, unknown>) {
  if (loggedScreens.has(screen)) return;
  loggedScreens.add(screen);
  console.log("KRISTO_FIRST_PAINT_READY", {
    screen,
    ...(extra || {}),
  });
}

/** Run work after interactions settle — does not block screen mount. */
export function runAfterFirstPaint(task: () => void, delayMs = 1200) {
  InteractionManager.runAfterInteractions(() => {
    if (delayMs <= 0) {
      task();
      return;
    }
    setTimeout(task, delayMs);
  });
}

export function deferNonCriticalRefresh(task: () => void | Promise<void>, delayMs = 2200) {
  runAfterFirstPaint(() => {
    void task();
  }, delayMs);
}

let homeFirstFrameReady = false;
let homeFirstFrameTimeout: ReturnType<typeof setTimeout> | null = null;
const homeFirstFrameWaiters = new Set<() => void>();

let homeMountAtMs: number | null = null;
let homeActiveFirstFrameAtMs: number | null = null;
let homeWarmupGateLogged = false;
const homeWarmupGateListeners = new Set<() => void>();

let homeStartupPriorityStartedAtMs: number | null = null;

export function beginHomeFirstVideoPriorityMode(source = "home-feed") {
  if (homeStartupPriorityStartedAtMs != null) return;
  homeStartupPriorityStartedAtMs = Date.now();
  console.log("KRISTO_FIRST_VIDEO_PRIORITY_MODE", {
    source,
    startedAtMs: homeStartupPriorityStartedAtMs,
    warmupDelayMs: HOME_WARMUP_DELAY_MS,
    startupDeferMs: HOME_STARTUP_DEFER_MS,
  });
}

export function resetHomeFirstFrame() {
  homeFirstFrameReady = false;
  if (homeFirstFrameTimeout) {
    clearTimeout(homeFirstFrameTimeout);
    homeFirstFrameTimeout = null;
  }
  homeFirstFrameWaiters.clear();
}

export function markHomeFirstFrame(extra?: Record<string, unknown>) {
  if (homeFirstFrameReady) return;
  homeFirstFrameReady = true;
  logFirstPaintReady("HomeFeed", extra);
  for (const resolve of homeFirstFrameWaiters) {
    resolve();
  }
  homeFirstFrameWaiters.clear();
  if (homeFirstFrameTimeout) {
    clearTimeout(homeFirstFrameTimeout);
    homeFirstFrameTimeout = null;
  }
}

function ensureHomeFirstFrameTimeout() {
  if (homeFirstFrameTimeout || homeFirstFrameReady) return;
  homeFirstFrameTimeout = setTimeout(() => {
    homeFirstFrameTimeout = null;
    markHomeFirstFrame({ reason: "timeout" });
  }, HOME_FIRST_FRAME_MAX_WAIT_MS);
}

export function waitForHomeFirstFrame(): Promise<void> {
  if (homeFirstFrameReady) {
    return Promise.resolve();
  }
  ensureHomeFirstFrameTimeout();
  return new Promise((resolve) => {
    homeFirstFrameWaiters.add(resolve);
  });
}

export type StartupDeferredWorkOptions = {
  reason: string;
  delayMs?: number;
};

/** Delay non-critical startup work until Home first frame + 2–4s. */
export function deferStartupWorkAfterHomeFirstFrame(
  task: () => void | Promise<void>,
  opts: StartupDeferredWorkOptions
) {
  const delayMs = Math.max(0, Number(opts.delayMs ?? HOME_STARTUP_DEFER_MS));
  void (async () => {
    await waitForHomeFirstFrame();
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_STARTUP_DEFERRED_WORK", {
        reason: opts.reason,
        delayMs,
        homeFirstFrameReady,
      });
    }
    await task();
  })();
}

export function resetHomeWarmupGate() {
  homeMountAtMs = null;
  homeActiveFirstFrameAtMs = null;
  homeWarmupGateLogged = false;
}

export function markHomeMount() {
  homeMountAtMs = Date.now();
}

export function resetHomeActiveFirstFrame() {
  homeActiveFirstFrameAtMs = null;
}

function notifyHomeWarmupGateListeners() {
  for (const listener of homeWarmupGateListeners) {
    listener();
  }
}

export function subscribeHomeWarmupGate(listener: () => void) {
  homeWarmupGateListeners.add(listener);
  return () => {
    homeWarmupGateListeners.delete(listener);
  };
}

export function isHomeWarmupMountAllowed() {
  if (!isHomeTabFocused()) return true;
  if (homeActiveFirstFrameAtMs != null) return true;
  const mountAt = homeMountAtMs ?? Date.now();
  return Date.now() - mountAt >= HOME_WARMUP_DELAY_MS;
}

export function markHomeActiveFirstFrame(extra?: Record<string, unknown>) {
  if (homeActiveFirstFrameAtMs != null) return;
  homeActiveFirstFrameAtMs = Date.now();
  if (!homeWarmupGateLogged) {
    homeWarmupGateLogged = true;
    console.log("KRISTO_WARMUP_DELAYED_UNTIL_FIRST_FRAME", {
      reason: "active-first-frame",
      msSinceMount:
        homeMountAtMs != null ? homeActiveFirstFrameAtMs - homeMountAtMs : null,
      ...(extra || {}),
    });
  }
  notifyHomeWarmupGateListeners();
}

export function logHomeWarmupDelayTimeout() {
  if (homeWarmupGateLogged) return;
  homeWarmupGateLogged = true;
  console.log("KRISTO_WARMUP_DELAYED_UNTIL_FIRST_FRAME", {
    reason: "timeout-1500ms",
    msSinceMount:
      homeMountAtMs != null ? Date.now() - homeMountAtMs : HOME_WARMUP_DELAY_MS,
  });
  notifyHomeWarmupGateListeners();
}

export function isHomeTabFocused() {
  return Boolean((globalThis as any).__KRISTO_HOME_TAB_FOCUSED__);
}

export function setHomeTabFocused(focused: boolean) {
  (globalThis as any).__KRISTO_HOME_TAB_FOCUSED__ = focused;
}

let homeFirstVideoTimeout: ReturnType<typeof setTimeout> | null = null;
const homeFirstVideoWaiters = new Set<() => void>();

export function isHomeFirstVideoReady() {
  return Boolean((globalThis as any).__KRISTO_HOME_FIRST_VIDEO_READY__);
}

export function resetHomeFirstVideoReady() {
  (globalThis as any).__KRISTO_HOME_FIRST_VIDEO_READY__ = false;
  if (homeFirstVideoTimeout) {
    clearTimeout(homeFirstVideoTimeout);
    homeFirstVideoTimeout = null;
  }
  homeFirstVideoWaiters.clear();
}

let homeFeedFirstPlayingReached = false;
let homeFeedFirstPlayingListener: ((extra?: Record<string, unknown>) => void) | null = null;

export function resetHomeFeedFirstPlaying() {
  homeFeedFirstPlayingReached = false;
}

export function isHomeFeedFirstPlayingReached() {
  return homeFeedFirstPlayingReached;
}

export function subscribeHomeFeedFirstPlaying(
  listener: (extra?: Record<string, unknown>) => void
) {
  homeFeedFirstPlayingListener = listener;
  return () => {
    if (homeFeedFirstPlayingListener === listener) {
      homeFeedFirstPlayingListener = null;
    }
  };
}

let lastHomeFeedFirstPlayingExtra: Record<string, unknown> | null = null;

export function getLastHomeFeedFirstPlayingExtra() {
  return lastHomeFeedFirstPlayingExtra;
}

export function markHomeFeedFirstPlaying(reason = "first-playing", extra?: Record<string, unknown>) {
  if (homeFeedFirstPlayingReached) return;
  homeFeedFirstPlayingReached = true;
  lastHomeFeedFirstPlayingExtra = extra || null;
  console.log("KRISTO_HOME_FEED_FIRST_PLAYING_REACHED", { reason, ...(extra || {}) });
  homeFeedFirstPlayingListener?.(lastHomeFeedFirstPlayingExtra || undefined);
}

export function markHomeFirstVideoReady(reason = "ready") {
  if (isHomeFirstVideoReady()) return;
  (globalThis as any).__KRISTO_HOME_FIRST_VIDEO_READY__ = true;
  if (__DEV__) {
    console.log("KRISTO_HOME_FIRST_VIDEO_READY", { reason });
  }
  for (const resolve of homeFirstVideoWaiters) {
    resolve();
  }
  homeFirstVideoWaiters.clear();
  if (homeFirstVideoTimeout) {
    clearTimeout(homeFirstVideoTimeout);
    homeFirstVideoTimeout = null;
  }
}

function ensureHomeFirstVideoTimeout() {
  if (homeFirstVideoTimeout || isHomeFirstVideoReady()) return;
  homeFirstVideoTimeout = setTimeout(() => {
    homeFirstVideoTimeout = null;
    markHomeFirstVideoReady("timeout");
  }, HOME_FIRST_VIDEO_MAX_WAIT_MS);
}

/** Defer Church/overview/media preload while Home first video starts; max 8s wait. */
export function waitForHomeFirstVideoReadyIfOnHome(): Promise<void> {
  if (!isHomeTabFocused() || isHomeFirstVideoReady()) {
    return Promise.resolve();
  }
  ensureHomeFirstVideoTimeout();
  return new Promise((resolve) => {
    homeFirstVideoWaiters.add(resolve);
  });
}
