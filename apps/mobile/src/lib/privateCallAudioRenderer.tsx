import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  AndroidAudioTypePresets,
  AudioSession,
  useIOSAudioManagement,
  useRoomContext,
} from "@livekit/react-native";
import { MediaStream, RTCView } from "@livekit/react-native-webrtc";
import { RemoteAudioTrack, RoomEvent, Track } from "livekit-client";

function readTrackIdentity(track: any): string {
  return String(
    track?.mediaStreamTrack?.id ||
      track?.sid ||
      track?.mediaStreamID ||
      ""
  ).trim();
}

function isAudioTrack(track: any, publication?: any): boolean {
  const kind = String(track?.kind || publication?.kind || "").toLowerCase();
  if (kind === Track.Kind.Audio || kind === "audio") return true;
  const source = String(publication?.source || "").toLowerCase();
  return source.includes("microphone") || source.includes("screen_share_audio");
}

function primeRemoteAudioTrack(
  track: any,
  publication: any,
  participant: any,
  meta: { callId: string; roomName: string }
) {
  if (participant?.isLocal || !isAudioTrack(track, publication)) return false;

  console.log("KRISTO_PRIVATE_CALL_REMOTE_TRACK_SUBSCRIBED", {
    callId: meta.callId,
    roomName: meta.roomName,
    identity: String(participant?.identity || ""),
    trackSid: String(publication?.trackSid || publication?.sid || ""),
    source: String(publication?.source || ""),
    muted: !!publication?.isMuted,
    hasMediaStreamTrack: !!track?.mediaStreamTrack,
  });

  try {
    if (publication && typeof publication.setSubscribed === "function") {
      publication.setSubscribed(true);
    }

    if (track instanceof RemoteAudioTrack) {
      track.setVolume(1);
    } else {
      track?.setVolume?.(1);
    }

    if (track?.mediaStreamTrack) {
      track.mediaStreamTrack.enabled = true;
    }

    if (typeof track?.start === "function") {
      void Promise.resolve(track.start()).catch(() => {});
    }

    console.log("KRISTO_PRIVATE_CALL_REMOTE_AUDIO_READY", {
      callId: meta.callId,
      roomName: meta.roomName,
      identity: String(participant?.identity || ""),
      trackSid: String(publication?.trackSid || publication?.sid || ""),
      mediaStreamTrackEnabled: track?.mediaStreamTrack?.enabled ?? null,
      muted: !!publication?.isMuted,
    });
    return true;
  } catch (error: any) {
    console.log("KRISTO_PRIVATE_CALL_REMOTE_AUDIO_READY", {
      callId: meta.callId,
      roomName: meta.roomName,
      identity: String(participant?.identity || ""),
      error: String(error?.message || error),
    });
    return false;
  }
}

function PrivateCallRemoteAudioSink({ track }: { track: any }) {
  const streamUrl = useMemo(() => {
    const mediaTrack = track?.mediaStreamTrack;
    if (!mediaTrack) return "";
    try {
      mediaTrack.enabled = true;
      const stream = new MediaStream();
      stream.addTrack(mediaTrack as any);
      return stream.toURL();
    } catch {
      return "";
    }
  }, [track]);

  if (!streamUrl) return null;

  return (
    <RTCView
      streamURL={streamUrl}
      style={styles.hiddenRtc}
      zOrder={0}
      objectFit="cover"
    />
  );
}

export function PrivateCallAudioRenderer({
  callId = "",
  roomName = "",
  currentUserId = "",
}: {
  callId?: string;
  roomName?: string;
  currentUserId?: string;
}) {
  const room = useRoomContext();
  useIOSAudioManagement(room as any, true);
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<any[]>([]);
  const sessionConfiguredRef = useRef(false);
  const meta = useMemo(() => ({ callId, roomName }), [callId, roomName]);

  useEffect(() => {
    if (sessionConfiguredRef.current) return;
    sessionConfiguredRef.current = true;

    void (async () => {
      try {
        await AudioSession.configureAudio({
          android: {
            audioTypeOptions: AndroidAudioTypePresets.communication,
            preferredOutputList: ["speaker", "bluetooth", "headset", "earpiece"],
          },
          ios: { defaultOutput: "speaker" },
        });
        await AudioSession.setDefaultRemoteAudioTrackVolume(1);
        await AudioSession.setAppleAudioConfiguration({
          audioCategory: "playAndRecord",
          audioCategoryOptions: ["allowBluetooth", "defaultToSpeaker"],
          audioMode: "voiceChat",
        });
        await AudioSession.startAudioSession();

        const outputs = await AudioSession.getAudioOutputs().catch(() => [] as string[]);
        if (outputs.includes("speaker")) {
          await AudioSession.selectAudioOutput("speaker").catch(() => {});
        } else if (outputs.includes("force_speaker")) {
          await AudioSession.selectAudioOutput("force_speaker").catch(() => {});
        }

        console.log("KRISTO_PRIVATE_CALL_AUDIO_SESSION_CONFIGURED", {
          callId,
          roomName,
          currentUserId,
          outputs,
        });
      } catch (error: any) {
        console.log("KRISTO_PRIVATE_CALL_AUDIO_SESSION_CONFIGURED", {
          callId,
          roomName,
          currentUserId,
          error: String(error?.message || error),
        });
      }
    })();
  }, [callId, roomName, currentUserId]);

  const upsertRemoteTrack = (track: any) => {
    const id = readTrackIdentity(track);
    if (!id) return;
    setRemoteAudioTracks((current) => {
      if (current.some((entry) => readTrackIdentity(entry) === id)) return current;
      return [...current, track];
    });
  };

  const removeRemoteTrack = (track: any) => {
    const id = readTrackIdentity(track);
    if (!id) return;
    setRemoteAudioTracks((current) =>
      current.filter((entry) => readTrackIdentity(entry) !== id)
    );
  };

  useEffect(() => {
    if (!room) return;

    const primeParticipant = (participant: any) => {
      if (!participant || participant.isLocal) return;

      participant.trackPublications.forEach((publication: any) => {
        if (!isAudioTrack(publication?.track, publication)) return;
        if (typeof publication.setSubscribed === "function") {
          publication.setSubscribed(true);
        }
        if (publication.track) {
          const ready = primeRemoteAudioTrack(publication.track, publication, participant, meta);
          if (ready) upsertRemoteTrack(publication.track);
        }
      });
    };

    const primeAllRemoteAudio = () => {
      room.remoteParticipants.forEach((participant: any) => {
        primeParticipant(participant);
      });
    };

    const onTrackSubscribed = (track: any, publication: any, participant: any) => {
      const ready = primeRemoteAudioTrack(track, publication, participant, meta);
      if (ready) upsertRemoteTrack(track);
    };

    const onTrackUnsubscribed = (track: any, publication: any, participant: any) => {
      if (!isAudioTrack(track, publication)) return;
      removeRemoteTrack(track);
      console.log("KRISTO_PRIVATE_CALL_REMOTE_TRACK_UNSUBSCRIBED", {
        callId: meta.callId,
        roomName: meta.roomName,
        identity: String(participant?.identity || ""),
        trackSid: String(publication?.trackSid || publication?.sid || ""),
      });
    };

    const onTrackPublished = (_publication: any, participant: any) => {
      primeParticipant(participant);
    };

    const onTrackMuted = (publication: any, participant: any) => {
      if (!isAudioTrack(publication?.track, publication)) return;
      console.log("KRISTO_PRIVATE_CALL_REMOTE_TRACK_MUTED", {
        callId: meta.callId,
        roomName: meta.roomName,
        identity: String(participant?.identity || ""),
        trackSid: String(publication?.trackSid || publication?.sid || ""),
      });
    };

    const onLocalTrackPublished = (publication: any) => {
      if (!isAudioTrack(publication?.track, publication)) return;
      console.log("KRISTO_PRIVATE_CALL_LOCAL_MIC_PUBLISHED", {
        callId: meta.callId,
        roomName: meta.roomName,
        currentUserId,
        trackSid: String(publication?.trackSid || publication?.sid || ""),
        muted: !!publication?.isMuted,
      });
    };

    const onConnected = () => {
      primeAllRemoteAudio();
      void room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.ParticipantConnected, primeParticipant);
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Reconnected, primeAllRemoteAudio);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);

    if (String((room as any)?.state || "") === "connected") {
      onConnected();
    }

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackPublished, onTrackPublished);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.ParticipantConnected, primeParticipant);
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Reconnected, primeAllRemoteAudio);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    };
  }, [room, meta, currentUserId]);

  return (
    <View pointerEvents="none" style={styles.sinkHost}>
      {remoteAudioTracks.map((track) => {
        const trackKey = readTrackIdentity(track) || "remote-audio";
        return <PrivateCallRemoteAudioSink key={trackKey} track={track} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sinkHost: {
    width: 1,
    height: 1,
    opacity: 0,
    position: "absolute",
  },
  hiddenRtc: {
    width: 1,
    height: 1,
    opacity: 0,
  },
});
