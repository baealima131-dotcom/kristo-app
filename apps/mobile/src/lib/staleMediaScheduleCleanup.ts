import { apiPost } from "@/src/lib/kristoApi";
import { feedRemoveScheduleMirrors, clearScheduleClaimRuntimeState } from "@/src/lib/homeFeedStore";
import {
  endLiveBridgeForStaleScheduleFeedId,
} from "@/src/lib/staleBackendZeroSlotGuard";

export async function clearMediaScheduleSlotsOnBackend(input: {
  feedId: string;
  churchId: string;
  headers: Record<string, string>;
  slots?: any[];
  reason?: string;
}) {
  const feedId = String(input.feedId || "").trim();
  const churchId = String(input.churchId || "").trim();
  const reason = String(input.reason || "clear_media_schedule_slots").trim();
  const slots = Array.isArray(input.slots) ? input.slots : [];

  if (!feedId || !churchId) {
    return {
      ok: false,
      feedId,
      churchId,
      deleted: false,
      error: "feedId and churchId required",
    };
  }

  const requestBody = {
    action: "clear_media_schedule_slots" as const,
    feedId,
    postId: feedId,
    churchId,
    reason,
    slots,
  };

  console.log("KRISTO_CLEAR_MEDIA_SCHEDULE_SLOTS_REQUEST", {
    action: requestBody.action,
    feedId,
    churchId,
    slotsLength: slots.length,
    reason,
  });

  try {
    const res: any = await apiPost(
      "/api/church/feed",
      requestBody,
      { headers: input.headers as any }
    );

    const payload =
      res?.data && typeof res.data === "object" && !Array.isArray(res.data) ? res.data : res;
    const ok = res?.ok !== false && !res?.error && payload?.ok !== false;
    if (ok) {
      feedRemoveScheduleMirrors(feedId);
      clearScheduleClaimRuntimeState(feedId);
      endLiveBridgeForStaleScheduleFeedId(feedId);
    }

    return {
      ok,
      feedId,
      churchId,
      deleted: Boolean(payload?.deleted),
      slots: Array.isArray(payload?.slots) ? payload.slots : slots,
      remainingCount: Array.isArray(payload?.slots)
        ? payload.slots.length
        : payload?.remainingCount ?? slots.length,
      endedLiveKeys: Array.isArray(payload?.endedLiveKeys) ? payload.endedLiveKeys : [],
      error: res?.error ? String(res.error) : payload?.error ? String(payload.error) : null,
    };
  } catch (e: any) {
    return {
      ok: false,
      feedId,
      churchId,
      deleted: false,
      error: String(e?.message || e),
    };
  }
}

export async function cleanupStaleMediaScheduleFeedRow(input: {
  feedId: string;
  churchId: string;
  headers: Record<string, string>;
  reason?: string;
}) {
  const feedId = String(input.feedId || "").trim();
  const churchId = String(input.churchId || "").trim();
  const reason = String(input.reason || "guest-stale-schedule-cleanup").trim();

  console.log("KRISTO_STALE_SCHEDULE_CLEANUP_START", {
    feedId,
    churchId,
    reason,
  });

  const cleared = await clearMediaScheduleSlotsOnBackend({
    feedId,
    churchId,
    headers: input.headers,
    slots: [],
    reason,
  });

  const result = {
    ok: cleared.ok,
    feedId,
    churchId,
    deleted: cleared.deleted,
    endedLiveKeys: cleared.endedLiveKeys,
    error: cleared.error,
  };

  console.log("KRISTO_STALE_SCHEDULE_CLEANUP_RESULT", result);
  return result;
}

export function shouldEndStaleMediaScheduleFeedRow(input: {
  remainingSlotCount: number;
  activeSlotCount?: number;
}) {
  // Only end when backend explicitly has zero slots — not when local time windows expired.
  void input.activeSlotCount;
  return Number(input.remainingSlotCount || 0) === 0;
}

export { cleanupStaleMediaSchedulePair } from "@/src/lib/staleBackendZeroSlotGuard";
