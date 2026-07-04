import {
  isHomeFeedLivestreamRow,
  isHomeFeedScheduleCardRow,
  isMediaLiveSlotsHomeFeedRow,
  isVideoPost,
  resolvePostBody,
} from "@/src/components/homeFeed/homeFeedUtils";
import type { HomeFeedVideoDisplayType } from "@/src/lib/homeFeedVideoDisplayType";
import { resolveHomeFeedVideoDisplayType } from "@/src/lib/homeFeedVideoDisplayType";

export const YOUTUBE_CARD_H_PADDING = 12;
export const YOUTUBE_THUMB_ASPECT = 16 / 9;
export const TIKTOK_THUMB_ASPECT = 9 / 16;
export const YOUTUBE_ACTIONS_HEIGHT = 48;
export const YOUTUBE_META_BLOCK_HEIGHT = 88;

/** Full-size live card height — used by Live Slots screen. */
export function homeFeedLiveCardHeight(windowHeight: number): number {
  return Math.min(790, Math.max(720, windowHeight * 0.86));
}

export function youtubeThumbnailHeight(windowWidth: number): number {
  const width = Math.max(280, windowWidth - YOUTUBE_CARD_H_PADDING * 2);
  return Math.round(width / YOUTUBE_THUMB_ASPECT);
}

const WATCH_TOP_BAR_HEIGHT = 48;
const WATCH_PANEL_ESTIMATE_HEIGHT = 210;
const WATCH_UP_NEXT_PEEK = 100;
const WATCH_TABLET_UP_NEXT_PEEK = 150;

function isTabletLayout(windowWidth: number, windowHeight: number): boolean {
  return Math.min(windowWidth, windowHeight) >= 600;
}

/** Immersive Watch player height — tablets use more vertical space than phone 16:9 alone. */
export function resolveWatchPlayerHeight(params: {
  windowWidth: number;
  windowHeight: number;
  topInset?: number;
  isTikTokLayout?: boolean;
}): number {
  const width = Math.max(280, params.windowWidth);
  const windowHeight = Math.max(480, params.windowHeight);
  const topInset = Math.max(0, params.topInset ?? 0);
  const isTikTokLayout = params.isTikTokLayout === true;
  const tablet = isTabletLayout(width, windowHeight);
  const upNextPeek = tablet ? WATCH_TABLET_UP_NEXT_PEEK : WATCH_UP_NEXT_PEEK;
  const viewportBudget = Math.max(
    220,
    windowHeight - topInset - WATCH_TOP_BAR_HEIGHT - WATCH_PANEL_ESTIMATE_HEIGHT - upNextPeek
  );

  if (isTikTokLayout) {
    const byAspect = Math.round(width / TIKTOK_THUMB_ASPECT);
    const cap = Math.round(windowHeight * (tablet ? 0.68 : 0.72));
    return Math.min(byAspect, cap, viewportBudget);
  }

  const byWidthAspect = Math.round(width / YOUTUBE_THUMB_ASPECT);
  if (!tablet) {
    return Math.min(byWidthAspect, viewportBudget);
  }

  const tabletImmersive = Math.round(windowHeight * 0.5);
  return Math.min(viewportBudget, Math.max(byWidthAspect, tabletImmersive));
}

export function tiktokThumbnailWidth(windowWidth: number): number {
  return Math.min(320, Math.max(220, Math.round(windowWidth * 0.56)));
}

export function tiktokThumbnailHeight(windowWidth: number): number {
  return Math.round(tiktokThumbnailWidth(windowWidth) / TIKTOK_THUMB_ASPECT);
}

export function homeFeedVideoThumbnailHeight(
  windowWidth: number,
  displayType: HomeFeedVideoDisplayType = "youtube"
): number {
  return displayType === "tiktok"
    ? tiktokThumbnailHeight(windowWidth)
    : youtubeThumbnailHeight(windowWidth);
}

export function estimateYouTubeFeedCardHeight(
  windowWidth: number,
  options: { hasCaption?: boolean } = {}
): number {
  const thumb = youtubeThumbnailHeight(windowWidth);
  const meta = options.hasCaption ? YOUTUBE_META_BLOCK_HEIGHT + 20 : YOUTUBE_META_BLOCK_HEIGHT;
  return thumb + meta + YOUTUBE_ACTIONS_HEIGHT + 20;
}

/** Card shell marginBottom from homeFeedPremiumStyles.feedCard. */
export const YOUTUBE_FEED_CARD_MARGIN_BOTTOM = 22;

export function estimateYouTubeFeedCardHeightForItem(
  windowWidth: number,
  item: any
): number {
  const displayType = resolveHomeFeedVideoDisplayType(item);
  const thumb = isVideoPost(item)
    ? homeFeedVideoThumbnailHeight(windowWidth, displayType)
    : youtubeThumbnailHeight(windowWidth);
  const caption = String(resolvePostBody(item) || "").trim();
  const meta = caption ? YOUTUBE_META_BLOCK_HEIGHT + 20 : YOUTUBE_META_BLOCK_HEIGHT;
  return thumb + meta + YOUTUBE_ACTIONS_HEIGHT + 20 + YOUTUBE_FEED_CARD_MARGIN_BOTTOM;
}

export function buildYouTubeFeedItemLayout(
  rows: any[],
  windowWidth: number,
  contentPaddingTop = 6
): { heights: number[]; offsets: number[] } {
  const heights: number[] = [];
  const offsets: number[] = [];
  let offset = contentPaddingTop;

  for (const row of rows) {
    offsets.push(offset);
    const height = estimateYouTubeFeedCardHeightForItem(windowWidth, row);
    heights.push(height);
    offset += height;
  }

  return { heights, offsets };
}

export type YouTubeFeedItemLayoutCache = {
  heights: number[];
  offsets: number[];
  rowKeys: string[];
  windowWidth: number;
};

/** Preserve existing offsets/heights when rows append at the end — avoids FlatList relayout jumps. */
export function resolveYouTubeFeedItemLayout(
  rows: any[],
  windowWidth: number,
  cache: YouTubeFeedItemLayoutCache,
  rowKey: (row: any, index: number) => string,
  contentPaddingTop = 6
): { heights: number[]; offsets: number[]; cache: YouTubeFeedItemLayoutCache } {
  const nextKeys = rows.map((row, index) => rowKey(row, index));
  const prefixStable =
    cache.windowWidth === windowWidth &&
    nextKeys.length >= cache.rowKeys.length &&
    cache.rowKeys.every((key, index) => key === nextKeys[index]);

  if (!prefixStable || nextKeys.length < cache.rowKeys.length) {
    const built = buildYouTubeFeedItemLayout(rows, windowWidth, contentPaddingTop);
    return {
      ...built,
      cache: {
        heights: built.heights,
        offsets: built.offsets,
        rowKeys: nextKeys,
        windowWidth,
      },
    };
  }

  if (nextKeys.length === cache.rowKeys.length) {
    return {
      heights: cache.heights,
      offsets: cache.offsets,
      cache,
    };
  }

  const heights = [...cache.heights];
  const offsets = [...cache.offsets];
  let offset =
    offsets.length > 0
      ? offsets[offsets.length - 1] + heights[heights.length - 1]
      : contentPaddingTop;

  for (let index = cache.rowKeys.length; index < rows.length; index += 1) {
    offsets.push(offset);
    const height = estimateYouTubeFeedCardHeightForItem(windowWidth, rows[index]);
    heights.push(height);
    offset += height;
  }

  return {
    heights,
    offsets,
    cache: {
      heights,
      offsets,
      rowKeys: nextKeys,
      windowWidth,
    },
  };
}

/** Home Feed is content-only — no live header partition. */
export function partitionHomeFeedYouTubeRows(rows: any[]) {
  return {
    primaryLive: null,
    extraLiveRows: [] as any[],
    feedRows: Array.isArray(rows) ? rows : [],
  };
}

/** @deprecated Live rows are excluded from Home Feed. */
export function isHomeFeedLiveFeaturedRow(row: any, _nowMs = Date.now()): boolean {
  if (isHomeFeedLivestreamRow(row)) return true;
  if (!isHomeFeedScheduleCardRow(row) && !isMediaLiveSlotsHomeFeedRow(row)) {
    return false;
  }
  return false;
}
