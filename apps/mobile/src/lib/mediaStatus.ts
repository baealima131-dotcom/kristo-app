type AnyItem = Record<string, any>;

export function isMediaUploadFeedItem(item: AnyItem | null | undefined) {
  if (!item) return false;
  return (
    item.source === "media-upload" ||
    item.ownershipType === "media" ||
    item.mediaKind === "video" ||
    item.type === "video"
  );
}

export function isHomeFeedReadyMediaItem(item: AnyItem | null | undefined) {
  if (!item) return false;

  const mediaStatus = String(item.mediaStatus || item.status || "ready").toLowerCase();
  const videoUrl = String(item.videoUrl || item.videoUri || item.mediaUrl || item.url || "").trim();

  if (!isMediaUploadFeedItem(item)) return true;
  if (!videoUrl) return false;

  return mediaStatus === "ready" || mediaStatus === "published" || mediaStatus === "";
}
