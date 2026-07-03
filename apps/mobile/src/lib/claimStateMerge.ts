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
  purgeClaimedSlotLocalState,
  syncUserClaimedSlotStore,
  writeRingClaimHint,
  type RingClaimHint,
} from "@/src/lib/homeFeedStore";
import { fetchMediaScheduleFeedSync } from "@/src/lib/mediaScheduleSilentReload";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleFeedPredicates";
import { isMediaSlotEndedOrStale, resolveMediaSlotTimeWindow } from "@/src/lib/mediaScheduleSlotTimes";
import { logClaimOverwriteBlocked } from "@/src/lib/scheduleSlotClaimRequest";
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

function resolveSlotIdFromSlot(slot: any): string {
  return String(slot?.id || slot?.slotId || "").trim();
}

function isSlotMarkedDeleted(slot: any): boolean {
  if (!slot || typeof slot !== "object") return true;
  if (slot.deleted === true || slot.deletedAt) return true;
  const status = String(slot?.status || "").toLowerCase();
  return (
    status === "deleted" ||
    status === "removed" ||
    status === "cancelled" ||
    status === "canceled"
  );
}

function resolveScheduleRowFeedId(row: any, allRows: any[]): string {
  const seed = String(row?.sourceScheduleId || row?.id || "").trim();
  return (
    resolveCanonicalScheduleFeedId(seed, allRows) ||
    baseFeedId(seed) ||
    seed
  );
}

export function isScheduleFeedPresentInRows(rows: any[], feedId: string): boolean {
  const target = baseFeedId(String(feedId || ""));
  if (!target) return false;
  const merged = Array.isArray(rows) ? rows : [];
  return merged.some((row) => {
    if (!isMediaScheduleFeedItem(row)) return false;
    const rowFeedId = resolveScheduleRowFeedId(row, merged);
    if (rowFeedId === target) return true;
    const aliases = new Set(collectScheduleAliasIds(target, merged));
    return (
      aliases.has(rowFeedId) ||
      aliases.has(String(row?.id || "")) ||
      aliases.has(String(row?.sourceScheduleId || ""))
    );
  });
}

/** Slot must exist on an authoritative schedule feed row — not claim-store/hint alone. */
export function findAuthoritativeScheduleSlot(
  rows: any[],
  feedId: string,
  slotId: string
): { item: any; slot: any; index: number } | null {
  const targetFeed = baseFeedId(String(feedId || ""));
  const targetSlot = String(slotId || "").trim();
  if (!targetFeed || !targetSlot) return null;

  const merged = Array.isArray(rows) ? rows : [];
  for (const item of merged) {
    if (!isMediaScheduleFeedItem(item)) continue;
    const itemFeedId = resolveScheduleRowFeedId(item, merged);
    if (itemFeedId !== targetFeed) {
      const aliases = new Set(collectScheduleAliasIds(targetFeed, merged));
      if (
        !aliases.has(itemFeedId) &&
        !aliases.has(String(item?.id || "")) &&
        !aliases.has(String(item?.sourceScheduleId || ""))
      ) {
        continue;
      }
    }

    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      if (resolveSlotIdFromSlot(slot) !== targetSlot) continue;
      if (isSlotMarkedDeleted(slot)) return null;
      return { item, slot, index };
    }
  }

  return null;
}

export function isSlotAuthoritativelyClaimedByViewer(
  rows: any[],
  feedId: string,
  slotId: string,
  viewerUserId: string
): boolean {
  const uid = String(viewerUserId || "").trim();
  const found = findAuthoritativeScheduleSlot(rows, feedId, slotId);
  if (!found || !uid) return false;
  return scheduleSlotClaimUserId(found.slot) === uid;
}

export function reconcileUserClaimedSlotStoreAgainstScheduleRows(
  rows: any[],
  viewerUserId: string,
  options?: { authoritative?: boolean; reason?: string }
): number {
  const uid = String(viewerUserId || "").trim();
  if (!uid || options?.authoritative !== true) return 0;

  const merged = Array.isArray(rows) ? rows : [];
  const reason = String(options?.reason || "reconcile");
  let purged = 0;

  for (const entry of getUserClaimedSlotEntries(uid)) {
    const feedId = baseFeedId(String(entry?.postId || ""));
    const slotId = String(entry?.slotId || "").trim();
    if (!feedId || !slotId) continue;

    if (isScheduleFeedIdDeleted(feedId)) {
      purgeClaimedSlotLocalState({
        scheduleId: feedId,
        slotId,
        userId: uid,
        reason: `${reason}-schedule-deleted`,
        rows: merged,
      });
      purged += 1;
      continue;
    }

    if (!isScheduleFeedPresentInRows(merged, feedId)) continue;

    const found = findAuthoritativeScheduleSlot(merged, feedId, slotId);
    if (!found) {
      purgeClaimedSlotLocalState({
        scheduleId: feedId,
        slotId,
        userId: uid,
        reason: `${reason}-slot-missing`,
        rows: merged,
      });
      purged += 1;
      continue;
    }

    if (scheduleSlotClaimUserId(found.slot) !== uid) {
      purgeClaimedSlotLocalState({
        scheduleId: feedId,
        slotId,
        userId: uid,
        reason: `${reason}-backend-unclaimed`,
        rows: merged,
      });
      purged += 1;
    }
  }

  for (const hint of getRingClaimHints(uid)) {
    const feedId = baseFeedId(String(hint?.baseFeedId || hint?.feedId || ""));
    const slotId = String(hint?.slotId || "").trim();
    if (!feedId || !slotId) continue;

    if (isScheduleFeedIdDeleted(feedId)) {
      purgeClaimedSlotLocalState({
        scheduleId: feedId,
        slotId,
        userId: uid,
        reason: `${reason}-hint-schedule-deleted`,
        rows: merged,
      });
      purged += 1;
      continue;
    }

    if (!isScheduleFeedPresentInRows(merged, feedId)) continue;

    if (!findAuthoritativeScheduleSlot(merged, feedId, slotId)) {
      purgeClaimedSlotLocalState({
        scheduleId: feedId,
        slotId,
        userId: uid,
        reason: `${reason}-hint-slot-missing`,
        rows: merged,
      });
      purged += 1;
    }
  }

  if (purged > 0) {
    console.log("KRISTO_CLAIM_STORE_RECONCILE", {
      viewerUserId: uid,
      purged,
      reason,
      rowCount: merged.length,
    });
  }

  return purged;
}

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

  if (prevOwner && nextOwner && prevOwner !== nextOwner) {
    logClaimOverwriteBlocked({
      slotId: String(prev?.id || prev?.slotId || next?.id || next?.slotId || ""),
      existingClaimedByUserId: nextOwner,
      incomingUserId: prevOwner,
      source: "mergeScheduleSlotClaimPreservingLocal",
    });
    return next;
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
    if (backendOwner) {
      if (backendOwner !== preserveUid) {
        return slot;
      }
      const localOwner = scheduleSlotClaimUserId(localSlot);
      if (localOwner && localOwner !== backendOwner) {
        logClaimOverwriteBlocked({
          slotId: String(slot?.id || slot?.slotId || localSlot?.id || localSlot?.slotId || ""),
          existingClaimedByUserId: backendOwner,
          incomingUserId: localOwner,
          source: "mergeScheduleFeedClaimRows",
        });
        return slot;
      }
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

      if (backendClaimedByUserId && uid && backendClaimedByUserId !== uid) {
        if (entry || hint) {
          logClaimOverwriteBlocked({
            slotId: slotKey,
            existingClaimedByUserId: backendClaimedByUserId,
            incomingUserId: uid,
            source: "overlayStableClaimsOnFeedRows",
          });
        }
        return slot;
      }

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
  _viewerUserId: string,
  _options?: { allSources?: any[] }
): any[] {
  // Claims must come from authoritative schedule feed rows — never synthesize rows from local store.
  return rows;
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

  reconcileUserClaimedSlotStoreAgainstScheduleRows(items, uid, {
    authoritative: true,
    reason: "rehydrate",
  });

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
        startMs: window.startMs,
        endMs: window.endMs,
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
