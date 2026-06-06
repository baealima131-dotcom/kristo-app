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

export function registerHomeFeedVideo(
  postId: string,
  player: HomeFeedVideoPlayer,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;

  if (!meta.shouldPlay) {
    try {
      player.muted = true;
      player.pause();
    } catch {}
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

  if (meta.shouldPlay && meta.videoReady) {
    logHomeFeedVideoAudioGuard(id, true, "activate-active");
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

  if (activePostId === id && meta.shouldPlay && meta.videoReady) {
    logHomeFeedVideoAudioGuard(id, true, "activate-active");
    return;
  }

  pauseAllHomeFeedVideos({
    ...meta,
    exceptPostId: id,
    reason: meta.reason || "activate",
  });

  activePostId = id;
  if (meta.shouldPlay && meta.videoReady) {
    logHomeFeedVideoAudioGuard(id, true, "activate-active");
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
