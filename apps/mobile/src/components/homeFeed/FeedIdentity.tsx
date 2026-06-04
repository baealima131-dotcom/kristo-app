import React, { memo, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import {
  logHomeFeedIdentityAvatarResolve,
  resolveHomeFeedDisplayAvatar,
} from "./homeFeedUtils";
import { HOME_FEED_GOLD, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

const AVATAR_SIZE = 58;
const AVATAR_RING = AVATAR_SIZE + 10;

type Props = {
  item: any;
  churchName: string;
  mediaName: string;
  whenLabel: string;
};

export const FeedIdentity = memo(function FeedIdentity({
  item,
  churchName,
  mediaName,
  whenLabel,
}: Props) {
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
    logHomeFeedIdentityAvatarResolve(item, churchName, displayUri, backupUri);
  }, [item, churchName, displayUri, backupUri]);

  const letter = String(initial || churchName || "K").trim().charAt(0).toUpperCase() || "K";

  useEffect(() => {
    setFailedCount(0);
  }, [avatarCandidates]);

  const subline = [mediaName, whenLabel].filter(Boolean).join(" • ");

  return (
    <View style={styles.row}>
      <View style={styles.avatarShell}>
        <View style={styles.avatarGlow} pointerEvents="none" />
        <View style={styles.avatarRing}>
          {showPhoto ? (
            <Image
              source={{ uri: displayUri }}
              style={styles.avatarImage}
              onError={() => {
                setFailedCount((count) => Math.min(count + 1, avatarCandidates.length));
              }}
            />
          ) : (
            <View style={[styles.avatarImage, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{letter}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.textCol}>
        <Text style={styles.churchName} numberOfLines={1}>
          {churchName}
        </Text>
        {subline ? (
          <Text style={styles.subline} numberOfLines={1}>
            {subline}
          </Text>
        ) : null}
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
    backgroundColor: "rgba(217,179,95,0.18)",
    shadowColor: HOME_FEED_GOLD,
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
    borderColor: "rgba(217,179,95,0.92)",
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
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  avatarInitial: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 24,
    fontWeight: "900",
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  churchName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.2,
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
