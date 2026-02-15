import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getBlock, formatRange } from "@/src/lib/serviceFlowDemo";

const PAD = 16;
const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.95)";

export default function BlockDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { blockId } = useLocalSearchParams<{ blockId?: string | string[] }>();

  const id = Array.isArray(blockId) ? blockId[0] : (blockId ?? "");
  const b = useMemo(() => getBlock(String(id)), [id]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.9 }]}>
          <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.9)" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>Service Block</Text>
          <Text style={s.sub}>Details (read-only demo)</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: 28 }}>
        <View style={s.card}>
          <View style={s.edge} />

          {!b ? (
            <View style={s.notice2}>
              <Ionicons name="alert-circle-outline" size={18} color={GOLD} />
              <Text style={s.noticeText}>Block not found: {String(blockId || "")}</Text>
            </View>
          ) : (
            <>
              <Text style={s.sectionTitle}>{b.title}</Text>
              <Text style={s.bodySub}>
                {b.day} • {formatRange(b.start, b.end)}
              </Text>

              <View style={s.divider} />

              <View style={{ marginTop: 12, gap: 10 }}>
                <View style={s.row}>
                  <View style={s.rowIcon}>
                    <Ionicons name="briefcase-outline" size={18} color="rgba(255,255,255,0.85)" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>Kind</Text>
                    <Text style={s.rowSub}>{b.kind}</Text>
                  </View>
                </View>

                <View style={s.row}>
                  <View style={s.rowIcon}>
                    <Ionicons name="people-outline" size={18} color="rgba(255,255,255,0.85)" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>Ministry</Text>
                    <Text style={s.rowSub}>{b.ministryName || "—"}</Text>
                  </View>
                </View>

                <View style={s.row}>
                  <View style={s.rowIcon}>
                    <Ionicons name="person-outline" size={18} color="rgba(255,255,255,0.85)" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>Assigned member</Text>
                    <Text style={s.rowSub}>{b.memberName || "—"}</Text>
                  </View>
                </View>

                <View style={s.row}>
                  <View style={s.rowIcon}>
                    <Ionicons name="document-text-outline" size={18} color="rgba(255,255,255,0.85)" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>Notes</Text>
                    <Text style={s.rowSub}>{b.notes || "—"}</Text>
                  </View>
                </View>

                <View style={s.notice2}>
                  <Ionicons name="flash-outline" size={18} color={GOLD} />
                  <Text style={s.noticeText}>
                    Next: allow Pastor/Admin (and Assistant) to edit assignments + notes, then Notify.
                  </Text>
                </View>
              </View>
            </>
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

  sectionTitle: { color: "rgba(255,255,255,0.92)", fontWeight: "950", fontSize: 18 },
  bodySub: { color: "rgba(255,255,255,0.55)", marginTop: 6, fontWeight: "800" },

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
