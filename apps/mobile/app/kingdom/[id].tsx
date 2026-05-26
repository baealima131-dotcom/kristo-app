import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Modal, type ViewStyle, type TextStyle } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { createKingdomEvent, listKingdomEvents, subscribeKingdomEvents } from "@/src/lib/kingdomEventsStore";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";

type RoomAction = {
  id: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
};

type RoomDetail = {
  title: string;
  subtitle: string;
  command: string;
  desc: string;
  bullets: string[];
  actions: RoomAction[];
  icon: keyof typeof Ionicons.glyphMap;
};

type ScopePickerState = {
  visible: boolean;
  actionId: string;
  actionTitle: string;
  countries: string[];
  churches: string[];
  ministries: string[];
  targets: string[];
};

type EventPlannerState = {
  visible: boolean;
  projectId: string;
  projectTitle: string;
  branchId: string;
  branchTitle: string;
  startsInMin: number;
  durationMin: number;
  countries: string[];
  churches: string[];
  ministries: string[];
  targets: string[];
};

const BOX_DETAILS: Record<string, RoomDetail> = {
  world: {
    title: "THE WORLD",
    subtitle: "Global direction",
    command: "WRLD1",
    desc: "Hapa ndipo unatazama direction ya dunia, movement, routes, na mipango mikubwa ya juu.",
    bullets: ["Global routes", "Direction", "Regions", "Expansion"],
    actions: [
      { id: "regions", title: "Regions", desc: "Angalia maeneo na mwelekeo wake.", icon: "map-outline" },
      { id: "routes", title: "Routes", desc: "Open routes na movement line.", icon: "git-network-outline" },
      { id: "vision", title: "Vision", desc: "Top direction ya movement.", icon: "globe-outline" },
    ],
    icon: "earth-outline",
  },

  security: {
    title: "SECURITY",
    subtitle: "Gate • trust • approvals",
    command: "SEC9",
    desc: "Sehemu ya kulinda gate, approvals, trust, access, na usalama wa mfumo mzima.",
    bullets: ["Access", "Approvals", "Trusted devices", "Alerts"],
    actions: [
      { id: "gate", title: "Gate Control", desc: "Manage access ya kuingia.", icon: "shield-outline", primary: true },
      { id: "trust", title: "Trust Devices", desc: "Approve trusted devices.", icon: "phone-portrait-outline" },
      { id: "alerts", title: "Alerts", desc: "Tazama tahadhari za security.", icon: "notifications-outline" },
    ],
    icon: "shield-checkmark-outline",
  },

  churches: {
    title: "MAKANISA",
    subtitle: "Churches • leaders • members",
    command: "CHR7",
    desc: "Hapa unasimamia makanisa, viongozi, members, ministries, na mpangilio wa huduma kwa kila church ndani ya system.",
    bullets: [
      "Churches overview",
      "Leaders Room management",
      "Members list",
      "Ministries connection",
      "Reports za church",
    ],
    actions: [
      { id: "project:crown-of-destiny", title: "CROWN OF DESTINY", desc: "Mission za maadili ulimwenguni na collaboration ya makanisa.", icon: "star-outline", primary: true },
      { id: "project:agenda", title: "AGENDA", desc: "Direction, planning, na alignment ya church projects.", icon: "document-text-outline" },
      { id: "project:mission", title: "MISSION", desc: "Outreach, assignments, na execution ya field mission.", icon: "compass-outline" },
      { id: "project:ethics-council", title: "ETHICS COUNCIL", desc: "Mwongozo wa maadili kwa leaders, members, na jamii.", icon: "shield-outline" },
      { id: "project:global-prayer", title: "GLOBAL PRAYER", desc: "Prayer network ya makanisa kwa dunia nzima.", icon: "globe-outline" },
      { id: "project:church-growth", title: "CHURCH GROWTH", desc: "Growth systems, discipleship, na expansion.", icon: "trending-up-outline" },
      { id: "project:family-order", title: "FAMILY ORDER", desc: "Family restoration, parenting, na nyumba katika order.", icon: "home-outline" },
      { id: "project:youth-fire", title: "YOUTH FIRE", desc: "Kuwasha vijana katika purity, purpose, na service.", icon: "flame-outline" },
    ],
    icon: "business-outline",
  },

  report: {
    title: "REPORT",
    subtitle: "Reports • stats • logs",
    command: "RPT3",
    desc: "Room ya report, stats, maendeleo, logs, na ufuatiliaji wa kila kitu muhimu ndani ya system.",
    bullets: ["Stats", "Logs", "Progress", "Overview"],
    actions: [
      { id: "stats", title: "Stats", desc: "System numbers na totals.", icon: "bar-chart-outline" },
      { id: "logs", title: "Logs", desc: "Fuata logs za ndani.", icon: "receipt-outline" },
      { id: "progress", title: "Progress", desc: "Track maendeleo.", icon: "trending-up-outline" },
    ],
    icon: "stats-chart-outline",
  },

  agents: {
    title: "AGENTS",
    subtitle: "Field agents • operators",
    command: "AGT6",
    desc: "Hapa unasimamia agents, roles zao, assignments, na tracking ya kazi zao.",
    bullets: ["Agents", "Assignments", "Operators", "Tracking"],
    actions: [
      { id: "all-agents", title: "All Agents", desc: "List ya agents wote.", icon: "people-circle-outline" },
      { id: "assignments", title: "Assignments", desc: "Manage work assignments.", icon: "clipboard-outline" },
      { id: "tracking", title: "Tracking", desc: "Track status ya agent.", icon: "locate-outline" },
    ],
    icon: "people-outline",
  },

  "office-core": {
    title: "OFFICE CORE",
    subtitle: "Main control • private center",
    command: "CORE1",
    desc: "Hii ni center ya ndani ya office core kwa control kuu, access, private planning, na movement ya command center.",
    bullets: ["Main control", "Private center", "Access", "Command planning"],
    actions: [
      { id: "overview", title: "Overview", desc: "Ona hali ya office core kwa ujumla.", icon: "grid-outline", primary: true },
      { id: "security", title: "Security", desc: "Fungua security ya office core.", icon: "shield-outline" },
      { id: "access", title: "Access", desc: "Manage nani anaingia ndani ya office core.", icon: "key-outline" },
      { id: "commands", title: "Commands", desc: "Panga command flow ya office core.", icon: "flash-outline" },
    ],
    icon: "apps-outline",
  },

  command: {
    title: "COMMAND",
    subtitle: "Commands • sequence • save",
    command: "KCMD1",
    desc: "Hapa ndipo unaweka na kubadilisha command codes za mfumo, sequence, na unlock flow.",
    bullets: ["Main command", "Sequence", "Save", "Reset"],
    actions: [
      { id: "main-command", title: "Main Command", desc: "Change main command.", icon: "key-outline" },
      { id: "sequence", title: "Sequence", desc: "Set order ya commands.", icon: "git-compare-outline" },
      { id: "reset", title: "Reset", desc: "Rudisha settings za command.", icon: "refresh-outline" },
    ],
    icon: "key-outline",
  },

  visibility: {
    title: "KEY VISIBILITY",
    subtitle: "Show / hide keys on gate",
    command: "KEY4",
    desc: "Room ya ku-control ni keys zipi zinaonekana au kufichwa kwenye gate ya KINGDOM.",
    bullets: ["Show keys", "Hide keys", "Visibility", "Gate layout"],
    actions: [
      { id: "show-all", title: "Show All", desc: "Onesha keys zote.", icon: "eye-outline" },
      { id: "hide-optional", title: "Hide Optional", desc: "Ficha keys zisizo muhimu.", icon: "eye-off-outline" },
      { id: "layout", title: "Gate Layout", desc: "Angalia arrangement ya gate.", icon: "apps-outline" },
    ],
    icon: "eye-outline",
  },
};


const KINGDOM_COUNTRIES = ["USA", "Tanzania", "Kenya", "Uganda", "Burundi", "DR Congo"] as const;

const KINGDOM_CHURCHES: Record<string, string[]> = {
  USA: ["TLMC Dallas", "TLMC Fort Worth", "Demo Church"],
  Tanzania: ["TLMC Dar", "Mwanza Church", "Arusha Fellowship"],
  Kenya: ["Nairobi Church", "Kisumu Church", "Mombasa Church"],
  Uganda: ["Kampala Church", "Gulu Church"],
  Burundi: ["Bujumbura Church", "Gitega Church"],
  "DR Congo": ["Goma Church", "Bukavu Church", "Uvira Church"],
};

const KINGDOM_MINISTRIES = [
  "General",
  "Uponyaji",
  "Maombi",
  "Youth",
  "Worship",
  "Evangelism",
] as const;

const KINGDOM_TARGETS = [
  "Members",
  "Pastors",
  "Leaders",
  "Ministry Leaders",
  "Church Admins",
  "Specific People",
] as const;

const CHURCH_PROJECT_META = {
  "crown-of-destiny": {
    title: "CROWN OF DESTINY",
    desc: "Mission za maadili ulimwenguni na ushirikiano wa makanisa yote.",
  },
  "agenda": {
    title: "AGENDA",
    desc: "Direction, planning, na alignment ya church projects.",
  },
  "mission": {
    title: "MISSION",
    desc: "Outreach, assignments, na execution ya mission fields.",
  },
  "ethics-council": {
    title: "ETHICS COUNCIL",
    desc: "Mwongozo wa maadili kwa leaders, members, na jamii.",
  },
  "global-prayer": {
    title: "GLOBAL PRAYER",
    desc: "Prayer network ya makanisa kwa dunia nzima.",
  },
  "church-growth": {
    title: "CHURCH GROWTH",
    desc: "Growth systems, discipleship, na expansion.",
  },
  "family-order": {
    title: "FAMILY ORDER",
    desc: "Family restoration, parenting, na nyumba katika order.",
  },
  "youth-fire": {
    title: "YOUTH FIRE",
    desc: "Kuwasha vijana katika purity, purpose, na service.",
  },
} as const;

const CHURCH_PROJECT_BRANCHES = {
  "crown-of-destiny": [
    { id: "moral-reform", title: "Moral Reform", desc: "Campaign ya maadili na tabia njema duniani." },
    { id: "leadership-order", title: "Leadership Order", desc: "Order ya viongozi, uwajibikaji, na mfano bora." },
    { id: "family-restoration", title: "Family Restoration", desc: "Kurejesha msingi wa familia na ndoa." },
    { id: "education-light", title: "Education Light", desc: "Mafundisho ya nuru, uelewa, na wisdom kwa jamii." },
    { id: "media-voice", title: "Media & Voice", desc: "Sauti ya project kwa media, content, na campaign." },
    { id: "policy-watch", title: "Policy Watch", desc: "Kufuatilia mwelekeo wa maadili katika jamii na taasisi." },
    { id: "community-action", title: "Community Action", desc: "Practical service kwa jamii na maeneo ya karibu." },
    { id: "prayer-shield", title: "Prayer Shield", desc: "Prayer covering ya mission na branches zote." },
  ],
  "agenda": [
    { id: "strategy-board", title: "Strategy Board", desc: "Main planning na direction ya project." },
    { id: "calendar-flow", title: "Calendar Flow", desc: "Events, timing, na hatua za project." },
    { id: "target-map", title: "Target Map", desc: "Country, church, na audience alignment." },
    { id: "priority-room", title: "Priority Room", desc: "Core priorities na decision flow." },
  ],
  "mission": [
    { id: "field-mission", title: "Field Mission", desc: "Mission coordination kwa maeneo mbalimbali." },
    { id: "church-outreach", title: "Church Outreach", desc: "Outreach ya makanisa na community touch." },
    { id: "follow-up", title: "Follow-up", desc: "Watu wapya, care, na movement ya next step." },
    { id: "reports", title: "Mission Reports", desc: "Reports na updates za mission teams." },
  ],
  "ethics-council": [
    { id: "pastor-guidance", title: "Pastor Guidance", desc: "Mwongozo wa maadili kwa pastors na leaders." },
    { id: "member-discipline", title: "Member Discipline", desc: "Order na accountability kwa members." },
    { id: "youth-purity", title: "Youth Purity", desc: "Direction ya usafi na discipline kwa vijana." },
    { id: "case-review", title: "Case Review", desc: "Review ya matters zinazohitaji wisdom." },
  ],
  "global-prayer": [
    { id: "nations-prayer", title: "Nations Prayer", desc: "Prayer focus kwa mataifa na serikali." },
    { id: "church-covering", title: "Church Covering", desc: "Prayer covering kwa makanisa yote." },
    { id: "leaders-watch", title: "Leaders Watch", desc: "Prayer line kwa viongozi na families zao." },
    { id: "urgent-requests", title: "Urgent Requests", desc: "Emergency prayer requests na response." },
  ],
  "church-growth": [
    { id: "discipleship", title: "Discipleship", desc: "Kukuza waumini kiroho na kimfumo." },
    { id: "membership-growth", title: "Membership Growth", desc: "Growth ya members na retention." },
    { id: "ministry-structure", title: "Ministry Structure", desc: "Order ya ministries na service flow." },
    { id: "new-churches", title: "New Churches", desc: "Expansion na kuzaliwa kwa branches mpya." },
  ],
  "family-order": [
    { id: "marriage-care", title: "Marriage Care", desc: "Care, healing, na order kwa ndoa." },
    { id: "parenting", title: "Parenting", desc: "Malezi, wisdom, na guidance kwa wazazi." },
    { id: "women-support", title: "Women Support", desc: "Support na growth kwa wanawake." },
    { id: "men-order", title: "Men Order", desc: "Kuinua wanaume kwenye responsibility na order." },
  ],
  "youth-fire": [
    { id: "youth-discipleship", title: "Youth Discipleship", desc: "Discipleship na mentorship kwa vijana." },
    { id: "talent-mission", title: "Talent Mission", desc: "Kutumia vipawa kwa kusudi na huduma." },
    { id: "campus-light", title: "Campus Light", desc: "Movement ya vijana kwenye schools na campus." },
    { id: "creative-unit", title: "Creative Unit", desc: "Media, design, music, na youth expression." },
  ],
} as const;

const DEV_ROLE_COMMANDS = [
  {
    id: "member",
    title: "Member",
    code: "MBR-C1",
    sub: "My Church • Prayer Desk",
  },
  {
    id: "leader",
    title: "Leader",
    code: "LDR-C2",
    sub: "Leaders Room • Prayer Leaders",
  },
  {
    id: "ministry-leader",
    title: "Ministry Leader",
    code: "MLD-C3",
    sub: "Ministries Admin • ministry rooms",
  },
  {
    id: "pastor",
    title: "Pastor",
    code: "PST-C5",
    sub: "All church direction rooms",
  },
  {
    id: "church-admin",
    title: "Church Admin",
    code: "ADM-C7",
    sub: "Church management access",
  },
] as const;

const DEV_SWITCHER_SIGNALS = [
  "Premium control center iko live sasa.",
  "Member, Leader, Pastor roles ziko tayari kubadilishwa.",
  "Church rooms zitarefresh baada ya switch.",
  "Role switcher iko juu kwa access ya haraka.",
] as const;




function formatKingdomEventTime(ms: number) {
  const totalMinutes = Math.max(0, Math.ceil(ms / (60 * 1000)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function getKingdomEventState(startAt: number, endAt: number, now: number) {
  if (now < startAt) return "soon" as const;
  if (now >= endAt) return "expired" as const;
  return "live" as const;
}


export default function KingdomInnerRoom() {
  const router = useRouter();
  const [eventsTick, setEventsTick] = useState(0);

  function openGlobalControl() {
    router.push("/kingdom/global-control");
  }
  const { id, openProjectId, openBranchId } = useLocalSearchParams<{
    id?: string;
    openProjectId?: string;
    openBranchId?: string;
  }>();
  const key = String(id || "").toLowerCase();
  const box = BOX_DETAILS[key];

  useEffect(() => {
    if (!box) {
      router.replace("/more/kingdom" as any);
    }
  }, [box, router]);

  useEffect(() => {
    const unsub = subscribeKingdomEvents(() => setEventsTick((v) => v + 1));
    const id = setInterval(() => setEventsTick((v) => v + 1), 30000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);



  if (!box) {
    return null;
  }

  const liveReports = useMemo(() => {
    if (key === "churches") {
      return [
        "My Church: members 12 wamesoma update ya leo.",
        "Leaders Room: pastors na elders wanaendelea coordination.",
        "Prayer Desk: maombi 5 mapya yameingia sasa.",
        "Ministries Admin: admin wa ministries wanaendelea kupanga wiki.",
        "Church Updates: announcement mpya iko tayari kutumwa.",
      ];
    }

    return [
      `${box?.title || "KINGDOM"} room iko active sasa.`,
      "System report inaendelea ku-refresh real time.",
      "Inner room status inaoneshwa live hapa juu.",
    ];
  }, [key, box?.title]);

  const heroSignals = useMemo(() => {
    if (key === "churches") {
      return [
        { id: "members", label: "Members active", value: "82%", tone: "good" },
        { id: "leaders", label: "Leaders online", value: "64%", tone: "info" },
        { id: "prayer", label: "Prayer desk load", value: "41%", tone: "warn" },
        { id: "alerts", label: "Red zone", value: "03", tone: "danger" },
      ];
    }

    return [
      { id: "live", label: "Room live", value: "88%", tone: "good" },
      { id: "sync", label: "Sync", value: "72%", tone: "info" },
      { id: "alerts", label: "Alerts", value: "01", tone: "warn" },
      { id: "zone", label: "Red zone", value: "00", tone: "danger" },
    ];
  }, [key]);

  const [reportIndex, setReportIndex] = useState(0);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [devSwitcherOpen, setDevSwitcherOpen] = useState(false);
  const [devSignalIndex, setDevSignalIndex] = useState(0);
  const [officeCoreView, setOfficeCoreView] = useState<"main" | "overview">("main");
  const [churchesProjectView, setChurchesProjectView] = useState<"projects" | "branches">("projects");
  const [selectedChurchProjectId, setSelectedChurchProjectId] = useState<keyof typeof CHURCH_PROJECT_BRANCHES>("crown-of-destiny");
  const safeSelectedChurchProjectId: keyof typeof CHURCH_PROJECT_BRANCHES =
    CHURCH_PROJECT_BRANCHES[selectedChurchProjectId]
      ? selectedChurchProjectId
      : "crown-of-destiny";

  const selectedChurchProjectMetaSafe =
    CHURCH_PROJECT_META[safeSelectedChurchProjectId];

  const selectedChurchProjectBranchesSafe =
    CHURCH_PROJECT_BRANCHES[safeSelectedChurchProjectId] || [];

  const currentChurchProjectMeta =
    CHURCH_PROJECT_META[selectedChurchProjectId as keyof typeof CHURCH_PROJECT_META] ??
    CHURCH_PROJECT_META["crown-of-destiny"];

  const currentChurchProjectBranches =
    CHURCH_PROJECT_BRANCHES[selectedChurchProjectId as keyof typeof CHURCH_PROJECT_BRANCHES] ??
    CHURCH_PROJECT_BRANCHES["crown-of-destiny"];


  useEffect(() => {
    if (key !== "office-core" && officeCoreView !== "main") {
      setOfficeCoreView("main");
    }
  }, [key, officeCoreView]);

  useEffect(() => {
    if (key !== "churches" && churchesProjectView !== "projects") {
      setChurchesProjectView("projects");
      setSelectedChurchProjectId("crown-of-destiny");
    }
  }, [key, churchesProjectView]);

  useEffect(() => {
    if (key !== "churches") return;

    const projectId = String(openProjectId || "") as keyof typeof CHURCH_PROJECT_BRANCHES;
    const branchId = String(openBranchId || "");

    if (!projectId || !branchId) return;
    if (!CHURCH_PROJECT_BRANCHES[projectId] || !CHURCH_PROJECT_META[projectId]) return;

    const branchMeta = (CHURCH_PROJECT_BRANCHES[projectId] || []).find((item) => item.id === branchId);
    if (!branchMeta) return;

    setSelectedChurchProjectId(projectId);
    setChurchesProjectView("branches");
    setDevSwitcherOpen(false);

    const timer = setTimeout(() => {
      openEventPlanner(
        projectId,
        CHURCH_PROJECT_META[projectId].title,
        branchId,
        branchMeta.title
      );
    }, 0);

    return () => clearTimeout(timer);
  }, [key, openProjectId, openBranchId]);



  const [scopePicker, setScopePicker] = useState<ScopePickerState>({
    visible: false,
    actionId: "",
    actionTitle: "",
    countries: ["USA"],
    churches: ["Demo Church"],
    ministries: ["General"],
    targets: ["Members"],
  });

  const [eventPlanner, setEventPlanner] = useState<EventPlannerState>({
    visible: false,
    projectId: "crown-of-destiny",
    projectTitle: "CROWN OF DESTINY",
    branchId: "moral-reform",
    branchTitle: "Moral Reform",
    startsInMin: 0,
    durationMin: 180,
    countries: ["USA"],
    churches: ["Demo Church"],
    ministries: ["General"],
    targets: ["Members"],
  });


  const availableChurches = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const selectedCountries = scopePicker.countries.length ? scopePicker.countries : ["USA"];

    selectedCountries.forEach((country) => {
      (KINGDOM_CHURCHES[country] || []).forEach((church) => {
        if (!seen.has(church)) {
          seen.add(church);
          out.push(church);
        }
      });
    });

    return out.length ? out : ["Demo Church"];
  }, [scopePicker.countries]);

  const selectionStats = useMemo(
    () => [
      { id: "countries", label: "Countries", value: String(scopePicker.countries.length) },
      { id: "churches", label: "Churches", value: String(scopePicker.churches.length) },
      { id: "ministries", label: "Ministries", value: String(scopePicker.ministries.length) },
      { id: "targets", label: "Targets", value: String(scopePicker.targets.length) },
    ],
    [scopePicker]
  );

  const plannerAvailableChurches = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const selectedCountries = eventPlanner.countries.length ? eventPlanner.countries : ["USA"];

    selectedCountries.forEach((country) => {
      (KINGDOM_CHURCHES[country] || []).forEach((church) => {
        if (!seen.has(church)) {
          seen.add(church);
          out.push(church);
        }
      });
    });

    return out.length ? out : ["Demo Church"];
  }, [eventPlanner.countries]);

  function openEventPlanner(projectId: string, projectTitle: string, branchId: string, branchTitle: string) {
    setEventPlanner({
      visible: true,
      projectId,
      projectTitle,
      branchId,
      branchTitle,
      startsInMin: 0,
      durationMin: 180,
      countries: ["USA"],
      churches: ["Demo Church"],
      ministries: ["General"],
      targets: ["Members"],
    });
  }

  function closeEventPlanner() {
    setEventPlanner((prev) => ({ ...prev, visible: false }));
  }

  function togglePlannerItem(
    field: "countries" | "churches" | "ministries" | "targets",
    value: string
  ) {
    setEventPlanner((prev) => {
      const current = prev[field];
      const exists = current.includes(value);
      const next = exists ? current.filter((item) => item !== value) : [...current, value];

      if (field === "countries") {
        const nextCountries = next.length ? next : [value];
        const allowedChurches = Array.from(
          new Set(nextCountries.flatMap((country) => KINGDOM_CHURCHES[country] || []))
        );
        const nextChurches = prev.churches.filter((church) => allowedChurches.includes(church));
        return {
          ...prev,
          countries: nextCountries,
          churches: nextChurches.length ? nextChurches : (allowedChurches[0] ? [allowedChurches[0]] : []),
        };
      }

      if (field === "churches") {
        return { ...prev, churches: next.length ? next : [value] };
      }

      if (field === "ministries") {
        return { ...prev, ministries: next.length ? next : [value] };
      }

      return { ...prev, targets: next.length ? next : [value] };
    });
  }

  function savePlannedEvent() {
    const startAt = Date.now() + eventPlanner.startsInMin * 60 * 1000;
    const endAt = startAt + eventPlanner.durationMin * 60 * 1000;

    const item = createKingdomEvent({
      projectId: eventPlanner.projectId,
      branchId: eventPlanner.branchId,
      title: eventPlanner.branchTitle,
      countries: eventPlanner.countries as any,
      churches: eventPlanner.churches,
      ministries: eventPlanner.ministries,
      targets: eventPlanner.targets as any,
      startAt,
      endAt,
    });

    closeEventPlanner();

    Alert.alert(
      "Kingdom event saved",
      `${item.title}

Starts: in ${eventPlanner.startsInMin} min
Duration: ${eventPlanner.durationMin} min

Countries: ${eventPlanner.countries.join(", ")}
Churches: ${eventPlanner.churches.join(", ")}
Ministries: ${eventPlanner.ministries.join(", ")}
Targets: ${eventPlanner.targets.join(", ")}`
    );
  }



  const activeKingdomEvents = useMemo(() => {
    const now = Date.now();
    return listKingdomEvents()
      .map((item) => ({
        ...item,
        state: getKingdomEventState(item.startAt, item.endAt, now),
      }))
      .filter((item) => item.state !== "expired")
      .sort((a, b) => {
        if (a.state === b.state) return a.startAt - b.startAt;
        if (a.state === "live") return -1;
        if (b.state === "live") return 1;
        return a.startAt - b.startAt;
      });
  }, [eventsTick]);


  const hideDefaultFunctionCards =
    (key === "office-core" && officeCoreView === "overview") ||
    (key === "churches" && churchesProjectView === "branches");


  useEffect(() => {
    if (!liveReports.length) return;
    const id = setInterval(() => {
      setReportIndex((v) => (v + 1) % liveReports.length);
    }, 2600);
    return () => clearInterval(id);
  }, [liveReports]);

  const activeDevSignal = DEV_SWITCHER_SIGNALS[devSignalIndex % DEV_SWITCHER_SIGNALS.length];

  function openChurchThread(threadId: string, title: string, sub: string) {
    router.push({
      pathname: "/more/my-church-room/messages/[id]",
      params: {
        id: threadId,
        title,
        sub,
      },
    } as any);
  }


  function openScopePicker(actionId: string, actionTitle: string) {
    setScopePicker({
      visible: true,
      actionId,
      actionTitle,
      countries: ["USA"],
      churches: ["Demo Church"],
      ministries: ["General"],
      targets: ["Members"],
    });
  }

  function closeScopePicker() {
    setScopePicker((prev) => ({ ...prev, visible: false }));
  }

  function toggleScopePickerItem(
    field: "countries" | "churches" | "ministries" | "targets",
    value: string
  ) {
    setScopePicker((prev) => {
      const current = prev[field];
      const exists = current.includes(value);
      const next = exists ? current.filter((item) => item !== value) : [...current, value];

      if (field === "countries") {
        const nextCountries = next.length ? next : [value];
        const allowedChurches = Array.from(
          new Set(nextCountries.flatMap((country) => KINGDOM_CHURCHES[country] || []))
        );

        const nextChurches = prev.churches.filter((church) => allowedChurches.includes(church));

        return {
          ...prev,
          countries: nextCountries,
          churches: nextChurches.length ? nextChurches : (allowedChurches[0] ? [allowedChurches[0]] : []),
        };
      }

      if (field === "churches") {
        return {
          ...prev,
          churches: next.length ? next : [value],
        };
      }

      if (field === "ministries") {
        return {
          ...prev,
          ministries: next.length ? next : [value],
        };
      }

      return {
        ...prev,
        targets: next.length ? next : [value],
      };
    });
  }

  function continueWithScopeSelection() {
    const countryText = scopePicker.countries.join(", ");
    const churchText = scopePicker.churches.join(", ");
    const ministryText = scopePicker.ministries.join(", ");
    const targetText = scopePicker.targets.join(", ");

    const scopeSummary =
      `Countries: ${countryText} • Churches: ${churchText} • Ministries: ${ministryText} • Targets: ${targetText}`;

    closeScopePicker();

    if (key === "churches") {
      if (scopePicker.actionId === "churches-overview") {
        router.push({
          pathname: "/more/my-church-room/messages",
          params: {
            tab: "chats",
            scope: scopeSummary,
            countries: countryText,
            churches: churchText,
            ministries: ministryText,
            targets: targetText,
          },
        } as any);
        return;
      }

      if (scopePicker.actionId === "leaders") {
        openChurchThread("c2", "Leaders Room", `${targetText} • ${scopeSummary}`);
        return;
      }

      if (scopePicker.actionId === "members") {
        openChurchThread("c1", "My Church", `${targetText} • ${scopeSummary}`);
        return;
      }

      if (scopePicker.actionId === "ministries") {
        openChurchThread("c3", "Ministries Admin", `${targetText} • ${scopeSummary}`);
        return;
      }

      if (scopePicker.actionId === "church-reports") {
        openChurchThread("c7", "Church Operations", `${targetText} • ${scopeSummary}`);
        return;
      }

      if (scopePicker.actionId === "notifications") {
        openChurchThread("c1", "My Church", `${targetText} • ${scopeSummary}`);
        return;
      }

      if (scopePicker.actionId === "prayer-desk") {
        openChurchThread("c6", "Prayer Desk", `${targetText} • ${scopeSummary}`);
        return;
      }

      if (scopePicker.actionId === "tlmc-church") {
        openChurchThread("c5", "TLMC & Church", `${targetText} • ${scopeSummary}`);
        return;
      }


    }

    Alert.alert(scopePicker.actionTitle || "Selection", scopeSummary);
  }


  function getRoleStyle(roleId: string) {
    if (roleId === "pastor") return "pastor";
    if (roleId === "ministry-leader") return "ministry";
    if (roleId === "leader") return "leader";
    return "member";
  }

  async function handleDevRoleSwitch(roleId: string, code: string) {
    try {
      if (roleId === "member") {
        await Alert.alert("Demo role switch disabled in this build.");
      } else if (roleId === "leader") {
        await Alert.alert("Demo role switch disabled in this build.");
      } else if (roleId === "ministry-leader") {
        await Alert.alert("Demo role switch disabled in this build.");
      } else if (roleId === "pastor") {
        await Alert.alert("Demo role switch disabled in this build.");
      } else if (roleId === "church-admin") {
        await Alert.alert("Demo role switch disabled in this build.");
      } else {
        return;
      }

      Alert.alert(
        "Dev role switched",
        `Role imebadilishwa kwa command ${code}. Fungua Church Chat tena kuona rooms mpya.`
      );
    } catch {
      Alert.alert("Switch failed", "Role switch haikufanikiwa.");
    }
  }

  function handleAction(actionId: string, title: string) {
    if (key === "security" && actionId === "gate") {
      router.push("/kingdom/security-commands" as any);
      return;
    }

    if (key === "security" && actionId === "trust") {
      router.push("/kingdom/security/devices" as any);
      return;
    }

    if (key === "security" && actionId === "alerts") {
      router.push("/kingdom/security/alerts" as any);
      return;
    }

    if (key === "office-core") {
      if (actionId === "overview") {
        setOfficeCoreView("overview");
        return;
      }

      if (actionId === "security") {
        router.push("/kingdom/security-commands" as any);
        return;
      }

      if (actionId === "access") {
        Alert.alert("Office Core Access", "Backup ya Access imerudi. Access control screen tunaunganisha next.");
        return;
      }

      if (actionId === "commands") {
        router.push("/kingdom/security-command-sequence" as any);
        return;
      }
    }

    if (key === "churches") {
      if (actionId === "global-control") {
        openGlobalControl();
        return;
      }

      if (actionId.startsWith("project:")) {
        const projectId = actionId.replace("project:", "") as keyof typeof CHURCH_PROJECT_BRANCHES;
        router.push({
          pathname: "/kingdom/church-project/[projectId]",
          params: { projectId },
        } as any);
        return;
      }

      if (actionId.startsWith("branch:")) {
        const raw = actionId.replace("branch:", "");
        const [projectId, branchId] = raw.split(":");
        const projectKey = projectId as keyof typeof CHURCH_PROJECT_BRANCHES;
        const projectMeta = CHURCH_PROJECT_META[projectKey];
        const branchMeta = (CHURCH_PROJECT_BRANCHES[projectKey] || []).find((item) => item.id === branchId);

        openEventPlanner(
          projectId,
          projectMeta?.title || "Church Project",
          branchId,
          branchMeta?.title || "Project Branch"
        );
        return;
      }

      openScopePicker(actionId, title);
      return;
    }

    Alert.alert(title, "Function hii tutaunganisha hatua inayofuata.");
  }


  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>{box?.title || "KINGDOM ROOM"}</Text>
          <Text style={s.sub}>
            {box?.subtitle || "Inner room • command office"}
          </Text>
        </View>
      </View>

      <Modal
        visible={scopePicker.visible}
        transparent
        animationType="fade"
        onRequestClose={closeScopePicker}
      >
        <View style={s.scopeBackdrop}>
          <View style={s.scopeSheet}>
            <View style={s.scopeTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.scopeEyebrow}>KINGDOM TARGET FLOW</Text>
                <Text style={s.scopeTitle}>{scopePicker.actionTitle || "Choose target"}</Text>
                <Text style={s.scopeSub}>
                  Chagua country, church, ministry, na watu unaotaka kufikia.
                </Text>
              </View>

              <Pressable onPress={closeScopePicker} style={s.scopeCloseBtn}>
                <Ionicons name="close" size={18} color="white" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
              <View style={s.eventMiniStatsRow}>
                <View style={s.eventMiniStatCard}>
                  <Text style={s.eventMiniStatValue}>{String(eventPlanner.startsInMin)}</Text>
                  <Text style={s.eventMiniStatLabel}>Starts in min</Text>
                </View>
                <View style={s.eventMiniStatCard}>
                  <Text style={s.eventMiniStatValue}>{String(eventPlanner.durationMin)}</Text>
                  <Text style={s.eventMiniStatLabel}>Duration min</Text>
                </View>
                <View style={s.eventMiniStatCard}>
                  <Text style={s.eventMiniStatValue}>{String(eventPlanner.targets.length)}</Text>
                  <Text style={s.eventMiniStatLabel}>Target groups</Text>
                </View>
              </View>

              <View style={s.scopeStatsGrid}>
                {selectionStats.map((item) => (
                  <View key={item.id} style={s.scopeStatCard}>
                    <Text style={s.scopeStatValue}>{item.value}</Text>
                    <Text style={s.scopeStatLabel}>{item.label} selected</Text>
                  </View>
                ))}
              </View>

              <Text style={s.scopeSectionLabel}>Countries</Text>
              <Text style={s.scopeSectionSub}>Unaweza kuchagua nchi moja au nyingi.</Text>
              <View style={s.scopeCardGrid}>
                {KINGDOM_COUNTRIES.map((item) => {
                  const active = scopePicker.countries.includes(item);
                  return (
                    <Pressable
                      key={item}
                      onPress={() => toggleScopePickerItem("countries", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>
                        {item}
                      </Text>
                      <Text style={s.scopeSelectMeta}>Country target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Churches</Text>
              <Text style={s.scopeSectionSub}>Chagua church moja au nyingi kutoka nchi ulizochagua.</Text>
              <View style={s.scopeCardGrid}>
                {availableChurches.map((item) => {
                  const active = scopePicker.churches.includes(item);
                  return (
                    <Pressable
                      key={item}
                      onPress={() => toggleScopePickerItem("churches", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>
                        {item}
                      </Text>
                      <Text style={s.scopeSelectMeta}>Church target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Ministries</Text>
              <Text style={s.scopeSectionSub}>Panga ministries nyingi kwa mpigo mmoja.</Text>
              <View style={s.scopeCardGrid}>
                {KINGDOM_MINISTRIES.map((item) => {
                  const active = scopePicker.ministries.includes(item);
                  return (
                    <Pressable
                      key={item}
                      onPress={() => toggleScopePickerItem("ministries", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>
                        {item}
                      </Text>
                      <Text style={s.scopeSelectMeta}>Ministry target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Targets</Text>
              <Text style={s.scopeSectionSub}>Chagua group moja au nyingi za watu.</Text>
              <View style={s.scopeCardGrid}>
                {KINGDOM_TARGETS.map((item) => {
                  const active = scopePicker.targets.includes(item);
                  return (
                    <Pressable
                      key={item}
                      onPress={() => toggleScopePickerItem("targets", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>
                        {item}
                      </Text>
                      <Text style={s.scopeSelectMeta}>People target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={s.scopeSummaryCard}>
                <Text style={s.scopeSummaryLabel}>Current selection</Text>
                <Text style={s.scopeSummaryText}>
                  Countries: {scopePicker.countries.join(", ")}
                </Text>
                <Text style={s.scopeSummaryText}>
                  Churches: {scopePicker.churches.join(", ")}
                </Text>
                <Text style={s.scopeSummaryText}>
                  Ministries: {scopePicker.ministries.join(", ")}
                </Text>
                <Text style={s.scopeSummaryText}>
                  Targets: {scopePicker.targets.join(", ")}
                </Text>
              </View>

              <View style={s.scopeBottomRow}>
                <Pressable onPress={closeScopePicker} style={s.scopeGhostBtn}>
                  <Text style={s.scopeGhostBtnText}>Cancel</Text>
                </Pressable>

                <Pressable onPress={continueWithScopeSelection} style={s.scopePrimaryBtn}>
                  <Text style={s.scopePrimaryBtnText}>Create Kingdom Event</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={eventPlanner.visible}
        transparent
        animationType="fade"
        onRequestClose={closeEventPlanner}

      >
        <View style={s.scopeBackdrop}>
          <View style={s.scopeSheet}>
            <View style={s.scopeTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.scopeEyebrow}>KINGDOM EVENT CONTROL</Text>
                <Text style={s.scopeTitle}>{eventPlanner.branchTitle}</Text>
                <Text style={s.scopeSub}>
                  Tengeneza muda wa kufungua branch hii kwa watu uliowachagua.
                </Text>
              </View>

              <Pressable onPress={closeEventPlanner} style={s.scopeCloseBtn}>
                <Ionicons name="close" size={18} color="white" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
              <View style={s.eventHeroCard}>
                <View style={s.eventHeroGlow} />
                <Text style={s.scopeSummaryLabel}>Project</Text>
                <Text style={s.eventHeroProject}>{eventPlanner.projectTitle}</Text>
                <Text style={s.eventHeroBranch}>{eventPlanner.branchTitle}</Text>
                <Text style={s.eventHeroSub}>
                  Panga tukio, muda wa kuanza, muda wa kuisha, na watu watakao unlock branch hii.
                </Text>
              </View>

              <Text style={s.scopeSectionLabel}>Starts</Text>
              <Text style={s.scopeSectionSub}>Choose when this branch should unlock.</Text>
              <View style={s.scopeCardGrid}>
                {[0, 15, 30, 60, 120, 180, 360].map((min) => {
                  const active = eventPlanner.startsInMin === min;
                  return (
                    <Pressable
                      key={`start-${min}`}
                      onPress={() => setEventPlanner((prev) => ({ ...prev, startsInMin: min }))}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>
                        {min === 0 ? "Now" : min === 1440 ? "Tomorrow" : `${min} min`}
                      </Text>
                      <Text style={s.scopeSelectMeta}>Start preset</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Duration</Text>
              <Text style={s.scopeSectionSub}>How long access should stay active.</Text>
              <View style={s.scopeCardGrid}>
                {[30, 60, 90, 120, 180, 240, 360].map((min) => {
                  const active = eventPlanner.durationMin === min;
                  return (
                    <Pressable
                      key={`duration-${min}`}
                      onPress={() => setEventPlanner((prev) => ({ ...prev, durationMin: min }))}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>
                        {min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min} min`}
                      </Text>
                      <Text style={s.scopeSelectMeta}>Access window</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Countries</Text>
              <Text style={s.scopeSectionSub}>Chagua nchi zitakazoona unlock.</Text>
              <View style={s.scopeCardGrid}>
                {KINGDOM_COUNTRIES.map((item) => {
                  const active = eventPlanner.countries.includes(item);
                  return (
                    <Pressable
                      key={`ep-country-${item}`}
                      onPress={() => togglePlannerItem("countries", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>{item}</Text>
                      <Text style={s.scopeSelectMeta}>Country target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Churches</Text>
              <Text style={s.scopeSectionSub}>Chagua makanisa yatakayopokea tukio.</Text>
              <View style={s.scopeCardGrid}>
                {plannerAvailableChurches.map((item) => {
                  const active = eventPlanner.churches.includes(item);
                  return (
                    <Pressable
                      key={`ep-church-${item}`}
                      onPress={() => togglePlannerItem("churches", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>{item}</Text>
                      <Text style={s.scopeSelectMeta}>Church target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Ministries</Text>
              <Text style={s.scopeSectionSub}>Chagua ministry moja au nyingi.</Text>
              <View style={s.scopeCardGrid}>
                {KINGDOM_MINISTRIES.map((item) => {
                  const active = eventPlanner.ministries.includes(item);
                  return (
                    <Pressable
                      key={`ep-ministry-${item}`}
                      onPress={() => togglePlannerItem("ministries", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>{item}</Text>
                      <Text style={s.scopeSelectMeta}>Ministry target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.scopeSectionLabel}>Targets</Text>
              <Text style={s.scopeSectionSub}>Chagua groups za watu wa kuona unlock.</Text>
              <View style={s.scopeCardGrid}>
                {["Members", "Pastors", "Leaders", "Ministry Leaders", "Church Admins", "Specific People"].map((item) => {
                  const active = eventPlanner.targets.includes(item as any);
                  return (
                    <Pressable
                      key={`ep-target-${item}`}
                      onPress={() => togglePlannerItem("targets", item)}
                      style={[s.scopeSelectCard, active ? s.scopeSelectCardActive : null]}
                    >
                      <View style={s.scopeSelectTop}>
                        <View style={[s.scopeCheck, active ? s.scopeCheckActive : null]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                        </View>
                      </View>
                      <Text style={[s.scopeSelectTitle, active ? s.scopeSelectTitleActive : null]}>{item}</Text>
                      <Text style={s.scopeSelectMeta}>People target</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={s.scopeSummaryCard}>
                <Text style={s.scopeSummaryLabel}>Ready to unlock</Text>
                <Text style={s.scopeSummaryText}>Starts in: {eventPlanner.startsInMin === 0 ? "Now" : `${eventPlanner.startsInMin} min`}</Text>
                <Text style={s.scopeSummaryText}>Duration: {eventPlanner.durationMin >= 60 ? `${Math.floor(eventPlanner.durationMin / 60)}h${eventPlanner.durationMin % 60 ? ` ${eventPlanner.durationMin % 60}m` : ""}` : `${eventPlanner.durationMin} min`}</Text>
                <Text style={s.scopeSummaryText}>Countries: {eventPlanner.countries.join(", ")}</Text>
                <Text style={s.scopeSummaryText}>Churches: {eventPlanner.churches.join(", ")}</Text>
                <Text style={s.scopeSummaryText}>Ministries: {eventPlanner.ministries.join(", ")}</Text>
                <Text style={s.scopeSummaryText}>Targets: {eventPlanner.targets.join(", ")}</Text>
              </View>

              <View style={s.scopeBottomRow}>
                <Pressable onPress={closeEventPlanner} style={s.scopeGhostBtn}>
                  <Text style={s.scopeGhostBtnText}>Cancel</Text>
                </Pressable>

                <Pressable onPress={savePlannedEvent} style={s.scopePrimaryBtn}>
                  <Text style={s.scopePrimaryBtnText}>Save Event</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {key === "churches" ? (
          <View
            style={[
              s.devHeroCard,
              devSwitcherOpen ? s.devHeroCardOpen : null,
            ]}
          >
            <View style={s.devHeroGlow} />

            <View style={s.devHeroTopRow}>
              <View style={s.devHeroLeft}>
<Text style={s.devHeroTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.92} ellipsizeMode="tail">
                  {devSwitcherOpen ? "The Last Mission of Christ" : "The Last Mission of Christ"}
                </Text>
                <Text style={s.devHeroSub}>
                  {devSwitcherOpen ? "Premium TLMC mission center" : activeDevSignal}
                </Text>
              </View>

              <View style={s.devHeroRight}>
                <View style={s.devBadge}>
                  <Text style={s.devBadgeText}>TEMP</Text>
                </View>

                <Pressable
                  onPress={() => setDevSwitcherOpen((v) => !v)}
                  hitSlop={10}
                  style={({ pressed }) => [
                    s.devHeroOpenBtn,
                    devSwitcherOpen ? s.devHeroOpenBtnActive : null,
                    pressed ? ({ opacity: 0.9, transform: [{ scale: 0.96 }] } as ViewStyle) : null,
                  ]}
                >
                  <Ionicons
                    name={devSwitcherOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color="white"
                  />
                </Pressable>
              </View>
            </View>

            <View style={s.devHeroStatRow}>
              <View style={s.devHeroStatCard}>
                <Text style={s.devHeroStatValue}>CORE</Text>
                <Text style={s.devHeroStatLabel}>Core</Text>
              </View>
              <View style={s.devHeroStatCard}>
                <Text style={s.devHeroStatValue}>{String(activeKingdomEvents.length).padStart(2, "0")}</Text>
                <Text style={s.devHeroStatLabel}>Missions</Text>
              </View>
              <View style={s.devHeroStatCard}>
                <Text style={s.devHeroStatValue}>VIP</Text>
                <Text style={s.devHeroStatLabel}>Gate</Text>
              </View>
            </View>

            {devSwitcherOpen ? (
              <>
                <Text style={s.devSub}>
                  Church Projects inside TLMC
                </Text>

                <View style={s.tlmcMissionList}>
                  {(box?.actions || []).map((action, index) => (
                    <Pressable
                      key={action.id}
                      onPress={() => {
                        const nextProjectId = action.id.replace("project:", "") as keyof typeof CHURCH_PROJECT_BRANCHES;
                        if (!CHURCH_PROJECT_BRANCHES[nextProjectId] || !CHURCH_PROJECT_META[nextProjectId]) return;
                        setSelectedChurchProjectId(nextProjectId);
                        setChurchesProjectView("branches");
                        setDevSwitcherOpen(false);
                      }}
                      style={({ pressed }) => [
                        s.tlmcMissionRow,
                        index % 4 === 0 ? s.tlmcToneGold : null,
                        index % 4 === 1 ? s.tlmcTonePurple : null,
                        index % 4 === 2 ? s.tlmcToneGreen : null,
                        index % 4 === 3 ? s.tlmcToneBlue : null,
                        pressed ? ({ opacity: 0.94, transform: [{ scale: 0.992 }] } as ViewStyle) : null,
                      ]}
                    >
                      <View style={s.tlmcMissionLeft}>
                        <View
                          style={[
                            s.tlmcMissionAvatar,
                            index % 4 === 0 ? s.tlmcAvatarGold : null,
                            index % 4 === 1 ? s.tlmcAvatarPurple : null,
                            index % 4 === 2 ? s.tlmcAvatarGreen : null,
                            index % 4 === 3 ? s.tlmcAvatarBlue : null,
                          ]}
                        >
                          <Ionicons name={action.icon} size={22} color="rgba(255,255,255,0.92)" />
                        </View>

                        <View style={s.tlmcMissionBody}>
                          <Text style={s.tlmcMissionTitle} numberOfLines={2} ellipsizeMode="tail">
                            {action.title}
                          </Text>

                          <Text style={s.tlmcMissionMeta} numberOfLines={2} ellipsizeMode="tail">
                            {action.desc}
                          </Text>
                        </View>
                      </View>

                      <View style={s.tlmcMissionRight}>
                        <Text style={s.tlmcMissionTime}>
                          G{index + 1}
                        </Text>
                        <View style={s.tlmcMissionBadge}>
                          <Text style={s.tlmcMissionBadgeText} numberOfLines={1}>ENTER</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <View
          style={[
            s.sectionCard,
            key === "churches" && devSwitcherOpen && churchesProjectView !== "branches"
              ? ({ display: "none" } as ViewStyle)
              : null,
          ]}
        >
          <Text style={s.sectionTitle}>Functions</Text>

          {key === "office-core" && officeCoreView === "overview" ? (
            <View
              style={{
                marginTop: 16,
                marginBottom: 16,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(217,179,95,0.20)",
                backgroundColor: "rgba(255,255,255,0.040)",
                padding: 16,
                gap: 14,
              }}
            >
              <Text style={{ color: "white", fontSize: 20, fontWeight: "900" }}>
                Office Core Overview
              </Text>

              <Text
                style={{
                  color: "rgba(255,255,255,0.72)",
                  fontSize: 13,
                  lineHeight: 18,
                  fontWeight: "700",
                }}
              >
                Hapa unaona hali ya ndani ya office core, mfumo wa command, na movement ya rooms za msingi.
              </Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View
                  style={{
                    flex: 1,
                    minHeight: 82,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 8,
                  }}
                >
                  <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>04</Text>
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: "800" }}>
                    Functions
                  </Text>
                </View>

                <View
                  style={{
                    flex: 1,
                    minHeight: 82,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 8,
                  }}
                >
                  <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>02</Text>
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: "800" }}>
                    Live routes
                  </Text>
                </View>

                <View
                  style={{
                    flex: 1,
                    minHeight: 82,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 8,
                  }}
                >
                  <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>88%</Text>
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: "800" }}>
                    Health
                  </Text>
                </View>
              </View>

              <View style={{ gap: 8 }}>
                <Text style={{ color: "rgba(255,255,255,0.74)", fontSize: 13, fontWeight: "700", lineHeight: 22 }}>
                  • Security commands ready
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.74)", fontSize: 14, fontWeight: "700", lineHeight: 22 }}>
                  • Access control pending
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.74)", fontSize: 14, fontWeight: "700", lineHeight: 22 }}>
                  • Command flow active
                </Text>
              </View>

              <Pressable
                onPress={() => setOfficeCoreView("main")}
                style={{
                  minHeight: 50,
                  borderRadius: 16,
                  backgroundColor: "rgba(217,179,95,0.16)",
                  borderWidth: 1,
                  borderColor: "rgba(217,179,95,0.34)",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 12,
                }}
              >
                <Text style={{ color: "white", fontWeight: "900", fontSize: 14 }}>
                  Back
                </Text>
              </Pressable>
            </View>
          ) : null}


          {key === "churches" && churchesProjectView === "branches" && !CHURCH_PROJECT_META[selectedChurchProjectId] ? (
            <View
              style={{
                marginBottom: 16,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.22)",
                backgroundColor: "rgba(255,255,255,0.035)",
                padding: 16,
                gap: 14,
              }}
            >
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                Project haijapatikana
              </Text>

              <Text style={{ color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 22, fontWeight: "700" }}>
                Hii card haina project key sahihi ndani ya CHURCH_PROJECT_META / CHURCH_PROJECT_BRANCHES.
              </Text>

              <Pressable
                onPress={() => {
                  setSelectedChurchProjectId("crown-of-destiny");
                  setChurchesProjectView("projects");
                }}
                style={{
                  minHeight: 50,
                  borderRadius: 16,
                  backgroundColor: "rgba(217,179,95,0.16)",
                  borderWidth: 1,
                  borderColor: "rgba(217,179,95,0.34)",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 14,
                }}
              >
                <Text style={{ color: "white", fontWeight: "900", fontSize: 14 }}>
                  Back to Projects
                </Text>
              </Pressable>
            </View>
          ) : null}

          {key === "churches" && churchesProjectView === "branches" ? (
            <View
              style={{
                marginBottom: 16,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(217,179,95,0.22)",
                backgroundColor: "rgba(255,255,255,0.035)",
                padding: 16,
                gap: 14,
              }}
            >
              <Text style={{ color: GOLD, fontSize: 12, fontWeight: "900", letterSpacing: 1 }}>
                TLMC INNER PROJECT
              </Text>

              <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>
                {currentChurchProjectMeta.title}
              </Text>

              <Text style={{ color: "rgba(255,255,255,0.74)", fontSize: 14, lineHeight: 22, fontWeight: "700" }}>
                {currentChurchProjectMeta.desc}
              </Text>

              <View style={{ gap: 10 }}>
                {currentChurchProjectBranches.map((branch) => (
                  <Pressable
                    key={branch.id}
                    onPress={() => {
                      openEventPlanner(
                        selectedChurchProjectId,
                        currentChurchProjectMeta.title,
                        branch.id,
                        branch.title
                      );
                    }}
                    style={({ pressed }) => [
                      s.actionCard,
                      { minHeight: 108, width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
                      pressed ? { opacity: 0.94, transform: [{ scale: 0.992 }] } : null,
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flex: 1 }}>
                      <View style={s.actionIconWrap}>
                        <Ionicons name="git-branch-outline" size={22} color="rgba(230,220,255,0.92)" />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={s.actionTitle} numberOfLines={2}>
                          {branch.title}
                        </Text>

                        <Text style={s.actionDesc} numberOfLines={2}>
                          {branch.desc}
                        </Text>
                      </View>
                    </View>

                    <View style={s.tlmcMissionBadge}>
                      <Text style={s.tlmcMissionBadgeText} numberOfLines={1}>OPEN</Text>
                    </View>
                  </Pressable>
                ))}
              </View>

              <Pressable
                onPress={() => setChurchesProjectView("projects")}
                style={{
                  minHeight: 50,
                  borderRadius: 16,
                  backgroundColor: "rgba(217,179,95,0.16)",
                  borderWidth: 1,
                  borderColor: "rgba(217,179,95,0.34)",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 14,
                }}
              >
                <Text style={{ color: "white", fontWeight: "900", fontSize: 14 }}>
                  Back to Projects
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!hideDefaultFunctionCards ? (
            <>

              <View style={s.actionGrid}>
                {(box?.actions || []).map((action) => (
                  <Pressable
                    key={action.id}
                    onPress={() => {
                      if (key === "churches" && action.id.startsWith("project:")) {
                        const projectId = action.id.replace("project:", "");
                        router.push({
                          pathname: "/kingdom/church-project/[projectId]",
                          params: { projectId },
                        } as any);
                        return;
                      }
                      handleAction(action.id, action.title);
                    }}
                    style={({ pressed }) => [
                      s.actionCard,
                      pressed ? { opacity: 0.94, transform: [{ scale: 0.992 }] } : null,
                    ]}
                  >
                    <View style={s.actionIconWrap}>
                      <Ionicons name={action.icon} size={22} color="rgba(230,220,255,0.92)" />
                    </View>

                    <Text style={s.actionTitle} numberOfLines={2}>
                      {action.title}
                    </Text>

                    <Text style={s.actionDesc} numberOfLines={3}>
                      {action.desc}
                    </Text>
                  </Pressable>
                ))}

                {key === "security" ? (
                  <Pressable
                    onPress={() => router.push("/kingdom/security-commands")}
                    style={({ pressed }) => [
                      s.actionCard,
                      s.securityCommandCard,
                      pressed ? { opacity: 0.94, transform: [{ scale: 0.992 }] } : null,
                    ]}
                  >
                    <View style={s.actionIconWrap}>
                      <Ionicons name="key-outline" size={22} color="rgba(230,220,255,0.92)" />
                    </View>

                    <Text style={s.actionTitle} numberOfLines={2}>
                      KINGDOM Commands
                    </Text>

                    <Text style={s.actionDesc} numberOfLines={3}>
                      Open command sequence ya security gate.
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingTop: 54,
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 18,
  },

  backBtn: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
  },

  sub: {
    marginTop: 4,
    color: SOFT,
    fontSize: 13,
    fontWeight: "800",
  },

  heroCard: {
    borderRadius: 34,
    padding: 22,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 18,
  },

  heroCenter: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
    gap: 8,
  },

  heroRight: {
    width: 82,
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 10,
  },

  livePill: {
    height: 36,
    minWidth: 82,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.26)",
    backgroundColor: "rgba(120,35,35,0.24)",
  },

  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: "#FF6B6B",
  },

  livePillText: {
    color: "#F3C86B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.0,
  },

  heroCountChip: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(255,255,255,0.055)",
  },

  heroCountText: {
    color: GOLD,
    fontSize: 21,
    fontWeight: "900",
  },

  iconWrap: {
    width: 82,
    height: 82,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(70,50,120,0.22)",
    borderWidth: 1,
    borderColor: "rgba(120,90,255,0.18)",
    shadowColor: "#6E50FF",
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },

  heroTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },

  heroTitleLine: {
    color: "white",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 24,
    textAlign: "center",
    letterSpacing: 0.08,
    flexShrink: 1,
    width: "100%",
  },

  heroCommandLine: {
    marginTop: 2,
    color: GOLD,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 20,
    textAlign: "center",
  },

  commandBadge: {
    marginTop: 0,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.12)",
  },

  commandBadgeText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  heroCommand: {
    marginTop: 10,
    color: GOLD,
    fontSize: 16,
    fontWeight: "900",
  },

  heroDesc: {
    marginTop: 6,
    color: "rgba(255,255,255,0.82)",
    lineHeight: 22,
    fontWeight: "700",
  },

  signalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
    marginBottom: 22,
  },

  signalCard: {
    width: "47.8%",
    minHeight: 112,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderWidth: 1,
    justifyContent: "space-between",
  },

  signalCardGood: {
    borderColor: "rgba(80,210,140,0.22)",
    backgroundColor: "rgba(80,210,140,0.10)",
  },

  signalCardInfo: {
    borderColor: "rgba(90,160,255,0.22)",
    backgroundColor: "rgba(90,160,255,0.10)",
  },

  signalCardWarn: {
    borderColor: "rgba(217,179,95,0.24)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },

  signalCardDanger: {
    borderColor: "rgba(255,95,95,0.24)",
    backgroundColor: "rgba(255,95,95,0.10)",
  },

  signalValue: {
    color: "white",
    fontSize: 32,
    fontWeight: "900",
  },

  signalLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 15,
  },

  tvScreen: {
    marginTop: 10,
    minHeight: 240,
    borderRadius: 30,
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,4,14,0.99)",
    justifyContent: "center",
  },

  tvLabel: {
    color: "rgba(217,179,95,0.98)",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 16,
  },

  tvReportText: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 37,
    minHeight: 120,
  },

  sectionCard: {
    marginTop: 22,
    borderRadius: 32,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  sectionCardRaised: {
    marginTop: 0,
  },

  gateCodeWrap: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.07)",
  },

  gateCodeLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 6,
  },

  gateCodeValue: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  sectionTitle: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 16,
  },

  sectionText: {
    color: "rgba(255,255,255,0.82)",
    lineHeight: 22,
    fontWeight: "700",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: GOLD,
  },

  rowText: {
    flex: 1,
    color: "white",
    fontWeight: "800",
    fontSize: 14,
  },

  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 16,
  },

  actionCardPrimaryVIP: {
    borderColor: "rgba(217,179,95,0.88)",
    backgroundColor: "rgba(217,179,95,0.10)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },

  actionCardFull: {
    width: "100%",
    minHeight: 120,
    marginBottom: 12,
  },


  liveEventsSection: {
    marginTop: 18,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(255,255,255,0.030)",
    overflow: "hidden",
  } as ViewStyle,

  liveEventsHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  } as ViewStyle,

  liveEventsEyebrow: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.0,
  } as TextStyle,

  liveEventsTitle: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.15,



  } as TextStyle,

  liveEventsSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.64)",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  } as TextStyle,

  liveEventsCountPill: {
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  } as ViewStyle,

  liveEventsCountText: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
  } as TextStyle,

  liveEventsStack: {
    gap: 10,
  } as ViewStyle,

  liveEventCard: {
    minHeight: 124,
    borderRadius: 28,
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderWidth: 1,
    overflow: "hidden",



  } as ViewStyle,

  liveEventCardLive: {
    borderColor: "rgba(16,185,129,0.28)",
    backgroundColor: "rgba(16,185,129,0.06)",
  } as ViewStyle,

  liveEventCardSoon: {
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(217,179,95,0.05)",
  } as ViewStyle,

  liveEventGlow: {
    position: "absolute",
    top: -18,
    right: -12,
    width: 90,
    height: 90,
    borderRadius: 999,
    backgroundColor: "rgba(124,92,255,0.10)",
  } as ViewStyle,

  liveEventTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,



  } as ViewStyle,

  liveEventIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,



  } as ViewStyle,

  liveEventStatusPill: {
    minWidth: 88,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,



  } as ViewStyle,

  liveEventStatusPillLive: {
    backgroundColor: "rgba(16,185,129,0.16)",
    borderColor: "rgba(16,185,129,0.30)",
  } as ViewStyle,

  liveEventStatusPillSoon: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.28)",
  } as ViewStyle,

  liveEventStatusText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,



  } as TextStyle,

  liveEventStatusTextLive: {
    color: "#74FFD3",
  } as TextStyle,

  liveEventStatusTextSoon: {
    color: GOLD,
  } as TextStyle,

  liveEventBranch: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,



  } as TextStyle,

  liveEventProject: {
    marginTop: 7,
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",



  } as TextStyle,

  liveEventMeta: {
    marginTop: 6,
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  } as TextStyle,

  liveEventInfoBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    gap: 4,
  } as ViewStyle,

  liveEventInfoText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  } as TextStyle,

  liveEventsEmptyCard: {
    marginTop: 4,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.030)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  liveEventsEmptyTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
  } as TextStyle,

  liveEventsEmptySub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  } as TextStyle,


  tlmcMissionList: {
    marginTop: 6,
    gap: 14,
  } as ViewStyle,

  tlmcMissionRow: {
    minHeight: 132,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.030)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  } as ViewStyle,

  tlmcToneGold: {
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.08)",
  } as ViewStyle,

  tlmcTonePurple: {
    borderColor: "rgba(111,76,255,0.34)",
    backgroundColor: "rgba(78,56,170,0.16)",
  } as ViewStyle,

  tlmcToneGreen: {
    borderColor: "rgba(16,185,129,0.30)",
    backgroundColor: "rgba(10,88,72,0.16)",
  } as ViewStyle,

  tlmcToneBlue: {
    borderColor: "rgba(59,130,246,0.30)",
    backgroundColor: "rgba(25,68,140,0.16)",
  } as ViewStyle,

  tlmcMissionLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  } as ViewStyle,

  tlmcMissionAvatar: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  } as ViewStyle,

  tlmcAvatarGold: {
    backgroundColor: "rgba(217,179,95,0.16)",
    borderColor: "rgba(217,179,95,0.36)",
  } as ViewStyle,

  tlmcAvatarPurple: {
    backgroundColor: "rgba(111,76,255,0.18)",
    borderColor: "rgba(111,76,255,0.38)",
  } as ViewStyle,

  tlmcAvatarGreen: {
    backgroundColor: "rgba(16,185,129,0.16)",
    borderColor: "rgba(16,185,129,0.34)",
  } as ViewStyle,

  tlmcAvatarBlue: {
    backgroundColor: "rgba(59,130,246,0.16)",
    borderColor: "rgba(59,130,246,0.34)",
  } as ViewStyle,

  tlmcMissionBody: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,

  tlmcMissionTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24,
  } as TextStyle,

  tlmcMissionMeta: {
    marginTop: 10,
    color: "rgba(255,255,255,0.76)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
  } as TextStyle,

  tlmcMissionRight: {
    width: 78,
    alignItems: "flex-end",
    justifyContent: "space-between",
    alignSelf: "stretch",
    paddingLeft: 12,
  } as ViewStyle,

  tlmcMissionTime: {
    color: "#F3D27A",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 2,
  } as TextStyle,

  tlmcMissionBadge: {
    minWidth: 78,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.12)",
  } as ViewStyle,

  tlmcMissionBadgeText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textAlign: "center",
  } as TextStyle,

  actionCard: {
    width: "47.8%",
    minHeight: 232,
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
    backgroundColor: "rgba(255,255,255,0.055)",
    justifyContent: "flex-start",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
  },

  actionIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(110,80,255,0.20)",
    borderWidth: 1,
    borderColor: "rgba(140,100,255,0.30)",
    marginBottom: 14,
    shadowColor: "#6E50FF",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },

  securityCommandCard: {
    borderColor: "rgba(217,179,95,0.18)",
  },

  devCard: {
    marginTop: 18,
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },

  devHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  devTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 25,
    letterSpacing: -0.4,
    maxWidth: "100%",




  },

  devBadge: {
    minWidth: 70,
    height: 36,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.10)",




  },

  devBadgeText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.7,




  },

  devSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.74)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",




  },

  devGrid: {
    marginTop: 16,
    gap: 12,
  },


  devHeroCard: {
    marginTop: 10,
    marginBottom: 18,
    borderRadius: 34,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(5,14,30,0.98)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    overflow: "hidden",




  } as ViewStyle,

  devHeroCardOpen: {
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(11,19,34,0.995)",

  } as ViewStyle,

  devHeroGlow: {
    position: "absolute",
    right: -10,
    top: -8,
    width: 108,
    height: 108,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.05)",




  } as ViewStyle,

  devHeroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,




  } as ViewStyle,

  devHeroLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,




  } as ViewStyle,

  devHeroRight: {
    width: 76,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    gap: 8,




  } as ViewStyle,

  devHeroSignalPill: {
    minHeight: 34,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.24)",
    backgroundColor: "rgba(120,35,35,0.22)",
  } as ViewStyle,

  devHeroSignalText: {
    color: "#F3C86B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
  } as TextStyle,

  devHeroTitle: {
    marginTop: 14,
    color: "white",
    fontSize: 23,
    fontWeight: "900",
    lineHeight: 29,
  } as TextStyle,

  devHeroSub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.74)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "800",
  } as TextStyle,

  devHeroOpenBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.04)",




  } as ViewStyle,

  devHeroOpenBtnActive: {
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(217,179,95,0.12)",




  } as ViewStyle,

  devHeroStatRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    marginBottom: 4,




  } as ViewStyle,

  devHeroStatCard: {
    flex: 1,
    minHeight: 60,
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.03)",




  } as ViewStyle,

  devHeroStatValue: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.15,




  } as TextStyle,

  devHeroStatLabel: {
    marginTop: 3,
    color: "rgba(255,255,255,0.54)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.2,




  } as TextStyle,



  roleGlass: {
    position: "relative",
    minHeight: 122,
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.045)",
    overflow: "hidden",
  } as ViewStyle,

  roleGlowPastor: {
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.08)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  } as ViewStyle,

  roleGlowMinistry: {
    borderColor: "rgba(120,90,255,0.45)",
    backgroundColor: "rgba(120,90,255,0.08)",
    shadowColor: "#6E50FF",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  } as ViewStyle,

  roleGlowLeader: {
    borderColor: "rgba(90,140,255,0.34)",
    backgroundColor: "rgba(90,140,255,0.05)",
  } as ViewStyle,

  roleActive: {
    borderColor: "rgba(217,179,95,0.80)",
    backgroundColor: "rgba(217,179,95,0.10)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.30,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  } as ViewStyle,

  roleCodePremium: {
    color: "#D9B35F",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  } as TextStyle,

  roleTitlePremium: {
    marginTop: 8,
    color: "white",
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 26,
  } as TextStyle,

  roleSubPremium: {
    marginTop: 8,
    color: "rgba(255,255,255,0.70)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  } as TextStyle,

  roleActiveBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.20)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
  } as ViewStyle,

  roleActiveText: {
    color: "#F3C86B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  } as TextStyle,

  devRoleBtn: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  devRoleCode: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 6,
  },

  devRoleTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  },

  devRoleSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },





  scopeBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    justifyContent: "flex-end",
  },

  scopeSheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0E1522",
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },

  scopeTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  },

  scopeEyebrow: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    opacity: 0.96,
  },

  scopeTitle: {
    marginTop: 8,
    color: "white",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  scopeSub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.70)",
    fontSize: 13,
    lineHeight: 21,
    fontWeight: "700",
  },

  scopeCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  scopeStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
    marginBottom: 10,
  },

  scopeStatCard: {
    width: "47.8%",
    minHeight: 92,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
    justifyContent: "space-between",
  },

  scopeStatValue: {
    color: GOLD,
    fontSize: 30,
    fontWeight: "900",
  },

  scopeStatLabel: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },

  scopeSectionLabel: {
    marginTop: 20,
    marginBottom: 8,
    color: GOLD,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.45,
  },

  scopeSectionSub: {
    marginBottom: 12,
    color: "rgba(255,255,255,0.64)",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },

  scopeCardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
    marginBottom: 4,
  },

  scopeSelectCard: {
    width: "47.8%",
    minHeight: 126,
    borderRadius: 26,
    paddingHorizontal: 15,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.045)",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },

  scopeSelectCardActive: {
    borderColor: "rgba(217,179,95,0.40)",
    backgroundColor: "rgba(217,179,95,0.16)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  scopeSelectTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },

  scopeCheck: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },

  scopeCheckActive: {
    borderColor: "rgba(217,179,95,0.40)",
    backgroundColor: "#F3C86B",
  },

  scopeSelectTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 20,
    letterSpacing: 0.15,
  },

  scopeSelectTitleActive: {
    color: "#FFE3A3",
  },

  scopeSelectMeta: {
    marginTop: 10,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "700",
  },


  eventHeroCard: {
    marginTop: 2,
    marginBottom: 18,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.048)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    overflow: "hidden",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  } as ViewStyle,

  eventHeroGlow: {
    position: "absolute",
    top: -26,
    right: -20,
    width: 134,
    height: 134,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.10)",
  } as ViewStyle,

  eventHeroProject: {
    marginTop: 6,
    color: "white",
    fontSize: 23,
    fontWeight: "900",
    lineHeight: 29,
    letterSpacing: 0.2,
  } as TextStyle,

  eventHeroBranch: {
    marginTop: 8,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  } as TextStyle,


  eventHeroSub: {
    marginTop: 9,
    color: "rgba(255,255,255,0.74)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  } as TextStyle,

  eventMiniStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    marginBottom: 2,
  } as ViewStyle,

  eventMiniStatCard: {
    flex: 1,
    minHeight: 82,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,

  eventMiniStatValue: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
  } as TextStyle,

  eventMiniStatLabel: {
    marginTop: 6,
    color: "rgba(255,255,255,0.64)",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
  } as TextStyle,

  scopeSummaryCard: {
    marginTop: 20,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(217,179,95,0.09)",
  },

  scopeSummaryLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
        letterSpacing: 0.9,
    marginBottom: 10,
  },

  scopeSummaryText: {
    color: "white",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "800",
    marginBottom: 4,
  },

  scopeBottomRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
    paddingTop: 4,
  },

  scopeGhostBtn: {
    flex: 1,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  scopeGhostBtnText: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
  },

  scopePrimaryBtn: {
    flex: 1,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(217,179,95,0.18)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },

  scopePrimaryBtnText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "900",
  },

  actionTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 22,
    marginBottom: 8,
    letterSpacing: 0.15,
  },

  actionDesc: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },
});
