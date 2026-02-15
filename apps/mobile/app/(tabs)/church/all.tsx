import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PAD = 16;
const VIP_BG = "#0B0F17";
const TEXT = "rgba(255,255,255,0.96)";
const CARD_BG = "rgba(255,255,255,0.06)";
const CARD_BORDER = "rgba(217,179,95,0.18)";

export default function ChurchAllPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={s.screen}>
      <View style={[s.top, { paddingTop: Math.max(insets.top, 10), paddingHorizontal: PAD }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.9)" />
          <Text style={s.backText}>Back</Text>
        </Pressable>

        <Text style={s.h1}>Dashboards</Text>
        <Text style={s.h2}>All church pages</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: Math.max(insets.bottom, 16) + 16 }}>
        <DashRow icon="radio-outline" title="Live" sub="Join church live service" onPress={() => {}} />
        <DashRow icon="megaphone-outline" title="Announcements" sub="Church announcements" onPress={() => {}} />
        <DashRow icon="videocam-outline" title="Videos" sub="Latest sermons & shorts" onPress={() => {}} />
        <DashRow
          icon="grid-outline"
          title="Ministries"
          sub="Open ministry dashboards"
          onPress={() => router.push("/(tabs)/church/ministries")}
        />
              <Pressable onPress={() => router.push("/(tabs)/church/ministries")} style={({ pressed }) => [s.row, pressed && { opacity: 0.97 }]}>
          <View style={s.icon}>
            <Ionicons name="grid-outline" size={18} color={TEXT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle} numberOfLines={1}>Ministries</Text>
            <Text style={s.rowSub} numberOfLines={1}>Open ministry dashboards</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.45)" />
        </Pressable>

</ScrollView>
    </View>
  );
}

function DashRow(props: { icon: any; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.97 }]}>
      <View style={s.icon}>
        <Ionicons name={props.icon} size={18} color="rgba(255,255,255,0.92)" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {props.sub}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.45)" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: VIP_BG },
  top: { paddingBottom: 12 },

  backBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    marginBottom: 10,
  },
  backText: { color: "rgba(255,255,255,0.92)", fontWeight: "900" },

  h1: { color: "rgba(255,255,255,0.96)", fontWeight: "900", fontSize: 26, letterSpacing: 0.2 },
  h2: { color: "rgba(255,255,255,0.55)", marginTop: 6, fontWeight: "800" },

  row: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  title: { color: "rgba(255,255,255,0.96)", fontWeight: "900", fontSize: 16 },
  sub: { color: "rgba(255,255,255,0.55)", marginTop: 6, fontWeight: "800" },
  rowTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 0.2,
  },
  rowSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.60)",
    fontWeight: "800",
    fontSize: 14,
  },
});
