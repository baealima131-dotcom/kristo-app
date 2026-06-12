import React, { useEffect } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import { resolveHomeFeedPlaybackUri } from "@/src/lib/homeFeedVideoDiskCache";

type Props = {
  visible: boolean;
  payload: HomeFeedVideoOpenPayload | null;
  onClose: () => void;
};

function ModalVideoPlayer({ uri }: { uri: string }) {
  const playbackUri = resolveHomeFeedPlaybackUri(uri) || uri;
  const player = useVideoPlayer(playbackUri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    if (!playbackUri) return;
    try {
      player.play();
    } catch {}
    return () => {
      try {
        player.pause();
      } catch {}
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

export function HomeFeedVideoModal({ visible, payload, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  if (!payload) return null;

  const title = String(payload.title || "").trim();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          onPress={onClose}
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          hitSlop={12}
          accessibilityLabel="Close video"
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>

        <View
          style={[
            styles.content,
            { maxHeight: height - insets.top - insets.bottom - 96 },
          ]}
        >
          <ModalVideoPlayer uri={payload.videoUri} />
        </View>

        {title ? (
          <Text style={[styles.title, { paddingBottom: insets.bottom + 16 }]} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    justifyContent: "center",
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  content: {
    width: "100%",
    aspectRatio: 9 / 16,
    maxHeight: "72%",
    alignSelf: "center",
    backgroundColor: "#000",
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  title: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    paddingHorizontal: 20,
    paddingTop: 12,
    textAlign: "center",
  },
});
