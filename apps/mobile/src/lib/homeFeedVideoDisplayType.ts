import { isFacebookVideoLinkItem, isVerticalFacebookVideoItem } from "@/src/lib/facebookVideoLink";

export type HomeFeedVideoDisplayType = "youtube" | "tiktok" | "portrait45";

function displayTypeFromValue(value: unknown): HomeFeedVideoDisplayType | null {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["tiktok", "shorts", "vertical", "9:16", "9/16"].includes(raw)) return "tiktok";
  if (["portrait45", "portrait_4_5", "portrait-4:5", "4:5", "4x5", "portrait"].includes(raw)) {
    return "portrait45";
  }
  if (["youtube", "landscape", "horizontal", "16:9", "16/9"].includes(raw)) {
    return "youtube";
  }
  return null;
}

export function normalizeHomeFeedVideoDisplayType(
  value: unknown
): HomeFeedVideoDisplayType {
  return displayTypeFromValue(value) || "youtube";
}

export function resolveHomeFeedVideoDisplayTypeFromDimensions(
  width: number,
  height: number
): HomeFeedVideoDisplayType | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const aspect = width / height;
  if (aspect < 0.7) return "tiktok";
  if (aspect < 1) return "portrait45";
  return "youtube";
}

/** Video posts saved from a YouTube / TikTok / Facebook link (played by the platform's player). */
export function isExternalVideoLinkItem(item: any): boolean {
  return String(item?.source || "").trim().toLowerCase() === "system-admin-video-link";
}

function isYouTubeShortsUrl(raw: unknown): boolean {
  try {
    const parsed = new URL(String(raw || "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com") return false;
    return /^\/shorts\/[A-Za-z0-9_-]{11}(?:\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Link posts carry the platform name ("youtube" | "tiktok" | "facebook") in videoDisplayType, not
 * the video's shape, so the shape comes from the platform and the link: TikTok videos and YouTube
 * Shorts are vertical, Facebook Reels are vertical, everything else is landscape.
 */
function externalLinkDisplayType(item: any): HomeFeedVideoDisplayType {
  const platform = String(item?.videoDisplayType || item?.provider || "").trim().toLowerCase();
  if (platform === "facebook" || isFacebookVideoLinkItem(item)) {
    return isVerticalFacebookVideoItem(item) ? "tiktok" : "youtube";
  }
  if (platform === "tiktok") return "tiktok";
  const orientation = String(item?.videoOrientation || "").trim().toLowerCase();
  if (orientation === "vertical") return "tiktok";
  if (isYouTubeShortsUrl(item?.videoUrl || item?.url)) return "tiktok";
  return "youtube";
}

function positiveDimensions(width: unknown, height: unknown): number | null {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null;
}

/**
 * Width / height of an uploaded video from its saved metadata (measured at upload), or null.
 * Link posts return null: their width/height fields describe the cover, not the video.
 */
export function resolveHomeFeedVideoAspectRatio(item: any): number | null {
  if (!item || isExternalVideoLinkItem(item)) return null;
  const measured =
    positiveDimensions(item?.videoWidth, item?.videoHeight) ??
    positiveDimensions(item?.mediaWidth, item?.mediaHeight) ??
    positiveDimensions(item?.video?.width, item?.video?.height) ??
    positiveDimensions(item?.width, item?.height);
  if (measured != null) return measured;

  const raw = String(item?.videoAspectRatio ?? item?.aspectRatio ?? item?.mediaAspectRatio ?? "").trim();
  const fraction = raw.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return numerator > 0 && denominator > 0 ? numerator / denominator : null;
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Layout family of a video from the metadata available before it plays:
 * - link posts: the platform and link (see externalLinkDisplayType);
 * - uploads: the measured width/height first (uploads only store a coarse "youtube"/"tiktok"
 *   label, so a 4:5 upload is labelled "youtube"), then an explicit label.
 */
export function resolveHomeFeedVideoDisplayTypeHint(
  item: any
): HomeFeedVideoDisplayType | null {
  if (isExternalVideoLinkItem(item)) return externalLinkDisplayType(item);

  // Facebook links from an older cache without their source: Reels vertical, others landscape.
  if (String(item?.videoDisplayType || "").trim().toLowerCase() === "facebook") {
    return isVerticalFacebookVideoItem(item) ? "tiktok" : "youtube";
  }

  const aspect = resolveHomeFeedVideoAspectRatio(item);
  if (aspect != null) return resolveHomeFeedVideoDisplayTypeFromDimensions(aspect, 1);

  return displayTypeFromValue(item?.videoDisplayType ?? item?.displayType);
}

/** Fallback width / height for a layout family when the real size is not known. */
export function defaultHomeFeedVideoAspectRatio(displayType: HomeFeedVideoDisplayType): number {
  if (displayType === "tiktok") return 9 / 16;
  if (displayType === "portrait45") return 4 / 5;
  return 16 / 9;
}

export function resolveHomeFeedVideoDisplayType(item: any): HomeFeedVideoDisplayType {
  return resolveHomeFeedVideoDisplayTypeHint(item) || "youtube";
}

export function isTikTokStyleHomeFeedVideo(item: any): boolean {
  return resolveHomeFeedVideoDisplayType(item) === "tiktok";
}
