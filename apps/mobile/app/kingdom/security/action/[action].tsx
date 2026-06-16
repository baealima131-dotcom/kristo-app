import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Modal, Animated, Easing } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  addTrustedDevice,
  countApprovalStats,
  countRoleReviewStats,
  countSessionStats,
  countTrustedDeviceStats,
  DEFAULT_ACTIVE_SESSIONS,
  DEFAULT_APPROVALS,
  DEFAULT_ROLE_REVIEWS,
  DEFAULT_SECURITY_LOGS,
  DEFAULT_TRUSTED_DEVICES,
  DEFAULT_TRUST_POLICY,
  forceReloginSession,
  getActiveSessions,
  getApprovalRequests,
  getRoleReviewRequests,
  getSecurityLogs,
  getTrustedDevices,
  getTrustPolicy,
  killActiveSession,
  revokeTrustedDevice,
  runTrustedDeviceScan,
  type ActiveSessionEntry,
  type ApprovalRequest,
  type ApprovalStatus,
  type AuditLogEntry,
  type RoleReviewRequest,
  type RoleReviewStatus,
  type TrustedDeviceEntry,
  type TrustPolicy,
  updateApprovalStatus,
  updateRoleReviewStatus,
  updateTrustPolicy,
} from "@/src/lib/kingdomSecurityStore";


const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";
const CARD = "rgba(255,255,255,0.05)";
const GREEN = "#22C55E";
const RED = "#FF6B6B";
const BLUE = "#5AA8FF";

type PriorityLevel = "critical" | "high" | "normal";

function getMinutesAgo(requestedAt: string): number {
  const m = requestedAt.toLowerCase().match(/(\d+)/);
  return m ? Number(m[1]) : 999;
}

function getPriorityScore(item: ApprovalRequest): number {
  let score = 0;

  if (item.trustedDevice === false) score += 30;
  if (item.knownLocation === false) score += 25;

  const failedAttempts = item.failedAttempts ?? 0;
  score += Math.min(failedAttempts * 12, 36);

  const requestedRoleLevel = item.requestedRoleLevel ?? 1;
  score += requestedRoleLevel >= 5 ? 28 : requestedRoleLevel >= 4 ? 18 : requestedRoleLevel >= 3 ? 10 : 4;

  const mins = getMinutesAgo(item.requestedAt);
  if (mins <= 3) score += 18;
  else if (mins <= 10) score += 10;
  else if (mins <= 20) score += 4;

  return score;
}

function getPriorityLevel(item: ApprovalRequest): PriorityLevel {
  const score = getPriorityScore(item);
  if (score >= 70) return "critical";
  if (score >= 40) return "high";
  return "normal";
}

function getPriorityRank(level: PriorityLevel): number {
  if (level === "critical") return 0;
  if (level === "high") return 1;
  return 2;
}

function getPriorityNote(item: ApprovalRequest, level: PriorityLevel): string {
  const reasons: string[] = [];

  if (item.trustedDevice === false) reasons.push("device is not trusted");
  if (item.knownLocation === false) reasons.push("location looks unusual");

  if ((item.failedAttempts ?? 0) > 0) {
    reasons.push(`${item.failedAttempts} failed attempt${item.failedAttempts === 1 ? "" : "s"}`);
  }

  if ((item.requestedRoleLevel ?? 1) >= 4) {
    reasons.push("requested role has elevated access");
  }

  if (getMinutesAgo(item.requestedAt) <= 10) {
    reasons.push("request is very recent");
  }

  if (reasons.length === 0) {
    if (level === "critical") {
      return "This request has a high risk score and should be handled first.";
    }
    if (level === "high") {
      return "This request is high in the queue because of moderate risk signals.";
    }
    return "This request is currently in the normal flow.";
  }

  if (level === "critical") {
    return `High priority because ${reasons.join(", ")}.`;
  }
  if (level === "high") {
    return `Marked high because ${reasons.join(", ")}.`;
  }
  return `Marked normal because its signals are lower: ${reasons.join(", ")}.`;
}

function getDeviceIcon(deviceType?: TrustedDeviceEntry["deviceType"]): keyof typeof Ionicons.glyphMap {
  if (deviceType === "tablet") return "tablet-portrait-outline";
  if (deviceType === "desktop") return "laptop-outline";
  if (deviceType === "browser") return "globe-outline";
  return "phone-portrait-outline";
}

function getActionSubtitle(key: string): string {
  if (key === "revoke_device") return "trusted endpoints • remove unsafe access";
  if (key === "add_device") return "register secure endpoints";
  if (key === "device_scan") return "scan • risk refresh • trust signals";
  if (key === "trust_policy") return "device rules • trust levels";
  if (key === "kill_session") return "live sessions • risky access";
  if (key === "force_relogin") return "session control • re-auth";
  if (key === "view_logs") return "audit feed • security history";
  return "Security action detail";
}

const ACTION_META: Record<
  string,
  {
    title: string;
    desc: string;
    icon: keyof typeof Ionicons.glyphMap;
    items?: string[];
  }
> = {
  approve_user: {
    title: "Approve User",
    desc: "Review pending access requests and approve safe entries.",
    icon: "person-add-outline",
  },
  deny_user: {
    title: "Deny User",
    desc: "Review pending access requests and block unsafe entries.",
    icon: "person-remove-outline",
  },
  review_roles: {
    title: "Review Roles",
    desc: "Inspect requested roles before granting secure access.",
    icon: "id-card-outline",
  },
  priority_queue: {
    title: "Priority Queue",
    desc: "Handle urgent approval requests first.",
    icon: "flash-outline",
    items: [
      "Sort urgent requests",
      "Review critical identity",
      "Approve or deny fast",
      "Save priority action log",
    ],
  },
  revoke_device: {
    title: "Revoke Device",
    desc: "Review device trust and revoke unsafe endpoints.",
    icon: "phone-portrait-outline",
  },
  add_device: {
    title: "Add Device",
    desc: "Register a new trusted phone, tablet, or endpoint.",
    icon: "add-circle-outline",
  },
  device_scan: {
    title: "Device Scan",
    desc: "Scan all trusted devices and refresh their risk state.",
    icon: "scan-outline",
  },
  trust_policy: {
    title: "Trust Policy",
    desc: "Control how trusted devices are approved and kept safe.",
    icon: "options-outline",
  },
  trigger_alert: {
    title: "Trigger Alert",
    desc: "Start a security alert for suspicious activity.",
    icon: "alert-circle-outline",
    items: [
      "Create alert",
      "Notify team",
      "Mark severity",
      "Track incident",
    ],
  },
  kill_session: {
    title: "Kill Session",
    desc: "Close a risky session quickly.",
    icon: "close-circle-outline",
    items: [
      "Find active session",
      "Terminate token",
      "Force re-login",
      "Save event",
    ],
  },
  force_relogin: {
    title: "Force Re-Login",
    desc: "Require a user to sign in again on a risky session.",
    icon: "log-in-outline",
    items: [
      "Select session",
      "Expire access trust",
      "Require sign-in again",
      "Save security event",
    ],
  },
  lockdown_now: {
    title: "Lockdown Now",
    desc: "Close emergency access for sensitive rooms and flows.",
    icon: "lock-closed-outline",
    items: [
      "Enable lockdown",
      "Freeze approvals",
      "Restrict entries",
      "Broadcast notice",
    ],
  },
  view_logs: {
    title: "View Logs",
    desc: "See the history of all security actions.",
    icon: "document-text-outline",
    items: [
      "Command history",
      "Approval history",
      "Device changes",
      "Incident timeline",
    ],
  },
};

export default function SecurityActionDetailScreen() {
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();

  const [requests, setRequests] = useState<ApprovalRequest[]>(DEFAULT_APPROVALS);
  const [roleReviews, setRoleReviews] = useState<RoleReviewRequest[]>(DEFAULT_ROLE_REVIEWS);
  const [securityLogs, setSecurityLogs] = useState<AuditLogEntry[]>(DEFAULT_SECURITY_LOGS);
  const [sessions, setSessions] = useState<ActiveSessionEntry[]>(DEFAULT_ACTIVE_SESSIONS);
  const [devices, setDevices] = useState<TrustedDeviceEntry[]>(DEFAULT_TRUSTED_DEVICES);
  const [trustPolicy, setTrustPolicy] = useState<TrustPolicy>(DEFAULT_TRUST_POLICY);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ risky: number; trusted: number; total: number } | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<"all" | PriorityLevel>("all");
  const [logFilter, setLogFilter] = useState<"all" | "approvals" | "roles" | "commands" | "security">("all");
  const [sessionFilter, setSessionFilter] = useState<"all" | "high" | "current">("all");
  const [deviceFilter, setDeviceFilter] = useState<"all" | "trusted" | "risky" | "current">("all");

  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [scanPhase, setScanPhase] = useState<"scanning" | "done">("scanning");
  const [scanSummary, setScanSummary] = useState({
    total: 0,
    trusted: 0,
    risky: 0,
  });
  const [scanTarget, setScanTarget] = useState<TrustedDeviceEntry | null>(null);
  const [scanMode, setScanMode] = useState<"all" | "single">("all");
  const scanPulse = useRef(new Animated.Value(0)).current;
  const scanWave = useRef(new Animated.Value(0)).current;

  const resolvedScanTarget = useMemo(() => {
    if (!scanTarget) return null;
    return devices.find((item) => item.id === scanTarget.id) ?? scanTarget;
  }, [devices, scanTarget]);


  const key = String(action || "");

  const detail = useMemo(() => {
    return (
      ACTION_META[key] || {
        title: "Security Action",
        desc: "This is a security action detail page.",
        icon: "shield-outline" as keyof typeof Ionicons.glyphMap,
        items: ["Review", "Execute", "Confirm", "Save log"],
      }
    );
  }, [key]);

  const isApproveUser = key === "approve_user";
  const isDenyUser = key === "deny_user";
  const isReviewRoles = key === "review_roles";
  const isPriorityQueue = key === "priority_queue";
  const isViewLogs = key === "view_logs";
  const isKillSession = key === "kill_session";
  const isForceRelogin = key === "force_relogin";
  const isRevokeDevice = key === "revoke_device";
  const isAddDevice = key === "add_device";
  const isDeviceScan = key === "device_scan";
  const isTrustPolicy = key === "trust_policy";
  const isSessionAction = isKillSession || isForceRelogin;
  const isDeviceAction = isRevokeDevice || isAddDevice || isDeviceScan || isTrustPolicy;

  useEffect(() => {
    let alive = true;

    async function loadData() {
      try {
        if (isApproveUser || isDenyUser || isPriorityQueue) {
          const next = await getApprovalRequests();
          if (alive) setRequests(next);
        }

        if (isReviewRoles) {
          const nextRoles = await getRoleReviewRequests();
          if (alive) setRoleReviews(nextRoles);
        }

        if (isViewLogs) {
          const nextLogs = await getSecurityLogs({ limit: 50 });
          if (alive) setSecurityLogs(nextLogs);
        }

        if (isSessionAction) {
          const nextSessions = await getActiveSessions();
          if (alive) setSessions(nextSessions);
        }

        if (isDeviceAction) {
          const [nextDevices, nextPolicy] = await Promise.all([
            getTrustedDevices(),
            getTrustPolicy(),
          ]);
          if (alive) {
            setDevices(nextDevices);
            setTrustPolicy(nextPolicy);
          }
        }
      } catch {
        if (alive) {
          setRequests(DEFAULT_APPROVALS);
          setRoleReviews(DEFAULT_ROLE_REVIEWS);
          setSecurityLogs(DEFAULT_SECURITY_LOGS);
          setSessions(DEFAULT_ACTIVE_SESSIONS);
          setDevices(DEFAULT_TRUSTED_DEVICES);
          setTrustPolicy(DEFAULT_TRUST_POLICY);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadData();

    return () => {
      alive = false;
    };
  }, [isApproveUser, isDenyUser, isReviewRoles, isPriorityQueue, isViewLogs, isSessionAction, isDeviceAction]);

  async function updateStatus(id: string, status: ApprovalStatus) {
    const target = requests.find((item) => item.id === id);
    if (!target) return;

    const next = await updateApprovalStatus(id, status);
    setRequests(next);

    Alert.alert(
      status === "approved" ? "Approved" : "Denied",
      `${target.name} has been ${status}.`
    );
  }

  async function handleRoleReviewStatus(id: string, status: RoleReviewStatus) {
    const target = roleReviews.find((item) => item.id === id);
    if (!target) return;

    const next = await updateRoleReviewStatus(id, status, target.userId);
    setRoleReviews(next);

    Alert.alert(
      status === "approved" ? "Role approved" : "Role denied",
      `${target.name} role request is now ${status}.`
    );
  }

  async function handleKillSession(id: string) {
    const target = sessions.find((item) => item.id === id);
    if (!target) return;

    const next = await killActiveSession(id);
    setSessions(next);

    Alert.alert("Session killed", `${target.name} session was closed.`);
  }

  async function handleForceRelogin(id: string) {
    const target = sessions.find((item) => item.id === id);
    if (!target) return;

    const next = await forceReloginSession(id);
    setSessions(next);

    Alert.alert("Re-login required", `${target.name} must sign in again.`);
  }

  async function handleRevokeDevice(id: string) {
    const target = devices.find((item) => item.id === id);
    if (!target) return;

    const next = await revokeTrustedDevice(id);
    setDevices(next);

    Alert.alert("Device revoked", `${target.label} trust has been removed.`);
  }

  async function handleQuickAddDevice() {
    const next = await addTrustedDevice();
    setDevices(next);
    Alert.alert("Trusted device added", "New device has been added to the trusted list.");
  }

  async function handleDeviceScan(target?: TrustedDeviceEntry) {
    setScanMode(target ? "single" : "all");
    setScanTarget(target ?? null);
    setScanPhase("scanning");
    setScanModalVisible(true);

    const next = await runTrustedDeviceScan(target?.id);
    setDevices(next);

    const scope = target ? next.filter((item) => item.id === target.id) : next;

    setScanSummary({
      total: scope.length,
      trusted: scope.filter((item) => item.trusted).length,
      risky: scope.filter((item) => item.risk === "high" || item.trusted === false).length,
    });

    setScanPhase("done");
  }

  async function handlePolicyMode(mode: "balanced" | "strict" | "open") {
    const next = await updateTrustPolicy({ mode });
    setTrustPolicy(next);
  }

  async function handlePolicyToggle(field: "allowUnknownLocation" | "requireManualApproval") {
    const next = await updateTrustPolicy({
      [field]: !trustPolicy[field],
    });
    setTrustPolicy(next);
  }

  async function handlePolicyExpiry(days: number) {
    const next = await updateTrustPolicy({ autoExpireDays: days });
    setTrustPolicy(next);
  }

  const { pendingCount, approvedCount, deniedCount } = countApprovalStats(requests);

  const {
    pendingCount: rolePendingCount,
    approvedCount: roleApprovedCount,
    deniedCount: roleDeniedCount,
  } = countRoleReviewStats(roleReviews);

  const priorityRequests = requests
    .filter((item) => item.status === "pending")
    .map((item) => {
      const score = getPriorityScore(item);
      const priority = getPriorityLevel(item);
      return {
        ...item,
        score,
        priority,
        note: getPriorityNote(item, priority),
      };
    })
    .sort((a, b) => {
      const rankDiff = getPriorityRank(a.priority) - getPriorityRank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      return b.score - a.score;
    });

  const criticalCount = priorityRequests.filter((item) => item.priority === "critical").length;
  const highCount = priorityRequests.filter((item) => item.priority === "high").length;
  const normalCount = priorityRequests.filter((item) => item.priority === "normal").length;

  const filteredPriorityRequests =
    priorityFilter === "all"
      ? priorityRequests
      : priorityRequests.filter((item) => item.priority === priorityFilter);


  const liveRequests = isApproveUser || isDenyUser;

  function formatLogTime(value: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }

  function logKind(item: AuditLogEntry): "approvals" | "roles" | "commands" | "security" {
    const action = String(item.action || "").toLowerCase();
    const target = String(item.targetType || "").toLowerCase();
    const msg = String(item.message || "").toLowerCase();

    if (action.includes("command") || target.includes("command") || msg.includes("command")) return "commands";
    if (target.includes("approval") || msg.includes("approval")) return "approvals";
    if (target.includes("role") || msg.includes("role review")) return "roles";
    return "security";
  }

  const filteredLogs =
    logFilter === "all"
      ? securityLogs
      : securityLogs.filter((item) => logKind(item) === logFilter);

  const { totalCount: sessionTotalCount, highRiskCount: sessionHighRiskCount, currentCount: sessionCurrentCount } =
    countSessionStats(sessions);

  const filteredSessions =
    sessionFilter === "all"
      ? sessions
      : sessionFilter === "high"
      ? sessions.filter((item) => item.risk === "high")
      : sessions.filter((item) => item.current);

  const {
    totalCount: deviceTotalCount,
    trustedCount: deviceTrustedCount,
    riskyCount: deviceRiskyCount,
    currentCount: deviceCurrentCount,
  } = countTrustedDeviceStats(devices);

  const filteredDevices =
    deviceFilter === "all"
      ? devices
      : deviceFilter === "trusted"
      ? devices.filter((item) => item.trusted)
      : deviceFilter === "risky"
      ? devices.filter((item) => item.risk === "high" || item.trusted === false)
      : devices.filter((item) => item.current);


  useEffect(() => {
    if (!scanModalVisible || scanPhase !== "scanning") return;

    scanPulse.setValue(0);
    scanWave.setValue(0);

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanPulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const waveLoop = Animated.loop(
      Animated.timing(scanWave, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );

    pulseLoop.start();
    waveLoop.start();

    return () => {
      pulseLoop.stop();
      waveLoop.stop();
      scanPulse.stopAnimation();
      scanWave.stopAnimation();
    };
  }, [scanModalVisible, scanPhase, scanPulse, scanWave]);

  async function startDeviceScanFlow() {
    setScanSummary({
      total: devices.length,
      trusted: devices.filter((item) => item.trusted).length,
      risky: devices.filter((item) => item.risk === "high" || item.trusted === false).length,
    });
    setScanPhase("scanning");
    setScanModalVisible(true);

    await new Promise((resolve) => setTimeout(resolve, 1700));

    const next = await runTrustedDeviceScan();
    setDevices(next);

    const total = next.length;
    const trusted = next.filter((item) => item.trusted).length;
    const risky = next.filter((item) => item.risk === "high" || item.trusted === false).length;

    setScanSummary({ total, trusted, risky });
    setScanPhase("done");
  }

  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      <Modal
        visible={!!scanResult}
        transparent
        animationType="fade"
        onRequestClose={() => setScanResult(null)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.scanModalCard}>
            <View
              style={[
                s.scanModalIconWrap,
                scanResult && scanResult.risky > 0 ? s.scanModalIconRisk : s.scanModalIconSafe,
              ]}
            >
              <Ionicons
                name={scanResult && scanResult.risky > 0 ? "alert-circle-outline" : "shield-checkmark-outline"}
                size={26}
                color="white"
              />
            </View>

            <Text style={s.scanModalTitle}>
              {scanResult && scanResult.risky > 0 ? "Scan finished with alerts" : "Scan complete"}
            </Text>

            <Text style={s.scanModalText}>
              {scanResult && scanResult.risky > 0
                ? `${scanResult.risky} risky device${scanResult.risky === 1 ? "" : "s"} found out of ${scanResult.total}.`
                : "Trusted device scan has finished successfully."}
            </Text>

            {scanResult ? (
              <View style={s.scanModalStatsRow}>
                <View style={[s.scanMiniStat, s.scanMiniStatNeutral]}>
                  <Text style={s.scanMiniStatValue}>{scanResult.total}</Text>
                  <Text style={s.scanMiniStatLabel}>Total</Text>
                </View>

                <View style={[s.scanMiniStat, s.scanMiniStatSafe]}>
                  <Text style={s.scanMiniStatValue}>{scanResult.trusted}</Text>
                  <Text style={s.scanMiniStatLabel}>Trusted</Text>
                </View>

                <View style={[s.scanMiniStat, scanResult.risky > 0 ? s.scanMiniStatRisk : s.scanMiniStatNeutral]}>
                  <Text style={s.scanMiniStatValue}>{scanResult.risky}</Text>
                  <Text style={s.scanMiniStatLabel}>Risky</Text>
                </View>
              </View>
            ) : null}

            <Pressable
              onPress={() => setScanResult(null)}
              style={({ pressed }) => [
                s.scanModalBtn,
                pressed ? s.actionBtnPressedApprove : null,
              ]}
            >
              <Text style={s.scanModalBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>{detail.title}</Text>
          <Text style={s.sub}>{getActionSubtitle(key)}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        <Modal
          visible={scanModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (scanPhase === "done") setScanModalVisible(false);
          }}
        >
          <View style={s.scanModalBackdrop}>
            <View style={s.scanModalCard}>
              {scanPhase === "scanning" ? (
                <>
                  <Animated.View
                    style={[
                      s.scanWaveRing,
                      {
                        opacity: scanWave.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.42, 0],
                        }),
                        transform: [
                          {
                            scale: scanWave.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.92, 1.7],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      s.scanWaveRing,
                      s.scanWaveRingSecond,
                      {
                        opacity: scanWave.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.26, 0],
                        }),
                        transform: [
                          {
                            scale: scanWave.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.82, 1.45],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                </>
              ) : null}

              {scanPhase === "scanning" ? (
                <Animated.View
                  style={[
                    s.scanOrb,
                    {
                      transform: [
                        {
                          scale: scanPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.08],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Ionicons
                    name="scan-outline"
                    size={34}
                    color="white"
                  />
                </Animated.View>
              ) : null}

              {scanPhase === "scanning" ? (
                <>
                  <Text style={s.scanModalTitle}>
                    {scanMode === "single" && scanTarget ? `Scanning ${scanTarget.label}...` : "Scanning devices..."}
                  </Text>
                  <Text style={s.scanModalText}>
                    {scanMode === "single" && scanTarget
                      ? `Reading trust signals for ${scanTarget.label}, checking activity, and refreshing its risk state.`
                      : "Reading trust signals, checking activity, and refreshing risk state."}
                  </Text>

                  <View style={s.scanLoaderBar}>
                    <Animated.View
                      style={[
                        s.scanLoaderFill,
                        {
                          transform: [
                            {
                              scaleX: scanPulse.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.35, 1],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View
                    style={[
                      s.scanResultHero,
                      scanSummary.risky > 0 ? s.scanResultHeroRisk : s.scanResultHeroSafe,
                    ]}
                  >
                    <View
                      style={[
                        s.scanResultHeroIconWrap,
                        scanSummary.risky > 0 ? s.scanResultHeroIconWrapRisk : s.scanResultHeroIconWrapSafe,
                      ]}
                    >
                      <Ionicons
                        name={scanSummary.risky > 0 ? "alert-circle-outline" : "shield-checkmark-outline"}
                        size={34}
                        color="white"
                      />
                    </View>

                    <Text style={s.scanResultHeroTitle}>
                      {scanMode === "single"
                        ? scanSummary.risky > 0
                          ? "Device needs attention"
                          : "Device verified"
                        : scanSummary.risky > 0
                        ? "Security alerts found"
                        : "Scan completed successfully"}
                    </Text>

                    <Text style={s.scanResultHeroText}>
                      {scanMode === "single" && resolvedScanTarget
                        ? scanSummary.risky > 0
                          ? `${resolvedScanTarget.label} returned suspicious trust signals and should be reviewed.`
                          : `${resolvedScanTarget.label} passed the latest trust refresh and looks stable.`
                        : scanSummary.risky > 0
                        ? `${scanSummary.risky} risky device found across ${scanSummary.total} scanned devices.`
                        : `All ${scanSummary.total} devices look stable after the latest scan.`}
                    </Text>
                  </View>

                  {scanMode === "single" && resolvedScanTarget ? (
                    <>
                      <View style={s.scanResultPanel}>
                        <View style={s.scanResultPanelTop}>
                          <View style={s.scanResultPanelIdentity}>
                            <Text style={s.scanResultPanelTitle}>{resolvedScanTarget.label}</Text>
                            <Text style={s.scanResultPanelSub}>
                              {resolvedScanTarget.ownerName} • {resolvedScanTarget.ownerRole}
                            </Text>
                          </View>

                          <View
                            style={[
                              s.scanResultPill,
                              resolvedScanTarget.risk === "high"
                                ? s.scanResultPillRisk
                                : resolvedScanTarget.risk === "medium"
                                ? s.scanResultPillWarn
                                : s.scanResultPillSafe,
                            ]}
                          >
                            <Text style={s.scanResultPillText}>
                              {resolvedScanTarget.risk === "high"
                                ? "HIGH RISK"
                                : resolvedScanTarget.risk === "medium"
                                ? "MEDIUM RISK"
                                : "LOW RISK"}
                            </Text>
                          </View>
                        </View>

                        <View style={s.scanResultMetricsGrid}>
                          <View style={s.scanResultMetricCard}>
                            <Text style={s.scanResultMetricLabel}>Device</Text>
                            <Text style={s.scanResultMetricValue}>
                              {resolvedScanTarget.device}
                              {resolvedScanTarget.os ? ` • ${resolvedScanTarget.os}` : ""}
                            </Text>
                          </View>

                          <View style={s.scanResultMetricCard}>
                            <Text style={s.scanResultMetricLabel}>Trust</Text>
                            <Text
                              style={[
                                s.scanResultMetricValue,
                                resolvedScanTarget.trusted ? s.scanResultMetricValueSafe : s.scanResultMetricValueRisk,
                              ]}
                            >
                              {resolvedScanTarget.trusted ? "Trusted" : "Untrusted"}
                            </Text>
                          </View>

                          <View style={s.scanResultMetricCard}>
                            <Text style={s.scanResultMetricLabel}>Location</Text>
                            <Text style={s.scanResultMetricValue}>{resolvedScanTarget.location}</Text>
                          </View>

                          <View style={s.scanResultMetricCard}>
                            <Text style={s.scanResultMetricLabel}>Last seen</Text>
                            <Text style={s.scanResultMetricValue}>{resolvedScanTarget.lastSeenAt}</Text>
                          </View>
                        </View>

                        {!!resolvedScanTarget.ip && (
                          <View style={s.scanResultInfoRow}>
                            <Ionicons name="globe-outline" size={15} color={SOFT} />
                            <Text style={s.scanResultInfoText}>{resolvedScanTarget.ip}</Text>
                          </View>
                        )}

                        <View style={s.scanResultFlagsWrap}>
                          {resolvedScanTarget.current ? (
                            <View style={[s.scanResultFlag, s.scanResultFlagBlue]}>
                              <Ionicons name="phone-portrait-outline" size={12} color="white" />
                              <Text style={s.scanResultFlagText}>Current device</Text>
                            </View>
                          ) : null}

                          <View
                            style={[
                              s.scanResultFlag,
                              resolvedScanTarget.trusted ? s.scanResultFlagGold : s.scanResultFlagRed,
                            ]}
                          >
                            <Ionicons
                              name={resolvedScanTarget.trusted ? "shield-checkmark-outline" : "warning-outline"}
                              size={12}
                              color={resolvedScanTarget.trusted ? "#08111F" : "white"}
                            />
                            <Text
                              style={resolvedScanTarget.trusted ? s.scanResultFlagTextDark : s.scanResultFlagText}
                            >
                              {resolvedScanTarget.trusted ? "Trusted" : "Untrusted"}
                            </Text>
                          </View>

                          {resolvedScanTarget.location === "Unknown location" ||
                          String(resolvedScanTarget.location).toLowerCase().includes("unverified") ||
                          String(resolvedScanTarget.location).toLowerCase().includes("new browser") ||
                          String(resolvedScanTarget.location).toLowerCase().includes("travel") ? (
                            <View style={[s.scanResultFlag, s.scanResultFlagRed]}>
                              <Ionicons name="navigate-outline" size={12} color="white" />
                              <Text style={s.scanResultFlagText}>Location anomaly</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <View style={s.scanDecisionCard}>
                        <Text style={s.scanDecisionTitle}>Assessment</Text>
                        <Text style={s.scanDecisionLine}>
                          Status: {resolvedScanTarget.trusted ? "Trusted endpoint" : "Trust warning detected"}
                        </Text>
                        <Text style={s.scanDecisionLine}>
                          Risk: {resolvedScanTarget.risk.toUpperCase()}
                        </Text>
                        <Text style={s.scanDecisionLine}>
                          Activity: Seen {resolvedScanTarget.lastSeenAt}
                        </Text>
                        <Text style={s.scanDecisionLine}>
                          Action: {resolvedScanTarget.risk === "high"
                            ? "Review now and revoke access if this device is unfamiliar."
                            : resolvedScanTarget.risk === "medium"
                            ? "Keep monitoring and rescan after refresh."
                            : "No urgent action needed right now."}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={s.scanSummaryGrid}>
                        <View style={[s.scanSummaryCard, s.scanSummaryCardNeutral]}>
                          <Text style={s.scanSummaryValue}>{scanSummary.total}</Text>
                          <Text style={s.scanSummaryLabel}>Scanned</Text>
                        </View>

                        <View style={[s.scanSummaryCard, s.scanSummaryCardSafe]}>
                          <Text style={s.scanSummaryValue}>{scanSummary.trusted}</Text>
                          <Text style={s.scanSummaryLabel}>Trusted</Text>
                        </View>

                        <View style={[s.scanSummaryCard, s.scanSummaryCardRisk]}>
                          <Text style={s.scanSummaryValue}>{scanSummary.risky}</Text>
                          <Text style={s.scanSummaryLabel}>Risky</Text>
                        </View>
                      </View>

                      <View style={s.scanDecisionCard}>
                        <Text style={s.scanDecisionTitle}>Scan summary</Text>
                        <Text style={s.scanDecisionLine}>
                          • Devices checked: {scanSummary.total}
                        </Text>
                        <Text style={s.scanDecisionLine}>
                          • Trusted devices: {scanSummary.trusted}
                        </Text>
                        <Text style={s.scanDecisionLine}>
                          • Risky devices: {scanSummary.risky}
                        </Text>
                        <Text style={s.scanDecisionLine}>
                          • Recommendation: {scanSummary.risky > 0
                            ? "Open risky devices and review each one individually."
                            : "All devices look stable for now."}
                        </Text>
                      </View>
                    </>
                  )}

                  <View style={s.scanActionStack}>
                    {scanMode === "single" && resolvedScanTarget ? (
                      <Pressable
                        onPress={() => handleDeviceScan(resolvedScanTarget)}
                        style={({ pressed }) => [
                          s.scanActionSecondary,
                          pressed ? { opacity: 0.95, transform: [{ scale: 0.99 }] } : null,
                        ]}
                      >
                        <Ionicons name="scan-outline" size={18} color="white" />
                        <Text style={s.scanActionSecondaryText}>Scan Again</Text>
                      </Pressable>
                    ) : null}

                    <Pressable
                      onPress={() => setScanModalVisible(false)}
                      style={({ pressed }) => [
                        s.scanActionPrimary,
                        pressed ? { opacity: 0.95, transform: [{ scale: 0.99 }] } : null,
                      ]}
                    >
                      <Text style={s.scanActionPrimaryText}>Close Result</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {liveRequests ? (
          <>
            <View style={s.statsRow}>
              <View style={[s.statCard, s.statPending]}>
                <Text style={s.statValue}>{pendingCount}</Text>
                <Text style={s.statLabel}>Pending</Text>
              </View>

              <View style={[s.statCard, s.statApproved]}>
                <Text style={s.statValue}>{approvedCount}</Text>
                <Text style={s.statLabel}>Approved</Text>
              </View>

              <View style={[s.statCard, s.statDenied]}>
                <Text style={s.statValue}>{deniedCount}</Text>
                <Text style={s.statLabel}>Denied</Text>
              </View>
            </View>

            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>
                {isApproveUser ? "Pending Requests" : "Requests To Deny"}
              </Text>

              {loading ? (
                <Text style={s.emptyText}>Loading requests...</Text>
              ) : requests.length === 0 ? (
                <Text style={s.emptyText}>No access requests found.</Text>
              ) : (
                requests
                  .filter((item) => {
                    if (isApproveUser) return item.status === "pending";
                    if (isDenyUser) return item.status === "pending" || item.status === "denied";
                    return true;
                  })
                  .map((item) => {
                    const approved = item.status === "approved";
                    const denied = item.status === "denied";
                    const pending = item.status === "pending";

                    return (
                      <View key={item.id} style={s.requestCard}>
                        <View style={s.requestTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.requestName}>{item.name}</Text>
                            <Text style={s.requestMeta}>{item.role}</Text>
                          </View>

                          <View
                            style={[
                              s.statusBadge,
                              pending ? s.statusPending : null,
                              approved ? s.statusApproved : null,
                              denied ? s.statusDenied : null,
                            ]}
                          >
                            <Text
                              style={[
                                s.statusText,
                                approved ? s.statusTextDark : null,
                              ]}
                            >
                              {item.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>

                        <View style={s.infoRow}>
                          <Ionicons name="phone-portrait-outline" size={15} color={SOFT} />
                          <Text style={s.infoText}>{item.device}</Text>
                        </View>

                        <View style={s.infoRow}>
                          <Ionicons name="location-outline" size={15} color={SOFT} />
                          <Text style={s.infoText}>{item.location}</Text>
                        </View>

                        <View style={s.infoRow}>
                          <Ionicons name="time-outline" size={15} color={SOFT} />
                          <Text style={s.infoText}>{item.requestedAt}</Text>
                        </View>

                        <View style={s.requestActions}>
                          {isApproveUser ? (
                            <>
                              <Pressable
                                onPress={() => updateStatus(item.id, "approved")}
                                disabled={!pending}
                                style={({ pressed }) => [
                                  s.actionBtn,
                                  s.approveBtn,
                                  !pending ? s.actionBtnDisabled : null,
                                  pressed ? { opacity: 0.92 } : null,
                                ]}
                              >
                                <Ionicons name="checkmark-circle-outline" size={18} color="#08111F" />
                                <Text style={s.approveBtnText}>Approve</Text>
                              </Pressable>

                              <Pressable
                                onPress={() => updateStatus(item.id, "denied")}
                                disabled={!pending}
                                style={({ pressed }) => [
                                  s.actionBtn,
                                  s.denyBtn,
                                  !pending ? s.actionBtnDisabled : null,
                                  pressed ? { opacity: 0.92 } : null,
                                ]}
                              >
                                <Ionicons name="close-circle-outline" size={18} color="white" />
                                <Text style={s.denyBtnText}>Deny</Text>
                              </Pressable>
                            </>
                          ) : (
                            <>
                              <Pressable
                                onPress={() => updateStatus(item.id, "denied")}
                                disabled={!pending}
                                style={({ pressed }) => [
                                  s.actionBtn,
                                  s.denyBtn,
                                  !pending ? s.actionBtnDisabled : null,
                                  pressed ? { opacity: 0.92 } : null,
                                ]}
                              >
                                <Ionicons name="close-circle-outline" size={18} color="white" />
                                <Text style={s.denyBtnText}>Deny Now</Text>
                              </Pressable>

                              <Pressable
                                onPress={() => updateStatus(item.id, "approved")}
                                disabled={!denied}
                                style={({ pressed }) => [
                                  s.actionBtn,
                                  s.restoreBtn,
                                  !denied ? s.actionBtnDisabled : null,
                                  pressed ? { opacity: 0.92 } : null,
                                ]}
                              >
                                <Ionicons name="refresh-circle-outline" size={18} color="#08111F" />
                                <Text style={s.restoreBtnText}>Restore</Text>
                              </Pressable>
                            </>
                          )}
                        </View>
                      </View>
                    );
                  })
              )}
            </View>
          </>
        ) : isReviewRoles ? (
          <>
            <View style={s.statsRow}>
              <View style={[s.statCard, s.statPending]}>
                <Text style={s.statValue}>{rolePendingCount}</Text>
                <Text style={s.statLabel}>Pending</Text>
              </View>

              <View style={[s.statCard, s.statApproved]}>
                <Text style={s.statValue}>{roleApprovedCount}</Text>
                <Text style={s.statLabel}>Approved</Text>
              </View>

              <View style={[s.statCard, s.statDenied]}>
                <Text style={s.statValue}>{roleDeniedCount}</Text>
                <Text style={s.statLabel}>Denied</Text>
              </View>
            </View>

            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Role Review Queue</Text>

              {loading ? (
                <Text style={s.emptyText}>Loading role requests...</Text>
              ) : roleReviews.length === 0 ? (
                <Text style={s.emptyText}>No role review requests found.</Text>
              ) : (
                roleReviews.map((item) => {
                  const pending = item.status === "pending";
                  const approved = item.status === "approved";
                  const denied = item.status === "denied";

                  return (
                    <View key={item.id} style={s.requestCard}>
                      <View style={s.requestTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.requestName}>{item.name}</Text>
                          <Text style={s.requestMeta}>Role change request</Text>
                        </View>

                        <View
                          style={[
                            s.statusBadge,
                            pending ? s.statusPending : null,
                            approved ? s.statusApproved : null,
                            denied ? s.statusDenied : null,
                          ]}
                        >
                          <Text
                            style={[
                              s.statusText,
                              approved ? s.statusTextDark : null,
                            ]}
                          >
                            {item.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <View style={s.roleCompareWrap}>
                        <View style={s.roleMiniCard}>
                          <Text style={s.roleMiniLabel}>Current Role</Text>
                          <Text style={s.roleMiniValue}>{item.currentRole}</Text>
                        </View>

                        <View style={s.roleArrowWrap}>
                          <Ionicons name="arrow-forward" size={18} color={GOLD} />
                        </View>

                        <View style={[s.roleMiniCard, s.roleMiniCardBlue]}>
                          <Text style={s.roleMiniLabel}>Requested</Text>
                          <Text style={s.roleMiniValue}>{item.requestedRole}</Text>
                        </View>
                      </View>

                      <View style={s.reasonCard}>
                        <Text style={s.reasonLabel}>Reason</Text>
                        <Text style={s.reasonText}>{item.reason}</Text>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.requestedAt}</Text>
                      </View>

                      <View style={s.requestActions}>
                        <Pressable
                          onPress={() => handleRoleReviewStatus(item.id, "approved")}
                          disabled={!pending}
                          style={({ pressed }) => [
                            s.actionBtn,
                            s.approveBtn,
                            !pending ? s.actionBtnDisabled : null,
                            pressed ? { opacity: 0.92 } : null,
                          ]}
                        >
                          <Ionicons name="checkmark-circle-outline" size={18} color="#08111F" />
                          <Text style={s.approveBtnText}>Approve Role</Text>
                        </Pressable>

                        <Pressable
                          onPress={() => handleRoleReviewStatus(item.id, "denied")}
                          disabled={!pending}
                          style={({ pressed }) => [
                            s.actionBtn,
                            s.denyBtn,
                            !pending ? s.actionBtnDisabled : null,
                            pressed ? { opacity: 0.92 } : null,
                          ]}
                        >
                          <Ionicons name="close-circle-outline" size={18} color="white" />
                          <Text style={s.denyBtnText}>Deny Role</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : isPriorityQueue ? (
          <>
            <View style={s.statsRow}>
              <View style={[s.statCard, s.statApproved]}>
                <Text style={s.statValue}>{criticalCount}</Text>
                <Text style={s.statLabel}>Critical</Text>
              </View>

              <View style={[s.statCard, s.statDenied]}>
                <Text style={s.statValue}>{highCount}</Text>
                <Text style={s.statLabel}>High</Text>
              </View>

              <View style={[s.statCard, s.statPending]}>
                <Text style={s.statValue}>{normalCount}</Text>
                <Text style={s.statLabel}>Normal</Text>
              </View>
            </View>

            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>Priority Queue</Text>
              <Text style={s.sectionSub}>Sorted by priority first, then risk score.</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.filterRow}
                style={{ marginBottom: 12, marginHorizontal: -4 }}
              >
                <Pressable
                  onPress={() => setPriorityFilter("all")}
                  style={[s.filterPill, priorityFilter === "all" ? s.filterPillActive : null]}
                >
                  <Text style={[s.filterPillText, priorityFilter === "all" ? s.filterPillTextActive : null]}>
                    All
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setPriorityFilter("critical")}
                  style={[s.filterPill, priorityFilter === "critical" ? s.filterPillCritical : null]}
                >
                  <Text style={[s.filterPillText, priorityFilter === "critical" ? s.filterPillTextDark : null]}>
                    Critical
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setPriorityFilter("high")}
                  style={[s.filterPill, priorityFilter === "high" ? s.filterPillHigh : null]}
                >
                  <Text style={s.filterPillText}>High</Text>
                </Pressable>

                <Pressable
                  onPress={() => setPriorityFilter("normal")}
                  style={[s.filterPill, priorityFilter === "normal" ? s.filterPillNormal : null]}
                >
                  <Text style={s.filterPillText}>Normal</Text>
                </Pressable>
              </ScrollView>

              {loading ? (
                <Text style={s.emptyText}>Loading priority queue...</Text>
              ) : filteredPriorityRequests.length === 0 ? (
                <Text style={s.emptyText}>No pending approvals for this filter.</Text>
              ) : (
                filteredPriorityRequests.map((item) => {
                  const isCritical = item.priority === "critical";
                  const isHigh = item.priority === "high";
                  const isNormal = item.priority === "normal";

                  return (
                    <View key={item.id} style={[s.requestCard, isCritical ? s.requestCardCritical : null]}>
                      <View style={s.requestTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.requestName}>{item.name}</Text>
                          <Text style={s.requestMeta}>{item.role}</Text>
                        </View>

                        <View
                          style={[
                            s.priorityBadge,
                            isCritical ? s.priorityCritical : null,
                            isHigh ? s.priorityHigh : null,
                            isNormal ? s.priorityNormal : null,
                          ]}
                        >
                          <Ionicons
                            name={isCritical ? "flash" : isHigh ? "alert-circle-outline" : "layers-outline"}
                            size={14}
                            color={isCritical ? "#08111F" : "white"}
                          />
                          <Text
                            style={[
                              s.priorityBadgeText,
                              isCritical ? s.priorityBadgeTextDark : null,
                            ]}
                          >
                            {item.priority.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="phone-portrait-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.device}</Text>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="location-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.location}</Text>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.requestedAt}</Text>
                      </View>

                      <View style={s.signalChipsRow}>
                        {item.trustedDevice === false ? (
                          <View style={[s.signalChip, s.signalChipRed]}>
                            <Ionicons name="phone-portrait-outline" size={12} color="white" />
                            <Text style={s.signalChipText}>Untrusted device</Text>
                          </View>
                        ) : null}

                        {item.knownLocation === false ? (
                          <View style={[s.signalChip, s.signalChipBlue]}>
                            <Ionicons name="location-outline" size={12} color="white" />
                            <Text style={s.signalChipText}>Unknown location</Text>
                          </View>
                        ) : null}

                        {(item.failedAttempts ?? 0) > 0 ? (
                          <View style={[s.signalChip, s.signalChipRed]}>
                            <Ionicons name="alert-circle-outline" size={12} color="white" />
                            <Text style={s.signalChipText}>{item.failedAttempts} failed</Text>
                          </View>
                        ) : null}

                        {(item.requestedRoleLevel ?? 1) >= 4 ? (
                          <View style={[s.signalChip, s.signalChipGold]}>
                            <Ionicons name="key-outline" size={12} color="#08111F" />
                            <Text style={s.signalChipTextDark}>High access</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={s.priorityNoteCard}>
                        <Text style={s.priorityNoteLabel}>Queue Reason</Text>
                        <Text style={s.priorityNoteText}>{item.note}</Text>

                        <View style={s.priorityScoreBox}>
                          <View style={s.priorityScoreRow}>
                            <Text style={s.priorityScoreLabel}>Risk Score</Text>
                            <Text style={s.priorityScoreValue}>{item.score}</Text>
                          </View>
                        </View>
                      </View>

                      <View style={s.requestActions}>
                        <Pressable
                          hitSlop={8}
                          onPress={() => updateStatus(item.id, "approved")}
                          style={({ pressed }) => [
                            s.actionBtn,
                            s.approveBtn,
                            pressed ? s.actionBtnPressedApprove : null,
                          ]}
                        >
                          <Ionicons name="checkmark-circle-outline" size={18} color="#08111F" />
                          <Text style={s.approveBtnText}>Approve Fast</Text>
                        </Pressable>

                        <Pressable
                          hitSlop={8}
                          onPress={() => updateStatus(item.id, "denied")}
                          style={({ pressed }) => [
                            s.actionBtn,
                            s.denyBtn,
                            pressed ? s.actionBtnPressedDeny : null,
                          ]}
                        >
                          <Ionicons name="close-circle-outline" size={18} color="white" />
                          <Text style={s.denyBtnText}>Deny</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : isSessionAction ? (
          <>
            <View style={s.statsRow}>
              <View style={[s.statCard, s.statPending]}>
                <Text style={s.statValue}>{sessionTotalCount}</Text>
                <Text style={s.statLabel}>Sessions</Text>
              </View>

              <View style={[s.statCard, s.statDenied]}>
                <Text style={s.statValue}>{sessionHighRiskCount}</Text>
                <Text style={s.statLabel}>High Risk</Text>
              </View>

              <View style={[s.statCard, s.statApproved]}>
                <Text style={s.statValue}>{sessionCurrentCount}</Text>
                <Text style={s.statLabel}>Current</Text>
              </View>
            </View>

            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>{isKillSession ? "Kill Session Queue" : "Force Re-Login Queue"}</Text>
              <Text style={s.sectionSub}>Track live sessions, spot risky access, and act fast.</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.filterRow}
                style={{ marginBottom: 14 }}
              >
                <Pressable
                  onPress={() => setSessionFilter("all")}
                  style={[s.filterPill, sessionFilter === "all" ? s.filterPillActive : null]}
                >
                  <Text style={[s.filterPillText, sessionFilter === "all" ? s.filterPillTextActive : null]}>
                    All
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setSessionFilter("high")}
                  style={[s.filterPill, sessionFilter === "high" ? s.filterPillHigh : null]}
                >
                  <Text style={s.filterPillText}>High Risk</Text>
                </Pressable>

                <Pressable
                  onPress={() => setSessionFilter("current")}
                  style={[s.filterPill, sessionFilter === "current" ? s.filterPillNormal : null]}
                >
                  <Text style={s.filterPillText}>Current Device</Text>
                </Pressable>
              </ScrollView>

              {loading ? (
                <Text style={s.emptyText}>Loading sessions...</Text>
              ) : filteredSessions.length === 0 ? (
                <Text style={s.emptyText}>No active sessions for this filter.</Text>
              ) : (
                filteredSessions.map((item) => {
                  const isHigh = item.risk === "high";
                  const isMedium = item.risk === "medium";
                  const isCurrent = item.current === true;

                  return (
                    <View
                      key={item.id}
                      style={[
                        s.requestCard,
                        isHigh ? s.sessionCardHigh : null,
                        isCurrent ? s.sessionCardCurrent : null,
                      ]}
                    >
                      <View style={s.requestTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.requestName}>{item.name}</Text>
                          <Text style={s.requestMeta}>{item.role}</Text>
                        </View>

                        <View
                          style={[
                            s.priorityBadge,
                            isHigh ? s.priorityHigh : isMedium ? s.filterPillNormal : s.statusApproved,
                          ]}
                        >
                          <Ionicons
                            name={isHigh ? "alert-circle-outline" : isMedium ? "shield-outline" : "checkmark-circle-outline"}
                            size={14}
                            color="white"
                          />
                          <Text style={s.priorityBadgeText}>
                            {item.risk.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="phone-portrait-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.device}</Text>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="location-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.location}</Text>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>Started {item.startedAt} • Seen {item.lastSeenAt}</Text>
                      </View>

                      {!!item.ip ? (
                        <View style={s.infoRow}>
                          <Ionicons name="globe-outline" size={15} color={SOFT} />
                          <Text style={s.infoText}>{item.ip}</Text>
                        </View>
                      ) : null}

                      <View style={s.signalChipsRow}>
                        {item.current ? (
                          <View style={[s.signalChip, s.signalChipBlue]}>
                            <Ionicons name="phone-portrait-outline" size={12} color="white" />
                            <Text style={s.signalChipText}>Current device</Text>
                          </View>
                        ) : null}

                        {item.trustedDevice === false ? (
                          <View style={[s.signalChip, s.signalChipRed]}>
                            <Ionicons name="shield-outline" size={12} color="white" />
                            <Text style={s.signalChipText}>Untrusted</Text>
                          </View>
                        ) : (
                          <View style={[s.signalChip, s.signalChipGold]}>
                            <Ionicons name="shield-checkmark-outline" size={12} color="#08111F" />
                            <Text style={s.signalChipTextDark}>Trusted</Text>
                          </View>
                        )}
                      </View>

                      <View style={s.requestActions}>
                        {isKillSession ? (
                          <>
                            <Pressable
                              onPress={() => handleKillSession(item.id)}
                              disabled={item.current}
                              style={({ pressed }) => [
                                s.actionBtn,
                                s.denyBtn,
                                item.current ? s.actionBtnDisabled : null,
                                pressed ? s.actionBtnPressedDeny : null,
                              ]}
                            >
                              <Ionicons name="close-circle-outline" size={18} color="white" />
                              <Text style={s.denyBtnText}>{item.current ? "Current Session" : "Kill Session"}</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => handleForceRelogin(item.id)}
                              style={({ pressed }) => [
                                s.actionBtn,
                                s.restoreBtn,
                                pressed ? s.actionBtnPressedApprove : null,
                              ]}
                            >
                              <Ionicons name="log-in-outline" size={18} color="#08111F" />
                              <Text style={s.restoreBtnText}>Force Re-Login</Text>
                            </Pressable>
                          </>
                        ) : (
                          <>
                            <Pressable
                              onPress={() => handleForceRelogin(item.id)}
                              style={({ pressed }) => [
                                s.actionBtn,
                                s.approveBtn,
                                pressed ? s.actionBtnPressedApprove : null,
                              ]}
                            >
                              <Ionicons name="log-in-outline" size={18} color="#08111F" />
                              <Text style={s.approveBtnText}>Require Login</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => handleKillSession(item.id)}
                              disabled={item.current}
                              style={({ pressed }) => [
                                s.actionBtn,
                                s.denyBtn,
                                item.current ? s.actionBtnDisabled : null,
                                pressed ? s.actionBtnPressedDeny : null,
                              ]}
                            >
                              <Ionicons name="close-circle-outline" size={18} color="white" />
                              <Text style={s.denyBtnText}>{item.current ? "Current Session" : "Kill"}</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : isDeviceAction ? (
          <>
            <View style={s.statsRow}>
              <View style={[s.statCard, s.statPending]}>
                <Text style={s.statValue}>{deviceTotalCount}</Text>
                <Text style={s.statLabel}>Devices</Text>
              </View>

              <View style={[s.statCard, s.statApproved]}>
                <Text style={s.statValue}>{deviceTrustedCount}</Text>
                <Text style={s.statLabel}>Trusted</Text>
              </View>

              <View style={[s.statCard, s.statDenied]}>
                <Text style={s.statValue}>{deviceRiskyCount}</Text>
                <Text style={s.statLabel}>Risky</Text>
              </View>
            </View>

            <View style={s.sectionCard}>
              <Text style={s.sectionTitle}>
                {isRevokeDevice
                  ? "Trusted Device Queue"
                  : isAddDevice
                  ? "Add Trusted Device"
                  : isDeviceScan
                  ? "Device Scan Center"
                  : "Trust Policy"}
              </Text>
              <Text style={s.sectionSub}>
                {isRevokeDevice
                  ? "Review trusted endpoints and remove unsafe ones."
                  : isAddDevice
                  ? "Register a new endpoint and keep the trusted list clean."
                  : isDeviceScan
                  ? "Scan trusted devices, refresh risk state, and review suspicious endpoints."
                  : "Control how device trust behaves across kingdom security."}
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.filterRow}
                style={{ marginBottom: 14 }}
              >
                <Pressable
                  onPress={() => setDeviceFilter("all")}
                  style={[s.filterPill, deviceFilter === "all" ? s.filterPillActive : null]}
                >
                  <Text style={[s.filterPillText, deviceFilter === "all" ? s.filterPillTextActive : null]}>
                    All
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setDeviceFilter("trusted")}
                  style={[s.filterPill, deviceFilter === "trusted" ? s.filterPillNormal : null]}
                >
                  <Text style={s.filterPillText}>Trusted</Text>
                </Pressable>

                <Pressable
                  onPress={() => setDeviceFilter("risky")}
                  style={[s.filterPill, deviceFilter === "risky" ? s.filterPillHigh : null]}
                >
                  <Text style={s.filterPillText}>Risky</Text>
                </Pressable>

                <Pressable
                  onPress={() => setDeviceFilter("current")}
                  style={[s.filterPill, deviceFilter === "current" ? s.filterPillNormal : null]}
                >
                  <Text style={s.filterPillText}>Current</Text>
                </Pressable>
              </ScrollView>

              {isAddDevice ? (
                <View style={s.policyCard}>
                  <Text style={s.policyTitle}>Quick Add</Text>
                  <Text style={s.policyText}>
                    Add a safe endpoint quickly using the current trusted device template.
                  </Text>

                  <Pressable
                    onPress={handleQuickAddDevice}
                    style={({ pressed }) => [
                      s.fullActionBtn,
                      s.approveBtn,
                      pressed ? s.actionBtnPressedApprove : null,
                    ]}
                  >
                    <Ionicons name="add-circle-outline" size={18} color="#08111F" />
                    <Text style={s.approveBtnText}>Add Trusted Device</Text>
                  </Pressable>
                </View>
              ) : null}

              {isDeviceScan ? (
                <View style={s.policyCard}>
                  <Text style={s.policyTitle}>Run Scan</Text>
                  <Text style={s.policyText}>
                    Refresh device trust signals, update risk levels, and flag unsafe endpoints.
                  </Text>

                  <Pressable
                    onPress={startDeviceScanFlow}
                    disabled={isScanning}
                    style={({ pressed }) => [
                      s.fullActionBtn,
                      s.restoreBtn,
                      isScanning ? s.actionBtnDisabled : null,
                      pressed && !isScanning ? s.actionBtnPressedApprove : null,
                    ]}
                  >
                    <Ionicons name={isScanning ? "sync-outline" : "scan-outline"} size={18} color="#08111F" />
                    <Text style={s.restoreBtnText}>{isScanning ? "Scanning..." : "Run Device Scan"}</Text>
                  </Pressable>
                </View>
              ) : null}

              {isTrustPolicy ? (
                <View style={s.policyCard}>
                  <Text style={s.policyTitle}>Mode</Text>

                  <View style={s.signalChipsRow}>
                    <Pressable
                      onPress={() => handlePolicyMode("strict")}
                      style={[s.signalChip, trustPolicy.mode === "strict" ? s.signalChipRed : s.signalChipBlue]}
                    >
                      <Text style={s.signalChipText}>Strict</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => handlePolicyMode("balanced")}
                      style={[s.signalChip, trustPolicy.mode === "balanced" ? s.signalChipGold : s.signalChipBlue]}
                    >
                      <Text style={trustPolicy.mode === "balanced" ? s.signalChipTextDark : s.signalChipText}>
                        Balanced
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => handlePolicyMode("open")}
                      style={[s.signalChip, trustPolicy.mode === "open" ? s.signalChipBlue : s.statusPending]}
                    >
                      <Text style={s.signalChipText}>Open</Text>
                    </Pressable>
                  </View>

                  <View style={s.policyRow}>
                    <Text style={s.policyLabel}>Allow unknown location</Text>
                    <Pressable
                      onPress={() => handlePolicyToggle("allowUnknownLocation")}
                      style={[
                        s.smallPillBtn,
                        trustPolicy.allowUnknownLocation ? s.filterPillNormal : s.statusPending,
                      ]}
                    >
                      <Text style={s.smallPillBtnText}>
                        {trustPolicy.allowUnknownLocation ? "Enabled" : "Disabled"}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={s.policyRow}>
                    <Text style={s.policyLabel}>Manual approval</Text>
                    <Pressable
                      onPress={() => handlePolicyToggle("requireManualApproval")}
                      style={[
                        s.smallPillBtn,
                        trustPolicy.requireManualApproval ? s.filterPillCritical : s.statusPending,
                      ]}
                    >
                      <Text
                        style={[
                          s.smallPillBtnText,
                          trustPolicy.requireManualApproval ? s.filterPillTextDark : null,
                        ]}
                      >
                        {trustPolicy.requireManualApproval ? "Required" : "Optional"}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={s.policyRow}>
                    <Text style={s.policyLabel}>Auto expire</Text>
                    <View style={s.inlineBtnRow}>
                      {[7, 30, 90].map((days) => (
                        <Pressable
                          key={days}
                          onPress={() => handlePolicyExpiry(days)}
                          style={[
                            s.smallPillBtn,
                            trustPolicy.autoExpireDays === days ? s.filterPillActive : s.statusPending,
                          ]}
                        >
                          <Text style={s.smallPillBtnText}>{days}d</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              ) : null}

              {loading ? (
                <Text style={s.emptyText}>Loading trusted devices...</Text>
              ) : filteredDevices.length === 0 ? (
                <Text style={s.emptyText}>No trusted devices for this filter.</Text>
              ) : (
                filteredDevices.map((item) => {
                  const isHigh = item.risk === "high";
                  const isCurrent = item.current === true;

                  return (
                    <View
                      key={item.id}
                      style={[
                        s.requestCard,
                        item.trusted ? s.deviceCardTrusted : s.deviceCardUntrusted,
                        isHigh ? s.sessionCardHigh : null,
                        isCurrent ? s.sessionCardCurrent : null,
                      ]}
                    >
                      <View style={s.requestTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.requestName}>{item.label}</Text>
                          <Text style={s.requestMeta}>{item.ownerName} • {item.ownerRole}</Text>
                        </View>

                        <View
                          style={[
                            s.priorityBadge,
                            isHigh ? s.priorityHigh : item.trusted ? s.statusApproved : s.statusDenied,
                          ]}
                        >
                          <Ionicons
                            name={item.trusted ? "shield-checkmark-outline" : "alert-circle-outline"}
                            size={14}
                            color={item.trusted && !isHigh ? "#08111F" : "white"}
                          />
                          <Text
                            style={[
                              s.priorityBadgeText,
                              item.trusted && !isHigh ? s.priorityBadgeTextDark : null,
                            ]}
                          >
                            {item.trusted ? "TRUSTED" : "RISK"}
                          </Text>
                        </View>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name={getDeviceIcon(item.deviceType)} size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.device}{item.os ? ` • ${item.os}` : ""}</Text>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="location-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>{item.location}</Text>
                      </View>

                      <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={15} color={SOFT} />
                        <Text style={s.infoText}>Added {item.addedAt} • Seen {item.lastSeenAt}</Text>
                      </View>

                      {!!item.ip ? (
                        <View style={s.infoRow}>
                          <Ionicons name="globe-outline" size={15} color={SOFT} />
                          <Text style={s.infoText}>{item.ip}</Text>
                        </View>
                      ) : null}

                      <View style={s.signalChipsRow}>
                        {item.current ? (
                          <View style={[s.signalChip, s.signalChipBlue]}>
                            <Ionicons name="phone-portrait-outline" size={12} color="white" />
                            <Text style={s.signalChipText}>Current device</Text>
                          </View>
                        ) : null}

                        <View style={[s.signalChip, item.trusted ? s.signalChipGold : s.signalChipRed]}>
                          <Ionicons
                            name={item.trusted ? "shield-checkmark-outline" : "shield-outline"}
                            size={12}
                            color={item.trusted ? "#08111F" : "white"}
                          />
                          <Text style={item.trusted ? s.signalChipTextDark : s.signalChipText}>
                            {item.trusted ? "Trusted" : "Untrusted"}
                          </Text>
                        </View>

                        {item.risk === "high" ? (
                          <View style={[s.signalChip, s.signalChipRed]}>
                            <Ionicons name="alert-circle-outline" size={12} color="white" />
                            <Text style={s.signalChipText}>High risk</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={s.requestActions}>
                        {isRevokeDevice ? (
                          <Pressable
                            onPress={() => {
                              if (!item.current && item.trusted) handleRevokeDevice(item.id);
                            }}
                            disabled={!item.current && !item.trusted}
                            style={({ pressed }) => [
                              s.actionBtn,
                              item.current ? s.protectedBtn : s.denyBtn,
                              !item.current && !item.trusted ? s.actionBtnDisabled : null,
                              pressed
                                ? (item.current ? s.actionBtnPressedApprove : s.actionBtnPressedDeny)
                                : null,
                            ]}
                          >
                            <Ionicons
                              name={item.current ? "shield-checkmark-outline" : "trash-outline"}
                              size={18}
                              color="white"
                            />
                            <Text style={s.denyBtnText}>
                              {item.current ? "Current Device Protected" : item.trusted ? "Revoke Device" : "Already Revoked"}
                            </Text>
                          </Pressable>
                        ) : isAddDevice ? (
                          <Pressable
                            onPress={handleQuickAddDevice}
                            style={({ pressed }) => [
                              s.actionBtn,
                              s.approveBtn,
                              pressed ? s.actionBtnPressedApprove : null,
                            ]}
                          >
                            <Ionicons name="add-circle-outline" size={18} color="#08111F" />
                            <Text style={s.approveBtnText}>Add Similar</Text>
                          </Pressable>
                        ) : isDeviceScan ? (
                          <Pressable
                            onPress={startDeviceScanFlow}
                            disabled={isScanning}
                            style={({ pressed }) => [
                              s.actionBtn,
                              s.restoreBtn,
                              isScanning ? s.actionBtnDisabled : null,
                              pressed && !isScanning ? s.actionBtnPressedApprove : null,
                            ]}
                          >
                            <Ionicons name={isScanning ? "sync-outline" : "scan-outline"} size={18} color="#08111F" />
                            <Text style={s.restoreBtnText}>{isScanning ? "Scanning..." : "Scan Again"}</Text>
                          </Pressable>
                        ) : (
                          <Pressable
                            onPress={() => handlePolicyMode(trustPolicy.mode === "strict" ? "balanced" : "strict")}
                            style={({ pressed }) => [
                              s.actionBtn,
                              s.restoreBtn,
                              pressed ? s.actionBtnPressedApprove : null,
                            ]}
                          >
                            <Ionicons name="options-outline" size={18} color="#08111F" />
                            <Text style={s.restoreBtnText}>Refresh Policy</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })
              )}

              {isTrustPolicy ? (
                <View style={[s.policyCard, { marginTop: 2 }]}>
                  <Text style={s.policyText}>Current devices: {deviceCurrentCount} • Risky devices: {deviceRiskyCount}</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : isViewLogs ? (
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>Security Timeline</Text>
            <Text style={s.sectionSub}>Live audit feed from church security actions.</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.filterRow}
              style={{ marginBottom: 14 }}
            >
              <Pressable
                onPress={() => setLogFilter("all")}
                style={[s.filterPill, logFilter === "all" ? s.filterPillActive : null]}
              >
                <Text style={[s.filterPillText, logFilter === "all" ? s.filterPillTextActive : null]}>
                  All
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setLogFilter("approvals")}
                style={[s.filterPill, logFilter === "approvals" ? s.filterPillNormal : null]}
              >
                <Text style={s.filterPillText}>Approvals</Text>
              </Pressable>

              <Pressable
                onPress={() => setLogFilter("roles")}
                style={[s.filterPill, logFilter === "roles" ? s.filterPillHigh : null]}
              >
                <Text style={s.filterPillText}>Role Reviews</Text>
              </Pressable>

              <Pressable
                onPress={() => setLogFilter("commands")}
                style={[s.filterPill, logFilter === "commands" ? s.filterPillNormal : null]}
              >
                <Text style={s.filterPillText}>Commands</Text>
              </Pressable>

              <Pressable
                onPress={() => setLogFilter("security")}
                style={[s.filterPill, logFilter === "security" ? s.filterPillCritical : null]}
              >
                <Text style={[s.filterPillText, logFilter === "security" ? s.filterPillTextDark : null]}>
                  Security
                </Text>
              </Pressable>
            </ScrollView>

            {loading ? (
              <Text style={s.emptyText}>Loading security logs...</Text>
            ) : filteredLogs.length === 0 ? (
              <Text style={s.emptyText}>No logs found for this filter.</Text>
            ) : (
              filteredLogs.map((item) => {
                const kind = logKind(item);
                const isApproval = kind === "approvals";
                const isRole = kind === "roles";
                const isCommand = kind === "commands";

                return (
                  <View
                    key={item.id}
                    style={[
                      s.logCard,
                      isApproval ? s.logCardBlue : null,
                      isRole ? s.logCardRed : null,
                      isCommand ? s.logCardGold : null,
                    ]}
                  >
                    <View style={s.logTop}>
                      <View
                        style={[
                          s.logIconWrap,
                          isApproval ? s.logIconWrapBlue : null,
                          isRole ? s.logIconWrapRed : null,
                          isCommand ? s.logIconWrapGold : null,
                        ]}>
                        <Ionicons
                          name={
                            isApproval
                              ? "shield-checkmark-outline"
                              : isRole
                              ? "git-compare-outline"
                              : isCommand
                              ? "terminal-outline"
                              : "document-text-outline"
                          }
                          size={18}
                          color="white"
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={s.logTitle} numberOfLines={3}>
                          {item.message || item.action}
                        </Text>
                        <Text style={s.logMeta} numberOfLines={1}>
                          {item.actorName || item.actorUserId}
                          {item.actorRole ? ` • ${item.actorRole}` : ""}
                        </Text>
                      </View>
                    </View>

                    <View style={s.logInfoRow}>
                      <Ionicons name="time-outline" size={14} color={SOFT} />
                      <Text style={s.logInfoText}>{formatLogTime(item.createdAt)}</Text>
                    </View>

                    {!!item.targetType ? (
                      <View style={s.logInfoRow}>
                        <Ionicons name="layers-outline" size={14} color={SOFT} />
                        <Text style={s.logInfoText} numberOfLines={2}>
                          {item.targetType}
                          {item.targetId ? ` • ${item.targetId}` : ""}
                        </Text>
                      </View>
                    ) : null}

                    {!!item.ip ? (
                      <View style={s.logInfoRow}>
                        <Ionicons name="globe-outline" size={14} color={SOFT} />
                        <Text style={s.logInfoText} numberOfLines={1} ellipsizeMode="middle">{item.ip}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>Flow Steps</Text>

            {(detail.items || []).map((item, index) => (
              <View key={`${item}-${index}`} style={s.stepCard}>
                <View style={s.stepBadge}>
                  <Text style={s.stepBadgeText}>{index + 1}</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={s.stepTitle}>{item}</Text>
                  <Text style={s.stepDesc}>Step hii tutaunganisha na logic ya kweli hatua inayofuata.</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingTop: 34,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  title: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },
  sub: {
    marginTop: 2,
    color: SOFT,
    fontSize: 12,
    fontWeight: "800",
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  statPending: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  statApproved: {
    backgroundColor: "rgba(34,197,94,0.18)",
    borderColor: "rgba(34,197,94,0.45)",
  },
  statDenied: {
    backgroundColor: "rgba(255,107,107,0.16)",
    borderColor: "rgba(255,107,107,0.38)",
  },
  statValue: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 0,
  },
  statLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 9,
    fontWeight: "800",
  },
  sectionCard: {
    borderRadius: 28,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  sectionTitle: {
    color: GOLD,
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 10,
  },
  sectionSub: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    fontWeight: "800",
    marginTop: -4,
    marginBottom: 12,
  },
  filterRow: {
    gap: 8,
    paddingRight: 96,
  },
  filterPill: {
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  filterPillActive: {
    backgroundColor: "rgba(217,179,95,0.16)",
    borderColor: "rgba(217,179,95,0.62)",
    shadowColor: GOLD,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  filterPillCritical: {
    backgroundColor: GOLD,
    borderColor: "rgba(217,179,95,0.60)",
  },
  filterPillHigh: {
    backgroundColor: "rgba(255,107,107,0.18)",
    borderColor: "rgba(255,107,107,0.34)",
  },
  filterPillNormal: {
    backgroundColor: "rgba(90,168,255,0.16)",
    borderColor: "rgba(90,168,255,0.34)",
  },
  filterPillText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  filterPillTextActive: {
    color: "white",
  },
  filterPillTextDark: {
    color: "#08111F",
  },
  emptyText: {
    color: SOFT,
    fontSize: 14,
    fontWeight: "700",
  },
  requestCard: {
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  requestCardCritical: {
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(255,255,255,0.06)",
    shadowColor: GOLD,
    shadowOpacity: 0.10,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  requestTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  requestName: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },
  requestMeta: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "800",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },
  statusPending: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  statusApproved: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  statusDenied: {
    backgroundColor: "rgba(255,107,107,0.16)",
    borderColor: "rgba(255,107,107,0.30)",
  },
  statusText: {
    color: "white",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  statusTextDark: {
    color: "#08111F",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  infoText: {
    color: SOFT,
    fontSize: 13,
    fontWeight: "800",
  },
  signalChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
    marginBottom: 12,
  },
  signalChip: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  signalChipRed: {
    backgroundColor: "rgba(255,107,107,0.16)",
    borderColor: "rgba(255,107,107,0.30)",
  },
  signalChipBlue: {
    backgroundColor: "rgba(90,168,255,0.16)",
    borderColor: "rgba(90,168,255,0.34)",
  },
  signalChipGold: {
    backgroundColor: GOLD,
    borderColor: "rgba(217,179,95,0.60)",
  },
  signalChipText: {
    color: "white",
    fontSize: 11,
    fontWeight: "900",
  },
  signalChipTextDark: {
    color: "#08111F",
    fontSize: 11,
    fontWeight: "900",
  },
  requestActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 12,
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  actionBtnPressedApprove: {
    transform: [{ scale: 0.985 }],
    opacity: 0.96,
  },
  actionBtnPressedDeny: {
    transform: [{ scale: 0.985 }],
    opacity: 0.94,
  },
  approveBtn: {
    backgroundColor: "#22C55E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#22C55E",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  denyBtn: {
    backgroundColor: "rgba(255,107,107,0.24)",
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.62)",
  },
  restoreBtn: {
    backgroundColor: "rgba(34,197,94,0.65)",
  },
  protectedBtn: {
    backgroundColor: "rgba(90,168,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(90,168,255,0.40)",
  },


  sessionCardHigh: {
    borderColor: "rgba(255,107,107,0.34)",
    backgroundColor: "rgba(255,107,107,0.06)",
  },
  sessionCardCurrent: {
    borderColor: "rgba(90,168,255,0.30)",
  },
  deviceCardTrusted: {
    borderColor: "rgba(90,168,255,0.34)",
    shadowColor: "rgba(90,168,255,0.70)",
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  deviceCardUntrusted: {
    borderColor: "rgba(255,107,107,0.34)",
    backgroundColor: "rgba(255,107,107,0.05)",
  },
  logCard: {
    borderRadius: 21,
    padding: 11,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.045)",
  },
  logCardBlue: {
    borderColor: "rgba(90,168,255,0.28)",
  },
  logCardRed: {
    borderColor: "rgba(255,107,107,0.24)",
  },
  logTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 5,
  },
  logIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    marginTop: 1,
  },
  logIconWrapBlue: {
    backgroundColor: "rgba(90,168,255,0.18)",
    borderColor: "rgba(90,168,255,0.34)",
  },
  logIconWrapRed: {
    backgroundColor: "rgba(255,107,107,0.18)",
    borderColor: "rgba(255,107,107,0.30)",
  },
  logTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
  },
  logMeta: {
    marginTop: 2,
    color: "rgba(255,255,255,0.62)",
    fontSize: 10.5,
    fontWeight: "800",
  },
  logInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 4,
    opacity: 0.86,
  },
  logInfoText: {
    color: SOFT,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 13,
    flexShrink: 1,
  },
  approveBtnText: {
    color: "#08111F",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  denyBtnText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  priorityBadge: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    borderWidth: 1,
  },
  priorityCritical: {
    backgroundColor: GOLD,
    borderColor: "rgba(217,179,95,0.60)",
  },
  priorityHigh: {
    backgroundColor: "rgba(255,107,107,0.18)",
    borderColor: "rgba(255,107,107,0.34)",
  },
  priorityNormal: {
    backgroundColor: "rgba(90,168,255,0.16)",
    borderColor: "rgba(90,168,255,0.34)",
  },
  priorityBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  priorityBadgeTextDark: {
    color: "#08111F",
  },
  priorityNoteCard: {
    borderRadius: 16,
    padding: 12,
    marginTop: 12,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  priorityNoteLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  priorityNoteText: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  priorityScoreBox: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  priorityScoreRow: {
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  priorityScoreLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  priorityScoreValue: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
  },
  restoreBtnText: {
    color: "#08111F",
    fontSize: 14,
    fontWeight: "900",
  },
  roleCompareWrap: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    marginBottom: 12,
  },
  roleMiniCard: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  roleMiniCardBlue: {
    borderColor: "rgba(90,168,255,0.34)",
    backgroundColor: "rgba(90,168,255,0.10)",
  },
  roleMiniLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  roleMiniValue: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
  },
  roleArrowWrap: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  reasonCard: {
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  reasonLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  reasonText: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  stepCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  stepBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  stepBadgeText: {
    color: "#08111F",
    fontSize: 15,
    fontWeight: "900",
  },
  stepTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  stepDesc: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },

  logCardGold: {
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.07)",
  },

  logIconWrapGold: {
    backgroundColor: "rgba(217,179,95,0.18)",
    borderColor: "rgba(217,179,95,0.28)",
  },

  policyCard: {
    borderRadius: 22,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  policyTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 8,
  },
  policyText: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginBottom: 12,
  },
  policyRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    gap: 10,
  },
  policyLabel: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
  },
  inlineBtnRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  smallPillBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  smallPillBtnText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  fullActionBtn: {
    width: "100%",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  scanModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(11,15,23,0.98)",
  },
  scanModalIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  scanModalIconSafe: {
    backgroundColor: "rgba(34,197,94,0.22)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.42)",
  },
  scanModalIconRisk: {
    backgroundColor: "rgba(255,107,107,0.20)",
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.36)",
  },
  scanModalTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
  },
  scanModalText: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  scanModalStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    marginBottom: 18,
  },
  scanMiniStat: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    paddingVertical: 6,
  },
  scanMiniStatNeutral: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  scanMiniStatSafe: {
    backgroundColor: "rgba(34,197,94,0.16)",
    borderColor: "rgba(34,197,94,0.34)",
  },
  scanMiniStatRisk: {
    backgroundColor: "rgba(255,107,107,0.14)",
    borderColor: "rgba(255,107,107,0.30)",
  },
  scanMiniStatValue: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  },
  scanMiniStatLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  scanModalBtn: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  scanModalBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.3,
  },

  scanModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,8,23,0.78)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  scanWaveRing: {
    position: "absolute",
    top: 18,
    alignSelf: "center",
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 1.5,
    borderColor: "rgba(90,168,255,0.36)",
  },
  scanWaveRingSecond: {
    borderColor: "rgba(34,197,94,0.24)",
  },
  scanOrb: {
    width: 98,
    height: 98,
    borderRadius: 49,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    backgroundColor: "rgba(90,168,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(90,168,255,0.34)",
  },
  scanOrbRisk: {
    backgroundColor: "rgba(255,107,107,0.20)",
    borderColor: "rgba(255,107,107,0.34)",
  },
  scanOrbSafe: {
    backgroundColor: "rgba(34,197,94,0.20)",
    borderColor: "rgba(34,197,94,0.34)",
  },
  scanLoaderBar: {
    height: 12,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginTop: 2,
    marginBottom: 4,
  },
  scanLoaderFill: {
    height: "100%",
    width: "100%",
    backgroundColor: "rgba(34,197,94,0.92)",
  },

  scanResultHero: {
    marginTop: 8,
    marginBottom: 16,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 28,
    alignItems: "center",
    borderWidth: 1,
  },
  scanResultHeroSafe: {
    backgroundColor: "rgba(34,197,94,0.10)",
    borderColor: "rgba(34,197,94,0.28)",
  },
  scanResultHeroRisk: {
    backgroundColor: "rgba(255,107,107,0.10)",
    borderColor: "rgba(255,107,107,0.26)",
  },
  scanResultHeroIconWrap: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
  },
  scanResultHeroIconWrapSafe: {
    backgroundColor: "rgba(34,197,94,0.16)",
    borderColor: "rgba(34,197,94,0.28)",
  },
  scanResultHeroIconWrapRisk: {
    backgroundColor: "rgba(255,107,107,0.16)",
    borderColor: "rgba(255,107,107,0.28)",
  },
  scanResultHeroTitle: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  scanResultHeroText: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 22,
    marginTop: 10,
  },

  scanResultPanel: {
    marginBottom: 14,
    padding: 18,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  scanResultPanelTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  scanResultPanelIdentity: {
    flex: 1,
  },
  scanResultPanelTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },
  scanResultPanelSub: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  scanResultPill: {
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  scanResultPillSafe: {
    backgroundColor: "rgba(34,197,94,0.16)",
    borderColor: "rgba(34,197,94,0.32)",
  },
  scanResultPillWarn: {
    backgroundColor: "rgba(245,158,11,0.16)",
    borderColor: "rgba(245,158,11,0.32)",
  },
  scanResultPillRisk: {
    backgroundColor: "rgba(255,107,107,0.16)",
    borderColor: "rgba(255,107,107,0.32)",
  },
  scanResultPillText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  scanResultMetricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  scanResultMetricCard: {
    width: "48%",
    minHeight: 88,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(2,8,23,0.68)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
  },
  scanResultMetricLabel: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  scanResultMetricValue: {
    color: "white",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
  },
  scanResultMetricValueSafe: {
    color: "#4ADE80",
  },
  scanResultMetricValueRisk: {
    color: "#FF8A8A",
  },

  scanResultInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  scanResultInfoText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },

  scanResultFlagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  scanResultFlag: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  scanResultFlagBlue: {
    backgroundColor: "rgba(90,168,255,0.16)",
    borderColor: "rgba(90,168,255,0.28)",
  },
  scanResultFlagGold: {
    backgroundColor: "rgba(217,179,95,0.20)",
    borderColor: "rgba(217,179,95,0.34)",
  },
  scanResultFlagRed: {
    backgroundColor: "rgba(255,107,107,0.16)",
    borderColor: "rgba(255,107,107,0.30)",
  },
  scanResultFlagText: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  scanResultFlagTextDark: {
    color: "#08111F",
    fontSize: 12,
    fontWeight: "900",
  },

  scanSummaryGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  scanSummaryCard: {
    flex: 1,
    minHeight: 110,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    paddingVertical: 12,
  },
  scanSummaryCardNeutral: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  scanSummaryCardSafe: {
    backgroundColor: "rgba(34,197,94,0.14)",
    borderColor: "rgba(34,197,94,0.30)",
  },
  scanSummaryCardRisk: {
    backgroundColor: "rgba(255,107,107,0.14)",
    borderColor: "rgba(255,107,107,0.30)",
  },
  scanSummaryValue: {
    color: "white",
    fontSize: 30,
    fontWeight: "900",
  },
  scanSummaryLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 6,
  },

  scanDecisionCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "rgba(2,8,23,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  scanDecisionTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  scanDecisionLine: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: 3,
  },

  scanActionStack: {
    gap: 8,
    marginTop: 0,
  },
  scanActionPrimary: {
    minHeight: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  scanActionPrimaryText: {
    color: "#08111F",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  scanActionSecondary: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(90,168,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(90,168,255,0.30)",
  },
  scanActionSecondaryText: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

});
