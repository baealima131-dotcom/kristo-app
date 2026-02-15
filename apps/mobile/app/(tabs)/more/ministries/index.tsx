import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

type MinistryStatus = "Active" | "Paused";
type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
};

const PAD = 16;
const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.95)";

async function apiListMinistries() {
  const res = await apiGet<any>("/api/church/ministries", { headers: getKristoHeaders() });
  if (!res) throw new Error("Network error");
  if (!res.ok) throw new Error(res.error || "Fetch failed");
  return (res.data || []) as Ministry[];
}

export default function MoreMinistriesList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<Ministry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const data = await apiListMinistries();
      setItems(data);
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const hasItems = useMemo(() => items.length > 0, [items]);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.nav}>
        <View style={s.iconPill}>
          <Ionicons name="grid-outline" size={18} color={GOLD} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.navTitle}>Ministries</Text>
          <Text style={s.navSub}>List &amp; open ministries (More tab).</Text>
        </View>

        <Pressable onPress={load} style={({ pressed }) => [s.refreshBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="refresh" size={18} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.muted}>Loading…</Text>
        </View>
      ) : err ? (
        <View style={s.card}>
          <Text style={s.errTitle}>Error</Text>
          <Text style={s.errText}>{err}</Text>
          <Pressable onPress={load} style={({ pressed }) => [s.btnGhost, pressed && { opacity: 0.9 }]}>
            <Text style={s.btnGhostText}>Retry</Text>
          </Pressable>
        </View>
      ) : !hasItems ? (
        <View style={s.card}>
          <Text style={s.emptyTitle}>No ministries yet</Text>
          <Text style={s.muted}>Create mpya kupitia Church tab → Create Ministry.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: 26 }}>
          {items.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => router.push((`/more/ministries/${m.id}` as any))}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.9 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{m.name}</Text>
                {!!m.description && <Text style={s.rowSub} numberOfLines={2}>{m.description}</Text>}
                <View style={s.badges}>
                  <View style={[s.badge, m.status === "Active" ? s.badgeOn : s.badgeOff]}>
                    <Text style={s.badgeText}>{m.status}</Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.65)" />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* LIST_ONLY_MARKER */}
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },
  nav: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: PAD, paddingBottom: 12 },
  iconPill: { width: 34, height: 34, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.12)", borderWidth: 1, borderColor: "rgba(217,179,95,0.25)" },
  navTitle: { color: "white", fontWeight: "900", fontSize: 18 },
  navSub: { marginTop: 2, color: "rgba(255,255,255,0.65)", fontWeight: "700" },
  refreshBtn: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  muted: { color: "rgba(255,255,255,0.65)", fontWeight: "700" },

  card: { margin: PAD, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.04)" },
  errTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  errText: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontWeight: "700" },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 },

  btnGhost: { marginTop: 12, borderRadius: 16, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.03)" },
  btnGhostText: { color: "rgba(255,255,255,0.85)", fontWeight: "900" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.04)" },
  rowTitle: { color: "rgba(255,255,255,0.95)", fontWeight: "900", fontSize: 16 },
  rowSub: { marginTop: 5, color: "rgba(255,255,255,0.65)", fontWeight: "700" },

  badges: { flexDirection: "row", gap: 8, marginTop: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  badgeOn: { backgroundColor: "rgba(217,179,95,0.16)", borderColor: "rgba(217,179,95,0.35)" },
  badgeOff: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" },
  badgeText: { color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 },
});
