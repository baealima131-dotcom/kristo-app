import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useFocusEffect,
  useRouter,
} from "expo-router";
import {
  Ionicons,
} from "@expo/vector-icons";
import {
  LinearGradient,
} from "expo-linear-gradient";
import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  fetchSafetyAccess,
  fetchSafetySupervisorDashboard,
  type SafetyAccessResponse,
  type SafetySupervisorDashboardResponse,
} from "@/src/lib/safetyAdminApi";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.60)";

export default function SafetySupervisorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [
    access,
    setAccess,
  ] = React.useState<
    SafetyAccessResponse | null
  >(null);

  const [loading, setLoading] =
    React.useState(true);

  const [error, setError] =
    React.useState("");

  const [
    dashboard,
    setDashboard,
  ] = React.useState<
    SafetySupervisorDashboardResponse | null
  >(null);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      setLoading(true);
      setError("");

      void Promise.all([
        fetchSafetyAccess(),
        fetchSafetySupervisorDashboard(),
      ])
        .then(
          ([
            accessResult,
            dashboardResult,
          ]) => {
            if (cancelled) return;

            setAccess(accessResult);
            setDashboard(
              dashboardResult
            );

            console.log(
              "KRISTO_SAFETY_SUPERVISOR_DASHBOARD_LOADED",
              {
                assigned:
                  dashboardResult
                    .counts.assigned,
                open:
                  dashboardResult
                    .counts.open,
                resolved:
                  dashboardResult
                    .counts.resolved,
                agentCount:
                  dashboardResult
                    .agents.length,
              }
            );
          }
        )
        .catch((reason: any) => {
          if (cancelled) return;

          setError(
            String(
              reason?.message ||
                "Could not load Safety workspace."
            )
          );
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [])
  );

  const allowed =
    access?.isSafetySupervisor === true;

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[
          "#28194B",
          "#111927",
          BG,
        ]}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 12,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={29}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Safety Supervisor
          </Text>

          <Text style={styles.headerSub}>
            Report Center workspace
          </Text>
        </View>

        <View style={styles.shield}>
          <Ionicons
            name="shield-checkmark-outline"
            size={27}
            color={GOLD}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={GOLD}
          />

          <Text style={styles.loadingText}>
            Loading Safety workspace...
          </Text>
        </View>
      ) : !allowed ? (
        <View style={styles.center}>
          <Ionicons
            name="lock-closed-outline"
            size={42}
            color={GOLD}
          />

          <Text style={styles.restrictedTitle}>
            Access restricted
          </Text>

          <Text style={styles.restrictedText}>
            Accept a Safety Supervisor
            invitation before opening this
            workspace.
          </Text>

          {error ? (
            <Text style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + 30,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons
                name="shield-checkmark"
                size={34}
                color={GOLD}
              />
            </View>

            <Text style={styles.heroTitle}>
              Safety Workspace
            </Text>

            <Text style={styles.heroText}>
              Review assigned reports,
              manage Safety Agents and
              escalate serious cases to the
              System Admin.
            </Text>
          </View>

          <View style={styles.metricsGrid}>
            {[
              {
                key: "assigned",
                label: "Assigned",
                value:
                  dashboard?.counts
                    .assigned || 0,
                helper: "All reports received",
                icon: "file-tray-full-outline",
                color: GOLD,
              },
              {
                key: "open",
                label: "Open",
                value:
                  dashboard?.counts.open || 0,
                helper: "Waiting for action",
                icon: "flag-outline",
                color: "#93C5FD",
              },
              {
                key: "review",
                label: "In Review",
                value:
                  dashboard?.counts
                    .inReview || 0,
                helper: "Being investigated",
                icon: "search-outline",
                color: "#C4B5FD",
              },
              {
                key: "resolved",
                label: "Resolved",
                value:
                  dashboard?.counts
                    .resolved || 0,
                helper: "Completed cases",
                icon:
                  "checkmark-done-outline",
                color: "#6EE7B7",
              },
              {
                key: "priority",
                label: "High Priority",
                value:
                  dashboard?.counts
                    .highPriority || 0,
                helper: "Needs fast action",
                icon: "warning-outline",
                color: "#FB7185",
              },
              {
                key: "agents",
                label: "Agents",
                value:
                  dashboard?.counts
                    .activeAgents || 0,
                helper:
                  `${dashboard?.counts.pendingAgents || 0} pending`,
                icon: "people-outline",
                color: "#7DD3FC",
              },
            ].map((metric) => (
              <View
                key={metric.key}
                style={styles.metricCard}
              >
                <Ionicons
                  name={metric.icon as any}
                  size={24}
                  color={metric.color}
                />

                <Text
                  style={[
                    styles.metricValue,
                    {
                      color:
                        metric.color,
                    },
                  ]}
                >
                  {metric.value}
                </Text>

                <Text style={styles.metricLabel}>
                  {metric.label}
                </Text>

                <Text style={styles.metricHelper}>
                  {metric.helper}
                </Text>
              </View>
            ))}
          </View>

          <Pressable style={styles.primaryAction}>
            <View style={styles.primaryIcon}>
              <Ionicons
                name="file-tray-full-outline"
                size={25}
                color={GOLD}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.primaryTitle}>
                Assigned Reports
              </Text>

              <Text style={styles.primaryText}>
                Open report queue, review
                Report Command Codes and
                assign cases to agents.
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={22}
              color={GOLD}
            />
          </Pressable>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Safety Agents
            </Text>

            <Pressable style={styles.addAgentButton}>
              <Ionicons
                name="person-add-outline"
                size={18}
                color="#07111F"
              />

              <Text style={styles.addAgentText}>
                Add Agent
              </Text>
            </Pressable>
          </View>

          {dashboard?.agents.length ? (
            dashboard.agents.map(
              (agent) => (
                <View
                  key={agent.userId}
                  style={styles.agentCard}
                >
                  <View style={styles.agentAvatar}>
                    <Ionicons
                      name="person-outline"
                      size={23}
                      color="#93C5FD"
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.agentName}>
                      {agent.kristoId ||
                        agent.userId}
                    </Text>

                    <Text style={styles.agentMeta}>
                      {agent.churchId}
                    </Text>

                    <View style={styles.agentStats}>
                      <Text style={styles.agentStat}>
                        Open {agent.open}
                      </Text>

                      <Text style={styles.agentStat}>
                        Review {agent.inReview}
                      </Text>

                      <Text style={styles.agentResolved}>
                        Resolved {agent.resolved}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.agentWorkload}>
                    <Text style={styles.agentWorkloadValue}>
                      {agent.totalAssigned}
                    </Text>

                    <Text style={styles.agentWorkloadLabel}>
                      Assigned
                    </Text>
                  </View>
                </View>
              )
            )
          ) : (
            <View style={styles.emptyAgents}>
              <Ionicons
                name="people-outline"
                size={31}
                color="#93C5FD"
              />

              <Text style={styles.emptyAgentsTitle}>
                No Safety Agents
              </Text>

              <Text style={styles.emptyAgentsText}>
                Add agents using KRISTO ID
                and Church ID.
              </Text>
            </View>
          )}

          {dashboard?.reports
            .slice(0, 5)
            .map((report) => (
              <View
                key={report.id}
                style={styles.reportCard}
              >
                <View style={styles.reportTopRow}>
                  <Text style={styles.reportCode}>
                    {report.reportCode}
                  </Text>

                  <Text style={styles.reportPriority}>
                    {report.priority.toUpperCase()}
                  </Text>
                </View>

                <Text style={styles.reportReason}>
                  {report.reason}
                </Text>

                <Text style={styles.reportReporter}>
                  Reporter:{" "}
                  {report.reporterKristoId}
                </Text>

                <Text style={styles.reportStatus}>
                  {report.status
                    .replace("_", " ")
                    .toUpperCase()}
                </Text>
              </View>
            ))}

          <View style={styles.infoCard}>
            <Ionicons
              name="git-network-outline"
              size={25}
              color="#6EE7B7"
            />

            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>
                Automatic distribution
              </Text>

              <Text style={styles.infoText}>
                New reports will be routed
                to eligible agents with the
                lowest open workload.
              </Text>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  backButton: {
    width: 53,
    height: 53,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.13)",
    backgroundColor:
      "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    color: TEXT,
    fontSize: 27,
    fontWeight: "900",
  },

  headerSub: {
    marginTop: 3,
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },

  shield: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.30)",
    backgroundColor:
      "rgba(244,208,111,0.11)",
    alignItems: "center",
    justifyContent: "center",
  },

  center: {
    flex: 1,
    paddingHorizontal: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  loadingText: {
    marginTop: 14,
    color: MUTED,
    fontSize: 14,
    fontWeight: "700",
  },

  restrictedTitle: {
    marginTop: 16,
    color: TEXT,
    fontSize: 23,
    fontWeight: "900",
  },

  restrictedText: {
    marginTop: 10,
    color: MUTED,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
    textAlign: "center",
  },

  error: {
    marginTop: 12,
    color: "#FB7185",
    textAlign: "center",
  },

  content: {
    padding: 18,
    gap: 17,
  },

  hero: {
    padding: 23,
    borderRadius: 25,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.26)",
    backgroundColor:
      "rgba(255,255,255,0.065)",
  },

  heroIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.13)",
  },

  heroTitle: {
    marginTop: 17,
    color: TEXT,
    fontSize: 25,
    fontWeight: "900",
  },

  heroText: {
    marginTop: 8,
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
  },

  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },

  metricCard: {
    width: "48%",
    minHeight: 154,
    padding: 17,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.12)",
    backgroundColor:
      "rgba(255,255,255,0.055)",
  },

  metricValue: {
    marginTop: 18,
    fontSize: 35,
    fontWeight: "900",
  },

  metricLabel: {
    marginTop: 5,
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
  },

  metricHelper: {
    marginTop: 5,
    color: MUTED,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },

  primaryAction: {
    padding: 19,
    borderRadius: 23,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.28)",
    backgroundColor:
      "rgba(244,208,111,0.07)",
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },

  primaryIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.13)",
  },

  primaryTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },

  primaryText: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },

  sectionHeader: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sectionTitle: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
  },

  addAgentButton: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: GOLD,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  addAgentText: {
    color: "#07111F",
    fontSize: 12,
    fontWeight: "900",
  },

  agentCard: {
    padding: 16,
    borderRadius: 21,
    borderWidth: 1,
    borderColor:
      "rgba(147,197,253,0.17)",
    backgroundColor:
      "rgba(255,255,255,0.05)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  agentAvatar: {
    width: 49,
    height: 49,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(147,197,253,0.12)",
  },

  agentName: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },

  agentMeta: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
  },

  agentStats: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  agentStat: {
    color: "#93C5FD",
    fontSize: 10,
    fontWeight: "800",
  },

  agentResolved: {
    color: "#6EE7B7",
    fontSize: 10,
    fontWeight: "800",
  },

  agentWorkload: {
    alignItems: "center",
  },

  agentWorkloadValue: {
    color: GOLD,
    fontSize: 23,
    fontWeight: "900",
  },

  agentWorkloadLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "800",
  },

  emptyAgents: {
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(147,197,253,0.16)",
    backgroundColor:
      "rgba(255,255,255,0.04)",
    alignItems: "center",
  },

  emptyAgentsTitle: {
    marginTop: 11,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },

  emptyAgentsText: {
    marginTop: 6,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
  },

  reportCard: {
    padding: 17,
    borderRadius: 21,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.17)",
    backgroundColor:
      "rgba(255,255,255,0.045)",
  },

  reportTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  reportCode: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  reportPriority: {
    color: "#FB7185",
    fontSize: 10,
    fontWeight: "900",
  },

  reportReason: {
    marginTop: 10,
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
  },

  reportReporter: {
    marginTop: 7,
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
  },

  reportStatus: {
    marginTop: 8,
    color: "#93C5FD",
    fontSize: 10,
    fontWeight: "900",
  },

  grid: {
    flexDirection: "row",
    gap: 13,
  },

  card: {
    flex: 1,
    minHeight: 170,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.12)",
    backgroundColor:
      "rgba(255,255,255,0.055)",
  },

  cardTitle: {
    marginTop: 25,
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
  },

  cardText: {
    marginTop: 7,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },

  infoCard: {
    padding: 19,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(110,231,183,0.22)",
    backgroundColor:
      "rgba(110,231,183,0.065)",
    flexDirection: "row",
    gap: 13,
  },

  infoTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },

  infoText: {
    marginTop: 6,
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
});
