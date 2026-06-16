import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { HomeLiveScheduleCard } from "@/src/components/HomeLiveScheduleCard";
import { fetchHomeFeedFromApi, getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";
import { resolveChurchName, homeFeedRowChurchId } from "@/src/components/homeFeed/homeFeedUtils";
import { HOME_FEED_BG, HOME_FEED_GOLD, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "@/src/components/homeFeed/theme";
import { feedList, subscribe as subscribeHomeFeed } from "@/src/lib/homeFeedStore";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { autoDeleteExpiredOpenGuestSlots } from "@/src/lib/guestClaimPersistence";
import { enterLiveRoomFromScheduleCard } from "@/src/lib/enterLiveRoomNavigation";
import {
  buildLiveSlotsCatalogFromFeedRows,
  filterLiveSlotsRenderRows,
  resolveLiveSlotsBackendFeedRows,
  summarizeLiveSlotsRenderRows,
} from "@/src/lib/liveSlotsCatalog";
import { onLiveRingRefresh, resolveRingChurchScheduleSnapshot } from "@/src/lib/liveScheduleRing";
import { onSlotClaimChanged } from "@/src/lib/slotClaimEvents";
import {
  filterOutDeletedScheduleRows,
  onScheduleFeedDeleted,
} from "@/src/lib/deletedScheduleRegistry";
import { pollRemoteSlotClaimUpdates } from "@/src/lib/slotClaimApply";
import {
  fetchChurchSlotClaimFeed,
  SLOT_CLAIM_POLL_FALLBACK_MS,
  SLOT_CLAIM_POLL_LIVE_MS,
} from "@/src/lib/slotClaimSync";
import { baseFeedId, scheduleSlotClaimUserId } from "@/src/lib/scheduleSlotUtils";

type TabKey = "my-church" | "other-churches";

const SLOT_CARD_HEIGHT = 520;

export default function LiveSlotsScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{
    focusScheduleFeedId?: string;
    focusSlotId?: string;
    focusSlotNumber?: string;
    churchId?: string;
    source?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const cardHeight = Math.min(SLOT_CARD_HEIGHT, Math.round(windowHeight * 0.62));
  const scrollRef = useRef<ScrollView>(null);
  const focusAppliedRef = useRef(false);
  const catalogRef = useRef<{ myChurch: any[]; otherChurches: any[] }>({
    myChurch: [],
    otherChurches: [],
  });
  const hasLiveWindowRef = useRef(false);

  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const targetChurchId = String(routeParams.churchId || "").trim();

  const [tab, setTab] = useState<TabKey>(() => {
    if (targetChurchId && viewerChurchId && targetChurchId !== viewerChurchId) {
      return "other-churches";
    }
    return "my-church";
  });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [churchBackendRows, setChurchBackendRows] = useState<any[]>([]);
  const [globalBackendRows, setGlobalBackendRows] = useState<any[]>([]);
  const [churchFeedLoaded, setChurchFeedLoaded] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const reloadFeed = useCallback(async () => {
    if (!viewerChurchId) return;
    setLoading(true);
    try {
      const headers = getKristoHeaders({
        userId: viewerUserId,
        role: (session?.role || "Member") as any,
        churchId: viewerChurchId,
      }) as Record<string, string>;

      const churchResult = await fetchChurchSlotClaimFeed(viewerChurchId, {
        clearCaches: false,
        viewerChurchId,
      });
      let churchRows = Array.isArray(churchResult?.rows) ? churchResult.rows : [];

      const autoResult = await autoDeleteExpiredOpenGuestSlots({
        reason: "live-slots-load",
        churchId: viewerChurchId,
        headers,
        backendFeedItems: churchRows,
        homeFeedItems: [...(feedList() as any[])],
        nowMs: Date.now(),
        userId: viewerUserId,
      });

      if (Number(autoResult?.removedCount || 0) > 0) {
        const resync = await fetchChurchSlotClaimFeed(viewerChurchId, {
          clearCaches: true,
          viewerChurchId,
        });
        churchRows = Array.isArray(resync?.rows) ? resync.rows : [];
      }

      churchRows = filterOutDeletedScheduleRows(churchRows);
      setChurchBackendRows(churchRows);
      setChurchFeedLoaded(true);

      await fetchHomeFeedFromApi("live-slots-screen", { force: true, reconcile: true });
      setGlobalBackendRows(filterOutDeletedScheduleRows(getCachedHomeFeedBackendRows()));
      setTick((n) => n + 1);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [session?.role, viewerChurchId, viewerUserId]);

  useFocusEffect(
    useCallback(() => {
      void reloadFeed();

      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const runPoll = async () => {
        if (cancelled) return;

        const churchIds = new Set<string>();
        if (viewerChurchId) churchIds.add(viewerChurchId);
        for (const row of catalogRef.current.myChurch) {
          const cid = homeFeedRowChurchId(row);
          if (cid) churchIds.add(cid);
        }
        for (const row of catalogRef.current.otherChurches) {
          const cid = homeFeedRowChurchId(row);
          if (cid) churchIds.add(cid);
        }

        let changed = false;
        for (const cid of churchIds) {
          const updated = await pollRemoteSlotClaimUpdates(cid, "live-slots-remote-poll");
          if (updated) changed = true;
        }

        if (changed && !cancelled) {
          setTick((n) => n + 1);
          await reloadFeed();
        }

        const pollMs = hasLiveWindowRef.current
          ? SLOT_CLAIM_POLL_LIVE_MS
          : SLOT_CLAIM_POLL_FALLBACK_MS;
        timer = setTimeout(runPoll, pollMs);
      };

      void runPoll();

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [reloadFeed, viewerChurchId])
  );

  useEffect(() => subscribeHomeFeed(() => setTick((n) => n + 1)), []);
  useEffect(
    () =>
      onSlotClaimChanged((payload) => {
        const cid = String(payload.churchId || viewerChurchId).trim();
        if (cid) {
          void pollRemoteSlotClaimUpdates(cid, "live-slots-slot-claim-event").then((changed) => {
            if (changed) setTick((n) => n + 1);
          });
        }
        void reloadFeed();
      }),
    [reloadFeed, viewerChurchId]
  );
  useEffect(
    () =>
      onLiveRingRefresh(() => {
        setChurchBackendRows((rows) => filterOutDeletedScheduleRows(rows));
        setGlobalBackendRows((rows) => filterOutDeletedScheduleRows(rows));
        setTick((n) => n + 1);
        void reloadFeed();
      }),
    [reloadFeed]
  );
  useEffect(
    () =>
      onScheduleFeedDeleted(() => {
        setChurchBackendRows((rows) => filterOutDeletedScheduleRows(rows));
        setGlobalBackendRows((rows) => filterOutDeletedScheduleRows(rows));
        setTick((n) => n + 1);
      }),
    []
  );

  const { catalog, sourceSnapshot, ringCanonical } = useMemo(() => {
    void tick;
    const localRows = feedList() as any[];
    const globalRows = globalBackendRows.length ? globalBackendRows : getCachedHomeFeedBackendRows();
    const resolved = resolveLiveSlotsBackendFeedRows({
      churchBackendRows,
      globalBackendRows: globalRows,
      viewerChurchId,
      viewerUserId,
      localRows,
      churchFeedLoaded,
    });

    console.log("KRISTO_LIVE_SLOTS_BACKEND_SOURCE", {
      backendFeedCount: resolved.snapshot.backendFeedCount,
      backendSlotCount: resolved.snapshot.backendSlotCount,
      localSlotCount: resolved.snapshot.localSlotCount,
      routeSlotCount: resolved.snapshot.routeSlotCount,
      churchBackendRowCount: churchBackendRows.length,
      globalBackendRowCount: globalRows.length,
      sourceUsed: resolved.snapshot.sourceUsed,
    });

    const ringCanonical = resolveRingChurchScheduleSnapshot({
      mergedRows: resolved.rows,
      viewerChurchId,
      nowMs,
    });

    console.log("KRISTO_LIVE_SLOTS_RENDER_SOURCE", {
      tab: "pending",
      sourceUsed: resolved.snapshot.sourceUsed,
      resolvedScheduleRowCount: resolved.rows.length,
      churchBackendRowCount: churchBackendRows.length,
      globalBackendRowCount: globalRows.length,
      localRowCount: localRows.length,
      churchFeedLoaded,
    });

    console.log("KRISTO_LIVE_SLOTS_CANONICAL_SCHEDULE", {
      feedId: ringCanonical.feedId || null,
      slotCount: ringCanonical.slotCount,
      hasSchedule: Boolean(ringCanonical.schedule),
      scheduleId: String(ringCanonical.schedule?.id || ringCanonical.schedule?.sourceScheduleId || ""),
    });

    const nextCatalog = buildLiveSlotsCatalogFromFeedRows(
      resolved.rows,
      viewerChurchId,
      viewerUserId,
      nowMs
    );

    catalogRef.current = nextCatalog;
    hasLiveWindowRef.current = [...nextCatalog.myChurch, ...nextCatalog.otherChurches].some((row) => {
      const slot = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots[0] : null;
      const startMs = Number(slot?.startMs || 0);
      const endMs = Number(slot?.endMs || 0);
      return startMs > 0 && startMs <= nowMs && endMs > nowMs;
    });

    return { catalog: nextCatalog, sourceSnapshot: resolved.snapshot, ringCanonical };
  }, [churchBackendRows, globalBackendRows, churchFeedLoaded, tick, viewerChurchId, viewerUserId, nowMs]);

  const activeRows = filterLiveSlotsRenderRows(
    tab === "my-church" ? catalog.myChurch : catalog.otherChurches
  );

  useEffect(() => {
    for (const row of activeRows) {
      const slot = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots[0] : null;
      const claimedByUserId = scheduleSlotClaimUserId(slot);
      if (!claimedByUserId || claimedByUserId === viewerUserId) continue;

      console.log("KRISTO_LIVE_SLOTS_VIEWER_SEES_CLAIMED", {
        viewerUserId,
        slotId: String(slot?.id || slot?.slotId || row?.id || ""),
        scheduleFeedId: String(row?.parentScheduleId || row?.sourceScheduleId || row?.id || ""),
        claimedByUserId,
        claimedByName: String(slot?.claimedByName || slot?.claimedBy?.name || "").trim(),
        claimedAt: String(slot?.claimedAt || slot?.claimedBy?.claimedAt || "").trim(),
        tab,
        churchId: homeFeedRowChurchId(row),
      });
    }
  }, [activeRows, tab, viewerUserId]);

  const focusScheduleFeedId = String(routeParams.focusScheduleFeedId || "").trim();
  const focusSlotId = String(routeParams.focusSlotId || "").trim();
  const focusSlotNumber = Math.max(0, Number(routeParams.focusSlotNumber || 0));

  const rowMatchesFocus = useCallback(
    (item: any) => {
      if (!focusScheduleFeedId) return false;
      const focusCanon = baseFeedId(focusScheduleFeedId) || focusScheduleFeedId;
      const rowFeedId = baseFeedId(
        String(item?.parentScheduleId || item?.sourceScheduleId || item?.id || "")
      );
      const rowId = String(item?.id || "");
      const feedMatches =
        rowFeedId === focusCanon ||
        rowId.startsWith(`${focusCanon}:slot:`) ||
        rowId.includes(focusCanon);
      if (!feedMatches) return false;

      const slot = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots[0] : null;
      if (focusSlotId) {
        const rowSlotId = String(slot?.id || slot?.slotId || "").trim();
        if (rowSlotId && rowSlotId !== focusSlotId) return false;
      }
      if (focusSlotNumber > 0) {
        const rowSlotNumber = Math.max(1, Number(item?.slotNumber || slot?.slot || 0));
        if (rowSlotNumber !== focusSlotNumber) return false;
      }
      return true;
    },
    [focusScheduleFeedId, focusSlotId, focusSlotNumber]
  );

  useEffect(() => {
    if (!targetChurchId || !viewerChurchId) return;
    setTab(targetChurchId === viewerChurchId ? "my-church" : "other-churches");
  }, [targetChurchId, viewerChurchId]);

  useEffect(() => {
    if (focusAppliedRef.current || !focusScheduleFeedId || loading) return;
    if (!churchFeedLoaded && !catalog.myChurch.length && !catalog.otherChurches.length) return;

    let rows = activeRows;
    let index = rows.findIndex(rowMatchesFocus);

    if (index < 0 && tab === "my-church" && catalog.otherChurches.length) {
      rows = catalog.otherChurches;
      index = rows.findIndex(rowMatchesFocus);
      if (index >= 0) {
        setTab("other-churches");
        return;
      }
    } else if (index < 0 && tab === "other-churches" && catalog.myChurch.length) {
      rows = catalog.myChurch;
      index = rows.findIndex(rowMatchesFocus);
      if (index >= 0) {
        setTab("my-church");
        return;
      }
    }

    if (index < 0) {
      focusAppliedRef.current = true;
      console.log("KRISTO_LIVE_SLOTS_FOCUS_MISS", {
        focusScheduleFeedId,
        focusSlotId: focusSlotId || null,
        focusSlotNumber: focusSlotNumber || null,
        churchId: targetChurchId || null,
        source: String(routeParams.source || ""),
        tab,
      });
      return;
    }

    focusAppliedRef.current = true;
    const cardStride = cardHeight + 22;
    const y = Math.max(0, index * cardStride - 8);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: true });
    });
    console.log("KRISTO_LIVE_SLOTS_FOCUS_APPLIED", {
      focusScheduleFeedId,
      focusSlotId: focusSlotId || null,
      focusSlotNumber: focusSlotNumber || null,
      index,
      tab,
      source: String(routeParams.source || ""),
    });
  }, [
    activeRows,
    churchFeedLoaded,
    catalog.myChurch,
    catalog.otherChurches,
    cardHeight,
    focusScheduleFeedId,
    focusSlotId,
    focusSlotNumber,
    loading,
    rowMatchesFocus,
    routeParams.source,
    tab,
    targetChurchId,
  ]);

  useEffect(() => {
    const renderSummary = summarizeLiveSlotsRenderRows(activeRows);
    console.log("KRISTO_LIVE_SLOTS_RENDER_ROWS", {
      backendFeedCount: sourceSnapshot.backendFeedCount,
      backendSlotCount: sourceSnapshot.backendSlotCount,
      localSlotCount: sourceSnapshot.localSlotCount,
      routeSlotCount: sourceSnapshot.routeSlotCount,
      renderedCardCount: renderSummary.renderedCardCount,
      renderedSlotNumbers: renderSummary.renderedSlotNumbers,
      slotClaimStates: renderSummary.slotClaimStates,
      viewerUserId,
      sourceUsed: sourceSnapshot.sourceUsed,
      tab,
      canonicalFeedId: ringCanonical.feedId || null,
      canonicalSlotCount: ringCanonical.slotCount,
    });
  }, [activeRows, ringCanonical.feedId, ringCanonical.slotCount, sourceSnapshot, tab, viewerUserId]);

  const profileName = String(
    session?.displayName || session?.name || session?.fullName || "You"
  ).trim();
  const profileAvatarUri = String(
    session?.avatarUri || session?.avatarUrl || session?.profileImage || ""
  ).trim();

  const handleEnterLiveRoom = useCallback(
    (item: any) => {
      const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
      const activeSlot = slots[0] || null;

      enterLiveRoomFromScheduleCard({
        router,
        item,
        activeSlot,
        viewerUserId,
        viewerChurchId,
        nowMs,
        source: "live-slots-card",
      });
    },
    [router, viewerUserId, viewerChurchId, nowMs]
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
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingBottom: insets.bottom + 260,
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
              const slotFeedTotal = Math.max(1, Number(item?.parentScheduleSlotCount || 1));
              const slotNumber = Math.min(
                Math.max(1, Number(item?.slotNumber || index + 1)),
                slotFeedTotal
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
                      onOpenLiveRoom={() => handleEnterLiveRoom(item)}
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
  scroll: {
    flex: 1,
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
