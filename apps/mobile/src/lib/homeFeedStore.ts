import AsyncStorage from "@react-native-async-storage/async-storage";

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
  }
) {
  const s = getStore();
  s.items = s.items.map((it) => {
    if (it.id !== id) return it;
    const anyIt = it as any;
    const slotId = claim?.slotId || "";
    const claimedBy = {
      userId: String(claim?.userId || ""),
      name: claim?.name || "You",
      role: claim?.role || "Member",
      avatarUri: claim?.avatarUri || "",
      claimedAt: new Date().toISOString(),
    };

    if (Array.isArray(anyIt.scheduleSlots) && slotId) {
      let changed = false;
      const scheduleSlots = anyIt.scheduleSlots.map((slot: any) => {
        if (slot.id !== slotId) return slot;
        if (slot.locked) return slot;
        // Do not auto-hydrate local claimedBy from stale optimistic cache.
        // Claims must come from explicit backend claim state only.
        if (slot.claimedBy || slot.isClaimed || slot.status === "claimed") return slot;
        changed = true;
        return {
          ...slot,
          // claimedBy removed here to prevent view-only auto claim.
          // claimedBy,
          isClaimed: true,
          status: "claimed",
        };
      });

      if (!changed) return it;

      return {
        ...it,
        scheduleSlots,
        claimedCount: Number(anyIt.claimedCount || 0) + 1,
      } as any;
    }

    if (anyIt.claimed) return it;

    return {
      ...it,
      claimed: true,
      claimedSlotId: slotId,
      // claimedBy removed to prevent local auto-claim restore.
      // claimedBy,
      claimedCount: Number(anyIt.claimedCount || 0) + 1,
    } as any;
  });
  persistAndEmit();
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

export function isMediaScheduleFeedItem(it: any): boolean {
  return isMediaScheduleCard(it) && Array.isArray(it?.scheduleSlots) && it.scheduleSlots.length > 0;
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
  store.items = store.items.map((it) => {
    if (it.id !== id) return it;

    const anyIt = it as any;
    const slotId = opts?.slotId || "";
    const userId = opts?.userId || "";

    if (Array.isArray(anyIt.scheduleSlots) && slotId) {
      let changed = false;

      const scheduleSlots = anyIt.scheduleSlots.map((slot: any) => {
        if (slot.id !== slotId) return slot;

        const claimedBy = slot.claimedBy || null;
        if (!claimedBy) return slot;

        // Only owner of claim can unclaim
        if (userId && claimedBy.userId && claimedBy.userId !== userId) return slot;

        changed = true;
        const next = { ...slot };
        delete next.claimedBy;
        delete next.isClaimed;
        next.status = "open";
        next.approved = false;
        next.locked = false;
        delete next.approvedAt;
        return next;
      });

      if (!changed) return it;

      return {
        ...it,
        scheduleSlots,
        claimedCount: Math.max(0, Number(anyIt.claimedCount || 0) - 1),
      } as any;
    }

    return it;
  });

  persistAndEmit();
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
