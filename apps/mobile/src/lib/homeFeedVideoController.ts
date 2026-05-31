type HomeFeedVideoPlayer = {
  pause: () => void;
  play?: () => void;
  muted?: boolean;
  loop?: boolean;
};

type HomeFeedVideoLogMeta = {
  postId?: string;
  activeFeedIndex?: number;
  feedIndex?: number;
  activeFeedItemId?: string | null;
  screenFocused?: boolean;
  appState?: string;
  isStrictVideoPost?: boolean;
  shouldPlay?: boolean;
  reason?: string;
  exceptPostId?: string;
};

const registry = new Map<string, HomeFeedVideoPlayer>();
let activePostId: string | null = null;

function safePausePlayer(player: HomeFeedVideoPlayer | undefined) {
  if (!player) return;
  try {
    player.pause();
    player.muted = true;
  } catch {}
}

function devLog(event: string, meta: HomeFeedVideoLogMeta) {
  if (!__DEV__) return;
  console.log(event, meta);
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
  registry.set(id, player);
  devLog("KRISTO_FEED_VIDEO_REGISTER", { postId: id, ...meta });
}

export function unregisterHomeFeedVideo(
  postId: string,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;
  safePausePlayer(registry.get(id));
  registry.delete(id);
  if (activePostId === id) {
    activePostId = null;
  }
  devLog("KRISTO_FEED_VIDEO_UNREGISTER", { postId: id, ...meta });
}

export function pauseHomeFeedVideo(
  postId: string,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;
  safePausePlayer(registry.get(id));
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
  registry.forEach((player, postId) => {
    if (exceptPostId && postId === exceptPostId) return;
    safePausePlayer(player);
  });
  if (!exceptPostId) {
    activePostId = null;
  }
  devLog("KRISTO_FEED_VIDEO_PAUSE_ALL", meta);
}

export function activateHomeFeedVideo(
  postId: string,
  meta: HomeFeedVideoLogMeta = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;

  pauseAllHomeFeedVideos({
    ...meta,
    exceptPostId: id,
    reason: meta.reason || "activate",
  });

  activePostId = id;
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
    Boolean(isStrictVideoPost) &&
    focusOk &&
    indexOk &&
    idOk;

  if (!focusOk || !appOk || !isStrictVideoPost || !idOk || !indexOk) {
    pauseAllHomeFeedVideos({
      ...meta,
      reason: reason || "ownership-denied",
    });
    return;
  }

  if (canOwnPlayback && postId) {
    activateHomeFeedVideo(postId, meta);
    return;
  }

  pauseAllHomeFeedVideos({
    ...meta,
    reason: reason || "ownership-no-play",
  });
}
