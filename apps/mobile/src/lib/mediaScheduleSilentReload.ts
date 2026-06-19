import { apiGet, apiPost } from "@/src/lib/kristoApi";
import {
  feedCloseMediaScheduleCards,
  feedList,
  feedPurgeMediaScheduleCards,
  feedPurgeMediaScheduleCardsForChurch,
  feedRemoveWhere,
  feedSyncMediaScheduleFromBackend,
} from "@/src/lib/homeFeedStore";
import { clearHomeFeedApiCache } from "@/src/lib/homeFeedScheduleDirty";
import { hydrateActiveMediaScheduleFromBackend } from "@/src/lib/mediaScheduleActiveHydration";
import {
  findActiveMediaScheduleForChurch,
  findMediaScheduleFeedForChurch,
  resolveChurchMediaScheduleFromFeedRows,
} from "@/src/lib/mediaScheduleChurchQueries";
import { parseChurchFeedListResponse, type MediaScheduleFeedSync } from "@/src/lib/mediaScheduleFeedParse";
import { findProtectedNearLiveSchedule } from "@/src/lib/liveScheduleRingSlotWindow";
import { emitLiveRingRefresh } from "@/src/lib/liveScheduleRingEvents";
import { resolveCanonicalScheduleFeedId } from "@/src/lib/scheduleSlotUtils";
import { materializeMediaSlotTimeFields } from "@/src/lib/mediaScheduleSlotTimes";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  clearMediaScheduleSpeakerSlots,
  getChurchProjectMcRuntime,
  shouldClearMediaScheduleSpeakerSlots,
} from "@/src/store/churchProjectMcScheduleStore";
import {
  clearLocalSchedulePendingBackend,
  hasPendingLocalScheduleForChurch,
  isPendingLocalMediaScheduleRow,
  listPendingLocalScheduleIds,
  markLocalSchedulePendingBackend,
} from "@/src/lib/mediaSchedulePendingRegistry";

export type LocalMediaScheduleUiReset = {
  setGuestClaimSlots?: (slots: any[]) => void;
  setGuestInvitedBySlot?: (value: Record<string, string>) => void;
  setGuestInviteDraftBySlot?: (value: Record<string, string>) => void;
  setBackendFeedItems?: (items: any[]) => void;
  setHomeFeedItems?: (items: any[]) => void;
  setBackendScheduleCards?: (items: any[]) => void;
  setScheduleConflictInfo?: (info: null) => void;
  setActiveScheduleBatchIndex?: (index: number) => void;
};

function isLocalMediaScheduleFeedRow(it: any): boolean {
  const id = String(it?.id || "").toLowerCase();
  const source = String(it?.source || "").toLowerCase();
  const scheduleType = String(it?.scheduleType || "").toLowerCase();

  return (
    source.includes("media-schedule") ||
    scheduleType === "media-live-slots" ||
    id.startsWith("media-live-") ||
    id.startsWith("media-schedule-")
  );
}

const DEFAULT_MEDIA_SCHEDULE_ASSIGNMENT_IDS = ["media-schedule", "media-guests"];

export function clearStaleMediaScheduleSpeakerSlotsForChurch(options: {
  churchId?: string;
  assignmentIds?: string[];
  reason: string;
  force?: boolean;
  ui?: LocalMediaScheduleUiReset;
}) {
  const assignmentIds = Array.from(
    new Set(
      [
        ...(Array.isArray(options.assignmentIds) ? options.assignmentIds : []),
        ...DEFAULT_MEDIA_SCHEDULE_ASSIGNMENT_IDS,
      ]
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );

  const clearedAssignmentIds: string[] = [];
  for (const assignmentId of assignmentIds) {
    if (!options.force && !shouldClearMediaScheduleSpeakerSlots(assignmentId)) continue;
    clearMediaScheduleSpeakerSlots(assignmentId, options.reason);
    clearedAssignmentIds.push(assignmentId);
  }

  options.ui?.setBackendScheduleCards?.([]);
  options.ui?.setScheduleConflictInfo?.(null);
  options.ui?.setActiveScheduleBatchIndex?.(0);

  if (clearedAssignmentIds.length) {
    console.log("KRISTO_MEDIA_SPEAKER_SLOTS_STALE_CLEARED", {
      churchId: String(options.churchId || "").trim() || null,
      reason: options.reason,
      assignmentIds: clearedAssignmentIds,
    });
  }
}

export function clearMediaScheduleCachesForChurch(churchId: string, reason: string) {
  const cid = String(churchId || "").trim();
  const session = getSessionSync() as any;
  const userId = String(session?.userId || "").trim();
  const pendingIds = cid ? listPendingLocalScheduleIds(cid) : [];

  resetMediaScheduleSilentReloadCache();
  clearHomeFeedApiCache(userId);

  for (const pendingId of pendingIds) {
    clearLocalSchedulePendingBackend(pendingId);
  }

  console.log("KRISTO_MEDIA_SCHEDULE_CACHES_CLEARED", {
    churchId: cid,
    reason,
    pendingCleared: pendingIds.length,
  });
}

export function purgeAllLocalMediaScheduleSources(options: {
  churchId?: string;
  assignmentId?: string;
  reason: string;
  removePending?: boolean;
  ui?: LocalMediaScheduleUiReset;
}) {
  const churchId = String(options.churchId || "").trim();
  const assignmentId = String(options.assignmentId || "media-schedule").trim() || "media-schedule";
  const removePending = options.removePending === true;
  const forceSpeakerSlotClear = removePending;

  if (churchId) {
    clearMediaScheduleCachesForChurch(churchId, options.reason);
  } else {
    resetMediaScheduleSilentReloadCache();
    clearHomeFeedApiCache();
  }

  feedRemoveWhere((it: any) => {
    if (!isLocalMediaScheduleFeedRow(it)) return false;
    if (churchId) {
      const itemCid = String(it?.churchId || "").trim();
      if (itemCid && itemCid !== churchId) return false;
    }
    if (!removePending && isPendingLocalMediaScheduleRow(it, churchId)) return false;
    return true;
  });
  feedCloseMediaScheduleCards();
  feedPurgeMediaScheduleCards();
  if (churchId) {
    feedPurgeMediaScheduleCardsForChurch(churchId);
  }

  try {
    if (forceSpeakerSlotClear) {
      for (const id of [assignmentId, ...DEFAULT_MEDIA_SCHEDULE_ASSIGNMENT_IDS]) {
        clearMediaScheduleSpeakerSlots(id, options.reason);
      }
    } else {
      clearStaleMediaScheduleSpeakerSlotsForChurch({
        churchId,
        assignmentIds: [assignmentId],
        reason: options.reason,
        ui: options.ui,
      });
    }
    const runtime = getChurchProjectMcRuntime?.(assignmentId);
    if (runtime) {
      runtime.items = [];
      runtime.scheduleSlots = [];
      runtime.current = null as any;
      runtime.next = null as any;
    }
  } catch {
    // ignore local runtime cleanup errors
  }

  const ui = options.ui;
  ui?.setGuestClaimSlots?.([]);
  ui?.setGuestInvitedBySlot?.({});
  ui?.setGuestInviteDraftBySlot?.({});
  ui?.setBackendFeedItems?.([]);
  ui?.setHomeFeedItems?.([...feedList()]);
  ui?.setBackendScheduleCards?.([]);
  ui?.setScheduleConflictInfo?.(null);
  ui?.setActiveScheduleBatchIndex?.(0);

  console.log("KRISTO_SCHEDULE_LOCAL_PURGED", {
    churchId,
    assignmentId,
    reason: options.reason,
  });
  console.log("KRISTO_LOCAL_MEDIA_DELETE_PURGE_DONE", {
    churchId,
    assignmentId,
    reason: options.reason,
  });
}

export type { MediaScheduleFeedSync } from "@/src/lib/mediaScheduleFeedParse";
export { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleFeedParse";

export async function fetchMediaScheduleFeedSync(
  churchId: string,
  headers?: Record<string, string>,
  opts?: { targetChurchId?: string }
): Promise<MediaScheduleFeedSync> {
  const viewerChurchId = String(churchId || "").trim();
  const targetChurchId = String(opts?.targetChurchId || viewerChurchId).trim();
  const query =
    targetChurchId && targetChurchId !== viewerChurchId
      ? `/api/church/feed?scope=church&churchId=${encodeURIComponent(targetChurchId)}&_=${Date.now()}`
      : `/api/church/feed?scope=church&_=${Date.now()}`;

  const res: any = await apiGet(query, {
    headers,
    cache: "no-store" as RequestCache,
  });

  return parseChurchFeedListResponse(res);
}

export type SilentMediaScheduleReloadResult = MediaScheduleFeedSync & {
  versionChanged: boolean;
  purgedLocal: boolean;
  backendHasActiveSchedule: boolean;
  shouldForceLocalPurge: boolean;
  protectedLocalSchedule?: boolean;
  reason: string;
};

export function applySilentMediaScheduleReload(params: {
  churchId: string;
  sync: MediaScheduleFeedSync;
  reason: string;
  previousVersion?: number;
  previousUpdatedAt?: string;
  force?: boolean;
  assignmentId?: string;
  ui?: LocalMediaScheduleUiReset;
}): SilentMediaScheduleReloadResult {
  const cid = String(params.churchId || "").trim();
  const { rows, mediaScheduleVersion, mediaScheduleUpdatedAt } = params.sync;
  const previousVersion = Number(params.previousVersion ?? 0);
  const previousUpdatedAt = String(params.previousUpdatedAt ?? "");

  const versionChanged =
    Boolean(params.force) ||
    mediaScheduleVersion !== previousVersion ||
    (!!mediaScheduleUpdatedAt && mediaScheduleUpdatedAt !== previousUpdatedAt);

  const backendScheduleRow = cid
    ? resolveChurchMediaScheduleFromFeedRows(rows, cid, { strictChurch: true })
    : null;
  const backendScheduleFeed = backendScheduleRow;
  const backendActive = cid
    ? findActiveMediaScheduleForChurch(rows, cid, { strictChurch: true })
    : null;
  const backendHasActiveSchedule = Boolean(backendScheduleRow);

  if (cid && !backendHasActiveSchedule) {
    clearStaleMediaScheduleSpeakerSlotsForChurch({
      churchId: cid,
      assignmentIds: params.assignmentId ? [params.assignmentId] : undefined,
      reason: `${params.reason}:backend-empty`,
      ui: params.ui,
    });
  } else if (backendScheduleRow && params.assignmentId) {
    void hydrateActiveMediaScheduleFromBackend({
      activeSchedule: backendScheduleRow,
      churchId: cid,
      assignmentId: params.assignmentId,
      reason: `${params.reason}:silent-reload-hydrate`,
    });
    applyBackendMediaScheduleToLocalFeed(rows, cid);
  }

  if (backendScheduleRow) {
    console.log("[MediaSilentReload] active schedule source found", {
      churchId: cid,
      feedId: String(backendScheduleRow?.id || ""),
      source: backendActive ? "time-active-schedule" : "schedule-feed-row",
      slotCount: Array.isArray(backendScheduleRow?.scheduleSlots)
        ? backendScheduleRow.scheduleSlots.length
        : 0,
    });
  }

  const pendingLocalScheduleIds = cid ? listPendingLocalScheduleIds(cid) : [];
  const hasPendingLocalSchedule = Boolean(
    pendingLocalScheduleIds.length || (cid && hasPendingLocalScheduleForChurch(cid))
  );

  const shouldForceLocalPurge = Boolean(
    versionChanged && cid && !backendHasActiveSchedule && !hasPendingLocalSchedule
  );

  let purgedLocal = false;
  let protectedLocalSchedule = false;

  const localRows = (() => {
    try {
      return feedList() as any[];
    } catch {
      return [];
    }
  })();

  const protectedSchedule = cid
    ? findProtectedNearLiveSchedule(localRows, cid, Date.now())
    : null;

  if (versionChanged && cid && !backendHasActiveSchedule && hasPendingLocalSchedule) {
    console.log("KRISTO_SCHEDULE_LOCAL_KEEP_PENDING_BACKEND", {
      churchId: cid,
      reason: params.reason,
      pendingLocalScheduleIds,
      mediaScheduleVersion,
      backendRowCount: rows.length,
    });
  }

  if (shouldForceLocalPurge && protectedSchedule) {
    protectedLocalSchedule = true;
    console.log("KRISTO_ACTIVE_SCHEDULE_PROTECTED", {
      churchId: cid,
      reason: params.reason,
      feedId: String(protectedSchedule.item?.id || protectedSchedule.item?.sourceScheduleId || ""),
      slotId: String(protectedSchedule.slot?.id || ""),
      slotIndex: protectedSchedule.index,
      mediaScheduleVersion,
      backendHasActiveSchedule,
    });
  }

  if (shouldForceLocalPurge && !protectedLocalSchedule) {
    console.log("KRISTO_SCHEDULE_LOCAL_PURGED", {
      churchId: cid,
      reason: "silent_reload_no_backend_schedule",
      gate: "applySilentMediaScheduleReload",
      mediaScheduleVersion,
      backendRowCount: rows.length,
      backendScheduleRowCount: rows.filter((row) =>
        String(row?.source || "").includes("media-schedule") ||
        String(row?.scheduleType || "").includes("media-live-slots")
      ).length,
    });
    purgeAllLocalMediaScheduleSources({
      churchId: cid,
      reason: params.reason,
      ui: params.ui,
    });
    purgedLocal = true;
    console.log("KRISTO_MEDIA_HOST_CACHE_PURGED_AFTER_VERSION", { churchId: cid });
  }

  if (versionChanged) {
    console.log("KRISTO_SILENT_MEDIA_SCHEDULE_RELOAD", {
      churchId: cid,
      reason: params.reason,
      mediaScheduleVersion,
      mediaScheduleUpdatedAt,
      previousVersion,
      previousUpdatedAt,
      purgedLocal,
      backendHasActiveSchedule,
      hasPendingLocalSchedule,
      pendingLocalScheduleIds,
      backendScheduleFeedId: String(backendScheduleFeed?.id || ""),
      backendActiveId: String(backendActive?.id || ""),
      shouldForceLocalPurge,
      rowCount: rows.length,
      scheduleRowCount: rows.filter((row) =>
        String(row?.source || "").includes("media-schedule") ||
        String(row?.scheduleType || "").includes("media-live-slots")
      ).length,
    });
    console.log("KRISTO_MEDIA_SILENT_RELOAD", {
      churchId: cid,
      reason: params.reason,
      mediaScheduleVersion,
      mediaScheduleUpdatedAt,
      previousVersion,
      previousUpdatedAt,
      purgedLocal,
      backendHasActiveSchedule,
      backendScheduleFeedId: String(backendScheduleFeed?.id || ""),
      backendActiveId: String(backendActive?.id || ""),
      shouldForceLocalPurge,
      rowCount: rows.length,
      scheduleRowCount: rows.filter((row) =>
        String(row?.source || "").includes("media-schedule") ||
        String(row?.scheduleType || "").includes("media-live-slots")
      ).length,
    });
  }

  return {
    rows,
    mediaScheduleVersion,
    mediaScheduleUpdatedAt,
    versionChanged,
    purgedLocal,
    backendHasActiveSchedule,
    shouldForceLocalPurge: shouldForceLocalPurge && !protectedLocalSchedule,
    protectedLocalSchedule,
    reason: params.reason,
  };
}

function normalizeScheduleSlotsForBackend(slots: any[]) {
  return slots.map((slot, index) =>
    materializeMediaSlotTimeFields({
      ...slot,
      order: index + 1,
      slot: index + 1,
      slotNumber: index + 1,
    })
  );
}

export async function syncMediaScheduleSlotsToBackend(
  sourceFeedId: string,
  slots: any[],
  headers?: Record<string, string>
) {
  const seed = String(sourceFeedId || "").trim();
  if (!seed) return null;

  const feedId = resolveCanonicalScheduleFeedId(seed, feedList() as any[]) || seed;
  const normalizedSlots = normalizeScheduleSlotsForBackend(slots);

  return apiPost(
    "/api/church/feed",
    {
      action: "update-schedule-slots",
      feedId,
      postId: feedId,
      slots: normalizedSlots,
    },
    { headers }
  );
}

/** After backend fetch, replace local schedule row slots with authoritative backend data. */
export function applyBackendMediaScheduleToLocalFeed(rows: any[], churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid || !rows.length) return null;

  const backendSchedule =
    resolveChurchMediaScheduleFromFeedRows(rows, cid, { strictChurch: true }) ||
    findMediaScheduleFeedForChurch(rows, cid, { strictChurch: true }) ||
    findActiveMediaScheduleForChurch(rows, cid, { strictChurch: true });

  if (!backendSchedule) return null;

  feedSyncMediaScheduleFromBackend(backendSchedule);
  return backendSchedule;
}

export function readFeedItemScheduleSlots(sourceFeedId: string, fallbackRows: any[] = []) {
  const seed = String(sourceFeedId || "").trim();
  if (!seed) return [];

  const localRows = feedList() as any[];
  const merged = [...localRows, ...fallbackRows];
  const canonicalId = resolveCanonicalScheduleFeedId(seed, merged) || seed;

  const fromLocal = localRows.find(
    (item) =>
      String(item?.id || "") === canonicalId ||
      String(item?.id || "") === seed ||
      String(item?.sourceScheduleId || "") === seed
  );
  if (Array.isArray(fromLocal?.scheduleSlots)) return fromLocal.scheduleSlots;

  const fromRows = fallbackRows.find(
    (item) =>
      String(item?.id || "") === canonicalId ||
      String(item?.id || "") === seed
  );
  if (Array.isArray(fromRows?.scheduleSlots)) return fromRows.scheduleSlots;

  return [];
}

let lastMediaScheduleVersion = 0;
let lastMediaScheduleUpdatedAt = "";

export function resetMediaScheduleSilentReloadCache() {
  lastMediaScheduleVersion = 0;
  lastMediaScheduleUpdatedAt = "";
}

export async function runMediaScheduleSilentReload(
  reason: string,
  force = false,
  auth?: { churchId?: string; userId?: string; role?: string }
): Promise<SilentMediaScheduleReloadResult | null> {
  const churchId = String(auth?.churchId || "").trim();
  if (!churchId) {
    emitLiveRingRefresh(reason);
    return null;
  }

  try {
    const headers = getKristoHeaders({
      userId: String(auth?.userId || ""),
      role: (auth?.role || "Member") as any,
      churchId,
    }) as Record<string, string>;

    const sync = await fetchMediaScheduleFeedSync(churchId, headers);
    const result = applySilentMediaScheduleReload({
      churchId,
      sync,
      reason,
      previousVersion: lastMediaScheduleVersion,
      previousUpdatedAt: lastMediaScheduleUpdatedAt,
      force,
    });

    lastMediaScheduleVersion = result.mediaScheduleVersion;
    lastMediaScheduleUpdatedAt = result.mediaScheduleUpdatedAt;

    emitLiveRingRefresh(reason);
    return result;
  } catch (e) {
    console.log("KRISTO_MEDIA_SILENT_RELOAD_ERROR", { reason, error: String(e) });
    emitLiveRingRefresh(`${reason}-error`);
    return null;
  }
}
