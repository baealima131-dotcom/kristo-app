import React, { memo, useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SimpleFeedVideo } from "./SimpleFeedVideo";
import { ImagePostCard } from "./ImagePostCard";
import { PostActions } from "./PostActions";
import { FeedIdentity } from "./FeedIdentity";
import { FeedTitleCaption } from "./FeedTitleCaption";
import { homeFeedChromeOffsets } from "./theme";
import {
  formatFeedTimestamp,
  isImagePost,
  isVideoPost,
  resolveChurchName,
  resolveImageUri,
  resolveMediaName,
  resolvePostBody,
  resolvePostTitle,
  resolvePosterUri,
  resolveVideoUri,
} from "./homeFeedUtils";

type Props = {
  item: any;
  height: number;
  isActive: boolean;
  isNext: boolean;
  screenFocused: boolean;
  likedByMe: boolean;
  liked: boolean;
  likeCount: number;
  visibleDiscussionCount: number;
  saved: boolean;
  reported: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
};

export const FeedRow = memo(function FeedRow({
  item,
  height,
  isActive,
  isNext,
  screenFocused,
  likedByMe,
  liked,
  likeCount,
  visibleDiscussionCount,
  saved,
  reported,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: Props) {
  const insets = useSafeAreaInsets();
  const chrome = useMemo(() => homeFeedChromeOffsets(insets.bottom), [insets.bottom]);

  const postId = String(item?.id || "").trim();
  const churchName = resolveChurchName(item);
  const mediaName = resolveMediaName(item);
  const whenLabel = formatFeedTimestamp(item?.createdAt);
  const title = resolvePostTitle(item);
  const caption = resolvePostBody(item);

  const video = isVideoPost(item);
  const image = isImagePost(item);
  const videoUri = resolveVideoUri(item);
  const imageUri = resolveImageUri(item);
  const posterUri = resolvePosterUri(item);
  const canMountPlayer = video && videoUri && screenFocused;
  const mountActivePlayer = Boolean(canMountPlayer && isActive);
  const mountPreloadPlayer = Boolean(canMountPlayer && isNext && !isActive);
  const shareCount = Number(item?.shareCount || 0);
  const saveCount = Number(item?.saveCount || 0);
  const animateCopy = isActive && screenFocused;

  return (
    <View style={[styles.slide, { height }]}>
      <View style={styles.media}>
        {video && videoUri ? (
          mountActivePlayer || mountPreloadPlayer ? (
            <SimpleFeedVideo
              postId={postId}
              uri={videoUri}
              posterUri={posterUri}
              shouldPlay={mountActivePlayer}
              preloadOnly={mountPreloadPlayer}
              screenFocused={screenFocused}
            />
          ) : (
            <InactiveVideoPoster posterUri={posterUri} videoUri={videoUri} />
          )
        ) : image && imageUri ? (
          <ImagePostCard imageUri={imageUri} />
        ) : (
          <TextPostPanel text={title || caption} />
        )}
      </View>

      <LinearGradient
        colors={["transparent", "rgba(3,5,12,0.22)", "rgba(3,5,12,0.5)"]}
        locations={[0, 0.72, 1]}
        style={styles.softBottomGradient}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["transparent", "rgba(3,5,12,0.45)", "rgba(3,5,12,0.94)"]}
        locations={[0, 0.35, 1]}
        style={styles.copyScrimGradient}
        pointerEvents="none"
      />

      <View style={[styles.meta, { bottom: chrome.metaBottom }]} pointerEvents="box-none">
        <FeedIdentity
          item={item}
          churchName={churchName}
          mediaName={mediaName}
          whenLabel={whenLabel}
        />
        <FeedTitleCaption
          postId={postId}
          title={title}
          caption={caption}
          isActive={animateCopy}
        />
      </View>

      <PostActions
        likedByMe={likedByMe}
        liked={liked}
        likeCount={likeCount}
        commentCount={visibleDiscussionCount}
        shareCount={shareCount}
        saveCount={saveCount}
        saved={saved}
        reported={reported}
        bottomOffset={chrome.actionBottom}
        onLike={onLike}
        onComment={onComment}
        onShare={onShare}
        onSave={onSave}
        onReport={onReport}
      />
    </View>
  );
});

function InactiveVideoPoster({ posterUri, videoUri }: { posterUri: string; videoUri: string }) {
  const uri = String(posterUri || "").trim() || videoUri;
  if (!uri) {
    return <View style={styles.mediaFallback} />;
  }
  return <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />;
}

function TextPostPanel({ text }: { text: string }) {
  return (
    <View style={styles.textPanel}>
      <Text style={styles.textBody}>{text || " "}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    width: "100%",
    backgroundColor: "#03050C",
    overflow: "hidden",
  },
  media: {
    flex: 1,
    backgroundColor: "#03050C",
  },
  mediaFallback: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  softBottomGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "34%",
  },
  copyScrimGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 240,
  },
  meta: {
    position: "absolute",
    left: 14,
    right: 88,
    gap: 6,
    zIndex: 12,
  },
  textPanel: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 160,
    backgroundColor: "#0B0F17",
  },
  textBody: {
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
  },
});
