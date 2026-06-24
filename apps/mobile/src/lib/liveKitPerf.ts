export function markLiveEnterTap(source: string, extra?: Record<string, unknown>) {
  const at = Date.now();
  (globalThis as any).__KRISTO_LIVE_ENTER_TAP_AT__ = at;
  console.log("KRISTO_LIVE_ENTER_TAP", {
    at,
    source,
    ...(extra || {}),
  });
}

export function msSinceLiveEnterTap(): number | null {
  const at = Number((globalThis as any).__KRISTO_LIVE_ENTER_TAP_AT__ || 0);
  return at > 0 ? Date.now() - at : null;
}

export function msSinceLiveRoomMount(): number | null {
  const at = Number((globalThis as any).__KRISTO_LIVE_ROOM_PERF_MOUNT_AT__ || 0);
  return at > 0 ? Date.now() - at : null;
}

function perfPayload(extra?: Record<string, unknown>) {
  return {
    msSinceEnterTap: msSinceLiveEnterTap(),
    msSinceLiveRoomMount: msSinceLiveRoomMount(),
    ...(extra || {}),
  };
}

export function logLiveKitTokenStart(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVEKIT_TOKEN_START", perfPayload(extra));
}

export function logLiveKitTokenResult(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVEKIT_TOKEN_RESULT", perfPayload(extra));
}

export function logLiveKitConnectStart(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVEKIT_CONNECT_START", perfPayload(extra));
}

export function logLiveKitConnectResult(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVEKIT_CONNECT_RESULT", perfPayload(extra));
}

export function logLiveKitRoomEvent(
  event: string,
  extra?: Record<string, unknown>
) {
  console.log(`KRISTO_LIVEKIT_${event}`, perfPayload(extra));
}

export function logCameraTrackCreateStart(extra?: Record<string, unknown>) {
  console.log("KRISTO_CAMERA_TRACK_CREATE_START", perfPayload(extra));
}

export function logCameraTrackCreateResult(extra?: Record<string, unknown>) {
  console.log("KRISTO_CAMERA_TRACK_CREATE_RESULT", perfPayload(extra));
}

export function logCameraTrackCreateDone(extra?: Record<string, unknown>) {
  console.log("KRISTO_CAMERA_TRACK_CREATE_DONE", perfPayload(extra));
}

export function logCameraPublishStart(extra?: Record<string, unknown>) {
  console.log("KRISTO_CAMERA_PUBLISH_START", perfPayload(extra));
}

export function logCameraPublishResult(extra?: Record<string, unknown>) {
  console.log("KRISTO_CAMERA_PUBLISH_RESULT", perfPayload(extra));
}

export function logCameraPublishSuccess(extra?: Record<string, unknown>) {
  console.log("KRISTO_CAMERA_PUBLISH_SUCCESS", perfPayload(extra));
}

export function logCameraPublishError(extra?: Record<string, unknown>) {
  console.log("KRISTO_CAMERA_PUBLISH_ERROR", perfPayload(extra));
}

export function logLocalCameraPublicationState(extra?: Record<string, unknown>) {
  console.log("KRISTO_LOCAL_CAMERA_PUBLICATION_STATE", perfPayload(extra));
}

export function logLocalMicPublicationState(extra?: Record<string, unknown>) {
  console.log("KRISTO_LOCAL_MIC_PUBLICATION_STATE", perfPayload(extra));
}

export function logLiveMicSuppressAttempt(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVE_MIC_SUPPRESS_ATTEMPT", perfPayload(extra));
}

export function logLiveMicSuppressResult(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVE_MIC_SUPPRESS_RESULT", perfPayload(extra));
}

export function logStalePublisherStageMount(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVEKIT_STALE_PUBLISHER_STAGE", perfPayload(extra));
}

export function logLiveFirstFrameRendered(extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVE_FIRST_FRAME_RENDERED", perfPayload(extra));
}
