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
import { LiveKitRoom, useRoomContext } from "@livekit/react-native";
import { RoomEvent } from "livekit-client";

import LiveMainStageSaturnOrbit from "@/src/components/live/LiveMainStageSaturnOrbit";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { PrivateCallAudioRenderer } from "@/src/lib/privateCallAudioRenderer";
import { buildLiveKitRoomOptions } from "@/src/lib/liveKitVideoQuality";
import {
  acceptPrivateCall,
  declinePrivateCall,
  endPrivateCall,
  fetchPrivateCallLiveKitCredentials,
  fetchPrivateCallSession,
  isPrivateCallTerminalStatus,
  type PrivateCallSession,
} from "@/src/lib/privateCallService";

const BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.92)";
const LIVEKIT_CONNECT_OPTIONS = { autoSubscribe: true, maxRetries: 2, websocketTimeout: 15000 };
const LIVEKIT_ROOM_OPTIONS = buildLiveKitRoomOptions();
const AVATAR_SIZE = 112;
const RINGING_SESSION_POLL_MS = 2000;
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
  session,
  currentUserId,
  onEnd,
}: {
  session: PrivateCallSession;
  currentUserId: string;
  onEnd: () => void;
}) {
  const room = useRoomContext();
  const isCaller = session.callerUserId === currentUserId;
  const peerName = isCaller ? session.pastorName : session.callerName;
  const peerAvatar = isCaller ? session.pastorAvatarUrl : session.callerAvatarUrl;

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
      callId: session.id,
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
        callId: session.id,
        currentUserId,
        elapsedSec: elapsedSecRef.current,
      });
    };
  }, [session.id, currentUserId]);

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
      callId: session.id,
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
  const [liveKit, setLiveKit] = useState<{ url: string; token: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const exitHandledRef = useRef(false);
  const endRequestedRef = useRef(false);
  const roomDisconnectRef = useRef<(() => void) | null>(null);

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

  const peerUserId = useMemo(() => {
    if (!session || !currentUserId) return "";
    if (session.callerUserId === currentUserId) return session.pastorUserId;
    if (session.pastorUserId === currentUserId) return session.callerUserId;
    return "";
  }, [session, currentUserId]);

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
  }, [callId]);

  useEffect(() => {
    if (!session || loading || isPrivateCallTerminalStatus(session.status)) return;

    const pollMs =
      session.status === "accepted" ? CONNECTED_SESSION_POLL_MS : RINGING_SESSION_POLL_MS;

    const poll = async () => {
      const next = await fetchPrivateCallSession(callId);
      if (!next) return;
      setSession(next);
      if (isPrivateCallTerminalStatus(next.status)) {
        handleRemoteTermination("session-poll", next.status);
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, pollMs);

    return () => clearInterval(timer);
  }, [callId, loading, session?.status, handleRemoteTermination]);

  useEffect(() => {
    if (loading || !session || exitHandledRef.current) return;
    if (!isPrivateCallTerminalStatus(session.status)) return;
    handleRemoteTermination("session-loaded-terminal", session.status);
  }, [loading, session, handleRemoteTermination]);

  useEffect(() => {
    if (!session || session.status !== "accepted" || liveKit) return;

    let alive = true;
    (async () => {
      const creds = await fetchPrivateCallLiveKitCredentials({
        roomName: session.roomName,
        identity: currentUserId,
      });
      if (!alive || !creds) return;
      setLiveKit(creds);
    })();

    return () => {
      alive = false;
    };
  }, [session?.status, session?.roomName, currentUserId, liveKit]);

  const handleAccept = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    try {
      const res: any = await acceptPrivateCall(session.id);
      if (res?.ok && res?.data) {
        setSession(res.data);
        console.log("KRISTO_PRIVATE_CALL_ACCEPTED", {
          callId: session.id,
          pastorUserId: currentUserId,
        });
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

  if (session.status === "accepted" && liveKit) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <LiveKitRoom
          serverUrl={liveKit.url}
          token={liveKit.token}
          connect
          audio
          video={false}
          connectOptions={LIVEKIT_CONNECT_OPTIONS as any}
          options={LIVEKIT_ROOM_OPTIONS as any}
        >
          <PrivateCallHangupSync
            callId={session.id}
            peerUserId={peerUserId}
            onRemoteTermination={handleRemoteTermination}
            registerRoomDisconnect={registerRoomDisconnect}
          />
          <PrivateCallAudioRenderer
            callId={session.id}
            roomName={session.roomName}
            currentUserId={currentUserId}
          />
          <PrivateCallConnectedRoom
            session={session}
            currentUserId={currentUserId}
            onEnd={handleEnd}
          />
        </LiveKitRoom>
      </View>
    );
  }

  if (session.status === "accepted" && !liveKit) {
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
