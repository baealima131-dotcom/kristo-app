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
  Image,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { TLMC_UNIVERSE_IMAGE, preloadTlmcAssets } from "@/src/lib/tlmcPreload";
import { MEDIA_STUDIO_BACKGROUND, preloadMediaAssets } from "@/src/lib/mediaPreload";

const MEDIA_HREF = "/more/media";

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

const GAP = 14;
const PAD = 16;
const { width } = Dimensions.get("window");
const CARD_W = Math.floor((width - PAD * 2 - GAP) / 2);

const LEFT_ITEMS = ITEMS.filter((_, i) => i % 2 === 0);
const RIGHT_ITEMS = ITEMS.filter((_, i) => i % 2 === 1);

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [messagesV2Open, setMessagesV2Open] = React.useState(false);
  const [v2FeatureTitle, setV2FeatureTitle] = React.useState("Messages");
  const v2CardAnim = React.useRef(new Animated.Value(0)).current;
  const mediaOpenRef = React.useRef(false);

  const warmMediaRoute = React.useCallback(() => {
    void preloadMediaAssets();
    void (router as any).prefetch?.(MEDIA_HREF);
  }, [router]);

  const openMediaScreen = React.useCallback(() => {
    if (mediaOpenRef.current) return;
    mediaOpenRef.current = true;
    router.push(MEDIA_HREF as any);
  }, [router]);

  React.useEffect(() => {
    void preloadTlmcAssets();
    warmMediaRoute();
  }, [warmMediaRoute]);

  useFocusEffect(
    React.useCallback(() => {
      mediaOpenRef.current = false;
      void preloadTlmcAssets();
      warmMediaRoute();
    }, [warmMediaRoute])
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

  const renderCard = (item: Item) => {
    const isTlmc = item.key === "tlmc";

    const wrapTone =
      item.key === "ministries"
        ? [s.tileGold, s.tileMinistriesWrap]
        : item.key === "notifications" || item.key === "messages"
        ? [s.tileBlue, s.tileNotificationsWrap]
        : item.key === "church"
        ? [s.tilePurple, s.tileChurchWrap]
        : item.key === "my_church_room"
        ? [s.tileGoldStrong, s.tileRoomWrap]
        : item.key === "bible"
        ? [s.tileEmerald, s.tileBibleWrap]
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? [s.tileRose, s.tileGivingWrap]
        : item.key === "courtship"
        ? [s.tilePink, s.tileCourtshipWrap]
        : null;

    const innerTone =
      item.key === "ministries"
        ? [s.tileInnerGold, s.tileInnerMinistries]
        : item.key === "notifications" || item.key === "messages"
        ? [s.tileInnerBlue, s.tileInnerNotifications]
        : item.key === "church"
        ? [s.tileInnerPurple, s.tileInnerChurch]
        : item.key === "my_church_room"
        ? [s.tileInnerAmber, s.tileInnerRoom]
        : item.key === "bible"
        ? [s.tileInnerEmerald, s.tileInnerBible]
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? [s.tileInnerRose, s.tileInnerGiving]
        : item.key === "courtship"
        ? [s.tileInnerPink, s.tileInnerCourtship]
        : null;

    const iconTone =
      item.key === "ministries"
        ? s.iconPillGold
        : item.key === "notifications" || item.key === "messages"
        ? s.iconPillBlue
        : item.key === "church"
        ? s.iconPillPurple
        : item.key === "my_church_room"
        ? s.iconPillAmber
        : item.key === "bible"
        ? s.iconPillEmerald
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.iconPillRose
        : item.key === "courtship"
        ? s.iconPillPink
        : null;

    const arrowTone =
      item.key === "ministries"
        ? s.arrowPillGold
        : item.key === "notifications" || item.key === "messages"
        ? s.arrowPillBlue
        : item.key === "church"
        ? s.arrowPillPurple
        : item.key === "my_church_room"
        ? s.arrowPillAmber
        : item.key === "bible"
        ? s.arrowPillEmerald
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.arrowPillRose
        : item.key === "courtship"
        ? s.arrowPillPink
        : null;

    const titleTone =
      item.key === "ministries"
        ? s.tileTitleGold
        : item.key === "notifications" || item.key === "messages"
        ? s.tileTitleBlue
        : item.key === "church"
        ? s.tileTitlePurple
        : item.key === "my_church_room"
        ? s.tileTitleAmber
        : item.key === "bible"
        ? s.tileTitleEmerald
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.tileTitleRose
        : item.key === "courtship"
        ? s.tileTitlePink
        : null;

    const subTone =
      item.key === "ministries"
        ? s.tileSubGold
        : item.key === "notifications" || item.key === "messages"
        ? s.tileSubBlue
        : item.key === "church"
        ? s.tileSubPurple
        : item.key === "my_church_room"
        ? s.tileSubAmber
        : item.key === "bible"
        ? s.tileSubEmerald
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.tileSubRose
        : item.key === "courtship"
        ? s.tileSubPink
        : null;

    const hintTone =
      item.key === "ministries"
        ? s.tapHintGold
        : item.key === "notifications" || item.key === "messages"
        ? s.tapHintBlue
        : item.key === "church"
        ? s.tapHintPurple
        : item.key === "my_church_room"
        ? s.tapHintAmber
        : item.key === "bible"
        ? s.tapHintEmerald
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.tapHintRose
        : item.key === "courtship"
        ? s.tapHintPink
        : null;

    const premiumWrapTone =
      item.key === "ministries"
        ? s.tileMinistriesWrap
        : item.key === "notifications" || item.key === "messages"
        ? s.tileNotificationsWrap
        : item.key === "church"
        ? s.tileChurchWrap
        : item.key === "my_church_room"
        ? s.tileRoomWrap
        : item.key === "bible"
        ? s.tileBibleWrap
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.tileGivingWrap
        : item.key === "courtship"
        ? s.tileCourtshipWrap
        : null;

    const premiumInnerTone =
      item.key === "ministries"
        ? s.tileInnerMinistries
        : item.key === "notifications" || item.key === "messages"
        ? s.tileInnerNotifications
        : item.key === "church"
        ? s.tileInnerChurch
        : item.key === "my_church_room"
        ? s.tileInnerRoom
        : item.key === "bible"
        ? s.tileInnerBible
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.tileInnerGiving
        : item.key === "courtship"
        ? s.tileInnerCourtship
        : null;

    const iconSize =
      item.key === "tlmc"
        ? 20
        : item.key === "church"
        ? 19
        : item.key === "bible"
        ? 19
        : 18;

    const arrowSize = item.key === "tlmc" ? 18 : 16;

    const titleLines =
      item.key === "my_church_room" || item.key === "church" ? 2 : 1;

    const subLines =
      item.key === "my_church_room" || item.key === "church" ? 3 : 2;

    const titleStyleExtra =
      item.key === "tlmc"
        ? s.tileTitleHero
        : item.key === "notifications" || item.key === "messages"
        ? s.tileTitleCompact
        : item.key === "bible"
        ? s.tileTitleSoft
        : item.key === "courtship"
        ? s.tileTitleSoft
        : null;

    const subStyleExtra =
      item.key === "notifications" || item.key === "messages"
        ? s.tileSubCompact
        : item.key === "church"
        ? s.tileSubStrong
        : item.key === "my_church_room"
        ? s.tileSubStrong
        : null;

    const footStyleExtra =
      item.key === "tlmc"
        ? s.tileFootHero
        : item.key === "notifications" || item.key === "messages"
        ? s.tileFootCompact
        : null;

    const miniTag =
      item.key === "tlmc"
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
        : item.key === "testimony"
        ? "Stories"
        : item.key === "payments"
        ? "Finance"
        : item.key === "media"
        ? "Creator"
        : "Love";

    const miniTagTone =
      item.key === "tlmc"
        ? s.miniTagTlmc
        : item.key === "notifications"
        ? s.miniTagBlue
        : item.key === "church"
        ? s.miniTagPurple
        : item.key === "my_church_room"
        ? s.miniTagAmber
        : item.key === "bible"
        ? s.miniTagEmerald
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.miniTagRose
        : item.key === "courtship"
        ? s.miniTagPink
        : s.miniTagGold;

    const ctaPillTone =
      item.key === "tlmc"
        ? s.ctaPillGold
        : item.key === "notifications"
        ? s.ctaPillBlue
        : item.key === "church"
        ? s.ctaPillPurple
        : item.key === "my_church_room"
        ? s.ctaPillAmber
        : item.key === "bible"
        ? s.ctaPillEmerald
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? s.ctaPillRose
        : item.key === "courtship"
        ? s.ctaPillPink
        : s.ctaPillGold;

    const iconColor =
      item.key === "notifications"
        ? "rgba(132,198,255,0.98)"
        : item.key === "church"
        ? "rgba(198,166,255,0.98)"
        : item.key === "bible"
        ? "rgba(120,224,178,0.98)"
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? "rgba(255,158,210,0.98)"
        : item.key === "courtship"
        ? "rgba(255,150,196,0.98)"
        : "rgba(236,202,112,0.98)";

    const arrowColor =
      item.key === "notifications"
        ? "rgba(188,228,255,0.96)"
        : item.key === "church"
        ? "rgba(228,212,255,0.96)"
        : item.key === "bible"
        ? "rgba(210,255,236,0.96)"
        : item.key === "testimony" || item.key === "payments" || item.key === "media"
        ? "rgba(255,214,234,0.96)"
        : item.key === "courtship"
        ? "rgba(255,214,230,0.96)"
        : "rgba(255,230,170,0.96)";

    return (
      <Pressable
        key={item.key}
        onPress={() => {
          if (
            item.key === "messages" ||
            item.key === "bible" ||
            item.key === "courtship" ||
            item.key === "testimony"
          ) {
            setV2FeatureTitle(item.title);
            setMessagesV2Open(true);
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
          { width: CARD_W },
          wrapTone,
          premiumWrapTone,
          isTlmc ? s.tileTlmcWrap : null,
          pressed ? { transform: [{ scale: 0.965 }], opacity: 0.92 } : null,
        ]}
      >
        <View style={s.floatGlow} />
        <View style={s.edge} />
        <View style={s.sheen} />
        <View style={s.goldGlow} />
        <View style={s.cornerGlow} />
        <View style={s.bottomShade} />

        {isTlmc ? <View pointerEvents="none" style={s.tlmcAura} /> : null}
        {isTlmc ? <View pointerEvents="none" style={s.tlmcOrb} /> : null}
        {isTlmc ? <View pointerEvents="none" style={s.tlmcBeam} /> : null}

        <View style={[s.tile, innerTone, premiumInnerTone, isTlmc ? s.tileTlmc : null]}>
          <View style={s.rowTop}>
            <View style={[s.iconPill, iconTone, isTlmc ? s.iconPillTlmc : null]}>
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

          <Text
            style={[s.tileTitle, titleTone, titleStyleExtra, isTlmc ? s.tileTitleTlmc : null]}
            numberOfLines={titleLines}
          >
            {item.title}
          </Text>

          <Text
            style={[s.tileSub, subTone, subStyleExtra, isTlmc ? s.tileSubTlmc : null]}
            numberOfLines={subLines}
          >
            {item.sub}
          </Text>

          <View style={[s.tileFoot, footStyleExtra]}>
            <View style={s.divider} />
            <View style={s.ctaRow}>
              <View style={[s.ctaPill, ctaPillTone]}>
                <Text style={[s.ctaText, hintTone, isTlmc ? s.tapHintTlmc : null]}>
                  {item.title === "Giving" ? "Give" : "Open"}
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
      <Image
        source={TLMC_UNIVERSE_IMAGE}
        style={s.tlmcPreloadGhost}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Image
        source={MEDIA_STUDIO_BACKGROUND}
        style={s.tlmcPreloadGhost}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View pointerEvents="none" style={s.headerGlowPurple} />
      <View pointerEvents="none" style={s.headerGlowBlue} />

      <View style={[s.header, { paddingTop: insets.top + 18 }]}>
        <View style={s.titleGlass}>
          <Text style={s.title}>KRISTO APP</Text>
          <Text style={s.titleSub}>Kristo ecosystem</Text>
        </View>
      </View>

      <View style={[s.columnsWrap, { paddingBottom: insets.bottom + 12 }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.columnContent}
          style={s.columnScroll}
        >
          {LEFT_ITEMS.map(renderCard)}
        </ScrollView>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.columnContent, s.columnContentRight]}
          style={s.columnScroll}
        >
          {RIGHT_ITEMS.map(renderCard)}
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

            <Text style={s.v2Title}>{v2FeatureTitle} coming in V2</Text>

            <Text style={s.v2Text}>
              Kristo {v2FeatureTitle} V2 is being prepared with a stronger
              experience, smarter tools, and advanced community systems.
            </Text>

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
    paddingBottom: 24,
    gap: GAP + 2,
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
    borderRadius: 28,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.42,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 20,
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

  tileInnerRose: {
    backgroundColor: "rgba(255,120,190,0.050)",
    borderColor: "rgba(214,106,162,0.15)",
  },

  tileInnerPink: {
    backgroundColor: "rgba(255,124,176,0.050)",
    borderColor: "rgba(228,120,170,0.15)",
  },

  iconPillGold: {
    backgroundColor: "rgba(72,56,18,0.34)",
    borderColor: "rgba(236,202,112,0.18)",
  },

  iconPillBlue: {
    backgroundColor: "rgba(18,38,72,0.34)",
    borderColor: "rgba(92,152,255,0.20)",
  },

  iconPillPurple: {
    backgroundColor: "rgba(42,28,76,0.36)",
    borderColor: "rgba(156,124,255,0.22)",
  },

  iconPillAmber: {
    backgroundColor: "rgba(74,52,18,0.36)",
    borderColor: "rgba(255,214,120,0.22)",
  },

  iconPillEmerald: {
    backgroundColor: "rgba(16,54,44,0.36)",
    borderColor: "rgba(84,196,146,0.22)",
  },

  iconPillRose: {
    backgroundColor: "rgba(72,28,54,0.36)",
    borderColor: "rgba(228,120,176,0.20)",
  },

  iconPillPink: {
    backgroundColor: "rgba(76,24,46,0.36)",
    borderColor: "rgba(236,126,176,0.20)",
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

  tapHintRose: {
    color: "rgba(255,158,210,0.97)",
  },

  tapHintPink: {
    color: "rgba(255,154,196,0.97)",
  },

  edge: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.016)",
  },
  sheen: {
    position: "absolute",
    left: -24,
    top: -12,
    width: 214,
    height: 72,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.050)",
    transform: [{ rotate: "-8deg" }],
  },
  goldGlow: {
    position: "absolute",
    right: -14,
    top: 34,
    width: 106,
    height: 106,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.018)",
  },
  cornerGlow: {
    position: "absolute",
    left: -10,
    bottom: -12,
    width: 88,
    height: 88,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.010)",
  },
  bottomShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 42,
    backgroundColor: "rgba(0,0,0,0.07)",
  },
  tile: {
    minHeight: 210,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.064)",
    borderColor: "rgba(255,255,255,0.15)",
  },

  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  iconPill: {
    width: 54,
    height: 54,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,22,32,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    shadowColor: "#000",
    shadowOpacity: 0.30,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },

  tileTitle: {
    marginTop: 18,
    color: "rgba(255,255,255,0.995)",
    fontWeight: "950",
    fontSize: 19,
    letterSpacing: -0.18,
  },
  tileSub: {
    marginTop: 10,
    color: "rgba(255,255,255,0.66)",
    fontWeight: "600",
    fontSize: 12.6,
    lineHeight: 18,
    minHeight: 42,
  },

  tileFoot: {
    marginTop: "auto",
  },
  divider: {
    marginTop: 16,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.060)",
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
    shadowColor: "#000",
    shadowOpacity: 0.46,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 24 },
    elevation: 26,
  },

  tlmcAura: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(90,74,214,0.10)",
  },

  tlmcOrb: {
    position: "absolute",
    right: -18,
    top: -10,
    width: 124,
    height: 124,
    borderRadius: 999,
    backgroundColor: "rgba(126,102,255,0.22)",
  },

  tlmcBeam: {
    position: "absolute",
    left: -22,
    bottom: -8,
    width: 158,
    height: 82,
    borderRadius: 999,
    backgroundColor: "rgba(255,214,120,0.09)",
    transform: [{ rotate: "-12deg" }],
  },

  tileTlmc: {
    backgroundColor: "rgba(46,34,102,0.24)",
    borderWidth: 1.15,
    borderColor: "rgba(148,128,255,0.30)",
  },

  iconPillTlmc: {
    backgroundColor: "rgba(28,22,64,0.58)",
    borderColor: "rgba(255,226,140,0.24)",
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

  tileInnerGiving: {
    backgroundColor: "rgba(255,126,186,0.076)",
    borderColor: "rgba(236,126,176,0.23)",
  },

  tileInnerCourtship: {
    backgroundColor: "rgba(248,132,182,0.074)",
    borderColor: "rgba(248,132,182,0.23)",
  },



  tileTitleHero: {
    fontSize: 21,
    letterSpacing: -0.20,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },

  ctaPill: {
    minHeight: 36,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
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
    fontSize: 12.8,
  },
  floatGlow: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: -12,
    height: 22,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.18)",
  },

});
