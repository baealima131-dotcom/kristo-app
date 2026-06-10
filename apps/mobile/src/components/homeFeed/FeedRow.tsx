import React, { memo, useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeFeedVideoPlayer, type HomeFeedVideoRole } from "./HomeFeedVideoPlayer";
import { ImagePostCarousel } from "./ImagePostCarousel";
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
  resolvePostImageUris,
  resolvePostBody,
  resolvePostTitle,
  resolvePosterUri,
  resolveVideoUri,
  snapshotPosterMetadata,
  logImagePostRenderDiag,
  isValidVideoPosterUri,
  hasBrandedVideoPoster,
  hasHomeFeedVideoPoster,
  type HomeFeedPostAccent,
} from "./homeFeedUtils";
import { VideoPostFallbackPoster, FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import type { HomeFeedVideoWarmMode } from "@/src/lib/homeFeedVideoWindow";
import { resolveHomeFeedVideoUri } from "@/src/lib/homeFeedVideoStartup";
import { resolveVideoDurationMs } from "@/src/lib/mediaVideoPoster";

/**
 * Map the mount-window warm mode to the player's 3-state role. Everything that
 * is mounted but not active is buffer-only ("preload"); the player never plays
 * a non-active row. Off rows are not mounted at all.
 */
function warmModeToRole(mode: HomeFeedVideoWarmMode): HomeFeedVideoRole {
  if (mode === "active") return "active";
  if (mode === "off") return "inactive";
  return "preload";
}

const IMAGE_CANDIDATE_KEYS = [
  "mediaUri",
  "imageUrl",
  "imageUri",
  "mediaUrl",
  "attachmentUrl",
  "photoUri",
  "photoUrl",
  "uploadedMediaUri",
  "coverImage",
  "coverImageUrl",
  "image",
  "photo",
  "url",
] as const;

function collectImageCandidateFields(item: any): Record<string, string> {
  const fields: Record<string, string> = {};
  const roots = [item, item?.payload].filter((entry) => entry && typeof entry === "object");
  for (const root of roots) {
    for (const key of IMAGE_CANDIDATE_KEYS) {
      const value = String(root?.[key] || "").trim();
      if (value) fields[key] = value;
    }
    if (Array.isArray(root?.images)) {
      root.images.forEach((entry: unknown, index: number) => {
        const value = String(entry || "").trim();
        if (value) fields[`images[${index}]`] = value;
      });
    }
    if (Array.isArray(root?.mediaUrls)) {
      root.mediaUrls.forEach((entry: unknown, index: number) => {
        const value = String(entry || "").trim();
        if (value) fields[`mediaUrls[${index}]`] = value;
      });
    }
    if (Array.isArray(root?.attachments)) {
      root.attachments.forEach((entry: unknown, index: number) => {
        if (typeof entry === "string") {
          const value = String(entry || "").trim();
          if (value) fields[`attachments[${index}]`] = value;
          return;
        }
        if (!entry || typeof entry !== "object") return;
        const att = entry as Record<string, unknown>;
        for (const key of ["url", "uri", "imageUrl", "mediaUrl", "publicUrl"]) {
          const value = String(att[key] || "").trim();
          if (value) fields[`attachments[${index}].${key}`] = value;
        }
      });
    }
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
  isFirstFeedVideo?: boolean;
  decodePrime?: boolean;
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
  isFirstFeedVideo = false,
  decodePrime = false,
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
  const playbackUri = useMemo(() => resolveHomeFeedVideoUri(item), [item]);
  const postImageUris = useMemo(() => resolvePostImageUris(item), [item]);
  const resolvedImageUri = postImageUris[0] || "";
  const showVideoMedia = Boolean(video && videoUri);
  const willRenderImage = postImageUris.length > 0 && !showVideoMedia;
  const churchRoomTextCard = churchRoomPost && !showVideoMedia && !willRenderImage;
  const posterUri = resolvePosterUri(item);
  const posterMetadata = useMemo(() => snapshotPosterMetadata(item), [item]);
  const videoDurationMs = useMemo(() => resolveVideoDurationMs(item), [item]);
  const mediaStatus = String(item?.mediaStatus || item?.status || "").trim();
  // Keep warm-window players mounted while Home is blurred so AVPlayer buffer,
  // readiness cache, and first-frame state survive tab switches.
  const mountVideoPlayer = Boolean(video && videoUri && videoWarmMode !== "off");
  const shareCount = Number(item?.shareCount || 0);
  const saveCount = Number(item?.saveCount || 0);
  const animateCopy = isActive && screenFocused;
  const lastImageDiagKeyRef = useRef("");

  useEffect(() => {
    if (!postId || !willRenderImage) return;
    console.log("KRISTO_IMAGE_CAROUSEL_RESOLVE", {
      postId,
      imageCount: postImageUris.length,
      uris: postImageUris,
    });
  }, [postId, postImageUris, willRenderImage]);

  useEffect(() => {
    const diagKey = [
      postId,
      resolvedImageUri,
      postImageUris.length,
      willRenderImage ? 1 : 0,
      showVideoMedia ? 1 : 0,
    ].join(":");
    if (diagKey === lastImageDiagKeyRef.current) return;
    lastImageDiagKeyRef.current = diagKey;

    logImagePostRenderDiag(item, resolvedImageUri, showVideoMedia);
  }, [item, postId, postImageUris.length, resolvedImageUri, willRenderImage, showVideoMedia]);

  return (
    <View style={[styles.slide, { height }]}>
      <View style={styles.media} pointerEvents="box-none">
        {showVideoMedia ? (
          mountVideoPlayer ? (
            <HomeFeedVideoPlayer
              key={`feed-video-${String(item?.homeFeedRecycleKey || postId)}`}
              postId={postId}
              recycleKey={String(item?.homeFeedRecycleKey || "")}
              uri={playbackUri}
              title={title}
              mediaStatus={mediaStatus}
              posterUri={posterUri}
              posterMetadata={posterMetadata}
              videoDurationMs={videoDurationMs}
              brandedPoster={hasBrandedVideoPoster(item)}
              role={warmModeToRole(videoWarmMode)}
              screenFocused={screenFocused}
              feedIndex={feedIndex}
              isFirstFeedVideo={isFirstFeedVideo}
              decodePrime={decodePrime}
              feedFaststart={
                item?.faststart === true || item?.hasFaststart === true
                  ? true
                  : item?.faststart === false
                    ? false
                    : null
              }
              onDoubleTap={onLike}
            />
          ) : (
            <InactiveVideoPoster
              item={item}
              postId={postId}
              title={title}
              mediaStatus={mediaStatus}
              posterUri={posterUri}
              posterMetadata={posterMetadata}
              videoDurationMs={videoDurationMs}
              videoUri={videoUri}
            />
          )
        ) : willRenderImage ? (
          <ImagePostCarousel
            postId={postId}
            imageUris={postImageUris}
            accent={postAccent}
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
  posterMetadata,
  videoDurationMs,
  videoUri,
}: {
  item: any;
  postId: string;
  title: string;
  mediaStatus: string;
  posterUri: string;
  posterMetadata: ReturnType<typeof snapshotPosterMetadata>;
  videoDurationMs?: number;
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
          posterMetadata={posterMetadata}
          videoDurationMs={videoDurationMs}
          enableVideoFrameFallback
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
    zIndex: 1,
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
