import React, { memo } from "react";
import { Image, StyleSheet, View } from "react-native";

type Props = {
  imageUri: string;
};

export const ImagePostCard = memo(function ImagePostCard({ imageUri }: Props) {
  return (
    <View style={styles.wrap}>
      <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },

});
