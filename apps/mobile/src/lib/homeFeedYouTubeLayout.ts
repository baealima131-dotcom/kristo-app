import {
  isHomeFeedLivestreamRow,
  isHomeFeedScheduleCardRow,
  isMediaLiveSlotsHomeFeedRow,
} from "@/src/components/homeFeed/homeFeedUtils";

export const YOUTUBE_CARD_H_PADDING = 12;
export const YOUTUBE_THUMB_ASPECT = 16 / 9;
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

export function estimateYouTubeFeedCardHeight(
  windowWidth: number,
  options: { hasCaption?: boolean } = {}
): number {
  const thumb = youtubeThumbnailHeight(windowWidth);
  const meta = options.hasCaption ? YOUTUBE_META_BLOCK_HEIGHT + 20 : YOUTUBE_META_BLOCK_HEIGHT;
  return thumb + meta + YOUTUBE_ACTIONS_HEIGHT + 20;
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
