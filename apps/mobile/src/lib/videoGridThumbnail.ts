const PREVIEW_LOAD_TIMEOUT_MS = 3500;
const CLIENT_THUMB_TIMEOUT_MS = 4000;

const thumbnailCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

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

export function getClientThumbTimeoutMs() {
  return CLIENT_THUMB_TIMEOUT_MS;
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
