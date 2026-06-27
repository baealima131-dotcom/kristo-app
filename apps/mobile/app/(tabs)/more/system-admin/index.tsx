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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
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
  fetchActivationChurchActivity,
  currentActivationMonthKey,
  type ActivationDashboardStats,
  type ActivationChurchActivityRow,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_BORDER as BORDER,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

const GOLD = "#F4D06F";
const GOLD_SOFT = "rgba(244,208,111,0.18)";
const PURPLE_GLOW = "rgba(156,118,255,0.35)";
const GLASS = "rgba(12,16,26,0.82)";

type SectionLink = {
  key: string;
  title: string;
  subtitle: string;
  badge: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: string;
};

function formatMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = String(monthKey || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatActivationDate(value: string): string {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type MetricConfig = {
  key: string;
  label: string;
  helper: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  glow: string;
  value: number;
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
  const [activityMonth] = React.useState(() => currentActivationMonthKey());
  const [activityLoading, setActivityLoading] = React.useState(true);
  const [activityError, setActivityError] = React.useState("");
  const [churchActivity, setChurchActivity] = React.useState<ActivationChurchActivityRow[]>([]);
  const [expandedChurches, setExpandedChurches] = React.useState<Record<string, boolean>>({});

  const loadDashboard = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      setActivityLoading(false);
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

  const loadChurchActivity = React.useCallback(async () => {
    if (!allowed) {
      setActivityLoading(false);
      return;
    }
    setActivityError("");
    setActivityLoading(true);
    try {
      const res = await fetchActivationChurchActivity(activityMonth);
      setChurchActivity(res.churches);
    } catch (e: any) {
      setActivityError(String(e?.message || "Failed to load church activity"));
      setChurchActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, [allowed, activityMonth]);

  useFocusEffect(
    React.useCallback(() => {
      if (allowed) logOfflineCodesRouteOpened("system-admin", platformRole || "", userId);
      loadDashboard();
      loadChurchActivity();
    }, [allowed, loadDashboard, loadChurchActivity, platformRole, userId])
  );

  const metrics: MetricConfig[] = stats
    ? [
        {
          key: "total",
          label: "Total Codes",
          helper: "All time generated",
          icon: "layers-outline",
          color: GOLD,
          glow: "rgba(244,208,111,0.22)",
          value: stats.totalCodes,
        },
        {
          key: "available",
          label: "Available",
          helper: "Ready to assign",
          icon: "sparkles-outline",
          color: "#6EE7A8",
          glow: "rgba(110,231,168,0.20)",
          value: stats.availableUnassigned,
        },
        {
          key: "supervisors",
          label: "With Supervisors",
          helper: "Assigned to team",
          icon: "people-outline",
          color: "#93C5FD",
          glow: "rgba(147,197,253,0.20)",
          value: stats.assignedToSupervisors,
        },
        {
          key: "redeemed",
          label: "Redeemed",
          helper: "Successfully used",
          icon: "checkmark-done-outline",
          color: "#FCA5A5",
          glow: "rgba(252,165,165,0.18)",
          value: stats.redeemed,
        },
      ]
    : [];

  const sections: SectionLink[] = [
    {
      key: "subscription_codes",
      title: "Subscription Activation Codes",
      subtitle: "Generate batches and view platform codes.",
      badge: "MANAGE",
      icon: "ticket-outline",
      href: "/more/system-admin/subscription-codes",
    },
    {
      key: "supervisors",
      title: "Supervisors",
      subtitle: `${stats?.supervisorCount ?? 0} supervisors • assign codes securely`,
      badge: "MANAGE",
      icon: "people-circle-outline",
      href: "/more/system-admin/supervisors",
    },
  ];

  const toggleChurchExpanded = React.useCallback((churchId: string) => {
    setExpandedChurches((prev) => ({
      ...prev,
      [churchId]: !prev[churchId],
    }));
  }, []);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#14102A", "#0B0F17", BG]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={styles.headerGlowPurple} />
      <View pointerEvents="none" style={styles.headerGlowGold} />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>System Admin</Text>
          <Text style={styles.subtitle}>Offline Activation Control Center</Text>
        </View>
        <View style={styles.headerBadge}>
          <LinearGradient
            colors={["rgba(244,208,111,0.35)", "rgba(156,118,255,0.28)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <MaterialCommunityIcons name="shield-crown-outline" size={22} color={GOLD} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <View style={styles.noticeCard}>
            <Ionicons name="lock-closed-outline" size={22} color={GOLD} />
            <Text style={styles.noticeTitle}>Access restricted</Text>
            <Text style={styles.noticeText}>
              This screen is available only for the System Admin platform role.
            </Text>
          </View>
        ) : (
          <>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={GOLD} />
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {stats ? (
              <View style={styles.statsGrid}>
                {metrics.map((metric) => (
                  <PremiumMetricCard key={metric.key} metric={metric} />
                ))}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add Supervisor"
              onPress={() => router.push("/more/system-admin/supervisors?add=1" as any)}
              style={({ pressed }) => [styles.supervisorCta, pressed && styles.pressed]}
            >
              <LinearGradient
                colors={["rgba(88,56,160,0.92)", "rgba(42,28,78,0.96)", "rgba(18,14,32,0.98)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <LinearGradient
                colors={["rgba(244,208,111,0.14)", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.6 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.supervisorCtaIconWrap}>
                <Ionicons name="person-add" size={20} color={GOLD} />
              </View>
              <View style={styles.supervisorCtaCopy}>
                <Text style={styles.supervisorCtaTitle}>Add Supervisor</Text>
                <Text style={styles.supervisorCtaSub}>Invite and empower trusted supervisors</Text>
              </View>
              <View style={styles.supervisorCtaArrow}>
                <Ionicons name="arrow-forward" size={18} color="#07111F" />
              </View>
            </Pressable>

            {sections.map((section) => (
              <Pressable
                key={section.key}
                accessibilityRole="button"
                accessibilityLabel={section.title}
                style={({ pressed }) => [styles.menuCard, pressed && styles.pressed]}
                onPress={() => {
                  if (section.href) router.push(section.href as any);
                }}
              >
                <View style={styles.menuGoldRail} />
                <View style={styles.menuIconWrap}>
                  <Ionicons name={section.icon} size={20} color={GOLD} />
                </View>
                <View style={styles.menuCopy}>
                  <View style={styles.menuTitleRow}>
                    <Text style={styles.menuTitle}>{section.title}</Text>
                    <View style={styles.menuBadge}>
                      <Text style={styles.menuBadgeText}>{section.badge}</Text>
                    </View>
                  </View>
                  <Text style={styles.menuSub}>{section.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.42)" />
              </Pressable>
            ))}

            <View style={styles.activitySection}>
              <View style={styles.activityHeader}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.activityTitle}>Activation Church Activity</Text>
                  <Text style={styles.activitySub}>Track offline subscription activations</Text>
                </View>
                <View style={styles.monthFilterPill}>
                  <Text style={styles.monthFilterText}>This Month</Text>
                </View>
              </View>
              <Text style={styles.activityMonthLabel}>{formatMonthLabel(activityMonth)}</Text>

              {activityLoading ? (
                <View style={styles.activityLoadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : null}

              {activityError ? (
                <View style={styles.errorCard}>
                  <Text style={styles.errorText}>{activityError}</Text>
                </View>
              ) : null}

              {!activityLoading && !activityError && churchActivity.length === 0 ? (
                <View style={styles.activityEmptyCard}>
                  <Ionicons name="business-outline" size={28} color={GOLD} />
                  <Text style={styles.activityEmptyTitle}>No offline church activations yet.</Text>
                  <Text style={styles.activityEmptyText}>
                    Redeemed activation codes will appear here grouped by church.
                  </Text>
                </View>
              ) : null}

              {!activityLoading && !activityError
                ? churchActivity.map((row) => {
                    const expanded = !!expandedChurches[row.churchId];
                    const trendUp = typeof row.trendPercent === "number" && row.trendPercent > 0;
                    const trendDown = typeof row.trendPercent === "number" && row.trendPercent < 0;
                    const latestDate = row.activations[0]?.redeemedAt || "";

                    return (
                      <View key={row.churchId} style={styles.churchRowCard}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${row.churchName} activations`}
                          onPress={() => toggleChurchExpanded(row.churchId)}
                          style={({ pressed }) => [styles.churchRowHeader, pressed && styles.pressed]}
                        >
                          <View style={styles.churchRowIcon}>
                            <Ionicons name="business-outline" size={18} color={GOLD} />
                          </View>
                          <View style={styles.churchRowCopy}>
                            <Text style={styles.churchRowTitle} numberOfLines={1}>
                              {row.churchName}
                            </Text>
                            <Text style={styles.churchRowMeta}>
                              {formatMonthLabel(row.month)}
                              {latestDate ? ` • ${formatActivationDate(latestDate)}` : ""}
                            </Text>
                            <Text style={styles.churchRowCount}>{row.usedCount} codes used</Text>
                          </View>
                          <View style={styles.churchRowSide}>
                            {typeof row.trendPercent === "number" ? (
                              <View
                                style={[
                                  styles.trendPill,
                                  trendUp && styles.trendPillUp,
                                  trendDown && styles.trendPillDown,
                                ]}
                              >
                                <Ionicons
                                  name={trendUp ? "trending-up" : trendDown ? "trending-down" : "remove-outline"}
                                  size={12}
                                  color={trendUp ? "#6EE7A8" : trendDown ? "#FCA5A5" : MUTED}
                                />
                                <Text
                                  style={[
                                    styles.trendText,
                                    trendUp && styles.trendTextUp,
                                    trendDown && styles.trendTextDown,
                                  ]}
                                >
                                  {row.trendPercent > 0 ? "+" : ""}
                                  {row.trendPercent}%
                                </Text>
                              </View>
                            ) : null}
                            <Ionicons
                              name={expanded ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="rgba(255,255,255,0.45)"
                            />
                          </View>
                        </Pressable>

                        {expanded ? (
                          <View style={styles.churchDetails}>
                            {row.activations.map((activation) => (
                              <View key={`${row.churchId}-${activation.code}`} style={styles.activationDetailCard}>
                                <View style={styles.activationDetailRow}>
                                  <Text style={styles.activationDetailLabel}>Date used</Text>
                                  <Text style={styles.activationDetailValue}>
                                    {formatActivationDate(activation.redeemedAt)}
                                  </Text>
                                </View>
                                <View style={styles.activationDetailRow}>
                                  <Text style={styles.activationDetailLabel}>Code</Text>
                                  <Text style={styles.activationDetailValueMono}>{activation.code}</Text>
                                </View>
                                <View style={styles.activationDetailRow}>
                                  <Text style={styles.activationDetailLabel}>From Supervisor</Text>
                                  <Text style={styles.activationDetailValue}>
                                    {activation.supervisorName || activation.supervisorUserId || "—"}
                                  </Text>
                                </View>
                                <View style={styles.activationDetailRow}>
                                  <Text style={styles.activationDetailLabel}>From Agent</Text>
                                  <Text style={styles.activationDetailValue}>
                                    {activation.agentName || activation.agentUserId || "—"}
                                  </Text>
                                </View>
                                <View style={styles.activationDetailRow}>
                                  <Text style={styles.activationDetailLabel}>Code type</Text>
                                  <Text style={styles.activationDetailValue}>{activation.durationLabel}</Text>
                                </View>
                                <View style={styles.activationDetailRow}>
                                  <Text style={styles.activationDetailLabel}>Status</Text>
                                  <Text style={styles.activationDetailStatus}>{activation.status}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PremiumMetricCard({ metric }: { metric: MetricConfig }) {
  return (
    <View style={[styles.metricCard, { borderColor: metric.glow, shadowColor: metric.color }]}>
      <LinearGradient
        colors={["rgba(255,255,255,0.05)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.metricIconWrap, { backgroundColor: metric.glow }]}>
        <Ionicons name={metric.icon} size={16} color={metric.color} />
      </View>
      <Text style={[styles.metricValue, { color: metric.color }]}>{metric.value}</Text>
      <Text style={styles.metricLabel}>{metric.label}</Text>
      <Text style={styles.metricHelper}>{metric.helper}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  headerGlowPurple: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: PURPLE_GLOW,
    opacity: 0.55,
  },
  headerGlowGold: {
    position: "absolute",
    top: 80,
    left: -60,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.12)",
    opacity: 0.7,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: {
    color: TEXT,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "rgba(244,208,111,0.82)",
    fontSize: 12,
    marginTop: 3,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  headerBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.35)",
  },
  content: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  metricCard: {
    width: "48.5%",
    minHeight: 118,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: GLASS,
    borderWidth: 1,
    overflow: "hidden",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  metricIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  metricValue: { fontSize: 26, fontWeight: "900", letterSpacing: 0.2 },
  metricLabel: { color: TEXT, fontSize: 12, fontWeight: "800", marginTop: 2 },
  metricHelper: { color: MUTED, fontSize: 10, marginTop: 3, fontWeight: "600" },
  supervisorCta: {
    minHeight: 76,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.42)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    shadowColor: GOLD,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  supervisorCtaIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
  },
  supervisorCtaCopy: { flex: 1, minWidth: 0, gap: 3 },
  supervisorCtaTitle: { color: TEXT, fontSize: 16, fontWeight: "900" },
  supervisorCtaSub: { color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: "600", lineHeight: 17 },
  supervisorCtaArrow: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  menuCard: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingRight: 14,
    overflow: "hidden",
    gap: 12,
  },
  menuGoldRail: {
    width: 4,
    alignSelf: "stretch",
    backgroundColor: GOLD,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  menuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  menuCopy: { flex: 1, minWidth: 0, gap: 4 },
  menuTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  menuTitle: { color: TEXT, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  menuBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(156,118,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(156,118,255,0.35)",
  },
  menuBadgeText: {
    color: "rgba(244,208,111,0.95)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  menuSub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  activitySection: {
    marginTop: 6,
    gap: 10,
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  activityTitle: { color: TEXT, fontSize: 17, fontWeight: "900" },
  activitySub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  monthFilterPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.35)",
  },
  monthFilterText: { color: GOLD, fontSize: 11, fontWeight: "800" },
  activityMonthLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: -4,
  },
  activityLoadingWrap: { paddingVertical: 16, alignItems: "center" },
  activityEmptyCard: {
    borderRadius: 18,
    padding: 20,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    gap: 8,
  },
  activityEmptyTitle: { color: TEXT, fontSize: 15, fontWeight: "800", textAlign: "center" },
  activityEmptyText: { color: MUTED, fontSize: 12, textAlign: "center", lineHeight: 18 },
  churchRowCard: {
    borderRadius: 18,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  churchRowHeader: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  churchRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  churchRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  churchRowTitle: { color: TEXT, fontSize: 15, fontWeight: "800" },
  churchRowMeta: { color: MUTED, fontSize: 11, fontWeight: "600" },
  churchRowCount: { color: "rgba(244,208,111,0.88)", fontSize: 11, fontWeight: "800", marginTop: 2 },
  churchRowSide: { alignItems: "flex-end", gap: 8 },
  trendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  trendPillUp: {
    backgroundColor: "rgba(110,231,168,0.10)",
    borderColor: "rgba(110,231,168,0.25)",
  },
  trendPillDown: {
    backgroundColor: "rgba(252,165,165,0.10)",
    borderColor: "rgba(252,165,165,0.25)",
  },
  trendText: { color: MUTED, fontSize: 10, fontWeight: "800" },
  trendTextUp: { color: "#6EE7A8" },
  trendTextDown: { color: "#FCA5A5" },
  churchDetails: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    padding: 12,
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  activationDetailCard: {
    borderRadius: 14,
    padding: 12,
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  activationDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  activationDetailLabel: { color: MUTED, fontSize: 11, fontWeight: "700", flex: 1 },
  activationDetailValue: {
    color: TEXT,
    fontSize: 11,
    fontWeight: "700",
    flex: 1.2,
    textAlign: "right",
  },
  activationDetailValueMono: {
    color: TEXT,
    fontSize: 11,
    fontWeight: "800",
    flex: 1.2,
    textAlign: "right",
    letterSpacing: 0.3,
  },
  activationDetailStatus: {
    color: "#6EE7A8",
    fontSize: 11,
    fontWeight: "800",
    flex: 1.2,
    textAlign: "right",
  },
  pressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
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
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    gap: 8,
  },
  noticeTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
