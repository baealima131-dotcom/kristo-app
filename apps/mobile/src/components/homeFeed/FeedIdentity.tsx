import React, { memo, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import {
  isChurchRoomMemberFeedPost,
  resolveFeedIdentityHeadline,
  resolveFeedIdentitySubline,
  resolveFeedPostAccent,
  resolveFeedPostTypeTitle,
  resolveHomeFeedDisplayAvatar,
} from "./homeFeedUtils";
import { HOME_FEED_GOLD, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

const AVATAR_SIZE = 58;
const AVATAR_RING = AVATAR_SIZE + 10;
const TESTIMONY_BLUE = "rgba(0,145,255,0.92)";
const TESTIMONY_BLUE_SOFT = "rgba(120,200,255,0.95)";

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
  const accentSoft = accent === "testimony" ? TESTIMONY_BLUE_SOFT : HOME_FEED_GOLD_SOFT;
  const accentGlowBg = accent === "testimony" ? "rgba(0,145,255,0.18)" : "rgba(217,179,95,0.18)";
  const accentFallbackBg = accent === "testimony" ? "rgba(0,145,255,0.14)" : "rgba(217,179,95,0.14)";

  const { uri: avatarUri, backupUri, initial } = useMemo(
    () => resolveHomeFeedDisplayAvatar(item),
    [item]
  );

  const avatarCandidates = useMemo(() => {
    const next: string[] = [];
    for (const raw of [avatarUri, backupUri]) {
      const uri = String(raw || "").trim();
      if (uri && !next.includes(uri)) next.push(uri);
    }
    return next;
  }, [avatarUri, backupUri]);

  const [failedCount, setFailedCount] = useState(0);
  const displayUri = avatarCandidates[failedCount] || "";
  const showPhoto = Boolean(displayUri) && failedCount < avatarCandidates.length;

  useEffect(() => {
    setFailedCount(0);
  }, [avatarCandidates]);

  const memberLine = [headline, subline].filter(Boolean).join(" • ");

  return (
    <View style={styles.row}>
      <View style={styles.avatarShell}>
        <View
          style={[styles.avatarGlow, { backgroundColor: accentGlowBg, shadowColor: accentColor }]}
          pointerEvents="none"
        />
        <View style={[styles.avatarRing, { borderColor: accentColor }]}>
          {showPhoto ? (
            <Image
              source={{ uri: displayUri }}
              style={styles.avatarImage}
              onError={() => {
                setFailedCount((count) => Math.min(count + 1, avatarCandidates.length));
              }}
            />
          ) : (
            <View style={[styles.avatarImage, styles.avatarFallback, { backgroundColor: accentFallbackBg }]}>
              <Text style={[styles.avatarInitial, { color: accentSoft }]}>{letter}</Text>
            </View>
          )}
        </View>
      </View>

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
            <Text style={styles.churchName} numberOfLines={1}>
              {headline}
            </Text>
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
  avatarShell: {
    width: AVATAR_RING,
    height: AVATAR_RING,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlow: {
    position: "absolute",
    width: AVATAR_RING,
    height: AVATAR_RING,
    borderRadius: AVATAR_RING / 2,
    shadowOpacity: 0.85,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  avatarRing: {
    width: AVATAR_SIZE + 4,
    height: AVATAR_SIZE + 4,
    borderRadius: (AVATAR_SIZE + 4) / 2,
    padding: 2,
    borderWidth: 2,
    backgroundColor: "rgba(8,10,16,0.65)",
    overflow: "hidden",
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: "900",
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
