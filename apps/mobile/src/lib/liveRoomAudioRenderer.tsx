import { useEffect, useRef } from "react";
import {
  AndroidAudioTypePresets,
  AudioSession,
  useIOSAudioManagement,
  useRoomContext,
} from "@livekit/react-native";
import { RemoteAudioTrack, RoomEvent } from "livekit-client";

export type LiveRoomAudioRendererProps = {
  roomName?: string;
  currentUserId?: string;
  isPublisherStage?: boolean;
  canUseLiveMic?: boolean;
};

/**
 * RN-compatible RoomAudioRenderer — subscribes and plays all remote mic tracks.
 * (@livekit/react-native does not export web RoomAudioRenderer; this mirrors its role.)
 */
export function RoomAudioRenderer({
  roomName = "",
  currentUserId = "",
  isPublisherStage = false,
  canUseLiveMic = false,
}: LiveRoomAudioRendererProps) {
  const room = useRoomContext();
  useIOSAudioManagement(room as any, true);
  const mountedLogRef = useRef("");

  useEffect(() => {
    const logKey = `${roomName}|${currentUserId}|${isPublisherStage}|${canUseLiveMic}`;
    if (mountedLogRef.current === logKey) return;
    mountedLogRef.current = logKey;

    console.log("KRISTO_LIVE_AUDIO_RENDERER_MOUNTED", {
      roomName,
      currentUserId,
      isPublisherStage,
      canUseLiveMic,
      source: "live-room",
    });
  }, [roomName, currentUserId, isPublisherStage, canUseLiveMic]);

  useEffect(() => {
    AudioSession.configureAudio({
      android: {
        audioTypeOptions: AndroidAudioTypePresets.communication,
      },
    }).catch((e: any) => {
      console.log("KRISTO_AUDIO_SESSION_CONFIGURE_ERROR", String(e?.message || e));
    });

    AudioSession.setDefaultRemoteAudioTrackVolume(1).catch((e: any) => {
      console.log("KRISTO_AUDIO_DEFAULT_REMOTE_VOLUME_ERROR", String(e?.message || e));
    });

    AudioSession.startAudioSession().catch((e: any) => {
      console.log("KRISTO_AUDIO_SESSION_START_ERROR", String(e?.message || e));
    });
  }, []);

  useEffect(() => {
    if (!room) return;

    const primeRemoteAudio = (track: any, publication?: any, participant?: any) => {
      if (participant?.isLocal) return;
      if (String(track?.kind || "").toLowerCase() !== "audio") return;

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

        console.log("KRISTO_LIVE_AUDIO_RENDERER_TRACK_READY", {
          roomName,
          identity: String(participant?.identity || ""),
          source: String(publication?.source || ""),
        });
      } catch (e: any) {
        console.log("KRISTO_LIVE_AUDIO_RENDERER_PRIME_ERROR", String(e?.message || e));
      }
    };

    const primeParticipant = (participant: any) => {
      if (!participant || participant.isLocal) return;

      participant.trackPublications.forEach((publication: any) => {
        const kind = String(publication?.kind || publication?.track?.kind || "").toLowerCase();
        const source = String(publication?.source || "").toLowerCase();
        const isAudioPublication =
          kind === "audio" ||
          source.includes("microphone") ||
          source.includes("screen_share_audio");

        if (!isAudioPublication) return;

        if (typeof publication.setSubscribed === "function") {
          publication.setSubscribed(true);
        }

        if (publication.track) {
          primeRemoteAudio(publication.track, publication, participant);
        }
      });
    };

    const primeAllRemoteAudio = () => {
      room.remoteParticipants.forEach((participant: any) => {
        primeParticipant(participant);
      });
    };

    const onTrackSubscribed = (track: any, publication: any, participant: any) => {
      primeRemoteAudio(track, publication, participant);
    };

    const onTrackPublished = (_publication: any, participant: any) => {
      primeParticipant(participant);
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.ParticipantConnected, primeParticipant);
    room.on(RoomEvent.Connected, primeAllRemoteAudio);
    room.on(RoomEvent.Reconnected, primeAllRemoteAudio);

    if (String((room as any)?.state || "") === "connected") {
      primeAllRemoteAudio();
    }

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackPublished, onTrackPublished);
      room.off(RoomEvent.ParticipantConnected, primeParticipant);
      room.off(RoomEvent.Connected, primeAllRemoteAudio);
      room.off(RoomEvent.Reconnected, primeAllRemoteAudio);
    };
  }, [room, roomName]);

  return null;
}
