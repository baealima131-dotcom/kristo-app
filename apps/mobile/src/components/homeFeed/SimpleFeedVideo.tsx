import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
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
  isHomeFeedActiveFirstFrameReady,
  isHomeFeedVideoPreloadReady,
  markHomeFeedActiveFirstFrame,
  markHomeFeedVideoPreloadReady,
  subscribeHomeFeedActiveFirstFrame,
  touchHomeFeedVideoReadiness,
} from "@/src/lib/homeFeedVideoReadiness";
import type { HomeFeedVideoWarmMode } from "@/src/lib/homeFeedVideoWindow";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import { hasBrandedVideoPoster, isValidVideoPosterUri } from "./homeFeedUtils";
import { FeedVideoPosterImage, VideoPostFallbackPoster } from "./VideoPostFallbackPoster";

type Props = {
  postId?: string;
  title?: string;
  mediaStatus?: string;
  uri: string;
  posterUri?: string;
  brandedPoster?: boolean;
  warmMode: HomeFeedVideoWarmMode;
  screenFocused: boolean;
};

// V1 perf: only emit startup/first-frame timing for the first active video in
// the session. Subsequent active videos stay quiet to keep logs minimal.
let firstActiveTimingLogged = false;

// If the active video's first frame takes longer than this, show a small
// loading indicator over the poster instead of a bare poster/black screen.
const SLOW_FIRST_FRAME_MS = 2500;

function urlHost(url: string): string | null {
  const match = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function statusLower(status: string) {
  return String(status || "").trim().toLowerCase();
}

function hasDecodedFrame(status: string, currentTime: number, playing: boolean) {
  const lower = statusLower(status);
  return (
    currentTime > 0.03 ||
    playing ||
    lower === "playing" ||
    lower === "readytoplay"
  );
}

function isPlayerReadyToStart(status: string, currentTime: number, playing: boolean) {
  const lower = statusLower(status);
  return (
    hasDecodedFrame(status, currentTime, playing) ||
    lower === "loading" ||
    lower === "loaded"
  );
}

function shouldMarkReadiness(status: string, currentTime: number, playing: boolean) {
  return hasDecodedFrame(status, currentTime, playing);
}

/**
 * Active row plays with audio; preload/warm rows keep muted paused players ready for handoff.
 */
export const SimpleFeedVideo = memo(function SimpleFeedVideo({
  postId = "",
  title = "",
  mediaStatus = "",
  uri,
  posterUri = "",
  brandedPoster = false,
  warmMode,
  screenFocused,
}: Props) {
  const cachedReadyOnMount = isHomeFeedVideoPreloadReady(postId, uri);
  const cachedReadyRef = useRef(cachedReadyOnMount);
  const warmModeRef = useRef(warmMode);
  warmModeRef.current = warmMode;

  const isActive = warmMode === "active";

  // V1 perf: the active video loads immediately; the next-video preload defers
  // loading its source until the active video has reached its first frame, so a
  // second large R2 download never competes with the active one.
  const [preloadGateOpen, setPreloadGateOpen] = useState(() =>
    isHomeFeedActiveFirstFrameReady()
  );

  useEffect(() => {
    if (isActive || preloadGateOpen) return;
    if (isHomeFeedActiveFirstFrameReady()) {
      setPreloadGateOpen(true);
      return;
    }
    return subscribeHomeFeedActiveFirstFrame(() => setPreloadGateOpen(true));
  }, [isActive, preloadGateOpen]);

  const sourceLoadAllowed = isActive || preloadGateOpen;
  const playerSource = sourceLoadAllowed ? uri : null;

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = true;
    p.muted = true;
    try {
      p.play();
    } catch {}
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });
  const currentTime = Number((player as any)?.currentTime || 0);
  const playing = Boolean((player as any)?.playing);

  const isPreload = warmMode === "preload";
  const isWarm = warmMode === "warm";
  const shouldPrime = isPreload || isWarm;

  const [firstFrameReady, setFirstFrameReady] = useState(
    () => isActive && cachedReadyOnMount
  );
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const [slowFirstFrame, setSlowFirstFrame] = useState(false);

  useEffect(() => {
    if (!isActive || firstFrameReady) {
      setSlowFirstFrame(false);
      return;
    }
    const timer = setTimeout(() => setSlowFirstFrame(true), SLOW_FIRST_FRAME_MS);
    return () => clearTimeout(timer);
  }, [isActive, firstFrameReady, uri]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
    });
    return () => sub.remove();
  }, []);

  const mountedUriRef = useRef(uri);
  const preloadPrimedRef = useRef(false);
  const preloadStartLoggedRef = useRef(false);
  const reusedWarmLoggedRef = useRef(false);
  const readyMarkedRef = useRef(cachedReadyOnMount);
  const mountMsRef = useRef(Date.now());
  const readyMsRef = useRef<number | null>(cachedReadyOnMount ? 0 : null);
  const firstFrameMsRef = useRef<number | null>(cachedReadyOnMount && isActive ? 0 : null);
  const timingLoggedRef = useRef(false);
  const activeHandoffRef = useRef(false);
  const prevIsActiveRef = useRef(isActive);
  const prevScreenFocusedRef = useRef(screenFocused);
  const lastRegisterKeyRef = useRef("");
  const lastMutedLogKeyRef = useRef("");
  const lastExpectedMutedLogKeyRef = useRef("");

  const readPlayerMuted = () => {
    try {
      return Boolean((player as any)?.muted);
    } catch {
      return true;
    }
  };

  const computeEffectiveShouldPlay = () =>
    isActive && screenFocused && firstFrameReady && appActive;

  const computeVideoReady = () =>
    readyMarkedRef.current || isPlayerReadyToStart(status, currentTime, playing);

  const recoverAudioIfNeeded = (source: string) => {
    const effectiveShouldPlay = computeEffectiveShouldPlay();
    const videoReady = computeVideoReady();
    if (!effectiveShouldPlay || !videoReady) return false;
    if (!readPlayerMuted()) return false;

    try {
      player.muted = false;
      player.play();
    } catch {}

    lastMutedLogKeyRef.current = "";
    logMutedSet("recoverAudioIfNeeded", false, source);
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_AUDIO_RECOVERED_FROM_MUTED", {
        postId: postId || null,
        source,
        warmMode,
        effectiveShouldPlay,
        videoReady,
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
    if (muted && isActive && computeEffectiveShouldPlay()) {
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
    const effectiveShouldPlay = computeEffectiveShouldPlay();
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
      manualPaused: false,
      warmMode,
      reason,
    });
  };

  const logStartupTiming = () => {
    if (timingLoggedRef.current) return;
    timingLoggedRef.current = true;
    // Only the first active video in the session emits startup timing.
    if (!isActive || firstActiveTimingLogged) return;
    firstActiveTimingLogged = true;
    console.log("KRISTO_VIDEO_STARTUP_TIMING", {
      id: postId || null,
      msToReady: readyMsRef.current,
      msToFirstFrame: firstFrameMsRef.current,
      videoUrlHost: urlHost(uri),
      posterHost: urlHost(posterUri),
    });
  };

  const markFirstFrame = (fromCache = false) => {
    if (firstFrameMsRef.current === null) {
      firstFrameMsRef.current = fromCache ? 0 : Date.now() - mountMsRef.current;
    }
    // Active video first frame opens the preload gate so the next video can
    // start warming without ever blocking the active one.
    if (isActive) markHomeFeedActiveFirstFrame();
    setFirstFrameReady((prev) => (prev ? prev : true));
  };

  const activateActivePlayback = (reason: string) => {
    if (!isActive) return;
    if (!computeEffectiveShouldPlay()) return;

    if (activeHandoffRef.current && !readPlayerMuted()) return;

    activeHandoffRef.current = true;

    try {
      player.muted = false;
      player.play();
      lastMutedLogKeyRef.current = "";
      logMutedSet("activateActivePlayback", false, reason);
    } catch {}
    activateHomeFeedVideo(postId, {
      postId,
      shouldPlay: true,
      videoReady: true,
      reason,
    });
    markHomeFeedFirstPlaying("simple-feed-video");
    markHomeFirstVideoReady("simple-feed-video");
  };

  useEffect(() => {
    if (isActive && !prevIsActiveRef.current) {
      activeHandoffRef.current = false;
    }
    prevIsActiveRef.current = isActive;
  }, [isActive]);

  useLayoutEffect(() => {
    mountMsRef.current = Date.now();
    timingLoggedRef.current = false;
    readyMsRef.current = cachedReadyRef.current ? 0 : null;
    firstFrameMsRef.current = cachedReadyRef.current && warmModeRef.current === "active" ? 0 : null;

    activeHandoffRef.current = false;

    if (!screenFocused) return;

    if (warmModeRef.current !== "active" || !cachedReadyRef.current) {
      try {
        setPlayerMuted(true, "layout-effect-prime", "screen-focused-mount");
        player.play();
      } catch {}
    }

    if (warmModeRef.current === "active" && cachedReadyRef.current) {
      markFirstFrame(true);
    }
  }, [player, screenFocused, uri, postId]);

  useEffect(() => {
    if (!cachedReadyRef.current || reusedWarmLoggedRef.current) return;
    reusedWarmLoggedRef.current = true;
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_REUSED_WARM_PLAYER", { id: postId || null });
    }
  }, [postId]);

  useEffect(() => {
    const wasFocused = prevScreenFocusedRef.current;
    prevScreenFocusedRef.current = screenFocused;

    if (screenFocused && !wasFocused) {
      activeHandoffRef.current = false;
      if (isActive && firstFrameReady) {
        activateActivePlayback(
          peekHomeFeedVideoRecovery() ? "live-room-exit-refocus" : "screen-refocus"
        );
        if (peekHomeFeedVideoRecovery()) {
          consumeHomeFeedVideoRecovery();
        }
      }
    }
  }, [screenFocused, isActive, firstFrameReady, postId]);

  useEffect(() => {
    if (!isActive) return;
    return subscribeHomeFeedVideoRecovery(() => {
      if (!screenFocused || !peekHomeFeedVideoRecovery()) return;
      activeHandoffRef.current = false;
      if (firstFrameReady) {
        activateActivePlayback("live-room-exit-recovery");
        consumeHomeFeedVideoRecovery();
        return;
      }
      try {
        setPlayerMuted(true, "live-room-recovery-prime", "await-first-frame");
        player.play();
      } catch {}
    });
  }, [isActive, screenFocused, firstFrameReady, player, postId]);

  useEffect(() => {
    registerHomeFeedVideo(postId, player, {
      postId,
      shouldPlay: false,
      videoReady: false,
      reason: "simple-feed-video-mount",
    });

    return () => {
      try {
        player.pause();
        setPlayerMuted(true, "unmount-cleanup");
      } catch {}
      unregisterHomeFeedVideo(postId, { postId, reason: "simple-feed-video-unmount" });
    };
  }, [player, postId]);

  useEffect(() => {
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

  useEffect(() => {
    if (mountedUriRef.current !== uri) {
      mountedUriRef.current = uri;
      mountMsRef.current = Date.now();
      timingLoggedRef.current = false;
      preloadPrimedRef.current = false;
      preloadStartLoggedRef.current = false;
      readyMarkedRef.current = false;
      cachedReadyRef.current = isHomeFeedVideoPreloadReady(postId, uri);
      reusedWarmLoggedRef.current = false;
      readyMsRef.current = cachedReadyRef.current ? 0 : null;
      firstFrameMsRef.current = null;
      setFirstFrameReady(false);
      activeHandoffRef.current = false;
      lastRegisterKeyRef.current = "";

      try {
        setPlayerMuted(true, "uri-change-prime");
        player.play();
      } catch {}
    }
  }, [uri, postId, player]);

  useEffect(() => {
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

  useEffect(() => {
    if (!screenFocused) {
      try {
        player.pause();
        setPlayerMuted(true, "screen-unfocused");
      } catch {}
      return;
    }

    if (isActive) {
      if (firstFrameReady && computeVideoReady()) {
        activateActivePlayback("simple-feed-video-active-handoff");
        recoverAudioIfNeeded("active-playback-effect");
        logStartupTiming();
      } else if (!activeHandoffRef.current) {
        try {
          setPlayerMuted(true, "active-pre-handoff", "await-first-frame");
          player.play();
        } catch {}
      }
      return;
    }

    if (shouldPrime) {
      setPlayerMuted(true, "warm-preload-prime", warmMode);
      if (!preloadPrimedRef.current) {
        preloadPrimedRef.current = true;
        try {
          player.play();
        } catch {}
      }
      return;
    }

    try {
      player.pause();
      setPlayerMuted(true, "inactive-off-screen");
    } catch {}
  }, [player, isActive, shouldPrime, screenFocused, uri, warmMode, firstFrameReady, appActive]);

  useEffect(() => {
    if (!screenFocused) return;

    const lower = statusLower(status);

    if (isPlayerReadyToStart(status, currentTime, playing) && readyMsRef.current === null) {
      readyMsRef.current = Date.now() - mountMsRef.current;
      if (readyMsRef.current <= 800) {
        console.log("KRISTO_VIDEO_READY_FAST", {
          id: postId || null,
          warmMode,
          ms: readyMsRef.current,
        });
      }
    }

    if (isActive && isPlayerReadyToStart(status, currentTime, playing)) {
      try {
        player.play();
      } catch {}
    }

    if (shouldPrime && !isActive && (lower === "readytoplay" || lower === "playing" || currentTime > 0)) {
      try {
        player.pause();
        setPlayerMuted(true, "preload-ready-pause", warmMode);
      } catch {}
    }

    if (!shouldMarkReadiness(status, currentTime, playing)) {
      return;
    }

    if (!readyMarkedRef.current) {
      readyMarkedRef.current = true;
      markHomeFeedVideoPreloadReady(postId, uri);
      cachedReadyRef.current = true;
      if (shouldPrime) {
        if (isKristoVerboseFeedDebug()) {
          console.log("KRISTO_VIDEO_PRELOAD_READY", { id: postId || null });
        }
      }
    } else if (isWarm || isPreload) {
      touchHomeFeedVideoReadiness(postId, uri);
    }

    if (isActive) {
      markFirstFrame(false);
      activateActivePlayback("simple-feed-video-active");
      recoverAudioIfNeeded("status-ready-active");
      logStartupTiming();
      return;
    }

    markFirstFrame(false);

    if (!isActive && !shouldPrime) {
      try {
        player.pause();
        setPlayerMuted(true, "status-ready-inactive", warmMode);
      } catch {}
    }
  }, [
    isActive,
    shouldPrime,
    isWarm,
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

  useEffect(() => {
    if (isActive || !screenFocused) return;
    pauseHomeFeedVideo(postId, { postId, reason: `warm-${warmMode}` });
  }, [isActive, warmMode, screenFocused, postId]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, uri);
  const hasBranded = brandedPoster || hasBrandedVideoPoster({ posterUri: poster, brandedPoster });
  const showPosterOverlay = hasPoster && !firstFrameReady;
  const showBrandedCover = hasBranded && !hasPoster && !firstFrameReady;
  const showGoldFallback = !hasPoster && !hasBranded && !firstFrameReady;
  const hideVideoSurface = showPosterOverlay || showBrandedCover || showGoldFallback;

  return (
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
            videoUrl={uri}
            mediaStatus={mediaStatus}
          />
        </View>
      ) : null}
      {showBrandedCover || showGoldFallback ? (
        <View style={styles.overlay} pointerEvents="none">
          <VideoPostFallbackPoster
            variant="full"
            postId={postId}
            title={title}
            videoUrl={uri}
            mediaStatus={mediaStatus}
            suppressMissingPosterLog={showBrandedCover}
          />
        </View>
      ) : null}
      {isActive && !firstFrameReady && slowFirstFrame ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <View style={styles.loadingPill}>
            <ActivityIndicator size="small" color="#F4D06F" />
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  loadingPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,5,12,0.55)",
  },
});
