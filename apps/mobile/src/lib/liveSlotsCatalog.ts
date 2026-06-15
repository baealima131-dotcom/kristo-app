import {
  expandHomeFeedScheduleIntoSlotRows,
  homeFeedRowChurchId,
  isExplicitHomeFeedMediaScheduleRow,
  isHomeFeedClaimableSlotRow,
  isHomeFeedScheduleSlotRowVisible,
  isMediaLiveSlotsHomeFeedRow,
  sortHomeFeedScheduleSlotRows,
} from "@/src/components/homeFeed/homeFeedUtils";
import {
  injectClaimStoreScheduleRows,
  overlayStableClaimsOnFeedRows,
} from "@/src/lib/claimStateMerge";
import { getRingClaimHints } from "@/src/lib/homeFeedStore";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleLock";
import {
  applyRingClaimHintsToScheduleSlots,
  baseFeedId,
  mergeScheduleSlotClaimState,
  scheduleSlotClaimUserId,
} from "@/src/lib/scheduleSlotUtils";

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
        const merged = mergeScheduleSlotClaimState(slot, localSlot);
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

  return injectClaimStoreScheduleRows(
    overlayStableClaimsOnFeedRows(mergedRows, viewerUserId, { allSources: allRows }),
    String(viewerUserId || ""),
    { allSources: allRows }
  );
}

/** Backend church feed wins for viewer church; local claim overlay fills stale reload gaps. */
export function resolveLiveSlotsBackendFeedRows(input: {
  churchBackendRows: any[];
  globalBackendRows: any[];
  viewerChurchId: string;
  viewerUserId?: string;
  localRows?: any[];
  churchFeedLoaded?: boolean;
}): { rows: any[]; snapshot: LiveSlotsBackendSourceSnapshot } {
  const viewerCid = String(input.viewerChurchId || "").trim();
  const churchRows = (input.churchBackendRows || []).filter(
    (row) => row && (!viewerCid || String(row?.churchId || "").trim() === viewerCid)
  );
  const globalRows = (input.globalBackendRows || []).filter(Boolean);
  const localRows = Array.isArray(input.localRows) ? input.localRows : [];
  const churchFeedLoaded = input.churchFeedLoaded === true;

  const byScheduleKey = new Map<string, any>();

  for (const row of globalRows) {
    if (!isLiveSlotsScheduleSourceRow(row)) continue;
    if (!scheduleRowHasBackendSlots(row)) continue;
    const key = resolveLiveSlotsScheduleKey(row);
    if (!key) continue;
    byScheduleKey.set(key, row);
  }

  for (const row of churchRows) {
    if (!isLiveSlotsScheduleSourceRow(row)) continue;
    const key = resolveLiveSlotsScheduleKey(row);
    if (!key) continue;
    if (!scheduleRowHasBackendSlots(row)) {
      byScheduleKey.delete(key);
      continue;
    }
    byScheduleKey.set(key, row);
  }

  if (viewerCid && churchFeedLoaded) {
    const churchScheduleKeys = new Set(
      churchRows
        .filter(isLiveSlotsScheduleSourceRow)
        .filter(scheduleRowHasBackendSlots)
        .map((row) => resolveLiveSlotsScheduleKey(row))
        .filter(Boolean)
    );

    for (const [key, row] of [...byScheduleKey.entries()]) {
      if (String(row?.churchId || "").trim() !== viewerCid) continue;
      if (!isLiveSlotsScheduleSourceRow(row)) continue;
      if (!churchScheduleKeys.has(key)) {
        byScheduleKey.delete(key);
      }
    }
  }

  let rows = Array.from(byScheduleKey.values());
  rows = overlayLocalScheduleClaimsOnFeedRows(rows, localRows, input.viewerUserId);
  const backendSlotCount = countBackendSlotsInRows(rows);
  const localSlotCount = localRows.reduce((sum, row) => {
    if (!isLiveSlotsScheduleSourceRow(row)) return sum;
    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    return sum + slots.length;
  }, 0);

  let sourceUsed: LiveSlotsBackendSourceSnapshot["sourceUsed"] = "empty";
  if (churchRows.length || globalRows.length) {
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
      routeSlotCount: 0,
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

  const scheduleSource = rows.filter(
    (row) => isLiveSlotsScheduleSourceRow(row) && scheduleRowHasBackendSlots(row)
  );
  const expanded = scheduleSource.flatMap((row) => expandHomeFeedScheduleIntoSlotRows(row, nowMs));
  const visible = renumberLiveSlotsCatalogRows(
    expanded.filter((row) => isHomeFeedScheduleSlotRowVisible(row, nowMs))
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
