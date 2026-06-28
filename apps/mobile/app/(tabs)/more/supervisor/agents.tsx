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
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentStatusBadge, SupervisorAgentCard } from "@/src/components/supervisorAgentCard";
import {
  AnalyticsChip,
  ContactAvatar,
  GlassCard,
  SA_GOLD,
  SA_GREEN,
  SA_PURPLE,
  ShimmerBlock,
} from "@/src/components/systemAdminSupervisorUi";
import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  assignCodesToAgent,
  deleteSupervisorAgent,
  fetchSupervisorAgents,
  fetchSupervisorDashboard,
  updateSupervisorAgent,
  type SupervisorAgent,
  type SupervisorDashboardResponse,
} from "@/src/lib/offlineActivationSupervisorApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

function formatWhen(iso?: string) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function SupervisorAgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "Supervisor");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [agents, setAgents] = React.useState<SupervisorAgent[]>([]);
  const [stats, setStats] = React.useState<SupervisorDashboardResponse["stats"] | null>(null);

  const [editAgent, setEditAgent] = React.useState<SupervisorAgent | null>(null);
  const [viewAgent, setViewAgent] = React.useState<SupervisorAgent | null>(null);
  const [assignAgent, setAssignAgent] = React.useState<SupervisorAgent | null>(null);
  const [assignQty, setAssignQty] = React.useState("5");
  const [assigning, setAssigning] = React.useState(false);

  const [agentName, setAgentName] = React.useState("");
  const [agentPhone, setAgentPhone] = React.useState("");
  const [agentStatus, setAgentStatus] = React.useState<"active" | "inactive">("active");
  const [savingAgent, setSavingAgent] = React.useState(false);

  const loadAgents = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [agentRows, dashboard] = await Promise.all([fetchSupervisorAgents(), fetchSupervisorDashboard()]);
      setAgents(agentRows);
      setStats(dashboard.stats);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load agents"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      loadAgents();
    }, [loadAgents])
  );

  const openEditAgent = (agent: SupervisorAgent) => {
    setViewAgent(null);
    setEditAgent(agent);
    setAgentName(agent.fullName);
    setAgentPhone(agent.phone);
    setAgentStatus(agent.status);
  };

  const onSaveAgent = async () => {
    if (!editAgent) return;
    const fullName = agentName.trim();
    const phone = agentPhone.trim();
    if (!fullName || !phone) {
      Alert.alert("Missing info", "Enter agent name and phone number.");
      return;
    }
    setSavingAgent(true);
    try {
      await updateSupervisorAgent({ agentId: editAgent.id, fullName, phone, status: agentStatus });
      setEditAgent(null);
      await loadAgents();
    } catch (e: any) {
      Alert.alert("Could not save agent", String(e?.message || "Failed"));
    } finally {
      setSavingAgent(false);
    }
  };

  const confirmDeleteAgent = (agent: SupervisorAgent) => {
    Alert.alert("Delete Agent", `Remove ${agent.fullName} from your agent list?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void (async () => {
            try {
              await deleteSupervisorAgent(agent.id);
              await loadAgents();
            } catch (e: any) {
              Alert.alert("Delete failed", String(e?.message || "Failed"));
            }
          })(),
      },
    ]);
  };

  const onAssignCodes = async () => {
    if (!assignAgent) return;
    const qty = Math.floor(Number(assignQty));
    if (!Number.isFinite(qty) || qty < 1) {
      Alert.alert("Invalid quantity", "Enter at least 1.");
      return;
    }
    if (qty > (stats?.availableCodes || 0)) {
      Alert.alert("Not enough codes", `Only ${stats?.availableCodes || 0} codes available to assign.`);
      return;
    }
    setAssigning(true);
    try {
      const result = await assignCodesToAgent(assignAgent.id, qty);
      setAssignAgent(null);
      setAssignQty("5");
      await loadAgents();
      Alert.alert("Codes assigned", `${result.assignedCount} codes assigned to ${assignAgent.fullName}.`);
    } catch (e: any) {
      Alert.alert("Assign failed", String(e?.message || "Failed"));
    } finally {
      setAssigning(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#120A22", "#0A0E16", BG]} style={StyleSheet.absoluteFillObject} />

      <View style={[styles.nav, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.88)" />
        </Pressable>
        <Text style={styles.navTitle}>All Agents</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <GlassCard pad={12}>
            <Text style={styles.errorText}>Supervisor access required.</Text>
          </GlassCard>
        ) : loading ? (
          <View style={styles.shimmerList}>
            <ShimmerBlock height={120} />
            <ShimmerBlock height={120} />
          </View>
        ) : error ? (
          <GlassCard pad={14}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => loadAgents()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : agents.length === 0 ? (
          <GlassCard pad={12} style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No agents yet</Text>
            <Text style={styles.emptyDesc}>Add agents from your Supervisor workspace.</Text>
          </GlassCard>
        ) : (
          <View style={styles.agentList}>
            {agents.map((agent) => (
              <SupervisorAgentCard
                key={agent.id}
                agent={agent}
                onAssign={() => setAssignAgent(agent)}
                onView={() => setViewAgent(agent)}
                onEdit={() => openEditAgent(agent)}
                onDelete={() => confirmDeleteAgent(agent)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={Boolean(editAgent)} transparent animationType="fade" onRequestClose={() => setEditAgent(null)}>
        <View style={styles.modalBackdrop}>
          <GlassCard pad={14}>
            <Text style={styles.modalTitle}>Edit Agent</Text>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={agentName}
              onChangeText={setAgentName}
              placeholder="Agent name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput
              value={agentPhone}
              onChangeText={setAgentPhone}
              placeholder="+1 555 0100"
              keyboardType="phone-pad"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
            <View style={styles.statusRow}>
              {(["active", "inactive"] as const).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setAgentStatus(s)}
                  style={[styles.statusChip, agentStatus === s && styles.statusChipActive]}
                >
                  <Text style={[styles.statusChipText, agentStatus === s && styles.statusChipTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setEditAgent(null)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} disabled={savingAgent} onPress={onSaveAgent}>
                {savingAgent ? <ActivityIndicator color="#111" /> : <Text style={styles.modalConfirmText}>Save</Text>}
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>

      <Modal visible={Boolean(viewAgent)} transparent animationType="fade" onRequestClose={() => setViewAgent(null)}>
        <View style={styles.modalBackdrop}>
          <GlassCard pad={14}>
            {viewAgent ? (
              <>
                <View style={styles.viewAgentTop}>
                  <ContactAvatar
                    name={viewAgent.fullName}
                    fallbackId={viewAgent.phone}
                    size={48}
                    online={viewAgent.status === "active"}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.modalTitle}>{viewAgent.fullName}</Text>
                    <Text style={styles.agentPhone}>{viewAgent.phone}</Text>
                    <AgentStatusBadge status={viewAgent.status} />
                  </View>
                </View>
                <View style={styles.agentStats}>
                  <AnalyticsChip dotColor={SA_PURPLE} value={viewAgent.stats.assignedCodes} label="Assigned" />
                  <AnalyticsChip dotColor={SA_GOLD} value={viewAgent.stats.remainingCodes} label="Remaining" />
                  <AnalyticsChip dotColor={SA_GREEN} value={viewAgent.stats.redeemedCodes} label="Redeemed" />
                </View>
                <Text style={styles.viewAdded}>Added {formatWhen(viewAgent.createdAt)}</Text>
                <Pressable style={styles.modalConfirm} onPress={() => setViewAgent(null)}>
                  <Text style={styles.modalConfirmText}>Close</Text>
                </Pressable>
              </>
            ) : null}
          </GlassCard>
        </View>
      </Modal>

      <Modal visible={Boolean(assignAgent)} transparent animationType="fade" onRequestClose={() => setAssignAgent(null)}>
        <View style={styles.modalBackdrop}>
          <GlassCard pad={14}>
            <Text style={styles.modalTitle}>Assign Codes</Text>
            <Text style={styles.modalSub}>{assignAgent?.fullName}</Text>
            <Text style={styles.modalHint}>{stats?.availableCodes || 0} codes available to assign</Text>
            <Text style={styles.fieldLabel}>Quantity</Text>
            <TextInput
              value={assignQty}
              onChangeText={setAssignQty}
              keyboardType="number-pad"
              placeholder="5"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setAssignAgent(null)}>
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
    paddingBottom: 6,
    gap: 8,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  navTitle: { flex: 1, color: TEXT, fontSize: 17, fontWeight: "800", textAlign: "center" },
  content: { paddingHorizontal: 14, gap: 12, paddingTop: 8 },
  agentList: { gap: 12 },
  shimmerList: { gap: 10 },
  emptyCard: { alignItems: "center", gap: 4 },
  emptyTitle: { color: TEXT, fontSize: 14, fontWeight: "800" },
  emptyDesc: { color: MUTED, fontSize: 11, textAlign: "center" },
  errorText: { color: "#FCA5A5", fontSize: 12, marginBottom: 8 },
  retryText: { color: SA_GOLD, fontSize: 12, fontWeight: "800" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.58)", justifyContent: "center", padding: 22 },
  modalTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  modalSub: { color: MUTED, fontSize: 12 },
  modalHint: { color: MUTED, fontSize: 11 },
  fieldLabel: { color: MUTED, fontSize: 11, fontWeight: "700", marginTop: 8 },
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
  statusRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  statusChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusChipActive: { backgroundColor: "rgba(244,208,111,0.10)", borderColor: "rgba(244,208,111,0.28)" },
  statusChipText: { color: MUTED, fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  statusChipTextActive: { color: SA_GOLD },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 12 },
  modalCancel: { color: MUTED, fontWeight: "700" },
  modalConfirm: {
    minWidth: 80,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: SA_GOLD,
  },
  modalConfirmText: { color: "#111", fontWeight: "800" },
  viewAgentTop: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 8 },
  viewAdded: { color: MUTED, fontSize: 10, marginBottom: 10 },
  agentPhone: { color: MUTED, fontSize: 12, fontWeight: "600" },
  agentStats: { flexDirection: "row", gap: 6 },
});
