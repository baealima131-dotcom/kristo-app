import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { RoomContext, useRoomContext } from "@livekit/react-native";
import { ParticipantEvent, Room, RoomEvent, Track, type TrackPublication } from "livekit-client";

import {
  endKristoCallKitCall,
  onKristoCallKitMute,
  setKristoCallKitMuted,
  startKristoCallKitCall,
} from "@/src/lib/ios/kristoCallKit";
import { buildLiveKitRoomOptions } from "@/src/lib/liveKitVideoQuality";
import {
  PrivateCallAudioRenderer,
  PrivateCallLiveKitRoomDiagnostics,
  ensurePrivateCallAudioSession,
} from "@/src/lib/privateCallAudioRenderer";
import {
  buildPrivateCallConnectOptions,
  getPrivateCallRoomInstanceId,
  logPrivateCallAutoSubscribeEffective,
} from "@/src/lib/privateCallLiveKitConnect";
import {
  endOngoingPrivateCall,
  getOngoingPrivateCallState,
  setOngoingPrivateCallMic,
  setOngoingPrivateCallRoom,
  stopPrivateCallUnavailablePrompt,
  useOngoingPrivateCallState,
  type OngoingPrivateCall,
  type PrivateCallUnavailablePrompt,
} from "@/src/lib/privateCallOngoingStore";
import { takePreconnectedPrivateCallRoom } from "@/src/lib/privateCallPreconnect";
import { PRIVATE_CALL_UNAVAILABLE_SOURCE } from "@/src/lib/privateCallRingingAudio";
import { fetchPrivateCallSession, isPrivateCallTerminalStatus } from "@/src/lib/privateCallService";
import {
  startCallForegroundService,
  stopCallForegroundService,
} from "@/src/lib/push/kristoCallNotifications";

const GOLD = "rgba(217,179,95,0.92)";
const ONGOING_SESSION_POLL_MS = 2_000;
const REMOTE_DISCONNECT_GRACE_MS = 5_000;

export function formatOngoingCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Seconds since `startedAt`, ticking once a second (0 when not started). */
export function useOngoingCallElapsed(startedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

/**
 * Mounted once in the tabs layout. Owns the connected private call so it survives leaving the
 * call screen, shows the "Simu inaendelea" bar while the call screen is not on screen, and
 * plays the caller's "hapatikani" prompt as a small banner after the call screen closed.
 */
export function PrivateCallOngoingHost({ bottomOffset }: { bottomOffset: number }) {
  const ongoing = useOngoingPrivateCallState();
  const call = ongoing.call;

  return (
    <>
      {call ? <OngoingCallEngine key={call.callId} call={call} /> : null}
      {call && ongoing.focusedCallId !== call.callId ? (
        <OngoingCallBar
          call={call}
          startedAt={ongoing.startedAt}
          connected={!!ongoing.room}
          bottomOffset={bottomOffset}
        />
      ) : null}
      {ongoing.prompt && !call ? (
        <UnavailablePromptBanner key={ongoing.prompt.callId} prompt={ongoing.prompt} />
      ) : null}
    </>
  );
}

function OngoingCallEngine({ call }: { call: OngoingPrivateCall }) {
  const [room, setRoom] = useState<Room | null>(null);
  const latencyMarksRef = useRef<Record<string, number>>(call.latencyMarks || {});

  // Connect (or adopt the room preconnected while ringing). This component unmounts only when
  // the call ends (endOngoingPrivateCall), so navigation never disconnects the call.
  useEffect(() => {
    let active = true;
    const preconnected = takePreconnectedPrivateCallRoom(call.callId, call.roomName);
    const nextRoom = preconnected?.room || new Room(buildLiveKitRoomOptions());
    const connectOptions = buildPrivateCallConnectOptions();

    void ensurePrivateCallAudioSession(call.callId);

    void (async () => {
      try {
        if (preconnected) {
          preconnected.subscriptionBridgeCleanup?.();
          console.log("KRISTO_PRIVATE_CALL_PRECONNECTED_ROOM_ADOPTED", {
            callId: call.callId,
            roomName: call.roomName,
            roomInstanceId: getPrivateCallRoomInstanceId(nextRoom),
            owner: "ongoing-host",
            ts: Date.now(),
          });
        } else {
          console.log("KRISTO_PRIVATE_CALL_ROOM_CONNECT_START", {
            callId: call.callId,
            roomName: call.roomName,
            owner: "ongoing-host",
            ts: Date.now(),
          });
          await nextRoom.connect(call.serverUrl, call.token, connectOptions);
        }
        if (!active) {
          await nextRoom.disconnect(true);
          return;
        }
        logPrivateCallAutoSubscribeEffective(nextRoom, {
          callId: call.callId,
          roomName: call.roomName,
          source: preconnected ? "ringing-preconnect-adopted" : "manual-room-connect",
          requestedAutoSubscribe: connectOptions.autoSubscribe,
        });
        setRoom(nextRoom);
        setOngoingPrivateCallRoom(call.callId, nextRoom);
        const micEnabled = getOngoingPrivateCallState().micEnabled;
        void nextRoom.localParticipant.setMicrophoneEnabled(micEnabled).catch((error: any) => {
          console.log("KRISTO_PRIVATE_CALL_MIC_ENABLE_ERROR", {
            callId: call.callId,
            error: String(error?.message || error),
          });
        });
      } catch (error: any) {
        if (!active) return;
        console.log("KRISTO_PRIVATE_CALL_ROOM_CONNECT_ERROR", {
          callId: call.callId,
          roomName: call.roomName,
          owner: "ongoing-host",
          error: String(error?.message || error),
          ts: Date.now(),
        });
      }
    })();

    return () => {
      active = false;
      const roomState = String((nextRoom as any)?.state || "");
      console.log("KRISTO_PRIVATE_CALL_ROOM_SHELL_CLEANUP", {
        callId: call.callId,
        roomName: call.roomName,
        roomState,
        owner: "ongoing-host",
        ts: Date.now(),
      });
      if (roomState !== "disconnected" && roomState !== "disconnecting") {
        void nextRoom.disconnect(true).catch(() => {});
      }
      setOngoingPrivateCallRoom(call.callId, null);
    };
  }, [call.callId, call.roomName, call.serverUrl, call.token]);

  // iOS: the call lives in CallKit (system call UI, keeps running locked / in the background);
  // its End button hangs up. Android: foreground service with the ongoing-call notification.
  useEffect(() => {
    const callId = call.callId;
    void startKristoCallKitCall({
      callId,
      peerName: call.peerName,
      onEnd: () => void endOngoingPrivateCall("callkit-end", { notifyServer: true }),
    });
    void startCallForegroundService({ callId, peerName: call.peerName });
    console.log("KRISTO_PRIVATE_CALL_DURATION_START", {
      callId,
      currentUserId: call.currentUserId,
    });
    return () => {
      endKristoCallKitCall(callId);
      void stopCallForegroundService(callId);
      console.log("KRISTO_PRIVATE_CALL_DURATION_STOP", { callId });
    };
    // peerName only labels the system UI; the call keeps its first label.
  }, [call.callId]);

  // The other side (or the server) ended the call while the call screen may be closed.
  useEffect(() => {
    const callId = call.callId;
    const timer = setInterval(() => {
      void fetchPrivateCallSession(callId)
        .then((next) => {
          if (next && isPrivateCallTerminalStatus(next.status)) {
            void endOngoingPrivateCall(`remote-${next.status}`, { notifyServer: false });
          }
        })
        .catch(() => null);
    }, ONGOING_SESSION_POLL_MS);
    return () => clearInterval(timer);
  }, [call.callId]);

  if (!room) return null;

  return (
    <RoomContext.Provider value={room}>
      <PrivateCallLiveKitRoomDiagnostics
        callId={call.callId}
        roomName={call.roomName}
        token={call.token}
        currentUserId={call.currentUserId}
      />
      <OngoingHangupSync call={call} />
      <PrivateCallAudioRenderer
        callId={call.callId}
        roomName={call.roomName}
        currentUserId={call.currentUserId}
        latencyMarksRef={latencyMarksRef}
      />
      <OngoingMicSync call={call} />
    </RoomContext.Provider>
  );
}

/** Ends the local side when the peer leaves the room and the server confirms the call is over. */
function OngoingHangupSync({ call }: { call: OngoingPrivateCall }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const clearGrace = () => {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
    };
    const verify = async (source: string) => {
      const next = await fetchPrivateCallSession(call.callId).catch(() => null);
      if (next && isPrivateCallTerminalStatus(next.status)) {
        void endOngoingPrivateCall(`${source}-${next.status}`, { notifyServer: false });
      }
    };
    const onParticipantDisconnected = (participant: any) => {
      if (participant?.isLocal) return;
      const identity = String(participant?.identity || "").trim();
      if (call.peerUserId && identity !== call.peerUserId) return;
      console.log("KRISTO_PRIVATE_CALL_REMOTE_PARTICIPANT_DISCONNECTED", {
        callId: call.callId,
        peerUserId: call.peerUserId,
        identity,
      });
      clearGrace();
      graceTimer = setTimeout(() => void verify("participant-disconnected-grace"), REMOTE_DISCONNECT_GRACE_MS);
    };
    const onParticipantConnected = (participant: any) => {
      if (participant?.isLocal) return;
      if (String(participant?.identity || "").trim() === call.peerUserId) clearGrace();
    };
    const onDisconnected = () => void verify("room-disconnected");

    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.Reconnecting, clearGrace);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      clearGrace();
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.Reconnecting, clearGrace);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, call.callId, call.peerUserId]);

  return null;
}

/** Keeps the microphone, the in-app mute state and the iOS call UI mute in sync. */
function OngoingMicSync({ call }: { call: OngoingPrivateCall }) {
  const room = useRoomContext();
  const { micEnabled } = useOngoingPrivateCallState();

  useEffect(() => {
    if (!room) return;
    const apply = () => {
      void room.localParticipant.setMicrophoneEnabled(getOngoingPrivateCallState().micEnabled).catch(() => {});
    };
    room.on(RoomEvent.Connected, apply);
    room.on(RoomEvent.Reconnected, apply);
    return () => {
      room.off(RoomEvent.Connected, apply);
      room.off(RoomEvent.Reconnected, apply);
    };
  }, [room]);

  useEffect(() => {
    if (!room) return;
    void room.localParticipant.setMicrophoneEnabled(micEnabled).catch(() => {});
  }, [room, micEnabled]);

  // Real microphone track -> button + iOS call UI (e.g. muted by an audio interruption).
  useEffect(() => {
    if (!room) return;
    const local = room.localParticipant;
    const syncFromTrack = (publication: TrackPublication) => {
      if (publication?.source !== Track.Source.Microphone) return;
      const enabled = !publication.isMuted;
      setOngoingPrivateCallMic(call.callId, enabled);
      setKristoCallKitMuted(call.callId, !enabled);
    };
    local.on(ParticipantEvent.TrackMuted, syncFromTrack);
    local.on(ParticipantEvent.TrackUnmuted, syncFromTrack);
    local.on(ParticipantEvent.LocalTrackPublished, syncFromTrack);
    return () => {
      local.off(ParticipantEvent.TrackMuted, syncFromTrack);
      local.off(ParticipantEvent.TrackUnmuted, syncFromTrack);
      local.off(ParticipantEvent.LocalTrackPublished, syncFromTrack);
    };
  }, [room, call.callId]);

  // iOS call UI Mute button (locked screen / background).
  useEffect(() => {
    return onKristoCallKitMute(call.callId, (muted) => {
      setOngoingPrivateCallMic(call.callId, !muted);
      console.log("KRISTO_PRIVATE_CALL_MUTE_TOGGLE", {
        callId: call.callId,
        currentUserId: call.currentUserId,
        muted,
        micEnabled: !muted,
        source: "callkit",
      });
    });
  }, [call.callId, call.currentUserId]);

  return null;
}

/** "Simu inaendelea — Rudi kwenye simu" bar above the tabs, with return and hang-up buttons. */
function OngoingCallBar({
  call,
  startedAt,
  connected,
  bottomOffset,
}: {
  call: OngoingPrivateCall;
  startedAt: number;
  connected: boolean;
  bottomOffset: number;
}) {
  const router = useRouter();
  const elapsed = useOngoingCallElapsed(startedAt);
  const pulse = useRef(new Animated.Value(0)).current;
  const [hangingUp, setHangingUp] = useState(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const returnToCall = () => {
    console.log("KRISTO_PRIVATE_CALL_ONGOING_RETURN", { callId: call.callId });
    router.push({
      pathname: "/more/private-call/[callId]",
      params: call.returnTo ? { callId: call.callId, returnTo: call.returnTo } : { callId: call.callId },
    } as any);
  };

  const hangUp = () => {
    if (hangingUp) return;
    setHangingUp(true);
    void endOngoingPrivateCall("ongoing-bar-hangup", { notifyServer: true });
  };

  return (
    <View pointerEvents="box-none" style={[styles.barWrap, { bottom: bottomOffset }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={returnToCall}
          accessibilityRole="button"
          accessibilityLabel="Rudi kwenye simu"
          style={({ pressed }) => [styles.barMain, pressed && styles.pressed]}
        >
          <Animated.View style={[styles.liveDot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]} />
          <View style={styles.barTextWrap}>
            <Text style={styles.barTitle} numberOfLines={1}>
              Simu inaendelea · {call.peerName}
            </Text>
            <Text style={styles.barSubtitle} numberOfLines={1}>
              {connected ? formatOngoingCallDuration(elapsed) : "Inaunganisha…"} · Rudi kwenye simu
            </Text>
          </View>
          <Ionicons name="chevron-up" size={18} color="rgba(255,255,255,0.8)" />
        </Pressable>
        <Pressable
          onPress={hangUp}
          disabled={hangingUp}
          accessibilityRole="button"
          accessibilityLabel="Kata simu"
          hitSlop={6}
          style={({ pressed }) => [styles.hangupBtn, (pressed || hangingUp) && styles.pressed]}
        >
          <Ionicons name="call" size={18} color="#FFF" style={styles.hangupIcon} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Caller side, call not answered / declined: the "hapatikani kwa sasa" prompt keeps playing
 * after the call screen closed, shown as a short banner. It disappears when the prompt ends
 * (or the X is pressed).
 */
function UnavailablePromptBanner({ prompt }: { prompt: PrivateCallUnavailablePrompt }) {
  const insets = useSafeAreaInsets();
  const player = useAudioPlayer(PRIVATE_CALL_UNAVAILABLE_SOURCE, { keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const startedRef = useRef(false);
  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    let active = true;
    void (async () => {
      await ensurePrivateCallAudioSession(prompt.callId);
      if (!active) return;
      try {
        const current = playerRef.current;
        current.loop = false;
        current.volume = 1;
        await current.seekTo(0);
        if (!active) return;
        current.play();
        startedRef.current = true;
        console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_PROMPT_STARTED", { callId: prompt.callId, owner: "banner" });
      } catch (error: any) {
        console.warn("KRISTO_PRIVATE_CALL_UNAVAILABLE_PROMPT_PLAY_FAILED", {
          callId: prompt.callId,
          error: String(error?.message || error),
        });
        stopPrivateCallUnavailablePrompt(prompt.callId, "play-failed");
      }
    })();
    return () => {
      active = false;
      try {
        playerRef.current.pause();
      } catch {}
    };
  }, [prompt.callId]);

  useEffect(() => {
    if (startedRef.current && status.didJustFinish) {
      stopPrivateCallUnavailablePrompt(prompt.callId, "did-just-finish");
    }
  }, [prompt.callId, status.didJustFinish]);

  // Safety net if the player never reports the end.
  useEffect(() => {
    const durationSec = Number(status.duration || 0);
    const fallbackMs = (durationSec > 0 ? durationSec * 1000 : 24_000) + 4_000;
    const timer = setTimeout(() => stopPrivateCallUnavailablePrompt(prompt.callId, "fallback-timer"), fallbackMs);
    return () => clearTimeout(timer);
  }, [prompt.callId, status.duration]);

  return (
    <View pointerEvents="box-none" style={[styles.promptWrap, { top: insets.top + 8 }]}>
      <View style={styles.promptCard}>
        <View style={styles.promptIcon}>
          <Ionicons name="volume-high" size={16} color={GOLD} />
        </View>
        <View style={styles.barTextWrap}>
          <Text style={styles.barTitle} numberOfLines={1}>
            Hapatikani kwa sasa
          </Text>
          <Text style={styles.barSubtitle} numberOfLines={1}>
            {prompt.peerName} hakupokea · ujumbe wa sauti unacheza
          </Text>
        </View>
        <Pressable
          onPress={() => stopPrivateCallUnavailablePrompt(prompt.callId, "dismissed")}
          accessibilityRole="button"
          accessibilityLabel="Simamisha ujumbe"
          hitSlop={10}
          style={({ pressed }) => [styles.promptClose, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 50,
    elevation: 12,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
    backgroundColor: "rgba(17,56,38,0.97)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.35)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  barMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#4ADE80",
  },
  barTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  barTitle: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  barSubtitle: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 1,
  },
  hangupBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5484D",
  },
  hangupIcon: {
    transform: [{ rotate: "135deg" }],
  },
  pressed: {
    opacity: 0.7,
  },
  promptWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 60,
    elevation: 14,
  },
  promptCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(20,25,35,0.97)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  promptIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  promptClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});
