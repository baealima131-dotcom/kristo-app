import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

function ShimmerBlock({
  height,
  width,
  radius = 16,
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: any;
}) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.72] });

  return (
    <View style={[{ height, width: width || "100%", borderRadius: radius, overflow: "hidden" }, style]}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(255,255,255,0.05)" }]} />
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity }]}>
        <LinearGradient
          colors={["transparent", "rgba(217,179,95,0.12)", "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </View>
  );
}

export function ChurchOverviewSkeleton() {
  return (
    <View style={sk.wrap}>
      <View style={sk.profileCard}>
        <ShimmerBlock height={88} width={88} radius={44} style={sk.avatar} />
        <View style={sk.profileTextCol}>
          <ShimmerBlock height={22} width="68%" radius={10} />
          <ShimmerBlock height={14} width="52%" radius={8} style={{ marginTop: 10 }} />
          <ShimmerBlock height={14} width="44%" radius={8} style={{ marginTop: 8 }} />
        </View>
      </View>

      <ShimmerBlock height={120} radius={22} style={{ marginTop: 14 }} />

      <View style={sk.statsGrid}>
        {[0, 1, 2, 3].map((i) => (
          <ShimmerBlock key={i} height={168} radius={22} style={sk.statCard} />
        ))}
      </View>
    </View>
  );
}

export function ProfileHeroSkeleton() {
  return (
    <View style={sk.profileHeroWrap}>
      <View style={sk.metricsRow}>
        {[0, 1, 2].map((i) => (
          <ShimmerBlock key={i} height={74} radius={18} style={sk.metricCard} />
        ))}
      </View>
      <ShimmerBlock height={92} radius={20} style={{ marginTop: 12 }} />
    </View>
  );
}

const sk = StyleSheet.create({
  wrap: {
    paddingTop: 8,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.12)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  avatar: {
    flexShrink: 0,
  },
  profileTextCol: {
    flex: 1,
    minWidth: 0,
  },
  statsGrid: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  statCard: {
    width: "47%",
  },
  profileHeroWrap: {
    marginTop: 8,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
  },
});
