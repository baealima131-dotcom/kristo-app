import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { ChurchPremiumSubscriptionModal, isMinistryCreationBlocked } from "@/src/components/ChurchPremiumSubscriptionModal";
import { fetchChurchSubscriptionActive } from "@/src/lib/churchSubscription";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";
import {
  getMinistriesCache,
  isScreenCacheFresh,
  peekMinistriesCache,
  saveMinistriesCache,
} from "@/src/lib/screenDataCache";
import { refreshMinistriesBundleIfNeeded, seedMinistriesRefreshFromCache } from "@/src/lib/churchResourceRefresh";
import {
  CHURCH_TAB_REFRESH_MS,
  logChurchFeatureBackgroundRefresh,
  logChurchFeatureFirstPaint,
  markChurchFeatureRefreshDone,
  shouldSkipChurchFeatureRefresh,
} from "@/src/lib/churchTabPreload";
import {
  hasScreenFirstPainted,
  markScreenBackgroundRefresh,
  markScreenFirstPainted,
  shouldBlockVisibleLoading,
  shouldSkipFocusRefresh,
} from "@/src/lib/screenOpenState";

const CHURCH_MINISTRIES_SCREEN = "ChurchMinistries";

type MinistryStatus = "Active" | "Paused";
type Ministry = {
  mediaAccess?: boolean;
  memberCount?: number;
  membersCount?: number;
  leaderCount?: number;
  leadersCount?: number;
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
};

const PAD = 16;
const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.95)";

function ministriesSignature(rows: Ministry[]) {
  return rows
    .map(
      (m) =>
        `${m.id}|${m.name}|${m.status}|${Number(m.mediaAccess)}|${m.leaderCount ?? 0}|${m.memberCount ?? 0}`
    )
    .sort()
    .join("\n");
}

export default function MoreMinistriesList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const churchId = String(session?.churchId || (session as any)?.activeChurchId || "").trim();
  const userId = String(session?.userId || "").trim();
  const ministriesCachePeek = useMemo(
    () => (churchId && userId ? peekMinistriesCache(churchId, userId) : null),
    [churchId, userId]
  );

  const hasCachedSnapshot = Boolean(ministriesCachePeek);
  const [items, setItems] = useState<Ministry[]>(
    (ministriesCachePeek?.items as Ministry[]) || []
  );
  const [loading, setLoading] = useState(!hasCachedSnapshot);
  const [hasLoaded, setHasLoaded] = useState(hasCachedSnapshot);
  const [err, setErr] = useState<string | null>(null);
  const itemsSigRef = useRef(
    ministriesCachePeek?.items?.length
      ? ministriesSignature((ministriesCachePeek.items || []) as Ministry[])
      : ""
  );
  const cacheFreshRef = useRef(
    Boolean(
      ministriesCachePeek &&
        isScreenCacheFresh(ministriesCachePeek.updatedAt, CHURCH_TAB_REFRESH_MS)
    )
  );
  const firstPaintLoggedRef = useRef(false);
  const cacheHydratedRef = useRef(hasCachedSnapshot);
  const emptyStateLoggedRef = useRef(false);

  const role = String(session?.role || (session as any)?.churchRole || "Member");
  const canCreateMinistry =
    /\bPastor\b/i.test(role) ||
    role === "Church_Admin" ||
    role === "Leader" ||
    role === "Ministry_Leader" ||
    role === "System_Admin";
  const canManageSubscriptions =
    /\bPastor\b/i.test(role) || role === "Church_Admin" || role === "System_Admin";
  const [churchSubscriptionActive, setChurchSubscriptionActive] = useState<boolean | null>(
    isSubscriptionBypassEnabled() ? true : null
  );
  const [premiumModalOpen, setPremiumModalOpen] = useState(false);
  const createMinistryLocked = canCreateMinistry && isMinistryCreationBlocked(churchSubscriptionActive);

  const applyMinistriesCache = useCallback((cachedItems: Ministry[]) => {
    const sig = ministriesSignature(cachedItems);
    if (sig !== itemsSigRef.current) {
      itemsSigRef.current = sig;
      setItems(cachedItems);
    }
    cacheHydratedRef.current = true;
    setHasLoaded(true);
    setLoading(false);
  }, []);

  if (!cacheHydratedRef.current && ministriesCachePeek) {
    cacheHydratedRef.current = true;
    seedMinistriesRefreshFromCache({
      churchId: ministriesCachePeek.churchId,
      userId: ministriesCachePeek.userId,
      items: ministriesCachePeek.items,
      updatedAt: ministriesCachePeek.updatedAt,
    });
    markScreenBackgroundRefresh(CHURCH_MINISTRIES_SCREEN);
  }

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = !!opts?.force;
      if (!churchId || !userId) return;

      if (
        !force &&
        (shouldSkipChurchFeatureRefresh(CHURCH_MINISTRIES_SCREEN, churchId, userId) ||
          shouldSkipFocusRefresh(CHURCH_MINISTRIES_SCREEN, CHURCH_TAB_REFRESH_MS))
      ) {
        return;
      }

      const hasVisible = items.length > 0;
      if (!force && shouldBlockVisibleLoading(CHURCH_MINISTRIES_SCREEN, hasVisible)) {
        // keep cards visible
      } else if (!hasVisible) {
        setLoading(true);
      }

      setErr(null);
      logChurchFeatureBackgroundRefresh(CHURCH_MINISTRIES_SCREEN, force ? "manual" : "silent-refresh");

      try {
        const bundle = await refreshMinistriesBundleIfNeeded({
          churchId,
          userId,
          headers: getKristoHeaders() as Record<string, string>,
          isChurchAuthority: true,
          force,
          cacheFresh: !force && cacheFreshRef.current,
          source: force ? "church-ministries-manual" : "church-ministries-screen",
        });

        if (bundle.skipped && itemsSigRef.current) {
          setHasLoaded(true);
          return;
        }

        const data = Array.isArray(bundle.ministries) ? (bundle.ministries as Ministry[]) : [];
        const withCounts = data.map((m) => {
          const rows = bundle.membersByMinistryId[String(m.id || "")] || [];
          const leaders = rows.filter((x: any) =>
            String(x?.role || x?.ministryRole || "").toLowerCase().includes("leader")
          ).length;
          return { ...m, leaderCount: leaders, memberCount: rows.length };
        });

        const sig = ministriesSignature(withCounts);
        if (sig !== itemsSigRef.current) {
          itemsSigRef.current = sig;
          setItems(withCounts);
        }

        cacheFreshRef.current = true;
        await saveMinistriesCache({
          churchId,
          userId,
          items: withCounts as Record<string, unknown>[],
          churchLiveControlStatus: bundle.liveControlStatus,
          updatedAt: Date.now(),
        });
        seedMinistriesRefreshFromCache({
          churchId,
          userId,
          items: withCounts,
          churchLiveControlStatus: bundle.liveControlStatus,
          updatedAt: Date.now(),
          membersByMinistryId: bundle.membersByMinistryId,
        });
        markScreenBackgroundRefresh(CHURCH_MINISTRIES_SCREEN);
        markChurchFeatureRefreshDone(CHURCH_MINISTRIES_SCREEN, churchId, userId);
        setHasLoaded(true);
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? "Error");
        if (msg.toLowerCase().includes("no active church membership")) {
          if (!items.length) setItems([]);
          setErr(null);
        } else {
          setErr(msg);
        }
      } finally {
        setLoading(false);
        setHasLoaded(true);
      }
    },
    [churchId, userId, items.length]
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        if (churchId && userId && !cacheHydratedRef.current) {
          const disk = await getMinistriesCache(churchId, userId);
          if (disk && alive) {
            applyMinistriesCache((disk.items || []) as Ministry[]);
            cacheFreshRef.current = isScreenCacheFresh(disk.updatedAt, CHURCH_TAB_REFRESH_MS);
            seedMinistriesRefreshFromCache({
              churchId: disk.churchId,
              userId: disk.userId,
              items: disk.items,
              churchLiveControlStatus: disk.churchLiveControlStatus,
              updatedAt: disk.updatedAt,
            });
          }
        }

        if (!firstPaintLoggedRef.current && alive) {
          firstPaintLoggedRef.current = true;
          markScreenFirstPainted(CHURCH_MINISTRIES_SCREEN);
          logChurchFeatureFirstPaint(
            CHURCH_MINISTRIES_SCREEN,
            cacheHydratedRef.current,
            items.length
          );
        }

        if (
          cacheFreshRef.current ||
          shouldSkipFocusRefresh(CHURCH_MINISTRIES_SCREEN, CHURCH_TAB_REFRESH_MS) ||
          shouldSkipChurchFeatureRefresh(CHURCH_MINISTRIES_SCREEN, churchId, userId)
        ) {
          if (alive) {
            setHasLoaded(true);
            setLoading(false);
          }
          return;
        }

        void load({ force: false });
      })();

      return () => {
        alive = false;
      };
    }, [churchId, userId, applyMinistriesCache, load, items.length])
  );

  useEffect(() => {
    if (!churchId || isSubscriptionBypassEnabled()) {
      setChurchSubscriptionActive(isSubscriptionBypassEnabled() ? true : null);
      return;
    }

    let alive = true;
    fetchChurchSubscriptionActive(churchId, getKristoHeaders()).then((active) => {
      if (alive) setChurchSubscriptionActive(active);
    });

    return () => {
      alive = false;
    };
  }, [churchId]);

  async function handleCreateMinistryPress() {
    if (!canCreateMinistry) return;

    let active = churchSubscriptionActive;
    if (active === null && !isSubscriptionBypassEnabled()) {
      active = await fetchChurchSubscriptionActive(churchId, getKristoHeaders());
      setChurchSubscriptionActive(active);
    }
    if (isMinistryCreationBlocked(active)) {
      setPremiumModalOpen(true);
      return;
    }

    router.push("/church/ministries/create" as any);
  }

  function handlePremiumModalPrimary() {
    setPremiumModalOpen(false);
    if (canManageSubscriptions) {
      router.push("/more/payments/subscriptions" as any);
    }
  }

  const hasItems = useMemo(() => items.length > 0, [items]);
  const showSpinner = loading && !hasLoaded;
  const showEmptyState = hasLoaded && !err && !hasItems;

  useEffect(() => {
    emptyStateLoggedRef.current = false;
  }, [churchId]);

  useEffect(() => {
    if (!showEmptyState || emptyStateLoggedRef.current) return;
    emptyStateLoggedRef.current = true;
    console.log("KRISTO_MINISTRIES_EMPTY_STATE_SHOWN", {
      churchId,
      userId,
      role,
      source: cacheHydratedRef.current ? "cache-or-fetch" : "fetch",
    });
  }, [showEmptyState, churchId, userId, role]);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.nav}>
        <View style={s.iconPill}>
          <Ionicons name="grid-outline" size={18} color={GOLD} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.navTitle}>Ministries</Text>
          <Text style={s.navSub}>Manage ministry rooms, leaders, members, and media access.</Text>
        </View>

        <Pressable onPress={() => load({ force: true })} style={({ pressed }) => [s.refreshBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="refresh" size={18} color="rgba(255,255,255,0.85)" />
        </Pressable>
        {canCreateMinistry ? (
          <Pressable
            onPress={handleCreateMinistryPress}
            style={({ pressed }) => [
              s.createNavBtn,
              createMinistryLocked && s.createNavBtnLocked,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons
              name={createMinistryLocked ? "lock-closed" : "add"}
              size={18}
              color={createMinistryLocked ? GOLD : "rgba(255,255,255,0.92)"}
            />
          </Pressable>
        ) : null}
      </View>

      {showSpinner ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.muted}>Loading…</Text>
        </View>
      ) : err ? (
        <View style={s.card}>
          <Text style={s.errTitle}>Error</Text>
          <Text style={s.errText}>{err}</Text>
          <Pressable onPress={() => load({ force: true })} style={({ pressed }) => [s.btnGhost, pressed && { opacity: 0.9 }]}>
            <Text style={s.btnGhostText}>Retry</Text>
          </Pressable>
        </View>
      ) : showEmptyState ? (
        <View style={s.emptyCard}>
          <View style={s.emptyIconWrap}>
            <Ionicons name="grid-outline" size={28} color={GOLD} />
          </View>
          <Text style={s.emptyTitle}>No ministries yet</Text>
          <Text style={s.emptyBody}>
            Create your first ministry room for leaders, members, and media access.
          </Text>

          {canCreateMinistry ? (
            <Pressable
              onPress={handleCreateMinistryPress}
              style={({ pressed }) => [
                s.createBtn,
                createMinistryLocked && s.createBtnLocked,
                pressed && { transform: [{ scale: 0.99 }] },
              ]}
            >
              <Ionicons
                name={createMinistryLocked ? "lock-closed" : "add"}
                size={18}
                color="#0B0F17"
              />
              <Text style={s.createBtnText}>
                {createMinistryLocked ? "Create Ministry (Premium)" : "Create Ministry"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: 26 }}>
          {items.map((m) => {
            const leaders = Number(m.leaderCount ?? m.leadersCount ?? 0);
            const members = Number(m.memberCount ?? m.membersCount ?? 0);
            return (
            <Pressable
              key={m.id}
              onPress={() => router.push((`/church/ministries/${m.id}` as any))}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.9 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{m.name}</Text>
                {!!m.description && <Text style={s.rowSub} numberOfLines={2}>{m.description}</Text>}
                <View style={s.badges}>
                  <View style={[s.badge, m.status === "Active" ? s.badgeOn : s.badgeOff]}>
                    <Text style={s.badgeText}>{m.status}</Text>
                  </View>

                  <View style={s.countBadge}>
                    <Ionicons name="star" size={11} color={GOLD} />
                    <Text style={s.countBadgeText}>{leaders} leaders</Text>
                  </View>

                  <View style={s.countBadge}>
                    <Ionicons name="people" size={11} color="rgba(255,255,255,0.78)" />
                    <Text style={s.countBadgeText}>{members} members</Text>
                  </View>

                  {m.mediaAccess ? (
                    <View style={[s.badge, s.mediaBadge]}>
                      <Ionicons name="videocam" size={12} color="#0B0F17" />
                      <Text style={s.mediaBadgeText}>Media</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.65)" />
            </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ChurchPremiumSubscriptionModal
        visible={premiumModalOpen}
        onClose={() => setPremiumModalOpen(false)}
        onViewSubscription={handlePremiumModalPrimary}
      />

      {/* LIST_ONLY_MARKER */}
    </View>
  );
}

const s = StyleSheet.create<any>({
  createBtnText: { color: "#0B0F17", fontWeight: "950" },
  createBtn: {
    marginTop: 18,
    minWidth: 220,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(217,179,95,0.95)",
  },
  createBtnLocked: {
    backgroundColor: "rgba(217,179,95,0.78)",
    borderWidth: 1,
    borderColor: "rgba(217,181,109,0.55)",
  },
  screen: { flex: 1, backgroundColor: VIP_BG },
  nav: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: PAD, paddingBottom: 14, paddingTop: 8 },
  iconPill: { width: 34, height: 34, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.12)", borderWidth: 1, borderColor: "rgba(217,179,95,0.25)" },
  navTitle: { color: "white", fontWeight: "900", fontSize: 18 },
  navSub: { marginTop: 2, color: "rgba(255,255,255,0.65)", fontWeight: "700" },
  refreshBtn: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  createNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
  },
  createNavBtnLocked: {
    backgroundColor: "rgba(217,179,95,0.10)",
    borderColor: "rgba(217,181,109,0.45)",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  muted: { color: "rgba(255,255,255,0.65)", fontWeight: "700" },

  card: { margin: PAD, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.04)" },
  emptyCard: {
    margin: PAD,
    marginTop: 24,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(255,255,255,0.035)",
    alignItems: "center",
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    marginBottom: 14,
  },
  errTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  errText: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontWeight: "700" },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 18, textAlign: "center" },
  emptyBody: {
    marginTop: 8,
    color: "rgba(255,255,255,0.62)",
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },

  btnGhost: { marginTop: 12, borderRadius: 16, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.03)" },
  btnGhostText: { color: "rgba(255,255,255,0.85)", fontWeight: "900" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 24, padding: 15, marginBottom: 12, borderWidth: 1.2, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.055)" },
  rowTitle: { color: "rgba(255,255,255,0.97)", fontWeight: "950", fontSize: 16, letterSpacing: 0.1 },
  rowSub: { marginTop: 5, color: "rgba(255,255,255,0.66)", fontWeight: "750", lineHeight: 18 },

  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 11 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, minHeight: 28, alignItems: "center", justifyContent: "center" },
  badgeOn: { backgroundColor: "rgba(217,179,95,0.16)", borderColor: "rgba(217,179,95,0.35)" },
  badgeOff: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" },
  badgeText: { color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 },
  mediaBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: GOLD, borderColor: GOLD },
  mediaBadgeText: { color: "#0B0F17", fontWeight: "950", fontSize: 12 },
  countBadge: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.055)",
  },
  countBadgeText: { color: "rgba(255,255,255,0.78)", fontWeight: "850", fontSize: 11 },
});
