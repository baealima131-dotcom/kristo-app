import React, { memo } from "react";
import { AppState, Image, StyleSheet, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import {
  clearActiveHomeFeedVideo,
  markHomeFeedVideoFirstFrame,
  registerHomeFeedPlayer,
  setActiveHomeFeedVideo,
  unregisterHomeFeedPlayer,
} from "@/src/lib/homeFeedVideoOwner";
import { markHomeFeedVideoPreloadReady } from "@/src/lib/homeFeedVideoReadiness";
import {
  getHomeFeedVideoProgress,
  peekHomeFeedVideoRestoreSeek,
  saveHomeFeedVideoProgress,
} from "@/src/lib/homeFeedVideoProgressStore";
import { getHomeFeedPosterLoadTimeoutMs } from "@/src/lib/videoGridThumbnail";
import {
  hasBrandedVideoPoster,
  isValidVideoPosterUri,
  type PosterMetadataSnapshot,
  snapshotPosterMetadata,
} from "./homeFeedUtils";
import { FeedVideoPosterImage, VideoPostFallbackPoster } from "./VideoPostFallbackPoster";

/** Role is derived by the feed window and enforced by homeFeedVideoOwner. */
export type HomeFeedVideoRole = "active" | "preload" | "inactive";

type Props = {
  postId?: string;
  recycleKey?: string;
  uri: string;
  title?: string;
  mediaStatus?: string;
  posterUri?: string;
  posterMetadata?: PosterMetadataSnapshot;
  videoDurationMs?: number;
  brandedPoster?: boolean;
  role: HomeFeedVideoRole;
  screenFocused: boolean;
  feedIndex?: number;
  isFirstFeedVideo?: boolean;
  onDoubleTap?: () => void;
};

/** Low-latency progressive streaming: start fast, buffer ahead in background. */
const PROGRESSIVE_BUFFER_OPTIONS = {
  preferredForwardBufferDuration: 4,
  waitsToMinimizeStalling: false,
  minBufferForPlayback: 0.5,
  prioritizeTimeOverSizeThreshold: true,
} as const;

/** A truly painted frame: playback position has advanced past 0. */
function hasPaintedFrame(currentTime: number) {
  return currentTime > 0.03;
}

function statusLower(status: unknown) {
  return String(status || "").trim().toLowerCase();
}

function safeNumber(read: () => number, fallback = 0) {
  try {
    const v = Number(read());
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Thin Home Feed video. All "who plays" decisions live in homeFeedVideoOwner.
 * This component only:
 *  - attaches a stable single source (no quality swapping / no remount),
 *  - reports active/inactive intent + first frame to the owner,
 *  - plays ONLY when it is the active row (muted until first frame),
 *  - never plays when preloading (buffer-only, currentTime never advances),
 *  - holds the poster until a real frame paints.
 */
export const HomeFeedVideoPlayer = memo(function HomeFeedVideoPlayer({
  postId = "",
  recycleKey = "",
  uri,
  title = "",
  mediaStatus = "",
  posterUri = "",
  posterMetadata,
  videoDurationMs,
  brandedPoster = false,
  role,
  screenFocused,
  feedIndex = -1,
  isFirstFeedVideo = false,
  onDoubleTap,
}: Props) {
  const key = String(recycleKey || postId).trim();
  const isRecycledRow = Boolean(String(recycleKey || "").trim());
  const playbackUri = String(uri || "").trim();

  const [appActive, setAppActive] = React.useState(() => AppState.currentState === "active");
  const [firstFrameReady, setFirstFrameReady] = React.useState(false);

  const playerDisposedRef = React.useRef(false);
  const mountMsRef = React.useRef(Date.now());
  const lastTimeRef = React.useRef(0);
  const userPausedRef = React.useRef(false);
  const progressRestoredRef = React.useRef(false);
  const preloadStartedLoggedRef = React.useRef(false);
  const preloadReadyLoggedRef = React.useRef(false);
  const firstFrameMarkedRef = React.useRef(false);
  const lastSavedMsRef = React.useRef(0);

  const sourceAttached = role !== "inactive";
  const isActiveIntent = role === "active" && screenFocused && appActive;

  const player = useVideoPlayer(
    sourceAttached && playbackUri
      ? { uri: playbackUri, contentType: "progressive" as const }
      : null,
    (p) => {
      p.loop = true;
      p.muted = true;
      try {
        p.bufferOptions = { ...PROGRESSIVE_BUFFER_OPTIONS };
      } catch {}
      // Buffer-only for preload: never play() a non-active row.
      try {
        p.pause();
      } catch {}
    }
  );

  // expo-video's StatusChangeEventPayload typing is loose; read defensively and
  // normalize to a lowercased string we control.
  const statusEvent = useEvent(player, "statusChange") as { status?: unknown } | null;
  const status = statusLower(statusEvent?.status ?? (player as any)?.status);

  const safePlay = React.useCallback(() => {
    if (playerDisposedRef.current) return;
    try {
      player.play();
    } catch {}
  }, [player]);

  const safePause = React.useCallback(() => {
    if (playerDisposedRef.current) return;
    try {
      player.pause();
    } catch {}
  }, [player]);

  const safeSetMuted = React.useCallback(
    (muted: boolean) => {
      if (playerDisposedRef.current) return;
      try {
        (player as any).muted = muted;
      } catch {}
    },
    [player]
  );

  const saveProgress = React.useCallback(
    (reason: string) => {
      if (isRecycledRow || !postId) return;
      const t = playerDisposedRef.current
        ? lastTimeRef.current
        : safeNumber(() => (player as any).currentTime);
      if (t > 0.25) {
        const now = Date.now();
        if (now - lastSavedMsRef.current < 400 && reason !== "unmount") return;
        lastSavedMsRef.current = now;
        saveHomeFeedVideoProgress(postId, t);
      }
    },
    [isRecycledRow, postId, player]
  );

  // Register a handle so the owner can silence this player when another becomes
  // active. The owner is the only thing allowed to pause us from outside.
  React.useEffect(() => {
    playerDisposedRef.current = false;
    registerHomeFeedPlayer({
      key,
      postId,
      index: feedIndex,
      play: () => safePlay(),
      pause: () => safePause(),
      setMuted: (m: boolean) => safeSetMuted(m),
    });
    return () => {
      playerDisposedRef.current = true;
      saveProgress("unmount");
      try {
        player.pause();
      } catch {}
      unregisterHomeFeedPlayer(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, player]);

  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setAppActive(next === "active"));
    return () => sub.remove();
  }, []);

  // Restore saved playback position once when this row owns playback.
  React.useEffect(() => {
    if (progressRestoredRef.current || playerDisposedRef.current) return;
    if (role !== "active" || isRecycledRow || !postId) return;
    const saved = getHomeFeedVideoProgress(postId);
    if (saved === null || saved <= 0.1) {
      progressRestoredRef.current = true;
      return;
    }
    const seekTo = peekHomeFeedVideoRestoreSeek(postId);
    if (seekTo === null) {
      progressRestoredRef.current = true;
      return;
    }
    progressRestoredRef.current = true;
    try {
      (player as any).currentTime = seekTo;
      lastTimeRef.current = seekTo;
    } catch {}
    console.log("KRISTO_HOME_FEED_RESTORE", { scope: "video-position", postId, seconds: seekTo });
  }, [role, isRecycledRow, postId, player, status]);

  // Core ownership/playback effect — single place that decides play vs pause.
  React.useEffect(() => {
    if (playerDisposedRef.current) return;

    if (role === "active") {
      if (isActiveIntent) {
        setActiveHomeFeedVideo(key, { postId, index: feedIndex });
        if (!userPausedRef.current) safePlay();
      } else {
        // Active row but screen blurred / app backgrounded: stop & release.
        safePause();
        safeSetMuted(true);
        saveProgress("blur");
        clearActiveHomeFeedVideo(key, "blur");
      }
      return;
    }

    // Preload + inactive: buffer-only. Never play, always muted.
    safePause();
    safeSetMuted(true);

    if (role === "preload" && !preloadStartedLoggedRef.current && sourceAttached && playbackUri) {
      preloadStartedLoggedRef.current = true;
      console.log("KRISTO_VIDEO_PRELOAD_STARTED", { key, postId, index: feedIndex });
    }
  }, [
    role,
    isActiveIntent,
    key,
    postId,
    feedIndex,
    sourceAttached,
    playbackUri,
    safePlay,
    safePause,
    safeSetMuted,
    saveProgress,
  ]);

  // Status-driven: first frame detection, audio gate, preload-ready signal.
  React.useEffect(() => {
    if (playerDisposedRef.current) return;
    const lower = statusLower(status);
    const t = safeNumber(() => (player as any).currentTime);
    if (t > 0) lastTimeRef.current = t;

    // Preload buffered enough to hand off instantly.
    if (
      role === "preload" &&
      !preloadReadyLoggedRef.current &&
      (lower === "readytoplay" || lower === "loaded")
    ) {
      preloadReadyLoggedRef.current = true;
      markHomeFeedVideoPreloadReady(postId, playbackUri);
      console.log("KRISTO_VIDEO_PRELOAD_READY", { key, postId, index: feedIndex });
    }

    if (role !== "active") return;

    if (hasPaintedFrame(t)) {
      if (!firstFrameMarkedRef.current) {
        firstFrameMarkedRef.current = true;
        markHomeFeedVideoPreloadReady(postId, playbackUri);
        markHomeFeedVideoFirstFrame(key, { postId, msFromMount: Date.now() - mountMsRef.current });
      }
      if (!firstFrameReady) setFirstFrameReady(true);
      // Audio is allowed only after the first real frame, while focused.
      if (isActiveIntent && !userPausedRef.current) {
        safeSetMuted(false);
        safePlay();
      }
    }
  }, [status, role, key, postId, playbackUri, feedIndex, isActiveIntent, firstFrameReady, player, safePlay, safeSetMuted]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, playbackUri);
  const hasBranded = brandedPoster || hasBrandedVideoPoster({ posterUri: poster, brandedPoster });
  const showCover = !firstFrameReady;
  const showPosterOverlay = showCover && hasPoster;
  const showBrandedOrFallback = showCover && !hasPoster;
  const resolvedPosterMetadata =
    posterMetadata || snapshotPosterMetadata({ posterUri, brandedPoster });
  const posterTimeoutMs = getHomeFeedPosterLoadTimeoutMs();

  React.useEffect(() => {
    // Preload the active poster image (cheap network image) so the cover is
    // ready instantly — but never trigger video-frame snapshotting here.
    if (role === "active" && hasPoster) {
      Image.prefetch(poster).catch(() => {});
    }
  }, [role, hasPoster, poster]);

  const showControls = role === "active" && screenFocused && firstFrameReady;

  const togglePlayPause = React.useCallback(() => {
    if (!showControls || playerDisposedRef.current) return;
    const playing = safeNumber(() => ((player as any).playing ? 1 : 0)) === 1;
    if (playing) {
      userPausedRef.current = true;
      safePause();
    } else {
      userPausedRef.current = false;
      safeSetMuted(false);
      safePlay();
    }
  }, [showControls, player, safePause, safePlay, safeSetMuted]);

  const gesture = React.useMemo(() => {
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(250)
      .onEnd(() => runOnJS(togglePlayPause)());
    if (!onDoubleTap) return singleTap;
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(300)
      .onEnd(() => runOnJS(onDoubleTap)());
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [togglePlayPause, onDoubleTap]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.root}>
        <VideoView
          player={player}
          style={[styles.videoSurface, showCover && styles.videoHidden]}
          contentFit="cover"
          nativeControls={false}
        />
        {showPosterOverlay ? (
          <View style={styles.overlay} pointerEvents="none">
            <FeedVideoPosterImage
              uri={poster}
              style={styles.overlayFill}
              resizeMode="cover"
              postId={postId}
              title={title}
              videoUrl={playbackUri}
              mediaStatus={mediaStatus}
              previewLoadTimeoutMs={posterTimeoutMs}
              posterMetadata={resolvedPosterMetadata}
              videoDurationMs={videoDurationMs}
              // Startup priority: never decode a poster frame off the same file
              // while a Home Feed video is racing to paint its first frame.
              enableVideoFrameFallback={false}
            />
          </View>
        ) : null}
        {showBrandedOrFallback ? (
          <View style={styles.overlay} pointerEvents="none">
            <VideoPostFallbackPoster
              variant="full"
              postId={postId}
              title={title}
              videoUrl={playbackUri}
              mediaStatus={mediaStatus}
              suppressMissingPosterLog={hasBranded}
            />
          </View>
        ) : null}
        {showControls && userPausedRef.current ? (
          <View style={styles.centerPlayOverlay} pointerEvents="none">
            <View style={styles.centerPlayButton}>
              <Ionicons name="play" size={34} color="rgba(255,255,255,0.96)" />
            </View>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#1B2A44",
  },
  videoSurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  videoHidden: {
    opacity: 0,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  overlayFill: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  centerPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  centerPlayButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    paddingLeft: 4,
  },
});
