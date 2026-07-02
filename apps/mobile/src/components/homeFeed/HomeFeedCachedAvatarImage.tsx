import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  ensureHomeFeedAvatar,
  registerHomeFeedAvatarDiagnosticContext,
  peekHomeFeedAvatar,
  subscribeHomeFeedAvatarCache,
  writeHomeFeedAvatarSession,
} from "@/src/lib/homeFeedAvatarCache";
import { HOME_FEED_GOLD_SOFT } from "./theme";

type Props = {
  cacheKey: string;
  remoteUris: string[];
  sourceUpdatedAt?: number;
  size: number;
  initial?: string;
  deferLoad?: boolean;
  imageStyle?: object;
  fallbackStyle?: object;
  initialStyle?: object;
  diagnostics?: {
    churchId?: string;
    mediaId?: string;
    rowIndex?: number;
  };
};

function CircularAvatarShimmer({ size }: { size: number }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.34, 0.72] });

  return (
    <View
      style={[
        styles.shimmerShell,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <View style={[StyleSheet.absoluteFillObject, styles.shimmerBase]} />
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity }]}>
        <LinearGradient
          colors={["transparent", "rgba(217,179,95,0.16)", "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </View>
  );
}

export const HomeFeedCachedAvatarImage = memo(function HomeFeedCachedAvatarImage({
  cacheKey,
  remoteUris,
  sourceUpdatedAt,
  size,
  initial = "K",
  deferLoad = false,
  imageStyle,
  fallbackStyle,
  initialStyle,
  diagnostics,
}: Props) {
  const normalizedKey = String(cacheKey || "").trim();
  const candidates = useMemo(
    () =>
      remoteUris
        .map((uri) => String(uri || "").trim())
        .filter((uri, index, list) => uri && list.indexOf(uri) === index),
    [remoteUris]
  );
  const candidatesKey = candidates.join("|");

  const [displayUri, setDisplayUri] = useState(() =>
    normalizedKey && !deferLoad ? peekHomeFeedAvatar(normalizedKey, sourceUpdatedAt) || "" : ""
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">(() => {
    if (displayUri) return "ready";
    if (!normalizedKey || deferLoad) return "loading";
    return "loading";
  });

  useEffect(() => {
    if (normalizedKey) {
      registerHomeFeedAvatarDiagnosticContext(normalizedKey, {
        churchId: diagnostics?.churchId,
        mediaId: diagnostics?.mediaId,
        rowIndex: diagnostics?.rowIndex,
      });
    }
  }, [normalizedKey, diagnostics?.churchId, diagnostics?.mediaId, diagnostics?.rowIndex]);

  useEffect(() => {
    setCandidateIndex(0);

    if (!normalizedKey) {
      setDisplayUri("");
      setPhase(candidates.length ? "loading" : "failed");
      return;
    }

    const cached = peekHomeFeedAvatar(normalizedKey, sourceUpdatedAt);
    if (cached) {
      console.log("KRISTO_HOME_FEED_AVATAR_CACHE_HIT", {
        churchId: diagnostics?.churchId || null,
        mediaId: diagnostics?.mediaId || null,
        avatarUri: "present",
        source: "cache",
        rowIndex: diagnostics?.rowIndex ?? null,
        statusCode: null,
      });
      setDisplayUri(cached);
      setPhase("ready");
      return;
    }

    if (deferLoad) {
      setDisplayUri("");
      setPhase("loading");
      return;
    }

    setDisplayUri("");
    setPhase("loading");
    let cancelled = false;

    const unsubscribe = subscribeHomeFeedAvatarCache(normalizedKey, (uri) => {
      if (cancelled) return;
      if (uri) {
        console.log("KRISTO_HOME_FEED_AVATAR_CACHE_HIT", {
          churchId: diagnostics?.churchId || null,
          mediaId: diagnostics?.mediaId || null,
          avatarUri: "present",
          source: "network",
          rowIndex: diagnostics?.rowIndex ?? null,
          statusCode: null,
        });
        setDisplayUri(uri);
        setPhase("ready");
        return;
      }
      setDisplayUri("");
      setPhase("failed");
    });

    void ensureHomeFeedAvatar({
      cacheKey: normalizedKey,
      remoteUrls: candidates,
      sourceUpdatedAt,
    }).then((uri) => {
      if (cancelled) return;
      if (uri) {
        setDisplayUri(uri);
        setPhase("ready");
        return;
      }
      setDisplayUri("");
      setPhase("failed");
      console.log("KRISTO_HOME_FEED_AVATAR_MISSING", {
        churchId: diagnostics?.churchId || null,
        mediaId: diagnostics?.mediaId || null,
        avatarUri: "missing",
        source: "fallback",
        rowIndex: diagnostics?.rowIndex ?? null,
        statusCode: null,
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [
    normalizedKey,
    deferLoad,
    sourceUpdatedAt,
    candidatesKey,
    diagnostics?.churchId,
    diagnostics?.mediaId,
    diagnostics?.rowIndex,
  ]);

  const activeUri = displayUri || candidates[candidateIndex] || "";
  const initialSize = size >= 54 ? 24 : size >= 42 ? 18 : 16;

  if (phase === "loading") {
    return <CircularAvatarShimmer size={size} />;
  }

  if (phase === "failed" || !activeUri) {
    return (
      <View
        style={[
          styles.avatarImage,
          styles.avatarFallback,
          fallbackStyle,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Text style={[styles.avatarInitial, initialStyle, { fontSize: initialSize }]}>
          {initial || "K"}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: activeUri }}
      style={[
        styles.avatarImage,
        imageStyle,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      onLoad={() => {
        if (normalizedKey && activeUri) {
          writeHomeFeedAvatarSession(normalizedKey, activeUri);
        }
      }}
      onError={() => {
        if (candidateIndex + 1 < candidates.length) {
          setCandidateIndex((index) => index + 1);
          setPhase("loading");
          return;
        }
        setDisplayUri("");
        setPhase("failed");
      }}
    />
  );
});

const styles = StyleSheet.create({
  shimmerShell: {
    overflow: "hidden",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  shimmerBase: {
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  avatarImage: {
    overflow: "hidden",
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  avatarInitial: {
    color: HOME_FEED_GOLD_SOFT,
    fontWeight: "900",
  },
});
