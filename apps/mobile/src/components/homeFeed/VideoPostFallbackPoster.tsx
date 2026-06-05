import React, { memo, useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

const GOLD = "#F4D06F";

type Props = {
  postId?: string;
  title?: string;
  videoUrl?: string;
  mediaStatus?: string;
  variant?: "full" | "minimal";
};

export const VideoPostFallbackPoster = memo(function VideoPostFallbackPoster({
  postId = "",
  title = "",
  videoUrl = "",
  mediaStatus = "",
  variant = "full",
}: Props) {
  const status = String(mediaStatus || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "uploading";
  const displayTitle = String(title || "").trim();

  useEffect(() => {
    if (variant !== "full") return;
    console.log("KRISTO_VIDEO_POST_BLACK_FALLBACK_USED", {
      id: postId || null,
      videoUrl: videoUrl || null,
      mediaStatus: status || null,
    });
  }, [postId, videoUrl, status, variant]);

  if (variant === "minimal") {
    return (
      <View style={styles.minimalRoot} pointerEvents="none">
        <View style={styles.minimalPill}>
          <ActivityIndicator size="small" color={GOLD} />
          <Text style={styles.minimalText}>
            {isProcessing ? "Processing video…" : "Loading video…"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#4A3D24", "#243B55", "#1B2A44"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.content}>
        <View style={styles.playBadge}>
          <Ionicons name="play" size={28} color="#1B2A44" />
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
    shadowOpacity: 0.25,
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
    backgroundColor: "rgba(27,42,68,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  processingText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "600",
  },
  minimalRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 148,
  },
  minimalPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(27,42,68,0.72)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.35)",
  },
  minimalText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "600",
  },
});
