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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  RoomContext,
  registerGlobals,
  useRoomContext,
} from "@livekit/react-native";
import { Room, RoomEvent } from "livekit-client";

import LiveMainStageSaturnOrbit from "@/src/components/live/LiveMainStageSaturnOrbit";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  PrivateCallAudioRenderer,
  PrivateCallLiveKitRoomDiagnostics,
  ensurePrivateCallAudioSession,
  logPrivateCallAudioLatencyDiag,
} from "@/src/lib/privateCallAudioRenderer";
import { logLiveKitTokenClaims } from "@/src/lib/liveKitTokenDecode";
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

type PreconnectedPrivateCallRoom = {
  callId: string;
  roomName: string;
  serverUrl: string;
  token: string;
  room: Room;
  subscriptionBridgeCleanup?: () => void;
};

const preconnectedPrivateCallRooms = new Map<
  string,
  PreconnectedPrivateCallRoom
>();

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

  const reconcilePublication = (
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

    if (publication?.isSubscribed && publication?.track) {
      console.log(
        "KRISTO_PRIVATE_CALL_RINGING_SUBSCRIPTION_ALREADY_READY",
        {
          ...meta,
          identity: String(participant?.identity || ""),
          trackSid,
          reason,
          ts: Date.now(),
        }
      );
      return;
    }

    if (requestedTrackSids.has(trackSid)) return;
    if (typeof publication?.setSubscribed !== "function") return;

    requestedTrackSids.add(trackSid);

    console.log("KRISTO_PRIVATE_CALL_RINGING_SUBSCRIBE_REQUEST", {
      ...meta,
      identity: String(participant?.identity || ""),
      participantSid: String(participant?.sid || ""),
      trackSid,
      reason,
      isDesired: publication?.isDesired !== false,
      isSubscribed: !!publication?.isSubscribed,
      hasTrack: !!publication?.track,
      ts: Date.now(),
    });

    try {
      publication.setSubscribed(true);
    } catch (error: any) {
      requestedTrackSids.delete(trackSid);

      console.log("KRISTO_PRIVATE_CALL_RINGING_SUBSCRIPTION_ERROR", {
        ...meta,
        identity: String(participant?.identity || ""),
        trackSid,
        reason,
        error: String(error?.message || error),
        ts: Date.now(),
      });
    }
  };

  const primeParticipant = (participant: any, reason: string) => {
    if (!participant || participant.isLocal) return;

    participant.trackPublications?.forEach?.((publication: any) => {
      reconcilePublication(publication, participant, reason);
    });
  };

  const primeAll = (reason: string) => {
    room.remoteParticipants.forEach((participant: any) => {
      primeParticipant(participant, reason);
    });
  };

  const onTrackPublished = (publication: any, participant: any) => {
    reconcilePublication(
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

function takePreconnectedPrivateCallRoom(
  callId: string,
  roomName: string
): PreconnectedPrivateCallRoom | null {
  const existing = preconnectedPrivateCallRooms.get(callId) || null;
  if (!existing) return null;

  if (existing.roomName !== roomName) {
    preconnectedPrivateCallRooms.delete(callId);
    existing.subscriptionBridgeCleanup?.();
    void existing.room.disconnect(true);
    return null;
  }

  preconnectedPrivateCallRooms.delete(callId);
  return existing;
}

async function disposePreconnectedPrivateCallRoom(callId: string) {
  const existing = preconnectedPrivateCallRooms.get(callId);
  if (!existing) return;

  preconnectedPrivateCallRooms.delete(callId);
  existing.subscriptionBridgeCleanup?.();

  try {
    await existing.room.disconnect(true);
  } catch {
    // Best effort cleanup.
  }
}

type ConnectedPeerDisplay = {
  peerName: string;
  peerAvatar?: string;
};
const AVATAR_SIZE = 112;
const RINGING_SESSION_POLL_MS = 500;
const CONNECTED_SESSION_POLL_MS = 1500;
const REMOTE_DISCONNECT_GRACE_MS = 5000;
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

function PrivateCallHangupSync({
  callId,
  peerUserId,
  onRemoteTermination,
  registerRoomDisconnect,
}: {
  callId: string;
  peerUserId: string;
  onRemoteTermination: (source: string, status: string) => void;
  registerRoomDisconnect: (disconnect: (() => void) | null) => void;
}) {
  const room = useRoomContext();
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    registerRoomDisconnect(() => {
      void room?.disconnect(true);
    });
    return () => registerRoomDisconnect(null);
  }, [room, registerRoomDisconnect]);

  useEffect(() => {
    if (!room) return;

    const clearGrace = () => {
      if (!graceTimerRef.current) return;
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    };

    const verifySessionAfterDisconnect = async (source: string) => {
      const next = await fetchPrivateCallSession(callId).catch(() => null);
      if (next && isPrivateCallTerminalStatus(next.status)) {
        onRemoteTermination(source, next.status);
      }
    };

    const onParticipantDisconnected = (participant: any) => {
      if (participant?.isLocal) return;
      const identity = String(participant?.identity || "").trim();
      if (peerUserId && identity !== peerUserId) return;

      console.log("KRISTO_PRIVATE_CALL_REMOTE_PARTICIPANT_DISCONNECTED", {
        callId,
        peerUserId,
        identity,
      });

      clearGrace();
      graceTimerRef.current = setTimeout(() => {
        void verifySessionAfterDisconnect("participant-disconnected-grace");
      }, REMOTE_DISCONNECT_GRACE_MS);
    };

    const onParticipantConnected = (participant: any) => {
      if (participant?.isLocal) return;
      const identity = String(participant?.identity || "").trim();
      if (peerUserId && identity === peerUserId) {
        clearGrace();
      }
    };

    const onReconnecting = () => {
      clearGrace();
    };

    const onDisconnected = () => {
      void verifySessionAfterDisconnect("room-disconnected");
    };

    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      clearGrace();
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, callId, peerUserId, onRemoteTermination]);

  return null;
}

function PrivateCallConnectedRoom({
  callId,
  peerName,
  peerAvatar,
  currentUserId,
  onEnd,
}: {
  callId: string;
  peerName: string;
  peerAvatar?: string;
  currentUserId: string;
  onEnd: () => void;
}) {
  const room = useRoomContext();

  const [micEnabled, setMicEnabled] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const durationStartedRef = useRef(false);
  const elapsedSecRef = useRef(0);

  const applyMicState = useCallback(
    (enabled: boolean) => {
      if (!room) return;
      void room.localParticipant.setMicrophoneEnabled(enabled).catch(() => {});
    },
    [room]
  );

  useEffect(() => {
    if (!room) return;

    const syncMic = () => applyMicState(micEnabled);

    syncMic();
    room.on(RoomEvent.Connected, syncMic);
    room.on(RoomEvent.Reconnected, syncMic);

    return () => {
      room.off(RoomEvent.Connected, syncMic);
      room.off(RoomEvent.Reconnected, syncMic);
    };
  }, [room, micEnabled, applyMicState]);

  useEffect(() => {
    if (durationStartedRef.current) return;
    durationStartedRef.current = true;

    console.log("KRISTO_PRIVATE_CALL_DURATION_START", {
      callId,
      currentUserId,
    });

    const timer = setInterval(() => {
      setElapsedSec((current) => {
        const next = current + 1;
        elapsedSecRef.current = next;
        return next;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      console.log("KRISTO_PRIVATE_CALL_DURATION_STOP", {
        callId,
        currentUserId,
        elapsedSec: elapsedSecRef.current,
      });
    };
  }, [callId, currentUserId]);

  const handleToggleMute = async () => {
    if (!room) return;
    const nextMicEnabled = !micEnabled;
    setMicEnabled(nextMicEnabled);
    try {
      await room.localParticipant.setMicrophoneEnabled(nextMicEnabled);
    } catch {
      setMicEnabled(micEnabled);
      return;
    }

    console.log("KRISTO_PRIVATE_CALL_MUTE_TOGGLE", {
      callId,
      currentUserId,
      muted: !nextMicEnabled,
      micEnabled: nextMicEnabled,
    });
  };

  return (
    <View style={styles.centerStage}>
      <PrivateCallAvatar avatarUri={peerAvatar} animate />

      <Text style={styles.title}>Connected</Text>
      {elapsedSec > 0 ? (
        <Text style={styles.durationText}>{formatCallDuration(elapsedSec)}</Text>
      ) : null}
      <Text style={styles.subtitle}>{peerName}</Text>

      <View style={styles.connectedControls}>
        <Pressable
          onPress={() => void handleToggleMute()}
          style={[styles.muteCircleBtn, !micEnabled && styles.muteCircleBtnActive]}
        >
          <Ionicons
            name={micEnabled ? "mic" : "mic-off"}
            size={24}
            color="#fff"
          />
          <Text style={styles.muteLabel}>{micEnabled ? "Mic On" : "Muted"}</Text>
        </Pressable>

        <Pressable onPress={onEnd} style={styles.endBtn}>
          <Ionicons name="call" size={20} color="#fff" />
          <Text style={styles.endBtnText}>End Call</Text>
        </Pressable>
      </View>
    </View>
  );
}

const PrivateCallLiveKitShell = React.memo(function PrivateCallLiveKitShell({
  binding,
  peerUserId,
  currentUserId,
  peerDisplay,
  onEndRef,
  onRemoteTerminationRef,
  registerRoomDisconnect,
  latencyMarksRef,
}: {
  binding: StableLiveKitBinding;
  peerUserId: string;
  currentUserId: string;
  peerDisplay: ConnectedPeerDisplay;
  onEndRef: React.MutableRefObject<() => void>;
  onRemoteTerminationRef: React.MutableRefObject<(source: string, status: string) => void>;
  registerRoomDisconnect: (disconnect: (() => void) | null) => void;
  latencyMarksRef: React.MutableRefObject<Record<string, number>>;
}) {
  const liveKitRoomKey = useMemo(
    () => `${binding.callId}|${binding.roomName}|${binding.token}`,
    [binding.callId, binding.roomName, binding.token]
  );
  const liveKitOptions = useMemo(() => buildLiveKitRoomOptions(), []);
  const stableConnectOptions = useMemo(() => buildPrivateCallConnectOptions(), []);
  const [ownedRoom, setOwnedRoom] = useState<Room | null>(null);
  const connectSessionRef = useRef(0);
  const mountLoggedRef = useRef("");

  useEffect(() => {
    console.log("KRISTO_PRIVATE_CALL_LIVEKIT_KEY", {
      liveKitRoomKey,
      callId: binding.callId,
      roomName: binding.roomName,
    });
    console.log("KRISTO_PRIVATE_CALL_LIVEKIT_PROPS_STABLE", {
      callId: binding.callId,
      roomName: binding.roomName,
      serverUrl: binding.serverUrl,
      tokenLen: binding.token.length,
      connect: true,
      audioCapture: false,
      autoSubscribe: stableConnectOptions.autoSubscribe,
      ts: Date.now(),
    });
    logLiveKitTokenClaims(binding.token, {
      source: "private-call-shell-bind",
      callId: binding.callId,
      roomName: binding.roomName,
    });
  }, [
    binding.callId,
    binding.roomName,
    binding.serverUrl,
    binding.token,
    liveKitRoomKey,
    stableConnectOptions.autoSubscribe,
  ]);

  useEffect(() => {
    const session = ++connectSessionRef.current;

    const preconnected = takePreconnectedPrivateCallRoom(
      binding.callId,
      binding.roomName
    );

    const room = preconnected?.room || new Room(liveKitOptions);

    void (async () => {
      try {
        if (preconnected) {
          const hadRingingOwner =
            !!preconnected.subscriptionBridgeCleanup;

          preconnected.subscriptionBridgeCleanup?.();

          console.log(
            "KRISTO_PRIVATE_CALL_SUBSCRIPTION_OWNER_HANDOFF",
            {
              callId: binding.callId,
              roomName: binding.roomName,
              roomInstanceId:
                getPrivateCallRoomInstanceId(room),
              from: hadRingingOwner ? "ringing" : "none",
              to: "renderer",
              ts: Date.now(),
            }
          );

          console.log("KRISTO_PRIVATE_CALL_PRECONNECTED_ROOM_ADOPTED", {
            callId: binding.callId,
            roomName: binding.roomName,
            ringingSubscriptionBridgeActive: false,
            ts: Date.now(),
          });
        } else {
          console.log("KRISTO_PRIVATE_CALL_ROOM_CONNECT_START", {
            callId: binding.callId,
            roomName: binding.roomName,
            autoSubscribeRequested: stableConnectOptions.autoSubscribe,
            ts: Date.now(),
          });

          await room.connect(
            binding.serverUrl,
            binding.token,
            stableConnectOptions
          );
        }

        if (session !== connectSessionRef.current) {
          await room.disconnect(true);
          return;
        }

        logPrivateCallAutoSubscribeEffective(room, {
          callId: binding.callId,
          roomName: binding.roomName,
          source: preconnected
            ? "ringing-preconnect-adopted"
            : "manual-room-connect",
          requestedAutoSubscribe: stableConnectOptions.autoSubscribe,
        });

        setOwnedRoom(room);

        void room.localParticipant
          .setMicrophoneEnabled(true)
          .catch((error: any) => {
            console.log("KRISTO_PRIVATE_CALL_MIC_ENABLE_ERROR", {
              callId: binding.callId,
              roomName: binding.roomName,
              error: String(error?.message || error),
              ts: Date.now(),
            });
          });
      } catch (error: any) {
        if (session !== connectSessionRef.current) return;

        console.log("KRISTO_PRIVATE_CALL_ROOM_CONNECT_ERROR", {
          callId: binding.callId,
          roomName: binding.roomName,
          source: preconnected
            ? "ringing-preconnect-adopt"
            : "manual-room-connect",
          error: String(error?.message || error),
          ts: Date.now(),
        });

        setOwnedRoom(null);
      }
    })();

    return () => {
      connectSessionRef.current++;
      void room.disconnect(true);
      setOwnedRoom(null);
    };
  }, [
    binding.callId,
    binding.roomName,
    binding.serverUrl,
    binding.token,
    liveKitOptions,
    stableConnectOptions,
  ]);

  useEffect(() => {
    if (mountLoggedRef.current === liveKitRoomKey) {
      console.log("KRISTO_PRIVATE_CALL_ROOM_REMOUNT_BLOCKED", {
        liveKitRoomKey,
        callId: binding.callId,
      });
      return;
    }
    if (mountLoggedRef.current) {
      console.log("KRISTO_PRIVATE_CALL_ROOM_UNMOUNT", {
        liveKitRoomKey: mountLoggedRef.current,
        callId: binding.callId,
      });
    }
    mountLoggedRef.current = liveKitRoomKey;
    const ts = Date.now();
    latencyMarksRef.current.roomMount = ts;
    logPrivateCallAudioLatencyDiag(latencyMarksRef.current, "room-mount", {
      callId: binding.callId,
    });
    console.log("KRISTO_PRIVATE_CALL_ROOM_MOUNT", {
      callId: binding.callId,
      currentUserId,
      liveKitRoomKey,
      ts,
    });

    return () => {
      console.log("KRISTO_PRIVATE_CALL_ROOM_UNMOUNT", {
        callId: binding.callId,
        liveKitRoomKey,
        ts: Date.now(),
      });
      if (mountLoggedRef.current === liveKitRoomKey) {
        mountLoggedRef.current = "";
      }
    };
  }, [binding.callId, currentUserId, latencyMarksRef, liveKitRoomKey]);

  const handleEnd = useCallback(() => {
    onEndRef.current();
  }, [onEndRef]);

  const handleRemoteTermination = useCallback(
    (source: string, status: string) => {
      onRemoteTerminationRef.current(source, status);
    },
    [onRemoteTerminationRef]
  );

  if (!ownedRoom) {
    return (
      <View style={styles.centerStage}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  return (
    <RoomContext.Provider value={ownedRoom}>
      <PrivateCallLiveKitRoomDiagnostics
        callId={binding.callId}
        roomName={binding.roomName}
        token={binding.token}
        currentUserId={currentUserId}
      />
      <PrivateCallHangupSync
        callId={binding.callId}
        peerUserId={peerUserId}
        onRemoteTermination={handleRemoteTermination}
        registerRoomDisconnect={registerRoomDisconnect}
      />
      <PrivateCallAudioRenderer
        callId={binding.callId}
        roomName={binding.roomName}
        currentUserId={currentUserId}
        latencyMarksRef={latencyMarksRef}
      />
      <PrivateCallConnectedRoom
        callId={binding.callId}
        peerName={peerDisplay.peerName}
        peerAvatar={peerDisplay.peerAvatar}
        currentUserId={currentUserId}
        onEnd={handleEnd}
      />
    </RoomContext.Provider>
  );
});

export default function PrivateCallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ callId?: string }>();
  const { session: authSession } = useKristoSession();

  const callId = String(params.callId || "").trim();
  const currentUserId = String(authSession?.userId || "").trim();

  const [session, setSession] = useState<PrivateCallSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveKitBinding, setLiveKitBinding] = useState<StableLiveKitBinding | null>(null);
  const [connectedPeerDisplay, setConnectedPeerDisplay] = useState<ConnectedPeerDisplay | null>(
    null
  );
  const [actionBusy, setActionBusy] = useState(false);
  const exitHandledRef = useRef(false);
  const endRequestedRef = useRef(false);
  const roomDisconnectRef = useRef<(() => void) | null>(null);
  const liveKitJoinRef = useRef(false);
  const liveKitBindingRef = useRef<StableLiveKitBinding | null>(null);
  const ringingPreconnectPromiseRef = useRef<Promise<void> | null>(null);
  const latencyMarksRef = useRef<Record<string, number>>({});
  const sessionStatusRef = useRef<string>("");
  const onEndRef = useRef<() => void>(() => {});
  const onRemoteTerminationRef = useRef<(source: string, status: string) => void>(() => {});

  const role = useMemo(() => {
    if (!session || !currentUserId) return "unknown";
    if (session.callerUserId === currentUserId) return "caller";
    if (session.pastorUserId === currentUserId) return "pastor";
    return "unknown";
  }, [session, currentUserId]);

  const registerRoomDisconnect = useCallback((disconnect: (() => void) | null) => {
    roomDisconnectRef.current = disconnect;
  }, []);

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
      exitHandledRef.current = true;

      try {
        roomDisconnectRef.current?.();
      } catch {
        // Best-effort LiveKit disconnect before leaving the screen.
      }

      console.log("KRISTO_PRIVATE_CALL_BOTH_SIDES_EXIT", {
        callId,
        currentUserId,
        source,
        ...(meta || {}),
      });
      router.back();
    },
    [callId, currentUserId, router]
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
      exitCallScreen("remote-end", { source, status });
    },
    [callId, currentUserId, exitCallScreen]
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

  onEndRef.current = handleEndCall;
  onRemoteTerminationRef.current = handleRemoteTermination;

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

          await room.connect(
            creds.url,
            creds.token,
            buildPrivateCallConnectOptions()
          );

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

  const handleEnd = handleEndCall;

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
        <Pressable onPress={() => router.back()} style={styles.secondaryBtn}>
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
        <PrivateCallLiveKitShell
          binding={liveKitBinding}
          peerUserId={peerUserId}
          currentUserId={currentUserId}
          peerDisplay={connectedPeerDisplay}
          onEndRef={onEndRef}
          onRemoteTerminationRef={onRemoteTerminationRef}
          registerRoomDisconnect={registerRoomDisconnect}
          latencyMarksRef={latencyMarksRef}
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

  if (session.status === "declined" || session.status === "timeout" || session.status === "ended") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingHorizontal: 24 }]}>
        <Text style={styles.title}>{statusMessage}</Text>
        <Pressable onPress={() => router.back()} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingHorizontal: 24 }]}>
      <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Pressable>

      <View style={styles.centerStage}>
        <PrivateCallAvatar avatarUri={displayAvatar} animate />

        {session.status === "ringing" && role === "caller" ? (
          <>
            <Text style={styles.title}>{displayName}</Text>
            <PrivateCallOutgoingRinging callId={session.id} />
            <Pressable onPress={handleEnd} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Cancel Call</Text>
            </Pressable>
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
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
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
