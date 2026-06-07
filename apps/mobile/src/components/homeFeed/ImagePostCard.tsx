import React, { isValidElement, memo, useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { HomeFeedPostAccent } from "./homeFeedUtils";

type Props = {
  imageUri: string;
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: HomeFeedPostAccent;
};

function isTestimonyOrAnnouncementAccent(accent?: HomeFeedPostAccent | null) {
  return accent === "testimony" || accent === "announcement";
}

function resolveAccentFromFallback(fallback: React.ReactNode): HomeFeedPostAccent | undefined {
  if (!isValidElement(fallback)) return undefined;
  const accent = (fallback.props as { accent?: HomeFeedPostAccent }).accent;
  return accent === "testimony" || accent === "announcement" || accent === "default"
    ? accent
    : undefined;
}

function ImagePostFallback({
  fallback,
  failed,
}: {
  fallback?: React.ReactNode;
  failed?: boolean;
}) {
  return (
    <View style={styles.fallbackWrap}>
      <LinearGradient
        colors={["#4A3D24", "#243B55", "#1B2A44"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {fallback ? (
        fallback
      ) : failed ? (
        <View style={styles.fallbackContent}>
          <Ionicons name="image-outline" size={42} color="rgba(255,255,255,0.72)" />
          <Text style={styles.fallbackText}>Photo unavailable</Text>
        </View>
      ) : null}
    </View>
  );
}

export const ImagePostCard = memo(function ImagePostCard({
  imageUri,
  fallback = null,
  style,
  accent: accentProp,
}: Props) {
  const uri = String(imageUri || "").trim();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const loadFailed = failedUri !== null && failedUri === uri;
  const accent = accentProp ?? resolveAccentFromFallback(fallback);
  const useChurchRoomContain = isTestimonyOrAnnouncementAccent(accent);
  const imageResizeMode = useChurchRoomContain ? "contain" : "cover";

  useEffect(() => {
    setFailedUri(null);
  }, [uri]);

  useEffect(() => {
    if (!uri) return;
    console.log("KRISTO_IMAGE_POST_LOAD_START", { uri });
  }, [uri]);

  if (!uri || loadFailed) {
    return (
      <View style={[styles.wrap, style]}>
        <ImagePostFallback fallback={fallback || undefined} failed={loadFailed || !uri} />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      <ImagePostFallback />
      <Image
        key={uri}
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={imageResizeMode}
        onLoad={() => {
          console.log("KRISTO_IMAGE_POST_LOAD_SUCCESS", { uri });
        }}
        onError={() => {
          console.log("KRISTO_IMAGE_POST_LOAD_FAILED", { uri });
          setFailedUri(uri);
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  fallbackWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  fallbackContent: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  fallbackText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
});
