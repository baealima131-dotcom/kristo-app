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
const EMERALD = "#34D399";

export default function McChatScreen() {
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
          <Text style={s.topTitle}>MC Chat</Text>
          <Text style={s.topSub} numberOfLines={1}>{assignmentTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {runtime.items.map((mc: McScheduleItem, mcIndex: number) => (
          <View key={mc.id} style={s.card}>
            <View style={s.row}>
              <Text style={s.name}>{mc.name}</Text>
              <Text style={s.status}>
                {mcIndex === 0 ? "LIVE" : mcIndex === 1 ? "NEXT" : "STANDBY"}
              </Text>
            </View>

            {(mc.chat || []).map((msg: string, index: number) => (
              <View key={`${mc.id}-${index}`} style={s.bubble}>
                <Text style={s.bubbleText}>{msg}</Text>
              </View>
            ))}
          </View>
        ))}
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
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: TEXT, fontSize: 16, fontWeight: "800" },
  status: { color: EMERALD, fontSize: 12, fontWeight: "800" },
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bubbleText: { color: TEXT, lineHeight: 20 },
});
