import React from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
  SpringPress,
  StatusCapsule,
  configureExpandAnimation,
} from "@/src/components/systemAdminSupervisorUi";
import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole, logOfflineCodesRouteOpened } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import type { ActivationCode } from "@/src/lib/offlineActivationCodesApi";
import {
  addSupervisorAgent,
  assignCodesToAgent,
  deleteSupervisorAgent,
  fetchSupervisorDashboard,
  updateSupervisorAgent,
  type SupervisorAgent,
  type SupervisorCodeActivityItem,
  type SupervisorDashboardResponse,
  type SupervisorInventoryBatch,
} from "@/src/lib/offlineActivationSupervisorApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type AgentFilter = "all" | "active" | "inactive";
type CodeFilter = "all" | "available" | "assigned" | "redeemed" | "expired";

const AGENT_FILTERS: { key: AgentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

const CODE_FILTERS: { key: CodeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "assigned", label: "Assigned" },
  { key: "redeemed", label: "Redeemed" },
  { key: "expired", label: "Expired" },
];

function formatWhen(iso?: string) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateShort(iso?: string) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function matchesCodeFilter(code: ActivationCode, filter: CodeFilter) {
  if (filter === "all") return true;
  if (filter === "available") return code.status === "assigned_to_supervisor";
  if (filter === "assigned") return code.status === "assigned_to_agent";
  if (filter === "redeemed") return code.status === "redeemed";
  if (filter === "expired") return code.status === "disabled";
  return true;
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    scale.setValue(0.9);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 6 }).start();
  }, [value, scale]);

  return (
    <GlassCard pad={10} style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <Animated.Text style={[styles.statValue, { color, transform: [{ scale }] }]}>{value}</Animated.Text>
      <Text style={styles.statLabel}>{label}</Text>
    </GlassCard>
  );
}

function BatchCard({ batch }: { batch: SupervisorInventoryBatch }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <GlassCard pad={10}>
      <Pressable
        onPress={() => {
          configureExpandAnimation();
          setExpanded((v) => !v);
        }}
        style={styles.batchHeader}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.batchTitle}>
            {batch.countryCode} · {batch.durationMonths} mo · {batch.total} codes
          </Text>
          <Text style={styles.batchMeta}>Created {formatDateShort(batch.createdAt)}</Text>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color="rgba(255,255,255,0.45)" />
      </Pressable>
      <View style={styles.batchGrid}>
        <View style={styles.batchCell}>
          <Text style={styles.batchCellLabel}>Remaining</Text>
          <Text style={[styles.batchCellValue, { color: SA_GREEN }]}>{batch.remaining}</Text>
        </View>
        <View style={styles.batchCell}>
          <Text style={styles.batchCellLabel}>Assigned</Text>
          <Text style={[styles.batchCellValue, { color: SA_PURPLE }]}>{batch.assigned}</Text>
        </View>
        <View style={styles.batchCell}>
          <Text style={styles.batchCellLabel}>Redeemed</Text>
          <Text style={styles.batchCellValue}>{batch.redeemed}</Text>
        </View>
      </View>
      {expanded ? (
        <Text style={styles.batchId}>Batch {batch.batchId.slice(0, 18)}…</Text>
      ) : null}
    </GlassCard>
  );
}

function ActivityRow({ item }: { item: SupervisorCodeActivityItem }) {
  const tone =
    item.type === "assigned_to_agent"
      ? SA_PURPLE
      : item.type === "redeemed"
        ? SA_GREEN
        : item.type === "expired"
          ? "#F87171"
          : SA_GOLD;
  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityDot, { backgroundColor: tone }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.activityTitle}>{item.title}</Text>
        <Text style={styles.activitySub}>
          {item.subtitle || item.code} · {formatWhen(item.occurredAt)}
        </Text>
      </View>
    </View>
  );
}

function AgentStatusBadge({ status }: { status: "active" | "inactive" }) {
  const active = status === "active";
  return (
    <View style={[styles.agentStatusBadge, active ? styles.agentStatusActive : styles.agentStatusInactive]}>
      <Text style={styles.agentStatusText}>{active ? "Active" : "Inactive"}</Text>
    </View>
  );
}

export default function SupervisorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "Supervisor");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [data, setData] = React.useState<SupervisorDashboardResponse | null>(null);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [agentFilter, setAgentFilter] = React.useState<AgentFilter>("all");
  const [codeFilter, setCodeFilter] = React.useState<CodeFilter>("all");

  const [showAddAgent, setShowAddAgent] = React.useState(false);
  const [editAgent, setEditAgent] = React.useState<SupervisorAgent | null>(null);
  const [viewAgent, setViewAgent] = React.useState<SupervisorAgent | null>(null);
  const [assignAgent, setAssignAgent] = React.useState<SupervisorAgent | null>(null);
  const [assignQty, setAssignQty] = React.useState("5");
  const [assigning, setAssigning] = React.useState(false);

  const [agentName, setAgentName] = React.useState("");
  const [agentPhone, setAgentPhone] = React.useState("");
  const [agentStatus, setAgentStatus] = React.useState<"active" | "inactive">("active");
  const [savingAgent, setSavingAgent] = React.useState(false);

  const loadDashboard = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetchSupervisorDashboard();
      setData(res);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load dashboard"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      if (allowed) logOfflineCodesRouteOpened("supervisor", platformRole || "", String(session?.userId || ""));
      loadDashboard();
    }, [allowed, loadDashboard, platformRole, session?.userId])
  );

  const profile = data?.profile;
  const stats = data?.stats;
  const displayName = profile?.fullName || profile?.kristoId || profile?.userId || "Supervisor";

  const filteredAgents = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = data?.agents || [];
    if (agentFilter === "active") list = list.filter((a) => a.status === "active");
    if (agentFilter === "inactive") list = list.filter((a) => a.status === "inactive");
    if (q) {
      list = list.filter(
        (a) => a.fullName.toLowerCase().includes(q) || a.phone.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data?.agents, agentFilter, searchQuery]);

  const filteredCodes = React.useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    let list = data?.codes || [];
    list = list.filter((c) => matchesCodeFilter(c, codeFilter));
    if (q) list = list.filter((c) => String(c.code || "").toUpperCase().includes(q));
    return list.slice(0, 40);
  }, [data?.codes, codeFilter, searchQuery]);

  const filteredActivity = React.useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    let list = data?.activity || [];
    if (q) list = list.filter((a) => String(a.code || "").toUpperCase().includes(q));
    return list.slice(0, 30);
  }, [data?.activity, searchQuery]);

  const resetAgentForm = () => {
    setAgentName("");
    setAgentPhone("");
    setAgentStatus("active");
  };

  const openEditAgent = (agent: SupervisorAgent) => {
    setEditAgent(agent);
    setAgentName(agent.fullName);
    setAgentPhone(agent.phone);
    setAgentStatus(agent.status);
  };

  const onSaveAgent = async () => {
    const fullName = agentName.trim();
    const phone = agentPhone.trim();
    if (!fullName || !phone) {
      Alert.alert("Missing info", "Enter agent name and phone number.");
      return;
    }
    setSavingAgent(true);
    try {
      if (editAgent) {
        await updateSupervisorAgent({ agentId: editAgent.id, fullName, phone, status: agentStatus });
        setEditAgent(null);
      } else {
        await addSupervisorAgent({ fullName, phone, status: agentStatus });
        setShowAddAgent(false);
      }
      resetAgentForm();
      await loadDashboard();
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
              await loadDashboard();
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
      await loadDashboard();
      Alert.alert("Codes assigned", `${result.assignedCount} codes assigned to ${assignAgent.fullName}.`);
    } catch (e: any) {
      Alert.alert("Assign failed", String(e?.message || "Failed"));
    } finally {
      setAssigning(false);
    }
  };

  const assignPreviewQty = Math.floor(Number(assignQty)) || 0;

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#120A22", "#0A0E16", BG]} style={StyleSheet.absoluteFillObject} />
      <View pointerEvents="none" style={styles.glowPurple} />
      <View pointerEvents="none" style={styles.glowGold} />

      <View style={[styles.nav, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.88)" />
        </Pressable>
        <Text style={styles.navTitle}>Supervisor</Text>
        <SpringPress onPress={() => { resetAgentForm(); setShowAddAgent(true); }}>
          <View style={styles.fab}>
            <Ionicons name="person-add" size={18} color={SA_GOLD} />
          </View>
        </SpringPress>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!allowed ? (
          <GlassCard pad={16}>
            <Text style={styles.notice}>Supervisor access required.</Text>
          </GlassCard>
        ) : loading ? (
          <View style={styles.shimmerList}>
            <ShimmerBlock height={100} />
            <ShimmerBlock height={72} />
            <ShimmerBlock height={120} />
          </View>
        ) : error ? (
          <GlassCard pad={12}>
            <Text style={styles.errorText}>{error}</Text>
          </GlassCard>
        ) : (
          <>
            <GlassCard pad={12}>
              <View style={styles.profileRow}>
                <ContactAvatar
                  uri={profile?.avatarUrl}
                  name={displayName}
                  fallbackId={profile?.kristoId}
                  size={54}
                  online
                />
                <View style={styles.profileCopy}>
                  <View style={styles.profileNameRow}>
                    <Text style={styles.profileName} numberOfLines={2}>
                      {displayName}
                    </Text>
                    <StatusCapsule tone="accepted" />
                  </View>
                  <Text style={styles.profileMeta}>{profile?.churchId || "Assigned church —"}</Text>
                  <Text style={styles.profileMeta}>{profile?.kristoId || profile?.userId}</Text>
                </View>
              </View>
            </GlassCard>

            {stats ? (
              <>
                <View style={styles.statsRow}>
                  <StatCard label="Received" value={stats.totalReceived} icon="download-outline" color={SA_GOLD} />
                  <StatCard label="Available" value={stats.availableCodes} icon="cube-outline" color={SA_GREEN} />
                </View>
                <View style={styles.statsRow}>
                  <StatCard label="To Agents" value={stats.assignedToAgents} icon="people-outline" color={SA_PURPLE} />
                  <StatCard label="Redeemed" value={stats.redeemedCodes} icon="checkmark-done-outline" color="#93C5FD" />
                </View>
                <View style={styles.analyticsRow}>
                  <AnalyticsChip dotColor={SA_GOLD} value={stats.totalReceived} label="Received" />
                  <AnalyticsChip dotColor={SA_PURPLE} value={stats.codesAssigned} label="Assigned" />
                  <AnalyticsChip dotColor={SA_GREEN} value={stats.codesRemaining} label="Remaining" />
                  <AnalyticsChip dotColor="#93C5FD" value={stats.redeemedCodes} label="Redeemed" />
                </View>
              </>
            ) : null}

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color={MUTED} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search agents or activation codes"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.searchInput}
              />
            </View>

            <Text style={styles.sectionTitle}>My Agents</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {AGENT_FILTERS.map((chip) => (
                <Pressable
                  key={chip.key}
                  onPress={() => setAgentFilter(chip.key)}
                  style={[styles.chip, agentFilter === chip.key && styles.chipActive]}
                >
                  <Text style={[styles.chipText, agentFilter === chip.key && styles.chipTextActive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {filteredAgents.length === 0 ? (
              <GlassCard pad={16} style={styles.emptyCard}>
                <Ionicons name="people-outline" size={26} color={SA_GOLD} />
                <Text style={styles.emptyTitle}>No agents yet</Text>
                <Text style={styles.emptySub}>Add your first agent to start distributing activation codes.</Text>
                <GoldButton label="Add Agent" onPress={() => { resetAgentForm(); setShowAddAgent(true); }} />
              </GlassCard>
            ) : (
              filteredAgents.map((agent) => (
                <GlassCard key={agent.id} pad={10}>
                  <View style={styles.agentTop}>
                    <ContactAvatar
                      uri={agent.avatarUrl}
                      name={agent.fullName}
                      fallbackId={agent.phone}
                      size={44}
                      online={agent.status === "active"}
                    />
                    <View style={styles.agentCopy}>
                      <View style={styles.agentNameRow}>
                        <Text style={styles.agentName} numberOfLines={1}>
                          {agent.fullName}
                        </Text>
                        <AgentStatusBadge status={agent.status} />
                      </View>
                      <Text style={styles.agentMeta}>{agent.phone}</Text>
                      <Text style={styles.agentMeta}>Added {formatDateShort(agent.createdAt)}</Text>
                    </View>
                  </View>
                  <View style={styles.analyticsRow}>
                    <AnalyticsChip dotColor={SA_PURPLE} value={agent.stats.assignedCodes} label="Assigned" />
                    <AnalyticsChip dotColor={SA_GOLD} value={agent.stats.remainingCodes} label="Remaining" />
                    <AnalyticsChip dotColor={SA_GREEN} value={agent.stats.redeemedCodes} label="Redeemed" />
                  </View>
                  <View style={styles.agentActions}>
                    {agent.status === "active" ? (
                      <GoldButton label="Assign" onPress={() => setAssignAgent(agent)} compact />
                    ) : null}
                    <GlassButton label="View" onPress={() => setViewAgent(agent)} compact />
                    <GlassButton label="Edit" onPress={() => openEditAgent(agent)} compact />
                    <DangerIconButton onPress={() => confirmDeleteAgent(agent)} size={30} />
                  </View>
                </GlassCard>
              ))
            )}

            <Text style={styles.sectionTitle}>Code Inventory</Text>
            {(data?.batches || []).length === 0 ? (
              <GlassCard pad={14}>
                <Text style={styles.emptySub}>No code batches assigned to you yet.</Text>
              </GlassCard>
            ) : (
              (data?.batches || []).map((batch) => <BatchCard key={batch.batchId} batch={batch} />)
            )}

            <Text style={styles.sectionTitle}>Code Activity</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {CODE_FILTERS.map((chip) => (
                <Pressable
                  key={chip.key}
                  onPress={() => setCodeFilter(chip.key)}
                  style={[styles.chip, codeFilter === chip.key && styles.chipActive]}
                >
                  <Text style={[styles.chipText, codeFilter === chip.key && styles.chipTextActive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {filteredActivity.length === 0 ? (
              <GlassCard pad={14}>
                <Text style={styles.emptySub}>No activity yet for the selected filters.</Text>
              </GlassCard>
            ) : (
              <GlassCard pad={10}>
                {filteredActivity.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </GlassCard>
            )}

            {filteredCodes.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Matching Codes ({filteredCodes.length})</Text>
                {filteredCodes.slice(0, 15).map((code) => (
                  <GlassCard key={code.id} pad={10}>
                    <Text style={styles.codeValue}>{code.code}</Text>
                    <Text style={styles.codeMeta}>
                      {code.countryCode} · {code.durationMonths} mo · {code.status.replace(/_/g, " ")}
                    </Text>
                  </GlassCard>
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <Modal visible={showAddAgent || Boolean(editAgent)} transparent animationType="fade" onRequestClose={() => { setShowAddAgent(false); setEditAgent(null); resetAgentForm(); }}>
        <View style={styles.modalBackdrop}>
          <GlassCard pad={14}>
            <Text style={styles.modalTitle}>{editAgent ? "Edit Agent" : "Add Agent"}</Text>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput value={agentName} onChangeText={setAgentName} placeholder="Agent name" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput value={agentPhone} onChangeText={setAgentPhone} placeholder="+1 555 0100" keyboardType="phone-pad" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
            <View style={styles.statusRow}>
              {(["active", "inactive"] as const).map((s) => (
                <Pressable key={s} onPress={() => setAgentStatus(s)} style={[styles.statusChip, agentStatus === s && styles.statusChipActive]}>
                  <Text style={[styles.statusChipText, agentStatus === s && styles.statusChipTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable onPress={() => { setShowAddAgent(false); setEditAgent(null); resetAgentForm(); }}>
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
                  <ContactAvatar name={viewAgent.fullName} fallbackId={viewAgent.phone} size={52} online={viewAgent.status === "active"} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.modalTitle}>{viewAgent.fullName}</Text>
                    <Text style={styles.agentMeta}>{viewAgent.phone}</Text>
                    <AgentStatusBadge status={viewAgent.status} />
                  </View>
                </View>
                <View style={styles.analyticsRow}>
                  <AnalyticsChip dotColor={SA_PURPLE} value={viewAgent.stats.assignedCodes} label="Assigned" />
                  <AnalyticsChip dotColor={SA_GOLD} value={viewAgent.stats.remainingCodes} label="Remaining" />
                  <AnalyticsChip dotColor={SA_GREEN} value={viewAgent.stats.redeemedCodes} label="Redeemed" />
                </View>
                <Text style={styles.agentMeta}>Added {formatWhen(viewAgent.createdAt)}</Text>
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
            <TextInput value={assignQty} onChangeText={setAssignQty} keyboardType="number-pad" placeholder="5" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Preview</Text>
              <Text style={styles.previewValue}>
                Assign {assignPreviewQty > 0 ? assignPreviewQty : "—"} code{assignPreviewQty === 1 ? "" : "s"} to {assignAgent?.fullName}
              </Text>
            </View>
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
  glowPurple: {
    position: "absolute",
    top: -60,
    right: -40,
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: "rgba(156,118,255,0.16)",
  },
  glowGold: {
    position: "absolute",
    bottom: 80,
    left: -30,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.08)",
  },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 4,
    gap: 8,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  navTitle: { flex: 1, color: TEXT, fontSize: 18, fontWeight: "800" },
  fab: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.28)",
  },
  content: { paddingHorizontal: 14, paddingTop: 2, gap: 10 },
  profileRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  profileCopy: { flex: 1, minWidth: 0, gap: 3 },
  profileNameRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  profileName: { flex: 1, color: TEXT, fontSize: 17, fontWeight: "800" },
  profileMeta: { color: "rgba(255,255,255,0.45)", fontSize: 11 },
  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, alignItems: "center", gap: 4 },
  statIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statLabel: { color: MUTED, fontSize: 10, fontWeight: "700", textAlign: "center" },
  analyticsRow: { flexDirection: "row", gap: 6 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.06)",
  },
  searchInput: { flex: 1, color: TEXT, fontSize: 13, padding: 0 },
  sectionTitle: { color: TEXT, fontSize: 14, fontWeight: "800", marginTop: 2 },
  chipRow: { gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.06)",
  },
  chipActive: { backgroundColor: "rgba(156,118,255,0.12)", borderColor: "rgba(156,118,255,0.28)" },
  chipText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  chipTextActive: { color: SA_PURPLE },
  agentTop: { flexDirection: "row", gap: 10, marginBottom: 8 },
  agentCopy: { flex: 1, minWidth: 0, gap: 2 },
  agentNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  agentName: { flex: 1, color: TEXT, fontSize: 14, fontWeight: "800" },
  agentMeta: { color: MUTED, fontSize: 10 },
  agentActions: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  batchHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  batchTitle: { color: TEXT, fontSize: 13, fontWeight: "800" },
  batchMeta: { color: MUTED, fontSize: 10 },
  batchGrid: { flexDirection: "row", gap: 6 },
  batchCell: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
    gap: 2,
  },
  batchCellLabel: { color: MUTED, fontSize: 9, fontWeight: "700" },
  batchCellValue: { color: TEXT, fontSize: 13, fontWeight: "800" },
  batchId: { color: MUTED, fontSize: 9, marginTop: 8 },
  activityRow: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  activityDot: { width: 8, height: 8, borderRadius: 999, marginTop: 4 },
  activityTitle: { color: TEXT, fontSize: 12, fontWeight: "700" },
  activitySub: { color: MUTED, fontSize: 10, lineHeight: 14 },
  codeValue: { color: TEXT, fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
  codeMeta: { color: MUTED, fontSize: 10, marginTop: 2 },
  emptyCard: { alignItems: "center", gap: 8 },
  emptyTitle: { color: TEXT, fontSize: 15, fontWeight: "800" },
  emptySub: { color: MUTED, fontSize: 11, textAlign: "center" },
  shimmerList: { gap: 8 },
  notice: { color: MUTED, textAlign: "center" },
  errorText: { color: "#FCA5A5", fontSize: 12 },
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
  previewBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(156,118,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(156,118,255,0.18)",
    gap: 4,
  },
  previewLabel: { color: MUTED, fontSize: 10, fontWeight: "700" },
  previewValue: { color: TEXT, fontSize: 12, fontWeight: "700" },
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
  viewAgentTop: { flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 10 },
  agentStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  agentStatusActive: {
    backgroundColor: "rgba(110,231,168,0.12)",
    borderColor: "rgba(110,231,168,0.28)",
  },
  agentStatusInactive: {
    backgroundColor: "rgba(251,191,36,0.10)",
    borderColor: "rgba(251,191,36,0.25)",
  },
  agentStatusText: { color: MUTED, fontSize: 9, fontWeight: "800" },
});
