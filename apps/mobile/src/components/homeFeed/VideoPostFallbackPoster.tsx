import React, { memo, useEffect } from "react";
import { ActivityIndicator, Image, ImageResizeMode, ImageStyle, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import { generateVideoPosterFrame } from "@/src/lib/mediaVideoPoster";
import {
  getPreviewLoadTimeoutMs,
  isLocalMediaUri,
  probePosterUrlReachability,
  resolveClientVideoThumbnailUri,
} from "@/src/lib/videoGridThumbnail";
import type { ActivityGridPreviewTrace } from "@/src/lib/churchActivityPosts";
import { logActivityGridPreviewTrace } from "@/src/lib/churchActivityPosts";
import {
  describePosterResolution,
  type PosterMetadataSnapshot,
  snapshotPosterMetadata,
} from "./homeFeedUtils";

const GOLD = "#F4D06F";

type Props = {
  postId?: string;
  title?: string;
  videoUrl?: string;
  mediaStatus?: string;
  variant?: "full" | "minimal";
  /** When true, skip the black/gradient missing-poster diagnostic log. */
  suppressMissingPosterLog?: boolean;
};

export const VideoPostFallbackPoster = memo(function VideoPostFallbackPoster({
  postId = "",
  title = "",
  videoUrl = "",
  mediaStatus = "",
  variant = "full",
  suppressMissingPosterLog = false,
}: Props) {
  const status = String(mediaStatus || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "uploading";
  const displayTitle = String(title || "").trim();

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
          <ActivityIndicator size="small" color={GOLD} />
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
  uri: string;
  style?: ImageStyle;
  resizeMode?: ImageResizeMode;
  postId?: string;
  title?: string;
  videoUrl?: string;
  mediaStatus?: string;
  previewTrace?: ActivityGridPreviewTrace;
  enableClientThumbnailFallback?: boolean;
  enableVideoFrameFallback?: boolean;
  previewLoadTimeoutMs?: number;
  posterMetadata?: PosterMetadataSnapshot;
  videoDurationMs?: number;
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

export function FeedVideoPosterImage({
  uri,
  style,
  resizeMode = "cover",
  postId = "",
  title = "",
  videoUrl = "",
  mediaStatus = "",
  previewTrace,
  enableClientThumbnailFallback = false,
  enableVideoFrameFallback = true,
  previewLoadTimeoutMs = getPreviewLoadTimeoutMs(),
  posterMetadata,
  videoDurationMs,
}: FeedVideoPosterImageProps) {
  const posterUri = String(uri || "").trim();
  const resolvedVideoUrl = String(videoUrl || "").trim();
  const hasPosterUri = Boolean(posterUri) && !isBrandedPosterUri(posterUri);
  const metadata = posterMetadata || snapshotPosterMetadata(null);
  const resolution = describePosterResolution(
    {
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

  const [posterState, setPosterState] = React.useState<PosterLoadState>(
    hasPosterUri ? "probing" : "failed"
  );
  const [displayUri, setDisplayUri] = React.useState("");
  const [clientThumbUri, setClientThumbUri] = React.useState("");
  const [clientThumbState, setClientThumbState] = React.useState<PosterLoadState>("idle");
  const [lastProbe, setLastProbe] = React.useState<Awaited<
    ReturnType<typeof probePosterUrlReachability>
  > | null>(null);

  const canTryClientThumb =
    enableClientThumbnailFallback && isLocalMediaUri(resolvedVideoUrl);
  const canTryVideoFrameFallback =
    enableVideoFrameFallback && Boolean(resolvedVideoUrl);

  useEffect(() => {
    setPosterState(hasPosterUri ? "probing" : "failed");
    setDisplayUri("");
    setClientThumbUri("");
    setClientThumbState("idle");
    setLastProbe(null);
  }, [posterUri, resolvedVideoUrl, hasPosterUri]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!hasPosterUri) {
        logPosterPipelineDiag({
          postId,
          videoUrl: resolvedVideoUrl,
          posterUri,
          posterMetadata: metadata,
          resolution,
          fallbackPath: canTryVideoFrameFallback ? "video-frame-generate" : "gradient",
          extra: { reason: "missing-poster-uri" },
        });
        if (canTryVideoFrameFallback) {
          setPosterState("generating");
        }
        return;
      }

      setPosterState("probing");
      const probe = await probePosterUrlReachability(posterUri);
      if (cancelled) return;
      setLastProbe((prev) => {
        if (
          prev?.url === probe?.url &&
          prev?.httpStatus === probe?.httpStatus &&
          prev?.reachable === probe?.reachable &&
          prev?.reason === probe?.reason
        ) {
          return prev;
        }
        return probe;
      });

      logPosterPipelineDiag({
        postId,
        videoUrl: resolvedVideoUrl,
        posterUri,
        posterMetadata: metadata,
        resolution,
        probe,
        fallbackPath: probe.reachable ? "static-poster" : canTryVideoFrameFallback ? "video-frame-generate" : "gradient",
      });

      if (probe.reachable) {
        setDisplayUri(posterUri);
        setPosterState("loading");
        return;
      }

      logPreviewEvent(previewTrace, postId, resolvedVideoUrl, {
        posterLoad: "probe-failed",
        failedPosterUri: posterUri,
        httpStatus: probe.httpStatus,
        probeReason: probe.reason || null,
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
    posterUri,
    resolvedVideoUrl,
    hasPosterUri,
    postId,
    canTryVideoFrameFallback,
    metadata,
    resolution,
    previewTrace,
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

    void generateVideoPosterFrame({
      postId,
      videoUrl: resolvedVideoUrl,
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
    metadata,
    resolution,
    lastProbe,
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
    metadata,
    resolution,
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
        suppressMissingPosterLog={isBrandedPosterUri(posterUri)}
      />
    );
  }

  return (
    <View style={style}>
      <LinearGradient
        colors={["#4A3D24", "#243B55", "#1B2A44"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
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
