export const BRANDED_VIDEO_POSTER_URI = "kristo:branded-poster";

export function isBrandedPosterUri(uri?: string | null) {
  return typeof uri === "string" && uri.startsWith("kristo:");
}

export function isBrandedVideoPosterUri(uri: unknown): boolean {
  return isBrandedPosterUri(String(uri || "").trim() || null);
}

export function brandedVideoPosterPayload() {
  return {
    posterUri: BRANDED_VIDEO_POSTER_URI,
    videoPosterUri: BRANDED_VIDEO_POSTER_URI,
    thumbnailUri: BRANDED_VIDEO_POSTER_URI,
    brandedPoster: true as const,
  };
}

export function itemUsesBrandedVideoPoster(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const row = item as Record<string, unknown>;
  if (row.brandedPoster === true) return true;
  return isBrandedVideoPosterUri(
    row.posterUri || row.videoPosterUri || row.thumbnailUri
  );
}
