import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  assignSafetyReportsToSupervisorByQuantity,
  fetchSafetySupervisors,
  fetchSafetySystemAdminDashboard,
  type SafetySupervisorSummary,
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

  const [
    supervisors,
    setSupervisors,
  ] = React.useState<
    SafetySupervisorSummary[]
  >([]);

  const [
    supervisorsLoading,
    setSupervisorsLoading,
  ] = React.useState(true);

  const [
    assignTarget,
    setAssignTarget,
  ] = React.useState<
    SafetySupervisorSummary | null
  >(null);

  const [
    assignQuantity,
    setAssignQuantity,
  ] = React.useState("");

  const [
    assigningReports,
    setAssigningReports,
  ] = React.useState(false);

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

  const loadSupervisors =
    React.useCallback(async () => {
      if (!allowed) {
        setSupervisorsLoading(false);
        return;
      }

      setSupervisorsLoading(true);

      try {
        const result =
          await fetchSafetySupervisors();

        setSupervisors(
          result.supervisors
        );

        console.log(
          "KRISTO_SAFETY_SYSTEM_ADMIN_SUPERVISORS_LOADED",
          {
            count:
              result.supervisors.length,
          }
        );
      } catch (error: any) {
        console.log(
          "KRISTO_SAFETY_SYSTEM_ADMIN_SUPERVISORS_FAILED",
          {
            error: String(
              error?.message || error
            ),
          }
        );
      } finally {
        setSupervisorsLoading(false);
      }
    }, [allowed]);

  React.useEffect(() => {
    void loadSupervisors();
  }, [loadSupervisors]);

  const highestWorkloadSupervisor =
    React.useMemo(() => {
      return [...supervisors].sort(
        (a, b) =>
          Number(
            b?.counts?.open || 0
          ) -
          Number(
            a?.counts?.open || 0
          )
      )[0] || null;
    }, [supervisors]);

  const submitReportAssignment =
    React.useCallback(async () => {
      if (
        !assignTarget ||
        assigningReports
      ) {
        return;
      }

      const quantity =
        Math.floor(
          Number(assignQuantity) || 0
        );

      const available =
        Number(
          systemDashboard?.counts
            ?.open || 0
        );

      if (
        quantity < 1 ||
        quantity > available
      ) {
        Alert.alert(
          "Invalid quantity",
          `Enter a number between 1 and ${available}.`
        );
        return;
      }

      setAssigningReports(true);

      try {
        const result =
          await assignSafetyReportsToSupervisorByQuantity({
            supervisorUserId:
              assignTarget.userId,

            quantity,
          });

        setAssignTarget(null);
        setAssignQuantity("");

        await Promise.all([
          loadSystemDashboard(),
          loadSupervisors(),
        ]);

        Alert.alert(
          "Reports assigned",
          `${result.assignment.assignedCount} reports were assigned successfully.`
        );
      } catch (error: any) {
        Alert.alert(
          "Could not assign reports",
          String(
            error?.message ||
              "Please try again."
          )
        );
      } finally {
        setAssigningReports(false);
      }
    }, [
      assignTarget,
      assigningReports,
      assignQuantity,
      systemDashboard,
      loadSystemDashboard,
      loadSupervisors,
    ]);

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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Report Queue"
              onPress={() =>
                router.push(
                  "/more/system-admin/report-center/queue" as any
                )
              }
              style={({ pressed }) => ({
                opacity: pressed ? 0.76 : 1,
              })}
            >
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
                  VIEW
                </Text>
              </View>
            </GlassCard>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add Safety Supervisor"
              onPress={() =>
                router.push(
                  "/more/system-admin/report-center/supervisors?add=1" as any
                )
              }
              style={({ pressed }) => ({
                marginTop: 18,
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <GlassCard
                style={styles.addSupervisorCard}
                borderColor=
                  "rgba(167,139,250,0.36)"
              >
                <View style={styles.addSupervisorIcon}>
                  <Ionicons
                    name="person-add-outline"
                    size={25}
                    color="#DDD6FE"
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.addSupervisorTitle}>
                    Add Supervisor
                  </Text>

                  <Text style={styles.addSupervisorSubtitle}>
                    Invite and empower a trusted supervisor.
                  </Text>
                </View>

                <View style={styles.addSupervisorAction}>
                  <Ionicons
                    name="add"
                    size={27}
                    color="#DDD6FE"
                  />
                </View>
              </GlassCard>
            </Pressable>

            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={styles.sectionHeading}>
                  Safety Supervisors
                </Text>

                <Text style={styles.sectionCount}>
                  {supervisors.length} active
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  router.push(
                    "/more/system-admin/report-center/supervisors" as any
                  )
                }
              >
                <Text style={styles.viewAllText}>
                  View all
                </Text>
              </Pressable>
            </View>

            {supervisorsLoading ? (
              <View style={styles.supervisorLoading}>
                <ActivityIndicator
                  color={PURPLE}
                />
              </View>
            ) : supervisors.length ? (
              <View style={styles.supervisorList}>
                {supervisors
                  .slice(0, 4)
                  .map((supervisor) => {
                    const counts =
                      supervisor.counts || {
                        assigned: 0,
                        open: 0,
                        inReview: 0,
                        resolved: 0,
                        highPriority: 0,
                        escalated: 0,
                        activeAgents: 0,
                        pendingAgents: 0,
                        totalAssigned: 0,
                      };

                    const name =
                      String(
                        supervisor.fullName ||
                        ""
                      ).trim() ||
                      "Safety Supervisor";

                    const kristoId =
                      String(
                        supervisor.kristoId ||
                        ""
                      )
                        .trim()
                        .toUpperCase() ||
                      "—";

                    const churchId =
                      String(
                        supervisor.churchId ||
                        ""
                      )
                        .trim()
                        .toUpperCase() ||
                      "Church ID unavailable";

                    const avatarUri =
                      String(
                        supervisor.avatarUrl ||
                        supervisor.avatarUri ||
                        ""
                      ).trim();

                    return (
                      <GlassCard
                        key={supervisor.userId}
                        style={styles.supervisorCard}
                      >
                        <Pressable
                          onPress={() =>
                            router.push(
                              (
                                "/more/system-admin/report-center/supervisors/" +
                                encodeURIComponent(
                                  supervisor.userId
                                )
                              ) as any
                            )
                          }
                          style={styles.supervisorMain}
                        >
                          <View style={styles.supervisorAvatar}>
                            {avatarUri ? (
                              <Image
                                source={{
                                  uri: avatarUri,
                                }}
                                resizeMode="cover"
                                style={styles.supervisorAvatarImage}
                              />
                            ) : (
                              <Text style={styles.supervisorInitial}>
                                {String(name)
                                  .trim()
                                  .split(/\s+/)
                                  .slice(0, 2)
                                  .map((part) =>
                                    part
                                      .charAt(0)
                                      .toUpperCase()
                                  )
                                  .join("") ||
                                  "S"}
                              </Text>
                            )}

                            <View style={styles.activeDot} />
                          </View>

                          <View
                            style={styles.supervisorIdentity}
                          >
                            <View style={styles.supervisorNameRow}>
                              <Text
                                numberOfLines={1}
                                style={styles.supervisorName}
                              >
                                {name}
                              </Text>

                              <View style={styles.activeBadge}>
                                <Text style={styles.activeBadgeText}>
                                  Active
                                </Text>
                              </View>
                            </View>

                            <Text
                              numberOfLines={1}
                              style={styles.supervisorKristoId}
                            >
                              KRISTO ID: {kristoId}
                            </Text>

                            <Text
                              numberOfLines={1}
                              style={styles.supervisorChurch}
                            >
                              Church ID: {churchId}
                            </Text>
                          </View>

                          <Ionicons
                            name="chevron-forward"
                            size={17}
                            color="rgba(255,255,255,0.34)"
                          />
                        </Pressable>

                        <View style={styles.supervisorStats}>
                          <View style={styles.supervisorStat}>
                            <Text
                              style={[
                                styles.supervisorStatValue,
                                { color: BLUE },
                              ]}
                            >
                              {counts.totalAssigned}
                            </Text>

                            <Text style={styles.supervisorStatLabel}>
                              Assigned
                            </Text>
                          </View>

                          <View style={styles.supervisorStat}>
                            <Text
                              style={[
                                styles.supervisorStatValue,
                                { color: GOLD },
                              ]}
                            >
                              {counts.open}
                            </Text>

                            <Text style={styles.supervisorStatLabel}>
                              Open
                            </Text>
                          </View>

                          <View style={styles.supervisorStat}>
                            <Text
                              style={[
                                styles.supervisorStatValue,
                                { color: GREEN },
                              ]}
                            >
                              {counts.resolved}
                            </Text>

                            <Text style={styles.supervisorStatLabel}>
                              Resolved
                            </Text>
                          </View>

                          <View style={styles.supervisorStat}>
                            <Text
                              style={[
                                styles.supervisorStatValue,
                                { color: PURPLE },
                              ]}
                            >
                              {counts.activeAgents}
                            </Text>

                            <Text style={styles.supervisorStatLabel}>
                              Agents
                            </Text>
                          </View>
                        </View>

                        <Pressable
                          disabled={
                            Number(
                              systemDashboard?.counts
                                ?.open || 0
                            ) < 1
                          }
                          onPress={() => {
                            setAssignTarget(
                              supervisor
                            );

                            setAssignQuantity("");
                          }}
                          style={({ pressed }) => [
                            styles.assignReportsButton,

                            pressed && {
                              opacity: 0.72,
                            },

                            Number(
                              systemDashboard?.counts
                                ?.open || 0
                            ) < 1 && {
                              opacity: 0.42,
                            },
                          ]}
                        >
                          <Ionicons
                            name="layers-outline"
                            size={17}
                            color="#DDD6FE"
                          />

                          <Text style={styles.assignReportsText}>
                            Assign
                          </Text>
                        </Pressable>
                      </GlassCard>
                    );
                  })}
              </View>
            ) : (
              <GlassCard style={styles.emptySupervisorCard}>
                <Ionicons
                  name="people-outline"
                  size={30}
                  color={PURPLE}
                />

                <Text style={styles.emptySupervisorTitle}>
                  No active supervisors
                </Text>

                <Text style={styles.emptySupervisorText}>
                  Add a supervisor to start distributing reports.
                </Text>
              </GlassCard>
            )}

            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={styles.sectionHeading}>
                  Platform Analysis
                </Text>

                <Text style={styles.sectionCount}>
                  Global Report Center overview
                </Text>
              </View>
            </View>

            <GlassCard
              style={styles.analysisCard}
              borderColor=
                "rgba(110,231,183,0.23)"
            >
              <View style={styles.analysisGrid}>
                <View style={styles.analysisMetric}>
                  <Text style={styles.analysisValue}>
                    {systemDashboard?.counts?.total || 0}
                  </Text>

                  <Text style={styles.analysisLabel}>
                    Total Reports
                  </Text>
                </View>

                <View style={styles.analysisMetric}>
                  <Text
                    style={[
                      styles.analysisValue,
                      { color: GOLD },
                    ]}
                  >
                    {systemDashboard?.counts?.open || 0}
                  </Text>

                  <Text style={styles.analysisLabel}>
                    Unassigned
                  </Text>
                </View>

                <View style={styles.analysisMetric}>
                  <Text
                    style={[
                      styles.analysisValue,
                      { color: BLUE },
                    ]}
                  >
                    {systemDashboard?.counts?.assigned || 0}
                  </Text>

                  <Text style={styles.analysisLabel}>
                    With Supervisors
                  </Text>
                </View>

                <View style={styles.analysisMetric}>
                  <Text
                    style={[
                      styles.analysisValue,
                      { color: GREEN },
                    ]}
                  >
                    {systemDashboard?.counts?.resolved || 0}
                  </Text>

                  <Text style={styles.analysisLabel}>
                    Resolved
                  </Text>
                </View>
              </View>

              <View style={styles.analysisDivider} />

              <View style={styles.workloadRow}>
                <View style={styles.workloadIcon}>
                  <Ionicons
                    name="analytics-outline"
                    size={21}
                    color={PURPLE}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.workloadLabel}>
                    Highest workload
                  </Text>

                  <Text style={styles.workloadName}>
                    {highestWorkloadSupervisor
                      ? (
                          highestWorkloadSupervisor.fullName ||
                          highestWorkloadSupervisor.kristoId ||
                          "Safety Supervisor"
                        )
                      : "No supervisor data"}
                  </Text>
                </View>

                <Text style={styles.workloadValue}>
                  {highestWorkloadSupervisor
                    ?.counts?.open || 0} open
                </Text>
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
      <Modal
        visible={Boolean(assignTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!assigningReports) {
            setAssignTarget(null);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.assignModalCard}>
            <View style={styles.assignModalIcon}>
              <Ionicons
                name="layers-outline"
                size={25}
                color="#DDD6FE"
              />
            </View>

            <Text style={styles.assignModalTitle}>
              Assign Reports
            </Text>

            <Text style={styles.assignModalSupervisor}>
              {assignTarget?.fullName ||
                "Safety Supervisor"}
            </Text>

            <Text style={styles.assignModalIdentity}>
              {[
                assignTarget?.kristoId
                  ? `KRISTO ID: ${assignTarget.kristoId}`
                  : "",
                assignTarget?.churchId
                  ? `Church ID: ${assignTarget.churchId}`
                  : "",
              ]
                .filter(Boolean)
                .join("  •  ")}
            </Text>

            <View style={styles.availableBox}>
              <Text style={styles.availableLabel}>
                Available reports
              </Text>

              <Text style={styles.availableValue}>
                {systemDashboard?.counts?.open || 0}
              </Text>
            </View>

            <Text style={styles.quantityLabel}>
              Quantity
            </Text>

            <TextInput
              value={assignQuantity}
              onChangeText={(value) =>
                setAssignQuantity(
                  value.replace(
                    /[^0-9]/g,
                    ""
                  )
                )
              }
              keyboardType="number-pad"
              placeholder="Enter quantity"
              placeholderTextColor=
                "rgba(255,255,255,0.34)"
              style={styles.quantityInput}
            />

            <View style={styles.modalActions}>
              <Pressable
                disabled={assigningReports}
                onPress={() =>
                  setAssignTarget(null)
                }
                style={styles.modalCancel}
              >
                <Text style={styles.modalCancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={assigningReports}
                onPress={() =>
                  void submitReportAssignment()
                }
                style={({ pressed }) => [
                  styles.modalConfirm,

                  pressed && {
                    opacity: 0.76,
                  },
                ]}
              >
                {assigningReports ? (
                  <ActivityIndicator
                    color="#090D16"
                  />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    Assign
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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

  addSupervisorCard: {
    minHeight: 105,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  addSupervisorIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(139,92,246,0.18)",
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.36)",
  },

  addSupervisorTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },

  addSupervisorSubtitle: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },

  addSupervisorAction: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(139,92,246,0.16)",
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.34)",
  },

  sectionHeaderRow: {
    marginTop: 26,
    marginBottom: 11,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },

  sectionHeading: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "900",
  },

  sectionCount: {
    marginTop: 3,
    color: "#C4B5FD",
    fontSize: 11,
    fontWeight: "700",
  },

  viewAllText: {
    color: "#C4B5FD",
    fontSize: 12,
    fontWeight: "800",
  },

  supervisorLoading: {
    paddingVertical: 24,
    alignItems: "center",
  },

  supervisorList: {
    gap: 8,
  },

  supervisorCard: {
    paddingHorizontal: 12,
    paddingVertical: 11,
  },

  supervisorMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  supervisorAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(139,92,246,0.19)",
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.42)",
  },

  supervisorAvatarImage: {
    width: "100%",
    height: "100%",
  },

  supervisorIdentity: {
    flex: 1,
    minWidth: 0,
  },

  supervisorNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  activeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor:
      "rgba(110,231,183,0.11)",
    borderWidth: 1,
    borderColor:
      "rgba(110,231,183,0.30)",
  },

  activeBadgeText: {
    color: "#86EFAC",
    fontSize: 8,
    lineHeight: 10,
    fontWeight: "900",
  },

  supervisorInitial: {
    color: "#E9D5FF",
    fontSize: 20,
    fontWeight: "900",
  },

  activeDot: {
    position: "absolute",
    right: 0,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: GREEN,
    borderWidth: 2,
    borderColor: "#151927",
  },

  supervisorName: {
    flexShrink: 1,
    color: TEXT,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },

  supervisorKristoId: {
    marginTop: 3,
    color: "#C4B5FD",
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
  },

  supervisorChurch: {
    marginTop: 1,
    color: MUTED,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "700",
  },

  supervisorStats: {
    marginTop: 9,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor:
      "rgba(255,255,255,0.075)",
    flexDirection: "row",
    justifyContent: "space-between",
  },

  supervisorStat: {
    flex: 1,
    alignItems: "center",
  },

  supervisorStatValue: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900",
  },

  supervisorStatLabel: {
    marginTop: 1,
    color:
      "rgba(255,255,255,0.48)",
    fontSize: 8,
    lineHeight: 10,
    fontWeight: "800",
  },

  assignReportsButton: {
    alignSelf: "flex-end",
    marginTop: 9,
    minHeight: 34,
    minWidth: 94,
    paddingHorizontal: 13,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor:
      "rgba(139,92,246,0.16)",
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.38)",
  },

  assignReportsText: {
    color: "#DDD6FE",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.35,
  },

  emptySupervisorCard: {
    padding: 22,
    alignItems: "center",
  },

  emptySupervisorTitle: {
    marginTop: 10,
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },

  emptySupervisorText: {
    marginTop: 6,
    color: MUTED,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "600",
  },

  analysisCard: {
    padding: 16,
  },

  analysisGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  analysisMetric: {
    width: "47%",
    padding: 12,
    borderRadius: 16,
    backgroundColor:
      "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.075)",
  },

  analysisValue: {
    color: TEXT,
    fontSize: 24,
    fontWeight: "900",
  },

  analysisLabel: {
    marginTop: 4,
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
  },

  analysisDivider: {
    height: 1,
    marginVertical: 16,
    backgroundColor:
      "rgba(255,255,255,0.075)",
  },

  workloadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  workloadIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(139,92,246,0.15)",
  },

  workloadLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
  },

  workloadName: {
    marginTop: 3,
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },

  workloadValue: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },

  modalBackdrop: {
    flex: 1,
    padding: 22,
    justifyContent: "center",
    backgroundColor:
      "rgba(0,0,0,0.72)",
  },

  assignModalCard: {
    padding: 20,
    borderRadius: 25,
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.38)",
    backgroundColor: "#171A29",
  },

  assignModalIcon: {
    width: 54,
    height: 54,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(139,92,246,0.17)",
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.35)",
  },

  assignModalTitle: {
    marginTop: 16,
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
  },

  assignModalSupervisor: {
    marginTop: 5,
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },

  assignModalIdentity: {
    marginTop: 4,
    color: "#C4B5FD",
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
  },

  availableBox: {
    marginTop: 18,
    padding: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor:
      "rgba(244,208,111,0.08)",
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.23)",
  },

  availableLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },

  availableValue: {
    color: GOLD,
    fontSize: 22,
    fontWeight: "900",
  },

  quantityLabel: {
    marginTop: 18,
    marginBottom: 8,
    color: TEXT,
    fontSize: 12,
    fontWeight: "800",
  },

  quantityInput: {
    minHeight: 52,
    paddingHorizontal: 15,
    borderRadius: 16,
    color: TEXT,
    fontSize: 17,
    fontWeight: "800",
    backgroundColor:
      "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.12)",
  },

  modalActions: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
  },

  modalCancel: {
    minHeight: 45,
    paddingHorizontal: 17,
    alignItems: "center",
    justifyContent: "center",
  },

  modalCancelText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "800",
  },

  modalConfirm: {
    minWidth: 110,
    minHeight: 45,
    paddingHorizontal: 20,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },

  modalConfirmText: {
    color: "#090D16",
    fontSize: 13,
    fontWeight: "900",
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
