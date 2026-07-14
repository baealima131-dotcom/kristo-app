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
  useRouter,
} from "expo-router";
import {
  Ionicons,
} from "@expo/vector-icons";
import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  fetchSafetySupervisors,
  inviteSafetySupervisor,
  removeSafetySupervisor,
} from "@/src/lib/safetyAdminApi";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.95)";
const MUTED = "rgba(255,255,255,0.58)";
const GOLD = "#F4D06F";

export default function SafetySupervisorsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] =
    React.useState(true);

  const [rows, setRows] =
    React.useState<any[]>([]);

  const [
    pendingInvitations,
    setPendingInvitations,
  ] = React.useState<any[]>([]);

  const [modalOpen, setModalOpen] =
    React.useState(false);

  const [kristoId, setKristoId] =
    React.useState("");

  const [churchId, setChurchId] =
    React.useState("");

  const [saving, setSaving] =
    React.useState(false);

  const [
    removingUserId,
    setRemovingUserId,
  ] = React.useState("");

  const load = React.useCallback(
    async () => {
      setLoading(true);

      try {
        const next =
          await fetchSafetySupervisors();

        setRows(
          next.supervisors
        );

        setPendingInvitations(
          next.pendingInvitations
        );
      } catch (error: any) {
        Alert.alert(
          "Could not load supervisors",
          String(
            error?.message ||
              "Please try again."
          )
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const confirmRemoveSupervisor =
    React.useCallback(
      (row: any) => {
        const userId =
          String(
            row?.userId || ""
          ).trim();

        if (
          !userId ||
          removingUserId
        ) {
          return;
        }

        const name =
          String(
            row?.fullName ||
            row?.kristoId ||
            "this supervisor"
          ).trim();

        Alert.alert(
          "Remove Safety Supervisor?",
          [
            name,
            "",
            "This will revoke Safety Supervisor access.",
            "All unresolved reports assigned to this supervisor will return to the unassigned queue.",
            "",
            "Their Kristo account, profile and church membership will not be deleted.",
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
                  setRemovingUserId(
                    userId
                  );

                  try {
                    const result =
                      await removeSafetySupervisor(
                        userId
                      );

                    await load();

                    Alert.alert(
                      "Supervisor removed",
                      result.releasedReportCount > 0
                        ? `${result.releasedReportCount} unfinished reports were returned to the unassigned queue.`
                        : "Safety Supervisor access was removed."
                    );
                  } catch (error: any) {
                    Alert.alert(
                      "Could not remove supervisor",
                      String(
                        error?.message ||
                        "Please try again."
                      )
                    );
                  } finally {
                    setRemovingUserId(
                      ""
                    );
                  }
                })();
              },
            },
          ]
        );
      },
      [
        load,
        removingUserId,
      ]
    );

  async function submit() {
    if (
      !kristoId.trim() ||
      !churchId.trim()
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
        await inviteSafetySupervisor({
          kristoId: kristoId.trim(),
          churchId: churchId.trim(),
        });

      setModalOpen(false);
      setKristoId("");
      setChurchId("");

      await load();

      Alert.alert(
        result.outcome ===
          "alreadyPending"
          ? "Invitation pending"
          : result.outcome ===
              "alreadySupervisor"
            ? "Already supervisor"
            : "Invitation sent",
        result.outcome ===
          "invited"
          ? "The user must accept the Safety Supervisor invitation."
          : result.outcome ===
              "alreadyPending"
            ? "A pending invitation already exists."
            : "This user already has Safety Supervisor access."
      );
    } catch (error: any) {
      Alert.alert(
        "Could not send invitation",
        String(
          error?.message ||
            "Please try again."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop:
            insets.top + 12,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color="#FFF"
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            Safety Supervisors
          </Text>

          <Text style={styles.subtitle}>
            Report Center team
          </Text>
        </View>

        <Pressable
          onPress={() =>
            setModalOpen(true)
          }
          style={styles.addButton}
        >
          <Ionicons
            name="person-add-outline"
            size={20}
            color="#07111F"
          />

          <Text style={styles.addText}>
            Add
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom:
            insets.bottom + 30,
        }}
      >
        {loading ? (
          <ActivityIndicator
            color={GOLD}
          />
        ) : (
          <>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryNumber}>
                  {pendingInvitations.length}
                </Text>
                <Text style={styles.summaryLabel}>
                  Pending
                </Text>
              </View>

              <View style={styles.summaryCard}>
                <Text style={styles.summaryNumber}>
                  {rows.length}
                </Text>
                <Text style={styles.summaryLabel}>
                  Active
                </Text>
              </View>
            </View>

            {pendingInvitations.length ? (
              <>
                <Text style={styles.sectionLabel}>
                  PENDING INVITATIONS
                </Text>

                {pendingInvitations.map(
                  (row) => (
                    <View
                      key={row.id}
                      style={styles.pendingCard}
                    >
                      <View style={styles.pendingIcon}>
                        <Ionicons
                          name="mail-unread-outline"
                          size={22}
                          color={GOLD}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>
                          {row.inviteeKristoId}
                        </Text>

                        <Text style={styles.cardMeta}>
                          {row.churchId}
                        </Text>

                        <Text style={styles.pendingText}>
                          Waiting for acceptance
                        </Text>
                      </View>
                    </View>
                  )
                )}
              </>
            ) : null}

            {rows.length ? (
              <>
                <Text style={styles.sectionLabel}>
                  ACTIVE SUPERVISORS
                </Text>

                {rows.map((row) => {
                  const fullName =
                    String(
                      row?.fullName ||
                      "Safety Supervisor"
                    ).trim();

                  const kristoId =
                    String(
                      row?.kristoId ||
                      "—"
                    )
                      .trim()
                      .toUpperCase();

                  const churchId =
                    String(
                      row?.churchId ||
                      "—"
                    )
                      .trim()
                      .toUpperCase();

                  const avatarUri =
                    String(
                      row?.avatarUrl ||
                      row?.avatarUri ||
                      ""
                    ).trim();

                  const removing =
                    removingUserId ===
                    String(
                      row?.userId || ""
                    ).trim();

                  return (
                    <View
                      key={`${row.userId}-${row.role}`}
                      style={styles.card}
                    >
                      <View style={styles.cardTopRow}>
                        <View style={styles.avatar}>
                          {avatarUri ? (
                            <Image
                              source={{
                                uri: avatarUri,
                              }}
                              resizeMode="cover"
                              style={styles.avatarImage}
                            />
                          ) : (
                            <Text style={styles.avatarInitials}>
                              {fullName
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((part) =>
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

                        <View style={styles.identity}>
                          <Text
                            numberOfLines={1}
                            style={styles.cardTitle}
                          >
                            {fullName}
                          </Text>

                          <Text
                            numberOfLines={1}
                            style={styles.kristoId}
                          >
                            KRISTO ID: {kristoId}
                          </Text>

                          <Text
                            numberOfLines={1}
                            style={styles.cardMeta}
                          >
                            Church ID: {churchId}
                          </Text>

                          <Text style={styles.active}>
                            Active Safety Supervisor
                          </Text>
                        </View>
                      </View>

                      <View style={styles.cardActions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            `View ${fullName} details`
                          }
                          onPress={() =>
                            router.push(
                              (
                                "/more/system-admin/report-center/supervisors/" +
                                encodeURIComponent(
                                  row.userId
                                )
                              ) as any
                            )
                          }
                          style={({ pressed }) => [
                            styles.detailsButton,
                            pressed && {
                              opacity: 0.72,
                            },
                          ]}
                        >
                          <Ionicons
                            name="analytics-outline"
                            size={16}
                            color="#C4B5FD"
                          />

                          <Text style={styles.detailsText}>
                            Details
                          </Text>
                        </Pressable>

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            `Remove ${fullName}`
                          }
                          disabled={
                            Boolean(
                              removingUserId
                            )
                          }
                          onPress={() =>
                            confirmRemoveSupervisor(
                              row
                            )
                          }
                          style={({ pressed }) => [
                            styles.removeButton,
                            pressed && {
                              opacity: 0.72,
                            },
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
                              size={16}
                              color="#FDA4AF"
                            />
                          )}

                          <Text style={styles.removeText}>
                            Remove
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </>
            ) : (
          <View style={styles.empty}>
            <Ionicons
              name="people-outline"
              size={34}
              color={GOLD}
            />

            <Text style={styles.emptyTitle}>
              No Safety Supervisors
            </Text>

            <Text style={styles.emptyText}>
              Add a trusted supervisor using
              their KRISTO ID and Church ID.
            </Text>
          </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setModalOpen(false)
        }
      >
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Add Safety Supervisor
            </Text>

            <Text style={styles.modalSub}>
              The user must be an active member
              of the selected church.
            </Text>

            <TextInput
              value={kristoId}
              onChangeText={setKristoId}
              placeholder="KRISTO ID"
              placeholderTextColor=
                "rgba(255,255,255,0.35)"
              autoCapitalize="characters"
              style={styles.input}
            />

            <TextInput
              value={churchId}
              onChangeText={setChurchId}
              placeholder="CHURCH ID"
              placeholderTextColor=
                "rgba(255,255,255,0.35)"
              autoCapitalize="characters"
              style={styles.input}
            />

            <View style={styles.actions}>
              <Pressable
                disabled={saving}
                onPress={() =>
                  setModalOpen(false)
                }
                style={styles.cancel}
              >
                <Text style={styles.cancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={saving}
                onPress={() => void submit()}
                style={styles.send}
              >
                {saving ? (
                  <ActivityIndicator
                    color="#07111F"
                  />
                ) : (
                  <Text style={styles.sendText}>
                    Send Invitation
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  back: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.07)",
  },
  title: {
    color: TEXT,
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  addButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: GOLD,
  },
  addText: {
    color: "#07111F",
    fontWeight: "900",
  },
  summaryRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 22,
  },

  summaryCard: {
    flex: 1,
    padding: 17,
    borderRadius: 19,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.22)",
    backgroundColor:
      "rgba(244,208,111,0.07)",
  },

  summaryNumber: {
    color: GOLD,
    fontSize: 28,
    fontWeight: "900",
  },

  summaryLabel: {
    marginTop: 3,
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
  },

  sectionLabel: {
    marginBottom: 10,
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.1,
  },

  pendingCard: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.22)",
    backgroundColor:
      "rgba(244,208,111,0.06)",
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },

  pendingIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.13)",
  },

  pendingText: {
    marginTop: 5,
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
  },

  card: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.11)",
    backgroundColor:
      "rgba(255,255,255,0.055)",
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor:
      "rgba(167,139,250,0.55)",
    backgroundColor:
      "rgba(167,139,250,0.15)",
  },

  avatarImage: {
    width: "100%",
    height: "100%",
  },

  avatarInitials: {
    color: "#DDD6FE",
    fontSize: 18,
    fontWeight: "900",
  },

  activeDot: {
    position: "absolute",
    right: 1,
    bottom: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#171B25",
    backgroundColor: "#6EE7B7",
  },

  identity: {
    flex: 1,
    minWidth: 0,
  },

  kristoId: {
    marginTop: 4,
    color: "#C4B5FD",
    fontSize: 11,
    fontWeight: "800",
  },

  cardActions: {
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor:
      "rgba(255,255,255,0.08)",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 9,
  },

  detailsButton: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor:
      "rgba(167,139,250,0.32)",
    backgroundColor:
      "rgba(139,92,246,0.12)",
  },

  detailsText: {
    color: "#DDD6FE",
    fontSize: 11,
    fontWeight: "900",
  },

  removeButton: {
    minHeight: 38,
    minWidth: 96,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor:
      "rgba(251,113,133,0.30)",
    backgroundColor:
      "rgba(251,113,133,0.09)",
  },

  removeText: {
    color: "#FDA4AF",
    fontSize: 11,
    fontWeight: "900",
  },
  cardTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },
  cardMeta: {
    marginTop: 4,
    color: MUTED,
    fontSize: 12,
  },
  active: {
    marginTop: 5,
    color: "#6EE7B7",
    fontSize: 11,
    fontWeight: "800",
  },
  empty: {
    marginTop: 80,
    alignItems: "center",
    paddingHorizontal: 30,
  },
  emptyTitle: {
    marginTop: 14,
    color: TEXT,
    fontSize: 19,
    fontWeight: "900",
  },
  emptyText: {
    marginTop: 8,
    color: MUTED,
    textAlign: "center",
    lineHeight: 20,
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor:
      "rgba(0,0,0,0.76)",
  },
  modalCard: {
    padding: 22,
    borderRadius: 26,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.14)",
    backgroundColor: "#141821",
  },
  modalTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
  },
  modalSub: {
    marginTop: 7,
    marginBottom: 18,
    color: MUTED,
    lineHeight: 19,
  },
  input: {
    minHeight: 54,
    marginBottom: 12,
    paddingHorizontal: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.12)",
    color: TEXT,
    backgroundColor:
      "rgba(255,255,255,0.055)",
    fontWeight: "800",
  },
  actions: {
    marginTop: 7,
    flexDirection: "row",
    gap: 10,
  },
  cancel: {
    flex: 1,
    minHeight: 52,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.08)",
  },
  cancelText: {
    color: TEXT,
    fontWeight: "800",
  },
  send: {
    flex: 1.4,
    minHeight: 52,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  sendText: {
    color: "#07111F",
    fontWeight: "900",
  },
});
