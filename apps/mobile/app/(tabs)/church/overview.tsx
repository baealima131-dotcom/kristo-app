import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const VIP_BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.72)";

export default function ChurchOverviewScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.wrap, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
      <Text style={s.h1}>Church Overview</Text>
      <Text style={s.p}>Coming soon: members, ministries, attendance, trends.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: VIP_BG, paddingHorizontal: 16 },
  h1: { color: "white", fontSize: 26, fontWeight: "900", letterSpacing: 0.2 },
  p: { color: MUTED, marginTop: 8, fontSize: 14, lineHeight: 19 },
});
