import React, { memo, useEffect, useMemo, useRef } from "react";
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
  type HomeFeedPostAccent,
} from "./homeFeedUtils";
import { VideoPostFallbackPoster, FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import type { HomeFeedVideoWarmMode } from "@/src/lib/homeFeedVideoWindow";

const IMAGE_CANDIDATE_KEYS = [
  "mediaUri",
  "imageUrl",
  "imageUri",
  "mediaUrl",
  "attachmentUrl",
  "photoUri",
  "uploadedMediaUri",
  "coverImage",
  "coverImageUrl",
  "image",
  "photo",
] as const;

function collectImageCandidateFields(item: any): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of IMAGE_CANDIDATE_KEYS) {
    const value = String(item?.[key] || "").trim();
    if (value) fields[key] = value;
  }
  if (Array.isArray(item?.images)) {
    item.images.forEach((entry: unknown, index: number) => {
      const value = String(entry || "").trim();
      if (value) fields[`images[${index}]`] = value;
    });
  }
  if (Array.isArray(item?.mediaUrls)) {
    item.mediaUrls.forEach((entry: unknown, index: number) => {
      const value = String(entry || "").trim();
      if (value) fields[`mediaUrls[${index}]`] = value;
    });
  }
  return fields;
}

type Props = {
  item: any;
  height: number;
  isActive: boolean;
  videoWarmMode: HomeFeedVideoWarmMode;
  screenFocused: boolean;
  feedIndex?: number;
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
  feedIndex = -1,
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
  const hasVideo = Boolean(videoUri);
  const hasImage = Boolean(resolvedImageUri) && !item?.videoUrl;
  const willRenderImage = hasImage;
  const churchRoomTextCard = churchRoomPost && !hasVideo && !hasImage;
  const posterUri = resolvePosterUri(item);
  const mediaStatus = String(item?.mediaStatus || item?.status || "").trim();
  const mountVideoPlayer = Boolean(
    video && videoUri && videoWarmMode !== "off" && screenFocused
  );
  const shareCount = Number(item?.shareCount || 0);
  const saveCount = Number(item?.saveCount || 0);
  const animateCopy = isActive && screenFocused;
  const lastImageDiagKeyRef = useRef("");

  useEffect(() => {
    const isTargetPost =
      churchRoomPost || postAccent === "testimony" || postAccent === "announcement";
    if (!isTargetPost) return;

    const candidateFields = collectImageCandidateFields(item);
    if (Object.keys(candidateFields).length === 0) return;

    const diagKey = [
      postId,
      resolvedImageUri,
      hasImage ? 1 : 0,
      willRenderImage ? 1 : 0,
      Object.keys(candidateFields).join(","),
    ].join(":");
    if (diagKey === lastImageDiagKeyRef.current) return;
    lastImageDiagKeyRef.current = diagKey;

    console.log("KRISTO_IMAGE_POST_DIAG", {
      id: postId || null,
      accent: postAccent,
      source: String(item?.source || item?.kind || "").trim() || null,
      mediaType: String(item?.mediaType || "").trim() || null,
      candidateFields,
      resolvedImageUri: resolvedImageUri || null,
      hasImage,
      willRenderImage,
      churchRoomTextCard,
    });
  }, [
    item,
    postId,
    postAccent,
    churchRoomPost,
    resolvedImageUri,
    hasImage,
    willRenderImage,
    churchRoomTextCard,
  ]);

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
              feedIndex={feedIndex}
              contentLength={Number(item?.sizeBytes || item?.fileSizeBytes || 0) || undefined}
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
          <ImagePostCard
            imageUri={resolvedImageUri}
            fallback={
              churchRoomPost ? (
                <ChurchRoomTextCard
                  title={postTitle}
                  caption={caption}
                  accent={postAccent}
                />
              ) : undefined
            }
          />
        ) : churchRoomTextCard ? (
          <ChurchRoomTextCard title={postTitle} caption={caption} accent={postAccent} />
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

function ChurchRoomTextCard({
  title,
  caption,
  accent,
}: {
  title: string;
  caption: string;
  accent: HomeFeedPostAccent;
}) {
  const isTestimony = accent === "testimony";
  const isAnnouncement = accent === "announcement";
  const cardText = String(caption || title || "").trim() || " ";
  const headline = String(title || "").trim();

  return (
    <LinearGradient
      colors={
        isTestimony
          ? ["#071018", "#0B1A2E", "#102847"]
          : isAnnouncement
            ? ["#0A0C12", "#15120A", "#1A2230"]
            : ["#0A0C12", "#121824", "#1A2230"]
      }
      style={styles.churchRoomCard}
    >
      <View
        style={[
          styles.churchRoomCardInner,
          {
            borderColor: isTestimony
              ? "rgba(0,145,255,0.28)"
              : "rgba(217,179,95,0.28)",
          },
        ]}
      >
        {headline && headline !== cardText ? (
          <Text style={styles.churchRoomTitle}>{headline}</Text>
        ) : null}
        <Text style={styles.churchRoomBody}>{cardText}</Text>
      </View>
    </LinearGradient>
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
  churchRoomCard: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingBottom: 160,
  },
  churchRoomCardInner: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 28,
    backgroundColor: "rgba(255,255,255,0.04)",
    gap: 12,
  },
  churchRoomTitle: {
    color: "rgba(244,208,111,0.98)",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
  },
  churchRoomBody: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
  },
  textBody: {
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
  },
});
