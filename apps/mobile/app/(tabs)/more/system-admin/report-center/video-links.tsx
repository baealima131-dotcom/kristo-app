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
import { WebView } from "react-native-webview";
import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";

import {
  DEFAULT_KRISTO_COUNTRY,
  filterKristoCountries,
  type KristoCountry,
} from "@/src/lib/countries";
import {
  fetchSavedSystemAdminVideoLinks,
  fetchSystemAdminVideoMetadata,
  publishSystemAdminVideoLink,
  setSystemAdminVideoLinkHidden,
  deleteSystemAdminVideoLink,
  type SavedSystemAdminVideoLink,
  type SystemAdminVideoMetadata,
} from "@/src/lib/systemAdminVideoLinksApi";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.60)";
const GOLD = "#F4D06F";
const BLUE = "#93C5FD";
const GREEN = "#6EE7B7";
const RED = "#FB7185";

const VIDEO_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "sw", name: "Kiswahili" },
  { code: "rn", name: "Kirundi" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "pt", name: "Português" },
  { code: "ar", name: "العربية" },
  { code: "ln", name: "Lingála" },
  { code: "rw", name: "Kinyarwanda" },
  { code: "am", name: "አማርኛ" },
] as const;
type VideoLanguage = (typeof VIDEO_LANGUAGES)[number];

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


function buildVideoEmbedUrl(provider: "youtube" | "tiktok", value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (provider === "youtube" && ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
      const videoId = host === "youtu.be"
        ? parsed.pathname.split("/").filter(Boolean)[0] || ""
        : parsed.pathname === "/watch"
          ? parsed.searchParams.get("v") || ""
          : parsed.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(videoId)
        ? `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&controls=1&rel=0&autoplay=0`
        : null;
    }
    if (provider === "tiktok" && ["tiktok.com", "m.tiktok.com"].includes(host)) {
      const videoId = parsed.pathname.match(/^\/@[A-Za-z0-9._-]+\/video\/(\d+)(?:\/|$)/)?.[1] || "";
      return /^\d{8,24}$/.test(videoId)
        ? `https://www.tiktok.com/player/v1/${videoId}?controls=1&description=1&music_info=1&autoplay=0&loop=0`
        : null;
    }
  } catch {}
  return null;
}

function allowVideoEmbedNavigation(request: { url: string; isTopFrame?: boolean }) {
  if (request.isTopFrame === false) return true;
  try {
    const next = new URL(request.url);
    if (next.protocol !== "https:") return false;
    const host = next.hostname.toLowerCase().replace(/^www\./, "");
    return ["youtube.com", "youtube-nocookie.com", "youtu.be", "tiktok.com", "m.tiktok.com"].includes(host);
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
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");
  const [url, setUrl] = React.useState("");
  const [metadata, setMetadata] = React.useState<SystemAdminVideoMetadata | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [published, setPublished] = React.useState(false);
  const [error, setError] = React.useState("");
  const [country, setCountry] = React.useState<KristoCountry>(DEFAULT_KRISTO_COUNTRY);
  const [countryPickerVisible, setCountryPickerVisible] = React.useState(false);
  const [countrySearch, setCountrySearch] = React.useState("");
  const [language, setLanguage] = React.useState<VideoLanguage | null>(null);
  const [languagePickerVisible, setLanguagePickerVisible] = React.useState(false);
  const [languageSearch, setLanguageSearch] = React.useState("");
  const [savedLinks, setSavedLinks] = React.useState<SavedSystemAdminVideoLink[]>([]);
  const [savedLinksError, setSavedLinksError] = React.useState("");
  const [savedAccountsOpen, setSavedAccountsOpen] = React.useState(false);
  const [expandedAccountKey, setExpandedAccountKey] = React.useState("");
  const [updatingSavedLinkId, setUpdatingSavedLinkId] = React.useState("");
  const requestId = React.useRef(0);

  const lookup = React.useCallback(async (value: string) => {
    setPublished(false);
    const clean = value.trim();
    if (!allowed || !isSupportedVideoLink(clean)) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    setMetadata(null);
    try {
      const result = await fetchSystemAdminVideoMetadata(clean);
      if (requestId.current === currentRequest) {
        setMetadata(result);
        const detectedCode = String(result.detectedLanguageCode || "").toLowerCase().split("-")[0];
        const detected = VIDEO_LANGUAGES.find((item) => item.code === detectedCode);
        if (detected) setLanguage(detected);
      }
    } catch (cause: any) {
      if (requestId.current === currentRequest) {
        setError(String(cause?.message || "Taarifa za video hazikupatikana."));
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [allowed]);

  React.useEffect(() => {
    if (!allowed) {
      requestId.current += 1;
      setLoading(false);
      return;
    }
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
  }, [allowed, url, lookup]);

  const refreshSavedLinks = React.useCallback(async () => {
    try {
      const links = await fetchSavedSystemAdminVideoLinks();
      setSavedLinks(links);
      setSavedLinksError("");
    } catch (cause: any) {
      setSavedLinksError(String(cause?.message || "Video zilizohifadhiwa hazikupatikana."));
    }
  }, []);

  React.useEffect(() => {
    if (allowed) void refreshSavedLinks();
  }, [allowed, refreshSavedLinks]);

  const toggleSavedLinkVisibility = React.useCallback(async (link: SavedSystemAdminVideoLink) => {
    if (updatingSavedLinkId) return;
    setUpdatingSavedLinkId(link.id);
    setSavedLinksError("");
    try {
      await setSystemAdminVideoLinkHidden(link.id, !link.hidden);
      setSavedLinks((current) => current.map((item) => item.id === link.id ? { ...item, hidden: !link.hidden } : item));
    } catch (cause: any) {
      setSavedLinksError(String(cause?.message || "Hali ya video haikubadilishwa."));
    } finally {
      setUpdatingSavedLinkId("");
    }
  }, [updatingSavedLinkId]);

  const confirmDeleteSavedLink = React.useCallback((link: SavedSystemAdminVideoLink) => {
    Alert.alert(
      "Ondoa video kwenye Kristo App?",
      "Video itaondolewa kwenye Home Feed na orodha hii. Video yenyewe itaendelea kuwepo YouTube au TikTok.",
      [
        { text: "Ghairi", style: "cancel" },
        {
          text: "Ondoa video",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (updatingSavedLinkId) return;
              setUpdatingSavedLinkId(link.id);
              setSavedLinksError("");
              try {
                await deleteSystemAdminVideoLink(link.id);
                setSavedLinks((current) => current.filter((item) => item.id !== link.id));
              } catch (cause: any) {
                setSavedLinksError(String(cause?.message || "Video haikuondolewa."));
              } finally {
                setUpdatingSavedLinkId("");
              }
            })();
          },
        },
      ]
    );
  }, [updatingSavedLinkId]);

  const savedAccounts = React.useMemo(() => {
    const grouped = new Map<string, { key: string; creatorName: string; creatorProfileUrl: string; creatorAvatarUrl: string; provider: string; links: SavedSystemAdminVideoLink[] }>();
    for (const link of savedLinks) {
      const key = link.creatorId || link.creatorProfileUrl || `${link.provider}:${link.creatorName.toLowerCase()}`;
      const existing = grouped.get(key);
      if (existing) existing.links.push(link);
      else grouped.set(key, {
        key,
        creatorName: link.creatorName || "Akaunti isiyojulikana",
        creatorProfileUrl: link.creatorProfileUrl,
        creatorAvatarUrl: link.creatorAvatarUrl,
        provider: link.provider,
        links: [link],
      });
    }
    return Array.from(grouped.values());
  }, [savedLinks]);

  const publishToHomeFeed = React.useCallback(async () => {
    if (!metadata || !language || !url.trim() || publishing) return;
    setPublishing(true);
    setError("");
    try {
      await publishSystemAdminVideoLink(
        url.trim(),
        { code: country.code, name: country.name },
        { code: language.code, name: language.name }
      );
      setPublished(true);
      await refreshSavedLinks();
    } catch (cause: any) {
      setError(String(cause?.message || "Video haikuongezwa kwenye Home Feed."));
    } finally {
      setPublishing(false);
    }
  }, [country.code, country.name, language, metadata, publishing, refreshSavedLinks, url]);

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
  const filteredLanguages = React.useMemo(
    () => VIDEO_LANGUAGES.filter((item) => item.name.toLowerCase().includes(languageSearch.trim().toLowerCase())),
    [languageSearch]
  );

  const stats = [
    { label: "Mionekano", value: metadata ? displayCount(metadata.stats.views) : "—", icon: "eye-outline" as const, color: BLUE },
    { label: "Likes", value: metadata ? displayCount(metadata.stats.likes) : "—", icon: "heart-outline" as const, color: RED },
    { label: "Maoni", value: metadata ? displayCount(metadata.stats.comments) : "—", icon: "chatbubble-ellipses-outline" as const, color: GREEN },
  ];


  if (!allowed) {
    return (
      <View style={styles.screen}>
        <LinearGradient
          colors={["#1D143B", "#111321", "#090D16", BG]}
          locations={[0, 0.28, 0.64, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={{ paddingTop: insets.top + 28, paddingHorizontal: 18 }}>
          <GlassCard style={{ padding: 24, alignItems: "center" }}>
            <Ionicons name="lock-closed-outline" size={28} color={GOLD} />
            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Ufikiaji umezuiwa</Text>
            <Text style={[styles.helper, { marginTop: 7, textAlign: "center" }]}>
              Sehemu ya Video Link inapatikana kwa System Admin pekee.
            </Text>
            <Pressable onPress={() => router.back()} style={styles.openButton}>
              <Text style={styles.openButtonText}>Rudi Report Center</Text>
            </Pressable>
          </GlassCard>
        </View>
      </View>
    );
  }

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
        <LinearGradient
          colors={["rgba(66,43,102,0.92)", "rgba(24,27,43,0.97)", "rgba(13,20,31,0.98)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.studioHero}
        >
          <View style={styles.heroTopline}>
            <View style={styles.heroMark}><Ionicons name="musical-notes" size={19} color={GOLD} /></View>
            <View style={styles.heroHeading}>
              <Text style={styles.heroEyebrow}>KRISTO MEDIA STUDIO</Text>
              <Text style={styles.heroTitle}>Video publishing desk</Text>
            </View>
            <View style={styles.studioStatus}><View style={styles.statusDot} /><Text style={styles.studioStatusText}>STUDIO</Text></View>
          </View>
          <Text style={styles.heroCopy}>Tayarisha video ya Kristo App: chagua hadhira, kagua taarifa, kisha ichapishe kwenye Home Feed.</Text>
          <View style={styles.heroDivider} />
          <View style={styles.heroFoot}>
            <View style={styles.heroFeature}><Ionicons name="sparkles-outline" size={14} color={GOLD} /><Text style={styles.heroFeatureText}>SMART METADATA</Text></View>
            <View style={styles.heroFeature}><Ionicons name="play-circle-outline" size={14} color={BLUE} /><Text style={styles.heroFeatureText}>IN-APP PREVIEW</Text></View>
          </View>
          <View pointerEvents="none" style={styles.heroGlow} />
        </LinearGradient>
        <GlassCard style={styles.savedAccountsCard} borderColor="rgba(147,197,253,0.2)">
          <Pressable style={styles.savedAccountsHeading} onPress={() => setSavedAccountsOpen((value) => !value)}>
            <View style={styles.countryIcon}><Ionicons name="albums-outline" size={21} color={BLUE} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Akaunti zilizohifadhiwa</Text>
              <Text style={styles.helper}>{savedAccounts.length} channel/account • {savedLinks.length} video link</Text>
            </View>
            <Ionicons name={savedAccountsOpen ? "chevron-up" : "chevron-down"} size={18} color={BLUE} />
          </Pressable>
          {savedAccountsOpen ? (
            <View style={styles.savedAccountsList}>
              {savedLinksError ? <Text style={styles.savedError}>{savedLinksError}</Text> : null}
              {savedAccounts.map((account) => (
                <View key={account.key} style={styles.savedAccountBlock}>
                  <Pressable
                    style={styles.savedAccountRow}
                    onPress={() => setExpandedAccountKey((current) => current === account.key ? "" : account.key)}
                  >
                    {account.creatorAvatarUrl ? (
                      <Image source={{ uri: account.creatorAvatarUrl }} style={styles.savedAvatar} />
                    ) : <View style={[styles.savedAvatar, styles.savedAvatarFallback]}><Ionicons name="person-outline" size={16} color={BLUE} /></View>}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.savedAccountName} numberOfLines={1}>{account.creatorName}</Text>
                      <Text style={styles.savedAccountHint}>{account.provider === "youtube" ? "YouTube" : "TikTok"} • {account.links.length} link</Text>
                    </View>
                    <Ionicons name={expandedAccountKey === account.key ? "chevron-up" : "chevron-down"} size={16} color={MUTED} />
                  </Pressable>
                  {expandedAccountKey === account.key ? (
                    <View style={styles.savedLinksList}>
                      {account.creatorProfileUrl ? (
                        <Pressable onPress={() => void openSafeLink(account.creatorProfileUrl)} style={styles.savedProfileButton}>
                          <Ionicons name="person-circle-outline" size={16} color={BLUE} />
                          <Text style={styles.savedProfileText}>Fungua profile ya channel</Text>
                        </Pressable>
                      ) : null}
                      {account.links.map((link) => (
                        <View key={link.id} style={styles.savedLinkBlock}>
                          <Pressable onPress={() => void openSafeLink(link.url)} style={styles.savedLinkRow}>
                            <Ionicons name="play-circle-outline" size={17} color={GOLD} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.savedLinkTitle} numberOfLines={2}>{link.title || "Video bila kichwa"}</Text>
                              <Text style={styles.savedLinkHint} numberOfLines={1}>{[link.countryName, link.languageName, link.publishedAt ? new Date(link.publishedAt).toLocaleDateString() : ""].filter(Boolean).join(" • ")}</Text>
                            </View>
                            <Ionicons name="open-outline" size={15} color={MUTED} />
                          </Pressable>
                          <View style={styles.savedLinkActions}>
                            <Pressable
                              onPress={() => void toggleSavedLinkVisibility(link)}
                              disabled={Boolean(updatingSavedLinkId)}
                              style={styles.savedLinkAction}
                              accessibilityRole="button"
                              accessibilityLabel={link.hidden ? "Onyesha video kwenye Home Feed" : "Ficha video kwenye Home Feed"}
                            >
                              {updatingSavedLinkId === link.id ? (
                                <ActivityIndicator size="small" color={BLUE} />
                              ) : (
                                <Ionicons name={link.hidden ? "eye-outline" : "eye-off-outline"} size={14} color={BLUE} />
                              )}
                              <Text style={styles.savedLinkActionText}>{link.hidden ? "Onyesha" : "Ficha"}</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => confirmDeleteSavedLink(link)}
                              disabled={Boolean(updatingSavedLinkId)}
                              style={styles.savedLinkAction}
                              accessibilityRole="button"
                              accessibilityLabel="Ondoa video kwenye Kristo App"
                            >
                              <Ionicons name="trash-outline" size={14} color={RED} />
                              <Text style={[styles.savedLinkActionText, { color: RED }]}>Ondoa</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
              {!savedAccounts.length && !savedLinksError ? <Text style={styles.helper}>Bado hujahifadhi video yoyote.</Text> : null}
            </View>
          ) : null}
        </GlassCard>

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

        <GlassCard style={styles.languageCard} borderColor="rgba(147,197,253,0.22)">
          <View style={styles.row}>
            <View style={styles.countryIcon}><Ionicons name="language-outline" size={21} color={BLUE} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Lugha ya video</Text>
              <Text style={styles.helper}>Chagua lugha kuu ili video zipatikane kwa urahisi.</Text>
            </View>
            <Pressable onPress={() => setLanguagePickerVisible(true)} style={styles.languageButton}>
              <Text style={styles.languageValue} numberOfLines={1}>{language?.name || "Chagua lugha"}</Text>
              <Ionicons name="chevron-down" size={17} color={BLUE} />
            </Pressable>
          </View>
        </GlassCard>

        <GlassCard style={styles.linkCard} borderColor="rgba(167,139,250,0.30)">
          <Text style={styles.sectionTitle}>Bandika link ya video</Text>
          <Text style={styles.helper}>YouTube au TikTok. Taarifa huanza kujazwa link ikishabandikwa.</Text>
          <TextInput
            value={url}
            onChangeText={(value) => { setUrl(value); setMetadata(null); setLanguage(null); setPublished(false); setError(""); }}
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

            <View style={styles.thumbnail}>
              {buildVideoEmbedUrl(metadata.provider, metadata.url) ? (
                <WebView
                  key={metadata.url}
                  source={{ uri: buildVideoEmbedUrl(metadata.provider, metadata.url)! }}
                  style={styles.thumbnailPlayer}
                  containerStyle={styles.thumbnailPlayer}
                  originWhitelist={["https://*"]}
                  javaScriptEnabled
                  domStorageEnabled
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction
                  allowsFullscreenVideo
                  scrollEnabled={false}
                  bounces={false}
                  setSupportMultipleWindows={false}
                  onShouldStartLoadWithRequest={allowVideoEmbedNavigation}
                  accessibilityLabel={`${metadata.provider} video preview`}
                />
              ) : metadata.thumbnailUrl ? (
                <Image source={{ uri: metadata.thumbnailUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
              ) : null}
            </View>

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

            <Pressable
              onPress={() => void publishToHomeFeed()}
              disabled={publishing || published || !language}
              style={({ pressed }) => [
                styles.publishButton,
                published && styles.publishedButton,
                (pressed || publishing) && { opacity: 0.82 },
              ]}
            >
              {publishing ? <ActivityIndicator size="small" color="#0B1020" /> : <Ionicons name={published ? "checkmark-circle" : "add-circle-outline"} size={19} color="#0B1020" />}
              <Text style={styles.publishButtonText}>{published ? "Imeongezwa kwenye Home Feed" : publishing ? "Inaongezwa..." : "Ongeza kwenye Home Feed"}</Text>
            </Pressable>

            <Text style={styles.securityHint}>Bonyeza play ili kutazama video hapa ndani ya Kristo App.</Text>
            <Text style={styles.countryFooter}>Nchi: {country.flag} {country.name}  •  Lugha: {language?.name || "Chagua lugha"}</Text>
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

      <Modal visible={languagePickerVisible} animationType="slide" transparent onRequestClose={() => setLanguagePickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.countryModal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Chagua lugha ya video</Text>
              <Pressable onPress={() => setLanguagePickerVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={25} color={TEXT} />
              </Pressable>
            </View>
            <TextInput
              value={languageSearch}
              onChangeText={setLanguageSearch}
              placeholder="Tafuta lugha…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.searchInput}
              autoCorrect={false}
            />
            <FlatList
              data={filteredLanguages}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setLanguage(item);
                    setLanguagePickerVisible(false);
                    setLanguageSearch("");
                  }}
                  style={styles.countryOption}
                >
                  <Ionicons name="language-outline" size={18} color={BLUE} />
                  <Text style={styles.countryName}>{item.name}</Text>
                  <Text style={styles.countryCode}>{item.code.toUpperCase()}</Text>
                  {item.code === language?.code ? <Ionicons name="checkmark" size={18} color={GOLD} /> : null}
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
  backButton: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.075)", borderWidth: 1, borderColor: "rgba(244,208,111,0.24)" },
  eyebrow: { color: GOLD, fontSize: 9, fontWeight: "900", letterSpacing: 1.7 },
  title: { marginTop: 2, color: TEXT, fontSize: 27, lineHeight: 33, fontWeight: "900", letterSpacing: -0.6 },
  subtitle: { marginTop: 2, color: "rgba(235,232,246,0.64)", fontSize: 12, fontWeight: "600" },
  studioHero: { position: "relative", overflow: "hidden", marginBottom: 14, padding: 16, borderRadius: 21, borderWidth: 1, borderColor: "rgba(244,208,111,0.38)", backgroundColor: "#171B2B" },
  heroTopline: { flexDirection: "row", alignItems: "center", gap: 10 },
  heroMark: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,208,111,0.13)", borderWidth: 1, borderColor: "rgba(244,208,111,0.22)" },
  heroHeading: { flex: 1 },
  heroEyebrow: { color: GOLD, fontSize: 8, fontWeight: "900", letterSpacing: 1.7 },
  heroTitle: { marginTop: 3, color: TEXT, fontSize: 16, fontWeight: "900", letterSpacing: -0.2 },
  studioStatus: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(110,231,183,0.10)", borderWidth: 1, borderColor: "rgba(110,231,183,0.23)" },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  studioStatusText: { color: GREEN, fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  heroCopy: { marginTop: 12, maxWidth: 330, color: "rgba(255,255,255,0.70)", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  heroDivider: { height: 1, marginTop: 13, backgroundColor: "rgba(255,255,255,0.10)" },
  heroFoot: { flexDirection: "row", gap: 17, marginTop: 10 },
  heroFeature: { flexDirection: "row", alignItems: "center", gap: 5 },
  heroFeatureText: { color: "rgba(255,255,255,0.60)", fontSize: 8, fontWeight: "900", letterSpacing: 0.65 },
  heroGlow: { position: "absolute", right: -42, top: -55, width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(244,208,111,0.045)" },
  glassCard: { overflow: "hidden", borderRadius: 19, borderWidth: 1, backgroundColor: "rgba(20,25,39,0.82)", padding: 15, shadowColor: "#000000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 4 },
  savedAccountsCard: { marginBottom: 12, backgroundColor: "rgba(20,28,44,0.92)" },
  savedAccountsHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  savedAccountsList: { marginTop: 13, paddingTop: 3 },
  savedAccountBlock: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(147,197,253,0.14)" },
  savedAccountRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10 },
  savedAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "rgba(244,208,111,0.28)" },
  savedAvatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(147,197,253,0.12)" },
  savedAccountName: { color: TEXT, fontSize: 12, fontWeight: "800" },
  savedAccountHint: { color: MUTED, fontSize: 10, marginTop: 3, fontWeight: "600" },
  savedLinksList: { paddingBottom: 9, paddingLeft: 46 },
  savedLinkBlock: { paddingTop: 1, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.08)" },
  savedLinkActions: { flexDirection: "row", gap: 8, paddingBottom: 9, paddingLeft: 23 },
  savedLinkAction: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  savedLinkActionText: { color: BLUE, fontSize: 10, fontWeight: "800" },
  savedProfileButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6 },
  savedProfileText: { color: BLUE, fontSize: 10, fontWeight: "800" },
  savedLinkRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.08)" },
  savedLinkTitle: { color: TEXT, fontSize: 10, fontWeight: "700" },
  savedLinkHint: { color: MUTED, fontSize: 9, marginTop: 2 },
  savedError: { color: RED, fontSize: 11, paddingVertical: 8 },
  countryCard: { marginBottom: 11, backgroundColor: "rgba(33,30,35,0.78)" },
  languageCard: { marginBottom: 12, backgroundColor: "rgba(22,29,43,0.86)" },
  languageButton: { maxWidth: 155, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(147,197,253,0.10)", borderWidth: 1, borderColor: "rgba(147,197,253,0.25)" },
  languageValue: { color: "#DCEBFF", fontSize: 11, fontWeight: "800", flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 11 },
  countryIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,208,111,0.12)", borderWidth: 1, borderColor: "rgba(244,208,111,0.12)" },
  label: { color: TEXT, fontSize: 13, fontWeight: "800", letterSpacing: -0.1 },
  helper: { marginTop: 4, color: "rgba(255,255,255,0.57)", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  countryButton: { maxWidth: 165, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(244,208,111,0.10)", borderWidth: 1, borderColor: "rgba(244,208,111,0.27)" },
  countryValue: { color: "#FFF3C4", fontSize: 11, fontWeight: "800", flexShrink: 1 },
  linkCard: { marginBottom: 13, backgroundColor: "rgba(25,22,39,0.90)" },
  sectionTitle: { color: TEXT, fontSize: 16, fontWeight: "900", letterSpacing: -0.2 },
  urlInput: { minHeight: 52, marginTop: 13, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(167,139,250,0.36)", backgroundColor: "rgba(4,7,14,0.52)", color: TEXT, fontSize: 13 },
  loadingRow: { marginTop: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  loadingText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  errorBox: { marginTop: 13, padding: 11, borderRadius: 12, flexDirection: "row", gap: 8, backgroundColor: "rgba(251,113,133,0.09)", borderWidth: 1, borderColor: "rgba(251,113,133,0.17)" },
  errorText: { flex: 1, color: "#FDA4AF", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  securityHint: { marginTop: 10, color: "rgba(255,255,255,0.46)", fontSize: 10, lineHeight: 15, fontWeight: "600" },
  previewCard: { marginTop: 2, padding: 15, backgroundColor: "rgba(18,27,36,0.95)" },
  providerPill: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  providerText: { color: TEXT, fontSize: 12, fontWeight: "900" },
  autoBadge: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, backgroundColor: "rgba(110,231,183,0.09)" },
  autoBadgeText: { color: GREEN, fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  thumbnail: { width: "100%", height: 190, borderRadius: 15, backgroundColor: "#05070C", overflow: "hidden", borderWidth: 1, borderColor: "rgba(244,208,111,0.30)" },
  thumbnailPlayer: { flex: 1, backgroundColor: "#05070C" },
  videoTitle: { marginTop: 14, color: TEXT, fontSize: 18, lineHeight: 24, fontWeight: "900", letterSpacing: -0.3 },
  creatorRow: { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.035)" },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: "rgba(244,208,111,0.30)" },
  avatarFallback: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(147,197,253,0.12)", borderWidth: 1, borderColor: "rgba(147,197,253,0.23)" },
  creatorCaption: { color: MUTED, fontSize: 10, fontWeight: "700" },
  creatorName: { marginTop: 3, color: TEXT, fontSize: 13, fontWeight: "900" },
  profileButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11, backgroundColor: "rgba(147,197,253,0.10)", borderWidth: 1, borderColor: "rgba(147,197,253,0.14)" },
  profileButtonText: { color: BLUE, fontSize: 11, fontWeight: "800" },
  dateRow: { marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderColor: "rgba(255,255,255,0.09)", flexDirection: "row", alignItems: "center", gap: 7 },
  dateLabel: { color: MUTED, flex: 1, fontSize: 11, fontWeight: "700" },
  dateValue: { color: TEXT, fontSize: 11, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 11 },
  statBox: { flex: 1, minHeight: 70, borderRadius: 13, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.045)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  statValue: { color: TEXT, fontSize: 13, fontWeight: "900" },
  statLabel: { color: MUTED, fontSize: 9, fontWeight: "700" },
  apiNote: { marginTop: 11, color: "rgba(255,255,255,0.48)", fontSize: 10, lineHeight: 15, fontWeight: "600" },
  publishButton: { marginTop: 14, minHeight: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GOLD, shadowColor: GOLD, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 3 },
  publishedButton: { backgroundColor: GREEN },
  publishButtonText: { color: "#0B1020", fontSize: 13, fontWeight: "900" },
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
