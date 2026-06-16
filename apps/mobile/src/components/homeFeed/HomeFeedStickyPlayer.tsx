import React, { memo, useEffect } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  safePauseVideoPlayer,
  safePlayVideoPlayer,
} from "@/src/lib/expoVideoPlayerSafe";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import { resolveHomeFeedPlaybackUri } from "@/src/lib/homeFeedVideoDiskCache";
import { YOUTUBE_THUMB_ASPECT } from "@/src/lib/homeFeedYouTubeLayout";

type Props = {
  payload: HomeFeedVideoOpenPayload | null;
  onClose: () => void;
};

function StickyVideoSurface({ uri }: { uri: string }) {
  const playbackUri = resolveHomeFeedPlaybackUri(uri) || uri;
  const player = useVideoPlayer(playbackUri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    if (!playbackUri) return;
    safePlayVideoPlayer(player, { source: "home-feed-sticky-player", uri: playbackUri });
    return () => {
      safePauseVideoPlayer(player, { source: "home-feed-sticky-player", uri: playbackUri });
    };
  }, [player, playbackUri]);

  if (!playbackUri) return null;

  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls
    />
  );
}

/** Sticky top player — keeps playing while the feed scrolls underneath. */
export function HomeFeedStickyPlayer({ payload, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  if (!payload) return null;

  const playerHeight = Math.round(width / YOUTUBE_THUMB_ASPECT);
  const title = String(payload.title || "").trim();

  return (
    <View style={[styles.shell, { paddingTop: insets.top }]}>
      <View style={[styles.playerWrap, { height: playerHeight }]}>
        <StickyVideoSurface key={payload.postId} uri={payload.videoUri} />
        <Pressable
          onPress={onClose}
          style={styles.closeBtn}
          hitSlop={10}
          accessibilityLabel="Close video"
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      {title ? (
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: "#000000",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
    zIndex: 30,
  },
  playerWrap: {
    width: "100%",
    backgroundColor: "#000000",
    position: "relative",
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  closeBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  title: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#03050C",
  },
});
