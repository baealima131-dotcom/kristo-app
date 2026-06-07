import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, Image, StyleSheet, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { markHomeFeedFirstPlaying, markHomeFirstVideoReady } from "@/src/lib/firstPaint";
import {
  activateHomeFeedVideo,
  consumeHomeFeedVideoRecovery,
  getActiveHomeFeedVideoId,
  pauseHomeFeedVideo,
  peekHomeFeedVideoRecovery,
  registerHomeFeedVideo,
  subscribeHomeFeedVideoRecovery,
  unregisterHomeFeedVideo,
} from "@/src/lib/homeFeedVideoController";
import {
  isHomeFeedVideoPreloadReady,
  markHomeFeedActiveFirstFrame,
  markHomeFeedVideoPreloadReady,
  touchHomeFeedVideoReadiness,
} from "@/src/lib/homeFeedVideoReadiness";
import type { HomeFeedVideoWarmMode } from "@/src/lib/homeFeedVideoWindow";
import {
  getHomeFeedVideoProgress,
  peekHomeFeedVideoRestoreSeek,
  saveHomeFeedVideoProgress,
} from "@/src/lib/homeFeedVideoProgressStore";
import { wasHomeFeedVideoUrlBufferedAhead } from "@/src/lib/homeFeedVideoBufferAhead";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import { hasBrandedVideoPoster, isValidVideoPosterUri } from "./homeFeedUtils";
import { FeedVideoPosterImage, VideoPostFallbackPoster } from "./VideoPostFallbackPoster";

type Props = {
  postId?: string;
  title?: string;
  mediaStatus?: string;
  uri: string;
  posterUri?: string;
  brandedPoster?: boolean;
  warmMode: HomeFeedVideoWarmMode;
  screenFocused: boolean;
  feedIndex?: number;
  contentLength?: number;
};

// V1 perf: only emit startup/first-frame timing for the first active video in
// the session. Subsequent active videos stay quiet to keep logs minimal.
let firstActiveTimingLogged = false;

let firstPosterCheckLogged = false;

function urlHost(url: string): string | null {
  const match = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function statusLower(status: string) {
  return String(status || "").trim().toLowerCase();
}

function hasDecodedFrame(status: string, currentTime: number, playing: boolean) {
  const lower = statusLower(status);
  return (
    currentTime > 0.03 ||
    playing ||
    lower === "playing" ||
    lower === "readytoplay"
  );
}

function isPlayerReadyToStart(status: string, currentTime: number, playing: boolean) {
  const lower = statusLower(status);
  return (
    hasDecodedFrame(status, currentTime, playing) ||
    lower === "loading" ||
    lower === "loaded"
  );
}

function shouldMarkReadiness(status: string, currentTime: number, playing: boolean) {
  return hasDecodedFrame(status, currentTime, playing);
}

function safeGetPlayerCurrentTime(player: any): number {
  try {
    return Number(player?.currentTime || 0);
  } catch {
    return 0;
  }
}

function safeGetPlayerPlaying(player: any): boolean {
  try {
    return Boolean(player?.playing);
  } catch {
    return false;
  }
}

function safeGetPlayerStatus(player: any): string {
  try {
    return String(player?.status || "");
  } catch {
    return "";
  }
}

function safeSetPlayerCurrentTime(player: any, seconds: number): boolean {
  try {
    (player as any).currentTime = seconds;
    return true;
  } catch {
    return false;
  }
}

function safePlayerPause(player: any): void {
  try {
    player.pause();
  } catch {}
}

function safePlayerPlay(player: any): void {
  try {
    player.play();
  } catch {}
}

function safeGetPlayerBuffered(player: any): number {
  try {
    return Number(player?.bufferedPosition ?? -1);
  } catch {
    return -1;
  }
}

/** Low-latency progressive streaming: start playback early, buffer ahead in background. */
const PROGRESSIVE_BUFFER_OPTIONS = {
  preferredForwardBufferDuration: 2,
  waitsToMinimizeStalling: false,
  minBufferForPlayback: 0.5,
  prioritizeTimeOverSizeThreshold: true,
} as const;

/**
 * Active row plays with audio; preload/warm rows keep muted paused players ready for handoff.
 */
export const SimpleFeedVideo = memo(function SimpleFeedVideo({
  postId = "",
  title = "",
  mediaStatus = "",
  uri,
  posterUri = "",
  brandedPoster = false,
  warmMode,
  screenFocused,
  feedIndex = -1,
  contentLength,
}: Props) {
  const cachedReadyOnMount = isHomeFeedVideoPreloadReady(postId, uri);
  const cachedReadyRef = useRef(cachedReadyOnMount);
  const warmModeRef = useRef(warmMode);
  warmModeRef.current = warmMode;

  const isActive = warmMode === "active";

  const isRetainPrev = warmMode === "warm" || warmMode === "cache";
  const isPreloadNext = warmMode === "preload";
  // Active + next 2–3 preload rows + scroll-back retain rows load source immediately.
  const sourceLoadAllowed = isActive || isPreloadNext || isRetainPrev;
  const playerSource =
    sourceLoadAllowed && uri ? { uri, contentType: "progressive" as const } : null;

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = true;
    p.muted = true;
    try {
      p.bufferOptions = { ...PROGRESSIVE_BUFFER_OPTIONS };
    } catch {}
    const mode = warmModeRef.current;
    if (mode === "warm" || mode === "cache") {
      try {
        p.pause();
      } catch {}
      return;
    }
    try {
      p.play();
    } catch {}
  });

  const lastKnownTimeRef = useRef(0);
  const lastKnownPlayingRef = useRef(false);
  const playerDisposedRef = useRef(false);

  const { status } = useEvent(player, "statusChange", {
    status: safeGetPlayerStatus(player),
  });

  useEffect(() => {
    playerDisposedRef.current = false;
    lastKnownTimeRef.current = 0;
    lastKnownPlayingRef.current = false;
  }, [player]);

  useEffect(() => {
    if (playerDisposedRef.current) return;
    const t = safeGetPlayerCurrentTime(player);
    if (Number.isFinite(t) && t >= 0) {
      lastKnownTimeRef.current = t;
    }
    lastKnownPlayingRef.current = safeGetPlayerPlaying(player);
  }, [status, player]);

  const currentTime = lastKnownTimeRef.current;
  const playing = lastKnownPlayingRef.current;

  const isPreload = isPreloadNext;
  const shouldPrime = isPreloadNext;

  // Never reveal the video surface from the readiness cache: a freshly created
  // player has not decoded a frame yet, so hiding the poster/fallback before the
  // real first frame paints a black flash. Keep the poster until markFirstFrame
  // fires on an actual decoded frame.
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
    });
    return () => sub.remove();
  }, []);

  const mountedUriRef = useRef(uri);
  const preloadPrimedRef = useRef(false);
  const preloadStartLoggedRef = useRef(false);
  const reusedWarmLoggedRef = useRef(false);
  const readyMarkedRef = useRef(cachedReadyOnMount);
  const mountMsRef = useRef(Date.now());
  const readyMsRef = useRef<number | null>(cachedReadyOnMount ? 0 : null);
  const firstFrameMsRef = useRef<number | null>(cachedReadyOnMount && isActive ? 0 : null);
  const timingLoggedRef = useRef(false);
  const activeHandoffRef = useRef(false);
  const prevIsActiveRef = useRef(isActive);
  const prevScreenFocusedRef = useRef(screenFocused);
  const lastRegisterKeyRef = useRef("");
  const lastMutedLogKeyRef = useRef("");
  const lastExpectedMutedLogKeyRef = useRef("");
  const lastRowDiagKeyRef = useRef("");
  const progressRestoredRef = useRef(false);
  const lastProgressSaveMsRef = useRef(0);
  const firstFrameDiagLoggedRef = useRef(false);
  const playStartedLoggedRef = useRef(false);
  const lastBufferLogKeyRef = useRef("");

  const readPlayerMuted = () => {
    try {
      return Boolean((player as any)?.muted);
    } catch {
      return true;
    }
  };

  const computeVideoReady = () =>
    readyMarkedRef.current || isPlayerReadyToStart(status, currentTime, playing);

  // Decode/play gate: active + focused + app active + source set. Do NOT wait
  // for readyToPlay, duration, or full buffer before calling play().
  const computeDecodeShouldPlay = () =>
    isActive && screenFocused && appActive && Boolean(playerSource);

  const computePreloadShouldPlay = () =>
    isPreloadNext && screenFocused && appActive && Boolean(playerSource);

  // Audio gate: only unmute once the first frame has actually rendered.
  const computeAudioShouldPlay = () =>
    isActive && screenFocused && appActive && firstFrameReady;

  const logPlayRequested = (reason: string) => {
    console.log("KRISTO_VIDEO_PLAY_REQUESTED", {
      id: postId || null,
      status: statusLower(safeGetPlayerStatus(player)),
      active: isActive,
      msFromMount: Date.now() - mountMsRef.current,
      reason,
    });
  };

  const requestPlay = (reason: string) => {
    if (playerDisposedRef.current) return;
    logPlayRequested(reason);
    safePlayerPlay(player);
  };

  const logBufferingState = (lower: string, t: number) => {
    const buffered = safeGetPlayerBuffered(player);
    const key = `${lower}:${buffered}:${Math.floor(t * 10)}`;
    if (key === lastBufferLogKeyRef.current) return;
    lastBufferLogKeyRef.current = key;
    console.log("KRISTO_VIDEO_BUFFERING_STATE", {
      id: postId || null,
      status: lower,
      buffered,
      currentTime: t,
    });
  };

  const recoverAudioIfNeeded = (source: string) => {
    const effectiveShouldPlay = computeAudioShouldPlay();
    if (!effectiveShouldPlay) return false;
    if (!readPlayerMuted()) return false;

    if (playerDisposedRef.current) return false;
    try {
      player.muted = false;
      safePlayerPlay(player);
    } catch {}

    lastMutedLogKeyRef.current = "";
    logMutedSet("recoverAudioIfNeeded", false, source);
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_AUDIO_RECOVERED_FROM_MUTED", {
        postId: postId || null,
        source,
        warmMode,
        effectiveShouldPlay,
        firstFrameReady,
      });
    }
    return true;
  };

  const logMutedSet = (source: string, muted: boolean, reason?: string) => {
    if (!isKristoVerboseFeedDebug()) return;
    const key = `${postId}:${source}:${muted ? 1 : 0}:${warmMode}`;
    if (key === lastMutedLogKeyRef.current) return;
    lastMutedLogKeyRef.current = key;
    console.log("KRISTO_VIDEO_MUTED_SET", {
      postId: postId || null,
      muted,
      source,
      shouldPlay: isActive,
      effectiveShouldPlay: isActive && screenFocused && firstFrameReady && appActive,
      activePostId: getActiveHomeFeedVideoId(),
      warmMode,
      reason: reason || null,
    });
  };

  const setPlayerMuted = (muted: boolean, source: string, reason?: string) => {
    if (playerDisposedRef.current) return;
    // Only refuse to mute once audio is legitimately playing (post first frame);
    // before that we must be free to keep the active video muted while it decodes.
    if (muted && isActive && computeAudioShouldPlay()) {
      return;
    }
    try {
      player.muted = muted;
      logMutedSet(source, muted, reason);
    } catch {}
  };

  const logExpectedButMuted = (reason: string) => {
    const playerMuted = readPlayerMuted();
    const shouldPlay = isActive;
    const effectiveShouldPlay = computeAudioShouldPlay();
    const videoReady = computeVideoReady();

    if (!effectiveShouldPlay || !videoReady || !playerMuted) return;

    if (recoverAudioIfNeeded(reason)) return;

    if (!isKristoVerboseFeedDebug()) return;

    const key = `${postId}:${reason}:${warmMode}:${firstFrameReady ? 1 : 0}`;
    if (key === lastExpectedMutedLogKeyRef.current) return;
    lastExpectedMutedLogKeyRef.current = key;

    console.log("KRISTO_VIDEO_AUDIO_EXPECTED_BUT_MUTED", {
      postId: postId || null,
      shouldPlay,
      effectiveShouldPlay,
      videoReady,
      firstFrameReady,
      screenFocused,
      appActive,
      muted: playerMuted,
      playerMuted,
      manualPaused: false,
      warmMode,
      reason,
    });
  };

  const logStartupTiming = () => {
    if (timingLoggedRef.current) return;
    timingLoggedRef.current = true;
    // Only the first active video in the session emits startup timing.
    if (!isActive || firstActiveTimingLogged) return;
    firstActiveTimingLogged = true;
    console.log("KRISTO_VIDEO_STARTUP_TIMING", {
      id: postId || null,
      msToReady: readyMsRef.current,
      msToFirstFrame: firstFrameMsRef.current,
      videoUrlHost: urlHost(uri),
      posterHost: urlHost(posterUri),
    });
  };

  const logFirstFrameDiag = () => {
    if (!isActive || firstFrameDiagLoggedRef.current) return;
    firstFrameDiagLoggedRef.current = true;
    console.log("KRISTO_VIDEO_FIRST_FRAME_DIAG", {
      id: postId || null,
      firstFrameMs: firstFrameMsRef.current,
      readyMs: readyMsRef.current,
      contentLength: Number(contentLength || 0) > 0 ? Number(contentLength) : null,
      warmMode,
      wasBufferedAhead: wasHomeFeedVideoUrlBufferedAhead(uri),
      wasRestored: progressRestoredRef.current,
      videoHost: urlHost(uri),
      posterHost: urlHost(posterUri),
    });
  };

  const markFirstFrame = (fromCache = false) => {
    if (firstFrameMsRef.current === null) {
      firstFrameMsRef.current = fromCache ? 0 : Date.now() - mountMsRef.current;
    }
    // Active video first frame opens the preload gate so the next video can
    // start warming without ever blocking the active one.
    if (isActive) {
      markHomeFeedActiveFirstFrame();
      logFirstFrameDiag();
    }
    setFirstFrameReady((prev) => (prev ? prev : true));
  };

  const activateActivePlayback = (reason: string) => {
    if (!isActive) return;
    // Start decode/playback immediately when source is set; audio stays muted
    // until firstFrameReady.
    if (!computeDecodeShouldPlay()) return;

    const audioAllowed = computeAudioShouldPlay();

    // Nothing to do if we've already handed off and the audio state is correct.
    if (activeHandoffRef.current && (!audioAllowed || !readPlayerMuted())) return;

    activeHandoffRef.current = true;

    if (playerDisposedRef.current) return;
    try {
      if (audioAllowed) player.muted = false;
      requestPlay(`activateActivePlayback:${reason}`);
      lastMutedLogKeyRef.current = "";
      logMutedSet("activateActivePlayback", !audioAllowed, reason);
    } catch {}
    activateHomeFeedVideo(postId, {
      postId,
      shouldPlay: true,
      // Before the first frame, claim ownership / pause other warming players but
      // let the controller unmute only once audio is allowed.
      videoReady: audioAllowed,
      reason,
    });
    markHomeFeedFirstPlaying("simple-feed-video");
    markHomeFirstVideoReady("simple-feed-video");
  };

  const seekPlayerToSeconds = (seconds: number, source: string) => {
    if (playerDisposedRef.current) return;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const ok = safeSetPlayerCurrentTime(player, seconds);
    if (!ok) return;
    lastKnownTimeRef.current = seconds;
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_PROGRESS_SEEK", {
        postId: postId || null,
        seconds,
        source,
      });
    }
  };

  const saveProgressIfNeeded = (source: string, opts?: { refOnly?: boolean }) => {
    const id = String(postId || "").trim();
    if (!id) return;

    if (!opts?.refOnly && !playerDisposedRef.current) {
      const live = safeGetPlayerCurrentTime(player);
      if (live > 0) lastKnownTimeRef.current = live;
    }

    const now = Date.now();
    if (now - lastProgressSaveMsRef.current < 400) return;

    const t = lastKnownTimeRef.current;
    if (t <= 0.25) {
      if (playerDisposedRef.current || opts?.refOnly) {
        console.log("KRISTO_VIDEO_PROGRESS_SAVE_SKIP", {
          id,
          reason: "native-object-gone",
        });
      }
      return;
    }

    lastProgressSaveMsRef.current = now;
    saveHomeFeedVideoProgress(id, t);
  };

  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    if (wasActive && !isActive) {
      saveProgressIfNeeded("lost-active");
    }
    if (isActive && !wasActive) {
      activeHandoffRef.current = false;
      progressRestoredRef.current = false;
      playStartedLoggedRef.current = false;
      lastBufferLogKeyRef.current = "";
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, status, postId]);

  useLayoutEffect(() => {
    mountMsRef.current = Date.now();
    timingLoggedRef.current = false;
    readyMsRef.current = cachedReadyRef.current ? 0 : null;
    firstFrameMsRef.current = cachedReadyRef.current && warmModeRef.current === "active" ? 0 : null;

    activeHandoffRef.current = false;

    if (!screenFocused) return;

    if (warmModeRef.current !== "active" || !cachedReadyRef.current) {
      try {
        setPlayerMuted(true, "layout-effect-prime", "screen-focused-mount");
        requestPlay("layout-effect-prime");
      } catch {}
    } else if (warmModeRef.current === "active") {
      try {
        setPlayerMuted(true, "layout-effect-active-prime", "screen-focused-mount");
        requestPlay("layout-effect-active-prime");
      } catch {}
    }
  }, [player, screenFocused, uri, postId]);

  useEffect(() => {
    if (!cachedReadyRef.current || reusedWarmLoggedRef.current) return;
    reusedWarmLoggedRef.current = true;
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_REUSED_WARM_PLAYER", { id: postId || null });
    }
  }, [postId]);

  useEffect(() => {
    const wasFocused = prevScreenFocusedRef.current;
    prevScreenFocusedRef.current = screenFocused;

    if (screenFocused && !wasFocused) {
      activeHandoffRef.current = false;
      if (!isActive) return;

      activateActivePlayback(
        peekHomeFeedVideoRecovery() ? "live-room-exit-refocus" : "screen-refocus"
      );
      if (peekHomeFeedVideoRecovery()) {
        consumeHomeFeedVideoRecovery();
      }
    }
  }, [screenFocused, isActive, firstFrameReady, postId, status]);

  useEffect(() => {
    if (!isActive) return;
    return subscribeHomeFeedVideoRecovery(() => {
      if (!screenFocused || !peekHomeFeedVideoRecovery()) return;
      activeHandoffRef.current = false;
      activateActivePlayback("live-room-exit-recovery");
      consumeHomeFeedVideoRecovery();
    });
  }, [isActive, screenFocused, firstFrameReady, player, postId, status]);

  useEffect(() => {
    if (playerDisposedRef.current) return;
    if (!postId || progressRestoredRef.current) return;
    if (!sourceLoadAllowed && !isActive) return;

    const saved = getHomeFeedVideoProgress(postId);
    if (saved === null || saved <= 0.1) return;

    const current = lastKnownTimeRef.current;
    if (current > 0.5 && Math.abs(current - saved) < 2) {
      progressRestoredRef.current = true;
      return;
    }

    const seekTo = peekHomeFeedVideoRestoreSeek(postId);
    if (seekTo === null) return;

    progressRestoredRef.current = true;
    console.log("KRISTO_VIDEO_PROGRESS_RESTORE", { id: postId, seconds: seekTo });
    seekPlayerToSeconds(seekTo, isActive ? "restore-on-active" : "restore-on-load");
    if (isRetainPrev || isActive) {
      setFirstFrameReady((prev) => (prev ? prev : true));
    }
  }, [sourceLoadAllowed, isActive, isRetainPrev, postId, player, status]);

  useEffect(() => {
    registerHomeFeedVideo(postId, player, {
      postId,
      shouldPlay: false,
      videoReady: false,
      reason: "simple-feed-video-mount",
    });

    return () => {
      playerDisposedRef.current = true;
      saveProgressIfNeeded("unmount", { refOnly: true });
      safePlayerPause(player);
      try {
        setPlayerMuted(true, "unmount-cleanup");
      } catch {}
      unregisterHomeFeedVideo(postId, { postId, reason: "simple-feed-video-unmount" });
    };
  }, [player, postId]);

  useEffect(() => {
    const registerKey = `${postId}:${warmMode}:${isActive ? 1 : 0}:${firstFrameReady ? 1 : 0}`;
    if (registerKey === lastRegisterKeyRef.current) return;
    lastRegisterKeyRef.current = registerKey;

    registerHomeFeedVideo(postId, player, {
      postId,
      shouldPlay: isActive,
      videoReady: firstFrameReady,
      reason: `warm-${warmMode}`,
    });
  }, [player, postId, warmMode, isActive, firstFrameReady]);

  useEffect(() => {
    if (mountedUriRef.current !== uri) {
      mountedUriRef.current = uri;
      mountMsRef.current = Date.now();
      timingLoggedRef.current = false;
      preloadPrimedRef.current = false;
      preloadStartLoggedRef.current = false;
      readyMarkedRef.current = false;
      cachedReadyRef.current = isHomeFeedVideoPreloadReady(postId, uri);
      reusedWarmLoggedRef.current = false;
      readyMsRef.current = cachedReadyRef.current ? 0 : null;
      firstFrameMsRef.current = null;
      setFirstFrameReady(false);
      activeHandoffRef.current = false;
      lastRegisterKeyRef.current = "";
      progressRestoredRef.current = false;
      firstFrameDiagLoggedRef.current = false;
      playStartedLoggedRef.current = false;
      lastBufferLogKeyRef.current = "";

      try {
        setPlayerMuted(true, "uri-change-prime");
        requestPlay("uri-change-prime");
      } catch {}
    }
  }, [uri, postId, player]);

  useEffect(() => {
    if (!screenFocused) return;
    if (!isActive && !shouldPrime) return;
    if (preloadStartLoggedRef.current) return;
    preloadStartLoggedRef.current = true;
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_VIDEO_WARMUP_START", {
        id: postId || null,
        videoUrl: uri,
        warmMode,
      });
      console.log("KRISTO_VIDEO_PRELOAD_START", { id: postId || null, videoUrl: uri });
    }
  }, [shouldPrime, isActive, screenFocused, postId, uri, warmMode]);

  useEffect(() => {
    if (playerDisposedRef.current) return;

    if (!screenFocused) {
      safePlayerPause(player);
      try {
        setPlayerMuted(true, "screen-unfocused");
      } catch {}
      return;
    }

    if (isActive) {
      if (computeDecodeShouldPlay()) {
        activateActivePlayback("simple-feed-video-active-handoff");
        recoverAudioIfNeeded("active-playback-effect");
        if (firstFrameReady) logStartupTiming();
      }
      return;
    }

    if (isRetainPrev) {
      setPlayerMuted(true, "retain-prev-paused", warmMode);
      safePlayerPause(player);
      return;
    }

    if (shouldPrime) {
      setPlayerMuted(true, "warm-preload-prime", warmMode);
      if (computePreloadShouldPlay()) {
        if (!firstFrameReady) {
          requestPlay("warm-preload-progressive");
        } else if (!preloadPrimedRef.current) {
          preloadPrimedRef.current = true;
          safePlayerPause(player);
        }
      }
      return;
    }

    safePlayerPause(player);
    try {
      setPlayerMuted(true, "inactive-off-screen");
    } catch {}
  }, [
    player,
    isActive,
    isRetainPrev,
    shouldPrime,
    screenFocused,
    uri,
    warmMode,
    firstFrameReady,
    appActive,
  ]);

  useEffect(() => {
    if (!screenFocused || playerDisposedRef.current) return;

    const lower = statusLower(status);
    const t = safeGetPlayerCurrentTime(player);
    if (t > 0) lastKnownTimeRef.current = t;
    const isPlaying = safeGetPlayerPlaying(player);
    lastKnownPlayingRef.current = isPlaying;

    logBufferingState(lower, t);

    if (isPlaying && !playStartedLoggedRef.current) {
      playStartedLoggedRef.current = true;
      console.log("KRISTO_VIDEO_PLAY_STARTED", {
        id: postId || null,
        status: lower,
        currentTime: t,
      });
    }

    if (isPlayerReadyToStart(status, t, isPlaying) && readyMsRef.current === null) {
      readyMsRef.current = Date.now() - mountMsRef.current;
      if (readyMsRef.current <= 800) {
        console.log("KRISTO_VIDEO_READY_FAST", {
          id: postId || null,
          warmMode,
          ms: readyMsRef.current,
        });
      }
    }

    if (isActive && computeDecodeShouldPlay()) {
      if (!firstFrameReady) {
        activateActivePlayback("status-progressive-pre-frame");
      } else if (!isPlaying) {
        requestPlay("status-active-continue");
      }
    }

    if (shouldPrime && !isActive && firstFrameReady) {
      safePlayerPause(player);
      setPlayerMuted(true, "preload-first-frame-pause", warmMode);
    }

    if (!shouldMarkReadiness(status, t, isPlaying)) {
      return;
    }

    if (!readyMarkedRef.current) {
      readyMarkedRef.current = true;
      markHomeFeedVideoPreloadReady(postId, uri);
      cachedReadyRef.current = true;
      if (shouldPrime) {
        if (isKristoVerboseFeedDebug()) {
          console.log("KRISTO_VIDEO_PRELOAD_READY", { id: postId || null });
        }
      }
    } else if (isPreload || isRetainPrev) {
      touchHomeFeedVideoReadiness(postId, uri);
    }

    if (isActive) {
      markFirstFrame(false);
      activateActivePlayback("simple-feed-video-active");
      recoverAudioIfNeeded("status-ready-active");
      logStartupTiming();
      return;
    }

    markFirstFrame(false);

    if (!isActive && !shouldPrime) {
      safePlayerPause(player);
      setPlayerMuted(true, "status-ready-inactive", warmMode);
    }
  }, [
    isActive,
    shouldPrime,
    isRetainPrev,
    isPreload,
    screenFocused,
    status,
    currentTime,
    playing,
    player,
    postId,
    uri,
    warmMode,
    firstFrameReady,
    appActive,
  ]);

  useEffect(() => {
    if (isActive || !screenFocused) return;
    pauseHomeFeedVideo(postId, { postId, reason: `warm-${warmMode}` });
  }, [isActive, warmMode, screenFocused, postId]);

  // Diagnostic (first 3 video rows): dev-only when KRISTO_VERBOSE_FEED_DEBUG is on.
  useEffect(() => {
    if (!isKristoVerboseFeedDebug()) return;
    if (feedIndex < 0 || feedIndex > 2) return;
    const videoShouldPlay = computeDecodeShouldPlay();
    const videoReady = computeVideoReady();
    const key = `${feedIndex}:${isActive ? 1 : 0}:${firstFrameReady ? 1 : 0}:${videoReady ? 1 : 0}:${videoShouldPlay ? 1 : 0}:${screenFocused ? 1 : 0}:${appActive ? 1 : 0}:${warmMode}:${statusLower(status)}`;
    if (key === lastRowDiagKeyRef.current) return;
    lastRowDiagKeyRef.current = key;
    console.log("KRISTO_VIDEO_ROW_DIAG", {
      id: postId || null,
      index: feedIndex,
      isActive,
      shouldPlay: isActive,
      videoShouldPlay,
      warmMode,
      videoReady,
      firstFrameReady,
      screenFocused,
      appActive,
      status: statusLower(status),
    });
  }, [
    feedIndex,
    isActive,
    firstFrameReady,
    screenFocused,
    appActive,
    status,
    currentTime,
    playing,
    warmMode,
    postId,
  ]);

  const poster = String(posterUri || "").trim();
  const hasPoster = isValidVideoPosterUri(poster, uri);
  const hasBranded = brandedPoster || hasBrandedVideoPoster({ posterUri: poster, brandedPoster });
  const showCoverUntilFirstFrame = !firstFrameReady;
  const showPosterOverlay = showCoverUntilFirstFrame && hasPoster;
  const showBrandedCover = showCoverUntilFirstFrame && !hasPoster && hasBranded;
  const showGoldFallback = showCoverUntilFirstFrame && !hasPoster && !hasBranded;
  const hideVideoSurface = showCoverUntilFirstFrame;

  useEffect(() => {
    if (!isActive || feedIndex !== 0) return;
    if (firstPosterCheckLogged) return;
    firstPosterCheckLogged = true;
    console.log("KRISTO_VIDEO_FIRST_POSTER_CHECK", {
      id: postId || null,
      hasPosterUrl: hasPoster,
      posterHost: urlHost(poster),
      videoUrlHost: urlHost(uri),
      contentLength: Number(contentLength || 0) > 0 ? Number(contentLength) : null,
      brandedPoster: hasBranded,
    });
  }, [isActive, feedIndex, postId, poster, uri, hasPoster, hasBranded, contentLength]);

  useEffect(() => {
    if (!hasPoster || !isActive) return;
    Image.prefetch(poster).catch(() => {});
  }, [poster, hasPoster, isActive]);

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        style={[styles.videoSurface, hideVideoSurface && styles.videoHidden]}
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
            videoUrl={uri}
            mediaStatus={mediaStatus}
          />
        </View>
      ) : null}
      {showBrandedCover || showGoldFallback ? (
        <View style={styles.overlay} pointerEvents="none">
          <VideoPostFallbackPoster
            variant="full"
            postId={postId}
            title={title}
            videoUrl={uri}
            mediaStatus={mediaStatus}
            suppressMissingPosterLog={showBrandedCover}
          />
        </View>
      ) : null}
    </View>
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
});
