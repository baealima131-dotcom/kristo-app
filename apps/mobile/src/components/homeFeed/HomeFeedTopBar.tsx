import React, { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedPostKindFilter } from "./homeFeedUtils";
import {
  HOME_FEED_BG,
  HOME_FEED_BORDER,
  HOME_FEED_GOLD,
  HOME_FEED_GOLD_SOFT,
  HOME_FEED_MUTED,
  HOME_FEED_TOP_BAR_BODY_HEIGHT,
} from "./theme";

type Props = {
  activeFilter: HomeFeedPostKindFilter | null;
  onSearchPress: () => void;
  onTestimoniesPress: () => void;
  onAnnouncementsPress: () => void;
};

export const HomeFeedTopBar = memo(function HomeFeedTopBar({
  activeFilter,
  onSearchPress,
  onTestimoniesPress,
  onAnnouncementsPress,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.shell, { paddingTop: insets.top }]}
      pointerEvents="box-none"
    >
      <View style={styles.titleRow}>
        <View style={styles.brandWrap}>
          <View style={styles.logoMark}>
            <Text style={styles.logoLetter}>K</Text>
          </View>
          <Text style={styles.title}>Home</Text>
        </View>

        <Pressable
          onPress={onSearchPress}
          style={({ pressed }) => [styles.searchBtn, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityLabel="Search Home Feed"
        >
          <Ionicons name="search" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        <FilterChip
          label="Testimonies"
          icon="heart-outline"
          active={activeFilter === "testimony"}
          onPress={onTestimoniesPress}
        />
        <FilterChip
          label="Announcements"
          icon="megaphone-outline"
          active={activeFilter === "announcement"}
          onPress={onAnnouncementsPress}
        />
      </ScrollView>
    </View>
  );
});

function FilterChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={14}
        color={active ? HOME_FEED_GOLD : "rgba(255,255,255,0.88)"}
      />
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

/** Total height including safe-area inset — use for feed layout offsets. */
export function measureHomeFeedTopBarHeight(insetTop = 0) {
  return HOME_FEED_TOP_BAR_BODY_HEIGHT + Math.max(insetTop, 0);
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: HOME_FEED_BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HOME_FEED_BORDER,
    zIndex: 20,
  },
  titleRow: {
    height: 44,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  logoLetter: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 14,
    fontWeight: "900",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  searchBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chipRow: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chipActive: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.45)",
  },
  chipLabel: {
    color: HOME_FEED_MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  chipLabelActive: {
    color: HOME_FEED_GOLD,
  },
  pressed: {
    opacity: 0.88,
  },
});
