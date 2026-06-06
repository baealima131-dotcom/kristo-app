import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
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
  isChurchRoomMemberFeedPost,
  isVideoPost,
  resolveChurchRoomFeedCaption,
  resolveFeedPostAccent,
  resolveFeedPostTypeTitle,
  resolvePostImageUri,
  resolvePostBody,
  resolvePostTitle,
  resolvePosterUri,
  resolveVideoUri,
  isValidVideoPosterUri,
  hasBrandedVideoPoster,
  hasHomeFeedVideoPoster,
} from "./homeFeedUtils";
import { VideoPostFallbackPoster, FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import type { HomeFeedVideoWarmMode } from "@/src/lib/homeFeedVideoWindow";

type Props = {
  item: any;
  height: number;
  isActive: boolean;
  videoWarmMode: HomeFeedVideoWarmMode;
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
  videoWarmMode,
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
  const whenLabel = formatFeedTimestamp(item?.createdAt);
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolvePostTitle(item);
  const postBody = resolvePostBody(item);
  const title = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle;
  const caption = churchRoomPost ? resolveChurchRoomFeedCaption(item) : postBody;
  const postAccent = resolveFeedPostAccent(item);

  const video = isVideoPost(item);
  const videoUri = useMemo(() => resolveVideoUri(item), [item]);
  const resolvedImageUri = useMemo(() => resolvePostImageUri(item), [item]);
  const willRenderImage = Boolean(resolvedImageUri) && !item?.videoUrl;
  const posterUri = resolvePosterUri(item);
  const mediaStatus = String(item?.mediaStatus || item?.status || "").trim();
  const mountVideoPlayer = Boolean(
    video && videoUri && videoWarmMode !== "off" && screenFocused
  );
  const shareCount = Number(item?.shareCount || 0);
  const saveCount = Number(item?.saveCount || 0);
  const animateCopy = isActive && screenFocused;

  console.log("[KRISTO_FEED_RENDER_DECISION]", {
    postId: item?.id,
    source: item?.source,
    type: item?.type,
    mediaType: item?.mediaType,
    hasVideoUrl: Boolean(item?.videoUrl),
    mediaUri: item?.mediaUri,
    imageUrl: item?.imageUrl,
    resolvedImageUri,
    willRenderImage,
  });

  return (
    <View style={[styles.slide, { height }]}>
      <View style={styles.media}>
        {video && videoUri ? (
          mountVideoPlayer ? (
            <SimpleFeedVideo
              key={`feed-video-${postId}`}
              postId={postId}
              title={title}
              mediaStatus={mediaStatus}
              uri={videoUri}
              posterUri={posterUri}
              brandedPoster={hasBrandedVideoPoster(item)}
              warmMode={videoWarmMode}
              screenFocused={screenFocused}
            />
          ) : (
            <InactiveVideoPoster
              item={item}
              postId={postId}
              title={title}
              mediaStatus={mediaStatus}
              posterUri={posterUri}
              videoUri={videoUri}
            />
          )
        ) : willRenderImage ? (
          <ImagePostCard imageUri={resolvedImageUri} />
        ) : (
          <TextPostPanel text={churchRoomPost ? caption || postTitle : postTitle || postBody} />
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
        {churchRoomPost ? (
          <>
            <FeedIdentity item={item} whenLabel={whenLabel} />
            <FeedTitleCaption
              postId={postId}
              title=""
              caption={caption}
              isActive={animateCopy}
              accent={postAccent}
              captionOnly
            />
          </>
        ) : (
          <>
            <FeedIdentity item={item} whenLabel={whenLabel} />
            <FeedTitleCaption
              postId={postId}
              title={title}
              caption={caption}
              isActive={animateCopy}
              accent={postAccent}
            />
          </>
        )}
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

function InactiveVideoPoster({
  item,
  postId,
  title,
  mediaStatus,
  posterUri,
  videoUri,
}: {
  item: any;
  postId: string;
  title: string;
  mediaStatus: string;
  posterUri: string;
  videoUri: string;
}) {
  if (hasHomeFeedVideoPoster(item, videoUri)) {
    if (isValidVideoPosterUri(posterUri, videoUri)) {
      return (
        <FeedVideoPosterImage
          uri={posterUri}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          postId={postId}
          title={title}
          videoUrl={videoUri}
          mediaStatus={mediaStatus}
        />
      );
    }
    return (
      <VideoPostFallbackPoster
        postId={postId}
        title={title}
        videoUrl={videoUri}
        mediaStatus={mediaStatus}
        suppressMissingPosterLog={hasBrandedVideoPoster(item)}
      />
    );
  }
  return (
    <VideoPostFallbackPoster
      postId={postId}
      title={title}
      videoUrl={videoUri}
      mediaStatus={mediaStatus}
    />
  );
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
