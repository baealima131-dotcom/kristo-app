import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatActionCount } from "./homeFeedUtils";
import { HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saved: boolean;
  reported: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
};

export const PostActionsInline = memo(function PostActionsInline({
  liked,
  likeCount,
  commentCount,
  shareCount,
  saved,
  reported,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: Props) {
  return (
    <View style={styles.row}>
      <InlineAction
        icon={liked ? "heart" : "heart-outline"}
        label={formatActionCount(likeCount)}
        active={liked}
        activeColor="#FF5A7A"
        onPress={onLike}
      />
      <InlineAction
        icon="chatbubble-ellipses-outline"
        label={formatActionCount(commentCount)}
        onPress={onComment}
      />
      <InlineAction
        icon="arrow-redo-outline"
        label={formatActionCount(shareCount)}
        onPress={onShare}
      />
      <InlineAction
        icon={saved ? "bookmark" : "bookmark-outline"}
        label={saved ? "Saved" : "Save"}
        active={saved}
        onPress={onSave}
      />
      <InlineAction
        icon={reported ? "flag" : "flag-outline"}
        label={reported ? "Reported" : "Report"}
        active={reported}
        onPress={onReport}
      />
    </View>
  );
});

function InlineAction({
  icon,
  label,
  onPress,
  active,
  activeColor = HOME_FEED_GOLD_SOFT,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <Pressable style={styles.action} onPress={onPress} hitSlop={8}>
      <Ionicons name={icon} size={22} color={active ? activeColor : "#FFFFFF"} />
      <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  action: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  label: {
    color: HOME_FEED_MUTED,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  labelActive: {
    color: HOME_FEED_GOLD_SOFT,
  },
});
