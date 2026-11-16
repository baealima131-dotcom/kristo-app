import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { WebView } from "react-native-webview";
import {
  buildFacebookSdkPlayerHtml,
  buildYouTubePlayerHtml,
  parseExternalPlayerMessage,
  YOUTUBE_CLIENT_ORIGIN,
  youtubeVideoIdFromUrl,
} from "@/src/lib/externalVideoPlayerHtml";
import {
  facebookOpenUrl,
  isFacebookPlayerHost,
  parseFacebookVideoUrl,
  isFacebookVideoLinkItem,
  isVerticalFacebookVideoItem,
  externalCountLabel,
  externalPlatformHiddenCounts,
  resolveExternalPlatformStats,
  facebookCoverWithFallback,
  externalCountDisplay,
  externalPlatformCount,
} from "@/src/lib/facebookVideoLink";
import { recordQualifiedHomeFeedPostView, useHomeFeedPostViewCount } from "@/src/lib/homeFeedPostViews";
import {
  safePauseVideoPlayer,
  safePlayVideoPlayer,
  safeSeekVideoPlayer,
} from "@/src/lib/expoVideoPlayerSafe";
import { useEventListener } from "expo";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import {
  hydrateAndCacheWatchVideo,
  resolveHomeFeedPlaybackUri,
  scheduleWatchNextVideoDiskCache,
} from "@/src/lib/homeFeedVideoDiskCache";
import { hydrateMediaPosterCacheForPlayback, resolveCachedMediaPoster } from "@/src/lib/mediaPosterCache";
import { resolveSavedFeedVideoPosterUri } from "@/src/lib/homeFeedPosterSavedUri";
import { resolveHomeFeedVideoUri } from "@/src/lib/homeFeedVideoStartup";
import {
  notifyWatchPlaybackActive,
  notifyWatchPlaybackPaused,
  notifyWatchScreenClosed,
  notifyWatchScreenOpened,
} from "@/src/lib/homeFeedWatchPlaybackPriority";
import {
  clearHomeFeedVideoProgress,
  peekHomeFeedVideoRestoreSeek,
  saveHomeFeedVideoProgress,
} from "@/src/lib/homeFeedVideoProgressStore";
import { CINZEL_SEMIBOLD_FAMILY } from "@/src/lib/cinzelFont";
import {
  fetchProfileCommunicationInboxSnapshot,
  formatProfileCommunicationBadgeCount,
} from "@/src/lib/profileCommunicationInbox";
import {
  YOUTUBE_CARD_H_PADDING,
  resolveWatchPlayerHeight,
} from "@/src/lib/homeFeedYouTubeLayout";
import {
  defaultHomeFeedVideoAspectRatio,
  resolveHomeFeedVideoAspectRatio,
  resolveHomeFeedVideoDisplayType,
  resolveHomeFeedVideoDisplayTypeFromDimensions,
  resolveHomeFeedVideoDisplayTypeHint,
  type HomeFeedVideoDisplayType,
} from "@/src/lib/homeFeedVideoDisplayType";
import { resolveVideoDurationMs } from "@/src/lib/mediaVideoPoster";
import {
  formatFeedTimestamp,
  isChurchRoomMemberFeedPost,
  resolveChurchName,
  resolveFeedPostTypeTitle,
  resolveHomeFeedVideoTitle,
  resolveVideoUri,
} from "./homeFeedUtils";
import { FeedChurchBrandRow } from "./FeedChurchBrandRow";
import { FeedYouTubeCard } from "./FeedYouTubeCard";
import {
  SokoHomeProductCard,
  type SokoHomeProduct,
} from "./SokoHomeProducts";
import { FeedCommentsSheet } from "./FeedCommentsSheet";
import { FeedReportSheet } from "./FeedReportSheet";
import { HomeFeedShareSheet } from "./HomeFeedShareSheet";
import { ShareToChatSheet } from "./ShareToChatSheet";
import { useHomeFeedRowEngagement } from "@/src/lib/homeFeedEngagement";
import type { HomeFeedSharePayload } from "@/src/lib/homeFeedShare";
import { FeedVideoCover, FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import { formatActionCount } from "./homeFeedUtils";
import {
  HOME_FEED_BG,
  HOME_FEED_BORDER,
  HOME_FEED_GOLD,
  HOME_FEED_GOLD_SOFT,
  HOME_FEED_MUTED,
} from "./theme";

const AVATAR_SIZE = 46;
const WATCH_ACTION_ICON_SIZE = 26;
const WATCH_PANEL_BORDER_TOP = "rgba(244, 208, 111, 0.30)";
const WATCH_PANEL_BORDER_BOTTOM = "rgba(168, 85, 247, 0.38)";
const WATCH_DATE_COLOR = "rgba(255,255,255,0.45)";
const AVATAR_RING_SIZE = AVATAR_SIZE + 6;
const WATCH_PANEL_TOP_RADIUS = 38;

type Props = {
  visible: boolean;
  payload: HomeFeedVideoOpenPayload | null;
  relatedItems: any[];
  /** Called when the viewer scrolls near the end of Up Next, to add more videos. */
  onUpNextEndReached?: () => void;
  sokoProducts: SokoHomeProduct[];
  onClose: () => void;
  onSelectRelated: (payload: HomeFeedVideoOpenPayload) => void;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
  onItemLike: (item: any) => void;
  onItemComment: (item: any) => void;
  onItemShare: (item: any) => void;
  onItemSave: (item: any) => void;
  onItemReport: (item: any) => void;
  commentsSheetOpen: boolean;
  commentTargetPostId: string;
  commentRailCount: number;
  onCloseComments: () => void;
  onDiscussionCountChange: (postId: string, count: number) => void;
  onDiscussionCountBump: (postId: string, delta: number) => void;
  reportSheetOpen: boolean;
  reportTargetPostId: string;
  reportTargetItem: any;
  onCloseReport: () => void;
  onReported: (postId: string) => void;
  shareSheetOpen: boolean;
  sharePayload: HomeFeedSharePayload | null;
  onCloseShare: () => void;
  onOpenShareToChat: () => void;
  shareToChatOpen: boolean;
  shareSourceItem: any;
  onCloseShareToChat: () => void;
};

function WatchPanelActions({
  item,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: {
  item: any;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
}) {
  const engagement = useHomeFeedRowEngagement(item);
  const externalVideo = String(item?.source || "").trim() === "system-admin-video-link";
  // Facebook: Graph counts first, then counts a System Admin entered; others unchanged.
  const platformStats = externalVideo ? resolveExternalPlatformStats(item) : {};
  const platformCount = (value: unknown) => {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  };
  const likeCount = engagement.likeCount + platformCount((platformStats as any).likes ?? (platformStats as any).likeCount);
  const commentCount = engagement.commentCount + platformCount((platformStats as any).comments ?? (platformStats as any).commentCount);
  // YouTube hid likes or turned comments off: say so instead of showing 0.
  const hiddenCounts = externalVideo ? externalPlatformHiddenCounts(item) : { likes: false, comments: false };
  // Video links: platform views (e.g. YouTube) plus Kristo views, in this bar with likes/comments.
  const kristoViewCount = useHomeFeedPostViewCount(String(item?.id || "").trim(), Number(item?.viewCount || 0));
  // Video links: real platform counts plus Kristo's own; "—" when the platform gave none.
  const likeLabel = externalVideo
    ? externalCountDisplay(engagement.likeCount, externalPlatformCount(item, "likes"), hiddenCounts.likes, formatActionCount)
    : externalCountLabel(likeCount, hiddenCounts.likes, formatActionCount);
  const commentLabel = externalVideo
    ? externalCountDisplay(engagement.commentCount, externalPlatformCount(item, "comments"), hiddenCounts.comments, formatActionCount)
    : externalCountLabel(commentCount, hiddenCounts.comments, formatActionCount);
  const viewLabel = externalCountDisplay(kristoViewCount, externalPlatformCount(item, "views"), false, formatActionCount);

  return (
    <View style={styles.watchActionsRow}>
      <WatchPanelAction
        icon={engagement.likedByMe || engagement.liked ? "heart" : "heart-outline"}
        label={likeLabel}
        countLabel
        active={engagement.likedByMe || engagement.liked}
        activeColor="#FF6B8A"
        onPress={onLike}
      />
      <WatchPanelAction
        icon="chatbubble-ellipses-outline"
        label={commentLabel}
        countLabel
        onPress={onComment}
      />
      {externalVideo ? (
        <WatchPanelStat icon="play-circle-outline" label={viewLabel} accessibilityLabel="Views" />
      ) : null}
      <WatchPanelAction
        icon="arrow-redo-outline"
        // Video links: Share shows its icon only, with no number.
        label={externalVideo ? "" : formatActionCount(Number(item?.shareCount || 0))}
        onPress={onShare}
      />
      <WatchPanelAction
        icon={engagement.saved ? "bookmark" : "bookmark-outline"}
        label={engagement.saved ? "Saved" : "Save"}
        active={engagement.saved}
        onPress={onSave}
      />
      <WatchPanelAction
        icon={engagement.reported ? "flag" : "flag-outline"}
        label={engagement.reported ? "Reported" : "Report"}
        active={engagement.reported}
        onPress={onReport}
      />
    </View>
  );
}

function WatchPanelAction({
  icon,
  label,
  onPress,
  active,
  activeColor = HOME_FEED_GOLD_SOFT,
  countLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  /** Like and comment numbers: larger digits in the same line height. */
  countLabel?: boolean;
}) {
  return (
    <Pressable style={styles.watchAction} onPress={onPress} hitSlop={8}>
      <Ionicons
        name={icon}
        size={WATCH_ACTION_ICON_SIZE}
        color={active ? activeColor : "rgba(255,255,255,0.68)"}
      />
      <Text
        style={[
          styles.watchActionLabel,
          countLabel ? styles.watchActionCountLabel : null,
          active ? styles.watchActionLabelActive : null,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A count shown in the Watch bar that is not a button (video links: views). */
function WatchPanelStat({
  icon,
  label,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.watchAction} accessible accessibilityLabel={`${accessibilityLabel}: ${label}`}>
      <Ionicons name={icon} size={WATCH_ACTION_ICON_SIZE} color="rgba(255,255,255,0.68)" />
      <Text style={[styles.watchActionLabel, styles.watchActionCountLabel]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function WatchVideoEngagementActions({
  item,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: {
  item: any;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
}) {
  return (
    <WatchPanelActions
      item={item}
      onLike={onLike}
      onComment={onComment}
      onShare={onShare}
      onSave={onSave}
      onReport={onReport}
    />
  );
}

function resolveWatchScreenPlaybackUri(payload: HomeFeedVideoOpenPayload): string {
  const fromPayload = String(payload.videoUri || "").trim();
  const remoteUri =
    fromPayload || (payload.item ? resolveHomeFeedVideoUri(payload.item) : "");
  if (!remoteUri) return "";
  return resolveHomeFeedPlaybackUri(remoteUri) || remoteUri;
}

function buildWatchVideoPlayerSource(uri: string) {
  const trimmed = String(uri || "").trim();
  if (!trimmed) return null;
  return {
    uri: trimmed,
    contentType: trimmed.startsWith("file://") ? ("auto" as const) : ("progressive" as const),
  };
}

/** Height (px) of the purple line left under the video when the panel is folded. */
const WATCH_PANEL_FOLDED_LINE = 4;

function WatchVideoSurface({
  payload,
  displayType,
  videoAspect,
  frameWidth,
  frameHeight,
  onPlaybackStarted,
  onDisplayTypeDetected,
}: {
  payload: HomeFeedVideoOpenPayload;
  displayType?: HomeFeedVideoDisplayType | null;
  /** Width / height of the video itself (metadata, then the playing track, then the family default). */
  videoAspect: number;
  frameWidth: number;
  frameHeight: number;
  onPlaybackStarted?: () => void;
  onDisplayTypeDetected?: (displayType: HomeFeedVideoDisplayType, aspect: number) => void;
}) {
  const item = payload.item;
  const postId = String(payload.postId || "").trim();
  const playbackUri = resolveWatchScreenPlaybackUri(payload);
  const durationSec = useMemo(() => {
    const ms =
      payload.videoDurationMs ??
      (item ? resolveVideoDurationMs(item) : undefined);
    const sec = Number(ms) / 1000;
    return Number.isFinite(sec) && sec > 0 ? sec : null;
  }, [payload.videoDurationMs, item]);
  const [ended, setEnded] = useState(false);
  const endedRef = useRef(false);
  const userPausedRef = useRef(false);
  const backgroundPausedRef = useRef(false);
  const onPlaybackStartedRef = useRef(onPlaybackStarted);
  onPlaybackStartedRef.current = onPlaybackStarted;
  const onDisplayTypeDetectedRef = useRef(onDisplayTypeDetected);
  onDisplayTypeDetectedRef.current = onDisplayTypeDetected;

  const reportTrackDisplayType = useCallback((track: any) => {
    const width = Number(track?.size?.width || 0);
    const height = Number(track?.size?.height || 0);
    const detected = resolveHomeFeedVideoDisplayTypeFromDimensions(width, height);
    if (detected) onDisplayTypeDetectedRef.current?.(detected, width / height);
  }, []);

  // Portrait videos: the video view gets the exact size of the video inside the frame ("contain"),
  // so the whole picture shows in its own proportions, never cropped and never squeezed. The
  // poster backdrop fills the rest of the frame.
  const containedVideoSize = useMemo(() => {
    const aspect = Number.isFinite(videoAspect) && videoAspect > 0 ? videoAspect : 4 / 5;
    const w = Math.max(1, frameWidth);
    const h = Math.max(1, frameHeight);
    return aspect > w / h
      ? { width: w, height: Math.round(w / aspect) }
      : { width: Math.round(h * aspect), height: h };
  }, [videoAspect, frameWidth, frameHeight]);

  const isTikTokLayout = displayType === "tiktok";

  const isWatchAutoPlayBlocked = useCallback(
    () => userPausedRef.current || backgroundPausedRef.current,
    []
  );

  const tryWatchAutoPlay = useCallback(
    (
      target: ReturnType<typeof useVideoPlayer>,
      meta: { source: string; uri: string }
    ) => {
      if (isWatchAutoPlayBlocked()) return;
      safePlayVideoPlayer(target, meta);
    },
    [isWatchAutoPlayBlocked]
  );

  useEffect(() => {
    console.log("KRISTO_WATCH_BACKDROP_DIAG", {
      postId,
      isTikTokLayout,
      playbackUri,
      hasItem: Boolean(item),
      displayType: item ? resolveHomeFeedVideoDisplayType(item) : null,
    });
  }, [postId, isTikTokLayout, playbackUri, item]);


  const player = useVideoPlayer(
    playbackUri ? buildWatchVideoPlayerSource(playbackUri) : null,
    (p) => {
      p.loop = false;
      p.muted = false;
    }
  );

  const backdropPlayer = useVideoPlayer(
    playbackUri ? buildWatchVideoPlayerSource(playbackUri) : null,
    (p) => {
      p.loop = true;
      p.muted = true;
    }
  );

  const playerRef = useRef(player);
  const backdropPlayerRef = useRef(backdropPlayer);
  playerRef.current = player;
  backdropPlayerRef.current = backdropPlayer;

  useEventListener(player, "videoTrackChange", (event: any) => {
    reportTrackDisplayType(event?.videoTrack);
  });
  useEventListener(player, "statusChange", () => {
    reportTrackDisplayType((player as any)?.videoTrack);
  });

  useEffect(() => {
    reportTrackDisplayType((player as any)?.videoTrack);
  }, [player, reportTrackDisplayType]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") return;
      backgroundPausedRef.current = true;
      const uri = playbackUri;
      safePauseVideoPlayer(backdropPlayerRef.current, {
        source: "home-feed-watch-backdrop",
        uri,
      });
      safePauseVideoPlayer(playerRef.current, { source: "home-feed-watch", uri });
      notifyWatchPlaybackPaused(postId);
    });
    return () => sub.remove();
  }, [playbackUri, postId]);

  useEffect(() => {
    endedRef.current = ended;
  }, [ended]);

  useEventListener(player, "playToEnd", () => {
    endedRef.current = true;
    clearHomeFeedVideoProgress(postId);
    setEnded(true);
    notifyWatchPlaybackPaused(postId);
  });

  useEffect(() => {
    if (!playbackUri) return;
    setEnded(false);
    endedRef.current = false;
    userPausedRef.current = false;
    backgroundPausedRef.current = false;

    let cancelled = false;
    const source = buildWatchVideoPlayerSource(playbackUri);
    if (!source) return;

    void (async () => {
      try {
        const activePlayer = playerRef.current;
        const activeBackdrop = backdropPlayerRef.current;
        if (!activePlayer) return;

        const currentUri = String((activePlayer as any)?.source?.uri || "").trim();
        const needsReplace = Boolean(currentUri && currentUri !== playbackUri);

        if (needsReplace) {
          if (typeof activePlayer.replaceAsync === "function") {
            console.log("KRISTO_WATCH_VIDEO_REPLACE_ASYNC_START", {
              postId,
              playbackUri,
              currentUri,
              at: Date.now(),
            });
            await activePlayer.replaceAsync(source);
            if (cancelled) return;
            console.log("KRISTO_WATCH_VIDEO_REPLACE_ASYNC_END", {
              postId,
              at: Date.now(),
            });
          } else {
            console.log("KRISTO_WATCH_VIDEO_REPLACE_FALLBACK_SYNC", {
              postId,
              playbackUri,
              currentUri,
              at: Date.now(),
            });
            activePlayer.replace(source);
            if (cancelled) return;
          }
        }

        if (cancelled || isWatchAutoPlayBlocked()) {
          safePauseVideoPlayer(activeBackdrop, {
            source: "home-feed-watch-backdrop",
            uri: playbackUri,
          });
          safePauseVideoPlayer(activePlayer, { source: "home-feed-watch", uri: playbackUri });
          return;
        }

        tryWatchAutoPlay(activePlayer, { source: "home-feed-watch", uri: playbackUri });
        if (isWatchAutoPlayBlocked()) return;

        notifyWatchPlaybackActive(postId);
        onPlaybackStartedRef.current?.();
      } catch {}
    })();

    return () => {
      cancelled = true;
      safePauseVideoPlayer(backdropPlayerRef.current, {
        source: "home-feed-watch-backdrop",
        uri: playbackUri,
      });
      safePauseVideoPlayer(playerRef.current, { source: "home-feed-watch", uri: playbackUri });
    };
  }, [playbackUri, postId, displayType, tryWatchAutoPlay, isWatchAutoPlayBlocked]);

  useEffect(() => {
    let lastPlaying: boolean | null = null;
    let stopped = false;

    const poll = setInterval(() => {
      if (stopped || ended) return;

      let playing = false;

      try {
        playing = Boolean((playerRef.current as any)?.playing);
      } catch {
        console.log("KRISTO_HOME_FEED_WATCH_PLAYER_RELEASED", {
          postId,
          reason: "native-shared-object-missing",
        });

        stopped = true;
        clearInterval(poll);
        return;
      }

      if (playing === lastPlaying) return;

      if (!playing && lastPlaying === true) {
        if (!backgroundPausedRef.current) {
          userPausedRef.current = true;
        }
      } else if (playing && lastPlaying === false) {
        if (userPausedRef.current || backgroundPausedRef.current) {
          userPausedRef.current = false;
          backgroundPausedRef.current = false;
        }
      }

      lastPlaying = playing;

      if (playing) {
        notifyWatchPlaybackActive(postId);
      } else {
        notifyWatchPlaybackPaused(postId);
      }
    }, 400);

    return () => {
      stopped = true;
      clearInterval(poll);
    };
  }, [postId, ended]);

  useEffect(() => {
    if (!player || !postId) return;

    let stopped = false;
    let restored = false;

    const restoreSeek = () => {
      if (stopped || restored || endedRef.current) return;
      const seekTo = peekHomeFeedVideoRestoreSeek(postId, durationSec);
      if (seekTo == null || seekTo <= 0.1) return;

      try {
        (player as any).currentTime = seekTo;
        restored = true;
        console.log("KRISTO_WATCH_VIDEO_PROGRESS_RESTORE", { postId, seekTo });
      } catch (error: any) {
        console.log("KRISTO_WATCH_VIDEO_PROGRESS_RESTORE_FAILED", {
          postId,
          error: String(error?.message || error || "unknown"),
        });
      }
    };

    const saveProgress = () => {
      if (stopped || endedRef.current) return;
      try {
        const t = Number((player as any)?.currentTime || 0);
        if (Number.isFinite(t) && t > 0.5) {
          saveHomeFeedVideoProgress(postId, t, durationSec);
        }
      } catch {}
    };

    const restoreTimer = setTimeout(restoreSeek, 250);
    const progressTimer = setInterval(saveProgress, 1000);

    return () => {
      stopped = true;
      clearTimeout(restoreTimer);
      clearInterval(progressTimer);
      if (!endedRef.current) {
        saveProgress();
      }
    };
  }, [player, postId, durationSec]);

  const handleReplay = useCallback(() => {
    clearHomeFeedVideoProgress(postId);
    console.log("KRISTO_WATCH_VIDEO_REPLAY_FROM_START", { postId });
    setEnded(false);
    endedRef.current = false;
    userPausedRef.current = false;
    backgroundPausedRef.current = false;
    safeSeekVideoPlayer(player, 0, { source: "home-feed-watch", uri: playbackUri });
    safePlayVideoPlayer(player, { source: "home-feed-watch", uri: playbackUri });
    notifyWatchPlaybackActive(postId);
  }, [player, postId, playbackUri]);

  const churchName = item ? resolveChurchName(item) : "";
  const churchRoomPost = Boolean(item && isChurchRoomMemberFeedPost(item));
  const title =
    item && churchRoomPost
      ? resolveFeedPostTypeTitle(item)
      : item
        ? resolveHomeFeedVideoTitle(item)
        : payload.title;
  const videoUri = item ? resolveVideoUri(item) || payload.videoUri : payload.videoUri;
  const videoDurationMs = payload.videoDurationMs ?? (item ? resolveVideoDurationMs(item) : undefined);
  const mediaStatus = String(item?.mediaStatus || item?.status || "").trim();
  // Cover shown over the player when the video ends: the saved cover, else the picture the feed
  // card already showed for this video.
  const endCoverUri = ended
    ? String(
        (item ? resolveSavedFeedVideoPosterUri(item, videoUri) : "") ||
          resolveCachedMediaPoster(postId, videoUri || "") ||
          ""
      ).trim()
    : "";

  if (!playbackUri) return null;

  return (
    <View style={styles.playerSurface}>
      {!ended && displayType !== "youtube" ? (
        <>
          <View style={styles.tikTokVideoBackdrop} pointerEvents="none">
            {item ? (
              <FeedVideoPosterImage
                item={item}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
                postId={postId}
                title={title}
                churchName={churchName}
                videoUrl={videoUri}
                mediaStatus={mediaStatus}
                videoDurationMs={videoDurationMs}
                enableVideoFrameFallback={false}
              />
            ) : null}
          </View>
          <View style={styles.tikTokBackdropOverlay} pointerEvents="none" />
        </>
      ) : null}
      {!ended ? (
        <>
        <VideoView
          player={player}
          style={displayType === "youtube" ? styles.video : [styles.videoPortrait, containedVideoSize]}
          contentFit="contain"
          nativeControls
        />
        </>
      ) : null}
      {ended ? (
        <Pressable style={styles.replayOverlay} onPress={handleReplay} accessibilityLabel="Replay video">
          {endCoverUri ? (
            <FeedVideoCover uri={endCoverUri} dimColor="rgba(18,3,31,0.24)" />
          ) : item ? (
            <FeedVideoPosterImage
              item={item}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
              postId={postId}
              title={title}
              churchName={churchName}
              videoUrl={videoUri}
              mediaStatus={mediaStatus}
              videoDurationMs={videoDurationMs}
              enableVideoFrameFallback
              youtubeMode
            />
          ) : null}
          <View style={styles.replayBadgeWrap} pointerEvents="none">
            <View style={styles.replayBadge}>
              <Ionicons name="play" size={32} color="#FFFFFF" style={styles.replayIcon} />
            </View>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Current-video metadata — avatar, church, title, date. */
function buildExternalVideoEmbedUrl(item: any): string | null {
  const raw = String(item?.videoUrl || item?.url || "").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
      const videoId = host === "youtu.be"
        ? parsed.pathname.split("/").filter(Boolean)[0] || ""
        : parsed.pathname === "/watch"
          ? parsed.searchParams.get("v") || ""
          : parsed.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || "";
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      return `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&controls=1&rel=0&autoplay=1`;
    }
    if (["tiktok.com", "m.tiktok.com"].includes(host)) {
      const videoId = parsed.pathname.match(/^\/@[A-Za-z0-9._-]+\/video\/(\d+)(?:\/|$)/)?.[1] || "";
      if (!/^\d{8,24}$/.test(videoId)) return null;
      return `https://www.tiktok.com/player/v1/${videoId}?controls=1&description=1&music_info=1&autoplay=1&loop=0`;
    }
  } catch {}
  return null;
}

function allowExternalPlayerNavigation(request: { url: string; isTopFrame?: boolean }) {
  if (request.isTopFrame === false) return true;
  try {
    const next = new URL(request.url);
    if (next.protocol !== "https:") return false;
    const host = next.hostname.toLowerCase().replace(/^www\./, "");
    return ["youtube.com", "youtube-nocookie.com", "youtu.be", "tiktok.com", "m.tiktok.com"].includes(host);
  } catch {
    return false;
  }
}

const FACEBOOK_EMBED_BASE_URL = "https://kristo-app.vercel.app/watch/facebook-embed";
/** Facebook Reels are vertical (9:16) videos: they get the same Watch frame as uploaded vertical videos. */
const FACEBOOK_REEL_VIDEO_ASPECT = 9 / 16;

/** True for a Facebook Reel / vertical Facebook video link. */
function isFacebookVerticalItem(item: any): boolean {
  return isFacebookVideoLinkItem(item) && isVerticalFacebookVideoItem(item);
}

/** The Reel's cover set by a System Admin, else another picture saved on the post. */
function facebookBackdropImageUri(item: any): string {
  for (const raw of [item?.facebookCoverUrl, item?.thumbnailUrl, item?.thumbnailUri, item?.posterUri, item?.videoPosterUri]) {
    const value = String(raw || "").trim();
    // Local test servers in development builds may serve http; release builds accept https only.
    if (/^https:\/\//i.test(value) || (__DEV__ && /^http:\/\//i.test(value))) return value;
  }
  return "";
}

function openFacebookLink(item: any) {
  const target = facebookOpenUrl(item);
  if (target) void Linking.openURL(target).catch(() => {});
}

/** A picture usable as the video's cover in Watch (https; a local http test server in dev only). */
function usableCoverUri(raw: unknown): string {
  const value = String(raw || "").trim();
  return /^https:\/\//i.test(value) || (__DEV__ && /^http:\/\//i.test(value)) ? value : "";
}

type ExternalCover = { uri: string; contain: boolean };

/**
 * Cover shown over an external player while it opens and after it ends: the admin cover
 * (Facebook) or the video thumbnail; a Facebook link with neither uses its Page's picture, whole.
 */
function externalVideoCover(item: any): ExternalCover {
  for (const raw of [item?.facebookCoverUrl, item?.thumbnailUrl, item?.thumbnailUri, item?.posterUri, item?.videoPosterUri]) {
    const uri = usableCoverUri(raw);
    if (uri) return { uri, contain: false };
  }
  const facebook = facebookCoverWithFallback(item);
  return { uri: facebook.uri, contain: facebook.isPagePicture };
}

/** Longest wait for the player to report "playing" before the opening cover steps aside. */
const EXTERNAL_START_COVER_MAX_MS = 8000;

/**
 * Covers the player while it loads (instead of a black frame) until the video is playing.
 * Touches pass through to the player underneath.
 */
function ExternalVideoStartCover({ cover }: { cover: ExternalCover }) {
  if (!cover.uri) return null;
  return (
    <View style={[StyleSheet.absoluteFillObject, styles.externalEndCover]} pointerEvents="none">
      <FeedVideoCover uri={cover.uri} dimColor="rgba(18,3,31,0.18)" foregroundResizeMode={cover.contain ? "contain" : "cover"} />
    </View>
  );
}

/**
 * Covers the player when the video has ended (instead of the platform's end screen or
 * suggestions). A tap plays the same video again; the next video never starts by itself.
 */
function ExternalVideoEndCover({ cover, onReplay }: { cover: ExternalCover; onReplay: () => void }) {
  return (
    <Pressable
      style={[StyleSheet.absoluteFillObject, styles.externalEndCover]}
      onPress={onReplay}
      accessibilityRole="button"
      accessibilityLabel="Cheza video tena"
    >
      {cover.uri ? (
        <FeedVideoCover
          uri={cover.uri}
          dimColor="rgba(18,3,31,0.24)"
          foregroundResizeMode={cover.contain ? "contain" : "cover"}
        />
      ) : null}
      <View style={styles.externalEndReplayButton}>
        <Ionicons name="play" size={30} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

/** Messages from the player page: playing / ended / error. */
function useExternalPlayerState(resetKey: string) {
  const webViewRef = useRef<WebView>(null);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  // False until the player reports "playing": the opening cover stays over the black player.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    setEnded(false);
    setFailed(false);
    setStarted(false);
    const timer = setTimeout(() => setStarted(true), EXTERNAL_START_COVER_MAX_MS);
    return () => clearTimeout(timer);
  }, [resetKey]);
  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const message = parseExternalPlayerMessage(event?.nativeEvent?.data);
    if (!message) return;
    if (message.type === "ended") setEnded(true);
    if (message.type === "playing") {
      setEnded(false);
      setStarted(true);
    }
    if (message.type === "error") setFailed(true);
  }, []);
  const replay = useCallback(() => {
    setEnded(false);
    webViewRef.current?.injectJavaScript("window.kristoReplay && window.kristoReplay(); true;");
  }, []);
  return { webViewRef, ended, started, failed, setFailed, onMessage, replay };
}

/**
 * Plays a confirmed public Facebook video or Reel with Facebook's official Embedded Video Player
 * (JS SDK): it starts by itself in Watch, Facebook's controls hide while it plays and return on a
 * tap, and when it ends the post's cover covers the player (tap to play again). Reels keep 9:16,
 * centred over the cover blurred at the sides. If the embed cannot load, "Fungua Facebook" opens
 * the original link. Only oEmbed-confirmed public posts reach here.
 */
function WatchFacebookVideoSurface({ item }: { item: any }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const vertical = isFacebookVerticalItem(item);
  const playerSize = size && vertical
    ? { width: Math.min(size.width, Math.round(size.height * FACEBOOK_REEL_VIDEO_ASPECT)), height: size.height }
    : size;
  const href = parseFacebookVideoUrl(item?.videoUrl || item?.url)?.url || "";
  const html = playerSize && href ? buildFacebookSdkPlayerHtml(href, playerSize.width) : null;
  const backdropUri = vertical ? facebookBackdropImageUri(item) : "";
  const cover = externalVideoCover(item);
  const canOpen = Boolean(facebookOpenUrl(item));
  const { webViewRef, ended, started, failed, setFailed, onMessage, replay } = useExternalPlayerState(String(item?.id || ""));

  const allowNavigation = useCallback((request: { url: string; isTopFrame?: boolean }) => {
    if (request.url === "about:blank" || request.url.startsWith(FACEBOOK_EMBED_BASE_URL)) return true;
    try {
      const next = new URL(request.url);
      if (next.protocol !== "https:" || !isFacebookPlayerHost(next.hostname)) return false;
      // The player runs in its own frame; a link that would replace the page (title, page name,
      // "Watch on Facebook") opens in Facebook instead.
      if (request.isTopFrame === false) return true;
      void Linking.openURL(next.toString()).catch(() => {});
    } catch {}
    return false;
  }, []);

  const showPlayer = Boolean(html) && !failed;
  return (
    <View
      style={[styles.externalVideoSurface, vertical ? styles.facebookReelSurface : null]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0 && (!size || Math.abs(size.width - width) > 2 || Math.abs(size.height - height) > 2)) {
          setSize({ width, height });
        }
      }}
    >
      {vertical && showPlayer ? (
        <>
          {backdropUri ? (
            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              <FeedVideoCover uri={backdropUri} showForeground={false} dim={false} />
            </View>
          ) : null}
          <View style={styles.tikTokBackdropOverlay} pointerEvents="none" />
        </>
      ) : null}
      {showPlayer ? (
        <View
          style={
            vertical && playerSize
              ? [styles.facebookReelPlayer, { width: playerSize.width, height: playerSize.height }]
              : styles.facebookPlayerColumn
          }
        >
          <WebView
            ref={webViewRef}
            key={html!}
            source={{ html: html!, baseUrl: FACEBOOK_EMBED_BASE_URL }}
            style={styles.externalVideoWebView}
            containerStyle={styles.externalVideoWebViewContainer}
            originWhitelist={["https://*", "about:blank"]}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo
            scrollEnabled={false}
            bounces={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={allowNavigation}
            onMessage={onMessage}
            onError={() => setFailed(true)}
            onHttpError={() => setFailed(true)}
            accessibilityLabel="Facebook video player"
          />
        </View>
      ) : size && (failed || !html) ? (
        <View style={styles.externalVideoUnavailable}>
          <Ionicons name="logo-facebook" size={28} color="#FFFFFF" />
          <Text style={styles.externalVideoUnavailableText}>Video hii ya Facebook haiwezi kuchezwa hapa.</Text>
          {canOpen ? (
            <Pressable
              onPress={() => openFacebookLink(item)}
              style={styles.facebookOpenButton}
              accessibilityRole="button"
              accessibilityLabel="Fungua Facebook"
            >
              <Ionicons name="open-outline" size={16} color="#FFFFFF" />
              <Text style={styles.facebookOpenButtonText}>Fungua Facebook</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {showPlayer && !started && !ended ? <ExternalVideoStartCover cover={cover} /> : null}
      {showPlayer && ended ? <ExternalVideoEndCover cover={cover} onReplay={replay} /> : null}
    </View>
  );
}

/** Top-frame navigation away from YouTube's player page opens in YouTube instead of Watch. */
function allowYouTubePlayerNavigation(request: { url: string; isTopFrame?: boolean }) {
  if (request.url === "about:blank" || request.url.startsWith(YOUTUBE_CLIENT_ORIGIN)) return true;
  if (request.isTopFrame === false) return true;
  try {
    const next = new URL(request.url);
    const host = next.hostname.toLowerCase().replace(/^www\./, "");
    if (next.protocol === "https:" && ["youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) {
      void Linking.openURL(next.toString()).catch(() => {});
    }
  } catch {}
  return false;
}

/**
 * Public YouTube links play through YouTube's official IFrame Player API: the video starts by
 * itself in Watch without YouTube's control bar or fullscreen button; nothing is drawn over the
 * player (its cover sits behind it while loading and replaces it after the end), and when it ends
 * the cover replaces the player (tap to play again; nothing else starts by itself).
 */
function WatchYouTubeVideoSurface({ item, videoId }: { item: any; videoId: string }) {
  const cover = externalVideoCover(item);
  // The cover is the player page's own background (behind YouTube's player), never on top of it.
  const html = buildYouTubePlayerHtml(videoId, cover.uri);
  const { webViewRef, ended, failed, onMessage, replay } = useExternalPlayerState(`${item?.id || ""}:${videoId}`);
  // After the video ends the player is removed and the cover takes its place; replay loads a new player.
  const [playRound, setPlayRound] = useState(0);
  const replayFromCover = useCallback(() => {
    replay();
    setPlayRound((round) => round + 1);
  }, [replay]);
  return (
    <View style={styles.externalVideoSurface}>
      {html && !failed && !ended && cover.uri ? (
        // The cover sits behind the transparent WebView until the page and player draw.
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <FeedVideoCover uri={cover.uri} dim={false} foregroundResizeMode={cover.contain ? "contain" : "cover"} />
        </View>
      ) : null}
      {html && !failed && !ended ? (
        <WebView
          ref={webViewRef}
          key={`${videoId}:${playRound}`}
          source={{ html, baseUrl: YOUTUBE_CLIENT_ORIGIN }}
          style={cover.uri ? styles.externalVideoWebViewClear : styles.externalVideoWebView}
          containerStyle={cover.uri ? styles.externalVideoWebViewClear : styles.externalVideoWebViewContainer}
          originWhitelist={["https://*", "about:blank"]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          scrollEnabled={false}
          bounces={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={allowYouTubePlayerNavigation}
          onMessage={onMessage}
          accessibilityLabel="YouTube video player"
        />
      ) : html && !failed && ended ? (
        <ExternalVideoEndCover cover={cover} onReplay={replayFromCover} />
      ) : (
        <View style={styles.externalVideoUnavailable}>
          <Ionicons name="alert-circle-outline" size={26} color={HOME_FEED_GOLD} />
          <Text style={styles.externalVideoUnavailableText}>Video hii ya YouTube haiwezi kuchezwa hapa.</Text>
        </View>
      )}
    </View>
  );
}

/** Plays public YouTube/TikTok/Facebook links in Kristo's Watch view using the platforms' players. */
function WatchExternalVideoSurface({ item }: { item: any }) {
  if (isFacebookVideoLinkItem(item)) {
    return <WatchFacebookVideoSurface item={item} />;
  }
  const youtubeId = youtubeVideoIdFromUrl(item?.videoUrl || item?.url);
  if (youtubeId) {
    return <WatchYouTubeVideoSurface item={item} videoId={youtubeId} />;
  }
  // TikTok: its embed player (no public end-of-video event to place a cover).
  const embedUrl = buildExternalVideoEmbedUrl(item);
  return (
    <View style={styles.externalVideoSurface}>
      {embedUrl ? (
        <WebView
          key={embedUrl}
          source={{ uri: embedUrl }}
          style={styles.externalVideoWebView}
          containerStyle={styles.externalVideoWebViewContainer}
          originWhitelist={["https://*"]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          scrollEnabled={false}
          bounces={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={allowExternalPlayerNavigation}
          accessibilityLabel="TikTok video player"
        />
      ) : (
        <View style={styles.externalVideoUnavailable}>
          <Ionicons name="alert-circle-outline" size={26} color={HOME_FEED_GOLD} />
          <Text style={styles.externalVideoUnavailableText}>Link ya video haiwezi kuchezwa hapa.</Text>
        </View>
      )}
    </View>
  );
}

function WatchVideoMeta({ item, fallbackTitle = "" }: { item: any; fallbackTitle?: string }) {
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolveHomeFeedVideoTitle(item);
  const titleLine = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle || fallbackTitle;
  // Video links show the platform's publish date; the embed player reports no playback, so a
  // Kristo view is counted after 3 seconds on screen.
  const externalVideo = String(item?.source || "").trim().toLowerCase() === "system-admin-video-link";
  const whenLabel = externalVideo && item?.publishedAt
    ? new Date(String(item.publishedAt)).toLocaleDateString()
    : formatFeedTimestamp(item?.createdAt);
  const postId = String(item?.id || "").trim();
  const serverViewCount = Number(item?.viewCount || 0);
  // Video links: views show in the Watch bar with likes/comments, not on this date line.

  useEffect(() => {
    if (!externalVideo || !postId) return;
    const timer = setTimeout(() => {
      void recordQualifiedHomeFeedPostView({
        postId,
        serverCount: serverViewCount,
        dwellMs: 3000,
        mediaKind: "video",
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [externalVideo, postId, serverViewCount]);

  return (
    <View style={styles.metaRow}>
      <View style={styles.avatarRing}>
        <View style={styles.avatarGlow}>
          <FeedChurchBrandRow item={item} variant="watch" part="avatar" source="watch-screen" />
        </View>
      </View>
      <View style={styles.metaTextCol}>
        <FeedChurchBrandRow item={item} variant="watch" part="name" source="watch-screen" />
        {titleLine ? (
          <Text style={styles.videoTitle} numberOfLines={3}>
            {titleLine}
          </Text>
        ) : null}
        {whenLabel ? (
          <Text style={styles.dateMuted} numberOfLines={1}>
            {whenLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const HomeFeedWatchScreen = memo(function HomeFeedWatchScreen({
  visible,
  payload,
  relatedItems,
  onUpNextEndReached,
  sokoProducts,
  onClose,
  onSelectRelated,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
  onItemLike,
  onItemComment,
  onItemShare,
  onItemSave,
  onItemReport,
  commentsSheetOpen,
  commentTargetPostId,
  commentRailCount,
  onCloseComments,
  onDiscussionCountChange,
  onDiscussionCountBump,
  reportSheetOpen,
  reportTargetPostId,
  reportTargetItem,
  onCloseReport,
  onReported,
  shareSheetOpen,
  sharePayload,
  onCloseShare,
  onOpenShareToChat,
  shareToChatOpen,
  shareSourceItem,
  onCloseShareToChat,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height: windowHeight } = useWindowDimensions();
  const activePostId = String(payload?.postId || "").trim();
  const displayTypeHint = resolveHomeFeedVideoDisplayTypeHint(payload?.item || payload);
  // Width / height saved at upload. When it exists it decides the layout: the playing track can
  // report its size before rotation (e.g. a portrait phone video as 1920x1080) and would flip the
  // frame mid-play.
  const metadataAspect = resolveHomeFeedVideoAspectRatio(payload?.item || payload);
  const [detectedDisplayType, setDetectedDisplayType] = useState<{
    postId: string;
    type: HomeFeedVideoDisplayType;
    aspect: number;
  } | null>(null);
  const detectedForPost =
    metadataAspect == null && detectedDisplayType?.postId === activePostId ? detectedDisplayType : null;
  const detectedType = detectedForPost?.type ?? null;
  const displayType = detectedType || displayTypeHint;
  const isPortraitLayout = displayType !== "youtube";
  const isTikTokLayout = displayType === "tiktok";
  const videoAspect =
    metadataAspect ??
    detectedForPost?.aspect ??
    defaultHomeFeedVideoAspectRatio(displayType ?? "portrait45");
  const openMessages = useCallback(() => {
    onClose();
    requestAnimationFrame(() => router.push("/(tabs)/profile/messages" as any));
  }, [onClose, router]);
  const facebookReel = isFacebookVerticalItem(payload?.item);
  const playerHeight = useMemo(
    () =>
      // A Reel uses the same short vertical frame as an uploaded vertical video (e.g. 320x568).
      // Facebook's player may show narrow bars beside the video; the frame is not made taller for that.
      resolveWatchPlayerHeight({
        windowWidth: width,
        windowHeight,
        topInset: insets.top,
        isPortraitLayout,
      }),
    [width, windowHeight, insets.top, isPortraitLayout]
  );
  const scrollRef = useRef<ScrollView | null>(null);
  const upNextScrollOffsetRef = useRef(0);
  const upNextContentHeightRef = useRef(0);
  const upNextViewportHeightRef = useRef(0);
  const upNextPanStartOffsetRef = useRef(0);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [communicationCounts, setCommunicationCounts] = useState({
    unreadMessages: 0,
    missedCalls: 0,
  });
  const communicationBadge = formatProfileCommunicationBadgeCount(
    communicationCounts.unreadMessages + communicationCounts.missedCalls
  );
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let refreshing = false;
    const refreshCounts = async () => {
      if (refreshing) return;
      refreshing = true;
      let base = String(process.env.EXPO_PUBLIC_API_BASE || "");
      while (base.endsWith("/")) base = base.slice(0, -1);
      if (!base) {
        refreshing = false;
        return;
      }
      try {
        const snapshot = await fetchProfileCommunicationInboxSnapshot({ base });
        if (active) {
          setCommunicationCounts({
            unreadMessages: snapshot.unreadMessages,
            missedCalls: snapshot.missedCalls,
          });
        }
      } catch {
        // Keep the last successful values if a refresh fails.
      } finally {
        refreshing = false;
      }
    };

    void refreshCounts();
    const timer = setInterval(refreshCounts, 20_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [visible]);
  // Near the end of Up Next (about two cards left), ask once per list length for more videos.
  const upNextEndReachedRef = useRef(onUpNextEndReached);
  upNextEndReachedRef.current = onUpNextEndReached;
  const upNextLengthRef = useRef(relatedItems.length);
  upNextLengthRef.current = relatedItems.length;
  const upNextRequestedForLengthRef = useRef(-1);
  /*
   * Purple panel under the video: it follows the finger as Up Next scrolls. Scrolling down slides
   * it up under the video's edge until only a thin purple line is left; scrolling back up brings
   * it down again to its place. It moves with a transform on the native driver, so nothing is
   * laid out again while scrolling and the video stays still.
   */
  const [panelHeight, setPanelHeight] = useState(0);
  const upNextScrollY = useRef(new Animated.Value(0)).current;
  const panelFoldMax = Math.max(0, panelHeight - WATCH_PANEL_FOLDED_LINE);
  const panelTranslateY = useMemo(
    () =>
      upNextScrollY.interpolate({
        inputRange: [0, Math.max(1, panelFoldMax)],
        outputRange: [0, -panelFoldMax],
        extrapolate: "clamp",
      }),
    [upNextScrollY, panelFoldMax]
  );
  const handlePanelLayout = useCallback((event: any) => {
    const next = Math.round(Number(event?.nativeEvent?.layout?.height || 0));
    if (next > 0) setPanelHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);
  useEffect(() => {
    if (!visible || !activePostId) return;
    upNextScrollY.setValue(0);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [visible, activePostId, upNextScrollY]);
  const handleUpNextScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event?.nativeEvent || {};
    if (!contentSize || !layoutMeasurement) return;
    upNextScrollOffsetRef.current = Math.max(0, Number(contentOffset?.y || 0));
    upNextContentHeightRef.current = Number(contentSize.height || 0);
    upNextViewportHeightRef.current = Number(layoutMeasurement.height || 0);
    const remaining = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const length = upNextLengthRef.current;
    if (remaining > 1400 || !length || upNextRequestedForLengthRef.current === length) return;
    upNextRequestedForLengthRef.current = length;
    upNextEndReachedRef.current?.();
  }, []);
  const upNextScrollEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: upNextScrollY } } }], {
        useNativeDriver: true,
        listener: handleUpNextScroll,
      }),
    [upNextScrollY, handleUpNextScroll]
  );
  const upNextScrollPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15,
        onPanResponderGrant: () => {
          upNextPanStartOffsetRef.current = upNextScrollOffsetRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const maxOffset = Math.max(
            0,
            upNextContentHeightRef.current - upNextViewportHeightRef.current
          );
          const y = Math.max(
            0,
            Math.min(maxOffset, upNextPanStartOffsetRef.current - gesture.dy)
          );
          scrollRef.current?.scrollTo({ y, animated: false });
        },
        onPanResponderTerminationRequest: () => false,
      }),
    []
  );
  const handlePlaybackStarted = useCallback(() => setPlaybackStarted(true), []);
  const handleDisplayTypeDetected = useCallback(
    (next: HomeFeedVideoDisplayType, aspect: number) => {
      setDetectedDisplayType((current) => {
        const currentType = current?.postId === activePostId ? current.type : null;
        if (next === "youtube" && currentType != null && currentType !== "youtube") {
          return current;
        }
        if (
          current?.postId === activePostId &&
          currentType === next &&
          Math.abs(current.aspect - aspect) < 0.01
        ) {
          return current;
        }
        return { postId: activePostId, type: next, aspect };
      });
    },
    [activePostId]
  );

  const item = payload?.item;

  const watchUpNextRows = useMemo(() => {
    const rows: Array<{
      kind: "video" | "soko";
      key: string;
      item: any;
    }> = [];

    let productIndex = 0;

    relatedItems.forEach((related, index) => {
      const videoKey = String(
        related?.id ||
        related?.homeFeedRecycleKey ||
        `watch-video-${index}`
      ).trim();

      rows.push({
        kind: "video",
        key: videoKey,
        item: related,
      });

      /*
       * Insert one marketplace product after every three videos.
       * This keeps Watch video-first without hiding SOKO.
       */
      if (
        (index + 1) % 3 === 0 &&
        productIndex < sokoProducts.length
      ) {
        const product = sokoProducts[productIndex];
        const productId = String(
          product?.sokoProductId ||
          product?.id ||
          productIndex
        ).replace(/^soko:/, "");

        rows.push({
          kind: "soko",
          key: `watch-soko-${productId}`,
          item: product,
        });

        productIndex += 1;
      }
    });

    /*
     * Short Up Next lists should still show one product.
     */
    if (
      productIndex === 0 &&
      sokoProducts.length > 0
    ) {
      const product = sokoProducts[0];
      const productId = String(
        product?.sokoProductId ||
        product?.id ||
        "first"
      ).replace(/^soko:/, "");

      rows.push({
        kind: "soko",
        key: `watch-soko-${productId}`,
        item: product,
      });
    }

    return rows;
  }, [relatedItems, sokoProducts]);

  // A new video starts a new Up Next list: allow asking for more again.
  useEffect(() => {
    upNextRequestedForLengthRef.current = -1;
  }, [activePostId]);
  const handleRelatedVideoPress = useCallback(
    (next: HomeFeedVideoOpenPayload) => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      onSelectRelated(next);
    },
    [onSelectRelated]
  );

  // Watch ownership lifecycle: close ONLY when invisible or unmounted.
  // Never tie notifyWatchScreenClosed to payload.postId — video-to-video hops
  // must keep background jobs (poster/thumbnail/disk-cache/feed-polling) paused.
  useEffect(() => {
    if (!visible) {
      setPlaybackStarted(false);
      notifyWatchScreenClosed();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    notifyWatchScreenOpened(String(payload?.postId || "").trim());
  }, [visible, payload?.postId]);

  useEffect(() => {
    return () => notifyWatchScreenClosed();
  }, []);

  useEffect(() => {
    if (!visible || !payload) return;
    setPlaybackStarted(false);
    const remoteUri =
      String(payload.videoUri || "").trim() ||
      (payload.item ? resolveHomeFeedVideoUri(payload.item) : "");
    const postId = String(payload.postId || "").trim();
    if (!remoteUri || !postId) return;
    void hydrateMediaPosterCacheForPlayback();
    void hydrateAndCacheWatchVideo({ postId, remoteUrl: remoteUri });
  }, [visible, payload?.postId, payload?.videoUri, payload?.item]);

  useEffect(() => {
    if (!visible || !playbackStarted || !relatedItems.length) return;
    const next = relatedItems[0];
    if (!next) return;
    const nextPostId = String(next?.id || "").trim();
    const nextUrl = resolveHomeFeedVideoUri(next);
    if (!nextPostId || !nextUrl) return;
    scheduleWatchNextVideoDiskCache({ postId: nextPostId, remoteUrl: nextUrl });
  }, [visible, playbackStarted, relatedItems]);

  useEffect(() => {
    if (!payload?.postId) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [payload?.postId]);

  if (!payload) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <StatusBar barStyle="light-content" />
        <View style={styles.headerChrome}>
          <LinearGradient
            colors={["#2B003D", "#5A007A"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          <View style={{ paddingTop: insets.top }}>
            <View style={styles.topBar}>
              <View style={styles.topBarTitleRow} pointerEvents="none">
                <Text style={styles.topBarTitleWord} numberOfLines={1}>
                  JESUS
                </Text>
                <Text style={styles.topBarTitleWord} numberOfLines={1}>
                  IS
                </Text>
                <Text style={styles.topBarTitleWord} numberOfLines={1}>
                  KING
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close video"
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={openMessages}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Open messages"
                style={styles.messageButton}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={21} color="#FFFFFF" />
                {communicationBadge ? (
                  <View style={styles.watchHeaderBadge} pointerEvents="none">
                    <Text style={styles.watchHeaderBadgeText}>
                      {communicationBadge}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.playerWrap,
            { height: playerHeight },
            isTikTokLayout ? styles.playerWrapTikTok : null,
          ]}
          {...upNextScrollPanResponder.panHandlers}
        >
          {String(payload.item?.source || "").trim().toLowerCase() === "system-admin-video-link" ? (
            <WatchExternalVideoSurface item={payload.item} />
          ) : (
            <WatchVideoSurface
              payload={payload}
              displayType={displayType}
              videoAspect={videoAspect}
              frameWidth={width}
              frameHeight={playerHeight}
              onPlaybackStarted={handlePlaybackStarted}
              onDisplayTypeDetected={handleDisplayTypeDetected}
            />
          )}
        </View>

        <View style={styles.upNextArea}>
          <Animated.ScrollView
            ref={scrollRef as any}
            style={styles.scroll}
            contentContainerStyle={{ paddingTop: panelHeight, paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
            onScroll={upNextScrollEvent}
            scrollEventThrottle={16}
            onContentSizeChange={(_width, height) => {
              upNextContentHeightRef.current = height;
            }}
            onLayout={(event) => {
              upNextViewportHeightRef.current = event.nativeEvent.layout.height;
            }}
          >
            <Text style={styles.upNextLabel}>Up next</Text>
            {watchUpNextRows.map((row) => {
              if (row.kind === "soko") {
                return (
                  <View
                    key={row.key}
                    style={styles.watchSokoPost}
                  >
                    <SokoHomeProductCard product={row.item}/>
                  </View>
                );
              }

              const related = row.item;

              return (
                <FeedYouTubeCard
                  key={row.key}
                  item={related}
                  onLike={() => onItemLike(related)}
                  onComment={() => onItemComment(related)}
                  onShare={() => onItemShare(related)}
                  onSave={() => onItemSave(related)}
                  onReport={() => onItemReport(related)}
                  onVideoPress={handleRelatedVideoPress}
                />
              );
            })}
          </Animated.ScrollView>
          <Animated.View
            {...upNextScrollPanResponder.panHandlers}
            style={[styles.currentVideoPanel, styles.currentVideoPanelFloating, { transform: [{ translateY: panelTranslateY }] }]}
            onLayout={handlePanelLayout}
          >
            <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFillObject} />
            <LinearGradient
              colors={[
                "rgba(52, 4, 82, 0.76)",
                "rgba(46, 3, 73, 0.72)",
                "rgba(38, 2, 62, 0.74)",
              ]}
              locations={[0, 0.5, 1]}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
            <View style={styles.panelContent}>
              {item ? <WatchVideoMeta item={item} fallbackTitle={payload.title} /> : null}
              {item ? <View style={styles.actionsDivider} /> : null}
              <View style={styles.actionsWrap}>
                {item ? (
                  <WatchVideoEngagementActions
                    item={item}
                    onLike={onLike}
                    onComment={onComment}
                    onShare={onShare}
                    onSave={onSave}
                    onReport={onReport}
                  />
                ) : null}
              </View>
            </View>
          </Animated.View>
        </View>

        <FeedCommentsSheet
          visible={commentsSheetOpen}
          postId={commentTargetPostId}
          youtubeVideoId={youtubeVideoIdFromUrl(item?.videoUrl || item?.url)}
          railDiscussionCount={commentRailCount}
          onClose={onCloseComments}
          onDiscussionCountChange={onDiscussionCountChange}
          onDiscussionCountBump={onDiscussionCountBump}
        />

        <FeedReportSheet
          visible={reportSheetOpen}
          postId={reportTargetPostId}
          authorUserId={String(
            reportTargetItem?.createdByUserId ||
            reportTargetItem?.createdBy ||
            reportTargetItem?.authorUserId ||
            reportTargetItem?.ownerUserId ||
            reportTargetItem?.userId ||
            ""
          ).trim()}
          targetItem={reportTargetItem}
          onClose={onCloseReport}
          onReported={onReported}
        />

        <HomeFeedShareSheet
          visible={shareSheetOpen}
          payload={sharePayload}
          onClose={onCloseShare}
          onOpenShareToChat={onOpenShareToChat}
        />

        <ShareToChatSheet
          visible={shareToChatOpen}
          payload={sharePayload}
          sourceItem={shareSourceItem}
          onClose={onCloseShareToChat}
        />
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  externalVideoSurface: {
    flex: 1,
    width: "100%",
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  externalVideoWebView: { flex: 1, backgroundColor: "#000000" },
  externalVideoWebViewContainer: { flex: 1, backgroundColor: "#000000" },
  externalVideoWebViewClear: { flex: 1, backgroundColor: "transparent" },
  externalVideoUnavailable: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  externalVideoUnavailableText: { color: "#FFFFFF", textAlign: "center", fontSize: 14, fontWeight: "700" },
  facebookOpenButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1877F2",
  },
  facebookOpenButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  facebookPlayerColumn: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: HOME_FEED_BG,
  },
  headerChrome: {
    width: "100%",
    overflow: "hidden",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(244,208,111,0.22)",
  },
  topBar: {
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  // Equal side insets keep the word row mathematically centered vs the back button.
  topBarTitleRow: {
    position: "absolute",
    left: 62,
    right: 62,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
  },
  topBarTitleWord: {
    // Exact registered name from @expo-google-fonts/cinzel — no fontWeight (avoids iOS fallback).
    fontFamily: CINZEL_SEMIBOLD_FAMILY,
    color: "#F4D06F",
    fontSize: 24,
    lineHeight: 31,
    letterSpacing: 4,
    textTransform: "uppercase",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  backButton: {
    position: "absolute",
    left: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 0, 32, 0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#F4D06F",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  messageButton: {
    position: "absolute", right: 12, width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(20, 0, 32, 0.55)",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#F4D06F",
    shadowColor: "#F4D06F", shadowOpacity: 0.28, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  watchHeaderBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#5A007A",
    backgroundColor: "#F54164",
    alignItems: "center",
    justifyContent: "center",
  },
  watchHeaderBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    lineHeight: 11,
  },
  playerWrap: {
    width: "100%",
    backgroundColor: "#000000",
  },
  playerWrapTikTok: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Cover over an external player whose video has ended: tap to play it again.
  externalEndCover: { zIndex: 5, backgroundColor: "#12031F", alignItems: "center", justifyContent: "center" },
  externalEndReplayButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    paddingLeft: 4,
  },
  // Reel frame: Watch's dark purple (not black) shows beside the player when no picture is saved.
  facebookReelSurface: { alignItems: "center", justifyContent: "center", backgroundColor: "#12031F" },
  facebookReelPlayer: { zIndex: 2, backgroundColor: "#000000" },
  playerSurface: {
    flex: 1,
    width: "100%",
    backgroundColor: "#12031F",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  // Sized in code to the video's own proportions inside the frame (see containedVideoSize).
  videoPortrait: {
    alignSelf: "center",
    zIndex: 2,
    backgroundColor: "transparent",
  },
  tikTokVideoBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  tikTokBackdropOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.12)",
    zIndex: 1,
  },
  replayOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Watch's dark purple, not black, while the cover loads.
    backgroundColor: "#12031F",
  },
  replayBadgeWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  replayBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  replayIcon: {
    marginLeft: 3,
  },
  scroll: {
    flex: 1,
  },
  // Clips the panel as it slides up, so it disappears under the video's bottom edge.
  upNextArea: { flex: 1, overflow: "hidden" },
  currentVideoPanelFloating: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 },
  currentVideoPanel: {
    borderTopWidth: 1,
    borderTopColor: "rgba(244,208,111,0.28)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(168,85,247,0.30)",
    backgroundColor: "rgba(46,3,73,0.96)",
    shadowColor: "#A855F7",
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 9,
  },
  panelContent: {
    position: "relative",
    zIndex: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingTop: 14,
    paddingBottom: 4,
  },
  avatarRing: {
    width: AVATAR_RING_SIZE,
    height: AVATAR_RING_SIZE,
    borderRadius: AVATAR_RING_SIZE / 2,
    borderWidth: 3,
    borderColor: "rgba(244, 208, 111, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#9333EA",
    shadowOpacity: 0.48,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  avatarGlow: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: "hidden",
    backgroundColor: "rgba(124, 58, 237, 0.16)",
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
  dateMuted: {
    color: WATCH_DATE_COLOR,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
    marginTop: 2,
  },
  actionsDivider: {
    height: 1,
    backgroundColor: "rgba(244,208,111,0.18)",
    marginHorizontal: YOUTUBE_CARD_H_PADDING,
    shadowColor: "#F4D06F",
    shadowOpacity: 0.16,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
  },
  actionsWrap: {
    paddingTop: 11,
    paddingBottom: 9,
    backgroundColor: "rgba(7,1,16,0.18)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.045)",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: -3 },
  },
  watchActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  watchAction: {
    flex: 1,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
  },
  watchActionLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "700",
  },
  // Bigger like/comment digits; lineHeight stays 13 (from watchActionLabel) so the row keeps its height.
  watchActionCountLabel: {
    fontSize: 13.5,
  },
  watchActionLabelActive: {
    color: HOME_FEED_GOLD_SOFT,
  },
  watchSokoPost: {
    marginTop: 14,
    marginBottom: 14,
  },
  upNextLabel: {
    color: HOME_FEED_MUTED,
    fontSize: 15,
    fontWeight: "800",
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingTop: 12,
    paddingBottom: 4,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
});
