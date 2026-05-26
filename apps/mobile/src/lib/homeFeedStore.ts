import AsyncStorage from "@react-native-async-storage/async-storage";
import { baseFeedId, enrichScheduleSlot, normalizeLiveScheduleSlots } from "@/src/lib/scheduleSlotUtils";
import { emitClaimUpdated } from "@/src/lib/kristoProfileEvents";

export type FeedKind = "announcement" | "post" | "testimony" | "counsel" | "live";

export type FeedMediaType = "video" | "image" | "none";

export type FeedItem = {
  id: string;
  kind: FeedKind;
  title?: string;
  body: string;
  mediaType?: FeedMediaType;
  mediaUri?: string;
  videoUrl?: string;
  posterUri?: string;
  createdAt: string; // ISO
  actorLabel?: string; // e.g. "ADMIN"
  churchLabel?: string; // e.g. "TLMC"

  scheduleSlots?: Array<{
    id: string;
    name: string;
    slotLabel?: string;
    durationMin: number;
    startTime: string;
    endTime: string;
    timeLabel?: string;
    role?: string;
    task?: string;
    script?: string;
    chat?: string[];
    meetingDate?: string;
    meetingDay?: string;
  }>;

  // optional reactions
  liked?: boolean;
  saved?: boolean;
  likeCount?: number;
};

export type FeedAvatarResolution = {
  uri: string;
  source: string;
  actorAvatarUri: string;
  mediaAvatarUri: string;
  churchAvatarUri: string;
};

const FEED_AVATAR_BLOCKED = /\/profile-avatars\//i;

export function resolveFeedItemAvatar(
  item: any,
  toAbsoluteUrl: (raw: string) => string
): FeedAvatarResolution {
  const candidates: Array<[string, unknown]> = [
    ["actorAvatar", item?.actorAvatar],
    ["actorAvatarUri", item?.actorAvatarUri],
    ["avatarUri", item?.avatarUri],
    ["profileImage", item?.profileImage],
    ["photoURL", item?.photoURL],
    ["image", item?.image],
    ["churchAvatar", item?.churchAvatar],
    ["churchAvatarUri", item?.churchAvatarUri],
    ["churchAvatarUrl", item?.churchAvatarUrl],
    ["mediaAvatar", item?.mediaAvatar],
    ["mediaAvatarUri", item?.mediaAvatarUri],
    ["actorImage", item?.actorImage],
    ["authorAvatarUri", item?.authorAvatarUri],
    ["avatarUrl", item?.avatarUrl],
  ];

  for (const [source, raw] of candidates) {
    const trimmed = String(raw || "").trim();
    if (!trimmed || FEED_AVATAR_BLOCKED.test(trimmed)) continue;
    const uri = toAbsoluteUrl(trimmed);
    if (!uri) continue;
    return {
      uri,
      source,
      actorAvatarUri: uri,
      mediaAvatarUri: uri,
      churchAvatarUri: uri,
    };
  }

  return {
    uri: "",
    source: "initials",
    actorAvatarUri: "",
    mediaAvatarUri: "",
    churchAvatarUri: "",
  };
}

export function isFeedVideoItem(item: any) {
  return (
    item?.mediaType === "video" ||
    String(item?.type || "").toLowerCase() === "video" ||
    String(item?.kind || "").toLowerCase() === "media" ||
    Boolean(item?.videoUrl) ||
    item?.contentType === "video" ||
    item?.isMediaVideo
  );
}

type Listener = () => void;

const FEED_STORAGE_KEY = "KRISTO_HOME_FEED_V3_RESET";

async function persistFeed(items: any[]) {
  try {
    await AsyncStorage.setItem(
      FEED_STORAGE_KEY,
      JSON.stringify(items)
    );
  } catch (e) {
    console.log("KRISTO_FEED_PERSIST_ERROR", e);
  }
}

async function loadPersistedFeed() {
  try {
    const raw = await AsyncStorage.getItem(FEED_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.log("KRISTO_FEED_LOAD_ERROR", e);
    return [];
  }
}



type FeedStore = {
  items: FeedItem[];
  listeners: Set<Listener>;
};

function getStore(): FeedStore {
  const g = globalThis as any;
  if (!g.__kristoFeed) {
    g.__kristoFeed = {
      items: [] as FeedItem[],
      listeners: new Set<Listener>(),
    } satisfies FeedStore;

    loadPersistedFeed().then((items) => {
      g.__kristoFeed.items = items;
      persistAndEmit();
    });
  }
  return g.__kristoFeed as FeedStore;
}


async function persistAndEmit() {
  const st = getStore();

  try {
    await AsyncStorage.setItem(
      FEED_STORAGE_KEY,
      JSON.stringify(st.items)
    );
  } catch (e) {
    console.log("KRISTO_FEED_SAVE_ERROR", e);
  }

  emit();
}

function emit() {
  const s = getStore();
  s.listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

/**
 * COMPAT exports (already used by church home screens)
 */
export function feedList() {
  return getStore().items;
}

export function subscribe(fn: Listener) {
  const s = getStore();
  s.listeners.add(fn);
  // IMPORTANT: return void cleanup (not boolean)
  return () => {
    s.listeners.delete(fn);
  };
}

export function feedToggleLike(id: string) {
  const s = getStore();
  s.items = s.items.map((it) => {
    if (it.id !== id) return it;
    const liked = !it.liked;
    const likeCount = Math.max(0, (it.likeCount ?? 0) + (liked ? 1 : -1));
    return { ...it, liked, likeCount };
  });
  persistFeed(s.items);
  persistFeed(s.items);
  persistAndEmit();
}

export function feedToggleSave(id: string) {
  const s = getStore();
  s.items = s.items.map((it) => (it.id === id ? { ...it, saved: !it.saved } : it));
  persistFeed(s.items);
  persistAndEmit();
}

/**
 * New helper used by Announcements create-only screen
 */
function feedItemMatchesScheduleId(it: FeedItem, targetId: string): boolean {
  const baseId = baseFeedId(targetId);
  if (!baseId) return false;

  const rowId = String(it.id || "").trim();
  const sourceId = String((it as any)?.sourceScheduleId || "").trim();

  return (
    rowId === baseId ||
    sourceId === baseId ||
    baseFeedId(rowId) === baseId
  );
}

function syncUserClaimedSlotStore(
  postId: string,
  slotId: string,
  claim: {
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
  } | null
) {
  const g = globalThis as any;
  const store = g.__KRISTO_USER_CLAIMED_SLOTS__ || {};
  g.__KRISTO_USER_CLAIMED_SLOTS__ = store;
  const key = `${postId}|${slotId}`;

  if (!claim) {
    delete store[key];
    return;
  }

  const userId = String(claim?.userId || "").trim();
  if (!userId) return;

  store[key] = {
    postId,
    slotId,
    userId,
    name: claim.name || "You",
    role: claim.role || "Member",
    avatarUri: claim.avatarUri || "",
    claimedAt: new Date().toISOString(),
  };
}

export function getUserClaimedSlotEntries(userId?: string) {
  const uid = String(userId || "").trim();
  const store = (globalThis as any).__KRISTO_USER_CLAIMED_SLOTS__ || {};
  const rows = Object.values(store) as any[];
  if (!uid) return rows;
  return rows.filter((row) => String(row?.userId || "").trim() === uid);
}

export type RingClaimHint = {
  feedId: string;
  baseFeedId: string;
  slotId: string;
  slotNumber: number;
  userId: string;
  startMs: number;
  endMs: number;
  name?: string;
  role?: string;
  avatarUri?: string;
  claimedAt: string;
  churchId?: string;
  item?: any;
  slot?: any;
  updatedAt: number;
};

function writeRingClaimHint(hint: RingClaimHint) {
  const g = globalThis as any;
  const store = g.__KRISTO_RING_CLAIM_HINTS__ || {};
  g.__KRISTO_RING_CLAIM_HINTS__ = store;
  store[`${hint.userId}|${hint.baseFeedId}|${hint.slotId}`] = hint;
}

export function getRingClaimHints(userId?: string): RingClaimHint[] {
  const store = (globalThis as any).__KRISTO_RING_CLAIM_HINTS__ || {};
  const rows = Object.values(store) as RingClaimHint[];
  const uid = String(userId || "").trim();
  if (!uid) return rows;
  return rows.filter((row) => String(row?.userId || "").trim() === uid);
}

function clearRingClaimHint(baseFeedIdValue: string, slotId: string, userId: string) {
  const g = globalThis as any;
  const store = g.__KRISTO_RING_CLAIM_HINTS__ || {};
  delete store[`${userId}|${baseFeedIdValue}|${slotId}`];
}

function slotIdsMatch(slot: any, slotId: string): boolean {
  const target = String(slotId || "").trim();
  if (!target) return false;
  const candidates = [
    slot?.id,
    slot?.slotId,
    slot?.slot,
    slot?.order,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return candidates.some((value) => value === target);
}

function feedItemMatchesClaimTarget(it: FeedItem, baseId: string, slotId: string): boolean {
  if (!baseId) return false;
  if (feedItemMatchesScheduleId(it, baseId)) return true;

  const rowId = String(it.id || "").trim();
  if (baseFeedId(rowId) === baseId && rowId.includes("__slot_")) {
    const slots = Array.isArray((it as any)?.scheduleSlots) ? (it as any).scheduleSlots : [];
    if (slots.length === 1 && slotIdsMatch(slots[0], slotId)) return true;
  }

  return false;
}

function applyClaimPatchToSlot(
  slot: any,
  slotId: string,
  claim: {
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
  }
) {
  if (!slotIdsMatch(slot, slotId)) return slot;
  if (slot.locked) return slot;

  const existingOwner = String(
    slot?.claimedByUserId || slot?.claimedBy?.userId || ""
  ).trim();
  if (existingOwner && existingOwner !== String(claim?.userId || "").trim()) {
    return slot;
  }

  const claimedAt = String(slot?.claimedAt || slot?.claimedBy?.claimedAt || new Date().toISOString());

  return {
    ...slot,
    claimed: true,
    isClaimed: true,
    status: "claimed",
    claimedAt,
    claimedByUserId: String(claim?.userId || ""),
    claimedByName: claim?.name || slot?.claimedByName || "You",
    claimedByAvatar: claim?.avatarUri || slot?.claimedByAvatar || "",
    claimedBy: {
      slotId,
      userId: String(claim?.userId || ""),
      name: claim?.name || slot?.claimedByName || "You",
      role: claim?.role || slot?.claimedByRole || "Member",
      avatarUri: claim?.avatarUri || slot?.claimedByAvatar || "",
      claimedAt,
    },
  };
}

function patchScheduleCollections(
  anyIt: any,
  slotId: string,
  claim: {
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
  }
) {
  let changed = false;
  let claimedSlot: any = null;
  let claimedIndex = -1;

  const patchSlots = (slots: any[]) =>
    slots.map((slot: any, index: number) => {
      const next = applyClaimPatchToSlot(slot, slotId, claim);
      if (next !== slot) {
        changed = true;
        claimedSlot = next;
        claimedIndex = index;
      }
      return next;
    });

  const scheduleSlots = Array.isArray(anyIt.scheduleSlots)
    ? patchSlots(anyIt.scheduleSlots)
    : anyIt.scheduleSlots;

  const allScheduleSlotsForLive = Array.isArray(anyIt.allScheduleSlotsForLive)
    ? patchSlots(anyIt.allScheduleSlotsForLive)
    : anyIt.allScheduleSlotsForLive;

  return {
    changed,
    claimedSlot,
    claimedIndex,
    scheduleSlots,
    allScheduleSlotsForLive,
  };
}

function resolveClaimWindow(slot: any, index = 0) {
  const enriched = enrichScheduleSlot(slot, index, Date.now());
  const startMs = Number(slot?.startMs) > 0 ? Number(slot.startMs) : enriched.startMs;
  const endMs = Number(slot?.endMs) > 0 ? Number(slot.endMs) : enriched.endMs;
  const slotNumber = Number(
    slot?.slot || slot?.slotNumber || slot?.order || index + 1
  );

  return { startMs, endMs, slotNumber };
}

export function feedAdd(item: FeedItem) {
  const s = getStore();
  s.items = [
    {
      likeCount: 0,
      liked: false,
      saved: false,
      ...item,
    },
    ...s.items,
  ];
  persistAndEmit();
}


export function feedClaimSchedule(
  id: string,
  claim?: {
    slotId?: string;
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
    startMs?: number;
    endMs?: number;
    slotNumber?: number;
    churchId?: string;
    slot?: any;
    item?: any;
  }
) {
  const s = getStore();
  const baseId = baseFeedId(id) || String(id || "").trim();
  const slotId = String(claim?.slotId || "").trim();
  const userId = String(claim?.userId || "").trim();
  if (!baseId || !slotId || !userId || !claim) return;

  let anyChanged = false;
  let claimMeta: {
    startMs: number;
    endMs: number;
    slotNumber: number;
    item: any;
    slot: any;
    index: number;
  } | null = null;

  if (claim.slot) {
    const { startMs, endMs, slotNumber } = resolveClaimWindow(
      claim.slot,
      Math.max(0, Number(claim.slotNumber || 0) - 1)
    );
    claimMeta = {
      startMs: Number(claim.startMs || startMs || 0),
      endMs: Number(claim.endMs || endMs || 0),
      slotNumber: Number(claim.slotNumber || slotNumber || 0),
      item: claim.item || null,
      slot: claim.slot,
      index: Math.max(0, Number(claim.slotNumber || slotNumber || 1) - 1),
    };
  }

  s.items = s.items.map((it) => {
    if (!feedItemMatchesClaimTarget(it, baseId, slotId)) return it;

    const anyIt = it as any;
    if (!Array.isArray(anyIt.scheduleSlots) || !anyIt.scheduleSlots.length) return it;

    const patched = patchScheduleCollections(anyIt, slotId, claim);
    if (!patched.changed) return it;

    anyChanged = true;

    if (patched.claimedSlot && !claimMeta) {
      const { startMs, endMs, slotNumber } = resolveClaimWindow(
        patched.claimedSlot,
        Math.max(0, patched.claimedIndex)
      );
      claimMeta = {
        startMs,
        endMs,
        slotNumber,
        item: anyIt,
        slot: patched.claimedSlot,
        index: Math.max(0, patched.claimedIndex),
      };
    }

    const isPerSlotRow = String(it.id || "").includes("__slot_");
    const topLevelClaimPatch = isPerSlotRow
      ? {
          claimed: true,
          isClaimed: true,
          status: "claimed",
          claimedByUserId: userId,
          claimedByName: claim.name || "You",
          claimedByAvatar: claim.avatarUri || "",
          claimedBy: {
            slotId,
            userId,
            name: claim.name || "You",
            role: claim.role || "Member",
            avatarUri: claim.avatarUri || "",
            claimedAt: new Date().toISOString(),
          },
        }
      : {};

    return {
      ...it,
      ...topLevelClaimPatch,
      scheduleSlots: patched.scheduleSlots,
      ...(Array.isArray(patched.allScheduleSlotsForLive)
        ? { allScheduleSlotsForLive: patched.allScheduleSlotsForLive }
        : {}),
      claimedCount: Number(anyIt.claimedCount || 0) + 1,
    } as any;
  });

  const claimedAt = new Date().toISOString();
  syncUserClaimedSlotStore(baseId, slotId, claim);

  const hint: RingClaimHint = {
    feedId: baseId,
    baseFeedId: baseId,
    slotId,
    slotNumber: claimMeta?.slotNumber || 0,
    userId,
    startMs: Number(claimMeta?.startMs || 0),
    endMs: Number(claimMeta?.endMs || 0),
    name: claim.name,
    role: claim.role,
    avatarUri: claim.avatarUri,
    claimedAt,
    churchId: String(claimMeta?.item?.churchId || ""),
    item: claimMeta?.item || null,
    slot: claimMeta?.slot || null,
    updatedAt: Date.now(),
  };

  writeRingClaimHint(hint);

  console.log("KRISTO_CLAIM_LOCAL_SYNC", {
    postId: baseId,
    slotId,
    userId,
    anyChanged,
    startMs: hint.startMs,
    endMs: hint.endMs,
    slotNumber: hint.slotNumber,
  });

  console.log("KRISTO_CLAIM_RING_FAST_SYNC", {
    feedId: baseId,
    baseFeedId: baseId,
    slotId,
    slotNumber: hint.slotNumber,
    userId,
    startMs: hint.startMs,
    endMs: hint.endMs,
    isLiveNow:
      hint.startMs > 0 &&
      hint.endMs > 0 &&
      Date.now() >= hint.startMs &&
      Date.now() <= hint.endMs,
  });

  emitClaimUpdated({
    postId: baseId,
    feedId: baseId,
    baseFeedId: baseId,
    slotId,
    slotNumber: hint.slotNumber,
    userId,
    action: "claim",
    startMs: hint.startMs,
    endMs: hint.endMs,
    claim: {
      ...claim,
      claimedAt,
    },
  });

  if (anyChanged) persistAndEmit();
  else emit();
}

export function feedRemoveWhere(predicate: (item: FeedItem) => boolean) {
  const s = getStore();
  s.items = s.items.filter((it) => !predicate(it));
  persistAndEmit();
}

function isMediaScheduleCard(it: any): boolean {
  const source = String(it?.source || "").toLowerCase();
  const scheduleType = String(it?.scheduleType || "").toLowerCase();
  const id = String(it?.id || "").toLowerCase();

  return (
    source.includes("media-schedule") ||
    scheduleType === "media-live-slots" ||
    id.startsWith("media-live-") ||
    id.startsWith("feed_")
  );
}

export function feedFindMediaScheduleRow(feedId: string) {
  const baseId = baseFeedId(feedId);
  if (!baseId) return null;

  let best: any = null;
  let bestCount = 0;

  for (const row of feedList() as any[]) {
    const rowId = String(row?.id || "").trim();
    const sourceId = String(row?.sourceScheduleId || "").trim();
    const matches =
      rowId === baseId ||
      sourceId === baseId ||
      rowId.startsWith(`${baseId}__slot_`) ||
      baseFeedId(rowId) === baseId;

    if (!matches) continue;

    const slots = Array.isArray(row?.allScheduleSlotsForLive)
      ? row.allScheduleSlotsForLive
      : Array.isArray(row?.scheduleSlots)
        ? row.scheduleSlots
        : [];

    if (slots.length >= bestCount) {
      best = row;
      bestCount = slots.length;
    }
  }

  return best;
}

export function feedScheduleSlotsForLive(feedId: string) {
  const row = feedFindMediaScheduleRow(feedId);
  if (!row) return [] as any[];

  const slots = Array.isArray(row?.allScheduleSlotsForLive)
    ? row.allScheduleSlotsForLive
    : Array.isArray(row?.scheduleSlots)
      ? row.scheduleSlots
      : [];

  return normalizeLiveScheduleSlots(slots);
}

export function isMediaScheduleFeedItem(it: any): boolean {
  const source = String(it?.source || "").toLowerCase();
  const scheduleType = String(it?.scheduleType || "").toLowerCase();
  const byMeta =
    source.includes("media-schedule") ||
    scheduleType === "media-live-slots" ||
    isMediaScheduleCard(it);

  if (!byMeta) return false;
  const slots = Array.isArray(it?.scheduleSlots) ? it.scheduleSlots : [];
  return slots.length > 0;
}

/** Replace optimistic local schedule with durable backend row (same church). */
export function feedSyncMediaScheduleFromBackend(backendItem: any, localId?: string) {
  const backendId = String(backendItem?.id || "").trim();
  const churchId = String(backendItem?.churchId || "").trim();
  if (!backendId || !churchId) return;

  const s = getStore();
  s.items = s.items.filter((it) => {
    const anyIt = it as any;
    if (!isMediaScheduleCard(anyIt)) return true;
    if (localId && String(it.id) === localId) return false;
    if (String(it.id) === backendId) return false;
    if (String(anyIt.churchId || "").trim() === churchId) return false;
    return true;
  });

  s.items.unshift({
    likeCount: 0,
    liked: false,
    saved: false,
    kind: "post",
    body: String(backendItem.text || backendItem.body || ""),
    ...backendItem,
    id: backendId,
    sourceScheduleId: backendId,
    scheduleSlots: Array.isArray(backendItem.scheduleSlots) ? backendItem.scheduleSlots : [],
  } as any);

  persistAndEmit();
  console.log("[ScheduleFeed] local synced from backend", { churchId, sourceScheduleId: backendId });
}

export function feedPurgeMediaScheduleCardsForChurch(churchId: string) {
  const cid = String(churchId || "").trim();
  const s = getStore();

  s.items = s.items.filter((it) => {
    if (!isMediaScheduleCard(it)) return true;
    if (!cid) return false;

    const itemCid = String((it as any)?.churchId || "").trim();
    if (itemCid) return itemCid !== cid;
    return false;
  });

  persistAndEmit();
}

export function feedPurgeMediaScheduleCards() {
  const s = getStore();
  s.items = s.items.filter((it) => !isMediaScheduleCard(it));
  persistAndEmit();
}

export function feedCloseMediaScheduleCards() {
  const s = getStore();
  let changed = false;

  s.items = s.items
    .map((it) => {
      if (!isMediaScheduleCard(it)) return it;
      changed = true;
      return {
        ...it,
        status: "deleted",
        deleted: true,
        scheduleSlots: [],
      } as any;
    })
    .filter((it) => {
      if (isMediaScheduleCard(it)) {
        changed = true;
        return false;
      }
      return true;
    });

  if (changed) persistAndEmit();
}



export function feedUpdateScheduleSlots(
  id: string,
  updater: (slots: any[]) => any[]
) {
  const st = getStore();

  st.items = st.items.map((it) => {
    if (it.id !== id) return it;
    const anyIt = it as any;
    if (!Array.isArray(anyIt.scheduleSlots)) return it;

    return {
      ...it,
      scheduleSlots: updater(anyIt.scheduleSlots),
    } as any;
  });

  persistAndEmit();
}

export function feedUpdateScheduleSlot(
  id: string,
  opts?: {
    slotId?: string;
    patch?: Record<string, any>;
  }
) {
  const st = getStore();
  const slotId = opts?.slotId || "";
  const patch = opts?.patch || {};

  st.items = st.items.map((it) => {
    if (it.id !== id) return it;
    const anyIt = it as any;
    if (!Array.isArray(anyIt.scheduleSlots) || !slotId) return it;

    return {
      ...it,
      scheduleSlots: anyIt.scheduleSlots.map((slot: any) =>
        slot.id === slotId ? { ...slot, ...patch } : slot
      ),
    } as any;
  });

  persistAndEmit();
}

export function feedUnclaimSchedule(
  id: string,
  opts?: {
    slotId?: string;
    userId?: string;
  }
) {
  const store = getStore();
  const baseId = baseFeedId(id);
  let anyChanged = false;

  store.items = store.items.map((it) => {
    if (!feedItemMatchesScheduleId(it, baseId || id)) return it;

    const anyIt = it as any;
    const slotId = opts?.slotId || "";
    const userId = opts?.userId || "";

    if (Array.isArray(anyIt.scheduleSlots) && slotId) {
      let changed = false;

      const scheduleSlots = anyIt.scheduleSlots.map((slot: any) => {
        if (slot.id !== slotId) return slot;

        const claimedBy = slot.claimedBy || null;
        const ownerId = String(slot?.claimedByUserId || claimedBy?.userId || "").trim();
        if (!ownerId && !claimedBy) return slot;

        if (userId && ownerId && ownerId !== userId) return slot;

        changed = true;
        const next = { ...slot };
        delete next.claimedBy;
        delete next.isClaimed;
        delete next.claimedByUserId;
        delete next.claimedByName;
        delete next.claimedByAvatar;
        next.status = "open";
        next.approved = false;
        next.locked = false;
        next.claimed = false;
        delete next.approvedAt;
        return next;
      });

      if (!changed) return it;

      anyChanged = true;
      return {
        ...it,
        scheduleSlots,
        claimedCount: Math.max(0, Number(anyIt.claimedCount || 0) - 1),
      } as any;
    }

    return it;
  });

  if (anyChanged && opts?.slotId) {
    syncUserClaimedSlotStore(baseId || id, String(opts.slotId), null);
    clearRingClaimHint(baseId || id, String(opts.slotId), String(opts.userId || ""));
    console.log("KRISTO_CLAIM_LOCAL_SYNC", {
      postId: baseId || id,
      slotId: opts.slotId,
      userId: opts.userId || "",
      action: "unclaim",
    });
    emitClaimUpdated({
      postId: baseId || id,
      slotId: String(opts.slotId),
      userId: String(opts.userId || ""),
      action: "unclaim",
    });
  }

  if (anyChanged) persistAndEmit();
}



export function feedJoinSlotQueue(
  id: string,
  queue?: {
    slotId?: string;
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
    priority?: boolean;
  }
) {
  const st = getStore();
  st.items = st.items.map((it) => {
    if (it.id !== id) return it;
    const anyIt = it as any;
    const slotId = queue?.slotId || "";
    if (!Array.isArray(anyIt.scheduleSlots) || !slotId) return it;

    const queuedUser = {
      userId: String(queue?.userId || ""),
      name: queue?.name || "You",
      role: queue?.role || "Member",
      avatarUri: queue?.avatarUri || "",
      priority: !!queue?.priority,
      joinedAt: new Date().toISOString(),
      status: "waiting",
    };

    const scheduleSlots = anyIt.scheduleSlots.map((slot: any) => {
      if (slot.id !== slotId) return slot;
      const queueList = Array.isArray(slot.queue) ? slot.queue : [];
      if (queueList.some((x: any) => x?.userId === queuedUser.userId)) return slot;
      return { ...slot, queue: [...queueList, queuedUser] };
    });

    return { ...it, scheduleSlots } as any;
  });
  persistAndEmit();
}
