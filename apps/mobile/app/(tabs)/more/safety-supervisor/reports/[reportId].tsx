import React from "react";

import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  useFocusEffect,
  useLocalSearchParams,
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
  fetchSafetySupervisorReport,
  type SafetyReportSummary,
  type SafetySupervisorDashboardResponse,
} from "@/src/lib/safetyAdminApi";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.60)";
const GREEN = "#6EE7B7";
const BLUE = "#93C5FD";
const PURPLE = "#C4B5FD";
const RED = "#FB7185";

function formatLabel(
  value: unknown
) {
  return String(value || "—")
    .replace(/_/g, " ")
    .replace(
      /\b\w/g,
      (char) =>
        char.toUpperCase()
    );
}

function formatDateTime(
  value: unknown
) {
  const date =
    new Date(
      String(value || "")
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return date.toLocaleString();
}

export default function
SafetySupervisorReportDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params =
    useLocalSearchParams<{
      reportId?:
        | string
        | string[];
    }>();

  const reportId =
    String(
      Array.isArray(params.reportId)
        ? params.reportId[0]
        : params.reportId || ""
    ).trim();

  const [
    report,
    setReport,
  ] = React.useState<
    SafetyReportSummary | null
  >(null);

  const [
    agents,
    setAgents,
  ] = React.useState<
    SafetySupervisorDashboardResponse["agents"]
  >([]);

  const [
    loading,
    setLoading,
  ] = React.useState(true);

  const [
    error,
    setError,
  ] = React.useState("");

  const load =
    React.useCallback(async () => {
      if (!reportId) {
        setError(
          "Safety report ID is missing."
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const result =
          await fetchSafetySupervisorReport(
            reportId
          );

        setReport(result.report);
        setAgents(result.agents);
      } catch (nextError: any) {
        setError(
          String(
            nextError?.message ||
            "Could not load this case."
          )
        );
      } finally {
        setLoading(false);
      }
    }, [reportId]);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const assignedAgent =
    agents.find(
      (
        agent:
          SafetySupervisorDashboardResponse["agents"][number]
      ) =>
        agent.userId ===
        report?.assignedAgentUserId
    );

  const critical =
    report?.priority === "critical" ||
    report?.priority === "high";

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[
          "#28194B",
          "#111927",
          BG,
        ]}
        style={
          StyleSheet.absoluteFillObject
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
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={27}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Case Command
          </Text>

          <Text style={styles.headerSub}>
            Investigation workspace
          </Text>
        </View>

        <View style={styles.commandIcon}>
          <Ionicons
            name="shield-half-outline"
            size={25}
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
            Loading case…
          </Text>
        </View>
      ) : error || !report ? (
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={42}
            color={RED}
          />

          <Text style={styles.errorTitle}>
            Could not open case
          </Text>

          <Text style={styles.errorText}>
            {error}
          </Text>

          <Pressable
            onPress={() =>
              void load()
            }
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>
              Try Again
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom:
              insets.bottom + 32,
          }}
        >
          <View
            style={[
              styles.commandCard,
              critical &&
                styles.commandCardCritical,
            ]}
          >
            <View style={styles.commandTop}>
              <View>
                <Text style={styles.commandCode}>
                  {report.reportCode}
                </Text>

                <Text style={styles.commandCategory}>
                  {formatLabel(
                    report.category
                  )}
                </Text>
              </View>

              <View
                style={[
                  styles.priorityBadge,
                  critical &&
                    styles.priorityCritical,
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

            <Text style={styles.commandReason}>
              {report.reason}
            </Text>

            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  report.status === "resolved"
                    ? {
                        backgroundColor:
                          GREEN,
                      }
                    : report.status ===
                        "escalated"
                      ? {
                          backgroundColor:
                            RED,
                        }
                      : report.status ===
                          "in_review"
                        ? {
                            backgroundColor:
                              PURPLE,
                          }
                        : null,
                ]}
              />

              <Text style={styles.statusText}>
                {formatLabel(
                  report.status
                )}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>
            CASE INFORMATION
          </Text>

          <View style={styles.infoGrid}>
            {[
              {
                label: "Created",
                value:
                  formatDateTime(
                    report.createdAt
                  ),
              },
              {
                label: "Updated",
                value:
                  formatDateTime(
                    report.updatedAt
                  ),
              },
              {
                label: "Source",
                value:
                  formatLabel(
                    report.sourceType
                  ),
              },
              {
                label: "Church",
                value:
                  report.churchId ||
                  "—",
              },
            ].map((item) => (
              <View
                key={item.label}
                style={styles.infoTile}
              >
                <Text style={styles.infoLabel}>
                  {item.label}
                </Text>

                <Text style={styles.infoValue}>
                  {item.value}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>
            REPORTER
          </Text>

          <View style={styles.identityCard}>
            <View style={styles.identityIcon}>
              <Ionicons
                name="person-outline"
                size={23}
                color={BLUE}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.identityTitle}>
                {report.reporterKristoId ||
                  "Unknown reporter"}
              </Text>

              <Text style={styles.identityMeta}>
                User ID:{" "}
                {report.reporterUserId ||
                  "—"}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>
            REPORTED TARGET
          </Text>

          <View style={styles.identityCard}>
            {report.targetOwnerAvatarUri ? (
              <Image
                source={{
                  uri:
                    report.targetOwnerAvatarUri,
                }}
                style={styles.targetImage}
              />
            ) : (
              <View
                style={styles.targetIcon}
              >
                <Ionicons
                  name="alert-outline"
                  size={23}
                  color={RED}
                />
              </View>
            )}

            <View style={{ flex: 1 }}>
              <Text style={styles.identityTitle}>
                {report.targetTitle ||
                  report.targetOwnerName ||
                  report.reportedKristoId ||
                  formatLabel(
                    report.targetType
                  )}
              </Text>

              <Text style={styles.identityMeta}>
                {report.targetSubtitle ||
                  report.targetOwnerKristoId ||
                  report.targetId ||
                  "No additional target information"}
              </Text>
            </View>
          </View>

          {report.targetPreview ? (
            <>
              <Text style={styles.sectionLabel}>
                EVIDENCE PREVIEW
              </Text>

              <View style={styles.evidenceCard}>
                <Ionicons
                  name="document-text-outline"
                  size={25}
                  color={PURPLE}
                />

                <Text style={styles.evidenceText}>
                  {report.targetPreview}
                </Text>
              </View>
            </>
          ) : null}

          {report.description ? (
            <>
              <Text style={styles.sectionLabel}>
                REPORT DESCRIPTION
              </Text>

              <View style={styles.descriptionCard}>
                <Text style={styles.descriptionText}>
                  {report.description}
                </Text>
              </View>
            </>
          ) : null}

          <Text style={styles.sectionLabel}>
            ASSIGNMENT
          </Text>

          <View style={styles.assignmentCard}>
            <View style={styles.assignmentIcon}>
              <Ionicons
                name="people-outline"
                size={24}
                color={GOLD}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.assignmentTitle}>
                {assignedAgent
                  ? assignedAgent.kristoId ||
                    assignedAgent.userId
                  : "No agent assigned"}
              </Text>

              <Text style={styles.assignmentMeta}>
                {assignedAgent
                  ? `${assignedAgent.open} open • ${assignedAgent.inReview} in review • ${assignedAgent.resolved} resolved`
                  : `${agents.filter(
                      (
                        agent:
                          SafetySupervisorDashboardResponse["agents"][number]
                      ) =>
                        agent.status ===
                        "active"
                    ).length} active agents available`}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>
            OPERATION TIMELINE
          </Text>

          <View style={styles.timelineCard}>
            {[
              {
                label:
                  "Report submitted",
                value:
                  report.createdAt,
                complete: true,
              },
              {
                label:
                  "Assigned to supervisor",
                value:
                  report.assignedSupervisorUserId
                    ? report.updatedAt
                    : "",
                complete:
                  Boolean(
                    report.assignedSupervisorUserId
                  ),
              },
              {
                label:
                  "Assigned to agent",
                value:
                  report.assignedAgentUserId
                    ? report.updatedAt
                    : "",
                complete:
                  Boolean(
                    report.assignedAgentUserId
                  ),
              },
              {
                label:
                  "Investigation started",
                value:
                  report.status ===
                    "in_review" ||
                  report.status ===
                    "resolved"
                    ? report.updatedAt
                    : "",
                complete:
                  report.status ===
                    "in_review" ||
                  report.status ===
                    "resolved",
              },
              {
                label:
                  "Case completed",
                value:
                  report.status ===
                    "resolved"
                    ? report.updatedAt
                    : "",
                complete:
                  report.status ===
                  "resolved",
              },
            ].map((step, index) => (
              <View
                key={step.label}
                style={styles.timelineRow}
              >
                <View style={styles.timelineRail}>
                  <View
                    style={[
                      styles.timelineDot,
                      step.complete &&
                        styles.timelineDotComplete,
                    ]}
                  />

                  {index < 4 ? (
                    <View
                      style={[
                        styles.timelineLine,
                        step.complete &&
                          styles.timelineLineComplete,
                      ]}
                    />
                  ) : null}
                </View>

                <View
                  style={styles.timelineContent}
                >
                  <Text
                    style={[
                      styles.timelineTitle,
                      step.complete &&
                        styles.timelineTitleComplete,
                    ]}
                  >
                    {step.label}
                  </Text>

                  <Text style={styles.timelineDate}>
                    {step.value
                      ? formatDateTime(
                          step.value
                        )
                      : "Pending"}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.phaseNotice}>
            <Ionicons
              name="construct-outline"
              size={24}
              color={GOLD}
            />

            <View style={{ flex: 1 }}>
              <Text style={styles.phaseTitle}>
                Investigation actions
              </Text>

              <Text style={styles.phaseText}>
                Assign Agent, Start Review,
                Resolve, Escalate and Dismiss
                controls are the next workflow
                phase.
              </Text>
            </View>
          </View>
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
      paddingHorizontal: 16,
      paddingBottom: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
    },

    backButton: {
      width: 49,
      height: 49,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.11)",
      backgroundColor:
        "rgba(255,255,255,0.055)",
    },

    headerTitle: {
      color: TEXT,
      fontSize: 24,
      fontWeight: "900",
    },

    headerSub: {
      marginTop: 3,
      color: MUTED,
      fontSize: 12,
      fontWeight: "700",
    },

    commandIcon: {
      width: 49,
      height: 49,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.28)",
      backgroundColor:
        "rgba(244,208,111,0.10)",
    },

    center: {
      flex: 1,
      padding: 28,
      alignItems: "center",
      justifyContent: "center",
    },

    loadingText: {
      marginTop: 12,
      color: MUTED,
      fontWeight: "700",
    },

    errorTitle: {
      marginTop: 13,
      color: TEXT,
      fontSize: 19,
      fontWeight: "900",
    },

    errorText: {
      marginTop: 7,
      color: MUTED,
      textAlign: "center",
      lineHeight: 20,
    },

    retryButton: {
      marginTop: 18,
      paddingHorizontal: 23,
      paddingVertical: 11,
      borderRadius: 14,
      backgroundColor: GOLD,
    },

    retryText: {
      color: BG,
      fontWeight: "900",
    },

    commandCard: {
      padding: 19,
      borderRadius: 24,
      borderWidth: 1,
      borderColor:
        "rgba(147,197,253,0.23)",
      backgroundColor:
        "rgba(255,255,255,0.06)",
    },

    commandCardCritical: {
      borderColor:
        "rgba(251,113,133,0.34)",
      backgroundColor:
        "rgba(251,113,133,0.065)",
    },

    commandTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },

    commandCode: {
      color: GOLD,
      fontSize: 14,
      fontWeight: "900",
      letterSpacing: 0.7,
    },

    commandCategory: {
      marginTop: 5,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    priorityBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor:
        "rgba(147,197,253,0.12)",
    },

    priorityCritical: {
      backgroundColor:
        "rgba(251,113,133,0.15)",
    },

    priorityText: {
      color: BLUE,
      fontSize: 9,
      fontWeight: "900",
    },

    priorityTextCritical: {
      color: RED,
    },

    commandReason: {
      marginTop: 15,
      color: TEXT,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: "900",
    },

    statusRow: {
      marginTop: 15,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
    },

    statusDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: BLUE,
    },

    statusText: {
      color: MUTED,
      fontSize: 10,
      fontWeight: "900",
    },

    sectionLabel: {
      marginTop: 24,
      marginBottom: 10,
      color: GOLD,
      fontSize: 10,
      letterSpacing: 1.15,
      fontWeight: "900",
    },

    infoGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 9,
    },

    infoTile: {
      width: "48.5%",
      minHeight: 84,
      padding: 13,
      borderRadius: 17,
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.045)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.075)",
    },

    infoLabel: {
      color: MUTED,
      fontSize: 9,
      fontWeight: "800",
      textTransform: "uppercase",
    },

    infoValue: {
      marginTop: 6,
      color: TEXT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "800",
    },

    identityCard: {
      padding: 15,
      borderRadius: 19,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor:
        "rgba(255,255,255,0.045)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.08)",
    },

    identityIcon: {
      width: 47,
      height: 47,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(147,197,253,0.12)",
    },

    targetIcon: {
      width: 47,
      height: 47,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(251,113,133,0.11)",
    },

    targetImage: {
      width: 47,
      height: 47,
      borderRadius: 16,
    },

    identityTitle: {
      color: TEXT,
      fontSize: 14,
      fontWeight: "900",
    },

    identityMeta: {
      marginTop: 4,
      color: MUTED,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: "700",
    },

    evidenceCard: {
      padding: 16,
      borderRadius: 19,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      backgroundColor:
        "rgba(196,181,253,0.07)",
      borderWidth: 1,
      borderColor:
        "rgba(196,181,253,0.19)",
    },

    evidenceText: {
      flex: 1,
      color: TEXT,
      fontSize: 12,
      lineHeight: 19,
      fontWeight: "700",
    },

    descriptionCard: {
      padding: 16,
      borderRadius: 19,
      backgroundColor:
        "rgba(255,255,255,0.045)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.08)",
    },

    descriptionText: {
      color: TEXT,
      fontSize: 12,
      lineHeight: 20,
      fontWeight: "700",
    },

    assignmentCard: {
      padding: 15,
      borderRadius: 19,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor:
        "rgba(244,208,111,0.07)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.20)",
    },

    assignmentIcon: {
      width: 47,
      height: 47,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.12)",
    },

    assignmentTitle: {
      color: TEXT,
      fontSize: 14,
      fontWeight: "900",
    },

    assignmentMeta: {
      marginTop: 4,
      color: MUTED,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: "700",
    },

    timelineCard: {
      paddingHorizontal: 16,
      paddingVertical: 17,
      borderRadius: 20,
      backgroundColor:
        "rgba(255,255,255,0.04)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.075)",
    },

    timelineRow: {
      flexDirection: "row",
      minHeight: 66,
    },

    timelineRail: {
      width: 26,
      alignItems: "center",
    },

    timelineDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor:
        "rgba(255,255,255,0.22)",
      backgroundColor: BG,
    },

    timelineDotComplete: {
      borderColor: GREEN,
      backgroundColor: GREEN,
    },

    timelineLine: {
      width: 2,
      flex: 1,
      marginTop: 4,
      backgroundColor:
        "rgba(255,255,255,0.09)",
    },

    timelineLineComplete: {
      backgroundColor:
        "rgba(110,231,183,0.38)",
    },

    timelineContent: {
      flex: 1,
      paddingLeft: 9,
      paddingBottom: 15,
    },

    timelineTitle: {
      color: MUTED,
      fontSize: 12,
      fontWeight: "800",
    },

    timelineTitleComplete: {
      color: TEXT,
    },

    timelineDate: {
      marginTop: 4,
      color:
        "rgba(255,255,255,0.38)",
      fontSize: 9,
      fontWeight: "700",
    },

    phaseNotice: {
      marginTop: 22,
      padding: 16,
      borderRadius: 19,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      backgroundColor:
        "rgba(244,208,111,0.07)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.20)",
    },

    phaseTitle: {
      color: TEXT,
      fontSize: 14,
      fontWeight: "900",
    },

    phaseText: {
      marginTop: 5,
      color: MUTED,
      fontSize: 11,
      lineHeight: 17,
      fontWeight: "700",
    },
  });
