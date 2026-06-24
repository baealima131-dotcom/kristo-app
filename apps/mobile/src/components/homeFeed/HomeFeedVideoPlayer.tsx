import React, { memo } from "react";
import { ActivityIndicator, AppState, Image, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import {
  safePauseVideoPlayer,
  safePlayVideoPlayer,
} from "@/src/lib/expoVideoPlayerSafe";
import { useEvent } from "expo";
import {
  claimStartupVideoPlayer,
  holdStartupVideoPlayerForRemount,
  isStartupFirstVideoTarget,
  isStartupVideoPendingAdoption,
  isStartupVideoReadyForAdoption,
  subscribeHomeFeedVideoPrime,
} from "@/src/lib/homeFeedVideoPrime";
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
import {
  markHomeFeedVideoFirstFrameShown,
  markHomeFeedVideoWatched,
  wasHomeFeedVideoFirstFrameShown,
} from "@/src/lib/homeFeedVideoRetention";
import { getHomeFeedPosterLoadTimeoutMs } from "@/src/lib/videoGridThumbnail";
import { logFirstMountedHomeFeedVideoFileDiag } from "@/src/lib/homeFeedVideoFileDiag";
import {
  getCachedVideoUri,
  resolveHomeFeedPlaybackUri,
  subscribeHomeFeedVideoDiskCache,
} from "@/src/lib/homeFeedVideoDiskCache";
import { isHomeFeedInlineVideoAutoplayEnabled } from "@/src/lib/homeFeedVideoMode";
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
  /**
   * When true and role==="preload", briefly decode-prime this row (play muted
   * until the first frame paints, then pause). Set for the forward neighbors so
   * they are decode-ready before the user scrolls to them.
   */
  decodePrime?: boolean;
  feedFaststart?: boolean | null;
  onDoubleTap?: () => void;
};

/** Decode-prime watchdog: never keep a preload row playing longer than this. */
const DECODE_PRIME_TIMEOUT_MS = 12_000;

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

/** iOS keeps AVPlayerLayer composited at this opacity (see HomeFeedVideoPrimer). */
const VIDEO_COVER_OPACITY = 0.02;

const SEEK_VISIBLE_TOLERANCE_SEC = 0.75;
const ACTIVE_BUFFER_READY_PCT = 50;
const STUCK_RECOVERY_INITIAL_MS = 1000;
const STUCK_RECOVERY_STEP_MS = 800;
const BUFFER_PROGRESS_LOG_MS = 600;
const PLAYBACK_STALL_POLL_MS = 700;
const PLAYBACK_STALL_THRESHOLD_MS = 1200;
const PLAYBACK_STALL_ADVANCE_SEC = 0.05;
const PLAYBACK_STALL_RECOVERY_STEP_MS = 700;

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

function computeBufferPercent(
  player: VideoPlayer | null,
  status: string,
  currentTime: number
): number {
  if (!player) return 0;
  const lower = statusLower(status);
  if (hasPaintedFrame(currentTime)) return 100;

  const buffered = safeNumber(() => (player as any).bufferedPosition, -1);
  const duration = safeNumber(() => (player as any).duration, 0);

  if (buffered < 0) {
    if (lower === "readytoplay" || lower === "loaded") return ACTIVE_BUFFER_READY_PCT;
    return 0;
  }

  if (duration > 0.5) {
    return Math.min(100, Math.round((buffered / duration) * 100));
  }

  const ahead = Math.max(0, buffered - currentTime);
  return Math.min(100, Math.round((ahead / 4) * 100));
}

function isActiveBufferReady(
  bufferPercent: number,
  status: string,
  primed: boolean,
  currentTime: number
): boolean {
  if (primed || hasPaintedFrame(currentTime)) return true;
  if (bufferPercent >= ACTIVE_BUFFER_READY_PCT) return true;
  const lower = statusLower(status);
  return lower === "readytoplay" || lower === "loaded";
}

function readPlayerPlaybackSnapshot(player: VideoPlayer | null) {
  return {
    currentTime: safeNumber(() => (player as any)?.currentTime),
    playing: safeNumber(() => (((player as any)?.playing ? 1 : 0) as number)) === 1,
    muted: safeNumber(() => (((player as any)?.muted ? 1 : 0) as number)) === 1,
  };
}

function appendRemountQuery(uri: string, epoch: number): string {
  if (!uri || epoch <= 0) return uri;
  if (uri.startsWith("file://")) return uri;
  const sep = uri.includes("?") ? "&" : "?";
  return `${uri}${sep}_kristoRm=${epoch}`;
}

function resolveVideoPlayerContentType(uri: string): "auto" | "progressive" {
  return String(uri || "").trim().startsWith("file://") ? "auto" : "progressive";
}

function buildVideoPlayerSource(uri: string) {
  const trimmed = String(uri || "").trim();
  if (!trimmed) return null;
  return { uri: trimmed, contentType: resolveVideoPlayerContentType(trimmed) };
}

/**
 * Thin Home Feed video. All "who plays" decisions live in homeFeedVideoOwner.
 * This component only:
 *  - attaches a stable single source (no quality swapping / no remount),
 *  - reports active/inactive intent + first frame to the owner,
 *  - plays ONLY when it is the active row (muted until first frame),
 *  - never plays when preloading (buffer-only, currentTime never advances),
 *  - holds the poster until an active visible frame is confirmed (not preload decode alone),
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
  decodePrime = false,
  feedFaststart = null,
  onDoubleTap,
}: Props) {
  const key = String(recycleKey || postId).trim();
  const isRecycledRow = Boolean(String(recycleKey || "").trim());
  const remotePlaybackUri = String(uri || "").trim();
  const [diskCacheRevision, setDiskCacheRevision] = React.useState(0);
  const [, setPrimeRevision] = React.useState(0);

  React.useEffect(() => subscribeHomeFeedVideoDiskCache(() => setDiskCacheRevision((n) => n + 1)), []);
  React.useEffect(() => subscribeHomeFeedVideoPrime(() => setPrimeRevision((n) => n + 1)), []);

  const playbackUri = React.useMemo(
    () => resolveHomeFeedPlaybackUri(remotePlaybackUri),
    [remotePlaybackUri, diskCacheRevision]
  );
  const diskCacheReady = Boolean(getCachedVideoUri(remotePlaybackUri));

  const sourceAttached = role !== "inactive";
  const isStartupFirstVideoRow = isFirstFeedVideo && role === "active";
  const startupTarget = isStartupFirstVideoTarget(remotePlaybackUri, postId);

  React.useEffect(() => {
    if (isFirstFeedVideo || role === "active") {
      console.log("KRISTO_STARTUP_TARGET_DIAG", {
        key,
        postId,
        role,
        isFirstFeedVideo,
        startupTarget,
        remotePlaybackUri,
      });
    }
  }, [key, postId, role, isFirstFeedVideo, startupTarget, remotePlaybackUri]);

  const playerDisposedRef = React.useRef(false);
  const mountMsRef = React.useRef(Date.now());
  const lastTimeRef = React.useRef(0);
  const userPausedRef = React.useRef(false);
  const progressRestoredRef = React.useRef(false);
  const preloadStartedLoggedRef = React.useRef(false);
  const preloadReadyLoggedRef = React.useRef(false);
  const preloadReadyRef = React.useRef(false);
  const firstFrameMarkedRef = React.useRef(false);
  const visibleConfirmLoggedRef = React.useRef(false);
  const lastSavedMsRef = React.useRef(0);
  const decodePrimedRef = React.useRef(false);
  const decodePrimingRef = React.useRef(false);
  const startupReuseFailedRef = React.useRef(false);
  const prevRoleRef = React.useRef(role);
  const seekPendingRef = React.useRef<number | null>(null);
  const stuckRecoveryStepRef = React.useRef(0);
  const stuckRecoveryStartedRef = React.useRef(false);
  const playbackStallSinceMsRef = React.useRef<number | null>(null);
  const playbackStallRecoveringRef = React.useRef(false);
  const playbackStallRecoveryStepRef = React.useRef(0);
  const lastBufferLogAtRef = React.useRef(0);
  const [playerRemountEpoch, setPlayerRemountEpoch] = React.useState(0);
  const [bufferPercent, setBufferPercent] = React.useState(0);

  const effectivePlaybackUri = React.useMemo(
    () => appendRemountQuery(playbackUri, playerRemountEpoch),
    [playbackUri, playerRemountEpoch]
  );

  React.useEffect(() => {
    if (!role || !effectivePlaybackUri) return;
    console.log("KRISTO_VIDEO_PLAYBACK_SOURCE", {
      key,
      postId,
      index: feedIndex,
      source: effectivePlaybackUri.startsWith("file://") ? "file" : "remote",
      uri: effectivePlaybackUri,
      remoteUri: remotePlaybackUri,
    });
  }, [effectivePlaybackUri, role, key, postId, feedIndex, remotePlaybackUri]);

  React.useEffect(() => {
    if (role !== "active") return;
    const source = effectivePlaybackUri.startsWith("file://") ? "file" : "remote";
    if (source === "remote") {
      console.log("KRISTO_VIDEO_STARTUP_BLOCKER", {
        key,
        postId,
        index: feedIndex,
        reason: "active-remote-source",
        source,
        uri: effectivePlaybackUri,
        remoteUri: remotePlaybackUri,
        isFirstFeedVideo,
      });
    }
  }, [role, effectivePlaybackUri, key, postId, feedIndex, remotePlaybackUri, isFirstFeedVideo]);

  // Wait for startup-primed player (primed=true) — never steal it mid-decode.
  const [adoptedPlayer, setAdoptedPlayer] = React.useState<VideoPlayer | null>(null);
  const adoptedPlayerRef = React.useRef<VideoPlayer | null>(null);
  const [startupReuseResolved, setStartupReuseResolved] = React.useState(
    () => !(startupTarget || isStartupFirstVideoRow)
  );

  React.useEffect(() => {
    adoptedPlayerRef.current = adoptedPlayer;
  }, [adoptedPlayer]);

  const [appActive, setAppActive] = React.useState(() => AppState.currentState === "active");
  /** Visible first frame while active — poster stays until this is true. */
  const [firstFrameReady, setFirstFrameReady] = React.useState(
    () => Boolean(postId) && wasHomeFeedVideoFirstFrameShown(postId)
  );
  const firstFrameReadyRef = React.useRef(firstFrameReady);

  React.useEffect(() => {
    if (!postId) return;
    if (wasHomeFeedVideoFirstFrameShown(postId) && !firstFrameReadyRef.current) {
      firstFrameReadyRef.current = true;
      setFirstFrameReady(true);
    }
  }, [postId]);

  const isActiveIntent = role === "active" && screenFocused && appActive;

  const startupSourceAllowed =
    !isStartupFirstVideoRow ||
    Boolean(adoptedPlayer) ||
    diskCacheReady ||
    firstFrameReady ||
    startupReuseResolved;

  // Defer hook player until startup reuse resolves — avoids a second decode instance.
  const hookPlayerRef = React.useRef<VideoPlayer | null>(null);
  const hookPlayer = useVideoPlayer(
    adoptedPlayer
      ? null
      : !startupSourceAllowed
        ? null
        : sourceAttached && effectivePlaybackUri
          ? buildVideoPlayerSource(effectivePlaybackUri)
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

  hookPlayerRef.current = hookPlayer;

  const player = adoptedPlayer ?? hookPlayer;
  const mountedPlaybackUriRef = React.useRef("");

  React.useEffect(() => {
    mountedPlaybackUriRef.current = "";
  }, [playerRemountEpoch, key]);

  // expo-video's StatusChangeEventPayload typing is loose; read defensively and
  // normalize to a lowercased string we control.
  const statusEvent = useEvent(player, "statusChange") as { status?: unknown } | null;
  const status = statusLower(statusEvent?.status ?? (player as any)?.status);

  const safePlay = React.useCallback(() => {
    if (playerDisposedRef.current) return;
    safePlayVideoPlayer(player, { source: "home-feed-video-player" });
  }, [player]);

  const safePause = React.useCallback(() => {
    if (playerDisposedRef.current) return;
    safePauseVideoPlayer(player, { source: "home-feed-video-player" });
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

  React.useEffect(() => {
    if (playerDisposedRef.current || !player || adoptedPlayer) return;
    if (!sourceAttached || !effectivePlaybackUri) return;

    const prevUri = mountedPlaybackUriRef.current;
    if (!prevUri) {
      mountedPlaybackUriRef.current = effectivePlaybackUri;
      return;
    }
    if (prevUri === effectivePlaybackUri) return;

    mountedPlaybackUriRef.current = effectivePlaybackUri;
    const source = buildVideoPlayerSource(effectivePlaybackUri);
    if (!source) return;

    let cancelled = false;
    void (async () => {
      try {
        const currentUri = String((player as any)?.source?.uri || "").trim();
        if (currentUri === effectivePlaybackUri) return;

        if (typeof (player as any).replaceAsync === "function") {
          await (player as any).replaceAsync(source);
        } else if (typeof (player as any).replace === "function") {
          (player as any).replace(source);
        }
        if (cancelled || playerDisposedRef.current) return;

        console.log("KRISTO_VIDEO_PLAYBACK_SOURCE_SWAP", {
          key,
          postId,
          index: feedIndex,
          from: prevUri,
          to: effectivePlaybackUri,
        });

        if (role === "active" && isActiveIntent && !userPausedRef.current) {
          safeSetMuted(true);
          safePlay();
        }
      } catch (error) {
        console.log("KRISTO_VIDEO_PLAYBACK_SOURCE_SWAP_FAILED", {
          key,
          postId,
          index: feedIndex,
          uri: effectivePlaybackUri,
          message: String((error as any)?.message || error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    effectivePlaybackUri,
    player,
    adoptedPlayer,
    sourceAttached,
    role,
    isActiveIntent,
    key,
    postId,
    feedIndex,
    safePlay,
    safeSetMuted,
  ]);

  const resumeActivePlayback = React.useCallback(
    (reason: string) => {
      if (playerDisposedRef.current || userPausedRef.current) return;
      if (role !== "active" || !isActiveIntent) return;

      const t = safeNumber(() => (player as any).currentTime);
      const retainedVisible =
        firstFrameReadyRef.current || wasHomeFeedVideoFirstFrameShown(postId);
      const primedAtFrame =
        !retainedVisible &&
        (decodePrimedRef.current || preloadReadyRef.current) &&
        hasPaintedFrame(t);

      if (retainedVisible) {
        safePlay();
        const playing = safeNumber(() => (((player as any).playing ? 1 : 0) as number)) === 1;
        if (!playing) {
          safePause();
          safePlay();
        }
        return;
      }

      if (primedAtFrame) {
        console.log("KRISTO_VIDEO_SCROLL_BLACK_GAP_GUARD", {
          key,
          postId,
          index: feedIndex,
          reason: "resume-preloaded-without-extra-pause",
          currentTime: t,
          trigger: reason,
        });
        safeSetMuted(true);
        safePlay();
        return;
      }

      safeSetMuted(true);
      safePlay();
    },
    [
      role,
      isActiveIntent,
      postId,
      player,
      key,
      feedIndex,
      safePlay,
      safePause,
      safeSetMuted,
    ]
  );

  const confirmVisibleFrame = React.useCallback(
    (reason: string) => {
      if (playerDisposedRef.current || firstFrameReadyRef.current) return;

      firstFrameReadyRef.current = true;
      if (postId) {
        markHomeFeedVideoFirstFrameShown(postId);
      }

      if (!visibleConfirmLoggedRef.current) {
        visibleConfirmLoggedRef.current = true;
        console.log("KRISTO_VIDEO_POSTER_HIDDEN_AFTER_VISIBLE_FRAME", {
          key,
          postId,
          index: feedIndex,
          reason,
          preloadReady: preloadReadyRef.current,
          decodePrimed: decodePrimedRef.current,
        });
      }

      if (!firstFrameMarkedRef.current) {
        firstFrameMarkedRef.current = true;
        markHomeFeedVideoFirstFrame(key, {
          postId,
          msFromMount: Date.now() - mountMsRef.current,
        });
      }

      setFirstFrameReady(true);

      const activeNow = role === "active" && screenFocused && appActive;
      if (activeNow && !userPausedRef.current) {
        safeSetMuted(false);
        safePlay();
      }
    },
    [key, postId, feedIndex, role, screenFocused, appActive, safePlay, safeSetMuted]
  );

  const applyStartupAdoption = React.useCallback(
    (primedPlayer: VideoPlayer) => {
      setAdoptedPlayer(primedPlayer);
      setStartupReuseResolved(true);
      startupReuseFailedRef.current = false;
      const t = safeNumber(() => (primedPlayer as any).currentTime);
      if (hasPaintedFrame(t)) {
        preloadReadyRef.current = true;
        lastTimeRef.current = t;
        if (role === "active" && screenFocused && appActive) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => confirmVisibleFrame("startup-adopted-primed"));
          });
        }
      }
    },
    [role, screenFocused, appActive, confirmVisibleFrame]
  );

  const applyLateStartupAdoption = React.useCallback(
    (primedPlayer: VideoPlayer) => {
      try {
        hookPlayerRef.current?.pause();
      } catch {}

      applyStartupAdoption(primedPlayer);
      stuckRecoveryStepRef.current = 0;
      stuckRecoveryStartedRef.current = false;
      playbackStallSinceMsRef.current = null;
      playbackStallRecoveringRef.current = false;
      playbackStallRecoveryStepRef.current = 0;
      userPausedRef.current = false;

      const t = safeNumber(() => (primedPlayer as any).currentTime);
      try {
        (primedPlayer as any).muted = false;
      } catch {}
      try {
        primedPlayer.play();
      } catch {}

      if (hasPaintedFrame(t)) {
        confirmVisibleFrame("startup-late-adopted");
      }

      console.log("KRISTO_STARTUP_VIDEO_LATE_ADOPTED", {
        postId,
        url: remotePlaybackUri,
        currentTime: t,
      });
    },
    [applyStartupAdoption, confirmVisibleFrame, postId, remotePlaybackUri]
  );

  // Claim startup-primed player; keep listening for late prime after remote fallback.
  React.useEffect(() => {
    if (adoptedPlayer) return;
    if (!startupTarget && !isStartupFirstVideoRow) return;

    const shouldWaitForStartupPrime = () =>
      isStartupVideoPendingAdoption(remotePlaybackUri, postId) ||
      isStartupVideoReadyForAdoption(remotePlaybackUri, postId) ||
      !startupReuseFailedRef.current;

    const tryClaimStartupPlayer = (): "adopted" | "pending" | "fallback" => {
      const primed = claimStartupVideoPlayer(remotePlaybackUri, postId);
      if (primed) {
        applyStartupAdoption(primed);
        return "adopted";
      }

      if (diskCacheReady) {
        setStartupReuseResolved(true);
        return "pending";
      }

      if (shouldWaitForStartupPrime()) return "pending";

      if (isFirstFeedVideo) return "pending";

      if (!startupReuseFailedRef.current) {
        startupReuseFailedRef.current = true;
        console.log("KRISTO_STARTUP_VIDEO_REUSE_FAILED", {
          postId,
          url: remotePlaybackUri,
          reason: "not-available-after-prime",
        });
      }
      setStartupReuseResolved(true);
      return "fallback";
    };

    const handlePrimeUpdate = () => {
      if (adoptedPlayerRef.current) return;

      if (role === "active" && isFirstFeedVideo) {
        const primed = claimStartupVideoPlayer(remotePlaybackUri, postId);
        if (primed) {
          applyLateStartupAdoption(primed);
          return;
        }
      }

      tryClaimStartupPlayer();
    };

    if (tryClaimStartupPlayer() === "adopted") return;

    const unsub = subscribeHomeFeedVideoPrime(handlePrimeUpdate);

    const fallbackTimer = setTimeout(() => {
      if (!startupReuseFailedRef.current) {
        console.log("KRISTO_STARTUP_VIDEO_REUSE_FAILED", {
          postId,
          url: remotePlaybackUri,
          reason: "claim-timeout",
        });
        startupReuseFailedRef.current = true;
      }
      setStartupReuseResolved(true);
    }, 35_000);

    return () => {
      clearTimeout(fallbackTimer);
      unsub();
    };
  }, [
    startupTarget,
    adoptedPlayer,
    remotePlaybackUri,
    postId,
    role,
    isFirstFeedVideo,
    isStartupFirstVideoRow,
    diskCacheReady,
    applyStartupAdoption,
    applyLateStartupAdoption,
  ]);

  const resetPlaybackSurface = React.useCallback(
    (reason: string) => {
      firstFrameReadyRef.current = false;
      setFirstFrameReady(false);
      firstFrameMarkedRef.current = false;
      visibleConfirmLoggedRef.current = false;
      decodePrimedRef.current = false;
      preloadReadyRef.current = false;
      stuckRecoveryStepRef.current = 0;
      stuckRecoveryStartedRef.current = false;
      setBufferPercent(0);
      setAdoptedPlayer(null);
      setStartupReuseResolved(!(startupTarget || isStartupFirstVideoRow));
      setPlayerRemountEpoch((epoch) => epoch + 1);
      console.log("KRISTO_VIDEO_STUCK_RECOVERY_REMOUNT", {
        key,
        postId,
        index: feedIndex,
        reason,
      });
    },
    [key, postId, feedIndex, startupTarget, isStartupFirstVideoRow]
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
        markHomeFeedVideoWatched(postId);
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
      safePauseVideoPlayer(player, { source: "home-feed-video-player" });
      unregisterHomeFeedPlayer(key);
      if (adoptedPlayer) {
        if (startupTarget) {
          holdStartupVideoPlayerForRemount(remotePlaybackUri, postId, adoptedPlayer);
        } else {
          try {
            adoptedPlayer.release();
          } catch {}
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, player]);

  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setAppActive(next === "active"));
    return () => sub.remove();
  }, []);

  // One-shot file diagnostic for the first/active video: HEAD content-length,
  // first-byte latency, and moov position. moovPositionHint==="end" proves the
  // front-byte prewarm cannot accelerate frame 0 (AVPlayer needs the trailing
  // moov first). Runs once globally; the helper self-dedupes.
  React.useEffect(() => {
    if (role !== "active" || !playbackUri) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      void logFirstMountedHomeFeedVideoFileDiag({
        playbackUri,
        durationMs: videoDurationMs,
        playerDurationSec: safeNumber(() => (player as any).duration) || null,
        feedFaststart,
      });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [role, playbackUri, videoDurationMs, feedFaststart, player]);

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
    seekPendingRef.current = seekTo;
    const keepPosterHidden = wasHomeFeedVideoFirstFrameShown(postId);
    if (!keepPosterHidden) {
      firstFrameReadyRef.current = false;
      setFirstFrameReady(false);
      firstFrameMarkedRef.current = false;
      visibleConfirmLoggedRef.current = false;
    }
    try {
      (player as any).currentTime = seekTo;
      lastTimeRef.current = seekTo;
    } catch {}
    console.log("KRISTO_HOME_FEED_RESTORE", {
      scope: "video-position",
      postId,
      seconds: seekTo,
      keepPosterHidden,
    });
  }, [role, isRecycledRow, postId, player, status]);

  // Reset visible-frame state on scroll promotion; preloadReady stays separate.
  React.useEffect(() => {
    const prev = prevRoleRef.current;
    if (prev === role) return;

    if (role === "active" && prev !== "active") {
      const snap = readPlayerPlaybackSnapshot(player);
      console.log("KRISTO_VIDEO_REACTIVATE", {
        postId,
        roleBefore: prev,
        roleAfter: role,
        currentTime: snap.currentTime,
        playing: snap.playing,
        muted: snap.muted,
      });
      if (
        !adoptedPlayerRef.current &&
        !diskCacheReady &&
        !effectivePlaybackUri.startsWith("file://")
      ) {
        console.log("KRISTO_VIDEO_ACTIVE_SOURCE_NOT_READY", {
          postId,
          index: feedIndex,
          source: "remote",
          uri: effectivePlaybackUri,
        });
      }
    }

    if (role === "active" && prev === "preload") {
      if (wasHomeFeedVideoFirstFrameShown(postId)) {
        firstFrameReadyRef.current = true;
        setFirstFrameReady(true);
      } else {
        firstFrameReadyRef.current = false;
        setFirstFrameReady(false);
        firstFrameMarkedRef.current = false;
        visibleConfirmLoggedRef.current = false;
        if (decodePrimedRef.current || preloadReadyRef.current) {
          console.log("KRISTO_VIDEO_SCROLL_BLACK_GAP_GUARD", {
            key,
            postId,
            index: feedIndex,
            reason: "scroll-to-preloaded-row",
            decodePrimed: decodePrimedRef.current,
            preloadReady: preloadReadyRef.current,
          });
        }
      }
    } else if (role !== "active") {
      if (!wasHomeFeedVideoFirstFrameShown(postId)) {
        firstFrameReadyRef.current = false;
        setFirstFrameReady(false);
        firstFrameMarkedRef.current = false;
        visibleConfirmLoggedRef.current = false;
      }
      seekPendingRef.current = null;
    }

    prevRoleRef.current = role;

    if (role === "active" && prev !== "active") {
      resumeActivePlayback("role-promotion");
    }
  }, [role, key, postId, feedIndex, player, resumeActivePlayback, adoptedPlayer, diskCacheReady, effectivePlaybackUri]);

  // Watched row re-promoted to active: resume saved position without poster flash.
  React.useEffect(() => {
    if (playerDisposedRef.current || role !== "active" || isRecycledRow || !postId) return;
    if (!wasHomeFeedVideoFirstFrameShown(postId)) return;

    const saved = getHomeFeedVideoProgress(postId);
    if (saved === null || saved <= 0.1) return;

    const seekTo = peekHomeFeedVideoRestoreSeek(postId);
    if (seekTo === null) return;

    const t = safeNumber(() => (player as any).currentTime);
    if (Math.abs(t - seekTo) <= SEEK_VISIBLE_TOLERANCE_SEC) return;

    try {
      (player as any).currentTime = seekTo;
      lastTimeRef.current = seekTo;
    } catch {}
    console.log("KRISTO_HOME_FEED_RESTORE", {
      scope: "video-reactivate",
      postId,
      seconds: seekTo,
      keepPosterHidden: true,
    });
  }, [role, isRecycledRow, postId, player]);

  // Core ownership/playback effect — single place that decides play vs pause.
  React.useEffect(() => {
    if (playerDisposedRef.current) return;

    if (role === "active") {
      if (isActiveIntent) {
        setActiveHomeFeedVideo(key, { postId, index: feedIndex });
        resumeActivePlayback("active-intent");
      } else {
        // Active row but screen blurred / app backgrounded: stop & release.
        safePause();
        safeSetMuted(true);
        saveProgress("blur");
        clearActiveHomeFeedVideo(key, "blur");
      }
      return;
    }

    // Preload + inactive: never play audibly, always muted. Decode-priming
    // (a brief muted play to paint the first frame) is owned by the dedicated
    // effect below — don't pause here while that's in flight or we'd kill it.
    safeSetMuted(true);
    const willDecodePrime =
      role === "preload" &&
      decodePrime &&
      !decodePrimedRef.current &&
      sourceAttached &&
      Boolean(playbackUri);
    if (!willDecodePrime) {
      safePause();
    }
  }, [
    role,
    isActiveIntent,
    decodePrime,
    key,
    postId,
    feedIndex,
    sourceAttached,
    playbackUri,
    resumeActivePlayback,
    safePause,
    safeSetMuted,
    saveProgress,
  ]);

  // Decode-prime a preload row: play muted until the first frame paints, then
  // pause AT that frame and stay muted. This makes a neighbor decode-ready
  // (not just byte-warmed) before the user scrolls to it, so it never needs a
  // second scroll. Self-contained + one-shot; honors the single-active rule by
  // always ending paused.
  React.useEffect(() => {
    if (role !== "preload" || !decodePrime || startupTarget) return;
    if (!sourceAttached || !playbackUri) return;
    if (decodePrimedRef.current || playerDisposedRef.current) return;

    let settled = false;

    const finishPrime = (painted: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(watchdog);
      decodePrimingRef.current = false;
      if (playerDisposedRef.current) return;
      // A preload row must never keep playing: end paused + muted regardless.
      safeSetMuted(true);
      safePause();
      if (painted) {
        decodePrimedRef.current = true;
        preloadReadyRef.current = true;
        if (!preloadReadyLoggedRef.current) {
          preloadReadyLoggedRef.current = true;
          markHomeFeedVideoPreloadReady(postId, remotePlaybackUri);
          console.log("KRISTO_VIDEO_PRELOAD_READY", {
            key,
            postId,
            index: feedIndex,
            reason: "decode-primed",
            note: "buffer/decode ready — poster stays until active visible frame",
          });
        }
      }
    };

    decodePrimingRef.current = true;
    safeSetMuted(true);
    safePlay();
    if (!preloadStartedLoggedRef.current) {
      preloadStartedLoggedRef.current = true;
      console.log("KRISTO_VIDEO_PRELOAD_STARTED", {
        key,
        postId,
        index: feedIndex,
        reason: "decode-prime",
      });
    }

    const poll = setInterval(() => {
      if (settled || playerDisposedRef.current) return;
      const t = safeNumber(() => (player as any).currentTime);
      if (t > 0) lastTimeRef.current = t;
      if (hasPaintedFrame(t)) {
        finishPrime(true);
        return;
      }
      // Something (e.g. the owner promoting another row) paused us before the
      // first frame landed — re-kick the muted prime until it does.
      const playing = safeNumber(() => ((player as any).playing ? 1 : 0)) === 1;
      if (!playing) safePlay();
    }, 80);

    const watchdog = setTimeout(() => finishPrime(false), DECODE_PRIME_TIMEOUT_MS);

    return () => {
      settled = true;
      clearInterval(poll);
      clearTimeout(watchdog);
      decodePrimingRef.current = false;
      // Already paused at primed frame — skip redundant pause on scroll promotion.
      if (!decodePrimedRef.current) {
        safePause();
      }
    };
  }, [
    role,
    startupTarget,
    decodePrime,
    sourceAttached,
    playbackUri,
    key,
    postId,
    feedIndex,
    player,
    safePlay,
    safePause,
    safeSetMuted,
  ]);

  // Status-driven preload buffer signal only — visible frame is confirmed separately.
  React.useEffect(() => {
    if (playerDisposedRef.current) return;
    const lower = statusLower(status);
    const t = safeNumber(() => (player as any).currentTime);
    if (t > 0) lastTimeRef.current = t;

    if (
      role === "preload" &&
      !preloadStartedLoggedRef.current &&
      (lower === "readytoplay" || lower === "loaded") &&
      sourceAttached &&
      playbackUri
    ) {
      preloadStartedLoggedRef.current = true;
      console.log("KRISTO_VIDEO_PRELOAD_BUFFERED", { key, postId, index: feedIndex });
    }
  }, [status, role, key, postId, playbackUri, feedIndex, sourceAttached, player]);

  // Active visible-frame gate: poster stays until compositor-ready paint while active.
  React.useEffect(() => {
    if (role !== "active" || !isActiveIntent || firstFrameReady) return;
    if (!sourceAttached || !playbackUri || playerDisposedRef.current) return;

    let cancelled = false;
    let compositorScheduled = false;

    const tryConfirm = () => {
      if (cancelled || playerDisposedRef.current || firstFrameReadyRef.current) return;

      const t = safeNumber(() => (player as any).currentTime);
      if (t > 0) lastTimeRef.current = t;

      const pendingSeek = seekPendingRef.current;
      if (pendingSeek != null) {
        if (Math.abs(t - pendingSeek) > SEEK_VISIBLE_TOLERANCE_SEC || !hasPaintedFrame(t)) {
          return;
        }
        seekPendingRef.current = null;
      }

      if (!hasPaintedFrame(t)) return;

      const playing = safeNumber(() => ((player as any).playing ? 1 : 0)) === 1;
      const primed =
        decodePrimedRef.current || preloadReadyRef.current || startupTarget;
      if (!playing && !primed && pendingSeek == null) return;

      if (compositorScheduled) return;
      compositorScheduled = true;

      const reason =
        pendingSeek != null
          ? "seek-visible-frame"
          : startupTarget
            ? "startup-adopted-visible-frame"
            : primed
              ? "scroll-preloaded-visible-frame"
              : "active-visible-frame";

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled || playerDisposedRef.current) return;
          confirmVisibleFrame(reason);
        });
      });
    };

    const poll = setInterval(tryConfirm, 50);
    tryConfirm();

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [
    role,
    isActiveIntent,
    firstFrameReady,
    sourceAttached,
    playbackUri,
    startupTarget,
    player,
    confirmVisibleFrame,
  ]);

  // Active buffer progress + KRISTO_VIDEO_BUFFER_PROGRESS logs.
  React.useEffect(() => {
    if (role !== "active" || !sourceAttached || playerDisposedRef.current) return;

    const tick = () => {
      if (playerDisposedRef.current) return;
      const t = safeNumber(() => (player as any).currentTime);
      const pct = computeBufferPercent(player, status, t);
      setBufferPercent((prev) => (prev === pct ? prev : pct));

      const primed =
        decodePrimedRef.current || preloadReadyRef.current || startupTarget;
      const ready = isActiveBufferReady(pct, status, primed, t);
      const now = Date.now();
      if (now - lastBufferLogAtRef.current >= BUFFER_PROGRESS_LOG_MS) {
        lastBufferLogAtRef.current = now;
        console.log("KRISTO_VIDEO_BUFFER_PROGRESS", {
          key,
          postId,
          index: feedIndex,
          percent: pct,
          bufferReady: ready,
          status: statusLower(status),
          bufferedPosition: safeNumber(() => (player as any).bufferedPosition, -1),
          duration: safeNumber(() => (player as any).duration, 0),
          currentTime: t,
          isFirstFeedVideo,
        });
      }
    };

    tick();
    const poll = setInterval(tick, 200);
    return () => clearInterval(poll);
  }, [
    role,
    sourceAttached,
    status,
    player,
    key,
    postId,
    feedIndex,
    isFirstFeedVideo,
    startupTarget,
    playerRemountEpoch,
  ]);

  // Automatic stuck recovery for the active row (no user scroll required).
  React.useEffect(() => {
    if (!isHomeFeedInlineVideoAutoplayEnabled()) return;
    if (role !== "active" || !isActiveIntent || firstFrameReady || userPausedRef.current) {
      stuckRecoveryStepRef.current = 0;
      stuckRecoveryStartedRef.current = false;
      return;
    }
    if (!sourceAttached || !playbackUri || playerDisposedRef.current || !player) return;
    if (
      isStartupFirstVideoRow &&
      !adoptedPlayerRef.current &&
      !startupReuseResolved &&
      (startupTarget ||
        isStartupVideoPendingAdoption(remotePlaybackUri, postId) ||
        isStartupVideoReadyForAdoption(remotePlaybackUri, postId))
    ) {
      return;
    }

    const primedAtStart =
      decodePrimedRef.current || preloadReadyRef.current || startupTarget;
    const t0 = safeNumber(() => (player as any).currentTime);
    if (primedAtStart && hasPaintedFrame(t0)) {
      return;
    }

    let cancelled = false;
    let stepTimer: ReturnType<typeof setTimeout> | null = null;

    const runStep = (step: number) => {
      if (cancelled || playerDisposedRef.current || firstFrameReadyRef.current) return;

      if (step === 0 && !stuckRecoveryStartedRef.current) {
        stuckRecoveryStartedRef.current = true;
        console.log("KRISTO_VIDEO_STUCK_RECOVERY_START", {
          key,
          postId,
          index: feedIndex,
          bufferPercent,
          status: statusLower(status),
        });
      }

      if (step === 0 || step === 1) {
        console.log("KRISTO_VIDEO_STUCK_RECOVERY_PLAY", {
          key,
          postId,
          index: feedIndex,
          step,
          action: step === 0 ? "play" : "pause-play",
        });
        if (step === 1) {
          safePause();
        }
        safeSetMuted(true);
        safePlay();
        stuckRecoveryStepRef.current = step + 1;
        stepTimer = setTimeout(() => runStep(step + 1), STUCK_RECOVERY_STEP_MS);
        return;
      }

      if (step === 2) {
        const t = safeNumber(() => (player as any).currentTime);
        try {
          (player as any).currentTime = t + 0.01;
        } catch {}
        console.log("KRISTO_VIDEO_STUCK_RECOVERY_PLAY", {
          key,
          postId,
          index: feedIndex,
          step,
          action: "seek-nudge",
          currentTime: t,
        });
        safePlay();
        stuckRecoveryStepRef.current = step + 1;
        stepTimer = setTimeout(() => runStep(step + 1), STUCK_RECOVERY_STEP_MS);
        return;
      }

      if (step >= 3) {
        if (
          isStartupFirstVideoRow &&
          startupTarget &&
          !startupReuseFailedRef.current &&
          !adoptedPlayerRef.current
        ) {
          return;
        }
        resetPlaybackSurface("stuck-recovery-remount");
      }
    };

    stepTimer = setTimeout(() => runStep(0), STUCK_RECOVERY_INITIAL_MS);

    return () => {
      cancelled = true;
      if (stepTimer) clearTimeout(stepTimer);
    };
  }, [
    role,
    isActiveIntent,
    firstFrameReady,
    sourceAttached,
    playbackUri,
    player,
    key,
    postId,
    feedIndex,
    bufferPercent,
    status,
    isStartupFirstVideoRow,
    startupTarget,
    startupReuseResolved,
    remotePlaybackUri,
    playerRemountEpoch,
    resetPlaybackSurface,
    safePlay,
    safePause,
    safeSetMuted,
  ]);

  // Playback stall watchdog — frozen currentTime after visible playback already started.
  React.useEffect(() => {
    if (role !== "active" || !screenFocused || !appActive) {
      playbackStallSinceMsRef.current = null;
      playbackStallRecoveringRef.current = false;
      playbackStallRecoveryStepRef.current = 0;
      return;
    }
    if (!firstFrameReady || !sourceAttached || !playbackUri || playerDisposedRef.current) {
      playbackStallSinceMsRef.current = null;
      return;
    }

    let cancelled = false;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRecoveryTimer = () => {
      if (recoveryTimer) {
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
    };

    const markRecovered = (reason: string) => {
      if (playbackStallSinceMsRef.current == null && !playbackStallRecoveringRef.current) return;
      playbackStallRecoveringRef.current = false;
      playbackStallRecoveryStepRef.current = 0;
      playbackStallSinceMsRef.current = null;
      clearRecoveryTimer();
      console.log("KRISTO_VIDEO_PLAYBACK_STALL_RECOVERED", {
        key,
        postId,
        index: feedIndex,
        reason,
      });
    };

    const runRecoveryStep = (step: number) => {
      if (cancelled || playerDisposedRef.current || userPausedRef.current) return;
      if (!firstFrameReadyRef.current) return;

      const t = safeNumber(() => (player as any).currentTime);
      if (t >= lastTimeRef.current + PLAYBACK_STALL_ADVANCE_SEC) {
        lastTimeRef.current = t;
        markRecovered("time-advanced-during-recovery");
        return;
      }

      if (step === 0) {
        console.log("KRISTO_VIDEO_PLAYBACK_STALL_DETECTED", {
          key,
          postId,
          index: feedIndex,
          currentTime: t,
          lastTime: lastTimeRef.current,
          status: statusLower(status),
          bufferedPosition: safeNumber(() => (player as any).bufferedPosition, -1),
        });
      }

      if (step === 0 || step === 1) {
        console.log("KRISTO_VIDEO_PLAYBACK_STALL_RECOVERY_PLAY", {
          key,
          postId,
          index: feedIndex,
          step,
          action: step === 0 ? "play" : "pause-play",
          currentTime: t,
        });
        if (step === 1) safePause();
        safeSetMuted(false);
        safePlay();
        playbackStallRecoveryStepRef.current = step + 1;
        recoveryTimer = setTimeout(() => runRecoveryStep(step + 1), PLAYBACK_STALL_RECOVERY_STEP_MS);
        return;
      }

      if (step === 2) {
        const seekTo = t + PLAYBACK_STALL_ADVANCE_SEC;
        try {
          (player as any).currentTime = seekTo;
          lastTimeRef.current = seekTo;
        } catch {}
        console.log("KRISTO_VIDEO_PLAYBACK_STALL_RECOVERY_SEEK", {
          key,
          postId,
          index: feedIndex,
          from: t,
          to: seekTo,
        });
        safePlay();
        playbackStallRecoveryStepRef.current = step + 1;
        recoveryTimer = setTimeout(() => runRecoveryStep(step + 1), PLAYBACK_STALL_RECOVERY_STEP_MS);
        return;
      }

      if (step >= 3) {
        console.log("KRISTO_VIDEO_PLAYBACK_STALL_RECOVERY_REMOUNT", {
          key,
          postId,
          index: feedIndex,
          currentTime: t,
        });
        setPlayerRemountEpoch((epoch) => epoch + 1);
        playbackStallRecoveringRef.current = false;
        playbackStallRecoveryStepRef.current = 0;
        playbackStallSinceMsRef.current = null;
      }
    };

    const poll = setInterval(() => {
      if (cancelled || playerDisposedRef.current || userPausedRef.current) {
        playbackStallSinceMsRef.current = null;
        return;
      }

      const t = safeNumber(() => (player as any).currentTime);
      if (t >= lastTimeRef.current + PLAYBACK_STALL_ADVANCE_SEC) {
        lastTimeRef.current = t;
        if (playbackStallSinceMsRef.current != null || playbackStallRecoveringRef.current) {
          markRecovered("time-advanced");
        } else {
          playbackStallSinceMsRef.current = null;
        }
        return;
      }

      if (playbackStallRecoveringRef.current) return;

      if (playbackStallSinceMsRef.current == null) {
        playbackStallSinceMsRef.current = Date.now();
        return;
      }

      if (Date.now() - playbackStallSinceMsRef.current >= PLAYBACK_STALL_THRESHOLD_MS) {
        playbackStallRecoveringRef.current = true;
        runRecoveryStep(0);
      }
    }, PLAYBACK_STALL_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearRecoveryTimer();
      playbackStallRecoveringRef.current = false;
      playbackStallRecoveryStepRef.current = 0;
      playbackStallSinceMsRef.current = null;
    };
  }, [
    role,
    screenFocused,
    appActive,
    firstFrameReady,
    sourceAttached,
    playbackUri,
    player,
    status,
    key,
    postId,
    feedIndex,
    safePlay,
    safePause,
    safeSetMuted,
  ]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, remotePlaybackUri);
  const hasBranded = brandedPoster || hasBrandedVideoPoster({ posterUri: poster, brandedPoster });
  const showCover = !firstFrameReady;
  const showVideoSurface = Boolean(player);
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
  // Active video is auto-starting (priming/decoding its first frame): show a
  // loading state, never a tap-to-play affordance.
  const showAutoStartLoading =
    role === "active" &&
    screenFocused &&
    Boolean(player) &&
    !firstFrameReady &&
    !userPausedRef.current;
  const showBufferPercentLabel =
    showAutoStartLoading && bufferPercent > 0 && bufferPercent < 100;

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
      <View style={styles.root} needsOffscreenAlphaCompositing>
        {showVideoSurface ? (
          <VideoView
            player={player}
            style={[styles.videoSurface, showCover && styles.videoUnderPoster]}
            contentFit="cover"
            nativeControls={false}
          />
        ) : null}
        {showPosterOverlay ? (
          <View style={styles.overlay} pointerEvents="none">
            <FeedVideoPosterImage
              uri={poster}
              style={styles.overlayFill}
              resizeMode="cover"
              postId={postId}
              title={title}
              videoUrl={remotePlaybackUri}
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
              variant={showAutoStartLoading ? "minimal" : "full"}
              postId={postId}
              title={showAutoStartLoading ? "" : title}
              videoUrl={remotePlaybackUri}
              mediaStatus={mediaStatus}
              suppressMissingPosterLog={hasBranded || showAutoStartLoading}
            />
          </View>
        ) : null}
        {showAutoStartLoading ? (
          <View style={styles.centerPlayOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="rgba(255,255,255,0.92)" />
            {showBufferPercentLabel ? (
              <Text style={styles.bufferProgressText}>{bufferPercent}%</Text>
            ) : null}
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
  videoUnderPoster: {
    opacity: VIDEO_COVER_OPACITY,
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
    gap: 10,
  },
  bufferProgressText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    fontWeight: "700",
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
