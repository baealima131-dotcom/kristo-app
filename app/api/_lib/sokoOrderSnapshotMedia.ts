import { resolveSokoCatalogPhotos } from "./sokoProductImages";

export function sokoOrderSnapshotImageUnusable(
  snapshot: Record<string, any> | null | undefined
) {
  const image = String(snapshot?.image || "").trim();
  const photos = Array.isArray(snapshot?.photos) ? snapshot.photos : [];
  const first = image || String(photos[0] || "").trim();
  if (!first) return true;
  if (first.startsWith("/api/soko/product-images/")) return true;
  if (/^local\//i.test(first)) return true;
  if (/^https:\/\//i.test(first)) return false;
  return true;
}

export function resolveSokoOrderCatalogImages(payload: Record<string, any> | null | undefined) {
  const photos = resolveSokoCatalogPhotos(payload?.imageKeys);
  const fallback = String(payload?.image || "").trim();
  const image = photos[0] || fallback;
  return {
    image,
    photos: photos.length ? photos : fallback ? [fallback] : [],
  };
}

export function mergeSokoOrderCatalogImages(
  snapshot: Record<string, any> | null | undefined,
  catalog: { image?: string; photos?: string[] } | null | undefined
) {
  const current = snapshot && typeof snapshot === "object" ? { ...snapshot } : {};
  if (!sokoOrderSnapshotImageUnusable(current)) return current;
  const image = String(catalog?.image || "").trim();
  const photos = Array.isArray(catalog?.photos)
    ? catalog.photos.filter((value) => typeof value === "string" && value.trim())
    : [];
  const first = image || photos[0] || "";
  if (!first || sokoOrderSnapshotImageUnusable({ image: first, photos })) {
    return current;
  }
  return {
    ...current,
    image: first,
    photos: photos.length ? photos : [first],
    imageSource: "listing_fallback",
    imageSnapshotKind: "listing_fallback",
  };
}
