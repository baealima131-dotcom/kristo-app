import React, { memo, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ImagePostCarousel } from "./ImagePostCarousel";
import { PostActionsInline } from "./PostActionsInline";
import { FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import {
  formatFeedMetaLine,
  formatFeedTimestamp,
  isChurchRoomMemberFeedPost,
  isVideoPost,
  resolveChurchRoomFeedCaption,
  resolveFeedPostAccent,
  resolveFeedPostTypeTitle,
  resolveHomeFeedVideoTitle,
  resolvePostBody,
  resolvePostImageUris,
  resolveVideoUri,
  snapshotPosterMetadata,
  posterMetadataFingerprint,
  buildHomeFeedVideoOpenPayload,
  type HomeFeedPostAccent,
} from "./homeFeedUtils";
import { resolveVideoDurationMs } from "@/src/lib/mediaVideoPoster";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import {
  homeFeedVideoThumbnailHeight,
  tiktokThumbnailWidth,
} from "@/src/lib/homeFeedYouTubeLayout";
import { resolveHomeFeedVideoDisplayType } from "@/src/lib/homeFeedVideoDisplayType";
import { markHomeFeedPosterPipelineStage } from "@/src/lib/homeFeedPosterPipelineTrace";
import { HOME_FEED_GOLD, HOME_FEED_THUMB_RADIUS } from "./theme";
import { homeFeedPremiumStyles as premium } from "./homeFeedPremiumStyles";
import { FeedChurchBrandRow } from "./FeedChurchBrandRow";
import { useHomeFeedRowEngagement } from "@/src/lib/homeFeedEngagement";

type Props = {
  item: any;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
  onVideoPress?: (payload: HomeFeedVideoOpenPayload) => void;
  /** Only load poster/avatar bitmaps when within the visible window. */
  shouldLoadImages?: boolean;
};

export const FeedYouTubeCard = memo(
  function FeedYouTubeCard({
  item,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
  onVideoPress,
  shouldLoadImages = true,
}: Props) {
  const engagement = useHomeFeedRowEngagement(item);
  const { width: windowWidth } = useWindowDimensions();
  const displayType = resolveHomeFeedVideoDisplayType(item);
  const thumbHeight = homeFeedVideoThumbnailHeight(windowWidth, displayType);
  const tiktokThumbWidth = tiktokThumbnailWidth(windowWidth);

  const postId = String(item?.id || "").trim();
  const posterFieldsKey = posterMetadataFingerprint(item);
  const whenLabel = formatFeedTimestamp(item?.createdAt);
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolveHomeFeedVideoTitle(item);
  const postBody = resolvePostBody(item);
  const title = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle;
  const caption = churchRoomPost ? resolveChurchRoomFeedCaption(item) : postBody;
  const statsLine = formatFeedMetaLine(item, whenLabel);
  const video = isVideoPost(item);
  const videoUri = useMemo(
    () => resolveVideoUri(item),
    [
      postId,
      item?.localVideoUri,
      item?.videoUrl,
      item?.videoUri,
      item?.mediaUrl,
      item?.url,
      item?.mediaUri,
      item?.mediaType,
      item?.type,
      item?.kind,
    ]
  );
  const postImageUris = useMemo(
    () => resolvePostImageUris(item),
    [postId, item?.imageUrls, item?.images, item?.mediaUri, item?.mediaUrl]
  );
  const posterMetadata = useMemo(() => snapshotPosterMetadata(item), [posterFieldsKey]);
  const videoDurationMs = useMemo(
    () => resolveVideoDurationMs(item),
    [postId, item?.durationMs, item?.videoDurationMs, item?.duration]
  );
  const mediaStatus = String(item?.mediaStatus || item?.status || "").trim();
  const postAccent = resolveFeedPostAccent(item);

  useEffect(() => {
    if (!postId) return;
    markHomeFeedPosterPipelineStage(postId, "card_mounted", {
      videoUrl: videoUri,
      source: "FeedYouTubeCard",
    });
  }, [postId, videoUri]);

  const handleVideoPress = () => {
    const payload = buildHomeFeedVideoOpenPayload(item);
    if (!payload) return;
    onVideoPress?.(payload);
  };

  const durationLabel = formatDurationLabel(videoDurationMs);

  return (
    <View style={premium.feedCard}>
      <View
        style={[
          premium.thumbFrame,
          { height: thumbHeight },
          displayType === "tiktok" ? styles.thumbWrapTikTok : null,
        ]}
      >
        {video && videoUri ? (
          <Pressable
            style={[
              styles.thumbPress,
              displayType === "tiktok" ? { width: tiktokThumbWidth, height: thumbHeight } : null,
            ]}
            onPress={handleVideoPress}
            accessibilityLabel="Play video"
          >
            <MemoVideoThumbnail
              item={item}
              postId={postId}
              mediaStatus={mediaStatus}
              posterMetadata={posterMetadata}
              videoDurationMs={videoDurationMs}
              videoUri={videoUri}
              posterFieldsKey={posterFieldsKey}
              shouldLoadImages={shouldLoadImages}
              durationLabel={durationLabel}
            />
          </Pressable>
        ) : postImageUris.length > 0 ? (
          <ImagePostCarousel
            postId={postId}
            imageUris={shouldLoadImages ? postImageUris : []}
            accent={postAccent}
            fallback={
              churchRoomPost ? (
                <TextCardPreview title={postTitle} caption={caption} accent={postAccent} />
              ) : undefined
            }
          />
        ) : (
          <TextCardPreview
            title={churchRoomPost ? postTitle : title}
            caption={caption}
            accent={postAccent}
          />
        )}
      </View>

      <View style={premium.metaSection}>
        <View style={premium.metaRow}>
          <FeedChurchBrandRow item={item} variant="premium" part="avatar" source="home-feed-card" deferAvatarLoad={!shouldLoadImages} />
          <View style={premium.metaTextCol}>
            <FeedChurchBrandRow item={item} variant="premium" part="name" source="home-feed-card" />
            {title ? (
              <Text style={premium.videoTitle} numberOfLines={2}>
                {title}
              </Text>
            ) : null}
            {statsLine ? (
              <Text style={premium.statsLine} numberOfLines={1}>
                {statsLine}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <PostActionsInline
        liked={engagement.likedByMe || engagement.liked}
        likeCount={engagement.likeCount}
        commentCount={engagement.commentCount}
        shareCount={Number(item?.shareCount || 0)}
        saved={engagement.saved}
        reported={engagement.reported}
        onLike={onLike}
        onComment={onComment}
        onShare={onShare}
        onSave={onSave}
        onReport={onReport}
      />
    </View>
  );
},
(prev, next) =>
  prev.item === next.item &&
  prev.onLike === next.onLike &&
  prev.onComment === next.onComment &&
  prev.onShare === next.onShare &&
  prev.onSave === next.onSave &&
  prev.onReport === next.onReport &&
  prev.onVideoPress === next.onVideoPress &&
  prev.shouldLoadImages === next.shouldLoadImages
);

function formatDurationLabel(videoDurationMs?: number) {
  const durationSec =
    videoDurationMs && videoDurationMs > 0 ? Math.round(videoDurationMs / 1000) : 0;
  if (durationSec <= 0) return "";
  if (durationSec >= 3600) {
    return `${Math.floor(durationSec / 3600)}:${String(Math.floor((durationSec % 3600) / 60)).padStart(2, "0")}:${String(durationSec % 60).padStart(2, "0")}`;
  }
  if (durationSec >= 60) {
    return `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}`;
  }
  return `0:${String(durationSec).padStart(2, "0")}`;
}

function VideoThumbnail({
  item,
  postId,
  mediaStatus,
  posterMetadata,
  videoDurationMs,
  videoUri,
  posterFieldsKey,
  shouldLoadImages = true,
  durationLabel = "",
}: {
  item: any;
  postId: string;
  mediaStatus: string;
  posterMetadata: ReturnType<typeof snapshotPosterMetadata>;
  videoDurationMs?: number;
  videoUri: string;
  posterFieldsKey: string;
  shouldLoadImages?: boolean;
  durationLabel?: string;
}) {
  const [coverReady, setCoverReady] = useState(false);

  useEffect(() => {
    setCoverReady(false);
  }, [postId, videoUri, shouldLoadImages]);

  return (
    <>
      <FeedVideoPosterImage
        item={item}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
        postId={postId}
        videoUrl={videoUri}
        mediaStatus={mediaStatus}
        posterMetadata={posterMetadata}
        videoDurationMs={videoDurationMs}
        youtubeMode
        allowImageLoad={shouldLoadImages}
        onPosterCoverReady={setCoverReady}
      />
      {coverReady ? (
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={premium.playBadge}>
            <Ionicons name="play" size={26} color="#FFFFFF" style={styles.playIcon} />
          </View>
        </View>
      ) : null}
      {coverReady && durationLabel ? (
        <View style={premium.durationBadge} pointerEvents="none">
          <Text style={styles.durationText}>{durationLabel}</Text>
        </View>
      ) : null}
    </>
  );
}

const MemoVideoThumbnail = memo(
  VideoThumbnail,
  (prev, next) =>
    prev.postId === next.postId &&
    prev.videoUri === next.videoUri &&
    prev.mediaStatus === next.mediaStatus &&
    prev.posterFieldsKey === next.posterFieldsKey &&
    prev.videoDurationMs === next.videoDurationMs &&
    prev.shouldLoadImages === next.shouldLoadImages
);

function TextCardPreview({
  title,
  caption,
  accent,
}: {
  title: string;
  caption: string;
  accent: HomeFeedPostAccent;
}) {
  const text = String(caption || title || "").trim() || " ";
  return (
    <LinearGradient
      colors={
        accent === "testimony"
          ? ["#071018", "#0B1A2E"]
          : accent === "announcement"
            ? ["#0A0C12", "#15120A"]
            : ["#0A0C12", "#121824"]
      }
      style={styles.textPreview}
    >
      <Text style={styles.textPreviewBody} numberOfLines={6}>
        {text}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  thumbWrapTikTok: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a1a",
  },
  thumbPress: {
    flex: 1,
    borderRadius: HOME_FEED_THUMB_RADIUS,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    marginLeft: 3,
  },
  durationText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  verifiedBadge: {
    flexShrink: 0,
    marginTop: 1,
  },
  textPreview: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: HOME_FEED_THUMB_RADIUS,
  },
  textPreviewBody: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700",
  },
});
