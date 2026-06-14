import {
  clearScheduleClaimRuntimeState,
  feedList,
  feedRemoveScheduleMirrors,
} from "@/src/lib/homeFeedStore";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleLock";
import { publishLiveEnded } from "@/src/lib/liveBridge";
import {
  baseFeedId,
  collectScheduleAliasIds,
  isBackendFeedScheduleId,
  isLocalMediaScheduleId,
  resolveCanonicalScheduleFeedId,
  resolveLiveRingCanonicalFeedId,
} from "@/src/lib/scheduleSlotUtils";

function isMediaScheduleRow(item: any): boolean {
  if (!item || typeof item !== "object") return false;
  const source = String(item?.source || "").toLowerCase();
  const scheduleType = String(item?.scheduleType || "").toLowerCase();
  return (
    isMediaScheduleFeedItem(item) ||
    source.includes("media-schedule") ||
    scheduleType.includes("media-live-slots")
  );
}

/** Backend slot count for a canonical feed_* id; null when backend is not loaded yet. */
export function resolveBackendSlotCountForCanonicalFeedId(
  canonicalFeedId: string,
  backendRows: any[],
  backendFeedLoaded = false
): number | null {
  const canonical = baseFeedId(canonicalFeedId) || String(canonicalFeedId || "").trim();
  if (!isBackendFeedScheduleId(canonical)) return null;
  if (!backendFeedLoaded) return null;

  for (const row of backendRows) {
    if (!isMediaScheduleRow(row)) continue;
    const merged = [...backendRows, ...(feedList() as any[])];
    const rowCanonical =
      resolveCanonicalScheduleFeedId(String(row?.id || row?.sourceScheduleId || ""), merged) ||
      baseFeedId(row?.id);
    if (rowCanonical !== canonical && baseFeedId(row?.id) !== canonical) continue;
    return Array.isArray(row?.scheduleSlots) ? row.scheduleSlots.length : 0;
  }

  return 0;
}

export function backendConfirmsZeroSlotsForFeedId(
  feedId: string,
  backendRows: any[],
  backendFeedLoaded = false
): boolean {
  const count = resolveBackendSlotCountForCanonicalFeedId(feedId, backendRows, backendFeedLoaded);
  return count === 0;
}

export function shouldIgnoreRouteSlotsForBackendFeedId(input: {
  feedId: string;
  backendRows: any[];
  backendFeedLoaded: boolean;
  backendSlotCount?: number;
}) {
  const feedId = String(input.feedId || "").trim();
  if (!isBackendFeedScheduleId(feedId)) return false;

  if (input.backendFeedLoaded && Number(input.backendSlotCount ?? -1) === 0) {
    return true;
  }

  return backendConfirmsZeroSlotsForFeedId(feedId, input.backendRows, input.backendFeedLoaded);
}

export function endLiveBridgeForStaleScheduleFeedId(feedId: string, rows?: any[]) {
  const seed = String(feedId || "").trim();
  if (!seed) return;

  const merged = [...(rows || []), ...(feedList() as any[])];
  const canonical = resolveCanonicalScheduleFeedId(seed, merged) || baseFeedId(seed) || seed;
  const aliases = collectScheduleAliasIds(canonical, merged);
  const liveIds = new Set(aliases.map((id) => baseFeedId(id)).filter(Boolean));
  liveIds.add(baseFeedId(canonical));
  for (const liveId of liveIds) {
    publishLiveEnded(liveId);
  }
}

export function purgeStaleLocalScheduleRowsWhenBackendZero(input: {
  backendRows: any[];
  backendFeedLoaded?: boolean;
  churchId?: string;
  reason?: string;
}) {
  const backendRows = Array.isArray(input.backendRows) ? input.backendRows : [];
  const backendFeedLoaded = input.backendFeedLoaded === true;
  if (!backendFeedLoaded) {
    return { removedLocalIds: [] as string[], canonicalFeedIds: [] as string[] };
  }

  const churchId = String(input.churchId || "").trim();
  const localRows = feedList() as any[];
  const merged = [...backendRows, ...localRows];
  const removedLocalIds = new Set<string>();
  const canonicalFeedIds = new Set<string>();

  for (const row of backendRows) {
    if (!isMediaScheduleRow(row)) continue;
    const canonical =
      resolveCanonicalScheduleFeedId(String(row?.id || row?.sourceScheduleId || ""), merged) ||
      baseFeedId(row?.id);
    if (!isBackendFeedScheduleId(canonical)) continue;

    const backendSlotCount = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots.length : 0;
    if (backendSlotCount > 0) continue;

    canonicalFeedIds.add(canonical);
    console.log("KRISTO_STALE_ROUTE_SLOTS_IGNORED", {
      canonicalFeedId: canonical,
      backendSlotCount: 0,
      routeSlotCount: backendSlotCount,
      reason: input.reason || "backend-row-empty-slots",
    });
  }

  for (const row of localRows) {
    if (!isLocalMediaScheduleId(row?.id)) continue;
    if (churchId && String(row?.churchId || "").trim() && String(row.churchId) !== churchId) {
      continue;
    }

    const { canonicalFeedId, localScheduleId } = resolveLiveRingCanonicalFeedId(row, merged);
    if (!isBackendFeedScheduleId(canonicalFeedId)) continue;

    const backendSlotCount = resolveBackendSlotCountForCanonicalFeedId(
      canonicalFeedId,
      backendRows,
      true
    );
    if (backendSlotCount !== 0) continue;

    const routeSlotCount = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots.length : 0;
    removedLocalIds.add(String(row?.id || localScheduleId || "").trim());
    canonicalFeedIds.add(canonicalFeedId);

    console.log("KRISTO_STALE_ROUTE_SLOTS_IGNORED", {
      canonicalFeedId,
      localScheduleId: String(row?.id || localScheduleId || ""),
      backendSlotCount: 0,
      routeSlotCount,
      reason: input.reason || "local-row-backend-zero",
    });
  }

  for (const canonicalFeedId of canonicalFeedIds) {
    clearScheduleClaimRuntimeState(canonicalFeedId, merged);
    feedRemoveScheduleMirrors(canonicalFeedId);
    endLiveBridgeForStaleScheduleFeedId(canonicalFeedId, merged);
  }

  const removed = Array.from(removedLocalIds).filter(Boolean);
  if (removed.length || canonicalFeedIds.size > 0) {
    console.log("KRISTO_RING_STALE_LOCAL_SCHEDULE_REMOVED", {
      reason: input.reason || "backend-zero-slots",
      canonicalFeedIds: Array.from(canonicalFeedIds),
      removedLocalIds: removed,
    });
  }

  return {
    removedLocalIds: removed,
    canonicalFeedIds: Array.from(canonicalFeedIds),
  };
}

export function filterLocalRowsWhenBackendZeroSlots(
  localRows: any[],
  backendRows: any[],
  backendFeedLoaded = false
) {
  if (!backendFeedLoaded) return localRows;

  const merged = [...backendRows, ...localRows];
  return localRows.filter((row) => {
    if (!isMediaScheduleRow(row)) return true;

    const { canonicalFeedId } = resolveLiveRingCanonicalFeedId(row, merged);
    if (!isBackendFeedScheduleId(canonicalFeedId)) return true;

    const backendSlotCount = resolveBackendSlotCountForCanonicalFeedId(
      canonicalFeedId,
      backendRows,
      true
    );
    return backendSlotCount !== 0;
  });
}

export async function cleanupStaleMediaSchedulePair(input: {
  feedId: string;
  localScheduleId?: string;
  churchId: string;
  headers: Record<string, string>;
  reason?: string;
}) {
  const feedId = String(input.feedId || "").trim();
  const localScheduleId = String(input.localScheduleId || "").trim();
  const churchId = String(input.churchId || "").trim();
  const reason = String(input.reason || "stale-schedule-pair-cleanup").trim();

  const { cleanupStaleMediaScheduleFeedRow } = await import("@/src/lib/staleMediaScheduleCleanup");
  const backendResult = await cleanupStaleMediaScheduleFeedRow({
    feedId,
    churchId,
    headers: input.headers,
    reason,
  });

  const merged = feedList() as any[];
  const aliases = collectScheduleAliasIds(feedId, merged);
  if (localScheduleId) aliases.push(localScheduleId);

  clearScheduleClaimRuntimeState(feedId, merged);
  feedRemoveScheduleMirrors(feedId);
  endLiveBridgeForStaleScheduleFeedId(feedId, merged);

  if (localScheduleId) {
    feedRemoveScheduleMirrors(localScheduleId);
    clearScheduleClaimRuntimeState(localScheduleId, merged);
    endLiveBridgeForStaleScheduleFeedId(localScheduleId, merged);
  }

  console.log("KRISTO_RING_STALE_LOCAL_SCHEDULE_REMOVED", {
    reason,
    canonicalFeedIds: [feedId],
    removedLocalIds: localScheduleId ? [localScheduleId] : [],
    backendDeleted: backendResult.deleted,
  });

  return {
    ...backendResult,
    localScheduleId: localScheduleId || null,
  };
}
