import React, { memo, useEffect, useRef, useState } from "react";
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

function hasPlaybackFrame(status: string, currentTime: number, playing: boolean) {
  const statusLower = String(status || "").trim().toLowerCase();
  return (
    currentTime > 0.03 ||
    playing ||
    statusLower === "playing" ||
    statusLower === "readytoplay"
  );
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
  const cachedReadyRef = useRef(isHomeFeedVideoPreloadReady(postId, uri));
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });
  const currentTime = Number((player as any)?.currentTime || 0);
  const playing = Boolean((player as any)?.playing);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const mountedUriRef = useRef(uri);
  const preloadPrimedRef = useRef(false);
  const preloadStartLoggedRef = useRef(false);
  const reusedWarmLoggedRef = useRef(false);
  const readyMarkedRef = useRef(false);

  const isActive = warmMode === "active";
  const isPreload = warmMode === "preload";
  const isWarm = warmMode === "warm";
  const shouldPrime = isPreload || isWarm;

  useEffect(() => {
    if (!cachedReadyRef.current || reusedWarmLoggedRef.current) return;
    reusedWarmLoggedRef.current = true;
    console.log("KRISTO_VIDEO_REUSED_WARM_PLAYER", { id: postId || null });
  }, [postId]);

  useEffect(() => {
    registerHomeFeedVideo(postId, player, {
      postId,
      shouldPlay: isActive,
      videoReady: firstFrameReady,
      reason: `warm-${warmMode}`,
    });
    return () => {
      try {
        player.pause();
        player.muted = true;
      } catch {}
      unregisterHomeFeedVideo(postId, { postId, reason: "simple-feed-video-unmount" });
    };
  }, [player, postId, warmMode, isActive, firstFrameReady]);

  useEffect(() => {
    if (mountedUriRef.current !== uri) {
      mountedUriRef.current = uri;
      preloadPrimedRef.current = false;
      preloadStartLoggedRef.current = false;
      readyMarkedRef.current = false;
      cachedReadyRef.current = isHomeFeedVideoPreloadReady(postId, uri);
      reusedWarmLoggedRef.current = false;
      setFirstFrameReady(false);
    }
  }, [uri, postId]);

  useEffect(() => {
    if (!shouldPrime || preloadStartLoggedRef.current) return;
    preloadStartLoggedRef.current = true;
    console.log("KRISTO_VIDEO_PRELOAD_START", { id: postId || null, videoUrl: uri });
  }, [shouldPrime, postId, uri]);

  useEffect(() => {
    player.muted = true;

    if (!screenFocused) {
      try {
        player.pause();
      } catch {}
      return;
    }

    if (isActive) {
      preloadPrimedRef.current = false;
      try {
        player.play();
      } catch {}
      return;
    }

    if (shouldPrime) {
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
    } catch {}
  }, [player, isActive, shouldPrime, screenFocused, uri]);

  useEffect(() => {
    if (!screenFocused) return;

    if (shouldPrime) {
      const statusLower = String(status || "").trim().toLowerCase();
      if (statusLower === "readytoplay" || currentTime > 0) {
        try {
          player.pause();
        } catch {}
        player.muted = true;
      }
    }

    if (!hasPlaybackFrame(status, currentTime, playing)) return;

    if (!readyMarkedRef.current) {
      readyMarkedRef.current = true;
      markHomeFeedVideoPreloadReady(postId, uri);
      if (shouldPrime) {
        console.log("KRISTO_VIDEO_PRELOAD_READY", { id: postId || null });
      }
    } else if (isWarm || isPreload) {
      touchHomeFeedVideoReadiness(postId, uri);
    }

    if (isActive) {
      setFirstFrameReady(true);
      player.muted = false;
      pauseAllHomeFeedVideos({ exceptPostId: postId, reason: "simple-feed-video-active" });
      activateHomeFeedVideo(postId, {
        postId,
        shouldPlay: true,
        videoReady: true,
        reason: "simple-feed-video-active",
      });
      markHomeFeedFirstPlaying("simple-feed-video");
      markHomeFirstVideoReady("simple-feed-video");
      return;
    }

    if (!firstFrameReady) {
      setFirstFrameReady(true);
    }

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
    firstFrameReady,
  ]);

  useEffect(() => {
    if (isActive || !screenFocused) return;
    pauseHomeFeedVideo(postId, { postId, reason: `warm-${warmMode}` });
  }, [isActive, warmMode, screenFocused, postId]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, uri);
  const showPosterOverlay = !isActive || !firstFrameReady;
  const showPosterImage = hasPoster && showPosterOverlay;
  const showFallbackPoster = !hasPoster && showPosterOverlay;

  return (
    <View style={StyleSheet.absoluteFillObject}>
      {showFallbackPoster ? (
        <VideoPostFallbackPoster
          postId={postId}
          title={title}
          videoUrl={uri}
          mediaStatus={mediaStatus}
        />
      ) : null}
      {showPosterImage ? (
        <Image
          source={{ uri: poster }}
          style={[StyleSheet.absoluteFillObject, styles.posterLayer]}
          resizeMode="cover"
        />
      ) : null}
      <VideoView
        player={player}
        style={[
          StyleSheet.absoluteFillObject,
          { opacity: isActive && firstFrameReady ? 1 : 0 },
        ]}
        contentFit="cover"
        nativeControls={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  posterLayer: {
    zIndex: 2,
  },
});
