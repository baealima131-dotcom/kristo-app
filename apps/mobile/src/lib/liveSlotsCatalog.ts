import {
  expandHomeFeedScheduleIntoSlotRows,
  homeFeedRowChurchId,
  isExplicitHomeFeedMediaScheduleRow,
  isHomeFeedClaimableSlotRow,
  isHomeFeedScheduleSlotRowVisible,
  isMediaLiveSlotsHomeFeedRow,
  sortHomeFeedScheduleSlotRows,
} from "@/src/components/homeFeed/homeFeedUtils";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleLock";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

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

/** Backend church feed wins for viewer church; global backend only — never merge local/route rows. */
export function resolveLiveSlotsBackendFeedRows(input: {
  churchBackendRows: any[];
  globalBackendRows: any[];
  viewerChurchId: string;
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

  const rows = Array.from(byScheduleKey.values());
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
  };
}
