import React from "react";
import {
  ActivityIndicator,
  Alert,
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

  const [modalOpen, setModalOpen] =
    React.useState(false);

  const [kristoId, setKristoId] =
    React.useState("");

  const [churchId, setChurchId] =
    React.useState("");

  const [saving, setSaving] =
    React.useState(false);

  const load = React.useCallback(
    async () => {
      setLoading(true);

      try {
        const next =
          await fetchSafetySupervisors();

        setRows(next);
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
        ) : rows.length ? (
          rows.map((row) => (
            <View
              key={`${row.userId}-${row.role}`}
              style={styles.card}
            >
              <View style={styles.icon}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={24}
                  color="#C4B5FD"
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>
                  {row.fullName ||
                    row.kristoId ||
                    row.userId}
                </Text>

                <Text style={styles.cardMeta}>
                  {row.churchId}
                </Text>

                <Text style={styles.active}>
                  Active Safety Supervisor
                </Text>
              </View>
            </View>
          ))
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
  card: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.11)",
    backgroundColor:
      "rgba(255,255,255,0.055)",
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  icon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(167,139,250,0.14)",
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
