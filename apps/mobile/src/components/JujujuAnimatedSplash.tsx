import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";

const SPLASH_BG = "#0B0F17";
const SPLASH_IMAGE = require("../../assets/images/jujuju-splash.png") as ImageSourcePropType;

const ZOOM_TO = 1.1;
const ZOOM_MS = 1900;
const FADE_MS = 450;

type Props = {
  onFinished: () => void;
};

export default function JujujuAnimatedSplash({ onFinished }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const finishedRef = useRef(false);

  useEffect(() => {
    const source = Image.resolveAssetSource(SPLASH_IMAGE);
    if (source?.uri) {
      void Image.prefetch(source.uri);
    }
  }, []);

  useEffect(() => {
    if (finishedRef.current) return;

    let cancelled = false;

    const zoom = Animated.timing(scale, {
      toValue: ZOOM_TO,
      duration: ZOOM_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    const fade = Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });

    zoom.start(({ finished }) => {
      if (!finished || cancelled) return;

      fade.start(({ finished: fadeDone }) => {
        if (!fadeDone || cancelled || finishedRef.current) return;
        finishedRef.current = true;
        onFinished();
      });
    });

    return () => {
      cancelled = true;
      zoom.stop();
      fade.stop();
    };
  }, [onFinished, opacity, scale]);

  return (
    <Animated.View pointerEvents="auto" style={[s.root, { opacity }]}>
      <View style={s.backdrop} />
      <Animated.Image source={SPLASH_IMAGE} resizeMode="cover" style={[s.image, { transform: [{ scale }] }]} />
    </Animated.View>
  );
}

export { SPLASH_BG, SPLASH_IMAGE };

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: SPLASH_BG,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BG,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
