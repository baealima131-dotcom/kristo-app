import React, { memo, useCallback, useMemo } from "react";
import {
  Pressable,
  Platform,
  Linking,
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
  resolveHomeFeedAvatarCacheContext,
} from "./homeFeedUtils";
import { HOME_FEED_GOLD } from "./theme";
import { openChurchOverviewFromFeedItem, openChurchProfileFromFeedItem } from "@/src/lib/churchProfileNavigation";
import { FeedChurchAvatar } from "./FeedChurchAvatar";
import { HomeFeedCachedAvatarImage } from "./HomeFeedCachedAvatarImage";

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
  /** Avatar opens the Church Overview style profile (Home feed video cards). */
  avatarOpensOverview?: boolean;
  deferAvatarLoad?: boolean;
  avatarDiagnostics?: {
    rowIndex?: number;
    mediaId?: string;
  };
};

/**
 * The YouTube channel page in a saved creatorProfileUrl (https youtube.com /@handle, /channel/ID,
 * /c/name or /user/name), or null. A video, Shorts or any other YouTube page is not a channel.
 */
export function youtubeChannelPageUrl(raw: unknown): string | null {
  try {
    const parsed = new URL(String(raw || "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (host !== "youtube.com" && host !== "m.youtube.com") return null;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/^\/(@[A-Za-z0-9._-]{1,100}|channel\/UC[A-Za-z0-9_-]{10,40}|c\/[A-Za-z0-9._-]{1,100}|user\/[A-Za-z0-9._-]{1,100})$/.test(path)) {
      return null;
    }
    return `https://www.youtube.com${path}`;
  } catch {
    return null;
  }
}

export const FeedChurchBrandRow = memo(function FeedChurchBrandRow({
  item,
  variant = "premium",
  part = "all",
  style,
  source,
  nameOpensProfile = true,
  avatarOpensOverview = false,
  deferAvatarLoad = false,
  avatarDiagnostics,
}: Props) {
  const churchId = useMemo(() => homeFeedRowChurchId(item), [item]);
  const churchName = useMemo(() => resolveChurchName(item), [item]);
  const churchVerified = useMemo(() => resolveFeedChurchVerified(item), [item]);
  const { cacheKey, remoteUris, initial, avatarUpdatedAt } = useMemo(
    () => resolveHomeFeedAvatarCacheContext(item),
    [item]
  );
  // Video links belong to an external YouTube/TikTok/Facebook account, not a Kristo church.
  const externalVideoAccount = String(item?.source || "").trim().toLowerCase() === "system-admin-video-link";
  const externalProfileUrl = String(item?.creatorProfileUrl || "").trim();
  const isYouTubeVideoLink =
    externalVideoAccount && String(item?.videoDisplayType || "").trim().toLowerCase() === "youtube";
  // YouTube: only the creator's channel page (from the saved metadata), never the video itself.
  const youtubeChannelUrl = useMemo(
    () => (isYouTubeVideoLink ? youtubeChannelPageUrl(externalProfileUrl) : null),
    [isYouTubeVideoLink, externalProfileUrl]
  );
  const canOpen = externalVideoAccount ? Boolean(externalProfileUrl) : Boolean(churchId);
  const openExternalProfile = useCallback(() => {
    if (isYouTubeVideoLink) {
      if (youtubeChannelUrl) void Linking.openURL(youtubeChannelUrl).catch(() => {});
      return;
    }
    try {
      const parsed = new URL(externalProfileUrl);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || !["youtube.com", "m.youtube.com", "tiktok.com", "vm.tiktok.com", "facebook.com", "m.facebook.com"].includes(host)) return;
      void Linking.openURL(parsed.toString());
    } catch {}
  }, [externalProfileUrl, isYouTubeVideoLink, youtubeChannelUrl]);

  const openProfile = useCallback(() => {
    if (!canOpen) return;
    if (externalVideoAccount) openExternalProfile();
    else openChurchProfileFromFeedItem(item, { source });
  }, [canOpen, externalVideoAccount, item, openExternalProfile, source]);

  const openAvatarTarget = useCallback(() => {
    // YouTube video link: the avatar opens the creator's YouTube channel (nothing when the
    // metadata has no channel page). TikTok / Facebook / Kristo posts keep their behaviour.
    if (isYouTubeVideoLink) {
      if (youtubeChannelUrl) void Linking.openURL(youtubeChannelUrl).catch(() => {});
      return;
    }
    if (!canOpen) return;
    if (avatarOpensOverview) openChurchOverviewFromFeedItem(item, { source: source ? `${source}-avatar` : undefined });
    else openChurchProfileFromFeedItem(item, { source });
  }, [avatarOpensOverview, canOpen, item, source, isYouTubeVideoLink, youtubeChannelUrl]);

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
    <HomeFeedCachedAvatarImage
      cacheKey={cacheKey}
      remoteUris={remoteUris}
      sourceUpdatedAt={avatarUpdatedAt}
      size={avatarSize}
      initial={initial}
      deferLoad={deferAvatarLoad}
      imageStyle={avatarStyle}
      fallbackStyle={avatarFallbackStyle}
      initialStyle={avatarInitialStyle}
      diagnostics={{
        churchId,
        mediaId: avatarDiagnostics?.mediaId,
        rowIndex: avatarDiagnostics?.rowIndex,
      }}
    />
  ) : (
    <FeedChurchAvatar
      postId={postId}
      size={avatarSize}
      shellSize={avatarShellSize}
      cacheKey={cacheKey}
      remoteUris={remoteUris}
      avatarUpdatedAt={avatarUpdatedAt}
      initial={initial}
      deferLoad={deferAvatarLoad}
      diagnostics={{
        churchId,
        mediaId: avatarDiagnostics?.mediaId,
        rowIndex: avatarDiagnostics?.rowIndex,
      }}
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
      onPress={openAvatarTarget}
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
    fontFamily: Platform.select({
      ios: "AvenirNext-DemiBold",
      android: "sans-serif-medium",
      default: undefined,
    }),
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
