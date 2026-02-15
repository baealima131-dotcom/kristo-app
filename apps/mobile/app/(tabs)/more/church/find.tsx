import React, { useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PAD = 16;
const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.95)";

type ChurchRow = { id: string; name: string; country?: string; city?: string };

const DEMO: ChurchRow[] = [
  { id: "c-demo-1", name: "Victory Church", country: "DR Congo", city: "Goma" },
  { id: "c-demo-2", name: "New Life Church", country: "DR Congo", city: "Bukavu" },
  { id: "c-demo-3", name: "Christ Center", country: "Kenya", city: "Nairobi" },
];

export default function ChurchFindScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return DEMO;
    return DEMO.filter((c) => {
      const id = c.id.toLowerCase();
      const name = c.name.toLowerCase();
      const country = (c.country || "").toLowerCase();
      const city = (c.city || "").toLowerCase();
      return id.includes(t) || name.includes(t) || country.includes(t) || city.includes(t);
    });
  }, [q]);

  function pick(ch: ChurchRow) {
    router.replace({ pathname: "/more/church", params: { joinId: ch.id } } as any);
  }

  return (
    <Pressable style={s.screen} onPress={() => Keyboard.dismiss()} accessible={false}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.88)" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Find a church</Text>
          <Text style={s.sub}>Search by name or Church ID.</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View style={s.edge} />

          <Text style={s.sectionTitle}>Search</Text>

          <View style={s.searchRow}>
            <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.70)" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="e.g. c-demo-1 or Victory Church"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              style={s.input}
            />
            {q.trim() ? (
              <Pressable onPress={() => setQ("")} style={({ pressed }) => [s.clearBtn, pressed && { opacity: 0.8 }]}>
                <Ionicons name="close" size={16} color="rgba(255,255,255,0.85)" />
              </Pressable>
            ) : null}
          </View>

          <Text style={s.hint}>Tap a church to use its ID in Join. {results.length} found.</Text>

          <View style={s.divider} />

          {results.length === 0 ? (
            <View style={s.notice}>
              <Ionicons name="information-circle-outline" size={18} color={GOLD} />
              <Text style={s.noticeText}>No churches found. Try another name, city, country, or paste the Church ID.</Text>
            </View>
          ) : (
            <View style={{ marginTop: 12, gap: 10 }}>
              {results.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => pick(c)}
                  style={({ pressed }) => [s.row, pressed && { transform: [{ scale: 0.99 }] }]}
                >
                  <View style={s.rowIcon}>
                    <Ionicons name="business-outline" size={18} color="rgba(255,255,255,0.85)" />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{c.name}</Text>
                    <Text style={s.rowSub} numberOfLines={1}>
                      {c.id}
                      {c.country ? ` • ${c.country}` : ""}
                      {c.city ? ` • ${c.city}` : ""}
                    </Text>
                  </View>

                  <View style={s.pill}>
                    <Text style={s.pillText}>Use ID</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <View style={s.notice2}>
            <Ionicons name="flash-outline" size={18} color={GOLD} />
            <Text style={s.noticeText}>
              Hii ni demo list. Baadaye tuta-connect na API ya search/list ya churches.
            </Text>
          </View>
        </View>
      </ScrollView>
    </Pressable>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },

  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: PAD, paddingBottom: 10 },
  backBtn: {
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

  searchRow: {
    height: 52, borderRadius: 18, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(0,0,0,0.18)",
  },
  input: { flex: 1, color: "rgba(255,255,255,0.92)", fontWeight: "800" },
  clearBtn: { width: 30, height: 30, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },

  hint: { marginTop: 10, color: "rgba(255,255,255,0.55)" },
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

  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(217,179,95,0.10)", borderWidth: 1, borderColor: "rgba(217,179,95,0.22)" },
  pillText: { color: "rgba(217,179,95,0.95)", fontWeight: "950", fontSize: 11, letterSpacing: 0.4 },

  notice: {
    marginTop: 14, borderRadius: 18, padding: 12, flexDirection: "row", gap: 10,
    borderWidth: 1, borderColor: "rgba(217,179,95,0.18)", backgroundColor: "rgba(217,179,95,0.06)",
  },
  notice2: {
    marginTop: 14, borderRadius: 18, padding: 12, flexDirection: "row", gap: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.03)",
  },
  noticeText: { flex: 1, color: "rgba(255,255,255,0.72)", fontWeight: "700", lineHeight: 18 },
});
