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
