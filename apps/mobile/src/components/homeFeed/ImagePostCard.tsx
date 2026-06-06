import React, { memo, useState } from "react";
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
  const [loadFailed, setLoadFailed] = useState(false);
  const uri = String(imageUri || "").trim();

  if (!uri || loadFailed) {
    return fallback ? <View style={[styles.wrap, style]}>{fallback}</View> : null;
  }

  return (
    <View style={[styles.wrap, style]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
        onError={() => setLoadFailed(true)}
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
