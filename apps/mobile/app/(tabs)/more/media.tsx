import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  ImageBackground,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import { usePathname, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "../../../src/lib/KristoSessionProvider";
import type { KristoMediaCategory, KristoMediaProfile } from "../../../src/lib/kristoSession";
import { getPaymentsState, subscribePayments } from "../../../src/store/paymentsStore";
import { isPlanActive } from "../../../src/lib/payments/mobileSubscriptions";
import {
  feedList,
  feedPublishMediaScheduleLocal,
  feedRemoveWhere,
  feedSyncMediaScheduleFromBackend,
  feedUnclaimSchedule,
  feedUpdateScheduleSlot,
  feedUpdateScheduleSlots,
  subscribe,
} from "../../../src/lib/homeFeedStore";
import { apiGet, apiPost, getApiBase } from "../../../src/lib/kristoApi";
import { fileNameFromUri } from "../../../src/lib/churchVideoUpload";
import { generateLocalVideoPosterUri } from "../../../src/lib/videoPoster";
import { startMediaVideoUpload, type MediaVideoUploadStatus } from "../../../src/lib/optimisticVideoUpload";
import { getKristoHeaders } from "../../../src/lib/kristoHeaders";
import { sendAssignmentCards } from "../../../src/lib/messagesStore";
import {
  applySilentMediaScheduleReload,
  fetchMediaScheduleFeedSync,
  purgeAllLocalMediaScheduleSources,
  readFeedItemScheduleSlots,
  syncMediaScheduleSlotsToBackend,
} from "../../../src/lib/mediaScheduleSilentReload";
import {
  ACTIVE_MEDIA_SCHEDULE_ERROR,
  findActiveMediaScheduleForChurch,
  isMediaScheduleFeedItem,
} from "../../../src/lib/mediaScheduleLock";
import { buildMediaScheduleAuthorityFields } from "../../../src/lib/liveMediaAuthority";
import {
  fetchChurchPastorUserId,
  logChurchPastorResolution,
} from "../../../src/lib/churchPastorResolver";
import {
  alertChurchSubscriptionRequired,
  CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE,
  isChurchSubscriptionRequiredError,
  requireActiveChurchSubscriptionForSchedule,
} from "../../../src/lib/churchSubscription";
import { isSubscriptionBypassEnabled, shouldSuppressPremiumPrompts } from "../../../src/lib/subscriptionBypass";
import { MEDIA_STUDIO_BACKGROUND } from "../../../src/lib/mediaPreload";
import {
  loadChurchMediaProfileCache,
  saveChurchMediaProfileCache,
  clearChurchMediaProfileCache,
} from "../../../src/lib/churchMediaProfileStore";
import { logTrafficCache, shouldAllowScreenRefresh } from "../../../src/lib/kristoTraffic";
import { useFocusedPolling } from "../../../src/lib/useFocusedPolling";
import {
  evaluateChurchMediaAccessMerged,
  evaluateChurchMediaAccessFromSession,
  isChurchMediaHostsApiSuccess,
  stabilizeChurchMediaAccess,
  MAX_CHURCH_MEDIA_HOSTS,
} from "../../../src/lib/churchMediaAccess";
import {
  refreshChurchMediaAccess,
  scheduleScreenRefresh,
  seedChurchMediaAccessFromSession,
  subscribeChurchMediaAccess,
} from "../../../src/lib/refreshCoordinator";
import { logFirstPaintReady } from "../../../src/lib/firstPaint";
import {
  CHURCH_RESOURCE_REFRESH_MS,
  refreshChurchMediaIfNeeded,
} from "../../../src/lib/churchResourceRefresh";
import {
  hasScreenFirstPainted,
  logScreenBackgroundRefresh,
  logScreenReopenFastPath,
  markScreenBackgroundRefresh,
  peekScreenSessionData,
  saveScreenSessionData,
  shouldSkipFocusRefresh,
} from "../../../src/lib/screenOpenState";

const MEDIA_SCREEN = "MediaScreen";

function runAfterFirstFrame(task: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      setTimeout(task, 0);
    });
    return;
  }

  setTimeout(task, 0);
}


function MediaPostVideoPreview({ uri, onChange }: { uri: string; onChange?: () => void }) {
  const [muted, setMuted] = useState(true);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    player.play();
    return () => {
      try { player.pause(); } catch {}
    };
  }, [player]);

  return (
    <View style={s.videoPreviewBox}>
      <VideoView
        player={player}
        style={s.videoPreview}
        contentFit="cover"
        nativeControls={false}
      />
      <View pointerEvents="none" style={s.videoPreviewBadge}>
        <Ionicons name="play-circle-outline" size={18} color="#F4C95D" />
        <Text style={s.videoPreviewBadgeText}>Preview</Text>
      </View>

      {onChange ? (
        <Pressable onPress={onChange} style={({ pressed }) => [s.videoPreviewChangeMini, pressed ? s.pressed : null]}>
          <Ionicons name="swap-horizontal-outline" size={18} color="#F4C95D" />
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => {
          const next = !muted;
          setMuted(next);
          try { player.muted = next; } catch {}
        }}
        style={({ pressed }) => [s.videoPreviewVolumeMini, pressed ? s.pressed : null]}
      >
        <Ionicons name={muted ? "volume-mute-outline" : "volume-high-outline"} size={18} color="#F4C95D" />
      </Pressable>
    </View>
  );
}

const CATEGORIES: KristoMediaCategory[] = [
  "Teacher",
  "Singer",
  "Counselor",
  "Preacher",
  "Motivational Speaker",
  "Testimony Creator",
  "Bible Educator",
  "Church Media",
];

export default function MediaStudioScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  const scrollRef = useRef<any>(null);
  const detailsCardYRef = useRef(0);
  const { session, setSession } = useKristoSession();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());
  const [homeFeedItems, setHomeFeedItems] = useState(() => [...feedList()]);
  const [backendFeedItems, setBackendFeedItems] = useState<any[]>([]);
  const mediaScheduleVersionRef = useRef(0);
  const mediaScheduleUpdatedAtRef = useRef("");
  const scheduleCreateInProgressRef = useRef(false);
  const scheduleCreateCooldownUntilRef = useRef(0);
  const [scheduleCreating, setScheduleCreating] = useState(false);

  const runMediaScheduleSilentReload = useCallback(
    async (reason: string, force = false) => {
      const churchId = String(session?.churchId || "").trim();
      if (!churchId) return null;

      if (scheduleCreateInProgressRef.current) {
        console.log("[ScheduleCreatePerf] skip silent reload during create", { reason });
        return null;
      }

      if (
        !force &&
        Date.now() < scheduleCreateCooldownUntilRef.current &&
        reason !== "create-media-schedule-bg"
      ) {
        console.log("[ScheduleCreatePerf] skip silent reload cooldown", { reason });
        return null;
      }

      try {
        const sync = await fetchMediaScheduleFeedSync(
          churchId,
          getKristoHeaders({
            userId: session?.userId || "",
            role: (session?.role || "Member") as any,
            churchId,
          }) as any
        );

        const result = applySilentMediaScheduleReload({
          churchId,
          sync,
          reason,
          previousVersion: mediaScheduleVersionRef.current,
          previousUpdatedAt: mediaScheduleUpdatedAtRef.current,
          force,
          ui: {
            setGuestClaimSlots,
            setGuestInvitedBySlot,
            setGuestInviteDraftBySlot,
            setBackendFeedItems,
            setHomeFeedItems,
          },
        });

        mediaScheduleVersionRef.current = result.mediaScheduleVersion;
        mediaScheduleUpdatedAtRef.current = result.mediaScheduleUpdatedAt;

        if (result.fetchFailed) {
          return result;
        }

        if (result.shouldForceLocalPurge) {
          setBackendFeedItems([]);
          setHomeFeedItems([...feedList()]);
          setGuestClaimSlots([]);
          setGuestInvitedBySlot({});
          setGuestInviteDraftBySlot({});
        } else {
          setBackendFeedItems(result.rows);
        }

        if (result.versionChanged || force) {
          setGuestClockNow(Date.now());
          if (!result.shouldForceLocalPurge) {
            setHomeFeedItems([...feedList()]);
          }
        }

        return result;
      } catch (e) {
        console.log("KRISTO_MEDIA_SILENT_RELOAD_ERROR", e);
        return null;
      }
    },
    [session?.churchId, session?.role, session?.userId]
  );

  const syncGuestScheduleSlotsToBackend = useCallback(
    async (sourceFeedId?: string, reason = "guest-slot-action") => {
      const churchId = String(session?.churchId || "").trim();
      const feedId = String(sourceFeedId || "").trim();
      if (!churchId || !feedId) return;

      const headers = getKristoHeaders({
        userId: session?.userId || "",
        role: (session?.role || "Member") as any,
        churchId,
      }) as any;

      const slots = readFeedItemScheduleSlots(feedId, backendFeedItems);
      if (!slots.length) return;

      await syncMediaScheduleSlotsToBackend(feedId, slots, headers);
      await runMediaScheduleSilentReload(reason, true);
    },
    [backendFeedItems, runMediaScheduleSilentReload, session?.churchId, session?.role, session?.userId]
  );

  useEffect(() => {
    if (!isFocused) return;
    if (!shouldAllowScreenRefresh("MediaScreen", { minMs: 60000 })) return;
    scheduleScreenRefresh(
      "MediaScreen",
      "homeFeed",
      () => {
        void runMediaScheduleSilentReload("focus", false);
      },
      { delayMs: 3500, minMs: 60000 }
    );
  }, [isFocused, runMediaScheduleSilentReload]);

  useFocusedPolling(
    "MediaScreen",
    () => {
      void runMediaScheduleSilentReload("poll");
    },
    90000,
    isFocused
  );

  const mediaSessionPeek = peekScreenSessionData<{
    cachedMedia: any;
    backendMedia: any;
    backendMediaConfirmed: boolean;
    churchMediaAccess: any;
    trustedHosts: any[];
  }>(MEDIA_SCREEN);

  const mediaBootstrapKeyRef = useRef("");
  const [guestClockNow, setGuestClockNow] = useState(() => Date.now());
  const [guestInviteDraftBySlot, setGuestInviteDraftBySlot] = useState<Record<string, string>>({});
  const [guestInvitedBySlot, setGuestInvitedBySlot] = useState<Record<string, string>>({});
  const [backendMedia, setBackendMedia] = useState<any>(mediaSessionPeek?.backendMedia ?? null);
  const [backendMediaConfirmed, setBackendMediaConfirmed] = useState(
    Boolean(mediaSessionPeek?.backendMediaConfirmed)
  );
  const [churchSubscriptionActiveFromApi, setChurchSubscriptionActiveFromApi] = useState<boolean | null>(null);
  const [cachedMedia, setCachedMedia] = useState<any>(mediaSessionPeek?.cachedMedia ?? null);
  const [profileHydrated, setProfileHydrated] = useState(true);
  const [mediaProfileReady, setMediaProfileReady] = useState(true);
  const [viewerCanManage, setViewerCanManage] = useState(false);
  const [viewerIsHost, setViewerIsHost] = useState(false);
  const [churchMediaAccess, setChurchMediaAccess] = useState(() =>
    mediaSessionPeek?.churchMediaAccess ||
    evaluateChurchMediaAccessFromSession({
      userId: session?.userId,
      role: session?.role,
      churchRole: (session as any)?.churchRole,
    })
  );

  useEffect(() => {
    seedChurchMediaAccessFromSession({
      userId: session?.userId,
      role: session?.role,
      churchRole: (session as any)?.churchRole,
    });
  }, [session?.userId, session?.role, (session as any)?.churchRole]);

  useEffect(() => {
    return subscribeChurchMediaAccess((access) => {
      setChurchMediaAccess((prev) =>
        stabilizeChurchMediaAccess(prev, access, {
          userId: session?.userId,
          role: session?.role,
          churchRole: (session as any)?.churchRole,
        })
      );
    });
  }, [session?.userId, session?.role, (session as any)?.churchRole]);
  const [trustedHosts, setTrustedHosts] = useState<any[]>(mediaSessionPeek?.trustedHosts || []);
  const mediaFetchCountRef = useRef(0);
  const [activeBackendLive, setActiveBackendLive] = useState<any>(null);
  const [vipNotice, setVipNotice] = useState<{ title: string; message: string } | null>(null);

  const claimActionPulse = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    return subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });
  }, []);

  React.useEffect(() => {
    setHomeFeedItems([...feedList()]);
    return subscribe(() => {
      setHomeFeedItems([...feedList()]);
    });
  }, []);

  React.useEffect(() => {
    const timer = setInterval(() => setGuestClockNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (!isFocused || pathname !== "/more/media") return;

    const churchId = String(session?.churchId || "").trim();
    logFirstPaintReady("MediaScreen", {
      churchId,
      hasSession: Boolean(session?.userId),
      role: session?.role || "Member",
    });
  }, [isFocused, pathname, session?.churchId, session?.role, session?.userId]);

  React.useEffect(() => {
    if (!isFocused || pathname !== "/more/media") return;

    let alive = true;
    const churchId = String(session?.churchId || "").trim();
    const bootstrapKey = `${churchId}:${session?.userId || ""}:${session?.role || ""}`;
    const isReopen = hasScreenFirstPainted(MEDIA_SCREEN);
    const savedMeta = peekScreenSessionData<{ bootstrapKey: string }>(`${MEDIA_SCREEN}:meta`);

    async function bootstrapMediaProfileFromNetwork() {
      if (!churchId || !session?.userId) return;

      const cached = await loadChurchMediaProfileCache(churchId);
      if (!alive) return;

      if (!isReopen) {
        setBackendMediaConfirmed(false);
      }

      try {
        const headers = getKristoHeaders({
          userId: session.userId,
          role: session.role,
          churchId,
        }) as Record<string, string>;

        const refresh = await refreshChurchMediaIfNeeded({
          churchId,
          userId: session.userId,
          headers,
          screen: MEDIA_SCREEN,
          includeHosts: true,
        });

        if (!alive) return;
        if (refresh.skipped) return;

        mediaFetchCountRef.current += 1;
        if (__DEV__) {
          console.log("[MediaScreen] mount fetch count", mediaFetchCountRef.current, {
            reason: isReopen ? "background-refresh" : "bootstrap",
          });
        }

        const res = refresh.mediaRes;
        const hostsRes = refresh.hostsRes;

        setChurchSubscriptionActiveFromApi(
          Boolean(res?.subscriptionActive) ||
            Boolean(res?.media?.subscriptionActive) ||
            String(res?.media?.subscriptionStatus || "")
              .trim()
              .toLowerCase() === "active"
        );

        const nextAccess = stabilizeChurchMediaAccess(
          churchMediaAccess,
          evaluateChurchMediaAccessMerged(
            {
              userId: session.userId,
              role: session.role,
              churchRole: (session as any)?.churchRole,
            },
            res,
            hostsRes
          ),
          {
            userId: session.userId,
            role: session.role,
            churchRole: (session as any)?.churchRole,
          }
        );
        setChurchMediaAccess(nextAccess);
        setTrustedHosts(
          isChurchMediaHostsApiSuccess(hostsRes) && Array.isArray(hostsRes?.hosts)
            ? hostsRes.hosts
            : []
        );

        const nextViewerCanManage = Boolean(nextAccess.canManageMediaHosts);
        const nextViewerIsHost = Boolean(nextAccess.isMediaHost);
        const profileMissing = Boolean(res?.ok && res?.profileMissing);
        const mediaApiFailed = res?.ok === false || Number(res?.status || 0) >= 400;

        setViewerCanManage(nextViewerCanManage);
        setViewerIsHost(nextViewerIsHost);

        console.log("[MediaScreen] church media access", {
          canAccessChurchMedia: nextAccess.canAccessChurchMedia,
          isActualChurchPastor: nextAccess.isActualChurchPastor,
          isMediaHost: nextAccess.isMediaHost,
          hostCount: Array.isArray(hostsRes?.hosts) ? hostsRes.hosts.length : 0,
        });
        console.log("[MediaScreen] viewerCanManage/viewerIsHost", {
          viewerCanManage: nextViewerCanManage,
          viewerIsHost: nextViewerIsHost,
        });
        console.log("[MediaScreen] profileMissing decision", {
          profileMissing,
          mediaApiFailed,
          hasBackendMedia: Boolean(res?.media?.mediaName),
          hasCache: Boolean(cached?.mediaName),
        });
        console.log("[MediaProfile] backend result", {
          churchId,
          ok: Boolean(res?.ok),
          hasMedia: Boolean(res?.media?.mediaName),
          profileMissing,
        });

        if (res?.ok && res.media?.mediaName) {
          setBackendMedia(res.media);
          setBackendMediaConfirmed(true);
          await saveChurchMediaProfileCache({
            ...res.media,
            churchId: String(res.media.churchId || churchId),
          });
          await setSession({
            ...(session as any),
            mediaProfile: res.media,
            churchMediaProfile: res.media,
          } as any);
          saveScreenSessionData(MEDIA_SCREEN, {
            cachedMedia: res.media,
            backendMedia: res.media,
            backendMediaConfirmed: true,
            churchMediaAccess: nextAccess,
            trustedHosts: isChurchMediaHostsApiSuccess(hostsRes) && Array.isArray(hostsRes?.hosts)
              ? hostsRes.hosts
              : [],
          });
          console.log("[MediaScreen] backend media confirmed", {
            churchId,
            mediaName: res.media.mediaName,
            hostCount: Array.isArray(hostsRes?.hosts) ? hostsRes.hosts.length : 0,
          });
        } else if (mediaApiFailed) {
          console.warn("[MediaScreen] media profile fetch failed; keeping cache if present", {
            churchId,
            status: Number(res?.status || 0),
            hadCache: Boolean(cached?.mediaName),
          });
          if (!isReopen || !cached?.mediaName) {
            setBackendMedia(null);
            setBackendMediaConfirmed(false);
          }
        } else {
          if (!isReopen || !cached?.mediaName) {
            setBackendMedia(null);
            setBackendMediaConfirmed(false);
          }

          if (profileMissing) {
            console.warn("[MediaScreen] stale media cache invalidated", {
              churchId,
              hadCache: Boolean(cached?.mediaName),
              profileMissing: true,
            });
            await clearChurchMediaProfileCache(churchId);
            setCachedMedia(null);
            await setSession({
              ...(session as any),
              mediaProfile: null,
              churchMediaProfile: null,
            } as any);
          }
        }
      } catch (error) {
        console.warn("[MediaScreen] bootstrap failed; keeping cache if present", {
          churchId,
          hadCache: Boolean(cached?.mediaName),
          error: String((error as any)?.message || error),
        });
      } finally {
        if (!alive || !bootstrapKey) return;
        saveScreenSessionData(`${MEDIA_SCREEN}:meta`, { bootstrapKey });
        mediaBootstrapKeyRef.current = bootstrapKey;
        markScreenBackgroundRefresh(MEDIA_SCREEN);
        setMediaProfileReady(true);
        setProfileHydrated(true);
      }
    }

    async function hydrateLocalMediaProfile() {
      if (!churchId || !session?.userId) {
        if (alive) setCachedMedia(null);
        return;
      }

      const cached = await loadChurchMediaProfileCache(churchId);
      if (!alive) return;

      if (cached?.mediaName) {
        logTrafficCache("MediaScreen", "church-media-profile", true);
        setCachedMedia(cached);
      } else {
        logTrafficCache("MediaScreen", "church-media-profile", false);
        setCachedMedia(null);
      }
    }

    if (isReopen) {
      logScreenReopenFastPath(MEDIA_SCREEN, "session-reopen");
    }

    void hydrateLocalMediaProfile();

    if (isReopen && shouldSkipFocusRefresh(MEDIA_SCREEN, CHURCH_RESOURCE_REFRESH_MS)) {
      return () => {
        alive = false;
      };
    }

    const alreadyBootstrapped =
      Boolean(bootstrapKey) &&
      (mediaBootstrapKeyRef.current === bootstrapKey || savedMeta?.bootstrapKey === bootstrapKey);

    if (alreadyBootstrapped && isReopen) {
      scheduleScreenRefresh(
        "MediaScreen",
        "overview",
        () => {
          if (shouldSkipFocusRefresh(MEDIA_SCREEN, CHURCH_RESOURCE_REFRESH_MS)) return;
          logScreenBackgroundRefresh(MEDIA_SCREEN, "focus-background");
          void bootstrapMediaProfileFromNetwork();
        },
        { delayMs: 1200, minMs: CHURCH_RESOURCE_REFRESH_MS }
      );
      return () => {
        alive = false;
      };
    }

    if (!bootstrapKey) {
      return () => {
        alive = false;
      };
    }

    mediaBootstrapKeyRef.current = bootstrapKey;
    scheduleScreenRefresh(
      "MediaScreen",
      "overview",
      () => {
        logScreenBackgroundRefresh(MEDIA_SCREEN, isReopen ? "reopen-bootstrap" : "first-bootstrap");
        void bootstrapMediaProfileFromNetwork();
      },
      { delayMs: isReopen ? 1200 : 2000, minMs: CHURCH_RESOURCE_REFRESH_MS }
    );

    return () => {
      alive = false;
    };
  }, [session?.userId, session?.churchId, session?.role, setSession, isFocused, pathname]);

  const loadActiveBackendLive = useCallback(async () => {
    if (!session?.userId || !session?.churchId) return;

    const res: any = await apiGet(
      "/api/church/live",
      {
        headers: getKristoHeaders({
          userId: session.userId,
          role: (session.role || "Member") as any,
          churchId: session.churchId || "",
        }),
      },
      { screen: "MediaScreen", throttleMs: 45000 }
    );

    setActiveBackendLive(res?.live?.isLive ? res.live : null);
  }, [isFocused, pathname, session?.churchId, session?.role, session?.userId]);

  useFocusedPolling("MediaScreenLive", () => loadActiveBackendLive(), 120000, isFocused);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(claimActionPulse, {
          toValue: 1,
          duration: 780,
          useNativeDriver: true,
        }),
        Animated.timing(claimActionPulse, {
          toValue: 0,
          duration: 780,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [claimActionPulse]);

  const existingMedia = backendMediaConfirmed ? backendMedia : null;
  const churchMediaProfile =
    existingMedia || (cachedMedia?.mediaName ? cachedMedia : null);

  const hasChurchMembership = Boolean(String(session?.churchId || "").trim());
  const isActualChurchPastor = churchMediaAccess.isActualChurchPastor;
  const isMediaHostFromProfile = churchMediaAccess.isMediaHost;
  const canAccessChurchMedia = churchMediaAccess.canAccessChurchMedia;
  const canManageMediaHosts = churchMediaAccess.canManageMediaHosts;
  const mediaHosts = trustedHosts.length
    ? trustedHosts
    : Array.isArray((churchMediaProfile as any)?.hosts)
      ? (churchMediaProfile as any).hosts
      : [];
  const viewerCanManageEffective = canManageMediaHosts || viewerCanManage;
  const viewerIsHostEffective = isMediaHostFromProfile || viewerIsHost;
  const canCreateMedia = canManageMediaHosts;
  const canUseMediaTools =
    canAccessChurchMedia || isActualChurchPastor || viewerCanManageEffective;
  const canManageChurchStorage = canManageMediaHosts;
  const canManageMediaStorage = canUseMediaTools;
  const hasChurchMediaProfile = Boolean(String(churchMediaProfile?.mediaName || "").trim());
  const showHostSetupPending =
    mediaProfileReady && !hasChurchMediaProfile && viewerIsHostEffective && !viewerCanManageEffective;
  const showAccessLocked =
    mediaProfileReady && hasChurchMembership && !canAccessChurchMedia;
  const showCreateWizard =
    mediaProfileReady && !hasChurchMediaProfile && canCreateMedia && !showHostSetupPending && !showAccessLocked;

  // Church-level media subscription.
  // Hosts NEVER control subscription ownership.
  const churchMediaSubscriptionActive =
    isSubscriptionBypassEnabled() ||
    churchSubscriptionActiveFromApi === true ||
    Boolean((churchMediaProfile as any)?.subscriptionActive);

  const subscriptionLocked =
    !isSubscriptionBypassEnabled() &&
    churchSubscriptionActiveFromApi !== null &&
    !churchMediaSubscriptionActive;

  function showSubscriptionRequired() {
    if (shouldSuppressPremiumPrompts()) return;

    if (isActualChurchPastor) {
      setVipNotice({
        title: "Premium subscription required",
        message: CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE,
      });
      return;
    }

    setVipNotice({
      title: "Subscription required",
      message: CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE,
    });
  }

  function closeSubscriptionSchedulePrompt() {
    setSubscriptionPromptOpen(false);
  }

  function openSubscriptionSchedulePrompt() {
    if (shouldSuppressPremiumPrompts()) return;
    setSubscriptionPromptOpen(true);
  }

  function handleSubscriptionPromptPrimary() {
    closeSubscriptionSchedulePrompt();
    if (isActualChurchPastor) {
      router.push("/more/payments/subscriptions" as any);
    }
  }

  // SECURITY UX: hosts must not see create wizard; pastors/admins create once per church.
  const hasMediaAccount = hasChurchMediaProfile && canUseMediaTools;

  function requireMediaManager() {
    if (canUseMediaTools) return true;
    Alert.alert(
      "Pastor access required",
      "Only the church Pastor and trusted media hosts can access Media Studio."
    );
    return false;
  }
  const currentPlan = paymentsState.subscriptions.selectedPlan;
  const planStatus = paymentsState.subscriptions.planStatus;
  const hasSubscription =
    isSubscriptionBypassEnabled() || isPlanActive(currentPlan, planStatus);
  const subscriptionLabel =
    currentPlan === "monthly"
      ? planStatus === "active"
        ? "Premium Monthly"
        : "No active subscription"
      : planStatus === "active"
      ? "Premium Yearly"
      : "No active subscription";

  const [form, setForm] = useState<KristoMediaProfile>({
    mediaName: churchMediaProfile?.mediaName || "",
    category: churchMediaProfile?.category || "Teacher",
    subCategory: churchMediaProfile?.subCategory || "",
    targetAudience: churchMediaProfile?.targetAudience || "",
    language: churchMediaProfile?.language || "",
    country: churchMediaProfile?.country || "",
    contentStyle: churchMediaProfile?.contentStyle || "",
    bio: churchMediaProfile?.bio || "",
    tags: churchMediaProfile?.tags || [],
  });

  const [tagsInput, setTagsInput] = useState(
    Array.isArray(churchMediaProfile?.tags) ? churchMediaProfile!.tags.join(", ") : ""
  );
  const [mediaStep, setMediaStep] = useState<1 | 2 | 3>(1);
  const [createStep, setCreateStep] = useState(hasMediaAccount ? 3 : 1);
  const [isEditingMedia, setIsEditingMedia] = useState(!hasMediaAccount);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [isManagingGuests, setIsManagingGuests] = useState(false);
  const [v2VipOpen, setV2VipOpen] = useState(false);
  const v2VipScale = useRef(new Animated.Value(0.92)).current;
  const v2VipFade = useRef(new Animated.Value(0)).current;
  const v2VipLift = useRef(new Animated.Value(18)).current;
  const [subscriptionPromptOpen, setSubscriptionPromptOpen] = useState(false);
  const subPromptScale = useRef(new Animated.Value(0.9)).current;
  const subPromptFade = useRef(new Animated.Value(0)).current;
  const subPromptLift = useRef(new Animated.Value(22)).current;

  useEffect(() => {
    if (!subscriptionPromptOpen) {
      subPromptScale.setValue(0.9);
      subPromptFade.setValue(0);
      subPromptLift.setValue(22);
      return;
    }

    Animated.parallel([
      Animated.spring(subPromptScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 7,
        tension: 82,
      }),
      Animated.timing(subPromptFade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(subPromptLift, {
        toValue: 0,
        useNativeDriver: true,
        friction: 7,
        tension: 74,
      }),
    ]).start();
  }, [subscriptionPromptOpen, subPromptScale, subPromptFade, subPromptLift]);

  useEffect(() => {
    if (!v2VipOpen) {
      v2VipScale.setValue(0.92);
      v2VipFade.setValue(0);
      v2VipLift.setValue(18);
      return;
    }

    Animated.parallel([
      Animated.spring(v2VipScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 7,
        tension: 80,
      }),
      Animated.timing(v2VipFade, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(v2VipLift, {
        toValue: 0,
        useNativeDriver: true,
        friction: 7,
        tension: 72,
      }),
    ]).start();
  }, [v2VipOpen, v2VipScale, v2VipFade, v2VipLift]);

  // sync form from backend-confirmed church media profile only
  React.useEffect(() => {
    if (!profileHydrated || !mediaProfileReady) return;

    const m: any = backendMediaConfirmed ? backendMedia : null;

    const hasProfile = Boolean(String(m?.mediaName || "").trim());

    if (showHostSetupPending) {
      setIsEditingMedia(false);
      setCreateStep(1);
      return;
    }

    if (!hasProfile) {
      if (!canCreateMedia) return;
      setForm({
        mediaName: "",
        category: "Church Media" as any,
        subCategory: "",
        targetAudience: "",
        language: "",
        country: "",
        contentStyle: "",
        bio: "",
        tags: [],
      });
      setTagsInput("");
      setCreateStep(1);
      setIsEditingMedia(true);
      return;
    }

    setForm({
      mediaName: String(m.mediaName || ""),
      category: (m.category || "Church Media") as any,
      subCategory: String(m.subCategory || ""),
      targetAudience: String(m.targetAudience || ""),
      language: String(m.language || ""),
      country: String(m.country || ""),
      contentStyle: String(m.contentStyle || ""),
      bio: String(m.bio || ""),
      tags: Array.isArray(m.tags) ? m.tags.map((x: any) => String(x || "").trim()).filter(Boolean) : [],
    });

    setTagsInput(Array.isArray(m.tags) ? m.tags.join(", ") : "");
    setCreateStep(3);
    setIsEditingMedia(false);
  }, [
    profileHydrated,
    mediaProfileReady,
    showHostSetupPending,
    canCreateMedia,
    backendMediaConfirmed,
    backendMedia?.id,
    backendMedia?.updatedAt,
  ]);

  const [scheduleTitle, setScheduleTitle] = useState("Pray live for people");
  const [scheduleTime, setScheduleTime] = useState("Today • 7:00 PM");
  const [scheduleSlots, setScheduleSlots] = useState("Prayer, Testimony, Support");

  const [isCreatingVideoPost, setIsCreatingVideoPost] = useState(false);
  const [videoPostUri, setVideoPostUri] = useState("");
  const [videoPostPosterUri, setVideoPostPosterUri] = useState("");
  const [videoPostTitle, setVideoPostTitle] = useState("");
  const [videoPostCaption, setVideoPostCaption] = useState("");
  const [videoPostDetailsOpen, setVideoPostDetailsOpen] = useState(false);
  const [pendingDetailsScroll, setPendingDetailsScroll] = useState(false);
  const [videoPostUploading, setVideoPostUploading] = useState(false);
  const [videoPostUploadPercent, setVideoPostUploadPercent] = useState(0);
  const [videoPostUploadStatus, setVideoPostUploadStatus] = useState<MediaVideoUploadStatus | "idle">("idle");
  const [videoPreparing, setVideoPreparing] = useState(false);
  const [videoPreparePercent, setVideoPreparePercent] = useState(0);

  const cleanVideoPostTitle = videoPostTitle.trim();
  const cleanVideoPostCaption = videoPostCaption.trim();

  const videoPostTitleOk =
    cleanVideoPostTitle.length >= 7 && cleanVideoPostTitle.length <= 15;

  const videoPostCaptionOk =
    cleanVideoPostCaption.length >= 10 && cleanVideoPostCaption.length <= 30;

  const videoPostReadyToPublish =
    !!videoPostUri && videoPostTitleOk && videoPostCaptionOk;

  const [guestClaimSlots, setGuestClaimSlots] = useState<any[]>([]);

  useEffect(() => {
    if (!pendingDetailsScroll || !videoPostDetailsOpen) return;

    const t = setTimeout(() => {
      console.log("KRISTO_AUTO_SCROLL_DETAILS");
      scrollRef.current?.scrollTo({ y: 99999, animated: true });
      setPendingDetailsScroll(false);
    }, 350);

    return () => clearTimeout(t);
  }, [pendingDetailsScroll, videoPostDetailsOpen]);

  useEffect(() => {
    if (hasMediaAccount) {
      setCreateStep(3);
      setIsEditingMedia(false);
    }
  }, [hasMediaAccount]);

  const gateText = useMemo(() => {
    if (!hasMediaAccount) return "Create your media account first";
    if (!hasChurchMembership) return "Join a church first";

    if (subscriptionLocked) {
      return CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE;
    }

    return "Media account is ready";
  }, [
    hasMediaAccount,
    hasChurchMembership,
    subscriptionLocked,
    isActualChurchPastor,
  ]);

  const syncedGuestClaimSlots = useMemo(() => {
    const churchId = String(session?.churchId || "").trim();
    const combined = backendFeedItems.length ? backendFeedItems : homeFeedItems;
    const activeSchedule = churchId
      ? findActiveMediaScheduleForChurch(combined, churchId, { strictChurch: true })
      : null;

    if (!activeSchedule) return [];

    const item = activeSchedule;
    const sourceItemId = String(item?.sourceScheduleId || item?.id || "");
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    const ownerId = String(item?.mediaOwnerId || item?.createdByUserId || item?.authorId || "").trim();
    const currentOwnerId = String(session?.userId || "").trim();
    const sessionRole = String(session?.role || "").toLowerCase();
    const isPastorOrAdmin = sessionRole.includes("pastor") || sessionRole.includes("admin");

    if (!slots.length || !isMediaScheduleFeedItem(item)) return [];

    const isMyMediaSchedule =
      isPastorOrAdmin || (!!ownerId && ownerId === currentOwnerId);

    if (!isMyMediaSchedule) return [];

    const rows = slots.map((slot: any, index: number) => {
        const rawClaimedBy =
          typeof slot?.claimedBy === "string"
            ? String(slot.claimedBy).trim()
            : "";

        const normalizedClaimedBy =
          rawClaimedBy.toLowerCase() === "open"
            ? ""
            : rawClaimedBy;

        const claimedByObj =
          typeof slot?.claimedBy === "object" && slot?.claimedBy
            ? slot.claimedBy
            : null;

        const guestName = String(
          slot?.claimedByName ||
          claimedByObj?.name ||
          normalizedClaimedBy ||
          ""
        ).trim();

        const avatarUri = String(
          slot?.claimedByAvatar ||
          claimedByObj?.avatarUri ||
          slot?.avatarUri ||
          ""
        ).trim();

        const claimedByUserId = String(
          slot?.claimedByUserId ||
          claimedByObj?.userId ||
          ""
        ).trim();

        const slotStatus = String(slot?.status || "").toLowerCase().trim();
        const isClaimed = Boolean(
          (guestName && guestName.toLowerCase() !== "open") ||
          claimedByUserId ||
          slot?.claimed === true ||
          slot?.isClaimed === true ||
          slotStatus === "claimed" ||
          slotStatus === "taken"
        );

        return {
          id: String(slot?.id || `synced-slot-${index}`),
          sourceFeedId: sourceItemId,
          title: String(slot?.name || slot?.slotLabel || `Slot ${index + 1}`),
          meetingDate: String(slot?.meetingDate || "").trim(),
          meetingDay: String(slot?.meetingDay || "").trim(),
          startTime: String(slot?.startTime || "").trim(),
          endTime: String(slot?.endTime || "").trim(),
          time: `${slot?.meetingDay || "Today"} • ${slot?.startTime || ""}`.trim(),
          durationMin: Number(slot?.durationMin || 0),
          claimedBy: isClaimed ? guestName || "Claimed guest" : "Open",
          claimedByName: guestName,
          claimedByUserId,
          claimedByAvatar: avatarUri,
          avatarUri,
          status: isClaimed ? "claimed" : "Open",
          approved: Boolean(slot?.approved),
          locked: Boolean(slot?.locked || slot?.approved),
          approvedAt: slot?.approvedAt || "",
          manuallyModified: Boolean(slot?.manuallyModified),
        };
      });

    const now = Date.now();

    return [...rows].sort((a: any, b: any) => {
      const da = parseGuestSlotDate(a);
      const db = parseGuestSlotDate(b);

      const aStart = Number(da?.startMs || 0);
      const bStart = Number(db?.startMs || 0);

      const aEnd =
        Number(da?.endMs || 0) ||
        (aStart ? aStart + Math.max(1, Number(a?.durationMin || 1)) * 60 * 1000 : 0);

      const bEnd =
        Number(db?.endMs || 0) ||
        (bStart ? bStart + Math.max(1, Number(b?.durationMin || 1)) * 60 * 1000 : 0);

      const rank = (start: number, end: number) => {
        if (start && end && now >= start && now <= end) return 0; // live now first
        if (end && now > end) return 2; // ended last
        return 1; // upcoming / idle middle
      };

      const ar = rank(aStart, aEnd);
      const br = rank(bStart, bEnd);

      if (ar !== br) return ar - br;

      if (ar === 2) return bEnd - aEnd; // newest ended first, but still below active/upcoming
      return aStart - bStart;
    });
    }, [homeFeedItems, backendFeedItems, session?.userId, session?.churchId, guestClockNow]);

  const guestClaimTotalMinutes = syncedGuestClaimSlots.reduce((sum, slot) => sum + slot.durationMin, 0);
  const guestClaimClaimedCount = syncedGuestClaimSlots.filter((slot) => slot.status === "Claimed" && !slot.approved).length;
  const guestClaimOpenCount = syncedGuestClaimSlots.filter((slot) => slot.status === "Open" && !slot.locked).length;
  const guestInvitationCount = Object.values(guestInvitedBySlot).filter(Boolean).length;
  const guestClaimConflictCount = syncedGuestClaimSlots.filter((slot, index, rows) => !!getGuestSlotConflict(slot, index, rows)).length;

  const activeMediaLiveSlot = useMemo(() => {
    const now = Date.now();

    return syncedGuestClaimSlots.find((slot: any) => {
      const startMs = parseGuestSlotDate({
        meetingDay: slot?.meetingDay || slot?.meetingDate || "Today",
        startTime: slot?.startTime || "",
        endTime: slot?.endTime || "",
      }).startMs;

      const durationMs =
        Math.max(1, Number(slot?.durationMin || 0)) * 60 * 1000;

      const endMs = startMs + durationMs;

      return startMs && now >= startMs && now <= endMs;
    }) || null;
  }, [syncedGuestClaimSlots]);
  const claimActionScale = claimActionPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.045],
  });

  function handleClearMediaSchedules() {
    Alert.alert(
      "Clear old schedules",
      "Remove all old Media schedule cards from Home feed and Guests center?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            const targetChurchId = String(session?.churchId || "").trim();

            console.log("KRISTO_DEL_OLD_REQUEST", {
              churchId: targetChurchId,
              userId: session?.userId || "",
              role: session?.role || "",
            });

            let backendDelOldResult: Record<string, unknown> | null = null;

            try {
              const clearRes: any = await apiPost(
                "/api/church/feed",
                {
                  action: "clear_media_schedules",
                  churchId: targetChurchId,
                },
                {
                  headers: getKristoHeaders({
                    userId: session?.userId || "",
                    role: (session?.role || "Member") as any,
                    churchId: targetChurchId,
                  }),
                }
              );
              backendDelOldResult = (clearRes?.data || clearRes || null) as Record<string, unknown>;
              console.log("KRISTO_DEL_OLD_BACKEND_RESULT", {
                ...backendDelOldResult,
                remainingActiveCount: Number(backendDelOldResult?.remainingActiveCount ?? -1),
              });
            } catch (e) {
              console.log("KRISTO_CLEAR_MEDIA_FEED_BACKEND_ERROR", e);
            }

            try {
              await fetch(`${process.env.EXPO_PUBLIC_API_BASE}/api/church/room-messages`, {
                method: "DELETE",
                headers: {
                  "content-type": "application/json",
                  ...getKristoHeaders({
                    userId: session?.userId || "",
                    role: (session?.role || "Member") as any,
                    churchId: session?.churchId || "",
                  }),
                },
                body: JSON.stringify({
                  roomId: "media-schedule",
                  clearAllAssignmentCards: true,
                }),
              });
            } catch (e) {
              console.log("KRISTO_CLEAR_MEDIA_BACKEND_ERROR", e);
            }

            const remainingActiveCount = Number(backendDelOldResult?.remainingActiveCount ?? -1);
            const backendDeleteClean =
              backendDelOldResult != null && remainingActiveCount === 0;

            if (backendDeleteClean || backendDelOldResult != null) {
              purgeAllLocalMediaScheduleSources({
                churchId: targetChurchId,
                reason: "del-old",
                ui: {
                  setGuestClaimSlots,
                  setGuestInvitedBySlot,
                  setGuestInviteDraftBySlot,
                  setBackendFeedItems,
                  setHomeFeedItems,
                },
              });
            }

            await runMediaScheduleSilentReload("del-old", true);
            Alert.alert("Done", "Old Media schedules removed from feed, backend, and local schedule store.");
          },
        },
      ]
    );
  }

  function handleNextCreateStep() {
    if (createStep === 1) {
      if (!form.mediaName.trim()) {
        Alert.alert("Media name required", "Please enter your media name.");
        return;
      }
      setCreateStep(2);
      return;
    }

    if (createStep === 2) {
      if (!form.language.trim()) {
        Alert.alert("Language required", "Please enter your language.");
        return;
      }
      if (!form.country.trim()) {
        Alert.alert("Country required", "Please enter your country.");
        return;
      }
      setCreateStep(3);
      return;
    }
  }

  function handleBackCreateStep() {
    if (createStep <= 1) return;
    setCreateStep((prev) => prev - 1);
  }

  async function handleSaveMediaProfile() {
    if (!requireMediaManager()) return;

    if (!session?.userId) {
      Alert.alert("Account missing", "Please sign in first.");
      return;
    }

    if (!canUseMediaTools) {
      Alert.alert(
        "Approval required",
        "You can build your media profile, but you cannot save it until your pastor makes you a Church Media host or you create your own church as Pastor."
      );
      return;
    }

    if (!hasChurchMembership) {
      Alert.alert("Church required", "Create or join a church first before creating Church Media.");
      return;
    }

    if (hasMediaAccount && !isEditingMedia) {
      Alert.alert("Media already exists", "This church already has one Church Media. You can manage it, but you cannot create another one.");
      return;
    }

    const mediaName = form.mediaName.trim();
    if (!mediaName) {
      Alert.alert("Media name required", "Please enter your media name.");
      return;
    }

    const nextProfile: KristoMediaProfile = {
      ...form,
      mediaName,
      subCategory: form.subCategory.trim(),
      targetAudience: form.targetAudience.trim(),
      language: form.language.trim(),
      country: form.country.trim(),
      contentStyle: form.contentStyle.trim(),
      bio: form.bio.trim(),
      tags: tagsInput
        .split(",")
        .map((x: string) => x.trim())
        .filter(Boolean),
    };

    const saved: any = await apiPost("/api/church/media", nextProfile, {
      headers: getKristoHeaders({
        userId: session.userId,
        role: session.role,
        churchId: session.churchId || "",
      }),
    });

    if (!saved?.ok || !saved?.media) {
      Alert.alert("Media already exists", String(saved?.error || "This church already has one Church Media."));
      return;
    }

    const serverProfile = saved.media;

    await saveChurchMediaProfileCache({
      ...serverProfile,
      churchId: String(serverProfile.churchId || session.churchId || ""),
    });
    setBackendMedia(serverProfile);
    setBackendMediaConfirmed(true);
    setCachedMedia(serverProfile);

    console.log("[MediaProfile] create/upsert result", {
      churchId: serverProfile.churchId,
      mediaName: serverProfile.mediaName,
    });

    await setSession({
      ...session,
      mediaProfile: serverProfile,
      churchMediaProfile: serverProfile,
    } as any);

    setForm(serverProfile);
    setTagsInput((serverProfile.tags || []).join(", "));
    setMediaStep(1);
    setCreateStep(3);
    setIsEditingMedia(false);
    Alert.alert("Saved", "Your media account is ready.");
  }

  function handleSubscriptionOpen() {
    if (!isActualChurchPastor) {
      showSubscriptionRequired();
      return;
    }

    router.push("/more/payments/subscriptions" as any);
  }

  function beginSmartVideoPrepare(uri: string) {
    setIsCreatingVideoPost(true);
    setVideoPostUri("");
    setVideoPostPosterUri("");
    setVideoPostTitle("");
    setVideoPostCaption("");
    setVideoPostDetailsOpen(false);
    setVideoPreparing(true);
    setVideoPreparePercent(8);

    void generateLocalVideoPosterUri(uri)
      .then((posterUri) => {
        const cleanPoster = String(posterUri || "").trim();
        if (!cleanPoster) return;
        setVideoPostPosterUri(cleanPoster);
        console.log("KRISTO_VIDEO_POSTER_CLIENT_READY", { posterUri: cleanPoster });
      })
      .catch((error) => {
        console.log("KRISTO_VIDEO_POSTER_CLIENT_ERROR", error);
      });

    let pct = 8;
    const timer = setInterval(() => {
      pct = Math.min(96, pct + (pct < 55 ? 7 : pct < 82 ? 4 : 2));
      setVideoPreparePercent(pct);
    }, 220);

    setTimeout(() => {
      clearInterval(timer);
      setVideoPostUri(uri);
      setVideoPreparePercent(100);
      setTimeout(() => setVideoPreparing(false), 350);
    }, 2600);
  }

  async function pickMediaVideoForPost() {
    setIsCreatingVideoPost(true);
    setVideoPreparing(true);
    setVideoPreparePercent(3);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo/video access to upload media posts.");
      return;
    }

    let picked: any = null;

    try {
      picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"] as any,
        allowsEditing: false,
        quality: 0.7,
        videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });
    } catch (e) {
      console.log("KRISTO_VIDEO_PICKER_ERROR", e);
      Alert.alert(
        "Video not ready",
        "This video may still be in iCloud or too large. Open it in Photos first so it downloads, then try again."
      );
      return;
    }

    if (picked?.canceled || !picked?.assets?.[0]?.uri) {
      setVideoPreparing(false);
      return;
    }

    beginSmartVideoPrepare(picked.assets[0].uri);
  }

  function publishVideoPostToFeed() {
    if (!videoPostDetailsOpen) {
      setVideoPostDetailsOpen(true);
      return;
    }

    if (videoPreparing) {
      Alert.alert("Preparing video", "Please wait until the video reaches 100%.");
      return;
    }

    if (videoPostUploading) {
      return;
    }

    if (!videoPostUri) {
      Alert.alert("Video required", "Please choose a video first.");
      return;
    }

    const typedTitle = videoPostTitle.trim();
    const typedCaption = videoPostCaption.trim();

    if (!typedTitle || !typedCaption) {
      setVideoPostDetailsOpen(true);
      setPendingDetailsScroll(true);
      Alert.alert("Title and caption required", "Please write both title and caption before posting.");
      return;
    }

    const title = typedTitle;
    const caption = typedCaption;
    const fileUri = String(videoPostUri || "").trim();
    const localPosterUri = String(videoPostPosterUri || "").trim();
    const fileName = fileNameFromUri(fileUri, `video-${Date.now()}.mp4`);
    const churchId = String(session?.churchId || "").trim();

    if (!churchId) {
      Alert.alert("Church required", "Please sign in with a church before posting.");
      return;
    }

    console.log("KRISTO_MEDIA_VIDEO_UPLOAD_START", {
      fileUri,
      localPosterUri: localPosterUri || null,
      title,
    });

    setVideoPostUploading(true);
    setVideoPostUploadPercent(0);
    setVideoPostUploadStatus("uploading");

    startMediaVideoUpload(
      {
        fileUri,
        localPosterUri: localPosterUri || undefined,
        fileName,
        title,
        caption,
        churchId,
        userId: String(session?.userId || "").trim(),
        role: String(session?.role || "Member"),
      },
      {
        onProgress: (uploadProgress, uploadStatus) => {
          const status = uploadStatus || "uploading";
          setVideoPostUploadStatus(status);
          if (status === "processing" || status === "done") {
            setVideoPostUploadPercent(100);
            return;
          }
          setVideoPostUploadPercent(Math.max(0, Math.min(99, Math.round(uploadProgress))));
        },
        onSuccess: ({ backendFeedId, videoUrl, posterUri }) => {
          setVideoPostUploadStatus("done");
          setVideoPostUploadPercent(100);

          void refreshChurchMediaIfNeeded({
            churchId,
            userId: String(session?.userId || "").trim(),
            headers: getKristoHeaders({
              userId: String(session?.userId || "").trim(),
              role: (session?.role || "Member") as any,
              churchId,
            }) as Record<string, string>,
            screen: "media-video-upload-done",
            force: true,
          }).catch((error) => {
            console.log("KRISTO_MEDIA_STORAGE_REFRESH_ERROR", error);
          });

          setVideoPostUploading(false);
          setVideoPostUploadStatus("idle");
          setVideoPostUploadPercent(0);
          setVideoPostDetailsOpen(false);
          setVideoPostUri("");
          setVideoPostPosterUri("");
          setVideoPostTitle("");
          setVideoPostCaption("");
          setIsCreatingVideoPost(false);

          if (posterUri && videoUrl) {
            (globalThis as any).__KRISTO_FEED_VIDEO_POSTER_SEED__ = {
              videoUrl,
              posterUri,
            };
          }

          if (backendFeedId) {
            (globalThis as any).__KRISTO_HOME_FEED_PENDING_FOCUS__ = backendFeedId;
          }

          try {
            (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__?.("media-video-upload-done");
          } catch {}

          console.log("KRISTO_MEDIA_VIDEO_UPLOAD_NAVIGATE_HOME", { backendFeedId });

          router.push({
            pathname: "/",
            params: { focusPostId: backendFeedId },
          } as any);
        },
        onError: (message) => {
          setVideoPostUploading(false);
          setVideoPostUploadStatus("failed");
          setVideoPostUploadPercent(0);
          console.log("KRISTO_MEDIA_VIDEO_UPLOAD_FAILED", { message });
          Alert.alert("Upload failed", message);
        },
      }
    );
  }

  async function handleLockedAction(kind: "video" | "live") {
    if (!hasMediaAccount) {
      Alert.alert("Create media account first", "Please create your media account before continuing.");
      return;
    }

    if (!hasChurchMembership) {
      Alert.alert("Join a church first", "You need church membership before using media publishing tools.");
      return;
    }

    if (kind === "video") {
      await pickMediaVideoForPost();
      return;
    }

    if (!hasSubscription) {
      Alert.alert(
        "Subscription required",
        "To go live to global feed, open subscriptions first.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open subscriptions", onPress: handleSubscriptionOpen },
        ]
      );
      return;
    }

    if (!isActualChurchPastor) {
      let activeChurchLive: any = null;
      try {
        const res: any = await apiGet("/api/church/live", {
          headers: getKristoHeaders({
            userId: session?.userId || "",
            role: (session?.role || "Member") as any,
            churchId: session?.churchId || "",
          }),
        });
        activeChurchLive = res?.live?.isLive ? res.live : null;
      } catch {}

      if (!activeChurchLive) {
        Alert.alert(
          "Pastor not live yet",
          "This is church live. The Pastor must start live first. Hosts can join after the Pastor is already live."
        );
        return;
      }

      router.push({
        pathname: "/more/my-church-room/messages/live-room",
        params: {
          source: "media",
          liveMode: "instant",
          entryMode: "live",
          role: "Viewer",
          mode: "viewer",
          room: "media",
          liveId: String(activeChurchLive?.liveId || ""),
          pastorUserId: String(activeChurchLive?.actualChurchPastorUserId || activeChurchLive?.pastorUserId || ""),
        actualChurchPastorUserId: String(activeChurchLive?.actualChurchPastorUserId || activeChurchLive?.pastorUserId || ""),
          mediaName: String(activeChurchLive?.mediaName || churchMediaProfile?.mediaName || "Church Live"),
          title: String(activeChurchLive?.title || activeChurchLive?.mediaName || churchMediaProfile?.mediaName || "Church Live"),
        },
      } as any);
      return;
    }

    Alert.alert(
      "Schedule required",
      "Church Live now depends on media schedule slots. Create a schedule first, then enter live when the active slot time arrives."
    );
    return;
  }

  const postVideoHint = !hasMediaAccount
    ? "Pastor create first"
    : !hasChurchMembership
    ? "Join a church first"
    : !canUseMediaTools
    ? "Pastor access required"
    : "Ready";

  const goLiveHint = activeMediaLiveSlot
    ? "V2 ACTIVE"
    : !hasMediaAccount
    ? "Pastor create first"
    : !hasChurchMembership
    ? "Join a church first"
    : !hasSubscription
    ? "Subscription required"
    : !canUseMediaTools
    ? "Pastor access required"
    : "V2 Feature";

  async function handleCreateLiveSchedule() {
    if (subscriptionLocked) {
      openSubscriptionSchedulePrompt();
      return;
    }
    if (!canUseMediaTools) {
      Alert.alert("Pastor access required", "Only the church Pastor and trusted media hosts can create live schedules.");
      return;
    }

    let churchAvatar = "";
    let realChurchName = "";

    try {
      const res: any = await apiGet("/api/church/profile", {
        headers: getKristoHeaders({
          userId: session?.userId || "",
          role: (session?.role || "Member") as any,
          churchId: session?.churchId || "",
        }),
      });

      const profile = res?.data?.profile || res?.profile || res?.data || {};
      churchAvatar = String(profile?.avatarUri || profile?.avatarUrl || "").trim();
      realChurchName = String(profile?.name || profile?.churchName || profile?.churchLabel || "").trim();
    } catch (e) {
      console.log("KRISTO_MEDIA_CHURCH_AVATAR_LOAD_ERROR", e);
    }

    const mediaToolAvatar = encodeURIComponent(churchAvatar);

    const mediaToolMediaName = encodeURIComponent(String(
      form.mediaName.trim() ||
      churchMediaProfile?.mediaName ||
      "Church Media"
    ));

    const mediaToolChurchName = encodeURIComponent(String(
      realChurchName ||
      (session as any)?.churchName ||
      (session as any)?.churchLabel ||
      "Church"
    ));

    router.push(
      `/kingdom/church-project-tool/media-schedule/meeting?source=media&roomId=media-schedule&title=Media%20Schedule&subtitle=Media%20Studio&avatar=${mediaToolAvatar}&mediaName=${mediaToolMediaName}&churchName=${mediaToolChurchName}` as any
    );
  }

  async function handleSendLiveScheduleToFeed() {
    if (scheduleCreateInProgressRef.current) return;

    const perfStart = Date.now();
    console.log("[ScheduleCreatePerf] start");

    scheduleCreateInProgressRef.current = true;
    setScheduleCreating(true);

    const finishCreate = () => {
      scheduleCreateInProgressRef.current = false;
      setScheduleCreating(false);
    };

    try {
      const rawCaption = scheduleTitle.trim();
      const blockedCaption =
        rawCaption.length > 60 ||
        rawCaption.toLowerCase().includes("glass") ||
        rawCaption.toLowerCase().includes("tumia") ||
        rawCaption.toLowerCase().includes("hiyo top");
      const caption = blockedCaption ? "Marriage guidance" : rawCaption || "Marriage guidance";
      const slotNames = scheduleSlots
        .split(",")
        .map((x: string) => x.trim())
        .filter(Boolean);

      const cards = slotNames.length ? slotNames : ["Prayer Live"];

      const churchId = String(session?.churchId || "").trim();
      const apiHeaders = getKristoHeaders({
        userId: session?.userId || "",
        role: (session?.role || "Member") as any,
        churchId,
      });

      if (!isSubscriptionBypassEnabled()) {
        if (!(await requireActiveChurchSubscriptionForSchedule(churchId, apiHeaders))) {
          return;
        }
      }

      if (churchId) {
        const localActive = findActiveMediaScheduleForChurch(feedList() as any[], churchId, {
          strictChurch: true,
        });

        if (localActive) {
          Alert.alert("Schedule already active", ACTIVE_MEDIA_SCHEDULE_ERROR);
          return;
        }
      }

      const scheduleId = `media-live-${Date.now()}`;
      const publishedAt = new Date().toISOString();

      function formatClock(d: Date) {
        return d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      }

      function formatMeetingDay(d: Date) {
        return d.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        });
      }

      let slotCursor = new Date(Date.now() + 5 * 60 * 1000);
      const scheduleSlotsPayload = cards.map((name, index) => {
        const durationMin = index === 0 ? 10 : index === 1 ? 21 : 5;
        const startTime = formatClock(slotCursor);
        const endDate = new Date(slotCursor.getTime() + durationMin * 60 * 1000);
        const endTime = formatClock(endDate);
        const meetingDay = formatMeetingDay(slotCursor);
        slotCursor = new Date(endDate.getTime() + 2 * 60 * 1000);

        return {
          id: `media-slot-${Date.now()}-${index}`,
          slotLabel: `Slot ${index + 1}`,
          name,
          role: caption,
          task: caption,
          meetingDate: meetingDay,
          meetingDay,
          startTime,
          endTime,
          durationMin,
          claimed: false,
          createdByUserId: String(session?.userId || ""),
          mediaOwnerId: String(session?.userId || ""),
        };
      });

      const scheduleMediaName = form.mediaName.trim() || churchMediaProfile?.mediaName || "Church Media";
      const scheduleChurchName = String(
        (session as any)?.churchName ||
        (session as any)?.churchLabel ||
        "MY CHURCH"
      );

      const scheduleAuthority = buildMediaScheduleAuthorityFields({
        churchPastorUserId: String(
          (session as any)?.actualChurchPastorUserId ||
          (session as any)?.churchPastorUserId ||
          ""
        ),
        creatorUserId: String(session?.userId || ""),
        mediaHosts,
        sourceField: "session.fallback",
      });

      logChurchPastorResolution({
        churchId,
        actualChurchPastorUserId: scheduleAuthority.actualChurchPastorUserId,
        sourceField: scheduleAuthority.pastorAuthoritySourceField || "session.fallback",
        scheduleCreatedByUserId: String(session?.userId || ""),
        currentUserId: String(session?.userId || ""),
      });

      const postPayload = {
        type: "post",
        title: cards[0],
        text: caption,
        churchId,
        createdBy: String(session?.userId || ""),
        source: "media-schedule",
        scheduleType: "media-live-slots",
        sourceScheduleId: scheduleId,
        liveId: scheduleId,
        visibility: "church",
        audience: "church",
        isGlobalMediaSlot: false,
        publishedAt,
        mediaOwnerId: scheduleAuthority.scheduleCreatedByUserId,
        createdByUserId: scheduleAuthority.scheduleCreatedByUserId,
        ...scheduleAuthority,
        actorLabel: scheduleMediaName,
        mediaName: scheduleMediaName,
        churchLabel: scheduleChurchName,
        churchName: scheduleChurchName,
        actorAvatarUri: String(
          (session as any)?.churchAvatarUri ||
          (session as any)?.churchAvatarUrl ||
          (session as any)?.avatarUri ||
          (session as any)?.avatarUrl ||
          (session as any)?.profileImage ||
          ""
        ),
        churchAvatarUri: String(
          (session as any)?.churchAvatarUri ||
          (session as any)?.churchAvatarUrl ||
          (session as any)?.avatarUri ||
          (session as any)?.avatarUrl ||
          (session as any)?.profileImage ||
          ""
        ),
        scheduleSlots: scheduleSlotsPayload,
      };

      feedPublishMediaScheduleLocal({
        ...postPayload,
        id: scheduleId,
        sourceScheduleId: scheduleId,
        updatedAt: Date.now(),
      });
      setHomeFeedItems([...feedList()]);

      console.log("[ScheduleCreate] backend post start", {
        churchId,
        sourceScheduleId: scheduleId,
        slotCount: scheduleSlotsPayload.length,
      });

      const r: any = await apiPost("/api/church/feed", postPayload, {
        headers: apiHeaders,
      });

      console.log("[ScheduleCreatePerf] postDone ms", Date.now() - perfStart);
      console.log("[ScheduleCreate] backend post result", {
        ok: r?.ok,
        feedId: r?.data?.id || r?.item?.id || r?.id,
        churchId,
        sourceScheduleId: scheduleId,
      });

      if (!r?.ok) {
        if (isChurchSubscriptionRequiredError(r)) {
          alertChurchSubscriptionRequired();
          return;
        }
        Alert.alert("Backend schedule failed", String(r?.error || JSON.stringify(r)));
        return;
      }

      const backendItem = r?.item || r?.data || r;
      const backendFeedId = String(backendItem?.id || "").trim();

      if (backendFeedId) {
        feedSyncMediaScheduleFromBackend(
          {
            ...backendItem,
            churchId,
            source: "media-schedule",
            scheduleType: "media-live-slots",
            visibility: "church",
            audience: "church",
            scheduleSlots: Array.isArray(backendItem?.scheduleSlots)
              ? backendItem.scheduleSlots
              : scheduleSlotsPayload,
          },
          scheduleId
        );
        setHomeFeedItems([...feedList()]);
        setBackendFeedItems((prev) => {
          const next = prev.filter((row) => String(row?.id || "") !== backendFeedId);
          return [
            {
              ...backendItem,
              churchId,
              source: "media-schedule",
              scheduleType: "media-live-slots",
              scheduleSlots: Array.isArray(backendItem?.scheduleSlots)
                ? backendItem.scheduleSlots
                : scheduleSlotsPayload,
            },
            ...next,
          ];
        });
        console.log("[ScheduleFeed] persisted churchId/sourceScheduleId", {
          churchId,
          sourceScheduleId: backendFeedId,
        });
      }

      console.log("[ScheduleCreatePerf] localCacheUpdated ms", Date.now() - perfStart);

      scheduleCreateCooldownUntilRef.current = Date.now() + 12000;
      (globalThis as any).__KRISTO_SCHEDULE_CREATE_COOLDOWN_UNTIL__ = scheduleCreateCooldownUntilRef.current;
      finishCreate();

      router.push("/" as any);
      console.log("[ScheduleCreatePerf] navigated ms", Date.now() - perfStart);

      void (async () => {
        try {
          sendAssignmentCards(
            "church-media-room",
            scheduleSlotsPayload.map((slot: any, index: number) => ({
              cardId: `${backendFeedId || scheduleId}-room-${index}`,
              id: `${backendFeedId || scheduleId}-room-${index}`,
              title: String(slot.name || `Slot ${index + 1}`),
              subtitle: caption,
              role: caption,
              status: "open",
              meetingDate: String(slot.meetingDay || ""),
              meetingDay: String(slot.meetingDay || ""),
              startTime: String(slot.startTime || ""),
              endTime: String(slot.endTime || ""),
              durationMin: Number(slot.durationMin || 0),
              sourceFeedId: backendFeedId || scheduleId,
              source: "media-schedule",
              roomKind: "assignment",
              liveLayout: "grid6",
            })),
            { senderName: scheduleMediaName || "Church Media" }
          );

          await runMediaScheduleSilentReload("create-media-schedule-bg", true);
          void loadActiveBackendLive();

          void fetchChurchPastorUserId(churchId, apiHeaders).then((pastorResolution) => {
            logChurchPastorResolution({
              churchId,
              actualChurchPastorUserId: pastorResolution.actualChurchPastorUserId,
              sourceField: pastorResolution.sourceField,
              scheduleCreatedByUserId: String(session?.userId || ""),
              currentUserId: String(session?.userId || ""),
            });
          });
        } catch (e) {
          console.log("[ScheduleCreatePerf] background error", e);
        } finally {
          console.log("[ScheduleCreatePerf] backgroundRefreshDone ms", Date.now() - perfStart);
        }
      })();
    } catch (e: any) {
      console.log("[ScheduleCreate] backend post error", e);
      if (isChurchSubscriptionRequiredError(e)) {
        alertChurchSubscriptionRequired();
        return;
      }
      if (Number(e?.status || e?.response?.status || 0) === 409) {
        Alert.alert("Schedule already active", ACTIVE_MEDIA_SCHEDULE_ERROR);
        return;
      }
      Alert.alert("Backend schedule error", String(e?.message || e));
    } finally {
      if (scheduleCreateInProgressRef.current) {
        finishCreate();
      }
    }
  }


  function updateGuestClaimSlot(slotId: string, patch: any) {
    setGuestClaimSlots((prev) =>
      prev.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot))
    );
  }

  function addMinutesToClock(timeText: string, minutesToAdd: number) {
    const match = String(timeText || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return timeText;

    let hour = Number(match[1] || 0);
    const minute = Number(match[2] || 0);
    const meridiem = String(match[3] || "").toUpperCase();

    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;

    const date = new Date();
    date.setHours(hour, minute + minutesToAdd, 0, 0);

    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  function getMinutesBetween(startTime: string, endTime: string) {
    const startMs = parseGuestSlotDate({ meetingDay: "Today", startTime, endTime: startTime }).startMs;
    let endMs = parseGuestSlotDate({ meetingDay: "Today", startTime, endTime }).endMs;
    if (!startMs || !endMs) return 0;
    if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;
    return Math.max(1, Math.round((endMs - startMs) / 60000));
  }

  function addGuestClaimTime(slotId: string, minutes: number, sourceFeedId?: string) {
    console.log("KRISTO_ADD_TIME_TOUCH", { slotId, minutes, sourceFeedId });

    const applyUpdate = (slots: any[]) => {
      const targetIndex = slots.findIndex((slot: any) => String(slot?.id || "") === String(slotId));
      if (targetIndex < 0) return slots;

      let previousEnd = "";

      return slots.map((slot: any, index: number) => {
        const current = { ...slot };

        if (index < targetIndex) {
          previousEnd = String(current.endTime || previousEnd || "");
          return current;
        }

        if (index === targetIndex) {
          const startTime = String(current.startTime || "");
          const currentDuration = Number(current.durationMin || 1);
          const nextDuration = Math.max(1, currentDuration + minutes);
          const endTime = startTime ? addMinutesToClock(startTime, nextDuration) : current.endTime;

          previousEnd = String(endTime || previousEnd || "");

          return {
            ...current,
            durationMin: nextDuration,
            endTime,
            timeLabel: startTime && endTime ? `${startTime} - ${endTime}` : current.timeLabel,
            manuallyModified: true,
          };
        }

        const duration = Number(current.durationMin || 1);
        const startTime = previousEnd || current.startTime;
        const endTime = startTime ? addMinutesToClock(startTime, duration) : current.endTime;

        previousEnd = String(endTime || previousEnd || "");

        return {
          ...current,
          startTime,
          endTime,
          timeLabel: startTime && endTime ? `${startTime} - ${endTime}` : current.timeLabel,
        };
      });
    };

    if (sourceFeedId) {
      feedUpdateScheduleSlots(sourceFeedId, applyUpdate);

      setHomeFeedItems((prev) =>
        prev.map((item: any) => {
          const id = String(item?.id || "");
          const sourceId = String(item?.sourceScheduleId || "");
          if (id !== String(sourceFeedId) && sourceId !== String(sourceFeedId)) return item;

          const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
          return { ...item, scheduleSlots: applyUpdate(slots) };
        })
      );

      apiPost("/api/church/feed", {
        action: "update-schedule-slots",
        feedId: sourceFeedId,
        postId: sourceFeedId,
        slotId,
        minutes,
      }, {
        headers: getKristoHeaders({
          userId: session?.userId || "",
          role: (session?.role || "Member") as any,
          churchId: session?.churchId || "",
        }),
      })
        .then(() => runMediaScheduleSilentReload("update-duration", true))
        .catch((e) => console.log("KRISTO_SLOT_TIME_UPDATE_ERROR", e));

      return;
    }

    setGuestClaimSlots((prev) => applyUpdate(prev));
  }

  function removeGuestClaimant(slotId: string, sourceFeedId?: string) {
    if (sourceFeedId) {
      feedUnclaimSchedule(sourceFeedId, { slotId });
      void syncGuestScheduleSlotsToBackend(sourceFeedId, "remove-guest");
      return;
    }

    updateGuestClaimSlot(slotId, {
      claimedBy: "Open",
      avatarUri: "",
      status: "Open",
      approved: false,
      locked: false,
    });
  }

  function approveGuestClaim(slotId: string, sourceFeedId?: string) {
    const slot = syncedGuestClaimSlots.find((x: any) => x.id === slotId);
    if (!slot || slot.status !== "Claimed") return;

    const patch = {
      status: "claimed",
      approved: true,
      locked: true,
      approvedAt: new Date().toISOString(),
    };

    if (sourceFeedId) {
      feedUpdateScheduleSlot(sourceFeedId, { slotId, patch });
      void syncGuestScheduleSlotsToBackend(sourceFeedId, "approve-guest");
      return;
    }

    updateGuestClaimSlot(slotId, {
      status: "Claimed",
      approved: true,
      locked: true,
      approvedAt: patch.approvedAt,
    });
  }

  function rejectGuestClaim(slotId: string, sourceFeedId?: string) {
    if (sourceFeedId) {
      feedUnclaimSchedule(sourceFeedId, { slotId });
      void syncGuestScheduleSlotsToBackend(sourceFeedId, "reject-guest");
      return;
    }

    updateGuestClaimSlot(slotId, {
      claimedBy: "Open",
      avatarUri: "",
      status: "Open",
      approved: false,
      locked: false,
    });
  }

  function toggleGuestClaimLock(slotId: string, locked: boolean, sourceFeedId?: string) {
    const patch = { locked, approved: locked ? false : false };

    if (sourceFeedId) {
      feedUpdateScheduleSlot(sourceFeedId, { slotId, patch });
      void syncGuestScheduleSlotsToBackend(sourceFeedId, "toggle-guest-lock");
      return;
    }

    updateGuestClaimSlot(slotId, patch);
  }

  function parseGuestSlotDate(slot: any) {
    const rawDate = String(slot?.meetingDate || slot?.meetingDay || "").trim();
    const rawStart = String(slot?.startTime || "").trim();
    const rawEnd = String(slot?.endTime || "").trim();

    function normalizeDate(value: string) {
      const cleaned = value
        .replace(/TODAY/gi, new Date().toDateString())
        .replace(/TOMORROW/gi, new Date(Date.now() + 24 * 60 * 60 * 1000).toDateString())
        .replace(/[•]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const parsed = new Date(cleaned);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }

      return null;
    }

    function parseClock(value: string) {
      const m = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
      if (!m) return null;

      let hour = Number(m[1] || 0);
      const minute = Number(m[2] || 0);
      const meridiem = String(m[3] || "").toUpperCase();

      if (meridiem === "PM" && hour < 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;

      return { hour, minute };
    }

    function makeMs(dateText: string, timeText: string) {
      const date = normalizeDate(dateText);
      const clock = parseClock(timeText);
      if (!date || !clock) return 0;

      date.setHours(clock.hour, clock.minute, 0, 0);
      return date.getTime();
    }

    const startMs = rawDate && rawStart ? makeMs(rawDate, rawStart) : 0;
    let endMs = rawDate && rawEnd ? makeMs(rawDate, rawEnd) : 0;

    if (startMs && !endMs && slot?.durationMin) {
      endMs = startMs + Number(slot.durationMin || 0) * 60000;
    }

    if (startMs && endMs && endMs < startMs) {
      endMs += 24 * 60 * 60 * 1000;
    }

    return { startMs, endMs };
  }

  function formatGuestSlotDate(slot: any) {
    const { startMs } = parseGuestSlotDate(slot);
    if (!startMs) return String(slot?.meetingDay || "Today").toUpperCase();

    return new Date(startMs).toLocaleDateString(undefined, {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }).toUpperCase();
  }

  function formatGuestSlotCountdown(slot: any) {
    const { startMs, endMs } = parseGuestSlotDate(slot);
    if (!startMs) return "Waiting for real time";

    const now = guestClockNow;
    const minsToStart = Math.ceil((startMs - now) / 60000);
    const minsToEnd = endMs ? Math.ceil((endMs - now) / 60000) : null;

    if (endMs && now > endMs) return "Ended";
    if (now >= startMs && (!endMs || now <= endMs)) return minsToEnd ? `LIVE NOW • ${Math.max(0, minsToEnd)}m left` : "LIVE NOW";
    if (minsToStart <= 0) return "Starting now";
    if (minsToStart < 60) return `Starts in ${minsToStart}m`;

    const hours = Math.floor(minsToStart / 60);
    const minutes = minsToStart % 60;
    return minutes ? `Starts in ${hours}h ${minutes}m` : `Starts in ${hours}h`;
  }

  function getGuestSlotTimeState(slot: any) {
    const label = formatGuestSlotCountdown(slot);
    if (label.startsWith("LIVE NOW")) return "live";
    if (label === "Ended") return "ended";
    if (label.includes("Starts in")) return "upcoming";
    return "idle";
  }

  function getGuestSlotConflict(slot: any, index: number, slots: any[]) {
    const current = parseGuestSlotDate(slot);
    if (!current.startMs || !current.endMs) return "";

    if (current.endMs <= current.startMs) {
      return "Invalid time";
    }

    const prev = index > 0 ? parseGuestSlotDate(slots[index - 1]) : null;
    const next = index < slots.length - 1 ? parseGuestSlotDate(slots[index + 1]) : null;

    if (prev?.endMs && current.startMs < prev.endMs) {
      return "Overlaps previous slot";
    }

    if (next?.startMs && current.endMs > next.startMs) {
      return "Overlaps next slot";
    }

    return "";
  }

  function fixGuestSlotConflict(slotId: string, sourceFeedId?: string) {
    const applyFix = (rows: any[]) => {
      let previousEnd = "";

      return rows.map((slot: any, index: number) => {
        const current = { ...slot };
        const duration = Number(current.durationMin || getMinutesBetween(current.startTime, current.endTime) || 1);

        if (index === 0) {
          const startTime = String(current.startTime || "");
          const endTime = startTime ? addMinutesToClock(startTime, duration) : current.endTime;
          previousEnd = String(endTime || "");
          return { ...current, startTime, endTime, timeLabel: startTime && endTime ? `${startTime} - ${endTime}` : current.timeLabel };
        }

        current.startTime = previousEnd || current.startTime;
        current.endTime = addMinutesToClock(current.startTime, duration);
        current.timeLabel = `${current.startTime} - ${current.endTime}`;
        previousEnd = current.endTime;
        return current;
      });
    };

    if (sourceFeedId) {
      feedUpdateScheduleSlots(sourceFeedId, applyFix);
      return;
    }

    setGuestClaimSlots((prev) => applyFix(prev));
  }

  function moveGuestSlot(slotId: string, direction: "up" | "down", sourceFeedId?: string) {
    const allFeedRows = [
      ...(Array.isArray(homeFeedItems) ? homeFeedItems : []),
      ...(Array.isArray(backendFeedItems) ? backendFeedItems : []),
    ];

    const feedItem = sourceFeedId
      ? allFeedRows.find((item: any) => {
          const id = String(item?.id || "");
          const sourceId = String(item?.sourceScheduleId || "");
          return id === String(sourceFeedId) || sourceId === String(sourceFeedId);
        })
      : null;

    const sourceRows = sourceFeedId
      ? (Array.isArray((feedItem as any)?.scheduleSlots) ? (feedItem as any).scheduleSlots : [])
      : guestClaimSlots;

    const applyMove = (rows: any[]) => {
      const items = [...rows];
      const from = items.findIndex((x: any) => String(x?.id || "") === String(slotId));
      if (from < 0) return rows;

      const to = direction === "up" ? from - 1 : from + 1;
      if (to < 0 || to >= items.length) return rows;

      const pickedRaw = items[from];

      // If a live slot is moved after time has already passed,
      // keep only the remaining minutes instead of restarting full duration.
      const pickedTime = parseGuestSlotDate(pickedRaw);
      const pickedStartMs = Number(pickedTime?.startMs || 0);
      const originalDurationMin = Math.max(
        1,
        Number(pickedRaw?.durationMin || getMinutesBetween(pickedRaw?.startTime, pickedRaw?.endTime) || 1)
      );

      const elapsedMin =
        pickedStartMs && Date.now() > pickedStartMs
          ? Math.floor((Date.now() - pickedStartMs) / 60000)
          : 0;

      const remainingDurationMin = Math.max(1, originalDurationMin - elapsedMin);

      const picked = {
        ...pickedRaw,
        durationMin: remainingDurationMin,
      };

      items[from] = items[to];
      items[to] = picked;

      let previousEnd = "";

      return items.map((slot: any, index: number) => {
        const current = { ...slot };
        const duration = Number(current.durationMin || getMinutesBetween(current.startTime, current.endTime) || 1);

        const startTime =
          index === 0
            ? new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
            : previousEnd || current.startTime;

        const endTime = addMinutesToClock(startTime, duration);
        previousEnd = String(endTime || "");

        return {
          ...current,
          order: index + 1,
          slot: index + 1,
          slotNumber: index + 1,
          startTime,
          endTime,
          timeLabel: `${startTime} - ${endTime}`,
          manuallyModified: true,
          sourceFeedId: sourceFeedId || current.sourceFeedId || "",
        };
      });
    };

    const movedSlots = applyMove(sourceRows);

    console.log("KRISTO_MOVE_SLOT_TOUCH", {
      slotId,
      direction,
      sourceFeedId,
      sourceCount: sourceRows.length,
      movedCount: movedSlots.length,
    });

    if (!movedSlots.length) return;

    if (sourceFeedId) {
      feedUpdateScheduleSlots(sourceFeedId, () => movedSlots);

      const applyMovedSlotsToFeed = (prev: any[]) =>
        prev.map((item: any) => {
          const id = String(item?.id || "");
          const sourceId = String(item?.sourceScheduleId || "");
          return id === String(sourceFeedId) || sourceId === String(sourceFeedId)
            ? { ...item, scheduleSlots: movedSlots }
            : item;
        });

      setHomeFeedItems(applyMovedSlotsToFeed);
      setBackendFeedItems(applyMovedSlotsToFeed);

      apiPost("/api/church/feed", {
        action: "update-schedule-slots",
        feedId: sourceFeedId,
        postId: sourceFeedId,
        slots: movedSlots,
      }, {
        headers: getKristoHeaders({
          userId: session?.userId || "",
          role: (session?.role || "Member") as any,
          churchId: session?.churchId || "",
        }),
      })
        .then(() => runMediaScheduleSilentReload("move-slot", true))
        .catch((e) => console.log("KRISTO_MOVE_SLOT_BACKEND_ERROR", e));

      return;
    }

    setGuestClaimSlots(() => movedSlots);
  }

  function getGuestSlotUiState(slot: any) {
    const status = String(slot?.status || "").toLowerCase().trim();

    const rawClaimedBy =
      typeof slot?.claimedBy === "string"
        ? String(slot.claimedBy).trim()
        : "";

    const claimedByObj =
      typeof slot?.claimedBy === "object" && slot?.claimedBy
        ? slot.claimedBy
        : null;

    const claimedName = String(
      slot?.claimedByName ||
      claimedByObj?.name ||
      (rawClaimedBy.toLowerCase() === "open" ? "" : rawClaimedBy) ||
      ""
    ).trim();

    const claimedUserId = String(
      slot?.claimedByUserId ||
      claimedByObj?.userId ||
      ""
    ).trim();

    const hasClaimant =
      status === "claimed" ||
      status === "taken" ||
      !!claimedName ||
      !!claimedUserId;

    if (slot?.approved) return "approved";
    if (slot?.locked && !hasClaimant) return "locked";
    if (hasClaimant) return "claimed";
    return "open";
  }

  function getGuestSlotBadgeLabel(slot: any) {
    const state = getGuestSlotUiState(slot);
    if (state === "approved") return "Approved";
    if (state === "locked") return "Locked";
    if (state === "claimed") return "Claimed";
    return "Open";
  }

  function messageGuestClaimant(slot: any) {
    const name = String(slot?.claimedBy || "Open").trim();
    if (!name || name === "Open") {
      Alert.alert("Message guest", "No guest has claimed this slot yet.");
      return;
    }

    const roomId = `guest-claim-${String(slot?.id || "slot")}`;
    router.push({
      pathname: "/more/my-church-room/messages/[id]",
      params: {
        id: roomId,
        assignmentTitle: `Guest Claim • ${String(slot?.title || "Live Slot")}`,
        assignmentSubtitle: name,
        assignmentRole: "MEDIA_GUEST",
        assignmentStatus: slot?.approved ? "approved" : "claimed",
        assignmentInitials: name.slice(0, 1).toUpperCase(),
        roomKind: "media-guest",
        source: "media",
        backTo: "/more/media",
        guestName: name,
        guestAvatarUri: String(slot?.avatarUri || ""),
        slotId: String(slot?.id || ""),
        sourceFeedId: String(slot?.sourceFeedId || ""),
      },
    } as any);
  }

  function enterBackendLiveAsViewer() {
    if (!activeBackendLive?.liveId) return;

    router.push({
      pathname: "/more/my-church-room/messages/live-room",
      params: {
        source: "media",
        liveMode: "instant",
        layout: "focus",
        role: isActualChurchPastor ? "host" : "Viewer",
        mode: isActualChurchPastor ? "host" : "viewer",
        entryMode: "live",
        room: "media",
        liveId: String(activeBackendLive.liveId || ""),
        pastorUserId: String(activeBackendLive.pastorUserId || ""),
        mediaName: String(activeBackendLive.mediaName || churchMediaProfile?.mediaName || "Church Live"),
        title: String(activeBackendLive.title || activeBackendLive.mediaName || "Pastor is LIVE"),
      },
    } as any);
  }

  function handlePostVideo() {
    handleLockedAction("video");
  }

  function handleGoLive() {
    setV2VipOpen(true);
    return;

    if (subscriptionLocked) {
      showSubscriptionRequired("live");
      return;
    }

    if (activeMediaLiveSlot) {
      router.push({
        pathname: "/more/my-church-room/messages/live-room",
        params: {
          source: "media",
          liveMode: "instant",
          layout: "focus",
          role: canUseMediaTools ? "host" : "Viewer",
          mode: canUseMediaTools ? "host" : "viewer",
          entryMode: "live",
          room: "media",
          mediaName:
            form.mediaName.trim() ||
            churchMediaProfile?.mediaName ||
            "Church Media",
          liveId: String(
            activeMediaLiveSlot?.sourceFeedId ||
            activeMediaLiveSlot?.id ||
            "media-live"
          ),
          title: String(
            activeMediaLiveSlot?.title ||
            "Church Live"
          ),
        },
      } as any);

      return;
    }

    handleLockedAction("live");
  }

  return (
    <ImageBackground
      source={MEDIA_STUDIO_BACKGROUND}
      style={s.fullScreenBg}
      imageStyle={[s.fullScreenBgImage, !isEditingMedia && hasMediaAccount ? s.fullScreenBgImageHidden : null]}
      resizeMode="cover"
    >
      <View pointerEvents="none" style={s.fullScreenOverlay} />
      <View pointerEvents="none" style={s.glowTop} />
      <View pointerEvents="none" style={s.glowBottom} />

      {vipNotice ? (
        <View style={s.vipNoticeOverlay}>
          <Pressable style={s.vipNoticeScrim} onPress={() => setVipNotice(null)} />
          <View style={s.vipNoticeCard}>
            <View style={s.vipNoticeGlow} />
            <View style={s.vipNoticeTopLine} />
            <View style={s.vipNoticeIconRing}>
              <Ionicons name="diamond-outline" size={27} color="#8DB5FF" />
            </View>
            <Text style={s.vipNoticeTitle}>{vipNotice.title}</Text>
            <Text style={s.vipNoticeText}>{vipNotice.message}</Text>
            <Pressable onPress={() => setVipNotice(null)} style={s.vipNoticeBtn}>
              <Text style={s.vipNoticeBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal
        visible={subscriptionPromptOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSubscriptionSchedulePrompt}
      >
        <View style={s.subPromptOverlay}>
          <Pressable style={s.subPromptBackdrop} onPress={closeSubscriptionSchedulePrompt} />
          <Animated.View
            style={[
              s.subPromptCard,
              {
                opacity: subPromptFade,
                transform: [{ translateY: subPromptLift }, { scale: subPromptScale }],
              },
            ]}
          >
            <LinearGradient
              colors={["#0C1829", "#07111F", "#050B14"]}
              locations={[0, 0.52, 1]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={s.subPromptGoldGlow} />
            <View style={s.subPromptGoldGlowSoft} />
            <View style={s.subPromptGoldGlowCenter} />
            <View style={s.subPromptTopShine} />
            <View style={s.subPromptInnerHighlight} />

            <View style={s.subPromptIconStack}>
              <LinearGradient
                colors={["rgba(240,214,147,0.22)", "rgba(217,181,109,0.10)", "rgba(196,154,69,0.06)"]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={s.subPromptIconRing}
              >
                <Ionicons name="diamond-outline" size={25} color="#F0D693" />
              </LinearGradient>
              <LinearGradient
                colors={["#F0D693", "#D9B56D", "#B8893F"]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.85, y: 1 }}
                style={s.subPromptLockBadge}
              >
                <Ionicons name="lock-closed" size={11} color="#07111F" />
              </LinearGradient>
            </View>

            <Text style={s.subPromptKicker}>KRISTO PREMIUM</Text>
            <Text style={s.subPromptTitle} numberOfLines={2}>
              Premium subscription required
            </Text>
            <View style={s.subPromptMessageWrap}>
              <Text style={s.subPromptMessage}>{CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE}</Text>
            </View>

            <View style={s.subPromptPillRow}>
              <View style={[s.subPromptPill, s.subPromptPillLive]}>
                <Ionicons name="calendar-outline" size={12} color="#34D399" />
                <Text style={[s.subPromptPillText, s.subPromptPillTextLive]}>Live</Text>
              </View>
              <View style={[s.subPromptPill, s.subPromptPillMedia]}>
                <Ionicons name="videocam-outline" size={12} color="#5B8DEF" />
                <Text style={[s.subPromptPillText, s.subPromptPillTextMedia]}>Media</Text>
              </View>
              <View style={[s.subPromptPill, s.subPromptPillMinistry]}>
                <Ionicons name="people-outline" size={12} color="#E8C872" />
                <Text style={[s.subPromptPillText, s.subPromptPillTextMinistry]}>Ministry</Text>
              </View>
            </View>

            <View style={s.subPromptBtnRow}>
              <Pressable
                onPress={closeSubscriptionSchedulePrompt}
                style={({ pressed }) => [s.subPromptSecondaryBtn, pressed ? s.pressed : null]}
              >
                <Text style={s.subPromptSecondaryText}>Not now</Text>
              </Pressable>
              <Pressable
                onPress={handleSubscriptionPromptPrimary}
                style={({ pressed }) => [s.subPromptPrimaryBtn, pressed ? s.pressed : null]}
              >
                <LinearGradient
                  colors={["#F3DEA8", "#D9B56D", "#B8893F"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.subPromptPrimaryGradient}
                />
                <Ionicons name="sparkles-outline" size={16} color="#07111F" />
                <Text style={s.subPromptPrimaryText}>View subscription</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>

      <ScrollView
        ref={scrollRef}
        scrollEnabled={isEditingMedia || !hasMediaAccount || isCreatingVideoPost || isCreatingSchedule || isManagingGuests}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: hasMediaAccount ? insets.top + 6 : 20,
          paddingBottom: insets.bottom + 360,
          flexGrow: 1,
        }}
      >
        {hasMediaAccount ? (
        <View style={[s.headerRow, !hasMediaAccount ? s.headerRowCreateHidden : null]}>
          {hasMediaAccount ? (
            <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed ? s.pressed : null]}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          ) : (
            <View style={s.backBtnGhost} />
          )}

          {hasMediaAccount && !isEditingMedia ? (
            <Pressable
              onPress={() => Alert.alert("Media ID", "MD-102948")}
              style={({ pressed }) => [s.headerMediaIdPill, pressed ? s.pressed : null]}
            >
              <Ionicons name="copy-outline" size={14} color="#F4C95D" />
              <Text style={s.headerMediaIdText}>MD-102948</Text>
            </Pressable>
          ) : (
            <View style={s.headerMediaIdSpacer} />
          )}

          {hasMediaAccount && !isEditingMedia ? (
            <Pressable
              onPress={() => setIsEditingMedia(true)}
              style={({ pressed }) => [s.settingsBtn, pressed ? s.pressed : null]}
            >
              <Ionicons name="settings-outline" size={21} color="#F4C95D" />
            </Pressable>
          ) : (
            <View style={s.headerSideSpacer} />
          )}
        </View>
        ) : null}


        <View style={[s.card, !isEditingMedia && hasMediaAccount ? s.cardDashboard : null, !hasMediaAccount ? s.cardCreateLift : null]}>
          {!isEditingMedia && hasMediaAccount && isCreatingVideoPost ? (
            <>
              <View style={s.scheduleFormCard}>
                {videoPreparing ? (
                  <View style={s.videoSmartLoadingCard}>
                    <View style={s.videoSmartLoadingTop}>
                      <ActivityIndicator size="small" color="#F4C95D" />
                      <Text style={s.videoSmartLoadingTitle}>Preparing video</Text>
                      <Text style={s.videoSmartLoadingPercent}>{videoPreparePercent}%</Text>
                    </View>

                    <View style={s.videoSmartProgressTrack}>
                      <View style={[s.videoSmartProgressFill, { width: `${videoPreparePercent}%` }]} />
                    </View>

                    <Text style={s.videoSmartLoadingText}>
                      You can write title and caption while Kristo prepares this video for preview.
                    </Text>
                  </View>
                ) : videoPostUploading ? (
                  <View style={s.videoSmartLoadingCard}>
                    <View style={s.videoSmartLoadingTop}>
                      <ActivityIndicator size="small" color="#F4C95D" />
                      <Text style={s.videoSmartLoadingTitle}>
                        {videoPostUploadStatus === "processing" || videoPostUploadStatus === "done"
                          ? "Processing…"
                          : "Uploading video"}
                      </Text>
                      <Text style={s.videoSmartLoadingPercent}>
                        {videoPostUploadStatus === "processing" || videoPostUploadStatus === "done"
                          ? ""
                          : `${videoPostUploadPercent}%`}
                      </Text>
                    </View>

                    <View style={s.videoSmartProgressTrack}>
                      <View
                        style={[
                          s.videoSmartProgressFill,
                          {
                            width:
                              videoPostUploadStatus === "processing" || videoPostUploadStatus === "done"
                                ? "100%"
                                : `${videoPostUploadPercent}%`,
                          },
                        ]}
                      />
                    </View>

                    <Text style={s.videoSmartLoadingText}>
                      {videoPostUploadStatus === "processing" || videoPostUploadStatus === "done"
                        ? "Publishing to Media Storage and preparing your Home Feed post."
                        : "Keep Kristo open while your sermon uploads directly to video storage."}
                    </Text>
                  </View>
                ) : videoPostUri ? (
                  <MediaPostVideoPreview uri={videoPostUri} onChange={pickMediaVideoForPost} />
                ) : null}

                {!videoPostUri ? (
                  <Pressable onPress={pickMediaVideoForPost} style={({ pressed }) => [s.videoChangeBtn, pressed ? s.pressed : null]}>
                    <Ionicons name="swap-horizontal-outline" size={16} color="#F4C95D" />
                    <Text style={s.videoChangeBtnText}>Choose Video</Text>
                  </Pressable>
                ) : null}

                {videoPostDetailsOpen ? (
                  <View style={s.videoDetailsCard}>
                    <Text style={s.fieldLabel}>TITLE</Text>
                    <View style={s.inputWrap as any}>
                      <TextInput
                        value={videoPostTitle}
                        onChangeText={setVideoPostTitle}
                        maxLength={15}
                        placeholder="Title 7-15 letters..."
                        placeholderTextColor="rgba(255,255,255,0.42)"
                        style={s.inputPremium as any}
                      />
                      <Ionicons name="videocam-outline" size={18} color="#A78BFA" />
                    </View>

                    <Text style={s.fieldLabel}>CAPTION</Text>
                    <View style={[s.inputWrap as any, s.scheduleTextArea]}>
                      <TextInput
                        value={videoPostCaption}
                        onChangeText={setVideoPostCaption}
                        maxLength={30}
                        placeholder="Caption 10-30 letters..."
                        placeholderTextColor="rgba(255,255,255,0.42)"
                        style={[s.inputPremium as any, s.scheduleTextAreaInput]}
                        multiline
                      />
                      <Ionicons name="create-outline" size={18} color="#F4C95D" />
                    </View>
                  </View>
                ) : null}
              </View>

              <Pressable
                disabled={videoPreparing || videoPostUploading || (videoPostDetailsOpen && !videoPostReadyToPublish)}
                onPress={() => {
                  if (!videoPostDetailsOpen) {
                    setVideoPostDetailsOpen(true);
                    setPendingDetailsScroll(true);

                    return;
                  }

                  publishVideoPostToFeed();
                }}
                style={({ pressed }) => [
                  s.nextBtnPremium as any,
                  s.videoPostFloatingCta as any,
                  { bottom: videoPostDetailsOpen ? insets.bottom - 62 : insets.bottom - 42 },
                  (videoPreparing || videoPostUploading || (videoPostDetailsOpen && !videoPostReadyToPublish)) ? { opacity: 0.42 } : null,
                  pressed ? s.pressed : null,
                ]}
              >
                {videoPostUploading ? (
                  <>
                    <Text style={s.nextBtnPremiumText as any}>
                      {videoPostUploadStatus === "processing" || videoPostUploadStatus === "done"
                        ? "Processing…"
                        : `Uploading ${videoPostUploadPercent}%`}
                    </Text>
                    <ActivityIndicator color="#07111F" />
                  </>
                ) : (
                  <>
                    <Text style={s.nextBtnPremiumText as any}>{videoPostDetailsOpen ? "Post to Home Feed" : "Add Title & Caption"}</Text>
                    <Ionicons name="paper-plane-outline" size={24} color="#07111F" />
                  </>
                )}
              </Pressable>
            </>
          ) : !isEditingMedia && hasMediaAccount && isCreatingSchedule ? (
            <>
              <View style={s.scheduleCreatorHero}>
                <Pressable onPress={() => setIsCreatingSchedule(false)} style={s.scheduleBackBtn}>
                  <Ionicons name="chevron-back" size={22} color="#F4C95D" />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroKicker}>Create schedule</Text>
                  <Text style={s.heroTitle}>Live Time Cards</Text>
                  <Text style={s.heroText}>Create cards people can claim from Home feed.</Text>
                </View>
              </View>

              <View style={s.scheduleFormCard}>
                <Text style={s.fieldLabel}>CAPTION</Text>
                <View style={s.inputWrap as any}>
                  <TextInput
                    value={scheduleTitle}
                    onChangeText={setScheduleTitle}
                    placeholder="Write caption for this live card..."
                    placeholderTextColor="rgba(255,255,255,0.42)"
                    style={s.inputPremium as any}
                  />
                  <Ionicons name="calendar-outline" size={18} color="#34D399" />
                </View>

                <Text style={s.fieldLabel}>Live time</Text>
                <View style={s.inputWrap as any}>
                  <TextInput
                    value={scheduleTime}
                    onChangeText={setScheduleTime}
                    placeholder="Today • 7:00 PM"
                    placeholderTextColor="rgba(255,255,255,0.42)"
                    style={s.inputPremium as any}
                  />
                  <Ionicons name="time-outline" size={18} color="#F4C95D" />
                </View>

                <Text style={s.fieldLabel}>Claim cards</Text>
                <View style={[s.inputWrap as any, s.scheduleTextArea]}>
                  <TextInput
                    value={scheduleSlots}
                    onChangeText={setScheduleSlots}
                    placeholder="Prayer, Testimony, Support..."
                    placeholderTextColor="rgba(255,255,255,0.42)"
                    style={[s.inputPremium as any, s.scheduleTextAreaInput]}
                    multiline
                  />
                  <Ionicons name="hand-left-outline" size={18} color="#FDBA74" />
                </View>
              </View>

              <Pressable
                disabled={scheduleCreating}
                onPress={() => {
                  if (subscriptionLocked) {
                    openSubscriptionSchedulePrompt();
                    return;
                  }
                  void handleSendLiveScheduleToFeed();
                }}
                style={({ pressed }) => [
                  s.nextBtnPremium as any,
                  pressed ? s.pressed : null,
                  scheduleCreating || subscriptionLocked ? { opacity: 0.72 } : null,
                ]}
              >
                {scheduleCreating ? (
                  <ActivityIndicator color="#07111F" />
                ) : (
                  <>
                    <Text style={s.nextBtnPremiumText as any}>Send to Global Feed</Text>
                    <Ionicons name="paper-plane-outline" size={24} color="#07111F" />
                  </>
                )}
              </Pressable>
            </>
          ) : !isEditingMedia && hasMediaAccount && isManagingGuests ? (
            <>
              <View style={s.scheduleCreatorHero}>
                <Pressable onPress={() => setIsManagingGuests(false)} style={s.scheduleBackBtn}>
                  <Ionicons name="chevron-back" size={22} color="#F4C95D" />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroKicker}>Guests claim center</Text>
                  <Text style={s.heroTitle}>Guests</Text>
                  <Text style={s.heroText}>View claimed time cards, adjust time, remove guests, and keep your schedule clean.</Text>
                </View>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.guestClaimSummaryScroll}
                contentContainerStyle={s.guestClaimSummaryRow}
              >
                <Pressable style={s.guestClaimSummaryWideCard}>
                  <View style={s.guestMiniBlue}>
                    <Ionicons name="people-outline" size={14} color="#60A5FA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.guestWideTitle} numberOfLines={1}>MD List</Text>
                    <Text style={s.guestWideText} numberOfLines={1}>MD-000000</Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => setIsManagingGuests(true)}
                  style={s.guestClaimSummaryWideCard}
                >
                  <View style={s.guestMiniGold}>
                    <Ionicons name="chatbubble-outline" size={14} color="#F4C95D" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.guestWideTitle}>Messages</Text>
                    <Text style={s.guestWideText} numberOfLines={1}>Chat inbox</Text>
                  </View>
                </Pressable>

                <View style={s.guestClaimSummaryPill}>
                  <Text style={s.guestClaimSummaryValue}>{guestClaimTotalMinutes}</Text>
                  <Text style={s.guestClaimSummaryLabel}>Min</Text>
                </View>

                <View style={s.guestClaimSummaryPill}>
                  <Text style={s.guestClaimSummaryValue}>{guestClaimClaimedCount}</Text>
                  <Text style={s.guestClaimSummaryLabel}>Claimed</Text>
                </View>

                <View style={s.guestClaimSummaryPill}>
                  <Text style={s.guestClaimSummaryValue}>{guestClaimOpenCount}</Text>
                  <Text style={s.guestClaimSummaryLabel}>Open</Text>
                </View>

                <View style={[s.guestClaimSummaryPill, s.guestClaimSummaryInvitePill]}>
                  <Text style={s.guestClaimSummaryValue}>{guestInvitationCount}</Text>
                  <Text style={s.guestClaimSummaryLabel}>Invites</Text>
                </View>

                <Pressable
                  onPress={handleClearMediaSchedules}
                  style={[s.guestClaimSummaryPill, s.guestClaimDangerBtn]}
                >
                  <Text style={[s.guestClaimSummaryValue, { color: "#FCA5A5" }]}>DEL</Text>
                  <Text style={s.guestClaimSummaryLabel}>Old</Text>
                </Pressable>
              </ScrollView>

              {guestClaimConflictCount > 0 ? (
                <View style={s.guestClaimConflictBanner}>
                  <Ionicons name="warning-outline" size={18} color="#FCA5A5" />
                  <Text style={s.guestClaimConflictBannerText}>
                    {guestClaimConflictCount} time conflict{guestClaimConflictCount > 1 ? "s" : ""} detected
                  </Text>
                </View>
              ) : null}


              <ScrollView
                style={s.guestClaimList}
                contentContainerStyle={s.guestClaimListContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                scrollEnabled
              >
                {!syncedGuestClaimSlots.length ? (
                  <View style={s.guestClaimEmptyCard}>
                    <Ionicons name="calendar-outline" size={28} color="#F4C95D" />
                    <Text style={s.guestClaimEmptyTitle}>No guest claims yet</Text>
                    <Text style={s.guestClaimEmptyText}>Create a schedule first. When people claim your Home Feed time cards, they will appear here with name and avatar.</Text>
                  </View>
                ) : null}

                {syncedGuestClaimSlots.map((rawSlot: any, index: number) => {
                  const rawClaimedBy =
                    typeof rawSlot?.claimedBy === "string"
                      ? String(rawSlot.claimedBy).trim()
                      : "";

                  const normalizedClaimedBy =
                    rawClaimedBy.toLowerCase() === "open"
                      ? ""
                      : rawClaimedBy;

                  const rawClaimedByObj =
                    typeof rawSlot?.claimedBy === "object" && rawSlot?.claimedBy
                      ? rawSlot.claimedBy
                      : null;

                  const claimantName = String(
                    rawSlot?.claimedByName ||
                    rawClaimedByObj?.name ||
                    normalizedClaimedBy ||
                    ""
                  ).trim();

                  const rawClaimantAvatar = String(
                    rawSlot?.claimedByAvatar ||
                    rawClaimedByObj?.avatarUri ||
                    rawSlot?.avatarUri ||
                    ""
                  ).trim();

                  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
                  const claimantAvatar =
                    rawClaimantAvatar.startsWith("/uploads/")
                      ? `${apiBase}${rawClaimantAvatar}`
                      : rawClaimantAvatar;

                  const slotStatus = String(rawSlot?.status || "").toLowerCase().trim();
                  const hasClaimant =
                    slotStatus === "claimed" ||
                    slotStatus === "taken" ||
                    !!(claimantName && claimantName.toLowerCase() !== "open") ||
                    !!String(rawSlot?.claimedByUserId || rawClaimedByObj?.userId || "").trim();

                  const slot = {
                    ...rawSlot,
                    claimedBy: claimantName || (hasClaimant ? "Claimed" : "Open"),
                    avatarUri: claimantAvatar,
                    status: hasClaimant ? "claimed" : rawSlot.status,
                  };



                  return (
                  <View
                    key={slot.id}
                    pointerEvents="box-none"
                    style={[
                      s.guestClaimCard,
                      index % 6 === 0 ? s.guestClaimCardEmerald : null,
                      index % 6 === 1 ? s.guestClaimCardBlue : null,
                      index % 6 === 2 ? s.guestClaimCardViolet : null,
                      index % 6 === 3 ? s.guestClaimCardAmber : null,
                      index % 6 === 4 ? s.guestClaimCardPink : null,
                      index % 6 === 5 ? s.guestClaimCardCyan : null,
                    ]}
                  >
                    <View style={s.guestClaimTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.guestClaimLabel}>{formatGuestSlotDate(slot)}</Text>
                        <Text style={s.guestClaimTitle}>{slot.title}</Text>
                      </View>
                      <View
                        style={[
                          s.guestClaimStatus,
                          getGuestSlotUiState(slot) === "claimed" ? s.guestClaimStatusHot : null,
                          getGuestSlotUiState(slot) === "approved" ? s.guestClaimStatusApproved : null,
                          getGuestSlotUiState(slot) === "locked" ? s.guestClaimStatusLocked : null,
                        ]}
                      >
                        <Text style={s.guestClaimStatusText}>{getGuestSlotBadgeLabel(slot)}</Text>
                      </View>
                    </View>

                    <View style={[s.guestClaimPersonHero, getGuestSlotUiState(slot) === "claimed" || getGuestSlotUiState(slot) === "approved" ? s.guestClaimPersonHeroActive : null]}>
                      {slot.avatarUri ? (
                        <Image source={{ uri: slot.avatarUri }} style={s.guestClaimHeroAvatar} resizeMode="cover" />
                      ) : (
                        <View style={s.guestClaimHeroAvatarFallback}>
                          <Text style={s.guestClaimHeroAvatarText}>{String(slot.claimedBy || "O").slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <Text style={s.guestClaimPersonKicker}>
                          {getGuestSlotUiState(slot) === "open" ? "No claimant yet" : getGuestSlotUiState(slot) === "approved" ? "Approved guest" : "Claimed by"}
                        </Text>
                        <Text style={s.guestClaimPersonName} numberOfLines={1}>{slot.claimedBy}</Text>

                        {getGuestSlotUiState(slot) === "open" ? (
                          <View style={s.guestInviteBox}>
                            <TextInput
                              value={guestInviteDraftBySlot[String(slot.id)] || ""}
                              onChangeText={(text) =>
                                setGuestInviteDraftBySlot((prev) => ({
                                  ...prev,
                                  [String(slot.id)]: text.toUpperCase(),
                                }))
                              }
                              placeholder="Invite MD / MB number"
                              placeholderTextColor="rgba(255,255,255,0.38)"
                              autoCapitalize="characters"
                              style={s.guestInviteInput}
                            />

                            <Pressable
                              onPress={() => {
                                const code = String(guestInviteDraftBySlot[String(slot.id)] || "").trim().toUpperCase();
                                if (!code) return;
                                setGuestInvitedBySlot((prev) => ({
                                  ...prev,
                                  [String(slot.id)]: code,
                                }));
                              }}
                              style={s.guestInviteBtn}
                            >
                              <Text style={s.guestInviteBtnText}>Invite</Text>
                            </Pressable>
                          </View>
                        ) : null}

                        {guestInvitedBySlot[String(slot.id)] ? (
                          <Text style={s.guestInviteSentText}>
                            Invitation sent to {guestInvitedBySlot[String(slot.id)]}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={[
                      s.guestSlotInfoGlass,
                      index % 6 === 0 ? s.guestSlotInfoGlassEmerald : null,
                      index % 6 === 1 ? s.guestSlotInfoGlassBlue : null,
                      index % 6 === 2 ? s.guestSlotInfoGlassViolet : null,
                      index % 6 === 3 ? s.guestSlotInfoGlassAmber : null,
                      index % 6 === 4 ? s.guestSlotInfoGlassPink : null,
                      index % 6 === 5 ? s.guestSlotInfoGlassCyan : null,
                      getGuestSlotTimeState(slot) === "live" ? s.guestClaimCountdownLive : getGuestSlotTimeState(slot) === "ended" ? s.guestClaimCountdownEnded : null,
                    ]}>
                      <View style={s.guestSlotInfoItem}>
                        <Ionicons name="time-outline" size={14} color="#F4C95D" />
                        <Text style={s.guestSlotInfoText}>{slot.durationMin} min • {slot.startTime || "Start"} - {slot.endTime || "End"}</Text>
                      </View>

                      <View style={s.guestSlotInfoDot} />

                      <View style={s.guestSlotInfoItem}>
                        <Ionicons name={getGuestSlotTimeState(slot) === "live" ? "radio-outline" : "hourglass-outline"} size={14} color="#F4C95D" />
                        <Text style={s.guestSlotInfoText}>{formatGuestSlotCountdown(slot)}</Text>
                      </View>
                    </View>

                    {getGuestSlotConflict(slot, syncedGuestClaimSlots.findIndex((x: any) => x.id === slot.id), syncedGuestClaimSlots) ? (
                      <View style={s.guestClaimConflictRow}>
                        <Ionicons name="alert-circle-outline" size={16} color="#FCA5A5" />
                        <Text style={s.guestClaimConflictText}>
                          TIME CONFLICT • {getGuestSlotConflict(slot, syncedGuestClaimSlots.findIndex((x: any) => x.id === slot.id), syncedGuestClaimSlots)}
                        </Text>

                        <Pressable
                          onPress={() => fixGuestSlotConflict(slot.id, slot.sourceFeedId)}
                          style={s.guestClaimFixBtn}
                        >
                          <Text style={s.guestClaimFixBtnText}>FIX NOW</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    <View style={s.guestClaimInfoRow}>
                      <Ionicons name={slot.locked ? "lock-closed-outline" : "lock-open-outline"} size={15} color="#F4C95D" />
                      <Text style={s.guestClaimInfoText}>{slot.locked ? "Locked after approval" : "Editable slot"}</Text>
                    </View>

                    <View pointerEvents="box-none" style={s.guestClaimMoveRow}>
                      <Pressable
                        onPressIn={() => moveGuestSlot(slot.id, "up", slot.sourceFeedId)}
                        style={[s.guestClaimMiniBtn, s.guestClaimMoveUpBtn]}
                      >
                        <Text style={[s.guestClaimMiniBtnText, s.guestClaimMoveUpText]}>↑ Move Up</Text>
                      </Pressable>

                      <Pressable
                        onPressIn={() => moveGuestSlot(slot.id, "down", slot.sourceFeedId)}
                        style={[s.guestClaimMiniBtn, s.guestClaimMoveDownBtn]}
                      >
                        <Text style={[s.guestClaimMiniBtnText, s.guestClaimMoveDownText]}>↓ Move Down</Text>
                      </Pressable>
                    </View>

                    <View pointerEvents="box-none" style={s.guestClaimActions}>
                      <Pressable
  hitSlop={14}
  onPressIn={() => {
    console.log("KRISTO_PLUS_5_TOUCH", slot.id, slot.sourceFeedId);
    addGuestClaimTime(slot.id, 5, slot.sourceFeedId);
  }}
  style={s.guestClaimActionBtn}
>
                        <Text style={s.guestClaimActionText}>+5 min</Text>
                      </Pressable>

                      <Pressable
  hitSlop={14}
  onPressIn={() => {
    console.log("KRISTO_MINUS_5_TOUCH", slot.id, slot.sourceFeedId);
    addGuestClaimTime(slot.id, -5, slot.sourceFeedId);
  }}
  style={s.guestClaimActionBtn}
>
                        <Text style={s.guestClaimActionText}>-5 min</Text>
                      </Pressable>

                      <Pressable
                        disabled={getGuestSlotUiState(slot) === "open" || getGuestSlotUiState(slot) === "locked"}
                        onPress={() => messageGuestClaimant(slot)}
                        style={[
                          s.guestClaimActionBtn,
                          getGuestSlotUiState(slot) === "claimed" || getGuestSlotUiState(slot) === "approved" ? s.guestClaimMessageBtn : null,
                          getGuestSlotUiState(slot) === "open" || getGuestSlotUiState(slot) === "locked" ? s.guestClaimDisabledBtn : null,
                        ]}
                      >
                        <Text style={s.guestClaimActionText}>Message</Text>
                      </Pressable>
                    </View>

                    <View pointerEvents="box-none" style={s.guestClaimActions}>
                      <Animated.View style={getGuestSlotUiState(slot) === "claimed" ? { flex: 1, transform: [{ scale: claimActionScale }] } : { flex: 1 }}>
                        <Pressable
                          disabled={getGuestSlotUiState(slot) !== "claimed"}
                          onPress={() => approveGuestClaim(slot.id, slot.sourceFeedId)}
                          style={[
                            s.guestClaimActionBtn,
                            s.guestClaimApproveBtn,
                            getGuestSlotUiState(slot) === "approved" ? s.guestClaimApprovedBtn : null,
                            getGuestSlotUiState(slot) !== "claimed" ? s.guestClaimDisabledBtn : null,
                          ]}
                        >
                          <Text style={s.guestClaimActionText}>{getGuestSlotUiState(slot) === "approved" ? "Approved ✓" : "Approve"}</Text>
                        </Pressable>
                      </Animated.View>

                      <Pressable
                        onPress={() => toggleGuestClaimLock(slot.id, !slot.locked, slot.sourceFeedId)}
                        style={[
                          s.guestClaimActionBtn,
                          getGuestSlotUiState(slot) === "locked" ? s.guestClaimLockedBtn : null,
                        ]}
                      >
                        <Text style={s.guestClaimActionText}>
                          {slot.locked ? "Unlock Slot" : "Lock Slot"}
                        </Text>
                      </Pressable>

                      <Animated.View style={getGuestSlotUiState(slot) === "claimed" ? { flex: 1, transform: [{ scale: claimActionScale }] } : { flex: 1 }}>
                        <Pressable
                          disabled={getGuestSlotUiState(slot) === "open" || getGuestSlotUiState(slot) === "locked"}
                          onPress={() => (slot.status === "Claimed" || slot.approved ? rejectGuestClaim(slot.id, slot.sourceFeedId) : removeGuestClaimant(slot.id, slot.sourceFeedId))}
                          style={[
                            s.guestClaimActionBtn,
                            s.guestClaimDangerBtn,
                            getGuestSlotUiState(slot) === "open" || getGuestSlotUiState(slot) === "locked" ? s.guestClaimDisabledBtn : null,
                          ]}
                        >
                          <Text style={s.guestClaimActionText}>
                            {getGuestSlotUiState(slot) === "approved" ? "Remove Guest" : getGuestSlotUiState(slot) === "claimed" ? "Reject" : "Remove"}
                          </Text>
                        </Pressable>
                      </Animated.View>
                    </View>
                  </View>
                  );
                })}
              </ScrollView>
            </>
          ) : !isEditingMedia && hasMediaAccount ? (
            <>

              <View style={s.hero}>
                <View style={s.heroIcon}>
                  <Ionicons name="radio-outline" size={22} color="#F4C95D" />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={s.heroKicker}>Pastor Media Center</Text>
                  <Text style={s.heroTitle}>{churchMediaProfile?.mediaName || form.mediaName || "Media Studio"}</Text>
                  <Text style={s.heroText}>
                    Create live, schedule invitation slots, and manage up to 3 trusted hosts.
                  </Text>
                </View>

                <View style={[s.readyDot, churchMediaSubscriptionActive ? s.readyDotActive : null]} />
              </View>

              <View style={s.statusStrip}>
                <View style={s.statusMini}>
                  <Ionicons name="people-outline" size={14} color="#F4C95D" />
                  <Text style={s.statusMiniText}>Audience</Text>
                </View>
                <View style={s.statusMini}>
                  <Ionicons name={churchMediaSubscriptionActive ? "checkmark-circle" : "lock-closed-outline"} size={14} color="#F4C95D" />
                  <Text style={s.statusMiniText}>
                    {churchMediaSubscriptionActive
                      ? "Church subscription active"
                      : "Subscription required"}
                  </Text>
                </View>
              </View>

              {subscriptionLocked ? (
                <Pressable
                  onPress={handleSubscriptionOpen}
                  style={({ pressed }) => [s.subscriptionGateCard, pressed ? s.pressed : null]}
                >
                  <View style={s.subscriptionGateIcon}>
                    <Ionicons name="diamond-outline" size={18} color="#F4C95D" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.subscriptionGateTitle}>Premium subscription required</Text>
                    <Text style={s.subscriptionGateText}>{CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.72)" />
                </Pressable>
              ) : null}

              <ScrollView
                style={s.dashboardToolsScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={s.dashboardToolsContent}
              >
                <Modal
                visible={v2VipOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setV2VipOpen(false)}
              >
                <View style={s.v2VipOverlay}>
                  <Pressable style={s.v2VipBackdrop} onPress={() => setV2VipOpen(false)} />
                  <Animated.View style={[s.v2VipCard, { opacity: v2VipFade, transform: [{ translateY: v2VipLift }, { scale: v2VipScale }] }]}>
                    <View style={s.v2VipGlow} />

                    <View style={s.v2VipTopRow}>
                      <View style={s.v2VipIconRing}>
                        <Ionicons name="diamond-outline" size={30} color="#F4C95D" />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={s.v2VipKicker}>KRISTO V2 • VIP</Text>
                        <Text style={s.v2VipTitle}>Church Connect Live</Text>
                      </View>
                    </View>

                    <Text style={s.v2VipText}>
                      This feature will connect churches for joint meetings, conferences, and global prayer rooms.
                    </Text>

                    <View style={s.v2VipPillRow}>
                      <View style={s.v2VipPill}>
                        <Ionicons name="business-outline" size={15} color="#F4C95D" />
                        <Text style={s.v2VipPillText}>Multi-church</Text>
                      </View>

                      <View style={s.v2VipPill}>
                        <Ionicons name="radio-outline" size={15} color="#FB7185" />
                        <Text style={s.v2VipPillText}>Coming V2</Text>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => setV2VipOpen(false)}
                      style={({ pressed }) => [s.v2VipBtn, pressed ? s.pressed : null]}
                    >
                      <Text style={s.v2VipBtnText}>Got it</Text>
                      <Ionicons name="checkmark-circle-outline" size={20} color="#07111F" />
                    </Pressable>
                  </Animated.View>
                </View>
              </Modal>

              <View style={s.grid}>
                <Pressable
                  onPress={() => {
                    if (!canManageMediaHosts) {
                      Alert.alert(
                        "Pastor access required",
                        "Only the church Pastor can add or remove trusted media hosts."
                      );
                      return;
                    }
                    router.push("/more/media/select-hosts" as any);
                  }}
                  style={({ pressed }) => [s.smallCard, s.glassFollowers, pressed ? s.pressed : null]}
                >
                  <View style={s.cardAura} />
                  <View style={s.cardTopShine} />
                  <View style={[s.iconRing, s.ringFollowers]}>
                    <Ionicons name="person-add-outline" size={27} color="#7DD3FC" />
                  </View>
                  <Text style={s.smallTitle}>Trusted Hosts</Text>
                  <Text style={s.smallSub}>
                    {mediaHosts.length}/{MAX_CHURCH_MEDIA_HOSTS} max
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleSubscriptionOpen}
                  style={({ pressed }) => [
  s.smallCard,
  subscriptionLocked ? s.glassVipLocked : s.glassSubscription,
  pressed ? s.pressed : null
]}
                >
                  <View style={s.cardAura} />
                  <View style={s.cardTopShine} />
                  <View style={[s.iconRing, s.ringSubscription]}>
                    <Ionicons name="diamond-outline" size={25} color="#F4C95D" />
                  </View>
                  <Text style={s.smallTitle}>Premium</Text>
                  <Text style={s.smallSub}>{churchMediaSubscriptionActive ? "Active" : "Plans"}</Text>
                </Pressable>

                <Pressable
                  onPress={handlePostVideo}
                  style={({ pressed }) => [s.smallCard, s.glassPost, pressed ? s.pressed : null]}
                >
                  <View style={s.cardAura} />
                  <View style={s.cardTopShine} />
                  <View style={[s.iconRing, s.ringPost]}>
                    <Ionicons name="cloud-upload-outline" size={27} color="#A78BFA" />
                  </View>
                  <Text style={s.smallTitle}>Post</Text>
                  <Text style={s.smallSub}>Video</Text>
                  <Text style={s.cardHint}>{postVideoHint === "Ready" ? "Ready" : "Locked"}</Text>
                </Pressable>

                <Pressable
                  onPress={handleGoLive}
                  style={({ pressed }) => [s.smallCard, s.glassLive, pressed ? s.pressed : null]}
                >
                  <View style={s.cardAura} />
                  <View style={s.cardTopShine} />
                  <View style={[s.iconRing, s.ringLive]}>
                    <Ionicons name="radio-outline" size={28} color="#FB7185" />
                  </View>
                  <Text style={s.smallTitle}>Create</Text>
                  <Text style={s.smallSub}>
                    {activeMediaLiveSlot ? "V2 active" : "V2 soon"}
                  </Text>

                  <Text style={s.cardHint}>
                    {activeMediaLiveSlot ? "Join live" : "VIP V2"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleCreateLiveSchedule}
                  style={({ pressed }) => [
                    s.smallCard,
                    s.glassSchedule,
                    subscriptionLocked ? s.glassVipLocked : null,
                    pressed && !subscriptionLocked ? s.pressed : null,
                  ]}
                >
                  <View style={s.cardAura} />
                  <View style={s.cardTopShine} />
                  <View style={[s.iconRing, s.ringSchedule]}>
                    <Ionicons name="calendar-outline" size={27} color="#34D399" />
                  </View>
                  <Text style={s.smallTitle}>Slots</Text>
                  <Text style={s.cardHint}>
                    {subscriptionLocked ? "Locked" : "Ready"}
                  </Text>
                  <Text style={s.smallSub}>Invitations</Text>
                  <Text style={s.cardHint}>Schedule</Text>
                </Pressable>

                <Pressable
                  onPress={() => setIsManagingGuests(true)}
                  style={({ pressed }) => [s.smallCard, s.glassGuests, pressed ? s.pressed : null]}
                >
                  <View style={s.cardAura} />
                  <View style={s.cardTopShine} />
                  <View style={[s.iconRing, s.ringGuests]}>
                    <Ionicons name="people-outline" size={27} color="#FDBA74" />
                  </View>
                  <Text style={s.smallTitle}>Guests</Text>
                  <Text style={s.smallSub}>Claims</Text>
                  <Text style={s.cardHint}>View</Text>
                </Pressable>

                {canManageMediaStorage ? (
                  <Pressable
                    onPress={() => router.push("/more/media-storage" as any)}
                    style={({ pressed }) => [s.smallCard, s.glassStorageMedia, pressed ? s.pressed : null]}
                  >
                    <View style={s.cardAura} />
                    <View style={s.cardTopShine} />
                    <View style={[s.iconRing, s.ringStorageMedia]}>
                      <Ionicons name="albums-outline" size={27} color="#7DD3FC" />
                    </View>
                    <Text style={s.smallTitle}>Media</Text>
                    <Text style={s.smallSub}>Storage</Text>
                    <Text style={s.cardHint}>Manage posts</Text>
                  </Pressable>
                ) : null}

                {canManageChurchStorage ? (
                  <Pressable
                    onPress={() => router.push("/more/church-storage" as any)}
                    style={({ pressed }) => [s.smallCard, s.glassStorageChurch, pressed ? s.pressed : null]}
                  >
                    <View style={s.cardAura} />
                    <View style={s.cardTopShine} />
                    <View style={[s.iconRing, s.ringStorageChurch]}>
                      <Ionicons name="business-outline" size={27} color="#F4C95D" />
                    </View>
                    <Text style={s.smallTitle}>Church</Text>
                    <Text style={s.smallSub}>Storage</Text>
                    <Text style={s.cardHint}>Manage posts</Text>
                  </Pressable>
                ) : null}
                </View>
              </ScrollView>
            </>
          ) : showAccessLocked ? (
            <>
              <View style={s.hero}>
                <View style={s.heroIcon}>
                  <Ionicons name="lock-closed-outline" size={22} color="#F4C95D" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroKicker}>Church Media</Text>
                  <Text style={s.heroTitle}>Pastor access required</Text>
                  <Text style={s.heroText}>
                    Only the church Pastor and trusted media hosts can access Media Studio. Ask your pastor if you need access.
                  </Text>
                </View>
              </View>
            </>
          ) : showHostSetupPending ? (
            <>
              <View style={s.hero}>
                <View style={s.heroIcon}>
                  <Ionicons name="hourglass-outline" size={22} color="#F4C95D" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroKicker}>Church Media</Text>
                  <Text style={s.heroTitle}>Not set up yet</Text>
                  <Text style={s.heroText}>
                    Church Media not set up yet. Ask your pastor to create it.
                  </Text>
                </View>
              </View>
            </>
          ) : showCreateWizard && mediaStep === 1 ? (
            <>
              <Text style={s.fieldLabel}>Church Media name</Text>
              <View style={s.inputWrap as any}>
                <TextInput
                  value={form.mediaName}
                  onChangeText={(v) => setForm((p) => ({ ...p, mediaName: v }))}
                  placeholder="Enter your media name"
                  placeholderTextColor="rgba(255,255,255,0.42)"
                  style={s.inputPremium as any}
                />
                <Ionicons name="sparkles" size={18} color="#F4C95D" />
              </View>

              <Text style={s.fieldLabel}>I create as</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.categoryScrollContent}
              >
                <View style={s.categoryTwoRows}>
                  {CATEGORIES.map((item) => {
                    const active = form.category === item;
                    return (
                      <Pressable
                        key={item}
                        onPress={() => setForm((prev) => ({ ...prev, category: item }))}
                        style={({ pressed }) => [
                          s.categoryChip,
                          active ? s.categoryChipActive : null,
                          pressed ? s.pressed : null,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[s.categoryChipText, active ? s.categoryChipTextActive : null]}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>

      </ScrollView>

              <Text style={s.fieldLabel}>
                Sub-category <Text style={s.fieldLabelSoft}>(optional)</Text>
              </Text>
              <View style={s.inputWrap as any}>
                <TextInput
                  value={form.subCategory}
                  onChangeText={(v) => setForm((p) => ({ ...p, subCategory: v }))}
                  placeholder="e.g. Bible Teacher, Youth Pastor..."
                  placeholderTextColor="rgba(255,255,255,0.42)"
                  style={s.inputPremium as any}
                />
                <Ionicons name="sparkles" size={18} color="#F4C95D" />
              </View>

              <Pressable
                onPress={() => setMediaStep(2)}
                style={({ pressed }) => [s.nextBtnPremium as any, pressed ? s.pressed : null]}
              >
                <Text style={s.nextBtnPremiumText as any}>Next</Text>
                <Ionicons name="chevron-forward" size={24} color="#111" />
              </Pressable>
            </>
          ) : showCreateWizard && mediaStep === 2 ? (
            <>
              <Text style={s.fieldLabel}>Language</Text>
              <View style={s.inputWrap as any}>
                <TextInput
                  value={form.language}
                  onChangeText={(v) => setForm((p) => ({ ...p, language: v }))}
                  placeholder="e.g. English, Swahili, French"
                  placeholderTextColor="rgba(255,255,255,0.42)"
                  style={s.inputPremium as any}
                />
              </View>

              <Text style={s.fieldLabel}>Country</Text>
              <View style={s.inputWrap as any}>
                <TextInput
                  value={form.country}
                  onChangeText={(v) => setForm((p) => ({ ...p, country: v }))}
                  placeholder="Your main country"
                  placeholderTextColor="rgba(255,255,255,0.42)"
                  style={s.inputPremium as any}
                />
              </View>
<View style={s.stepDualRow}>
                <Pressable onPress={() => setMediaStep(1)} style={({ pressed }) => [s.backBtnPremium, pressed ? s.pressed : null]}>
                  <Text style={s.backBtnPremiumText}>Back</Text>
                </Pressable>

                <Pressable onPress={() => setMediaStep(3)} style={({ pressed }) => [s.nextBtnPremium as any, s.nextBtnHalf, pressed ? s.pressed : null]}>
                  <Text style={s.nextBtnPremiumText as any}>Next</Text>
                  <Ionicons name="chevron-forward" size={24} color="#111" />
                </Pressable>
              </View>
            </>
          ) : showCreateWizard ? (
            <>
              <Text style={s.fieldLabel}>Content style</Text>
              <View style={s.inputWrap as any}>
                <TextInput
                  value={form.contentStyle}
                  onChangeText={(v) => setForm((p) => ({ ...p, contentStyle: v }))}
                  placeholder="How do you usually present your content?"
                  placeholderTextColor="rgba(255,255,255,0.42)"
                  style={s.inputPremium as any}
                />
              </View>

              <Text style={s.fieldLabel}>Bio</Text>
              <View style={s.inputWrapTall as any}>
                <TextInput
                  value={form.bio}
                  onChangeText={(v) => setForm((p) => ({ ...p, bio: v }))}
                  placeholder="Short bio"
                  placeholderTextColor="rgba(255,255,255,0.42)"
                  style={s.inputPremiumTall as any}
                  multiline
                />
              </View>
<View style={s.stepDualRow}>
                <Pressable onPress={() => setMediaStep(2)} style={({ pressed }) => [s.backBtnPremium, pressed ? s.pressed : null]}>
                  <Text style={s.backBtnPremiumText}>Back</Text>
                </Pressable>

                <Pressable onPress={handleSaveMediaProfile} style={({ pressed }) => [s.nextBtnPremium as any, s.nextBtnHalf, pressed ? s.pressed : null]}>
                  <Text style={s.nextBtnPremiumText as any}>{hasMediaAccount ? "Update" : "Save"}</Text>
                  <Ionicons name="checkmark" size={22} color="#111" />
                </Pressable>
              </View>
            </>
          ) : null}
        </View>


      </ScrollView>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  v2VipOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 34,
    paddingTop: 110,
    backgroundColor: "rgba(1,8,22,0.74)",
  },
  v2VipBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  v2VipCard: {
    borderRadius: 30,
    padding: 20,
    overflow: "hidden",
    backgroundColor: "rgba(8,18,38,0.98)",
    borderWidth: 1.5,
    borderColor: "rgba(96,165,250,0.46)",
  },
  v2VipGlow: {
    position: "absolute",
    width: 230,
    height: 230,
    borderRadius: 150,
    right: -80,
    top: -90,
    backgroundColor: "rgba(59,130,246,0.22)",
  },
  v2VipTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 14,
  },
  v2VipIconRing: {
    width: 58,
    height: 52,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(96,165,250,0.16)",
    borderWidth: 2,
    borderColor: "rgba(125,211,252,0.60)",
  },
  v2VipKicker: {
    color: "#7DD3FC",
    fontWeight: "900",
    letterSpacing: 3.5,
    fontSize: 12,
  },
  v2VipTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 5,
  },
  v2VipText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
  },
  v2VipPillRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    marginBottom: 18,
  },
  v2VipPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  v2VipPillText: {
    color: "rgba(255,255,255,0.84)",
    fontWeight: "900",
    fontSize: 12,
  },
  v2VipBtn: {
    height: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
    backgroundColor: "#7DD3FC",
  },
  v2VipBtnText: {
    color: "#07111F",
    fontWeight: "900",
    fontSize: 18,
  },
  subPromptOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "rgba(1,8,22,0.82)",
  },
  subPromptBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  subPromptCard: {
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 21,
    paddingBottom: 18,
    overflow: "hidden",
    backgroundColor: "#07111F",
    borderWidth: 1.4,
    borderColor: "#D9B56D",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 24,
  },
  subPromptGoldGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    right: -95,
    top: -120,
    backgroundColor: "rgba(217,181,109,0.16)",
  },
  subPromptGoldGlowSoft: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    left: -75,
    bottom: -90,
    backgroundColor: "rgba(240,214,147,0.08)",
  },
  subPromptGoldGlowCenter: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    alignSelf: "center",
    top: 28,
    backgroundColor: "rgba(217,181,109,0.06)",
  },
  subPromptTopShine: {
    position: "absolute",
    left: 20,
    right: 20,
    top: 12,
    height: 1.2,
    borderRadius: 2,
    backgroundColor: "rgba(240,214,147,0.55)",
  },
  subPromptInnerHighlight: {
    position: "absolute",
    left: 1.4,
    right: 1.4,
    top: 1.4,
    bottom: 1.4,
    borderRadius: 28.6,
    borderWidth: 1,
    borderColor: "rgba(240,214,147,0.14)",
  },
  subPromptIconStack: {
    alignSelf: "center",
    marginBottom: 12,
  },
  subPromptIconRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.6,
    borderColor: "rgba(217,181,109,0.62)",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  subPromptLockBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#07111F",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  subPromptKicker: {
    color: "#F0D693",
    fontWeight: "800",
    letterSpacing: 3.4,
    fontSize: 11,
    textAlign: "center",
    marginBottom: 6,
    textShadowColor: "rgba(217,181,109,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  subPromptTitle: {
    color: "#FFFFFF",
    fontSize: 20.5,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.25,
    lineHeight: 25,
    marginBottom: 9,
  },
  subPromptMessageWrap: {
    alignSelf: "center",
    maxWidth: "88%",
    marginBottom: 14,
  },
  subPromptMessage: {
    color: "#D8DDE8",
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: "600",
    textAlign: "center",
  },
  subPromptPillRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 15,
  },
  subPromptPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
  },
  subPromptPillLive: {
    borderColor: "rgba(52,211,153,0.32)",
  },
  subPromptPillMedia: {
    borderColor: "rgba(91,141,239,0.32)",
  },
  subPromptPillMinistry: {
    borderColor: "rgba(232,200,114,0.32)",
  },
  subPromptPillText: {
    fontWeight: "700",
    fontSize: 12.5,
    letterSpacing: 0.2,
  },
  subPromptPillTextLive: {
    color: "#A7F3D0",
  },
  subPromptPillTextMedia: {
    color: "#BFDBFE",
  },
  subPromptPillTextMinistry: {
    color: "#F5E6B8",
  },
  subPromptBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  subPromptSecondaryBtn: {
    flex: 0.86,
    height: 47,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(192,198,210,0.28)",
  },
  subPromptSecondaryText: {
    color: "rgba(216,221,232,0.88)",
    fontWeight: "700",
    fontSize: 13.5,
  },
  subPromptPrimaryBtn: {
    flex: 1.16,
    height: 47,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    overflow: "hidden",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 12,
  },
  subPromptPrimaryGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  subPromptPrimaryText: {
    color: "#07111F",
    fontWeight: "800",
    fontSize: 13.5,
  },
  screen: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },

  fullScreenBg: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#0B0F17",
  },

  fullScreenBgImage: {
    width: "100%",
    height: "100%",
  },

  fullScreenBgImageHidden: {
    opacity: 0,
  },

  fullScreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.26)",
  },
  glowTop: {
    position: "absolute",
    top: -40,
    left: -30,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  glowBottom: {
    position: "absolute",
    right: -40,
    bottom: 90,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(255,90,150,0.04)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 36,
    marginTop: 0,
    marginBottom: 0,
    gap: 12,
    zIndex: 50,
  },
  backBtn: {
    width: 58,
    height: 52,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20,22,27,0.98)",
    borderWidth: 1.6,
    borderColor: "rgba(255,255,255,0.24)",
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 9 },
    elevation: 18,
  },

  settingsBtn: {
    width: 58,
    height: 52,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22,18,8,0.98)",
    borderWidth: 1.7,
    borderColor: "rgba(244,201,93,0.66)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.44,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 9 },
    elevation: 20,
  },
  vipNoticeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
  },
  vipNoticeScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,18,0.46)",
  },
  vipNoticeCard: {
    width: "100%",
    borderRadius: 34,
    padding: 22,
    overflow: "hidden",
    backgroundColor: "rgba(13,28,58,0.94)",
    borderWidth: 1.4,
    borderColor: "rgba(125,180,255,0.42)",
    shadowColor: "#5C8DFF",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 24,
  },
  vipNoticeGlow: {
    position: "absolute",
    right: -70,
    top: -76,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "rgba(91,141,255,0.16)",
  },
  subscriptionGateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 14,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: "rgba(13,28,58,0.88)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.42)",
  },
  subscriptionGateIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.35)",
  },
  subscriptionGateTitle: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
    marginBottom: 4,
  },
  subscriptionGateText: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  vipNoticeTopLine: {
    height: 1.2,
    borderRadius: 2,
    backgroundColor: "rgba(125,180,255,0.42)",
    marginBottom: 14,
  },
  vipNoticeIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
    backgroundColor: "rgba(91,141,255,0.13)",
    borderWidth: 1.7,
    borderColor: "rgba(125,180,255,0.52)",
  },
  vipNoticeTitle: {
    color: "#F7FAFF",
    fontSize: 23,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  vipNoticeText: {
    marginTop: 9,
    color: "rgba(225,235,255,0.74)",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  vipNoticeBtn: {
    marginTop: 20,
    height: 56,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5C8DFF",
  },
  vipNoticeBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },

  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
title: {
  color: "#fff",
  fontSize: 30,
  fontWeight: "800",
  letterSpacing: 0.2,
  lineHeight: 34,
},
sub: {
  marginTop: 0,
  color: "rgba(255,255,255,0.80)",
  fontSize: 12.5,
  fontWeight: "700",
  lineHeight: 18,
  maxWidth: 310,
},
  hero: {
    minHeight: 136,
    borderRadius: 32,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1.55,
    borderColor: "rgba(244,201,93,0.34)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.20,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 15 },
    elevation: 15,
  },
  heroIcon: {
    width: 66,
    height: 66,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1.8,
    borderColor: "rgba(244,201,93,0.46)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },

  heroKicker: {
    color: "rgba(244,201,93,0.90)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 3,
  },

  readyDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },

  readyDotActive: {
    backgroundColor: "#50DCB4",
    borderColor: "rgba(80,220,180,0.72)",
  },

  statusStrip: {
    marginTop: 8,
    minHeight: 56,
    borderRadius: 26,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(244,201,93,0.34)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  statusMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  statusMiniText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: -0.2,
    textShadowColor: "rgba(0,0,0,0.32)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },

  heroTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  heroText: {
    marginTop: 0,
    color: "rgba(255,255,255,0.70)",
    fontSize: 12.5,
    fontWeight: "700",
    lineHeight: 18,
  },
  statusCard: {
    marginTop: 6,
    marginHorizontal: 16,
    borderRadius: 22,
    padding: 12,
    backgroundColor: "rgba(15,22,38,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  sectionKicker: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  statusText: {
    marginTop: 4,
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  statusSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.68)",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
  },
  statusGrid: {
    marginTop: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusPill: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  okPill: {
    backgroundColor: "rgba(80,220,180,0.12)",
    borderColor: "rgba(80,220,180,0.28)",
  },
  pendingPill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  statusPillText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
card: {
  marginTop: 0,
  marginHorizontal: 16,
  marginBottom: 0,
  transform: [{ translateY: 120 }],
  borderRadius: 40,
  padding: 18,
  backgroundColor: "rgba(7,11,24,0.64)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.09)",
  shadowColor: "#000",
  shadowOpacity: 0.26,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 10 },
  elevation: 12,
},
  cardCreateLift: {
    marginTop: 175,
    marginHorizontal: 22,
    transform: [{ translateY: 0 }],
    borderRadius: 42,
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 28,
    backgroundColor: "rgba(5, 8, 16, 0.72)",
    borderWidth: 1.2,
    borderColor: "rgba(255, 220, 130, 0.34)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.38,
    shadowRadius: 38,
    shadowOffset: { width: 0, height: 20 },
    elevation: 26,
  },

  cardDashboard: {
    marginTop: -18,
    transform: [{ translateY: 0 }],
    paddingBottom: 0,
    backgroundColor: "rgba(7,11,24,0.86)",
    borderColor: "rgba(244,201,93,0.18)",
  },

  cardTitle: {
  color: "#fff",
  fontSize: 24,
  fontWeight: "800",
  letterSpacing: 0.2,
  lineHeight: 30,
},
  cardSub: {
  marginTop: 6,
  color: "rgba(255,255,255,0.78)",
  fontSize: 13,
  lineHeight: 19,
  fontWeight: "700",
},
  input: {
    marginTop: 10,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: "rgba(7,11,20,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  textarea: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  chipRow: {
    paddingTop: 10,
    gap: 8,
    paddingRight: 10,
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chipActive: {
    backgroundColor: "rgba(217,179,95,0.15)",
    borderColor: "rgba(217,179,95,0.28)",
  },
  chipText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "800",
  },
  chipTextActive: {
    color: "#fff",
  },
  stepRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  stepPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  stepPillActive: {
    backgroundColor: "rgba(217,179,95,0.16)",
    borderColor: "rgba(217,179,95,0.34)",
  },
  stepPillDone: {
    backgroundColor: "rgba(80,220,180,0.12)",
    borderColor: "rgba(80,220,180,0.24)",
  },
  stepPillText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "800",
  },
  stepPillTextActive: {
    color: "#fff",
  },
  primaryBtn: {
  flex: 1.15,
  minHeight: 64,
  borderRadius: 24,
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "row",
  gap: 10,
  backgroundColor: "#F4C95D",
  borderWidth: 1.4,
  borderColor: "rgba(255,239,180,1)",
  shadowColor: "#F4C95D",
  shadowOpacity: 0.42,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 12,
},
  secondaryBtn: {
  flex: 1,
  minHeight: 64,
  borderRadius: 24,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(255,255,255,0.05)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.10)",
},
  secondaryBtnText: {
  color: "#FFFFFF",
  fontSize: 15,
  fontWeight: "800",
},
  stepActions: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepPrimaryBtn: {
    flex: 1,
  },
  stepSpacer: {
    width: 96,
  },
  primaryBtnText: {
  color: "#111",
  fontSize: 15.5,
  fontWeight: "800",
  letterSpacing: 0.22,
},
  grid: {
    marginTop: 22,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    paddingBottom: 90,
  },
  smallCard: {
    width: "47.4%",
    minHeight: 164,
    borderRadius: 34,
    padding: 17,
    justifyContent: "space-between",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.065)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.22,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
    elevation: 16,
  },
  fullCard: {
    width: "100%",
  },
  smallTitle: {
    color: "#FFFFFF",
    fontSize: 23.5,
    lineHeight: 26,
    fontWeight: "800",
    letterSpacing: -1,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 9,
  },
  smallSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.68)",
    fontSize: 14.5,
    lineHeight: 18,
    fontWeight: "800",
  },
  cardHint: {
    marginTop: 8,
    color: "#7DD3FC",
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
    textShadowColor: "rgba(244,201,93,0.28)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  creatorHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },


  cardAura: {
    position: "absolute",
    width: 145,
    height: 145,
    borderRadius: 72.5,
    right: -46,
    top: -50,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  glassVipLocked: {
    backgroundColor: "rgba(22,40,72,0.92)",
    borderWidth: 1.6,
    borderColor: "rgba(96,165,250,0.55)",
    shadowColor: "#60A5FA",
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },

  cardTopShine: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 13,
    height: 1.4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  iconRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 2.2,
    backgroundColor: "rgba(255,255,255,0.09)",
  },

  creatorIconCore: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,16,30,0.88)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.24)",
  },

  creatorSparkle: {
    position: "absolute",
    top: 10,
    right: 10,
  },
  fieldLabel: {
  marginTop: 16,
  marginBottom: 8,
  color: "#FFFFFF",
  fontSize: 13,
  lineHeight: 26,
  fontWeight: "800",
  letterSpacing: -0.45,
  textShadowColor: "rgba(0,0,0,0.75)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 10,
},
  fieldLabelSoft: {
  color: "rgba(255,255,255,0.62)",
  fontSize: 14,
  fontWeight: "800",
},
  inputWrap: {
  minHeight: 52,
  borderRadius: 30,
  paddingHorizontal: 22,
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  backgroundColor: "rgba(12, 24, 46, 0.86)",
  borderWidth: 1.35,
  borderColor: "rgba(255,255,255,0.18)",
  shadowColor: "#82B7FF",
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 9,
},
  inputWrapTall: {
  minHeight: 108,
  borderRadius: 24,
  paddingHorizontal: 18,
  paddingVertical: 16,
  backgroundColor: "rgba(18,28,50,0.74)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.13)",
  shadowColor: "#000",
  shadowOpacity: 0.14,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
},
  inputPremium: {
  flex: 1,
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "700",
  paddingVertical: 0,
  letterSpacing: -0.25,
},
  inputPremiumTall: {
  flex: 1,
  minHeight: 80,
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "800",
  textAlignVertical: "top",
  paddingVertical: 0,
},
categoryGrid: {
    marginTop: 2,
  },
categoryChip: {
  height: 46,
  minWidth: 138,
  maxWidth: 190,
  borderRadius: 23,
  paddingHorizontal: 16,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(22, 39, 72, 0.82)",
  borderWidth: 1.2,
  borderColor: "rgba(255,255,255,0.12)",
  shadowColor: "#000",
  shadowOpacity: 0.18,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 6,
},
categoryChipActive: {
  backgroundColor: "rgba(244,201,93,0.22)",
  borderColor: "rgba(244,201,93,0.70)",
  shadowColor: "#F4C95D",
  shadowOpacity: 0.28,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 12,
},
categoryChipText: {
  color: "rgba(255,255,255,0.88)",
  fontSize: 13.5,
  fontWeight: "800",
},
categoryChipTextActive: {
  color: "#F4C95D",
},
  infoBox: {
    marginTop: 18,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.12)",
  },
  infoIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.45)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  infoText: {
    flex: 1,
    color: "rgba(255,255,255,0.76)",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
  },
nextBtnPremium: {
  marginTop: 24,
  minHeight: 66,
  borderRadius: 36,
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "row",
  gap: 15,
  backgroundColor: "#F8D15E",
  borderWidth: 2.2,
  borderColor: "rgba(255, 247, 196, 1)",
  shadowColor: "#F4C95D",
  shadowOpacity: 0.42,
  shadowRadius: 26,
  shadowOffset: { width: 0, height: 16 },
  elevation: 24,
},
  nextBtnHalf: {
    flex: 1,
    marginTop: 0,
  },
nextBtnPremiumText: {
  color: "#05070D",
  fontSize: 19,
  fontWeight: "800",
  letterSpacing: -0.4,
},
  backBtnPremium: {
    flex: 1,
    minHeight: 64,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.12)",
  },
  backBtnPremiumText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
  stepDualRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
categoryScrollContent: {
  paddingRight: 20,
},
categoryTwoRows: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 12,
  width: 980,
},

showcaseWrap: {
  height: 228,
  borderRadius: 34,
  overflow: "hidden",
  marginHorizontal: 16,
  marginTop: 8,
  borderWidth: 1.3,
  borderColor: "rgba(244,201,93,0.30)",
  backgroundColor: "rgba(255,255,255,0.04)",
  shadowColor: "#F4C95D",
  shadowOpacity: 0.20,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 11,
},

showcaseImage: {
  width: "100%",
  height: "100%",
  position: "absolute",
},

showcaseShade: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0,0,0,0.22)",
},

showcaseBadge: {
  position: "absolute",
  left: 18,
  bottom: 18,
  paddingHorizontal: 16,
  paddingVertical: 9,
  borderRadius: 999,
  backgroundColor: "rgba(4,8,18,0.66)",
  borderWidth: 1,
  borderColor: "rgba(244,201,93,0.42)",
},

showcaseBadgeText: {
  color: "#F4C95D",
  fontSize: 11.5,
  fontWeight: "800",
  letterSpacing: 0.85,
},



  glassFollowers: {
    borderColor: "rgba(125,211,252,0.48)",
    backgroundColor: "rgba(14,165,233,0.115)",
    shadowColor: "#38BDF8",
  },
  glassSubscription: {
    borderColor: "rgba(244,201,93,0.52)",
    backgroundColor: "rgba(244,201,93,0.11)",
    shadowColor: "#F4C95D",
  },
  glassPost: {
    borderColor: "rgba(167,139,250,0.50)",
    backgroundColor: "rgba(124,58,237,0.125)",
    shadowColor: "#A78BFA",
  },

  glassLive: {
    borderColor: "rgba(251,113,133,0.52)",
    backgroundColor: "rgba(244,63,94,0.13)",
    shadowColor: "#FB7185",
  },
  glassSchedule: {
    borderColor: "rgba(52,211,153,0.48)",
    backgroundColor: "rgba(16,185,129,0.12)",
    shadowColor: "#34D399",
  },
  guestClaimSummaryScroll: {
    marginTop: 24,
    marginBottom: 10,
    marginLeft: 0,
    marginRight: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
  },
  guestClaimSummaryRow: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 0,
    paddingRight: 26,
    alignItems: "center",
  },

  guestClaimSummaryWideCard: {
    width: 132,
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.34)",
    backgroundColor: "rgba(255,255,255,0.075)",
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#F4C95D",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  guestMiniBlue: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(96,165,250,0.16)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.58)",
  },
  guestMiniGold: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59,130,246,0.22)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.58)",
  },
  guestWideTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 16,
    letterSpacing: 0.1,
  },
  guestWideText: {
    marginTop: 1,
    color: "rgba(255,255,255,0.58)",
    fontSize: 8,
    fontWeight: "800",
    lineHeight: 10,
    letterSpacing: 0.2,
  },

  guestClaimSummaryInvitePill: {
    borderColor: "rgba(96,165,250,0.52)",
    backgroundColor: "rgba(96,165,250,0.08)",
  },

  guestClaimSummaryPill: {
    width: 78,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.22)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  guestClaimSummaryValue: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 2,
  },
  guestClaimSummaryLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  guestQuickCardsScroll: {
    display: "none",
  },
  guestQuickCardsRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 14,
  },
  guestQuickCard: {
    width: 190,
    minHeight: 72,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.22)",
    backgroundColor: "rgba(255,255,255,0.045)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  guestQuickIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(96,165,250,0.10)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.32)",
  },
  guestQuickIconGold: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.32)",
  },
  guestQuickTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  guestQuickText: {
    marginTop: 3,
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "700",
  },

  guestClaimListContent: {
    paddingTop: 2,
    paddingBottom: 220,
  },
  guestClaimList: {
    marginTop: 2,
    maxHeight: 520,
    paddingBottom: 90,
  },
  guestClaimEmptyCard: {
    marginTop: 0,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.24)",
    backgroundColor: "rgba(255,255,255,0.045)",
    paddingHorizontal: 22,
    paddingVertical: 28,
    alignItems: "center",
  },
  guestClaimEmptyTitle: {
    marginTop: 12,
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
  },
  guestClaimEmptyText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  guestClaimCardEmerald: {
    borderWidth: 1.6,
    borderColor: "rgba(52,211,153,0.78)",
    shadowColor: "#34D399",
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  guestClaimCardBlue: {
    borderWidth: 1.6,
    borderColor: "rgba(59,130,246,0.76)",
    shadowColor: "#3B82F6",
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  guestClaimCardViolet: {
    borderWidth: 1.6,
    borderColor: "rgba(139,92,246,0.76)",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  guestClaimCardAmber: {
    borderWidth: 1.6,
    borderColor: "rgba(244,201,93,0.82)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  guestClaimCardPink: {
    borderWidth: 1.6,
    borderColor: "rgba(236,72,153,0.74)",
    shadowColor: "#EC4899",
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  guestClaimCardCyan: {
    borderWidth: 1.6,
    borderColor: "rgba(20,184,166,0.78)",
    shadowColor: "#14B8A6",
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },

  guestClaimCard: {
    marginTop: 22,
    borderRadius: 34,
    padding: 13,
    overflow: "visible",
    backgroundColor: "rgba(6,12,22,0.94)",
    borderWidth: 1.4,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.28,
    shadowRadius: 38,
    shadowOffset: { width: 0, height: 14 },
    elevation: 20,
  },
  guestClaimTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  guestClaimLabel: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  guestClaimTitle: {
    marginTop: 5,
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -1.2,
  },
  guestClaimStatus: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(52,211,153,0.14)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.32)",
  },
  guestClaimStatusHot: {
    backgroundColor: "rgba(59,130,246,0.22)",
    borderColor: "rgba(244,201,93,0.42)",
  },
  guestClaimStatusApproved: {
    backgroundColor: "rgba(52,211,153,0.16)",
    borderColor: "rgba(52,211,153,0.45)",
  },
  guestClaimStatusLocked: {
    backgroundColor: "rgba(148,163,184,0.14)",
    borderColor: "rgba(148,163,184,0.34)",
  },
  guestClaimStatusText: {
    color: "#7DD3FC",
    fontSize: 11,
    fontWeight: "800",
  },
  guestClaimConflictBanner: {
    marginTop: 16,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(248,113,113,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.28)",
  },
  guestClaimConflictBannerText: {
    color: "#FCA5A5",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  guestClaimConflictRow: {
    marginTop: 13,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(248,113,113,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.30)",
  },
  guestClaimFixBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  guestClaimFixBtnText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.55,
  },

  guestClaimConflictText: {
    flex: 0,
    width: "48%",
    color: "#FCA5A5",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.45,
  },
  guestSlotInfoGlassEmerald: {
    backgroundColor: "rgba(52,211,153,0.18)",
    borderColor: "rgba(52,211,153,0.58)",
  },
  guestSlotInfoGlassBlue: {
    backgroundColor: "rgba(96,165,250,0.18)",
    borderColor: "rgba(96,165,250,0.58)",
  },
  guestSlotInfoGlassViolet: {
    backgroundColor: "rgba(167,139,250,0.18)",
    borderColor: "rgba(167,139,250,0.58)",
  },
  guestSlotInfoGlassAmber: {
    backgroundColor: "rgba(244,201,93,0.18)",
    borderColor: "rgba(244,201,93,0.60)",
  },
  guestSlotInfoGlassPink: {
    backgroundColor: "rgba(251,113,133,0.16)",
    borderColor: "rgba(251,113,133,0.56)",
  },
  guestSlotInfoGlassCyan: {
    backgroundColor: "rgba(34,211,238,0.16)",
    borderColor: "rgba(34,211,238,0.56)",
  },

  guestSlotInfoGlass: {
    marginTop: 10,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.075)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.18)",
  },
  guestSlotInfoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  guestSlotInfoText: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 12,
    fontWeight: "800",
  },
  guestSlotInfoDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
  },

  guestClaimTimePills: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  guestClaimTimePill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.24)",
  },
  guestClaimTimePillText: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "800",
  },
  guestClaimArrow: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 17,
    fontWeight: "800",
  },
  guestClaimCountdownRow: {
    marginTop: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.075)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  guestClaimCountdownLive: {
    backgroundColor: "rgba(52,211,153,0.14)",
    borderColor: "rgba(52,211,153,0.35)",
  },
  guestClaimCountdownEnded: {
    opacity: 0.58,
  },
  guestClaimCountdownText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  guestClaimInfoRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  guestClaimPersonHero: {
    marginTop: 12,
    borderRadius: 24,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,255,255,0.065)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  guestClaimPersonHeroActive: {
    backgroundColor: "rgba(244,201,93,0.10)",
    borderColor: "rgba(244,201,93,0.30)",
  },
  guestClaimHeroAvatar: {
    width: 58,
    height: 52,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: "rgba(244,201,93,0.75)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  guestClaimHeroAvatarFallback: {
    width: 58,
    height: 52,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(244,201,93,0.65)",
    backgroundColor: "rgba(244,201,93,0.14)",
  },
  guestClaimHeroAvatarText: {
    color: "#7DD3FC",
    fontSize: 22,
    fontWeight: "800",
  },
  guestClaimPersonKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  guestInviteBox: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  guestInviteInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 16,
    paddingHorizontal: 13,
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.28)",
  },
  guestInviteBtn: {
    minHeight: 42,
    borderRadius: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.18)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.52)",
  },
  guestInviteBtnText: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "800",
  },
  guestInviteSentText: {
    marginTop: 7,
    color: "#86EFAC",
    fontSize: 11,
    fontWeight: "800",
  },
  guestStatInviteCard: {
    borderColor: "rgba(96,165,250,0.45)",
    backgroundColor: "rgba(96,165,250,0.08)",
  },

  guestClaimPersonName: {
    marginTop: 4,
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  guestClaimAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(253,186,116,0.55)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  guestClaimAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(253,186,116,0.45)",
    backgroundColor: "rgba(253,186,116,0.13)",
  },
  guestClaimAvatarText: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "800",
  },
  guestClaimInfoText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "800",
  },
  guestClaimMoveRow: {
    zIndex: 50,
    elevation: 50,
    marginTop: 8,
    marginBottom: 30,
    flexDirection: "row",
    gap: 10,
  },
  guestClaimMiniBtn: {
    zIndex: 60,
    elevation: 60,
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  guestClaimMoveUpBtn: {
    backgroundColor: "rgba(52,211,153,0.12)",
    borderColor: "rgba(52,211,153,0.32)",
  },
  guestClaimMoveDownBtn: {
    backgroundColor: "rgba(96,165,250,0.12)",
    borderColor: "rgba(96,165,250,0.32)",
  },
  guestClaimMoveUpText: {
    color: "#86EFAC",
  },
  guestClaimMoveDownText: {
    color: "#93C5FD",
  },
  guestClaimMiniBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.35,
  },

  guestClaimActions: {
    zIndex: 50,
    elevation: 50,
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  guestClaimActionBtn: {
    zIndex: 60,
    elevation: 60,
    flex: 1,
    minHeight: 54,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },
  guestClaimApproveBtn: {
    backgroundColor: "rgba(52,211,153,0.14)",
    borderColor: "rgba(52,211,153,0.3)",
  },
  guestClaimApprovedBtn: {
    backgroundColor: "rgba(34,197,94,0.18)",
    borderColor: "rgba(34,197,94,0.42)",
  },
  guestClaimMessageBtn: {
    backgroundColor: "rgba(244,201,93,0.12)",
    borderColor: "rgba(244,201,93,0.32)",
  },
  guestClaimLockedBtn: {
    backgroundColor: "rgba(148,163,184,0.14)",
    borderColor: "rgba(148,163,184,0.32)",
  },
  guestClaimDangerBtn: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderColor: "rgba(248,113,113,0.25)",
  },
  guestClaimDisabledBtn: {
    opacity: 0.42,
  },
  guestClaimActionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },

  glassGuests: {
    borderColor: "rgba(253,186,116,0.50)",
    backgroundColor: "rgba(249,115,22,0.12)",
    shadowColor: "#FDBA74",
  },
  glassStorageMedia: {
    borderColor: "rgba(125,211,252,0.50)",
    backgroundColor: "rgba(14,165,233,0.12)",
    shadowColor: "#7DD3FC",
  },
  glassStorageChurch: {
    borderColor: "rgba(244,201,93,0.52)",
    backgroundColor: "rgba(244,201,93,0.10)",
    shadowColor: "#F4C95D",
  },
  ringFollowers: { borderColor: "rgba(125,211,252,0.68)", shadowColor: "#7DD3FC", shadowOpacity: 0.35, shadowRadius: 16 },
  ringSubscription: { borderColor: "rgba(244,201,93,0.70)", shadowColor: "#F4C95D", shadowOpacity: 0.38, shadowRadius: 16 },
  ringPost: { borderColor: "rgba(167,139,250,0.68)", shadowColor: "#A78BFA", shadowOpacity: 0.35, shadowRadius: 16 },
  ringLive: { borderColor: "rgba(251,113,133,0.70)", shadowColor: "#FB7185", shadowOpacity: 0.38, shadowRadius: 16 },
  ringSchedule: { borderColor: "rgba(52,211,153,0.66)", shadowColor: "#34D399", shadowOpacity: 0.34, shadowRadius: 16 },
  ringGuests: { borderColor: "rgba(253,186,116,0.68)", shadowColor: "#FDBA74", shadowOpacity: 0.35, shadowRadius: 16 },
  ringStorageMedia: { borderColor: "rgba(125,211,252,0.68)", shadowColor: "#7DD3FC", shadowOpacity: 0.35, shadowRadius: 16 },
  ringStorageChurch: { borderColor: "rgba(244,201,93,0.70)", shadowColor: "#F4C95D", shadowOpacity: 0.36, shadowRadius: 16 },

  dashboardToolsScroll: {
    marginTop: 20,
    maxHeight: 520,
  },
  dashboardToolsContent: {
    paddingBottom: 220,
  },

  mediaIdRow: {
    marginTop: 8,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  mediaName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  mediaIdPill: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.32)",
  },
  mediaIdText: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  headerMediaIdPill: {
    flex: 1,
    maxWidth: 250,
    minHeight: 56,
    paddingHorizontal: 18,
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(22,18,8,0.96)",
    borderWidth: 1.8,
    borderColor: "rgba(244,201,93,0.70)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.46,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  headerMediaIdText: {
    color: "#7DD3FC",
    fontSize: 13.5,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0.65,
  },

  headerMediaIdSpacer: {
    flex: 1,
    maxWidth: 250,
    minHeight: 56,
  },

  headerSideSpacer: {
    width: 58,
    height: 52,
  },

  backBtnGhost: {
    width: 58,
    height: 52,
  },

  headerRowCreateHidden: {
    height: 0,
    minHeight: 0,
    marginTop: 0,
    marginBottom: 0,
    paddingHorizontal: 0,
    overflow: "hidden",
  },
  

  scheduleCreatorHero: {
    minHeight: 118,
    borderRadius: 34,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1.4,
    borderColor: "rgba(244,201,93,0.38)",
    marginBottom: 14,
  },
  scheduleBackBtn: {
    width: 58,
    height: 52,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.32)",
  },
  scheduleFormCard: {
    borderRadius: 28,
    padding: 6,
    backgroundColor: "rgba(8,12,24,0.50)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 42,
  },

  videoPreviewBox: {
    height: 570,
    borderRadius: 32,
    overflow: "hidden",
    marginBottom: 14,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.46)",
  },
  videoPreview: {
    width: "100%",
    height: "100%",
  },
  videoPreviewBadge: {
    position: "absolute",
    left: 14,
    bottom: 18,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(5,8,16,0.54)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.36)",
  },
  videoPreviewBadgeText: {
    color: "#7DD3FC",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  scheduleTextArea: {
    minHeight: 88,
    alignItems: "flex-start",
    paddingTop: 16,
  },
  scheduleTextAreaInput: {
    minHeight: 66,
    textAlignVertical: "top",
  },


  videoSmartLoadingCard: {
    height: 450,
    borderRadius: 26,
    marginBottom: 26,
    padding: 16,
    justifyContent: "center",
    backgroundColor: "rgba(12,18,34,0.72)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.22)",
  },
  videoSmartLoadingTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  videoSmartLoadingTitle: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  videoSmartLoadingPercent: {
    color: "#7DD3FC",
    fontSize: 16,
    fontWeight: "800",
  },
  videoSmartProgressTrack: {
    height: 10,
    borderRadius: 999,
    marginTop: 18,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  videoSmartProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#7DD3FC",
  },
  videoSmartLoadingText: {
    marginTop: 14,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },


  videoDetailsCard: {
    marginTop: 14,
    borderRadius: 24,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.16)",
  },




  videoPostInlineCta: {
    marginTop: 20,
    marginHorizontal: 8,
  },


  videoChangeBtn: {
    alignSelf: "center",
    marginTop: 6,
    minHeight: 38,
    paddingHorizontal: 18,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(10,14,28,0.68)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.18)",
  },
  videoChangeBtnText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.15,
  },


  videoPreviewChangeMini: {
    position: "absolute",
    right: 14,
    top: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,8,16,0.50)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.22)",
  },


  videoPreviewVolumeMini: {
    position: "absolute",
    right: 14,
    top: 62,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,8,16,0.50)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.22)",
  },


  videoPostFloatingCta: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 80,
  },

});
