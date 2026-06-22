import { markClaimHydrationPending, resolveClaimHydration } from "@/src/lib/claimHydrationState";
import {
  CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
  isChurchLiveControlScheduleFeedRow,
  loadChurchLiveControlGuestCenterScheduleRow,
} from "@/src/lib/churchLiveControlSchedule";
import { broadcastChurchLiveControlRoomSync } from "@/src/lib/churchLiveControlRoomSync";
import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import { feedSyncMediaScheduleFromBackend } from "@/src/lib/homeFeedStore";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { fetchMediaScheduleFeedSync } from "@/src/lib/mediaScheduleSilentReload";
import { baseFeedId, isBackendFeedScheduleId, scheduleSlotClaimUserId } from "@/src/lib/scheduleSlotUtils";

export type ScheduleClaimPersistPath = "church-feed" | "room-messages";

export function logClaimOverwriteBlocked(input: {
  slotId?: string;
  existingClaimedByUserId: string;
  incomingUserId: string;
  source: string;
}) {
  console.log("KRISTO_CLAIM_OVERWRITE_BLOCKED", {
    slotId: String(input.slotId || "").trim() || null,
    existingClaimedByUserId: String(input.existingClaimedByUserId || "").trim(),
    incomingUserId: String(input.incomingUserId || "").trim(),
    source: String(input.source || "").trim(),
  });
}

export function resolveScheduleSlotExistingOwner(slot: any): string {
  return scheduleSlotClaimUserId(slot);
}

export function assertScheduleSlotClaimable(
  slot: any,
  currentUserId: string,
  options?: { slotId?: string; source?: string }
): { ok: true } | { ok: false; reason: "already-claimed"; existingOwner: string } {
  const existingOwner = resolveScheduleSlotExistingOwner(slot);
  const uid = String(currentUserId || "").trim();
  if (existingOwner && existingOwner !== uid) {
    logClaimOverwriteBlocked({
      slotId: options?.slotId,
      existingClaimedByUserId: existingOwner,
      incomingUserId: uid,
      source: options?.source || "assertScheduleSlotClaimable",
    });
    return { ok: false, reason: "already-claimed", existingOwner };
  }
  return { ok: true };
}

function normalizeScheduleFeedKey(input: unknown): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const withoutSlotSuffix = raw.split(":slot:")[0];
  return baseFeedId(withoutSlotSuffix) || withoutSlotSuffix;
}

function scheduleSlotIdsMatch(slot: any, slotId: string): boolean {
  const target = String(slotId || "").trim();
  if (!target) return false;
  const candidates = [
    slot?.id,
    slot?.slotId,
    slot?.cardId,
  ].map((value) => String(value || "").trim());
  return candidates.includes(target);
}

/** Church Live Control schedules live in room-messages, not church feed DB. */
export function resolveScheduleClaimPersistPath(input: {
  item?: any;
  feedId?: string;
  slot?: any;
}): ScheduleClaimPersistPath {
  const feedKey = normalizeScheduleFeedKey(
    input.feedId || input.item?.sourceScheduleId || input.item?.id || ""
  );

  if (isChurchLiveControlScheduleFeedRow(input.item)) return "room-messages";
  if (String(input.item?.source || "").toLowerCase() === "church-live-control") {
    return "room-messages";
  }
  if (
    String(input.item?.roomId || input.item?.assignmentId || "").trim() ===
    CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID
  ) {
    return "room-messages";
  }
  if (feedKey.startsWith("rm_")) return "room-messages";
  if (String(input.slot?.roomMessageId || input.item?.roomMessageId || "").trim()) {
    if (!isBackendFeedScheduleId(feedKey)) return "room-messages";
  }
  if (!isBackendFeedScheduleId(feedKey)) {
    const scheduleType = String(input.item?.scheduleType || "").toLowerCase();
    const roomKind = String(input.item?.roomKind || "").toLowerCase();
    if (
      scheduleType.includes("media-live-slots") &&
      (roomKind.includes("church-live-control") || String(input.item?.roomId || "").trim())
    ) {
      return "room-messages";
    }
  }
  return "church-feed";
}

export type ScheduleSlotClaimBodyInput = {
  postId: string;
  scheduleFeedId?: string;
  slotId: string;
  claim: Record<string, any>;
  scheduleItem?: any;
  viewerChurchId: string;
};

export function resolveScheduleChurchId(scheduleItem?: any, fallbackChurchId?: string) {
  return String(
    scheduleItem?.churchId ||
      scheduleItem?.sourceChurchId ||
      scheduleItem?.ownerChurchId ||
      fallbackChurchId ||
      ""
  ).trim();
}

export function buildScheduleSlotClaimBody(input: ScheduleSlotClaimBodyInput) {
  const claimantUserId = String(input.claim?.userId || "").trim();
  const slotId = String(input.slotId || "").trim();
  const claimTargetSlot =
    input.claim?.slot ||
    (Array.isArray(input.scheduleItem?.scheduleSlots)
      ? input.scheduleItem.scheduleSlots.find((candidate: any) =>
          scheduleSlotIdsMatch(candidate, slotId)
        )
      : null);
  const claimable = assertScheduleSlotClaimable(claimTargetSlot, claimantUserId);
  if (!claimable.ok) {
    logClaimOverwriteBlocked({
      slotId,
      existingClaimedByUserId: claimable.existingOwner,
      incomingUserId: claimantUserId,
      source: "buildScheduleSlotClaimBody",
    });
  }

  const viewerChurchId = String(input.viewerChurchId || "").trim();
  const scheduleChurchId = resolveScheduleChurchId(input.scheduleItem, viewerChurchId);
  const scheduleFeedId = String(
    input.scheduleFeedId || input.postId || input.scheduleItem?.id || ""
  ).trim();
  const claimantHomeChurchId = String(
    input.claim?.claimantHomeChurchId || viewerChurchId
  ).trim();

  const body = {
    action: "claim_schedule_slot" as const,
    postId: String(input.postId || scheduleFeedId).trim(),
    scheduleFeedId,
    slotId: String(input.slotId || "").trim(),
    targetChurchId: scheduleChurchId,
    scheduleChurchId,
    claim: {
      ...input.claim,
      claimantHomeChurchId,
    },
  };

  console.log("KRISTO_CROSS_CHURCH_CLAIM_REQUEST", {
    viewerChurchId,
    targetChurchId: scheduleChurchId,
    scheduleChurchId,
    feedId: scheduleFeedId,
    slotId: body.slotId,
    claimantUserId: String(input.claim?.userId || "").trim() || null,
    claimantHomeChurchId,
    crossChurch: Boolean(scheduleChurchId && viewerChurchId && scheduleChurchId !== viewerChurchId),
  });

  markClaimHydrationPending({
    targetChurchId: scheduleChurchId,
    scheduleFeedId,
    slotId: body.slotId,
    userId: String(input.claim?.userId || "").trim(),
  });

  return body;
}

export async function persistScheduleSlotClaim(input: {
  postId: string;
  slotId: string;
  claim: Record<string, any>;
  scheduleItem?: any;
  slot?: any;
  viewerChurchId: string;
  headers: Record<string, string>;
}) {
  const slotId = String(input.slotId || "").trim();
  const feedId = normalizeScheduleFeedKey(
    input.postId || input.scheduleItem?.sourceScheduleId || input.scheduleItem?.id || ""
  );
  const slot = input.slot || input.claim?.slot;
  const persistPath = resolveScheduleClaimPersistPath({
    item: input.scheduleItem,
    feedId,
    slot,
  });
  const roomMessageId = String(slot?.roomMessageId || input.scheduleItem?.roomMessageId || "").trim();
  const cardId = String(slot?.cardId || slot?.id || slotId).trim();
  const roomId = String(
    input.scheduleItem?.roomId ||
      input.scheduleItem?.assignmentId ||
      CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID
  ).trim();
  const userId = String(input.claim?.userId || "").trim();

  console.log("KRISTO_CLAIM_PERSIST_REQUEST", {
    slotId,
    feedId,
    persistPath,
    roomMessageId: roomMessageId || null,
    cardId,
    roomId,
    userId,
    churchId: String(input.viewerChurchId || "").trim(),
    isBackendFeedId: isBackendFeedScheduleId(feedId),
    scheduleSource: String(input.scheduleItem?.source || ""),
  });

  if (persistPath === "room-messages") {
    const res: any = await apiPatch(
      "/api/church/room-messages",
      {
        roomId,
        messageId: roomMessageId || undefined,
        cardId,
        patch: {
          status: "taken",
          claimedByUserId: userId,
          claimedByName: String(input.claim?.name || "You"),
          claimedByAvatar: String(
            input.claim?.avatarUri || input.claim?.avatarUrl || input.claim?.claimedByAvatar || ""
          ),
          claimedByRole: String(input.claim?.role || "Member"),
          claimedAt: Date.now(),
        },
      },
      { headers: input.headers as any }
    );

    const ok = res?.ok !== false && !res?.error;
    const responseClaimedByUserId = String(
      res?.data?.card?.claimedByUserId || (ok ? userId : "")
    ).trim();

    console.log("KRISTO_CLAIM_PERSIST_RESPONSE", {
      slotId,
      feedId,
      persistPath,
      ok,
      status: Number(res?.status || 0) || null,
      error: res?.error || null,
      claimedByUserId: responseClaimedByUserId || null,
      roomMessageId: roomMessageId || null,
      cardId,
    });

    if (ok) {
      broadcastChurchLiveControlRoomSync({
        action: "claim",
        churchId: input.viewerChurchId,
        userId,
        roomId,
        scheduleId: feedId,
        messageId: roomMessageId || undefined,
        cardId,
        reason: "schedule-slot-claim",
      });
    }

    return res;
  }

  const body = buildScheduleSlotClaimBody({
    postId: input.postId,
    scheduleFeedId: input.postId,
    slotId,
    claim: input.claim,
    scheduleItem: input.scheduleItem,
    viewerChurchId: input.viewerChurchId,
  });

  const res: any = await apiPost("/api/church/feed", body, {
    headers: input.headers as any,
  });
  const ok = res?.ok !== false && !res?.error && Number(res?.status || 0) !== 404;
  const responseClaimedByUserId = String(
    res?.slot?.claimedByUserId || res?.data?.slot?.claimedByUserId || (ok ? userId : "")
  ).trim();

  console.log("KRISTO_CLAIM_PERSIST_RESPONSE", {
    slotId,
    feedId,
    persistPath,
    ok,
    status: Number(res?.status || 0) || null,
    error: res?.error || null,
    claimedByUserId: responseClaimedByUserId || null,
  });

  return res;
}

async function hydrateScheduleSlotFromRoomMessages(input: {
  feedId: string;
  slotId: string;
  scheduleChurchId: string;
  headers: Record<string, string>;
}) {
  const row = await loadChurchLiveControlGuestCenterScheduleRow(input.headers, {
    churchId: input.scheduleChurchId,
  });
  if (!row) {
    console.log("KRISTO_CLAIM_BACKEND_ROW_MISSING", {
      slotId: input.slotId,
      feedId: input.feedId,
      source: "room-messages",
      reason: "schedule-row-null",
    });
    return { scheduleItem: null, matchedSlot: null, backendClaimedByUserId: "" };
  }

  const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
  const matchedSlot =
    slots.find((slot: any) => scheduleSlotIdsMatch(slot, input.slotId)) || null;
  const backendClaimedByUserId = scheduleSlotClaimUserId(matchedSlot);

  if (matchedSlot && backendClaimedByUserId) {
    console.log("KRISTO_CLAIM_BACKEND_ROW_FOUND", {
      slotId: input.slotId,
      feedId: input.feedId,
      source: "room-messages",
      claimedByUserId: backendClaimedByUserId,
      roomMessageId: String(matchedSlot?.roomMessageId || "").trim() || null,
      scheduleSlotCount: slots.length,
    });
  } else {
    console.log("KRISTO_CLAIM_BACKEND_ROW_MISSING", {
      slotId: input.slotId,
      feedId: input.feedId,
      source: "room-messages",
      reason: matchedSlot ? "slot-unclaimed" : "slot-not-found",
      scheduleSlotCount: slots.length,
      slotIds: slots.map((slot: any) => String(slot?.id || slot?.cardId || "")),
    });
  }

  return { scheduleItem: row, matchedSlot, backendClaimedByUserId };
}

async function hydrateScheduleSlotFromFeed(input: {
  postId: string;
  slotId: string;
  scheduleChurchId: string;
  viewerChurchId: string;
  headers: Record<string, string>;
}) {
  let scheduleItem: any = null;
  let feedError: string | null = null;

  try {
    const detailRes: any = await apiGet(
      `/api/church/feed?id=${encodeURIComponent(input.postId)}`,
      { headers: input.headers, cache: "no-store" as RequestCache },
      { screen: "ClaimHydrateFeed", dedupe: false, throttleMs: 0 }
    );
    if (detailRes?.ok === false || detailRes?.error) {
      feedError = String(detailRes?.error || "feed-detail-failed");
      scheduleItem = null;
    } else {
      scheduleItem = detailRes?.data?.item || detailRes?.item || null;
    }
  } catch (e: any) {
    feedError = String(e?.message || e || "feed-detail-exception");
    scheduleItem = null;
  }

  if (!scheduleItem?.scheduleSlots?.length) {
    try {
      const sync = await fetchMediaScheduleFeedSync(input.viewerChurchId, input.headers, {
        targetChurchId: input.scheduleChurchId,
      });
      scheduleItem =
        (sync.rows || []).find((row: any) => String(row?.id || "").trim() === input.postId) ||
        (sync.rows || []).find(
          (row: any) => String(row?.sourceScheduleId || "").trim() === input.postId
        ) ||
        null;
    } catch {
      scheduleItem = null;
    }
  }

  const slots = Array.isArray(scheduleItem?.scheduleSlots) ? scheduleItem.scheduleSlots : [];
  const matchedSlot =
    slots.find((slot: any) => scheduleSlotIdsMatch(slot, input.slotId)) || null;
  const backendClaimedByUserId = scheduleSlotClaimUserId(matchedSlot);

  if (matchedSlot && backendClaimedByUserId) {
    console.log("KRISTO_CLAIM_BACKEND_ROW_FOUND", {
      slotId: input.slotId,
      feedId: input.postId,
      source: "church-feed",
      claimedByUserId: backendClaimedByUserId,
      scheduleSlotCount: slots.length,
    });
  } else {
    console.log("KRISTO_CLAIM_BACKEND_ROW_MISSING", {
      slotId: input.slotId,
      feedId: input.postId,
      source: "church-feed",
      reason: feedError || (matchedSlot ? "slot-unclaimed" : "feed-row-not-found"),
      scheduleSlotCount: slots.length,
    });
  }

  return { scheduleItem, matchedSlot, backendClaimedByUserId };
}

export async function refetchTargetScheduleAfterClaim(input: {
  postId: string;
  scheduleChurchId: string;
  slotId: string;
  viewerChurchId: string;
  viewerUserId: string;
  viewerRole?: string;
  scheduleItem?: any;
  slot?: any;
  localSeedId?: string;
}) {
  const postId = normalizeScheduleFeedKey(input.postId);
  const scheduleChurchId = String(input.scheduleChurchId || "").trim();
  const slotId = String(input.slotId || "").trim();
  const viewerChurchId = String(input.viewerChurchId || "").trim();
  const viewerUserId = String(input.viewerUserId || "").trim();

  if (!postId || !scheduleChurchId || !slotId || !viewerChurchId || !viewerUserId) {
    console.log("KRISTO_CLAIM_HYDRATE_RESULT", {
      feedId: postId || null,
      slotId,
      ok: false,
      reason: "missing-refetch-input",
      backendClaimedByUserId: "",
    });
    return null;
  }

  const headers = getKristoHeaders({
    userId: viewerUserId,
    role: (input.viewerRole || "Member") as any,
    churchId: viewerChurchId,
  }) as Record<string, string>;

  const persistPath = resolveScheduleClaimPersistPath({
    item: input.scheduleItem,
    feedId: postId,
    slot: input.slot,
  });

  let hydrated =
    persistPath === "room-messages"
      ? await hydrateScheduleSlotFromRoomMessages({
          feedId: postId,
          slotId,
          scheduleChurchId,
          headers,
        })
      : await hydrateScheduleSlotFromFeed({
          postId,
          slotId,
          scheduleChurchId,
          viewerChurchId,
          headers,
        });

  if (!hydrated.backendClaimedByUserId && persistPath === "church-feed") {
    const roomHydrated = await hydrateScheduleSlotFromRoomMessages({
      feedId: postId,
      slotId,
      scheduleChurchId,
      headers,
    });
    if (roomHydrated.backendClaimedByUserId) {
      hydrated = roomHydrated;
    }
  }

  const { scheduleItem, matchedSlot, backendClaimedByUserId } = hydrated;

  console.log("KRISTO_CLAIM_HYDRATE_RESULT", {
    feedId: postId,
    slotId,
    persistPath,
    ok: Boolean(scheduleItem && backendClaimedByUserId),
    backendClaimedByUserId: backendClaimedByUserId || "",
    claimedByName: String(matchedSlot?.claimedByName || matchedSlot?.claimedBy?.name || "").trim(),
    hydrateSource: persistPath === "room-messages" || !isBackendFeedScheduleId(postId)
      ? "room-messages"
      : "church-feed",
  });

  console.log("KRISTO_CROSS_CHURCH_CLAIM_PERSIST_RESULT", {
    viewerChurchId,
    targetChurchId: scheduleChurchId,
    scheduleChurchId,
    feedId: postId,
    slotId,
    backendClaimedByUserId,
    ok: Boolean(scheduleItem && backendClaimedByUserId),
    crossChurch: scheduleChurchId !== viewerChurchId,
  });

  if (backendClaimedByUserId) {
    console.log("KRISTO_SLOT_CLAIM_BACKEND_PERSISTED", {
      viewerChurchId,
      scheduleChurchId,
      feedId: postId,
      slotId,
      claimedByUserId: backendClaimedByUserId,
      claimedByName: String(matchedSlot?.claimedByName || matchedSlot?.claimedBy?.name || "").trim(),
      claimedAt: String(matchedSlot?.claimedAt || matchedSlot?.claimedBy?.claimedAt || "").trim(),
      crossChurch: scheduleChurchId !== viewerChurchId,
    });
  }

  if (scheduleItem && backendClaimedByUserId) {
    feedSyncMediaScheduleFromBackend(scheduleItem, input.localSeedId);
    resolveClaimHydration({
      targetChurchId: scheduleChurchId,
      scheduleFeedId: postId,
      slotId,
      userId: viewerUserId,
    });
  }

  return scheduleItem;
}
