export const BRANDED_VIDEO_POSTER_URI = "kristo:branded-poster";

export function isBrandedVideoPosterUri(uri: unknown): boolean {
  const value = String(uri || "").trim();
  return value === BRANDED_VIDEO_POSTER_URI;
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
