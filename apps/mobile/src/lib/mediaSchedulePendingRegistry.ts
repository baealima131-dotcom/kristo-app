import { feedList } from "@/src/lib/homeFeedStore";

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
