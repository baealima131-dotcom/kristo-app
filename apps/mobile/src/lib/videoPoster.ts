type ThumbnailFn = (
  uri: string,
  options: { time?: number; quality?: number }
) => Promise<{ uri?: string } | null | undefined>;

let posterClientUnavailableLogged = false;
let posterClientLoadFailed = false;
let cachedThumbnailFn: ThumbnailFn | null | undefined;

function logPosterClientUnavailableOnce(reason: string, message?: string) {
  if (posterClientUnavailableLogged) return;
  posterClientUnavailableLogged = true;
  console.warn("KRISTO_VIDEO_POSTER_CLIENT_UNAVAILABLE", {
    reason,
    message: message ? String(message) : null,
  });
}

async function loadVideoThumbnailClient(): Promise<ThumbnailFn | null> {
  if (posterClientLoadFailed) return null;
  if (cachedThumbnailFn !== undefined) return cachedThumbnailFn;

  try {
    const mod = await import("expo-video-thumbnails");
    const VideoThumbnails = (mod as { default?: unknown }).default ?? mod;
    const fn = (VideoThumbnails as { getThumbnailAsync?: ThumbnailFn })?.getThumbnailAsync;

    if (typeof fn !== "function") {
      posterClientLoadFailed = true;
      cachedThumbnailFn = null;
      logPosterClientUnavailableOnce("getThumbnailAsync-missing");
      return null;
    }

    cachedThumbnailFn = fn.bind(VideoThumbnails) as ThumbnailFn;
    return cachedThumbnailFn;
  } catch (error) {
    posterClientLoadFailed = true;
    cachedThumbnailFn = null;
    logPosterClientUnavailableOnce(
      "expo-video-thumbnails-missing-or-failed",
      String((error as Error)?.message || error)
    );
    return null;
  }
}

export async function generateLocalVideoPosterUri(videoUri: string): Promise<string | null> {
  const cleanUri = String(videoUri || "").trim();
  if (!cleanUri) return null;

  const getThumbnailAsync = await loadVideoThumbnailClient();
  if (!getThumbnailAsync) return null;

  try {
    const result = await getThumbnailAsync(cleanUri, {
      time: 500,
      quality: 0.72,
    });
    return String(result?.uri || "").trim() || null;
  } catch {
    return null;
  }
}
