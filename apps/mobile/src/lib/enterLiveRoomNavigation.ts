import type { Router } from "expo-router";
import { feedList } from "@/src/lib/homeFeedStore";
import { buildLiveRoomAuthorityParams } from "@/src/lib/liveMediaAuthority";
import { pauseHomeFeedBackgroundWorkForLiveNavigation } from "@/src/lib/liveRoomStartup";
import {
  buildLeanLiveScheduleSlotsJson,
  resolveLiveRingCanonicalFeedId,
  sanitizeLeanRouteAvatarUri,
  scheduleSlotClaimUserId,
  utf8JsonByteLength,
} from "@/src/lib/scheduleSlotUtils";

export type EnterLiveRoomSource =
  | "live-slots-card"
  | "home-feed-live-section"
  | "home-live-schedule-card";

export type ScheduleLiveRoomRouteParams = Record<string, string>;

function resolveScheduleLiveRoomFeedIds(item: any) {
  const rows = feedList() as any[];
  return resolveLiveRingCanonicalFeedId(item, rows);
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
  }
): ScheduleLiveRoomRouteParams {
  const { canonicalFeedId, localScheduleId } = resolveScheduleLiveRoomFeedIds(item);
  const { slot, allSlots, isLiveNow, claimedByMe, routeSlotNumber } = options;
  const authority = buildLiveRoomAuthorityParams(item);
  const leanSlotsJson = buildLeanLiveScheduleSlotsJson(allSlots);

  console.log("KRISTO_ENTER_LIVE_ROOM_ROUTE_BUILD", {
    feedId: canonicalFeedId,
    localScheduleId,
    slotCount: allSlots.length,
    routeSlotNumber,
    claimedByMe,
    isLiveNow,
    claimedByUserId: scheduleSlotClaimUserId(slot),
    leanSlotsByteLen: utf8JsonByteLength(leanSlotsJson),
  });

  return {
    id: "church-media-room",
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
    liveId: canonicalFeedId,
    feedId: canonicalFeedId,
    sourceScheduleId: canonicalFeedId,
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
    canPublish: claimedByMe && isLiveNow ? "1" : "0",
    canPublishCamera: claimedByMe && isLiveNow ? "1" : "0",
    canPublishMic: claimedByMe && isLiveNow ? "1" : "0",
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

  console.log("KRISTO_ENTER_LIVE_ROOM_START", {
    source: input.source,
    viewerUserId,
    slotId: String(slot?.id || ""),
    feedSeedId: String(item?.parentScheduleId || item?.sourceScheduleId || item?.id || ""),
    claimedByMe,
    claimedByUserId: claimUserId,
    isLiveNow,
    routeSlotNumber,
    slotCount: allSlots.length,
    navigationMethod: input.navigationMethod || "push",
  });

  const routeParams = buildScheduleLiveRoomRouteParams(item, {
    slot,
    allSlots,
    isLiveNow,
    claimedByMe,
    routeSlotNumber,
    scheduleStartMs: startMs,
    scheduleEndMs: endMs,
    churchId: input.viewerChurchId,
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
    routeSlotCount: allSlots.length,
    leanSlotsByteLen: utf8JsonByteLength(String(routeParams.liveAllScheduleSlotsJson || "")),
  });

  (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
  (globalThis as any).__KRISTO_LIVE_RING_NAV_AT__ = Date.now();
  pauseHomeFeedBackgroundWorkForLiveNavigation(`enter-live-${input.source}`);

  if (input.navigationMethod === "replace") {
    input.router.replace({ pathname, params: routeParams } as any);
  } else {
    input.router.push({ pathname, params: routeParams } as any);
  }
}
