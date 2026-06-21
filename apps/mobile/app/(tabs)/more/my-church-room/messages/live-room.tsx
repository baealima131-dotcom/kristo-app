import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
  Animated,
  Easing,
  PanResponder,
  Modal,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  View,
  type ViewStyle,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { AndroidAudioTypePresets, AudioSession, LiveKitRoom, useRoomContext } from "@livekit/react-native";
import { RoomAudioRenderer } from "@/src/lib/liveRoomAudioRenderer";
import { createLocalAudioTrack, createLocalVideoTrack, RoomEvent, Track } from "livekit-client";
import { MediaStream, RTCView, registerGlobals } from "@livekit/react-native-webrtc";
import * as Haptics from "expo-haptics";
import {
  useLiveRoom,
  joinLiveRoomSession,
  leaveLiveRoomSession,
  toggleMic,
  togglePause,
  endLive,
} from "@/src/lib/liveStore";
import { projectStore } from "@/src/lib/projectStore";
import { getSnapshot, subscribe as subscribeMessages } from "@/src/lib/messagesStore";
import { feedList, feedRemoveWhere, feedScheduleSlotsForLive, getRingClaimHints, syncUserClaimedSlotStore, writeRingClaimHint, subscribe as subscribeHomeFeed, clearScheduleClaimRuntimeState } from "@/src/lib/homeFeedStore";
import { onClaimUpdated } from "@/src/lib/kristoProfileEvents";
import {
  getLiveJoinBridge,
  ensureLiveBridgeFromActiveScheduleSlot,
  publishLiveEnded,
  publishLiveJoin,
  publishLivePolicy,
  subscribeLiveJoin,
  syncClaimedMemberToLiveRoom,
  type LiveJoinRequest,
  type LiveRequestPolicy,
} from "@/src/lib/liveBridge";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { apiGet, apiPatch, apiPost, getApiBase } from "@/src/lib/kristoApi";
import {
  extractLightLivePayload,
  fetchLightLiveState,
  messagesListSignature,
  paginateMessages,
  preloadLiveImages,
  resolveCachedLiveAvatar,
  resolveChurchLiveStateUpdate,
  startAdaptiveLivePolling,
} from "@/src/lib/liveRealtime";
import { getKristoHeaders, type KristoRole } from "@/src/lib/kristoHeaders";
import {
  applyFastLiveStageAuthorityBoost,
  evaluateFastLiveSessionAuthority,
  evaluateLiveMediaAuthority,
  evaluateLiveStageAuthority,
  isScheduleSlotCameraWindowOpen,
  logMediaLiveV1StageAuthority,
  logLiveMediaAuthority,
  resolveFastActiveSlotWindow,
  resolveLiveCameraPermissionSource,
  resolveLiveCameraPublishAllowed,
} from "@/src/lib/liveMediaAuthority";
import {
  fetchChurchPastorUserId,
  logChurchPastorResolution,
} from "@/src/lib/churchPastorResolver";
import { fetchChurchSubscriptionActive } from "@/src/lib/churchSubscription";
import {
  applyRingClaimHintsToScheduleSlots,
  enrichScheduleSlotsFromLiveRequests,
  mergeLiveRoomScheduleSlots,
  normalizeLiveScheduleSlots,
  repairLiveMainStageSlotTimes,
  baseFeedId,
  isBackendFeedScheduleId,
  parseLiveAllScheduleSlotsJson,
  parseSlotStartMs,
  parseSlotEndMs,
  resolveLiveScheduleFeedId,
  resolvePersistedClaimAvatarUri,
  resolveMediaSlotClaimedAvatar,
  buildLiveRoomSlotDisplayQueue,
  sanitizePersistedClaimAvatarUri,
  utf8JsonByteLength,
  cleanFeedLabel,
} from "@/src/lib/scheduleSlotUtils";
import {
  assignmentCardsToLiveScheduleSlots,
  extractAssignmentScheduleCards,
} from "@/src/lib/ministryLiveActivation";
import { fetchChurchMembers } from "@/src/lib/churchMembersApi";
import { emitLiveRingRefresh } from "@/src/lib/liveScheduleRing";
import {
  isMediaScheduleFeedExplicitlyEnded,
  liveRoomRouteSlotsHaveActiveWindow,
  shouldIgnoreRouteSlotsForBackendFeedId,
} from "@/src/lib/staleBackendZeroSlotGuard";
import { ensureProfileAvatarUploadedBeforeClaim } from "@/src/lib/ensureProfileAvatarForClaim";
import { runMediaScheduleSilentReload } from "@/src/lib/mediaScheduleSilentReload";
import {
  buildScheduleSlotClaimBody,
  refetchTargetScheduleAfterClaim,
  resolveScheduleChurchId,
} from "@/src/lib/scheduleSlotClaimRequest";
import {
  pauseHomeFeedBackgroundWorkForLiveNavigation,
  prewarmLiveRoomMediaPermissions,
  resumeHomeFeedAfterLiveExit,
} from "@/src/lib/liveRoomStartup";
import { fetchLiveKitToken } from "@/src/lib/liveKitTokenPrefetch";
import { logLiveKitTokenClaims } from "@/src/lib/liveKitTokenDecode";
import {
  logCameraPublishResult,
  logCameraPublishStart,
  logCameraTrackCreateResult,
  logCameraTrackCreateStart,
  logLiveFirstFrameRendered,
  logLiveKitConnectResult,
  logLiveKitConnectStart,
  logLiveKitRoomEvent,
  msSinceLiveEnterTap,
  msSinceLiveRoomMount,
} from "@/src/lib/liveKitPerf";
import {
  buildLiveKitRoomOptions,
  resolveLiveKitVideoCaptureOptions,
} from "@/src/lib/liveKitVideoQuality";
import {
  clearLiveRoomSessionPin,
  clearLiveKitPublisherStagePin,
  clearLiveKitStageMountSticky,
  clearStaleLiveEndedFlag,
  acquireLiveKitStageLock,
  buildLiveKitStageLockKey,
  isLiveKitPublisherStagePinned,
  isLiveKitPublisherHostPinnedBeforeToken,
  isLiveKitStageMountSticky,
  logLiveKitStageMountAllowedTransition,
  logLiveRoomGuardRedirect,
  logLiveRoomNavAway,
  logLiveRoomShowEndedOverlay,
  logLiveRoomUnmountReason,
  logShouldMountLiveKitPublisherStageTransition,
  markLiveRoomLiveKitConnected,
  markLiveRoomLiveKitConnecting,
  isLiveRoomLiveKitConnecting,
  isLiveRoomLiveKitSessionActive,
  pinLiveKitPublisherStage,
  pinLiveKitPublisherHostBeforeToken,
  pinLiveKitStageMountSticky,
  pinLiveRoomSession,
  readLiveKitHostLockSnapshot,
  readLiveKitStageLockEntry,
  releaseLiveKitStageLock,
  shouldBlockLiveRoomAutoNavigation,
  subscribeLiveKitHostLock,
  tryEndLiveBridgeForSchedule,
  pinClaimEnterSessionLockFromRoute,
  readClaimEnterSessionLock,
  shouldHoldClaimEnterSessionLock,
  markClaimEnterLiveKitConnected,
  markClaimEnterCameraPublished,
  clearClaimEnterSessionLock,
  readClaimEnterSessionLockSnapshot,
} from "@/src/lib/liveRoomSessionGuard";
import { markHomeFeedVideoNeedsRecovery } from "@/src/lib/homeFeedVideoController";
import {
  getChurchProjectMcRuntime,
  getChurchProjectMcLiveSlotState,
} from "@/src/store/churchProjectMcScheduleStore";

function isKristoChurchIdLabel(value: unknown) {
  return /^CH\d+-[A-Z0-9]+$/i.test(String(value || "").trim());
}

function cleanLiveRoomLabel(raw: unknown, fallback = "") {
  const s = String(raw || "").trim();
  if (!s || isKristoChurchIdLabel(s)) return fallback;
  return cleanFeedLabel(s, fallback);
}

function resolveLiveRoomHeaderLabel(input: {
  mediaName?: string;
  churchName?: string;
  churchLabel?: string;
  title?: string;
  rawTitle?: string;
  actorLabel?: string;
  sessionChurchName?: string;
}) {
  const ordered: Array<[string, unknown]> = [
    ["mediaName", input.mediaName],
    ["churchName", input.churchName],
    ["churchLabel", input.churchLabel],
    ["sessionChurchName", input.sessionChurchName],
    ["actorLabel", input.actorLabel],
    ["title", input.title],
    ["rawTitle", input.rawTitle],
  ];

  for (const [source, raw] of ordered) {
    const label = cleanLiveRoomLabel(raw);
    if (label) {
      console.log("KRISTO_LIVE_HEADER_LABEL_RESOLVED", { source, label });
      return label;
    }
  }

  const fallback = "Church Live";
  console.log("KRISTO_LIVE_HEADER_LABEL_RESOLVED", { source: "fallback", label: fallback });
  return fallback;
}

function collectClaimedAvatarCandidates(slot: any): string[] {
  const claimedBy = slot?.claimedBy;
  return [
    slot?.claimedByAvatarUri,
    slot?.claimedByAvatar,
    slot?.claimedByAvatarUrl,
    claimedBy?.avatarUri,
    claimedBy?.avatarUrl,
    claimedBy?.profileImage,
    claimedBy?.photoURL,
    claimedBy?.image,
    slot?.avatarUri,
    slot?.avatarUrl,
    slot?.avatar,
    slot?.profileImage,
    slot?.photoURL,
    slot?.image,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}



registerGlobals();

(globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ =
  (globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0;

(globalThis as any).__KRISTO_LIVE_ACTIVE__ = false;
(globalThis as any).__KRISTO_DISABLE_LIVEKIT__ = false;
(globalThis as any).__KRISTO_LIVEKIT_STAGE_LOCKS__ =
  (globalThis as any).__KRISTO_LIVEKIT_STAGE_LOCKS__ || new Map();

(globalThis as any).__KRISTO_VIEWER_JOIN_RETRY_KEYS__ =
  (globalThis as any).__KRISTO_VIEWER_JOIN_RETRY_KEYS__ || new Set();




const gAny = globalThis as any;




if (gAny.window && !gAny.window.addEventListener) {
  gAny.window.addEventListener = () => {};
}

if (gAny.window && !gAny.window.removeEventListener) {
  gAny.window.removeEventListener = () => {};
}

if (!gAny.window) {
  gAny.window = gAny;
}

if (!gAny.navigator) {
  gAny.navigator = {};
}

if (!gAny.navigator.mediaDevices) {
  gAny.navigator.mediaDevices = {};
}

if (!gAny.navigator.mediaDevices.addEventListener) {
  gAny.navigator.mediaDevices.addEventListener = () => {};
}

if (!gAny.navigator.mediaDevices.removeEventListener) {
  gAny.navigator.mediaDevices.removeEventListener = () => {};
}

if (!gAny.document) {
  gAny.document = {};
}

if (!gAny.document.getElementById) {
  gAny.document.getElementById = () => null;
}

if (!gAny.document.createElement) {
  gAny.document.createElement = () => ({
    style: {},
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    play: async () => {},
    pause: () => {},
  });
}



gAny.__KRISTO_MIC_ACTUAL_LISTENERS__ = gAny.__KRISTO_MIC_ACTUAL_LISTENERS__ || new Set();

function publishKristoActualMicEnabled(enabled: boolean) {
  try {
    gAny.__KRISTO_MIC_ACTUAL_ENABLED__ = enabled;
    gAny.__KRISTO_MIC_ACTUAL_LISTENERS__.forEach((fn: any) => {
      try { fn(enabled); } catch {}
    });
  } catch {}
}

function subscribeKristoActualMicEnabled(fn: (enabled: boolean) => void) {
  try {
    gAny.__KRISTO_MIC_ACTUAL_LISTENERS__.add(fn);
    if (typeof gAny.__KRISTO_MIC_ACTUAL_ENABLED__ === "boolean") {
      fn(gAny.__KRISTO_MIC_ACTUAL_ENABLED__);
    }
  } catch {}

  return () => {
    try { gAny.__KRISTO_MIC_ACTUAL_LISTENERS__.delete(fn); } catch {}
  };
}

function logLivePerf(stage: string, extra?: Record<string, unknown>) {
  const mountAt = Number((globalThis as any).__KRISTO_LIVE_ROOM_PERF_MOUNT_AT__ || 0);
  console.log("KRISTO_LIVE_PERF", {
    stage,
    msSinceMount: mountAt > 0 ? Date.now() - mountAt : 0,
    ...(extra || {}),
  });
}

async function fetchLightLiveStateWithPerf(
  headers: Record<string, string>,
  screen: string,
  liveId: string | undefined,
  source: string
) {
  logLivePerf("fetchLightLiveState_start", { source, liveId: liveId || "" });
  logLivePerf("api_church_live_start", { source, liveId: liveId || "" });
  try {
    const patch = await fetchLightLiveState(headers as any, screen, liveId);
    logLivePerf("api_church_live_end", { source, liveId: liveId || "", ok: true });
    logLivePerf("fetchLightLiveState_end", { source, liveId: liveId || "", ok: true });
    return patch;
  } catch (e: any) {
    logLivePerf("api_church_live_end", {
      source,
      liveId: liveId || "",
      ok: false,
      message: String(e?.message || e),
    });
    logLivePerf("fetchLightLiveState_end", {
      source,
      liveId: liveId || "",
      ok: false,
      message: String(e?.message || e),
    });
    throw e;
  }
}

// LiveKit browser detector calls navigator.userAgent.toLowerCase() during publishTrack.
// React Native/Hermes can have navigator without userAgent, so force a safe string.
// React Native browser polyfills needed by LiveKit audio internals.
if (typeof gAny.window === "undefined") gAny.window = gAny;
gAny.window.addEventListener = gAny.window.addEventListener || (() => {});
gAny.window.removeEventListener = gAny.window.removeEventListener || (() => {});
gAny.window.dispatchEvent = gAny.window.dispatchEvent || (() => true);

if (typeof gAny.document === "undefined") gAny.document = {};
gAny.document.hidden = gAny.document.hidden ?? false;
gAny.document.removeEventListener = gAny.document.removeEventListener || (() => {});
gAny.document.querySelector = gAny.document.querySelector || (() => null);
gAny.document.querySelectorAll = gAny.document.querySelectorAll || (() => []);

gAny.document.createElement =
  gAny.document.createElement ||
  ((tag: string) => ({
    tagName: String(tag || "").toUpperCase(),
    style: {},
    children: [],
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    play: async () => {},
    pause: () => {},
    load: () => {},
  }));
gAny.document.createElement = gAny.document.createElement || (() => ({
  style: {},
  setAttribute: () => {},
  removeAttribute: () => {},
  appendChild: () => {},
  removeChild: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}));
gAny.document.documentElement = gAny.document.documentElement || {
  addEventListener: () => {},
  removeEventListener: () => {},
  style: {},
};
gAny.document.head = gAny.document.head || { appendChild: () => {}, removeChild: () => {} };


if (!gAny.navigator) gAny.navigator = {};
gAny.navigator.product = "ReactNative";
gAny.navigator.userAgent = "ReactNative";

if (typeof gAny.Event === "undefined") {
  gAny.Event = class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}

if (typeof gAny.WebSocket !== "undefined") {
  gAny.WebSocket.CONNECTING = gAny.WebSocket.CONNECTING ?? 0;
  gAny.WebSocket.OPEN = gAny.WebSocket.OPEN ?? 1;
  gAny.WebSocket.CLOSING = gAny.WebSocket.CLOSING ?? 2;
  gAny.WebSocket.CLOSED = gAny.WebSocket.CLOSED ?? 3;
}

const BG = "#020817";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";


function stopKristoLiveKitRoomTracks(room: any) {
  if (!room) return;

  try {
    const lp = room.localParticipant;
    const pubs = lp?.trackPublications;
    if (pubs?.forEach) {
      pubs.forEach((pub: any) => {
        try {
          pub?.track?.stop?.();
        } catch {}
      });
    }
  } catch {}

  try {
    const state = String(room?.state || "");
    if (state === "connected" || state === "connecting" || state === "reconnecting") {
      room.disconnect?.();
    }
  } catch {}
}

function clearKristoLiveKitGlobalsForSession(options?: {
  userId?: string;
  roomName?: string;
  accountSwitch?: boolean;
  forceReentry?: boolean;
}) {
  const g = globalThis as any;
  const userId = String(options?.userId || "").trim();
  const roomName = String(options?.roomName || "").trim();
  const unlockReentry = !!options?.forceReentry || !!options?.accountSwitch;

  if (roomName && String(g.__KRISTO_ACTIVE_PUBLISHER_ROOM__ || "") === roomName) {
    g.__KRISTO_ACTIVE_PUBLISHER_ROOM__ = "";
  }

  if (unlockReentry) {
    g.__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = "";
  } else if (userId && roomName) {
    const publisherKey = `${roomName}|${userId}`;
    if (String(g.__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ || "") === publisherKey) {
      g.__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = "";
    }
  } else if (options?.accountSwitch) {
    g.__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = "";
  }

  const locks = g.__KRISTO_LIVEKIT_STAGE_LOCKS__;
  if (locks instanceof Map) {
    for (const key of Array.from(locks.keys())) {
      const keyText = String(key || "");
      if (
        options?.accountSwitch ||
        unlockReentry ||
        (userId && keyText.endsWith(`|${userId}`)) ||
        (roomName && keyText.startsWith(`${roomName}|`))
      ) {
        locks.delete(key);
      }
    }
  } else if (locks instanceof Set) {
    if (options?.accountSwitch || unlockReentry) {
      for (const key of Array.from(locks)) {
        const keyText = String(key || "");
        if (
          (userId && keyText.endsWith(`|${userId}`)) ||
          (roomName && keyText.startsWith(`${roomName}|`))
        ) {
          locks.delete(key);
        }
      }
    } else if (userId && roomName) {
      locks.delete(`${roomName}|${userId}`);
    }
  }

  const retryKeys = g.__KRISTO_VIEWER_JOIN_RETRY_KEYS__;
  if (retryKeys instanceof Set) {
    if ((options?.accountSwitch || unlockReentry) && userId && roomName) {
      retryKeys.delete(`${roomName}|${userId}`);
    }
  }

  try {
    if (g.__KRISTO_SET_LOCAL_MIC_MUTED__) {
      delete g.__KRISTO_SET_LOCAL_MIC_MUTED__;
    }
  } catch {}

  if (unlockReentry) {
    g.__KRISTO_LIVEKIT_COOLDOWN_UNTIL__ = 0;
    g.__KRISTO_DISABLE_LIVEKIT__ = false;
    g.__KRISTO_LIVEKIT_ERROR_LOCK__ = false;
  } else if (options?.accountSwitch) {
    g.__KRISTO_LIVEKIT_ERROR_LOCK__ = false;
  }
}

function forceKristoLiveCleanup(
  reason = "unknown",
  options?: {
    userId?: string;
    roomName?: string;
    accountSwitch?: boolean;
    forceReentry?: boolean;
  }
) {
  const shouldUnlockReentry =
    !!options?.forceReentry ||
    !!options?.accountSwitch ||
    reason === "leave-live-room" ||
    reason === "quit-live-room";

  try {
    console.log("KRISTO_FORCE_STOP_LIVE_MEDIA", {
      reason,
      userId: options?.userId || "",
      roomName: options?.roomName || "",
      accountSwitch: !!options?.accountSwitch,
      forceReentry: shouldUnlockReentry,
    });

    (globalThis as any).__KRISTO_LIVE_ACTIVE__ = false;
    (globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ = 0;
  } catch {}

  try {
    stopKristoLiveKitRoomTracks((globalThis as any).__KRISTO_HELD_LIVEKIT_ROOM__);
    (globalThis as any).__KRISTO_HELD_LIVEKIT_ROOM__ = undefined;
  } catch {}

  try {
    clearKristoLiveKitGlobalsForSession({
      ...options,
      forceReentry: shouldUnlockReentry,
    });
  } catch {}

  if (shouldUnlockReentry) {
    try {
      const g = globalThis as any;
      g.__KRISTO_LIVEKIT_COOLDOWN_UNTIL__ = 0;
      g.__KRISTO_DISABLE_LIVEKIT__ = false;
      g.__KRISTO_LIVEKIT_ERROR_LOCK__ = false;
      g.__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = "";
      console.log("KRISTO_LIVE_REENTRY_UNLOCKED", {
        reason,
        roomName: String(options?.roomName || ""),
        userId: String(options?.userId || ""),
      });
    } catch {}
  }

  try {
    AudioSession.stopAudioSession().catch(() => {});
  } catch {}
}



type LiveComment = {
  id: string;
  name: string;
  text: string;
};

type LayoutMode = "focus" | "split2" | "split2desk" | "grid3" | "panel3" | "ring3" | "grid6" | "round6" | "desk6" | "audience20" | "grid4" | "duo-plus4";

type LiveGuest = {
  id: string;
  name: string;
  role?: string;
  status?: "requested" | "approved" | "live";
  avatar?: string;
};

function resolveSeatType(slot: number, forceCamera = false): LiveSeatType {
  if (forceCamera && slot >= 1) return slot === 1 ? "big-screen" : "camera-mic";

  if (slot === 1) return "big-screen";

  if (slot >= 2 && slot <= 5) {
    return "camera-mic";
  }

  if (slot >= 6 && slot <= 9) {
    return "mic-only";
  }

  return "viewer";
}

type LiveSeatType =
  | "viewer"
  | "moderator"
  | "mic-only"
  | "camera-mic"
  | "big-screen";

function KristoLiveKitConnectionLifecycle({
  roomName,
  expectedIdentity,
}: {
  roomName: string;
  expectedIdentity?: string;
}) {
  const room = useRoomContext();
  const connectStartedRef = useRef(false);
  const connectedLoggedRef = useRef(false);
  const lastStateRef = useRef("");

  useEffect(() => {
    if (!room) {
      console.log("KRISTO_LIVEKIT_ROOM_CONNECT_LIFECYCLE_NO_ROOM", {
        roomName,
        expectedIdentity: String(expectedIdentity || ""),
      });
      return;
    }

    const bridgeId = String(roomName || (room as any)?.name || "").trim();
    const roomState = () => String((room as any)?.state || (room as any)?.connectionState || "");
    const tokenClaims = () =>
      (globalThis as any).__KRISTO_LIVEKIT_ACTIVE_TOKEN_CLAIMS__ || null;
    const identity = () => String((room as any)?.localParticipant?.identity || "");
    const localSid = () => String((room as any)?.localParticipant?.sid || "");

    const logLocalParticipant = (source: string) => {
      const claims = tokenClaims();
      const localIdentity = identity();
      console.log("KRISTO_LIVEKIT_LOCAL_PARTICIPANT", {
        source,
        roomName: bridgeId,
        connectionState: roomState(),
        localParticipantIdentity: localIdentity,
        localParticipantSid: localSid(),
        expectedIdentity: String(expectedIdentity || claims?.identity || ""),
        tokenIdentity: String(claims?.identity || ""),
        tokenRoom: String(claims?.room || ""),
        identityEmptyBeforeJoin: !localIdentity,
        identityMatchesToken:
          !!localIdentity &&
          !!claims?.identity &&
          localIdentity === String(claims.identity),
      });
    };

    const logConnectionStateChanged = (nextState: string, source: string) => {
      if (lastStateRef.current === nextState) return;
      lastStateRef.current = nextState;
      logLocalParticipant(`connection-state-${source}`);
      console.log("KRISTO_LIVEKIT_ROOM_EVENT_CONNECTION_STATE_CHANGED", {
        roomName: bridgeId,
        connectionState: nextState,
        identity: identity(),
        expectedIdentity: String(expectedIdentity || tokenClaims()?.identity || ""),
        tokenIdentity: String(tokenClaims()?.identity || ""),
        source,
        msSinceEnterTap: msSinceLiveEnterTap(),
        msSinceLiveRoomMount: msSinceLiveRoomMount(),
      });
    };

    const emitConnectedOnce = (source: string) => {
      if (connectedLoggedRef.current) return;
      connectedLoggedRef.current = true;
      logLivePerf("livekit_publisher_mount_end", { event: "connected", source });
      markLiveRoomLiveKitConnected(bridgeId);
      markClaimEnterLiveKitConnected(bridgeId);
      console.log("KRISTO_LIVEKIT_ROOM_EVENT_CONNECTED", {
        roomName: bridgeId,
        connectionState: roomState(),
        identity: identity(),
        source,
        msSinceEnterTap: msSinceLiveEnterTap(),
        msSinceLiveRoomMount: msSinceLiveRoomMount(),
      });
      logLiveKitConnectResult({
        ok: true,
        roomName: bridgeId,
        identity: identity(),
        source,
      });
    };

    const onConnected = () => {
      logConnectionStateChanged("connected", "RoomEvent.Connected");
      emitConnectedOnce("RoomEvent.Connected");
    };

    const onDisconnected = (reason?: unknown) => {
      logConnectionStateChanged("disconnected", "RoomEvent.Disconnected");
      const reasonText = String(
        (reason as any)?.reason ||
          (reason as any)?.message ||
          reason ||
          ""
      );
      console.log("KRISTO_LIVEKIT_ROOM_EVENT_DISCONNECTED", {
        roomName: bridgeId,
        connectionState: roomState(),
        identity: identity(),
        expectedIdentity: String(expectedIdentity || tokenClaims()?.identity || ""),
        reason: reasonText,
        reasonName: String((reason as any)?.name || ""),
        reasonCode: String((reason as any)?.code || ""),
        msSinceEnterTap: msSinceLiveEnterTap(),
        msSinceLiveRoomMount: msSinceLiveRoomMount(),
      });
      logLiveKitConnectResult({
        ok: false,
        roomName: bridgeId,
        identity: identity() || String(expectedIdentity || ""),
        reason: reasonText,
        source: "RoomEvent.Disconnected",
      });
    };

    const onReconnecting = () => {
      logConnectionStateChanged("reconnecting", "RoomEvent.Reconnecting");
    };

    const onReconnected = () => {
      logConnectionStateChanged("connected", "RoomEvent.Reconnected");
      emitConnectedOnce("RoomEvent.Reconnected");
    };

    const onConnectionStateChanged = (state: unknown) => {
      const nextState = String(state || roomState());
      logConnectionStateChanged(nextState, "RoomEvent.ConnectionStateChanged");
      if (nextState.toLowerCase() === "connected") {
        emitConnectedOnce("RoomEvent.ConnectionStateChanged");
      }
    };

    if (!connectStartedRef.current) {
      connectStartedRef.current = true;
      markLiveRoomLiveKitConnecting(bridgeId);
      logLiveKitConnectStart({
        roomName: bridgeId,
        state: roomState(),
      });
      console.log("KRISTO_LIVEKIT_ROOM_CONNECT_LIFECYCLE_START", {
        roomName: bridgeId,
        initialState: roomState(),
        identity: identity(),
      });
    }

    logConnectionStateChanged(roomState(), "lifecycle-mount");
    logLocalParticipant("lifecycle-mount");
    console.log("KRISTO_LIVEKIT_ROOM_CONNECT_LIFECYCLE_MOUNT", {
      roomName: bridgeId,
      initialState: roomState(),
      identity: identity(),
      expectedIdentity: String(expectedIdentity || tokenClaims()?.identity || ""),
      tokenIdentity: String(tokenClaims()?.identity || ""),
      tokenRoom: String(tokenClaims()?.room || ""),
    });

    if (roomState().toLowerCase() === "connected") {
      emitConnectedOnce("initial-state-connected");
    }

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);

    const connectionStateChangedEvent =
      (RoomEvent as any).ConnectionStateChanged || "connectionStateChanged";
    room.on(connectionStateChangedEvent, onConnectionStateChanged);

    const statePoll = setInterval(() => {
      const state = roomState();
      logConnectionStateChanged(state, "state-poll");
      if (state.toLowerCase() === "connecting") {
        logLocalParticipant("state-poll-connecting");
      }
      if (state.toLowerCase() === "connected") {
        logLocalParticipant("state-poll-connected");
        emitConnectedOnce("state-poll-connected");
      }
    }, 400);

    return () => {
      clearInterval(statePoll);
      console.log("KRISTO_LIVEKIT_ROOM_CONNECT_LIFECYCLE_UNMOUNT", {
        roomName: bridgeId,
        finalState: roomState(),
        connectedLogged: connectedLoggedRef.current,
        expectedIdentity: String(expectedIdentity || tokenClaims()?.identity || ""),
        localParticipantIdentity: identity(),
      });
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(connectionStateChangedEvent, onConnectionStateChanged);
    };
  }, [room, roomName, expectedIdentity]);

  return null;
}

function KristoLiveKitStage({
  roomName,
  headers,
  canPublish,
  canPublishMicOverride,
  canPublishCameraOverride,
  identity,
  cameraFacing,
  micMuted,
  cameraPaused,
  style,
  fallback,
  renderLocalPreview = false,
  preferredIdentityPrefix,
}: {
  roomName: string;
  headers: any;
  canPublish: boolean;
  canPublishMicOverride?: boolean;
  canPublishCameraOverride?: boolean;
  identity: string;
  cameraFacing: "front" | "back";
  micMuted: boolean;
  cameraPaused: boolean;
  style: any;
  fallback: React.ReactNode;
  renderLocalPreview?: boolean;
  preferredIdentityPrefix?: string;
}) {

  const [tokenState, setTokenState] = useState<{ url: string; token: string } | null>(null);
  const tokenStateRef = useRef<{ url: string; token: string } | null>(null);
  const tokenFetchInFlightRef = useRef(false);
  const tokenReadyLatchRef = useRef(false);
  const stableIdentityRef = useRef("");

  const [livekitDisabled, setLivekitDisabled] = useState(false);
  const [stageMountAllowed, setStageMountAllowed] = useState(false);
  const stageMountAllowedRef = useRef(false);
  const stageInstanceIdRef = useRef(`stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [liveKitRemountNonce, setLiveKitRemountNonce] = useState(0);
  const liveKitPerfMountLoggedRef = useRef(false);

  useEffect(() => {
    if (liveKitPerfMountLoggedRef.current) return;
    liveKitPerfMountLoggedRef.current = true;
    logLivePerf("livekit_publisher_mount_start", { roomName, identity });
  }, [roomName, identity]);

  useEffect(() => {
    AudioSession.configureAudio({
      android: {
        audioTypeOptions: AndroidAudioTypePresets.communication,
      },
    }).catch((e: any) => {
      console.log("KRISTO_STAGE_AUDIO_CONFIGURE_ERROR", String(e?.message || e));
    });

    AudioSession.setDefaultRemoteAudioTrackVolume(1).catch((e: any) => {
      console.log("KRISTO_STAGE_AUDIO_VOLUME_ERROR", String(e?.message || e));
    });

    AudioSession.startAudioSession().catch((e: any) => {
      console.log("KRISTO_STAGE_AUDIO_START_ERROR", String(e?.message || e));
    });

    console.log("KRISTO_STAGE_AUDIO_SESSION_READY");
  }, []);

const headersKey = JSON.stringify(headers || {});
  const stableHeaders = useMemo(() => headers || {}, [headersKey]);

  const liveKitOptions = useMemo(() => buildLiveKitRoomOptions(), []);

  const stableConnectOptions = useMemo(() => ({
    autoSubscribe: true,
    maxRetries: 2,
    websocketTimeout: 15000,
  }), []);

  const handleLiveKitError = React.useCallback((e: any) => {
    if ((globalThis as any).__KRISTO_LIVEKIT_ERROR_LOCK__) {
      return;
    }
    (globalThis as any).__KRISTO_LIVEKIT_ERROR_LOCK__ = true;

    const message = String(e?.message || e || "");
    const roomNameForLog = String((globalThis as any).__KRISTO_LIVEKIT_ACTIVE_ROOM__ || "");
    console.log("KRISTO_LIVEKIT_ROOM_ERROR", {
      message,
      name: String(e?.name || ""),
      code: String(e?.code || ""),
      reason: String(e?.reason || ""),
      roomName: roomNameForLog,
      identity: stableIdentityRef.current,
    });
    logLiveKitRoomEvent("ROOM_ON_ERROR", {
      message,
      name: String(e?.name || ""),
      code: String(e?.code || ""),
      roomName: roomNameForLog,
      identity: stableIdentityRef.current,
    });
    logLiveKitConnectResult({
      ok: false,
      roomName: roomNameForLog,
      identity: stableIdentityRef.current,
      message,
      source: "LiveKitRoom.onError",
    });
    if (
      message.includes("429") ||
      message.toLowerCase().includes("bad response") ||
      message.toLowerCase().includes("signal connection")
    ) {
      (globalThis as any).__KRISTO_DISABLE_LIVEKIT__ = true;
      (globalThis as any).__KRISTO_LIVEKIT_COOLDOWN_UNTIL__ = Date.now() + 120000;

      setLivekitDisabled(true);
      console.log("KRISTO_LIVEKIT_DISABLED_AFTER_FATAL_ERROR");
    }
  }, []);

  const handleLiveKitRoomConnected = React.useCallback(() => {
    logLiveKitRoomEvent("ROOM_ON_CONNECTED", {
      roomName,
      identity: stableIdentityRef.current,
    });
  }, [roomName]);

  const handleLiveKitRoomDisconnected = React.useCallback(() => {
    logLiveKitRoomEvent("ROOM_ON_DISCONNECTED", {
      roomName,
      identity: stableIdentityRef.current,
    });
  }, [roomName]);

  // CRITICAL:
  // LiveKit identity MUST stay stable for the lifetime of the room.
  // Changing identity causes reconnect storms and renegotiation loops.
  const publishIdentity = String(
    stableHeaders?.["x-kristo-user-id"] ||
    stableHeaders?.["X-Kristo-User-Id"] ||
    identity ||
    "viewer"
  )
    .split("-slot-")[0]
    .split("-viewer")[0]
    .split("-mic")[0]
    .replace(/[^a-zA-Z0-9_]/g, "");

  const stableIdentity = useMemo(
    () => publishIdentity,
    [publishIdentity]
  );
  stableIdentityRef.current = stableIdentity;

  const setStageMountAllowedLogged = useCallback(
    (next: boolean, source: string, detail?: Record<string, unknown>) => {
      const prev = stageMountAllowedRef.current;
      if (prev === next) return;
      stageMountAllowedRef.current = next;
      setStageMountAllowed(next);
      logLiveKitStageMountAllowedTransition({
        prev,
        next,
        source,
        lockKey: buildLiveKitStageLockKey(roomName, stableIdentity),
        roomName,
        stableIdentity,
        detail,
      });
    },
    [roomName, stableIdentity]
  );

  const stageLockKey = buildLiveKitStageLockKey(roomName, stableIdentity);
  const stageMountSticky = isLiveKitStageMountSticky(roomName, stableIdentity);
  const hostPinnedBeforeToken = isLiveKitPublisherHostPinnedBeforeToken(roomName);
  const effectiveStageMountAllowed = stageMountAllowed || stageMountSticky;
  const effectiveStageMountAllowedRef = useRef(false);
  effectiveStageMountAllowedRef.current = effectiveStageMountAllowed;

  useLayoutEffect(() => {
    if (!canPublish || !roomName) return;
    pinLiveKitPublisherHostBeforeToken(roomName, "stage-mount-before-token", {
      stableIdentity,
    });
  }, [canPublish, roomName, stableIdentity]);

  // Account switch / identity change: drop stale JWT and remount LiveKitRoom cleanly.
  useEffect(() => {
    if (
      isLiveKitStageMountSticky(roomName, stableIdentity) ||
      isLiveKitPublisherStagePinned(roomName) ||
      isLiveKitPublisherHostPinnedBeforeToken(roomName)
    ) {
      console.log("KRISTO_LIVEKIT_TOKEN_RESET_SKIPPED", {
        roomName,
        stableIdentity,
        reason: "stage-mount-sticky-or-pinned",
      });
      return;
    }
    setTokenState(null);
    tokenStateRef.current = null;
    tokenFetchInFlightRef.current = false;
    if (!(globalThis as any).__KRISTO_DISABLE_LIVEKIT__) {
      setLivekitDisabled(false);
    }
    setLiveKitRemountNonce(0);
  }, [stableIdentity, roomName]);

  useEffect(() => {
    const g = globalThis as any;
    if (!g.__KRISTO_DISABLE_LIVEKIT__ && Number(g.__KRISTO_LIVEKIT_COOLDOWN_UNTIL__ || 0) <= Date.now()) {
      setLivekitDisabled(false);
    }
  }, [roomName, stableIdentity]);

  const identityText = String(
    publishIdentity || stableIdentity || ""
  );

  const slotMatch =
    identityText.match(/slot-(\d+)/i) ||
    identityText.match(/host-(\d+)/i);

  const claimNumber = Number(slotMatch?.[1] || 0);

  /* debug log removed for live performance */

  // Mic access must NOT force camera seat.
  // Camera seat only when camera override is true or full publish has no override.
  const seatType = resolveSeatType(
    claimNumber,
    canPublishCameraOverride === true
  );

  // Mic publishing follows camera/big-screen authority.
  // Non-current claimed slots and idle hosts must stay muted/viewer-safe.
  // Mic authority must be independent from camera authority.
  // Media host / pastor can keep speaking even after camera handoff.
  const canPublishMic =
    typeof canPublishMicOverride === "boolean"
      ? canPublishMicOverride
      : !!canPublish &&
        (seatType === "big-screen" ||
          seatType === "camera-mic" ||
          seatType === "moderator");

  const canPublishCamera =
    typeof canPublishCameraOverride === "boolean"
      ? canPublishCameraOverride
      : !!canPublish &&
        (seatType === "big-screen" ||
          seatType === "camera-mic");

  const isViewerOnly =
    !canPublishMic &&
    !canPublishCamera &&
    (seatType === "viewer" || seatType === "moderator");

  // micMuted is ONLY for the local microphone publisher.
  // Viewers must not use micMuted=true because it can affect remote audio playback.
  const effectiveMicMuted = canPublishMic ? micMuted : false;

  // Prevent the temporary viewer LiveKit mount from trying to publish
  // or fighting with the real host stage during schedule-slot hydration.
  const shouldSkipViewerMount =
    /viewer-preview/i.test(String(identity || stableIdentity || "")) ||
    (
      isViewerOnly &&
      /-(host|slot)-\d+$/i.test(String(identity || stableIdentity || ""))
    );


  useEffect(() => {
    const instanceId = stageInstanceIdRef.current;
    const acquired = acquireLiveKitStageLock({
      lockKey: stageLockKey,
      instanceId,
      roomName,
      stableIdentity,
    });

    if (acquired.allowed) {
      setStageMountAllowedLogged(true, acquired.reason, {
        instanceId,
        isPrimary: acquired.isPrimary,
      });
    } else {
      console.log("KRISTO_LIVEKIT_STAGE_DUPLICATE_BLOCKED", {
        lockKey: stageLockKey,
        instanceId,
        reason: acquired.reason,
        sticky: stageMountSticky,
      });
      setStageMountAllowedLogged(false, acquired.reason, { instanceId });
    }

    return () => {
      const lockEntry = readLiveKitStageLockEntry(stageLockKey);
      const stickyOrTokenReady =
        lockEntry?.sticky === true || lockEntry?.tokenReady === true;
      releaseLiveKitStageLock({
        lockKey: stageLockKey,
        instanceId,
        reason: stickyOrTokenReady ? "sticky-stage-cleanup" : "stage-effect-cleanup",
      });
    };
  }, [roomName, stableIdentity, stageLockKey, setStageMountAllowedLogged]);

  useEffect(() => {
    if (stageMountSticky && !stageMountAllowedRef.current) {
      setStageMountAllowedLogged(true, "sticky-hydrate", {
        instanceId: stageInstanceIdRef.current,
      });
    }
  }, [stageMountSticky, setStageMountAllowedLogged]);

  const stageUnmountLogRef = useRef({
    roomName,
    stableIdentity,
    stageLockKey,
    livekitDisabled,
    instanceId: stageInstanceIdRef.current,
  });
  stageUnmountLogRef.current = {
    roomName,
    stableIdentity,
    stageLockKey,
    livekitDisabled,
    instanceId: stageInstanceIdRef.current,
  };

  useEffect(() => {
    return () => {
      const snap = stageUnmountLogRef.current;
      const lockEntry = readLiveKitStageLockEntry(snap.stageLockKey);
      console.log("KRISTO_LIVEKIT_STAGE_UNMOUNT", {
        roomName: snap.roomName,
        identity: snap.stableIdentity,
        lockKey: snap.stageLockKey,
        hadToken: !!tokenStateRef.current?.token,
        stageMountAllowed: stageMountAllowedRef.current,
        effectiveStageMountAllowed:
          stageMountAllowedRef.current || lockEntry?.sticky === true,
        stageMountSticky: lockEntry?.sticky === true,
        livekitDisabled: snap.livekitDisabled,
        instanceId: snap.instanceId,
        parentDropReason: (globalThis as any).__KRISTO_LIVEKIT_STAGE_DROP_REASON__ || null,
        lockEntry,
      });
    };
  }, []);

  useEffect(() => {
    (globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ =
      Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0) + 1;
    (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;

    let alive = true;

    console.log("KRISTO_STAGE_AUTHORITY", {
      identity: stableIdentity,
      claimNumber,
      seatType,
      canPublishMic,
      canPublishCamera,
      isViewerOnly,
    });

    async function loadToken() {
      if (tokenStateRef.current?.token || tokenFetchInFlightRef.current) {
        return;
      }

      if (
        !stageMountAllowedRef.current &&
        !effectiveStageMountAllowedRef.current &&
        !isLiveKitStageMountSticky(roomName, stableIdentity) &&
        !isLiveKitPublisherStagePinned(roomName) &&
        !isLiveKitPublisherHostPinnedBeforeToken(roomName)
      ) {
        console.log("KRISTO_LIVEKIT_TOKEN_FETCH_SKIP", {
          roomName,
          stableIdentity,
          lockKey: stageLockKey,
          reason: "stage-not-primary",
          instanceId: stageInstanceIdRef.current,
        });
        return;
      }

      // Token publish grant is session-stable (x-kristo-live-may-publish header); runtime mic/camera must not refetch.
      const wantsPublish =
        String(stableHeaders?.["x-kristo-live-may-publish"] || "") === "1";

      tokenFetchInFlightRef.current = true;

      logLivePerf("livekit_token_fetch_start", { roomName, identity: stableIdentity, wantsPublish });

      console.log("KRISTO_LIVEKIT_PRELOAD_START", {
        roomName,
        identity: stableIdentity,
        wantsPublish,
        canPublishCamera,
        canPublishMic,
      });

      try {
        if ((globalThis as any).__KRISTO_DISABLE_LIVEKIT__ || Date.now() < Number((globalThis as any).__KRISTO_LIVEKIT_COOLDOWN_UNTIL__ || 0)) {
          setLivekitDisabled(true);
          console.log("KRISTO_LIVEKIT_TOKEN_SKIPPED_COOLDOWN");
          return;
        }
        const userKey = String(stableHeaders?.["x-kristo-user-id"] || stableHeaders?.["X-Kristo-User-Id"] || "");

        // If this same device already has a camera+mic publisher in this room,
        // do not open a second mic-only LiveKit connection.
        const activeCameraPublisherKey = String((globalThis as any).__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ || "");
        const thisPublisherKey = `${roomName}|${userKey}`;

        if (canPublishCamera) {
          (globalThis as any).__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = thisPublisherKey;
        }

        if (!canPublishCamera && wantsPublish && activeCameraPublisherKey === thisPublisherKey) {
          console.log("KRISTO_SKIP_DUPLICATE_MIC_ONLY_STAGE", {
            roomName,
            identity: stableIdentity,
            userKey,
          });
          setLivekitDisabled(true);
          return;
        }

        const tokenHeaders = wantsPublish
          ? { ...(stableHeaders || {}), "x-kristo-role": "Host" }
          : stableHeaders;

        const tokenResult = await fetchLiveKitToken({
          roomName,
          identity: stableIdentity,
          canPublish: wantsPublish,
          headers: tokenHeaders as Record<string, string>,
          source: "live-room-stage",
        });

        if (!alive) return;

        console.log("KRISTO_LIVEKIT_TOKEN_RESULT", {
          ok: !!tokenResult,
          hasUrl: !!tokenResult?.url,
          hasToken: !!tokenResult?.token,
          wantsPublish,
          canPublishProp: canPublish,
          identity: stableIdentity,
          roomName,
          apiBase: getApiBase(),
        });

        if (tokenResult?.url && tokenResult?.token) {
          const nextUrl = String(tokenResult.url);
          const nextToken = String(tokenResult.token);
          const tokenClaims = logLiveKitTokenClaims(nextToken, {
            roomName,
            stableIdentity,
            wantsPublish,
          });
          (globalThis as any).__KRISTO_LIVEKIT_ACTIVE_TOKEN_CLAIMS__ = tokenClaims;
          (globalThis as any).__KRISTO_LIVEKIT_ACTIVE_ROOM__ = roomName;
          tokenStateRef.current = { url: nextUrl, token: nextToken };
          tokenReadyLatchRef.current = true;
          markLiveRoomLiveKitConnecting(roomName);
          pinLiveKitPublisherStage(roomName, "livekit-token-ready", {
            lockKey: stageLockKey,
            stableIdentity,
          });
          pinLiveKitStageMountSticky(roomName, stableIdentity, "livekit-token-ready", stageLockKey);
          setStageMountAllowedLogged(true, "token-ready-sticky", {
            instanceId: stageInstanceIdRef.current,
          });
          console.log("KRISTO_LIVEKIT_TOKEN_READY_HOST_STILL_MOUNTED", {
            roomName,
            stableIdentity,
            hostPinnedBeforeToken: isLiveKitPublisherHostPinnedBeforeToken(roomName),
            stageMountAllowed: stageMountAllowedRef.current,
            effectiveStageMountAllowed:
              stageMountAllowedRef.current || isLiveKitStageMountSticky(roomName, stableIdentity),
          });
          logLivePerf("livekit_token_fetch_end", {
            roomName,
            identity: stableIdentity,
            ok: true,
          });
          setTokenState((prev) => {
            if (prev?.url === nextUrl && prev?.token === nextToken) return prev;
            return { url: nextUrl, token: nextToken };
          });
        } else {
          logLivePerf("livekit_token_fetch_end", {
            roomName,
            identity: stableIdentity,
            ok: false,
          });
        }
      } catch (e: any) {
        logLivePerf("livekit_token_fetch_end", {
          roomName,
          identity: stableIdentity,
          ok: false,
          message: String(e?.message || e),
        });
        console.log("KRISTO_LIVEKIT_TOKEN_ERROR", {
          message: String(e?.message || e),
          wantsPublish,
          canPublishProp: canPublish,
          identity: stableIdentity,
          roomName,
          apiBase: getApiBase(),
        });
      } finally {
        tokenFetchInFlightRef.current = false;
      }
    }

    loadToken();

    return () => {
      tokenFetchInFlightRef.current = false;
      (globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ =
        Math.max(0, Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0) - 1);
      (globalThis as any).__KRISTO_LIVE_ACTIVE__ =
        Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0) > 0;
      try {
        const userKey = String(stableHeaders?.["x-kristo-user-id"] || stableHeaders?.["X-Kristo-User-Id"] || "");
        const thisPublisherKey = `${roomName}|${userKey}`;
        if ((globalThis as any).__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ === thisPublisherKey) {
          (globalThis as any).__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = "";
        }
      } catch {}
      alive = false;
    };
  }, [roomName, stableIdentity, headersKey, canPublish]);

  const liveKitCredentials =
    tokenState?.url && tokenState?.token
      ? tokenState
      : tokenStateRef.current?.url && tokenStateRef.current?.token
        ? tokenStateRef.current
        : null;

  const isPublisherStage = canPublishMic || canPublishCamera;
  const activePublisherRoom = String((globalThis as any).__KRISTO_ACTIVE_PUBLISHER_ROOM__ || "");

  if (isPublisherStage) {
    (globalThis as any).__KRISTO_ACTIVE_PUBLISHER_ROOM__ = roomName;
  }

  const logStageEarlyReturn = (reason: string, extra?: Record<string, unknown>) => {
    console.log("KRISTO_LIVEKIT_STAGE_EARLY_RETURN", {
      reason,
      roomName,
      stableIdentity,
      lockKey: stageLockKey,
      hadToken: !!tokenState?.url && !!tokenState?.token,
      stageMountAllowed: stageMountAllowedRef.current,
      effectiveStageMountAllowed,
      stageMountSticky,
      isPublisherStage,
      shouldSkipViewerMount,
      livekitDisabled,
      ...(extra || {}),
    });
  };

  if (shouldSkipViewerMount || (!isPublisherStage && activePublisherRoom === roomName)) {
    logStageEarlyReturn("skip-viewer-or-active-publisher-room", {
      shouldSkipViewerMount,
      activePublisherRoom,
    });
    return <>{fallback}</>;
  }

  const livekitCooldownUntil = Number((globalThis as any).__KRISTO_LIVEKIT_COOLDOWN_UNTIL__ || 0);
  if (livekitDisabled || Date.now() < livekitCooldownUntil || (globalThis as any).__KRISTO_DISABLE_LIVEKIT__) {
    logStageEarlyReturn("livekit-disabled-or-cooldown", {
      livekitDisabled,
      livekitCooldownUntil,
    });
    return <>{fallback}</>;
  }

  if (!liveKitCredentials?.url || !liveKitCredentials?.token) {
    logStageEarlyReturn("awaiting-token");
    if (isLiveKitPublisherHostPinnedBeforeToken(roomName)) {
      console.log("KRISTO_LIVEKIT_TOKEN_AWAITING_STABLE_HOST", {
        roomName,
        stableIdentity,
        lockKey: stageLockKey,
        stageMountAllowed: stageMountAllowedRef.current,
        effectiveStageMountAllowed,
        hostPinnedBeforeToken: true,
      });
    }
    return <>{fallback}</>;
  }

  const keepLiveKitRoomMountedWhileConnecting =
    tokenReadyLatchRef.current ||
    isLiveRoomLiveKitConnecting(roomName) ||
    isLiveRoomLiveKitSessionActive(roomName) ||
    stageMountSticky ||
    isLiveKitPublisherStagePinned(roomName) ||
    hostPinnedBeforeToken;

  if (!effectiveStageMountAllowed && !keepLiveKitRoomMountedWhileConnecting) {
    logStageEarlyReturn("stage-mount-not-allowed");
    return <>{fallback}</>;
  }

  // IMPORTANT:
  // Keep LiveKitRoom mounted with a stable key.
  // Do NOT remount on mic/camera/viewer state changes,
  // otherwise LiveKit reconnects and republishes tracks.
  const livekitRoomKey = [
    roomName,
    stableIdentity,
  ].join("|");

  const livekitRoomReactKey = isPublisherStage
    ? livekitRoomKey
    : `${livekitRoomKey}|r${liveKitRemountNonce}`;

  console.log("KRISTO_LIVEKIT_ROOM_RENDER", {
    roomName,
    stableIdentity,
    lockKey: stageLockKey,
    livekitRoomKey,
    livekitRoomReactKey,
    remountNonce: liveKitRemountNonce,
    serverUrlHost: String(liveKitCredentials.url || "").split("?")[0].slice(0, 80),
    hasToken: !!liveKitCredentials.token,
    stageMountAllowed: stageMountAllowedRef.current,
    effectiveStageMountAllowed,
    keepLiveKitRoomMountedWhileConnecting,
    stageMountSticky,
    liveKitConnecting: isLiveRoomLiveKitConnecting(roomName),
  });

  return (
    <LiveKitRoom
      key={livekitRoomReactKey}
      serverUrl={liveKitCredentials.url}
      token={liveKitCredentials.token}
      connect={true}
      onError={handleLiveKitError}
      onConnected={handleLiveKitRoomConnected}
      onDisconnected={handleLiveKitRoomDisconnected}
      // Keep audio enabled because this is the only path currently producing remote sound.
      // TODO: remove AudioContext error separately without disabling playback.
      audio={true}
      video={false}
      connectOptions={stableConnectOptions as any}
      options={liveKitOptions as any}
    >
      <KristoLiveKitCleanupGuard />
      <KristoLiveKitConnectionLifecycle roomName={roomName} expectedIdentity={stableIdentity} />
      <RoomAudioRenderer
        roomName={roomName}
        currentUserId={String(
          stableHeaders?.["x-kristo-user-id"] ||
            stableHeaders?.["X-Kristo-User-Id"] ||
            ""
        ).trim()}
        isPublisherStage={!!canPublish || canPublishMic}
        canUseLiveMic={canPublishMic}
      />
      <KristoViewerJoinRetryWatch
        enabled={!canPublish}
        roomName={roomName}
        identity={stableIdentity}
        remountNonce={liveKitRemountNonce}
        onRetry={() => setLiveKitRemountNonce((n) => (n > 0 ? n : 1))}
      />
      <KristoRemoteOrLocalVideo
        // Child mic sync must not re-open mic when UI state is muted.
        // Only current big-screen speaker can have active mic.
        // Claimed seats and idle hosts stay muted by default.
        // Permission to own a mic track.
        // Mic state controlled manually via mediaStreamTrack.enabled.
        // Keep engine stable after connect.
        // Authority changes should only affect track.enabled.
        canPublishMic={canPublishMic}
        canPublishCamera={canPublishCamera}
        renderLocalPreview={renderLocalPreview}
        cameraFacing={cameraFacing}
        micMuted={effectiveMicMuted}
        cameraPaused={cameraPaused}
        style={style}
        fallback={fallback}
        preferredIdentityPrefix={preferredIdentityPrefix}
      />
    </LiveKitRoom>
  );
}




function KristoViewerJoinRetryWatch({
  enabled,
  roomName,
  identity,
  remountNonce,
  onRetry,
}: {
  enabled: boolean;
  roomName: string;
  identity: string;
  remountNonce: number;
  onRetry: () => void;
}) {
  const room = useRoomContext();

  useEffect(() => {
    if (!enabled || !room || remountNonce > 0) return;

    const retryKey = `${roomName}|${identity || "viewer"}`;
    const retryKeys =
      ((globalThis as any).__KRISTO_VIEWER_JOIN_RETRY_KEYS__ as Set<string>) ||
      new Set<string>();

    (globalThis as any).__KRISTO_VIEWER_JOIN_RETRY_KEYS__ = retryKeys;

    if (retryKeys.has(retryKey)) {
      console.log("KRISTO_VIEWER_JOIN_RETRY_SKIPPED", { retryKey, reason: "already_used" });
      return;
    }

    let alive = true;
    let connected = false;
    let hasRemoteAudio = false;
    let disconnectedBeforeReady = false;

    const hasUsableRemoteAudio = () => {
      try {
        if (!room?.remoteParticipants) return false;
        for (const participant of Array.from(room.remoteParticipants.values()) as any[]) {
          const pubs = Array.from(participant?.trackPublications?.values?.() || []) as any[];
          for (const pub of pubs) {
            const track = pub?.track;
            const kind = String(pub?.kind || track?.kind || "").toLowerCase();
            if (kind === "audio" && (pub?.isSubscribed || track) && track?.mediaStreamTrack) {
              return true;
            }
          }
        }
      } catch {}
      return false;
    };

    const markReadyIfAudio = () => {
      if (hasUsableRemoteAudio()) {
        hasRemoteAudio = true;
        console.log("KRISTO_VIEWER_JOIN_READY", {
          retryKey,
          remoteCount: room.remoteParticipants?.size || 0,
          hasRemoteAudio: true,
        });
      }
    };

    const onConnected = () => {
      connected = true;
      markReadyIfAudio();
    };

    const onDisconnected = () => {
      if (!hasRemoteAudio) disconnectedBeforeReady = true;
    };

    const onTrackSubscribed = (track: any) => {
      if (String(track?.kind || "").toLowerCase() === "audio") {
        hasRemoteAudio = true;
        try {
          track?.setVolume?.(1);
          if (track?.mediaStreamTrack) track.mediaStreamTrack.enabled = true;
        } catch {}
        console.log("KRISTO_VIEWER_JOIN_READY", {
          retryKey,
          remoteCount: room.remoteParticipants?.size || 0,
          hasRemoteAudio: true,
        });
      }
    };

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);

    console.log("KRISTO_VIEWER_JOIN_WATCH_START", { retryKey, roomName });

    const t = setTimeout(() => {
      if (!alive) return;

      markReadyIfAudio();

      const remoteCount = room.remoteParticipants?.size || 0;
      const ready = hasRemoteAudio || hasUsableRemoteAudio();

      if (ready) {
        console.log("KRISTO_VIEWER_JOIN_RETRY_SKIPPED", { retryKey, reason: "ready", remoteCount });
        return;
      }

      if ((globalThis as any).__KRISTO_DISABLE_LIVEKIT__) {
        console.log("KRISTO_VIEWER_JOIN_RETRY_SKIPPED", { retryKey, reason: "disabled" });
        return;
      }

      const reason = disconnectedBeforeReady
        ? "disconnected_before_ready"
        : connected
          ? (remoteCount <= 0 ? "no_remote_participants" : "no_remote_audio")
          : "not_connected";

      retryKeys.add(retryKey);
      console.log("KRISTO_VIEWER_JOIN_NOT_READY", { retryKey, reason, remoteCount, connected });
      console.log("KRISTO_VIEWER_JOIN_RETRY_ONCE", { retryKey, remountNonce: 1 });
      onRetry();
    }, 8000);

    return () => {
      alive = false;
      clearTimeout(t);
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    };
  }, [enabled, room, roomName, identity, remountNonce, onRetry]);

  return null;
}


function KristoLiveKitCleanupGuard() {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    (globalThis as any).__KRISTO_HELD_LIVEKIT_ROOM__ = room;

    return () => {
      const held = (globalThis as any).__KRISTO_HELD_LIVEKIT_ROOM__;
      if (held === room) {
        (globalThis as any).__KRISTO_HELD_LIVEKIT_ROOM__ = undefined;
      }
    };
  }, [room]);

  return null;
}


function KristoRemoteRoomVideo({
  style,
  fallback,
  preferredIdentityPrefix,
}: {
  style: any;
  fallback: React.ReactNode;
  preferredIdentityPrefix?: string;
}) {
  const room = useRoomContext();
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<any>(null);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState<any>(null);
  const [remoteAvStreamURL, setRemoteAvStreamURL] = useState<string>("");
  const [remoteAudioStreamURL, setRemoteAudioStreamURL] = useState<string>("");
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState<string>("");

  useEffect(() => {
    try {
      const videoTrack: any = remoteVideoTrack?.mediaStreamTrack;

      if (!videoTrack) return;

      const stream = new MediaStream();
      videoTrack.enabled = true;
      stream.addTrack(videoTrack as any);

      const audioTrack: any = remoteAudioTrack?.mediaStreamTrack;
      if (audioTrack) {
        audioTrack.enabled = true;
        stream.addTrack(audioTrack as any);
      }

      const url = stream.toURL();

      console.log("KRISTO_REMOTE_COMBINED_AV_STREAM_READY", {
        hasURL: !!url,
        hasVideo: !!videoTrack,
        hasAudio: !!remoteAudioTrack?.mediaStreamTrack,
        videoReadyState: videoTrack?.readyState,
        audioReadyState: remoteAudioTrack?.mediaStreamTrack?.readyState,
      });

      setRemoteAvStreamURL(url);
    } catch (e: any) {
      console.log("KRISTO_REMOTE_COMBINED_AV_STREAM_ERROR", String(e?.message || e));
    }
  }, [remoteVideoTrack, remoteAudioTrack]);

  useEffect(() => {
    if (!room) return;

    const onTrackSubscribed = async (track: any, publication: any, participant: any) => {
      const kind = String(track?.kind || "").toLowerCase();

      console.log("KRISTO_TRACK_SUBSCRIBED_DIRECT", {
        identity: String(participant?.identity || ""),
        kind,
        source: String(publication?.source || ""),
        trackSid: String(publication?.trackSid || publication?.sid || ""),
        hasMediaStreamTrack: !!track?.mediaStreamTrack,
      });

      if (kind === "audio") {
        setRemoteAudioTrack(track);
        return;
      }

      if (kind === "video") {
        if (track?.mediaStreamTrack) track.mediaStreamTrack.enabled = true;
        setRemoteVideoTrack(track);
      }
    };

    const pick = (preferredIdentity?: string) => {
      const participants = Array.from(room.remoteParticipants.values()) as any[];

      console.log("KRISTO_REMOTE_PARTICIPANTS", {
        count: participants.length,
        identities: participants.map((p: any) => ({
          identity: String(p?.identity || ""),
          tracks: Array.from(p?.trackPublications?.values?.() || []).map((t: any) => ({
            kind: String(t?.kind || t?.track?.kind || ""),
            subscribed: t?.isSubscribed,
            hasTrack: !!t?.track,
            source: String(t?.source || ""),
          })),
        })),
      });

      const preferred = String(preferredIdentityPrefix || preferredIdentity || activeSpeakerIdentity || "").trim();

      const matchesPreferred = (p: any) => {
        const id = String(p?.identity || "");
        if (!preferred) return false;
        if (preferred.startsWith("slot:")) {
          const n = preferred.replace("slot:", "").trim();
          return !!n && id.includes(`-slot-${n}`);
        }
        return id.startsWith(preferred);
      };

      const orderedParticipants = preferred
        ? [
            ...participants.filter((p: any) => matchesPreferred(p)),
            ...participants.filter((p: any) => !matchesPreferred(p)),
          ]
        : participants;

      let pickedVideo = false;

      orderedParticipants.forEach((p: any) => {
        /* debug log removed for live performance */

        const pubs = Array.from(p?.trackPublications?.values?.() || []).filter(Boolean);

        pubs.forEach((pub: any) => {
          try {
            if (typeof pub?.setSubscribed === "function") {
              pub.setSubscribed(true);
            }

            const track =
              pub?.track ||
              pub?.videoTrack ||
              pub?.audioTrack ||
              pub?.publication?.track ||
              pub?.trackPublication?.track ||
              null;

            /* debug log removed for live performance */

            if (!track) return;

            if (String(track.kind).toLowerCase() === "video") {
              track.mediaStreamTrack.enabled = true;

              if (!pickedVideo) {
                pickedVideo = true;
                setRemoteVideoTrack(track);
                /* debug log removed for live performance */
              }
            }

            if (String(track.kind).toLowerCase() === "audio") {
              setRemoteAudioTrack(track);
            }
          } catch (e) {
            console.log("KRISTO_REMOTE_PICK_ERROR", e);
          }
        });
      });
    };

    const onActiveSpeakersChanged = (speakers: any[]) => {
      const nextIdentity = String(speakers?.[0]?.identity || "").trim();

      /* debug log removed for live performance */

      if (nextIdentity) {
        setActiveSpeakerIdentity(nextIdentity);
        pick(nextIdentity);
      }
    };

    pick();

    const repick = () => {
      setRemoteVideoTrack(null);
      pick();
    };

    room
      .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
      .on(RoomEvent.TrackPublished, repick)
      .on(RoomEvent.TrackUnsubscribed, repick)
      .on(RoomEvent.ParticipantConnected, repick)
      .on(RoomEvent.ParticipantDisconnected, repick)
      .on(RoomEvent.Reconnected, repick)
      .on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);

    return () => {
      room
        .off(RoomEvent.TrackSubscribed, onTrackSubscribed)
        .off(RoomEvent.TrackPublished, repick)
        .off(RoomEvent.TrackUnsubscribed, repick)
        .off(RoomEvent.ParticipantConnected, repick)
        .off(RoomEvent.ParticipantDisconnected, repick)
        .off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    };
  }, [room]);

  const localVideoTrack =
    false
      ? (
        room?.localParticipant?.videoTrackPublications?.values?.()?.next?.()?.value?.videoTrack ||
        room?.localParticipant?.videoTrackPublications?.values?.()?.next?.()?.value?.track ||
        null
      )
      : null;

  const localMediaTrack =
    localVideoTrack?.mediaStreamTrack || null;

  const localStreamURL = (() => {
    try {
      if (!localMediaTrack) return "";
      localMediaTrack.enabled = true;

      const stream = new MediaStream();
      stream.addTrack(localMediaTrack as any);

      return stream.toURL();
    } catch {
      return "";
    }
  })();

  const finalURL = remoteAvStreamURL || localStreamURL;

  if (!finalURL) return <>{fallback}</>;

  return (
    <View style={[style, { overflow: "hidden", backgroundColor: "#000" }]}>

      {finalURL ? (
        <RTCView
          key={`live-av-${finalURL}`}
          streamURL={finalURL}
          style={({ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%", backgroundColor: "#000" } as any)}
          objectFit={"cover" as any}
          zOrder={999}
          mirror={!!localStreamURL && !remoteAvStreamURL}
        />
      ) : null}
    </View>
  );
}

function KristoRemoteOrLocalVideo({
  canPublishMic,
  canPublishCamera,
  renderLocalPreview = false,
  preferredIdentityPrefix,
  cameraFacing,
  micMuted,
  cameraPaused,
  style,
  fallback,
}: {
  canPublishMic: boolean;
  canPublishCamera: boolean;
  renderLocalPreview?: boolean;
  preferredIdentityPrefix?: string;
  cameraFacing: "front" | "back";
  micMuted: boolean;
  cameraPaused: boolean;
  style: any;
  fallback: React.ReactNode;
}) {
  const room = useRoomContext();

  useEffect(() => {
    (globalThis as any).__KRISTO_SET_LOCAL_MIC_MUTED__ = async (muted: boolean) => {
      try {
        const lp: any = room?.localParticipant;
        if (!lp) return false;

        const pub =
          lp?.getTrackPublication?.(Track.Source.Microphone) ||
          Array.from(lp?.trackPublications?.values?.() || []).find((x: any) =>
            String(x?.source || "").toLowerCase().includes("microphone")
          );

        const track: any = pub?.track || pub?.audioTrack || null;

        if (track?.mediaStreamTrack) {
          track.mediaStreamTrack.enabled = !muted;
        }

        // Do not call LiveKit mute/unmute here.
        // It renegotiates/unpublishes on iOS and causes audio loss.

        publishKristoActualMicEnabled(!muted);

        console.log("KRISTO_BUTTON_REAL_MIC_SET", {
          muted,
          enabled: track?.mediaStreamTrack?.enabled,
          hasPub: !!pub,
          hasTrack: !!track,
        });

        return true;
      } catch (e: any) {
        console.log("KRISTO_BUTTON_REAL_MIC_SET_ERROR", String(e?.message || e));
        return false;
      }
    };

    return () => {
      try {
        if ((globalThis as any).__KRISTO_SET_LOCAL_MIC_MUTED__) {
          delete (globalThis as any).__KRISTO_SET_LOCAL_MIC_MUTED__;
        }
      } catch {}
    };
  }, [room]);

  // Disabled duplicate mic sync effect.
  // Manual audio publish + mic button setter are now the only mic authority.

  const [localVideoTrack, setLocalVideoTrack] = useState<any>(null);

  
  const [localPreviewURL, setLocalPreviewURL] = useState<string>("");
const [actualMicEnabled, setActualMicEnabled] = useState<boolean>(false);
  const localVideoTrackRef = useRef<any>(null);
  const videoFacingRef = useRef<"front" | "back" | "">("");
  const videoPublishBusyRef = useRef(false);
  const firstFrameLoggedRef = useRef(false);
  useEffect(() => {
    return () => {
      // Soft cleanup only.
      // LiveKitRoom owns unpublish/disconnect on unmount.
      // Manual unpublishTrack here causes createOffer/closed peer connection on iOS back.
      try { localVideoTrackRef.current = null; } catch {}
      setLocalVideoTrack(null);
      
      // Keep audio session alive during LiveKit remounts.
      // AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);


  const wantsLocalStage = renderLocalPreview || canPublishCamera;

  useEffect(() => {
    if (!room || !wantsLocalStage) return;

    const syncLocalCamera = () => {
      try {
        const pub =
          (room as any)?.localParticipant?.getTrackPublication?.(Track.Source.Camera) ||
          Array.from((room as any)?.localParticipant?.trackPublications?.values?.() || []).find((x: any) =>
            String(x?.source || "").toLowerCase().includes("camera")
          );

        const track: any = pub?.track || pub?.videoTrack || null;

        if (track && localVideoTrackRef.current !== track) {
          localVideoTrackRef.current = track;
          setLocalVideoTrack(track);
          console.log("KRISTO_LOCAL_PREVIEW_TRACK_READY");
        }
      } catch {}
    };

    syncLocalCamera();

    room.on(RoomEvent.LocalTrackPublished, syncLocalCamera);
    room.on(RoomEvent.Connected, syncLocalCamera);

    let t: any = setInterval(() => {
      syncLocalCamera();

      if (localVideoTrackRef.current) {
        clearInterval(t);
        t = null;
      }
    }, 120);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, syncLocalCamera);
      room.off(RoomEvent.Connected, syncLocalCamera);

      if (t) {
        clearInterval(t);
      }
    };
  }, [room, wantsLocalStage]);

  
  useEffect(() => {
    if (!room || !canPublishMic) return;

    let cancelled = false;
    let localAudioTrack: any = null;

    const enableMicWhenConnected = async () => {
      try {
        const state = String((room as any)?.state || "");
        const identity = String((room as any)?.localParticipant?.identity || "");

        console.log("KRISTO_MANUAL_AUDIO_WAIT", { state, identity, micMuted });

        if (state !== "connected" || !identity) return;

        const existingMicPub =
          (room as any)?.localParticipant?.getTrackPublication?.(Track.Source.Microphone) ||
          Array.from((room as any)?.localParticipant?.trackPublications?.values?.() || []).find((pub: any) =>
            String(pub?.source || "").toLowerCase().includes("microphone")
          );

        if (existingMicPub?.track || existingMicPub?.audioTrack) {
          const track: any = existingMicPub.track || existingMicPub.audioTrack;
          if (track?.mediaStreamTrack) track.mediaStreamTrack.enabled = !micMuted;

          // Keep published track stable; only toggle the native media track.
          console.log("KRISTO_MANUAL_AUDIO_EXISTING_SYNC", {
            micMuted,
            enabled: track?.mediaStreamTrack?.enabled,
          });
          return;
        }

        localAudioTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as any);

        if (cancelled) return;

        if ((localAudioTrack as any)?.mediaStreamTrack) {
          (localAudioTrack as any).mediaStreamTrack.enabled = !micMuted;
        }

        // Do not call localAudioTrack.mute/unmute before publish.
        // mediaStreamTrack.enabled is the single source of truth.

        await room.localParticipant.publishTrack(localAudioTrack as any, {
          source: Track.Source.Microphone,
          name: "microphone",
        } as any);

        console.log("KRISTO_MANUAL_AUDIO_PUBLISH_DONE", {
          micMuted,
          enabled: (localAudioTrack as any)?.mediaStreamTrack?.enabled,
        });
      } catch (e: any) {
        console.log("KRISTO_MANUAL_AUDIO_ERROR", { message: String(e?.message || e) });
      }
    };

    if (String((room as any)?.state || "") === "connected") {
      enableMicWhenConnected();
    } else {
      room.on(RoomEvent.Connected, enableMicWhenConnected);
    }

    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, enableMicWhenConnected);
      try { localAudioTrack?.stop?.(); } catch {}
    };
  }, [room, canPublishMic, micMuted]);


  useEffect(() => {
    // Disabled duplicate mic mute effect.
    // syncMic above is the single source of truth for mic on/off.
    // This prevents big-screen mic from opening and then being forced off again.
    return;
  }, [room, canPublishMic, micMuted]);

  useEffect(() => {
    try {
      const existingCameraPub =
        (room as any)?.localParticipant?.getTrackPublication?.(Track.Source.Camera) ||
        Array.from((room as any)?.localParticipant?.trackPublications?.values?.() || []).find((pub: any) =>
          String(pub?.source || "").toLowerCase().includes("camera")
        );
      (globalThis as any).__KRISTO_LIVE_CAMERA_FLIP_STATE__ = {
        hasLocalTrack: !!localVideoTrackRef.current,
        isPublishing: !!existingCameraPub?.track || !!existingCameraPub?.videoTrack,
      };
    } catch {}
  }, [room, localVideoTrack, canPublishCamera]);

  useEffect(() => {
    if (!room || !canPublishCamera) {
      if (room && !canPublishCamera) {
        console.log("KRISTO_CAMERA_PUBLISH_BLOCKED", {
          source: "livekit-local-video-effect",
          canPublishCamera,
          renderLocalPreview,
        });
      }
      return;
    }

    let cancelled = false;
    let localTrack: any = null;

    const enableCameraWhenConnected = async () => {
      const state = String((room as any)?.state || "");
      const identity = String((room as any)?.localParticipant?.identity || "");

      console.log("KRISTO_MANUAL_PUBLISH_WAIT", { state, identity, cameraFacing, cameraPaused });
      console.log("KRISTO_CAMERA_PERMISSION_SOURCE", {
        enabled: true,
        source: "livekit-publish-track",
        renderLocalPreview,
        canPublishCamera,
      });

      if (state !== "connected" || !identity) return;
      if (videoPublishBusyRef.current) return;

      videoPublishBusyRef.current = true;

      const fromFacing = videoFacingRef.current || "";
      const isFlip = fromFacing === "front" || fromFacing === "back";
      let isPublishing = false;

      try {
        const existingCameraPub =
          (room as any)?.localParticipant?.getTrackPublication?.(Track.Source.Camera) ||
          Array.from((room as any)?.localParticipant?.trackPublications?.values?.() || []).find((pub: any) =>
            String(pub?.source || "").toLowerCase().includes("camera")
          );

        const existingTrack: any =
          localVideoTrackRef.current ||
          existingCameraPub?.track ||
          existingCameraPub?.videoTrack ||
          null;

        isPublishing = !!existingCameraPub?.track || !!existingCameraPub?.videoTrack;

        if (existingTrack && videoFacingRef.current === cameraFacing) {
          setLocalVideoTrack(existingTrack);
          return;
        }

        if (existingTrack) {
          try {
            await room.localParticipant.unpublishTrack(existingTrack as any).catch(() => {});
          } catch {}
          try { existingTrack.stop?.(); } catch {}
          localVideoTrackRef.current = null;
          setLocalVideoTrack(null);
        }

        localTrack = await (async () => {
          const capture = resolveLiveKitVideoCaptureOptions();
          logCameraTrackCreateStart({
            cameraFacing,
            tier: capture.tier,
            width: capture.resolution.width,
            height: capture.resolution.height,
            frameRate: capture.resolution.frameRate,
          });
          try {
            const track = await createLocalVideoTrack({
              facingMode: cameraFacing === "front" ? "user" : "environment",
              resolution: capture.resolution,
            } as any);
            logCameraTrackCreateResult({
              ok: true,
              cameraFacing,
              tier: capture.tier,
              width: capture.resolution.width,
              height: capture.resolution.height,
            });
            return track;
          } catch (e: any) {
            logCameraTrackCreateResult({
              ok: false,
              cameraFacing,
              message: String(e?.message || e),
            });
            throw e;
          }
        })();

        if (cancelled) {
          try { localTrack?.stop?.(); } catch {}
          return;
        }

        logCameraPublishStart({
          cameraFacing,
          tier: resolveLiveKitVideoCaptureOptions().tier,
        });

        await room.localParticipant.publishTrack(localTrack as any, {
          source: Track.Source.Camera,
          name: "camera",
          simulcast: true,
          videoCodec: "h264",
        } as any);

        logCameraPublishResult({
          ok: true,
          cameraFacing,
        });
        markClaimEnterCameraPublished(
          String((globalThis as any).__KRISTO_LIVEKIT_ACTIVE_ROOM__ || "")
        );

        localVideoTrackRef.current = localTrack;
        videoFacingRef.current = cameraFacing;
        setLocalVideoTrack(localTrack);

        console.log("KRISTO_MANUAL_PUBLISH_TRACK_DONE", { cameraFacing });

        if (isFlip && fromFacing !== cameraFacing) {
          console.log("KRISTO_LIVE_CAMERA_FLIP_SUCCESS", {
            fromFacing,
            toFacing: cameraFacing,
            hasLocalTrack: !!localTrack,
            isPublishing: true,
          });
        }
      } catch (e: any) {
        const error = String(e?.message || e);
        logCameraPublishResult({
          ok: false,
          cameraFacing,
          message: error,
        });
        console.log("KRISTO_MANUAL_CAMERA_ERROR", {
          cameraFacing,
          message: error,
        });
        if (isFlip && fromFacing !== cameraFacing) {
          console.log("KRISTO_LIVE_CAMERA_FLIP_FAILED", {
            fromFacing,
            toFacing: cameraFacing,
            hasLocalTrack: !!localVideoTrackRef.current,
            isPublishing,
            error,
          });
        }
      } finally {
        videoPublishBusyRef.current = false;
      }
    };

    enableCameraWhenConnected();
    room.on(RoomEvent.Connected, enableCameraWhenConnected);

    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, enableCameraWhenConnected);
      videoPublishBusyRef.current = false;
    };
  }, [room, canPublishCamera, cameraFacing]);


  useEffect(() => {
    if (!localVideoTrack) return;
    if (cameraPaused) {
          // removed: do not call LiveKit mute() on unpublished track
      if (localVideoTrack.mediaStreamTrack) localVideoTrack.mediaStreamTrack.enabled = false;
    } else {
          // removed: do not call LiveKit unmute() on unpublished track
      if (localVideoTrack.mediaStreamTrack) localVideoTrack.mediaStreamTrack.enabled = true;
    }
  }, [localVideoTrack, cameraPaused]);

  useEffect(() => {
    if (!localVideoTrack || cameraPaused) {
      setLocalPreviewURL("");
      return;
    }

    try {
      const mediaTrack = (localVideoTrack as any)?.mediaStreamTrack;
      if (!mediaTrack) {
        setLocalPreviewURL("");
        return;
      }

      mediaTrack.enabled = true;
      const stream = new MediaStream();
      stream.addTrack(mediaTrack as any);
      const url = stream.toURL();

      console.log("KRISTO_LOCAL_PREVIEW_URL_READY", {
        hasUrl: !!url,
        readyState: mediaTrack.readyState,
        enabled: mediaTrack.enabled,
      });

      setLocalPreviewURL(url);
      if (!firstFrameLoggedRef.current) {
        firstFrameLoggedRef.current = true;
        const capture = resolveLiveKitVideoCaptureOptions();
        logLiveFirstFrameRendered({
          cameraFacing,
          tier: capture.tier,
          width: capture.resolution.width,
          height: capture.resolution.height,
        });
      }
    } catch (e: any) {
      console.log("KRISTO_LOCAL_PREVIEW_URL_ERROR", { message: String(e?.message || e) });
      setLocalPreviewURL("");
    }
  }, [localVideoTrack, cameraPaused]);

  const shouldShowLocalPreview =
    wantsLocalStage && !!localPreviewURL && !cameraPaused;

  if (shouldShowLocalPreview) {
    console.log("KRISTO_BIG_STAGE_LOCAL_PREVIEW", {
      renderLocalPreview,
      canPublishCamera,
      hasUrl: !!localPreviewURL,
    });
    console.log("KRISTO_LIVEKIT_PREVIEW_READY", {
      hasUrl: !!localPreviewURL,
      cameraFacing,
    });
    return (
      <View style={[style, { overflow: "hidden", backgroundColor: "#000" }]}>
        <RTCView
          key={`local-preview-${cameraFacing}-${localPreviewURL}`}
          streamURL={localPreviewURL}
          style={({ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%", backgroundColor: "#000" } as any)}
          mirror={cameraFacing === "front"}
          objectFit={"cover" as any}
          zOrder={999}
        />
      </View>
    );
  }

  if (wantsLocalStage) {
    console.log("KRISTO_LIVE_BLACKSCREEN_GUARD", {
      hasUrl: !!localPreviewURL,
      cameraPaused,
      renderLocalPreview,
      canPublishCamera,
    });
    return <>{fallback}</>;
  }

  return (
    <View style={style}>
      <KristoRemoteRoomVideo
        style={{ width: "100%", height: "100%" }}
        fallback={fallback}
        preferredIdentityPrefix={preferredIdentityPrefix}
      />

    </View>
  );
}



export default function LiveRoomScreen() {
  const [cameraPaused, setCameraPaused] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [liveKitAccountEpoch, setLiveKitAccountEpoch] = useState(0);
  const prevSessionUserIdRef = useRef("");
  const liveRoomMountAtRef = useRef(0);
  const liveRoomBootstrapAtRef = useRef(0);
  const liveRoomReadyLoggedRef = useRef(false);
  const livePerfFirstRenderLoggedRef = useRef(false);
  const livePerfInteractLoggedRef = useRef(false);
  const livePerfScheduleMergeLoggedRef = useRef(false);
  const liveFastAuthInitialLoggedRef = useRef(false);
  const liveFastAuthResolutionLoggedRef = useRef(false);
  const liveRoomGuardStateRef = useRef<Record<string, unknown>>({});
  const liveKitPublisherStageStickyRef = useRef(false);
  const prevShouldMountLiveKitRef = useRef<boolean | null>(null);
  const prevPublisherHostActiveRef = useRef(false);

  if (!liveRoomMountAtRef.current) {
    liveRoomMountAtRef.current = Date.now();
    (globalThis as any).__KRISTO_LIVE_ROOM_PERF_MOUNT_AT__ = liveRoomMountAtRef.current;
  }
  const [livePerfPermissionsDone, setLivePerfPermissionsDone] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const waveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(waveAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(waveAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);
  const params = useLocalSearchParams<{
    title?: string;
    role?: string;
    layout?: string;
    pinnedGuestId?: string;
    membersCount?: string;
    leadersCount?: string;
    projectId?: string;
    assignmentId?: string;
    preview?: string;
    entryMode?: string;
    source?: string;
    liveMode?: string;
    liveId?: string;
    mediaName?: string;
    audienceRequests?: string;
    room?: string;
    pastorUserId?: string;
    churchName?: string;
    churchLabel?: string;
    churchId?: string;
    claimedByName?: string;
    liveAllScheduleSlotsJson?: string;
    feedId?: string;
    sourceScheduleId?: string;
    localScheduleId?: string;
    canPublish?: string;
  }>();

  const liveRouteChurchId = String((params as any)?.churchId || session?.churchId || "").trim();
  const routePublisherEligibleEarly =
    String((params as any)?.canPublish || "") === "1" ||
    String((params as any)?.canPublishCamera || "") === "1" ||
    String((params as any)?.mediaSlotPublisher || "") === "1";
  const routeClaimedByUserIdEarly = String((params as any)?.claimedByUserId || "").trim();
  const liveBridgeIdFromRoute = String(
    params.liveId ||
      (params as any)?.feedId ||
      (params as any)?.sourceScheduleId ||
      ""
  ).trim();

  useLayoutEffect(() => {
    if (!liveBridgeIdFromRoute) return;
    pinClaimEnterSessionLockFromRoute({
      liveBridgeId: liveBridgeIdFromRoute,
      routeParams: params as Record<string, unknown>,
      source: "live-room-mount",
    });
  }, [liveBridgeIdFromRoute, (params as any)?.claimedByUserId, (params as any)?.canPublishCamera, (params as any)?.canPublishMic, (params as any)?.mediaSlotPublisher]);
  const [liveKitHostLocked, setLiveKitHostLocked] = useState(
    () => routePublisherEligibleEarly && !!routeClaimedByUserIdEarly
  );
  const [churchSubscriptionActive, setChurchSubscriptionActive] = useState<boolean | null>(() => {
    const uid = String(session?.userId || "").trim();
    if (
      routePublisherEligibleEarly &&
      uid &&
      routeClaimedByUserIdEarly &&
      routeClaimedByUserIdEarly === uid
    ) {
      return true;
    }
    return null;
  });

  useEffect(() => {
    if (!liveRouteChurchId) {
      setChurchSubscriptionActive(null);
      return;
    }

    let alive = true;
    void fetchChurchSubscriptionActive(
      liveRouteChurchId,
      getKristoHeaders({
        ...(session || {}),
        churchId: liveRouteChurchId,
      } as any)
    ).then((active) => {
      if (!alive) return;
      const uid = String(session?.userId || "").trim();
      const isClaimedActiveSlotSpeaker =
        routePublisherEligibleEarly &&
        !!routeClaimedByUserIdEarly &&
        routeClaimedByUserIdEarly === uid;

      if (isClaimedActiveSlotSpeaker && active === false) {
        console.log("KRISTO_LIVE_ROOM_SUBSCRIPTION_GATE_BYPASS", {
          liveRouteChurchId,
          viewerUserId: uid,
          reason: "claimed-active-slot-speaker-not-media-studio",
          routeCanPublishCamera: String((params as any)?.canPublishCamera || ""),
          note: "Target church media tools may be locked; schedule slot publish still allowed.",
        });
        setChurchSubscriptionActive(null);
        return;
      }

      console.log("KRISTO_LIVE_ROOM_TARGET_CHURCH_MEDIA_CHECK", {
        liveRouteChurchId,
        viewerUserId: uid,
        churchSubscriptionActive: active,
        isClaimedActiveSlotSpeaker,
        routeCanPublishCamera: String((params as any)?.canPublishCamera || ""),
      });
      setChurchSubscriptionActive(active);
    });

    return () => {
      alive = false;
    };
  }, [liveRouteChurchId, session?.userId, session?.role, (session as any)?.churchRole]);

  const routeIsMinistryLive = useMemo(
    () =>
      String((params as any).room || "").toLowerCase() === "ministry" ||
      String((params as any).mediaScope || "").toLowerCase() === "ministry" ||
      String((params as any).roomKind || "").toLowerCase().includes("ministry") ||
      String((params as any).source || "").toLowerCase().includes("ministry-live"),
    [params]
  );

  const ministryAssignmentThreadId = useMemo(
    () =>
      String(
        (params as any).assignmentId ||
          (params as any).roomId ||
          (params as any).sourceRoomId ||
          ""
      ).trim(),
    [params]
  );

  const [ministrySlotHydrationTick, setMinistrySlotHydrationTick] = useState(0);
  const ministryMessagesSigRef = useRef("");

  useEffect(() => {
    if (!routeIsMinistryLive || !ministryAssignmentThreadId) return;

    return subscribeMessages(() => {
      const snap = getSnapshot();
      const arr = Array.isArray(snap.messages?.[ministryAssignmentThreadId])
        ? snap.messages[ministryAssignmentThreadId]
        : [];
      const sig = messagesListSignature(arr);
      if (sig === ministryMessagesSigRef.current) return;
      ministryMessagesSigRef.current = sig;
      setMinistrySlotHydrationTick((v) => v + 1);
    });
  }, [routeIsMinistryLive, ministryAssignmentThreadId]);

  const initialRouteScheduleSlots = useMemo(() => {
    const fromRoute = parseLiveAllScheduleSlotsJson((params as any).liveAllScheduleSlotsJson);
    if (fromRoute.length) return fromRoute;

    if (!routeIsMinistryLive || !ministryAssignmentThreadId) return [];

    const snap = getSnapshot();
    const arr = Array.isArray(snap.messages?.[ministryAssignmentThreadId])
      ? snap.messages[ministryAssignmentThreadId]
      : [];
    const cards = extractAssignmentScheduleCards(arr);
    const slots = assignmentCardsToLiveScheduleSlots(cards);
    const normalized = normalizeLiveScheduleSlots(slots);

    if (normalized.length) {
      console.log("KRISTO_MINISTRY_LIVE_ROUTE_HYDRATE", {
        threadId: ministryAssignmentThreadId,
        slotCount: normalized.length,
        source: "message-store",
      });
    }

    return normalized;
  }, [
    (params as any).liveAllScheduleSlotsJson,
    routeIsMinistryLive,
    ministryAssignmentThreadId,
    ministrySlotHydrationTick,
  ]);

  useEffect(() => {
    return () => {
      logLiveRoomUnmountReason("live-room-screen-unmount", {
        pathname,
        routeParams: {
          feedId: String((params as any)?.feedId || ""),
          liveId: String((params as any)?.liveId || ""),
          churchId: String((params as any)?.churchId || ""),
          claimedByUserId: String((params as any)?.claimedByUserId || ""),
          canPublishCamera: String((params as any)?.canPublishCamera || ""),
          entryMode: String((params as any)?.entryMode || ""),
        },
        lastGuardState: liveRoomGuardStateRef.current,
      });
      resumeHomeFeedAfterLiveExit();
      markHomeFeedVideoNeedsRecovery("live-room-exit");
    };
  }, [pathname]);

  useLayoutEffect(() => {
    if (livePerfFirstRenderLoggedRef.current) return;
    livePerfFirstRenderLoggedRef.current = true;
    logLivePerf("first_render");
  }, []);

  useEffect(() => {
    liveRoomReadyLoggedRef.current = false;
    const routeSlotCount = initialRouteScheduleSlots.length;
    const routeSlotsRaw = String((params as any)?.liveAllScheduleSlotsJson || "");
    const routeSlotsByteLen = utf8JsonByteLength(routeSlotsRaw);
    const ringNavAt = Number((globalThis as any).__KRISTO_LIVE_RING_NAV_AT__ || 0);
    logLivePerf("router_navigation_received", {
      sinceRingNavMs: ringNavAt ? liveRoomMountAtRef.current - ringNavAt : null,
      feedId: String((params as any)?.feedId || ""),
      liveId: String((params as any)?.liveId || ""),
    });
    logLivePerf("component_mount", {
      sinceRingNavMs: ringNavAt ? liveRoomMountAtRef.current - ringNavAt : null,
    });
    pauseHomeFeedBackgroundWorkForLiveNavigation("live-room-mount");
    prewarmLiveRoomMediaPermissions("live-room-mount");
    console.log("KRISTO_LIVE_ROOM_ROUTE_SLOTS_SIZE", {
      byteLen: routeSlotsByteLen,
      charLen: routeSlotsRaw.length,
      slotCount: routeSlotCount,
    });
    console.log("KRISTO_LIVE_ROOM_MOUNT_START", {
      at: liveRoomMountAtRef.current,
      sinceRingNavMs: ringNavAt ? liveRoomMountAtRef.current - ringNavAt : null,
    });

    console.log("KRISTO_LIVE_ROOM_SCREEN_MOUNT", {
      at: liveRoomMountAtRef.current,
      sinceRingNavMs: ringNavAt ? liveRoomMountAtRef.current - ringNavAt : null,
      feedId: String((params as any)?.feedId || ""),
      sourceScheduleId: String((params as any)?.sourceScheduleId || ""),
      liveId: String((params as any)?.liveId || ""),
      localScheduleId: String((params as any)?.localScheduleId || ""),
      churchId: String((params as any)?.churchId || session?.churchId || ""),
      currentUserId: String(session?.userId || ""),
      routeClaimedByUserId: String((params as any)?.claimedByUserId || ""),
      canPublish: String((params as any)?.canPublish || ""),
      canPublishMic: String((params as any)?.canPublishMic || ""),
      canPublishCamera: String((params as any)?.canPublishCamera || ""),
      entryMode: String((params as any)?.entryMode || ""),
      currentSlotNumber: String((params as any)?.currentSlotNumber || ""),
      routeSlotCount,
      hasRouteSlots: routeSlotCount > 0,
    });

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const paintAt = Date.now();
        console.log("KRISTO_LIVE_ROOM_FIRST_PAINT", {
          at: paintAt,
          sinceMountMs: paintAt - liveRoomMountAtRef.current,
          sinceRingNavMs: ringNavAt ? paintAt - ringNavAt : null,
        });
        logLivePerf("first_paint", {
          sinceRingNavMs: ringNavAt ? paintAt - ringNavAt : null,
        });
      });
    });

    console.log("KRISTO_LIVE_ROOM_PARAMS_RECEIVED", {
      feedId: String((params as any)?.feedId || ""),
      liveId: String((params as any)?.liveId || ""),
      localScheduleId: String((params as any)?.localScheduleId || ""),
      sourceScheduleId: String((params as any)?.sourceScheduleId || ""),
      churchId: String((params as any)?.churchId || ""),
      liveMode: String((params as any)?.liveMode || ""),
      entryMode: String((params as any)?.entryMode || ""),
      hasRouteSlots: routeSlotCount > 0,
      routeSlotCount,
      isBackendFeedId: isBackendFeedScheduleId(
        String((params as any)?.feedId || (params as any)?.liveId || "")
      ),
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  useEffect(() => {
    AudioSession.configureAudio({
      android: {
        audioTypeOptions: AndroidAudioTypePresets.communication,
      },
    }).catch(() => {});
    AudioSession.startAudioSession().catch(() => {});

    const fastOpenSlotsRaw = String((params as any)?.liveAllScheduleSlotsJson || "");
    console.log("KRISTO_LIVE_ROOM_FAST_OPEN", {
      liveId: String((params as any)?.liveId || ""),
      feedId: String((params as any)?.feedId || ""),
      sourceScheduleId: String((params as any)?.sourceScheduleId || ""),
      churchId: String((params as any)?.churchId || session?.churchId || ""),
      routeSlotJsonLen: fastOpenSlotsRaw.length,
      routeSlotByteLen: utf8JsonByteLength(fastOpenSlotsRaw),
      currentSlotNumber: String((params as any)?.currentSlotNumber || ""),
      claimedSlotNumber: String((params as any)?.claimedSlotNumber || ""),
      canPublish: String((params as any)?.canPublish || ""),
      layout: String(params.layout || ""),
    });
  }, []);

  const rawTitle = String(params.title || "Youth");
  const liveSource = String(params.source || "").trim().toLowerCase();
  const isMediaInstantLive =
    (liveSource === "media" || liveSource === "ministry") &&
    String(params.liveMode || "").trim().toLowerCase() === "instant";
  const isMinistryInstantLive = liveSource === "ministry" && String(params.liveMode || "").trim().toLowerCase() === "instant";
  const mediaName = String(params.mediaName || rawTitle || "Kristo").trim();
  const [backendChurchLive, setBackendChurchLive] = useState<any>(null);
  const [resolvedActualChurchPastorUserId, setResolvedActualChurchPastorUserId] = useState("");
  const [memberAvatarByUserId, setMemberAvatarByUserId] = useState<Record<string, string>>({});
  const [resolvedAvatarByUserId, setResolvedAvatarByUserId] = useState<Record<string, string>>({});
  const [liveProfileAvatarUri, setLiveProfileAvatarUri] = useState("");

  const liveProfileName = useMemo(() => {
    return (
      String(
        (session as any)?.displayName ||
        (session as any)?.fullName ||
        (session as any)?.name ||
        (session as any)?.username ||
        ""
      ).trim() ||
      String(mediaName || "").trim() ||
      "Live Host"
    );
  }, [
    session?.userId,
    (session as any)?.displayName,
    (session as any)?.fullName,
    (session as any)?.name,
    (session as any)?.username,
    mediaName,
  ]);

  useEffect(() => {
    let alive = true;

    async function resolvePastor() {
      const churchId = String(session?.churchId || (params as any).churchId || "").trim();
      if (!churchId) return;

      const scheduleCreator = String(
        (params as any).scheduleCreatedByUserId ||
        (params as any).createdByUserId ||
        ""
      ).trim();
      const routePastor = String(
        (params as any).actualChurchPastorUserId ||
        (params as any).churchPastorUserId ||
        ""
      ).trim();
      const backendPastor = String(backendChurchLive?.actualChurchPastorUserId || "").trim();

      let actual = "";
      let sourceField = "";

      if (backendPastor && (!scheduleCreator || backendPastor !== scheduleCreator)) {
        actual = backendPastor;
        sourceField = "backendChurchLive.actualChurchPastorUserId";
      } else if (routePastor && scheduleCreator && routePastor !== scheduleCreator) {
        actual = routePastor;
        sourceField = "route.actualChurchPastorUserId";
      } else {
        const res = await fetchChurchPastorUserId(
          churchId,
          getKristoHeaders({
            userId: session?.userId || "",
            role: (session?.role || "Member") as any,
            churchId,
          }) as any
        );
        actual = res.actualChurchPastorUserId;
        sourceField = res.sourceField;
      }

      logChurchPastorResolution({
        churchId,
        actualChurchPastorUserId: actual,
        sourceField,
        scheduleCreatedByUserId: scheduleCreator,
        currentUserId: String(session?.userId || ""),
      });

      if (alive) setResolvedActualChurchPastorUserId(actual);
    }

    void resolvePastor();
    return () => {
      alive = false;
    };
  }, [
    session?.churchId,
    session?.userId,
    session?.role,
    (params as any).churchId,
    (params as any).actualChurchPastorUserId,
    (params as any).churchPastorUserId,
    (params as any).scheduleCreatedByUserId,
    (params as any).createdByUserId,
    backendChurchLive?.actualChurchPastorUserId,
  ]);

  const routePastorCandidate = String(
    (params as any).actualChurchPastorUserId ||
    (params as any).churchPastorUserId ||
    ""
  ).trim();
  const routeScheduleCreator = String(
    (params as any).scheduleCreatedByUserId ||
    (params as any).createdByUserId ||
    ""
  ).trim();
  const routePastorLooksLikeCreator =
    !!routePastorCandidate &&
    !!routeScheduleCreator &&
    routePastorCandidate === routeScheduleCreator;

  const projectId = String(params.projectId || "").trim();
  const assignmentId = String(params.assignmentId || "").trim();
  const membersCount = Math.max(0, Number(params.membersCount || "26") || 26);
  const leadersCount = Math.max(0, Number(params.leadersCount || "4") || 4);
  const roleParam = String(params.role || "").trim();
  const normalizedRoleParam = String(roleParam || "").toLowerCase();
  const sessionUserId = String(session?.userId || "").trim();
  const claimEnterLock = readClaimEnterSessionLock(liveBridgeIdFromRoute);
  const claimEnterLockHeld = shouldHoldClaimEnterSessionLock(liveBridgeIdFromRoute);
  const currentUserId =
    claimEnterLockHeld && claimEnterLock?.lockedUserId
      ? claimEnterLock.lockedUserId
      : sessionUserId;
  const sessionRoleText = String((session as any)?.role || "").toLowerCase();
  const routeRoleText = String(roleParam || "").toLowerCase();

  useEffect(() => {
    if (!claimEnterLockHeld || !sessionUserId || sessionUserId === currentUserId) return;
    console.log("KRISTO_CLAIM_ENTER_SESSION_LOCK_HELD", {
      liveBridgeId: liveBridgeIdFromRoute,
      sessionUserId,
      lockedUserId: currentUserId,
      routeClaimedByUserId: claimEnterLock?.routeClaimedByUserId || "",
      claimEnterLockSnapshot: readClaimEnterSessionLockSnapshot(),
    });
  }, [
    claimEnterLockHeld,
    sessionUserId,
    currentUserId,
    liveBridgeIdFromRoute,
    claimEnterLock?.routeClaimedByUserId,
  ]);

  const fastLiveAuthEarly = useMemo(
    () =>
      evaluateFastLiveSessionAuthority({
        currentUserId,
        sessionRoleText,
        sessionChurchRole: String((session as any)?.churchRole || ""),
        routePastorUserId: routePastorCandidate,
        routeScheduleCreatorUserId: routeScheduleCreator,
        routeClaimedByUserId: String((params as any)?.claimedByUserId || ""),
      }),
    [
      currentUserId,
      sessionRoleText,
      (session as any)?.churchRole,
      routePastorCandidate,
      routeScheduleCreator,
      (params as any)?.claimedByUserId,
    ]
  );

  const liveMediaAuthority = evaluateLiveMediaAuthority({
    currentUserId,
    actualChurchPastorUserId: String(
      fastLiveAuthEarly.trustedActualChurchPastorUserId ||
      resolvedActualChurchPastorUserId ||
      backendChurchLive?.actualChurchPastorUserId ||
      (!routePastorLooksLikeCreator ? routePastorCandidate : "") ||
      ""
    ).trim(),
    scheduleCreatedByUserId: routeScheduleCreator,
    mediaHostIds: (params as any).mediaHostIds,
    backendLivePastorUserId: String(backendChurchLive?.actualChurchPastorUserId || "").trim(),
  });

  const actualChurchPastorUserId = liveMediaAuthority.actualChurchPastorUserId;
  const scheduleCreatedByUserId = liveMediaAuthority.scheduleCreatedByUserId;
  const mediaHostIds = liveMediaAuthority.mediaHostIds;

  const isChurchLiveControlRoute =
    String(assignmentId || "").trim() === "church-media-room" ||
    String((params as any).roomId || "").trim() === "church-media-room" ||
    String((params as any).sourceRoomId || "").trim() === "church-media-room" ||
    String(rawTitle || "").toLowerCase().includes("church live control");

  const isChurchLiveControlHost =
    isChurchLiveControlRoute &&
    !!currentUserId &&
    (
      sessionRoleText.includes("pastor") ||
      sessionRoleText.includes("admin") ||
      sessionRoleText.includes("leader") ||
      routeRoleText.includes("pastor") ||
      routeRoleText.includes("admin") ||
      routeRoleText.includes("leader")
    );

  const isMediaOwnerHost =
    liveMediaAuthority.isMediaOwnerHost || isChurchLiveControlHost;

  const routeCanPublishEarly =
    String((params as any).canPublish || "") === "1" ||
    String((params as any).canPublishMic || "") === "1" ||
    String((params as any).canPublishCamera || "") === "1";

  const isMinistryLiveRoute =
    String((params as any).room || "").toLowerCase() === "ministry" ||
    String((params as any).mediaScope || "").toLowerCase() === "ministry" ||
    String((params as any).roomKind || "").toLowerCase().includes("ministry") ||
    String((params as any).source || "").toLowerCase().includes("ministry-live");

  const routeMinistryPublishAuthority =
    isMinistryLiveRoute &&
    routeCanPublishEarly &&
    (
      routeRoleText.includes("leader") ||
      routeRoleText.includes("host") ||
      routeRoleText.includes("pastor") ||
      routeRoleText.includes("admin") ||
      sessionRoleText.includes("leader") ||
      sessionRoleText.includes("host") ||
      sessionRoleText.includes("pastor")
    );

  // Ministry pastor authority comes only from the ministry live route params,
  // not from generic pastor role alone.
  const isMinistryLiveHost =
    isMinistryLiveRoute &&
    (
      routeMinistryPublishAuthority ||
      (
        routeCanPublishEarly &&
        (
          actualChurchPastorUserId === currentUserId ||
          liveMediaAuthority.isMediaScheduleCreator ||
          liveMediaAuthority.isMediaHost
        )
      )
    );

  const isPastorLiveOwner = isMediaOwnerHost || isMinistryLiveHost;

  const roleLooksLikeHost =
    isPastorLiveOwner ||
    isMediaOwnerHost ||
    isMinistryLiveHost;

  const isHost = roleLooksLikeHost;

  const previewMode = String(params.preview || "0") === "1";
  const requestedEntryMode =
    String(params.entryMode || "").trim() === "backstage"
      ? "backstage"
      : String(params.entryMode || "").trim() === "waiting"
        ? "waiting"
        : String(params.entryMode || "").trim() === "live"
          ? "live"
          : "none";
  const live = useLiveRoom({ membersCount, leadersCount });
  const [liveNowMs, setLiveNowMs] = useState(Date.now());
  const [accessRequestSent, setAccessRequestSent] = useState(false);
  const [accessApproveCountdown, setAccessApproveCountdown] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setLiveNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeAssignment = useMemo(
    () => (projectId ? projectStore.getActiveAssignment(projectId) : null),
    [projectId]
  );

  const selectedAssignment = useMemo(() => {
    if (assignmentId) {
      return projectStore.assignments.find((x: any) => x.id === assignmentId) || null;
    }
    return activeAssignment;
  }, [assignmentId, activeAssignment]);

  const liveScheduleReady = isMediaInstantLive || !projectId || !!activeAssignment;

  const liveHeaderDisplayTitle = useMemo(
    () =>
      resolveLiveRoomHeaderLabel({
        mediaName: String(params.mediaName || "").trim(),
        churchName: String((params as any).churchName || "").trim(),
        churchLabel: String((params as any).churchLabel || "").trim(),
        title: String(params.title || "").trim(),
        rawTitle,
        actorLabel: String((params as any).actorLabel || "").trim(),
        sessionChurchName: String((session as any)?.churchName || (session as any)?.churchLabel || "").trim(),
      }),
    [params.mediaName, (params as any).churchName, (params as any).churchLabel, params.title, rawTitle, (params as any).actorLabel, session]
  );

  const liveHeaderSubLine = useMemo(() => {
    const churchLine = cleanLiveRoomLabel(
      (params as any).churchName ||
        (params as any).churchLabel ||
        (session as any)?.churchName ||
        (session as any)?.churchLabel
    );
    const speaker = cleanLiveRoomLabel((params as any).claimedByName || (params as any).liveClaimName);
    const parts = [churchLine, speaker ? `• ${speaker}` : ""].filter(Boolean);
    return parts.join(" ").trim() || "LIVE";
  }, [params, session]);

  const title = isMediaInstantLive ? liveHeaderDisplayTitle : String(selectedAssignment?.title || liveHeaderDisplayTitle);

  const assignmentThreadId = String(selectedAssignment?.id || assignmentId || "").trim();

  const [messageStoreTick, setMessageStoreTick] = useState(0);
  const assignmentMessagesSigRef = useRef("");
  useEffect(() => {
    return subscribeMessages(() => {
      if (!assignmentThreadId) return;
      const snap = getSnapshot();
      const arr = Array.isArray(snap.messages?.[assignmentThreadId]) ? snap.messages[assignmentThreadId] : [];
      const sig = messagesListSignature(arr);
      if (sig === assignmentMessagesSigRef.current) return;
      assignmentMessagesSigRef.current = sig;
      setMessageStoreTick((x) => x + 1);
    });
  }, [assignmentThreadId]);

  const assignmentThreadMessages = useMemo(() => {
    if (!assignmentThreadId) return [];
    const snap = getSnapshot();
    const arr = Array.isArray(snap.messages?.[assignmentThreadId]) ? snap.messages[assignmentThreadId] : [];
    return paginateMessages(arr, 80);
  }, [assignmentThreadId, messageStoreTick]);

  const scheduleCards = useMemo(
    () =>
      assignmentThreadMessages.filter((m: any) => {
        const card = m?.card;
        return m?.kind === "assignment_card" && parseSlotStartMs(card) > 0;
      }),
    [assignmentThreadMessages]
  );

  const claimedScheduleCards = useMemo(
    () =>
      scheduleCards.filter((m: any) => {
        const status = String(m?.card?.status || "").toLowerCase();
        return status === "taken";
      }),
    [scheduleCards]
  );

  const meetingWindow = useMemo(() => {
    const rows = scheduleCards
      .map((m: any) => {
        const card = m?.card || {};
        const startMs = parseSlotStartMs(card);
        const endMs = parseSlotEndMs(card, startMs);
        return startMs > 0 && endMs > startMs ? { startMs, endMs } : null;
      })
      .filter(Boolean) as Array<{ startMs: number; endMs: number }>;

    if (!rows.length) return { startMs: null as number | null, endMs: null as number | null };

    rows.sort((a, b) => a.startMs - b.startMs);
    return {
      startMs: rows[0]?.startMs ?? null,
      endMs: rows.reduce((max, row) => Math.max(max, row.endMs), rows[0].endMs),
    };
  }, [scheduleCards]);

  const PRELIVE_BACKSTAGE_OPEN_MS = 30 * 60 * 1000;
  const PRELIVE_WAITING_ROOM_OPEN_MS = 3 * 60 * 1000;
  const PRELIVE_AUDIENCE_OPEN_MS = 3 * 60 * 1000;

  const liveStartMs = meetingWindow.startMs;
  const liveEndMs = meetingWindow.endMs;

  const devScheduleOpenNow = true;

  const backstageOpen =
    devScheduleOpenNow ||
    (typeof liveStartMs === "number" &&
      liveNowMs >= liveStartMs - PRELIVE_BACKSTAGE_OPEN_MS);

  const waitingRoomOpen =
    devScheduleOpenNow ||
    (typeof liveStartMs === "number" &&
      liveNowMs >= liveStartMs - PRELIVE_WAITING_ROOM_OPEN_MS);

  const audienceOpen =
    devScheduleOpenNow ||
    (typeof liveStartMs === "number" &&
      liveNowMs >= liveStartMs - PRELIVE_AUDIENCE_OPEN_MS);

  const liveStarted =
    devScheduleOpenNow ||
    (typeof liveStartMs === "number" &&
      liveNowMs >= liveStartMs);

  const liveStillActive = isMediaInstantLive
    ? true
    : !!liveStarted && (!liveEndMs || liveNowMs <= liveEndMs);

  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("front");

  const hasStructuredLive =
    !!String((params as any)?.schedule || "").trim() ||
    !!String((params as any)?.slot || "").trim() ||
    !!String((params as any)?.invitation || "").trim() ||
    !!String((params as any)?.assignmentId || "").trim() ||
    !!String((params as any)?.meetingId || "").trim();

  // V1: Media instant live is always solo focus.
  // Grid6 is reserved for structured/scheduled live only.
  const initialLayoutMode = (
    String(
      isMediaInstantLive
        ? "focus"
        : initialRouteScheduleSlots.length > 0
          ? "grid6"
          : (params.layout || (hasStructuredLive ? "grid6" : "focus"))
    ) as LayoutMode
  );

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialLayoutMode);
  const [layoutDraftMode, setLayoutDraftMode] = useState<LayoutMode>(initialLayoutMode);
  const [pinnedGuestId, setPinnedGuestId] = useState(String(params.pinnedGuestId || "g1"));
  const [guestMicMuted, setGuestMicMuted] = useState<boolean>(false);
  const [bigStageGuestId, setBigStageGuestId] = useState<string>("host");
  const [stageSwapArmed, setStageSwapArmed] = useState<boolean>(false);
  const [profileActionGuestId, setProfileActionGuestId] = useState<string | null>(null);
  const profileActionAnim = useRef(new Animated.Value(0)).current;
  const [moderatorIds, setModeratorIds] = useState<Record<string, boolean>>({});
  const [miniVideoMutedById, setMiniVideoMutedById] = useState<Record<string, boolean>>({});
  const [joinRequestsBySlot, setJoinRequestsBySlot] = useState<Record<number, { name: string; avatar: string; approved: boolean; onStage?: boolean; joinedAt?: string }>>({});
  const [hostRequestCard, setHostRequestCard] = useState<any>(null);
  const joinToastAnim = useRef(new Animated.Value(0)).current;
  const [showJoinToast, setShowJoinToast] = useState(false);
  const [activeJoinToastSlot, setActiveJoinToastSlot] = useState<number | null>(null);
  const [requestListOpen, setRequestListOpen] = useState(false);
  const [vipGuestCardSlot, setVipGuestCardSlot] = useState<number | null>(null);
  const lastJoinToastKeyRef = useRef("");
  const seenJoinToastKeysRef = useRef<Record<string, boolean>>({});
  const joinToastPlayingRef = useRef(false);

  useEffect(() => {
    if (vipGuestCardSlot === null) return;
    const t = setTimeout(() => setVipGuestCardSlot(null), 3500);
    return () => clearTimeout(t);
  }, [vipGuestCardSlot]);

  useEffect(() => {
    if (joinToastPlayingRef.current) return;

    const ordered = Object.entries(joinRequestsBySlot || {})
      .map(([slot, req]) => ({ slot: Number(slot), ...(req as any) }))
      .filter((req: any) => !!req?.name && !req?.approved)
      .sort((a: any, b: any) => String(a.joinedAt || "").localeCompare(String(b.joinedAt || "")));

    const nextReq = ordered.find((req: any) => {
      const key = `${req.slot}-${req.joinedAt || ""}`;
      return !seenJoinToastKeysRef.current[key];
    });

    if (!nextReq) {
      setShowJoinToast(false);
      return;
    }

    const key = `${nextReq.slot}-${nextReq.joinedAt || ""}`;
    seenJoinToastKeysRef.current[key] = true;
    joinToastPlayingRef.current = true;

    setActiveJoinToastSlot(Number(nextReq.slot));
    setShowJoinToast(true);

    joinToastAnim.stopAnimation();
    joinToastAnim.setValue(0);

    Animated.sequence([
      Animated.spring(joinToastAnim, {
        toValue: 1,
        friction: 8,
        tension: 74,
        useNativeDriver: true,
      }),
      Animated.delay(5000),
      Animated.spring(joinToastAnim, {
        toValue: 0,
        friction: 9,
        tension: 68,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      joinToastPlayingRef.current = false;
      if (finished) {
        setShowJoinToast(false);
      }
    });
  }, [joinRequestsBySlot, showJoinToast, joinToastAnim]);

  const approvedStageSlots = useMemo(() => {
    return claimedScheduleCards
      .map((m: any, index: number) => {
        const card = m?.card || {};
        const slotNumber = Number(card.slot || card.slotNumber || card.order || index + 1);

        return {
          slot: slotNumber,
          name: String(
            card.claimedByName ||
            card.claimedByDisplayName ||
            card.assignedToName ||
            card.memberName ||
            card.leaderName ||
            card.hostName ||
            card.name ||
            `Guest ${slotNumber}`
          ).trim(),
          role: String(card.claimedByRole || card.roleLabel || card.title || "Speaker").trim(),
          avatar: String(
            card.claimedByAvatar ||
            card.claimedByAvatarUrl ||
            card.avatarUrl ||
            card.avatar ||
            card.profileImage ||
            card.photoURL ||
            card.image ||
            ""
          ).trim(),
          approved: true,
          claimedByUserId: String(card.claimedByUserId || card.userId || card.assignedToUserId || card.memberUserId || "").trim(),
          meetingDate: card.meetingDate,
          startTime: card.startTime,
          time: card.time,
          timeLabel: card.timeLabel,
          startMs: Number(card.startMs || parseSlotStartMs(card) || 0),
          endMs: Number(card.endMs || parseSlotEndMs(card, parseSlotStartMs(card)) || 0),
          durationMin: card.durationMin,
          order: Number(card.order || card.slot || card.slotNumber || index + 1),
        };
      })
      .filter((x: any) => !!x.name)
      .sort((a: any, b: any) => Number(a.order || a.slot || 0) - Number(b.order || b.slot || 0));
  }, [claimedScheduleCards]);

  const activeStageSlots = useMemo(() => {
    const now = liveNowMs;

    const parseSlotTimeMs = (slot: any) => {
      const directStartMs = Number(slot?.startMs || 0);
      if (directStartMs > 0) return directStartMs;

      const rawDate = String(slot?.meetingDate || "");
      const baseDate = rawDate
        ? new Date(rawDate)
        : new Date();

      // normalize local live date
      baseDate.setHours(0,0,0,0);
      const timeText = String(slot?.startTime || slot?.time || "").trim();

      if (!Number.isFinite(baseDate.getTime())) return NaN;
      if (!timeText) return baseDate.getTime();

      const yy = baseDate.getFullYear();
      const mm = baseDate.getMonth() + 1;
      const dd = baseDate.getDate();

      const [timePart = "12:00", meridiemRaw = "AM"] = timeText.split(" ");
      const [hhRaw = "12", minRaw = "00"] = timePart.split(":");

      let hh = Number(hhRaw || 0);
      const min = Number(minRaw || 0);

      const meridiem = meridiemRaw.toUpperCase();

      if (meridiem === "PM" && hh < 12) hh += 12;
      if (meridiem === "AM" && hh == 12) hh = 0;

      return new Date(
        yy,
        (mm || 1) - 1,
        dd || 1,
        hh,
        min,
        0,
        0
      ).getTime();
    };

    let lastStartMs = 0;

    return approvedStageSlots
      .map((slot: any) => {
        let startMs = parseSlotTimeMs(slot);

        while (Number.isFinite(startMs) && lastStartMs && startMs <= lastStartMs) {
          startMs += 24 * 60 * 60 * 1000;
        }

        if (Number.isFinite(startMs)) lastStartMs = startMs;

        const durationMin = Math.max(1, Number(slot?.durationMin || 0) || 1);
        const endMs = startMs + durationMin * 60 * 1000;

        return { ...slot, startMs, endMs };
      })
      .filter((slot: any) => Number.isFinite(slot.endMs) && now <= slot.endMs)
      .slice(0, 9);

  }, [approvedStageSlots, liveNowMs]);

  const waitingStageSlots = useMemo(
    () => [],
    []
  );

  const hiddenStageSlots = useMemo(
    () => approvedStageSlots.slice(9),
    [approvedStageSlots]
  );


  const myOwnClaimedSlotNumber = useMemo(() => {
    const me = String(session?.userId || "").trim();

    const mine = approvedStageSlots.find((slot: any) => {
      return String(slot?.claimedByUserId || slot?.userId || "").trim() === me;
    });

    return Number(mine?.slot || mine?.order || 0);
  }, [approvedStageSlots, session?.userId]);


  const getScheduleSlotWindow = (slot: any, fallbackIndex = 0) => {
    const rawDate = String(slot?.meetingDate || slot?.date || "");
    const baseDate = rawDate ? new Date(rawDate) : new Date();
    if (!Number.isFinite(baseDate.getTime())) return { startMs: 0, endMs: 0 };

    const parseTimeOnBaseDate = (rawTime: any) => {
      const d = new Date(baseDate);
      d.setHours(0, 0, 0, 0);

      const timeText = String(rawTime || "")
        .replace(/[\u202F\u00A0]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!timeText) return d.getTime();

      const match = timeText.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
      if (!match) return d.getTime();

      let hh = Number(match[1] || 0);
      const min = Number(match[2] || 0);
      const meridiem = String(match[3] || "").toUpperCase();

      if (meridiem === "PM" && hh < 12) hh += 12;
      if (meridiem === "AM" && hh === 12) hh = 0;

      d.setHours(hh, min, 0, 0);
      return d.getTime();
    };

    const startMs = Number(slot?.startMs || parseTimeOnBaseDate(slot?.startTime || slot?.time) || 0);

    let endMs = Number(slot?.endMs || 0);
    if (!endMs && slot?.endTime) {
      endMs = parseTimeOnBaseDate(slot.endTime);
      if (endMs <= startMs) endMs += 24 * 60 * 60000;
    }

    if (!endMs) {
      const durationMin = Math.max(1, Number(slot?.durationMin || 1));
      endMs = startMs + durationMin * 60000;
    }

    return { startMs, endMs };
  };

  function isClaimedScheduleSlot(slot: any) {
    const uid = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
    const name = String(slot?.claimedByName || slot?.claimedBy?.name || slot?.name || "").trim();
    return !!uid || !!name;
  }

  function isScheduleSlotExpired(slot: any, now: number) {
    const endMs = Number(slot?.endMs || 0);
    return Number.isFinite(endMs) && endMs > 0 && endMs <= now;
  }

  function isScheduleSlotUpcoming(slot: any, now: number) {
    if (isScheduleSlotExpired(slot, now)) return false;
    const startMs = Number(slot?.startMs || 0);
    return Number.isFinite(startMs) && startMs > 0 && now < startMs;
  }

  function isScheduleSlotActiveNow(slot: any, now: number) {
    const startMs = Number(slot?.startMs || 0);
    const endMs = Number(slot?.endMs || 0);
    return (
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      endMs > startMs &&
      startMs > 0 &&
      now >= startMs &&
      now < endMs
    );
  }

  function liveStageSlotLogId(slot: any) {
    return String(slot?.id || slot?.slotId || slot?.runtimeSlotKey || slot?.slot || slot?.slotNumber || "");
  }

  function liveRoomDisplaySlotKey(slot: any) {
    const slotId = liveStageSlotLogId(slot);
    if (slotId) return `id:${slotId}`;
    const slotNumber = Number(slot?.slot || slot?.slotNumber || 0);
    return slotNumber > 0 ? `num:${slotNumber}` : "";
  }


  const [liveViewerPresence, setLiveViewerPresence] = useState<Record<string, any>>({});
  const [feedScheduleTick, setFeedScheduleTick] = useState(0);
  const claimRoomSyncRef = useRef("");
  const backendLiveRequestsRef = useRef<Record<string, any>>({});
  const [backendLiveRequests, setBackendLiveRequests] = useState<Record<string, any>>({});
  const [backendScheduleSlots, setBackendScheduleSlots] = useState<any[]>([]);
  const [backendScheduleHydrated, setBackendScheduleHydrated] = useState(false);
  const [backendScheduleExplicitlyEnded, setBackendScheduleExplicitlyEnded] = useState(false);
  const [runtimeSlotOverrides, setRuntimeSlotOverrides] = useState<Record<string, any>>({});

  const liveScheduleFeedId = useMemo(() => {
    const paramFeedId = String((params as any)?.feedId || "").trim();
    const paramSourceId = String((params as any)?.sourceScheduleId || "").trim();
    const paramLiveId = String((params as any)?.liveId || "").trim();

    for (const candidate of [paramFeedId, paramSourceId, paramLiveId]) {
      if (!isBackendFeedScheduleId(candidate)) continue;
      const canonical = baseFeedId(candidate) || candidate;
      console.log("KRISTO_SCHEDULE_ID_NORMALIZED", {
        context: "live-room",
        seedIds: {
          sourceScheduleId: paramSourceId,
          feedId: paramFeedId,
          liveId: paramLiveId,
          localScheduleId: String((params as any)?.localScheduleId || ""),
        },
        canonicalId: canonical,
        source: "route-feed-id",
      });
      return canonical;
    }

    const rows = feedList() as any[];
    const resolved = resolveLiveScheduleFeedId(params as Record<string, unknown>, rows);
    if (resolved) {
      console.log("KRISTO_SCHEDULE_ID_NORMALIZED", {
        context: "live-room",
        seedIds: {
          sourceScheduleId: paramSourceId,
          feedId: paramFeedId,
          liveId: paramLiveId,
          localScheduleId: String((params as any)?.localScheduleId || ""),
        },
        canonicalId: resolved,
        source: "feed-store-resolve",
      });
    }
    return resolved;
  }, [params, feedScheduleTick]);

  const ignoreRouteSlotsForStaleBackend = useMemo(() => {
    if (!liveScheduleFeedId || !isBackendFeedScheduleId(liveScheduleFeedId)) return false;
    return shouldIgnoreRouteSlotsForBackendFeedId({
      feedId: liveScheduleFeedId,
      backendRows: backendScheduleHydrated ? [{ id: liveScheduleFeedId, scheduleSlots: backendScheduleSlots }] : [],
      backendFeedLoaded: backendScheduleHydrated,
      backendSlotCount: backendScheduleSlots.length,
      routeSlotCount: initialRouteScheduleSlots.length,
      routeSlotsHaveActiveWindow: liveRoomRouteSlotsHaveActiveWindow(
        initialRouteScheduleSlots,
        liveNowMs
      ),
      feedItemExplicitlyEnded: backendScheduleExplicitlyEnded,
    });
  }, [
    liveScheduleFeedId,
    backendScheduleHydrated,
    backendScheduleSlots,
    backendScheduleExplicitlyEnded,
    initialRouteScheduleSlots,
    liveNowMs,
  ]);

  const routeSlotsStillLive = useMemo(
    () => liveRoomRouteSlotsHaveActiveWindow(initialRouteScheduleSlots, liveNowMs),
    [initialRouteScheduleSlots, liveNowMs]
  );

  const routeScheduleSlots = useMemo(() => {
    if (ignoreRouteSlotsForStaleBackend) {
      return [];
    }

    if (initialRouteScheduleSlots.length) return initialRouteScheduleSlots;

    const fromFeedStore = liveScheduleFeedId
      ? feedScheduleSlotsForLive(liveScheduleFeedId)
      : [];

    return fromFeedStore;
  }, [
    ignoreRouteSlotsForStaleBackend,
    initialRouteScheduleSlots,
    liveScheduleFeedId,
    feedScheduleTick,
  ]);

  // Preserve ring/nav slot before time-based stage resolution (fast lean route open).
  const routeCurrentSlotNumber = useMemo(() => {
    const fromCurrent = Number(String((params as any)?.currentSlotNumber || "").trim());
    if (Number.isFinite(fromCurrent) && fromCurrent > 0) return fromCurrent;

    const fromPreferred = Number(String((params as any)?.preferredSlotNumber || "").trim());
    if (Number.isFinite(fromPreferred) && fromPreferred > 0) return fromPreferred;

    const fromClaimed = Number(String((params as any)?.claimedSlotNumber || "").trim());
    if (Number.isFinite(fromClaimed) && fromClaimed > 0) return fromClaimed;

    return 0;
  }, [
    (params as any)?.currentSlotNumber,
    (params as any)?.preferredSlotNumber,
    (params as any)?.claimedSlotNumber,
  ]);

  const mergedScheduleSlots = useMemo(() => {
    if (ignoreRouteSlotsForStaleBackend) {
      return [];
    }

    const feedSlots = liveScheduleFeedId ? feedScheduleSlotsForLive(liveScheduleFeedId) : [];
    const merged = mergeLiveRoomScheduleSlots(
      backendScheduleSlots,
      feedSlots,
      routeScheduleSlots
    );
    const withHints = applyRingClaimHintsToScheduleSlots(
      merged,
      liveScheduleFeedId,
      getRingClaimHints(),
      feedList() as any[]
    );
    return enrichScheduleSlotsFromLiveRequests(
      withHints,
      backendLiveRequests,
      liveScheduleFeedId || String((params as any)?.liveId || "")
    );
  }, [
    ignoreRouteSlotsForStaleBackend,
    backendScheduleSlots,
    routeScheduleSlots,
    liveScheduleFeedId,
    feedScheduleTick,
    backendLiveRequests,
    (params as any)?.liveId,
  ]);

  useEffect(() => {
    if (!ignoreRouteSlotsForStaleBackend || !liveScheduleFeedId) return;

    console.log("KRISTO_LIVE_ROOM_ROUTE_SLOTS_DROPPED_STALE", {
      feedId: liveScheduleFeedId,
      routeSlotCount: initialRouteScheduleSlots.length,
      backendSlotCount: backendScheduleSlots.length,
      localScheduleId: String((params as any)?.localScheduleId || ""),
    });

    clearScheduleClaimRuntimeState(liveScheduleFeedId);
    tryEndLiveBridgeForSchedule(liveScheduleFeedId, "live-room-stale-backend-zero");
    emitLiveRingRefresh("live-room-stale-backend-zero");
  }, [
    ignoreRouteSlotsForStaleBackend,
    liveScheduleFeedId,
    initialRouteScheduleSlots.length,
    backendScheduleSlots.length,
    (params as any)?.localScheduleId,
  ]);

  useEffect(() => {
    const slotCount = Math.max(initialRouteScheduleSlots.length, mergedScheduleSlots.length);
    if (
      slotCount > 0 &&
      layoutMode === "focus" &&
      routeIsMinistryLive &&
      !isMediaInstantLive
    ) {
      setLayoutMode("grid6");
      setLayoutDraftMode("grid6");
      console.log("KRISTO_LIVE_ROOM_LAYOUT_UPGRADE", {
        from: "focus",
        to: "grid6",
        slotCount,
      });
    }
  }, [
    initialRouteScheduleSlots.length,
    mergedScheduleSlots.length,
    layoutMode,
    routeIsMinistryLive,
    isMediaInstantLive,
  ]);

  useEffect(() => {
    if (livePerfScheduleMergeLoggedRef.current && mergedScheduleSlots.length === 0) return;
    if (!livePerfScheduleMergeLoggedRef.current) {
      livePerfScheduleMergeLoggedRef.current = true;
      logLivePerf("schedule_merge_start");
    }
    logLivePerf("schedule_merge_done", {
      mergedSlotCount: mergedScheduleSlots.length,
      routeSlotCount: routeScheduleSlots.length,
      backendSlotCount: backendScheduleSlots.length,
    });
  }, [
    mergedScheduleSlots.length,
    routeScheduleSlots.length,
    backendScheduleSlots.length,
  ]);

  useEffect(() => {
    const unsubFeed = subscribeHomeFeed(() => setFeedScheduleTick((v) => v + 1));
    const unsubClaim = onClaimUpdated(() => setFeedScheduleTick((v) => v + 1));
    return () => {
      unsubFeed();
      unsubClaim();
    };
  }, []);

  const backendScheduleReady =
    backendScheduleHydrated ||
    mergedScheduleSlots.length > 0 ||
    routeScheduleSlots.length > 0;

  useEffect(() => {
    if (isMediaInstantLive) return;
    if (liveRoomBootstrapAtRef.current > 0) return;
    liveRoomBootstrapAtRef.current = Date.now();
    console.log("KRISTO_LIVE_ROOM_BOOTSTRAP_START", {
      liveScheduleFeedId,
      routeFeedId: String((params as any)?.feedId || (params as any)?.liveId || ""),
      routeSlotCount: routeScheduleSlots.length,
      mergedSlotCount: mergedScheduleSlots.length,
    });
  }, [
    isMediaInstantLive,
    liveScheduleFeedId,
    routeScheduleSlots.length,
    mergedScheduleSlots.length,
    (params as any)?.feedId,
    (params as any)?.liveId,
  ]);

  useEffect(() => {
    if (!backendScheduleReady || liveRoomReadyLoggedRef.current) return;
    liveRoomReadyLoggedRef.current = true;
    const bootstrapAt = liveRoomBootstrapAtRef.current || liveRoomMountAtRef.current;
    console.log("KRISTO_LIVE_ROOM_BOOTSTRAP_DONE", {
      durationMs: Date.now() - bootstrapAt,
      routeSlotCount: routeScheduleSlots.length,
      mergedSlotCount: mergedScheduleSlots.length,
      backendSlotCount: backendScheduleSlots.length,
    });
    const readySource =
      ignoreRouteSlotsForStaleBackend
        ? "backend-empty-ended"
        : routeScheduleSlots.length > 0 && backendScheduleSlots.length === 0
          ? "route-slots"
          : backendScheduleSlots.length > 0
            ? "backend"
            : routeScheduleSlots.length > 0
              ? "route-slots"
              : backendScheduleHydrated
                ? "backend"
                : "route-slots";

    console.log("KRISTO_LIVE_ROOM_READY", {
      source: readySource,
      liveScheduleFeedId,
      liveBridgeId: String(
        liveScheduleFeedId ||
          (params as any)?.liveId ||
          (params as any)?.feedId ||
          (params as any)?.sourceScheduleId ||
          ""
      ),
      slotCount: mergedScheduleSlots.length,
      routeSlotCount: routeScheduleSlots.length,
      backendSlotCount: backendScheduleSlots.length,
    });
  }, [
    backendScheduleReady,
    routeScheduleSlots.length,
    mergedScheduleSlots.length,
    backendScheduleSlots.length,
    liveScheduleFeedId,
    (params as any)?.feedId,
    (params as any)?.liveId,
    (params as any)?.sourceScheduleId,
  ]);

  const getRuntimeSlotKey = (slot: any, index = 0) =>
    String(slot?.id || slot?.slot || slot?.slotNumber || slot?.order || index + 1);

  const runtimeScheduleSlots = useMemo(() => {
    return normalizeLiveScheduleSlots(mergedScheduleSlots).map((slot: any, index: number) => {
      const key = getRuntimeSlotKey(slot, index);
      const patch = runtimeSlotOverrides[key] || {};
      return {
        ...slot,
        ...patch,
        runtimeSlotKey: key,
        skipped: !!slot?.skipped || !!patch?.skipped,
      };
    });
  }, [mergedScheduleSlots, runtimeSlotOverrides]);

  // AUTHORITY SOURCE OF TRUTH:
  // When backend/runtime schedule exists, do NOT merge old activeStageSlots.
  // This prevents login users from inheriting stale/ghost claimed slots.
  const authorityStageSlots = runtimeScheduleSlots.length
    ? runtimeScheduleSlots
    : activeStageSlots;

  const currentMainStageSlotRaw = useMemo(() => {
    const now = liveNowMs;

    const allSlots = authorityStageSlots
      .map((slot: any, index: number) => {
        const n = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
        const win = getScheduleSlotWindow(slot, index);
        return {
          ...slot,
          slot: n,
          order: Number(slot?.order || n),
          startMs: win.startMs,
          endMs: win.endMs,
          name: String(slot?.claimedByName || slot?.claimedBy?.name || slot?.name || `Guest ${n}`),
          avatar: resolveParticipantAvatarUri(slot),
          claimedByUserId: String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim(),
          approved: true,
        };
      })
      .filter((slot: any) => Number(slot?.slot || 0) > 0)
      .filter((slot: any) => !slot?.skipped)
      .sort((a: any, b: any) => Number(a.startMs || 0) - Number(b.startMs || 0));

    const claimedSlots = allSlots.filter(isClaimedScheduleSlot);

    const activeByTime = claimedSlots.find((slot: any) => isScheduleSlotActiveNow(slot, now));
    if (activeByTime) return activeByTime;

    const hasTimedClaimedWindows = claimedSlots.some(
      (slot: any) =>
        Number(slot?.startMs || 0) > 0 &&
        Number(slot?.endMs || 0) > Number(slot?.startMs || 0)
    );

    if (hasTimedClaimedWindows) {
      return null;
    }

    // Bootstrap fallback when schedule slots lack usable time windows.
    if (routeCurrentSlotNumber > 0 && (routeScheduleSlots.length > 0 || allSlots.length > 0)) {
      const routeIndex = Math.max(0, routeCurrentSlotNumber - 1);
      const routeSlotMatch =
        routeScheduleSlots.find(
          (slot: any) =>
            Number(slot?.slot || slot?.slotNumber || slot?.order || 0) === routeCurrentSlotNumber
        ) || routeScheduleSlots[routeIndex];

      const byRouteNumber = allSlots.find(
        (slot: any) => Number(slot?.slot || slot?.slotNumber || 0) === routeCurrentSlotNumber
      );
      if (byRouteNumber) {
        if (routeSlotMatch) {
          const routeWin = getScheduleSlotWindow(routeSlotMatch, routeIndex);
          return {
            ...routeSlotMatch,
            ...byRouteNumber,
            slot: routeCurrentSlotNumber,
            slotNumber: routeCurrentSlotNumber,
            order: Number(byRouteNumber?.order || routeSlotMatch?.order || routeCurrentSlotNumber),
            startMs: Number(
              byRouteNumber.startMs ||
                routeSlotMatch.startMs ||
                routeWin.startMs ||
                0
            ),
            endMs: Number(
              byRouteNumber.endMs ||
                routeSlotMatch.endMs ||
                routeWin.endMs ||
                0
            ),
            claimedByUserId: String(
              byRouteNumber.claimedByUserId ||
                routeSlotMatch.claimedByUserId ||
                routeSlotMatch?.claimedBy?.userId ||
                ""
            ).trim(),
            name: String(
              byRouteNumber.name ||
                routeSlotMatch.claimedByName ||
                routeSlotMatch.name ||
                routeSlotMatch.title ||
                `Guest ${routeCurrentSlotNumber}`
            ),
            avatar: resolveParticipantAvatarUri(byRouteNumber) || resolveParticipantAvatarUri(routeSlotMatch),
            approved: true,
          };
        }
        return byRouteNumber;
      }

      const routeSlot = routeSlotMatch;

      if (routeSlot) {
        const n = routeCurrentSlotNumber;
        const win = getScheduleSlotWindow(routeSlot, routeIndex);
        const routeOwnerId = String(
          routeSlot?.claimedByUserId ||
            routeSlot?.claimedBy?.userId ||
            (params as any)?.claimedByUserId ||
            ""
        ).trim();
        return {
          ...routeSlot,
          slot: n,
          slotNumber: n,
          order: Number(routeSlot?.order || n),
          startMs: Number(routeSlot?.startMs || win.startMs || 0),
          endMs: Number(routeSlot?.endMs || win.endMs || 0),
          name: String(
            routeSlot?.claimedByName ||
              routeSlot?.name ||
              routeSlot?.title ||
              (params as any)?.claimedByName ||
              `Guest ${n}`
          ),
          avatar: resolveParticipantAvatarUri(routeSlot),
          claimedByUserId: routeOwnerId,
          approved: true,
        };
      }

      const routeOwnerId = String((params as any)?.claimedByUserId || "").trim();
      if (routeOwnerId) {
        const scheduleStartMs = Number((params as any)?.scheduleStartMs || 0);
        const scheduleEndMs = Number((params as any)?.scheduleEndMs || 0);
        return {
          slot: routeCurrentSlotNumber,
          slotNumber: routeCurrentSlotNumber,
          order: routeCurrentSlotNumber,
          startMs: scheduleStartMs > 0 ? scheduleStartMs : now,
          endMs:
            scheduleEndMs > scheduleStartMs
              ? scheduleEndMs
              : scheduleStartMs > 0
                ? scheduleStartMs + 600000
                : now + 600000,
          name: String((params as any)?.claimedByName || (params as any)?.title || `Guest ${routeCurrentSlotNumber}`),
          avatar: normalizeLiveImageUri((params as any)?.claimedByAvatar || ""),
          claimedByUserId: routeOwnerId,
          approved: true,
        };
      }
    }

    return null;
  }, [
    authorityStageSlots,
    liveNowMs,
    memberAvatarByUserId,
    resolvedAvatarByUserId,
    liveProfileAvatarUri,
    session?.userId,
    params,
    routeCurrentSlotNumber,
    routeScheduleSlots,
  ]);

  const currentMainStageSlot = useMemo(() => {
    const feedSlots = liveScheduleFeedId ? feedScheduleSlotsForLive(liveScheduleFeedId) : [];
    return repairLiveMainStageSlotTimes({
      slot: currentMainStageSlotRaw,
      routeScheduleSlots,
      runtimeScheduleSlots,
      backendScheduleSlots,
      mergedScheduleSlots,
      feedScheduleSlots: feedSlots,
      ringClaimHints: getRingClaimHints(),
      routeParams: {
        scheduleStartMs: Number((params as any)?.scheduleStartMs || 0),
        scheduleEndMs: Number((params as any)?.scheduleEndMs || 0),
        currentSlotNumber: routeCurrentSlotNumber,
      },
      liveScheduleFeedId,
      context: "live-room",
    });
  }, [
    currentMainStageSlotRaw,
    routeScheduleSlots,
    runtimeScheduleSlots,
    backendScheduleSlots,
    mergedScheduleSlots,
    liveScheduleFeedId,
    feedScheduleTick,
    routeCurrentSlotNumber,
    (params as any)?.scheduleStartMs,
    (params as any)?.scheduleEndMs,
  ]);

  const canAdvanceScheduleRuntime =
    roleLooksLikeHost;

  const liveOnlineClaimedUserIds = useMemo(() => {
    const ids = new Set<string>();

    Object.values(liveViewerPresence || {}).forEach((viewer: any) => {
      const uid = String(viewer?.userId || "").trim();
      if (uid) ids.add(uid);
    });

    return ids;
  }, [liveViewerPresence]);

  function advanceToNextClaimedSlot(reason = "manual") {
    if (!canAdvanceScheduleRuntime) return;

    const now = Date.now();
    const sourceSlots = runtimeScheduleSlots.length ? runtimeScheduleSlots : backendScheduleSlots;

    const rows = sourceSlots
      .map((slot: any, index: number) => {
        const win = getScheduleSlotWindow(slot, index);
        const key = getRuntimeSlotKey(slot, index);
        const n = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);

        return {
          ...slot,
          runtimeSlotKey: key,
          slot: n,
          order: Number(slot?.order || n),
          startMs: Number(win.startMs || 0),
          endMs: Number(win.endMs || 0),
          durationMin: Math.max(1, Number(slot?.durationMin || 1)),
          claimedByUserId: String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim(),
        };
      })
      .filter((slot: any) => Number(slot?.slot || 0) > 0)
      .filter((slot: any) => !slot?.skipped)
      .filter((slot: any) => Number(slot.endMs || 0) > now)
      .sort((a: any, b: any) => Number(a.startMs || 0) - Number(b.startMs || 0));

    const current =
      rows.find((slot: any) => now >= Number(slot.startMs || 0) && now <= Number(slot.endMs || 0)) ||
      rows[0];

    if (!current) return;

    const target = rows.find((slot: any) => {
      if (String(slot.runtimeSlotKey) === String(current.runtimeSlotKey)) return false;
      const ownerId = String(slot?.claimedByUserId || "").trim();
      return !!ownerId;
    });

    if (!target) return;

    setRuntimeSlotOverrides((prev) => {
      const next: Record<string, any> = { ...(prev || {}) };

      const targetDurationMs = Math.max(1, Number(target.durationMin || 1)) * 60000;
      const currentDurationMs = Math.max(1, Number(current.durationMin || 1)) * 60000;

      next[String(target.runtimeSlotKey)] = {
        ...(next[String(target.runtimeSlotKey)] || {}),
        skipped: false,
        startMs: now,
        endMs: now + targetDurationMs,
        order: 1,
        slot: 1,
        slotNumber: 1,
        movedUp: true,
        movedUpAt: new Date(now).toISOString(),
      };

      next[String(current.runtimeSlotKey)] = {
        ...(next[String(current.runtimeSlotKey)] || {}),
        skipped: false,
        startMs: now + targetDurationMs,
        endMs: now + targetDurationMs + currentDurationMs,
        order: 2,
        slot: 2,
        slotNumber: 2,
        movedDown: true,
        movedDownAt: new Date(now).toISOString(),
      };

      return next;
    });

    console.log("KRISTO_SLOT_ADVANCED", {
      reason,
      oldSlot: current.slot,
      newLiveSlot: target.slot,
      newLiveUserId: target.claimedByUserId || "",
    });
  }

  // Auto-skip disabled.
  // Host/Pastor must manually move or skip slots; app should not skip empty/offline slots by itself.
  useEffect(() => {
    return;
  }, [canAdvanceScheduleRuntime, currentMainStageSlot, backendScheduleReady, liveNowMs]);

  useEffect(() => {
    /* debug log removed for live performance */
  }, [liveNowMs, currentMainStageSlot, activeStageSlots, claimedScheduleCards]);

  const rawRouteCanPublishMic =
    String((params as any).canPublishMic || "") === "1" ||
    String((params as any).mediaSlotPublisher || "") === "1" ||
    String((params as any).canPublish || "") === "1";
  const rawRouteCanPublishCamera = String((params as any).canPublishCamera || "") === "1";

  const routeMediaHostIds = String((params as any).mediaHostIds || "")
    .split(/[|,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const isDeclaredMediaHostForThisLive =
    !!currentUserId && routeMediaHostIds.includes(String(currentUserId));

  const routeClaimedByUserId = String((params as any)?.claimedByUserId || "").trim();
  const routeClaimsOwnSlot =
    !!currentUserId && routeClaimedByUserId === currentUserId;
  const routeOwnsPublishedSlot =
    routeClaimsOwnSlot &&
    (rawRouteCanPublishMic || rawRouteCanPublishCamera || routePublisherEligibleEarly);

  // Never trust Pastor/Host role from another church/media.
  // For scheduled media live, route publish is valid only for this live owner/media hosts.
  // V1 scheduled: route hints may prime mic session only — camera follows active-slot ownership.
  const routeCanPublish =
    isMediaInstantLive
      ? rawRouteCanPublishMic || rawRouteCanPublishCamera
      : routeOwnsPublishedSlot ||
        (rawRouteCanPublishMic &&
          (isPastorLiveOwner || isMediaOwnerHost || isDeclaredMediaHostForThisLive));

  const runtimeCurrentSlotNumber = Number((currentMainStageSlot as any)?.slot || 0);
  const rawCurrentSlotOwnerId = String((currentMainStageSlot as any)?.claimedByUserId || "").trim();
  const rawCurrentSlotNumber = runtimeCurrentSlotNumber;

  // Prevent backend refresh flicker from destroying live stage.
  // Keep last valid slot briefly while schedule refresh hydrates again.
  const stableCurrentSlotRef = useRef({
    slot: 0,
    ownerId: "",
    endMs: 0,
    updatedAt: 0,
  });

  if (rawCurrentSlotNumber > 0) {
    stableCurrentSlotRef.current = {
      slot: rawCurrentSlotNumber,
      ownerId: rawCurrentSlotOwnerId,
      endMs: Number(currentMainStageSlot?.endMs || 0),
      updatedAt: Date.now(),
    };
  } else if (routeCurrentSlotNumber > 0 && routeScheduleSlots.length > 0) {
    stableCurrentSlotRef.current = {
      slot: routeCurrentSlotNumber,
      ownerId: String(
        rawCurrentSlotOwnerId ||
          (params as any)?.claimedByUserId ||
          ""
      ).trim(),
      endMs: Number(currentMainStageSlot?.endMs || 0),
      updatedAt: Date.now(),
    };
  }

  const stableAgeMs =
    Date.now() - Number(stableCurrentSlotRef.current.updatedAt || 0);

  const stableSlotStillLive =
    Number(stableCurrentSlotRef.current.endMs || 0) <= 0 ||
    liveNowMs <= Number(stableCurrentSlotRef.current.endMs || 0);

  const shouldHoldPreviousSlot =
    rawCurrentSlotNumber === 0 &&
    stableCurrentSlotRef.current.slot > 0 &&
    stableAgeMs < 15000 &&
    stableSlotStillLive;

  const resolvedSlotNumber = shouldHoldPreviousSlot
    ? stableCurrentSlotRef.current.slot
    : rawCurrentSlotNumber > 0
      ? rawCurrentSlotNumber
      : routeCurrentSlotNumber;

  const currentSlotNumber = resolvedSlotNumber;

  const currentSlotOwnerId = (() => {
    if (claimEnterLockHeld && claimEnterLock?.routeClaimedByUserId) {
      return claimEnterLock.routeClaimedByUserId;
    }
    if (shouldHoldPreviousSlot) {
      return stableCurrentSlotRef.current.ownerId;
    }
    return (
      rawCurrentSlotOwnerId ||
      (resolvedSlotNumber === routeCurrentSlotNumber
        ? String((params as any)?.claimedByUserId || "").trim()
        : "")
    );
  })();

  const currentSlotStartMs = Number(currentMainStageSlot?.startMs || 0);
  const currentSlotEndMs = Number(currentMainStageSlot?.endMs || 0);

  const isMyScheduledLiveTurn =
    !isMediaInstantLive &&
    !!currentSlotNumber &&
    !!currentSlotOwnerId &&
    !!currentUserId &&
    currentSlotOwnerId === currentUserId &&
    isScheduleSlotCameraWindowOpen(
      {
        claimedByUserId: currentSlotOwnerId,
        startMs: currentSlotStartMs,
        endMs: currentSlotEndMs,
      },
      currentUserId,
      liveNowMs
    );

  const myClaimedStageSlot = !isMediaInstantLive
    ? authorityStageSlots
        .map((slot: any, index: number) => {
          const win = getScheduleSlotWindow(slot, index);

          return {
            ...slot,
            slot: Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1),
            order: Number(slot?.order || slot?.slot || slot?.slotNumber || index + 1),
            startMs: win.startMs,
            endMs: win.endMs,
            claimedByUserId: String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim(),
          };
        })
        .filter((slot: any) => {
          const endMs = Number(slot?.endMs || 0);

          // Expired claimed slot must not keep mic/camera authority.
          if (Number.isFinite(endMs) && endMs > 0 && liveNowMs > endMs) {
            return false;
          }

          return true;
        })
        .sort((a: any, b: any) => Number(a.startMs || 0) - Number(b.startMs || 0))
        .find((slot: any) => {
          const ownerId = String(slot?.claimedByUserId || "").trim();
          return !!ownerId && !!currentUserId && ownerId === currentUserId;
        })
    : null;

  const myClaimedSlotNumber = Number((myClaimedStageSlot as any)?.slot || 0);

  // V1: every non-expired claimed slot grants mic (multiple claims per user allowed).
  const myClaimedMicSlotNumbers = useMemo(() => {
    if (isMediaInstantLive || !currentUserId) return [] as number[];

    return authorityStageSlots
      .map((slot: any, index: number) => {
        const win = getScheduleSlotWindow(slot, index);
        const slotNum = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
        return {
          slot: slotNum,
          startMs: win.startMs,
          endMs: win.endMs,
          claimedByUserId: String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim(),
        };
      })
      .filter((slot: any) => slot.claimedByUserId === currentUserId)
      .filter((slot: any) => slot.slot >= 1)
      .filter((slot: any) => !Number(slot.endMs) || Number(slot.endMs) > liveNowMs)
      .map((slot: any) => Number(slot.slot));
  }, [authorityStageSlots, currentUserId, liveNowMs, isMediaInstantLive]);

  // Keep LiveKit publisher identity stable during slot reorder/move.
  // Prevent camera track destruction when slot temporarily changes.
  const stablePublisherSlotRef = useRef(0);

  // Current live stage must control publisher identity.
  // Do NOT permanently stick to old claimed slot.
  const preferredStableSlot = Number(
    currentSlotNumber ||
    myClaimedSlotNumber ||
    myOwnClaimedSlotNumber ||
    0
  );

  // Always follow the ACTIVE live slot owner.
  // Prevent old slot identity from remaining pinned forever.
  useEffect(() => {
    if (preferredStableSlot > 0) {
      stablePublisherSlotRef.current = preferredStableSlot;
    }
  }, [preferredStableSlot]);

  const stablePublisherSlotNumber = Number(
    stablePublisherSlotRef.current || preferredStableSlot || 1
  );

  const liveKitPublisherIdentity = useMemo(() => {
    const uid = String(currentUserId || "slot").trim();
    const slotNum = Math.max(
      1,
      Number(
        claimEnterLock?.routeSlotNumber ||
          stablePublisherSlotNumber ||
          routeCurrentSlotNumber ||
          (params as any)?.claimedSlotNumber ||
          (params as any)?.preferredSlotNumber ||
          1
      )
    );
    return `${uid.replace(/[^a-zA-Z0-9_]/g, "")}-slot-${slotNum}`;
  }, [
    currentUserId,
    claimEnterLock?.routeSlotNumber,
    stablePublisherSlotNumber,
    routeCurrentSlotNumber,
    (params as any)?.claimedSlotNumber,
    (params as any)?.preferredSlotNumber,
  ]);

  // V1: request approval removed. Requests never grant mic/camera.
  const approvedViewerStageSlot = null;
  const approvedViewerSlotNumber = 0;
  const approvedViewerSeatType = "viewer";
  const approvedViewerCanMic = false;
  const approvedViewerIsCurrentCameraTurn = false;

  const liveStageAuthorityBase = evaluateLiveStageAuthority({
    isMediaInstantLive,
    currentUserId,
    currentSlotNumber,
    currentSlotOwnerId,
    currentSlotStartMs,
    currentSlotEndMs,
    nowMs: liveNowMs,
    authority: liveMediaAuthority,
    isDeclaredMediaHostForThisLive,
    claimedMicSlotNumbers: myClaimedMicSlotNumbers,
    approvedViewerCanMic,
    approvedViewerIsCurrentCameraTurn,
    isPastorLiveOwner,
    roleLooksLikeHost,
    approvedViewerSeatType,
    churchSubscriptionActive,
  });

  const fastLiveAuth = useMemo(
    () =>
      evaluateFastLiveSessionAuthority({
        currentUserId,
        sessionRoleText,
        sessionChurchRole: String((session as any)?.churchRole || ""),
        routePastorUserId: routePastorCandidate,
        routeScheduleCreatorUserId: routeScheduleCreator,
        routeClaimedByUserId,
        currentSlotOwnerId,
      }),
    [
      currentUserId,
      sessionRoleText,
      (session as any)?.churchRole,
      routePastorCandidate,
      routeScheduleCreator,
      routeClaimedByUserId,
      currentSlotOwnerId,
    ]
  );

  const fastActiveSlotWindow = useMemo(
    () =>
      resolveFastActiveSlotWindow({
        currentUserId,
        currentSlotOwnerId,
        currentSlotStartMs,
        currentSlotEndMs,
        routeClaimedByUserId,
        routeScheduleStartMs: Number(String((params as any)?.scheduleStartMs || "").trim() || 0),
        routeScheduleEndMs: Number(String((params as any)?.scheduleEndMs || "").trim() || 0),
        nowMs: liveNowMs,
      }),
    [
      currentUserId,
      currentSlotOwnerId,
      currentSlotStartMs,
      currentSlotEndMs,
      routeClaimedByUserId,
      (params as any)?.scheduleStartMs,
      (params as any)?.scheduleEndMs,
      liveNowMs,
    ]
  );

  const liveStageAuthority = applyFastLiveStageAuthorityBoost(liveStageAuthorityBase, {
    isMediaInstantLive,
    fastSession: fastLiveAuth,
    fastSlotWindowOpen: fastActiveSlotWindow.windowOpen,
    churchSubscriptionActive,
    routePublisherEligible: routePublisherEligibleEarly,
  });

  let {
    pastorPermanentMicNow,
    mediaHostPermanentMicNow,
    userOwnsCurrentActiveSlot,
    userHasClaimedScheduleSlot,
    userIsAmongFirstNineClaimedSlots,
    canPublishClaimedMicNow,
    canPublishClaimedCameraNow,
    canPublishLiveVideoNow,
  } = liveStageAuthority;

  if (claimEnterLockHeld && claimEnterLock) {
    userOwnsCurrentActiveSlot = true;
    userHasClaimedScheduleSlot = true;
    if (claimEnterLock.canPublishCamera) {
      canPublishClaimedCameraNow = true;
      canPublishLiveVideoNow = true;
    }
    if (claimEnterLock.canPublishMic) {
      canPublishClaimedMicNow = true;
    }
  }

  const cameraPublishAllowedNow = resolveLiveCameraPublishAllowed({
    isMediaInstantLive,
    userOwnsCurrentActiveSlot,
    canPublishClaimedCameraNow,
  });

  const cameraPermissionSourceRef = useRef("");

  const isPastorForLiveRoom =
    !!currentUserId &&
    (liveMediaAuthority.isActualChurchPastor || actualChurchPastorUserId === currentUserId);

  const isApprovedMediaHostForLiveRoom =
    liveMediaAuthority.isMediaHost || isDeclaredMediaHostForThisLive;

  const isChurchAdminForLiveRoom =
    !!currentUserId &&
    (sessionRoleText.includes("admin") || routeRoleText.includes("admin")) &&
    (
      isMediaOwnerHost ||
      isPastorForLiveRoom ||
      isApprovedMediaHostForLiveRoom ||
      liveMediaAuthority.isMediaScheduleCreator
    );

  const isSystemAdminForLiveRoom =
    sessionRoleText.includes("system") ||
    sessionRoleText.includes("superadmin") ||
    routeRoleText.includes("system") ||
    routeRoleText.includes("superadmin");

  const isCurrentActiveSlotOwnerForLiveRoom =
    !!currentUserId && !!userOwnsCurrentActiveSlot && !!isMyScheduledLiveTurn;

  const canManageLiveHostActions =
    churchSubscriptionActive === true &&
    (isMediaInstantLive
      ? !!(
          isPastorForLiveRoom ||
          isApprovedMediaHostForLiveRoom ||
          isMediaOwnerHost ||
          isChurchAdminForLiveRoom ||
          isSystemAdminForLiveRoom
        )
      : !!(
          isPastorForLiveRoom ||
          isApprovedMediaHostForLiveRoom ||
          isChurchAdminForLiveRoom ||
          isSystemAdminForLiveRoom
        ));

  const canSeeLiveHostControls =
    isPastorForLiveRoom ||
    isApprovedMediaHostForLiveRoom ||
    isChurchAdminForLiveRoom ||
    isSystemAdminForLiveRoom ||
    isCurrentActiveSlotOwnerForLiveRoom;

  const canSeeActiveSlotOwnerPanel =
    isCurrentActiveSlotOwnerForLiveRoom && !canManageLiveHostActions;

  const canManageLive = canManageLiveHostActions;

  useEffect(() => {
    const resolved = resolveLiveCameraPermissionSource({
      isMediaInstantLive,
      userOwnsCurrentActiveSlot,
      canPublishClaimedCameraNow,
      cameraPublishAllowed: cameraPublishAllowedNow,
      rawRouteCanPublishCamera,
      claimEnterLockCamera: !!(claimEnterLockHeld && claimEnterLock?.canPublishCamera),
      isActualChurchPastor: liveMediaAuthority.isActualChurchPastor,
      isMediaHost: liveMediaAuthority.isMediaHost,
    });

    const logKey = `${resolved.enabled}|${resolved.source}|${currentUserId}|${currentSlotOwnerId}`;
    if (cameraPermissionSourceRef.current === logKey) return;
    cameraPermissionSourceRef.current = logKey;

    console.log("KRISTO_CAMERA_PERMISSION_SOURCE", {
      enabled: resolved.enabled,
      source: resolved.source,
      userOwnsCurrentActiveSlot,
      canPublishClaimedCameraNow,
      canPublishLiveVideoNow,
      cameraPublishAllowedNow,
      rawRouteCanPublishCamera,
      currentSlotOwnerId,
      currentUserId,
      isActualChurchPastor: liveMediaAuthority.isActualChurchPastor,
      isMediaHost: liveMediaAuthority.isMediaHost,
      canManageLive,
    });
  }, [
    isMediaInstantLive,
    userOwnsCurrentActiveSlot,
    canPublishClaimedCameraNow,
    canPublishLiveVideoNow,
    cameraPublishAllowedNow,
    rawRouteCanPublishCamera,
    claimEnterLockHeld,
    claimEnterLock?.canPublishCamera,
    liveMediaAuthority.isActualChurchPastor,
    liveMediaAuthority.isMediaHost,
    currentUserId,
    currentSlotOwnerId,
    canManageLive,
  ]);

  const scheduledPublisherSlotReady =
    isMediaInstantLive ||
    cameraPublishAllowedNow ||
    (!!currentSlotNumber && userOwnsCurrentActiveSlot);

  // Camera publish is slot-owned only — route pastor/host hints must not unlock camera.
  const liveKitCameraOverrideReady = cameraPublishAllowedNow;

  const pastorCameraPolicyLogRef = useRef("");

  useEffect(() => {
    if (isMediaInstantLive || !liveMediaAuthority.isActualChurchPastor) return;

    const hasClaimedSlot = userHasClaimedScheduleSlot || !!myClaimedStageSlot;
    const mySlotStartMs = Number(
      myClaimedStageSlot?.startMs || currentSlotStartMs || 0
    );
    const mySlotEndMs = Number(myClaimedStageSlot?.endMs || currentSlotEndMs || 0);
    const slotEnded = mySlotEndMs > 0 && liveNowMs >= mySlotEndMs;
    const slotEarly = mySlotStartMs > liveNowMs;

    let event = "";
    let logKey = "";

    if (!hasClaimedSlot) {
      event = "KRISTO_LIVE_PASTOR_MIC_ONLY_NO_SLOT";
      logKey = "mic-only-no-slot";
    } else if (cameraPublishAllowedNow) {
      event = "KRISTO_LIVE_SLOT_CAMERA_ALLOWED_NOW";
      logKey = `camera-allowed-${currentSlotNumber}`;
    } else if (slotEnded) {
      event = "KRISTO_LIVE_SLOT_CAMERA_ENDED_DISABLED";
      logKey = `camera-ended-${currentSlotNumber}`;
    } else if (slotEarly || !userOwnsCurrentActiveSlot) {
      event = "KRISTO_LIVE_SLOT_CAMERA_BLOCKED_EARLY";
      logKey = `camera-blocked-${currentSlotNumber}-${mySlotStartMs}`;
    }

    if (!event || pastorCameraPolicyLogRef.current === logKey) return;
    pastorCameraPolicyLogRef.current = logKey;

    console.log(event, {
      currentUserId,
      currentSlotNumber,
      currentSlotOwnerId,
      hasClaimedSlot,
      mySlotStartMs,
      mySlotEndMs,
      liveNowMs,
      canPublishLiveVideoNow,
      canPublishClaimedMicNow,
      userOwnsCurrentActiveSlot,
    });
  }, [
    isMediaInstantLive,
    liveMediaAuthority.isActualChurchPastor,
    userHasClaimedScheduleSlot,
    myClaimedStageSlot,
    canPublishLiveVideoNow,
    canPublishClaimedMicNow,
    userOwnsCurrentActiveSlot,
    currentSlotNumber,
    currentSlotOwnerId,
    currentSlotStartMs,
    currentSlotEndMs,
    liveNowMs,
    currentUserId,
  ]);

  const canUseLiveMic = canPublishClaimedMicNow;

  // Sticky for the live session: token fetch must not follow per-tick camera/slot flags.
  const [liveKitSessionMayPublish, setLiveKitSessionMayPublish] = useState(
    () => {
      if (isMediaInstantLive) {
        return routeCanPublishEarly;
      }
      if (routeOwnsPublishedSlot && routePublisherEligibleEarly) {
        return true;
      }
      return (
        fastLiveAuthEarly.trustedIsActualChurchPastor ||
        fastLiveAuthEarly.trustedIsMediaScheduleCreator ||
        fastLiveAuthEarly.trustedOwnsActiveSlot ||
        isDeclaredMediaHostForThisLive ||
        myClaimedMicSlotNumbers.length > 0
      );
    }
  );

  useEffect(() => {
    setLiveKitSessionMayPublish((prev) => {
      if (prev) return true;
      if (isMediaInstantLive) {
        return (
          canPublishClaimedMicNow ||
          canPublishLiveVideoNow ||
          routeCanPublish ||
          isPastorLiveOwner ||
          roleLooksLikeHost
        );
      }
      if (routeOwnsPublishedSlot && canPublishLiveVideoNow) return true;
      return (
        canPublishClaimedMicNow ||
        canPublishLiveVideoNow ||
        fastLiveAuth.trustedIsActualChurchPastor ||
        fastLiveAuth.trustedOwnsActiveSlot
      );
    });
  }, [
    canPublishClaimedMicNow,
    canPublishLiveVideoNow,
    routeCanPublish,
    routeOwnsPublishedSlot,
    isMediaInstantLive,
    isPastorLiveOwner,
    roleLooksLikeHost,
    fastLiveAuth.trustedIsActualChurchPastor,
    fastLiveAuth.trustedOwnsActiveSlot,
  ]);

  const liveMicPublisherReady = canPublishClaimedMicNow;

  // Mic override is mic-only; must not imply camera.
  const liveKitMicOverrideReady = canPublishClaimedMicNow;

  // Publisher LiveKit mount: mic-eligible OR current camera slot owner.
  const mountLiveKitPublisherStage = canPublishClaimedMicNow || cameraPublishAllowedNow;

  const routeFastPublisherMount =
    !!currentUserId &&
    routePublisherEligibleEarly &&
    routeClaimedByUserIdEarly === currentUserId;
  const effectiveMountLiveKitPublisherStage =
    mountLiveKitPublisherStage || routeFastPublisherMount;

  useEffect(() => {
    if (liveFastAuthInitialLoggedRef.current) return;
    liveFastAuthInitialLoggedRef.current = true;
    console.log("KRISTO_LIVE_FAST_AUTH_INITIAL", {
      currentUserId,
      trustedIsActualChurchPastor: fastLiveAuth.trustedIsActualChurchPastor,
      trustedIsMediaScheduleCreator: fastLiveAuth.trustedIsMediaScheduleCreator,
      trustedOwnsActiveSlot: fastLiveAuth.trustedOwnsActiveSlot,
      fastSlotWindowOpen: fastActiveSlotWindow.windowOpen,
      canPublishLiveVideoNow,
      canPublishClaimedCameraNow,
      mountLiveKitPublisherStage,
      liveKitSessionMayPublish,
      reasons: fastLiveAuth.reasons,
    });
  }, [
    currentUserId,
    fastLiveAuth,
    fastActiveSlotWindow.windowOpen,
    canPublishLiveVideoNow,
    canPublishClaimedCameraNow,
    mountLiveKitPublisherStage,
    liveKitSessionMayPublish,
  ]);

  useEffect(() => {
    if (!resolvedActualChurchPastorUserId || liveFastAuthResolutionLoggedRef.current) return;

    const resolvedIsPastor = resolvedActualChurchPastorUserId === currentUserId;
    const fastWasPastor = fastLiveAuth.trustedIsActualChurchPastor;

    if (resolvedIsPastor && fastWasPastor) {
      liveFastAuthResolutionLoggedRef.current = true;
      console.log("KRISTO_LIVE_FAST_AUTH_CONFIRMED", {
        currentUserId,
        resolvedActualChurchPastorUserId,
        canPublishLiveVideoNow,
        mountLiveKitPublisherStage,
      });
      return;
    }

    if (!resolvedIsPastor && fastWasPastor) {
      liveFastAuthResolutionLoggedRef.current = true;
      console.log("KRISTO_LIVE_FAST_AUTH_DOWNGRADED", {
        currentUserId,
        resolvedActualChurchPastorUserId,
        canPublishLiveVideoNow,
        mountLiveKitPublisherStage,
      });
      return;
    }

    if (resolvedIsPastor && !fastWasPastor) {
      liveFastAuthResolutionLoggedRef.current = true;
      console.log("KRISTO_LIVE_FAST_AUTH_CONFIRMED", {
        currentUserId,
        resolvedActualChurchPastorUserId,
        lateConfirm: true,
        canPublishLiveVideoNow,
        mountLiveKitPublisherStage,
      });
    }
  }, [
    resolvedActualChurchPastorUserId,
    currentUserId,
    fastLiveAuth.trustedIsActualChurchPastor,
    canPublishLiveVideoNow,
    mountLiveKitPublisherStage,
  ]);

  useEffect(() => {
    logMediaLiveV1StageAuthority("live-room", liveStageAuthority, {
      isMediaInstantLive,
      currentSlotNumber,
      currentSlotOwnerId,
      currentUserId,
      claimedMicSlotNumbers: myClaimedMicSlotNumbers,
      routeCurrentSlotNumber,
      userHasClaimedScheduleSlot,
    });
    console.log("KRISTO_LIVE_CURRENT_SLOT_RESOLVED", {
      routeCurrentSlotNumber,
      runtimeCurrentSlotNumber,
      resolvedSlotNumber: currentSlotNumber,
      currentSlotOwnerId,
      currentUserId,
      userOwnsCurrentActiveSlot,
      hasRouteSlots: routeScheduleSlots.length > 0,
      currentMainStageSlot: currentMainStageSlot
        ? {
            slot: currentMainStageSlot.slot,
            claimedByUserId: currentMainStageSlot.claimedByUserId,
            startMs: currentMainStageSlot.startMs,
            endMs: currentMainStageSlot.endMs,
          }
        : null,
    });
    console.log("KRISTO_LIVE_AUTH_RULES", {
      isMediaInstantLive,
      pastorPermanentMicNow,
      mediaHostPermanentMicNow,
      userOwnsCurrentActiveSlot,
      userHasClaimedScheduleSlot,
      userIsAmongFirstNineClaimedSlots,
      canPublishClaimedMicNow,
      canPublishClaimedCameraNow,
      canPublishLiveVideoNow,
      liveKitSessionMayPublish,
      mountLiveKitPublisherStage,
      liveKitMicOverrideReady,
      scheduledPublisherSlotReady,
    });
    console.log("KRISTO_LIVE_CLAIMED_SLOTS_FOR_USER", {
      currentUserId,
      myClaimedMicSlotNumbers,
      myClaimedSlotNumber,
      myOwnClaimedSlotNumber,
    });
    console.log("KRISTO_LIVE_CURRENT_CAMERA_OWNER", {
      currentSlotNumber,
      currentSlotOwnerId,
      userOwnsCurrentActiveSlot,
      currentMainStageSlot: currentMainStageSlot
        ? {
            slot: currentMainStageSlot.slot,
            claimedByUserId: currentMainStageSlot.claimedByUserId,
            startMs: currentMainStageSlot.startMs,
            endMs: currentMainStageSlot.endMs,
          }
        : null,
    });
    console.log("KRISTO_LIVE_MIC_AUTHORITY", {
      canPublishClaimedMicNow,
      liveKitMicOverrideReady,
      liveMicPublisherReady,
      canUseLiveMic,
    });
    console.log("KRISTO_LIVE_CAMERA_AUTHORITY", {
      canPublishClaimedCameraNow,
      canPublishLiveVideoNow,
      scheduledPublisherSlotReady,
      userOwnsCurrentActiveSlot,
      currentSlotStartMs,
      currentSlotEndMs,
      liveNowMs,
    });
    if (
      currentSlotStartMs > 0 &&
      currentSlotEndMs > currentSlotStartMs &&
      canPublishLiveVideoNow
    ) {
      console.log("KRISTO_LIVE_CAMERA_GATE_READY_WITH_TIME", {
        currentSlotNumber,
        currentSlotOwnerId,
        currentSlotStartMs,
        currentSlotEndMs,
        liveNowMs,
        canPublishLiveVideoNow,
      });
    }
    console.log("KRISTO_ACTIVE_SLOT_OWNER", {
      currentSlotNumber,
      currentSlotOwnerId,
      currentUserId,
      userOwnsCurrentActiveSlot,
      currentMainStageSlot: currentMainStageSlot
        ? {
            slot: currentMainStageSlot.slot,
            claimedByUserId: currentMainStageSlot.claimedByUserId,
            claimedByName: currentMainStageSlot.claimedByName || currentMainStageSlot.name,
          }
        : null,
    });
    console.log("KRISTO_CAMERA_AUTH_FINAL", {
      canPublishLiveVideoNow,
      canPublishClaimedCameraNow,
      cameraPublishAllowedNow,
      userOwnsCurrentActiveSlot,
      liveKitSessionMayPublish,
      mountLiveKitPublisherStage,
      scheduledPublisherSlotReady,
      liveKitCameraOverrideReady,
    });
    console.log("KRISTO_STAGE_AUTHORITY", liveStageAuthority);
  }, [
    isMediaInstantLive,
    pastorPermanentMicNow,
    mediaHostPermanentMicNow,
    userOwnsCurrentActiveSlot,
    userHasClaimedScheduleSlot,
    userIsAmongFirstNineClaimedSlots,
    canPublishClaimedMicNow,
    canPublishClaimedCameraNow,
    canPublishLiveVideoNow,
    cameraPublishAllowedNow,
    liveKitSessionMayPublish,
    liveStageAuthority,
    myClaimedMicSlotNumbers,
    mountLiveKitPublisherStage,
    liveKitMicOverrideReady,
    scheduledPublisherSlotReady,
    currentUserId,
    myClaimedSlotNumber,
    myOwnClaimedSlotNumber,
    currentSlotNumber,
    currentSlotOwnerId,
    currentMainStageSlot,
    routeCurrentSlotNumber,
    runtimeCurrentSlotNumber,
    liveMicPublisherReady,
    canUseLiveMic,
  ]);

  function normalizeLiveImageUri(value: any) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (
      v.startsWith("http://") ||
      v.startsWith("https://") ||
      v.startsWith("file://") ||
      v.startsWith("data:image/")
    ) {
      return v;
    }
    const base = String(getApiBase() || process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    if (v.startsWith("/")) return `${base}${v}`;
    if (v.includes("uploads/")) return `${base}/${v.replace(/^\//, "")}`;
    return v;
  }

  function isImageAvatar(value: any) {
    const v = normalizeLiveImageUri(value);
    return (
      v.startsWith("http://") ||
      v.startsWith("https://") ||
      v.startsWith("file://") ||
      v.startsWith("data:image/")
    );
  }

  function resolveParticipantAvatarUri(slot: any) {
    const userId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();

    for (const raw of collectClaimedAvatarCandidates(slot)) {
      const uri = normalizeLiveImageUri(raw);
      if (isImageAvatar(uri)) {
        console.log("KRISTO_CLAIMED_AVATAR_RESOLVED", {
          userId,
          source: "slot-field",
          hasUrl: true,
        });
        return uri;
      }
    }

    if (userId && memberAvatarByUserId[userId]) {
      const uri = normalizeLiveImageUri(memberAvatarByUserId[userId]);
      if (isImageAvatar(uri)) {
        console.log("KRISTO_CLAIMED_AVATAR_RESOLVED", {
          userId,
          source: "member-directory",
          hasUrl: true,
        });
        return uri;
      }
    }

    if (userId && resolvedAvatarByUserId[userId]) {
      const uri = normalizeLiveImageUri(resolvedAvatarByUserId[userId]);
      if (isImageAvatar(uri)) {
        console.log("KRISTO_CLAIMED_AVATAR_RESOLVED", {
          userId,
          source: "profile-cache",
          hasUrl: true,
        });
        return uri;
      }
    }

    if (userId && userId === String(session?.userId || "").trim()) {
      const sessionAvatar = String(
        liveProfileAvatarUri ||
          (session as any)?.avatarUri ||
          (session as any)?.avatarUrl ||
          (session as any)?.profileImage ||
          (session as any)?.photoURL ||
          (session as any)?.image ||
          (session as any)?.avatar ||
          ""
      ).trim();

      const uri = normalizeLiveImageUri(sessionAvatar);
      if (isImageAvatar(uri)) {
        console.log("KRISTO_CLAIMED_AVATAR_RESOLVED", {
          userId,
          source: "session-profile-expanded",
          hasUrl: true,
        });
        return uri;
      }
    }

    if (
      userId &&
      userId === String((params as any)?.claimedByUserId || "").trim() &&
      (params as any)?.claimedByAvatar
    ) {
      const uri = normalizeLiveImageUri((params as any).claimedByAvatar);
      if (isImageAvatar(uri)) {
        console.log("KRISTO_CLAIMED_AVATAR_RESOLVED", {
          userId,
          source: "route-param",
          hasUrl: true,
        });
        return uri;
      }
    }

    console.log("KRISTO_CLAIMED_AVATAR_RESOLVED", {
      userId,
      source: "initials-fallback",
      hasUrl: false,
    });
    return "";
  }

  const scheduledLiveStageOwnerId = currentMainStageSlot
    ? `stage-${currentMainStageSlot.slot}`
    : null;

  const displayScheduleSlots = useMemo(() => {
    const sourceSlots = authorityStageSlots.length
      ? authorityStageSlots
      : runtimeScheduleSlots.length
        ? runtimeScheduleSlots
        : activeStageSlots;

    return sourceSlots
      .map((slot: any, index: number) => {
        const win = getScheduleSlotWindow(slot, index);
        const slotNumber = Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1);
        return {
          ...slot,
          slot: slotNumber,
          slotNumber,
          order: Number(slot?.order || slotNumber),
          startMs: Number(win?.startMs || slot?.startMs || 0),
          endMs: Number(win?.endMs || slot?.endMs || 0),
        };
      })
      .filter((slot: any) => Number(slot?.slot || 0) > 0 && !slot?.skipped);
  }, [authorityStageSlots, runtimeScheduleSlots, activeStageSlots]);

  function enrichLiveRoomDisplaySlot(slot: any, queueState?: string) {
    const slotNumber = Number(slot?.slot || slot?.slotNumber || 0);
    const claimedByUserId = String(
      slot?.claimedByUserId || slot?.claimedBy?.userId || ""
    ).trim();
    const claimedByName = String(
      slot?.claimedByName || slot?.claimedBy?.name || slot?.name || ""
    ).trim();

    const avatarResolution = resolveMediaSlotClaimedAvatar({
      slot,
      slotId: String(slot?.id || slot?.slotId || slotNumber),
      apiBase: getApiBase(),
      profileAvatarByUserId: resolvedAvatarByUserId,
      memberAvatarByUserId: memberAvatarByUserId,
      sessionAvatarUri: liveProfileAvatarUri,
      sessionUserId: String(session?.userId || ""),
    });

    const avatar = avatarResolution.uri || resolveParticipantAvatarUri(slot);
    const roleRaw = String(
      slot?.role || slot?.roleLabel || slot?.claimedByRole || ""
    ).toLowerCase();
    const isLeader =
      roleRaw.includes("pastor") ||
      roleRaw.includes("leader") ||
      roleRaw.includes("admin");

    return {
      ...slot,
      id: `stage-${slotNumber}`,
      slot: slotNumber,
      slotNumber,
      order: Number(slot?.order || slotNumber),
      claimedByUserId,
      claimedByName: claimedByName || `Guest ${slotNumber}`,
      name: claimedByName || `Guest ${slotNumber}`,
      role: isLeader
        ? "Leader"
        : String(slot?.role || slot?.roleLabel || slot?.claimedByRole || "Speaker"),
      avatar,
      title: String(slot?.title || slot?.name || slot?.slotLabel || `Slot ${slotNumber}`),
      subtitle: String(slot?.subtitle || slot?.task || slot?.roleLabel || "Open speaking slot"),
      queueState,
      approved: true,
    };
  }

  const liveRoomSlotDisplayQueue = useMemo(
    () =>
      buildLiveRoomSlotDisplayQueue({
        slots: displayScheduleSlots,
        nowMs: liveNowMs,
        sideRailLimit: 4,
        bottomLimit: 4,
        logContext: "live-room",
      }),
    [displayScheduleSlots, liveNowMs]
  );

  const sideRailDisplaySlots = useMemo(
    () =>
      liveRoomSlotDisplayQueue.sideRailSlots.map((item) =>
        enrichLiveRoomDisplaySlot(item.slot, item.state)
      ),
    [
      liveRoomSlotDisplayQueue.sideRailSlots,
      memberAvatarByUserId,
      resolvedAvatarByUserId,
      liveProfileAvatarUri,
      session?.userId,
    ]
  );

  const bottomDisplaySlots = useMemo(
    () =>
      liveRoomSlotDisplayQueue.bottomSlots.map((item) =>
        enrichLiveRoomDisplaySlot(item.slot, item.state)
      ),
    [
      liveRoomSlotDisplayQueue.bottomSlots,
      memberAvatarByUserId,
      resolvedAvatarByUserId,
      liveProfileAvatarUri,
      session?.userId,
    ]
  );

  const scheduledStagePeople = useMemo(() => {
    const bySlot = new Map<number, any>();
    displayScheduleSlots.forEach((slot: any, index: number) => {
      if (!isClaimedScheduleSlot(slot)) return;
      if (isScheduleSlotExpired(slot, liveNowMs)) return;
      const enriched = enrichLiveRoomDisplaySlot(slot);
      const n = Number(enriched.slot || 0);
      if (n > 0) bySlot.set(n, enriched);
    });
    return Array.from(bySlot.values()).sort(
      (a: any, b: any) =>
        Number(a.startMs || 0) - Number(b.startMs || 0) ||
        Number(a.slot || 0) - Number(b.slot || 0)
    );
  }, [
    displayScheduleSlots,
    liveNowMs,
    memberAvatarByUserId,
    resolvedAvatarByUserId,
    liveProfileAvatarUri,
    session?.userId,
  ]);

  const scheduledWaitingPeople = useMemo(() => {
    return waitingStageSlots.map((slot: any) => ({
      id: `waiting-${slot.slot}`,
      slot: Number(slot.slot || 0),
      name: String(slot?.name || `Guest ${slot.slot}`),
      role: String(slot?.role || "Guest"),
    }));
  }, [waitingStageSlots]);

  const scheduledHiddenCount = hiddenStageSlots.length;

  const visibleQueueSlots = sideRailDisplaySlots;

  const openClaimableSlots = useMemo(() => {
    const now = liveNowMs;
    return displayScheduleSlots
      .filter((slot: any) => !isClaimedScheduleSlot(slot))
      .filter((slot: any) => !isScheduleSlotExpired(slot, now))
      .filter((slot: any) => Number(slot?.startMs || 0) > now)
      .map((slot: any) => enrichLiveRoomDisplaySlot(slot, "open_claimable"))
      .sort(
        (a: any, b: any) =>
          Number(a.startMs || 0) - Number(b.startMs || 0) ||
          Number(a.slot || 0) - Number(b.slot || 0)
      );
  }, [
    displayScheduleSlots,
    liveNowMs,
    memberAvatarByUserId,
    resolvedAvatarByUserId,
    liveProfileAvatarUri,
    session?.userId,
  ]);

  const bottomStageDisplayBoxes = useMemo(() => {
    const BOTTOM_COUNT = 4;
    const usedKeys = new Set<string>();
    const markUsed = (slot: any) => {
      const key = liveRoomDisplaySlotKey(slot);
      if (key) usedKeys.add(key);
    };

    if (liveRoomSlotDisplayQueue.activeSlot) {
      markUsed(liveRoomSlotDisplayQueue.activeSlot.slot);
    }
    liveRoomSlotDisplayQueue.sideRailSlots.forEach((item) => markUsed(item.slot));

    const bottomPool: any[] = [];
    bottomDisplaySlots.forEach((slot: any) => {
      bottomPool.push(slot);
      markUsed(slot);
    });

    const supplementalOpen = openClaimableSlots
      .filter((slot: any) => {
        const key = liveRoomDisplaySlotKey(slot);
        return key && !usedKeys.has(key);
      })
      .sort(
        (a: any, b: any) =>
          Number(a.startMs || 0) - Number(b.startMs || 0) ||
          Number(a.slot || 0) - Number(b.slot || 0)
      );

    supplementalOpen.forEach((slot: any) => {
      if (bottomPool.length >= BOTTOM_COUNT) return;
      const key = liveRoomDisplaySlotKey(slot);
      if (!key || usedKeys.has(key)) return;
      bottomPool.push(slot);
      markUsed(slot);
    });

    return Array.from({ length: BOTTOM_COUNT }, (_, index) => {
      const slot = bottomPool[index];
      if (slot) {
        const isOpen = String(slot?.queueState || "") === "open_claimable";
        return {
          kind: isOpen ? ("open" as const) : ("claimed" as const),
          slot,
          index,
        };
      }
      return { kind: "locked_closed" as const, index };
    });
  }, [
    bottomDisplaySlots,
    openClaimableSlots,
    liveRoomSlotDisplayQueue.activeSlot,
    liveRoomSlotDisplayQueue.sideRailSlots,
  ]);

  useEffect(() => {
    bottomStageDisplayBoxes.forEach((box) => {
      const slot = (box as any).slot;
      console.log("KRISTO_LIVE_ROOM_BOTTOM_SLOT_CARD_STATE", {
        index: box.index,
        state:
          box.kind === "open"
            ? "open_claimable"
            : box.kind === "claimed"
              ? "claimed"
              : "locked_closed",
        slotId: slot ? liveStageSlotLogId(slot) : "",
        slotNumber: slot ? Number(slot?.slot || slot?.slotNumber || 0) : null,
        claimedByName: slot ? String(slot?.claimedByName || slot?.name || "") : "",
        startMs: slot ? Number(slot?.startMs || 0) : null,
        endMs: slot ? Number(slot?.endMs || 0) : null,
      });
    });
  }, [bottomStageDisplayBoxes]);

  const hostDrawerQueueEntries = useMemo(
    () => [...sideRailDisplaySlots, ...bottomDisplaySlots].slice(0, 8),
    [sideRailDisplaySlots, bottomDisplaySlots]
  );

  const prevActiveStageSlotRef = useRef<any>(null);
  const expiredStageSlotIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isMediaInstantLive) return;

    const now = liveNowMs;
    const sourceSlots = authorityStageSlots.length
      ? authorityStageSlots
      : runtimeScheduleSlots.length
        ? runtimeScheduleSlots
        : activeStageSlots;

    sourceSlots.forEach((slot: any, index: number) => {
      if (!isClaimedScheduleSlot(slot)) return;
      const win = getScheduleSlotWindow(slot, index);
      const row = {
        ...slot,
        startMs: Number(win.startMs || slot?.startMs || 0),
        endMs: Number(win.endMs || slot?.endMs || 0),
      };
      if (!isScheduleSlotExpired(row, now)) return;

      const slotId = liveStageSlotLogId(row);
      if (!slotId || expiredStageSlotIdsRef.current.has(slotId)) return;
      expiredStageSlotIdsRef.current.add(slotId);

      console.log("KRISTO_LIVE_ROOM_SLOT_EXPIRED", {
        slotId,
        slotNumber: Number(row?.slot || row?.slotNumber || 0),
        claimedByName: String(row?.claimedByName || row?.name || ""),
        startMs: Number(row?.startMs || 0),
        endMs: Number(row?.endMs || 0),
        reason: "slot-window-ended",
      });
    });

    const prev = prevActiveStageSlotRef.current;
    const next = currentMainStageSlot;
    const prevSlot = Number(prev?.slot || 0);
    const nextSlot = Number(next?.slot || 0);

    if (prev && (!next || prevSlot !== nextSlot)) {
      if (isScheduleSlotExpired(prev, now)) {
        console.log("KRISTO_LIVE_ROOM_SLOT_EXPIRED", {
          slotId: liveStageSlotLogId(prev),
          slotNumber: prevSlot,
          claimedByName: String(prev?.claimedByName || prev?.name || ""),
          startMs: Number(prev?.startMs || 0),
          endMs: Number(prev?.endMs || 0),
          reason: "active-slot-window-ended",
        });
      }
    }

    if (next && prevSlot !== nextSlot) {
      const changeReason = !prev
        ? "initial-active-slot"
        : isScheduleSlotExpired(prev, now)
          ? "previous-slot-expired"
          : "next-active-window";

      console.log("KRISTO_LIVE_ROOM_ACTIVE_SLOT_CHANGED", {
        slotId: liveStageSlotLogId(next),
        slotNumber: nextSlot,
        claimedByName: String(next?.claimedByName || next?.name || ""),
        startMs: Number(next?.startMs || 0),
        endMs: Number(next?.endMs || 0),
        previousSlotNumber: prevSlot || null,
        reason: changeReason,
      });

      if (prev && isScheduleSlotExpired(prev, now)) {
        console.log("KRISTO_LIVE_ROOM_STAGE_PROMOTED", {
          slotId: liveStageSlotLogId(next),
          slotNumber: nextSlot,
          claimedByName: String(next?.claimedByName || next?.name || ""),
          startMs: Number(next?.startMs || 0),
          endMs: Number(next?.endMs || 0),
          previousSlotNumber: prevSlot,
          reason: "automatic-time-handoff",
        });
      }
    }

    prevActiveStageSlotRef.current = next;
  }, [currentMainStageSlot, liveNowMs, isMediaInstantLive, authorityStageSlots, runtimeScheduleSlots, activeStageSlots]);

  async function claimOpenScheduleSlotFromLive(slot: any) {
    const slotId = String(slot?.id || slot?.slotId || "").trim();

    const paramSourceScheduleId = String((params as any)?.sourceScheduleId || "").trim();
    const paramLiveId = String((params as any)?.liveId || "").trim();
    const scheduleKey = String(liveScheduleFeedId || paramSourceScheduleId || paramLiveId || "").trim();
    const feedSource: any[] = Array.isArray(feedList()) ? feedList() : [];

    const matchingFeedItem = feedSource.find((item: any) => {
      const id = String(item?.id || "").trim();
      const sourceId = String(item?.sourceScheduleId || item?.liveId || item?.scheduleId || "").trim();
      return (
        id === scheduleKey ||
        sourceId === scheduleKey ||
        String(item?.id || "").startsWith("feed_") && String(item?.sourceScheduleId || "") === scheduleKey
      );
    });

    const postId = String(
      matchingFeedItem?.id ||
        (String(scheduleKey).startsWith("feed_") ? scheduleKey : "")
    ).trim();

    const currentUserId = String(session?.userId || "").trim();

    if (!slotId || !postId || !currentUserId) {
      Alert.alert("Claim unavailable", "This slot cannot be claimed right now.");
      return;
    }

    const name =
      String((session as any)?.name || (session as any)?.displayName || (session as any)?.fullName || "").trim() ||
      liveProfileName ||
      "Church Member";

    const beforeClaimAvatar = await ensureProfileAvatarUploadedBeforeClaim({
      userId: currentUserId,
      session: session as any,
      profileAvatarUri: liveProfileAvatarUri,
    });
    const uploadedClaimAvatar = beforeClaimAvatar.uploadedUrl;

    const claimAvatarUri = uploadedClaimAvatar
      ? uploadedClaimAvatar
      : sanitizePersistedClaimAvatarUri(liveProfileAvatarUri, "live-room-claim-profile") ||
        sanitizePersistedClaimAvatarUri((session as any)?.avatarUrl, "live-room-claim-session-url") ||
        "";

    const viewerChurchId = String((session as any)?.churchId || "").trim();
    const scheduleChurchId = resolveScheduleChurchId(
      matchingFeedItem || { churchId: (params as any)?.churchId },
      viewerChurchId
    );
    const claimPayload = {
      slotId,
      userId: currentUserId,
      name,
      role: String((session as any)?.role || "Member"),
      avatarUri: claimAvatarUri,
      avatarUrl: claimAvatarUri,
      claimedByAvatarUri: claimAvatarUri,
      claimedByAvatar: claimAvatarUri,
      claimedByPhotoUrl: claimAvatarUri,
      claimantHomeChurchId: viewerChurchId,
    };

    try {
      const res: any = await apiPost(
        "/api/church/feed",
        buildScheduleSlotClaimBody({
          postId,
          scheduleFeedId: postId,
          slotId,
          claim: claimPayload,
          scheduleItem: matchingFeedItem,
          viewerChurchId,
        }),
        {
          headers: getKristoHeaders({
            userId: currentUserId,
            role: String((session as any)?.role || "Member") as KristoRole,
            churchId: viewerChurchId,
          }),
        }
      );

      if (res?.ok === false) {
        Alert.alert("Slot not claimed", String(res?.error || "This slot may already be claimed."));
        return;
      }

      await refetchTargetScheduleAfterClaim({
        postId,
        scheduleChurchId,
        slotId,
        viewerChurchId,
        viewerUserId: currentUserId,
        viewerRole: String((session as any)?.role || "Member"),
      });

      const key = getRuntimeSlotKey(slot, Math.max(0, Number(slot.slot || 1) - 1));
      const savedSlot = res?.data?.slot || res?.slot || null;
      const persistedAvatarUri =
        resolvePersistedClaimAvatarUri(savedSlot) ||
        claimAvatarUri;

      setRuntimeSlotOverrides((prev) => ({
        ...(prev || {}),
        [key]: {
          ...((prev || {})[key] || {}),
          ...(savedSlot || {}),
          claimed: true,
          isClaimed: true,
          status: "claimed",
          claimedByUserId: currentUserId,
          claimedByName: name,
          claimedByAvatarUri: persistedAvatarUri,
          claimedByAvatar: persistedAvatarUri,
          claimedByPhotoUrl: persistedAvatarUri,
          claimedBy: {
            ...(typeof savedSlot?.claimedBy === "object" ? savedSlot.claimedBy : {}),
            slotId,
            userId: currentUserId,
            name,
            role: String((session as any)?.role || "Member"),
            avatarUri: persistedAvatarUri,
          },
        },
      }));

      const syncedSlot = {
        ...slot,
        ...(savedSlot || {}),
        id: slotId,
        slotId,
        feedId: postId,
        sourceScheduleId: postId,
        claimed: true,
        isClaimed: true,
        status: "claimed",
        claimedByUserId: currentUserId,
        claimedByName: name,
        claimedByAvatarUri: persistedAvatarUri,
        claimedByAvatar: persistedAvatarUri,
        claimedByPhotoUrl: persistedAvatarUri,
        claimedBy: {
          ...(typeof savedSlot?.claimedBy === "object" ? savedSlot.claimedBy : {}),
          slotId,
          userId: currentUserId,
          name,
          role: String((session as any)?.role || "Member"),
          avatarUri: persistedAvatarUri,
        },
      } as any;

      syncUserClaimedSlotStore(postId, slotId, syncedSlot);
      writeRingClaimHint({
        userId: currentUserId,
        feedId: postId,
        slotId,
        slotNumber: Number(syncedSlot?.slot || syncedSlot?.slotNumber || 0),
        title: String(syncedSlot?.title || syncedSlot?.task || syncedSlot?.slotLabel || syncedSlot?.name || ""),
        claimedByUserId: currentUserId,
        claimedByName: name,
        claimedByAvatarUri: persistedAvatarUri,
        startMs: Number(syncedSlot?.startMs || 0),
        endMs: Number(syncedSlot?.endMs || 0),
        createdAt: Date.now(),
      } as any);

      console.log("KRISTO_LIVE_CLAIM_SYNC_TO_PROFILE", {
        feedId: postId,
        slotId,
        userId: currentUserId,
        slotNumber: Number(syncedSlot?.slot || syncedSlot?.slotNumber || 0),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert("Slot not claimed", "Network error. Please try again.");
    }
  }

  // REALTIME HOST DRAWER DATA
  const hostDrawerCurrentLabel = currentMainStageSlot
    ? String(currentMainStageSlot?.name || currentMainStageSlot?.title || `Slot ${currentMainStageSlot?.slot || ""}`)
    : "No active speaker";

  const hostDrawerNextSlot = visibleQueueSlots[0] || null;

  const hostDrawerNextLabel = hostDrawerNextSlot
    ? String((hostDrawerNextSlot as any)?.name || (hostDrawerNextSlot as any)?.title || `Slot ${(hostDrawerNextSlot as any)?.slot || ""}`)
    : "No next speaker";

  const liveCountdownLabel = (() => {
    const endMs = Number(currentMainStageSlot?.endMs || 0);
    if (!endMs) return "Waiting";

    const left = Math.max(0, endMs - Date.now());
    const mins = Math.floor(left / 60000);
    const secs = Math.floor((left % 60000) / 1000);

    return `ENDS IN ${mins}:${String(secs).padStart(2, "0")}`;
  })();

  const hostDrawerStateLabel = currentMainStageSlot ? "LIVE NOW" : "WAITING FOR NEXT SLOT";


  useEffect(() => {
    if (isMediaInstantLive) {
      setBigStageGuestId("host");
      if (!pinnedGuestId || String(pinnedGuestId).startsWith("stage-")) {
        setPinnedGuestId("host");
      }
      return;
    }

    if (!currentMainStageSlot) {
      setBigStageGuestId((prev) => (String(prev || "").startsWith("stage-") ? "host" : prev));
      return;
    }

    const guestId = `stage-${currentMainStageSlot.slot}`;

    setBigStageGuestId(guestId);

    if (!pinnedGuestId || pinnedGuestId === "host") {
      setPinnedGuestId(guestId);
    }
  }, [currentMainStageSlot?.slot, currentMainStageSlot, isMediaInstantLive, liveNowMs]);




  // IMPORTANT: LiveKit room must be the same for pastor/viewer/claimed slots.
  // Prefer liveId first because feed/schedule cards pass the shared live room id there.
  const liveBridgeId = isMediaInstantLive
    ? String(params.liveId || (params as any).room || params.title || "media-live-default")
    : String(
        liveScheduleFeedId ||
        params.liveId ||
        (params as any).feedId ||
        (params as any).sourceScheduleId ||
        (params as any).room ||
        assignmentThreadId ||
        assignmentId ||
        projectId ||
        "scheduled-live-default"
      );

  const liveKitStageSessionKey = `${liveBridgeId}|${currentUserId || "anon"}`;

  const routeActiveSlotSpeakerMount =
    !!currentUserId &&
    cameraPublishAllowedNow &&
    (userOwnsCurrentActiveSlot || routeClaimedByUserIdEarly === currentUserId);

  const liveKitPublisherStagePinned = isLiveKitPublisherStagePinned(liveBridgeId);

  const liveKitHostLockSnapshot = useSyncExternalStore(
    subscribeLiveKitHostLock,
    readLiveKitHostLockSnapshot,
    readLiveKitHostLockSnapshot
  );

  const shouldMountLiveKitPublisherStage =
    effectiveMountLiveKitPublisherStage ||
    routeActiveSlotSpeakerMount ||
    liveKitPublisherStagePinned;

  useEffect(() => {
    const next = shouldMountLiveKitPublisherStage;
    const prev = prevShouldMountLiveKitRef.current;
    if (prev !== null && prev !== next) {
      logShouldMountLiveKitPublisherStageTransition({
        prev,
        next,
        source: "live-room-authority-recompute",
        detail: {
          ...(liveRoomGuardStateRef.current || {}),
          effectiveMountLiveKitPublisherStage,
          routeActiveSlotSpeakerMount,
          liveKitPublisherStagePinned,
        },
      });
    }
    prevShouldMountLiveKitRef.current = next;
    if (next) {
      liveKitPublisherStageStickyRef.current = true;
    }
  }, [
    shouldMountLiveKitPublisherStage,
    effectiveMountLiveKitPublisherStage,
    routeActiveSlotSpeakerMount,
    liveKitPublisherStagePinned,
  ]);

  const renderLiveKitPublisherStage =
    shouldMountLiveKitPublisherStage || liveKitPublisherStageStickyRef.current;

  const publisherHostPinnedBeforeToken = isLiveKitPublisherHostPinnedBeforeToken(liveBridgeId);

  const publisherEligibleForHostPin =
    canPublishClaimedMicNow ||
    cameraPublishAllowedNow ||
    routeActiveSlotSpeakerMount;

  useLayoutEffect(() => {
    if (!liveBridgeId || !publisherEligibleForHostPin) return;
    pinLiveKitPublisherHostBeforeToken(liveBridgeId, "live-room-publisher-eligible", {
      stableIdentity: liveKitPublisherIdentity,
    });
    setLiveKitHostLocked(true);
    liveKitPublisherStageStickyRef.current = true;
  }, [
    liveBridgeId,
    publisherEligibleForHostPin,
    liveKitPublisherIdentity,
    currentUserId,
    userOwnsCurrentActiveSlot,
    routeClaimedByUserIdEarly,
    cameraPublishAllowedNow,
    routeActiveSlotSpeakerMount,
  ]);

  const publisherHostActive =
    liveKitHostLocked ||
    publisherHostPinnedBeforeToken ||
    shouldMountLiveKitPublisherStage ||
    isLiveKitPublisherStagePinned(liveBridgeId) ||
    isLiveKitStageMountSticky(liveBridgeId, liveKitPublisherIdentity);

  const keepPublisherLiveKitStage =
    publisherHostActive ||
    isLiveRoomLiveKitConnecting(liveBridgeId) ||
    isLiveRoomLiveKitSessionActive(liveBridgeId) ||
    shouldHoldClaimEnterSessionLock(liveBridgeId);

  useEffect(() => {
    if (
      isLiveKitPublisherStagePinned(liveBridgeId) ||
      isLiveKitStageMountSticky(liveBridgeId, liveKitPublisherIdentity) ||
      isLiveKitPublisherHostPinnedBeforeToken(liveBridgeId)
    ) {
      setLiveKitHostLocked(true);
    }
  }, [liveBridgeId, liveKitHostLockSnapshot, liveKitPublisherIdentity]);

  useEffect(() => {
    if (prevPublisherHostActiveRef.current && !publisherHostActive) {
      const dropReason = {
        at: Date.now(),
        liveKitHostLockSnapshot,
        liveKitHostLocked,
        publisherHostPinnedBeforeToken,
        shouldMountLiveKitPublisherStage,
        renderLiveKitPublisherStage,
        publisherHostActive,
        guardState: liveRoomGuardStateRef.current,
      };
      (globalThis as any).__KRISTO_LIVEKIT_STAGE_DROP_REASON__ = dropReason;
      console.log("KRISTO_LIVEKIT_HOST_DROPPED", dropReason);
    }
    prevPublisherHostActiveRef.current = publisherHostActive;
  }, [
    publisherHostActive,
    liveKitHostLockSnapshot,
    liveKitHostLocked,
    publisherHostPinnedBeforeToken,
    shouldMountLiveKitPublisherStage,
    renderLiveKitPublisherStage,
  ]);

  const liveKitPublisherStageKey = `lk-publisher-host|${liveBridgeId}|${currentUserId || "anon"}`;

  const showLiveKitStageShell =
    isMediaInstantLive ||
    !!currentMainStageSlot ||
    routeSlotsStillLive ||
    routeScheduleSlots.length > 0 ||
    liveKitPublisherStagePinned ||
    publisherHostActive ||
    isLiveKitStageMountSticky(liveBridgeId, "");

  useEffect(() => {
    liveRoomGuardStateRef.current = {
      pathname,
      churchSubscriptionActive,
      userOwnsCurrentActiveSlot,
      canPublishLiveVideoNow,
      cameraPublishAllowedNow,
      canPublishClaimedMicNow,
      effectiveMountLiveKitPublisherStage,
      shouldMountLiveKitPublisherStage,
      renderLiveKitPublisherStage,
      publisherHostActive,
      liveKitHostLocked,
      liveKitHostLockSnapshot,
      routeActiveSlotSpeakerMount,
      liveKitPublisherStagePinned,
      rawRouteCanPublishCamera,
      backendScheduleExplicitlyEnded,
      accessAllowed:
        isMediaInstantLive ||
        canPublishClaimedMicNow ||
        cameraPublishAllowedNow ||
        routeActiveSlotSpeakerMount ||
        userOwnsCurrentActiveSlot,
    };
  }, [
    pathname,
    churchSubscriptionActive,
    userOwnsCurrentActiveSlot,
    canPublishLiveVideoNow,
    cameraPublishAllowedNow,
    canPublishClaimedMicNow,
    effectiveMountLiveKitPublisherStage,
    shouldMountLiveKitPublisherStage,
    renderLiveKitPublisherStage,
    routeActiveSlotSpeakerMount,
    liveKitPublisherStagePinned,
    rawRouteCanPublishCamera,
    backendScheduleExplicitlyEnded,
    isMediaInstantLive,
  ]);

  const liveRoomNavGuardRef = useRef({
    liveBridgeId: "",
    backendScheduleExplicitlyEnded: false,
  });

  useEffect(() => {
    liveRoomNavGuardRef.current = {
      liveBridgeId,
      backendScheduleExplicitlyEnded,
    };
  }, [liveBridgeId, backendScheduleExplicitlyEnded]);

  const tryNavigateAwayFromLiveRoom = useCallback(
    (
      target: string,
      reason: string,
      fn: () => void,
      opts?: { explicitScheduleDeleted?: boolean; caller?: string }
    ) => {
      const guard = liveRoomNavGuardRef.current;
      const caller = String(opts?.caller || reason || "unknown").trim();
      if (
        shouldBlockLiveRoomAutoNavigation({
          reason,
          liveBridgeId: guard.liveBridgeId,
          backendScheduleExplicitlyEnded: guard.backendScheduleExplicitlyEnded,
          explicitScheduleDeleted: opts?.explicitScheduleDeleted,
        })
      ) {
        logLiveRoomGuardRedirect({
          blocked: true,
          guardName: caller,
          reason,
          target,
          liveBridgeId: guard.liveBridgeId,
          detail: { lastGuardState: liveRoomGuardStateRef.current },
        });
        return false;
      }

      logLiveRoomNavAway({
        reason,
        caller,
        target,
        liveBridgeId: guard.liveBridgeId,
        detail: { lastGuardState: liveRoomGuardStateRef.current },
      });
      clearLiveRoomSessionPin(reason);
      clearLiveKitPublisherStagePin(reason);
      clearClaimEnterSessionLock(reason);
      fn();
      return true;
    },
    []
  );

  useEffect(() => {
    const uid = currentUserId;
    const routeSlotCount = initialRouteScheduleSlots.length;
    if (!liveBridgeId) return;

    pinLiveRoomSession({
      liveBridgeId,
      userId: uid,
      routeSlotCount,
      source: "live-room-mount",
    });
    clearStaleLiveEndedFlag(liveBridgeId, "session-pin");

    return () => {
      logLiveRoomUnmountReason("live-room-bridge-effect-cleanup", {
        pathname,
        liveBridgeId,
        routeSlotCount,
        lastGuardState: liveRoomGuardStateRef.current,
      });
    };
  }, [
    liveBridgeId,
    currentUserId,
    initialRouteScheduleSlots.length,
    pathname,
  ]);

  useEffect(() => {
    const nextUserId = String(session?.userId || "").trim();
    const prevUserId = String(prevSessionUserIdRef.current || "").trim();

    if (
      shouldHoldClaimEnterSessionLock(liveBridgeId) &&
      prevUserId &&
      nextUserId &&
      prevUserId !== nextUserId
    ) {
      console.log("KRISTO_CLAIM_ENTER_SESSION_LOCK_BLOCK_ACCOUNT_SWITCH", {
        liveBridgeId,
        prevUserId,
        nextUserId,
        lockedUserId: readClaimEnterSessionLock(liveBridgeId)?.lockedUserId || "",
      });
      prevSessionUserIdRef.current = nextUserId;
      return;
    }

    if (prevUserId && nextUserId && prevUserId !== nextUserId) {
      forceKristoLiveCleanup("account-switch", {
        userId: prevUserId,
        roomName: liveBridgeId,
        accountSwitch: true,
      });
      setLiveKitAccountEpoch((n) => n + 1);
    } else if (prevUserId && !nextUserId) {
      forceKristoLiveCleanup("account-logout", {
        userId: prevUserId,
        roomName: liveBridgeId,
        accountSwitch: true,
      });
      setLiveKitAccountEpoch((n) => n + 1);
    }

    prevSessionUserIdRef.current = nextUserId;
  }, [session?.userId, liveBridgeId]);

  useEffect(() => {
    logLiveMediaAuthority("live-room", liveMediaAuthority, {
      routeScheduleSlotsCount: routeScheduleSlots.length,
      backendScheduleSlotsCount: backendScheduleSlots.length,
      runtimeScheduleSlotsCount: runtimeScheduleSlots.length,
      scheduledStagePeopleCount: scheduledStagePeople.length,
      visibleQueueSlotsCount: visibleQueueSlots.length,
      liveScheduleFeedId,
      isMediaInstantLive,
      liveBridgeId,
      liveId: params.liveId,
      sourceScheduleId: (params as any).sourceScheduleId,
      room: (params as any).room,
      title: params.title,
      assignmentThreadId,
      assignmentId,
      projectId,
      currentSlotNumber,
      currentMainStageSlot: currentMainStageSlot
        ? {
            slot: currentMainStageSlot.slot,
            claimedByUserId: currentMainStageSlot.claimedByUserId,
            startMs: currentMainStageSlot.startMs,
            endMs: currentMainStageSlot.endMs,
          }
        : null,
      currentSlotOwnerId,
    });
  }, [
    liveMediaAuthority.isMediaOwnerHost,
    liveMediaAuthority.isActualChurchPastor,
    liveMediaAuthority.isMediaScheduleCreator,
    liveMediaAuthority.isMediaHost,
    actualChurchPastorUserId,
    scheduleCreatedByUserId,
    isMediaInstantLive,
    liveBridgeId,
    liveScheduleFeedId,
    params.liveId,
    (params as any).sourceScheduleId,
    (params as any).room,
    params.title,
    assignmentThreadId,
    assignmentId,
    projectId,
    currentSlotNumber,
    currentSlotOwnerId,
    currentMainStageSlot,
    routeScheduleSlots.length,
    backendScheduleSlots.length,
    runtimeScheduleSlots.length,
    scheduledStagePeople.length,
    visibleQueueSlots.length,
  ]);

  const liveApiHeaders = useMemo(() => {
    const headerUserId =
      claimEnterLockHeld && claimEnterLock?.lockedUserId
        ? claimEnterLock.lockedUserId
        : sessionUserId;
    return getKristoHeaders({
      ...(session || {}),
      userId: headerUserId,
      churchId: liveRouteChurchId,
    } as any);
  }, [session, liveRouteChurchId, claimEnterLockHeld, claimEnterLock?.lockedUserId, sessionUserId]);

  // Bumps headersKey once when session publish eligibility latches true (token refetch at most once).
  const liveKitApiHeaders = useMemo(
    () => ({
      ...liveApiHeaders,
      "x-kristo-live-may-publish": liveKitSessionMayPublish ? "1" : "0",
    }),
    [liveApiHeaders, liveKitSessionMayPublish]
  );

  const liveKitViewerApiHeaders = useMemo(
    () => ({
      ...liveApiHeaders,
      "x-kristo-live-may-publish": "0",
    }),
    [liveApiHeaders]
  );

  useEffect(() => {
    if (isMediaInstantLive) return;

    const hydrateFeedId = String(liveScheduleFeedId || "").trim();
    if (!hydrateFeedId || !isBackendFeedScheduleId(hydrateFeedId)) {
      console.log("KRISTO_LIVE_SCHEDULE_HYDRATE_SKIP", {
        reason: "no_backend_feed_id",
        liveScheduleFeedId: hydrateFeedId,
        routeFeedId: String((params as any)?.feedId || ""),
        localScheduleId: String((params as any)?.localScheduleId || ""),
        hasRouteSlots: routeScheduleSlots.length > 0,
      });
      return;
    }

    const hasRouteSlots = initialRouteScheduleSlots.length > 0;
    let cancelled = false;
    let slotsSig = hasRouteSlots ? JSON.stringify(initialRouteScheduleSlots) : "";

    async function hydrateScheduleFromFeed(source: "immediate" | "poll" | "background") {
      if (hasRouteSlots && source === "poll") return;

      try {
        const res: any = await apiGet(
          `/api/church/feed?id=${encodeURIComponent(hydrateFeedId)}`,
          { headers: liveApiHeaders as any },
          {
            screen: "LiveRoomSchedule",
            throttleMs:
              source === "background" ? 120000 : source === "immediate" ? 0 : hasRouteSlots ? 120000 : 45000,
          }
        );

        const item = res?.data?.item || res?.item || res?.data || {};
        const slots = normalizeLiveScheduleSlots(
          Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : []
        );

        if (cancelled) return;

        setBackendScheduleHydrated(true);

        const explicitlyEnded = isMediaScheduleFeedExplicitlyEnded(item);

        if (!slots.length) {
          if (hasRouteSlots && !explicitlyEnded) {
            console.log("KRISTO_LIVE_SCHEDULE_HYDRATE_EMPTY", {
              feedId: hydrateFeedId,
              source,
              hadRouteSlots: routeScheduleSlots.length,
              preservedRoute: true,
              routeSlotCount: initialRouteScheduleSlots.length,
            });
            return;
          }

          if (explicitlyEnded) {
            setBackendScheduleExplicitlyEnded(true);
          }

          setBackendScheduleSlots([]);
          console.log("KRISTO_LIVE_SCHEDULE_HYDRATE_EMPTY", {
            feedId: hydrateFeedId,
            source,
            hadRouteSlots: routeScheduleSlots.length,
            explicitlyEnded,
          });

          if (explicitlyEnded || !hasRouteSlots) {
            console.log("KRISTO_LIVE_ROOM_ROUTE_SLOTS_DROPPED_STALE", {
              feedId: hydrateFeedId,
              routeSlotCount: routeScheduleSlots.length,
              backendSlotCount: 0,
              localScheduleId: String((params as any)?.localScheduleId || ""),
              source,
              explicitlyEnded,
            });
            console.log("KRISTO_STALE_ROUTE_SLOTS_IGNORED", {
              canonicalFeedId: hydrateFeedId,
              localScheduleId: String((params as any)?.localScheduleId || ""),
              backendSlotCount: 0,
              routeSlotCount: routeScheduleSlots.length,
              reason: explicitlyEnded
                ? "live-room-hydrate-explicitly-ended"
                : "live-room-hydrate-empty",
            });
            if (explicitlyEnded && hasRouteSlots) {
              logLiveRoomShowEndedOverlay({
                feedId: hydrateFeedId,
                preservedRoute: true,
                source: `live-room-hydrate-${source}`,
              });
            }
            clearScheduleClaimRuntimeState(hydrateFeedId);
            tryEndLiveBridgeForSchedule(
              hydrateFeedId,
              explicitlyEnded ? "live-room-hydrate-ended" : "live-room-hydrate-empty"
            );
            emitLiveRingRefresh(
              explicitlyEnded ? "live-room-hydrate-ended" : "live-room-hydrate-empty"
            );
          }
          return;
        }

        setBackendScheduleExplicitlyEnded(false);

        const sig = JSON.stringify(slots);
        if ((source === "poll" || source === "background") && sig === slotsSig) return;
        slotsSig = sig;

        setBackendScheduleSlots(slots);
        console.log("KRISTO_LIVE_SCHEDULE_HYDRATED", {
          feedId: hydrateFeedId,
          source,
          slotCount: slots.length,
          claimedCount: slots.filter((slot: any) => String(slot?.claimedByUserId || "").trim()).length,
          hadRouteSlots: hasRouteSlots,
        });
      } catch (e: any) {
        const status = Number(e?.status || e?.response?.status || 0);
        if (!cancelled && status === 410) {
          setBackendScheduleHydrated(true);
          setBackendScheduleExplicitlyEnded(true);
          setBackendScheduleSlots([]);
          console.log("KRISTO_LIVE_SCHEDULE_HYDRATE_EMPTY", {
            feedId: hydrateFeedId,
            source,
            hadRouteSlots: routeScheduleSlots.length,
            status,
            explicitlyEnded: true,
          });
          console.log("KRISTO_LIVE_ROOM_ROUTE_SLOTS_DROPPED_STALE", {
            feedId: hydrateFeedId,
            routeSlotCount: routeScheduleSlots.length,
            backendSlotCount: 0,
            localScheduleId: String((params as any)?.localScheduleId || ""),
            source,
            status,
            explicitlyEnded: true,
          });
          if (hasRouteSlots) {
            logLiveRoomShowEndedOverlay({
              feedId: hydrateFeedId,
              preservedRoute: true,
              source: `live-room-hydrate-410-${source}`,
            });
          }
          clearScheduleClaimRuntimeState(hydrateFeedId);
          tryEndLiveBridgeForSchedule(hydrateFeedId, "live-room-hydrate-gone");
          emitLiveRingRefresh("live-room-hydrate-gone");
          return;
        }
        if (!cancelled && status === 404 && hasRouteSlots) {
          console.log("KRISTO_LIVE_SCHEDULE_HYDRATE_EMPTY", {
            feedId: hydrateFeedId,
            source,
            hadRouteSlots: routeScheduleSlots.length,
            status,
            preservedRoute: true,
          });
          setBackendScheduleHydrated(true);
          return;
        }
        if (!cancelled && status === 404) {
          setBackendScheduleHydrated(true);
          setBackendScheduleExplicitlyEnded(true);
          setBackendScheduleSlots([]);
          console.log("KRISTO_LIVE_SCHEDULE_HYDRATE_EMPTY", {
            feedId: hydrateFeedId,
            source,
            hadRouteSlots: routeScheduleSlots.length,
            status,
          });
          clearScheduleClaimRuntimeState(hydrateFeedId);
          tryEndLiveBridgeForSchedule(hydrateFeedId, "live-room-hydrate-missing");
          emitLiveRingRefresh("live-room-hydrate-missing");
          return;
        }
        console.log("KRISTO_LIVE_SCHEDULE_HYDRATE_ERROR", {
          feedId: hydrateFeedId,
          source,
          message: String(e?.message || e),
          status: status || null,
          hadRouteSlots: hasRouteSlots,
        });
        console.log("KRISTO_LIVE_ROOM_BACKEND_ERROR", {
          endpoint: `/api/church/feed?id=${hydrateFeedId}`,
          feedId: hydrateFeedId,
          source,
          status: status || null,
          message: String(e?.message || e),
          hadRouteSlots: hasRouteSlots,
          continuesWithRouteSlots: hasRouteSlots,
        });
      }
    }

    void hydrateScheduleFromFeed("immediate");

    if (hasRouteSlots) {
      const timer = setTimeout(() => {
        void hydrateScheduleFromFeed("background");
      }, 0);
      const stopPoll = startAdaptiveLivePolling({
        screen: "LiveRoomSchedule",
        enabled: isFocused,
        activeMs: 90000,
        idleMs: 120000,
        onTick: async () => {
          await hydrateScheduleFromFeed("poll");
        },
      });
      return () => {
        cancelled = true;
        clearTimeout(timer);
        stopPoll?.();
      };
    }

    const stopPoll = startAdaptiveLivePolling({
      screen: "LiveRoomSchedule",
      enabled: isFocused,
      activeMs: 90000,
      idleMs: 120000,
      onTick: async () => {
        await hydrateScheduleFromFeed("poll");
      },
    });

    return () => {
      cancelled = true;
      stopPoll?.();
    };
  }, [
    liveScheduleFeedId,
    liveBridgeId,
    (params as any).liveId,
    liveApiHeaders,
    isFocused,
    isMediaInstantLive,
    routeScheduleSlots.length,
    initialRouteScheduleSlots.length,
  ]);
  useEffect(() => {
    let alive = true;

    async function loadLiveProfileAvatar() {
      if (!session?.userId) return;

      const cached = await resolveCachedLiveAvatar(
        session.userId,
        String((session as any)?.avatarUri || (session as any)?.avatarUrl || "")
      );
      if (cached && alive) {
        setLiveProfileAvatarUri(cached);
        return;
      }

      try {
        const res: any = await apiGet(
          "/api/auth/profile",
          { headers: liveApiHeaders as any },
          { screen: "LiveRoom", throttleMs: 300000 }
        );
        const p = res?.profile || res?.user || res?.data || res || {};
        const raw = String(
          p.avatarUri ||
          p.avatarUrl ||
          p.profileImage ||
          p.photoURL ||
          p.image ||
          p.avatar ||
          ""
        ).trim();

        if (!alive || !raw) return;

        const normalized =
          raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("file://")
            ? raw
            : raw.startsWith("/")
              ? `${String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "")}${raw}`
              : raw;

        setLiveProfileAvatarUri(normalized);
      } catch {}
    }

    void loadLiveProfileAvatar();

    return () => {
      alive = false;
    };
  }, [session?.userId, liveApiHeaders]);

  useEffect(() => {
    let alive = true;

    fetchChurchMembers()
      .then((rows) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const row of rows || []) {
          const uid = String(row?.userId || row?.id || "").trim();
          const raw = String(
            row?.avatarUrl ||
              row?.avatarUri ||
              row?.profileImage ||
              row?.photoURL ||
              row?.image ||
              ""
          ).trim();
          if (uid && raw) map[uid] = raw;
        }
        setMemberAvatarByUserId(map);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [liveRouteChurchId, session?.userId]);

  useEffect(() => {
    let alive = true;
    const userIds = new Set<string>();

    for (const slot of runtimeScheduleSlots) {
      const uid = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
      if (uid) userIds.add(uid);
    }

    userIds.forEach((uid) => {
      void (async () => {
        const cached = await resolveCachedLiveAvatar(uid);
        if (!alive || !cached) return;
        setResolvedAvatarByUserId((prev) => {
          if (prev[uid]) return prev;
          return { ...prev, [uid]: cached };
        });
      })();
    });

    return () => {
      alive = false;
    };
  }, [runtimeScheduleSlots]);

  async function pushLiveAction(action: string, body: Record<string, any> = {}) {
    try {
      const res: any = await apiPatch("/api/church/live", {
        action,
        liveId: liveBridgeId,
        ...body,
      }, { headers: liveApiHeaders as any });

      if (res?.removedFromLive === true) {
        setJoinRequestsBySlot({});
        setHostRequestCard(null);
        setVipGuestCardSlot(null);
        setRequestListOpen(false);
        tryNavigateAwayFromLiveRoom("/(tabs)", "backend-removed-from-live-action", () => {
          router.replace("/(tabs)" as any);
        }, { caller: "pushLiveAction-removedFromLive" });
        return res;
      }

      const nextLive = res?.live;
      if (nextLive?.requestPolicy) {
        setRequestPolicy(nextLive.requestPolicy as LiveRequestPolicy);
      }

      if (nextLive?.requests && typeof nextLive.requests === "object") {
        backendLiveRequestsRef.current = nextLive.requests;
        setBackendLiveRequests(nextLive.requests);
        const bridgeIncoming = getLiveJoinBridge().requestsByLiveId[liveBridgeId] || {};
        setJoinRequestsBySlot({ ...bridgeIncoming, ...nextLive.requests });

        const mine: any = Object.entries(nextLive.requests).find(([, req]: any) =>
          !!req?.approved &&
          !!req?.onStage &&
          String(req?.userId || "").trim() === String(session?.userId || "").trim()
        );

        if (mine && !canManageLive && !isMediaInstantLive) {
          const slot = Number(mine[0]);
          const guestId = `request-slot-${slot}`;
          setBigStageGuestId(guestId);
          setPinnedGuestId(guestId);
          setStageGuestIds([guestId]);
        }

        if (!canManageLive && isMediaInstantLive) {
          setBigStageGuestId("host");
          setPinnedGuestId("host");
        }
      }
      return res;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (isMediaInstantLive || !liveBridgeId || !currentUserId || !myClaimedStageSlot) return;

    const slot = Number((myClaimedStageSlot as any)?.slot || 0);
    if (!slot) return;

    const syncKey = `${liveBridgeId}|${currentUserId}|${slot}`;
    if (claimRoomSyncRef.current === syncKey) return;

    const name = String(
      (myClaimedStageSlot as any)?.claimedByName ||
      (myClaimedStageSlot as any)?.name ||
      (session as any)?.displayName ||
      (session as any)?.fullName ||
      (session as any)?.name ||
      "Member"
    ).trim();

    const avatar = String(
      (myClaimedStageSlot as any)?.claimedByAvatar ||
      (myClaimedStageSlot as any)?.avatar ||
      liveProfileAvatarUri ||
      (session as any)?.avatarUri ||
      (session as any)?.avatarUrl ||
      name.slice(0, 1).toUpperCase()
    ).trim();

    claimRoomSyncRef.current = syncKey;

    void syncClaimedMemberToLiveRoom({
      liveId: liveBridgeId,
      slot,
      slotId: String((myClaimedStageSlot as any)?.id || (myClaimedStageSlot as any)?.slotId || ""),
      userId: currentUserId,
      name,
      avatar,
      role: String((session as any)?.role || "Member"),
      pushLiveAction,
    }).then((res) => {
      const nextRequests = res?.live?.requests;
      if (nextRequests && typeof nextRequests === "object") {
        backendLiveRequestsRef.current = nextRequests;
        setBackendLiveRequests(nextRequests);
        const bridge = getLiveJoinBridge().requestsByLiveId[liveBridgeId] || {};
        setJoinRequestsBySlot({ ...bridge, ...nextRequests });
      }
    }).catch(() => {
      claimRoomSyncRef.current = "";
    });
  }, [
    isMediaInstantLive,
    liveBridgeId,
    currentUserId,
    myClaimedStageSlot,
    session,
    liveProfileAvatarUri,
    feedScheduleTick,
  ]);

  const livePatchSigRef = useRef("");
  const liveHeartbeatSigRef = useRef("");
  const canManageLiveRef = useRef(false);
  const canSeeLiveHostControlsRef = useRef(false);
  const isMyScheduledLiveTurnRef = useRef(false);

  const applyBackendLivePatch = useCallback(
    (patch: Awaited<ReturnType<typeof fetchLightLiveState>>, source: string) => {
      if (patch.routeFailed) {
        console.log("KRISTO_CHURCH_LIVE_STATE_RESULT", {
          screen: "LiveRoom",
          source,
          routeFailed: true,
          preserved: true,
          shouldUpdate: false,
          updateSource: "route_failed_preserved_previous",
          hasNextLive: Boolean(backendChurchLive?.isLive),
        });
        return;
      }

      if (patch.removedFromLive) {
        backendLiveRequestsRef.current = {};
        setBackendLiveRequests({});
        setJoinRequestsBySlot({});
        setHostRequestCard(null);
        setVipGuestCardSlot(null);
        setRequestListOpen(false);
        tryNavigateAwayFromLiveRoom("/(tabs)", `backend-removed-from-live-${source}`, () => {
          router.replace("/(tabs)" as any);
        }, { caller: `applyBackendLivePatch-${source}` });
        return;
      }

      const sig = JSON.stringify({
        policy: patch.requestPolicy || "",
        req: patch.requests || null,
        presence: patch.viewerPresence || null,
        liveId: patch.liveId || "",
        isLive: patch.isLive || false,
        source,
      });
      if (sig === livePatchSigRef.current) return;
      livePatchSigRef.current = sig;

      const resolved = resolveChurchLiveStateUpdate({
        patch,
        previousLive: backendChurchLive,
        churchId: String(session?.churchId || ""),
        scheduleLiveActive: routeSlotsStillLive || !!currentMainStageSlot,
        scheduleExplicitlyEnded: backendScheduleExplicitlyEnded,
      });

      console.log("KRISTO_CHURCH_LIVE_STATE_RESULT", {
        screen: "LiveRoom",
        source,
        routeFailed: patch.routeFailed === true,
        noBridgeSession: patch.noBridgeSession === true,
        preserved: resolved.preserved,
        shouldUpdate: resolved.shouldUpdate,
        updateSource: resolved.source,
        hasNextLive: Boolean(resolved.nextLive?.isLive),
        scheduleLiveActive: routeSlotsStillLive || !!currentMainStageSlot,
      });

      if (resolved.shouldUpdate) {
        setBackendChurchLive(resolved.nextLive);
      } else if (patch.raw && patch.isLive === true) {
        setBackendChurchLive(patch.raw);
      }
      if (patch.requestPolicy) setRequestPolicy(patch.requestPolicy as LiveRequestPolicy);

      if (patch.requests && typeof patch.requests === "object") {
        backendLiveRequestsRef.current = patch.requests;
        setBackendLiveRequests(patch.requests);
        const bridgeIncoming = getLiveJoinBridge().requestsByLiveId[liveBridgeId] || {};
        setJoinRequestsBySlot({ ...bridgeIncoming, ...patch.requests });

        console.log("KRISTO_ROOM_WAITING_LIST", {
          liveBridgeId,
          source,
          requestCount: Object.keys(patch.requests).length,
          requests: Object.entries(patch.requests).map(([slot, req]: any) => ({
            slot: Number(slot),
            userId: String(req?.userId || ""),
            name: String(req?.name || ""),
            status: String(req?.status || ""),
            approved: !!req?.approved,
            waiting: !!req?.waiting,
            onStage: !!req?.onStage,
          })),
        });

        if (canManageLiveRef.current) {
          console.log("KRISTO_PASTOR_WAITING_HYDRATED", {
            liveBridgeId,
            source,
            requestCount: Object.keys(patch.requests).length,
            userIds: Object.values(patch.requests).map((req: any) => String(req?.userId || "")),
          });
        }
      }

      if (patch.viewerPresence) setLiveViewerPresence(patch.viewerPresence);
    },
    [liveBridgeId, router, backendChurchLive, session?.churchId, routeSlotsStillLive, currentMainStageSlot, backendScheduleExplicitlyEnded, tryNavigateAwayFromLiveRoom]
  );

  const bridgeCreateInflightRef = useRef(false);

  useEffect(() => {
    if (isMediaInstantLive || !liveBridgeId || !currentUserId) return;
    if (!routeSlotsStillLive && !myClaimedStageSlot && !currentMainStageSlot) return;
    if (bridgeCreateInflightRef.current) return;

    let cancelled = false;
    bridgeCreateInflightRef.current = true;

    void (async () => {
      try {
        const patch = await fetchLightLiveStateWithPerf(
          liveApiHeaders as any,
          "LiveRoomBridgeEnsure",
          liveBridgeId,
          "bridge-ensure"
        );
        if (cancelled) return;
        if (patch.isLive === true || patch.removedFromLive || patch.explicitlyEnded) {
          applyBackendLivePatch(patch, "bridge-ensure-prefetch");
          return;
        }
        if (!patch.noBridgeSession && !patch.routeFailed) return;

        const stageSlot = myClaimedStageSlot || currentMainStageSlot;
        const routeSlot =
          stageSlot ||
          initialRouteScheduleSlots.find((slot: any) => {
            const startMs = Number(slot?.startMs || 0);
            const endMs = Number(slot?.endMs || 0);
            return startMs > 0 && endMs > startMs && liveNowMs >= startMs && liveNowMs <= endMs;
          }) ||
          null;
        const slotNum = Math.max(1, Number((routeSlot as any)?.slot || (routeSlot as any)?.slotNumber || 0));
        const slotId = String((routeSlot as any)?.id || (routeSlot as any)?.slotId || "");
        const claimedSlot = !!myClaimedStageSlot;
        const name = String(
          (routeSlot as any)?.claimedByName ||
            (routeSlot as any)?.name ||
            (session as any)?.displayName ||
            (session as any)?.fullName ||
            (session as any)?.name ||
            "Member"
        ).trim();
        const avatar = String(
          (routeSlot as any)?.claimedByAvatar ||
            (routeSlot as any)?.avatar ||
            liveProfileAvatarUri ||
            (session as any)?.avatarUri ||
            name.slice(0, 1).toUpperCase()
        ).trim();

        const res = await ensureLiveBridgeFromActiveScheduleSlot({
          liveId: liveBridgeId,
          slotId,
          slot: slotNum,
          userId: currentUserId,
          name,
          avatar,
          headers: liveApiHeaders as Record<string, string>,
          role: String((session as any)?.role || "Member"),
          claimedSlot,
        });

        if (cancelled) return;

        if (res?.live) {
          applyBackendLivePatch(
            extractLightLivePayload({ ok: true, live: res.live }),
            "bridge-create"
          );
          return;
        }

        const refetch = await fetchLightLiveStateWithPerf(
          liveApiHeaders as any,
          "LiveRoomBridgeEnsureRefetch",
          liveBridgeId,
          "bridge-ensure-refetch"
        );
        if (!cancelled) applyBackendLivePatch(refetch, "bridge-create-refetch");
      } catch {
        bridgeCreateInflightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isMediaInstantLive,
    liveBridgeId,
    currentUserId,
    routeSlotsStillLive,
    myClaimedStageSlot,
    currentMainStageSlot,
    initialRouteScheduleSlots,
    liveNowMs,
    liveApiHeaders,
    liveProfileAvatarUri,
    session,
    applyBackendLivePatch,
  ]);

  useEffect(() => {
    if (!liveBridgeId || isMediaInstantLive) return;
    let cancelled = false;

    void fetchLightLiveStateWithPerf(liveApiHeaders as any, "LiveRoomImmediate", liveBridgeId, "immediate")
      .then((patch) => {
        if (!cancelled) applyBackendLivePatch(patch, "immediate");
      })
      .catch((e: any) => {
        const status = Number(e?.status || e?.response?.status || 0);
        console.log("KRISTO_LIVE_ROOM_BACKEND_ERROR", {
          endpoint: `/api/church/live?lite=1&liveId=${liveBridgeId}`,
          liveId: liveBridgeId,
          source: "LiveRoomImmediate",
          status: status || null,
          message: String(e?.message || e),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [liveBridgeId, liveApiHeaders, isMediaInstantLive, applyBackendLivePatch]);

  useEffect(() => {
    const unsubClaim = onClaimUpdated(() => {
      if (!liveBridgeId || isMediaInstantLive) return;
      void fetchLightLiveStateWithPerf(
        liveApiHeaders as any,
        "LiveRoomClaimRefresh",
        liveBridgeId,
        "claim-refresh"
      ).then((patch) => applyBackendLivePatch(patch, "claim-refresh"));
    });
    return unsubClaim;
  }, [liveBridgeId, liveApiHeaders, isMediaInstantLive, applyBackendLivePatch]);

  useEffect(() => {
    if (!liveBridgeId && isMediaInstantLive === false) return;

    const stopSync = startAdaptiveLivePolling({
      screen: "LiveRoom",
      enabled: isFocused,
      activeMs: canManageLiveRef.current ? 3000 : 6000,
      idleMs: 22000,
      onTick: async () => {
        const patch = await fetchLightLiveStateWithPerf(
          liveApiHeaders as any,
          "LiveRoom",
          liveBridgeId,
          "poll"
        );
        applyBackendLivePatch(patch, "poll");
      },
    });

    const stopHeartbeat = startAdaptiveLivePolling({
      screen: "LiveRoomHeartbeat",
      enabled: isFocused,
      activeMs: 15000,
      idleMs: 30000,
      onTick: async () => {
        const body = {
          viewerCount: 1,
          role: canManageLiveRef.current
            ? "host"
            : isMyScheduledLiveTurnRef.current
              ? "stage"
              : "viewer",
        };
        const sig = JSON.stringify(body);
        if (sig === liveHeartbeatSigRef.current) return;
        liveHeartbeatSigRef.current = sig;
        await pushLiveAction("presence", body);
      },
    });

    return () => {
      stopSync();
      stopHeartbeat();
    };
  }, [liveBridgeId, isMediaInstantLive, liveApiHeaders, router, isFocused, applyBackendLivePatch]);

  useEffect(() => {
    const uris = assignmentThreadMessages
      .map((m: any) => String(m?.avatarUri || m?.card?.claimedByAvatar || "").trim())
      .filter(Boolean);
    preloadLiveImages(uris, 20);
  }, [assignmentThreadMessages]);



  useEffect(() => {
    const bridge = getLiveJoinBridge() as any;
    bridge.endedByLiveId = bridge.endedByLiveId || {};

    if (bridge.endedByLiveId[liveBridgeId]) {
      tryNavigateAwayFromLiveRoom("/(tabs)/more/media", "live-ended-flag-on-mount", () => {
        router.replace("/(tabs)/more/media" as any);
      }, { caller: "live-ended-flag-on-mount-effect" });
    }
  }, [liveBridgeId, router, tryNavigateAwayFromLiveRoom]);

  useEffect(() => {
    const pullLiveJoinRequests = () => {
      const bridge = getLiveJoinBridge() as any;
      bridge.policiesByLiveId = bridge.policiesByLiveId || {};
      bridge.endedByLiveId = bridge.endedByLiveId || {};
      if (bridge.endedByLiveId[liveBridgeId]) {
        if (!canManageLive) {
          tryNavigateAwayFromLiveRoom("/(tabs)/more/media", "live-ended-bridge-event", () => {
            try {
              router.dismissTo("/(tabs)/more/media" as any);
            } catch {
              router.replace("/(tabs)/more/media" as any);
            }
            endLive();
            router.replace("/(tabs)" as any);
          }, { caller: "subscribeLiveJoin-endedByLiveId" });
        }
        return;
      }

      const incoming = bridge.requestsByLiveId[liveBridgeId] || {};
      const nextPolicy = bridge.policiesByLiveId[liveBridgeId] as LiveRequestPolicy | undefined;

      if (nextPolicy) {
        setRequestPolicy(nextPolicy);
      }

      const backend = backendLiveRequestsRef.current || {};
      setJoinRequestsBySlot({ ...incoming, ...backend });
    };

    pullLiveJoinRequests();
    return subscribeLiveJoin(pullLiveJoinRequests);
  }, [liveBridgeId, tryNavigateAwayFromLiveRoom, canManageLive]);

  const [endingLive, setEndingLive] = useState(false);
  const [requestPolicyOpen, setRequestPolicyOpen] = useState<boolean>(false);
  const requestPolicyAnim = useRef(new Animated.Value(0)).current;
  const [requestPolicy, setRequestPolicy] = useState<LiveRequestPolicy>("locked");
  const [lastStageTapAt, setLastStageTapAt] = useState<number>(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hostDrawerOpen, setHostDrawerOpen] = useState(false);
  const hostControlPulse = useRef(new Animated.Value(0)).current;
  const hostControlViewerPulse = useRef(new Animated.Value(0)).current;
  const [layoutStudioOpen, setLayoutStudioOpen] = useState(false);
  const [selectedHostTool, setSelectedHostTool] = useState("Pin topic");
  const [viewerFlowOpen, setViewerFlowOpen] = useState(false);
  const hostDrawerX = useRef(new Animated.Value(360)).current;
  const VIEWER_FLOW_PANEL_W = 310;
  const viewerFlowX = useRef(new Animated.Value(VIEWER_FLOW_PANEL_W)).current;
  const mediaHeaderShimmerX = useRef(new Animated.Value(0)).current;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  useEffect(() => {
    if (!isMediaInstantLive) return;
    mediaHeaderShimmerX.setValue(0);
  }, [isMediaInstantLive, mediaHeaderShimmerX]);

  const openHostDrawer = () => {
    console.log("KRISTO_LIVE_HOST_PANEL_ACCESS", {
      userId: currentUserId,
      role: String((session as any)?.role || params.role || "viewer"),
      isPastor: isPastorForLiveRoom,
      isApprovedMediaHost: isApprovedMediaHostForLiveRoom,
      isCurrentActiveSlotOwner: isCurrentActiveSlotOwnerForLiveRoom,
      canSeeLiveHostControls,
      canManageLiveHostActions,
      source: "openHostDrawer",
    });
    setHostDrawerOpen(true);
    Animated.spring(hostDrawerX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 18,
    }).start();
  };

  useEffect(() => {
    if (!hostDrawerOpen) return;
    const liveLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(hostControlPulse, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(hostControlPulse, { toValue: 0, duration: 850, useNativeDriver: true }),
      ])
    );
    const viewerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(hostControlViewerPulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(hostControlViewerPulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ])
    );
    liveLoop.start();
    viewerLoop.start();
    return () => {
      liveLoop.stop();
      viewerLoop.stop();
    };
  }, [hostDrawerOpen, hostControlPulse, hostControlViewerPulse]);


  useEffect(() => {
    Animated.timing(profileActionAnim, {
      toValue: profileActionGuestId ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [profileActionGuestId, profileActionAnim]);

  useEffect(() => {
    Animated.timing(requestPolicyAnim, {
      toValue: requestPolicyOpen ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [requestPolicyOpen, requestPolicyAnim]);

  function logLiveHostActionBlocked(action: string) {
    console.log("KRISTO_LIVE_HOST_PANEL_BLOCKED_VIEWER", {
      userId: currentUserId,
      role: String((session as any)?.role || params.role || "viewer"),
      action,
    });
  }

  function pressNextLiveSlot() {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("next-slot");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    advanceToNextClaimedSlot("host-next-button");
  }

  function pressHostTool(label: string) {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked(`host-tool:${label}`);
      return;
    }
    setSelectedHostTool(label);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  function muteAllHostAudience() {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("mute-all");
      return;
    }
    const next: Record<string, boolean> = { ...(miniVideoMutedById || {}) };
    [...scheduledStagePeople, ...guests].forEach((entry: any) => {
      const id = String(entry?.id || "");
      if (id) next[id] = true;
    });
    setMiniVideoMutedById(next);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function renderHostControlAvatar(
    name: string,
    avatarUri: string,
    size: number,
    ringColor: string
  ) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2.5,
          borderColor: ringColor,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#07111F",
          shadowColor: ringColor,
          shadowOpacity: 0.45,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        {avatarUri && isImageAvatar(avatarUri) ? (
          <Image source={{ uri: avatarUri }} style={{ width: "100%", height: "100%" }} />
        ) : (
          <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: size * 0.34 }}>
            {initials(name)}
          </Text>
        )}
      </View>
    );
  }

  function renderLiveHostManageActions() {
    return (
      <View style={s.hcActionsWrap as any}>
        <Text style={s.hcActionsGroupTitle as any}>LIVE CONTROL</Text>
        <View style={s.hcActionsRow as any}>
          <Pressable onPress={() => endLiveNow()} style={({ pressed }) => [s.hcActionBtnDanger, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="stop-circle-outline" size={20} color="#FCA5A5" />
            <Text style={s.hcActionBtnDangerText as any}>End Live</Text>
          </Pressable>
          <Pressable onPress={togglePaused} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="pause-circle-outline" size={20} color="#D9B35F" />
            <Text style={s.hcActionBtnText as any}>Pause</Text>
          </Pressable>
          <Pressable onPress={openLayoutStudio} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="grid-outline" size={20} color="#D9B35F" />
            <Text style={s.hcActionBtnText as any}>Switch Layout</Text>
          </Pressable>
        </View>

        <Text style={s.hcActionsGroupTitle as any}>AUDIENCE CONTROL</Text>
        <View style={s.hcActionsRow as any}>
          <Pressable onPress={handleHostRequestsPress} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="hand-left-outline" size={20} color="#38BDF8" />
            <Text style={s.hcActionBtnText as any}>View Requests</Text>
          </Pressable>
          <Pressable onPress={muteAllHostAudience} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="mic-off-outline" size={20} color="#38BDF8" />
            <Text style={s.hcActionBtnText as any}>Mute All</Text>
          </Pressable>
          <Pressable onPress={() => applyLiveRequestPolicy("locked")} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="lock-closed-outline" size={20} color="#EF4444" />
            <Text style={s.hcActionBtnText as any}>Lock Room</Text>
          </Pressable>
        </View>

        <Text style={s.hcActionsGroupTitle as any}>CONTENT CONTROL</Text>
        <View style={s.hcActionsRow as any}>
          <Pressable onPress={() => pressHostTool("Pin topic")} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="bookmark-outline" size={20} color="#D9B35F" />
            <Text style={s.hcActionBtnText as any}>Pin Topic</Text>
          </Pressable>
          <Pressable onPress={() => pressHostTool("Pin name")} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="person-circle-outline" size={20} color="#D9B35F" />
            <Text style={s.hcActionBtnText as any}>Pin Name</Text>
          </Pressable>
          <Pressable onPress={() => pressHostTool("Comment")} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color="#D9B35F" />
            <Text style={s.hcActionBtnText as any}>Comment</Text>
          </Pressable>
        </View>

        <Text style={s.hcActionsGroupTitle as any}>MEDIA CONTROL</Text>
        <View style={s.hcActionsRow as any}>
          <Pressable onPress={() => pressHostTool("Video")} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="videocam-outline" size={20} color="#A78BFA" />
            <Text style={s.hcActionBtnText as any}>Camera</Text>
          </Pressable>
          <Pressable onPress={() => pressHostTool("Photo")} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="image-outline" size={20} color="#A78BFA" />
            <Text style={s.hcActionBtnText as any}>Photo</Text>
          </Pressable>
          <Pressable onPress={pressNextLiveSlot} style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}>
            <Ionicons name="sparkles-outline" size={20} color="#A78BFA" />
            <Text style={s.hcActionBtnText as any}>Next Slot</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderLiveHostSlotOwnerControls() {
    return (
      <View style={s.hcActionsWrap as any}>
        <Text style={s.hcActionsGroupTitle as any}>YOUR SPEAKING SLOT</Text>
        <Text style={[s.hcEmptyText as any, { marginBottom: 10 }]}>
          Mic and camera controls are available during your active slot window only.
        </Text>
        <View style={s.hcActionsRow as any}>
          <Pressable
            onPress={() => {
              toggleMicMuted();
              Haptics.selectionAsync().catch(() => {});
            }}
            style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}
          >
            <Ionicons name={live.micMuted ? "mic-off-outline" : "mic-outline"} size={20} color="#D9B35F" />
            <Text style={s.hcActionBtnText as any}>{live.micMuted ? "Unmute" : "Mic"}</Text>
          </Pressable>
          {cameraPublishAllowedNow ? (
            <>
              <Pressable
                onPress={() => {
                  setCameraPaused((v) => !v);
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}
              >
                <Ionicons
                  name={cameraPaused ? "videocam-off-outline" : "videocam-outline"}
                  size={20}
                  color="#A78BFA"
                />
                <Text style={s.hcActionBtnText as any}>{cameraPaused ? "Camera On" : "Camera Off"}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  toggleCameraFacing();
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}
              >
                <Ionicons name="camera-reverse-outline" size={20} color="#63D1FF" />
                <Text style={s.hcActionBtnText as any}>Flip</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    );
  }

  function renderLiveHostViewerSafePanel() {
    return (
      <View style={s.hcActionsWrap as any}>
        <Text style={s.hcActionsGroupTitle as any}>YOUR ACTIONS</Text>
        <Pressable
          onPress={() => quitLiveRoom()}
          style={({ pressed }) => [s.hcActionBtn, pressed ? s.hcActionBtnPressed : null] as any}
        >
          <Ionicons name="exit-outline" size={20} color="#DCE9FF" />
          <Text style={s.hcActionBtnText as any}>Leave Live</Text>
        </Pressable>
      </View>
    );
  }

  function renderAudienceSpeakerBlock(label: string, speaker: any, accent: string) {
    return (
      <View style={s.audiencePanelBlock as any}>
        <Text style={s.audiencePanelBlockLabel as any}>{label}</Text>
        {speaker?.name ? (
          <View style={s.audiencePanelSpeakerRow as any}>
            {renderHostControlAvatar(String(speaker.name), String(speaker.avatar || ""), 44, accent)}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.audiencePanelSpeakerName as any} numberOfLines={1}>{speaker.name}</Text>
              <Text style={s.audiencePanelSpeakerTopic as any} numberOfLines={1}>
                {speaker.topic || speaker.startTime || "—"}
              </Text>
              {speaker.slot ? (
                <Text style={s.audiencePanelSpeakerMeta as any}>Slot {speaker.slot}</Text>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={s.audiencePanelEmpty as any}>Not scheduled yet</Text>
        )}
      </View>
    );
  }

  function renderAudienceCurrentLiveBlock() {
    const speaker = hostControlLiveSpeaker;
    return (
      <View style={s.audiencePanelBlock as any}>
        <Text style={[s.hcSectionTitlePurple as any, { marginBottom: 8 }]}>CURRENT LIVE SPEAKER</Text>
        {speaker?.name ? (
          <View style={s.audiencePanelSpeakerRow as any}>
            {renderHostControlAvatar(String(speaker.name), String(speaker.avatar || ""), 52, "#22C55E")}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.audiencePanelSpeakerName as any} numberOfLines={1}>{speaker.name}</Text>
              <Text style={s.audiencePanelSpeakerTopic as any} numberOfLines={2}>{speaker.topic}</Text>
              <Text style={s.audiencePanelSpeakerMeta as any}>
                Slot {speaker.slot || "—"} • {speaker.countdown || "Waiting"}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={s.audiencePanelEmpty as any}>Waiting for current speaker</Text>
        )}
      </View>
    );
  }

  function renderAudienceNextSpeakerBlock() {
    const speaker = hostControlNextSpeaker;
    return (
      <View style={s.audiencePanelBlock as any}>
        <Text style={[s.hcSectionTitlePurple as any, { marginBottom: 8 }]}>NEXT SPEAKER</Text>
        {speaker?.name ? (
          <View style={s.audiencePanelSpeakerRow as any}>
            {renderHostControlAvatar(String(speaker.name), String(speaker.avatar || ""), 48, "#A78BFA")}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.audiencePanelSpeakerName as any} numberOfLines={1}>{speaker.name}</Text>
              <Text style={s.audiencePanelSpeakerTopic as any} numberOfLines={1}>{speaker.topic}</Text>
              <Text style={s.audiencePanelSpeakerMeta as any}>
                {speaker.startTime} • Slot {speaker.slot || "—"}
              </Text>
            </View>
            <View style={s.hcReadyPill as any}>
              <Text style={s.hcReadyPillText as any}>{speaker.status || "WAITING"}</Text>
            </View>
          </View>
        ) : (
          <Text style={s.audiencePanelEmpty as any}>No next speaker scheduled</Text>
        )}
      </View>
    );
  }

  function renderAudienceClaimedSpeakersSection(compact = false) {
    const speakers = compact ? hostControlClaimedSpeakers.slice(0, 6) : hostControlClaimedSpeakers;
    return (
      <View style={s.audiencePanelSectionWrap as any}>
        <Text style={s.hcSectionTitlePurple as any}>
          CLAIMED SPEAKERS ({claimedUserCount} USERS • {claimedSlotCount} SLOTS)
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hcSpeakerScroll as any}>
          {speakers.length ? speakers.map((speaker: any) => (
            <View key={speaker.id} style={s.hcSpeakerCard as any}>
              {renderHostControlAvatar(speaker.name, speaker.avatar, 46, speaker.statusColor)}
              <Text style={s.hcSpeakerName as any} numberOfLines={1}>{speaker.name}</Text>
              <Text style={s.hcSpeakerSlot as any}>
                {claimedSpeakerSlotLabelById[speaker.id] || `Slot ${speaker.slot}`}
              </Text>
              <Text style={s.hcSpeakerTopic as any} numberOfLines={1}>{speaker.topic}</Text>
              <Text style={[s.hcSpeakerStatus as any, { color: speaker.statusColor }]}>{speaker.status}</Text>
            </View>
          )) : (
            <Text style={s.hcEmptyText as any}>No claimed speakers yet</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  function renderAudienceViewerStatsSection(compact = false) {
    const stats = hostControlViewerStats;
    return (
      <View style={s.hcViewerSection as any}>
        <View style={s.hcViewerHeader as any}>
          <Text style={s.hcSectionTitleBlue as any}>VIEWERS</Text>
          <View style={s.hcViewerLiveDot as any} />
        </View>
        <View style={s.hcViewerStatsGrid as any}>
          <View style={s.hcViewerStatRow as any}>
            <Text style={s.hcViewerStatLabel as any}>Total viewers</Text>
            <Text style={s.hcViewerStatValue as any}>{stats.totalViewers}</Text>
          </View>
          <View style={s.hcViewerStatRow as any}>
            <Text style={s.hcViewerStatLabel as any}>Active viewers</Text>
            <Text style={s.hcViewerStatValue as any}>{stats.activeViewers}</Text>
          </View>
          <View style={s.hcViewerStatRow as any}>
            <Text style={s.hcViewerStatLabel as any}>Members in live</Text>
            <Text style={s.hcViewerStatValue as any}>{stats.members}</Text>
          </View>
          <View style={s.hcViewerStatRow as any}>
            <Text style={s.hcViewerStatLabel as any}>Leaders in live</Text>
            <Text style={s.hcViewerStatValue as any}>{stats.leaders}</Text>
          </View>
        </View>
        {!compact ? (
          <View style={[s.hcViewerBreakdownRow as any, { flexWrap: "wrap" }]}>
            {[
              { label: "TOTAL", value: stats.totalViewers },
              { label: "ACTIVE", value: stats.activeViewers },
              { label: "MEMBERS", value: stats.members },
              { label: "LEADERS", value: stats.leaders },
              { label: "GUESTS", value: stats.guests },
            ].map((chip) => (
              <View key={chip.label} style={[s.hcViewerChip as any, { minWidth: 52 }]}>
                <Text style={s.hcViewerChipValue as any}>{chip.value}</Text>
                <Text style={s.hcViewerChipLabel as any}>{chip.label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={s.audiencePanelStatCard as any}>
            <Text style={s.audiencePanelBlockLabel as any}>GUESTS IN LIVE</Text>
            <Text style={s.audiencePanelStatValue as any}>{stats.guests}</Text>
          </View>
        )}
      </View>
    );
  }

  function renderAudienceUpcomingQueueSection() {
    return (
      <View style={s.hcQueueSection as any}>
        <Text style={s.hcSectionTitleGold as any}>UPCOMING QUEUE</Text>
        {hostControlUpcomingQueue.length ? hostControlUpcomingQueue.map((item: any, index: number) => (
          <View key={`audience-queue-${item.slot}-${index}`} style={s.hcQueueTimelineRow as any}>
            <View style={s.hcQueueTimelineRail as any}>
              <View style={[s.hcQueueTimelineDot as any, item.claimed ? s.hcQueueTimelineDotClaimed : null]} />
              {index < hostControlUpcomingQueue.length - 1 ? <View style={s.hcQueueTimelineLine as any} /> : null}
            </View>
            <View style={s.hcQueueTimelineBody as any}>
              <Text style={s.hcQueueTimelineSlot as any}>Slot {item.slot}</Text>
              <Text style={s.hcQueueTimelineTime as any}>{item.timeLabel}</Text>
              <Text style={s.hcQueueTimelineName as any} numberOfLines={1}>
                {item.name} • {String(item.status || "").toUpperCase()}
              </Text>
            </View>
          </View>
        )) : (
          <Text style={s.hcEmptyText as any}>No upcoming scheduled slots</Text>
        )}
      </View>
    );
  }

  function renderAudienceMicStatusSection() {
    return (
      <View style={s.audiencePanelMicSection as any}>
        <Text style={s.hcSectionTitleGold as any}>MY MIC STATUS</Text>
        <View style={s.audiencePanelMicRow as any}>
          <Ionicons name="mic-outline" size={18} color="#38BDF8" />
          <Text style={s.audiencePanelMicText as any}>{audienceMicStatus.micLabel}</Text>
        </View>
        <View style={s.audiencePanelMicRow as any}>
          <Ionicons name="videocam-outline" size={18} color="#A78BFA" />
          <Text style={s.audiencePanelMicText as any}>{audienceMicStatus.cameraLabel}</Text>
        </View>
      </View>
    );
  }

  function renderAudienceSafeActions() {
    return (
      <View style={s.audiencePanelActionsWrap as any}>
        <Text style={s.audiencePanelBlockLabel as any}>SAFE ACTIONS</Text>
        {openClaimableSlots.length ? (
          <Pressable
            onPress={() => navigateToLiveSlotsForClaim(openClaimableSlots[0])}
            style={({ pressed }) => ([s.audiencePanelClaimBtn, s.audiencePanelActionBtnWide, pressed ? s.audiencePanelClaimBtnPressed : null] as any)}
          >
            <Ionicons name="add-circle-outline" size={16} color="#F4D06F" />
            <Text style={s.audiencePanelClaimBtnText as any}>Go Claim Open Slot</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push("/" as any)}
            style={({ pressed }) => ([s.audiencePanelSecondaryBtn, pressed ? s.audiencePanelClaimBtnPressed : null] as any)}
          >
            <Ionicons name="home-outline" size={16} color="#DCE9FF" />
            <Text style={s.audiencePanelSecondaryBtnText as any}>Go to Home Feed</Text>
          </Pressable>
        )}
        <Pressable
          onPress={handleSharePress}
          style={({ pressed }) => ([s.audiencePanelSecondaryBtn, pressed ? s.audiencePanelClaimBtnPressed : null] as any)}
        >
          <Ionicons name="share-social-outline" size={16} color="#DCE9FF" />
          <Text style={s.audiencePanelSecondaryBtnText as any}>Share Live</Text>
        </Pressable>
        <Pressable
          onPress={() => quitLiveRoom()}
          style={({ pressed }) => ([s.audiencePanelCloseBtn, pressed ? s.audiencePanelCloseBtnPressed : null] as any)}
        >
          <Ionicons name="close-circle-outline" size={18} color="#FFFFFF" />
          <Text style={s.audiencePanelCloseBtnText as any}>Close Live</Text>
        </Pressable>
      </View>
    );
  }

  function canSelectedProfileModerate(id?: string | null) {
    const selectedId = String(id || "").trim();
    return !!selectedId && !!moderatorIds[selectedId] && selectedId !== "host";
  }

  function openLayoutStudio() {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("layout-studio");
      return;
    }
    pressHostTool("Layout");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    return;
  }

  function chooseStudioLayout(next: LayoutMode) {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("choose-layout");
      return;
    }
    if (next === "focus") {
      setLayoutDraftMode("focus");
      setLayoutMode("focus");
      setLayoutStudioOpen(false);
      Haptics.selectionAsync().catch(() => {});
      return;
    }

    setLayoutDraftMode(next);
    setLayoutMode(next);
    setLayoutStudioOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function applyStudioLayout() {
    setLayoutMode(layoutDraftMode);
    setLayoutStudioOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function renderLayoutStudioCard(title: string, meta: string, people: number, mode: LayoutMode) {
    const selected = layoutDraftMode === mode;

    return (
      <Pressable
        key={`${title}_${mode}`}
        onPress={() => chooseStudioLayout(mode)}
        style={({ pressed }) => ([
          s.layoutStudioCard as ViewStyle,
          selected ? (s.layoutStudioCardActive as ViewStyle) : null,
          pressed ? (s.layoutStudioCardPressed as ViewStyle) : null,
        ] as any)}
      >
        <View style={s.layoutStudioMini as ViewStyle}>
          {title.includes("Side") ? (
            <>
              <View style={s.layoutIconSide as ViewStyle} />
              <View style={s.layoutIconSide as ViewStyle} />
            </>
          ) : title.includes("Focus") ? (
            <>
              <View style={s.layoutIconBigLeft as ViewStyle} />
              <View style={s.layoutIconSmallStack as ViewStyle} />
            </>
          ) : title.includes("Fluid") ? (
            <>
              <View style={s.layoutIconTall as ViewStyle} />
              <View style={s.layoutIconGridSmall as ViewStyle} />
            </>
          ) : title.includes("Lead") ? (
            <>
              <View style={s.layoutIconLeadTop as ViewStyle} />
              <View style={s.layoutIconBottomHalf as ViewStyle} />
              <View style={s.layoutIconBottomHalf as ViewStyle} />
            </>
          ) : title.includes("Round") ? (
            <>
              <View style={s.layoutIconSeat as ViewStyle} />
              <View style={s.layoutIconSeat as ViewStyle} />
              <View style={s.layoutIconSeat as ViewStyle} />
              <View style={s.layoutIconSeat as ViewStyle} />
              <View style={s.layoutIconSeat as ViewStyle} />
              <View style={s.layoutIconSeat as ViewStyle} />
            </>
          ) : title.includes("Grid") ? (
            <>
              {Array.from({ length: 9 }).map((_, i) => <View key={i} style={s.layoutIconNine as ViewStyle} />)}
            </>
          ) : title.includes("TV") ? (
            <>
              <View style={s.layoutIconWideTop as ViewStyle} />
              <View style={s.layoutIconBottomThird as ViewStyle} />
              <View style={s.layoutIconBottomThird as ViewStyle} />
              <View style={s.layoutIconBottomThird as ViewStyle} />
            </>
          ) : title.includes("Speaker") ? (
            <>
              <View style={s.layoutIconBigLeft as ViewStyle} />
              <View style={s.layoutIconTinyStack as any} />
            </>
          ) : (
            <>
              <View style={s.layoutIconWideTop as ViewStyle} />
              <View style={s.layoutIconNine as ViewStyle} />
              <View style={s.layoutIconNine as ViewStyle} />
              <View style={s.layoutIconNine as ViewStyle} />
              <View style={s.layoutIconNine as ViewStyle} />
            </>
          )}
        </View>

        <Text style={s.layoutStudioCardTitle as any}>{title}</Text>
        <Text style={s.layoutStudioCardMeta as any}>{meta}</Text>

        {selected ? (
          <View style={s.layoutStudioSelectedPill as any}>
            <Ionicons name="checkmark" size={12} color="#07111F" />
            <Text style={s.layoutStudioSelectedText as any}>ACTIVE</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  const closeHostDrawer = () => {
    Animated.timing(hostDrawerX, {
      toValue: 360,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setHostDrawerOpen(false);
    });
  };

  const openViewerFlow = () => {
    setViewerFlowOpen(true);
    Animated.spring(viewerFlowX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 18,
    }).start();
  };

  const closeViewerFlow = () => {
    Animated.timing(viewerFlowX, {
      toValue: VIEWER_FLOW_PANEL_W,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setViewerFlowOpen(false);
    });
  };

  const hostDrawerPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (!hostDrawerOpen && g.dx < -12) {
          const next = Math.max(0, Math.min(360, 360 + g.dx));
          hostDrawerX.setValue(next);
          return;
        }
        if (hostDrawerOpen && g.dx > 0) {
          const next = Math.max(0, Math.min(360, g.dx));
          hostDrawerX.setValue(next);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (!hostDrawerOpen) {
          if (g.dx < -70) {
            openHostDrawer();
          } else {
            Animated.timing(hostDrawerX, {
              toValue: 360,
              duration: 160,
              useNativeDriver: true,
            }).start();
          }
          return;
        }

        if (g.dx > 70) {
          closeHostDrawer();
        } else {
          Animated.spring(hostDrawerX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
            speed: 18,
          }).start();
        }
      },
    })
  ).current;

  const viewerFlowPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (!viewerFlowOpen && g.dx < -12) {
          const next = Math.max(0, Math.min(VIEWER_FLOW_PANEL_W, VIEWER_FLOW_PANEL_W + g.dx));
          viewerFlowX.setValue(next);
          return;
        }
        if (viewerFlowOpen && g.dx > 0) {
          const next = Math.max(0, Math.min(VIEWER_FLOW_PANEL_W, g.dx));
          viewerFlowX.setValue(next);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (!viewerFlowOpen) {
          if (g.dx < -70) {
            openViewerFlow();
          } else {
            Animated.timing(viewerFlowX, {
              toValue: VIEWER_FLOW_PANEL_W,
              duration: 160,
              useNativeDriver: true,
            }).start();
          }
          return;
        }

        if (g.dx > 70) {
          closeViewerFlow();
        } else {
          Animated.spring(viewerFlowX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
            speed: 18,
          }).start();
        }
      },
    })
  ).current;

  const flowRows = useMemo(
    () =>
      scheduleCards
        .map((m: any, index: number) => {
          const card = m?.card || {};
          const startMs = new Date(String(card.meetingDate || "")).getTime();
          const durationMin = Math.max(0, Number(card.durationMin || 0));
          const endMs = startMs + durationMin * 60 * 1000;

          if (!Number.isFinite(startMs)) return null;

          return {
            id: String(m?.id || `flow_${index}`),
            slotLabel: String(card.slotLabel || `Slot ${index + 1}`),
            title: String(card.title || card.task || `Slot ${index + 1}`),
            roleLabel: String(card.roleLabel || "").trim(),
            timeLabel: String(card.timeLabel || "").trim(),
            startMs,
            endMs,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.startMs - b.startMs),
    [scheduleCards]
  );

  const viewerCurrentFlowIndex = useMemo(
    () => flowRows.findIndex((row: any) => liveNowMs >= row.startMs && liveNowMs < row.endMs),
    [flowRows, liveNowMs]
  );

  const viewerNextFlowIndex = useMemo(() => {
    const futureIdx = flowRows.findIndex((row: any) => liveNowMs < row.startMs);
    if (futureIdx >= 0) return futureIdx;
    if (viewerCurrentFlowIndex >= 0 && viewerCurrentFlowIndex + 1 < flowRows.length) {
      return viewerCurrentFlowIndex + 1;
    }
    return -1;
  }, [flowRows, liveNowMs, viewerCurrentFlowIndex]);

  const viewerUpcomingFlowRow =
    viewerNextFlowIndex >= 0 ? flowRows[viewerNextFlowIndex] : null;

  const approvedRequestGuests = useMemo<LiveGuest[]>(
    () =>
      Object.entries(joinRequestsBySlot)
        .filter(([, req]: any) => !!req?.approved && !!req?.onStage)
        .map(([slot, req]) => ({
          id: `request-slot-${slot}`,
          name: String(req?.name || "Guest"),
          role: "Guest",
          status: "approved",
          avatar: String(
            req?.avatar ||
            (req as any)?.avatarUrl ||
            (req as any)?.profileImage ||
            (req as any)?.photoURL ||
            (req as any)?.image ||
            initials(String(req?.name || "Guest"))
          ),
        })),
    [joinRequestsBySlot]
  );

  const guests = useMemo<LiveGuest[]>(
    () => {
      if (isMediaInstantLive) {
        return approvedRequestGuests;
      }

      const source = activeStageSlots
        .map((slot: any, index: number) => {
          const claimedBy = String(slot?.name || "").trim();
          const role = String(slot?.role || "Assigned").trim();
          const id =
            String(slot?.claimedByUserId || "").trim() ||
            String(slot?.id || `active_${index}`).trim() ||
            `active_${index}`;

          if (!claimedBy) return null;

          return {
            id,
            name: claimedBy === "You" ? "You" : claimedBy,
            role,
            avatar: resolveParticipantAvatarUri(slot),
          };
        })
        .filter(Boolean) as LiveGuest[];

      return source;
    },
    [approvedRequestGuests, activeStageSlots, isMediaInstantLive, memberAvatarByUserId, resolvedAvatarByUserId, liveProfileAvatarUri, session?.userId]
  );

  const pinnedGuest = useMemo(
    () => guests.find((x) => x.id === pinnedGuestId) ?? guests[0] ?? { id: "solo", name: "You", role: "Host" },
    [guests, pinnedGuestId]
  );

  const splitGuests = useMemo(
    () => [
      { id: "host", name: "You", role: "Host" },
      pinnedGuest,
    ],
    [pinnedGuest]
  );

  function slotRingColor(slot: any) {
    const colors = [
      "#FFD34D", // S1 gold
      "#28E070", // S2 green
      "#4DA3FF", // S3 blue
      "#FFB84D", // S4 orange
      "#D946EF", // S5 purple
      "#38BDF8", // S6 sky
      "#A855F7", // S7 violet
      "#FACC15", // S8 yellow
      "#22C55E", // S9 emerald
      "#60A5FA", // S10 blue
      "#E879F9", // S11 pink
      "#FB7185", // S12 rose
    ];
    const n = Math.max(1, Number(slot || 1));
    return colors[(n - 1) % colors.length];
  }

  function initials(name: string) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase() || "")
      .join("") || "?";
  }

  const gridGuests = useMemo(
    () => guests.filter((x) => x.id !== pinnedGuest.id).slice(0, 2),
    [guests, pinnedGuest]
  );

  const grid4Guests = useMemo(
    () => [pinnedGuest, ...guests.filter((x) => x.id !== pinnedGuest.id)].slice(0, 4),
    [guests, pinnedGuest]
  );

  const duoPlusGuests = useMemo(
    () => [pinnedGuest, ...guests.filter((x) => x.id !== pinnedGuest.id)].slice(0, 6),
    [guests, pinnedGuest]
  );

  const mcRuntime = useMemo(
    () => getChurchProjectMcRuntime(selectedAssignment?.id || assignmentId || "assignment"),
    [selectedAssignment?.id, assignmentId]
  );

  const liveSlotState = useMemo(
    () => getChurchProjectMcLiveSlotState(selectedAssignment?.id || assignmentId || "assignment"),
    [selectedAssignment?.id, assignmentId]
  );

  const activeSlot = liveSlotState.current || mcRuntime.current;
  const nextSlot = liveSlotState.next || mcRuntime.next;

  const liveAssignmentVideo = useMemo(() => {
    const threadId = String(selectedAssignment?.id || assignmentId || "").trim();
    if (!threadId) return null;

    const snap = getSnapshot();
    const arr = Array.isArray(snap.messages?.[threadId]) ? snap.messages[threadId] : [];

    const norm = (v: any) => String(v || "").trim().toLowerCase();

    const slotNames = [
      norm(activeSlot?.name),
      norm(activeSlot?.task),
      norm(activeSlot?.sourceSlotName),
    ].filter(Boolean);

    const matched = arr.find((m: any) => {
      const card = m?.card;
      if (m?.kind !== "assignment_card" || !card) return false;
      if (String(card.status || "").toLowerCase() !== "taken") return false;

      const cardNames = [
        norm(card.title),
        norm(card.task),
        norm(card.roleLabel),
        norm(card.slotLabel),
      ].filter(Boolean);

      const sameProgram = slotNames.some((slotName) =>
        cardNames.some((cardName) => slotName && cardName && (cardName.includes(slotName) || slotName.includes(cardName)))
      );

      return sameProgram;
    });

    if (!matched?.card) return null;

    const items = Array.isArray((matched.card as any).videoItems)
      ? (matched.card as any).videoItems
      : [];

    if (!items.length) return null;

    return {
      cardTitle: String(matched.card.title || activeSlot?.name || "Live slot"),
      claimedBy: String(matched.card.claimedByName || "").trim(),
      item: items[0],
    };
  }, [selectedAssignment?.id, assignmentId, activeSlot?.name, activeSlot?.task, activeSlot?.sourceSlotName]);

  const scheduleAudienceLabel = useMemo(() => {
    const fromPlan = String((mcRuntime as any)?.meetingPlan?.target || "").trim();
    const fromCurrent = Array.isArray((mcRuntime as any)?.current?.chat)
      ? String((mcRuntime as any).current.chat.find((x: any) => String(x || "").toLowerCase().startsWith("audience:")) || "").replace(/^Audience:\s*/i, "").trim()
      : "";
    const picked = fromPlan || fromCurrent || "Guests";

    if (picked.toLowerCase().includes("leaders & admins")) return "Leaders & Admins";
    if (picked.toLowerCase().includes("leader")) return "Leaders";
    if (picked.toLowerCase().includes("member")) return "Members";
    return "Guests";
  }, [mcRuntime]);

  const scheduleAudienceAccessText = useMemo(() => {
    if (scheduleAudienceLabel === "Leaders & Admins") return "Access: leaders & admins only";
    if (scheduleAudienceLabel === "Leaders") return "Access: leaders and admins";
    if (scheduleAudienceLabel === "Members") return "Access: church members";
    return "Access: guests, members, leaders";
  }, [scheduleAudienceLabel]);

  const roleLabel = String(isHost ? "Host" : "Viewer");
  const normalizedRole = String(roleLabel || "").toLowerCase();

  const isAdminRole =
    normalizedRole.includes("admin") ||
    normalizedRole.includes("pastor") ||
    normalizedRole.includes("host");

  const isLeaderRole =
    isAdminRole ||
    normalizedRole.includes("leader");

  const isMemberRole =
    isLeaderRole ||
    normalizedRole.includes("member") ||
    normalizedRole.includes("viewer") ||
    normalizedRole.includes("guest");

  const audienceGateAllowed = useMemo(() => {
    if (isMediaInstantLive) return true;
    if (scheduleAudienceLabel === "Guests") return true;
    if (scheduleAudienceLabel === "Members") return isMemberRole;
    if (scheduleAudienceLabel === "Leaders") return isLeaderRole;
    if (scheduleAudienceLabel === "Leaders & Admins") return isAdminRole;
    return true;
  }, [isMediaInstantLive, scheduleAudienceLabel, isMemberRole, isLeaderRole, isAdminRole]);

  const audienceGateMessage = useMemo(() => {
    if (audienceGateAllowed) return "";
    if (scheduleAudienceLabel === "Members") return "This live is for church members only.";
    if (scheduleAudienceLabel === "Leaders") return "This live is for leaders and admins only.";
    if (scheduleAudienceLabel === "Leaders & Admins") return "This live is for leaders & admins only.";
    return "This live is not open for your role.";
  }, [audienceGateAllowed, scheduleAudienceLabel]);

  const approvedAccessRequest = useMemo(
    () => Object.values(joinRequestsBySlot || {}).some((req: any) => !!req?.approved && String(req?.name || "").toLowerCase() === "you"),
    [joinRequestsBySlot]
  );

  const finalAudienceGateAllowed =
    audienceGateAllowed ||
    (approvedAccessRequest && accessApproveCountdown === 0);

  useEffect(() => {
    if (accessApproveCountdown === null || accessApproveCountdown <= 0) return;
    const t = setInterval(() => {
      setAccessApproveCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [accessApproveCountdown]);

  useEffect(() => {
    if (!approvedAccessRequest || audienceGateAllowed || isMediaInstantLive) return;
    if (accessApproveCountdown !== null) return;
    setAccessApproveCountdown(5);
  }, [approvedAccessRequest, audienceGateAllowed, isMediaInstantLive, accessApproveCountdown]);

  const liveMeta = useMemo(() => {
    if (isMediaInstantLive) return `${live.viewerCount} • Creator controls`;
    if (!liveScheduleReady) return "Waiting for leader schedule";
    if (liveStillActive) return `${activeSlot?.name || mcRuntime.current.name} live now • ${scheduleAudienceLabel}`;

    const normalizedRoleInside = String(params.role || "").toLowerCase();
    const isLeaderRoleInside =
      normalizedRoleInside.includes("leader") ||
      normalizedRoleInside.includes("admin") ||
      normalizedRoleInside.includes("pastor") ||
      normalizedRoleInside.includes("host");

    const isClaimedViewerInside = claimedScheduleCards.some((m: any) => {
      const card = m?.card || {};
      const claimedByName = String(card.claimedByName || "").trim().toLowerCase();
      return claimedByName === "you";
    });

    const viewerCanBackstage =
      !!backstageOpen &&
      (isLeaderRoleInside || isClaimedViewerInside) &&
      (requestedEntryMode === "backstage" || requestedEntryMode === "live");

    const viewerCanWaiting =
      !!audienceOpen &&
      (requestedEntryMode === "waiting" || requestedEntryMode === "live");

    if (requestedEntryMode === "backstage" && viewerCanBackstage) return `Private backstage open • ${scheduleAudienceLabel}`;
    if (requestedEntryMode === "waiting" && viewerCanWaiting) return `${scheduleAudienceAccessText} • ${live.viewerCount} / waiting`;
    if (audienceOpen && !finalAudienceGateAllowed) return `${scheduleAudienceAccessText} • locked for your role`;
    if (audienceOpen) return `${scheduleAudienceAccessText} • ${live.viewerCount} / waiting`;
    if (backstageOpen) return `Claimed team backstage open • ${scheduleAudienceLabel}`;
    return `Live not open yet • ${scheduleAudienceLabel}`;
  }, [isMediaInstantLive, liveScheduleReady, liveStillActive, requestedEntryMode, backstageOpen, audienceOpen, finalAudienceGateAllowed, claimedScheduleCards, params.role, mcRuntime, live.viewerCount, activeSlot?.name, scheduleAudienceLabel, scheduleAudienceAccessText]);



  const isClaimedViewer = useMemo(
    () =>
      claimedScheduleCards.some((m: any) => {
        const card = m?.card || {};
        const claimedByName = String(card.claimedByName || "").trim().toLowerCase();
        return claimedByName === "you";
      }),
    [claimedScheduleCards]
  );

  const canEnterBackstage =
    !!liveScheduleReady &&
    !!backstageOpen &&
    (isLeaderRole || isClaimedViewer) &&
    (requestedEntryMode === "backstage" || requestedEntryMode === "live");

  const canEnterWaitingRoom =
    !!liveScheduleReady &&
    !!audienceOpen &&
    !!finalAudienceGateAllowed &&
    (requestedEntryMode === "waiting" || requestedEntryMode === "live");

  const canEnterMainLive =
    !!liveScheduleReady &&
    !!liveStillActive &&
    !!finalAudienceGateAllowed &&
    requestedEntryMode === "live";

  const canEnterRoom =
    isMediaInstantLive ||
    canEnterBackstage ||
    canEnterWaitingRoom ||
    canEnterMainLive;

  const liveEnabled = isMediaInstantLive || canEnterRoom;

  useEffect(() => {
    const routeClaimedByUserId = String((params as any)?.claimedByUserId || "").trim();
    const claimedByMeRoute =
      !!currentUserId && !!routeClaimedByUserId && routeClaimedByUserId === currentUserId;
    const accessAllowed =
      isMediaInstantLive ||
      canEnterRoom ||
      canPublishClaimedMicNow ||
      canPublishLiveVideoNow ||
      userOwnsCurrentActiveSlot;

    let blockedReason = "";
    if (!accessAllowed) {
      if (!liveScheduleReady) blockedReason = "schedule-not-ready";
      else if (!finalAudienceGateAllowed) blockedReason = "audience-gate";
      else if (!liveStillActive && requestedEntryMode === "live") blockedReason = "live-not-active";
      else if (!canEnterRoom) blockedReason = "room-entry-closed";
      else if (claimedByMeRoute && !canPublishClaimedMicNow && !canPublishLiveVideoNow) {
        blockedReason = "claimed-but-publish-blocked";
      } else blockedReason = "unknown";
    }

    console.log("KRISTO_LIVE_ROOM_ACCESS_RESULT", {
      currentUserId,
      routeClaimedByUserId,
      claimedByMeRoute,
      churchSubscriptionActive,
      audienceGateAllowed,
      finalAudienceGateAllowed,
      liveScheduleReady,
      liveStillActive,
      backstageOpen,
      audienceOpen,
      requestedEntryMode,
      canEnterBackstage,
      canEnterWaitingRoom,
      canEnterMainLive,
      canEnterRoom,
      liveEnabled,
      canPublishClaimedMicNow,
      canPublishLiveVideoNow,
      userOwnsCurrentActiveSlot,
      userHasClaimedScheduleSlot,
      isCurrentActiveSlotOwnerForLiveRoom,
      routeCanPublish: String((params as any)?.canPublish || ""),
      routeCanPublishMic: String((params as any)?.canPublishMic || ""),
      routeCanPublishCamera: String((params as any)?.canPublishCamera || ""),
      accessAllowed,
      blockedReason,
      showsAccessRestrictedOverlay: !finalAudienceGateAllowed && !isMediaInstantLive,
    });
  }, [
    currentUserId,
    (params as any)?.claimedByUserId,
    (params as any)?.canPublish,
    (params as any)?.canPublishMic,
    (params as any)?.canPublishCamera,
    churchSubscriptionActive,
    audienceGateAllowed,
    finalAudienceGateAllowed,
    liveScheduleReady,
    liveStillActive,
    backstageOpen,
    audienceOpen,
    requestedEntryMode,
    canEnterBackstage,
    canEnterWaitingRoom,
    canEnterMainLive,
    canEnterRoom,
    liveEnabled,
    canPublishClaimedMicNow,
    canPublishLiveVideoNow,
    userOwnsCurrentActiveSlot,
    userHasClaimedScheduleSlot,
    isCurrentActiveSlotOwnerForLiveRoom,
    isMediaInstantLive,
  ]);

  const livePresenceKey = useMemo(
    () => `live:${String(params.title || "Youth")}:${isHost ? "host" : "viewer"}:${String(params.role || "viewer")}:${Math.random().toString(36).slice(2, 10)}`,
    []
  );
  const routeRoleLower = String(params.role || "").trim().toLowerCase();

  // SECURITY: host management authority is computed above (canManageLiveHostActions).
  // Claimed slot users may open a limited speaker panel only during their active slot window.

  useEffect(() => {
    canManageLiveRef.current = canManageLive;
    canSeeLiveHostControlsRef.current = canSeeLiveHostControls;
    isMyScheduledLiveTurnRef.current = !!isMyScheduledLiveTurn;
  }, [canManageLive, canSeeLiveHostControls, isMyScheduledLiveTurn]);

  useEffect(() => {
    console.log("KRISTO_LIVE_HOST_PANEL_ACCESS", {
      userId: currentUserId,
      role: String((session as any)?.role || params.role || "viewer"),
      isPastor: isPastorForLiveRoom,
      isApprovedMediaHost: isApprovedMediaHostForLiveRoom,
      isCurrentActiveSlotOwner: isCurrentActiveSlotOwnerForLiveRoom,
      canSeeLiveHostControls,
      canManageLiveHostActions,
      source: "live-room",
    });
  }, [
    currentUserId,
    (session as any)?.role,
    params.role,
    isPastorForLiveRoom,
    isApprovedMediaHostForLiveRoom,
    isCurrentActiveSlotOwnerForLiveRoom,
    canSeeLiveHostControls,
    canManageLiveHostActions,
  ]);

  useEffect(() => {
    if (isMediaInstantLive) return;

    if (canManageLive) {
      console.log("KRISTO_PASTOR_ROOM_STATE", {
        liveBridgeId,
        liveScheduleFeedId,
        claimedSlotCount: runtimeScheduleSlots.filter((slot: any) =>
          String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()
        ).length,
        runtimeSlotCount: runtimeScheduleSlots.length,
        joinRequestCount: 0,
        presenceCount: Object.keys(liveViewerPresence || {}).length,
        currentSlotOwnerId,
        currentSlotNumber,
      });

      console.log("KRISTO_HOST_VISIBLE_PARTICIPANTS", {
        liveBridgeId,
        stagePeople: scheduledStagePeople.map((guest: any) => ({
          slot: guest.slot,
          userId: guest.claimedByUserId,
          name: guest.name,
        })),
        queueSlots: visibleQueueSlots.map((guest: any) => ({
          slot: guest.slot,
          userId: guest.claimedByUserId,
          name: guest.name,
        })),
      });
    } else if (myClaimedStageSlot) {
      console.log("KRISTO_CLAIMED_MEMBER_VISIBLE", {
        liveBridgeId,
        userId: currentUserId,
        slot: Number((myClaimedStageSlot as any)?.slot || 0),
        isMyScheduledLiveTurn,
        claimedByUserId: String((myClaimedStageSlot as any)?.claimedByUserId || ""),
      });
    }
  }, [
    isMediaInstantLive,
    canManageLive,
    liveBridgeId,
    liveScheduleFeedId,
    runtimeScheduleSlots,
    joinRequestsBySlot,
    liveViewerPresence,
    scheduledStagePeople,
    visibleQueueSlots,
    myClaimedStageSlot,
    currentUserId,
    currentSlotOwnerId,
    currentSlotNumber,
    isMyScheduledLiveTurn,
    feedScheduleTick,
  ]);

  useEffect(() => {
    if (!canManageLive || !isFocused || isMediaInstantLive || !liveBridgeId) return;
    void fetchLightLiveStateWithPerf(
      liveApiHeaders as any,
      "LiveRoomPastorFast",
      liveBridgeId,
      "pastor-fast"
    ).then((patch) => {
      applyBackendLivePatch(patch, "pastor-fast");
    });
  }, [canManageLive, isFocused, feedScheduleTick, liveApiHeaders, isMediaInstantLive, liveBridgeId, applyBackendLivePatch]);

  const canUseAuthorityControls = isMediaInstantLive || (canManageLive && (canEnterBackstage || liveStillActive));
  const canSeeAuthorityBar =
    !isMediaInstantLive &&
    (liveStillActive ||
      canUseAuthorityControls ||
      (!!canEnterBackstage && (isLeaderRole || isClaimedViewer)));
  const isCoHostRole = normalizedRole.includes("co-host") || normalizedRole.includes("cohost");
  const isViewerRole = !canManageLive && !isCoHostRole;
  const canSeeHostCommandCenter = canManageLiveHostActions;
  const canSeeAudiencePanel = !canSeeLiveHostControls && !isMediaInstantLive;
  const isClaimedMemberAudience = canSeeAudiencePanel && !!myClaimedStageSlot;

  useEffect(() => {
    console.log("KRISTO_AUDIENCE_PANEL_GATE", {
      canSeeAudiencePanel,
      viewerFlowOpen,
      layoutMode,
      isClaimedMember: !!myClaimedStageSlot,
      canSeeHostCommandCenter,
    });
  }, [
    canSeeAudiencePanel,
    viewerFlowOpen,
    layoutMode,
    myClaimedStageSlot,
    canSeeHostCommandCenter,
  ]);

  const viewerApprovedGuestOnStage =
    isViewerRole &&
    Object.values(joinRequestsBySlot || {}).some((req: any) =>
      !!req?.approved &&
      !!req?.onStage &&
      String(req?.userId || "").trim() === String(session?.userId || "").trim()
    );



  const scheduleTimeline = useMemo(
    () =>
      scheduleCards
        .map((m: any, index: number) => {
          const card = m?.card || {};
          const startMs = new Date(String(card?.meetingDate || "")).getTime();
          const durationMin = Math.max(0, Number(card?.durationMin || 0));
          const endMs = startMs + durationMin * 60 * 1000;

          if (!Number.isFinite(startMs)) return null;

          return {
            id: String(m?.id || `slot_${index}`),
            startMs,
            endMs,
            title: String(card?.title || card?.task || `Slot ${index + 1}`),
            task: String(card?.task || card?.title || "Live slot"),
            roleLabel: String(card?.roleLabel || "").trim(),
            claimedByName: String(card?.claimedByName || "").trim(),
            claimedByUserId: String(card?.claimedByUserId || "").trim(),
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.startMs - b.startMs),
    [scheduleCards]
  );

  const currentScheduleEntry = useMemo(
    () =>
      scheduleTimeline.find((entry: any) => liveNowMs >= entry.startMs && liveNowMs <= entry.endMs) ||
      null,
    [scheduleTimeline, liveNowMs]
  );

  const nextScheduleEntry = useMemo(
    () =>
      scheduleTimeline.find((entry: any) => entry.startMs > liveNowMs) ||
      null,
    [scheduleTimeline, liveNowMs]
  );


  
  
  
  
  
  
  const [stageGuestIds, setStageGuestIds] = useState<string[]>([]);
  const [authorityMutedIds, setAuthorityMutedIds] = useState<Record<string, boolean>>({});
  const [slotExtendMs, setSlotExtendMs] = useState(0);
  const [slotWarnedEntryId, setSlotWarnedEntryId] = useState<string | null>(null);

  useEffect(() => {
    setSlotExtendMs(0);
    setSlotWarnedEntryId(null);
  }, [currentScheduleEntry?.id]);

  useEffect(() => {
    if (!guests.length) {
      setStageGuestIds([]);
      return;
    }

    setStageGuestIds((prev) => prev.filter((id) => guests.some((g) => g.id === id)));
  }, [guests]);

  function formatAuthorityCountdown(ms: number, opts?: { signed?: boolean }) {
    const signed = !!opts?.signed;
    const negative = signed && ms < 0;
    const totalSec = Math.floor(Math.abs(ms) / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${negative ? "+" : ""}${min}:${String(sec).padStart(2, "0")}`;
  }

  const authorityTargetEndMs = useMemo(() => {
    if (!liveStillActive) return null;
    return (currentScheduleEntry?.endMs || liveEndMs || liveNowMs) + slotExtendMs;
  }, [
    liveStillActive,
    currentScheduleEntry?.endMs,
    liveEndMs,
    liveNowMs,
    slotExtendMs,
  ]);

  const authorityRemainingMs = useMemo(() => {
    if (typeof authorityTargetEndMs !== "number") return null;
    return authorityTargetEndMs - liveNowMs;
  }, [authorityTargetEndMs, liveNowMs]);

  const authorityCountdownTone = useMemo(() => {
    if (!liveStillActive || authorityRemainingMs == null) return "normal" as const;
    if (authorityRemainingMs < 0) return "overtime" as const;
    if (authorityRemainingMs <= 30 * 1000) return "danger" as const;
    if (authorityRemainingMs <= 60 * 1000) return "warn" as const;
    return "normal" as const;
  }, [liveStillActive, authorityRemainingMs]);

  useEffect(() => {
    if (!canManageLive) return;
    if (!liveStillActive) return;
    if (!currentScheduleEntry?.id) return;
    if (authorityRemainingMs == null) return;
    if (authorityRemainingMs <= 0) return;
    if (authorityRemainingMs > 30 * 1000) return;
    if (slotWarnedEntryId === currentScheduleEntry.id) return;

    setSlotWarnedEntryId(currentScheduleEntry.id);
    Alert.alert(
      "30 sec warning",
      `${currentScheduleEntry.title || "Current speaker"} ana sekunde 30 zilizobaki.`
    );
  }, [
    canManageLive,
    liveStillActive,
    currentScheduleEntry?.id,
    currentScheduleEntry?.title,
    authorityRemainingMs,
    slotWarnedEntryId,
  ]);

  const nextSpeakerLabel = useMemo(() => {
    if (nextScheduleEntry?.title) return nextScheduleEntry.title;
    if (nextSlot?.name) return String(nextSlot.name);
    return "";
  }, [nextScheduleEntry?.title, nextSlot?.name]);

  const currentSpeakerGuest = useMemo(() => {
    if (!currentScheduleEntry) return null;

    const currentClaimedUserId = String(currentScheduleEntry.claimedByUserId || "").trim();
    const currentClaimedName = String(currentScheduleEntry.claimedByName || "").trim().toLowerCase();

    return (
      guests.find((guest) => {
        const guestId = String(guest.id || "").trim();
        const guestName = String(guest.name || "").trim().toLowerCase();
        return (
          (!!currentClaimedUserId && guestId === currentClaimedUserId) ||
          (!!currentClaimedName && guestName === currentClaimedName)
        );
      }) || null
    );
  }, [currentScheduleEntry, guests]);

  const nextSpeakerGuest = useMemo(() => {
    if (!nextScheduleEntry) return null;

    const nextClaimedUserId = String(nextScheduleEntry.claimedByUserId || "").trim();
    const nextClaimedName = String(nextScheduleEntry.claimedByName || "").trim().toLowerCase();

    return (
      guests.find((guest) => {
        const guestId = String(guest.id || "").trim();
        const guestName = String(guest.name || "").trim().toLowerCase();
        return (
          (!!nextClaimedUserId && guestId === nextClaimedUserId) ||
          (!!nextClaimedName && guestName === nextClaimedName)
        );
      }) || null
    );
  }, [nextScheduleEntry, guests]);

  const hostControlLiveSpeaker = useMemo(() => {
    const slot = currentMainStageSlot;
    if (!slot) return null;
    return {
      name: String(slot?.claimedByName || slot?.name || ""),
      avatar: String(resolveParticipantAvatarUri(slot) || slot?.avatar || ""),
      topic: String(slot?.title || slot?.task || slot?.slotLabel || slot?.name || ""),
      slot: Number(slot?.slot || 0),
      countdown: String(liveCountdownLabel || "Waiting"),
    };
  }, [currentMainStageSlot, liveCountdownLabel]);

  const hostControlNextSpeaker = useMemo(() => {
    const next = hostDrawerNextSlot;
    if (!next) return null;
    const startMs = Number((next as any)?.startMs || 0);
    return {
      name: String((next as any)?.name || ""),
      avatar: String((next as any)?.avatar || resolveParticipantAvatarUri(next) || ""),
      topic: String((next as any)?.title || (next as any)?.task || (next as any)?.slotLabel || (next as any)?.name || ""),
      slot: Number((next as any)?.slot || 0),
      startTime: startMs
        ? new Date(startMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "—",
      status: startMs > liveNowMs ? "WAITING" : "READY",
    };
  }, [hostDrawerNextSlot, liveNowMs]);

  const claimedMemberPanelInfo = useMemo(() => {
    if (!myClaimedStageSlot) return null;
    const slot = myClaimedStageSlot as any;
    const slotNum = Number(slot?.slot || 0);
    const startMs = Number(slot?.startMs || 0);
    const endMs = Number(slot?.endMs || 0);
    const currentSlotNum = Number(currentMainStageSlot?.slot || 0);
    const isLiveNow =
      slotNum > 0 &&
      slotNum === currentSlotNum &&
      !!currentMainStageSlot &&
      isScheduleSlotCameraWindowOpen(
        { claimedByUserId: currentUserId, startMs, endMs },
        currentUserId,
        liveNowMs
      );
    const isWaiting = startMs > liveNowMs;
    const isReady =
      !isLiveNow && startMs <= liveNowMs && (!endMs || endMs > liveNowMs);

    let status = "WAITING";
    if (isLiveNow) status = "LIVE NOW";
    else if (isReady) status = "READY";

    let countdown = "—";
    if (isLiveNow) {
      countdown = String(liveCountdownLabel || "Waiting");
    } else if (isWaiting && startMs) {
      const left = Math.max(0, startMs - liveNowMs);
      const mins = Math.floor(left / 60000);
      const secs = Math.floor((left % 60000) / 1000);
      countdown = `STARTS IN ${mins}:${String(secs).padStart(2, "0")}`;
    } else if (isReady) {
      countdown = "You're up next";
    }

    return {
      slot: slotNum,
      name: String(slot?.claimedByName || slot?.name || liveProfileName || "Member"),
      avatar: String(resolveParticipantAvatarUri(slot) || slot?.avatar || slot?.claimedByAvatar || liveProfileAvatarUri || ""),
      topic: String(slot?.title || slot?.task || slot?.slotLabel || slot?.name || `Slot ${slotNum}`),
      timeLabel: startMs
        ? new Date(startMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "—",
      status,
      statusColor: isLiveNow ? "#22C55E" : isWaiting ? "#FACC15" : "#38BDF8",
      countdown,
      isLiveNow,
    };
  }, [myClaimedStageSlot, currentMainStageSlot, liveCountdownLabel, liveNowMs, liveProfileName, liveProfileAvatarUri]);

  const audienceMicStatus = useMemo(() => {
    const isLiveNow = claimedMemberPanelInfo?.status === "LIVE NOW";
    const micReady = !!(canPublishClaimedMicNow || liveMicPublisherReady);
    const cameraAllowed = cameraPublishAllowedNow;
    const slotStartsLater =
      !!myClaimedStageSlot && Number((myClaimedStageSlot as any)?.startMs || 0) > liveNowMs;

    if (isLiveNow) {
      return {
        micLabel: micReady ? "You are live now — mic ready" : "You are live now",
        cameraLabel: cameraAllowed ? "Camera open for your slot" : "Camera opens when your slot is live",
      };
    }

    return {
      micLabel: micReady ? "Mic ready" : "Mic unlocks when your slot is live",
      cameraLabel: cameraAllowed
        ? "Camera allowed for your active slot"
        : slotStartsLater
          ? "Your camera opens when your slot starts"
          : "Camera opens when your slot is live",
    };
  }, [
    claimedMemberPanelInfo?.status,
    canPublishClaimedMicNow,
    liveMicPublisherReady,
    cameraPublishAllowedNow,
    myClaimedStageSlot,
    liveNowMs,
  ]);

  const hostControlClaimedSpeakers = useMemo(() => {
    return scheduledStagePeople.map((person: any) => {
      const slotNum = Number(person?.slot || 0);
      const startMs = Number(person?.startMs || 0);
      const endMs = Number(person?.endMs || 0);
      const isLiveNow = isScheduleSlotActiveNow(person, liveNowMs);
      const isWaiting = isScheduleSlotUpcoming(person, liveNowMs);
      const isReady = !isLiveNow && !isWaiting && !isScheduleSlotExpired(person, liveNowMs);
      return {
        id: String(person?.id || `claimed-${slotNum}`),
        slot: slotNum,
        claimedByUserId: String(person?.claimedByUserId || person?.userId || "").trim(),
        name: String(person?.name || person?.claimedByName || `Speaker ${slotNum}`),
        avatar: String(person?.avatar || resolveParticipantAvatarUri(person) || ""),
        topic: String(person?.title || person?.task || person?.slotLabel || person?.name || "Speaking slot"),
        status: isLiveNow ? "LIVE NOW" : isWaiting ? "WAITING" : isReady ? "READY" : "WAITING",
        statusColor: isLiveNow ? "#22C55E" : isWaiting ? "#FACC15" : "#38BDF8",
      };
    });
  }, [scheduledStagePeople, currentMainStageSlot?.slot, liveNowMs]);

  const {
    claimedSlotCount,
    claimedUserCount,
    claimedUsers,
    claimedSpeakerSlotLabelById,
  } = useMemo(() => {
    const speakers = hostControlClaimedSpeakers;
    const slotCount = speakers.length;
    const slotsByUserKey = new Map<string, number[]>();

    const userKeyFor = (speaker: any) => {
      const userId = String(speaker?.claimedByUserId || speaker?.userId || "").trim();
      if (userId) return `uid:${userId}`;
      const name = String(speaker?.name || "").trim().toLowerCase();
      if (name) return `name:${name}`;
      return `id:${String(speaker?.id || speaker?.slot || "")}`;
    };

    speakers.forEach((speaker: any) => {
      const key = userKeyFor(speaker);
      const slots = slotsByUserKey.get(key) || [];
      const slotNum = Number(speaker?.slot || 0);
      if (slotNum > 0) slots.push(slotNum);
      slotsByUserKey.set(key, slots);
    });

    const slotLabelById: Record<string, string> = {};
    speakers.forEach((speaker: any) => {
      const key = userKeyFor(speaker);
      const slots = (slotsByUserKey.get(key) || []).filter(Boolean).sort((a, b) => a - b);
      slotLabelById[speaker.id] =
        slots.length > 1 ? `Slots ${slots.join(", ")}` : `Slot ${slots[0] || speaker.slot || "—"}`;
    });

    const seenUserKeys = new Set<string>();
    const users = speakers.filter((speaker: any) => {
      const key = userKeyFor(speaker);
      if (seenUserKeys.has(key)) return false;
      seenUserKeys.add(key);
      return true;
    }).map((speaker: any) => ({
      ...speaker,
      slotLabel: slotLabelById[speaker.id] || `Slot ${speaker.slot || "—"}`,
    }));

    return {
      claimedSlotCount: slotCount,
      claimedUserCount: users.length,
      claimedUsers: users,
      claimedSpeakerSlotLabelById: slotLabelById,
    };
  }, [hostControlClaimedSpeakers]);

  useEffect(() => {
    console.log("KRISTO_CLAIMED_SPEAKER_COUNTS", {
      claimedUserCount,
      claimedSlotCount,
    });
  }, [claimedUserCount, claimedSlotCount]);

  const hostControlHosts = useMemo(() => {
    const rows: Array<{ id: string; name: string; role: string; avatar: string }> = [];
    const seen = new Set<string>();
    const pastorId = String(actualChurchPastorUserId || "").trim();
    const hostIds = Array.isArray(mediaHostIds) ? mediaHostIds : [];

    const pushHost = (id: string, name: string, role: string, avatar = "") => {
      const uid = String(id || "").trim();
      if (!uid || seen.has(uid)) return;
      seen.add(uid);
      rows.push({ id: uid, name: String(name || role), role, avatar: String(avatar || "") });
    };

    if (pastorId) {
      const pastorPerson = scheduledStagePeople.find(
        (p: any) => String(p?.claimedByUserId || "").trim() === pastorId
      );
      pushHost(
        pastorId,
        String(pastorPerson?.name || (params as any)?.claimedByName || "Pastor"),
        "Pastor",
        String(pastorPerson?.avatar || resolveParticipantAvatarUri(pastorPerson) || liveProfileAvatarUri || "")
      );
    }

    hostIds.forEach((hostId: string) => {
      const id = String(hostId || "").trim();
      if (!id) return;
      const person = scheduledStagePeople.find((p: any) => String(p?.claimedByUserId || "").trim() === id);
      pushHost(id, String(person?.name || "Host"), "Host", String(person?.avatar || resolveParticipantAvatarUri(person) || ""));
    });

    scheduledStagePeople.forEach((p: any) => {
      const roleRaw = String(p?.role || p?.roleLabel || "").toLowerCase();
      const uid = String(p?.claimedByUserId || "").trim();
      if (!uid) return;
      if (roleRaw.includes("pastor")) {
        pushHost(uid, String(p?.name || "Pastor"), "Pastor", String(p?.avatar || resolveParticipantAvatarUri(p) || ""));
      } else if (roleRaw.includes("admin")) {
        pushHost(uid, String(p?.name || "Admin"), "Admin", String(p?.avatar || resolveParticipantAvatarUri(p) || ""));
      } else if (roleRaw.includes("host")) {
        pushHost(uid, String(p?.name || "Host"), "Host", String(p?.avatar || resolveParticipantAvatarUri(p) || ""));
      }
    });

    if (canManageLive && session?.userId) {
      pushHost(
        String(session.userId),
        String(liveProfileName || "Live Host"),
        isCoHostRole ? "Co-host" : "Host",
        String(liveProfileAvatarUri || "")
      );
    }

    return rows;
  }, [
    actualChurchPastorUserId,
    mediaHostIds,
    scheduledStagePeople,
    canManageLive,
    session?.userId,
    liveProfileName,
    liveProfileAvatarUri,
    isCoHostRole,
    params,
  ]);

  const hostControlViewerStats = useMemo(() => {
    const presenceRows = Object.values(liveViewerPresence || {}) as any[];
    const presenceCount = presenceRows.length;
    const totalViewers = Math.max(Number(live.viewerCount || 0), presenceCount);
    const activeViewers = presenceCount;

    const isLeaderRole = (role: string) => {
      const r = String(role || "").toLowerCase();
      return r.includes("pastor") || r.includes("admin") || r.includes("leader") || r.includes("host");
    };

    const leaders = presenceRows.filter((viewer: any) => {
      const roleText = `${String(viewer?.role || "")} ${String(viewer?.churchRole || "")}`.toLowerCase();
      return isLeaderRole(roleText);
    }).length;

    const members = presenceRows.filter((viewer: any) => {
      const roleText = `${String(viewer?.role || "")} ${String(viewer?.churchRole || "")}`.toLowerCase();
      if (isLeaderRole(roleText)) return false;
      return roleText.includes("member") || !!viewer?.churchId;
    }).length;

    const knownPresence = members + leaders;
    const guestsFromPresence = Math.max(0, presenceCount - knownPresence);
    const unknownTotalExtra = Math.max(0, totalViewers - presenceCount);
    const guests = guestsFromPresence + unknownTotalExtra;

    return {
      totalViewers,
      activeViewers,
      members,
      leaders,
      guests,
    };
  }, [liveViewerPresence, live.viewerCount]);

  const hostControlUpcomingQueue = useMemo(() => {
    return runtimeScheduleSlots
      .map((slot: any, index: number) => {
        const win = getScheduleSlotWindow(slot, index);
        const slotNum = Number(slot?.slot || slot?.slotNumber || index + 1);
        const startMs = Number(win.startMs || 0);
        if (slot?.skipped) return null;
        if (!startMs || startMs <= liveNowMs) return null;
        const claimed = !!String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
        return {
          slot: slotNum,
          startMs,
          timeLabel: new Date(startMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          claimed,
          status: claimed ? "claimed" : "open",
          name: String(
            slot?.claimedByName ||
              slot?.title ||
              slot?.task ||
              slot?.slotLabel ||
              slot?.name ||
              `Slot ${slotNum}`
          ),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => Number(a.startMs || 0) - Number(b.startMs || 0))
      .slice(0, 8);
  }, [runtimeScheduleSlots, liveNowMs]);

  useEffect(() => {
    if (!canSeeAudiencePanel) return;
    console.log("KRISTO_AUDIENCE_PANEL_DATA", {
      isClaimedMember: !!myClaimedStageSlot,
      myClaimedSlot: Number((myClaimedStageSlot as any)?.slot || 0),
      claimedSpeakersCount: claimedSlotCount,
      claimedUsersCount: claimedUserCount,
      viewersTotal: hostControlViewerStats.totalViewers,
      queueCount: hostControlUpcomingQueue.length,
    });
  }, [
    canSeeAudiencePanel,
    myClaimedStageSlot,
    hostControlClaimedSpeakers.length,
    claimedSlotCount,
    claimedUserCount,
    hostControlViewerStats.totalViewers,
    hostControlUpcomingQueue.length,
  ]);

  const pinnedGuestOnStage = !!pinnedGuest?.id && stageGuestIds.includes(pinnedGuest.id);
  const pinnedGuestAuthorityMuted =
    !!pinnedGuest?.id && !!authorityMutedIds[pinnedGuest.id];

  function isGuestOnStage(guestId?: string | null) {
    const id = String(guestId || "").trim();
    if (!id) return false;
    return stageGuestIds.includes(id);
  }

  function isGuestMutedByAuthority(guestId?: string | null) {
    const id = String(guestId || "").trim();
    if (!id) return false;
    return !!authorityMutedIds[id];
  }

  function isCurrentSpeakerGuest(guestId?: string | null) {
    const id = String(guestId || "").trim();
    return !!id && !!currentSpeakerGuest?.id && id === String(currentSpeakerGuest.id);
  }

  function isNextSpeakerGuest(guestId?: string | null) {
    const id = String(guestId || "").trim();
    return !!id && !!nextSpeakerGuest?.id && id === String(nextSpeakerGuest.id);
  }

  function getGuestTileToneStyle(guestId?: string | null) {
    const id = String(guestId || "").trim();
    if (!id) return null;

    if (isCurrentSpeakerGuest(id)) {
      return s.liveTileToneCurrent;
    }

    if (isNextSpeakerGuest(id)) {
      return s.liveTileToneNext;
    }

    if (isGuestMutedByAuthority(id)) {
      return s.liveTileToneMuted;
    }

    if (isGuestOnStage(id)) {
      return s.liveTileToneOnStage;
    }

    return null;
  }

  useEffect(() => {
    if (!canManageLive) return;
    if (!currentSpeakerGuest?.id) return;

    setStageGuestIds((prev) => {
      const currentId = String(currentSpeakerGuest.id);
      return prev.length === 1 && prev[0] === currentId ? prev : [currentId];
    });
    setPinnedGuestId((prev) => {
      const currentId = String(currentSpeakerGuest.id);
      return prev === currentId ? prev : currentId;
    });
    setAuthorityMutedIds((prev) => {
      if (!prev[currentSpeakerGuest.id]) return prev;
      const next = { ...prev };
      delete next[currentSpeakerGuest.id];
      return next;
    });
  }, [canManageLive, currentSpeakerGuest?.id]);

  function bringPinnedGuestOnStage() {
    if (!pinnedGuest?.id) return;

    setStageGuestIds([pinnedGuest.id]);
    setAuthorityMutedIds((prev) => {
      if (!prev[pinnedGuest.id]) return prev;
      const next = { ...prev };
      delete next[pinnedGuest.id];
      return next;
    });

    Alert.alert("On stage", `${pinnedGuest.name} ameletwa stage.`);
  }

  function mutePinnedGuestByAuthority() {
    if (!pinnedGuest?.id) return;
    if (!stageGuestIds.includes(pinnedGuest.id)) {
      Alert.alert("Not on stage", `${pinnedGuest.name} bado hayuko stage.`);
      return;
    }

    setAuthorityMutedIds((prev) => ({
      ...prev,
      [pinnedGuest.id]: !prev[pinnedGuest.id],
    }));
  }

  function removePinnedGuestFromStageByAuthority() {
    if (!pinnedGuest?.id) return;

    setStageGuestIds((prev) => prev.filter((id) => id !== pinnedGuest.id));
    setAuthorityMutedIds((prev) => {
      const next = { ...prev };
      delete next[pinnedGuest.id];
      return next;
    });

    Alert.alert("Removed", `${pinnedGuest.name} ameondolewa stage.`);
  }

  function extendCurrentSlotByTwoMin() {
    setSlotExtendMs((prev) => prev + 2 * 60 * 1000);
    Alert.alert("Slot extended", "Current slot imeongezwa dakika 2.");
  }

  function handoverToNextSpeaker() {
    if (!nextSpeakerLabel) {
      Alert.alert("No next speaker", "Hakuna next speaker wa ku-handover sasa.");
      return;
    }

    if (!nextSpeakerGuest?.id) {
      Alert.alert("Next speaker", `${nextSpeakerLabel} yuko next lakini bado hajapandishwa kwenye guest stage list.`);
      return;
    }

    setPinnedGuestId(nextSpeakerGuest.id);
    setStageGuestIds([nextSpeakerGuest.id]);
    setAuthorityMutedIds((prev) => {
      if (!prev[nextSpeakerGuest.id]) return prev;
      const next = { ...prev };
      delete next[nextSpeakerGuest.id];
      return next;
    });

    Alert.alert("Handover done", `${nextSpeakerGuest.name} amewekwa tayari kwa next speaker handover.`);
  }

  function toggleCameraFacing() {
    setCameraFacing((fromFacing) => {
      const toFacing = fromFacing === "front" ? "back" : "front";
      const flipState = (globalThis as any).__KRISTO_LIVE_CAMERA_FLIP_STATE__ || {};
      console.log("KRISTO_LIVE_CAMERA_FLIP_REQUEST", {
        fromFacing,
        toFacing,
        hasLocalTrack: !!flipState.hasLocalTrack,
        isPublishing: !!flipState.isPublishing || !!cameraPublishAllowedNow,
      });
      return toFacing;
    });
  }

  const [actualMicEnabledForUi, setActualMicEnabledForUi] = useState<boolean | null>(null);

  useEffect(() => {
    return subscribeKristoActualMicEnabled((enabled) => {
      setActualMicEnabledForUi(enabled);
    });
  }, []);

  // Button must follow REAL LiveKit mic when available.
  // If actual state is not known yet, show muted instead of falsely showing open.
  const micUiMuted = live.micMuted;

  const micPersistKey = `kristo-live-mic-muted:${String(liveBridgeId || livePresenceKey || "live")}:${String(session?.userId || "user")}`;
  // Do not auto-restore old mic mute state.
  // Old persisted value was flipping the real LiveKit mic after publish.

  function toggleMicMuted() {
    const nextMuted = !live.micMuted;

    AsyncStorage.setItem(micPersistKey, nextMuted ? "1" : "0").catch(() => {});
    publishKristoActualMicEnabled(!nextMuted);

    try {
      const setRealMic = (globalThis as any).__KRISTO_SET_LOCAL_MIC_MUTED__;
      if (typeof setRealMic === "function") {
        setRealMic(nextMuted);
      }
    } catch {}

    toggleMic();
  }

  async function ensureCameraAccess() {
    if (cameraPermission?.granted) return true;
    const res = await requestCameraPermission();
    return !!res?.granted;
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        logLivePerf("camera_permission_start", {
          alreadyGranted: !!cameraPermission?.granted,
        });
        const camOk = cameraPermission?.granted
          ? true
          : !!(await requestCameraPermission())?.granted;
        logLivePerf("camera_permission_end", { granted: camOk });

        logLivePerf("mic_permission_start", {
          alreadyGranted: !!micPermission?.granted,
        });
        const micOk = micPermission?.granted
          ? true
          : !!(await requestMicPermission())?.granted;
        logLivePerf("mic_permission_end", { granted: micOk });

        if (alive) {
          setCameraPaused(false);
          setLivePerfPermissionsDone(true);
          if (!camOk) {
            console.log("live-room camera permission not granted");
          }
          if (!micOk) {
            console.log("live-room mic permission not granted");
          }
        }
      } catch (e) {
        setLivePerfPermissionsDone(true);
        console.log("live-room permission error", e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [cameraPermission?.granted, micPermission?.granted]);

  useEffect(() => {
    if (livePerfInteractLoggedRef.current) return;
    if (!livePerfPermissionsDone) return;
    if (!liveEnabled && !isMediaInstantLive) return;

    livePerfInteractLoggedRef.current = true;
    logLivePerf("user_can_interact", {
      liveEnabled,
      canEnterRoom,
      liveScheduleReady,
      isMediaInstantLive,
      cameraGranted: !!cameraPermission?.granted,
      micGranted: !!micPermission?.granted,
    });
  }, [
    livePerfPermissionsDone,
    liveEnabled,
    canEnterRoom,
    liveScheduleReady,
    isMediaInstantLive,
    cameraPermission?.granted,
    micPermission?.granted,
  ]);

  useEffect(() => {
    if (!liveEnabled) return;

    const role = canManageLive ? "host" : "viewer";
    joinLiveRoomSession(livePresenceKey, role);

    return () => {
      leaveLiveRoomSession(livePresenceKey);
    };
  }, [canManageLive, livePresenceKey, liveEnabled]);

  function togglePaused() {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("pause");
      return;
    }
    if (!liveEnabled) {
      Alert.alert("Ready room", "This ready room opens before official live starts.");
      return;
    }
    togglePause();
  }


  function refreshLiveStateAfterLeave() {
    const userId = String(session?.userId || "").trim();
    const roomName = String(liveBridgeId || "").trim();

    clearLiveRoomSessionPin("leave-live-room");
    clearLiveKitPublisherStagePin("leave-live-room");
    clearClaimEnterSessionLock("leave-live-room");
    liveKitPublisherStageStickyRef.current = false;
    prevShouldMountLiveKitRef.current = null;
    setLiveKitHostLocked(false);

    forceKristoLiveCleanup("leave-live-room", {
      userId,
      roomName,
      forceReentry: true,
    });

    resumeHomeFeedAfterLiveExit();
    markHomeFeedVideoNeedsRecovery("live-room-exit");

    emitLiveRingRefresh("leave-live-room");
    void runMediaScheduleSilentReload("leave-live-room", true, {
      churchId: String((session as any)?.churchId || (params as any)?.churchId || ""),
      userId,
      role: String((session as any)?.role || "Member"),
    });
  }

  function quitLiveRoom() {
    setCameraPaused(true);
    refreshLiveStateAfterLeave();
    logLiveRoomNavAway({
      reason: "leave-live-room",
      caller: "quitLiveRoom",
      target: "/(tabs)/more",
      liveBridgeId,
    });
    router.replace("/(tabs)/more" as any);
  }

  function navigateToLiveSlotsForClaim(slot?: any) {
    setCameraPaused(true);
    refreshLiveStateAfterLeave();
    resumeHomeFeedAfterLiveExit();

    const churchId = String(
      (params as any)?.churchId ||
        liveRouteChurchId ||
        (session as any)?.churchId ||
        ""
    ).trim();
    const scheduleFeedId = String(
      liveScheduleFeedId ||
        slot?.feedId ||
        slot?.sourceScheduleId ||
        slot?.parentScheduleId ||
        (params as any)?.feedId ||
        (params as any)?.sourceScheduleId ||
        (params as any)?.liveId ||
        ""
    ).trim();
    const slotId = String(slot?.id || slot?.slotId || "").trim();
    const slotNumber = Math.max(0, Number(slot?.slot || slot?.slotNumber || 0));

    console.log("KRISTO_LIVE_ROOM_GO_CLAIM_NAV", {
      target: "/more/live-slots",
      focusScheduleFeedId: scheduleFeedId || null,
      churchId: churchId || null,
      focusSlotId: slotId || null,
      focusSlotNumber: slotNumber || null,
      source: "live-room-go-claim",
    });

    router.replace({
      pathname: "/more/live-slots",
      params: {
        source: "live-room-go-claim",
        ...(scheduleFeedId ? { focusScheduleFeedId: scheduleFeedId } : {}),
        ...(churchId ? { churchId } : {}),
        ...(slotId ? { focusSlotId: slotId } : {}),
        ...(slotNumber > 0 ? { focusSlotNumber: String(slotNumber) } : {}),
      },
    } as any);
  }

  async function endLiveNow() {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("end-live");
      return;
    }
    await pushLiveAction("end-live");
    endLive();
    publishLiveEnded(liveBridgeId);
    router.replace("/(tabs)" as any);
  }


  function openLayoutPicker() {
    if (!liveEnabled) {
      Alert.alert("Ready room", "You can prepare here before official live starts.");
      return;
    }

    router.push({
      pathname: "/(tabs)/more/my-church-room/messages/live-layout-picker" as any,
      params: {
        title,
        role: String(params.role || ""),
        layout: layoutMode,
        pinnedGuestId,
        projectId,
        assignmentId: selectedAssignment?.id || "",
      },
    });
  }


  function cyclePinnedGuest() {
    const idx = guests.findIndex((x) => x.id === pinnedGuestId);
    const next = guests[(idx + 1) % guests.length];
    if (next) setPinnedGuestId(next.id);
  }

  function toggleGuestMic() {
    if (!canManageLive) {
      Alert.alert("Live", "Hii control ni ya host/co-host tu.");
      return;
    }
    setGuestMicMuted((v: boolean) => !v);
  }

  function removePinnedGuest() {
    if (!canManageLive) {
      Alert.alert("Live", "Hii control ni ya host/co-host tu.");
      return;
    }
    Alert.alert("", `${pinnedGuest.name} removed from live.`);
  }

  function openMoreMenu() {
    setMoreOpen(true);
  }

  function closeMoreMenu() {
    setMoreOpen(false);
  }

  function handleGuestsPress() {
    closeMoreMenu();
    Alert.alert("Guests", `${guests.length} guests ready in studio.`);
  }

  function handleHostRequestsPress() {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("view-requests");
      return;
    }
    closeMoreMenu();

    const pending = Object.entries(joinRequestsBySlot || {}).find(([, req]: any) => !!req && !req.approved);
    if (!pending) {
      Alert.alert("Requests", "No pending access requests right now.");
      return;
    }

    const [slotKey, req] = pending as any;
    const slot = Number(slotKey);
    const requestName = String(req?.name || "Guest");
    const requestRole = String(req?.role || "Viewer");

    Alert.alert(
      "Access request",
      `${requestName} • ${requestRole}
${scheduleAudienceAccessText}`,
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Approve",
          onPress: () => {
            if (!canManageLive) return;
            const approvedReq = {
              ...req,
              name: requestName,
              avatar: req?.avatar || requestName.slice(0, 1).toUpperCase() || "G",
              approved: true,
              joinedAt: new Date().toISOString(),
            };

            setJoinRequestsBySlot((prev) => ({
              ...prev,
              [slot]: approvedReq,
            }));

            publishLiveJoin(liveBridgeId, slot, approvedReq);
            Alert.alert("Approved", `${requestName} can now enter the live.`);
          },
        },
      ]
    );
  }

  function handleSharePress() {
    closeMoreMenu();

    if (!liveEnabled) {
      Alert.alert("Ready room", audienceGateMessage || "Members are preparing. They cannot see each other yet.");
      return;
    }

    Alert.alert("Share live", `${title} is ready to share.`);
  }

  function handleLeaveLive() {
    closeMoreMenu();
    setCameraPaused(true);
    refreshLiveStateAfterLeave();
    logLiveRoomNavAway({
      reason: "leave-live-room",
      caller: "handleLeaveLive",
      target: "/(tabs)/more",
      liveBridgeId,
    });
    router.replace("/(tabs)/more" as any);
  }

  // Do not block the entire live room shell while expo-camera permission hook initializes.
  const canUseLiveControlsNow = canManageLive || isMyScheduledLiveTurn;
  const hasCameraAccess =
    cameraPublishAllowedNow &&
    (!!cameraPermission?.granted || isMediaInstantLive);
  // ONLY real approved stage users can open publish camera.
  // viewers entering through ?entryMode=live must stay subscriber-only.
  const canShowCamera =
    cameraPublishAllowedNow ||
    (isMediaInstantLive && normalizedRole.includes("media-slot"));

  const liveTone =
    liveStillActive
      ? "live"
      : canEnterWaitingRoom
        ? "waiting"
        : canEnterBackstage
          ? "ready"
          : audienceOpen
            ? "open"
            : backstageOpen
              ? "ready"
              : "closed";

  const livePillToneStyle =
    liveTone === "live" || liveTone === "open"
      ? ({
          backgroundColor: "rgba(6,10,30,0.92)",
          borderColor: "rgba(16,185,129,0.44)",
          shadowColor: "#10B981",
        } as ViewStyle)
      : liveTone === "ready"
        ? ({
            backgroundColor: "rgba(56,189,248,0.14)",
            borderColor: "rgba(56,189,248,0.34)",
          } as ViewStyle)
        : liveTone === "waiting"
          ? ({
              backgroundColor: "rgba(217,179,95,0.16)",
              borderColor: "rgba(217,179,95,0.36)",
            } as ViewStyle)
          : ({
              backgroundColor: "rgba(129,25,52,0.18)",
              borderColor: "rgba(255,65,108,0.48)",
            } as ViewStyle);

  const liveDotToneStyle =
    liveTone === "live" || liveTone === "open"
      ? ({ backgroundColor: "#10B981", shadowColor: "#10B981" } as ViewStyle)
      : liveTone === "ready"
        ? ({ backgroundColor: "#38BDF8", shadowColor: "#38BDF8" } as ViewStyle)
        : liveTone === "waiting"
          ? ({ backgroundColor: "#D9B35F", shadowColor: "#D9B35F" } as ViewStyle)
          : ({ backgroundColor: "#FF4B6E", shadowColor: "#FF4B6E" } as ViewStyle);

  function applyLiveRequestPolicy(nextPolicy: LiveRequestPolicy) {
    if (!canManageLiveHostActions) {
      logLiveHostActionBlocked("lock-room");
      return;
    }
    if (!canManageLive) return;
    setRequestPolicy(nextPolicy);
    publishLivePolicy(liveBridgeId, nextPolicy);
    pushLiveAction("set-policy", { requestPolicy: nextPolicy, policy: nextPolicy });
  }

  // V1: no pending access requests.
  const pendingAccessRequests: any[] = [];

  const latestPendingAccessRequest = pendingAccessRequests[0] || null;

  const pendingRequestFullName = String(latestPendingAccessRequest?.req?.name || "Guest").trim();
  const pendingRequestFirstName = pendingRequestFullName.split(/\s+/)[0] || "Guest";
  const pendingRequestRole = String(latestPendingAccessRequest?.req?.role || "").toLowerCase();
  const pendingRequestRoleIcon =
    pendingRequestRole.includes("pastor") || pendingRequestRole.includes("admin") || pendingRequestRole.includes("host")
      ? "shield-checkmark-outline"
      : pendingRequestRole.includes("leader")
        ? "ribbon-outline"
        : pendingRequestRole.includes("member")
          ? "person-circle-outline"
          : "person-outline";

  function handleRequestWaitingApproval(slot: number) {
    return;
  }

  function handleAutoJoinToStage(slot: number) {
    return;
  }

  const bottomSpacer = <View style={{ height: 96 }} />;
  const rootPanHandlers = hostDrawerPanResponder.panHandlers;

  const realFeelViewerCount = Number(live.viewerCount || 0);

  // V1: request-to-join flow removed. Only claimed slot users appear.
  const orderedJoinRequests: any[] = [];

  const activeJoinToast =
    orderedJoinRequests.find((req: any) => req.slot === activeJoinToastSlot) ||
    orderedJoinRequests[0] ||
    null;

  const latestJoinRequest = activeJoinToast;

  const otherJoinRequestCount = Math.max(
    0,
    orderedJoinRequests.filter((req: any) => !!req?.name && !req?.approved).length - 1
  );

  const latestJoinRequestKey = latestJoinRequest
    ? `${latestJoinRequest.slot}-${latestJoinRequest.joinedAt || ""}-${latestJoinRequest.approved ? "approved" : "pending"}`
    : "none";

return (
    <SafeAreaView style={s.safe as ViewStyle} edges={layoutMode === "focus" || layoutMode === "grid6" || layoutMode === "audience20" ? [] : ["top", "bottom"]} {...rootPanHandlers}>

        {layoutMode === "focus" ? (
          <View style={[s.vipSoloRoot as any, { paddingTop: Math.max(insets.top + 14, 28) }]}>
            <View style={s.vipSoloAuraOne as any} />
            <View style={s.vipSoloAuraTwo as any} />

            <View style={s.vipSoloMediaHeader as any}>
              <Pressable
                onPress={() => {
                  if (router.canGoBack?.()) router.back();
                  else router.replace("/(tabs)/more" as any);
                }}
                style={s.vipSoloProfileBackBtn as any}
              >
                <Ionicons name="chevron-back" size={30} color="#F8FAFF" />
              </Pressable>

              <View style={s.vipSoloMediaAvatar as any}>
                <Text style={s.vipSoloMediaAvatarText as any}>T</Text>
              </View>
              <View style={s.vipSoloMediaTextWrap as any}>
                <Text style={s.vipSoloMediaName as any}>TLMC Media</Text>
                <Text style={s.vipSoloMediaSub as any}>Church Media • Live ministry</Text>
              </View>
              <View style={s.vipSoloMediaBadge as any}>
                <Ionicons name="radio-outline" size={26} color="#F4D06F" />
              </View>
            </View>

            <View style={[s.vipSoloHero as any, requestListOpen ? s.vipSoloHeroCompact as any : s.vipSoloHeroExpanded as any]}>
              <View style={s.vipSoloHeroGlow as any} />
              {((isMediaInstantLive && roleLooksLikeHost) ||
                cameraPublishAllowedNow ||
                canPublishClaimedMicNow ||
                routeActiveSlotSpeakerMount ||
                keepPublisherLiveKitStage) &&
              canShowCamera ? (
                <>
                  <KristoLiveKitStage
                    key={liveKitPublisherStageKey}
                    roomName={liveBridgeId}
                    headers={liveKitApiHeaders}
                    canPublish={keepPublisherLiveKitStage}
                    canPublishMicOverride={liveKitMicOverrideReady}
                    canPublishCameraOverride={liveKitCameraOverrideReady}
                    renderLocalPreview={cameraPublishAllowedNow}
                    preferredIdentityPrefix={liveKitPublisherIdentity}
                    identity={liveKitPublisherIdentity}
                    cameraFacing={cameraFacing}
                    micMuted={cameraPublishAllowedNow ? false : live.micMuted}
                    cameraPaused={cameraPaused}
                    style={s.vipSoloCamera as any}
                    fallback={
                      <View style={s.vipSoloFallback as any}>
                        <View style={s.vipSoloAvatar as any}>
                          <Text style={s.vipSoloAvatarText as any}>K</Text>
                        </View>
                        <Text style={s.vipSoloFallbackTitle as any}>Connecting camera...</Text>
                        <Text style={s.vipSoloFallbackSub as any}>Preparing host video</Text>
                      </View>
                    }
                  />
                  <View pointerEvents="none" style={s.vipSoloCameraWarmOverlay as any} />
                  <View pointerEvents="none" style={s.vipSoloCameraVignette as any} />
                </>
              ) : isMediaInstantLive ? (
                <>
                  <KristoLiveKitStage
                    key={`${liveKitStageSessionKey}|e${liveKitAccountEpoch}`}
                    roomName={liveBridgeId}
                    headers={liveKitViewerApiHeaders}
                    canPublish={false}
                    renderLocalPreview={false}
                    preferredIdentityPrefix={`${String(actualChurchPastorUserId || params.pastorUserId || "")}-slot-1`}
                    identity={`${String(session?.userId || "viewer")}-viewer`}
                    cameraFacing={"front"}
                    micMuted={false}
                    cameraPaused={true}
                    style={s.vipSoloCamera as any}
                    fallback={
                      <View style={s.vipSoloFallback as any}>
                        <View style={s.vipSoloAvatar as any}>
                          <Text style={s.vipSoloAvatarText as any}>K</Text>
                        </View>
                        <Text style={s.vipSoloFallbackTitle as any}>Pastor is LIVE</Text>
                        <Text style={s.vipSoloFallbackSub as any}>Connecting video...</Text>
                      </View>
                    }
                  />
                  <View pointerEvents="none" style={s.vipSoloCameraWarmOverlay as any} />
                  <View pointerEvents="none" style={s.vipSoloCameraVignette as any} />
                </>
              ) : (
                <View style={s.vipSoloFallback as any}>
                  <View style={s.vipSoloAvatar as any}>
                    <Text style={s.vipSoloAvatarText as any}>K</Text>
                  </View>
                  <Text style={s.vipSoloFallbackTitle as any}>Host camera ready</Text>
                  <Text style={s.vipSoloFallbackSub as any}>Solo VIP stage is prepared</Text>
                </View>
              )}
            </View>

            <View pointerEvents="none" style={s.vipSoloBottomGlowPanel as any} />

            <View style={s.vipSoloBottomDock as any}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.vipSoloControlsScroll as any}
              >
                <Pressable style={[s.vipSoloControl as any, micUiMuted ? s.vipSoloControlOff as any : s.vipSoloControlOn as any]} onPress={() => toggleMicMuted()}>
                  <Ionicons name={micUiMuted ? "mic-off-outline" : "mic-outline"} size={23} color={micUiMuted ? "#AEB6C8" : "#F4D06F"} />
                  <Text style={[s.vipSoloControlText as any, micUiMuted ? null : s.vipSoloControlTextOn as any]}>{micUiMuted ? "Muted" : "Mic"}</Text>
                </Pressable>

                {cameraPublishAllowedNow ? (
                  <>
                    <Pressable style={[s.vipSoloControl as any, cameraPaused ? s.vipSoloControlOff as any : s.vipSoloControlOn as any]} onPress={() => setCameraPaused((v) => !v)}>
                      <Ionicons name={cameraPaused ? "videocam-off-outline" : "videocam-outline"} size={23} color={cameraPaused ? "#AEB6C8" : "#F4D06F"} />
                      <Text style={[s.vipSoloControlText as any, cameraPaused ? null : s.vipSoloControlTextOn as any]}>{cameraPaused ? "Off" : "Camera"}</Text>
                    </Pressable>

                    <Pressable style={s.vipSoloControl as any} onPress={() => toggleCameraFacing()}>
                      <Ionicons name="camera-reverse-outline" size={23} color="#FFFFFF" />
                      <Text style={s.vipSoloControlText as any}>Flip</Text>
                    </Pressable>
                  </>
                ) : null}

                <Pressable
                  style={[s.vipSoloControl as any, hostDrawerOpen ? s.vipSoloControlOn as any : null]}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    if (hostDrawerOpen) closeHostDrawer();
                    else openHostDrawer();
                  }}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={23}
                    color={hostDrawerOpen ? "#F4D06F" : "#FFFFFF"}
                  />
                  <Text
                    style={[
                      s.vipSoloControlText as any,
                      hostDrawerOpen ? s.vipSoloControlTextOn as any : null
                    ]}
                  >
                    {canManageLiveHostActions ? "Controls" : "Live Info"}
                  </Text>
                </Pressable>

                {canManageLiveHostActions ? (
                  <Pressable style={s.vipSoloControl as any} onPress={() => setLayoutStudioOpen(true)}>
                    <Ionicons name="albums-outline" size={23} color="#FFFFFF" />
                    <Text style={s.vipSoloControlText as any}>Layout</Text>
                  </Pressable>
                ) : null}

                <Pressable style={s.vipSoloControl as any} onPress={() => Haptics.selectionAsync().catch(() => {})}>
                  <Ionicons name="share-social-outline" size={23} color="#FFFFFF" />
                  <Text style={s.vipSoloControlText as any}>Share</Text>
                </Pressable>

                {canManageLiveHostActions ? (
                  <Pressable style={[s.vipSoloControl as any, s.vipSoloEndControl as any]} onPress={endLiveNow}>
                    <Ionicons name="stop-circle-outline" size={22} color="#FFFFFF" />
                    <Text style={s.vipSoloControlText as any}>End</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </View>
          </View>
        ) : null}

        {layoutMode === "grid6" ? (
          <Image
            source={require("../../../../../assets/images/vugu-team-grid.png")}
            style={[s.vuguTeamGridImage as any, { top: insets.top - 18 }]}
            resizeMode="stretch"
          />
        ) : null}

        {layoutMode === "grid6" ? (
          <Pressable
            pointerEvents="box-none"
            style={s.teamGridLiveStage as ViewStyle}
            onPress={() => {
              const now = Date.now();
              if (now - lastStageTapAt < 320) {
                setStageSwapArmed(true);
                Haptics.selectionAsync().catch(() => {});
              }
              setLastStageTapAt(now);
            }}
          >
{showLiveKitStageShell ? (
              keepPublisherLiveKitStage ? (
                <KristoLiveKitStage
                  key={liveKitPublisherStageKey}
                  roomName={liveBridgeId}
                  headers={liveKitApiHeaders}
                  canPublish={keepPublisherLiveKitStage}
                  canPublishMicOverride={liveKitMicOverrideReady}
                  canPublishCameraOverride={liveKitCameraOverrideReady}
                  renderLocalPreview={cameraPublishAllowedNow}
                  preferredIdentityPrefix={
                    isMediaInstantLive
                      ? ""
                      : `slot:${Number(stablePublisherSlotNumber || (params as any)?.preferredSlotNumber || 0)}`
                  }
                  identity={liveKitPublisherIdentity}
                  cameraFacing={cameraFacing}
                  micMuted={cameraPublishAllowedNow ? false : live.micMuted}
                  cameraPaused={cameraPaused}
                  style={s.teamGridLiveCamera as any}
                  fallback={
                    <View style={s.teamGridLiveFallback as any}>
                      <View style={s.livePausedWrap as any}>
                        <Ionicons name="radio-outline" size={64} color="#F4C95D" />
                        <Text style={s.livePausedTitle as any}>{isMediaInstantLive ? "PASTOR IS LIVE" : currentMainStageSlot ? `${String((currentMainStageSlot as any)?.name || "SPEAKER").toUpperCase()} IS LIVE` : routeSlotsStillLive ? "LIVE SLOT ACTIVE" : "LIVE WINDOW ENDED"}</Text>
                        <Text style={s.livePausedSub as any}>{currentMainStageSlot || isMediaInstantLive || routeSlotsStillLive ? "Connecting video..." : "No active speaker right now"}</Text>
                      </View>
                    </View>
                  }
                />
              ) : (
                <KristoLiveKitStage
                  key={`${liveKitStageSessionKey}|e${liveKitAccountEpoch}`}
                  roomName={liveBridgeId}
                  headers={liveKitViewerApiHeaders}
                  canPublish={false}
                  preferredIdentityPrefix={
                    !isMediaInstantLive && currentMainStageSlot
                      ? `slot:${Number((currentMainStageSlot as any)?.slot || currentSlotNumber || 0)}`
                      : ""
                  }
                  identity={`${String(session?.userId || "viewer")}-viewer`}
                  cameraFacing={"front"}
                  micMuted={false}
                  cameraPaused={true}
                  style={s.teamGridLiveCamera as any}
                  fallback={
                    <View style={s.teamGridLiveFallback as any}>
                      <View style={s.livePausedWrap as any}>
                        <Ionicons name="radio-outline" size={64} color="#F4C95D" />
                        <Text style={s.livePausedTitle as any}>{isMediaInstantLive ? "PASTOR IS LIVE" : `${String((currentMainStageSlot as any)?.name || "SPEAKER").toUpperCase()} IS LIVE`}</Text>
                        <Text style={s.livePausedSub as any}>Waiting for pastor video...</Text>
                      </View>
                    </View>
                  }
                />
              )
            ) : (
              <View style={s.teamGridLiveFallback as any}>
                {(() => {
                  const req = bigStageGuestId.startsWith("request-slot-")
                    ? joinRequestsBySlot[Number(bigStageGuestId.replace("request-slot-", ""))]
                    : null;

                  const stageGuest = scheduledStagePeople.find((g: any) => String(g.id) === String(bigStageGuestId));
                  const anyGuest = guests.find((g) => String(g.id) === String(bigStageGuestId));
                  const guestName = String(req?.name || stageGuest?.name || anyGuest?.name || "Guest");
                  const guestAvatar = String(req?.avatar || (stageGuest as any)?.avatar || (anyGuest as any)?.avatar || "");

                  return (
                    <>
                      <View style={[s.bigStageProfileWrap as any, { borderColor: slotRingColor((currentMainStageSlot as any)?.slot) }]}>
                        {isImageAvatar(guestAvatar) ? (
                          <Image
                            source={{ uri: String(guestAvatar) }}
                            style={s.bigStageProfileImage as any}
                          />
                        ) : (
                          <Text style={[s.teamGridLiveFallbackText as any, { fontSize: 52 }]}>
                            {initials(String(guestName))}
                          </Text>
                        )}
                      </View>

                      <>
                      <Text style={s.bigStageCompactName as any}>
                        {String(guestName)
                          .split(" ")
                          .map((v: string) => v[0])
                          .join(".")
                          .slice(0, 4)}
                      </Text>

                      <View style={s.bigStageSlotPill as any}>
                        <Text style={s.bigStageSlotPillText as any}>
                          LIVE NOW • SLOT {
                            String(bigStageGuestId || "")
                              .replace("stage-", "")
                              .replace("request-slot-", "") || "1"
                          }
                        </Text>
                      </View>
                    </>
                    </>
                  );
                })()}
              </View>
            )}
          </Pressable>
        ) : null}

        {layoutMode === "grid6" ? (
          <View pointerEvents="box-none" style={s.mediaIdentityBadge as any}>
            <Pressable
              pointerEvents="auto"
              onPress={() => {
                if (router.canGoBack?.()) router.replace("/(tabs)/more" as any);
                else router.replace("/(tabs)/more" as any);
              }}
              style={({ pressed }) => ([s.mediaHeaderBackBtn, pressed ? s.mediaHeaderBackBtnPressed : null] as any)}
            >
              <Ionicons name="chevron-back" size={22} color="#F4C95D" />
            </Pressable>

            <View style={s.mediaIdentityCenter as any}>
              <Text style={s.mediaIdentityName as any} numberOfLines={1}>
                {liveHeaderDisplayTitle.toUpperCase()}
              </Text>
              <View style={s.mediaIdentitySubRow as any}>
                <View style={s.mediaLiveDot as any} />
                <Text style={s.mediaIdentitySub as any} numberOfLines={1}>
                  {liveHeaderSubLine.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={s.mediaIdentityAvatarWrap as any}>
              <Animated.View style={[
  s.mediaIdentityWaveOuter,
  {
    transform: [{
      scale: waveAnim.interpolate({
        inputRange: [0,1],
        outputRange: [1,1.5]
      })
    }],
    opacity: waveAnim.interpolate({
      inputRange: [0,1],
      outputRange: [0.7,0]
    })
  }
]} />
              <Animated.View style={[
  s.mediaIdentityWaveInner,
  {
    transform: [{
      scale: waveAnim.interpolate({
        inputRange: [0,1],
        outputRange: [1,1.3]
      })
    }],
    opacity: waveAnim.interpolate({
      inputRange: [0,1],
      outputRange: [0.8,0]
    })
  }
]} />
              <View style={s.mediaIdentityAvatar as any}>
                <Text style={s.mediaIdentityAvatarText as any}>
                  {initials(String((params as any).mediaName || (params as any).channelName || (params as any).creatorName || params.title || "Kristo Media"))}
                </Text>
              </View>
            </View>
          </View>
        ) : null}


        {layoutMode === "grid6" && latestJoinRequest && !latestJoinRequest.approved && showJoinToast ? (
          <Animated.View pointerEvents="box-none" style={s.joinRequestSlideCard as any}>
            <View style={s.joinRequestGlowDot as any} />
            <View style={s.joinRequestAvatar as any}>
              {isImageAvatar((latestJoinRequest as any).avatar) ? (
                <Image
                  source={{ uri: String((latestJoinRequest as any).avatar) }}
                  style={s.teamGridRequestAvatarImage as any}
                />
              ) : (
                <Text style={s.joinRequestAvatarText as any}>
                  {initials(String(latestJoinRequest.name || "Guest")).slice(0, 2)}
                </Text>
              )}
            </View>

            <View style={s.joinRequestCopy as any}>
              <View style={s.joinRequestTopLine as any}>
                <Ionicons name="person-add-outline" size={14} color="#F4C95D" />
                <Text style={s.joinRequestKicker as any}></Text>
              </View>
              <Text style={s.joinRequestTitle as any} numberOfLines={1}>
                {`${String(latestJoinRequest.name || "Guest").trim()}${otherJoinRequestCount > 0 ? ` + ${otherJoinRequestCount} other${otherJoinRequestCount === 1 ? "" : "s"}` : ""}`}
              </Text>
              <Text style={s.joinRequestSub as any} numberOfLines={1}>
                {String((latestJoinRequest as any).role || "").toLowerCase().includes("pastor")
                  ? "Pastor from another church"
                  : String((latestJoinRequest as any).role || "").toLowerCase().includes("member")
                    ? "Church member"
                    : "Guest visitor"}
              </Text>
            </View>

            {canManageLive && !latestJoinRequest.approved ? (
              <View pointerEvents="auto" style={s.joinRequestActions as any}>
                <Pressable
                  onPress={async () => {
                    if (!canManageLive) return;
                    const slot = Number(latestJoinRequest.slot || 6);
                    const approvedReq = {
                      ...(joinRequestsBySlot[slot] || latestJoinRequest),
                      approved: true,
                      onStage: true,
                      joinedAt: new Date().toISOString(),
                    } as any;

                    setJoinRequestsBySlot((prev) => ({
                      ...prev,
                      [slot]: approvedReq,
                    }));

                    publishLiveJoin(liveBridgeId, slot, approvedReq);

                    await false && pushLiveAction("v1-disabled-approve", {
                      slot,
                      userId: String(approvedReq.userId || latestJoinRequest.userId || ""),
                      onStage: true,
                      approved: true,
                    });

                    setBigStageGuestId(`request-slot-${slot}`);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  }}
                  style={s.joinRequestApproveBtn as any}
                >
                  <Ionicons name="checkmark" size={18} color="#06111F" />
                </Pressable>

                <Pressable
                  onPress={() => {
                    const slot = Number(latestJoinRequest.slot || 1);
                    setJoinRequestsBySlot((prev) => {
                      const next = { ...prev };
                      delete next[slot];
                      return next;
                    });
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  style={s.joinRequestDeclineBtn as any}
                >
                  <Ionicons name="close" size={18} color="#FFFFFF" />
                </Pressable>
              </View>
            ) : (
              <View style={s.joinRequestStatusPill as any}>
                <Ionicons name={latestJoinRequest.approved ? "checkmark-circle" : "sparkles-outline"} size={16} color="#F4C95D" />
              </View>
            )}
          </Animated.View>
        ) : null}

        {layoutMode === "grid6" ? (
          <View pointerEvents="box-none" style={s.upperBookRequestLayer as any}>
            {[0, 1, 2, 3].map((seatIndex) => {
              const guest = visibleQueueSlots[seatIndex] as any;
              const index = seatIndex;
              if (!guest) return null;

              const isMiniMuted = !!guest && !!miniVideoMutedById[String(guest.id)];

              return (
              <Pressable
                key={`upper-claimed-seat-${guest?.id || "empty"}-${index}`}
                onPress={() => {
                  if (!guest) return;
                  const id = String(guest.id);
                  setStageSwapArmed(false);
                  setProfileActionGuestId((prev) => (prev === id ? null : id));
                  Haptics.selectionAsync().catch(() => {});
                }}
                onLongPress={() => {
                  if (!guest) return;
                  const id = String(guest.id);
                  setMiniVideoMutedById((prev) => ({ ...prev, [id]: !prev[id] }));
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={({ pressed }) => ([
                  s.upperBookRequestScreen,
                  index % 2 === 0 ? s.upperBookRequestLeft : s.upperBookRequestRight,
                  index < 2 ? s.upperBookRequestTop : s.upperBookRequestBottom,
                  pressed ? s.upperBookRequestPressed : null,
                ] as any)}
              >
                <View style={s.upperBookRequestVideoPreview as any}>
                  {isMiniMuted ? (
                    <>
                      <Ionicons name="videocam-off-outline" size={23} color="#F4C95D" />
                      <Text style={s.upperBookRequestMutedText as any}>MUTED</Text>
                    </>
                  ) : guest && String(guest.id) === "host" && canManageLive && canShowCamera ? (
                    <>
                      <CameraView
                        key={`mini-host-camera-${cameraFacing}`}
                        style={s.upperBookRequestMiniCamera as any}
                        facing={cameraFacing}
                        mute={live.micMuted}
                        active={!cameraPaused}
                      />
                    </>
                  ) : (
                    <>
                      {guest && isImageAvatar((guest as any).avatar) ? (
                        <Image
                          source={{ uri: String((guest as any).avatar) }}
                          style={s.upperBookRequestProfileImage as any}
                        />
                      ) : (
                        <Text style={s.upperBookRequestInitial as any}>
                          {guest ? initials(guest.name) : ""}
                        </Text>
                      )}
                    </>
                  )}

                  <View
                    pointerEvents="none"
                    style={[
                      s.slotOrbitInnerRing as any,
                      { borderColor: slotRingColor((guest as any)?.slot || (index + 2)) },
                    ]}
                  />
                </View>
              </Pressable>
              );
            })}
          </View>
        ) : null}


        {layoutMode === "grid6" && canManageLive ? (
          <Animated.View
            pointerEvents={profileActionGuestId ? "auto" : "none"}
            style={[
              s.profileActionBoxesLayer,
              {
                opacity: profileActionAnim,
                transform: [
                  {
                    scale: profileActionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.46, 1],
                    }),
                  },
                  {
                    translateY: profileActionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [16, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {[
              { key: "down", icon: "arrow-down-circle-outline", label: "DOWN" },
              { key: "host", icon: "shield-checkmark-outline", label: "MOD" },
              { key: "mute", icon: "mic-off-outline", label: "MUTE" },
              { key: "swap", icon: "swap-horizontal-outline", label: "SWAP" },
              { key: "close", icon: "close-circle-outline", label: "CLOSE" },
            ].map((item) => (
              <Pressable
                key={`profile-action-${item.key}`}
                onPress={() => {
                  if (!canManageLive) return;
                  const selectedId = profileActionGuestId;

                  if (item.key === "down") {
                    if (selectedId?.startsWith("request-slot-")) {
                      const slotIndex = Number(selectedId.replace("request-slot-", ""));
                      setJoinRequestsBySlot((prev) => {
                        const next = { ...prev };
                        delete next[slotIndex];
                        return next;
                      });
                      setModeratorIds((prev) => ({ ...prev, [selectedId]: false }));
                      setMiniVideoMutedById((prev) => ({ ...prev, [selectedId]: true }));
                    } else if (selectedId && selectedId !== "host") {
                      if (isMediaInstantLive) {
                        setBigStageGuestId("host");
                        setPinnedGuestId("host");
                      }
                      setModeratorIds((prev) => ({ ...prev, [selectedId]: false }));
                      setMiniVideoMutedById((prev) => ({ ...prev, [selectedId]: true }));
                      setStageSwapArmed(false);
                    }
                    setProfileActionGuestId(null);
                  }

                  if (item.key === "host" && selectedId) {
                    setModeratorIds((prev) => ({ ...prev, [selectedId]: !prev[selectedId] }));
                    setStageSwapArmed(false);
                  }

                  if (item.key === "mute" && selectedId) {
                    setMiniVideoMutedById((prev) => ({ ...prev, [selectedId]: !prev[selectedId] }));
                  }

                  if (item.key === "swap" && selectedId) {
                    setBigStageGuestId(selectedId);
                    setPinnedGuestId(selectedId);
                    setStageSwapArmed(false);
                    setProfileActionGuestId(null);
                  }

                  if (item.key === "close") {
                    if (selectedId?.startsWith("request-slot-")) {
                      const slotIndex = Number(selectedId.replace("request-slot-", ""));

                      setJoinRequestsBySlot((prev) => {
                        const next = { ...prev };
                        delete next[slotIndex];
                        return next;
                      });

                      setStageGuestIds((prev) =>
                        prev.filter((id) => id !== selectedId)
                      );

                      if (bigStageGuestId === selectedId) {
                        setBigStageGuestId("host");
                        setPinnedGuestId("host");
                      }

                      setModeratorIds((prev) => {
                        const next = { ...prev };
                        delete next[selectedId];
                        return next;
                      });

                      setMiniVideoMutedById((prev) => {
                        const next = { ...prev };
                        delete next[selectedId];
                        return next;
                      });

                      pushLiveAction("drop-guest", {
                        slot: slotIndex,
                      });
                    }

                    setProfileActionGuestId(null);
                  }

                  Haptics.selectionAsync().catch(() => {});
                }}
                style={({ pressed }) => ([
                  s.profileActionBox,
                  item.key === "host" && profileActionGuestId && moderatorIds[profileActionGuestId] ? s.profileActionBoxActive : null,
                  pressed ? s.upperBookRequestPressed : null,
                ] as any)}
              >
                <Ionicons name={item.icon as any} size={17} color="#66D9FF" />
                <Text style={s.profileActionBoxText as any}>{item.label}</Text>
              </Pressable>
            ))}
          </Animated.View>
        ) : null}


        {layoutMode === "grid6" && canManageLive ? (
          <Animated.View
            pointerEvents={requestPolicyOpen ? "auto" : "none"}
            style={[
              s.requestPolicyBoxesLayer,
              {
                opacity: requestPolicyAnim,
                transform: [
                  {
                    scale: requestPolicyAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.42, 1],
                    }),
                  },
                  {
                    translateY: requestPolicyAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [18, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {[
              { key: "auto", icon: "flash-outline", label: "AUTO" },
              { key: "approval", icon: "checkmark-done-outline", label: "APPROVE" },
              { key: "invite", icon: "person-add-outline", label: "INVITE" },
              { key: "members", icon: "people-circle-outline", label: "MEMBER" },
              { key: "locked", icon: "lock-closed-outline", label: "LOCK" },
            ].map((item) => {
              const active = requestPolicy === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    if (!canManageLive) return;
                    const nextPolicy = item.key as typeof requestPolicy;
                    applyLiveRequestPolicy(nextPolicy);
                    Haptics.selectionAsync().catch(() => {});

                    if (nextPolicy === "auto") {
                      setJoinRequestsBySlot((prev) => {
                        const next = { ...prev };
                        Object.keys(next).forEach((k) => {
                          next[Number(k)] = { ...next[Number(k)], approved: true };
                        });
                        return next;
                      });
                    }

                    if (nextPolicy === "locked") {
                      setRequestPolicyOpen(false);
                    }

                    if (nextPolicy === "invite") {
                      setStageSwapArmed(true);
                    }
                  }}
                  style={({ pressed }) => ([
                    s.requestPolicyBox,
                    active ? s.requestPolicyBoxActive : null,
                    pressed ? s.upperBookRequestPressed : null,
                  ] as any)}
                >
                  <Ionicons name={item.icon as any} size={17} color={active ? "#07111F" : "#F4C95D"} />
                  <Text style={[s.requestPolicyBoxText as any, active ? s.requestPolicyBoxTextActive : null]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </Animated.View>
        ) : null}

        {false && layoutMode === "grid6" && canManageLive && requestListOpen ? (
          <View pointerEvents="box-none" style={s.joinRequestListLayer as any}>
            <View style={s.joinRequestListCard as any}>
              <View style={s.joinRequestListHeader as any}>
                <Text style={s.joinRequestListTitle as any}>Join Requests</Text>
                <Pressable onPress={() => setRequestListOpen(false)} style={s.joinRequestListClose as any}>
                  <Ionicons name="close" size={18} color="#F4C95D" />
                </Pressable>
              </View>

              {pendingAccessRequests.length ? pendingAccessRequests.slice(0, 5).map((item: any) => {
                const req = item.req || {};
                const name = String(req.name || "Guest").trim();
                const roleText = String(req.role || "").toLowerCase().includes("pastor")
                  ? "Pastor from another church"
                  : String(req.role || "").toLowerCase().includes("member")
                    ? "Church member"
                    : "Guest visitor";

                return (
                  <View key={`request-list-${item.slot}`} style={s.joinRequestListRow as any}>
                    <View style={s.joinRequestListAvatar as any}>
                      {req.avatar && String(req.avatar).includes("/") ? (
                        <Image source={{ uri: String(req.avatar) }} style={s.teamGridRequestAvatarImage as any} />
                      ) : (
                        <Text style={s.joinRequestListAvatarText as any}>{initials(name).slice(0, 2)}</Text>
                      )}
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.joinRequestListName as any} numberOfLines={1}>{name}</Text>
                      <Text style={s.joinRequestListRole as any} numberOfLines={1}>{roleText}</Text>
                    </View>

                    <Pressable onPress={() => handleAutoJoinToStage(item.slot)} style={s.joinRequestMiniAccept as any}>
                      <Ionicons name="checkmark" size={18} color="#08111F" />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setJoinRequestsBySlot((prev) => {
                          const next = { ...prev };
                          delete next[item.slot];
                          return next;
                        });
                        Haptics.selectionAsync().catch(() => {});
                      }}
                      style={s.joinRequestMiniDecline as any}
                    >
                      <Ionicons name="close" size={18} color="#FFFFFF" />
                    </Pressable>
                  </View>
                );
              }) : (
                <Text style={s.joinRequestListEmpty as any}>No pending requests</Text>
              )}
            </View>
          </View>
        ) : null}


        {layoutMode === "grid6" && canManageLive ? (
          <Pressable
            pointerEvents={hostDrawerOpen || requestListOpen || hostRequestCard ? "none" : "box-only"}
            onPress={() => {
              setRequestListOpen((v) => !v);
              Haptics.selectionAsync().catch(() => {});
            }}
            style={s.crossInvisibleTouch as any}
          />
        ) : null}

        {layoutMode === "grid6" && (canUseLiveControlsNow || canPublishClaimedMicNow) ? (
          <View pointerEvents="box-none" style={s.teamGridTableControlsLayer as any}>
            {(canManageLive
              ? [
                  { icon: live.micMuted ? "mic-off-outline" : "mic-outline", color: "#F8D978", label: "Mic", action: "mic" },
                  { icon: cameraPublishAllowedNow ? "camera-reverse-outline" : "repeat-outline", color: "#63D1FF", label: cameraPublishAllowedNow ? "Flip" : "Switch", action: cameraPublishAllowedNow ? "flip" : "switch" },
                  { icon: cameraPublishAllowedNow ? (cameraPaused ? "videocam-off-outline" : "videocam-outline") : "sparkles-outline", color: "#4FC3FF", label: cameraPublishAllowedNow ? "Video" : "Guests", action: cameraPublishAllowedNow ? "video" : "guests" },
                  { icon: "repeat-outline", color: "#67F5B5", label: "Switch", action: "switch" },
                  { icon: "sparkles-outline", color: "#FFB36A", label: "Guests", action: "guests" },
                  { icon: "power-outline", color: "#FF6B6B", label: "End", action: "end-live" },
                ]
              : canPublishClaimedMicNow && !cameraPublishAllowedNow
                ? [
                    { icon: live.micMuted ? "mic-off-outline" : "mic-outline", color: "#F8D978", label: "Mic", action: "mic" },
                    { icon: "close-circle-outline", color: "#FF6B6B", label: "End", action: "end-self" },
                  ]
                : cameraPublishAllowedNow
                  ? [
                      { icon: live.micMuted ? "mic-off-outline" : "mic-outline", color: "#F8D978", label: "Mic", action: "mic" },
                      { icon: "camera-reverse-outline", color: "#63D1FF", label: "Flip", action: "flip" },
                      { icon: cameraPaused ? "videocam-off-outline" : "videocam-outline", color: "#4FC3FF", label: "Video", action: "video" },
                      { icon: "close-circle-outline", color: "#FF6B6B", label: "End", action: "end-self" },
                    ]
                  : [
                      { icon: live.micMuted ? "mic-off-outline" : "mic-outline", color: "#F8D978", label: "Mic", action: "mic" },
                      { icon: "close-circle-outline", color: "#FF6B6B", label: "End", action: "end-self" },
                    ]).map((control, i) => (
              <Pressable
                key={`main-screen-host-control-${control.label}-${i}`}
                onPress={() => {
                  if (control.action === "mic") {
                    toggleMicMuted();
                    Haptics.selectionAsync().catch(() => {});
                    return;
                  }

                  if (control.action === "flip") {
                    toggleCameraFacing();
                    Haptics.selectionAsync().catch(() => {});
                    return;
                  }

                  if (control.action === "video") {
                    setCameraPaused((v) => !v);
                    Haptics.selectionAsync().catch(() => {});
                    return;
                  }

                  if (control.action === "switch") {
                    cyclePinnedGuest();
                    Haptics.selectionAsync().catch(() => {});
                    return;
                  }

                  if (control.action === "guests") {
                    if (!canManageLive) return;
                    setRequestListOpen(false);
                    setHostRequestCard(null);
                    setVipGuestCardSlot(null);
                    setProfileActionGuestId(null);

                    // Guests button opens the 5 host access controls:
                    // AUTO / PROVE / INVITE / MEMBER / LOCK
                    setHostDrawerOpen(false);
                    setRequestPolicyOpen((v) => !v);

                    Haptics.selectionAsync().catch(() => {});
                    return;
                  }

                  if (control.action === "end-self") {
                    quitLiveRoom();
                    return;
                  }

                  if (control.action === "end-live") {
                    endLiveNow();
                    return;
                  }

                  console.log("host control pressed:", control);
                }}
                style={({ pressed }) => ([
                  s.teamGridTableControlBtn,
                  pressed ? s.teamGridTableControlBtnPressed : null,
                ] as any)}
              >
                <Ionicons name={control.icon as any} size={22} color={control.color} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {false && layoutMode === "grid6" && !canUseLiveControlsNow ? (
          <View pointerEvents="box-none" style={s.teamGridTableControlsLayer as any}>
            {[
              { icon: live.micMuted ? "mic-off-outline" : "mic-outline", label: "Mic", action: "mic" },
              { icon: "camera-reverse-outline", label: "Flip", action: "flip" },
              { icon: "close-circle-outline", label: "End", action: "end" },
              { icon: "share-social-outline", label: "Share", action: "share" },
              { icon: "heart-outline", label: "Like", action: "like" },
            ].map((control, i) => (
              <Pressable
                key={`viewer-live-control-${control.label}-${i}`}
                onPress={() => {
                  if (control.action === "mic") {
                    toggleMic();
                    Haptics.selectionAsync().catch(() => {});
                    return;
                  }

                  if (control.action === "flip") {
                    toggleCameraFacing();
                    Haptics.selectionAsync().catch(() => {});
                    return;
                  }

                  if (control.action === "end") {
                    quitLiveRoom();
                    return;
                  }

                  if (control.action === "share") {
                    Share.share({ message: `${mediaName} is live now on Kristo App` }).catch(() => {});
                    return;
                  }

                  Haptics.selectionAsync().catch(() => {});
                }}
                style={({ pressed }) => ([
                  s.teamGridTableControlBtn,
                  control.action === "end" ? s.viewerEndControlBtn : null,
                  pressed ? s.teamGridTableControlBtnPressed : null,
                ] as any)}
              >
                <Ionicons
                  name={control.icon as any}
                  size={26}
                  color={control.action === "end" ? "#FF6B6B" : "#F4C95D"}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        {false && layoutMode === "grid6" && canManageLive && hostRequestCard ? (
          <View pointerEvents="box-none" style={s.hostRequestVipLayer as any}>
            <View style={s.hostRequestVipCard as any}>
              <View style={s.hostRequestVipTop as any}>
                <View style={s.hostRequestVipAvatar as any}>
                  {hostRequestCard?.req?.avatar && String(hostRequestCard?.req?.avatar).includes("/") ? (
                    <Image source={{ uri: String(hostRequestCard.req.avatar) }} style={s.teamGridRequestAvatarImage as any} />
                  ) : (
                    <Text style={s.hostRequestVipAvatarText as any}>
                      {initials(String(hostRequestCard?.req?.name || "Guest")).slice(0, 2)}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.hostRequestVipName as any}>
                    {String(hostRequestCard?.req?.name || "Guest")}
                  </Text>
                  <Text style={s.hostRequestVipSub as any}>wants to join live</Text>
                </View>
              </View>

              <View style={s.hostRequestVipActions as any}>
                <Pressable
                  onPress={() => {
                    const slot = Number(hostRequestCard.slot || 0);
                    const req = hostRequestCard.req || {};

                    false && false && pushLiveAction("v1-disabled-request", {
                      slot,
                      name: req.name,
                      avatar: req.avatar,
                      joinedAt: req.joinedAt || new Date().toISOString(),
                      waiting: true,
                    });

                    setJoinRequestsBySlot((prev) => {
                      const next = { ...prev };
                      next[slot] = {
                        ...req,
                        waiting: true,
                        approved: false,
                        onStage: false,
                      };
                      return next;
                    });

                    setRequestListOpen(false);
                    setHostRequestCard(null);
                  }}
                  style={[s.hostRequestVipBtn as any, s.hostRequestVipWait as any]}
                >
                  <Text style={s.hostRequestVipWaitText as any}>Waiting</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (!canManageLive) return;
                    const slot = Number(hostRequestCard.slot || 0);
                    const req = hostRequestCard.req || {};
                    false && pushLiveAction("v1-disabled-approve", { slot, onStage: true, approved: true });
                              setJoinRequestsBySlot((prev) => {
                                const next = { ...prev };
                                delete next[slot];
                                return next;
                              });
                              setRequestListOpen(false);
                              setHostRequestCard(null);
                    const approvedReq = {
                      ...req,
                      approved: true,
                      onStage: true,
                      waiting: false,
                      joinedAt: req.joinedAt || new Date().toISOString(),
                    };
                    false && pushLiveAction("v1-disabled-approve", { slot, onStage: true, approved: true });
                    setJoinRequestsBySlot((prev) => ({ ...prev, [slot]: approvedReq }));

                    // scheduled live should stay on active slot owner
                    if (isMediaInstantLive) {
                      setBigStageGuestId("host");
                    }

                    setHostRequestCard(null);
                    setRequestListOpen(false);
                    setVipGuestCardSlot(null);
                  }}
                  style={[s.hostRequestVipBtn as any, s.hostRequestVipAccept as any]}
                >
                  <Text style={s.hostRequestVipAcceptText as any}>Accept</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {layoutMode === "grid6" && canManageLive && vipGuestCardSlot === -999 ? (() => {
          const req = joinRequestsBySlot[vipGuestCardSlot] as any;
          if (!req) return null;
          const guestId = `request-slot-${vipGuestCardSlot}`;
          return (
            <View pointerEvents="box-none" style={s.grid6GuestControlsLayer as any}>
              <View style={s.grid6GuestControlsCard as any}>
                <View style={s.vipGuestSmartActions as any}>
                  <Pressable
                    style={s.vipGuestSmartBtn as any}
                    onPress={() => setMiniVideoMutedById((prev) => ({ ...prev, [guestId]: !prev[guestId] }))}
                  >
                    <View style={s.grid6ControlIconBubble as any}><Ionicons name="mic-off-outline" size={20} color="#F4D06F" /></View>
                    <Text style={s.vipGuestSmartBtnText as any}>Mute</Text>
                  </Pressable>

                  <Pressable
                    style={s.vipGuestSmartBtn as any}
                    onPress={() => {
                      const waitingReq = { ...req, approved: false, onStage: false, waiting: true };
                      setJoinRequestsBySlot((prev) => ({ ...prev, [vipGuestCardSlot]: waitingReq }));
                      if (bigStageGuestId === guestId && isMediaInstantLive) {
                        setBigStageGuestId("host");
                      }
                      setStageGuestIds((prev) => prev.filter((id) => id !== guestId));
                      false && false && pushLiveAction("v1-disabled-request", {
                        slot: vipGuestCardSlot,
                        name: req.name,
                        avatar: req.avatar,
                        joinedAt: req.joinedAt || new Date().toISOString(),
                        waiting: true,
                      });
                      setVipGuestCardSlot(null);
                    }}
                  >
                    <View style={s.grid6ControlIconBubble as any}><Ionicons name="time-outline" size={20} color="#F4D06F" /></View>
                    <Text style={s.vipGuestSmartBtnText as any}>Waiting</Text>
                  </Pressable>

                  <Pressable
                    style={s.vipGuestSmartBtn as any}
                    onPress={() => {
                      setBigStageGuestId(guestId);
                      setPinnedGuestId(guestId);
                      setVipGuestCardSlot(null);
                    }}
                  >
                    <View style={s.grid6ControlIconBubble as any}><Ionicons name="expand-outline" size={20} color="#F4D06F" /></View>
                    <Text style={s.vipGuestSmartBtnText as any}>Big</Text>
                  </Pressable>

                  <Pressable
                    style={s.vipGuestSmartBtn as any}
                    onPress={() => {
                      if (!canManageLive) return;
                      // Up = move guest to upper small cards only, NOT big screen
                      setStageGuestIds((prev) => prev.includes(guestId) ? prev : [guestId, ...prev].slice(0, 4));

                      setJoinRequestsBySlot((prev) => ({
                        ...prev,
                        [vipGuestCardSlot]: {
                          ...(prev[vipGuestCardSlot] as any),
                          approved: true,
                          onStage: true,
                        } as any,
                      }));

                      pushLiveAction("move-upper", {
                        slot: vipGuestCardSlot,
                      });

                      if (isMediaInstantLive) {
                        setBigStageGuestId("host");
                        setPinnedGuestId("host");
                      }
                      setVipGuestCardSlot(null);
                    }}
                  >
                    <View style={s.grid6ControlIconBubble as any}><Ionicons name="arrow-up-circle-outline" size={22} color="#F4D06F" /></View>
                    <Text style={s.vipGuestSmartBtnText as any}>Up</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })() : null}

        {layoutMode === "grid6" ? (
          <View pointerEvents="box-none" style={s.teamGridOverlayLayer as any}>
            {[0, 1, 2, 3].map((index) => {
              const box = bottomStageDisplayBoxes[index] || { kind: "locked_closed" as const, index };
              const positionStyle = [
                index % 2 === 0 ? s.teamGridMiniCardLeft : s.teamGridMiniCardRight,
                index < 2 ? s.teamGridMiniCardRowOne : s.teamGridMiniCardRowTwo,
              ];

              if (box.kind === "open") {
                const slot = box.slot as any;
                return (
                  <Pressable
                    key={`open-claim-slot-${slot?.id || slot?.slot || index}`}
                    onPress={() => navigateToLiveSlotsForClaim(slot)}
                    style={({ pressed }) => ([
                      s.teamGridMiniCard,
                      ...positionStyle,
                      pressed ? s.upperBookRequestPressed : null,
                    ] as any)}
                  >
                    <View style={s.teamGridRequestAvatar as any}>
                      <Text style={s.teamGridRequestAvatarText as any}>+</Text>
                      <View
                        pointerEvents="none"
                        style={[
                          s.slotOrbitAvatarRing as any,
                          { borderColor: slotRingColor((slot as any)?.slot || (index + 1)) },
                        ]}
                      />
                    </View>

                    <View style={s.teamGridRequestTextArea as any}>
                      <Text style={s.teamGridRequestName as any} numberOfLines={1}>
                        Go Claim
                      </Text>
                      <Text style={[s.teamGridRequestStatus as any, s.teamGridRequestStatusApproved]} numberOfLines={1}>
                        Open slot available
                      </Text>
                    </View>
                  </Pressable>
                );
              }

              if (box.kind === "claimed") {
                const slot = box.slot as any;
                const slotNum = Number(slot?.slot || index + 1);
                const displayName = String(slot?.claimedByName || slot?.name || `Guest ${slotNum}`);
                const displayRole = String(slot?.role || slot?.roleLabel || "Speaker");
                const avatarUri = String(slot?.avatar || "");

                return (
                  <View
                    key={`claimed-stage-slot-${slot?.id || slotNum}-${index}`}
                    pointerEvents="none"
                    style={[s.teamGridMiniCard, ...positionStyle] as any}
                  >
                    <View style={s.teamGridRequestAvatar as any}>
                      {isImageAvatar(avatarUri) ? (
                        <Image
                          source={{ uri: avatarUri }}
                          style={s.teamGridRequestAvatarImage as any}
                        />
                      ) : (
                        <Text style={s.teamGridRequestAvatarText as any}>
                          {initials(displayName)}
                        </Text>
                      )}
                      <View
                        pointerEvents="none"
                        style={[
                          s.slotOrbitAvatarRing as any,
                          { borderColor: slotRingColor(slotNum) },
                        ]}
                      />
                    </View>
                    <View style={s.teamGridRequestTextArea as any}>
                      <Text style={s.teamGridRequestName as any} numberOfLines={1}>
                        {displayName}
                      </Text>
                      <Text style={[s.teamGridRequestStatus as any, s.teamGridRequestStatusApproved]} numberOfLines={1}>
                        {displayRole}
                      </Text>
                    </View>
                  </View>
                );
              }

              return (
                <View
                  key={`locked-stage-slot-${index}`}
                  pointerEvents="none"
                  style={[
                    s.teamGridMiniCard,
                    ...positionStyle,
                    {
                      borderColor: "rgba(244,208,111,0.55)",
                      backgroundColor: "rgba(72,8,12,0.94)",
                      shadowColor: "#8B0000",
                      shadowOpacity: 0.45,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 4 },
                    },
                  ] as any}
                >
                  <View
                    style={[
                      s.teamGridRequestAvatar as any,
                      {
                        backgroundColor: "rgba(139,0,0,0.35)",
                        borderColor: "rgba(244,208,111,0.72)",
                      },
                    ]}
                  >
                    <Ionicons name="lock-closed" size={22} color="#F4D06F" />
                  </View>
                  <View style={s.teamGridRequestTextArea as any}>
                    <Text style={[s.teamGridRequestName as any, { color: "#FFD6D6" }]} numberOfLines={1}>
                      All slots closed
                    </Text>
                    <Text
                      style={[
                        s.teamGridRequestStatus as any,
                        { color: "rgba(255,214,214,0.78)", fontWeight: "700" },
                      ]}
                      numberOfLines={1}
                    >
                      No slots available
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
<StatusBar translucent backgroundColor="transparent" barStyle="light-content" hidden={false} />
      <View style={s.page as any}>
        {layoutMode !== "grid6" && layoutMode !== "audience20" ? (
        <View style={s.topBar as any}>
          {!isMediaInstantLive && layoutMode !== "focus" ? (
            <Pressable onPress={() => quitLiveRoom()} style={s.backBtn as any}>
              <Ionicons name="chevron-back" size={22} color="#DCE9FF" />
            </Pressable>
          ) : null}

          {false && isMediaInstantLive ? (
            <View style={s.mediaLiveTopCard as any}>
              <View style={s.mediaLiveHeaderGlow as any} />

              <Pressable onPress={() => quitLiveRoom()} style={({ pressed }) => ([s.mediaLiveBackBtn, pressed ? s.pressed : null] as any)}>
                <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
              </Pressable>

              <Text style={s.mediaLiveTopTitle as any} numberOfLines={1} ellipsizeMode="tail">{title}</Text>

              <Pressable
                disabled={accessRequestSent}
                onPress={() => {
                  if (isMinistryInstantLive && String((params as any).ministryId || "")) {
                    router.push({
                      pathname: "/church/ministries/[ministryId]",
                      params: { ministryId: String((params as any).ministryId || "") },
                    } as any);
                    return;
                  }
                  router.push("/more/media" as any);
                }}
                style={({ pressed }) => ([s.mediaLiveTopAvatar, pressed ? s.pressed : null] as any)}
              >
                <Text style={s.mediaLiveTopAvatarText as any}>{mediaName.slice(0, 1).toUpperCase()}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={s.pageTitle as any} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
              <Text style={s.pageSub as any}>{liveScheduleReady ? liveMeta : "Scheduled slot only"}</Text>
            </View>
          )}

          {!isMediaInstantLive ? (
            <View style={[s.livePill as any, livePillToneStyle]}>
              <View style={[s.liveDot as any, liveDotToneStyle]} />
              <Text style={s.livePillText as any}>
                {liveStillActive ? "LIVE" : canEnterWaitingRoom ? "WAITING" : canEnterBackstage ? "READY" : audienceOpen ? "OPEN" : backstageOpen ? "READY" : "PLANNED"}
              </Text>
            </View>
          ) : null}
        </View>
        ) : null}

        {canSeeAuthorityBar && layoutMode !== "grid6" && layoutMode !== "audience20" ? (
          canManageLive || isCoHostRole ? (
            <View style={s.authorityBar as any}>
              <View style={s.authorityBarTop as any}>
                <View style={s.authorityInfoPill as any}>
                  <Text style={s.authorityLabel as any}>LIVE MC</Text>
                  <Text style={s.authorityValue as any} numberOfLines={1}>
                    {activeSlot?.name || currentScheduleEntry?.title || mcRuntime.current.name}
                  </Text>
                </View>

                <View style={s.authorityInfoPill as any}>
                  <Text style={s.authorityLabel as any}>COUNTDOWN</Text>
                  <Text
                    style={[
                      s.authorityValue,
                      authorityCountdownTone === "warn"
                        ? s.authorityValueWarn
                        : authorityCountdownTone === "danger"
                          ? s.authorityValueDanger
                          : authorityCountdownTone === "overtime"
                            ? s.authorityValueOvertime
                            : null,
                    ]}
                    numberOfLines={1}
                  >
                    {liveCountdownLabel}
                  </Text>
                </View>
              </View>

              <View style={s.authorityBarBottom as any}>
                <View style={s.authorityInfoPillWide as any}>
                  <Text style={s.authorityLabel as any}>TASK</Text>
                  <Text style={s.authorityValue as any} numberOfLines={1}>
                    {activeSlot?.task || currentScheduleEntry?.task || mcRuntime.current.task}
                  </Text>
                </View>

                <View style={s.authorityInfoPillWide as any}>
                  <Text style={s.authorityLabel as any}>NEXT</Text>
                  <Text style={s.authorityValue as any} numberOfLines={1}>
                    {nextSpeakerLabel || mcRuntime.next.name}
                  </Text>
                </View>
              </View>
            </View>
          ) : null
        ) : null}

        {layoutMode === "grid6" || layoutMode === "focus" ? null : (
        <View style={layoutMode === "audience20" ? s.soloVideoCard : s.videoCard}>
          {layoutMode !== "audience20" ? <View style={s.topOverlay as any}>
            <View style={[s.badge as any, s.hostBadge]}>
              <Ionicons
                name={isHost ? (live.micMuted ? "mic-off" : "mic") : "person-outline"}
                size={16}
                color="#DCE9FF"
              />
              <Text style={[s.badgeText as any, s.hostBadgeText]} numberOfLines={1}>
                {isHost ? "HOST" : "VIEWER"}
              </Text>
            </View>

            <View style={s.topOverlayRight as any}>
              <View style={s.countBadge as any}>
                <Ionicons name="hand-left-outline" size={18} color="#DCE9FF" />
                <Text style={s.badgeText as any}>{membersCount}</Text>
              </View>

              <View style={s.countBadge as any}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#DCE9FF" />
                <Text style={s.badgeText as any}>{leadersCount}</Text>
              </View>

              <View style={s.countBadge as any}>
                <Ionicons name="sparkles-outline" size={20} color="#DCE9FF" />
                <Text style={s.badgeText as any}>{live.viewerCount}</Text>
              </View>
            </View>
          </View> : null}

          {!finalAudienceGateAllowed && !isMediaInstantLive ? (
            <View
              style={{
                position: "absolute",
                left: 18,
                right: 18,
                bottom: 86,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: "rgba(244,208,111,0.28)",
                backgroundColor: "rgba(2,8,23,0.82)",
                padding: 16,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="lock-closed-outline" size={18} color={GOLD} />
                <Text style={{ color: GOLD, fontWeight: "900", fontSize: 13 }}>
                  ACCESS RESTRICTED
                </Text>
              </View>

              <Text style={{ color: "rgba(255,255,255,0.92)", fontWeight: "800", fontSize: 15 }}>
                {audienceGateMessage || "This live is not open for your role."}
              </Text>

              <Text style={{ color: "rgba(255,255,255,0.68)", fontSize: 12, lineHeight: 18 }}>
                {scheduleAudienceAccessText}. Ask the host or pastor if you need access.
              </Text>

              <Pressable
                onPress={() => {
                  try {
                    publishLiveJoin(
                      liveBridgeId,
                      0,
                      {
                        id: `restricted-${Date.now()}`,
                        name: "You",
                        avatar: "Y",
                        role: roleLabel || "Viewer",
                        approved: false,
                        requestedAt: Date.now(),
                      } as any
                    );
                    setAccessRequestSent(true);
                    Alert.alert("Request sent", "Host will review your request.");
                  } catch (e) {
                    Alert.alert("Request failed", "Try again.");
                  }
                }}
                style={({ pressed }) => [
                  {
                    marginTop: 4,
                    height: 58,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: accessRequestSent ? "rgba(255,255,255,0.08)" : "rgba(244,208,111,0.22)",
                    borderWidth: 1,
                    borderColor: accessRequestSent ? "rgba(255,255,255,0.14)" : "rgba(244,208,111,0.36)",
                  },
                  pressed ? s.pressed : null,
                ]}
              >
                <Text style={{ color: GOLD, fontWeight: "900", fontSize: 13 }}>
                  {accessApproveCountdown !== null
                    ? `Approved • entering in ${accessApproveCountdown}`
                    : accessRequestSent
                      ? "Waiting for approval…"
                      : "Request Access"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {layoutMode !== "split2" && layoutMode !== "grid3" && layoutMode !== "audience20" ? (
            <View style={s.titleCard as any}>
              <Text style={s.videoTitle as any} numberOfLines={1}>
                {title}
              </Text>
              {liveAssignmentVideo?.item?.title ? (
                <Text style={s.videoMeta as any} numberOfLines={1}>
                  {String(liveAssignmentVideo.claimedBy || "Assigned member")} • {String(liveAssignmentVideo.item.title || "Assigned clip")}
                </Text>
              ) : null}
              <Text style={s.videoMeta as any} numberOfLines={1}>
                {!liveEnabled
                  ? "● WAITING FOR SLOT"
                  : live.isPaused
                    ? "● PAUSED"
                    : liveAssignmentVideo?.item?.title
                      ? `● LIVE VIDEO • ${String(liveAssignmentVideo.item.title || "Assigned clip")}`
                      : "● LIVE NOW"}
              </Text>
            </View>
          ) : null}

          {layoutMode === "split2" ? (
            <View style={s.layoutSplitWrap as any}>
              {splitGuests.map((guest, index) => (
                <View
                  key={guest.id}
                  style={[
                    s.splitCard,
                    index !== 0 ? getGuestTileToneStyle(guest.id) : null,
                  ]}
                >
                  {index === 0 ? (
                    <>
                      {hasCameraAccess ? (
                        canShowCamera ? (
                          <CameraView
                          key={`split-${cameraFacing}`}
                          style={s.splitCamera as any}
                          facing={cameraFacing}
                          mute={live.micMuted}
                          active
                          onCameraReady={() => setCameraReady(true)}
                        />
                      ) : (
                          <View style={s.splitCameraFallback as any} />
                        )
                      ) : (
                        <View style={[s.splitCamera as any, s.splitCameraPlaceholder]}>
                          <Ionicons name="videocam-outline" size={22} color="#DCE9FF" />
                          <Text style={s.splitPlaceholderText as any}>Camera off</Text>
                        </View>
                      )}
                      <View style={s.splitHostShade as any} />
                    </>
                  ) : (
                    <>
                      <View style={s.splitGuestFill as any}>
                        <View style={s.splitGuestGlow as any} />
                        <View style={s.splitGuestGlow2 as any} />
                        <View style={s.splitGuestMesh as any} />
                        <View style={s.splitGuestAvatarWrap as any}>
                          <View style={s.splitGuestAvatarRing as any}>
                            <View style={s.splitGuestAvatarCore as any}>
                              {(guest as any)?.avatar && guest && isImageAvatar((guest as any).avatar) ? (
                                <Image
                                  source={{ uri: String((guest as any).avatar) }}
                                  style={s.teamGridRequestAvatarImage as any}
                                />
                              ) : (
                                <Text style={s.splitGuestAvatarText as any}>{guest ? initials(guest.name) : ""}</Text>
                              )}
                            </View>
                          </View>
                        </View>
                      </View>

                      <View style={s.splitGuestTopRow as any}>
                        <View style={s.splitGuestStatusPill as any}>
                          <View
                            style={[
                              s.splitGuestStatusDot,
                              guestMicMuted ? s.splitGuestStatusDotMuted : null,
                            ]}
                          />
                        </View>

                        {canManageLive ? (
                          <View style={s.splitGuestActions as any}>
                            <Pressable onPress={toggleGuestMic} style={s.splitGuestActionBtn as any}>
                              <Ionicons
                                name={guestMicMuted ? "mic-off" : "mic"}
                                size={14}
                                color="#DCE9FF"
                              />
                            </Pressable>

                            <Pressable
                              onPress={removePinnedGuest}
                              style={[s.splitGuestActionBtn as any, s.splitGuestActionBtnDanger]}
                            >
                              <Ionicons name="close" size={14} color="#DCE9FF" />
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    </>
                  )}

                  <View style={s.splitLabel as any}>
                    <View style={s.splitLabelTopRow as any}>
                      <View style={s.splitRolePill as any}>
                        <Text style={s.splitRolePillText as any}>{guest.role || "Guest"}</Text>
                      </View>

                      {isCurrentSpeakerGuest(guest.id) ? (
                        <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeCurrent]}>
                          <Text style={s.liveStateMiniBadgeText as any}>LIVE</Text>
                        </View>
                      ) : isNextSpeakerGuest(guest.id) ? (
                        <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeNext]}>
                          <Text style={s.liveStateMiniBadgeText as any}>NEXT</Text>
                        </View>
                      ) : null}
                    </View>

                    <Text style={s.splitName as any}>{guest.name}</Text>

                    <View style={s.splitStatusMetaRow as any}>
                      {isGuestOnStage(guest.id) ? (
                        <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeOnStage]}>
                          <Text style={s.liveStateMiniBadgeText as any}>ON STAGE</Text>
                        </View>
                      ) : null}

                      {isGuestMutedByAuthority(guest.id) ? (
                        <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeMuted]}>
                          <Text style={s.liveStateMiniBadgeText as any}>MUTED</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {layoutMode === "grid3" ? (
            <View pointerEvents="none" style={s.layoutGridWrap as any}>
              <View style={[s.grid3Card as any, s.grid3CardMain]}>
                {canShowCamera ? (
                  <CameraView
                    key={`grid-${cameraFacing}`}
                    style={s.grid3HostCamera as any}
                    facing={cameraFacing}
                    mute={live.micMuted}
                    active
                    onCameraReady={() => setCameraReady(true)}
                  />) : (<View style={s.grid3HostCameraFallback as any} />)}
                <View style={s.grid3HostShade as any} />

                <View style={s.gridLabel as any}>
                  <View style={s.gridRolePill as any}>
                    <Text style={s.gridRolePillText as any}>Host</Text>
                  </View>
                  <Text style={s.gridNameBig as any}>You</Text>
                </View>
              </View>

              <View style={s.grid3BottomRow as any}>
                {gridGuests.map((guest) => (
                  <View
                    key={guest.id}
                    style={[
                      s.grid3Card,
                      s.grid3CardSmall,
                      getGuestTileToneStyle(guest.id),
                    ]}
                  >
                    <View style={s.gridGuestFill as any}>
                      <View style={s.gridGuestGlow as any} />
                      <View style={s.gridGuestGlow2 as any} />
                      <View style={s.gridGuestMesh as any} />
                      <View style={s.gridGuestAvatarWrap as any}>
                        <View style={s.gridGuestAvatarRing as any}>
                          <View style={s.gridGuestAvatarCore as any}>
                            {(guest as any)?.avatar && guest && isImageAvatar((guest as any).avatar) ? (
                              <Image
                                source={{ uri: String((guest as any).avatar) }}
                                style={s.teamGridRequestAvatarImage as any}
                              />
                            ) : (
                              <Text style={s.gridGuestAvatarText as any}>{guest ? initials(guest.name) : ""}</Text>
                            )}
                          </View>
                        </View>
                      </View>
                    </View>

                    <View style={s.gridLabel as any}>
                      <View style={s.gridLabelTopRow as any}>
                        <View style={s.gridRolePill as any}>
                          <Text style={s.gridRolePillText as any}>{guest.role || "Guest"}</Text>
                        </View>

                        {isCurrentSpeakerGuest(guest.id) ? (
                          <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeCurrent]}>
                            <Text style={s.liveStateMiniBadgeText as any}>LIVE</Text>
                          </View>
                        ) : isNextSpeakerGuest(guest.id) ? (
                          <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeNext]}>
                            <Text style={s.liveStateMiniBadgeText as any}>NEXT</Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={s.gridName as any}>{guest.name}</Text>

                      <View style={s.gridStatusMetaRow as any}>
                        {isGuestOnStage(guest.id) ? (
                          <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeOnStage]}>
                            <Text style={s.liveStateMiniBadgeText as any}>ON STAGE</Text>
                          </View>
                        ) : null}

                        {isGuestMutedByAuthority(guest.id) ? (
                          <View style={[s.liveStateMiniBadge as any, s.liveStateMiniBadgeMuted]}>
                            <Text style={s.liveStateMiniBadgeText as any}>MUTED</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
{layoutMode === "audience20" ? (
          <Image
            source={require("../../../../../assets/images/large-audience-20-stage.png")}
            style={s.audience20Image as any}
            resizeMode="cover"
          />
        ) : null}
        </View>

        )}
        {layoutMode === "audience20" ? null : (canManageLive || isCoHostRole) && layoutMode !== "grid6" ? (
          <View style={s.controlsWrap as any}>
            <View style={s.controlsRow as any}>
              {cameraPublishAllowedNow ? (
              <Pressable
                onPress={toggleCameraFacing}
                style={({ pressed }) => ([
                  s.ctrlBtn,
                  s.ctrlBtnHalf,
                  s.ctrlBtnRing,
                  pressed ? ({ opacity: 0.9, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                ] as any)}
              >
                <Ionicons name="camera-reverse-outline" size={17} color="#DCE9FF" />
                <Text style={s.ctrlBtnLabel as any}>Flip</Text>
              </Pressable>
              ) : null}

              {cameraPublishAllowedNow ? (
              <Pressable
                onPress={async () => {
                if (!cameraPermission?.granted) {
                  const res = await requestCameraPermission();
                  if (!res.granted) return;
                }
                if (!micPermission?.granted) {
                  await requestMicPermission();
                }
                setCameraPaused((v) => !v);
              }}
                style={({ pressed }) => ([
                  s.ctrlBtn,
                  s.ctrlBtnCompact,
                  cameraPaused ? s.ctrlBtnGlassOff : s.ctrlBtnLiveRed,
                  pressed ? ({ opacity: 0.92, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                ] as any)}
              >
                <Ionicons
                  name={cameraPaused ? "videocam-off-outline" : "videocam-outline"}
                  size={16}
                  color="#DCE9FF"
                />
                <Text style={cameraPaused ? s.ctrlBtnLabel : s.ctrlBtnLabelWhiteStrong}>
                  {cameraPaused ? "Off" : "On"}
                </Text>
              </Pressable>
              ) : null}

              <Pressable
                onPress={openMoreMenu}
                style={({ pressed }) => ([
                  s.ctrlBtn,
                  s.ctrlBtnHalf,
                  s.ctrlBtnMoreRing,
                  pressed ? ({ opacity: 0.9, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                ] as any)}
              >
                <Ionicons name="ellipsis-horizontal" size={22} color="#DCE9FF" />
                <Text style={s.ctrlBtnLabel as any}>More</Text>
              </Pressable>

              <Pressable
                onPress={endLiveNow}
                style={({ pressed }) => ([
                  s.ctrlBtn,
                  s.ctrlBtnCompact,
                  s.endBtn,
                  pressed ? ({ opacity: 0.92, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                ] as any)}
              >
                <Ionicons name="stop-circle-outline" size={18} color="#DCE9FF" />
                <Text style={s.ctrlBtnLabel as any}>End</Text>
              </Pressable>

              <Pressable
                onPress={toggleMicMuted}
                style={({ pressed }) => ([
                  s.ctrlBtn,
                  s.ctrlBtnHalf,
                  s.ctrlBtnRing,
                  pressed ? ({ opacity: 0.9, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                ] as any)}
              >
                <Ionicons name={live.micMuted ? "mic-off" : "mic"} size={17} color="#DCE9FF" />
                <Text style={s.ctrlBtnLabel as any}>Mute</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View
            pointerEvents="box-none"
            style={[
              s.viewerActionWrap as any,
              (layoutMode === "grid6" || layoutMode === "focus")
                ? ({ left: 18, right: 18, bottom: 22, justifyContent: "center" } as any)
                : null,
            ]}
          >
            {layoutMode === "grid6" || layoutMode === "focus" ? (
              <Pressable
                onPress={quitLiveRoom}
                style={({ pressed }) => ([
                  s.viewerActionBtn,
                  s.viewerActionBtnPrimary,
                  {
                    height: 52,
                    borderRadius: 999,
                    justifyContent: "center",
                    backgroundColor: "rgba(170,14,28,0.92)",
                    borderWidth: 1.5,
                    borderColor: "rgba(255,72,88,0.98)",
                  } as any,
                  pressed ? ({ opacity: 0.92, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                ] as any)}
              >
                <Ionicons name="close-circle-outline" size={22} color="#FFFFFF" />
                <Text style={s.viewerActionBtnText as any}>Close Live</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={handleSharePress}
                  style={({ pressed }) => ([
                    s.viewerActionBtn,
                    s.viewerActionBtnPrimary,
                    pressed ? ({ opacity: 0.92, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                  ] as any)}
                >
                  <Ionicons name="share-social-outline" size={18} color="#DCE9FF" />
                  <Text style={s.viewerActionBtnText as any}>Share</Text>
                </Pressable>

                <Pressable
                  onPress={openHostDrawer}
                  style={({ pressed }) => ([
                    s.viewerActionBtn,
                    pressed ? ({ opacity: 0.92, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                  ] as any)}
                >
                  <Ionicons name="apps-outline" size={18} color="#DCE9FF" />
                  <Text style={s.viewerActionBtnText as any}>More</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {canSeeAudiencePanel ? (
          <>
            {!hostDrawerOpen ? (
              <Pressable
                onPress={openHostDrawer}
                pointerEvents="box-only"
                {...hostDrawerPanResponder.panHandlers}
                style={s.viewerFlowEdgeHandle as any}
              />
            ) : null}

            {viewerFlowOpen ? (
              <Pressable style={s.viewerFlowScrim as any} onPress={closeViewerFlow} />
            ) : null}

            {viewerFlowOpen ? (
            <Animated.View
              pointerEvents="auto"
              {...viewerFlowPanResponder.panHandlers}
              style={[
                s.viewerFlowPanel,
                { transform: [{ translateX: viewerFlowX }] },
              ]}
            >
              <View style={s.viewerFlowHandle as any} />
              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={[
                  s.audiencePanelScroll,
                  { paddingBottom: Math.max(insets.bottom, 12) + 16 },
                ]}
              >
                {isClaimedMemberAudience && claimedMemberPanelInfo ? (
                  <>
                    <Text style={s.audiencePanelEyebrow as any}>MY SPEAKING SLOT</Text>
                    <View style={[s.audiencePanelHero as any, s.audiencePanelHeroLive as any]}>
                      <View style={s.audiencePanelHeroTop as any}>
                        <Text style={s.audiencePanelHeroSlot as any}>Slot {claimedMemberPanelInfo.slot}</Text>
                        <View
                          style={[
                            s.audiencePanelStatusPill as any,
                            { borderColor: claimedMemberPanelInfo.statusColor },
                          ]}
                        >
                          <Text style={[s.audiencePanelStatusText as any, { color: claimedMemberPanelInfo.statusColor }]}>
                            {claimedMemberPanelInfo.status}
                          </Text>
                        </View>
                      </View>
                      <View style={s.audiencePanelHeroBody as any}>
                        {renderHostControlAvatar(
                          claimedMemberPanelInfo.name,
                          claimedMemberPanelInfo.avatar,
                          56,
                          claimedMemberPanelInfo.statusColor
                        )}
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={s.audiencePanelSpeakerName as any} numberOfLines={1}>
                            {claimedMemberPanelInfo.name}
                          </Text>
                          <Text style={s.audiencePanelHeroTopic as any} numberOfLines={2}>
                            {claimedMemberPanelInfo.topic}
                          </Text>
                          <Text style={s.audiencePanelHeroMeta as any}>
                            {claimedMemberPanelInfo.timeLabel} • {claimedMemberPanelInfo.countdown}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {renderAudienceCurrentLiveBlock()}
                    {renderAudienceNextSpeakerBlock()}
                    {renderAudienceClaimedSpeakersSection(false)}
                    {renderAudienceViewerStatsSection(false)}
                    {renderAudienceUpcomingQueueSection()}
                    {renderAudienceMicStatusSection()}
                    {renderAudienceSafeActions()}
                  </>
                ) : (
                  <>
                    <Text style={s.audiencePanelEyebrow as any}>VIEWER PANEL</Text>
                    <Text style={s.audiencePanelTitle as any} numberOfLines={2}>{rawTitle}</Text>

                    {hostControlLiveSpeaker ? (
                      <View style={[s.audiencePanelHero as any, { borderColor: "rgba(34,197,94,0.42)" }]}>
                        <Text style={s.audiencePanelBlockLabel as any}>LIVE NOW</Text>
                        <View style={s.audiencePanelHeroBody as any}>
                          {renderHostControlAvatar(
                            hostControlLiveSpeaker.name,
                            hostControlLiveSpeaker.avatar,
                            52,
                            "#22C55E"
                          )}
                          <View style={{ flex: 1, gap: 3 }}>
                            <Text style={s.audiencePanelSpeakerName as any} numberOfLines={1}>
                              {hostControlLiveSpeaker.name}
                            </Text>
                            <Text style={s.audiencePanelSpeakerTopic as any} numberOfLines={2}>
                              {hostControlLiveSpeaker.topic}
                            </Text>
                            <Text style={s.audiencePanelSpeakerMeta as any}>
                              Slot {hostControlLiveSpeaker.slot || "—"} • {hostControlLiveSpeaker.countdown}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ) : null}

                    {renderAudienceNextSpeakerBlock()}
                    {renderAudienceClaimedSpeakersSection(true)}
                    {renderAudienceViewerStatsSection(true)}

                    {openClaimableSlots.length ? (
                      <View style={s.audiencePanelBlock as any}>
                        <Text style={s.audiencePanelBlockLabel as any}>OPEN SLOTS</Text>
                        <View style={s.audiencePanelClaimRow as any}>
                          {openClaimableSlots.map((slot: any) => (
                            <Pressable
                              key={`viewer-claim-${slot?.id || slot?.slot}`}
                              onPress={() => navigateToLiveSlotsForClaim(slot)}
                              style={({ pressed }) => ([
                                s.audiencePanelClaimBtn,
                                pressed ? s.audiencePanelClaimBtnPressed : null,
                              ] as any)}
                            >
                              <Text style={s.audiencePanelClaimBtnText as any}>
                                Go Claim S{slot.slot}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {renderAudienceSafeActions()}
                  </>
                )}
              </ScrollView>
            </Animated.View>
            ) : null}
          </>
        ) : null}

        <Modal
          visible={moreOpen}
          transparent
          animationType="fade"
          onRequestClose={closeMoreMenu}
        >
          <Pressable style={s.moreBackdrop as any} onPress={closeMoreMenu}>
            <Pressable style={s.moreSheet as any} onPress={() => {}}>
              <View style={s.moreHandle as any} />

              {canManageLive ? (
                <>
                  <Text style={s.moreGroupTitle as any}>Studio</Text>

                  <Pressable style={s.moreItem as any} onPress={() => { closeMoreMenu(); toggleCameraFacing(); }}>
                    <Ionicons name="camera-reverse-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Flip camera</Text>
                  </Pressable>

                  <Pressable style={s.moreItem as any} onPress={() => { closeMoreMenu(); openLayoutPicker(); }}>
                    <Ionicons name="grid-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Change layout</Text>
                  </Pressable>

                  <Pressable style={s.moreItem as any} onPress={() => { closeMoreMenu(); togglePaused(); }}>
                    <Ionicons name={live.isPaused ? "play-outline" : "pause-outline"} size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>{live.isPaused ? "Resume live" : "Pause live"}</Text>
                  </Pressable>

                  <Text style={s.moreGroupTitle as any}>Studio</Text>

                  <Pressable style={s.moreItem as any} onPress={() => { closeMoreMenu(); cyclePinnedGuest(); }}>
                    <Ionicons name="locate-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Pin {pinnedGuest.name}</Text>
                  </Pressable>

                  <Pressable style={s.moreItem as any} onPress={handleGuestsPress}>
                    <Ionicons name="sparkles-outline" size={20} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Guests • {guests.length}</Text>
                  </Pressable>

                  <Text style={s.moreGroupTitle as any}>Safety</Text>

                  <Pressable style={s.moreItemDanger as any} onPress={() => { closeMoreMenu(); endLiveNow(); }}>
                    <Ionicons name="stop-circle-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}></Text>
                  </Pressable>
                </>
              ) : isCoHostRole ? (
                <>
                  <Text style={s.moreGroupTitle as any}>Studio</Text>

                  <Pressable style={s.moreItem as any} onPress={() => { closeMoreMenu(); toggleCameraFacing(); }}>
                    <Ionicons name="camera-reverse-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Flip camera</Text>
                  </Pressable>

                  <Text style={s.moreGroupTitle as any}>Studio</Text>

                  <Pressable style={s.moreItem as any} onPress={handleGuestsPress}>
                    <Ionicons name="sparkles-outline" size={20} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>View guests</Text>
                  </Pressable>

                  <Pressable style={s.moreItem as any} onPress={() => { closeMoreMenu(); Alert.alert("Request pin", "Pin request sent."); }}>
                    <Ionicons name="locate-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Request pin</Text>
                  </Pressable>

                  <Text style={s.moreGroupTitle as any}>Exit</Text>

                  <Pressable style={s.moreItemDanger as any} onPress={handleLeaveLive}>
                    <Ionicons name="exit-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Leave stage</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={s.moreGroupTitle as any}>Live</Text>

                  <Pressable style={s.moreItem as any} onPress={handleGuestsPress}>
                    <Ionicons name="sparkles-outline" size={20} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>View guests</Text>
                  </Pressable>

                  <Pressable style={s.moreItem as any} onPress={handleSharePress}>
                    <Ionicons name="share-social-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Share live</Text>
                  </Pressable>

                  <Text style={s.moreGroupTitle as any}>Safety</Text>

                  <Pressable style={s.moreItem as any} onPress={() => { closeMoreMenu(); Alert.alert("Report live", "Report coming soon"); }}>
                    <Ionicons name="flag-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Report</Text>
                  </Pressable>

                  <Text style={s.moreGroupTitle as any}>Exit</Text>

                  <Pressable style={s.moreItemDanger as any} onPress={handleLeaveLive}>
                    <Ionicons name="exit-outline" size={18} color="#DCE9FF" />
                    <Text style={s.moreItemText as any}>Leave live</Text>
                  </Pressable>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
      {hostDrawerOpen ? (
        <Pressable
          pointerEvents="auto"
          style={s.hostDrawerScrim as any}
          onPress={closeHostDrawer}
        />
      ) : null}

      <Animated.View
        pointerEvents={hostDrawerOpen ? "auto" : "none"}
        style={[
          s.hostDrawer,
          {
            transform: [{ translateX: hostDrawerX }],
          },
        ]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={[
            s.hostDrawerScrollContent,
            { paddingBottom: Math.max(insets.bottom + 18, 28) },
          ]}
        >
          <View style={s.hostDrawerHandle as any} />
          <Text style={s.hostDrawerEyebrow as any}>
            {canManageLiveHostActions
              ? isMediaInstantLive
                ? "MEDIA COMMAND CENTER"
                : "HOST COMMAND CENTER"
              : "LIVE ROOM"}
          </Text>

          {!isMediaInstantLive && hostControlLiveSpeaker ? (
            <View style={s.hcLiveHero as any}>
              <View style={s.hcLiveHeroTop as any}>
                <Text style={s.hcLiveHeroKicker as any}>LIVE NOW</Text>
                <Animated.View
                  style={[
                    s.hcLivePulseDotWrap as any,
                    {
                      transform: [{
                        scale: hostControlPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }),
                      }],
                      opacity: hostControlPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
                    },
                  ]}
                >
                  <View style={s.hcLivePulseDot as any} />
                </Animated.View>
              </View>
              <View style={s.hcLiveHeroBody as any}>
                {renderHostControlAvatar(hostControlLiveSpeaker.name, hostControlLiveSpeaker.avatar, 62, "#22C55E")}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.hcLiveHeroName as any} numberOfLines={1}>{hostControlLiveSpeaker.name}</Text>
                  <Text style={s.hcLiveHeroTopic as any} numberOfLines={2}>{hostControlLiveSpeaker.topic}</Text>
                  <Text style={s.hcLiveHeroMeta as any}>
                    Slot {hostControlLiveSpeaker.slot || "—"} • {hostControlLiveSpeaker.countdown}
                  </Text>
                </View>
              </View>
            </View>
          ) : !isMediaInstantLive ? (
            <View style={[s.hcLiveHero as any, { borderColor: "rgba(239,68,68,0.45)" }]}>
              <Text style={s.hcLiveHeroKicker as any}>LIVE STATUS</Text>
              <Text style={s.hcLiveHeroName as any}>{hostDrawerStateLabel}</Text>
            </View>
          ) : null}

          {!isMediaInstantLive && hostControlNextSpeaker ? (
            <View style={s.hcNextCard as any}>
              <Text style={s.hcSectionTitlePurple as any}>NEXT SPEAKER</Text>
              <View style={s.hcNextBody as any}>
                {renderHostControlAvatar(hostControlNextSpeaker.name, hostControlNextSpeaker.avatar, 52, "#A78BFA")}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.hcNextName as any} numberOfLines={1}>{hostControlNextSpeaker.name}</Text>
                  <Text style={s.hcNextTopic as any} numberOfLines={1}>{hostControlNextSpeaker.topic}</Text>
                  <Text style={s.hcNextMeta as any}>
                    {hostControlNextSpeaker.startTime} • Slot {hostControlNextSpeaker.slot || "—"}
                  </Text>
                </View>
                <View style={s.hcReadyPill as any}>
                  <Text style={s.hcReadyPillText as any}>{hostControlNextSpeaker.status}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {!isMediaInstantLive ? (
            <View style={s.hcSectionWrap as any}>
              <Text style={s.hcSectionTitlePurple as any}>
                CLAIMED SPEAKERS ({claimedUserCount} USERS • {claimedSlotCount} SLOTS)
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hcSpeakerScroll as any}>
                {hostControlClaimedSpeakers.length ? hostControlClaimedSpeakers.map((speaker: any) => (
                  <View key={speaker.id} style={s.hcSpeakerCard as any}>
                    {renderHostControlAvatar(speaker.name, speaker.avatar, 46, speaker.statusColor)}
                    <Text style={s.hcSpeakerName as any} numberOfLines={1}>{speaker.name}</Text>
                    <Text style={s.hcSpeakerSlot as any}>
                      {claimedSpeakerSlotLabelById[speaker.id] || `Slot ${speaker.slot}`}
                    </Text>
                    <Text style={s.hcSpeakerTopic as any} numberOfLines={1}>{speaker.topic}</Text>
                    <Text style={[s.hcSpeakerStatus as any, { color: speaker.statusColor }]}>{speaker.status}</Text>
                  </View>
                )) : (
                  <Text style={s.hcEmptyText as any}>No claimed speakers yet</Text>
                )}
              </ScrollView>
            </View>
          ) : null}

          <View style={s.hcHostSection as any}>
            <Text style={s.hcSectionTitleGold as any}>HOSTS ({hostControlHosts.length})</Text>
            {hostControlHosts.length ? hostControlHosts.map((host: any) => (
              <View key={host.id} style={s.hcHostRow as any}>
                {renderHostControlAvatar(host.name, host.avatar, 44, "#D9B35F")}
                <View style={{ flex: 1 }}>
                  <Text style={s.hcHostName as any} numberOfLines={1}>{host.name}</Text>
                  <Text style={s.hcHostRole as any}>{host.role}</Text>
                </View>
              </View>
            )) : (
              <Text style={s.hcEmptyText as any}>No hosts detected</Text>
            )}
          </View>

          <View style={s.hcViewerSection as any}>
            <View style={s.hcViewerHeader as any}>
              <Text style={s.hcSectionTitleBlue as any}>VIEWERS</Text>
              <Animated.View
                style={{
                  opacity: hostControlViewerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
                }}
              >
                <View style={s.hcViewerLiveDot as any} />
              </Animated.View>
            </View>
            <View style={s.hcViewerStatsGrid as any}>
              <View style={s.hcViewerStatRow as any}>
                <Text style={s.hcViewerStatLabel as any}>Total viewers</Text>
                <Text style={s.hcViewerStatValue as any}>{hostControlViewerStats.totalViewers}</Text>
              </View>
              <View style={s.hcViewerStatRow as any}>
                <Text style={s.hcViewerStatLabel as any}>Active viewers</Text>
                <Text style={s.hcViewerStatValue as any}>{hostControlViewerStats.activeViewers}</Text>
              </View>
              <View style={s.hcViewerStatRow as any}>
                <Text style={s.hcViewerStatLabel as any}>Members</Text>
                <Text style={s.hcViewerStatValue as any}>{hostControlViewerStats.members}</Text>
              </View>
              <View style={s.hcViewerStatRow as any}>
                <Text style={s.hcViewerStatLabel as any}>Leaders</Text>
                <Text style={s.hcViewerStatValue as any}>{hostControlViewerStats.leaders}</Text>
              </View>
            </View>
            <View style={s.hcViewerBreakdownRow as any}>
              {[
                { label: "TOTAL", value: hostControlViewerStats.totalViewers },
                { label: "ACTIVE", value: hostControlViewerStats.activeViewers },
                { label: "MEMBERS", value: hostControlViewerStats.members },
                { label: "LEADERS", value: hostControlViewerStats.leaders },
                { label: "GUESTS", value: hostControlViewerStats.guests },
              ].map((chip) => (
                <View key={chip.label} style={s.hcViewerChip as any}>
                  <Text style={s.hcViewerChipValue as any}>{chip.value}</Text>
                  <Text style={s.hcViewerChipLabel as any}>{chip.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {!isMediaInstantLive ? (
            <View style={s.hcQueueSection as any}>
              <Text style={s.hcSectionTitleGold as any}>UPCOMING QUEUE</Text>
              {hostControlUpcomingQueue.length ? hostControlUpcomingQueue.map((item: any, index: number) => (
                <View key={`${item.slot}-${index}`} style={s.hcQueueTimelineRow as any}>
                  <View style={s.hcQueueTimelineRail as any}>
                    <View style={[s.hcQueueTimelineDot as any, item.claimed ? s.hcQueueTimelineDotClaimed : null]} />
                    {index < hostControlUpcomingQueue.length - 1 ? <View style={s.hcQueueTimelineLine as any} /> : null}
                  </View>
                  <View style={s.hcQueueTimelineBody as any}>
                    <Text style={s.hcQueueTimelineSlot as any}>Slot {item.slot}</Text>
                    <Text style={s.hcQueueTimelineTime as any}>{item.timeLabel}</Text>
                    <Text style={s.hcQueueTimelineName as any} numberOfLines={1}>
                      {item.name} • {String(item.status || "").toUpperCase()}
                    </Text>
                  </View>
                </View>
              )) : (
                <Text style={s.hcEmptyText as any}>No upcoming scheduled slots</Text>
              )}
            </View>
          ) : null}

          {canManageLiveHostActions ? renderLiveHostManageActions() : null}
          {canSeeActiveSlotOwnerPanel ? renderLiveHostSlotOwnerControls() : null}
          {!canManageLiveHostActions && !canSeeActiveSlotOwnerPanel
            ? renderLiveHostViewerSafePanel()
            : null}
        </ScrollView>
      </Animated.View>

      
<Modal
  visible={layoutStudioOpen}
  transparent
  animationType="fade"
  onRequestClose={() => setLayoutStudioOpen(false)}
>
  <View style={s.layoutHeroOverlay as any}>
    <Pressable
      style={s.layoutHeroBackdrop as any}
      onPress={() => setLayoutStudioOpen(false)}
    />

    <View style={s.layoutHeroShell as any}>
      <Image
        source={require("../../../../../assets/images/kristo-live-layout-studio-v1.png")}
        style={s.layoutHeroImage as any}
        resizeMode="cover"
      />

      <Pressable onPress={() => chooseStudioLayout("split2")} style={[s.layoutHotspot as any, s.hotInterview]} />
      <Pressable onPress={() => chooseStudioLayout("split2desk")} style={[s.layoutHotspot as any, s.hotCoHost]} />

      <Pressable onPress={() => chooseStudioLayout("grid3")} style={[s.layoutHotspot as any, s.hotTriad]} />
      <Pressable onPress={() => chooseStudioLayout("panel3")} style={[s.layoutHotspot as any, s.hotPanel]} />
      <Pressable onPress={() => chooseStudioLayout("ring3")} style={[s.layoutHotspot as any, s.hotGuestPanel]} />

      <Pressable onPress={() => chooseStudioLayout("focus")} style={[s.layoutHotspot as any, s.hotSolo]} />
      <Pressable onPress={() => chooseStudioLayout("grid6")} style={[s.layoutHotspot as any, s.hotTeamGrid]} />
      <Pressable onPress={() => chooseStudioLayout("round6")} style={[s.layoutHotspot as any, s.hotRound]} />
      <Pressable onPress={() => chooseStudioLayout("desk6")} style={[s.layoutHotspot as any, s.hotBroadcast]} />

      <Pressable onPress={() => chooseStudioLayout("audience20")} style={[s.layoutHotspot as any, s.hotAudience]} />


      <Pressable
        onPress={() => setLayoutStudioOpen(false)}
        style={s.layoutHeroClose as any}
      >
        <Ionicons name="close" size={23} color="#DCE9FF" />
      </Pressable>
    </View>
  </View>
</Modal>


    </SafeAreaView>
  );
}

const s: any = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  page: {
    flex: 1,
    backgroundColor: "#000",
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 0,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  infoTitle: {
    color: "#DCE9FF",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8,
  },
  infoText: {
    color: "rgba(255,255,255,0.70)",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },
  primaryBtn: {
    height: 54,
    minWidth: 220,
    paddingHorizontal: 28,
    borderRadius: 24,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.30,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  primaryBtnText: {
    color: "#0B0F17",
    fontSize: 16,
    fontWeight: "800",
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  backBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pageTitle: {
    color: "#DCE9FF",
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  pageSub: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 13,
    marginTop: 3,
    fontWeight: "600",
  },

  authorityBar: {
    marginBottom: 3,
    gap: 4,
  },
  viewerAuthorityScroll: {
    marginTop: 8,
    marginBottom: 8,
    maxHeight: 455,
  },
  viewerAuthorityScrollContent: {
    paddingHorizontal: 2,
    gap: 10,
  },
  viewerAuthorityCard: {
    width: 152,
    minHeight: 40,
    borderRadius: 15,
    paddingHorizontal: 11,
    paddingVertical: 4,

    borderTopWidth: 0.6,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.090)",
    justifyContent: "center",
    overflow: "hidden",
  },
  viewerAuthorityLabel: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 7.8,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 1,
    lineHeight: 7,
  },
  viewerAuthorityValue: {
    color: "#DCE9FF",
    fontSize: 10.5,
    fontWeight: "900",
    maxWidth: 310,
    letterSpacing: -0.15,
    lineHeight: 13,
  },
  authorityBarTop: {
    flexDirection: "row",
    gap: 6,
  },
  authorityBarBottom: {
    flexDirection: "row",
    gap: 6,
  },
  authorityInfoPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.085)",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  authorityInfoPillWide: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(110,160,255,0.32)",
    shadowColor: "#000",
    shadowOpacity: 0.42,
    shadowRadius: 18,
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  authorityLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 7,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  authorityValue: {
    color: "#DCE9FF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.1,
  },
  authorityValueWarn: {
    color: "#FCD34D",
  },
  authorityValueDanger: {
    color: "#FCA5A5",
  },
  authorityValueOvertime: {
    color: "#FB7185",
  },
  nextSpeakerPopup: {
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(16,185,129,0.12)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
  },
  nextSpeakerPopupWarn: {
    backgroundColor: "rgba(245,158,11,0.16)",
    borderColor: "rgba(245,158,11,0.34)",
  },
  nextSpeakerPopupDanger: {
    backgroundColor: "rgba(255,75,108,0.16)",
    borderColor: "rgba(255,75,108,0.36)",
  },
  nextSpeakerPopupOvertime: {
    backgroundColor: "rgba(127,29,29,0.28)",
    borderColor: "rgba(255,75,108,0.44)",
  },
  nextSpeakerDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#10B981",
  },
  nextSpeakerDotWarn: {
    backgroundColor: "#F59E0B",
  },
  nextSpeakerDotDanger: {
    backgroundColor: "#FB7185",
  },
  nextSpeakerDotOvertime: {
    backgroundColor: "#EF4444",
  },
  nextSpeakerText: {
    flex: 1,
    color: "#86EFAC",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  authorityActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  authorityBtn: {
    minWidth: 110,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  authorityBtnActive: {
    backgroundColor: "rgba(16,185,129,0.16)",
    borderColor: "rgba(16,185,129,0.38)",
  },
  authorityBtnWarn: {
    backgroundColor: "rgba(245,158,11,0.16)",
    borderColor: "rgba(245,158,11,0.34)",
  },
  authorityBtnBlue: {
    backgroundColor: "rgba(56,189,248,0.14)",
    borderColor: "rgba(56,189,248,0.34)",
  },
  authorityBtnDanger: {
    backgroundColor: "rgba(255,75,108,0.14)",
    borderColor: "rgba(255,75,108,0.34)",
  },
  authorityBtnText: {
    color: "#DCE9FF",
    fontSize: 13,
    fontWeight: "800",
  },

  mediaLiveTopCard: {
    flex: 1,
    minHeight: 64,
    maxHeight: 72,
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(5,10,19,0.72)",
    borderWidth: 1.25,
    borderColor: "rgba(243,210,143,0.34)",
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  mediaLiveHeaderGlow: {
    position: "absolute",
    right: -18,
    top: -30,
    width: 170,
    height: 120,
    borderRadius: 999,
    backgroundColor: "rgba(243,210,143,0.09)",
  },
  mediaLiveBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,8,23,0.54)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  mediaLiveTopTitle: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1.08,
    textShadowColor: "rgba(0,0,0,0.38)",
    textShadowRadius: 8,
  },
  mediaLiveTopAvatar: {
    width: 40,
    height: 40,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,5,5,0.94)",
    borderWidth: 1.55,
    borderColor: "#F3D28F",
    elevation: 16,
    shadowOffset: { width: 0, height: -6 },
  },
  mediaLiveTopAvatarText: {
    color: "#F3D28F",
    fontSize: 19,
    fontWeight: "900",
  },
  mediaLiveHeaderInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 14,
  },
  mediaLiveAvatar: {
    width: 60,
    height: 60,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(243,210,143,0.17)",
    borderWidth: 1.7,
    borderColor: "rgba(243,210,143,0.82)",
  },
  mediaIdentityBadge: {
    position: "absolute",
    left: 22,
    right: 18,
    top: 48,
    minHeight: 64,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 4,

    borderTopWidth: 0.6,
    borderTopColor: "rgba(255,255,255,0.08)",
    zIndex: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(3,10,24,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.6)",
    shadowOffset: { width: 0, height: 6 },
  },

  mediaHeaderBackBtn: {
    width: 48,
    height: 48,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: "rgba(0,8,22,0.82)",
    shadowOffset: { width: 0, height: 3 },
    borderWidth: 1.4,
    borderColor: "rgba(244,201,93,0.92)",
    zIndex: 20,
  },

  mediaHeaderBackBtnPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },


  mediaIdentitySubRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    alignSelf: "flex-start",
  },

  mediaIdentityMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  mediaIdentityViewsMini: {
    alignSelf: "center",
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 26,
    borderRadius: 999,

    backgroundColor: "rgba(8,12,20,0.75)",

    borderWidth: 1,
    borderColor: "#CDAA4A",
    shadowOffset: { width: 0, height: 0 },

    elevation: 6,
  },

  mediaIdentityViewsText: {
    color: "#F4C95D",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 20,
  },

  mediaIdentityAvatarWrap: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },

  mediaIdentityWaveOuter: {
    position: "absolute",
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: "rgba(34,197,94,0.18)",
    shadowOffset: { width: 0, height: 0 },
  },

  mediaIdentityWaveInner: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: "rgba(34,197,94,0.34)",
    shadowOffset: { width: 0, height: 0 },
  },

  mediaIdentityAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 0,
    backgroundColor: "rgba(3,9,24,1)",
    borderWidth: 3,
    borderColor: "rgba(244,201,93,0.98)",
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },

  mediaIdentityAvatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },

  mediaIdentityTextBox: {
    flex: 1,
    minWidth: 0,
  },

  mediaIdentityCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },

  mediaIdentityName: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.25,
    lineHeight: 28,
    maxWidth: 330,
  },

  mediaLiveDot: {
    display: "none",
  },

  mediaIdentitySub: {
    display: "none",
  },

  mediaLiveAvatarText: {
    color: "#F3D28F",
    fontSize: 25,
    fontWeight: "900",
  },
  mediaLiveTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  mediaLiveTitle: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  mediaLiveSub: {
    marginTop: 2,
    color: "rgba(255,255,255,0.72)",
    fontSize: 17,
    fontWeight: "800",
  },
  livePill: {
    height: 44,
    borderRadius: 999,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(129,25,52,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,65,108,0.48)",
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  liveDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: "#FF4B6E",
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },

  livePillText: { color: "#DCE9FF", fontSize: 13, fontWeight: "900", letterSpacing: 0.2 },

  
  
  
  
  
  
  
  
  
  
  
  


  realFeelHudLayer: {
    position: "absolute",
    left: 34,
    right: 34,
    top: 238,
    zIndex: 150,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  realFeelLiveBadge: {
    height: 54,
    minWidth: 168,
    borderRadius: 24,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(172,38,58,0.92)",
    borderWidth: 2,
    borderColor: "rgba(255,116,139,0.95)",
    shadowOffset: { width: 0, height: 7 },
    elevation: 12,
  },
  realFeelPulseRing: {
    position: "absolute",
    left: 16,
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.38)",
  },
  realFeelLiveDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
  },
  realFeelLiveText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 4,
  },
  realFeelViewerBadge: {
    height: 52,
    minWidth: 176,
    borderRadius: 24,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(13,18,30,0.86)",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.18)",
  },
  realFeelViewerText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  joinRequestSlideCard: {
    position: "absolute",
    left: 28,
    right: 28,
    top: "64.8%",
    height: 74,
    borderRadius: 28,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 156,
    overflow: "hidden",
    backgroundColor: "#071226",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.55)",
    elevation: 14,
  },
  joinRequestAvatar: {
    width: 58,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A2742",
    borderWidth: 1.6,
    borderColor: "#D9B35F",
  },
  joinRequestAvatarText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  joinRequestCopy: {
    flex: 1,
    minWidth: 0,
  },
  joinRequestTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  joinRequestSub: {
    marginTop: 2,
    color: "#B8C2D9",
    fontSize: 13,
    fontWeight: "800",
  },
  joinRequestGlowDot: {
    position: "absolute",
    left: -28,
    top: -22,
    width: 88,
    height: 88,
    borderRadius: 999,
    backgroundColor: "rgba(244,201,93,0.14)",
  },
  joinRequestTopLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  joinRequestKicker: {
    color: "#F4C95D",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  joinRequestActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  joinRequestApproveBtn: {
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4C95D",
    marginTop: 0,
  },
  joinRequestDeclineBtn: {
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    marginTop: 0,
  },
  joinRequestStatusPill: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.34)",
  },

  cleanFocusStage: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },

  liveBadge: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: "#E11D2E",
    alignItems: "center",
    justifyContent: "center",
  },

  liveBadgeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },

  liveViewers: {
    marginLeft: 12,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },

  liveDots: {
    marginLeft: "auto",
    width: 40,
    height: 40,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  liveDotsText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: -1,
  },

  liveStagePreview: {
    position: "absolute",
    left: 20,
    right: 20,
    top: "36%",
    alignItems: "center",
    justifyContent: "center",
  },

  liveStageTitle: {
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  liveStageSub: {
    marginTop: 2,
    color: "rgba(255,255,255,0.82)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 3,
  },

  liveActionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)",
    alignItems: "center",
    justifyContent: "center",
  },

  liveActionMain: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderColor: "#FF0A78",
    backgroundColor: "rgba(255,10,120,0.20)",
  },

  liveCountPill: {
    height: 48,
    minWidth: 84,
    borderRadius: 24,
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.32)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },

  liveCountText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },

  soloVideoCard: {
    flex: 1,
    backgroundColor: "#020817",
  },

  soloCamera: {
    ...StyleSheet.absoluteFillObject,
  },

  soloCameraFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#080A10",
  },

  soloStatsRow: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },

  soloStatPill: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 20,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,12,16,0.54)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },

  soloStatPillActive: {
    borderColor: "rgba(244,201,93,0.58)",
    backgroundColor: "rgba(244,201,93,0.12)",
  },

  soloStatText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },

  soloStatTextActive: {
    color: "#F4C95D",
  },

  videoCard: {
    flex: 1,
    borderRadius: 0,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 0,
    marginTop: 0,
    marginBottom: 0,
    elevation: 0,
  },
  camera: { flex: 1 },
  topOverlayRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topOverlay: {
    position: "absolute",
    top: 16,
    left: 18,
    right: 18,
    zIndex: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,

    backgroundColor: "rgba(15,23,42,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  countBadge: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 68,
    gap: 6,

    backgroundColor: "rgba(15,23,42,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },
  badgeText: { color: "#DCE9FF", fontSize: 13, fontWeight: "800", letterSpacing: 0.1 },
  hostBadge: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(8,17,32,0.68)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  hostBadgeText: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },


  titleCard: {
    position: "absolute",
    top: 92,
    left: 18,
    maxWidth: "56%",
    backgroundColor: "rgba(10,16,28,0.62)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    paddingHorizontal: 15,
    paddingVertical: 11,
    zIndex: 5,
  },
  videoTitle: {
    color: "#DCE9FF",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 3,
    letterSpacing: -0.35,
  },
  cameraFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,10,20,0.72)",
    borderRadius: 24,
  },
  hostFallbackCard: {
    width: "72%",
    maxWidth: 340,
    minHeight: 220,
    borderRadius: 28,
    padding: 22,
    justifyContent: "space-between",
    backgroundColor: "rgba(7,16,40,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowOffset: { width: 0, height: 12 },
  },
  hostFallbackAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.40)",
  },
  hostFallbackAvatarText: {
    color: "#DCE9FF",
    fontSize: 28,
    fontWeight: "800",
  },
  hostFallbackMeta: {
    gap: 6,
  },
  hostFallbackName: {
    color: "#DCE9FF",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  hostFallbackRole: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 16,
    fontWeight: "700",
  },
  hostFallbackLivePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,77,109,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,77,109,0.28)",
  },
  hostFallbackLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ff4d6d",
  },
  hostFallbackLiveText: {
    color: "#ff6b8a",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  cameraFallbackText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "700",
  },
  splitCameraFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,10,20,0.72)",
    borderRadius: 20,
  },
  grid3HostCameraFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,10,20,0.72)",
    borderRadius: 24,
  },

  videoMeta: {
    color: "#FF4B6E",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.45,
    lineHeight: 15,
  },


  viewerFlowEdgeHandle: {
    position: "absolute",
    right: 0,
    top: 120,
    bottom: 120,
    width: 26,
    zIndex: 99999,
    elevation: 99999,
  },

  viewerFlowScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.06)",
    zIndex: 99990,
    elevation: 99990,
  },
  viewerFlowPanel: {
  position: "absolute",
  right: 14,
  top: 92,
  bottom: 92,
  width: 310,
  paddingTop: 10,
  paddingHorizontal: 14,
  paddingBottom: 12,
  backgroundColor: "rgba(3,9,20,0.968)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.10)",
  borderRadius: 30,
  shadowOffset: { width: -6, height: 0 },
  elevation: 99999,
  zIndex: 99999,
},
  viewerFlowHandle: {
  alignSelf: "center",
  width: 58,
  height: 6,
  borderRadius: 999,
  backgroundColor: "rgba(255,255,255,0.34)",
  marginBottom: 14,
},
  viewerFlowTitle: {
  color: "#DCE9FF",
  fontSize: 18,
  fontWeight: "900",
  letterSpacing: -0.3,
  lineHeight: 25,
},
  viewerFlowSub: {
  marginTop: 4,
  marginBottom: 12,
  color: "rgba(255,255,255,0.56)",
  fontSize: 11,
  fontWeight: "700",
},
  viewerFlowSummaryRow: {
  flexDirection: "row",
  gap: 10,
  marginBottom: 12,
},
  viewerFlowSummaryCard: {
  flex: 1,
  minHeight: 78,
  borderRadius: 20,
  paddingHorizontal: 14,
  paddingVertical: 12,
  backgroundColor: "rgba(255,255,255,0.34)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.085)",
  justifyContent: "center",
},
  viewerFlowSummaryLabel: {
  color: "rgba(255,255,255,0.40)",
  fontSize: 6.5,
  fontWeight: "800",
  letterSpacing: 1.8,
  marginBottom: 6,
},
  viewerFlowSummaryValue: {
  color: "#DCE9FF",
  fontSize: 15,
  fontWeight: "900",
  letterSpacing: -0.18,
  lineHeight: 18,
},
  viewerFlowScrollContent: {
  paddingBottom: 132,
  gap: 12,
},
  viewerFlowItem: {
  borderRadius: 22,
  paddingHorizontal: 14,
  paddingVertical: 13,
  backgroundColor: "rgba(255,255,255,0.34)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.065)",
  gap: 6,
},
  viewerFlowItemCurrent: {
  backgroundColor: "rgba(16,185,129,0.12)",
  borderColor: "rgba(16,185,129,0.34)",
},
  viewerFlowItemNext: {
  backgroundColor: "rgba(56,189,248,0.10)",
  borderColor: "rgba(56,189,248,0.28)",
},
  viewerFlowItemTop: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
},
  viewerFlowSlot: {
  color: "rgba(255,255,255,0.55)",
  fontSize: 10,
  fontWeight: "800",
  letterSpacing: 0.8,
},
  viewerFlowItemTitle: {
  color: "#DCE9FF",
  fontSize: 14,
  fontWeight: "900",
  letterSpacing: -0.18,
  lineHeight: 17,
},
  viewerFlowItemMeta: {
  color: "rgba(255,255,255,0.80)",
  fontSize: 9,
  fontWeight: "800",
  lineHeight: 12,
},
  viewerFlowItemSub: {
  color: "rgba(255,255,255,0.54)",
  fontSize: 8,
  fontWeight: "700",
  lineHeight: 10,
},
  viewerFlowMiniBadge: {
  minHeight: 26,
  paddingHorizontal: 10,
  borderRadius: 999,
  alignItems: "center",
  justifyContent: "center",
},
  viewerFlowMiniBadgeLive: {
    backgroundColor: "rgba(16,185,129,0.20)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.42)",
  },
  viewerFlowMiniBadgeNext: {
    backgroundColor: "rgba(56,189,248,0.18)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.38)",
  },
  viewerFlowMiniBadgeText: {
  color: "#DCE9FF",
  fontSize: 9,
  fontWeight: "900",
  letterSpacing: 0.9,
},

  audiencePanelScroll: {
    gap: 12,
  },
  audiencePanelEyebrow: {
    color: "rgba(125,211,252,0.82)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  audiencePanelTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
    lineHeight: 26,
    marginBottom: 4,
  },
  audiencePanelHero: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(14,36,64,0.88)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
    gap: 6,
  },
  audiencePanelHeroLive: {
    borderColor: "rgba(167,139,250,0.45)",
    backgroundColor: "rgba(14,36,64,0.94)",
  },
  audiencePanelHeroBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  audiencePanelHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  audiencePanelHeroSlot: {
    color: "#A78BFA",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  audiencePanelHeroTopic: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
  },
  audiencePanelHeroMeta: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "700",
  },
  audiencePanelStatusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  audiencePanelStatusText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  audiencePanelBlock: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 8,
  },
  audiencePanelBlockLabel: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  audiencePanelSpeakerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  audiencePanelSpeakerName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  audiencePanelSpeakerTopic: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "700",
  },
  audiencePanelSpeakerMeta: {
    color: "rgba(125,211,252,0.72)",
    fontSize: 10,
    fontWeight: "800",
  },
  audiencePanelEmpty: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    fontWeight: "700",
  },
  audiencePanelStatCard: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(14,36,64,0.72)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.28)",
    gap: 4,
  },
  audiencePanelStatValue: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
  },
  audiencePanelClaimRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  audiencePanelClaimBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.55)",
  },
  audiencePanelClaimBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  audiencePanelClaimBtnText: {
    color: "#F4D06F",
    fontSize: 12,
    fontWeight: "900",
  },
  audiencePanelCloseBtn: {
    marginTop: 4,
    height: 48,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(170,14,28,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,72,88,0.72)",
  },
  audiencePanelCloseBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  audiencePanelCloseBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  audiencePanelSectionWrap: {
    gap: 8,
  },
  audiencePanelMicSection: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(14,36,64,0.72)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
    gap: 8,
  },
  audiencePanelMicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  audiencePanelMicText: {
    flex: 1,
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  audiencePanelActionsWrap: {
    gap: 10,
    marginTop: 4,
  },
  audiencePanelActionBtnWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
  },
  audiencePanelSecondaryBtn: {
    height: 44,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  audiencePanelSecondaryBtnText: {
    color: "#DCE9FF",
    fontSize: 13,
    fontWeight: "800",
  },

  controlsWrap: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 30,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: "transparent",
    zIndex: 80,
  },

  viewerActionWrap: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 8,
    flexDirection: "row",
    gap: 12,
    zIndex: 50,
  },
  viewerActionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.34)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  viewerActionBtnPrimary: {
    backgroundColor: "rgba(16,185,129,0.16)",
    borderColor: "rgba(16,185,129,0.34)",
  },
  viewerActionBtnText: {
    color: "#DCE9FF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  hostControlsRow: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 154,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 34,
  },

  hostControlCard: {
    width: "22%",
    height: 62,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(8,8,14,0.34)",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },

  hostControlCardActive: {
    borderColor: "rgba(255,0,128,0.62)",
    backgroundColor: "rgba(255,0,128,0.08)",
  },

  hostControlText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },

  hostControlTextActive: {
    color: "#FF0A78",
  },

  controlsRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
  },
  ctrlBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    maxHeight: 58,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    backgroundColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 4,
    paddingBottom: 4,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  ctrlBtnWide: {
    flex: 1.02,
  },

  ctrlBtnCompact: {
    flex: 0.82,
  },

  ctrlBtnHalf: {
    flex: 0.86,
  },
  ctrlBtnLabel: {
    color: "rgba(255,255,255,0.98)",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: 0.1,
  },
  ctrlBtnActive: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  ctrlBtnWarn: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  ctrlBtnRing: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderRadius: 18,
  },
  ctrlBtnMoreRing: {
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.70)",
    backgroundColor: "rgba(20,12,32,0.56)",
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  ctrlBtnLiveRed: {
    backgroundColor: "rgba(220,38,38,0.96)",
    borderColor: "rgba(255,120,120,0.22)",
    borderWidth: 1,
    borderRadius: 18,
    minHeight: 46,
    maxHeight: 46,
    paddingBottom: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  ctrlBtnGlassOff: {
    backgroundColor: "rgba(255,255,255,0.34)",
    borderColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderRadius: 18,
    minHeight: 46,
    maxHeight: 46,
    paddingBottom: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  ctrlBtnLabelWhiteStrong: {
    color: "#DCE9FF",
    fontSize: 8,
    fontWeight: "900",
    marginTop: 2,
    letterSpacing: 0.15,
  },
  endBtn: {
    backgroundColor: "rgba(185,28,28,0.96)",
    borderColor: "rgba(255,120,120,0.18)",
    borderWidth: 1,
    borderRadius: 18,
    minHeight: 46,
    maxHeight: 46,
    paddingBottom: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },

  layoutFocusWrap: {
    position: "absolute",
    top: 220,
    left: 16,
    right: 16,
    bottom: 138,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  focusHostCard: {
    position: "absolute",
    left: 18,
    bottom: 118,
    width: "58%",
    minHeight: 170,
    borderRadius: 28,
    padding: 20,
    justifyContent: "space-between",
    backgroundColor: "rgba(7,16,40,0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    zIndex: 5,
  },
  focusHostAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
  },
  focusHostAvatarText: {
    color: "#DCE9FF",
    fontSize: 24,
    fontWeight: "800",
  },
  focusHostMeta: {
    gap: 4,
  },
  focusHostName: {
    color: "#DCE9FF",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  focusHostRole: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 15,
    fontWeight: "700",
  },
  focusHostLivePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,77,109,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,77,109,0.28)",
  },
  focusHostLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ff4d6d",
  },
  focusHostLiveText: {
    color: "#ff6b8a",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  focusMainCard: {
    width: "60%",
    minHeight: 124,
    maxHeight: 150,
    alignSelf: "flex-end",
    marginRight: 12,
    borderRadius: 24,
    backgroundColor: "rgba(8,17,32,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    justifyContent: "flex-end",
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  focusMainName: {
    color: "#DCE9FF",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  focusMainRole: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  focusRail: {
    width: 108,
    justifyContent: "flex-end",
    gap: 10,
  },
  focusThumb: {
    height: 64,
    borderRadius: 22,
    backgroundColor: "rgba(8,17,32,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    justifyContent: "center",
    paddingHorizontal: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  focusThumbName: {
    color: "#DCE9FF",
    fontSize: 12,
    fontWeight: "800",
  },

  splitStageBg: {
    flex: 1,
    backgroundColor: "#060D18",
  },
  splitStageGlowTop: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.04)",
    top: -90,
    left: -50,
  },
  splitStageGlowBottom: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "rgba(65,105,225,0.06)",
    bottom: -120,
    right: -80,
  },
  splitStageCenterLine: {
    position: "absolute",
    top: 130,
    bottom: 110,
    left: "50%",
    width: 1,
    marginLeft: -0.5,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  layoutSplitWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 130,
    bottom: 138,
    zIndex: 2,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  splitCard: {
    flex: 1,
    height: "46%",
    minHeight: 350,
    maxHeight: 560,
    borderRadius: 38,
    overflow: "hidden",
    backgroundColor: "rgba(8,17,32,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    justifyContent: "flex-end",
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  splitCamera: {
    ...StyleSheet.absoluteFillObject,
  },
  splitHostShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.03)",
  },
  splitGuestFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,20,40,0.96)",
  },
  splitGuestGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.18)",
    top: -26,
    left: -26,
  },
  splitGuestGlow2: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(80,120,255,0.14)",
    bottom: -20,
    right: -20,
  },
  splitGuestMesh: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  splitGuestAvatarWrap: {
    position: "absolute",
    top: "21%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  splitGuestAvatarRing: {
    width: 96,
    height: 96,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  splitGuestAvatarCore: {
    width: 74,
    height: 74,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  splitGuestAvatarText: {
    color: "#DCE9FF",
    fontSize: 18,
    fontWeight: "800",
  },
  splitLabel: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
  },
  splitLabelTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  splitStatusMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  gridLabelTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  gridStatusMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  liveStateMiniBadge: {
    minHeight: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderColor: "rgba(255,255,255,0.14)",
  },
  liveStateMiniBadgeCurrent: {
    backgroundColor: "rgba(16,185,129,0.18)",
    borderColor: "rgba(16,185,129,0.42)",
  },
  liveStateMiniBadgeNext: {
    backgroundColor: "rgba(56,189,248,0.16)",
    borderColor: "rgba(56,189,248,0.40)",
  },
  liveStateMiniBadgeOnStage: {
    backgroundColor: "rgba(217,179,95,0.16)",
    borderColor: "rgba(217,179,95,0.40)",
  },
  liveStateMiniBadgeMuted: {
    backgroundColor: "rgba(255,75,108,0.14)",
    borderColor: "rgba(255,75,108,0.34)",
  },
  liveStateMiniBadgeText: {
    color: "#DCE9FF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  liveTileToneCurrent: {
    borderWidth: 2.4,
    borderColor: "#F4D06F",
    backgroundColor: "rgba(244,208,111,0.16)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  liveTileToneNext: {
    borderColor: "rgba(56,189,248,0.48)",
    backgroundColor: "rgba(90,140,255,0.18)",
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  liveTileToneOnStage: {
    borderWidth: 2.4,
    borderColor: "#E6C15A",
    backgroundColor: "rgba(217,179,95,0.10)",
    shadowColor: "#E6C15A",
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  liveTileToneMuted: {
    opacity: 0.58,
    borderColor: "rgba(255,75,108,0.42)",
    backgroundColor: "rgba(255,75,108,0.08)",
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  splitRolePill: {
    alignSelf: "flex-start",
    minHeight: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,17,32,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },
  splitRolePillText: {
    color: "rgba(255,255,255,0.80)",
    fontSize: 10,
    fontWeight: "800",
  },
  splitName: {
    color: "#DCE9FF",
    fontSize: 24,
    fontWeight: "800",
  },
  splitRole: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  splitGuestTopRow: {
    position: "absolute",
    top: 14,
    left: 18,
    right: 18,
    zIndex: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  splitGuestStatusPill: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,17,32,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginRight: 8,
  },
  splitGuestStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#22c55e",
  },
  splitGuestStatusDotMuted: {
    backgroundColor: "#ef4444",
  },
  splitGuestStatusText: {
    color: "#DCE9FF",
    fontSize: 10,
    fontWeight: "800",
  },
  splitGuestActions: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    minWidth: 84,
    marginBottom: 6,
  },
  splitGuestActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,17,32,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginLeft: 2,
  },
  splitGuestActionBtnDanger: {
    backgroundColor: "rgba(127,29,29,0.82)",
    borderColor: "rgba(239,68,68,0.30)",
  },
  layoutGridWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 56,
    bottom: 138,
    zIndex: 2,
    display: "flex",
  },
  grid3Card: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    justifyContent: "flex-end",
    padding: 16,
    backgroundColor: "rgba(12,20,36,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  grid3CardMain: {
    flex: 6,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "rgba(10,22,44,0.92)",
  },
  grid3CardSmall: {
    flex: 1,
  },
  grid3BottomRow: {
    flex: 4,
    flexDirection: "row",
    gap: 12,
  },
  grid3HostCamera: {
    ...StyleSheet.absoluteFillObject,
  },
  grid3HostShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  gridGuestFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20,30,50,0.96)",
  },
  gridGuestGlow: { display: "none" },
  gridGuestGlow2: { display: "none" },
  gridGuestMesh: { display: "none" },
  gridGuestAvatarWrap: {
    position: "absolute",
    top: "22%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  gridGuestAvatarRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  gridGuestAvatarCore: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  gridGuestAvatarText: {
    color: "#DCE9FF",
    fontSize: 18,
    fontWeight: "800",
  },
  gridLabel: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 14,
  },
  gridRolePill: {
    alignSelf: "flex-start",
    minHeight: 20,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,17,32,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },
  gridRolePillText: {
    color: "#DCE9FF",
    fontSize: 10,
    fontWeight: "800",
  },
  gridNameBig: {
    color: "#DCE9FF",
    fontSize: 24,
    fontWeight: "800",
  },
  gridName: {
    color: "#DCE9FF",
    fontSize: 18,
    fontWeight: "800",
  },
  gridRole: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },





  teamGridCamera: {
    flex: 1,
    width: "100%",
    height: "100%",
    transform: [{ scale: 1.03 }],
  },

  teamGridLiveStage: {
    position: "absolute",
    left: "22.9%",
    right: "24.4%",
    top: "16.7%",
    height: "40.9%",
    borderRadius: 28,
    overflow: "hidden",
    zIndex: 35,
    backgroundColor: "#000",
  },

  teamGridLiveCamera: {
    flex: 1,
    width: "100%",
    height: "100%",
  },

  teamGridLiveFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#070B16",
  },

  livePausedWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  livePausedTitle: {
    marginTop: 12,
    color: "#F4C95D",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  livePausedSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },

  bigStageProfileWrap: {
    width: 118,
    height: 118,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 2,
    borderColor: "rgba(244,201,93,0.85)",
    marginBottom: 14,
  },

  bigStageProfileImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },

  bigStageCompactName: {
    color: "#F4D06F",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  teamGridLiveFallbackText: {
    marginTop: 8,
    color: "rgba(255,226,160,0.88)",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  teamGridOverlayLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 20,
  },
  upperBookRequestLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 23,
  },
  upperBookRequestScreen: {
    position: "absolute",
    width: 72,
    height: 106,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "rgba(0,9,28,0.995)",
    borderWidth: 1.45,
    borderColor: "rgba(255,236,170,1)",
    shadowOffset: { width: 0, height: 6 },
    elevation: 20,
  },
  upperBookRequestLeft: {
    left: "2.4%",
  },
  upperBookRequestRight: {
    right: "2.4%",
  },
  upperBookRequestTop: {
    top: "29.2%",
  },
  upperBookRequestBottom: {
    top: "42.4%",
  },

  upperBookRequestMiniCamera: {
    ...StyleSheet.absoluteFillObject,
  },

  upperBookRequestVideoPreview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,8,24,0.95)",
  },
  upperBookRequestMutedText: {
    marginTop: 5,
    color: "#F4C95D",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  upperBookRequestLivePill: {
    position: "absolute",
    left: 9,
    right: 9,
    bottom: 7,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,8,22,0.72)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.78)",
  },


  upperBookSlotBadge: { display: "none" },
  upperBookSlotBadgeText: { display: "none" },


  slotOrbitInnerRing: {
    display: "none",
  },

  slotOrbitAvatarRing: {
    display: "none",
  },

  upperBookRequestPressed: {
    opacity: 0.58,
    transform: [{ scale: 0.97 }],
  },
  upperBookRequestGlow: {
    display: "none",
  },
  upperBookRequestCurveTop: {
    display: "none",
  },
  upperBookRequestCurveBottom: {
    display: "none",
  },
  upperBookRequestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,17,31,0.96)",
    borderWidth: 1.8,
    borderColor: "rgba(255,226,132,0.98)",
    marginTop: -1,
  },
  upperBookRequestProfileImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },

  upperBookRequestInitial: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  upperBookRequestBadge: {
    position: "absolute",
    left: 5,
    bottom: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  upperBookRequestDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#35E6A9",
  },
  upperBookRequestText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },

  teamGridMiniCard: {
    position: "absolute",
    height: 58,
    width: "38.5%",
    borderRadius: 22,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(1,18,48,0.96)",
    borderWidth: 1.25,
    borderColor: "rgba(255,226,140,0.9)",
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },

  teamGridMiniCardLeft: {
    left: "7.4%",
  },

  teamGridMiniCardRight: {
    right: "9.0%",
  },

  teamGridMiniCardRowOne: {
    top: "75.85%",
  },

  teamGridMiniCardRowTwo: {
    top: "83.7%",
  },

  teamGridRequestAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,226,140,0.14)",
    borderWidth: 1.4,
    borderColor: "rgba(255,226,140,0.88)",
  },
  teamGridRequestAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },


  bigStageSlotPill: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.32)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.88)",
  },

  bigStageSlotPillText: {
    color: "#F4D06F",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },

  teamGridRequestAvatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  teamGridRequestTextArea: {
    flex: 1,
    marginLeft: 10,
    justifyContent: "center",
  },
  teamGridRequestName: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  teamGridRequestStatus: {
    marginTop: 3,
    color: "rgba(255,226,140,0.78)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  teamGridRequestStatusApproved: {
    color: "#35E6A9",
  },

  teamGridMiniAvatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 2,
    borderColor: "rgba(244,201,93,0.92)",
    marginRight: 0,
  },


  teamGridMiniAvatarInner: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#102A52",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.30)",
  },

  teamGridMiniAvatarRingGold: {
    borderColor: "rgba(244,201,93,0.92)",
    backgroundColor: "rgba(244,201,93,0.10)",
  },

  teamGridMiniAvatarRingBlue: {
    borderColor: "rgba(244,201,93,0.92)",
    backgroundColor: "rgba(244,201,93,0.10)",
  },

  teamGridMiniAvatarRingPurple: {
    borderColor: "rgba(244,201,93,0.92)",
    backgroundColor: "rgba(244,201,93,0.10)",
  },

  teamGridMiniAvatarRingRose: {
    borderColor: "rgba(244,201,93,0.92)",
    backgroundColor: "rgba(244,201,93,0.10)",
  },

  teamGridMiniAvatarInnerGold: {
    backgroundColor: "#102A52",
    borderColor: "rgba(244,201,93,0.30)",
  },

  teamGridMiniAvatarInnerBlue: {
    backgroundColor: "#102A52",
    borderColor: "rgba(244,201,93,0.30)",
  },

  teamGridMiniAvatarInnerPurple: {
    backgroundColor: "#102A52",
    borderColor: "rgba(244,201,93,0.30)",
  },

  teamGridMiniAvatarInnerRose: {
    backgroundColor: "#102A52",
    borderColor: "rgba(244,201,93,0.30)",
  },

  teamGridMiniAvatarText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.1,
  },

  teamGridMiniTextArea: {
    display: "none",
  },

  teamGridMiniNameBar: {
    display: "none",
  },

  teamGridMiniRoleBar: {
    display: "none",
  },

  vuguTeamGridImage: {
    position: "absolute",
    left: -16,
    right: -20,
    top: 0,
    bottom: 18,
    width: "105%",
    height: "97.2%",
    alignSelf: "center",
    transform: [{ translateX: 4 }],
    zIndex: 4,
    backgroundColor: "transparent",
  },

  audience20Image: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 34,
    bottom: -10,
    width: "97%",
    height: "98%",
    zIndex: 4,
    backgroundColor: "#000",
  },

  audience20Wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 86,
    bottom: 138,
    zIndex: 3,
    borderRadius: 30,
    padding: 14,
    backgroundColor: "rgba(5,10,24,0.86)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.24)",
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  audience20Header: {
    minHeight: 48,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  audience20Kicker: {
    color: "rgba(255,230,163,0.72)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  audience20Title: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.2,
    marginTop: 2,
  },
  audience20Pill: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(244,201,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.30)",
  },
  audience20PillText: {
    color: "#FFE6A3",
    fontSize: 11,
    fontWeight: "900",
  },
  audience20Grid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignContent: "space-between",
  },
  audience20Cell: {
    width: "18.4%",
    height: "18.2%",
    minHeight: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.095)",
  },
  audience20Avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.26)",
  },

  ctrlBtnGold: {
    backgroundColor: "rgba(217,179,95,0.96)",
    borderColor: "rgba(255,225,155,0.20)",
    borderWidth: 1,
    borderRadius: 15,
    minHeight: 40,
    maxHeight: 40,
    paddingBottom: 0,
  },
  ctrlBtnLabelDark: {
    color: "#0B0F17",
    fontSize: 7,
    fontWeight: "800",
    marginTop: 1,
  },

  layoutGrid4Wrap: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 220,
    height: 220,
    zIndex: 2,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignContent: "space-between",
  },
  grid4Card: {
    width: "48.3%",
    height: 104,
    borderRadius: 18,
    backgroundColor: "rgba(8,17,32,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "flex-end",
    padding: 12,
    marginBottom: 8,
  },
  grid4Name: {
    color: "#DCE9FF",
    fontSize: 17,
    fontWeight: "800",
  },
  grid4Role: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },

  layoutDuoPlusWrap: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 218,
    height: 226,
    zIndex: 2,
  },
  layoutDuoPlusTop: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
    height: 150,
  },
  duoPlusBigCard: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "rgba(8,17,32,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "flex-end",
    padding: 12,
  },
  duoPlusBigName: {
    color: "#DCE9FF",
    fontSize: 18,
    fontWeight: "800",
  },
  duoPlusBigRole: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },

  hostDrawerScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(2,6,18,0.62)",
    zIndex: 70,
  },
  hostDrawer: {
    position: "absolute",
    right: 8,
    top: "12%",
    bottom: 88,
    width: "88%",
    borderRadius: 34,
    backgroundColor: "#060B1A",
    borderWidth: 1.8,
    borderColor: "rgba(217,179,95,0.42)",
    overflow: "hidden",
    zIndex: 140,
    shadowColor: "#D9B35F",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 22,
  },
  hostDrawerScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 12,
  },
  hostDrawerFooter: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 52,
    paddingTop: 14,
    paddingBottom: 120,
    backgroundColor: "rgba(3,11,28,0.975)",
  },
  hostDrawerHandle: {
    alignSelf: "center",
    width: 64,
    height: 6,
    borderRadius: 999,
    marginBottom: 12,
    backgroundColor: "rgba(217,179,95,0.55)",
  },
  hostDrawerEyebrow: {
    color: "#D9B35F",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4.5,
    marginBottom: 10,
    textAlign: "center",
  },
  hcLiveHero: {
    borderRadius: 22,
    padding: 16,
    marginBottom: 4,
    backgroundColor: "rgba(8,32,22,0.96)",
    borderWidth: 1.5,
    borderColor: "rgba(34,197,94,0.55)",
    shadowColor: "#22C55E",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  hcLiveHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  hcLiveHeroKicker: {
    color: "#86EFAC",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
  },
  hcLivePulseDotWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  hcLivePulseDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#22C55E",
  },
  hcLiveHeroBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  hcLiveHeroName: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  hcLiveHeroTopic: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "700",
  },
  hcLiveHeroMeta: {
    color: "rgba(134,239,172,0.88)",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  hcNextCard: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(28,16,48,0.96)",
    borderWidth: 1.4,
    borderColor: "rgba(167,139,250,0.48)",
  },
  hcSectionTitlePurple: {
    color: "#C4B5FD",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 3.2,
    marginBottom: 10,
  },
  hcNextBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  hcNextName: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  hcNextTopic: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "700",
  },
  hcNextMeta: {
    color: "rgba(196,181,253,0.88)",
    fontSize: 11,
    fontWeight: "800",
  },
  hcReadyPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(167,139,250,0.18)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.45)",
  },
  hcReadyPillText: {
    color: "#DDD6FE",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  hcSectionWrap: {
    marginTop: 2,
  },
  hcSpeakerScroll: {
    gap: 10,
    paddingRight: 8,
  },
  hcSpeakerCard: {
    width: 132,
    borderRadius: 18,
    padding: 10,
    backgroundColor: "rgba(24,14,42,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(167,139,250,0.35)",
    gap: 4,
  },
  hcSpeakerName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 6,
  },
  hcSpeakerSlot: {
    color: "#C4B5FD",
    fontSize: 10,
    fontWeight: "800",
  },
  hcSpeakerTopic: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 10,
    fontWeight: "700",
  },
  hcSpeakerStatus: {
    fontSize: 10,
    fontWeight: "900",
    marginTop: 2,
  },
  hcHostSection: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(18,14,8,0.96)",
    borderWidth: 1.4,
    borderColor: "rgba(217,179,95,0.42)",
    gap: 10,
  },
  hcSectionTitleGold: {
    color: "#D9B35F",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 3.2,
  },
  hcHostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  hcHostName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  hcHostRole: {
    color: "rgba(217,179,95,0.88)",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 1,
  },
  hcViewerSection: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(8,18,38,0.96)",
    borderWidth: 1.4,
    borderColor: "rgba(56,189,248,0.42)",
    gap: 10,
  },
  hcViewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hcSectionTitleBlue: {
    color: "#7DD3FC",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 3.2,
  },
  hcViewerLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#38BDF8",
  },
  hcViewerStatsGrid: {
    gap: 8,
  },
  hcViewerStatRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hcViewerStatLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
  },
  hcViewerStatValue: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  hcViewerBreakdownRow: {
    flexDirection: "row",
    gap: 8,
  },
  hcViewerChip: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(14,36,64,0.92)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.28)",
  },
  hcViewerChipValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  hcViewerChipLabel: {
    color: "rgba(125,211,252,0.82)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 2,
  },
  hcQueueSection: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(10,12,24,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.28)",
    gap: 8,
  },
  hcQueueTimelineRow: {
    flexDirection: "row",
    gap: 10,
  },
  hcQueueTimelineRail: {
    width: 18,
    alignItems: "center",
  },
  hcQueueTimelineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.35)",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.65)",
  },
  hcQueueTimelineDotClaimed: {
    backgroundColor: "#A78BFA",
    borderColor: "#DDD6FE",
  },
  hcQueueTimelineLine: {
    flex: 1,
    width: 2,
    marginTop: 4,
    backgroundColor: "rgba(217,179,95,0.25)",
  },
  hcQueueTimelineBody: {
    flex: 1,
    paddingBottom: 10,
  },
  hcQueueTimelineSlot: {
    color: "#D9B35F",
    fontSize: 12,
    fontWeight: "900",
  },
  hcQueueTimelineTime: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 1,
  },
  hcQueueTimelineName: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  hcEmptyText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
  },
  hcActionsWrap: {
    marginTop: 6,
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(217,179,95,0.18)",
  },
  hcActionsGroupTitle: {
    color: "rgba(217,179,95,0.88)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2.8,
    marginTop: 4,
  },
  hcActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  hcActionBtn: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 96,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(12,20,36,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.28)",
  },
  hcActionBtnDanger: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 96,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(48,10,14,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(239,68,68,0.45)",
  },
  hcActionBtnPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  hcActionBtnText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  hcActionBtnDangerText: {
    color: "#FCA5A5",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  hostDrawerTitle: {
    color: "#FFFFFF",
    fontSize: 29,
    fontWeight: "900",
    letterSpacing: -1.1,
    marginBottom: 18,
    textShadowColor: "rgba(255,255,255,0.18)",
    textShadowRadius: 12,
  },
  hostDrawerCard: {
    borderRadius: 25,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.105)",
    shadowOffset: { width: 0, height: 8 },
  },
  hostDrawerCardLabel: {
    color: "rgba(231,196,111,0.92)",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 5.5,
    marginBottom: 9,
    textShadowColor: "rgba(217,179,95,0.24)",
    textShadowRadius: 10,
  },
  hostDrawerCardValue: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.45,
    textShadowColor: "rgba(255,255,255,0.14)",
    textShadowRadius: 10,
  },
  hostDrawerCardValueSecondary: {
    fontSize: 16,
  },
  hostDrawerQueueCard: {
    borderRadius: 28,
    paddingVertical: 15,
    paddingHorizontal: 20,
    marginBottom: 18,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1.25,
    borderColor: "rgba(255,255,255,0.16)",
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  },
  hostDrawerQueueRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.34)",
    marginTop: 6,
  },
  hostDrawerQueueRowActive: {
    backgroundColor: "rgba(217,179,95,0.09)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
  },
  hostDrawerQueueIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
    marginRight: 8,
  },
  hostDrawerQueueIndexText: {
    color: "#DCE9FF",
    fontSize: 10,
    fontWeight: "900",
  },
  hostDrawerQueueBody: {
    flex: 1,
  },
  hostDrawerQueueTitle: {
    color: "#DCE9FF",
    fontSize: 12,
    fontWeight: "800",
  },
  hostDrawerQueueMeta: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 1,
  },
  hostDrawerQueueEmpty: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 0,
  },
  hostDrawerHint: {
    color: "rgba(255,255,255,0.40)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: -8,
    marginBottom: 34,
  },
  hostDrawerActionsScroll: {
    maxHeight: 370,
  },

  hostDrawerActionScroller: {
    paddingTop: 18,
    paddingBottom: 110,
  },

  hostDrawerSectionTitle: {
    width: "100%",
    color: "rgba(231,196,111,0.92)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 4.4,
    marginTop: 14,
    marginBottom: 2,
  },

  layoutStudioOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "flex-end",
  },

  layoutStudioSheet: {
    height: "88%",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    paddingHorizontal: 22,
    paddingTop: 22,
    backgroundColor: "rgba(3,9,24,0.97)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    shadowOffset: { width: 0, height: -10 },
  },

  layoutStudioTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  layoutStudioEyebrow: {
    color: "#E7C46F",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4,
  },

  layoutStudioTitle: {
    marginTop: 8,
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.8,
  },

  layoutStudioCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  layoutStudioSubtitle: {
    marginTop: 8,
    color: "rgba(255,255,255,0.56)",
    fontSize: 13,
    fontWeight: "700",
  },

  layoutStudioScroll: {
    paddingTop: 20,
    paddingBottom: 42,
  },

  layoutStudioSection: {
    color: "rgba(231,196,111,0.92)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4,
    marginTop: 16,
    marginBottom: 10,
  },

  layoutStudioRow: {
    gap: 10,
    paddingRight: 24,
  },

  layoutStudioCard: {
    width: 128,
    minHeight: 136,
    borderRadius: 28,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.86)",
    borderWidth: 1.4,
    borderColor: "rgba(255,255,255,0.15)",
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  layoutStudioCardActive: {
    backgroundColor: "rgba(36,31,19,0.94)",
    borderColor: "rgba(231,196,111,0.86)",
    elevation: 14,
  },

  layoutStudioCardPressed: {
    transform: [{ scale: 0.97 }],
  },

  layoutStudioMini: {
    width: 86,
    height: 58,
    borderRadius: 18,
    padding: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(2,8,23,0.74)",
    borderWidth: 1.3,
    borderColor: "rgba(217,179,95,0.28)",
    overflow: "hidden",
  },

  layoutStudioMiniTile: {
    flex: 1,
    minWidth: "42%",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(231,196,111,0.20)",
  },

  layoutStudioMiniTileTwo: {
    minWidth: "45%",
  },

  layoutStudioMiniTileLead: {
    minWidth: "100%",
    flex: 1.4,
    backgroundColor: "rgba(217,179,95,0.22)",
  },

  layoutStudioMiniTileGrid: {
    minWidth: "42%",
  },

  layoutPreviewHero: {
    flex: 1.55,
    borderRadius: 18,
    backgroundColor: "rgba(217,179,95,0.25)",
    borderWidth: 1,
    borderColor: "rgba(231,196,111,0.30)",
  },

  layoutPreviewSmall: {
    flex: 0.8,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },

  layoutPreviewHalf: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(231,196,111,0.18)",
  },

  layoutPreviewLead: {
    width: "100%",
    flex: 1.3,
    borderRadius: 18,
    backgroundColor: "rgba(217,179,95,0.24)",
    borderWidth: 1,
    borderColor: "rgba(231,196,111,0.28)",
  },

  layoutPreviewHalfSmall: {
    width: "48%",
    flex: 0.85,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },

  layoutPreviewThird: {
    flex: 1,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(231,196,111,0.15)",
  },

  layoutPreviewSide: {
    flex: 0.85,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  layoutPreviewCenter: {
    flex: 1.18,
    borderRadius: 18,
    backgroundColor: "rgba(217,179,95,0.25)",
    borderWidth: 1,
    borderColor: "rgba(231,196,111,0.28)",
  },

  layoutPreviewQuarter: {
    width: "48%",
    flex: 1,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(231,196,111,0.14)",
  },

  layoutPreviewThirdSmall: {
    width: "31%",
    flex: 0.75,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },


  layoutIconSide: {
    width: 25,
    height: 25,
    borderRadius: 999,
    backgroundColor: "#E7C46F",
  },

  layoutIconBigLeft: {
    width: "64%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.34)",
  },

  layoutIconSmallStack: {
    width: "29%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.34)",
  },

  layoutIconTall: {
    width: "46%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.34)",
  },

  layoutIconGridSmall: {
    width: "46%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.34)",
  },

  layoutIconLeadTop: {
    width: 56,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#E7C46F",
  },

  layoutIconBottomHalf: {
    width: 24,
    height: 18,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.56)",
  },

  layoutIconSeat: {
    width: 21,
    height: 21,
    borderRadius: 999,
    backgroundColor: "#E7C46F",
  },

  layoutIconNine: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#E7C46F",
  },

  layoutIconWideTop: {
    width: 64,
    height: 22,
    borderRadius: 999,
    backgroundColor: "#E7C46F",
  },

  layoutIconBottomThird: {
    width: 21,
    height: 18,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.58)",
  },

  layoutIconTinyStack: {
    width: "28%",
    height: "100%",
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.34)",
  },

  layoutStudioCardTitle: {
    marginTop: 10,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.35,
  },

  layoutStudioCardMeta: {
    display: "none",
  },

  layoutStudioSelectedPill: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E7C46F",
    shadowOffset: { width: 0, height: 4 },
  },

  layoutStudioSelectedText: {
    display: "none",
  },

  hostDrawerOpenBtn: {
    width: "30.9%",
    minHeight: 82,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    paddingVertical: 9,
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1.35,
    borderColor: "rgba(255,255,255,0.17)",
    shadowOffset: { width: 0, height: 9 },
    elevation: 8,
  },

  hostDrawerToggleBtn: {
    width: "30.7%",
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    backgroundColor: "rgba(217,179,95,0.075)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },

  hostDrawerActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
    paddingBottom: 18,
  },
  hostDrawerActionBtn: {
    width: "30.6%",
    minHeight: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  hostDrawerDangerBtn: {
    backgroundColor: "rgba(105,12,28,0.40)",
    borderColor: "rgba(255,59,92,0.42)",
    shadowOffset: { width: 0, height: 6 },
  },
  hostDrawerOpenBtnActive: {
    backgroundColor: "rgba(217,179,95,0.13)",
    borderColor: "rgba(231,196,111,0.46)",
  },

  hostDrawerOpenBtnPressed: {
    transform: [{ scale: 0.965 }],
    backgroundColor: "rgba(217,179,95,0.105)",
    borderColor: "rgba(231,196,111,0.34)",
  },

  hostDrawerOpenIcon: {
    textShadowColor: "rgba(231,196,111,0.42)",
    textShadowRadius: 10,
  },

  hostDrawerActionText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    lineHeight: 13,
    letterSpacing: -0.12,
    paddingHorizontal: 2,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowRadius: 6,
  },
  hostDrawerCloseBtn: {
    marginTop: 0,
    minHeight: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  hostDrawerCloseText: {
    letterSpacing: 0.2,
    color: "#DCE9FF",
    fontSize: 16,
    fontWeight: "900",
  },
  layoutDuoPlusBottom: {
    flexDirection: "row",
    gap: 8,
    height: 58,
  },
  duoPlusMiniCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "rgba(8,17,32,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  duoPlusMiniName: {
    color: "#DCE9FF",
    fontSize: 11,
    fontWeight: "800",
  },


  cameraLockedStage: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 84,
    paddingBottom: 84,
    pointerEvents: "none",
  } as ViewStyle,

  cameraLockedGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.08)",
    bottom: 138,
    alignSelf: "center",
  },

  cameraLockedIconWrap: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    marginBottom: 4,
  },

  cameraLockedCard: {
    width: "76%",
    maxWidth: 420,
    minHeight: 250,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(7,12,24,0.92)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 26,
    gap: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  } as ViewStyle,

  cameraLockedTitle: {
    color: "#DCE9FF",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.2,
  },

  cameraLockedText: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 320,
  },

  splitCameraPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.34)",
  } as ViewStyle,

  splitPlaceholderText: {
    color: "#DCE9FF",
    fontWeight: "800",
    marginTop: 8,
  },

  moreBackdrop: {
    flex: 1,
    backgroundColor: "rgba(1,6,18,0.58)",
    justifyContent: "flex-end",
  },

  moreSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "rgba(7,12,24,0.98)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 28,
  },

  moreHandle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.34)",
    marginBottom: 12,
  },

  moreTitle: {
    color: "#DCE9FF",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },

  moreSub: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 12,
  },

  moreGroupTitle: {
    color: "rgba(255,255,255,0.50)",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 6,
    letterSpacing: 0.4,
  },

  moreItemDanger: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(127,29,29,0.60)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
  },

  moreItem: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.34)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
  },

  moreItemText: {
    color: "#DCE9FF",
    fontSize: 15,
    fontWeight: "800",
  },

  pressed: {
    opacity: 0.72,
  },
  moreItemClose: {
    backgroundColor: "rgba(255,255,255,0.34)",
    marginTop: 2,
  },


  layoutHeroOverlay: {
    flex: 1,
    backgroundColor: "#05060A",
  },

  layoutHeroBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },

  layoutHeroShell: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    overflow: "hidden",
    backgroundColor: "#05060A",
  },

  layoutHeroImage: {
    width: "100%",
    height: "100%",
    transform: [{ translateY: 38 }],
  },

  layoutHotspot: {
    position: "absolute",
    zIndex: 30,
  },
  hotInterview: { left: "36%", top: "33.5%", width: "28%", height: "14%" },
  hotCoHost: { left: "67%", top: "33.5%", width: "29%", height: "14%" },

  hotTriad: { left: "4%", top: "50.5%", width: "30%", height: "13%" },
  hotPanel: { left: "36%", top: "50.5%", width: "28%", height: "13%" },
  hotGuestPanel: { left: "67%", top: "50.5%", width: "29%", height: "13%" },

  hotTeamGrid: { left: "4%", top: "67%", width: "30%", height: "13%" },
  hotRound: { left: "36%", top: "67%", width: "28%", height: "13%" },
  hotBroadcast: { left: "67%", top: "67%", width: "29%", height: "13%" },

  hotAudience: { left: "4%", top: "84%", width: "92%", height: "9%" },
  hotApply: { left: "4%", bottom: 0, width: "92%", height: 72 },

  layoutHeroImageFallback: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#05060A",
  },

  layoutHeroFallbackGlow: {
    color: "#F4C95D",
    fontSize: 54,
    fontWeight: "900",
  },

  layoutHeroFallbackTitle: {
    marginTop: 10,
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.8,
  },

  layoutHeroFallbackSub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },


  layoutHeroGlassTop: {
    position: "absolute",
    left: 14,
    right: 70,
    top: 54,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: "rgba(8,10,20,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  layoutHeroMini: {
    color: "#F4C95D",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4,
  },

  layoutHeroBig: {
    marginTop: 6,
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.6,
  },

  layoutHeroClose: {
    position: "absolute",
    top: 54,
    right: 14,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(10,10,16,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  profileActionBoxesLayer: {
    position: "absolute",
    left: "21.8%",
    right: "21.8%",
    top: "58.45%",
    height: 50,
    zIndex: 10000,
    elevation: 180,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 8,
    borderRadius: 18,
    backgroundColor: "rgba(2,14,34,0.70)",
    borderWidth: 1.2,
    borderColor: "rgba(135,235,255,0.72)",
    shadowOffset: { width: 0, height: 0 },
  },
  profileActionBoxActive: {
    backgroundColor: "#F4C95D",
    borderColor: "#E6C15A",
  },

  profileActionBox: {
    width: 37,
    height: 41,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(1,9,24,0.94)",
    borderWidth: 1.1,
    borderColor: "rgba(139,238,255,0.98)",
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  },
  profileActionBoxText: {
    marginTop: 2,
    color: "#82E9FF",
    fontSize: 6.2,
    fontWeight: "900",
    letterSpacing: 0.72,
  },






  requestPolicyBoxesLayer: {
    position: "absolute",
    left: "21.7%",
    right: "23.7%",
    top: "57.9%",
    height: 50,
    zIndex: 9999,
    elevation: 99,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 7,
    borderRadius: 19,
    backgroundColor: "rgba(3,18,46,0.78)",
    borderWidth: 1,
    borderColor: "rgba(91,170,255,0.42)",
    shadowOffset: { width: 0, height: 4 },
  },
  requestPolicyBox: {
    width: 39,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(1,10,28,0.96)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.58)",
    shadowOffset: { width: 0, height: 2 },
    elevation: 9,
  },
  requestPolicyBoxActive: {
    backgroundColor: "rgba(244,201,93,0.86)",
    borderColor: "rgba(255,245,200,0.95)",
    transform: [{ translateY: -1 }],
  },
  requestPolicyBoxText: {
    marginTop: 2,
    color: "rgba(244,201,93,0.88)",
    fontSize: 6.1,
    fontWeight: "900",
    letterSpacing: 0.45,
  },
  requestPolicyBoxTextActive: {
    color: "#07111F",
  },

  teamGridTableControlsLayer: {
    position: "absolute",
    left: "3.8%",
    right: "3.8%",
    bottom: "2.25%",
    height: 54,
    zIndex: 300,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 24,
    paddingHorizontal: 12,
    backgroundColor: "rgba(0,8,26,0.99)",
    borderWidth: 1.25,
    borderColor: "rgba(255,236,170,1)",
    shadowOffset: { width: 0, height: 6 },
    elevation: 30,
  },

  teamGridTableControlBtn: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,18,52,1)",
    borderWidth: 1.15,
    borderColor: "rgba(255,236,170,1)",
    shadowOffset: { width: 0, height: 2 },
    elevation: 9,
  },
  teamGridIconActiveRing: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.4,
    borderColor: "rgba(255,122,217,0.88)",
    backgroundColor: "rgba(255,122,217,0.08)",
    shadowOffset: { width: 0, height: 0 },
  },

  viewerEndControlBtn: {
    borderColor: "rgba(255,107,107,0.9)",
    backgroundColor: "rgba(80,10,18,0.78)",
  },

  teamGridTableControlBtnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },

  vipSoloRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    flex: 1,
    backgroundColor: "#070816",
    paddingHorizontal: 14,
  },
  vipSoloAuraOne: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(244, 208, 111, 0.08)",
    top: -70,
    right: -90,
  },
  vipSoloAuraTwo: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(82, 47, 12, 0.16)",
    bottom: -100,
    left: -120,
  },
  vipSoloTopBar: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(8,12,22,0.72)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    marginBottom: 10,
  },
  vipSoloBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  vipSoloLivePill: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 40, 54, 0.20)",
    borderWidth: 1,
    borderColor: "rgba(255, 79, 93, 0.45)",
  },
  vipSoloLiveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#FF3146",
  },
  vipSoloLiveText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  vipSoloViewerPill: {
    height: 36,
    minWidth: 58,
    borderRadius: 18,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  vipSoloViewerText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },

  vipSoloMediaHeader: {
    height: 72,
    borderRadius: 30,
    marginBottom: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(8,12,22,0.78)",
    borderWidth: 1,
    borderColor: "rgba(244, 208, 111, 0.22)",
  },
  vipSoloMediaAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.10)",
    borderWidth: 1.5,
    borderColor: "rgba(244,208,111,0.46)",
  },
  vipSoloMediaAvatarText: {
    color: "#F4D06F",
    fontSize: 21,
    fontWeight: "900",
  },
  vipSoloMediaTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  vipSoloMediaName: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  vipSoloMediaSub: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  vipSoloMediaBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.13)",
    borderWidth: 1.5,
    borderColor: "rgba(244,208,111,0.46)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  vipSoloHero: {
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
    height: 638,
    borderRadius: 40,
    overflow: "hidden",
    backgroundColor: "#070B14",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.26)",
  },
  vipSoloHeroGlow: {
    position: "absolute",
    left: 34,
    right: 34,
    top: 30,
    height: 120,
    borderRadius: 80,
    backgroundColor: "rgba(244, 208, 111, 0.12)",
    zIndex: 1,
  },
  vipSoloCamera: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  vipSoloCameraWarmOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    backgroundColor: "rgba(244,208,111,0.035)",
  },
  vipSoloCameraVignette: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.20)",
    backgroundColor: "rgba(0,0,0,0.035)",
  },
  vipSoloFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  vipSoloAvatar: {
    width: 106,
    height: 106,
    borderRadius: 53,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244, 208, 111, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(244, 208, 111, 0.45)",
    marginBottom: 2,
  },
  vipSoloAvatarText: {
    color: "#F4D06F",
    fontSize: 42,
    fontWeight: "900",
  },
  vipSoloFallbackTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  vipSoloFallbackSub: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 0,
  },
  vipSoloNamePlate: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 22,
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: "rgba(3, 6, 14, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 4,
  },
  vipSoloName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  vipSoloRole: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  vipSoloSignal: {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(244, 208, 111, 0.16)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  vipSoloSignalText: {
    color: "#F4D06F",
    fontSize: 11,
    fontWeight: "900",
  },

  vipSoloHeroExpanded: {
    height: 624,
  },
  vipSoloHeroCompact: {
    height: 535,
  },
  vipSoloGuestRail: {
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
    zIndex: 5,
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 66,
    height: 86,
    borderRadius: 28,
    paddingVertical: 7,
    backgroundColor: "rgba(10,22,52,0.82)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.14)",
    overflow: "hidden",
  },
  vipSoloGuestSeatsScroll: {
    gap: 8,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  vipSoloGuestBox: {
    width: 64,
    height: 70,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    paddingTop: 4,
  },
  vipSoloGuestBoxActive: {
    backgroundColor: "rgba(244,208,111,0.12)",
    borderColor: "rgba(244,208,111,0.55)",
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  vipSoloGuestBoxWaiting: {
    backgroundColor: "rgba(255,179,106,0.13)",
    borderColor: "rgba(255,179,106,0.70)",
    shadowColor: "#FFB36A",
    shadowOpacity: 0.18,
    shadowRadius: 9,
  },
  vipSoloGuestBoxLive: {
    backgroundColor: "rgba(244,208,111,0.18)",
    borderColor: "rgba(244,208,111,0.82)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.26,
    shadowRadius: 10,
  },
  vipSoloSpeakerRing: {
    position: "relative",
    borderRadius: 999,
    padding: 2,
  },
  vipSoloSpeakerRingActive: {
    backgroundColor: "rgba(244,208,111,0.10)",
  },
  vipSoloSpeakerRingWaiting: {
    backgroundColor: "rgba(255,179,106,0.16)",
  },
  vipSoloSpeakerRingLive: {
    backgroundColor: "rgba(244,208,111,0.22)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  vipSoloSpeakerPulse: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 16,
    height: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4D06F",
    borderWidth: 1,
    borderColor: "rgba(8,10,28,0.95)",
  },
  vipSoloSpeakerPulseLive: {
    backgroundColor: "#FFE08A",
  },
  vipSoloGuestAvatar: {
    width: 39,
    height: 39,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  sideLiveProfileImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },

  vipSoloGuestAvatarText: {
    color: "#F4D06F",
    fontSize: 12,
    fontWeight: "900",
  },
  vipSoloGuestName: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 0,
    textAlign: "center",
    maxWidth: 64,
  },
  vipSoloGuestSub: {
    color: "rgba(255,255,255,0.34)",
    fontSize: 8,
    fontWeight: "700",
    marginTop: 0,
  },
  vipSoloGuestSubLive: {
    color: "#F4D06F",
    fontWeight: "900",
  },


  vipGuestSmartCard: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 156,
    zIndex: 40,
    borderRadius: 26,
    padding: 12,
    backgroundColor: "rgba(8,12,28,0.94)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.30)",
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
  vipGuestSmartTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  vipGuestSmartAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.08)",
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.30)",
    marginRight: 12,
  },
  vipGuestSmartAvatarText: {
    color: "#F4D06F",
    fontSize: 14,
    fontWeight: "900",
  },
  vipGuestSmartName: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  vipGuestSmartStatus: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 1,
  },
  vipGuestSmartClose: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  vipGuestSmartActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  vipGuestSmartBtn: {
    flex: 1,
    height: 68,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "rgba(8,18,42,0.84)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
  },
  vipGuestSmartBtnGold: {
    backgroundColor: "#F4D06F",
    borderColor: "rgba(244,208,111,0.90)",
  },
  vipGuestSmartBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  vipGuestSmartBtnGoldText: {
    color: "#141012",
    fontSize: 11,
    fontWeight: "900",
  },

  vipSoloBottomGlowPanel: {
    position: "absolute",
    top: -220,
    bottom: -260,
    left: -160,
    right: -160,
    borderRadius: 420,
    backgroundColor: "rgba(92,44,255,0.24)",
    zIndex: -50,
    elevation: 0,
    opacity: 1,
  },
  vipSoloBottomDock: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 4,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    borderRadius: 36,
    backgroundColor: "rgba(8,10,28,0.88)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
    shadowColor: "#7C4DFF",
    shadowOpacity: 0.30,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 22,
    overflow: "hidden",
  },
  vipSoloControlsScroll: {
    gap: 8,
    alignItems: "center",
    paddingLeft: 2,
    paddingRight: 18,
  },
  vipSoloControl: {
    width: 60,
    height: 50,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.12)",
  },
  vipSoloControlOn: {
    backgroundColor: "rgba(244,208,111,0.105)",
    borderColor: "rgba(244,208,111,0.38)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  vipSoloControlOff: {
    backgroundColor: "rgba(255,255,255,0.025)",
    borderColor: "rgba(255,255,255,0.075)",
  },
  vipSoloGoldControl: {
    backgroundColor: "#F4D06F",
  },
  vipSoloControlText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 2,
  },
  vipSoloControlTextOn: {
    color: "#F4D06F",
    fontWeight: "900",
  },
  vipSoloGoldText: {
    color: "#201306",
    fontSize: 10,
    fontWeight: "900",
  },
  hotSolo: { left: "4%", top: "33.5%", width: "30%", height: "14%" },

  grid6LiveTopBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    zIndex: 80,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(10,12,18,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  grid6LivePulseOuter: {
    width: 15,
    height: 15,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.26)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.58)",
  },
  grid6LivePulseInner: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: "#EF4444",
  },
  grid6LiveTopText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  grid6ViewerPill: {
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  grid6ViewerText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },

  joinRequestListLayer: {
    position: "absolute",
    left: 14,
    right: 14,
    top: "55%",
    zIndex: 190,
  },
  joinRequestListCard: {
    borderRadius: 24,
    padding: 12,
    backgroundColor: "#071226",
    borderWidth: 1,
    borderColor: "#CDAA4A",
    elevation: 18,
  },
  joinRequestListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  joinRequestListTitle: {
    color: "#F4C95D",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  joinRequestListClose: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101B33",
  },
  joinRequestListRow: {
    minHeight: 58,
    borderRadius: 18,
    paddingHorizontal: 9,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#0D1A32",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  joinRequestListAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A2742",
    borderWidth: 1,
    borderColor: "#D9B35F",
  },
  joinRequestListAvatarText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  joinRequestListName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  joinRequestListRole: {
    marginTop: 1,
    color: "#B8C2D9",
    fontSize: 11,
    fontWeight: "800",
  },
  joinRequestMiniAccept: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4C95D",
  },
  joinRequestMiniDecline: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#26324A",
  },
  joinRequestListEmpty: {
    paddingVertical: 12,
    color: "#B8C2D9",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },

  crossInvisibleTouch: {
    position: "absolute",
    bottom: 188,
    left: "50%",
    marginLeft: -54,
    width: 108,
    height: 108,
    borderRadius: 999,
    zIndex: 260,
    backgroundColor: "transparent",
  },

  hostRequestVipLayer: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 208,
    zIndex: 80,
    alignItems: "center",
  },
  grid6GuestControlsLayer: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 204,
    zIndex: 320,
    alignItems: "center",
  },

  grid6ControlIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.08)",
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.38)",
    marginBottom: 1,
  },
  grid6GuestControlsCard: {
    width: "100%",
    borderRadius: 34,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "rgba(2,8,22,0.66)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
    shadowColor: "#F4D06F",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 18,
    overflow: "hidden",
  },


  hostRequestVipCard: {
    width: "92%",
    borderRadius: 24,
    padding: 14,
    backgroundColor: "rgba(5,10,24,0.94)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.55)",
  },
  hostRequestVipTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  hostRequestVipAvatar: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.8)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  hostRequestVipAvatarText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  hostRequestVipName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
  },
  hostRequestVipSub: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "700",
  },
  hostRequestVipActions: {
    flexDirection: "row",
    gap: 8,
  },
  hostRequestVipBtn: {
    flex: 1,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  hostRequestVipReject: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderColor: "rgba(239,68,68,0.5)",
  },
  hostRequestVipWait: {
    backgroundColor: "rgba(244,201,93,0.14)",
    borderColor: "rgba(244,201,93,0.5)",
  },
  hostRequestVipAccept: {
    backgroundColor: "rgba(52,211,153,0.14)",
    borderColor: "rgba(52,211,153,0.5)",
  },
  hostRequestVipRejectText: {
    color: "#FF6B6B",
    fontWeight: "900",
    fontSize: 12,
  },
  hostRequestVipWaitText: {
    color: "#F4C95D",
    fontWeight: "900",
    fontSize: 12,
  },
  hostRequestVipAcceptText: {
    color: "#34D399",
    fontWeight: "900",
    fontSize: 12,
  },

});


/* KRISTO_EXPIRED_SLOT_BLOCK
   Expired slots cannot be extended or revived anymore.
*/