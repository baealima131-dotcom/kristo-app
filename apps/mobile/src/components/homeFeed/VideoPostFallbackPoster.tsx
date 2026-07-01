import React, { memo, useEffect } from "react";
import {
  Animated,
  Easing,
  Image,
  ImageResizeMode,
  ImageStyle,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import {
  logMediaPosterCacheHit,
  hydrateMediaPosterCache,
  resolveCachedMediaPoster,
  subscribeMediaPosterCache,
} from "@/src/lib/mediaPosterCache";
import { markHomeFeedPosterPipelineStage } from "@/src/lib/homeFeedPosterPipelineTrace";
import {
  prefetchHomeFeedPosterMetadata,
  queueHomeFeedPosterPrewarm,
} from "@/src/lib/homeFeedPosterPrewarm";
import { isHomeFeedYoutubePosterMetadataEnabled } from "@/src/lib/homeFeedVideoMode";
import { shouldDeferBackgroundMediaJobs } from "@/src/lib/homeFeedWatchPlaybackPriority";
import {
  getHomeFeedPosterLoadTimeoutMs,
  isLocalMediaUri,
  probePosterUrlReachability,
  resolveClientVideoThumbnailUri,
  resolveVideoThumbnailUri,
} from "@/src/lib/videoGridThumbnail";
import type { ActivityGridPreviewTrace } from "@/src/lib/churchActivityPosts";
import { logActivityGridPreviewTrace } from "@/src/lib/churchActivityPosts";
import {
  collectFeedVideoPosterCandidates,
  describePosterResolution,
  type PosterMetadataSnapshot,
  snapshotPosterMetadata,
  resolveYouTubeFeedMetadataPosterUri,
} from "./homeFeedUtils";
import {
  logHomeFeedPosterSourceOnce,
  resolveHomeFeedPosterDisplay,
} from "@/src/lib/homeFeedPosterSource";

const GOLD = "#F4D06F";
const HOME_FEED_POSTER_FADE_MS = 80;

function logHomeFeedPosterLoadStart(postId: string, videoUrl: string, source: string) {
  console.log("KRISTO_HOME_FEED_POSTER_LOAD_START", {
    postId: postId || null,
    videoUrl: videoUrl || null,
    source,
  });
}

function logHomeFeedPosterLoadSuccess(postId: string, videoUrl: string, uri: string, source: string) {
  console.log("KRISTO_HOME_FEED_POSTER_LOAD_SUCCESS", {
    postId: postId || null,
    videoUrl: videoUrl || null,
    uri: uri || null,
    source,
  });
}

function logHomeFeedPosterLoadFailed(
  postId: string,
  videoUrl: string,
  reason: string,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_HOME_FEED_POSTER_LOAD_FAILED", {
    postId: postId || null,
    videoUrl: videoUrl || null,
    reason,
    ...(extra || {}),
  });
}

const placeholderLoggedSessionKeys = new Set<string>();

type PosterCoverSessionState = {
  uri: string;
  source: string;
};

const posterCoverSessionByKey = new Map<string, PosterCoverSessionState>();
const posterMetadataFailedSessionKeys = new Set<string>();

function posterCoverSessionKey(postId: string, videoUrl: string) {
  return `${String(postId || "").trim()}|${String(videoUrl || "").trim().split("?")[0]}`;
}

function markPosterMetadataFailed(postId: string, videoUrl: string) {
  posterMetadataFailedSessionKeys.add(posterCoverSessionKey(postId, videoUrl));
}

function hasPosterMetadataFailed(postId: string, videoUrl: string) {
  return posterMetadataFailedSessionKeys.has(posterCoverSessionKey(postId, videoUrl));
}

function readPosterCoverSession(postId: string, videoUrl: string): PosterCoverSessionState | null {
  return posterCoverSessionByKey.get(posterCoverSessionKey(postId, videoUrl)) || null;
}

function writePosterCoverSession(postId: string, videoUrl: string, uri: string, source: string) {
  const normalized = String(uri || "").trim();
  if (!normalized) return;
  posterCoverSessionByKey.set(posterCoverSessionKey(postId, videoUrl), {
    uri: normalized,
    source,
  });
}

function logHomeFeedPosterPlaceholderShown(postId: string, videoUrl: string, reason: string) {
  const key = `${String(postId || "").trim()}|${String(videoUrl || "").trim().split("?")[0]}|${reason}`;
  if (placeholderLoggedSessionKeys.has(key)) return;
  placeholderLoggedSessionKeys.add(key);
  console.log("KRISTO_HOME_FEED_POSTER_PLACEHOLDER_SHOWN", {
    postId: postId || null,
    videoUrl: videoUrl || null,
    reason,
  });
}

/** Branded gradient cover — never a flat black rectangle. */
function HomeFeedPosterGradientPlaceholder() {
  return (
    <LinearGradient
      colors={["#1a1a1a", "#2a3344", "#1a1a1a"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    />
  );
}

type Props = {
  postId?: string;
  title?: string;
  churchName?: string;
  videoUrl?: string;
  mediaStatus?: string;
  variant?: "full" | "minimal" | "feed-thumb";
  /** When true, skip the black/gradient missing-poster diagnostic log. */
  suppressMissingPosterLog?: boolean;
};

export const VideoPostFallbackPoster = memo(function VideoPostFallbackPoster({
  postId = "",
  title = "",
  churchName = "",
  videoUrl = "",
  mediaStatus = "",
  variant = "full",
  suppressMissingPosterLog = false,
}: Props) {
  const status = String(mediaStatus || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "uploading";
  const displayTitle = String(title || "").trim();
  const displayChurch = String(churchName || "").trim();

  useEffect(() => {
    if (variant === "feed-thumb" || variant !== "full" || suppressMissingPosterLog) return;
    if (!isKristoVerboseFeedDebug()) return;
    console.log("KRISTO_VIDEO_POST_BLACK_FALLBACK_USED", {
      id: postId || null,
      videoUrl: videoUrl || null,
      mediaStatus: status || null,
    });
  }, [postId, videoUrl, status, variant, suppressMissingPosterLog]);

  if (variant === "feed-thumb") {
    return (
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <HomeFeedPosterGradientPlaceholder />
        {isProcessing ? (
          <View style={styles.feedThumbProcessing} pointerEvents="none">
            <Text style={styles.feedThumbProcessingText}>Processing…</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (variant === "minimal") {
    return (
      <View style={styles.minimalRoot} pointerEvents="none">
        <View style={styles.minimalPill}>
          <Text style={styles.minimalText}>
            {isProcessing ? "Processing video…" : "Loading video…"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#4A3D24", "#243B55", "#1B2A44"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.content}>
        <View style={styles.playBadge}>
          <Ionicons name="play" size={28} color="#1B2A44" />
        </View>
        {displayChurch ? (
          <Text style={styles.churchName} numberOfLines={1}>
            {displayChurch}
          </Text>
        ) : null}
        {displayTitle ? (
          <Text style={styles.title} numberOfLines={3}>
            {displayTitle}
          </Text>
        ) : null}
      </View>
      {isProcessing ? (
        <View style={styles.processingOverlay} pointerEvents="none">
          <Text style={styles.processingText}>Processing video…</Text>
        </View>
      ) : null}
    </View>
  );
});

type FeedVideoPosterImageProps = {
  uri?: string;
  item?: any;
  style?: ImageStyle;
  resizeMode?: ImageResizeMode;
  postId?: string;
  title?: string;
  churchName?: string;
  videoUrl?: string;
  mediaStatus?: string;
  previewTrace?: ActivityGridPreviewTrace;
  enableClientThumbnailFallback?: boolean;
  enableVideoFrameFallback?: boolean;
  previewLoadTimeoutMs?: number;
  posterMetadata?: PosterMetadataSnapshot;
  videoDurationMs?: number;
  /** YouTube Home Feed: image-only covers with gradient placeholder (never black). */
  youtubeMode?: boolean;
  /** When false, keep placeholder — no remote Image fetch (off-screen window). */
  allowImageLoad?: boolean;
  /** Fires when a cover is ready for play overlay (poster faded in or settled placeholder). */
  onPosterCoverReady?: (ready: boolean) => void;
};

type PosterLoadState = "idle" | "probing" | "loading" | "loaded" | "failed" | "generating";

function emptyPreviewTrace(
  postId: string,
  videoUrl: string
): ActivityGridPreviewTrace {
  return {
    postId,
    mediaUrl: "",
    videoUrl,
    resolvedVideoUri: videoUrl,
    thumbnailUrl: "",
    posterUrl: "",
    coverUrl: "",
    previewUrl: "",
    inferredPosterUri: "",
    finalPreviewUri: "",
    resolvedPreviewUrl: "",
    storedPosterUri: "",
    storedVideoPosterUri: "",
    storedThumbnailUri: "",
    brandedPoster: false,
  };
}

function logPreviewEvent(
  previewTrace: ActivityGridPreviewTrace | undefined,
  postId: string,
  videoUrl: string,
  extra: Record<string, unknown>
) {
  logActivityGridPreviewTrace(previewTrace || emptyPreviewTrace(postId, videoUrl), extra);
}

function logPosterPipelineDiag(params: {
  postId: string;
  videoUrl: string;
  posterUri: string;
  posterMetadata?: PosterMetadataSnapshot;
  resolution?: ReturnType<typeof describePosterResolution>;
  probe?: Awaited<ReturnType<typeof probePosterUrlReachability>>;
  fallbackPath: string;
  extra?: Record<string, unknown>;
}) {
  console.log("KRISTO_VIDEO_POSTER_PIPELINE_DIAG", {
    id: params.postId || null,
    generatedPosterUrl: params.posterUri || null,
    videoUrl: params.videoUrl || null,
    httpStatus: params.probe?.httpStatus ?? null,
    posterExistsInMetadata: params.resolution?.posterExistsInMetadata ?? Boolean(
      params.posterMetadata?.posterUri ||
        params.posterMetadata?.videoPosterUri ||
        params.posterMetadata?.thumbnailUri ||
        params.posterMetadata?.thumbnailUrl ||
        params.posterMetadata?.posterUrl
    ),
    posterMetadata: params.posterMetadata || null,
    resolutionSource: params.resolution?.source || null,
    fallbackPath: params.fallbackPath,
    probe: params.probe || null,
    ...(params.extra || {}),
  });
}

export function FeedVideoPosterImage(props: FeedVideoPosterImageProps) {
  if (props.youtubeMode) {
    return <YouTubeFeedVideoPoster {...props} />;
  }
  return <LegacyFeedVideoPosterImage {...props} />;
}

function YouTubeFeedVideoPoster({
  item,
  style,
  resizeMode = "cover",
  postId = "",
  videoUrl = "",
  mediaStatus = "",
  videoDurationMs,
  allowImageLoad = true,
  onPosterCoverReady,
}: FeedVideoPosterImageProps) {
  const resolvedVideoUrl = String(videoUrl || "").trim();
  const status = String(mediaStatus || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "uploading";

  const [displayUri, setDisplayUri] = React.useState("");
  const [loadSource, setLoadSource] = React.useState("metadata");
  const [posterFadedIn, setPosterFadedIn] = React.useState(false);
  const [settledPlaceholder, setSettledPlaceholder] = React.useState(false);
  const fadeOpacity = React.useRef(new Animated.Value(0)).current;
  const loadStartLoggedRef = React.useRef(false);
  const frameGenAttemptedRef = React.useRef(false);
  const cancelledRef = React.useRef(false);
  const loadedUriRef = React.useRef("");
  const loadedSourceRef = React.useRef("");
  const coverReadyRef = React.useRef(false);

  const notifyCoverReady = React.useCallback(
    (ready: boolean) => {
      coverReadyRef.current = ready;
      onPosterCoverReady?.(ready);
    },
    [onPosterCoverReady]
  );

  const restoreLoadedPoster = React.useCallback(() => {
    if (!loadedUriRef.current || !coverReadyRef.current) return false;
    setDisplayUri(loadedUriRef.current);
    setLoadSource(loadedSourceRef.current);
    setPosterFadedIn(true);
    setSettledPlaceholder(false);
    fadeOpacity.setValue(1);
    notifyCoverReady(true);
    return true;
  }, [fadeOpacity, notifyCoverReady]);

  const logPlaceholderOnce = React.useCallback(
    (reason: string) => {
      logHomeFeedPosterPlaceholderShown(postId, resolvedVideoUrl, reason);
    },
    [postId, resolvedVideoUrl]
  );

  const markPosterFadedIn = React.useCallback(
    (uri: string, source: string) => {
      setPosterFadedIn(true);
      setSettledPlaceholder(false);
      loadedUriRef.current = uri;
      loadedSourceRef.current = source;
      writePosterCoverSession(postId, resolvedVideoUrl, uri, source);
      notifyCoverReady(true);
      markHomeFeedPosterPipelineStage(postId, "first_poster_painted", {
        posterUri: uri,
        videoUrl: resolvedVideoUrl,
        source,
      });
    },
    [notifyCoverReady, postId, resolvedVideoUrl]
  );

  const fadeInPoster = React.useCallback(
    (uri: string, source: string) => {
      Animated.timing(fadeOpacity, {
        toValue: 1,
        duration: HOME_FEED_POSTER_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          markPosterFadedIn(uri, source);
        }
      });
    },
    [fadeOpacity, markPosterFadedIn]
  );

  const settleOnPlaceholder = React.useCallback(
    (reason: string) => {
      if (cancelledRef.current) return;
      setDisplayUri("");
      setPosterFadedIn(false);
      fadeOpacity.setValue(0);
      setSettledPlaceholder(true);
      logHomeFeedPosterLoadFailed(postId, resolvedVideoUrl, reason);
      logPlaceholderOnce("branded-settled");
      logHomeFeedPosterSourceOnce(postId, resolvedVideoUrl, "branded-fallback", videoDurationMs);
      notifyCoverReady(true);
    },
    [fadeOpacity, logPlaceholderOnce, notifyCoverReady, postId, resolvedVideoUrl, videoDurationMs]
  );

  const beginPosterLoad = React.useCallback(
    (uri: string, source: string) => {
      if (!uri || cancelledRef.current) return;
      if (uri === loadedUriRef.current && coverReadyRef.current) {
        restoreLoadedPoster();
        return;
      }
      if (!loadStartLoggedRef.current) {
        loadStartLoggedRef.current = true;
        logHomeFeedPosterLoadStart(postId, resolvedVideoUrl, source);
      }
      markHomeFeedPosterPipelineStage(postId, "poster_url_resolved", {
        posterUri: uri,
        videoUrl: resolvedVideoUrl,
        source,
      });
      markHomeFeedPosterPipelineStage(postId, "image_request_started", {
        posterUri: uri,
        videoUrl: resolvedVideoUrl,
        source,
      });
      setLoadSource(source);
      setDisplayUri(uri);
      setSettledPlaceholder(false);
      setPosterFadedIn(false);
      fadeOpacity.setValue(0);
    },
    [fadeOpacity, postId, resolvedVideoUrl, restoreLoadedPoster]
  );

  const tryGenerateFrame = React.useCallback(async () => {
    if (!resolvedVideoUrl || isProcessing || frameGenAttemptedRef.current) return;
    frameGenAttemptedRef.current = true;
    if (!loadStartLoggedRef.current) {
      loadStartLoggedRef.current = true;
      logHomeFeedPosterLoadStart(postId, resolvedVideoUrl, "generated-frame");
    }
    const generated = await resolveVideoThumbnailUri(resolvedVideoUrl, {
      postId,
      durationMs: videoDurationMs,
      homeFeed: true,
    });
    if (cancelledRef.current) return;
    if (generated) {
      beginPosterLoad(generated, "generated-frame");
      return;
    }
    settleOnPlaceholder("frame-generation-failed");
  }, [
    beginPosterLoad,
    isProcessing,
    postId,
    resolvedVideoUrl,
    settleOnPlaceholder,
    videoDurationMs,
  ]);

  React.useEffect(() => {
    if (!postId) return;
    markHomeFeedPosterPipelineStage(postId, "image_component_mounted", {
      videoUrl: resolvedVideoUrl,
      source: "YouTubeFeedVideoPoster",
    });
  }, [postId, resolvedVideoUrl]);

  React.useEffect(() => {
    cancelledRef.current = false;
    frameGenAttemptedRef.current = false;

    const sessionCover = readPosterCoverSession(postId, resolvedVideoUrl);
    const cachedPoster = resolveCachedMediaPoster(postId, resolvedVideoUrl);
    const restoredUri = sessionCover?.uri || cachedPoster || "";

    if (restoredUri) {
      loadedUriRef.current = restoredUri;
      loadedSourceRef.current = sessionCover?.source || "cache";
      coverReadyRef.current = true;
      loadStartLoggedRef.current = true;
      setDisplayUri(restoredUri);
      setLoadSource(loadedSourceRef.current);
      setPosterFadedIn(true);
      setSettledPlaceholder(false);
      fadeOpacity.setValue(1);
      notifyCoverReady(true);
      markHomeFeedPosterPipelineStage(postId, "poster_url_resolved", {
        posterUri: restoredUri,
        videoUrl: resolvedVideoUrl,
        source: loadedSourceRef.current,
      });
      return;
    }

    loadStartLoggedRef.current = false;
    loadedUriRef.current = "";
    loadedSourceRef.current = "";
    coverReadyRef.current = false;
    setDisplayUri("");
    setPosterFadedIn(false);
    setSettledPlaceholder(false);
    fadeOpacity.setValue(0);
    notifyCoverReady(false);

    if (item) {
      const metadataUri = resolveYouTubeFeedMetadataPosterUri(item, postId, resolvedVideoUrl);
      if (metadataUri && !hasPosterMetadataFailed(postId, resolvedVideoUrl)) {
        beginPosterLoad(metadataUri, "metadata");
      }
    }

    if (!isHomeFeedYoutubePosterMetadataEnabled() || !item) return;

    prefetchHomeFeedPosterMetadata(item);
    void hydrateMediaPosterCache().then(() => {
      if (cancelledRef.current) return;
      const hydrated = resolveCachedMediaPoster(postId, resolvedVideoUrl);
      if (hydrated) {
        beginPosterLoad(hydrated, "cache");
      }
    });
    void queueHomeFeedPosterPrewarm(item, { priority: "visible" }).then((ok) => {
      if (cancelledRef.current || !ok) return;
      const next = resolveCachedMediaPoster(postId, resolvedVideoUrl);
      if (next) beginPosterLoad(next, "cache");
    });
  }, [beginPosterLoad, fadeOpacity, item, notifyCoverReady, postId, resolvedVideoUrl]);

  React.useEffect(() => {
    cancelledRef.current = false;

    if (coverReadyRef.current && loadedUriRef.current) {
      restoreLoadedPoster();
      return () => {
        cancelledRef.current = true;
      };
    }

    if (!allowImageLoad) {
      if (restoreLoadedPoster()) return () => {
        cancelledRef.current = true;
      };
      if (displayUri) {
        return () => {
          cancelledRef.current = true;
        };
      }
      logPlaceholderOnce("deferred-offscreen");
      return () => {
        cancelledRef.current = true;
      };
    }

    if (restoreLoadedPoster()) {
      return () => {
        cancelledRef.current = true;
      };
    }

    logPlaceholderOnce("initial-gradient");

    const cached = resolveCachedMediaPoster(postId, resolvedVideoUrl);
    if (cached) {
      beginPosterLoad(cached, "cache");
      return () => {
        cancelledRef.current = true;
      };
    }

    const metadataUri = item
      ? resolveYouTubeFeedMetadataPosterUri(item, postId, resolvedVideoUrl)
      : "";
    if (metadataUri && !hasPosterMetadataFailed(postId, resolvedVideoUrl)) {
      beginPosterLoad(metadataUri, "metadata");
      return () => {
        cancelledRef.current = true;
      };
    }

    const display = item
      ? resolveHomeFeedPosterDisplay(postId, resolvedVideoUrl, item)
      : { uri: "", source: "inferred" as const };
    if (display.uri) {
      beginPosterLoad(display.uri, display.source);
      return () => {
        cancelledRef.current = true;
      };
    }

    const candidates = item ? collectFeedVideoPosterCandidates(item, postId) : [];
    const candidate = candidates.find((uri) => !isBrandedPosterUri(uri));
    if (candidate && !hasPosterMetadataFailed(postId, resolvedVideoUrl)) {
      beginPosterLoad(candidate, "metadata");
      return () => {
        cancelledRef.current = true;
      };
    }

    if (!isHomeFeedYoutubePosterMetadataEnabled()) {
      void tryGenerateFrame();
    }

    return () => {
      cancelledRef.current = true;
    };
  }, [
    allowImageLoad,
    beginPosterLoad,
    displayUri,
    item,
    logPlaceholderOnce,
    postId,
    resolvedVideoUrl,
    restoreLoadedPoster,
    tryGenerateFrame,
  ]);

  React.useEffect(() => {
    if (!allowImageLoad || !postId || !resolvedVideoUrl) return undefined;
    return subscribeMediaPosterCache(postId, resolvedVideoUrl, (cached) => {
      if (cancelledRef.current) return;
      if (cached && cached !== displayUri) {
        beginPosterLoad(cached, "cache");
      }
    });
  }, [allowImageLoad, beginPosterLoad, displayUri, postId, resolvedVideoUrl]);

  React.useEffect(() => {
    if (posterFadedIn || settledPlaceholder || coverReadyRef.current) {
      notifyCoverReady(true);
      return;
    }
    if (!allowImageLoad) {
      notifyCoverReady(false);
      return;
    }
    notifyCoverReady(false);
  }, [allowImageLoad, notifyCoverReady, posterFadedIn, settledPlaceholder]);

  const handleImageLoad = React.useCallback(() => {
    if (!displayUri) return;
    loadedUriRef.current = displayUri;
    loadedSourceRef.current = loadSource;
    coverReadyRef.current = true;
    writePosterCoverSession(postId, resolvedVideoUrl, displayUri, loadSource);
    logHomeFeedPosterLoadSuccess(postId, resolvedVideoUrl, displayUri, loadSource);
    logHomeFeedPosterSourceOnce(postId, resolvedVideoUrl, loadSource as any, videoDurationMs);
    markHomeFeedPosterPipelineStage(postId, "image_loaded", {
      posterUri: displayUri,
      videoUrl: resolvedVideoUrl,
      source: loadSource,
    });
    fadeInPoster(displayUri, loadSource);
  }, [displayUri, fadeInPoster, loadSource, postId, resolvedVideoUrl, videoDurationMs]);

  const handleImageError = React.useCallback(() => {
    if (loadSource === "metadata") {
      markPosterMetadataFailed(postId, resolvedVideoUrl);
    }
    logHomeFeedPosterLoadFailed(postId, resolvedVideoUrl, "image-load-error", {
      uri: displayUri || null,
      source: loadSource,
    });
    setDisplayUri("");
    setPosterFadedIn(false);
    fadeOpacity.setValue(0);

    const cached = resolveCachedMediaPoster(postId, resolvedVideoUrl);
    if (cached && cached !== displayUri) {
      beginPosterLoad(cached, "cache");
      return;
    }

    if (frameGenAttemptedRef.current) {
      settleOnPlaceholder("image-and-frame-failed");
      return;
    }
    if (isHomeFeedYoutubePosterMetadataEnabled()) {
      settleOnPlaceholder("youtube-metadata-failed");
      return;
    }
    void tryGenerateFrame();
  }, [
    beginPosterLoad,
    displayUri,
    fadeOpacity,
    loadSource,
    postId,
    resolvedVideoUrl,
    settleOnPlaceholder,
    tryGenerateFrame,
  ]);

  const showPosterImage = Boolean(displayUri);

  return (
    <View style={style}>
      {!posterFadedIn ? <HomeFeedPosterGradientPlaceholder /> : null}
      {showPosterImage ? (
        <Animated.Image
          source={{ uri: displayUri }}
          style={[StyleSheet.absoluteFillObject, { opacity: fadeOpacity }]}
          resizeMode={resizeMode}
          onLoadStart={() => {
            markHomeFeedPosterPipelineStage(postId, "image_request_started", {
              posterUri: displayUri,
              videoUrl: resolvedVideoUrl,
              source: `${loadSource}:native`,
            });
          }}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      ) : null}
    </View>
  );
}

function LegacyFeedVideoPosterImage({
  uri = "",
  item,
  style,
  resizeMode = "cover",
  postId = "",
  title = "",
  videoUrl = "",
  mediaStatus = "",
  previewTrace,
  enableClientThumbnailFallback = false,
  enableVideoFrameFallback = false,
  previewLoadTimeoutMs = getHomeFeedPosterLoadTimeoutMs(),
  posterMetadata,
  videoDurationMs,
}: FeedVideoPosterImageProps) {
  const resolvedVideoUrl = String(videoUrl || "").trim();
  const status = String(mediaStatus || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "uploading";
  const posterCandidates = React.useMemo(() => {
    if (item) return collectFeedVideoPosterCandidates(item, postId);
    const single = String(uri || "").trim();
    if (single && !isBrandedPosterUri(single)) return [single];
    return [];
  }, [item, postId, uri]);
  const posterUri = posterCandidates[0] || "";
  const hasPosterUri = posterCandidates.length > 0;
  const metadata = posterMetadata || snapshotPosterMetadata(item || null);
  const resolution = describePosterResolution(
    item || {
      posterUri: metadata.posterUri,
      videoPosterUri: metadata.videoPosterUri,
      thumbnailUri: metadata.thumbnailUri,
      thumbnailUrl: metadata.thumbnailUrl,
      posterUrl: metadata.posterUrl,
      videoUrl: resolvedVideoUrl,
      mediaUri: resolvedVideoUrl,
    },
    posterUri
  );
  const cachedPosterUri = resolveCachedMediaPoster(postId, resolvedVideoUrl);
  const cacheHitLoggedRef = React.useRef("");

  const logCacheHitOnce = React.useCallback(
    (cachedUri: string) => {
      const key = `${postId}|${resolvedVideoUrl}|${cachedUri}`;
      if (cacheHitLoggedRef.current === key) return;
      cacheHitLoggedRef.current = key;
      logMediaPosterCacheHit({
        postId,
        videoUrl: resolvedVideoUrl,
        posterUri: cachedUri,
      });
    },
    [postId, resolvedVideoUrl]
  );

  const applyCachedPoster = React.useCallback(
    (cachedUri: string) => {
      setDisplayUri(cachedUri);
      setPosterState("loaded");
      setClientThumbUri("");
      setClientThumbState("idle");
      setLastProbe(null);
      logCacheHitOnce(cachedUri);
    },
    [logCacheHitOnce]
  );

  const [posterState, setPosterState] = React.useState<PosterLoadState>(() =>
    cachedPosterUri ? "loaded" : hasPosterUri ? "probing" : "failed"
  );
  const [displayUri, setDisplayUri] = React.useState(() => cachedPosterUri || "");
  const [clientThumbUri, setClientThumbUri] = React.useState("");
  const [clientThumbState, setClientThumbState] = React.useState<PosterLoadState>("idle");
  const [lastProbe, setLastProbe] = React.useState<Awaited<
    ReturnType<typeof probePosterUrlReachability>
  > | null>(null);

  const canTryClientThumb =
    enableClientThumbnailFallback &&
    Boolean(resolvedVideoUrl) &&
    isLocalMediaUri(resolvedVideoUrl) &&
    !isProcessing;
  const canTryVideoFrameFallback =
    enableVideoFrameFallback && Boolean(resolvedVideoUrl) && !isProcessing;

  useEffect(() => {
    cacheHitLoggedRef.current = "";
    const cached = resolveCachedMediaPoster(postId, resolvedVideoUrl);
    if (cached) {
      applyCachedPoster(cached);
      return;
    }
    setPosterState(hasPosterUri ? "probing" : "failed");
    setDisplayUri("");
    setClientThumbUri("");
    setClientThumbState("idle");
    setLastProbe(null);
  }, [posterCandidates, resolvedVideoUrl, hasPosterUri, postId, applyCachedPoster]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const cached = resolveCachedMediaPoster(postId, resolvedVideoUrl);
      if (cached) {
        if (cancelled) return;
        applyCachedPoster(cached);
        return;
      }

      if (!hasPosterUri) {
        logPosterPipelineDiag({
          postId,
          videoUrl: resolvedVideoUrl,
          posterUri: "",
          posterMetadata: metadata,
          resolution,
          fallbackPath: canTryVideoFrameFallback ? "video-frame-generate" : "gradient",
          extra: { reason: "missing-poster-uri", candidateCount: posterCandidates.length },
        });
        if (canTryVideoFrameFallback) {
          setPosterState("generating");
        } else {
          setPosterState("failed");
        }
        return;
      }

      setPosterState("probing");

      for (const candidate of posterCandidates) {
        const probe = await probePosterUrlReachability(candidate);
        if (cancelled) return;

        if (probe.reachable) {
          setLastProbe(probe);
          logPosterPipelineDiag({
            postId,
            videoUrl: resolvedVideoUrl,
            posterUri: candidate,
            posterMetadata: metadata,
            resolution,
            probe,
            fallbackPath: "static-poster",
          });
          setDisplayUri(candidate);
          setPosterState("loading");
          return;
        }
      }

      const lastCandidate = posterCandidates[posterCandidates.length - 1] || posterUri;
      const lastProbeResult = await probePosterUrlReachability(lastCandidate);
      if (cancelled) return;
      setLastProbe(lastProbeResult);

      logPosterPipelineDiag({
        postId,
        videoUrl: resolvedVideoUrl,
        posterUri: lastCandidate,
        posterMetadata: metadata,
        resolution,
        probe: lastProbeResult,
        fallbackPath: canTryVideoFrameFallback ? "video-frame-generate" : "gradient",
        extra: { candidateCount: posterCandidates.length },
      });

      logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
        posterLoad: "probe-failed",
        failedPosterUri: lastCandidate,
        httpStatus: lastProbeResult.httpStatus,
        probeReason: lastProbeResult.reason || null,
      });

      if (canTryVideoFrameFallback) {
        setPosterState("generating");
        setDisplayUri("");
        return;
      }

      setPosterState("failed");
      setDisplayUri("");
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    posterCandidates,
    resolvedVideoUrl,
    hasPosterUri,
    postId,
    canTryVideoFrameFallback,
    previewTrace,
    applyCachedPoster,
    posterUri,
  ]);

  useEffect(() => {
    if (posterState !== "loading" || !hasPosterUri || !displayUri) return;

    const timer = setTimeout(() => {
      setPosterState("failed");
      logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
        posterLoad: "timeout",
        failedPosterUri: posterUri,
        timeoutMs: previewLoadTimeoutMs,
        httpStatus: lastProbe?.httpStatus ?? null,
      });
      if (canTryVideoFrameFallback) {
        setPosterState("generating");
        setDisplayUri("");
      }
    }, previewLoadTimeoutMs);

    return () => clearTimeout(timer);
  }, [
    posterState,
    hasPosterUri,
    displayUri,
    posterUri,
    postId,
    resolvedVideoUrl,
    previewTrace,
    previewLoadTimeoutMs,
    canTryVideoFrameFallback,
    lastProbe?.httpStatus,
  ]);

  useEffect(() => {
    if (posterState !== "generating" || !canTryVideoFrameFallback) return;

    const cached = resolveCachedMediaPoster(postId, resolvedVideoUrl);
    if (cached) {
      applyCachedPoster(cached);
      return;
    }

    let cancelled = false;
    logPosterPipelineDiag({
      postId,
      videoUrl: resolvedVideoUrl,
      posterUri,
      posterMetadata: metadata,
      resolution,
      probe: lastProbe || undefined,
      fallbackPath: "video-frame-generate",
    });

    void resolveVideoThumbnailUri(resolvedVideoUrl, {
      postId,
      durationMs: videoDurationMs,
    }).then((generated) => {
      if (cancelled) return;
      if (generated) {
        setDisplayUri(generated);
        setPosterState("loaded");
        logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
          posterLoad: "video-frame-success",
          loadedUri: generated,
          failedPosterUri: posterUri || null,
        });
        logPosterPipelineDiag({
          postId,
          videoUrl: resolvedVideoUrl,
          posterUri,
          posterMetadata: metadata,
          resolution,
          probe: lastProbe || undefined,
          fallbackPath: "video-frame-generate",
          extra: { loadedUri: generated },
        });
        return;
      }

      setPosterState("failed");
      logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
        posterLoad: "video-frame-failed",
        failedPosterUri: posterUri || null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    posterState,
    canTryVideoFrameFallback,
    postId,
    resolvedVideoUrl,
    posterUri,
    previewTrace,
    videoDurationMs,
    lastProbe,
    applyCachedPoster,
  ]);

  useEffect(() => {
    if (!canTryClientThumb) return;
    if (posterState !== "failed") return;
    if (clientThumbState !== "idle") return;

    let cancelled = false;
    setClientThumbState("loading");

    void resolveClientVideoThumbnailUri(resolvedVideoUrl).then((generated) => {
      if (cancelled) return;

      if (generated) {
        setClientThumbUri(generated);
        setClientThumbState("loaded");
        logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
          posterLoad: "client-thumbnail-success",
          clientThumbnailUri: generated,
          failedPosterUri: posterUri || null,
        });
        logPosterPipelineDiag({
          postId,
          videoUrl: resolvedVideoUrl,
          posterUri,
          posterMetadata: metadata,
          resolution,
          probe: lastProbe || undefined,
          fallbackPath: "client-thumbnail",
          extra: { loadedUri: generated },
        });
        return;
      }

      setClientThumbState("failed");
      logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
        posterLoad: "client-thumbnail-failed",
        failedPosterUri: posterUri || null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    canTryClientThumb,
    posterState,
    clientThumbState,
    resolvedVideoUrl,
    posterUri,
    postId,
    previewTrace,
    lastProbe,
  ]);

  useEffect(() => {
    if (!hasPosterUri || posterState !== "loading") return;
    if (!isKristoVerboseFeedDebug()) return;
    console.log("KRISTO_VIDEO_POSTER_RENDERED", {
      id: postId || null,
      posterUri,
      videoUrl: resolvedVideoUrl || null,
    });
  }, [hasPosterUri, posterState, posterUri, postId, resolvedVideoUrl]);

  const activeDisplayUri =
    posterState === "loaded" && displayUri
      ? displayUri
      : clientThumbState === "loaded" && clientThumbUri
        ? clientThumbUri
        : posterState === "loading" && displayUri
          ? displayUri
          : "";

  const shouldShowImage = Boolean(activeDisplayUri);

  if (!shouldShowImage) {
    return (
      <VideoPostFallbackPoster
        variant="full"
        postId={postId}
        title={title}
        videoUrl={videoUrl}
        mediaStatus={mediaStatus}
        suppressMissingPosterLog={posterCandidates.some((candidate) =>
          isBrandedPosterUri(candidate)
        )}
      />
    );
  }

  return (
    <View style={style}>
      <Image
        source={{ uri: activeDisplayUri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={resizeMode}
        onLoad={() => {
          if (activeDisplayUri === clientThumbUri) {
            setClientThumbState("loaded");
          } else {
            setPosterState("loaded");
          }
          logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
            posterLoad: "success",
            loadedUri: activeDisplayUri,
            httpStatus: lastProbe?.httpStatus ?? null,
          });
        }}
        onError={() => {
          if (activeDisplayUri === clientThumbUri) {
            setClientThumbUri("");
            setClientThumbState("failed");
            logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
              posterLoad: "client-thumbnail-image-fail",
              failedPosterUri: activeDisplayUri,
            });
            return;
          }

          logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
            posterLoad: canTryVideoFrameFallback ? "static-poster-fallback" : "fail",
            failedPosterUri: posterUri || null,
            httpStatus: lastProbe?.httpStatus ?? null,
            ...(canTryVideoFrameFallback ? { fallbackPath: "video-frame-generate" } : {}),
          });

          if (canTryVideoFrameFallback) {
            setPosterState("generating");
            setDisplayUri("");
            return;
          }

          setPosterState("failed");
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 14,
  },
  playBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  churchName: {
    color: GOLD,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(27,42,68,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  processingText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "600",
  },
  minimalRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 148,
  },
  minimalPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(27,42,68,0.72)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.35)",
  },
  minimalText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "600",
  },
  feedThumbProcessing: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  feedThumbProcessingText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "600",
  },
});
