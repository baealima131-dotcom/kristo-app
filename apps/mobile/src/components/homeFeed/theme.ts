/** Deep black canvas for Home Feed luxury layout. */
export const HOME_FEED_BG = "#010102";

export const HOME_FEED_GOLD = "#D4AF65";
export const HOME_FEED_GOLD_SOFT = "#E8C878";
export const HOME_FEED_GOLD_GLOW = "rgba(212,175,101,0.52)";
export const HOME_FEED_MUTED = "rgba(255,255,255,0.62)";
export const HOME_FEED_INACTIVE = "rgba(255,255,255,0.42)";
export const HOME_FEED_BORDER = "rgba(255,255,255,0.08)";

/** Faux glass — semi-transparent fills, no BlurView. */
export const HOME_FEED_GLASS_BG = "rgba(255,255,255,0.06)";
export const HOME_FEED_GLASS_BORDER = "rgba(255,255,255,0.10)";
export const HOME_FEED_GLASS_GOLD_BORDER = "rgba(212,175,101,0.22)";
export const HOME_FEED_CARD_BORDER = "rgba(212,175,101,0.24)";

export const HOME_FEED_THUMB_RADIUS = 20;
export const HOME_FEED_CARD_RADIUS = 22;

/** Tab bar height in tab layout (reserve above home indicator). */
export const HOME_FEED_TAB_BAR_HEIGHT = 70;

/** Fixed Home top bar body (single title + action row), excluding safe-area inset. */
export const HOME_FEED_TOP_BAR_BODY_HEIGHT = 44;

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
