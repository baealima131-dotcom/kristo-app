import {
  expandHomeFeedScheduleIntoSlotRows,
  homeFeedRowChurchId,
  isExplicitHomeFeedMediaScheduleRow,
  isHomeFeedClaimableSlotRow,
  isHomeFeedScheduleSlotRowVisible,
  isMediaLiveSlotsHomeFeedRow,
  sortHomeFeedScheduleSlotRows,
} from "@/src/components/homeFeed/homeFeedUtils";

export type LiveSlotsCatalog = {
  myChurch: any[];
  otherChurches: any[];
};

/** Build claimable slot lists from raw feed rows (not Home Feed display rows). */
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
    (row) => isExplicitHomeFeedMediaScheduleRow(row) || isMediaLiveSlotsHomeFeedRow(row)
  );
  const expanded = scheduleSource.flatMap((row) =>
    expandHomeFeedScheduleIntoSlotRows(row, nowMs)
  );
  const visible = sortHomeFeedScheduleSlotRows(
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

  return { myChurch, otherChurches };
}

export function mergeLiveSlotsFeedSources(backendRows: any[], localRows: any[]): any[] {
  const byId = new Map<string, any>();
  for (const row of [...backendRows, ...localRows]) {
    if (!row) continue;
    const id = String(row?.id || "").trim();
    if (!id) continue;
    byId.set(id, row);
  }
  return Array.from(byId.values());
}
