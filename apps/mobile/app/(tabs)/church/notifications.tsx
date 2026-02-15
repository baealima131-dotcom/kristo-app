import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const VIP_BG = "#0B0F17";
const MUTED = "rgba(255,255,255,0.72)";

export default function ChurchNotifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 18 }]}>
      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.h1}>Notifications</Text>
          <Text style={s.h2}>Church updates & alerts</Text>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.p}>Coming soon: notifications list + read/unread.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: VIP_BG, paddingHorizontal: 16 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  backBtn: {
    width: 40, height: 40, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  h1: { color: "white", fontSize: 28, fontWeight: "900" },
  h2: { color: MUTED, marginTop: 2, fontSize: 14, fontWeight: "700" },
  card: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(16,20,29,0.92)",
  },
  p: { color: MUTED, fontSize: 14, lineHeight: 19 },
});
