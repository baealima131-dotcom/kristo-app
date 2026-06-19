import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageResizeMode,
  ImageStyle,
  StyleSheet,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  ensureMediaVideoPosterFrame,
  resolveVideoDurationMs,
} from "@/lib/mediaVideoPoster";
import {
  getCachedMediaPoster,
  peekCachedMediaPoster,
  rememberMediaPoster,
} from "@/lib/mediaPosterCache";
import { resolveMediaVideoPreviewCandidates } from "@/lib/churchActivityPosts";
import {
  homeFeedMediaUrl,
  isLikelySyntheticPosterPath,
  resolveVideoUri,
} from "@/components/homeFeed/homeFeedUtils";

type PosterPhase = "ready" | "static" | "generating" | "failed";

type Props = {
  item: any;
  style?: ImageStyle;
  resizeMode?: ImageResizeMode;
  postId?: string;
  videoUrl?: string;
};

function resolveInitialPosterState(params: {
  postId: string;
  videoUrl: string;
  staticCandidates: string[];
}) {
  const cached = peekCachedMediaPoster(params.postId, params.videoUrl);
  if (cached) {
    return { phase: "ready" as PosterPhase, displayUri: cached, staticIndex: 0 };
  }
  if (params.staticCandidates.length) {
    return {
      phase: "static" as PosterPhase,
      displayUri: params.staticCandidates[0],
      staticIndex: 0,
    };
  }
  if (params.videoUrl) {
    return { phase: "generating" as PosterPhase, displayUri: "", staticIndex: 0 };
  }
  return { phase: "failed" as PosterPhase, displayUri: "", staticIndex: 0 };
}

function MediaVideoFrameLoading({ style }: { style?: ImageStyle }) {
  return (
    <View style={[style, styles.loadingRoot]}>
      <LinearGradient
        colors={["#0B1018", "#121824", "#0A0E14"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <ActivityIndicator size="small" color="rgba(255,255,255,0.55)" />
    </View>
  );
}

export default function MediaVideoGridPoster({
  item,
  style,
  resizeMode = "cover",
  postId = "",
  videoUrl = "",
}: Props) {
  const staticCandidates = useMemo(() => resolveMediaVideoPreviewCandidates(item), [item]);
  const durationMs = useMemo(() => resolveVideoDurationMs(item), [item]);
  const resolvedPostId = String(postId || item?.id || "").trim();
  const resolvedVideoUrl = useMemo(() => {
    const raw = String(videoUrl || resolveVideoUri(item) || "").trim();
    return homeFeedMediaUrl(raw) || raw;
  }, [videoUrl, item]);
  const cacheIdentity = `${resolvedPostId}|${resolvedVideoUrl}|${staticCandidates.join(",")}`;

  const initial = useMemo(
    () =>
      resolveInitialPosterState({
        postId: resolvedPostId,
        videoUrl: resolvedVideoUrl,
        staticCandidates,
      }),
    [cacheIdentity]
  );

  const [phase, setPhase] = useState<PosterPhase>(initial.phase);
  const [staticIndex, setStaticIndex] = useState(initial.staticIndex);
  const [displayUri, setDisplayUri] = useState(initial.displayUri);
  const savedRef = useRef(false);

  useEffect(() => {
    const next = resolveInitialPosterState({
      postId: resolvedPostId,
      videoUrl: resolvedVideoUrl,
      staticCandidates,
    });
    setPhase(next.phase);
    setStaticIndex(next.staticIndex);
    setDisplayUri(next.displayUri);
    savedRef.current = next.phase === "ready";
  }, [cacheIdentity, resolvedPostId, resolvedVideoUrl, staticCandidates]);

  useEffect(() => {
    if (!resolvedPostId || !resolvedVideoUrl) return;

    let cancelled = false;
    void getCachedMediaPoster(resolvedPostId, resolvedVideoUrl).then((cached) => {
      if (cancelled || !cached) return;
      setDisplayUri(cached);
      setPhase("ready");
      savedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedPostId, resolvedVideoUrl]);

  useEffect(() => {
    if (phase !== "generating" || !resolvedVideoUrl) return;

    let cancelled = false;
    void ensureMediaVideoPosterFrame({
      postId: resolvedPostId,
      videoUrl: resolvedVideoUrl,
      durationMs,
      persistToFeed: true,
    }).then((generatedUri) => {
      if (cancelled) return;
      if (generatedUri) {
        setDisplayUri(generatedUri);
        setPhase("ready");
        savedRef.current = true;
        return;
      }
      setPhase("failed");
    });

    return () => {
      cancelled = true;
    };
  }, [phase, resolvedVideoUrl, resolvedPostId, durationMs]);

  const markPosterReady = async (uri: string, source: "static" | "generated" | "remote") => {
    if (!uri || !resolvedPostId || !resolvedVideoUrl || savedRef.current) return;
    savedRef.current = true;
    const persisted = await rememberMediaPoster({
      postId: resolvedPostId,
      videoUrl: resolvedVideoUrl,
      posterUri: uri,
      source,
      persistFile: source === "generated",
    });
    if (persisted && persisted !== displayUri) {
      setDisplayUri(persisted);
    }
  };

  const tryNextStatic = () => {
    const nextIndex = staticIndex + 1;
    if (nextIndex < staticCandidates.length) {
      setStaticIndex(nextIndex);
      setDisplayUri(staticCandidates[nextIndex]);
      return;
    }
    if (resolvedVideoUrl) {
      setPhase("generating");
      setDisplayUri("");
      return;
    }
    setPhase("failed");
  };

  const handlePosterError = (failedUri: string) => {
    if (phase === "ready") return;

    console.log("KRISTO_MEDIA_PREVIEW_DEBUG", {
      postId: resolvedPostId,
      videoUrl: resolvedVideoUrl,
      failedPreviewUrl: failedUri,
      source: phase === "static" ? "static-candidate" : "generated-frame",
      action: "generate-from-video",
    });

    savedRef.current = false;

    if (phase === "static") {
      if (isLikelySyntheticPosterPath(failedUri) && resolvedVideoUrl) {
        setPhase("generating");
        setDisplayUri("");
        return;
      }
      tryNextStatic();
      return;
    }

    if (resolvedVideoUrl) {
      setPhase("generating");
      setDisplayUri("");
    } else {
      setPhase("failed");
    }
  };

  if ((phase === "generating" || phase === "failed") && !displayUri) {
    return <MediaVideoFrameLoading style={style} />;
  }

  if (!displayUri) {
    return <MediaVideoFrameLoading style={style} />;
  }

  return (
    <View style={style}>
      <LinearGradient
        colors={["#0B1018", "#121824", "#0A0E14"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <Image
        key={displayUri}
        source={{ uri: displayUri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={resizeMode}
        onLoad={() => {
          if (phase === "ready") return;
          setPhase("ready");
          void markPosterReady(
            displayUri,
            phase === "static" ? "static" : "generated"
          );
        }}
        onError={() => {
          handlePosterError(displayUri);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A0E14",
  },
});
