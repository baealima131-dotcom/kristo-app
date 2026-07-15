import React from "react";

import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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

import {
  addSafetySupervisorAgent,
  assignSafetyReportsToAgent,
  fetchSafetySupervisorDashboard,
  removeSafetySupervisorAgent,
  type SafetySupervisorAgent,
} from "@/src/lib/safetyAdminApi";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.58)";
const BLUE = "#93C5FD";
const GREEN = "#6EE7B7";
const PURPLE = "#C4B5FD";

export default function
SafetySupervisorAgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params =
    useLocalSearchParams<{
      mode?:
        | string
        | string[];
    }>();

  const requestedMode =
    String(
      Array.isArray(params.mode)
        ? params.mode[0]
        : params.mode || ""
    ).trim();

  const [
    showForm,
    setShowForm,
  ] = React.useState(
    requestedMode === "add"
  );

  const [
    kristoId,
    setKristoId,
  ] = React.useState("");

  const [
    churchId,
    setChurchId,
  ] = React.useState("");

  const [
    agents,
    setAgents,
  ] = React.useState<
    SafetySupervisorAgent[]
  >([]);

  const [
    loading,
    setLoading,
  ] = React.useState(true);

  const [
    saving,
    setSaving,
  ] = React.useState(false);

  const [
    error,
    setError,
  ] = React.useState("");

  const [
    removingAgentKey,
    setRemovingAgentKey,
  ] = React.useState("");

  const [
    availableReportCount,
    setAvailableReportCount,
  ] = React.useState(0);

  const [
    assignmentAgent,
    setAssignmentAgent,
  ] = React.useState<
    SafetySupervisorAgent | null
  >(null);

  const [
    assignmentCount,
    setAssignmentCount,
  ] = React.useState("");

  const [
    assigningReports,
    setAssigningReports,
  ] = React.useState(false);

  React.useEffect(() => {
    if (requestedMode === "add") {
      setShowForm(true);
    }
  }, [requestedMode]);

  const load =
    React.useCallback(async () => {
      setLoading(true);
      setError("");

      try {
        const dashboard =
          await fetchSafetySupervisorDashboard();

        setAgents(
          dashboard.agents
        );

        setAvailableReportCount(
          dashboard.reports.filter(
            (report) =>
              !report.assignedAgentUserId &&
              report.status !==
                "resolved" &&
              report.status !==
                "dismissed"
          ).length
        );
      } catch (nextError: any) {
        setError(
          String(
            nextError?.message ||
            "Could not load Safety Agents."
          )
        );
      } finally {
        setLoading(false);
      }
    }, []);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const submit =
    React.useCallback(async () => {
      if (saving) {
        return;
      }

      const normalizedKristoId =
        kristoId
          .trim()
          .toUpperCase();

      const normalizedChurchId =
        churchId
          .trim()
          .toUpperCase();

      if (
        !normalizedKristoId ||
        !normalizedChurchId
      ) {
        Alert.alert(
          "Missing information",
          "Enter both KRISTO ID and Church ID."
        );
        return;
      }

      setSaving(true);

      try {
        const result =
          await addSafetySupervisorAgent({
            kristoId:
              normalizedKristoId,

            churchId:
              normalizedChurchId,
          });

        setKristoId("");
        setChurchId("");
        setShowForm(false);

        await load();

        Alert.alert(
          result.outcome ===
            "alreadyActive"
            ? "Agent already active"
            : result.outcome ===
              "alreadyInvited"
            ? "Invitation already pending"
            : "Invitation sent",
          result.outcome ===
            "alreadyActive"
            ? "This member is already an active Safety Agent."
            : result.outcome ===
              "alreadyInvited"
            ? "This member already has a pending Safety Agent invitation."
            : "The member must accept the invitation before reports can be assigned."
        );
      } catch (nextError: any) {
        Alert.alert(
          "Could not add agent",
          String(
            nextError?.message ||
            "Please try again."
          )
        );
      } finally {
        setSaving(false);
      }
    }, [
      saving,
      kristoId,
      churchId,
      load,
    ]);

  const showAgentDetails =
    React.useCallback(
      (
        agent:
          SafetySupervisorAgent
      ) => {
        Alert.alert(
          agent.kristoId ||
            "Safety Agent",
          [
            `Church: ${agent.churchId}`,
            `Status: ${agent.status.toUpperCase()}`,
            `Assigned: ${agent.totalAssigned}`,
            `Open: ${agent.open}`,
            `In review: ${agent.inReview}`,
            `Resolved: ${agent.resolved}`,
          ].join("\n")
        );
      },
      []
    );

  const confirmRemoveAgent =
    React.useCallback(
      (
        agent:
          SafetySupervisorAgent
      ) => {
        const key = [
          agent.userId,
          agent.churchId,
        ].join(":");

        Alert.alert(
          "Remove Safety Agent?",
          `${
            agent.kristoId ||
            agent.userId
          } will be removed from your investigation team.`,
          [
            {
              text: "Cancel",
              style: "cancel",
            },
            {
              text: "Remove",
              style: "destructive",
              onPress: async () => {
                if (
                  removingAgentKey
                ) {
                  return;
                }

                setRemovingAgentKey(
                  key
                );

                try {
                  const result =
                    await removeSafetySupervisorAgent(
                      {
                        agentUserId:
                          agent.userId,
                        churchId:
                          agent.churchId,
                      }
                    );

                  if (
                    !result.removed
                  ) {
                    throw new Error(
                      "This agent relationship was not found."
                    );
                  }

                  await load();

                  Alert.alert(
                    "Agent removed",
                    "The Safety Agent was removed from your team."
                  );
                } catch (
                  nextError: any
                ) {
                  Alert.alert(
                    "Could not remove agent",
                    String(
                      nextError?.message ||
                        "Please try again."
                    )
                  );
                } finally {
                  setRemovingAgentKey(
                    ""
                  );
                }
              },
            },
          ]
        );
      },
      [
        load,
        removingAgentKey,
      ]
    );

  const openAgentAssignments =
    React.useCallback(
      (
        agent:
          SafetySupervisorAgent
      ) => {
        if (
          agent.status !==
          "active"
        ) {
          Alert.alert(
            "Agent not active",
            "This agent must accept the invitation before reports can be assigned."
          );
          return;
        }

        if (
          availableReportCount < 1
        ) {
          Alert.alert(
            "No reports available",
            "All reports received by this supervisor have already been assigned."
          );
          return;
        }

        setAssignmentCount("");
        setAssignmentAgent(agent);
      },
      [
        availableReportCount,
      ]
    );

  const closeAssignmentModal =
    React.useCallback(() => {
      if (assigningReports) {
        return;
      }

      setAssignmentAgent(null);
      setAssignmentCount("");
    }, [assigningReports]);

  const submitReportAssignment =
    React.useCallback(async () => {
      if (
        !assignmentAgent ||
        assigningReports
      ) {
        return;
      }

      const count =
        Math.floor(
          Number(
            assignmentCount
          ) || 0
        );

      if (count < 1) {
        Alert.alert(
          "Enter report count",
          "Enter how many reports you want to assign to this agent."
        );
        return;
      }

      if (
        count >
        availableReportCount
      ) {
        Alert.alert(
          "Not enough reports",
          `Only ${availableReportCount} unassigned reports are available.`
        );
        return;
      }

      setAssigningReports(true);

      try {
        const result =
          await assignSafetyReportsToAgent(
            {
              agentUserId:
                assignmentAgent.userId,
              count,
            }
          );

        setAgents(
          result.agents
        );

        setAvailableReportCount(
          result.availableCount
        );

        const agentName =
          assignmentAgent.kristoId ||
          assignmentAgent.userId;

        setAssignmentAgent(null);
        setAssignmentCount("");

        Alert.alert(
          "Reports assigned",
          `${result.assignedCount} ${
            result.assignedCount === 1
              ? "report was"
              : "reports were"
          } assigned to ${agentName}.`
        );
      } catch (
        nextError: any
      ) {
        Alert.alert(
          "Could not assign reports",
          String(
            nextError?.message ||
              "Please try again."
          )
        );

        await load();
      } finally {
        setAssigningReports(false);
      }
    }, [
      assignmentAgent,
      assignmentCount,
      assigningReports,
      availableReportCount,
      load,
    ]);

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
            size={26}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Safety Agents
          </Text>

          <Text style={styles.headerSubtitle}>
            Manage your investigation team
          </Text>
        </View>

        <Pressable
          onPress={() =>
            setShowForm(
              (current) =>
                !current
            )
          }
          style={[
            styles.headerAdd,
            showForm &&
              styles.headerAddActive,
          ]}
        >
          <Ionicons
            name={
              showForm
                ? "close-outline"
                : "person-add-outline"
            }
            size={20}
            color={
              showForm
                ? GOLD
                : "#07111F"
            }
          />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom:
              insets.bottom + 30,
          }}
        >
          {showForm ? (
            <View style={styles.formCard}>
              <View style={styles.formTop}>
                <View style={styles.formIcon}>
                  <Ionicons
                    name="person-add-outline"
                    size={25}
                    color={GOLD}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.formTitle}>
                    Add Safety Agent
                  </Text>

                  <Text style={styles.formSubtitle}>
                    The user must be an active member of the provided church.
                  </Text>
                </View>
              </View>

              <Text style={styles.label}>
                KRISTO ID
              </Text>

              <TextInput
                value={kristoId}
                onChangeText={(value) =>
                  setKristoId(
                    value.toUpperCase()
                  )
                }
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="KR7-XXXXXXXX"
                placeholderTextColor=
                  "rgba(255,255,255,0.30)"
                style={styles.input}
              />

              <Text style={styles.label}>
                Church ID
              </Text>

              <TextInput
                value={churchId}
                onChangeText={(value) =>
                  setChurchId(
                    value.toUpperCase()
                  )
                }
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="CH7-XXXXXX"
                placeholderTextColor=
                  "rgba(255,255,255,0.30)"
                style={styles.input}
              />

              <Pressable
                disabled={saving}
                onPress={() =>
                  void submit()
                }
                style={[
                  styles.submitButton,
                  saving && {
                    opacity: 0.58,
                  },
                ]}
              >
                {saving ? (
                  <ActivityIndicator
                    size="small"
                    color="#07111F"
                  />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={20}
                      color="#07111F"
                    />

                    <Text
                      style={
                        styles.submitText
                      }
                    >
                      Add Agent
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          <View style={styles.listHeader}>
            <View>
              <Text style={styles.listTitle}>
                Your Agents
              </Text>

              <Text style={styles.listSubtitle}>
                {agents.length} registered
              </Text>
            </View>

            <View style={styles.countBadge}>
              <Text style={styles.countText}>
                {agents.length}
              </Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.centerCard}>
              <ActivityIndicator
                color={GOLD}
              />

              <Text style={styles.centerText}>
                Loading agents…
              </Text>
            </View>
          ) : error ? (
            <View style={styles.centerCard}>
              <Ionicons
                name="alert-circle-outline"
                size={30}
                color="#FB7185"
              />

              <Text style={styles.errorText}>
                {error}
              </Text>

              <Pressable
                onPress={() =>
                  void load()
                }
              >
                <Text style={styles.retryText}>
                  Try Again
                </Text>
              </Pressable>
            </View>
          ) : agents.length ? (
            <View style={styles.agentList}>
              {agents.map(
                (agent) => (
                  <View
                    key={[
                      agent.userId,
                      agent.churchId,
                    ].join(":")}
                    style={styles.agentCard}
                  >
                    <View
                      style={
                        styles.agentCardTop
                      }
                    >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={
                          styles.agentName
                        }
                      >
                        {agent.kristoId ||
                          agent.userId}
                      </Text>

                      <Text
                        style={
                          styles.agentChurch
                        }
                      >
                        {agent.churchId}
                      </Text>

                      <View
                        style={
                          styles.agentStats
                        }
                      >
                        <Text
                          style={
                            styles.statOpen
                          }
                        >
                          {agent.open} open
                        </Text>

                        <Text
                          style={
                            styles.statReview
                          }
                        >
                          {agent.inReview} review
                        </Text>

                        <Text
                          style={
                            styles.statResolved
                          }
                        >
                          {agent.resolved} resolved
                        </Text>
                      </View>
                    </View>

                    <View
                      style={
                        styles.agentRight
                      }
                    >
                      <View
                        style={[
                          styles.statusBadge,
                          agent.status !==
                            "active" &&
                            styles.statusPending,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            agent.status !==
                              "active" &&
                              styles.statusTextPending,
                          ]}
                        >
                          {agent.status.toUpperCase()}
                        </Text>
                      </View>

                      <Text
                        style={
                          styles.assignedValue
                        }
                      >
                        {agent.totalAssigned}
                      </Text>

                      <Text
                        style={
                          styles.assignedLabel
                        }
                      >
                        ASSIGNED
                      </Text>
                    </View>
                    </View>

                    <View
                      style={
                        styles.agentActions
                      }
                    >
                      <Pressable
                        disabled={
                          agent.status !==
                            "active" ||
                          availableReportCount <
                            1
                        }
                        onPress={() =>
                          openAgentAssignments(
                            agent
                          )
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.agentActionPrimary,
                          (
                            agent.status !==
                              "active" ||
                            availableReportCount <
                              1
                          ) &&
                            styles.agentActionDisabled,
                          pressed && {
                            opacity: 0.75,
                          },
                        ]}
                      >
                        <Text
                          style={
                            styles.agentActionPrimaryText
                          }
                        >
                          {availableReportCount > 0
                            ? "Assign"
                            : "No Reports"}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() =>
                          showAgentDetails(
                            agent
                          )
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.agentActionSecondary,
                          pressed && {
                            opacity: 0.75,
                          },
                        ]}
                      >
                        <Text
                          style={
                            styles.agentActionSecondaryText
                          }
                        >
                          Details
                        </Text>
                      </Pressable>

                      <Pressable
                        disabled={
                          Boolean(
                            removingAgentKey
                          )
                        }
                        onPress={() =>
                          confirmRemoveAgent(
                            agent
                          )
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.agentActionDanger,
                          pressed && {
                            opacity: 0.75,
                          },
                        ]}
                      >
                        {removingAgentKey ===
                        [
                          agent.userId,
                          agent.churchId,
                        ].join(":") ? (
                          <ActivityIndicator
                            size="small"
                            color="#FB7185"
                          />
                        ) : (
                          <Ionicons
                            name="trash-outline"
                            size={15}
                            color="#FB7185"
                          />
                        )}

                        <Text
                          style={
                            styles.agentActionDangerText
                          }
                        >
                          Remove
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )
              )}
            </View>
          ) : (
            <View style={styles.centerCard}>
              <Ionicons
                name="people-outline"
                size={36}
                color={PURPLE}
              />

              <Text style={styles.emptyTitle}>
                No Safety Agents
              </Text>

              <Text style={styles.centerText}>
                Tap the add button and enter the member’s KRISTO ID and Church ID.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={Boolean(
          assignmentAgent
        )}
        transparent
        animationType="fade"
        onRequestClose={
          closeAssignmentModal
        }
      >
        <KeyboardAvoidingView
          style={
            styles.assignmentModalRoot
          }
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : undefined
          }
        >
          <Pressable
            style={
              styles.assignmentModalBackdrop
            }
            onPress={
              closeAssignmentModal
            }
          />

          <View
            style={
              styles.assignmentModalCard
            }
          >
            <Text
              style={
                styles.assignmentModalTitle
              }
            >
              Assign Reports
            </Text>

            <Text
              style={
                styles.assignmentModalAgent
              }
            >
              {assignmentAgent?.kristoId ||
                assignmentAgent?.userId ||
                "Safety Agent"}
            </Text>

            <View
              style={
                styles.assignmentAvailableCard
              }
            >
              <Text
                style={
                  styles.assignmentAvailableLabel
                }
              >
                REPORTS AVAILABLE
              </Text>

              <Text
                style={
                  styles.assignmentAvailableValue
                }
              >
                {availableReportCount}
              </Text>
            </View>

            <Text
              style={
                styles.assignmentInputLabel
              }
            >
              How many reports should this agent receive?
            </Text>

            <TextInput
              autoFocus
              value={assignmentCount}
              onChangeText={(value) =>
                setAssignmentCount(
                  value.replace(
                    /[^0-9]/g,
                    ""
                  )
                )
              }
              keyboardType="number-pad"
              inputMode="numeric"
              returnKeyType="done"
              placeholder="Enter number"
              placeholderTextColor=
                "rgba(255,255,255,0.30)"
              selectTextOnFocus
              style={
                styles.assignmentInput
              }
            />

            <Text
              style={
                styles.assignmentHint
              }
            >
              You may assign any number up to the reports currently available.
            </Text>

            <View
              style={
                styles.assignmentModalActions
              }
            >
              <Pressable
                disabled={
                  assigningReports
                }
                onPress={
                  closeAssignmentModal
                }
                style={
                  styles.assignmentCancelButton
                }
              >
                <Text
                  style={
                    styles.assignmentCancelText
                  }
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={
                  assigningReports ||
                  !assignmentCount
                }
                onPress={() =>
                  void submitReportAssignment()
                }
                style={[
                  styles.assignmentSubmitButton,
                  (
                    assigningReports ||
                    !assignmentCount
                  ) && {
                    opacity: 0.48,
                  },
                ]}
              >
                {assigningReports ? (
                  <ActivityIndicator
                    size="small"
                    color="#07111F"
                  />
                ) : (
                  <Text
                    style={
                      styles.assignmentSubmitText
                    }
                  >
                    Assign
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
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
      gap: 12,
    },

    backButton: {
      width: 47,
      height: 47,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.10)",
    },

    headerTitle: {
      color: TEXT,
      fontSize: 22,
      fontWeight: "900",
    },

    headerSubtitle: {
      marginTop: 2,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    headerAdd: {
      width: 47,
      height: 47,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: GOLD,
    },

    headerAddActive: {
      backgroundColor:
        "rgba(244,208,111,0.10)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.30)",
    },

    formCard: {
      padding: 17,
      borderRadius: 22,
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.25)",
    },

    formTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    formIcon: {
      width: 48,
      height: 48,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.12)",
    },

    formTitle: {
      color: TEXT,
      fontSize: 17,
      fontWeight: "900",
    },

    formSubtitle: {
      marginTop: 4,
      color: MUTED,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: "700",
    },

    label: {
      marginTop: 16,
      marginBottom: 7,
      color: MUTED,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.8,
    },

    input: {
      minHeight: 51,
      paddingHorizontal: 14,
      borderRadius: 15,
      color: TEXT,
      fontSize: 15,
      fontWeight: "800",
      backgroundColor:
        "rgba(255,255,255,0.045)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.11)",
    },

    submitButton: {
      marginTop: 18,
      minHeight: 50,
      borderRadius: 15,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: GOLD,
    },

    submitText: {
      color: "#07111F",
      fontSize: 13,
      fontWeight: "900",
    },

    listHeader: {
      marginTop: 22,
      marginBottom: 11,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    listTitle: {
      color: GOLD,
      fontSize: 19,
      fontWeight: "900",
    },

    listSubtitle: {
      marginTop: 3,
      color: MUTED,
      fontSize: 10,
      fontWeight: "700",
    },

    countBadge: {
      minWidth: 37,
      height: 37,
      paddingHorizontal: 9,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(196,181,253,0.10)",
      borderWidth: 1,
      borderColor:
        "rgba(196,181,253,0.22)",
    },

    countText: {
      color: PURPLE,
      fontSize: 15,
      fontWeight: "900",
    },

    agentList: {
      gap: 10,
    },

    agentCard: {
      padding: 14,
      borderRadius: 19,
      backgroundColor:
        "rgba(255,255,255,0.045)",
      borderWidth: 1,
      borderColor:
        "rgba(147,197,253,0.16)",
    },

    agentCardTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },

    agentActions: {
      marginTop: 13,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor:
        "rgba(255,255,255,0.07)",
      flexDirection: "row",
      gap: 7,
    },

    agentActionPrimary: {
      flex: 1,
      minHeight: 37,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      backgroundColor: GOLD,
    },

    agentActionPrimaryText: {
      color: "#07111F",
      fontSize: 9,
      fontWeight: "900",
    },

    agentActionDisabled: {
      opacity: 0.38,
    },

    agentActionSecondary: {
      flex: 1,
      minHeight: 37,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      backgroundColor:
        "rgba(147,197,253,0.08)",
      borderWidth: 1,
      borderColor:
        "rgba(147,197,253,0.18)",
    },

    agentActionSecondaryText: {
      color: BLUE,
      fontSize: 9,
      fontWeight: "900",
    },

    agentActionDanger: {
      flex: 1,
      minHeight: 37,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      backgroundColor:
        "rgba(251,113,133,0.07)",
      borderWidth: 1,
      borderColor:
        "rgba(251,113,133,0.18)",
    },

    agentActionDangerText: {
      color: "#FB7185",
      fontSize: 9,
      fontWeight: "900",
    },

    agentName: {
      color: TEXT,
      fontSize: 14,
      fontWeight: "900",
    },

    agentChurch: {
      marginTop: 3,
      color: MUTED,
      fontSize: 10,
      fontWeight: "700",
    },

    agentStats: {
      marginTop: 7,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 7,
    },

    statOpen: {
      color: BLUE,
      fontSize: 9,
      fontWeight: "800",
    },

    statReview: {
      color: PURPLE,
      fontSize: 9,
      fontWeight: "800",
    },

    statResolved: {
      color: GREEN,
      fontSize: 9,
      fontWeight: "800",
    },

    agentRight: {
      alignItems: "flex-end",
    },

    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor:
        "rgba(110,231,183,0.11)",
    },

    statusPending: {
      backgroundColor:
        "rgba(244,208,111,0.11)",
    },

    statusText: {
      color: GREEN,
      fontSize: 8,
      fontWeight: "900",
    },

    statusTextPending: {
      color: GOLD,
    },

    assignedValue: {
      marginTop: 8,
      color: GOLD,
      fontSize: 19,
      fontWeight: "900",
    },

    assignedLabel: {
      color: MUTED,
      fontSize: 7,
      fontWeight: "900",
    },

    centerCard: {
      padding: 25,
      borderRadius: 21,
      alignItems: "center",
      backgroundColor:
        "rgba(255,255,255,0.04)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.075)",
    },

    centerText: {
      marginTop: 9,
      maxWidth: 270,
      color: MUTED,
      fontSize: 11,
      lineHeight: 17,
      textAlign: "center",
      fontWeight: "700",
    },

    emptyTitle: {
      marginTop: 10,
      color: TEXT,
      fontSize: 17,
      fontWeight: "900",
    },

    errorText: {
      marginTop: 10,
      color: "#FB7185",
      textAlign: "center",
      fontWeight: "700",
    },

    retryText: {
      marginTop: 12,
      color: GOLD,
      fontWeight: "900",
    },


    assignmentModalRoot: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 18,
    },

    assignmentModalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor:
        "rgba(0,0,0,0.72)",
    },

    assignmentModalCard: {
      padding: 20,
      borderRadius: 24,
      backgroundColor:
        "#111B2A",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.28)",
    },

    assignmentModalTitle: {
      color: TEXT,
      fontSize: 20,
      fontWeight: "900",
      textAlign: "center",
    },

    assignmentModalAgent: {
      marginTop: 5,
      color: GOLD,
      fontSize: 12,
      fontWeight: "900",
      textAlign: "center",
    },

    assignmentAvailableCard: {
      marginTop: 18,
      minHeight: 78,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.08)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.19)",
    },

    assignmentAvailableLabel: {
      color: MUTED,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 0.8,
    },

    assignmentAvailableValue: {
      marginTop: 4,
      color: GOLD,
      fontSize: 28,
      fontWeight: "900",
    },

    assignmentInputLabel: {
      marginTop: 18,
      color: TEXT,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "800",
      textAlign: "center",
    },

    assignmentInput: {
      marginTop: 12,
      minHeight: 58,
      paddingHorizontal: 16,
      borderRadius: 17,
      color: TEXT,
      fontSize: 23,
      fontWeight: "900",
      textAlign: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.14)",
    },

    assignmentHint: {
      marginTop: 9,
      color: MUTED,
      fontSize: 9,
      lineHeight: 14,
      fontWeight: "700",
      textAlign: "center",
    },

    assignmentModalActions: {
      marginTop: 19,
      flexDirection: "row",
      gap: 10,
    },

    assignmentCancelButton: {
      flex: 1,
      minHeight: 49,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.11)",
    },

    assignmentCancelText: {
      color: TEXT,
      fontSize: 12,
      fontWeight: "900",
    },

    assignmentSubmitButton: {
      flex: 1,
      minHeight: 49,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: GOLD,
    },

    assignmentSubmitText: {
      color: "#07111F",
      fontSize: 12,
      fontWeight: "900",
    },

  });
