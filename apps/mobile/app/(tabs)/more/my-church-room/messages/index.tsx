import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0B0F17";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.66)";
const GOLD = "rgba(217,179,95,0.92)";
const CARD = "rgba(255,255,255,0.03)";
const BORDER = "rgba(255,255,255,0.10)";
const PAD = 16;

type MsgGroup = {
  id: string;
  title: string;
  sub: string;
  time: string;
  count: number; // unread
};

const DEMO_GROUPS: MsgGroup[] = [
  { id: "g1", title: "Haizuri", sub: "Voice notes • 5 new", time: "10:22", count: 5 },
  { id: "g2", title: "Choir Team", sub: "Updates • rehearsal", time: "09:10", count: 2 },
  { id: "g3", title: "Pastor Desk", sub: "Private • counsel", time: "Yesterday", count: 1 },
  { id: "g4", title: "Youth Leaders", sub: "Planning • Sunday", time: "Mon", count: 0 },
  { id: "g5", title: "Media Team", sub: "Clips • editing", time: "Sun", count: 0 },
];

function GroupRow({ g, onPress }: { g: MsgGroup; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed ? ({ transform: [{ scale: 0.995 }], opacity: 0.97 } as ViewStyle) : null]}
    >
      <View style={s.avatar}>
        <Text style={t.avatarText} numberOfLines={1}>
          {String(g.title || "?").slice(0, 1).toUpperCase()}
        </Text>
      </View>

      <View style={s.body}>
        <View style={s.rowTop}>
          <Text style={t.title} numberOfLines={1}>
            {g.title}
          </Text>
          <Text style={t.time} numberOfLines={1}>
            {g.time}
          </Text>
        </View>

        <View style={s.rowBottom}>
          <Text style={t.sub} numberOfLines={1}>
            {g.sub}
          </Text>

          {g.count > 0 ? (
            <View style={s.badge}>
              <Text style={t.badgeText} numberOfLines={1}>
                {g.count}
              </Text>
            </View>
          ) : (
            <View style={s.badgeGhost} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");

  const data = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return DEMO_GROUPS;
    return DEMO_GROUPS.filter((g) => (g.title + " " + g.sub).toLowerCase().includes(qq));
  }, [q]);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 10 }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={t.hTitle}>Messages</Text>
          <Text style={t.hSub} numberOfLines={1}>
            Groups • voice • updates
          </Text>
        </View>

        <Pressable onPress={() => {}} style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
          <Ionicons name="create-outline" size={18} color={GOLD} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color="rgba(255,255,255,0.55)" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search groups"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={t.search}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {q.trim().length > 0 ? (
          <Pressable onPress={() => setQ("")} style={s.clearBtn}>
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.65)" />
          </Pressable>
        ) : null}
      </View>

      {/* List */}
      <View style={s.listCard}>
        <FlatList
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          removeClippedSubviews
          initialNumToRender={12}
          windowSize={8}
          data={data}
          keyExtractor={(g) => g.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 6, paddingBottom: insets.bottom + 12 }}
          renderItem={({ item: g }) => (
            <GroupRow
              g={g}
              onPress={() => {
                router.push((`/more/my-church-room/messages/${encodeURIComponent(g.id)}?title=${encodeURIComponent(g.title)}&sub=${encodeURIComponent(g.sub)}`) as any);
              }}
            />
          )}
          ItemSeparatorComponent={() => <View style={s.divider} />}
          ListEmptyComponent={
            <View style={{ padding: 18 }}>
              <Text style={t.emptyTitle}>No results</Text>
              <Text style={t.emptySub}>Try a different keyword.</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingHorizontal: PAD } as ViewStyle,

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
    paddingBottom: 10,
  } as ViewStyle,
  hBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    marginRight: 10,
  } as ViewStyle,

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    borderRadius: 18,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  clearBtn: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  listCard: {
    marginTop: 12,
    flex: 1,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  } as ViewStyle,

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  } as ViewStyle,
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    marginRight: 12,
  } as ViewStyle,
  body: { flex: 1, minWidth: 0 } as ViewStyle,

  rowTop: { flexDirection: "row", alignItems: "center" } as ViewStyle,
  rowBottom: { marginTop: 4, flexDirection: "row", alignItems: "center" } as ViewStyle,

  badge: {
    marginLeft: 10,
    minWidth: 22,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  } as ViewStyle,
  badgeGhost: { width: 22, height: 22, marginLeft: 10 } as ViewStyle,

  divider: { marginLeft: 14 + 44 + 12, height: 1, backgroundColor: "rgba(255,255,255,0.06)" } as ViewStyle,
});

const t = StyleSheet.create({
  hTitle: { color: "white", fontWeight: "900", fontSize: 22, letterSpacing: 0.2 } as TextStyle,
  hSub: { marginTop: 2, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 12 } as TextStyle,

  search: { flex: 1, marginLeft: 10, color: "white", fontWeight: "800", fontSize: 13 } as TextStyle,

  avatarText: { color: "rgba(217,179,95,0.95)", fontWeight: "900", fontSize: 16 } as TextStyle,

  title: { flex: 1, color: "white", fontWeight: "900", fontSize: 14 } as TextStyle,
  time: { marginLeft: 10, color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 11 } as TextStyle,
  sub: { flex: 1, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 12 } as TextStyle,

  badgeText: { color: "rgba(217,179,95,0.98)", fontWeight: "900", fontSize: 12 } as TextStyle,

  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 } as TextStyle,
  emptySub: { marginTop: 6, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 12 } as TextStyle,
});
