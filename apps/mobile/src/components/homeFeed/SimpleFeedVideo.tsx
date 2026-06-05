import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
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
    }
    setFirstFrameReady((prev) => (prev ? prev : true));
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

  useLayoutEffect(() => {
    mountMsRef.current = Date.now();
    timingLoggedRef.current = false;
    readyMsRef.current = cachedReadyRef.current ? 0 : null;
    firstFrameMsRef.current = cachedReadyRef.current && warmModeRef.current === "active" ? 0 : null;

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

      try {
        player.muted = true;
        player.play();
      } catch {}
    }
  }, [uri, postId, player]);

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
      if (firstFrameReady) {
        activateActivePlayback("simple-feed-video-active-handoff");
        logStartupTiming(warmMode);
        return;
      }

      if (cachedReadyRef.current) {
        markFirstFrame(true);
        activateActivePlayback("simple-feed-video-cached-handoff");
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
  }, [player, isActive, shouldPrime, screenFocused, uri, warmMode, firstFrameReady]);

  useEffect(() => {
    if (!screenFocused) return;

    const lower = statusLower(status);

    if (isPlayerReadyToStart(status, currentTime, playing) && readyMsRef.current === null) {
      readyMsRef.current = Date.now() - mountMsRef.current;
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
        console.log("KRISTO_VIDEO_PRELOAD_READY", { id: postId || null });
      }
    } else if (isWarm || isPreload) {
      touchHomeFeedVideoReadiness(postId, uri);
    }

    if (isActive) {
      markFirstFrame(false);
      activateActivePlayback("simple-feed-video-active");
      logStartupTiming(warmMode);
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
  const showPosterOverlay = hasPoster && !firstFrameReady;
  const showMinimalActiveHint = !hasPoster && isActive && !firstFrameReady;

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        style={styles.videoSurface}
        contentFit="cover"
        nativeControls={false}
      />
      {showPosterOverlay ? (
        <View style={styles.overlay} pointerEvents="none">
          <Image source={{ uri: poster }} style={styles.overlayFill} resizeMode="cover" />
        </View>
      ) : null}
      {showMinimalActiveHint ? (
        <View style={styles.overlay} pointerEvents="none">
          <VideoPostFallbackPoster
            variant="minimal"
            postId={postId}
            title={title}
            videoUrl={uri}
            mediaStatus={mediaStatus}
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
