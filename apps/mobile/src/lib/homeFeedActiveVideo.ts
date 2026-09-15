/**
 * Active Home Feed video is a stable post ID.
 * Mixed FlatList indexes that land on SOKO rows are never the active video.
 */

export function isSokoFeedRow(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as { type?: unknown; _homeFeedKind?: unknown };
  return row.type === "soko" || row._homeFeedKind === "soko-product";
}

export function homeFeedVideoId(value: unknown): string {
  if (!value || typeof value !== "object" || isSokoFeedRow(value)) return "";
  const row = value as {
    id?: unknown;
    mediaType?: unknown;
    type?: unknown;
    videoUrl?: unknown;
    mediaUri?: unknown;
  };
  const isVideo =
    row.mediaType === "video" ||
    row.type === "video" ||
    Boolean(String(row.videoUrl || row.mediaUri || "").trim());
  if (!isVideo) return "";
  return String(row.id || "").trim();
}

export function resolveActiveVideoIndexById(rows: any[] | undefined, videoId: string): number {
  const id = String(videoId || "").trim();
  if (!id || !Array.isArray(rows)) return -1;
  return rows.findIndex((row) => homeFeedVideoId(row) === id);
}

export function isHomeFeedActiveVideoRow(
  row: unknown,
  index: number,
  activeIndex: number,
  activeVideoId?: string
): boolean {
  if (isSokoFeedRow(row)) return false;
  const id = homeFeedVideoId(row);
  if (!id) return false;
  if (activeVideoId) return id === activeVideoId;
  return index === activeIndex;
}

export type YouTubeViewableToken = {
  index?: number | null;
  item?: unknown;
  isViewable?: boolean;
};

export function pickYouTubeActiveVideoFromViewable(args: {
  viewableItems: YouTubeViewableToken[];
  rows?: any[];
  previousVideoId?: string;
}): { index: number; videoId: string } | null {
  const rows = Array.isArray(args.rows) ? args.rows : [];
  const videos: { index: number; videoId: string }[] = [];

  for (const token of args.viewableItems || []) {
    if (token?.isViewable === false) continue;
    const index = Number(token?.index);
    if (!Number.isFinite(index) || index < 0) continue;
    const item = token.item != null ? token.item : rows[index];
    if (isSokoFeedRow(item)) continue;
    const videoId = homeFeedVideoId(item);
    if (!videoId) continue;
    videos.push({ index, videoId });
  }

  if (videos.length) {
    videos.sort((a, b) => a.index - b.index);
    return videos[0];
  }

  const previousVideoId = String(args.previousVideoId || "").trim();
  if (!previousVideoId) return null;
  const preserved = resolveActiveVideoIndexById(rows, previousVideoId);
  if (preserved < 0) return null;
  return { index: preserved, videoId: previousVideoId };
}
