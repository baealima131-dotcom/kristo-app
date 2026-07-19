import type { Router } from "expo-router";
import { feedList, purgeClaimedSlotLocalState } from "@/src/lib/homeFeedStore";
import { findAuthoritativeScheduleSlot, isScheduleFeedPresentInRows } from "@/src/lib/claimStateMerge";
import { emitLiveRingRefresh } from "@/src/lib/liveScheduleRingEvents";
import { buildLiveRoomAuthorityParams } from "@/src/lib/liveMediaAuthority";
import { markLiveEnterTap } from "@/src/lib/liveKitPerf";
import { pushLiveRoomWithSilentPreflight } from "@/src/lib/liveSilentPreflight";
import {
  pauseHomeFeedBackgroundWorkForLiveNavigation,
} from "@/src/lib/liveRoomStartup";
import {
  buildLeanLiveScheduleSlotsJson,
  baseFeedId,
  isBackendFeedScheduleId,
  normalizeLiveScheduleSlots,
  parseLiveAllScheduleSlotsJson,
  resolveLiveRingCanonicalFeedId,
  sanitizeLeanRouteAvatarUri,
  scheduleSlotClaimUserId,
  utf8JsonByteLength,
} from "@/src/lib/scheduleSlotUtils";
import {
  buildChurchLiveControlGuestCenterScheduleRow,
  buildChurchLiveControlLiveRoomScheduleSlots,
  CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
  isChurchLiveControlScheduleFeedRow,
} from "@/src/lib/churchLiveControlSchedule";
import { peekRoomMessagesCache } from "@/src/lib/churchMediaRoomCache";
import { getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";

export type EnterLiveRoomSource =
  | "live-slots-card"
  | "home-feed-live-section"
  | "home-live-schedule-card"
  | "church-live-control-room-card";

export type ScheduleLiveRoomRouteParams = Record<string, string>;

export function isRoomMessageScheduleId(id: unknown): boolean {
  return String(id || "").trim().startsWith("rm_");
}

export function isScheduleBatchLiveBridgeId(id: unknown): boolean {
  const value = String(id || "").trim();
  return value.startsWith("batch_") || isBackendFeedScheduleId(value);
}

export function isMinistryScheduledLiveBridgeId(id: unknown): boolean {
  return String(id || "").trim().startsWith("ministry_");
}

/** Bridge ids that satisfy the preflight schedule step (batch, feed, or ministry live). */
export function isScheduledLivePreflightBridgeId(id: unknown): boolean {
  const value = String(id || "").trim();
  if (!value || value === "scheduled-live-default") return false;
  return isScheduleBatchLiveBridgeId(value) || isMinistryScheduledLiveBridgeId(value);
}

function pickLiveBridgeScheduleId(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value.startsWith("batch_")) return value;
  }
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (isBackendFeedScheduleId(value)) return baseFeedId(value) || value;
  }
  return "";
}

function isChurchLiveControlScheduleItem(item: any): boolean {
  if (!item || typeof item !== "object") return false;
  if (isChurchLiveControlScheduleFeedRow(item)) return true;
  return (
    String(item?.source || "").includes("church-live-control") ||
    String(item?.roomKind || "").includes("church-live-control") ||
    String(item?.roomId || "") === CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID
  );
}

function collectMergedScheduleRows(extraRows: any[] = []): any[] {
  return [
    ...extraRows,
    ...(feedList() as any[]),
    ...getCachedHomeFeedBackendRows(),
  ];
}

function resolveBatchIdFromRoomMessage(
  roomMessageId: string,
  churchId: string,
  userId: string
): string {
  const messageId = String(roomMessageId || "").trim();
  if (!messageId || !churchId || !userId) return "";

  const cached = peekRoomMessagesCache(churchId, userId, CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID);
  const rows = Array.isArray(cached?.rawRows) ? cached.rawRows : [];
  const message = rows.find((row: any) => String(row?.id || "").trim() === messageId);
  const card = message?.card;
  if (!card || typeof card !== "object") return "";

  return pickLiveBridgeScheduleId(
    (card as any).scheduleBatchId,
    (card as any).sourceScheduleId,
    (card as any).sourceFeedId
  );
}

function resolveChurchLiveControlScheduleRow(input: {
  churchId?: string;
  userId?: string;
  batchId?: string;
}): any | null {
  const churchId = String(input.churchId || "").trim();
  const userId = String(input.userId || "").trim();
  if (!churchId || !userId) return null;

  const cached = peekRoomMessagesCache(churchId, userId, CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID);
  const rows = Array.isArray(cached?.rawRows) ? cached.rawRows : [];
  if (!rows.length) return null;

  const wantedBatch = String(input.batchId || "").trim();
  const built = buildChurchLiveControlGuestCenterScheduleRow(rows, {
    churchId,
    batchId: wantedBatch || undefined,
    scheduleId: wantedBatch || undefined,
    canonicalLiveSessionId: wantedBatch || undefined,
  });
  if (!built) return null;

  const scheduleId = String(built?.sourceScheduleId || built?.id || "").trim();
  if (
    wantedBatch &&
    scheduleId &&
    scheduleId !== wantedBatch &&
    !scheduleId.startsWith(`${wantedBatch}-`) &&
    !wantedBatch.startsWith(`${scheduleId}-`)
  ) {
    console.log("KRISTO_LIVE_SESSION_ID_MISMATCH_BLOCKED", {
      requestedLiveId: wantedBatch,
      canonicalLiveSessionId: wantedBatch,
      hydratedScheduleId: scheduleId,
      source: "resolveChurchLiveControlScheduleRow",
    });
    return null;
  }

  return built;
}

function findFullScheduleRowForBridge(
  bridgeId: string,
  rows: any[]
): any | null {
  const target = String(bridgeId || "").trim();
  if (!target) return null;

  let best: any = null;
  let bestCount = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const sourceId = String(row?.sourceScheduleId || "").trim();
    const rowId = String(row?.id || "").trim();
    const parentId = String(row?.parentScheduleId || "").trim();
    const rowBridge = pickLiveBridgeScheduleId(sourceId, rowId, parentId, rowId.split(":slot:")[0]);

    const matches =
      rowBridge === target ||
      sourceId === target ||
      rowId === target ||
      parentId === target ||
      rowId.startsWith(`${target}:`);

    if (!matches) continue;

    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    if (slots.length >= bestCount) {
      best = row;
      bestCount = slots.length;
    }
  }

  return bestCount > 0 ? best : null;
}

function matchSlotInFullSchedule(fullSlots: any[], alertSlot: any) {
  const slotId = String(
    alertSlot?.id || alertSlot?.slotId || alertSlot?.roomMessageId || ""
  ).trim();
  const slotNumber = Number(alertSlot?.slot || alertSlot?.slotNumber || alertSlot?.order || 0);

  for (let index = 0; index < fullSlots.length; index++) {
    const candidate = fullSlots[index];
    const candidateId = String(candidate?.id || candidate?.slotId || "").trim();
    const candidateRoomMessageId = String(candidate?.roomMessageId || "").trim();
    if (
      slotId &&
      (candidateId === slotId ||
        candidateRoomMessageId === slotId ||
        candidateId.endsWith(`:${slotId}`))
    ) {
      return { slot: candidate, index, routeSlotNumber: index + 1 };
    }
    const candidateNumber = Number(candidate?.slot || candidate?.slotNumber || candidate?.order || 0);
    if (slotNumber > 0 && candidateNumber === slotNumber) {
      return { slot: candidate, index, routeSlotNumber: slotNumber };
    }
  }

  return {
    slot: alertSlot,
    index: Math.max(0, slotNumber - 1),
    routeSlotNumber: Math.max(1, slotNumber || 1),
  };
}

function shouldRemapLiveRingNavigationTarget(input: {
  item: any;
  slot: any;
  allSlots: any[];
}): boolean {
  const item = input.item || {};
  const slot = input.slot || {};
  const rawScheduleId = String(item?.sourceScheduleId || item?.id || "").trim();
  const slotScheduleId = String(slot?.sourceScheduleId || slot?.sourceFeedId || "").trim();

  if (isRoomMessageScheduleId(rawScheduleId)) return true;
  if (isRoomMessageScheduleId(slot?.roomMessageId)) return true;
  if (isRoomMessageScheduleId(slot?.id) && !isScheduleBatchLiveBridgeId(slotScheduleId)) return true;
  if (item?.__claimStoreInjected === true && !isScheduleBatchLiveBridgeId(rawScheduleId)) return true;
  if (isChurchLiveControlScheduleItem(item) && input.allSlots.length <= 1) return true;

  return false;
}

export function resolveLiveRingNavigationTarget(input: {
  item: any;
  slot: any;
  allSlots?: any[];
  routeSlotNumber?: number;
  viewerUserId?: string;
  viewerChurchId?: string;
  mergedRows?: any[];
  source?: string;
}) {
  const item = input.item || {};
  const alertSlot = input.slot || {};
  const initialSlots = Array.isArray(input.allSlots)
    ? input.allSlots
    : Array.isArray(item?.scheduleSlots)
      ? item.scheduleSlots
      : alertSlot
        ? [alertSlot]
        : [];

  const mergedRows = collectMergedScheduleRows(input.mergedRows || []);
  const viewerUserId = String(input.viewerUserId || "").trim();
  const viewerChurchId = String(
    input.viewerChurchId || item?.churchId || item?.sourceChurchId || ""
  ).trim();

  const rawScheduleId = String(item?.sourceScheduleId || item?.id || "").trim();
  const needsRemap = shouldRemapLiveRingNavigationTarget({
    item,
    slot: alertSlot,
    allSlots: initialSlots,
  });

  let liveBridgeId = pickLiveBridgeScheduleId(
    alertSlot?.scheduleBatchId,
    alertSlot?.sourceScheduleId,
    alertSlot?.sourceFeedId,
    item?.parentScheduleId,
    item?.sourceScheduleId,
    resolveLiveRingCanonicalFeedId(item, mergedRows).canonicalFeedId
  );

  if (!liveBridgeId && isRoomMessageScheduleId(rawScheduleId)) {
    liveBridgeId = resolveBatchIdFromRoomMessage(rawScheduleId, viewerChurchId, viewerUserId);
  }
  if (!liveBridgeId && isRoomMessageScheduleId(alertSlot?.roomMessageId)) {
    liveBridgeId = resolveBatchIdFromRoomMessage(
      alertSlot.roomMessageId,
      viewerChurchId,
      viewerUserId
    );
  }
  if (!liveBridgeId && isRoomMessageScheduleId(alertSlot?.id)) {
    liveBridgeId = resolveBatchIdFromRoomMessage(alertSlot.id, viewerChurchId, viewerUserId);
  }

  let resolvedItem = item;
  let allSlots = initialSlots;
  let remappedFromRm = false;

  const shouldHydrateExactSchedule =
    needsRemap ||
    (liveBridgeId && !isScheduleBatchLiveBridgeId(rawScheduleId)) ||
    (isScheduleBatchLiveBridgeId(liveBridgeId) && initialSlots.length <= 1);

  if (shouldHydrateExactSchedule) {
    let fullRow =
      (liveBridgeId ? findFullScheduleRowForBridge(liveBridgeId, mergedRows) : null) ||
      resolveChurchLiveControlScheduleRow({
        churchId: viewerChurchId,
        userId: viewerUserId,
        batchId: liveBridgeId,
      });

    // Never fall back to an unbound CLC schedule — that can hydrate a foreign live ID.
    if (fullRow) {
      const fullSlots = normalizeLiveScheduleSlots(
        Array.isArray(fullRow?.scheduleSlots) ? fullRow.scheduleSlots : []
      );
      if (fullSlots.length) {
        const hydratedId = pickLiveBridgeScheduleId(
          fullRow?.sourceScheduleId,
          fullRow?.id,
          fullRow?.parentScheduleId,
          liveBridgeId
        );
        if (
          liveBridgeId &&
          hydratedId &&
          hydratedId !== liveBridgeId &&
          !hydratedId.startsWith(`${liveBridgeId}-`) &&
          !liveBridgeId.startsWith(`${hydratedId}-`)
        ) {
          console.log("KRISTO_LIVE_STALE_SCHEDULE_REJECTED", {
            requestedLiveId: liveBridgeId,
            canonicalLiveSessionId: liveBridgeId,
            hydratedScheduleId: hydratedId,
            source: input.source || "live-ring",
            reason: "foreign_schedule_during_ring_hydrate",
          });
        } else {
          liveBridgeId = hydratedId || liveBridgeId;

          resolvedItem = {
            ...fullRow,
            id: liveBridgeId || fullRow.id,
            sourceScheduleId: liveBridgeId || fullRow.sourceScheduleId || fullRow.id,
          };
          allSlots = fullSlots;
          remappedFromRm = isRoomMessageScheduleId(rawScheduleId) || initialSlots.length <= 1;
          console.log("KRISTO_LIVE_EXACT_SCHEDULE_HYDRATED", {
            requestedLiveId: liveBridgeId,
            canonicalLiveSessionId: liveBridgeId,
            hydratedScheduleId: liveBridgeId,
            routeSlotCount: fullSlots.length,
            source: input.source || "live-ring",
          });
        }
      }
    }
  }

  const matched = matchSlotInFullSchedule(allSlots, alertSlot);
  const sourceScheduleId = String(
    liveBridgeId || resolvedItem?.sourceScheduleId || resolvedItem?.id || rawScheduleId
  ).trim();

  console.log("KRISTO_RING_CANONICAL_LIVE_ID_PINNED", {
    source: input.source || "live-ring",
    requestedLiveId: rawScheduleId,
    canonicalLiveSessionId: sourceScheduleId,
    routeSlotCount: allSlots.length,
    routeSlotNumber: input.routeSlotNumber ?? matched.routeSlotNumber,
    remappedFromRm,
  });

  if (remappedFromRm || (needsRemap && isScheduleBatchLiveBridgeId(sourceScheduleId))) {
    console.log("KRISTO_LIVE_RING_NAV_RM_TO_BATCH_BRIDGE", {
      source: input.source || "live-ring",
      rawScheduleId,
      liveBridgeId: sourceScheduleId,
      routeSlotCountBefore: initialSlots.length,
      routeSlotCountAfter: allSlots.length,
      slotId: String(alertSlot?.id || alertSlot?.slotId || ""),
      roomMessageId: String(alertSlot?.roomMessageId || ""),
    });
  }

  console.log("KRISTO_LIVE_RING_NAV_TARGET_RESOLVED", {
    source: input.source || "live-ring",
    rawScheduleId,
    liveBridgeId: sourceScheduleId,
    sourceScheduleId,
    remappedFromRm,
    needsRemap,
    routeSlotCountBefore: initialSlots.length,
    routeSlotCountAfter: allSlots.length,
    routeSlotNumber: input.routeSlotNumber ?? matched.routeSlotNumber,
    matchedSlotId: String(matched.slot?.id || matched.slot?.slotId || ""),
    churchLiveControl: isChurchLiveControlScheduleItem(resolvedItem),
  });

  if (allSlots.length > 1 || remappedFromRm) {
    console.log("KRISTO_LIVE_RING_NAV_FULL_SLOT_PAYLOAD", {
      source: input.source || "live-ring",
      liveBridgeId: sourceScheduleId,
      routeSlotCount: allSlots.length,
      slotNumbers: allSlots.map((slot: any, index: number) =>
        Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1)
      ),
      leanSlotsByteLen: utf8JsonByteLength(buildLeanLiveScheduleSlotsJson(allSlots)),
    });
  }

  return {
    item: resolvedItem,
    slot: matched.slot,
    allSlots,
    liveBridgeId: sourceScheduleId,
    sourceScheduleId,
    routeSlotNumber: input.routeSlotNumber ?? matched.routeSlotNumber,
    remappedFromRm,
  };
}

function resolveScheduleLiveRoomFeedIds(item: any, liveBridgeId?: string) {
  const rows = feedList() as any[];
  const resolved = resolveLiveRingCanonicalFeedId(item, rows);
  const bridge = String(liveBridgeId || "").trim();
  if (bridge && isScheduleBatchLiveBridgeId(bridge)) {
    return {
      canonicalFeedId: bridge,
      localScheduleId: isRoomMessageScheduleId(resolved.localScheduleId)
        ? ""
        : resolved.localScheduleId,
    };
  }
  if (isRoomMessageScheduleId(resolved.canonicalFeedId) && bridge) {
    return { canonicalFeedId: bridge, localScheduleId: "" };
  }
  return resolved;
}

export function buildScheduleLiveRoomRouteParams(
  item: any,
  options: {
    slot: any;
    allSlots: any[];
    isLiveNow: boolean;
    claimedByMe: boolean;
    routeSlotNumber: number;
    scheduleStartMs?: number;
    scheduleEndMs?: number;
    churchId?: string;
    viewerUserId?: string;
    liveBridgeId?: string;
    sourceScheduleId?: string;
  }
): ScheduleLiveRoomRouteParams {
  const bridgeId = String(
    options.liveBridgeId || options.sourceScheduleId || ""
  ).trim();
  const { canonicalFeedId, localScheduleId } = resolveScheduleLiveRoomFeedIds(item, bridgeId);
  const liveId = bridgeId || canonicalFeedId;
  const { slot, allSlots, isLiveNow, claimedByMe, routeSlotNumber } = options;
  const authority = buildLiveRoomAuthorityParams(item);
  const leanSlotsJson = buildLeanLiveScheduleSlotsJson(allSlots);
  const viewerUserId = String(options.viewerUserId || "").trim();
  const mediaHostIds = String(item?.mediaHostIds || item?.hostIds || authority.mediaHostIds || "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const isPastor = !!viewerUserId && String(authority.actualChurchPastorUserId || "") === viewerUserId;
  const isScheduleCreator =
    !!viewerUserId && String(authority.scheduleCreatedByUserId || "") === viewerUserId;
  const isHost = !!viewerUserId && mediaHostIds.includes(viewerUserId);
  const canPublishMicNow = isPastor || isScheduleCreator || isHost || claimedByMe;
  const canPublishCameraNow = claimedByMe && isLiveNow;

  console.log("KRISTO_ENTER_LIVE_ROOM_ROUTE_BUILD", {
    feedId: liveId,
    localScheduleId,
    slotCount: allSlots.length,
    routeSlotNumber,
    claimedByMe,
    isLiveNow,
    claimedByUserId: scheduleSlotClaimUserId(slot),
    leanSlotsByteLen: utf8JsonByteLength(leanSlotsJson),
  });

  return {
    id: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
    source: "media",
    liveMode: "schedule",
    layout: "grid6",
    entryMode: isLiveNow ? "live" : "waiting",
    role: claimedByMe ? "Host" : "Viewer",
    mode: claimedByMe ? "host" : "viewer",
    room: "media",
    scheduleType: String(item?.scheduleType || "media-live-slots"),
    mediaName: String(item?.mediaName || item?.actorLabel || "Church Media"),
    churchName: String(item?.churchName || item?.churchLabel || "Church"),
    churchLabel: String(item?.churchName || item?.churchLabel || "Church"),
    churchId: String(item?.churchId || options.churchId || ""),
    liveId,
    feedId: liveId,
    sourceScheduleId: String(options.sourceScheduleId || liveId),
    ...(localScheduleId ? { localScheduleId } : {}),
    liveAllScheduleSlotsJson: leanSlotsJson,
    title: String(slot?.name || slot?.slotLabel || item?.title || "Church Live").slice(0, 120),
    preferredSlotNumber: String(routeSlotNumber),
    currentSlotNumber: String(routeSlotNumber),
    claimedSlotNumber: String(routeSlotNumber),
    scheduleStartMs: String(options.scheduleStartMs || ""),
    scheduleEndMs: String(options.scheduleEndMs || ""),
    claimedByUserId: scheduleSlotClaimUserId(slot).slice(0, 64),
    claimedByName: String(slot?.claimedByName || slot?.claimedBy?.name || "").slice(0, 80),
    claimedByAvatar: sanitizeLeanRouteAvatarUri(
      slot?.claimedByAvatar || slot?.claimedByAvatarUri || slot?.avatarUri
    ),
    mediaSlotPublisher: claimedByMe ? "1" : "0",
    canPublish: canPublishMicNow || canPublishCameraNow ? "1" : "0",
    canPublishCamera: canPublishCameraNow ? "1" : "0",
    canPublishMic: canPublishMicNow ? "1" : "0",
    watchScheduledPublisher: claimedByMe ? "1" : "0",
    isGlobalMediaSlot: "1",
    ...authority,
    mediaOwnerPastorUserId: authority.actualChurchPastorUserId,
    mediaHostIds: String(item?.mediaHostIds || item?.hostIds || authority.mediaHostIds || ""),
  };
}

export function enterLiveRoomFromScheduleCard(input: {
  router: Router;
  item: any;
  activeSlot?: any | null;
  viewerUserId: string;
  viewerChurchId?: string;
  nowMs?: number;
  source: EnterLiveRoomSource;
  navigationMethod?: "push" | "replace";
}) {
  const item = input.item || {};
  const activeSlot = input.activeSlot || null;
  const allSlots = Array.isArray(item?.scheduleSlots)
    ? item.scheduleSlots
    : activeSlot
      ? [activeSlot]
      : [];
  const slot = activeSlot || allSlots[0] || null;
  const viewerUserId = String(input.viewerUserId || "").trim();
  const feedSeed = baseFeedId(
    String(item?.sourceScheduleId || item?.parentScheduleId || item?.id || "")
  );
  const slotId = String(slot?.id || slot?.slotId || "").trim();

  if (feedSeed && slotId && viewerUserId) {
    const authoritativeRows = [
      ...(feedList() as any[]),
      ...getCachedHomeFeedBackendRows(),
    ];
    if (isScheduleFeedPresentInRows(authoritativeRows, feedSeed)) {
      const authoritative = findAuthoritativeScheduleSlot(authoritativeRows, feedSeed, slotId);
      if (!authoritative) {
        purgeClaimedSlotLocalState({
          scheduleId: feedSeed,
          slotId,
          userId: viewerUserId,
          reason: "enter-live-room-slot-missing",
          rows: authoritativeRows,
        });
        emitLiveRingRefresh("enter-live-room-stale-slot");
        console.log("KRISTO_ENTER_LIVE_ROOM_BLOCKED", {
          source: input.source,
          reason: "slot_not_in_authoritative_schedule",
          feedId: feedSeed,
          slotId,
          viewerUserId,
        });
        return false;
      }
    }
  }

  const claimUserId = scheduleSlotClaimUserId(slot);
  const claimedByMe = !!viewerUserId && !!claimUserId && claimUserId === viewerUserId;
  const startMs = Number(slot?.startMs || 0);
  const endMs = Number(slot?.endMs || 0);
  const nowMs = Number(input.nowMs || Date.now());
  const isLiveNow = startMs > 0 && endMs > startMs && nowMs >= startMs && nowMs <= endMs;
  const routeSlotNumber = Math.max(
    1,
    Number(item?.slotNumber || slot?.slot || slot?.slotNumber || slot?.order || 1)
  );

  const navTarget = resolveLiveRingNavigationTarget({
    item,
    slot,
    allSlots,
    routeSlotNumber,
    viewerUserId,
    viewerChurchId: input.viewerChurchId,
    source: input.source,
  });

  console.log("KRISTO_ENTER_LIVE_ROOM_START", {
    source: input.source,
    viewerUserId,
    slotId: String(navTarget.slot?.id || ""),
    feedSeedId: String(
      item?.parentScheduleId || item?.sourceScheduleId || item?.id || ""
    ),
    liveBridgeId: navTarget.liveBridgeId,
    claimedByMe,
    claimedByUserId: claimUserId,
    isLiveNow,
    routeSlotNumber: navTarget.routeSlotNumber,
    slotCount: navTarget.allSlots.length,
    navigationMethod: input.navigationMethod || "push",
  });

  markLiveEnterTap(input.source, {
    viewerUserId,
    feedId: navTarget.liveBridgeId,
    claimedByMe,
    isLiveNow,
    routeSlotNumber: navTarget.routeSlotNumber,
  });
  pauseHomeFeedBackgroundWorkForLiveNavigation(`enter-live-${input.source}`);

  const routeParams = buildScheduleLiveRoomRouteParams(navTarget.item, {
    slot: navTarget.slot,
    allSlots: navTarget.allSlots,
    isLiveNow,
    claimedByMe,
    routeSlotNumber: navTarget.routeSlotNumber,
    scheduleStartMs: startMs,
    scheduleEndMs: endMs,
    churchId: input.viewerChurchId,
    viewerUserId,
    liveBridgeId: navTarget.liveBridgeId,
    sourceScheduleId: navTarget.sourceScheduleId,
  });

  const pathname = "/(tabs)/more/my-church-room/messages/live-room";

  console.log("KRISTO_ENTER_LIVE_ROOM_ROUTER_PUSH", {
    source: input.source,
    pathname,
    feedId: routeParams.feedId,
    localScheduleId: String(routeParams.localScheduleId || ""),
    claimedByMe,
    isLiveNow,
    canPublish: routeParams.canPublish,
    canPublishMic: routeParams.canPublishMic,
    canPublishCamera: routeParams.canPublishCamera,
    claimedByUserId: routeParams.claimedByUserId,
    entryMode: routeParams.entryMode,
    currentSlotNumber: routeParams.currentSlotNumber,
    routeSlotCount: navTarget.allSlots.length,
    leanSlotsByteLen: utf8JsonByteLength(String(routeParams.liveAllScheduleSlotsJson || "")),
  });

  pushLiveRoomWithSilentPreflight({
    router: input.router,
    params: routeParams as Record<string, string>,
    viewerUserId,
    viewerChurchId: input.viewerChurchId,
    source: input.source,
    routeSlotCount: navTarget.allSlots.length,
    navigationMethod: input.navigationMethod,
  });
}

function pickChurchLiveControlActiveSlot(
  slots: any[],
  nowMs: number,
  viewerUserId: string
): any | null {
  if (!Array.isArray(slots) || !slots.length) return null;

  const activeByTime = slots.find((slot: any) => {
    const startMs = Number(slot?.startMs || 0);
    const endMs = Number(slot?.endMs || 0);
    return startMs > 0 && endMs > startMs && nowMs >= startMs && nowMs <= endMs;
  });
  if (activeByTime) return activeByTime;

  if (viewerUserId) {
    const claimed = slots.find(
      (slot: any) => scheduleSlotClaimUserId(slot) === viewerUserId
    );
    if (claimed) return claimed;
  }

  return slots[0] || null;
}

export function buildChurchLiveControlLiveRoomRouteParamsFromMessages(input: {
  messages: any[];
  viewerUserId: string;
  viewerChurchId?: string;
  churchName?: string;
  mediaName?: string;
  nowMs?: number;
  assignmentId?: string;
  title?: string;
  role?: string;
  entryMode?: string;
  source?: string;
  liveMode?: string;
  preview?: string;
  /** When set, only this exact live/schedule ID may be used (no foreign fallback). */
  canonicalLiveSessionId?: string;
  scheduleId?: string;
  batchId?: string;
}): ScheduleLiveRoomRouteParams | null {
  const nowMs = Number(input.nowMs || Date.now());
  const viewerUserId = String(input.viewerUserId || "").trim();
  const preferredLiveId = String(
    input.canonicalLiveSessionId || input.batchId || input.scheduleId || ""
  ).trim();
  const built = buildChurchLiveControlLiveRoomScheduleSlots(input.messages, {
    churchId: input.viewerChurchId,
    churchName: input.churchName,
    mediaName: input.mediaName,
    nowMs,
    scheduleId: preferredLiveId || undefined,
    batchId: preferredLiveId || undefined,
    canonicalLiveSessionId: preferredLiveId || undefined,
  });
  if (!built?.scheduleId || !built.slots?.length) {
    console.log("KRISTO_CHURCH_LIVE_CONTROL_LIVE_NAV_BLOCKED", {
      reason: "no_schedule_slots",
      slotCount: built?.slots?.length || 0,
      scheduleId: String(built?.scheduleId || ""),
      requestedLiveId: preferredLiveId,
      canonicalLiveSessionId: preferredLiveId,
    });
    return null;
  }

  if (
    preferredLiveId &&
    built.scheduleId !== preferredLiveId &&
    !built.scheduleId.startsWith(`${preferredLiveId}-`)
  ) {
    console.log("KRISTO_LIVE_SESSION_ID_MISMATCH_BLOCKED", {
      requestedLiveId: preferredLiveId,
      canonicalLiveSessionId: preferredLiveId,
      hydratedScheduleId: built.scheduleId,
      source: "buildChurchLiveControlLiveRoomRouteParamsFromMessages",
    });
    return null;
  }

  const row = buildChurchLiveControlGuestCenterScheduleRow(input.messages, {
    churchId: input.viewerChurchId,
    churchName: input.churchName,
    mediaName: input.mediaName,
    nowMs,
    scheduleId: preferredLiveId || built.scheduleId,
    batchId: preferredLiveId || built.scheduleId,
    canonicalLiveSessionId: preferredLiveId || built.scheduleId,
  });
  if (!row) return null;

  const allSlots = built.slots;
  const activeSlot = pickChurchLiveControlActiveSlot(allSlots, nowMs, viewerUserId);
  if (!activeSlot) return null;

  const navTarget = resolveLiveRingNavigationTarget({
    item: row,
    slot: activeSlot,
    allSlots,
    routeSlotNumber: Math.max(
      1,
      Number(activeSlot?.slot || activeSlot?.slotNumber || activeSlot?.order || 1)
    ),
    viewerUserId,
    viewerChurchId: input.viewerChurchId,
    source: "church-live-control-room-card",
  });

  const startMs = Number(navTarget.slot?.startMs || 0);
  const endMs = Number(navTarget.slot?.endMs || 0);
  const isLiveNow = startMs > 0 && endMs > startMs && nowMs >= startMs && nowMs <= endMs;
  const claimUserId = scheduleSlotClaimUserId(navTarget.slot);
  const claimedByMe = !!viewerUserId && !!claimUserId && claimUserId === viewerUserId;

  const routeParams = buildScheduleLiveRoomRouteParams(navTarget.item, {
    slot: navTarget.slot,
    allSlots: navTarget.allSlots,
    isLiveNow,
    claimedByMe,
    routeSlotNumber: navTarget.routeSlotNumber,
    scheduleStartMs: startMs,
    scheduleEndMs: endMs,
    churchId: input.viewerChurchId,
    viewerUserId,
    liveBridgeId: navTarget.liveBridgeId,
    sourceScheduleId: navTarget.sourceScheduleId,
  });

  return {
    ...routeParams,
    ...(input.title ? { title: String(input.title).slice(0, 120) } : {}),
    ...(input.role ? { role: String(input.role) } : {}),
    ...(input.assignmentId ? { assignmentId: String(input.assignmentId) } : {}),
    ...(input.source ? { source: String(input.source) } : {}),
    ...(input.liveMode ? { liveMode: String(input.liveMode) } : {}),
    ...(input.preview ? { preview: String(input.preview) } : {}),
    ...(input.entryMode ? { entryMode: String(input.entryMode) } : {}),
    roomKind: "church-live-control",
    mediaScope: "church",
    layout: routeParams.layout || "grid6",
    membersCount: "26",
    leadersCount: "4",
  };
}

export function navigateChurchLiveControlLiveRoomFromMessages(input: {
  router: Router;
  messages: any[];
  viewerUserId: string;
  viewerChurchId?: string;
  churchName?: string;
  mediaName?: string;
  nowMs?: number;
  assignmentId?: string;
  title?: string;
  role?: string;
  entryMode?: string;
  source?: string;
  liveMode?: string;
  preview?: string;
  /** Ring/assignment-selected live ID — must win over any other CLC schedule. */
  canonicalLiveSessionId?: string;
  scheduleId?: string;
  batchId?: string;
  sourceScheduleId?: string;
}): boolean {
  const viewerUserId = String(input.viewerUserId || "").trim();
  const preferredLiveId = String(
    input.canonicalLiveSessionId ||
      input.batchId ||
      input.scheduleId ||
      input.sourceScheduleId ||
      ""
  ).trim();
  const routeParams = buildChurchLiveControlLiveRoomRouteParamsFromMessages({
    ...input,
    canonicalLiveSessionId: preferredLiveId || undefined,
    scheduleId: preferredLiveId || undefined,
    batchId: preferredLiveId || undefined,
  });
  if (!routeParams) return false;

  const pathname = "/(tabs)/more/my-church-room/messages/live-room";

  console.log("KRISTO_ENTER_LIVE_ROOM_ROUTER_PUSH", {
    source: "church-live-control-room-card",
    pathname,
    feedId: routeParams.feedId,
    liveId: routeParams.liveId,
    sourceScheduleId: routeParams.sourceScheduleId,
    entryMode: routeParams.entryMode,
    currentSlotNumber: routeParams.currentSlotNumber,
    leanSlotsByteLen: utf8JsonByteLength(String(routeParams.liveAllScheduleSlotsJson || "")),
  });

  markLiveEnterTap("church-live-control-room-card", {
    viewerUserId,
    feedId: String(routeParams.liveId || routeParams.feedId || "").trim(),
    claimedByMe: routeParams.mediaSlotPublisher === "1",
    isLiveNow: routeParams.entryMode === "live",
    routeSlotNumber: Number(routeParams.currentSlotNumber || 1),
  });
  pauseHomeFeedBackgroundWorkForLiveNavigation("enter-live-church-live-control-room-card");

  pushLiveRoomWithSilentPreflight({
    router: input.router,
    params: routeParams as Record<string, string>,
    viewerUserId,
    viewerChurchId: input.viewerChurchId,
    source: "church-live-control-room-card",
    routeSlotCount: parseLiveAllScheduleSlotsJson(routeParams.liveAllScheduleSlotsJson).length,
  });
  return true;
}
