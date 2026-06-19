import {
  expandHomeFeedScheduleIntoSlotRows,
  homeFeedRowChurchId,
  isExplicitHomeFeedMediaScheduleRow,
  isHomeFeedClaimableSlotRow,
  isHomeFeedScheduleSlotRowVisible,
  isMediaLiveSlotsHomeFeedRow,
  sortHomeFeedScheduleSlotRows,
} from "@/components/homeFeed/homeFeedUtils";
import {
  injectClaimStoreScheduleRows,
  mergeScheduleSlotClaimPreservingLocal,
  overlayStableClaimsOnFeedRows,
} from "@/lib/claimStateMerge";
import { getRingClaimHints } from "@/lib/homeFeedStore";
import { isMediaScheduleFeedItem } from "@/lib/mediaScheduleFeedIdentify";
import { peekHomeFeedBackendRowsMemory } from "@/lib/homeFeedBackendRowsMemory";
import { peekHomeFeedRowsCacheSync } from "@/components/homeFeed/homeFeedRowsCache";
import { filterOutDeletedScheduleRows, getDeletedScheduleFeedIds } from "@/lib/deletedScheduleRegistry";
import { resolveRingMergedScheduleRows } from "@/lib/liveScheduleRing";
import {
  applyRingClaimHintsToScheduleSlots,
  baseFeedId,
  scheduleSlotClaimUserId,
} from "@/lib/scheduleSlotUtils";

export type LiveSlotsCatalog = {
  myChurch: any[];
  otherChurches: any[];
};

export type LiveSlotsBackendSourceSnapshot = {
  backendFeedCount: number;
  backendSlotCount: number;
  localSlotCount: number;
  routeSlotCount: number;
  sourceUsed: "backend" | "local" | "empty";
};

function peekCachedHomeFeedBackendRows(): any[] {
  const memory = peekHomeFeedBackendRowsMemory();
  if (memory.length) return memory;
  return peekHomeFeedRowsCacheSync();
}

function isLiveSlotsScheduleSourceRow(row: any) {
  return isExplicitHomeFeedMediaScheduleRow(row) || isMediaLiveSlotsHomeFeedRow(row) || isMediaScheduleFeedItem(row);
}

function scheduleRowHasBackendSlots(row: any) {
  return Array.isArray(row?.scheduleSlots) && row.scheduleSlots.length > 0;
}

function resolveLiveSlotsScheduleKey(row: any) {
  const seed = String(row?.sourceScheduleId || row?.parentScheduleId || row?.id || "").trim();
  return baseFeedId(seed) || seed;
}

function countBackendSlotsInRows(rows: any[]) {
  return rows.reduce((sum, row) => {
    if (!isLiveSlotsScheduleSourceRow(row)) return sum;
    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    return sum + slots.length;
  }, 0);
}

function resolveLiveSlotMatchKey(slot: any, index = 0) {
  const id = String(slot?.id || slot?.slotId || "").trim();
  if (id) return id;
  const slotNumber = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
  return `num:${slotNumber > 0 ? slotNumber : index + 1}`;
}

/** Overlay fresher claim fields from home feed / ring hints onto backend schedule rows. */
export function overlayLocalScheduleClaimsOnFeedRows(
  backendRows: any[],
  localRows: any[],
  viewerUserId?: string
): any[] {
  if (!Array.isArray(backendRows) || !backendRows.length) return backendRows;

  const localByScheduleKey = new Map<string, any>();
  for (const row of localRows || []) {
    if (!isLiveSlotsScheduleSourceRow(row)) continue;
    const key = resolveLiveSlotsScheduleKey(row);
    if (!key) continue;
    localByScheduleKey.set(key, row);
  }

  const allRows = [...backendRows, ...(localRows || [])];
  const hints = getRingClaimHints(viewerUserId);

  const mergedRows = backendRows.map((row) => {
    const scheduleKey = resolveLiveSlotsScheduleKey(row);
    const localRow = scheduleKey ? localByScheduleKey.get(scheduleKey) : null;
    let slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    let changed = false;

    if (localRow && Array.isArray(localRow.scheduleSlots) && localRow.scheduleSlots.length) {
      const localSlotsByKey = new Map<string, any>();
      localRow.scheduleSlots.forEach((slot: any, index: number) => {
        localSlotsByKey.set(resolveLiveSlotMatchKey(slot, index), slot);
      });

      slots = slots.map((slot: any, index: number) => {
        const localSlot = localSlotsByKey.get(resolveLiveSlotMatchKey(slot, index));
        if (!localSlot) return slot;
        const backendOwner = scheduleSlotClaimUserId(slot);
        const viewerUid = String(viewerUserId || "").trim();
        if (backendOwner && backendOwner !== viewerUid) {
          return slot;
        }
        const merged = mergeScheduleSlotClaimPreservingLocal(localSlot, slot, viewerUserId);
        if (merged !== slot) changed = true;
        return merged;
      });
    }

    if (scheduleKey && hints.length) {
      const hinted = applyRingClaimHintsToScheduleSlots(slots, scheduleKey, hints, allRows);
      if (hinted !== slots) {
        slots = hinted;
        changed = true;
      }
    }

    if (!changed) return row;
    return { ...row, scheduleSlots: slots };
  });

  return filterOutDeletedScheduleRows(
    injectClaimStoreScheduleRows(
      overlayStableClaimsOnFeedRows(mergedRows, viewerUserId, { allSources: allRows }),
      String(viewerUserId || ""),
      { allSources: allRows }
    )
  );
}

/** Backend church feed wins for viewer church; use ring-merged rows as canonical source. */
export function resolveLiveSlotsBackendFeedRows(input: {
  churchBackendRows: any[];
  globalBackendRows: any[];
  viewerChurchId: string;
  viewerUserId?: string;
  localRows?: any[];
  churchFeedLoaded?: boolean;
}): { rows: any[]; snapshot: LiveSlotsBackendSourceSnapshot } {
  const viewerCid = String(input.viewerChurchId || "").trim();
  const churchRows = filterOutDeletedScheduleRows((input.churchBackendRows || []).filter(Boolean));
  const globalRows = filterOutDeletedScheduleRows((input.globalBackendRows || []).filter(Boolean));
  const cachedRows = filterOutDeletedScheduleRows(peekCachedHomeFeedBackendRows());
  const localRows = filterOutDeletedScheduleRows(Array.isArray(input.localRows) ? input.localRows : []);
  const churchFeedLoaded = input.churchFeedLoaded === true;

  const churchBackendForRing = churchRows.length
    ? churchRows
    : globalRows.length
      ? globalRows
      : cachedRows;
  const hasBackendSignal =
    churchRows.length > 0 || globalRows.length > 0 || cachedRows.length > 0 || churchFeedLoaded;

  let rows = resolveRingMergedScheduleRows({
    churchBackendRows: churchBackendForRing,
    viewerUserId: input.viewerUserId,
    viewerChurchId: viewerCid,
    backendFeedLoaded: hasBackendSignal,
  });

  const beforeDeletedFilterCount = rows.length;
  rows = filterOutDeletedScheduleRows(rows).filter(
    (row) => isLiveSlotsScheduleSourceRow(row) && scheduleRowHasBackendSlots(row)
  );
  const afterDeletedFilterCount = rows.length;

  console.log("KRISTO_LIVE_SLOTS_DELETED_FILTER", {
    deletedFeedIds: getDeletedScheduleFeedIds(),
    beforeRowCount: beforeDeletedFilterCount,
    afterRowCount: afterDeletedFilterCount,
    removedByDeletedFilter: Math.max(0, beforeDeletedFilterCount - afterDeletedFilterCount),
    churchBackendInputCount: churchRows.length,
    globalBackendInputCount: globalRows.length,
    cachedInputCount: cachedRows.length,
    churchFeedLoaded,
  });

  console.log("KRISTO_LIVE_SLOTS_CLAIM_STATE_SYNC", {
    viewerChurchId: viewerCid,
    viewerUserId: String(input.viewerUserId || ""),
    sourceUsed: rows.length ? "backend" : localRows.length ? "local" : "empty",
    scheduleRowCount: rows.length,
    slotClaimStates: summarizeScheduleRowClaimStates(rows),
  });

  const backendSlotCount = countBackendSlotsInRows(rows);
  const localSlotCount = localRows.reduce((sum, row) => {
    if (!isLiveSlotsScheduleSourceRow(row)) return sum;
    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    return sum + slots.length;
  }, 0);

  let sourceUsed: LiveSlotsBackendSourceSnapshot["sourceUsed"] = "empty";
  if (rows.length) {
    sourceUsed = "backend";
  } else if (localRows.length) {
    sourceUsed = "local";
  }

  return {
    rows,
    snapshot: {
      backendFeedCount: rows.length,
      backendSlotCount,
      localSlotCount,
      routeSlotCount: localSlotCount,
      sourceUsed,
    },
  };
}

/** Sequential 1..N display numbers within each parent schedule after filtering. */
export function renumberLiveSlotsCatalogRows(rows: any[]): any[] {
  const bySchedule = new Map<string, any[]>();

  for (const row of rows) {
    const scheduleId = String(
      row?.parentScheduleId || row?.sourceScheduleId || baseFeedId(String(row?.id || ""))
    ).trim();
    if (!scheduleId) continue;
    if (!bySchedule.has(scheduleId)) bySchedule.set(scheduleId, []);
    bySchedule.get(scheduleId)!.push(row);
  }

  const renumbered: any[] = [];
  for (const group of bySchedule.values()) {
    const sorted = sortHomeFeedScheduleSlotRows(group);
    const total = sorted.length;
    sorted.forEach((row, index) => {
      const displayNumber = index + 1;
      renumbered.push({
        ...row,
        slotNumber: displayNumber,
        parentScheduleSlotCount: total,
        slotFeedIndex: displayNumber - 1,
      });
    });
  }

  return sortHomeFeedScheduleSlotRows(renumbered);
}

/** Build claimable slot lists from backend feed rows only. */
export function buildLiveSlotsCatalogFromFeedRows(
  rows: any[],
  viewerChurchId: string,
  viewerUserId: string,
  nowMs = Date.now()
): LiveSlotsCatalog {
  if (!Array.isArray(rows) || !rows.length) {
    return { myChurch: [], otherChurches: [] };
  }

  const scheduleSource = filterOutDeletedScheduleRows(
    rows.filter(
      (row) => isLiveSlotsScheduleSourceRow(row) && scheduleRowHasBackendSlots(row)
    )
  );
  const expanded = scheduleSource.flatMap((row) => expandHomeFeedScheduleIntoSlotRows(row, nowMs));
  const visible = renumberLiveSlotsCatalogRows(
    filterOutDeletedScheduleRows(
      expanded.filter((row) => isHomeFeedScheduleSlotRowVisible(row, nowMs))
    )
  );

  const viewerCid = String(viewerChurchId || "").trim();
  const myChurch: any[] = [];
  const otherChurches: any[] = [];

  for (const row of visible) {
    const rowChurchId = homeFeedRowChurchId(row);
    if (viewerCid && rowChurchId === viewerCid) {
      myChurch.push(row);
      continue;
    }
    if (
      rowChurchId &&
      isHomeFeedClaimableSlotRow(row, viewerCid || rowChurchId, viewerUserId, nowMs)
    ) {
      otherChurches.push(row);
    }
  }

  return {
    myChurch: renumberLiveSlotsCatalogRows(myChurch),
    otherChurches: renumberLiveSlotsCatalogRows(otherChurches),
  };
}

/** @deprecated Live Slots uses backend rows only; kept for tests/callers migrating off local merge. */
export function mergeLiveSlotsFeedSources(backendRows: any[], localRows: any[]): any[] {
  const byId = new Map<string, any>();
  for (const row of localRows) {
    if (!row) continue;
    const id = String(row?.id || "").trim();
    if (!id) continue;
    byId.set(id, row);
  }
  for (const row of backendRows) {
    if (!row) continue;
    const id = String(row?.id || "").trim();
    if (!id) continue;
    byId.set(id, row);
  }
  return Array.from(byId.values());
}

export function summarizeScheduleRowClaimStates(rows: any[]) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const scheduleId = String(row?.sourceScheduleId || row?.id || "").trim();
    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    return slots.map((slot: any, index: number) => ({
      scheduleId,
      slotId: String(slot?.id || slot?.slotId || "").trim(),
      slotNumber: Math.max(1, Number(slot?.slot || slot?.slotNumber || index + 1)),
      claimedByUserId: scheduleSlotClaimUserId(slot),
      claimedByName: String(slot?.claimedByName || slot?.claimedBy?.name || "").trim(),
      claimedAt: String(slot?.claimedAt || slot?.claimedBy?.claimedAt || "").trim(),
      status: String(slot?.status || "").trim(),
    }));
  });
}

export function filterLiveSlotsRenderRows(rows: any[]): any[] {
  return filterOutDeletedScheduleRows(Array.isArray(rows) ? rows : []);
}

export function summarizeLiveSlotsRenderRows(rows: any[]) {
  return {
    renderedCardCount: rows.length,
    renderedSlotNumbers: rows.map((row, index) =>
      Math.max(1, Number(row?.slotNumber || index + 1))
    ),
    slotClaimStates: rows.map((row, index) => {
      const slot = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots[0] : null;
      const claimedByUserId = scheduleSlotClaimUserId(slot);
      return {
        slotNumber: Math.max(1, Number(row?.slotNumber || index + 1)),
        slotId: String(slot?.id || ""),
        claimedByUserId,
        status: String(slot?.status || ""),
        claimed: Boolean(claimedByUserId || slot?.claimed === true || slot?.isClaimed === true),
      };
    }),
  };
}
