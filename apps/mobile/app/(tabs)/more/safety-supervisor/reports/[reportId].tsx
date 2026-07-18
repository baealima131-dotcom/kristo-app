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

import { toRenderableImageUri } from "@/src/lib/brandedVideoPoster";
import {
  assignSafetyReportToAgent,
  fetchSafetySupervisorReport,
  issueSafetyReportDecision,
  type SafetyCaseIntelligence,
  type SafetyCasePermissions,
  type SafetyCaseViewerMode,
  type SafetyDecisionType,
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
const ORANGE = "#FDBA74";

type DecisionOption = {
  type: SafetyDecisionType;
  title: string;
  description: string;
  icon: React.ComponentProps<
    typeof Ionicons
  >["name"];
  accent: string;
  requiresDuration?: boolean;
  supervisorOnly?: boolean;
};

const DECISION_OPTIONS:
  DecisionOption[] = [
    {
      type: "no_violation",
      title: "No Violation",
      description:
        "Dismiss the report when the available evidence does not establish a policy violation.",
      icon:
        "checkmark-circle-outline",
      accent: GREEN,
    },
    {
      type: "warning",
      title: "Warning",
      description:
        "Record a formal warning while allowing the account or content to remain active.",
      icon:
        "warning-outline",
      accent: GOLD,
    },
    {
      type: "remove_content",
      title: "Remove Content",
      description:
        "Remove the reported content and record the violation against the responsible account.",
      icon:
        "trash-outline",
      accent: ORANGE,
    },
    {
      type:
        "restrict_account",
      title:
        "Restrict Account",
      description:
        "Temporarily limit account features for the selected period.",
      icon:
        "lock-closed-outline",
      accent: ORANGE,
      requiresDuration: true,
    },
    {
      type:
        "suspend_account",
      title:
        "Suspend Account",
      description:
        "Temporarily suspend access to Kristo for the selected period.",
      icon:
        "pause-circle-outline",
      accent: RED,
      requiresDuration: true,
    },
    {
      type:
        "permanent_ban",
      title:
        "Permanent Ban",
      description:
        "Permanently block the account. Supervisor authority is required.",
      icon:
        "ban-outline",
      accent: RED,
      supervisorOnly: true,
    },
    {
      type: "escalate",
      title:
        "Escalate Case",
      description:
        "Send a severe, uncertain or high-impact case to higher Safety authority.",
      icon:
        "arrow-up-circle-outline",
      accent: PURPLE,
    },
  ];

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
    viewerMode,
    setViewerMode,
  ] = React.useState<
    SafetyCaseViewerMode
  >("supervisor");

  const [
    permissions,
    setPermissions,
  ] = React.useState<
    SafetyCasePermissions
  >({
    canInvestigate: false,
    canAssignAgent: false,
    canEscalate: false,
    canResolve: false,
  });

  const [
    loading,
    setLoading,
  ] = React.useState(true);

  const [
    error,
    setError,
  ] = React.useState("");

  const [
    showAgentPicker,
    setShowAgentPicker,
  ] = React.useState(false);

  const [
    assigningAgentUserId,
    setAssigningAgentUserId,
  ] = React.useState("");

  const [
    selectedDecision,
    setSelectedDecision,
  ] = React.useState<
    SafetyDecisionType | null
  >(null);

  const [
    decisionReason,
    setDecisionReason,
  ] = React.useState("");

  const [
    decisionNotes,
    setDecisionNotes,
  ] = React.useState("");

  const [
    decisionConfidence,
    setDecisionConfidence,
  ] = React.useState<number | null>(
    null
  );

  const [
    decisionDurationDays,
    setDecisionDurationDays,
  ] = React.useState(7);

  const [
    issuingDecision,
    setIssuingDecision,
  ] = React.useState(false);

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

        setReport(
          result.report
        );

        setAgents(
          result.agents
        );

        setViewerMode(
          result.viewerMode
        );

        setPermissions(
          result.permissions
        );
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

  React.useEffect(() => {
    if (
      viewerMode === "agent"
    ) {
      setShowAgentPicker(
        false
      );
    }
  }, [viewerMode]);

  const assignedAgent =
    agents.find(
      (
        agent:
          SafetySupervisorDashboardResponse["agents"][number]
      ) =>
        agent.userId ===
        report?.assignedAgentUserId
    );

  const activeAgents =
    agents.filter(
      (
        agent:
          SafetySupervisorDashboardResponse["agents"][number]
      ) =>
        agent.status ===
        "active"
    );

  const assignToAgent =
    React.useCallback(
      (
        agent:
          SafetySupervisorDashboardResponse["agents"][number]
      ) => {
        if (
          !reportId ||
          assigningAgentUserId
        ) {
          return;
        }

        Alert.alert(
          report?.assignedAgentUserId
            ? "Change assigned agent?"
            : "Assign this report?",
          `Assign ${report?.reportCode || "this report"} to ${
            agent.kristoId ||
            agent.userId
          }?`,
          [
            {
              text: "Cancel",
              style: "cancel",
            },
            {
              text: "Assign",
              onPress: async () => {
                setAssigningAgentUserId(
                  agent.userId
                );

                try {
                  const result =
                    await assignSafetyReportToAgent(
                      {
                        reportId,
                        agentUserId:
                          agent.userId,
                      }
                    );

                  setReport(
                    result.report
                  );
                  setAgents(
                    result.agents
                  );
                  setShowAgentPicker(
                    false
                  );

                  Alert.alert(
                    "Report assigned",
                    `${result.report.reportCode} is now assigned to ${
                      agent.kristoId ||
                      agent.userId
                    }.`
                  );
                } catch (
                  nextError: any
                ) {
                  Alert.alert(
                    "Could not assign report",
                    String(
                      nextError?.message ||
                        "Please try again."
                    )
                  );
                } finally {
                  setAssigningAgentUserId(
                    ""
                  );
                }
              },
            },
          ]
        );
      },
      [
        assigningAgentUserId,
        report?.assignedAgentUserId,
        report?.reportCode,
        reportId,
      ]
    );

  const closeDecisionModal =
    React.useCallback(() => {
      if (issuingDecision) {
        return;
      }

      setSelectedDecision(
        null
      );
      setDecisionReason("");
      setDecisionNotes("");
      setDecisionConfidence(null);
      setDecisionDurationDays(7);
    }, [issuingDecision]);

  const openDecisionModal =
    React.useCallback(
      (
        option:
          DecisionOption
      ) => {
        const completed =
          report?.status ===
            "resolved" ||
          report?.status ===
            "dismissed";

        if (completed) {
          return;
        }

        if (
          option.supervisorOnly &&
          viewerMode === "agent"
        ) {
          Alert.alert(
            "Supervisor approval required",
            "Safety Agents cannot issue a permanent ban. Escalate this case to the Supervisor instead."
          );
          return;
        }

        setSelectedDecision(
          option.type
        );
        setDecisionReason("");
        setDecisionNotes("");
        setDecisionConfidence(null);
        setDecisionDurationDays(
          option.type ===
            "suspend_account"
            ? 30
            : 7
        );
      },
      [
        report?.status,
        viewerMode,
      ]
    );

  const submitDecision =
    React.useCallback(async () => {
      if (
        !selectedDecision ||
        !reportId ||
        issuingDecision
      ) {
        return;
      }

      const reason =
        decisionReason.trim();

      if (reason.length < 8) {
        Alert.alert(
          "Decision reason required",
          "Enter a clear reason containing at least 8 characters."
        );
        return;
      }

      const option =
        DECISION_OPTIONS.find(
          (row) =>
            row.type ===
            selectedDecision
        );

      if (
        option
          ?.requiresDuration &&
        decisionDurationDays < 1
      ) {
        Alert.alert(
          "Duration required",
          "Choose how many days this restriction should remain active."
        );
        return;
      }

      setIssuingDecision(true);

      try {
        const result =
          await issueSafetyReportDecision(
            {
              reportId,
              decisionType:
                selectedDecision,
              reason,
              notes:
                decisionNotes.trim(),
              confidence:
                decisionConfidence ===
                  null
                  ? undefined
                  : decisionConfidence,
              durationDays:
                option
                  ?.requiresDuration
                  ? decisionDurationDays
                  : undefined,
            }
          );

        setReport(
          result.report
        );

        setSelectedDecision(
          null
        );
        setDecisionReason("");
        setDecisionNotes("");

        Alert.alert(
          selectedDecision ===
            "escalate"
            ? "Case escalated"
            : "Decision enforced",
          [
            `${result.report.reportCode} is now ${formatLabel(
              result.report.status
            ).toLowerCase()}.`,

            result.enforcement
              ?.message,

            result.enforcement
              ?.expiresAt
              ? `Active until ${formatDateTime(
                  result.enforcement
                    .expiresAt
                )}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n")
        );
      } catch (
        nextError: any
      ) {
        Alert.alert(
          "Could not issue decision",
          String(
            nextError?.message ||
              "Please try again."
          )
        );
      } finally {
        setIssuingDecision(false);
      }
    }, [
      decisionConfidence,
      decisionDurationDays,
      decisionNotes,
      decisionReason,
      issuingDecision,
      reportId,
      selectedDecision,
    ]);

  const handleOpenReportedTarget =
    React.useCallback(() => {
      if (!report) {
        return;
      }

      const targetType =
        String(
          report.targetType || ""
        )
          .trim()
          .toLowerCase();

      const mediaType =
        String(
          report.targetMediaType || ""
        )
          .trim()
          .toLowerCase();

      const isAccountTarget =
        targetType === "account" ||
        targetType === "user" ||
        targetType === "profile";

      if (isAccountTarget) {
        const userId =
          String(
            report.targetOwnerUserId ||
            report.reportedUserId ||
            ""
          ).trim();

        const kristoId =
          String(
            report.targetOwnerKristoId ||
            report.reportedKristoId ||
            ""
          ).trim();

        if (!userId && !kristoId) {
          Alert.alert(
            "Account unavailable",
            "This report does not contain a resolvable account identity."
          );
          return;
        }

        const accountRoute =
          '/member-more-about/[userId]';

        if (!accountRoute) {
          Alert.alert(
            "Account identified",
            [
              report.targetOwnerName,
              kristoId,
              userId,
            ]
              .filter(Boolean)
              .join("\n")
          );
          return;
        }

        router.push({
          pathname:
            accountRoute as any,
          params: {
            userId,
            id: userId,
            kristoId,
          },
        } as any);

        return;
      }

      const postId =
        String(
          targetType === "comment"
            ? (
                report.sourceRoomId ||
                report.sourceId ||
                ""
              )
            : (
                report.sourceId ||
                report.targetId ||
                ""
              )
        ).trim();

      const commentId =
        targetType === "comment"
          ? String(
              report.sourceMessageId ||
              report.targetId ||
              ""
            ).trim()
          : "";

      if (!postId) {
        if (
          report.targetPreview ||
          report.targetMediaUri ||
          report.targetThumbnailUri
        ) {
          Alert.alert(
            "Evidence snapshot",
            report.targetPreview ||
              "The original content is no longer available. The saved evidence snapshot remains attached to this case."
          );
        } else {
          Alert.alert(
            "Target unavailable",
            "The reported content could not be located."
          );
        }

        return;
      }

      router.push({
        pathname:
          "/post/[id]" as any,
        params: {
          id: postId,
          openPostId: postId,
          commentId:
            commentId || undefined,
          openComments:
            commentId
              ? "1"
              : undefined,
          safetyReportId:
            report.id,
          safetyReportCode:
            report.reportCode,
          targetMediaType:
            mediaType || undefined,
        },
      } as any);
    }, [
      report,
      router,
    ]);

  const caseIntelligence =
    (report?.caseIntelligence ||
      null) as SafetyCaseIntelligence | null;

  const isAgentView =
    viewerMode === "agent";

  const canIssueDecision =
    permissions.canResolve !== false &&
    (
      viewerMode === "agent" ||
      viewerMode === "supervisor"
    );

  const canAssignAgent =
    viewerMode === "supervisor" &&
    permissions.canAssignAgent;

  const critical =
    report?.priority === "critical" ||
    report?.priority === "high";

  const investigationStarted =
    report?.status ===
      "in_review" ||
    report?.status ===
      "escalated" ||
    report?.status ===
      "resolved" ||
    report?.status ===
      "dismissed";

  const findingsSubmitted =
    report?.status ===
      "escalated" ||
    report?.status ===
      "resolved" ||
    report?.status ===
      "dismissed";

  const caseCompleted =
    report?.status ===
      "resolved" ||
    report?.status ===
      "dismissed";

  const timelineSteps =
    isAgentView
      ? [
          {
            label:
              "Report received",
            value:
              report?.assignedAgentUserId
                ? report.updatedAt
                : "",
            complete:
              Boolean(
                report?.assignedAgentUserId
              ),
          },
          {
            label:
              "Review started",
            value:
              investigationStarted
                ? report?.updatedAt
                : "",
            complete:
              investigationStarted,
          },
          {
            label:
              "Findings submitted",
            value:
              findingsSubmitted
                ? report?.updatedAt
                : "",
            complete:
              findingsSubmitted,
          },
          {
            label:
              "Supervisor decision",
            value:
              caseCompleted
                ? report?.updatedAt
                : "",
            complete:
              caseCompleted,
          },
        ]
      : [
          {
            label:
              "Report submitted",
            value:
              report?.createdAt,
            complete: true,
          },
          {
            label:
              "Assigned to supervisor",
            value:
              report
                ?.assignedSupervisorUserId
                ? report.updatedAt
                : "",
            complete:
              Boolean(
                report
                  ?.assignedSupervisorUserId
              ),
          },
          {
            label:
              "Assigned to agent",
            value:
              report
                ?.assignedAgentUserId
                ? report.updatedAt
                : "",
            complete:
              Boolean(
                report
                  ?.assignedAgentUserId
              ),
          },
          {
            label:
              "Investigation started",
            value:
              investigationStarted
                ? report?.updatedAt
                : "",
            complete:
              investigationStarted,
          },
          {
            label:
              "Case completed",
            value:
              caseCompleted
                ? report?.updatedAt
                : "",
            complete:
              caseCompleted,
          },
        ];

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
            Investigation Center
          </Text>

          <Text style={styles.headerSub}>
            {isAgentView
              ? "Agent decision workspace"
              : "Supervisor command workspace"}
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
                        "dismissed"
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

            <View style={styles.heroMetricRow}>
              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricValue}>
                  {formatLabel(
                    report.targetMediaType ||
                      report.targetType
                  )}
                </Text>

                <Text style={styles.heroMetricLabel}>
                  Evidence
                </Text>
              </View>

              <View style={styles.heroMetricDivider} />

              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricValue}>
                  {formatLabel(report.priority)}
                </Text>

                <Text style={styles.heroMetricLabel}>
                  Priority
                </Text>
              </View>

              <View style={styles.heroMetricDivider} />

              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricValue}>
                  {report.decisionConfidence ??
                    "—"}
                  {typeof report.decisionConfidence ===
                  "number"
                    ? "%"
                    : ""}
                </Text>

                <Text style={styles.heroMetricLabel}>
                  Human confidence
                </Text>
              </View>
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
            )
          )}
          </View>

          <Text style={styles.sectionLabel}>
            REPORTER
          </Text>

          <View style={styles.identityCard}>
            {report.reporterAvatarUri ? (
              <Image
                source={{
                  uri:
                    report.reporterAvatarUri,
                }}
                style={styles.targetImage}
              />
            ) : (
              <View style={styles.identityIcon}>
                <Ionicons
                  name="person-outline"
                  size={23}
                  color={BLUE}
                />
              </View>
            )}

            <View style={{ flex: 1 }}>
              <Text style={styles.identityTitle}>
                {report.reporterDisplayName ||
                  report.reporterKristoId ||
                  "Unknown reporter"}
              </Text>

              <Text style={styles.identityMeta}>
                {[
                  report.reporterKristoId,
                  report.reporterChurchName,
                ]
                  .filter(Boolean)
                  .join(" • ") ||
                  `User ID: ${
                    report.reporterUserId ||
                    "—"
                  }`}
              </Text>

              <Text style={styles.identityTechnicalId}>
                User ID:{" "}
                {report.reporterUserId ||
                  "—"}
              </Text>
            </View>

            <View style={styles.profileResolvedBadge}>
              <Ionicons
                name="checkmark-circle"
                size={14}
                color={GREEN}
              />

              <Text style={styles.profileResolvedText}>
                VERIFIED
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>
            REPORTED TARGET
          </Text>

          <Pressable
            onPress={
              handleOpenReportedTarget
            }
            accessibilityRole="button"
            accessibilityLabel="Open reported target"
            style={({ pressed }) => [
              styles.identityCard,
              styles.openableTargetCard,
              pressed &&
                styles.openableTargetCardPressed,
            ]}
          >
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
                {report.targetOwnerName ||
                  report.targetTitle ||
                  report.targetOwnerKristoId ||
                  report.reportedKristoId ||
                  formatLabel(
                    report.targetType
                  )}
              </Text>

              <Text style={styles.identityMeta}>
                {[
                  report.targetOwnerKristoId,
                  report.targetChurchName,
                  report.targetTitle,
                ]
                  .filter(Boolean)
                  .join(" • ") ||
                  report.targetSubtitle ||
                  report.targetId ||
                  "No additional target information"}
              </Text>
            </View>
            <View style={styles.openTargetAction}>
              <Text style={styles.openTargetActionText}>
                OPEN
              </Text>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={GOLD}
              />
            </View>
          </Pressable>

          {(() => {
            const intel = caseIntelligence;
            const status =
              intel?.status ||
              (report ? "error" : "loading");
            const gatesReady =
              status === "ready" &&
              Boolean(intel) &&
              typeof intel!.assessment.caseRiskScore ===
                "number" &&
              typeof intel!.assessment.confidence ===
                "number" &&
              typeof intel!.evidence.strengthScore ===
                "number" &&
              typeof intel!.target.riskScore === "number" &&
              intel!.assessment.recommendation !==
                "human_review";
            const insufficient =
              status === "insufficient_data" ||
              (status === "ready" && !gatesReady);
            const errored =
              status === "error" ||
              (Boolean(report) && !intel);
            const loading = !report;

            const activeReports = Math.max(
              0,
              Number(
                intel?.target?.activeReports ??
                  report?.targetActiveReportCount ??
                  0
              ) || 0
            );
            const uniqueReporters = Math.max(
              0,
              Number(
                intel?.target?.uniqueReporters ??
                  report?.targetUniqueReporterCount ??
                  0
              ) || 0
            );
            const confirmedViolations = Math.max(
              0,
              Number(
                intel?.target?.confirmedViolations ?? 0
              ) || 0
            );
            const reportVolume = Math.max(
              0,
              Number(
                intel?.target?.totalReports ??
                  report?.targetReportCount ??
                  0
              ) || 0
            );

            const badgeLabel = gatesReady
              ? String(
                  intel!.assessment.signalLevel || "low"
                )
                  .replace(/_/g, " ")
                  .toUpperCase()
              : insufficient
                ? "INSUFFICIENT DATA"
                : errored
                  ? "ANALYSIS UNAVAILABLE"
                  : "LOADING";

            const badgeColor = gatesReady
              ? intel!.assessment.signalLevel === "critical"
                ? RED
                : intel!.assessment.signalLevel === "high"
                  ? ORANGE
                  : intel!.assessment.signalLevel === "moderate"
                    ? GOLD
                    : GREEN
              : errored
                ? RED
                : insufficient
                  ? ORANGE
                  : MUTED;

            const formatRec = (value: string) =>
              String(value || "")
                .replace(/_/g, " ")
                .toUpperCase();

            const scoreOrDash = (
              value: number | null | undefined
            ) =>
              gatesReady && typeof value === "number"
                ? String(Math.round(value))
                : "—";

            return (
              <View
                style={[
                  styles.aiSignalCard,
                  gatesReady &&
                  (
                    intel!.assessment.signalLevel ===
                      "critical" ||
                    intel!.assessment.signalLevel === "high"
                  )
                    ? styles.aiSignalCardAction
                    : null,
                ]}
              >
                <View style={styles.aiSignalHeader}>
                  <View style={styles.aiSignalBrand}>
                    <View
                      style={[
                        styles.aiSignalBrandIcon,
                        gatesReady &&
                        intel!.assessment.signalLevel ===
                          "critical"
                          ? styles.aiSignalBrandIconAction
                          : null,
                      ]}
                    >
                      <Ionicons
                        name="analytics-outline"
                        size={22}
                        color={
                          gatesReady &&
                          intel!.assessment.signalLevel ===
                            "critical"
                            ? RED
                            : PURPLE
                        }
                      />
                    </View>

                    <View>
                      <Text style={styles.aiSignalEyebrow}>
                        CASE INTELLIGENCE
                      </Text>

                      <Text style={styles.aiSignalTitle}>
                        Heuristic Case Intelligence
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.aiSignalStatusBadge,
                      {
                        backgroundColor: `${badgeColor}22`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.aiSignalStatusText,
                        { color: badgeColor },
                      ]}
                    >
                      {badgeLabel}
                    </Text>
                  </View>
                </View>

                {loading ? (
                  <View
                    style={{
                      paddingVertical: 18,
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <ActivityIndicator color={PURPLE} />
                    <Text style={styles.aiDecisionNotice}>
                      Loading Case Intelligence from Safety
                      records…
                    </Text>
                  </View>
                ) : null}

                {errored ? (
                  <Text style={styles.aiDecisionNotice}>
                    ANALYSIS UNAVAILABLE — the Case
                    Intelligence service could not complete this
                    assessment. No fabricated scores are shown.
                    Human review is still required.
                  </Text>
                ) : null}

                {insufficient ? (
                  <>
                    <View style={styles.aiScoreRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.aiThresholdLabel}>
                          REQUIRED ACTION
                        </Text>
                        <Text style={styles.aiScoreValue}>
                          HUMAN REVIEW
                        </Text>
                        <Text style={styles.aiScorePercent}>
                          No enforcement recommendation until
                          minimum data gates pass
                        </Text>
                      </View>
                    </View>

                    <View style={styles.reportSignalMetrics}>
                      <View style={styles.reportSignalMetric}>
                        <Text style={styles.reportSignalMetricValue}>
                          {activeReports}
                        </Text>
                        <Text style={styles.reportSignalMetricLabel}>
                          ACTIVE REPORTS
                        </Text>
                      </View>
                      <View style={styles.reportSignalDivider} />
                      <View style={styles.reportSignalMetric}>
                        <Text style={styles.reportSignalMetricValue}>
                          {uniqueReporters}
                        </Text>
                        <Text style={styles.reportSignalMetricLabel}>
                          UNIQUE REPORTERS
                        </Text>
                      </View>
                      <View style={styles.reportSignalDivider} />
                      <View style={styles.reportSignalMetric}>
                        <Text style={styles.reportSignalMetricValue}>
                          {confirmedViolations}
                        </Text>
                        <Text style={styles.reportSignalMetricLabel}>
                          CONFIRMED VIOLATIONS
                        </Text>
                      </View>
                    </View>

                    <View style={styles.aiIdentityRow}>
                      <View style={styles.aiIdentityItem}>
                        <Text style={styles.aiIdentityLabel}>
                          REPORT VOLUME
                        </Text>
                        <Text style={styles.aiIdentityValue}>
                          {reportVolume}
                        </Text>
                      </View>
                      <View style={styles.aiIdentityDivider} />
                      <View style={styles.aiIdentityItem}>
                        <Text style={styles.aiIdentityLabel}>
                          EVIDENCE ANALYSIS
                        </Text>
                        <Text style={styles.aiIdentityValue}>
                          No verified evidence analysis
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.aiDecisionNotice}>
                      INSUFFICIENT DATA — no score, percent,
                      confidence, or enforcement recommendation
                      until minimum data gates pass. Report
                      volume is a supporting statistic only.
                      Human review is required.
                    </Text>
                  </>
                ) : null}

                {gatesReady ? (
                  <>
                    <View style={styles.aiScoreRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.aiThresholdLabel}>
                          RECOMMENDED ACTION
                        </Text>
                        <Text style={styles.aiScoreValue}>
                          {formatRec(
                            intel!.assessment.recommendation
                          )}
                        </Text>
                        <Text style={styles.aiScorePercent}>
                          Heuristic confidence{" "}
                          {`${Math.round(
                            intel!.assessment.confidence as number
                          )}%`}
                        </Text>
                      </View>

                      <View style={styles.aiThresholdBox}>
                        <Text style={styles.aiThresholdLabel}>
                          CASE RISK
                        </Text>
                        <Text style={styles.aiThresholdValue}>
                          {Math.round(
                            intel!.assessment
                              .caseRiskScore as number
                          )}
                          <Text style={styles.aiThresholdMaximum}>
                            /100
                          </Text>
                        </Text>
                      </View>
                    </View>

                    <View style={styles.aiScoreTrack}>
                      <View
                        style={[
                          styles.aiScoreFill,
                          {
                            width: `${Math.min(
                              100,
                              Math.max(
                                0,
                                intel!.assessment
                                  .caseRiskScore as number
                              )
                            )}%`,
                            backgroundColor: badgeColor,
                          },
                        ]}
                      />
                    </View>

                    <View style={styles.reportSignalMetrics}>
                      <View style={styles.reportSignalMetric}>
                        <Text style={styles.reportSignalMetricValue}>
                          {scoreOrDash(
                            intel!.reporter.credibilityScore
                          )}
                        </Text>
                        <Text style={styles.reportSignalMetricLabel}>
                          REPORTER
                        </Text>
                      </View>
                      <View style={styles.reportSignalDivider} />
                      <View style={styles.reportSignalMetric}>
                        <Text style={styles.reportSignalMetricValue}>
                          {scoreOrDash(intel!.target.riskScore)}
                        </Text>
                        <Text style={styles.reportSignalMetricLabel}>
                          TARGET RISK
                        </Text>
                      </View>
                      <View style={styles.reportSignalDivider} />
                      <View style={styles.reportSignalMetric}>
                        <Text style={styles.reportSignalMetricValue}>
                          {scoreOrDash(
                            intel!.evidence.strengthScore
                          )}
                        </Text>
                        <Text style={styles.reportSignalMetricLabel}>
                          EVIDENCE
                        </Text>
                      </View>
                    </View>

                    <View style={styles.aiIdentityRow}>
                      <View style={styles.aiIdentityItem}>
                        <Text style={styles.aiIdentityLabel}>
                          UNIQUE REPORTERS
                        </Text>
                        <Text style={styles.aiIdentityValue}>
                          {intel!.target.uniqueReporters}
                        </Text>
                      </View>
                      <View style={styles.aiIdentityDivider} />
                      <View style={styles.aiIdentityItem}>
                        <Text style={styles.aiIdentityLabel}>
                          CONFIRMED VIOLATIONS
                        </Text>
                        <Text style={styles.aiIdentityValue}>
                          {intel!.target.confirmedViolations}
                        </Text>
                      </View>
                      <View style={styles.aiIdentityDivider} />
                      <View style={styles.aiIdentityItem}>
                        <Text style={styles.aiIdentityLabel}>
                          REPORT VOLUME
                        </Text>
                        <Text style={styles.aiIdentityValue}>
                          {intel!.target.totalReports}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.aiVoteTitle}>
                      Credibility:{" "}
                      {String(
                        intel!.reporter.credibilityLevel
                      ).toUpperCase()}
                      {intel!.reporter.accuracyPercent == null
                        ? " · accuracy n/a"
                        : ` · accuracy ${intel!.reporter.accuracyPercent}%`}
                    </Text>

                    {intel!.patterns.length ? (
                      <View style={{ marginTop: 12, gap: 8 }}>
                        <Text style={styles.aiThresholdLabel}>
                          DETECTED BEHAVIOR PATTERNS
                        </Text>
                        {intel!.patterns.map((pattern) => (
                          <View
                            key={`${pattern.type}-${pattern.title}`}
                            style={styles.aiVoteExplanation}
                          >
                            <Ionicons
                              name="alert-circle-outline"
                              size={18}
                              color={
                                pattern.severity === "high"
                                  ? RED
                                  : pattern.severity === "medium"
                                    ? ORANGE
                                    : BLUE
                              }
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.aiVoteTitle}>
                                {pattern.title}
                              </Text>
                              <Text style={styles.aiVoteText}>
                                {pattern.explanation}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    <View style={{ marginTop: 12, gap: 6 }}>
                      <Text style={styles.aiThresholdLabel}>
                        REASONING
                      </Text>
                      {intel!.assessment.reasoning.map(
                        (line, index) => (
                          <Text
                            key={`reason-${index}`}
                            style={styles.aiVoteText}
                          >
                            • {line}
                          </Text>
                        )
                      )}
                    </View>

                    <Text style={styles.aiDecisionNotice}>
                      Human review required. Heuristic Case
                      Intelligence is decision-support only and
                      does not auto-enforce. Report volume is a
                      supporting statistic, not the main
                      severity score.
                    </Text>
                  </>
                ) : null}
              </View>
            );
          })()}

          {report.targetPreview ? (
            <>
              <Text style={styles.sectionLabel}>
                EVIDENCE PREVIEW
              </Text>

              <Pressable
                onPress={
                  handleOpenReportedTarget
                }
                accessibilityRole="button"
                accessibilityLabel="Open original evidence"
                style={({ pressed }) => [
                  styles.evidenceCard,
                  styles.openableEvidenceCard,
                  pressed &&
                    styles.openableTargetCardPressed,
                ]}
              >
                {(() => {
                  const evidenceThumbUri =
                    toRenderableImageUri(
                      report.targetThumbnailUri
                    ) ||
                    (
                      report.targetMediaType ===
                        "image"
                        ? toRenderableImageUri(
                            report.targetMediaUri
                          )
                        : null
                    );

                  return evidenceThumbUri ? (
                  <View style={styles.evidenceThumbnailWrap}>
                    <Image
                      source={{
                        uri: evidenceThumbUri,
                      }}
                      style={
                        styles.evidenceThumbnail
                      }
                    />

                    {report.targetMediaType ===
                    "video" ? (
                      <View style={styles.evidencePlayOverlay}>
                        <Ionicons
                          name="play"
                          size={20}
                          color={TEXT}
                        />
                      </View>
                    ) : null}
                  </View>
                  ) : (
                  <View
                    style={
                      styles.evidenceMediaIcon
                    }
                  >
                    <Ionicons
                      name={
                        report.targetMediaType ===
                        "video"
                          ? "play-circle-outline"
                          : report.targetMediaType ===
                              "image"
                            ? "image-outline"
                            : report.targetMediaType ===
                                "audio"
                              ? "volume-high-outline"
                              : "document-text-outline"
                      }
                      size={27}
                      color={PURPLE}
                    />
                  </View>
                  );
                })()}

                <View style={{ flex: 1 }}>
                  <View style={styles.evidenceHeaderRow}>
                    <Text style={styles.evidenceType}>
                      {formatLabel(
                        report.targetMediaType ||
                          report.targetType
                      )}
                    </Text>

                    <View style={styles.liveEvidenceBadge}>
                      <Text style={styles.liveEvidenceBadgeText}>
                        ORIGINAL
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.evidenceText}>
                    {report.targetPreview}
                  </Text>

                  <View style={styles.evidenceContextRow}>
                    <Text style={styles.evidenceContext}>
                      Source:{" "}
                      {formatLabel(
                        report.sourceType
                      )}
                    </Text>

                    {report.targetCreatedAt ? (
                      <Text style={styles.evidenceContext}>
                        {formatDateTime(
                          report.targetCreatedAt
                        )}
                      </Text>
                    ) : null}
                  </View>

                  <View
                    style={[
                      styles.originalStatus,
                      report.originalContentAvailable ===
                        false &&
                        styles.originalStatusMissing,
                    ]}
                  >
                    <Ionicons
                      name={
                        report.originalContentAvailable ===
                        false
                          ? "alert-circle-outline"
                          : "checkmark-circle-outline"
                      }
                      size={14}
                      color={
                        report.originalContentAvailable ===
                        false
                          ? RED
                          : GREEN
                      }
                    />

                    <Text
                      style={[
                        styles.originalStatusText,
                        report.originalContentAvailable ===
                          false &&
                          styles.originalStatusTextMissing,
                      ]}
                    >
                      {report.originalContentAvailable ===
                      false
                        ? "ORIGINAL CONTENT UNAVAILABLE — SNAPSHOT SHOWN"
                        : "LIVE ORIGINAL CONTENT"}
                    </Text>
                  </View>
                </View>
                <View style={styles.evidenceOpenFooter}>
                  <Ionicons
                    name="open-outline"
                    size={15}
                    color={GOLD}
                  />

                  <Text style={styles.evidenceOpenFooterText}>
                    OPEN ORIGINAL EVIDENCE
                  </Text>
                </View>
              </Pressable>
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
                {isAgentView
                  ? "Assigned to you"
                  : assignedAgent
                    ? assignedAgent.kristoId ||
                      assignedAgent.userId
                    : "No agent assigned"}
              </Text>

              <Text style={styles.assignmentMeta}>
                {isAgentView
                  ? "This case is assigned to your Safety Agent account."
                  : assignedAgent
                    ? `${assignedAgent.open} open • ${assignedAgent.inReview} in review • ${assignedAgent.resolved} resolved`
                    : `${activeAgents.length} active agents available`}
              </Text>
            </View>

            {canAssignAgent ? (
              <Pressable
                disabled={
                  assigningAgentUserId !==
                    "" ||
                  report.status ===
                    "resolved" ||
                  report.status ===
                    "dismissed"
                }
                onPress={() =>
                  setShowAgentPicker(
                    (current) =>
                      !current
                  )
                }
                style={({ pressed }) => [
                  styles.assignAgentButton,
                  pressed && {
                    opacity: 0.75,
                  },
                ]}
              >
                <Ionicons
                  name={
                    showAgentPicker
                      ? "chevron-up"
                      : assignedAgent
                        ? "swap-horizontal-outline"
                        : "person-add-outline"
                  }
                  size={16}
                  color="#07111F"
                />

                <Text
                  style={
                    styles.assignAgentButtonText
                  }
                >
                  {assignedAgent
                    ? "Change"
                    : "Assign"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {canAssignAgent &&
          showAgentPicker ? (
            <View style={styles.agentPicker}>
              <View
                style={
                  styles.agentPickerHeader
                }
              >
                <View>
                  <Text
                    style={
                      styles.agentPickerTitle
                    }
                  >
                    Select Safety Agent
                  </Text>

                  <Text
                    style={
                      styles.agentPickerSubtitle
                    }
                  >
                    Active agents from your team
                  </Text>
                </View>

                <Text
                  style={
                    styles.agentPickerCount
                  }
                >
                  {activeAgents.length}
                </Text>
              </View>

              {activeAgents.length ? (
                activeAgents.map(
                  (
                    agent:
                      SafetySupervisorDashboardResponse["agents"][number]
                  ) => {
                    const selected =
                      report.assignedAgentUserId ===
                      agent.userId;

                    const assigning =
                      assigningAgentUserId ===
                      agent.userId;

                    return (
                      <Pressable
                        key={[
                          agent.userId,
                          agent.churchId,
                        ].join(":")}
                        disabled={
                          Boolean(
                            assigningAgentUserId
                          )
                        }
                        onPress={() =>
                          assignToAgent(
                            agent
                          )
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.agentPickerRow,
                          selected &&
                            styles.agentPickerRowSelected,
                          pressed && {
                            opacity: 0.75,
                          },
                        ]}
                      >
                        <View
                          style={
                            styles.agentPickerAvatar
                          }
                        >
                          <Ionicons
                            name="person-outline"
                            size={20}
                            color={
                              selected
                                ? GREEN
                                : BLUE
                            }
                          />
                        </View>

                        <View
                          style={{
                            flex: 1,
                          }}
                        >
                          <Text
                            style={
                              styles.agentPickerName
                            }
                          >
                            {agent.kristoId ||
                              agent.userId}
                          </Text>

                          <Text
                            style={
                              styles.agentPickerMeta
                            }
                          >
                            {agent.open} open •{" "}
                            {agent.inReview} review •{" "}
                            {agent.resolved} resolved
                          </Text>
                        </View>

                        {assigning ? (
                          <ActivityIndicator
                            size="small"
                            color={GOLD}
                          />
                        ) : selected ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={23}
                            color={GREEN}
                          />
                        ) : (
                          <Ionicons
                            name="chevron-forward"
                            size={20}
                            color={MUTED}
                          />
                        )}
                      </Pressable>
                    );
                  }
                )
              ) : (
                <View
                  style={
                    styles.noActiveAgents
                  }
                >
                  <Ionicons
                    name="people-outline"
                    size={27}
                    color={MUTED}
                  />

                  <Text
                    style={
                      styles.noActiveAgentsText
                    }
                  >
                    No active agents. An invited member must accept the Safety Agent role first.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>
            {isAgentView
              ? "INVESTIGATION PROGRESS"
              : "OPERATION TIMELINE"}
          </Text>

          <View style={styles.timelineCard}>
            {timelineSteps.map(
              (step, index) => (
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

                  {index <
                  timelineSteps.length -
                    1 ? (
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

          {canIssueDecision ? (
            <>
              <Text style={styles.sectionLabel}>
                DECISION CENTER
              </Text>

              {caseCompleted &&
              report.decisionType ? (
                <View style={styles.decisionReceipt}>
                  <View style={styles.decisionReceiptTop}>
                    <View style={styles.decisionReceiptIcon}>
                      <Ionicons
                        name="shield-checkmark-outline"
                        size={25}
                        color={GREEN}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.decisionReceiptEyebrow}>
                        FINAL DECISION
                      </Text>

                      <Text style={styles.decisionReceiptTitle}>
                        {formatLabel(
                          report.decisionType
                        )}
                      </Text>
                    </View>

                    <Ionicons
                      name="checkmark-circle"
                      size={27}
                      color={GREEN}
                    />
                  </View>

                  <Text style={styles.decisionReceiptReason}>
                    {report.decisionReason ||
                      "Decision recorded."}
                  </Text>

                  <View style={styles.decisionReceiptMetaRow}>
                    <Text style={styles.decisionReceiptMeta}>
                      Investigator confidence:{" "}
                      {report.decisionConfidence ??
                        "—"}
                      %
                    </Text>

                    <Text style={styles.decisionReceiptMeta}>
                      {report.decisionAt
                        ? formatDateTime(
                            report.decisionAt
                          )
                        : formatDateTime(
                            report.updatedAt
                          )}
                    </Text>
                  </View>
                </View>
              ) : report.status ===
                "escalated" &&
                report.decisionType ===
                  "escalate" ? (
                <View style={styles.escalatedReceipt}>
                  <Ionicons
                    name="arrow-up-circle-outline"
                    size={28}
                    color={PURPLE}
                  />

                  <View style={{ flex: 1 }}>
                    <Text style={styles.escalatedReceiptTitle}>
                      Escalated for review
                    </Text>

                    <Text style={styles.escalatedReceiptText}>
                      {report.decisionReason ||
                        "This case is awaiting higher Safety authority."}
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.decisionIntroCard}>
                    <View style={styles.decisionIntroIcon}>
                      <Ionicons
                        name="scale-outline"
                        size={24}
                        color={GOLD}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.decisionIntroTitle}>
                        Issue a case decision
                      </Text>

                      <Text style={styles.decisionIntroText}>
                        Review the evidence, select the appropriate enforcement action and record a clear reason.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.decisionGrid}>
                    {DECISION_OPTIONS.map(
                      (option) => {
                        const locked =
                          option.supervisorOnly &&
                          isAgentView;

                        return (
                          <Pressable
                            key={option.type}
                            onPress={() =>
                              openDecisionModal(
                                option
                              )
                            }
                            style={({
                              pressed,
                            }) => [
                              styles.decisionCard,
                              {
                                borderColor:
                                  `${option.accent}44`,
                                backgroundColor:
                                  `${option.accent}0D`,
                              },
                              locked &&
                                styles.decisionCardLocked,
                              pressed &&
                                !locked && {
                                  opacity: 0.72,
                                  transform: [
                                    {
                                      scale:
                                        0.985,
                                    },
                                  ],
                                },
                            ]}
                          >
                            <View
                              style={[
                                styles.decisionCardIcon,
                                {
                                  backgroundColor:
                                    `${option.accent}18`,
                                },
                              ]}
                            >
                              <Ionicons
                                name={
                                  option.icon
                                }
                                size={24}
                                color={
                                  option.accent
                                }
                              />
                            </View>

                            <Text style={styles.decisionCardTitle}>
                              {option.title}
                            </Text>

                            <Text style={styles.decisionCardDescription}>
                              {option.description}
                            </Text>

                            <View style={styles.decisionCardFooter}>
                              <Text
                                style={[
                                  styles.decisionCardAction,
                                  {
                                    color:
                                      option.accent,
                                  },
                                ]}
                              >
                                {locked
                                  ? "SUPERVISOR ONLY"
                                  : "SELECT"}
                              </Text>

                              <Ionicons
                                name={
                                  locked
                                    ? "lock-closed-outline"
                                    : "arrow-forward-outline"
                                }
                                size={15}
                                color={
                                  locked
                                    ? MUTED
                                    : option.accent
                                }
                              />
                            </View>
                          </Pressable>
                        );
                      }
                    )}
                  </View>
                </>
              )}

              <View style={styles.phaseNotice}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={24}
                  color={GOLD}
                />

                <View style={{ flex: 1 }}>
                  <Text style={styles.phaseTitle}>
                    {isAgentView
                      ? "Agent authority"
                      : "Supervisor authority"}
                  </Text>

                  <Text style={styles.phaseText}>
                    {isAgentView
                      ? "You may issue ordinary case decisions for reports assigned to you. Permanent account bans require Supervisor approval and must be escalated."
                      : "You may issue every Safety decision for cases assigned to you, including permanent bans. Every decision writes an enforcement receipt and audit trail."}
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <View
              style={
                styles.phaseNotice
              }
            >
              <Ionicons
                name="shield-outline"
                size={24}
                color={GOLD}
              />

              <View
                style={{
                  flex: 1,
                }}
              >
                <Text
                  style={
                    styles.phaseTitle
                  }
                >
                  Decision access unavailable
                </Text>

                <Text
                  style={
                    styles.phaseText
                  }
                >
                  This Safety account cannot issue decisions on the current case.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      <Modal
        visible={
          selectedDecision !==
          null
        }
        transparent
        animationType="slide"
        onRequestClose={
          closeDecisionModal
        }
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={
              StyleSheet.absoluteFillObject
            }
            onPress={
              closeDecisionModal
            }
          />

          <View
            style={[
              styles.decisionModal,
              {
                paddingBottom:
                  insets.bottom + 18,
              },
            ]}
          >
            <View style={styles.modalHandle} />

            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>
                  ISSUE DECISION
                </Text>

                <Text style={styles.modalTitle}>
                  {formatLabel(
                    selectedDecision
                  )}
                </Text>
              </View>

              <Pressable
                disabled={
                  issuingDecision
                }
                onPress={
                  closeDecisionModal
                }
                style={styles.modalCloseButton}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={TEXT}
                />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={
                false
              }
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>
                DECISION REASON
              </Text>

              <TextInput
                value={
                  decisionReason
                }
                onChangeText={
                  setDecisionReason
                }
                placeholder="Explain the facts, evidence and policy basis for this decision…"
                placeholderTextColor="rgba(255,255,255,0.28)"
                multiline
                maxLength={4000}
                style={[
                  styles.decisionInput,
                  styles.decisionReasonInput,
                ]}
              />

              <View style={styles.characterRow}>
                <Text style={styles.characterHint}>
                  Minimum 8 characters
                </Text>

                <Text style={styles.characterCount}>
                  {decisionReason.length}/4000
                </Text>
              </View>

              <Text style={styles.fieldLabel}>
                INTERNAL NOTES
              </Text>

              <TextInput
                value={
                  decisionNotes
                }
                onChangeText={
                  setDecisionNotes
                }
                placeholder="Private notes for the Safety audit trail…"
                placeholderTextColor="rgba(255,255,255,0.28)"
                multiline
                maxLength={12000}
                style={[
                  styles.decisionInput,
                  styles.decisionNotesInput,
                ]}
              />

              <Text style={styles.fieldLabel}>
                CONFIDENCE
              </Text>

              <View style={styles.choiceRow}>
                {[60, 75, 90, 100].map(
                  (value) => (
                    <Pressable
                      key={value}
                      onPress={() =>
                        setDecisionConfidence(
                          value
                        )
                      }
                      style={[
                        styles.choiceChip,
                        decisionConfidence ===
                          value &&
                          styles.choiceChipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          decisionConfidence ===
                            value &&
                            styles.choiceChipTextSelected,
                        ]}
                      >
                        {value}%
                      </Text>
                    </Pressable>
                  )
                )}
              </View>

              {selectedDecision ===
                "restrict_account" ||
              selectedDecision ===
                "suspend_account" ? (
                <>
                  <Text style={styles.fieldLabel}>
                    DURATION
                  </Text>

                  <View style={styles.choiceRow}>
                    {[1, 3, 7, 14, 30, 90].map(
                      (value) => (
                        <Pressable
                          key={value}
                          onPress={() =>
                            setDecisionDurationDays(
                              value
                            )
                          }
                          style={[
                            styles.choiceChip,
                            decisionDurationDays ===
                              value &&
                              styles.choiceChipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.choiceChipText,
                              decisionDurationDays ===
                                value &&
                                styles.choiceChipTextSelected,
                            ]}
                          >
                            {value}d
                          </Text>
                        </Pressable>
                      )
                    )}
                  </View>
                </>
              ) : null}

              <View style={styles.decisionWarning}>
                <Ionicons
                  name="information-circle-outline"
                  size={21}
                  color={GOLD}
                />

                <Text style={styles.decisionWarningText}>
                  This action will be recorded with your user ID, authority role, confidence and timestamp in the permanent Safety audit trail.
                </Text>
              </View>

              <Pressable
                disabled={
                  issuingDecision ||
                  decisionReason.trim()
                    .length < 8
                }
                onPress={() =>
                  void submitDecision()
                }
                style={({ pressed }) => [
                  styles.submitDecisionButton,
                  (
                    issuingDecision ||
                    decisionReason.trim()
                      .length < 8
                  ) &&
                    styles.submitDecisionButtonDisabled,
                  pressed &&
                    !issuingDecision && {
                      opacity: 0.78,
                    },
                ]}
              >
                {issuingDecision ? (
                  <ActivityIndicator
                    size="small"
                    color={BG}
                  />
                ) : (
                  <Ionicons
                    name="shield-checkmark"
                    size={20}
                    color={BG}
                  />
                )}

                <Text style={styles.submitDecisionButtonText}>
                  {issuingDecision
                    ? "Issuing decision…"
                    : selectedDecision ===
                        "escalate"
                      ? "Escalate Case"
                      : "Issue Decision"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
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

    openableTargetCard: {
      position: "relative",
      paddingRight: 82,
    },

    openableTargetCardPressed: {
      opacity: 0.74,
      transform: [
        {
          scale: 0.992,
        },
      ],
    },

    openTargetAction: {
      position: "absolute",
      right: 17,
      top: "50%",
      marginTop: -18,
      minHeight: 36,
      paddingHorizontal: 10,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.22)",
      backgroundColor:
        "rgba(244,208,111,0.08)",
    },

    openTargetActionText: {
      color: GOLD,
      fontSize: 8,
      fontWeight: "900",
      letterSpacing: 0.65,
    },

    reportSignalCard: {
      marginTop: 11,
      padding: 15,
      borderRadius: 21,
      borderWidth: 1,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },

    reportSignalIcon: {
      width: 48,
      height: 48,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },

    reportSignalMain: {
      flex: 1,
    },

    reportSignalTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },

    reportSignalTitle: {
      color: TEXT,
      fontSize: 13,
      fontWeight: "900",
    },

    reportSignalBadge: {
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
    },

    reportSignalBadgeText: {
      fontSize: 7,
      fontWeight: "900",
      letterSpacing: 0.45,
    },

    reportSignalCount: {
      marginTop: 9,
      color: TEXT,
      fontSize: 25,
      fontWeight: "900",
    },

    reportSignalCountLabel: {
      color: MUTED,
      fontSize: 12,
      fontWeight: "800",
    },

    reportSignalDescription: {
      marginTop: 3,
      color: MUTED,
      fontSize: 9,
      lineHeight: 14,
      fontWeight: "700",
    },

    reportSignalMetrics: {
      marginTop: 13,
      paddingTop: 12,
      flexDirection: "row",
      alignItems: "stretch",
      borderTopWidth: 1,
      borderTopColor:
        "rgba(255,255,255,0.08)",
    },

    reportSignalMetric: {
      flex: 1,
      alignItems: "center",
    },

    reportSignalMetricValue: {
      color: TEXT,
      fontSize: 14,
      fontWeight: "900",
    },

    reportSignalMetricLabel: {
      marginTop: 3,
      color:
        "rgba(255,255,255,0.38)",
      fontSize: 7,
      fontWeight: "900",
      letterSpacing: 0.4,
    },

    reportSignalDivider: {
      width: 1,
      marginHorizontal: 8,
      backgroundColor:
        "rgba(255,255,255,0.08)",
    },

    aiSignalCard: {
      marginTop: 11,
      padding: 17,
      borderRadius: 23,
      borderWidth: 1,
      borderColor:
        "rgba(196,181,253,0.26)",
      backgroundColor:
        "rgba(196,181,253,0.065)",
    },

    aiSignalCardAction: {
      borderColor:
        "rgba(251,113,133,0.34)",
      backgroundColor:
        "rgba(251,113,133,0.07)",
    },

    aiSignalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },

    aiSignalBrand: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    aiSignalBrandIcon: {
      width: 45,
      height: 45,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(196,181,253,0.13)",
    },

    aiSignalBrandIconAction: {
      backgroundColor:
        "rgba(251,113,133,0.13)",
    },

    aiSignalEyebrow: {
      color: PURPLE,
      fontSize: 7,
      fontWeight: "900",
      letterSpacing: 0.8,
    },

    aiSignalTitle: {
      marginTop: 4,
      color: TEXT,
      fontSize: 13,
      fontWeight: "900",
    },

    aiSignalStatusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor:
        "rgba(196,181,253,0.12)",
    },

    aiSignalStatusBadgeAction: {
      backgroundColor:
        "rgba(251,113,133,0.13)",
    },

    aiSignalStatusText: {
      color: PURPLE,
      fontSize: 7,
      fontWeight: "900",
      letterSpacing: 0.45,
    },

    aiSignalStatusTextAction: {
      color: RED,
    },

    aiScoreRow: {
      marginTop: 19,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    aiScoreValue: {
      color: TEXT,
      fontSize: 33,
      fontWeight: "900",
    },

    aiScoreMaximum: {
      color: MUTED,
      fontSize: 14,
      fontWeight: "800",
    },

    aiScorePercent: {
      marginTop: 2,
      color: MUTED,
      fontSize: 9,
      fontWeight: "800",
    },

    aiThresholdBox: {
      minWidth: 86,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 15,
      alignItems: "center",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.09)",
      backgroundColor:
        "rgba(255,255,255,0.045)",
    },

    aiThresholdLabel: {
      color:
        "rgba(255,255,255,0.38)",
      fontSize: 7,
      fontWeight: "900",
    },

    aiThresholdValue: {
      marginTop: 4,
      color: GOLD,
      fontSize: 17,
      fontWeight: "900",
    },

    aiThresholdMaximum: {
      color:
        "rgba(255,255,255,0.38)",
      fontSize: 9,
      fontWeight: "800",
    },

    aiScoreTrack: {
      height: 8,
      marginTop: 14,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor:
        "rgba(255,255,255,0.07)",
    },

    aiScoreFill: {
      height: "100%",
      borderRadius: 999,
    },

    aiVoteExplanation: {
      marginTop: 16,
      padding: 13,
      borderRadius: 17,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderColor:
        "rgba(125,190,255,0.15)",
      backgroundColor:
        "rgba(125,190,255,0.055)",
    },

    aiVoteTitle: {
      color: TEXT,
      fontSize: 10,
      fontWeight: "900",
    },

    aiVoteText: {
      marginTop: 4,
      color: MUTED,
      fontSize: 8,
      lineHeight: 13,
      fontWeight: "700",
    },

    aiVotePercent: {
      color: BLUE,
      fontSize: 17,
      fontWeight: "900",
    },

    aiIdentityRow: {
      marginTop: 14,
      flexDirection: "row",
      alignItems: "stretch",
    },

    aiIdentityItem: {
      flex: 1,
    },

    aiIdentityDivider: {
      width: 1,
      marginHorizontal: 14,
      backgroundColor:
        "rgba(255,255,255,0.08)",
    },

    aiIdentityLabel: {
      color:
        "rgba(255,255,255,0.34)",
      fontSize: 7,
      fontWeight: "900",
      letterSpacing: 0.4,
    },

    aiIdentityValue: {
      marginTop: 5,
      color: TEXT,
      fontSize: 10,
      fontWeight: "900",
    },

    aiDecisionNotice: {
      marginTop: 15,
      paddingTop: 13,
      color: MUTED,
      fontSize: 9,
      lineHeight: 15,
      fontWeight: "700",
      borderTopWidth: 1,
      borderTopColor:
        "rgba(255,255,255,0.08)",
    },

    openableEvidenceCard: {
      position: "relative",
      paddingBottom: 54,
    },

    evidenceOpenFooter: {
      position: "absolute",
      left: 18,
      right: 18,
      bottom: 13,
      minHeight: 32,
      borderRadius: 11,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.17)",
      backgroundColor:
        "rgba(244,208,111,0.065)",
    },

    evidenceOpenFooterText: {
      color: GOLD,
      fontSize: 8,
      fontWeight: "900",
      letterSpacing: 0.55,
    },

    identityTechnicalId: {
      marginTop: 4,
      color:
        "rgba(255,255,255,0.30)",
      fontSize: 8,
      lineHeight: 12,
      fontWeight: "700",
    },

    profileResolvedBadge: {
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor:
        "rgba(110,231,183,0.10)",
    },

    profileResolvedText: {
      color: GREEN,
      fontSize: 7,
      fontWeight: "900",
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

    assignAgentButton: {
      minHeight: 38,
      paddingHorizontal: 11,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      backgroundColor: GOLD,
    },

    assignAgentButtonText: {
      color: "#07111F",
      fontSize: 9,
      fontWeight: "900",
    },

    agentPicker: {
      marginTop: 10,
      padding: 13,
      borderRadius: 19,
      gap: 8,
      backgroundColor:
        "rgba(255,255,255,0.045)",
      borderWidth: 1,
      borderColor:
        "rgba(196,181,253,0.19)",
    },

    agentPickerHeader: {
      marginBottom: 3,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    agentPickerTitle: {
      color: TEXT,
      fontSize: 13,
      fontWeight: "900",
    },

    agentPickerSubtitle: {
      marginTop: 3,
      color: MUTED,
      fontSize: 9,
      fontWeight: "700",
    },

    agentPickerCount: {
      color: PURPLE,
      fontSize: 16,
      fontWeight: "900",
    },

    agentPickerRow: {
      minHeight: 62,
      paddingHorizontal: 11,
      paddingVertical: 9,
      borderRadius: 15,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor:
        "rgba(147,197,253,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(147,197,253,0.13)",
    },

    agentPickerRowSelected: {
      backgroundColor:
        "rgba(110,231,183,0.07)",
      borderColor:
        "rgba(110,231,183,0.28)",
    },

    agentPickerAvatar: {
      width: 41,
      height: 41,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(147,197,253,0.10)",
    },

    agentPickerName: {
      color: TEXT,
      fontSize: 12,
      fontWeight: "900",
    },

    agentPickerMeta: {
      marginTop: 4,
      color: MUTED,
      fontSize: 8,
      fontWeight: "700",
    },

    noActiveAgents: {
      paddingVertical: 18,
      paddingHorizontal: 12,
      alignItems: "center",
    },

    noActiveAgentsText: {
      marginTop: 8,
      color: MUTED,
      fontSize: 10,
      lineHeight: 16,
      textAlign: "center",
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

    workflowCard: {
      paddingHorizontal: 15,
      borderRadius: 20,
      backgroundColor:
        "rgba(255,255,255,0.04)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.075)",
    },

    workflowRow: {
      minHeight: 88,
      paddingVertical: 15,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },

    workflowRowBorder: {
      borderTopWidth: 1,
      borderTopColor:
        "rgba(255,255,255,0.07)",
    },

    workflowIcon: {
      width: 43,
      height: 43,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.075)",
    },

    workflowIconReady: {
      backgroundColor:
        "rgba(110,231,183,0.09)",
      borderColor:
        "rgba(110,231,183,0.24)",
    },

    workflowTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },

    workflowTitle: {
      flex: 1,
      color: TEXT,
      fontSize: 12,
      fontWeight: "900",
    },

    workflowDescription: {
      marginTop: 5,
      color: MUTED,
      fontSize: 10,
      lineHeight: 16,
      fontWeight: "700",
    },

    workflowBadge: {
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor:
        "rgba(255,255,255,0.055)",
    },

    workflowBadgeReady: {
      backgroundColor:
        "rgba(110,231,183,0.10)",
    },

    workflowBadgeText: {
      color:
        "rgba(255,255,255,0.38)",
      fontSize: 7,
      fontWeight: "900",
    },

    workflowBadgeTextReady: {
      color: GREEN,
    },

    heroMetricRow: {
      marginTop: 18,
      paddingTop: 16,
      flexDirection: "row",
      alignItems: "stretch",
      borderTopWidth: 1,
      borderTopColor:
        "rgba(255,255,255,0.08)",
    },

    heroMetric: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },

    heroMetricDivider: {
      width: 1,
      marginHorizontal: 8,
      backgroundColor:
        "rgba(255,255,255,0.08)",
    },

    heroMetricValue: {
      color: TEXT,
      fontSize: 11,
      fontWeight: "900",
      textAlign: "center",
    },

    heroMetricLabel: {
      marginTop: 4,
      color:
        "rgba(255,255,255,0.40)",
      fontSize: 8,
      fontWeight: "800",
      textAlign: "center",
      textTransform: "uppercase",
    },

    evidenceThumbnailWrap: {
      width: 92,
      height: 92,
      borderRadius: 17,
      overflow: "hidden",
      position: "relative",
      backgroundColor:
        "rgba(255,255,255,0.05)",
    },

    evidenceThumbnail: {
      width: "100%",
      height: "100%",
      borderRadius: 17,
      backgroundColor:
        "rgba(255,255,255,0.05)",
    },

    evidencePlayOverlay: {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: 42,
      height: 42,
      marginLeft: -21,
      marginTop: -21,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(0,0,0,0.65)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.24)",
    },

    evidenceMediaIcon: {
      width: 52,
      height: 52,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(196,181,253,0.11)",
    },

    evidenceHeaderRow: {
      marginBottom: 7,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },

    evidenceType: {
      color: PURPLE,
      fontSize: 9,
      fontWeight: "900",
      textTransform: "uppercase",
    },

    liveEvidenceBadge: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor:
        "rgba(110,231,183,0.10)",
    },

    liveEvidenceBadgeText: {
      color: GREEN,
      fontSize: 7,
      fontWeight: "900",
    },

    evidenceContextRow: {
      marginTop: 9,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },

    evidenceContext: {
      color:
        "rgba(255,255,255,0.38)",
      fontSize: 8,
      fontWeight: "700",
    },

    originalStatus: {
      marginTop: 10,
      paddingHorizontal: 9,
      paddingVertical: 6,
      alignSelf: "flex-start",
      borderRadius: 999,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor:
        "rgba(110,231,183,0.09)",
    },

    originalStatusMissing: {
      backgroundColor:
        "rgba(251,113,133,0.09)",
    },

    originalStatusText: {
      color: GREEN,
      fontSize: 7,
      fontWeight: "900",
    },

    originalStatusTextMissing: {
      color: RED,
    },

    decisionIntroCard: {
      padding: 16,
      borderRadius: 21,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.19)",
      backgroundColor:
        "rgba(244,208,111,0.065)",
    },

    decisionIntroIcon: {
      width: 47,
      height: 47,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.12)",
    },

    decisionIntroTitle: {
      color: TEXT,
      fontSize: 14,
      fontWeight: "900",
    },

    decisionIntroText: {
      marginTop: 5,
      color: MUTED,
      fontSize: 10,
      lineHeight: 16,
      fontWeight: "700",
    },

    decisionGrid: {
      marginTop: 11,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },

    decisionCard: {
      width: "48.5%",
      minHeight: 190,
      padding: 14,
      borderRadius: 21,
      borderWidth: 1,
    },

    decisionCardLocked: {
      opacity: 0.52,
    },

    decisionCardIcon: {
      width: 45,
      height: 45,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },

    decisionCardTitle: {
      marginTop: 13,
      color: TEXT,
      fontSize: 13,
      fontWeight: "900",
    },

    decisionCardDescription: {
      flex: 1,
      marginTop: 7,
      color: MUTED,
      fontSize: 9,
      lineHeight: 14,
      fontWeight: "700",
    },

    decisionCardFooter: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    decisionCardAction: {
      fontSize: 8,
      fontWeight: "900",
      letterSpacing: 0.55,
    },

    decisionReceipt: {
      padding: 18,
      borderRadius: 23,
      borderWidth: 1,
      borderColor:
        "rgba(110,231,183,0.27)",
      backgroundColor:
        "rgba(110,231,183,0.075)",
    },

    decisionReceiptTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    decisionReceiptIcon: {
      width: 49,
      height: 49,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(110,231,183,0.12)",
    },

    decisionReceiptEyebrow: {
      color: GREEN,
      fontSize: 8,
      fontWeight: "900",
      letterSpacing: 0.8,
    },

    decisionReceiptTitle: {
      marginTop: 4,
      color: TEXT,
      fontSize: 18,
      fontWeight: "900",
    },

    decisionReceiptReason: {
      marginTop: 15,
      color: TEXT,
      fontSize: 11,
      lineHeight: 18,
      fontWeight: "700",
    },

    decisionReceiptMetaRow: {
      marginTop: 16,
      paddingTop: 13,
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
      borderTopWidth: 1,
      borderTopColor:
        "rgba(110,231,183,0.16)",
    },

    decisionReceiptMeta: {
      color:
        "rgba(255,255,255,0.47)",
      fontSize: 8,
      fontWeight: "800",
    },

    escalatedReceipt: {
      padding: 17,
      borderRadius: 22,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      borderWidth: 1,
      borderColor:
        "rgba(196,181,253,0.25)",
      backgroundColor:
        "rgba(196,181,253,0.075)",
    },

    escalatedReceiptTitle: {
      color: TEXT,
      fontSize: 14,
      fontWeight: "900",
    },

    escalatedReceiptText: {
      marginTop: 5,
      color: MUTED,
      fontSize: 10,
      lineHeight: 16,
      fontWeight: "700",
    },

    modalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor:
        "rgba(0,0,0,0.72)",
    },

    decisionModal: {
      maxHeight: "91%",
      paddingHorizontal: 18,
      paddingTop: 10,
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor:
        "rgba(255,255,255,0.12)",
      backgroundColor: "#0B1525",
    },

    modalHandle: {
      width: 43,
      height: 5,
      marginBottom: 14,
      borderRadius: 999,
      alignSelf: "center",
      backgroundColor:
        "rgba(255,255,255,0.18)",
    },

    modalHeader: {
      marginBottom: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    modalEyebrow: {
      color: GOLD,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 1,
    },

    modalTitle: {
      marginTop: 5,
      color: TEXT,
      fontSize: 22,
      fontWeight: "900",
    },

    modalCloseButton: {
      width: 43,
      height: 43,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.10)",
      backgroundColor:
        "rgba(255,255,255,0.055)",
    },

    fieldLabel: {
      marginTop: 14,
      marginBottom: 8,
      color: GOLD,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 0.9,
    },

    decisionInput: {
      paddingHorizontal: 14,
      paddingVertical: 13,
      borderRadius: 17,
      color: TEXT,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "700",
      textAlignVertical: "top",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.10)",
      backgroundColor:
        "rgba(255,255,255,0.045)",
    },

    decisionReasonInput: {
      minHeight: 125,
    },

    decisionNotesInput: {
      minHeight: 90,
    },

    characterRow: {
      marginTop: 6,
      flexDirection: "row",
      justifyContent: "space-between",
    },

    characterHint: {
      color:
        "rgba(255,255,255,0.32)",
      fontSize: 8,
      fontWeight: "700",
    },

    characterCount: {
      color:
        "rgba(255,255,255,0.40)",
      fontSize: 8,
      fontWeight: "800",
    },

    choiceRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },

    choiceChip: {
      minWidth: 57,
      minHeight: 39,
      paddingHorizontal: 12,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.10)",
      backgroundColor:
        "rgba(255,255,255,0.045)",
    },

    choiceChipSelected: {
      borderColor:
        "rgba(244,208,111,0.45)",
      backgroundColor:
        "rgba(244,208,111,0.13)",
    },

    choiceChipText: {
      color: MUTED,
      fontSize: 10,
      fontWeight: "900",
    },

    choiceChipTextSelected: {
      color: GOLD,
    },

    decisionWarning: {
      marginTop: 20,
      padding: 14,
      borderRadius: 17,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.16)",
      backgroundColor:
        "rgba(244,208,111,0.055)",
    },

    decisionWarningText: {
      flex: 1,
      color: MUTED,
      fontSize: 9,
      lineHeight: 15,
      fontWeight: "700",
    },

    submitDecisionButton: {
      minHeight: 54,
      marginTop: 18,
      borderRadius: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      backgroundColor: GOLD,
    },

    submitDecisionButtonDisabled: {
      opacity: 0.38,
    },

    submitDecisionButtonText: {
      color: BG,
      fontSize: 13,
      fontWeight: "900",
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
