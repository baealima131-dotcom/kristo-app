import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";
import { homeFeedMediaUrl, resolveVideoUri } from "@/src/lib/homeFeedVideoUri";

export function isLikelySyntheticPosterPath(value: string) {
  const normalized = String(value || "").trim().toLowerCase().split("?")[0];
  if (!normalized) return false;
  return (
    normalized.includes("/church-video-posters/") || normalized.includes("/uploads/media/posters/")
  );
}

export function inferPosterUriFromVideoUrl(videoUrl: string): string {
  const raw = String(videoUrl || "").trim().split("?")[0];
  if (!raw) return "";

  const uploadsMatch = raw.match(/\/uploads\/media\/(?:[^/]+\/)*([^/]+)\.(mp4|mov|m4v|webm|mkv)$/i);
  if (uploadsMatch?.[1]) {
    return homeFeedMediaUrl(`/uploads/media/posters/${uploadsMatch[1]}.jpg`);
  }

  const r2Marker = "/church-videos/";
  const r2Idx = raw.indexOf(r2Marker);
  if (r2Idx >= 0) {
    const tail = raw.slice(r2Idx + r2Marker.length);
    const match = tail.match(/^([^/]+)\/([^/]+)\.(mp4|mov|m4v|webm|mkv)$/i);
    if (match?.[1] && match?.[2]) {
      const base = raw.slice(0, r2Idx);
      return `${base}/church-video-posters/${match[1]}/${match[2]}.jpg`;
    }
  }

  return "";
}

export function isInferredPosterUriForVideo(posterUri: string, videoUri: string): boolean {
  const poster = String(posterUri || "").trim().split("?")[0];
  const video = String(videoUri || "").trim();
  if (!poster || !video) return false;
  const inferred = inferPosterUriFromVideoUrl(video);
  if (!inferred) return isLikelySyntheticPosterPath(poster);
  return poster === inferred.split("?")[0];
}

export function isValidVideoPosterUri(posterUri: string, videoUri: string) {
  const poster = String(posterUri || "").trim();
  const video = String(videoUri || "").trim();
  if (!poster) return false;
  if (isBrandedPosterUri(poster)) return false;
  if (video && poster === video) return false;
  if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(poster)) return false;
  return true;
}

/** Saved backend poster from upload metadata — excludes inferred/branded guesses. */
export function resolveSavedFeedVideoPosterUri(item: any, videoUrl?: string): string {
  const video = String(videoUrl || resolveVideoUri(item) || "").trim();
  if (!item || !video) return "";

  for (const raw of [
    item?.posterUri,
    item?.videoPosterUri,
    item?.thumbnailUri,
    item?.thumbnailUrl,
    item?.posterUrl,
  ]) {
    const uri = homeFeedMediaUrl(raw);
    if (!uri || isBrandedPosterUri(uri)) continue;
    if (!isValidVideoPosterUri(uri, video)) continue;
    if (isInferredPosterUriForVideo(uri, video)) continue;
    return uri;
  }

  return "";
}
