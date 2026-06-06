import { isKristoVerboseSlotTimeDebug } from "@/src/lib/kristoDebugFlags";
import { resolveApiBase } from "@/src/lib/kristoEnv";

export type ScheduleSlotPhase = "open" | "claimed" | "live" | "ended" | "upcoming";

export type EnrichedScheduleSlot = {
  id?: string;
  name?: string;
  slotLabel?: string;
  role?: string;
  task?: string;
  script?: string;
  meetingDate?: string;
  meetingDay?: string;
  startTime?: string;
  endTime?: string;
  durationMin?: number;
  startMs: number;
  endMs: number;
  isLiveNow: boolean;
  isUpcoming: boolean;
  isEnded: boolean;
  claimedByUserId?: string;
  claimedByName?: string;
  claimedByAvatarUri?: string;
  claimedByAvatar?: string;
  claimedBy?: any;
  claimed?: boolean;
  isClaimed?: boolean;
  status?: string;
  locked?: boolean;
  approved?: boolean;
  queue?: any[];
};

function parseIsoMs(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function preferSlotCalendarDate(slot: any) {
  const meetingDate = String(slot?.meetingDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(meetingDate)) return meetingDate;
  const meetingDay = String(slot?.meetingDay || "").trim();
  return meetingDate || meetingDay;
}

export function parseSlotClockMs(
  rawDate: string,
  rawTime: string,
  opts?: { startMsHint?: number; preferEndDate?: string }
) {
  if (!rawTime) return 0;

  const dateCandidates = [
    String(opts?.preferEndDate || "").trim(),
    String(rawDate || "").trim(),
  ].filter(Boolean);

  const [timePart = "12:00", meridiemRaw = "AM"] = rawTime.split(" ");
  const [hhRaw = "12", mmRaw = "00"] = timePart.split(":");

  let hh = Number(hhRaw || 0);
  const mm = Number(mmRaw || 0);
  const meridiem = meridiemRaw.toUpperCase();

  if (meridiem === "PM" && hh < 12) hh += 12;
  if (meridiem === "AM" && hh === 12) hh = 0;

  const startHint = Number(opts?.startMsHint || 0);

  for (const dateText of dateCandidates) {
    const base = new Date(dateText);
    if (!Number.isFinite(base.getTime())) continue;

    let result = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0).getTime();
    if (startHint > 0 && result <= startHint) {
      result += 24 * 60 * 60 * 1000;
    }
    if (startHint <= 0 || result > startHint) return result;
  }

  return 0;
}

export function parseSlotStartMs(slot: any) {
  const explicitStart = Number(slot?.startMs || 0);
  if (explicitStart > 0) return explicitStart;

  const startsAtMs = parseIsoMs(slot?.startsAt);
  if (startsAtMs > 0) return startsAtMs;

  const rawDate = preferSlotCalendarDate(slot);
  const rawTime = String(slot?.startTime || slot?.time || "").trim();
  if (!rawDate) return 0;

  const base = new Date(rawDate);
  if (!Number.isFinite(base.getTime())) return 0;
  if (!rawTime) return base.getTime();

  return parseSlotClockMs(rawDate, rawTime);
}

export function parseSlotEndMs(slot: any, startMs = 0) {
  const explicitEnd = Number(slot?.endMs || 0);
  if (explicitEnd > startMs) return explicitEnd;

  const endsAtMs = parseIsoMs(slot?.endsAt);
  if (endsAtMs > startMs) return endsAtMs;

  const endDate = String(
    slot?.meetingEndDate || slot?.meetingDate || slot?.meetingDay || ""
  ).trim();
  const endTime = String(slot?.endTime || "").trim();
  const endFromClock = endDate && endTime
    ? parseSlotClockMs(endDate, endTime, { startMsHint: startMs, preferEndDate: endDate })
    : 0;

  if (endFromClock > startMs) return endFromClock;

  const durationMs = Math.max(
    1,
    Number(slot?.durationMin || slot?.durationMinutes || 10)
  ) * 60000;
  return startMs > 0 ? startMs + durationMs : 0;
}

export function enrichScheduleSlot(slot: any, index: number, nowMs: number): EnrichedScheduleSlot {
  const startMs = parseSlotStartMs(slot);
  const endMs = parseSlotEndMs(slot, startMs);
  const persistedAvatar = resolvePersistedClaimAvatarUri(slot);

  return patchMediaSlotClaimAvatarFields(
    {
      ...slot,
      startMs,
      endMs,
      isLiveNow: startMs > 0 && endMs > 0 && nowMs >= startMs && nowMs <= endMs,
      isUpcoming: startMs > nowMs,
      isEnded: endMs > 0 && nowMs > endMs,
    },
    persistedAvatar
  );
}

export function resolveSlotPhase(slot: EnrichedScheduleSlot, claimed: boolean): ScheduleSlotPhase {
  if (slot.isEnded) return "ended";
  if (slot.isLiveNow) return "live";
  if (claimed) return "claimed";
  if (slot.isUpcoming) return "upcoming";
  return "open";
}

export function resolveScheduleSlotClaimed(slot: any, optimisticClaim?: any): boolean {
  const claimedByObj =
    typeof slot?.claimedBy === "object" && slot?.claimedBy ? slot.claimedBy : null;
  const claimUserId = String(
    optimisticClaim?.userId || claimedByObj?.userId || slot?.claimedByUserId || ""
  ).trim();
  return Boolean(claimUserId || optimisticClaim);
}

export type ScheduleSlotVisualState = {
  enriched: EnrichedScheduleSlot;
  startMs: number;
  endMs: number;
  claimed: boolean;
  phase: ScheduleSlotPhase;
  expired: boolean;
};

/** Single source of truth for Home Feed schedule slot timing + phase (card + filter). */
export function resolveScheduleSlotVisualState(
  slot: any,
  slotFeedIndex: number,
  nowMs: number,
  options?: { optimisticClaim?: any; slotId?: string }
): ScheduleSlotVisualState | null {
  if (!slot) return null;

  const enriched = enrichScheduleSlot(slot, slotFeedIndex, nowMs);
  const claimed = resolveScheduleSlotClaimed(enriched, options?.optimisticClaim);
  const phase = resolveSlotPhase(enriched, claimed);
  const state: ScheduleSlotVisualState = {
    enriched,
    startMs: enriched.startMs,
    endMs: enriched.endMs,
    claimed,
    phase,
    expired: phase === "ended",
  };

  if (__DEV__ && isKristoVerboseSlotTimeDebug()) {
    console.log("KRISTO_SLOT_TIME_SHARED_HELPER", {
      slotId: options?.slotId ?? String(slot?.id || ""),
      startMs: state.startMs,
      endMs: state.endMs,
      phase: state.phase,
    });
  }

  return state;
}

export function formatSlotDateLabel(iso?: string, fallback?: string) {
  if (!iso) return fallback || "Today";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback || "Today";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function resolveAvatarUri(raw: string, apiBase: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("/profile-avatars/") && !trimmed.startsWith("/uploads/")) return "";
  return toMediaSlotAbsoluteAvatarUri(trimmed, apiBase);
}

/** Church/media card header avatars may use base64 data URLs — unlike claimed slot persistence. */
export function toChurchHeaderAbsoluteAvatarUri(raw: string, apiBase?: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (/\/profile-avatars\//i.test(trimmed)) return "";
  if (isClaimSlotDataUrlAvatar(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("file://")) return trimmed;

  const base = String(apiBase || resolveApiBase() || "").replace(/\/+$/, "");
  if (trimmed.startsWith("/")) return base ? `${base}${trimmed}` : trimmed;
  if (/^uploads\//i.test(trimmed)) return base ? `${base}/${trimmed}` : trimmed;
  return trimmed;
}

export function resolveChurchHeaderAvatarUri(
  item: any,
  apiBase: string,
  opts?: { sessionChurchAvatarUri?: string }
): MediaSlotAvatarResolution {
  const candidates: Array<[string, unknown]> = [
    ["churchAvatarUri", item?.churchAvatarUri],
    ["churchAvatarUrl", item?.churchAvatarUrl],
    ["churchLogoUri", item?.churchLogoUri],
    ["churchLogoUrl", item?.churchLogoUrl],
    ["mediaAvatarUri", item?.mediaAvatarUri],
    ["mediaAvatar", item?.mediaAvatar],
    ["churchAvatar", item?.churchAvatar],
    ["session.churchAvatarUri", opts?.sessionChurchAvatarUri],
  ];

  for (const [source, raw] of candidates) {
    const uri = toChurchHeaderAbsoluteAvatarUri(String(raw || ""), apiBase);
    if (uri) {
      return { uri, source, hasAvatar: true };
    }
  }

  return { uri: "", source: "initials", hasAvatar: false };
}

/** Hide raw user ids / emails from feed labels. */
export function cleanFeedLabel(raw: unknown, fallback: string) {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  if (/^u_[a-f0-9-]+$/i.test(s)) return fallback;
  if (/^[a-f0-9-]{24,}$/i.test(s)) return fallback;
  if (s.includes("@") && !s.includes(" ")) return fallback;
  return s;
}

export type MediaSlotAvatarResolution = {
  uri: string;
  source: string;
  hasAvatar: boolean;
};

export function isClaimSlotDataUrlAvatar(raw: unknown): boolean {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .startsWith("data:image");
}

/** Schedule slot claims must use uploaded/http paths — never huge base64 data URLs. */
export function isPersistableClaimSlotAvatarUri(
  raw: unknown,
  opts?: { allowLocalFile?: boolean }
): boolean {
  const trimmed = String(raw || "").trim();
  if (!trimmed || isClaimSlotDataUrlAvatar(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith("/uploads/") || /^uploads\//i.test(trimmed)) return true;
  if (opts?.allowLocalFile && trimmed.startsWith("file://")) return true;
  return false;
}

export function sanitizePersistedClaimAvatarUri(
  raw: unknown,
  context = "sanitize"
): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";

  if (isClaimSlotDataUrlAvatar(trimmed)) {
    console.log("KRISTO_CLAIMED_SLOT_AVATAR_DATA_URL_REJECTED", {
      context,
      byteLen: trimmed.length,
      preview: trimmed.slice(0, 48),
    });
    return "";
  }

  if (trimmed.startsWith("file://")) return "";

  return trimmed;
}

function pickClaimedUserAvatarRaw(slot: any, claimedBy: any): Array<[string, unknown]> {
  return [
    ["slot.claimedByAvatarUri", slot?.claimedByAvatarUri],
    ["slot.claimedByAvatar", slot?.claimedByAvatar],
    ["slot.claimedByAvatarUrl", slot?.claimedByAvatarUrl],
    ["slot.claimedByPhotoUrl", slot?.claimedByPhotoUrl],
    ["slot.claimedByPhotoURL", slot?.claimedByPhotoURL],
    ["claimedBy.avatarUri", claimedBy?.avatarUri],
    ["claimedBy.avatarUrl", claimedBy?.avatarUrl],
    ["claimedBy.profileImage", claimedBy?.profileImage],
    ["claimedBy.photoURL", claimedBy?.photoURL],
    ["claimedBy.image", claimedBy?.image],
  ];
}

function pickMediaSlotAvatarRaw(slot: any, claimedBy: any): Array<[string, unknown]> {
  return pickClaimedUserAvatarRaw(slot, claimedBy);
}

export function toMediaSlotAbsoluteAvatarUri(raw: string, apiBase?: string) {
  const trimmed = sanitizePersistedClaimAvatarUri(raw, "toMediaSlotAbsoluteAvatarUri");
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("file://")) {
    return trimmed;
  }

  const base = String(apiBase || resolveApiBase() || "").replace(/\/+$/, "");
  if (!base) return trimmed;

  if (trimmed.startsWith("/")) return `${base}${trimmed}`;
  if (/^uploads\//i.test(trimmed)) return `${base}/${trimmed}`;
  return trimmed;
}

function resolveRenderableClaimAvatarUri(raw: unknown, apiBase?: string): string {
  const sanitized = sanitizePersistedClaimAvatarUri(raw, "resolve-render");
  if (!sanitized || !isPersistableClaimSlotAvatarUri(sanitized)) return "";
  return toMediaSlotAbsoluteAvatarUri(sanitized, apiBase);
}

export function resolveClaimedUserAvatarUri(args: {
  slot: any;
  slotId?: string;
  apiBase: string;
  profileAvatarByUserId?: Record<string, string>;
  memberAvatarByUserId?: Record<string, string>;
  sessionAvatarUri?: string;
  sessionUserId?: string;
}): MediaSlotAvatarResolution {
  const slot = args.slot || {};
  const slotId = String(args.slotId || slot?.id || "").trim();
  const claimedBy = slot?.claimedBy;
  const claimedByUserId = String(slot?.claimedByUserId || claimedBy?.userId || "").trim();

  for (const [source, raw] of pickClaimedUserAvatarRaw(slot, claimedBy)) {
    if (isClaimSlotDataUrlAvatar(raw)) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_DATA_URL_REJECTED", {
        context: "resolveClaimedUserAvatarUri",
        source,
        slotId,
        claimedByUserId,
        byteLen: String(raw || "").length,
      });
      continue;
    }
    const uri = resolveRenderableClaimAvatarUri(String(raw || ""), args.apiBase);
    if (uri) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_RESOLVE", {
        slotId,
        claimedByUserId,
        source,
        hasAvatar: true,
      });
      return { uri, source, hasAvatar: true };
    }
  }

  if (claimedByUserId && args.profileAvatarByUserId?.[claimedByUserId]) {
    const uri = resolveRenderableClaimAvatarUri(
      args.profileAvatarByUserId[claimedByUserId],
      args.apiBase
    );
    if (uri) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_RESOLVE", {
        slotId,
        claimedByUserId,
        source: "profile-cache",
        hasAvatar: true,
      });
      return { uri, source: "profile-cache", hasAvatar: true };
    }
  }

  if (claimedByUserId && args.memberAvatarByUserId?.[claimedByUserId]) {
    const uri = resolveRenderableClaimAvatarUri(
      args.memberAvatarByUserId[claimedByUserId],
      args.apiBase
    );
    if (uri) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_RESOLVE", {
        slotId,
        claimedByUserId,
        source: "church-members-cache",
        hasAvatar: true,
      });
      return { uri, source: "church-members-cache", hasAvatar: true };
    }
  }

  if (
    claimedByUserId &&
    args.sessionUserId &&
    claimedByUserId === args.sessionUserId &&
    args.sessionAvatarUri
  ) {
    const uri = resolveRenderableClaimAvatarUri(args.sessionAvatarUri, args.apiBase);
    if (uri) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_RESOLVE", {
        slotId,
        claimedByUserId,
        source: "session-profile",
        hasAvatar: true,
      });
      return { uri, source: "session-profile", hasAvatar: true };
    }
  }

  console.log("KRISTO_CLAIMED_SLOT_AVATAR_MISSING", {
    slotId,
    claimedByUserId,
    hasAvatar: false,
    source: "initials-fallback",
  });
  return { uri: "", source: "initials-fallback", hasAvatar: false };
}

export function resolveMediaSlotClaimedAvatar(args: {
  slot: any;
  slotId?: string;
  apiBase: string;
  profileAvatarByUserId?: Record<string, string>;
  memberAvatarByUserId?: Record<string, string>;
  sessionAvatarUri?: string;
  sessionUserId?: string;
}): MediaSlotAvatarResolution {
  return resolveClaimedUserAvatarUri(args);
}

/** @deprecated Prefer resolveChurchHeaderAvatarUri for card headers. */
export function resolveScheduleAvatarUri(item: any, apiBase: string) {
  return resolveChurchHeaderAvatarUri(item, apiBase).uri;
}

export function patchMediaSlotClaimAvatarFields(slot: any, avatarUri: string) {
  const uri = sanitizePersistedClaimAvatarUri(avatarUri, "patchMediaSlotClaimAvatarFields");
  if (!uri || !isPersistableClaimSlotAvatarUri(uri)) return slot;

  const claimedByUserId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
  const claimedBy = slot?.claimedBy && typeof slot.claimedBy === "object" ? slot.claimedBy : null;

  return {
    ...slot,
    claimedByAvatarUri: uri,
    claimedByAvatar: uri,
    claimedByPhotoUrl: uri,
    ...(claimedByUserId
      ? {
          claimedBy: {
            ...(claimedBy || {
              userId: claimedByUserId,
              name: String(slot?.claimedByName || "Member"),
              role: String(slot?.claimedByRole || "Member"),
            }),
            userId: claimedByUserId,
            avatarUri: uri,
          },
        }
      : {}),
  };
}

/** Preserve persisted claim avatars — reject data URLs and non-upload paths. */
export function resolvePersistedClaimAvatarUri(slot: any): string {
  const claimedByObj =
    typeof slot?.claimedBy === "object" && slot?.claimedBy ? slot.claimedBy : null;

  const candidates = [
    slot?.claimedByAvatarUri,
    slot?.claimedByAvatar,
    slot?.claimedByAvatarUrl,
    slot?.claimedByPhotoUrl,
    slot?.claimedByPhotoURL,
    claimedByObj?.avatarUri,
    claimedByObj?.avatarUrl,
    claimedByObj?.profileImage,
    claimedByObj?.photoURL,
    claimedByObj?.image,
  ];

  for (const raw of candidates) {
    const sanitized = sanitizePersistedClaimAvatarUri(raw, "resolvePersistedClaimAvatarUri");
    if (sanitized && isPersistableClaimSlotAvatarUri(sanitized)) return sanitized;
  }

  return "";
}

export function baseFeedId(input: unknown) {
  const id = String(input || "")
    .replace(/__fy_\d+$/g, "")
    .trim();
  if (!id) return "";
  return id.split("__slot_")[0];
}

export function isBackendFeedScheduleId(id: unknown): boolean {
  return String(id || "").trim().startsWith("feed_");
}

export function isLocalMediaScheduleId(id: unknown): boolean {
  const value = String(id || "").trim().toLowerCase();
  return value.startsWith("media-schedule-") || value.startsWith("media-live-");
}

/** Collect every schedule id alias (local media-schedule-* and backend feed_*) linked in feed rows. */
export function collectScheduleAliasIds(seedId: unknown, rows: any[] = []): string[] {
  const seed = baseFeedId(seedId);
  const rawSeed = String(seedId || "").trim();
  if (!seed && !rawSeed) return [];

  const aliases = new Set<string>();
  if (seed) aliases.add(seed);
  if (rawSeed) aliases.add(rawSeed);

  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;

      const rowId = String(row?.id || "").trim();
      const sourceId = String(row?.sourceScheduleId || "").trim();
      const liveId = String(row?.liveId || "").trim();
      const linked = [rowId, sourceId, liveId, baseFeedId(rowId), baseFeedId(sourceId), baseFeedId(liveId)].filter(
        Boolean
      );

      const touches = linked.some((id) => aliases.has(id));
      if (!touches) continue;

      for (const id of linked) {
        if (!aliases.has(id)) {
          aliases.add(id);
          changed = true;
        }
      }
    }
  }

  return Array.from(aliases);
}

/** Prefer durable backend feed_* id when a mirror row exists in the feed store. */
export function resolveCanonicalScheduleFeedId(seedId: unknown, rows: any[] = []): string {
  const seed = baseFeedId(seedId) || String(seedId || "").trim();
  if (!seed) return "";

  const aliases = new Set(collectScheduleAliasIds(seed, rows));
  if (isBackendFeedScheduleId(seed)) return seed;

  for (const row of rows) {
    const rowId = String(row?.id || "").trim();
    if (!isBackendFeedScheduleId(rowId)) continue;

    const sourceId = String(row?.sourceScheduleId || "").trim();
    const liveId = String(row?.liveId || "").trim();
    if (
      aliases.has(rowId) ||
      aliases.has(baseFeedId(rowId)) ||
      (sourceId && aliases.has(sourceId)) ||
      (liveId && aliases.has(liveId))
    ) {
      return rowId;
    }
  }

  for (const alias of aliases) {
    if (isBackendFeedScheduleId(alias)) return alias;
  }

  return seed;
}

export function resolveLiveScheduleFeedId(
  input: Record<string, unknown> | null | undefined,
  rows?: any[]
) {
  const candidates = [
    input?.sourceScheduleId,
    input?.feedId,
    input?.liveId,
    input?.schedulePostId,
    input?.id,
  ];

  let resolved = "";
  for (const value of candidates) {
    const id = baseFeedId(value);
    if (id) {
      resolved = id;
      break;
    }
  }

  if (!resolved) return "";
  if (rows && rows.length) {
    const canonical = resolveCanonicalScheduleFeedId(resolved, rows);

    // Prefer backend feed_* id for backend API actions.
    // media-schedule-* is a local/live-room id and causes /api/church/feed?id=... 404.
    const backendMatch = rows.find((row: any) => {
      const rowId = String(row?.id || "").trim();
      const sourceId = String(row?.sourceScheduleId || row?.liveId || row?.scheduleId || "").trim();
      return rowId.startsWith("feed_") && (sourceId === resolved || sourceId === canonical || rowId === canonical);
    });

    if (backendMatch?.id) return String(backendMatch.id);

    return canonical;
  }
  return resolved;
}

export function normalizeLiveScheduleSlot(slot: any, index = 0) {
  const lean = toLeanLiveRouteSlot(slot, index);
  const slotNum = lean.slotNumber;
  const claimedByUserId = lean.claimedByUserId;
  const claimedByName = lean.claimedByName;
  const claimedAvatar = resolvePersistedClaimAvatarUri(slot) || lean.claimedByAvatarUri;
  const isClaimed =
    lean.status === "claimed" ||
    lean.status === "taken" ||
    lean.status === "live" ||
    Boolean(claimedByUserId);

  return {
    id: lean.id,
    slot: slotNum,
    slotNumber: slotNum,
    order: slotNum,
    name: lean.title,
    slotLabel: lean.title,
    title: lean.title,
    meetingDay: lean.meetingDay,
    meetingDate: String(slot?.meetingDate || lean.meetingDay || "").trim(),
    meetingEndDate: String(slot?.meetingEndDate || "").trim(),
    startsAt: String(slot?.startsAt || "").trim(),
    endsAt: String(slot?.endsAt || "").trim(),
    startTime: lean.startTime,
    endTime: lean.endTime,
    durationMin: lean.durationMin,
    durationMinutes: lean.durationMin,
    startMs: lean.startMs,
    endMs: lean.endMs,
    status: lean.status,
    claimedByUserId,
    claimedByName,
    ...(isClaimed
      ? {
          claimed: true,
          isClaimed: true,
          claimedByAvatarUri: claimedAvatar,
          claimedByAvatar: claimedAvatar,
          claimedByPhotoUrl: claimedAvatar,
          claimedBy: {
            userId: claimedByUserId,
            name: claimedByName,
            avatarUri: claimedAvatar,
            role: String(slot?.claimedByRole || slot?.claimedBy?.role || "Member"),
          },
        }
      : {}),
  };
}

export function normalizeLiveScheduleSlots(slots: any[]) {
  if (!Array.isArray(slots)) return [];
  return slots.map((slot, index) => normalizeLiveScheduleSlot(slot, index));
}

function liveRoomSlotKey(slot: any, index = 0) {
  const id = String(slot?.id || slot?.slotId || "").trim();
  if (id) return `id:${id}`;
  const n = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
  return `num:${n}`;
}

function pickFresherScheduleSlot(prev: any, next: any) {
  const prevOwner = String(prev?.claimedByUserId || prev?.claimedBy?.userId || "").trim();
  const nextOwner = String(next?.claimedByUserId || next?.claimedBy?.userId || "").trim();
  const prevUpdated = Number(prev?.updatedAt || prev?.claimedAt || 0);
  const nextUpdated = Number(next?.updatedAt || next?.claimedAt || 0);

  if (nextOwner && !prevOwner) return next;
  if (prevOwner && !nextOwner) return prev;
  if (nextUpdated >= prevUpdated) return next;
  return prev;
}

function resolveLiveRoomSlotTimeWindow(slot: any) {
  const explicitStart = Number(slot?.startMs || 0);
  const explicitEnd = Number(slot?.endMs || 0);
  if (explicitStart > 0 && explicitEnd > explicitStart) {
    return { startMs: explicitStart, endMs: explicitEnd };
  }

  const startsAtMs = parseIsoMs(slot?.startsAt);
  const endsAtMs = parseIsoMs(slot?.endsAt);
  if (startsAtMs > 0 && endsAtMs > startsAtMs) {
    return { startMs: startsAtMs, endMs: endsAtMs };
  }

  const startMs = parseSlotStartMs(slot);
  const endMs = parseSlotEndMs(slot, startMs);
  return { startMs, endMs };
}

function liveStageSlotNumber(slot: any) {
  return Number(slot?.slot || slot?.slotNumber || slot?.order || 0);
}

function liveStageSlotId(slot: any) {
  return String(slot?.id || slot?.slotId || "").trim();
}

function slotMatchesLiveStageTarget(slot: any, target: any) {
  const targetId = liveStageSlotId(target);
  const slotId = liveStageSlotId(slot);
  if (targetId && slotId && targetId === slotId) return true;

  const targetNum = liveStageSlotNumber(target);
  const slotNum = liveStageSlotNumber(slot);
  return targetNum > 0 && slotNum > 0 && targetNum === slotNum;
}

function ringHintToScheduleSlot(hint: any) {
  if (hint?.slot && typeof hint.slot === "object") return hint.slot;
  return {
    id: hint?.slotId,
    slot: hint?.slotNumber,
    slotNumber: hint?.slotNumber,
    startMs: hint?.startMs,
    endMs: hint?.endMs,
    claimedByUserId: hint?.userId,
    claimedByName: hint?.name,
  };
}

function slotTimeRichnessScore(slot: any) {
  const win = resolveLiveRoomSlotTimeWindow(slot);
  if (win.startMs > 0 && win.endMs > win.startMs) return 3;
  if (win.startMs > 0) return 2;
  if (
    Number(slot?.startMs || 0) > 0 ||
    Number(slot?.endMs || 0) > 0 ||
    String(slot?.startsAt || "").trim() ||
    String(slot?.endsAt || "").trim() ||
    String(slot?.startTime || "").trim()
  ) {
    return 1;
  }
  return 0;
}

/** Prefer the richest non-zero slot window across candidate rows. */
export function pickRichestSlotTimeFromSources(...sources: any[]) {
  let bestStart = 0;
  let bestEnd = 0;
  let bestScore = 0;

  for (const raw of sources) {
    if (!raw) continue;
    const win = resolveLiveRoomSlotTimeWindow(raw);
    const score = slotTimeRichnessScore(raw);
    if (
      score > bestScore ||
      (score === bestScore && win.endMs > bestEnd && win.startMs > 0)
    ) {
      bestStart = win.startMs;
      bestEnd = win.endMs;
      bestScore = score;
    }
  }

  return { startMs: bestStart, endMs: bestEnd };
}

export type LiveMainStageSlotRepairInput = {
  slot: any | null;
  routeScheduleSlots?: any[];
  runtimeScheduleSlots?: any[];
  backendScheduleSlots?: any[];
  mergedScheduleSlots?: any[];
  feedScheduleSlots?: any[];
  ringClaimHints?: any[];
  routeParams?: {
    scheduleStartMs?: number;
    scheduleEndMs?: number;
    currentSlotNumber?: number;
  };
  liveScheduleFeedId?: string;
  context?: string;
};

/** Repair lost startMs/endMs on the active live stage slot from richer schedule sources. */
export function repairLiveMainStageSlotTimes(input: LiveMainStageSlotRepairInput) {
  const slot = input.slot;
  if (!slot) return null;

  const currentWin = resolveLiveRoomSlotTimeWindow(slot);
  const hasValidWindow =
    currentWin.startMs > 0 && currentWin.endMs > currentWin.startMs;

  if (hasValidWindow) {
    return {
      ...slot,
      startMs: currentWin.startMs,
      endMs: currentWin.endMs,
    };
  }

  console.log("KRISTO_LIVE_SLOT_TIME_REPAIR_START", {
    context: input.context || "live-room",
    slot: liveStageSlotNumber(slot),
    slotId: liveStageSlotId(slot),
    startMs: currentWin.startMs,
    endMs: currentWin.endMs,
  });

  const candidates: any[] = [slot];
  const pools = [
    ...(input.routeScheduleSlots || []),
    ...(input.runtimeScheduleSlots || []),
    ...(input.mergedScheduleSlots || []),
    ...(input.backendScheduleSlots || []),
    ...(input.feedScheduleSlots || []),
  ];

  for (const row of pools) {
    if (slotMatchesLiveStageTarget(row, slot)) candidates.push(row);
  }

  const feedBase = baseFeedId(input.liveScheduleFeedId || "");
  for (const hint of input.ringClaimHints || []) {
    const hintBase = baseFeedId(String(hint?.baseFeedId || hint?.feedId || ""));
    if (feedBase && hintBase && hintBase !== feedBase) continue;

    const hintSlot = ringHintToScheduleSlot(hint);
    if (
      slotMatchesLiveStageTarget(hintSlot, slot) ||
      Number(hint?.slotNumber || 0) === liveStageSlotNumber(slot)
    ) {
      candidates.push(hintSlot);
    }
  }

  const routeStart = Number(input.routeParams?.scheduleStartMs || 0);
  const routeEnd = Number(input.routeParams?.scheduleEndMs || 0);
  if (routeStart > 0 && routeEnd > routeStart) {
    candidates.push({ startMs: routeStart, endMs: routeEnd, source: "route-params" });
  }

  const richest = pickRichestSlotTimeFromSources(...candidates);
  if (richest.startMs > 0 && richest.endMs > richest.startMs) {
    console.log("KRISTO_LIVE_SLOT_TIME_REPAIR_DONE", {
      context: input.context || "live-room",
      slot: liveStageSlotNumber(slot),
      slotId: liveStageSlotId(slot),
      startMs: richest.startMs,
      endMs: richest.endMs,
      candidateCount: candidates.length,
    });
    return {
      ...slot,
      startMs: richest.startMs,
      endMs: richest.endMs,
    };
  }

  console.log("KRISTO_LIVE_SLOT_TIME_REPAIR_MISSING", {
    context: input.context || "live-room",
    slot: liveStageSlotNumber(slot),
    slotId: liveStageSlotId(slot),
    candidateCount: candidates.length,
    routeStartMs: routeStart || null,
    routeEndMs: routeEnd || null,
  });

  return {
    ...slot,
    startMs: currentWin.startMs,
    endMs: currentWin.endMs,
  };
}

function mergeLiveRoomScheduleSlotRow(prev: any, next: any) {
  const picked = pickFresherScheduleSlot(prev, next);
  const other = picked === prev ? next : prev;
  const pickedWin = resolveLiveRoomSlotTimeWindow(picked);
  const otherWin = resolveLiveRoomSlotTimeWindow(other);

  const startMs =
    pickedWin.startMs > 0
      ? pickedWin.startMs
      : otherWin.startMs > 0
        ? otherWin.startMs
        : Number(picked.startMs || other.startMs || 0);

  let endMs =
    pickedWin.endMs > startMs
      ? pickedWin.endMs
      : otherWin.endMs > startMs
        ? otherWin.endMs
        : Number(picked.endMs || other.endMs || 0);

  return {
    ...other,
    ...picked,
    startMs,
    endMs,
    startsAt: String(picked.startsAt || other.startsAt || "").trim(),
    endsAt: String(picked.endsAt || other.endsAt || "").trim(),
    startTime: String(picked.startTime || other.startTime || "").trim(),
    endTime: String(picked.endTime || other.endTime || "").trim(),
    meetingDate: String(picked.meetingDate || other.meetingDate || "").trim(),
    meetingEndDate: String(picked.meetingEndDate || other.meetingEndDate || "").trim(),
    durationMin: Math.max(Number(picked.durationMin || 0), Number(other.durationMin || 0), 1),
  };
}

/** Merge schedule slot arrays for live room — prefers claimed / fresher rows. */
export function mergeLiveRoomScheduleSlots(...sources: any[][]) {
  const byKey = new Map<string, any>();
  let walkIndex = 0;

  for (const source of sources) {
    const normalized = normalizeLiveScheduleSlots(Array.isArray(source) ? source : []);
    normalized.forEach((slot, index) => {
      const key = liveRoomSlotKey(slot, walkIndex + index);
      const prev = byKey.get(key);
      byKey.set(key, prev ? mergeLiveRoomScheduleSlotRow(prev, slot) : slot);
    });
    walkIndex += normalized.length;
  }

  return Array.from(byKey.values()).sort(
    (a, b) => Number(a?.slot || a?.slotNumber || 0) - Number(b?.slot || b?.slotNumber || 0)
  );
}

export function applyRingClaimHintsToScheduleSlots(
  slots: any[],
  feedId: string,
  hints: Array<{
    baseFeedId: string;
    slotId: string;
    userId: string;
    name?: string;
    role?: string;
    avatarUri?: string;
    slotNumber?: number;
  }>,
  rows: any[] = []
) {
  const base = baseFeedId(feedId);
  if (!base || !hints.length) return slots;

  const aliasSet = new Set(collectScheduleAliasIds(base, rows));

  return slots.map((slot, index) => {
    const slotId = String(slot?.id || slot?.slotId || "").trim();
    const slotNum = Number(slot?.slot || slot?.slotNumber || index + 1);
    const hint = hints.find((row) => {
      const hintBase = baseFeedId(row.baseFeedId);
      const matchesFeed =
        hintBase === base ||
        aliasSet.has(hintBase) ||
        aliasSet.has(String(row.baseFeedId || ""));
      if (!matchesFeed) return false;
      if (slotId && String(row.slotId || "") === slotId) return true;
      return Number(row.slotNumber || 0) === slotNum;
    });

    if (!hint) return slot;
    if (String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()) return slot;

    const avatar = sanitizePersistedClaimAvatarUri(
      hint.avatarUri || slot?.claimedByAvatar,
      "ring-hint-enrich"
    );
    return normalizeLiveScheduleSlot(
      {
        ...slot,
        claimed: true,
        isClaimed: true,
        claimedByUserId: hint.userId,
        claimedByName: hint.name || "Member",
        claimedByAvatarUri: avatar,
        claimedByAvatar: avatar,
        claimedBy: {
          userId: hint.userId,
          name: hint.name || "Member",
          role: hint.role || "Member",
          avatarUri: avatar,
        },
      },
      index
    );
  });
}

export function resolveActiveSlotSpeaker(slot: any, index = 0) {
  const slotNumber = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
  const claimedByUserId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
  const explicitProgramTitle = String(
    slot?.slotLabel || slot?.task || slot?.script || slot?.title || ""
  ).trim();
  const programTitle =
    explicitProgramTitle ||
    (claimedByUserId ? String(slot?.name || "").trim() : "") ||
    `Slot ${slotNumber}`;
  const speakerName = claimedByUserId
    ? String(slot?.claimedByName || slot?.claimedBy?.name || slot?.name || "").trim()
    : "";

  return {
    slotNumber,
    claimedByUserId,
    isClaimed: !!claimedByUserId,
    programTitle,
    speakerName,
    displayTitle: claimedByUserId ? speakerName || programTitle : programTitle,
    liveBannerTitle: claimedByUserId
      ? `${(speakerName || programTitle).toUpperCase()} IS LIVE`
      : `${programTitle.toUpperCase()} • OPEN SLOT`,
  };
}

export function enrichScheduleSlotsFromLiveRequests(
  slots: any[],
  _requests: Record<string, any> | null | undefined,
  _liveId?: string
) {
  // Join/waiting requests are separate from schedule slot claims.
  // Never promote a live request into claimedByUserId on the schedule row.
  return slots;
}

/** Resolve backend feed_* id for Live ring → Live Room navigation. */
export function resolveLiveRingCanonicalFeedId(
  item: any,
  rows: any[] = []
): { canonicalFeedId: string; localScheduleId: string } {
  const candidates = [
    item?.backendFeedId,
    item?.feedId,
    item?.sourceScheduleId,
    item?.id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  let canonicalFeedId = "";
  for (const candidate of candidates) {
    if (!isBackendFeedScheduleId(candidate)) continue;
    canonicalFeedId = baseFeedId(candidate) || candidate;
    break;
  }

  let localScheduleId = "";
  for (const candidate of candidates) {
    if (!isLocalMediaScheduleId(candidate)) continue;
    localScheduleId = candidate;
    break;
  }

  if (!canonicalFeedId) {
    const seed =
      localScheduleId ||
      String(item?.sourceScheduleId || item?.id || item?.feedId || "").trim();
    const resolved = resolveCanonicalScheduleFeedId(seed, rows);
    if (isBackendFeedScheduleId(resolved)) canonicalFeedId = resolved;
  }

  if (!canonicalFeedId) {
    for (const candidate of candidates) {
      const resolved = resolveCanonicalScheduleFeedId(candidate, rows);
      if (isBackendFeedScheduleId(resolved)) {
        canonicalFeedId = resolved;
        break;
      }
    }
  }

  if (!canonicalFeedId) {
    canonicalFeedId =
      candidates.find((candidate) => isBackendFeedScheduleId(candidate)) ||
      baseFeedId(item?.id) ||
      "media-live-default";
  }

  return { canonicalFeedId, localScheduleId };
}

export type LeanLiveRouteSlot = {
  id: string;
  slotNumber: number;
  startMs: number;
  endMs: number;
  claimedByUserId: string;
  claimedByName: string;
  claimedByAvatarUri: string;
  status: string;
  title: string;
  meetingDay: string;
  startTime: string;
  endTime: string;
  durationMin: number;
};

const LEAN_ROUTE_AVATAR_MAX_LEN = 512;
const LEAN_ROUTE_TITLE_MAX_LEN = 120;

/** Route params must never carry base64 blobs or nested schedule objects. */
export function sanitizeLeanRouteAvatarUri(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value || value.startsWith("data:")) return "";
  if (value.length > LEAN_ROUTE_AVATAR_MAX_LEN) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("file://")) return value;
  if (value.startsWith("/uploads/")) return value;
  return "";
}

export function utf8JsonByteLength(json: string): number {
  try {
    return new TextEncoder().encode(json).length;
  } catch {
    return unescape(encodeURIComponent(json)).length;
  }
}

function leanSlotWindowMs(slot: any, index: number) {
  const existingStart = Number(slot?.startMs || 0);
  const existingEnd = Number(slot?.endMs || 0);
  if (existingStart > 0 && existingEnd > existingStart) {
    return { startMs: existingStart, endMs: existingEnd };
  }

  const startMs = parseSlotStartMs(slot);
  if (!startMs) return { startMs: 0, endMs: 0 };

  const endMs = parseSlotEndMs(slot, startMs);
  return { startMs, endMs: endMs > startMs ? endMs : 0 };
}

export function toLeanLiveRouteSlot(slot: any, index = 0): LeanLiveRouteSlot {
  const slotNumber = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
  const claimedByObj =
    typeof slot?.claimedBy === "object" && slot?.claimedBy ? slot.claimedBy : null;
  const { startMs, endMs } = leanSlotWindowMs(slot, index);
  const claimedByName = String(
    slot?.claimedByName ||
      slot?.claimedByDisplayName ||
      (claimedByObj && typeof claimedByObj === "object"
        ? claimedByObj.name || claimedByObj.displayName
        : typeof slot?.claimedBy === "string"
          ? slot.claimedBy
          : "") ||
      ""
  )
    .trim()
    .slice(0, 80);

  const rawStatus = String(slot?.status || "").trim().toLowerCase();
  const status =
    rawStatus ||
    (slot?.claimed === true || slot?.isClaimed === true || claimedByName ? "claimed" : "open");

  return {
    id: String(slot?.id || slot?.slotId || `slot-${slotNumber}`).slice(0, 80),
    slotNumber,
    startMs,
    endMs,
    claimedByUserId: String(slot?.claimedByUserId || claimedByObj?.userId || "")
      .trim()
      .slice(0, 64),
    claimedByName,
    claimedByAvatarUri: sanitizeLeanRouteAvatarUri(
      slot?.claimedByAvatarUri ||
        slot?.claimedByAvatar ||
        slot?.avatarUri ||
        claimedByObj?.avatarUri ||
        claimedByObj?.avatarUrl
    ),
    status: status.slice(0, 24),
    title: String(slot?.title || slot?.name || slot?.slotLabel || `Slot ${slotNumber}`)
      .trim()
      .slice(0, LEAN_ROUTE_TITLE_MAX_LEN),
    meetingDay: String(slot?.meetingDay || slot?.meetingDate || "").trim().slice(0, 32),
    startTime: String(slot?.startTime || slot?.time || "").trim().slice(0, 16),
    endTime: String(slot?.endTime || "").trim().slice(0, 16),
    durationMin: Math.max(
      0,
      Math.min(999, Number(slot?.durationMin || slot?.durationMinutes || 0))
    ),
  };
}

/** Compact slot payload for live-room route params (no blobs/nested profile data). */
export function buildLeanLiveScheduleSlotsJson(slots: any[]) {
  const list = Array.isArray(slots) ? slots : [];
  const lean = list.map((slot, index) => toLeanLiveRouteSlot(slot, index));
  const json = JSON.stringify(lean);
  const byteLen = utf8JsonByteLength(json);

  if (byteLen > 20_000) {
    console.log("KRISTO_LIVE_ROUTE_SLOTS_JSON_LARGE", {
      byteLen,
      slotCount: lean.length,
      warn: "route_slot_json_over_20kb",
    });
  }

  return json;
}

export function parseLiveAllScheduleSlotsJson(rawParam: unknown) {
  try {
    const rawValue = Array.isArray(rawParam)
      ? String(rawParam[rawParam.length - 1] || "")
      : String(rawParam || "");

    const raw = rawValue.trim();
    if (!raw) return [];

    const jsonText =
      raw.startsWith("%") || raw.includes("%7B") || raw.includes("%5B")
        ? decodeURIComponent(raw)
        : raw;

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return normalizeLiveScheduleSlots(
      parsed.map((slot: any, index: number) => toLeanLiveRouteSlot(slot, index))
    );
  } catch {
    return [];
  }
}

export const SLOT_STATE_THEMES: Record<
  ScheduleSlotPhase,
  { accent: string; border: string; glow: string; label: string; gradient: [string, string, string] }
> = {
  open: {
    accent: "#38BDF8",
    border: "rgba(56,189,248,0.55)",
    glow: "rgba(56,189,248,0.35)",
    label: "OPEN SLOT",
    gradient: ["#07111F", "#0B1A2E", "#050A14"],
  },
  claimed: {
    accent: "#A78BFA",
    border: "rgba(167,139,250,0.58)",
    glow: "rgba(167,139,250,0.32)",
    label: "CLAIMED",
    gradient: ["#120B1F", "#1A1230", "#0A0612"],
  },
  live: {
    accent: "#FF375F",
    border: "rgba(255,55,95,0.72)",
    glow: "rgba(255,55,95,0.42)",
    label: "LIVE NOW",
    gradient: ["#1A0710", "#240812", "#120509"],
  },
  ended: {
    accent: "#64748B",
    border: "rgba(100,116,139,0.45)",
    glow: "rgba(100,116,139,0.18)",
    label: "ENDED",
    gradient: ["#10141C", "#141A24", "#0A0D12"],
  },
  upcoming: {
    accent: "#F7D36A",
    border: "rgba(247,211,106,0.62)",
    glow: "rgba(247,211,106,0.28)",
    label: "UPCOMING",
    gradient: ["#14110A", "#1A160D", "#0C0A06"],
  },
};
