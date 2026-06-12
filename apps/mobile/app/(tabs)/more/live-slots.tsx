import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { HomeLiveScheduleCard } from "@/src/components/HomeLiveScheduleCard";
import { fetchHomeFeedFromApi, getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";
import { resolveChurchName } from "@/src/components/homeFeed/homeFeedUtils";
import { HOME_FEED_BG, HOME_FEED_GOLD, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "@/src/components/homeFeed/theme";
import { feedList, subscribe as subscribeHomeFeed } from "@/src/lib/homeFeedStore";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import {
  buildLiveSlotsCatalogFromFeedRows,
  mergeLiveSlotsFeedSources,
} from "@/src/lib/liveSlotsCatalog";
import { onSlotClaimChanged } from "@/src/lib/slotClaimEvents";

type TabKey = "my-church" | "other-churches";

const SLOT_CARD_HEIGHT = 520;

export default function LiveSlotsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const cardHeight = Math.min(SLOT_CARD_HEIGHT, Math.round(windowHeight * 0.62));

  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();

  const [tab, setTab] = useState<TabKey>("my-church");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const reloadFeed = useCallback(async () => {
    setLoading(true);
    try {
      await fetchHomeFeedFromApi("live-slots-screen", { force: true, reconcile: true });
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadFeed();
    }, [reloadFeed])
  );

  useEffect(() => subscribeHomeFeed(() => setTick((n) => n + 1)), []);
  useEffect(() => onSlotClaimChanged(() => setTick((n) => n + 1)), []);

  const catalog = useMemo(() => {
    void tick;
    const merged = mergeLiveSlotsFeedSources(getCachedHomeFeedBackendRows(), feedList() as any[]);
    return buildLiveSlotsCatalogFromFeedRows(merged, viewerChurchId, viewerUserId, nowMs);
  }, [tick, viewerChurchId, viewerUserId, nowMs]);

  const activeRows = tab === "my-church" ? catalog.myChurch : catalog.otherChurches;

  const profileName = String(
    session?.displayName || session?.name || session?.fullName || "You"
  ).trim();
  const profileAvatarUri = String(
    session?.avatarUri || session?.avatarUrl || session?.profileImage || ""
  ).trim();

  const openLiveRoom = useCallback(
    (item: any) => {
      (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
      const feedId = baseFeedId(
        String(item?.parentScheduleId || item?.sourceScheduleId || item?.id || "")
      );
      router.push({
        pathname: "/(tabs)/more/my-church-room/messages/live-room",
        params: {
          id: "church-media-room",
          feedId,
          sourceScheduleId: feedId,
          scheduleType: String(item?.scheduleType || "media-live-slots"),
        },
      } as any);
    },
    [router]
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Live Slots</Text>
          <Text style={styles.subtitle}>Claim and manage media live slots</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TabChip
          label="My Church"
          active={tab === "my-church"}
          onPress={() => setTab("my-church")}
        />
        <TabChip
          label="Other Churches"
          active={tab === "other-churches"}
          onPress={() => setTab("other-churches")}
        />
      </View>

      {loading && !activeRows.length ? (
        <View style={styles.center}>
          <ActivityIndicator color={HOME_FEED_GOLD_SOFT} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingBottom: insets.bottom + 24,
            gap: 14,
          }}
          showsVerticalScrollIndicator={false}
        >
          {!activeRows.length ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="radio-outline" size={30} color="rgba(255,255,255,0.35)" />
              <Text style={styles.emptyTitle}>
                {tab === "my-church" ? "No church slots right now" : "No public slots available"}
              </Text>
              <Text style={styles.emptyBody}>
                {tab === "my-church"
                  ? "When your church publishes live slots, they will appear here."
                  : "Claimable slots from other churches will appear here when available."}
              </Text>
            </View>
          ) : (
            activeRows.map((item, index) => {
              const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
              const activeSlot = slots[0] || null;
              const slotNumber = Math.max(1, Number(item?.slotNumber || 1));
              const slotFeedTotal = Math.max(
                1,
                Number(item?.parentScheduleSlotCount || slots.length || 1)
              );
              const churchLabel = resolveChurchName(item);

              return (
                <View key={String(item?.id || index)} style={styles.cardShell}>
                  {churchLabel ? (
                    <Text style={styles.churchLabel} numberOfLines={1}>
                      {churchLabel}
                    </Text>
                  ) : null}
                  <View style={[styles.card, { height: cardHeight }]}>
                    <LinearGradient
                      colors={["#030508", "#0A0F18", "#050810"]}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <HomeLiveScheduleCard
                      item={item}
                      activeSlot={activeSlot}
                      slotFeedIndex={slotNumber - 1}
                      slotFeedTotal={slotFeedTotal}
                      nowMs={nowMs}
                      isActive
                      fullBleed
                      disableSlotCarousel={item?.homeFeedSlotExpanded === true}
                      profileName={profileName}
                      profileAvatarUri={profileAvatarUri}
                      onOpenLiveRoom={() => openLiveRoom(item)}
                    />
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function TabChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabChip,
        active && styles.tabChipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.tabChipLabel, active && styles.tabChipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: HOME_FEED_BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    color: HOME_FEED_MUTED,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  tabChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  tabChipActive: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.45)",
  },
  tabChipLabel: {
    color: HOME_FEED_MUTED,
    fontSize: 14,
    fontWeight: "700",
  },
  tabChipLabelActive: {
    color: HOME_FEED_GOLD,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardShell: {
    gap: 8,
  },
  churchLabel: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 13,
    fontWeight: "800",
    paddingHorizontal: 4,
  },
  card: {
    width: "100%",
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyWrap: {
    paddingTop: 72,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: HOME_FEED_MUTED,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.88,
  },
});
