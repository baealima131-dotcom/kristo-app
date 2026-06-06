import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { markHomeFeedFirstPlaying, markHomeFirstVideoReady } from "@/src/lib/firstPaint";
import {
  activateHomeFeedVideo,
  consumeHomeFeedVideoRecovery,
  pauseHomeFeedVideo,
  peekHomeFeedVideoRecovery,
  registerHomeFeedVideo,
  subscribeHomeFeedVideoRecovery,
  unregisterHomeFeedVideo,
} from "@/src/lib/homeFeedVideoController";
import {
  isHomeFeedVideoPreloadReady,
  markHomeFeedVideoPreloadReady,
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

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    try {
      p.play();
    } catch {}
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });
  const currentTime = Number((player as any)?.currentTime || 0);
  const playing = Boolean((player as any)?.playing);

  const isActive = warmMode === "active";
  const isPreload = warmMode === "preload";
  const isWarm = warmMode === "warm";
  const shouldPrime = isPreload || isWarm;

  const [firstFrameReady, setFirstFrameReady] = useState(
    () => isActive && cachedReadyOnMount
  );

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
  const prevScreenFocusedRef = useRef(screenFocused);
  const lastRegisterKeyRef = useRef("");

  const logStartupTiming = (mode: HomeFeedVideoWarmMode) => {
    if (timingLoggedRef.current) return;
    timingLoggedRef.current = true;
    console.log("KRISTO_VIDEO_STARTUP_TIMING", {
      id: postId || null,
      warmMode: mode,
      msToReady: readyMsRef.current,
      msToFirstFrame: firstFrameMsRef.current,
      reusedReady: cachedReadyRef.current,
    });
  };

  const markFirstFrame = (fromCache = false) => {
    if (firstFrameMsRef.current === null) {
      firstFrameMsRef.current = fromCache ? 0 : Date.now() - mountMsRef.current;
      console.log("KRISTO_VIDEO_FIRST_FRAME_DELAY", {
        id: postId || null,
        warmMode,
        ms: firstFrameMsRef.current,
        fromCache,
      });
    }
    setFirstFrameReady((prev) => (prev ? prev : true));
  };

  const activateActivePlayback = (reason: string) => {
    if (!isActive) return;
    if (activeHandoffRef.current) return;
    activeHandoffRef.current = true;

    try {
      player.muted = false;
      player.play();
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

  useLayoutEffect(() => {
    mountMsRef.current = Date.now();
    timingLoggedRef.current = false;
    readyMsRef.current = cachedReadyRef.current ? 0 : null;
    firstFrameMsRef.current = cachedReadyRef.current && warmModeRef.current === "active" ? 0 : null;

    activeHandoffRef.current = false;

    if (!screenFocused) return;

    try {
      player.muted = true;
      player.play();
    } catch {}

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
        player.muted = true;
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
        player.muted = true;
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
        player.muted = true;
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
        player.muted = true;
      } catch {}
      return;
    }

    if (isActive) {
      if (!activeHandoffRef.current) {
        try {
          player.muted = true;
          player.play();
        } catch {}
      }

      if (firstFrameReady && !activeHandoffRef.current) {
        activateActivePlayback("simple-feed-video-active-handoff");
        logStartupTiming(warmMode);
      }
      return;
    }

    if (shouldPrime) {
      player.muted = true;
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
      player.muted = true;
    } catch {}
  }, [player, isActive, shouldPrime, screenFocused, uri, warmMode, firstFrameReady]);

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

    if (shouldPrime && (lower === "readytoplay" || lower === "playing" || currentTime > 0)) {
      try {
        player.pause();
        player.muted = true;
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
      if (!activeHandoffRef.current) {
        activateActivePlayback("simple-feed-video-active");
        logStartupTiming(warmMode);
      }
      return;
    }

    markFirstFrame(false);

    try {
      player.pause();
      player.muted = true;
    } catch {}
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
});
