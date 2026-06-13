import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedPostKindFilter } from "./homeFeedUtils";
import { homeFeedPremiumStyles as premium } from "./homeFeedPremiumStyles";
import { HOME_FEED_BG, HOME_FEED_GOLD, HOME_FEED_INACTIVE } from "./theme";

type Props = {
  activeFilter: HomeFeedPostKindFilter | null;
  onSearchPress: () => void;
  onTestimoniesPress: () => void;
  onAnnouncementsPress: () => void;
};

const ICON_SIZE = 21;
const TOP_BAR_ROW_HEIGHT = 52;

export const HomeFeedTopBar = memo(function HomeFeedTopBar({
  activeFilter,
  onSearchPress,
  onAnnouncementsPress,
}: Props) {
  const insets = useSafeAreaInsets();
  const buildingActive =
    activeFilter === "announcement" || activeFilter === "testimony";

  return (
    <View
      style={[styles.shell, premium.headerSolid, { paddingTop: insets.top }]}
      pointerEvents="box-none"
    >
      <View style={styles.titleRow}>
        <TopBarIconButton
          icon="search"
          active={false}
          onPress={onSearchPress}
          accessibilityLabel="Search Home Feed"
        />

        <View style={styles.logoCenter} pointerEvents="none">
          <Text style={premium.logoTitle}>KRISTO</Text>
        </View>

        <TopBarIconButton
          icon="business-outline"
          active={buildingActive}
          onPress={onAnnouncementsPress}
          accessibilityLabel="Church Activity"
        />
      </View>
    </View>
  );
});

function TopBarIconButton({
  icon,
  active,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        premium.headerIconButton,
        active ? premium.headerIconButtonActive : null,
        pressed ? styles.pressed : null,
      ]}
      hitSlop={8}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
    >
      <Ionicons
        name={icon}
        size={ICON_SIZE}
        color={active ? HOME_FEED_GOLD : HOME_FEED_INACTIVE}
      />
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
    backgroundColor: "#2A0F45",
    paddingHorizontal: 14,
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
  pressed: {
    opacity: 0.75,
  },
});
