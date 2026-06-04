type AnyItem = Record<string, any>;

export type MediaStatus = "uploading" | "processing" | "ready";

export function normalizeMediaStatus(value: any): MediaStatus {
  const status = String(value || "ready").trim().toLowerCase();
  if (status === "uploading" || status === "processing" || status === "ready") return status;
  if (status === "published" || status === "done" || status === "complete" || status === "completed") return "ready";
  return "ready";
}

export function mediaStatusLabel(status: MediaStatus | string | null | undefined) {
  const normalized = normalizeMediaStatus(status);
  if (normalized === "uploading") return "Uploading...";
  if (normalized === "processing") return "Processing...";
  return "";
}

export function isMediaUploadFeedItem(item: AnyItem | null | undefined) {
  if (!item) return false;
  return (
    item.source === "media-upload" ||
    item.ownershipType === "media" ||
    item.mediaKind === "video" ||
    item.type === "video"
  );
}

export function isMediaUploadApiRow(item: AnyItem | null | undefined) {
  if (!item) return false;
  const source = String(item?.source || item?.postOrigin || item?.mediaSource || "")
    .trim()
    .toLowerCase();
  if (source === "media-upload" || source === "media" || source === "media-team") return true;
  return isMediaUploadFeedItem(item);
}

export function isHomeFeedReadyMediaItem(item: AnyItem | null | undefined) {
  if (!item) return false;

  const mediaStatus = String(item.mediaStatus || item.status || "ready").toLowerCase();
  const videoUrl = String(item.videoUrl || item.videoUri || item.mediaUrl || item.url || "").trim();

  if (!isMediaUploadFeedItem(item)) return true;
  if (!videoUrl) return false;

  return mediaStatus === "ready" || mediaStatus === "published" || mediaStatus === "";
}
