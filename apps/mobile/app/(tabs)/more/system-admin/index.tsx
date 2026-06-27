import React from "react";
import {
  ActivityIndicator,
  Pressable,
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
import {
  hasOfflineActivationRole,
  logOfflineCodesRouteOpened,
} from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  fetchActivationDashboard,
  type ActivationDashboardStats,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_ACCENT as ACCENT,
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_BORDER as BORDER,
  OFFLINE_ADMIN_CARD as CARD,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

type SectionLink = {
  key: string;
  title: string;
  subtitle: string;
  href?: string;
  disabled?: boolean;
};

export default function SystemAdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const userId = String(session?.userId || "").trim();
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [stats, setStats] = React.useState<ActivationDashboardStats | null>(null);

  const loadDashboard = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetchActivationDashboard();
      setStats(res.stats);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load dashboard"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      if (allowed) logOfflineCodesRouteOpened("system-admin", platformRole || "", userId);
      loadDashboard();
    }, [allowed, loadDashboard, platformRole, userId])
  );

  const sections: SectionLink[] = [
    {
      key: "subscription_codes",
      title: "Subscription Activation Codes",
      subtitle: "Generate batches and view platform codes.",
      href: "/more/system-admin/subscription-codes",
    },
    {
      key: "supervisors",
      title: "Supervisors",
      subtitle: `${stats?.supervisorCount ?? 0} supervisors • assign codes securely`,
      href: "/more/system-admin/supervisors",
    },
    {
      key: "agents",
      title: "Agents",
      subtitle: `${stats?.agentCount ?? 0} agents • managed by supervisors (read-only)`,
      disabled: true,
    },
    {
      key: "activity",
      title: "Code Activity",
      subtitle: "Coming soon in this workspace.",
      disabled: true,
    },
  ];

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[`${ACCENT}22`, "rgba(7,12,20,0.98)", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>System Admin</Text>
          <Text style={styles.subtitle}>Offline activation control center</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <View style={styles.noticeCard}>
            <Ionicons name="lock-closed-outline" size={22} color={ACCENT} />
            <Text style={styles.noticeTitle}>Access restricted</Text>
            <Text style={styles.noticeText}>
              This screen is available only for the System Admin platform role.
            </Text>
          </View>
        ) : (
          <>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {stats ? (
              <View style={styles.statsGrid}>
                <StatCard label="Total codes" value={stats.totalCodes} />
                <StatCard label="Available" value={stats.availableUnassigned} accent="#6EE7A8" />
                <StatCard label="With supervisors" value={stats.assignedToSupervisors} accent="#93C5FD" />
                <StatCard label="Redeemed" value={stats.redeemed} accent="#FCA5A5" />
              </View>
            ) : null}

            <Pressable
              style={styles.primaryBtn}
              onPress={() => router.push("/more/system-admin/supervisors?add=1" as any)}
            >
              <Ionicons name="person-add-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Add Supervisor</Text>
            </Pressable>

            {sections.map((section) => (
              <Pressable
                key={section.key}
                style={[styles.sectionCard, section.disabled && styles.sectionCardDisabled]}
                disabled={section.disabled || !section.href}
                onPress={() => {
                  if (section.href) router.push(section.href as any);
                }}
              >
                <View style={styles.sectionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionSub}>{section.subtitle}</Text>
                  </View>
                  <Ionicons
                    name={section.disabled ? "time-outline" : "chevron-forward"}
                    size={18}
                    color="rgba(255,255,255,0.45)"
                  />
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
  accent = TEXT,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: { color: TEXT, fontSize: 22, fontWeight: "800" },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: {
    width: "48%",
    flexGrow: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { color: MUTED, fontSize: 11, marginTop: 4, fontWeight: "600" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: ACCENT,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  sectionCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sectionCardDisabled: { opacity: 0.72 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: { color: TEXT, fontSize: 15, fontWeight: "700" },
  sectionSub: { color: MUTED, fontSize: 12, marginTop: 3 },
  loadingWrap: { paddingVertical: 12, alignItems: "center" },
  errorCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  errorText: { color: "#FCA5A5", fontSize: 13 },
  noticeCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    gap: 8,
  },
  noticeTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
