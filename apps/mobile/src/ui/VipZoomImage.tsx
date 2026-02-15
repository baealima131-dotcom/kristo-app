import React from "react";
import { Dimensions, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";

type Props = {
  uri: string;
  onTap?: () => void;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Zoom/Pan image that:
// - pinch zoom
// - pan when zoomed
// - double tap toggles zoom
// - single tap can toggle UI (optional)
export function VipZoomImage({ uri, onTap }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const isZoomed = () => scale.value > 1.01;

  const clamp = (v: number, min: number, max: number) => {
    "worklet";
    return Math.max(min, Math.min(max, v));
  };

  const reset = () => {
    "worklet";
    scale.value = withTiming(1, { duration: 180 });
    savedScale.value = 1;
    tx.value = withTiming(0, { duration: 180 });
    ty.value = withTiming(0, { duration: 180 });
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      const next = clamp(savedScale.value * e.scale, 1, 4);
      scale.value = next;
    })
    .onEnd(() => {
      // snap back if almost 1
      if (scale.value < 1.02) reset();
    });

  const pan = Gesture.Pan()
    .onBegin(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    })
    .onUpdate((e) => {
      if (!isZoomed()) return;

      // Limit panning based on zoom (simple clamp)
      const maxX = ((scale.value - 1) * SCREEN_W) / 2;
      const maxY = ((scale.value - 1) * SCREEN_H) / 2;

      tx.value = clamp(savedTx.value + e.translationX, -maxX, maxX);
      ty.value = clamp(savedTy.value + e.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      if (!isZoomed()) reset();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(240)
    .onEnd(() => {
      if (scale.value > 1.01) {
        reset();
      } else {
        scale.value = withTiming(2, { duration: 180 });
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDelay(240)
    .onEnd(() => {
      if (onTap) runOnJS(onTap)();
    });

  // Make sure doubleTap wins
  const taps = Gesture.Exclusive(doubleTap, singleTap);

  const composed = Gesture.Simultaneous(pinch, pan, taps);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.Image
        source={{ uri }}
        style={[styles.img, aStyle]}
        resizeMode="contain"
      />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  img: {
    width: "100%",
    height: "100%",
  },
});
