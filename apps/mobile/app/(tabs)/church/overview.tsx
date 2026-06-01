import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { fetchMyActiveChurchMembership } from "@/src/lib/churchMembersApi";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Modal,
  Alert,
  Image,
  Animated,
  Platform,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { apiGet, apiPatch } from "@/src/lib/kristoApi";
import { handleInviteAction } from "@/src/lib/churchMembersApi";
import { useIsFocused } from "@react-navigation/native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadChurchProfileCache, saveChurchProfileCache } from "@/src/lib/churchStore";
import {
  getChurchOverviewCache,
  peekChurchOverviewCache,
  saveChurchOverviewCache,
  type ChurchOverviewCachePayload,
} from "@/src/lib/screenDataCache";
import { ChurchOverviewSkeleton } from "@/src/components/PremiumTabSkeletons";
import { onChurchProfileUpdated } from "@/src/lib/kristoProfileEvents";
import { avatarCacheBust, pickFresherAvatar } from "@/src/lib/avatarFreshness";
import {
  isSaveCooldown,
  logTrafficCache,
  shouldAllowScreenRefresh,
} from "@/src/lib/kristoTraffic";
import { evaluateChurchMediaAccessClient } from "@/src/lib/churchMediaAccess";
import {
  getCachedChurchMediaAccess,
  seedChurchMediaAccessFromSession,
} from "@/src/lib/refreshCoordinator";
import {
  CHURCH_TAB_REFRESH_MS,
  logChurchFeatureBackgroundRefresh,
  logChurchFeatureFirstPaint,
  markChurchFeatureRefreshDone,
  shouldSkipChurchFeatureRefresh,
} from "@/src/lib/churchTabPreload";
import {
  markScreenFirstPainted,
  shouldBlockVisibleLoading,
  shouldSkipFocusRefresh,
} from "@/src/lib/screenOpenState";

const CHURCH_OVERVIEW_SCREEN = "ChurchOverview";
import { ChurchPremiumSubscriptionModal, isMinistryCreationBlocked } from "@/src/components/ChurchPremiumSubscriptionModal";
import { fetchChurchSubscriptionActive } from "@/src/lib/churchSubscription";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";

const VIP_BG = "#05070D";
const VIP_BG_MID = "#0A101C";
const GOLD = "#D9B35F";
const GOLD_SOFT = "rgba(217,179,95,0.55)";
const MUTED = "rgba(255,255,255,0.58)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_SECONDARY = "rgba(255,255,255,0.62)";
const LABEL_GOLD = "rgba(217,179,95,0.78)";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PAGE_HORIZONTAL = 16;
const STAT_GAP = 14;
const STAT_CARD_WIDTH = Math.floor((SCREEN_WIDTH - PAGE_HORIZONTAL * 2 - STAT_GAP) / 2);
const STAT_CARD_HEIGHT = 168;
const STAT_GRID_WIDTH = STAT_CARD_WIDTH * 2 + STAT_GAP;

type StatVariant = "blue" | "gold" | "purple" | "action";

function isRawChurchId(value?: string) {
  const s = String(value || "").trim();
  return /^CH\d+-[A-Z0-9]+$/i.test(s);
}

function isRawBackendId(value?: string) {
  const s = String(value || "").trim();
  if (!s) return true;
  if (/^u_[a-f0-9-]+$/i.test(s)) return true;
  if (/^[a-f0-9-]{24,}$/i.test(s)) return true;
  if (s.includes("@") && !s.includes(" ")) return true;
  return isRawChurchId(s);
}

function formatChurchDisplayName(name?: string, fallbackName?: string) {
  for (const candidate of [name, fallbackName]) {
    const s = String(candidate || "").trim();
    if (s && !isRawBackendId(s)) return s;
  }
  return "Your Church";
}

function formatPastorDisplayName(name?: string) {
  const s = String(name || "").trim();
  if (!s || isRawBackendId(s)) return "Pastor Not Assigned";
  return s;
}

function pastorInitial(name?: string) {
  const label = formatPastorDisplayName(name);
  if (label === "Pastor Not Assigned") return "P";
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

function LuxuryPressable({
  style,
  children,
  disabled,
  onPress,
}: {
  style?: any;
  children: React.ReactNode;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={style}
      onPressIn={() => {
        Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, speed: 48, bounciness: 3 }).start();
      }}
      onPressOut={() => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 48, bounciness: 3 }).start();
      }}
    >
      <Animated.View style={{ flex: 1, transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

type OverviewStats = {
  activeMembers: number;
  ministries: number;
  ministryMembers: number;
  unreadNotifications: number;
  offeringBalance: number;
};

function mediaUrl(u: any) {
  const v = String(u || "").trim();
  if (!v) return "";
  if (/^data:image\//i.test(v) || /^https?:\/\//i.test(v) || v.startsWith("file://")) return v;

  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

type ChurchProfile = {
  id?: string;
  name?: string;
  address?: string;
  phone?: string;
  pastorName?: string;
  avatarUri?: string;
  avatarUpdatedAt?: number;
};

function profileFromCache(churchId: string, cached: Awaited<ReturnType<typeof loadChurchProfileCache>>): ChurchProfile | null {
  if (!cached) return null;
  const avatarUri = String(cached.avatarUri || cached.avatarUrl || "").trim();
  return {
    id: churchId,
    name: String(cached.name || churchId),
    address: String(cached.address || ""),
    phone: String(cached.phone || ""),
    pastorName: String(cached.pastorName || ""),
    avatarUri: avatarUri ? mediaUrl(avatarUri) : "",
    avatarUpdatedAt: cached.avatarUpdatedAt,
  };
}

function overviewStatsSignature(stats: OverviewStats) {
  return `${stats.activeMembers}|${stats.ministries}|${stats.ministryMembers}|${stats.unreadNotifications}|${stats.offeringBalance}`;
}

function overviewProfileSignature(profile: ChurchProfile) {
  return `${profile.id}|${profile.name}|${profile.address}|${profile.phone}|${profile.pastorName}|${profile.avatarUri}|${profile.avatarUpdatedAt || 0}`;
}

function applyOverviewCachePayload(
  payload: ChurchOverviewCachePayload,
  mediaUrlFn: (raw: string) => string
): { profile: ChurchProfile; stats: OverviewStats } {
  const avatarRaw = String(payload.profile.avatarUri || "").trim();
  return {
    profile: {
      id: payload.profile.id,
      name: payload.profile.name,
      address: payload.profile.address,
      phone: payload.profile.phone,
      pastorName: payload.profile.pastorName,
      avatarUri: avatarRaw ? mediaUrlFn(avatarRaw) : "",
      avatarUpdatedAt: payload.profile.avatarUpdatedAt,
    },
    stats: { ...payload.stats },
  };
}

type MediaMinistryTarget = {
  id: string;
  name: string;
  mediaAccess?: boolean;
};

export default function ChurchOverviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const isFocused = useIsFocused();
  const { session, setSession } = useKristoSession();
  const refreshAt = String(params.refreshAt || "");
  const inviteId = String(params.inviteId || "").trim();
  const inviteStatus = String(params.inviteStatus || "Pending").trim().toLowerCase();

  const auth = getKristoAuth();
  const invitePreview = String(params.invitePreview || "") === "1";
  const paramChurchId = String(params.churchId || "").trim();

  useEffect(() => {
    let alive = true;

    async function refreshMembership() {
      try {
        const mine = await fetchMyActiveChurchMembership();
        if (!alive || !mine.churchId) return;

        await setSession({
          ...session,
          churchId: mine.churchId,
          role: mine.role || "Member",
          churchRole: mine.role || "Member",
          activeChurchId: mine.churchId,
        } as any);
      } catch {}
    }

    if (!String(session?.churchId || "").trim()) {
      void refreshMembership();
    }

    return () => {
      alive = false;
    };
  }, [session?.userId, session?.churchId]);

  const churchId = String(
    paramChurchId ||
      session?.churchId ||
      (session as any)?.activeChurchId ||
      ""
  ).trim();
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

  // Preview should READ the invited church like admin so data matches,
  // but UI actions remain locked by invitePreview.
  const effectiveAuthUserId = invitePreview
    ? String(auth?.userId || "preview-user")
    : String(session?.userId || auth?.userId || "");

  const effectiveAuthRole = invitePreview
    ? "Church_Admin"
    : String(session?.role || (session as any)?.churchRole || auth?.role || "Member");

  const getHeaders = () => ({
    accept: "application/json",
    "x-kristo-user-id": effectiveAuthUserId,
    "x-kristo-role": effectiveAuthRole,
    "x-kristo-church-id": churchId,
  });

  const logOverviewRequest = (url: string) => {
    if (!__DEV__) return;
    const h = getHeaders();
    console.log("[ChurchOverview] fetch", {
      url,
      "x-kristo-user-id": h["x-kristo-user-id"],
      "x-kristo-role": h["x-kristo-role"],
      "x-kristo-church-id": h["x-kristo-church-id"],
      sessionChurchId: session?.churchId || "",
      paramChurchId,
    });
  };

  const overviewCachePeek = useMemo(
    () =>
      churchId && effectiveAuthUserId && !invitePreview
        ? peekChurchOverviewCache(churchId, effectiveAuthUserId)
        : null,
    [churchId, effectiveAuthUserId, invitePreview]
  );
  const initialOverview = overviewCachePeek ? applyOverviewCachePayload(overviewCachePeek, mediaUrl) : null;

  const [stats, setStats] = useState<OverviewStats>(
    initialOverview?.stats || {
      activeMembers: 0,
      ministries: 0,
      ministryMembers: 0,
      unreadNotifications: 0,
      offeringBalance: 0,
    }
  );
  const [profile, setProfile] = useState<ChurchProfile>(
    initialOverview?.profile || {
      id: "",
      name: "",
      address: "",
      phone: "",
      pastorName: "",
      avatarUri: "",
      avatarUpdatedAt: undefined,
    }
  );
  const [bootLoading, setBootLoading] = useState(!initialOverview);
  const hasOverviewCacheRef = useRef(Boolean(initialOverview));
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState("");
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaTargets, setMediaTargets] = useState<MediaMinistryTarget[]>([]);
  const [mediaTargetsLoading, setMediaTargetsLoading] = useState(false);
  const [mediaTargetsSaved, setMediaTargetsSaved] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<"manage" | "studio">("studio");
  const initialMediaAccess =
    getCachedChurchMediaAccess() ||
    seedChurchMediaAccessFromSession({
      userId: effectiveAuthUserId,
      role: session?.role,
      churchRole: session?.churchRole,
    });
  const [canAccessChurchMedia, setCanAccessChurchMedia] = useState(
    Boolean(initialMediaAccess?.canAccessChurchMedia)
  );
  const [isActualChurchPastor, setIsActualChurchPastor] = useState(
    Boolean(initialMediaAccess?.isActualChurchPastor)
  );
  const statsSigRef = useRef(
    initialOverview ? overviewStatsSignature(initialOverview.stats) : ""
  );
  const profileSigRef = useRef(
    initialOverview ? overviewProfileSignature(initialOverview.profile) : ""
  );
  const firstPaintLoggedRef = useRef(false);
  const broadcastGateSigRef = useRef("");
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [previewChecked, setPreviewChecked] = useState(!invitePreview);
  const [previewCount, setPreviewCount] = useState(0);
  const [previewLimitReached, setPreviewLimitReached] = useState(false);
  const [churchSubscriptionActive, setChurchSubscriptionActive] = useState<boolean | null>(
    isSubscriptionBypassEnabled() ? true : null
  );
  const [premiumModalOpen, setPremiumModalOpen] = useState(false);
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!bootLoading && !err && !(invitePreview && previewLimitReached)) {
      contentOpacity.setValue(0);
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 480,
        useNativeDriver: true,
      }).start();
    }
  }, [bootLoading, err, invitePreview, previewLimitReached, contentOpacity]);

  useEffect(() => {
    if (!churchId || invitePreview || isSubscriptionBypassEnabled()) {
      setChurchSubscriptionActive(isSubscriptionBypassEnabled() ? true : null);
      return;
    }

    let alive = true;
    fetchChurchSubscriptionActive(churchId, getHeaders()).then((active) => {
      if (alive) setChurchSubscriptionActive(active);
    });

    return () => {
      alive = false;
    };
  }, [churchId, invitePreview, refreshAt]);

  useEffect(() => {
    let alive = true;

    async function checkPreviewLimit() {
      if (!invitePreview) {
        setPreviewChecked(true);
        setPreviewLimitReached(false);
        return;
      }

      const keyChurch = churchId || paramChurchId || "unknown-church";
      const keyInvite = inviteId || "no-invite";
      const keyUser = String(session?.userId || auth?.userId || "preview-user");
      const storageKey = `kristo:invite-preview-count:${keyUser}:${keyChurch}:${keyInvite}`;

      try {
        const current = Number(await AsyncStorage.getItem(storageKey) || "0");

        if (!alive) return;

        if (current >= 3) {
          setPreviewCount(current);
          setPreviewLimitReached(true);
          setPreviewChecked(true);
          return;
        }

        const next = current + 1;
        await AsyncStorage.setItem(storageKey, String(next));

        if (!alive) return;
        setPreviewCount(next);
        setPreviewLimitReached(false);
        setPreviewChecked(true);
      } catch {
        if (!alive) return;
        setPreviewCount(1);
        setPreviewLimitReached(false);
        setPreviewChecked(true);
      }
    }

    void checkPreviewLimit();

    return () => {
      alive = false;
    };
  }, [invitePreview, churchId, paramChurchId, inviteId, session?.userId, auth?.userId]);

  async function acceptPreviewInvite() {

    if (acceptingInvite) return;

    if (!inviteId) {
      Alert.alert("Invite missing", "This preview opened without an inviteId. Go back to Me → Invitations and tap View Profile again.");
      return;
    }
    const canAcceptInvite = inviteStatus === "pending" || inviteStatus === "requested";
    if (!canAcceptInvite) {
      Alert.alert("Invite not pending", `This invite is already ${inviteStatus}.`);
      return;
    }

    try {
      setAcceptingInvite(true);
      await handleInviteAction(inviteId, "accept");

      if (session?.userId) {
        await setSession({
          ...session,
          churchId,
          role: session.role || "Member",
        });
      }

      router.replace({ pathname: "/church/overview", params: { refreshAt: String(Date.now()) } } as any);
    } catch (e: any) {
      const msg = String(e?.message || e);

      if (msg.toLowerCase().includes("rejected")) {
        Alert.alert("Invite closed", "This invite was already rejected.");
        router.replace("/profile" as any);
        return;
      }

      Alert.alert("Accept failed", msg);
    } finally {
      setAcceptingInvite(false);
    }
  }

  useEffect(() => {
    if (!churchId || !effectiveAuthUserId || invitePreview) return;
    let alive = true;

    (async () => {
      const cached = (await getChurchOverviewCache(churchId, effectiveAuthUserId)) || overviewCachePeek;
      if (!alive || !cached) return;
      hasOverviewCacheRef.current = true;
      const next = applyOverviewCachePayload(cached, mediaUrl);
      const pSig = overviewProfileSignature(next.profile);
      const sSig = overviewStatsSignature(next.stats);
      if (pSig !== profileSigRef.current) {
        profileSigRef.current = pSig;
        setProfile(next.profile);
      }
      if (sSig !== statsSigRef.current) {
        statsSigRef.current = sSig;
        setStats(next.stats);
      }
      setBootLoading(false);
      if (__DEV__) {
        console.log("KRISTO_CHURCH_OVERVIEW_CACHE_HIT", {
          churchId,
          userId: effectiveAuthUserId,
          updatedAt: cached.updatedAt,
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [churchId, effectiveAuthUserId, invitePreview, refreshAt, overviewCachePeek]);

  async function load(opts?: { silent?: boolean; manual?: boolean }) {
    const silent = !!opts?.silent;
    const force = !!opts?.manual;
    if (
      silent &&
      !force &&
      churchId &&
      effectiveAuthUserId &&
      (shouldSkipChurchFeatureRefresh(CHURCH_OVERVIEW_SCREEN, churchId, effectiveAuthUserId) ||
        shouldSkipFocusRefresh(CHURCH_OVERVIEW_SCREEN, CHURCH_TAB_REFRESH_MS))
    ) {
      return;
    }

    if (silent) {
      setRefreshing(true);
      logChurchFeatureBackgroundRefresh(CHURCH_OVERVIEW_SCREEN, force ? "manual" : "silent-refresh");
    } else if (
      !hasOverviewCacheRef.current &&
      !shouldBlockVisibleLoading(CHURCH_OVERVIEW_SCREEN, hasOverviewCacheRef.current)
    ) {
      setBootLoading(true);
    }

    setErr(null);

    try {
      if (!churchId) throw new Error("churchId missing");
      if (!effectiveAuthUserId) throw new Error("userId missing");

      const cached = await getChurchOverviewCache(churchId, effectiveAuthUserId);
      if (cached) {
        hasOverviewCacheRef.current = true;
        const fromCache = applyOverviewCachePayload(cached, mediaUrl);
        const pSig = overviewProfileSignature(fromCache.profile);
        const sSig = overviewStatsSignature(fromCache.stats);
        if (pSig !== profileSigRef.current) {
          profileSigRef.current = pSig;
          setProfile(fromCache.profile);
        }
        if (sSig !== statsSigRef.current) {
          statsSigRef.current = sSig;
          setStats(fromCache.stats);
        }
        if (!silent) setBootLoading(false);
        if (__DEV__) {
          console.log("KRISTO_CHURCH_OVERVIEW_CACHE_HIT", {
            churchId,
            userId: effectiveAuthUserId,
            updatedAt: cached.updatedAt,
          });
        }
      } else {
        const legacy = await loadChurchProfileCache(churchId);
        const fromLegacy = profileFromCache(churchId, legacy);
        if (fromLegacy) {
          const pSig = overviewProfileSignature(fromLegacy);
          if (pSig !== profileSigRef.current) {
            profileSigRef.current = pSig;
            setProfile(fromLegacy);
          }
          if (!silent) setBootLoading(false);
        }
      }

      const overviewUrl = invitePreview
        ? `${base}/api/church/overview?invitePreview=1&inviteId=${encodeURIComponent(inviteId)}`
        : `${base}/api/church/overview`;

      logOverviewRequest(overviewUrl);

      const res = await fetch(overviewUrl, {
        method: "GET",
        headers: getHeaders(),
      });
      const j = await res.json().catch(() => ({} as any));

      if (!j?.ok) {
        if (__DEV__) {
          console.warn("[ChurchOverview] rejected", {
            status: res.status,
            error: (j as any)?.error,
            details: (j as any)?.details,
          });
        }
        throw new Error(String((j as any)?.error || "Fetch failed"));
      }

      const s = j?.data?.stats || {};
      const p = j?.data?.profile || {};
      const legacyProfileCache = await loadChurchProfileCache(churchId);
      const serverAvatarRaw = String(
        p?.avatarUri ||
        p?.avatarUrl ||
        p?.profileImage ||
        p?.profilePhoto ||
        p?.photo ||
        p?.image ||
        ""
      ).trim();

      const mergedAvatar = pickFresherAvatar({
        localUri: cached?.profile?.avatarUri || legacyProfileCache?.avatarUri || legacyProfileCache?.avatarUrl || "",
        localUpdatedAt: cached?.profile?.avatarUpdatedAt || legacyProfileCache?.avatarUpdatedAt,
        serverUri: serverAvatarRaw,
        serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
      });

      if (mergedAvatar.skippedStale) {
        console.log("[ChurchOverview] skipped stale server avatar", {
          churchId,
          localUpdatedAt: cached?.profile?.avatarUpdatedAt || legacyProfileCache?.avatarUpdatedAt || null,
          serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
        });
      }

      const nextAvatar = mergedAvatar.uri ? mediaUrl(mergedAvatar.uri) : "";
      const nextAvatarUpdatedAt =
        mergedAvatar.source === "local"
          ? cached?.profile?.avatarUpdatedAt || legacyProfileCache?.avatarUpdatedAt
          : nextAvatar
            ? Date.now()
            : cached?.profile?.avatarUpdatedAt || legacyProfileCache?.avatarUpdatedAt;

      const nextProfile: ChurchProfile = {
        id: String(p?.id || churchId || ""),
        name: String(p?.name || churchId || "Church"),
        address: String(p?.address || ""),
        phone: String(p?.phone || ""),
        pastorName: String(p?.pastorName || ""),
        avatarUri: nextAvatar,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      };
      const pSig = overviewProfileSignature(nextProfile);
      if (pSig !== profileSigRef.current) {
        profileSigRef.current = pSig;
        setProfile(nextProfile);
      }

      const nextStats = {
        activeMembers: Number(s?.activeMembers || 0),
        ministries: Number(s?.ministries || 0),
        ministryMembers: Number(s?.ministryMembers || 0),
        unreadNotifications: Number(s?.unreadNotifications || 0),
        offeringBalance: Number(s?.offeringBalance || 0),
      };
      const sSig = overviewStatsSignature(nextStats);
      if (sSig !== statsSigRef.current) {
        statsSigRef.current = sSig;
        setStats(nextStats);
      }

      try {
        const hostsRes: any = await apiGet("/api/church/media-hosts", {
          headers: getHeaders(),
        });
        const access = evaluateChurchMediaAccessClient({
          userId: effectiveAuthUserId,
          actualPastorUserId: hostsRes?.actualPastorUserId,
          mediaHostUserIds: hostsRes?.mediaHostUserIds,
          isActualChurchPastor: hostsRes?.isActualChurchPastor,
          isMediaHost: hostsRes?.isMediaHost,
          canAccessChurchMedia: hostsRes?.canAccessChurchMedia,
          canManageMediaHosts: hostsRes?.canManageMediaHosts,
        });
        setCanAccessChurchMedia(access.canAccessChurchMedia);
        setIsActualChurchPastor(access.isActualChurchPastor);
      } catch {
        setCanAccessChurchMedia(false);
        setIsActualChurchPastor(false);
      }

      hasOverviewCacheRef.current = true;
      await saveChurchOverviewCache({
        churchId,
        userId: effectiveAuthUserId,
        profile: {
          id: String(p?.id || churchId || ""),
          name: String(p?.name || churchId || "Church"),
          address: String(p?.address || ""),
          phone: String(p?.phone || ""),
          pastorName: String(p?.pastorName || ""),
          avatarUri: nextAvatar,
          avatarUpdatedAt: nextAvatarUpdatedAt,
        },
        stats: nextStats,
        updatedAt: Date.now(),
      });

      await saveChurchProfileCache({
        churchId,
        name: String(p?.name || churchId || "Church"),
        address: String(p?.address || ""),
        phone: String(p?.phone || ""),
        pastorName: String(p?.pastorName || ""),
        avatarUri: nextAvatar,
        avatarUrl: nextAvatar,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Error");

      if (invitePreview && msg.toLowerCase().includes("no active church membership")) {
        setProfile({
          id: churchId || paramChurchId || "",
          name: String(params.churchName || "Church Preview"),
          address: "",
          phone: "",
          pastorName: "",
          avatarUri: "",
        });
        setStats({
          activeMembers: 0,
          ministries: 0,
          ministryMembers: 0,
          unreadNotifications: 0,
          offeringBalance: 0,
        });
        setErr(null);
      } else {
        setErr(msg);
      }
    } finally {
      setBootLoading(false);
      setRefreshing(false);
      if (churchId && effectiveAuthUserId) {
        markChurchFeatureRefreshDone(CHURCH_OVERVIEW_SCREEN, churchId, effectiveAuthUserId);
      }
    }
  }

  const silentRefreshProfile = useCallback(async () => {
    if (!churchId || !effectiveAuthUserId) return;

    const cached = await loadChurchProfileCache(churchId);
    if (cached) {
      const fromCache = profileFromCache(churchId, cached);
      if (fromCache) setProfile(fromCache);
    }

    try {
      const j = await apiGet<any>("/api/church/profile", {
        headers: getKristoHeaders(),
      }, { screen: "ChurchOverview", throttleMs: 45000 }).catch(() => null);

      if (!j?.ok) return;

      const p = j?.data || j?.profile || {};
      const serverAvatarRaw = String(p?.avatarUri || p?.avatarUrl || "").trim();
      const mergedAvatar = pickFresherAvatar({
        localUri: cached?.avatarUri || cached?.avatarUrl || "",
        localUpdatedAt: cached?.avatarUpdatedAt,
        serverUri: serverAvatarRaw,
        serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
      });

      if (mergedAvatar.skippedStale) {
        console.log("[ChurchOverview] skipped stale server avatar", {
          churchId,
          localUpdatedAt: cached?.avatarUpdatedAt || null,
          serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
        });
      }

      const nextAvatar = mergedAvatar.uri ? mediaUrl(mergedAvatar.uri) : "";
      const nextAvatarUpdatedAt =
        mergedAvatar.source === "local" ? cached?.avatarUpdatedAt : nextAvatar ? Date.now() : cached?.avatarUpdatedAt;

      const nextProfile: ChurchProfile = {
        id: String(p?.id || churchId),
        name: String(p?.name || churchId),
        address: String(p?.address || ""),
        phone: String(p?.phone || ""),
        pastorName: String(p?.pastorName || ""),
        avatarUri: nextAvatar,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      };

      setProfile(nextProfile);

      await saveChurchProfileCache({
        churchId,
        name: nextProfile.name,
        address: nextProfile.address,
        phone: nextProfile.phone,
        pastorName: nextProfile.pastorName,
        avatarUri: nextProfile.avatarUri,
        avatarUrl: nextProfile.avatarUri,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      });

      if (session && nextProfile.name) {
        await setSession({
          ...session,
          churchName: nextProfile.name,
        } as any);
      }

      console.log("[ChurchOverview] silent refresh applied", {
        churchId,
        name: nextProfile.name,
        hasAvatar: Boolean(nextProfile.avatarUri),
      });
    } catch {}
  }, [churchId, effectiveAuthUserId, session, setSession]);

  const applyChurchProfileEvent = useCallback(
    async (payload: { name?: string; avatarUri?: string; avatarUrl?: string; avatarUpdatedAt?: number }) => {
      const cached = await loadChurchProfileCache(churchId);
      const avatarRaw =
        String(payload.avatarUri || payload.avatarUrl || cached?.avatarUri || cached?.avatarUrl || "").trim();
      const nextAvatar = avatarRaw ? mediaUrl(avatarRaw) : "";
      setProfile((prev) => ({
        ...prev,
        name: String(payload.name || cached?.name || prev.name || churchId),
        avatarUri: nextAvatar || prev.avatarUri,
        avatarUpdatedAt: payload.avatarUpdatedAt || cached?.avatarUpdatedAt || prev.avatarUpdatedAt,
      }));
      console.log("[ChurchOverview] event applied immediately", {
        churchId,
        hasAvatar: Boolean(nextAvatar),
        avatarUpdatedAt: payload.avatarUpdatedAt || cached?.avatarUpdatedAt || null,
      });
    },
    [churchId]
  );

  useEffect(() => {
    if (!isFocused) return;
    if (invitePreview && !previewChecked) return;
    if (invitePreview && previewLimitReached) {
      setBootLoading(false);
      setErr(null);
      return;
    }
    if (!firstPaintLoggedRef.current) {
      firstPaintLoggedRef.current = true;
      markScreenFirstPainted(CHURCH_OVERVIEW_SCREEN);
      logChurchFeatureFirstPaint(
        CHURCH_OVERVIEW_SCREEN,
        hasOverviewCacheRef.current,
        stats.activeMembers + stats.ministries
      );
    }
    if (isSaveCooldown(`church-profile:${churchId}`)) return;
    const force = Boolean(refreshAt);
    if (
      !force &&
      churchId &&
      effectiveAuthUserId &&
      (shouldSkipChurchFeatureRefresh(CHURCH_OVERVIEW_SCREEN, churchId, effectiveAuthUserId) ||
        shouldSkipFocusRefresh(CHURCH_OVERVIEW_SCREEN, CHURCH_TAB_REFRESH_MS))
    ) {
      return;
    }
    if (!force && !shouldAllowScreenRefresh("ChurchOverview", { forceKey: refreshAt, minMs: CHURCH_TAB_REFRESH_MS })) {
      return;
    }
    load({ silent: true, manual: force });
  }, [isFocused, refreshAt, invitePreview, previewChecked, previewLimitReached, churchId, effectiveAuthUserId]);

  useEffect(() => {
    return onChurchProfileUpdated((payload) => {
      if (String(payload.churchId || "").trim() !== churchId) return;
      void applyChurchProfileEvent(payload);
    });
  }, [churchId, applyChurchProfileEvent]);

  useEffect(() => {
    if (String(params.saved || "") !== "1") return;
    const nextName = String(params.savedName || profile.name || "Church profile");
    setSaveBanner(`${nextName} updated successfully`);
    const t = setTimeout(() => setSaveBanner(""), 2600);
    return () => clearTimeout(t);
  }, [params.saved, params.savedName, profile.name]);

  const role = String(effectiveAuthRole || "Member");
  const isMember = role === "Member";
  const isLeader = role === "Leader" || role === "Ministry_Leader";
  const isPastor = role === "Pastor";
  const isChurchAdmin = role === "Church_Admin";
  const isSystemAdmin = role === "System_Admin";

  const canSeeLeadershipOverview = isLeader || isPastor || isChurchAdmin || isSystemAdmin;
  const canSeeOfferings = isPastor || isChurchAdmin || isSystemAdmin;
  const canOpenMembers = !invitePreview;
  const canOpenMinistries = !invitePreview && canSeeLeadershipOverview;
  const createMinistryLocked =
    !invitePreview && canOpenMinistries && isMinistryCreationBlocked(churchSubscriptionActive);
  const canOpenOfferings = !invitePreview && canSeeOfferings;
  const canEditProfile = !invitePreview && (isPastor || isChurchAdmin || isSystemAdmin);
  const sessionRoleText = [
    role,
    String((session as any)?.role || ""),
    String((session as any)?.churchRole || ""),
  ].join(" ");
  const isPastorSession = /\bPastor\b/i.test(sessionRoleText);
  const canManageMinistryMediaAccess = !invitePreview && (isActualChurchPastor || isPastor || isPastorSession);
  const canOpenMediaStudio = !invitePreview && (canAccessChurchMedia || isPastor || isPastorSession);
  const showMediaControlCard = canOpenMediaStudio || canManageMinistryMediaAccess;
  const showMemberChurchAccessCard = !invitePreview && isMember && !showMediaControlCard;

  const broadcastGateSig = [
    role,
    isPastor,
    isPastorSession,
    isActualChurchPastor,
    canAccessChurchMedia,
    canManageMinistryMediaAccess,
    canOpenMediaStudio,
    showMediaControlCard,
  ].join("|");
  if (broadcastGateSig !== broadcastGateSigRef.current) {
    broadcastGateSigRef.current = broadcastGateSig;
    if (__DEV__) {
      console.log("KRISTO_BROADCAST_GATE", {
        role,
        isPastor,
        isPastorSession,
        isActualChurchPastor,
        canAccessChurchMedia,
        canManageMinistryMediaAccess,
        canOpenMediaStudio,
        showMediaControlCard,
      });
    }
  }

  function ministryInitial(name?: string) {
    return String(name || "M").trim().charAt(0).toUpperCase() || "M";
  }

  async function handleCreateMinistryPress() {
    if (!canOpenMinistries) {
      Alert.alert(
        "Admin access",
        "Only pastor or church admin can create ministries. Ukipewa admin access utaweza kutumia sehemu hii."
      );
      return;
    }

    let active = churchSubscriptionActive;
    if (active === null && !isSubscriptionBypassEnabled()) {
      active = await fetchChurchSubscriptionActive(churchId, getHeaders());
      setChurchSubscriptionActive(active);
    }
    if (isMinistryCreationBlocked(active)) {
      setPremiumModalOpen(true);
      return;
    }

    router.push("/church/ministries/create" as any);
  }

  function handlePremiumModalPrimary() {
    setPremiumModalOpen(false);
    if (isPastor || isPastorSession || isChurchAdmin || isSystemAdmin) {
      router.push("/more/payments/subscriptions" as any);
    }
  }

  async function saveMediaAccessChanges() {
    if (!canManageMinistryMediaAccess) return;

    const selectedIds = new Set(
      mediaTargets.filter((m) => m.mediaAccess).slice(0, 3).map((m) => m.id)
    );

    setMediaTargetsLoading(true);
    try {
      await Promise.all(
        mediaTargets.map((m) =>
          apiPatch<any>(
            `/api/church/ministries?id=${encodeURIComponent(m.id)}`,
            { mediaAccess: selectedIds.has(m.id) },
            { headers: getKristoHeaders() }
          )
        )
      );

      setMediaTargets((prev) =>
        prev
          .map((m) => ({ ...m, mediaAccess: selectedIds.has(m.id) }))
          .sort((a, b) => Number(!!b.mediaAccess) - Number(!!a.mediaAccess) || a.name.localeCompare(b.name))
      );

      setMediaTargetsSaved(true);
      setSaveBanner("Media access saved");
      setMediaPickerOpen(false);
      setTimeout(() => setSaveBanner(""), 2200);
      await load({ silent: true });
    } finally {
      setMediaTargetsLoading(false);
    }
  }

  async function openPastorMediaPicker(mode: "manage" | "studio" = "studio") {
    if (!canManageMinistryMediaAccess) return;
    setMediaPickerMode(mode);
    setMediaPickerOpen(true);
    setMediaTargetsLoading(true);
    setMediaTargetsSaved(false);

    try {
      const j = await apiGet<any>("/api/church/ministries", {
        headers: getHeaders(),
      });

      const list = Array.isArray(j?.data) ? j.data : [];
      let used = 0;

      setMediaTargets(
        list
          .map((m: any) => {
            const wantsAccess = m?.mediaAccess === true;
            const allowed = wantsAccess && used < 3;
            if (allowed) used += 1;

            return {
              id: String(m?.id || ""),
              name: String(m?.name || "Ministry"),
              mediaAccess: allowed,
            };
          })
          .filter((m: MediaMinistryTarget) => Boolean(m.id))
          .sort((a: MediaMinistryTarget, b: MediaMinistryTarget) => Number(!!b.mediaAccess) - Number(!!a.mediaAccess) || a.name.localeCompare(b.name))
      );
    } catch {
      setMediaTargets([]);
    } finally {
      setMediaTargetsLoading(false);
    }
  }

  function toggleMediaAccess(target: MediaMinistryTarget) {
    if (!canManageMinistryMediaAccess || !target?.id) return;

    setMediaTargets((prev) => {
      const selectedCount = prev.filter((x) => x.mediaAccess).length;

      return prev
        .map((item) => {
          if (item.id !== target.id) return item;

          if (item.mediaAccess) {
            return { ...item, mediaAccess: false };
          }

          if (selectedCount >= 3) {
            return item;
          }

          return { ...item, mediaAccess: true };
        })
        .sort((a, b) => Number(!!b.mediaAccess) - Number(!!a.mediaAccess) || a.name.localeCompare(b.name));
    });

    setMediaTargetsSaved(false);
  }

  function openMediaStudio(target?: MediaMinistryTarget) {
    setMediaPickerOpen(false);
    router.push({
      pathname: "/more/media" as any,
      params: {
        source: "church-overview",
        mediaScope: target?.id ? "ministry" : "church",
        ministryId: target?.id || "",
        ministryName: target?.name || "",
      },
    } as any);
  }

  const displayChurchName = formatChurchDisplayName(
    profile.name,
    String(params.churchName || "")
  );
  const pastorDisplay = formatPastorDisplayName(profile.pastorName);
  const churchVerified = !isRawBackendId(profile.name) && !!String(profile.name || "").trim();

  const cards = useMemo(() => {
    const memberCards = [
      {
        key: "members",
        label: "Active Members",
        value: stats.activeMembers,
        icon: "people-outline" as const,
        variant: "blue" as StatVariant,
        onPress: () => router.push("/church/members"),
      },

    ];

    const leaderOnlyCards = [
      {
        key: "ministries",
        label: "Ministries",
        value: stats.ministries,
        icon: "grid-outline" as const,
        variant: "gold" as StatVariant,
        onPress: () => {
          if (isPastor) router.push("/church/ministries" as any);
          else router.push("/more/ministries" as any);
        },
      },
      {
        key: "ministryMembers",
        label: "Ministry Members",
        value: stats.ministryMembers,
        icon: "person-add-outline" as const,
        variant: "purple" as StatVariant,
        onPress: () => {
          if (isPastor) router.push("/church/ministries" as any);
          else router.push("/more/ministries" as any);
        },
      },
    ];

    const offeringCards = canSeeOfferings
      ? [
        ]
      : [];

    if (invitePreview) return [...memberCards, ...leaderOnlyCards];
    if (isMember) return [...memberCards, ...leaderOnlyCards];
    if (canSeeLeadershipOverview) return [...memberCards, ...leaderOnlyCards, ...offeringCards];
    return memberCards;
  }, [stats, router, isMember, canSeeLeadershipOverview, canSeeOfferings, invitePreview]);

  return (
    <View style={s.root}>
      <LinearGradient
        pointerEvents="none"
        colors={["#03050A", VIP_BG, VIP_BG_MID, "#070C16"]}
        locations={[0, 0.35, 0.72, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={s.ambientGoldOrb} />
      <View pointerEvents="none" style={s.ambientBlueOrb} />
      <LinearGradient
        pointerEvents="none"
        colors={["transparent", "rgba(0,0,0,0.18)", "rgba(0,0,0,0.55)"]}
        locations={[0.55, 0.82, 1]}
        style={s.vignetteBottom}
      />

      <View style={[s.wrap, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 14 }]}>
        <View style={s.heroHeader}>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(217,179,95,0.14)", "rgba(217,179,95,0.03)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.heroGradient}
          />
          <View pointerEvents="none" style={s.heroTitleGlow} />

          <View style={s.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.h1}>Church Overview</Text>
            </View>

            <LuxuryPressable onPress={() => load({ silent: true })} style={s.refreshBtn}>
              <Ionicons name="refresh" size={18} color={TEXT_PRIMARY} />
            </LuxuryPressable>
          </View>
        </View>

      {invitePreview ? (
        <View style={s.successBanner}>
          <Ionicons name="eye-outline" size={16} color={GOLD} />
          <Text style={s.successBannerText}>
            {previewLimitReached
              ? "Preview limit reached • Accept invite to continue"
              : `Preview only • ${Math.max(0, 3 - previewCount)} view${Math.max(0, 3 - previewCount) === 1 ? "" : "s"} left`}
          </Text>

          <Pressable
            onPress={acceptPreviewInvite}
            style={s.bannerAcceptBtn}
          >
            <Text style={s.bannerAcceptText}>
              {acceptingInvite ? "Accepting..." : "Accept"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!!saveBanner && (
        <View style={s.successBanner}>
          <Ionicons name="checkmark-circle" size={16} color={GOLD} />
          <Text style={s.successBannerText}>{saveBanner}</Text>
        </View>
      )}

      {(bootLoading && !shouldBlockVisibleLoading(CHURCH_OVERVIEW_SCREEN, hasOverviewCacheRef.current)) ||
      (invitePreview && !previewChecked) ? (
        <ChurchOverviewSkeleton />
      ) : invitePreview && previewLimitReached ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>Preview limit reached</Text>
          <Text style={s.errorText}>You have used your 3 free previews. Accept this invitation to continue viewing this church.</Text>

          <Pressable onPress={acceptPreviewInvite} style={[s.btn, s.btnGold]}>
            <Text style={[s.btnText, s.btnTextGold]}>
              {acceptingInvite ? "Accepting..." : "Accept Invitation"}
            </Text>
          </Pressable>
        </View>
      ) : err ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>Failed to load</Text>
          <Text style={s.errorText}>{err}</Text>

          <Pressable onPress={() => load()} style={[s.btn, s.btnGold]}>
            <Text style={[s.btnText, s.btnTextGold]}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}
          style={{ opacity: contentOpacity }}
        >
          <View style={s.profileCardOuter}>
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "transparent"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 0.35 }}
              style={s.profileSheen}
            />
            {Platform.OS === "ios" ? (
              <BlurView pointerEvents="none" intensity={26} tint="dark" style={StyleSheet.absoluteFillObject} />
            ) : null}
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(217,179,95,0.10)", "rgba(8,14,26,0.88)", "rgba(5,8,14,0.94)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

            <View style={s.profileTop}>
              <View style={s.profileAvatarRing}>
                <View style={s.profileAvatarHalo} pointerEvents="none" />
                {profile.avatarUri ? (
                  <Image
                    source={{ uri: avatarCacheBust(profile.avatarUri, profile.avatarUpdatedAt) }}
                    style={s.profileAvatar}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={s.profileIcon}>
                    <Ionicons name="business-outline" size={28} color={GOLD} />
                  </View>
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.profileEyebrow}>Church Profile</Text>
                <Text style={s.profileChurch} numberOfLines={2}>
                  {displayChurchName}
                </Text>
                {churchVerified ? (
                  <View style={s.profileVerifiedRow}>
                    <Ionicons name="shield-checkmark" size={12} color={GOLD_SOFT} />
                    <Text style={s.profileVerifiedText}>Verified church identity</Text>
                  </View>
                ) : null}
              </View>

              {canEditProfile ? (
                <LuxuryPressable
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/church/edit" as any,
                      params: {
                        name: profile.name || "",
                        pastorName: profile.pastorName || "",
                        address: profile.address || "",
                        phone: profile.phone || "",
                      },
                    })
                  }
                  style={s.profileEditBtn}
                >
                  <Ionicons name="create-outline" size={16} color={GOLD} />
                </LuxuryPressable>
              ) : null}
            </View>

            <View style={s.profileInfoList}>
              <View style={s.profileInfoRow}>
                <View style={s.pastorAvatar}>
                  <Text style={s.pastorAvatarText}>{pastorInitial(profile.pastorName)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.profileInfoLabel}>Pastor</Text>
                  <Text style={s.profileInfoValue}>{pastorDisplay}</Text>
                </View>
              </View>

              <View style={s.profileInfoRow}>
                <View style={s.profileInfoIconWrap}>
                  <Ionicons name="location-outline" size={15} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.profileInfoLabel}>Address</Text>
                  <Text style={s.profileInfoValue}>{profile.address || "—"}</Text>
                </View>
              </View>

              <View style={s.profileInfoRow}>
                <View style={s.profileInfoIconWrap}>
                  <Ionicons name="call-outline" size={15} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.profileInfoLabel}>Phone</Text>
                  <Text style={s.profileInfoValue}>{profile.phone || "—"}</Text>
                </View>
              </View>
            </View>
          </View>

          {showMemberChurchAccessCard ? (
            <View style={[s.powerCardOuter, s.memberAccessCard]}>
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(86,139,255,0.14)", "rgba(10,16,28,0.96)", "rgba(4,7,12,0.98)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View pointerEvents="none" style={s.memberAccessGlow} />
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(86,139,255,0.42)", "rgba(217,179,95,0.12)", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={s.powerTopGoldLine}
              />

              <View style={s.powerTop}>
                <View style={s.powerIconOuter}>
                  <View style={s.memberAccessIconHalo} pointerEvents="none" />
                  <LinearGradient
                    colors={["#8FB5FF", "#568BFF", "#2E5FBF"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.powerIcon}
                  >
                    <Ionicons name="people" size={19} color="#061020" />
                  </LinearGradient>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.memberAccessEyebrow}>Church Access</Text>
                  <Text style={s.powerTitle}>Serve with your church</Text>
                </View>
              </View>

              <View style={s.powerActions}>
                <LuxuryPressable
                  onPress={() => router.push("/more/ministries" as any)}
                  style={s.powerBtn}
                >
                  <View style={s.powerBtnContent}>
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.10)", "transparent"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={s.powerBtnHighlight}
                    />
                    <Ionicons name="grid-outline" size={16} color="#8FB5FF" />
                    <Text style={[s.powerBtnText, s.memberAccessBtnText]}>Ministries</Text>
                  </View>
                </LuxuryPressable>

                <LuxuryPressable
                  onPress={async () => {
                    try {
                      const feedRes: any = await apiGet("/api/church/feed", {
                        headers: getHeaders(),
                      } as any);

                      const rows = Array.isArray(feedRes?.items)
                        ? feedRes.items
                        : Array.isArray(feedRes?.data)
                          ? feedRes.data
                          : Array.isArray(feedRes)
                            ? feedRes
                            : [];

                      const hasOpenMediaSlot = rows.some((item: any) => {
                        const source = String(item?.source || "");
                        const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
                        if (!source.includes("media-schedule") && !slots.length) return false;

                        return slots.some((slot: any) => {
                          const claimedByUserId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
                          const locked = slot?.locked === true || slot?.isLocked === true;
                          return !claimedByUserId && !locked;
                        });
                      });

                      if (!hasOpenMediaSlot) {
                        Alert.alert(
                          "No media slots available",
                          "There is no open media schedule slot right now. Please check again later when your church media team creates a schedule."
                        );
                        return;
                      }

                      router.push({ pathname: "/(tabs)", params: { tab: "home", focus: "media-slots" } } as any);
                    } catch {
                      Alert.alert(
                        "Unable to check media slots",
                        "Please try again in a moment."
                      );
                    }
                  }}
                  style={s.powerBtnGoldWrap}
                >
                  <LinearGradient
                    colors={["#F2D792", GOLD, "#A67C2E"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.powerBtnGold}
                  >
                    <Ionicons name="radio-outline" size={16} color="#0B0F17" />
                    <Text style={s.powerBtnGoldText}>Claim Media Slot</Text>
                  </LinearGradient>
                </LuxuryPressable>
              </View>
            </View>
          ) : null}

          {showMediaControlCard ? (
            <View style={[s.powerCardOuter, !canOpenMediaStudio && !canManageMinistryMediaAccess && { opacity: 0.92 }]}>
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(217,179,95,0.16)", "rgba(10,16,28,0.96)", "rgba(4,7,12,0.98)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View pointerEvents="none" style={s.powerAmbientGlow} />
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(217,179,95,0.50)", "rgba(217,179,95,0.10)", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={s.powerTopGoldLine}
              />
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0.02)", "transparent"]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 0.55 }}
                style={s.powerSheen}
              />

              <View style={s.powerTop}>
                <View style={s.powerIconOuter}>
                  <View style={s.powerIconBroadcast} pointerEvents="none" />
                  <LinearGradient
                    colors={["#F0D48A", GOLD, "#B8893A"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.powerIcon}
                  >
                    <Ionicons name="videocam" size={19} color="#0B0F17" />
                  </LinearGradient>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.powerEyebrow}>Broadcast Control</Text>
                  <Text style={s.powerTitle}>Ministry Media Control</Text>
                </View>
              </View>

              <View style={s.powerActions}>
                <LuxuryPressable
                  onPress={() => {
                    if (!canManageMinistryMediaAccess) {
                      Alert.alert("Pastor access required", "Only the church Pastor can manage ministry media access.");
                      return;
                    }
                    openPastorMediaPicker("manage");
                  }}
                  style={s.powerBtn}
                >
                  <View style={s.powerBtnContent}>
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.10)", "transparent"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={s.powerBtnHighlight}
                    />
                    <Ionicons name="grid-outline" size={16} color={GOLD} />
                    <Text style={s.powerBtnText}>Ministries</Text>
                  </View>
                </LuxuryPressable>

                <LuxuryPressable
                  onPress={() => {
                    if (!canOpenMediaStudio) {
                      Alert.alert(
                        "Pastor access required",
                        "Only the church Pastor and trusted media hosts can open Media Studio."
                      );
                      return;
                    }
                    openPastorMediaPicker("studio");
                  }}
                  style={s.powerBtnGoldWrap}
                >
                  <LinearGradient
                    colors={["#F2D792", GOLD, "#A67C2E"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.powerBtnGold}
                  >
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.34)", "transparent"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 0.55 }}
                      style={s.powerBtnGoldShimmer}
                    />
                    <Ionicons name="radio-outline" size={16} color="#0B0F17" />
                    <Text style={s.powerBtnGoldText}>Media Studio</Text>
                  </LinearGradient>
                </LuxuryPressable>
              </View>
            </View>
          ) : null}

          <View style={s.statsGrid}>
            {cards.map((c) => {
              const variantStyles =
                c.variant === "blue"
                  ? { card: s.statCardBlue, icon: s.statIconBlue, iconColor: "#7EB4FF", glow: s.statGlowBlue }
                  : c.variant === "gold"
                  ? { card: s.statCardGoldGlow, icon: s.statIconGoldGlow, iconColor: GOLD, glow: s.statGlowGold }
                  : c.variant === "purple"
                  ? { card: s.statCardPurple, icon: s.statIconPurple, iconColor: "#C4A0FF", glow: s.statGlowPurple }
                  : { card: s.statCardAction, icon: s.statIconAction, iconColor: GOLD, glow: s.statGlowAction };

              return (
                <LuxuryPressable
                  key={c.key}
                  disabled={invitePreview}
                  onPress={invitePreview ? undefined : c.onPress}
                  style={[s.statCardBase, variantStyles.card, invitePreview && { opacity: 0.92 }]}
                >
                  <View style={variantStyles.glow} pointerEvents="none" />
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(255,255,255,0.14)", "rgba(217,179,95,0.05)", "transparent"]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={s.statCardSheen}
                  />
                  <View style={variantStyles.icon}>
                    <Ionicons name={c.icon} size={18} color={variantStyles.iconColor} />
                  </View>
                  <Text style={s.statValue}>{c.value}</Text>
                  <Text style={s.statLabel} numberOfLines={2}>
                    {c.label}
                  </Text>
                </LuxuryPressable>
              );
            })}
            {!invitePreview ? (
            <LuxuryPressable
              onPress={handleCreateMinistryPress}
              style={[
                s.statCardBase,
                createMinistryLocked ? s.statCardPremiumLocked : s.statCardAction,
                !canOpenMinistries && { opacity: 0.92 },
              ]}
            >
              <View style={s.statGlowAction} pointerEvents="none" />
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.14)", "rgba(217,179,95,0.10)", "transparent"]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={s.statCardSheen}
              />
              <View style={[s.statIconAction, createMinistryLocked && s.statIconPremiumLocked]}>
                <Ionicons
                  name={createMinistryLocked ? "lock-closed" : "add-circle-outline"}
                  size={createMinistryLocked ? 18 : 22}
                  color={GOLD}
                />
              </View>
              <Text style={[s.statValue, s.statValueGold, createMinistryLocked && s.statValueLocked]}>
                {createMinistryLocked ? "◆" : "+"}
              </Text>
              <Text style={s.statLabel} numberOfLines={2}>
                Create Ministry
              </Text>
              {createMinistryLocked ? (
                <Text style={s.statPremiumTag}>Premium</Text>
              ) : null}
            </LuxuryPressable>
          ) : null}
        </View>

          
        </Animated.ScrollView>
      )}

      <Modal visible={mediaPickerOpen} animationType="slide" onRequestClose={() => setMediaPickerOpen(false)}>
        <View style={[s.mediaFullScreen, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }]}>
          <View style={s.mediaFullHeader}>
            <Pressable onPress={() => setMediaPickerOpen(false)} style={s.mediaFullBackBtn}>
              <Ionicons name="chevron-back" size={22} color="white" />
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={s.mediaFullTitle}>
                {mediaPickerMode === "studio" ? "Choose Media Studio" : "Manage Media Access"}
              </Text>
              <Text style={s.mediaFullSub}>
                {mediaPickerMode === "studio"
                  ? `Church + ${Math.min(3, mediaTargets.filter((m) => m.mediaAccess).length)}/3 selected ministries`
                  : `Church + ${Math.min(3, mediaTargets.filter((m) => m.mediaAccess).length)}/3 selected ministries`}
              </Text>
            </View>

            {mediaPickerMode === "manage" ? (
              <Pressable onPress={saveMediaAccessChanges} style={s.mediaFullSaveBtn}>
                <Ionicons name={mediaTargetsSaved ? "checkmark-circle" : "save-outline"} size={16} color="#0B0F17" />
                <Text style={s.mediaFullSaveText}>{mediaTargetsSaved ? "Saved" : "Save"}</Text>
              </Pressable>
            ) : null}
          </View>

          {mediaPickerMode === "studio" ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.mediaFullList}>
              <Pressable onPress={() => openMediaStudio()} style={s.mediaStudioBigCard}>
                <View style={s.mediaAvatarGold}>
                  <Ionicons name="business-outline" size={22} color="#0B0F17" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.mediaChoiceTitle}>Church Live Control</Text>
                  <Text style={s.mediaChoiceSub}>Direct pastor go live</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
              </Pressable>

              {mediaTargets
                .filter((m) => m.mediaAccess)
                .slice(0, 3)
                .map((m) => (
                  <Pressable key={m.id} onPress={() => openMediaStudio(m)} style={s.mediaStudioBigCard}>
                    <View style={s.mediaAvatar}>
                      <Text style={s.mediaAvatarText}>{ministryInitial(m.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.mediaChoiceTitle}>{m.name}</Text>
                      <Text style={s.mediaChoiceSub}>Ministry media studio</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
                  </Pressable>
                ))}
            </ScrollView>
          ) : (
            <>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.mediaFullList}>
                {mediaTargetsLoading ? (
                  <Text style={s.mediaFullSub}>Loading ministries…</Text>
                ) : (
                  mediaTargets
                    .slice()
                    .sort((a, b) => Number(b.mediaAccess) - Number(a.mediaAccess) || a.name.localeCompare(b.name))
                    .map((m) => {
                      const selectedCount = mediaTargets.filter((x) => x.mediaAccess).length;
                      const lockedAdd = !m.mediaAccess && selectedCount >= 3;

                      return (
                        <View key={m.id} style={[s.mediaManageRow, m.mediaAccess && s.mediaManageRowOn]}>
                          <View style={m.mediaAccess ? s.mediaAvatarGold : s.mediaAvatar}>
                            <Text style={[s.mediaAvatarText, m.mediaAccess && s.mediaAvatarTextGold]}>
                              {ministryInitial(m.name)}
                            </Text>
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text style={s.mediaChoiceTitle}>{m.name}</Text>
                            <Text style={s.mediaChoiceSub}>
                              {m.mediaAccess ? "Media access ON" : lockedAdd ? "Limit reached: remove one first" : "Media access OFF"}
                            </Text>
                          </View>

                          <Pressable
                            onPress={() => toggleMediaAccess(m)}
                            style={[s.mediaSwitch, m.mediaAccess && s.mediaSwitchOn, lockedAdd && s.mediaSwitchDisabled]}
                          >
                            <View style={[s.mediaSwitchKnob, m.mediaAccess && s.mediaSwitchKnobOn]} />
                          </Pressable>
                        </View>
                      );
                    })
                )}
              </ScrollView>

              <View style={s.mediaRuleCard}>
                <Ionicons name="lock-closed-outline" size={18} color={GOLD} />
                <View style={{ flex: 1 }}>
                  <Text style={s.mediaRuleTitle}>30-day ministry access rule</Text>
                  <Text style={s.mediaRuleText}>
                    You can change or remove a ministry from media access after 30 days. Next change date will show here after saving.
                  </Text>
                  <Text style={s.mediaRuleDate}>Next allowed change: after 30 days</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </Modal>

      <ChurchPremiumSubscriptionModal
        visible={premiumModalOpen}
        onClose={() => setPremiumModalOpen(false)}
        onViewSubscription={handlePremiumModalPrimary}
      />
      </View>
    </View>
  );
}

const s = StyleSheet.create<any>({
  root: {
    flex: 1,
    backgroundColor: VIP_BG,
  },
  ambientGoldOrb: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  ambientBlueOrb: {
    position: "absolute",
    top: 280,
    left: -80,
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: "rgba(72,120,255,0.07)",
  },
  vignetteBottom: {
    ...StyleSheet.absoluteFillObject,
  },

  wrap: { flex: 1, paddingHorizontal: 16, alignItems: "stretch" },

  heroHeader: {
    marginBottom: 6,
    borderRadius: 20,
    overflow: "hidden",
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
  },
  heroTitleGlow: {
    position: "absolute",
    top: 4,
    left: 8,
    width: 140,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.04)",
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    shadowColor: GOLD,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },

  h1: {
    color: TEXT_PRIMARY,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.12,
    lineHeight: 32,
  },
  heroIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  heroChurchName: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
    maxWidth: "78%",
    textShadowColor: "rgba(217,179,95,0.35)",
    textShadowRadius: 12,
    textShadowOffset: { width: 0, height: 0 },
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  verifiedBadgeText: {
    color: LABEL_GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  heroSubtitle: {
    color: TEXT_SECONDARY,
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    letterSpacing: 0.15,
  },
  p: { color: MUTED, marginTop: 6, fontSize: 13, lineHeight: 18 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },

  bannerAcceptBtn: {
    marginLeft: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: GOLD,
  },
  bannerAcceptText: {
    color: "#0B0F17",
    fontWeight: "700",
    fontSize: 12,
  },

  profileCardOuter: {
    borderRadius: 28,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 12,
    marginTop: 0,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(8,14,24,0.72)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  profileSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 64,
  },

  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },

  profileAvatarRing: {
    width: 70,
    height: 70,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(217,179,95,0.42)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },
  profileAvatarHalo: {
    position: "absolute",
    width: 82,
    height: 82,
    borderRadius: 26,
    backgroundColor: "rgba(217,179,95,0.10)",
  },

  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  profileIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },

  profileEditBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },

  profileEyebrow: {
    color: LABEL_GOLD,
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },

  profileChurch: {
    color: TEXT_PRIMARY,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 26,
    letterSpacing: 0.2,
  },
  profileVerifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  profileVerifiedText: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  profileInfoList: {
    gap: 8,
    paddingTop: 0,
  },

  profileInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  pastorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  pastorAvatarText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },
  profileInfoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
  },

  profileInfoLabel: {
    color: LABEL_GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 2,
  },

  profileInfoValue: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },

  errorCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(120,20,20,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,90,90,0.22)",
  },
  errorTitle: { color: TEXT_PRIMARY, fontSize: 15, fontWeight: "900" },
  errorText: { color: "rgba(255,255,255,0.78)", marginTop: 6, fontSize: 13, lineHeight: 18 },

  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  successBannerText: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },

  statsGrid: {
    width: STAT_GRID_WIDTH,
    alignSelf: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: STAT_GAP,
    rowGap: 14,
    marginTop: 12,
    marginBottom: 26,
  },

  statCardBase: {
    width: STAT_CARD_WIDTH,
    height: STAT_CARD_HEIGHT,
    borderRadius: 24,
    padding: 16,
    overflow: "hidden",
    borderWidth: 1,
    justifyContent: "space-between",
  },
  statCardSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 54,
  },
  statGlowBlue: {
    position: "absolute",
    bottom: -20,
    right: -10,
    width: 90,
    height: 90,
    borderRadius: 999,
    backgroundColor: "rgba(72,140,255,0.16)",
  },
  statGlowGold: {
    position: "absolute",
    bottom: -18,
    right: -8,
    width: 88,
    height: 88,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  statGlowPurple: {
    position: "absolute",
    bottom: -18,
    right: -8,
    width: 88,
    height: 88,
    borderRadius: 999,
    backgroundColor: "rgba(168,120,255,0.16)",
  },
  statGlowAction: {
    position: "absolute",
    top: -16,
    left: -10,
    width: 100,
    height: 100,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.18)",
  },

  statCardBlue: {
    backgroundColor: "rgba(8,16,32,0.94)",
    borderColor: "rgba(72,140,255,0.28)",
    shadowColor: "#4A90FF",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  statCardGoldGlow: {
    backgroundColor: "rgba(14,12,8,0.94)",
    borderColor: "rgba(217,179,95,0.30)",
    shadowColor: GOLD,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  statCardPurple: {
    backgroundColor: "rgba(12,10,22,0.94)",
    borderColor: "rgba(168,120,255,0.30)",
    shadowColor: "#A878FF",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  statCardAction: {
    backgroundColor: "rgba(16,14,8,0.95)",
    borderColor: "rgba(217,179,95,0.38)",
    shadowColor: GOLD,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  statCardPremiumLocked: {
    backgroundColor: "rgba(10,12,18,0.96)",
    borderColor: "rgba(217,181,109,0.58)",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  statIconBlue: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(72,140,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(72,140,255,0.28)",
  },
  statIconGoldGlow: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  statIconPurple: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(168,120,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(168,120,255,0.30)",
  },
  statIconAction: {
    width: 40,
    height: 40,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.36)",
  },
  statIconPremiumLocked: {
    backgroundColor: "rgba(217,179,95,0.12)",
    borderColor: "rgba(217,181,109,0.45)",
  },

  statValue: {
    color: TEXT_PRIMARY,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  statValueGold: { color: GOLD },
  statValueLocked: { fontSize: 24, lineHeight: 28, opacity: 0.82 },
  statPremiumTag: {
    marginTop: 4,
    color: LABEL_GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  statLabel: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 6,
    opacity: 0.92,
    flexShrink: 1,
    width: "100%",
  },

  powerCardOuter: {
    marginTop: 0,
    marginBottom: 12,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  powerAmbientGlow: {
    position: "absolute",
    top: -30,
    right: -20,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  memberAccessCard: {
    borderColor: "rgba(86,139,255,0.34)",
  },
  memberAccessGlow: {
    position: "absolute",
    bottom: -42,
    right: -28,
    width: 150,
    height: 150,
    borderRadius: 999,
    backgroundColor: "rgba(86,139,255,0.12)",
  },
  memberAccessIconHalo: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(86,139,255,0.18)",
  },
  memberAccessEyebrow: {
    color: "#8FB5FF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  memberAccessBtnText: {
    color: "#8FB5FF",
  },
  powerSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 44,
  },
  powerTopGoldLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },

  powerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  powerIconOuter: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  powerIconBroadcast: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(217,179,95,0.18)",
  },
  powerIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  powerEyebrow: {
    color: LABEL_GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  powerTitle: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
    lineHeight: 20,
  },
  powerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  powerBtn: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  powerBtnContent: {
    flex: 1,
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  powerBtnHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 20,
  },
  powerBtnGoldWrap: {
    flex: 1.15,
    height: 44,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  powerBtnGold: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    overflow: "hidden",
  },
  powerBtnGoldShimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 26,
  },
  powerBtnText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  powerBtnGoldText: {
    color: "#0B0F17",
    fontWeight: "900",
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.2,
  },

  mediaModalShade: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "center",
    padding: 18,
  },
  mediaModalCard: {
    width: "90%",
    height: "74%",
    borderRadius: 30,
    padding: 18,
    backgroundColor: "#0B111D",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.48)",
    overflow: "hidden",
  },
  mediaModalTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  mediaModalTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  },
  mediaModalSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
  },
  mediaModalClose: {
    width: 38,
    height: 38,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  mediaChoice: {
    minHeight: 66,
    borderRadius: 19,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  mediaChoiceTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  mediaChoiceSub: {
    marginTop: 2,
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "700",
  },


  mediaModalList: {
    flex: 1,
    marginTop: 10,
    marginBottom: 2,
  },

  mediaFooter: {
    paddingTop: 10,
    backgroundColor: "#0B111D",
  },

  mediaSaveBtn: {
    height: 54,
    borderRadius: 19,
    marginTop: 12,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  mediaSaveText: {
    color: "#0B0F17",
    fontSize: 14,
    fontWeight: "900",
  },
  createMinistryCard: {
    marginTop: 18,
    minHeight: 118,
    borderRadius: 30,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1.4,
    borderColor: "rgba(217,179,95,0.42)",
  },
  createMinistryIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
  },
  createMinistryTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  createMinistrySub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "800",
  },

  mediaAccessToggleDisabled: {
    opacity: 0.45,
  },


  mediaFullScreen: {
    flex: 1,
    backgroundColor: "#070B14",
    paddingHorizontal: 18,
  },
  mediaFullHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  mediaFullBackBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  mediaFullTitle: {
    color: "white",
    fontSize: 25,
    fontWeight: "900",
  },
  mediaFullSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "800",
  },
  mediaFullSaveBtn: {
    height: 44,
    borderRadius: 18,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: GOLD,
  },
  mediaFullSaveText: {
    color: "#0B0F17",
    fontSize: 12,
    fontWeight: "900",
  },
  mediaFullList: {
    paddingTop: 4,
    paddingBottom: 18,
    gap: 10,
  },
  mediaManageRow: {
    minHeight: 82,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  mediaManageRowOn: {
    backgroundColor: "rgba(217,179,95,0.105)",
    borderColor: "rgba(217,179,95,0.42)",
  },
  mediaAvatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.25)",
  },
  mediaAvatarGold: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  mediaAvatarText: {
    color: GOLD,
    fontSize: 18,
    fontWeight: "900",
  },
  mediaAvatarTextGold: {
    color: "#0B0F17",
  },
  mediaSwitch: {
    width: 58,
    height: 34,
    borderRadius: 999,
    padding: 4,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  mediaSwitchOn: {
    backgroundColor: GOLD,
    borderColor: GOLD,
    alignItems: "flex-end",
  },
  mediaSwitchDisabled: {
    opacity: 0.42,
  },
  mediaSwitchKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  mediaSwitchKnobOn: {
    backgroundColor: "#0B0F17",
  },
  mediaStudioBigCard: {
    minHeight: 84,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  mediaRuleCard: {
    marginTop: 8,
    borderRadius: 22,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  mediaRuleTitle: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },
  mediaRuleText: {
    marginTop: 3,
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  mediaRuleDate: {
    marginTop: 7,
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
  },

  actionsWrap: { gap: 10, marginTop: 2 },
  btn: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  btnGold: {
    borderColor: "rgba(217,179,95,0.32)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  btnGoldSoft: {
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  btnText: { color: "white", fontSize: 14, fontWeight: "800", letterSpacing: 0.2, textAlign: "center" },
  btnTextGold: { color: GOLD },

});
