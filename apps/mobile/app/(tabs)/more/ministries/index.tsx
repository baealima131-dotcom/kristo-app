import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { loadChurchDraft, loadChurchProfileCache } from "@/src/lib/churchStore";
import {
  ChurchPremiumSubscriptionModal,
  isMinistryCreationBlocked,
} from "@/src/components/ChurchPremiumSubscriptionModal";
import {
  CHURCH_SUBSCRIPTION_MEMBER_MESSAGE,
  CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE,
  fetchChurchSubscriptionActive,
} from "@/src/lib/churchSubscription";
import {
  getMinistriesCache,
  isScreenCacheFresh,
  peekMinistriesCache,
  saveMinistriesCache,
} from "@/src/lib/screenDataCache";

// Show cached ministries instantly, then silently refresh if older than this.
const MINISTRIES_CACHE_TTL_MS = 90000;
const MINISTRIES_LOAD_TIMEOUT_MS = 12000;
const MINISTRIES_LOAD_TIMEOUT_ERR = "__MINISTRIES_LOAD_TIMEOUT__";

function withMinistriesLoadTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(MINISTRIES_LOAD_TIMEOUT_ERR)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type MinistryStatus = "Active" | "Paused";
type Ministry = {
  mediaAccess?: boolean;
  memberRole?: string;
  memberStatus?: string;
  id: string;
  name: string;
  description?: string;
  avatarUri?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
  updatedAt?: string;
};

type MinistryMember = {
  id?: string;
  userId?: string;
  role?: string;
  status?: string;
};

const PAD = 16;
const GRID_GAP = 12;
const CARD_HEIGHT = 228;
const VIP_BG = "#0B0F17";
const GOLD = "#D9B35F";
const GREEN = "#22C55E";
const GOLD_SOFT = "rgba(217,179,95,0.18)";
const GLASS = "rgba(255,255,255,0.055)";
const GLASS_2 = "rgba(255,255,255,0.035)";
const BORDER = "rgba(255,255,255,0.12)";
const BORDER_SOFT = "rgba(255,255,255,0.08)";
const TEXT_SOFT = "rgba(255,255,255,0.68)";

type CardAvatarKind = "church" | "media" | "community";

type ResolvedCardAvatar = {
  uri: string;
  hasAvatar: boolean;
  source: string;
};

function mediaUrl(u: unknown) {
  const v = String(u || "").trim();
  if (!v) return "";
  if (/^data:image\//i.test(v) || /^https?:\/\//i.test(v) || v.startsWith("file://")) return v;

  const base = String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

function logMinistriesCardAvatarResolved(
  cardType: CardAvatarKind,
  title: string,
  resolved: ResolvedCardAvatar
) {
  if (!__DEV__) return;
  console.log("KRISTO_MINISTRIES_CARD_AVATAR_RESOLVED", {
    cardType,
    title,
    hasAvatar: resolved.hasAvatar,
    source: resolved.source,
  });
}

function resolveChurchControlAvatar(
  session: Record<string, any> | null | undefined,
  churchDraft: Record<string, any> | null | undefined,
  churchProfileCache: Record<string, any> | null | undefined
): ResolvedCardAvatar {
  const profileChurch = churchDraft?.churchProfile || {};
  const candidates: Array<[string, unknown]> = [
    ["churchAvatarUri", session?.churchAvatarUri],
    ["churchLogoUri", session?.churchLogoUri],
    ["churchProfileImage", session?.churchProfileImage],
    ["churchImage", session?.churchImage],
    ["profile.church.avatarUri", profileChurch?.avatarUri || profileChurch?.avatarUrl],
    ["churchProfileCache.avatarUri", churchProfileCache?.avatarUri],
    ["churchProfileCache.avatarUrl", churchProfileCache?.avatarUrl],
    ["churchDraft.avatarUri", churchDraft?.avatarUri],
    ["churchDraft.avatarUrl", churchDraft?.avatarUrl],
  ];

  for (const [source, raw] of candidates) {
    const uri = mediaUrl(raw);
    if (uri) {
      return { uri, hasAvatar: true, source };
    }
  }

  return { uri: "", hasAvatar: false, source: "fallback:church-icon" };
}

function resolveMinistryCardAvatar(m: Partial<Ministry> & Record<string, any>): ResolvedCardAvatar {
  const ministryDirect =
    String(m?.avatarUri || "").trim() ||
    String(m?.avatarUrl || "").trim() ||
    String(m?.imageUrl || "").trim() ||
    String(m?.ministryAvatar || "").trim() ||
    String(m?.ministryAvatarUrl || "").trim() ||
    String(m?.ministryImage || "").trim() ||
    String(m?.ministryImageUrl || "").trim() ||
    String(m?.groupAvatar || "").trim() ||
    String(m?.groupImage || "").trim() ||
    String(m?.roomAvatar || "").trim() ||
    String(m?.roomImage || "").trim() ||
    String(m?.coverImage || "").trim();

  if (ministryDirect) {
    const uri = mediaUrl(ministryDirect);
    return { uri, hasAvatar: true, source: "ministry.avatarUri" };
  }

  const fallbackUri =
    "https://ui-avatars.com/api/?background=1b2433&color=ffffff&bold=true&name=" +
    encodeURIComponent(String(m?.name || "Ministry"));

  return { uri: fallbackUri, hasAvatar: true, source: "fallback:generated-initials" };
}

const getIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("choir") || n.includes("music")) return "musical-notes-outline";
  if (n.includes("youth")) return "flash-outline";
  if (n.includes("women") || n.includes("wamama")) return "heart-outline";
  if (n.includes("counsel") || n.includes("ushauri")) return "chatbubbles-outline";
  return "people-outline";
};

const getMinistryAvatarUri = (m: Partial<Ministry> & Record<string, any>) =>
  resolveMinistryCardAvatar(m).uri;

function MinistryCardAvatar({
  cardType,
  resolved,
  fallbackIcon,
  suspendedRing,
}: {
  cardType: CardAvatarKind;
  title: string;
  resolved: ResolvedCardAvatar;
  fallbackIcon: keyof typeof Ionicons.glyphMap;
  suspendedRing?: boolean;
}) {
  const ringStyle = suspendedRing
    ? s.avatarRingRedSuspended
    : cardType === "church"
      ? s.avatarRingGold
      : cardType === "media"
        ? s.avatarRingGreen
        : s.avatarRingBlue;

  const fallbackBg =
    cardType === "church"
      ? s.avatarFallbackGold
      : cardType === "media"
        ? s.avatarFallbackGreen
        : s.avatarFallbackBlue;

  return (
    <View style={[s.avatarRingOuter, ringStyle]}>
      <View style={s.avatarRingInner}>
        {resolved.hasAvatar && resolved.uri ? (
          <Image source={{ uri: resolved.uri }} style={s.cardAvatarImage} resizeMode="cover" />
        ) : (
          <View style={[s.cardAvatarFallback, fallbackBg]}>
            <Ionicons name={fallbackIcon} size={26} color="#0B0F17" />
          </View>
        )}
      </View>
    </View>
  );
}

async function apiListMinistries() {
  const startedAt = Date.now();
  const h = getKristoHeaders();
  const res = await apiGet<any>("/api/church/ministries", {
    headers: h,
  });
  if (__DEV__) {
    console.log("KRISTO_MINISTRIES_API_FETCH", {
      elapsedMs: Date.now() - startedAt,
      ok: !!res?.ok,
      error: res?.error || null,
      churchId: String((h as any)["x-kristo-church-id"] || ""),
      userId: String((h as any)["x-kristo-user-id"] || ""),
      count: Array.isArray(res?.data) ? res.data.length : 0,
    });
  }
  if (!res) throw new Error("Network error");
  if (!res.ok) throw new Error(res.error || "Fetch failed");
  return (res.data || []) as Ministry[];
}

async function apiListMinistryMembers(ministryId: string) {
  const res = await apiGet<any>(
    `/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`,
    { headers: getKristoHeaders() }
  );
  if (!res) throw new Error("Network error");
  if (!res.ok) {
    console.log("KRISTO_MINISTRY_MEMBERS_BLOCKED", {
      ministryId,
      error: res.error,
    });

    return [];
  }

  return (res.data || []) as MinistryMember[];
}

type LiveControlSelfStatus = "Active" | "Suspended";

async function apiFetchLiveControlSelfStatus(viewerId: string): Promise<LiveControlSelfStatus> {
  try {
    const res = await apiGet<any>(
      "/api/church/live-control-members?roomId=church-media-room",
      { headers: getKristoHeaders() }
    );

    if (!res || res.ok === false) return "Active";

    const selfStatus = String(res?.self?.liveControlStatus || res?.self?.status || "").trim();
    if (selfStatus === "Suspended" || selfStatus === "Active") {
      return selfStatus;
    }

    const rows = Array.isArray(res?.data) ? res.data : [];
    const mine = rows.find((x: any) => String(x?.userId || "") === viewerId);
    const rowStatus = String(mine?.liveControlStatus || mine?.status || "Active").trim();
    return rowStatus === "Suspended" ? "Suspended" : "Active";
  } catch {
    return "Active";
  }
}

export default function MoreMinistriesList() {

  const auth = getKristoAuth() as any;
  const viewerId = String(auth?.userId || "").trim();
  const churchId = String(auth?.churchId || "").trim();
  const authRole = String(auth?.role || "").toLowerCase();
  const isChurchAuthority =
    authRole.includes("pastor") ||
    authRole.includes("church_admin") ||
    authRole.includes("admin");
  const churchLiveControlRole = isChurchAuthority ? "PASTOR" : "MEMBER";

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  // Instant render from the last successful ministries snapshot (memory cache).
  const ministriesPeek = peekMinistriesCache(churchId, viewerId);
  const cacheHydratedRef = useRef(false);
  const cacheFreshRef = useRef(false);
  const hasRenderableCacheRef = useRef(Boolean(ministriesPeek?.items?.length));
  const loadSeqRef = useRef(0);

  const [items, setItems] = useState<Ministry[]>(
    (ministriesPeek?.items as Ministry[]) || []
  );
  const hasChurch = Boolean(String(auth?.churchId || "").trim());
  const [loading, setLoading] = useState(
    !ministriesPeek?.items?.length && !hasChurch
  );
  const [err, setErr] = useState<string | null>(null);
  const [churchLiveControlStatus, setChurchLiveControlStatus] =
    useState<LiveControlSelfStatus>(
      ministriesPeek?.churchLiveControlStatus === "Suspended" ? "Suspended" : "Active"
    );
  const [churchSubscriptionActive, setChurchSubscriptionActive] = useState<boolean | null>(null);
  const [premiumModalOpen, setPremiumModalOpen] = useState(false);
  const [churchAvatarContext, setChurchAvatarContext] = useState<{
    session: Record<string, any> | null;
    churchDraft: Record<string, any> | null;
    churchProfileCache: Record<string, any> | null;
  }>({ session: null, churchDraft: null, churchProfileCache: null });
  const emptyPulse = useRef(new Animated.Value(0)).current;

  const cardWidth = useMemo(
    () => Math.floor((screenWidth - PAD * 2 - GRID_GAP) / 2),
    [screenWidth]
  );

  const churchControlAvatar = useMemo(() => {
    const resolved = resolveChurchControlAvatar(
      churchAvatarContext.session,
      churchAvatarContext.churchDraft,
      churchAvatarContext.churchProfileCache
    );
    logMinistriesCardAvatarResolved("church", "Church Live Control", resolved);
    return resolved;
  }, [churchAvatarContext]);

  const hydrateFromCache = useCallback(async (): Promise<boolean> => {
    if (cacheHydratedRef.current && hasRenderableCacheRef.current) {
      return true;
    }

    const mem = peekMinistriesCache(churchId, viewerId);
    if (mem?.items?.length) {
      cacheHydratedRef.current = true;
      hasRenderableCacheRef.current = true;
      setItems(mem.items as Ministry[]);
      if (
        mem.churchLiveControlStatus === "Suspended" ||
        mem.churchLiveControlStatus === "Active"
      ) {
        setChurchLiveControlStatus(mem.churchLiveControlStatus);
      }
      cacheFreshRef.current = isScreenCacheFresh(mem.updatedAt, MINISTRIES_CACHE_TTL_MS);
      setLoading(false);
      console.log("KRISTO_MINISTRIES_CACHE_HIT", {
        source: "memory",
        count: mem.items.length,
        churchId,
        viewerId,
      });
      return true;
    }

    if (!churchId || !viewerId) return false;

    const disk = await getMinistriesCache(churchId, viewerId);
    if (disk?.items?.length) {
      cacheHydratedRef.current = true;
      hasRenderableCacheRef.current = true;
      setItems(disk.items as Ministry[]);
      if (
        disk.churchLiveControlStatus === "Suspended" ||
        disk.churchLiveControlStatus === "Active"
      ) {
        setChurchLiveControlStatus(disk.churchLiveControlStatus);
      }
      cacheFreshRef.current = isScreenCacheFresh(disk.updatedAt, MINISTRIES_CACHE_TTL_MS);
      setLoading(false);
      console.log("KRISTO_MINISTRIES_CACHE_HIT", {
        source: "disk",
        count: disk.items.length,
        churchId,
        viewerId,
      });
      return true;
    }

    return false;
  }, [churchId, viewerId]);

  async function load(opts?: { silent?: boolean; force?: boolean }) {
    const seq = ++loadSeqRef.current;
    console.log("KRISTO_MINISTRIES_LOAD_START", {
      churchId,
      viewerId,
      silent: !!opts?.silent,
      force: !!opts?.force,
      hasCache: hasRenderableCacheRef.current,
    });

    setErr(null);
    if (!opts?.silent) setLoading(true);

    try {
      const loadViewerId = viewerId;
      const loadChurchId = String(auth?.churchId || "").trim();
      const loadIsChurchAuthority = isChurchAuthority;

      if (!loadViewerId) throw new Error("User session missing.");

      const fetchWork = async () => {
        const [data, liveControlStatus, subscriptionActive] = await Promise.all([
          apiListMinistries(),
          loadChurchId
            ? apiFetchLiveControlSelfStatus(loadViewerId)
            : Promise.resolve("Active" as LiveControlSelfStatus),
          loadChurchId
            ? fetchChurchSubscriptionActive(
                loadChurchId,
                getKristoHeaders({
                  userId: loadViewerId,
                  role: (auth?.role || "Member") as any,
                  churchId: loadChurchId,
                }) as Record<string, string>,
                { isPastor: loadIsChurchAuthority }
              )
            : Promise.resolve(false),
        ]);
        const checked = await Promise.all(
          data.map(async (m) => {
            try {
              // Pastor/Admin sees all ministries in the church without per-ministry membership checks.
              if (loadIsChurchAuthority) {
                return {
                  ...m,
                  memberRole: "Pastor",
                  memberStatus: "Active",
                };
              }

              // Normal member sees only ministries where they are a real member.
              const members = await apiListMinistryMembers(m.id);
              const mine = members.find(
                (x) =>
                  String(x?.userId || "") === loadViewerId &&
                  String((x as any)?.ministryId || "") === String(m.id || "")
              );

              if (!mine) return null;

              return {
                ...m,
                memberRole: String(mine?.role || "Member"),
                memberStatus: String(mine?.status || "Active"),
              };
            } catch {
              return null;
            }
          })
        );

        return { data, liveControlStatus, checked, subscriptionActive };
      };

      const { liveControlStatus, checked, subscriptionActive } = await withMinistriesLoadTimeout(
        fetchWork(),
        MINISTRIES_LOAD_TIMEOUT_MS
      );

      if (seq !== loadSeqRef.current) return;

      const currentAuth = getKristoAuth() as any;
      if (
        String(currentAuth?.userId || "").trim() !== loadViewerId ||
        String(currentAuth?.churchId || "").trim() !== loadChurchId
      ) {
        setItems([]);
        setLoading(false);
        return;
      }

      const sortedItems = (checked.filter(Boolean) as Ministry[]).sort(
        (a, b) =>
          Number(!!b.mediaAccess) - Number(!!a.mediaAccess) ||
          String(a.name || "").localeCompare(String(b.name || ""))
      );

      setItems(sortedItems);
      setChurchLiveControlStatus(liveControlStatus);
      setChurchSubscriptionActive(subscriptionActive);
      hasRenderableCacheRef.current = sortedItems.length > 0;

      // Persist the fresh snapshot so the next focus renders instantly.
      cacheHydratedRef.current = true;
      cacheFreshRef.current = true;
      if (loadChurchId && loadViewerId) {
        void saveMinistriesCache({
          churchId: loadChurchId,
          userId: loadViewerId,
          items: sortedItems as any,
          churchLiveControlStatus: liveControlStatus,
          updatedAt: Date.now(),
        });
      }

      console.log("KRISTO_MINISTRIES_API_DONE", {
        churchId: loadChurchId,
        viewerId: loadViewerId,
        count: sortedItems.length,
      });
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;

      const msg = String(e?.message ?? e ?? "Error");
      if (msg === MINISTRIES_LOAD_TIMEOUT_ERR) {
        console.log("KRISTO_MINISTRIES_LOAD_TIMEOUT", {
          churchId,
          viewerId,
          hasCache: hasRenderableCacheRef.current,
        });
        if (!hasRenderableCacheRef.current) {
          setErr("Loading timed out. Check your connection and try again.");
        }
        return;
      }

      if (msg.toLowerCase().includes("no active church membership")) {
        setItems([]);
        setErr(null);
      } else if (!hasRenderableCacheRef.current) {
        setErr(msg);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void hydrateFromCache();
  }, [hydrateFromCache]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        // 1) Render cached ministries instantly (memory/disk) before any network.
        const hasCached = await hydrateFromCache();
        if (!alive) return;

        if (!viewerId) {
          setLoading(false);
          return;
        }

        // 2) Silent background refresh. Only show the full loader when there is
        //    nothing cached to render (first empty load). Skip entirely if the
        //    cache is still within TTL.
        if (cacheFreshRef.current) return;

        void load({ silent: hasCached || hasRenderableCacheRef.current });
      })();

      const session = getSessionSync() as Record<string, any> | null;
      const avatarChurchId = String(auth?.churchId || session?.churchId || "").trim();
      const avatarUserId = String(auth?.userId || session?.userId || "").trim();

      Promise.all([
        loadChurchDraft(avatarUserId),
        avatarChurchId ? loadChurchProfileCache(avatarChurchId) : Promise.resolve(null),
      ])
        .then(([churchDraft, churchProfileCache]) => {
          if (!alive) return;
          setChurchAvatarContext({
            session,
            churchDraft: churchDraft as Record<string, any> | null,
            churchProfileCache: churchProfileCache as Record<string, any> | null,
          });
        })
        .catch(() => {});

      Animated.loop(
        Animated.sequence([
          Animated.timing(emptyPulse, {
            toValue: 1,
            duration: 1300,
            useNativeDriver: true,
          }),
          Animated.timing(emptyPulse, {
            toValue: 0,
            duration: 1300,
            useNativeDriver: true,
          }),
        ])
      ).start();

      const timer = setInterval(() => {
        if (alive) load({ silent: true });
      }, 15000);

      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [viewerId, authRole, auth?.churchId, churchId, hydrateFromCache])
  );

  const hasItems = useMemo(() => items.length > 0, [items]);
  // Never replace an already-populated grid with a full-screen loader; only show
  // it on the first empty load. Church Live Control can render while ministries refresh.
  const showSpinner = loading && !hasItems && !hasChurch;
  const shouldShowChurchControl = hasChurch;
  const isChurchLiveControlSuspended = churchLiveControlStatus === "Suspended";
  const churchLiveControlSubscriptionLocked = isMinistryCreationBlocked(churchSubscriptionActive);
  const showGrid = hasItems || shouldShowChurchControl;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.heroWrap}>
        <View style={s.heroGlowA} />
        <View style={s.heroGlowB} />

        <View style={s.nav}>
          <View style={s.iconPill}>
            <Ionicons name="grid-outline" size={18} color={GOLD} />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.navEyebrow}>MINISTRY ROOMS</Text>
            <Text style={s.navTitle}>My Ministries</Text>
            <Text style={s.navSub}>Ministries you are part of inside your church.</Text>
          </View>

          <Pressable
            onPress={() => {
              cacheFreshRef.current = false;
              load({
                silent: hasRenderableCacheRef.current || items.length > 0 || hasChurch,
                force: true,
              });
            }}
            style={({ pressed }) => [
              s.refreshBtn,
              pressed && { opacity: 0.92, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Ionicons name="refresh" size={18} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>
      </View>

      {showSpinner ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.muted}>Loading…</Text>
        </View>
      ) : err ? (
        <View style={s.card}>
          <Text style={s.errTitle}>Error</Text>
          <Text style={s.errText}>{err}</Text>
          <Pressable
            onPress={() => load()}
            style={({ pressed }) => [
              s.btnGhost,
              pressed && { opacity: 0.92, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={s.btnGhostText}>Retry</Text>
          </Pressable>
        </View>
      ) : !showGrid ? (
        <Animated.View
          style={[
            s.vipEmptyCard,
            {
              transform: [
                {
                  translateY: emptyPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -4],
                  }),
                },
              ],
              opacity: emptyPulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ]}
        >
          <View style={s.vipEmptyGlow} />
        <View style={s.vipEmptyRedGlow} />

          <View style={s.vipEmptyIcon}>
            <Ionicons name={hasChurch ? "people-outline" : "business-outline"} size={30} color="#0B0F17" />
          </View>

          <Text style={s.vipEmptyTitle}>
            {hasChurch
              ? "No ministries joined yet"
              : "You are not in a church yet"}
          </Text>

          <Text style={s.vipEmptyText}>
            {hasChurch
              ? "You are a church member, but you have not been added to any ministry room yet. When a pastor or leader adds you, your ministry cards will appear here."
              : "Ministries belong inside a church. Join a church first or wait for a pastor/admin to approve your request, then your ministry rooms will appear here automatically."}
          </Text>

          <View style={s.vipEmptySteps}>
            <View style={s.vipStep}>
              <Ionicons name="checkmark-circle" size={15} color={GOLD} />
              <Text style={s.vipStepText}>Church membership required</Text>
            </View>
            <View style={s.vipStep}>
              <Ionicons name="person-add" size={15} color={GOLD} />
              <Text style={s.vipStepText}>Pastor/leader adds you to ministry</Text>
            </View>
            <View style={s.vipStep}>
              <Ionicons name="lock-open" size={15} color={GOLD} />
              <Text style={s.vipStepText}>Access opens automatically</Text>
            </View>
          </View>
        </Animated.View>
            ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.gridContent, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
        >
          <View style={[s.grid, { columnGap: GRID_GAP, rowGap: GRID_GAP }]}>
            {shouldShowChurchControl && !churchLiveControlSubscriptionLocked ? (
            <Pressable
              onPress={() => {
                if (isChurchLiveControlSuspended) {
                  Alert.alert(
                    "Access suspended",
                    "Your Church Live Control access is suspended."
                  );
                  return;
                }

                router.push({
                  pathname: "/(tabs)/more/my-church-room/messages/[id]",
                  params: {
                    id: "church-media-room",
                    title: "Church Live Control",
                    sub: "Whole church assignment room",
                    tab: "ministries",
                    source: "media",
                    roomKind: "assignment",
                    assignmentId: "church-media-room",
                    assignmentTitle: "Church Live Control",
                    assignmentSubtitle: "Whole church assignment room",
                    role: churchLiveControlRole,
                    assignmentInitials: "C",
                  },
                } as any);
              }}
              style={({ pressed }) => [
                s.cardItem,
                s.cardItemChurchControl,
                isChurchLiveControlSuspended ? s.cardItemChurchControlSuspended : null,
                churchLiveControlSubscriptionLocked && !isChurchLiveControlSuspended
                  ? s.cardItemChurchControlLocked
                  : null,
                isChurchLiveControlSuspended ? s.cardItemSuspendedPadding : null,
                { width: cardWidth, height: CARD_HEIGHT },
                pressed && !isChurchLiveControlSuspended && !churchLiveControlSubscriptionLocked
                  ? s.cardItemPressed
                  : null,
              ]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={
                  isChurchLiveControlSuspended
                    ? ["#3F0606", "#2A0404", "#180202"]
                    : ["rgba(28,22,12,0.98)", "rgba(14,11,7,0.96)", "rgba(8,7,5,0.94)"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {!isChurchLiveControlSuspended ? (
                <View pointerEvents="none" style={s.cardGlowGold} />
              ) : (
                <View pointerEvents="none" style={s.cardGlowRedAmbient} />
              )}
              {!isChurchLiveControlSuspended ? (
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.16)", "rgba(217,179,95,0.10)", "transparent"]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={s.cardSheen}
                />
              ) : null}

              {isChurchLiveControlSuspended ? (
                <View style={s.suspendedCardContent}>
                  <View style={[s.cardTop, s.suspendedCardTop]}>
                    <MinistryCardAvatar
                      cardType="church"
                      title="Church Live Control"
                      resolved={churchControlAvatar}
                      fallbackIcon="business-outline"
                      suspendedRing
                    />
                  </View>

                  <Text style={s.cardTitleSuspendedLayout} numberOfLines={2}>
                    Church Live Control
                  </Text>

                  <View style={s.suspendedLockSection}>
                    <View style={s.cardLockSealRing}>
                      <View style={s.cardLockSeal}>
                        <Ionicons name="lock-closed" size={22} color="#FFB4B4" />
                      </View>
                    </View>
                  </View>

                  <View style={s.suspendedWarningBlock}>
                    <Text style={s.cardSubSuspendedLine}>Access paused</Text>
                    <Text style={s.cardSubSuspendedLineSoft} numberOfLines={2}>
                      Contact your pastor or leadership
                    </Text>
                  </View>

                  <View style={s.suspendedDividerWrap}>
                    <View style={s.suspendedDashedDivider} />
                  </View>

                  <View style={s.suspendedFooter}>
                    <View style={[s.rolePill, s.rolePillSuspendedWide]}>
                      <Ionicons name="lock-closed" size={12} color="#FFFFFF" />
                      <Text style={s.rolePillTextSuspended}>SUSPENDED</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  <View style={s.cardTop}>
                    <MinistryCardAvatar
                      cardType="church"
                      title="Church Live Control"
                      resolved={churchControlAvatar}
                      fallbackIcon="business-outline"
                    />

                    <View style={s.cardTopRight}>
                      {churchLiveControlSubscriptionLocked ? (
                        <View style={s.premiumLockPill}>
                          <Ionicons name="lock-closed" size={10} color="#0B0F17" />
                          <Text style={s.premiumLockPillText}>Premium</Text>
                        </View>
                      ) : null}
                      <View style={[s.statusTopPill, s.churchTopPill]}>
                        <Text style={s.statusTopPillText} numberOfLines={1}>
                          CHURCH
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={s.cardTitle} numberOfLines={2}>
                    Church Live Control
                  </Text>
                  <Text style={s.cardSub} numberOfLines={2}>
                    {churchLiveControlSubscriptionLocked
                      ? isChurchAuthority
                        ? "Upgrade to unlock Meeting and Schedule"
                        : CHURCH_SUBSCRIPTION_MEMBER_MESSAGE
                      : "Whole church control room"}
                  </Text>

                  <View style={s.cardFooter}>
                    <View style={[s.rolePill, s.rolePillChurch]}>
                      <Text style={[s.rolePillText, s.rolePillTextChurch]}>Assignment</Text>
                    </View>
                  </View>
                </>
              )}
            </Pressable>
            ) : null}

            {items.map((m) => {
              const cardType: CardAvatarKind = m.mediaAccess ? "media" : "community";
              const ministryAvatar = resolveMinistryCardAvatar(m as any);
              logMinistriesCardAvatarResolved(cardType, String(m.name || "Ministry"), ministryAvatar);

              return (
              <Pressable
                key={m.id}
                onPress={() => {
                  const ministryId = String(m.id || "");
                  const ministryName = String(m.name || "Ministry");
                  const ministrySub = String(m.description?.trim() || "Church ministry");
                  const avatar = ministryAvatar.uri;
                  const memberStatus = String((m as any).memberStatus || "").toLowerCase();

                  if (memberStatus === "locked") {
                    Alert.alert(
                      "Ministry locked",
                      "You have not been added to this ministry yet. Once a pastor or admin adds you, you will be able to enter."
                    );
                    return;
                  }

                  if (m.mediaAccess) {
                    router.push({
                      pathname: "/(tabs)/more/my-church-room/messages/[id]",
                      params: {
                        id: ministryId,
                        title: ministryName,
                        sub: ministrySub,
                        avatar,
                        tab: "ministries",
                        source: "ministry-live",
                        roomKind: "assignment",
                        roomMode: "assignment",
                        mediaAccess: "1",
                        ministryId,
                        assignmentId: ministryId,
                        assignmentTitle: ministryName,
                        assignmentSubtitle: ministrySub,
                        assignmentRole: String((m as any).memberRole || "MEDIA TEAM"),
                        assignmentStatus: "Active",
                        assignmentInitials: ministryName.charAt(0).toUpperCase(),
                      },
                    } as any);
                    return;
                  }

                  router.push(
                    (`/more/my-church-room/messages/${encodeURIComponent(
                      ministryId
                    )}?title=${encodeURIComponent(
                      ministryName
                    )}&sub=${encodeURIComponent(
                      ministrySub
                    )}&avatar=${encodeURIComponent(
                      avatar
                    )}&tab=ministries&source=my_ministries&roomMode=ministry&ministryId=${encodeURIComponent(String(m.id || ""))}` as any)
                  );
                }}
                style={({ pressed }) => [
                  s.cardItem,
                  m.mediaAccess ? s.cardItemMediaAccess : s.cardItemCommunity,
                  { width: cardWidth, height: CARD_HEIGHT },
                  pressed && s.cardItemPressed,
                ]}
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={
                    m.mediaAccess
                      ? ["rgba(6,34,20,0.98)", "rgba(4,24,15,0.96)", "rgba(3,16,11,0.94)"]
                      : ["rgba(8,18,38,0.98)", "rgba(6,14,30,0.96)", "rgba(4,10,22,0.94)"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <View
                  pointerEvents="none"
                  style={m.mediaAccess ? s.cardGlowGreen : s.cardGlowBlue}
                />
                <LinearGradient
                  pointerEvents="none"
                  colors={
                    m.mediaAccess
                      ? ["rgba(255,255,255,0.14)", "rgba(34,197,94,0.08)", "transparent"]
                      : ["rgba(255,255,255,0.14)", "rgba(59,130,246,0.08)", "transparent"]
                  }
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={s.cardSheen}
                />

                <View style={s.cardTop}>
                  <MinistryCardAvatar
                    cardType={cardType}
                    title={String(m.name || "Ministry")}
                    resolved={ministryAvatar}
                    fallbackIcon={getIcon(String(m.name || "")) as keyof typeof Ionicons.glyphMap}
                  />

                  <View style={s.cardTopRight}>
                    <View
                      style={[
                        s.statusTopPill,
                        m.mediaAccess ? s.statusTopPillMedia : s.statusTopPillCommunity,
                      ]}
                    >
                      <Text style={s.statusTopPillText} numberOfLines={1}>
                        {m.mediaAccess ? "MEDIA" : "GROUP"}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={s.cardTitle} numberOfLines={2}>
                  {m.name}
                </Text>

                <Text style={s.cardSub} numberOfLines={2}>
                  {m.description?.trim() || "Church ministry"}
                </Text>

                <View style={s.cardFooter}>
                  <View style={[s.rolePill, m.mediaAccess ? s.rolePillMediaTeam : null]}>
                    <Text
                      style={[s.rolePillText, m.mediaAccess ? s.rolePillTextMediaTeam : null]}
                      numberOfLines={1}
                    >
                      {m.mediaAccess ? "MEDIA TEAM" : String((m as any).memberRole || "Member")}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
            })}
          </View>
        </ScrollView>
      )}

      <ChurchPremiumSubscriptionModal
        visible={premiumModalOpen}
        onClose={() => setPremiumModalOpen(false)}
        onViewSubscription={() => {
          setPremiumModalOpen(false);
          router.push("/more/payments/subscriptions" as any);
        }}
        message={CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE}
      />

      {/* LIST_ONLY_MARKER */}
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },

  heroWrap: {
    paddingHorizontal: PAD,
    paddingBottom: 10,
    overflow: "hidden",
  },
  heroGlowA: {
    position: "absolute",
    top: -10,
    left: -20,
    width: 74,
    height: 74,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  heroGlowB: {
    position: "absolute",
    top: 24,
    right: -36,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: "rgba(90,120,255,0.04)",
  },

  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 4,
    paddingBottom: 12,
  },
  iconPill: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  navEyebrow: {
    color: "rgba(217,179,95,0.92)",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  navTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  navSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.68)",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 18,
    maxWidth: "92%",
  },
  refreshBtn: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },

  createBtn: {
    marginTop: 14,
    alignSelf: "flex-start",
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  createBtnText: {
    color: "#F3D28F",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  muted: { color: TEXT_SOFT, fontWeight: "700" },

  gridContent: {
    paddingHorizontal: PAD,
    paddingTop: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },

  cardItem: {
    borderRadius: 30,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  cardItemChurchControl: {
    borderColor: "rgba(217,179,95,0.72)",
    shadowColor: GOLD,
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 14,
  },
  cardItemChurchControlSuspended: {
    borderColor: "rgba(255,110,110,0.92)",
    borderWidth: 1.5,
    shadowColor: "#FF4444",
    shadowOpacity: 0.55,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  cardItemChurchControlLocked: {
    borderColor: "rgba(217,179,95,0.42)",
    opacity: 0.92,
  },
  premiumLockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: GOLD,
    marginRight: 6,
  },
  premiumLockPillText: {
    color: "#0B0F17",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  cardItemSuspendedPadding: {
    paddingTop: 11,
    paddingBottom: 13,
    paddingHorizontal: 15,
  },
  cardGlowRedAmbient: {
    position: "absolute",
    bottom: -40,
    right: -30,
    width: 108,
    height: 108,
    borderRadius: 999,
    backgroundColor: "rgba(255,59,59,0.16)",
  },
  suspendedCardContent: {
    flex: 1,
    zIndex: 2,
    justifyContent: "flex-start",
  },
  cardTitleSuspendedLayout: {
    color: "rgba(255,255,255,0.98)",
    marginTop: 0,
    marginBottom: 2,
    minHeight: 0,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: -0.1,
    alignSelf: "flex-start",
    paddingRight: 8,
    maxWidth: "100%",
  },
  suspendedCardTop: {
    marginBottom: 6,
  },
  suspendedLockSection: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    marginBottom: 6,
  },
  suspendedWarningBlock: {
    alignItems: "center",
    alignSelf: "center",
    paddingHorizontal: 8,
    marginTop: 0,
    marginBottom: 2,
    gap: 3,
    maxWidth: "100%",
    zIndex: 3,
  },
  cardSubSuspendedLine: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  cardSubSuspendedLineSoft: {
    color: "rgba(255,186,186,0.94)",
    fontWeight: "600",
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center",
    maxWidth: "94%",
  },
  suspendedDividerWrap: {
    width: "76%",
    alignSelf: "center",
    marginTop: 6,
    marginBottom: 10,
  },
  suspendedDashedDivider: {
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,130,130,0.48)",
    width: "100%",
  },
  suspendedFooter: {
    marginTop: "auto",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 2,
    paddingBottom: 2,
  },
  rolePillSuspendedWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderColor: "rgba(255,140,140,0.72)",
    backgroundColor: "rgba(210,36,36,0.32)",
    shadowColor: "#FF3B3B",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    minWidth: 136,
    maxWidth: 160,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  rolePillTextSuspended: {
    color: "#FFFFFF",
    letterSpacing: 1,
    fontSize: 9.5,
    fontWeight: "900",
  },
  cardLockSealRing: {
    width: 76,
    height: 76,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,130,130,0.98)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    shadowColor: "#FF5555",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cardLockSeal: {
    width: 58,
    height: 58,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,190,190,0.28)",
  },
  cardItemMediaAccess: {
    borderColor: "rgba(34,197,94,0.78)",
    shadowColor: GREEN,
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 14,
  },
  cardItemCommunity: {
    borderColor: "rgba(59,130,246,0.68)",
    shadowColor: "#3B82F6",
    shadowOpacity: 0.30,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  cardGlowGold: {
    position: "absolute",
    bottom: -24,
    right: -18,
    width: 96,
    height: 96,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.20)",
  },
  cardGlowGreen: {
    position: "absolute",
    bottom: -24,
    right: -18,
    width: 96,
    height: 96,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.18)",
  },
  cardGlowBlue: {
    position: "absolute",
    bottom: -24,
    right: -18,
    width: 96,
    height: 96,
    borderRadius: 999,
    backgroundColor: "rgba(59,130,246,0.16)",
  },
  cardSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 58,
  },
  statusTopPillMedia: {
    backgroundColor: "rgba(22,163,74,0.96)",
    borderColor: "rgba(134,239,172,0.92)",
    shadowColor: GREEN,
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  statusTopPillCommunity: {
    backgroundColor: "rgba(37,99,235,0.95)",
    borderColor: "rgba(147,197,253,0.82)",
    shadowColor: "#3B82F6",
    shadowOpacity: 0.36,
    shadowRadius: 10,
  },
  churchTopPill: {
    backgroundColor: "rgba(217,179,95,0.96)",
    borderColor: "rgba(255,232,180,0.88)",
    shadowColor: GOLD,
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  rolePillChurch: {
    borderColor: "rgba(217,179,95,0.56)",
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  rolePillTextChurch: {
    color: "#F3D28F",
  },
  rolePillMediaTeam: {
    borderColor: "rgba(74,222,128,0.58)",
    backgroundColor: "rgba(34,197,94,0.14)",
    shadowColor: GREEN,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  rolePillTextMediaTeam: {
    color: "#BBF7D0",
    letterSpacing: 0.6,
  },

  cardItemPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.975 }],
  },

  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  avatarRingOuter: {
    width: 62,
    height: 62,
    borderRadius: 22,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRingGold: {
    backgroundColor: "rgba(217,179,95,0.95)",
    shadowColor: GOLD,
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  avatarRingRedSuspended: {
    backgroundColor: "rgba(255,96,96,0.96)",
    shadowColor: "#FF4444",
    shadowOpacity: 0.48,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  avatarRingGreen: {
    backgroundColor: "rgba(34,197,94,0.95)",
    shadowColor: GREEN,
    shadowOpacity: 0.38,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  avatarRingBlue: {
    backgroundColor: "rgba(59,130,246,0.92)",
    shadowColor: "#3B82F6",
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  avatarRingInner: {
    width: "100%",
    height: "100%",
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  cardAvatarImage: {
    width: "100%",
    height: "100%",
  },
  cardAvatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackGold: {
    backgroundColor: GOLD,
  },
  avatarFallbackGreen: {
    backgroundColor: "#86EFAC",
  },
  avatarFallbackBlue: {
    backgroundColor: "#93C5FD",
  },

  cardTopRight: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    minWidth: 58,
    maxWidth: 96,
  },
  statusTopPill: {
    height: 28,
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    maxWidth: 96,
  },
  statusTopPillText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 9,
    letterSpacing: 1.3,
  },

  cardTitle: {
    color: "rgba(255,255,255,0.98)",
    fontWeight: "900",
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    minHeight: 44,
    maxWidth: "100%",
  },
  cardSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
    minHeight: 34,
    maxWidth: "100%",
  },

  cardFooter: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 12,
    minHeight: 42,
  },
  rolePill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    minWidth: 92,
    maxWidth: 136,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  rolePillText: {
    color: "rgba(255,255,255,0.86)",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 0.2,
    flexShrink: 1,
  },

  card: {
    margin: PAD,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: GLASS_2,
  },
  errTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  errText: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontWeight: "700" },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  vipEmptyCard: {
    marginTop: 84,
    borderRadius: 34,
    padding: 24,
    overflow: "hidden",
    backgroundColor: "rgba(13,16,24,0.96)",
    borderWidth: 1.4,
    borderColor: "rgba(255,78,78,0.34)",
    shadowColor: "#ff3b30",
    shadowOpacity: 0.30,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  vipEmptyGlow: {
    position: "absolute",
    right: -82,
    top: -82,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "rgba(255,59,48,0.20)",
  },
  vipEmptyIcon: {
    width: 86,
    height: 86,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,76,76,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.42)",
    shadowColor: "#ff3b30",
    shadowOpacity: 0.45,
    shadowRadius: 20,
    overflow: "hidden",
  },
  vipEmptyTitle: {
    color: "white",
    fontWeight: "950",
    fontSize: 27,
    letterSpacing: -1,
  },
  vipEmptyText: {
    marginTop: 10,
    color: "rgba(255,255,255,0.76)",
    fontWeight: "750",
    lineHeight: 22,
    fontSize: 14,
  },
  vipEmptySteps: {
    marginTop: 18,
    gap: 10,
  },
  vipStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,70,70,0.075)",
    borderWidth: 1,
    borderColor: "rgba(255,92,92,0.30)",
    shadowColor: "#ff2d55",
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  vipStepText: {
    color: "rgba(255,255,255,0.88)",
    fontWeight: "850",
    fontSize: 12,
  },

  btnGhost: {
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    backgroundColor: "rgba(255,255,255,0.025)",
  },
  btnGhostText: { color: "rgba(255,255,255,0.88)", fontWeight: "900" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },
  rowTitle: { color: "rgba(255,255,255,0.95)", fontWeight: "900", fontSize: 16 },
  rowSub: { marginTop: 5, color: TEXT_SOFT, fontWeight: "700" },

  badges: { flexDirection: "row", gap: 8, marginTop: 10 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    minWidth: 74,
    maxWidth: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeOn: {
    backgroundColor: "rgba(217,179,95,0.30)",
    borderColor: "rgba(217,179,95,0.75)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  badgeOff: {
    backgroundColor: "rgba(255,255,255,0.025)",
    borderColor: "rgba(255,255,255,0.08)",
  },
  badgeRole: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.14)" },
  badgeMedia: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: GOLD, borderColor: GOLD },
  badgeMediaText: { color: "#0B0F17", fontSize: 11, fontWeight: "900" },
  badgeText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 0.2,
  },
});
