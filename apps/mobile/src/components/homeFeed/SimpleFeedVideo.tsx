import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Image, LayoutChangeEvent, StyleSheet, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { markHomeFeedFirstPlaying, markHomeFirstVideoReady } from "@/src/lib/firstPaint";
import {
  activateHomeFeedVideo,
  pauseAllHomeFeedVideos,
  pauseHomeFeedVideo,
  registerHomeFeedVideo,
  unregisterHomeFeedVideo,
} from "@/src/lib/homeFeedVideoController";
import {
  isHomeFeedVideoPreloadReady,
  markHomeFeedVideoPreloadReady,
  touchHomeFeedVideoReadiness,
} from "@/src/lib/homeFeedVideoReadiness";
import type { HomeFeedVideoWarmMode } from "@/src/lib/homeFeedVideoWindow";
import { isValidVideoPosterUri } from "./homeFeedUtils";
import { VideoPostFallbackPoster } from "./VideoPostFallbackPoster";

const CROSSFADE_MS = 220;

type Props = {
  postId?: string;
  title?: string;
  mediaStatus?: string;
  uri: string;
  posterUri?: string;
  warmMode: HomeFeedVideoWarmMode;
  screenFocused: boolean;
};

function statusLower(status: string) {
  return String(status || "").trim().toLowerCase();
}

/** Requires decoded pixels — readyToPlay alone is not enough for visual handoff. */
function hasStableVisualFrame(status: string, currentTime: number, playing: boolean) {
  const lower = statusLower(status);
  if (currentTime >= 0.05) return true;
  if (playing && currentTime >= 0.03) return true;
  if (lower === "playing" && currentTime >= 0.03) return true;
  return false;
}

function isPlayerBuffering(status: string) {
  const lower = statusLower(status);
  return lower === "loading" || lower === "loaded";
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

  const [layoutReady, setLayoutReady] = useState(false);
  const [visualFrameConfirmed, setVisualFrameConfirmed] = useState(false);
  const [playbackReady, setPlaybackReady] = useState(false);
  const [visualRevealed, setVisualRevealed] = useState(false);

  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const videoOpacity = useRef(new Animated.Value(0)).current;

  const mountedUriRef = useRef(uri);
  const preloadPrimedRef = useRef(false);
  const preloadStartLoggedRef = useRef(false);
  const reusedWarmLoggedRef = useRef(false);
  const readyMarkedRef = useRef(cachedReadyOnMount);
  const mountMsRef = useRef(Date.now());
  const readyMsRef = useRef<number | null>(cachedReadyOnMount ? 0 : null);
  const playbackReadyMsRef = useRef<number | null>(cachedReadyOnMount ? 0 : null);
  const timingLoggedRef = useRef(false);
  const visualReadyLoggedRef = useRef(false);
  const crossfadeStartedRef = useRef(false);

  const resetVisualLayer = useCallback(() => {
    crossfadeStartedRef.current = false;
    visualReadyLoggedRef.current = false;
    overlayOpacity.setValue(1);
    videoOpacity.setValue(0);
    setLayoutReady(false);
    setVisualFrameConfirmed(false);
    setPlaybackReady(false);
    setVisualRevealed(false);
  }, [overlayOpacity, videoOpacity]);

  const logStartupTiming = (mode: HomeFeedVideoWarmMode) => {
    if (timingLoggedRef.current) return;
    timingLoggedRef.current = true;
    console.log("KRISTO_VIDEO_STARTUP_TIMING", {
      id: postId || null,
      warmMode: mode,
      msToReady: readyMsRef.current,
      msToFirstFrame: playbackReadyMsRef.current,
      reusedReady: cachedReadyRef.current,
    });
  };

  const activateActivePlayback = (reason: string) => {
    try {
      player.muted = false;
      player.play();
    } catch {}
    pauseAllHomeFeedVideos({ exceptPostId: postId, reason });
    activateHomeFeedVideo(postId, {
      postId,
      shouldPlay: true,
      videoReady: true,
      reason,
    });
    markHomeFeedFirstPlaying("simple-feed-video");
    markHomeFirstVideoReady("simple-feed-video");
  };

  const markPlaybackReady = () => {
    if (!playbackReady) {
      if (playbackReadyMsRef.current === null) {
        playbackReadyMsRef.current = Date.now() - mountMsRef.current;
      }
      setPlaybackReady(true);
    }
  };

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setLayoutReady(true);
    }
  }, []);

  useLayoutEffect(() => {
    mountMsRef.current = Date.now();
    timingLoggedRef.current = false;
    readyMsRef.current = cachedReadyRef.current ? 0 : null;
    playbackReadyMsRef.current = null;

    if (!screenFocused) return;

    try {
      player.muted = true;
      player.play();
    } catch {}
  }, [player, screenFocused, uri, postId]);

  useEffect(() => {
    if (!cachedReadyRef.current || reusedWarmLoggedRef.current) return;
    reusedWarmLoggedRef.current = true;
    console.log("KRISTO_VIDEO_REUSED_WARM_PLAYER", { id: postId || null });
  }, [postId]);

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
    registerHomeFeedVideo(postId, player, {
      postId,
      shouldPlay: isActive,
      videoReady: playbackReady,
      reason: `warm-${warmMode}`,
    });
  }, [player, postId, warmMode, isActive, playbackReady]);

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
      playbackReadyMsRef.current = null;
      resetVisualLayer();

      try {
        player.muted = true;
        player.play();
      } catch {}
    }
  }, [uri, postId, player, resetVisualLayer]);

  useEffect(() => {
    if (!shouldPrime || preloadStartLoggedRef.current) return;
    preloadStartLoggedRef.current = true;
    console.log("KRISTO_VIDEO_PRELOAD_START", { id: postId || null, videoUrl: uri });
  }, [shouldPrime, postId, uri]);

  useEffect(() => {
    if (!screenFocused) {
      try {
        player.pause();
        player.muted = true;
      } catch {}
      return;
    }

    if (isActive) {
      if (playbackReady) {
        activateActivePlayback("simple-feed-video-active-handoff");
        logStartupTiming(warmMode);
        return;
      }

      try {
        player.play();
      } catch {}
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
  }, [player, isActive, shouldPrime, screenFocused, uri, warmMode, playbackReady]);

  useEffect(() => {
    if (!screenFocused) return;

    const lower = statusLower(status);

    if (
      (hasStableVisualFrame(status, currentTime, playing) || isPlayerBuffering(status)) &&
      readyMsRef.current === null
    ) {
      readyMsRef.current = Date.now() - mountMsRef.current;
    }

    if (isActive && (hasStableVisualFrame(status, currentTime, playing) || isPlayerBuffering(status))) {
      try {
        player.play();
      } catch {}
    }

    if (shouldPrime && hasStableVisualFrame(status, currentTime, playing)) {
      try {
        player.pause();
        player.muted = true;
      } catch {}
    }

    if (hasStableVisualFrame(status, currentTime, playing)) {
      if (!visualFrameConfirmed) {
        setVisualFrameConfirmed(true);
      }

      if (!readyMarkedRef.current) {
        readyMarkedRef.current = true;
        markHomeFeedVideoPreloadReady(postId, uri);
        cachedReadyRef.current = true;
        if (shouldPrime) {
          console.log("KRISTO_VIDEO_PRELOAD_READY", { id: postId || null });
        }
      } else if (isWarm || isPreload) {
        touchHomeFeedVideoReadiness(postId, uri);
      }

      if (isActive) {
        markPlaybackReady();
        activateActivePlayback("simple-feed-video-active");
        logStartupTiming(warmMode);
      } else {
        markPlaybackReady();
        try {
          player.pause();
          player.muted = true;
        } catch {}
      }
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
    visualFrameConfirmed,
  ]);

  useEffect(() => {
    if (isActive || !screenFocused) return;
    pauseHomeFeedVideo(postId, { postId, reason: `warm-${warmMode}` });
  }, [isActive, warmMode, screenFocused, postId]);

  useEffect(() => {
    if (isActive) return;
    overlayOpacity.setValue(1);
    videoOpacity.setValue(0);
  }, [isActive, overlayOpacity, videoOpacity]);

  useEffect(() => {
    if (!isActive || !layoutReady || !visualFrameConfirmed) return;

    if (visualRevealed) {
      videoOpacity.setValue(1);
      overlayOpacity.setValue(0);
      return;
    }

    if (crossfadeStartedRef.current) return;
    crossfadeStartedRef.current = true;

    if (!visualReadyLoggedRef.current) {
      visualReadyLoggedRef.current = true;
      console.log("KRISTO_VIDEO_FIRST_FRAME_VISUAL_READY", {
        id: postId || null,
        ms: Date.now() - mountMsRef.current,
      });
    }

    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(videoOpacity, {
        toValue: 1,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setVisualRevealed(true);
      }
    });
  }, [
    isActive,
    layoutReady,
    visualFrameConfirmed,
    visualRevealed,
    overlayOpacity,
    videoOpacity,
    postId,
  ]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, uri);

  return (
    <View style={styles.root} onLayout={handleLayout}>
      <Animated.View
        style={[styles.videoLayer, { opacity: isActive ? videoOpacity : 0 }]}
        pointerEvents="none"
      >
        <VideoView
          player={player}
          style={styles.videoSurface}
          contentFit="cover"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      </Animated.View>

      <Animated.View
        style={[styles.overlayLayer, { opacity: overlayOpacity }]}
        pointerEvents="none"
      >
        {hasPoster ? (
          <Image source={{ uri: poster }} style={styles.overlayFill} resizeMode="cover" />
        ) : (
          <VideoPostFallbackPoster
            postId={postId}
            title={title}
            videoUrl={uri}
            mediaStatus={mediaStatus}
          />
        )}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#03050C",
  },
  videoLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  videoSurface: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  overlayLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: "#03050C",
  },
  overlayFill: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
});
