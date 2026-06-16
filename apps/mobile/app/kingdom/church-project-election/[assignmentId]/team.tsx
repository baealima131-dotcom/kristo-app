import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getChurchProjectMcRuntimeView,
  subscribeChurchProjectMcSchedule,
  McScheduleItem,
} from "@/src/store/churchProjectMcScheduleStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D9B35F";
const TEXT = "rgba(255,255,255,0.94)";
const SOFT = "rgba(255,255,255,0.68)";
const BLUE = "#6EA8FF";
const EMERALD = "#34D399";

export default function McTeamScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ assignmentId?: string; title?: string }>();
  const assignmentId = String(params.assignmentId || "");
  const assignmentTitle = String(params.title || "Assignment Room");
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeChurchProjectMcSchedule(() => {
      forceRefresh((x) => x + 1);
    });
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
          <Text style={s.topTitle}>MC Team</Text>
          <Text style={s.topSub} numberOfLines={1}>{assignmentTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {runtime.items.map((mc: McScheduleItem, index: number) => {
          const status = index === 0 ? "LIVE" : index === 1 ? "NEXT" : "STANDBY";
          const duration = `${index === 0 ? 6 : index === 1 ? 5 : 4} min`;

          return (
            <View
              key={mc.id}
              style={[
                s.card,
                status === "LIVE" ? s.liveCard : null,
                status === "NEXT" ? s.nextCard : null,
              ]}
            >
              <View style={s.row}>
                <View>
                  <Text style={s.name}>{mc.name}</Text>
                  <Text style={s.role}>{mc.role}</Text>
                </View>

                <View
                  style={[
                    s.pill,
                    status === "LIVE" ? s.livePill : null,
                    status === "NEXT" ? s.nextPill : null,
                  ]}
                >
                  <Text style={s.pillText}>{status}</Text>
                </View>
              </View>

              <Text style={s.meta}>{mc.startTime} - {mc.endTime} • {duration}</Text>
              <Text style={s.task}>{mc.task}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  topBar: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  topText: { flex: 1 },
  topTitle: { color: TEXT, fontSize: 20, fontWeight: "800" },
  topSub: { color: SOFT, marginTop: 2 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 8,
  },
  liveCard: { borderColor: "rgba(52,211,153,0.45)" },
  nextCard: { borderColor: "rgba(110,168,255,0.45)" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { color: TEXT, fontSize: 16, fontWeight: "800" },
  role: { color: SOFT, marginTop: 3 },
  meta: { color: GOLD, fontSize: 12, fontWeight: "700" },
  task: { color: TEXT, lineHeight: 20 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  livePill: { backgroundColor: "rgba(52,211,153,0.18)" },
  nextPill: { backgroundColor: "rgba(110,168,255,0.18)" },
  pillText: { color: TEXT, fontSize: 11, fontWeight: "800" },
});
