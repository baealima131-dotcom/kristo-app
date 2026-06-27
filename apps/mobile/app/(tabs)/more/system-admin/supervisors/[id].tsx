import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  fetchSupervisorDetail,
  type ActivationCode,
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

function formatWhen(iso?: string | null) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
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
          <Text style={styles.title}>Supervisor detail</Text>
          <Text style={styles.subtitle}>{supervisorUserId || "—"}</Text>
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
        ) : loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : supervisor ? (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>
                {supervisor.fullName || supervisor.kristoId || supervisor.userId}
              </Text>
              <Text style={styles.summaryMeta}>
                {supervisor.kristoId ? `KRISTO ${supervisor.kristoId}` : supervisor.userId}
                {supervisor.churchId ? ` • ${supervisor.churchId}` : ""}
              </Text>
              <View style={styles.statsRow}>
                <MiniStat label="Assigned" value={supervisor.assignedCodes} />
                <MiniStat label="Remaining" value={supervisor.remainingCodes} />
                <MiniStat label="Redeemed" value={supervisor.redeemedCodes} />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Assigned codes ({codes.length})</Text>
            {codes.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No codes assigned yet.</Text>
              </View>
            ) : (
              codes.slice(0, 100).map((code) => (
                <View key={code.id} style={styles.codeCard}>
                  <Text style={styles.codeValue}>{code.code}</Text>
                  <Text style={styles.codeMeta}>
                    {code.countryCode} • M{code.durationMonths} • {code.status}
                  </Text>
                  <Text style={styles.codeMeta}>Assigned {formatWhen(code.assignedSupervisorAt)}</Text>
                </View>
              ))
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
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
  subtitle: { color: MUTED, fontSize: 11, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  summaryCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 6,
  },
  summaryTitle: { color: TEXT, fontSize: 18, fontWeight: "800" },
  summaryMeta: { color: MUTED, fontSize: 12 },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  miniStat: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  miniStatValue: { color: TEXT, fontSize: 16, fontWeight: "800" },
  miniStatLabel: { color: MUTED, fontSize: 10, marginTop: 2 },
  sectionTitle: { color: TEXT, fontSize: 15, fontWeight: "800" },
  codeCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 4,
  },
  codeValue: { color: TEXT, fontSize: 15, fontWeight: "800", letterSpacing: 0.3 },
  codeMeta: { color: MUTED, fontSize: 11 },
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
});
