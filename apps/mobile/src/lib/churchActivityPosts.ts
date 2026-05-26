export type ChurchActivityLabel =
  | "TESTIMONY"
  | "ANNOUNCEMENT"
  | "PRAYER"
  | "COUNSEL"
  | "POST"
  | "MEDIA";

export type ActivityGridItem = {
  id: string;
  title?: string;
  text?: string;
  body?: string;
  source?: string;
  kind?: string;
  type?: string;
  createdAt?: string;
  authorName?: string;
  actorLabel?: string;
  churchName?: string;
  mediaUri?: string;
  videoUrl?: string;
  posterUri?: string;
  thumbnailUri?: string;
  thumbnailUrl?: string;
  mediaType?: string;
  imageUrl?: string;
  ownershipType?: string;
};

export function normalizeActivityMediaUrl(uri?: string, apiBase?: string) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (/^(https?|file:|data:)/i.test(raw)) return raw;

  const base = String(apiBase || process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (raw.startsWith("/") && base) return `${base}${raw}`;
  return raw;
}

export function normalizeActivityItem(
  item: any,
  mediaUrlFn?: (uri?: string) => string
): ActivityGridItem {
  const resolve = mediaUrlFn || ((uri?: string) => normalizeActivityMediaUrl(uri));

  const mediaUri = resolve(item?.mediaUri || item?.imageUrl || item?.imageUri);
  const videoUrl = resolve(item?.videoUrl);
  const posterUri = resolve(item?.posterUri || item?.thumbnailUri || item?.thumbnailUrl);

  return {
    ...item,
    id: String(item?.id || ""),
    title: item?.title,
    text: item?.text,
    body: item?.body,
    source: item?.source,
    kind: item?.kind,
    type: item?.type,
    createdAt: item?.createdAt,
    authorName: item?.authorName,
    actorLabel: item?.actorLabel,
    churchName: item?.churchName,
    mediaUri: mediaUri || undefined,
    videoUrl: videoUrl || undefined,
    posterUri: posterUri || undefined,
    thumbnailUri: resolve(item?.thumbnailUri) || undefined,
    thumbnailUrl: resolve(item?.thumbnailUrl) || undefined,
    mediaType: item?.mediaType,
    imageUrl: resolve(item?.imageUrl) || undefined,
    ownershipType: item?.ownershipType,
  };
}

export function activityIsVideo(item: any) {
  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  return mediaType === "video" || type === "video" || Boolean(String(item?.videoUrl || "").trim());
}

export function activityCardBackgroundUri(item: any) {
  const imageUri = String(item?.mediaUri || item?.imageUrl || "").trim();
  if (imageUri) return imageUri;

  if (activityIsVideo(item)) {
    return String(item?.posterUri || item?.thumbnailUri || item?.thumbnailUrl || "").trim();
  }

  return "";
}

export function activityHasVisualMedia(item: any) {
  return Boolean(activityCardBackgroundUri(item));
}

export function getActivityGridLabel(item: any, variant: "church" | "media" = "church"): ChurchActivityLabel {
  if (variant === "media") return "MEDIA";
  return getChurchActivityLabel(item);
}

function bag(item: any) {
  return [
    item?.source,
    item?.kind,
    item?.type,
    item?.scheduleType,
    item?.title,
    item?.text,
    item?.body,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function isMediaActivityPost(item: any) {
  if (!item || typeof item !== "object") return false;

  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "media") return true;

  const source = String(item?.source || "").trim().toLowerCase();
  const scheduleType = String(item?.scheduleType || "").trim().toLowerCase();

  if (source.includes("media")) return true;
  if (scheduleType.includes("media")) return true;

  if (item?.kind === "live" || item?.isLiveNow) return true;

  const hasMediaName = Boolean(String(item?.mediaName || "").trim());
  const mediaRelatedSource =
    source.includes("media") ||
    source.includes("media-schedule") ||
    scheduleType.includes("live") ||
    scheduleType.includes("media");

  if (hasMediaName && mediaRelatedSource) return true;

  if (Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0) {
    if (source.includes("media") || scheduleType.includes("media") || scheduleType.includes("live")) {
      return true;
    }
  }

  return false;
}

export function isChurchActivityPost(item: any) {
  if (!item || typeof item !== "object") return false;
  if (isMediaActivityPost(item)) return false;

  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "media") return false;

  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  const textBag = bag(item);

  if (source === "testimony" || kind === "testimony" || type === "testimony") return true;
  if (source === "announcement" || kind === "announcement" || type === "announcement") return true;
  if (source === "prayer" || source.includes("prayer") || textBag.includes("prayer") || textBag.includes("maombi")) {
    return true;
  }
  if (source === "counsel" || kind === "counsel") return true;

  if (ownership === "church" || ownership === "member") return true;

  if (textBag.includes("testimony") || textBag.includes("ushuhuda")) return true;
  if (textBag.includes("announcement") || textBag.includes("tangazo")) return true;

  if (type === "post" || type === "announcement" || kind === "post" || kind === "announcement") {
    return true;
  }

  return false;
}

export function getChurchActivityLabel(item: any): ChurchActivityLabel {
  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  const textBag = bag(item);

  if (source === "testimony" || kind === "testimony" || type === "testimony" || textBag.includes("testimony") || textBag.includes("ushuhuda")) {
    return "TESTIMONY";
  }

  if (source === "announcement" || kind === "announcement" || type === "announcement" || textBag.includes("announcement") || textBag.includes("tangazo")) {
    return "ANNOUNCEMENT";
  }

  if (source === "prayer" || source.includes("prayer") || textBag.includes("prayer") || textBag.includes("maombi")) {
    return "PRAYER";
  }

  if (source === "counsel" || kind === "counsel") {
    return "COUNSEL";
  }

  return "POST";
}

export function churchActivityTitle(item: any) {
  return String(item?.title || item?.text || item?.body || "Church update").trim();
}

export function churchActivityBody(item: any) {
  const title = String(item?.title || "").trim();
  const body = String(item?.text || item?.body || "").trim();
  if (body && body !== title) return body;
  return String(item?.authorName || item?.actorLabel || item?.churchName || "Shared with your church.").trim();
}

export function churchActivityIcon(label: ChurchActivityLabel): string {
  switch (label) {
    case "TESTIMONY":
      return "sparkles-outline";
    case "ANNOUNCEMENT":
      return "megaphone-outline";
    case "PRAYER":
      return "heart-outline";
    case "COUNSEL":
      return "chatbubbles-outline";
    case "MEDIA":
      return "images-outline";
    default:
      return "newspaper-outline";
  }
}

export function sortActivityPostsNewestFirst<T extends { createdAt?: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const ta = new Date(String(a?.createdAt || "")).getTime();
    const tb = new Date(String(b?.createdAt || "")).getTime();
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}
