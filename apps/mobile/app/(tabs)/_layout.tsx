import { Tabs, useGlobalSearchParams, useSegments, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { silentPreloadTabScreens } from "@/src/lib/screenDataCache";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { apiGet } from "@/src/lib/kristoApi";
import { subscribe as subscribeHomeFeed } from "@/src/lib/homeFeedStore";
import { buildLiveRoomAuthorityParams } from "@/src/lib/liveMediaAuthority";
import {
  RING_RECOMPUTE_INTERVAL_MS,
  recomputeScheduleRingsFromRows,
} from "@/src/lib/liveScheduleRing";
import { onClaimUpdated, type ClaimUpdatedPayload } from "@/src/lib/kristoProfileEvents";
import { Alert, Animated, Pressable, Text, View } from "react-native";
import { fetchLightLiveState, startAdaptiveLivePolling } from "@/src/lib/liveRealtime";

const VIP_BG = "#0B0F17";
const VIP_BORDER = "rgba(255,255,255,0.10)";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.55)";
const TAB_BG = "rgba(8,12,20,0.96)";
const TAB_BORDER = "rgba(255,255,255,0.05)";


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
            width: 42,
            height: 42,
            borderRadius: 999,
            backgroundColor: "rgba(217,179,95,0.14)",
            shadowColor: GOLD,
            shadowOpacity: 0.55,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
            elevation: 8,
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
}: {
  focused: boolean;
  alertColor?: string;
  alertIcon?: keyof typeof Ionicons.glyphMap;
}) {
  const hasAlert = !!alertColor;
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
  const { session, loading } = useKristoSession();

  useEffect(() => {
    if (loading || !session?.userId) return;
    void silentPreloadTabScreens(session);
  }, [loading, session?.userId, session?.churchId]);

  useEffect(() => {
    if (loading || !session?.userId) return;
    const tab = String(segments[1] || "index");
    if (tab === "index") {
      void silentPreloadTabScreens(session);
    }
  }, [loading, session, segments.join("/")]);

  function openPersonalScheduleAlert() {
    const alert = personalScheduleTabAlert;
    if (!alert?.item || !alert?.slot) return false;

    const item = alert.item || {};
    const slot = alert.slot || {};
    const claimedByMe = String(alert?.match || "") === "claimed";
    const isLiveNow = alert?.isLiveNow === true;
    const liveId = String(item?.sourceScheduleId || item?.id || "media-live-default");

    router.replace({
      pathname: "/more/my-church-room/messages/live-room",
      params: {
        source: "media",
        liveMode: "schedule",
        layout: "grid6",
        entryMode: isLiveNow ? "live" : "waiting",
        role: claimedByMe ? "Host" : "Viewer",
        mode: claimedByMe ? "host" : "viewer",
        room: "media",

        mediaName: String(item?.mediaName || item?.actorLabel || "Church Media"),
        churchName: String(item?.churchName || item?.churchLabel || "Church"),
        churchLabel: String(item?.churchName || item?.churchLabel || "Church"),
        churchId: String(item?.churchId || session?.churchId || ""),
        liveId,

        title: String(slot?.name || slot?.slotLabel || item?.title || "Church Live"),
        preferredSlotNumber: String((alert?.index ?? 0) + 1),
        currentSlotNumber: String((alert?.index ?? 0) + 1),
        scheduleStartMs: String(alert?.startMs || ""),
        scheduleEndMs: String(alert?.endMs || ""),

        claimedByUserId: String(slot?.claimedByUserId || ""),
        claimedByName: String(slot?.claimedByName || ""),
        claimedByAvatar: String(slot?.claimedByAvatar || slot?.avatarUri || ""),

        mediaSlotPublisher: claimedByMe ? "1" : "0",
        canPublish: claimedByMe && isLiveNow ? "1" : "0",
        canPublishCamera: claimedByMe && isLiveNow ? "1" : "0",
        canPublishMic: claimedByMe && isLiveNow ? "1" : "0",

        watchScheduledPublisher: claimedByMe ? "1" : "0",
        isGlobalMediaSlot: "1",
        ...buildLiveRoomAuthorityParams(item),
        mediaOwnerPastorUserId: buildLiveRoomAuthorityParams(item).actualChurchPastorUserId,
        mediaHostIds: String(item?.mediaHostIds || item?.hostIds || buildLiveRoomAuthorityParams(item).mediaHostIds || ""),
      },
    } as any);

    return true;
  }

  function openChurchLiveAsViewer() {
    const scheduleAlert = mediaScheduleTabLive;

    if (scheduleAlert?.item && scheduleAlert?.slot) {
      const item = scheduleAlert.item || {};
      const slot = scheduleAlert.slot || {};
      const isLiveNow = scheduleAlert?.isLiveNow === true;
      const liveId = String(item?.sourceScheduleId || item?.id || "media-live-default");
      const allSlots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
      const viewerUserId = String(session?.userId || "").trim();
      const claimedIndex = allSlots.findIndex((s: any) => {
        const raw = s?.claimedBy;
        return (
          String(s?.claimedByUserId || "").trim() === viewerUserId ||
          String(raw && typeof raw === "object" ? raw.userId || "" : "").trim() === viewerUserId
        );
      });
      const userClaimedSlot = claimedIndex >= 0 ? allSlots[claimedIndex] : null;

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
      const routeSlotNumber = userClaimIsCurrentLiveSlot ? claimedIndex + 1 : (scheduleAlert?.index ?? 0) + 1;

      router.replace({
        pathname: "/more/my-church-room/messages/live-room",
        params: {
          source: "media",
          liveMode: "schedule",
          layout: "grid6",
          entryMode: isLiveNow ? "live" : "waiting",
          role: claimedByMe ? "Host" : "Viewer",
          mode: claimedByMe ? "host" : "viewer",
          room: "media",

          mediaName: String(item?.mediaName || item?.actorLabel || "Church Media"),
          churchName: String(item?.churchName || item?.churchLabel || "Church"),
          churchLabel: String(item?.churchName || item?.churchLabel || "Church"),
          churchId: String(item?.churchId || session?.churchId || ""),
          liveId,

          title: String(routeSlot?.name || routeSlot?.slotLabel || item?.title || "Church Live"),
          preferredSlotNumber: String(routeSlotNumber),
          currentSlotNumber: String(routeSlotNumber),
          scheduleStartMs: String(scheduleAlert?.startMs || ""),
          scheduleEndMs: String(scheduleAlert?.endMs || ""),

          claimedByUserId: String(routeSlot?.claimedByUserId || ""),
          claimedByName: String(routeSlot?.claimedByName || ""),
          claimedByAvatar: String(routeSlot?.claimedByAvatar || routeSlot?.avatarUri || ""),

          mediaSlotPublisher: claimedByMe ? "1" : "0",
          canPublish: claimedByMe && isLiveNow ? "1" : "0",
          canPublishCamera: claimedByMe && isLiveNow ? "1" : "0",
          canPublishMic: claimedByMe && isLiveNow ? "1" : "0",

          watchScheduledPublisher: claimedByMe ? "1" : "0",
          isGlobalMediaSlot: "1",
          ...buildLiveRoomAuthorityParams(item),
          mediaOwnerPastorUserId: buildLiveRoomAuthorityParams(item).actualChurchPastorUserId,
          mediaHostIds: String(item?.mediaHostIds || item?.hostIds || buildLiveRoomAuthorityParams(item).mediaHostIds || ""),
        },
      } as any);

      return true;
    }

    const activeChurchLive = backendChurchLive;
    if (!activeChurchLive?.isLive) return false;

    router.replace({
      pathname: "/more/my-church-room/messages/live-room",
      params: {
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
      },
    } as any);

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
  const [backendChurchLive, setBackendChurchLive] = useState<any>(null);
  const [mediaScheduleTabLive, setMediaScheduleTabLive] = useState<any>(null);
  const [personalScheduleTabAlert, setPersonalScheduleTabAlert] = useState<any>(null);
  const churchLivePulse = useRef(new Animated.Value(0)).current;
  const backendFeedRowsRef = useRef<any[]>([]);
  const claimRingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const applyScheduleRings = useCallback(
    (source: string, backendRows: any[] = backendFeedRowsRef.current) => {
      if (!session?.userId) return;

      const { personal, church } = recomputeScheduleRingsFromRows({
        rows: backendRows,
        viewerUserId: String(session.userId || ""),
        viewerChurchId: String(session.churchId || ""),
        source,
      });

      setMediaScheduleTabLive(church);
      setPersonalScheduleTabAlert(personal);
    },
    [session?.userId, session?.churchId]
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

  useEffect(() => {
    applyScheduleRings("mount");
    const unsubFeed = subscribeHomeFeed(() => applyScheduleRings("feed"));
    const unsubClaim = onClaimUpdated((payload) => scheduleClaimRingSync(payload));
    const fastTimer = setInterval(() => applyScheduleRings("timer"), RING_RECOMPUTE_INTERVAL_MS);

    return () => {
      unsubFeed();
      unsubClaim();
      clearInterval(fastTimer);
      claimRingTimersRef.current.forEach((timer) => clearTimeout(timer));
      claimRingTimersRef.current = [];
    };
  }, [applyScheduleRings, scheduleClaimRingSync]);

  useFocusEffect(
    useCallback(() => {
      applyScheduleRings("focus");
    }, [applyScheduleRings])
  );

  useEffect(() => {
    let alive = true;

    async function loadChurchLive() {
      if (!session?.userId || !session?.churchId) return;

      const headers = getKristoHeaders({
        userId: session.userId,
        role: (session.role || "Member") as any,
        churchId: session.churchId || "",
      });

      try {
        const patch = await fetchLightLiveState(headers as any, "TabLayout");
        if (alive) {
          const nextLive =
            patch.isLive === true && patch.raw && !patch.raw?.endedAt ? patch.raw : null;
          setBackendChurchLive(nextLive);
        }
      } catch {}

      try {
        const feedRes: any = await apiGet(
          "/api/church/feed",
          { headers },
          { screen: "TabLayout", throttleMs: 120000 }
        );
        const rows: any[] =
          Array.isArray(feedRes?.data?.items) ? feedRes.data.items :
          Array.isArray(feedRes?.data) ? feedRes.data :
          Array.isArray(feedRes?.items) ? feedRes.items :
          Array.isArray(feedRes) ? feedRes : [];

        backendFeedRowsRef.current = rows;
        if (alive) applyScheduleRings("backend-feed", rows);
      } catch {
        if (alive) applyScheduleRings("backend-feed-error");
      }
    }

    void loadChurchLive();

    const stop = startAdaptiveLivePolling({
      screen: "TabLayout",
      activeMs: 60000,
      idleMs: 120000,
      onTick: loadChurchLive,
    });

    return () => {
      alive = false;
      stop();
    };
  }, [session?.userId, session?.churchId, session?.role, applyScheduleRings]);

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

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarStyle: hideTabBar
          ? { display: "none" }
          : {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: TAB_BG,
              borderTopColor: TAB_BORDER,
              borderTopWidth: 1,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.05)",
              height: 70,
              paddingTop: 6,
              paddingBottom: 12,
              borderRadius: 0,
              elevation: 6,
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: -10 },
            },
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
            : ({ children }: any) => (
                <Pressable
                  onPress={() => router.replace("/(tabs)/more" as any)}
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
        
        listeners={{
          tabPress: (e) => {
            if (churchIsLive && openChurchLiveAsViewer()) {
              e.preventDefault();
            }
          },
        }}
        options={{
          title: churchTabTitle,
          tabBarButton: ({ children }: any) => (
            <Pressable
              onLongPress={() => {
                if (churchIsLive) {
                  openChurchLiveAsViewer();
                }
              }}
              delayLongPress={280}
              onPress={() => {
                if (isMessagesMode) {
                  router.replace("/more/my-church-room/messages/live-room" as any);
                  return;
                }

                // LIVE room opens only by long press.
                // Normal tap should still go to Church overview.
                if (!hasChurch) {
                  Alert.alert(
                    "Church locked",
                    "Session bado haina churchId. Rudi Me → Invitations → Accept invite tena, au logout/login ili session isome membership mpya."
                  );
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

      <Tabs.Screen
        name="profile"
        options={{
          title: personalScheduleTabAlert ? "" : profileTitle,
          tabBarLabel: personalScheduleTabAlert ? "" : profileTitle,
          tabBarButton: isMessagesMode
            ? undefined
            : ({ children }: any) => (
                <Pressable
                  onPress={() => router.replace("/(tabs)/profile" as any)}
                  onLongPress={() => {
                    if (personalScheduleTabAlert) {
                      openPersonalScheduleAlert();
                    }
                  }}
                  delayLongPress={280}
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
          tabBarIcon: ({ focused, color, size }) =>
            isMessagesMode ? (
              <Ionicons
                name="call"
                color={color}
                size={size ?? 22}
              />
            ) : (
              <ProfileAvatarIcon focused={focused} alertColor={personalScheduleTabAlert?.color} alertIcon={personalScheduleTabAlert?.icon} />
            ),
        }}
      />

      <Tabs.Screen name="_ministry_hidden/index" options={{ href: null }} />
    </Tabs>
  );
}
