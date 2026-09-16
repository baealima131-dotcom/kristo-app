import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  listAdminProtectionCases,
  SokoProtectionAdminApiError,
  type SokoProtectionAdminCase,
} from "@/src/lib/sokoProtectionAdminApi";
import {
  deadlineStatusLabel,
  filterAdminQueueRows,
  filterToApiState,
  frozenProductTitle,
  isSellerResponseOverdue,
  ORDER_AT_CASE_OPENING_LABEL,
  orderAtCaseOpeningDisplay,
  paymentVerificationKindLabel,
  protectionCaseStateLabel,
  protectionRequestTypeLabel,
  shortUserRef,
  SOKO_PROTECTION_ADMIN_HONEST_DISCLAIMER,
  type SokoProtectionAdminFilter,
} from "@/src/lib/sokoProtectionAdminLabels";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.60)";
const GOLD = "#F4D06F";
const PINK = "#FF8CC8";
const GREEN = "#5DEBA5";

const FILTERS: Array<{ key: SokoProtectionAdminFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "awaiting_seller", label: "Awaiting seller" },
  { key: "evidence_review", label: "Evidence under review" },
  { key: "resolution_recommended", label: "Resolution recommended" },
  { key: "external_refund_pending", label: "External refund pending" },
  { key: "closed", label: "Closed" },
  { key: "overdue", label: "Overdue" },
];

function formatWhen(value?: string | null) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "—";
}

export default function BuyerProtectionAdminQueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [filter, setFilter] =
    React.useState<SokoProtectionAdminFilter>("all");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [unauthorized, setUnauthorized] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [rows, setRows] = React.useState<SokoProtectionAdminCase[]>([]);
  const loadSeq = React.useRef(0);

  const load = React.useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!allowed) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const seq = ++loadSeq.current;
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError("");
      setUnauthorized(false);
      setOffline(false);

      try {
        const apiState = filterToApiState(filter);
        const listed = await listAdminProtectionCases(
          apiState ? { state: apiState } : undefined
        );
        if (seq !== loadSeq.current) return;
        setRows(filterAdminQueueRows(listed, filter));
      } catch (nextError: any) {
        if (seq !== loadSeq.current) return;
        const status = Number(nextError?.status || 0);
        const message = String(
          nextError?.message || "Could not load Buyer Protection queue."
        );
        if (status === 401 || status === 403) {
          setUnauthorized(true);
          setError(
            status === 401
              ? "Session expired. Sign in again as System Admin."
              : "Forbidden. System_Admin platform role required."
          );
        } else if (
          nextError instanceof SokoProtectionAdminApiError &&
          /reach|network/i.test(message)
        ) {
          setOffline(true);
          setError(message);
        } else if (/reach|network|offline/i.test(message)) {
          setOffline(true);
          setError(message);
        } else {
          setError(message);
        }
        setRows([]);
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [allowed, filter]
  );

  useFocusEffect(
    React.useCallback(() => {
      void load("initial");
    }, [load])
  );

  if (!allowed) {
    return (
      <View style={styles.center} accessibilityRole="summary">
        <Ionicons name="lock-closed-outline" size={42} color={PINK} />
        <Text style={styles.emptyTitle}>System Admin only</Text>
        <Text style={styles.emptyText}>
          The Buyer Protection review queue requires the verified System_Admin
          platform role. Spoofed role headers are ignored.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#251743", "#10131D", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={25} color={TEXT} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Buyer Protection
          </Text>
          <Text style={styles.headerSub}>Review queue • observe-only</Text>
        </View>
        <Pressable
          onPress={() => void load("refresh")}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Refresh queue"
          hitSlop={10}
        >
          <Ionicons name="refresh" size={22} color={GOLD} />
        </Pressable>
      </View>

      <Text style={styles.disclaimer}>{SOKO_PROTECTION_ADMIN_HONEST_DISCLAIMER}</Text>

      <View style={styles.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter ${item.label}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 28,
          gap: 12,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor={GOLD}
          />
        }
      >
        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={GOLD} />
            <Text style={styles.stateText}>Loading protection cases…</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.stateBox}>
            <Ionicons
              name={
                unauthorized
                  ? "lock-closed-outline"
                  : offline
                    ? "cloud-offline-outline"
                    : "alert-circle-outline"
              }
              size={28}
              color={PINK}
            />
            <Text style={styles.emptyTitle}>
              {unauthorized ? "Unauthorized" : offline ? "Offline" : "Could not load"}
            </Text>
            <Text style={styles.emptyText}>{error}</Text>
            <Pressable
              onPress={() => void load("initial")}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry loading queue"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <View style={styles.stateBox}>
            <Ionicons name="file-tray-outline" size={28} color={MUTED} />
            <Text style={styles.emptyTitle}>No cases in this filter</Text>
            <Text style={styles.emptyText}>
              Open cases appear here after buyers file Buyer Protection requests
              in standalone SOKO.
            </Text>
          </View>
        ) : null}

        {!loading &&
          !error &&
          rows.map((row) => {
            const overdue = isSellerResponseOverdue(row);
            return (
              <Pressable
                key={row.id}
                onPress={() =>
                  router.push(
                    `/more/system-admin/buyer-protection/${encodeURIComponent(row.id)}` as any
                  )
                }
                style={styles.card}
                accessibilityRole="button"
                accessibilityLabel={`Open protection case ${row.id.slice(-10)}`}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.caseRef}>Case {row.id.slice(-10)}</Text>
                  <Text style={[styles.badge, overdue && styles.badgeOverdue]}>
                    {protectionCaseStateLabel(row.state)}
                  </Text>
                </View>
                <Text style={styles.meta}>
                  {protectionRequestTypeLabel(row.requestType)} · Order{" "}
                  {row.orderId.slice(-8).toUpperCase()}
                </Text>
                <Text style={styles.title} numberOfLines={2}>
                  {frozenProductTitle(row.immutableOrderSnapshot)}
                </Text>
                <Text style={styles.meta}>
                  Buyer {shortUserRef(row.buyerUserId)} · Seller{" "}
                  {shortUserRef(row.sellerUserId)}
                </Text>
                <Text style={styles.meta}>
                  {ORDER_AT_CASE_OPENING_LABEL}:{" "}
                  {orderAtCaseOpeningDisplay(row.immutableOrderSnapshot)}
                </Text>
                <Text style={styles.meta}>
                  {paymentVerificationKindLabel(row.paymentVerificationKind)}
                </Text>
                <Text style={[styles.meta, overdue && styles.overdueText]}>
                  {deadlineStatusLabel(row)}
                </Text>
                <Text style={styles.meta}>
                  Created {formatWhen(row.createdAt)} · Updated{" "}
                  {formatWhen(row.updatedAt)}
                </Text>
                <View style={styles.openRow}>
                  <Text style={styles.openText}>Open case</Text>
                  <Ionicons name="chevron-forward" size={16} color={GREEN} />
                </View>
              </Pressable>
            );
          })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 10,
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  headerTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "800",
  },
  headerSub: {
    color: MUTED,
    fontSize: 13,
    marginTop: 2,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
  },
  disclaimer: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  filterRow: { marginBottom: 10 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: "rgba(244,208,111,0.18)",
    borderColor: "rgba(244,208,111,0.55)",
  },
  chipText: { color: MUTED, fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: GOLD },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14,
    gap: 6,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
  },
  caseRef: { color: GOLD, fontWeight: "800", fontSize: 13 },
  badge: {
    color: TEXT,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(93,235,165,0.14)",
  },
  badgeOverdue: {
    backgroundColor: "rgba(255,140,200,0.18)",
    color: PINK,
  },
  title: { color: TEXT, fontSize: 16, fontWeight: "700" },
  meta: { color: MUTED, fontSize: 12, lineHeight: 17 },
  overdueText: { color: PINK, fontWeight: "700" },
  openRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  openText: { color: GREEN, fontWeight: "800", fontSize: 13 },
  stateBox: {
    marginTop: 24,
    alignItems: "center",
    gap: 10,
    padding: 18,
  },
  stateText: { color: MUTED },
  emptyTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 4,
    minHeight: 44,
    minWidth: 120,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.18)",
    paddingHorizontal: 18,
  },
  retryText: { color: GOLD, fontWeight: "800" },
});
