import {
  logHomeFeedNetworkTrace,
  markSlotPollStarted,
  shouldThrottleSlotPoll,
} from "@/src/lib/homeFeedNetwork";
import { feedList, feedSyncMediaScheduleFromBackend } from "@/src/lib/homeFeedStore";
import { markHomeFeedScheduleDirty } from "@/src/lib/homeFeedScheduleDirty";
import {
  emitSlotClaimChanged,
  type SlotClaimChangedPayload,
} from "@/src/lib/slotClaimEvents";
import {
  clearSlotClaimCaches,
  fetchChurchSlotClaimFeed,
} from "@/src/lib/slotClaimSync";
import { refetchTargetScheduleAfterClaim } from "@/src/lib/scheduleSlotClaimRequest";
import { getSessionSync } from "@/src/lib/kristoSession";

function buildChurchScheduleClaimDigest(churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return "";

  const parts: string[] = [];
  for (const row of feedList() as any[]) {
    if (String(row?.churchId || "").trim() !== cid) continue;
    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    for (const slot of slots) {
      const slotId = String(slot?.id || "").trim();
      const owner = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
      const status = String(slot?.status || "").trim();
      if (slotId) parts.push(`${slotId}:${owner}:${status}`);
    }
  }

  return parts.sort().join("|");
}

function applyScheduleFeedToStore(scheduleFeed: any, churchId: string) {
  if (!scheduleFeed) return null;

  const beforeDigest = buildChurchScheduleClaimDigest(churchId);
  feedSyncMediaScheduleFromBackend(scheduleFeed);
  const afterDigest = buildChurchScheduleClaimDigest(churchId);

  const feedId = String(scheduleFeed?.id || "").trim();
  if (feedId && beforeDigest !== afterDigest) {
    markHomeFeedScheduleDirty(churchId, feedId);
  }
  return feedId || null;
}

export async function runFastSlotClaimSync(
  payload: SlotClaimChangedPayload
): Promise<{ scheduleFeedId: string | null; rowCount: number } | null> {
  const scheduleChurchId = String(payload.churchId || "").trim();
  if (!scheduleChurchId) return null;

  const session = getSessionSync() as any;
  const viewerChurchId = String(session?.churchId || "").trim();

  if (payload.postId && payload.action === "claim") {
    await refetchTargetScheduleAfterClaim({
      postId: String(payload.postId),
      scheduleChurchId,
      slotId: payload.slotId,
      viewerChurchId,
      viewerUserId: String(payload.userId || session?.userId || "").trim(),
      viewerRole: String(session?.role || "Member"),
    });
  }

  const result = await fetchChurchSlotClaimFeed(scheduleChurchId, {
    clearCaches: true,
    viewerChurchId,
  });
  if (!result) return null;

  const scheduleFeedId = applyScheduleFeedToStore(result.scheduleFeed, scheduleChurchId);

  console.log("KRISTO_SLOT_CLAIM_FAST_SYNC", {
    churchId: scheduleChurchId,
    viewerChurchId: viewerChurchId || null,
    postId: payload.postId || null,
    slotId: payload.slotId,
    action: payload.action,
    source: payload.source || null,
    scheduleFeedId,
    rowCount: result.rows.length,
    mediaScheduleVersion: result.mediaScheduleVersion,
  });

  return {
    scheduleFeedId,
    rowCount: result.rows.length,
  };
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

/** Church-scope poll fallback for remote claim updates (no global Home Feed reload). */
export async function pollRemoteSlotClaimUpdates(
  churchId: string,
  source: string
): Promise<boolean> {
  const cid = String(churchId || "").trim();
  if (!cid) return false;

  if (shouldThrottleSlotPoll(cid)) {
    logHomeFeedNetworkTrace({
      event: "slot-poll-throttled",
      churchId: cid,
      source,
    });
    return false;
  }

  markSlotPollStarted(cid);

  console.log("KRISTO_SLOT_CLAIM_POLL_TRIGGER", {
    churchId: cid,
    source,
  });

  const beforeDigest = buildChurchScheduleClaimDigest(cid);
  const result = await fetchChurchSlotClaimFeed(cid, { clearCaches: false });
  if (!result?.scheduleFeed) return false;

  const scheduleFeedId = applyScheduleFeedToStore(result.scheduleFeed, cid);
  const afterDigest = buildChurchScheduleClaimDigest(cid);
  if (beforeDigest === afterDigest) return false;

  console.log("KRISTO_SLOT_CLAIM_REMOTE_UPDATE", {
    churchId: cid,
    source,
    scheduleFeedId,
    rowCount: result.rows.length,
    mediaScheduleVersion: result.mediaScheduleVersion,
  });

  return true;
}

export function clearSlotClaimCachesForChurch(churchId: string) {
  clearSlotClaimCaches(churchId);
}
