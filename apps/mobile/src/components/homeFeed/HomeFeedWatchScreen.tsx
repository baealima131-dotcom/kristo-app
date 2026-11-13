import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Image,
  Modal,
  PanResponder,
  Platform,
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
  safePauseVideoPlayer,
  safePlayVideoPlayer,
  safeSeekVideoPlayer,
} from "@/src/lib/expoVideoPlayerSafe";
import { useEventListener } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import {
  hydrateAndCacheWatchVideo,
  resolveHomeFeedPlaybackUri,
  scheduleWatchNextVideoDiskCache,
} from "@/src/lib/homeFeedVideoDiskCache";
import { resolveCachedMediaPoster, hydrateMediaPosterCacheForPlayback } from "@/src/lib/mediaPosterCache";
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
  YOUTUBE_CARD_H_PADDING,
  resolveHomeFeedVideoAspect,
  resolveWatchPlayerHeight,
} from "@/src/lib/homeFeedYouTubeLayout";
import { resolveHomeFeedVideoDisplayType } from "@/src/lib/homeFeedVideoDisplayType";
import { resolveVideoDurationMs } from "@/src/lib/mediaVideoPoster";
import {
  allowWatchRotation,
  restoreAppPortrait,
} from "@/src/lib/watchOrientation";
import {
  formatFeedTimestamp,
  isChurchRoomMemberFeedPost,
  resolveChurchName,
  resolveFeedPostTypeTitle,
  resolveHomeFeedVideoTitle,
  resolveVideoUri,
  resolveYouTubeFeedMetadataPosterUri,
} from "./homeFeedUtils";
import { FeedChurchBrandRow } from "./FeedChurchBrandRow";
import {
  HEADER_INBOX_ROUTES,
  HeaderInboxIcons,
  type HeaderInboxTarget,
} from "./HeaderInboxIcons";
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
import { recordQualifiedHomeFeedPostView, useHomeFeedPostViewCount } from "@/src/lib/homeFeedPostViews";
import type { HomeFeedSharePayload } from "@/src/lib/homeFeedShare";
import { FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import { formatActionCount } from "./homeFeedUtils";
import {
  HOME_FEED_BG,
  HOME_FEED_BORDER,
  HOME_FEED_GOLD,
  HOME_FEED_GOLD_SOFT,
  HOME_FEED_MUTED,
} from "./theme";

const AVATAR_SIZE = 46;
const WATCH_ACTION_ICON_SIZE = 20;
const WATCH_PANEL_BORDER_TOP = "rgba(244, 208, 111, 0.30)";
const WATCH_PANEL_BORDER_BOTTOM = "rgba(168, 85, 247, 0.38)";
const WATCH_DATE_COLOR = "rgba(255,255,255,0.45)";
const AVATAR_RING_SIZE = AVATAR_SIZE + 6;
const WATCH_PANEL_TOP_RADIUS = 38;

type Props = {
  visible: boolean;
  payload: HomeFeedVideoOpenPayload | null;
  relatedItems: any[];
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
  const rawPlatformStats = item?.platformStats ?? item?.stats ?? {};
  const platformStats = externalVideo && rawPlatformStats && typeof rawPlatformStats === "object"
    ? rawPlatformStats
    : {};
  const platformCount = (value: unknown) => {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  };
  const likeCount = engagement.likeCount + platformCount((platformStats as any).likes ?? (platformStats as any).likeCount);
  const commentCount = engagement.commentCount + platformCount((platformStats as any).comments ?? (platformStats as any).commentCount);

  return (
    <View style={styles.watchActionsRow}>
      <WatchPanelAction
        icon={engagement.likedByMe || engagement.liked ? "heart" : "heart-outline"}
        label={formatActionCount(likeCount)}
        active={engagement.likedByMe || engagement.liked}
        activeColor="#FF6B8A"
        onPress={onLike}
      />
      <WatchPanelAction
        icon="chatbubble-ellipses-outline"
        label={formatActionCount(commentCount)}
        onPress={onComment}
      />
      <WatchPanelAction
        icon="arrow-redo-outline"
        label={formatActionCount(Number(item?.shareCount || 0))}
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <Pressable style={styles.watchAction} onPress={onPress} hitSlop={8}>
      <Ionicons
        name={icon}
        size={WATCH_ACTION_ICON_SIZE}
        color={active ? activeColor : "rgba(255,255,255,0.68)"}
      />
      <Text
        style={[styles.watchActionLabel, active ? styles.watchActionLabelActive : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
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

// Fullscreen is landscape; rotating back to portrait exits it. Both platforms skip
// the auto-exit while the system rotation lock is on.
const WATCH_FULLSCREEN_OPTIONS: NonNullable<React.ComponentProps<typeof VideoView>["fullscreenOptions"]> = {
  enable: true,
  orientation: "landscape",
  autoExitOnRotate: true,
};
// A vertical video (4:5, 9:16) opens fullscreen in the phone's own orientation, so it fills the
// portrait screen instead of a small strip of a landscape one (Android; iOS: IosWatchFullscreen).
const WATCH_VERTICAL_FULLSCREEN_OPTIONS: NonNullable<React.ComponentProps<typeof VideoView>["fullscreenOptions"]> = {
  enable: true,
  orientation: "default",
  autoExitOnRotate: false,
};
const WATCH_MODAL_ORIENTATIONS: React.ComponentProps<typeof Modal>["supportedOrientations"] = [
  "portrait",
  "landscape-left",
  "landscape-right",
];
// iOS uses Kristo's own fullscreen (IosWatchFullscreen: clear close button, swipe down to go
// back) instead of the native one, so the native fullscreen button is hidden there.
const IOS_NATIVE_FULLSCREEN_OFF: NonNullable<React.ComponentProps<typeof VideoView>["fullscreenOptions"]> = {
  enable: false,
};
const WATCH_HEADER_SIDE_PADDING = 12;
// Watch header buttons match the 42 px back button (Home keeps its smaller ones).
const WATCH_HEADER_BACK_SIZE = 42;
const WATCH_HEADER_INBOX_SIZE = 42;
const WATCH_HEADER_INBOX_GAP = 10;
const WATCH_HEADER_TITLE_LEFT = WATCH_HEADER_SIDE_PADDING + WATCH_HEADER_BACK_SIZE + 6;
const WATCH_HEADER_TITLE_RIGHT =
  WATCH_HEADER_SIDE_PADDING + WATCH_HEADER_INBOX_SIZE * 2 + WATCH_HEADER_INBOX_GAP + 8;
const IOS_FULLSCREEN_SWIPE_CLOSE_DISTANCE = 120;
const IOS_FULLSCREEN_SWIPE_CLOSE_VELOCITY = 1.2;

/**
 * iOS fullscreen for the Watch video. It shows the same player, so playback goes on from the same
 * position when it closes. Close with the button or by swiping down.
 */
function IosWatchFullscreen({
  visible,
  player,
  onClose,
}: {
  visible: boolean;
  player: ReturnType<typeof useVideoPlayer>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
        onPanResponderMove: (_event, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_event, gesture) => {
          if (
            gesture.dy > IOS_FULLSCREEN_SWIPE_CLOSE_DISTANCE ||
            gesture.vy > IOS_FULLSCREEN_SWIPE_CLOSE_VELOCITY
          ) {
            onCloseRef.current();
            dragY.setValue(0);
            return;
          }
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [dragY]
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={WATCH_MODAL_ORIENTATIONS}
      onRequestClose={onClose}
    >
      <View style={styles.iosFullscreenRoot} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ translateY: dragY }],
              opacity: dragY.interpolate({ inputRange: [0, 320], outputRange: [1, 0.45], extrapolate: "clamp" }),
            },
          ]}
        >
          {visible ? (
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              nativeControls
              fullscreenOptions={IOS_NATIVE_FULLSCREEN_OFF}
            />
          ) : null}
        </Animated.View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={[styles.iosFullscreenClose, { top: insets.top + 10, left: insets.left + 14 }]}
          accessibilityRole="button"
          accessibilityLabel="Close fullscreen"
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}
// Android fullscreen is a separate activity, so the React host reports
// "background" around the same time onFullscreenEnter arrives.
const ANDROID_FULLSCREEN_BACKGROUND_GRACE_MS = 350;

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

function WatchVideoSurface({
  payload,
  isTikTokLayout = false,
  isLandscape = false,
  onPlaybackStarted,
  onVideoAspect,
  videoAspect,
}: {
  payload: HomeFeedVideoOpenPayload;
  isTikTokLayout?: boolean;
  isLandscape?: boolean;
  onPlaybackStarted?: () => void;
  /** Video width / height when known: the vertical video column takes this shape (default 9:16). */
  videoAspect?: number;
  /** Reports the playing video's own shape (width / height) once the player knows it. */
  onVideoAspect?: (aspect: number) => void;
}) {
  const item = payload.item;
  const postId = String(payload.postId || "").trim();
  const requestedUri = String(payload.videoUri || "").trim() ||
    (item ? resolveHomeFeedVideoUri(item) : "");
  // Keep the selected source stable during this playback session. A cache update
  // must not replace a streaming source mid-video and reset playback.
  const androidPlaybackUri = useMemo(
    () => resolveHomeFeedPlaybackUri(requestedUri) || requestedUri,
    [postId, requestedUri]
  );
  const playbackUri = Platform.OS === "android"
    ? androidPlaybackUri
    : resolveWatchScreenPlaybackUri(payload);
  const useVideoBackdrop = Platform.OS !== "android" && isTikTokLayout;
  const backdropPosterUri = Platform.OS === "android"
    ? resolveCachedMediaPoster(postId, requestedUri) ||
      (item ? resolveYouTubeFeedMetadataPosterUri(item, postId, requestedUri) : "")
    : "";
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
  const videoViewRef = useRef<VideoView | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Fullscreen opens only from the expand button (never by tapping the picture, never by
  // itself, e.g. on rotating the phone). iOS uses IosWatchFullscreen, Android the native one.
  const fullscreenRef = useRef(false);
  const [iosFullscreenOpen, setIosFullscreenOpen] = useState(false);
  const closeIosFullscreenRef = useRef<() => void>(() => {});

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
    useVideoBackdrop && playbackUri ? buildWatchVideoPlayerSource(playbackUri) : null,
    // iOS blurred background for vertical videos: a still frame of the same video. It never
    // plays and is silent, so only the main player is heard (no doubled video or echo).
    (p) => {
      p.loop = false;
      p.muted = true;
      p.volume = 0;
    }
  );

  const playerRef = useRef(player);
  const backdropPlayerRef = useRef(backdropPlayer);
  playerRef.current = player;
  backdropPlayerRef.current = backdropPlayer;

  useEffect(() => {
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const pauseForBackground = () => {
      backgroundPausedRef.current = true;
      const uri = playbackUri;
      safePauseVideoPlayer(backdropPlayerRef.current, {
        source: "home-feed-watch-backdrop",
        uri,
      });
      safePauseVideoPlayer(playerRef.current, { source: "home-feed-watch", uri });
      notifyWatchPlaybackPaused(postId);
    };
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") return;
      if (Platform.OS === "android") {
        if (fullscreenRef.current) return;
        if (graceTimer) clearTimeout(graceTimer);
        graceTimer = setTimeout(() => {
          graceTimer = null;
          if (fullscreenRef.current || AppState.currentState === "active") return;
          pauseForBackground();
        }, ANDROID_FULLSCREEN_BACKGROUND_GRACE_MS);
        return;
      }
      pauseForBackground();
    });
    return () => {
      if (graceTimer) clearTimeout(graceTimer);
      sub.remove();
    };
  }, [playbackUri, postId]);

  useEffect(() => {
    endedRef.current = ended;
  }, [ended]);

  useEventListener(player, "videoTrackChange", ({ videoTrack }) => {
    const w = Number(videoTrack?.size?.width || 0);
    const h = Number(videoTrack?.size?.height || 0);
    if (w > 0 && h > 0) onVideoAspect?.(w / h);
  });

  useEventListener(player, "playToEnd", () => {
    if (Platform.OS === "ios") {
      closeIosFullscreenRef.current();
    } else if (fullscreenRef.current) {
      void videoViewRef.current?.exitFullscreen().catch(() => {});
    }
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

        if (useVideoBackdrop && activeBackdrop) {
          const backdropCurrentUri = String((activeBackdrop as any)?.source?.uri || "").trim();
          const backdropNeedsReplace = !backdropCurrentUri || backdropCurrentUri !== playbackUri;
          if (backdropNeedsReplace) {
            if (typeof activeBackdrop.replaceAsync === "function") {
              await activeBackdrop.replaceAsync(source);
            } else {
              activeBackdrop.replace(source);
            }
          }
          activeBackdrop.muted = true;
          activeBackdrop.volume = 0;
          activeBackdrop.loop = false;
          safePauseVideoPlayer(activeBackdrop, {
            source: "home-feed-watch-backdrop",
            uri: playbackUri,
          });
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
  }, [playbackUri, postId, useVideoBackdrop, tryWatchAutoPlay, isWatchAutoPlayBlocked]);

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

    // The player's real length wins over the post's stored duration (which can be missing or
    // wrong), so a saved position is not mistaken for "watched to the end".
    const effectiveDurationSec = () => {
      try {
        const d = Number((player as any)?.duration || 0);
        if (Number.isFinite(d) && d > 0) return d;
      } catch {}
      return durationSec;
    };

    let restoreAttempts = 0;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    const playerKnowsDuration = () => {
      try {
        return Number((player as any)?.duration || 0) > 0;
      } catch {
        return false;
      }
    };

    const restoreSeek = () => {
      if (stopped || restored || endedRef.current) return;
      // Wait (up to ~3 s) for the player's real length before judging "watched to the end".
      if (!playerKnowsDuration() && restoreAttempts < 12) {
        restoreAttempts += 1;
        restoreTimer = setTimeout(restoreSeek, 250);
        return;
      }
      const seekTo = peekHomeFeedVideoRestoreSeek(postId, effectiveDurationSec());
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
          saveHomeFeedVideoProgress(postId, t, effectiveDurationSec());
        }
      } catch {}
    };

    restoreTimer = setTimeout(restoreSeek, 250);
    const progressTimer = setInterval(saveProgress, 1000);

    return () => {
      stopped = true;
      if (restoreTimer) clearTimeout(restoreTimer);
      clearInterval(progressTimer);
      if (!endedRef.current) {
        saveProgress();
      }
    };
  }, [player, postId, durationSec]);

  // Android fullscreen pauses the React host, which stops the 1s progress timer
  // above. timeUpdate is emitted natively by the same player, so it keeps the
  // saved position current while fullscreen.
  useEffect(() => {
    if (!player) return;
    try {
      player.timeUpdateEventInterval = isFullscreen ? 1 : 0;
    } catch {}
  }, [player, isFullscreen]);

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (!fullscreenRef.current || endedRef.current || !postId) return;
    if (Number.isFinite(currentTime) && currentTime > 0.5) {
      const playerDuration = Number((player as any)?.duration || 0);
      saveHomeFeedVideoProgress(
        postId,
        currentTime,
        Number.isFinite(playerDuration) && playerDuration > 0 ? playerDuration : durationSec
      );
    }
  });

  const handleFullscreenEnter = useCallback(() => {
    fullscreenRef.current = true;
    setIsFullscreen(true);
    console.log("KRISTO_WATCH_FULLSCREEN_ENTER", { postId });
  }, [postId]);

  const handleFullscreenExit = useCallback(() => {
    fullscreenRef.current = false;
    setIsFullscreen(false);
    console.log("KRISTO_WATCH_FULLSCREEN_EXIT", { postId });
  }, [postId]);

  const closeIosFullscreen = useCallback(() => {
    if (!fullscreenRef.current) return;
    setIosFullscreenOpen(false);
    handleFullscreenExit();
  }, [handleFullscreenExit]);
  closeIosFullscreenRef.current = closeIosFullscreen;

  // Inline the video has no native controls: the expand button opens fullscreen (which has the
  // full controls); touching the picture does nothing, and swipes on the video scroll Up Next.
  const [isPlaying, setIsPlaying] = useState(false);
  useEventListener(player, "playingChange", ({ isPlaying: playing }) => {
    setIsPlaying(playing);
  });

  const handleEnterFullscreen = useCallback(() => {
    if (fullscreenRef.current || endedRef.current) return;
    console.log("KRISTO_WATCH_TAP_FULLSCREEN_ENTER", { postId });
    if (Platform.OS === "ios") {
      setIosFullscreenOpen(true);
      handleFullscreenEnter();
      return;
    }
    const view = videoViewRef.current;
    if (!view) return;
    fullscreenRef.current = true;
    view.enterFullscreen().catch((error: any) => {
      fullscreenRef.current = false;
      console.log("KRISTO_WATCH_TAP_FULLSCREEN_FAILED", {
        postId,
        error: String(error?.message || error || "unknown"),
      });
    });
  }, [postId, handleFullscreenEnter]);

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      userPausedRef.current = true;
      safePauseVideoPlayer(player, { source: "home-feed-watch", uri: playbackUri });
    } else {
      userPausedRef.current = false;
      backgroundPausedRef.current = false;
      safePlayVideoPlayer(player, { source: "home-feed-watch", uri: playbackUri });
    }
  }, [isPlaying, player, playbackUri]);

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

  if (!playbackUri) return null;

  return (
    <View style={styles.playerSurface}>
      {!ended && isTikTokLayout ? (
        <>
          {useVideoBackdrop ? (
            <VideoView
              player={backdropPlayer}
              style={styles.tikTokVideoBackdrop}
              contentFit="cover"
              pointerEvents="none"
            />
          ) : backdropPosterUri ? (
            <View style={styles.tikTokVideoBackdrop} pointerEvents="none">
              <Image
                source={{ uri: backdropPosterUri }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
            </View>
          ) : null}
          <View style={styles.tikTokBackdropOverlay} pointerEvents="none" />
        </>
      ) : null}
      {(!ended || isFullscreen) && !iosFullscreenOpen ? (
        <VideoView
          ref={videoViewRef}
          player={player}
          style={
            isTikTokLayout
              ? [styles.videoOverBackdrop, videoAspect && videoAspect > 0 ? { aspectRatio: videoAspect } : null]
              : styles.video
          }
          contentFit="contain"
          nativeControls={false}
          // Android: render in the normal view tree. The default SurfaceView sits behind the
          // window and does not follow the floating stack's scroll transform, so the picture
          // lagged/jumped while scrolling or stayed hidden behind the poster. iOS ignores it.
          surfaceType="textureView"
          fullscreenOptions={
            Platform.OS === "ios"
              ? IOS_NATIVE_FULLSCREEN_OFF
              : isTikTokLayout
                ? WATCH_VERTICAL_FULLSCREEN_OPTIONS
                : WATCH_FULLSCREEN_OPTIONS
          }
          onFullscreenEnter={handleFullscreenEnter}
          onFullscreenExit={handleFullscreenExit}
        />
      ) : null}
      {!ended && !isFullscreen ? (
        // Touching the picture does nothing (and swipes scroll Up Next); fullscreen opens only
        // from the expand button.
        <View style={styles.inlineTapLayer} pointerEvents="box-none">
          <View style={styles.inlineControls} pointerEvents="box-none">
            <Pressable
              onPress={handleTogglePlay}
              hitSlop={8}
              style={styles.inlineControlButton}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
            >
              <Ionicons name={isPlaying ? "pause" : "play"} size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={handleEnterFullscreen}
              hitSlop={8}
              style={styles.inlineControlButton}
              accessibilityRole="button"
              accessibilityLabel="Fullscreen"
            >
              <Ionicons name="expand" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : null}
      {Platform.OS === "ios" ? (
        <IosWatchFullscreen visible={iosFullscreenOpen} player={player} onClose={closeIosFullscreen} />
      ) : null}
      {ended ? (
        <Pressable style={styles.replayOverlay} onPress={handleReplay} accessibilityLabel="Replay video">
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

/** Plays public YouTube/TikTok links in Kristo's Watch view using the platforms' embed players. */
function WatchExternalVideoSurface({ item }: { item: any }) {
  const provider = String(item?.videoDisplayType || item?.provider || "youtube").toLowerCase() === "tiktok" ? "TikTok" : "YouTube";
  const embedUrl = buildExternalVideoEmbedUrl(item);
  // YouTube requires a client identity Referer for native WebView embeds (Error 153).
  // Use Kristo's registered iOS bundle ID in the HTTPS Referer as YouTube specifies.
  const playerSource = provider === "YouTube" && embedUrl
    ? {
        uri: embedUrl,
        headers: { Referer: "https://com.princefariji.kristoapp.free" },
      }
    : embedUrl
      ? { uri: embedUrl }
      : null;
  return (
    <View style={styles.externalVideoSurface}>
      {embedUrl ? (
        <WebView
          key={embedUrl}
          source={playerSource!}
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
          accessibilityLabel={`${provider} video player`}
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

/** Current-video metadata — creator, title, date, and Kristo App view count. */
function WatchVideoMeta({ item, fallbackTitle = "" }: { item: any; fallbackTitle?: string }) {
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const externalVideo = String(item?.source || "").trim().toLowerCase() === "system-admin-video-link";
  const postTitle = resolveHomeFeedVideoTitle(item);
  const titleLine = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle || fallbackTitle;
  const whenLabel = externalVideo && item?.publishedAt
    ? new Date(String(item.publishedAt)).toLocaleDateString()
    : formatFeedTimestamp(item?.createdAt);
  const postId = String(item?.id || "").trim();
  const serverViewCount = Number(item?.viewCount || 0);
  const viewCount = useHomeFeedPostViewCount(postId, serverViewCount);
  const rawPlatformStats = item?.platformStats ?? item?.stats ?? {};
  const platformStats = externalVideo && rawPlatformStats && typeof rawPlatformStats === "object"
    ? rawPlatformStats
    : {};
  const youtubeViews = Number((platformStats as any).views ?? (platformStats as any).viewCount);
  const combinedViewCount = viewCount + (Number.isFinite(youtubeViews) && youtubeViews > 0 ? youtubeViews : 0);

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
    <View>
      <View style={styles.metaRow}>
        <View style={styles.avatarRing}>
          <View style={styles.avatarGlow}>
            <FeedChurchBrandRow item={item} variant="watch" part="avatar" source="watch-screen" />
          </View>
        </View>
        <View style={styles.metaTextCol}>
          <FeedChurchBrandRow item={item} variant="watch" part="name" source="watch-screen" />
          {titleLine ? <Text style={styles.videoTitle} numberOfLines={3}>{titleLine}</Text> : null}
          {whenLabel || externalVideo ? (
            <View style={styles.metaStatsLine}>
              {whenLabel ? <Text style={styles.dateMuted} numberOfLines={1}>{whenLabel}</Text> : null}
              {externalVideo ? (
                <View style={styles.externalVideoDetails}>
                  <Ionicons name="eye-outline" size={15} color={HOME_FEED_MUTED} />
                  <Text style={styles.externalVideoDetailText}>{formatActionCount(combinedViewCount)} views</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export const HomeFeedWatchScreen = memo(function HomeFeedWatchScreen({
  visible,
  payload,
  relatedItems,
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
  const { width, height: windowHeight } = useWindowDimensions();
  const displayType = resolveHomeFeedVideoDisplayType(payload?.item);
  // Player follows the video's own shape: stored video size, else the size the player reports.
  const hasStoredVideoSize =
    Number(payload?.item?.videoWidth || 0) > 0 && Number(payload?.item?.videoHeight || 0) > 0;
  const [reportedAspect, setReportedAspect] = useState<{ postId: string; aspect: number } | null>(null);
  const currentPostId = String(payload?.postId || "").trim();
  const videoAspect = hasStoredVideoSize
    ? resolveHomeFeedVideoAspect(payload?.item)
    : reportedAspect && reportedAspect.postId === currentPostId
      ? reportedAspect.aspect
      : undefined;
  const handleVideoAspect = useCallback(
    (aspect: number) => {
      if (!currentPostId || !(aspect > 0)) return;
      setReportedAspect((prev) =>
        prev && prev.postId === currentPostId && Math.abs(prev.aspect - aspect) < 0.01
          ? prev
          : { postId: currentPostId, aspect }
      );
    },
    [currentPostId]
  );
  const isTikTokLayout = videoAspect ? videoAspect < 1 : displayType === "tiktok";
  const isLandscape = width > windowHeight;
  const playerHeight = useMemo(
    () =>
      resolveWatchPlayerHeight({
        windowWidth: width,
        windowHeight,
        topInset: insets.top,
        isTikTokLayout,
        videoAspect,
      }),
    [width, windowHeight, insets.top, isTikTokLayout, videoAspect]
  );
  const scrollRef = useRef<ScrollView | null>(null);
  const router = useRouter();
  // Watch is a modal over Home: close it, then open Messages or the call list.
  const handleInboxOpen = useCallback(
    (target: HeaderInboxTarget) => {
      onClose();
      router.push(HEADER_INBOX_ROUTES[target] as any);
    },
    [onClose, router]
  );
  const [playbackStarted, setPlaybackStarted] = useState(false);

  /*
   * Collapsing panel (like YouTube): scrolling Up Next down folds the purple panel under the video
   * to a thin line; scrolling up, or reaching the top, opens it again. The header (JESUS IS KING,
   * Messages and missed calls) always stays as it is.
   */
  const [panelHeight, setPanelHeight] = useState(0);
  // Scroll offset on the native driver: keeps the video stack pinned while Up Next scrolls.
  const upNextScrollY = useRef(new Animated.Value(0)).current;
  const upNextScrollEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: upNextScrollY } } }], {
        useNativeDriver: true,
      }),
    [upNextScrollY]
  );
  // How far the panel is folded, in px: follows the finger 1:1 (down folds, up unfolds) on the
  // native driver. It slides up behind the video with a transform, so no layout changes while
  // scrolling and the video stays still. Overscroll at the top (iOS bounce) is ignored.
  const panelFoldRange = Math.max(0, panelHeight - 3);
  const panelFold = useMemo(
    () =>
      Animated.diffClamp(
        upNextScrollY.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 1],
          extrapolateLeft: "clamp",
        }),
        0,
        Math.max(1, panelFoldRange)
      ),
    [upNextScrollY, panelFoldRange]
  );
  const handlePlaybackStarted = useCallback(() => setPlaybackStarted(true), []);

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

  // A tap that lands while Watch is still opening (or the list is shifting under the finger)
  // must not switch away from the video the user just chose.
  const videoOpenedAtRef = useRef(0);
  const upNextChangedAtRef = useRef(0);
  useEffect(() => {
    videoOpenedAtRef.current = Date.now();
  }, [currentPostId]);
  useEffect(() => {
    upNextChangedAtRef.current = Date.now();
  }, [relatedItems]);
  const handleRelatedVideoPress = useCallback(
    (next: HomeFeedVideoOpenPayload) => {
      const now = Date.now();
      if (now - videoOpenedAtRef.current < 900 || now - upNextChangedAtRef.current < 500) {
        console.log("KRISTO_WATCH_RELATED_TAP_IGNORED_DURING_OPEN", {
          currentPostId,
          tappedPostId: String(next?.postId || ""),
        });
        return;
      }
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      onSelectRelated(next);
    },
    [onSelectRelated, currentPostId]
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

  // Rotation is allowed only while Watch is open; everything else stays portrait.
  useEffect(() => {
    if (!visible) return;
    void allowWatchRotation();
    return () => {
      void restoreAppPortrait();
    };
  }, [visible]);

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
    // The floating video follows the native scroll offset. When Watch closes, Animated copies the
    // last offset back into upNextScrollY; a reopened Watch starts at 0 with no scroll event, so
    // without this the video stack sits off-screen (black area, audio playing) until a scroll.
    // Back to 0 also unfolds the panel (panelFold follows the same value).
    upNextScrollY.setValue(0);
  }, [payload?.postId, upNextScrollY]);

  if (!payload) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={WATCH_MODAL_ORIENTATIONS}
    >
      <View
        style={[
          styles.screen,
          isLandscape ? { paddingLeft: insets.left, paddingRight: insets.right } : null,
        ]}
      >
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
            {/* JESUS IS KING stays while scrolling; Messages / missed calls on the right. */}
            <View style={styles.topBar}>
              <View style={styles.topBarTitleRow} pointerEvents="none">
                <Text
                  style={styles.topBarTitleWord}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                >
                  JESUS IS KING
                </Text>
              </View>
              <View style={styles.headerInboxIcons}>
                <HeaderInboxIcons
                  onOpen={handleInboxOpen}
                  size={WATCH_HEADER_INBOX_SIZE}
                  gap={WATCH_HEADER_INBOX_GAP}
                />
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close video"
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>

        {/*
          * The playing video floats above the page: Up Next scrolls underneath it (never over it),
          * with a thin gold edge and shadow so the video reads as being in front. The video stack
          * lives inside the scroll view (held in place by translateY = scroll offset), so a swipe
          * that starts on the video or its panel scrolls Up Next too.
          */}
        <View style={styles.scroll}>
          <Animated.ScrollView
            ref={scrollRef}
            style={StyleSheet.absoluteFill}
            onScroll={upNextScrollEvent}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Up Next starts below the floating video and slides underneath it while scrolling. */}
            <View style={{ height: playerHeight + panelHeight }} />
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

          <Animated.View
            style={[styles.floatingVideoStack, { transform: [{ translateY: upNextScrollY }] }]}
            pointerEvents="box-none"
          >
            <View
              style={[
                styles.playerWrap,
                { height: playerHeight },
                isTikTokLayout ? styles.playerWrapTikTok : null,
              ]}
            >
              {String(payload.item?.source || "").trim().toLowerCase() === "system-admin-video-link" ? (
                <WatchExternalVideoSurface item={payload.item} />
              ) : (
                <WatchVideoSurface
                  payload={payload}
                  isTikTokLayout={isTikTokLayout}
                  isLandscape={isLandscape}
                  onPlaybackStarted={handlePlaybackStarted}
                  onVideoAspect={handleVideoAspect}
                  videoAspect={videoAspect}
                />
              )}
            </View>

            <Animated.View
              style={[
                styles.currentVideoPanelFold,
                { transform: [{ translateY: Animated.multiply(panelFold, -1) }] },
              ]}
            >
            <Animated.View
              style={[
                styles.currentVideoPanel,
                {
                  opacity: panelFold.interpolate({
                    inputRange: [0, Math.max(1, panelFoldRange * 0.6)],
                    outputRange: [1, 0],
                    extrapolate: "clamp",
                  }),
                },
              ]}
              onLayout={(e) => {
                const h = Math.round(e.nativeEvent.layout.height);
                if (h > 0 && h !== panelHeight) setPanelHeight(h);
              }}
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
            </Animated.View>
          </Animated.View>
          </Animated.ScrollView>
        </View>

        <FeedCommentsSheet
          visible={commentsSheetOpen}
          postId={commentTargetPostId}
          youtubeVideo={
            String(item?.source || "") === "system-admin-video-link" &&
            String(item?.videoDisplayType || item?.provider || "").toLowerCase() === "youtube"
          }
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
    paddingHorizontal: WATCH_HEADER_SIDE_PADDING,
  },
  // The title sits between the back button and the (wider) Messages + missed calls buttons, so it
  // is a little left of center and never under them; it shrinks to fit narrow phones.
  topBarTitleRow: {
    position: "absolute",
    left: WATCH_HEADER_TITLE_LEFT,
    right: WATCH_HEADER_TITLE_RIGHT,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  topBarTitleWord: {
    // Exact registered name from @expo-google-fonts/cinzel — no fontWeight (avoids iOS fallback).
    fontFamily: CINZEL_SEMIBOLD_FAMILY,
    color: "#F4D06F",
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: 2,
    textTransform: "uppercase",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  backButton: {
    position: "absolute",
    left: WATCH_HEADER_SIDE_PADDING,
    width: WATCH_HEADER_BACK_SIZE,
    height: WATCH_HEADER_BACK_SIZE,
    borderRadius: WATCH_HEADER_BACK_SIZE / 2,
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
  playerWrap: {
    width: "100%",
    backgroundColor: "#000000",
    // Above the purple panel, which folds up behind the video.
    zIndex: 2,
  },
  playerWrapTikTok: {
    alignItems: "center",
    justifyContent: "center",
  },
  externalVideoSurface: {
    flex: 1,
    width: "100%",
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  externalVideoWebView: { flex: 1, backgroundColor: "#000000" },
  externalVideoWebViewContainer: { flex: 1, backgroundColor: "#000000" },
  externalVideoUnavailable: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  externalVideoUnavailableText: { color: "#FFFFFF", textAlign: "center", fontSize: 14, fontWeight: "700" },
  externalVideoDetails: { flexDirection: "row", alignItems: "center", marginLeft: 9, gap: 4 },
  externalVideoDetailText: { color: HOME_FEED_MUTED, fontSize: 12, lineHeight: 17, fontWeight: "600" },
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
  videoOverBackdrop: {
    height: "100%",
    maxWidth: "100%",
    aspectRatio: 9 / 16,
    alignSelf: "center",
    zIndex: 2,
    backgroundColor: "transparent",
  },
  tikTokVideoBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  inlineTapLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  inlineControls: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  inlineControlButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  iosFullscreenRoot: {
    flex: 1,
    backgroundColor: "#000000",
  },
  iosFullscreenClose: {
    position: "absolute",
    zIndex: 5,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
  },
  tikTokBackdropOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(18,3,31,0.24)",
    zIndex: 1,
  },
  replayOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
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
  floatingVideoStack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 24,
  },
  // Folds to a thin purple line while Up Next is scrolled down. The gold edge and shadow sit here
  // so they follow the panel's bottom edge as it folds.
  currentVideoPanelFold: {
    zIndex: 1,
    backgroundColor: "#5A007A",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(244,208,111,0.55)",
    boxShadow: "0 8px 18px rgba(0,0,0,0.65), 0 2px 10px rgba(168,85,247,0.35)",
  },
  headerInboxIcons: {
    position: "absolute",
    right: WATCH_HEADER_SIDE_PADDING,
  },
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
  metaStatsLine: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    marginTop: 2,
  },
  dateMuted: {
    flexShrink: 1,
    color: WATCH_DATE_COLOR,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
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
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 4,
  },
  watchActionLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "600",
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
