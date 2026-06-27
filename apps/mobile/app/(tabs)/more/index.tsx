import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
  Modal,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { preloadTlmcAssets } from "@/src/lib/tlmcPreload";
import { preloadMediaAssets } from "@/src/lib/mediaPreload";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { resolveSessionChurchId } from "@/src/lib/churchStore";
import { isPastorSessionRole } from "@/src/lib/churchSubscription";
import {
  logMoreMediaCardGate,
  shouldShowMoreMediaCard,
  type ChurchMediaAccessState,
} from "@/src/lib/churchMediaAccess";
import {
  getCachedChurchMediaAccess,
  refreshChurchMediaAccess,
  runAfterMoreTabPressTransition,
  subscribeChurchMediaAccess,
} from "@/src/lib/refreshCoordinator";
import { canUseChurchAdminNotificationScope } from "@/src/lib/notificationDisplay";
import {
  fetchNotificationCardUnreadCount,
  setCardUnreadFromFetchResult,
} from "@/src/lib/churchNotificationsApi";
import {
  getOfflineActivationMoreItems,
  logOfflineActivationMoreCardVisibility,
} from "@/src/lib/offlineActivationCodes";
import { SupervisorInvitationCard } from "@/src/components/offlineActivation/SupervisorInvitationCard";

const MEDIA_HREF = "/more/media";
const CHURCH_GATE_HREF = "/more/church";

type Item = {
  key: string;
  title: string;
  sub: string;
  iconLib: "ion" | "mci";
  icon: any;
  href: string;
};

const ITEMS: Item[] = [
  {
    key: "tlmc",
    title: "TLMC",
    sub: "The Last Mission of Christ",
    iconLib: "ion",
    icon: "sparkles",
    href: "/more/tlmc",
  },
  {
    key: "ministries",
    title: "Ministries",
    sub: "List • create • members",
    iconLib: "ion",
    icon: "people",
    href: "/more/ministries",
  },

  {
    key: "notifications",
    title: "Notifications",
    sub: "All alerts",
    iconLib: "ion",
    icon: "notifications",
    href: "/more/notifications",
  },
  {
    key: "messages",
    title: "Messages",
    sub: "Church room • threads",
    iconLib: "ion",
    icon: "chatbubble-ellipses",
    href: "/more/my-church-room/messages",
  },
  {
    key: "payments",
    title: "Payments",
    sub: "Subscriptions • donations • premium live",
    iconLib: "ion",
    icon: "card",
    href: "/more/payments",
  },
  {
    key: "media",
    title: "Media",
    sub: "Studio • live • videos • global feed",
    iconLib: "ion",
    icon: "videocam",
    href: "/more/media",
  },
  {
    key: "live_slots",
    title: "Live Slots",
    sub: "Claim • schedule • go live",
    iconLib: "ion",
    icon: "radio",
    href: "/more/live-slots",
  },
  {
    key: "kristo_guide",
    title: "Kr. Guide",
    sub: "Rules • Safety • Help",
    iconLib: "ion",
    icon: "book-outline",
    href: "/more/kristo-guide",
  },
  {
    key: "church",
    title: "Church",
    sub: "Create • Join (unlock Church tab)",
    iconLib: "mci",
    icon: "church",
    href: "/more/church",
  },

  {
    key: "my_church_room",
    title: "My Church Room",
    sub: "Room • posts • members",
    iconLib: "mci",
    icon: "home",
    href: "/more/my-church-room",
  },
  {
    key: "bible",
    title: "Bible",
    sub: "Daily verses & reading",
    iconLib: "mci",
    icon: "book-cross",
    href: "/more/bible",
  },

  {
    key: "testimony",
    title: "Giving",
    sub: "Tithes • offerings • support",
    iconLib: "mci",
    icon: "account-voice",
    href: "/more/testimony",
  },
  {
    key: "courtship",
    title: "Courtship",
    sub: "TLMC Courtship",
    iconLib: "ion",
    icon: "heart",
    href: "/more/courtship",
  },
];

const NO_CHURCH_ONBOARDING_ORDER = [
  "tlmc",
  "church",
  "kristo_guide",
  "notifications",
  "courtship",
  "bible",
] as const;

const NO_CHURCH_ITEM_OVERRIDES: Partial<Record<string, Partial<Item>>> = {
  church: {
    sub: "Create or join your church",
    href: CHURCH_GATE_HREF,
  },
  courtship: {
    sub: "Family • faith • future",
  },
  bible: {
    sub: "Read • study • grow",
  },
};

function buildNoChurchOnboardingItems() {
  const itemByKey = new Map(ITEMS.map((item) => [item.key, item]));
  return NO_CHURCH_ONBOARDING_ORDER.map((key) => {
    const base = itemByKey.get(key);
    if (!base) return null;
    const override = NO_CHURCH_ITEM_OVERRIDES[key];
    return override ? { ...base, ...override } : { ...base };
  }).filter((item): item is Item => !!item);
}

const V2_COMING_SOON_COPY: Partial<Record<string, { title: string; text: string }>> = {
  bible: {
    title: "Bible coming in V2",
    text:
      "Kristo Bible V2 is being prepared with a stronger experience, smarter tools, and advanced community systems.",
  },
  courtship: {
    title: "Courtship coming in V2",
    text:
      "Kristo Courtship V2 is being prepared with guided relationships, family tools, and faith-centered features.",
  },
};

function splitColumns(items: Item[]) {
  return {
    left: items.filter((_, i) => i % 2 === 0),
    right: items.filter((_, i) => i % 2 === 1),
  };
}

function MediaAccessSkeletonCard() {
  return (
    <View style={[s.tileWrap, s.skeletonTile, { width: CARD_W, height: CARD_H }]}>
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(26,10,18,0.98)", "rgba(16,8,12,0.97)", "rgba(9,5,7,0.96)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.skeletonIcon} />
      <View style={s.skeletonLineWide} />
      <View style={s.skeletonLineNarrow} />
    </View>
  );
}

const GAP = 18;
const PAD = 16;
const CARD_H = 240;
const TAB_BAR_HEIGHT = 72;
const SCROLL_EXTRA_CLEARANCE = 88;
const { width } = Dimensions.get("window");
const CARD_W = Math.floor((width - PAD * 2 - GAP) / 2);

type CardSurface = {
  base: [string, string, string];
  tint: [string, string, string];
  sheen: [string, string, string];
  glowColor: string;
  shadowColor: string;
};

function getMoreCardToneKey(key: string): string {
  if (key === "system_admin") return "church";
  if (key === "supervisor") return "notifications";
  if (key === "agent") return "kristo_guide";
  return key;
}

function getCardSurface(key: string): CardSurface {
  const toneKey = getMoreCardToneKey(key);
  if (toneKey === "tlmc") {
    return {
      base: ["rgba(22,16,52,0.98)", "rgba(12,9,28,0.99)", "rgba(7,6,18,0.99)"],
      tint: ["rgba(108,78,255,0.24)", "rgba(217,179,95,0.10)", "transparent"],
      sheen: ["rgba(255,255,255,0.16)", "rgba(148,128,255,0.10)", "transparent"],
      glowColor: "rgba(126,102,255,0.30)",
      shadowColor: "#6C4EFF",
    };
  }
  if (toneKey === "ministries" || toneKey === "my_church_room") {
    return {
      base: ["rgba(28,22,12,0.98)", "rgba(14,11,7,0.96)", "rgba(8,7,5,0.94)"],
      tint: ["rgba(236,202,112,0.16)", "rgba(217,179,95,0.06)", "transparent"],
      sheen: ["rgba(255,255,255,0.16)", "rgba(217,179,95,0.12)", "transparent"],
      glowColor: "rgba(236,202,112,0.22)",
      shadowColor: "#D9B35F",
    };
  }
  if (toneKey === "notifications" || toneKey === "messages") {
    return {
      base: ["rgba(10,18,36,0.98)", "rgba(8,14,28,0.97)", "rgba(5,9,18,0.96)"],
      tint: ["rgba(96,152,255,0.16)", "rgba(0,145,255,0.06)", "transparent"],
      sheen: ["rgba(255,255,255,0.14)", "rgba(132,198,255,0.10)", "transparent"],
      glowColor: "rgba(96,152,255,0.24)",
      shadowColor: "#5A9CFF",
    };
  }
  if (toneKey === "church") {
    return {
      base: ["rgba(18,12,38,0.98)", "rgba(12,8,26,0.97)", "rgba(7,5,16,0.96)"],
      tint: ["rgba(156,118,255,0.18)", "rgba(217,179,95,0.08)", "transparent"],
      sheen: ["rgba(255,255,255,0.14)", "rgba(198,166,255,0.10)", "transparent"],
      glowColor: "rgba(156,118,255,0.26)",
      shadowColor: "#9C76FF",
    };
  }
  if (toneKey === "bible") {
    return {
      base: ["rgba(8,22,18,0.98)", "rgba(6,16,13,0.97)", "rgba(4,10,8,0.96)"],
      tint: ["rgba(84,196,146,0.16)", "rgba(64,150,126,0.06)", "transparent"],
      sheen: ["rgba(255,255,255,0.14)", "rgba(120,224,178,0.10)", "transparent"],
      glowColor: "rgba(84,196,146,0.22)",
      shadowColor: "#54C492",
    };
  }
  if (toneKey === "kristo_guide") {
    return {
      base: ["rgba(6,22,24,0.98)", "rgba(5,18,20,0.97)", "rgba(3,12,14,0.96)"],
      tint: ["rgba(45,212,191,0.18)", "rgba(20,184,166,0.08)", "transparent"],
      sheen: ["rgba(255,255,255,0.14)", "rgba(94,234,212,0.12)", "transparent"],
      glowColor: "rgba(45,212,191,0.24)",
      shadowColor: "#2DD4BF",
    };
  }
  if (toneKey === "courtship") {
    return {
      base: ["rgba(28,10,22,0.98)", "rgba(18,8,14,0.97)", "rgba(10,5,8,0.96)"],
      tint: ["rgba(248,132,182,0.16)", "rgba(176,92,132,0.06)", "transparent"],
      sheen: ["rgba(255,255,255,0.14)", "rgba(255,154,196,0.10)", "transparent"],
      glowColor: "rgba(248,132,182,0.22)",
      shadowColor: "#F884B6",
    };
  }
  if (toneKey === "live_slots") {
    return {
      base: ["rgba(28,10,18,0.98)", "rgba(16,8,12,0.97)", "rgba(9,5,7,0.96)"],
      tint: ["rgba(255,90,122,0.16)", "rgba(176,92,118,0.06)", "transparent"],
      sheen: ["rgba(255,255,255,0.14)", "rgba(255,158,210,0.10)", "transparent"],
      glowColor: "rgba(255,90,122,0.24)",
      shadowColor: "#FF5A7A",
    };
  }
  if (toneKey === "testimony" || toneKey === "payments" || toneKey === "media") {
    return {
      base: ["rgba(26,10,18,0.98)", "rgba(16,8,12,0.97)", "rgba(9,5,7,0.96)"],
      tint: ["rgba(228,120,176,0.16)", "rgba(156,86,118,0.06)", "transparent"],
      sheen: ["rgba(255,255,255,0.14)", "rgba(255,158,210,0.10)", "transparent"],
      glowColor: "rgba(228,120,176,0.22)",
      shadowColor: "#E478B0",
    };
  }
  return {
    base: ["rgba(16,18,28,0.98)", "rgba(10,12,20,0.97)", "rgba(6,7,14,0.96)"],
    tint: ["rgba(255,255,255,0.06)", "transparent", "transparent"],
    sheen: ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.04)", "transparent"],
    glowColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000000",
  };
}

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const hasChurch = Boolean(
    resolveSessionChurchId(session?.churchId || (session as any)?.activeChurchId || "")
  );

  const isPastor = React.useMemo(
    () =>
      isPastorSessionRole(session?.role) ||
      isPastorSessionRole((session as any)?.churchRole),
    [session]
  );

  const [mediaAccess, setMediaAccess] = React.useState<ChurchMediaAccessState | null>(() =>
    getCachedChurchMediaAccess()
  );
  const [mediaAccessLoading, setMediaAccessLoading] = React.useState(false);

  const canShowMediaCard = React.useMemo(
    () =>
      shouldShowMoreMediaCard({
        hasChurch,
        isPastor,
        access: mediaAccess,
      }),
    [hasChurch, isPastor, mediaAccess]
  );

  const showMediaAccessSkeleton = React.useMemo(
    () =>
      hasChurch &&
      !isPastor &&
      mediaAccessLoading &&
      !canShowMediaCard,
    [hasChurch, isPastor, mediaAccessLoading, canShowMediaCard]
  );

  const offlineActivationItems = React.useMemo((): Item[] => {
    const platformRole = String(
      (session as any)?.platformRole || (session as any)?.offlineActivationRole || ""
    );
    return getOfflineActivationMoreItems(platformRole).map(({ requiredRole: _ignored, ...item }) => item);
  }, [session?.platformRole, (session as any)?.offlineActivationRole]);

  const visibleItems = React.useMemo(() => {
    let base = hasChurch ? ITEMS : buildNoChurchOnboardingItems();
    if (!isPastor) {
      base = base.filter((item) => item.key !== "payments");
    }
    if (!canShowMediaCard) {
      base = base.filter((item) => item.key !== "media");
    }
    return [...base, ...offlineActivationItems];
  }, [hasChurch, isPastor, canShowMediaCard, offlineActivationItems]);

  const { left: leftItems, right: rightItems } = React.useMemo(
    () => splitColumns(visibleItems),
    [visibleItems]
  );

  const [messagesV2Open, setMessagesV2Open] = React.useState(false);
  const [notificationUnread, setNotificationUnread] = React.useState(0);
  const [v2FeatureTitle, setV2FeatureTitle] = React.useState("Messages");
  const [v2ModalTitle, setV2ModalTitle] = React.useState("Messages coming in V2");
  const [v2ModalText, setV2ModalText] = React.useState("");
  const v2CardAnim = React.useRef(new Animated.Value(0)).current;
  const mediaOpenRef = React.useRef(false);

  const resolveMediaAccessIdentity = React.useCallback(() => {
    const churchId = resolveSessionChurchId(
      session?.churchId || (session as any)?.activeChurchId || ""
    );
    const userId = String(session?.userId || "").trim();
    return { churchId, userId };
  }, [session]);

  const openMediaScreen = React.useCallback(() => {
    if (mediaOpenRef.current) return;
    mediaOpenRef.current = true;
    router.push(MEDIA_HREF as any);
  }, [router]);

  const runMoreDeferredAssetWarmup = React.useCallback(() => {
    void preloadTlmcAssets();
    void preloadMediaAssets();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      const churchId = resolveSessionChurchId(
        session?.churchId || (session as any)?.activeChurchId || ""
      );
      const userId = String(session?.userId || "").trim();
      const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
      const role = String(session?.role || "Member");
      if (!churchId || !userId || !base) {
        setNotificationUnread(0);
        return;
      }

      const controller = new AbortController();
      void fetchNotificationCardUnreadCount({
        base,
        canUseChurchAdmin: canUseChurchAdminNotificationScope(role),
        signal: controller.signal,
      })
        .then((result) => {
          setCardUnreadFromFetchResult(result);
          setNotificationUnread(result.totalUnread);
        })
        .catch(() => {
          // Keep the last known badge count on transient failures.
        });

      return () => {
        controller.abort();
      };
    }, [session?.churchId, session?.userId, session?.role, session])
  );

  useFocusEffect(
    React.useCallback(() => {
      const platformRole = String(
        (session as any)?.platformRole || (session as any)?.offlineActivationRole || ""
      );
      const userId = String(session?.userId || "").trim();
      logOfflineActivationMoreCardVisibility(platformRole, userId);
    }, [session?.platformRole, (session as any)?.offlineActivationRole, session?.userId])
  );

  React.useEffect(() => {
    if (!hasChurch) {
      setMediaAccess(null);
      setMediaAccessLoading(false);
    }
  }, [hasChurch]);

  React.useEffect(() => {
    return subscribeChurchMediaAccess((access) => {
      setMediaAccess(access);
    });
  }, []);

  React.useEffect(() => {
    if (!hasChurch || mediaAccessLoading) return;

    const { churchId, userId } = resolveMediaAccessIdentity();
    if (!churchId || !userId) return;

    logMoreMediaCardGate({
      userId,
      churchId,
      isPastor,
      viewerIsHost: mediaAccess?.isMediaHost === true,
      canAccessChurchMedia: mediaAccess?.canAccessChurchMedia === true,
      canOpenMediaScreen: mediaAccess?.canOpenMediaScreen === true,
      canUseMediaTools: mediaAccess?.canUseMediaTools === true,
      showMediaCard: canShowMediaCard,
    });
  }, [
    hasChurch,
    isPastor,
    mediaAccess,
    mediaAccessLoading,
    canShowMediaCard,
    resolveMediaAccessIdentity,
  ]);

  useFocusEffect(
    React.useCallback(() => {
      mediaOpenRef.current = false;

      const { churchId, userId } = resolveMediaAccessIdentity();
      if (!hasChurch || !churchId || !userId) {
        return () => {};
      }

      setMediaAccessLoading(true);

      runAfterMoreTabPressTransition(() => {
        void refreshChurchMediaAccess({
          userId,
          churchId,
          role: session?.role,
          churchRole: (session as any)?.churchRole,
          force: true,
        })
          .then((access) => {
            setMediaAccess(access);
          })
          .finally(() => {
            setMediaAccessLoading(false);
          });

        runMoreDeferredAssetWarmup();
      });

      return () => {};
    }, [hasChurch, resolveMediaAccessIdentity, session?.role, session, runMoreDeferredAssetWarmup])
  );

  React.useEffect(() => {
    if (!messagesV2Open) return;

    v2CardAnim.setValue(0);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v2CardAnim, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(v2CardAnim, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();

    return () => loop.stop();
  }, [messagesV2Open, v2CardAnim]);

  const scrollBottomPad = insets.bottom + TAB_BAR_HEIGHT + SCROLL_EXTRA_CLEARANCE;

  const openV2ComingSoonModal = React.useCallback((item: Item) => {
    const customCopy = V2_COMING_SOON_COPY[item.key];
    setV2FeatureTitle(item.title);
    setV2ModalTitle(customCopy?.title || `${item.title} coming in V2`);
    setV2ModalText(
      customCopy?.text ||
        `Kristo ${item.title} V2 is being prepared with a stronger experience, smarter tools, and advanced community systems.`
    );
    setMessagesV2Open(true);
  }, []);

  const renderCard = (item: Item) => {
    const isTlmc = item.key === "tlmc";
    const isChurchGate = !hasChurch && item.key === "church";
    const itemTitle = item.title;
    const itemSub =
      item.key === "notifications" && notificationUnread > 0
        ? `${notificationUnread} unread`
        : item.sub;

    const toneKey = getMoreCardToneKey(item.key);

    const wrapTone =
      toneKey === "ministries"
        ? [s.tileGold, s.tileMinistriesWrap]
        : toneKey === "notifications" || toneKey === "messages"
        ? [s.tileBlue, s.tileNotificationsWrap]
        : toneKey === "church"
        ? [s.tilePurple, s.tileChurchWrap]
        : toneKey === "my_church_room"
        ? [s.tileGoldStrong, s.tileRoomWrap]
        : toneKey === "bible" || toneKey === "kristo_guide"
        ? toneKey === "kristo_guide"
          ? [s.tileTeal, s.tileTariffWrap]
          : [s.tileEmerald, s.tileBibleWrap]
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? [s.tileRose, s.tileGivingWrap]
        : toneKey === "courtship"
        ? [s.tilePink, s.tileCourtshipWrap]
        : null;

    const innerTone =
      toneKey === "ministries"
        ? [s.tileInnerGold, s.tileInnerMinistries]
        : toneKey === "notifications" || toneKey === "messages"
        ? [s.tileInnerBlue, s.tileInnerNotifications]
        : toneKey === "church"
        ? [s.tileInnerPurple, s.tileInnerChurch]
        : toneKey === "my_church_room"
        ? [s.tileInnerAmber, s.tileInnerRoom]
        : toneKey === "bible" || toneKey === "kristo_guide"
        ? toneKey === "kristo_guide"
          ? [s.tileInnerTeal, s.tileInnerTariff]
          : [s.tileInnerEmerald, s.tileInnerBible]
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? [s.tileInnerRose, s.tileInnerGiving]
        : toneKey === "courtship"
        ? [s.tileInnerPink, s.tileInnerCourtship]
        : null;

    const iconTone =
      toneKey === "ministries"
        ? s.iconPillGold
        : toneKey === "notifications" || toneKey === "messages"
        ? s.iconPillBlue
        : toneKey === "church"
        ? s.iconPillPurple
        : toneKey === "my_church_room"
        ? s.iconPillAmber
        : toneKey === "bible" || toneKey === "kristo_guide"
        ? toneKey === "kristo_guide"
          ? s.iconPillTeal
          : s.iconPillEmerald
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.iconPillRose
        : toneKey === "courtship"
        ? s.iconPillPink
        : null;

    const arrowTone =
      toneKey === "ministries"
        ? s.arrowPillGold
        : toneKey === "notifications" || toneKey === "messages"
        ? s.arrowPillBlue
        : toneKey === "church"
        ? s.arrowPillPurple
        : toneKey === "my_church_room"
        ? s.arrowPillAmber
        : toneKey === "bible" || toneKey === "kristo_guide"
        ? null
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.arrowPillRose
        : toneKey === "courtship"
        ? s.arrowPillPink
        : null;

    const titleTone =
      toneKey === "ministries"
        ? s.tileTitleGold
        : toneKey === "notifications" || toneKey === "messages"
        ? s.tileTitleBlue
        : toneKey === "church"
        ? s.tileTitlePurple
        : toneKey === "my_church_room"
        ? s.tileTitleAmber
        : toneKey === "bible"
        ? s.tileTitleEmerald
        : toneKey === "kristo_guide"
        ? s.tileTitleTeal
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.tileTitleRose
        : toneKey === "courtship"
        ? s.tileTitlePink
        : null;

    const subTone =
      toneKey === "ministries"
        ? s.tileSubGold
        : toneKey === "notifications" || toneKey === "messages"
        ? s.tileSubBlue
        : toneKey === "church"
        ? s.tileSubPurple
        : toneKey === "my_church_room"
        ? s.tileSubAmber
        : toneKey === "bible"
        ? s.tileSubEmerald
        : toneKey === "kristo_guide"
        ? s.tileSubTeal
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.tileSubRose
        : toneKey === "courtship"
        ? s.tileSubPink
        : null;

    const hintTone =
      toneKey === "ministries"
        ? s.tapHintGold
        : toneKey === "notifications" || toneKey === "messages"
        ? s.tapHintBlue
        : toneKey === "church"
        ? s.tapHintPurple
        : toneKey === "my_church_room"
        ? s.tapHintAmber
        : toneKey === "bible"
        ? s.tapHintEmerald
        : toneKey === "kristo_guide"
        ? s.tapHintTeal
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.tapHintRose
        : toneKey === "courtship"
        ? s.tapHintPink
        : null;

    const premiumWrapTone =
      toneKey === "ministries"
        ? s.tileMinistriesWrap
        : toneKey === "notifications" || toneKey === "messages"
        ? s.tileNotificationsWrap
        : toneKey === "church"
        ? s.tileChurchWrap
        : toneKey === "my_church_room"
        ? s.tileRoomWrap
        : toneKey === "bible"
        ? s.tileBibleWrap
        : toneKey === "kristo_guide"
        ? s.tileTariffWrap
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.tileGivingWrap
        : toneKey === "courtship"
        ? s.tileCourtshipWrap
        : null;

    const premiumInnerTone =
      toneKey === "ministries"
        ? s.tileInnerMinistries
        : toneKey === "notifications" || toneKey === "messages"
        ? s.tileInnerNotifications
        : toneKey === "church"
        ? s.tileInnerChurch
        : toneKey === "my_church_room"
        ? s.tileInnerRoom
        : toneKey === "bible"
        ? s.tileInnerBible
        : toneKey === "kristo_guide"
        ? s.tileInnerTariff
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.tileInnerGiving
        : toneKey === "courtship"
        ? s.tileInnerCourtship
        : null;

    const iconSize =
      item.key === "tlmc"
        ? 24
        : toneKey === "church"
        ? 22
        : toneKey === "bible" || toneKey === "kristo_guide"
        ? 22
        : 21;

    const titleLines = item.key === "my_church_room" ? 2 : 1;

    const subLines = 2;

    const titleStyleExtra =
      item.key === "tlmc"
        ? s.tileTitleHero
        : toneKey === "notifications" || toneKey === "messages"
        ? s.tileTitleCompact
        : toneKey === "bible"
        ? s.tileTitleSoft
        : toneKey === "courtship"
        ? s.tileTitleSoft
        : null;

    const subStyleExtra =
      toneKey === "notifications" || toneKey === "messages"
        ? s.tileSubCompact
        : toneKey === "church"
        ? s.tileSubStrong
        : toneKey === "my_church_room"
        ? s.tileSubStrong
        : null;

    const footStyleExtra =
      item.key === "tlmc"
        ? s.tileFootHero
        : toneKey === "notifications" || toneKey === "messages"
        ? s.tileFootCompact
        : null;

    const miniTag =
      item.key === "system_admin"
        ? "Admin"
        : item.key === "supervisor"
        ? "Teams"
        : item.key === "agent"
        ? "Codes"
        : item.key === "tlmc"
        ? "Mission"
        : item.key === "ministries"
        ? "Teams"
        : item.key === "notifications"
        ? "Alerts"
        : item.key === "church"
        ? "Access"
        : item.key === "my_church_room"
        ? "Community"
        : item.key === "bible"
        ? "Word"
        : item.key === "kristo_guide"
        ? "Guide"
        : item.key === "testimony"
        ? "Stories"
        : item.key === "payments"
        ? "Finance"
        : item.key === "media"
        ? "Creator"
        : item.key === "live_slots"
        ? "Live"
        : "Love";

    const miniTagTone =
      toneKey === "tlmc"
        ? s.miniTagTlmc
        : toneKey === "notifications"
        ? s.miniTagBlue
        : toneKey === "church"
        ? s.miniTagPurple
        : toneKey === "my_church_room"
        ? s.miniTagAmber
        : toneKey === "bible"
        ? s.miniTagEmerald
        : toneKey === "kristo_guide"
        ? s.miniTagTeal
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.miniTagRose
        : toneKey === "courtship"
        ? s.miniTagPink
        : s.miniTagGold;

    const ctaPillTone =
      item.key === "tlmc"
        ? s.ctaPillGold
        : toneKey === "notifications"
        ? s.ctaPillBlue
        : toneKey === "church"
        ? s.ctaPillPurple
        : toneKey === "my_church_room"
        ? s.ctaPillAmber
        : toneKey === "bible"
        ? s.ctaPillEmerald
        : toneKey === "kristo_guide"
        ? s.ctaPillTeal
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? s.ctaPillRose
        : toneKey === "courtship"
        ? s.ctaPillPink
        : s.ctaPillGold;

    const iconColor =
      toneKey === "notifications"
        ? "rgba(132,198,255,0.98)"
        : toneKey === "church"
        ? "rgba(198,166,255,0.98)"
        : toneKey === "bible"
        ? "rgba(120,224,178,0.98)"
        : toneKey === "kristo_guide"
        ? "rgba(94,234,212,0.98)"
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? "rgba(255,158,210,0.98)"
        : toneKey === "courtship"
        ? "rgba(255,150,196,0.98)"
        : "rgba(236,202,112,0.98)";

    const arrowColor =
      toneKey === "notifications"
        ? "rgba(188,228,255,0.96)"
        : toneKey === "church"
        ? "rgba(228,212,255,0.96)"
        : toneKey === "bible"
        ? "rgba(210,255,236,0.96)"
        : toneKey === "kristo_guide"
        ? "rgba(204,251,241,0.96)"
        : toneKey === "testimony" || toneKey === "payments" || toneKey === "media"
        ? "rgba(255,214,234,0.96)"
        : toneKey === "courtship"
        ? "rgba(255,214,230,0.96)"
        : "rgba(255,230,170,0.96)";

    const surface = getCardSurface(item.key);

    return (
      <Pressable
        key={item.key}
        onPress={() => {
          if (isChurchGate) {
            router.push(CHURCH_GATE_HREF as any);
            return;
          }

          if (
            item.key === "messages" ||
            item.key === "bible" ||
            item.key === "courtship" ||
            item.key === "testimony"
          ) {
            openV2ComingSoonModal(item);
            return;
          }

          if (item.key === "media") {
            openMediaScreen();
            return;
          }

          router.push(item.href as any);
        }}
        style={({ pressed }) => [
          s.tileWrap,
          { width: CARD_W, height: CARD_H },
          wrapTone,
          premiumWrapTone,
          isTlmc ? s.tileTlmcWrap : null,
          { shadowColor: surface.shadowColor },
          pressed ? { transform: [{ scale: 0.974 }], opacity: 0.95 } : null,
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={surface.base}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          pointerEvents="none"
          colors={surface.tint}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(217,179,95,0.22)", "rgba(217,179,95,0.06)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.4 }}
          style={s.goldRimHighlight}
        />
        <View
          pointerEvents="none"
          style={[s.themeGlowOrb, { backgroundColor: surface.glowColor }]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={surface.sheen}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={s.topSheen}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(0,0,0,0.28)", "rgba(0,0,0,0.08)", "transparent"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={s.innerVignetteTop}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", "rgba(0,0,0,0.12)", "rgba(0,0,0,0.22)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={s.innerVignetteBottom}
        />
        <View pointerEvents="none" style={s.innerRim} />
        <View pointerEvents="none" style={s.goldRimLine} />
        <View pointerEvents="none" style={s.floatGlow} />
        <View pointerEvents="none" style={s.bottomShade} />

        {isTlmc ? <View pointerEvents="none" style={s.tlmcAura} /> : null}
        {isTlmc ? <View pointerEvents="none" style={s.tlmcOrb} /> : null}
        {isTlmc ? <View pointerEvents="none" style={s.tlmcBeam} /> : null}
        {isTlmc ? <View pointerEvents="none" style={s.tlmcGoldOrb} /> : null}

        <View style={[s.tile, innerTone, premiumInnerTone, isTlmc ? s.tileTlmc : null]}>
          <View style={s.rowTop}>
            <View style={s.iconStack}>
              <View
                style={[
                  s.iconGlow,
                  isTlmc ? s.iconGlowTlmc : null,
                  { backgroundColor: surface.glowColor },
                ]}
              />
              <View style={[s.iconPill, iconTone, isTlmc ? s.iconPillTlmc : null]}>
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0.04)", "transparent"]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={s.iconPillSheen}
                />
                <View pointerEvents="none" style={s.iconPillRim} />
                {item.iconLib === "ion" ? (
                  <Ionicons
                    name={item.icon}
                    size={iconSize}
                    color={isTlmc ? "rgba(255,226,140,0.98)" : iconColor}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={item.icon}
                    size={iconSize}
                    color={isTlmc ? "rgba(255,226,140,0.98)" : iconColor}
                  />
                )}
              </View>
            </View>
          </View>

          <Text
            style={[s.tileTitle, titleTone, titleStyleExtra, isTlmc ? s.tileTitleTlmc : null]}
            numberOfLines={titleLines}
          >
            {itemTitle}
          </Text>

          <Text
            style={[s.tileSub, subTone, subStyleExtra, isTlmc ? s.tileSubTlmc : null]}
            numberOfLines={subLines}
          >
            {itemSub}
          </Text>

          <View style={[s.tileFoot, footStyleExtra]}>
            <View style={s.accentDividerWrap}>
              <LinearGradient
                pointerEvents="none"
                colors={["transparent", "rgba(217,179,95,0.42)", "transparent"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={s.accentDividerGlow}
              />
              <View style={s.accentDivider} />
            </View>
            <View style={s.ctaRow}>
              <View style={[s.ctaPill, ctaPillTone, isTlmc ? s.ctaPillTlmc : null]}>
                <Text style={[s.ctaText, hintTone, isTlmc ? s.tapHintTlmc : null]}>
                  {isChurchGate
                    ? "Get Started"
                    : item.title === "Giving"
                      ? "Give"
                      : "Open"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={s.screen}>
      <LinearGradient
        pointerEvents="none"
        colors={["#121826", "#0B0F17", "#070A11"]}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={s.headerGlowPurple} />
      <View pointerEvents="none" style={s.headerGlowBlue} />

      <View style={[s.header, { paddingTop: insets.top + 18 }]}>
        <View style={s.titleGlass}>
          <Text style={s.title}>KRISTO APP</Text>
          <Text style={s.titleSub}>{hasChurch ? "Kristo ecosystem" : "Account & church setup"}</Text>
        </View>
      </View>

      <SupervisorInvitationCard variant="more" />

      <View style={s.columnsWrap}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.columnContent, { paddingBottom: scrollBottomPad }]}
          scrollIndicatorInsets={{ bottom: insets.bottom + TAB_BAR_HEIGHT }}
          style={s.columnScroll}
        >
          {leftItems.map(renderCard)}
        </ScrollView>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.columnContent, s.columnContentRight, { paddingBottom: scrollBottomPad }]}
          scrollIndicatorInsets={{ bottom: insets.bottom + TAB_BAR_HEIGHT }}
          style={s.columnScroll}
        >
          {rightItems.map(renderCard)}
          {showMediaAccessSkeleton ? <MediaAccessSkeletonCard key="media-access-skeleton" /> : null}
        </ScrollView>
      </View>


      <Modal
        visible={messagesV2Open}
        transparent
        animationType="fade"
        onRequestClose={() => setMessagesV2Open(false)}
      >
        <View style={s.v2Overlay}>
          <Animated.View
            style={[
              s.v2Card,
              {
                transform: [
                  {
                    translateY: v2CardAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -5],
                    }),
                  },
                  {
                    scale: v2CardAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.012],
                    }),
                  },
                ],
              },
            ]}
          >
            <View pointerEvents="none" style={s.v2GlowTop} />
            <View pointerEvents="none" style={s.v2GlowBottom} />
            <View pointerEvents="none" style={s.v2GoldSweep} />

            <View style={s.v2IconWrap}>
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={46}
                color="#F4D06F"
              />
            </View>

            <Text style={s.v2Title}>{v2ModalTitle}</Text>

            <Text style={s.v2Text}>{v2ModalText}</Text>

            <View style={s.v2InfoBox}>
              <View style={s.v2LockCircle}>
                <Ionicons
                  name="sparkles-outline"
                  size={28}
                  color="#F4D06F"
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.v2InfoTitle}>Launching soon</Text>

                <Text style={s.v2InfoText}>
                  The next generation {v2FeatureTitle.toLowerCase()} experience
                  is coming in Kristo App V2.
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => setMessagesV2Open(false)}
              style={s.v2Btn}
            >
              <Text style={s.v2BtnText}>OK</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },

  skeletonTile: {
    paddingHorizontal: 17,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  skeletonIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  skeletonLineWide: {
    marginTop: 16,
    width: "72%",
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  skeletonLineNarrow: {
    marginTop: 10,
    width: "54%",
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  tlmcPreloadGhost: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
    top: -9999,
  },

  headerGlowPurple: {
    position: "absolute",
    top: -58,
    left: -34,
    width: 224,
    height: 224,
    borderRadius: 999,
    backgroundColor: "rgba(108,78,255,0.14)",
  },

  headerGlowBlue: {
    position: "absolute",
    top: -2,
    right: -76,
    width: 198,
    height: 198,
    borderRadius: 999,
    backgroundColor: "rgba(0,145,255,0.10)",
  },

  header: {
    paddingHorizontal: PAD,
    paddingBottom: 8,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  columnsWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: GAP,
    paddingHorizontal: PAD,
    paddingTop: 0,
  },

  columnScroll: {
    flex: 1,
  },

  columnContent: {
    paddingTop: 4,
    gap: GAP,
  },

  columnContentRight: {
    paddingTop: 0,
  },

  title: {
  color: "rgba(255,255,255,0.99)",
  fontWeight: "950",
  fontSize: 34,
  letterSpacing: -0.5,
  textAlign: "center",
  textShadowColor: "rgba(0,0,0,0.18)",
  textShadowOffset: { width: 0, height: 5 },
  textShadowRadius: 12,
},

  titleGlass: {
  alignSelf: "center",
  minHeight: 0,
  width: "86%",
  paddingHorizontal: 20,
  paddingVertical: 6,
  borderRadius: 20,
  backgroundColor: "rgba(255,255,255,0.035)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.045)",
  shadowColor: "#000",
  shadowOpacity: 0.16,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
},

  titleSub: {
    marginTop: 1,
  color: "rgba(255,255,255,0.28)",
  fontSize: 11.5,
  fontWeight: "700",
  letterSpacing: 1.2,
  textAlign: "center",
  textTransform: "uppercase",
},

  sub: {
    display: "none",
    marginTop: 0,
    color: "rgba(255,255,255,0.0)",
    fontWeight: "700",
    fontSize: 0.1,
    lineHeight: 0,
    maxWidth: 260,
  },
  tileWrap: {
    borderRadius: 32,
    overflow: "hidden",
    marginBottom: 2,
    shadowOpacity: 0.52,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 22 },
    elevation: 24,
  },

  tileGold: {
    backgroundColor: "rgba(255,245,210,0.018)",
    borderWidth: 1,
    borderColor: "rgba(236,202,112,0.12)",
  },

  tileBlue: {
    backgroundColor: "rgba(170,210,255,0.018)",
    borderWidth: 1,
    borderColor: "rgba(90,140,235,0.12)",
  },

  tilePurple: {
    backgroundColor: "rgba(210,190,255,0.018)",
    borderWidth: 1,
    borderColor: "rgba(124,92,220,0.12)",
  },

  tileGoldStrong: {
    backgroundColor: "rgba(255,235,170,0.022)",
    borderWidth: 1.1,
    borderColor: "rgba(236,202,112,0.16)",
  },

  tileEmerald: {
    backgroundColor: "rgba(170,255,230,0.018)",
    borderWidth: 1,
    borderColor: "rgba(64,150,126,0.12)",
  },

  tileTeal: {
    backgroundColor: "rgba(120,255,240,0.018)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.14)",
  },

  tileRose: {
    backgroundColor: "rgba(255,210,230,0.018)",
    borderWidth: 1,
    borderColor: "rgba(156,86,118,0.12)",
  },

  tilePink: {
    backgroundColor: "rgba(255,214,235,0.018)",
    borderWidth: 1,
    borderColor: "rgba(176,92,132,0.12)",
  },

  tileInnerGold: {
    backgroundColor: "rgba(255,244,214,0.050)",
    borderColor: "rgba(236,202,112,0.14)",
  },

  tileInnerBlue: {
    backgroundColor: "rgba(120,170,255,0.055)",
    borderColor: "rgba(96,152,255,0.16)",
  },

  tileInnerPurple: {
    backgroundColor: "rgba(164,120,255,0.055)",
    borderColor: "rgba(146,108,255,0.16)",
  },

  tileInnerAmber: {
    backgroundColor: "rgba(255,214,120,0.058)",
    borderColor: "rgba(236,202,112,0.18)",
  },

  tileInnerEmerald: {
    backgroundColor: "rgba(88,210,158,0.055)",
    borderColor: "rgba(84,192,146,0.16)",
  },

  tileInnerTeal: {
    backgroundColor: "rgba(45,212,191,0.055)",
    borderColor: "rgba(45,212,191,0.18)",
  },

  tileInnerRose: {
    backgroundColor: "rgba(255,120,190,0.050)",
    borderColor: "rgba(214,106,162,0.15)",
  },

  tileInnerPink: {
    backgroundColor: "rgba(255,124,176,0.050)",
    borderColor: "rgba(228,120,170,0.15)",
  },

  iconPillGold: {
    backgroundColor: "rgba(72,56,18,0.42)",
    borderColor: "rgba(236,202,112,0.28)",
  },

  iconPillBlue: {
    backgroundColor: "rgba(18,38,72,0.42)",
    borderColor: "rgba(92,152,255,0.30)",
  },

  iconPillPurple: {
    backgroundColor: "rgba(42,28,76,0.44)",
    borderColor: "rgba(156,124,255,0.32)",
  },

  iconPillAmber: {
    backgroundColor: "rgba(74,52,18,0.44)",
    borderColor: "rgba(255,214,120,0.30)",
  },

  iconPillEmerald: {
    backgroundColor: "rgba(16,54,44,0.44)",
    borderColor: "rgba(84,196,146,0.30)",
  },

  iconPillTeal: {
    backgroundColor: "rgba(10,46,48,0.44)",
    borderColor: "rgba(45,212,191,0.32)",
  },

  iconPillRose: {
    backgroundColor: "rgba(72,28,54,0.44)",
    borderColor: "rgba(228,120,176,0.28)",
  },

  iconPillPink: {
    backgroundColor: "rgba(76,24,46,0.44)",
    borderColor: "rgba(236,126,176,0.28)",
  },

  tileTitleGold: {
    color: "rgba(255,248,228,0.99)",
  },

  tileTitleBlue: {
    color: "rgba(232,242,255,0.99)",
  },

  tileTitlePurple: {
    color: "rgba(244,236,255,0.99)",
  },

  tileTitleAmber: {
    color: "rgba(255,246,224,0.99)",
  },

  tileTitleEmerald: {
    color: "rgba(232,255,244,0.99)",
  },

  tileTitleTeal: {
    color: "rgba(224,255,251,0.99)",
  },

  tileTitleRose: {
    color: "rgba(255,236,246,0.99)",
  },

  tileTitlePink: {
    color: "rgba(255,236,242,0.99)",
  },

  tileSubGold: {
    color: "rgba(255,245,214,0.74)",
  },

  tileSubBlue: {
    color: "rgba(220,235,255,0.75)",
  },

  tileSubPurple: {
    color: "rgba(234,224,255,0.75)",
  },

  tileSubAmber: {
    color: "rgba(255,238,204,0.76)",
  },

  tileSubEmerald: {
    color: "rgba(214,248,232,0.76)",
  },

  tileSubTeal: {
    color: "rgba(204,251,241,0.76)",
  },

  tileSubRose: {
    color: "rgba(255,222,238,0.76)",
  },

  tileSubPink: {
    color: "rgba(255,222,232,0.76)",
  },

  tapHintGold: {
    color: "rgba(236,202,112,0.96)",
  },

  tapHintBlue: {
    color: "rgba(132,198,255,0.96)",
  },

  tapHintPurple: {
    color: "rgba(198,166,255,0.96)",
  },

  tapHintAmber: {
    color: "rgba(255,214,120,0.97)",
  },

  tapHintEmerald: {
    color: "rgba(120,224,178,0.97)",
  },

  tapHintTeal: {
    color: "rgba(94,234,212,0.97)",
  },

  tapHintRose: {
    color: "rgba(255,158,210,0.97)",
  },

  tapHintPink: {
    color: "rgba(255,154,196,0.97)",
  },

  topSheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 96,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },

  goldRimHighlight: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 52,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },

  themeGlowOrb: {
    position: "absolute",
    right: -12,
    top: -10,
    width: 104,
    height: 104,
    borderRadius: 999,
    opacity: 0.72,
  },

  innerVignetteTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 72,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },

  innerVignetteBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 88,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },

  innerRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "transparent",
  },

  goldRimLine: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 1,
    height: 1,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.28)",
  },

  bottomShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
    backgroundColor: "rgba(0,0,0,0.18)",
  },

  tile: {
    flex: 1,
    borderRadius: 32,
    paddingHorizontal: 17,
    paddingTop: 18,
    paddingBottom: 16,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.034)",
    borderColor: "rgba(217,179,95,0.14)",
    justifyContent: "flex-start",
  },

  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },

  iconStack: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
  },

  iconGlow: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 999,
    opacity: 0.62,
  },

  iconGlowTlmc: {
    width: 76,
    height: 76,
    opacity: 0.68,
  },

  iconPill: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,10,18,0.78)",
    borderWidth: 1.3,
    borderColor: "rgba(217,179,95,0.26)",
    shadowColor: "#000",
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    overflow: "hidden",
  },

  iconPillSheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 28,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },

  iconPillRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "transparent",
  },

  tileTitle: {
    marginTop: 14,
    color: "rgba(255,255,255,0.995)",
    fontWeight: "950",
    fontSize: 20,
    letterSpacing: -0.34,
    lineHeight: 24,
  },

  tileSub: {
    marginTop: 7,
    color: "rgba(255,255,255,0.68)",
    fontWeight: "700",
    fontSize: 12.6,
    lineHeight: 17.8,
    minHeight: 36,
    maxHeight: 36,
  },

  tileFoot: {
    marginTop: "auto",
    paddingTop: 2,
  },

  accentDividerWrap: {
    marginTop: 12,
    height: 10,
    justifyContent: "center",
  },

  accentDividerGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 8,
    opacity: 0.55,
  },

  accentDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(217,179,95,0.22)",
  },

  divider: {
    marginTop: 14,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.10)",
  },



  v2GlowTop: {
    position: "absolute",
    top: -120,
    alignSelf: "center",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(244,208,111,0.10)",
  },

  v2GlowBottom: {
    position: "absolute",
    bottom: -140,
    right: -80,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(21,89,170,0.14)",
  },

  v2GoldSweep: {
    position: "absolute",
    top: 18,
    left: -80,
    width: 190,
    height: 520,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.08)",
    transform: [{ rotate: "-12deg" }],
  },

  v2Overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.66)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 26,
  },

  v2Card: {
    width: "100%",
    borderRadius: 38,
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 24,
    backgroundColor: "#041226",
    borderWidth: 1.5,
    borderColor: "rgba(244,208,111,0.58)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 18,
    overflow: "hidden",
  },

  v2IconWrap: {
    alignSelf: "center",
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.13)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.16)",
    marginTop: -66,
    marginBottom: 16,
  },

  v2Title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.6,
  },

  v2Text: {
    marginTop: 16,
    color: "rgba(255,255,255,0.74)",
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 6,
  },

  v2InfoBox: {
    width: "100%",
    marginTop: 26,
    borderRadius: 26,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.34)",
  },

  v2LockCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.2,
    borderColor: "#F4D06F",
  },

  v2InfoTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },

  v2InfoText: {
    marginTop: 4,
    color: "rgba(255,255,255,0.66)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
  },

  v2Btn: {
    height: 64,
    borderRadius: 26,
    marginTop: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4D06F",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },

  v2BtnText: {
    color: "#07111F",
    fontSize: 22,
    fontWeight: "900",
  },

  tapHint: {
    marginTop: 10,
    color: "rgba(236,202,112,0.98)",
    fontWeight: "900",
    letterSpacing: 0.14,
    fontSize: 12.8,
  },
  tileTlmcWrap: {
    shadowOpacity: 0.56,
    shadowRadius: 38,
    shadowOffset: { width: 0, height: 26 },
    elevation: 28,
  },

  tlmcAura: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(90,74,214,0.12)",
  },

  tlmcOrb: {
    position: "absolute",
    right: -8,
    top: -8,
    width: 118,
    height: 118,
    borderRadius: 999,
    backgroundColor: "rgba(126,102,255,0.22)",
  },

  tlmcGoldOrb: {
    position: "absolute",
    left: -6,
    bottom: 36,
    width: 88,
    height: 88,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.12)",
  },

  tlmcBeam: {
    position: "absolute",
    left: -10,
    bottom: 4,
    width: 148,
    height: 76,
    borderRadius: 999,
    backgroundColor: "rgba(255,214,120,0.09)",
    transform: [{ rotate: "-12deg" }],
  },

  tileTlmc: {
    backgroundColor: "rgba(46,34,102,0.22)",
    borderWidth: 1.15,
    borderColor: "rgba(148,128,255,0.34)",
  },

  iconPillTlmc: {
    backgroundColor: "rgba(28,22,64,0.68)",
    borderColor: "rgba(255,226,140,0.30)",
    borderWidth: 1.3,
  },

  tileTitleTlmc: {
    color: "rgba(255,248,236,0.995)",
  },

  tileSubTlmc: {
    color: "rgba(238,232,255,0.78)",
  },

  tapHintTlmc: {
    color: "rgba(255,224,126,0.99)",
    letterSpacing: 0.34,
  },
  tileMinistriesWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.40,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },
  tileNotificationsWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.40,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },
  tileChurchWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.40,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },
  tileRoomWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.40,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },
  tileBibleWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.40,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },
  tileTariffWrap: {
    shadowColor: "#2DD4BF",
    shadowOpacity: 0.34,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },
  tileGivingWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.40,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },
  tileCourtshipWrap: {
    shadowColor: "#000",
    shadowOpacity: 0.40,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 22 },
    elevation: 22,
  },

  tileInnerMinistries: {
    backgroundColor: "rgba(255,241,198,0.078)",
    borderColor: "rgba(236,202,112,0.23)",
  },

  tileInnerNotifications: {
    backgroundColor: "rgba(96,150,255,0.080)",
    borderColor: "rgba(106,168,255,0.24)",
  },

  tileInnerChurch: {
    backgroundColor: "rgba(156,118,255,0.080)",
    borderColor: "rgba(156,118,255,0.24)",
  },

  tileInnerRoom: {
    backgroundColor: "rgba(255,210,110,0.080)",
    borderColor: "rgba(255,214,120,0.24)",
  },

  tileInnerBible: {
    backgroundColor: "rgba(74,196,146,0.078)",
    borderColor: "rgba(96,212,164,0.24)",
  },

  tileInnerTariff: {
    backgroundColor: "rgba(45,212,191,0.078)",
    borderColor: "rgba(94,234,212,0.24)",
  },

  tileInnerGiving: {
    backgroundColor: "rgba(255,126,186,0.076)",
    borderColor: "rgba(236,126,176,0.23)",
  },

  tileInnerCourtship: {
    backgroundColor: "rgba(248,132,182,0.074)",
    borderColor: "rgba(248,132,182,0.23)",
  },



  tileTitleHero: {
    fontSize: 22,
    letterSpacing: -0.32,
    lineHeight: 26,
  },

  tileTitleCompact: {
    fontSize: 15.4,
  },

  tileTitleSoft: {
    fontWeight: "900",
  },

  tileSubCompact: {
    marginTop: 6,
  },

  tileSubStrong: {
    marginTop: 8,
    lineHeight: 17,
  },

  tileFootHero: {
    marginTop: "auto",
    paddingTop: 2,
  },

  tileFootCompact: {
    marginTop: "auto",
  },

  ctaRow: {
    marginTop: 10,
    marginBottom: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
  },

  ctaPill: {
    minHeight: 32,
    paddingHorizontal: 15,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(217,179,95,0.22)",
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },

  ctaPillTlmc: {
    backgroundColor: "rgba(255,226,140,0.12)",
    borderColor: "rgba(255,226,140,0.28)",
  },

  ctaPillGold: {
    backgroundColor: "rgba(236,202,112,0.10)",
    borderColor: "rgba(236,202,112,0.18)",
  },

  ctaPillBlue: {
    backgroundColor: "rgba(132,198,255,0.10)",
    borderColor: "rgba(132,198,255,0.18)",
  },

  ctaPillPurple: {
    backgroundColor: "rgba(198,166,255,0.10)",
    borderColor: "rgba(198,166,255,0.18)",
  },

  ctaPillAmber: {
    backgroundColor: "rgba(255,214,120,0.10)",
    borderColor: "rgba(255,214,120,0.18)",
  },

  ctaPillEmerald: {
    backgroundColor: "rgba(120,224,178,0.10)",
    borderColor: "rgba(120,224,178,0.18)",
  },

  ctaPillTeal: {
    backgroundColor: "rgba(94,234,212,0.10)",
    borderColor: "rgba(94,234,212,0.18)",
  },

  ctaPillRose: {
    backgroundColor: "rgba(255,158,210,0.10)",
    borderColor: "rgba(255,158,210,0.18)",
  },

  ctaPillPink: {
    backgroundColor: "rgba(255,154,196,0.10)",
    borderColor: "rgba(255,154,196,0.18)",
  },

  ctaText: {
    fontWeight: "900",
    fontSize: 12.2,
    letterSpacing: 0.22,
  },

  floatGlow: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: -10,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.22)",
    opacity: 0.7,
  },

});
