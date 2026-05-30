import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { ChurchPremiumSubscriptionModal, isMinistryCreationBlocked } from "@/src/components/ChurchPremiumSubscriptionModal";
import { fetchChurchSubscriptionActive } from "@/src/lib/churchSubscription";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";

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

async function apiListMinistries() {
  const res = await apiGet<any>("/api/church/ministries", { headers: getKristoHeaders() });
  if (!res) throw new Error("Network error");
  if (!res.ok) throw new Error(res.error || "Fetch failed");
  return (res.data || []) as Ministry[];
}

export default function MoreMinistriesList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const [items, setItems] = useState<Ministry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [churchSubscriptionActive, setChurchSubscriptionActive] = useState<boolean | null>(
    isSubscriptionBypassEnabled() ? true : null
  );
  const [premiumModalOpen, setPremiumModalOpen] = useState(false);

  const churchId = String(session?.churchId || (session as any)?.activeChurchId || "").trim();
  const role = String(session?.role || (session as any)?.churchRole || "Member");
  const canCreateMinistry =
    /\bPastor\b/i.test(role) ||
    role === "Church_Admin" ||
    role === "Leader" ||
    role === "Ministry_Leader" ||
    role === "System_Admin";
  const canManageSubscriptions =
    /\bPastor\b/i.test(role) || role === "Church_Admin" || role === "System_Admin";
  const createMinistryLocked = canCreateMinistry && isMinistryCreationBlocked(churchSubscriptionActive);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const data = await apiListMinistries();

      const withCounts = await Promise.all(
        data.map(async (m) => {
          try {
            const r = await apiGet<any>(
              `/api/church/ministry-members?ministryId=${encodeURIComponent(m.id)}&all=1`,
              { headers: getKristoHeaders() }
            );

            const rawRows = Array.isArray(r?.data) ? r.data : Array.isArray(r?.items) ? r.items : [];
            const rows = rawRows.filter((x: any) => {
              const rowMinistryId = String(
                x?.ministryId ||
                x?.ministry?.id ||
                x?.ministry_id ||
                x?.idMinistry ||
                ""
              );
              return rowMinistryId ? rowMinistryId === String(m.id) : false;
            });

            const leaders = rows.filter((x: any) =>
              String(x?.role || x?.ministryRole || "").toLowerCase().includes("leader")
            ).length;
            const members = rows.length;

            return { ...m, leaderCount: leaders, memberCount: members };
          } catch {
            return m;
          }
        })
      );

      setItems(withCounts);
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Error");
      if (msg.toLowerCase().includes("no active church membership")) {
        setItems([]);
        setErr(null);
      } else {
        setErr(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

        <Pressable onPress={load} style={({ pressed }) => [s.refreshBtn, pressed && { opacity: 0.85 }]}>
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

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.muted}>Loading…</Text>
        </View>
      ) : err ? (
        <View style={s.card}>
          <Text style={s.errTitle}>Error</Text>
          <Text style={s.errText}>{err}</Text>
          <Pressable onPress={load} style={({ pressed }) => [s.btnGhost, pressed && { opacity: 0.9 }]}>
            <Text style={s.btnGhostText}>Retry</Text>
          </Pressable>
        </View>
      ) : !hasItems ? (
        <View style={s.card}>
          <Text style={s.emptyTitle}>No ministries yet</Text>
          <Text style={s.muted}>Create ministry hapa.</Text>

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
              {createMinistryLocked ? "Create ministry (Premium)" : "Create ministry"}
            </Text>
          </Pressable>
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
  createBtn: { marginTop: 12, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "rgba(217,179,95,0.95)" },
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
  errTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  errText: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontWeight: "700" },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 },

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
