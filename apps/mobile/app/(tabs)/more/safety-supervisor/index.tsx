import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

type ReportQueueFilter =
  | "all"
  | "open"
  | "in_review"
  | "resolved"
  | "escalated";

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

  const [
    reportFilter,
    setReportFilter,
  ] = React.useState<ReportQueueFilter>(
    "all"
  );

  const [
    reportSearch,
    setReportSearch,
  ] = React.useState("");

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

  const filteredReports =
    React.useMemo(() => {
      const reports =
        dashboard?.reports || [];

      const query =
        reportSearch
          .trim()
          .toLowerCase();

      return reports.filter(
        (report) => {
          const matchesFilter =
            reportFilter === "all"
              ? true
              : reportFilter === "open"
                ? (
                    report.status === "open" ||
                    report.status === "assigned"
                  )
                : report.status ===
                  reportFilter;

          if (!matchesFilter) {
            return false;
          }

          if (!query) {
            return true;
          }

          return [
            report.reportCode,
            report.reason,
            report.category,
            report.reporterKristoId,
            report.reportedKristoId,
            report.targetTitle,
            report.targetOwnerName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query);
        }
      );
    }, [
      dashboard?.reports,
      reportFilter,
      reportSearch,
    ]);

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

          <View style={styles.queueHeader}>
            <View>
              <Text style={styles.sectionTitle}>
                Report Queue
              </Text>

              <Text style={styles.queueSubtitle}>
                {filteredReports.length} cases shown
              </Text>
            </View>

            <View style={styles.queueLiveBadge}>
              <View style={styles.queueLiveDot} />

              <Text style={styles.queueLiveText}>
                LIVE
              </Text>
            </View>
          </View>

          <View style={styles.searchShell}>
            <Ionicons
              name="search-outline"
              size={20}
              color={MUTED}
            />

            <TextInput
              value={reportSearch}
              onChangeText={setReportSearch}
              placeholder="Search code, reporter or reason"
              placeholderTextColor=
                "rgba(255,255,255,0.34)"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />

            {reportSearch ? (
              <Pressable
                onPress={() =>
                  setReportSearch("")
                }
                hitSlop={10}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={MUTED}
                />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={
              styles.filterTabs
            }
          >
            {[
              {
                key: "all",
                label: "All",
                count:
                  dashboard?.reports.length || 0,
              },
              {
                key: "open",
                label: "Open",
                count:
                  dashboard?.counts.open || 0,
              },
              {
                key: "in_review",
                label: "In Review",
                count:
                  dashboard?.counts.inReview || 0,
              },
              {
                key: "resolved",
                label: "Resolved",
                count:
                  dashboard?.counts.resolved || 0,
              },
              {
                key: "escalated",
                label: "Escalated",
                count:
                  dashboard?.counts.escalated || 0,
              },
            ].map((tab) => {
              const active =
                reportFilter === tab.key;

              return (
                <Pressable
                  key={tab.key}
                  onPress={() =>
                    setReportFilter(
                      tab.key as ReportQueueFilter
                    )
                  }
                  style={[
                    styles.filterTab,
                    active &&
                      styles.filterTabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterTabText,
                      active &&
                        styles.filterTabTextActive,
                    ]}
                  >
                    {tab.label}
                  </Text>

                  <View
                    style={[
                      styles.filterCount,
                      active &&
                        styles.filterCountActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterCountText,
                        active &&
                          styles.filterCountTextActive,
                      ]}
                    >
                      {tab.count}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {filteredReports.length ? (
            filteredReports.map(
              (report) => {
                const critical =
                  report.priority ===
                    "critical" ||
                  report.priority ===
                    "high";

                return (
                  <Pressable
                    key={report.id}
                    onPress={() =>
                      router.push({
                        pathname:
                          "/(tabs)/more/safety-supervisor/reports/[reportId]",
                        params: {
                          reportId:
                            report.id,
                        },
                      })
                    }
                    style={({ pressed }) => [
                      styles.caseCard,
                      critical &&
                        styles.caseCardCritical,
                      pressed && {
                        opacity: 0.76,
                      },
                    ]}
                  >
                    <View
                      style={styles.caseTopRow}
                    >
                      <View
                        style={
                          styles.caseCodeRow
                        }
                      >
                        <Ionicons
                          name={
                            critical
                              ? "warning"
                              : "shield-checkmark-outline"
                          }
                          size={17}
                          color={
                            critical
                              ? "#FB7185"
                              : GOLD
                          }
                        />

                        <Text
                          style={styles.caseCode}
                        >
                          {report.reportCode}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.priorityBadge,
                          critical &&
                            styles.priorityBadgeCritical,
                        ]}
                      >
                        <Text
                          style={[
                            styles.priorityText,
                            critical &&
                              styles.priorityTextCritical,
                          ]}
                        >
                          {report.priority.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <Text
                      numberOfLines={2}
                      style={styles.caseReason}
                    >
                      {report.reason ||
                        report.category}
                    </Text>

                    {report.targetTitle ||
                    report.targetOwnerName ? (
                      <Text
                        numberOfLines={1}
                        style={styles.caseTarget}
                      >
                        Target:{" "}
                        {report.targetTitle ||
                          report.targetOwnerName}
                      </Text>
                    ) : null}

                    <View
                      style={styles.caseMetaRow}
                    >
                      <Text
                        style={styles.caseMeta}
                      >
                        Reporter:{" "}
                        {report.reporterKristoId ||
                          "Unknown"}
                      </Text>

                      <Text
                        style={styles.caseMeta}
                      >
                        {new Date(
                          report.createdAt
                        ).toLocaleDateString()}
                      </Text>
                    </View>

                    <View
                      style={styles.caseFooter}
                    >
                      <View
                        style={styles.statusBadge}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            report.status ===
                              "resolved"
                              ? {
                                  backgroundColor:
                                    "#6EE7B7",
                                }
                              : report.status ===
                                  "escalated"
                                ? {
                                    backgroundColor:
                                      "#FB7185",
                                  }
                                : report.status ===
                                    "in_review"
                                  ? {
                                      backgroundColor:
                                        "#C4B5FD",
                                    }
                                  : null,
                          ]}
                        />

                        <Text
                          style={styles.statusText}
                        >
                          {report.status
                            .replace(
                              "_",
                              " "
                            )
                            .toUpperCase()}
                        </Text>
                      </View>

                      <View
                        style={styles.openCaseButton}
                      >
                        <Text
                          style={
                            styles.openCaseText
                          }
                        >
                          Open Case
                        </Text>

                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={GOLD}
                        />
                      </View>
                    </View>
                  </Pressable>
                );
              }
            )
          ) : (
            <View style={styles.emptyQueue}>
              <Ionicons
                name="file-tray-outline"
                size={34}
                color={MUTED}
              />

              <Text style={styles.emptyQueueTitle}>
                No matching cases
              </Text>

              <Text style={styles.emptyQueueText}>
                Change the filter or search term.
              </Text>
            </View>
          )}

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

  queueHeader: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  queueSubtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
  },

  queueLiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor:
      "rgba(110,231,183,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(110,231,183,0.22)",
  },

  queueLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#6EE7B7",
  },

  queueLiveText: {
    color: "#6EE7B7",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  searchShell: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor:
      "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
  },

  searchInput: {
    flex: 1,
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },

  filterTabs: {
    gap: 8,
    paddingRight: 10,
  },

  filterTab: {
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor:
      "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.085)",
  },

  filterTabActive: {
    backgroundColor:
      "rgba(244,208,111,0.12)",
    borderColor:
      "rgba(244,208,111,0.35)",
  },

  filterTabText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
  },

  filterTabTextActive: {
    color: GOLD,
  },

  filterCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.07)",
  },

  filterCountActive: {
    backgroundColor:
      "rgba(244,208,111,0.18)",
  },

  filterCountText: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "900",
  },

  filterCountTextActive: {
    color: GOLD,
  },

  caseCard: {
    padding: 16,
    borderRadius: 21,
    backgroundColor:
      "rgba(255,255,255,0.052)",
    borderWidth: 1,
    borderColor:
      "rgba(147,197,253,0.17)",
  },

  caseCardCritical: {
    borderColor:
      "rgba(251,113,133,0.30)",
    backgroundColor:
      "rgba(251,113,133,0.055)",
  },

  caseTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  caseCodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  caseCode: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  priorityBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor:
      "rgba(147,197,253,0.10)",
  },

  priorityBadgeCritical: {
    backgroundColor:
      "rgba(251,113,133,0.13)",
  },

  priorityText: {
    color: "#93C5FD",
    fontSize: 8,
    fontWeight: "900",
  },

  priorityTextCritical: {
    color: "#FB7185",
  },

  caseReason: {
    marginTop: 12,
    color: TEXT,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },

  caseTarget: {
    marginTop: 6,
    color: "#C4B5FD",
    fontSize: 11,
    fontWeight: "700",
  },

  caseMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  caseMeta: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
  },

  caseFooter: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor:
      "rgba(255,255,255,0.07)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#93C5FD",
  },

  statusText: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "900",
  },

  openCaseButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  openCaseText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
  },

  emptyQueue: {
    padding: 25,
    borderRadius: 21,
    alignItems: "center",
    backgroundColor:
      "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.07)",
  },

  emptyQueueTitle: {
    marginTop: 10,
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },

  emptyQueueText: {
    marginTop: 5,
    color: MUTED,
    fontSize: 11,
    textAlign: "center",
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
