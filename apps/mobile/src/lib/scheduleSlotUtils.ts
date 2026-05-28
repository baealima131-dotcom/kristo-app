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

export function parseSlotClockMs(rawDate: string, rawTime: string) {
  if (!rawDate || !rawTime) return 0;

  const base = new Date(rawDate);
  if (!Number.isFinite(base.getTime())) return 0;

  const [timePart = "12:00", meridiemRaw = "AM"] = rawTime.split(" ");
  const [hhRaw = "12", mmRaw = "00"] = timePart.split(":");

  let hh = Number(hhRaw || 0);
  const mm = Number(mmRaw || 0);
  const meridiem = meridiemRaw.toUpperCase();

  if (meridiem === "PM" && hh < 12) hh += 12;
  if (meridiem === "AM" && hh === 12) hh = 0;

  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0).getTime();
}

export function parseSlotStartMs(slot: any) {
  const rawDate = String(slot?.meetingDate || slot?.meetingDay || "").trim();
  const rawTime = String(slot?.startTime || slot?.time || "").trim();

  if (!rawDate) return 0;

  const base = new Date(rawDate);
  if (!Number.isFinite(base.getTime())) return 0;
  if (!rawTime) return base.getTime();

  return parseSlotClockMs(rawDate, rawTime);
}

export function enrichScheduleSlot(slot: any, index: number, nowMs: number): EnrichedScheduleSlot {
  const startMs = parseSlotStartMs(slot);
  const endMsFromClock = parseSlotClockMs(String(slot?.meetingDate || ""), String(slot?.endTime || ""));
  const durationMs = Math.max(1, Number(slot?.durationMin || 10)) * 60000;
  const endMs = endMsFromClock > startMs ? endMsFromClock : startMs + durationMs;

  return {
    ...slot,
    startMs,
    endMs,
    isLiveNow: startMs > 0 && endMs > 0 && nowMs >= startMs && nowMs <= endMs,
    isUpcoming: startMs > nowMs,
    isEnded: endMs > 0 && nowMs > endMs,
  };
}

export function resolveSlotPhase(slot: EnrichedScheduleSlot, claimed: boolean): ScheduleSlotPhase {
  if (slot.isEnded) return "ended";
  if (slot.isLiveNow) return "live";
  if (claimed) return "claimed";
  if (slot.isUpcoming) return "upcoming";
  return "open";
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
  if (trimmed.includes("/profile-avatars/")) return "";
  if (trimmed.startsWith("/uploads/")) return `${apiBase}${trimmed}`;
  return trimmed;
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

export function resolveScheduleAvatarUri(item: any, apiBase: string) {
  const candidates = [
    item?.mediaAvatarUri,
    item?.churchAvatarUri,
    item?.churchAvatarUrl,
    item?.actorAvatarUri,
    item?.avatarUri,
  ];

  for (const raw of candidates) {
    const uri = resolveAvatarUri(String(raw || ""), apiBase);
    if (uri) return uri;
  }
  return "";
}

export type MediaSlotAvatarResolution = {
  uri: string;
  source: string;
  hasAvatar: boolean;
};

function pickMediaSlotAvatarRaw(slot: any, claimedBy: any): Array<[string, unknown]> {
  return [
    ["slot.claimedByAvatarUri", slot?.claimedByAvatarUri],
    ["slot.claimedByAvatar", slot?.claimedByAvatar],
    ["slot.claimedByAvatarUrl", slot?.claimedByAvatarUrl],
    ["claimedBy.avatarUri", claimedBy?.avatarUri],
    ["claimedBy.avatarUrl", claimedBy?.avatarUrl],
    ["claimedBy.profileImage", claimedBy?.profileImage],
    ["claimedBy.photoURL", claimedBy?.photoURL],
    ["claimedBy.image", claimedBy?.image],
    ["slot.avatarUri", slot?.avatarUri],
    ["slot.avatarUrl", slot?.avatarUrl],
    ["slot.profileImage", slot?.profileImage],
    ["slot.photoURL", slot?.photoURL],
    ["slot.image", slot?.image],
  ];
}

export function toMediaSlotAbsoluteAvatarUri(raw: string, apiBase: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("data:image") ||
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("file://")
  ) {
    return trimmed;
  }

  const base = String(apiBase || "").replace(/\/$/, "");
  if (trimmed.startsWith("/")) return base ? `${base}${trimmed}` : trimmed;
  return trimmed;
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
  const slot = args.slot || {};
  const slotId = String(args.slotId || slot?.id || "").trim();
  const claimedBy = slot?.claimedBy;
  const claimedByUserId = String(slot?.claimedByUserId || claimedBy?.userId || "").trim();

  for (const [source, raw] of pickMediaSlotAvatarRaw(slot, claimedBy)) {
    const uri = toMediaSlotAbsoluteAvatarUri(String(raw || ""), args.apiBase);
    if (uri) {
      console.log("[MediaSlotAvatar]", {
        slotId,
        claimedByUserId,
        hasAvatar: true,
        source,
      });
      return { uri, source, hasAvatar: true };
    }
  }

  if (claimedByUserId && args.profileAvatarByUserId?.[claimedByUserId]) {
    const uri = toMediaSlotAbsoluteAvatarUri(
      args.profileAvatarByUserId[claimedByUserId],
      args.apiBase
    );
    if (uri) {
      console.log("[MediaSlotAvatar]", {
        slotId,
        claimedByUserId,
        hasAvatar: true,
        source: "profile-cache",
      });
      return { uri, source: "profile-cache", hasAvatar: true };
    }
  }

  if (claimedByUserId && args.memberAvatarByUserId?.[claimedByUserId]) {
    const uri = toMediaSlotAbsoluteAvatarUri(
      args.memberAvatarByUserId[claimedByUserId],
      args.apiBase
    );
    if (uri) {
      console.log("[MediaSlotAvatar]", {
        slotId,
        claimedByUserId,
        hasAvatar: true,
        source: "church-members-cache",
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
    const uri = toMediaSlotAbsoluteAvatarUri(args.sessionAvatarUri, args.apiBase);
    if (uri) {
      console.log("[MediaSlotAvatar]", {
        slotId,
        claimedByUserId,
        hasAvatar: true,
        source: "session-profile",
      });
      return { uri, source: "session-profile", hasAvatar: true };
    }
  }

  console.log("[MediaSlotAvatar]", {
    slotId,
    claimedByUserId,
    hasAvatar: false,
    source: "initials-fallback",
  });
  return { uri: "", source: "initials-fallback", hasAvatar: false };
}

export function patchMediaSlotClaimAvatarFields(slot: any, avatarUri: string) {
  const uri = String(avatarUri || "").trim();
  if (!uri) return slot;

  const claimedByUserId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
  const claimedBy = slot?.claimedBy && typeof slot.claimedBy === "object" ? slot.claimedBy : null;

  return {
    ...slot,
    claimedByAvatarUri: uri,
    claimedByAvatar: uri,
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

export function baseFeedId(input: unknown) {
  const id = String(input || "")
    .replace(/__fy_\d+$/g, "")
    .trim();
  if (!id) return "";
  return id.split("__slot_")[0];
}

export function resolveLiveScheduleFeedId(input: Record<string, unknown> | null | undefined) {
  const candidates = [
    input?.sourceScheduleId,
    input?.feedId,
    input?.liveId,
    input?.schedulePostId,
    input?.id,
  ];

  for (const value of candidates) {
    const id = baseFeedId(value);
    if (id) return id;
  }

  return "";
}

export function normalizeLiveScheduleSlot(slot: any, index = 0) {
  const claimedRaw = slot?.claimedBy;
  const claimedByUserId = String(
    slot?.claimedByUserId ||
      (claimedRaw && typeof claimedRaw === "object" ? claimedRaw.userId : "") ||
      ""
  ).trim();

  const claimedByName = String(
    slot?.claimedByName ||
      slot?.claimedByDisplayName ||
      slot?.claimedByUserName ||
      (claimedRaw && typeof claimedRaw === "object"
        ? claimedRaw.name || claimedRaw.displayName || claimedRaw.username || claimedRaw.fullName
        : claimedRaw) ||
      ""
  ).trim();

  const claimedAvatar = String(
    slot?.claimedByAvatarUri ||
      slot?.claimedByAvatar ||
      slot?.claimedByAvatarUrl ||
      (claimedRaw && typeof claimedRaw === "object"
        ? claimedRaw.avatarUri ||
          claimedRaw.avatarUrl ||
          claimedRaw.profileImage ||
          claimedRaw.photoURL ||
          claimedRaw.image
        : "") ||
      ""
  ).trim();

  const slotNum = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);

  return {
    ...slot,
    slot: slotNum,
    slotNumber: slotNum,
    order: Number(slot?.order || slotNum),
    claimedByUserId,
    claimedByName,
    ...(claimedByUserId
      ? {
          claimed: slot?.claimed ?? true,
          isClaimed: slot?.isClaimed ?? true,
          claimedByAvatarUri: claimedAvatar,
          claimedByAvatar: claimedAvatar,
          claimedBy: claimedRaw
            ? {
                ...claimedRaw,
                userId: claimedByUserId,
                name: claimedByName || claimedRaw.name,
                avatarUri: claimedAvatar || claimedRaw.avatarUri || "",
              }
            : {
                userId: claimedByUserId,
                name: claimedByName,
                avatarUri: claimedAvatar,
                role: String(slot?.claimedByRole || "Member"),
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

/** Merge schedule slot arrays for live room — prefers claimed / fresher rows. */
export function mergeLiveRoomScheduleSlots(...sources: any[][]) {
  const byKey = new Map<string, any>();
  let walkIndex = 0;

  for (const source of sources) {
    const normalized = normalizeLiveScheduleSlots(Array.isArray(source) ? source : []);
    normalized.forEach((slot, index) => {
      const key = liveRoomSlotKey(slot, walkIndex + index);
      const prev = byKey.get(key);
      byKey.set(key, prev ? pickFresherScheduleSlot(prev, slot) : slot);
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
  }>
) {
  const base = baseFeedId(feedId);
  if (!base || !hints.length) return slots;

  return slots.map((slot, index) => {
    const slotId = String(slot?.id || slot?.slotId || "").trim();
    const slotNum = Number(slot?.slot || slot?.slotNumber || index + 1);
    const hint = hints.find((row) => {
      if (baseFeedId(row.baseFeedId) !== base) return false;
      if (slotId && String(row.slotId || "") === slotId) return true;
      return Number(row.slotNumber || 0) === slotNum;
    });

    if (!hint) return slot;
    if (String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()) return slot;

    const avatar = String(hint.avatarUri || slot?.claimedByAvatar || "").trim();
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

export function enrichScheduleSlotsFromLiveRequests(
  slots: any[],
  requests: Record<string, any> | null | undefined,
  liveId?: string
) {
  if (!Array.isArray(slots) || !slots.length) return slots;
  const reqRows = Object.entries(requests || {});
  if (!reqRows.length) return slots;

  return slots.map((slot, index) => {
    const owner = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
    if (owner) return slot;

    const slotId = String(slot?.id || slot?.slotId || "").trim();
    const slotNum = Number(slot?.slot || slot?.slotNumber || index + 1);

    const match = reqRows.find(([, req]: any) => {
      if (liveId && String(req?.liveId || "").trim() && String(req.liveId) !== String(liveId)) {
        return false;
      }
      if (slotId && String(req?.slotId || "") === slotId) return true;
      return Number(req?.slot || req?.claimNumber || 0) === slotNum;
    });

    if (!match) return slot;

    const req = match[1] as any;
    const userId = String(req?.userId || "").trim();
    if (!userId) return slot;

    const avatar = String(req?.avatar || req?.avatarUri || "").trim();

    console.log("KRISTO_BACKEND_REQUEST_VISIBLE", {
      liveId: liveId || req?.liveId || "",
      slotId,
      slotNumber: slotNum,
      userId,
      status: String(req?.status || "waiting"),
    });

    return normalizeLiveScheduleSlot(
      {
        ...slot,
        claimed: true,
        isClaimed: true,
        claimedByUserId: userId,
        claimedByName: String(req?.name || "Member"),
        claimedByAvatarUri: avatar,
        claimedByAvatar: avatar,
        claimedBy: {
          userId,
          name: String(req?.name || "Member"),
          avatarUri: avatar,
          role: String(req?.role || "Member"),
        },
      },
      index
    );
  });
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
    return Array.isArray(parsed) ? normalizeLiveScheduleSlots(parsed) : [];
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
