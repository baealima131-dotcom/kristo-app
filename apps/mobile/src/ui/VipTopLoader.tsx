import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

export function VipTopLoader({ show }: { show: boolean }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!show) {
      v.stopAnimation();
      v.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [show, v]);

  if (!show) return null;

  const translateX = v.interpolate({
    inputRange: [0, 1],
    outputRange: [-140, 140],
  });

  return (
    <View style={{ height: 2, overflow: "hidden" }}>
      <Animated.View
        style={{
          height: 2,
          width: "35%",
          borderRadius: 99,
          backgroundColor: "rgba(255,255,255,0.65)",
          transform: [{ translateX }],
        }}
      />
    </View>
  );
}
