import {
  beginClaimHydrationStartup,
  finishClaimHydrationStartup,
  isClaimHydrationPending,
  logClaimButtonStateSource,
  markClaimHydrationPending,
  resolveClaimHydration,
  type ClaimButtonStateSourceLog,
} from "@/src/lib/claimHydrationState";
import { getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";
import { filterOutDeletedScheduleRows, isScheduleFeedIdDeleted } from "@/src/lib/deletedScheduleRegistry";
import {
  feedList,
  getRingClaimHints,
  getUserClaimedSlotEntries,
  syncUserClaimedSlotStore,
  writeRingClaimHint,
  type RingClaimHint,
} from "@/src/lib/homeFeedStore";
import { fetchMediaScheduleFeedSync } from "@/src/lib/mediaScheduleSilentReload";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleFeedPredicates";
import { isMediaSlotEndedOrStale, resolveMediaSlotTimeWindow } from "@/src/lib/mediaScheduleSlotTimes";
import {
  baseFeedId,
  collectScheduleAliasIds,
  mergeScheduleSlotClaimState,
  normalizeLiveScheduleSlots,
  resolveCanonicalScheduleFeedId,
  scheduleSlotClaimUserId,
} from "@/src/lib/scheduleSlotUtils";

export {
  beginClaimHydrationStartup,
  finishClaimHydrationStartup,
  isClaimHydrationPending,
  markClaimHydrationPending,
  resolveClaimHydration,
};

export function backendExplicitlyRevokedUserClaim(slot: any, userId: string): boolean {
  if (!slot || typeof slot !== "object") return false;
  const uid = String(userId || "").trim();
  if (!uid) return false;

  if (slot.deleted === true || slot.deletedAt) return true;

  const status = String(slot?.status || "").toLowerCase();
  if (
    status === "deleted" ||
    status === "removed" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "ended" ||
    status === "unclaimed" ||
    status === "open"
  ) {
    return true;
  }

  const owner = scheduleSlotClaimUserId(slot);
  if (owner && owner !== uid) return true;

  const endMs = Number(slot?.endMs || 0);
  if (endMs > 0 && endMs <= Date.now()) return true;

  return false;
}

export function mergeScheduleSlotClaimPreservingLocal(
  prev: any,
  next: any,
  preserveUserId?: string
) {
  const uid = String(preserveUserId || "").trim();
  if (!uid) return mergeScheduleSlotClaimState(prev, next);

  const prevOwner = scheduleSlotClaimUserId(prev);
  const nextOwner = scheduleSlotClaimUserId(next);

  if (prevOwner === uid && !nextOwner && !backendExplicitlyRevokedUserClaim(next, uid)) {
    return prev;
  }

  if (prevOwner === uid && nextOwner && nextOwner !== uid) {
    return next;
  }

  return mergeScheduleSlotClaimState(prev, next);
}

function resolveLiveSlotMatchKey(slot: any, index = 0) {
  const id = String(slot?.id || slot?.slotId || "").trim();
  if (id) return id;
  const slotNumber = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
  return `num:${slotNumber > 0 ? slotNumber : index + 1}`;
}

function resolveScheduleRowKey(row: any, allRows: any[] = []) {
  const seed = String(row?.sourceScheduleId || row?.id || "").trim();
  return (
    resolveCanonicalScheduleFeedId(seed, allRows) ||
    baseFeedId(seed) ||
    seed
  );
}

export function mergeScheduleFeedClaimRows(
  localRow: any,
  backendRow: any,
  preserveUserId?: string
) {
  if (!localRow) return backendRow;
  if (!backendRow) return localRow;

  const localSlots = Array.isArray(localRow?.scheduleSlots) ? localRow.scheduleSlots : [];
  const backendSlots = Array.isArray(backendRow?.scheduleSlots) ? backendRow.scheduleSlots : [];
  if (!localSlots.length) return backendRow;
  if (!backendSlots.length) return localRow;

  const localSlotsByKey = new Map<string, any>();
  localSlots.forEach((slot: any, index: number) => {
    localSlotsByKey.set(resolveLiveSlotMatchKey(slot, index), slot);
  });

  const mergedSlots = backendSlots.map((slot: any, index: number) => {
    const localSlot = localSlotsByKey.get(resolveLiveSlotMatchKey(slot, index));
    if (!localSlot) return slot;
    const backendOwner = scheduleSlotClaimUserId(slot);
    const preserveUid = String(preserveUserId || "").trim();
    if (backendOwner && backendOwner !== preserveUid) {
      return slot;
    }
    return mergeScheduleSlotClaimPreservingLocal(localSlot, slot, preserveUserId);
  });

  return {
    ...backendRow,
    scheduleSlots: mergedSlots,
  };
}

export function overlayStableClaimsOnFeedRows(
  backendRows: any[],
  viewerUserId?: string,
  options?: { allSources?: any[] }
): any[] {
  const uid = String(viewerUserId || "").trim();
  if (!Array.isArray(backendRows) || !backendRows.length) return backendRows;

  const entries = uid ? getUserClaimedSlotEntries(uid) : getUserClaimedSlotEntries();
  const hints = uid ? getRingClaimHints(uid) : getRingClaimHints();
  if (!entries.length && !hints.length) return backendRows;

  const entriesBySchedule = new Map<string, any[]>();
  for (const entry of entries) {
    const key = baseFeedId(String(entry?.postId || ""));
    if (!key) continue;
    if (!entriesBySchedule.has(key)) entriesBySchedule.set(key, []);
    entriesBySchedule.get(key)!.push(entry);
  }

  const allSources = options?.allSources || backendRows;

  return backendRows.map((row) => {
    const scheduleKey = resolveScheduleRowKey(row, allSources);
    const matchedEntries = scheduleKey ? entriesBySchedule.get(scheduleKey) || [] : [];
    const rowHints = hints.filter((hint) => {
      const hintBase = baseFeedId(String(hint?.baseFeedId || hint?.feedId || ""));
      if (!scheduleKey || !hintBase) return false;
      const aliases = new Set(collectScheduleAliasIds(scheduleKey, allSources));
      return hintBase === scheduleKey || aliases.has(hintBase);
    });

    if (!matchedEntries.length && !rowHints.length) return row;

    let slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    let changed = false;

    slots = slots.map((slot: any, index: number) => {
      const slotKey = resolveLiveSlotMatchKey(slot, index);
      const entry =
        matchedEntries.find(
          (candidate) =>
            String(candidate?.slotId || "").trim() === slotKey ||
            String(candidate?.slotId || "").trim() ===
              String(slot?.id || slot?.slotId || "").trim()
        ) || null;

      const hint = rowHints.find(
        (candidate) =>
          String(candidate?.slotId || "").trim() === slotKey ||
          String(candidate?.slotId || "").trim() ===
            String(slot?.id || slot?.slotId || "").trim()
      );

      let merged = slot;
      const backendClaimedByUserId = scheduleSlotClaimUserId(slot);

      if (entry && uid && String(entry?.userId || "") === uid) {
        const overlay = {
          ...slot,
          id: entry.slotId || slot?.id,
          slotId: entry.slotId || slot?.slotId,
          claimedByUserId: entry.userId,
          claimedByName: entry.name,
          status: "claimed",
          claimed: true,
          isClaimed: true,
        };
        merged = mergeScheduleSlotClaimPreservingLocal(slot, overlay, uid);
      } else if (
        hint &&
        uid &&
        String(hint?.userId || "") === uid &&
        !backendClaimedByUserId
      ) {
        const overlay = {
          ...slot,
          id: hint.slotId || slot?.id,
          slotId: hint.slotId || slot?.slotId,
          claimedByUserId: hint.userId,
          claimedByName: hint.name,
          startMs: hint.startMs || slot?.startMs,
          endMs: hint.endMs || slot?.endMs,
          status: "claimed",
          claimed: true,
          isClaimed: true,
        };
        merged = mergeScheduleSlotClaimPreservingLocal(slot, overlay, uid);
      } else if (
        entry &&
        uid &&
        String(entry?.userId || "") === uid &&
        !backendClaimedByUserId &&
        isClaimHydrationPending({
          targetChurchId: String(row?.churchId || ""),
          scheduleFeedId: scheduleKey,
          slotId: slotKey,
          userId: uid,
        })
      ) {
        merged = mergeScheduleSlotClaimPreservingLocal(
          {
            ...slot,
            claimedByUserId: entry.userId,
            claimedByName: entry.name,
            claimed: true,
            isClaimed: true,
          },
          slot,
          uid
        );
      }

      if (merged !== slot) changed = true;
      return merged;
    });

    if (!changed) return row;
    return { ...row, scheduleSlots: slots };
  });
}

export function injectClaimStoreScheduleRows(
  rows: any[],
  viewerUserId: string,
  options?: { allSources?: any[] }
): any[] {
  const uid = String(viewerUserId || "").trim();
  if (!uid) return rows;

  const allSources = options?.allSources || rows;
  const existingKeys = new Set(
    rows.map((row) => resolveScheduleRowKey(row, allSources)).filter(Boolean)
  );

  const injected: any[] = [];
  for (const entry of getUserClaimedSlotEntries(uid)) {
    const feedId = baseFeedId(String(entry?.postId || ""));
    const slotId = String(entry?.slotId || "").trim();
    if (!feedId || !slotId) continue;
    if (isScheduleFeedIdDeleted(feedId)) continue;
    if (existingKeys.has(feedId)) continue;

    const sourceItem =
      allSources.find((row) => resolveScheduleRowKey(row, allSources) === feedId) || null;

    const slot = normalizeLiveScheduleSlots([
      {
        id: slotId,
        slotId,
        claimedByUserId: entry.userId,
        claimedByName: entry.name,
        slot: Number(entry?.slotNumber || 1),
      },
    ])[0];

    injected.push({
      id: feedId,
      sourceScheduleId: feedId,
      churchId: String(sourceItem?.churchId || entry?.churchId || "").trim(),
      title: String(sourceItem?.title || sourceItem?.mediaName || "Live Schedule").trim(),
      scheduleSlots: [slot],
      __claimStoreInjected: true,
    });
    existingKeys.add(feedId);
  }

  return injected.length ? [...rows, ...injected] : rows;
}

export function collectScheduleRowsForRingScan(
  churchBackendRows: any[] = [],
  viewerUserId?: string
): any[] {
  const localRows = filterOutDeletedScheduleRows(
    (() => {
      try {
        return feedList() as any[];
      } catch {
        return [];
      }
    })()
  );
  const cachedRows = filterOutDeletedScheduleRows(getCachedHomeFeedBackendRows());
  const backendRows = filterOutDeletedScheduleRows(
    Array.isArray(churchBackendRows) ? churchBackendRows : []
  );
  const mergedInput = [...localRows, ...cachedRows, ...backendRows];
  const byKey = new Map<string, any>();

  for (const row of mergedInput) {
    if (!row || !isMediaScheduleFeedItem(row)) continue;
    if (isScheduleFeedIdDeleted(String(row?.sourceScheduleId || row?.id || ""))) continue;
    const key = resolveScheduleRowKey(row, mergedInput);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing ? mergeScheduleFeedClaimRows(existing, row, viewerUserId) : row
    );
  }

  let rows = filterOutDeletedScheduleRows(Array.from(byKey.values()));
  rows = overlayStableClaimsOnFeedRows(rows, viewerUserId, { allSources: mergedInput });
  rows = injectClaimStoreScheduleRows(rows, String(viewerUserId || ""), {
    allSources: mergedInput,
  });
  return filterOutDeletedScheduleRows(rows);
}

export function rehydrateClaimStoresFromFeedRows(items: any[], viewerUserId: string) {
  const uid = String(viewerUserId || "").trim();
  if (!uid || !Array.isArray(items) || !items.length) return 0;

  let count = 0;
  for (const item of items) {
    if (!isMediaScheduleFeedItem(item)) continue;
    const feedId =
      resolveCanonicalScheduleFeedId(String(item?.sourceScheduleId || item?.id || ""), items) ||
      baseFeedId(String(item?.id || ""));
    if (isScheduleFeedIdDeleted(feedId)) continue;
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];

    slots.forEach((slot: any, index: number) => {
      const slotId = String(slot?.id || slot?.slotId || "").trim();
      const owner = scheduleSlotClaimUserId(slot);
      if (!slotId || owner !== uid) return;

      const window = resolveMediaSlotTimeWindow(slot, Date.now());
      if (isMediaSlotEndedOrStale({ ...slot, ...window }, Date.now())) return;

      syncUserClaimedSlotStore(feedId, slotId, {
        userId: uid,
        name: String(slot?.claimedByName || slot?.claimedBy?.name || "You").trim(),
        role: String(slot?.claimedByRole || slot?.claimedBy?.role || "Member").trim(),
        avatarUri: String(
          slot?.claimedByAvatar ||
            slot?.claimedByAvatarUri ||
            slot?.claimedBy?.avatarUri ||
            ""
        ).trim(),
        churchId: String(item?.churchId || "").trim(),
        targetChurchId: String(item?.churchId || "").trim(),
        slotNumber: Number(slot?.slot || slot?.slotNumber || index + 1),
      });

      const hint: RingClaimHint = {
        feedId,
        baseFeedId: feedId,
        slotId,
        slotNumber: Number(slot?.slot || slot?.slotNumber || index + 1),
        userId: uid,
        startMs: window.startMs,
        endMs: window.endMs,
        name: String(slot?.claimedByName || slot?.claimedBy?.name || "You").trim(),
        role: String(slot?.claimedByRole || slot?.claimedBy?.role || "Member").trim(),
        avatarUri: String(
          slot?.claimedByAvatar ||
            slot?.claimedByAvatarUri ||
            slot?.claimedBy?.avatarUri ||
            ""
        ).trim(),
        claimedAt: String(slot?.claimedAt || new Date().toISOString()),
        churchId: String(item?.churchId || "").trim(),
        item,
        slot,
        updatedAt: Date.now(),
      };
      writeRingClaimHint(hint);

      markClaimHydrationPending({
        targetChurchId: String(item?.churchId || "").trim(),
        scheduleFeedId: feedId,
        slotId,
        userId: uid,
      });

      count += 1;
    });
  }

  if (count > 0) {
    console.log("KRISTO_CLAIM_STORE_REHYDRATE", {
      viewerUserId: uid,
      entryCount: count,
    });
  }

  return count;
}

type PersonalScheduleAlert = {
  match?: string;
  feedId?: string;
  slot?: any;
  item?: any;
};

export async function prefetchCrossChurchClaimSchedules(input: {
  viewerUserId: string;
  viewerChurchId: string;
  viewerRole?: string;
}) {
  const viewerUserId = String(input.viewerUserId || "").trim();
  const viewerChurchId = String(input.viewerChurchId || "").trim();
  if (!viewerUserId || !viewerChurchId) return;

  const entries = getUserClaimedSlotEntries(viewerUserId);
  const targetChurchIds = new Set<string>();

  for (const entry of entries) {
    const targetChurchId = String(entry?.churchId || entry?.targetChurchId || "").trim();
    if (targetChurchId && targetChurchId !== viewerChurchId) {
      targetChurchIds.add(targetChurchId);
    }
  }

  for (const hint of getRingClaimHints(viewerUserId)) {
    const targetChurchId = String(hint?.churchId || hint?.item?.churchId || "").trim();
    if (targetChurchId && targetChurchId !== viewerChurchId) {
      targetChurchIds.add(targetChurchId);
    }
  }

  if (!targetChurchIds.size) return;

  const headers = getKristoHeaders({
    userId: viewerUserId,
    role: (input.viewerRole || "Member") as any,
    churchId: viewerChurchId,
  }) as Record<string, string>;

  for (const targetChurchId of targetChurchIds) {
    try {
      await fetchMediaScheduleFeedSync(viewerChurchId, headers, { targetChurchId });
      for (const entry of entries) {
        const entryChurchId = String(entry?.churchId || entry?.targetChurchId || "").trim();
        if (entryChurchId !== targetChurchId) continue;
        resolveClaimHydration({
          targetChurchId,
          scheduleFeedId: baseFeedId(String(entry?.postId || "")),
          slotId: String(entry?.slotId || ""),
          userId: viewerUserId,
        });
      }
    } catch {
      // Keep local overlay until a later refetch succeeds.
    }
  }
}

export function resolveStablePersonalScheduleAlert(options: {
  computed: PersonalScheduleAlert | null;
  previous: PersonalScheduleAlert | null;
  viewerUserId: string;
  source: string;
}): PersonalScheduleAlert | null {
  const uid = String(options.viewerUserId || "").trim();
  const computed = options.computed;
  const previous = options.previous;
  const hydrating = isClaimHydrationPending();

  const computedClaimed = computed?.match === "claimed";
  const previousClaimed = previous?.match === "claimed";

  let result = computed;
  let preservedByLocalClaim = false;
  let sourceUsed: ClaimButtonStateSourceLog["source"] = computedClaimed
    ? "backend"
    : hydrating
      ? "cache"
      : "backend";

  if (!computedClaimed && previousClaimed && hydrating) {
    result = previous;
    preservedByLocalClaim = true;
    sourceUsed = "preserved";
  } else if (!computedClaimed && uid) {
    const storeEntries = getUserClaimedSlotEntries(uid);
    const hints = getRingClaimHints(uid);
    if (storeEntries.length || hints.length) {
      result = computed || previous;
      sourceUsed = storeEntries.length ? "claim-store" : "ring-hint";
    }
  }

  if (computedClaimed && (hydrating || preservedByLocalClaim)) {
    sourceUsed = "merged";
  }

  const backendClaimedByUserId = scheduleSlotClaimUserId(result?.slot);
  const claimedByMe =
    result?.match === "claimed" &&
    (!uid || !backendClaimedByUserId || backendClaimedByUserId === uid);

  logClaimButtonStateSource({
    source: sourceUsed,
    claimHydrationPending: hydrating,
    claimedByMe,
    preservedByLocalClaim,
    backendClaimedByUserId,
    feedId: result?.feedId || "",
    slotId: String(result?.slot?.id || result?.slot?.slotId || ""),
    targetChurchId: String(result?.item?.churchId || ""),
  });

  return result;
}
