import React, { useEffect, useState } from "react";
import { feedList, subscribe, feedToggleLike, feedToggleSave } from "@/src/lib/churchFeedStore";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { VipPostCard, type VipPost } from "@/src/ui/VipPostCard";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PAD = 16;
const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.95)";


function VipChurchFeed() {
  const [items, setItems] = useState(() => feedList());

  useEffect(() => {
    const unsub = subscribe(() => setItems([...feedList()]));
    return () => {
      unsub();
    };
  }, []);

  if (!items.length) return null;

  return (
    <View style={{ marginTop: 14, gap: 12 }}>
      {items.map((p: any) => (
        <VipPostCard
          key={p.id}
          post={{
            id: p.id,
            title: "ANNOUNCEMENT",
            time: "",
            text: p.text,
            images: p.images ?? [],
            likes: p.likes ?? 0,
            comments: p.comments ?? 0,
            likedByMe: !!p.likedByMe,
            savedByMe: !!p.savedByMe,
            badge: "Church",
          } as any}
          onToggleLike={() => feedToggleLike(p.id)}
          onOpenComments={() => {}}
          onToggleSave={() => feedToggleSave(p.id)}
          onShare={() => {}}
        />
      ))}
    </View>
  );
}

export default function PastorHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Church Control Room</Text>
          <Text style={s.sub}>Service Flow • Scheduling • Ministry control</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: 28 }}>
<VipChurchFeed />
        <View style={s.card}>
          <View style={s.edge} />
          <Text style={s.sectionTitle}>Quick Commands</Text>

          <View style={{ marginTop: 12, gap: 10 }}>
            <Pressable
              onPress={() => router.push("/(tabs)/church/service-flow" as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.92 }]}
            >
              <View style={s.rowIcon}>
                <Ionicons name="calendar-outline" size={18} color="rgba(255,255,255,0.85)" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Service Flow</Text>
                <Text style={s.rowSub}>Plan blocks • assign ministries • assign members</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.55)" />
            </Pressable>

            <Pressable
              onPress={() => router.push("/(tabs)/church/ministries" as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.92 }]}
            >
              <View style={s.rowIcon}>
                <Ionicons name="add-circle-outline" size={18} color="rgba(255,255,255,0.85)" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Create ministry</Text>
                <Text style={s.rowSub}>Create stays in Church tab</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.55)" />
            </Pressable>

            <Pressable
              onPress={() => router.push("/more/ministries" as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.92 }]}
            >
              <View style={s.rowIcon}>
                <Ionicons name="list-outline" size={18} color="rgba(255,255,255,0.85)" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Open ministries list</Text>
                <Text style={s.rowSub}>Ministries list stays in More tab</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.55)" />
            </Pressable>
          </View>

          <View style={s.notice}>
            <Ionicons name="flash-outline" size={18} color={GOLD} />
            <Text style={s.noticeText}>
              Next: block detail screen + assign member/ministry + assistant draft/approval flow.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },
  header: { paddingHorizontal: PAD, paddingBottom: 10 },
  title: { color: "rgba(255,255,255,0.96)", fontWeight: "950", fontSize: 20, letterSpacing: 0.2 },
  sub: { color: "rgba(255,255,255,0.55)", marginTop: 4 },

  card: {
    borderRadius: 22, padding: 16, backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: "rgba(217,179,95,0.55)" },

  sectionTitle: { color: "rgba(255,255,255,0.88)", fontWeight: "950", fontSize: 16 },

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

  notice: {
    marginTop: 14, borderRadius: 18, padding: 12, flexDirection: "row", gap: 10,
    borderWidth: 1, borderColor: "rgba(217,179,95,0.18)", backgroundColor: "rgba(217,179,95,0.06)",
  },
  noticeText: { flex: 1, color: "rgba(255,255,255,0.72)", fontWeight: "700", lineHeight: 18 },
});
