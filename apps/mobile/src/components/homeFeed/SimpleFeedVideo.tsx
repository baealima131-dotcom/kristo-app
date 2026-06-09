import React, { memo } from "react";
import { Animated, AppState, Easing, Image, StyleSheet, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { markHomeFeedFirstPlaying, markHomeFirstVideoReady } from "@/src/lib/firstPaint";
import {
  activateHomeFeedVideo,
  consumeHomeFeedVideoRecovery,
  getActiveHomeFeedVideoId,
  pauseHomeFeedVideo,
  peekHomeFeedVideoRecovery,
  registerHomeFeedVideo,
  subscribeHomeFeedVideoRecovery,
  unregisterHomeFeedVideo,
} from "@/src/lib/homeFeedVideoController";
import {
  isHomeFeedVideoPreloadReady,
  markHomeFeedActiveFirstFrame,
  markHomeFeedVideoPreloadReady,
  touchHomeFeedVideoReadiness,
} from "@/src/lib/homeFeedVideoReadiness";
import type { HomeFeedVideoWarmMode } from "@/src/lib/homeFeedVideoWindow";
import {
  getHomeFeedVideoProgress,
  peekHomeFeedVideoRestoreSeek,
  saveHomeFeedVideoProgress,
} from "@/src/lib/homeFeedVideoProgressStore";
import { wasHomeFeedVideoUrlBufferedAhead } from "@/src/lib/homeFeedVideoBufferAhead";
import { logFirstMountedHomeFeedVideoFileDiag } from "@/src/lib/homeFeedVideoFileDiag";
import {
  getFirstHomeFeedVideoPlaybackPlans,
  logHomeFeedVideoQualityTrace,
  markHomeFeedLowResPreviewFailed,
  resolveHomeFeedVideoPlaybackPlan,
  resolveInitialStartupPlaybackUri,
  resolveVerifiedStartupVideoUri,
} from "@/src/lib/homeFeedVideoQuality";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import { getHomeFeedPosterLoadTimeoutMs } from "@/src/lib/videoGridThumbnail";
import { hasBrandedVideoPoster, isValidVideoPosterUri, type PosterMetadataSnapshot, snapshotPosterMetadata } from "./homeFeedUtils";
import { FeedVideoPosterImage, VideoPostFallbackPoster } from "./VideoPostFallbackPoster";

type Props = {
  postId?: string;
  title?: string;
  mediaStatus?: string;
  uri: string;
  startupUri?: string;
  fullQualityUri?: string;
  hasLowRes?: boolean;
  prewarmHit?: boolean;
  posterUri?: string;
  posterMetadata?: PosterMetadataSnapshot;
  videoDurationMs?: number;
  brandedPoster?: boolean;
  warmMode: HomeFeedVideoWarmMode;
  screenFocused: boolean;
  feedIndex?: number;
  isFirstFeedVideo?: boolean;
  contentLength?: number;
  /** Endless-feed recycle key (`${id}:cycle:N`). When set, this is a recycled copy
   *  of an existing post: it must always start at 0 and must not save/restore the
   *  original post's watch progress (likes/comments still use the original `postId`). */
  recycleKey?: string;
  onDoubleTap?: () => void;
};

// V1 perf: only emit startup/first-frame timing for the first active video in
// the session. Subsequent active videos stay quiet to keep logs minimal.
let firstActiveTimingLogged = false;

let firstPosterCheckLogged = false;

function urlHost(url: string): string | null {
  const match = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function statusLower(status: string) {
  return String(status || "").trim().toLowerCase();
}

function hasDecodedFrame(status: string, currentTime: number, playing: boolean) {
  void status;
  return currentTime > 0.03 || (playing && currentTime > 0);
}

/**
 * A truly painted frame: playback position has advanced past 0. Unlike
 * `hasDecodedFrame`, a bare `readyToPlay`/`playing` status at currentTime 0 does
 * not count — that state still shows a black surface because no pixel has been
 * decoded yet. Hold the poster over the video until this is true so the first
 * Home Feed video never exposes a black/loading frame.
 */
function hasPaintedFrame(currentTime: number) {
  return currentTime > 0.03;
}

function isPlayerReadyToStart(status: string, currentTime: number, playing: boolean) {
  return hasDecodedFrame(status, currentTime, playing);
}

function shouldMarkReadiness(status: string, currentTime: number, playing: boolean) {
  return hasDecodedFrame(status, currentTime, playing);
}

function safeGetPlayerCurrentTime(player: any): number {
  try {
    return Number(player?.currentTime || 0);
  } catch {
    return 0;
  }
}

function safeGetPlayerPlaying(player: any): boolean {
  try {
    return Boolean(player?.playing);
  } catch {
    return false;
  }
}

function safeGetPlayerStatus(player: any): string {
  try {
    return String(player?.status || "");
  } catch {
    return "";
  }
}

function safeSetPlayerCurrentTime(player: any, seconds: number): boolean {
  try {
    (player as any).currentTime = seconds;
    return true;
  } catch {
    return false;
  }
}

function safePlayerPause(player: any): void {
  try {
    player.pause();
  } catch {}
}

function safePlayerPlay(player: any): void {
  try {
    player.play();
  } catch {}
}

function safeGetPlayerDuration(player: any): number {
  try {
    return Number(player?.duration || 0);
  } catch {
    return 0;
  }
}

function safeGetPlayerBuffered(player: any): number {
  try {
    return Number(player?.bufferedPosition ?? -1);
  } catch {
    return -1;
  }
}

function isPlayerStalledForRefocus(status: string, currentTime: number, playing: boolean) {
  const lower = statusLower(status);
  if (lower === "error") return true;
  if (lower === "loading" || lower === "idle") return true;
  if (!playing && currentTime <= 0.03 && (lower === "readytoplay" || lower === "loaded")) {
    return true;
  }
  return false;
}

/** Low-latency progressive streaming: start playback early, buffer ahead in background. */
const PROGRESSIVE_BUFFER_OPTIONS = {
  preferredForwardBufferDuration: 2,
  waitsToMinimizeStalling: false,
  minBufferForPlayback: 0.5,
  prioritizeTimeOverSizeThreshold: true,
} as const;

/** Keep low-res playing before upgrading; avoids black flash during HQ source swap. */
const QUALITY_UPGRADE_DELAY_MS = 2800;

/**
 * Active row plays with audio; preload/warm rows keep muted paused players ready for handoff.
 */
export const SimpleFeedVideo = memo(function SimpleFeedVideo({
  postId = "",
  title = "",
  mediaStatus = "",
  uri,
  startupUri = "",
  fullQualityUri = "",
  hasLowRes = false,
  prewarmHit = false,
  posterUri = "",
  posterMetadata,
  videoDurationMs,
  brandedPoster = false,
  warmMode,
  screenFocused,
  feedIndex = -1,
  isFirstFeedVideo = false,
  contentLength,
  recycleKey = "",
  onDoubleTap,
}: Props) {
  const isRecycledRow = Boolean(String(recycleKey || "").trim());
  const recycledStartResetLoggedRef = React.useRef(false);
  const firstVideoHoldLoggedRef = React.useRef(false);
  const firstVideoSwapLoggedRef = React.useRef(false);
  const resolvedFullUri = String(fullQualityUri || uri || "").trim();
  const resolvedStartupUri = String(startupUri || resolvedFullUri).trim();
  const canUpgradeQuality =
    hasLowRes &&
    Boolean(resolvedStartupUri && resolvedFullUri) &&
    resolvedStartupUri.split("?")[0] !== resolvedFullUri.split("?")[0];
  const playbackPlan = React.useMemo(
    () => ({
      postId,
      originalVideoUrl: resolvedFullUri,
      fullQualityUri: resolvedFullUri,
      startupUri: resolvedStartupUri,
      lowResVideoUrl: canUpgradeQuality ? resolvedStartupUri : null,
      hasLowRes: canUpgradeQuality,
      prewarmHit,
    }),
    [postId, resolvedFullUri, resolvedStartupUri, canUpgradeQuality, prewarmHit]
  );
  const initialPlaybackUri = React.useMemo(
    () => resolveInitialStartupPlaybackUri(playbackPlan),
    [playbackPlan]
  );

  const [playbackUri, setPlaybackUri] = React.useState(initialPlaybackUri);
  const [playerSourceAttached, setPlayerSourceAttached] = React.useState(true);
  const [upgradingQuality, setUpgradingQuality] = React.useState(false);
  const upgradedQualityRef = React.useRef(false);
  const upgradeStartedMsRef = React.useRef<number | null>(null);
  const qualityTraceLoggedRef = React.useRef(false);
  const qualityUpgradePendingRef = React.useRef(false);
  const qualityUpgradeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackFallbackRef = React.useRef(false);

  React.useEffect(() => {
    playbackFallbackRef.current = false;
    upgradedQualityRef.current = false;
    upgradeStartedMsRef.current = null;
    qualityTraceLoggedRef.current = false;
    setUpgradingQuality(false);
    if (qualityUpgradeTimerRef.current) {
      clearTimeout(qualityUpgradeTimerRef.current);
      qualityUpgradeTimerRef.current = null;
    }
    setPlaybackUri(initialPlaybackUri);
  }, [postId, resolvedStartupUri, resolvedFullUri, initialPlaybackUri]);

  const cachedReadyOnMount = isHomeFeedVideoPreloadReady(postId, playbackUri);
  const cachedReadyRef = React.useRef(cachedReadyOnMount);
  const warmModeRef = React.useRef(warmMode);
  warmModeRef.current = warmMode;

  const isActive = warmMode === "active";
  const isStartupPriority = warmMode === "startup-priority";
  const countsForStartupTiming = isActive || isStartupPriority;

  const isRetainPrev = warmMode === "warm" || warmMode === "cache";
  const isPreloadNext = warmMode === "preload";
  const sourceLoadAllowed =
    isActive || isStartupPriority || isPreloadNext || isRetainPrev;
  const playerSource =
    sourceLoadAllowed && playbackUri && playerSourceAttached
      ? { uri: playbackUri, contentType: "progressive" as const }
      : null;

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = true;
    p.muted = true;
    try {
      p.bufferOptions = { ...PROGRESSIVE_BUFFER_OPTIONS };
    } catch {}
    const mode = warmModeRef.current;
    if (mode === "warm" || mode === "cache") {
      try {
        p.pause();
      } catch {}
      return;
    }
    try {
      p.play();
    } catch {}
  });

  const lastKnownTimeRef = React.useRef(0);
  const lastKnownPlayingRef = React.useRef(false);
  const playerDisposedRef = React.useRef(false);

  const { status } = useEvent(player, "statusChange", {
    status: safeGetPlayerStatus(player),
  });

  React.useEffect(() => {
    playerDisposedRef.current = false;
    lastKnownTimeRef.current = 0;
    lastKnownPlayingRef.current = false;
  }, [player]);

  React.useEffect(() => {
    if (playerDisposedRef.current) return;
    const t = safeGetPlayerCurrentTime(player);
    if (Number.isFinite(t) && t >= 0) {
      lastKnownTimeRef.current = t;
    }
    lastKnownPlayingRef.current = safeGetPlayerPlaying(player);
  }, [status, player]);

  const currentTime = lastKnownTimeRef.current;
  const playing = lastKnownPlayingRef.current;

  const isPreload = isPreloadNext;
  const shouldPrime = isPreloadNext;

  // Never reveal the video surface from the readiness cache: a freshly created
  // player has not decoded a frame yet, so hiding the poster/fallback before the
  // real first frame paints a black flash. Keep the poster until markFirstFrame
  // fires on an actual decoded frame.
  const [firstFrameReady, setFirstFrameReady] = React.useState(false);
  const [appActive, setAppActive] = React.useState(() => AppState.currentState === "active");

  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
    });
    return () => sub.remove();
  }, []);

  const mountedUriRef = React.useRef(playbackUri);
  const preloadPrimedRef = React.useRef(false);
  const preloadStartLoggedRef = React.useRef(false);
  const reusedWarmLoggedRef = React.useRef(false);
  const readyMarkedRef = React.useRef(cachedReadyOnMount);
  const mountMsRef = React.useRef(Date.now());
  const readyMsRef = React.useRef<number | null>(cachedReadyOnMount ? 0 : null);
  const firstFrameMsRef = React.useRef<number | null>(
    cachedReadyOnMount && countsForStartupTiming ? 0 : null
  );
  const timingLoggedRef = React.useRef(false);
  const activeHandoffRef = React.useRef(false);
  const prevIsActiveRef = React.useRef(isActive);
  const prevScreenFocusedRef = React.useRef(screenFocused);
  const hadFirstFrameBeforeBlurRef = React.useRef(false);
  const pendingRefocusReloadRef = React.useRef(false);
  const lastRegisterKeyRef = React.useRef("");
  const lastMutedLogKeyRef = React.useRef("");
  const lastExpectedMutedLogKeyRef = React.useRef("");
  const lastRowDiagKeyRef = React.useRef("");
  const progressRestoredRef = React.useRef(false);
  const lastProgressSaveMsRef = React.useRef(0);
  const firstFrameDiagLoggedRef = React.useRef(false);
  const playStartedLoggedRef = React.useRef(false);
  const lastBufferLogKeyRef = React.useRef("");
  const userPausedRef = React.useRef(false);
  const centerPlayOpacity = React.useRef(new Animated.Value(0)).current;
  const cornerBadgeOpacity = React.useRef(new Animated.Value(0)).current;
  const controlsEpochRef = React.useRef(0);
  const prevControlsActiveRef = React.useRef(isActive);
  const prevControlsPostKeyRef = React.useRef("");

  const readPlayerMuted = () => {
    try {
      return Boolean((player as any)?.muted);
    } catch {
      return true;
    }
  };

  const computeVideoReady = () =>
    readyMarkedRef.current || isPlayerReadyToStart(status, currentTime, playing);

  // Decode/play gate: active + focused + app active + source set. Do NOT wait
  // for readyToPlay, duration, or full buffer before calling play().
  const computeDecodeShouldPlay = () =>
    countsForStartupTiming && screenFocused && appActive && Boolean(playerSource);

  const computePreloadShouldPlay = () =>
    isPreloadNext && screenFocused && appActive && Boolean(playerSource);

  // Audio gate: only unmute once the first frame has actually rendered.
  const computeAudioShouldPlay = () =>
    isActive && screenFocused && appActive && firstFrameReady;

  const logPlayRequested = (reason: string) => {
    console.log("KRISTO_VIDEO_PLAY_REQUESTED", {
      id: postId || null,
      status: statusLower(safeGetPlayerStatus(player)),
      active: isActive,
      msFromMount: Date.now() - mountMsRef.current,
      reason,
    });
  };

  const requestPlay = (reason: string) => {
    if (playerDisposedRef.current) return;
    if (isActive && userPausedRef.current) return;
    logPlayRequested(reason);
    safePlayerPlay(player);
  };

  const requestRefocusPlayback = (reason: string) => {
    console.log("KRISTO_VIDEO_REFOCUS_PLAY_REQUEST", {
      id: postId || null,
      reason,
      status: statusLower(safeGetPlayerStatus(player)),
      currentTime: safeGetPlayerCurrentTime(player),
      firstFrameReady,
      playbackUri,
      warmMode,
    });
    activeHandoffRef.current = false;
    activateActivePlayback(reason);
    recoverAudioIfNeeded(reason);
  };

  const reloadStalledPlaybackSource = (reason: string) => {
    const lower = statusLower(safeGetPlayerStatus(player));
    const t = safeGetPlayerCurrentTime(player);
    const isPlaying = safeGetPlayerPlaying(player);
    console.log("KRISTO_VIDEO_REFOCUS_RELOAD_IF_STALLED", {
      id: postId || null,
      reason,
      status: lower,
      currentTime: t,
      playing: isPlaying,
      firstFrameReady,
      playbackUri,
    });
    activeHandoffRef.current = false;
    playStartedLoggedRef.current = false;
    setFirstFrameReady(false);
    firstFrameDiagLoggedRef.current = false;
    pendingRefocusReloadRef.current = true;
    setPlayerSourceAttached(false);
    queueMicrotask(() => {
      setPlayerSourceAttached(true);
    });
  };

  const logBufferingState = (lower: string, t: number) => {
    const buffered = safeGetPlayerBuffered(player);
    const key = `${lower}:${buffered}:${Math.floor(t * 10)}`;
    if (key === lastBufferLogKeyRef.current) return;
    lastBufferLogKeyRef.current = key;
    console.log("KRISTO_VIDEO_BUFFERING_STATE", {
      id: postId || null,
      status: lower,
      buffered,
      currentTime: t,
    });
  };

  const recoverAudioIfNeeded = (source: string) => {
    if (userPausedRef.current) return false;
    const effectiveShouldPlay = computeAudioShouldPlay();
    if (!effectiveShouldPlay) return false;
    if (!readPlayerMuted()) return false;

    if (playerDisposedRef.current) return false;
    try {
      player.muted = false;
      safePlayerPlay(player);
    } catch {}

    lastMutedLogKeyRef.current = "";
    logMutedSet("recoverAudioIfNeeded", false, source);
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_AUDIO_RECOVERED_FROM_MUTED", {
        postId: postId || null,
        source,
        warmMode,
        effectiveShouldPlay,
        firstFrameReady,
      });
    }
    return true;
  };

  const logMutedSet = (source: string, muted: boolean, reason?: string) => {
    if (!isKristoVerboseFeedDebug()) return;
    const key = `${postId}:${source}:${muted ? 1 : 0}:${warmMode}`;
    if (key === lastMutedLogKeyRef.current) return;
    lastMutedLogKeyRef.current = key;
    console.log("KRISTO_VIDEO_MUTED_SET", {
      postId: postId || null,
      muted,
      source,
      shouldPlay: isActive,
      effectiveShouldPlay: isActive && screenFocused && firstFrameReady && appActive,
      activePostId: getActiveHomeFeedVideoId(),
      warmMode,
      reason: reason || null,
    });
  };

  const setPlayerMuted = (muted: boolean, source: string, reason?: string) => {
    if (playerDisposedRef.current) return;
    // Only refuse to mute once audio is legitimately playing (post first frame);
    // before that we must be free to keep the active video muted while it decodes.
    if (muted && isActive && computeAudioShouldPlay()) {
      return;
    }
    try {
      player.muted = muted;
      logMutedSet(source, muted, reason);
    } catch {}
  };

  const logExpectedButMuted = (reason: string) => {
    const playerMuted = readPlayerMuted();
    const shouldPlay = isActive;
    const effectiveShouldPlay = computeAudioShouldPlay();
    const videoReady = computeVideoReady();

    if (!effectiveShouldPlay || !videoReady || !playerMuted) return;

    if (recoverAudioIfNeeded(reason)) return;

    if (!isKristoVerboseFeedDebug()) return;

    const key = `${postId}:${reason}:${warmMode}:${firstFrameReady ? 1 : 0}`;
    if (key === lastExpectedMutedLogKeyRef.current) return;
    lastExpectedMutedLogKeyRef.current = key;

    console.log("KRISTO_VIDEO_AUDIO_EXPECTED_BUT_MUTED", {
      postId: postId || null,
      shouldPlay,
      effectiveShouldPlay,
      videoReady,
      firstFrameReady,
      screenFocused,
      appActive,
      muted: playerMuted,
      playerMuted,
      manualPaused: userPausedRef.current,
      warmMode,
      reason,
    });
  };

  const logStartupTiming = () => {
    if (timingLoggedRef.current) return;
    timingLoggedRef.current = true;
    if (!countsForStartupTiming || firstActiveTimingLogged) return;
    firstActiveTimingLogged = true;
    console.log("KRISTO_VIDEO_STARTUP_TIMING", {
      id: postId || null,
      msToReady: readyMsRef.current,
      msToFirstFrame: firstFrameMsRef.current,
      videoUrlHost: urlHost(resolvedFullUri),
      startupUrlHost: urlHost(playbackUri),
      posterHost: urlHost(posterUri),
      warmMode,
      startupPriority: isStartupPriority,
    });
  };

  const logFirstFrameDiag = () => {
    if (!countsForStartupTiming || firstFrameDiagLoggedRef.current) return;
    firstFrameDiagLoggedRef.current = true;
    console.log("KRISTO_VIDEO_FIRST_FRAME_DIAG", {
      id: postId || null,
      firstFrameMs: firstFrameMsRef.current,
      readyMs: readyMsRef.current,
      contentLength: Number(contentLength || 0) > 0 ? Number(contentLength) : null,
      warmMode,
      wasBufferedAhead: wasHomeFeedVideoUrlBufferedAhead(playbackUri),
      wasRestored: progressRestoredRef.current,
      videoHost: urlHost(playbackUri),
      posterHost: urlHost(posterUri),
    });
  };

  const markFirstFrame = (fromCache = false) => {
    if (firstFrameMsRef.current === null) {
      firstFrameMsRef.current = fromCache ? 0 : Date.now() - mountMsRef.current;
    }
    if (isFirstFeedVideo && !firstVideoSwapLoggedRef.current) {
      firstVideoSwapLoggedRef.current = true;
      console.log("KRISTO_FIRST_VIDEO_FRAME_SWAP", {
        id: postId || null,
        firstFrameMs: firstFrameMsRef.current,
        fromCache,
      });
    }
    // Active video first frame opens the preload gate so the next video can
    // start warming without ever blocking the active one.
    if (countsForStartupTiming) {
      markHomeFeedActiveFirstFrame();
      markHomeFirstVideoReady("first-frame");
      logFirstFrameDiag();
      logHomeFeedVideoQualityTrace({
        event: "first-frame-ready",
        postId: postId || null,
        msToFirstFrame: firstFrameMsRef.current,
        selectedStartupUrl: playbackUri,
        originalVideoUrl: resolvedFullUri,
        prewarmHit,
        warmMode,
        startupPriority: isStartupPriority,
      });
    }
    setFirstFrameReady((prev) => (prev ? prev : true));
    setUpgradingQuality(false);
  };

  const activateActivePlayback = (reason: string) => {
    if (!isActive) return;
    if (userPausedRef.current) return;
    // Start decode/playback immediately when source is set; audio stays muted
    // until firstFrameReady.
    if (!computeDecodeShouldPlay()) return;

    const audioAllowed = computeAudioShouldPlay();

    // Nothing to do if we've already handed off and the audio state is correct.
    if (activeHandoffRef.current && (!audioAllowed || !readPlayerMuted())) return;

    activeHandoffRef.current = true;

    if (playerDisposedRef.current) return;
    try {
      if (audioAllowed) player.muted = false;
      requestPlay(`activateActivePlayback:${reason}`);
      lastMutedLogKeyRef.current = "";
      logMutedSet("activateActivePlayback", !audioAllowed, reason);
    } catch {}
    activateHomeFeedVideo(postId, {
      postId,
      shouldPlay: true,
      // Before the first frame, claim ownership / pause other warming players but
      // let the controller unmute only once audio is allowed.
      videoReady: audioAllowed,
      reason,
    });
    markHomeFeedFirstPlaying("simple-feed-video");
  };

  const seekPlayerToSeconds = (seconds: number, source: string) => {
    if (playerDisposedRef.current) return;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const ok = safeSetPlayerCurrentTime(player, seconds);
    if (!ok) return;
    lastKnownTimeRef.current = seconds;
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_PROGRESS_SEEK", {
        postId: postId || null,
        seconds,
        source,
      });
    }
  };

  const saveProgressIfNeeded = (source: string, opts?: { refOnly?: boolean }) => {
    const id = String(postId || "").trim();
    if (!id) return;

    // Recycled copies must never write progress back to the original post id.
    if (isRecycledRow) return;

    if (!opts?.refOnly && !playerDisposedRef.current) {
      const live = safeGetPlayerCurrentTime(player);
      if (live > 0) lastKnownTimeRef.current = live;
    }

    const now = Date.now();
    if (now - lastProgressSaveMsRef.current < 400) return;

    const t = lastKnownTimeRef.current;
    if (t <= 0.25) {
      if (playerDisposedRef.current || opts?.refOnly) {
        console.log("KRISTO_VIDEO_PROGRESS_SAVE_SKIP", {
          id,
          reason: "native-object-gone",
        });
      }
      return;
    }

    lastProgressSaveMsRef.current = now;
    saveHomeFeedVideoProgress(id, t);
  };

  React.useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    if (wasActive && !isActive) {
      saveProgressIfNeeded("lost-active");
    }
    if (isActive && !wasActive) {
      activeHandoffRef.current = false;
      progressRestoredRef.current = false;
      playStartedLoggedRef.current = false;
      lastBufferLogKeyRef.current = "";
      userPausedRef.current = false;
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, status, postId]);

  React.useLayoutEffect(() => {
    mountMsRef.current = Date.now();
    timingLoggedRef.current = false;
    readyMsRef.current = cachedReadyRef.current ? 0 : null;
    firstFrameMsRef.current = cachedReadyRef.current && countsForStartupTiming ? 0 : null;

    activeHandoffRef.current = false;

    if (!screenFocused) return;

    if (warmModeRef.current !== "active" && warmModeRef.current !== "startup-priority") {
      if (!cachedReadyRef.current) {
        try {
          setPlayerMuted(true, "layout-effect-prime", "screen-focused-mount");
          safePlayerPause(player);
        } catch {}
      }
      return;
    }

    if (!cachedReadyRef.current) {
      try {
        setPlayerMuted(true, "layout-effect-active-prime", "screen-focused-mount");
        requestPlay("layout-effect-active-prime");
      } catch {}
      return;
    }

    try {
      setPlayerMuted(true, "layout-effect-active-prime", "screen-focused-mount");
      requestPlay("layout-effect-active-cached");
    } catch {}
  }, [player, screenFocused, uri, postId]);

  React.useEffect(() => {
    if (!cachedReadyRef.current || reusedWarmLoggedRef.current) return;
    reusedWarmLoggedRef.current = true;
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_REUSED_WARM_PLAYER", { id: postId || null });
    }
  }, [postId]);

  React.useEffect(() => {
    if (!pendingRefocusReloadRef.current) return;
    if (!playerSourceAttached || !screenFocused || !isActive) return;
    if (!player || playerDisposedRef.current) return;
    pendingRefocusReloadRef.current = false;
    try {
      setPlayerMuted(true, "refocus-reload-prime");
      requestPlay("refocus-reload-prime");
    } catch {}
  }, [playerSourceAttached, player, screenFocused, isActive, postId]);

  React.useEffect(() => {
    const wasFocused = prevScreenFocusedRef.current;
    prevScreenFocusedRef.current = screenFocused;

    if (wasFocused && !screenFocused) {
      hadFirstFrameBeforeBlurRef.current = firstFrameReady;
      if (isActive) {
        saveProgressIfNeeded("screen-blur");
        console.log("KRISTO_VIDEO_BLUR_PAUSE", {
          id: postId || null,
          status: statusLower(safeGetPlayerStatus(player)),
          currentTime: safeGetPlayerCurrentTime(player),
          firstFrameReady,
          warmMode,
        });
        pauseHomeFeedVideo(postId, { postId, reason: "screen-blur" });
        safePlayerPause(player);
        try {
          setPlayerMuted(true, "screen-blur-pause");
        } catch {}
      }
      return;
    }

    if (!screenFocused || wasFocused) return;
    if (!isActive) return;

    const recoveryReason = peekHomeFeedVideoRecovery();
    const refocusReason = recoveryReason ? "live-room-exit-refocus" : "screen-refocus";

    if (
      hadFirstFrameBeforeBlurRef.current &&
      safeGetPlayerCurrentTime(player) > 0.03 &&
      !isPlayerStalledForRefocus(
        statusLower(safeGetPlayerStatus(player)),
        safeGetPlayerCurrentTime(player),
        safeGetPlayerPlaying(player)
      )
    ) {
      setFirstFrameReady((prev) => (prev ? prev : true));
      requestRefocusPlayback(refocusReason);
      if (recoveryReason) consumeHomeFeedVideoRecovery();
      return;
    }

    if (
      isPlayerStalledForRefocus(
        statusLower(safeGetPlayerStatus(player)),
        safeGetPlayerCurrentTime(player),
        safeGetPlayerPlaying(player)
      )
    ) {
      reloadStalledPlaybackSource(refocusReason);
      if (recoveryReason) consumeHomeFeedVideoRecovery();
      return;
    }

    requestRefocusPlayback(refocusReason);
    if (recoveryReason) consumeHomeFeedVideoRecovery();
  }, [screenFocused, isActive, firstFrameReady, postId, status, player, warmMode, playbackUri]);

  React.useEffect(() => {
    if (!isActive) return;
    return subscribeHomeFeedVideoRecovery(() => {
      if (!screenFocused || !peekHomeFeedVideoRecovery()) return;
      activeHandoffRef.current = false;
      activateActivePlayback("live-room-exit-recovery");
      consumeHomeFeedVideoRecovery();
    });
  }, [isActive, screenFocused, firstFrameReady, player, postId, status]);

  React.useEffect(() => {
    if (playerDisposedRef.current) return;
    if (!postId || progressRestoredRef.current) return;
    if (!sourceLoadAllowed && !isActive) return;

    // Recycled copies are treated as brand-new feed cards: never restore the
    // original post's watch position — always start at 0.
    if (isRecycledRow) {
      progressRestoredRef.current = true;
      if (!recycledStartResetLoggedRef.current) {
        recycledStartResetLoggedRef.current = true;
        console.log("KRISTO_RECYCLED_VIDEO_START_RESET", {
          id: String(postId || ""),
          feedRenderKey: String(recycleKey || ""),
          homeFeedRecycleKey: String(recycleKey || ""),
          currentTime: 0,
        });
      }
      seekPlayerToSeconds(0, "recycled-start-reset");
      return;
    }

    const saved = getHomeFeedVideoProgress(postId);
    if (saved === null || saved <= 0.1) return;

    const current = lastKnownTimeRef.current;
    if (current > 0.5 && Math.abs(current - saved) < 2) {
      progressRestoredRef.current = true;
      return;
    }

    const seekTo = peekHomeFeedVideoRestoreSeek(postId);
    if (seekTo === null) return;

    progressRestoredRef.current = true;
    console.log("KRISTO_VIDEO_PROGRESS_RESTORE", { id: postId, seconds: seekTo });
    seekPlayerToSeconds(seekTo, isActive ? "restore-on-active" : "restore-on-load");
  }, [sourceLoadAllowed, isActive, isRetainPrev, postId, player, status, isRecycledRow, recycleKey]);

  React.useEffect(() => {
    registerHomeFeedVideo(postId, player, {
      postId,
      shouldPlay: false,
      videoReady: false,
      reason: "simple-feed-video-mount",
    });

    return () => {
      playerDisposedRef.current = true;
      saveProgressIfNeeded("unmount", { refOnly: true });
      safePlayerPause(player);
      try {
        setPlayerMuted(true, "unmount-cleanup");
      } catch {}
      unregisterHomeFeedVideo(postId, { postId, reason: "simple-feed-video-unmount" });
    };
  }, [player, postId]);

  React.useEffect(() => {
    const registerKey = `${postId}:${warmMode}:${isActive ? 1 : 0}:${firstFrameReady ? 1 : 0}`;
    if (registerKey === lastRegisterKeyRef.current) return;
    lastRegisterKeyRef.current = registerKey;

    registerHomeFeedVideo(postId, player, {
      postId,
      shouldPlay: isActive,
      videoReady: firstFrameReady,
      reason: `warm-${warmMode}`,
    });
  }, [player, postId, warmMode, isActive, firstFrameReady]);

  React.useEffect(() => {
    if (!canUpgradeQuality) return;
    let cancelled = false;
    void resolveVerifiedStartupVideoUri({
      postId,
      originalVideoUrl: resolvedFullUri,
      fullQualityUri: resolvedFullUri,
      startupUri: resolvedStartupUri,
      lowResVideoUrl: resolvedStartupUri,
      hasLowRes: canUpgradeQuality,
      prewarmHit,
    }).then((verified) => {
      if (cancelled || !verified) return;
      // Only apply verification before first frame; never downgrade after playback starts.
      setPlaybackUri((current) => {
        if (firstFrameReady) return current;
        return current === verified ? current : verified;
      });
      if (verified === resolvedFullUri) {
        upgradedQualityRef.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [postId, canUpgradeQuality, resolvedStartupUri, resolvedFullUri, prewarmHit, firstFrameReady]);

  React.useEffect(() => {
    if (!countsForStartupTiming || qualityTraceLoggedRef.current) return;
    qualityTraceLoggedRef.current = true;
    logHomeFeedVideoQualityTrace({
      event: "startup-selected",
      postId: postId || null,
      feedIndex,
      selectedStartupUrl: playbackUri,
      lowResVideoUrl: canUpgradeQuality ? resolvedStartupUri : null,
      originalVideoUrl: resolvedFullUri,
      hasLowRes: canUpgradeQuality,
      prewarmHit,
      cacheHit: cachedReadyRef.current,
      warmMode,
      startupPriority: isStartupPriority,
    });
  }, [
    countsForStartupTiming,
    isStartupPriority,
    postId,
    feedIndex,
    playbackUri,
    canUpgradeQuality,
    resolvedStartupUri,
    resolvedFullUri,
    prewarmHit,
    warmMode,
  ]);

  React.useEffect(() => {
    if (!canUpgradeQuality || upgradedQualityRef.current) return;
    if (playbackUri === resolvedFullUri) return;
    // Never swap to full quality before the startup URI has painted a frame —
    // a premature swap remounts AVPlayer on an unwarmed full file and can add
    // tens of seconds before the first visible pixel.
    if (!firstFrameReady) return;

    if (qualityUpgradeTimerRef.current) {
      clearTimeout(qualityUpgradeTimerRef.current);
    }

    qualityUpgradeTimerRef.current = setTimeout(() => {
      qualityUpgradeTimerRef.current = null;
      if (upgradedQualityRef.current || !firstFrameReady) return;
      if (playbackFallbackRef.current) return;

      upgradedQualityRef.current = true;
      upgradeStartedMsRef.current = Date.now();
      qualityUpgradePendingRef.current = true;
      setUpgradingQuality(true);
      logHomeFeedVideoQualityTrace({
        event: "upgrade-start",
        postId: postId || null,
        fromUrl: playbackUri,
        toUrl: resolvedFullUri,
        msToFirstFrame: firstFrameMsRef.current,
        delayMs: QUALITY_UPGRADE_DELAY_MS,
      });
      setPlaybackUri(resolvedFullUri);
    }, QUALITY_UPGRADE_DELAY_MS);

    return () => {
      if (qualityUpgradeTimerRef.current) {
        clearTimeout(qualityUpgradeTimerRef.current);
        qualityUpgradeTimerRef.current = null;
      }
    };
  }, [firstFrameReady, canUpgradeQuality, playbackUri, resolvedFullUri, postId]);

  const fallbackToFullQuality = (reason: string) => {
    const playbackNorm = playbackUri.split("?")[0];
    const startupNorm = resolvedStartupUri.split("?")[0];
    const fullNorm = resolvedFullUri.split("?")[0];
    if (playbackFallbackRef.current) return false;
    if (!canUpgradeQuality || playbackNorm !== startupNorm || playbackNorm === fullNorm) {
      return false;
    }

    playbackFallbackRef.current = true;
    markHomeFeedLowResPreviewFailed(resolvedStartupUri);
    upgradedQualityRef.current = true;
    setUpgradingQuality(false);
    logHomeFeedVideoQualityTrace({
      event: "startup-fallback-full",
      postId: postId || null,
      reason,
      fromUrl: playbackUri,
      toUrl: resolvedFullUri,
    });
    setPlaybackUri(resolvedFullUri);
    return true;
  };

  React.useEffect(() => {
    if (playerDisposedRef.current) return;
    if (statusLower(status) !== "error") return;

    console.log("KRISTO_VIDEO_PLAYER_ERROR", {
      id: postId || null,
      playbackUri,
      fullUri: resolvedFullUri,
      warmMode,
    });

    fallbackToFullQuality("player-error");
  }, [status, playbackUri, resolvedFullUri, resolvedStartupUri, canUpgradeQuality, postId, warmMode]);

  React.useEffect(() => {
    if (mountedUriRef.current !== playbackUri) {
      const isQualityUpgrade = qualityUpgradePendingRef.current;
      qualityUpgradePendingRef.current = false;
      mountedUriRef.current = playbackUri;
      mountMsRef.current = Date.now();
      timingLoggedRef.current = false;
      preloadPrimedRef.current = false;
      preloadStartLoggedRef.current = false;

      if (isQualityUpgrade) {
        setUpgradingQuality(true);
        const savedTime = lastKnownTimeRef.current;
        if (savedTime > 0.05) {
          seekPlayerToSeconds(savedTime, "quality-upgrade");
        }
        requestPlay("quality-upgrade-resume");
        if (upgradeStartedMsRef.current) {
          logHomeFeedVideoQualityTrace({
            event: "upgrade-applied",
            postId: postId || null,
            upgradeToHighQualityMs: Date.now() - upgradeStartedMsRef.current,
            selectedStartupUrl: resolvedStartupUri,
            originalVideoUrl: resolvedFullUri,
          });
          upgradeStartedMsRef.current = null;
        }
        return;
      }

      readyMarkedRef.current = false;
      cachedReadyRef.current = isHomeFeedVideoPreloadReady(postId, playbackUri);
      reusedWarmLoggedRef.current = false;
      readyMsRef.current = cachedReadyRef.current ? 0 : null;
      firstFrameMsRef.current = null;
      setFirstFrameReady(false);
      activeHandoffRef.current = false;
      lastRegisterKeyRef.current = "";
      progressRestoredRef.current = false;
      firstFrameDiagLoggedRef.current = false;
      playStartedLoggedRef.current = false;
      lastBufferLogKeyRef.current = "";

      try {
        setPlayerMuted(true, "uri-change-prime");
        requestPlay("uri-change-prime");
      } catch {}
    }
  }, [playbackUri, postId, player, resolvedFullUri, resolvedStartupUri]);

  React.useEffect(() => {
    if (!countsForStartupTiming || !playbackUri || !screenFocused) return;
    void logFirstMountedHomeFeedVideoFileDiag({
      playbackUri,
      contentLength,
      durationMs: videoDurationMs,
      playerDurationSec: safeGetPlayerDuration(player) || null,
    });
  }, [
    countsForStartupTiming,
    playbackUri,
    screenFocused,
    contentLength,
    videoDurationMs,
    player,
    postId,
  ]);

  React.useEffect(() => {
    if (!screenFocused) return;
    if (!isActive && !shouldPrime) return;
    if (preloadStartLoggedRef.current) return;
    preloadStartLoggedRef.current = true;
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_WARMUP_START", {
        id: postId || null,
        videoUrl: uri,
        warmMode,
      });
      console.log("KRISTO_VIDEO_PRELOAD_START", { id: postId || null, videoUrl: uri });
    }
  }, [shouldPrime, isActive, screenFocused, postId, uri, warmMode]);

  React.useEffect(() => {
    if (playerDisposedRef.current) return;

    if (!screenFocused) {
      safePlayerPause(player);
      try {
        setPlayerMuted(true, "screen-unfocused");
      } catch {}
      return;
    }

    if (isActive) {
      if (computeDecodeShouldPlay()) {
        activateActivePlayback("simple-feed-video-active-handoff");
        recoverAudioIfNeeded("active-playback-effect");
        if (firstFrameReady) logStartupTiming();
      }
      return;
    }

    if (isStartupPriority) {
      setPlayerMuted(true, "startup-priority-prime", warmMode);
      if (computeDecodeShouldPlay() && !firstFrameReady) {
        requestPlay("startup-priority-decode");
      }
      return;
    }

    if (isRetainPrev) {
      setPlayerMuted(true, "retain-prev-paused", warmMode);
      safePlayerPause(player);
      return;
    }

    if (shouldPrime) {
      setPlayerMuted(true, "warm-preload-prime", warmMode);
      if (computePreloadShouldPlay()) {
        if (!firstFrameReady) {
          safePlayerPause(player);
        } else if (!preloadPrimedRef.current) {
          preloadPrimedRef.current = true;
          safePlayerPause(player);
        }
      }
      return;
    }

    safePlayerPause(player);
    try {
      setPlayerMuted(true, "inactive-off-screen");
    } catch {}
  }, [
    player,
    isActive,
    isStartupPriority,
    isRetainPrev,
    shouldPrime,
    screenFocused,
    uri,
    warmMode,
    firstFrameReady,
    appActive,
  ]);

  React.useEffect(() => {
    if (!screenFocused || playerDisposedRef.current) return;

    const lower = statusLower(status);
    const t = safeGetPlayerCurrentTime(player);
    if (t > 0) lastKnownTimeRef.current = t;
    const isPlaying = safeGetPlayerPlaying(player);
    lastKnownPlayingRef.current = isPlaying;

    logBufferingState(lower, t);

    if (isPlaying && !playStartedLoggedRef.current) {
      playStartedLoggedRef.current = true;
      console.log("KRISTO_VIDEO_PLAY_STARTED", {
        id: postId || null,
        status: lower,
        currentTime: t,
      });
    }

    if (isPlayerReadyToStart(status, t, isPlaying) && readyMsRef.current === null) {
      readyMsRef.current = Date.now() - mountMsRef.current;
      if (readyMsRef.current <= 800) {
        console.log("KRISTO_VIDEO_READY_FAST", {
          id: postId || null,
          warmMode,
          ms: readyMsRef.current,
        });
      }
    }

    if (countsForStartupTiming && computeDecodeShouldPlay()) {
      if (!firstFrameReady) {
        if (isActive) {
          activateActivePlayback("status-progressive-pre-frame");
        } else {
          requestPlay("status-startup-priority-pre-frame");
        }
      } else if (isActive && !isPlaying) {
        requestPlay("status-active-continue");
      }
    }

    if (shouldPrime && !countsForStartupTiming && firstFrameReady) {
      safePlayerPause(player);
      setPlayerMuted(true, "preload-first-frame-pause", warmMode);
    }

    if (!shouldMarkReadiness(status, t, isPlaying)) {
      return;
    }

    if (isFirstFeedVideo && countsForStartupTiming && !hasPaintedFrame(t)) {
      if (!firstVideoHoldLoggedRef.current) {
        firstVideoHoldLoggedRef.current = true;
        console.log("KRISTO_FIRST_VIDEO_POSTER_HOLD", {
          id: postId || null,
          status: statusLower(status),
          currentTime: t,
          playing: isPlaying,
        });
      }
      return;
    }

    if (!readyMarkedRef.current) {
      readyMarkedRef.current = true;
      markHomeFeedVideoPreloadReady(postId, playbackUri);
      cachedReadyRef.current = true;
      if (shouldPrime) {
        if (isKristoVerboseFeedDebug()) {
          console.log("KRISTO_VIDEO_PRELOAD_READY", { id: postId || null });
        }
      }
    } else if (isPreload || isRetainPrev) {
      touchHomeFeedVideoReadiness(postId, uri);
    }

    if (countsForStartupTiming) {
      markFirstFrame(false);
      if (isActive) {
        activateActivePlayback("simple-feed-video-active");
        recoverAudioIfNeeded("status-ready-active");
      }
      logStartupTiming();
      return;
    }

    markFirstFrame(false);

    if (!isActive && !shouldPrime) {
      safePlayerPause(player);
      setPlayerMuted(true, "status-ready-inactive", warmMode);
    }
  }, [
    isActive,
    shouldPrime,
    isRetainPrev,
    isPreload,
    screenFocused,
    status,
    currentTime,
    playing,
    player,
    postId,
    uri,
    warmMode,
    firstFrameReady,
    appActive,
  ]);

  React.useEffect(() => {
    if (countsForStartupTiming || !screenFocused) return;
    pauseHomeFeedVideo(postId, { postId, reason: `warm-${warmMode}` });
  }, [countsForStartupTiming, isActive, warmMode, screenFocused, postId]);

  // Diagnostic (first 3 video rows): dev-only when KRISTO_VERBOSE_FEED_DEBUG is on.
  React.useEffect(() => {
    if (!isKristoVerboseFeedDebug()) return;
    if (feedIndex < 0 || feedIndex > 2) return;
    const videoShouldPlay = computeDecodeShouldPlay();
    const videoReady = computeVideoReady();
    const key = `${feedIndex}:${isActive ? 1 : 0}:${firstFrameReady ? 1 : 0}:${videoReady ? 1 : 0}:${videoShouldPlay ? 1 : 0}:${screenFocused ? 1 : 0}:${appActive ? 1 : 0}:${warmMode}:${statusLower(status)}`;
    if (key === lastRowDiagKeyRef.current) return;
    lastRowDiagKeyRef.current = key;
    console.log("KRISTO_VIDEO_ROW_DIAG", {
      id: postId || null,
      index: feedIndex,
      isActive,
      shouldPlay: isActive,
      videoShouldPlay,
      warmMode,
      videoReady,
      firstFrameReady,
      screenFocused,
      appActive,
      status: statusLower(status),
    });
  }, [
    feedIndex,
    isActive,
    firstFrameReady,
    screenFocused,
    appActive,
    status,
    currentTime,
    playing,
    warmMode,
    postId,
  ]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, resolvedFullUri);
  const hasBranded = brandedPoster || hasBrandedVideoPoster({ posterUri: poster, brandedPoster });
  const showCoverUntilFirstFrame = !firstFrameReady || upgradingQuality;
  const showPosterOverlay = showCoverUntilFirstFrame && hasPoster;
  const showBrandedCover = showCoverUntilFirstFrame && !hasPoster && hasBranded;
  const showGoldFallback = showCoverUntilFirstFrame && !hasPoster && !hasBranded;
  const hideVideoSurface = showCoverUntilFirstFrame;
  const homeFeedPosterTimeoutMs = getHomeFeedPosterLoadTimeoutMs();
  const resolvedPosterMetadata = posterMetadata || snapshotPosterMetadata({
    posterUri,
    brandedPoster,
  });

  React.useEffect(() => {
    if (!isFirstFeedVideo || !countsForStartupTiming) return;
    if (firstPosterCheckLogged) return;
    firstPosterCheckLogged = true;
    console.log("KRISTO_VIDEO_FIRST_POSTER_CHECK", {
      id: postId || null,
      hasPosterUrl: hasPoster,
      posterHost: urlHost(poster),
      videoUrlHost: urlHost(resolvedFullUri),
      contentLength: Number(contentLength || 0) > 0 ? Number(contentLength) : null,
      brandedPoster: hasBranded,
      warmMode,
      startupPriority: isStartupPriority,
    });
  }, [
    isFirstFeedVideo,
    countsForStartupTiming,
    isStartupPriority,
    postId,
    poster,
    hasPoster,
    hasBranded,
    contentLength,
    warmMode,
    resolvedFullUri,
  ]);

  React.useEffect(() => {
    if (!hasPoster || !countsForStartupTiming) return;
    Image.prefetch(poster).catch(() => {});
  }, [poster, hasPoster, countsForStartupTiming]);

  const showPlaybackControls = isActive && screenFocused && firstFrameReady;

  const showPausedControls = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(centerPlayOpacity, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cornerBadgeOpacity, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [centerPlayOpacity, cornerBadgeOpacity]);

  const resetPlaybackControls = React.useCallback(() => {
    controlsEpochRef.current += 1;
    centerPlayOpacity.setValue(0);
    cornerBadgeOpacity.setValue(0);
  }, [centerPlayOpacity, cornerBadgeOpacity]);

  const resetPlaybackControlsWithLog = React.useCallback(
    (reason: "inactive" | "active-autoplay") => {
      userPausedRef.current = false;
      resetPlaybackControls();
      console.log("KRISTO_VIDEO_CONTROLS_RESET", {
        id: postId || null,
        reason,
      });
    },
    [postId, resetPlaybackControls]
  );

  const hidePlayingControls = React.useCallback(() => {
    centerPlayOpacity.setValue(0);
    Animated.timing(cornerBadgeOpacity, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [centerPlayOpacity, cornerBadgeOpacity]);

  const togglePlayPause = React.useCallback(() => {
    if (!showPlaybackControls || playerDisposedRef.current) return;

    const isPlaying = safeGetPlayerPlaying(player);
    if (isPlaying) {
      userPausedRef.current = true;
      safePlayerPause(player);
      showPausedControls();
      return;
    }

    userPausedRef.current = false;
    if (computeAudioShouldPlay()) {
      try {
        player.muted = false;
      } catch {}
    }
    safePlayerPlay(player);
    hidePlayingControls();
  }, [showPlaybackControls, player, showPausedControls, hidePlayingControls]);

  React.useEffect(() => {
    if (!showPlaybackControls) {
      resetPlaybackControls();
      return;
    }

    if (!playing) {
      if (userPausedRef.current) {
        showPausedControls();
      } else {
        resetPlaybackControls();
      }
      return;
    }

    hidePlayingControls();
  }, [showPlaybackControls, playing, showPausedControls, hidePlayingControls, resetPlaybackControls]);

  React.useEffect(() => {
    const postKey = `${postId}|${uri}|${recycleKey}`;
    if (postKey !== prevControlsPostKeyRef.current) {
      prevControlsPostKeyRef.current = postKey;
      resetPlaybackControlsWithLog("active-autoplay");
    }
  }, [postId, uri, recycleKey, resetPlaybackControlsWithLog]);

  React.useEffect(() => {
    const wasActive = prevControlsActiveRef.current;
    if (wasActive && !isActive) {
      resetPlaybackControlsWithLog("inactive");
    } else if (isActive && !wasActive) {
      resetPlaybackControlsWithLog("active-autoplay");
    }
    prevControlsActiveRef.current = isActive;
  }, [isActive, resetPlaybackControlsWithLog]);

  const videoTapGesture = React.useMemo(() => {
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(250)
      .onEnd(() => {
        runOnJS(togglePlayPause)();
      });

    if (!onDoubleTap) {
      return singleTap;
    }

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(300)
      .onEnd(() => {
        runOnJS(onDoubleTap)();
      });

    return Gesture.Exclusive(doubleTap, singleTap);
  }, [togglePlayPause, onDoubleTap]);

  return (
    <GestureDetector gesture={videoTapGesture}>
      <View style={styles.root}>
      <VideoView
        player={player}
        style={[styles.videoSurface, hideVideoSurface && styles.videoHidden]}
        contentFit="cover"
        nativeControls={false}
      />
      {showPosterOverlay ? (
        <View style={styles.overlay} pointerEvents="none">
          <FeedVideoPosterImage
            uri={poster}
            style={styles.overlayFill}
            resizeMode="cover"
            postId={postId}
            title={title}
            videoUrl={resolvedFullUri}
            mediaStatus={mediaStatus}
            previewLoadTimeoutMs={homeFeedPosterTimeoutMs}
            posterMetadata={resolvedPosterMetadata}
            videoDurationMs={videoDurationMs}
            enableVideoFrameFallback
          />
        </View>
      ) : null}
      {showBrandedCover || showGoldFallback ? (
        <View style={styles.overlay} pointerEvents="none">
          <VideoPostFallbackPoster
            variant="full"
            postId={postId}
            title={title}
            videoUrl={resolvedFullUri}
            mediaStatus={mediaStatus}
            suppressMissingPosterLog={showBrandedCover}
          />
        </View>
      ) : null}
      {showPlaybackControls ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[styles.centerPlayOverlay, { opacity: centerPlayOpacity }]}
          >
            <View style={styles.centerPlayButton}>
              <Ionicons name="play" size={34} color="rgba(255,255,255,0.96)" />
            </View>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[styles.cornerPlaybackBadge, { opacity: cornerBadgeOpacity }]}
          >
            <Ionicons
              name={playing ? "pause" : "play"}
              size={16}
              color="rgba(255,255,255,0.94)"
            />
          </Animated.View>
        </>
      ) : null}
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#1B2A44",
  },
  videoSurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  videoHidden: {
    opacity: 0,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  overlayFill: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  centerPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  centerPlayButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    paddingLeft: 4,
  },
  cornerPlaybackBadge: {
    position: "absolute",
    right: 14,
    bottom: 14,
    zIndex: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.44)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
});
