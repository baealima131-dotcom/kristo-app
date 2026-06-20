import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet, apiPost, getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";

const PAD = 16;
const VIP_BG = "#05070D";
const GOLD = "rgba(244,201,93,0.98)";
const GOLD_SOFT = "rgba(244,201,93,0.22)";
const TAB_BAR_HEIGHT = 70;
const TAB_BAR_EXTRA = 28;

type ChurchRow = {
  id: string;
  name: string;
  country?: string;
  countryCode?: string;
  city?: string;
  province?: string;
  address?: string;
  pastorName?: string;
  avatarUrl?: string;
  avatarUri?: string;
  logoUrl?: string;
  churchLogoUrl?: string;
  verified?: boolean;
  score?: number;
};

const BLOCKED_CHURCH_IDS = new Set([
  "church_dev_default",
  "c-demo-1",
  "c-demo-2",
  "c-demo-3",
  "c1",
  "c2",
  "c_mn7wv2x2_zu0n9g",
]);

const COUNTRY_FLAGS: Record<string, string> = {
  angola: "🇦🇴",
  argentina: "🇦🇷",
  australia: "🇦🇺",
  belgium: "🇧🇪",
  benin: "🇧🇯",
  botswana: "🇧🇼",
  brazil: "🇧🇷",
  burundi: "🇧🇮",
  cameroon: "🇨🇲",
  canada: "🇨🇦",
  chad: "🇹🇩",
  chile: "🇨🇱",
  china: "🇨🇳",
  colombia: "🇨🇴",
  congo: "🇨🇬",
  "dr congo": "🇨🇩",
  egypt: "🇪🇬",
  ethiopia: "🇪🇹",
  france: "🇫🇷",
  gabon: "🇬🇦",
  gambia: "🇬🇲",
  germany: "🇩🇪",
  ghana: "🇬🇭",
  guinea: "🇬🇳",
  india: "🇮🇳",
  indonesia: "🇮🇩",
  italy: "🇮🇹",
  japan: "🇯🇵",
  kenya: "🇰🇪",
  lesotho: "🇱🇸",
  liberia: "🇱🇷",
  madagascar: "🇲🇬",
  malawi: "🇲🇼",
  mexico: "🇲🇽",
  mozambique: "🇲🇿",
  namibia: "🇳🇦",
  netherlands: "🇳🇱",
  nigeria: "🇳🇬",
  rwanda: "🇷🇼",
  senegal: "🇸🇳",
  "south africa": "🇿🇦",
  spain: "🇪🇸",
  sudan: "🇸🇩",
  tanzania: "🇹🇿",
  uganda: "🇺🇬",
  "united kingdom": "🇬🇧",
  "united states": "🇺🇸",
  usa: "🇺🇸",
  zambia: "🇿🇲",
  zimbabwe: "🇿🇼",
};

function normalizeCountryKey(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function countryFlagFor(country?: string, countryCode?: string) {
  const key = normalizeCountryKey(country);
  if (key && COUNTRY_FLAGS[key]) return COUNTRY_FLAGS[key];
  const iso = String(countryCode || "").trim().toUpperCase();
  const isoMap: Record<string, string> = {
    BI: "🇧🇮",
    US: "🇺🇸",
    KE: "🇰🇪",
    TZ: "🇹🇿",
    CD: "🇨🇩",
    AR: "🇦🇷",
    BJ: "🇧🇯",
    FR: "🇫🇷",
    CA: "🇨🇦",
    GB: "🇬🇧",
  };
  return isoMap[iso] || "🌍";
}

function resolveImageUrl(raw?: string) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^(https?:|file:|data:image\/)/i.test(v)) return v;
  const base = getApiBase();
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

function pickChurchDisplayImage(church: ChurchRow) {
  const avatarUrlRaw = String(church.avatarUrl || "").trim();
  const logoUrlRaw = String(church.logoUrl || church.churchLogoUrl || "").trim();
  const avatarUriRaw = String(church.avatarUri || "").trim();

  const hasAvatarUrl = Boolean(avatarUrlRaw);
  const hasLogoUrl = Boolean(logoUrlRaw);

  for (const raw of [avatarUrlRaw, logoUrlRaw, avatarUriRaw]) {
    const imageUrl = resolveImageUrl(raw);
    if (imageUrl) {
      return { imageUrl, hasAvatarUrl, hasLogoUrl };
    }
  }

  return { imageUrl: "", hasAvatarUrl, hasLogoUrl };
}

function logChurchAvatarSource(church: ChurchRow, imageUrl: string) {
  const picked = pickChurchDisplayImage(church);
  console.log("KRISTO_FIND_CHURCH_AVATAR_SOURCE", {
    churchId: church.id,
    churchName: church.name,
    hasAvatarUrl: picked.hasAvatarUrl,
    hasLogoUrl: picked.hasLogoUrl,
    imageUrl,
  });
}

function logChurchAvatarFallback(church: ChurchRow, reason: string) {
  const picked = pickChurchDisplayImage(church);
  console.log("KRISTO_FIND_CHURCH_AVATAR_FALLBACK", {
    churchId: church.id,
    churchName: church.name,
    reason,
    hasAvatarUrl: picked.hasAvatarUrl,
    hasLogoUrl: picked.hasLogoUrl,
  });
}

function isProductionChurchId(id: string) {
  return /^CH7-[A-Z0-9]{4,12}$/i.test(String(id || "").trim());
}

function isSearchableChurch(c: ChurchRow) {
  const id = String(c.id || "").trim();
  if (!isProductionChurchId(id)) return false;
  if (BLOCKED_CHURCH_IDS.has(id.toLowerCase())) return false;
  return true;
}

function churchInitials(name: string) {
  const parts = String(name || "Church")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  const word = parts[0] || "CH";
  return word.slice(0, 2).toUpperCase();
}

function buildLocationLine(ch: ChurchRow) {
  if (ch.address?.trim()) return ch.address.trim();
  return [ch.city, ch.province, ch.country].filter(Boolean).join(" • ");
}

function buildSearchPath(params: {
  q: string;
  city?: string;
  country?: string;
  language?: string;
}) {
  const qs = new URLSearchParams();
  if (params.q.trim()) qs.set("q", params.q.trim());
  if (params.city?.trim()) qs.set("city", params.city.trim());
  if (params.country?.trim()) qs.set("country", params.country.trim());
  if (params.language?.trim()) qs.set("language", params.language.trim());
  qs.set("limit", "30");
  const query = qs.toString();
  return `/api/church/search${query ? `?${query}` : ""}`;
}

function friendlyFindChurchError(raw: unknown): string {
  const message = String(raw || "").trim();
  if (!message) return "Couldn't load churches. Please try again.";
  if (/^\s*<!DOCTYPE/i.test(message) || /^\s*<html/i.test(message)) {
    return "Couldn't load churches. Please try again.";
  }
  if (message.includes("<html") || message.includes("<!DOCTYPE")) {
    return "Couldn't load churches. Please try again.";
  }
  return message;
}

function ScalePress({
  style,
  pressedScale = 0.985,
  children,
  ...props
}: PressableProps & {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  pressedScale?: number;
}) {
  return (
    <Pressable
      {...props}
      style={(state) => {
        const base = typeof style === "function" ? style(state) : style;
        return [base, state.pressed && !props.disabled ? { transform: [{ scale: pressedScale }] } : null];
      }}
    >
      {children}
    </Pressable>
  );
}

function CountryLine({ country, countryCode }: { country?: string; countryCode?: string }) {
  if (!country) return null;
  const flag = countryFlagFor(country, countryCode);
  return (
    <View style={s.countryRow}>
      <View style={s.flagBox}>
        <Text style={s.flag} allowFontScaling={false}>
          {flag}
        </Text>
      </View>
      <Text style={s.countryName} numberOfLines={1}>
        {country}
      </Text>
      {countryCode ? (
        <View style={s.isoPill}>
          <Text style={s.isoTag}>{countryCode}</Text>
        </View>
      ) : null}
    </View>
  );
}

function AvatarRing({
  church,
  size = 74,
  verified = false,
}: {
  church: ChurchRow;
  size?: number;
  verified?: boolean;
}) {
  const radius = size / 2;
  const initials = churchInitials(church.name);
  const display = useMemo(() => pickChurchDisplayImage(church), [church]);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = !imageFailed ? display.imageUrl : "";

  useEffect(() => {
    setImageFailed(false);
  }, [church.id, display.imageUrl]);

  useEffect(() => {
    if (imageUrl) {
      logChurchAvatarSource(church, imageUrl);
    } else {
      logChurchAvatarFallback(church, display.hasAvatarUrl || display.hasLogoUrl ? "invalid-url" : "no-url");
    }
  }, [church.id, church.name, imageUrl, display.hasAvatarUrl, display.hasLogoUrl]);

  return (
    <View style={[s.avatarRing, verified && s.avatarRingVerified]}>
      {verified ? <View pointerEvents="none" style={[s.avatarGlow, { width: size + 18, height: size + 18, borderRadius: (size + 18) / 2 }]} /> : null}
      <View style={[s.avatarInner, { width: size, height: size, borderRadius: radius }]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: size, height: size, borderRadius: radius }}
            resizeMode="cover"
            onError={() => {
              logChurchAvatarFallback(church, "image-load-error");
              setImageFailed(true);
            }}
          />
        ) : (
          <View style={[s.avatarFallback, { width: size, height: size, borderRadius: radius }]}>
            <Text style={[s.avatarInitials, { fontSize: size * 0.28 }]} allowFontScaling={false}>
              {initials}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ChurchProfileModal({
  church,
  visible,
  onClose,
  onRequest,
  onUseId,
  requesting,
}: {
  church: ChurchRow | null;
  visible: boolean;
  onClose: () => void;
  onRequest: (ch: ChurchRow) => void;
  onUseId: (ch: ChurchRow) => void;
  requesting: boolean;
}) {
  const insets = useSafeAreaInsets();
  if (!church) return null;

  const location = buildLocationLine(church);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close profile" />
        <View style={[s.modalSheet, { maxHeight: "88%", paddingBottom: Math.max(insets.bottom, 14) + 8 }]}>
          <View style={s.modalHandle} />

          <ScrollView
            bounces={Platform.OS === "ios"}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            contentContainerStyle={s.modalScrollContent}
          >
            <View style={s.modalHero}>
              <AvatarRing church={church} size={96} verified={!!church.verified} />
              <View style={s.modalHeroText}>
                <View style={s.nameRow}>
                  <Text style={s.modalTitle}>{church.name}</Text>
                  {church.verified ? (
                    <View style={s.verifiedBadge}>
                      <Ionicons name="shield-checkmark" size={12} color="#07101A" />
                      <Text style={s.verifiedText}>Verified</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.modalId} selectable>
                  {church.id}
                </Text>
                <CountryLine country={church.country} countryCode={church.countryCode} />
              </View>
            </View>

            <View style={s.modalSection}>
              <Text style={s.modalSectionLabel}>LOCATION</Text>
              {location ? (
                <View style={s.modalInfoRow}>
                  <View style={s.modalInfoIcon}>
                    <Ionicons name="location-outline" size={17} color={GOLD} />
                  </View>
                  <Text style={s.modalInfoText}>{location}</Text>
                </View>
              ) : (
                <Text style={s.modalMuted}>Location not provided yet.</Text>
              )}
            </View>

            {church.pastorName ? (
              <View style={s.modalSection}>
                <Text style={s.modalSectionLabel}>PASTOR</Text>
                <View style={s.modalInfoRow}>
                  <View style={s.modalInfoIcon}>
                    <Ionicons name="person-outline" size={17} color={GOLD} />
                  </View>
                  <Text style={s.modalInfoText}>{church.pastorName}</Text>
                </View>
              </View>
            ) : null}

            <View style={s.modalActions}>
              <ScalePress
                onPress={() => onRequest(church)}
                disabled={requesting}
                style={[s.primaryBtn, requesting && s.btnDisabled]}
                pressedScale={0.98}
              >
                <Text style={s.primaryBtnText}>{requesting ? "Sending request…" : "Send Request"}</Text>
                <Ionicons name={requesting ? "hourglass-outline" : "paper-plane"} size={18} color="#07101A" />
              </ScalePress>

              <View style={s.modalSecondaryRow}>
                <ScalePress onPress={() => onUseId(church)} style={[s.secondaryBtn, s.modalSecondaryBtn]} pressedScale={0.98}>
                  <Ionicons name="key-outline" size={16} color={GOLD} />
                  <Text style={s.secondaryBtnText}>Use ID</Text>
                </ScalePress>
              </View>

              <ScalePress onPress={onClose} style={s.dismissBtn} pressedScale={0.98}>
                <Text style={s.dismissText}>Close</Text>
              </ScalePress>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ChurchCard({
  church,
  onViewProfile,
  onRequest,
  onUseId,
  requesting,
}: {
  church: ChurchRow;
  onViewProfile: (ch: ChurchRow) => void;
  onRequest: (ch: ChurchRow) => void;
  onUseId: (ch: ChurchRow) => void;
  requesting: boolean;
}) {
  const location = buildLocationLine(church);

  return (
    <View style={s.churchCard}>
      <View pointerEvents="none" style={s.churchCardGlow} />

      <View style={s.churchCardTop}>
        <AvatarRing church={church} size={74} verified={!!church.verified} />

        <View style={s.churchBody}>
          <View style={s.nameRow}>
            <Text style={s.churchName} numberOfLines={3}>
              {church.name}
            </Text>
            {church.verified ? (
              <View style={s.verifiedBadgeSmall}>
                <Ionicons name="shield-checkmark" size={11} color="#07101A" />
              </View>
            ) : null}
          </View>

          <Text style={s.churchId} numberOfLines={1}>
            {church.id}
          </Text>

          <CountryLine country={church.country} countryCode={church.countryCode} />

          {location ? (
            <Text style={s.locationLine} numberOfLines={3}>
              {location}
            </Text>
          ) : null}

          {church.pastorName ? (
            <Text style={s.pastorLine} numberOfLines={2}>
              Pastor {church.pastorName}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={s.cardDivider} />

      <View style={s.cardActions}>
        <ScalePress
          onPress={() => onRequest(church)}
          disabled={requesting}
          style={[s.primaryBtnCompact, requesting && s.btnDisabled]}
          pressedScale={0.985}
        >
          <Text style={s.primaryBtnText} numberOfLines={1}>
            {requesting ? "Sending…" : "Send Request"}
          </Text>
        </ScalePress>

        <View style={s.secondaryActionRow}>
          <ScalePress onPress={() => onViewProfile(church)} style={[s.linkBtn, s.secondaryActionBtn]} pressedScale={0.98}>
            <Text style={s.linkBtnText} numberOfLines={1}>
              View Profile
            </Text>
            <Ionicons name="arrow-forward" size={14} color={GOLD} />
          </ScalePress>

          <ScalePress onPress={() => onUseId(church)} style={[s.ghostBtn, s.secondaryActionBtn]} pressedScale={0.98}>
            <Text style={s.ghostBtnText} numberOfLines={1}>
              Use ID
            </Text>
          </ScalePress>
        </View>
      </View>
    </View>
  );
}

export default function ChurchFindScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();
  const scrollRef = useRef<ScrollView>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<ChurchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [profileChurch, setProfileChurch] = useState<ChurchRow | null>(null);

  const scrollBottomPad = insets.bottom + TAB_BAR_HEIGHT + TAB_BAR_EXTRA;

  const profileHints = useMemo(
    () => ({
      city: String((session as any)?.city || "").trim(),
      country: String((session as any)?.country || "").trim(),
      language: String((session as any)?.language || "").trim(),
    }),
    [session]
  );

  const loadChurches = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const data = await apiGet<any>(
          buildSearchPath({
            q,
            city: profileHints.city,
            country: profileHints.country,
            language: profileHints.language,
          })
        );

        if (!data?.ok) {
          setResults([]);
          setError(friendlyFindChurchError(data?.error || "Couldn't load churches. Please try again."));
          return;
        }

        const rows = Array.isArray(data.churches) ? data.churches : [];
        setResults(
          rows
            .map((c: any) => ({
              id: String(c.id || "").trim(),
              name: String(c.name || c.id || "Church").trim(),
              country: c.country ? String(c.country) : undefined,
              countryCode: c.countryCode ? String(c.countryCode) : undefined,
              city: c.city ? String(c.city) : undefined,
              province: c.province ? String(c.province) : undefined,
              address: c.address ? String(c.address) : undefined,
              pastorName: c.pastorName ? String(c.pastorName) : undefined,
              avatarUrl: String(c.avatarUrl || c.avatarUri || c.churchAvatarUri || "").trim() || undefined,
              avatarUri: String(c.avatarUri || c.churchAvatarUri || c.avatarUrl || "").trim() || undefined,
              logoUrl: String(c.logoUrl || c.churchLogoUrl || c.logoUri || "").trim() || undefined,
              churchLogoUrl: String(c.churchLogoUrl || c.logoUrl || "").trim() || undefined,
              verified: Boolean(c.verified),
              score: typeof c.score === "number" ? c.score : undefined,
            }))
            .filter(isSearchableChurch)
        );
      } catch (e: any) {
        setResults([]);
        setError(friendlyFindChurchError(e?.message || e || "Couldn't load churches. Please try again."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [q, profileHints.city, profileHints.country, profileHints.language]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      loadChurches("initial");
    }, q.trim() ? 260 : 0);
    return () => clearTimeout(timer);
  }, [loadChurches, q]);

  function useId(ch: ChurchRow) {
    setProfileChurch(null);
    router.replace({ pathname: "/more/church", params: { joinId: ch.id } } as any);
  }

  async function requestJoin(ch: ChurchRow) {
    const userId = String(session?.userId || "").trim();
    if (!userId) {
      Alert.alert("Sign in required", "Please sign in before requesting to join a church.");
      return;
    }

    setRequestingId(ch.id);
    try {
      const data = await apiPost(
        "/api/church/join-requests",
        {
          churchId: ch.id,
          name: String(session?.displayName || session?.name || "").trim() || undefined,
        },
        getKristoHeaders({
          userId,
          role: (session?.role as any) || "Member",
          churchId: String(session?.churchId || ""),
        })
      );

      if (!data?.ok) {
        Alert.alert("Request failed", String(data?.error || "Could not send join request."));
        return;
      }

      Alert.alert("Request sent", `Your request to join ${ch.name} was sent for pastor approval.`);
      setProfileChurch(null);
    } catch (e: any) {
      Alert.alert("Request failed", String(e?.message || e || "Network error."));
    } finally {
      setRequestingId(null);
    }
  }

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <ScalePress onPress={() => router.back()} style={s.backBtn} pressedScale={0.94}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.92)" />
        </ScalePress>
        <View style={s.headerTextWrap}>
          <Text style={s.title} numberOfLines={2}>
            Find a Church
          </Text>
          <Text style={s.sub} numberOfLines={2}>
            Discover verified congregations worldwide.
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: scrollBottomPad }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
        bounces
        alwaysBounceVertical={false}
        decelerationRate={Platform.OS === "ios" ? "normal" : undefined}
        overScrollMode="always"
        scrollEventThrottle={16}
        onScrollBeginDrag={Keyboard.dismiss}
        nestedScrollEnabled
      >
        <View style={s.searchCard}>
          <Text style={s.sectionTitle}>Search</Text>

          <View style={s.searchRow}>
            <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.70)" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Church name or Church ID"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              blurOnSubmit
              onSubmitEditing={Keyboard.dismiss}
              style={s.input}
            />
            {q.trim() ? (
              <ScalePress onPress={() => setQ("")} style={s.clearBtn} pressedScale={0.92}>
                <Ionicons name="close" size={16} color="rgba(255,255,255,0.85)" />
              </ScalePress>
            ) : null}
          </View>

          {profileHints.city || profileHints.country ? (
            <Text style={s.hint} numberOfLines={3}>
              Prioritizing churches near {profileHints.city || "your area"}
              {profileHints.country ? `, ${profileHints.country}` : ""}.
            </Text>
          ) : (
            <Text style={s.hint} numberOfLines={3}>
              Add city and country in your profile for smarter local matches.
            </Text>
          )}
        </View>

        {loading ? (
          <View style={s.centerBox}>
            <ActivityIndicator color={GOLD} size="large" />
            <Text style={s.centerText}>Loading churches…</Text>
          </View>
        ) : error ? (
          <View style={s.notice}>
            <Ionicons name="alert-circle-outline" size={20} color={GOLD} />
            <View style={s.noticeBody}>
              <Text style={s.noticeText}>{error}</Text>
              <ScalePress onPress={() => loadChurches("refresh")} style={s.retryBtn} pressedScale={0.97}>
                <Text style={s.retryText}>Try again</Text>
              </ScalePress>
            </View>
          </View>
        ) : results.length === 0 ? (
          <View style={s.notice}>
            <Ionicons name="information-circle-outline" size={20} color={GOLD} />
            <Text style={s.noticeText}>
              No churches found. Try another name, city, country, or paste the full Church ID.
            </Text>
          </View>
        ) : (
          <View style={s.resultsBlock}>
            <Text style={s.countText}>
              {results.length} church{results.length === 1 ? "" : "es"} found
            </Text>
            {results.map((c) => (
              <ChurchCard
                key={c.id}
                church={c}
                onViewProfile={setProfileChurch}
                onRequest={requestJoin}
                onUseId={useId}
                requesting={requestingId === c.id}
              />
            ))}
          </View>
        )}

        {refreshing && !loading ? <Text style={s.refreshText}>Updating results…</Text> : null}
      </ScrollView>

      <ChurchProfileModal
        church={profileChurch}
        visible={!!profileChurch}
        onClose={() => setProfileChurch(null)}
        onRequest={requestJoin}
        onUseId={useId}
        requesting={!!profileChurch && requestingId === profileChurch.id}
      />
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: PAD, paddingTop: 4 },

  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: PAD, paddingBottom: 14 },
  headerTextWrap: { flex: 1, minWidth: 0 },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: GOLD_SOFT,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  title: { color: "#fff", fontWeight: "950", fontSize: 28, letterSpacing: 0.2 },
  sub: { color: "rgba(255,255,255,0.55)", marginTop: 3, fontWeight: "700", lineHeight: 18 },

  searchCard: {
    borderRadius: 26,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.032)",
    borderWidth: 1.2,
    borderColor: GOLD_SOFT,
    marginBottom: 18,
  },
  sectionTitle: { color: GOLD, fontWeight: "950", fontSize: 12, letterSpacing: 1.3, marginBottom: 12 },

  searchRow: {
    minHeight: 58,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.34)",
    backgroundColor: "rgba(0,0,0,0.36)",
  },
  input: { flex: 1, minWidth: 0, color: "rgba(255,255,255,0.94)", fontWeight: "900", fontSize: 16, paddingVertical: Platform.OS === "android" ? 0 : 4 },
  clearBtn: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  hint: { marginTop: 12, color: "rgba(255,255,255,0.55)", lineHeight: 20, fontWeight: "700" },

  resultsBlock: { gap: 16 },
  countText: { color: "rgba(255,255,255,0.62)", fontWeight: "900", marginBottom: 2, letterSpacing: 0.3 },

  churchCard: {
    borderRadius: 28,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.028)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.20)",
  },
  churchCardGlow: {
    position: "absolute",
    top: -40,
    right: -20,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(244,201,93,0.06)",
  },
  churchCardTop: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  churchBody: { flex: 1, minWidth: 0, gap: 5 },

  avatarRing: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(244,201,93,0.55)",
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRingVerified: {
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
  avatarGlow: {
    position: "absolute",
    backgroundColor: "rgba(244,201,93,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.28)",
  },
  avatarInner: { overflow: "hidden" },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.08)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.18)",
  },
  avatarInitials: { color: GOLD, fontWeight: "950", letterSpacing: 0.6 },

  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, flexWrap: "wrap" },
  churchName: { flex: 1, minWidth: 0, color: "#fff", fontWeight: "950", fontSize: 20, letterSpacing: 0.2, lineHeight: 24 },
  churchId: { color: "rgba(244,201,93,0.82)", fontWeight: "900", fontSize: 12, letterSpacing: 0.8 },

  countryRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "nowrap" },
  flagBox: { width: 22, height: 20, alignItems: "center", justifyContent: "center" },
  flag: {
    fontSize: 16,
    lineHeight: Platform.OS === "android" ? 18 : 16,
    ...(Platform.OS === "android" ? { includeFontPadding: false, textAlignVertical: "center" } : {}),
  },
  countryName: { flexShrink: 1, color: "rgba(255,255,255,0.78)", fontWeight: "800", fontSize: 13, lineHeight: 18 },
  isoPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  isoTag: { color: "rgba(255,255,255,0.45)", fontWeight: "900", fontSize: 10, letterSpacing: 0.4 },

  locationLine: { color: "rgba(255,255,255,0.58)", fontWeight: "750", lineHeight: 19, marginTop: 2 },
  pastorLine: { color: "rgba(255,255,255,0.45)", fontWeight: "800", fontSize: 12, marginTop: 2, lineHeight: 16 },

  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  verifiedBadgeSmall: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    marginTop: 2,
  },
  verifiedText: { color: "#07101A", fontWeight: "950", fontSize: 10, letterSpacing: 0.4 },

  cardDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginVertical: 16 },
  cardActions: { gap: 10 },

  primaryBtnCompact: {
    minHeight: 52,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.70)",
  },
  primaryBtnText: { color: "#07101A", fontWeight: "950", fontSize: 14, letterSpacing: 0.6 },
  btnDisabled: { opacity: 0.72 },

  secondaryActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  secondaryActionBtn: { flex: 1, minWidth: 128 },

  linkBtn: {
    minHeight: 44,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(244,201,93,0.08)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.18)",
  },
  linkBtnText: { color: GOLD, fontWeight: "950", fontSize: 13, letterSpacing: 0.5 },

  ghostBtn: {
    minHeight: 44,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  ghostBtnText: { color: "rgba(255,255,255,0.72)", fontWeight: "900", fontSize: 12, letterSpacing: 0.4 },

  centerBox: { marginTop: 28, alignItems: "center", gap: 12, paddingVertical: 24 },
  centerText: { color: "rgba(255,255,255,0.62)", fontWeight: "800" },
  refreshText: { marginTop: 16, color: "rgba(255,255,255,0.45)", textAlign: "center", fontWeight: "700" },

  notice: {
    marginTop: 8,
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.18)",
    backgroundColor: "rgba(244,201,93,0.06)",
  },
  noticeBody: { flex: 1, minWidth: 0, gap: 10 },
  noticeText: { flex: 1, color: "rgba(255,255,255,0.76)", fontWeight: "750", lineHeight: 20 },

  retryBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(244,201,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.24)",
  },
  retryText: { color: GOLD, fontWeight: "950", fontSize: 12 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: "#0A0E16",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.22)",
  },
  modalScrollContent: { paddingBottom: 8, gap: 16 },
  modalHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 10,
  },
  modalHero: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  modalHeroText: { flex: 1, minWidth: 0, gap: 6 },
  modalTitle: { flex: 1, minWidth: 0, color: "#fff", fontWeight: "950", fontSize: 22, lineHeight: 28 },
  modalId: { color: GOLD, fontWeight: "900", fontSize: 12, letterSpacing: 0.8 },

  modalSection: { gap: 8 },
  modalSectionLabel: { color: "rgba(244,201,93,0.72)", fontWeight: "950", fontSize: 11, letterSpacing: 1.2 },
  modalInfoRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  modalInfoIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.08)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.16)",
  },
  modalInfoText: { flex: 1, minWidth: 0, color: "rgba(255,255,255,0.78)", fontWeight: "750", lineHeight: 22, fontSize: 15 },
  modalMuted: { color: "rgba(255,255,255,0.42)", fontWeight: "700", lineHeight: 20 },

  modalActions: { gap: 12, marginTop: 4 },
  modalSecondaryRow: { flexDirection: "row", gap: 10 },

  primaryBtn: {
    minHeight: 56,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: GOLD,
  },
  secondaryBtn: {
    minHeight: 48,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: GOLD_SOFT,
  },
  modalSecondaryBtn: { flex: 1 },
  secondaryBtnText: { color: GOLD, fontWeight: "950", fontSize: 13, letterSpacing: 0.5 },
  dismissBtn: { alignItems: "center", paddingVertical: 10 },
  dismissText: { color: "rgba(255,255,255,0.45)", fontWeight: "800" },
});
