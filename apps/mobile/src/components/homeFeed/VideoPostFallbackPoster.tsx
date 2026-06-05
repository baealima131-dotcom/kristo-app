import React, { memo, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

const GOLD = "#F4D06F";

type Props = {
  postId?: string;
  title?: string;
  videoUrl?: string;
  mediaStatus?: string;
};

export const VideoPostFallbackPoster = memo(function VideoPostFallbackPoster({
  postId = "",
  title = "",
  videoUrl = "",
  mediaStatus = "",
}: Props) {
  const status = String(mediaStatus || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "uploading";
  const displayTitle = String(title || "").trim();

  useEffect(() => {
    console.log("KRISTO_VIDEO_POST_BLACK_FALLBACK_USED", {
      id: postId || null,
      videoUrl: videoUrl || null,
      mediaStatus: status || null,
    });
  }, [postId, videoUrl, status]);

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#2A220F", "#0B0F17", "#03050C"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.content}>
        <View style={styles.playBadge}>
          <Ionicons name="play" size={28} color="#03050C" />
        </View>
        {displayTitle ? (
          <Text style={styles.title} numberOfLines={3}>
            {displayTitle}
          </Text>
        ) : null}
      </View>
      {isProcessing ? (
        <View style={styles.processingOverlay} pointerEvents="none">
          <Text style={styles.processingText}>Processing video…</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  content: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 14,
  },
  playBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,5,12,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  processingText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "600",
  },
});
