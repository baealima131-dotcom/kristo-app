import React, { useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { getBranchSignal, subscribeKingdomEvents } from "@/src/lib/kingdomEventsStore";

const BG = "#0A1220";
const CARD = "rgba(16,22,36,0.94)";
const CARD_SOFT = "rgba(255,255,255,0.04)";
const TEXT = "rgba(255,255,255,0.96)";
const SUB = "rgba(255,255,255,0.68)";
const GOLD = "rgba(217,179,95,0.92)";
const GOLD_SOFT = "rgba(217,179,95,0.14)";
const BORDER = "rgba(255,255,255,0.10)";
const PURPLE = "rgba(124,92,255,0.18)";
const BLUE = "rgba(67,111,255,0.12)";
const GREEN = "rgba(16,185,129,0.14)";

type ChurchUnit = {
  id: string;
  title: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  state?: "live" | "soon" | "locked" | "expired";
  startAt?: number;
  endAt?: number;
};

type ChurchProjectGroup = {
  id: string;
  title: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  units: ChurchUnit[];
};

const MINUTE = 60 * 1000;

function formatBadgeCountdown(ms: number) {
  const totalMinutes = Math.max(0, Math.ceil(ms / MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function getProjectGroups(
  moralSignal: ReturnType<typeof getBranchSignal>,
  leadershipSignal: ReturnType<typeof getBranchSignal>
): ChurchProjectGroup[] {
  return [
    {
      id: "crown-of-destiny",
      title: "CROWN OF DESTINY",
      sub: "Mission za maadili ulimwenguni na ushirikiano wa makanisa yote.",
      icon: "star-outline",
      units: [
        {
          id: "moral-reform",
          title: "Moral Reform",
          sub: "Campaign ya maadili",
          icon: "ribbon-outline",
          state: moralSignal.state,
          startAt: moralSignal.startAt,
          endAt: moralSignal.endAt,
        },
        {
          id: "leadership-order",
          title: "Leadership Order",
          sub: "Order ya viongozi",
          icon: "people-outline",
          state: leadershipSignal.state,
          startAt: leadershipSignal.startAt,
          endAt: leadershipSignal.endAt,
        },
        { id: "family-restoration", title: "Family Restoration", sub: "Kurejesha familia", icon: "home-outline", state: "locked" },
        { id: "education-light", title: "Education Light", sub: "Mafundisho ya nuru", icon: "school-outline", state: "locked" },
        { id: "media-voice", title: "Media & Voice", sub: "Content na campaign", icon: "megaphone-outline", state: "locked" },
        { id: "policy-watch", title: "Policy Watch", sub: "Watch ya jamii", icon: "eye-outline", state: "locked" },
        { id: "community-action", title: "Community Action", sub: "Service kwa jamii", icon: "people-circle-outline", state: "locked" },
        { id: "prayer-shield", title: "Prayer Shield", sub: "Prayer covering", icon: "shield-outline", state: "locked" },
      ],
    },
    {
      id: "agenda",
      title: "AGENDA",
      sub: "Direction, planning, na alignment ya church projects.",
      icon: "document-text-outline",
      units: [
        { id: "strategy-board", title: "Strategy Board", sub: "Main planning", icon: "compass-outline", state: "locked" },
        { id: "calendar-flow", title: "Calendar Flow", sub: "Events & timing", icon: "calendar-outline", state: "locked" },
        { id: "target-map", title: "Target Map", sub: "Country & church map", icon: "map-outline", state: "locked" },
        { id: "priority-room", title: "Priority Room", sub: "Core priorities", icon: "flash-outline", state: "locked" },
      ],
    },
    {
      id: "mission",
      title: "MISSION",
      sub: "Outreach, assignments, na execution ya mission fields.",
      icon: "compass-outline",
      units: [
        { id: "field-mission", title: "Field Mission", sub: "Mission coordination", icon: "navigate-outline", state: "locked" },
        { id: "church-outreach", title: "Church Outreach", sub: "Outreach ya makanisa", icon: "business-outline", state: "locked" },
        { id: "follow-up", title: "Follow-up", sub: "Care ya watu wapya", icon: "repeat-outline", state: "locked" },
        { id: "mission-reports", title: "Mission Reports", sub: "Reports za teams", icon: "receipt-outline", state: "locked" },
      ],
    },
    {
      id: "ethics-council",
      title: "ETHICS COUNCIL",
      sub: "Mwongozo wa maadili kwa leaders, members, na jamii.",
      icon: "shield-outline",
      units: [
        { id: "pastor-guidance", title: "Pastor Guidance", sub: "Mwongozo wa pastors", icon: "person-outline", state: "locked" },
        { id: "member-discipline", title: "Member Discipline", sub: "Order ya members", icon: "checkmark-done-outline", state: "locked" },
        { id: "youth-purity", title: "Youth Purity", sub: "Discipline ya vijana", icon: "flame-outline", state: "locked" },
        { id: "case-review", title: "Case Review", sub: "Wisdom ya matters", icon: "reader-outline", state: "locked" },
      ],
    },
    {
      id: "global-prayer",
      title: "GLOBAL PRAYER",
      sub: "Prayer network ya makanisa kwa dunia nzima.",
      icon: "globe-outline",
      units: [
        { id: "nations-prayer", title: "Nations Prayer", sub: "Prayer kwa mataifa", icon: "earth-outline", state: "locked" },
        { id: "church-covering", title: "Church Covering", sub: "Prayer kwa makanisa", icon: "shield-checkmark-outline", state: "locked" },
        { id: "altar-watch", title: "Altar Watch", sub: "Prayer watch", icon: "moon-outline", state: "locked" },
        { id: "urgent-requests", title: "Urgent Requests", sub: "Prayer alerts", icon: "notifications-outline", state: "locked" },
      ],
    },
    {
      id: "church-growth",
      title: "CHURCH GROWTH",
      sub: "Growth systems, discipleship, na expansion.",
      icon: "trending-up-outline",
      units: [
        { id: "discipleship-path", title: "Discipleship Path", sub: "Growth ya members", icon: "git-branch-outline", state: "locked" },
        { id: "branch-expansion", title: "Branch Expansion", sub: "Kuongeza branches", icon: "git-network-outline", state: "locked" },
        { id: "leaders-build", title: "Leaders Build", sub: "Kuinua viongozi", icon: "people-outline", state: "locked" },
        { id: "retention-care", title: "Retention Care", sub: "Care & stability", icon: "heart-outline", state: "locked" },
      ],
    },
    {
      id: "family-order",
      title: "FAMILY ORDER",
      sub: "Family restoration, parenting, na nyumba katika order.",
      icon: "home-outline",
      units: [
        { id: "marriage-room", title: "Marriage Room", sub: "Nguvu ya ndoa", icon: "heart-circle-outline", state: "locked" },
        { id: "parenting-flow", title: "Parenting Flow", sub: "Malezi na order", icon: "people-circle-outline", state: "locked" },
        { id: "home-peace", title: "Home Peace", sub: "Amani ya nyumba", icon: "rose-outline", state: "locked" },
        { id: "family-counsel", title: "Family Counsel", sub: "Counsel ya familia", icon: "chatbox-ellipses-outline", state: "locked" },
      ],
    },
    {
      id: "youth-fire",
      title: "YOUTH FIRE",
      sub: "Kuwasha vijana katika purity, purpose, na service.",
      icon: "flame-outline",
      units: [
        { id: "purpose-lab", title: "Purpose Lab", sub: "Direction ya vijana", icon: "bulb-outline", state: "locked" },
        { id: "purity-watch", title: "Purity Watch", sub: "Usafi na discipline", icon: "eye-outline", state: "locked" },
        { id: "service-force", title: "Service Force", sub: "Youth in action", icon: "flash-outline", state: "locked" },
        { id: "worship-wave", title: "Worship Wave", sub: "Moto wa worship", icon: "musical-notes-outline", state: "locked" },
      ],
    },
  ];
}

function UnitCard({
  item,
  onPress,
}: {
  item: ChurchUnit;
  onPress: () => void;
}) {
  const now = Date.now();

  let state: "live" | "soon" | "locked" | "expired" = item.state || "live";

  if (state !== "locked" && item.startAt && item.endAt) {
    if (now < item.startAt) state = "soon";
    else if (now >= item.endAt) state = "expired";
    else state = "live";
  }

  const isDisabled = state === "locked" || state === "expired";

  let badgeLabel = "LIVE";
  if (state === "soon" && item.startAt) {
    badgeLabel = `IN ${formatBadgeCountdown(item.startAt - now)}`;
  } else if (state === "live" && item.endAt) {
    badgeLabel = `${formatBadgeCountdown(item.endAt - now)}`;
  } else if (state === "locked") {
    badgeLabel = "LOCKED";
  } else if (state === "expired") {
    badgeLabel = "ENDED";
  }

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        s.unitCard,
        state === "live" ? s.liveCard : null,
        state === "soon" ? s.soonCard : null,
        state === "locked" ? s.lockedCard : null,
        state === "expired" ? s.expiredCard : null,
        isDisabled
          ? null
          : pressed
          ? ({ opacity: 0.96, transform: [{ scale: 0.99 }] } as ViewStyle)
          : null,
      ]}
    >
      <View style={s.unitGlassTop} />
      <View pointerEvents="none" style={s.unitGlassEdge} />
      <View style={s.unitGlow} />

      <View style={s.unitTopRow}>
        <View
          style={[
            s.unitIconWrap,
            state === "soon" ? s.soonIconWrap : null,
            state === "locked" ? s.lockedIconWrap : null,
          ]}
        >
          <Ionicons
            name={
              state === "locked"
                ? "lock-closed-outline"
                : state === "expired"
                ? "time-outline"
                : item.icon
            }
            size={18}
            color={
              state === "locked"
                ? "#FF6B6B"
                : state === "expired"
                ? "#FF8A8A"
                : state === "soon"
                ? "#FFD089"
                : "#E3D6FF"
            }
          />
        </View>

        {state === "live" ? (
          <Text numberOfLines={1} style={t.liveMiniText}>
            {String(badgeLabel).includes("LEFT") ? badgeLabel : `${badgeLabel} LEFT`}
          </Text>
        ) : (
          <View
            style={[
              s.statusBadge,
              state === "soon" ? s.soon : null,
              state === "locked" ? s.locked : null,
              state === "locked" ? s.lockedBadge : null,
              state === "expired" ? s.expired : null,
            ]}
          >
            <Text style={t.statusText}>{badgeLabel}</Text>
          </View>
        )}
      </View>

      <Text style={t.unitTitle} numberOfLines={2}>
        {item.title}
      </Text>

      <Text style={t.unitSub} numberOfLines={2}>
        {state === "locked"
          ? "Unavailable now"
          : state === "expired"
          ? "Time ended"
          : state === "soon" && item.startAt
          ? `Starts in ${formatBadgeCountdown(item.startAt - now)}`
          : state === "live"
          ? "Mission iko tayari"
          : item.sub}
      </Text>
    </Pressable>
  );
}

function ProjectSection({
  group,
  onOpenUnit,
}: {
  group: ChurchProjectGroup;
  onOpenGroup: () => void;
  onOpenUnit: (item: ChurchUnit) => void;
}) {
  return (
    <View style={s.projectSectionCard}>
      <View style={s.projectSectionGlow} />

      <View style={s.projectHeaderRow}>
        <View style={s.projectHeaderLeft}>
          <View style={s.projectIconWrap}>
            <Ionicons name={group.icon} size={20} color={GOLD} />
          </View>

          <View style={{ flex: 1, paddingRight: 54 }}>
            <Text style={t.projectTag}>TLMC PROJECT</Text>
            <Text style={t.projectTitle}>{group.title}</Text>
          </View>
        </View>

        <View style={s.projectCountPill}>
          <Text style={t.projectCountText}>{group.units.length}</Text>
        </View>
      </View>

      

      <View style={s.unitGrid}>
        {group.units.map((item) => (
          <UnitCard key={item.id} item={item} onPress={() => onOpenUnit(item)} />
        ))}
      </View>
    </View>
  );
}

export default function MinistryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarH = useBottomTabBarHeight();
  const [, setTick] = React.useState(0);

  useEffect(() => {
    const unsub = subscribeKingdomEvents(() => setTick((v) => v + 1));
    const id = setInterval(() => setTick((v) => v + 1), 30000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  const moralSignal = getBranchSignal("moral-reform");
  const leadershipSignal = getBranchSignal("leadership-order");


  const PROJECT_GROUPS = React.useMemo(
    () => getProjectGroups(moralSignal, leadershipSignal),
    [moralSignal, leadershipSignal]
  );

  const openProjectGroup = (group: ChurchProjectGroup) => {
    const activeUnit = group.units.find((x) => x.state && x.state !== "locked" && x.state !== "expired");
    if (!activeUnit) return;
    router.push(
      (`/more/my-church-room/messages/${encodeURIComponent("tlmc_project_" + group.id)}?title=${encodeURIComponent(
        "TLMC " + group.title
      )}&sub=${encodeURIComponent(group.sub)}&tab=ministries&source=messages_ministry` as any)
    );
  };

  const openUnit = (group: ChurchProjectGroup, item: ChurchUnit) => {
    router.push(
      (`/more/my-church-room/messages/${encodeURIComponent("tlmc_unit_" + item.id)}?title=${encodeURIComponent(
        group.title + " • " + item.title
      )}&sub=${encodeURIComponent(item.sub)}&tab=ministries&source=messages_ministry` as any)
    );
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}
        >
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={t.hTitle}>The Last Mission of Christ</Text>
          <Text style={t.hSub} numberOfLines={1}>
            TLMC live mission center
          </Text>
        </View>

        <View style={s.hBtn}>
          <Ionicons name="albums-outline" size={18} color={GOLD} />
        </View>
      </View>

      <View style={s.heroCard}>
        <View style={s.heroGlow} />
        <Text style={t.heroEyebrow}>TLMC</Text>
        <Text style={t.heroTitle}>
          {moralSignal.state === "live"
            ? `${moralSignal.title || "Moral Reform"} iko tayari`
            : moralSignal.state === "soon"
            ? `${moralSignal.title || "Moral Reform"} inasubiri`
            : leadershipSignal.state === "live"
            ? `${leadershipSignal.title || "Leadership Order"} iko tayari`
            : leadershipSignal.state === "soon"
            ? `${leadershipSignal.title || "Leadership Order"} inasubiri`
            : "Church Projects inside TLMC"}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarH + insets.bottom + 52 }}
      >
        <View style={s.sectionWrap}>
          <View style={s.projectStack}>
            {PROJECT_GROUPS.map((group) => (
              <ProjectSection
                key={group.id}
                group={group}
                onOpenGroup={() => openProjectGroup(group)}
                onOpenUnit={(item) => openUnit(group, item)}
              />
            ))}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
  } as ViewStyle,

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
    paddingBottom: 6,
  } as ViewStyle,

  hBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: BORDER,
    marginRight: 10,
  } as ViewStyle,

  heroCard: {
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(12,22,40,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  } as ViewStyle,

  heroGlow: {
    position: "absolute",
    top: -34,
    right: -28,
    width: 104,
    height: 104,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.08)",
  } as ViewStyle,

  sectionWrap: {
    marginTop: 0,
    marginBottom: 4,
  } as ViewStyle,

  projectStack: {
    marginTop: 16,
    gap: 20,
  } as ViewStyle,

  projectSectionCard: {
    borderRadius: 30,
    padding: 18,
    backgroundColor: "rgba(15,20,34,0.98)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.12)",
    overflow: "hidden",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  } as ViewStyle,

  projectSectionGlow: {
    position: "absolute",
    top: -34,
    right: -26,
    width: 138,
    height: 138,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.07)",
  } as ViewStyle,

  projectHeaderRow: {
    gap: 10,
  } as ViewStyle,

  projectHeaderLeft: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    paddingRight: 54,
  } as ViewStyle,

  projectIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  } as ViewStyle,

  projectCountPill: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  } as ViewStyle,

  projectDivider: {
    marginTop: 14,
    marginBottom: 4,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  } as ViewStyle,

  unitGrid: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
    columnGap: 0,
  } as ViewStyle,

  liveCard: {
    borderColor: "rgba(36,214,158,0.32)",
    backgroundColor: "rgba(255,255,255,0.07)",
  } as ViewStyle,

  soonCard: {
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(255,255,255,0.066)",
  } as ViewStyle,

  lockedCard: {
    opacity: 0.78,
    borderColor: "rgba(148,163,184,0.22)",
    backgroundColor: "rgba(255,255,255,0.045)",
  } as ViewStyle,

  expiredCard: {
    opacity: 0.76,
    borderColor: "rgba(239,68,68,0.20)",
    backgroundColor: "rgba(255,255,255,0.042)",
  } as ViewStyle,


  unitCard: {
    width: "48.2%",
    minHeight: 166,
    borderRadius: 28,
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 16,
    backgroundColor: "rgba(255,255,255,0.052)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  } as ViewStyle,

  

  unitTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  } as ViewStyle,

  statusBadge: {
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
  } as ViewStyle,

  live: {
    backgroundColor: "rgba(16,185,129,0.20)",
    borderColor: "rgba(36,214,158,0.46)",
  } as ViewStyle,

  soon: {
    backgroundColor: "rgba(217,179,95,0.18)",
    borderColor: "rgba(217,179,95,0.38)",
  } as ViewStyle,

  locked: {
    backgroundColor: "rgba(148,163,184,0.15)",
    borderColor: "rgba(148,163,184,0.28)",
  } as ViewStyle,

  expired: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderColor: "rgba(239,68,68,0.30)",
  } as ViewStyle,

  lockedBadge: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
  } as ViewStyle,

  unitGlow: {
    position: "absolute",
    bottom: -18,
    right: -14,
    width: 96,
    height: 96,
    borderRadius: 999,
    backgroundColor: "rgba(124,92,255,0.16)",
  } as ViewStyle,

  unitIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(124,92,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(160,132,255,0.26)",
    marginBottom: 14,
    shadowColor: "#7C5CFF",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  } as ViewStyle,

  soonIconWrap: {
    backgroundColor: "rgba(217,179,95,0.15)",
    borderColor: "rgba(217,179,95,0.36)",
  } as ViewStyle,

  lockedIconWrap: {
    backgroundColor: "rgba(255,107,107,0.06)",
    borderColor: "rgba(255,107,107,0.18)",
    shadowColor: "#FF6B6B",
    shadowOpacity: 0.05,
  } as ViewStyle,

  unitGlassTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 52,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "rgba(255,255,255,0.022)",
  } as ViewStyle,

  unitGlassSheen: {
    display: "none",
  } as ViewStyle,

  unitGlassEdge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.018)",
  } as ViewStyle,

  emptyWrap: {
    marginTop: 14,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.028)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
});

const t = StyleSheet.create({
  hTitle: {
    color: "white",
    fontSize: 19,
    fontWeight: "900",
  } as TextStyle,

  hSub: {
    marginTop: 0,
    color: SUB,
    fontSize: 11,
    fontWeight: "700",
  } as TextStyle,

  heroEyebrow: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.0,
  } as TextStyle,

  heroTitle: {
    marginTop: 2,
    color: "white",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22,
  } as TextStyle,

  sectionTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
    opacity: 0.96,
    marginBottom: 0,
  } as TextStyle,

  projectTag: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  } as TextStyle,

  projectTitle: {
    marginTop: 2,
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 22,
  } as TextStyle,

  projectCountText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  } as TextStyle,

  statusText: {
    fontSize: 8,
    fontWeight: "900",
    color: "white",
    letterSpacing: 0.40,
  } as TextStyle,

  liveMiniText: {
    color: "rgba(99,255,218,0.96)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginLeft: 10,
    marginRight: 2,
  } as TextStyle,

  unitTitle: {
    color: "rgba(255,255,255,0.98)",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
    letterSpacing: 0.1,
    paddingRight: 4,
  } as TextStyle,

  unitSub: {
    marginTop: 10,
    color: "rgba(255,255,255,0.76)",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
    paddingRight: 6,
  } as TextStyle,

  emptySub: {
    marginTop: 6,
    color: SUB,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  } as TextStyle,
});
