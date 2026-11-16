import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatActionCount } from "./homeFeedUtils";
import { homeFeedPremiumStyles as premium } from "./homeFeedPremiumStyles";
import { HOME_FEED_GOLD_SOFT, HOME_FEED_INACTIVE } from "./theme";

type Props = {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  /** Text shown instead of the like/comment number (e.g. when YouTube hides that count). */
  likeLabel?: string;
  commentLabel?: string;
  /** Video links: the Share button shows its icon only, with no number. */
  hideShareCount?: boolean;
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
  likeLabel,
  commentLabel,
  hideShareCount = false,
  saved,
  reported,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: Props) {
  return (
    <View style={premium.actionsBar}>
      <View style={premium.inlineActionRow}>
        <InlineAction
          icon={liked ? "heart" : "heart-outline"}
          label={likeLabel ?? formatActionCount(likeCount)}
          countLabel
          active={liked}
          activeColor="#FF6B8A"
          onPress={onLike}
        />
        <InlineAction
          icon="chatbubble-ellipses-outline"
          label={commentLabel ?? formatActionCount(commentCount)}
          countLabel
          onPress={onComment}
        />
        <InlineAction
          icon="arrow-redo-outline"
          label={hideShareCount ? "" : formatActionCount(shareCount)}
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
    </View>
  );
});

function InlineAction({
  icon,
  label,
  onPress,
  active,
  activeColor = HOME_FEED_GOLD_SOFT,
  countLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  /** Like and comment numbers: larger digits in the same line height. */
  countLabel?: boolean;
}) {
  return (
    <Pressable style={premium.inlineAction} onPress={onPress} hitSlop={8}>
      <Ionicons
        name={icon}
        size={21}
        color={active ? activeColor : "rgba(255,255,255,0.72)"}
      />
      <Text
        style={[
          premium.inlineLabel,
          countLabel ? premium.inlineCountLabel : null,
          active ? premium.inlineLabelActive : null,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
