import React from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
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
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AnalyticsChip,
  ContactAvatar,
  DangerIconButton,
  GlassButton,
  GlassCard,
  GoldButton,
  SA_GOLD,
  SA_GREEN,
  SA_PURPLE,
  ShimmerBlock,
  StatusCapsule,
  supervisorStatusTone,
} from "@/src/components/systemAdminSupervisorUi";
import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  addSupervisor,
  assignCodesToSupervisor,
  deleteSupervisor,
  fetchActivationDashboard,
  fetchSupervisors,
  type SupervisorSummary,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

function SummaryStrip({
  total,
  codes,
  pending,
}: {
  total: number;
  codes: number;
  pending: number;
}) {
  return (
    <View style={styles.summaryStrip}>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{total}</Text>
        <Text style={styles.summaryLabel}>Supervisors</Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{codes}</Text>
        <Text style={styles.summaryLabel}>Available</Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{pending}</Text>
        <Text style={styles.summaryLabel}>Pending</Text>
      </View>
    </View>
  );
}

function SupervisorContactCard({
  row,
  index,
  onAssign,
  onViewDetails,
  onDelete,
  deleting,
}: {
  row: SupervisorSummary;
  index: number;
  onAssign: () => void;
  onViewDetails: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const fade = React.useRef(new Animated.Value(0)).current;
  const isPending = row.invitationStatus === "pending";
  const displayName = row.fullName || row.kristoId || row.userId;

  React.useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 320,
      delay: index * 40,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade, index]);

  return (
    <Animated.View
      style={{
        opacity: fade,
        transform: [
          {
            translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
          },
        ],
      }}
    >
      <GlassCard pad={10}>
        <View style={styles.cardTop}>
          <ContactAvatar
            uri={row.avatarUrl}
            name={displayName}
            fallbackId={row.kristoId || row.userId}
            size={50}
            online={row.invitationStatus === "accepted"}
          />
          <View style={styles.cardHead}>
            <View style={styles.nameStatusRow}>
              <Text style={styles.cardName} numberOfLines={1}>
                {displayName}
              </Text>
              <StatusCapsule tone={supervisorStatusTone(row)} />
            </View>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {row.kristoId || row.userId}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {row.churchId || "—"}
            </Text>
          </View>
        </View>

        {!isPending ? (
          <View style={styles.analyticsRow}>
            <AnalyticsChip dotColor={SA_PURPLE} value={row.assignedCodes} label="Assigned" />
            <AnalyticsChip dotColor={SA_GOLD} value={row.remainingCodes} label="Remaining" />
            <AnalyticsChip dotColor={SA_GREEN} value={row.redeemedCodes} label="Redeemed" />
          </View>
        ) : (
          <Text style={styles.pendingHint}>Invitation awaiting acceptance</Text>
        )}

        <View style={styles.cardActions}>
          {!isPending ? (
            <>
              <GoldButton label="Assign" onPress={onAssign} compact />
              <GlassButton label="Details" onPress={onViewDetails} compact />
            </>
          ) : null}
          <View style={styles.deleteSlot}>
            <DangerIconButton onPress={onDelete} loading={deleting} size={32} />
          </View>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

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
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const [showAddModal, setShowAddModal] = React.useState(false);
  const [addKristoId, setAddKristoId] = React.useState("");
  const [addChurchId, setAddChurchId] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [assignTarget, setAssignTarget] = React.useState<SupervisorSummary | null>(null);
  const [assignQuantity, setAssignQuantity] = React.useState("10");
  const [assigning, setAssigning] = React.useState(false);

  const pendingCount = React.useMemo(
    () => supervisors.filter((row) => row.invitationStatus === "pending").length,
    [supervisors]
  );

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
    if (params.add === "1" && allowed) setShowAddModal(true);
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

  const confirmDeleteSupervisor = (row: SupervisorSummary) => {
    const name = row.fullName || row.kristoId || row.userId;
    const remaining = row.remainingCodes || 0;
    const message =
      row.invitationStatus === "pending"
        ? "This will cancel the pending supervisor invitation. The user will no longer appear in your supervisor list."
        : `Are you sure you want to delete ${name}?\n\nTheir Supervisor access will be revoked immediately. Any unredeemed activation codes (${remaining}) assigned to them will be returned to your unassigned pool. Redeemed codes remain in activation history.`;

    Alert.alert("Delete Supervisor", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void onDeleteSupervisor(row) },
    ]);
  };

  const onDeleteSupervisor = async (row: SupervisorSummary) => {
    const rowKey = row.invitationId || row.userId;
    setDeletingId(rowKey);
    try {
      const result = await deleteSupervisor({ userId: row.userId, invitationId: row.invitationId });
      await loadData();
      if (result.outcome === "invitation_cancelled") {
        Alert.alert("Invitation cancelled", "The supervisor invitation has been removed.");
      } else {
        const released = result.releasedCodes;
        Alert.alert(
          "Supervisor deleted",
          released > 0
            ? `${released} unredeemed code${released === 1 ? "" : "s"} returned to your unassigned pool.`
            : "Supervisor access has been revoked."
        );
      }
    } catch (e: any) {
      Alert.alert("Delete failed", String(e?.message || "Could not delete supervisor."));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#0E0A18", BG]} style={StyleSheet.absoluteFillObject} />

      <View style={[styles.nav, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.88)" />
        </Pressable>
        <View style={styles.navCopy}>
          <Text style={styles.navTitle}>Supervisors</Text>
          <Text style={styles.navSub}>Enterprise activation control</Text>
        </View>
      </View>

      <Pressable
        style={[styles.fab, { top: insets.top + 6 }]}
        onPress={() => setShowAddModal(true)}
        hitSlop={8}
      >
        <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFillObject} />
        <LinearGradient
          colors={["rgba(244,208,111,0.35)", "rgba(244,208,111,0.12)"]}
          style={StyleSheet.absoluteFillObject}
        />
        <Ionicons name="person-add" size={20} color={SA_GOLD} />
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <GlassCard>
            <Text style={styles.notice}>System Admin access required.</Text>
          </GlassCard>
        ) : (
          <>
            <SummaryStrip total={supervisors.length} codes={availableUnassigned} pending={pendingCount} />

            {error ? (
              <GlassCard style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </GlassCard>
            ) : null}

            {loading ? (
              <View style={styles.shimmerList}>
                <ShimmerBlock height={118} />
                <ShimmerBlock height={118} />
                <ShimmerBlock height={118} />
              </View>
            ) : supervisors.length === 0 ? (
              <GlassCard pad={18} style={styles.emptyCard}>
                <Ionicons name="people-outline" size={26} color="rgba(244,208,111,0.6)" />
                <Text style={styles.emptyTitle}>No supervisors yet.</Text>
                <Text style={styles.emptySub}>Invite your first supervisor to begin assigning codes.</Text>
                <GoldButton label="Invite supervisor" onPress={() => setShowAddModal(true)} />
              </GlassCard>
            ) : (
              <View style={styles.list}>
                {supervisors.map((row, index) => {
                  const rowKey = row.invitationId || row.userId;
                  return (
                    <SupervisorContactCard
                      key={rowKey}
                      row={row}
                      index={index}
                      deleting={deletingId === rowKey}
                      onAssign={() => setAssignTarget(row)}
                      onViewDetails={() =>
                        router.push(`/more/system-admin/supervisors/${encodeURIComponent(row.userId)}` as any)
                      }
                      onDelete={() => confirmDeleteSupervisor(row)}
                    />
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalBackdrop}>
          <GlassCard pad={14}>
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
              <Pressable onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} disabled={adding} onPress={onAddSupervisor}>
                {adding ? <ActivityIndicator color="#111" /> : <Text style={styles.modalConfirmText}>Add</Text>}
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>

      <Modal
        visible={Boolean(assignTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setAssignTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <GlassCard pad={14}>
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
              <Pressable onPress={() => setAssignTarget(null)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} disabled={assigning} onPress={onAssignCodes}>
                {assigning ? <ActivityIndicator color="#111" /> : <Text style={styles.modalConfirmText}>Assign</Text>}
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 4,
    gap: 4,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  navCopy: { flex: 1, minWidth: 0 },
  navTitle: { color: TEXT, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  navSub: { color: MUTED, fontSize: 11, marginTop: 1 },
  fab: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.35)",
    zIndex: 10,
    shadowColor: SA_GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  content: { paddingHorizontal: 14, paddingTop: 2, gap: 10 },
  summaryStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.05)",
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryValue: { color: TEXT, fontSize: 16, fontWeight: "800" },
  summaryLabel: { color: MUTED, fontSize: 9, fontWeight: "700", letterSpacing: 0.3 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: "rgba(255,255,255,0.08)" },
  list: { gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardHead: { flex: 1, minWidth: 0, gap: 2 },
  nameStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { flex: 1, color: TEXT, fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  cardMeta: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "500" },
  analyticsRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  pendingHint: { color: SA_GOLD, fontSize: 10, fontWeight: "600", marginTop: 8, fontStyle: "italic" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  deleteSlot: { marginLeft: "auto" },
  shimmerList: { gap: 8 },
  emptyCard: { alignItems: "center", gap: 8 },
  emptyTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  emptySub: { color: MUTED, fontSize: 12, textAlign: "center", marginBottom: 4 },
  notice: { color: MUTED, fontSize: 13, textAlign: "center" },
  errorCard: { borderColor: "rgba(248,113,113,0.2)" },
  errorText: { color: "#FCA5A5", fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.58)",
    justifyContent: "center",
    padding: 22,
  },
  modalTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  modalSub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  fieldLabel: { color: MUTED, fontSize: 11, fontWeight: "700", marginTop: 8 },
  modalHint: { color: MUTED, fontSize: 11 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    color: TEXT,
    backgroundColor: "rgba(255,255,255,0.03)",
    fontSize: 14,
    marginTop: 4,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  modalCancel: { color: MUTED, fontWeight: "700", fontSize: 13 },
  modalConfirm: {
    minWidth: 72,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: SA_GOLD,
  },
  modalConfirmText: { color: "#111", fontWeight: "800", fontSize: 13 },
});
