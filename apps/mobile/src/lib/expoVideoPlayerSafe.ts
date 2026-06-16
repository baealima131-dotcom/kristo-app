import type { VideoPlayer } from "expo-video";

export type VideoPlayerSafeContext = {
  source?: string;
  uri?: string;
};

function isNativeSharedObjectError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("native shared object") ||
    message.includes("sharedobjectnotfound")
  );
}

/** Best-effort check that the expo-video native handle is still attached. */
export function isVideoPlayerAlive(player: VideoPlayer | null | undefined): boolean {
  if (!player) return false;
  try {
    void (player as any).status;
    return true;
  } catch {
    return false;
  }
}

function logStoragePreviewPlayerDisposed(context: VideoPlayerSafeContext, message?: string): void {
  if (context.source !== "feed-storage-preview") return;
  console.log("KRISTO_STORAGE_VIDEO_PREVIEW_PLAYER_DISPOSED", {
    uri: context.uri || null,
    message: message || null,
  });
}

export function logStorageVideoPreviewUnmount(uri?: string): void {
  console.log("KRISTO_STORAGE_VIDEO_PREVIEW_UNMOUNT", { uri: uri || null });
}

export function safePauseVideoPlayer(
  player: VideoPlayer | null | undefined,
  context: VideoPlayerSafeContext = {}
): boolean {
  if (!player) return false;
  if (!isVideoPlayerAlive(player)) {
    logStoragePreviewPlayerDisposed(context);
    return false;
  }
  try {
    player.pause?.();
    return true;
  } catch (error) {
    if (isNativeSharedObjectError(error)) {
      logStoragePreviewPlayerDisposed(context, String((error as any)?.message || error));
    }
    return false;
  }
}

export function safePlayVideoPlayer(
  player: VideoPlayer | null | undefined,
  context: VideoPlayerSafeContext = {}
): boolean {
  if (!player) return false;
  if (!isVideoPlayerAlive(player)) {
    logStoragePreviewPlayerDisposed(context);
    return false;
  }
  try {
    player.play?.();
    return true;
  } catch (error) {
    if (isNativeSharedObjectError(error)) {
      logStoragePreviewPlayerDisposed(context, String((error as any)?.message || error));
    }
    return false;
  }
}

export function safeSeekVideoPlayer(
  player: VideoPlayer | null | undefined,
  timeSec: number,
  context: VideoPlayerSafeContext = {}
): boolean {
  if (!player) return false;
  if (!isVideoPlayerAlive(player)) {
    logStoragePreviewPlayerDisposed(context);
    return false;
  }
  try {
    if (typeof (player as any).seekTo === "function") {
      (player as any).seekTo(timeSec);
    } else {
      (player as any).currentTime = timeSec;
    }
    return true;
  } catch (error) {
    if (isNativeSharedObjectError(error)) {
      logStoragePreviewPlayerDisposed(context, String((error as any)?.message || error));
    }
    return false;
  }
}

export function safeVideoPlayerCurrentTime(
  player: VideoPlayer | null | undefined,
  fallback = 0
): number {
  if (!player || !isVideoPlayerAlive(player)) return fallback;
  try {
    return Number((player as any).currentTime) || fallback;
  } catch {
    return fallback;
  }
}
