import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  CHURCH_APPLICATION_STATUS_COLORS,
  CHURCH_APPLICATION_STATUS_LABELS,
  type ChurchApplicationStatus,
} from "@/src/lib/churchApplicationsApi";

/** System Admin Report Center look (same tokens as report-center/index.tsx). */
export const RC = {
  bg: "#080C14",
  text: "rgba(255,255,255,0.96)",
  muted: "rgba(255,255,255,0.60)",
  faint: "rgba(255,255,255,0.40)",
  gold: "#F4D06F",
  purple: "#A78BFA",
  green: "#6EE7B7",
  red: "#FB7185",
  blue: "#93C5FD",
  line: "rgba(255,255,255,0.12)",
  glass: "rgba(255,255,255,0.055)",
};

export function ReportCenterBackground() {
  return (
    <>
      <LinearGradient
        colors={["#1D143B", "#111321", "#090D16", RC.bg]}
        locations={[0, 0.28, 0.64, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -80,
          right: -90,
          width: 310,
          height: 310,
          borderRadius: 155,
          backgroundColor: "rgba(139,92,246,0.17)",
        }}
      />
    </>
  );
}

export function GlassCard({
  children,
  style,
  borderColor = RC.line,
}: {
  children: React.ReactNode;
  style?: object;
  borderColor?: string;
}) {
  return (
    <View style={[s.glass, { borderColor }, style]}>
      <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.8 }}
        style={StyleSheet.absoluteFillObject}
      />
      {children}
    </View>
  );
}

export function StatusPill({ status, label, small }: { status: ChurchApplicationStatus; label?: string; small?: boolean }) {
  const color = CHURCH_APPLICATION_STATUS_COLORS[status] || RC.gold;
  return (
    <View style={[s.pill, small && s.pillSmall, { backgroundColor: `${color}1F`, borderColor: `${color}66` }]}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={[s.pillText, small && { fontSize: 11 }, { color }]} numberOfLines={1}>
        {label || CHURCH_APPLICATION_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  glass: {
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: RC.glass,
  },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillSmall: { paddingHorizontal: 8, paddingVertical: 3, gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, fontWeight: "900" },
});
