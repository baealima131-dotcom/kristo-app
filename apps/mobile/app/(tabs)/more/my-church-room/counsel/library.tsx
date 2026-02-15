import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { counselList, subscribe, type CounselItem } from "../../../../../src/lib/counselStore";

const GOLD = "rgba(217,179,95,0.95)";
const CARD = "rgba(255,255,255,0.08)";
const BORDER = "rgba(255,255,255,0.10)";

type Tab = "My" | "Saved";

function dateKey(iso?: string) {
  if (!iso) return "Unknown";
  return String(iso).slice(0, 10);
}

function groupByDate(items: Array<CounselItem & { __date?: string }>) {
  const map = new Map<string, Array<CounselItem & { __date?: string }>>();
  for (const it of items) {
    const k = dateKey(it.__date);
    const arr = map.get(k) || [];
    arr.push(it);
    map.set(k, arr);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export default function CounselLibrary() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("My");
  const [items, setItems] = useState(() => counselList());

  useEffect(() => {
    const unsub = subscribe(() => setItems(counselList()));
    return unsub;
  }, []);

  const groups = useMemo(() => {
    const all = items || [];
    const myAll = all.filter((x) => x.mine).map((x) => ({ ...x, __date: x.createdAt }));
    const savedAll = all.filter((x) => x.saved).map((x) => ({ ...x, __date: x.savedAt || x.createdAt }));
    return tab === "My" ? groupByDate(myAll) : groupByDate(savedAll);
  }, [items, tab]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.top}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ Back</Text>
        </Pressable>
        <Text style={s.h1}>LIBRARY</Text>
        <View style={{ width: 70 }} />
      </View>

      <View style={s.tabs}>
        <Pressable onPress={() => setTab("My")} style={[s.tab, tab === "My" && s.tabOn]}>
          <Text style={[s.tabText, tab === "My" && s.tabTextOn]}>My</Text>
        </Pressable>
        <Pressable onPress={() => setTab("Saved")} style={[s.tab, tab === "Saved" && s.tabOn]}>
          <Text style={[s.tabText, tab === "Saved" && s.tabTextOn]}>Saved</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}>
        {groups.length === 0 ? (
          <View style={{ marginTop: 18 }}>
            <Text style={s.empty}>No items yet.</Text>
          </View>
        ) : (
          groups.map(([d, arr]) => (
            <View key={d} style={{ marginBottom: 14 }}>
              <Text style={s.date}>{d}</Text>
              <View style={s.grid}>
                {arr.map((x) => (
                  <View key={x.id} style={s.cell}>
                    <View style={s.tile}>
                      <Text numberOfLines={2} style={s.tileTitle}>
                        {x.title}
                      </Text>
                      <Text numberOfLines={4} style={s.tileSub}>
                        {x.body}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F17" },

  top: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  backBtn: {
    width: 70,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  backText: { color: "rgba(255,255,255,0.85)", fontWeight: "800" },

  h1: { color: GOLD, fontSize: 14, fontWeight: "900", letterSpacing: 2 },

  tabs: { paddingHorizontal: 16, flexDirection: "row", gap: 10, paddingBottom: 10 },
  tab: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  tabOn: { backgroundColor: GOLD, borderColor: "rgba(0,0,0,0)" },
  tabText: { color: "rgba(255,255,255,0.85)", fontWeight: "900" },
  tabTextOn: { color: "#0B0F17" },

  date: { marginTop: 8, marginBottom: 10, color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "900", letterSpacing: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "33.33%", paddingRight: 10, paddingBottom: 10 },

  tile: {
    borderRadius: 18,
    padding: 12,
    minHeight: 110,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  tileTitle: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 12 },
  tileSub: { marginTop: 8, color: "rgba(255,255,255,0.62)", fontSize: 11, lineHeight: 15 },

  empty: { color: "rgba(255,255,255,0.55)" },
});
