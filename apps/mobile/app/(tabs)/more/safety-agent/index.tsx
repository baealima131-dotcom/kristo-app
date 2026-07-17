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
  fetchSafetyAgentDashboard,
  type SafetyAccessResponse,
  type SafetyAgentDashboardResponse,
  type SafetyReportSummary,
} from "@/src/lib/safetyAdminApi";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.58)";
const BLUE = "#93C5FD";
const PURPLE = "#C4B5FD";
const GREEN = "#6EE7B7";
const RED = "#FB7185";

type ReportFilter =
  | "all"
  | "open"
  | "in_review"
  | "resolved";

function reportStatusLabel(
  report: SafetyReportSummary
) {
  if (
    report.status === "in_review"
  ) {
    return "IN REVIEW";
  }

  if (
    report.status === "resolved"
  ) {
    return "RESOLVED";
  }

  if (
    report.status === "escalated"
  ) {
    return "ESCALATED";
  }

  return "OPEN";
}

function reportStatusColor(
  report: SafetyReportSummary
) {
  if (
    report.status === "resolved"
  ) {
    return GREEN;
  }

  if (
    report.status === "in_review"
  ) {
    return PURPLE;
  }

  if (
    report.status === "escalated"
  ) {
    return RED;
  }

  return BLUE;
}

export default function
SafetyAgentWorkspaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [
    access,
    setAccess,
  ] = React.useState<
    SafetyAccessResponse | null
  >(null);

  const [
    dashboard,
    setDashboard,
  ] = React.useState<
    SafetyAgentDashboardResponse | null
  >(null);

  const [
    loading,
    setLoading,
  ] = React.useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = React.useState(false);

  const [
    error,
    setError,
  ] = React.useState("");

  const [
    filter,
    setFilter,
  ] = React.useState<
    ReportFilter
  >("all");

  const load =
    React.useCallback(
      async (
        mode:
          | "loading"
          | "refresh" =
          "loading"
      ) => {
        if (mode === "refresh") {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        try {
          const [
            accessResult,
            dashboardResult,
          ] =
            await Promise.all([
              fetchSafetyAccess(),
              fetchSafetyAgentDashboard(),
            ]);

          setAccess(
            accessResult
          );

          setDashboard(
            dashboardResult
          );
        } catch (
          nextError: any
        ) {
          setError(
            String(
              nextError?.message ||
                "Could not load your assigned reports."
            )
          );
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      []
    );

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const reports =
    React.useMemo(() => {
      const rows =
        dashboard?.reports || [];

      if (filter === "all") {
        return rows;
      }

      if (filter === "open") {
        return rows.filter(
          (report) =>
            report.status === "open" ||
            report.status ===
              "assigned"
        );
      }

      return rows.filter(
        (report) =>
          report.status === filter
      );
    }, [
      dashboard?.reports,
      filter,
    ]);

  const openReport =
    React.useCallback(
      (reportId: string) => {
        router.push(
          `/more/safety-supervisor/reports/${encodeURIComponent(
            reportId
          )}` as any
        );
      },
      [router]
    );

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[
          "#28194B",
          "#111927",
          BG,
        ]}
        style={
          StyleSheet
            .absoluteFillObject
        }
      />

      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 10,
          },
        ]}
      >
        <Pressable
          onPress={() =>
            router.back()
          }
          style={
            styles.backButton
          }
        >
          <Ionicons
            name="chevron-back"
            size={27}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            Safety Agent
          </Text>

          <Text
            style={styles.subtitle}
          >
            Your assigned reports
          </Text>
        </View>

        <View style={styles.icon}>
          <Ionicons
            name="shield-half-outline"
            size={26}
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

          <Text
            style={styles.message}
          >
            Loading assigned reports…
          </Text>
        </View>
      ) : !access?.isSafetyAgent ? (
        <View style={styles.center}>
          <Ionicons
            name="lock-closed-outline"
            size={40}
            color={GOLD}
          />

          <Text
            style={styles.centerTitle}
          >
            Access restricted
          </Text>

          <Text
            style={styles.message}
          >
            Accept your Safety Agent invitation before opening this workspace.
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={42}
            color={RED}
          />

          <Text
            style={styles.centerTitle}
          >
            Could not load reports
          </Text>

          <Text
            style={styles.message}
          >
            {error}
          </Text>

          <Pressable
            onPress={() =>
              void load()
            }
            style={
              styles.retryButton
            }
          >
            <Text
              style={
                styles.retryText
              }
            >
              Try Again
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom +
                100,
            },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={
                refreshing
              }
              tintColor={GOLD}
              onRefresh={() =>
                void load(
                  "refresh"
                )
              }
            />
          }
        >
          <View
            style={
              styles.activeCard
            }
          >
            <View
              style={
                styles.activeIcon
              }
            >
              <Ionicons
                name="shield-checkmark"
                size={28}
                color={GOLD}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text
                style={
                  styles.activeTitle
                }
              >
                Active Safety Agent
              </Text>

              <Text
                style={
                  styles.activeText
                }
              >
                Only reports assigned to your account appear here.
              </Text>
            </View>
          </View>

          <View
            style={
              styles.statsGrid
            }
          >
            {[
              {
                label:
                  "Assigned",
                value:
                  dashboard
                    ?.counts
                    .totalAssigned ||
                  0,
                color: GOLD,
              },
              {
                label: "Open",
                value:
                  dashboard
                    ?.counts.open ||
                  0,
                color: BLUE,
              },
              {
                label:
                  "In Review",
                value:
                  dashboard
                    ?.counts
                    .inReview ||
                  0,
                color: PURPLE,
              },
              {
                label:
                  "Resolved",
                value:
                  dashboard
                    ?.counts
                    .resolved ||
                  0,
                color: GREEN,
              },
            ].map((item) => (
              <View
                key={item.label}
                style={
                  styles.statCard
                }
              >
                <Text
                  style={[
                    styles.statValue,
                    {
                      color:
                        item.color,
                    },
                  ]}
                >
                  {item.value}
                </Text>

                <Text
                  style={
                    styles.statLabel
                  }
                >
                  {item.label}
                </Text>
              </View>
            ))}
          </View>

          {(
            dashboard?.counts
              .highPriority || 0
          ) > 0 ? (
            <View
              style={
                styles.priorityCard
              }
            >
              <Ionicons
                name="warning-outline"
                size={22}
                color={RED}
              />

              <Text
                style={
                  styles.priorityText
                }
              >
                {
                  dashboard?.counts
                    .highPriority
                } high priority report
                {dashboard?.counts
                  .highPriority === 1
                  ? ""
                  : "s"}
              </Text>
            </View>
          ) : null}

          <Text
            style={
              styles.sectionTitle
            }
          >
            Assigned Reports
          </Text>

          <View
            style={
              styles.filters
            }
          >
            {[
              ["all", "All"],
              ["open", "Open"],
              [
                "in_review",
                "Review",
              ],
              [
                "resolved",
                "Resolved",
              ],
            ].map(
              ([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() =>
                    setFilter(
                      value as
                        ReportFilter
                    )
                  }
                  style={[
                    styles.filterChip,
                    filter === value &&
                      styles
                        .filterChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      filter === value &&
                        styles
                          .filterTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            )}
          </View>

          {reports.length ? (
            <View
              style={
                styles.reportList
              }
            >
              {reports.map(
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
                        openReport(
                          report.id
                        )
                      }
                      style={
                        styles.reportCard
                      }
                    >
                      <View
                        style={
                          styles
                            .reportTop
                        }
                      >
                        <View
                          style={{
                            flex: 1,
                          }}
                        >
                          <Text
                            style={
                              styles
                                .reportCode
                            }
                          >
                            {
                              report.reportCode
                            }
                          </Text>

                          <Text
                            numberOfLines={
                              1
                            }
                            style={
                              styles
                                .reportReason
                            }
                          >
                            {report.reason ||
                              report.category ||
                              "Safety report"}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles
                              .statusBadge,
                            {
                              borderColor:
                                reportStatusColor(
                                  report
                                ),
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles
                                .statusText,
                              {
                                color:
                                  reportStatusColor(
                                    report
                                  ),
                              },
                            ]}
                          >
                            {reportStatusLabel(
                              report
                            )}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={
                          styles
                            .reportMeta
                        }
                      >
                        {critical ? (
                          <Text
                            style={
                              styles
                                .criticalText
                            }
                          >
                            {report.priority.toUpperCase()}
                          </Text>
                        ) : null}

                        <Text
                          style={
                            styles
                              .categoryText
                          }
                        >
                          {report.category ||
                            "General"}
                        </Text>
                      </View>

                      <View
                        style={
                          styles.openRow
                        }
                      >
                        <Text
                          style={
                            styles.openText
                          }
                        >
                          Open case
                        </Text>

                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={MUTED}
                        />
                      </View>
                    </Pressable>
                  );
                }
              )}
            </View>
          ) : (
            <View
              style={
                styles.emptyCard
              }
            >
              <Ionicons
                name="file-tray-outline"
                size={34}
                color={MUTED}
              />

              <Text
                style={
                  styles.emptyTitle
                }
              >
                No assigned reports
              </Text>

              <Text
                style={
                  styles.emptyText
                }
              >
                Reports assigned by your supervisor will appear here.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: BG,
    },

    header: {
      paddingHorizontal: 17,
      paddingBottom: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    backButton: {
      width: 50,
      height: 50,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.11)",
    },

    title: {
      color: TEXT,
      fontSize: 23,
      fontWeight: "900",
    },

    subtitle: {
      marginTop: 2,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    icon: {
      width: 50,
      height: 50,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.10)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.28)",
    },

    center: {
      flex: 1,
      paddingHorizontal: 30,
      alignItems: "center",
      justifyContent: "center",
    },

    centerTitle: {
      marginTop: 14,
      color: TEXT,
      fontSize: 21,
      fontWeight: "900",
    },

    message: {
      marginTop: 9,
      maxWidth: 300,
      color: MUTED,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      fontWeight: "700",
    },

    retryButton: {
      marginTop: 18,
      paddingHorizontal: 22,
      paddingVertical: 12,
      borderRadius: 15,
      backgroundColor: GOLD,
    },

    retryText: {
      color: BG,
      fontWeight: "900",
    },

    content: {
      paddingHorizontal: 17,
      gap: 15,
    },

    activeCard: {
      padding: 16,
      borderRadius: 22,
      flexDirection: "row",
      gap: 13,
      alignItems: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.22)",
    },

    activeIcon: {
      width: 49,
      height: 49,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.10)",
    },

    activeTitle: {
      color: TEXT,
      fontSize: 15,
      fontWeight: "900",
    },

    activeText: {
      marginTop: 3,
      color: MUTED,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: "700",
    },

    statsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },

    statCard: {
      width: "48.5%",
      padding: 16,
      borderRadius: 21,
      backgroundColor:
        "rgba(255,255,255,0.05)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.10)",
    },

    statValue: {
      fontSize: 27,
      fontWeight: "900",
    },

    statLabel: {
      marginTop: 4,
      color: MUTED,
      fontSize: 10,
      fontWeight: "800",
    },

    priorityCard: {
      padding: 14,
      borderRadius: 18,
      flexDirection: "row",
      gap: 9,
      alignItems: "center",
      backgroundColor:
        "rgba(251,113,133,0.08)",
      borderWidth: 1,
      borderColor:
        "rgba(251,113,133,0.22)",
    },

    priorityText: {
      color: RED,
      fontSize: 11,
      fontWeight: "900",
    },

    sectionTitle: {
      marginTop: 4,
      color: TEXT,
      fontSize: 19,
      fontWeight: "900",
    },

    filters: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },

    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.11)",
      backgroundColor:
        "rgba(255,255,255,0.04)",
    },

    filterChipActive: {
      borderColor:
        "rgba(244,208,111,0.40)",
      backgroundColor:
        "rgba(244,208,111,0.13)",
    },

    filterText: {
      color: MUTED,
      fontSize: 10,
      fontWeight: "900",
    },

    filterTextActive: {
      color: GOLD,
    },

    reportList: {
      gap: 11,
    },

    reportCard: {
      padding: 16,
      borderRadius: 22,
      backgroundColor:
        "rgba(255,255,255,0.05)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.10)",
    },

    reportTop: {
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
    },

    reportCode: {
      color: GOLD,
      fontSize: 13,
      fontWeight: "900",
    },

    reportReason: {
      marginTop: 5,
      color: TEXT,
      fontSize: 14,
      fontWeight: "800",
    },

    statusBadge: {
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
    },

    statusText: {
      fontSize: 8,
      fontWeight: "900",
    },

    reportMeta: {
      marginTop: 12,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },

    criticalText: {
      color: RED,
      fontSize: 9,
      fontWeight: "900",
    },

    categoryText: {
      color: MUTED,
      fontSize: 9,
      fontWeight: "800",
    },

    openRow: {
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor:
        "rgba(255,255,255,0.07)",
      flexDirection: "row",
      justifyContent:
        "space-between",
      alignItems: "center",
    },

    openText: {
      color: BLUE,
      fontSize: 10,
      fontWeight: "900",
    },

    emptyCard: {
      marginTop: 12,
      padding: 28,
      borderRadius: 23,
      alignItems: "center",
      backgroundColor:
        "rgba(255,255,255,0.04)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.09)",
    },

    emptyTitle: {
      marginTop: 13,
      color: TEXT,
      fontSize: 17,
      fontWeight: "900",
    },

    emptyText: {
      marginTop: 7,
      color: MUTED,
      fontSize: 11,
      lineHeight: 17,
      textAlign: "center",
      fontWeight: "700",
    },
  });
