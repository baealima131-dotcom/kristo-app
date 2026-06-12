import React, { memo, useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ImagePostCarousel } from "./ImagePostCarousel";
import { PostActionsInline } from "./PostActionsInline";
import { FeedVideoPosterImage, VideoPostFallbackPoster } from "./VideoPostFallbackPoster";
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
  resolvePostBody,
  resolvePostImageUris,
  resolvePostTitle,
  resolveVideoUri,
  snapshotPosterMetadata,
  buildHomeFeedVideoOpenPayload,
  type HomeFeedPostAccent,
} from "./homeFeedUtils";
import { resolveVideoDurationMs } from "@/src/lib/mediaVideoPoster";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import {
  YOUTUBE_CARD_H_PADDING,
  youtubeThumbnailHeight,
} from "@/src/lib/homeFeedYouTubeLayout";
import { HOME_FEED_BG, HOME_FEED_BORDER, HOME_FEED_GOLD, HOME_FEED_GOLD_SOFT } from "./theme";

const AVATAR_SIZE = 46;
const STATS_COLOR = "rgba(255,255,255,0.45)";

type Props = {
  item: any;
  likedByMe: boolean;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  saved: boolean;
  reported: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
  onVideoPress?: (payload: HomeFeedVideoOpenPayload) => void;
};

export const FeedYouTubeCard = memo(function FeedYouTubeCard({
  item,
  likedByMe,
  liked,
  likeCount,
  commentCount,
  shareCount,
  saveCount,
  saved,
  reported,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
  onVideoPress,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const thumbHeight = youtubeThumbnailHeight(windowWidth);

  const postId = String(item?.id || "").trim();
  const whenLabel = formatFeedTimestamp(item?.createdAt);
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolvePostTitle(item);
  const postBody = resolvePostBody(item);
  const title = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle;
  const caption = churchRoomPost ? resolveChurchRoomFeedCaption(item) : postBody;
  const churchName = resolveChurchName(item);
  const churchVerified = resolveFeedChurchVerified(item);
  const statsLine = formatFeedMetaLine(item, whenLabel);

  const video = isVideoPost(item);
  const videoUri = useMemo(() => resolveVideoUri(item), [item]);
  const postImageUris = useMemo(() => resolvePostImageUris(item), [item]);
  const posterMetadata = useMemo(() => snapshotPosterMetadata(item), [item]);
  const videoDurationMs = useMemo(() => resolveVideoDurationMs(item), [item]);
  const mediaStatus = String(item?.mediaStatus || item?.status || "").trim();
  const postAccent = resolveFeedPostAccent(item);

  const { uri: avatarUri, backupUri, initial } = useMemo(
    () => resolveHomeFeedDisplayAvatar(item),
    [item]
  );
  const avatarSrc = String(avatarUri || backupUri || "").trim();

  const handleVideoPress = () => {
    const payload = buildHomeFeedVideoOpenPayload(item);
    if (!payload) return;
    onVideoPress?.(payload);
  };

  const durationLabel = formatDurationLabel(videoDurationMs);

  return (
    <View style={styles.card}>
      <View style={[styles.thumbWrap, { height: thumbHeight }]}>
        {video && videoUri ? (
          <Pressable style={styles.thumbPress} onPress={handleVideoPress} accessibilityLabel="Play video">
            <VideoThumbnail
              item={item}
              postId={postId}
              title={title}
              churchName={churchName}
              mediaStatus={mediaStatus}
              posterMetadata={posterMetadata}
              videoDurationMs={videoDurationMs}
              videoUri={videoUri}
            />
            <View style={styles.playOverlay} pointerEvents="none">
              <View style={styles.playBadge}>
                <Ionicons name="play" size={22} color="#FFFFFF" style={styles.playIcon} />
              </View>
            </View>
            {durationLabel ? (
              <View style={styles.durationBadge} pointerEvents="none">
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

      <View style={styles.metaRow}>
        {avatarSrc ? (
          <Image source={{ uri: avatarSrc }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>{initial || "K"}</Text>
          </View>
        )}
        <View style={styles.metaTextCol}>
          {churchName ? (
            <View style={styles.churchNameRow}>
              <Text style={styles.churchName} numberOfLines={1}>
                {churchName}
              </Text>
              {churchVerified ? (
                <Ionicons
                  name="checkmark-circle"
                  size={15}
                  color={HOME_FEED_GOLD}
                  style={styles.verifiedBadge}
                />
              ) : null}
            </View>
          ) : null}
          {title ? (
            <Text style={styles.videoTitle} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {statsLine ? (
            <Text style={styles.statsLine} numberOfLines={1}>
              {statsLine}
            </Text>
          ) : null}
        </View>
      </View>

      <PostActionsInline
        liked={likedByMe || liked}
        likeCount={likeCount}
        commentCount={commentCount}
        shareCount={shareCount}
        saved={saved}
        reported={reported}
        onLike={onLike}
        onComment={onComment}
        onShare={onShare}
        onSave={onSave}
        onReport={onReport}
      />
    </View>
  );
});

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
  title,
  churchName,
  mediaStatus,
  posterMetadata,
  videoDurationMs,
  videoUri,
}: {
  item: any;
  postId: string;
  title: string;
  churchName: string;
  mediaStatus: string;
  posterMetadata: ReturnType<typeof snapshotPosterMetadata>;
  videoDurationMs?: number;
  videoUri: string;
}) {
  return (
    <FeedVideoPosterImage
      item={item}
      style={StyleSheet.absoluteFillObject}
      resizeMode="cover"
      postId={postId}
      title={title}
      churchName={churchName}
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
  card: {
    backgroundColor: HOME_FEED_BG,
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HOME_FEED_BORDER,
  },
  thumbWrap: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#0B0F17",
  },
  thumbPress: {
    flex: 1,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  playBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    marginLeft: 3,
  },
  durationBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.78)",
  },
  durationText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "#1A2230",
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "rgba(217,179,95,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 18,
    fontWeight: "900",
  },
  metaTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  churchNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  churchName: {
    flexShrink: 1,
    color: HOME_FEED_GOLD,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  verifiedBadge: {
    flexShrink: 0,
    marginTop: 1,
  },
  videoTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    letterSpacing: 0.05,
  },
  statsLine: {
    color: STATS_COLOR,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
    marginTop: 2,
  },
  textPreview: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  textPreviewBody: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700",
  },
});
