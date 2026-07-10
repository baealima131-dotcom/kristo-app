import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useRoomContext } from "@livekit/react-native";
import { RoomEvent, Track } from "livekit-client";

import { RoomAudioRenderer } from "@/src/lib/liveRoomAudioRenderer";
import { logLiveKitTokenClaims } from "@/src/lib/liveKitTokenDecode";
import {
  getPrivateCallRoomInstanceId,
  logPrivateCallAutoSubscribeEffective,
} from "@/src/lib/privateCallLiveKitConnect";

let activeAudioSessionCallId = "";
let audioSessionReadyPromise: Promise<void> | null = null;

const SUBSCRIBE_RECONCILE_MS = 700;
const SUBSCRIBE_FALLBACK_MS = 3000;

function privateCallLogTs() {
  return Date.now();
}

export function logPrivateCallAudioLatencyDiag(
  marks: Record<string, number>,
  milestone: string,
  extra?: Record<string, unknown>
) {
  const ts = privateCallLogTs();
  marks[milestone] = ts;
  const acceptAt = marks.acceptTap || marks.acceptDetected;
  console.log("KRISTO_PRIVATE_CALL_AUDIO_LATENCY_DIAG", {
    milestone,
    ts,
    msSinceAccept: acceptAt ? ts - acceptAt : undefined,
    msSinceTokenFetchDone: marks.tokenFetchDone ? ts - marks.tokenFetchDone : undefined,
    msSinceRoomMount: marks.roomMount ? ts - marks.roomMount : undefined,
    msSinceRoomConnected: marks.roomConnected ? ts - marks.roomConnected : undefined,
    msSinceRemoteAudioReady: marks.remoteAudioReady ? ts - marks.remoteAudioReady : undefined,
    ...extra,
  });
}

export async function ensurePrivateCallAudioSession(callId: string) {
  const id = String(callId || "").trim();
  if (activeAudioSessionCallId !== id) {
    activeAudioSessionCallId = id;
    audioSessionReadyPromise = null;
  }
  if (audioSessionReadyPromise) return audioSessionReadyPromise;

  audioSessionReadyPromise = (async () => {
    const ts = privateCallLogTs();
    try {
      const { AndroidAudioTypePresets, AudioSession } = await import("@livekit/react-native");
      await AudioSession.configureAudio({
        android: {
          audioTypeOptions: AndroidAudioTypePresets.communication,
        },
      });
      await AudioSession.setDefaultRemoteAudioTrackVolume(1);
      await AudioSession.startAudioSession();

      console.log("KRISTO_PRIVATE_CALL_AUDIO_SESSION_CONFIGURED", {
        callId: id,
        ts,
        ms: Date.now() - ts,
      });
    } catch (error: any) {
      console.log("KRISTO_PRIVATE_CALL_AUDIO_SESSION_CONFIGURED", {
        callId: id,
        ts,
        error: String(error?.message || error),
      });
    }
  })();

  return audioSessionReadyPromise;
}

function normalizePublicationKind(publication: any): string {
  const raw = publication?.kind ?? publication?.track?.kind ?? "";
  if (raw === Track.Kind.Audio) return "audio";
  return String(raw).trim().toLowerCase();
}

function normalizePublicationSource(publication: any): string {
  const raw = publication?.source ?? publication?.track?.source ?? "";
  if (raw === Track.Source.Microphone) return "microphone";
  if (raw === Track.Source.ScreenShareAudio) return "screen_share_audio";
  return String(raw).trim().toLowerCase();
}

function isRemoteAudioPublication(publication: any): boolean {
  const kind = normalizePublicationKind(publication);
  if (kind === "audio") return true;

  const source = normalizePublicationSource(publication);
  if (!source) return false;
  return source.includes("microphone") || source.includes("screen_share_audio");
}

function readPublicationSnapshot(publication: any) {
  return {
    trackSid: String(publication?.trackSid || publication?.sid || ""),
    isSubscribed: !!publication?.isSubscribed,
    isDesired: publication?.isDesired !== false,
    subscriptionStatus: String(publication?.subscriptionStatus || ""),
    permissionStatus: String(publication?.permissionStatus || ""),
    hasTrack: !!publication?.track,
    kind: normalizePublicationKind(publication),
    source: normalizePublicationSource(publication),
  };
}

function PrivateCallSubscribeDiagnostics({
  callId = "",
  roomName = "",
  currentUserId = "",
  latencyMarksRef,
}: {
  callId?: string;
  roomName?: string;
  currentUserId?: string;
  latencyMarksRef?: MutableRefObject<Record<string, number>>;
}) {
  const room = useRoomContext();
  const meta = useMemo(
    () => ({
      callId,
      roomName,
      roomInstanceId: getPrivateCallRoomInstanceId(room),
    }),
    [callId, roomName, room]
  );
  const subscribeRequestedRef = useRef(new Set<string>());
  const retryTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const remoteAudioReadyRef = useRef(false);

  useEffect(() => {
    if (!room) return;

    console.log(
      "KRISTO_PRIVATE_CALL_SUBSCRIPTION_OWNER_RENDERER",
      {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        ts: privateCallLogTs(),
      }
    );

    const getLatencyMarks = () => latencyMarksRef?.current || {};

    const clearRetryTimer = (trackSid: string) => {
      const timer = retryTimersRef.current.get(trackSid);
      if (!timer) return;

      clearTimeout(timer);
      retryTimersRef.current.delete(trackSid);
    };

    const requestSubscribe = (
      publication: any,
      participant: any,
      reason: string
    ) => {
      if (
        !participant ||
        participant.isLocal ||
        !isRemoteAudioPublication(publication)
      ) {
        return;
      }

      const trackSid = String(
        publication?.trackSid || publication?.sid || ""
      ).trim();

      if (!trackSid) return;

      const participantSid = String(participant?.sid || "").trim();

      if (!participantSid) {
        console.log("KRISTO_PRIVATE_CALL_SUBSCRIBE_DEFERRED", {
          callId: meta.callId,
          roomName: meta.roomName,
          roomInstanceId: meta.roomInstanceId,
          reason,
          identity: String(participant?.identity || ""),
          trackSid,
          ts: privateCallLogTs(),
        });
        return;
      }

      if (publication?.isSubscribed && publication?.track) {
        clearRetryTimer(trackSid);
        return;
      }

      if (subscribeRequestedRef.current.has(trackSid)) return;

      subscribeRequestedRef.current.add(trackSid);

      const before = readPublicationSnapshot(publication);

      console.log("KRISTO_PRIVATE_CALL_SUBSCRIBE_REQUEST", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        reason,
        identity: String(participant?.identity || ""),
        participantSid,
        ...before,
        ts: privateCallLogTs(),
      });

      try {
        if (typeof publication?.setSubscribed !== "function") {
          throw new Error("publication.setSubscribed unavailable");
        }

        publication.setSubscribed(true);

        console.log("KRISTO_PRIVATE_CALL_SUBSCRIBE_RESULT", {
          callId: meta.callId,
          roomName: meta.roomName,
          roomInstanceId: meta.roomInstanceId,
          reason,
          identity: String(participant?.identity || ""),
          trackSid,
          before,
          after: readPublicationSnapshot(publication),
          ts: privateCallLogTs(),
        });
      } catch (error: any) {
        subscribeRequestedRef.current.delete(trackSid);

        console.log("KRISTO_PRIVATE_CALL_SUBSCRIBE_ERROR", {
          callId: meta.callId,
          roomName: meta.roomName,
          roomInstanceId: meta.roomInstanceId,
          reason,
          identity: String(participant?.identity || ""),
          trackSid,
          before,
          after: readPublicationSnapshot(publication),
          error: String(error?.message || error),
          ts: privateCallLogTs(),
        });

        return;
      }

      if (retryTimersRef.current.has(trackSid)) return;

      const timer = setTimeout(() => {
        retryTimersRef.current.delete(trackSid);

        if (String((room as any)?.state || "") !== "connected") {
          return;
        }

        const currentParticipant =
          room.remoteParticipants.get(participantSid);

        if (!currentParticipant) return;

        const currentPublication =
          currentParticipant.trackPublications.get(trackSid) ||
          publication;

        if (
          currentPublication?.isSubscribed &&
          currentPublication?.track
        ) {
          return;
        }

        console.log(
          "KRISTO_PRIVATE_CALL_SUBSCRIBE_BOUNDED_RETRY",
          {
            callId: meta.callId,
            roomName: meta.roomName,
            roomInstanceId: meta.roomInstanceId,
            identity: String(participant?.identity || ""),
            participantSid,
            trackSid,
            snapshot:
              readPublicationSnapshot(currentPublication),
            ts: privateCallLogTs(),
          }
        );

        try {
          currentPublication?.setSubscribed?.(true);
        } catch (error: any) {
          console.log("KRISTO_PRIVATE_CALL_SUBSCRIBE_ERROR", {
            callId: meta.callId,
            roomName: meta.roomName,
            roomInstanceId: meta.roomInstanceId,
            reason: "bounded-retry",
            identity: String(participant?.identity || ""),
            trackSid,
            error: String(error?.message || error),
            ts: privateCallLogTs(),
          });
        }
      }, SUBSCRIBE_FALLBACK_MS);

      retryTimersRef.current.set(trackSid, timer);
    };

    const logRemotePublication = (
      publication: any,
      participant: any,
      context: string
    ) => {
      console.log("KRISTO_PRIVATE_CALL_REMOTE_PUBLICATION_SEEN", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        context,
        identity: String(participant?.identity || ""),
        ...readPublicationSnapshot(publication),
        rawKind: publication?.kind,
        rawSource: publication?.source,
        ts: privateCallLogTs(),
      });
    };

    const primeParticipant = (participant: any, context: string) => {
      if (!participant || participant.isLocal) return;
      participant.trackPublications.forEach((publication: any) => {
        logRemotePublication(publication, participant, context);
        requestSubscribe(publication, participant, context);
      });
    };

    const onConnected = () => {
      const marks = getLatencyMarks();
      marks.roomConnected = privateCallLogTs();
      logPrivateCallAudioLatencyDiag(marks, "room-connected-event");
      logPrivateCallAutoSubscribeEffective(room, {
        callId: meta.callId,
        roomName: meta.roomName,
        source: "room-connected-event",
      });
      console.log("KRISTO_PRIVATE_CALL_ROOM_CONNECTED", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        currentUserId,
        ts: marks.roomConnected,
      });
      room.remoteParticipants.forEach((participant: any) => {
        primeParticipant(participant, "room-connected");
      });
    };

    const markRemoteAudioReady = (
      marks: Record<string, number>,
      readyTs: number,
      participant: any
    ) => {
      marks.remoteAudioReady = readyTs;
      logPrivateCallAudioLatencyDiag(marks, "remote-audio-ready", {
        identity: String(participant?.identity || ""),
      });
    };

    const onTrackSubscribed = (track: any, publication: any, participant: any) => {
      if (participant?.isLocal || !isRemoteAudioPublication(publication)) return;

      const subscribedTrackSid = String(
        publication?.trackSid || publication?.sid || ""
      );

      clearRetryTimer(subscribedTrackSid);
      subscribeRequestedRef.current.delete(subscribedTrackSid);

      logRemotePublication(publication, participant, "track-subscribed-event");
      const ts = privateCallLogTs();
      console.log("KRISTO_PRIVATE_CALL_REMOTE_TRACK_SUBSCRIBED", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        identity: String(participant?.identity || ""),
        trackSid: String(publication?.trackSid || publication?.sid || ""),
        source: normalizePublicationSource(publication),
        hasMediaStreamTrack: !!track?.mediaStreamTrack,
        ts,
      });

      const readyTs = privateCallLogTs();
      remoteAudioReadyRef.current = true;
      markRemoteAudioReady(getLatencyMarks(), readyTs, participant);
      console.log("KRISTO_PRIVATE_CALL_REMOTE_AUDIO_READY", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        identity: String(participant?.identity || ""),
        trackSid: String(publication?.trackSid || publication?.sid || ""),
        mediaStreamTrackEnabled: track?.mediaStreamTrack?.enabled ?? null,
        ts: readyTs,
      });
    };

    const onTrackPublished = (_publication: any, participant: any) => {
      primeParticipant(participant, "track-published-event");
    };

    const onParticipantConnected = (participant: any) => {
      primeParticipant(participant, "participant-connected");
    };

    const onLocalTrackPublished = (publication: any) => {
      if (!isRemoteAudioPublication(publication)) return;
      console.log("KRISTO_PRIVATE_CALL_LOCAL_MIC_PUBLISHED", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        currentUserId,
        trackSid: String(publication?.trackSid || publication?.sid || ""),
        muted: !!publication?.isMuted,
        ts: privateCallLogTs(),
      });
    };

    const onTrackSubscriptionFailed = (
      trackSid: string,
      participant: any,
      error?: unknown
    ) => {
      console.log("KRISTO_PRIVATE_CALL_TRACK_SUBSCRIPTION_FAILED", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        trackSid: String(trackSid || ""),
        identity: String(participant?.identity || ""),
        error: String((error as any)?.message || error || ""),
        ts: privateCallLogTs(),
      });
    };

    const onTrackSubscriptionStatusChanged = (
      publication: any,
      status: unknown,
      participant: any
    ) => {
      if (!isRemoteAudioPublication(publication)) return;
      console.log("KRISTO_PRIVATE_CALL_TRACK_SUBSCRIPTION_STATUS", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        identity: String(participant?.identity || ""),
        ...readPublicationSnapshot(publication),
        status: String(status || ""),
        ts: privateCallLogTs(),
      });
    };

    const onTrackSubscriptionPermissionChanged = (
      publication: any,
      status: unknown,
      participant: any
    ) => {
      if (!isRemoteAudioPublication(publication)) return;
      console.log("KRISTO_PRIVATE_CALL_TRACK_SUBSCRIPTION_PERMISSION", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        identity: String(participant?.identity || ""),
        ...readPublicationSnapshot(publication),
        eventPermissionStatus: String(status || ""),
        ts: privateCallLogTs(),
      });
    };

    const onMediaDevicesError = (error: unknown) => {
      console.log("KRISTO_PRIVATE_CALL_MEDIA_DEVICES_ERROR", {
        callId: meta.callId,
        roomName: meta.roomName,
        roomInstanceId: meta.roomInstanceId,
        error: String((error as any)?.message || error || ""),
        ts: privateCallLogTs(),
      });
    };


    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Reconnected, onConnected);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.TrackSubscriptionFailed, onTrackSubscriptionFailed);
    room.on(RoomEvent.TrackSubscriptionStatusChanged, onTrackSubscriptionStatusChanged);
    room.on(RoomEvent.TrackSubscriptionPermissionChanged, onTrackSubscriptionPermissionChanged);
    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);

    if (String((room as any)?.state || "") === "connected") {
      onConnected();
    }


    return () => {
      retryTimersRef.current.forEach((timer) => {
        clearTimeout(timer);
      });
      retryTimersRef.current.clear();
      subscribeRequestedRef.current.clear();
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Reconnected, onConnected);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackPublished, onTrackPublished);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.TrackSubscriptionFailed, onTrackSubscriptionFailed);
      room.off(RoomEvent.TrackSubscriptionStatusChanged, onTrackSubscriptionStatusChanged);
      room.off(RoomEvent.TrackSubscriptionPermissionChanged, onTrackSubscriptionPermissionChanged);
      room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
    };
  }, [room, meta, currentUserId, latencyMarksRef]);

  return null;
}

export function PrivateCallLiveKitRoomDiagnostics({
  callId = "",
  roomName = "",
  token = "",
  currentUserId = "",
}: {
  callId?: string;
  roomName?: string;
  token?: string;
  currentUserId?: string;
}) {
  const room = useRoomContext();
  const loggedRef = useRef("");

  useEffect(() => {
    if (!room) return;

    const logInstance = (source: string) => {
      const roomInstanceId = getPrivateCallRoomInstanceId(room);
      const logKey = `${callId}|${roomInstanceId}|${roomName}|${source}|${String((room as any)?.state || "")}`;
      if (loggedRef.current === logKey) return;
      loggedRef.current = logKey;

      const claims = token
        ? logLiveKitTokenClaims(token, { source: "private-call-shell" })
        : null;

      logPrivateCallAutoSubscribeEffective(room, {
        callId,
        roomName,
        source,
      });

      console.log("KRISTO_PRIVATE_CALL_LIVEKIT_ROOM_INSTANCE", {
        callId,
        roomName,
        roomInstanceId,
        currentUserId,
        connectionState: String((room as any)?.state || ""),
        localIdentity: String((room as any)?.localParticipant?.identity || ""),
        tokenLen: token.length,
        tokenIdentity: claims?.identity || "",
        tokenRoom: claims?.room || "",
        canPublish: claims?.canPublish,
        canSubscribe: claims?.canSubscribe,
        source,
        ts: privateCallLogTs(),
      });
    };

    const onConnected = () => logInstance("room-connected");
    const onSignalConnected = () => logInstance("signal-connected");

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.SignalConnected, onSignalConnected);

    if (String((room as any)?.state || "") === "connected") {
      logInstance("already-connected");
    }

    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.SignalConnected, onSignalConnected);
    };
  }, [room, callId, roomName, token, currentUserId]);

  return null;
}

export function PrivateCallAudioRenderer({
  callId = "",
  roomName = "",
  currentUserId = "",
  latencyMarksRef,
}: {
  callId?: string;
  roomName?: string;
  currentUserId?: string;
  token?: string;
  latencyMarksRef?: MutableRefObject<Record<string, number>>;
}) {
  useEffect(() => {
    void ensurePrivateCallAudioSession(callId);
  }, [callId]);

  return (
    <>
      <RoomAudioRenderer
        roomName={roomName}
        currentUserId={currentUserId}
        isPublisherStage
        canUseLiveMic
      />
      <PrivateCallSubscribeDiagnostics
        callId={callId}
        roomName={roomName}
        currentUserId={currentUserId}
        latencyMarksRef={latencyMarksRef}
      />
    </>
  );
}
