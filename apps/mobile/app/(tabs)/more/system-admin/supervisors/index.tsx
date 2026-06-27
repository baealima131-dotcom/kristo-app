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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  addSupervisor,
  assignCodesToSupervisor,
  fetchActivationDashboard,
  fetchSupervisors,
  type SupervisorSummary,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_ACCENT as ACCENT,
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_BORDER as BORDER,
  OFFLINE_ADMIN_CARD as CARD,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

export default function SupervisorsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ add?: string }>();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [supervisors, setSupervisors] = React.useState<SupervisorSummary[]>([]);
  const [availableUnassigned, setAvailableUnassigned] = React.useState(0);

  const [showAddModal, setShowAddModal] = React.useState(false);
  const [addKristoId, setAddKristoId] = React.useState("");
  const [addChurchId, setAddChurchId] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [assignTarget, setAssignTarget] = React.useState<SupervisorSummary | null>(null);
  const [assignQuantity, setAssignQuantity] = React.useState("10");
  const [assigning, setAssigning] = React.useState(false);

  const loadData = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const [list, dashboard] = await Promise.all([fetchSupervisors(), fetchActivationDashboard()]);
      setSupervisors(list);
      setAvailableUnassigned(dashboard.stats.availableUnassigned);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load supervisors"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      loadData();
    }, [loadData])
  );

  React.useEffect(() => {
    if (params.add === "1" && allowed) {
      setShowAddModal(true);
    }
  }, [params.add, allowed]);

  const onAddSupervisor = async () => {
    const kristoId = String(addKristoId || "").trim();
    const churchId = String(addChurchId || "").trim();
    if (!kristoId || !churchId) {
      Alert.alert("Missing info", "Enter both KRISTO ID and Church ID.");
      return;
    }
    setAdding(true);
    try {
      const result = await addSupervisor({ kristoId, churchId });
      setShowAddModal(false);
      setAddKristoId("");
      setAddChurchId("");
      await loadData();
      if (result.outcome === "alreadySupervisor") {
        Alert.alert("Already supervisor", "This user is already an active Supervisor.");
        return;
      }
      if (result.outcome === "alreadyPending") {
        Alert.alert("Invitation pending", "A pending invitation already exists for this user.");
        return;
      }
      Alert.alert("Invitation sent", "The user must accept before Supervisor access is granted.");
    } catch (e: any) {
      Alert.alert("Could not invite supervisor", String(e?.message || "Failed"));
    } finally {
      setAdding(false);
    }
  };

  const onAssignCodes = async () => {
    if (!assignTarget) return;
    if (assignTarget.invitationStatus === "pending") {
      Alert.alert("Invitation pending", "Codes can only be assigned to accepted supervisors.");
      return;
    }
    const qty = Math.floor(Number(assignQuantity));
    if (!Number.isFinite(qty) || qty < 1) {
      Alert.alert("Invalid quantity", "Enter at least 1.");
      return;
    }
    if (qty > availableUnassigned) {
      Alert.alert("Not enough codes", `Only ${availableUnassigned} unassigned codes available.`);
      return;
    }

    setAssigning(true);
    try {
      const result = await assignCodesToSupervisor(assignTarget.userId, qty);
      setAssignTarget(null);
      setAssignQuantity("10");
      await loadData();
      Alert.alert("Codes assigned", `${result.assignedCount} codes assigned to supervisor.`);
    } catch (e: any) {
      Alert.alert("Assign failed", String(e?.message || "Failed"));
    } finally {
      setAssigning(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[`${ACCENT}22`, "rgba(7,12,20,0.98)", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Supervisors</Text>
          <Text style={styles.subtitle}>{availableUnassigned} unassigned codes available</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeText}>System Admin access required.</Text>
          </View>
        ) : (
          <>
            <Pressable style={styles.primaryBtn} onPress={() => setShowAddModal(true)}>
              <Ionicons name="person-add-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Add Supervisor</Text>
            </Pressable>

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : supervisors.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No supervisors yet. Add one to start assigning codes.</Text>
              </View>
            ) : (
              supervisors.map((row) => {
                const isPending = row.invitationStatus === "pending";
                const rowKey = row.invitationId || row.userId;
                return (
                <View key={rowKey} style={styles.rowCard}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.rowTitleRow}>
                      <Text style={styles.rowTitle}>
                        {row.fullName || row.kristoId || row.userId}
                      </Text>
                      <View
                        style={[
                          styles.statusBadge,
                          isPending ? styles.statusBadgePending : styles.statusBadgeAccepted,
                        ]}
                      >
                        <Text style={styles.statusBadgeText}>
                          {isPending ? "Pending" : "Accepted"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.rowMeta}>
                      {row.kristoId ? `KRISTO ${row.kristoId}` : row.userId}
                      {row.churchId ? ` • ${row.churchId}` : ""}
                    </Text>
                    <Text style={styles.rowStats}>
                      Assigned {row.assignedCodes} • Remaining {row.remainingCodes} • Redeemed{" "}
                      {row.redeemedCodes}
                    </Text>
                  </View>
                  <View style={styles.rowActions}>
                    {!isPending ? (
                      <>
                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={() =>
                            router.push(`/more/system-admin/supervisors/${encodeURIComponent(row.userId)}` as any)
                          }
                        >
                          <Text style={styles.secondaryBtnText}>View</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryBtn} onPress={() => setAssignTarget(row)}>
                          <Text style={styles.secondaryBtnText}>Assign</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Text style={styles.pendingHint}>Awaiting acceptance</Text>
                    )}
                  </View>
                </View>
              );
              })
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Supervisor</Text>
            <Text style={styles.modalSub}>
              Sends a pending invitation. The user must accept before Supervisor access is granted.
            </Text>
            <Text style={styles.fieldLabel}>KRISTO ID</Text>
            <TextInput
              value={addKristoId}
              onChangeText={setAddKristoId}
              placeholder="KR7-000123"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="characters"
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Church ID</Text>
            <TextInput
              value={addChurchId}
              onChangeText={setAddChurchId}
              placeholder="CH7-08PQW9"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="characters"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} disabled={adding} onPress={onAddSupervisor}>
                {adding ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>Add</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(assignTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setAssignTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Assign codes</Text>
            <Text style={styles.modalSub}>
              {assignTarget?.fullName || assignTarget?.kristoId || assignTarget?.userId}
            </Text>
            <Text style={styles.modalHint}>{availableUnassigned} unassigned codes available</Text>
            <TextInput
              value={assignQuantity}
              onChangeText={setAssignQuantity}
              keyboardType="number-pad"
              placeholder="10"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setAssignTarget(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} disabled={assigning} onPress={onAssignCodes}>
                {assigning ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>Assign</Text>
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
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: { color: TEXT, fontSize: 20, fontWeight: "800" },
  subtitle: { color: MUTED, fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: ACCENT,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  rowCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  rowTitle: { color: TEXT, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgePending: {
    borderColor: "rgba(255,196,90,0.45)",
    backgroundColor: "rgba(255,196,90,0.12)",
  },
  statusBadgeAccepted: {
    borderColor: "rgba(90,255,170,0.35)",
    backgroundColor: "rgba(90,255,170,0.10)",
  },
  statusBadgeText: { color: TEXT, fontSize: 10, fontWeight: "800" },
  pendingHint: { color: MUTED, fontSize: 11, fontStyle: "italic" },
  rowMeta: { color: MUTED, fontSize: 12 },
  rowStats: { color: MUTED, fontSize: 11, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: 8 },
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${ACCENT}66`,
    backgroundColor: `${ACCENT}18`,
  },
  secondaryBtnText: { color: ACCENT, fontWeight: "700", fontSize: 12 },
  emptyCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyText: { color: MUTED, fontSize: 13, textAlign: "center" },
  loadingWrap: { paddingVertical: 24, alignItems: "center" },
  errorCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  errorText: { color: "#FCA5A5", fontSize: 13 },
  noticeCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 10,
  },
  modalTitle: { color: TEXT, fontSize: 18, fontWeight: "800" },
  modalSub: { color: MUTED, fontSize: 13 },
  fieldLabel: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 4 },
  modalHint: { color: MUTED, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: TEXT,
    backgroundColor: "rgba(255,255,255,0.04)",
    fontSize: 15,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  modalCancelText: { color: MUTED, fontWeight: "700" },
  modalConfirm: {
    minWidth: 88,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  modalConfirmText: { color: "#fff", fontWeight: "800" },
});
