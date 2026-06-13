import React, { memo, useEffect, useMemo } from "react";
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
  resolveChurchName,
  resolveChurchRoomFeedCaption,
  resolveFeedChurchVerified,
  resolveFeedPostAccent,
  resolveFeedPostTypeTitle,
  resolveHomeFeedDisplayAvatar,
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
import { HOME_FEED_GOLD, HOME_FEED_THUMB_RADIUS } from "./theme";
import { homeFeedPremiumStyles as premium } from "./homeFeedPremiumStyles";
import { useHomeFeedRowEngagement } from "@/src/lib/homeFeedEngagement";
import {
  itemNeedsVisiblePosterGeneration,
  queueHomeFeedPosterPrewarm,
} from "@/src/lib/homeFeedPosterPrewarm";

type Props = {
  item: any;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
  onVideoPress?: (payload: HomeFeedVideoOpenPayload) => void;
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
  const churchName = resolveChurchName(item);
  const churchVerified = resolveFeedChurchVerified(item);
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

  const { uri: avatarUri, backupUri, initial } = useMemo(
    () => resolveHomeFeedDisplayAvatar(item),
    [
      postId,
      item?.authorAvatarUri,
      item?.authorAvatarUrl,
      item?.avatarUri,
      item?.avatarUrl,
      item?.churchAvatarUri,
      item?.churchLogoUri,
    ]
  );
  const avatarSrc = String(avatarUri || backupUri || "").trim();

  const handleVideoPress = () => {
    const payload = buildHomeFeedVideoOpenPayload(item);
    if (!payload) return;
    onVideoPress?.(payload);
  };

  const durationLabel = formatDurationLabel(videoDurationMs);

  useEffect(() => {
    if (!video || !videoUri || !postId) return;
    if (!itemNeedsVisiblePosterGeneration(item)) return;
    void queueHomeFeedPosterPrewarm(item, { priority: "visible" });
  }, [item, postId, video, videoUri, posterFieldsKey]);

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
            />
            <View style={styles.playOverlay} pointerEvents="none">
              <View style={premium.playBadge}>
                <Ionicons name="play" size={26} color="#FFFFFF" style={styles.playIcon} />
              </View>
            </View>
            {durationLabel ? (
              <View style={premium.durationBadge} pointerEvents="none">
                <Text style={styles.durationText}>{durationLabel}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : postImageUris.length > 0 ? (
          <ImagePostCarousel
            postId={postId}
            imageUris={postImageUris}
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
        {avatarSrc ? (
          <Image source={{ uri: avatarSrc }} style={premium.avatar} />
        ) : (
          <View style={premium.avatarFallback}>
            <Text style={premium.avatarInitial}>{initial || "K"}</Text>
          </View>
        )}
        <View style={premium.metaTextCol}>
          {churchName ? (
            <View style={premium.churchNameRow}>
              <Text style={premium.churchName} numberOfLines={1}>
                {churchName}
              </Text>
              {churchVerified ? (
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={HOME_FEED_GOLD}
                  style={styles.verifiedBadge}
                />
              ) : null}
            </View>
          ) : null}
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
  prev.onVideoPress === next.onVideoPress
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
}: {
  item: any;
  postId: string;
  mediaStatus: string;
  posterMetadata: ReturnType<typeof snapshotPosterMetadata>;
  videoDurationMs?: number;
  videoUri: string;
  posterFieldsKey: string;
}) {
  return (
    <FeedVideoPosterImage
      item={item}
      style={StyleSheet.absoluteFillObject}
      resizeMode="cover"
      postId={postId}
      videoUrl={videoUri}
      mediaStatus={mediaStatus}
      posterMetadata={posterMetadata}
      videoDurationMs={videoDurationMs}
      enableClientThumbnailFallback
      enableVideoFrameFallback
      youtubeMode
    />
  );
}

const MemoVideoThumbnail = memo(
  VideoThumbnail,
  (prev, next) =>
    prev.postId === next.postId &&
    prev.videoUri === next.videoUri &&
    prev.mediaStatus === next.mediaStatus &&
    prev.posterFieldsKey === next.posterFieldsKey &&
    prev.videoDurationMs === next.videoDurationMs
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
    backgroundColor: "#000000",
  },
  thumbPress: {
    flex: 1,
    borderRadius: HOME_FEED_THUMB_RADIUS,
    overflow: "hidden",
    backgroundColor: "#000000",
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
