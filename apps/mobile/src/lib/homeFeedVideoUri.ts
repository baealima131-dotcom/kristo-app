import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";
import { canonicalPublicVideoPlaybackUrl } from "@/src/lib/videoStorageUrl";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");

function canonicalizeHomeFeedPublicMediaUrl(resolved: string) {
  if (!resolved || resolved.startsWith("file://") || resolved.startsWith("data:")) return resolved;
  if (!/^https?:\/\//i.test(resolved)) return resolved;
  return canonicalPublicVideoPlaybackUrl(resolved);
}

export function homeFeedMediaUrl(raw: unknown) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (isBrandedPosterUri(v)) return "";
  if (v.startsWith("data:image/")) return v;
  if (/^https?:\/\//i.test(v) || v.startsWith("file://")) {
    return canonicalizeHomeFeedPublicMediaUrl(v);
  }
  if (v.startsWith("//")) return canonicalizeHomeFeedPublicMediaUrl(`https:${v}`);
  return `${API_BASE}${v.startsWith("/") ? "" : "/"}${v}`;
}

function isResolvableFeedVideoUrl(resolved: string, isVideoTyped: boolean) {
  if (!resolved) return false;
  return /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(resolved) || isVideoTyped;
}

export function resolveVideoUri(item: any) {
  const local = String(item?.localVideoUri || "").trim();
  if (local.startsWith("file://")) return local;

  const isVideoTyped =
    String(item?.mediaType || "").trim().toLowerCase() === "video" ||
    String(item?.type || "").trim().toLowerCase() === "video" ||
    String(item?.kind || "").trim().toLowerCase() === "media";

  for (const key of ["videoUrl", "videoUri", "mediaUrl", "url"]) {
    const raw = String(item?.[key] || "").trim();
    if (!raw) continue;
    const resolved = homeFeedMediaUrl(raw);
    if (!resolved) continue;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(resolved) || isVideoTyped) return resolved;
  }

  const mediaUri = homeFeedMediaUrl(item?.mediaUri || "");
  if (mediaUri && /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(mediaUri)) return mediaUri;

  return homeFeedMediaUrl(item?.videoUrl || "");
}

export function resolveStablePosterVideoUrl(item: any): string {
  const isVideoTyped =
    String(item?.mediaType || "").trim().toLowerCase() === "video" ||
    String(item?.type || "").trim().toLowerCase() === "video" ||
    String(item?.kind || "").trim().toLowerCase() === "media";

  for (const key of ["videoUrl", "videoUri", "mediaUrl", "url", "mediaUri"]) {
    const raw = String(item?.[key] || "").trim();
    if (!raw || raw.startsWith("file://")) continue;
    const resolved = homeFeedMediaUrl(raw);
    if (!resolved || resolved.startsWith("file://")) continue;
    if (isResolvableFeedVideoUrl(resolved, isVideoTyped)) return resolved;
  }

  return resolveVideoUri(item);
}

/** The single, stable playback URL for an item. */
export function resolveHomeFeedVideoUri(item: any): string {
  const original = resolveVideoUri(item);
  return homeFeedMediaUrl(original) || original;
}
