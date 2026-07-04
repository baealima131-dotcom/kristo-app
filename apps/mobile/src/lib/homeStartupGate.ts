/** Leaf module: Home tab focus + first-paint timestamps. No imports from firstPaint or deferred startup. */

let homeTabFocused = true;
let homeFeedFirstPaintReadyAt: number | null = null;
const homeFeedFirstPaintListeners = new Set<() => void>();

export function isHomeTabFocused() {
  return homeTabFocused;
}

export function setHomeTabFocused(focused: boolean) {
  homeTabFocused = focused;
}

export function markHomeFeedFirstPaintReady() {
  if (homeFeedFirstPaintReadyAt != null) return;
  homeFeedFirstPaintReadyAt = Date.now();
  for (const listener of [...homeFeedFirstPaintListeners]) {
    try {
      listener();
    } catch {}
  }
}

export function getHomeFeedFirstPaintReadyAt() {
  return homeFeedFirstPaintReadyAt;
}

export function subscribeHomeFeedFirstPaintReady(listener: () => void) {
  homeFeedFirstPaintListeners.add(listener);
  return () => {
    homeFeedFirstPaintListeners.delete(listener);
  };
}

export function resetHomeFeedFirstPaintReady() {
  homeFeedFirstPaintReadyAt = null;
  homeFeedFirstPaintListeners.clear();
}
