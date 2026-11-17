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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  fetchSafetySystemAdminDashboard,
  type SafetySystemAdminDashboardCounts,
  type SafetySystemAdminDashboardResponse,
} from "@/src/lib/safetyAdminApi";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.60)";
const GOLD = "#F4D06F";
const GREEN = "#5DEBA5";
const PINK = "#FF8CC8";
const PURPLE = "#B9A2FF";
const BLUE = "#78D8FF";

type Source = "all" | "kristo" | "soko";

/** Queue stages, in the order a report moves through them. */
const STAGES: {
  key: keyof SafetySystemAdminDashboardCounts;
  label: string;
  helper: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
}[] = [
  { key: "open", label: "New", helper: "Waiting for a supervisor", icon: "mail-unread-outline", color: GOLD },
  { key: "assigned", label: "Assigned", helper: "With a supervisor or agent", icon: "person-outline", color: BLUE },
  { key: "inReview", label: "In review", helper: "Being checked now", icon: "search-outline", color: PURPLE },
  { key: "escalated", label: "Escalated", helper: "Needs a senior decision", icon: "alert-circle-outline", color: PINK },
  { key: "highPriority", label: "High priority", helper: "Marked urgent", icon: "flame-outline", color: PINK },
  { key: "resolved", label: "Resolved", helper: "Decision issued", icon: "checkmark-done-outline", color: GREEN },
  { key: "dismissed", label: "Dismissed", helper: "No action needed", icon: "close-circle-outline", color: MUTED },
];

function countsFor(
  dashboard: SafetySystemAdminDashboardResponse | null,
  source: Source
): SafetySystemAdminDashboardCounts | null {
  if (!dashboard) return null;
  if (source === "kristo") return dashboard.countsBySource?.kristo || null;
  if (source === "soko") return dashboard.countsBySource?.soko || null;
  return dashboard.counts || null;
}

/**
 * Report Queue: where every report stands (new, assigned, in review, escalated, resolved,
 * dismissed), for Kristo App and SOKO. Reports are worked by supervisors and their agents, so the
 * queue links to Supervisors. System Admin only (the dashboard API checks it too).
 */
export default function ReportQueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const allowed = hasOfflineActivationRole(resolveSessionPlatformRole(session) || "", "System_Admin");

  const [source, setSource] = React.useState<Source>("all");
  const [dashboard, setDashboard] = React.useState<SafetySystemAdminDashboardResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      const next = await fetchSafetySystemAdminDashboard();
      setDashboard(next);
      setError("");
    } catch (err: any) {
      setError(String(err?.message || "Could not load the report queue."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    void load("initial");
  }, [allowed, load]);

  const counts = countsFor(dashboard, source);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={["rgba(244,208,111,0.10)", "rgba(8,12,20,0)"]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>Report Queue</Text>
        <View style={styles.backBtn} />
      </View>

      {!allowed ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={28} color={GOLD} />
          <Text style={styles.restrictedTitle}>Access restricted</Text>
          <Text style={styles.restrictedText}>The Report Queue is available only to the System Admin.</Text>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={GOLD} />}
        >
          <View style={styles.sourceRow}>
            {(["all", "kristo", "soko"] as Source[]).map((key) => (
              <Pressable
                key={key}
                onPress={() => setSource(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: source === key }}
                style={[styles.sourceChip, source === key ? styles.sourceChipActive : null]}
              >
                <Text style={[styles.sourceChipText, source === key ? { color: BG } : null]}>
                  {key === "all" ? "All" : key === "kristo" ? "Kristo App" : "SOKO"}
                </Text>
              </Pressable>
            ))}
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => void load("refresh")} accessibilityRole="button" style={styles.retryBtn}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {counts ? (
            <>
              <Text style={styles.totalText}>
                {counts.total} report{counts.total === 1 ? "" : "s"} in total
              </Text>
              {STAGES.map((stage) => (
                <View key={stage.key} style={styles.stageRow}>
                  <View style={[styles.stageIcon, { borderColor: stage.color }]}>
                    <Ionicons name={stage.icon} size={18} color={stage.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stageLabel}>{stage.label}</Text>
                    <Text style={styles.stageHelper}>{stage.helper}</Text>
                  </View>
                  <Text style={[styles.stageCount, { color: stage.color }]}>{Number(counts[stage.key] || 0)}</Text>
                </View>
              ))}
            </>
          ) : null}

          <Pressable
            onPress={() => router.push("/more/system-admin/report-center/supervisors" as any)}
            accessibilityRole="button"
            accessibilityLabel="Open Supervisors and their reports"
            style={({ pressed }) => [styles.linkCard, pressed ? { opacity: 0.8 } : null]}
          >
            <Ionicons name="people-outline" size={22} color={GOLD} />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Supervisors and their reports</Text>
              <Text style={styles.linkHelper}>Open a supervisor to see, assign and decide their reports.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={MUTED} />
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: TEXT, fontSize: 17, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  restrictedTitle: { color: TEXT, fontSize: 16, fontWeight: "900" },
  restrictedText: { color: MUTED, fontSize: 13, textAlign: "center" },
  sourceRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  sourceChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.35)",
  },
  sourceChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  sourceChipText: { color: TEXT, fontSize: 12, fontWeight: "800" },
  totalText: { color: MUTED, fontSize: 12, fontWeight: "700", marginBottom: 10 },
  stageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  stageIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stageLabel: { color: TEXT, fontSize: 14, fontWeight: "900" },
  stageHelper: { color: MUTED, fontSize: 11, fontWeight: "600", marginTop: 2 },
  stageCount: { fontSize: 22, fontWeight: "900" },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.30)",
    backgroundColor: "rgba(244,208,111,0.06)",
  },
  linkTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  linkHelper: { color: MUTED, fontSize: 11, fontWeight: "600", marginTop: 2 },
  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,140,200,0.10)",
    marginBottom: 12,
    gap: 8,
  },
  errorText: { color: PINK, fontSize: 13, fontWeight: "700" },
  retryBtn: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.10)" },
  retryText: { color: TEXT, fontSize: 12, fontWeight: "800" },
});
