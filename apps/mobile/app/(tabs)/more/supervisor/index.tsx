import React from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AgentStatusBadge,
  SupervisorAgentCard,
} from "@/src/components/supervisorAgentCard";
import {
  AccessNotice,
  ActivitySectionPanel,
  ActivityTimelinePlaceholder,
  ADMIN_GOLD,
  ADMIN_PURPLE,
  adminStyles,
  BackgroundScene,
  ErrorCard,
  GlassSurface,
  GoldPrimaryButton,
  HeroActionCard,
  LoadingShimmer,
  OfflineActivationHeroHeader,
  PremiumEmptyState,
  PremiumMetricCard,
  type AdminMetricConfig,
} from "@/src/components/offlineActivationAdminDashboardUi";
import {
  AnalyticsChip,
  ContactAvatar,
  GlassCard,
  SA_GOLD,
  SA_GREEN,
  SA_PURPLE,
  SA_RED,
  SA_AMBER,
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
  type SupervisorWorkspaceStats,
} from "@/src/lib/offlineActivationSupervisorApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACTIVITY_LIMIT = 20;
const AGENTS_PREVIEW_LIMIT = 3;
const LAST_TAKE_STORAGE_PREFIX = "kristo_supervisor_last_take_v1:";

const COUNTRY_LOOKUP: Record<string, { flag: string; name: string }> = {
  BDI: { flag: "🇧🇮", name: "Burundi" },
  CD: { flag: "🇨🇩", name: "Congo" },
  TZ: { flag: "🇹🇿", name: "Tanzania" },
  US: { flag: "🇺🇸", name: "United States" },
};

function countryDisplay(code: string) {
  const key = String(code || "").trim().toUpperCase();
  return COUNTRY_LOOKUP[key] || { flag: "", name: key || "—" };
}

function lastTakeStorageKey(userId: string) {
  return `${LAST_TAKE_STORAGE_PREFIX}${userId}`;
}

function countAdminCodesAvailableToTake(codes: ActivationCode[], lastTakenAtMs: number) {
  return codes.filter((code) => {
    if (code.status !== "assigned_to_supervisor") return false;
    if (!String(code.assignedBySystemAdminUserId || "").trim()) return false;
    const at = Date.parse(String(code.assignedSupervisorAt || ""));
    if (!Number.isFinite(at)) return false;
    return at > lastTakenAtMs;
  }).length;
}

function isThisMonth(iso?: string | null) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return false;
  const d = new Date(ms);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

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

function formatRelative(iso?: string) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateShort(iso);
}

function computeDashboardCards(
  agents: SupervisorAgent[],
  codes: ActivationCode[],
  stats: SupervisorWorkspaceStats
) {
  return {
    totalAgents: agents.length,
    receivedThisMonth: codes.filter((c) => isThisMonth(c.assignedSupervisorAt)).length,
    redeemedThisMonth: codes.filter((c) => c.status === "redeemed" && isThisMonth(c.redeemedAt)).length,
    codesRemaining: stats.availableCodes,
  };
}

function MyAgentsPanel({
  count,
  previewAgents,
  onViewAll,
  onAddAgent,
  onAssign,
  onView,
  onEdit,
  onDelete,
}: {
  count: number;
  previewAgents: SupervisorAgent[];
  onViewAll: () => void;
  onAddAgent: () => void;
  onAssign: (agent: SupervisorAgent) => void;
  onView: (agent: SupervisorAgent) => void;
  onEdit: (agent: SupervisorAgent) => void;
  onDelete: (agent: SupervisorAgent) => void;
}) {
  return (
    <ActivitySectionPanel
      title="My Agents"
      subtitle={`${count} registered agent${count === 1 ? "" : "s"}`}
      actionLabel={count > 0 ? "View All" : undefined}
      onAction={count > 0 ? onViewAll : undefined}
    >
      {count === 0 ? (
        <PremiumEmptyState
          icon="people-outline"
          title="No agents yet"
          description="Register field agents to distribute activation codes in your region."
          actionLabel="Add Agent"
          onAction={onAddAgent}
        />
      ) : (
        <View style={styles.agentListCompact}>
          {previewAgents.map((agent) => (
            <SupervisorAgentCard
              key={agent.id}
              agent={agent}
              onAssign={() => onAssign(agent)}
              onView={() => onView(agent)}
              onEdit={() => onEdit(agent)}
              onDelete={() => onDelete(agent)}
            />
          ))}
        </View>
      )}
    </ActivitySectionPanel>
  );
}

function TakeAvailableCodesPanel({
  availableCount,
  taking,
  onTake,
}: {
  availableCount: number;
  taking: boolean;
  onTake: () => void;
}) {
  const disabled = availableCount < 1 || taking;
  const subtitle = availableCount === 1 ? "Code Available" : "Codes Available";
  const explanation =
    availableCount > 0
      ? "Acknowledge new codes from System Admin to add them to your inventory."
      : "No new codes waiting. System Admin assignments will appear here.";

  return (
    <ActivitySectionPanel title="Take Available Codes" subtitle="From System Admin">
      <GlassSurface style={adminStyles.takeCodesCard} radius={16} intensity={40}>
        <Text style={adminStyles.takeCountValue}>{availableCount}</Text>
        <Text style={adminStyles.takeCountSubtitle}>{subtitle}</Text>
        <Text style={adminStyles.takeExplanation}>{explanation}</Text>
        <GoldPrimaryButton label="Take Codes" onPress={onTake} disabled={disabled} loading={taking} />
      </GlassSurface>
    </ActivitySectionPanel>
  );
}

function CodeInventoryPanel({ batches }: { batches: SupervisorInventoryBatch[] }) {
  const empty = batches.length === 0;

  return (
    <ActivitySectionPanel title="Code Inventory" subtitle="Batches assigned to your workspace">
      {empty ? (
        <PremiumEmptyState
          icon="archive-outline"
          title="No code batches assigned yet"
          description="When System Admin assigns codes to you, batches will appear here with country and duration details."
        />
      ) : (
        <View style={adminStyles.inventoryTableShell}>
          <View style={styles.batchHeaderRow}>
            <Text style={[styles.batchHeaderCell, styles.batchHeaderWide]}>Country</Text>
            <Text style={styles.batchHeaderCell}>Duration</Text>
            <Text style={styles.batchHeaderCell}>Total</Text>
            <Text style={styles.batchHeaderCell}>Rem</Text>
            <Text style={styles.batchHeaderCell}>Red</Text>
            <View style={{ width: 12 }} />
          </View>
          {batches.map((batch, i) => (
            <InventoryBatchRow key={batch.batchId} batch={batch} isLast={i === batches.length - 1} />
          ))}
        </View>
      )}
    </ActivitySectionPanel>
  );
}

function RecentActivityPanel({ items }: { items: SupervisorCodeActivityItem[] }) {
  const empty = items.length === 0;

  return (
    <ActivitySectionPanel title="Recent Activity" subtitle="Latest code movements in your workspace">
      {empty ? (
        <ActivityTimelinePlaceholder
          title="No recent activity yet"
          description="Code assignments, redemptions, and returns will appear here as they happen."
        />
      ) : (
        <View style={styles.timelineList}>
          {items.map((item, i) => (
            <ActivityTimelineItem key={item.id} item={item} isLast={i === items.length - 1} />
          ))}
        </View>
      )}
    </ActivitySectionPanel>
  );
}

function InventoryBatchRow({
  batch,
  isLast,
}: {
  batch: SupervisorInventoryBatch;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const country = countryDisplay(batch.countryCode);
  const durationLabel = batch.durationMonths === 1 ? "1 mo" : `${batch.durationMonths} mo`;

  return (
    <>
      <Pressable
        onPress={() => {
          configureExpandAnimation();
          setExpanded((v) => !v);
        }}
        style={styles.batchRow}
      >
        <Text style={[styles.batchCountry, styles.batchHeaderWide]} numberOfLines={1}>
          {country.flag ? `${country.flag} ` : ""}
          {country.name}
        </Text>
        <Text style={styles.batchDuration}>{durationLabel}</Text>
        <Text style={styles.batchNum}>{batch.total}</Text>
        <Text style={[styles.batchNum, styles.batchRemaining]}>{batch.remaining}</Text>
        <Text style={[styles.batchNum, styles.batchRedeemed]}>{batch.redeemed}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color="rgba(255,255,255,0.38)" />
      </Pressable>
      {expanded ? (
        <View style={styles.batchExpanded}>
          <Text style={styles.batchDetailLine}>Batch ID · {batch.batchId}</Text>
          <Text style={styles.batchDetailLine}>Assigned to agents · {batch.assigned}</Text>
          <Text style={styles.batchDetailLine}>Generated · {formatDateShort(batch.createdAt)}</Text>
        </View>
      ) : null}
      {!isLast ? <View style={styles.batchDivider} /> : null}
    </>
  );
}

function activityVisual(item: SupervisorCodeActivityItem) {
  if (item.type === "assigned_to_agent") return { color: SA_GREEN, icon: "person-add" as const };
  if (item.type === "redeemed") return { color: "#60A5FA", icon: "checkmark-circle" as const };
  if (item.type === "expired") return { color: SA_RED, icon: "time" as const };
  if (item.type === "returned") return { color: SA_AMBER, icon: "return-down-back" as const };
  return { color: SA_PURPLE, icon: "download" as const };
}

function ActivityTimelineItem({
  item,
  isLast,
}: {
  item: SupervisorCodeActivityItem;
  isLast: boolean;
}) {
  const visual = activityVisual(item);
  const description = item.subtitle || item.code || "";
  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineRail}>
        {!isLast ? <View style={[styles.timelineLine, { backgroundColor: `${visual.color}28` }]} /> : null}
        <View style={[styles.timelineDot, { backgroundColor: `${visual.color}22`, borderColor: `${visual.color}40` }]}>
          <Ionicons name={visual.icon} size={9} color={visual.color} />
        </View>
      </View>
      <View style={[styles.timelineBody, !isLast && styles.timelineBodyGap]}>
        <View style={styles.timelineHead}>
          <Text style={styles.timelineTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.timelineMeta}>{formatRelative(item.occurredAt)}</Text>
        </View>
        {description ? (
          <Text style={styles.timelineDesc} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
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
  const [lastTakenAtMs, setLastTakenAtMs] = React.useState(0);
  const [takingCodes, setTakingCodes] = React.useState(false);

  const contentFade = React.useRef(new Animated.Value(0)).current;
  const contentSlide = React.useRef(new Animated.Value(16)).current;

  const userId = String(session?.userId || "").trim();

  const loadLastTakenAt = React.useCallback(async () => {
    if (!userId) return;
    try {
      const raw = await AsyncStorage.getItem(lastTakeStorageKey(userId));
      const parsed = Number(raw);
      setLastTakenAtMs(Number.isFinite(parsed) ? parsed : 0);
    } catch {
      setLastTakenAtMs(0);
    }
  }, [userId]);

  const loadDashboard = React.useCallback(async (silent = false) => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError("");
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
      if (allowed) logOfflineCodesRouteOpened("supervisor", platformRole || "", userId);
      void loadLastTakenAt();
      loadDashboard();
    }, [allowed, loadDashboard, loadLastTakenAt, platformRole, userId])
  );

  React.useEffect(() => {
    if (loading || !allowed) return;
    contentFade.setValue(0);
    contentSlide.setValue(16);
    Animated.parallel([
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(contentSlide, {
        toValue: 0,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [loading, allowed, contentFade, contentSlide]);

  const stats = data?.stats;
  const allAgents = data?.agents || [];
  const batches = data?.batches || [];
  const activity = data?.activity || [];
  const codes = data?.codes || [];

  const dashboard = React.useMemo(() => {
    if (!stats) return null;
    return computeDashboardCards(allAgents, codes, stats);
  }, [allAgents, codes, stats]);

  const latestActivity = React.useMemo(() => activity.slice(0, ACTIVITY_LIMIT), [activity]);

  const availableToTake = React.useMemo(
    () => countAdminCodesAvailableToTake(codes, lastTakenAtMs),
    [codes, lastTakenAtMs]
  );

  const previewAgents = React.useMemo(() => allAgents.slice(0, AGENTS_PREVIEW_LIMIT), [allAgents]);

  const metrics: AdminMetricConfig[] = React.useMemo(() => {
    const cards = dashboard ?? {
      totalAgents: allAgents.length,
      receivedThisMonth: 0,
      redeemedThisMonth: 0,
      codesRemaining: stats?.availableCodes ?? 0,
    };

    return [
      {
        key: "agents",
        label: "Total Agents",
        helper: "All registered agents",
        icon: "people-outline",
        color: ADMIN_PURPLE,
        glow: "rgba(156,118,255,0.22)",
        value: cards.totalAgents,
      },
      {
        key: "received",
        label: "Codes Received",
        helper: "From System Admin",
        icon: "download-outline",
        color: ADMIN_GOLD,
        glow: "rgba(244,208,111,0.24)",
        value: cards.receivedThisMonth,
      },
      {
        key: "redeemed",
        label: "Codes Redeemed",
        helper: "Activated by churches",
        icon: "checkmark-done-outline",
        color: "#93C5FD",
        glow: "rgba(147,197,253,0.22)",
        value: cards.redeemedThisMonth,
      },
      {
        key: "remaining",
        label: "Codes Remaining",
        helper: "Ready to assign",
        icon: "cube-outline",
        color: SA_GREEN,
        glow: "rgba(110,231,168,0.22)",
        value: cards.codesRemaining,
      },
    ];
  }, [allAgents.length, dashboard, stats?.availableCodes]);

  const resetAgentForm = () => {
    setAgentName("");
    setAgentPhone("");
    setAgentStatus("active");
  };

  const openAddAgent = () => {
    resetAgentForm();
    setShowAddAgent(true);
  };

  const openEditAgent = (agent: SupervisorAgent) => {
    setViewAgent(null);
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
      await loadDashboard(true);
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
              await loadDashboard(true);
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
      await loadDashboard(true);
      Alert.alert("Codes assigned", `${result.assignedCount} codes assigned to ${assignAgent.fullName}.`);
    } catch (e: any) {
      Alert.alert("Assign failed", String(e?.message || "Failed"));
    } finally {
      setAssigning(false);
    }
  };

  const assignPreviewQty = Math.floor(Number(assignQty)) || 0;

  const onTakeCodes = async () => {
    if (availableToTake < 1 || !userId) return;
    const count = availableToTake;
    setTakingCodes(true);
    try {
      await AsyncStorage.setItem(lastTakeStorageKey(userId), String(Date.now()));
      setLastTakenAtMs(Date.now());
      await loadDashboard(true);
      Alert.alert("Codes received", `${count} activation code${count === 1 ? "" : "s"} added to your inventory.`);
    } catch (e: any) {
      Alert.alert("Could not take codes", String(e?.message || "Failed"));
    } finally {
      setTakingCodes(false);
    }
  };

  return (
    <View style={styles.screen}>
      <BackgroundScene />

      <OfflineActivationHeroHeader
        title="Supervisor"
        subtitle="Offline Activation Workspace"
        badgeIcon="people-circle-outline"
        onBack={() => router.back()}
        topInset={insets.top}
      />

      <ScrollView
        contentContainerStyle={[adminStyles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!allowed ? (
          <AccessNotice
            title="Access restricted"
            message="This screen is available only for the Supervisor platform role."
          />
        ) : loading ? (
          <LoadingShimmer />
        ) : (
          <Animated.View
            style={{
              gap: 16,
              opacity: contentFade,
              transform: [{ translateY: contentSlide }],
            }}
          >
            {error ? <ErrorCard message={error} onRetry={() => loadDashboard()} /> : null}

            <View style={adminStyles.statsGrid}>
              {metrics.map((metric, index) => (
                <PremiumMetricCard key={metric.key} metric={metric} index={index} />
              ))}
            </View>

            {!error ? (
              <>
                <HeroActionCard
                  title="Add Agent"
                  subtitle="Register a trusted field agent for code distribution"
                  icon="person-add"
                  onPress={openAddAgent}
                />

                <MyAgentsPanel
                  count={allAgents.length}
                  previewAgents={previewAgents}
                  onViewAll={() => router.push("/more/supervisor/agents" as any)}
                  onAddAgent={openAddAgent}
                  onAssign={setAssignAgent}
                  onView={setViewAgent}
                  onEdit={openEditAgent}
                  onDelete={confirmDeleteAgent}
                />

                <TakeAvailableCodesPanel
                  availableCount={availableToTake}
                  taking={takingCodes}
                  onTake={onTakeCodes}
                />

                <CodeInventoryPanel batches={batches} />

                <RecentActivityPanel items={latestActivity} />
              </>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>

      <Modal
        visible={showAddAgent || Boolean(editAgent)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowAddAgent(false);
          setEditAgent(null);
          resetAgentForm();
        }}
      >
        <View style={styles.modalBackdrop}>
          <GlassCard pad={14}>
            <Text style={styles.modalTitle}>{editAgent ? "Edit Agent" : "Add Agent"}</Text>
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
                  <Text style={[styles.statusChipText, agentStatus === s && styles.statusChipTextActive]}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setShowAddAgent(false);
                  setEditAgent(null);
                  resetAgentForm();
                }}
              >
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} disabled={savingAgent} onPress={onSaveAgent}>
                {savingAgent ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <Text style={styles.modalConfirmText}>Save</Text>
                )}
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
            <View style={styles.previewBox}>
              <Text style={styles.previewValue}>
                Assign {assignPreviewQty > 0 ? assignPreviewQty : "—"} code
                {assignPreviewQty === 1 ? "" : "s"} to {assignAgent?.fullName}
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
  agentListCompact: { gap: 10 },
  timelineList: { gap: 2 },
  agentPhone: { color: MUTED, fontSize: 12, fontWeight: "600" },
  agentStats: { flexDirection: "row", gap: 6 },
  batchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  batchHeaderCell: {
    flex: 1,
    color: MUTED,
    fontSize: 8,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  batchHeaderWide: { flex: 1.35 },
  batchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  batchCountry: { color: TEXT, fontSize: 11, fontWeight: "800" },
  batchDuration: { flex: 1, color: MUTED, fontSize: 10, fontWeight: "700" },
  batchNum: { flex: 1, color: TEXT, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  batchRemaining: { color: SA_GREEN },
  batchRedeemed: { color: "#93C5FD" },
  batchExpanded: {
    paddingHorizontal: 10,
    paddingBottom: 7,
    paddingTop: 2,
    gap: 2,
  },
  batchDetailLine: { color: MUTED, fontSize: 9, fontWeight: "600" },
  batchDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.05)",
    marginHorizontal: 10,
  },
  timelineItem: { flexDirection: "row", gap: 6 },
  timelineRail: { width: 16, alignItems: "center" },
  timelineLine: {
    position: "absolute",
    top: 16,
    bottom: -2,
    width: 1,
    borderRadius: 1,
  },
  timelineDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  timelineBody: { flex: 1, minWidth: 0 },
  timelineBodyGap: { paddingBottom: 6 },
  timelineHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  timelineTitle: { flex: 1, color: TEXT, fontSize: 11, fontWeight: "700", lineHeight: 14 },
  timelineMeta: { color: MUTED, fontSize: 9, fontWeight: "600" },
  timelineDesc: { color: MUTED, fontSize: 9, marginTop: 1, lineHeight: 12 },
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
  },
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
  viewAgentTop: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 8 },
  viewAdded: { color: MUTED, fontSize: 10, marginBottom: 10 },
});
