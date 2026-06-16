import React, { memo, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedPostKindFilter } from "./homeFeedUtils";
import { KristoBrandLogo } from "./KristoBrandLogo";
import { homeFeedPremiumStyles as premium } from "./homeFeedPremiumStyles";
import { HOME_FEED_BG } from "./theme";

type Props = {
  activeFilter?: HomeFeedPostKindFilter | null;
  onSearchPress: () => void;
  onTestimoniesPress?: () => void;
  onAnnouncementsPress?: () => void;
};

const ICON_SIZE = 18;
const TOP_BAR_ROW_HEIGHT = 52;
const SEARCH_SIZE = 36;
const HEADER_SIDE_SIZE = SEARCH_SIZE;

export const HomeFeedTopBar = memo(function HomeFeedTopBar({ onSearchPress }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.shell, premium.headerSolid, { paddingTop: insets.top }]}
      pointerEvents="box-none"
    >
      <View style={styles.titleRow}>
        <PremiumSearchButton onPress={onSearchPress} />

        <View style={styles.logoCenter} pointerEvents="none">
          <KristoBrandLogo />
        </View>

        <View style={styles.sideSpacer} />
      </View>
    </View>
  );
});

function PremiumSearchButton({ onPress }: { onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressDepth = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 0.91,
        speed: 32,
        bounciness: 2,
        useNativeDriver: true,
      }),
      Animated.timing(pressDepth, {
        toValue: 1,
        duration: 130,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        speed: 26,
        bounciness: 6,
        useNativeDriver: true,
      }),
      Animated.timing(pressDepth, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const glowOpacity = pressDepth.interpolate({
    inputRange: [0, 1],
    outputRange: [0.24, 0.58],
  });

  const iconLift = pressDepth.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -0.5],
  });

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={10}
      accessibilityLabel="Search Home Feed"
      accessibilityRole="button"
      style={styles.searchHitArea}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.searchGlow,
          {
            opacity: glowOpacity,
            transform: [{ scale }],
          },
        ]}
      />
      <Animated.View style={[styles.searchButtonOuter, { transform: [{ scale }] }]}>
        <LinearGradient
          colors={["rgba(232,200,114,0.55)", "rgba(201,169,98,0.22)", "rgba(232,200,114,0.42)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.searchBorderGradient}
        >
          <View style={styles.searchButton}>
            <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
            <LinearGradient
              colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.02)", "rgba(0,0,0,0.32)"]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <Animated.View style={[styles.searchInner, { transform: [{ translateY: iconLift }] }]}>
              <Ionicons name="search" size={ICON_SIZE} color="#F6E5B5" />
            </Animated.View>
          </View>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

export function measureHomeFeedTopBarHeight(insetTop = 0) {
  return TOP_BAR_ROW_HEIGHT + Math.max(insetTop, 0);
}

const styles = StyleSheet.create({
  shell: {
    zIndex: 20,
    backgroundColor: HOME_FEED_BG,
  },
  titleRow: {
    minHeight: TOP_BAR_ROW_HEIGHT,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sideSpacer: {
    width: HEADER_SIDE_SIZE,
    height: HEADER_SIDE_SIZE,
  },
  searchHitArea: {
    width: HEADER_SIDE_SIZE,
    height: HEADER_SIDE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  searchGlow: {
    position: "absolute",
    width: SEARCH_SIZE + 8,
    height: SEARCH_SIZE + 8,
    borderRadius: (SEARCH_SIZE + 8) / 2,
    ...Platform.select({
      ios: {
        shadowColor: "#E8C872",
        shadowOpacity: 0.65,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 3,
      },
    }),
  },
  searchButtonOuter: {
    width: SEARCH_SIZE,
    height: SEARCH_SIZE,
    borderRadius: 11,
    ...Platform.select({
      ios: {
        shadowColor: "#000000",
        shadowOpacity: 0.35,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 2,
      },
    }),
  },
  searchBorderGradient: {
    width: SEARCH_SIZE,
    height: SEARCH_SIZE,
    borderRadius: 11,
    padding: 1,
  },
  searchButton: {
    flex: 1,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "rgba(5,4,9,0.52)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchInner: {
    alignItems: "center",
    justifyContent: "center",
  },
});
