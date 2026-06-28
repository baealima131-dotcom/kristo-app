import React from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
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
  isAssignableActivationCode,
  type ActivationCode,
  type ActivationCodeBatch,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_BORDER as BORDER,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const GOLD = "#F4D06F";
const GOLD_SOFT = "rgba(244,208,111,0.16)";
const GLASS = "rgba(255,255,255,0.028)";
const GLASS_BORDER = "rgba(255,255,255,0.06)";
const BLUR = 88;
const MAX_QUANTITY = 200;

type CodeFilter = "all" | "available" | "assigned" | "redeemed" | "expired";
type CodeSort = "newest" | "oldest";

const COUNTRY_CARDS = [
  { code: "BDI" as const, flag: "🇧🇮", name: "Burundi" },
  { code: "CD" as const, flag: "🇨🇩", name: "Congo" },
  { code: "TZ" as const, flag: "🇹🇿", name: "Tanzania" },
  { code: "US" as const, flag: "🇺🇸", name: "United States" },
];

const DURATION_CARDS = [
  { months: 1 as const, label: "1 Month" },
  { months: 3 as const, label: "3 Months" },
  { months: 6 as const, label: "6 Months" },
  { months: 12 as const, label: "12 Months" },
];

const FILTER_CHIPS: { key: CodeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "assigned", label: "Assigned" },
  { key: "redeemed", label: "Redeemed" },
  { key: "expired", label: "Expired" },
];

function formatWhen(iso: string) {
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

function formatDateShort(iso: string) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusColor(status: string) {
  if (status === "available") return "#6EE7A8";
  if (status === "assigned_to_supervisor") return "#93C5FD";
  if (status === "assigned_to_agent") return "#C4B5FD";
  if (status === "redeemed") return "#FCA5A5";
  if (status === "disabled") return "#9CA3AF";
  return "#FCA5A5";
}

function statusLabel(status: string) {
  if (status === "available") return "Available";
  if (status === "assigned_to_supervisor") return "With Supervisor";
  if (status === "assigned_to_agent") return "With Agent";
  if (status === "redeemed") return "Redeemed";
  if (status === "disabled") return "Expired";
  return status;
}

function batchUsage(batch: ActivationCodeBatch) {
  const list = Array.isArray(batch.codes) ? batch.codes : [];
  const used = list.filter((code) => code.status === "redeemed").length;
  const remaining = list.filter((code) => code.status !== "redeemed").length;
  return { used, remaining };
}

function qrImageUri(code: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(code)}`;
}

function matchesFilter(code: ActivationCode, filter: CodeFilter) {
  if (filter === "all") return true;
  if (filter === "available") return isAssignableActivationCode(code);
  if (filter === "assigned")
    return code.status === "assigned_to_supervisor" || code.status === "assigned_to_agent";
  if (filter === "redeemed") return code.status === "redeemed";
  if (filter === "expired") return code.status === "disabled";
  return true;
}

function configureExpand() {
  LayoutAnimation.configureNext({
    duration: 240,
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.84 },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

function Glass({ children, style, pad = 12 }: { children: React.ReactNode; style?: object; pad?: number }) {
  return (
    <View style={[styles.glassWrap, style]}>
      <BlurView intensity={BLUR} tint="dark" style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={["rgba(255,255,255,0.09)", "rgba(255,255,255,0.02)", "transparent"]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={styles.glassSheen} />
      <View style={{ padding: pad }}>{children}</View>
    </View>
  );
}

function SpringPress({
  children,
  onPress,
  style,
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: object;
  disabled?: boolean;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
        }
        onPressOut={() =>
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start()
        }
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

function AnimatedStatValue({ value, color }: { value: number; color: string }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    scale.setValue(0.92);
    opacity.setValue(0.6);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 7 }),
      Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [value, scale, opacity]);

  return (
    <Animated.Text style={[styles.metricValue, { color, opacity, transform: [{ scale }] }]}>
      {value}
    </Animated.Text>
  );
}

function PremiumStatCard({
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
  return (
    <View style={styles.metricCard}>
      <BlurView intensity={64} tint="dark" style={StyleSheet.absoluteFillObject} />
      <View style={[styles.metricIconWrap, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <AnimatedStatValue value={value} color={color} />
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function AnalyticsPill({
  dot,
  label,
  value,
}: {
  dot: string;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.analyticsPill}>
      <Text style={styles.analyticsDot}>{dot}</Text>
      <Text style={styles.analyticsValue}>{value}</Text>
      <Text style={styles.analyticsLabel}>{label}</Text>
    </View>
  );
}

function ShimmerBlock({ height = 72 }: { height?: number }) {
  const pulse = React.useRef(new Animated.Value(0.35)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.75, duration: 850, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 850, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[styles.shimmer, { height, opacity: pulse }]} />;
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  const fade = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    fade.setValue(0.5);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [status, fade]);

  return (
    <Animated.View style={[styles.statusBadge, { borderColor: `${color}44`, opacity: fade }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusBadgeText, { color }]}>{statusLabel(status)}</Text>
    </Animated.View>
  );
}

function DetailGridRow({
  label,
  value,
  badge,
}: {
  label: string;
  value?: string;
  badge?: React.ReactNode;
}) {
  return (
    <View style={styles.detailGridRow}>
      <Text style={styles.detailGridLabel}>{label}</Text>
      {badge ? (
        <View style={styles.detailGridValueWrap}>{badge}</View>
      ) : (
        <Text style={styles.detailGridValue} numberOfLines={2}>
          {value || "—"}
        </Text>
      )}
    </View>
  );
}

function GlassActionBtn({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <SpringPress onPress={onPress} style={{ flex: 1 }}>
      <View style={styles.glassActionBtn}>
        <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
        <Ionicons name={icon} size={13} color={GOLD} />
        <Text style={styles.glassActionText}>{label}</Text>
      </View>
    </SpringPress>
  );
}

export default function SubscriptionActivationCodesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [generateSuccess, setGenerateSuccess] = React.useState(false);
  const [showForm, setShowForm] = React.useState(false);
  const [error, setError] = React.useState("");
  const [batches, setBatches] = React.useState<ActivationCodeBatch[]>([]);
  const [codes, setCodes] = React.useState<ActivationCode[]>([]);
  const [totals, setTotals] = React.useState({
    batches: 0,
    codes: 0,
    available: 0,
    availableUnassigned: 0,
    assignedToSupervisors: 0,
    disabled: 0,
    redeemed: 0,
  });
  const [expandedCodeIds, setExpandedCodeIds] = React.useState<Record<string, boolean>>({});
  const [qrModalCode, setQrModalCode] = React.useState<ActivationCode | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [codeFilter, setCodeFilter] = React.useState<CodeFilter>("all");
  const [codeSort, setCodeSort] = React.useState<CodeSort>("newest");

  const [countryCode, setCountryCode] = React.useState<(typeof ACTIVATION_COUNTRY_OPTIONS)[number]>("BDI");
  const [durationMonths, setDurationMonths] =
    React.useState<(typeof ACTIVATION_DURATION_OPTIONS)[number]>(1);
  const [quantity, setQuantity] = React.useState("10");

  const sparkleAnim = React.useRef(new Animated.Value(0)).current;
  const successAnim = React.useRef(new Animated.Value(0)).current;
  const formAnim = React.useRef(new Animated.Value(showForm ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(formAnim, {
      toValue: showForm ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [showForm, formAnim]);

  React.useEffect(() => {
    if (!generating) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(sparkleAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [generating, sparkleAnim]);

  React.useEffect(() => {
    if (!generateSuccess) return;
    successAnim.setValue(0);
    Animated.sequence([
      Animated.timing(successAnim, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(successAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start(() => setGenerateSuccess(false));
  }, [generateSuccess, successAnim]);

  const loadCodes = React.useCallback(async (fresh = true) => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetchActivationCodes(200, { fresh });
      setBatches(Array.isArray(res.batches) ? res.batches : []);
      setCodes(Array.isArray(res.codes) ? res.codes : []);
      const t = res.totals;
      setTotals({
        batches: t?.batches ?? 0,
        codes: t?.codes ?? 0,
        available: t?.available ?? 0,
        availableUnassigned: t?.availableUnassigned ?? t?.available ?? 0,
        assignedToSupervisors: t?.assignedToSupervisors ?? 0,
        disabled: t?.disabled ?? 0,
        redeemed: t?.redeemed ?? 0,
      });
    } catch (e: any) {
      setError(String(e?.message || "Failed to load codes"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      loadCodes(true);
    }, [loadCodes])
  );

  const codeAnalytics = React.useMemo(() => {
    const available = Number(totals.availableUnassigned ?? totals.available ?? 0);
    const assigned = Number(totals.assignedToSupervisors ?? 0);
    const redeemed = Number(totals.redeemed ?? 0);
    const expired = Number(totals.disabled ?? 0);
    return { available, assigned, redeemed, expired };
  }, [totals]);

  const filteredCodes = React.useMemo(() => {
    const q = String(searchQuery || "")
      .trim()
      .toUpperCase();
    let list = codes.filter((row) => matchesFilter(row, codeFilter));
    if (q) list = list.filter((row) => String(row.code || "").toUpperCase().includes(q));
    list = [...list].sort((a, b) => {
      const aMs = Date.parse(String(a.createdAt || ""));
      const bMs = Date.parse(String(b.createdAt || ""));
      return codeSort === "newest" ? bMs - aMs : aMs - bMs;
    });
    return list.slice(0, 50);
  }, [codes, searchQuery, codeFilter, codeSort]);

  const parsedQuantity = Math.floor(Number(quantity));
  const quantityValid = Number.isFinite(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= MAX_QUANTITY;

  const adjustQuantity = (delta: number) => {
    const next = Math.max(1, Math.min(MAX_QUANTITY, parsedQuantity + delta || 1));
    setQuantity(String(next));
  };

  const onGenerate = async () => {
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      Alert.alert("Invalid quantity", "Enter a quantity of at least 1.");
      return;
    }
    if (qty > MAX_QUANTITY) {
      Alert.alert("Invalid quantity", `Maximum batch size is ${MAX_QUANTITY}.`);
      return;
    }
    setGenerating(true);
    setError("");
    try {
      await generateActivationCodes({ countryCode, durationMonths, quantity: qty });
      setGenerateSuccess(true);
      setShowForm(false);
      await loadCodes(true);
    } catch (e: any) {
      setError(String(e?.message || "Failed to generate codes"));
    } finally {
      setGenerating(false);
    }
  };

  const onCopyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Alert.alert("Copied", "Activation code copied to clipboard.");
  };

  const onCopyBatchId = async (batchId: string) => {
    await Clipboard.setStringAsync(batchId);
    Alert.alert("Copied", "Batch ID copied to clipboard.");
  };

  const onShareCode = async (code: string) => {
    try {
      await Share.share({ message: code });
    } catch {
      /* dismissed */
    }
  };

  const toggleCodeExpanded = (codeId: string) => {
    configureExpand();
    setExpandedCodeIds((prev) => ({ ...prev, [codeId]: !prev[codeId] }));
  };

  const previewFormat = `KR-${countryCode}-M${durationMonths}-XXXX-XXXX`;
  const sparkleRotate = sparkleAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "18deg"] });
  const sparkleScale = sparkleAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#0E0A18", BG]} style={StyleSheet.absoluteFillObject} />

      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.88)" />
        </Pressable>
        <Glass pad={10} style={styles.headerGlass}>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.title} numberOfLines={1}>
                Activation Codes
              </Text>
              <Text style={styles.subtitle}>Offline subscription generator</Text>
            </View>
            <View style={styles.headerBadge}>
              <LinearGradient
                colors={["rgba(244,208,111,0.32)", "rgba(156,118,255,0.22)"]}
                style={StyleSheet.absoluteFillObject}
              />
              <MaterialCommunityIcons name="shield-key-outline" size={18} color={GOLD} />
            </View>
          </View>
        </Glass>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!allowed ? (
          <Glass pad={16} style={styles.noticeCard}>
            <Ionicons name="lock-closed-outline" size={22} color={GOLD} />
            <Text style={styles.noticeTitle}>Access restricted</Text>
            <Text style={styles.noticeText}>
              Only System Admin platform role can generate and list activation codes.
            </Text>
          </Glass>
        ) : (
          <>
            <View style={styles.statsGrid}>
              <PremiumStatCard label="Batches" value={totals.batches} icon="albums-outline" color={GOLD} />
              <PremiumStatCard label="Total Codes" value={totals.codes} icon="layers-outline" color="#93C5FD" />
              <PremiumStatCard label="Available" value={totals.available} icon="sparkles-outline" color="#6EE7A8" />
            </View>

            <SpringPress onPress={() => setShowForm((v) => !v)}>
              <View style={styles.toggleGeneratorBtn}>
                <Ionicons name={showForm ? "close-circle-outline" : "add-circle-outline"} size={18} color={GOLD} />
                <Text style={styles.toggleGeneratorText}>
                  {showForm ? "Close generator" : "Open code generator"}
                </Text>
              </View>
            </SpringPress>

            {showForm ? (
              <Animated.View
                style={[
                  styles.generatorCard,
                  {
                    opacity: formAnim,
                    transform: [
                      {
                        translateY: formAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
                      },
                    ],
                  },
                ]}
              >
                <Glass pad={14}>
                  <Text style={styles.generatorTitle}>Code Generator</Text>
                  <Text style={styles.generatorSub}>Configure a secure offline activation batch.</Text>

                  <Text style={styles.fieldLabel}>Country</Text>
                  <View style={styles.countryGrid}>
                    {COUNTRY_CARDS.map((country) => {
                      const selected = countryCode === country.code;
                      return (
                        <Pressable
                          key={country.code}
                          onPress={() => setCountryCode(country.code)}
                          style={[styles.countryCard, selected && styles.countryCardSelected]}
                        >
                          <Text style={styles.countryFlag}>{country.flag}</Text>
                          <Text style={styles.countryName}>{country.name}</Text>
                          <Text style={styles.countryCode}>{country.code}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>Duration</Text>
                  <View style={styles.durationGrid}>
                    {DURATION_CARDS.map((item) => {
                      const selected = durationMonths === item.months;
                      return (
                        <Pressable
                          key={item.months}
                          onPress={() => setDurationMonths(item.months)}
                          style={[styles.durationCard, selected && styles.durationCardSelected]}
                        >
                          <Text style={[styles.durationLabel, selected && styles.durationLabelSelected]}>
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>Quantity</Text>
                  <View style={styles.quantityRow}>
                    <Pressable style={styles.stepperBtn} onPress={() => adjustQuantity(-1)}>
                      <Ionicons name="remove" size={16} color={TEXT} />
                    </Pressable>
                    <TextInput
                      value={quantity}
                      onChangeText={setQuantity}
                      keyboardType="number-pad"
                      placeholder="10"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                      style={styles.quantityInput}
                    />
                    <Pressable style={styles.stepperBtn} onPress={() => adjustQuantity(1)}>
                      <Ionicons name="add" size={16} color={TEXT} />
                    </Pressable>
                  </View>
                  <Text style={styles.helperText}>
                    {quantityValid
                      ? `Generating ${parsedQuantity} code${parsedQuantity === 1 ? "" : "s"}.`
                      : `Enter 1–${MAX_QUANTITY} codes per batch.`}
                  </Text>

                  <Text style={styles.fieldLabel}>Format preview</Text>
                  <View style={styles.formatPreviewBox}>
                    <Ionicons name="code-slash-outline" size={14} color={GOLD} />
                    <Text style={styles.formatPreviewText}>{previewFormat}</Text>
                  </View>

                  <Pressable
                    style={[styles.generateBtn, (generating || !quantityValid) && styles.generateBtnDisabled]}
                    disabled={generating || !quantityValid}
                    onPress={onGenerate}
                  >
                    <LinearGradient
                      colors={generating ? ["#5B45C9", "#4A379F"] : ["#7C5CFF", "#5B45C9"]}
                      style={StyleSheet.absoluteFillObject}
                    />
                    {generating ? (
                      <>
                        <ActivityIndicator color="#fff" />
                        <Text style={styles.generateBtnText}>Generating…</Text>
                        <Animated.View style={{ transform: [{ rotate: sparkleRotate }, { scale: sparkleScale }] }}>
                          <Ionicons name="sparkles" size={16} color={GOLD} />
                        </Animated.View>
                      </>
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={16} color={GOLD} />
                        <Text style={styles.generateBtnText}>Generate codes</Text>
                      </>
                    )}
                  </Pressable>
                </Glass>
              </Animated.View>
            ) : null}

            {generateSuccess ? (
              <Animated.View style={[styles.successBanner, { opacity: successAnim }]}>
                <Ionicons name="checkmark-circle" size={16} color="#6EE7A8" />
                <Text style={styles.successBannerText}>Batch generated successfully</Text>
              </Animated.View>
            ) : null}

            {error ? (
              <Glass pad={10} style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </Glass>
            ) : null}

            {loading ? (
              <View style={styles.shimmerList}>
                <ShimmerBlock height={64} />
                <ShimmerBlock height={100} />
                <ShimmerBlock height={100} />
                <ShimmerBlock height={72} />
              </View>
            ) : (
              <>
                <View style={styles.analyticsRow}>
                  <AnalyticsPill dot="🟢" label="Available" value={codeAnalytics.available} />
                  <AnalyticsPill dot="🟣" label="Assigned" value={codeAnalytics.assigned} />
                  <AnalyticsPill dot="🔴" label="Redeemed" value={codeAnalytics.redeemed} />
                  <AnalyticsPill dot="⚫" label="Expired" value={codeAnalytics.expired} />
                </View>

                <SectionHeader title="Recent batches" count={batches.length} />
                {batches.length === 0 ? (
                  <Glass pad={18} style={styles.emptyCard}>
                    <View style={styles.emptyIcon}>
                      <Ionicons name="archive-outline" size={26} color={GOLD} />
                    </View>
                    <Text style={styles.emptyTitle}>No activation batches yet</Text>
                    <Text style={styles.emptyText}>
                      Generate your first batch to start distributing secure offline codes.
                    </Text>
                    <SpringPress onPress={() => setShowForm(true)}>
                      <View style={styles.emptyCta}>
                        <Text style={styles.emptyCtaText}>Open generator</Text>
                      </View>
                    </SpringPress>
                  </Glass>
                ) : (
                  batches.slice(0, 12).map((batch) => {
                    const usage = batchUsage(batch);
                    return (
                      <Glass key={batch.batchId} pad={10} style={styles.batchCard}>
                        <View style={styles.batchTopRow}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.batchTitle}>
                              {batch.countryCode} · {batch.durationMonths} mo · {batch.quantity} codes
                            </Text>
                            <Text style={styles.batchMeta}>Created {formatDateShort(batch.createdAt)}</Text>
                          </View>
                          <View
                            style={[
                              styles.batchStatusBadge,
                              batch.status === "disabled" && styles.batchStatusBadgeDisabled,
                            ]}
                          >
                            <Text style={styles.batchStatusText}>{batch.status}</Text>
                          </View>
                        </View>
                        <View style={styles.batchGrid}>
                          <View style={styles.batchGridCell}>
                            <Text style={styles.batchGridLabel}>Country</Text>
                            <Text style={styles.batchGridValue}>{batch.countryCode}</Text>
                          </View>
                          <View style={styles.batchGridCell}>
                            <Text style={styles.batchGridLabel}>Duration</Text>
                            <Text style={styles.batchGridValue}>{batch.durationMonths} mo</Text>
                          </View>
                          <View style={styles.batchGridCell}>
                            <Text style={styles.batchGridLabel}>Quantity</Text>
                            <Text style={styles.batchGridValue}>{batch.quantity}</Text>
                          </View>
                          <View style={styles.batchGridCell}>
                            <Text style={styles.batchGridLabel}>Remaining</Text>
                            <Text style={[styles.batchGridValue, { color: "#6EE7A8" }]}>{usage.remaining}</Text>
                          </View>
                          <View style={styles.batchGridCell}>
                            <Text style={styles.batchGridLabel}>Used</Text>
                            <Text style={[styles.batchGridValue, { color: "#FCA5A5" }]}>{usage.used}</Text>
                          </View>
                          <View style={styles.batchGridCell}>
                            <Text style={styles.batchGridLabel}>Generated by</Text>
                            <Text style={styles.batchGridValue} numberOfLines={1}>
                              {String(batch.createdByUserId || "—").slice(0, 10)}
                            </Text>
                          </View>
                        </View>
                        <Pressable style={styles.batchIdRow} onPress={() => onCopyBatchId(batch.batchId)}>
                          <Text style={styles.batchIdLabel}>Batch ID</Text>
                          <Text style={styles.batchIdValue} numberOfLines={1}>
                            {batch.batchId.slice(0, 14)}…
                          </Text>
                          <Ionicons name="copy-outline" size={14} color={GOLD} />
                        </Pressable>
                      </Glass>
                    );
                  })
                )}

                <SectionHeader title="Generated codes" count={filteredCodes.length} />

                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={16} color={MUTED} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search activation code"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    autoCapitalize="characters"
                    style={styles.searchInput}
                  />
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {FILTER_CHIPS.map((chip) => {
                    const active = codeFilter === chip.key;
                    return (
                      <Pressable
                        key={chip.key}
                        onPress={() => setCodeFilter(chip.key)}
                        style={[styles.filterChip, active && styles.filterChipActive]}
                      >
                        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                          {chip.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View style={styles.sortRow}>
                  <Text style={styles.sortLabel}>Sort</Text>
                  <Pressable
                    onPress={() => setCodeSort("newest")}
                    style={[styles.sortChip, codeSort === "newest" && styles.sortChipActive]}
                  >
                    <Text style={[styles.sortChipText, codeSort === "newest" && styles.sortChipTextActive]}>
                      Newest
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCodeSort("oldest")}
                    style={[styles.sortChip, codeSort === "oldest" && styles.sortChipActive]}
                  >
                    <Text style={[styles.sortChipText, codeSort === "oldest" && styles.sortChipTextActive]}>
                      Oldest
                    </Text>
                  </Pressable>
                </View>

                {codes.length === 0 ? (
                  <Glass pad={18} style={styles.emptyCard}>
                    <View style={styles.emptyIcon}>
                      <Ionicons name="ticket-outline" size={26} color={GOLD} />
                    </View>
                    <Text style={styles.emptyTitle}>No generated codes yet</Text>
                    <Text style={styles.emptyText}>
                      Codes from new batches will appear here with status and redemption details.
                    </Text>
                  </Glass>
                ) : filteredCodes.length === 0 ? (
                  <Glass pad={14}>
                    <Text style={styles.emptyText}>No codes match your search or filter.</Text>
                  </Glass>
                ) : (
                  filteredCodes.map((row) => {
                    const expanded = !!expandedCodeIds[row.id];
                    return (
                      <Glass key={row.id} pad={0} style={styles.codeCard}>
                        <Pressable onPress={() => toggleCodeExpanded(row.id)} style={styles.codeHeader}>
                          <View style={styles.codeHeaderMain}>
                            <Text style={styles.codeValue} numberOfLines={1}>
                              {row.code}
                            </Text>
                            <View style={styles.codeHeaderMetaRow}>
                              <StatusBadge status={row.status} />
                              <Text style={styles.codeMetaInline}>
                                {row.countryCode} · {row.durationMonths} mo
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
                            <View style={styles.detailGrid}>
                              <DetailGridRow label="Created Date" value={formatWhen(row.createdAt)} />
                              <DetailGridRow label="Redeemed Date" value={formatWhen(String(row.redeemedAt || ""))} />
                              <DetailGridRow label="Supervisor" value={row.assignedSupervisorUserId || "—"} />
                              <DetailGridRow
                                label="Church"
                                value={row.redeemedByChurchId || row.deliveredToChurchId || "—"}
                              />
                              <DetailGridRow label="Agent" value={row.assignedAgentUserId || "—"} />
                              <DetailGridRow
                                label="Status"
                                badge={<StatusBadge status={row.status} />}
                              />
                            </View>

                            <View style={styles.codeActionRow}>
                              <GlassActionBtn icon="copy-outline" label="Copy" onPress={() => onCopyCode(row.code)} />
                              <GlassActionBtn
                                icon="qr-code-outline"
                                label="QR"
                                onPress={() => setQrModalCode(row)}
                              />
                              <GlassActionBtn
                                icon="share-outline"
                                label="Share"
                                onPress={() => onShareCode(row.code)}
                              />
                            </View>
                          </View>
                        ) : null}
                      </Glass>
                    );
                  })
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={Boolean(qrModalCode)}
        transparent
        animationType="fade"
        onRequestClose={() => setQrModalCode(null)}
      >
        <View style={styles.qrModalBackdrop}>
          <Glass pad={16} style={styles.qrModalCard}>
            {qrModalCode ? (
              <>
                <Text style={styles.qrModalTitle}>Activation QR</Text>
                <View style={styles.qrModalImageWrap}>
                  <Image source={{ uri: qrImageUri(qrModalCode.code) }} style={styles.qrModalImage} />
                </View>
                <Text style={styles.qrModalCode}>{qrModalCode.code}</Text>
                <View style={styles.qrMetaRow}>
                  <Text style={styles.qrMetaText}>{qrModalCode.countryCode}</Text>
                  <Text style={styles.qrMetaDot}>·</Text>
                  <Text style={styles.qrMetaText}>{qrModalCode.durationMonths} months</Text>
                  <Text style={styles.qrMetaDot}>·</Text>
                  <Text style={[styles.qrMetaText, { color: statusColor(qrModalCode.status) }]}>
                    {statusLabel(qrModalCode.status)}
                  </Text>
                </View>
                <View style={styles.qrModalActions}>
                  <Pressable style={styles.qrModalBtnGhost} onPress={() => setQrModalCode(null)}>
                    <Text style={styles.qrModalBtnGhostText}>Close</Text>
                  </Pressable>
                  <Pressable
                    style={styles.qrModalBtnDisabled}
                    onPress={() => Alert.alert("Coming soon", "Download will be available in a future update.")}
                  >
                    <Ionicons name="download-outline" size={14} color={MUTED} />
                    <Text style={styles.qrModalBtnDisabledText}>Download</Text>
                  </Pressable>
                  <Pressable style={styles.qrModalBtnPrimary} onPress={() => onShareCode(qrModalCode.code)}>
                    <Ionicons name="share-outline" size={14} color="#111" />
                    <Text style={styles.qrModalBtnPrimaryText}>Share</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Glass>
        </View>
      </Modal>
    </View>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
      <View style={styles.sectionCountBadge}>
        <Text style={styles.sectionHeaderCount}>{count}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 6,
    gap: 6,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerGlass: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: TEXT, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: "rgba(244,208,111,0.78)", fontSize: 10, fontWeight: "700", marginTop: 1 },
  headerBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.32)",
  },
  content: { paddingHorizontal: 14, paddingTop: 2, gap: 10 },
  glassWrap: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: GLASS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
  glassSheen: {
    position: "absolute",
    top: 0,
    left: 10,
    right: 10,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  statsGrid: { flexDirection: "row", gap: 6 },
  metricCard: {
    flex: 1,
    minHeight: 82,
    borderRadius: 14,
    overflow: "hidden",
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
    backgroundColor: GLASS,
  },
  metricIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  metricValue: { fontSize: 20, fontWeight: "900", lineHeight: 24, fontVariant: ["tabular-nums"] },
  metricLabel: { color: MUTED, fontSize: 9, fontWeight: "700", marginTop: 2, textAlign: "center" },
  toggleGeneratorBtn: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(156,118,255,0.28)",
    backgroundColor: "rgba(156,118,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  toggleGeneratorText: { color: TEXT, fontWeight: "800", fontSize: 13 },
  generatorCard: { borderRadius: 14, overflow: "hidden" },
  generatorTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  generatorSub: { color: MUTED, fontSize: 11, marginBottom: 4 },
  fieldLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 8,
  },
  countryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  countryCard: {
    width: "48%",
    minHeight: 72,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    gap: 2,
  },
  countryCardSelected: { borderColor: "rgba(244,208,111,0.38)", backgroundColor: "rgba(244,208,111,0.06)" },
  countryFlag: { fontSize: 18 },
  countryName: { color: TEXT, fontSize: 12, fontWeight: "800" },
  countryCode: { color: MUTED, fontSize: 10, fontWeight: "700" },
  durationGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  durationCard: {
    width: "48%",
    minHeight: 44,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    justifyContent: "center",
  },
  durationCardSelected: { borderColor: "rgba(156,118,255,0.42)", backgroundColor: "rgba(156,118,255,0.08)" },
  durationLabel: { color: MUTED, fontSize: 12, fontWeight: "800" },
  durationLabelSelected: { color: TEXT },
  quantityRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  quantityInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: TEXT,
    backgroundColor: "rgba(255,255,255,0.03)",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  helperText: { color: MUTED, fontSize: 10, lineHeight: 14 },
  formatPreviewBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.18)",
  },
  formatPreviewText: { color: GOLD, fontSize: 12, fontWeight: "800", flex: 1, letterSpacing: 0.4 },
  generateBtn: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 12,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  generateBtnDisabled: { opacity: 0.72 },
  generateBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(110,231,168,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(110,231,168,0.22)",
  },
  successBannerText: { color: "#6EE7A8", fontWeight: "800", fontSize: 12 },
  errorCard: { borderColor: "rgba(248,113,113,0.22)" },
  errorText: { color: "#FCA5A5", fontSize: 12 },
  shimmerList: { gap: 8 },
  shimmer: {
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
  },
  analyticsRow: { flexDirection: "row", gap: 5 },
  analyticsPill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
    gap: 1,
  },
  analyticsDot: { fontSize: 8 },
  analyticsValue: { color: TEXT, fontSize: 13, fontWeight: "800" },
  analyticsLabel: { color: MUTED, fontSize: 8, fontWeight: "700" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  sectionHeaderTitle: { color: TEXT, fontSize: 14, fontWeight: "800" },
  sectionCountBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.22)",
  },
  sectionHeaderCount: { color: GOLD, fontSize: 11, fontWeight: "900" },
  batchCard: { gap: 8 },
  batchTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  batchTitle: { color: TEXT, fontSize: 13, fontWeight: "800" },
  batchMeta: { color: MUTED, fontSize: 10 },
  batchStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(110,231,168,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(110,231,168,0.22)",
  },
  batchStatusBadgeDisabled: {
    backgroundColor: "rgba(252,165,165,0.08)",
    borderColor: "rgba(252,165,165,0.22)",
  },
  batchStatusText: { color: TEXT, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  batchGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  batchGridCell: {
    width: "31%",
    flexGrow: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
    gap: 2,
  },
  batchGridLabel: { color: MUTED, fontSize: 9, fontWeight: "700" },
  batchGridValue: { color: TEXT, fontSize: 11, fontWeight: "800" },
  batchIdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_BORDER,
  },
  batchIdLabel: { color: MUTED, fontSize: 10, fontWeight: "700" },
  batchIdValue: { flex: 1, color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "600" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
  },
  searchInput: { flex: 1, color: TEXT, fontSize: 13, padding: 0 },
  filterRow: { gap: 6, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
  },
  filterChipActive: {
    backgroundColor: "rgba(244,208,111,0.12)",
    borderColor: "rgba(244,208,111,0.28)",
  },
  filterChipText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  filterChipTextActive: { color: GOLD },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sortLabel: { color: MUTED, fontSize: 10, fontWeight: "700", marginRight: 2 },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
  },
  sortChipActive: { borderColor: "rgba(244,208,111,0.28)", backgroundColor: "rgba(244,208,111,0.08)" },
  sortChipText: { color: MUTED, fontSize: 10, fontWeight: "700" },
  sortChipTextActive: { color: GOLD },
  codeCard: { overflow: "hidden" },
  codeHeader: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  codeHeaderMain: { flex: 1, minWidth: 0, gap: 4 },
  codeValue: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  codeHeaderMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  statusDot: { width: 5, height: 5, borderRadius: 999 },
  statusBadgeText: { fontSize: 9, fontWeight: "800" },
  codeMetaInline: { color: MUTED, fontSize: 10, fontWeight: "600" },
  codeExpanded: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_BORDER,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  detailGrid: {
    gap: 6,
    padding: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
  },
  detailGridRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 22,
  },
  detailGridLabel: {
    width: "42%",
    color: MUTED,
    fontSize: 10,
    fontWeight: "600",
  },
  detailGridValueWrap: { flex: 1, alignItems: "flex-end" },
  detailGridValue: {
    flex: 1,
    color: "rgba(255,255,255,0.82)",
    fontSize: 10,
    fontWeight: "700",
    textAlign: "right",
  },
  codeActionRow: { flexDirection: "row", gap: 6 },
  glassActionBtn: {
    minHeight: 32,
    borderRadius: 9,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.16)",
    backgroundColor: "rgba(244,208,111,0.06)",
  },
  glassActionText: { color: GOLD, fontSize: 10, fontWeight: "800" },
  emptyCard: { alignItems: "center", gap: 6 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,208,111,0.18)",
  },
  emptyTitle: { color: TEXT, fontSize: 15, fontWeight: "800", textAlign: "center" },
  emptyText: { color: MUTED, fontSize: 11, textAlign: "center", lineHeight: 16 },
  emptyCta: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  emptyCtaText: { color: "#07111F", fontWeight: "900", fontSize: 12 },
  noticeCard: { alignItems: "center", gap: 8 },
  noticeTitle: { color: TEXT, fontSize: 15, fontWeight: "800" },
  noticeText: { color: MUTED, fontSize: 12, textAlign: "center", lineHeight: 17 },
  qrModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "center",
    padding: 24,
  },
  qrModalCard: { alignItems: "center", gap: 10 },
  qrModalTitle: { color: TEXT, fontSize: 16, fontWeight: "800", alignSelf: "flex-start" },
  qrModalImageWrap: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#fff",
  },
  qrModalImage: { width: 200, height: 200 },
  qrModalCode: { color: TEXT, fontSize: 13, fontWeight: "800", letterSpacing: 0.4 },
  qrMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  qrMetaText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  qrMetaDot: { color: MUTED, fontSize: 11 },
  qrModalActions: { flexDirection: "row", gap: 8, marginTop: 4, alignSelf: "stretch" },
  qrModalBtnGhost: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
  },
  qrModalBtnGhostText: { color: MUTED, fontWeight: "700", fontSize: 12 },
  qrModalBtnDisabled: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_BORDER,
  },
  qrModalBtnDisabledText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  qrModalBtnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: GOLD,
  },
  qrModalBtnPrimaryText: { color: "#111", fontSize: 11, fontWeight: "800" },
});
