import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useRouter,
} from "expo-router";
import {
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import {
  BlurView,
} from "expo-blur";
import {
  LinearGradient,
} from "expo-linear-gradient";
import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  getSessionSync,
} from "@/src/lib/kristoSession";
import {
  hasOfflineActivationRole,
} from "@/src/lib/offlineActivationCodes";
import {
  resolveSessionPlatformRole,
} from "@/src/lib/platformRole";

import {
  fetchSafetySystemAdminDashboard,
  type SafetySystemAdminDashboardResponse,
} from "@/src/lib/safetyAdminApi";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.60)";
const GOLD = "#F4D06F";
const PURPLE = "#A78BFA";
const GREEN = "#6EE7B7";
const RED = "#FB7185";
const BLUE = "#93C5FD";

type Metric = {
  key: string;
  label: string;
  helper: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  glow: string;
};

function BackgroundScene() {
  return (
    <>
      <LinearGradient
        colors={[
          "#1D143B",
          "#111321",
          "#090D16",
          BG,
        ]}
        locations={[0, 0.28, 0.64, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -80,
          right: -90,
          width: 310,
          height: 310,
          borderRadius: 155,
          backgroundColor:
            "rgba(139,92,246,0.17)",
        }}
      />

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: 100,
          left: -110,
          width: 290,
          height: 290,
          borderRadius: 145,
          backgroundColor:
            "rgba(244,208,111,0.08)",
        }}
      />
    </>
  );
}

function GlassCard({
  children,
  style,
  borderColor =
    "rgba(255,255,255,0.12)",
}: {
  children: React.ReactNode;
  style?: object;
  borderColor?: string;
}) {
  return (
    <View
      style={[
        {
          overflow: "hidden",
          borderRadius: 22,
          borderWidth: 1,
          borderColor,
          backgroundColor:
            "rgba(255,255,255,0.055)",
        },
        style,
      ]}
    >
      <BlurView
        intensity={48}
        tint="dark"
        style={StyleSheet.absoluteFillObject}
      />

      <LinearGradient
        pointerEvents="none"
        colors={[
          "rgba(255,255,255,0.12)",
          "rgba(255,255,255,0.02)",
          "transparent",
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.8 }}
        style={StyleSheet.absoluteFillObject}
      />

      {children}
    </View>
  );
}

export default function ReportCenterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session =
    getSessionSync() as any;

  const platformRole =
    resolveSessionPlatformRole(session);

  const allowed =
    hasOfflineActivationRole(
      platformRole || "",
      "System_Admin"
    );


  const [
    systemDashboard,
    setSystemDashboard,
  ] = React.useState<
    SafetySystemAdminDashboardResponse | null
  >(null);

  const [
    systemDashboardLoading,
    setSystemDashboardLoading,
  ] = React.useState(true);

  const [
    systemDashboardError,
    setSystemDashboardError,
  ] = React.useState("");

  const loadSystemDashboard =
    React.useCallback(async () => {
      if (!allowed) {
        setSystemDashboardLoading(false);
        return;
      }

      setSystemDashboardError("");
      setSystemDashboardLoading(true);

      try {
        const result =
          await fetchSafetySystemAdminDashboard();

        setSystemDashboard(result);

        console.log(
          "KRISTO_SAFETY_SYSTEM_ADMIN_COUNTS_LOADED",
          result.counts
        );
      } catch (error: any) {
        const message =
          String(
            error?.message ||
              "Could not load reports."
          );

        setSystemDashboardError(
          message
        );

        console.log(
          "KRISTO_SAFETY_SYSTEM_ADMIN_COUNTS_FAILED",
          {
            error: message,
          }
        );
      } finally {
        setSystemDashboardLoading(
          false
        );
      }
    }, [allowed]);

  React.useEffect(() => {
    void loadSystemDashboard();
  }, [loadSystemDashboard]);

  const resolveSystemMetricValue =
    React.useCallback(
      (metric: any) => {
        const label =
          String(
            metric?.label || ""
          ).trim();

        const counts =
          systemDashboard?.counts;

        if (!counts) {
          return 0;
        }

        if (label === "Open Reports") {
          return counts.open;
        }

        if (label === "Assigned") {
          return counts.assigned;
        }

        if (
          label === "High Priority"
        ) {
          return counts.highPriority;
        }

        if (label === "Resolved") {
          return counts.resolved;
        }

        return Number(
          metric?.value || 0
        );
      },
      [systemDashboard]
    );

  /*
   * V1 placeholders.
   * These will hydrate from the Report Center API
   * when the report store and assignment engine
   * are connected.
   */
  const metrics: Metric[] = [
    {
      key: "open",
      label: "Open Reports",
      helper: "Waiting for review",
      value: 0,
      icon: "flag-outline",
      color: GOLD,
      glow: "rgba(244,208,111,0.17)",
    },
    {
      key: "assigned",
      label: "Assigned",
      helper: "With safety team",
      value: 0,
      icon: "people-outline",
      color: BLUE,
      glow: "rgba(147,197,253,0.17)",
    },
    {
      key: "priority",
      label: "High Priority",
      helper: "Needs fast action",
      value: 0,
      icon: "warning-outline",
      color: RED,
      glow: "rgba(251,113,133,0.17)",
    },
    {
      key: "resolved",
      label: "Resolved",
      helper: "Completed today",
      value: 0,
      icon: "checkmark-done-outline",
      color: GREEN,
      glow: "rgba(110,231,183,0.17)",
    },
  ];

  return (
    <View style={styles.screen}>
      <BackgroundScene />

      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 12,
          },
        ]}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed && {
                opacity: 0.76,
              },
            ]}
          >
            <BlurView
              intensity={42}
              tint="dark"
              style={StyleSheet.absoluteFillObject}
            />

            <Ionicons
              name="chevron-back"
              size={25}
              color="#FFFFFF"
            />
          </Pressable>

          <View
            style={{
              flex: 1,
              flexDirection: "row",
              gap: 8,
            }}
          >
            <Pressable
              onPress={() =>
                router.replace(
                  "/more/system-admin" as any
                )
              }
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                overflow: "hidden",
                borderRadius: 16,
                borderWidth: 1,
                borderColor:
                  "rgba(255,255,255,0.13)",
                backgroundColor: pressed
                  ? "rgba(244,208,111,0.12)"
                  : "rgba(255,255,255,0.05)",
              })}
            >
              <BlurView
                intensity={38}
                tint="dark"
                style={StyleSheet.absoluteFillObject}
              />

              <View style={styles.moduleInner}>
                <Ionicons
                  name="business-outline"
                  size={17}
                  color="rgba(255,255,255,0.72)"
                />

                <Text
                  numberOfLines={1}
                  style={styles.moduleText}
                >
                  Church Activation
                </Text>
              </View>
            </Pressable>

            <View
              style={{
                flex: 1,
                minHeight: 48,
                overflow: "hidden",
                borderRadius: 16,
                borderWidth: 1,
                borderColor:
                  "rgba(167,139,250,0.50)",
                backgroundColor:
                  "rgba(139,92,246,0.16)",
              }}
            >
              <BlurView
                intensity={40}
                tint="dark"
                style={StyleSheet.absoluteFillObject}
              />

              <View style={styles.moduleInner}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={17}
                  color="#C4B5FD"
                />

                <Text
                  numberOfLines={1}
                  style={[
                    styles.moduleText,
                    {
                      color: "#DDD6FE",
                    },
                  ]}
                >
                  Report Center
                </Text>
              </View>
            </View>
          </View>
        </View>

        <GlassCard
          style={styles.hero}
          borderColor=
            "rgba(167,139,250,0.34)"
        >
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>
                Report Center
              </Text>

              <Text style={styles.heroSubtitle}>
                Safety & Moderation Control Center
              </Text>
            </View>

            <View style={styles.heroIcon}>
              <MaterialCommunityIcons
                name="shield-alert-outline"
                size={28}
                color="#DDD6FE"
              />
            </View>
          </View>
        </GlassCard>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom:
            insets.bottom + 38,
        }}
      >
        {!allowed ? (
          <GlassCard style={styles.restricted}>
            <Ionicons
              name="lock-closed-outline"
              size={25}
              color={GOLD}
            />

            <Text style={styles.restrictedTitle}>
              Access restricted
            </Text>

            <Text style={styles.restrictedText}>
              Report Center is currently available
              only to the System Admin.
            </Text>
          </GlassCard>
        ) : (
          <>
            {systemDashboardLoading ? (
              <Text
                style={{
                  marginBottom: 12,
                  color:
                    "rgba(255,255,255,0.58)",
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                Loading platform reports…
              </Text>
            ) : null}

            {systemDashboardError ? (
              <Pressable
                onPress={() =>
                  void loadSystemDashboard()
                }
                style={{
                  marginBottom: 12,
                  padding: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor:
                    "rgba(251,113,133,0.30)",
                  backgroundColor:
                    "rgba(251,113,133,0.08)",
                }}
              >
                <Text
                  style={{
                    color: "#FDA4AF",
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  {systemDashboardError}
                </Text>

                <Text
                  style={{
                    marginTop: 3,
                    color:
                      "rgba(255,255,255,0.55)",
                    fontSize: 10,
                    fontWeight: "700",
                  }}
                >
                  Tap to try again
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.metricsGrid}>
              {metrics.map((metric) => (
                <GlassCard
                  key={metric.key}
                  style={styles.metricCard}
                  borderColor={metric.glow}
                >
                  <View
                    style={[
                      styles.metricIcon,
                      {
                        backgroundColor:
                          metric.glow,
                      },
                    ]}
                  >
                    <Ionicons
                      name={metric.icon}
                      size={22}
                      color={metric.color}
                    />
                  </View>

                  <Text
                    style={[
                      styles.metricValue,
                      {
                        color:
                          metric.color,
                      },
                    ]}
                  >
                    {resolveSystemMetricValue(
                      metric
                    )}
                  </Text>

                  <Text style={styles.metricLabel}>
                    {metric.label}
                  </Text>

                  <Text style={styles.metricHelper}>
                    {metric.helper}
                  </Text>
                </GlassCard>
              ))}
            </View>

            <GlassCard
              style={styles.primaryAction}
              borderColor=
                "rgba(244,208,111,0.30)"
            >
              <View style={styles.primaryIcon}>
                <Ionicons
                  name="file-tray-full-outline"
                  size={25}
                  color={GOLD}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.primaryTitle}>
                  Report Queue
                </Text>

                <Text style={styles.primarySubtitle}>
                  Review new, assigned, escalated and
                  resolved reports.
                </Text>
              </View>

              <View style={styles.comingBadge}>
                <Text style={styles.comingBadgeText}>
                  NEXT
                </Text>
              </View>
            </GlassCard>

            <Text style={styles.sectionTitle}>
              Safety Team
            </Text>

            <GlassCard style={styles.teamCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Safety Supervisors"
                onPress={() =>
                  router.push(
                    "/more/system-admin/report-center/supervisors" as any
                  )
                }
                style={({ pressed }) => [
                  styles.teamRow,
                  pressed && {
                    opacity: 0.72,
                  },
                ]}
              >
                <View
                  style={[
                    styles.teamIcon,
                    {
                      backgroundColor:
                        "rgba(167,139,250,0.14)",
                    },
                  ]}
                >
                  <Ionicons
                    name="people-circle-outline"
                    size={24}
                    color="#C4B5FD"
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.teamTitle}>
                    Safety Supervisors
                  </Text>

                  <Text style={styles.teamSubtitle}>
                    Supervisors can review reports,
                    manage agents and escalate cases.
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color="rgba(255,255,255,0.35)"
                />
              </Pressable>

              <View style={styles.divider} />

              <View style={styles.teamRow}>
                <View
                  style={[
                    styles.teamIcon,
                    {
                      backgroundColor:
                        "rgba(147,197,253,0.13)",
                    },
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={23}
                    color={BLUE}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.teamTitle}>
                    Safety Agents
                  </Text>

                  <Text style={styles.teamSubtitle}>
                    New reports will be assigned to
                    eligible agents with the lowest
                    workload.
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color="rgba(255,255,255,0.35)"
                />
              </View>
            </GlassCard>

            <GlassCard
              style={styles.infoCard}
              borderColor=
                "rgba(110,231,183,0.22)"
            >
              <Ionicons
                name="git-network-outline"
                size={24}
                color={GREEN}
              />

              <View style={{ flex: 1 }}>
                <Text style={styles.infoTitle}>
                  Automatic workload distribution
                </Text>

                <Text style={styles.infoText}>
                  Reports will be routed to available
                  agents with fewer open cases.
                  High-priority reports will go to a
                  supervisor or System Admin.
                </Text>
              </View>
            </GlassCard>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    paddingHorizontal: 16,
    gap: 14,
  },

  backButton: {
    width: 50,
    height: 50,
    overflow: "hidden",
    borderRadius: 17,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.13)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.05)",
  },

  moduleInner: {
    flex: 1,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  moduleText: {
    color: "rgba(255,255,255,0.77)",
    fontSize: 11,
    fontWeight: "900",
  },

  hero: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },

  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  heroTitle: {
    color: TEXT,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "900",
  },

  heroSubtitle: {
    marginTop: 6,
    color: "#C4B5FD",
    fontSize: 14,
    fontWeight: "800",
  },

  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.38)",
    backgroundColor:
      "rgba(139,92,246,0.14)",
  },

  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },

  metricCard: {
    width: "48%",
    minHeight: 170,
    padding: 16,
  },

  metricIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },

  metricValue: {
    marginTop: 21,
    fontSize: 36,
    fontWeight: "900",
  },

  metricLabel: {
    marginTop: 5,
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },

  metricHelper: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },

  primaryAction: {
    marginTop: 16,
    padding: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  primaryIcon: {
    width: 54,
    height: 54,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.26)",
  },

  primaryTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },

  primarySubtitle: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },

  comingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor:
      "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.28)",
  },

  comingBadgeText: {
    color: GOLD,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "900",
  },

  sectionTitle: {
    marginTop: 24,
    marginBottom: 10,
    color: GOLD,
    fontSize: 17,
    letterSpacing: 0.7,
    fontWeight: "900",
  },

  teamCard: {
    paddingHorizontal: 16,
  },

  teamRow: {
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },

  teamIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },

  teamTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },

  teamSubtitle: {
    marginTop: 4,
    color: MUTED,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "600",
  },

  divider: {
    height: 1,
    backgroundColor:
      "rgba(255,255,255,0.075)",
  },

  infoCard: {
    marginTop: 16,
    padding: 17,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 13,
  },

  infoTitle: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },

  infoText: {
    marginTop: 5,
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: "600",
  },

  restricted: {
    padding: 22,
    alignItems: "center",
  },

  restrictedTitle: {
    marginTop: 13,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },

  restrictedText: {
    marginTop: 8,
    color: MUTED,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
});
