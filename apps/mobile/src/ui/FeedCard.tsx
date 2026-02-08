import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { VIP } from "@/src/ui/vipPremium";
import { formatCount } from "@/src/lib/formatCount";
import type { FeedItem } from "@/src/store/feedStore";

export function FeedCard({
  item,
  isActive,
  height,
  bottomInset,
}: {
  item: FeedItem;
  isActive: boolean;
  height: number;
  bottomInset: number;
}) {
  // keep bottom text safely above iPhone home indicator
  const padBottom = Math.max(12, bottomInset + 40);

  return (
    <View style={[s.page, { height }]}>
      {/* Premium Frame (slimmer) */}
      <LinearGradient
        colors={["rgba(217,179,95,0.34)", "rgba(255,255,255,0.08)", "rgba(217,179,95,0.18)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.frameOuter}
      >
        <View style={s.frameInner}>
          {/* Background */}
          <View style={s.bg} />

          {/* Top badge */}
          <View style={s.topBadge}>
            <Text style={s.topBadgeTitle}>VIP FEED</Text>
            <Text style={s.topBadgeSub}>{isActive ? "Active" : "Idle"}</Text>
          </View>

          {/* Bottom text card (compact, not huge) */}
          <View style={[s.bottomCard, { paddingBottom: padBottom }]}>
            <View style={s.bottomPill}>
              <Text style={s.pillText}>TEXT</Text>
            </View>

            <Text style={s.title} numberOfLines={1}>
              {item.title}
            </Text>

            {!!item.description && (
              <Text style={s.desc} numberOfLines={2}>
                {item.description}
              </Text>
            )}
          </View>

          {/* Actions (icons stay, counts only) */}
          <View style={[s.actions, { bottom: bottomInset + 40 }]}>

            <Action icon="❤️" count={item.likeCount} />
            <Action icon="💬" count={item.commentCount} />
            <Action icon="↗️" count={item.shareCount} />
            <Action icon="🔖" count={item.saveCount} />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

function Action({ icon, count }: { icon: string; count: number }) {
  return (
    <View style={s.actionStack}>
      <View style={s.actionRing}>
        <Pressable style={s.actionBtn}>
          <Text style={s.actionText}>{icon}</Text>
        </Pressable>
      </View>
      <Text style={s.countText}>{formatCount(count)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { width: "100%", backgroundColor: VIP.colors.bg },

  // ✅ shrink the whole frame footprint
  frameOuter: {
    flex: 1,
    marginHorizontal: 0,
    marginVertical: 0,
    borderRadius: 12,
    padding: 0.5,
  },
  frameInner: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 0.25,
    borderColor: "rgba(255,255,255,0.07)",
  },

  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: VIP.colors.bg },

  topBadge: {
    position: "absolute",
    top: 10, // slightly tighter
    right: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.40)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  topBadgeTitle: { color: VIP.colors.gold2, fontWeight: "900", letterSpacing: 0.4 },
  topBadgeSub: { marginTop: 2, color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "700" },

  // ✅ reduce bottom card size
  bottomCard: {
    position: "absolute",
    left: 12, // was 14
    right: 14, // actions ziko juu sasa
    bottom: 0,
    paddingTop: 10, // was 14
    paddingHorizontal: 12, // was 14
    backgroundColor: "rgba(0,0,0,0.30)",
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  bottomPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
    marginBottom: 8, // was 10
  },
  pillText: { color: VIP.colors.gold2, fontWeight: "900", letterSpacing: 0.6 },

  title: { color: VIP.colors.text, fontSize: 18, fontWeight: "950", marginBottom: 6 }, // was 20
  desc: { color: VIP.colors.mut, fontSize: 13, lineHeight: 18, fontWeight: "650" }, // was 14/19

  actions: {
    position: "absolute",
    right: 10,
    bottom: 0,
    gap: 8,
    alignItems: "center",
  },

  actionStack: { alignItems: "center", gap: 4 },

  // ✅ keep your icon look, but slightly smaller footprint
  actionRing: {
    width: 44,
    height: 44,
    borderRadius: 16,
    padding: 1.2,
    backgroundColor: "rgba(217,179,95,0.20)",
  },
  actionBtn: {
    flex: 1,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.40)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  actionText: { fontSize: 20, color: "white", fontWeight: "900" },

  countText: { color: "rgba(255,255,255,0.82)", fontSize: 12, fontWeight: "900", letterSpacing: 0.25 },
});
