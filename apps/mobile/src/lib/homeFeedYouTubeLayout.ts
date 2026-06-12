import {
  isHomeFeedLivestreamRow,
  isHomeFeedScheduleCardRow,
  isMediaLiveSlotsHomeFeedRow,
} from "@/src/components/homeFeed/homeFeedUtils";

export const YOUTUBE_CARD_H_PADDING = 12;
export const YOUTUBE_THUMB_ASPECT = 16 / 9;
export const YOUTUBE_ACTIONS_HEIGHT = 48;
export const YOUTUBE_META_BLOCK_HEIGHT = 88;

/** Full-size live card height — matches HomeLiveScheduleCard sizing. */
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

function isScheduleRowLiveNow(row: any, nowMs: number): boolean {
  if (!row) return false;
  if (row?.isLiveNow || row?.kind === "live") return true;
  const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
  const slot = slots[0];
  if (!slot) return false;
  const status = String(slot?.status || "").toLowerCase();
  return status === "live" || slot?.isLive === true;
}

/** Rows promoted to the live header (not mixed into the scrollable feed). */
export function isHomeFeedLiveFeaturedRow(row: any, nowMs = Date.now()): boolean {
  if (isHomeFeedLivestreamRow(row)) return true;
  if (!isHomeFeedScheduleCardRow(row, nowMs) && !isMediaLiveSlotsHomeFeedRow(row)) {
    return false;
  }
  return isScheduleRowLiveNow(row, nowMs);
}

export function partitionHomeFeedYouTubeRows(rows: any[], nowMs = Date.now()) {
  const liveRows: any[] = [];
  const feedRows: any[] = [];

  for (const row of rows) {
    if (isHomeFeedLiveFeaturedRow(row, nowMs)) {
      liveRows.push(row);
    } else {
      feedRows.push(row);
    }
  }

  return {
    primaryLive: liveRows[0] || null,
    extraLiveRows: liveRows.slice(1),
    feedRows,
  };
}
