import {
  classifyHomeFeedPosterUriSource,
  resolveBestFeedPosterUri,
  type HomeFeedPosterSourceKind,
} from "@/src/components/homeFeed/homeFeedUtils";
import { computeHomeFeedPosterCaptureTimeMs } from "@/src/lib/mediaVideoPoster";
import {
  peekCachedMediaPosterCaptureTimeMs,
  resolveCachedMediaPoster,
} from "@/src/lib/mediaPosterCache";

export type HomeFeedPosterDisplayState = {
  uri: string;
  source: HomeFeedPosterSourceKind;
};

const posterDisplayByKey = new Map<string, HomeFeedPosterDisplayState>();
const loggedPosterSourceKeys = new Set<string>();
const posterMetadataFingerprintByKey = new Map<string, string>();

function posterSessionKey(postId: string, videoUrl: string) {
  const id = String(postId || "").trim();
  const video = String(videoUrl || "").trim().split("?")[0];
  return `${id}|${video}`;
}

function resolvePosterSourceForUri(
  item: any,
  posterUri: string,
  postId: string,
  videoUrl: string
): HomeFeedPosterSourceKind {
  if (!posterUri) return "inferred";
  const cached = resolveCachedMediaPoster(postId, videoUrl);
  if (cached && cached.split("?")[0] === posterUri.split("?")[0]) {
    return "cache";
  }
  if (item) {
    return classifyHomeFeedPosterUriSource(item, posterUri, postId, videoUrl);
  }
  return "metadata";
}

/** Resolve poster URI + source once per post/video for the app session. */
export function resolveHomeFeedPosterDisplay(
  postId: string,
  videoUrl: string,
  item?: any,
  metadataFingerprint = ""
): HomeFeedPosterDisplayState {
  const key = posterSessionKey(postId, videoUrl);
  const cached = resolveCachedMediaPoster(postId, videoUrl);
  const fingerprint = String(metadataFingerprint || "").trim();

  if (fingerprint) {
    const previousFingerprint = posterMetadataFingerprintByKey.get(key);
    if (previousFingerprint !== fingerprint) {
      posterMetadataFingerprintByKey.set(key, fingerprint);
      const existing = posterDisplayByKey.get(key);
      if (existing && existing.source !== "cache" && !cached) {
        posterDisplayByKey.delete(key);
      }
    }
  }

  const existing = posterDisplayByKey.get(key);

  if (existing) {
    if (cached) {
      const normalizedCached = cached.split("?")[0];
      if (
        existing.source !== "cache" ||
        existing.uri.split("?")[0] !== normalizedCached
      ) {
        const upgraded = { uri: cached, source: "cache" as const };
        posterDisplayByKey.set(key, upgraded);
        return upgraded;
      }
    }
    return existing;
  }

  if (cached) {
    const state = { uri: cached, source: "cache" as const };
    posterDisplayByKey.set(key, state);
    return state;
  }

  const uri = item ? resolveBestFeedPosterUri(item, postId) : "";
  const source = resolvePosterSourceForUri(item, uri, postId, videoUrl);
  const state = { uri, source };
  posterDisplayByKey.set(key, state);
  return state;
}

/** Upgrade a post to a cached poster URI without re-running metadata/inferred resolution. */
export function promoteHomeFeedPosterCache(postId: string, videoUrl: string, uri: string) {
  const normalized = String(uri || "").trim();
  if (!normalized) return;
  const key = posterSessionKey(postId, videoUrl);
  posterDisplayByKey.set(key, { uri: normalized, source: "cache" });
}

export function logHomeFeedPosterSourceOnce(
  postId: string,
  videoUrl: string,
  source: HomeFeedPosterSourceKind,
  durationMs?: number
) {
  const key = posterSessionKey(postId, videoUrl);
  if (loggedPosterSourceKeys.has(key)) return false;
  loggedPosterSourceKeys.add(key);

  console.log("KRISTO_HOME_FEED_POSTER_SOURCE", {
    postId: postId || null,
    source,
    captureTimeMs:
      peekCachedMediaPosterCaptureTimeMs(postId, videoUrl) ??
      computeHomeFeedPosterCaptureTimeMs(durationMs),
  });
  return true;
}

export function peekHomeFeedPosterDisplay(
  postId: string,
  videoUrl: string
): HomeFeedPosterDisplayState | null {
  return posterDisplayByKey.get(posterSessionKey(postId, videoUrl)) || null;
}
