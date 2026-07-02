import React, { memo, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  isHomeFeedPostViewedSync,
  subscribeHomeFeedPostViews,
} from "@/src/lib/homeFeedPostViews";
import { HomeFeedCachedAvatarImage } from "./HomeFeedCachedAvatarImage";

const UNVIEWED_RING = ["#FFF4D4", "#F5D76E", "#C9A04A", "#F5D76E"] as const;
const RING_PAD = 2;

type Props = {
  postId: string;
  size: number;
  shellSize: number;
  cacheKey: string;
  remoteUris: string[];
  avatarUpdatedAt?: number;
  initial?: string;
  deferLoad?: boolean;
  diagnostics?: {
    churchId?: string;
    mediaId?: string;
    rowIndex?: number;
  };
};

function usePostViewed(postId: string): boolean {
  const [viewed, setViewed] = useState(() => isHomeFeedPostViewedSync(postId));

  useEffect(() => {
    setViewed(isHomeFeedPostViewedSync(postId));
    return subscribeHomeFeedPostViews(() => {
      setViewed(isHomeFeedPostViewedSync(postId));
    });
  }, [postId]);

  return viewed;
}

export const FeedChurchAvatar = memo(function FeedChurchAvatar({
  postId,
  size,
  shellSize,
  cacheKey,
  remoteUris,
  avatarUpdatedAt,
  initial = "K",
  deferLoad = false,
  diagnostics,
}: Props) {
  const viewed = usePostViewed(postId);
  const stableRemoteUris = useMemo(
    () =>
      remoteUris
        .map((uri) => String(uri || "").trim())
        .filter((uri, index, list) => uri && list.indexOf(uri) === index),
    [remoteUris]
  );

  const ringSize = size + 4;

  const avatarImage = (
    <HomeFeedCachedAvatarImage
      cacheKey={cacheKey}
      remoteUris={stableRemoteUris}
      sourceUpdatedAt={avatarUpdatedAt}
      size={size}
      initial={initial}
      deferLoad={deferLoad}
      diagnostics={diagnostics}
    />
  );

  return (
    <View style={[styles.shell, { width: shellSize, height: shellSize }]}>
      {!viewed ? (
        <View
          pointerEvents="none"
          style={[
            styles.unviewedGlow,
            {
              width: shellSize,
              height: shellSize,
              borderRadius: shellSize / 2,
            },
          ]}
        />
      ) : null}

      {viewed ? (
        <View
          style={[
            styles.viewedRing,
            {
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              padding: RING_PAD,
            },
          ]}
        >
          {avatarImage}
        </View>
      ) : (
        <LinearGradient
          colors={[...UNVIEWED_RING]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.unviewedRing,
            {
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              padding: RING_PAD,
            },
          ]}
        >
          <View
            style={[
              styles.ringInner,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
              },
            ]}
          >
            {avatarImage}
          </View>
        </LinearGradient>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  shell: {
    alignItems: "center",
    justifyContent: "center",
  },
  unviewedGlow: {
    position: "absolute",
    backgroundColor: "rgba(245,215,120,0.12)",
    ...Platform.select({
      ios: {
        shadowColor: "#F5D76E",
        shadowOpacity: 0.42,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 4,
      },
    }),
  },
  unviewedRing: {
    alignItems: "center",
    justifyContent: "center",
  },
  viewedRing: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(8,10,16,0.55)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  ringInner: {
    overflow: "hidden",
    backgroundColor: "rgba(8,10,16,0.65)",
  },
});
