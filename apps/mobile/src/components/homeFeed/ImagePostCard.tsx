import React, { memo, useEffect, useState } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

type Props = {
  imageUri: string;
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export const ImagePostCard = memo(function ImagePostCard({
  imageUri,
  fallback = null,
  style,
}: Props) {
  const uri = String(imageUri || "").trim();
  // Scope the failure to the exact URI so a transient error on a previous image
  // (or a relative->absolute URL change after normalization) can never keep a
  // valid image stuck on the black fallback when this memoized card is reused.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const loadFailed = failedUri !== null && failedUri === uri;

  useEffect(() => {
    if (!uri) return;
    console.log("KRISTO_IMAGE_POST_LOAD_START", { uri });
  }, [uri]);

  if (!uri || loadFailed) {
    return fallback ? <View style={[styles.wrap, style]}>{fallback}</View> : null;
  }

  return (
    <View style={[styles.wrap, style]}>
      <Image
        key={uri}
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
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
});
