import React, { memo, useEffect, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { markHomeFeedFirstPlaying, markHomeFirstVideoReady } from "@/src/lib/firstPaint";
import { isValidVideoPosterUri } from "./homeFeedUtils";
import { VideoPostFallbackPoster } from "./VideoPostFallbackPoster";

type Props = {
  postId?: string;
  title?: string;
  mediaStatus?: string;
  uri: string;
  posterUri?: string;
  shouldPlay: boolean;
  preloadOnly?: boolean;
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
 * Active row: plays with poster until first frame.
 * Next row (preloadOnly): one muted paused player behind poster for faster handoff.
 */
export const SimpleFeedVideo = memo(function SimpleFeedVideo({
  postId = "",
  title = "",
  mediaStatus = "",
  uri,
  posterUri = "",
  shouldPlay,
  preloadOnly = false,
  screenFocused,
}: Props) {
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

  useEffect(() => {
    if (mountedUriRef.current !== uri) {
      mountedUriRef.current = uri;
      setFirstFrameReady(false);
      preloadPrimedRef.current = false;
    }
  }, [uri]);

  useEffect(() => {
    player.muted = true;

    if (!screenFocused) {
      try {
        player.pause();
      } catch {}
      if (!preloadOnly) {
        setFirstFrameReady(false);
      }
      return;
    }

    if (preloadOnly) {
      setFirstFrameReady(false);
      if (!preloadPrimedRef.current) {
        preloadPrimedRef.current = true;
        try {
          player.play();
        } catch {}
      }
      return;
    }

    preloadPrimedRef.current = false;

    if (!shouldPlay) {
      try {
        player.pause();
      } catch {}
      setFirstFrameReady(false);
      return;
    }

    try {
      player.play();
    } catch {}
  }, [player, shouldPlay, preloadOnly, screenFocused, uri]);

  useEffect(() => {
    if (!screenFocused) return;

    if (preloadOnly) {
      const statusLower = String(status || "").trim().toLowerCase();
      if (statusLower === "readytoplay" || currentTime > 0) {
        try {
          player.pause();
        } catch {}
        player.muted = true;
      }
      return;
    }

    if (!shouldPlay) return;

    if (hasPlaybackFrame(status, currentTime, playing)) {
      setFirstFrameReady(true);
      player.muted = false;
      markHomeFeedFirstPlaying("simple-feed-video");
      markHomeFirstVideoReady("simple-feed-video");
    }
  }, [shouldPlay, preloadOnly, screenFocused, status, currentTime, playing, player]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, uri);
  const showPosterImage =
    hasPoster && (preloadOnly || !shouldPlay || !firstFrameReady);
  const showFallbackPoster = !hasPoster;
  const showVideoSurface = screenFocused && (preloadOnly || (shouldPlay && firstFrameReady));

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
          { opacity: showVideoSurface && !preloadOnly ? 1 : 0 },
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
