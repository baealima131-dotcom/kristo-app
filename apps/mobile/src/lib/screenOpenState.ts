type ScreenSessionState = {
  hasFirstPainted: boolean;
  lastOpenedAt: number;
  lastBackgroundRefreshAt: number;
  lastFocusRefreshAt: number;
};

const screenStates = new Map<string, ScreenSessionState>();
const sessionDataByScreen = new Map<string, unknown>();

function getState(screen: string): ScreenSessionState {
  let state = screenStates.get(screen);
  if (!state) {
    state = {
      hasFirstPainted: false,
      lastOpenedAt: 0,
      lastBackgroundRefreshAt: 0,
      lastFocusRefreshAt: 0,
    };
    screenStates.set(screen, state);
  }
  return state;
}

export function markScreenFirstPainted(screen: string) {
  const state = getState(screen);
  if (state.hasFirstPainted) return;
  state.hasFirstPainted = true;
  state.lastOpenedAt = Date.now();
}

export function hasScreenFirstPainted(screen: string) {
  return getState(screen).hasFirstPainted;
}

export function markScreenBackgroundRefresh(screen: string) {
  const state = getState(screen);
  state.lastBackgroundRefreshAt = Date.now();
}

export function markScreenFocusRefresh(screen: string) {
  const state = getState(screen);
  state.lastFocusRefreshAt = Date.now();
}

export function shouldSkipFocusRefresh(screen: string, minMs: number) {
  if (!hasScreenFirstPainted(screen)) return false;
  const state = getState(screen);
  const anchor = Math.max(state.lastFocusRefreshAt, state.lastBackgroundRefreshAt, state.lastOpenedAt);
  return Date.now() - anchor < minMs;
}

export function shouldBlockVisibleLoading(screen: string, hasVisibleData: boolean) {
  if (!hasVisibleData || !hasScreenFirstPainted(screen)) return false;
  console.log("KRISTO_VISIBLE_LOADING_BLOCKED", {
    screen,
    reason: "has-first-paint-data",
  });
  return true;
}

export function logScreenReopenFastPath(screen: string, reason: string) {
  console.log("KRISTO_SCREEN_REOPEN_FAST_PATH", { screen, reason });
}

export function logScreenBackgroundRefresh(screen: string, reason: string) {
  console.log("KRISTO_SCREEN_BACKGROUND_REFRESH", { screen, reason });
}

export function peekScreenSessionData<T>(screen: string): T | null {
  const value = sessionDataByScreen.get(screen);
  return (value as T) || null;
}

export function saveScreenSessionData<T>(screen: string, data: T) {
  sessionDataByScreen.set(screen, data);
}
