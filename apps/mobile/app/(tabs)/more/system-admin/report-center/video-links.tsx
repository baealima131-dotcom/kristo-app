import React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import {
  DEFAULT_KRISTO_COUNTRY,
  filterKristoCountries,
  KRISTO_COUNTRIES,
  type KristoCountry,
} from "@/src/lib/countries";
import {
  fetchSystemAdminVideoMetadata,
  type SystemAdminVideoMetadata,
} from "@/src/lib/systemAdminVideoLinksApi";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.60)";
const GOLD = "#F4D06F";
const PURPLE = "#A78BFA";
const BLUE = "#93C5FD";
const GREEN = "#6EE7B7";
const RED = "#FB7185";

function isSupportedVideoLink(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
      const id =
        host === "youtu.be"
          ? url.pathname.split("/").filter(Boolean)[0] || ""
          : url.pathname === "/watch"
            ? url.searchParams.get("v") || ""
            : url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id);
    }
    return (
      (host === "tiktok.com" || host === "m.tiktok.com") &&
      /^\/@[A-Za-z0-9._-]+\/video\/\d+(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function displayCount(value: number | null | undefined) {
  if (value == null) return "Haipatikani";
  if (value < 1000) return String(value);
  try {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(value);
  }
}

function GlassCard({ children, style, borderColor = "rgba(255,255,255,0.13)" }: any) {
  return (
    <View style={[styles.glassCard, { borderColor }, style]}>
      {children}
    </View>
  );
}

export default function SystemAdminVideoLinksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = React.useState("");
  const [metadata, setMetadata] = React.useState<SystemAdminVideoMetadata | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [country, setCountry] = React.useState<KristoCountry>(DEFAULT_KRISTO_COUNTRY);
  const [countryPickerVisible, setCountryPickerVisible] = React.useState(false);
  const [countrySearch, setCountrySearch] = React.useState("");
  const requestId = React.useRef(0);

  const lookup = React.useCallback(async (value: string) => {
    const clean = value.trim();
    if (!isSupportedVideoLink(clean)) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    setMetadata(null);
    try {
      const result = await fetchSystemAdminVideoMetadata(clean);
      if (requestId.current === currentRequest) setMetadata(result);
    } catch (cause: any) {
      if (requestId.current === currentRequest) {
        setError(String(cause?.message || "Taarifa za video hazikupatikana."));
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const clean = url.trim();
    if (!clean) {
      requestId.current += 1;
      setMetadata(null);
      setError("");
      setLoading(false);
      return;
    }
    if (!isSupportedVideoLink(clean)) {
      requestId.current += 1;
      setMetadata(null);
      setLoading(false);
      setError("");
      return;
    }
    const timer = setTimeout(() => void lookup(clean), 650);
    return () => clearTimeout(timer);
  }, [url, lookup]);

  const openSafeLink = React.useCallback(async (target: string | null | undefined) => {
    if (!target) return;
    try {
      const parsed = new URL(target);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const allowedHost = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "tiktok.com", "m.tiktok.com"].includes(host);
      if (parsed.protocol !== "https:" || !allowedHost || parsed.username || parsed.password) {
        Alert.alert("Link haikubaliki", "Tumia link salama ya YouTube au TikTok.");
        return;
      }
      await Linking.openURL(parsed.toString());
    } catch {
      Alert.alert("Imeshindikana kufungua", "Jaribu tena baada ya muda mfupi.");
    }
  }, []);

  const filteredCountries = React.useMemo(
    () => filterKristoCountries(countrySearch).slice(0, 80),
    [countrySearch]
  );

  const stats = [
    { label: "Mionekano", value: metadata ? displayCount(metadata.stats.views) : "—", icon: "eye-outline" as const, color: BLUE },
    { label: "Likes", value: metadata ? displayCount(metadata.stats.likes) : "—", icon: "heart-outline" as const, color: RED },
    { label: "Maoni", value: metadata ? displayCount(metadata.stats.comments) : "—", icon: "chatbubble-ellipses-outline" as const, color: GREEN },
  ];

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#1D143B", "#111321", "#090D16", BG]}
        locations={[0, 0.28, 0.64, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Rudi">
          <Ionicons name="chevron-back" size={25} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>SYSTEM ADMIN • REPORT CENTER</Text>
          <Text style={styles.title}>Video Link</Text>
          <Text style={styles.subtitle}>Bandika link; taarifa zitajazwa zenyewe.</Text>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: insets.bottom + 32 }}
      >
        <GlassCard style={styles.countryCard} borderColor="rgba(244,208,111,0.25)">
          <View style={styles.row}>
            <View style={styles.countryIcon}><Ionicons name="globe-outline" size={21} color={GOLD} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Nchi ya video</Text>
              <Text style={styles.helper}>Chagua nchi itakayotumika kuainisha video.</Text>
            </View>
            <Pressable onPress={() => setCountryPickerVisible(true)} style={styles.countryButton}>
              <Text style={styles.countryValue}>{country.flag}  {country.name}</Text>
              <Ionicons name="chevron-down" size={17} color={GOLD} />
            </Pressable>
          </View>
        </GlassCard>

        <GlassCard style={styles.linkCard} borderColor="rgba(167,139,250,0.30)">
          <Text style={styles.sectionTitle}>Bandika link ya video</Text>
          <Text style={styles.helper}>YouTube au TikTok. Taarifa huanza kujazwa link ikishabandikwa.</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://youtu.be/... au https://www.tiktok.com/..."
            placeholderTextColor="rgba(255,255,255,0.36)"
            style={styles.urlInput}
            accessibilityLabel="Bandika link ya YouTube au TikTok"
          />
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={GOLD} />
              <Text style={styles.loadingText}>Inatafuta taarifa za video…</Text>
            </View>
          ) : null}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color={RED} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {!metadata && !loading && !error ? (
            <Text style={styles.securityHint}>Link salama za YouTube na TikTok pekee ndizo zinakubaliwa.</Text>
          ) : null}
        </GlassCard>

        {metadata ? (
          <GlassCard style={styles.previewCard} borderColor="rgba(110,231,183,0.28)">
            <View style={styles.providerPill}>
              <Ionicons name={metadata.provider === "youtube" ? "logo-youtube" : "musical-notes"} size={15} color={metadata.provider === "youtube" ? "#FF7777" : "#C4B5FD"} />
              <Text style={styles.providerText}>{metadata.provider === "youtube" ? "YouTube" : "TikTok"}</Text>
              <View style={styles.autoBadge}><Ionicons name="checkmark-circle" size={14} color={GREEN} /><Text style={styles.autoBadgeText}>TAARIFA ZIMEJAZWA</Text></View>
            </View>

            {metadata.thumbnailUrl ? (
              <Image source={{ uri: metadata.thumbnailUrl }} style={styles.thumbnail} resizeMode="cover" />
            ) : null}

            <Text style={styles.videoTitle}>{metadata.title || "Video bila kichwa"}</Text>

            <View style={styles.creatorRow}>
              {metadata.creatorAvatarUrl ? (
                <Image source={{ uri: metadata.creatorAvatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}><Ionicons name="person-outline" size={19} color={BLUE} /></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.creatorCaption}>Akaunti ya mwenye video</Text>
                <Text style={styles.creatorName}>{metadata.creatorName || "Akaunti haikupatikana"}</Text>
              </View>
              {metadata.creatorProfileUrl ? (
                <Pressable onPress={() => void openSafeLink(metadata.creatorProfileUrl)} style={styles.profileButton}>
                  <Text style={styles.profileButtonText}>Profile</Text>
                  <Ionicons name="open-outline" size={14} color={BLUE} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={16} color={GOLD} />
              <Text style={styles.dateLabel}>Tarehe ya kuchapishwa</Text>
              <Text style={styles.dateValue}>
                {metadata.publishedAt ? new Date(metadata.publishedAt).toLocaleDateString() : "Haipatikani kwa API"}
              </Text>
            </View>

            <View style={styles.statsRow}>
              {stats.map((item) => (
                <View key={item.label} style={styles.statBox}>
                  <Ionicons name={item.icon} size={17} color={item.color} />
                  <Text style={styles.statValue}>{item.value}</Text>
                  <Text style={styles.statLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            {metadata.provider === "tiktok" ? (
              <Text style={styles.apiNote}>TikTok imetoa kichwa na akaunti kupitia oEmbed. Tarehe na takwimu zake hazipatikani kwa njia hii.</Text>
            ) : null}

            <Pressable onPress={() => void openSafeLink(metadata.url)} style={({ pressed }) => [styles.openButton, pressed && { opacity: 0.8 }]}>
              <Ionicons name="open-outline" size={18} color="#0B1020" />
              <Text style={styles.openButtonText}>Fungua video kwenye {metadata.provider === "youtube" ? "YouTube" : "TikTok"}</Text>
            </Pressable>
            <Text style={styles.countryFooter}>Nchi iliyochaguliwa: {country.flag} {country.name}</Text>
          </GlassCard>
        ) : null}
      </ScrollView>

      <Modal visible={countryPickerVisible} animationType="slide" transparent onRequestClose={() => setCountryPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.countryModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Chagua nchi</Text>
              <Pressable onPress={() => setCountryPickerVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={25} color={TEXT} />
              </Pressable>
            </View>
            <TextInput
              value={countrySearch}
              onChangeText={setCountrySearch}
              placeholder="Tafuta nchi…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.searchInput}
              autoCorrect={false}
            />
            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={18}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setCountry(item);
                    setCountryPickerVisible(false);
                    setCountrySearch("");
                  }}
                  style={styles.countryOption}
                >
                  <Text style={styles.countryFlag}>{item.flag}</Text>
                  <Text style={styles.countryName}>{item.name}</Text>
                  <Text style={styles.countryCode}>{item.code}</Text>
                  {item.code === country.code ? <Ionicons name="checkmark" size={18} color={GOLD} /> : null}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  backButton: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  eyebrow: { color: GOLD, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  title: { marginTop: 2, color: TEXT, fontSize: 26, lineHeight: 32, fontWeight: "900" },
  subtitle: { marginTop: 1, color: MUTED, fontSize: 12, fontWeight: "600" },
  glassCard: { overflow: "hidden", borderRadius: 20, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.055)", padding: 16 },
  countryCard: { marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 11 },
  countryIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,208,111,0.12)" },
  label: { color: TEXT, fontSize: 13, fontWeight: "800" },
  helper: { marginTop: 4, color: MUTED, fontSize: 11, lineHeight: 16, fontWeight: "600" },
  countryButton: { maxWidth: 165, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 13, backgroundColor: "rgba(244,208,111,0.10)", borderWidth: 1, borderColor: "rgba(244,208,111,0.23)" },
  countryValue: { color: "#FFF3C4", fontSize: 11, fontWeight: "800", flexShrink: 1 },
  linkCard: { marginBottom: 13 },
  sectionTitle: { color: TEXT, fontSize: 16, fontWeight: "900" },
  urlInput: { minHeight: 52, marginTop: 13, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: "rgba(167,139,250,0.30)", backgroundColor: "rgba(0,0,0,0.20)", color: TEXT, fontSize: 13 },
  loadingRow: { marginTop: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  loadingText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  errorBox: { marginTop: 13, padding: 11, borderRadius: 12, flexDirection: "row", gap: 8, backgroundColor: "rgba(251,113,133,0.08)" },
  errorText: { flex: 1, color: "#FDA4AF", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  securityHint: { marginTop: 10, color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 15, fontWeight: "600" },
  previewCard: { marginTop: 2 },
  providerPill: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  providerText: { color: TEXT, fontSize: 12, fontWeight: "900" },
  autoBadge: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4 },
  autoBadgeText: { color: GREEN, fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  thumbnail: { width: "100%", height: 190, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)" },
  videoTitle: { marginTop: 13, color: TEXT, fontSize: 18, lineHeight: 24, fontWeight: "900" },
  creatorRow: { marginTop: 15, flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(147,197,253,0.12)", borderWidth: 1, borderColor: "rgba(147,197,253,0.23)" },
  creatorCaption: { color: MUTED, fontSize: 10, fontWeight: "700" },
  creatorName: { marginTop: 3, color: TEXT, fontSize: 13, fontWeight: "900" },
  profileButton: { flexDirection: "row", alignItems: "center", gap: 5, padding: 9, borderRadius: 11, backgroundColor: "rgba(147,197,253,0.08)" },
  profileButtonText: { color: BLUE, fontSize: 11, fontWeight: "800" },
  dateRow: { marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderColor: "rgba(255,255,255,0.08)", flexDirection: "row", alignItems: "center", gap: 7 },
  dateLabel: { color: MUTED, flex: 1, fontSize: 11, fontWeight: "700" },
  dateValue: { color: TEXT, fontSize: 11, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  statBox: { flex: 1, minHeight: 74, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.045)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  statValue: { color: TEXT, fontSize: 13, fontWeight: "900" },
  statLabel: { color: MUTED, fontSize: 9, fontWeight: "700" },
  apiNote: { marginTop: 11, color: "rgba(255,255,255,0.48)", fontSize: 10, lineHeight: 15, fontWeight: "600" },
  openButton: { marginTop: 15, minHeight: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GOLD },
  openButtonText: { color: "#0B1020", fontSize: 13, fontWeight: "900" },
  countryFooter: { marginTop: 10, textAlign: "center", color: MUTED, fontSize: 10, fontWeight: "700" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.66)" },
  countryModal: { maxHeight: "82%", paddingTop: 16, paddingHorizontal: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "#111521", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: TEXT, fontSize: 18, fontWeight: "900" },
  searchInput: { minHeight: 46, marginTop: 12, marginBottom: 8, paddingHorizontal: 12, borderRadius: 13, color: TEXT, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  countryOption: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.07)" },
  countryFlag: { fontSize: 19, width: 28 },
  countryName: { flex: 1, color: TEXT, fontSize: 13, fontWeight: "700" },
  countryCode: { color: MUTED, fontSize: 11, fontWeight: "700" },
});
