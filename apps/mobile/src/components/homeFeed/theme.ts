/** Deep navy-black canvas — subtle tint, not pure black. */
export const HOME_FEED_BG = "#03050C";

export const HOME_FEED_GOLD = "#C9A962";
export const HOME_FEED_GOLD_SOFT = "#E2C27A";
export const HOME_FEED_GOLD_GLOW = "rgba(201,169,98,0.55)";
export const HOME_FEED_MUTED = "rgba(255,255,255,0.55)";
export const HOME_FEED_INACTIVE = "rgba(255,255,255,0.38)";
export const HOME_FEED_BORDER = "rgba(255,255,255,0.06)";

/** Subtle inner-card surface only — not for tab bar or header. */
export const HOME_FEED_GLASS_BG = "rgba(255,255,255,0.045)";
export const HOME_FEED_GLASS_BORDER = "rgba(255,255,255,0.08)";
export const HOME_FEED_GLASS_GOLD_BORDER = "rgba(201,169,98,0.22)";
export const HOME_FEED_CARD_BORDER = "rgba(201,169,98,0.14)";

export const HOME_FEED_THUMB_RADIUS = 18;
export const HOME_FEED_CARD_RADIUS = 20;

/** Tab bar height in tab layout (reserve above home indicator). */
export const HOME_FEED_TAB_BAR_HEIGHT = 70;

/** Fixed Home top bar body (single title + action row), excluding safe-area inset. */
export const HOME_FEED_TOP_BAR_BODY_HEIGHT = 52;

export function homeFeedTopBarTotalHeight(insetTop = 0) {
  return HOME_FEED_TOP_BAR_BODY_HEIGHT + Math.max(insetTop, 0);
}

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
