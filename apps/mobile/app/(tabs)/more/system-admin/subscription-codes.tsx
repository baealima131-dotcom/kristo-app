import React from "react";
import {
  ActivityIndicator,
  Alert,
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
import * as Clipboard from "expo-clipboard";
import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  ACTIVATION_COUNTRY_OPTIONS,
  ACTIVATION_DURATION_OPTIONS,
  fetchActivationCodes,
  generateActivationCodes,
  type ActivationCode,
  type ActivationCodeBatch,
} from "@/src/lib/offlineActivationCodesApi";

const ACCENT = "#9C76FF";
const BG = "#070C14";
const CARD = "rgba(16,20,29,0.92)";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "rgba(255,255,255,0.94)";
const MUTED = "rgba(255,255,255,0.72)";

function formatWhen(iso: string) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

function statusColor(status: string) {
  if (status === "available") return "#6EE7A8";
  if (status === "redeemed") return "#93C5FD";
  return "#FCA5A5";
}

export default function SubscriptionActivationCodesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [showForm, setShowForm] = React.useState(false);
  const [error, setError] = React.useState("");
  const [batches, setBatches] = React.useState<ActivationCodeBatch[]>([]);
  const [codes, setCodes] = React.useState<ActivationCode[]>([]);
  const [totals, setTotals] = React.useState({
    batches: 0,
    codes: 0,
    available: 0,
    disabled: 0,
    redeemed: 0,
  });

  const [countryCode, setCountryCode] = React.useState<(typeof ACTIVATION_COUNTRY_OPTIONS)[number]>("BDI");
  const [durationMonths, setDurationMonths] =
    React.useState<(typeof ACTIVATION_DURATION_OPTIONS)[number]>(1);
  const [quantity, setQuantity] = React.useState("10");

  const loadCodes = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetchActivationCodes(200);
      setBatches(Array.isArray(res.batches) ? res.batches : []);
      setCodes(Array.isArray(res.codes) ? res.codes : []);
      setTotals(res.totals || { batches: 0, codes: 0, available: 0, disabled: 0, redeemed: 0 });
    } catch (e: any) {
      setError(String(e?.message || "Failed to load codes"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      loadCodes();
    }, [loadCodes])
  );

  const onGenerate = async () => {
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      Alert.alert("Invalid quantity", "Enter a quantity of at least 1.");
      return;
    }

    setGenerating(true);
    setError("");
    try {
      await generateActivationCodes({
        countryCode,
        durationMonths,
        quantity: qty,
      });
      setShowForm(false);
      await loadCodes();
    } catch (e: any) {
      setError(String(e?.message || "Failed to generate codes"));
    } finally {
      setGenerating(false);
    }
  };

  const onCopyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    console.log("KRISTO_ACTIVATION_CODES_COPY", { code });
    Alert.alert("Copied", "Activation code copied to clipboard.");
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
          <Text style={styles.title}>Subscription Activation Codes</Text>
          <Text style={styles.subtitle}>Generate batches • view platform codes</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <View style={styles.noticeCard}>
            <Ionicons name="lock-closed-outline" size={22} color={ACCENT} />
            <Text style={styles.noticeTitle}>Access restricted</Text>
            <Text style={styles.noticeText}>
              Only System Admin platform role can generate and list activation codes.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <StatPill label="Batches" value={totals.batches} />
              <StatPill label="Codes" value={totals.codes} />
              <StatPill label="Available" value={totals.available} accent="#6EE7A8" />
            </View>

            <Pressable style={styles.primaryBtn} onPress={() => setShowForm((v) => !v)}>
              <Ionicons name={showForm ? "close" : "add-circle-outline"} size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>
                {showForm ? "Close generator" : "Generate batch"}
              </Text>
            </Pressable>

            {showForm ? (
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>New activation batch</Text>

                <Text style={styles.label}>Country</Text>
                <View style={styles.chipRow}>
                  {ACTIVATION_COUNTRY_OPTIONS.map((c) => (
                    <Pressable
                      key={c}
                      style={[styles.chip, countryCode === c && styles.chipActive]}
                      onPress={() => setCountryCode(c)}
                    >
                      <Text style={[styles.chipText, countryCode === c && styles.chipTextActive]}>
                        {c}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Duration (months)</Text>
                <View style={styles.chipRow}>
                  {ACTIVATION_DURATION_OPTIONS.map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.chip, durationMonths === m && styles.chipActive]}
                      onPress={() => setDurationMonths(m)}
                    >
                      <Text style={[styles.chipText, durationMonths === m && styles.chipTextActive]}>
                        {m} mo
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Quantity</Text>
                <TextInput
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="number-pad"
                  placeholder="10"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={styles.input}
                />

                <Text style={styles.formatHint}>
                  Format: KR-{countryCode}-M{durationMonths}-XXXX-XXXX
                </Text>

                <Pressable
                  style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
                  disabled={generating}
                  onPress={onGenerate}
                >
                  {generating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sparkles-outline" size={18} color="#fff" />
                      <Text style={styles.generateBtnText}>Generate</Text>
                    </>
                  )}
                </Pressable>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : (
              <>
                <SectionHeader title="Recent batches" count={batches.length} />
                {batches.length === 0 ? (
                  <EmptyCard text="No batches yet. Generate your first batch above." />
                ) : (
                  batches.slice(0, 12).map((batch) => (
                    <View key={batch.batchId} style={styles.batchCard}>
                      <View style={styles.batchTop}>
                        <Text style={styles.batchTitle}>
                          {batch.countryCode} • {batch.durationMonths} mo • {batch.quantity} codes
                        </Text>
                        <Text style={styles.batchStatus}>{batch.status}</Text>
                      </View>
                      <Text style={styles.batchMeta}>Batch {batch.batchId}</Text>
                      <Text style={styles.batchMeta}>Created {formatWhen(batch.createdAt)}</Text>
                    </View>
                  ))
                )}

                <SectionHeader title="Generated codes" count={codes.length} />
                {codes.length === 0 ? (
                  <EmptyCard text="No codes generated yet." />
                ) : (
                  codes.slice(0, 50).map((row) => (
                    <View key={row.id} style={styles.codeCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.codeValue}>{row.code}</Text>
                        <Text style={styles.codeMeta}>
                          {row.countryCode} • M{row.durationMonths} •{" "}
                          <Text style={{ color: statusColor(row.status) }}>{row.status}</Text>
                        </Text>
                        <Text style={styles.codeMeta}>{formatWhen(row.createdAt)}</Text>
                      </View>
                      <Pressable
                        style={styles.copyBtn}
                        onPress={() => onCopyCode(row.code)}
                        hitSlop={8}
                      >
                        <Ionicons name="copy-outline" size={18} color={ACCENT} />
                        <Text style={styles.copyBtnText}>Copy</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
      <Text style={styles.sectionHeaderCount}>{count}</Text>
    </View>
  );
}

function StatPill({
  label,
  value,
  accent = TEXT,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
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
  statsRow: { flexDirection: "row", gap: 8 },
  statPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { color: MUTED, fontSize: 11, marginTop: 2 },
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
  formCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 8,
  },
  formTitle: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 4 },
  label: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipActive: {
    borderColor: `${ACCENT}88`,
    backgroundColor: `${ACCENT}22`,
  },
  chipText: { color: MUTED, fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: TEXT },
  input: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: TEXT,
    backgroundColor: "rgba(255,255,255,0.04)",
    fontSize: 16,
    fontWeight: "700",
  },
  formatHint: { color: MUTED, fontSize: 12, marginTop: 4 },
  generateBtn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#5B45C9",
  },
  generateBtnDisabled: { opacity: 0.7 },
  generateBtnText: { color: "#fff", fontWeight: "800" },
  errorCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  errorText: { color: "#FCA5A5", fontSize: 13 },
  loadingWrap: { paddingVertical: 24, alignItems: "center" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  sectionHeaderTitle: { color: TEXT, fontSize: 15, fontWeight: "800" },
  sectionHeaderCount: { color: MUTED, fontSize: 12, fontWeight: "700" },
  batchCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 4,
  },
  batchTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  batchTitle: { color: TEXT, fontSize: 14, fontWeight: "800", flex: 1 },
  batchStatus: { color: ACCENT, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  batchMeta: { color: MUTED, fontSize: 11 },
  codeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  codeValue: { color: TEXT, fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },
  codeMeta: { color: MUTED, fontSize: 11, marginTop: 3 },
  copyBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  copyBtnText: { color: ACCENT, fontSize: 10, fontWeight: "700" },
  emptyCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyText: { color: MUTED, fontSize: 13, textAlign: "center" },
  noticeCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    gap: 8,
  },
  noticeTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
