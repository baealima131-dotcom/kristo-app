import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DAYS, blocksForDay, formatRange, type ServiceDay } from "@/src/lib/serviceFlowDemo";

const PAD = 16;
const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.95)";

export default function ServiceFlowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [day, setDay] = useState<ServiceDay>("Sun");

  const blocks = useMemo(() => blocksForDay(day), [day]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.9 }]}>
          <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.85)" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>Service Flow</Text>
          <Text style={s.sub}>Read-only timeline (demo)</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: 28 }}>
        <View style={s.card}>
          <View style={s.edge} />
          <Text style={s.sectionTitle}>Pick Day</Text>

          <View style={s.dayRow}>
            {DAYS.map((d) => {
              const active = d === day;
              return (
                <Pressable
                  key={d}
                  onPress={() => setDay(d)}
                  style={({ pressed }) => [
                    s.dayPill,
                    active && s.dayPillActive,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Text style={[s.dayText, active && s.dayTextActive]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={s.divider} />

          {blocks.length === 0 ? (
            <View style={s.notice2}>
              <Ionicons name="information-circle-outline" size={18} color={GOLD} />
              <Text style={s.noticeText}>No blocks for this day (demo).</Text>
            </View>
          ) : (
            <View style={{ marginTop: 12, gap: 10 }}>
              {blocks.map((b) => (
                <Pressable key={b.id} onPress={() => router.push({ pathname: "/(tabs)/church/service-flow/[blockId]", params: { blockId: b.id } } as any)} style={({ pressed }) => [s.row, pressed && { opacity: 0.92 }]}
                >
                  <View style={s.rowIcon}>
                    <Ionicons name="time-outline" size={18} color="rgba(255,255,255,0.85)" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{b.title}</Text>
                    <Text style={s.rowSub}>
                      {formatRange(b.start, b.end)}
                      {b.ministryName ? " - " + b.ministryName : ""}
                      {b.memberName ? " - " + b.memberName : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.55)" />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },

  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: PAD, paddingBottom: 10 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 14, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.03)",
  },
  title: { color: "rgba(255,255,255,0.96)", fontWeight: "950", fontSize: 20, letterSpacing: 0.2 },
  sub: { color: "rgba(255,255,255,0.55)", marginTop: 2 },

  card: {
    borderRadius: 22, padding: 16, backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: "rgba(217,179,95,0.55)" },

  sectionTitle: { color: "rgba(255,255,255,0.88)", fontWeight: "950", fontSize: 16, marginBottom: 10 },

  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayPill: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  dayPillActive: { backgroundColor: "rgba(217,179,95,0.12)", borderColor: "rgba(217,179,95,0.22)" },
  dayText: { color: "rgba(255,255,255,0.78)", fontWeight: "900", fontSize: 12 },
  dayTextActive: { color: "rgba(217,179,95,0.95)" },

  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 12 },

  row: {
    borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.03)",
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  rowTitle: { color: "rgba(255,255,255,0.94)", fontWeight: "950" },
  rowSub: { color: "rgba(255,255,255,0.55)", marginTop: 2 },

  notice2: {
    marginTop: 12, borderRadius: 18, padding: 12, flexDirection: "row", gap: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.03)",
  },
  noticeText: { flex: 1, color: "rgba(255,255,255,0.72)", fontWeight: "700", lineHeight: 18 },
});
