export type HomeFeedVideoDisplayType = "youtube" | "tiktok" | "portrait45";

export function normalizeHomeFeedVideoDisplayType(
  value: unknown
): HomeFeedVideoDisplayType {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["tiktok", "shorts", "vertical", "9:16", "9/16"].includes(raw)) return "tiktok";
  if (["portrait45", "portrait_4_5", "portrait-4:5", "4:5", "4x5", "portrait"].includes(raw)) {
    return "portrait45";
  }
  return "youtube";
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
  if (aspect < 0.92) return "portrait45";
  return "youtube";
}

function resolveAspectRatio(item: any): number | null {
  const width = Number(item?.videoWidth ?? item?.mediaWidth ?? item?.width ?? item?.video?.width);
  const height = Number(item?.videoHeight ?? item?.mediaHeight ?? item?.height ?? item?.video?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return width / height;
  }

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

export function resolveHomeFeedVideoDisplayType(item: any): HomeFeedVideoDisplayType {
  const rawType = item?.videoDisplayType ?? item?.displayType;
  const raw = String(rawType || "").trim().toLowerCase();
  if (raw) return normalizeHomeFeedVideoDisplayType(raw);

  const aspect = resolveAspectRatio(item);
  if (aspect != null) {
    return resolveHomeFeedVideoDisplayTypeFromDimensions(aspect, 1) || "youtube";
  }
  return "youtube";
}

export function isTikTokStyleHomeFeedVideo(item: any): boolean {
  return resolveHomeFeedVideoDisplayType(item) === "tiktok";
}
