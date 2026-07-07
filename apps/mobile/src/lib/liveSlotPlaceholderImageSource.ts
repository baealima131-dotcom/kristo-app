import { getApiBase } from "@/src/lib/kristoApi";
import { resolveMediaSlotClaimedAvatar } from "@/src/lib/scheduleSlotUtils";

export type LiveSlotPlaceholderEntityType = "claimed-user" | "ministry" | "church" | "generic";

export type LiveSlotPlaceholderImageResolution = {
  slotId: string;
  ministryId: string;
  claimedByUserId: string;
  resolvedEntityType: LiveSlotPlaceholderEntityType;
  imageSource: string;
  hasRealImage: boolean;
  fallbackReason: string;
  ministryAvatarUrl: string;
  churchAvatarUrl: string;
  claimedUserAvatarUrl: string;
};

const loggedImageSourceKeys = new Set<string>();

function normalizeLiveSlotImageUri(value: unknown, apiBase?: string): string {
  const v = String(value || "").trim();
  if (!v) return "";
  if (
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("file://") ||
    v.startsWith("data:image/")
  ) {
    return v;
  }
  const base = String(apiBase || getApiBase() || process.env.EXPO_PUBLIC_API_BASE || "").replace(
    /\/+$/,
    ""
  );
  if (!base) return v;
  if (v.startsWith("/")) return `${base}${v}`;
  if (v.includes("uploads/")) return `${base}/${v.replace(/^\//, "")}`;
  return v;
}

function isRenderableImageUri(uri: string): boolean {
  const v = String(uri || "").trim();
  return (
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("file://") ||
    v.startsWith("data:image/")
  );
}

/** Same ministry image field order as ministry cards (`resolveMinistryCardAvatar`). */
export function ministryRecordAvatarUri(
  ministry: Record<string, unknown> | null | undefined,
  apiBase?: string
): string {
  const m = ministry || {};
  const candidates = [
    m.avatarUri,
    m.avatarUrl,
    m.imageUrl,
    m.ministryAvatar,
    m.ministryAvatarUrl,
    m.ministryImage,
    m.ministryImageUrl,
    m.groupAvatar,
    m.groupImage,
    m.roomAvatar,
    m.roomImage,
    m.coverImage,
  ];
  for (const raw of candidates) {
    const uri = normalizeLiveSlotImageUri(raw, apiBase);
    if (isRenderableImageUri(uri)) return uri;
  }
  return "";
}

export function logLiveSlotPlaceholderImageSource(
  resolution: Omit<LiveSlotPlaceholderImageResolution, "ministryAvatarUrl" | "churchAvatarUrl" | "claimedUserAvatarUrl">
) {
  const key = [
    resolution.slotId,
    resolution.ministryId,
    resolution.claimedByUserId,
    resolution.resolvedEntityType,
    resolution.imageSource,
    resolution.fallbackReason,
  ].join("|");
  if (loggedImageSourceKeys.has(key)) return;
  loggedImageSourceKeys.add(key);
  console.log("KRISTO_LIVE_SLOT_PLACEHOLDER_IMAGE_SOURCE", resolution);
}

export function resolveLiveSlotPlaceholderImageSource(args: {
  slot: any;
  slotId?: string;
  ministryId?: string;
  ministryProfile?: Record<string, unknown> | null;
  churchAvatarUrl?: string;
  apiBase?: string;
  memberAvatarByUserId?: Record<string, string>;
  profileAvatarByUserId?: Record<string, string>;
  sessionAvatarUri?: string;
  sessionUserId?: string;
  slotIsOpen?: boolean;
}): LiveSlotPlaceholderImageResolution {
  const apiBase = String(args.apiBase || getApiBase() || "").trim();
  const slot = args.slot || {};
  const slotId = String(args.slotId || slot?.id || slot?.slotId || slot?.slot || "").trim();
  const ministryId = String(
    args.ministryId || slot?.ministryId || slot?.roomId || ""
  ).trim();
  const claimedByUserId = String(
    slot?.claimedByUserId || slot?.claimedBy?.userId || ""
  ).trim();
  const slotIsOpen = args.slotIsOpen === true || !claimedByUserId;

  if (!slotIsOpen && claimedByUserId) {
    const claimed = resolveMediaSlotClaimedAvatar({
      slot,
      slotId,
      apiBase,
      profileAvatarByUserId: args.profileAvatarByUserId,
      memberAvatarByUserId: args.memberAvatarByUserId,
      sessionAvatarUri: args.sessionAvatarUri,
      sessionUserId: args.sessionUserId,
    });
    const imageSource = String(claimed.uri || "").trim();
    const resolution: LiveSlotPlaceholderImageResolution = {
      slotId,
      ministryId,
      claimedByUserId,
      resolvedEntityType: claimed.hasAvatar ? "claimed-user" : "generic",
      imageSource,
      hasRealImage: claimed.hasAvatar,
      fallbackReason: String(claimed.source || "initials-fallback"),
      ministryAvatarUrl: "",
      churchAvatarUrl: "",
      claimedUserAvatarUrl: imageSource,
    };
    logLiveSlotPlaceholderImageSource(resolution);
    return resolution;
  }

  const ministryAvatarUrl = ministryRecordAvatarUri(args.ministryProfile, apiBase);
  if (ministryAvatarUrl) {
    const resolution: LiveSlotPlaceholderImageResolution = {
      slotId,
      ministryId,
      claimedByUserId,
      resolvedEntityType: "ministry",
      imageSource: ministryAvatarUrl,
      hasRealImage: true,
      fallbackReason: "ministry-api-profile",
      ministryAvatarUrl,
      churchAvatarUrl: "",
      claimedUserAvatarUrl: "",
    };
    logLiveSlotPlaceholderImageSource(resolution);
    return resolution;
  }

  const churchAvatarUrl = normalizeLiveSlotImageUri(args.churchAvatarUrl, apiBase);
  if (isRenderableImageUri(churchAvatarUrl)) {
    const resolution: LiveSlotPlaceholderImageResolution = {
      slotId,
      ministryId,
      claimedByUserId,
      resolvedEntityType: "church",
      imageSource: churchAvatarUrl,
      hasRealImage: true,
      fallbackReason: "church-logo-fallback",
      ministryAvatarUrl: "",
      churchAvatarUrl,
      claimedUserAvatarUrl: "",
    };
    logLiveSlotPlaceholderImageSource(resolution);
    return resolution;
  }

  const resolution: LiveSlotPlaceholderImageResolution = {
    slotId,
    ministryId,
    claimedByUserId,
    resolvedEntityType: "generic",
    imageSource: "",
    hasRealImage: false,
    fallbackReason: "generic-ministry-icon",
    ministryAvatarUrl: "",
    churchAvatarUrl: "",
    claimedUserAvatarUrl: "",
  };
  logLiveSlotPlaceholderImageSource(resolution);
  return resolution;
}

export function resetLiveSlotPlaceholderImageSourceLogs() {
  loggedImageSourceKeys.clear();
}
