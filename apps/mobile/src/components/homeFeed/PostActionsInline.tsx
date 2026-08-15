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
  viewCount: number;
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
  viewCount,
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
          label={formatActionCount(likeCount)}
          active={liked}
          activeColor="#FF6B8A"
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
        <View style={premium.inlineViewReportStack}>
          <View
            pointerEvents="none"
            style={premium.inlineViewStat}
          >
            <Ionicons
              name="eye-outline"
              size={16}
              color={HOME_FEED_GOLD_SOFT}
            />
            <Text style={premium.inlineViewCount}>
              {formatActionCount(viewCount)}
            </Text>
          </View>

          <Pressable
            style={premium.inlineReportAction}
            onPress={onReport}
            hitSlop={8}
          >
            <Ionicons
              name={reported ? "flag" : "flag-outline"}
              size={19}
              color={
                reported
                  ? HOME_FEED_GOLD_SOFT
                  : "rgba(255,255,255,0.72)"
              }
            />
            <Text
              style={[
                premium.inlineLabel,
                reported ? premium.inlineLabelActive : null,
              ]}
              numberOfLines={1}
            >
              {reported ? "Reported" : "Report"}
            </Text>
          </Pressable>
        </View>
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <Pressable style={premium.inlineAction} onPress={onPress} hitSlop={8}>
      <Ionicons
        name={icon}
        size={21}
        color={active ? activeColor : "rgba(255,255,255,0.72)"}
      />
      <Text
        style={[premium.inlineLabel, active ? premium.inlineLabelActive : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
