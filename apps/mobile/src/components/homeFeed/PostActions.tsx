import React, { memo, useCallback, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatActionCount } from "./homeFeedUtils";
import { homeFeedPremiumStyles as premium } from "./homeFeedPremiumStyles";
import { HOME_FEED_GOLD_SOFT } from "./theme";

const ICON_SIZE = 26;

type Props = {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount?: number;
  saved: boolean;
  reported: boolean;
  bottomOffset: number;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
};

export const PostActions = memo(function PostActions({
  liked,
  likeCount,
  commentCount,
  shareCount,
  saveCount = 0,
  saved,
  reported,
  bottomOffset,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: Props) {
  const likeScale = useRef(new Animated.Value(1)).current;

  const pulseLike = useCallback(() => {
    likeScale.setValue(0.9);
    Animated.spring(likeScale, {
      toValue: 1,
      friction: 5,
      tension: 200,
      useNativeDriver: true,
    }).start();
  }, [likeScale]);

  const handleLike = useCallback(() => {
    pulseLike();
    onLike();
  }, [onLike, pulseLike]);

  const saveLabel =
    saveCount > 0 ? formatActionCount(saveCount) : saved ? "Saved" : "Save";

  return (
    <View pointerEvents="box-none" style={[premium.verticalActionRail, { bottom: bottomOffset }]}>
      <View style={premium.verticalActionGlass}>
        <ActionButton
          label={formatActionCount(likeCount)}
          variant="count"
          onPress={handleLike}
          active={liked}
        >
          <Animated.View
            style={[
              premium.verticalIconWrap,
              liked ? premium.verticalIconWrapLiked : null,
              { transform: [{ scale: likeScale }] },
            ]}
          >
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={ICON_SIZE}
              color={liked ? "#FF6B8A" : "#FFFFFF"}
            />
          </Animated.View>
        </ActionButton>

        <ActionButton label={formatActionCount(commentCount)} variant="count" onPress={onComment}>
          <View style={premium.verticalIconWrap}>
            <Ionicons name="chatbubble-ellipses-outline" size={ICON_SIZE} color="#FFFFFF" />
          </View>
        </ActionButton>

        <ActionButton label={formatActionCount(shareCount)} variant="count" onPress={onShare}>
          <View style={premium.verticalIconWrap}>
            <Ionicons name="arrow-redo-outline" size={ICON_SIZE} color="#FFFFFF" />
          </View>
        </ActionButton>

        <ActionButton
          label={saveLabel}
          variant={saveCount > 0 ? "count" : "text"}
          onPress={onSave}
          active={saved}
          labelActive={saved}
        >
          <View style={[premium.verticalIconWrap, saved ? premium.verticalIconWrapActive : null]}>
            <Ionicons
              name={saved ? "bookmark" : "bookmark-outline"}
              size={ICON_SIZE - 1}
              color={saved ? HOME_FEED_GOLD_SOFT : "#FFFFFF"}
            />
          </View>
        </ActionButton>

        <ActionButton
          label={reported ? "Reported" : "Report"}
          variant="text"
          onPress={onReport}
          labelActive={reported}
        >
          <View style={[premium.verticalIconWrap, reported ? premium.verticalIconWrapActive : null]}>
            <Ionicons
              name={reported ? "flag" : "flag-outline"}
              size={ICON_SIZE - 2}
              color={reported ? HOME_FEED_GOLD_SOFT : "rgba(255,255,255,0.88)"}
            />
          </View>
        </ActionButton>
      </View>
    </View>
  );
});

function ActionButton({
  children,
  label,
  variant = "text",
  onPress,
  active,
  labelActive,
}: {
  children: React.ReactNode;
  label: string;
  variant?: "count" | "text";
  onPress: () => void;
  active?: boolean;
  labelActive?: boolean;
}) {
  const isCount = variant === "count";
  const labelStyle = [
    isCount ? premium.verticalCountLabel : premium.verticalTextLabel,
    active || labelActive ? premium.verticalLabelActive : null,
  ];

  return (
    <Pressable hitSlop={12} style={premium.verticalActionBtn} onPress={onPress}>
      {children}
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
}
