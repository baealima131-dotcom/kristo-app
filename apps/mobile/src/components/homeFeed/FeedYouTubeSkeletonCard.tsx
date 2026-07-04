import React, { memo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { homeFeedVideoThumbnailHeight } from "@/src/lib/homeFeedYouTubeLayout";
import { HOME_FEED_THUMB_RADIUS } from "./theme";

export const FeedYouTubeSkeletonCard = memo(function FeedYouTubeSkeletonCard() {
  const { width: windowWidth } = useWindowDimensions();
  const thumbHeight = homeFeedVideoThumbnailHeight(windowWidth, "youtube");

  return (
    <View style={styles.card}>
      <View style={[styles.thumb, { height: thumbHeight }]}>
        <LinearGradient
          colors={["#1a1a1a", "#242424", "#1a1a1a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={styles.metaRow}>
        <View style={styles.avatar} />
        <View style={styles.textCol}>
          <View style={styles.titleLine} />
          <View style={styles.subLine} />
        </View>
      </View>
      <View style={styles.actionsPlaceholder} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginBottom: 22,
    marginHorizontal: 5,
    paddingHorizontal: 7,
  },
  thumb: {
    width: "100%",
    borderRadius: HOME_FEED_THUMB_RADIUS,
    backgroundColor: "#1a1a1a",
    overflow: "hidden",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 10,
    paddingHorizontal: 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2a2a",
  },
  textCol: {
    flex: 1,
    gap: 8,
    paddingTop: 4,
  },
  titleLine: {
    height: 14,
    width: "88%",
    borderRadius: 4,
    backgroundColor: "#2a2a2a",
  },
  subLine: {
    height: 12,
    width: "52%",
    borderRadius: 4,
    backgroundColor: "#222222",
  },
  actionsPlaceholder: {
    height: 36,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: "#222222",
    opacity: 0.35,
  },
});
