import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  listAdminProtectionCases,
  type SokoProtectionAdminCase,
} from "@/src/lib/sokoProtectionAdminApi";
import {
  deadlineStatusLabel,
  filterAdminQueueRows,
  filterToApiState,
  frozenProductImageUrl,
  frozenProductTitle,
  isSellerResponseOverdue,
  matchesProtectionSearch,
  ORDER_AT_CASE_OPENING_LABEL,
  orderAtCaseOpeningDisplay,
  partyPrimaryLabel,
  paymentStatusChip,
  protectionCaseStateLabel,
  protectionRequestTypeLabel,
  shortCaseRef,
  trustedParty,
  waitingSinceLabel,
  type SokoProtectionAdminFilter,
} from "@/src/lib/sokoProtectionAdminLabels";

const BG = "#070A12";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.58)";
const GOLD = "#F4D06F";
const PINK = "#FF8AA4";

const FILTERS: Array<{ key: SokoProtectionAdminFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "awaiting_seller", label: "Awaiting seller" },
  { key: "evidence_review", label: "Evidence under review" },
  { key: "resolution_recommended", label: "Recommended" },
  { key: "external_refund_pending", label: "External refund" },
  { key: "closed", label: "Closed" },
  { key: "overdue", label: "Overdue" },
];

export default function BuyerProtectionAdminQueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [filter, setFilter] =
    React.useState<SokoProtectionAdminFilter>("all");
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
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
        setError(
          status === 401
            ? "Session expired. Sign in again as System Admin."
            : status === 403
              ? "Forbidden. System_Admin platform role required."
              : message
        );
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

  const visible = rows.filter((row) => matchesProtectionSearch(row, query));

  if (!allowed) {
    return (
      <View style={styles.center} accessibilityRole="summary">
        <Ionicons name="lock-closed-outline" size={36} color={PINK} />
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
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Buyer Protection
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Evidence review only. Funds are handled outside SOKO"
          style={styles.iconButton}
        >
          <Ionicons name="information-circle-outline" size={22} color={GOLD} />
        </Pressable>
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={MUTED} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search cases"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.search}
          accessibilityLabel="Search protection cases"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable
            onPress={() => setQuery("")}
            style={styles.clearSearch}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={19} color={MUTED} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScroll}
        contentContainerStyle={styles.filters}
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
      <ScrollView
        style={styles.list}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: insets.bottom + 16,
          gap: 8,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor={GOLD}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {loading ? <ActivityIndicator color={GOLD} /> : null}
        {error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{error}</Text>
            <Pressable
              onPress={() => void load("refresh")}
              style={styles.retry}
              accessibilityRole="button"
              accessibilityLabel="Retry loading queue"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && !error && visible.length === 0 ? (
          <View style={styles.empty} accessibilityRole="summary">
            <View style={styles.emptyIcon}>
              <Ionicons name="file-tray-outline" size={24} color={GOLD} />
            </View>
            <Text style={styles.emptyTitle}>No cases match this view</Text>
            <Text style={styles.emptyText}>
              Try another status or clear the search.
            </Text>
            <Pressable
              onPress={() => {
                setFilter("all");
                setQuery("");
              }}
              style={styles.showAllButton}
              accessibilityRole="button"
              accessibilityLabel="Show all protection cases"
            >
              <Text style={styles.showAllText}>Show all cases</Text>
            </Pressable>
          </View>
        ) : null}
        {visible.map((row) => (
          <QueueCard
            key={row.id}
            row={row}
            onPress={() =>
              router.push(
                `/more/system-admin/buyer-protection/${encodeURIComponent(row.id)}` as any
              )
            }
          />
        ))}
      </ScrollView>
    </View>
  );
}

function QueueCard({
  row,
  onPress,
}: {
  row: SokoProtectionAdminCase;
  onPress: () => void;
}) {
  const [failed, setFailed] = React.useState(false);
  const image = failed ? null : frozenProductImageUrl(row.immutableOrderSnapshot);
  const buyer = trustedParty({
    side: "buyer",
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
    parties: row.parties,
  });
  const overdue = isSellerResponseOverdue({
    state: row.state,
    sellerResponseDeadline: row.sellerResponseDeadline,
  });
  const deadline = deadlineStatusLabel({
    state: row.state,
    sellerResponseDeadline: row.sellerResponseDeadline,
    evidenceDeadline: row.evidenceDeadline,
    externalRefundDeadline: row.externalRefundDeadline,
  });
  // Opening status stays off the queue unless a live comparison exists.
  const openingKnown = orderAtCaseOpeningDisplay(row.immutableOrderSnapshot);
  void openingKnown;
  void ORDER_AT_CASE_OPENING_LABEL;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.86 }]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${frozenProductTitle(row.immutableOrderSnapshot)}`}
    >
      <ProductThumb uri={image} onError={() => setFailed(true)} />
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {frozenProductTitle(row.immutableOrderSnapshot)}
        </Text>
        <Text style={styles.person} numberOfLines={1}>
          {partyPrimaryLabel(buyer)}
        </Text>
        <View style={styles.chipRow}>
          <MiniChip label={protectionRequestTypeLabel(row.requestType)} />
          <MiniChip label={protectionCaseStateLabel(row.state)} gold />
          <MiniChip label={paymentStatusChip(row.paymentVerificationKind)} />
          {overdue ? <MiniChip label="Overdue" danger /> : null}
        </View>
        <Text style={styles.secondary} numberOfLines={1}>
          {shortCaseRef(row.orderId)} · {waitingSinceLabel(row.createdAt)}
          {deadline !== "No active deadline" ? ` · ${deadline}` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
    </Pressable>
  );
}

function ProductThumb({
  uri,
  onError,
}: {
  uri: string | null;
  onError: () => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    setLoaded(false);
  }, [uri]);
  return (
    <View style={styles.thumbSlot} accessibilityLabel={uri && loaded ? "Product image" : "Product image unavailable"}>
      <View style={styles.thumbFallback}>
        <Ionicons name="cube-outline" size={26} color={GOLD} />
      </View>
      {uri ? (
        <Image
          source={{ uri }}
          resizeMode="cover"
          style={[styles.thumb, { opacity: loaded ? 1 : 0 }]}
          onLoad={() => setLoaded(true)}
          onError={onError}
        />
      ) : null}
    </View>
  );
}

function MiniChip({
  label,
  gold,
  danger,
}: {
  label: string;
  gold?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={[styles.mini, gold && styles.miniGold, danger && styles.miniDanger]}>
      <Text
        style={[styles.miniText, gold && styles.miniTextGold, danger && styles.miniTextDanger]}
        numberOfLines={1}
      >
        {label}
      </Text>
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
    padding: 24,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  headerTitle: { flex: 1, color: TEXT, fontSize: 20, fontWeight: "800" },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    minHeight: 48,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(120,86,190,0.18)",
  },
  search: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 0,
    color: TEXT,
    fontSize: 15,
  },
  clearSearch: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  filtersScroll: {
    flexGrow: 0,
    flexShrink: 0,
    height: 50,
    maxHeight: 50,
  },
  filters: {
    flexGrow: 0,
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  chip: {
    flexGrow: 0,
    flexShrink: 0,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  chipActive: {
    backgroundColor: "rgba(167,139,250,0.26)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.55)",
  },
  chipText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: TEXT },
  card: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(98,70,168,0.18)",
  },
  thumbSlot: {
    width: 76,
    height: 76,
    borderRadius: 12,
    overflow: "hidden",
  },
  thumb: {
    ...StyleSheet.absoluteFillObject,
    width: 76,
    height: 76,
    borderRadius: 12,
  },
  thumbFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,14,24,0.92)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.7)",
  },
  cardBody: { flex: 1, gap: 2 },
  title: { color: TEXT, fontSize: 15, fontWeight: "800", lineHeight: 19 },
  person: { color: MUTED, fontSize: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  mini: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  miniGold: { backgroundColor: "rgba(244,208,111,0.14)" },
  miniDanger: { backgroundColor: "rgba(255,138,164,0.16)" },
  miniText: { color: MUTED, fontSize: 10, fontWeight: "700" },
  miniTextGold: { color: GOLD },
  miniTextDanger: { color: PINK },
  secondary: { color: "rgba(255,255,255,0.45)", fontSize: 11 },
  list: { flex: 1 },
  empty: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    backgroundColor: "rgba(244,208,111,0.1)",
  },
  emptyTitle: { color: TEXT, fontSize: 18, fontWeight: "800" },
  emptyText: { color: MUTED, fontSize: 14, lineHeight: 20 },
  showAllButton: {
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.14)",
  },
  showAllText: { color: GOLD, fontWeight: "800" },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  retryText: { color: GOLD, fontWeight: "800" },
});
