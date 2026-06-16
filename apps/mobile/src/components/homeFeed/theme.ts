export const HOME_FEED_BG = "#03050C";
export const HOME_FEED_GOLD = "#D9B35F";
export const HOME_FEED_GOLD_SOFT = "#F4D06F";
export const HOME_FEED_MUTED = "rgba(255,255,255,0.68)";
export const HOME_FEED_BORDER = "rgba(255,255,255,0.10)";

/** Tab bar height in tab layout (reserve above home indicator). */
export const HOME_FEED_TAB_BAR_HEIGHT = 70;

/** Base offsets inside each feed slide; add safe-area bottom in components. */
export const HOME_FEED_META_BOTTOM_BASE = 34;
export const HOME_FEED_ACTION_BOTTOM_BASE = 26;

export function homeFeedSafeBottom(insetBottom = 0) {
  return Math.max(insetBottom, 10);
}

/** Overlay-only offsets (avatar, actions). Do not use for slide/page height. */
export function homeFeedChromeOffsets(insetBottom = 0) {
  const safeBottom = homeFeedSafeBottom(insetBottom);
  return {
    metaBottom: HOME_FEED_META_BOTTOM_BASE + safeBottom,
    actionBottom: HOME_FEED_ACTION_BOTTOM_BASE + safeBottom,
  };
}

/**
 * One full-bleed feed row: window height minus tab bar reserve only.
 * Pass `useBottomTabBarHeight()` when available; falls back to layout constant (70).
 */
export function homeFeedSlideHeight(
  windowHeight: number,
  tabBarHeight = HOME_FEED_TAB_BAR_HEIGHT
) {
  const reserve = Math.max(0, Number(tabBarHeight) || HOME_FEED_TAB_BAR_HEIGHT);
  return Math.max(320, windowHeight - reserve);
}
