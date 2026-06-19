import { InteractionManager } from "react-native";

let moreTabFocused = false;
let moreTabPressTransitionBlocking = false;
let moreTabPressTransitionStartedAt = 0;
let moreTabShellVisible = false;
let moreTabFirstPaintLogged = false;
let moreTabPressTransitionEndTimer: ReturnType<typeof setTimeout> | null = null;

const MORE_TAB_PRESS_BLOCK_MS = 1500;
const moreTabTransitionListeners = new Set<() => void>();

function notifyMoreTabTransition() {
  for (const listener of moreTabTransitionListeners) {
    listener();
  }
}

function scheduleMoreTabPressTransitionEnd() {
  if (moreTabPressTransitionEndTimer) clearTimeout(moreTabPressTransitionEndTimer);
  moreTabPressTransitionEndTimer = setTimeout(() => {
    moreTabPressTransitionBlocking = false;
    moreTabPressTransitionEndTimer = null;
    moreTabShellVisible = false;
    notifyMoreTabTransition();
  }, MORE_TAB_PRESS_BLOCK_MS);
}

export function clearMoreTabPressTransitionTimer() {
  if (moreTabPressTransitionEndTimer) {
    clearTimeout(moreTabPressTransitionEndTimer);
    moreTabPressTransitionEndTimer = null;
  }
}

export function subscribeMoreTabTransition(listener: () => void) {
  moreTabTransitionListeners.add(listener);
  return () => {
    moreTabTransitionListeners.delete(listener);
  };
}

export function isMoreTabShellVisible() {
  return moreTabShellVisible;
}

export function hideMoreTabShell() {
  if (!moreTabShellVisible) return;
  moreTabShellVisible = false;
  notifyMoreTabTransition();
}

export function beginMoreTabPressTransition() {
  console.log("KRISTO_MORE_TAB_PRESS");
  moreTabPressTransitionBlocking = true;
  moreTabPressTransitionStartedAt = Date.now();
  moreTabFocused = true;
  moreTabShellVisible = true;
  notifyMoreTabTransition();
  console.log("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK");
  if (!moreTabFirstPaintLogged) {
    moreTabFirstPaintLogged = true;
    console.log("KRISTO_MORE_FIRST_PAINT");
  }
  scheduleMoreTabPressTransitionEnd();
}

export function isMoreTabTransitionBlocking() {
  return moreTabPressTransitionBlocking;
}

export function endMoreTabPressTransition() {
  moreTabPressTransitionBlocking = false;
  moreTabFocused = false;
  moreTabShellVisible = false;
  moreTabFirstPaintLogged = false;
  moreTabPressTransitionStartedAt = 0;
  clearMoreTabPressTransitionTimer();
  notifyMoreTabTransition();
}

export function getMoreTabTransitionBlockRemainingMs() {
  if (!moreTabPressTransitionBlocking) return 0;
  return Math.max(
    0,
    MORE_TAB_PRESS_BLOCK_MS - (Date.now() - moreTabPressTransitionStartedAt)
  );
}

export function runAfterMoreTabPressTransition(task: () => void | Promise<void>) {
  const waitMs = getMoreTabTransitionBlockRemainingMs();
  const run = () => {
    requestAnimationFrame(() => {
      InteractionManager.runAfterInteractions(() => {
        void task();
      });
    });
  };
  if (waitMs <= 0) {
    run();
    return;
  }
  setTimeout(run, waitMs);
}

export function logMoreDeferredRefreshSkip(
  scope: string,
  reason: string,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_MORE_DEFERRED_REFRESH_SKIP", {
    scope,
    reason,
    ...(extra || {}),
  });
}

export function logMoreDeferredRefreshStart(
  scope: string,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_MORE_DEFERRED_REFRESH_START", {
    scope,
    ...(extra || {}),
  });
}
