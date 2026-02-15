import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

const BG = "#0B0F17";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.66)";
const GOLD = "rgba(217,179,95,0.92)";
const CARD = "rgba(255,255,255,0.03)";
const BORDER = "rgba(255,255,255,0.10)";
const PAD = 16;

type Overview = {
  churchId: string;
  viewer: { userId: string; name?: string; role: string };
  stats: { activeMembers: number; ministries: number; ministryMembers: number; unreadNotifications: number };
  generatedAt: string;
};

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={s.stat}>
      <Text style={t.statValue}>{value}</Text>
      <Text style={t.statLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ label, icon, onPress }: { label: string; icon: any; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed ? ({ transform: [{ scale: 0.99 }], opacity: 0.96 } as ViewStyle) : null]}>
      <View style={s.rowIcon}>
        <Ionicons name={icon} size={18} color={GOLD} />
      </View>
      <Text style={t.rowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
    </Pressable>
  );
}

export default function MyChurchRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = (await apiGet("/api/church/overview", { headers: getKristoHeaders() })) as { ok: true; data: Overview };
        if (!alive) return;
        setOverview(res.data);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ? String(e.message) : "Failed to load overview");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const members = useMemo(() => overview?.stats.activeMembers ?? 0, [overview]);
  const ministries = useMemo(() => overview?.stats.ministries ?? 0, [overview]);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 10 }]}>
      <View style={s.header}>
        <Text style={t.title}>My Church Room</Text>
        <Text style={t.sub}>Ndani ya church yako: profile, analytics, feed, announcements, ministries.</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 24, gap: 14 }}>
        {/* Church Profile Card */}
        <Pressable onPress={() => router.push("/church" as any)} style={({ pressed }) => [s.profile, pressed ? ({ transform: [{ scale: 0.995 }], opacity: 0.97 } as ViewStyle) : null]}>
          <View style={s.profileTop}>
            <View style={s.avatar}>
              <Ionicons name="business" size={18} color="#0B0F17" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={t.profileName}>Church Profile</Text>
              <Text style={t.profileHandle}>c-demo-1 • Verified</Text>
            </View>

            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
          </View>

          <Text style={t.profileHint}>Badilisha taarifa za church, logo, cover, na setup ya ministries.</Text>
        </Pressable>

        {/* Analytics Card */}
        <Pressable onPress={() => router.push("/church" as any)} style={({ pressed }) => [s.analytics, pressed ? ({ transform: [{ scale: 0.995 }], opacity: 0.97 } as ViewStyle) : null]}>
          <View style={s.analyticsTop}>
            <View style={s.analyticsIcon}>
              <Ionicons name="stats-chart" size={18} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={t.analyticsTitle}>Church Analytics</Text>
              <Text style={t.analyticsSub}>Muhtasari wa church yako kwa haraka.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
          </View>

          <View style={s.statsRow}>
            <MiniStat label="Members" value={loading ? "—" : members} />
            <MiniStat label="Ministries" value={loading ? "—" : ministries} />
          </View>

          {err ? <Text style={t.errText}>{err}</Text> : null}
        </Pressable>

        {/* Feed Card (placeholder) */}
        <View style={s.hero}>
          <View style={s.heroTop}>
            <View style={s.heroBadge}>
              <Ionicons name="play" size={18} color="#0B0F17" />
            </View>
            <Text style={t.heroTitle}>Church Feed</Text>
          </View>

          <Text style={t.heroHint}>Hapa ndipo pastor / leaders wata-post announcements, videos, na updates.</Text>
          <View style={s.heroDivider} />
          <Text style={t.heroFooter}>Coming soon</Text>
        </View>

        {/* Actions (important only) */}
        <ActionRow label="Announcements" icon="megaphone" onPress={() => router.push("/more/my-church-room/announcements" as any)} />

        <ActionRow label="Testimonies" icon="sparkles" onPress={() => router.push("/more/my-church-room/announcements?mode=testimony" as any)} />
        <ActionRow label="I Need Counsel" icon="sparkles" onPress={() => router.push("/more/my-church-room/counsel" as any)} />
        <ActionRow label="Ministries" icon="people" onPress={() => router.push("/church/ministries" as any)} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG } as ViewStyle,

  header: { paddingHorizontal: PAD, paddingBottom: 8 } as ViewStyle,

  profile: {
    borderRadius: 26,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  } as ViewStyle,
  profileTop: { flexDirection: "row", alignItems: "center", gap: 12 } as ViewStyle,
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  } as ViewStyle,

  analytics: {
    borderRadius: 26,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  analyticsTop: { flexDirection: "row", alignItems: "center", gap: 12 } as ViewStyle,
  analyticsIcon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,

  statsRow: { marginTop: 12, flexDirection: "row", gap: 12 } as ViewStyle,
  stat: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  } as ViewStyle,

  hero: {
    borderRadius: 26,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.14)",
  } as ViewStyle,
  heroTop: { flexDirection: "row", alignItems: "center", gap: 10 } as ViewStyle,
  heroBadge: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  } as ViewStyle,
  heroDivider: { marginTop: 12, height: 1, backgroundColor: "rgba(255,255,255,0.08)" } as ViewStyle,

  row: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  } as ViewStyle,
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,
});

const t = StyleSheet.create({
  title: { color: "white", fontWeight: "900", fontSize: 30, letterSpacing: 0.2 } as TextStyle,
  sub: { marginTop: 8, color: SUB, fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,

  profileName: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 } as TextStyle,
  profileHandle: { marginTop: 2, color: "rgba(255,255,255,0.6)", fontWeight: "800", fontSize: 12 } as TextStyle,
  profileHint: { marginTop: 10, color: "rgba(255,255,255,0.66)", fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,

  analyticsTitle: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 } as TextStyle,
  analyticsSub: { marginTop: 2, color: "rgba(255,255,255,0.6)", fontWeight: "800", fontSize: 12 } as TextStyle,
  errText: { marginTop: 10, color: "rgba(255,120,120,0.92)", fontWeight: "800", fontSize: 12 } as TextStyle,

  statValue: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.2 } as TextStyle,
  statLabel: { marginTop: 4, color: "rgba(255,255,255,0.62)", fontWeight: "800", fontSize: 12 } as TextStyle,

  heroTitle: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 } as TextStyle,
  heroHint: { marginTop: 10, color: "rgba(255,255,255,0.66)", fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,
  heroFooter: { marginTop: 10, color: "rgba(217,179,95,0.92)", fontWeight: "900", letterSpacing: 0.3, fontSize: 12 } as TextStyle,

  rowText: { flex: 1, color: TEXT, fontWeight: "900", fontSize: 15, letterSpacing: 0.2 } as TextStyle,
});
