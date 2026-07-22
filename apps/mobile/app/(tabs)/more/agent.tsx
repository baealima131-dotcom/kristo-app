import React from "react";
import {
  Alert,
  Animated,
  Easing,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentStatusBadge } from "@/src/components/supervisorAgentCard";
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
  LoadingShimmer,
  OfflineActivationHeroHeader,
  PremiumEmptyState,
  PremiumMetricCard,
  type AdminMetricConfig,
} from "@/src/components/offlineActivationAdminDashboardUi";
import {
  AnalyticsChip,
  SA_GOLD,
  SA_GREEN,
  SA_PURPLE,
  SA_RED,
  SA_AMBER,
  configureExpandAnimation,
} from "@/src/components/systemAdminSupervisorUi";
import { getSessionSync } from "@/src/lib/kristoSession";
import { churchIdsMatch, announceChurchPremiumAccessUnlocked } from "@/src/lib/churchPremiumAccess";
import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";
import {
  clearCoordinatedRefreshLanesForChurch,
  resetChurchMediaAccessCacheOnSwitch,
} from "@/src/lib/refreshCoordinator";
import { formatPremiumRenewalDate } from "@/src/lib/payments/mobileSubscriptions";
import { hasOfflineActivationRole, logOfflineCodesRouteOpened } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  activateChurchForAgent,
  fetchAgentDashboard,
  type AgentChurchAssignment,
  type AgentCodeActivityItem,
  type AgentDashboardResponse,
  type AgentInventoryBatch,
  type AgentWorkspaceStats,
} from "@/src/lib/offlineActivationAgentApi";
import type { ActivationCode } from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACTIVITY_LIMIT = 20;

function formatOfflineActivationExpiry(expiresAtMs?: number | null): string | null {
  if (!expiresAtMs || !Number.isFinite(expiresAtMs)) return null;
  return formatPremiumRenewalDate(new Date(expiresAtMs));
}

async function refreshSessionChurchSubscriptionCacheIfNeeded(args: {
  activatedChurchId: string;
  subscriptionActive?: boolean;
  subscriptionPlan?: string | null;
  subscriptionExpiresAt?: number | null;
}) {
  const session = getSessionSync();
  const userId = String(session?.userId || "").trim();
  const sessionChurchId = String(session?.churchId || session?.activeChurchId || "").trim();
  const activatedChurchId = String(args.activatedChurchId || "").trim();
  if (!userId || !sessionChurchId || !churchIdsMatch(sessionChurchId, activatedChurchId)) {
    return;
  }

  resetChurchMediaAccessCacheOnSwitch({
    userId,
    previousChurchId: sessionChurchId,
    nextChurchId: sessionChurchId,
  });
  clearCoordinatedRefreshLanesForChurch(sessionChurchId, userId);
  clearResponseCacheForRequest("GET", "/api/church/media", userId, sessionChurchId);
  clearResponseCacheForRequest("GET", "/api/church/media-hosts", userId, sessionChurchId);
  clearResponseCacheForRequest("GET", "/api/church/overview", userId, sessionChurchId);

  if (args.subscriptionActive === true) {
    announceChurchPremiumAccessUnlocked({
      churchId: sessionChurchId,
      userId,
      role: session?.role,
      churchRole: session?.churchRole,
      subscriptionActive: true,
      backendSubscriptionActive: true,
      canUseMediaTools: true,
      subscriptionPlan:
        args.subscriptionPlan === "yearly"
          ? "yearly"
          : args.subscriptionPlan === "monthly"
            ? "monthly"
            : null,
      source: "offline-agent-activation",
      persistedChurchActivation: true,
    });
  }
}

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

function buildMetrics(stats: AgentWorkspaceStats): AdminMetricConfig[] {
  return [
    {
      key: "assigned",
      label: "Assigned Codes",
      helper: "Total assigned to you",
      icon: "layers-outline",
      color: ADMIN_PURPLE,
      glow: "rgba(156,118,255,0.22)",
      value: stats.assignedCodes,
    },
    {
      key: "available",
      label: "Available Codes",
      helper: "Ready to deliver",
      icon: "sparkles-outline",
      color: ADMIN_GOLD,
      glow: "rgba(244,208,111,0.24)",
      value: stats.availableCodes,
    },
    {
      key: "redeemed",
      label: "Redeemed Codes",
      helper: "Activated by churches",
      icon: "checkmark-done-outline",
      color: "#93C5FD",
      glow: "rgba(147,197,253,0.22)",
      value: stats.redeemedCodes,
    },
    {
      key: "remaining",
      label: "Remaining Codes",
      helper: "Still in your inventory",
      icon: "cube-outline",
      color: SA_GREEN,
      glow: "rgba(110,231,168,0.22)",
      value: stats.remainingCodes,
    },
  ];
}

function ActivateChurchPanel({
  availableCodes,
  churchId,
  activationCode,
  activating,
  onChurchIdChange,
  onActivationCodeChange,
  onSelectCode,
  onActivate,
}: {
  availableCodes: ActivationCode[];
  churchId: string;
  activationCode: string;
  activating: boolean;
  onChurchIdChange: (value: string) => void;
  onActivationCodeChange: (value: string) => void;
  onSelectCode: (code: ActivationCode) => void;
  onActivate: () => void;
}) {
  const normalizedSelected = activationCode.trim().toUpperCase();
  const canActivate = Boolean(churchId.trim() && activationCode.trim()) && !activating;

  return (
    <ActivitySectionPanel title="Activate Church" subtitle="Redeem a code for a church">
      <GlassSurface style={styles.activateCard} radius={16} intensity={40}>
        <Text style={styles.fieldLabel}>Church ID</Text>
        <TextInput
          value={churchId}
          onChangeText={onChurchIdChange}
          placeholder="Enter church ID"
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>Activation Code</Text>
        <TextInput
          value={activationCode}
          onChangeText={(value) => onActivationCodeChange(value.toUpperCase())}
          placeholder="KR-XX-MX-XXXX-XXXX"
          autoCapitalize="characters"
          autoCorrect={false}
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />

        {availableCodes.length > 0 ? (
          <View style={styles.availableCodesBlock}>
            <Text style={styles.availableCodesLabel}>
              {availableCodes.length} available code{availableCodes.length === 1 ? "" : "s"}
            </Text>
            <View style={styles.availableCodesList}>
              {availableCodes.map((code) => {
                const selected = normalizedSelected === String(code.code || "").trim().toUpperCase();
                return (
                  <Pressable
                    key={code.id}
                    onPress={() => onSelectCode(code)}
                    style={[styles.availableCodeRow, selected && styles.availableCodeRowSelected]}
                  >
                    <Text style={styles.availableCodeText} numberOfLines={1}>
                      {code.code}
                    </Text>
                    <Text style={styles.availableCodeMeta}>
                      M{code.durationMonths} · {code.countryCode}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <Text style={styles.activateHint}>No available codes in your inventory right now.</Text>
        )}

        <GoldPrimaryButton
          label="Activate Church"
          onPress={onActivate}
          disabled={!canActivate}
          loading={activating}
          style={styles.activateButton}
        />
      </GlassSurface>
    </ActivitySectionPanel>
  );
}

function ChurchAssignmentRow({ church }: { church: AgentChurchAssignment }) {
  return (
    <GlassSurface style={styles.churchRow} radius={16} intensity={40}>
      <View style={styles.churchRowTop}>
        <View style={styles.churchIconWrap}>
          <Ionicons name="business-outline" size={18} color={ADMIN_GOLD} />
        </View>
        <View style={styles.churchCopy}>
          <Text style={styles.churchName} numberOfLines={1}>
            {church.churchName}
          </Text>
          <Text style={styles.churchMeta} numberOfLines={1}>
            {church.churchId || "—"}
          </Text>
        </View>
        <AgentStatusBadge status={church.status} />
      </View>
      <View style={styles.churchStats}>
        <AnalyticsChip dotColor={SA_PURPLE} value={church.assignedCodes} label="Assigned" />
        <AnalyticsChip dotColor={SA_GOLD} value={church.remainingCodes} label="Remaining" />
        <AnalyticsChip dotColor={SA_GREEN} value={church.redeemedCodes} label="Redeemed" />
      </View>
    </GlassSurface>
  );
}

function MyChurchesPanel({ churches }: { churches: AgentChurchAssignment[] }) {
  return (
    <ActivitySectionPanel
      title="My Churches"
      subtitle={`${churches.length} church assignment${churches.length === 1 ? "" : "s"}`}
    >
      {churches.length === 0 ? (
        <PremiumEmptyState
          icon="business-outline"
          title="No churches assigned yet"
          description="When a supervisor registers you for a church, it will appear here."
        />
      ) : (
        <View style={styles.churchList}>
          {churches.map((church) => (
            <ChurchAssignmentRow key={`${church.agentId}-${church.churchId}`} church={church} />
          ))}
        </View>
      )}
    </ActivitySectionPanel>
  );
}

function ActivationCodesPanel({ batches }: { batches: AgentInventoryBatch[] }) {
  return (
    <ActivitySectionPanel title="Activation Codes" subtitle="Code batches in your inventory">
      {batches.length === 0 ? (
        <PremiumEmptyState
          icon="ticket-outline"
          title="No activation codes yet"
          description="Codes assigned by your supervisor will appear here grouped by batch."
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

function InventoryBatchRow({ batch, isLast }: { batch: AgentInventoryBatch; isLast: boolean }) {
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
          <Text style={styles.batchDetailLine}>Generated · {formatDateShort(batch.createdAt)}</Text>
        </View>
      ) : null}
      {!isLast ? <View style={styles.batchDivider} /> : null}
    </>
  );
}

function RecentActivityPanel({ items }: { items: AgentCodeActivityItem[] }) {
  return (
    <ActivitySectionPanel title="Recent Activity" subtitle="Latest code movements in your workspace">
      {items.length === 0 ? (
        <ActivityTimelinePlaceholder
          title="No recent activity yet"
          description="Code receipts and church redemptions will appear here as they happen."
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

function activityVisual(item: AgentCodeActivityItem) {
  if (item.type === "assigned_to_agent") return { color: SA_GREEN, icon: "person-add" as const };
  if (item.type === "redeemed") return { color: "#60A5FA", icon: "checkmark-circle" as const };
  if (item.type === "expired") return { color: SA_RED, icon: "time" as const };
  if (item.type === "returned") return { color: SA_AMBER, icon: "return-down-back" as const };
  return { color: SA_PURPLE, icon: "download" as const };
}

function ActivityTimelineItem({ item, isLast }: { item: AgentCodeActivityItem; isLast: boolean }) {
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

export default function AgentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "Agent");
  const userId = String(session?.userId || "").trim();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [data, setData] = React.useState<AgentDashboardResponse | null>(null);
  const [churchIdInput, setChurchIdInput] = React.useState("");
  const [activationCodeInput, setActivationCodeInput] = React.useState("");
  const [activating, setActivating] = React.useState(false);

  const contentFade = React.useRef(new Animated.Value(0)).current;
  const contentSlide = React.useRef(new Animated.Value(16)).current;

  const loadDashboard = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetchAgentDashboard();
      setData(res);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load dashboard"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      if (allowed) logOfflineCodesRouteOpened("agent", platformRole || "", userId);
      loadDashboard();
    }, [allowed, loadDashboard, platformRole, userId])
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
  const churches = data?.churches || [];
  const batches = data?.batches || [];
  const activity = data?.activity || [];

  const metrics = React.useMemo(
    () =>
      buildMetrics(
        stats ?? {
          assignedCodes: 0,
          availableCodes: 0,
          redeemedCodes: 0,
          remainingCodes: 0,
        }
      ),
    [stats]
  );

  const latestActivity = React.useMemo(() => activity.slice(0, ACTIVITY_LIMIT), [activity]);

  const availableCodes = React.useMemo(
    () => (data?.codes || []).filter((code) => code.status === "assigned_to_agent"),
    [data?.codes]
  );

  const handleActivatePress = React.useCallback(() => {
    const churchId = churchIdInput.trim();
    const activationCode = activationCodeInput.trim();
    if (!churchId || !activationCode) {
      Alert.alert("Missing info", "Enter Church ID and Activation Code.");
      return;
    }

    Alert.alert(
      "Activate Church",
      `Redeem ${activationCode.toUpperCase()} for church ${churchId}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setActivating(true);
            try {
              const result = await activateChurchForAgent({ churchId, activationCode });
              setChurchIdInput("");
              setActivationCodeInput("");
              await refreshSessionChurchSubscriptionCacheIfNeeded({
                activatedChurchId: result.church.churchId,
                subscriptionActive: result.subscription?.subscriptionActive,
                subscriptionPlan: result.subscription?.subscriptionPlan ?? null,
                subscriptionExpiresAt: result.subscription?.subscriptionExpiresAt ?? null,
              });
              await loadDashboard();
              const expiryLabel = formatOfflineActivationExpiry(
                result.subscription?.subscriptionExpiresAt
              );
              const expiryLine = expiryLabel ? `\nPremium access until ${expiryLabel}.` : "";
              Alert.alert(
                "Church activated",
                `${result.church.churchName} was activated with code ${result.code.code}.${expiryLine}`
              );
            } catch (e: any) {
              Alert.alert("Activation failed", String(e?.message || "Failed"));
            } finally {
              setActivating(false);
            }
          },
        },
      ]
    );
  }, [activationCodeInput, churchIdInput, loadDashboard]);

  return (
    <View style={styles.screen}>
      <BackgroundScene />

      <OfflineActivationHeroHeader
        title="Agent"
        subtitle="Offline Activation Workspace"
        badgeIcon="ticket-outline"
        onBack={() => router.back()}
        topInset={insets.top}
      />

      <ScrollView
        contentContainerStyle={[adminStyles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <AccessNotice
            title="Access restricted"
            message="This screen is available only for the Agent platform role."
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
                <ActivateChurchPanel
                  availableCodes={availableCodes}
                  churchId={churchIdInput}
                  activationCode={activationCodeInput}
                  activating={activating}
                  onChurchIdChange={setChurchIdInput}
                  onActivationCodeChange={setActivationCodeInput}
                  onSelectCode={(code) => setActivationCodeInput(String(code.code || "").trim().toUpperCase())}
                  onActivate={handleActivatePress}
                />
                <MyChurchesPanel churches={churches} />
                <ActivationCodesPanel batches={batches} />
                <RecentActivityPanel items={latestActivity} />
              </>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  activateCard: { padding: 14, gap: 2 },
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
  availableCodesBlock: { marginTop: 10, gap: 6 },
  availableCodesLabel: { color: MUTED, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  availableCodesList: { gap: 6 },
  availableCodeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  availableCodeRowSelected: {
    borderColor: "rgba(244,208,111,0.35)",
    backgroundColor: "rgba(244,208,111,0.08)",
  },
  availableCodeText: { flex: 1, color: TEXT, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  availableCodeMeta: { color: MUTED, fontSize: 10, fontWeight: "700" },
  activateHint: { color: MUTED, fontSize: 11, marginTop: 10, lineHeight: 16 },
  activateButton: { marginTop: 12 },
  churchList: { gap: 10 },
  churchRow: { padding: 14, gap: 10, overflow: "hidden" },
  churchRowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  churchIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  churchCopy: { flex: 1, minWidth: 0, gap: 3 },
  churchName: { color: TEXT, fontSize: 15, fontWeight: "800" },
  churchMeta: { color: MUTED, fontSize: 11, fontWeight: "600" },
  churchStats: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
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
  batchExpanded: { paddingHorizontal: 10, paddingBottom: 7, paddingTop: 2, gap: 2 },
  batchDetailLine: { color: MUTED, fontSize: 9, fontWeight: "600" },
  batchDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.05)",
    marginHorizontal: 10,
  },
  timelineList: { gap: 2 },
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
});
