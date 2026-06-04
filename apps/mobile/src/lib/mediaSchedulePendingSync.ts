import { feedList, feedRemoveWhere, feedSyncMediaScheduleFromBackend } from "@/src/lib/homeFeedStore";
import { emitLiveRingRefresh } from "@/src/lib/liveScheduleRing";

type PendingLocalSchedule = {
  localScheduleId: string;
  churchId: string;
  createdAt: number;
};

const pendingLocalSchedules = new Map<string, PendingLocalSchedule>();

export function markLocalSchedulePendingBackend(localScheduleId: string, churchId: string) {
  const localId = String(localScheduleId || "").trim();
  const cid = String(churchId || "").trim();
  if (!localId || !cid) return;

  pendingLocalSchedules.set(localId, {
    localScheduleId: localId,
    churchId: cid,
    createdAt: Date.now(),
  });

  console.log("KRISTO_SCHEDULE_LOCAL_KEEP_PENDING_BACKEND", {
    localScheduleId: localId,
    churchId: cid,
    pendingCount: pendingLocalSchedules.size,
  });
}

export function clearLocalSchedulePendingBackend(localScheduleId: string) {
  const localId = String(localScheduleId || "").trim();
  if (!localId) return;
  pendingLocalSchedules.delete(localId);
}

export function isLocalSchedulePendingBackend(localScheduleId: string) {
  const localId = String(localScheduleId || "").trim();
  if (!localId) return false;
  return pendingLocalSchedules.has(localId);
}

export function hasPendingLocalScheduleForChurch(churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return false;

  for (const pending of pendingLocalSchedules.values()) {
    if (pending.churchId === cid) return true;
  }

  return feedList().some((row: any) => isPendingLocalMediaScheduleRow(row, cid));
}

export function listPendingLocalScheduleIds(churchId: string) {
  const cid = String(churchId || "").trim();
  const ids = new Set<string>();

  for (const pending of pendingLocalSchedules.values()) {
    if (!cid || pending.churchId === cid) {
      ids.add(pending.localScheduleId);
    }
  }

  if (cid) {
    for (const row of feedList() as any[]) {
      if (!isPendingLocalMediaScheduleRow(row, cid)) continue;
      ids.add(String(row?.id || "").trim());
    }
  }

  return Array.from(ids).filter(Boolean);
}

export function isPendingLocalMediaScheduleRow(item: any, churchId?: string) {
  if (!item) return false;
  if (item?.pendingBackendFailed === true) return false;

  const id = String(item?.id || "").trim();
  const itemCid = String(item?.churchId || "").trim();
  const cid = String(churchId || "").trim();
  if (cid && itemCid && itemCid !== cid) return false;

  if (item?.pendingBackendSync === true) return true;
  if (id.startsWith("media-schedule-") && isLocalSchedulePendingBackend(id)) return true;

  const source = String(item?.source || "").toLowerCase();
  const scheduleType = String(item?.scheduleType || "").toLowerCase();
  const isMediaSchedule =
    source.includes("media-schedule") || scheduleType.includes("media-live-slots");
  if (!isMediaSchedule) return false;

  return id.startsWith("media-schedule-") && isLocalSchedulePendingBackend(id);
}

export function normalizeMediaScheduleBackendItem(
  backendItem: any,
  fallback?: { churchId?: string; scheduleSlots?: any[] }
) {
  const churchId = String(backendItem?.churchId || fallback?.churchId || "").trim();
  const scheduleSlots = Array.isArray(backendItem?.scheduleSlots)
    ? backendItem.scheduleSlots
    : Array.isArray(fallback?.scheduleSlots)
      ? fallback.scheduleSlots
      : [];

  return {
    ...backendItem,
    churchId,
    source: "media-schedule",
    scheduleType: "media-live-slots",
    scheduleSlots,
    pendingBackendSync: false,
  };
}

export function replaceLocalScheduleWithBackend(
  backendItem: any,
  localScheduleId: string,
  fallback?: { churchId?: string; scheduleSlots?: any[] }
) {
  const localId = String(localScheduleId || "").trim();
  const normalized = normalizeMediaScheduleBackendItem(backendItem, fallback);
  const backendFeedId = String(normalized?.id || "").trim();

  if (!backendFeedId) {
    console.log("KRISTO_SCHEDULE_LOCAL_REPLACED_WITH_BACKEND", {
      ok: false,
      localScheduleId: localId,
      backendFeedId: null,
      error: "missing_backend_feed_id",
    });
    return "";
  }

  feedSyncMediaScheduleFromBackend(normalized, localId);
  clearLocalSchedulePendingBackend(localId);

  console.log("KRISTO_SCHEDULE_LOCAL_REPLACED_WITH_BACKEND", {
    ok: true,
    localScheduleId: localId,
    backendFeedId,
    source: normalized.source,
    scheduleType: normalized.scheduleType,
    slotCount: normalized.scheduleSlots.length,
  });

  return backendFeedId;
}

function isSubscriptionRequiredBackendError(status: number, error: string) {
  const normalized = String(error || "").trim().toLowerCase();
  return (
    status === 403 ||
    status === 402 ||
    normalized === "subscription required" ||
    normalized.includes("subscription required")
  );
}

export function scheduleBackendFailAlertMessage(status: number, error: string) {
  if (isSubscriptionRequiredBackendError(status, error)) {
    return "Subscription required";
  }
  return String(error || "Backend schedule create failed.").trim();
}

/** Drop optimistic local schedule after backend create fails — not live-ready. */
export function removeLocalScheduleAfterBackendFail(options: {
  localScheduleId: string;
  churchId: string;
  status?: number | null;
  error?: string;
  screen?: string;
  gate?: string;
}) {
  const localId = String(options.localScheduleId || "").trim();
  const cid = String(options.churchId || "").trim();
  const status = Number(options.status || 0) || null;
  const error = String(options.error || "").trim();

  console.log("KRISTO_SCHEDULE_PENDING_BACKEND_FAILED", {
    screen: options.screen || "schedule-create",
    gate: options.gate || "apiPost",
    localScheduleId: localId,
    churchId: cid,
    status,
    error: error || null,
    subscriptionRequired: isSubscriptionRequiredBackendError(status || 0, error),
  });

  clearLocalSchedulePendingBackend(localId);

  let removedCount = 0;
  feedRemoveWhere((it: any) => {
    const rowId = String(it?.id || "").trim();
    const sourceScheduleId = String(it?.sourceScheduleId || "").trim();
    const shouldRemove =
      !!localId && (rowId === localId || sourceScheduleId === localId);

    if (shouldRemove) {
      removedCount += 1;
      return true;
    }
    return false;
  });

  console.log("KRISTO_SCHEDULE_LOCAL_REMOVED_AFTER_BACKEND_FAIL", {
    screen: options.screen || "schedule-create",
    localScheduleId: localId,
    churchId: cid,
    status,
    removedCount,
  });

  emitLiveRingRefresh("schedule-backend-fail");
}
