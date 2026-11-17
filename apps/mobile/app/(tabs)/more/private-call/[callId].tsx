import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { registerGlobals } from "@livekit/react-native";
import { Room, RoomEvent } from "livekit-client";

import LiveMainStageSaturnOrbit from "@/src/components/live/LiveMainStageSaturnOrbit";
import { useOngoingCallElapsed } from "@/src/components/PrivateCallOngoingHost";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { ensurePrivateCallRingingAudioFiles, type PrivateCallRingingAudioUris } from "@/src/lib/privateCallRingingAudio";
import { cancelIncomingCallNotification } from "@/src/lib/push/kristoCallNotifications";
import { consumePendingCallAnswer } from "@/src/lib/push/kristoCallRouting";
import {
  endOngoingPrivateCall,
  getOngoingPrivateCallState,
  setPrivateCallScreenFocused,
  startOngoingPrivateCall,
  startPrivateCallUnavailablePrompt,
  stopPrivateCallUnavailablePrompt,
  toggleOngoingPrivateCallMute,
  useOngoingPrivateCallState,
} from "@/src/lib/privateCallOngoingStore";
import {
  disposePreconnectedPrivateCallRoom,
  preconnectedPrivateCallRooms,
} from "@/src/lib/privateCallPreconnect";
import {
  ensurePrivateCallAudioSession,
  logPrivateCallAudioLatencyDiag,
} from "@/src/lib/privateCallAudioRenderer";
import { buildLiveKitRoomOptions } from "@/src/lib/liveKitVideoQuality";
import {
  buildPrivateCallConnectOptions,
  getPrivateCallRoomInstanceId,
  logPrivateCallAutoSubscribeEffective,
} from "@/src/lib/privateCallLiveKitConnect";
import {
  acceptPrivateCall,
  declinePrivateCall,
  endPrivateCall,
  endPrivateCallIfRinging,
  fetchPrivateCallLiveKitCredentials,
  fetchPrivateCallSession,
  isPrivateCallTerminalStatus,
  prefetchPrivateCallLiveKitCredentials,
  type PrivateCallSession,
} from "@/src/lib/privateCallService";

const BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.92)";
const PRIVATE_CALL_AUDIO_ENABLED =
  String(process.env.EXPO_PUBLIC_PRIVATE_CALL_AUDIO_ENABLED || "true")
    .trim()
    .toLowerCase() !== "false";

let privateCallLiveKitGlobalsReady = false;
function ensurePrivateCallLiveKitGlobals() {
  if (privateCallLiveKitGlobalsReady) return;
  privateCallLiveKitGlobalsReady = true;
  registerGlobals();
}
ensurePrivateCallLiveKitGlobals();

type StableLiveKitBinding = {
  callId: string;
  roomName: string;
  serverUrl: string;
  token: string;
};

function installPrivateCallRingingSubscriptionBridge(
  room: Room,
  meta: {
    callId: string;
    roomName: string;
    currentUserId: string;
  }
) {
  const requestedTrackSids = new Set<string>();
  let active = true;

  console.log("KRISTO_PRIVATE_CALL_SUBSCRIPTION_OWNER_RINGING", {
    ...meta,
    roomInstanceId: getPrivateCallRoomInstanceId(room),
    ts: Date.now(),
  });

  const isRemoteAudioPublication = (publication: any) => {
    const kind = String(
      publication?.kind ?? publication?.track?.kind ?? ""
    ).toLowerCase();
    const source = String(
      publication?.source ?? publication?.track?.source ?? ""
    ).toLowerCase();

    return (
      kind === "audio" ||
      source.includes("microphone") ||
      source.includes("screen_share_audio")
    );
  };

  const observePublication = (
    publication: any,
    participant: any,
    reason: string
  ) => {
    if (!active || !participant || participant.isLocal) return;
    if (!isRemoteAudioPublication(publication)) return;

    const trackSid = String(
      publication?.trackSid || publication?.sid || ""
    ).trim();

    if (!trackSid) return;

    if (requestedTrackSids.has(trackSid)) return;
    requestedTrackSids.add(trackSid);

    console.log(
      "KRISTO_PRIVATE_CALL_RINGING_AUTO_SUBSCRIBE_OBSERVED",
      {
        ...meta,
        roomInstanceId:
          getPrivateCallRoomInstanceId(room),
        identity: String(participant?.identity || ""),
        participantSid: String(participant?.sid || ""),
        trackSid,
        reason,
        isDesired: publication?.isDesired !== false,
        isSubscribed: !!publication?.isSubscribed,
        hasTrack: !!publication?.track,
        subscriptionStatus: String(
          publication?.subscriptionStatus || ""
        ),
        ts: Date.now(),
      }
    );
  };

  const primeParticipant = (participant: any, reason: string) => {
    if (!participant || participant.isLocal) return;

    participant.trackPublications?.forEach?.((publication: any) => {
      observePublication(
        publication,
        participant,
        reason
      );
    });
  };

  const primeAll = (reason: string) => {
    room.remoteParticipants.forEach((participant: any) => {
      primeParticipant(participant, reason);
    });
  };

  const onTrackPublished = (publication: any, participant: any) => {
    observePublication(
      publication,
      participant,
      "ringing-track-published"
    );
  };

  const onParticipantConnected = (participant: any) => {
    primeParticipant(
      participant,
      "ringing-participant-connected"
    );
  };

  const onTrackSubscribed = (
    track: any,
    publication: any,
    participant: any
  ) => {
    if (!isRemoteAudioPublication(publication)) return;

    console.log("KRISTO_PRIVATE_CALL_RINGING_REMOTE_AUDIO_READY", {
      ...meta,
      identity: String(participant?.identity || ""),
      trackSid: String(
        publication?.trackSid || publication?.sid || ""
      ),
      hasTrack: !!publication?.track,
      hasMediaStreamTrack: !!track?.mediaStreamTrack,
      ts: Date.now(),
    });
  };

  const onReconnected = () => {
    primeAll("ringing-reconnected");
  };

  room.on(RoomEvent.TrackPublished, onTrackPublished);
  room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
  room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
  room.on(RoomEvent.Reconnected, onReconnected);

  primeAll("ringing-bridge-installed");

  console.log("KRISTO_PRIVATE_CALL_RINGING_SUBSCRIPTION_BRIDGE_READY", {
    ...meta,
    remoteParticipantCount: room.remoteParticipants.size,
    ts: Date.now(),
  });

  return () => {
    if (!active) return;
    active = false;

    requestedTrackSids.clear();

    room.off(RoomEvent.TrackPublished, onTrackPublished);
    room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.off(RoomEvent.Reconnected, onReconnected);

    console.log("KRISTO_PRIVATE_CALL_RINGING_SUBSCRIPTION_BRIDGE_CLEANUP", {
      ...meta,
      ts: Date.now(),
    });
  };
}

type ConnectedPeerDisplay = {
  peerName: string;
  peerAvatar?: string;
};
const AVATAR_SIZE = 112;
const RINGING_SESSION_POLL_MS = 500;
const CONNECTED_SESSION_POLL_MS = 1500;
const OUTGOING_RINGING_HAPTIC_MS = 1700;

function PrivateCallOutgoingRinging({ callId }: { callId: string }) {
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const ripple3 = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    console.log("KRISTO_PRIVATE_CALL_RINGING_ANIMATION_START", { callId });

    const createRippleLoop = (value: Animated.Value, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(value, {
            toValue: 1,
            duration: 2200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );

    const rippleLoop1 = createRippleLoop(ripple1, 0);
    const rippleLoop2 = createRippleLoop(ripple2, 450);
    const rippleLoop3 = createRippleLoop(ripple3, 900);
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    rippleLoop1.start();
    rippleLoop2.start();
    rippleLoop3.start();
    glowLoop.start();

    const pulse = (initial = false) => {
      if (!activeRef.current) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      console.log("KRISTO_PRIVATE_CALL_RINGING_HAPTIC_PULSE", {
        callId,
        initial,
      });
    };

    const initialPulseTimer = setTimeout(() => pulse(true), 350);
    const hapticTimer = setInterval(() => pulse(false), OUTGOING_RINGING_HAPTIC_MS);

    return () => {
      activeRef.current = false;
      clearTimeout(initialPulseTimer);
      clearInterval(hapticTimer);
      rippleLoop1.stop();
      rippleLoop2.stop();
      rippleLoop3.stop();
      glowLoop.stop();
      console.log("KRISTO_PRIVATE_CALL_RINGING_ANIMATION_STOP", { callId });
    };
  }, [callId, glow, ripple1, ripple2, ripple3]);

  const rippleStyle = (value: Animated.Value) => ({
    transform: [
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [0.5, 2],
        }),
      },
    ],
    opacity: value.interpolate({
      inputRange: [0, 0.12, 0.75, 1],
      outputRange: [0, 0.55, 0.2, 0],
    }),
  });

  const glowScale = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.72],
  });

  return (
    <View style={styles.outgoingRingBlock}>
      <View style={styles.outgoingRingAnimHost}>
        <Animated.View style={[styles.outgoingRipple, rippleStyle(ripple1)]} />
        <Animated.View style={[styles.outgoingRipple, rippleStyle(ripple2)]} />
        <Animated.View style={[styles.outgoingRipple, styles.outgoingRippleSoft, rippleStyle(ripple3)]} />
        <Animated.View
          style={[
            styles.outgoingGlow,
            {
              transform: [{ scale: glowScale }],
              opacity: glowOpacity,
            },
          ]}
        />
        <View style={styles.outgoingIconCore}>
          <Ionicons name="call" size={22} color="#0B0F17" />
        </View>
      </View>
      <Text style={styles.outgoingCallingLabel}>Calling…</Text>
    </View>
  );
}


// The outgoing call rings (Mountain waittone) for exactly this long, never longer.
// Measured from the moment the ringing starts, not from when the audio first plays.
const PRIVATE_CALL_RING_LIMIT_MS = 29_000;

type PrivateCallRingingPhase = "idle" | "waittone" | "checking" | "unavailable" | "done";

/**
 * Outgoing ringback for the caller. Reuses the existing call audio stack instead of
 * building a new one:
 * - audio session: the LiveKit session from `ensurePrivateCallAudioSession` (the same
 *   one the ringing preconnect and the connected call already use) — no
 *   `setAudioModeAsync` here, so the call's session is never reconfigured;
 * - player: one `useAudioPlayer` (the expo-audio player the app already uses for voice
 *   notes), switched from the waittone to the unavailable prompt with `replace()`.
 *
 * The waittone plays for at most 29s. At the limit it stops and `onRingLimitReached`
 * decides (from the server state) whether the unavailable prompt plays: it does not
 * when the pastor has accepted. When `forceUnavailable` is set (the pastor declined)
 * the prompt plays right away. Unmounting the component (accept or Cancel) stops all
 * sound and the prompt never plays.
 */
function PrivateCallRingingAudio({
  callId,
  forceUnavailable = false,
  onRingLimitReached,
  onRingingStarted,
  onUnavailableStarted,
}: {
  callId: string;
  forceUnavailable?: boolean;
  onRingLimitReached: () => Promise<boolean>;
  onRingingStarted?: () => void;
  onUnavailableStarted?: () => void;
}) {
  const [audioUris, setAudioUris] = useState<PrivateCallRingingAudioUris | null>(null);
  // keepAudioSessionActive: pausing/switching the prompt must not deactivate the
  // shared LiveKit audio session.
  const player = useAudioPlayer(
    audioUris?.waittone ?? null,
    { keepAudioSessionActive: true }
  );
  const status = useAudioPlayerStatus(player);
  const [waittoneElapsed, setWaittoneElapsed] = useState(false);
  const phaseRef = useRef<PrivateCallRingingPhase>("idle");
  const mountedRef = useRef(true);
  const waittoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef(player);
  const onRingLimitReachedRef = useRef(onRingLimitReached);
  const onRingingStartedRef = useRef(onRingingStarted);
  const onUnavailableStartedRef = useRef(onUnavailableStarted);
  const audioUrisRef = useRef<PrivateCallRingingAudioUris | null>(null);

  playerRef.current = player;
  audioUrisRef.current = audioUris;
  onRingLimitReachedRef.current = onRingLimitReached;
  onRingingStartedRef.current = onRingingStarted;
  onUnavailableStartedRef.current = onUnavailableStarted;

  const setRingingPhase = useCallback((next: PrivateCallRingingPhase) => {
    phaseRef.current = next;
  }, []);

  // Load the bundled mp3 files once per call.
  useEffect(() => {
    let active = true;
    onRingingStartedRef.current?.();
    void ensurePrivateCallRingingAudioFiles()
      .then((uris) => {
        if (active) setAudioUris(uris);
      })
      .catch((error: any) => {
        console.warn("KRISTO_PRIVATE_CALL_PROMPT_AUDIO_LOAD_FAILED", {
          callId,
          error: String(error?.message || error),
        });
      });

    return () => {
      active = false;
    };
  }, [callId]);

  // Unmount (Cancel, accept, or leaving the screen): stop the sound immediately.
  // The LiveKit audio session is left untouched for the call.
  // The 29s ring limit starts when ringing starts (mount), so the caller never hears
  // more than 29s of waittone even if the audio file loads late.
  useEffect(() => {
    mountedRef.current = true;
    phaseRef.current = "idle";
    setWaittoneElapsed(false);
    waittoneTimerRef.current = setTimeout(() => {
      waittoneTimerRef.current = null;
      console.log("KRISTO_PRIVATE_CALL_RING_LIMIT_REACHED", {
        callId,
        limitMs: PRIVATE_CALL_RING_LIMIT_MS,
      });
      if (mountedRef.current) setWaittoneElapsed(true);
    }, PRIVATE_CALL_RING_LIMIT_MS);
    return () => {
      mountedRef.current = false;
      if (waittoneTimerRef.current) clearTimeout(waittoneTimerRef.current);
      waittoneTimerRef.current = null;
      phaseRef.current = "done";
      try {
        playerRef.current.pause();
      } catch {}
    };
  }, [callId]);

  // Start the Mountain waittone once it is loaded, inside the existing call audio session.
  useEffect(() => {
    if (!audioUris || !status.isLoaded || phaseRef.current !== "idle") return;
    setRingingPhase("waittone");

    void (async () => {
      await ensurePrivateCallAudioSession(callId);
      if (phaseRef.current !== "waittone") return;

      const current = playerRef.current;
      try {
        current.loop = true;
        current.volume = 1;
        await current.seekTo(0);
        if (phaseRef.current !== "waittone") return;
        current.play();
        console.log("KRISTO_PRIVATE_CALL_WAITTONE_STARTED", {
          callId,
          limitMs: PRIVATE_CALL_RING_LIMIT_MS,
        });
      } catch (error: any) {
        console.warn("KRISTO_PRIVATE_CALL_WAITTONE_PLAY_FAILED", {
          callId,
          error: String(error?.message || error),
        });
      }
    })();
  }, [audioUris, callId, setRingingPhase, status.isLoaded]);

  // Not answered / declined: the Mountain tone is already stopped. The "hapatikani" prompt
  // is handed to the app-wide host (a short banner) and this screen returns to the previous
  // page, so the caller is not held on a large empty No answer page.
  const playUnavailablePrompt = useCallback(() => {
    setRingingPhase("done");
    try {
      playerRef.current.pause();
    } catch {}
    console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_PROMPT_HANDOFF_REQUESTED", { callId });
    onUnavailableStartedRef.current?.();
  }, [callId, setRingingPhase]);

  // Ring limit reached, or the call was declined: stop the waittone at once. On a
  // decline the prompt plays right away; at the ring limit it plays only if the
  // server confirms the call was not accepted.
  useEffect(() => {
    if (!waittoneElapsed && !forceUnavailable) return;
    if (forceUnavailable && !audioUris) return; // wait for the prompt file
    if (phaseRef.current !== "idle" && phaseRef.current !== "waittone") return;
    if (waittoneTimerRef.current) clearTimeout(waittoneTimerRef.current);
    waittoneTimerRef.current = null;

    try {
      const current = playerRef.current;
      current.loop = false;
      current.pause();
    } catch {}
    console.log("KRISTO_PRIVATE_CALL_WAITTONE_STOPPED", {
      callId,
      reason: forceUnavailable ? "declined-or-timeout" : "ring-limit",
    });

    if (forceUnavailable) {
      playUnavailablePrompt();
      return;
    }

    setRingingPhase("checking");
    void (async () => {
      let shouldPlay = false;
      try {
        shouldPlay = await onRingLimitReachedRef.current();
      } catch (error: any) {
        console.warn("KRISTO_PRIVATE_CALL_RING_LIMIT_CHECK_FAILED", {
          callId,
          error: String(error?.message || error),
        });
      }
      // Accepted, cancelled or unmounted meanwhile: stay silent.
      if (!mountedRef.current || phaseRef.current !== "checking") return;
      if (!shouldPlay) {
        setRingingPhase("done");
        console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_PROMPT_SKIPPED", { callId });
        return;
      }
      playUnavailablePrompt();
    })();
  }, [audioUris, callId, forceUnavailable, playUnavailablePrompt, setRingingPhase, waittoneElapsed]);


  return null;
}

function formatCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function PrivateCallAvatar({
  avatarUri,
  animate = true,
}: {
  avatarUri?: string;
  animate?: boolean;
}) {
  const avatar = avatarUri ? (
    <Image
      source={{ uri: avatarUri }}
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
      }}
    />
  ) : (
    <View
      style={[
        styles.avatarFallback,
        {
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          borderRadius: AVATAR_SIZE / 2,
        },
      ]}
    >
      <Ionicons name="person" size={42} color="rgba(255,255,255,0.82)" />
    </View>
  );

  if (!animate) return avatar;

  return (
    <LiveMainStageSaturnOrbit size={AVATAR_SIZE} ringColor={GOLD}>
      {avatar}
    </LiveMainStageSaturnOrbit>
  );
}

/**
 * Connected call UI. The call itself (LiveKit room, audio, microphone, timer, CallKit,
 * Android foreground service) is owned by PrivateCallOngoingHost, so this view can be left
 * with Back / another tab without disconnecting; it only reads and drives the shared state.
 */
function PrivateCallOngoingView({
  callId,
  peerName,
  peerAvatar,
  onEnd,
  onMinimize,
}: {
  callId: string;
  peerName: string;
  peerAvatar?: string;
  onEnd: () => void;
  onMinimize: () => void;
}) {
  const ongoing = useOngoingPrivateCallState();
  const isThisCall = ongoing.call?.callId === callId;
  const connected = isThisCall && !!ongoing.room;
  const micEnabled = isThisCall ? ongoing.micEnabled : true;
  const elapsedSec = useOngoingCallElapsed(isThisCall && connected ? ongoing.startedAt : 0);

  return (
    <View style={styles.ongoingViewRoot}>
      <Pressable
        onPress={onMinimize}
        accessibilityRole="button"
        accessibilityLabel="Rudi nyuma, simu itaendelea"
        style={styles.backBtn}
        hitSlop={12}
      >
        <Ionicons name="chevron-down" size={22} color="#fff" />
      </Pressable>

      <View style={styles.centerStage}>
        <PrivateCallAvatar avatarUri={peerAvatar} animate />

        <Text style={styles.title}>{connected ? "Connected" : "Connecting…"}</Text>
        {elapsedSec > 0 ? (
          <Text style={styles.durationText}>{formatCallDuration(elapsedSec)}</Text>
        ) : null}
        <Text style={styles.subtitle}>{peerName}</Text>
        <Text style={styles.ongoingHint}>
          Unaweza kurudi nyuma na kuendelea kutumia app — simu itaendelea.
        </Text>

        <View style={styles.connectedControls}>
          <Pressable
            onPress={() => void toggleOngoingPrivateCallMute()}
            disabled={!connected}
            style={[
              styles.muteCircleBtn,
              !micEnabled && styles.muteCircleBtnActive,
              !connected && styles.cancelCallBtnPressed,
            ]}
          >
            <Ionicons name={micEnabled ? "mic" : "mic-off"} size={24} color="#fff" />
            <Text style={styles.muteLabel}>{micEnabled ? "Mic On" : "Muted"}</Text>
          </Pressable>

          <Pressable onPress={onEnd} style={styles.endBtn}>
            <Ionicons name="call" size={20} color="#fff" />
            <Text style={styles.endBtnText}>End Call</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function PrivateCallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    callId?: string;
    returnTo?: string;
  }>();
  const { session: authSession } = useKristoSession();

  const callId = String(params.callId || "").trim();
  const returnTo = String(params.returnTo || "").trim();
  const currentUserId = String(authSession?.userId || "").trim();

  const [session, setSession] = useState<PrivateCallSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveKitBinding, setLiveKitBinding] = useState<StableLiveKitBinding | null>(null);
  const [connectedPeerDisplay, setConnectedPeerDisplay] = useState<ConnectedPeerDisplay | null>(
    null
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [unavailablePromptStarted, setUnavailablePromptStarted] = useState(false);
  const [ringingAudioStopped, setRingingAudioStopped] = useState(false);
  const exitHandledRef = useRef(false);
  const endRequestedRef = useRef(false);
  const screenFocusedRef = useRef(true);
  const pendingExitRef = useRef<{ source: string; meta?: Record<string, unknown> } | null>(null);
  const liveKitJoinRef = useRef(false);
  const liveKitBindingRef = useRef<StableLiveKitBinding | null>(null);
  const ringingPreconnectPromiseRef = useRef<Promise<void> | null>(null);
  const latencyMarksRef = useRef<Record<string, number>>({});
  const sessionStatusRef = useRef<string>("");
  const outgoingRingingAudioStartedRef = useRef("");
  // Set once the caller's "unavailable" prompt has started for this call; from then on
  // the screen stays on No answer until the prompt finishes (or Cancel is pressed).
  const unavailablePromptStartedRef = useRef("");

  const role = useMemo(() => {
    if (!session || !currentUserId) return "unknown";
    if (session.callerUserId === currentUserId) return "caller";
    if (session.pastorUserId === currentUserId) return "pastor";
    return "unknown";
  }, [session, currentUserId]);

  const leaveCallRoute = useCallback(() => {
    if (returnTo) {
      router.replace(returnTo as any);
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/(tabs)/more" as any);
  }, [returnTo, router]);

  const exitCallScreen = useCallback(
    (source: string, meta?: Record<string, unknown>) => {
      if (exitHandledRef.current) {
        console.log("KRISTO_PRIVATE_CALL_END_DUPLICATE_BLOCKED", {
          callId,
          currentUserId,
          source,
          ...(meta || {}),
        });
        return;
      }
      // Not on screen (the user moved to another tab with this screen still in its stack):
      // navigating now would move the wrong stack, so leave when the screen is shown again.
      if (!screenFocusedRef.current) {
        pendingExitRef.current = { source, meta };
        console.log("KRISTO_PRIVATE_CALL_EXIT_DEFERRED_UNTIL_FOCUS", { callId, source });
        return;
      }
      pendingExitRef.current = null;
      exitHandledRef.current = true;

      // Do not disconnect the Room here. A connected call is owned by
      // PrivateCallOngoingHost (it keeps running after this screen closes);
      // its engine is the single final owner of room.disconnect().
      console.log("KRISTO_PRIVATE_CALL_ROOM_DISCONNECT_DEFERRED_TO_SHELL", {
        callId,
        currentUserId,
        source,
        ts: Date.now(),
      });

      console.log("KRISTO_PRIVATE_CALL_BOTH_SIDES_EXIT", {
        callId,
        currentUserId,
        source,
        returnTo: returnTo || null,
        ...(meta || {}),
      });

      leaveCallRoute();
    },
    [callId, currentUserId, leaveCallRoute, returnTo]
  );

  // While this screen is on screen the "Simu inaendelea" bar is hidden; a deferred exit runs
  // as soon as the screen is shown again.
  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true;
      setPrivateCallScreenFocused(callId, true);
      const pending = pendingExitRef.current;
      if (pending) exitCallScreen(pending.source, pending.meta);
      return () => {
        screenFocusedRef.current = false;
        setPrivateCallScreenFocused(callId, false);
      };
    }, [callId, exitCallScreen])
  );

  const handleRemoteTermination = useCallback(
    (source: string, status: string) => {
      if (exitHandledRef.current) {
        console.log("KRISTO_PRIVATE_CALL_END_DUPLICATE_BLOCKED", {
          callId,
          currentUserId,
          source,
          status,
          reason: "exit-already-handled",
        });
        return;
      }

      console.log("KRISTO_PRIVATE_CALL_REMOTE_END_DETECTED", {
        callId,
        currentUserId,
        source,
        status,
      });
      // Caller side: a decline or timeout during ringing, or our own end after the 29s
      // ring limit, keeps the No answer screen up so the unavailable prompt is heard.
      if (
        role === "caller" &&
        ((outgoingRingingAudioStartedRef.current === callId &&
          (status === "timeout" || status === "declined")) ||
          unavailablePromptStartedRef.current === callId)
      ) {
        console.log("KRISTO_PRIVATE_CALL_TIMEOUT_PROMPT_DEFERRED", {
          callId,
          source,
          status,
        });
        return;
      }
      // A connected call is over: clean its session up in the app-wide host as well.
      if (getOngoingPrivateCallState().call?.callId === callId) {
        void endOngoingPrivateCall(`remote-${status}`, { notifyServer: false });
      }
      exitCallScreen("remote-end", { source, status });
    },
    [callId, currentUserId, exitCallScreen, role]
  );

  const handleEndCall = useCallback(async () => {
    if (!session || actionBusy) return;
    if (exitHandledRef.current) {
      console.log("KRISTO_PRIVATE_CALL_END_DUPLICATE_BLOCKED", {
        callId: session.id,
        currentUserId,
        reason: "exit-already-handled",
      });
      return;
    }

    setActionBusy(true);
    console.log("KRISTO_PRIVATE_CALL_END_REQUESTED", {
      callId: session.id,
      currentUserId,
      status: session.status,
    });

    // Connected call: the app-wide host ends it (server end request, LiveKit disconnect,
    // CallKit end, foreground service stop), then this screen leaves.
    if (getOngoingPrivateCallState().call?.callId === session.id) {
      const notifyServer = !endRequestedRef.current && !isPrivateCallTerminalStatus(session.status);
      endRequestedRef.current = true;
      try {
        await endOngoingPrivateCall("call-screen-end", { notifyServer });
      } finally {
        setActionBusy(false);
        exitCallScreen("local-end-requested", { status: session.status });
      }
      return;
    }

    try {
      if (!endRequestedRef.current && !isPrivateCallTerminalStatus(session.status)) {
        endRequestedRef.current = true;
        const res: any = await endPrivateCall(session.id);
        if (res?.ok && res?.data) {
          setSession(res.data);
          console.log("KRISTO_PRIVATE_CALL_SESSION_ENDED", {
            callId: session.id,
            endedBy: currentUserId,
            status: res.data.status,
            source: "local-end",
          });
        }
      } else {
        console.log("KRISTO_PRIVATE_CALL_END_DUPLICATE_BLOCKED", {
          callId: session.id,
          currentUserId,
          reason: "end-already-requested-or-terminal",
          status: session.status,
        });
      }
    } finally {
      setActionBusy(false);
      exitCallScreen("local-end-requested", { status: session.status });
    }
  }, [session, actionBusy, currentUserId, exitCallScreen]);

  const resolveConnectedPeerDisplay = useCallback(
    (joinSession: PrivateCallSession): ConnectedPeerDisplay => {
      const isCaller = joinSession.callerUserId === currentUserId;
      return {
        peerName: isCaller ? joinSession.pastorName : joinSession.callerName,
        peerAvatar: isCaller ? joinSession.pastorAvatarUrl : joinSession.callerAvatarUrl,
      };
    },
    [currentUserId]
  );

  const peerUserId = useMemo(() => {
    if (!session || !currentUserId) return "";
    if (session.callerUserId === currentUserId) return session.pastorUserId;
    if (session.pastorUserId === currentUserId) return session.callerUserId;
    return "";
  }, [session, currentUserId]);

  useEffect(() => {
    liveKitJoinRef.current = false;
    liveKitBindingRef.current = null;
    ringingPreconnectPromiseRef.current = null;
    latencyMarksRef.current = {};
    sessionStatusRef.current = "";
    setLiveKitBinding(null);
    setConnectedPeerDisplay(null);
    unavailablePromptStartedRef.current = "";
    setUnavailablePromptStarted(false);
    setRingingAudioStopped(false);
  }, [callId]);

  const commitLiveKitBinding = useCallback(
    (joinSession: PrivateCallSession, creds: { url: string; token: string }) => {
      if (liveKitBindingRef.current) {
        console.log("KRISTO_PRIVATE_CALL_ROOM_REMOUNT_BLOCKED", {
          callId: joinSession.id,
          reason: "binding-already-committed",
        });
        return;
      }

      const binding: StableLiveKitBinding = {
        callId: joinSession.id,
        roomName: joinSession.roomName,
        serverUrl: creds.url,
        token: creds.token,
      };
      liveKitBindingRef.current = binding;
      setLiveKitBinding(binding);
      setConnectedPeerDisplay(resolveConnectedPeerDisplay(joinSession));
    },
    [resolveConnectedPeerDisplay]
  );

  const preconnectLiveKitWhileRinging = useCallback(
    async (ringingSession: PrivateCallSession) => {
      if (!PRIVATE_CALL_AUDIO_ENABLED) return;
      if (!ringingSession.roomName || !currentUserId) return;
      if (preconnectedPrivateCallRooms.has(ringingSession.id)) return;
      if (liveKitBindingRef.current) return;

      if (ringingPreconnectPromiseRef.current) {
        await ringingPreconnectPromiseRef.current;
        return;
      }

      // Reserve LiveKit join ownership so Accept cannot create a second Room
      // while the ringing-time connection is still in progress.
      liveKitJoinRef.current = true;

      const task = (async () => {
        console.log("KRISTO_PRIVATE_CALL_RINGING_PRECONNECT_START", {
          callId: ringingSession.id,
          roomName: ringingSession.roomName,
          currentUserId,
          ts: Date.now(),
        });

        let room: Room | null = null;

        try {
          void ensurePrivateCallAudioSession(ringingSession.id);

          const creds = await fetchPrivateCallLiveKitCredentials({
            roomName: ringingSession.roomName,
            identity: currentUserId,
            source: "private-call-ringing-preconnect",
          });

          if (!creds) {
            throw new Error("Private-call LiveKit credentials unavailable");
          }

          const statusBeforeConnect = sessionStatusRef.current;
          if (
            statusBeforeConnect &&
            statusBeforeConnect !== "ringing" &&
            statusBeforeConnect !== "accepted"
          ) {
            return;
          }

          room = new Room(buildLiveKitRoomOptions());

          const ringingConnectOptions =
            buildPrivateCallConnectOptions();

          console.log(
            "KRISTO_PRIVATE_CALL_RINGING_CONNECT_OPTIONS",
            {
              callId: ringingSession.id,
              roomName: ringingSession.roomName,
              autoSubscribe:
                ringingConnectOptions.autoSubscribe,
              subscriptionOwner: "livekit-auto",
              ts: Date.now(),
            }
          );

          await room.connect(
            creds.url,
            creds.token,
            ringingConnectOptions
          );

          logPrivateCallAutoSubscribeEffective(room, {
            callId: ringingSession.id,
            roomName: ringingSession.roomName,
            source: "ringing-preconnect-connected",
            requestedAutoSubscribe:
              ringingConnectOptions.autoSubscribe,
          });

          const subscriptionBridgeCleanup =
            installPrivateCallRingingSubscriptionBridge(room, {
              callId: ringingSession.id,
              roomName: ringingSession.roomName,
              currentUserId,
            });

          const statusAfterConnect = sessionStatusRef.current;

          if (
            statusAfterConnect &&
            statusAfterConnect !== "ringing" &&
            statusAfterConnect !== "accepted"
          ) {
            subscriptionBridgeCleanup();
            await room.disconnect(true);
            room = null;
            return;
          }

          preconnectedPrivateCallRooms.set(ringingSession.id, {
            callId: ringingSession.id,
            roomName: ringingSession.roomName,
            serverUrl: creds.url,
            token: creds.token,
            room,
            subscriptionBridgeCleanup,
          });

          room = null;

          console.log("KRISTO_PRIVATE_CALL_RINGING_PRECONNECT_READY", {
            callId: ringingSession.id,
            roomName: ringingSession.roomName,
            currentUserId,
            status: statusAfterConnect || "ringing",
            ts: Date.now(),
          });

          // Accept may have happened while room.connect() was running.
          // Commit immediately so Shell adopts this already-connected Room.
          if (statusAfterConnect === "accepted") {
            commitLiveKitBinding(ringingSession, creds);
          }
        } catch (error: any) {
          if (room) {
            await room.disconnect(true).catch(() => {});
          }

          console.log("KRISTO_PRIVATE_CALL_RINGING_PRECONNECT_ERROR", {
            callId: ringingSession.id,
            roomName: ringingSession.roomName,
            currentUserId,
            status: sessionStatusRef.current,
            error: String(error?.message || error),
            ts: Date.now(),
          });

          // If Accept already happened, fall back to the normal Shell
          // connection instead of leaving the screen waiting forever.
          if (
            sessionStatusRef.current === "accepted" &&
            !liveKitBindingRef.current
          ) {
            try {
              const fallbackCreds =
                await fetchPrivateCallLiveKitCredentials({
                  roomName: ringingSession.roomName,
                  identity: currentUserId,
                  source: "private-call-preconnect-fallback",
                });

              if (fallbackCreds && !liveKitBindingRef.current) {
                commitLiveKitBinding(
                  ringingSession,
                  fallbackCreds
                );
              }
            } catch (fallbackError: any) {
              console.log(
                "KRISTO_PRIVATE_CALL_PRECONNECT_FALLBACK_ERROR",
                {
                  callId: ringingSession.id,
                  roomName: ringingSession.roomName,
                  error: String(
                    fallbackError?.message || fallbackError
                  ),
                  ts: Date.now(),
                }
              );
            }
          }
        } finally {
          ringingPreconnectPromiseRef.current = null;

          // Once a binding exists, the Shell owns the joined call.
          // Otherwise permit a later normal join attempt.
          liveKitJoinRef.current =
            Boolean(liveKitBindingRef.current);
        }
      })();

      ringingPreconnectPromiseRef.current = task;
      await task;
    },
    [commitLiveKitBinding, currentUserId]
  );

  const startLiveKitJoin = useCallback(
    async (joinSession: PrivateCallSession, source: string) => {
      if (liveKitJoinRef.current || liveKitBindingRef.current) return;
      if (!PRIVATE_CALL_AUDIO_ENABLED) {
        setConnectedPeerDisplay(resolveConnectedPeerDisplay(joinSession));
        return;
      }
      liveKitJoinRef.current = true;

      // Returning to a call that is already running in the app-wide host (e.g. from the
      // "Simu inaendelea" bar): reuse its room binding, no second join.
      const ongoingCall = getOngoingPrivateCallState().call;
      if (ongoingCall?.callId === joinSession.id) {
        console.log("KRISTO_PRIVATE_CALL_ONGOING_REATTACHED", { callId: joinSession.id, source });
        commitLiveKitBinding(joinSession, { url: ongoingCall.serverUrl, token: ongoingCall.token });
        return;
      }

      const marks = latencyMarksRef.current;
      logPrivateCallAudioLatencyDiag(marks, "livekit-join-start", { source });

      void ensurePrivateCallAudioSession(joinSession.id);

      const creds = await fetchPrivateCallLiveKitCredentials({
        roomName: joinSession.roomName,
        identity: currentUserId,
        source: `private-call-join-${source}`,
      });

      marks.tokenFetchDone = Date.now();
      logPrivateCallAudioLatencyDiag(marks, "token-fetch-complete", {
        source,
        ok: !!creds,
      });

      if (!creds) {
        liveKitJoinRef.current = false;
        return;
      }

      commitLiveKitBinding(joinSession, creds);
    },
    [commitLiveKitBinding, currentUserId, resolveConnectedPeerDisplay]
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const initial = await fetchPrivateCallSession(callId);
        if (!alive) return;
        if (!initial) {
          setError("This private call could not be found.");
          setLoading(false);
          return;
        }
        setSession(initial);
        sessionStatusRef.current = initial.status;
        if (initial.status === "accepted") {
          void startLiveKitJoin(initial, "initial-load");
        }
        if (initial.pastorUserId === currentUserId) {
          console.log("KRISTO_PRIVATE_CALL_RECEIVER_SCREEN_OPENED", {
            callId: initial.id,
            callerUserId: initial.callerUserId,
            receiverUserId: initial.pastorUserId,
            churchId: initial.churchId,
            status: initial.status,
            source: "call-screen",
          });
        }
      } catch (e: any) {
        if (!alive) return;
        setError(String(e?.message || "Could not load private call."));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [callId, currentUserId, startLiveKitJoin]);

  useEffect(() => {
    if (!session) return;
    sessionStatusRef.current = session.status;
  }, [session?.status]);

  useEffect(() => {
    if (!session?.roomName || session.status !== "ringing") return;
    prefetchPrivateCallLiveKitCredentials({
      roomName: session.roomName,
      identity: currentUserId,
      source: "private-call-ringing",
    });
    void ensurePrivateCallAudioSession(session.id);
  }, [session?.id, session?.roomName, session?.status, currentUserId]);

  useEffect(() => {
    if (!session || loading || isPrivateCallTerminalStatus(session.status)) return;

    const pollMs =
      session.status === "accepted" ? CONNECTED_SESSION_POLL_MS : RINGING_SESSION_POLL_MS;

    const poll = async () => {
      const next = await fetchPrivateCallSession(callId);
      if (!next) return;

      if (isPrivateCallTerminalStatus(next.status)) {
        setSession(next);
        handleRemoteTermination("session-poll", next.status);
        return;
      }

      if (next.status === "accepted") {
        const wasRinging = sessionStatusRef.current === "ringing";
        if (wasRinging) {
          setSession(next);
          sessionStatusRef.current = next.status;
        }
        if (wasRinging && !liveKitJoinRef.current && !liveKitBindingRef.current) {
          latencyMarksRef.current.acceptDetected = Date.now();
          logPrivateCallAudioLatencyDiag(latencyMarksRef.current, "accept-detected-poll", {
            callId: next.id,
          });
          void startLiveKitJoin(next, "poll-accept");
        }
        return;
      }

      setSession((prev) => {
        if (!prev) return next;
        if (prev.status === next.status && prev.updatedAt === next.updatedAt) return prev;
        return next;
      });
      sessionStatusRef.current = next.status;
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, pollMs);

    return () => clearInterval(timer);
  }, [callId, loading, session?.status, handleRemoteTermination, startLiveKitJoin]);

  useEffect(() => {
    if (loading || !session || exitHandledRef.current) return;
    if (!isPrivateCallTerminalStatus(session.status)) return;
    handleRemoteTermination("session-loaded-terminal", session.status);
  }, [loading, session?.status, handleRemoteTermination]);

  useEffect(() => {
    if (!session || session.status !== "ringing") return;

    void preconnectLiveKitWhileRinging(session);

    return () => {
      if (
        sessionStatusRef.current !== "accepted" &&
        sessionStatusRef.current !== "ringing"
      ) {
        void disposePreconnectedPrivateCallRoom(session.id);
      }
    };
  }, [
    session?.id,
    session?.roomName,
    session?.status,
    preconnectLiveKitWhileRinging,
  ]);

  useEffect(() => {
    if (!session || session.status !== "accepted") return;
    if (!PRIVATE_CALL_AUDIO_ENABLED) {
      setConnectedPeerDisplay(resolveConnectedPeerDisplay(session));
      return;
    }
    if (liveKitBindingRef.current) return;
    void startLiveKitJoin(session, "accepted-status");
  }, [
    session?.id,
    session?.roomName,
    session?.status,
    startLiveKitJoin,
    resolveConnectedPeerDisplay,
  ]);

  const handleAccept = async () => {
    if (!session || actionBusy) return;
    const acceptTapTs = Date.now();
    latencyMarksRef.current.acceptTap = acceptTapTs;
    console.log("KRISTO_PRIVATE_CALL_ACCEPT_TAP", {
      callId: session.id,
      currentUserId,
      ts: acceptTapTs,
    });
    logPrivateCallAudioLatencyDiag(latencyMarksRef.current, "accept-tap");

    setActionBusy(true);
    try {
      const res: any = await acceptPrivateCall(session.id);
      if (res?.ok && res?.data) {
        setSession(res.data);
        sessionStatusRef.current = res.data.status;
        console.log("KRISTO_PRIVATE_CALL_ACCEPTED", {
          callId: session.id,
          pastorUserId: currentUserId,
          ts: Date.now(),
        });
        void startLiveKitJoin(res.data, "accept-response");
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    try {
      const res: any = await declinePrivateCall(session.id);
      if (res?.ok && res?.data) {
        setSession(res.data);
        console.log("KRISTO_PRIVATE_CALL_DECLINED", {
          callId: session.id,
          pastorUserId: currentUserId,
        });
      }
    } finally {
      setActionBusy(false);
      exitCallScreen("local-decline");
    }
  };

  const handleAcceptRef = useRef(handleAccept);
  handleAcceptRef.current = handleAccept;

  // "Answer" pressed on the incoming-call notification (Android) or the CallKit screen (iOS):
  // accept as soon as the ringing call loads.
  useEffect(() => {
    if (!session || role !== "pastor" || session.status !== "ringing") return;
    if (consumePendingCallAnswer(session.id)) void handleAcceptRef.current();
  }, [session?.id, session?.status, role]);

  // The ringing notification goes away once the call is answered, declined or over.
  useEffect(() => {
    if (!session || role !== "pastor" || session.status === "ringing") return;
    void cancelIncomingCallNotification(session.id);
  }, [session?.id, session?.status, role]);

  // A connected call is handed to PrivateCallOngoingHost (tabs layout). The host owns the
  // LiveKit room, audio, microphone, timer, the CallKit call (iOS) and the ongoing-call
  // foreground notification (Android), so Back / leaving this screen never disconnects it.
  useEffect(() => {
    if (!session || session.status !== "accepted" || !liveKitBinding || !connectedPeerDisplay) return;
    if (liveKitBinding.callId !== session.id) return;
    startOngoingPrivateCall({
      callId: session.id,
      roomName: liveKitBinding.roomName,
      serverUrl: liveKitBinding.serverUrl,
      token: liveKitBinding.token,
      peerUserId,
      currentUserId,
      peerName: connectedPeerDisplay.peerName,
      peerAvatar: connectedPeerDisplay.peerAvatar,
      returnTo: returnTo || undefined,
      latencyMarks: latencyMarksRef.current,
    });
  }, [session, liveKitBinding, connectedPeerDisplay, peerUserId, currentUserId, returnTo]);

  // The ongoing call ended outside this screen (bar hang-up, CallKit End, the other side):
  // leave this screen too.
  const ongoingState = useOngoingPrivateCallState();
  useEffect(() => {
    if (!callId || ongoingState.endedCallId !== callId) return;
    if (ongoingState.call?.callId === callId) return;
    exitCallScreen("ongoing-call-ended", { status: sessionStatusRef.current });
  }, [callId, ongoingState.endedCallId, ongoingState.call?.callId, exitCallScreen]);

  // Cancel stops the waittone / prompt immediately, before the end request resolves.
  const handleCancelOutgoingCall = useCallback(() => {
    setRingingAudioStopped(true);
    void handleEndCall();
  }, [handleEndCall]);

  // The unavailable prompt has started playing: switch the UI to No answer.
  // Not answered / declined (never for an accepted call): the "hapatikani" prompt is handed to
  // the app-wide host, which plays it under a short banner, and this screen returns to the
  // previous page. The banner disappears when the prompt ends.
  const handleUnavailablePromptStarted = useCallback(() => {
    if (!session || role !== "caller") return;
    if (sessionStatusRef.current === "accepted") return;
    const id = session.id;
    unavailablePromptStartedRef.current = id;
    startPrivateCallUnavailablePrompt({ callId: id, peerName: session.pastorName || "Pastor" });

    // Status could not be confirmed (network): end it only if it is still ringing. If the
    // pastor accepted meanwhile, stop the prompt and reopen the call so LiveKit connects.
    if (session.status === "ringing" && !endRequestedRef.current) {
      endRequestedRef.current = true;
      void endPrivateCallIfRinging(id)
        .then(async (res: any) => {
          if (res?.ok) return;
          const latest = await fetchPrivateCallSession(id).catch(() => null);
          if (latest?.status !== "accepted") return;
          stopPrivateCallUnavailablePrompt(id, "accepted-after-handoff");
          router.push({ pathname: "/more/private-call/[callId]", params: { callId: id } } as any);
        })
        .catch(() => null);
    }

    exitCallScreen("unavailable-prompt-handoff", { status: session.status });
  }, [session, role, exitCallScreen, router]);

  // Same hand-off the session poll does when it sees the pastor accept.
  const applyAcceptedFromRingLimit = useCallback(
    (next: PrivateCallSession, source: string) => {
      if (sessionStatusRef.current === "accepted") return;
      const wasRinging = sessionStatusRef.current === "ringing";
      setSession(next);
      sessionStatusRef.current = next.status;
      if (wasRinging && !liveKitJoinRef.current && !liveKitBindingRef.current) {
        latencyMarksRef.current.acceptDetected = Date.now();
        logPrivateCallAudioLatencyDiag(latencyMarksRef.current, "accept-detected-poll", {
          callId: next.id,
          source,
        });
        void startLiveKitJoin(next, source);
      }
    },
    [startLiveKitJoin]
  );

  // 29s ring limit reached (the waittone is already stopped). Decide from the server
  // state whether the caller hears the "unavailable" prompt:
  // - accepted  -> no prompt, hand over to the LiveKit call;
  // - declined / timeout -> prompt, nothing to end;
  // - ringing   -> end the call, then prompt;
  // - anything else (ended elsewhere, Cancel in progress) -> no prompt.
  // The end request is conditional (endPrivateCallIfRinging): the server ends the call
  // only if it is still ringing and keeps an accepted call (HTTP 409), in which case
  // the caller joins LiveKit and no prompt plays.
  const handleRingLimitReached = useCallback(async (): Promise<boolean> => {
    if (!session) return false;
    const ringingCallId = session.id;
    const cancelled = () => endRequestedRef.current || exitHandledRef.current;
    const accepted = () => sessionStatusRef.current === "accepted";

    const readStatus = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const latest = await fetchPrivateCallSession(ringingCallId).catch(() => null);
        if (latest) return latest;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return null;
    };

    const decide = (latest: PrivateCallSession | null, step: string): boolean | "end" => {
      console.log("KRISTO_PRIVATE_CALL_RING_LIMIT_STATUS_CHECK", {
        callId: ringingCallId,
        step,
        status: latest?.status || null,
        localStatus: sessionStatusRef.current || null,
      });
      if (cancelled() || accepted()) return false;
      if (!latest) return true; // unconfirmed: prompt only, never end blindly
      if (latest.status === "accepted") {
        applyAcceptedFromRingLimit(latest, `ring-limit-${step}`);
        return false;
      }
      if (latest.status === "declined" || latest.status === "timeout") {
        unavailablePromptStartedRef.current = ringingCallId;
        setSession(latest);
        return true;
      }
      if (latest.status === "ringing") return "end";
      setSession(latest); // ended/failed elsewhere: normal termination path
      return false;
    };

    const first = decide(await readStatus(), "before-end");
    if (first !== "end") return first;

    // Confirmed ringing: end it (only if still ringing on the server) so the pastor can
    // no longer accept. The prompt ref is set first so the poll/terminal handlers keep
    // the No answer screen up.
    unavailablePromptStartedRef.current = ringingCallId;
    endRequestedRef.current = true;
    const res: any = await endPrivateCallIfRinging(ringingCallId).catch(() => null);
    console.log("KRISTO_PRIVATE_CALL_RING_LIMIT_ENDED", {
      callId: ringingCallId,
      ok: !!res?.ok,
      status: res?.data?.status || null,
      code: res?.code || null,
    });
    // Cancel was pressed while the conditional end was in flight: handleEndCall skipped
    // its own end (one was already requested) and left the screen. If the server kept
    // the call (accepted), end it now so the pastor is not left alone in the call.
    const endIfCancelledMeanwhile = () => {
      if (!exitHandledRef.current) return false;
      if (res?.ok) return true;
      console.log("KRISTO_PRIVATE_CALL_RING_LIMIT_CANCELLED_DURING_END", { callId: ringingCallId });
      void endPrivateCall(ringingCallId).catch(() => null);
      return true;
    };
    if (endIfCancelledMeanwhile()) return false;

    if (res?.data?.status === "accepted") {
      // Server kept the call because the pastor accepted first: no prompt, join LiveKit.
      unavailablePromptStartedRef.current = "";
      endRequestedRef.current = false;
      applyAcceptedFromRingLimit(res.data, "ring-limit-end-kept-accepted");
      return false;
    }
    if (res?.ok && res?.data) {
      if (accepted()) return false;
      if (res.data.acceptedAt) {
        // Defensive: the conditional end never ends an accepted call, but if a
        // session ever comes back accepted-then-ended, do not play the prompt;
        // leave through the normal call-ended path.
        console.warn("KRISTO_PRIVATE_CALL_RING_LIMIT_RACE_ENDED_ACCEPTED", {
          callId: ringingCallId,
          acceptedAt: res.data.acceptedAt,
        });
        unavailablePromptStartedRef.current = "";
        setSession(res.data);
        return false;
      }
      setSession(res.data);
      return true;
    }

    // End was rejected (e.g. the call changed state meanwhile): re-read and decide again.
    unavailablePromptStartedRef.current = "";
    endRequestedRef.current = false;
    const second = decide(await readStatus(), "after-end-rejected");
    if (second === "end") {
      // Still ringing but the end request failed: play the prompt; the call is ended
      // when the prompt finishes (handleEndCall) unless the pastor accepts first.
      unavailablePromptStartedRef.current = ringingCallId;
      return true;
    }
    return second;
  }, [applyAcceptedFromRingLimit, session]);

  const statusMessage = (() => {
    if (!session) return "";
    if (session.status === "ringing" && role === "caller") {
      return `Calling your Pastor…`;
    }
    if (session.status === "ringing" && role === "pastor") {
      return `${session.callerName} is calling`;
    }
    if (session.status === "declined") return "Call declined.";
    if (session.status === "timeout") return "No answer.";
    if (session.status === "ended") return "Call ended.";
    return "";
  })();

  const displayName =
    role === "caller" ? session?.pastorName || "Pastor" : session?.callerName || "Caller";
  const displayAvatar =
    role === "caller" ? session?.pastorAvatarUrl : session?.callerAvatarUrl;

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 24 }]}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  if (error || !session) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingHorizontal: 24 }]}>
        <Text style={styles.title}>Private Call</Text>
        <Text style={styles.errorText}>{error || "Call unavailable."}</Text>
        <Pressable onPress={leaveCallRoute} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (session.status === "accepted" && !PRIVATE_CALL_AUDIO_ENABLED && connectedPeerDisplay) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.centerStage}>
          <PrivateCallAvatar
            avatarUri={connectedPeerDisplay.peerAvatar}
            animate
          />

          <Text style={styles.title}>Connected</Text>
          <Text style={styles.subtitle}>
            {connectedPeerDisplay.peerName}
          </Text>

          <View style={styles.connectedControls}>
            <Pressable
              onPress={handleEndCall}
              style={styles.endBtn}
            >
              <Ionicons
                name="call"
                size={20}
                color="#fff"
              />
              <Text style={styles.endBtnText}>
                End Call
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (session.status === "accepted" && liveKitBinding && connectedPeerDisplay) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <PrivateCallOngoingView
          callId={session.id}
          peerName={connectedPeerDisplay.peerName}
          peerAvatar={connectedPeerDisplay.peerAvatar}
          onEnd={() => void handleEndCall()}
          onMinimize={leaveCallRoute}
        />
      </View>
    );
  }

  if (
    session.status === "accepted" &&
    PRIVATE_CALL_AUDIO_ENABLED &&
    !liveKitBinding
  ) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 24 }]}>
        <ActivityIndicator color={GOLD} />
        <Text style={styles.subtitle}>Joining private call…</Text>
      </View>
    );
  }

  const isOutgoingCaller = role === "caller";
  // Declined / timed out while the caller was still hearing the waittone: play the
  // unavailable prompt right away instead of waiting for the 29s ring limit.
  const callerUnanswered =
    isOutgoingCaller &&
    outgoingRingingAudioStartedRef.current === session.id &&
    (session.status === "timeout" || session.status === "declined");
  const showNoAnswerScreen =
    isOutgoingCaller &&
    (callerUnanswered ||
      session.status === "timeout" ||
      (unavailablePromptStarted &&
        (session.status === "ringing" || session.status === "ended")));
  const shouldPlayRingingAudio =
    isOutgoingCaller &&
    !ringingAudioStopped &&
    (session.status === "ringing" ||
      callerUnanswered ||
      (unavailablePromptStarted && session.status === "ended"));

  // Rendered as the first child of the same Fragment in both the ringing and the
  // no-answer screens, so React keeps ONE instance mounted across the
  // ringing -> no-answer transition and the prompt is not cut off or restarted.
  const ringingAudio = shouldPlayRingingAudio ? (
    <PrivateCallRingingAudio
      key={`ringing-audio-${session.id}`}
      callId={session.id}
      forceUnavailable={callerUnanswered}
      onRingLimitReached={handleRingLimitReached}
      onUnavailableStarted={handleUnavailablePromptStarted}
      onRingingStarted={() => {
        outgoingRingingAudioStartedRef.current = session.id;
      }}
    />
  ) : null;

  const cancelCallButton = (
    <Pressable
      onPress={handleCancelOutgoingCall}
      disabled={actionBusy}
      accessibilityRole="button"
      accessibilityLabel="Cancel call"
      hitSlop={8}
      style={({ pressed }) => [
        styles.cancelCallBtn,
        (pressed || actionBusy) && styles.cancelCallBtnPressed,
      ]}
    >
      <View style={styles.cancelCallIconWrap}>
        <Ionicons name="call" size={18} color="#FFF" style={styles.cancelCallIcon} />
      </View>
      <Text style={styles.cancelCallBtnText}>
        {actionBusy ? "Ending call…" : "Cancel call"}
      </Text>
    </Pressable>
  );

  if (showNoAnswerScreen) {
    return (
      <>
        {ringingAudio}
        <View style={[styles.screen, styles.terminalCallScreen, { paddingTop: insets.top + 24 }]}>
          <View style={styles.terminalCallCard}>
            <PrivateCallAvatar avatarUri={displayAvatar} animate={false} />
            <Text style={styles.terminalEyebrow}>NO ANSWER</Text>
            <Text style={styles.title}>{displayName}</Text>
            <Text style={styles.noAnswerSubtitle}>
              {unavailablePromptStarted
                ? "Hapatikani kwa sasa. Tafadhali jaribu tena baadaye."
                : "Hakupokea simu."}
            </Text>
            {unavailablePromptStarted && shouldPlayRingingAudio ? (
              <View style={styles.terminalStatusPill}>
                <Ionicons name="volume-high" size={15} color={GOLD} />
                <Text style={styles.terminalStatusText}>Ujumbe wa sauti unacheza…</Text>
              </View>
            ) : null}
            {cancelCallButton}
          </View>
        </View>
      </>
    );
  }

  if (session.status === "declined" || session.status === "timeout" || session.status === "ended") {
    return (
      <View style={[styles.screen, styles.terminalCallScreen, { paddingTop: insets.top + 24 }]}>
        <View style={styles.terminalCallCard}>
          <View style={styles.terminalIconCircle}>
            <Ionicons
              name={session.status === "declined" ? "call" : "call-outline"}
              size={25}
              color={GOLD}
            />
          </View>
          <Text style={styles.terminalEyebrow}>SIMU IMEISHIA</Text>
          <Text style={styles.title}>{statusMessage}</Text>
          <Pressable
            onPress={leaveCallRoute}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.terminalCloseBtn,
              pressed && styles.terminalCloseBtnPressed,
            ]}
          >
            <Ionicons name="arrow-back" size={19} color="#10131B" />
            <Text style={styles.terminalCloseBtnText}>Rudi nyuma</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <>
    {ringingAudio}
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingHorizontal: 24 }]}>
      <Pressable
        onPress={() => {
          if (session.status === "ringing") {
            handleCancelOutgoingCall();
            return;
          }
          leaveCallRoute();
        }}
        style={styles.backBtn}
        hitSlop={12}
      >
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Pressable>

      <View style={styles.centerStage}>
        <PrivateCallAvatar avatarUri={displayAvatar} animate />

        {session.status === "ringing" && role === "caller" ? (
          <>
            <Text style={styles.title}>{displayName}</Text>
            <PrivateCallOutgoingRinging callId={session.id} />
            {cancelCallButton}
          </>
        ) : (
          <>
            <Text style={styles.title}>{statusMessage || "Private Call"}</Text>
            <Text style={styles.subtitle}>{displayName}</Text>

            {session.status === "ringing" && role === "pastor" ? (
              <View style={styles.actionRow}>
                <Pressable
                  onPress={handleDecline}
                  disabled={actionBusy}
                  style={[styles.circleBtn, styles.declineBtn]}
                >
                  <Ionicons name="close" size={28} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={handleAccept}
                  disabled={actionBusy}
                  style={[styles.circleBtn, styles.acceptBtn]}
                >
                  <Ionicons name="call" size={26} color="#fff" />
                </Pressable>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  ongoingViewRoot: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  ongoingHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 300,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  centerStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 20,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  durationText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.2,
    textAlign: "center",
  },
  connectedControls: {
    marginTop: 28,
    alignItems: "center",
    gap: 18,
  },
  muteCircleBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  muteCircleBtnActive: {
    backgroundColor: "rgba(214,78,78,0.28)",
    borderColor: "rgba(214,78,78,0.55)",
  },
  muteLabel: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 11,
    fontWeight: "800",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitle: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  outgoingRingBlock: {
    marginTop: 10,
    alignItems: "center",
    gap: 10,
  },
  outgoingRingAnimHost: {
    width: 132,
    height: 132,
    alignItems: "center",
    justifyContent: "center",
  },
  outgoingRipple: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.04)",
  },
  outgoingRippleSoft: {
    borderColor: "rgba(217,179,95,0.32)",
    borderWidth: 1,
  },
  outgoingGlow: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(217,179,95,0.22)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  outgoingIconCore: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  outgoingCallingLabel: {
    color: "rgba(217,179,95,0.88)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
    textAlign: "center",
  },
  cancelCallBtn: {
    marginTop: 22,
    alignSelf: "center",
    maxWidth: 320,
    width: "100%",
    minHeight: 58,
    borderRadius: 29,
    paddingHorizontal: 22,
    backgroundColor: "#E5484D",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    shadowColor: "#E5484D",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  cancelCallIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  cancelCallBtnPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  cancelCallIcon: {
    transform: [{ rotate: "135deg" }],
  },
  cancelCallBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  terminalCallScreen: {
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  terminalCallCard: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 34,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.3)",
    backgroundColor: "rgba(20,25,35,0.96)",
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
    gap: 14,
  },
  terminalEyebrow: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
    marginTop: 6,
  },
  terminalStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(217,179,95,0.1)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.2)",
    marginTop: 4,
  },
  terminalStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
  },
  noAnswerSubtitle: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  terminalStatusText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "700",
  },
  terminalIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.1)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
  },
  terminalCloseBtn: {
    marginTop: 12,
    minWidth: 230,
    minHeight: 54,
    borderRadius: 27,
    paddingHorizontal: 22,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    shadowColor: "#D9B35F",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  terminalCloseBtnPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  terminalCloseBtnText: {
    color: "#10131B",
    fontSize: 15,
    fontWeight: "900",
  },
  actionRow: {
    flexDirection: "row",
    gap: 28,
    marginTop: 28,
  },
  circleBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    backgroundColor: "rgba(34,197,94,0.92)",
  },
  declineBtn: {
    backgroundColor: "rgba(214,78,78,0.92)",
  },
  endBtn: {
    minWidth: 160,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(214,78,78,0.92)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  endBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
  },
  secondaryBtn: {
    marginTop: 24,
    minWidth: 160,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  secondaryBtnText: {
    color: "rgba(255,255,255,0.88)",
    fontWeight: "800",
    fontSize: 14,
  },
  errorText: {
    marginTop: 12,
    color: "#FF9B9B",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 22,
  },
});
