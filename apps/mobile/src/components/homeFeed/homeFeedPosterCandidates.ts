import { isBrandedPosterUri } from "@/lib/brandedVideoPoster";
import { resolveCachedMediaPoster } from "@/lib/mediaPosterCache";
import {
  homeFeedMediaUrl,
  resolveVideoUri,
} from "@/components/homeFeed/homeFeedMediaUrl";

function resolvePosterSeedForVideo(videoUrl: string): string {
  try {
    const seed = (globalThis as any).__KRISTO_FEED_VIDEO_POSTER_SEED__;
    if (!seed || typeof seed !== "object") return "";
    const seedVideo = String(seed.videoUrl || "").trim().split("?")[0];
    const seedPoster = String(seed.posterUri || "").trim();
    const normalized = String(videoUrl || "").trim().split("?")[0];
    if (!seedVideo || !seedPoster || !normalized || seedVideo !== normalized) return "";
    if (isBrandedPosterUri(seedPoster)) return "";
    return homeFeedMediaUrl(seedPoster);
  } catch {
    return "";
  }
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

export function isLikelySyntheticPosterPath(posterUri: string): boolean {
  const value = String(posterUri || "").trim().split("?")[0];
  if (!value) return false;
  return (
    value.includes("/church-video-posters/") || value.includes("/uploads/media/posters/")
  );
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

export function collectFeedVideoPosterCandidates(item: any, postId = ""): string[] {
  const video = resolveVideoUri(item);
  if (!video) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const pid = String(postId || item?.id || "").trim();

  const push = (raw: unknown) => {
    const resolved = homeFeedMediaUrl(raw);
    if (!resolved || isBrandedPosterUri(resolved)) return;
    if (!isValidVideoPosterUri(resolved, video)) return;
    const key = resolved.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolved);
  };

  const cached = resolveCachedMediaPoster(pid, video);
  if (cached) push(cached);

  for (const raw of [
    item?.posterUri,
    item?.videoPosterUri,
    item?.thumbnailUri,
    item?.thumbnailUrl,
    item?.mediaPosterUri,
    item?.posterUrl,
    item?.coverUrl,
    item?.firstFrameUrl,
    item?.coverImage,
    item?.coverImageUrl,
    item?.previewUrl,
    item?.thumbnail,
    item?.poster,
  ]) {
    push(raw);
  }

  push(resolvePosterSeedForVideo(video));
  push(inferPosterUriFromVideoUrl(video));

  return out;
}

export function resolveBestFeedPosterUri(item: any, postId = ""): string {
  return collectFeedVideoPosterCandidates(item, postId)[0] || "";
}

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

export function resolvePosterUri(item: any) {
  return resolveBestFeedPosterUri(item, String(item?.id || "").trim());
}

export { resolvePosterSeedForVideo };
