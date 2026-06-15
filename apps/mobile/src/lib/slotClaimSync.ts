import { clearHomeFeedApiCache } from "@/src/lib/homeFeedScheduleDirty";
import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";
import { getSessionSync } from "@/src/lib/kristoSession";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  fetchMediaScheduleFeedSync,
  resetMediaScheduleSilentReloadCache,
  type MediaScheduleFeedSync,
} from "@/src/lib/mediaScheduleSilentReload";
import { findMediaScheduleFeedForChurch } from "@/src/lib/mediaScheduleLock";
import {
  clearLocalSchedulePendingBackend,
  listPendingLocalScheduleIds,
} from "@/src/lib/mediaSchedulePendingSync";

export const SLOT_CLAIM_POLL_LIVE_MS = 4000;
export const SLOT_CLAIM_POLL_FALLBACK_MS = 20_000;

function sessionUserId() {
  const session = getSessionSync() as any;
  return String(session?.userId || "").trim();
}

export function clearSlotClaimCaches(churchId: string, userId?: string) {
  const cid = String(churchId || "").trim();
  const uid = String(userId || sessionUserId()).trim();

  clearHomeFeedApiCache(uid);
  clearResponseCacheForRequest("GET", "/api/church/feed", uid);
  resetMediaScheduleSilentReloadCache();

  if (cid) {
    for (const pendingId of listPendingLocalScheduleIds(cid)) {
      clearLocalSchedulePendingBackend(pendingId);
    }
  }

  console.log("KRISTO_SLOT_CLAIM_CACHE_CLEARED", {
    churchId: cid,
    userId: uid || null,
  });
}

export type ChurchSlotClaimFeedResult = MediaScheduleFeedSync & {
  scheduleFeed: any | null;
};

export async function fetchChurchSlotClaimFeed(
  churchId: string,
  opts?: { clearCaches?: boolean; viewerChurchId?: string }
): Promise<ChurchSlotClaimFeedResult | null> {
  const scheduleChurchId = String(churchId || "").trim();
  if (!scheduleChurchId) return null;

  const session = getSessionSync() as any;
  const userId = String(session?.userId || "").trim();
  const viewerChurchId = String(opts?.viewerChurchId || session?.churchId || "").trim();

  if (opts?.clearCaches !== false) {
    clearSlotClaimCaches(viewerChurchId || scheduleChurchId, userId);
  }

  try {
    const headers = getKristoHeaders({
      userId,
      role: (session?.role || "Member") as any,
      churchId: viewerChurchId || scheduleChurchId,
    }) as Record<string, string>;

    const sync = await fetchMediaScheduleFeedSync(viewerChurchId || scheduleChurchId, headers, {
      targetChurchId: scheduleChurchId,
    });
    const scheduleFeed = findMediaScheduleFeedForChurch(sync.rows, scheduleChurchId, {
      strictChurch: true,
    }) ||
      sync.rows.find((row: any) => {
        const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
        return slots.some((slot: any) =>
          Boolean(String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim())
        );
      }) ||
      null;

    return {
      ...sync,
      scheduleFeed,
    };
  } catch (error) {
    console.log("KRISTO_SLOT_CLAIM_FAST_SYNC_ERROR", {
      churchId: scheduleChurchId,
      viewerChurchId: viewerChurchId || null,
      error: String((error as any)?.message || error),
    });
    return null;
  }
}
