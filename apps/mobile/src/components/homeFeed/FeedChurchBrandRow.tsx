import React, { memo, useCallback, useMemo } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  homeFeedRowChurchId,
  resolveChurchName,
  resolveFeedChurchVerified,
  resolveHomeFeedDisplayAvatar,
} from "./homeFeedUtils";
import { HOME_FEED_GOLD } from "./theme";
import { openChurchProfileFromFeedItem } from "@/src/lib/churchProfileNavigation";
import { FeedChurchAvatar } from "./FeedChurchAvatar";

type Variant = "premium" | "watch";
type Part = "all" | "avatar" | "name";

type Props = {
  item: any;
  variant?: Variant;
  part?: Part;
  style?: StyleProp<ViewStyle>;
  source?: string;
  /** When false, only the avatar opens the profile (e.g. member-authored church room posts). */
  nameOpensProfile?: boolean;
};

export const FeedChurchBrandRow = memo(function FeedChurchBrandRow({
  item,
  variant = "premium",
  part = "all",
  style,
  source,
  nameOpensProfile = true,
}: Props) {
  const churchId = useMemo(() => homeFeedRowChurchId(item), [item]);
  const churchName = useMemo(() => resolveChurchName(item), [item]);
  const churchVerified = useMemo(() => resolveFeedChurchVerified(item), [item]);
  const { uri: avatarUri, backupUri, initial } = useMemo(
    () => resolveHomeFeedDisplayAvatar(item),
    [item]
  );
  const avatarSrc = String(avatarUri || backupUri || "").trim();
  const canOpen = Boolean(churchId);

  const openProfile = useCallback(() => {
    if (!canOpen) return;
    openChurchProfileFromFeedItem(item, { source });
  }, [canOpen, item, source]);

  const isWatch = variant === "watch";
  const postId = String(item?.id || "").trim();
  const avatarSize = isWatch ? 44 : 40;
  const avatarShellSize = isWatch ? avatarSize : avatarSize + 8;
  const avatarStyle = isWatch ? watchStyles.avatar : premiumStyles.avatar;
  const avatarFallbackStyle = isWatch ? watchStyles.avatarFallback : premiumStyles.avatarFallback;
  const avatarInitialStyle = isWatch ? watchStyles.avatarInitial : premiumStyles.avatarInitial;
  const churchNameStyle = isWatch ? watchStyles.churchName : premiumStyles.churchName;
  const verifiedSize = isWatch ? 15 : 14;

  const avatarNode = isWatch ? (
    avatarSrc ? (
      <Image source={{ uri: avatarSrc }} style={avatarStyle} />
    ) : (
      <View style={avatarFallbackStyle}>
        <Text style={avatarInitialStyle}>{initial || "K"}</Text>
      </View>
    )
  ) : (
    <FeedChurchAvatar
      postId={postId}
      size={avatarSize}
      shellSize={avatarShellSize}
      uri={avatarUri}
      backupUri={backupUri}
      initial={initial}
    />
  );

  const nameNode = churchName ? (
    <View style={styles.churchNameRow}>
      <Text style={churchNameStyle} numberOfLines={1}>
        {churchName}
      </Text>
      {churchVerified ? (
        <Ionicons
          name="checkmark-circle"
          size={verifiedSize}
          color={HOME_FEED_GOLD}
          style={styles.verifiedBadge}
        />
      ) : null}
    </View>
  ) : null;

  if (!canOpen) {
    if (part === "name") return nameNode;
    if (part === "avatar") return avatarNode;
    return (
      <View style={[styles.row, style]}>
        {avatarNode}
        {nameNode ? <View style={styles.nameCol}>{nameNode}</View> : null}
      </View>
    );
  }

  const avatarPressable = (
    <Pressable
      onPress={openProfile}
      accessibilityRole="button"
      accessibilityLabel={churchName ? `Open ${churchName} profile` : "Open church profile"}
      hitSlop={8}
    >
      {avatarNode}
    </Pressable>
  );

  const namePressable =
    nameNode && nameOpensProfile ? (
      <Pressable
        onPress={openProfile}
        style={part === "all" ? styles.nameCol : undefined}
        accessibilityRole="button"
        accessibilityLabel={churchName ? `Open ${churchName} profile` : "Open church profile"}
        hitSlop={4}
      >
        {nameNode}
      </Pressable>
    ) : nameNode ? (
      <View style={part === "all" ? styles.nameCol : undefined}>{nameNode}</View>
    ) : null;

  if (part === "avatar") return avatarPressable;
  if (part === "name") return namePressable;

  return (
    <View style={[styles.row, style]}>
      {avatarPressable}
      {namePressable}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  nameCol: {
    flex: 1,
    minWidth: 0,
  },
  churchNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  verifiedBadge: {
    flexShrink: 0,
  },
});

const premiumStyles = StyleSheet.create({
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  avatarInitial: {
    color: "rgba(244,201,93,0.95)",
    fontSize: 16,
    fontWeight: "900",
  },
  churchName: {
    flexShrink: 1,
    color: "rgba(244,201,93,0.98)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});

const watchStyles = StyleSheet.create({
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  avatarInitial: {
    color: "rgba(244,201,93,0.95)",
    fontSize: 18,
    fontWeight: "900",
  },
  churchName: {
    flexShrink: 1,
    color: "rgba(244,201,93,0.98)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
