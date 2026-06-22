import { Tabs, useGlobalSearchParams, useSegments, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { silentPreloadTabScreens } from "@/src/lib/screenDataCache";
import { deferStartupWorkAfterHomeFirstFrame, setHomeTabFocused } from "@/src/lib/firstPaint";
import { startMoreTabPremount } from "@/src/lib/moreTabPremount";
import {
  beginMoreTabPressTransition,
  endMoreTabPressTransition,
  hideMoreTabShell,
  isMoreTabShellVisible,
  isMoreTabTransitionBlocking,
  logMoreDeferredRefreshSkip,
  subscribeMoreTabTransition,
} from "@/src/lib/refreshCoordinator";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { apiGet } from "@/src/lib/kristoApi";
import { feedList, subscribe as subscribeHomeFeed, ensurePersonalTabRingClaimFromEvent } from "@/src/lib/homeFeedStore";
import { getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";
import {
  beginClaimHydrationStartup,
  collectScheduleRowsForRingScan,
  finishClaimHydrationStartup,
  prefetchCrossChurchClaimSchedules,
  rehydrateClaimStoresFromFeedRows,
  resolveStablePersonalScheduleAlert,
} from "@/src/lib/claimStateMerge";
import {
  isBackendFeedScheduleId,
  isLocalMediaScheduleId,
  resolveLiveRingCanonicalFeedId,
} from "@/src/lib/scheduleSlotUtils";
import {
  buildScheduleLiveRoomRouteParams,
  resolveLiveRingNavigationTarget,
} from "@/src/lib/enterLiveRoomNavigation";
import { pauseHomeFeedBackgroundWorkForLiveNavigation } from "@/src/lib/liveRoomStartup";
import {
  pinLiveKitPublisherHostBeforeToken,
  pinLiveRoomSession,
  pinClaimEnterSessionLockFromRoute,
} from "@/src/lib/liveRoomSessionGuard";
import {
  RING_RECOMPUTE_INTERVAL_MS,
  recomputeScheduleRingsFromRows,
  onLiveRingRefresh,
  logMeTabRingDecision,
} from "@/src/lib/liveScheduleRing";
import { onClaimUpdated, type ClaimUpdatedPayload } from "@/src/lib/kristoProfileEvents";
import { Animated, InteractionManager, Pressable, StyleSheet, Text, View } from "react-native";
import { ensureChurchAccessOrSetup } from "@/src/lib/churchLockedRecovery";
import { fetchLightLiveState, resolveChurchLiveStateUpdate, startAdaptiveLivePolling } from "@/src/lib/liveRealtime";
import {
  HOME_FEED_GOLD,
  HOME_FEED_INACTIVE,
} from "@/src/components/homeFeed/theme";
import { homeFeedPremiumStyles as homeFeedPremium } from "@/src/components/homeFeed/homeFeedPremiumStyles";

const VIP_BG = "#010102";
const VIP_BORDER = "rgba(255,255,255,0.08)";
const GOLD = HOME_FEED_GOLD;
const MUTED = HOME_FEED_INACTIVE;
const MORE_SHELL_BG = "#010102";
/** Hold time before onLongPress; RN default is 500ms. */
const LIVE_RING_LONG_PRESS_MS = 150;

type LiveRingNavTrigger = "longPress" | "tabPress";


function MessagesModeTabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 8,
        paddingBottom: 14,
        height: 70,
      }}
    >
      <Ionicons
        name={icon}
        size={26}
        color={active ? GOLD : MUTED}
      />
      <Text
        style={{
          marginTop: 1,
          color: active ? GOLD : MUTED,
          fontWeight: "800",
          fontSize: 11,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}


function ChurchLiveTabIcon({ focused, isLive, pulse, liveColor = "#EF4444" }: { focused: boolean; isLive: boolean; pulse: Animated.Value; liveColor?: string }) {
  const waveScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const waveOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0] });

  return (
    <View style={{ width: 46, height: 38, alignItems: "center", justifyContent: "center" }}>
      {isLive ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 34,
            height: 34,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: liveColor,
            transform: [{ scale: waveScale }],
            opacity: waveOpacity,
          }}
        />
      ) : focused ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 36,
            height: 36,
            borderRadius: 999,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: "rgba(201,169,98,0.45)",
          }}
        />
      ) : null}
      <View
        style={{
          width: focused && !isLive ? 36 : 32,
          height: focused && !isLive ? 36 : 32,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: isLive ? 2 : focused ? 1.5 : 0,
          borderColor: isLive ? liveColor : focused ? "rgba(217,179,95,0.55)" : "transparent",
          backgroundColor: focused && !isLive ? "rgba(217,179,95,0.08)" : "transparent",
        }}
      >
        {isLive ? (
          <Ionicons name="radio" size={25} color={liveColor} />
        ) : (
          <MaterialCommunityIcons name="church" size={focused ? 27 : 26} color={focused ? GOLD : MUTED} />
        )}
      </View>
    </View>
  );
}


function ProfileAvatarIcon({
  focused,
  alertColor,
  alertIcon,
  alertKind,
  hasPersonal,
  ringVisible,
  userId,
}: {
  focused: boolean;
  alertColor?: string;
  alertIcon?: keyof typeof Ionicons.glyphMap;
  alertKind?: string;
  hasPersonal?: boolean;
  ringVisible?: boolean;
  userId?: string;
}) {
  const hasAlert = !!alertColor;

  useLayoutEffect(() => {
    console.log("KRISTO_ME_TAB_ICON_RENDER", {
      focused,
      alertColor: alertColor || null,
      alertKind: alertKind || null,
      hasPersonal: hasPersonal === true,
      ringVisible: ringVisible === true,
      ringColor: alertColor || null,
      userId: userId || null,
    });
  }, [focused, alertColor, alertKind, hasPersonal, ringVisible, userId]);

  return (
    <View
      style={{
        width: hasAlert ? 86 : 34,
        height: hasAlert ? 74 : 34,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: hasAlert ? -24 : 0,
      }}
    >
      {hasAlert ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 76,
            height: 76,
            borderRadius: 999,
            borderWidth: 6,
            borderColor: alertColor,
            backgroundColor: "rgba(0,0,0,0.42)",
            shadowColor: alertColor,
            shadowOpacity: 0.9,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 0 },
            elevation: 14,
          }}
        />
      ) : null}

      <View
        style={{
          width: hasAlert ? 60 : 28,
          height: hasAlert ? 60 : 28,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: focused || hasAlert ? 3 : 1,
          borderColor: hasAlert ? alertColor : focused ? GOLD : "rgba(255,255,255,0.16)",
          backgroundColor: hasAlert ? "rgba(2,8,18,0.96)" : "rgba(255,255,255,0.03)",
        }}
      >
        <Ionicons
          name={hasAlert ? (alertIcon || "notifications") : "person"}
          size={hasAlert ? 36 : 16}
          color={hasAlert ? alertColor : focused ? GOLD : "rgba(255,255,255,0.65)"}
        />
      </View>
    </View>
  );
}

export default function TabLayout() {
  const segments = useSegments() as string[];
  const params = useGlobalSearchParams<{ profileMode?: string }>();
  const router = useRouter();
  const { session, loading, setSession } = useKristoSession();
  const prevTabRef = useRef("");
  const [, redrawMoreShell] = useReducer((value: number) => value + 1, 0);

  useEffect(() => subscribeMoreTabTransition(redrawMoreShell), []);

  useEffect(() => {
    if (loading || !session?.userId) return;
    startMoreTabPremount(session);
  }, [loading, session?.userId, session?.churchId, session?.role]);

  useLayoutEffect(() => {
    const tab = String(segments[1] || "index");
    setHomeTabFocused(tab === "index");
    const prevTab = prevTabRef.current;
    if (tab === "more") {
      hideMoreTabShell();
    } else if (prevTab === "more") {
      endMoreTabPressTransition();
    }
    prevTabRef.current = tab;
  }, [segments.join("/")]);

  useEffect(() => {
    if (loading || !session?.userId) return;
    deferStartupWorkAfterHomeFirstFrame(
      () => {
        void silentPreloadTabScreens(session);
      },
      { reason: "screen-cache-preload" }
    );
  }, [loading, session?.userId, session?.churchId, session?.role]);

  useEffect(() => {
    if (loading || !session?.userId) return;
    const tab = String(segments[1] || "index");
    if (tab !== "index") return;
    if (isMoreTabTransitionBlocking()) return;
    deferStartupWorkAfterHomeFirstFrame(
      () => {
        void silentPreloadTabScreens(session);
      },
      { reason: "screen-cache-preload-home-focus" }
    );
  }, [loading, session, segments.join("/")]);

  function resolveRingScheduleIds(item: any) {
    const rows = [...backendFeedRowsRef.current, ...(feedList() as any[])];
    return resolveLiveRingCanonicalFeedId(item, rows);
  }

  function logLiveRingActiveSchedule(
    label: string,
    item: any,
    alert?: { startsInMin?: number; isLiveNow?: boolean } | null
  ) {
    const rawId = String(item?.id || "").trim();
    const { canonicalFeedId, localScheduleId } = resolveRingScheduleIds(item);

    console.log("KRISTO_LIVE_RING_ACTIVE_SCHEDULE_FOUND", {
      label,
      id: rawId,
      canonicalFeedId,
      localScheduleId,
      slotCount: Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0,
      startsInMin: alert?.startsInMin ?? null,
      isLiveNow: alert?.isLiveNow ?? null,
      isLocalScheduleId: isLocalMediaScheduleId(localScheduleId || rawId),
      isBackendFeedId: isBackendFeedScheduleId(canonicalFeedId),
    });
  }

  function openPersonalScheduleAlert() {
    const pressStartedAt = Date.now();
    console.log("KRISTO_LIVE_RING_LONG_PRESS_START", {
      tab: "profile",
      hasAlert: !!personalScheduleTabAlert,
    });

    const alert = personalScheduleTabAlert;
    if (!alert?.item || !alert?.slot) {
      console.log("KRISTO_LIVE_RING_LONG_PRESS_BLOCKED", {
        tab: "profile",
        reason: "no_personal_schedule_alert",
        durationMs: Date.now() - pressStartedAt,
      });
      return false;
    }

    const item = alert.item || {};
    const slot = alert.slot || {};
    const claimedByMe = String(alert?.match || "") === "claimed";
    const isLiveNow = alert?.isLiveNow === true;
    const initialSlots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];

    logLiveRingActiveSchedule("profile-ring", item, alert);

    const navTarget = resolveLiveRingNavigationTarget({
      item,
      slot,
      allSlots: initialSlots,
      routeSlotNumber: (alert?.index ?? 0) + 1,
      viewerUserId: String(session?.userId || "").trim(),
      viewerChurchId: String(session?.churchId || item?.churchId || "").trim(),
      mergedRows: backendFeedRowsRef.current,
      source: "profile-ring-long-press",
    });

    const navigateParams = buildScheduleLiveRoomRouteParams(navTarget.item, {
      slot: navTarget.slot,
      allSlots: navTarget.allSlots,
      isLiveNow,
      claimedByMe,
      routeSlotNumber: navTarget.routeSlotNumber,
      scheduleStartMs: alert?.startMs,
      scheduleEndMs: alert?.endMs,
      churchId: String(session?.churchId || ""),
      viewerUserId: String(session?.userId || "").trim(),
      liveBridgeId: navTarget.liveBridgeId,
      sourceScheduleId: navTarget.sourceScheduleId,
    });

    console.log("KRISTO_LIVE_RING_NAVIGATE_REQUEST", {
      tab: "profile",
      target: "/more/my-church-room/messages/live-room",
      feedId: navigateParams.feedId,
      liveId: navigateParams.liveId,
      localScheduleId: String((navigateParams as any).localScheduleId || ""),
      entryMode: navigateParams.entryMode,
      currentSlotNumber: navigateParams.currentSlotNumber,
      routeSlotCount: navTarget.allSlots.length,
      remappedFromRm: navTarget.remappedFromRm,
      durationMs: Date.now() - pressStartedAt,
    });

    pauseHomeFeedBackgroundWorkForLiveNavigation("live-ring-profile-nav");
    (globalThis as any).__KRISTO_LIVE_RING_NAV_AT__ = Date.now();

    const liveBridgeId = String(navigateParams.liveId || navigateParams.feedId || "").trim();
    const viewerUserId = String(session?.userId || "").trim();
    if (liveBridgeId && viewerUserId) {
      pinLiveRoomSession({
        liveBridgeId,
        userId: viewerUserId,
        routeSlotCount: navTarget.allSlots.length,
        source: "live-ring-profile-nav",
      });
      if (claimedByMe && isLiveNow) {
        pinClaimEnterSessionLockFromRoute({
          liveBridgeId,
          routeParams: navigateParams as Record<string, unknown>,
          source: "live-ring-profile-nav",
        });
        pinLiveKitPublisherHostBeforeToken(liveBridgeId, "live-ring-profile-nav", {
          stableIdentity: String(navigateParams.claimedByUserId || viewerUserId).replace(
            /[^a-zA-Z0-9_]/g,
            ""
          ),
        });
      }
    }

    router.replace({
      pathname: "/more/my-church-room/messages/live-room",
      params: navigateParams,
    } as any);

    return true;
  }

  function logLiveRingNavDelay(
    trigger: LiveRingNavTrigger,
    pressStartedAt: number,
    opened: boolean,
    extra?: Record<string, unknown>
  ) {
    console.log("KRISTO_LIVE_RING_NAV_DELAY", {
      tab: "church",
      trigger,
      durationMs: Date.now() - pressStartedAt,
      opened,
      ...extra,
    });
  }

  function openChurchLiveAsViewer(trigger: LiveRingNavTrigger, gestureAt?: number) {
    const openViewerStart = Date.now();
    const gestureDetectedAt = Number(gestureAt || openViewerStart);

    console.log("KRISTO_LIVE_RING_OPEN_VIEWER_START", {
      tab: "church",
      trigger,
      delayLongPressMs: LIVE_RING_LONG_PRESS_MS,
      sinceGestureMs: openViewerStart - gestureDetectedAt,
    });

    const scheduleAlert = mediaScheduleTabLive;

    if (scheduleAlert?.item && scheduleAlert?.slot) {
      const item = scheduleAlert.item || {};
      const slot = scheduleAlert.slot || {};
      const isLiveNow = scheduleAlert?.isLiveNow === true;
      const initialSlots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
      const viewerUserId = String(session?.userId || "").trim();
      const claimedIndex = initialSlots.findIndex((s: any) => {
        const raw = s?.claimedBy;
        return (
          String(s?.claimedByUserId || "").trim() === viewerUserId ||
          String(raw && typeof raw === "object" ? raw.userId || "" : "").trim() === viewerUserId
        );
      });
      const userClaimedSlot = claimedIndex >= 0 ? initialSlots[claimedIndex] : null;

      const paramsBuildStart = Date.now();
      logLiveRingActiveSchedule("church-ring-schedule", item, scheduleAlert);

      // Important: do NOT open camera just because user claimed a future slot.
      // Church LIVE tab should show the current live slot unless the user's claimed slot is the current/live slot.
      const currentLiveSlotId = String(slot?.id || slot?.slotId || "").trim();
      const userClaimedSlotId = String(userClaimedSlot?.id || userClaimedSlot?.slotId || "").trim();
      const userClaimIsCurrentLiveSlot =
        !!userClaimedSlot &&
        isLiveNow &&
        !!currentLiveSlotId &&
        currentLiveSlotId === userClaimedSlotId;

      const claimedByMe = userClaimIsCurrentLiveSlot;
      const routeSlot = userClaimIsCurrentLiveSlot ? userClaimedSlot : slot;
      const routeSlotNumber = userClaimIsCurrentLiveSlot
        ? claimedIndex + 1
        : (scheduleAlert?.index ?? 0) + 1;

      const navTarget = resolveLiveRingNavigationTarget({
        item,
        slot: routeSlot,
        allSlots: initialSlots,
        routeSlotNumber,
        viewerUserId,
        viewerChurchId: String(session?.churchId || item?.churchId || "").trim(),
        mergedRows: backendFeedRowsRef.current,
        source: "church-ring-long-press",
      });

      const navigateParams = buildScheduleLiveRoomRouteParams(navTarget.item, {
        slot: navTarget.slot,
        allSlots: navTarget.allSlots,
        isLiveNow,
        claimedByMe,
        routeSlotNumber: navTarget.routeSlotNumber,
        scheduleStartMs: scheduleAlert?.startMs,
        scheduleEndMs: scheduleAlert?.endMs,
        churchId: String(session?.churchId || ""),
        viewerUserId,
        liveBridgeId: navTarget.liveBridgeId,
        sourceScheduleId: navTarget.sourceScheduleId,
      });

      const paramsBuildMs = Date.now() - paramsBuildStart;
      const navAt = Date.now();
      pauseHomeFeedBackgroundWorkForLiveNavigation("live-ring-schedule-nav");
      (globalThis as any).__KRISTO_LIVE_RING_NAV_AT__ = navAt;

      router.replace({
        pathname: "/more/my-church-room/messages/live-room",
        params: navigateParams,
      } as any);

      const replaceDoneAt = Date.now();
      console.log("KRISTO_LIVE_RING_ROUTER_REPLACE_DONE", {
        tab: "church",
        path: "schedule",
        trigger,
        paramsBuildMs,
        replaceCallMs: replaceDoneAt - navAt,
        sinceGestureMs: replaceDoneAt - gestureDetectedAt,
        sinceOpenViewerMs: replaceDoneAt - openViewerStart,
      });
      logLiveRingNavDelay(trigger, gestureDetectedAt, true, { path: "schedule" });
      return true;
    }

    const activeChurchLive = backendChurchLive;
    if (!activeChurchLive?.isLive) {
      console.log("KRISTO_LIVE_RING_LONG_PRESS_BLOCKED", {
        tab: "church",
        trigger,
        reason: "no_schedule_alert_and_no_backend_live",
      });
      logLiveRingNavDelay(trigger, gestureDetectedAt, false, {
        reason: "no_schedule_alert_and_no_backend_live",
      });
      return false;
    }

    const instantParams = {
      source: "media",
      liveMode: "instant",
      entryMode: "live",
      role: "Viewer",
      title: String((activeChurchLive as any)?.title || (activeChurchLive as any)?.mediaName || "Church Live"),
      mediaName: String((activeChurchLive as any)?.mediaName || (activeChurchLive as any)?.title || "Church Live"),
      liveId: String((activeChurchLive as any)?.liveId || ""),
      pastorUserId: String((activeChurchLive as any)?.actualChurchPastorUserId || (activeChurchLive as any)?.pastorUserId || ""),
      actualChurchPastorUserId: String((activeChurchLive as any)?.actualChurchPastorUserId || (activeChurchLive as any)?.pastorUserId || ""),
      layout: "focus",
      room: "church",
      mode: "viewer",
    };

    const navAt = Date.now();
    pauseHomeFeedBackgroundWorkForLiveNavigation("live-ring-instant-nav");
    (globalThis as any).__KRISTO_LIVE_RING_NAV_AT__ = navAt;

    router.replace({
      pathname: "/more/my-church-room/messages/live-room",
      params: instantParams,
    } as any);

    const replaceDoneAt = Date.now();
    console.log("KRISTO_LIVE_RING_ROUTER_REPLACE_DONE", {
      tab: "church",
      path: "instant",
      trigger,
      replaceCallMs: replaceDoneAt - navAt,
      sinceGestureMs: replaceDoneAt - gestureDetectedAt,
      sinceOpenViewerMs: replaceDoneAt - openViewerStart,
    });
    logLiveRingNavDelay(trigger, gestureDetectedAt, true, { path: "instant" });
    return true;
  }

  const sessionChurchId = String(session?.churchId || "").trim();
  const hasChurch = Boolean(sessionChurchId);

  const hideAnnouncementsCreate =
    segments[0] === "(tabs)" &&
    segments[1] === "more" &&
    segments[2] === "my-church-room" &&
    segments[3] === "announcements" &&
    segments[4] === "create";

  const hidePosterProfile =
    segments[0] === "(tabs)" &&
    segments[1] === "profile" &&
    String(params?.profileMode || "") === "poster";

  const hideChurchCreate =
    segments[0] === "(tabs)" &&
    segments[1] === "more" &&
    segments[2] === "church" &&
    segments[3] === "create";

  const isMessagesMode =
    segments[0] === "(tabs)" &&
    segments[1] === "more" &&
    segments[2] === "my-church-room" &&
    (segments[3] === "messages" || segments[3] === "ministry");

  const hideAssignmentRoom =
    segments[0] === "(tabs)" &&
    segments[1] === "more" &&
    segments[2] === "my-church-room" &&
    segments[3] === "messages" &&
    Boolean(segments[4]);

  const hideTabBar = hideAnnouncementsCreate || hidePosterProfile || hideAssignmentRoom || hideChurchCreate;

  const activeMessagesTab =
    isMessagesMode
      ? (segments[3] === "ministry" ? "ministry" : "chat")
      : null;

  const homeTitle = isMessagesMode ? "Chat" : "Home";
  const moreTitle = isMessagesMode ? "TLMC" : "More";
  const churchTitle = isMessagesMode ? "Live Room" : "Church";
  const profileTitle = isMessagesMode ? "Call" : "Me";

  const auth = getKristoAuth();
  const hasActiveChurch = !!String(auth?.churchId || "").trim();
  const backendChurchLiveRef = useRef<any>(null);
  const [backendChurchLive, setBackendChurchLive] = useState<any>(null);
  const [mediaScheduleTabLive, setMediaScheduleTabLive] = useState<any>(null);
  const [personalScheduleTabAlert, setPersonalScheduleTabAlert] = useState<any>(null);
  const churchLivePulse = useRef(new Animated.Value(0)).current;
  const backendFeedRowsRef = useRef<any[]>([]);
  const personalAlertRef = useRef<any>(null);
  const claimRingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const liveRingPollingStartedRef = useRef(false);
  const liveRingPollStopRef = useRef<(() => void) | null>(null);
  const ringRecomputeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyScheduleRings = useCallback(
    (source: string, churchBackendRows: any[] = backendFeedRowsRef.current) => {
      if (!session?.userId) return;

      const scanRows = collectScheduleRowsForRingScan(churchBackendRows, String(session.userId || ""));
      const { personal, church } = recomputeScheduleRingsFromRows({
        rows: scanRows,
        viewerUserId: String(session.userId || ""),
        viewerChurchId: String(session.churchId || ""),
        source,
        backendFeedLoaded: source.includes("backend"),
      });

      const stablePersonal = resolveStablePersonalScheduleAlert({
        computed: personal,
        previous: personalAlertRef.current,
        viewerUserId: String(session.userId || ""),
        source,
      });

      personalAlertRef.current = stablePersonal;
      setMediaScheduleTabLive(church);
      setPersonalScheduleTabAlert(stablePersonal);
      logMeTabRingDecision({
        currentUserId: String(session.userId || ""),
        personal: stablePersonal,
        source,
      });
    },
    [session?.userId, session?.churchId]
  );

  const refreshChurchLiveAndRings = useCallback(
    async (source: string) => {
      applyScheduleRings(source);

      if (!session?.userId || !session?.churchId) return;

      if (isMoreTabTransitionBlocking()) {
        logMoreDeferredRefreshSkip("refreshChurchLiveAndRings", "more-tab-transition-blocked", {
          source,
        });
        return;
      }

      const churchRing = recomputeScheduleRingsFromRows({
        rows: collectScheduleRowsForRingScan(backendFeedRowsRef.current, String(session.userId || "")),
        viewerUserId: String(session.userId || ""),
        viewerChurchId: String(session.churchId || ""),
        source: `${source}-live-resolve`,
        backendFeedLoaded: true,
      }).church;

      const headers = getKristoHeaders({
        userId: session.userId,
        role: (session.role || "Member") as any,
        churchId: session.churchId || "",
      });

      try {
        const patch = await fetchLightLiveState(headers as any, `TabLayout:${source}`);
        const resolved = resolveChurchLiveStateUpdate({
          patch,
          previousLive: backendChurchLiveRef.current,
          churchId: String(session.churchId || ""),
          scheduleLiveActive: churchRing?.isLiveNow === true,
        });

        console.log("KRISTO_CHURCH_LIVE_STATE_RESULT", {
          source,
          churchId: String(session.churchId || ""),
          routeFailed: patch.routeFailed === true,
          preserved: resolved.preserved,
          shouldUpdate: resolved.shouldUpdate,
          updateSource: resolved.source,
          hasNextLive: Boolean(resolved.nextLive?.isLive),
        });

        if (resolved.shouldUpdate) {
          backendChurchLiveRef.current = resolved.nextLive;
          setBackendChurchLive(resolved.nextLive);
        }
      } catch {}

      try {
        const feedRes: any = await apiGet(
          `/api/church/feed?scope=church&_=${Date.now()}`,
          { headers, cache: "no-store" as RequestCache },
          { screen: "TabLayout", dedupe: false }
        );
        const rows: any[] =
          Array.isArray(feedRes?.data?.items) ? feedRes.data.items :
          Array.isArray(feedRes?.data) ? feedRes.data :
          Array.isArray(feedRes?.items) ? feedRes.items :
          Array.isArray(feedRes) ? feedRes : [];

        backendFeedRowsRef.current = rows;
        applyScheduleRings(`${source}-backend`, rows);
        void prefetchCrossChurchClaimSchedules({
          viewerUserId: String(session.userId || ""),
          viewerChurchId: String(session.churchId || ""),
          viewerRole: String(session.role || "Member"),
        }).finally(() => {
          applyScheduleRings(`${source}-cross-church-prefetch`, backendFeedRowsRef.current);
          finishClaimHydrationStartup(`${source}-cross-church-prefetch`);
        });
      } catch {
        applyScheduleRings(`${source}-backend-error`);
        finishClaimHydrationStartup(`${source}-backend-error`);
      }
    },
    [session?.userId, session?.churchId, session?.role, applyScheduleRings]
  );

  const scheduleClaimRingSync = useCallback(
    (payload?: ClaimUpdatedPayload) => {
      console.log("KRISTO_RING_CLAIM_EVENT_RECOMPUTE", {
        action: payload?.action || "claim",
        feedId: payload?.feedId || payload?.baseFeedId || payload?.postId || "",
        slotId: payload?.slotId || "",
        slotNumber: payload?.slotNumber ?? null,
        userId: payload?.userId || "",
        startMs: payload?.startMs ?? null,
        endMs: payload?.endMs ?? null,
      });

      if (payload?.action === "claim") {
        ensurePersonalTabRingClaimFromEvent(payload);
      }

      claimRingTimersRef.current.forEach((timer) => clearTimeout(timer));
      claimRingTimersRef.current = [];

      applyScheduleRings("claim-event");
      for (const delayMs of [250, 1000, 2500]) {
        claimRingTimersRef.current.push(
          setTimeout(() => applyScheduleRings("claim-event"), delayMs)
        );
      }
    },
    [applyScheduleRings]
  );

  const startLiveRingPolling = useCallback(() => {
    if (liveRingPollingStartedRef.current) return;
    liveRingPollingStartedRef.current = true;

    void refreshChurchLiveAndRings("deferred-start");

    ringRecomputeTimerRef.current = setInterval(
      () => applyScheduleRings("timer"),
      RING_RECOMPUTE_INTERVAL_MS
    );

    liveRingPollStopRef.current = startAdaptiveLivePolling({
      screen: "TabLayout",
      activeMs: 60000,
      idleMs: 120000,
      onTick: async () => {
        await refreshChurchLiveAndRings("poll");
      },
    });
  }, [applyScheduleRings, refreshChurchLiveAndRings]);

  useEffect(() => {
    beginClaimHydrationStartup();
    applyScheduleRings("mount");
    const rehydrateClaimStores = () => {
      const uid = String(session?.userId || "").trim();
      if (!uid) return;
      rehydrateClaimStoresFromFeedRows(
        [...feedList(), ...getCachedHomeFeedBackendRows()],
        uid
      );
      applyScheduleRings("claim-rehydrate");
    };
    rehydrateClaimStores();
    const unsubFeed = subscribeHomeFeed(() => {
      rehydrateClaimStores();
      applyScheduleRings("feed");
    });
    const unsubClaim = onClaimUpdated((payload) => scheduleClaimRingSync(payload));
    const unsubRingRefresh = onLiveRingRefresh(({ reason }) => {
      if (isMoreTabTransitionBlocking()) {
        logMoreDeferredRefreshSkip("refreshChurchLiveAndRings", "more-tab-transition-blocked", {
          source: reason,
        });
        return;
      }
      void refreshChurchLiveAndRings(reason);
    });

    deferStartupWorkAfterHomeFirstFrame(() => startLiveRingPolling(), {
      reason: "live-ring-polling",
    });

    return () => {
      unsubFeed();
      unsubClaim();
      unsubRingRefresh();
      if (ringRecomputeTimerRef.current) {
        clearInterval(ringRecomputeTimerRef.current);
        ringRecomputeTimerRef.current = null;
      }
      liveRingPollStopRef.current?.();
      liveRingPollStopRef.current = null;
      liveRingPollingStartedRef.current = false;
      claimRingTimersRef.current.forEach((timer) => clearTimeout(timer));
      claimRingTimersRef.current = [];
    };
  }, [applyScheduleRings, scheduleClaimRingSync, refreshChurchLiveAndRings, startLiveRingPolling]);

  useFocusEffect(
    useCallback(() => {
      if (!liveRingPollingStartedRef.current) return;

      const tab = String(segments[1] || "index");
      if (tab === "more") {
        return;
      }

      let cancelled = false;
      const frame = requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          if (!cancelled) {
            void refreshChurchLiveAndRings("focus");
          }
        });
      });

      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    }, [refreshChurchLiveAndRings, segments.join("/")])
  );

  useEffect(() => {
    if (!backendChurchLive?.isLive && !mediaScheduleTabLive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(churchLivePulse, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(churchLivePulse, { toValue: 0, duration: 850, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [backendChurchLive?.isLive, mediaScheduleTabLive, churchLivePulse]);

  const churchIsLive =
    (
      backendChurchLive?.isLive === true &&
      !backendChurchLive?.endedAt &&
      String(backendChurchLive?.liveId || "").trim().length > 0
    ) ||
    !!mediaScheduleTabLive;

  const churchLiveColor = String(mediaScheduleTabLive?.color || "#EF4444");
  const churchTabTitle = churchIsLive ? "LIVE" : churchTitle;
  const showMoreTabShell = isMoreTabShellVisible();
  const hasPersonalScheduleTabRing = !!personalScheduleTabAlert;
  const showProfileAvatarIcon = !isMessagesMode || hasPersonalScheduleTabRing;

  const profileTabScreenOptions = useMemo(
    () => ({
      title: hasPersonalScheduleTabRing ? "" : profileTitle,
      tabBarLabel: hasPersonalScheduleTabRing ? "" : profileTitle,
      tabBarButton: isMessagesMode
        ? undefined
        : ({ children }: any) => (
            <Pressable
              onPress={() => router.replace("/(tabs)/profile" as any)}
              onLongPress={() => {
                if (!personalScheduleTabAlert) {
                  console.log("KRISTO_LIVE_RING_LONG_PRESS_BLOCKED", {
                    tab: "profile",
                    reason: "no_personal_ring_alert",
                  });
                  return;
                }
                openPersonalScheduleAlert();
              }}
              delayLongPress={LIVE_RING_LONG_PRESS_MS}
              style={{
                flex: 1,
                height: 70,
                alignItems: "center",
                justifyContent: "center",
                paddingTop: 6,
                paddingBottom: 12,
              }}
            >
              {children}
            </Pressable>
          ),
      tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) =>
        showProfileAvatarIcon ? (
          <ProfileAvatarIcon
            focused={focused}
            alertColor={personalScheduleTabAlert?.color}
            alertIcon={personalScheduleTabAlert?.icon}
            alertKind={personalScheduleTabAlert?.match}
            hasPersonal={hasPersonalScheduleTabRing}
            ringVisible={
              personalScheduleTabAlert?.match === "claimed" &&
              !!personalScheduleTabAlert?.color
            }
            userId={String(session?.userId || "")}
          />
        ) : (
          <Ionicons name="call" color={color} size={size ?? 22} />
        ),
    }),
    [
      hasPersonalScheduleTabRing,
      profileTitle,
      isMessagesMode,
      showProfileAvatarIcon,
      personalScheduleTabAlert,
      session?.userId,
      router,
    ]
  );

  return (
    <>
      <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarStyle: hideTabBar
          ? { display: "none" }
          : homeFeedPremium.tabBarSolid,
        tabBarActiveTintColor: GOLD,
        tabBarInactiveTintColor: MUTED,
        tabBarLabelStyle: { fontWeight: "800", fontSize: 11, paddingBottom: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: homeTitle,
          tabBarButton: isMessagesMode
            ? () => (
                <MessagesModeTabButton
                  label={homeTitle}
                  icon="chatbubble-ellipses"
                  active={activeMessagesTab === "chat"}
                  onPress={() => router.replace("/more/my-church-room/messages" as any)}
                />
              )
            : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name={isMessagesMode ? "chatbubble-ellipses" : "home"}
              color={color}
              size={size ?? 22}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="more"
        options={{
          title: moreTitle,
          tabBarButton: isMessagesMode
            ? () => (
                <MessagesModeTabButton
                  label={moreTitle}
                  icon="people"
                  active={activeMessagesTab === "ministry"}
                  onPress={() => router.replace("/more/my-church-room/ministry" as any)}
                />
              )
            : ({ children, onPress: _defaultOnPress, ...rest }: any) => (
                <Pressable
                  {...rest}
                  onPress={() => {
                    beginMoreTabPressTransition();
                    router.replace("/(tabs)/more" as any);
                  }}
                  style={{
                    flex: 1,
                    height: 70,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingTop: 6,
                    paddingBottom: 12,
                  }}
                >
                  {children}
                </Pressable>
              ),
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name={isMessagesMode ? "people" : "grid"}
              color={color}
              size={size ?? 22}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="church"
        options={{
          title: churchTabTitle,
          tabBarButton: ({ children }: any) => (
            <Pressable
              onLongPress={() => {
                const gestureAt = Date.now();
                console.log("KRISTO_LIVE_RING_GESTURE_DETECTED", {
                  tab: "church",
                  trigger: "longPress",
                  delayLongPressMs: LIVE_RING_LONG_PRESS_MS,
                  at: gestureAt,
                });

                if (!churchIsLive) {
                  console.log("KRISTO_LIVE_RING_LONG_PRESS_BLOCKED", {
                    tab: "church",
                    reason: "church_tab_not_live",
                    sinceGestureMs: 0,
                  });
                  return;
                }

                openChurchLiveAsViewer("longPress", gestureAt);
              }}
              delayLongPress={LIVE_RING_LONG_PRESS_MS}
              onPress={async () => {
                if (isMessagesMode) {
                  pauseHomeFeedBackgroundWorkForLiveNavigation("live-ring-messages-tab");
                  router.replace("/more/my-church-room/messages/live-room" as any);
                  return;
                }

                // LIVE room opens only on long press (red ring).
                if (!hasChurch) {
                  await ensureChurchAccessOrSetup({
                    session,
                    setSession,
                    showSetupAlert: true,
                    onChurchReady: () => {
                      router.replace("/(tabs)/church/overview" as any);
                    },
                    onNavigateToSetup: () => {
                      router.replace("/more/church" as any);
                    },
                  });
                  return;
                }

                router.replace("/(tabs)/church/overview" as any);
              }}
              style={{
                flex: 1,
                height: 70,
                alignItems: "center",
                justifyContent: "center",
                paddingTop: 6,
                paddingBottom: 12,
                opacity: !isMessagesMode && !hasChurch ? 0.55 : 1,
              }}
            >
              {children}
            </Pressable>
          ),
          tabBarIcon: ({ focused }) =>
            isMessagesMode ? (
              <Ionicons name="radio" color={focused ? GOLD : MUTED} size={22} />
            ) : (
              <ChurchLiveTabIcon focused={focused} isLive={churchIsLive} pulse={churchLivePulse} liveColor={churchLiveColor} />
            ),
        }}
      />

      <Tabs.Screen name="profile" options={profileTabScreenOptions} />

      <Tabs.Screen name="_ministry_hidden/index" options={{ href: null }} />
    </Tabs>
    {showMoreTabShell ? (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: MORE_SHELL_BG, zIndex: 2 }]}
      />
    ) : null}
    </>
  );
}
