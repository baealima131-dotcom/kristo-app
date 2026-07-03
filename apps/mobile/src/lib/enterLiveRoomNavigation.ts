import type { Router } from "expo-router";
import { feedList, purgeClaimedSlotLocalState } from "@/src/lib/homeFeedStore";
import { findAuthoritativeScheduleSlot, isScheduleFeedPresentInRows } from "@/src/lib/claimStateMerge";
import { emitLiveRingRefresh } from "@/src/lib/liveScheduleRingEvents";
import { buildLiveRoomAuthorityParams } from "@/src/lib/liveMediaAuthority";
import { markLiveEnterTap } from "@/src/lib/liveKitPerf";
import {
  pinLiveRoomSession,
  clearStaleLiveEndedFlag,
  pinLiveKitPublisherHostBeforeToken,
  pinClaimEnterSessionLockFromRoute,
} from "@/src/lib/liveRoomSessionGuard";
import { prefetchLiveKitToken } from "@/src/lib/liveKitTokenPrefetch";
import {
  pauseHomeFeedBackgroundWorkForLiveNavigation,
  prewarmLiveRoomMediaPermissions,
} from "@/src/lib/liveRoomStartup";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  buildLeanLiveScheduleSlotsJson,
  baseFeedId,
  isBackendFeedScheduleId,
  normalizeLiveScheduleSlots,
  resolveLiveRingCanonicalFeedId,
  sanitizeLeanRouteAvatarUri,
  scheduleSlotClaimUserId,
  utf8JsonByteLength,
} from "@/src/lib/scheduleSlotUtils";
import {
  buildChurchLiveControlGuestCenterScheduleRow,
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

  const built = buildChurchLiveControlGuestCenterScheduleRow(rows, { churchId });
  if (!built) return null;

  const scheduleId = String(built?.sourceScheduleId || built?.id || "").trim();
  const wantedBatch = String(input.batchId || "").trim();
  if (wantedBatch && scheduleId && scheduleId !== wantedBatch && !scheduleId.includes(wantedBatch)) {
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

  if (needsRemap || (liveBridgeId && !isScheduleBatchLiveBridgeId(rawScheduleId))) {
    let fullRow =
      (liveBridgeId ? findFullScheduleRowForBridge(liveBridgeId, mergedRows) : null) ||
      resolveChurchLiveControlScheduleRow({
        churchId: viewerChurchId,
        userId: viewerUserId,
        batchId: liveBridgeId,
      });

    if (!fullRow && !liveBridgeId) {
      fullRow = resolveChurchLiveControlScheduleRow({
        churchId: viewerChurchId,
        userId: viewerUserId,
      });
    }

    if (fullRow) {
      const fullSlots = normalizeLiveScheduleSlots(
        Array.isArray(fullRow?.scheduleSlots) ? fullRow.scheduleSlots : []
      );
      if (fullSlots.length) {
        liveBridgeId =
          pickLiveBridgeScheduleId(
            fullRow?.sourceScheduleId,
            fullRow?.id,
            fullRow?.parentScheduleId,
            liveBridgeId
          ) || liveBridgeId;

        resolvedItem = {
          ...fullRow,
          id: liveBridgeId || fullRow.id,
          sourceScheduleId: liveBridgeId || fullRow.sourceScheduleId || fullRow.id,
        };
        allSlots = fullSlots;
        remappedFromRm = isRoomMessageScheduleId(rawScheduleId) || initialSlots.length <= 1;
      }
    }
  }

  const matched = matchSlotInFullSchedule(allSlots, alertSlot);
  const sourceScheduleId = String(
    liveBridgeId || resolvedItem?.sourceScheduleId || resolvedItem?.id || rawScheduleId
  ).trim();

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
  prewarmLiveRoomMediaPermissions(input.source);
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

  (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
  (globalThis as any).__KRISTO_LIVE_RING_NAV_AT__ = Date.now();

  const liveBridgeId = String(routeParams.liveId || routeParams.feedId || "").trim();
  if (liveBridgeId) {
    pinLiveRoomSession({
      liveBridgeId,
      userId: viewerUserId,
      routeSlotCount: navTarget.allSlots.length,
      source: `enter-live-${input.source}`,
    });
    clearStaleLiveEndedFlag(liveBridgeId, "enter-live-nav");
  }

  const wantsPublish =
    routeParams.canPublish === "1" ||
    routeParams.canPublishCamera === "1" ||
    routeParams.mediaSlotPublisher === "1";
  if (liveBridgeId && viewerUserId && wantsPublish) {
    pinClaimEnterSessionLockFromRoute({
      liveBridgeId,
      routeParams: routeParams as Record<string, unknown>,
      source: `enter-live-${input.source}`,
    });
    pinLiveKitPublisherHostBeforeToken(liveBridgeId, `enter-live-${input.source}`, {
      stableIdentity: String(routeParams.claimedByUserId || viewerUserId).replace(/[^a-zA-Z0-9_]/g, ""),
    });
    const viewerChurchId = String(input.viewerChurchId || routeParams.churchId || "").trim();
    const tokenIdentity = String(routeParams.claimedByUserId || viewerUserId).replace(
      /[^a-zA-Z0-9_]/g,
      ""
    );
    prefetchLiveKitToken({
      roomName: liveBridgeId,
      identity: tokenIdentity,
      canPublish: true,
      source: `enter-live-${input.source}`,
      headers: getKristoHeaders({
        userId: String(routeParams.claimedByUserId || viewerUserId),
        role: "Member",
        churchId: viewerChurchId,
      }) as Record<string, string>,
    });
  }

  if (input.navigationMethod === "replace") {
    input.router.replace({ pathname, params: routeParams } as any);
  } else {
    input.router.push({ pathname, params: routeParams } as any);
  }
}
