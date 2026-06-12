import React, { memo, useEffect } from "react";
import { Image, ImageResizeMode, ImageStyle, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import {
  logMediaPosterCacheHit,
  resolveCachedMediaPoster,
  subscribeMediaPosterCache,
} from "@/src/lib/mediaPosterCache";
import {
  isHomeFeedPosterPrewarmFailed,
  queueHomeFeedPosterPrewarm,
} from "@/src/lib/homeFeedPosterPrewarm";
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
  posterMetadataFingerprint,
  type PosterMetadataSnapshot,
  snapshotPosterMetadata,
} from "./homeFeedUtils";
import {
  logHomeFeedPosterSourceOnce,
  promoteHomeFeedPosterCache,
  resolveHomeFeedPosterDisplay,
} from "@/src/lib/homeFeedPosterSource";

const GOLD = "#F4D06F";

type Props = {
  postId?: string;
  title?: string;
  churchName?: string;
  videoUrl?: string;
  mediaStatus?: string;
  variant?: "full" | "minimal";
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
    if (variant !== "full" || suppressMissingPosterLog) return;
    if (!isKristoVerboseFeedDebug()) return;
    console.log("KRISTO_VIDEO_POST_BLACK_FALLBACK_USED", {
      id: postId || null,
      videoUrl: videoUrl || null,
      mediaStatus: status || null,
    });
  }, [postId, videoUrl, status, variant, suppressMissingPosterLog]);

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
  /** YouTube Home Feed: branded poster immediately, no spinner, bg frame gen. */
  youtubeMode?: boolean;
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
  title = "",
  churchName = "",
  videoUrl = "",
  mediaStatus = "",
  videoDurationMs,
}: FeedVideoPosterImageProps) {
  const resolvedVideoUrl = String(videoUrl || "").trim();
  const status = String(mediaStatus || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "uploading";
  const posterFingerprint = posterMetadataFingerprint(item);
  const posterDisplay = React.useMemo(
    () =>
      resolvedVideoUrl
        ? resolveHomeFeedPosterDisplay(
            postId,
            resolvedVideoUrl,
            item,
            posterFingerprint
          )
        : { uri: "", source: "inferred" as const },
    [postId, resolvedVideoUrl, posterFingerprint]
  );
  const posterCandidates = React.useMemo(() => {
    if (item) return collectFeedVideoPosterCandidates(item, postId);
    return [];
  }, [item, postId, posterFingerprint]);

  const [imageUri, setImageUri] = React.useState(() => posterDisplay.uri);
  const [frameGenFailed, setFrameGenFailed] = React.useState(false);
  const imageUriRef = React.useRef(imageUri);
  imageUriRef.current = imageUri;

  React.useEffect(() => {
    logHomeFeedPosterSourceOnce(
      postId,
      resolvedVideoUrl,
      posterDisplay.source,
      videoDurationMs
    );
  }, [postId, resolvedVideoUrl, posterDisplay.source, videoDurationMs]);

  React.useEffect(() => {
    setFrameGenFailed(false);
    if (posterDisplay.uri && posterDisplay.uri !== imageUriRef.current) {
      setImageUri(posterDisplay.uri);
    }
  }, [posterDisplay.uri]);

  React.useEffect(() => {
    if (!postId || !resolvedVideoUrl) return;
    return subscribeMediaPosterCache(postId, resolvedVideoUrl, (uri) => {
      if (!uri) return;
      promoteHomeFeedPosterCache(postId, resolvedVideoUrl, uri);
      setImageUri(uri);
      setFrameGenFailed(false);
    });
  }, [postId, resolvedVideoUrl]);

  React.useEffect(() => {
    if (!item || isProcessing || !resolvedVideoUrl) return;
    if (shouldDeferBackgroundMediaJobs()) return;
    if (resolveCachedMediaPoster(postId, resolvedVideoUrl)) return;

    let cancelled = false;
    const failTimer = setTimeout(() => {
      if (cancelled || imageUriRef.current) return;
      if (isHomeFeedPosterPrewarmFailed(postId, resolvedVideoUrl)) {
        setFrameGenFailed(true);
      }
    }, 1500);

    void queueHomeFeedPosterPrewarm(item).then((ok) => {
      if (cancelled) return;
      if (ok) {
        setFrameGenFailed(false);
        return;
      }
      if (!imageUriRef.current) {
        setFrameGenFailed(true);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(failTimer);
    };
  }, [item, postId, resolvedVideoUrl, isProcessing, posterFingerprint]);

  const handleImageError = React.useCallback(() => {
    const current = imageUriRef.current;
    const nextCandidate = posterCandidates.find(
      (candidate) => candidate && candidate.split("?")[0] !== current.split("?")[0]
    );
    if (nextCandidate) {
      setImageUri(nextCandidate);
      return;
    }
    if (item && !isProcessing) {
      void queueHomeFeedPosterPrewarm(item).then((ok) => {
        if (!ok && !imageUriRef.current) setFrameGenFailed(true);
      });
    }
  }, [posterCandidates, item, isProcessing]);

  const showProcessingPoster = isProcessing;
  const showFailurePoster =
    !isProcessing &&
    !imageUri &&
    (frameGenFailed || isHomeFeedPosterPrewarmFailed(postId, resolvedVideoUrl));
  const showBrandedFallback = showProcessingPoster || showFailurePoster;

  React.useEffect(() => {
    if (!showBrandedFallback || imageUri) return;
    logHomeFeedPosterSourceOnce(postId, resolvedVideoUrl, "branded-fallback", videoDurationMs);
  }, [showBrandedFallback, imageUri, postId, resolvedVideoUrl, videoDurationMs]);

  return (
    <View style={style}>
      {showBrandedFallback ? (
        <VideoPostFallbackPoster
          variant="full"
          postId={postId}
          title={title}
          churchName={churchName}
          videoUrl={videoUrl}
          mediaStatus={mediaStatus}
          suppressMissingPosterLog
        />
      ) : null}
      {imageUri && !showProcessingPoster ? (
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={resizeMode}
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
});
