const PREVIEW_LOAD_TIMEOUT_MS = 3500;
const CLIENT_THUMB_TIMEOUT_MS = 4000;
const HOME_FEED_POSTER_LOAD_TIMEOUT_MS = 5000;
const POSTER_PROBE_CACHE_MS = 10 * 60 * 1000;

const thumbnailCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const posterProbeCache = new Map<
  string,
  { result: PosterUrlProbeResult; at: number }
>();

export type PosterUrlProbeResult = {
  url: string;
  reachable: boolean;
  httpStatus: number | null;
  method: "head" | "get-range" | "skipped";
  reason?: string;
};

function normalizePosterProbeKey(url: string) {
  return String(url || "").trim().split("?")[0];
}

function normalizeVideoKey(videoUrl: string) {
  return String(videoUrl || "").trim().split("?")[0];
}

export function isLocalMediaUri(uri: string) {
  return String(uri || "").trim().startsWith("file://");
}

export function withPreviewTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

export function getPreviewLoadTimeoutMs() {
  return PREVIEW_LOAD_TIMEOUT_MS;
}

export function getHomeFeedPosterLoadTimeoutMs() {
  return HOME_FEED_POSTER_LOAD_TIMEOUT_MS;
}

export function getClientThumbTimeoutMs() {
  return CLIENT_THUMB_TIMEOUT_MS;
}

export async function probePosterUrlReachability(url: string): Promise<PosterUrlProbeResult> {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return {
      url: "",
      reachable: false,
      httpStatus: null,
      method: "skipped",
      reason: "empty-url",
    };
  }
  if (normalized.startsWith("file://") || normalized.startsWith("data:")) {
    return {
      url: normalized,
      reachable: true,
      httpStatus: null,
      method: "skipped",
      reason: "local-uri",
    };
  }

  const cacheKey = normalizePosterProbeKey(normalized);
  const cached = posterProbeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < POSTER_PROBE_CACHE_MS) {
    return cached.result;
  }

  const finish = (result: PosterUrlProbeResult) => {
    posterProbeCache.set(cacheKey, { result, at: Date.now() });
    return result;
  };

  try {
    let response = await fetch(normalized, { method: "HEAD" });
    if (response.ok || response.status === 206) {
      return finish({
        url: normalized,
        reachable: true,
        httpStatus: response.status,
        method: "head",
      });
    }
    if (response.status === 404) {
      return finish({
        url: normalized,
        reachable: false,
        httpStatus: 404,
        method: "head",
        reason: "not-found",
      });
    }

    response = await fetch(normalized, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    const reachable = response.ok || response.status === 206 || response.status === 200;
    return finish({
      url: normalized,
      reachable,
      httpStatus: response.status,
      method: "get-range",
      reason: reachable ? undefined : "get-range-failed",
    });
  } catch (error) {
    return finish({
      url: normalized,
      reachable: false,
      httpStatus: null,
      method: "head",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function resolveClientVideoThumbnailUri(videoUrl: string): Promise<string> {
  const key = normalizeVideoKey(videoUrl);
  if (!key || !isLocalMediaUri(key)) return "";

  const cached = thumbnailCache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = withPreviewTimeout(
    (async () => {
      try {
        const VideoThumbnails = await import("expo-video-thumbnails");
        const result = await VideoThumbnails.getThumbnailAsync(key, {
          time: 500,
          quality: 0.55,
        });
        const uri = String(result?.uri || "").trim();
        if (uri) thumbnailCache.set(key, uri);
        return uri;
      } catch {
        return "";
      } finally {
        inflight.delete(key);
      }
    })(),
    CLIENT_THUMB_TIMEOUT_MS,
    ""
  );

  inflight.set(key, promise);
  return promise;
}

export {
  logMediaPosterCacheHit,
  resolveCachedMediaPoster,
} from "@/src/lib/mediaPosterCache";
