import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedPostKindFilter } from "./homeFeedUtils";
import {
  HOME_FEED_BG,
  HOME_FEED_BORDER,
  HOME_FEED_GOLD,
  HOME_FEED_GOLD_SOFT,
} from "./theme";

type Props = {
  activeFilter: HomeFeedPostKindFilter | null;
  onSearchPress: () => void;
  onTestimoniesPress: () => void;
  onAnnouncementsPress: () => void;
};

const ICON_BTN_SIZE = 48;
const ICON_SIZE = 24;
const TOP_BAR_ROW_HEIGHT = 66;

export const HomeFeedTopBar = memo(function HomeFeedTopBar({
  activeFilter,
  onSearchPress,
  onTestimoniesPress,
  onAnnouncementsPress,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.shell, { paddingTop: insets.top }]} pointerEvents="box-none">
      <View style={styles.titleRow}>
        <TopBarIconButton
          icon="search"
          active={false}
          onPress={onSearchPress}
          accessibilityLabel="Search Home Feed"
        />

        <View style={styles.centerBrand} pointerEvents="none">
          <Text style={styles.kristoTitle}>KRISTO</Text>
        </View>

        <TopBarIconButton
          icon="business-outline"
          active={activeFilter === "announcement" || activeFilter === "testimony"}
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
        styles.iconBtn,
        active && styles.iconBtnActive,
        pressed && styles.pressed,
      ]}
      hitSlop={6}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
    >
      <Ionicons name={icon} size={ICON_SIZE} color={active ? HOME_FEED_GOLD : "#FFFFFF"} />
    </Pressable>
  );
}

export function measureHomeFeedTopBarHeight(insetTop = 0) {
  return TOP_BAR_ROW_HEIGHT + Math.max(insetTop, 0);
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: HOME_FEED_BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HOME_FEED_BORDER,
    zIndex: 20,
  },
  titleRow: {
    minHeight: TOP_BAR_ROW_HEIGHT,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  centerBrand: {
    flex: 1,
    marginHorizontal: 10,
    height: 50,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.55)",
  },
  kristoTitle: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: 5,
  },

  iconBtn: {
    width: ICON_BTN_SIZE,
    height: ICON_BTN_SIZE,
    borderRadius: ICON_BTN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.34)",
  },
  iconBtnActive: {
    backgroundColor: "rgba(217,179,95,0.18)",
    borderColor: "rgba(217,179,95,0.62)",
  },
  pressed: {
    opacity: 0.86,
  },
});
