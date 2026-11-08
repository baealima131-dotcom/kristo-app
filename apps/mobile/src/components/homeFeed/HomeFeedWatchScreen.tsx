import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Image,
  Modal,
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
  resolveWatchPlayerHeight,
} from "@/src/lib/homeFeedYouTubeLayout";
import { resolveHomeFeedVideoDisplayType } from "@/src/lib/homeFeedVideoDisplayType";
import { resolveVideoDurationMs } from "@/src/lib/mediaVideoPoster";
import {
  allowWatchRotation,
  isScreenLandscapeNow,
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

  return (
    <View style={styles.watchActionsRow}>
      <WatchPanelAction
        icon={engagement.likedByMe || engagement.liked ? "heart" : "heart-outline"}
        label={formatActionCount(engagement.likeCount)}
        active={engagement.likedByMe || engagement.liked}
        activeColor="#FF6B8A"
        onPress={onLike}
      />
      <WatchPanelAction
        icon="chatbubble-ellipses-outline"
        label={formatActionCount(engagement.commentCount)}
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
const WATCH_MODAL_ORIENTATIONS: React.ComponentProps<typeof Modal>["supportedOrientations"] = [
  "portrait",
  "landscape-left",
  "landscape-right",
];
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
}: {
  payload: HomeFeedVideoOpenPayload;
  isTikTokLayout?: boolean;
  isLandscape?: boolean;
  onPlaybackStarted?: () => void;
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
  const fullscreenRef = useRef(false);
  const isLandscapeRef = useRef(isLandscape);
  isLandscapeRef.current = isLandscape;
  // Set when fullscreen is left while the screen is still landscape (Back, Done,
  // video end). Cleared once the screen is portrait again, so auto-rotate re-arms.
  const autoFullscreenSuppressedRef = useRef(false);
  // Bumped after fullscreen closes so auto-enter re-checks the real orientation
  // even when window dimensions did not change in between (quick rotations).
  const [autoFullscreenRecheck, setAutoFullscreenRecheck] = useState(0);
  // Last screen orientation read from native. On Android, window dimension
  // events can be missed after quick rotations around fullscreen, so this is
  // the fallback source of truth for auto-enter.
  const nativeLandscapeRef = useRef<boolean | null>(null);

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
    (p) => {
      p.loop = true;
      p.muted = true;
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

  useEventListener(player, "playToEnd", () => {
    if (fullscreenRef.current) {
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
          activeBackdrop.loop = true;
          tryWatchAutoPlay(activeBackdrop, {
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

  useEffect(() => {
    console.log("KRISTO_WATCH_ORIENTATION_STATE", {
      postId,
      isLandscape,
      ended,
      fullscreen: fullscreenRef.current,
      suppressed: autoFullscreenSuppressedRef.current,
      recheck: autoFullscreenRecheck,
      nativeLandscape: nativeLandscapeRef.current,
    });
    if (!isLandscape && nativeLandscapeRef.current !== true) {
      autoFullscreenSuppressedRef.current = false;
      return;
    }
    if (ended || fullscreenRef.current || autoFullscreenSuppressedRef.current) return;
    let cancelled = false;
    // Let the rotated layout settle before presenting fullscreen.
    const timer = setTimeout(async () => {
      if (cancelled) return;
      // Window dimensions can lag or miss a real rotation; the native screen
      // orientation decides, so a quick rotation back does not enter fullscreen.
      const nativeLandscape = await isScreenLandscapeNow();
      if (nativeLandscape !== null) nativeLandscapeRef.current = nativeLandscape;
      const landscapeNow = nativeLandscape ?? isLandscapeRef.current;
      if (cancelled || !landscapeNow) {
        console.log("KRISTO_WATCH_AUTO_FULLSCREEN_SKIPPED", { postId, reason: "no-longer-landscape" });
        return;
      }
      const view = videoViewRef.current;
      if (!view || fullscreenRef.current || endedRef.current) return;
      if (autoFullscreenSuppressedRef.current) return;
      fullscreenRef.current = true;
      console.log("KRISTO_WATCH_AUTO_FULLSCREEN_ENTER", { postId });
      view.enterFullscreen().catch((error: any) => {
        fullscreenRef.current = false;
        console.log("KRISTO_WATCH_AUTO_FULLSCREEN_FAILED", {
          postId,
          error: String(error?.message || error || "unknown"),
        });
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLandscape, ended, postId, autoFullscreenRecheck]);

  // Reconcile with the native screen orientation while Watch is inline. Any
  // native change re-runs auto-enter, because JS window dimensions may be stale.
  useEffect(() => {
    if (isFullscreen || ended) return;
    let stopped = false;
    const interval = setInterval(async () => {
      const nativeLandscape = await isScreenLandscapeNow();
      if (stopped || nativeLandscape === null) return;
      const previous = nativeLandscapeRef.current;
      nativeLandscapeRef.current = nativeLandscape;
      if (!nativeLandscape) {
        autoFullscreenSuppressedRef.current = false;
      }
      if (nativeLandscape !== previous) {
        console.log("KRISTO_WATCH_ORIENTATION_RECONCILE", { postId, nativeLandscape });
        setAutoFullscreenRecheck((n) => n + 1);
      }
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [isFullscreen, ended, postId]);

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
      saveHomeFeedVideoProgress(postId, currentTime, durationSec);
    }
  });

  const handleFullscreenEnter = useCallback(() => {
    fullscreenRef.current = true;
    setIsFullscreen(true);
    console.log("KRISTO_WATCH_FULLSCREEN_ENTER", { postId, landscape: isLandscapeRef.current });
  }, [postId]);

  const handleFullscreenExit = useCallback(
    (event?: { nativeEvent?: { autoExited?: boolean } }) => {
      fullscreenRef.current = false;
      setIsFullscreen(false);
      // Android reports autoExited when fullscreen closed because the device was
      // rotated back to portrait. Only a manual exit (Back, button, Done) while the
      // screen is landscape should hold off auto-enter until portrait is seen.
      const autoExited = event?.nativeEvent?.autoExited === true;
      void (async () => {
        const nativeLandscape = autoExited ? false : await isScreenLandscapeNow();
        const landscape = nativeLandscape ?? isLandscapeRef.current;
        if (nativeLandscape !== null) nativeLandscapeRef.current = nativeLandscape;
        autoFullscreenSuppressedRef.current = !autoExited && landscape;
        console.log("KRISTO_WATCH_FULLSCREEN_EXIT", {
          postId,
          autoExited,
          landscape,
          suppressed: autoFullscreenSuppressedRef.current,
        });
        setAutoFullscreenRecheck((n) => n + 1);
      })();
    },
    [postId]
  );

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
      {!ended || isFullscreen ? (
        <VideoView
          ref={videoViewRef}
          player={player}
          style={isTikTokLayout ? styles.videoOverBackdrop : styles.video}
          contentFit="contain"
          nativeControls
          fullscreenOptions={WATCH_FULLSCREEN_OPTIONS}
          onFullscreenEnter={handleFullscreenEnter}
          onFullscreenExit={handleFullscreenExit}
        />
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

/** Current-video metadata — avatar, church, title, date. */
function WatchVideoMeta({ item, fallbackTitle = "" }: { item: any; fallbackTitle?: string }) {
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolveHomeFeedVideoTitle(item);
  const titleLine = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle || fallbackTitle;
  const whenLabel = formatFeedTimestamp(item?.createdAt);

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
  const isTikTokLayout = displayType === "tiktok";
  const isLandscape = width > windowHeight;
  const playerHeight = useMemo(
    () =>
      resolveWatchPlayerHeight({
        windowWidth: width,
        windowHeight,
        topInset: insets.top,
        isTikTokLayout,
      }),
    [width, windowHeight, insets.top, isTikTokLayout]
  );
  const scrollRef = useRef<ScrollView | null>(null);
  const [playbackStarted, setPlaybackStarted] = useState(false);

  /*
   * Collapsing chrome (like YouTube): scrolling Up Next down folds the purple header to a slim bar
   * (back + creator avatar + church name, no "JESUS IS KING") and folds the purple panel under the
   * video to a thin line. Scrolling up, or reaching the top, opens both again.
   */
  const collapse = useRef(new Animated.Value(0)).current;
  const collapsedRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const setChromeCollapsed = useCallback(
    (next: boolean) => {
      if (collapsedRef.current === next) return;
      collapsedRef.current = next;
      Animated.timing(collapse, { toValue: next ? 1 : 0, duration: 220, useNativeDriver: false }).start();
    },
    [collapse]
  );
  const handleUpNextScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = Math.max(0, e.nativeEvent.contentOffset.y);
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;
      if (y <= 4) setChromeCollapsed(false);
      else if (dy > 6) setChromeCollapsed(true);
      else if (dy < -6) setChromeCollapsed(false);
    },
    [setChromeCollapsed]
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
    lastScrollYRef.current = 0;
    setChromeCollapsed(false);
  }, [payload?.postId, setChromeCollapsed]);

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
            <Animated.View
              style={[
                styles.topBar,
                { height: collapse.interpolate({ inputRange: [0, 1], outputRange: [52, 44] }) },
              ]}
            >
              <Animated.View
                style={[
                  styles.topBarTitleRow,
                  { opacity: collapse.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: "clamp" }) },
                ]}
                pointerEvents="none"
              >
                <Text style={styles.topBarTitleWord} numberOfLines={1}>
                  JESUS
                </Text>
                <Text style={styles.topBarTitleWord} numberOfLines={1}>
                  IS
                </Text>
                <Text style={styles.topBarTitleWord} numberOfLines={1}>
                  KING
                </Text>
              </Animated.View>
              {item ? (
                <>
                  {/* Expanded: creator avatar on the right of JESUS IS KING. */}
                  <Animated.View
                    style={[
                      styles.headerAvatarRight,
                      { opacity: collapse.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: "clamp" }) },
                    ]}
                  >
                    <FeedChurchBrandRow item={item} variant="watch" part="avatar" source="watch-header" />
                  </Animated.View>
                  {/* Collapsed: creator avatar + church name next to the back button. */}
                  <Animated.View
                    style={[
                      styles.headerCompactRow,
                      { opacity: collapse.interpolate({ inputRange: [0.5, 1], outputRange: [0, 1], extrapolate: "clamp" }) },
                    ]}
                    pointerEvents="none"
                  >
                    <View style={styles.headerCompactAvatar}>
                      <FeedChurchBrandRow item={item} variant="watch" part="avatar" source="watch-header-compact" />
                    </View>
                    <Text
                      style={styles.headerCompactName}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {resolveChurchName(item)}
                    </Text>
                  </Animated.View>
                </>
              ) : null}
              <Pressable
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close video"
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
              </Pressable>
            </Animated.View>
          </View>
        </View>

        {/*
          * The playing video floats above the page: Up Next scrolls underneath it (never over it),
          * with a thin gold edge and shadow so the video reads as being in front.
          */}
        <View style={styles.scroll}>
          <ScrollView
            ref={scrollRef}
            style={StyleSheet.absoluteFill}
            onScroll={handleUpNextScroll}
            scrollEventThrottle={16}
            // Up Next starts below the floating video and slides underneath it while scrolling.
            contentContainerStyle={{ paddingTop: playerHeight + panelHeight, paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
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
          </ScrollView>

          <View style={styles.floatingVideoStack} pointerEvents="box-none">
            <View
              style={[
                styles.playerWrap,
                { height: playerHeight },
                isTikTokLayout ? styles.playerWrapTikTok : null,
              ]}
            >
              <WatchVideoSurface
                payload={payload}
                isTikTokLayout={isTikTokLayout}
                isLandscape={isLandscape}
                onPlaybackStarted={handlePlaybackStarted}
              />
            </View>

            <Animated.View
              style={[
                styles.currentVideoPanelFold,
                panelHeight > 0
                  ? { height: collapse.interpolate({ inputRange: [0, 1], outputRange: [panelHeight, 3] }) }
                  : null,
              ]}
            >
            <Animated.View
              style={[
                styles.currentVideoPanel,
                { opacity: collapse.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: "clamp" }) },
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
          </View>
        </View>

        <FeedCommentsSheet
          visible={commentsSheetOpen}
          postId={commentTargetPostId}
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
  playerWrap: {
    width: "100%",
    backgroundColor: "#000000",
  },
  playerWrapTikTok: {
    alignItems: "center",
    justifyContent: "center",
  },
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
    aspectRatio: 9 / 16,
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
    backgroundColor: "#000000",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(244,208,111,0.55)",
    boxShadow: "0 8px 18px rgba(0,0,0,0.65), 0 2px 10px rgba(168,85,247,0.35)",
  },
  // Folds to a thin purple line while Up Next is scrolled down.
  currentVideoPanelFold: {
    overflow: "hidden",
    backgroundColor: "#5A007A",
  },
  headerAvatarRight: {
    position: "absolute",
    right: 12,
  },
  headerCompactRow: {
    position: "absolute",
    left: 62,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerCompactAvatar: {
    transform: [{ scale: 0.82 }],
  },
  // Long church names wrap to two lines and shrink a little instead of being cut off.
  headerCompactName: {
    flex: 1,
    color: "#F4D06F",
    fontSize: 16,
    lineHeight: 19,
    fontWeight: "800",
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
