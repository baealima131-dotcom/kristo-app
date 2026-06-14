import { apiPatch } from "@/src/lib/kristoApi";
import { feedList, feedPurgeMediaScheduleCardsForChurch } from "@/src/lib/homeFeedStore";
import {
  getActiveScheduleSlots,
  hasActiveMediaScheduleForChurch,
} from "@/src/lib/mediaScheduleLock";
import { publishLiveEnded } from "@/src/lib/liveBridge";
import { emitLiveRingRefresh } from "@/src/lib/liveScheduleRing";
import { fetchLightLiveState } from "@/src/lib/liveRealtime";
import {
  forceKristoLiveCleanup,
  resumeHomeFeedAfterLiveExit,
} from "@/src/lib/liveRoomStartup";
import { baseFeedId, collectScheduleAliasIds, resolveCanonicalScheduleFeedId } from "@/src/lib/scheduleSlotUtils";

function scheduleLiveIds(scheduleId: string, rows: any[]) {
  const merged = [...rows, ...(feedList() as any[])];
  const canonicalId = resolveCanonicalScheduleFeedId(scheduleId, merged) || scheduleId;
  const aliases = collectScheduleAliasIds(canonicalId, merged);
  const ids = new Set<string>();
  for (const id of aliases) {
    const base = baseFeedId(id);
    if (base) ids.add(base);
  }
  ids.add(baseFeedId(canonicalId));
  return Array.from(ids).filter(Boolean);
}

function readLiveActiveFromLite(patch: { isLive?: boolean; raw?: any }) {
  return patch?.isLive === true && patch?.raw && !patch.raw?.endedAt;
}

export async function clearActiveLiveAfterGuestSlotDelete(input: {
  churchId: string;
  scheduleId: string;
  headers: Record<string, string>;
  backendSlotCount: number;
  reloadRows?: any[];
  reason?: string;
}) {
  const churchId = String(input.churchId || "").trim();
  const scheduleId = String(input.scheduleId || "").trim();
  const reloadRows = Array.isArray(input.reloadRows) ? input.reloadRows : [];
  const backendSlotCount = Number(input.backendSlotCount || 0);

  let liveActiveBefore = false;
  try {
    const liteBefore = await fetchLightLiveState(input.headers, "GuestClearActiveLive:before", "", {
      force: true,
    });
    liveActiveBefore = readLiveActiveFromLite(liteBefore);
  } catch {
    liveActiveBefore = Boolean((globalThis as any).__KRISTO_LIVE_ACTIVE__);
  }

  console.log("KRISTO_GUEST_CLEAR_ACTIVE_LIVE_START", {
    churchId,
    scheduleId,
    backendSlotCount,
    liveActiveBefore,
    reason: input.reason || "guest-slot-delete",
  });

  const liveIds = scheduleLiveIds(scheduleId, reloadRows);
  for (const liveId of liveIds) {
    publishLiveEnded(liveId);
  }

  forceKristoLiveCleanup("guest-delete-cleared-live", { forceReentry: true });
  resumeHomeFeedAfterLiveExit();

  if (churchId) {
    feedPurgeMediaScheduleCardsForChurch(churchId);
  }

  let serverClearOk = false;
  for (const liveId of liveIds.length ? liveIds : [""]) {
    try {
      const res: any = await apiPatch(
        "/api/church/live",
        {
          action: "clear-schedule-live",
          liveId: liveId || undefined,
          reason: input.reason || "guest-delete-cleared-live",
        },
        { headers: input.headers as any }
      );
      serverClearOk = res?.ok !== false || serverClearOk;
    } catch (e: any) {
      console.log("KRISTO_GUEST_CLEAR_ACTIVE_LIVE_SERVER_ERROR", {
        churchId,
        scheduleId,
        liveId: liveId || null,
        error: String(e?.message || e),
      });
    }
  }

  emitLiveRingRefresh("guest-delete-cleared-live");

  let liveActiveAfter = false;
  try {
    const liteAfter = await fetchLightLiveState(input.headers, "GuestClearActiveLive:after", "", {
      force: true,
    });
    liveActiveAfter = readLiveActiveFromLite(liteAfter);
  } catch {
    liveActiveAfter = Boolean((globalThis as any).__KRISTO_LIVE_ACTIVE__);
  }

  let canCreateScheduleAfterClear = false;
  try {
    canCreateScheduleAfterClear = !(await hasActiveMediaScheduleForChurch(churchId, {
      headers: input.headers,
    }));
  } catch {
    canCreateScheduleAfterClear = backendSlotCount === 0 && !liveActiveAfter;
  }

  const result = {
    churchId,
    scheduleId,
    backendSlotCount,
    liveActiveBefore,
    liveActiveAfter,
    canCreateScheduleAfterClear,
    serverClearOk,
    liveIds,
  };

  console.log("KRISTO_GUEST_CLEAR_ACTIVE_LIVE_RESULT", result);
  console.log("KRISTO_LIVE_ACTIVE_AFTER_SLOT_DELETE", result);

  return result;
}

export function shouldClearActiveLiveAfterGuestDelete(input: {
  backendSlotCount: number;
  reloadRows?: any[];
  churchId: string;
  nowMs?: number;
}) {
  if (Number(input.backendSlotCount || 0) === 0) return true;

  const nowMs = Number(input.nowMs || Date.now());
  const rows = Array.isArray(input.reloadRows) ? input.reloadRows : [];
  const churchId = String(input.churchId || "").trim();
  if (!churchId || !rows.length) return false;

  for (const row of rows) {
    if (String(row?.churchId || "").trim() !== churchId) continue;
    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    if (!slots.length) continue;
    if (getActiveScheduleSlots(row, nowMs).length > 0) return false;
  }

  return true;
}
