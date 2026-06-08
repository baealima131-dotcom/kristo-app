import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Animated,
  Dimensions,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import ChurchActivityGrid from "@/src/components/ChurchActivityGrid";
import {
  isChurchActivityPost,
  sortActivityPostsNewestFirst,
} from "@/src/lib/churchActivityPosts";

const BG = "#0B0F17";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.66)";
const GOLD = "rgba(217,179,95,0.92)";
const BLUE = "rgba(0,145,255,0.92)";
const CARD = "rgba(255,255,255,0.03)";
const CARD2 = "rgba(255,255,255,0.035)";
const BORDER = "rgba(255,255,255,0.10)";
const BORDER_SOFT = "rgba(255,255,255,0.08)";
const PAD = 16;
const GRID_GAP = 12;
const { width: SCREEN_W } = Dimensions.get("window");
const GRID_CARD_W = Math.floor((SCREEN_W - PAD * 2 - GRID_GAP) / 2);

type Overview = {
  churchId: string;
  viewer: { userId: string; name?: string; role: string };
  stats: { activeMembers: number; ministries: number; ministryMembers: number; unreadNotifications: number };
  generatedAt: string;
};

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={s.statPill}>
      <Text style={t.statValue}>{value}</Text>
      <Text style={t.statLabel}>{label}</Text>
    </View>
  );
}

function GridCard({ label, sub, icon, tint, onPress }: { label: string; sub?: string; icon: any; tint?: string; onPress: () => void }) {
  const accent = tint || GOLD;
  const border = String(accent).replace("0.92", "0.24");
  const bg = String(accent).replace("0.92", "0.07");
  const softText = String(accent).replace("0.92", "0.52");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.gridCard,
        { width: GRID_CARD_W, borderColor: border, backgroundColor: bg },
        pressed ? ({ transform: [{ scale: 0.985 }], opacity: 0.96 } as any) : null,
      ]}
    >
      <View pointerEvents="none" style={[s.gridGlow, { backgroundColor: String(accent).replace("0.92", "0.14") }]} />
      <View style={s.gridTop}>
        <View style={[s.gridIcon, { borderColor: String(accent).replace("0.92", "0.32"), backgroundColor: String(accent).replace("0.92", "0.14") }]}>
          <Ionicons name={icon} size={20} color={accent} />
        </View>
        <View style={s.gridChevron}>
          <Ionicons name="arrow-forward" size={14} color="rgba(255,255,255,0.42)" />
        </View>
      </View>

      <Text style={[t.gridTitle, { color: TEXT }]} numberOfLines={2}>
        {label}
      </Text>
      {sub ? (
        <Text style={[t.gridSub, { color: softText }]} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function MyChurchRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [roomFeedItems, setRoomFeedItems] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const session = getSessionSync() as any;
        const [overviewRes, feedRes] = await Promise.all([
          apiGet("/api/church/overview", { headers: getKristoHeaders() }) as Promise<{ ok: true; data: Overview }>,
          session?.userId
            ? apiGet("/api/church/feed?scope=church", {
                headers: getKristoHeaders({
                  userId: session.userId,
                  role: (session.role || "Member") as any,
                  churchId: session.churchId || "",
                }),
              })
            : Promise.resolve(null as any),
        ]);

        if (!alive) return;
        setOverview((overviewRes as any)?.data ?? null);

        const feedRows = Array.isArray((feedRes as any)?.data) ? (feedRes as any).data : [];
        const churchId = String(session?.churchId || (overviewRes as any)?.data?.churchId || "").trim();
        setRoomFeedItems(
          sortActivityPostsNewestFirst(
            feedRows.filter((item: any) => {
              if (!isChurchActivityPost(item)) return false;
              if (churchId && String(item?.churchId || "") !== churchId) return false;
              return true;
            })
          )
        );
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
  const ministryMembers = useMemo(() => overview?.stats.ministryMembers ?? 0, [overview]);

  const insightItems = useMemo(
    () => [
      {
        key: "verse",
        icon: "book-outline" as const,
        kicker: "Verse of the Day",
        title: "John 3:16",
        body: "God's love for the world — and for your church family.",
        tint: "rgba(217,179,95,0.92)",
      },
      {
        key: "world",
        icon: "globe-outline" as const,
        kicker: "Faith Around the World",
        title: "🇨🇩 Congo • 🇰🇪 Kenya • 🇺🇬 Uganda",
        body: "Prayer and youth movements rising across regions.",
        tint: "rgba(0,145,255,0.92)",
      },
      {
        key: "prayer",
        icon: "heart-outline" as const,
        kicker: "Prayer Focus",
        title: "Families, youth & leaders",
        body: "Cover homes, ministries, and those carrying responsibility this week.",
        tint: "rgba(255,120,120,0.92)",
      },
      {
        key: "momentum",
        icon: "trending-up-outline" as const,
        kicker: "Church Momentum",
        title: `${members} members • ${ministries} ministries`,
        body: "A live snapshot of your church community.",
        tint: "rgba(80,220,180,0.92)",
      },
      {
        key: "pulse",
        icon: "megaphone-outline" as const,
        kicker: "Announcements Pulse",
        title: "Stay connected",
        body: "Share updates, testimonies, and prayer needs each week.",
        tint: "rgba(180,140,255,0.92)",
      },
    ],
    [members, ministries, ministryMembers]
  );

  const [insightIndex, setInsightIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!insightItems.length) return;

    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 7000,
      useNativeDriver: false,
    }).start();

    const id = setInterval(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setInsightIndex((current) => (current + 1) % insightItems.length);
        progressAnim.setValue(0);
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 7000,
          useNativeDriver: false,
        }).start();
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    }, 7000);

    return () => {
      clearInterval(id);
      progressAnim.stopAnimation();
    };
  }, [insightItems, fadeAnim, progressAnim]);

  const activeInsight = insightItems[insightIndex] ?? insightItems[0];

  return (
    <View style={[s.screen, { paddingTop: insets.top + 12 }]}>
      <View style={s.header}>
        <Text style={t.title}>My Church Room</Text>
        <Text style={t.sub}>Announce, pray, counsel, and grow together</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: insets.bottom + 28 }}
      >
        <View style={s.block}>
        <Pressable
          onPress={() => router.push("/church" as any)}
          style={({ pressed }) => [
            s.card,
            s.cardBlue,
            pressed ? ({ transform: [{ scale: 0.992 }], opacity: 0.96 } as ViewStyle) : null,
          ]}
        >
          <View style={s.analyticsTop}>
            <View style={s.analyticsIcon}>
              <Ionicons name="stats-chart" size={18} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={t.analyticsTitle}>Church Insights</Text>
              <Text style={t.analyticsSub}>Verse, prayer focus, and live stats</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
          </View>

          <View style={s.statsVipBox}>
            <View style={s.statsRow}>
            <MiniStat label="Members" value={loading ? "—" : members} />
            <MiniStat label="Ministry Members" value={loading ? "—" : ministryMembers} />
            <MiniStat label="Ministries" value={loading ? "—" : ministries} />
            </View>
          </View>

          <Animated.View style={[s.insightStage,{opacity:fadeAnim}]}>
            <View pointerEvents="none" style={s.insightGlow} />
            <View style={s.insightTopRow}>
              <View
                style={[
                  s.insightIconWrap,
                  {
                    borderColor: String(activeInsight?.tint || GOLD).replace("0.92", "0.28"),
                    backgroundColor: String(activeInsight?.tint || GOLD).replace("0.92", "0.12"),
                  },
                ]}
              >
                <Ionicons name={activeInsight?.icon || "sparkles-outline"} size={16} color={activeInsight?.tint || GOLD} />
              </View>

              <View style={s.insightKickerPill}>
                <Text style={t.insightKicker}>{activeInsight?.kicker}</Text>
              </View>

              <View style={s.insightBibleMini}>
                <Ionicons name="book-outline" size={14} color={GOLD} />
              </View>
            </View>

            <Text style={t.insightTitle}>{activeInsight?.title}</Text>
            <Text style={t.insightBody}>{activeInsight?.body}</Text>

            <View style={s.insightMetaRow}>
              <View style={s.insightMetaPill}>
                <Ionicons name="sparkles-outline" size={13} color={activeInsight?.tint || GOLD} />
                <Text style={t.insightMetaText}>Rotating church focus</Text>
              </View>
            </View>

            <View style={s.insightFooter}>
              {insightItems.map((item, idx) => {
                const isActive = idx === insightIndex;

                return (
                  <View key={item.key} style={s.dotGroup}>
                    {[0, 1, 2, 3, 4].map((mini) => {
                      const start = mini * 0.2;
                      const mid = Math.min(start + 0.08, 1);
                      const end = Math.min(start + 0.18, 1);

                      return (
                        <Animated.View
                          key={`${item.key}-${mini}`}
                          style={[
                            s.dotMini,
                            isActive
                              ? {
                                  backgroundColor: activeInsight?.tint || GOLD,
                                  opacity: progressAnim.interpolate({
                                    inputRange: [0, start, mid, end, 1],
                                    outputRange: [0.22, 0.22, 0.95, 0.34, 0.16],
                                  }),
                                  shadowColor: activeInsight?.tint || GOLD,
                                  shadowOpacity: progressAnim.interpolate({
                                    inputRange: [0, start, mid, end, 1],
                                    outputRange: [0.04, 0.04, 0.22, 0.08, 0.03],
                                  }),
                                  shadowRadius: progressAnim.interpolate({
                                    inputRange: [0, start, mid, end, 1],
                                    outputRange: [1, 1, 4, 2, 1],
                                  }),
                                  transform: [
                                    {
                                      scale: progressAnim.interpolate({
                                        inputRange: [0, start, mid, end, 1],
                                        outputRange: [1, 1, 1.22, 1.02, 1],
                                      }),
                                    },
                                  ],
                                }
                              : s.dotMiniIdle,
                          ]}
                        />
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </Animated.View>

          {err ? <Text style={t.errText}>{err}</Text> : null}
        </Pressable>
        </View>

        <View style={s.sectionBlock}>
          <Text style={t.section}>Quick actions</Text>
          <Text style={t.sectionSub}>Four focused ways to serve your church</Text>

          <View style={s.grid}>
            <GridCard
              label="Announcements"
              sub="Church-wide updates"
              icon="megaphone"
              tint={GOLD}
              onPress={() => router.push("/more/my-church-room/announcements/create" as any)}
            />

            <GridCard
              label="Testimonies"
              sub="Share what God has done"
              icon="sparkles"
              tint={"rgba(0,145,255,0.92)"}
              onPress={() => router.push("/more/my-church-room/announcements/create?kind=testimony" as any)}
            />

            <GridCard
              label="I Need Counsel"
              sub="Private pastoral help"
              icon="chatbubbles"
              tint={"rgba(80,220,180,0.92)"}
              onPress={() => router.push("/more/my-church-room/counsel" as any)}
            />

            <GridCard
              label="Prayer Requests"
              sub="Send prayer needs"
              icon="heart"
              tint={"rgba(255,120,120,0.92)"}
              onPress={() => router.push("/more/my-church-room/prayer-requests" as any)}
            />
          </View>
        </View>

        <View style={s.sectionBlock}>
          <Text style={t.section}>Church Activity</Text>
          <Text style={t.sectionSub}>Announcements, testimonies, prayer, and counsel</Text>
        <ChurchActivityGrid
          items={roomFeedItems}
          emptyTitle="No church activity yet"
          emptyBody="Media posts stay in Media Storage and Home Feed. Member church activity will appear here."
        />
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG } as ViewStyle,

  header: { paddingHorizontal: PAD, paddingBottom: 14 } as ViewStyle,

  block: { marginBottom: 22 } as ViewStyle,
  sectionBlock: { marginBottom: 22 } as ViewStyle,

  // VIP glass card (shared)
  card: {
    borderRadius: 24,
    padding: 16,
    backgroundColor: CARD2,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    shadowColor: GOLD,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  } as ViewStyle,

  cardGold: {
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(255,255,255,0.032)",
  } as ViewStyle,

  cardGoldSoft: {
    borderColor: "rgba(217,179,95,0.16)",
    backgroundColor: "rgba(255,255,255,0.028)",
  } as ViewStyle,

  cardBlue: {
    borderColor: "rgba(0,145,255,0.20)",
    backgroundColor: "rgba(255,255,255,0.030)",
  } as ViewStyle,

  statPill: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: "rgba(7,11,20,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "flex-start",
  } as ViewStyle,

  comingChip: { marginTop: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    alignItems: "center",
    justifyContent: "center",
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
  analyticsTop: { flexDirection: "row", alignItems: "center", gap: 12 } as ViewStyle,
  analyticsIcon: {
    width: 36, height: 36, borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,

  insightStage: {
    marginTop: 14,
    borderRadius: 20,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    overflow: "hidden",
  } as ViewStyle,
  insightTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  } as ViewStyle,
  insightGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 56,
    backgroundColor: "rgba(255,255,255,0.03)",
  } as ViewStyle,
  insightIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  insightKickerPill: {
    flex: 1,
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "flex-start",
    justifyContent: "center",
  } as ViewStyle,
  insightBibleMini: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,
  insightFooter: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  } as ViewStyle,
  insightMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } as ViewStyle,
  insightMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  } as ViewStyle,
  insightDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
  } as ViewStyle,
  insightDotActive: {
    width: 18,
    backgroundColor: "rgba(217,179,95,0.92)",
  } as ViewStyle,
  dotGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 22,
    paddingHorizontal: 0,
  } as ViewStyle,
  dotMini: {
    width: 2.4,
    height: 2.4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.20)",
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.10,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 0 },
  } as ViewStyle,
  dotMiniIdle: {
    backgroundColor: "rgba(255,255,255,0.10)",
    opacity: 0.26,
    shadowColor: "#000",
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
  } as ViewStyle,

  statsVipBox: {
    marginTop: 14,
    borderRadius: 18,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  } as ViewStyle,
  statsRow: {
    flexDirection: "row",
    gap: 8,
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
  heroDivider: { marginTop: 8, height: 1, backgroundColor: "rgba(255,255,255,0.08)" } as ViewStyle,

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
    width: 36, height: 36, borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
    marginTop: 14,
  } as ViewStyle,

  gridCard: {
    borderRadius: 22,
    padding: 16,
    minHeight: 124,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    overflow: "hidden",
  } as ViewStyle,

  gridTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 } as ViewStyle,

  gridGlow: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1,
  } as ViewStyle,

  gridChevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  gridIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  } as ViewStyle,
});

const t = StyleSheet.create({
  feedHint: { marginTop: 2, color: "rgba(255,255,255,0.58)", fontWeight: "800", fontSize: 12, lineHeight: 16 } as any,
  title: { color: "white", fontWeight: "900", fontSize: 28, letterSpacing: 0.3 } as TextStyle,
  sub: { marginTop: 6, color: SUB, fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,

  section: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } as TextStyle,
  sectionSub: { marginTop: 5, color: "rgba(255,255,255,0.52)", fontWeight: "700", fontSize: 12, lineHeight: 17 } as TextStyle,

  gridTitle: { marginTop: 14, color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.15, lineHeight: 20 } as TextStyle,
  gridSub: { marginTop: 4, fontWeight: "700", fontSize: 11, lineHeight: 15 } as TextStyle,

  profileName: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 } as TextStyle,
  profileHandle: { marginTop: 2, color: "rgba(255,255,255,0.6)", fontWeight: "800", fontSize: 12 } as TextStyle,
  profileHint: { marginTop: 10, color: "rgba(255,255,255,0.66)", fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,

  analyticsTitle: { color: "white", fontWeight: "900", fontSize: 17, letterSpacing: 0.2 } as TextStyle,
  analyticsSub: { marginTop: 3, color: "rgba(255,255,255,0.58)", fontWeight: "700", fontSize: 12, lineHeight: 16 } as TextStyle,
  insightKicker: { color: "rgba(255,255,255,0.72)", fontWeight: "900", fontSize: 11, letterSpacing: 0.2 } as TextStyle,
  insightTitle: { marginTop: 10, color: "white", fontWeight: "900", fontSize: 16, lineHeight: 21, letterSpacing: 0.15 } as TextStyle,
  insightBody: { marginTop: 5, color: "rgba(255,255,255,0.68)", fontWeight: "700", fontSize: 12, lineHeight: 18 } as TextStyle,
  insightMetaText: { color: "rgba(255,255,255,0.58)", fontWeight: "700", fontSize: 11 } as TextStyle,
  errText: { marginTop: 10, color: "rgba(255,120,120,0.92)", fontWeight: "800", fontSize: 12 } as TextStyle,

  statValue: { color: "white", fontWeight: "900", fontSize: 20, letterSpacing: 0.2 } as any,
  statLabel: { marginTop: 3, color: "rgba(255,255,255,0.58)", fontWeight: "700", fontSize: 11 } as TextStyle,

  comingText: { color: GOLD, fontWeight: "900", letterSpacing: 0.2, fontSize: 12 } as TextStyle,

  heroTitle: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 } as TextStyle,
  heroHint: { marginTop: 6, color: "rgba(255,255,255,0.66)", fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,
});
