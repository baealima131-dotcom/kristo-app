import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useMemo, useState, useEffect } from "react";
import { AppState, ActivityIndicator,
  Alert,
  Modal,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View, } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { isSessionExitInProgress } from "@/src/lib/kristoSessionExitFlags";
import { loadProfileDraft, saveProfileDraft, type ProfileDraft } from "@/src/lib/profileStore";
import { onUserProfileUpdated, onClaimUpdated } from "@/src/lib/kristoProfileEvents";
import { onSlotClaimChanged } from "@/src/lib/slotClaimEvents";
import {
  inviteEventTargetsCurrentUser,
  onChurchInviteSent,
  onChurchInviteAccepted,
  onChurchMembershipChanged,
} from "@/src/lib/kristoChurchInviteEvents";
import { buildProfileClaimedSchedules, onLiveRingRefresh } from "@/src/lib/liveScheduleRing";
import { avatarCacheBust, pickFresherAvatar } from "@/src/lib/avatarFreshness";
import {
  isSaveCooldown,
  logTrafficCache,
  shouldAllowScreenRefresh,
  clearResponseCacheForRequest,
} from "@/src/lib/kristoTraffic";
import { shouldPauseBackgroundProfileRefresh } from "@/src/lib/mediaScheduleFlowFlags";
import { useFocusedPolling } from "@/src/lib/useFocusedPolling";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getPaymentsState, subscribePayments } from "../../../src/store/paymentsStore";
import { isPlanActive } from "../../../src/lib/payments/mobileSubscriptions";
import { handleInviteAction } from "@/src/lib/churchMembersApi";
import { resolveChurchDisplayName } from "@/src/lib/churchStore";
import { countsAsRealActiveChurchId, resolveActiveChurchFromProfileResponse, isActiveMembershipStatus } from "@/src/lib/churchMembershipSync";
import {
  getProfileScreenCache,
  peekProfileScreenCache,
  saveProfileScreenCache,
  type ProfileScreenCachePayload,
} from "@/src/lib/screenDataCache";
import { hydrateMediaPosterCache } from "@/src/lib/mediaPosterCache";
import { ProfileHeroSkeleton } from "@/src/components/PremiumTabSkeletons";
import { feedList, subscribe as subscribeHomeFeed, ensureRingClaimStoresHydrated } from "@/src/lib/homeFeedStore";
import ChurchActivityGrid from "@/src/components/ChurchActivityGrid";
import ChurchActivityMemberChips from "@/src/components/ChurchActivityMemberChips";
import { fetchChurchMembers } from "@/src/lib/churchMembersApi";
import {
  activityIsVideo,
  getChurchActivityPosts,
  isChurchActivityPost,
  isMediaActivityPost,
  type ActivityGridItem,
  type ChurchActivityMemberFilter,
} from "@/src/lib/churchActivityPosts";
import { homeFeedMediaUrl } from "@/src/components/homeFeed/homeFeedUtils";
import {
  isOfflineSupervisorProfileInvite,
  loadOfflineSupervisorProfileInvites,
  respondOfflineSupervisorProfileInvite,
} from "@/src/lib/profileOfflineSupervisorInvites";
import {
  isOfflineAgentProfileInvite,
  loadOfflineAgentProfileInvites,
  respondOfflineAgentProfileInvite,
} from "@/src/lib/profileOfflineAgentInvites";

type AuthProfile = {
  userId: string;
  fullName?: string;
  phone?: string;
  country?: string;
  city?: string;
  avatarUrl?: string;
  profileStatus?: "Incomplete" | "Complete" | "Locked";
};

type AuthProfileRes = {
  ok?: boolean;
  profile?: AuthProfile;
};

type UserPostsRes = {
  ok?: boolean;
  data?: {
    userId?: string;
    items?: Array<{
      id: string;
      caption?: string;
      type?: string;
      createdAt?: number | string;
      videoUrl?: string;
      imageUrl?: string;
   }>;
 };
};

type ChurchFeedItemLite = {
  id: string;
  createdBy?: string;
  type?: "post" | "announcement" | "video" | string;
  title?: string;
  text?: string;
  videoUrl?: string;
  createdAt?: string;
};

type ChurchFeedRes = {
  ok?: boolean;
  data?: ChurchFeedItemLite[];
};

type UserOverviewRes = {
  ok?: boolean;
  data?: {
    userId?: string;
    followersCount?: number;
    followingCount?: number;
    postsCount?: number;
    viewerFollowsTarget?: boolean;
 };
};

function formatClaimedScheduleDate(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "Date TBD";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date TBD";

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatClaimedClock(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = String(match[3] || "").toUpperCase();

    if (meridiem) {
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${String(minute).padStart(2, "0")} ${meridiem}`;
    }

    const displayHour = hour % 12 || 12;
    const suffix = hour >= 12 ? "PM" : "AM";
    return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return value;
}

function formatClaimedTimeRange(slot: any) {
  const start = formatClaimedClock(
    slot?.startTime || slot?.time || slot?.timeLabel
  );
  const end = formatClaimedClock(slot?.endTime);

  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  return "Time TBD";
}

function getClaimedTimingLabel(startMs: number) {
  if (!startMs) return "UPCOMING";

  const now = new Date();
  const start = new Date(startMs);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const diffMs = startMs - Date.now();

  if (diffMs > 0 && diffMs <= 2 * 60 * 60 * 1000) return "LIVE SOON";
  if (startDay.getTime() === todayStart.getTime()) return "TODAY";
  if (startDay.getTime() === tomorrowStart.getTime()) return "TOMORROW";
  return "UPCOMING";
}


function Stat({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <View style={s.statItem}>
      <View style={s.statInner}>
        <Text style={s.statValue}>{value}</Text>
        <Text style={s.statLabel}>{label}</Text>
      </View>
</View>
  );
}


function AnimatedCard({
  children,
  style,
  index = 0,
}: {
  children: React.ReactNode;
  style?: any;
  index?: number;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const glow = React.useRef(new Animated.Value(0)).current;
  const entranceOpacity = React.useRef(new Animated.Value(0)).current;
  const entranceTranslate = React.useRef(new Animated.Value(18)).current;

  React.useEffect(() => {
    const delay = index * 90;
    Animated.parallel([
      Animated.timing(entranceOpacity, {
        toValue: 1,
        duration: 360,
        delay,
        useNativeDriver: true,
     }),
      Animated.timing(entranceTranslate, {
        toValue: 0,
        duration: 420,
        delay,
        useNativeDriver: true,
     }),
    ]).start();
 }, [index, entranceOpacity, entranceTranslate]);

  const onPressIn = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 0.985,
        useNativeDriver: false,
        speed: 22,
        bounciness: 6,
     }),
      Animated.timing(glow, {
        toValue: 1,
        duration: 160,
        useNativeDriver: false,
     }),
    ]).start();
 };

  const onPressOut = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: false,
        speed: 18,
        bounciness: 8,
     }),
      Animated.timing(glow, {
        toValue: 0,
        duration: 220,
        useNativeDriver: false,
     }),
    ]).start();
 };

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={{ width: "48%" }}
    >
      <Animated.View
        style={[
          style,
          {
            transform: [{ scale }],
            borderColor: glow.interpolate({
              inputRange: [0, 1],
              outputRange: ["rgba(255,90,95,0.24)", "rgba(244,208,111,0.42)"],
           }),
            shadowOpacity: glow.interpolate({
              inputRange: [0, 1],
              outputRange: [0.22, 0.36],
           }) as any,
         },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

function ContentCard({
  eyebrow,
  title,
  body,
  meta,
  icon,
  index = 0,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  meta: string;
  icon: keyof typeof Ionicons.glyphMap;
  index?: number;
}) {
  return (
    <AnimatedCard style={s.contentCard} index={index}>
      <View style={s.contentTopRow}>
        <View style={s.contentIconWrap}>
          <Ionicons name={icon} size={16} color="#FF5A5F" />
        </View>

        <View style={s.contentMetaPill}>
          <Text style={s.contentMetaPillText} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </View>

      <View style={s.contentBody}>
        {eyebrow ? (
          <Text style={s.contentEyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}

        <Text style={s.contentTitle} numberOfLines={2}>
          {title}
        </Text>

        <Text style={s.contentText} numberOfLines={2}>
          {body}
        </Text>
      </View>
    </AnimatedCard>
  );
}

function prettyRole(role?: string) {
  if (!role) return "Member";
  return String(role).replace(/_/g, " ");
}

function titleFromUserId(userId?: string) {
  const raw = String(userId || "").trim();
  if (!raw) return "Kristo User";
  if (raw === "u-demo-1") return "Prince Fariji";

  const cleaned = raw.replace(/^u[-_]?/i, "");
  const looksTechnical =
    /[0-9]{4,}/.test(cleaned) ||
    cleaned.length > 18 ||
    /^[a-f0-9_]+$/i.test(cleaned);

  if (looksTechnical) return "Kristo Member";

  return (
    cleaned
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase()) || "Kristo User"
  );
}

function usernameFromUserId(userId?: string) {
  const raw = String(userId || "").trim().toLowerCase();
  if (!raw) return "@kristo_user";
  if (raw === "u-demo-1") return "@princefariji";

  const safe = raw.replace(/[^a-z0-9_]+/g, "_");
  const core = safe.replace(/^u_?/, "");
  const looksTechnical =
    /[0-9]{4,}/.test(core) ||
    core.length > 18 ||
    /^[a-f0-9_]+$/i.test(core);

  if (looksTechnical) {
    return "@member_" + core.slice(0, 8);
 }

  return "@" + safe;
}

function churchLabelFromChurchId(churchId?: string) {
  const raw = String(churchId || "").trim();
  if (!raw) return "No Church Yet";
  if (raw === "c-demo-1") return "TLMC";
  if (raw === "c-demo-2") return "Grace Center";
  if (raw === "c-demo-3") return "Demo Church";
  return raw;
}

function toBackendImageUrl(uri?: string) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("file:") || raw.startsWith("data:")) return raw;
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (raw.startsWith("/") && base) return `${base}${raw}`;
  return raw;
}

function avatarFromSeed(seed?: string) {
  const n =
    Array.from(String(seed || "user")).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 70;
  return `https://i.pravatar.cc/300?img=${n + 1}`;
}

function avatarForProfile(userId?: string, role?: string, church?: string) {
  const uid = String(userId || "").trim();
  if (uid === "u-demo-1") return "https://i.pravatar.cc/300?img=12";
  if (uid) return `https://i.pravatar.cc/300?u=${encodeURIComponent(uid)}`;
  return avatarFromSeed(uid || role || church);
}

function displayNameFromSession(session: {
  fullName?: string;
  displayName?: string;
  name?: string;
  userId?: string;
}) {
  const fullName = String((session as any)?.fullName || "").trim();
  if (fullName) return fullName;

  const displayName = String(session?.displayName || "").trim();
  if (displayName) return displayName;

  const name = String(session?.name || "").trim();
  if (name) return name;

  return titleFromUserId(session?.userId);
}

function formatProfileBio(params: {
  church: string;
  city?: string;
  country?: string;
  status?: string;
}) {
  const city = String(params.city || "").trim();
  const country = String(params.country || "").trim();
  const place = [city, country].filter(Boolean).join(", ");

  if (place) return `Serving with faith through ${params.church} • ${place}`;
  if (params.status === "Incomplete") return "Complete your profile to unlock a stronger Kristo identity.";
  if (params.church === "No Church Yet") return "Building your Kristo identity.";
  return `Serving with faith through ${params.church}.`;
}

function formatGreeting(params: {
  role: string;
  church: string;
  status?: string;
}) {
  if (params.status === "Incomplete") return "Complete your profile";
  if (params.church === "No Church Yet") return "Your Kristo identity is ready to grow.";
  return `${params.role} • ${params.church}`;
}


function safeLower(v?: string) {
  return String(v || "").trim().toLowerCase();
}

function firstWords(v?: string, fallback = "No content yet", max = 7) {
  const text = String(v || "").trim().replace(/\s+/g, " ");
  if (!text) return fallback;
  const words = text.split(" ").filter(Boolean);
  return words.slice(0, max).join(" ");
}

function toTime(v?: string | number) {
  if (typeof v === "number") return v;
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : 0;
}

export default function MeScreen() {
  const router = useRouter();
  const [inviteCount, setInviteCount] = useState(0);
  const [inviteItems, setInviteItems] = useState<any[]>([]);
  const inviteDisplayCount = inviteItems.length;
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState<"accept" | "reject" | "">("");
  const [previewLimitModalOpen, setPreviewLimitModalOpen] = useState(false);
  const [identityModal, setIdentityModal] = useState<{ label: string; value: string } | null>(null);
  const [claimedModalOpen, setClaimedModalOpen] = useState(false);
  const [claimedFeedTick, setClaimedFeedTick] = useState(0);
  const insets = useSafeAreaInsets();
  const { session, setSession } = useKristoSession();
  const userId = String(session?.userId || "").trim();
  const churchId = String(session?.churchId || "").trim();

  useEffect(() => {
    if (!userId) return;
    void ensureRingClaimStoresHydrated().then(() => {
      setClaimedFeedTick((v) => v + 1);
    });
  }, [userId]);

  useEffect(() => {
    const claimedFeedUnsub = subscribeHomeFeed(() => {
      setClaimedFeedTick((v) => v + 1);
      setHomeFeedTick((v) => v + 1);
    });
    const claimEventUnsub = onClaimUpdated(() => {
      setClaimedFeedTick((v) => v + 1);
    });
    const slotClaimUnsub = onSlotClaimChanged(() => {
      setClaimedFeedTick((v) => v + 1);
    });
    const liveRingUnsub = onLiveRingRefresh(() => {
      setClaimedFeedTick((v) => v + 1);
    });

    return () => {
      claimedFeedUnsub();
      claimEventUnsub();
      slotClaimUnsub();
      liveRingUnsub();
    };
  }, []);
  useEffect(() => {
    if (!churchId || !userId) {
      setChurchMembers([]);
      return;
    }

    let alive = true;
    void fetchChurchMembers()
      .then((rows) => {
        if (!alive) return;
        setChurchMembers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (alive) setChurchMembers([]);
      });

    return () => {
      alive = false;
    };
  }, [churchId, userId]);
  useEffect(() => {
    let alive = true;
    let fetched = false;

    async function loadBackendMediaOnce() {
      if (!session?.userId || !session?.churchId || fetched) return;
      fetched = true;

      const res: any = await apiGet(
        "/api/church/media",
        {
          headers: getKristoHeaders({
            userId: session.userId,
            role: session.role,
            churchId: session.churchId || "",
          }),
        },
        { screen: "Profile", throttleMs: 120000 }
      );

      if (!alive || !res?.ok) return;
      setBackendMedia(res.media || null);
    }

    void loadBackendMediaOnce();

    return () => {
      alive = false;
    };
  }, [session?.userId, session?.churchId]);

  const [backendMedia, setBackendMedia] = useState<any>(null);
  const backendHosts = Array.isArray(backendMedia?.hosts)
    ? backendMedia.hosts
    : [];

  const amIMediaHost = backendHosts.some(
    (h: any) =>
      String(h?.userId || "").trim() === String(session?.userId || "").trim()
  );

  const viewerRoleRaw = String(session?.role || "Member").trim();
  const isMediaPrivilegedRole =
    viewerRoleRaw === "Pastor" ||
    viewerRoleRaw === "Church_Admin" ||
    viewerRoleRaw === "Admin";
  const canShowMediaTab = isMediaPrivilegedRole || amIMediaHost;

  const mediaProfile =
    backendMedia && amIMediaHost
      ? backendMedia
      : null;

  const hasMediaProfile = !!mediaProfile;
  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());
  const currentPlan = paymentsState.subscriptions.selectedPlan;
  const planStatus = paymentsState.subscriptions.planStatus;
  const hasSubscription = isPlanActive(currentPlan, planStatus);
  const [contentMode, setContentMode] = useState<"church" | "media">("church");
  const showMediaContent = canShowMediaTab && hasMediaProfile && contentMode === "media";
  const showMediaActivityTab = contentMode === "media";
  const showMediaCreatorTools = showMediaContent;

  React.useEffect(() => {
    if (!canShowMediaTab && contentMode === "media") {
      setContentMode("church");
    }
  }, [canShowMediaTab, contentMode]);


  const profileCachePeek = userId ? peekProfileScreenCache(userId) : null;

  React.useEffect(() => {
    void hydrateMediaPosterCache();
  }, []);
  const [profileDraft, setProfileDraft] = React.useState<ProfileDraft | null>(null);
  const publicKristoId = String(
    (session as any)?.kristoId ||
    (session as any)?.publicKristoId ||
    (profileDraft as any)?.kristoId ||
    (profileDraft as any)?.publicKristoId ||
    ""
  ).trim();

  const refreshProfileDraft = useCallback(async () => {
    const saved = await loadProfileDraft(userId);
    setProfileDraft(saved);
  }, [userId]);

  React.useEffect(() => {
    refreshProfileDraft();
  }, [refreshProfileDraft]);
  const role = prettyRole(session?.role);
  const [churchDisplayName, setChurchDisplayName] = useState(
    String((session as any)?.churchName || "").trim()
  );

  const refreshActiveChurch = useCallback(async () => {
    const id = String(session?.churchId || "").trim();
    if (!id || !session?.userId) {
      setChurchDisplayName("");
      if (__DEV__) {
        console.log("[Profile] active church refresh result", {
          churchId: null,
          churchName: null,
          membershipFound: false,
        });
      }
      return;
    }

    const name = await resolveChurchDisplayName(id, session.userId);
    setChurchDisplayName(name);

    if (name && name !== (session as any)?.churchName) {
      await setSession({
        ...(session as any),
        churchId: id,
        activeChurchId: id,
        churchName: name,
      });
    }

    if (__DEV__) {
      console.log("[Profile] active church refresh result", {
        churchId: id,
        churchName: name || null,
        membershipFound: true,
      });
    }
  }, [session, setSession]);

  const church = useMemo(() => {
    const fromSession = String((session as any)?.churchName || churchDisplayName || "").trim();
    if (fromSession) return fromSession;
    if (!churchId) return "No Church Yet";
    return churchLabelFromChurchId(churchId);
  }, [session, churchDisplayName, churchId]);

  const baseName = displayNameFromSession({
    fullName: (session as any)?.fullName,
    displayName: (session as any)?.displayName,
    name: (session as any)?.name,
    userId,
  });

  const baseAvatar =
    toBackendImageUrl(String((session as any)?.avatarUrl || "").trim()) ||
    toBackendImageUrl(String((session as any)?.avatarUri || "").trim()) ||
    toBackendImageUrl(String(profileDraft?.avatarUri || "").trim()) ||
    avatarForProfile(userId, session?.role, church);

  const [bootLoading, setBootLoading] = useState(!profileCachePeek);
  const [profile, setProfile] = useState<AuthProfile | null>((profileCachePeek?.profile as AuthProfile | null) || null);
  const [postsCount, setPostsCount] = useState(profileCachePeek?.postsCount || 0);
  const [followersCount, setFollowersCount] = useState(profileCachePeek?.followersCount || 0);
  const [followingCount, setFollowingCount] = useState(profileCachePeek?.followingCount || 0);
  const [latestAnnouncement, setLatestAnnouncement] = useState<ChurchFeedItemLite | null>(
    (profileCachePeek?.latestAnnouncement as ChurchFeedItemLite | null) || null
  );
  const [latestTestimony, setLatestTestimony] = useState<ChurchFeedItemLite | null>(
    (profileCachePeek?.latestTestimony as ChurchFeedItemLite | null) || null
  );
  const [latestPrayer, setLatestPrayer] = useState<ChurchFeedItemLite | null>(
    (profileCachePeek?.latestPrayer as ChurchFeedItemLite | null) || null
  );
  const [latestSaved, setLatestSaved] = useState<{ title: string; body: string } | null>(profileCachePeek?.latestSaved || null);
  const [profileFeedItems, setProfileFeedItems] = useState<any[]>([]);
  const [homeFeedTick, setHomeFeedTick] = useState(0);
  const [churchMembers, setChurchMembers] = useState<any[]>([]);
  const [activityMemberFilter, setActivityMemberFilter] =
    useState<ChurchActivityMemberFilter>("all");
  const [activityMemberId, setActivityMemberId] = useState("");

  const creatorScoreValue = useMemo(() => {
    const posts = Number(postsCount || 0);
    const followers = Number(followersCount || 0);
    const following = Number(followingCount || 0);
    const subscriptionBoost = hasSubscription ? 1.2 : 0;
    const raw =
      5 +
      Math.min(posts, 24) * 0.08 +
      Math.min(followers, 200) * 0.01 +
      Math.min(following, 120) * 0.005 +
      subscriptionBoost;
    return Math.min(10, raw).toFixed(1);
  }, [postsCount, followersCount, followingCount, hasSubscription]);

  const creatorCups = useMemo(() => {
    const posts = Number(postsCount || 0);
    const followers = Number(followersCount || 0);
    return Math.max(1, Math.floor(posts / 3) + Math.floor(followers / 25) + (hasSubscription ? 2 : 0));
  }, [postsCount, followersCount, hasSubscription]);

  const creatorStars = useMemo(() => {
    const posts = Number(postsCount || 0);
    const followers = Number(followersCount || 0);
    return Math.max(3, posts * 2 + Math.floor(followers / 8) + (hasSubscription ? 8 : 0));
  }, [postsCount, followersCount, hasSubscription]);

  const awardsDisplay = useMemo(() => {
    return `${creatorCups} Cups • ${creatorStars} Stars`;
  }, [creatorCups, creatorStars]);

  const importantSummary = useMemo(() => {
    if (hasSubscription) {
      return `Score ${creatorScoreValue} • ${creatorCups} cups • ${creatorStars} stars • Subscription active and ready to push content`;
    }
    return `Score ${creatorScoreValue} • ${creatorCups} cups • ${creatorStars} stars • Activate subscription to unlock stronger reach`;
  }, [creatorScoreValue, creatorCups, creatorStars, hasSubscription]);

  const creatorLevel = useMemo(() => {
    const score = Number(creatorScoreValue || 0);
    if (score >= 9) return "Royal Gold";
    if (score >= 7.5) return "Gold";
    if (score >= 6) return "Silver";
    return "Bronze";
  }, [creatorScoreValue]);

  function closeInviteLocally(id: string, index?: number) {
    const inviteKey = String(id || "").trim();
    if (inviteKey) {
      CLOSED_INVITE_IDS.add(inviteKey);
      AsyncStorage.setItem(CLOSED_INVITES_STORAGE_KEY, JSON.stringify(Array.from(CLOSED_INVITE_IDS))).catch(() => {});
    }

    setInviteItems((cur: any[]) => {
      const next = cur.filter((item: any, idx: number) => {
        const itemId = String(item?.membershipId || item?.ministryMemberId || item?.churchId || item?.id || idx).trim();
        if (inviteKey && itemId === inviteKey) return false;
        if (typeof index === "number" && idx === index) return false;
        return true;
      });

      setInviteCount(next.length);
      if (next.length === 0) {
        setInviteModalOpen(false);
      }

      return next;
    });
  }

  const refreshInvitations = useCallback(async () => {
    if (isSessionExitInProgress()) return;
    if (shouldPauseBackgroundProfileRefresh()) return;

    const uid = String(session?.userId || "").trim();
    if (!uid) return;

    try {
      const savedClosed = await AsyncStorage.getItem(CLOSED_INVITES_STORAGE_KEY);
      if (savedClosed) {
        JSON.parse(savedClosed).forEach((id: string) => CLOSED_INVITE_IDS.add(String(id)));
      }
      const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
      const r = await fetch(`${base}/api/church/invites/action`, {
        headers: getKristoHeaders({ userId: uid, role: session?.role as any, churchId: session?.churchId || "" }),
      });
      const j = await r.json().catch(() => ({} as any));
      const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];

      const joined = raw.find((x: any) => {
        const status = String(x?.status || x?.membershipStatus || x?.inviteStatus || "").toLowerCase();
        const cId = String(x?.churchId || "").trim();
        return cId && (status === "active" || status === "accepted" || status === "member");
      });

      const joinedChurchId = String(joined?.churchId || "").trim();

      if (!String(session?.churchId || "").trim() && joinedChurchId && countsAsRealActiveChurchId(joinedChurchId)) {
        await setSession({
          ...(session as any),
          userId: uid,
          churchId: joinedChurchId,
          role: (session?.role || "Member") as any,
        });
      }

      const seenInvites = new Set<string>();
      const invites = raw.filter((x: any) => {
        const status = String(x?.status || x?.membershipStatus || x?.inviteStatus || "").toLowerCase();
        const inviteKey = String(x?.id || x?.membershipId || "").trim();

        if (!["requested", "pending", "request", "invited", "invite"].includes(status) || !inviteKey) return false;
        if (CLOSED_INVITE_IDS.has(inviteKey)) return false;
        if (seenInvites.has(inviteKey)) return false;

        seenInvites.add(inviteKey);
        return true;
      });

      const churchInvites = invites.map((x: any) => ({ ...x, kind: "church" }));

      let offlineSupervisorInvites: Awaited<ReturnType<typeof loadOfflineSupervisorProfileInvites>> = [];
      try {
        offlineSupervisorInvites = await loadOfflineSupervisorProfileInvites();
        if (offlineSupervisorInvites.length) {
          console.log("KRISTO_INVITATIONS_OFFLINE_SUPERVISOR_INCLUDED", {
            userId: uid,
            count: offlineSupervisorInvites.length,
          });
        }
      } catch {}

      let offlineAgentInvites: Awaited<ReturnType<typeof loadOfflineAgentProfileInvites>> = [];
      try {
        offlineAgentInvites = await loadOfflineAgentProfileInvites();
        if (offlineAgentInvites.length) {
          console.log("KRISTO_INVITATIONS_OFFLINE_AGENT_INCLUDED", {
            userId: uid,
            count: offlineAgentInvites.length,
          });
        }
      } catch {}

      const mergedInvites = [...offlineAgentInvites, ...offlineSupervisorInvites, ...churchInvites];

      setInviteItems(mergedInvites);
      setInviteCount(mergedInvites.length);
      console.log("[ProfileInvites] silent refresh", { userId: uid, count: mergedInvites.length });
    } catch {}
  }, [session, setSession]);

  useEffect(() => {
    if (!session?.userId) return;
    void refreshInvitations();

    const unsubPayments = subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });

    return () => {
      unsubPayments();
    };
  }, [session?.userId, refreshInvitations]);

  const hasProfileCacheRef = React.useRef(Boolean(profileCachePeek));

  const applyProfileCachePayload = useCallback((payload: ProfileScreenCachePayload) => {
    hasProfileCacheRef.current = true;
    setProfile((payload.profile as AuthProfile | null) || null);
    setPostsCount(payload.postsCount);
    setFollowersCount(payload.followersCount);
    setFollowingCount(payload.followingCount);
    setLatestAnnouncement((payload.latestAnnouncement as ChurchFeedItemLite | null) || null);
    setLatestTestimony((payload.latestTestimony as ChurchFeedItemLite | null) || null);
    setLatestPrayer((payload.latestPrayer as ChurchFeedItemLite | null) || null);
    setLatestSaved(payload.latestSaved || null);
    setBootLoading(false);
  }, []);

  React.useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      const cached = (await getProfileScreenCache(userId)) || profileCachePeek;
      if (!alive || !cached) return;
      applyProfileCachePayload(cached);
      if (__DEV__) {
        console.log("KRISTO_PROFILE_CACHE_HIT", { userId, updatedAt: cached.updatedAt });
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, applyProfileCachePayload, profileCachePeek]);

  const applyProfileResponse = useCallback(
    async (profileRes: AuthProfileRes | null | undefined, opts?: { silent?: boolean }) => {
      const silent = !!opts?.silent;
      if (!profileRes?.ok || !profileRes.profile) {
        setProfile(null);
        return;
      }

      setProfile((prev) => {
        const next = profileRes.profile!;
        if (
          prev &&
          String(prev.profileStatus || "") === String(next.profileStatus || "") &&
          String(prev.fullName || "") === String(next.fullName || "") &&
          String(prev.avatarUrl || "") === String(next.avatarUrl || "")
        ) {
          return prev;
        }
        return next;
      });

      const backendName = String(profileRes.profile.fullName || "").trim();
      const backendAvatarRaw = toBackendImageUrl(String(profileRes.profile.avatarUrl || "").trim());
      const draftBefore = session?.userId ? await loadProfileDraft(session.userId) : null;
      const mergedAvatar = pickFresherAvatar({
        localUri: String(draftBefore?.avatarUri || (session as any)?.avatarUri || (session as any)?.avatarUrl || "").trim(),
        localUpdatedAt: draftBefore?.avatarUpdatedAt,
        serverUri: backendAvatarRaw,
        serverUpdatedAt: Number((profileRes.profile as any)?.updatedAt || (profileRes.profile as any)?.avatarUpdatedAt || 0),
      });

      if (mergedAvatar.skippedStale && silent) {
        console.log("[Profile] skipped stale server avatar", {
          userId,
          localUpdatedAt: draftBefore?.avatarUpdatedAt || null,
        });
      }

      const backendAvatar = mergedAvatar.uri ? toBackendImageUrl(mergedAvatar.uri) : "";
      const resolved = resolveActiveChurchFromProfileResponse(profileRes as any);
      const membershipStatus = String((profileRes as any)?.activeMembership?.status || "").trim();
      const syncedChurchId =
        membershipStatus && !isActiveMembershipStatus(membershipStatus) ? "" : resolved.churchId;
      const syncedRole = syncedChurchId ? resolved.role : "Member";
      const prevChurchId = String(session?.churchId || "").trim();

      if (session?.userId) {
        let nextChurchName = String((session as any)?.churchName || "").trim();
        if (syncedChurchId && syncedChurchId !== prevChurchId) {
          nextChurchName =
            String((profileRes as any)?.churchName || "").trim() ||
            (await resolveChurchDisplayName(syncedChurchId, session.userId));
        } else if (!syncedChurchId) {
          nextChurchName = "";
        }

        const sessionPatch: any = {
          ...session,
          ...(backendName ? { name: backendName, displayName: backendName } : {}),
          avatarUrl: backendAvatar || (session as any)?.avatarUrl || "",
          avatarUri: backendAvatar || (session as any)?.avatarUri || "",
        };

        if (syncedChurchId !== prevChurchId || syncedRole !== String(session?.role || "Member")) {
          sessionPatch.churchId = syncedChurchId;
          sessionPatch.activeChurchId = syncedChurchId;
          sessionPatch.churchName = nextChurchName;
          sessionPatch.role = syncedRole;
          sessionPatch.churchRole = syncedRole;
        }

        await setSession(sessionPatch);

        if (syncedChurchId !== prevChurchId) {
          setChurchDisplayName(nextChurchName);
        }

        if (backendAvatar || backendName) {
          const draft = draftBefore || { displayName: backendName || "" };
          const nextAvatarUpdatedAt =
            mergedAvatar.source === "local"
              ? draftBefore?.avatarUpdatedAt
              : backendAvatar
                ? Date.now()
                : draft.avatarUpdatedAt;
          await saveProfileDraft(
            {
              ...draft,
              displayName: backendName || draft.displayName,
              avatarUri: backendAvatar || draft.avatarUri,
              avatarUpdatedAt: nextAvatarUpdatedAt,
            },
            session.userId
          );
          setProfileDraft({
            ...draft,
            displayName: backendName || draft.displayName,
            avatarUri: backendAvatar || draft.avatarUri,
            avatarUpdatedAt: nextAvatarUpdatedAt,
          });
        }
      }

      if (silent) {
        console.log("[Profile] silent refresh applied", {
          userId,
          hasAvatar: Boolean(backendAvatar),
        });
      }
    },
    [session, setSession, userId, setChurchDisplayName]
  );

  const loadProfileLight = useCallback(
    async (opts?: { silent?: boolean; bypassThrottle?: boolean }) => {
      if (isSessionExitInProgress()) return;

      if (shouldPauseBackgroundProfileRefresh()) {
        return;
      }

      if (opts?.bypassThrottle && session?.userId) {
        clearResponseCacheForRequest("GET", "/api/auth/profile", session.userId);
      }

      const profileRes = await apiGet<AuthProfileRes>(
        "/api/auth/profile",
        {
          headers: getKristoHeaders({
            userId: session?.userId,
            role: opts?.bypassThrottle ? "Member" : (session?.role as any),
            churchId: opts?.bypassThrottle ? "" : session?.churchId || "",
            sessionToken: session?.sessionToken,
          }),
        },
        { screen: "Profile", throttleMs: opts?.bypassThrottle ? 2500 : 45000 }
      );
      await applyProfileResponse(profileRes, opts);
    },
    [applyProfileResponse, session?.userId, session?.role, session?.churchId]
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (isSessionExitInProgress()) return;

    const silent = !!opts?.silent;
    if (shouldPauseBackgroundProfileRefresh()) {
      return;
    }

    if (!silent && !hasProfileCacheRef.current) setBootLoading(true);
    try {

      const cached = userId ? await getProfileScreenCache(userId) : null;
      if (cached) {
        applyProfileCachePayload(cached);
        if (__DEV__) {
          console.log("KRISTO_PROFILE_CACHE_HIT", { userId, updatedAt: cached.updatedAt });
        }
      }

      const [profileRes, postsRes, announcementsRes, feedRes, overviewRes] = await Promise.all([
        apiGet<AuthProfileRes>(
          "/api/auth/profile",
          { headers: getKristoHeaders() },
          { screen: "Profile", throttleMs: 30000 }
        ),
        userId
          ? apiGet<UserPostsRes>(
              `/api/users/${encodeURIComponent(userId)}/posts?limit=60`,
              { headers: getKristoHeaders() },
              { screen: "Profile", throttleMs: 120000 }
            )
          : Promise.resolve(null as any),
        churchId
          ? apiGet<ChurchFeedRes>(
              "/api/church/feed?type=announcement",
              { headers: getKristoHeaders() },
              { screen: "Profile", throttleMs: 120000 }
            )
          : Promise.resolve(null as any),
        churchId
          ? apiGet<ChurchFeedRes>(
              "/api/church/feed",
              { headers: getKristoHeaders() },
              { screen: "Profile", throttleMs: 120000 }
            )
          : Promise.resolve(null as any),
        userId
          ? apiGet<UserOverviewRes>(
              `/api/users/${encodeURIComponent(userId)}/overview`,
              { headers: getKristoHeaders() },
              { screen: "Profile", throttleMs: 120000 }
            )
          : Promise.resolve(null as any),
      ]);

      await applyProfileResponse(profileRes, { silent });

      const overview = overviewRes?.ok ? overviewRes.data : undefined;

      const userPosts = Array.isArray(postsRes?.data?.items) ? postsRes!.data!.items! : [];
      setPostsCount(
        typeof overview?.postsCount === "number" ? overview.postsCount : userPosts.length
      );
      setFollowersCount(
        typeof overview?.followersCount === "number" ? overview.followersCount : 0
      );
      setFollowingCount(
        typeof overview?.followingCount === "number" ? overview.followingCount : 0
      );

      const announcementItems = Array.isArray(announcementsRes?.data) ? announcementsRes!.data! : [];
      const myAnnouncements = announcementItems
        .filter((x: ChurchFeedItemLite) => String(x?.createdBy || "").trim() === userId)
        .filter(isChurchActivityPost)
        .sort((a: ChurchFeedItemLite, b: ChurchFeedItemLite) => toTime(b?.createdAt) - toTime(a?.createdAt));
      setLatestAnnouncement(myAnnouncements[0] || null);

      const feedItems = Array.isArray((feedRes as any)?.data?.items)
        ? (feedRes as any).data.items
        : Array.isArray(feedRes?.data)
          ? feedRes!.data!
          : Array.isArray((feedRes as any)?.items)
            ? (feedRes as any).items
            : [];
      setProfileFeedItems(
        feedItems.map((item: any) => {
          const scopedChurchId = String(
            item?.churchId || item?.sourceChurchId || item?.church?.id || churchId || ""
          ).trim();
          return {
            ...item,
            churchId: scopedChurchId,
            sourceChurchId: String(item?.sourceChurchId || scopedChurchId).trim(),
          };
        }) as any[]
      );
      setClaimedFeedTick((v) => v + 1);
      const myFeed = feedItems
        .filter(isChurchActivityPost)
        .filter((x: ChurchFeedItemLite) => String(x?.createdBy || "").trim() === userId)
        .sort((a: ChurchFeedItemLite, b: ChurchFeedItemLite) => toTime(b?.createdAt) - toTime(a?.createdAt));

      const testimony = myFeed.find((x: ChurchFeedItemLite) => {
        const bag = `${safeLower(x?.title)} ${safeLower(x?.text)}`;
        return bag.includes("testimony") || bag.includes("ushuhuda");
     });
      setLatestTestimony(testimony || null);

      const prayer = myFeed.find((x: ChurchFeedItemLite) => {
        const bag = `${safeLower(x?.title)} ${safeLower(x?.text)}`;
        return bag.includes("prayer") || bag.includes("maombi");
     });
      setLatestPrayer(prayer || null);

      const savedSource = userPosts[0];
      if (savedSource) {
        setLatestSaved({
          title: firstWords(savedSource.caption, "Latest post", 5),
          body: String(savedSource.caption || "").trim() || "Your newest user post is ready here.",
       });
     } else {
        setLatestSaved(null);
     }

      if (userId) {
        hasProfileCacheRef.current = true;
        await saveProfileScreenCache({
          userId,
          profile: profileRes?.ok ? profileRes.profile || null : null,
          postsCount:
            typeof overview?.postsCount === "number" ? overview.postsCount : userPosts.length,
          followersCount:
            typeof overview?.followersCount === "number" ? overview.followersCount : 0,
          followingCount:
            typeof overview?.followingCount === "number" ? overview.followingCount : 0,
          latestAnnouncement: myAnnouncements[0] || null,
          latestTestimony: testimony || null,
          latestPrayer: prayer || null,
          latestSaved: savedSource
            ? {
                title: firstWords(savedSource.caption, "Latest post", 5),
                body: String(savedSource.caption || "").trim() || "Your newest user post is ready here.",
              }
            : null,
          updatedAt: Date.now(),
        });
      }
   } catch {
      setProfile(null);
      setPostsCount(0);
      setFollowersCount(0);
      setFollowingCount(0);
      setLatestAnnouncement(null);
      setLatestTestimony(null);
      setLatestPrayer(null);
      setLatestSaved(null);
   } finally {
      setBootLoading(false);
      if (__DEV__ && silent) {
        console.log("KRISTO_PROFILE_SILENT_REFRESH", { userId, churchId });
      }
   }
 }, [churchId, userId, session, setSession, applyProfileResponse, applyProfileCachePayload]);

  const profileBootedRef = React.useRef(false);
  React.useEffect(() => {
    if (!userId || profileBootedRef.current) return;
    profileBootedRef.current = true;
    void load({ silent: true });
  }, [userId, load]);

  useFocusEffect(
    useCallback(() => {
      void refreshInvitations();

      void (async () => {
        const draft = userId ? await loadProfileDraft(userId) : null;
        if (draft) {
          logTrafficCache("Profile", "profile-draft", true);
          setProfileDraft(draft);
        } else {
          logTrafficCache("Profile", "profile-draft", false);
        }
      })();

      if (isSaveCooldown(`user-profile:${userId}`)) return;
      if (!shouldAllowScreenRefresh("Profile", { minMs: 45000 })) return;

      void refreshActiveChurch();
      void loadProfileLight({ silent: true });
    }, [userId, refreshActiveChurch, loadProfileLight, refreshInvitations])
  );

  useEffect(() => {
    if (!session?.userId) return;

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && !isSessionExitInProgress()) {
        void refreshInvitations();
      }
    });

    return () => sub.remove();
  }, [session?.userId, refreshInvitations]);

  useEffect(() => {
    if (!session?.userId) return;

    const maybeRefreshFromEvent = (
      source: string,
      payload: { targetUserId?: string; targetKristoId?: string; userId?: string; kristoId?: string }
    ) => {
      if (isSessionExitInProgress()) return;
      if (!inviteEventTargetsCurrentUser(payload, { userId: session.userId, kristoId: publicKristoId })) return;
      console.log("[ProfileInvites] event refresh", { source, userId: session.userId });
      void refreshInvitations();
    };

    const unsubs = [
      onChurchInviteSent((payload) => maybeRefreshFromEvent("church-invite-sent", payload)),
      onChurchInviteAccepted((payload) => maybeRefreshFromEvent("church-invite-accepted", payload)),
      onChurchMembershipChanged((payload) => maybeRefreshFromEvent("church-membership-changed", payload)),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [session?.userId, publicKristoId, refreshInvitations]);

  const applyUserProfileEvent = useCallback(
    async (payload: { avatarUri?: string; avatarUrl?: string; avatarUpdatedAt?: number }) => {
      const avatarRaw = String(payload.avatarUri || payload.avatarUrl || "").trim();
      if (avatarRaw) {
        const nextAvatar = toBackendImageUrl(avatarRaw) || avatarRaw;
        setProfileDraft((prev) => ({
          ...(prev || { displayName: "" }),
          avatarUri: nextAvatar,
          avatarUpdatedAt: payload.avatarUpdatedAt || prev?.avatarUpdatedAt,
        }));
        if (session?.userId) {
          await setSession({
            ...session,
            avatarUri: nextAvatar,
            avatarUrl: nextAvatar,
          } as any);
        }
      } else if (userId) {
        const draft = await loadProfileDraft(userId);
        if (draft) setProfileDraft(draft);
      }
      console.log("[Profile] event applied immediately", {
        userId,
        hasAvatar: Boolean(avatarRaw),
        avatarUpdatedAt: payload.avatarUpdatedAt || null,
      });
    },
    [session, setSession, userId]
  );

  useEffect(() => {
    return onUserProfileUpdated((payload) => {
      if (String(payload.userId || "").trim() !== userId) return;
      void applyUserProfileEvent(payload);
    });
  }, [userId, applyUserProfileEvent]);

  
  const currentUserId = String(session?.userId || "").trim();

  function parseSlotTime(slot: any) {
    try {
      const meetingDate = String(slot?.meetingDate || "").trim();
      const rawTime = String(
        slot?.startTime ||
        slot?.time ||
        slot?.timeLabel ||
        ""
      ).trim();

      if (!meetingDate) return 0;

      const d = new Date(meetingDate);

      const match = rawTime.match(/(\d+):(\d+)\s*(AM|PM)/i);

      if (match) {
        let h = Number(match[1]);
        const m = Number(match[2]);
        const ampm = String(match[3]).toUpperCase();

        if (ampm === "PM" && h !== 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;

        d.setHours(h);
        d.setMinutes(m);
        d.setSeconds(0);
      }

      return d.getTime();
    } catch {
      return 0;
    }
  }

  const claimedSchedules = useMemo(() => {
    return buildProfileClaimedSchedules({
      viewerUserId: currentUserId,
      churchId,
      feedRows: profileFeedItems,
    });
  }, [currentUserId, churchId, claimedFeedTick, profileFeedItems]);

  const allActivitySourcePosts = useMemo(() => {
    void homeFeedTick;
    return [...profileFeedItems, ...feedList()];
  }, [profileFeedItems, homeFeedTick]);

  const activityMemberChipRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: { userId: string; name: string; avatarUri?: string }[] = [];

    for (const member of churchMembers) {
      const userIdValue = String(member?.userId || member?.id || "").trim();
      if (!userIdValue || seen.has(userIdValue)) continue;
      seen.add(userIdValue);
      rows.push({
        userId: userIdValue,
        name: String(
          member?.fullName ||
            member?.name ||
            member?.displayName ||
            member?.username ||
            "Member"
        ).trim(),
        avatarUri: toBackendImageUrl(
          String(
            member?.avatarUrl ||
              member?.avatarUri ||
              member?.profileImage ||
              ""
          ).trim()
        ),
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [churchMembers]);

  const activityMemberChipKey = useMemo(() => {
    if (activityMemberFilter === "member" && activityMemberId) {
      return activityMemberId;
    }
    return activityMemberFilter;
  }, [activityMemberFilter, activityMemberId]);

  const churchActivityPosts = useMemo(() => {
    return getChurchActivityPosts({
      allPosts: allActivitySourcePosts,
      selectedTab: "church",
      memberFilter: activityMemberFilter,
      selectedMemberId: activityMemberId,
      currentUserId,
      churchId,
      mediaUrlFn: homeFeedMediaUrl,
    });
  }, [
    allActivitySourcePosts,
    activityMemberFilter,
    activityMemberId,
    currentUserId,
    churchId,
  ]);

  const mediaActivityPosts = useMemo(() => {
    return getChurchActivityPosts({
      allPosts: allActivitySourcePosts,
      selectedTab: "media",
      memberFilter: activityMemberFilter,
      selectedMemberId: activityMemberId,
      currentUserId,
      churchId,
      mediaUrlFn: homeFeedMediaUrl,
    });
  }, [
    allActivitySourcePosts,
    activityMemberFilter,
    activityMemberId,
    currentUserId,
    churchId,
  ]);

  const openActivityPostInChurchFeed = useCallback(
    (post: ActivityGridItem) => {
      const focusPostId = String(post?.id || "").trim();
      if (!focusPostId || !churchId) return;

      if (showMediaActivityTab && activityIsVideo(post)) {
        console.log("CHURCH_ACTIVITY_OPEN_WATCH", {
          postId: focusPostId,
          pathname: "/(tabs)",
          videoDisplayType:
            String((post as any)?.videoDisplayType || (post as any)?.displayType || "")
              .trim()
              .toLowerCase() === "tiktok"
              ? "tiktok"
              : "youtube",
        });

        router.push({
          pathname: "/(tabs)",
          params: { openPostId: focusPostId },
        });
        return;
      }

      const activityMode: "church" | "member" | "media" = showMediaActivityTab
        ? "media"
        : activityMemberFilter === "all"
          ? "church"
          : "member";

      const activityMemberIdParam =
        activityMemberFilter === "mine"
          ? currentUserId
          : activityMemberFilter === "member"
            ? activityMemberId
            : "";

      console.log("CHURCH_ACTIVITY_OPEN_POST", {
        postId: focusPostId,
        pathname: "/church-activity-feed",
        activityChurchId: churchId,
        activityMemberId: activityMemberIdParam,
        activityMode,
      });

      router.push({
        pathname: "/church-activity-feed",
        params: {
          focusPostId,
          activityChurchId: churchId,
          activityMode,
          ...(activityMemberIdParam ? { activityMemberId: activityMemberIdParam } : {}),
        },
      });
    },
    [
      router,
      churchId,
      currentUserId,
      showMediaActivityTab,
      activityMemberFilter,
      activityMemberId,
    ]
  );

  const handleActivityMemberChipSelect = useCallback(
    (key: "all" | "mine" | string, memberId?: string) => {
      if (key === "all") {
        setActivityMemberFilter("all");
        setActivityMemberId("");
        return;
      }
      if (key === "mine") {
        setActivityMemberFilter("mine");
        setActivityMemberId("");
        return;
      }
      setActivityMemberFilter("member");
      setActivityMemberId(String(memberId || key || "").trim());
    },
    []
  );

  const showActivityTabs = Boolean(churchId);


const resolvedName = useMemo(() => {
    const fromApi = String(profile?.fullName || "").trim();
    return fromApi || baseName;
 }, [profile?.fullName, baseName]);

  const resolvedAvatar = useMemo(() => {
    const fromApi = toBackendImageUrl(String(profile?.avatarUrl || "").trim());
    const fromSession =
      toBackendImageUrl(String((session as any)?.avatarUrl || "").trim()) ||
      toBackendImageUrl(String((session as any)?.avatarUri || "").trim());
    const fromDraft = toBackendImageUrl(String(profileDraft?.avatarUri || "").trim());

    const raw = fromApi || fromSession || fromDraft || "";
    return avatarCacheBust(raw, profileDraft?.avatarUpdatedAt);
 }, [profile?.avatarUrl, session, profileDraft?.avatarUri, profileDraft?.avatarUpdatedAt]);

  const user = {
    userId: publicKristoId || String((profile as any)?.kristoId || (profile as any)?.publicKristoId || ""),
    backendUserId: String(profile?.userId || session?.userId || ""),
    name: String(profile?.fullName || resolvedName || session?.displayName || session?.name || profileDraft?.displayName || "").trim(),
    username: usernameFromUserId(publicKristoId || userId),
    church,
    churchId,
    role,
    bio: String((profile as any)?.bio || "").trim() || String(profileDraft?.bio || "").trim() || formatProfileBio({
      church,
      city: profile?.city || profileDraft?.city || session?.city,
      country: profile?.country || profileDraft?.country || session?.country,
      status: profile?.profileStatus,
   }),
    greeting: formatGreeting({
      role,
      church,
      status: profile?.profileStatus,
   }),
    posts: String(postsCount || 0),
    followers: followersCount,
    following: followingCount,
    avatar: resolvedAvatar,
    profileStatus: String(profile?.profileStatus || ""),
    phone: String(profile?.phone || profileDraft?.phone || session?.phone || "").trim(),
    address: String(profileDraft?.address || session?.address || "").trim(),
    city: String(profile?.city || profileDraft?.city || session?.city || "").trim(),
    country: String(profile?.country || profileDraft?.country || session?.country || "").trim(),
 };

  useFocusedPolling(
    "ProfileTab",
    async () => {
      if (isSessionExitInProgress()) return;
      if (shouldPauseBackgroundProfileRefresh()) return;

      console.log("[ProfileTab] silent refresh");
      await refreshInvitations();
      await loadProfileLight({ silent: true, bypassThrottle: true });
      setClaimedFeedTick((v) => v + 1);
    },
    2500,
    Boolean(session?.userId)
  );

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 2,
          paddingBottom: Math.max(insets.bottom, 24) + 90,
       }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.container}>
          <View style={s.headerRow}>
            <Text style={s.title}>My Profile</Text>

            <Pressable
              style={s.settingsIconBtn}
              onPress={() => router.push("/(tabs)/profile/settings" as any)}
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={20} color="#F4D06F" />
            </Pressable>
          </View>
                      <View style={s.heroCard}>
            <View style={s.heroGlowA} />
            <View style={s.heroGlowB} />
            <View style={s.heroSheen} />

            <View style={s.heroIdentityRow}>
              <View style={s.avatarShell}>
                <View style={s.avatarRingGlow} />
                {user.avatar ? (
                  <Image source={{ uri: user.avatar }} style={s.avatar} />
                ) : (
                  <View style={[s.avatar, s.avatarFallback]}>
                    <Ionicons name="person-outline" size={34} color="#F4D06F" />
                  </View>
                )}
              </View>

              <View style={s.profileInfo}>
                <Text style={s.name} numberOfLines={1}>
                  {user.name}
                </Text>

                <Text style={s.heroSummary} numberOfLines={1}>
                  {showMediaContent ? "Media Creator • Kristo Media" : `${user.role} • ${user.church}`}
                </Text>
              </View>
            </View>

            <View style={s.heroTopBar}>
              <Text style={s.heroEyebrow}>Kristo Identity</Text>

              <View style={s.heroTopActions}>
                {showMediaContent ? (
                  <Pressable
                    style={s.deleteMediaBtn}
                    onPress={() =>
                      Alert.alert(
                        "Delete media profile?",
                        "This will remove your media profile view from this screen.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => setContentMode("church"),
                          },
                        ]
                      )
                    }
                  >
                    <Ionicons name="trash-outline" size={13} color="#FF8A98" />
                    
                  </Pressable>
                ) : null}

                <View style={s.heroMiniPill}>
                  <Ionicons
                    name={user.profileStatus === "Complete" ? "shield-checkmark-outline" : "alert-circle-outline"}
                    size={12}
                    color="#F4D06F"
                  />
                  <Text style={s.heroMiniPillText}>{user.profileStatus || "Active"}</Text>
                </View>
              </View>
            </View>

            {!showMediaContent ? (
              <View style={s.identityDetailsBox}>
                <View style={s.identityDetailRow}>
                  <Ionicons name="chatbubble-ellipses-outline" size={17} color="#F4D06F" />
                  <View style={s.identityDetailText}>
                    <Text style={s.identityDetailLabel}>Bio</Text>
                    <Text style={s.identityDetailValue} numberOfLines={2}>{user.bio || "No bio yet"}</Text>
                  </View>
                </View>

                <View style={s.identityCommandRow}>
                  {[
                    ["Kristo ID", user.userId || "No ID found", true],
                    ["Phone", user.phone || "Private / not added", Boolean((profileDraft as any)?.phonePublic ?? (session as any)?.phonePublic ?? false)],
                    ["Church", user.churchId || "No Church ID yet", Boolean((profileDraft as any)?.churchPublic ?? (session as any)?.churchPublic ?? true)],
                    ["Address", user.address || [user.city, user.country].filter(Boolean).join(", ") || "Private / not added", Boolean((profileDraft as any)?.addressPublic ?? (session as any)?.addressPublic ?? false)],
                  ].map(([label, value, canOpen]) => (
                    <Pressable
                      key={String(label)}
                      style={s.identityCommandBtn}
                      onPress={() => {
                        if (!canOpen) {
                          Alert.alert(String(label), "This information is private.");
                          return;
                        }
                        setIdentityModal({ label: String(label), value: String(value) });
                      }}
                    >
                      <Text style={s.identityCommandText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={s.bio} numberOfLines={2}>
                Creator profile for media posts, testimonies, live moments, and saved uploads.
              </Text>
            )}

            <View style={s.heroDivider} />

            {showMediaContent ? (
              <View style={s.heroMetricsGrid}>
                <View style={s.heroMetricsTopRow}>
                  <View style={[s.metricCard, s.metricCardSoft]}>
                    <Text style={s.metricValue}>{user.posts}</Text>
                    <Text style={s.metricLabel}>Media Posts</Text>
                  </View>

                  <View style={[s.metricCard, s.metricCardFeatured]}>
                    <View style={s.scorePremiumRow}>
                      <View style={s.scoreDiamondOrb}>
                        <View style={s.scoreDiamondGlow} />
                        <Ionicons name="diamond" size={34} color="#F4D06F" />
                      </View>

                      <View style={s.scoreTextCol}>
                        <Text style={s.metricValue}>{creatorScoreValue}</Text>
                        <View style={s.metricBadge}>
                          <Ionicons name="diamond-outline" size={11} color="#F4D06F" />
                          <Text style={s.metricBadgeText}>{creatorLevel}</Text>
                        </View>
                        <Text style={s.metricLabel}>Media Score</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={s.metricAwardsPanel}>
                  <View style={s.metricAwardsHead}>
                    <Text style={s.metricAwardsTitle}>Awards</Text>
                  </View>

                  <View style={s.metricAwardsRow}>
                    <View style={s.metricAwardChip}>
                      <Ionicons name="trophy-outline" size={14} color="#F4D06F" />
                      <Text style={s.metricAwardText}>{creatorCups} Cups</Text>
                    </View>

                    <View style={s.metricAwardChip}>
                      <Ionicons name="star-outline" size={14} color="#F4D06F" />
                      <Text style={s.metricAwardText}>{creatorStars} Stars</Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <View style={s.profileQuickCardsRow}>
                <Pressable
                  style={s.profileQuickCard}
                  onPress={() => {
                    if (!inviteItems.length) {
                      Alert.alert("Invitations", "No pending invitations.");
                      return;
                    }
                    setInviteModalOpen(true);
                  }}
                >
                  <Ionicons name="mail-unread-outline" size={22} color="#F4D06F" />
                  <Text style={s.profileQuickTitle}>Invitations</Text>
                  <Text style={s.profileQuickValue}>{inviteItems.length}</Text>
                  <Text style={s.profileQuickSub}>Tap to review</Text>
                </Pressable>

                <Pressable
                  style={s.profileQuickCard}
                  onPress={() => {
                    if (!claimedSchedules.length) {
                      Alert.alert("Claimed", "No upcoming claimed schedules.");
                      return;
                    }

                    setClaimedModalOpen(true);
                  }}
                >
                  <Ionicons name="calendar-outline" size={22} color="#F4D06F" />
                  <Text style={s.profileQuickTitle}>Claimed</Text>
                  <Text style={s.profileQuickValue}>{claimedSchedules.length}</Text>
                  <Text style={s.profileQuickSub}>Schedules</Text>
                </Pressable>

                <Pressable style={s.profileQuickCard} onPress={() => Alert.alert("Friends", "Friends connection screen is next.")}>
                  <Ionicons name="people-outline" size={22} color="#F4D06F" />
                  <Text style={s.profileQuickTitle}>Friends</Text>
                  <Text style={s.profileQuickValue}>{user.following}</Text>
                  <Text style={s.profileQuickSub}>Connected</Text>
                </Pressable>
              </View>
            )}


            <View style={s.compactActionsRow}>
              <Pressable
                style={s.compactPrimaryBtn}
                onPress={() => router.push("/(tabs)/profile/edit" as any)}
              >
                <Ionicons name="create-outline" size={15} color="#07111F" />
                <Text style={s.compactPrimaryBtnText}>{showMediaContent ? "Edit Media Profile" : user.profileStatus === "Incomplete" ? "Edit Profile" : "Edit Profile"}</Text>
              </Pressable>
            </View>

            {canShowMediaTab && showMediaCreatorTools ? (
              <View style={s.mediaSwitchRow}>
                <Pressable
                  style={[s.mediaActionBtn, s.mediaActionBtnPrimary]}
                  onPress={() =>
                    hasSubscription
                      ? router.push("/more/media" as any)
                      : router.push("/more/payments/subscriptions" as any)
                  }
                >
                  <Ionicons name="radio-outline" size={12} color="#07111F" />
                  <Text style={s.mediaActionBtnPrimaryText}>
                    {hasSubscription ? "Open Media" : "Subscribe First"}
                  </Text>
                </Pressable>

                <Pressable
                  style={s.mediaActionBtn}
                  onPress={() =>
                    hasSubscription
                      ? router.push("/more/media" as any)
                      : router.push("/more/payments/subscriptions" as any)
                  }
                >
                  <Ionicons
                    name={hasSubscription ? "add-circle-outline" : "card-outline"}
                    size={13}
                    color="#FFFFFF"
                  />
                  <Text style={s.mediaActionBtnText}>
                    {hasSubscription ? "Upload Post" : "Open Subscription"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {bootLoading ? (
              <ProfileHeroSkeleton />
            ) : null}
          </View>

          <View style={[s.section, s.churchActivitySection]}>
            <View style={s.sectionHead}>
              <View>
                <Text style={s.sectionTitle}>
                  {showMediaCreatorTools ? "Media Library" : "Church Activity"}
                </Text>
                <Text style={s.sectionSub}>
                  {showMediaCreatorTools
                    ? "Saved media and creator tools"
                    : "Member life inside church"}
                </Text>
              </View>
              {showActivityTabs ? (
                <View style={s.contentModeTabs}>
                  <Pressable
                    onPress={() => setContentMode("church")}
                    style={[s.contentModeTab, !showMediaActivityTab ? s.contentModeTabActive : null]}
                  >
                    <Ionicons name="home-outline" size={13} color={!showMediaActivityTab ? "#07111F" : "#F4D06F"} />
                    <Text style={[s.contentModeTabText, !showMediaActivityTab ? s.contentModeTabTextActive : null]}>
                      Church
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setContentMode("media")}
                    style={[s.contentModeTab, showMediaActivityTab ? s.contentModeTabActive : null]}
                  >
                    <Ionicons name="images-outline" size={13} color={showMediaActivityTab ? "#07111F" : "#F4D06F"} />
                    <Text style={[s.contentModeTabText, showMediaActivityTab ? s.contentModeTabTextActive : null]}>
                      Media
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={s.sectionHint}>Highlights</Text>
              )}
            </View>

            {showActivityTabs ? (
              <View style={s.activityMemberChipsWrap}>
                <ChurchActivityMemberChips
                  members={activityMemberChipRows}
                  selectedKey={activityMemberChipKey}
                  onSelect={handleActivityMemberChipSelect}
                  currentUserName={user.name}
                />
              </View>
            ) : null}

            {showMediaActivityTab ? (
              <ChurchActivityGrid
                variant="media"
                items={mediaActivityPosts}
                emptyTitle="No media posts yet"
                emptyBody="Church media uploads and creator posts will appear here."
                onItemPress={openActivityPostInChurchFeed}
              />
            ) : (
              <ChurchActivityGrid
                items={churchActivityPosts}
                emptyTitle="No church activity yet"
                emptyBody="Posts from church members will appear here."
                onItemPress={openActivityPostInChurchFeed}
              />
            )}
          </View>
        </View>
      </ScrollView>

      
      <Modal
        visible={claimedModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setClaimedModalOpen(false)}
      >
        <View style={s.claimedModalOverlay}>
          <Pressable
            style={s.claimedModalBackdrop}
            onPress={() => setClaimedModalOpen(false)}
          />

          <View style={s.claimedModalSheet}>
            <View style={s.claimedModalSheetGradientTop} pointerEvents="none" />
            <View style={s.claimedModalSheetGradientBottom} pointerEvents="none" />

            <View style={s.claimedModalHandle} />

            <View style={s.claimedModalHeader}>
              <View style={s.claimedModalHeaderCopy}>
                <Text style={s.claimedModalEyebrow}>MATTHEW 18:20</Text>

                <Text style={s.claimedModalTitle}>
                  Jesus is with us{"\n"}as we share His Word.
                </Text>

                <Text style={s.claimedModalSubtitle} numberOfLines={1}>
                  Gather, pray, and go live.
                </Text>
              </View>

              <Pressable
                onPress={() => setClaimedModalOpen(false)}
                style={s.claimedModalCloseBtn}
                hitSlop={12}
              >
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={s.claimedModalScrollContent}
            >
              {!claimedSchedules.length ? (
                <View style={s.claimedEmptyCard}>
                  <View style={s.claimedEmptyIconWrap}>
                    <Ionicons name="calendar-outline" size={30} color={GOLD} />
                  </View>
                  <Text style={s.claimedEmptyTitle}>No claimed schedules yet</Text>
                  <Text style={s.claimedEmptyText}>
                    When you claim a live slot from the home feed, it will appear here with date, time, and quick access to your room.
                  </Text>
                </View>
              ) : (
                claimedSchedules.map((slot: any, idx: number) => {
                  const startMs = parseSlotTime(slot);
                  const timingLabel = getClaimedTimingLabel(startMs);
                  const formattedDate = formatClaimedScheduleDate(slot?.meetingDate);
                  const formattedTime = formatClaimedTimeRange(slot);
                  const durationMin = Number(slot?.durationMin || 0);
                  const mediaLabel = String(
                    slot?.mediaName ||
                    slot?.churchName ||
                    slot?.churchLabel ||
                    slot?.actorLabel ||
                    user.church ||
                    "Church Media"
                  ).trim();
                  const slotNumber = String(
                    slot?.slot || slot?.slotNumber || slot?.order || idx + 1
                  );

                  return (
                    <View
                      key={String(slot?.id || idx)}
                      style={s.claimedScheduleCard}
                    >
                      <View style={s.claimedScheduleGlow} pointerEvents="none" />
                      <View style={s.claimedScheduleGlowSecondary} pointerEvents="none" />

                      <View style={s.claimedScheduleHeader}>
                        <View style={s.claimedStatusPill}>
                          <View style={s.claimedStatusDot} />
                          <Text style={s.claimedStatusPillText}>CLAIMED</Text>
                        </View>

                        <View style={s.claimedTimingPill}>
                          <Text style={s.claimedTimingPillText}>{timingLabel}</Text>
                        </View>
                      </View>

                      <Text style={s.claimedScheduleTitle} numberOfLines={1}>
                        {slot?.feedTitle || slot?.name || "Live Schedule"}
                      </Text>

                      <Text style={s.claimedScheduleMedia} numberOfLines={1}>
                        {mediaLabel}
                      </Text>

                      <View style={s.claimedScheduleMetaCompact}>
                        <View style={s.claimedMiniMetaBox}>
                          <Ionicons name="calendar" size={14} color={GOLD} />
                          <Text style={s.claimedScheduleMetaLabel}>DATE</Text>
                          <Text style={s.claimedScheduleMetaValue} numberOfLines={1}>{formattedDate.replace(/,\s*\d{4}/, "")}</Text>
                        </View>

                        <View style={s.claimedMiniMetaBox}>
                          <Ionicons name="time" size={14} color={GOLD} />
                          <Text style={s.claimedScheduleMetaLabel}>TIME</Text>
                          <Text style={s.claimedScheduleMetaValue} numberOfLines={1}>{formattedTime.replace(/\s*-.*$/, "")}</Text>
                        </View>

                        <View style={s.claimedMiniMetaBox}>
                          <Ionicons name="hourglass-outline" size={14} color={GOLD} />
                          <Text style={s.claimedScheduleMetaLabel}>SLOT</Text>
                          <Text style={s.claimedScheduleMetaValue} numberOfLines={1}>
                            {durationMin > 0 ? `${durationMin}m` : `#${slotNumber}`}
                          </Text>
                        </View>
                      </View>

                      <View style={s.claimedScheduleFooter}>
                        <Text style={s.claimedScheduleSlotTag}>SLOT {slotNumber}</Text>

                        <Pressable
                          style={({ pressed }) => [
                            s.claimedOpenBtn,
                            pressed ? s.claimedOpenBtnPressed : null,
                          ]}
                          onPress={() => {
                            setClaimedModalOpen(false);
                            (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
                            (globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ = Math.max(
                              1,
                              Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0)
                            );

                            router.push({
                              pathname: "/more/my-church-room/messages/live-room" as any,
                              params: {
                                source: "media",
                                liveMode: "schedule",
                                layout: "grid6",
                                role: "host",
                                mode: "host",
                                entryMode: "live",
                                room: "media",
                                title: String(slot?.feedTitle || slot?.name || "Live Schedule"),
                                mediaName: String(slot?.mediaName || slot?.feedTitle || "Church Media"),
                                churchName: String(
                                  slot?.churchName || slot?.churchLabel || user.church || "MY CHURCH"
                                ),
                                churchId: String(churchId || ""),
                                preferredSlotNumber: slotNumber,
                                claimedSlotNumber: slotNumber,
                                scheduleStartMs: String(startMs || ""),
                              },
                            });
                          }}
                        >
                          <Ionicons name="radio-outline" size={18} color="#07111F" />
                          <Text style={s.claimedOpenBtnText}>Open Live Room</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

<Modal visible={!!identityModal} transparent animationType="fade" onRequestClose={() => setIdentityModal(null)}>
        <View style={s.identityModalOverlay}>
          <Pressable style={s.identityModalBackdrop} onPress={() => setIdentityModal(null)} />
          <View style={s.identityModalCard}>
            <View style={s.identityModalIcon}>
              <Ionicons name="shield-checkmark-outline" size={24} color="#07111F" />
            </View>

            <Text style={s.identityModalLabel}>{identityModal?.label}</Text>
            <Text style={s.identityModalValue} selectable>
              {identityModal?.value}
            </Text>

            <Pressable
              style={s.identityCopyBtn}
              onPress={async () => {
                Alert.alert("Copied ID", String(String(identityModal?.value || "")));
                Alert.alert("Copied", `${identityModal?.label} copied.`);
              }}
            >
              <Ionicons name="copy-outline" size={18} color="#07111F" />
              <Text style={s.identityCopyText}>Copy</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={inviteModalOpen} animationType="slide" onRequestClose={() => setInviteModalOpen(false)}>
        <View style={s.inviteFullScreen}>
          <View style={s.inviteFullHeader}>
            <Pressable onPress={() => setInviteModalOpen(false)} style={s.inviteBackBtn}>
              <Ionicons name="chevron-back" size={30} color="#FFFFFF" />
            </Pressable>
            <View>
              <Text style={s.inviteFullTitle}>Invitations</Text>
              <Text style={s.inviteFullSub}>{inviteItems.length} pending</Text>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.inviteListContent}>
            {!inviteItems.length ? (
              <View style={s.inviteEmptyCard}>
                <Ionicons name="mail-open-outline" size={32} color={GOLD} />
                <Text style={s.inviteEmptyTitle}>No invitations</Text>
                <Text style={s.inviteEmptyText}>Pending invitations will appear here.</Text>
              </View>
            ) : (
              inviteItems.map((inv: any, i: number) => {
                if (isOfflineSupervisorProfileInvite(inv)) {
                  const invitationId = String(inv.invitationId || inv.id || "").trim();
                  return (
                    <View key={`offline-supervisor-${invitationId}-${i}`} style={s.inviteCompactWrap}>
                      <Text style={s.inviteSectionLabel}>PENDING INVITATION</Text>

                      <View style={s.inviteCompactCard}>
                        <View style={s.inviteCompactIcon}>
                          <Ionicons name="people-circle-outline" size={22} color={GOLD} />
                        </View>

                        <View style={s.inviteCompactInfo}>
                          <Text style={s.inviteCompactTitle}>{inv.title}</Text>
                          <Text style={s.inviteCompactRole}>{inv.message}</Text>
                          {inv.referenceChurchLabel ? (
                            <Text style={s.inviteCompactMeta}>{inv.referenceChurchLabel}</Text>
                          ) : null}

                          <View style={s.invitePendingMini}>
                            <View style={s.invitePendingDot} />
                            <Text style={s.invitePendingText}>Pending</Text>
                          </View>
                        </View>
                      </View>

                      <View style={s.inviteCompactActions}>
                        <Pressable
                          disabled={!!inviteBusy}
                          onPress={async () => {
                            if (!invitationId) {
                              return Alert.alert("Missing invite ID", "Please try again later.");
                            }
                            if (!session) return;
                            try {
                              setInviteBusy("reject");
                              await respondOfflineSupervisorProfileInvite({
                                session,
                                invitationId,
                                action: "decline",
                                setSession,
                              });
                              setTimeout(() => refreshInvitations(), 250);
                            } catch (e: any) {
                              Alert.alert("Error", String(e?.message || e));
                            } finally {
                              setInviteBusy("");
                            }
                          }}
                          style={[s.inviteCompactRejectBtn, !!inviteBusy && { opacity: 0.55 }]}
                        >
                          <Text style={s.inviteCompactRejectText}>Decline</Text>
                        </Pressable>

                        <Pressable
                          disabled={!!inviteBusy}
                          onPress={async () => {
                            if (!invitationId) {
                              return Alert.alert("Missing invite ID", "Please try again later.");
                            }
                            if (!session) return;
                            try {
                              setInviteBusy("accept");
                              await respondOfflineSupervisorProfileInvite({
                                session,
                                invitationId,
                                action: "accept",
                                setSession,
                              });
                              setInviteModalOpen(false);
                              setTimeout(() => refreshInvitations(), 250);
                            } catch (e: any) {
                              Alert.alert("Error", String(e?.message || e));
                            } finally {
                              setInviteBusy("");
                            }
                          }}
                          style={[s.inviteCompactAcceptBtn, !!inviteBusy && { opacity: 0.55 }]}
                        >
                          <Text style={s.inviteCompactAcceptText}>Accept</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                if (isOfflineAgentProfileInvite(inv)) {
                  const invitationId = String(inv.invitationId || inv.id || "").trim();
                  return (
                    <View key={`offline-agent-${invitationId}-${i}`} style={s.inviteCompactWrap}>
                      <Text style={s.inviteSectionLabel}>PENDING INVITATION</Text>

                      <View style={s.inviteCompactCard}>
                        <View style={s.inviteCompactIcon}>
                          <Ionicons name="key-outline" size={22} color={GOLD} />
                        </View>

                        <View style={s.inviteCompactInfo}>
                          <Text style={s.inviteCompactTitle}>{inv.title}</Text>
                          <Text style={s.inviteCompactRole}>{inv.message}</Text>
                          {inv.referenceChurchLabel ? (
                            <Text style={s.inviteCompactMeta}>{inv.referenceChurchLabel}</Text>
                          ) : null}

                          <View style={s.invitePendingMini}>
                            <View style={s.invitePendingDot} />
                            <Text style={s.invitePendingText}>Pending</Text>
                          </View>
                        </View>
                      </View>

                      <View style={s.inviteCompactActions}>
                        <Pressable
                          disabled={!!inviteBusy}
                          onPress={async () => {
                            if (!invitationId || !session) return;
                            try {
                              setInviteBusy("reject");
                              await respondOfflineAgentProfileInvite({
                                session,
                                invitationId,
                                action: "decline",
                                setSession,
                              });
                              setTimeout(() => refreshInvitations(), 250);
                            } catch (e: any) {
                              Alert.alert("Error", String(e?.message || e));
                            } finally {
                              setInviteBusy("");
                            }
                          }}
                          style={[s.inviteCompactRejectBtn, !!inviteBusy && { opacity: 0.55 }]}
                        >
                          <Text style={s.inviteCompactRejectText}>Decline</Text>
                        </Pressable>

                        <Pressable
                          disabled={!!inviteBusy}
                          onPress={async () => {
                            if (!invitationId || !session) return;
                            try {
                              setInviteBusy("accept");
                              await respondOfflineAgentProfileInvite({
                                session,
                                invitationId,
                                action: "accept",
                                setSession,
                              });
                              setInviteModalOpen(false);
                              setTimeout(() => refreshInvitations(), 250);
                            } catch (e: any) {
                              Alert.alert("Error", String(e?.message || e));
                            } finally {
                              setInviteBusy("");
                            }
                          }}
                          style={[s.inviteCompactAcceptBtn, !!inviteBusy && { opacity: 0.55 }]}
                        >
                          <Text style={s.inviteCompactAcceptText}>Accept</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                const id = String(inv?.membershipId || inv?.id || inv?.inviteId || inv?.ministryMemberId || "").trim();
                const title = String(inv?.title || inv?.churchName || "Grace Church");
                const role = String(inv?.role || "Member");
                const message = String(inv?.message || inv?.body || "You have been invited.");

                return (
                  <View key={`${id}-${i}`} style={s.inviteCompactWrap}>
                    <Text style={s.inviteSectionLabel}>PENDING INVITATION</Text>

                    <View style={s.inviteCompactCard}>
                      <View style={s.inviteCompactIcon}>
                        <Ionicons name="business-outline" size={22} color={GOLD} />
                      </View>

                      <View style={s.inviteCompactInfo}>
                        <Text style={s.inviteCompactTitle} numberOfLines={1}>{title}</Text>
                        <Text style={s.inviteCompactRole}>Invited as {role}</Text>

                        <View style={s.invitePendingMini}>
                          <View style={s.invitePendingDot} />
                          <Text style={s.invitePendingText}>Pending</Text>
                        </View>
                      </View>

                      <Pressable
                        onPress={async () => {
                          const invitedChurchId = String(inv?.churchId || "").trim();
                          const keyUser = String(session?.userId || "preview-user");
                          const storageKey = `kristo:invite-preview-count:${keyUser}:${invitedChurchId || "unknown-church"}:${id || "no-invite"}`;
                          const current = Number(await AsyncStorage.getItem(storageKey) || "0");

                          if (current >= 3) {
                            setPreviewLimitModalOpen(true);
                            return;
                          }

                          setInviteModalOpen(false);
                          setTimeout(() => {
                            router.push({
                              pathname: "/church/overview",
                              params: {
                                churchId: invitedChurchId,
                                invitePreview: "1",
                                inviteId: id,
                                inviteStatus: inv?.status || inv?.membershipStatus || inv?.inviteStatus || "Pending",
                              },
                            } as any);
                          }, 120);
                        }}
                        style={s.inviteProfileSideCard}
                      >
                        <Text style={s.inviteProfileSideText}>View Profile</Text>
                        <Ionicons name="chevron-forward" size={18} color={GOLD} />
                      </Pressable>
                    </View>

                    <View style={s.inviteCompactActions}>
                      <Pressable
                        disabled={!!inviteBusy}
                        onPress={async () => {
                          if (!id) return Alert.alert("Missing invite ID", "Please resend this invitation.");
                          try {
                            setInviteBusy("reject");
                            try {
                              await handleInviteAction(id, "reject");
                            } catch (e: any) {
                              const msg = String(e?.message || e).toLowerCase();
                              if (!msg.includes("rejected")) throw e;
                            }
                            closeInviteLocally(id, i);
                            setTimeout(() => refreshInvitations(), 250);
                          } catch (e: any) {
                            Alert.alert("Error", String(e?.message || e));
                          } finally {
                            setInviteBusy("");
                          }
                        }}
                        style={[s.inviteCompactRejectBtn, !!inviteBusy && { opacity: 0.55 }]}
                      >
                        <Text style={s.inviteCompactRejectText}>Reject</Text>
                      </Pressable>

                      <Pressable
                        disabled={!!inviteBusy}
                        onPress={async () => {
                          if (!id) return Alert.alert("Missing invite ID", "Please resend this invitation.");
                          try {
                            setInviteBusy("accept");
                            try {
                              const res: any = await handleInviteAction(id, "accept");
                              const joined = res?.data || res?.membership || res;
                              if (joined?.churchId && session) {
                                await setSession({
                                  ...session,
                                  churchId: String(joined.churchId),
                                  role: String(joined.churchRole || session.role || "Member") as any,
                                });
                              }
                            } catch (e: any) {
                              const msg = String(e?.message || e).toLowerCase();
                              if (
                                msg.includes("rejected") ||
                                msg.includes("left") ||
                                msg.includes("active") ||
                                msg.includes("status=") ||
                                msg.includes("cannot approve")
                              ) {
                                closeInviteLocally(id, i);
                                setTimeout(() => refreshInvitations(), 250);
                                return;
                              }
                              throw e;
                            }
                            closeInviteLocally(id, i);
                            setInviteModalOpen(false);
                            setTimeout(() => refreshInvitations(), 250);
                          } catch (e: any) {
                            Alert.alert("Error", String(e?.message || e));
                          } finally {
                            setInviteBusy("");
                          }
                        }}
                        style={[s.inviteCompactAcceptBtn, !!inviteBusy && { opacity: 0.55 }]}
                      >
                        <Text style={s.inviteCompactAcceptText}>Accept</Text>
                      </Pressable>
                    </View>

                    <View style={s.inviteQuietLine}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={GOLD} />
                      <Text style={s.inviteQuietText}>You have {inviteItems.length} pending invitation{inviteItems.length === 1 ? "" : "s"}.</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <Modal
            visible={previewLimitModalOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setPreviewLimitModalOpen(false)}
          >
            <View style={s.previewLimitOverlay}>
              <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setPreviewLimitModalOpen(false)} />

              <View style={s.previewLimitCard}>
                <View style={s.previewLimitGlow} />

                <View style={s.previewLimitIcon}>
                  <Ionicons name="shield-outline" size={54} color={GOLD} />
                  <Ionicons name="alert" size={22} color={GOLD} style={{ position: "absolute", top: 31 }} />
                </View>

                <Text style={s.previewLimitTitle}>Preview limit reached</Text>

                <Text style={s.previewLimitText}>
                  You have already viewed this church profile 3 times. For security and fairness, preview access is limited.
                </Text>

                <View style={s.previewLimitInfoBox}>
                  <View style={s.previewLimitLockCircle}>
                    <Ionicons name="lock-closed" size={23} color={GOLD} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={s.previewLimitInfoTitle}>Accept the invitation</Text>
                    <Text style={s.previewLimitInfoText}>Accept to continue and unlock full access to this church profile.</Text>
                  </View>
                </View>

                <Pressable onPress={() => setPreviewLimitModalOpen(false)} style={s.previewLimitOkBtn}>
                  <Text style={s.previewLimitOkText}>OK</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </View>
      </Modal>

</View>
  );
}

const BG = "#06101D";
const CLOSED_INVITE_IDS = new Set<string>();
const CLOSED_INVITES_STORAGE_KEY = "kristo.closed.invite.ids.v1";

const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.72)";
const SOFT = "rgba(255,255,255,0.05)";

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
 },

  container: {
    paddingHorizontal: 16,
    gap: 8,
 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 4,
 },

  title: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.2,
    lineHeight: 28,
 },

  iconBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.34)",
    shadowColor: "#FF5A5F",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
 },

  settingsIconBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.34)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
 },

  quickInfoRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 16,
 },

  quickInfoChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.025)",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    borderColor: "rgba(255,255,255,0.06)",
 },

  quickInfoText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: "700",
 },

  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    marginBottom: 16,
 },
  statItem: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    overflow: "hidden",
 },
  statInner: {
    paddingVertical: 14,
    alignItems: "center",
 },
  statValue: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 24,
 },
  statLabel: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 11,
    marginTop: 5,
    fontWeight: "800",
 },

  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 2,
 },

  primaryBtn: {
    flex: 1.15,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 3,
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
 },

  primaryBtnText: {
    color: "#07111F",
    fontSize: 15.5,
    fontWeight: "900",
 },

  secondaryBtn: {
    flex: 0.85,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 3,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
 },

  secondaryBtnText: {
    color: TEXT,
    fontSize: 12.5,
    fontWeight: "900",
 },

  bottomMetaRow: {
    flexDirection: "row",
    gap: 6,
 },

  bottomMetaChip: {
    flex: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.025)",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    borderColor: "rgba(255,255,255,0.08)",
 },

  bottomMetaLabel: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 10.8,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
 },

  bottomMetaValue: {
    color: "#FFFFFF",
    textShadowColor: "rgba(255,215,120,0.28)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
    fontSize: 12.5,
    fontWeight: "800",
 },

    heroCard: {
    marginBottom: 0,
    position: "relative",
    overflow: "hidden",
    borderRadius: 34,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    backgroundColor: "rgba(255,255,255,0.038)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.085)",
    shadowColor: "#000",
    shadowOpacity: 0.30,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },

  heroGlowA: {
    position: "absolute",
    top: -62,
    right: -22,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: "rgba(244,208,111,0.05)",
  },

  heroGlowB: {
    position: "absolute",
    bottom: -66,
    left: -36,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(44,96,255,0.05)",
  },

  heroSheen: {
    position: "absolute",
    top: 24,
    left: -18,
    right: -18,
    height: 74,
    backgroundColor: "rgba(255,255,255,0.028)",
    transform: [{ rotate: "-4deg" }],
  },

  heroTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    marginTop: 6,
    marginBottom: 10,
  },

  heroEyebrow: {
    color: "rgba(232,199,106,0.98)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2.2,
    textTransform: "uppercase",
  },

  heroTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },

  deleteMediaBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,75,108,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,75,108,0.28)",
  },

  
  heroMiniPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignSelf: "flex-start",
    marginTop: 5,
  },

  heroMiniPillText: {
    color: "#FFFFFF",
    fontSize: 11.5,
    fontWeight: "900",
  },

  heroIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  avatarShell: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.26)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },

  avatarRingGlow: {
    position: "absolute",
    inset: 2,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.11)",
  },

  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
  },

  avatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1.5,
    borderColor: GOLD,
    backgroundColor: SOFT,
  },

  profileInfo: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },

  name: {
    color: TEXT,
    fontSize: 23,
    lineHeight: 27,
    fontWeight: "900",
    letterSpacing: -0.25,
  },

  heroSummary: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 2,
  },

  bio: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 6,
    marginBottom: 0,
    fontWeight: "700",
  },


  identityDetailsBox: {
    marginTop: 10,
    gap: 8,
  },
  identityDetailRow: {
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(15,32,50,0.58)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.12)",
  },
  identityDetailText: {
    flex: 1,
    minWidth: 0,
  },
  identityDetailLabel: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 9.8,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  identityDetailValue: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "800",
    marginTop: 4,
    lineHeight: 17,
  },

  identityCommandRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 10,
  },
  identityCommandBtn: {
    width: "23.5%",
    minHeight: 44,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,32,50,0.58)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
    overflow: "hidden",
  },
  identityCommandText: {
    color: "#F4D06F",
    fontSize: 11.4,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  identityCommandValue: {
    marginTop: 4,
    color: "rgba(255,255,255,0.86)",
    fontSize: 10,
    fontWeight: "800",
  },

  identityMiniGrid: {
    flexDirection: "row",
    gap: 8,
  },
  identityMiniCard: {
    flex: 1,
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: "rgba(0,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.13)",
    gap: 3,
  },
  identityMiniValue: {
    color: "#FFFFFF",
    fontSize: 11.2,
    fontWeight: "900",
  },

  privateUserIdCard: {
    marginTop: 10,
    marginBottom: 8,
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(217,179,95,0.075)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  },
  privateUserIdIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  privateUserIdLabel: {
    color: "rgba(255,255,255,0.50)",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  privateUserIdValue: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 2,
  },

  heroDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginTop: 8,
    marginBottom: 8,
  },

  heroMetricsGrid: {
    gap: 6,
    marginBottom: 8,
  },

  heroMetricsTopRow: {
    flexDirection: "row",
    gap: 6,
  },

  metricCard: {
    flex: 1,
    minHeight: 82,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.075)",
    alignItems: "center",
    justifyContent: "center",
  },

  metricCardSoft: {
    backgroundColor: "rgba(255,255,255,0.022)",
  },

  metricCardFeatured: {
    backgroundColor: "rgba(244,208,111,0.07)",
    borderColor: "rgba(244,208,111,0.48)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  },

  metricValue: {
    color: GOLD,
    fontSize: 16,
    lineHeight: 17,
    fontWeight: "900",
    textAlign: "center",
  },

  metricLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 9,
    marginTop: 4,
    fontWeight: "900",
    textAlign: "center",
  },

  metricBadge: {
    marginTop: 5,
    minHeight: 21,
    paddingHorizontal: 8,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(244,208,111,0.13)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.30)",
  },

  metricBadgeText: {
    color: "#F8E7B0",
    fontSize: 8.5,
    fontWeight: "900",
    letterSpacing: 0.02,
  },
  scorePremiumRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  scoreDiamondOrb: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.36)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },

  scoreDiamondGlow: {
    position: "absolute",
    inset: 5,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.20)",
  },

  scoreTextCol: {
    alignItems: "center",
    justifyContent: "center",
  },

  metricAwardsPanel: {
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 12,
    backgroundColor: "rgba(244,208,111,0.045)",
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.18)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  metricAwardsHead: {
    alignItems: "center",
    marginBottom: 8,
  },
  metricAwardsTitle: {
    color: "#F8E7B0",
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
    overflow: "hidden",
  },
  metricAwardsRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricAwardChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  metricAwardText: {
    color: "#FFE9A6",
    fontSize: 11,
    fontWeight: "900",
  },


  simpleChurchStatsRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  simpleChurchStat: {
    width: "31.5%",
    minHeight: 66,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.025)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.075)",
    overflow: "hidden",
  },


  simpleChurchValue: {
    color: GOLD,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "900",
    textAlign: "center",
  },

  simpleChurchLabel: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 8.5,
    marginTop: 4,
    fontWeight: "900",
    textAlign: "center",
  },

  inviteFullScreen: {
    flex: 1,
    backgroundColor: "#06101D",
    paddingHorizontal: 18,
    paddingTop: 58,
    paddingBottom: 28,
  },
  inviteFullTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 22,
  },
  inviteBackBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  inviteFullTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
  },
  previewLimitOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(0,0,0,0.74)",
  },
  previewLimitCard: {
    borderRadius: 34,
    padding: 24,
    alignItems: "center",
    backgroundColor: "rgba(10,18,30,0.98)",
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.58)",
    overflow: "hidden",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 22,
  },
  previewLimitGlow: {
    position: "absolute",
    top: -84,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "rgba(244,208,111,0.16)",
  },
  previewLimitIcon: {
    width: 94,
    height: 94,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  previewLimitTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  previewLimitText: {
    marginTop: 12,
    color: "rgba(255,255,255,0.70)",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23,
    textAlign: "center",
  },
  previewLimitInfoBox: {
    width: "100%",
    marginTop: 22,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(244,208,111,0.07)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.42)",
  },
  previewLimitLockCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.2,
    borderColor: GOLD,
  },
  previewLimitInfoTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  previewLimitInfoText: {
    marginTop: 4,
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  previewLimitOkBtn: {
    width: "100%",
    height: 58,
    borderRadius: 22,
    marginTop: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  previewLimitOkText: {
    color: "#07111F",
    fontSize: 18,
    fontWeight: "900",
  },

  inviteCompactWrap: {
    marginTop: 18,
  },
  inviteSectionLabel: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2.6,
    marginBottom: 14,
    marginLeft: 6,
  },
  inviteCompactCard: {
    minHeight: 96,
    borderRadius: 20,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "rgba(10,18,30,0.82)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.32)",
  },
  inviteCompactIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.07)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.26)",
  },
  inviteCompactInfo: {
    flex: 1,
    minWidth: 0,
  },
  inviteCompactTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  inviteCompactRole: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  inviteCompactMeta: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
  },
  invitePendingMini: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(244,208,111,0.11)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  invitePendingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: GOLD,
  },
  inviteProfileSideCard: {
    width: 116,
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(244,208,111,0.06)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.42)",
  },
  inviteProfileSideText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },
  inviteCompactActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  inviteCompactRejectBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.10)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.32)",
  },
  inviteCompactAcceptBtn: {
    flex: 1.15,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: "rgba(255,240,190,0.90)",
  },
  inviteCompactRejectText: {
    color: "#FF8A8A",
    fontSize: 14,
    fontWeight: "900",
  },
  inviteCompactAcceptText: {
    color: "#07111F",
    fontSize: 14,
    fontWeight: "900",
  },

  inviteQuietLine: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  inviteQuietText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "800",
  },

  inviteHeroCard: {
    flex: 1,
    borderRadius: 38,
    padding: 22,
    backgroundColor: "rgba(10,18,30,0.98)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.24)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
    overflow: "hidden",
  },
  inviteChurchAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.08)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
    marginBottom: 8,
  },
  inviteChurchName: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 24,
  },
  inviteRoleText: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 6,
  },
  inviteOverviewRow: {
    display: "none",
  },
  inviteOverviewBox: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  inviteOverviewLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 8,
  },
  inviteOverviewValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
  },
  inviteMessageCard: {
    marginTop: 8,
    borderRadius: 16,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  inviteFullActions: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
  },
  inviteDeclineBtnFull: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  inviteAcceptBtnFull: {
    flex: 1.15,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4D06F",
  },
  profileQuickCard: {
    flex: 1,
    minHeight: 112,
    borderRadius: 20,
    padding: 12,
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  profileQuickTitle: {
    color: "#F4D06F",
    fontSize: 11,
    fontWeight: "900",
  },
  profileQuickValue: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 31,
  },
  profileQuickSub: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 10,
    fontWeight: "800",
  },

  compactActionsRow: {
    flexDirection: "row",
    gap: 0,
    marginTop: 2,
    marginBottom: 0,
  },

  compactPrimaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    shadowColor: "#F4D06F",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  compactPrimaryBtnText: {
    color: "#07111F",
    fontSize: 11.5,
    fontWeight: "900",
  },

  mediaSwitchRow: {
    marginTop: 6,
    flexDirection: "row",
    gap: 6,
  },

  mediaActionBtn: {
    flex: 1,
    minHeight: 32,
    borderRadius: 11,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  mediaActionBtnPrimary: {
    backgroundColor: GOLD,
    borderColor: "rgba(255,240,190,0.95)",
  },

  mediaActionBtnText: {
    color: "#FFFFFF",
    fontSize: 8.8,
    fontWeight: "900",
  },

  mediaActionBtnPrimaryText: {
    color: "#07111F",
    fontSize: 8.8,
    fontWeight: "900",
  },

  loadingBox: {

    marginTop: 8,
    paddingTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
 },

  loadingText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11.5,
    fontWeight: "700",
 },

  section: {
    marginTop: 34,
  },

  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 6,
    marginBottom: 16,
 },

  sectionTitle: {
    color: TEXT,
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 0.15,
 },

  sectionSub: {
    fontSize: 12.5,
    color: "rgba(255,255,255,0.62)",
    fontWeight: "600",
    marginTop: 2,
 },

  sectionHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11.5,
    fontWeight: "700",
    marginBottom: 4,
 },

  contentModeTabs: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
  },

  contentModeTab: {
    minHeight: 31,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  contentModeTabActive: {
    backgroundColor: "#F4D06F",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  contentModeTabText: {
    color: "#F8E7B0",
    fontSize: 11.5,
    fontWeight: "900",
  },

  contentModeTabTextActive: {
    color: "#07111F",
  },
  activityMemberChipsWrap: {
    marginTop: 12,
    marginBottom: 10,
  },
  churchActivitySection: {
    paddingBottom: 28,
    marginBottom: 8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "stretch",
 },
  contentCard: {
    position: "relative",
    minHeight: 176,
    borderRadius: 24,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.24)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    overflow: "hidden",
 },

  contentGlow: {
    display: "none",
 },
  contentTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
 },
  contentIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.22)",
    shadowColor: "#FF5A5F",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
 },
  contentMetaPill: {
    maxWidth: "58%",
    minWidth: 92,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.22)",
    alignItems: "center",
    justifyContent: "center",
 },
  contentMetaPillText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 8.5,
    fontWeight: "900",
    letterSpacing: 1.1,
 },
  contentBody: {
    gap: 6,
 },
  contentEyebrow: {
    color: "rgba(244,208,111,0.96)",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "none",
 },
  contentTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: -0.3,
 },
  contentText: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: "600",
 },

  profileQuickCardsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    marginBottom: 16,
  },

  inviteFullHeader: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 },
  inviteFullSub: { color: "rgba(255,255,255,0.62)", fontSize: 13, fontWeight: "800", marginTop: 2 },
  inviteListContent: { paddingBottom: 28, gap: 12 },

  inviteListTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  inviteListIcon: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.10)",
    borderWidth: 1, borderColor: "rgba(244,208,111,0.25)",
  },
  inviteTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, width: "100%" },
  inviteListMeta: { color: "rgba(255,255,255,0.62)", fontSize: 13, fontWeight: "800", marginTop: 2 },
  invitePendingPill: {
    minWidth: 68,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.25)",
  },
  invitePendingText: { color: GOLD, fontSize: 11, fontWeight: "900" },

  inviteListCard: {
    borderRadius: 24,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
    overflow: "hidden",
  },
  inviteListTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 21,
    flex: 1,
    paddingRight: 6,
  },
  inviteViewProfileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
    alignSelf: "flex-start",
  },
  inviteViewProfileText: {
    color: "#F4D06F",
    fontSize: 12,
    fontWeight: "900",
  },
  inviteListMessage: { color: "rgba(255,255,255,0.82)", fontSize: 14, fontWeight: "800", lineHeight: 20, marginTop: 12 },
  inviteCardActions: { flexDirection: "row", gap: 6, marginTop: 14 },
  inviteRejectSmall: { flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(239,68,68,0.13)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" },
  inviteRejectSmallText: { color: "#FF8A8A", fontWeight: "900" },
  inviteAcceptSmall: { flex: 1.25, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: GOLD },
  inviteAcceptSmallText: { color: "#07111F", fontWeight: "900" },
  inviteEmptyCard: { alignItems: "center", justifyContent: "center", minHeight: 220, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.045)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  inviteEmptyTitle: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", marginTop: 12 },
  inviteEmptyText: { color: "rgba(255,255,255,0.60)", fontSize: 13, fontWeight: "700", marginTop: 6 },


  claimedScheduleMetaCompact: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },

  claimedMiniMetaBox: {
    flex: 1,
    minHeight: 76,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  identityModalOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 26,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  identityModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  identityModalCard: {
    borderRadius: 34,
    padding: 26,
    backgroundColor: "rgba(12,18,28,0.96)",
    borderWidth: 1.4,
    borderColor: "rgba(244,208,111,0.45)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.32,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
  },
  identityModalIcon: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4D06F",
    marginBottom: 16,
  },
  identityModalLabel: {
    color: "#F4D06F",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  identityModalValue: {
    marginTop: 10,
    color: "white",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 32,
  },
  identityCopyBtn: {
    marginTop: 22,
    height: 60,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#F4D06F",
  },
  identityCopyText: {
    color: "#07111F",
    fontSize: 17,
    fontWeight: "900",
  },

  claimedModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,14,0.88)",
  },
  claimedModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  claimedModalSheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 28,
    backgroundColor: "rgba(6,12,24,0.98)",
    borderWidth: 1.5,
    borderColor: "rgba(244,208,111,0.34)",
    borderBottomWidth: 0,
    overflow: "hidden",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  claimedModalSheetGradientTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: "rgba(244,208,111,0.08)",
    opacity: 0.9,
  },
  claimedModalSheetGradientBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 180,
    backgroundColor: "rgba(255,90,95,0.05)",
  },
  claimedModalHandle: {
    alignSelf: "center",
    width: 54,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.42)",
    marginBottom: 18,
  },
  claimedModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 12,
  },
  claimedModalHeaderCopy: {
    flex: 1,
  },
  claimedModalEyebrow: {
    color: "#F4D06F",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 7,
    textAlign: "center",
    textShadowColor: "rgba(244,208,111,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  claimedModalTitle: {
    color: "#FFFFFF",
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "900",
    letterSpacing: -0.8,
    textAlign: "center",
    marginTop: 18,
    textShadowColor: "rgba(255,215,120,0.32)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  claimedModalSubtitle: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 16,
  },
  claimedModalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  claimedModalScrollContent: {
    paddingBottom: 12,
    gap: 16,
  },
  claimedEmptyCard: {
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 34,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
  },
  claimedEmptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
    marginBottom: 16,
    shadowColor: "#F4D06F",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  claimedEmptyTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  claimedEmptyText: {
    marginTop: 10,
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
  },
  claimedScheduleCard: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 28,
    padding: 20,
    backgroundColor: "rgba(8,14,26,0.96)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  claimedScheduleGlow: {
    position: "absolute",
    top: -28,
    right: -28,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(244,208,111,0.16)",
  },
  claimedScheduleGlowSecondary: {
    position: "absolute",
    bottom: -36,
    left: -24,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255,90,95,0.08)",
  },
  claimedScheduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },
  claimedStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.34)",
  },
  claimedStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#F4D06F",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  claimedStatusPillText: {
    color: "#F4D06F",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  claimedTimingPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,90,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.28)",
  },
  claimedTimingPillText: {
    color: "#FF8A8A",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  claimedScheduleTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 28,
    letterSpacing: 0.2,
  },
  claimedScheduleMedia: {
    marginTop: 8,
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    fontWeight: "700",
  },
  claimedScheduleMeta: {
    marginTop: 18,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    gap: 14,
  },
  claimedScheduleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  claimedCalendarIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.24)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  claimedScheduleMetaCopy: {
    flex: 1,
  },
  claimedScheduleMetaLabel: {
    color: "rgba(244,208,111,0.72)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  claimedScheduleMetaValue: {
    marginTop: 4,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  claimedScheduleMetaDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  claimedScheduleFooter: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  claimedScheduleSlotTag: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  claimedOpenBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F4D06F",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  claimedOpenBtnPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  claimedOpenBtnText: {
    color: "#07111F",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});
