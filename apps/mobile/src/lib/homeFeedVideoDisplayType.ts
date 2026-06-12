export type HomeFeedVideoDisplayType = "youtube" | "tiktok";

export function normalizeHomeFeedVideoDisplayType(
  value: unknown
): HomeFeedVideoDisplayType {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  return raw === "tiktok" ? "tiktok" : "youtube";
}

export function resolveHomeFeedVideoDisplayType(item: any): HomeFeedVideoDisplayType {
  return normalizeHomeFeedVideoDisplayType(item?.videoDisplayType || item?.displayType);
}

export function isTikTokStyleHomeFeedVideo(item: any): boolean {
  return resolveHomeFeedVideoDisplayType(item) === "tiktok";
}
