import { useEffect, useMemo, useRef } from "react";
import { Animated, View, type ViewStyle } from "react-native";

/**
 * VipSkeletonLine: animated pulse (cheap shimmer feel) without extra libs.
 */
export function VipSkeletonLine({
  w = "60%",
  h = 12,
  r = 10,
  style,
}: {
  w?: number | string;
  h?: number;
  r?: number;
  style?: ViewStyle;
}) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 850, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);

  const opacity = v.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.95],
  });

  const base = useMemo(
    () =>
      ({
        width: w,
        height: h,
        borderRadius: r,
        backgroundColor: "rgba(255,255,255,0.12)",
      }) as ViewStyle,
    [w, h, r]
  );

  return <Animated.View style={[base, { opacity }, style]} />;
}

export function VipSkeletonCard({ children }: { children: React.ReactNode }) {
  // wrapper helper (optional)
  return <View style={{ gap: 10 }}>{children}</View>;
}
