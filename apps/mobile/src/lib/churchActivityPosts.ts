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

function activityItemSignalHaystack(item: any) {
  return [
    item?.id,
    item?.source,
    item?.kind,
    item?.type,
    item?.scheduleType,
    item?.title,
    item?.liveRoomPath,
    item?.mediaControl,
    item?.scheduleId,
    item?.sourceScheduleId,
    item?.liveScheduleId,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function getChurchActivityExclusionReason(item: any): string | null {
  if (!item || typeof item !== "object") return "invalid-item";

  const haystack = activityItemSignalHaystack(item);
  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  const scheduleType = String(item?.scheduleType || "").trim().toLowerCase();
  const id = String(item?.id || "").trim().toLowerCase();
  const title = String(item?.title || "").trim().toLowerCase();

  if (Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0) {
    return "scheduleSlots";
  }
  if (Array.isArray(item?.claimableSlots) && item.claimableSlots.length > 0) {
    return "claimableSlots";
  }

  if (id.includes("__slot_") || id.startsWith("media-live-")) return "id-slot-or-media-live";
  if (id.startsWith("church-live-now-") || id.includes("live-schedule")) return "id-church-live";

  if (item?.isLiveNow || kind === "live" || type === "live") return "live-flag";
  if (kind === "schedule" || type === "schedule") return "schedule-type";

  if (source.includes("media-schedule")) return "source-media-schedule";
  if (source.includes("live-schedule") || source.includes("live_schedule")) return "source-live-schedule";
  if (scheduleType.includes("media-live-slots")) return "scheduleType-media-live-slots";

  if (
    haystack.includes("claimableslots") ||
    haystack.includes("liveschedule") ||
    haystack.includes("mediacontrol") ||
    haystack.includes("countdown") ||
    haystack.includes("churchlive") ||
    haystack.includes("mediahost") ||
    haystack.includes("media-host") ||
    haystack.includes("slot-management") ||
    haystack.includes("live-time-card")
  ) {
    return "haystack-keyword";
  }

  if (title.includes("live time card")) return "title-live-time-card";

  if (item?.mediaControl || item?.countdownMs != null || item?.liveSlotsRemaining != null) {
    if (scheduleType || source.includes("schedule") || source.includes("live") || item?.isLiveNow) {
      return "live-control-fields";
    }
  }

  if (Boolean(item?.scheduleId || item?.liveScheduleId) && (scheduleType || source.includes("schedule"))) {
    return "schedule-id-fields";
  }

  return null;
}

export function isChurchActivityExcludedCard(item: any) {
  return getChurchActivityExclusionReason(item) != null;
}

export function isChurchActivityMediaContentPost(item: any) {
  if (isChurchActivityExcludedCard(item)) return false;

  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "image" || mediaType === "video") return true;
  if (activityIsVideo(item)) return true;
  if (Boolean(String(item?.mediaUri || item?.imageUrl || item?.videoUrl || "").trim())) return true;

  return false;
}

export function isChurchActivityAllowedPost(item: any) {
  if (isChurchActivityExcludedCard(item)) return false;
  if (isChurchTabActivityPost(item)) return true;
  return isChurchActivityMediaContentPost(item);
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

export type ChurchActivityTab = "church" | "media";
export type ChurchActivityMemberFilter = "all" | "mine" | "member";
export type ChurchActivityFeedMode = "church" | "member" | "media";

export function getPostAuthorId(item: any) {
  return postAuthorUserId(item);
}

export function getPostChurchId(item: any) {
  return postChurchId(item);
}

export function isMediaPost(item: any) {
  return isMediaActivityPost(item);
}

export function postAuthorUserId(item: any) {
  return String(
    item?.actorUserId ||
      item?.authorId ||
      item?.userId ||
      item?.createdBy ||
      item?.memberId ||
      item?.postedByUserId ||
      ""
  ).trim();
}

export function postAuthorName(item: any) {
  return String(
    item?.authorName ||
      item?.actorLabel ||
      item?.postedByName ||
      item?.profileName ||
      item?.userName ||
      item?.mediaName ||
      "Church member"
  ).trim();
}

export function postChurchId(item: any) {
  const candidates = postChurchIdCandidates(item);
  return candidates[0] || "";
}

export function postChurchIdCandidates(item: any) {
  const ids = [
    item?.churchId,
    item?.sourceChurchId,
    item?.church?.id,
    item?.churchProfile?.id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return [...new Set(ids)];
}

export function postHasAlternateChurchIdentity(item: any) {
  return Boolean(
    String(item?.churchName || "").trim() ||
      String(item?.churchLabel || "").trim() ||
      String(item?.churchCode || "").trim()
  );
}

export function belongsToChurch(item: any, churchId: string) {
  const targetChurchId = String(churchId || "").trim();
  if (!targetChurchId) return false;

  const candidates = postChurchIdCandidates(item);
  if (candidates.length > 0) {
    return candidates.some((candidate) => candidate === targetChurchId);
  }

  if (postHasAlternateChurchIdentity(item)) {
    return false;
  }

  return false;
}

export function matchesActivityMemberFilter(
  item: any,
  memberFilter: ChurchActivityMemberFilter,
  selectedMemberId?: string,
  currentUserId?: string
) {
  if (memberFilter === "all") return true;

  const authorId = postAuthorUserId(item);
  if (!authorId) return false;

  if (memberFilter === "mine") {
    const viewerId = String(currentUserId || "").trim();
    return Boolean(viewerId) && authorId === viewerId;
  }

  if (memberFilter === "member") {
    const memberId = String(selectedMemberId || "").trim();
    return Boolean(memberId) && authorId === memberId;
  }

  return true;
}

export function isChurchTabActivityPost(item: any) {
  if (!item || typeof item !== "object") return false;
  if (isMediaActivityPost(item)) return false;
  if (isChurchActivityPost(item)) return true;

  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "image" || mediaType === "video") return true;

  const source = String(item?.source || "").trim().toLowerCase();
  if (
    source === "post" ||
    source === "announcement" ||
    source === "testimony" ||
    source === "prayer" ||
    source === "counsel"
  ) {
    return true;
  }

  return false;
}

export function formatActivityWhen(createdAt?: string | number) {
  const ms = new Date(String(createdAt || "")).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function mergeActivityPostsUnique(rows: any[]) {
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const item of rows) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }

  return merged;
}

export function getChurchActivityPosts({
  allPosts,
  selectedTab,
  memberFilter = "all",
  selectedMemberId,
  currentUserId,
  churchId,
  mediaUrlFn,
}: {
  allPosts: any[];
  selectedTab: ChurchActivityTab;
  memberFilter?: ChurchActivityMemberFilter;
  selectedMemberId?: string;
  currentUserId: string;
  churchId: string;
  mediaUrlFn?: (uri?: string) => string;
}) {
  let rows = mergeActivityPostsUnique(allPosts).filter((item) =>
    belongsToChurch(item, churchId)
  );

  if (selectedTab === "media") {
    rows = rows.filter(isMediaActivityPost);
  } else {
    rows = rows.filter(isChurchTabActivityPost);
  }

  rows = rows.filter((item) =>
    matchesActivityMemberFilter(item, memberFilter, selectedMemberId, currentUserId)
  );

  const result = sortActivityPostsNewestFirst(
    rows.map((item) => normalizeActivityItem(item, mediaUrlFn))
  );

  if (__DEV__) {
    console.log("CHURCH_ACTIVITY_FILTER_RESULT", {
      tab: selectedTab,
      filter: memberFilter,
      selectedMemberId: String(selectedMemberId || ""),
      churchId: String(churchId || ""),
      count: result.length,
    });
  }

  return result;
}

export function filterChurchActivityFeedRows(
  rows: any[],
  context: {
    activityChurchId: string;
    activityMemberId?: string;
    activityMode: ChurchActivityFeedMode;
  },
  mediaUrlFn?: (uri?: string) => string
) {
  const activityChurchId = String(context.activityChurchId || "").trim();
  const activityMemberId = String(context.activityMemberId || "").trim();
  const activityMode = context.activityMode || "church";
  const beforeCount = rows.length;

  if (!activityChurchId) return [];

  let filtered = mergeActivityPostsUnique(rows).filter((item) =>
    belongsToChurch(item, activityChurchId)
  );

  const afterChurchCount = filtered.length;
  filtered = filtered.filter((item) => !isChurchActivityExcludedCard(item));

  if (activityMode === "media") {
    filtered = filtered.filter(isChurchActivityMediaContentPost);
  } else {
    filtered = filtered.filter(isChurchActivityAllowedPost);
  }

  if (activityMemberId) {
    filtered = filtered.filter((item) => {
      const authorId = getPostAuthorId(item);
      return Boolean(authorId) && authorId === activityMemberId;
    });
  }

  const result = sortActivityPostsNewestFirst(
    filtered.map((item) => normalizeChurchActivityFeedItem(item, mediaUrlFn))
  );

  if (__DEV__) {
    console.log("KRISTO_CHURCH_ACTIVITY_FEED_FILTER", {
      activityChurchId,
      activityMemberId,
      activityMode,
      beforeCount,
      afterChurchCount,
      afterExcludeCount: filtered.length,
      afterCount: result.length,
    });
  }

  return result;
}

export function normalizeChurchActivityFeedItem(
  item: any,
  mediaUrlFn?: (uri?: string) => string
) {
  const normalized = normalizeActivityItem(item, mediaUrlFn);
  const isVideo = activityIsVideo(normalized);
  const imageUri = String(normalized.mediaUri || normalized.imageUrl || "").trim();
  const videoUri = String(normalized.videoUrl || "").trim();

  return {
    ...normalized,
    title: churchActivityTitle(normalized),
    body: churchActivityBody(normalized),
    mediaType: isVideo ? "video" : imageUri ? "image" : "none",
    mediaUri: isVideo ? videoUri || imageUri : imageUri,
    videoUrl: videoUri || undefined,
    authorName: postAuthorName(normalized),
  };
}

export function stampChurchFeedScope(item: any, fallbackChurchId: string) {
  const scopedChurchId = String(
    item?.churchId || item?.sourceChurchId || item?.church?.id || fallbackChurchId || ""
  ).trim();
  return {
    ...item,
    churchId: scopedChurchId,
    sourceChurchId: String(item?.sourceChurchId || scopedChurchId).trim(),
  };
}
