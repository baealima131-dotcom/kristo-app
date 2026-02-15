import React from "react";
import { View, Text, FlatList, Pressable, StyleSheet, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

type Item = {
  key: string;
  title: string;
  sub: string;
  iconLib: "ion" | "mci";
  icon: any;
  href: string;
};

const ITEMS: Item[] = [
  { key: "ministries", title: "Ministries", sub: "List • create • members", iconLib: "ion", icon: "people", href: "/more/ministries" },
  { key: "notifications", title: "Notifications", sub: "All alerts", iconLib: "ion", icon: "notifications", href: "/more/notifications" },

  { key: "church", title: "Church", sub: "Create • Join (unlock Church tab)", iconLib: "mci", icon: "church", href: "/more/church" },

  { key: "my_church_room", title: "My Church Room", sub: "Room • posts • members", iconLib: "mci", icon: "home", href: "/more/my-church-room" },

  { key: "bible", title: "Bible", sub: "Daily verses & reading", iconLib: "mci", icon: "book-cross", href: "/more/bible" },
  { key: "testimony", title: "Testimony", sub: "Stories of faith", iconLib: "mci", icon: "account-voice", href: "/more/testimony" },

  { key: "courtship", title: "Courtship", sub: "TLMC Courtship", iconLib: "ion", icon: "heart", href: "/more/courtship" },
  { key: "tlmc", title: "TLMC", sub: "The Last Mission of Christ", iconLib: "ion", icon: "sparkles", href: "/more/tlmc" },
];

const GAP = 14;
const PAD = 16;
const { width } = Dimensions.get("window");
const CARD_W = Math.floor((width - PAD * 2 - GAP) / 2);

export default function MoreScreen() {
  const router = useRouter();

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>More</Text>
        <Text style={s.sub}>Hapa ndipo “folder kubwa” ya Kristo App.</Text>
      </View>

      <FlatList
        data={ITEMS}
        keyExtractor={(x) => x.key}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ padding: PAD, paddingTop: 14, gap: GAP, paddingBottom: 28 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(item.href as any)}
            style={({ pressed }) => [
              s.tileWrap,
              { width: CARD_W },
              pressed && { transform: [{ scale: 0.985 }], opacity: 0.95 },
              item.key === "my_church_room" && { borderWidth: 1.2, borderColor: "rgba(217,179,95,0.35)" },
            ]}
          >
            {/* edge ring */}
            <View style={s.edge} />
            {/* glossy highlight (top sheen) */}
            <View style={s.sheen} />
            {/* soft gold glow */}
            <View style={s.goldGlow} />
            {/* bottom shade */}
            <View style={s.bottomShade} />

            <View style={s.tile}>
              <View style={s.rowTop}>
                <View style={s.iconPill}>
                  {item.iconLib === "ion" ? (
                    <Ionicons name={item.icon} size={18} color="rgba(217,179,95,0.98)" />
                  ) : (
                    <MaterialCommunityIcons name={item.icon} size={18} color="rgba(217,179,95,0.98)" />
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.40)" />
              </View>

              <Text style={s.tileTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={s.tileSub} numberOfLines={2}>{item.sub}</Text>

              <View style={s.divider} />
              <Text style={s.tapHint}>Open</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: "#0B0F17" },

  // ===== header polish (gali ya juu) =====
  header: { paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 6 },
  title: { color: "white", fontWeight: "950", fontSize: 28, letterSpacing: 0.2 },
  sub: { marginTop: 8, color: "rgba(255,255,255,0.66)", fontWeight: "750", fontSize: 13 },

  // ===== VIP tile =====
  tileWrap: { borderRadius: 22, overflow: "hidden" },

  edge: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(217,179,95,0.14)" },

  // white glossy sheen (replaces that brown curve feel)
  sheen: {
    position: "absolute",
    left: -60,
    top: -70,
    width: 280,
    height: 170,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    transform: [{ rotate: "-16deg" }],
  },

  goldGlow: {
    position: "absolute",
    right: -40,
    top: -40,
    width: 170,
    height: 170,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.08)",
  },

  bottomShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -18,
    height: 84,
    backgroundColor: "rgba(0,0,0,0.34)",
  },

  tile: {
    borderRadius: 21,
    margin: 1.2,
    padding: 14,
    minHeight: 142,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },

  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  iconPill: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.34)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },

  tileTitle: { marginTop: 12, color: "white", fontWeight: "950", fontSize: 16, letterSpacing: 0.2 },
  tileSub: { marginTop: 8, color: "rgba(255,255,255,0.70)", fontWeight: "750", fontSize: 12, lineHeight: 16 },

  divider: { marginTop: 12, height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  tapHint: { marginTop: 10, color: "rgba(217,179,95,0.92)", fontWeight: "900", letterSpacing: 0.5, fontSize: 12 },
});
