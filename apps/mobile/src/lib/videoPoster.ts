export async function generateLocalVideoPosterUri(videoUri: string): Promise<string | null> {
  const cleanUri = String(videoUri || "").trim();
  if (!cleanUri) return null;

  try {
    const mod = await import("expo-video-thumbnails");
    const VideoThumbnails = (mod as any).default || mod;
    const result = await VideoThumbnails.getThumbnailAsync(cleanUri, {
      time: 500,
      quality: 0.72,
    });
    return String(result?.uri || "").trim() || null;
  } catch (error) {
    console.log("KRISTO_VIDEO_POSTER_CLIENT_UNAVAILABLE", {
      reason: "expo-video-thumbnails-missing-or-failed",
      message: String((error as any)?.message || error),
    });
    return null;
  }
}
