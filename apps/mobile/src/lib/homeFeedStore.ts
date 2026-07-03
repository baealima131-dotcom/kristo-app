import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  baseFeedId,
  collectScheduleAliasIds,
  enrichScheduleSlot,
  isBackendFeedScheduleId,
  isLocalMediaScheduleId,
  normalizeLiveScheduleSlots,
  resolveCanonicalScheduleFeedId,
  resolvePersistedClaimAvatarUri,
  sanitizePersistedClaimAvatarUri,
} from "@/src/lib/scheduleSlotUtils";
import { emitClaimUpdated } from "@/src/lib/kristoProfileEvents";
import { emitSlotClaimChanged } from "@/src/lib/slotClaimEvents";
import { persistClaimDeleteToBackend } from "@/src/lib/liveBridge";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";

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
  churchId?: string;

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

export function resolveFeedItemAvatar(
  item: any,
  toAbsoluteUrl: (raw: string) => string
): FeedAvatarResolution {
  const candidates: Array<[string, unknown]> = [
    ["authorAvatarUri", item?.authorAvatarUri],
    ["actorAvatarUri", item?.actorAvatarUri],
    ["profileAvatarUri", item?.profileAvatarUri],
    ["authorAvatar", item?.authorAvatar],
    ["actorAvatar", item?.actorAvatar],
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
    ["avatarUrl", item?.avatarUrl],
  ];

  for (const [source, raw] of candidates) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
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
const HOME_FEED_FOR_YOU_SIGNALS_KEY = "kristo_for_you_signals_v1";

/** Primary AsyncStorage key for persisted local Home Feed posts. */
export const HOME_FEED_POSTS_STORAGE_KEY = FEED_STORAGE_KEY;

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
    if (!Array.isArray(parsed)) return [];

    const cleaned = parsed.filter((it: any) => {
      const id = String(it?.id || "");
      const source = String(it?.source || "").toLowerCase();
      return !id.startsWith("local-upload-") && source !== "local-video-upload";
    });

    if (cleaned.length !== parsed.length) {
      void AsyncStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(cleaned));
      if (__DEV__) {
        console.log("KRISTO_HOME_FEED_LOCAL_UPLOADS_AUTO_CLEANED", {
          removed: parsed.length - cleaned.length,
        });
      }
    }

    return cleaned;
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
  emit();

  try {
    await AsyncStorage.setItem(
      FEED_STORAGE_KEY,
      JSON.stringify(st.items)
    );
  } catch (e) {
    console.log("KRISTO_FEED_SAVE_ERROR", e);
  }
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

export function feedRemoveLocalUploads() {
  const s = getStore();
  const before = s.items.length;
  s.items = s.items.filter((it: any) => {
    const id = String(it?.id || "");
    const source = String(it?.source || "").toLowerCase();
    return !id.startsWith("local-upload-") && source !== "local-video-upload";
  });
  const removed = before - s.items.length;
  if (__DEV__) {
    console.log("KRISTO_HOME_FEED_LOCAL_UPLOADS_REMOVED", { removed });
  }
  void persistAndEmit();
  return removed;
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
  const rows = feedList() as any[];
  const aliases = new Set(collectScheduleAliasIds(targetId, rows));
  const baseId = baseFeedId(targetId);
  if (baseId) aliases.add(baseId);

  const rowId = String(it.id || "").trim();
  const sourceId = String((it as any)?.sourceScheduleId || "").trim();

  return (
    aliases.has(rowId) ||
    aliases.has(sourceId) ||
    aliases.has(baseFeedId(rowId))
  );
}

function countClaimedScheduleSlots(slots: unknown): number {
  if (!Array.isArray(slots)) return 0;
  return slots.filter((slot: any) =>
    String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()
  ).length;
}

function enrichScheduleSlotsForStore(slots: unknown, nowMs = Date.now()) {
  return normalizeLiveScheduleSlots(Array.isArray(slots) ? slots : []).map((slot, index) =>
    enrichScheduleSlot(slot, index, nowMs)
  );
}

export function syncUserClaimedSlotStore(
  postId: string,
  slotId: string,
  claim: {
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
    churchId?: string;
    targetChurchId?: string;
    slotNumber?: number;
    startMs?: number;
    endMs?: number;
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
    churchId: String(claim.churchId || claim.targetChurchId || "").trim() || undefined,
    targetChurchId: String(claim.targetChurchId || claim.churchId || "").trim() || undefined,
    slotNumber: Number(claim.slotNumber || 0) || undefined,
    startMs: Number(claim.startMs || 0) || undefined,
    endMs: Number(claim.endMs || 0) || undefined,
    claimedAt: new Date().toISOString(),
  };
}

export function ensurePersonalTabRingClaimFromEvent(payload: {
  action?: string;
  postId?: string;
  feedId?: string;
  baseFeedId?: string;
  slotId?: string;
  userId?: string;
  startMs?: number;
  endMs?: number;
  slotNumber?: number;
  claim?: {
    name?: string;
    role?: string;
    avatarUri?: string;
    avatarUrl?: string;
    churchId?: string;
    slot?: any;
    item?: any;
  };
}) {
  if (payload?.action !== "claim") return false;

  const userId = String(payload.userId || "").trim();
  const postId =
    baseFeedId(String(payload.postId || payload.feedId || payload.baseFeedId || "")) ||
    String(payload.postId || payload.feedId || payload.baseFeedId || "").trim();
  const slotId = String(payload.slotId || "").trim();
  const startMs = Number(payload.startMs || 0);
  const endMs = Number(payload.endMs || 0);
  if (!userId || !postId || !slotId || !startMs || endMs <= 0) return false;

  const existing = getRingClaimHints(userId).some(
    (hint) =>
      String(hint.slotId || "").trim() === slotId &&
      baseFeedId(String(hint.baseFeedId || hint.feedId || "")) === postId &&
      Number(hint.startMs || 0) > 0 &&
      Number(hint.endMs || 0) > 0
  );
  if (existing) return false;

  return persistPersonalTabRingClaimState({
    postId,
    slotId,
    userId,
    claim: payload.claim || {},
    startMs,
    endMs,
    slotNumber: payload.slotNumber,
    source: "claim-updated-event",
  });
}

export function persistPersonalTabRingClaimState(args: {
  postId: string;
  slotId: string;
  userId: string;
  claim: {
    name?: string;
    role?: string;
    avatarUri?: string;
    avatarUrl?: string;
    churchId?: string;
    slot?: any;
    item?: any;
  };
  startMs: number;
  endMs: number;
  slotNumber?: number;
  source?: string;
}) {
  const postId = baseFeedId(String(args.postId || "")) || String(args.postId || "").trim();
  const slotId = String(args.slotId || "").trim();
  const userId = String(args.userId || "").trim();
  const startMs = Number(args.startMs || 0);
  const endMs = Number(args.endMs || 0);
  if (!postId || !slotId || !userId || !startMs || endMs <= 0) return false;

  const slotNumber = Number(args.slotNumber || args.claim?.slot?.slot || args.claim?.slot?.slotNumber || 0);
  const churchId = String(
    args.claim.churchId || args.claim.item?.churchId || ""
  ).trim();
  const hintAvatarUri =
    sanitizePersistedClaimAvatarUri(args.claim.avatarUrl, "ring-claim-hint") ||
    sanitizePersistedClaimAvatarUri(args.claim.avatarUri, "ring-claim-hint") ||
    "";
  const claimedAt = new Date().toISOString();

  syncUserClaimedSlotStore(postId, slotId, {
    userId,
    name: args.claim.name,
    role: args.claim.role,
    avatarUri: hintAvatarUri,
    churchId,
    targetChurchId: churchId,
    slotNumber: slotNumber || undefined,
    startMs,
    endMs,
  });

  const hint: RingClaimHint = {
    feedId: postId,
    baseFeedId: postId,
    slotId,
    slotNumber: slotNumber || 0,
    userId,
    startMs,
    endMs,
    name: args.claim.name,
    role: args.claim.role,
    avatarUri: hintAvatarUri,
    claimedAt,
    churchId,
    item: args.claim.item || null,
    slot: args.claim.slot
      ? {
          ...args.claim.slot,
          id: slotId,
          slotId,
          startMs,
          endMs,
          claimedByUserId: userId,
        }
      : null,
    updatedAt: Date.now(),
  };

  writeRingClaimHint(hint);

  console.log("KRISTO_ME_TAB_RING_CLAIM_PERSIST", {
    source: args.source || "persistPersonalTabRingClaimState",
    postId,
    slotId,
    userId,
    startMs,
    endMs,
    slotNumber: slotNumber || null,
    isLiveNow: Date.now() >= startMs && Date.now() <= endMs,
  });

  emitClaimUpdated({
    postId,
    feedId: postId,
    baseFeedId: postId,
    slotId,
    slotNumber: slotNumber || undefined,
    userId,
    action: "claim",
    startMs,
    endMs,
    claim: {
      userId,
      name: args.claim.name,
      role: args.claim.role,
      avatarUri: hintAvatarUri,
      claimedAt,
    },
  });

  return true;
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

export function writeRingClaimHint(hint: RingClaimHint) {
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

function clearRingClaimHintsForAliases(aliasIds: string[], slotId: string, userId?: string) {
  const g = globalThis as any;
  const store = g.__KRISTO_RING_CLAIM_HINTS__ || {};
  const aliasSet = new Set(aliasIds.flatMap((id) => [id, baseFeedId(id)].filter(Boolean)));
  const uid = String(userId || "").trim();
  const sid = String(slotId || "").trim();

  for (const key of Object.keys(store)) {
    const hint = store[key] as RingClaimHint | undefined;
    if (!hint) continue;
    const hintBase = baseFeedId(String(hint.baseFeedId || hint.feedId || ""));
    if (!aliasSet.has(hintBase) && !aliasSet.has(String(hint.baseFeedId || ""))) continue;
    if (sid && String(hint.slotId || "") !== sid) continue;
    if (uid && String(hint.userId || "") !== uid) continue;
    delete store[key];
  }
}

function clearUserClaimedSlotsForAliases(aliasIds: string[], slotId: string, userId?: string) {
  const g = globalThis as any;
  const store = g.__KRISTO_USER_CLAIMED_SLOTS__ || {};
  const aliasSet = new Set(aliasIds.flatMap((id) => [id, baseFeedId(id)].filter(Boolean)));
  const uid = String(userId || "").trim();
  const sid = String(slotId || "").trim();

  for (const key of Object.keys(store)) {
    const entry = store[key] as any;
    if (!entry) continue;
    const postId = String(entry?.postId || "").trim();
    if (!aliasSet.has(postId) && !aliasSet.has(baseFeedId(postId))) continue;
    if (sid && String(entry?.slotId || "") !== sid) continue;
    if (uid && String(entry?.userId || "") !== uid) continue;
    delete store[key];
  }
}

function purgeStaleLocalScheduleMirrors(canonicalId: string, aliasIds: string[]) {
  if (!isBackendFeedScheduleId(canonicalId)) return false;

  const aliasSet = new Set(aliasIds.flatMap((id) => [id, baseFeedId(id)].filter(Boolean)));
  const s = getStore();
  const removed: string[] = [];

  s.items = s.items.filter((it) => {
    const rowId = String(it.id || "").trim();
    if (!isLocalMediaScheduleId(rowId)) return true;
    if (!aliasSet.has(rowId) && !aliasSet.has(baseFeedId(rowId))) return true;
    removed.push(rowId);
    return false;
  });

  if (removed.length) {
    console.log("KRISTO_STALE_LOCAL_SCHEDULE_REMOVED", {
      canonicalId,
      removed,
      aliasIds,
    });
    persistAndEmit();
    return true;
  }

  return false;
}

export function feedRemoveScheduleMirrors(scheduleId: string) {
  const rows = feedList() as any[];
  const aliases = collectScheduleAliasIds(scheduleId, rows);
  const aliasSet = new Set(aliases.flatMap((id) => [id, baseFeedId(id)].filter(Boolean)));

  feedRemoveWhere((it) => {
    const rowId = String(it.id || "").trim();
    const sourceId = String((it as any)?.sourceScheduleId || "").trim();
    return (
      aliasSet.has(rowId) ||
      aliasSet.has(sourceId) ||
      aliasSet.has(baseFeedId(rowId)) ||
      aliasSet.has(baseFeedId(sourceId))
    );
  });
}

/** Remove one slot's persisted claim store + ring hints (not whole-schedule wipe). */
export function purgeClaimedSlotLocalState(input: {
  scheduleId: string;
  slotId: string;
  userId?: string;
  reason: string;
  rows?: any[];
}) {
  const seed = String(input.scheduleId || "").trim();
  const slotId = String(input.slotId || "").trim();
  if (!seed || !slotId) return;

  const merged = [...(input.rows || []), ...(feedList() as any[])];
  const canonicalId =
    resolveCanonicalScheduleFeedId(seed, merged) || baseFeedId(seed) || seed;
  const aliases = collectScheduleAliasIds(canonicalId, merged);
  const uid = String(input.userId || "").trim();

  clearRingClaimHintsForAliases(aliases, slotId, uid || undefined);
  clearUserClaimedSlotsForAliases(aliases, slotId, uid || undefined);

  for (const alias of aliases) {
    syncUserClaimedSlotStore(alias, slotId, null);
    syncUserClaimedSlotStore(baseFeedId(alias), slotId, null);
  }
  syncUserClaimedSlotStore(canonicalId, slotId, null);

  console.log("KRISTO_STALE_CLAIM_PURGED", {
    feedId: canonicalId,
    slotId,
    userId: uid || null,
    reason: String(input.reason || "unknown"),
  });
}

/** Drop ring hints, claimed-slot memory, and stale local mirrors for one schedule. */
export function clearScheduleClaimRuntimeState(scheduleId: string, rows?: any[]) {
  const seed = String(scheduleId || "").trim();
  if (!seed) return;

  const merged = [...(rows || []), ...(feedList() as any[])];
  const canonicalId = resolveCanonicalScheduleFeedId(seed, merged) || seed;
  const aliases = collectScheduleAliasIds(canonicalId, merged);

  clearRingClaimHintsForAliases(aliases, "");
  clearUserClaimedSlotsForAliases(aliases, "");
  purgeStaleLocalScheduleMirrors(canonicalId, aliases);
}

function migrateClaimStoresToCanonical(localId: string, canonicalId: string) {
  const local = String(localId || "").trim();
  const canonical = String(canonicalId || "").trim();
  if (!local || !canonical || local === canonical) return;

  const g = globalThis as any;
  const slotStore = g.__KRISTO_USER_CLAIMED_SLOTS__ || {};
  for (const [key, entry] of Object.entries(slotStore) as any) {
    if (String(entry?.postId || "") !== local) continue;
    delete slotStore[key];
    const nextKey = `${canonical}|${entry.slotId}`;
    slotStore[nextKey] = { ...entry, postId: canonical };
  }
  g.__KRISTO_USER_CLAIMED_SLOTS__ = slotStore;

  const hintStore = g.__KRISTO_RING_CLAIM_HINTS__ || {};
  for (const [key, hint] of Object.entries(hintStore) as any) {
    const hintBase = String(hint?.baseFeedId || hint?.feedId || "");
    if (hintBase !== local && baseFeedId(hintBase) !== local) continue;
    delete hintStore[key];
    const nextKey = `${hint.userId}|${canonical}|${hint.slotId}`;
    hintStore[nextKey] = {
      ...hint,
      feedId: canonical,
      baseFeedId: canonical,
    };
  }
  g.__KRISTO_RING_CLAIM_HINTS__ = hintStore;

  console.log("KRISTO_SCHEDULE_ID_NORMALIZED", {
    context: "claim-store-migrate",
    localId: local,
    canonicalId: canonical,
  });
}

export function slotIdsMatch(slot: any, slotId: string): boolean {
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
    avatarUrl?: string;
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

  const avatarUri =
    sanitizePersistedClaimAvatarUri(claim?.avatarUrl, "local-claim-patch") ||
    sanitizePersistedClaimAvatarUri(claim?.avatarUri, "local-claim-patch") ||
    resolvePersistedClaimAvatarUri(slot);

  const next = {
    ...slot,
    claimed: true,
    isClaimed: true,
    status: "claimed",
    claimedAt,
    claimedByUserId: String(claim?.userId || ""),
    claimedByName: claim?.name || slot?.claimedByName || "You",
    claimedByAvatarUri: avatarUri,
    claimedByAvatar: avatarUri,
    claimedByPhotoUrl: avatarUri,
    claimedBy: {
      slotId,
      userId: String(claim?.userId || ""),
      name: claim?.name || slot?.claimedByName || "You",
      role: claim?.role || slot?.claimedByRole || "Member",
      avatarUri,
      claimedAt,
    },
  };

  if (avatarUri) {
    console.log("KRISTO_CLAIMED_SLOT_AVATAR_PERSIST", {
      slotId,
      userId: String(claim?.userId || ""),
      hasAvatar: true,
    });
  } else {
    console.log("KRISTO_CLAIMED_SLOT_AVATAR_MISSING", {
      slotId,
      userId: String(claim?.userId || ""),
      stage: "local-claim-patch",
    });
  }

  return next;
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
    avatarUrl?: string;
    claimedByAvatarUri?: string;
    claimedByAvatar?: string;
    claimedByPhotoUrl?: string;
    startMs?: number;
    endMs?: number;
    slotNumber?: number;
    churchId?: string;
    slot?: any;
    item?: any;
  }
) {
  const s = getStore();
  const rows = feedList() as any[];
  const seedId = baseFeedId(id) || String(id || "").trim();
  const baseId = resolveCanonicalScheduleFeedId(seedId, rows) || seedId;
  const slotId = String(claim?.slotId || "").trim();
  const userId = String(claim?.userId || "").trim();
  if (!baseId || !slotId || !userId || !claim) {
    console.log("KRISTO_ME_TAB_RING_CLAIM_SKIP", {
      reason: "invalid_args",
      seedId,
      baseId,
      slotId,
      userId,
      hasClaim: !!claim,
    });
    return;
  }

  console.log("KRISTO_ME_TAB_RING_CLAIM_ATTEMPT", {
    postId: baseId,
    slotId,
    userId,
    claimStartMs: claim.startMs ?? null,
    claimEndMs: claim.endMs ?? null,
    hasClaimSlot: !!claim.slot,
    source: "feedClaimSchedule",
  });

  for (const it of rows) {
    if (!feedItemMatchesClaimTarget(it, baseId, slotId)) continue;
    const slots = Array.isArray((it as any).scheduleSlots) ? (it as any).scheduleSlots : [];
    const targetSlot = slots.find((candidate: any) => slotIdsMatch(candidate, slotId));
    if (!targetSlot) continue;
    const existingOwner = String(
      targetSlot?.claimedByUserId || targetSlot?.claimedBy?.userId || ""
    ).trim();
    if (existingOwner && existingOwner !== userId) {
      console.log("KRISTO_CLAIM_OVERWRITE_BLOCKED", {
        slotId,
        existingClaimedByUserId: existingOwner,
        incomingUserId: userId,
        source: "homeFeedStore.feedClaimSchedule",
      });
      return;
    }
    break;
  }

  console.log("KRISTO_SCHEDULE_ID_NORMALIZED", {
    context: "claim",
    seedId,
    canonicalId: baseId,
    aliasIds: collectScheduleAliasIds(seedId, rows),
  });

  console.log("KRISTO_MEDIA_CLAIM_START", {
    postId: baseId,
    slotId,
    userId,
  });

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
    if (!patched.changed && !patched.claimedSlot) return it;

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
    const persistedClaimAvatar =
      sanitizePersistedClaimAvatarUri(claim.avatarUrl, "feed-claim-top-level") ||
      sanitizePersistedClaimAvatarUri(claim.avatarUri, "feed-claim-top-level") ||
      "";
    const topLevelClaimPatch = isPerSlotRow
      ? {
          claimed: true,
          isClaimed: true,
          status: "claimed",
          claimedByUserId: userId,
          claimedByName: claim.name || "You",
          claimedByAvatarUri: persistedClaimAvatar,
          claimedByAvatar: persistedClaimAvatar,
          claimedByPhotoUrl: persistedClaimAvatar,
          claimedBy: {
            slotId,
            userId,
            name: claim.name || "You",
            role: claim.role || "Member",
            avatarUri: persistedClaimAvatar,
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
      claimedCount: countClaimedScheduleSlots(patched.scheduleSlots),
      updatedAt: Date.now(),
    } as any;
  });

  if (!claimMeta && Number(claim.startMs || 0) > 0 && Number(claim.endMs || 0) > 0) {
    claimMeta = {
      startMs: Number(claim.startMs),
      endMs: Number(claim.endMs),
      slotNumber: Number(claim.slotNumber || 0),
      item: claim.item || null,
      slot:
        claim.slot ||
        ({
          id: slotId,
          slotId,
          startMs: Number(claim.startMs),
          endMs: Number(claim.endMs),
          claimedByUserId: userId,
        } as any),
      index: Math.max(0, Number(claim.slotNumber || 1) - 1),
    };
  }

  const ringPersisted =
    !!claimMeta &&
    claimMeta.startMs > 0 &&
    claimMeta.endMs > 0 &&
    persistPersonalTabRingClaimState({
      postId: baseId,
      slotId,
      userId,
      claim: {
        name: claim.name,
        role: claim.role,
        avatarUri: claim.avatarUri,
        avatarUrl: claim.avatarUrl,
        churchId: String(claim.churchId || claimMeta.item?.churchId || "").trim(),
        slot: claimMeta.slot,
        item: claimMeta.item,
      },
      startMs: claimMeta.startMs,
      endMs: claimMeta.endMs,
      slotNumber: claimMeta.slotNumber,
      source: "feedClaimSchedule",
    });

  if (!ringPersisted) {
    console.log("KRISTO_ME_TAB_RING_CLAIM_SKIP", {
      reason: !claimMeta ? "no_claim_meta" : "missing_time_window",
      postId: baseId,
      slotId,
      userId,
      anyChanged,
      claimMeta: claimMeta
        ? {
            startMs: claimMeta.startMs,
            endMs: claimMeta.endMs,
            slotNumber: claimMeta.slotNumber,
          }
        : null,
      claimStartMs: claim.startMs ?? null,
      claimEndMs: claim.endMs ?? null,
      hasClaimSlot: !!claim.slot,
    });
  }

  if (!anyChanged) {
    emit();
    return;
  }

  if (!ringPersisted) {
    const claimedAt = new Date().toISOString();
    syncUserClaimedSlotStore(baseId, slotId, {
      userId,
      name: claim.name,
      role: claim.role,
      avatarUri: claim.avatarUri || claim.avatarUrl,
      churchId: String(claim.churchId || claimMeta?.item?.churchId || "").trim(),
      targetChurchId: String(claim.churchId || claimMeta?.item?.churchId || "").trim(),
      slotNumber: claimMeta?.slotNumber,
      startMs: claimMeta?.startMs,
      endMs: claimMeta?.endMs,
    });

    const hintAvatarUri =
      sanitizePersistedClaimAvatarUri(claim.avatarUrl, "ring-claim-hint") ||
      sanitizePersistedClaimAvatarUri(claim.avatarUri, "ring-claim-hint") ||
      "";
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
      avatarUri: hintAvatarUri,
      claimedAt,
      churchId: String(claimMeta?.item?.churchId || ""),
      item: claimMeta?.item || null,
      slot: claimMeta?.slot || null,
      updatedAt: Date.now(),
    };

    writeRingClaimHint(hint);

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
  }

  console.log("KRISTO_MEDIA_CLAIM_LOCAL_SYNC", {
    postId: baseId,
    slotId,
    userId,
    anyChanged,
    ringPersisted,
    claimedCount: claimMeta?.item
      ? countClaimedScheduleSlots(claimMeta.item.scheduleSlots)
      : null,
    startMs: claimMeta?.startMs ?? null,
    endMs: claimMeta?.endMs ?? null,
    slotNumber: claimMeta?.slotNumber ?? null,
  });

  console.log("KRISTO_CLAIM_LOCAL_SYNC", {
    postId: baseId,
    slotId,
    userId,
    anyChanged,
    ringPersisted,
    startMs: claimMeta?.startMs ?? null,
    endMs: claimMeta?.endMs ?? null,
    slotNumber: claimMeta?.slotNumber ?? null,
  });

  if (claimMeta && claimMeta.startMs > 0 && claimMeta.endMs > 0) {
    console.log("KRISTO_CLAIM_RING_FAST_SYNC", {
      feedId: baseId,
      baseFeedId: baseId,
      slotId,
      slotNumber: claimMeta.slotNumber,
      userId,
      startMs: claimMeta.startMs,
      endMs: claimMeta.endMs,
      isLiveNow:
        Date.now() >= claimMeta.startMs && Date.now() <= claimMeta.endMs,
    });
  }

  const churchId = String(claim.churchId || claimMeta?.item?.churchId || "").trim();
  if (anyChanged && churchId) {
    console.log("KRISTO_SLOT_CLAIM_SUCCESS", {
      stage: "local-optimistic",
      churchId,
      postId: baseId,
      slotId,
      userId,
    });
    emitSlotClaimChanged({
      churchId,
      postId: baseId,
      slotId,
      action: "claim",
      userId,
      source: "feedClaimSchedule",
    });
  }

  persistAndEmit();
}

export function feedRemoveWhere(predicate: (item: FeedItem) => boolean) {
  const s = getStore();
  s.items = s.items.filter((it) => !predicate(it));
  persistAndEmit();
}

function feedApiBase() {
  return String(
    process.env.EXPO_PUBLIC_API_BASE ||
      process.env.EXPO_PUBLIC_API_URL ||
      process.env.EXPO_PUBLIC_KRISTO_API_URL ||
      ""
  ).replace(/\/$/, "");
}

function normalizeFeedUri(raw: unknown) {
  return String(raw || "").trim().toLowerCase();
}

function stripFeedUriQueryHash(raw: string) {
  return raw.split("#")[0].split("?")[0];
}

function toAbsoluteFeedUri(raw: unknown) {
  const v = String(raw || "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("file://") ||
    lower.startsWith("data:image")
  ) {
    return lower;
  }
  const base = feedApiBase().toLowerCase();
  if (!base) return lower;
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`.toLowerCase();
}

function feedUriPathname(raw: unknown) {
  const v = stripFeedUriQueryHash(String(raw || "").trim().toLowerCase());
  if (!v) return "";
  if (v.startsWith("data:image")) return v;

  const base = feedApiBase().toLowerCase();
  if (base && v.startsWith(base)) {
    const rest = v.slice(base.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  }

  try {
    if (/^https?:\/\//.test(v) || v.startsWith("file://")) {
      return new URL(v).pathname.toLowerCase();
    }
  } catch {
    // fall through to relative path handling
  }

  return v.startsWith("/") ? v : `/${v}`;
}

function feedUriPathTail(raw: unknown, segments = 2) {
  const pathname = feedUriPathname(raw);
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "";
  return parts.slice(-Math.min(segments, parts.length)).join("/");
}

function feedUriLooksLikeAvatarAsset(raw: unknown) {
  const tail = feedUriPathTail(raw, 3);
  return /avatar|profile|logo|church|uploads|media\/profile|profile-avatars/i.test(tail);
}

function feedUrisEquivalent(a: unknown, b: unknown) {
  const rawA = normalizeFeedUri(a);
  const rawB = normalizeFeedUri(b);
  if (!rawA || !rawB) return false;
  if (rawA === rawB) return true;

  const isDataA = rawA.startsWith("data:image");
  const isDataB = rawB.startsWith("data:image");
  if (isDataA || isDataB) return isDataA && isDataB && rawA === rawB;

  const absA = toAbsoluteFeedUri(a);
  const absB = toAbsoluteFeedUri(b);
  if (absA && absB && absA === absB) return true;

  const pathA = feedUriPathname(a);
  const pathB = feedUriPathname(b);
  if (pathA && pathB && pathA === pathB) return true;

  const tailA = feedUriPathTail(a);
  const tailB = feedUriPathTail(b);
  if (tailA && tailB && tailA === tailB) {
    if (feedUriLooksLikeAvatarAsset(a) || feedUriLooksLikeAvatarAsset(b)) return true;
    if (tailA.split("/").length >= 2) return true;
  }

  const fileA = tailA.split("/").pop() || "";
  const fileB = tailB.split("/").pop() || "";
  if (
    fileA &&
    fileA === fileB &&
    /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif)$/i.test(fileA) &&
    (feedUriLooksLikeAvatarAsset(a) || feedUriLooksLikeAvatarAsset(b))
  ) {
    return true;
  }

  return false;
}

function collectAvatarUriValues(item: any) {
  return [
    item?.actorAvatarUri,
    item?.mediaAvatarUri,
    item?.churchAvatarUri,
    item?.churchAvatarUrl,
    item?.avatarUri,
    item?.avatarUrl,
    item?.logo,
    item?.logoUrl,
    item?.logoUri,
    item?.profileImage,
    item?.profilePhoto,
    item?.profilePicture,
    item?.photo,
    item?.image,
    item?.avatar,
    item?.posterUri,
    item?.thumbnailUri,
    item?.thumbnailUrl,
    item?.actorAvatar,
    item?.churchAvatar,
    item?.mediaAvatar,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function mediaUriMatchesAvatarMetadata(item: any) {
  const mediaUri = String(item?.mediaUri || "").trim();
  if (!mediaUri) return false;
  return collectAvatarUriValues(item).some((avatar) => feedUrisEquivalent(mediaUri, avatar));
}

export function isStandaloneAvatarFeedPost(item: any) {
  if (!item) return false;

  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  const isChurchRoomPost =
    ["testimony", "post", "announcement", "counsel"].includes(source) ||
    ["testimony", "post", "announcement", "counsel"].includes(kind);
  if (isChurchRoomPost) {
    const postImage = String(item?.mediaUri || item?.imageUrl || "").trim();
    const title = String(item?.title || "").trim();
    const body = String(item?.body || item?.text || "").trim();
    if (postImage && (title || body)) return false;
  }

  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (slots.length > 0) return false;
  if (String(item?.scheduleType || "").includes("media-live-slots")) return false;
  if (String(item?.source || "").includes("media-schedule")) return false;
  if (item?.isLiveNow || item?.kind === "live") return false;

  const id = String(item?.id || "").trim();
  if (id.includes("__slot_")) return false;

  if (/avatar|profile|logo/.test(source)) return true;
  if (/avatar|profile|logo/i.test(id)) return true;

  const videoUrl = normalizeFeedUri(item?.videoUrl);
  if (isFeedVideoItem(item) && videoUrl) return false;

  const mediaUri = normalizeFeedUri(item?.mediaUri);
  const avatarUris = collectAvatarUriValues(item);
  const title = String(item?.title || "").trim();
  const body = String(item?.body || "").trim();

  if (mediaUri && mediaUriMatchesAvatarMetadata(item)) {
    return true;
  }

  if (item?.mediaType === "image" && mediaUri && !videoUrl && !title && !body) {
    return true;
  }

  if (
    !mediaUri &&
    !videoUrl &&
    !title &&
    !body &&
    avatarUris.length > 0 &&
    item?.mediaType !== "video"
  ) {
    return true;
  }

  return false;
}

export function isOptimisticVideoUploadPost(item: any) {
  const id = String(item?.id || "").trim();
  if (id.startsWith("local-upload-")) return true;
  return String(item?.source || "").toLowerCase() === "local-video-upload";
}

export function feedUpdateOptimisticVideoUpload(id: string, patch: Record<string, unknown>) {
  const cleanId = String(id || "").trim();
  if (!cleanId) return;

  const s = getStore();
  let changed = false;

  s.items = s.items.map((it) => {
    if (String(it.id || "") !== cleanId) return it;
    changed = true;
    return { ...(it as any), ...patch };
  });

  if (changed) persistAndEmit();
}

export function feedRemoveOptimisticVideoUpload(id: string) {
  feedRemoveWhere((it) => String(it.id || "") === String(id || "").trim());
}

export function isRealHomeFeedRow(item: any) {
  if (!item || isStandaloneAvatarFeedPost(item)) return false;
  if (isOptimisticVideoUploadPost(item)) return true;

  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (slots.length > 0) return true;
  if (String(item?.scheduleType || "").includes("media-live-slots")) return true;
  if (String(item?.source || "").includes("media-schedule")) return true;
  if (item?.isLiveNow || item?.kind === "live") return true;

  const id = String(item?.id || "");
  if (id.includes("__slot_")) return true;

  const mediaUri = String(item?.mediaUri || "").trim();
  const videoUrl = String(item?.videoUrl || "").trim();
  const title = String(item?.title || "").trim();
  const body = String(item?.body || item?.text || "").trim();

  if (isFeedVideoItem(item) && videoUrl) return true;
  if (item?.mediaType === "video" && videoUrl) return true;
  if (item?.mediaType === "image" && mediaUri) return true;
  if (title || body) return true;

  return false;
}

export function isLocalMediaVideoPost(item: any) {
  const id = String(item?.id || "").trim();
  
  // Match id starts with "media-video-"
  if (id.startsWith("media-video-")) return true;
  
  // Match id includes "__fy_" AND base id starts with "media-video-"
  if (id.includes("__fy_")) {
    const baseId = baseFeedId(id);
    if (baseId && baseId.startsWith("media-video-")) return true;
  }
  
  if (item?.mediaType !== "video") return false;

  const source = String(item?.source || "").toLowerCase();
  const kind = String(item?.kind || "").toLowerCase();
  
  // Exclude backend posts
  if (source.includes("backend") || item?.isBackendPost) return false;
  
  // Match mediaType === "video" AND source/kind indicates local media
  if (source.includes("local") || kind.includes("local") || source.includes("media-video")) {
    return true;
  }

  if (Boolean(item?.mediaId) && String(item?.kind || "") === "post") {
    return true;
  }

  return false;
}

export function clearLocalMediaVideoPosts() {
  const s = getStore();
  const before = s.items.length;
  s.items = s.items.filter((it) => !isLocalMediaVideoPost(it));
  const removed = before - s.items.length;

  if (removed > 0) {
    void persistAndEmit();
  }

  if (__DEV__) {
    console.log("KRISTO_HOME_FEED_LOCAL_MEDIA_CLEARED", { removed });
  }

  return removed;
}

const HOME_FEED_CACHE_KEY_PATTERNS = [
  /feed/i,
  /homefeed/i,
  /home_feed/i,
  /for_you/i,
  /for-you/i,
  /media-video/i,
  /church-feed/i,
  /KRISTO_HOME_FEED/i,
  /kristo_for_you/i,
];

export async function clearHomeFeedLocalCaches() {
  const keys = await AsyncStorage.getAllKeys();
  const matched = keys.filter((key) =>
    HOME_FEED_CACHE_KEY_PATTERNS.some((pattern) => pattern.test(key))
  );

  if (matched.length) {
    await AsyncStorage.multiRemove(matched);
  }

  const s = getStore();
  const removedItems = s.items.length;
  s.items = [];
  await persistAndEmit();

  delete (globalThis as any).__KRISTO_OPTIMISTIC_LIKES__;

  if (__DEV__) {
    console.log("KRISTO_HOME_FEED_LOCAL_CACHE_CLEARED", {
      keysRemoved: matched,
      removedItems,
    });
  }

  return { keysRemoved: matched, removedItems };
}

export async function clearHomeFeedRuntimeCaches() {
  const s = getStore();
  const before = s.items.length;
  
  // Clear local media-video rows
  s.items = s.items.filter((it) => !isLocalMediaVideoPost(it));
  const removedMediaVideo = before - s.items.length;
  
  // Clear all in-memory feed items
  const totalRemoved = s.items.length;
  s.items = [];
  
  // Remove AsyncStorage keys
  await AsyncStorage.removeItem(FEED_STORAGE_KEY);
  await AsyncStorage.removeItem("kristo_for_you_signals_v1");
  
  // Notify subscribers
  emit();
  
  if (__DEV__) {
    console.log("KRISTO_HOME_FEED_LOCAL_CACHE_CLEARED", {
      removedCount: totalRemoved,
      removedMediaVideo,
    });
  }
  
  return { removedCount: totalRemoved, removedMediaVideo };
}

/**
 * Dev helper: clear local Home Feed posts only.
 * Removes in-memory feed items + feed AsyncStorage keys.
 * Does NOT touch session, church/profile/media caches, ministries, or avatars.
 */
export async function clearHomeFeedPostsOnly() {
  const s = getStore();
  const removedItems = s.items.length;
  s.items = [];

  const storageKeys = [FEED_STORAGE_KEY, HOME_FEED_FOR_YOU_SIGNALS_KEY];
  await AsyncStorage.multiRemove(storageKeys);

  delete (globalThis as any).__KRISTO_OPTIMISTIC_LIKES__;

  emit();

  if (__DEV__) {
    console.log("KRISTO_HOME_FEED_POSTS_CLEARED", {
      storageKeys,
      removedItems,
    });
  }

  return { removedItems, storageKeys };
}

if (__DEV__) {
  (globalThis as any).clearHomeFeedLocalCaches = clearHomeFeedLocalCaches;
  (globalThis as any).clearLocalMediaVideoPosts = clearLocalMediaVideoPosts;
  (globalThis as any).clearHomeFeedRuntimeCaches = clearHomeFeedRuntimeCaches;
  (globalThis as any).clearHomeFeedPostsOnly = clearHomeFeedPostsOnly;
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
  const rows = feedList() as any[];
  const seed = baseFeedId(feedId) || String(feedId || "").trim();
  if (!seed) return null;

  const canonicalId = resolveCanonicalScheduleFeedId(seed, rows) || seed;
  const aliases = new Set(collectScheduleAliasIds(seed, rows));

  let backendBest: any = null;
  let localBest: any = null;
  let backendClaimed = 0;
  let localClaimed = 0;

  for (const row of rows) {
    const rowId = String(row?.id || "").trim();
    const sourceId = String(row?.sourceScheduleId || "").trim();
    const matches =
      aliases.has(rowId) ||
      aliases.has(sourceId) ||
      aliases.has(baseFeedId(rowId)) ||
      rowId === canonicalId ||
      sourceId === canonicalId;

    if (!matches) continue;

    const slots = Array.isArray(row?.allScheduleSlotsForLive)
      ? row.allScheduleSlotsForLive
      : Array.isArray(row?.scheduleSlots)
        ? row.scheduleSlots
        : [];

    const claimedCount = slots.filter((slot: any) =>
      String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()
    ).length;

    if (isBackendFeedScheduleId(rowId)) {
      if (
        !backendBest ||
        claimedCount > backendClaimed ||
        (claimedCount === backendClaimed && slots.length >= (backendBest?.scheduleSlots?.length || 0))
      ) {
        backendBest = row;
        backendClaimed = claimedCount;
      }
      continue;
    }

    if (isLocalMediaScheduleId(rowId)) {
      if (
        !localBest ||
        claimedCount > localClaimed ||
        (claimedCount === localClaimed && slots.length >= (localBest?.scheduleSlots?.length || 0))
      ) {
        localBest = row;
        localClaimed = claimedCount;
      }
    }
  }

  if (backendBest) return backendBest;
  return localBest;
}

export function feedScheduleSlotsForLive(feedId: string) {
  const rows = feedList() as any[];
  const seed = baseFeedId(feedId) || String(feedId || "").trim();
  const canonicalId = resolveCanonicalScheduleFeedId(seed, rows);

  if (canonicalId && isBackendFeedScheduleId(canonicalId)) {
    const hasBackend = rows.some((row) => String(row?.id || "") === canonicalId);
    if (hasBackend) {
      purgeStaleLocalScheduleMirrors(canonicalId, collectScheduleAliasIds(seed, rows));
    }
  }

  const row = feedFindMediaScheduleRow(feedId);
  if (!row) return [] as any[];

  if (isLocalMediaScheduleId(row?.id) && canonicalId && isBackendFeedScheduleId(canonicalId)) {
    const backendRow = rows.find((r) => String(r?.id || "") === canonicalId);
    if (backendRow) {
      console.log("KRISTO_STALE_LOCAL_SCHEDULE_REMOVED", {
        context: "feedScheduleSlotsForLive-skip-local",
        canonicalId,
        localId: String(row?.id || ""),
      });
      const slots = Array.isArray(backendRow?.allScheduleSlotsForLive)
        ? backendRow.allScheduleSlotsForLive
        : Array.isArray(backendRow?.scheduleSlots)
          ? backendRow.scheduleSlots
          : [];
      return normalizeLiveScheduleSlots(slots);
    }
  }

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

export function feedPublishMediaScheduleLocal(item: any) {
  const churchId = String(item?.churchId || "").trim();
  const id = String(item?.id || item?.sourceScheduleId || "").trim();
  if (!churchId || !id) return;

  const nowMs = Date.now();
  const scheduleSlots = enrichScheduleSlotsForStore(item?.scheduleSlots, nowMs);
  const claimedCount = countClaimedScheduleSlots(scheduleSlots);

  const s = getStore();
  s.items = s.items.filter((it) => {
    if (!isMediaScheduleCard(it)) return true;
    const itemCid = String((it as any)?.churchId || "").trim();
    if (itemCid && itemCid === churchId) return false;
    if (String(it.id) === id) return false;
    return true;
  });

  s.items.unshift({
    likeCount: 0,
    liked: false,
    saved: false,
    kind: "post",
    body: String(item?.text || item?.body || ""),
    source: String(item?.source || "media-schedule"),
    scheduleType: String(item?.scheduleType || "media-live-slots"),
    ...item,
    id,
    sourceScheduleId: id,
    churchId,
    scheduleSlots,
    claimedCount,
    updatedAt: nowMs,
    pendingBackendSync: item?.pendingBackendSync === true,
  } as any);

  persistAndEmit();

  console.log("KRISTO_MEDIA_SCHEDULE_CREATED_LOCAL_SYNC", {
    churchId,
    scheduleId: id,
    slotCount: scheduleSlots.length,
    firstSlotStartMs: scheduleSlots[0]?.startMs ?? null,
    pendingBackendSync: item?.pendingBackendSync === true,
  });
}

/** Replace optimistic local schedule with durable backend row (same church). */
export function feedSyncMediaScheduleFromBackend(backendItem: any, localId?: string) {
  const backendId = String(backendItem?.id || "").trim();
  const churchId = String(backendItem?.churchId || "").trim();
  if (!backendId || !churchId) return;

  const nowMs = Date.now();
  const scheduleSlots = enrichScheduleSlotsForStore(backendItem?.scheduleSlots, nowMs);
  const claimedCount = countClaimedScheduleSlots(scheduleSlots);

  const s = getStore();
  const localItem = localId
    ? (s.items.find((it) => String(it.id) === localId) as any)
    : null;

  const mergedTopic = String(
    backendItem?.topic ||
      localItem?.topic ||
      backendItem?.scheduleTopic ||
      localItem?.scheduleTopic ||
      ""
  ).trim();
  const mergedMeetingType = String(
    backendItem?.meetingType ||
      localItem?.meetingType ||
      backendItem?.liveCardType ||
      localItem?.liveCardType ||
      ""
  ).trim();
  const mergedLiveCardType = String(
    backendItem?.liveCardType ||
      localItem?.liveCardType ||
      mergedMeetingType ||
      ""
  ).trim();
  const mergedSlots = scheduleSlots.map((slot: any) => ({
    ...slot,
    ...(mergedMeetingType
      ? {
          meetingType: String(slot?.meetingType || mergedMeetingType).trim() || mergedMeetingType,
          liveCardType: String(slot?.liveCardType || mergedLiveCardType || mergedMeetingType).trim() || mergedLiveCardType || mergedMeetingType,
          selectedCardType: String(slot?.selectedCardType || mergedMeetingType).trim() || mergedMeetingType,
          cardTypeLabel: String(slot?.cardTypeLabel || mergedMeetingType).trim() || mergedMeetingType,
        }
      : {}),
  }));

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
    body: String(backendItem.text || backendItem.body || localItem?.text || localItem?.body || ""),
    source: String(backendItem?.source || "media-schedule"),
    scheduleType: String(backendItem?.scheduleType || "media-live-slots"),
    ...backendItem,
    topic: String(backendItem?.topic || localItem?.topic || "").trim() || undefined,
    scheduleTopic:
      String(backendItem?.scheduleTopic || localItem?.scheduleTopic || backendItem?.topic || localItem?.topic || "").trim() ||
      undefined,
    meetingTopic:
      String(backendItem?.meetingTopic || localItem?.meetingTopic || backendItem?.topic || localItem?.topic || "").trim() ||
      undefined,
    meetingType: String(backendItem?.meetingType || localItem?.meetingType || "").trim() || undefined,
    liveCardType: String(backendItem?.liveCardType || localItem?.liveCardType || mergedMeetingType || "").trim() || undefined,
    selectedCardType: String(backendItem?.selectedCardType || localItem?.selectedCardType || mergedMeetingType || "").trim() || undefined,
    cardTypeLabel: String(backendItem?.cardTypeLabel || localItem?.cardTypeLabel || mergedMeetingType || "").trim() || undefined,
    id: backendId,
    sourceScheduleId: localId || backendItem?.sourceScheduleId || backendId,
    liveId: localId || backendItem?.liveId || backendId,
    scheduleSlots: mergedSlots,
    claimedCount,
    updatedAt: nowMs,
    pendingBackendSync: false,
  } as any);

  if (localId) {
    migrateClaimStoresToCanonical(localId, backendId);
  }

  persistAndEmit();
  console.log("KRISTO_MEDIA_SCHEDULE_CREATED_LOCAL_SYNC", {
    churchId,
    scheduleId: backendId,
    slotCount: scheduleSlots.length,
    source: "backend-sync",
  });
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
  const seedId = baseFeedId(id) || String(id || "").trim();
  if (!seedId) return;

  st.items = st.items.map((it) => {
    if (!feedItemMatchesScheduleId(it, seedId)) return it;
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
  const slotId = String(opts?.slotId || "").trim();
  const patch = opts?.patch || {};
  const seedId = baseFeedId(id) || String(id || "").trim();
  if (!seedId || !slotId) return;

  st.items = st.items.map((it) => {
    if (!feedItemMatchesScheduleId(it, seedId)) return it;
    const anyIt = it as any;
    if (!Array.isArray(anyIt.scheduleSlots)) return it;

    return {
      ...it,
      scheduleSlots: anyIt.scheduleSlots.map((slot: any) =>
        slotIdsMatch(slot, slotId) ? { ...slot, ...patch } : slot
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
    liveId?: string;
    headers?: Record<string, string>;
    skipBackendSync?: boolean;
  }
) {
  const store = getStore();
  const rows = feedList() as any[];
  const seedId = baseFeedId(id) || String(id || "").trim();
  const canonicalId = resolveCanonicalScheduleFeedId(seedId, rows) || seedId;
  const aliasIds = collectScheduleAliasIds(seedId, rows);
  let anyChanged = false;

  console.log("KRISTO_SCHEDULE_ID_NORMALIZED", {
    context: "unclaim",
    seedId,
    canonicalId,
    aliasIds,
    slotId: opts?.slotId || "",
    userId: opts?.userId || "",
  });

  console.log("KRISTO_CLAIM_DELETE_SYNC_START", {
    seedId,
    canonicalId,
    aliasIds,
    slotId: opts?.slotId || "",
    userId: opts?.userId || "",
    liveId: opts?.liveId || canonicalId,
  });

  store.items = store.items.map((it) => {
    if (!feedItemMatchesScheduleId(it, seedId)) return it;

    const anyIt = it as any;
    const slotId = opts?.slotId || "";
    const userId = opts?.userId || "";

    if (Array.isArray(anyIt.scheduleSlots) && slotId) {
      let changed = false;

      const scheduleSlots = anyIt.scheduleSlots.map((slot: any) => {
        if (!slotIdsMatch(slot, slotId)) return slot;

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
        delete next.claimedByAvatarUri;
        delete next.claimedAt;
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
        claimedCount: countClaimedScheduleSlots(scheduleSlots),
        updatedAt: Date.now(),
      } as any;
    }

    return it;
  });

  if (opts?.slotId) {
    clearUserClaimedSlotsForAliases(aliasIds, String(opts.slotId), opts?.userId);
    clearRingClaimHintsForAliases(aliasIds, String(opts.slotId), opts?.userId);
    if (canonicalId) {
      clearRingClaimHint(canonicalId, String(opts.slotId), String(opts.userId || ""));
    }
  }

  purgeStaleLocalScheduleMirrors(canonicalId, aliasIds);

  if (anyChanged && opts?.slotId) {
    console.log("KRISTO_CLAIM_LOCAL_SYNC", {
      postId: canonicalId || seedId,
      slotId: opts.slotId,
      userId: opts.userId || "",
      action: "unclaim",
      aliasIds,
    });
    emitClaimUpdated({
      postId: canonicalId || seedId,
      feedId: canonicalId || seedId,
      baseFeedId: canonicalId || seedId,
      slotId: String(opts.slotId),
      userId: String(opts.userId || ""),
      action: "unclaim",
    });

    const churchId = String(
      store.items.find((it) => feedItemMatchesScheduleId(it, seedId))?.churchId || ""
    ).trim();
    if (churchId) {
      console.log("KRISTO_SLOT_CLAIM_SUCCESS", {
        stage: "local-unclaim",
        churchId,
        postId: canonicalId || seedId,
        slotId: String(opts.slotId),
        userId: String(opts.userId || ""),
      });
      emitSlotClaimChanged({
        churchId,
        postId: canonicalId || seedId,
        slotId: String(opts.slotId),
        action: "unclaim",
        userId: String(opts.userId || ""),
        source: "feedUnclaimSchedule",
      });
    }
  }

  if (anyChanged) persistAndEmit();

  console.log("KRISTO_HOME_FEED_AFTER_CLAIM_DELETE", {
    canonicalId,
    slotId: opts?.slotId || "",
    anyChanged,
    feedRows: feedList().length,
  });

  console.log("KRISTO_LIVE_RING_AFTER_CLAIM_DELETE", {
    canonicalId,
    slotId: opts?.slotId || "",
    ringHints: getRingClaimHints().length,
    claimedSlots: getUserClaimedSlotEntries().length,
  });

  if (anyChanged && opts?.slotId && !opts?.skipBackendSync) {
    const session = getSessionSync();
    const headers = (opts.headers || getKristoHeaders({
      userId: session?.userId || opts?.userId || "",
      role: (session?.role || "Member") as any,
      churchId: session?.churchId || "",
    })) as Record<string, string>;

    const userId = String(opts.userId || session?.userId || "").trim();
    const liveId = String(opts.liveId || canonicalId || seedId).trim();

    if (userId && headers["x-kristo-user-id"]) {
      void persistClaimDeleteToBackend({
        feedId: canonicalId || seedId,
        slotId: String(opts.slotId),
        userId,
        liveId,
        headers,
      });
    }
  }
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

export type ClaimFeedTarget = {
  seedId: string;
  canonicalFeedId: string;
  apiFeedId: string;
  localAliasId: string;
  liveBridgeId: string;
};

/** Resolve backend feed_* id for claim/unclaim API while preserving local live alias. */
export function resolveClaimFeedTarget(seedId: string): ClaimFeedTarget {
  const rows = feedList() as any[];
  const seed = baseFeedId(seedId) || String(seedId || "").trim();
  const canonicalFeedId = resolveCanonicalScheduleFeedId(seed, rows) || seed;
  const apiFeedId = isBackendFeedScheduleId(canonicalFeedId) ? canonicalFeedId : seed;
  const localAliasId = isLocalMediaScheduleId(seed)
    ? seed
    : isLocalMediaScheduleId(canonicalFeedId)
      ? canonicalFeedId
      : "";

  const target: ClaimFeedTarget = {
    seedId: seed,
    canonicalFeedId,
    apiFeedId,
    localAliasId,
    liveBridgeId: localAliasId || apiFeedId,
  };

  console.log("KRISTO_CLAIM_CANONICAL_FEED_ID_USED", {
    seedId: target.seedId,
    canonicalFeedId: target.canonicalFeedId,
    apiFeedId: target.apiFeedId,
    localAliasId: target.localAliasId,
    liveBridgeId: target.liveBridgeId,
  });

  return target;
}

export function isPastorClaimActor(userId: string, item?: any): boolean {
  const uid = String(userId || "").trim();
  if (!uid) return false;

  const pastorCandidates = [
    item?.actualChurchPastorUserId,
    item?.churchPastorUserId,
    item?.mediaOwnerPastorUserId,
    item?.pastorUserId,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return pastorCandidates.some((pastorId) => pastorId === uid);
}
