import React, { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Image, Pressable, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { feedList, subscribe, type FeedItem } from "@/src/lib/churchFeedStore";

const S = { pad: 16 };

const C = {
  bg: "#0B0F17",
  glass: "rgba(255,255,255,0.06)",
  glass2: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.14)",
  gold: "rgba(217,179,95,0.95)",
  text: {
    primary: "rgba(255,255,255,0.96)",
    secondary: "rgba(255,255,255,0.72)",
    muted: "rgba(255,255,255,0.52)",
  },
};

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "—";
  }
}

export default function ChurchTabFeed() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribe(() => setTick((t) => t + 1));
  }, []);

  const data = useMemo(() => feedList(), [tick]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Church", headerShown: false }} />

      <View style={styles.wrap}>
        <View style={styles.hero}>
          <Text style={styles.hTitle}>CHURCH</Text>
          <Text style={styles.hSub}>Feed ya kanisa • Announcements zitaonekana hapa</Text>
        </View>

        <FlatList
          data={data}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Hakuna post bado. Tuma Announcement kwanza.</Text>
            </View>
          }
          renderItem={({ item }) => <FeedCard item={item} />}
        />
      </View>
    </SafeAreaView>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.badge}>{item.kind === "announcement" ? "ANN" : "POST"}</Text>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title || "UPDATE"}
        </Text>
        <Text style={styles.time}>{fmtTime(item.createdAt)}</Text>
      </View>

      {item.mediaUri ? (
        <View style={styles.mediaWrap}>
          <Image source={{ uri: item.mediaUri }} style={styles.media} resizeMode="cover" />
        </View>
      ) : null}

      <Text style={styles.body}>{item.body}</Text>

      <View style={styles.metaRow}>
        <View style={styles.metaPill}>
          <Text style={styles.metaPillText}>{item.actorLabel || "ADMIN"}</Text>
        </View>
        <View style={styles.metaPill}>
          <Text style={styles.metaPillText}>{item.churchLabel || "TLMC"}</Text>
        </View>
        <Pressable style={styles.ghostBtn}>
          <Text style={styles.ghostBtnText}>Open</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { flex: 1, padding: S.pad },

  hero: { paddingVertical: 8, paddingHorizontal: 2, marginBottom: 10 },
  hTitle: { color: C.gold, letterSpacing: 6, fontWeight: "900", fontSize: 16 },
  hSub: { marginTop: 6, color: C.text.secondary, fontWeight: "800" },

  empty: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.glass2,
    padding: 16,
  },
  emptyText: { color: C.text.muted, fontWeight: "800" },

  card: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.glass2,
    padding: 14,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: {
    color: C.gold,
    fontWeight: "900",
    letterSpacing: 2,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.12)",
    textAlignVertical: "center",
  },
  cardTitle: { flex: 1, color: C.text.primary, fontWeight: "900", letterSpacing: 2 },
  time: { color: C.text.secondary, fontWeight: "800" },

  mediaWrap: {
    marginTop: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    backgroundColor: C.glass,
  },
  media: { width: "100%", height: 280 },

  body: { marginTop: 12, color: C.text.primary, fontWeight: "900", fontSize: 18, lineHeight: 26 },

  metaRow: { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  metaPill: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.glass,
    alignItems: "center",
    justifyContent: "center",
  },
  metaPillText: { color: C.text.secondary, fontWeight: "900", letterSpacing: 2, fontSize: 12 },

  ghostBtn: {
    marginLeft: "auto",
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnText: { color: C.text.secondary, fontWeight: "900" },
});
