import { InteractionManager } from "react-native";
import { decideMoreTabBarPress } from "./moreTabPressPolicy";

export {
  isMoreNestedRoute,
  isMoreRootRoute,
  isMoreTopLevelTabActive,
} from "./moreTabPressPolicy";

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

/**
 * More tab bar press:
 * - other tab → More: transition + navigate
 * - More root → More: no-op
 * - nested More → More root: replace without transition/blackout
 */
export function handleMoreTabBarPress(args: {
  segments: readonly string[] | null | undefined;
  preventDefault?: () => void;
  navigateToMore: () => void;
}): "enter-more" | "stay-more-root" | "return-more-root" {
  const decision = decideMoreTabBarPress(args.segments);

  if (decision === "stay-more-root") {
    args.preventDefault?.();
    console.log("KRISTO_MORE_TAB_RESELECT_IGNORED");
    return "stay-more-root";
  }

  if (decision === "return-more-root") {
    args.preventDefault?.();
    console.log("KRISTO_MORE_TAB_RESELECT_RETURN_ROOT");
    // Direct replace — no beginMoreTabPressTransition / shell overlay.
    args.navigateToMore();
    return "return-more-root";
  }

  beginMoreTabPressTransition();
  args.navigateToMore();
  return "enter-more";
}

/** @internal test helper — reset module flags between cases. */
export function __resetMoreTabTransitionForTests() {
  moreTabFocused = false;
  moreTabPressTransitionBlocking = false;
  moreTabPressTransitionStartedAt = 0;
  moreTabShellVisible = false;
  moreTabFirstPaintLogged = false;
  if (moreTabPressTransitionEndTimer) {
    clearTimeout(moreTabPressTransitionEndTimer);
    moreTabPressTransitionEndTimer = null;
  }
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
  if (moreTabPressTransitionEndTimer) {
    clearTimeout(moreTabPressTransitionEndTimer);
    moreTabPressTransitionEndTimer = null;
  }
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
