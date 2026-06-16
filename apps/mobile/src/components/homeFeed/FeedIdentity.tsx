import React, { memo, useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  isChurchRoomMemberFeedPost,
  homeFeedRowChurchId,
  resolveFeedIdentityHeadline,
  resolveFeedIdentitySubline,
  resolveFeedPostAccent,
  resolveFeedPostTypeTitle,
  resolveHomeFeedDisplayAvatar,
} from "./homeFeedUtils";
import { HOME_FEED_GOLD, HOME_FEED_MUTED } from "./theme";
import { openChurchProfileFromFeedItem } from "@/src/lib/churchProfileNavigation";
import { FeedChurchAvatar } from "./FeedChurchAvatar";

const AVATAR_SIZE = 58;
const AVATAR_RING = AVATAR_SIZE + 10;
const TESTIMONY_BLUE = "rgba(0,145,255,0.92)";

type Props = {
  item: any;
  whenLabel: string;
};

export const FeedIdentity = memo(function FeedIdentity({ item, whenLabel }: Props) {
  const churchRoomPost = useMemo(() => isChurchRoomMemberFeedPost(item), [item]);
  const headline = useMemo(() => resolveFeedIdentityHeadline(item), [item]);
  const subline = useMemo(() => resolveFeedIdentitySubline(item, whenLabel), [item, whenLabel]);
  const typeLabel = useMemo(
    () => (churchRoomPost ? resolveFeedPostTypeTitle(item) : ""),
    [churchRoomPost, item]
  );
  const accent = useMemo(() => resolveFeedPostAccent(item), [item]);
  const accentColor = accent === "testimony" ? TESTIMONY_BLUE : HOME_FEED_GOLD;

  const postId = String(item?.id || "").trim();
  const { uri: avatarUri, backupUri, initial } = useMemo(
    () => resolveHomeFeedDisplayAvatar(item),
    [item]
  );

  const memberLine = [headline, subline].filter(Boolean).join(" • ");
  const churchId = useMemo(() => homeFeedRowChurchId(item), [item]);
  const openChurchProfile = useCallback(() => {
    openChurchProfileFromFeedItem(item, { source: "home-feed-identity" });
  }, [item]);

  const avatarShell = (
    <FeedChurchAvatar
      postId={postId}
      size={AVATAR_SIZE}
      shellSize={AVATAR_RING}
      uri={avatarUri}
      backupUri={backupUri}
      initial={initial}
    />
  );

  return (
    <View style={styles.row}>
      {churchId && !churchRoomPost ? (
        <Pressable onPress={openChurchProfile} accessibilityRole="button" accessibilityLabel="Open church profile">
          {avatarShell}
        </Pressable>
      ) : (
        avatarShell
      )}

      <View style={styles.textCol}>
        {churchRoomPost ? (
          <>
            <Text style={[styles.typeLabel, { color: accentColor }]} numberOfLines={1}>
              {typeLabel}
            </Text>
            <Text style={styles.churchName} numberOfLines={1}>
              {memberLine}
            </Text>
          </>
        ) : (
          <>
            {churchId ? (
              <Pressable
                onPress={openChurchProfile}
                accessibilityRole="button"
                accessibilityLabel="Open church profile"
              >
                <Text style={styles.churchName} numberOfLines={1}>
                  {headline}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.churchName} numberOfLines={1}>
                {headline}
              </Text>
            )}
            {subline ? (
              <Text style={styles.subline} numberOfLines={1}>
                {subline}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  typeLabel: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  churchName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.15,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  subline: {
    color: HOME_FEED_MUTED,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
