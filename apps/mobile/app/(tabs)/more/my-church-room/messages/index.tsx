import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle, FlatList, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0A1220";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.66)";
const GOLD = "rgba(217,179,95,0.92)";
const CARD = "rgba(255,255,255,0.028)";
const BORDER = "rgba(255,255,255,0.10)";
const PAD = 16;

type MsgKind = "all" | "dm" | "church" | "friend";

type MsgGroup = {
  id: string;
  title: string;
  sub: string;
  time: string;
  count: number; // unread
  kind: Exclude<MsgKind, "all">;
};

const DEMO_GROUPS: MsgGroup[] = [
  { id: "g1", title: "Haizuri", sub: "Direct message • 5 new", time: "10:22", count: 5, kind: "dm" },
  { id: "g3", title: "Pastor Desk", sub: "Church member • counsel", time: "Yesterday", count: 1, kind: "church" },
  { id: "g5", title: "Neema Joseph", sub: "Friend message • following", time: "Sun", count: 0, kind: "friend" },
];

const TLMC_BOXES: MsgGroup[] = [
  { id: "tlmc_box_strategy", title: "TLMC Strategy Room", sub: "Vision • direction • shared plans", time: "BOX", count: 0, kind: "church" },
  { id: "tlmc_box_partnership", title: "TLMC Partnership Desk", sub: "Collaboration • approvals • follow-up", time: "BOX", count: 0, kind: "church" },
  { id: "tlmc_box_prayer", title: "TLMC Prayer Network", sub: "Prayer cover • requests • alerts", time: "BOX", count: 0, kind: "church" },
  { id: "tlmc_box_mission", title: "TLMC Mission Board", sub: "Mission tasks • follow-up • reports", time: "BOX", count: 0, kind: "church" },
];


const FILTERS: { key: MsgKind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "dm", label: "DM" },
  { key: "church", label: "Church" },
  { key: "friend", label: "Friends" },
];

const LIVE_STATUS = [
  "Haizuri is online",
  "Pastor Desk is typing...",
  "Neema Joseph is recording voice...",
  "A new DM just arrived",
];

type ImportantKind = "dm" | "church" | "friend" | "typing" | "audio";

const IMPORTANT_ITEMS: {
  kind: ImportantKind;
  eyebrow: string;
  title: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    kind: "typing",
    eyebrow: "LIVE TYPING",
    title: "Haizuri is typing...",
    sub: "Direct message activity is happening right now.",
    icon: "create-outline",
  },
  {
    kind: "church",
    eyebrow: "CHURCH REPLY",
    title: "2 new church replies arrived",
    sub: "Your church conversations need attention.",
    icon: "chatbox-ellipses-outline",
  },
  {
    kind: "friend",
    eyebrow: "VOICE UPDATE",
    title: "Neema Joseph sent a voice note",
    sub: "Friend message activity just changed.",
    icon: "mic-outline",
  },
];


type TlmcSignalState = "locked" | "soon" | "ready";

const TLMC_SIGNAL = {
  state: "soon" as TlmcSignalState,
  boxId: "moral-reform",
  title: "Moral Reform",
  startsAt: Date.now() + 34 * 60 * 1000,
};

function formatTlmcWait(ms: number) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}


function FilterChip({
  label,
  active,
  kind,
  onPress,
}: {
  label: string;
  active: boolean;
  kind: MsgKind;
  onPress: () => void;
}) {
  const toneStyle =
    kind === "all"
      ? s.filterChipAll
      : kind === "church"
      ? s.filterChipChurch
      : kind === "dm"
      ? s.filterChipDm
      : s.filterChipFriend;

  const toneText =
    kind === "all"
      ? t.filterChipTextAll
      : kind === "church"
      ? t.filterChipTextChurch
      : kind === "dm"
      ? t.filterChipTextDm
      : t.filterChipTextFriend;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.filterChip,
        toneStyle,
        active && s.filterChipActive,
        pressed ? s.filterChipPressed : null,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          t.filterChipText,
          toneText,
          active && t.filterChipTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function kindLabel(kind: Exclude<MsgKind, "all">) {
  switch (kind) {
    case "dm":
      return "DM";
    case "church":
      return "CHURCH";
    case "friend":
      return "FRIEND";
    default:
      return "MESSAGE";
  }
}


function kindBadgeColor(kind: MsgKind) {
  switch (kind) {
    case "dm":
      return {
        backgroundColor: "rgba(217,179,95,0.15)",
        borderColor: "rgba(217,179,95,0.35)"
      }
    case "church":
      return {
        backgroundColor: "rgba(180,120,255,0.15)",
        borderColor: "rgba(180,120,255,0.35)"
      }
    case "friend":
      return {
        backgroundColor: "rgba(90,200,120,0.15)",
        borderColor: "rgba(90,200,120,0.35)"
      }
    default:
      return {}
  }
}


function importantTone(kind: ImportantKind) {
  switch (kind) {
    case "dm":
      return {
        card: s.topInfoCardDm,
        iconWrap: s.topInfoIconDm,
        rightWrap: s.topInfoRightDm,
        eyebrow: t.topInfoEyebrowDm,
        title: t.topInfoTitleDm,
        sub: t.topInfoSubDm,
        iconColor: "#F6D98C",
      };
    case "church":
      return {
        card: s.topInfoCardChurch,
        iconWrap: s.topInfoIconChurch,
        rightWrap: s.topInfoRightChurch,
        eyebrow: t.topInfoEyebrowChurch,
        title: t.topInfoTitleChurch,
        sub: t.topInfoSubChurch,
        iconColor: "#D8C5FF",
      };
    case "friend":
      return {
        card: s.topInfoCardFriend,
        iconWrap: s.topInfoIconFriend,
        rightWrap: s.topInfoRightFriend,
        eyebrow: t.topInfoEyebrowFriend,
        title: t.topInfoTitleFriend,
        sub: t.topInfoSubFriend,
        iconColor: "#BEFFD2",
      };
    case "typing":
      return {
        card: s.topInfoCardTyping,
        iconWrap: s.topInfoIconTyping,
        rightWrap: s.topInfoRightTyping,
        eyebrow: t.topInfoEyebrowTyping,
        title: t.topInfoTitleTyping,
        sub: t.topInfoSubTyping,
        iconColor: "#9FD7FF",
      };
    case "audio":
      return {
        card: s.topInfoCardAudio,
        iconWrap: s.topInfoIconAudio,
        rightWrap: s.topInfoRightAudio,
        eyebrow: t.topInfoEyebrowAudio,
        title: t.topInfoTitleAudio,
        sub: t.topInfoSubAudio,
        iconColor: "#9FF0E1",
      };
    default:
      return {
        card: s.topInfoCard,
        iconWrap: s.topInfoIcon,
        rightWrap: s.topInfoRight,
        eyebrow: t.topInfoEyebrow,
        title: t.topInfoTitle,
        sub: t.topInfoSub,
        iconColor: "#CFE2FF",
      };
  }
}

function GroupRow({ g, onPress }: { g: MsgGroup; onPress: () => void }) {
  const rowTone =
    g.kind === "dm" ? s.rowDm : g.kind === "church" ? s.rowChurch : s.rowFriend;

  const avatarTone =
    g.kind === "dm" ? s.avatarDm : g.kind === "church" ? s.avatarChurch : s.avatarFriend;

  const avatarTextTone =
    g.kind === "dm"
      ? t.avatarTextDm
      : g.kind === "church"
      ? t.avatarTextChurch
      : t.avatarTextFriend;

  const titleTone =
    g.kind === "dm" ? t.titleDm : g.kind === "church" ? t.titleChurch : t.titleFriend;

  const subTone =
    g.kind === "dm" ? t.subDm : g.kind === "church" ? t.subChurch : t.subFriend;

  const timeTone =
    g.kind === "dm" ? t.timeDm : g.kind === "church" ? t.timeChurch : t.timeFriend;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        rowTone,
        pressed ? (s.rowPressed as ViewStyle) : null,
      ]}
    >
      <View style={s.rowGlassTop} />
      <View style={[s.avatar, avatarTone]}>
        <Text style={[t.avatarText, avatarTextTone]} numberOfLines={1}>
          {String(g.title || "?").slice(0, 1).toUpperCase()}
        </Text>
      </View>

      <View style={s.body}>
        <View pointerEvents="none" style={s.rowGlassSheen} />
        <View style={s.rowTop}>
          <View style={s.rowTitleWrap}>
            <Text style={[t.title, titleTone]} numberOfLines={1}>
              {g.title}
            </Text>
          </View>

          <View style={s.rowTopRight}>
            <Text style={[t.time, timeTone]} numberOfLines={1}>
              {g.time}
            </Text>

            {g.count > 0 ? (
              <View style={s.badge}>
                <Text style={t.badgeText} numberOfLines={1}>
                  {g.count}
                </Text>
              </View>
            ) : (
              <View style={s.badgeGhost} />
            )}
          </View>
        </View>

        <View style={s.rowBottom}>
          <Text style={[t.sub, subTone]} numberOfLines={2} ellipsizeMode="tail">
            {g.sub}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");
    const [activeFilter, setActiveFilter] = useState<MsgKind>("all");
  const [statusIndex, setStatusIndex] = useState(0);
  const [showMyWayCard, setShowMyWayCard] = useState(true);
  const [showImportantCard, setShowImportantCard] = useState(false);
  const [showMyWayModal, setShowMyWayModal] = useState(false);
  const [importantIndex, setImportantIndex] = useState(0);
  const [typedImportant, setTypedImportant] = useState("");
  const myWayFade = useState(new Animated.Value(1))[0];

  const tlmcIsReady = TLMC_SIGNAL.state === "ready";
  const tlmcIsSoon = TLMC_SIGNAL.state === "soon";
  const tlmcActive = tlmcIsReady || tlmcIsSoon;
  const tlmcPill = tlmcIsReady ? "READY" : tlmcIsSoon ? "WAITING" : "LOCKED";
  const tlmcTitle = tlmcActive ? TLMC_SIGNAL.title : "My Way";
  const tlmcSub = tlmcIsReady
    ? "Mission iko tayari kuingia"
    : tlmcIsSoon
    ? `Inasubiri ${formatTlmcWait(TLMC_SIGNAL.startsAt - Date.now())}`
    : "Private TLMC access coming soon";
  const tlmcMeta = tlmcIsReady
    ? "TLMC imetuma ujumbe kwa box hii"
    : tlmcIsSoon
    ? "Card hii itafunguka muda ukifika"
    : "Expected in V2 / V3";
  const myWayLift = useState(new Animated.Value(0))[0];
  const statusFade = useState(new Animated.Value(1))[0];

  useEffect(() => {
    let mounted = true;
    let myWayTimer: ReturnType<typeof setTimeout> | null = null;
    let importantTimer: ReturnType<typeof setTimeout> | null = null;
    let returnTimer: ReturnType<typeof setTimeout> | null = null;

    const MY_WAY_MS = 3500;
    const IMPORTANT_MS = 12000;
    const RETURN_MS = 45000;

    const runCycle = () => {
      if (!mounted) return;

      setShowImportantCard(false);
      setShowMyWayCard(true);

      myWayTimer = setTimeout(() => {
        if (!mounted) return;

        setShowMyWayCard(false);
        setShowImportantCard(true);

        importantTimer = setTimeout(() => {
          if (!mounted) return;

          setShowImportantCard(false);

          returnTimer = setTimeout(() => {
            runCycle();
          }, RETURN_MS);
        }, IMPORTANT_MS);
      }, MY_WAY_MS);
    };

    runCycle();

    return () => {
      mounted = false;
      if (myWayTimer) clearTimeout(myWayTimer);
      if (importantTimer) clearTimeout(importantTimer);
      if (returnTimer) clearTimeout(returnTimer);
      myWayFade.stopAnimation();
      myWayLift.stopAnimation();
    };
  }, [myWayFade, myWayLift]);

  useEffect(() => {
    const id = setInterval(() => {
      Animated.sequence([
        Animated.timing(statusFade, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(statusFade, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();

      setStatusIndex((v) => (v + 1) % LIVE_STATUS.length);
    }, 2600);

    return () => clearInterval(id);
  }, [statusFade]);

  useEffect(() => {
    if (!showImportantCard) {
      setImportantIndex(0);
      setTypedImportant("");
      return;
    }

    setImportantIndex(0);
    const rotateId = setInterval(() => {
      setImportantIndex((v) => (v + 1) % IMPORTANT_ITEMS.length);
    }, 4000);

    return () => clearInterval(rotateId);
  }, [showImportantCard]);

  useEffect(() => {
    if (!showImportantCard) {
      setTypedImportant("");
      return;
    }

    const text = IMPORTANT_ITEMS[importantIndex % IMPORTANT_ITEMS.length]?.title || "";
    let i = 0;
    setTypedImportant("");

    const typeId = setInterval(() => {
      i += 1;
      setTypedImportant(text.slice(0, i));
      if (i >= text.length) clearInterval(typeId);
    }, 34);

    return () => clearInterval(typeId);
  }, [showImportantCard, importantIndex]);

  const currentImportant = IMPORTANT_ITEMS[importantIndex % IMPORTANT_ITEMS.length];
  const importantUi = importantTone(currentImportant.kind);

  const data = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return DEMO_GROUPS.filter((g) => {
      const matchSearch = !qq
        ? true
        : (g.title + " " + g.sub).toLowerCase().includes(qq);
      return matchSearch;
    });
  }, [q]);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 10 }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={t.hTitle}>Messages</Text>
          <Text style={t.hSub} numberOfLines={1}>
            DM • church • friends
          </Text>
        </View>

        <Pressable onPress={() => {}} style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
          <Ionicons name="create-outline" size={18} color={GOLD} />
        </Pressable>
      </View>

      {/* Filters */}
      {showMyWayCard || showImportantCard ? (
        <Animated.View
          style={{
            opacity: showMyWayCard ? myWayFade : 1,
            transform: [{ translateY: showMyWayCard ? myWayLift : 0 }],
          }}
        >
          <View style={s.filterCard}>
            <View style={s.filterGlowA} />
            <View style={s.filterGlowB} />
            <View style={s.filterSheen} />

            <View style={s.filterCardTop}>
              <View style={s.filterTitleWrap}>
                <View style={s.filterTitleIcon}>
                  <Ionicons name="chatbubbles-outline" size={18} color={GOLD} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={t.filterSubTitle}>
                    {showMyWayCard ? "Choose what to view" : "Important message"}
                  </Text>
                </View>
              </View>
            </View>

            {showMyWayCard ? (
              <Pressable
                style={({ pressed }) => [
                  s.tlmcHeroBtn,
                  tlmcActive ? s.tlmcHeroBtnReady : s.tlmcHeroBtnLocked,
                  pressed ? ({ opacity: 0.95, transform: [{ scale: 0.995 }] } as ViewStyle) : null,
                ]}
                onPress={() => {
                  if (tlmcActive) {
                    router.push((`/more/my-church-room/ministry` as any));
                  } else {
                    setShowMyWayModal(true);
                  }
                }}
              >
                <View style={s.tlmcHeroLeft}>
                  <View style={s.tlmcHeroIcon}>
                    <Ionicons name={tlmcActive ? "checkmark-circle" : "lock-closed"} size={20} color="#07111F" />
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={s.tlmcHeroTopRow}>
                      <Text style={t.tlmcHeroEyebrow}>TLMC</Text>
                      <View style={[s.tlmcLockedPill, tlmcActive ? s.tlmcLockedPillReady : null]}>
                        <Text style={t.tlmcLockedPillText}>{tlmcPill}</Text>
                      </View>
                    </View>

                    <Text style={t.tlmcHeroTitle}>{tlmcTitle}</Text>

                    <Text style={t.tlmcHeroSub} numberOfLines={1}>
                      {tlmcSub}
                    </Text>

                    <Text style={t.tlmcHeroMeta} numberOfLines={1}>
                      {tlmcMeta}
                    </Text>
                  </View>
                </View>

                <View style={tlmcActive ? s.tlmcHeroRightReady : s.tlmcHeroRightLocked}>
                  <Ionicons name={tlmcActive ? "arrow-forward-outline" : "information-circle-outline"} size={18} color="#07111F" />
                </View>
              </Pressable>
            ) : (
              <View style={[s.topInfoCard, importantUi.card]}>
                <View style={s.topInfoTextOnly}>
                  <View style={s.topInfoMetaRow}>
                    <View style={[s.topInfoKindDot, importantUi.rightWrap]} />
                    <Text style={[t.topInfoEyebrow, importantUi.eyebrow]} numberOfLines={1}>
                      {currentImportant.eyebrow}
                    </Text>
                  </View>

                  <Text style={[t.topInfoTitle, importantUi.title]} numberOfLines={2}>
                    {typedImportant || " "}
                  </Text>

                  <Text style={[t.topInfoSub, importantUi.sub]} numberOfLines={2}>
                    {currentImportant.sub}
                  </Text>

                  <View style={s.topInfoBottomRow}>
                    <View style={s.topInfoLiveTrack}>
                      <View style={[s.topInfoLiveFill, importantUi.iconWrap]} />
                    </View>
                    <Text style={[t.topInfoMiniHint, importantUi.sub]} numberOfLines={1}>
                      live message signal
                    </Text>
                  </View>
                </View>
              </View>
            )}

            

          </View>
        </Animated.View>
      ) : null}

      {/* Unified Message Card */}

      <Modal
        visible={showMyWayModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMyWayModal(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setShowMyWayModal(false)}>
          <Pressable style={s.modalCard} onPress={() => {}}>
            <View style={s.modalGlow} />
            
<View style={s.modalHeader}>
  <View style={s.modalIcon}>
    <Ionicons name="lock-closed" size={18} color="#D9B35F" />
  </View>

  <Text style={t.modalTitle}>My Way is locked</Text>

  <Pressable
    onPress={() => setShowMyWayModal(false)}
    style={s.modalClose}
  >
    <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
  </Pressable>
</View>


            <Text style={t.modalBody}>
              My Way is not available for now.
            </Text>

            <Text style={t.modalBody}>
              It may begin in V2, and is expected to be fully active in V3.
            </Text>

            <Text style={t.modalBody}>
              When it opens, users will use saved command codes, private TLMC paths, and special TLMC guidance.
            </Text>

            <Text style={t.modalHint}>
              Stay ready — this private access experience is being prepared carefully.
            </Text>

            <View style={s.accessCard}>
              <View style={s.accessCardTop}>
                <Text style={t.accessCardEyebrow}>TLMC ACCESS</Text>
                <View style={s.accessCardBadge}>
                  <Text style={t.accessCardBadgeText}>PREPARING</Text>
                </View>
              </View>

              <View style={s.accessStageRow}>
                <View style={[s.accessDot, s.accessDotGold]} />
                <Text style={t.accessStageTitle}>V1 foundation</Text>
                <View style={s.accessStatusReady}>
<Text style={t.accessStageStatusReady}>READY</Text>
</View>
              </View>

              <View style={s.accessStageRow}>
                <View style={[s.accessDot, s.accessDotBlue]} />
                <Text style={t.accessStageTitle}>V2 private start</Text>
                <View style={s.accessStatusNext}>
<Text style={t.accessStageStatusMid}>NEXT</Text>
</View>
              </View>

              <View style={s.accessStageRow}>
                <View style={s.accessDot} />
                <Text style={t.accessStageTitle}>V3 full My Way access</Text>
                <View style={s.accessStatusLocked}>
<Text style={t.accessStageStatusLocked}>LOCKED</Text>
</View>
              </View>
            </View>

            <Pressable
              onPress={() => setShowMyWayModal(false)}
              style={({ pressed }) => [
                s.modalBtn,
                pressed ? ({ opacity: 0.92, transform: [{ scale: 0.992 }] } as ViewStyle) : null,
              ]}
            >
              <Text style={t.modalBtnText}>Sawa</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={s.listCard}>
        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.55)" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search messages"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={t.search}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {q.trim().length > 0 ? (
            <Pressable onPress={() => setQ("")} style={s.clearBtn}>
              <Ionicons name="close" size={16} color="rgba(255,255,255,0.65)" />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          removeClippedSubviews
          initialNumToRender={12}
          windowSize={8}
          data={data}
          keyExtractor={(g) => g.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: insets.bottom + 12 }}
          renderItem={({ item: g }) => (
            <GroupRow
              g={g}
              onPress={() => {
                router.push((`/more/my-church-room/messages/${encodeURIComponent(g.id)}?title=${encodeURIComponent(g.title)}&sub=${encodeURIComponent(g.sub)}`) as any);
              }}
            />
          )}
          ItemSeparatorComponent={() => <View style={s.divider} />}
          ListEmptyComponent={
            <View style={{ padding: 18 }}>
              <Text style={t.emptyTitle}>No results</Text>
              <Text style={t.emptySub}>Try a different keyword.</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingHorizontal: PAD } as ViewStyle,

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
    paddingBottom: 10,
  } as ViewStyle,

  hBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    marginRight: 10,
  } as ViewStyle,

  filterCard: {
    marginTop: 6,
    padding: 12,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.032)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    overflow: "hidden",
    position: "relative",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  } as ViewStyle,

  filterGlowA: {
    position: "absolute",
    top: -22,
    right: -18,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(217,179,95,0.08)",
  } as ViewStyle,

  filterGlowB: {
    position: "absolute",
    bottom: -26,
    left: -18,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(70,120,255,0.07)",
  } as ViewStyle,

  filterSheen: {
    position: "absolute",
    top: 14,
    left: -10,
    right: -10,
    height: 44,
    backgroundColor: "rgba(255,255,255,0.025)",
    transform: [{ rotate: "-3deg" }],
  } as ViewStyle,

  filterCardTop: {
    marginBottom: 8,
  } as ViewStyle,

  filterTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  } as ViewStyle,

  filterTitleIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  } as ViewStyle,

  filterChip: {
    minHeight: 44,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
  } as ViewStyle,

  filterChipActive: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.16)",
  } as ViewStyle,

  filterChipPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  } as ViewStyle,

  filterChipAll: {
    flex: 0.92,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.26)",
  } as ViewStyle,

  filterChipDm: {
    flex: 0.96,
    backgroundColor: "rgba(0,120,255,0.14)",
    borderColor: "rgba(0,120,255,0.28)",
  } as ViewStyle,

  filterChipChurch: {
    flex: 1.04,
    backgroundColor: "rgba(132,92,255,0.14)",
    borderColor: "rgba(132,92,255,0.30)",
  } as ViewStyle,

  filterChipFriend: {
    flex: 1.10,
    backgroundColor: "rgba(34,197,94,0.13)",
    borderColor: "rgba(34,197,94,0.28)",
  } as ViewStyle,

  topTabsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
    marginBottom: 10,
  } as ViewStyle,

  topTabBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  topTabBtnActive: {
    backgroundColor: "rgba(217,179,95,0.92)",
    borderColor: "rgba(255,220,140,0.42)",
  } as ViewStyle,

  ministryHintWrap: {
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 2,
  } as ViewStyle,

  tlmcHeroBtn: {
    marginTop: 2,
    marginBottom: 10,
    minHeight: 68,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: "rgba(217,179,95,0.90)",
    borderWidth: 1,
    borderColor: "rgba(255,220,140,0.42)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as ViewStyle,

  liveBar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 38,
    marginTop: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.032)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  } as ViewStyle,

  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    marginRight: 10,
    backgroundColor: "#22c55e",
    shadowColor: "#22c55e",
    shadowOpacity: 0.32,
    shadowRadius: 6,
  } as ViewStyle,

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 14,
    marginTop: 10,
    marginHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.034)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.055)",
  } as ViewStyle,

  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  listCard: {
    marginTop: 6,
    flex: 1,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.012)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.040)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  } as ViewStyle,

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 13,
    paddingRight: 14,
    paddingVertical: 12,
    borderRadius: 20,
    marginHorizontal: 10,
    marginVertical: 1,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  } as ViewStyle,

  rowPressed: {
    transform: [{ scale: 0.994 }],
    opacity: 0.96,
  } as ViewStyle,

  rowDm: {
  backgroundColor: "rgba(255,244,220,0.030)",
  borderColor: "rgba(217,179,95,0.18)",
  shadowColor: "rgba(217,179,95,0.35)",
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
} as ViewStyle,

  rowChurch: {
  backgroundColor: "rgba(132,92,255,0.038)",
  borderColor: "rgba(170,120,255,0.18)",
  shadowColor: "rgba(132,92,255,0.40)",
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
} as ViewStyle,

  rowFriend: {
  backgroundColor: "rgba(34,197,94,0.038)",
  borderColor: "rgba(34,197,94,0.18)",
  shadowColor: "rgba(34,197,94,0.40)",
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
} as ViewStyle,

  rowGlassTop: {
    position: "absolute",
    top: 0,
    left: 78,
    right: 12,
    height: 16,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 18,
    backgroundColor: "rgba(255,255,255,0.030)",
    opacity: 0.88,
  } as ViewStyle,

  avatar: {
    width: 46,
    height: 46,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,14,26,0.40)",
    borderWidth: 1,
    marginRight: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  } as ViewStyle,

  avatarDm: {
    backgroundColor: "rgba(217,179,95,0.12)",
    borderColor: "rgba(217,179,95,0.30)",
  } as ViewStyle,

  avatarChurch: {
    backgroundColor: "rgba(132,92,255,0.13)",
    borderColor: "rgba(132,92,255,0.31)",
  } as ViewStyle,

  avatarFriend: {
    backgroundColor: "rgba(34,197,94,0.12)",
    borderColor: "rgba(34,197,94,0.29)",
  } as ViewStyle,

  body: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,

  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 26,
  } as ViewStyle,

  rowTitleWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  } as ViewStyle,

  rowTopRight: {
    minHeight: 42,
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginLeft: 10,
  } as ViewStyle,

  rowBottom: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingRight: 10,
  } as ViewStyle,

  kindBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    minHeight: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  } as ViewStyle,

  badge: {
    marginTop: 5,
    minWidth: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  } as ViewStyle,

  rowGlassSheen: {
  position: "absolute",
  top: 3,
  left: 64,
  right: 24,
  height: 12,
  borderRadius: 999,
  backgroundColor: "rgba(255,255,255,0.045)",
  opacity: 0.45,
} as ViewStyle,

  badgeGhost: {
    width: 24,
    height: 24,
    marginTop: 5,
  } as ViewStyle,

  divider: {
    marginLeft: 70,
    marginRight: 14,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.018)",
  } as ViewStyle,

  tlmcHeroLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 10,
  } as ViewStyle,

  tlmcHeroIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,17,31,0.10)",
    borderWidth: 1,
    borderColor: "rgba(7,17,31,0.10)",
  } as ViewStyle,

  tlmcHeroRight: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,17,31,0.10)",
    borderWidth: 1,
    borderColor: "rgba(7,17,31,0.08)",
  } as ViewStyle,

  filterGrid: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 8,
    marginTop: 2,
  } as ViewStyle,

  tlmcHeroBtnLocked: {
    opacity: 0.96,
  } as ViewStyle,

  tlmcHeroBtnReady: {
    backgroundColor: "rgba(16,185,129,0.92)",
    borderColor: "rgba(110,255,198,0.28)",
  } as ViewStyle,

  tlmcHeroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } as ViewStyle,

  tlmcLockedPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(7,17,31,0.14)",
    borderWidth: 1,
    borderColor: "rgba(7,17,31,0.12)",
  } as ViewStyle,

  tlmcLockedPillReady: {
    backgroundColor: "rgba(7,17,31,0.16)",
    borderColor: "rgba(7,17,31,0.18)",
  } as ViewStyle,

  tlmcHeroRightLocked: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,17,31,0.10)",
    borderWidth: 1,
    borderColor: "rgba(7,17,31,0.10)",
  } as ViewStyle,

  tlmcHeroRightReady: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,17,31,0.16)",
    borderWidth: 1,
    borderColor: "rgba(7,17,31,0.18)",
  } as ViewStyle,

  topInfoCard: {
    marginTop: 2,
    marginBottom: 10,
    minHeight: 82,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "rgba(80,140,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(160,205,255,0.26)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  } as ViewStyle,

  topInfoLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingRight: 12,
  } as ViewStyle,

  topInfoIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(207,226,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(207,226,255,0.16)",
  } as ViewStyle,

  topInfoRight: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(207,226,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(207,226,255,0.14)",
  } as ViewStyle,

  topInfoCardDm: {
    backgroundColor: "rgba(110,86,28,0.22)",
    borderColor: "rgba(246,217,140,0.24)",
  } as ViewStyle,

  topInfoCardChurch: {
    backgroundColor: "rgba(90,66,150,0.23)",
    borderColor: "rgba(216,197,255,0.24)",
  } as ViewStyle,

  topInfoCardFriend: {
    backgroundColor: "rgba(28,102,78,0.22)",
    borderColor: "rgba(190,255,210,0.22)",
  } as ViewStyle,

  topInfoCardTyping: {
    backgroundColor: "rgba(40,86,142,0.24)",
    borderColor: "rgba(159,215,255,0.22)",
  } as ViewStyle,

  topInfoCardAudio: {
    backgroundColor: "rgba(31,100,92,0.24)",
    borderColor: "rgba(159,240,225,0.22)",
  } as ViewStyle,

  topInfoIconDm: {
    backgroundColor: "rgba(246,217,140,0.10)",
    borderColor: "rgba(246,217,140,0.18)",
  } as ViewStyle,

  topInfoIconChurch: {
    backgroundColor: "rgba(216,197,255,0.10)",
    borderColor: "rgba(216,197,255,0.18)",
  } as ViewStyle,

  topInfoIconFriend: {
    backgroundColor: "rgba(190,255,210,0.10)",
    borderColor: "rgba(190,255,210,0.18)",
  } as ViewStyle,

  topInfoIconTyping: {
    backgroundColor: "rgba(159,215,255,0.10)",
    borderColor: "rgba(159,215,255,0.18)",
  } as ViewStyle,

  topInfoIconAudio: {
    backgroundColor: "rgba(159,240,225,0.10)",
    borderColor: "rgba(159,240,225,0.18)",
  } as ViewStyle,

  topInfoRightDm: {
    backgroundColor: "rgba(246,217,140,0.08)",
    borderColor: "rgba(246,217,140,0.14)",
  } as ViewStyle,

  topInfoRightChurch: {
    backgroundColor: "rgba(216,197,255,0.08)",
    borderColor: "rgba(216,197,255,0.14)",
  } as ViewStyle,

  topInfoRightFriend: {
    backgroundColor: "rgba(190,255,210,0.08)",
    borderColor: "rgba(190,255,210,0.14)",
  } as ViewStyle,

  topInfoRightTyping: {
    backgroundColor: "rgba(159,215,255,0.08)",
    borderColor: "rgba(159,215,255,0.14)",
  } as ViewStyle,

  topInfoRightAudio: {
    backgroundColor: "rgba(159,240,225,0.08)",
    borderColor: "rgba(159,240,225,0.14)",
  } as ViewStyle,

  topInfoTextOnly: {
    flex: 1,
    minHeight: 96,
    justifyContent: "center",
  } as ViewStyle,

  topInfoMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  } as ViewStyle,

  topInfoKindDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
  } as ViewStyle,

  topInfoBottomRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  } as ViewStyle,

  topInfoLiveTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  } as ViewStyle,

  topInfoLiveFill: {
    width: "34%",
    height: "100%",
    borderRadius: 999,
    opacity: 0.95,
  } as ViewStyle,

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,8,18,0.76)",
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,

  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    backgroundColor: "rgba(5,12,24,0.97)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.36,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  } as ViewStyle,

  
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  } as ViewStyle,

  modalIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
  } as ViewStyle,

  modalClose: {
    marginLeft: "auto",
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  } as ViewStyle,
modalGlow: {
    position: "absolute",
    top: -24,
    right: -24,
    width: 150,
    height: 150,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.08)",
  } as ViewStyle,

  accessCard: {
    marginTop: 16,
    marginBottom: 2,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
  } as ViewStyle,

  accessCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
  } as ViewStyle,

  accessCardBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  } as ViewStyle,

  accessStageRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 38,
    gap: 10,
  } as ViewStyle,

  accessStageDivider: {
    height: 1,
    marginVertical: 4,
    marginLeft: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
  } as ViewStyle,

  accessDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  } as ViewStyle,

  accessDotGold: {
    backgroundColor: "rgba(217,179,95,0.95)",
    borderColor: "rgba(255,225,160,0.92)",
  } as ViewStyle,

  accessDotBlue: {
    backgroundColor: "rgba(90,170,255,0.95)",
    borderColor: "rgba(150,210,255,0.95)",
  } as ViewStyle,

  accessStatusReady: {
    minWidth: 72,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  } as ViewStyle,

  accessStatusNext: {
    minWidth: 72,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(80,160,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(80,160,255,0.35)",
  } as ViewStyle,

  accessStatusLocked: {
    minWidth: 72,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  } as ViewStyle,

  modalBtn: {
    marginTop: 16,
    minHeight: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
  } as ViewStyle,
});

const t = StyleSheet.create({
  hTitle: { color: "white", fontWeight: "900", fontSize: 22, letterSpacing: 0.2 } as TextStyle,
  hSub: { marginTop: 2, color: "rgba(255,255,255,0.58)", fontWeight: "700", fontSize: 11 } as TextStyle,

  filterTitle: { color: "white", fontWeight: "900", fontSize: 15, letterSpacing: 0.2, flexShrink: 1 } as TextStyle,
  filterSubTitle: { color: "rgba(255,255,255,0.60)", fontWeight: "800", fontSize: 11.5 } as TextStyle,
  filterHint: { color: "rgba(255,255,255,0.58)", fontWeight: "700", fontSize: 11, marginTop: 4 } as TextStyle,

  filterChipText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "900",
    fontSize: 12,
    textAlign: "center",
  } as TextStyle,

  filterChipTextActive: { color: "white" } as TextStyle,
  filterChipTextAll: { color: "rgba(255,225,150,0.98)" } as TextStyle,
  filterChipTextChurch: { color: "rgba(220,205,255,0.98)" } as TextStyle,
  filterChipTextDm: { color: "rgba(170,220,255,0.98)" } as TextStyle,
  filterChipTextFriend: { color: "rgba(190,255,210,0.98)" } as TextStyle,

  liveText: { color: "rgba(255,255,255,0.70)", fontWeight: "800", fontSize: 10.5 } as TextStyle,

  tlmcHeroEyebrow: {
    color: "#07111F",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    opacity: 0.75,
  } as TextStyle,

  tlmcHeroTitle: {
    marginTop: 1,
    color: "#07111F",
    fontWeight: "900",
    fontSize: 17,
    lineHeight: 19,
  } as TextStyle,

  tlmcHeroSub: {
    marginTop: 1,
    color: "rgba(7,17,31,0.68)",
    fontWeight: "800",
    fontSize: 10,
  } as TextStyle,

  tlmcLockedPillText: {
    color: "#07111F",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 0.8,
  } as TextStyle,

  tlmcHeroMeta: {
    marginTop: 3,
    color: "rgba(7,17,31,0.58)",
    fontWeight: "800",
    fontSize: 10,
  } as TextStyle,

  topInfoEyebrow: {
    color: "#CFE2FF",
    fontWeight: "900",
    fontSize: 9.5,
    letterSpacing: 0.9,
  } as TextStyle,

  topInfoTitle: {
    marginTop: 1,
    color: "white",
    fontWeight: "900",
    fontSize: 15,
    lineHeight: 18,
  } as TextStyle,

  topInfoSub: {
    marginTop: 3,
    color: "rgba(235,243,255,0.78)",
    fontWeight: "700",
    fontSize: 10.5,
    lineHeight: 14,
  } as TextStyle,

  topInfoEyebrowDm: { color: "#F6D98C" } as TextStyle,
  topInfoEyebrowChurch: { color: "#D8C5FF" } as TextStyle,
  topInfoEyebrowFriend: { color: "#BEFFD2" } as TextStyle,
  topInfoEyebrowTyping: { color: "#9FD7FF" } as TextStyle,
  topInfoEyebrowAudio: { color: "#9FF0E1" } as TextStyle,

  topInfoTitleDm: { color: "rgba(255,242,205,0.98)" } as TextStyle,
  topInfoTitleChurch: { color: "rgba(240,232,255,0.98)" } as TextStyle,
  topInfoTitleFriend: { color: "rgba(228,255,236,0.98)" } as TextStyle,
  topInfoTitleTyping: { color: "rgba(227,244,255,0.98)" } as TextStyle,
  topInfoTitleAudio: { color: "rgba(223,255,249,0.98)" } as TextStyle,

  topInfoSubDm: { color: "rgba(255,228,172,0.82)" } as TextStyle,
  topInfoSubChurch: { color: "rgba(220,203,255,0.82)" } as TextStyle,
  topInfoSubFriend: { color: "rgba(187,247,208,0.82)" } as TextStyle,
  topInfoSubTyping: { color: "rgba(184,226,255,0.84)" } as TextStyle,
  topInfoSubAudio: { color: "rgba(185,248,235,0.84)" } as TextStyle,

  topInfoMiniHint: {
    color: "rgba(255,255,255,0.42)",
    fontWeight: "800",
    fontSize: 9.5,
    letterSpacing: 0.35,
    textTransform: "uppercase",
  } as TextStyle,

  modalTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.1,
  } as TextStyle,

  modalBody: {
    marginTop: 14,
    color: "rgba(255,255,255,0.78)",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 22,
  } as TextStyle,

  modalHint: {
    marginTop: 14,
    color: "rgba(245,214,140,0.92)",
    fontWeight: "800",
    fontSize: 13,
    lineHeight: 22,
  } as TextStyle,

  accessCardEyebrow: {
    color: "rgba(255,225,160,0.92)",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 1.2,
  } as TextStyle,

  accessCardBadgeText: {
    color: "#F4D06F",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 0.6,
  } as TextStyle,

  accessStageTitle: {
    flex: 1,
    color: "rgba(255,255,255,0.90)",
    fontWeight: "800",
    fontSize: 13,
  } as TextStyle,

  accessStageStatusReady: {
    color: "rgba(255,225,160,0.96)",
    fontWeight: "900",
    fontSize: 11,
  } as TextStyle,

  accessStageStatusMid: {
    color: "rgba(150,210,255,0.96)",
    fontWeight: "900",
    fontSize: 11,
  } as TextStyle,

  accessStageStatusLocked: {
    color: "rgba(255,255,255,0.56)",
    fontWeight: "900",
    fontSize: 11,
  } as TextStyle,

  modalBtnText: {
    color: "white",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 0.2,
  } as TextStyle,

  search: {
    flex: 1,
    marginLeft: 10,
    color: "rgba(255,255,255,0.90)",
    fontWeight: "800",
    fontSize: 13.5,
  } as TextStyle,
  avatarText: { color: "rgba(217,179,95,0.96)", fontWeight: "900", fontSize: 16 } as TextStyle,
  title: {
  flex: 1,
  color: "white",
  fontWeight: "900",
  fontSize: 14,
  lineHeight: 16,
} as TextStyle,
  kindBadgeText: { color: "rgba(217,179,95,0.98)", fontWeight: "900", fontSize: 10, letterSpacing: 0.35 } as TextStyle,
  time: { marginLeft: 10, color: "rgba(255,255,255,0.62)", fontWeight: "800", fontSize: 11 } as TextStyle,
  sub: {
  marginTop: 0,
  color: "rgba(255,255,255,0.64)",
  fontWeight: "700",
  fontSize: 11,
  lineHeight: 15,
} as TextStyle,
  badgeText: { color: "rgba(217,179,95,0.99)", fontWeight: "900", fontSize: 11 } as TextStyle,

  avatarTextDm: { color: "rgba(255,225,150,0.98)" } as TextStyle,
  avatarTextChurch: { color: "rgba(220,205,255,0.98)" } as TextStyle,
  avatarTextFriend: { color: "rgba(190,255,210,0.98)" } as TextStyle,

  titleDm: { color: "rgba(255,244,214,0.99)" } as TextStyle,
  titleChurch: { color: "rgba(241,233,255,0.99)" } as TextStyle,
  titleFriend: { color: "rgba(231,255,239,0.99)" } as TextStyle,

  subDm: { color: "rgba(255,228,178,0.80)" } as TextStyle,
  subChurch: { color: "rgba(221,204,255,0.80)" } as TextStyle,
  subFriend: { color: "rgba(188,248,212,0.80)" } as TextStyle,

  timeDm: { color: "rgba(255,229,182,0.90)" } as TextStyle,
  timeChurch: { color: "rgba(224,210,255,0.90)" } as TextStyle,
  timeFriend: { color: "rgba(194,250,216,0.90)" } as TextStyle,
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 15 } as TextStyle,
  emptySub: { marginTop: 6, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 11 } as TextStyle,

  topTabText: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "800", letterSpacing: 0.2 } as TextStyle,
  topTabTextActive: { color: "#07111F" } as TextStyle,
  ministryHintTitle: { color: "rgba(255,255,255,0.96)", fontSize: 13, fontWeight: "800" } as TextStyle,
  ministryHintSub: { color: "rgba(255,255,255,0.62)", fontSize: 12, marginTop: 3 } as TextStyle,
});
