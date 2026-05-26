import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getChurchProjectMcRuntimeView,
  subscribeChurchProjectMcSchedule,
} from "@/src/store/churchProjectMcScheduleStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D9B35F";
const TEXT = "rgba(255,255,255,0.94)";
const SOFT = "rgba(255,255,255,0.68)";
const EMERALD = "#34D399";
const BLUE = "#6EA8FF";

export default function McImportantScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ assignmentId?: string; title?: string }>();
  const assignmentId = String(params.assignmentId || "");
  const assignmentTitle = String(params.title || "Assignment Room");
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeChurchProjectMcSchedule(() => forceRefresh((x) => x + 1));
    return () => {
      unsubscribe();
    };
  }, []);

  const runtime = getChurchProjectMcRuntimeView(assignmentId);

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>
        <View style={s.topText}>
          <Text style={s.topTitle}>Important</Text>
          <Text style={s.topSub} numberOfLines={1}>{assignmentTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.card, s.liveCard]}>
          <Text style={s.label}>LIVE NOW</Text>
          <Text style={s.title}>{runtime.current.name}</Text>
          <Text style={s.sub}>{runtime.current.task}</Text>
        </View>

        <View style={[s.card, s.nextCard]}>
          <Text style={s.label}>NEXT</Text>
          <Text style={s.title}>{runtime.next.name}</Text>
          <Text style={s.sub}>{runtime.next.startTime} - {runtime.next.endTime}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.label}>HANDOFF NOTE</Text>
          <Text style={s.sub}>
            MC anayefuata anatakiwa kuingia live kwa muda wake wa schedule. Hapa ndipo viongozi wanaona handoff ya sasa na inayofuata.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  topBar: { flexDirection: "row", alignItems: "center", paddingTop: 58, paddingHorizontal: 16, paddingBottom: 12 },
  iconBtn: { width: 42, height: 42, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER, marginRight: 12 },
  topText: { flex: 1, minWidth: 0 },
  topTitle: { color: TEXT, fontSize: 17, fontWeight: "800" },
  topSub: { color: SOFT, fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 22, padding: 16 },
  liveCard: { borderColor: "rgba(52,211,153,0.24)", backgroundColor: "rgba(52,211,153,0.09)" },
  nextCard: { borderColor: "rgba(110,168,255,0.24)", backgroundColor: "rgba(110,168,255,0.09)" },
  label: { color: GOLD, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  title: { color: TEXT, fontSize: 18, fontWeight: "900", marginTop: 8 },
  sub: { color: SOFT, fontSize: 14, lineHeight: 21, marginTop: 8 },
});
