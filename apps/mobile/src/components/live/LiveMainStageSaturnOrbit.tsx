import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type ViewStyle } from "react-native";

type LiveMainStageSaturnOrbitProps = {
  size: number;
  ringColor?: string;
  children: React.ReactNode;
  style?: ViewStyle;
};

export default function LiveMainStageSaturnOrbit({
  size,
  ringColor = "rgba(244,208,111,0.62)",
  children,
  style,
}: LiveMainStageSaturnOrbitProps) {
  const spinPrimary = useRef(new Animated.Value(0)).current;
  const spinSecondary = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const primary = Animated.loop(
      Animated.timing(spinPrimary, {
        toValue: 1,
        duration: 14000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const secondary = Animated.loop(
      Animated.timing(spinSecondary, {
        toValue: 1,
        duration: 19000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    primary.start();
    secondary.start();

    return () => {
      primary.stop();
      secondary.stop();
    };
  }, [spinPrimary, spinSecondary]);

  const rotatePrimary = spinPrimary.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const rotateSecondary = spinSecondary.interpolate({
    inputRange: [0, 1],
    outputRange: ["360deg", "0deg"],
  });

  const frameSize = Math.round(size * 1.42);
  const ringSize = Math.round(size * 1.28);

  return (
    <View style={[styles.frame, { width: frameSize, height: frameSize }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.orbitLayer,
          {
            width: ringSize,
            height: ringSize * 0.58,
            borderColor: ringColor,
            transform: [{ rotate: rotatePrimary }, { scaleX: 1.18 }],
          },
        ]}
      >
        <View style={[styles.orbitParticle, styles.orbitParticlePrimary]} />
      </Animated.View>

      <View
        pointerEvents="none"
        style={[styles.orbitTiltWrap, { transform: [{ rotate: "32deg" }] }]}
      >
        <Animated.View
          style={[
            styles.orbitLayer,
            styles.orbitLayerSecondary,
            {
              width: ringSize * 0.92,
              height: ringSize * 0.5,
              borderColor: "rgba(244,208,111,0.34)",
              transform: [{ rotate: rotateSecondary }, { scaleX: 1.05 }],
            },
          ]}
        />
      </View>

      <View
        pointerEvents="none"
        style={[
          styles.avatarHalo,
          {
            width: size + 10,
            height: size + 10,
            borderRadius: (size + 10) / 2,
          },
        ]}
      />

      <View style={styles.avatarCenter}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
  },
  orbitLayer: {
    position: "absolute",
    borderWidth: 1.2,
    borderRadius: 999,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  orbitLayerSecondary: {
    borderWidth: 0.9,
    opacity: 0.88,
  },
  orbitTiltWrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  orbitParticle: {
    position: "absolute",
    top: -2,
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#F4D06F",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.95,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  orbitParticlePrimary: {
    left: "72%",
  },
  avatarHalo: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
    backgroundColor: "rgba(244,208,111,0.04)",
  },
  avatarCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
});
