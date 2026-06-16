import React, { memo, useCallback, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { formatActionCount } from "./homeFeedUtils";
import { HOME_FEED_GOLD_SOFT } from "./theme";

const ICON_SIZE = 28;
const BTN_SIZE = 56;

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
    likeScale.setValue(0.88);
    Animated.spring(likeScale, {
      toValue: 1,
      friction: 4,
      tension: 180,
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
    <View pointerEvents="box-none" style={[styles.rail, { bottom: bottomOffset }]}>
      <ActionButton
        label={formatActionCount(likeCount)}
        variant="count"
        onPress={handleLike}
        active={liked}
      >
        <BlurView intensity={42} tint="dark" style={[styles.iconWrap, liked ? styles.iconWrapLiked : null]}>
          <Animated.View style={{ transform: [{ scale: likeScale }] }}>
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={ICON_SIZE}
              color={liked ? "#FF5A7A" : "#FFFFFF"}
            />
          </Animated.View>
        </BlurView>
      </ActionButton>

      <ActionButton label={formatActionCount(commentCount)} variant="count" onPress={onComment}>
        <BlurView intensity={42} tint="dark" style={styles.iconWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={ICON_SIZE} color="#FFFFFF" />
        </BlurView>
      </ActionButton>

      <ActionButton label={formatActionCount(shareCount)} variant="count" onPress={onShare}>
        <BlurView intensity={42} tint="dark" style={styles.iconWrap}>
          <Ionicons name="arrow-redo-outline" size={ICON_SIZE} color="#FFFFFF" />
        </BlurView>
      </ActionButton>

      <ActionButton
        label={saveLabel}
        variant={saveCount > 0 ? "count" : "text"}
        onPress={onSave}
        active={saved}
        labelActive={saved}
      >
        <View style={[styles.iconWrapPlain, saved ? styles.iconWrapSaved : null]}>
          <Ionicons
            name={saved ? "bookmark" : "bookmark-outline"}
            size={ICON_SIZE - 2}
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
        <View style={[styles.iconWrapPlain, reported ? styles.iconWrapReported : null]}>
          <Ionicons
            name={reported ? "flag" : "flag-outline"}
            size={ICON_SIZE - 4}
            color={reported ? HOME_FEED_GOLD_SOFT : "rgba(255,255,255,0.92)"}
          />
        </View>
      </ActionButton>
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

  return (
    <Pressable hitSlop={14} style={styles.btn} onPress={onPress}>
      {children}
      {isCount ? (
        <View style={styles.countPill}>
          <Text
            style={[
              styles.countLabel,
              active || labelActive ? styles.labelActive : null,
            ]}
          >
            {label}
          </Text>
        </View>
      ) : (
        <Text
          style={[
            styles.textLabel,
            active || labelActive ? styles.labelActive : null,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: "absolute",
    right: 8,
    alignItems: "center",
    gap: 20,
    zIndex: 20,
  },
  btn: {
    alignItems: "center",
    gap: 6,
    minWidth: BTN_SIZE,
  },
  iconWrap: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  iconWrapLiked: {
    borderColor: "rgba(255,90,122,0.4)",
  },
  iconWrapPlain: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  iconWrapSaved: {
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  iconWrapReported: {
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  countPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.42)",
    minWidth: 32,
    alignItems: "center",
  },
  countLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.35,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  textLabel: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.25,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  labelActive: {
    color: HOME_FEED_GOLD_SOFT,
  },
});
