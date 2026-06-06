import { DeviceEventEmitter } from "react-native";
import { clearHomeFeedApiCache } from "@/src/lib/homeFeedScheduleDirty";
import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";
import { getSessionSync } from "@/src/lib/kristoSession";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  fetchMediaScheduleFeedSync,
  resetMediaScheduleSilentReloadCache,
} from "@/src/lib/mediaScheduleSilentReload";
import { feedSyncMediaScheduleFromBackend } from "@/src/lib/homeFeedStore";
import { findMediaScheduleFeedForChurch } from "@/src/lib/mediaScheduleLock";
import { markHomeFeedScheduleDirty } from "@/src/lib/homeFeedScheduleDirty";
import {
  clearLocalSchedulePendingBackend,
  listPendingLocalScheduleIds,
} from "@/src/lib/mediaSchedulePendingSync";

export const KRISTO_SLOT_CLAIM_CHANGED = "kristo:slot-claim-changed";

export type SlotClaimChangedPayload = {
  churchId: string;
  postId?: string;
  slotId: string;
  action: "claim" | "unclaim";
  userId: string;
  source?: string;
  updatedAt?: number;
};

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

export function emitSlotClaimChanged(payload: SlotClaimChangedPayload) {
  const event: SlotClaimChangedPayload = {
    ...payload,
    updatedAt: payload.updatedAt ?? Date.now(),
  };

  console.log("KRISTO_SLOT_CLAIM_BROADCAST", {
    churchId: event.churchId,
    postId: event.postId || null,
    slotId: event.slotId,
    action: event.action,
    userId: event.userId,
    source: event.source || null,
  });

  DeviceEventEmitter.emit(KRISTO_SLOT_CLAIM_CHANGED, event);
}

export function onSlotClaimChanged(listener: (payload: SlotClaimChangedPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_SLOT_CLAIM_CHANGED, listener);
  return () => sub.remove();
}

export async function runFastSlotClaimSync(
  payload: SlotClaimChangedPayload
): Promise<{ scheduleFeedId: string | null; rowCount: number } | null> {
  const cid = String(payload.churchId || "").trim();
  if (!cid) return null;

  const session = getSessionSync() as any;
  const userId = String(session?.userId || "").trim();

  clearSlotClaimCaches(cid, userId);

  try {
    const headers = getKristoHeaders({
      userId,
      role: (session?.role || "Member") as any,
      churchId: cid,
    }) as Record<string, string>;

    const sync = await fetchMediaScheduleFeedSync(cid, headers);
    const scheduleFeed = findMediaScheduleFeedForChurch(sync.rows, cid, {
      strictChurch: true,
    });

    if (scheduleFeed) {
      feedSyncMediaScheduleFromBackend(scheduleFeed);
      const feedId = String(scheduleFeed?.id || "").trim();
      if (feedId) {
        markHomeFeedScheduleDirty(cid, feedId);
      }
    }

    console.log("KRISTO_SLOT_CLAIM_FAST_SYNC", {
      churchId: cid,
      postId: payload.postId || null,
      slotId: payload.slotId,
      action: payload.action,
      source: payload.source || null,
      scheduleFeedId: String(scheduleFeed?.id || ""),
      rowCount: sync.rows.length,
      mediaScheduleVersion: sync.mediaScheduleVersion,
    });

    return {
      scheduleFeedId: String(scheduleFeed?.id || "") || null,
      rowCount: sync.rows.length,
    };
  } catch (error) {
    console.log("KRISTO_SLOT_CLAIM_FAST_SYNC_ERROR", {
      churchId: cid,
      slotId: payload.slotId,
      error: String((error as any)?.message || error),
    });
    return null;
  }
}

export function notifySlotClaimChanged(
  payload: SlotClaimChangedPayload,
  opts?: { fastSync?: boolean }
) {
  emitSlotClaimChanged(payload);
  if (opts?.fastSync) {
    void runFastSlotClaimSync(payload);
  }
}

export async function refreshSlotAfterClaimConflict(options: {
  churchId: string;
  postId?: string;
  slotId: string;
}) {
  const cid = String(options.churchId || "").trim();
  const slotId = String(options.slotId || "").trim();

  console.log("KRISTO_SLOT_ALREADY_CLAIMED_REFRESH", {
    churchId: cid,
    postId: options.postId || null,
    slotId,
  });

  return runFastSlotClaimSync({
    churchId: cid,
    postId: options.postId,
    slotId,
    action: "claim",
    userId: "",
    source: "claim-conflict-refresh",
  });
}
