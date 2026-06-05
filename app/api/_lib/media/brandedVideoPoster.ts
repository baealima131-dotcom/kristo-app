import { isUsableVideoPosterUri } from "@/app/api/_lib/media/videoPoster";

/**
 * V1 fallback when ffmpeg/R2 poster generation is unavailable (e.g. Vercel).
 * Future: replace with Cloudflare Stream or Mux transcoding + real thumbnails.
 */
export const BRANDED_VIDEO_POSTER_URI = "kristo:branded-poster";

export function isBrandedVideoPosterUri(uri: unknown): boolean {
  const value = String(uri || "").trim();
  return value === BRANDED_VIDEO_POSTER_URI;
}

export function brandedVideoPosterFields() {
  return {
    posterUri: BRANDED_VIDEO_POSTER_URI,
    videoPosterUri: BRANDED_VIDEO_POSTER_URI,
    thumbnailUri: BRANDED_VIDEO_POSTER_URI,
    brandedPoster: true as const,
  };
}

export function applyBrandedVideoPosterFallback(
  item: Record<string, unknown>,
  videoUrl?: unknown
): boolean {
  const url = String(videoUrl || item.videoUrl || "").trim();
  const isVideo =
    item.type === "video" || Boolean(url);
  if (!isVideo) return false;

  const poster = String(item.posterUri || item.videoPosterUri || item.thumbnailUri || "").trim();
  if (isUsableVideoPosterUri(poster, url) && !isBrandedVideoPosterUri(poster)) {
    return false;
  }

  Object.assign(item, brandedVideoPosterFields());
  return true;
}

export function videoItemNeedsBrandedPoster(item: Record<string, unknown>): boolean {
  const url = String(item.videoUrl || "").trim();
  if (!url && item.type !== "video") return false;
  if (item.brandedPoster === true) return false;
  const poster = String(item.posterUri || item.videoPosterUri || item.thumbnailUri || "").trim();
  return !isUsableVideoPosterUri(poster, url);
}
