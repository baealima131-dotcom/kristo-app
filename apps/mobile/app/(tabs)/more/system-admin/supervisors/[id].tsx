import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AnalyticsChip,
  configureExpandAnimation,
  ContactAvatar,
  GlassCard,
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
  fetchSupervisorDetail,
  type ActivationCode,
  type SupervisorSummary,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

function formatWhen(iso?: string | null) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateShort(iso?: string | null) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function qrImageUri(code: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(code)}`;
}

function statusLabel(status: string) {
  if (status === "available") return "Available";
  if (status === "assigned_to_supervisor") return "With Supervisor";
  if (status === "assigned_to_agent") return "With Agent";
  if (status === "redeemed") return "Redeemed";
  if (status === "disabled") return "Disabled";
  return status;
}

function statusColor(status: string) {
  if (status === "redeemed") return SA_GREEN;
  if (status === "assigned_to_agent") return SA_PURPLE;
  if (status === "assigned_to_supervisor") return SA_GOLD;
  if (status === "disabled") return "#FCA5A5";
  return MUTED;
}

type TimelineEvent = {
  key: string;
  title: string;
  subtitle?: string;
  tone: "gold" | "purple" | "green" | "muted" | "red";
};

function buildTimeline(code: ActivationCode): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (code.createdAt) {
    events.push({
      key: "created",
      title: "Code generated",
      subtitle: formatWhen(code.createdAt),
      tone: "muted",
    });
  }

  if (code.assignedSupervisorAt) {
    events.push({
      key: "supervisor",
      title: "Assigned to Supervisor",
      subtitle: formatWhen(code.assignedSupervisorAt),
      tone: "gold",
    });
  }

  if (code.assignedAgentAt) {
    events.push({
      key: "agent",
      title: "Delivered to Agent",
      subtitle: formatWhen(code.assignedAgentAt),
      tone: "purple",
    });
  }

  if (code.deliveredToChurchId) {
    events.push({
      key: "church",
      title: "Delivered to Church",
      subtitle: code.deliveredToChurchId,
      tone: "purple",
    });
  }

  if (code.redeemedAt) {
    events.push({
      key: "redeemed",
      title: "Redeemed",
      subtitle: `${formatWhen(code.redeemedAt)}${code.redeemedByChurchId ? ` · ${code.redeemedByChurchId}` : ""}`,
      tone: "green",
    });
  }

  if (code.status === "disabled") {
    events.push({ key: "expired", title: "Expired", subtitle: "Code disabled", tone: "red" });
  }

  if (
    code.status === "available" &&
    !code.assignedSupervisorUserId &&
    !code.redeemedAt &&
    events.length > 1
  ) {
    events.push({ key: "returned", title: "Returned", subtitle: "Returned to unassigned pool", tone: "muted" });
  }

  return events;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function CodeTimelineCard({ code }: { code: ActivationCode }) {
  const [expanded, setExpanded] = React.useState(false);
  const [showQr, setShowQr] = React.useState(false);
  const timeline = React.useMemo(() => buildTimeline(code), [code]);

  const toggle = () => {
    configureExpandAnimation();
    setExpanded((v) => !v);
  };

  const onCopy = async () => {
    await Clipboard.setStringAsync(code.code);
    Alert.alert("Copied", "Activation code copied.");
  };

  const onShare = async () => {
    try {
      await Share.share({ message: code.code });
    } catch {
      /* ignore */
    }
  };

  return (
    <GlassCard pad={0} style={styles.codeCard}>
      <Pressable onPress={toggle} style={styles.codeHeader}>
        <View style={styles.codeHeaderMain}>
          <Text style={styles.codeValue} numberOfLines={1}>
            {code.code}
          </Text>
          <View style={styles.codeHeaderMeta}>
            <View style={[styles.statusTag, { borderColor: `${statusColor(code.status)}44` }]}>
              <View style={[styles.statusTagDot, { backgroundColor: statusColor(code.status) }]} />
              <Text style={[styles.statusTagText, { color: statusColor(code.status) }]}>
                {statusLabel(code.status)}
              </Text>
            </View>
            <Text style={styles.durationTag}>
              {code.durationMonths} mo · {code.countryCode}
            </Text>
          </View>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color="rgba(255,255,255,0.45)"
        />
      </Pressable>

      {expanded ? (
        <View style={styles.codeExpanded}>
          <View style={styles.timeline}>
            {timeline.map((event, idx) => (
              <View key={event.key} style={styles.timelineItem}>
                <View style={styles.timelineRail}>
                  <View
                    style={[
                      styles.timelineDot,
                      event.tone === "gold" && styles.timelineDotGold,
                      event.tone === "purple" && styles.timelineDotPurple,
                      event.tone === "green" && styles.timelineDotGreen,
                      event.tone === "red" && styles.timelineDotRed,
                      event.tone === "muted" && styles.timelineDotMuted,
                    ]}
                  />
                  {idx < timeline.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>
                <View style={styles.timelineCopy}>
                  <Text style={styles.timelineTitle}>{event.title}</Text>
                  {event.subtitle ? <Text style={styles.timelineSub}>{event.subtitle}</Text> : null}
                </View>
              </View>
            ))}
          </View>

          <View style={styles.detailGrid}>
            <DetailRow label="Created" value={formatDateShort(code.createdAt)} />
            <DetailRow label="Assigned" value={formatDateShort(code.assignedSupervisorAt)} />
            <DetailRow label="Redeemed" value={formatDateShort(code.redeemedAt)} />
            <DetailRow label="Church" value={code.redeemedByChurchId || code.deliveredToChurchId || "—"} />
            <DetailRow label="Agent" value={code.assignedAgentUserId || "—"} />
            <DetailRow label="Duration" value={`${code.durationMonths} months`} />
            <DetailRow label="Country" value={code.countryCode || "—"} />
          </View>

          <View style={styles.codeActions}>
            <Pressable style={styles.codeAction} onPress={onCopy}>
              <Ionicons name="copy-outline" size={14} color={SA_GOLD} />
              <Text style={styles.codeActionText}>Copy</Text>
            </Pressable>
            <Pressable style={styles.codeAction} onPress={() => setShowQr((v) => !v)}>
              <Ionicons name="qr-code-outline" size={14} color={SA_GOLD} />
              <Text style={styles.codeActionText}>QR Code</Text>
            </Pressable>
            <Pressable style={styles.codeAction} onPress={onShare}>
              <Ionicons name="share-outline" size={14} color={SA_GOLD} />
              <Text style={styles.codeActionText}>Share</Text>
            </Pressable>
          </View>

          {showQr ? (
            <View style={styles.qrWrap}>
              <Image source={{ uri: qrImageUri(code.code) }} style={styles.qrImage} />
            </View>
          ) : null}
        </View>
      ) : null}
    </GlassCard>
  );
}

export default function SupervisorDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const supervisorUserId = decodeURIComponent(String(params.id || "").trim());

  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [supervisor, setSupervisor] = React.useState<SupervisorSummary | null>(null);
  const [codes, setCodes] = React.useState<ActivationCode[]>([]);

  const loadDetail = React.useCallback(async () => {
    if (!allowed || !supervisorUserId) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetchSupervisorDetail(supervisorUserId);
      setSupervisor(res.supervisor);
      setCodes(res.codes);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load supervisor"));
    } finally {
      setLoading(false);
    }
  }, [allowed, supervisorUserId]);

  useFocusEffect(
    React.useCallback(() => {
      loadDetail();
    }, [loadDetail])
  );

  const displayName = supervisor?.fullName || supervisor?.kristoId || supervisor?.userId || "Supervisor";

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#0E0A18", BG]} style={StyleSheet.absoluteFillObject} />

      <View style={[styles.nav, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.88)" />
        </Pressable>
        <View style={styles.navCopy}>
          <Text style={styles.navTitle} numberOfLines={1}>
            {loading ? "Supervisor" : displayName}
          </Text>
          <Text style={styles.navSub}>Assigned codes & activity</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <GlassCard>
            <Text style={styles.notice}>System Admin access required.</Text>
          </GlassCard>
        ) : loading ? (
          <View style={styles.shimmerList}>
            <ShimmerBlock height={140} />
            <ShimmerBlock height={56} />
            <ShimmerBlock height={88} />
            <ShimmerBlock height={88} />
          </View>
        ) : error ? (
          <GlassCard style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </GlassCard>
        ) : supervisor ? (
          <>
            <GlassCard pad={12}>
              <View style={styles.profileRow}>
                <ContactAvatar
                  uri={supervisor.avatarUrl}
                  name={displayName}
                  fallbackId={supervisor.kristoId || supervisor.userId}
                  size={56}
                  online={supervisor.invitationStatus === "accepted"}
                />
                <View style={styles.profileCopy}>
                  <View style={styles.profileNameRow}>
                    <Text style={styles.profileName} numberOfLines={2}>
                      {displayName}
                    </Text>
                    <StatusCapsule tone={supervisorStatusTone(supervisor)} />
                  </View>
                  <Text style={styles.profileMeta}>{supervisor.kristoId || supervisor.userId}</Text>
                  <Text style={styles.profileMeta}>{supervisor.churchId || "—"}</Text>
                </View>
              </View>
            </GlassCard>

            <View style={styles.analyticsRow}>
              <AnalyticsChip dotColor={SA_PURPLE} value={supervisor.assignedCodes} label="Assigned" />
              <AnalyticsChip dotColor={SA_GOLD} value={supervisor.remainingCodes} label="Remaining" />
              <AnalyticsChip dotColor={SA_GREEN} value={supervisor.redeemedCodes} label="Redeemed" />
            </View>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Assigned codes</Text>
              <Text style={styles.sectionCount}>{codes.length}</Text>
            </View>

            {codes.length === 0 ? (
              <GlassCard pad={14}>
                <Text style={styles.emptyText}>No codes assigned yet.</Text>
              </GlassCard>
            ) : (
              <View style={styles.codeList}>
                {codes.slice(0, 100).map((code) => (
                  <CodeTimelineCard key={code.id} code={code} />
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
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
  navTitle: { color: TEXT, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  navSub: { color: MUTED, fontSize: 11, marginTop: 1 },
  content: { paddingHorizontal: 14, paddingTop: 2, gap: 10 },
  profileRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  profileCopy: { flex: 1, minWidth: 0, gap: 3 },
  profileNameRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  profileName: { flex: 1, color: TEXT, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  profileMeta: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "500" },
  analyticsRow: { flexDirection: "row", gap: 6 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginTop: 2,
  },
  sectionTitle: { color: TEXT, fontSize: 14, fontWeight: "800" },
  sectionCount: { color: MUTED, fontSize: 12, fontWeight: "700" },
  codeList: { gap: 8 },
  codeCard: { overflow: "hidden" },
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  codeHeaderMain: { flex: 1, minWidth: 0, gap: 4 },
  codeValue: { color: TEXT, fontSize: 14, fontWeight: "800", letterSpacing: 0.4 },
  codeHeaderMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  statusTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  statusTagDot: { width: 5, height: 5, borderRadius: 999 },
  statusTagText: { fontSize: 10, fontWeight: "700" },
  durationTag: { color: MUTED, fontSize: 10, fontWeight: "600" },
  codeExpanded: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
  },
  timeline: { gap: 0, paddingTop: 4 },
  timelineItem: { flexDirection: "row", gap: 10, minHeight: 42 },
  timelineRail: { width: 14, alignItems: "center" },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
  },
  timelineDotGold: { backgroundColor: SA_GOLD, borderColor: "rgba(244,208,111,0.5)" },
  timelineDotPurple: { backgroundColor: SA_PURPLE, borderColor: "rgba(156,118,255,0.5)" },
  timelineDotGreen: { backgroundColor: SA_GREEN, borderColor: "rgba(110,231,168,0.5)" },
  timelineDotRed: { backgroundColor: "#F87171", borderColor: "rgba(248,113,113,0.5)" },
  timelineDotMuted: { backgroundColor: "rgba(255,255,255,0.35)", borderColor: "rgba(255,255,255,0.2)" },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 2,
  },
  timelineCopy: { flex: 1, paddingBottom: 8 },
  timelineTitle: { color: TEXT, fontSize: 12, fontWeight: "700" },
  timelineSub: { color: MUTED, fontSize: 10, marginTop: 2, lineHeight: 14 },
  detailGrid: {
    gap: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.05)",
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  detailLabel: { color: MUTED, fontSize: 10, fontWeight: "600", width: 72 },
  detailValue: {
    flex: 1,
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "right",
  },
  codeActions: { flexDirection: "row", gap: 8 },
  codeAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(244,208,111,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.18)",
  },
  codeActionText: { color: SA_GOLD, fontSize: 11, fontWeight: "700" },
  qrWrap: { alignItems: "center", paddingVertical: 6 },
  qrImage: { width: 140, height: 140, borderRadius: 10 },
  shimmerList: { gap: 8 },
  emptyText: { color: MUTED, fontSize: 12, textAlign: "center" },
  notice: { color: MUTED, fontSize: 13, textAlign: "center" },
  errorCard: { borderColor: "rgba(248,113,113,0.2)" },
  errorText: { color: "#FCA5A5", fontSize: 12 },
});
