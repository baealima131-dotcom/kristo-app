import { apiGet, apiPost } from "@/src/lib/kristoApi";
import {
  feedCloseMediaScheduleCards,
  feedList,
  feedPurgeMediaScheduleCards,
  feedPurgeMediaScheduleCardsForChurch,
  feedRemoveWhere,
} from "@/src/lib/homeFeedStore";
import { findActiveMediaScheduleForChurch, findMediaScheduleFeedForChurch } from "@/src/lib/mediaScheduleLock";
import { findProtectedNearLiveSchedule } from "@/src/lib/liveScheduleRing";
import { resolveCanonicalScheduleFeedId } from "@/src/lib/scheduleSlotUtils";
import {
  clearChurchProjectScheduleSlots,
  getChurchProjectMcRuntime,
} from "@/src/store/churchProjectMcScheduleStore";

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

export function purgeAllLocalMediaScheduleSources(options: {
  churchId?: string;
  assignmentId?: string;
  reason: string;
  ui?: LocalMediaScheduleUiReset;
}) {
  const churchId = String(options.churchId || "").trim();
  const assignmentId = String(options.assignmentId || "media-schedule").trim() || "media-schedule";

  feedRemoveWhere((it: any) => isLocalMediaScheduleFeedRow(it));
  feedCloseMediaScheduleCards();
  feedPurgeMediaScheduleCards();
  if (churchId) {
    feedPurgeMediaScheduleCardsForChurch(churchId);
  }

  try {
    clearChurchProjectScheduleSlots(assignmentId);
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

  console.log("KRISTO_LOCAL_MEDIA_DELETE_PURGE_DONE", {
    churchId,
    assignmentId,
    reason: options.reason,
  });
}

export type MediaScheduleFeedSync = {
  rows: any[];
  mediaScheduleVersion: number;
  mediaScheduleUpdatedAt: string;
};

export function parseChurchFeedListResponse(res: any): MediaScheduleFeedSync {
  const mediaScheduleVersion = Number(res?.mediaScheduleVersion ?? 0);
  const mediaScheduleUpdatedAt = String(res?.mediaScheduleUpdatedAt ?? "");

  const rows = Array.isArray(res?.data?.items)
    ? res.data.items
    : Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
          ? res
          : [];

  return { rows, mediaScheduleVersion, mediaScheduleUpdatedAt };
}

export async function fetchMediaScheduleFeedSync(
  churchId: string,
  headers?: Record<string, string>
): Promise<MediaScheduleFeedSync> {
  const res: any = await apiGet(`/api/church/feed?_=${Date.now()}`, {
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

  const backendScheduleFeed = cid
    ? findMediaScheduleFeedForChurch(rows, cid, { strictChurch: true })
    : null;
  const backendActive = cid
    ? findActiveMediaScheduleForChurch(rows, cid, { strictChurch: true })
    : null;
  const backendHasActiveSchedule = Boolean(backendScheduleFeed || backendActive);

  if (backendScheduleFeed || backendActive) {
    console.log("[MediaSilentReload] active schedule source found", {
      churchId: cid,
      feedId: String((backendScheduleFeed || backendActive)?.id || ""),
      source: backendScheduleFeed ? "schedule-feed-row" : "time-active-schedule",
      slotCount: Array.isArray((backendScheduleFeed || backendActive)?.scheduleSlots)
        ? (backendScheduleFeed || backendActive)?.scheduleSlots.length
        : 0,
    });
  }

  const shouldForceLocalPurge = Boolean(
    versionChanged && cid && !backendScheduleFeed && !backendActive
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
    purgeAllLocalMediaScheduleSources({
      churchId: cid,
      reason: params.reason,
      ui: params.ui,
    });
    purgedLocal = true;
    console.log("KRISTO_MEDIA_HOST_CACHE_PURGED_AFTER_VERSION", { churchId: cid });
  }

  if (versionChanged) {
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

export async function syncMediaScheduleSlotsToBackend(
  sourceFeedId: string,
  slots: any[],
  headers?: Record<string, string>
) {
  const seed = String(sourceFeedId || "").trim();
  if (!seed) return null;

  const feedId = resolveCanonicalScheduleFeedId(seed, feedList() as any[]) || seed;

  return apiPost(
    "/api/church/feed",
    {
      action: "update-schedule-slots",
      feedId,
      postId: feedId,
      slots,
    },
    { headers }
  );
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
