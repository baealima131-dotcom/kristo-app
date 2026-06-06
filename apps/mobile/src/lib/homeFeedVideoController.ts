import { isKristoVerboseVideoControllerDebug } from "@/src/lib/kristoDebugFlags";

type HomeFeedVideoPlayer = {
  pause: () => void;
  play?: () => void;
  muted?: boolean;
  loop?: boolean;
};

type HomeFeedVideoLogMeta = {
  postId?: string;
  feedOriginId?: string;
  activeFeedIndex?: number;
  feedIndex?: number;
  activeFeedItemId?: string | null;
  screenFocused?: boolean;
  appState?: string;
  isStrictVideoPost?: boolean;
  shouldPlay?: boolean;
  videoReady?: boolean;
  reason?: string;
  exceptPostId?: string;
  exceptFeedOriginId?: string;
};

type RegistryEntry = {
  player: HomeFeedVideoPlayer;
  feedOriginId?: string;
};

const registry = new Map<string, RegistryEntry>();
let activePostId: string | null = null;
let lastAudioGuardKey = "";
let lastRegisterKey = "";
let pendingVideoRecoveryReason: string | null = null;
const videoRecoveryListeners = new Set<() => void>();

function devLog(event: string, meta: Record<string, unknown>) {
  if (!__DEV__ || !isKristoVerboseVideoControllerDebug()) return;
  console.log(event, meta);
}

function baseFeedId(postId: string) {
  return String(postId || "")
    .trim()
    .replace(/__loop_\d+(?:_\d+)?$/i, "");
}

function safePausePlayer(player: HomeFeedVideoPlayer | undefined): boolean {
  if (!player) return false;
  let ok = true;
  try {
    player.pause();
  } catch {
    ok = false;
  }
  try {
    player.muted = true;
  } catch {
    ok = false;
  }
  return ok;
}

function safePlayPlayer(player: HomeFeedVideoPlayer | undefined, unmute = true): boolean {
  if (!player) return false;
  let ok = true;
  if (unmute) {
    try {
      player.muted = false;
    } catch {
      ok = false;
    }
  }
  try {
    player.play?.();
  } catch {
    ok = false;
  }
  return ok;
}

function purgeRegistryEntry(postId: string) {
  registry.delete(postId);
  if (activePostId === postId) {
    activePostId = null;
  }
}

function logHomeFeedVideoAudioGuard(
  postId: string,
  shouldPlay: boolean,
  action: "force-pause-inactive" | "activate-active"
) {
  const key = `${postId}:${action}:${shouldPlay ? 1 : 0}`;
  if (key === lastAudioGuardKey) return;
  lastAudioGuardKey = key;
  devLog("KRISTO_VIDEO_AUDIO_GUARD", {
    postId,
    shouldPlay,
    action,
  });
}

function logVideoAudioOwnerState(
  requestedPostId: string,
  action: string,
  meta: {
    playerMuted?: boolean | null;
    reason?: string;
    isSameActive?: boolean;
  } = {}
) {
  devLog("KRISTO_VIDEO_AUDIO_OWNER_STATE", {
    activePostId,
    requestedPostId: requestedPostId || null,
    action,
    playerMuted: meta.playerMuted ?? null,
    isSameActive:
      typeof meta.isSameActive === "boolean"
        ? meta.isSameActive
        : Boolean(requestedPostId) && activePostId === requestedPostId,
    reason: meta.reason || null,
  });
}

function isExceptActivePlayer(registryPostId: string, exceptPostId: string) {
  return Boolean(exceptPostId) && registryPostId === exceptPostId;
}

export function isStrictVideoFeedItem(item: any) {
  const raw = String(item?.videoUrl || item?.mediaUri || "").trim();
  return item?.mediaType === "video" && Boolean(raw) && !raw.startsWith("file://");
}

export function getActiveHomeFeedVideoId() {
  return activePostId;
}

export function markHomeFeedVideoNeedsRecovery(reason: string) {
  pendingVideoRecoveryReason = String(reason || "unknown").trim() || "unknown";
  console.log("KRISTO_LIVE_ROOM_EXIT_VIDEO_RECOVERY_MARKED", {
    reason: pendingVideoRecoveryReason,
  });
  videoRecoveryListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

export function peekHomeFeedVideoRecovery(): string | null {
  return pendingVideoRecoveryReason;
}

export function consumeHomeFeedVideoRecovery(): string | null {
  const reason = pendingVideoRecoveryReason;
  pendingVideoRecoveryReason = null;
  return reason;
}

export function subscribeHomeFeedVideoRecovery(listener: () => void) {
  videoRecoveryListeners.add(listener);
  return () => {
    videoRecoveryListeners.delete(listener);
  };
}

export function bumpHomeFeedVideoOwnership(postId: string) {
  const id = String(postId || "").trim();
  if (!id) {
    activePostId = null;
    return;
  }
  activePostId = null;
  activePostId = id;
}

export function recoverHomeFeedPlaybackAfterLiveExit(
  meta: HomeFeedVideoLogMeta & { postId?: string } = {}
): boolean {
  const id = String(meta.postId || activePostId || "").trim();
  const reason = String(meta.reason || "live-room-exit").trim();

  if (!id) {
    console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_SKIPPED", {
      reason,
      why: "no-post-id",
    });
    return false;
  }

  const entry = registry.get(id);
  if (!entry) {
    console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_SKIPPED", {
      postId: id,
      reason,
      why: "not-registered",
    });
    return false;
  }

  const playerMutedBefore = Boolean(entry.player?.muted);

  activePostId = id;

  pauseAllHomeFeedVideos({
    ...meta,
    exceptPostId: id,
    reason: reason || "live-exit-recovery-pause-inactive",
  });

  const shouldPlay = meta.videoReady !== false && meta.shouldPlay !== false;
  if (shouldPlay) {
    safePlayPlayer(entry.player, true);
    logHomeFeedVideoAudioGuard(id, true, "activate-active");
  }

  const playerMutedAfter = Boolean(entry.player?.muted);

  logVideoAudioOwnerState(id, "recover-after-live-exit", {
    playerMuted: playerMutedAfter,
    reason,
    isSameActive: activePostId === id,
  });

  console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_ACTIVE", {
    postId: id,
    reason,
    shouldPlay,
    playerMutedBefore,
    playerMutedAfter,
  });
  return true;
}

export function registerHomeFeedVideo(
  postId: string,
  player: HomeFeedVideoPlayer,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;

  const isActiveOwner = activePostId === id;
  const shouldOwnPlayback = Boolean(meta.shouldPlay && meta.videoReady);

  if (!meta.shouldPlay) {
    if (isActiveOwner) {
      logVideoAudioOwnerState(id, "register-skip-mute-active-owner", {
        playerMuted: Boolean(player.muted),
        reason: meta.reason || "active-owner",
        isSameActive: true,
      });
    } else if (meta.reason !== "simple-feed-video-mount") {
      try {
        player.muted = true;
        player.pause();
      } catch {}
      logVideoAudioOwnerState(id, "register-muted", {
        playerMuted: Boolean(player.muted),
        reason: meta.reason || "shouldPlay-false",
      });
    }
  }

  const existing = registry.get(id);
  if (existing && existing.player !== player) {
    if (!safePausePlayer(existing.player)) {
      purgeRegistryEntry(id);
    }
  }

  registry.set(id, {
    player,
    feedOriginId: String(meta.feedOriginId || baseFeedId(id)).trim() || undefined,
  });

  if (shouldOwnPlayback) {
    activePostId = id;
    safePlayPlayer(player, true);
    logHomeFeedVideoAudioGuard(id, true, "activate-active");
    logVideoAudioOwnerState(id, "register-active-ready", {
      playerMuted: Boolean(player.muted),
      reason: meta.reason || "shouldPlay-ready",
      isSameActive: true,
    });
  }

  const registerKey = `${id}:${meta.shouldPlay ? 1 : 0}:${meta.videoReady ? 1 : 0}:${meta.reason || ""}`;
  if (registerKey !== lastRegisterKey) {
    lastRegisterKey = registerKey;
    devLog("KRISTO_FEED_VIDEO_REGISTER", { postId: id, ...meta });
  }
}

export function unregisterHomeFeedVideo(
  postId: string,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;

  const entry = registry.get(id);
  purgeRegistryEntry(id);
  safePausePlayer(entry?.player);
  logHomeFeedVideoAudioGuard(id, false, "force-pause-inactive");
  devLog("KRISTO_FEED_VIDEO_UNREGISTER", { postId: id, ...meta });
}

export function pauseHomeFeedVideo(
  postId: string,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;

  const entry = registry.get(id);
  if (!entry) return;

  if (!safePausePlayer(entry.player)) {
    purgeRegistryEntry(id);
  } else {
    logHomeFeedVideoAudioGuard(id, false, "force-pause-inactive");
  }

  if (activePostId === id) {
    activePostId = null;
  }

  logHomeFeedVideoPlayState({
    postId: id,
    shouldPlay: false,
    reason: meta.reason || "pause-one",
    ...meta,
  });
}

export function pauseAllHomeFeedVideos(meta: HomeFeedVideoLogMeta = {}) {
  const exceptPostId = String(meta.exceptPostId || "").trim();
  const dead: string[] = [];
  let pausedCount = 0;

  registry.forEach((entry, postId) => {
    if (isExceptActivePlayer(postId, exceptPostId)) return;
    if (!safePausePlayer(entry.player)) {
      dead.push(postId);
      return;
    }
    pausedCount += 1;
    logHomeFeedVideoAudioGuard(postId, false, "force-pause-inactive");
    logVideoAudioOwnerState(postId, "pause-all-inactive", {
      playerMuted: Boolean(entry.player?.muted),
      reason: meta.reason || "pause-all",
      isSameActive: activePostId === postId,
    });
  });

  for (const postId of dead) {
    purgeRegistryEntry(postId);
  }

  if (!exceptPostId) {
    activePostId = null;
  }

  if (pausedCount > 0) {
    devLog("KRISTO_FEED_VIDEO_PAUSE_ALL", { ...meta, pausedCount });
  }
}

export function activateHomeFeedVideo(
  postId: string,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;

  activePostId = id;

  pauseAllHomeFeedVideos({
    ...meta,
    exceptPostId: id,
    reason: meta.reason || "activate",
  });

  if (meta.shouldPlay && meta.videoReady) {
    const entry = registry.get(id);
    safePlayPlayer(entry?.player, true);
    logHomeFeedVideoAudioGuard(id, true, "activate-active");
    logVideoAudioOwnerState(id, "activate-active-unmute", {
      playerMuted: Boolean(entry?.player?.muted),
      reason: meta.reason || "activate",
      isSameActive: true,
    });
  } else {
    logVideoAudioOwnerState(id, "activate-pending", {
      playerMuted: Boolean(registry.get(id)?.player?.muted),
      reason: meta.reason || "activate-not-ready",
      isSameActive: true,
    });
  }
  devLog("KRISTO_FEED_VIDEO_ACTIVATE", { postId: id, ...meta });
}

export function logHomeFeedVideoPlayState(meta: HomeFeedVideoLogMeta) {
  devLog("KRISTO_FEED_VIDEO_PLAY_STATE", meta);
}

export function syncHomeFeedVideoOwnership(meta: HomeFeedVideoLogMeta) {
  const {
    shouldPlay,
    postId,
    isStrictVideoPost,
    screenFocused,
    appState,
    activeFeedItemId,
    activeFeedIndex,
    feedIndex,
    reason,
    feedOriginId,
    videoReady,
  } = meta;

  const appOk = appState === "active";
  const focusOk = Boolean(screenFocused) && appOk;
  const indexOk =
    typeof activeFeedIndex === "number" &&
    typeof feedIndex === "number" &&
    activeFeedIndex === feedIndex;
  const idOk =
    Boolean(postId) &&
    Boolean(activeFeedItemId) &&
    String(postId) === String(activeFeedItemId);

  const canOwnPlayback =
    Boolean(shouldPlay) &&
    Boolean(videoReady) &&
    Boolean(isStrictVideoPost) &&
    focusOk &&
    indexOk &&
    idOk;

  if (!focusOk || !appOk || !isStrictVideoPost || !idOk || !indexOk || !shouldPlay) {
    pauseAllHomeFeedVideos({
      ...meta,
      reason: reason || "ownership-denied",
    });
    return;
  }

  if (canOwnPlayback && postId) {
    activateHomeFeedVideo(postId, {
      ...meta,
      feedOriginId: String(feedOriginId || baseFeedId(postId)).trim() || undefined,
    });
    return;
  }

  pauseAllHomeFeedVideos({
    ...meta,
    reason: reason || "ownership-no-play",
  });
}

export { safePausePlayer, safePlayPlayer };
