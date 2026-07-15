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
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  assignSafetyReportsToSupervisorByQuantity,
  fetchSafetySupervisorDetail,
  removeSafetySupervisor,
  type SafetySupervisorDetailResponse,
} from "@/src/lib/safetyAdminApi";

const BG = "#080C14";
const CARD = "#121722";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.58)";
const GOLD = "#F4D06F";
const PURPLE = "#A78BFA";
const GREEN = "#6EE7B7";
const BLUE = "#93C5FD";
const RED = "#FB7185";

function formatStatus(
  value: unknown
) {
  return String(
    value || "unknown"
  )
    .replace(/_/g, " ")
    .replace(
      /\b\w/g,
      (char) =>
        char.toUpperCase()
    );
}

function formatDate(
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
    return "";
  }

  return date.toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  );
}

export default function
SafetySupervisorDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params =
    useLocalSearchParams<{
      userId?: string | string[];
    }>();

  const userId =
    String(
      Array.isArray(
        params.userId
      )
        ? params.userId[0]
        : params.userId || ""
    ).trim();

  const [
    detail,
    setDetail,
  ] = React.useState<
    SafetySupervisorDetailResponse | null
  >(null);

  const [
    loading,
    setLoading,
  ] = React.useState(true);

  const [
    error,
    setError,
  ] = React.useState("");

  const [
    assignModalOpen,
    setAssignModalOpen,
  ] = React.useState(false);

  const [
    assignQuantity,
    setAssignQuantity,
  ] = React.useState("");

  const [
    assigning,
    setAssigning,
  ] = React.useState(false);

  const [
    removing,
    setRemoving,
  ] = React.useState(false);

  const load =
    React.useCallback(async () => {
      if (!userId) {
        setError(
          "Supervisor user ID is missing."
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const result =
          await fetchSafetySupervisorDetail(
            userId
          );

        setDetail(result);
      } catch (nextError: any) {
        setError(
          String(
            nextError?.message ||
            "Could not load supervisor details."
          )
        );
      } finally {
        setLoading(false);
      }
    }, [userId]);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const supervisor =
    detail?.supervisor;

  const dashboard =
    detail?.dashboard;

  const counts =
    dashboard?.counts;

  const fullName =
    String(
      supervisor?.fullName ||
      supervisor?.kristoId ||
      "Safety Supervisor"
    ).trim();

  const avatarUri =
    String(
      supervisor?.avatarUrl ||
      supervisor?.avatarUri ||
      ""
    ).trim();

  const assigned =
    Number(
      counts?.assigned || 0
    );

  const resolved =
    Number(
      counts?.resolved || 0
    );

  const resolutionRate =
    assigned > 0
      ? Math.round(
          (
            resolved /
            assigned
          ) * 100
        )
      : 0;

  const submitAssignment =
    React.useCallback(async () => {
      if (
        assigning ||
        !userId
      ) {
        return;
      }

      const quantity =
        Math.floor(
          Number(
            assignQuantity
          ) || 0
        );

      if (quantity < 1) {
        Alert.alert(
          "Invalid quantity",
          "Enter at least one report."
        );
        return;
      }

      setAssigning(true);

      try {
        const result =
          await assignSafetyReportsToSupervisorByQuantity({
            supervisorUserId:
              userId,

            quantity,
          });

        setAssignModalOpen(false);
        setAssignQuantity("");

        await load();

        Alert.alert(
          "Reports assigned",
          `${result.assignment.assignedCount} reports were assigned successfully.`
        );
      } catch (nextError: any) {
        Alert.alert(
          "Could not assign reports",
          String(
            nextError?.message ||
            "Please try again."
          )
        );
      } finally {
        setAssigning(false);
      }
    }, [
      assigning,
      userId,
      assignQuantity,
      load,
    ]);

  const confirmRemove =
    React.useCallback(() => {
      if (
        removing ||
        !userId
      ) {
        return;
      }

      Alert.alert(
        "Remove Safety Supervisor?",
        [
          fullName,
          "",
          "Safety Supervisor access will be revoked.",
          "Unfinished reports will return to the unassigned queue.",
        ].join("\n"),
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setRemoving(true);

                try {
                  const result =
                    await removeSafetySupervisor(
                      userId
                    );

                  Alert.alert(
                    "Supervisor removed",
                    result.releasedReportCount > 0
                      ? `${result.releasedReportCount} reports were returned to the unassigned queue.`
                      : "Safety Supervisor access was removed.",
                    [
                      {
                        text: "OK",
                        onPress: () =>
                          router.back(),
                      },
                    ]
                  );
                } catch (nextError: any) {
                  Alert.alert(
                    "Could not remove supervisor",
                    String(
                      nextError?.message ||
                      "Please try again."
                    )
                  );
                } finally {
                  setRemoving(false);
                }
              })();
            },
          },
        ]
      );
    }, [
      removing,
      userId,
      fullName,
      router,
    ]);

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop:
            insets.top + 10,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.back()
          }
          style={styles.back}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color="#FFF"
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Supervisor Details
          </Text>

          <Text style={styles.headerSubtitle}>
            Safety performance and workload
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            color={GOLD}
          />

          <Text style={styles.loadingText}>
            Loading supervisor…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={38}
            color={RED}
          />

          <Text style={styles.errorTitle}>
            Could not load details
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
              insets.bottom + 34,
          }}
        >
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image
                  source={{
                    uri: avatarUri,
                  }}
                  style={styles.avatarImage}
                />
              ) : (
                <Text style={styles.avatarText}>
                  {fullName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map(
                      (part) =>
                        part
                          .charAt(0)
                          .toUpperCase()
                    )
                    .join("") ||
                    "SS"}
                </Text>
              )}

              <View style={styles.activeDot} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>
                {fullName}
              </Text>

              <Text style={styles.profileId}>
                KRISTO ID: {
                  supervisor?.kristoId ||
                  "—"
                }
              </Text>

              <Text style={styles.profileId}>
                Church ID: {
                  supervisor?.churchId ||
                  "—"
                }
              </Text>

              <View style={styles.activeBadge}>
                <Text style={styles.activeText}>
                  ACTIVE SUPERVISOR
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>
            PERFORMANCE
          </Text>

          <View style={styles.metricsGrid}>
            {[
              {
                label: "Assigned",
                value: assigned,
                color: BLUE,
              },
              {
                label: "Open",
                value:
                  counts?.open || 0,
                color: GOLD,
              },
              {
                label: "In Review",
                value:
                  counts?.inReview || 0,
                color: PURPLE,
              },
              {
                label: "Resolved",
                value: resolved,
                color: GREEN,
              },
              {
                label: "Resolution Rate",
                value:
                  `${resolutionRate}%`,
                color: GREEN,
              },
              {
                label: "Escalated",
                value:
                  counts?.escalated || 0,
                color: RED,
              },
            ].map((metric) => (
              <View
                key={metric.label}
                style={styles.metricCard}
              >
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
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>
            TEAM
          </Text>

          <View style={styles.teamSummary}>
            <View style={styles.teamIcon}>
              <Ionicons
                name="people-outline"
                size={25}
                color={PURPLE}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.teamTitle}>
                Safety Agents
              </Text>

              <Text style={styles.teamMeta}>
                {counts?.activeAgents || 0} active
                {"  •  "}
                {counts?.pendingAgents || 0} pending
              </Text>
            </View>
          </View>

          {(dashboard?.agents || []).length ? (
            dashboard?.agents.map(
              (agent: any) => (
                <View
                  key={
                    agent?.userId ||
                    agent?.kristoId
                  }
                  style={styles.agentRow}
                >
                  <View style={styles.agentAvatar}>
                    <Ionicons
                      name="person-outline"
                      size={19}
                      color={BLUE}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.agentName}>
                      {agent?.kristoId ||
                      agent?.userId ||
                      "Safety Agent"}
                    </Text>

                    <Text style={styles.agentMeta}>
                      {agent?.open || 0} open
                      {"  •  "}
                      {agent?.resolved || 0} resolved
                    </Text>
                  </View>

                  <Text style={styles.agentStatus}>
                    {formatStatus(
                      agent?.status
                    )}
                  </Text>
                </View>
              )
            )
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No agents are assigned to this supervisor yet.
              </Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>
            RECENT REPORTS
          </Text>

          {(dashboard?.reports || [])
            .slice(0, 10)
            .map((report: any) => (
              <View
                key={report?.id}
                style={styles.reportCard}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportCode}>
                    {report?.reportCode ||
                    "Safety Report"}
                  </Text>

                  <Text style={styles.reportReason}>
                    {report?.reason ||
                    report?.category ||
                    "Report"}
                  </Text>

                  <Text style={styles.reportDate}>
                    {formatDate(
                      report?.createdAt
                    )}
                  </Text>
                </View>

                <View style={styles.reportRight}>
                  <Text style={styles.reportStatus}>
                    {formatStatus(
                      report?.status
                    )}
                  </Text>

                  <Text style={styles.reportPriority}>
                    {formatStatus(
                      report?.priority
                    )}
                  </Text>
                </View>
              </View>
            ))}

          {!dashboard?.reports?.length ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No report history is available yet.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>
            ACTIONS
          </Text>

          <Pressable
            onPress={() =>
              setAssignModalOpen(true)
            }
            style={styles.primaryAction}
          >
            <Ionicons
              name="layers-outline"
              size={20}
              color="#07111F"
            />

            <Text style={styles.primaryActionText}>
              Assign Reports
            </Text>
          </Pressable>

          <Pressable
            disabled={removing}
            onPress={confirmRemove}
            style={[
              styles.removeAction,
              removing && {
                opacity: 0.55,
              },
            ]}
          >
            {removing ? (
              <ActivityIndicator
                size="small"
                color="#FDA4AF"
              />
            ) : (
              <Ionicons
                name="trash-outline"
                size={20}
                color="#FDA4AF"
              />
            )}

            <Text style={styles.removeActionText}>
              Remove Supervisor
            </Text>
          </Pressable>
        </ScrollView>
      )}

      <Modal
        visible={assignModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!assigning) {
            setAssignModalOpen(false);
          }
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Assign Reports
            </Text>

            <Text style={styles.modalSubtitle}>
              Assign open reports to {fullName}.
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
              placeholder="Quantity"
              placeholderTextColor=
                "rgba(255,255,255,0.35)"
              style={styles.input}
            />

            <View style={styles.modalActions}>
              <Pressable
                disabled={assigning}
                onPress={() =>
                  setAssignModalOpen(false)
                }
                style={styles.cancelButton}
              >
                <Text style={styles.cancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={assigning}
                onPress={() =>
                  void submitAssignment()
                }
                style={styles.confirmButton}
              >
                {assigning ? (
                  <ActivityIndicator
                    size="small"
                    color="#07111F"
                  />
                ) : (
                  <Text style={styles.confirmText}>
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

const styles =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: BG,
    },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      paddingHorizontal: 16,
      paddingBottom: 14,
    },

    back: {
      width: 48,
      height: 48,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.09)",
    },

    headerTitle: {
      color: TEXT,
      fontSize: 24,
      fontWeight: "900",
    },

    headerSubtitle: {
      marginTop: 3,
      color: MUTED,
      fontSize: 12,
      fontWeight: "700",
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
      marginTop: 12,
      color: TEXT,
      fontSize: 18,
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
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: GOLD,
    },

    retryText: {
      color: "#07111F",
      fontWeight: "900",
    },

    profileCard: {
      padding: 18,
      borderRadius: 25,
      flexDirection: "row",
      alignItems: "center",
      gap: 15,
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor:
        "rgba(167,139,250,0.30)",
    },

    avatar: {
      width: 78,
      height: 78,
      borderRadius: 25,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(139,92,246,0.20)",
      borderWidth: 2,
      borderColor:
        "rgba(167,139,250,0.48)",
    },

    avatarImage: {
      width: "100%",
      height: "100%",
      borderRadius: 23,
    },

    avatarText: {
      color: TEXT,
      fontSize: 23,
      fontWeight: "900",
    },

    activeDot: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: GREEN,
      borderWidth: 3,
      borderColor: CARD,
    },

    profileName: {
      color: TEXT,
      fontSize: 21,
      fontWeight: "900",
    },

    profileId: {
      marginTop: 4,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    activeBadge: {
      alignSelf: "flex-start",
      marginTop: 9,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor:
        "rgba(110,231,183,0.12)",
    },

    activeText: {
      color: GREEN,
      fontSize: 9,
      fontWeight: "900",
    },

    sectionTitle: {
      marginTop: 25,
      marginBottom: 11,
      color: GOLD,
      fontSize: 11,
      letterSpacing: 1.2,
      fontWeight: "900",
    },

    metricsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },

    metricCard: {
      width: "48%",
      minHeight: 95,
      padding: 14,
      borderRadius: 19,
      justifyContent: "center",
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.08)",
    },

    metricValue: {
      fontSize: 27,
      fontWeight: "900",
    },

    metricLabel: {
      marginTop: 5,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    teamSummary: {
      padding: 16,
      borderRadius: 20,
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor:
        "rgba(167,139,250,0.22)",
    },

    teamIcon: {
      width: 47,
      height: 47,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(139,92,246,0.16)",
    },

    teamTitle: {
      color: TEXT,
      fontSize: 15,
      fontWeight: "900",
    },

    teamMeta: {
      marginTop: 4,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    agentRow: {
      marginTop: 9,
      padding: 13,
      borderRadius: 17,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      backgroundColor:
        "rgba(255,255,255,0.035)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.07)",
    },

    agentAvatar: {
      width: 40,
      height: 40,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(147,197,253,0.12)",
    },

    agentName: {
      color: TEXT,
      fontSize: 13,
      fontWeight: "900",
    },

    agentMeta: {
      marginTop: 3,
      color: MUTED,
      fontSize: 10,
      fontWeight: "700",
    },

    agentStatus: {
      color: GREEN,
      fontSize: 9,
      fontWeight: "900",
    },

    reportCard: {
      marginBottom: 9,
      padding: 14,
      borderRadius: 18,
      flexDirection: "row",
      gap: 12,
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.075)",
    },

    reportCode: {
      color: TEXT,
      fontSize: 13,
      fontWeight: "900",
    },

    reportReason: {
      marginTop: 4,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    reportDate: {
      marginTop: 5,
      color:
        "rgba(255,255,255,0.38)",
      fontSize: 9,
      fontWeight: "700",
    },

    reportRight: {
      alignItems: "flex-end",
    },

    reportStatus: {
      color: BLUE,
      fontSize: 9,
      fontWeight: "900",
    },

    reportPriority: {
      marginTop: 7,
      color: GOLD,
      fontSize: 9,
      fontWeight: "800",
    },

    emptyCard: {
      padding: 17,
      borderRadius: 18,
      backgroundColor:
        "rgba(255,255,255,0.035)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.07)",
    },

    emptyText: {
      color: MUTED,
      textAlign: "center",
      fontSize: 11,
      lineHeight: 17,
      fontWeight: "700",
    },

    primaryAction: {
      minHeight: 52,
      borderRadius: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      backgroundColor: GOLD,
    },

    primaryActionText: {
      color: "#07111F",
      fontSize: 14,
      fontWeight: "900",
    },

    removeAction: {
      marginTop: 11,
      minHeight: 52,
      borderRadius: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      borderWidth: 1,
      borderColor:
        "rgba(251,113,133,0.30)",
      backgroundColor:
        "rgba(251,113,133,0.08)",
    },

    removeActionText: {
      color: "#FDA4AF",
      fontSize: 14,
      fontWeight: "900",
    },

    overlay: {
      flex: 1,
      padding: 18,
      justifyContent: "center",
      backgroundColor:
        "rgba(0,0,0,0.76)",
    },

    modalCard: {
      padding: 20,
      borderRadius: 24,
      backgroundColor: "#171A24",
      borderWidth: 1,
      borderColor:
        "rgba(167,139,250,0.34)",
    },

    modalTitle: {
      color: TEXT,
      fontSize: 21,
      fontWeight: "900",
    },

    modalSubtitle: {
      marginTop: 6,
      color: MUTED,
      lineHeight: 19,
      fontWeight: "600",
    },

    input: {
      marginTop: 17,
      minHeight: 50,
      paddingHorizontal: 15,
      borderRadius: 15,
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
      marginTop: 18,
      flexDirection: "row",
      gap: 10,
    },

    cancelButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.06)",
    },

    cancelText: {
      color: MUTED,
      fontWeight: "900",
    },

    confirmButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: GOLD,
    },

    confirmText: {
      color: "#07111F",
      fontWeight: "900",
    },
  });
