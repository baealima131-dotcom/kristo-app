import { feedList, feedRemoveWhere, feedSyncMediaScheduleFromBackend } from "@/src/lib/homeFeedStore";
import { markHomeFeedScheduleDirty } from "@/src/lib/homeFeedScheduleDirty";
import { emitLiveRingRefresh } from "@/src/lib/liveScheduleRingEvents";
import {
  clearLocalSchedulePendingBackend,
  hasPendingLocalScheduleForChurch,
  isLocalSchedulePendingBackend,
  isPendingLocalMediaScheduleRow,
  listPendingLocalScheduleIds,
  markLocalSchedulePendingBackend,
} from "@/src/lib/mediaSchedulePendingRegistry";

export {
  clearLocalSchedulePendingBackend,
  hasPendingLocalScheduleForChurch,
  isLocalSchedulePendingBackend,
  isPendingLocalMediaScheduleRow,
  listPendingLocalScheduleIds,
  markLocalSchedulePendingBackend,
} from "@/src/lib/mediaSchedulePendingRegistry";

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

  const normalizedSlots = scheduleSlots.map((slot: any) => ({
    ...slot,
    startMs: Number(slot?.startMs || 0) || undefined,
    endMs: Number(slot?.endMs || 0) || undefined,
    startsAt: String(slot?.startsAt || "").trim() || undefined,
    endsAt: String(slot?.endsAt || "").trim() || undefined,
    meetingDate: String(slot?.meetingDate || "").trim() || undefined,
    meetingEndDate: String(slot?.meetingEndDate || "").trim() || undefined,
    durationMin: Number(slot?.durationMin || slot?.durationMinutes || 0) || undefined,
    durationMinutes: Number(slot?.durationMinutes || slot?.durationMin || 0) || undefined,
  }));

  return {
    ...backendItem,
    churchId,
    source: "media-schedule",
    scheduleType: "media-live-slots",
    scheduleSlots: normalizedSlots,
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
  markHomeFeedScheduleDirty(String(normalized.churchId || fallback?.churchId || ""), backendFeedId);

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
