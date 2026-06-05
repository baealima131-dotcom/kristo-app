import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  Animated,
  Keyboard,
  Alert,
  Image,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { feedPublishMediaScheduleLocal } from "@/src/lib/homeFeedStore";
import {
  markLocalSchedulePendingBackend,
  removeLocalScheduleAfterBackendFail,
  replaceLocalScheduleWithBackend,
  scheduleBackendFailAlertMessage,
} from "@/src/lib/mediaSchedulePendingSync";
import { apiGet, apiPatch, apiPost, apiDelete } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  ACTIVE_MEDIA_SCHEDULE_ERROR,
  findActiveMediaScheduleForChurchFromSources,
} from "@/src/lib/mediaScheduleLock";
import {
  applySilentMediaScheduleReload,
  fetchMediaScheduleFeedSync,
  purgeAllLocalMediaScheduleSources,
} from "@/src/lib/mediaScheduleSilentReload";
import { buildMediaScheduleAuthorityFields } from "@/src/lib/liveMediaAuthority";
import {
  fetchChurchPastorUserId,
  logChurchPastorResolution,
} from "@/src/lib/churchPastorResolver";
import {
  alertChurchSubscriptionRequired,
  isChurchSubscriptionRequiredError,
  isPastorSessionRole,
  requireActiveChurchSubscriptionForSchedule,
} from "@/src/lib/churchSubscription";
import { clearThreadMessages } from "@/src/lib/messagesStore";
import {
  configureChurchProjectElection,
  getChurchProjectElectionState,
  sendChurchProjectElectionToMc,
  subscribeChurchProjectElection,
} from "@/src/store/churchProjectElectionStore";
import {
  getChurchProjectMcScheduleState,
  markChurchProjectMcScheduleSent,
  saveChurchProjectGuestCount,
  saveChurchProjectMeetingPlan,
  saveChurchProjectMcSchedule,
  saveChurchProjectScheduleSlots,
  clearChurchProjectScheduleSlots,
  subscribeChurchProjectMcSchedule,
} from "@/src/store/churchProjectMcScheduleStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D9B35F";
const TEXT = "rgba(255,255,255,0.94)";
const SOFT = "rgba(255,255,255,0.68)";
const SOFTER = "rgba(255,255,255,0.52)";
const BLUE = "#6EA8FF";
const EMERALD = "#34D399";
const PURPLE = "#B784FF";

const RED = "#FF7D84";

function isPlaceholderScheduleScript(value: string) {
  const v = String(value || "").trim();
  if (!v) return true;
  return /^(no topic|ready to execute)$/i.test(v);
}

function resolveScheduleSlotScript(
  slot: any,
  parentTopic: string,
  opts?: {
    slotNumber?: string | number;
    title?: string;
    log?: boolean;
  }
): { script: string; source: string } {
  const scheduleTopic = String(parentTopic || "").trim();
  const title = String(opts?.title || slot?.name || slot?.title || "Schedule slot").trim();
  const roleLabel = String(slot?.roleLabel || slot?.role || "").trim();

  const candidates: Array<{ source: string; value: string }> = [
    { source: "slot.topic", value: String(slot?.topic || "").trim() },
    { source: "slot.assignmentTopic", value: String(slot?.assignmentTopic || "").trim() },
    { source: "slot.slotTopic", value: String(slot?.slotTopic || "").trim() },
    { source: "slot.description", value: String(slot?.description || "").trim() },
    { source: "slot.task", value: String(slot?.task || "").trim() },
    { source: "slot.roleLabel", value: roleLabel },
    { source: "slot.role", value: String(slot?.role || "").trim() },
    { source: "slot.title", value: String(slot?.title || "").trim() },
    { source: "slot.name", value: String(slot?.name || "").trim() },
    { source: "scheduleTopic", value: scheduleTopic },
  ];

  for (const { source, value } of candidates) {
    if (isPlaceholderScheduleScript(value)) continue;

    if (opts?.log !== false) {
      console.log("KRISTO_SCHEDULE_SLOT_SCRIPT_SAVE", {
        slotNumber: opts?.slotNumber ?? slot?.slotNumber ?? slot?.slotLabel ?? "",
        title,
        script: value,
        source,
        parentTopic: scheduleTopic,
      });
    }

    return { script: value, source };
  }

  const fallback = scheduleTopic || title || "No topic";
  if (opts?.log !== false) {
    console.log("KRISTO_SCHEDULE_SLOT_SCRIPT_SAVE", {
      slotNumber: opts?.slotNumber ?? slot?.slotNumber ?? slot?.slotLabel ?? "",
      title,
      script: fallback,
      source: scheduleTopic ? "scheduleTopic" : "slot.title",
      parentTopic: scheduleTopic,
    });
  }

  return {
    script: fallback,
    source: scheduleTopic ? "scheduleTopic" : "slot.title",
  };
}

type ToolRequirement = "member" | "leader" | "tlmc";

type ToolMeta = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  blurb: string;
  bullets: string[];
  primaryAction: string;
  secondaryAction: string;
  required: ToolRequirement;
};

const TOOL_META: Record<string, ToolMeta> = {
  members: {
    title: "Members board",
    icon: "people-outline",
    blurb: "Hapa utaona members wa assignment, roles zao, na status yao.",
    bullets: ["active members", "leaders / admins", "paused members", "member actions"],
    primaryAction: "Open people list",
    secondaryAction: "Review role summary",
    required: "member",
  },
  profile: {
    title: "Assignment profile",
    icon: "create-outline",
    blurb: "Hapa uta-edit jina, description, image, na profile ya assignment.",
    bullets: ["title & subtitle", "profile image", "assignment role setup", "visibility basics"],
    primaryAction: "Edit assignment profile",
    secondaryAction: "Review room identity",
    required: "leader",
  },
  invite: {
    title: "Invite members",
    icon: "person-add-outline",
    blurb: "Hapa utaalika watu kuingia ndani ya assignment room.",
    bullets: ["invite by role", "invite leaders", "invite selected people", "accept / decline flow"],
    primaryAction: "Send invitation",
    secondaryAction: "Preview invite flow",
    required: "leader",
  },
  tlmc: {
    title: "TLMC panel",
    icon: "sparkles-outline",
    blurb: "Hii ni panel maalum ya TLMC kwa control ya ndani ya assignment.",
    bullets: ["special control tools", "internal notices", "assignment coordination", "secure access layer"],
    primaryAction: "Open TLMC controls",
    secondaryAction: "Review secure layer",
    required: "tlmc",
  },
  election: {
    title: "Election",
    icon: "checkbox-outline",
    blurb: "Hapa utaandaa uchaguzi wa assignment.",
    bullets: ["candidates", "voting window", "vote counting", "results"],
    primaryAction: "Start election setup",
    secondaryAction: "Preview voting flow",
    required: "leader",
  },
  targeted: {
    title: "Targeted message",
    icon: "mail-outline",
    blurb: "Hapa utatuma message kwa kundi maalum ndani ya assignment.",
    bullets: ["leaders only", "selected members", "branch specific", "meeting participants"],
    primaryAction: "Compose targeted message",
    secondaryAction: "Review audience rules",
    required: "tlmc",
  },
  broadcast: {
    title: "Broadcast",
    icon: "megaphone-outline",
    blurb: "Hapa utatuma tangazo la assignment kwa wote wanaoruhusiwa.",
    bullets: ["announcement post", "wide notice", "priority alert", "delivery preview"],
    primaryAction: "Create broadcast",
    secondaryAction: "Preview delivery",
    required: "leader",
  },
  meeting: {
    title: "Meeting",
    icon: "calendar-outline",
    blurb: "Hapa utaona meeting plan ya assignment na taarifa zake.",
    bullets: ["meeting title", "participants", "time window", "meeting notices"],
    primaryAction: "Open meeting plan",
    secondaryAction: "Review participants",
    required: "leader",
  },
  schedule: {
    title: "Schedule",
    icon: "time-outline",
    blurb: "Hapa utaona na kufuatilia order ya ratiba na deadlines za assignment.",
    bullets: ["important dates", "task order", "deadlines", "reminders"],
    primaryAction: "Open schedule plan",
    secondaryAction: "Review deadlines",
    required: "leader",
  },
  visibility: {
    title: "Visibility",
    icon: "eye-outline",
    blurb: "Hapa uta-control nani anaona sehemu gani ndani ya assignment.",
    bullets: ["member sections", "leader sections", "meeting visibility", "restricted panels"],
    primaryAction: "Manage visibility",
    secondaryAction: "Review access map",
    required: "tlmc",
  },
  permissions: {
    title: "Permissions",
    icon: "shield-checkmark-outline",
    blurb: "Hapa uta-control ruhusa za ndani ya assignment.",
    bullets: ["who can edit", "who can invite", "who can schedule", "who can manage"],
    primaryAction: "Manage permissions",
    secondaryAction: "Review policy",
    required: "leader",
  },
  pause: {
    title: "Pause assignment",
    icon: "pause-circle-outline",
    blurb: "Hapa assignment inaweza kuwekwa paused bila kufuta data yake.",
    bullets: ["pause state", "restore later", "member state", "leader control"],
    primaryAction: "Pause room flow",
    secondaryAction: "Review restore path",
    required: "leader",
  },
};

type ElectionStage =
  | "draft"
  | "announced"
  | "candidate_registration_open"
  | "campaign_live"
  | "voting_open"
  | "voting_closed"
  | "result_countdown"
  | "third_revealed"
  | "second_revealed"
  | "winner_revealed"
  | "completed";

type ElectionCandidate = {
  id: string;
  userId: string;
  name: string;
  role: "Member" | "Admin" | "Pastor";
  branch: string;
  votes: number;
  status: "Active" | "Paused";
};

type ElectionChatCard = {
  id: string;
  title: string;
  sub: string;
  tone: "gold" | "blue" | "emerald" | "purple";
};

type ElectionModel = {
  id: string;
  title: string;
  scope: string;
  typeLabel: string;
  stage: ElectionStage;
  countdownSeconds: number;
  revealGroupCount: number;
  finalistsCount: number;
  totalCandidates: number;
  eligibleVoters: number;
  votesCast: number;
  turnoutLabel: string;
  nominationOpen: boolean;
  votingOpen: boolean;
  mcMode: boolean;
  canSelfNominate: boolean;
  canVote: boolean;
  hasUserNominated: boolean;
  hasUserVoted: boolean;
  userEligible: boolean;
  nominationLabel: string;
  voteLabel: string;
  liveDebateLabel: string;
  resultLabel: string;
  finalists: ElectionCandidate[];
  earlyReveal: ElectionCandidate[];
  winner?: ElectionCandidate;
  second?: ElectionCandidate;
  third?: ElectionCandidate;
  chatCards: ElectionChatCard[];
};

const MOCK_ELECTIONS: Record<string, ElectionModel> = {
  "mr-usa-1": {
    id: "el_mrusa_001",
    title: "Moral Reform • Dallas Leadership Election",
    scope: "Moral Reform • Dallas",
    typeLabel: "Branch leadership vote",
    stage: "result_countdown",
    countdownSeconds: 60,
    revealGroupCount: 7,
    finalistsCount: 3,
    totalCandidates: 10,
    eligibleVoters: 48,
    votesCast: 41,
    turnoutLabel: "41 / 48 voted",
    nominationOpen: false,
    votingOpen: false,
    mcMode: true,
    canSelfNominate: false,
    canVote: false,
    hasUserNominated: false,
    hasUserVoted: false,
    userEligible: true,
    nominationLabel: "Nomination closed",
    voteLabel: "Voting completed",
    liveDebateLabel: "Debate completed in live room",
    resultLabel: "Result reveal is running",
    earlyReveal: [
      { id: "c10", userId: "u-c10", name: "Grace Lewis", role: "Member", branch: "Dallas", votes: 2, status: "Active" },
      { id: "c9", userId: "u-c9", name: "Daniel Brooks", role: "Member", branch: "Dallas", votes: 3, status: "Active" },
      { id: "c8", userId: "u-c8", name: "Martha Cole", role: "Member", branch: "Dallas", votes: 3, status: "Active" },
      { id: "c7", userId: "u-c7", name: "Samuel Price", role: "Member", branch: "Dallas", votes: 4, status: "Active" },
      { id: "c6", userId: "u-c6", name: "Deborah Stone", role: "Admin", branch: "Dallas", votes: 5, status: "Active" },
      { id: "c5", userId: "u-c5", name: "Rachel Moore", role: "Admin", branch: "Dallas", votes: 5, status: "Active" },
      { id: "c4", userId: "u-c4", name: "Michael Reed", role: "Member", branch: "Dallas", votes: 6, status: "Active" },
    ],
    finalists: [
      { id: "c3", userId: "u-c3", name: "Naomi Reed", role: "Admin", branch: "Dallas", votes: 8, status: "Active" },
      { id: "c2", userId: "u-c2", name: "Joel Martin", role: "Pastor", branch: "Dallas", votes: 11, status: "Active" },
      { id: "c1", userId: "u-c1", name: "Alicia Grant", role: "Admin", branch: "Dallas", votes: 13, status: "Active" },
    ],
    third: { id: "c3", userId: "u-c3", name: "Naomi Reed", role: "Admin", branch: "Dallas", votes: 8, status: "Active" },
    second: { id: "c2", userId: "u-c2", name: "Joel Martin", role: "Pastor", branch: "Dallas", votes: 11, status: "Active" },
    winner: { id: "c1", userId: "u-c1", name: "Alicia Grant", role: "Admin", branch: "Dallas", votes: 13, status: "Active" },
    chatCards: [
      { id: "card1", title: "Election opened", sub: "Candidate registration completed for 10 people.", tone: "gold" },
      { id: "card2", title: "Debate live tonight", sub: "Candidates campaign inside live room before voting day.", tone: "purple" },
      { id: "card3", title: "Voting closed", sub: "Counting completed. Result reveal starts next.", tone: "blue" },
      { id: "card4", title: "Top 3 finalists", sub: "System locked finalists and prepared live reveal boxes.", tone: "emerald" },
    ],
  },
};

function normalizeRole(raw: string) {
  const role = String(raw || "member").trim().toLowerCase();
  if (role === "tlmc") return "tlmc";
  if (["leader", "admin", "pastor", "church_admin"].includes(role)) return "leader";
  return "member";
}

function rolePrettyLabel(role: string) {
  if (role === "tlmc") return "TLMC";
  if (role === "leader") return "LEADER";
  return "MEMBER";
}

function roleTone(role: string) {
  if (role === "tlmc") return "purple";
  if (role === "leader") return "blue";
  return "emerald";
}

function requirementLabel(required: ToolRequirement) {
  if (required === "tlmc") return "TLMC access";
  if (required === "leader") return "Leader access";
  return "Member access";
}

function hasToolAccess(userRole: string, required: ToolRequirement) {
  if (userRole === "tlmc") return true;
  if (userRole === "leader") return required === "leader" || required === "member";
  return required === "member";
}

function stageLabel(stage: ElectionStage) {
  switch (stage) {
    case "draft":
      return "Draft";
    case "announced":
      return "Announced";
    case "candidate_registration_open":
      return "Registration open";
    case "campaign_live":
      return "Campaign live";
    case "voting_open":
      return "Voting open";
    case "voting_closed":
      return "Voting closed";
    case "result_countdown":
      return "Reveal countdown";
    case "third_revealed":
      return "Third revealed";
    case "second_revealed":
      return "Second revealed";
    case "winner_revealed":
      return "Winner revealed";
    case "completed":
      return "Completed";
    default:
      return "Election";
  }
}

function toneStyle(tone: ElectionChatCard["tone"]) {
  if (tone === "blue") return "blue";
  if (tone === "emerald") return "emerald";
  if (tone === "purple") return "purple";
  return "gold";
}

export default function ChurchProjectToolScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    assignmentId?: string;
    tool?: string;
    title?: string;
    subtitle?: string;
    role?: string;
    status?: string;
    source?: string;
    mode?: string;
    roomId?: string;
    sourceRoomId?: string;
    avatar?: string;
    ministryId?: string;
    mediaAccess?: string;
    mediaScope?: string;
  }>();

  const assignmentId = String(params.assignmentId || "");
  const tool = String(params.tool || "members").trim().toLowerCase();
  const sourceParam = String(params.source || "").trim().toLowerCase();
  const targetRoomId =
    sourceParam === "media"
      ? "media-schedule"
      : String((params as any)?.roomId || assignmentId || "").trim();
  const sourceBackRoomId = String((params as any)?.sourceRoomId || (params as any)?.roomId || targetRoomId || assignmentId || "").trim();
  const mediaScope = String((params as any)?.mediaScope || "").trim().toLowerCase();
  const isChurchLiveControlScope =
    mediaScope === "church" ||
    sourceParam === "church-live-control" ||
    targetRoomId === "church-media-room" ||
    sourceBackRoomId === "church-media-room" ||
    assignmentId === "church-media-room";
  const modeParam = String(params.mode || "").trim().toLowerCase();

  const isMediaGuests =
    assignmentId === "media-guests" ||
    tool === "guests" ||
    modeParam === "guests";

  const isMinistryLiveSchedule = sourceParam === "ministry-live";

  const isMediaSchedule =
    !isMinistryLiveSchedule &&
    !isMediaGuests &&
    (
      assignmentId === "media-schedule" ||
      sourceParam === "media"
    );

  const effectiveTool = isMediaGuests ? "guests" : isMediaSchedule ? "meeting" : tool;
  const assignmentTitle = String(params.title || "Assignment Room");
  const assignmentSubtitle = String(params.subtitle || "assignment room");
  const role = String(params.role || "MEMBER");
  const rawStatus = String(params.status || "");
  const status = rawStatus.toLowerCase() === "active member" ? "" : rawStatus;
  const routeAvatar = String((params as any)?.avatar || "").trim();
  const routeMediaName = String((params as any)?.mediaName || "").trim();
  const routeChurchName = String((params as any)?.churchName || "").trim();
  const routeMinistryId = String((params as any)?.ministryId || assignmentId || "").trim();
  const routeMediaAccess = String((params as any)?.mediaAccess || "").trim();

  function toolMediaSubscriptionGateOpts() {
    const session = getSessionSync() as any;
    const sessionRole = String(session?.role || role || "").trim().toLowerCase();
    const isPastor =
      isPastorSessionRole(sessionRole) ||
      String(session?.churchRole || "").trim().toLowerCase() === "pastor";
    const isApprovedMediaHost = routeMediaAccess === "1";
    return { isPastor, isApprovedMediaHost };
  }

  const meta = useMemo(
    () =>
      isMediaGuests
        ? {
            title: "Guests",
            icon: "people-outline" as const,
            blurb: "View claimed time cards, adjust time, remove guests, and keep your schedule clean.",
            bullets: ["claimed guests", "time cards", "media claims"],
            primaryAction: "Open guests",
            secondaryAction: "Review claims",
            required: "member" as const,
          }
        : TOOL_META[effectiveTool] || {
            title: "Assignment tool",
            icon: "apps-outline" as const,
            blurb: "Tool hii iko tayari kuunganishwa na data halisi.",
            bullets: ["next step"],
            primaryAction: "Open tool",
            secondaryAction: "Review tool state",
            required: "member" as const,
          },
    [effectiveTool, isMediaGuests]
  );

  const resolvedRole = useMemo(() => normalizeRole(role), [role]);
  const hasMcAccess = String((params as any)?.mcAccess || "") === "1";
  const strictMcTool = effectiveTool === "meeting" || effectiveTool === "schedule";
  const accessAllowed = useMemo(
    () => strictMcTool ? hasMcAccess : hasToolAccess(resolvedRole, meta.required),
    [strictMcTool, hasMcAccess, resolvedRole, meta.required]
  );
  const roleLabel = useMemo(() => rolePrettyLabel(resolvedRole), [resolvedRole]);
  const tone = useMemo(() => roleTone(resolvedRole), [resolvedRole]);

  const election = useMemo<ElectionModel | null>(() => {
    if (tool !== "election") return null;
  const handleParticipantPress = (title: string, detail: string) => {
    if (detail === "Not included") return;
    setMeetingParticipantDraft(title);
  };


    return (
      MOCK_ELECTIONS[assignmentId] || {
        id: "el_default",
        title: `${assignmentTitle} Election`,
        scope: assignmentTitle,
        typeLabel: "Assignment vote",
        stage: "announced",
        countdownSeconds: 60,
        revealGroupCount: 7,
        finalistsCount: 3,
        totalCandidates: 10,
        eligibleVoters: 24,
        votesCast: 0,
        turnoutLabel: "0 / 24 voted",
        nominationOpen: true,
        votingOpen: false,
        mcMode: true,
        canSelfNominate: true,
        canVote: false,
        hasUserNominated: false,
        hasUserVoted: false,
        userEligible: true,
        nominationLabel: "Self nomination open",
        voteLabel: "Voting not opened yet",
        liveDebateLabel: "Debate plan pending",
        resultLabel: "Result reveal pending",
        earlyReveal: [],
        finalists: [],
        chatCards: [],
      }
    );
  }, [tool, assignmentId, assignmentTitle]);

  const accessTitle = accessAllowed ? "Access enabled" : "View only";
  const accessMessage = accessAllowed
    ? resolvedRole === "tlmc"
      ? "Una ruhusa kamili kwa tool hii ndani ya assignment."
      : resolvedRole === "leader"
        ? "Unaweza kuona na kusimamia sehemu zinazotegemea role yako."
        : "Unaweza kutumia sehemu za msingi zinazokuruhusu kufanya kazi ndani ya assignment."
    : meta.required === "tlmc"
      ? "Tool hii ni ya TLMC au viongozi waliopata ruhusa maalum."
      : "Tool hii inahitaji leader access ili kufanya actions za ndani.";

  const heroToneStyle =
    tone === "purple"
      ? s.heroPurple
      : tone === "blue"
        ? s.heroBlue
        : s.heroEmerald;

  const rolePillStyle =
    tone === "purple"
      ? s.pillPurple
      : tone === "blue"
        ? s.pillBlue
        : s.pillEmerald;

  const statusPillStyle = accessAllowed ? s.pillAccessOn : s.pillAccessOff;
  const accessCardStyle = accessAllowed ? s.accessCardOn : s.accessCardOff;

  const summaryItems = [
    { label: "ROLE", value: roleLabel },
    { label: "ACCESS", value: accessAllowed ? "Enabled" : "Limited" },
    { label: "REQUIRED", value: requirementLabel(meta.required) },
    { label: "ROOM", value: assignmentId || "assignment" },
  ];

  const [selectedVoteType, setSelectedVoteType] = useState<
    "mc" | "branch_leader" | "department" | "internal"
  >("mc");
  const [durationDays, setDurationDays] = useState(7);
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeChurchProjectElection(() => {
      forceRefresh((x) => x + 1);
    });
    return unsubscribe;
  }, []);

  const electionState = getChurchProjectElectionState(assignmentId);
  const draftCreated = electionState.draftCreated;
  const sentToMc = electionState.sentToMc;

  useEffect(() => {
    if (!election) return;
    setSelectedVoteType(electionState.voteType);
    setDurationDays(electionState.durationDays);
  }, [election, electionState.voteType, electionState.durationDays]);

  const totalHours = useMemo(() => durationDays * 24, [durationDays]);

  function handleCreateElection() {
    if (tool !== "election" || !accessAllowed) return;
    configureChurchProjectElection({
      assignmentId,
      title: assignmentTitle,
      subtitle: assignmentSubtitle,
      voteType: selectedVoteType,
      durationDays,
    });
  }

  function handleSendToMc() {
    if (tool !== "election" || !accessAllowed || !draftCreated) return;
    sendChurchProjectElectionToMc(assignmentId);
  }

  const selectedVoteTypeLabel = useMemo(() => {
    if (selectedVoteType === "mc") return "MC vote";
    if (selectedVoteType === "branch_leader") return "Branch leadership vote";
    if (selectedVoteType === "department") return "Department vote";
    return "Internal appointment vote";
  }, [selectedVoteType]);

  const electionSummaryItems = election
    ? [
        { label: "TYPE", value: selectedVoteTypeLabel },
        { label: "DAYS", value: `${durationDays} days` },
        { label: "HOURS", value: `${totalHours} hrs` },
        { label: "MC STATUS", value: sentToMc ? "Sent" : draftCreated ? "Ready" : "Pending" },
      ]
    : [];

  const electionFlowCards = election
    ? [
        {
          label: "STEP 1",
          title: "Create vote",
          sub: "Chagua aina ya vote, muda wa siku, na system ihesabu masaa yake yenyewe.",
          icon: "create-outline" as const,
        },
        {
          label: "STEP 2",
          title: "Send to MC",
          sub: "Baada ya ku-create, app itapeleka flow kwa MC na timu ya live kwa maandalizi.",
          icon: "paper-plane-outline" as const,
        },
        {
          label: "STEP 3",
          title: "Candidate window",
          sub: "Wagombea watapokea taarifa na kujichagua ndani ya masaa ya vote uliyo-set.",
          icon: "person-add-outline" as const,
        },
        {
          label: "STEP 4",
          title: "MC handles live edits",
          sub: "Baada ya hapo kazi kubwa inabaki kwa MC na watu wa live siku ya announcement.",
          icon: "videocam-outline" as const,
        },
      ]
    : [];

  const isMeeting = tool === "meeting" || isMediaSchedule;
  const isSchedule = tool === "schedule";
  const [backendScheduleCards, setBackendScheduleCards] = useState<any[]>([]);
  const mediaScheduleVersionRef = useRef(0);
  const mediaScheduleUpdatedAtRef = useRef("");
  const isLockedMeetingOrSchedule = !isMediaSchedule && (isMeeting || isSchedule) && !hasMcAccess;

  const meetingDays = ["Today", "Tomorrow", "Friday", "Sunday"];
  const meetingTimes = ["7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM"];
  const meetingTypes = isMediaSchedule
    ? ["Prayer service", "Counseling", "Testimony", "Teaching"]
    : isMinistryLiveSchedule
      ? ["Ministry Live", "Ministry Prayer", "Ministry Teaching", "Ministry Worship"]
      : ["Live service", "Leaders meeting", "Prayer meeting", "Special program"];
  const meetingTopics = ["Weekly alignment", "Branch updates", "Guest welcome", "Prayer & direction"];
  const meetingTargets = isMediaSchedule
    ? ["Guests", "Members", "Leaders", "Leaders & Admins"]
    : isMinistryLiveSchedule
      ? ["Ministry Members", "Ministry Leaders", "Ministry Team", "Selected Members"]
      : ["Members", "Leaders", "Pastors", "Media team"];

  const leaderAudienceOptions = [
    { id: "all-leaders", label: "All leaders" },
    { id: "leader-1", label: "Pastor Joel" },
    { id: "leader-2", label: "Admin Alicia" },
    { id: "leader-3", label: "Leader Naomi" },
    { id: "leader-4", label: "MC Daniel" },
  ];

  const memberAudienceOptions = [
    { id: "all-members", label: "All members" },
    { id: "member-1", label: "Grace Lewis" },
    { id: "member-2", label: "Samuel Price" },
    { id: "member-3", label: "Deborah Stone" },
    { id: "member-4", label: "Michael Reed" },
    { id: "member-5", label: "Rachel Moore" },
  ];

  const meetingYears = Array.from(
    { length: 21 },
    (_, i) => String(new Date().getFullYear() + i)
  );
  const meetingMonths = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const meetingDates = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31"];
  const meetingClockTimes = ["12:00", "1:00", "2:00", "3:00", "4:00", "5:00", "6:00", "7:00", "8:00", "9:00", "10:00", "11:00"];
  const meridiems = ["AM", "PM"];
  const meetingMinuteOptions = ["00","05","10","15","20","25","30","35","40","45","50","55"];

  const [meetingStep, setMeetingStep] = useState(1);
  const meetingCreateStepYRef = useRef(0);
  const meetingStartStepYRef = useRef(0);
  const meetingEndStepYRef = useRef(0);
  const meetingOptionsStepYRef = useRef(0);
  const meetingReviewStepYRef = useRef(0);
  const meetingSendStepYRef = useRef(0);
  const HOUR_ITEM_HEIGHT = 52;
  const HOUR_LOOP_SET_SIZE = 24;
  const HOUR_LOOP_JUMP = HOUR_ITEM_HEIGHT * HOUR_LOOP_SET_SIZE;
  const meetingStartHourScrollRef = useRef<ScrollView | null>(null);
  const meetingEndHourScrollRef = useRef<ScrollView | null>(null);
  const meetingStartHourLoopReadyRef = useRef(false);
  const meetingEndHourLoopReadyRef = useRef(false);
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [meetingStartedAt, setMeetingStartedAt] = useState<string | null>(null);
  const [meetingStartYear, setMeetingStartYear] = useState(String(new Date().getFullYear()));
  const [meetingStartMonth, setMeetingStartMonth] = useState(
    [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December",
    ][new Date().getMonth()]
  );
  const [meetingStartDay, setMeetingStartDay] = useState(String(new Date().getDate()));
  const [meetingStartHour, setMeetingStartHour] = useState("7:00 PM");
  const [meetingStartMinuteMode, setMeetingStartMinuteMode] = useState(false);
  const [meetingEndYear, setMeetingEndYear] = useState(String(new Date().getFullYear()));
  const [meetingEndMonth, setMeetingEndMonth] = useState(
    [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December",
    ][new Date().getMonth()]
  );
  const [meetingEndDay, setMeetingEndDay] = useState(String(new Date().getDate()));
  const [meetingEndHour, setMeetingEndHour] = useState("8:00 PM");
  const [meetingEndMinuteMode, setMeetingEndMinuteMode] = useState(false);

  const MEETING_MAX_DURATION_MINUTES = 12 * 60;

  const meetingMonthMap: Record<string, number> = {
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
  };

  function isMeetingStartOptionPast(kind: string, option: string) {
    return false;
  }

  function parseMeetingPickerDate(
    day: string,
    month: string,
    year: string,
    hourText: string
  ) {
    const clean = (hourText || "").trim();
    const [timePart = "12:00", meridiemRaw = "AM"] = clean.split(" ");
    const meridiem = meridiemRaw.toUpperCase();
    const [hourStr = "12", minuteStr = "00"] = timePart.split(":");

    let hourNum = Number(hourStr || 0);
    const minuteNum = Number(minuteStr || 0);

    if (meridiem === "PM" && hourNum < 12) hourNum += 12;
    if (meridiem === "AM" && hourNum === 12) hourNum = 0;

    return new Date(
      Number(year),
      meetingMonthMap[month] ?? 0,
      Number(day),
      hourNum,
      minuteNum,
      0,
      0
    );
  }

  function formatMeetingPickerHour(date: Date) {
    let hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, "0");
    const meridiem = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${minute} ${meridiem}`;
  }

  function setMeetingPickerMinute(hourText: string, minuteText: string) {
    const clean = (hourText || "").trim();
    const [timePart = "12:00", meridiemRaw = "AM"] = clean.split(" ");
    const [hourStr = "12"] = timePart.split(":");
    return `${hourStr}:${minuteText} ${meridiemRaw.toUpperCase()}`;
  }

  function ensureHourLoopStart(ref: React.RefObject<ScrollView | null>, readyRef: React.MutableRefObject<boolean>) {
    if (readyRef.current) return;
    readyRef.current = true;
    requestAnimationFrame(() => {
      ref.current?.scrollTo({ y: HOUR_LOOP_JUMP, animated: false });
    });
  }

  function handleHourLoopScroll(
    y: number,
    ref: React.RefObject<ScrollView | null>,
    readyRef: React.MutableRefObject<boolean>
  ) {
    if (!readyRef.current) return;
    if (y < HOUR_ITEM_HEIGHT * 2) {
      ref.current?.scrollTo({ y: y + HOUR_LOOP_JUMP, animated: false });
      return;
    }
    if (y > HOUR_LOOP_JUMP * 2 - HOUR_ITEM_HEIGHT * 2) {
      ref.current?.scrollTo({ y: y - HOUR_LOOP_JUMP, animated: false });
    }
  }

  function syncMeetingEndToRange(
    startDay: string,
    startMonth: string,
    startYear: string,
    startHour: string,
    endDay: string,
    endMonth: string,
    endYear: string,
    endHour: string
  ) {
    const start = parseMeetingPickerDate(startDay, startMonth, startYear, startHour);
    let end = parseMeetingPickerDate(endDay, endMonth, endYear, endHour);
    const maxEnd = new Date(start.getTime() + MEETING_MAX_DURATION_MINUTES * 60000);

    // allow overnight schedules (example: 11PM -> 1AM next day)
    if (end.getTime() < start.getTime()) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    if (end.getTime() > maxEnd.getTime()) {
      end = new Date(maxEnd);
    }

    setMeetingEndYear(String(end.getFullYear()));
    setMeetingEndMonth(
      [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ][end.getMonth()]
    );
    setMeetingEndDay(String(end.getDate()));
    setMeetingEndHour(formatMeetingPickerHour(end));
  }
  function isMeetingEndCandidateInvalid(kind: string, option: string) {
    const start = meetingStartDateValue.getTime();
    const maxEnd = start + MEETING_MAX_DURATION_MINUTES * 60000;

    const y = kind === "year" ? option : meetingEndYear;
    const m = kind === "month" ? option : meetingEndMonth;
    const d = kind === "day" ? option : meetingEndDay;

    const monthIndex = meetingMonthMap[m] ?? 0;

    // Year / Month / Day: disable only kama range yake yote iko nje ya 12h window
    if (kind === "year") {
      const rangeStart = new Date(Number(y), 0, 1, 0, 0, 0, 0).getTime();
      const rangeEnd = new Date(Number(y), 11, 31, 23, 59, 59, 999).getTime();
      return rangeEnd <= start || rangeStart > maxEnd;
    }

    if (kind === "month") {
      const rangeStart = new Date(Number(y), monthIndex, 1, 0, 0, 0, 0).getTime();
      const rangeEnd = new Date(Number(y), monthIndex + 1, 0, 23, 59, 59, 999).getTime();
      return rangeEnd <= start || rangeStart > maxEnd;
    }

    if (kind === "day") {
      const rangeStart = new Date(Number(y), monthIndex, Number(d), 0, 0, 0, 0).getTime();
      const rangeEnd = new Date(Number(y), monthIndex, Number(d), 23, 59, 59, 999).getTime();
      return rangeEnd <= start || rangeStart > maxEnd;
    }

    // Hour / minute: exact time, but allow overnight.
    const h = kind === "hour"
      ? (meetingEndMinuteMode ? setMeetingPickerMinute(meetingEndHour, option) : option)
      : meetingEndHour;

    let end = parseMeetingPickerDate(d, m, y, h).getTime();

    // If start is 11:00 PM and selected end is 12:00 AM / 1:00 AM,
    // treat it as the next day automatically.
    if (end <= start) {
      end += 24 * 60 * 60 * 1000;
    }

    return end <= start || end > maxEnd;
  }

  function warnMeetingEndRange() {
    Alert.alert("Invalid end time", "End must be after start and cannot be longer than 12 hours.");
  }

  const meetingStartDateValue = useMemo(
    () =>
      parseMeetingPickerDate(
        meetingStartDay,
        meetingStartMonth,
        meetingStartYear,
        meetingStartHour
      ),
    [meetingStartDay, meetingStartMonth, meetingStartYear, meetingStartHour]
  );

  const meetingEndDateValue = useMemo(
    () =>
      parseMeetingPickerDate(
        meetingEndDay,
        meetingEndMonth,
        meetingEndYear,
        meetingEndHour
      ),
    [meetingEndDay, meetingEndMonth, meetingEndYear, meetingEndHour]
  );

  const meetingMaxEndDateValue = useMemo(
    () => new Date(meetingStartDateValue.getTime() + MEETING_MAX_DURATION_MINUTES * 60000),
    [meetingStartDateValue]
  );

  const meetingEndBeforeStart = meetingEndDateValue.getTime() < meetingStartDateValue.getTime();
  const meetingEndTooFar = meetingEndDateValue.getTime() > meetingMaxEndDateValue.getTime();
  const meetingEndOutOfRange = meetingEndBeforeStart || meetingEndTooFar;
  const [scheduleConflictInfo, setScheduleConflictInfo] = useState<null | {
    title: string;
    date: string;
    time: string;
    batch: string;
  }>(null);

const [meetingBuilderOpen, setMeetingBuilderOpen] = useState(true);
  
  const [_meetingCreateMode, setMeetingCreateMode] = useState(false);
  const [meetingTitleChoice, setMeetingTitleChoice] = useState(
    isMediaSchedule ? "Prayer service" : isMinistryLiveSchedule ? "Ministry Live" : "Leaders meeting"
  );
  const [meetingTopicChoice, setMeetingTopicChoice] = useState("");
  const hasMeetingTopic = meetingTopicChoice.trim().length > 0;
  const meetingCreateReady = !!meetingTitleChoice.trim() && hasMeetingTopic;
  const meetingTopicExamples = [
    "Weekly alignment",
    "Prayer direction",
    "Sunday service planning",
    "Ministry follow-up",
    "Leadership strategy",
    "Choir preparation",
    "Evangelism plan",
    "Youth program planning",
    "Workers briefing",
    "Special event coordination",
  ];
  const [meetingTopicExampleIndex, setMeetingTopicExampleIndex] = useState(0);
  const [meetingAudience, setMeetingAudience] = useState(
    isMediaSchedule ? "Guests" : isMinistryLiveSchedule ? "Ministry Members" : "Members"
  );
  const [audienceModalVisible, setAudienceModalVisible] = useState(false);
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<string[]>(["all-leaders"]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignKristoId, setAssignKristoId] = useState("");
  const [assignMembers, setAssignMembers] = useState<any[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState("");



  const [startYear, setStartYear] = useState("2026");
  const [startMonth, setStartMonth] = useState("Apr");
  const [startDate, setStartDate] = useState("03");
  const [startClock, setStartClock] = useState("7:00");
  const [startMeridiem, setStartMeridiem] = useState("PM");

  const [endYear, setEndYear] = useState("2026");
  const [endMonth, setEndMonth] = useState("Apr");
  const [endDate, setEndDate] = useState("03");
  const [endClock, setEndClock] = useState("9:00");
  const [endMeridiem, setEndMeridiem] = useState("PM");

  const [inviteGuests, setInviteGuests] = useState(false);
  const [includeChoir, setIncludeChoir] = useState(false);
  const [includeTestimony, setIncludeTestimony] = useState(false);
  const [needsMc, setNeedsMc] = useState(true);
  const [includeOpeningPrayer, setIncludeOpeningPrayer] = useState(true);
  const [includeOffering, setIncludeOffering] = useState(false);
  const [includeAnnouncements, setIncludeAnnouncements] = useState(true);

  // V2_LOCKED: Choir + Offering hazifanyi kazi kwenye V1
  useEffect(() => {
    if (includeChoir) setIncludeChoir(false);
    if (includeOffering) setIncludeOffering(false);
  }, [includeChoir, includeOffering]);


  const [meetingSpecialNote, setMeetingSpecialNote] = useState("");
  const [meetingAutoFlow, setMeetingAutoFlow] = useState<
    { id: string; title: string; role: string; duration: number }[]
  >([]);
  const [meetingParticipantDraft, setMeetingParticipantDraft] = useState<string | null>(null);
  const reviewSubtitleFull =
    "Confirm the meeting setup and the selected program combination before sending to schedule.";
  const [reviewSubtitleTyped, setReviewSubtitleTyped] = useState("");
  const [reviewSubtitleHidden, setReviewSubtitleHidden] = useState(false);
  const reviewSubtitleFade = useRef(new Animated.Value(1)).current;

  const meetingAutoFlowTotalMinutes = useMemo(
    () => meetingAutoFlow.reduce((sum, item) => sum + item.duration, 0),
    [meetingAutoFlow]
  );

  const meetingEstimatedFinishLabel = useMemo(() => {
    const monthMap: Record<string, number> = {
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };

    const hourText = meetingStartHour.trim();
    const [timePart, meridiemRaw] = hourText.split(" ");
    const meridiem = (meridiemRaw || "AM").toUpperCase();
    const [hourStr, minuteStr] = timePart.split(":");

    let hourNum = Number(hourStr || 0);
    const minuteNum = Number(minuteStr || 0);

    if (meridiem === "PM" && hourNum < 12) hourNum += 12;
    if (meridiem === "AM" && hourNum === 12) hourNum = 0;

    const started = new Date(
      Number(meetingStartYear),
      monthMap[meetingStartMonth] ?? 0,
      Number(meetingStartDay),
      hourNum,
      minuteNum,
      0,
      0
    );

    if (Number.isNaN(started.getTime())) return "--";

    const estimated = new Date(started.getTime() + meetingAutoFlowTotalMinutes * 60000);

    let hh = estimated.getHours();
    const mm = String(estimated.getMinutes()).padStart(2, "0");
    const suffix = hh >= 12 ? "PM" : "AM";
    hh = hh % 12;
    if (hh === 0) hh = 12;

    return `${hh}:${mm} ${suffix}`;
  }, [
    meetingStartYear,
    meetingStartMonth,
    meetingStartDay,
    meetingStartHour,
    meetingAutoFlowTotalMinutes,
  ]);
  const [meetingOptionsTab, setMeetingOptionsTab] = useState<
    "program" | "audience" | "stage" | "translation" | "media" | "security"
  >("program");

  const startDayLabel = `${startMonth} ${startDate}, ${startYear}`;
  const startTimeLabel = `${startClock} ${startMeridiem}`;
  const endDayLabel = `${endMonth} ${endDate}, ${endYear}`;
  const endTimeLabel = `${endClock} ${endMeridiem}`;

  const pageScrollRef = React.useRef<ScrollView | null>(null);

  function scrollMeetingStepIntoView(step: number) {
    const map = {
      1: meetingCreateStepYRef.current,
      2: meetingStartStepYRef.current,
      3: meetingEndStepYRef.current,
      4: meetingOptionsStepYRef.current,
      5: meetingReviewStepYRef.current,
      6: meetingSendStepYRef.current,
    } as const;

    const targetY = map[step as 1 | 2 | 3 | 4 | 5 | 6] ?? 0;

    requestAnimationFrame(() => {
      
    });
  }
  const meetingTopicCardY = useRef(0);
  const meetingTopicEditingRef = useRef(false);

  useEffect(() => {
    if (meetingStep !== 5) {
      setReviewSubtitleTyped(reviewSubtitleFull);
      setReviewSubtitleHidden(false);
      reviewSubtitleFade.stopAnimation();
      reviewSubtitleFade.setValue(1);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    setReviewSubtitleTyped("");
    setReviewSubtitleHidden(false);
    reviewSubtitleFade.stopAnimation();
    reviewSubtitleFade.setValue(1);

    const typeNext = (index: number) => {
      if (cancelled) return;

      if (index <= reviewSubtitleFull.length) {
        setReviewSubtitleTyped(reviewSubtitleFull.slice(0, index));
        const nextTick = setTimeout(() => typeNext(index + 1), 32);
        timers.push(nextTick);
        return;
      }

      const hold = setTimeout(() => {
        if (cancelled) return;

        Animated.timing(reviewSubtitleFade, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished || cancelled) return;
          setReviewSubtitleHidden(true);
        });
      }, 7000);

      timers.push(hold);
    };

    typeNext(1);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      reviewSubtitleFade.stopAnimation();
      reviewSubtitleFade.setValue(1);
    };
  }, [meetingStep, reviewSubtitleFade, reviewSubtitleFull]);

  function scrollToMeetingTopicCard() {
    requestAnimationFrame(() => {
      
    });
  }

  function buildMeetingFlow() {
    const flow: { id: string; title: string; role: string; duration: number }[] = [];

    if (isMediaSchedule && !isMinistryLiveSchedule) {
      const mediaTools = [
        { on: needsMc, id: "main-host", title: "Prayer Live", role: "Pray live for people", duration: 3 },
        { on: includeOpeningPrayer, id: "camera-a", title: "Marriage Help", role: "Marriage guidance", duration: 4 },
        { on: inviteGuests, id: "guest-join", title: "Testimony", role: "Share your testimony", duration: 4 },
        { on: false, id: "background-music", title: "Choir", role: "V2 locked", duration: 5 },
        { on: includeTestimony, id: "screen-share", title: "Bible Q&A", role: "Answer Bible questions", duration: 5 },
        { on: false, id: "donation-banner", title: "Offering", role: "V2 locked", duration: 3 },
        { on: includeAnnouncements, id: "lower-third-titles", title: "Hope Word", role: "Speak hope live", duration: 3 },
      ];

      mediaTools.forEach((tool) => {
        if (!tool.on) return;
        flow.push({
          id: tool.id,
          title: tool.title,
          role: tool.role,
          duration: tool.duration,
        });
      });

      return flow.length
        ? flow
        : [
            {
              id: "main-host",
              title: "Prayer Live",
              role: "Pray live for people",
              duration: 3,
            },
          ];
    }

    flow.push({
      id: "opening",
      title: "Opening",
      role: "System",
      duration: 2,
    });

    if (needsMc) {
      flow.push({
        id: "mc-intro",
        title: "MC Introduction",
        role: "MC",
        duration: 3,
      });
    }

    if (includeOpeningPrayer) {
      flow.push({
        id: "opening-prayer",
        title: "Opening Prayer",
        role: "Leader / Pastor",
        duration: 4,
      });
    }

    if (inviteGuests) {
      flow.push({
        id: "guest-reception",
        title: "Guest Reception",
        role: "Protocol / Hosts",
        duration: 4,
      });
    }

    if (false && includeChoir) {
      flow.push({
        id: "choir",
        title: "Choir Ministration",
        role: "Choir",
        duration: 8,
      });
    }

    if (includeTestimony) {
      flow.push({
        id: "testimony",
        title: "Testimony Slot",
        role: "Selected Member",
        duration: 6,
      });
    }

    if (false && includeOffering) {
      flow.push({
        id: "offering",
        title: "Offering",
        role: "Treasury / Ushers",
        duration: 5,
      });
    }

    if (includeAnnouncements) {
      flow.push({
        id: "announcements",
        title: "Announcements",
        role: needsMc ? "MC" : "Leader",
        duration: 4,
      });
    }

    flow.push({
      id: "closing",
      title: "Closing",
      role: needsMc ? "MC / Pastor" : "Leader / Pastor",
      duration: 3,
    });

    return flow;
  }

  useEffect(() => {
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      if (!meetingTopicEditingRef.current) return;

      setTimeout(() => {
        
        meetingTopicEditingRef.current = false;
      }, 220);
    });

    return () => hideSub.remove();
  }, []);
  const meetingStatusOpacity = React.useRef(new Animated.Value(0)).current;
  const meetingStatusLift = React.useRef(new Animated.Value(14)).current;
  const meetingStatusPulse = React.useRef(new Animated.Value(0.96)).current;
  const meetingTopFlowScrollLocked = isMeeting && [1, 2, 3].includes(meetingStep);

  useEffect(() => {
    if (!isMeeting) return;

    Animated.parallel([
      Animated.timing(meetingStatusOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.timing(meetingStatusLift, {
        toValue: 0,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(meetingStatusPulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(meetingStatusPulse, {
          toValue: 0.96,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [isMeeting, meetingStatusLift, meetingStatusOpacity, meetingStatusPulse]);

  function toggleAudienceItem(
    kind: "leaders" | "members",
    id: string
  ) {
    if (kind === "leaders") {
      if (id === "all-leaders") {
        setSelectedLeaderIds((prev) =>
          prev.includes("all-leaders") ? [] : ["all-leaders"]
        );
        return;
      }
      setSelectedLeaderIds((prev) => {
        const base = prev.filter((x) => x !== "all-leaders");
        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      });
      return;
    }

    if (id === "all-members") {
      setSelectedMemberIds((prev) =>
        prev.includes("all-members") ? [] : ["all-members"]
      );
      return;
    }
    setSelectedMemberIds((prev) => {
      const base = prev.filter((x) => x !== "all-members");
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  }

  const audienceSummaryLabel = useMemo(() => {
    const leadersLabel = selectedLeaderIds.includes("all-leaders")
      ? "All leaders"
      : selectedLeaderIds.length
        ? `${selectedLeaderIds.length} leader${selectedLeaderIds.length > 1 ? "s" : ""}`
        : "No leaders";

    const membersLabel = selectedMemberIds.includes("all-members")
      ? "All members"
      : selectedMemberIds.length
        ? `${selectedMemberIds.length} member${selectedMemberIds.length > 1 ? "s" : ""}`
        : "No members";

    return `${leadersLabel} • ${membersLabel}`;
  }, [selectedLeaderIds, selectedMemberIds]);

  const mcScheduleState = getChurchProjectMcScheduleState(assignmentId);

  useEffect(() => {
    const unsubscribe = subscribeChurchProjectMcSchedule(() => {
      forceRefresh((x) => x + 1);
    });
    return unsubscribe;
  }, []);

  const meetingDay = mcScheduleState.meetingPlan.day;
  const meetingTime = mcScheduleState.meetingPlan.time;
  const meetingType = mcScheduleState.meetingPlan.type;
  const meetingTopic = mcScheduleState.meetingPlan.topic;
  const meetingTarget = mcScheduleState.meetingPlan.target;
  const meetingSentToSchedule = mcScheduleState.meetingPlan.sentToSchedule;

  const liveProgressPct = meetingSentToSchedule ? 88 : 52;
  const liveStatusTitle = meetingSentToSchedule ? "Meeting active in flow" : "Meeting draft in progress";
  const liveStatusBody = meetingSentToSchedule
    ? `${meetingTitleChoice} • ${meetingTopicChoice} imefika Schedule na inaendelea kupangwa.`
    : `${meetingTitleChoice} • ${meetingTopicChoice} bado inakamilishwa kabla ya kutumwa Schedule.`;

  const scheduleSpeakerSlots = mcScheduleState.scheduleSlots;
  const [activeScheduleBatchIndex, setActiveScheduleBatchIndex] = useState(0);

  const scheduleBatches = useMemo(() => {
    const groups = new Map<string, any[]>();

    (scheduleSpeakerSlots || []).forEach((slot: any) => {
      const batchId = String(slot.scheduleBatchId || "batch_1");
      if (!groups.has(batchId)) groups.set(batchId, []);
      groups.get(batchId)!.push(slot);
    });

    return Array.from(groups.entries())
      .map(([id, slots]) => ({
        id,
        slots,
        createdAt: Math.max(...slots.map((x: any) => Number(x.scheduleBatchCreatedAt || 0))),
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
  }, [scheduleSpeakerSlots]);

  const activeScheduleBatch = scheduleBatches[activeScheduleBatchIndex] || scheduleBatches[0] || null;
  const scheduleGuestCount = mcScheduleState.guestCount;
  const schedulePushedToMc = mcScheduleState.sentToMc;

  useEffect(() => {
    if (meetingType) setMeetingTitleChoice((prev) => prev || meetingType);
  }, [meetingType]);

  useEffect(() => {
    setMeetingAudience(audienceSummaryLabel);
  }, [audienceSummaryLabel]);

  useEffect(() => {
    if (!meetingBuilderOpen || meetingStep != 1) return;

    const id = setInterval(() => {
      setMeetingTopicExampleIndex((x) => (x + 1) % meetingTopicExamples.length);
    }, 2200);

    return () => clearInterval(id);
  }, [meetingBuilderOpen, meetingStep, meetingTopicExamples.length]);

  // AUTO_FILL_MEETING_DEFAULTS
  useEffect(() => {
    if (tool !== "meeting") return;

    const hasCore =
      !!meetingDay && !!meetingTime && !!meetingType && !!meetingTopic && !!meetingTarget;

    if (hasCore) return;

    saveChurchProjectMeetingPlan(assignmentId, {
      day: meetingDay || "Today",
      time: meetingTime || "7:00 PM",
      type: meetingType || "Leaders meeting",
      topic: meetingTopic || "",
      target: meetingTarget || "Members",
      sentToSchedule: false,
    });
  }, [
    assignmentId,
    tool,
    meetingDay,
    meetingTime,
    meetingType,
    meetingTopic,
    meetingTarget,
  ]);


  useEffect(() => {
    // Guests screen also needs backend schedule/feed sync
    // because media claims are rendered there.
    if ((!isSchedule && !isMediaGuests) || !targetRoomId) return;

    let alive = true;

    async function runToolMediaScheduleSilentReload(reason: string, force = false) {
      const churchId = String(getSessionSync()?.churchId || "").trim();
      if (!churchId) return null;

      const sync = await fetchMediaScheduleFeedSync(churchId, getKristoHeaders() as any);
      const result = applySilentMediaScheduleReload({
        churchId,
        sync,
        reason,
        previousVersion: mediaScheduleVersionRef.current,
        previousUpdatedAt: mediaScheduleUpdatedAtRef.current,
        force,
        ui: {
          setBackendScheduleCards,
          setScheduleConflictInfo,
          setActiveScheduleBatchIndex,
        },
      });

      mediaScheduleVersionRef.current = result.mediaScheduleVersion;
      mediaScheduleUpdatedAtRef.current = result.mediaScheduleUpdatedAt;

      if (result.shouldForceLocalPurge && alive) {
        setBackendScheduleCards([]);
        setScheduleConflictInfo(null);
        setActiveScheduleBatchIndex(0);
      }

      return result;
    }

    async function loadBackendScheduleCards() {
      const reloadResult = await runToolMediaScheduleSilentReload("tool-backend-cards-poll");

      if (reloadResult?.shouldForceLocalPurge || reloadResult?.backendHasActiveSchedule === false) {
        if (alive) {
          setBackendScheduleCards([]);
          setScheduleConflictInfo(null);
          setActiveScheduleBatchIndex(0);
        }
        return;
      }

      const headers = getKristoHeaders();
      const res: any = await apiGet(
        `/api/church/room-messages?roomId=${encodeURIComponent(targetRoomId)}`,
        { headers: headers as any }
      );

      const rows = Array.isArray(res?.data) ? res.data : [];
      const cards = rows
        .filter((x: any) => String(x?.kind || "") === "assignment_card" && x?.card)
        .map((x: any) => ({
          ...x.card,
          messageId: x.id,
          id: String(x.card?.cardId || x.id),
          name: String(x.card?.title || "Schedule slot"),
          minutes: Number(x.card?.durationMin || 0),
          startTime: String(x.card?.startTime || ""),
          endTime: String(x.card?.endTime || ""),
          timeLabel: String(x.card?.timeLabel || ""),
          meetingDate: String(x.card?.meetingDate || ""),
          role: String(x.card?.roleLabel || ""),
          task: String(x.card?.task || ""),
          script: String(x.card?.script || ""),
          chat: Array.isArray(x.card?.notes) ? x.card.notes : [],
        }))
        .sort((a: any, b: any) => {
          const an = Number(String(a.slotLabel || "").replace(/\D/g, "")) || 0;
          const bn = Number(String(b.slotLabel || "").replace(/\D/g, "")) || 0;
          return an - bn;
        });

      let finalCards = cards;

      // Media schedule claims are saved in church-feed.json, not room-messages.
      // So pull latest feed scheduleSlots and let it override stale room-message cards.
      try {
        const feedId = String(
          (params as any)?.feedId ||
          (params as any)?.sourceFeedId ||
          (params as any)?.liveId ||
          ""
        ).trim();

        console.log("KRISTO_GUESTS_SYNC_PARAMS", {
          feedId,
          assignmentId,
          targetRoomId,
          paramsFeedId: (params as any)?.feedId,
          paramsSourceFeedId: (params as any)?.sourceFeedId,
          paramsLiveId: (params as any)?.liveId,
          backendCards: cards.length,
        });

        if (feedId) {
          const feedRes: any = await apiGet(`/api/church/feed?id=${encodeURIComponent(feedId)}`, {
            headers: getKristoHeaders() as any,
          });

          const feedItem = feedRes?.data?.item || feedRes?.item || feedRes?.data || null;
          const feedSlots = Array.isArray(feedItem?.scheduleSlots) ? feedItem.scheduleSlots : [];

          if (feedSlots.length) {
            finalCards = cards.map((card: any) => {
              const fresh = feedSlots.find(
                (slot: any) =>
                  String(slot?.id || "") === String(card?.id || card?.cardId || "")
              );

              const freshClaimedByUserId = String(
                fresh?.claimedByUserId ||
                fresh?.claimedBy?.userId ||
                ""
              ).trim();

              const freshClaimedByName = String(
                fresh?.claimedByName ||
                fresh?.claimedBy?.name ||
                ""
              ).trim();

              const freshHasClaim =
                !!freshClaimedByUserId ||
                !!freshClaimedByName;

              // IMPORTANT:
              // Some claimed feed slots still keep status="open".
              // So do not block merge by status when claim fields exist.
              if (!fresh || !freshHasClaim) {
                return card;
              }

              return {
                ...card,
                ...fresh,
                claimedByUserId: freshClaimedByUserId,
                claimedByName: freshClaimedByName,
                claimedByAvatar:
                  fresh?.claimedByAvatar ||
                  fresh?.claimedBy?.avatarUri ||
                  fresh?.avatarUri ||
                  card?.claimedByAvatar ||
                  "",
                status: "claimed",
              };
            });
          }
        }
      } catch (e) {
        console.log("KRISTO_MEDIA_GUESTS_FEED_SYNC_ERROR", e);
      }

      if (alive) setBackendScheduleCards(finalCards);
    }

    loadBackendScheduleCards();
    const timer = setInterval(loadBackendScheduleCards, 2500);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isSchedule, targetRoomId]);

  const visibleScheduleSlots = meetingSentToSchedule ? (activeScheduleBatch?.slots || []) : [];
  const [selectedScheduleMinuteStep, setSelectedScheduleMinuteStep] = useState(5);
  const [scheduleSelectionMode, setScheduleSelectionMode] = useState(false);
  const [selectedScheduleSlotIds, setSelectedScheduleSlotIds] = useState<string[]>([]);



  const scheduleSelectionToolbar = (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        marginTop: 14,
        marginBottom: 18,
      }}
    >
      <Pressable
        onPress={() => {
          setScheduleSelectionMode((v) => !v);

          if (scheduleSelectionMode) {
            setSelectedScheduleSlotIds([]);
          }
        }}
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: "#B08D57",
          borderRadius: 18,
          paddingVertical: 14,
          alignItems: "center",
          backgroundColor: scheduleSelectionMode
            ? "rgba(176,141,87,0.22)"
            : "rgba(10,14,30,0.9)",
        }}
      >
        <Text
          style={{
            color: "#F4D06F",
            fontWeight: "800",
            fontSize: 15,
          }}
        >
          {scheduleSelectionMode
            ? `Selected ${selectedScheduleSlotIds.length}`
            : "Select Slots"}
        </Text>
      </Pressable>

      <Pressable
        onPress={deleteSelectedScheduleSlots}
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: "#7A1E2C",
          borderRadius: 18,
          paddingVertical: 14,
          alignItems: "center",
          backgroundColor: "rgba(122,30,44,0.22)",
          opacity: selectedScheduleSlotIds.length ? 1 : 0.45,
        }}
      >
        <Text
          style={{
            color: "#FF7B8B",
            fontWeight: "800",
            fontSize: 15,
          }}
        >
          Delete
        </Text>
      </Pressable>
    </View>
  );

  
  function toggleScheduleSlotSelection(slotId: string) {
    setSelectedScheduleSlotIds((prev) => {
      const next = prev.includes(slotId)
        ? prev.filter((x) => x !== slotId)
        : [...prev, slotId];

      if (!next.length) {
        setScheduleSelectionMode(false);
      }

      return next;
    });
  }

  function deleteSelectedScheduleSlots() {
    if (!selectedScheduleSlotIds.length) {
      Alert.alert("No slots selected", "Select at least one slot.");
      return;
    }

    Alert.alert(
      "Delete slots",
      `Remove ${selectedScheduleSlotIds.length} selected slot(s)?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const next = scheduleSpeakerSlots.filter(
              (slot: any) =>
                !selectedScheduleSlotIds.includes(String(slot.id))
            );

            saveChurchProjectScheduleSlots(assignmentId, next);

            setSelectedScheduleSlotIds([]);
            setScheduleSelectionMode(false);
          },
        },
      ]
    );
  }

  const [scheduleSmartNotice, setScheduleSmartNotice] = useState<null | {
    title: string;
    body: string;
  }>(null);

  async function openAssignSlot(slot: any) {
    const slotId = String(slot?.id || slot?.cardId || "");
    setSelectedSlotId(slotId);
    setAssignKristoId("");
    setAssignMembers([]);
    setAssignModalVisible(true);

    try {
      setAssignLoading(true);
      const headers = getKristoHeaders();
      const roomId = String(targetRoomId || assignmentId || "").trim();
      const ministryId = String(routeMinistryId || assignmentId || "").trim();

      let res: any = await apiGet(
        isChurchLiveControlScope
          ? `/api/church/members?all=1`
          : `/api/church/room-members?roomId=${encodeURIComponent(roomId)}&all=1`,
        { headers: headers as any }
      );

      let rows = Array.isArray(res?.members)
        ? res.members
        : Array.isArray(res?.items)
          ? res.items
          : Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res?.ministryMembers)
              ? res.ministryMembers
              : Array.isArray(res?.rows)
                ? res.rows
                : Array.isArray(res)
                  ? res
                  : [];

      if (!rows.length && !isChurchLiveControlScope) {
        res = await apiGet(
          `/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}&all=1`,
          { headers: headers as any }
        );

        rows = Array.isArray(res?.members)
          ? res.members
          : Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res?.data)
              ? res.data
              : Array.isArray(res?.ministryMembers)
                ? res.ministryMembers
                : Array.isArray(res?.rows)
                  ? res.rows
                  : Array.isArray(res)
                    ? res
                    : [];
      }

      rows = rows
        .filter((x: any) => isChurchLiveControlScope || String(x?.ministryId || "").trim() === ministryId)
        .filter((x: any, index: number, arr: any[]) => {
          const key = String(x?.id || x?.userId || index);
          return arr.findIndex((y: any) => String(y?.id || y?.userId || "") === key) === index;
        });

      console.log("🧑‍🤝‍🧑 ASSIGN_PICKER_ROWS", { roomId, ministryId, count: rows.length, res, rows });

      setAssignMembers(rows);
    } catch {
      setAssignMembers([]);
    } finally {
      setAssignLoading(false);
    }
  }

  function adjustSlotMinutes(slotId: string, direction: 1 | -1) {
    const current = visibleScheduleSlots.find((slot: any) => String(slot.id) === String(slotId));
    const currentMinutes = Math.max(1, Number((current as any)?.minutes || 0));
    const nextMinutes = Math.max(1, currentMinutes + direction * selectedScheduleMinuteStep);
    changeSlotMinutes(slotId, nextMinutes);
  }


  function deleteActiveScheduleBatch() {
    if (!activeScheduleBatch) {
      Alert.alert("No schedule", "There is no schedule batch to delete.");
      return;
    }

    Alert.alert(
      "Delete schedule",
      `Delete schedule box ${activeScheduleBatchIndex + 1}? This removes it from app and backend.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const batchId = String(activeScheduleBatch.id || "");
            const deleteIds = Array.from(
              new Set(
                [
                  ...scheduleSpeakerSlots
                    .filter((slot: any) => String(slot.scheduleBatchId || "batch_1") === batchId)
                    .map((slot: any) => String(slot.id || slot.cardId || "")),
                  ...backendScheduleCards
                    .filter((slot: any) => String(slot.scheduleBatchId || "batch_1") === batchId)
                    .map((slot: any) => String(slot.id || slot.cardId || "")),
                ].filter(Boolean)
              )
            );

            try {
              const base = String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/+$/, "");
              const res = await fetch(`${base}/api/church/room-messages`, {
                method: "DELETE",
                headers: {
                  "Content-Type": "application/json",
                  ...(getKristoHeaders() as any),
                },
                body: JSON.stringify({
                  roomId: targetRoomId,
                  cardIds: deleteIds,
                  clearCardIds: deleteIds,
                }),
              });

              if (!res.ok) {
                console.log("⚠️ DELETE_BATCH_BACKEND_FAILED", await res.text());
              }
            } catch (e) {
              console.log("⚠️ DELETE_BATCH_BACKEND_ERROR", e);
            }

            const next = scheduleSpeakerSlots.filter(
              (slot: any) => String(slot.scheduleBatchId || "batch_1") !== batchId
            );

            saveChurchProjectScheduleSlots(assignmentId, next);
            setBackendScheduleCards((prev) =>
              prev.filter((slot: any) => !deleteIds.includes(String(slot.id || slot.cardId || "")))
            );
            setSelectedScheduleSlotIds([]);
            setScheduleSelectionMode(false);
            setActiveScheduleBatchIndex(0);
          },
        },
      ]
    );
  }

  async function clearCurrentScheduleSlots() {
    const allIds = Array.from(
      new Set(
        [
          ...scheduleSpeakerSlots.map((slot: any) => String(slot.id || slot.cardId || "")),
          ...backendScheduleCards.map((slot: any) => String(slot.id || slot.cardId || "")),
        ].filter(Boolean)
      )
    );

    if (isMediaSchedule && !isMinistryLiveSchedule) {
      const churchId = String(getSessionSync()?.churchId || "").trim();
      let backendDelOldResult: Record<string, unknown> | null = null;

      if (churchId) {
        console.log("KRISTO_DEL_OLD_REQUEST", {
          churchId,
          userId: String(getSessionSync()?.userId || ""),
          source: "tool-clearCurrentScheduleSlots",
        });

        try {
          const clearRes: any = await apiPost(
            "/api/church/feed",
            {
              action: "clear_media_schedules",
              churchId,
            },
            { headers: getKristoHeaders() as any }
          );
          backendDelOldResult = (clearRes?.data || clearRes || null) as Record<string, unknown>;
          console.log("KRISTO_DEL_OLD_BACKEND_RESULT", {
            ...backendDelOldResult,
            remainingActiveCount: Number(backendDelOldResult?.remainingActiveCount ?? -1),
          });
        } catch (e) {
          console.log("KRISTO_CLEAR_MEDIA_FEED_BACKEND_ERROR", e);
        }
      }
    }

    try {
      const base = String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/+$/, "");
      const res = await fetch(`${base}/api/church/room-messages`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(getKristoHeaders() as any),
        },
        body: JSON.stringify({
          roomId: targetRoomId,
          cardIds: allIds,
          clearCardIds: allIds,
          clearAllAssignmentCards: true,
        }),
      });

      if (!res.ok) {
        console.log("⚠️ CLEAR_SCHEDULE_BACKEND_FAILED", await res.text());
      }
    } catch (e) {
      console.log("⚠️ CLEAR_SCHEDULE_BACKEND_ERROR", e);
    }

    if (isMediaSchedule && !isMinistryLiveSchedule) {
      const churchId = String(getSessionSync()?.churchId || "").trim();
      purgeAllLocalMediaScheduleSources({
        churchId,
        assignmentId,
        reason: "tool-del-old",
        ui: {
          setBackendScheduleCards,
          setScheduleConflictInfo,
          setActiveScheduleBatchIndex,
        },
      });
      setSelectedScheduleSlotIds([]);
      setScheduleSelectionMode(false);

      if (churchId) {
        try {
          const sync = await fetchMediaScheduleFeedSync(churchId, getKristoHeaders() as any);
          applySilentMediaScheduleReload({
            churchId,
            sync,
            reason: "tool-clear-schedule",
            force: true,
            ui: {
              setBackendScheduleCards,
              setScheduleConflictInfo,
              setActiveScheduleBatchIndex,
            },
          });
        } catch (e) {
          console.log("KRISTO_CLEAR_MEDIA_FEED_BACKEND_ERROR", e);
        }
      }
    } else {
      clearChurchProjectScheduleSlots(assignmentId);
      setBackendScheduleCards([]);
      setSelectedScheduleSlotIds([]);
      setScheduleSelectionMode(false);
      setActiveScheduleBatchIndex(0);
      setScheduleConflictInfo(null);
    }
  }


  function changeSlotMinutes(slotId: string, nextMinutes: number) {
    const targetSlot = scheduleSpeakerSlots.find((slot: any) => String(slot.id) === String(slotId));
    const isPublished = String((targetSlot as any)?.visibility || "").toLowerCase() === "published";

    if (isPublished) {
      return;
    }

    const toMinutes = (label: string) => {
      const raw = String(label || "").trim();
      const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!match) return 19 * 60;

      let hour = Number(match[1] || 0);
      const minute = Number(match[2] || 0);
      const period = String(match[3] || "PM").toUpperCase();

      if (period === "PM" && hour !== 12) hour += 12;
      if (period === "AM" && hour === 12) hour = 0;

      return hour * 60 + minute;
    };

    const toLabel = (totalMinutes: number) => {
      const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
      const hour24 = Math.floor(normalized / 60);
      const minute = normalized % 60;
      const period = hour24 >= 12 ? "PM" : "AM";
      const hour12 = hour24 % 12 || 12;
      return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
    };

    const safeMinutes = Math.max(1, Number(nextMinutes || 1));
    let cursor = toMinutes(scheduleSpeakerSlots[0]?.startTime || meetingStartHour || "7:00 PM");

    const nextSlots = scheduleSpeakerSlots.map((slot: any) => {
      const minutes =
        String(slot.id) === String(slotId)
          ? safeMinutes
          : Math.max(1, Number(slot.minutes || slot.durationMin || 1));

      const startMinutes = cursor;
      const endMinutes = startMinutes + minutes;
      cursor = endMinutes;

      return {
        ...slot,
        minutes,
        durationMin: minutes,
        startTime: toLabel(startMinutes),
        endTime: toLabel(endMinutes),
        timeLabel: `${toLabel(startMinutes)} - ${toLabel(endMinutes)}`,
      };
    });

    saveChurchProjectScheduleSlots(assignmentId, nextSlots);
  }

  async function assignSlotToKristoId(member?: any) {
    if (!selectedSlotId || !member) return;

    const memberName = String(
      member?.displayName ||
      member?.name ||
      member?.fullName ||
      member?.displayName ||
      member?.profileName ||
      "Member"
    ).trim();

    const memberUserId = String(member?.userId || member?.id || "").trim();
    const rawMemberAvatar = String(member?.avatarUrl || member?.avatar || member?.avatarUri || "").trim();
    const memberAvatar = rawMemberAvatar.startsWith("/")
      ? `${String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/+$/, "")}${rawMemberAvatar}`
      : rawMemberAvatar;
    const memberRole = String(member?.roleLabel || member?.role || member?.position || "Member").trim();

    const patch = {
      status: "taken",
      visibility: "draft",
      publishedAt: "",
      published: false,
      sentToMc: false,
      claimedByUserId: memberUserId,
      claimedByName: memberName,
      claimedByAvatar: memberAvatar,
      claimedByRole: memberRole,
      claimedAt: new Date().toISOString(),
    };
    setBackendScheduleCards((prev) =>
      prev.map((slot: any) =>
        String(slot.id || slot.cardId) === String(selectedSlotId)
          ? { ...slot, ...patch }
          : slot
      )
    );

    saveChurchProjectScheduleSlots(
      assignmentId,
      scheduleSpeakerSlots.map((slot) =>
        String(slot.id) === String(selectedSlotId)
          ? { ...slot, ...patch }
          : slot
      )
    );

    setAssignModalVisible(false);
  }


  function getFirstDisplayName(value: any) {
    const name = String(value || "").trim();
    if (!name) return "";
    return name.split(/\s+/)[0] || name;
  }

  async function removeAssignedSlot(slotId: string) {
    try {
      const headers = getKristoHeaders();
      await apiPatch(
        "/api/church/room-messages",
        {
          roomId: targetRoomId,
          cardId: String(slotId),
          patch: {
            status: "open",
            claimedByUserId: "",
            claimedByName: "",
            claimedByRole: "",
            claimedByAvatar: "",
            claimedAt: "",
          },
        },
        { headers: headers as any }
      );
    } catch {}

    setBackendScheduleCards((prev) =>
      prev.map((slot: any) =>
        String(slot.id || slot.cardId) === String(slotId)
          ? {
              ...slot,
              status: "open",
              claimedByUserId: "",
              claimedByName: "",
              claimedByRole: "",
              claimedByAvatar: "",
              claimedAt: "",
            }
          : slot
      )
    );

    saveChurchProjectScheduleSlots(
      assignmentId,
      scheduleSpeakerSlots.map((slot) =>
        String(slot.id) === String(slotId)
          ? {
              ...slot,
              claimedByUserId: "",
              claimedByName: "",
              claimedByRole: "",
              claimedByAvatar: "",
              status: "open",
            }
          : slot
      )
    );
  }

  async function lockScheduleSlot(slot: any) {
    const headers = getKristoHeaders();

    const res: any = await apiPatch(
      "/api/church/room-messages",
      {
        roomId: targetRoomId,
        cardId: String(slot?.id || ""),
        patch: {
          visibility: "draft",
          lockedAt: Date.now(),
        },
      },
      { headers: headers as any }
    );

    if (!res?.ok) {
      Alert.alert("Not locked", String(res?.error || "Card could not be locked."));
      return;
    }

    const lockedPatch = {
      visibility: "draft",
      lockedAt: String(Date.now()),
      publishedAt: "",
      published: false,
      sentToMc: false,
      status: String(slot?.claimedByUserId || slot?.claimedByName || "").trim() ? "taken" : String(slot?.status || "open"),
      claimedByUserId: String(slot?.claimedByUserId || ""),
      claimedByName: String(slot?.claimedByName || ""),
      claimedByRole: String(slot?.claimedByRole || ""),
      claimedByAvatar: String(slot?.claimedByAvatar || ""),
      claimedAt: String(slot?.claimedAt || ""),
    };

    setBackendScheduleCards((prev) =>
      prev.map((x: any) =>
        String(x.id || x.cardId) === String(slot.id)
          ? { ...x, ...lockedPatch }
          : x
      )
    );

    saveChurchProjectScheduleSlots(
      assignmentId,
      scheduleSpeakerSlots.map((x: any) =>
        String(x.id) === String(slot.id)
          ? {
              ...x,
              ...lockedPatch,
            }
          : x
      )
    );
}


  function getScheduleSlotNumber(slot: any) {
    const idx = scheduleSpeakerSlots.findIndex((x: any) => String(x.id) === String(slot?.id));
    return idx >= 0 ? idx + 1 : 1;
  }

async function publishScheduleSlot(slot: any) {
    const headers = getKristoHeaders();
    const churchId = String(getSessionSync()?.churchId || "").trim();

    if (
      !(await requireActiveChurchSubscriptionForSchedule(churchId, headers as any, {
        ...toolMediaSubscriptionGateOpts(),
        screen: "church-project-tool.media-schedule",
        gate: "publishScheduleSlot",
      }))
    ) {
      return;
    }

    const now = Date.now();
    const slotNumber = getScheduleSlotNumber(slot);
    const parentTopic = String(
      slot?.scheduleTopic ||
      slot?.meetingTopic ||
      slot?.parentTopic ||
      meetingTopic ||
      meetingTopicChoice ||
      ""
    ).trim();
    const { script: resolvedScript } = resolveScheduleSlotScript(slot, parentTopic, {
      slotNumber,
      title: String(slot?.name || "Schedule slot"),
    });

    const card = {
      cardId: String(slot?.id || ""),
      slotLabel: String(slotNumber),
      slotNumber,
      order: slotNumber,
      title: String(slot?.name || "Schedule slot"),
      subtitle: String(slot?.subtitle || "Schedule"),
      roleKey: String(slot?.role || "").toLowerCase(),
      roleLabel: String(slot?.role || ""),
      durationMin: Number(slot?.minutes || slot?.durationMin || 0),
      startTime: String(slot?.startTime || ""),
      endTime: String(slot?.endTime || ""),
      meetingDate: String(slot?.meetingDate || ""),
      timeLabel: String(slot?.timeLabel || ""),
      task: String(slot?.task || slot?.name || ""),
      script: resolvedScript,
      scheduleTopic: parentTopic,
      meetingTopic: parentTopic,
      parentTopic,
      notes: Array.isArray(slot?.chat) ? slot.chat : [],
      musicItems: Array.isArray(slot?.musicItems) ? slot.musicItems : [],
      status: String(slot?.claimedByUserId || slot?.claimedByName || "") ? "taken" as const : "open" as const,
      visibility: "published",
      claimedByUserId: String(slot?.claimedByUserId || ""),
      claimedByName: String(slot?.claimedByName || ""),
      claimedByRole: String(slot?.claimedByRole || ""),
      claimedByAvatar: String(slot?.claimedByAvatar || ""),
      claimedAt: String(slot?.claimedAt || ""),
      likeCount: Number(slot?.likeCount || 0),
      commentCount: Number(slot?.commentCount || 0),
      publishedAt: now,
      liveId: `live_${assignmentId}_${new Date(String(slot?.meetingDate || now)).getTime()}`,
      meetingId: `meeting_${assignmentId}_${new Date(String(slot?.meetingDate || now)).getTime()}`,
    };

    let res: any = await apiPatch(
      "/api/church/room-messages",
      {
        roomId: targetRoomId,
        cardId: String(slot?.id || ""),
        patch: card,
      },
      { headers: headers as any }
    );

    if (!res?.ok && String(res?.error || "").toLowerCase().includes("not found")) {
      res = await apiPost(
        "/api/church/room-messages",
        {
          roomId: targetRoomId,
          roomKind: isMinistryLiveSchedule ? "ministry-live" : sourceParam || "my_ministries",
          senderName: "Schedule System",
          text: "",
          kind: "assignment_card",
          card,
        },
        { headers: headers as any }
      );
    }

    if (!res?.ok) {
      if (
        isChurchSubscriptionRequiredError(res, {
          ...toolMediaSubscriptionGateOpts(),
          screen: "church-project-tool.media-schedule",
          gate: "publishScheduleSlot.api",
        })
      ) {
        alertChurchSubscriptionRequired({
          ...toolMediaSubscriptionGateOpts(),
          screen: "church-project-tool.media-schedule",
          gate: "publishScheduleSlot.api",
        });
        return;
      }
      Alert.alert("Not published", String(res?.error || "Card could not be published."));
      return;
    }

    saveChurchProjectScheduleSlots(
      assignmentId,
      scheduleSpeakerSlots.map((x: any) =>
        String(x.id) === String(slot.id)
          ? { ...x, visibility: "published", publishedAt: String(now) }
          : x
      )
    );
}


  async function handleSendMeetingToSchedule() {
    const scheduleStartDate = parseMeetingPickerDate(
      meetingStartDay,
      meetingStartMonth,
      meetingStartYear,
      meetingStartHour
    );
    const scheduleEndDate = parseMeetingPickerDate(
      meetingEndDay,
      meetingEndMonth,
      meetingEndYear,
      meetingEndHour
    );

    const startMs = scheduleStartDate.getTime();
    const endMs = scheduleEndDate.getTime();
    const durationMs = endMs - startMs;
    const maxDurationMs = 12 * 60 * 60 * 1000;

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      Alert.alert("Invalid time", "Please choose a valid start and end time.");
      return;
    }

    if (endMs <= startMs) {
      Alert.alert("Invalid end time", "End time must be after the start time.");
      return;
    }

    // 12h limit ni muda wa LIVE yenyewe, sio umbali kutoka sasa.
    // Start inaweza kuwa kesho, next week, next month, au next year.
    if (durationMs > maxDurationMs) {
      Alert.alert("Live too long", "Live schedule cannot be longer than 12 hours.");
      return;
    }

    const churchId = String(getSessionSync()?.churchId || "").trim();
    const scheduleApiHeaders = getKristoHeaders() as any;
    if (
      !(await requireActiveChurchSubscriptionForSchedule(churchId, scheduleApiHeaders, {
        ...toolMediaSubscriptionGateOpts(),
        screen: "church-project-tool.media-schedule",
        gate: "handleSendMeetingToSchedule",
      }))
    ) {
      return;
    }

    const parseSlotTimeMs = (slot: any, which: "start" | "end") => {
      const dateText = String(slot?.meetingDate || "").split("T")[0];
      const timeText = String(which === "start" ? slot?.startTime : slot?.endTime || "").trim();

      if (!dateText || !timeText) return NaN;

      const [yy, mm, dd] = dateText.split("-").map(Number);
      const [timePart = "12:00", meridiemRaw = "AM"] = timeText.split(" ");
      const [hhRaw = "12", minRaw = "00"] = timePart.split(":");

      let hh = Number(hhRaw || 0);
      const min = Number(minRaw || 0);
      const meridiem = meridiemRaw.toUpperCase();

      if (meridiem === "PM" && hh < 12) hh += 12;
      if (meridiem === "AM" && hh === 12) hh = 0;

      return new Date(yy, (mm || 1) - 1, dd || 1, hh, min, 0, 0).getTime();
    };

    const allExistingScheduleSlots = [
      ...(Array.isArray(scheduleSpeakerSlots) ? scheduleSpeakerSlots : []),
      ...(Array.isArray(backendScheduleCards) ? backendScheduleCards : []),
    ];

    const conflictingSlot = allExistingScheduleSlots.find((slot: any) => {
      const existingStart = parseSlotTimeMs(slot, "start");
      const existingEnd = parseSlotTimeMs(slot, "end");

      if (!Number.isFinite(existingStart) || !Number.isFinite(existingEnd)) return false;

      return startMs < existingEnd && endMs > existingStart;
    });

    if (conflictingSlot) {
      const label = String(conflictingSlot?.name || conflictingSlot?.title || "Existing schedule");
      const time = String(conflictingSlot?.timeLabel || `${conflictingSlot?.startTime || ""} - ${conflictingSlot?.endTime || ""}`).trim();

      setScheduleConflictInfo({
        title: label,
        date: String(conflictingSlot?.meetingDate || "").split("T")[0] || "--",
        time: time || "--",
        batch: `Box ${Number((conflictingSlot?.batchIndex ?? 0)) + 1}`,
      });
      return;
    }

    const scheduleType = meetingTitleChoice?.trim() || "Meeting";
    const rawScheduleTopic = isMediaSchedule ? meetingTopicChoice?.trim() : meetingTopic?.trim();
    const badMediaTopic =
      isMediaSchedule &&
      (
        !rawScheduleTopic ||
        rawScheduleTopic.length > 50 ||
        rawScheduleTopic.toLowerCase().includes("terminal") ||
        rawScheduleTopic.toLowerCase().includes("tumia") ||
        rawScheduleTopic.toLowerCase().includes("hii") ||
        rawScheduleTopic.toLowerCase().includes("sasa")
      );

    const scheduleTopic = isMediaSchedule
      ? badMediaTopic
        ? "Upendo wa Mungu"
        : rawScheduleTopic
      : isMinistryLiveSchedule
        ? meetingTopicChoice?.trim() || meetingTopic?.trim() || "No topic"
        : meetingTopic?.trim() || meetingTopicChoice?.trim() || "No topic";
    const scheduleTarget = meetingAudience?.trim() || "Selected audience";
    const scheduleDay = `${meetingStartMonth} ${meetingStartDay}, ${meetingStartYear}`;
    const targetKey = scheduleTarget.toLowerCase();

    const parseTimeToDate = (
      day: string,
      month: string,
      year: string,
      hourText: string
    ) => {
      const clean = (hourText || "").trim();
      const [timePart = "12:00", meridiemRaw = "AM"] = clean.split(" ");
      const meridiem = meridiemRaw.toUpperCase();
      const [hourStr = "12", minuteStr = "00"] = timePart.split(":");

      let hourNum = Number(hourStr || 0);
      const minuteNum = Number(minuteStr || 0);

      if (meridiem === "PM" && hourNum < 12) hourNum += 12;
      if (meridiem === "AM" && hourNum === 12) hourNum = 0;

      const monthMap: Record<string, number> = {
        January: 0,
        February: 1,
        March: 2,
        April: 3,
        May: 4,
        June: 5,
        July: 6,
        August: 7,
        September: 8,
        October: 9,
        November: 10,
        December: 11,
      };

      return new Date(
        Number(year),
        monthMap[month] ?? 0,
        Number(day),
        hourNum,
        minuteNum,
        0,
        0
      );
    };

    const formatTime = (date: Date) => {
      let hour = date.getHours();
      const minute = String(date.getMinutes()).padStart(2, "0");
      const meridiem = hour >= 12 ? "PM" : "AM";
      hour = hour % 12;
      if (hour === 0) hour = 12;
      return `${hour}:${minute} ${meridiem}`;
    };

    const meetingStartDate = parseTimeToDate(
      meetingStartDay,
      meetingStartMonth,
      meetingStartYear,
      meetingStartHour
    );

    let meetingEndDate = parseTimeToDate(
      meetingEndDay,
      meetingEndMonth,
      meetingEndYear,
      meetingEndHour
    );

    if (meetingEndDate.getTime() <= meetingStartDate.getTime()) {
      meetingEndDate = new Date(meetingStartDate.getTime() + 60 * 60000);
    }

    const totalMinutes = Math.max(
      1,
      Math.round((meetingEndDate.getTime() - meetingStartDate.getTime()) / 60000)
    );

    const audienceBoostFor = (key: string) => {
      const leadersMode = targetKey.includes("leader");
      const pastorsMode = targetKey.includes("pastor");
      const mediaMode = targetKey.includes("media");
      const membersMode = targetKey.includes("member");
      const guestsMode = targetKey.includes("guest");

      if (key === "prayer") {
        if (pastorsMode) return 1.35;
        if (leadersMode) return 1.18;
        return 1.0;
      }
      if (key === "mc") {
        if (mediaMode) return 1.22;
        if (pastorsMode) return 1.12;
        return 1.0;
      }
      if (key === "choir") {
        if (membersMode || guestsMode) return 1.2;
        if (mediaMode) return 0.92;
        return 1.0;
      }
      if (key === "testimony") {
        if (membersMode || guestsMode) return 1.22;
        if (pastorsMode) return 0.9;
        return 1.0;
      }
      if (key === "announcements") {
        if (leadersMode || mediaMode) return 1.18;
        return 1.0;
      }
      if (key === "guests") {
        if (guestsMode) return 1.35;
        return 1.0;
      }
      if (key === "offering") {
        if (membersMode) return 1.08;
        return 1.0;
      }
      return 1.0;
    };

    const maxSegmentMinutesFor = (key: string) => {
      if (key === "mc") return 20;
      if (key === "choir") return 12;
      if (key === "testimony") return 10;
      if (key === "prayer") return 8;
      if (key === "guests") return 8;
      if (key === "offering") return 6;
      if (key === "announcements") return 6;
      return 20;
    };

    const minLastSegmentMinutesFor = (key: string) => {
      if (key === "mc") return 6;
      if (key === "choir") return 5;
      if (key === "testimony") return 4;
      if (key === "prayer") return 3;
      if (key === "guests") return 3;
      if (key === "offering") return 3;
      if (key === "announcements") return 2;
      return 2;
    };

    const splitProgramMinutes = (total: number, key: string, minChunk: number) => {
      const safeTotal = Math.max(1, Math.round(total));
      const cap = Math.max(minChunk, maxSegmentMinutesFor(key));
      const minLast = Math.max(2, Math.min(cap, minLastSegmentMinutesFor(key)));

      if (safeTotal <= cap && safeTotal <= minChunk * 2) return [safeTotal];

      const maxAllowedParts = Math.max(1, Math.floor(safeTotal / Math.max(2, minChunk)));
      const cappedMaxParts = Math.max(1, Math.min(3, maxAllowedParts));

      const pickDesiredParts = () => {
        if (cappedMaxParts <= 1) return 1;

        if (key === "mc") {
          const roll = Math.random();
          if (cappedMaxParts >= 3 && roll < 0.18) return 3;
          if (roll < 0.62) return 2;
          return 1;
        }

        if (key === "prayer") {
          const roll = Math.random();
          if (cappedMaxParts >= 3 && roll < 0.10) return 3;
          if (roll < 0.34) return 2;
          return 1;
        }

        if (key === "choir") {
          const roll = Math.random();
          if (cappedMaxParts >= 3 && roll < 0.22) return 3;
          if (roll < 0.68) return 2;
          return 1;
        }

        if (key === "testimony") {
          const roll = Math.random();
          if (cappedMaxParts >= 3 && roll < 0.16) return 3;
          if (roll < 0.58) return 2;
          return 1;
        }

        if (key === "offering") {
          const roll = Math.random();
          if (cappedMaxParts >= 3 && roll < 0.08) return 3;
          if (roll < 0.32) return 2;
          return 1;
        }

        if (key === "announcements") {
          const roll = Math.random();
          if (cappedMaxParts >= 3 && roll < 0.06) return 3;
          if (roll < 0.26) return 2;
          return 1;
        }

        if (key === "guests") {
          const roll = Math.random();
          if (cappedMaxParts >= 3 && roll < 0.12) return 3;
          if (roll < 0.42) return 2;
          return 1;
        }

        const roll = Math.random();
        if (cappedMaxParts >= 3 && roll < 0.12) return 3;
        if (roll < 0.42) return 2;
        return 1;
      };

      const desiredParts = Math.max(1, Math.min(cappedMaxParts, pickDesiredParts()));

      if (desiredParts === 1) return [safeTotal];

      const minimumPerPart = Math.max(2, Math.min(minChunk, minLast));
      const minimumTotal = desiredParts * minimumPerPart;

      if (minimumTotal > safeTotal) return [safeTotal];

      const parts = Array(desiredParts).fill(minimumPerPart);
      let remaining = safeTotal - minimumTotal;

      while (remaining > 0) {
        const growableIndexes = parts
          .map((value, index) => ({ value, index }))
          .filter((entry) => entry.value < cap)
          .map((entry) => entry.index);

        if (!growableIndexes.length) {
          parts[parts.length - 1] += remaining;
          remaining = 0;
          break;
        }

        const pickIndex = growableIndexes[Math.floor(Math.random() * growableIndexes.length)];
        const room = cap - parts[pickIndex];
        const take = Math.max(1, Math.min(room, remaining, Math.random() < 0.55 ? 1 : 2));

        parts[pickIndex] += take;
        remaining -= take;
      }

      while (parts.length >= 2 && parts[parts.length - 1] < minLast) {
        const needed = minLast - parts[parts.length - 1];
        let donorIndex = -1;

        for (let i = 0; i < parts.length - 1; i += 1) {
          if (parts[i] - needed >= minimumPerPart) {
            donorIndex = i;
            break;
          }
        }

        if (donorIndex === -1) break;

        parts[donorIndex] -= needed;
        parts[parts.length - 1] += needed;
      }

      return parts.filter((value) => value > 0);
    };

    const reviewRows = [
      {
        enabled: needsMc,
        key: "mc",
        title: "MC",
        detail: needsMc ? "Pray live for people" : "Not included",
        minChunk: 6,
        weight: 1.2 * audienceBoostFor("mc"),
      },
      {
        enabled: includeOpeningPrayer,
        key: "prayer",
        title: "Prayer",
        detail: includeOpeningPrayer ? "Select leader / pastor" : "Not included",
        minChunk: 4,
        weight: 0.95 * audienceBoostFor("prayer"),
      },
      {
        enabled: inviteGuests,
        key: "guests",
        title: "Guests",
        detail: inviteGuests ? "Select guests / protocol team" : "Not included",
        minChunk: 4,
        weight: 0.75 * audienceBoostFor("guests"),
      },
      {
        enabled: includeChoir,
        key: "choir",
        title: "Choir",
        detail: includeChoir ? "Select choir group" : "Not included",
        minChunk: 7,
        weight: 1.35 * audienceBoostFor("choir"),
      },
      {
        enabled: includeTestimony,
        key: "testimony",
        title: "Testimony",
        detail: includeTestimony ? "All members or selected" : "Not included",
        minChunk: 5,
        weight: 1.0 * audienceBoostFor("testimony"),
      },
      {
        enabled: includeOffering,
        key: "offering",
        title: "Offering",
        detail: includeOffering ? "Select treasury / ushers" : "Not included",
        minChunk: 4,
        weight: 0.8 * audienceBoostFor("offering"),
      },
      {
        enabled: includeAnnouncements,
        key: "announcements",
        title: "Announcements",
        detail: includeAnnouncements ? "Select announcer / MC" : "Not included",
        minChunk: 3,
        weight: 0.72 * audienceBoostFor("announcements"),
      },
    ].filter((row) => row.enabled);

    const mediaReviewRows = buildMeetingFlow().map((tool) => ({
      enabled: true,
      key: tool.id,
      title: tool.title,
      detail: tool.role,
      minChunk: Math.max(1, tool.duration),
      weight: 1,
    }));

    const activeRows = isMediaSchedule
      ? mediaReviewRows
      : reviewRows.length
        ? reviewRows
        : [
            {
              key: "summary",
              title: "Meeting summary",
              detail: scheduleTarget,
              minChunk: totalMinutes,
              weight: 1,
            },
          ];

    const totalMinRequired = activeRows.reduce((sum, row) => sum + row.minChunk, 0);
    const totalWeight = activeRows.reduce((sum, row) => sum + row.weight, 0) || 1;

    const allocations = activeRows.map((row) => ({
      ...row,
      durationMin: 1,
    }));

    if (totalMinutes <= totalMinRequired) {
      const scaled = activeRows.map((row) => {
        const raw = Math.max(1, Math.floor((row.minChunk / totalMinRequired) * totalMinutes));
        return {
          ...row,
          durationMin: raw,
        };
      });

      let used = scaled.reduce((sum, row) => sum + row.durationMin, 0);

      while (used < totalMinutes) {
        scaled.sort((a, b) => (b.weight - a.weight) || (b.minChunk - a.minChunk));
        scaled[0].durationMin += 1;
        used += 1;
      }

      while (used > totalMinutes) {
        const candidate = scaled
          .filter((row) => row.durationMin > 1)
          .sort((a, b) => (a.weight - b.weight) || (a.minChunk - b.minChunk))[0];
        if (!candidate) break;
        candidate.durationMin -= 1;
        used -= 1;
      }

      for (let i = 0; i < allocations.length; i += 1) {
        allocations[i].durationMin = scaled[i].durationMin;
      }
    } else {
      const extraMinutes = totalMinutes - totalMinRequired;

      const base = activeRows.map((row) => ({
        ...row,
        durationMin: row.minChunk,
        extraRaw: (row.weight / totalWeight) * extraMinutes,
        extraWhole: 0,
        extraFrac: 0,
      }));

      let usedExtra = 0;
      base.forEach((row) => {
        row.extraWhole = Math.floor(row.extraRaw);
        row.extraFrac = row.extraRaw - row.extraWhole;
        row.durationMin += row.extraWhole;
        usedExtra += row.extraWhole;
      });

      let left = extraMinutes - usedExtra;

      base
        .sort((a, b) => b.extraFrac - a.extraFrac)
        .forEach((row) => {
          if (left <= 0) return;
          row.durationMin += 1;
          left -= 1;
        });

      for (let i = 0; i < allocations.length; i += 1) {
        const found = base.find((x) => x.key === allocations[i].key);
        allocations[i].durationMin = found ? found.durationMin : allocations[i].durationMin;
      }
    }

    const items: Array<{
      id: string;
      mcId: string;
      name: string;
      role: string;
      startTime: string;
      endTime: string;
      durationMin: number;
      task: string;
      script: string;
      scheduleTopic?: string;
      meetingTopic?: string;
      parentTopic?: string;
      chat: string[];
    }> = [];

    let cursor = new Date(meetingStartDate);
    let segmentCursor = 0;

    const segmentedRows = allocations.map((row) => ({
      ...row,
      segments: splitProgramMinutes(row.durationMin, row.key, row.minChunk),
    }));

    const maxRounds = segmentedRows.reduce(
      (max, row) => Math.max(max, row.segments.length),
      0
    );

    const programPriorityForRound = (
      key: string,
      roundIndex: number,
      totalRounds: number,
      totalSegments: number
    ) => {
      const isFirstRound = roundIndex === 0;
      const isLastRound = roundIndex === totalRounds - 1;
      const isMiddleRound = !isFirstRound && !isLastRound;
      const isProgramLastPart = roundIndex === totalSegments - 1;

      if (key === "mc") {
        if (isFirstRound) return 14;
        if (isMiddleRound) return 44;
        if (isLastRound || isProgramLastPart) return 88;
        return 44;
      }

      if (key === "prayer") {
        if (isFirstRound) return 10;
        if (isLastRound || isProgramLastPart) return 96;
        return 82;
      }

      if (key === "guests") {
        if (isFirstRound) return 20;
        return 60;
      }

      if (key === "choir") {
        if (isLastRound) return 64;
        return 32;
      }

      if (key === "testimony") {
        if (isLastRound) return 62;
        return 38;
      }

      if (key === "offering") {
        if (isLastRound || isProgramLastPart) return 78;
        return 58;
      }

      if (key === "announcements") {
        if (isLastRound || isProgramLastPart) return 84;
        return 72;
      }

      return 50;
    };

    for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
      const roundRows = segmentedRows
        .filter((row) => !!row.segments[roundIndex])
        .map((row) => {
          const basePriority = programPriorityForRound(
            row.key,
            roundIndex,
            maxRounds,
            row.segments.length
          );

          let jitter = 0;

          if (row.key === "mc") {
            jitter = roundIndex === 0 ? Math.random() * 2 : Math.random() * 8;
          } else if (row.key === "prayer") {
            jitter = Math.random() * 6;
          } else if (row.key === "choir") {
            jitter = Math.random() * 18;
          } else if (row.key === "testimony") {
            jitter = Math.random() * 16;
          } else if (row.key === "announcements") {
            jitter = Math.random() * 10;
          } else if (row.key === "offering") {
            jitter = Math.random() * 12;
          } else if (row.key === "guests") {
            jitter = Math.random() * 14;
          } else {
            jitter = Math.random() * 10;
          }

          return {
            ...row,
            __priority: basePriority + jitter,
            __shuffle: Math.random(),
          };
        })
        .sort((a, b) => {
          if (a.__priority !== b.__priority) return a.__priority - b.__priority;
          if (a.weight !== b.weight) return b.weight - a.weight;
          if (a.__shuffle !== b.__shuffle) return a.__shuffle - b.__shuffle;
          return a.title.localeCompare(b.title);
        });

      roundRows.forEach((row) => {
        const segmentMin = row.segments[roundIndex];
        if (!segmentMin) return;

        const start = new Date(cursor);
        const end = new Date(start.getTime() + segmentMin * 60000);
        const totalSegments = row.segments.length;

        let partLabel = "";
        if (!isMediaSchedule && row.key === "mc" && totalSegments > 1) {
          if (roundIndex === 0) {
            partLabel = " Opening";
          } else if (roundIndex === totalSegments - 1) {
            partLabel = " Closing";
          } else {
            partLabel = " Middle";
          }
        } else if (!isMediaSchedule && row.key === "prayer" && totalSegments > 1) {
          if (roundIndex === 0) {
            partLabel = " Opening Prayer";
          } else if (roundIndex === totalSegments - 1) {
            partLabel = " Closing Prayer";
          } else {
            partLabel = ` Part ${roundIndex + 1}/${totalSegments}`;
          }
        } else if (!isMediaSchedule && row.key === "prayer" && totalSegments === 1) {
          partLabel = " Prayer";
        } else {
          partLabel = totalSegments > 1 ? ` Part ${roundIndex + 1}/${totalSegments}` : "";
        }

        const slotName = isMediaSchedule
          ? row.title
          : row.key === "prayer"
            ? partLabel.trim()
            : `${row.title}${partLabel}`;
        const slotTask = `${slotName} • ${scheduleType}`;
        const { script: slotScript } = resolveScheduleSlotScript(
          {
            name: slotName,
            title: slotName,
            task: slotTask,
            role: row.detail,
            roleLabel: row.detail,
            topic: (row as any)?.topic,
            assignmentTopic: (row as any)?.assignmentTopic,
            slotTopic: (row as any)?.slotTopic,
            description: (row as any)?.description,
          },
          scheduleTopic,
          {
            slotNumber: segmentCursor + 1,
            title: slotName,
          }
        );

        items.push({
          id: `meeting-review-${row.key}-${roundIndex + 1}-${segmentCursor + 1}-${Date.now()}`,
          mcId: `meeting-review-${segmentCursor + 1}`,
          name: slotName,
          role: row.detail,
          startTime: formatTime(start),
          endTime: formatTime(end),
          durationMin: segmentMin,
          task: slotTask,
          script: slotScript,
          scheduleTopic,
          meetingTopic: scheduleTopic,
          parentTopic: scheduleTopic,
          chat: [
            `Audience: ${scheduleTarget}`,
            `Review detail: ${row.detail}`,
            `Meeting day: ${scheduleDay}`,
            `Weight used: ${row.weight.toFixed(2)}`,
            `Allocated: ${segmentMin} min`,
            totalSegments > 1 ? `Split segment: ${roundIndex + 1} of ${totalSegments}` : "",
            `AI auto-weighted from enabled programs and selected meeting range`,
            meetingSpecialNote?.trim() ? `Note: ${meetingSpecialNote.trim()}` : "",
          ].filter(Boolean),
        });

        cursor = new Date(end);
        segmentCursor += 1;
      });
    }

    if (items.length) {
      const last = items[items.length - 1];
      const lastStart = parseTimeToDate(
        meetingEndDay,
        meetingEndMonth,
        meetingEndYear,
        last.startTime
      );

      if (lastStart.getTime() < meetingEndDate.getTime()) {
        last.endTime = formatTime(meetingEndDate);
        last.durationMin = Math.max(
          1,
          Math.round((meetingEndDate.getTime() - lastStart.getTime()) / 60000)
        );
        last.chat = [
          `Audience: ${scheduleTarget}`,
          `Review detail: ${last.role}`,
          `Meeting day: ${scheduleDay}`,
          `Final adjusted to end exactly at selected range`,
          `Allocated: ${last.durationMin} min`,
          `AI auto-weighted from enabled programs and selected meeting range`,
          meetingSpecialNote?.trim() ? `Note: ${meetingSpecialNote.trim()}` : "",
        ].filter(Boolean);
      }
    }

    saveChurchProjectMeetingPlan(assignmentId, {
      day: scheduleDay,
      time: meetingStartHour,
      type: scheduleType,
      topic: scheduleTopic,
      target: scheduleTarget,
      sentToSchedule: true,
    });

    const nextScheduleBatchCreatedAt = Date.now();
    const nextScheduleBatchId = `batch_${nextScheduleBatchCreatedAt}`;

    saveChurchProjectScheduleSlots(
      assignmentId,
      [
        ...items.map((item) => ({
        id: item.id,
        scheduleBatchId: nextScheduleBatchId,
        scheduleBatchCreatedAt: nextScheduleBatchCreatedAt,
        name: item.name,
        minutes: item.durationMin,
        startTime: item.startTime,
        endTime: item.endTime,
        timeLabel: `${item.startTime} - ${item.endTime}`,
        meetingDate: parseTimeToDate(
          meetingStartDay,
          meetingStartMonth,
          meetingStartYear,
          item.startTime
        ).toISOString(),
        meetingDay: scheduleDay,
        role: item.role,
        task: item.task,
        script: item.script,
        scheduleTopic,
        meetingTopic: scheduleTopic,
        parentTopic: scheduleTopic,
        chat: item.chat,
        sourceSlotName: item.name,
        visibility: "draft",
        claimedByName: "",
        claimedByUserId: "",
        publishedAt: "",
        isDurationLocked: true,
      })),
        ...scheduleSpeakerSlots,
      ]
    );

    setActiveScheduleBatchIndex(0);

    saveChurchProjectGuestCount(assignmentId, inviteGuests ? 1 : 0);

    saveChurchProjectMcSchedule(assignmentId, {
      eventTitle: `${scheduleType} • ${assignmentTitle}`,
      eventDateLabel: scheduleDay,
      liveStartsAt: formatTime(meetingStartDate),
      items: items.map((item) => ({
        ...item,
        meetingDate: parseTimeToDate(
          meetingStartDay,
          meetingStartMonth,
          meetingStartYear,
          item.startTime
        ).toISOString(),
        meetingDay: scheduleDay,
      })),
      sentToMc: false,
    });

    
    markChurchProjectMcScheduleSent(assignmentId, false);


    if (isMediaSchedule && !isMinistryLiveSchedule) {
      const churchId = String(getSessionSync()?.churchId || "").trim();
      const apiHeaders = getKristoHeaders() as any;

      if (churchId) {
        const activeSchedule = await findActiveMediaScheduleForChurchFromSources(churchId, {
          headers: apiHeaders,
        });

        if (activeSchedule) {
          Alert.alert("Schedule already active", ACTIVE_MEDIA_SCHEDULE_ERROR);
          return;
        }
      }

      const creatorUserId = String(getSessionSync()?.userId || "").trim();
      let scheduleAuthority = buildMediaScheduleAuthorityFields({
        churchPastorUserId: "",
        creatorUserId,
        mediaHosts: [],
      });

      try {
        const mediaRes: any = await apiGet("/api/church/media", { headers: apiHeaders });
        const pastorResolution = await fetchChurchPastorUserId(churchId, apiHeaders);
        scheduleAuthority = buildMediaScheduleAuthorityFields({
          churchPastorUserId: pastorResolution.actualChurchPastorUserId,
          creatorUserId,
          mediaHosts: Array.isArray(mediaRes?.media?.hosts) ? mediaRes.media.hosts : [],
          sourceField: pastorResolution.sourceField,
        });

        logChurchPastorResolution({
          churchId,
          actualChurchPastorUserId: pastorResolution.actualChurchPastorUserId,
          sourceField: pastorResolution.sourceField,
          scheduleCreatedByUserId: creatorUserId,
          currentUserId: creatorUserId,
        });
      } catch {}

      const localScheduleId = `media-schedule-${Date.now()}`;

      console.log("KRISTO_SCHEDULE_CREATE_REQUEST", {
        screen: "church-project-tool.media-schedule",
        churchId,
        localScheduleId,
        slotCount: items.length,
        source: "media-schedule",
        scheduleType: "media-live-slots",
      });

      const scheduleSlotsPayload = items.map((item, index) => ({
        id: item.id,
        name: item.name,
        slotLabel: `Slot ${index + 1}`,
        durationMin: item.durationMin,
        startTime: item.startTime,
        endTime: item.endTime,
        timeLabel: `${item.startTime} - ${item.endTime}`,
        role: item.role,
        task: item.task,
        script: item.script,
        scheduleTopic,
        meetingTopic: scheduleTopic,
        parentTopic: scheduleTopic,
        chat: item.chat,
        meetingDate: parseTimeToDate(
          meetingStartDay,
          meetingStartMonth,
          meetingStartYear,
          item.startTime
        ).toISOString(),
        meetingDay: scheduleDay,
      }));

      const localSchedulePayload = {
        id: localScheduleId,
        churchId,
        kind: "post",
        title: "Media Live Cards",
        topic: scheduleTopic,
        text:
          `${scheduleTopic}\n\n` +
          `${items.length} claimable slots • ${scheduleDay}\n` +
          `Audience: ${scheduleTarget}\n` +
          `Swipe inside this post to claim a slot.`,
        body:
          `${scheduleTopic}\n\n` +
          `${items.length} claimable slots • ${scheduleDay}\n` +
          `Audience: ${scheduleTarget}\n` +
          `Swipe inside this post to claim a slot.`,
        createdAt: new Date().toISOString(),
        source: "media-schedule",
        scheduleType: "media-live-slots",
        pendingBackendSync: true,
        actorLabel: routeMediaName || assignmentTitle || "MEDIA",
        mediaName: routeMediaName || assignmentTitle || "MEDIA",
        churchLabel: routeChurchName || assignmentTitle || "Media Schedule",
        churchName: routeChurchName || assignmentTitle || "Media Schedule",
        ...scheduleAuthority,
        actorAvatarUri: routeAvatar,
        churchAvatarUri: routeAvatar,
        avatarUri: routeAvatar,
        scheduleSlots: scheduleSlotsPayload,
        visibility: "public",
        audience: "global",
        isGlobalMediaSlot: true,
      };

      feedPublishMediaScheduleLocal(localSchedulePayload);
      markLocalSchedulePendingBackend(localScheduleId, churchId);

      let createRes: any = null;
      try {
        createRes = await apiPost(
          "/api/church/feed",
          {
            type: "post",
            title: "Media Live Cards",
            text: localSchedulePayload.text,
            source: "media-schedule",
            scheduleType: "media-live-slots",
            ministryId: String((params as any)?.ministryId || (params as any)?.roomId || assignmentId || ""),
            roomId: String((params as any)?.roomId || (params as any)?.sourceRoomId || assignmentId || ""),
            ...scheduleAuthority,
            actorLabel: routeMediaName || assignmentTitle || "MEDIA",
            mediaName: routeMediaName || assignmentTitle || "MEDIA",
            churchLabel: routeChurchName || assignmentTitle || "Media Schedule",
            churchName: routeChurchName || assignmentTitle || "Media Schedule",
            visibility: "public",
            audience: "global",
            isGlobalMediaSlot: true,
            actorAvatarUri: routeAvatar,
            churchAvatarUri: routeAvatar,
            avatarUri: routeAvatar,
            scheduleSlots: scheduleSlotsPayload,
          },
          { headers: apiHeaders }
        );
      } catch (e: any) {
        createRes = {
          ok: false,
          error: String(e?.message || e?.error || e),
          status: Number(e?.status || e?.response?.status || 0) || null,
        };
      }

      const backendFeedId = String(
        createRes?.data?.id || createRes?.item?.id || createRes?.id || ""
      ).trim();

      console.log("KRISTO_SCHEDULE_CREATE_SUCCESS", {
        screen: "church-project-tool.media-schedule",
        ok: Boolean(createRes?.ok),
        churchId,
        localScheduleId,
        backendFeedId: backendFeedId || null,
        scheduleId: String(
          createRes?.data?.sourceScheduleId ||
            createRes?.item?.sourceScheduleId ||
            backendFeedId ||
            ""
        ),
        slotCount: scheduleSlotsPayload.length,
        error: createRes?.ok ? null : String(createRes?.error || createRes?.message || ""),
        status: Number(createRes?.status || 0) || null,
      });

      if (!createRes?.ok) {
        const failStatus = Number(createRes?.status || 0) || null;
        const failError = String(createRes?.error || createRes?.message || "").trim();

        removeLocalScheduleAfterBackendFail({
          localScheduleId,
          churchId,
          status: failStatus,
          error: failError,
          screen: "church-project-tool.media-schedule",
          gate: "tool-create-schedule.api",
        });

        if (failStatus === 409) {
          Alert.alert("Schedule already active", ACTIVE_MEDIA_SCHEDULE_ERROR);
        } else {
          Alert.alert("Schedule not saved", scheduleBackendFailAlertMessage(failStatus || 0, failError));
        }
        return;
      }

      const backendItem = createRes?.item || createRes?.data || createRes;
      replaceLocalScheduleWithBackend(backendItem, localScheduleId, {
        churchId,
        scheduleSlots: scheduleSlotsPayload,
      });

      if (churchId) {
        const sync = await fetchMediaScheduleFeedSync(churchId, apiHeaders);
        applySilentMediaScheduleReload({
          churchId,
          sync,
          reason: "tool-create-schedule",
          force: true,
        });
      }

      Alert.alert("Sent to Home Feed", `${items.length} media tools were sent as claimable live cards.`);
      router.push("/" as any);
      return;
    }
router.replace({
      pathname: "/kingdom/church-project-tool/[assignmentId]/[tool]",
      params: {
        assignmentId,
        tool: "schedule",
        title: assignmentTitle,
        subtitle: assignmentSubtitle,
        role,
        status,
        source: sourceParam || "ministry-live",
        roomId: targetRoomId,
        sourceRoomId: sourceBackRoomId || targetRoomId || assignmentId,
        mcAccess: "1",
        mediaAccess: routeMediaAccess,
        ministryId: routeMinistryId,
        avatar: routeAvatar,
      },
    } as any);
  }

  function handlePushScheduleToMc() {
    const parentTopic = String(meetingTopic || meetingTopicChoice || "").trim();
    const items = scheduleSpeakerSlots.map((slot, index) => {
      const slotName =
        index === 0
          ? "MC Opening"
          : index === scheduleSpeakerSlots.length - 1
            ? "MC Main"
            : `MC ${index + 1}`;
      const slotRole =
        index === 0
          ? "Opening"
          : index === scheduleSpeakerSlots.length - 1
            ? "Main"
            : "Support";
      const { script: slotScript } = resolveScheduleSlotScript(
        {
          ...slot,
          name: slotName,
          title: slotName,
          task: String(slot?.task || slot?.name || slotName),
          role: slotRole,
          roleLabel: slotRole,
        },
        parentTopic,
        {
          slotNumber: index + 1,
          title: slotName,
        }
      );

      return {
        id: slot.id,
        mcId: `mc-${index + 1}`,
        name: slotName,
        role: slotRole,
        startTime: meetingTime,
        endTime: meetingTime,
        durationMin: slot.minutes,
        task: String(slot?.task || slot?.name || slotName),
        script: slotScript,
        scheduleTopic: parentTopic,
        meetingTopic: parentTopic,
        parentTopic,
        chat: [
          `Day: ${meetingDay}`,
          `Time: ${meetingTime}`,
          `Target: ${meetingTarget}`,
          parentTopic ? `Meeting topic: ${parentTopic}` : "",
        ].filter(Boolean),
      };
    });

    saveChurchProjectMcSchedule(assignmentId, {
      eventTitle: `${meetingType} • ${assignmentTitle}`,
      eventDateLabel: meetingDay,
      liveStartsAt: meetingTime,
      items,
    });

    markChurchProjectMcScheduleSent(assignmentId, true);
  }

  const totalScheduleMinutes =
    scheduleSpeakerSlots.reduce((sum, slot) => sum + slot.minutes, 0) +
    scheduleGuestCount * 5;

  const meetingSummaryItems = isMeeting
    ? [
        { label: "START", value: startDayLabel },
        { label: "TIME", value: startTimeLabel },
        { label: "TARGET", value: meetingAudience },
        { label: "STATUS", value: meetingSentToSchedule ? "Sent" : `Step ${meetingStep}/5` },
      ]
    : [];

  const scheduleSummaryItems = isSchedule
    ? [
        { label: "SOURCE", value: meetingSentToSchedule ? meetingType : "Waiting" },
        { label: "SLOTS", value: `${scheduleSpeakerSlots.length}` },
        { label: "GUESTS", value: `${scheduleGuestCount}` },
        { label: "MC", value: schedulePushedToMc ? "Pushed" : "Pending" },
      ]
    : [];

  if (isLockedMeetingOrSchedule) {
    return (
      <View style={[s.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Ionicons name="lock-closed-outline" size={38} color={GOLD} />
        <Text style={[s.heroTitle, { marginTop: 16, textAlign: "center" }]}>Access locked</Text>
        <Text style={[s.heroSub, { marginTop: 8, textAlign: "center" }]}>
          Only assignment leaders or selected MC+ Hosts can open Meeting and Schedule.
        </Text>
        <Pressable onPress={() =>
            router.replace({
              pathname: "/(tabs)/more/my-church-room/messages/[id]" as any,
              params: {
                id: assignmentId,
                title: assignmentTitle,
                sub: assignmentSubtitle || "Ministry room",
                tab: "ministries",
                source: "my_ministries",
                roomKind: "ministry",
                role: role || "leader",
                status: "",
                assignmentId,
                assignmentTitle,
                assignmentSubtitle: assignmentSubtitle || "Ministry room",
                assignmentRole: role || "leader",
                assignmentStatus: "",
                assignmentInitials: "M",
              },
            })
          } style={[s.primaryCta, { marginTop: 20 }]}>
          <Text style={s.primaryCtaText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topBar}>
        <Pressable
          onPress={() => {
            console.log("🧭 SCHEDULE_BACK_TO_MINISTRY_ROOM");
            router.replace({
              pathname: "/(tabs)/more/my-church-room/messages/[id]",
              params: {
                id: sourceBackRoomId || targetRoomId || assignmentId,
                title: assignmentTitle,
                sub: assignmentSubtitle,
                tab: "ministries",
                source: sourceParam || "ministry-live",
                roomKind: "assignment",
                roomMode: "assignment",
                mediaAccess: routeMediaAccess,
                ministryId: routeMinistryId,
                assignmentId,
                assignmentTitle,
                assignmentSubtitle,
                assignmentRole: role,
                assignmentStatus: status,
                assignmentInitials: assignmentTitle.charAt(0).toUpperCase(),
                avatar: routeAvatar,
              },
            } as any);
          }}
          data-debug-back="schedule"
                   style={({ pressed }) => [s.iconBtn, pressed ? s.pressed : null]}
        >
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={s.topText}>
          <Text style={s.topTitle} numberOfLines={1}>{isMediaGuests ? "Media Guests" : isMediaSchedule ? "Media Schedule" : meta.title}</Text>
          <Text style={s.topSub} numberOfLines={1}>{isMediaGuests ? "Claim Center" : isMediaSchedule ? "Media Studio" : assignmentTitle}</Text>
        </View>


        {scheduleConflictInfo ? (
          <Modal
            visible={!!scheduleConflictInfo}
            transparent
            animationType="fade"
            onRequestClose={() => setScheduleConflictInfo(null)}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.82)",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 22,
              }}
            >
              <View
                style={{
                  width: "100%",
                  borderRadius: 28,
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.36)",
                  backgroundColor: "#0B1220",
                  padding: 22,
                  shadowColor: "#000",
                  shadowOpacity: 0.35,
                  shadowRadius: 28,
                  elevation: 12,
                }}
              >
                <Text style={{ color: "#FCA5A5", fontSize: 12, fontWeight: "900", letterSpacing: 2 }}>
                  SCHEDULE CONFLICT
                </Text>

                <Text style={{ color: TEXT, fontSize: 28, lineHeight: 34, fontWeight: "900", marginTop: 8 }}>
                  Time already used
                </Text>

                <Text style={{ color: SOFT, fontSize: 15, lineHeight: 22, marginTop: 8 }}>
                  This time is already taken. Choose another start or end time.
                </Text>

                <View
                  style={{
                    marginTop: 18,
                    borderRadius: 22,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    padding: 16,
                  }}
                >
                  <Text style={{ color: GOLD, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 }}>
                    USED BY
                  </Text>

                  <Text style={{ color: TEXT, fontSize: 24, fontWeight: "900", marginTop: 4 }}>
                    {scheduleConflictInfo.title}
                  </Text>

                  <View
                    style={{
                      marginTop: 14,
                      borderRadius: 18,
                      backgroundColor: "rgba(239,68,68,0.12)",
                      borderWidth: 1,
                      borderColor: "rgba(239,68,68,0.28)",
                      padding: 14,
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: "#FCA5A5", fontSize: 12, fontWeight: "900", letterSpacing: 1.3 }}>
                      ACTIVE SLOT
                    </Text>
                    <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>
                      {scheduleConflictInfo.batch}
                    </Text>
                    <Text style={{ color: "#FCA5A5", fontSize: 16, fontWeight: "800" }}>
                      {scheduleConflictInfo.date}
                    </Text>
                    <Text style={{ color: "#FCA5A5", fontSize: 24, fontWeight: "900" }}>
                      {scheduleConflictInfo.time}
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => setScheduleConflictInfo(null)}
                  style={({ pressed }) => [
                    {
                      marginTop: 20,
                      height: 58,
                      borderRadius: 20,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: "rgba(217,179,95,0.34)",
                      backgroundColor: "rgba(217,179,95,0.14)",
                    },
                    pressed ? s.pressed : null,
                  ]}
                >
                  <Text style={{ color: GOLD, fontSize: 18, fontWeight: "900" }}>
                    Choose another time
                  </Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {isSchedule ? (
          <View style={{ width: 170, flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={deleteActiveScheduleBatch}
              disabled={!activeScheduleBatch}
              style={{
                flex: 1,
                height: 32,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "#7A1E2C",
                backgroundColor: "rgba(122,30,44,0.22)",
                opacity: activeScheduleBatch ? 1 : 0.45,
              }}
            >
              <Text style={{ color: "#FF7B8B", fontWeight: "900", fontSize: 12 }}>Delete</Text>
            </Pressable>

            <Pressable
              onPress={clearCurrentScheduleSlots}
              style={{
                flex: 1,
                height: 32,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(244,208,111,0.30)",
                backgroundColor: "rgba(244,208,111,0.10)",
              }}
            >
              <Text style={{ color: "#F4D06F", fontWeight: "900", fontSize: 12 }}>Clear</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {isSchedule ? (
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 10,
            backgroundColor: "rgba(11,15,23,0.92)",
            borderBottomWidth: 1,
            borderBottomColor: "rgba(255,255,255,0.05)",
          }}
        >
          {[0, 1, 2, 3, 4].map((idx) => {
            const batch = scheduleBatches[idx];
            const active = idx === activeScheduleBatchIndex;

            return (
              <Pressable
                key={`schedule-batch-row-${idx}`}
                disabled={!batch}
                onPress={() => setActiveScheduleBatchIndex(idx)}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: active
                    ? "#F4D06F"
                    : batch
                      ? "rgba(110,168,255,0.42)"
                      : "rgba(255,255,255,0.08)",
                  backgroundColor: active
                    ? "rgba(217,179,95,0.24)"
                    : batch
                      ? "rgba(110,168,255,0.10)"
                      : "rgba(255,255,255,0.025)",
                  opacity: batch ? 1 : 0.22,
                }}
              >
                <Text
                  style={{
                    color: active
                      ? "#F4D06F"
                      : batch
                        ? "rgba(170,200,255,0.86)"
                        : "rgba(255,255,255,0.25)",
                    fontWeight: "900",
                    fontSize: 13,
                  }}
                >
                  {idx + 1}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <ScrollView
        ref={pageScrollRef}
        scrollEnabled={!meetingTopFlowScrollLocked}
        showsVerticalScrollIndicator={!meetingTopFlowScrollLocked}
        bounces={!meetingTopFlowScrollLocked}
        alwaysBounceVertical={!meetingTopFlowScrollLocked}
        overScrollMode={meetingTopFlowScrollLocked ? "never" : "auto"}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        contentContainerStyle={[s.content, { paddingBottom: 220 }]}
        automaticallyAdjustKeyboardInsets={!meetingTopFlowScrollLocked}
      >
        {!isMeeting && !isSchedule ? (
          <View style={[s.hero, heroToneStyle]}>
            <View style={s.heroTopRow}>
              <View style={s.heroIcon}>
                <Ionicons name={meta.icon} size={24} color={GOLD} />
              </View>

              <View style={[s.accessPill, statusPillStyle]}>
                <Text style={s.accessPillText}>{accessTitle}</Text>
              </View>
            </View>

            <Text style={s.heroKicker}>ASSIGNMENT TOOL</Text>
            <Text style={s.heroTitle}>{meta.title}</Text>
            <Text style={s.heroSub}>{meta.blurb}</Text>

            <View style={s.infoRow}>
              <View style={[s.pill, rolePillStyle]}>
                <Text style={s.pillText}>{roleLabel}</Text>
              </View>
              <View style={s.pill}>
                <Text style={s.pillText}>{status}</Text>
              </View>
              <View style={s.pill}>
                <Text style={s.pillText}>{requirementLabel(meta.required)}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {!isMeeting && !isSchedule ? (
          <View style={[s.accessCard, accessCardStyle]}>
            <View style={s.accessIconWrap}>
              <Ionicons
                name={accessAllowed ? "checkmark-circle-outline" : "lock-closed-outline"}
                size={18}
                color={accessAllowed ? EMERALD : RED}
              />
            </View>

            <View style={s.accessTextWrap}>
              <Text style={s.accessTitle}>{accessTitle}</Text>
              <Text style={s.accessSub}>{accessMessage}</Text>
            </View>
          </View>
        ) : null}

        {!isMeeting && !isSchedule ? (
          <View style={s.summaryGrid}>
            {summaryItems.map((item) => (
              <View key={item.label} style={s.summaryCard}>
                <Text style={s.summaryLabel}>{item.label}</Text>
                <Text style={s.summaryValue} numberOfLines={1}>{item.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {isMeeting ? (
          <>

            {!meetingBuilderOpen ? (
              <Animated.View
                style={{
                  opacity: meetingStatusOpacity,
                transform: [
                  { translateY: meetingStatusLift },
                  { scale: meetingStatusPulse },
                ],
                borderWidth: 1,
                borderColor: "rgba(16,185,129,0.24)",
                backgroundColor: "rgba(16,185,129,0.10)",
                borderRadius: 20,
                padding: 12,
                marginTop: 2,
                marginBottom: 8,
                minHeight: 540,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  marginBottom: 8,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    flex: 1,
                    paddingRight: 10,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 14,
                      backgroundColor: "rgba(16,185,129,0.14)",
                      alignItems: "center",
                      
                    }}
                  >
                    <Ionicons name="pulse-outline" size={18} color={EMERALD} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[s.cardLabel, { color: "#86efac", marginBottom: 4 }]}>LIVE STATUS</Text>
                    <Text style={{ color: TEXT, fontSize: 16, fontWeight: "800" }}>{liveStatusTitle}</Text>
                  </View>
                </View>

                <View
                  style={{
                    paddingHorizontal: 11,
                    paddingVertical: 6,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: "rgba(16,185,129,0.25)",
                    backgroundColor: "rgba(16,185,129,0.12)",
                  }}
                >
                  <Text style={{ color: "#bbf7d0", fontSize: 12, fontWeight: "700", letterSpacing: 0.4 }}>
                    {meetingSentToSchedule ? "ON FLOW" : "DRAFT"}
                  </Text>
                </View>
              </View>

              <Text style={[s.cardSub, { color: "rgba(226,232,240,0.88)", marginBottom: 12 }]}>
                {liveStatusBody}
              </Text>

              <View
                style={{
                  borderRadius: 13,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.06)",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  padding: 14,
                  minHeight: 250,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: TEXT, fontSize: 12, fontWeight: "800" }}>Flow progress</Text>
                  <Text style={{ color: GOLD, fontSize: 13, fontWeight: "800" }}>{liveProgressPct}%</Text>
                </View>

                <View
                  style={{
                    width: "100%",
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: "rgba(255,255,255,0.04)",
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      width: `${liveProgressPct}%`,
                      height: "100%",
                      borderRadius: 999,
                      backgroundColor: "rgba(16,185,129,0.85)",
                    }}
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={[s.cardSub, { fontSize: 13 }]}>Type: {meetingTitleChoice}</Text>
                  <Text style={[s.cardSub, { fontSize: 13 }]}>Topic: {meetingTopicChoice}</Text>
                  <Text style={[s.cardSub, { fontSize: 13 }]}>Start: {startDayLabel} • {startTimeLabel}</Text>
                  <Text style={[s.cardSub, { fontSize: 13 }]}>Audience: {audienceSummaryLabel}</Text>
                </View>
              </View>

              
</Animated.View>
            ) : null}

            <View style={{ marginTop: meetingBuilderOpen ? 6 : 20 }}>
              {!meetingBuilderOpen ? (
                <View style={[s.ctaRow, { marginTop: 10, flexDirection: "row", gap: 6 }]}>
                  <Pressable
                    onPress={() => {
                      setMeetingBuilderOpen(false);
                      setMeetingCreateMode(false);
                    }}
                    style={({ pressed }) => [
                      s.secondaryCta,
                      {
                        flex: 1,
                        minHeight: 46,
                        borderRadius: 15,
                        
                      },
                      pressed ? s.pressed : null,
                    ]}
                  >
                    <Ionicons name="list-outline" size={16} color={GOLD} />
                    <Text style={s.secondaryCtaText}>Event list</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setMeetingBuilderOpen(true);
                      setMeetingCreateMode(true);
                      setMeetingStep(1 as 1 | 2 | 3 | 4 | 5);
                      setMeetingTopicChoice("");
                      setMeetingTopicExampleIndex(0);
                    }}
                    style={({ pressed }) => [
                      s.primaryCta,
                      {
                        flex: 1,
                        minHeight: 46,
                        borderRadius: 15,
                        
                      },
                      pressed ? s.pressed : null,
                    ]}
                  >
                    <Ionicons name="create-outline" size={15} color={TEXT} />
                    <Text style={s.primaryCtaText}>Create event</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    bounces={false}
                    contentContainerStyle={{
                      gap: 4,
                      paddingLeft: 2,
                      paddingRight: 20,
                      marginTop: 2,
                    }}
                  >
                    {[
                      { key: 1 as const, label: "Create", icon: "create-outline" },
                      { key: 2 as const, label: "Start", icon: "play-outline" },
                      { key: 3 as const, label: "End", icon: "stop-outline" },
                      { key: 4 as const, label: "Options", icon: "options-outline" },
                      { key: 5 as const, label: "Review", icon: "document-text-outline" },
                      
                    ].map((item) => {
                      const active = meetingStep === item.key;
                      const done = meetingStep > item.key || (meetingSentToSchedule && item.key === 5);

                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => {
                            setMeetingStep(item.key as 1 | 2 | 3 | 4 | 5 | 6);
                            setTimeout(() => {
                              scrollMeetingStepIntoView(item.key as 1 | 2 | 3 | 4 | 5 | 6);
                            }, 40);
                          }}
                          style={({ pressed }) => [
                            {
                              height: 40,
                              paddingHorizontal: 10,
                              borderRadius: 17,
                              borderWidth: 1,
                              borderColor:
                                item.key === 1 && active
                                  ? meetingCreateReady
                                    ? "rgba(16,185,129,0.55)"
                                    : "rgba(239,68,68,0.55)"
                                  : active
                                    ? "rgba(217,179,95,0.45)"
                                    : done
                                      ? "rgba(16,185,129,0.35)"
                                      : "rgba(255,255,255,0.10)",
                              backgroundColor:
                                item.key === 1 && active
                                  ? meetingCreateReady
                                    ? "rgba(16,185,129,0.16)"
                                    : "rgba(239,68,68,0.16)"
                                  : active
                                    ? "rgba(217,179,95,0.12)"
                                    : done
                                      ? "rgba(16,185,129,0.12)"
                                      : "transparent",
                              opacity: 1,

                              shadowColor:
                                item.key === 1 && active
                                  ? meetingCreateReady
                                    ? "#10b981"
                                    : "#ef4444"
                                  : "transparent",
                              shadowOpacity:
                                item.key === 1 && active
                                  ? 0.28
                                  : 0,
                              shadowRadius:
                                item.key === 1 && active
                                  ? meetingCreateReady
                                    ? 12
                                    : 14
                                  : 0,
                              flexDirection: "row",
                              alignItems: "center",
                              
                              gap: 4,
                            },
                            pressed ? s.pressed : null,
                          ]}
                        >
                          <Ionicons
                            name={(done && !active ? "checkmark-circle-outline" : item.icon) as any}
                            size={10}
                            color={
                              item.key === 1 && active
                                ? meetingCreateReady
                                  ? EMERALD
                                  : "#ef4444"
                                : active
                                  ? GOLD
                                  : done
                                    ? EMERALD
                                    : TEXT
                            }
                          />
                          <Text
                            style={{
                              color:
                                item.key === 1 && active
                                  ? meetingCreateReady
                                    ? EMERALD
                                    : "#ef4444"
                                  : active
                                    ? GOLD
                                    : done
                                      ? EMERALD
                                      : TEXT,
                              fontSize: 13,
                              fontWeight: "700",
                            }}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {meetingStep === 1 ? (
                    <View
                      onLayout={(e) => {
                        meetingCreateStepYRef.current = e.nativeEvent.layout.y;
                      }}
                      style={{
                        marginTop: 52,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.08)",
                        backgroundColor: "rgba(255,255,255,0.03)",
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: GOLD, fontSize: 8, fontWeight: "700", letterSpacing: 0.8 }}>
                        CREATE STEP
                      </Text>

                      <Text
                        style={{
                          color: TEXT,
                          fontSize: 20,
                          fontWeight: "700",
                          marginTop: 2,
                        }}
                      >
                        {isMediaSchedule ? "Build the live schedule" : "Build the meeting draft"}
                      </Text>

                      <Text
                        style={{
                          color: SOFT,
                          fontSize: 13,
                          lineHeight: 22,
                          marginTop: 2,
                        }}
                      >
                        {isMediaSchedule ? "Create live time cards people can claim from Home feed." : "Choose the meeting type and enter the topic before moving to the next step."}
                      </Text>

                      <View style={{ gap: 16, marginTop: 18 }}>
                        <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 8,
                            }}
                          >
                            <Text style={{ color: SOFT, fontSize: 8, fontWeight: "800" }}>
                              TOPIC
                            </Text>

                            
                          </View>

                        <View>
                          <View
                            onLayout={(e) => {
                              meetingTopicCardY.current = e.nativeEvent.layout.y;
                            }}
                            style={{
                              borderRadius: 18,
                              borderWidth: 1,
                              borderColor: hasMeetingTopic
                                ? "rgba(16,185,129,0.42)"
                                : "rgba(239,68,68,0.20)",
                              backgroundColor: hasMeetingTopic
                                ? "rgba(16,185,129,0.05)"
                                : "rgba(255,255,255,0.025)",
                              paddingHorizontal: 14,
                              paddingVertical: 6,
                              marginBottom: 8,
                            }}
                          >
                            <Text
                              style={{
                                color: hasMeetingTopic ? "rgba(110,231,183,0.90)" : "rgba(148,163,184,0.72)",
                                fontSize: 8,
                                fontWeight: "700",
                                marginBottom: 8,
                                letterSpacing: 0.3,
                              }}
                            >
                              {hasMeetingTopic
                                ? "TOPIC ENTERED"
                                : `Example: ${meetingTopicExamples[meetingTopicExampleIndex]}`}
                            </Text>

                            <TextInput
                              value={meetingTopicChoice}
                              onChangeText={(text) => setMeetingTopicChoice(text.slice(0, 50))}
                              maxLength={50}
                              placeholder={isMediaSchedule ? "Type live schedule title..." : "Type meeting topic..."}
                              placeholderTextColor="rgba(148,163,184,0.58)"
                              selectionColor={GOLD}
                              multiline
                              scrollEnabled={false}
                              textAlignVertical="top"
                              returnKeyType="done"
                              blurOnSubmit
                              onSubmitEditing={() => {
                                Keyboard.dismiss();
                              }}
                              style={{
                                color: TEXT,
                                fontSize: 16,
                                fontWeight: "700",
                                minHeight: 64,
                                paddingTop: 0,
                                paddingBottom: 0,
                              }}
                            />
                          </View>



                          
<View>
                          <Text style={{ color: GOLD, fontSize: 8, fontWeight: "700", marginBottom: 8 }}>
                            {isMediaSchedule ? "LIVE CARD TYPE" : "MEETING TYPE"}
                          </Text>

                          <View
                            style={{
                              flexDirection: "row",
                              flexWrap: "wrap",
                              justifyContent: "space-between",
                              rowGap: 10,
                            }}
                          >
                            {(isMediaSchedule
                              ? ["Prayer service", "Counseling", "Testimony", "Teaching"]
                              : [
                                  "Leaders meeting",
                                  "Workers meeting",
                                  "Department meeting",
                                  "Prayer meeting",
                                ]
                            ).map((item) => {
                              const active = meetingTitleChoice === item;
                              return (
                                <Pressable
                                  key={item}
                                  onPress={() => setMeetingTitleChoice(item)}
                                  style={({ pressed }) => [
                                    {
                                      width: "48.6%",
                                      minHeight: 84,
                                      paddingHorizontal: 14,
                                      paddingVertical: 9,
                              marginBottom: 8,
                                      borderRadius: 18,
                                      borderWidth: 1,
                                      borderColor: active
                                        ? "rgba(16,185,129,0.50)"
                                        : "rgba(239,68,68,0.18)",
                                      backgroundColor: active
                                        ? "rgba(16,185,129,0.12)"
                                        : "rgba(255,255,255,0.025)",
                                      
                                      overflow: "hidden",
                                    },
                                    pressed ? s.pressed : null,
                                  ]}
                                >
                                  {!active ? (
                                    <Animated.View
                                      pointerEvents="none"
                                      style={{
                                        bottom: 0,
                                        borderRadius: 18,
                                        backgroundColor: "rgba(239,68,68,0.08)",
                                        opacity: 0.12,
                                      }}
                                    />
                                  ) : null}

                                  <Text
                                    style={{
                                      color: active ? EMERALD : TEXT,
                                      fontSize: 16,
                                      lineHeight: 22,
                                      fontWeight: "700",
                                    }}
                                  >
                                    {item}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {meetingStep === 2 ? (
                    <View
                      onLayout={(e) => {
                        meetingStartStepYRef.current = e.nativeEvent.layout.y;
                      }}
                      style={{
                        marginTop: 34,
                        borderRadius: 20,
marginBottom: 12,
                        borderWidth: 1,
                        borderColor: "rgba(217,179,95,0.22)",
                        backgroundColor: "rgba(255,255,255,0.03)",
                        padding: 12,
                        paddingBottom: 16,
                      }}
                    >
                      <Text style={{ color: GOLD, fontSize: 13, fontWeight: "700", letterSpacing: 0.8 }}>
                        START STEP
                      </Text>

                      <Text
                        style={{
                          color: TEXT,
                          fontSize: 20,
                          fontWeight: "900",
                          marginTop: 2,
                        }}
                      >
                        {isMediaSchedule ? "Choose live start time" : "Choose meeting start time"}
                      </Text>

                      <View style={{ gap: 4, marginTop: 2 }}>
                        <View
                          style={{
                            borderRadius: 13,
                            borderWidth: 1,
                            borderColor: "rgba(217,179,95,0.20)",
                            backgroundColor: "rgba(255,255,255,0.022)",
                            padding: 8,
                          }}
                        >
                          <Text style={{ color: GOLD, fontSize: 9, fontWeight: "800", marginBottom: 4 }}>
                            SELECTED START
                          </Text>
                          <Text
                            style={{
                              color: TEXT,
                              fontSize: 17,
                              fontWeight: "900",
                              textShadowColor: "rgba(16,185,129,0.28)",
                              textShadowRadius: 10,
                            }}
                          >
                            {meetingStartDay} {meetingStartMonth} {meetingStartYear}
                          </Text>
                          <Text style={{ color: EMERALD, fontSize: 13, fontWeight: "800", marginTop: 4 }}>
                            {meetingStartHour}
                          </Text>
                        </View>

                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            rowGap: 10,
                          }}
                        >
                          {[
                            {
                              label: "YEAR",
                              value: meetingStartYear,
                              options: ["2024","2025","2026","2027","2028","2029","2030","2024","2025","2026","2027","2028","2029","2030"],
                              setter: "year",
                            },
                            {
                              label: "MONTH",
                              value: meetingStartMonth,
                              options: [
                                "January","February","March","April","May","June","July","August","September","October","November","December",
                                "January","February","March","April","May","June","July","August","September","October","November","December",
                                "January","February","March","April","May","June","July","August","September","October","November","December"
                              ],
                              setter: "month",
                            },
                            {
                              label: "DATE",
                              value: meetingStartDay,
                              options: [
                                ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
                                ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
                              ],
                              setter: "day",
                            },
                            {
                              label: "HOUR",
                              value: meetingStartMinuteMode
                                ? ((((meetingStartHour.split(":")[1] || "00").split(" ")[0]) == "00")
                                    ? "05"
                                    : ((meetingStartHour.split(":")[1] || "00").split(" ")[0]))
                                : meetingStartHour,
                              options: meetingStartMinuteMode
                                ? meetingMinuteOptions
                                : [
                                    "12:00 AM","1:00 AM","2:00 AM","3:00 AM","4:00 AM","5:00 AM","6:00 AM","7:00 AM","8:00 AM","9:00 AM","10:00 AM","11:00 AM",
                                    "12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM","6:00 PM","7:00 PM","8:00 PM","9:00 PM","10:00 PM","11:00 PM",
                                    "12:00 AM","1:00 AM","2:00 AM","3:00 AM","4:00 AM","5:00 AM","6:00 AM","7:00 AM","8:00 AM","9:00 AM","10:00 AM","11:00 AM",
                                    "12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM","6:00 PM","7:00 PM","8:00 PM","9:00 PM","10:00 PM","11:00 PM",
                                    "12:00 AM","1:00 AM","2:00 AM","3:00 AM","4:00 AM","5:00 AM","6:00 AM","7:00 AM","8:00 AM","9:00 AM","10:00 AM","11:00 AM",
                                    "12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM","6:00 PM","7:00 PM","8:00 PM","9:00 PM","10:00 PM","11:00 PM"
                                  ],
                              setter: "hour",
                            },
                          ].map((card) => (
                            <View
                              key={card.label}
                              style={{
                                width: "48.6%",
                                borderRadius: 13,
                                borderWidth: 1,
                                borderColor: "rgba(255,255,255,0.075)",
                                backgroundColor: "rgba(255,255,255,0.020)",
                                padding: 10,
                              }}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                <Text style={{ color: GOLD, fontSize: 9, fontWeight: "800" }}>
                                  {card.setter === "hour" ? "" : card.label}
                                </Text>

                                {card.setter === "hour" ? (
                                  <View
                                    style={{
height: 24,
                                      borderRadius: 999,
                                      padding: 2,
                                      flexDirection: "row",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      alignSelf: "flex-start",
                                      marginLeft: -8,
                                      backgroundColor: "rgba(255,255,255,0.028)",
                                      borderWidth: 1,
                                      borderColor: "rgba(255,255,255,0.07)",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <Pressable
                                      onPress={() => {
                                        setMeetingStartMinuteMode(false);
                                        requestAnimationFrame(() => {
                                          meetingStartHourScrollRef.current?.scrollTo({ y: 0, animated: false });
                                        });
                                      }}
                                      style={({ pressed }) => [
                                        {
                                          flex: 1,
                                          height: "100%",
                                          borderRadius: 999,
                                          alignItems: "center",
                                          justifyContent: "center",
                                          borderWidth: !meetingStartMinuteMode ? 1 : 0,
                                          borderColor: "rgba(16,185,129,0.34)",
                                          backgroundColor: !meetingStartMinuteMode ? "rgba(16,185,129,0.15)" : "transparent",
                                        },
                                        pressed ? s.pressed : null,
                                      ]}
                                    >
                                      <Text
                                        style={{
                                          color: !meetingStartMinuteMode ? EMERALD : "rgba(255,255,255,0.64)",
                                          fontSize: 9,
                                          fontWeight: "700",
                                        }}
                                      >
                                        Hour
                                      </Text>
                                    </Pressable>

                                    <Pressable
                                      onPress={() => {
                                        setMeetingStartMinuteMode(true);
                                        requestAnimationFrame(() => {
                                          meetingStartHourScrollRef.current?.scrollTo({ y: 0, animated: false });
                                        });
                                      }}
                                      style={({ pressed }) => [
                                        {
                                          flex: 1,
                                          height: "100%",
                                          borderRadius: 999,
                                          alignItems: "center",
                                          justifyContent: "center",
                                          borderWidth: meetingStartMinuteMode ? 1 : 0,
                                          borderColor: "rgba(16,185,129,0.34)",
                                          backgroundColor: meetingStartMinuteMode ? "rgba(16,185,129,0.15)" : "transparent",
                                        },
                                        pressed ? s.pressed : null,
                                      ]}
                                    >
                                      <Text
                                        style={{
                                          color: meetingStartMinuteMode ? EMERALD : "rgba(255,255,255,0.64)",
                                          fontSize: 9,
                                          fontWeight: "700",
                                        }}
                                      >
                                        Minutes
                                      </Text>
                                    </Pressable>
                                  </View>
                                ) : null}
                              </View>

                              <View style={{ position: "relative" }}>
                                <ScrollView
                                  ref={card.setter === "hour" ? meetingStartHourScrollRef : undefined}
                                  nestedScrollEnabled
                                  showsVerticalScrollIndicator={false}
                                  style={{ maxHeight: 132 }}
                                  contentContainerStyle={{ gap: 6, paddingTop: 8, paddingBottom: 12 }}
                                  snapToInterval={HOUR_ITEM_HEIGHT}
                                  decelerationRate="fast"
                                  scrollEventThrottle={16}
                                  onContentSizeChange={() => {
                                    if (card.setter === "hour" && meetingEndMinuteMode) {
                                      meetingEndHourScrollRef.current?.scrollTo({ y: 0, animated: false });
                                    } else if (card.setter === "hour") {
                                      ensureHourLoopStart(meetingStartHourScrollRef, meetingStartHourLoopReadyRef);
                                    }
                                  }}
                                  onScroll={(e) => {
                                    if (card.setter === "hour") {
                                      handleHourLoopScroll(
                                        e.nativeEvent.contentOffset.y,
                                        meetingStartHourScrollRef,
                                        meetingStartHourLoopReadyRef
                                      );
                                    }
                                  }}
                                >
                                  {card.options.map((option, index) => {
                                    const active = card.value === option;
                                    const disabledPast = isMeetingStartOptionPast(String(card.setter), String(option));
                                    return (
                                      <Pressable
                                        key={`${card.label}-${option}-${index}`}
                                        disabled={disabledPast}
                                        onPress={() => {
                                          if (disabledPast) return;
                                          if (card.setter === "year") {
                                            setMeetingStartYear(option);
                                        }
                                          if (card.setter === "month") {
                                            setMeetingStartMonth(option);
                                        }
                                          if (card.setter === "day") {
                                            setMeetingStartDay(option);
                                        }
                                          if (card.setter === "hour") {
                                          const nextHour = meetingStartMinuteMode
                                            ? setMeetingPickerMinute(meetingStartHour, option)
                                            : option;
                                          setMeetingStartHour(nextHour);
                                          if (meetingStartMinuteMode) setMeetingStartMinuteMode(false);

                                        }
                                        }}
                                        style={({ pressed }) => [
                                          {
                                            minHeight: 46,
                                            borderRadius: 13,
                                            borderWidth: 1,
                                            borderColor: active ? "rgba(16,185,129,0.48)" : "rgba(255,255,255,0.075)",
                                            backgroundColor: disabledPast
                                              ? "rgba(255,255,255,0.010)"
                                              : active ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.018)",
                                            paddingVertical: 7,
                                            paddingHorizontal: 10,
                                            
                                          },
                                          pressed ? s.pressed : null,
                                        ]}
                                      >
                                        <Text
                                          style={{
                                            color: disabledPast ? "rgba(255,255,255,0.16)" : active ? EMERALD : "rgba(255,255,255,0.42)",
                                            fontSize: active ? 16 : 13,
                                            fontWeight: active ? "900" : "700",
                                            opacity: active ? 1 : 0.62,
                                          }}
                                        >
                                          {isMediaSchedule && option === "Guests"
                                          ? "🌍 Guests"
                                          : isMediaSchedule && option === "Members"
                                            ? "👥 Members"
                                            : isMediaSchedule && option === "Leaders"
                                              ? "🛡 Leaders"
                                              : isMediaSchedule && option === "Leaders & Admins"
                                                ? "👑 Leaders & Admins"
                                                : option}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </ScrollView>

                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {meetingStep === 3 ? (
                    <View
                      onLayout={(e) => {
                        meetingEndStepYRef.current = e.nativeEvent.layout.y;
                      }}
                      style={{
                        marginTop: 18,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: "rgba(239,68,68,0.24)",
                        backgroundColor: "rgba(255,255,255,0.03)",
                        padding: 12,
                        paddingBottom: 16,
                      }}
                    >
                      <Text style={{ color: GOLD, fontSize: 13, fontWeight: "900", letterSpacing: 0.8 }}>
                        END STEP
                      </Text>

                      <Text
                        style={{
                          color: TEXT,
                          fontSize: 20,
                          fontWeight: "900",
                          marginTop: 2,
                        }}
                      >
                        {isMediaSchedule ? "Choose live end time" : "Choose meeting end time"}
                      </Text>

                      <View style={{ gap: 8, marginTop: 4 }}>
                        <View
                          style={{
                            borderRadius: 13,
                            borderWidth: 1,
                            borderColor: "rgba(239,68,68,0.20)",
                            backgroundColor: "rgba(255,255,255,0.022)",
                            padding: 10,
                          }}
                        >
                          <Text style={{ color: GOLD, fontSize: 9, fontWeight: "800", marginBottom: 6 }}>
                            MEETING RANGE
                          </Text>
                          <Text
                            style={{
                              color: TEXT,
                              fontSize: 17,
                              fontWeight: "900",
                            }}
                          >
                            End: {meetingEndDay} {meetingEndMonth} {meetingEndYear}
                          </Text>
                          <Text style={{ color: "#fca5a5", fontSize: 13, fontWeight: "800", marginTop: 4 }}>
                            {meetingEndHour}
                          </Text>
                        </View>

                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            rowGap: 12,
                          }}
                        >
                          {[
                            {
                              label: "YEAR",
                              value: meetingEndYear,
                              options: ["2024","2025","2026","2027","2028","2029","2030","2024","2025","2026","2027","2028","2029","2030"],
                              setter: "year",
                            },
                            {
                              label: "MONTH",
                              value: meetingEndMonth,
                              options: [
                                "January","February","March","April","May","June","July","August","September","October","November","December",
                                "January","February","March","April","May","June","July","August","September","October","November","December",
                                "January","February","March","April","May","June","July","August","September","October","November","December"
                              ],
                              setter: "month",
                            },
                            {
                              label: "DATE",
                              value: meetingEndDay,
                              options: [
                                ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
                                ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
                              ],
                              setter: "day",
                            },
                            {
                              label: "HOUR",
                              value: meetingEndMinuteMode
                                ? ((meetingEndHour.split(":")[1] || "00").split(" ")[0])
                                : meetingEndHour,
                              options: meetingEndMinuteMode
                                ? meetingMinuteOptions
                                : [
                                    "12:00 AM","1:00 AM","2:00 AM","3:00 AM","4:00 AM","5:00 AM","6:00 AM","7:00 AM","8:00 AM","9:00 AM","10:00 AM","11:00 AM",
                                    "12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM","6:00 PM","7:00 PM","8:00 PM","9:00 PM","10:00 PM","11:00 PM",
                                    "12:00 AM","1:00 AM","2:00 AM","3:00 AM","4:00 AM","5:00 AM","6:00 AM","7:00 AM","8:00 AM","9:00 AM","10:00 AM","11:00 AM",
                                    "12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM","6:00 PM","7:00 PM","8:00 PM","9:00 PM","10:00 PM","11:00 PM",
                                    "12:00 AM","1:00 AM","2:00 AM","3:00 AM","4:00 AM","5:00 AM","6:00 AM","7:00 AM","8:00 AM","9:00 AM","10:00 AM","11:00 AM",
                                    "12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM","6:00 PM","7:00 PM","8:00 PM","9:00 PM","10:00 PM","11:00 PM"
                                  ],
                              setter: "hour",
                            },
                          ].map((card) => (
                            <View
                              key={card.label}
                              style={{
                                width: "48.2%",
                                borderRadius: 13,
                                borderWidth: 1,
                                borderColor: "rgba(255,255,255,0.075)",
                                backgroundColor: "rgba(255,255,255,0.020)",
                                padding: 10,
                              }}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <Text style={{ color: GOLD, fontSize: 9, fontWeight: "800" }}>
                                  {card.setter === "hour" ? "" : card.label}
                                </Text>

                                {card.setter === "hour" ? (
                                  <View
                                    style={{
height: 24,
                                      borderRadius: 999,
                                      padding: 2,
                                      flexDirection: "row",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      alignSelf: "flex-start",
                                      marginLeft: -8,
                                      backgroundColor: "rgba(255,255,255,0.028)",
                                      borderWidth: 1,
                                      borderColor: "rgba(255,255,255,0.07)",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <Pressable
                                      onPress={() => {
                                        setMeetingEndMinuteMode(false);
                                        setTimeout(() => {
                                          ensureHourLoopStart(meetingEndHourScrollRef, meetingEndHourLoopReadyRef);
                                        }, 0);
                                      }}
                                      style={({ pressed }) => [
                                        {
                                          flex: 1,
                                          height: "100%",
                                          borderRadius: 999,
                                          alignItems: "center",
                                          justifyContent: "center",
                                          borderWidth: !meetingEndMinuteMode ? 1 : 0,
                                          borderColor: "rgba(16,185,129,0.34)",
                                          backgroundColor: !meetingEndMinuteMode ? "rgba(16,185,129,0.15)" : "transparent",
                                        },
                                        pressed ? s.pressed : null,
                                      ]}
                                    >
                                      <Text
                                        style={{
                                          color: !meetingEndMinuteMode ? EMERALD : "rgba(255,255,255,0.64)",
                                          fontSize: 9,
                                          fontWeight: "700",
                                        }}
                                      >
                                        Hour
                                      </Text>
                                    </Pressable>

                                    <Pressable
                                      onPress={() => {
                                        setMeetingEndMinuteMode(true);
                                        setTimeout(() => {
                                          meetingEndHourScrollRef.current?.scrollTo({ y: 0, animated: false });
                                        }, 0);
                                      }}
                                      style={({ pressed }) => [
                                        {
                                          flex: 1,
                                          height: "100%",
                                          borderRadius: 999,
                                          alignItems: "center",
                                          justifyContent: "center",
                                          borderWidth: meetingEndMinuteMode ? 1 : 0,
                                          borderColor: "rgba(16,185,129,0.34)",
                                          backgroundColor: meetingEndMinuteMode ? "rgba(16,185,129,0.15)" : "transparent",
                                        },
                                        pressed ? s.pressed : null,
                                      ]}
                                    >
                                      <Text
                                        style={{
                                          color: meetingEndMinuteMode ? EMERALD : "rgba(255,255,255,0.64)",
                                          fontSize: 9,
                                          fontWeight: "700",
                                        }}
                                      >
                                        Minutes
                                      </Text>
                                    </Pressable>
                                  </View>
                                ) : null}
                              </View>

                              <View style={{ position: "relative" }}>
                                <ScrollView
                                  ref={card.setter === "hour" ? meetingEndHourScrollRef : undefined}
                                  nestedScrollEnabled
                                  showsVerticalScrollIndicator={false}
                                  style={{ maxHeight: 132 }}
                                  contentContainerStyle={{ gap: 6, paddingTop: 8, paddingBottom: 12 }}
                                  snapToInterval={HOUR_ITEM_HEIGHT}
                                  decelerationRate="fast"
                                  scrollEventThrottle={16}
                                  onContentSizeChange={() => {
                                    if (card.setter === "hour" && !meetingEndMinuteMode) {
                                      ensureHourLoopStart(meetingEndHourScrollRef, meetingEndHourLoopReadyRef);
                                    } else if (card.setter === "hour" && meetingEndMinuteMode) {
                                      meetingEndHourScrollRef.current?.scrollTo({ y: 0, animated: false });
                                    }
                                  }}
                                  onScroll={(e) => {
                                    if (card.setter === "hour" && !meetingEndMinuteMode) {
                                      handleHourLoopScroll(
                                        e.nativeEvent.contentOffset.y,
                                        meetingEndHourScrollRef,
                                        meetingEndHourLoopReadyRef
                                      );
                                    }
                                  }}
                                >
                                  {card.options.map((option, index) => {
                                    const active = card.value === option;
                                    const disabledEndRange = isMeetingEndCandidateInvalid(String(card.setter), String(option));
                                    return (
                                      <Pressable
                                        key={`${card.label}-${option}-${index}`}
                                        disabled={disabledEndRange}
                                        onPress={() => {
                                          if (disabledEndRange) return;
                                          if (card.setter === "year") {
                                            setMeetingEndYear(option);
                                        }
                                          if (card.setter === "month") {
                                            setMeetingEndMonth(option);
                                        }
                                          if (card.setter === "day") {
                                            setMeetingEndDay(option);
                                        }
                                          if (card.setter === "hour") {
                                          const nextHour = meetingEndMinuteMode
                                            ? setMeetingPickerMinute(meetingEndHour, option)
                                            : option;
                                          setMeetingEndHour(nextHour);
                                          if (meetingEndMinuteMode) setMeetingEndMinuteMode(false);

                                        }
                                        }}
                                        style={({ pressed }) => [
                                          {
                                            minHeight: 46,
                                            borderRadius: 13,
                                            borderWidth: 1,
                                            borderColor: disabledEndRange
                                              ? "rgba(255,255,255,0.045)"
                                              : active ? "rgba(16,185,129,0.48)" : "rgba(255,255,255,0.075)",
                                            backgroundColor: disabledEndRange
                                              ? "rgba(255,255,255,0.01)"
                                              : active ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.018)",
                                            paddingVertical: 7,
                                            paddingHorizontal: 10,
                                            
                                          },
                                          pressed ? s.pressed : null,
                                        ]}
                                      >
                                        <Text
                                          style={{
                                            color: disabledEndRange ? "rgba(255,255,255,0.16)" : active ? EMERALD : "rgba(255,255,255,0.42)",
                                            fontSize: active ? 16 : 13,
                                            fontWeight: active ? "900" : "700",
                                            opacity: disabledEndRange ? 0.34 : active ? 1 : 0.62,
                                          }}
                                        >
                                          {isMediaSchedule && option === "Guests"
                                          ? "🌍 Guests"
                                          : isMediaSchedule && option === "Members"
                                            ? "👥 Members"
                                            : isMediaSchedule && option === "Leaders"
                                              ? "🛡 Leaders"
                                              : isMediaSchedule && option === "Leaders & Admins"
                                                ? "👑 Leaders & Admins"
                                                : option}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </ScrollView>

                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {meetingStep === 4 ? (
                    <View
                      onLayout={(e) => {
                        meetingOptionsStepYRef.current = e.nativeEvent.layout.y;
                      }}
                      style={{
                        marginTop: 2,
                        borderRadius: 22,
                        borderWidth: 1,
                        borderColor: "rgba(217,179,95,0.18)",
                        backgroundColor: "rgba(217,179,95,0.06)",
                        padding: 16,
                      }}
                    >
                      <Text style={{ color: GOLD, fontSize: 13, fontWeight: "900", letterSpacing: 0.8 }}>
                        OPTIONS STEP
                      </Text>

                      <Text
                        style={{
                          color: TEXT,
                          fontSize: 20,
                          fontWeight: "900",
                          marginTop: 2,
                        }}
                      >
                        {isMediaSchedule ? "Live claim card options" : "Meeting program options"}
                      </Text>

                      <Text
                        style={{
                          color: SOFT,
                          fontSize: 13,
                          lineHeight: 22,
                          marginTop: 2,
                        }}
                      >
                        {isMediaSchedule
                          ? "Host chooses the live program and audience access for this church media schedule."
                          : "Select the parts to include in this meeting."}
                      </Text>

                      <View style={{ gap: 8, marginTop: 18 }}>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          bounces={false}
                          contentContainerStyle={{ gap: 8, paddingRight: 10 }}
                        >
                          {[
                            { key: "program" as const, label: "Program", locked: false, icon: "options-outline" as const },
                            { key: "audience" as const, label: "Audience", locked: false, icon: "people-outline" as const },
                            { key: "stage" as const, label: "Stage", locked: true, icon: "mic-outline" as const },
                            { key: "translation" as const, label: "Translation", locked: true, icon: "language-outline" as const },
                            { key: "media" as const, label: "Media", locked: true, icon: "videocam-outline" as const },
                            { key: "security" as const, label: "Security", locked: true, icon: "shield-checkmark-outline" as const },
                          ].map((tab) => {
                            const active = meetingOptionsTab === tab.key;
                            return (
                              <Pressable
                                key={tab.key}
                                onPress={() => {
                                  if (tab.locked) return;
                                  setMeetingOptionsTab(tab.key);
                                }}
                                style={({ pressed }) => [
                                  {
                                    minHeight: 40,
                                    borderRadius: 999,
                                    borderWidth: 1,
                                    borderColor: active
                                      ? "rgba(217,179,95,0.36)"
                                      : "rgba(255,255,255,0.10)",
                                    backgroundColor: active
                                      ? "rgba(217,179,95,0.12)"
                                      : "rgba(255,255,255,0.03)",
                                    paddingHorizontal: 12,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 8,
                                    opacity: tab.locked ? 0.86 : 1,
                                  },
                                  pressed ? s.pressed : null,
                                ]}
                              >
                                <Ionicons
                                  name={tab.locked ? "lock-closed-outline" : tab.icon}
                                  size={14}
                                  color={active ? GOLD : tab.locked ? SOFT : TEXT}
                                />
                                <Text
                                  style={{
                                    color: active ? GOLD : TEXT,
                                    fontSize: 13,
                                    fontWeight: "800",
                                  }}
                                >
                                  {tab.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </ScrollView>

                        {meetingOptionsTab === "program" ? (
                          <>
                            <View
                              style={{
                                borderRadius: 18,
                                borderWidth: 1,
                                borderColor: "rgba(255,255,255,0.10)",
                                backgroundColor: "rgba(255,255,255,0.025)",
                                padding: 12,
                              }}
                            >
                              <Text
                                style={{
                                  color: GOLD,
                                  fontSize: 12,
                                  fontWeight: "800",
                                  marginBottom: 8,
                                  letterSpacing: 0.7,
                                }}
                              >
                                PROGRAM
                              </Text>

                              <View style={{ gap: 8 }}>
                                {[
                                  {
                                    label: isMediaSchedule ? "Prayer Live" : "MC",
                                    value: needsMc,
                                    setter: () => setNeedsMc(!needsMc),
                                  },
                                  {
                                    label: isMediaSchedule ? "Marriage Help" : "Prayer",
                                    value: includeOpeningPrayer,
                                    setter: () => setIncludeOpeningPrayer(!includeOpeningPrayer),
                                  },
                                  {
                                    label: isMediaSchedule ? "Testimony" : "Guests",
                                    value: inviteGuests,
                                    setter: () => setInviteGuests(!inviteGuests),
                                  },
                                  {
                                    label: isMediaSchedule ? "Counseling" : "Choir",
                                    value: includeChoir,
                                    setter: () => setIncludeChoir(false),
                                  },
                                  {
                                    label: isMediaSchedule ? "Bible Q&A" : "Testimony",
                                    value: includeTestimony,
                                    setter: () => setIncludeTestimony(!includeTestimony),
                                  },
                                  {
                                    label: isMediaSchedule ? "Help Need" : "Offering",
                                    value: includeOffering,
                                    setter: () => setIncludeOffering(false),
                                  },
                                  {
                                    label: isMediaSchedule ? "Hope Word" : "Announcements",
                                    value: includeAnnouncements,
                                    setter: () => setIncludeAnnouncements(!includeAnnouncements),
                                  },
                                ].map((item) => (
                                  <View
                                    key={item.label}
                                    style={{
                                      borderRadius: 13,
                                      borderWidth: 1,
                                      borderColor: item.value ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                                      backgroundColor: item.value ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.025)",
                                      paddingHorizontal: 12,
                                      paddingVertical: 10,
                                    }}
                                  >
                                    <View
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                      }}
                                    >
                                      <View style={{ flex: 1 }}>
                                        <Text
                                          style={{
                                            color: TEXT,
                                            fontSize: 14,
                                            fontWeight: "900",
                                          }}
                                        >
                                          {item.label}
                                        </Text>
                                      </View>

                                      <View style={{ flexDirection: "row", gap: 8 }}>
                                        <Pressable
                                          onPress={() => {
                                            if (item.value) item.setter();
                                          }}
                                          style={({ pressed }) => [
                                            {
                                              minWidth: 58,
                                              borderRadius: 999,
                                              borderWidth: 1,
                                              borderColor: !item.value ? "rgba(148,163,184,0.35)" : "rgba(255,255,255,0.10)",
                                              backgroundColor: !item.value ? "rgba(148,163,184,0.14)" : "rgba(255,255,255,0.03)",
                                              paddingHorizontal: 12,
                                              paddingVertical: 8,
                                              alignItems: "center",
                                            },
                                            pressed ? s.pressed : null,
                                          ]}
                                        >
                                          <Text
                                            style={{
                                              color: !item.value ? SOFT : TEXT,
                                              fontSize: 12,
                                              fontWeight: "900",
                                            }}
                                          >
                                            Off
                                          </Text>
                                        </Pressable>

                                        <Pressable
                                          onPress={() => {
                                            if (!item.value) item.setter();
                                          }}
                                          style={({ pressed }) => [
                                            {
                                              minWidth: 58,
                                              borderRadius: 999,
                                              borderWidth: 1,
                                              borderColor: item.value ? "rgba(16,185,129,0.45)" : "rgba(255,255,255,0.10)",
                                              backgroundColor: item.value ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.03)",
                                              paddingHorizontal: 12,
                                              paddingVertical: 8,
                                              alignItems: "center",
                                            },
                                            pressed ? s.pressed : null,
                                          ]}
                                        >
                                          <Text
                                            style={{
                                              color: item.value ? EMERALD : TEXT,
                                              fontSize: 12,
                                              fontWeight: "900",
                                            }}
                                          >
                                            On
                                          </Text>
                                        </Pressable>
                                      </View>
                                    </View>
                                  </View>
                                ))}
                              </View>
                            </View>

                            <View
                              style={{
                                borderRadius: 20,
                                borderWidth: 1,
                                borderColor: "rgba(217,179,95,0.18)",
                                backgroundColor: "rgba(255,255,255,0.028)",
                                padding: 14,
                              }}
                            >
                              <Text style={{ color: GOLD, fontSize: 13, fontWeight: "900", marginBottom: 6, letterSpacing: 0.5 }}>
                                AUDIENCE
                              </Text>

                              <Text
                                style={{
                                  color: SOFT,
                                  fontSize: 13,
                                  lineHeight: 20,
                                  marginBottom: 10,
                                }}
                              >
                                {isMediaSchedule
                                  ? "Host creates the church media live schedule and chooses who can access this live."
                                  : "Choose who this meeting is mainly prepared for."}
                              </Text>

                              <View
                                style={{
                                  borderRadius: 13,
                                  borderWidth: 1,
                                  borderColor: "rgba(255,255,255,0.08)",
                                  backgroundColor: "rgba(255,255,255,0.02)",
                                  padding: 10,
                                }}
                              >
                                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                                  {(isMediaSchedule
                                    ? ["Guests", "Members", "Leaders", "Leaders & Admins"]
                                    : ["Members", "Leaders", "Pastors", "Media team", "Guests + members"]
                                  ).map((option) => {
                                    const active = meetingAudience === option;
                                    return (
                                      <Pressable
                                        key={option}
                                        onPress={() => setMeetingAudience(option)}
                                        style={({ pressed }) => [
                                          {
                                            borderRadius: 999,
                                            borderWidth: 1,
                                            borderColor: active
                                              ? "rgba(16,185,129,0.42)"
                                              : "rgba(255,255,255,0.10)",
                                            backgroundColor: active
                                              ? "rgba(16,185,129,0.14)"
                                              : "rgba(255,255,255,0.03)",
                                            paddingHorizontal: 12,
                                            paddingVertical: 8,
                                          },
                                          pressed ? s.pressed : null,
                                        ]}
                                      >
                                        <Text
                                          style={{
                                            color: active ? EMERALD : TEXT,
                                            fontSize: 13,
                                            fontWeight: active ? "900" : "700",
                                          }}
                                        >
                                          {isMediaSchedule && option === "Guests"
                                          ? "🌍 Guests"
                                          : isMediaSchedule && option === "Members"
                                            ? "👥 Members"
                                            : isMediaSchedule && option === "Leaders"
                                              ? "🛡 Leaders"
                                              : isMediaSchedule && option === "Leaders & Admins"
                                                ? "👑 Leaders & Admins"
                                                : option}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              </View>
                            </View>
                          </>
                        ) : (
                          <View
                            style={{
                              borderRadius: 18,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.10)",
                              backgroundColor: "rgba(255,255,255,0.025)",
                              padding: 14,
                            }}
                          >
                            <Text style={{ color: GOLD, fontSize: 13, fontWeight: "800", marginBottom: 8 }}>
                              LOCKED FOR V1
                            </Text>

                            <Text
                              style={{
                                color: TEXT,
                                fontSize: 17,
                                fontWeight: "900",
                              }}
                            >
                              More options are planned
                            </Text>

                            <Text
                              style={{
                                color: SOFT,
                                fontSize: 13,
                                lineHeight: 22,
                                marginTop: 6,
                              }}
                            >
                              This section is visible now so the structure is ready, but it will stay locked in V1 until the next phase.
                            </Text>

                            <View style={{ gap: 6, marginTop: 10 }}>
                              {[
                                "Extra stage roles",
                                "Interpreter routing",
                                "Media output setup",
                                "Security checkpoints",
                                "Protocol and VIP control",
                              ].map((item) => (
                                <View
                                  key={item}
                                  style={{
                                    borderRadius: 14,
                                    borderWidth: 1,
                                    borderColor: "rgba(255,255,255,0.10)",
                                    backgroundColor: "rgba(255,255,255,0.03)",
                                    paddingHorizontal: 12,
                                    paddingVertical: 9,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <Ionicons name="lock-closed-outline" size={14} color={SOFT} />
                                  <Text style={{ color: TEXT, fontSize: 13, fontWeight: "700" }}>
                                    {item}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                    </View>
                  ) : null}

                  {meetingStep === 5 ? (
                    <View
                      onLayout={(e) => {
                        meetingReviewStepYRef.current = e.nativeEvent.layout.y;
                      }}
                      style={{
                        marginTop: 2,
                        borderRadius: 24,
                        borderWidth: 1,
                        borderColor: "rgba(217,179,95,0.24)",
                        backgroundColor: "rgba(217,179,95,0.055)",
                        padding: 16,
                      }}
                    >
                      <Text style={{ color: GOLD, fontSize: 13, fontWeight: "900", letterSpacing: 0.8 }}>
                        REVIEW STEP
                      </Text>

                      <Text
                        style={{
                          color: TEXT,
                          fontSize: 22,
                          fontWeight: "900",
                          marginTop: 2,
                        }}
                      >
                        {isMediaSchedule ? "Final schedule review" : "Final meeting review"}
                      </Text>

                      {!reviewSubtitleHidden ? (
                        <Animated.Text
                          style={{
                            color: SOFT,
                            fontSize: 13,
                            lineHeight: 22,
                            marginTop: 4,
                            opacity: reviewSubtitleFade,
                          }}
                        >
                          {reviewSubtitleTyped}
                        </Animated.Text>
                      ) : null}

                      <View style={{ gap: 8, marginTop: 18 }}>
                        <View
                          style={{
                            borderRadius: 18,
                            borderWidth: 1,
                            borderColor: "rgba(217,179,95,0.32)",
                            backgroundColor: "rgba(255,255,255,0.03)",
                            padding: 14,
                          }}
                        >
                          <Text style={{ color: GOLD, fontSize: 12, fontWeight: "800", marginBottom: 6 }}>
                            MEETING SNAPSHOT
                          </Text>

                          <Text style={{ color: TEXT, fontSize: 15, fontWeight: "900" }}>
                            {meetingTitleChoice || "Missing meeting name"}
                          </Text>

                          <Text style={{ color: SOFT, fontSize: 12, fontWeight: "800", marginTop: 8, letterSpacing: 0.3 }}>
                            TOPIC
                          </Text>
                          <Text style={{ color: TEXT, fontSize: 16, fontWeight: "900", marginTop: 2 }}>
                            {meetingTopicChoice?.trim() || "Missing topic"}
                          </Text>

                          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                            <Text style={{ color: "rgb(16,185,129)", fontSize: 13, fontWeight: "800" }}>
                              Start: {meetingStartDay} {meetingStartMonth} • {meetingStartHour}
                            </Text>
                            <Text style={{ color: "#ef4444", fontSize: 13, fontWeight: "800" }}>
                              End: {meetingEndDay} {meetingEndMonth} • {meetingEndHour}
                            </Text>
                            {meetingEndTooFar ? (
                              <Text style={{ color: "#fca5a5", fontSize: 13, fontWeight: "800", marginTop: 6 }}>
                                End cannot pass 12 hours from start.
                              </Text>
                            ) : null}
                            {meetingEndBeforeStart ? (
                              <Text style={{ color: "#fca5a5", fontSize: 13, fontWeight: "800", marginTop: 6 }}>
                                End cannot be before start.
                              </Text>
                            ) : null}
                          </View>
                        </View>

                        <View
                          style={{
                            borderRadius: 18,
                            borderWidth: 1,
                            borderColor: "rgba(217,179,95,0.20)",
                            backgroundColor: "rgba(255,255,255,0.02)",
                            padding: 14,
                          }}
                        >
                          <Text style={{ color: GOLD, fontSize: 13, fontWeight: "800" }}>
                            {isMediaSchedule ? "MEDIA TOOLS PLAN" : "PARTICIPANTS PLAN"}
                          </Text>

                          <Text style={{ color: SOFT, fontSize: 13, marginTop: 5, lineHeight: 18 }}>
                            Select who will participate in each part of the meeting.
                          </Text>

                          <View style={{ marginTop: 10, gap: 10 }}>
                            {[
                              {
                                title: "Attendance",
                                detail:
                                  meetingAudience === "Members"
                                    ? "All members"
                                    : meetingAudience === "Leaders"
                                      ? "All leaders"
                                      : meetingAudience === "Pastors"
                                        ? "All pastors"
                                        : meetingAudience === "Media team"
                                          ? "Media team only"
                                          : meetingAudience === "Guests + members"
                                            ? "Guests and members"
                                            : meetingAudience || "Selected audience",
                              },
                              {
                                title: isMediaSchedule ? "Prayer Live" : "MC",
                                detail: needsMc ? "Pray live for people" : "Not included",
                              },
                              {
                                title: isMediaSchedule ? "Marriage Help" : "Prayer",
                                detail: includeOpeningPrayer
                                  ? isMediaSchedule
                                    ? "Marriage guidance"
                                    : "Select leader / pastor"
                                  : "Not included",
                              },
                              {
                                title: isMediaSchedule ? "Testimony" : "Guests",
                                detail: inviteGuests
                                  ? isMediaSchedule
                                    ? "Allow guest to join live"
                                    : "Select guests / protocol team"
                                  : "Not included",
                              },
                              {
                                title: isMediaSchedule ? "Counseling" : "Choir",
                                detail: includeChoir
                                  ? isMediaSchedule
                                    ? "Music bed enabled"
                                    : "Select choir group"
                                  : "Not included",
                              },
                              {
                                title: isMediaSchedule ? "Bible Q&A" : "Testimony",
                                detail: includeTestimony
                                  ? isMediaSchedule
                                    ? "Allow screen/media share"
                                    : "All members or selected"
                                  : "Not included",
                              },
                              {
                                title: isMediaSchedule ? "Help Need" : "Offering",
                                detail: includeOffering
                                  ? isMediaSchedule
                                    ? "Show donation CTA"
                                    : "Select treasury / ushers"
                                  : "Not included",
                              },
                              {
                                title: isMediaSchedule ? "Hope Word" : "Announcements",
                                detail: includeAnnouncements
                                  ? isMediaSchedule
                                    ? "Names and titles overlay"
                                    : "Select announcer / MC"
                                  : "Not included",
                              },
                            ].map((item) => (
                              <View
                                key={item.title}
                                style={{
                                  borderRadius: 14,
                                  borderWidth: 1,
                                  borderColor:
                                    item.detail === "Not included"
                                      ? "rgba(239,68,68,0.18)"
                                      : item.detail?.toLowerCase().startsWith("select")
                                        ? "rgba(16,185,129,0.18)"
                                        : "rgba(255,255,255,0.08)",
                                  backgroundColor:
                                    item.detail === "Not included"
                                      ? "rgba(239,68,68,0.05)"
                                      : item.detail?.toLowerCase().startsWith("select")
                                        ? "rgba(16,185,129,0.06)"
                                        : "rgba(255,255,255,0.03)",
                                  paddingHorizontal: 12,
                                  paddingVertical: 10,
                                  gap: 4,
                                }}
                              >
                                <Text style={{ color: TEXT, fontSize: 14, fontWeight: "900" }}>
                                  {item.title}
                                </Text>
                                <Text
                                  style={{
                                    color:
                                      item.detail === "Not included"
                                        ? "#ef4444"
                                        : item.detail?.toLowerCase().startsWith("select")
                                          ? "rgb(16,185,129)"
                                          : TEXT,
                                    fontSize: 13,
                                    lineHeight: 20,
                                    fontWeight: item.detail === "Not included" ? "700" : "800",
                                  }}
                                >
                                  • {item.detail}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>

                      </View>
                    </View>
                  ) : null}


{meetingParticipantDraft ? (
                    <Text style={{ color: EMERALD, fontSize: 12, fontWeight: "800", marginTop: 10 }}>
                      Selected edit target: {meetingParticipantDraft}
                    </Text>
                  ) : null}

<View style={[s.ctaRow, { marginTop: 12, marginBottom: 18, flexDirection: "row", gap: 6 }]}>
                    {meetingStep > 1 ? (
                      <Pressable
                        onPress={() => {
                          const prev = (meetingStep - 1) as 1 | 2 | 3 | 4 | 5 | 6;
                          setMeetingStep(prev);
                          setTimeout(() => {
                            scrollMeetingStepIntoView(prev);
                          }, 40);
                        }}
                        style={({ pressed }) => [
                          s.secondaryCta,
                          {
                            flex: 1,
                            minHeight: 52,
                            borderRadius: 18,
                          },
                          pressed ? s.pressed : null,
                        ]}
                      >
                        <Ionicons
                          name="chevron-back-outline"
                          size={16}
                          color={GOLD}
                        />
                        <Text style={s.secondaryCtaText}>
                          Back
                        </Text>
                      </Pressable>
                    ) : null}

                    <Pressable
                      onPress={() => {
                        if (meetingStep === 1 && !meetingCreateReady) return;

                        if (meetingStep === 1) {
                          setMeetingStep(2);
                          setTimeout(() => {
                            scrollMeetingStepIntoView(2);
                          }, 40);
                          return;
                        }

                        if (meetingStep === 2) {
                          const monthMap: Record<string, number> = {
                            January: 0,
                            February: 1,
                            March: 2,
                            April: 3,
                            May: 4,
                            June: 5,
                            July: 6,
                            August: 7,
                            September: 8,
                            October: 9,
                            November: 10,
                            December: 11,
                          };

                          const hourText = meetingStartHour.trim();
                          const [timePart, meridiemRaw] = hourText.split(" ");
                          const meridiem = (meridiemRaw || "AM").toUpperCase();
                          const [hourStr, minuteStr] = timePart.split(":");
                          let hourNum = Number(hourStr || 0);
                          const minuteNum = Number(minuteStr || 0);

                          if (meridiem === "PM" && hourNum < 12) hourNum += 12;
                          if (meridiem === "AM" && hourNum === 12) hourNum = 0;

                          const startedDate = new Date(
                            Number(meetingStartYear),
                            monthMap[meetingStartMonth] ?? 0,
                            Number(meetingStartDay),
                            hourNum,
                            minuteNum,
                            0,
                            0
                          );

                          setMeetingStarted(true);
                          setMeetingStartedAt(startedDate.toISOString());
                          setMeetingEndYear(meetingStartYear);
                          setMeetingEndMonth(meetingStartMonth);
                          setMeetingEndDay(meetingStartDay);
                          setMeetingEndHour(meetingStartHour);
                          setMeetingStep(3);
                          setTimeout(() => {
                            scrollMeetingStepIntoView(3);
                          }, 40);
                          return;
                        }

                        if (meetingStep === 4) {
                          setMeetingStep(5);
                          setTimeout(() => {
                            scrollMeetingStepIntoView(5);
                          }, 40);
                          return;
                        }

                        if (meetingStep === 5) {
                          handleSendMeetingToSchedule();
                          return;
                        }

                        const next = (meetingStep + 1) as 1 | 2 | 3 | 4 | 5 | 6;
                        setMeetingStep(next);
                        setTimeout(() => {
                          scrollMeetingStepIntoView(next);
                        }, 40);
                      }}
                      style={({ pressed }) => [
                        s.primaryCta,
                        {
                          flex: 1,
                          minHeight: 52,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor:
                            meetingStep === 1
                              ? meetingCreateReady
                                ? "rgba(16,185,129,0.48)"
                                : "rgba(239,68,68,0.48)"
                              : "rgba(217,179,95,0.24)",
                          backgroundColor:
                            meetingStep === 1
                              ? meetingCreateReady
                                ? "rgba(16,185,129,0.16)"
                                : "rgba(239,68,68,0.16)"
                              : "rgba(217,179,95,0.12)",
                        },
                        pressed ? s.pressed : null,
                      ]}
                    >
                      <Ionicons
                        name={meetingStep === 5 ? "paper-plane-outline" : "chevron-forward-outline"}
                        size={16}
                        color={meetingStep === 1 ? (meetingCreateReady ? EMERALD : "#ef4444") : TEXT}
                      />
                      <Text
                        style={[
                          s.primaryCtaText,
                          {
                            color: meetingStep === 1 ? (meetingCreateReady ? EMERALD : "#ef4444") : TEXT,
                          },
                        ]}
                      >
                        {meetingStep === 1
                          ? "Start"
                          : meetingStep === 2
                            ? "End"
                            : meetingStep === 3
                              ? "Next"
                              : meetingStep === 4
                                ? "Next"
                                : meetingStep === 5
                                  ? "Send to Schedule"
                                  : "Done"}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>

          </>
        ) : null}

        {isSchedule ? (
          <>
            <View style={[s.card, s.scheduleBoard]}>
              <View style={s.scheduleBoardHeader}>
                <View>
                  <Text style={s.cardLabel}>LIVE PRODUCTION</Text>
                  <Text style={s.cardTitle}>Running order board</Text>

                
              {scheduleSmartNotice ? (
                <Pressable
                  onPress={() => setScheduleSmartNotice(null)}
                  style={{
                    marginTop: 14,
                    marginBottom: 14,
                    borderRadius: 22,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: "rgba(244,208,111,0.28)",
                    backgroundColor: "rgba(18,24,36,0.96)",
                  }}
                >
                  <Text style={{ color: "#F4D06F", fontSize: 12, fontWeight: "900", letterSpacing: 2 }}>
                    SMART NOTICE
                  </Text>
                  <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 6 }}>
                    {scheduleSmartNotice.title}
                  </Text>
                  <Text style={{ color: "rgba(255,255,255,0.68)", fontSize: 14, fontWeight: "700", marginTop: 6, lineHeight: 20 }}>
                    {scheduleSmartNotice.body}
                  </Text>
                </Pressable>
              ) : null}
              </View>
              </View>

              <View style={[s.scheduleTimeline, { marginTop: 18 }]}>
                {visibleScheduleSlots.map((slot, index) => {
                  const isFirst = index === 0;
                  const isLast = index === scheduleSpeakerSlots.length - 1;
                  const roleLabel = isFirst ? "Opening" : isLast ? "Main" : "Support";
                  const roleStyle = isFirst
                    ? s.scheduleRoleOpening
                    : isLast
                      ? s.scheduleRoleMain
                      : s.scheduleRoleSupport;

                  const backendSlot = backendScheduleCards.find((x: any) => String(x.id || x.cardId) === String(slot.id));
                  const localVisibility = String((slot as any)?.visibility || "").trim();
                  const backendVisibility = String((backendSlot as any)?.visibility || "").trim();
                  const mergedVisibility = localVisibility || backendVisibility || "draft";

                  // Published backend is truth. Local stale claim must NOT override backend.
                  const localHasClaim = !!String((slot as any)?.claimedByName || (slot as any)?.claimedByUserId || "").trim();
                  const backendHasClaim = !!String((backendSlot as any)?.claimedByName || (backendSlot as any)?.claimedByUserId || "").trim();
                  const backendHasFreshClaim =
                    !!String(
                      (backendSlot as any)?.claimedByName ||
                      (backendSlot as any)?.claimedByUserId ||
                      ""
                    ).trim();

                  // IMPORTANT:
                  // Backend/feed claim is source of truth.
                  // Local draft slot must NEVER overwrite a fresh backend claimant.
                  const shouldPreferLocalSlot =
                    !backendHasFreshClaim &&
                    backendVisibility !== "published" &&
                    (localVisibility === "draft" || localHasClaim);

                  const liveSlot = backendSlot
                    ? (
                        shouldPreferLocalSlot
                          ? { ...backendSlot, ...slot }
                          : { ...slot, ...backendSlot }
                      )
                    : slot;

                  const slotPublished = mergedVisibility === "published";
                  const slotStatus = String((liveSlot as any)?.status || "").toLowerCase().trim();
                  const slotClaimed =
                    slotStatus === "taken" ||
                    slotStatus === "claimed" ||
                    !!String((liveSlot as any)?.claimedByName || (liveSlot as any)?.claimedByUserId || "").trim();
                  const slotClaimedName = String((liveSlot as any)?.claimedByName || "").trim();
                  const slotClaimedAvatar = String((liveSlot as any)?.claimedByAvatar || "").trim();

                  return (
                    <View key={slot.id} style={s.scheduleSlotRow}>
                      <View style={s.scheduleSlotCard}>
                        <View style={[s.scheduleNode, roleStyle, s.scheduleNodeFloating]}>
                          <Text style={s.scheduleNodeText}>{index + 1}</Text>
                        </View>

                        <View style={s.scheduleSlotTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.scheduleSlotKicker}>{roleLabel.toUpperCase()}</Text>
                            <Text style={s.scheduleSlotTitle} numberOfLines={2}>
                              {liveSlot.name}
                            </Text>
                          </View>

                          <View style={s.scheduleDurationBadge}>
                            <Text style={s.scheduleDurationText}>{liveSlot.minutes || (liveSlot as any).durationMin}m</Text>
                          </View>
                        </View>

                        <View style={s.scheduleTopicStrip}>
                          <Text style={s.scheduleTopicLabel}>TOPIC</Text>
                          <Text style={s.scheduleTopicValue} numberOfLines={2}>
                            {String((liveSlot as any).script || (liveSlot as any).task || liveSlot.name || "")}
                          </Text>
                        </View>

                        <View style={s.scheduleMinuteGrid}>
                          {[1, 3, 5, 10, 30].map((mins) => (
                            <Pressable
                              key={`${slot.id}-${mins}`}
                              onPress={() => setSelectedScheduleMinuteStep(mins)}
                              style={({ pressed }) => [
                                s.scheduleMinuteChip,
                                selectedScheduleMinuteStep === mins ? s.scheduleMinuteChipActive : null,
                                pressed ? s.pressed : null,
                              ]}
                            >
                              <Text
                                style={[
                                  s.scheduleMinuteText,
                                  selectedScheduleMinuteStep === mins ? s.scheduleMinuteTextActive : null,
                                ]}
                              >
                                {mins}m
                              </Text>
                            </Pressable>
                          ))}
                        </View>

                        <View style={s.scheduleAdjustRow}>
                          <Pressable
                            disabled={slotPublished}
                            onPress={() => adjustSlotMinutes(slot.id, -1)}
                            style={({ pressed }) => [
                              s.scheduleAdjustBtn,
                              s.scheduleAdjustMinus,
                              slotPublished ? { opacity: 0.28 } : null,
                              pressed && !slotPublished ? s.pressed : null,
                            ]}
                          >
                            <Text style={s.scheduleAdjustText}>− {selectedScheduleMinuteStep}m</Text>
                          </Pressable>

                          <Pressable
                            disabled={slotPublished}
                            onPress={() => adjustSlotMinutes(slot.id, 1)}
                            style={({ pressed }) => [
                              s.scheduleAdjustBtn,
                              s.scheduleAdjustPlus,
                              slotPublished ? { opacity: 0.28 } : null,
                              pressed && !slotPublished ? s.pressed : null,
                            ]}
                          >
                            <Text style={s.scheduleAdjustText}>+ {selectedScheduleMinuteStep}m</Text>
                          </Pressable>
                        </View>

                        <View style={s.scheduleSlotMetaPanel}>
                          {[
                            ["Time", String((liveSlot as any).timeLabel || ((liveSlot as any).startTime && (liveSlot as any).endTime ? `${(liveSlot as any).startTime} - ${(liveSlot as any).endTime}` : "Set after meeting"))],
                            ["Date", String((liveSlot as any).meetingDate || meetingDay || "Today").split("T")[0]],
                          ].map(([label, value]) => (
                            <View key={`${slot.id}-${label}`} style={s.scheduleSlotMetaRow}>
                              <Text style={s.scheduleSlotMetaLabel}>{label}</Text>
                              <Text style={s.scheduleSlotMetaValue} numberOfLines={1}>{value}</Text>
                            </View>
                          ))}

                          <View style={[s.scheduleActionGrid, { marginBottom: 10 }]}>
                            <Pressable
                              onLongPress={() => {
                              if (!scheduleSelectionMode) {
                                setScheduleSelectionMode(true);
                              }

                              toggleScheduleSlotSelection(String(slot.id));
                            }}

                            onPress={() => {
                              if (scheduleSelectionMode) {
                                toggleScheduleSlotSelection(String(slot.id));
                                return;
                              }

                              openAssignSlot(liveSlot);
                            }}
                              style={({ pressed }) => [
                                s.scheduleActionBtn,
                                slotClaimed ? s.scheduleActionPublish : null,
                                pressed ? s.pressed : null,
                              ]}
                            >
                              {slotClaimedAvatar ? (
                                <Image source={{ uri: slotClaimedAvatar }} style={{ width: 22, height: 22, borderRadius: 11 }} />
                              ) : (
                                <Ionicons name={slotClaimed ? "person-circle-outline" : "person-add-outline"} size={18} color={slotClaimed ? "#86efac" : GOLD} />
                              )}
                              <Text style={s.scheduleActionText} numberOfLines={1}>
                                {slotClaimed ? getFirstDisplayName(slotClaimedName) || "Claimed" : "Assign"}
                              </Text>
                            </Pressable>

                            <Pressable
                              disabled={slotPublished}
                              onPress={() => publishScheduleSlot(liveSlot)}
                              style={({ pressed }) => [
                                s.scheduleActionBtn,
                                slotPublished ? s.scheduleActionMuted : s.scheduleActionPublish,
                                pressed && !slotPublished ? s.pressed : null,
                              ]}
                            >
                              <Ionicons name="rocket-outline" size={16} color={EMERALD} />
                              <Text style={s.scheduleActionText}>Publish</Text>
                            </Pressable>

                            <Pressable
                              disabled={!slotClaimed}
                              onPress={() => removeAssignedSlot(String(liveSlot.id || slot.id))}
                              style={({ pressed }) => [
                                s.scheduleActionBtn,
                                slotClaimed ? null : s.scheduleActionMuted,
                                pressed && slotClaimed ? s.pressed : null,
                              ]}
                            >
                              <Ionicons name="close-circle-outline" size={16} color={slotClaimed ? TEXT : "rgba(255,255,255,0.28)"} />
                              <Text style={s.scheduleActionText}>Unclaim</Text>
                            </Pressable>

                            <Pressable
                              disabled={!slotPublished}
                              onPress={() => lockScheduleSlot(liveSlot)}
                              style={({ pressed }) => [
                                s.scheduleActionBtn,
                                slotPublished ? s.scheduleActionDelete : s.scheduleActionMuted,
                                pressed && slotPublished ? s.pressed : null,
                              ]}
                            >
                              <Ionicons name="lock-closed-outline" size={16} color={"#FCA5A5"} />
                              <Text style={s.scheduleActionText}>Lock</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        ) : null}


        
        <Modal
          visible={assignModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAssignModalVisible(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.72)",
              justifyContent: "flex-end",
              padding: 14,
            }}
          >
            <View
              style={{
                backgroundColor: "#111827",
                borderRadius: 28,
                padding: 18,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
                maxHeight: "72%",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: TEXT,
                      fontSize: 34,
                      lineHeight: 40,
                      fontWeight: "900",
                      letterSpacing: -1,
                      marginBottom: 6,
                    }}
                    numberOfLines={1}
                  >
                    {assignmentTitle || "Ministry"}
                  </Text>
                  <Text
                    style={{
                      color: GOLD,
                      fontSize: 13,
                      fontWeight: "900",
                      letterSpacing: 2.2,
                      textTransform: "uppercase",
                    }}
                    numberOfLines={1}
                  >
                    Choose member
                  </Text>
                </View>

                <Pressable
                  onPress={() => setAssignModalVisible(false)}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="close-outline" size={24} color={TEXT} />
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {assignLoading ? (
                  <Text style={{ color: SOFT, paddingVertical: 18 }}>Loading ministry members...</Text>
                ) : assignMembers.length ? (
                  assignMembers.map((member: any, idx: number) => {
                    const memberName = String(
                      member?.displayName ||
                      member?.name ||
                      member?.fullName ||
                      member?.displayName ||
                      member?.profileName ||
                      "Member"
                    ).trim();

                    const rawAvatar = String(member?.avatarUrl || member?.avatar || "").trim();
                    const avatar = rawAvatar.startsWith("/")
                      ? `${String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/+$/, "")}${rawAvatar}`
                      : rawAvatar;
                    const roleText = String(member?.roleLabel || member?.role || member?.position || "Member").trim();

                    return (
                      <Pressable
                        key={String(member?.id || `${member?.userId || "member"}_${idx}`)}
                        onPress={() => assignSlotToKristoId(member)}
                        style={({ pressed }) => [
                          {
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            padding: 14,
                            marginBottom: 10,
                            borderRadius: 20,
                            backgroundColor: "rgba(255,255,255,0.045)",
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.08)",
                          },
                          pressed ? s.pressed : null,
                        ]}
                      >
                        {avatar ? (
                          <Image
                            source={{ uri: avatar }}
                            style={{ width: 46, height: 46, borderRadius: 23 }}
                          />
                        ) : (
                          <View
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 23,
                              backgroundColor: "rgba(217,179,95,0.14)",
                              alignItems: "center",
                              justifyContent: "center",
                              borderWidth: 1,
                              borderColor: "rgba(217,179,95,0.32)",
                            }}
                          >
                            <Ionicons name="person-outline" size={22} color={GOLD} />
                          </View>
                        )}

                        <View style={{ flex: 1 }}>
                          <Text style={{ color: TEXT, fontSize: 16, fontWeight: "900" }} numberOfLines={1}>
                            {memberName}
                          </Text>
                          <Text style={{ color: SOFT, marginTop: 2, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
                            {roleText}
                          </Text>
                        </View>

                        <Ionicons name="chevron-forward-outline" size={18} color={SOFT} />
                      </Pressable>
                    );
                  })
                ) : (
                  <View style={{ paddingVertical: 18 }}>
                    <Text style={{ color: TEXT, fontSize: 16, fontWeight: "900" }}>
                      No church members found
                    </Text>
                    <Text style={{ color: SOFT, marginTop: 6 }}>
                      Add members to this church first, then assign them here.
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>



{election ? (
          <>
            <View style={s.card}>
              <Text style={s.cardLabel}>CREATE ELECTION</Text>
              <Text style={s.cardTitle}>Choose vote type</Text>
              <Text style={s.cardSub}>
                Vote ya kwanza kwa kila kundi inaweza kuwa uchaguzi wa MC wanaohudumia kundi. Pastor/Admin/Leader wanaweza kuanzisha flow hii kabla MC wa kwanza hajachaguliwa.
              </Text>

              <View style={s.choiceGrid}>
                {[
                  { key: "mc", label: "MC vote" },
                  { key: "branch_leader", label: "Branch leader" },
                  { key: "department", label: "Department" },
                  { key: "internal", label: "Internal appointment" },
                ].map((item) => (
                  <Pressable
                    key={item.key}
                    disabled={!accessAllowed}
                    onPress={() => setSelectedVoteType(item.key as "mc" | "branch_leader" | "department" | "internal")}
                    style={({ pressed }) => [
                      s.choiceCard,
                      selectedVoteType === item.key ? s.choiceCardActive : null,
                      !accessAllowed ? s.choiceCardDisabled : null,
                      pressed ? s.pressed : null,
                    ]}
                  >
                    <Text style={[s.choiceTitle, selectedVoteType === item.key ? s.choiceTitleActive : null]}>
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.cardLabel}>DURATION</Text>
              <Text style={s.cardTitle}>How many days?</Text>
              <Text style={s.cardSub}>
                Ukichagua siku, app inahesabu moja kwa moja idadi ya masaa yatakayotumika kwa vote hii.
              </Text>

              <View style={s.dayRow}>
                {[1, 3, 7, 14].map((day) => (
                  <Pressable
                    key={day}
                    disabled={!accessAllowed}
                    onPress={() => setDurationDays(day)}
                    style={({ pressed }) => [
                      s.dayChip,
                      durationDays === day ? s.dayChipActive : null,
                      !accessAllowed ? s.choiceCardDisabled : null,
                      pressed ? s.pressed : null,
                    ]}
                  >
                    <Text style={[s.dayChipText, durationDays === day ? s.dayChipTextActive : null]}>
                      {day}d
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={s.calcCard}>
                <Text style={s.calcLabel}>SYSTEM TIME</Text>
                <Text style={s.calcValue}>{durationDays} days = {totalHours} hours</Text>
                <Text style={s.calcSub}>
                  Wagombea watapokea taarifa, kujichagua, na vote itaendelea ndani ya muda huu mpaka window ifungwe.
                </Text>
              </View>
            </View>

            <View style={s.summaryGrid}>
              {electionSummaryItems.map((item) => (
                <View key={item.label} style={s.summaryCard}>
                  <Text style={s.summaryLabel}>{item.label}</Text>
                  <Text style={s.summaryValue} numberOfLines={1}>{item.value}</Text>
                </View>
              ))}
            </View>

            <View style={s.card}>
              <Text style={s.cardLabel}>MC DELIVERY</Text>
              <Text style={s.cardTitle}>After create, send to MC</Text>
              <Text style={s.cardSub}>
                Ukimaliza create election, unasend kwa MC. Kuanzia hapo MC na timu ya live wanakuwa na kazi ya kutangaza, ku-manage flow, na kufanya edits siku ya announcement.
              </Text>

              <View style={s.chatPreviewCard}>
                <Text style={s.chatPreviewTitle}>Candidate notification</Text>
                <Text style={s.chatPreviewSub}>
                  Wagombea watapata habari ya vote ndani ya room na ndani ya masaa ya siku ulizochagua wataweza kujichagua.
                </Text>
              </View>

              <View style={s.chatPreviewCard}>
                <Text style={s.chatPreviewTitle}>MC responsibility</Text>
                <Text style={s.chatPreviewSub}>
                  Baada ya nomination kuanza, kazi kubwa inabaki kwa MC na watu wanaotumika kwenye live ma-edit mpaka siku ya announcement.
                </Text>
              </View>
            </View>

            <View style={s.flowStack}>
              {electionFlowCards.map((item) => (
                <View key={item.label} style={s.flowCard}>
                  <View style={s.flowIconWrap}>
                    <Ionicons name={item.icon} size={18} color={GOLD} />
                  </View>
                  <View style={s.flowTextWrap}>
                    <Text style={s.flowLabel}>{item.label}</Text>
                    <Text style={s.flowTitle}>{item.title}</Text>
                    <Text style={s.flowSub}>{item.sub}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={s.ctaRow}>
              <Pressable
                onPress={handleCreateElection}
                disabled={!accessAllowed}
                style={({ pressed }) => [
                  s.primaryCta,
                  !accessAllowed ? s.choiceCardDisabled : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color={TEXT} />
                <Text style={s.primaryCtaText}>Create election</Text>
              </Pressable>

              <Pressable
                onPress={handleSendToMc}
                disabled={!accessAllowed || !draftCreated}
                style={({ pressed }) => [
                  s.secondaryCta,
                  !accessAllowed || !draftCreated ? s.choiceCardDisabled : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <Ionicons name="paper-plane-outline" size={18} color={GOLD} />
                <Text style={s.secondaryCtaText}>Send to MC</Text>
              </Pressable>
            </View>

            <View style={s.note}>
              <Text style={s.noteTitle}>Election state</Text>
              <Text style={s.noteText}>
                {!accessAllowed
                  ? "Election ya kwanza ya MC inaruhusiwa kwa Pastor/Admin/Leader ili MC achaguliwe kwanza."
                  : sentToMc
                    ? "Election imetengenezwa na imetumwa kwa MC. Sasa flow ya wagombea na live edits inaweza kuendelea."
                    : draftCreated
                      ? "Election draft iko tayari. Hatua inayofuata ni kuituma kwa MC."
                      : "Anza kwa kuchagua vote type, duration, kisha bonyeza Create election."}
              </Text>

              <Pressable
                onPress={() =>
                  router.push(
                    `/kingdom/church-project-election/${assignmentId}/mc?title=${encodeURIComponent(
                      assignmentTitle
                    )}&subtitle=${encodeURIComponent(assignmentSubtitle)}` as any
                  )
                }
                disabled={!sentToMc}
                style={({ pressed }) => [
                  s.secondaryCta,
                  !sentToMc ? s.choiceCardDisabled : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <Ionicons name="videocam-outline" size={18} color={GOLD} />
                <Text style={s.secondaryCtaText}>Open MC panel</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {!isMeeting && !isSchedule ? (
          <View style={s.card}>
            <Text style={s.cardLabel}>ASSIGNMENT</Text>
            <Text style={s.cardTitle}>{assignmentTitle}</Text>
            <Text style={s.cardSub}>{assignmentSubtitle}</Text>
          </View>
        ) : null}

        {!isMeeting && !isSchedule ? (
          <View style={s.card}>
            <Text style={s.cardLabel}>THIS TOOL HANDLES</Text>
            {meta.bullets.map((item) => (
              <View key={item} style={s.bulletRow}>
                <View style={s.dot} />
                <Text style={s.bulletText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {!election && !isMeeting && !isSchedule ? (
          <View style={s.actionGrid}>
            <View style={s.actionCard}>
              <View style={s.actionIconWrap}>
                <Ionicons name="flash-outline" size={18} color={GOLD} />
              </View>
              <Text style={s.actionLabel}>PRIMARY ACTION</Text>
              <Text style={s.actionTitle}>{meta.primaryAction}</Text>
              <Text style={s.actionSub}>
                {accessAllowed
                  ? "Tool hii iko tayari kuunganishwa na action halisi ya role yako."
                  : "Unaweza kuona direction ya tool hii, lakini action ya ndani inahitaji ruhusa zaidi."}
              </Text>
            </View>

            <View style={s.actionCard}>
              <View style={s.actionIconWrap}>
                <Ionicons name="layers-outline" size={18} color={GOLD} />
              </View>
              <Text style={s.actionLabel}>SECONDARY ACTION</Text>
              <Text style={s.actionTitle}>{meta.secondaryAction}</Text>
              <Text style={s.actionSub}>
                Hii sehemu itakuwa ya preview, summary, na control flow ya ndani ya tool hii.
              </Text>
            </View>
          </View>
        ) : null}

        {!isMeeting && !isSchedule ? (
          <View style={s.note}>
            <Text style={s.noteTitle}>Next build step</Text>
            <Text style={s.noteText}>
              {election
                ? "Hatua inayofuata ni kuunganisha create election, candidate self-nomination, vote flow, na result reveal cards ndani ya chat."
                : "Screen hii sasa ina role state na access state. Hatua inayofuata ni kuunganisha data halisi na buttons za kweli kwa tool hii."}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
    backgroundColor: "rgba(11,15,23,0.92)",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    marginRight: 12,
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  topText: {
    flex: 0.72,
    minWidth: 0,
    justifyContent: "center",
    paddingTop: 1,
  },
  topTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22,
  },
  topSub: {
    color: SOFT,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 15,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
    paddingBottom: 44,
  },
  hero: {
    borderWidth: 1,
    borderRadius: 28,
    padding: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  heroBlue: {
    backgroundColor: "rgba(110,168,255,0.08)",
    borderColor: "rgba(110,168,255,0.22)",
  },
  heroEmerald: {
    backgroundColor: "rgba(52,211,153,0.08)",
    borderColor: "rgba(52,211,153,0.20)",
  },
  heroPurple: {
    backgroundColor: "rgba(183,132,255,0.08)",
    borderColor: "rgba(183,132,255,0.20)",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  accessPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  accessPillText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "800",
  },
  pillAccessOn: {
    backgroundColor: "rgba(52,211,153,0.12)",
    borderColor: "rgba(52,211,153,0.28)",
  },
  pillAccessOff: {
    backgroundColor: "rgba(255,125,132,0.10)",
    borderColor: "rgba(255,125,132,0.22)",
  },
  heroKicker: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  heroTitle: {
    color: TEXT,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29,
  },
  heroSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 34,
    justifyContent: "center",
  },
  pillBlue: {
    backgroundColor: "rgba(110,168,255,0.12)",
    borderColor: "rgba(110,168,255,0.28)",
  },
  pillEmerald: {
    backgroundColor: "rgba(52,211,153,0.12)",
    borderColor: "rgba(52,211,153,0.28)",
  },
  pillPurple: {
    backgroundColor: "rgba(183,132,255,0.12)",
    borderColor: "rgba(183,132,255,0.28)",
  },
  pillText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
  },
  accessCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    gap: 8,
  },
  accessCardOn: {
    backgroundColor: "rgba(52,211,153,0.06)",
    borderColor: "rgba(52,211,153,0.18)",
  },
  accessCardOff: {
    backgroundColor: "rgba(255,125,132,0.06)",
    borderColor: "rgba(255,125,132,0.16)",
  },
  accessIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  accessTextWrap: {
    flex: 1,
  },
  accessTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  accessSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  summaryCard: {
    width: "48.5%",
    minHeight: 84,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: "center",
  },
  summaryLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  summaryValue: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 24,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  cardLabel: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  cardTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 23,
  },
  cardSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: GOLD,
    marginRight: 12,
  },
  bulletText: {
    color: TEXT,
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  actionCard: {
    width: "48.5%",
    minHeight: 188,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 24,
    padding: 16,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  actionLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  actionTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
  },
  actionSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
  },
  note: {
    backgroundColor: "rgba(110,168,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(110,168,255,0.18)",
    borderRadius: 24,
    padding: 16,
  },
  noteTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  noteText: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 20,
  },
  phaseStack: {
    gap: 8,
  },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  phaseDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 12,
  },
  phaseDotOn: {
    backgroundColor: EMERALD,
  },
  phaseDotOff: {
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  phaseText: {
    flex: 1,
    color: TEXT,
    fontSize: 13,
  },
  phaseValue: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "700",
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    paddingHorizontal: 12,
                                  paddingVertical: 6,
  },
  personAvatar: {
    width: 42,
    height: 36,
    borderRadius: 21,
    alignItems: "center",
    
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    marginRight: 12,
  },
  personAvatarText: {
    color: GOLD,
    fontSize: 17,
    fontWeight: "800",
  },
  personMain: {
    flex: 1,
    minWidth: 0,
  },
  personName: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  personSub: {
    color: SOFTER,
    fontSize: 12,
  },
  personVotesPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(110,168,255,0.18)",
    backgroundColor: "rgba(110,168,255,0.08)",
  },
  personVotesText: {
    color: BLUE,
    fontSize: 12,
    fontWeight: "700",
  },
  finalistsGrid: {
    gap: 2,
  },
  finalistCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 14,
  },
  finalistWinnerCard: {
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },
  finalistPlace: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  finalistName: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "800",
  },
  finalistSub: {
    color: SOFT,
    fontSize: 13,
  },
  chatCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 14,
  },
  chatCardBlue: {
    backgroundColor: "rgba(110,168,255,0.08)",
    borderColor: "rgba(110,168,255,0.20)",
  },
  chatCardEmerald: {
    backgroundColor: "rgba(52,211,153,0.08)",
    borderColor: "rgba(52,211,153,0.20)",
  },
  chatCardPurple: {
    backgroundColor: "rgba(183,132,255,0.08)",
    borderColor: "rgba(183,132,255,0.20)",
  },
  chatCardTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  chatCardSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
  },
  emptySoft: {
    color: SOFTER,
    fontSize: 13,
  },
  chatPreviewCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 14,
  },
  chatPreviewTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  chatPreviewSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
  },
  flowStack: {
    gap: 8,
  },
  flowCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  flowIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  flowTextWrap: {
    flex: 1,
  },
  flowLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  flowTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  flowSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
  },

  liveBtn: {
    minHeight: 50,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    backgroundColor: "rgba(217,179,95,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  liveBtnDisabled: {
    opacity: 0.45,
  },
  liveBtnText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },
  electionStateText: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 20,
  },
  revealStageCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 14,
  },
  revealStageTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  revealStageSub: {
    color: SOFT,
    fontSize: 13,
  },
  choiceGrid: {
    gap: 2,
  },
  choiceCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  choiceCardActive: {
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  choiceCardDisabled: {
    opacity: 0.45,
  },
  choiceTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  choiceTitleActive: {
    color: GOLD,
  },
  scheduleBoard: {
    backgroundColor: "rgba(14,18,30,0.94)",
    borderColor: "rgba(217,179,95,0.16)",
  },
  scheduleBoardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  scheduleTotalPill: {
    minWidth: 72,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  scheduleTotalValue: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  scheduleTotalLabel: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  scheduleTimeline: {
    gap: 0,
  },
  scheduleSlotRow: {
    marginBottom: 34,
  },
  scheduleLineCol: {
    width: 34,
    alignItems: "center",
  },
  scheduleNode: {
    width: 28,
    height: 34,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
    backgroundColor: "rgba(217,179,95,0.16)",
    zIndex: 2,
  },
  scheduleNodeText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  scheduleNodeFloating: {
    position: "absolute",
    top: 6,
    left: 18,
    width: 34,
    height: 34,
    borderRadius: 17,
    zIndex: 5,
  },
  scheduleLine: {
    flex: 1,
    width: 1,
    backgroundColor: "rgba(217,179,95,0.18)",
    marginVertical: 4,
  },
  scheduleRoleOpening: {
    backgroundColor: "rgba(52,211,153,0.16)",
    borderColor: "rgba(52,211,153,0.38)",
  },
  scheduleRoleMain: {
    backgroundColor: "rgba(183,132,255,0.18)",
    borderColor: "rgba(183,132,255,0.42)",
  },
  scheduleRoleSupport: {
    backgroundColor: "rgba(110,168,255,0.14)",
    borderColor: "rgba(110,168,255,0.34)",
  },
  scheduleSlotCard: {
    flex: 0,
    position: "relative",
    width: "100%",
    borderRadius: 34,
    padding: 22,
    backgroundColor: "rgba(4,10,28,0.94)",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 20,
    overflow: "hidden",
  },
  scheduleSlotTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingLeft: 54,
    marginTop: -8,
  },
  scheduleSlotKicker: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  scheduleSlotTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
  },
  scheduleDurationBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  scheduleDurationText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },
  scheduleMinuteGrid: {
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 12,
  },
  scheduleMinuteChip: {
    width: 48,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  scheduleMinuteChipActive: {
    borderColor: "rgba(255,215,90,0.72)",
    backgroundColor: "rgba(255,215,90,0.22)",
    shadowColor: "#FFD54A",
    shadowOpacity: 0.40,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
    transform: [{ scale: 1.04 }],
  },
  scheduleMinuteText: {
    color: SOFT,
    fontSize: 13,
    fontWeight: "900",
  },
  scheduleMinuteTextActive: {
    color: GOLD,
  },

  scheduleTopicStrip: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(125,211,252,0.08)",
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.20)",
    marginBottom: 18,
  },
  scheduleTopicLabel: {
    color: "rgba(125,211,252,0.95)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  scheduleTopicValue: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
  },
  scheduleAdjustRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
  },
  scheduleAdjustBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  scheduleAdjustMinus: {
    backgroundColor: "rgba(127,29,29,0.22)",
    borderColor: "rgba(248,113,113,0.34)",
  },
  scheduleAdjustPlus: {
    backgroundColor: "rgba(88,28,135,0.24)",
    borderColor: "rgba(192,132,252,0.38)",
  },
  scheduleAdjustText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  scheduleSlotMetaPanel: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.20)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.075)",
    gap: 8,
  },
  scheduleSlotMetaRow: {
    minHeight: 32,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.035)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  scheduleSlotMetaLabel: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  scheduleSlotMetaValue: {
    flex: 1,
    color: TEXT,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
  },
  scheduleActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
    marginTop: 12,
  },
  scheduleActionBtn: {
    width: "48%",
    minHeight: 58,
    borderRadius: 22,
    borderWidth: 1.4,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  scheduleActionPublish: {
    backgroundColor: "rgba(16,185,129,0.14)",
    borderColor: "rgba(16,185,129,0.38)",
    shadowColor: "#10B981",
    shadowOpacity: 0.30,
  },
  scheduleActionDanger: {
    borderColor: "rgba(248,113,113,0.32)",
    backgroundColor: "rgba(127,29,29,0.24)",
  },
  scheduleActionText: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.1,
  },
  scheduleActionOff: {
    opacity: 0.24,
    backgroundColor: "rgba(255,255,255,0.015)",
    borderColor: "rgba(255,255,255,0.035)",
    shadowOpacity: 0,
    elevation: 0,
  },
  scheduleActionMuted: {
    backgroundColor: "rgba(255,255,255,0.018)",
    borderColor: "rgba(255,255,255,0.045)",
    opacity: 0.28,
    shadowOpacity: 0,
    elevation: 0,
  },
  scheduleActionDelete: {
    backgroundColor: "rgba(239,68,68,0.16)",
    borderColor: "rgba(239,68,68,0.36)",
    shadowColor: "#EF4444",
    shadowOpacity: 0.30,
  },
  mcDispatchCard: {
    backgroundColor: "rgba(20,14,32,0.92)",
    borderColor: "rgba(183,132,255,0.20)",
  },
  mcDispatchTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  mcDispatchIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
  },
  mcStatusBar: {
    borderRadius: 18,
    padding: 13,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  mcStatusLabel: {
    color: PURPLE,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  mcStatusValue: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },
  mcDispatchButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(183,132,255,0.38)",
    backgroundColor: "rgba(183,132,255,0.18)",
    paddingHorizontal: 14,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  dayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
  },
  dayChip: {
    minWidth: 62,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    
  },
  dayChipActive: {
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  dayChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  dayChipTextActive: {
    color: GOLD,
  },
  calcCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(110,168,255,0.18)",
    backgroundColor: "rgba(110,168,255,0.08)",
    padding: 14,
  },
  calcLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  calcValue: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "800",
  },
  calcSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
  },
  ctaRow: {
    gap: 8,
  },
  primaryCta: {
    minHeight: 58,
    borderRadius: 24,
    borderWidth: 1.4,
    borderColor: "rgba(217,179,95,0.24)",
    backgroundColor: "rgba(255,255,255,0.055)",
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  primaryCtaText: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  secondaryCta: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.035)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryCtaText: {
    color: SOFT,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  progressSub: {
    color: SOFT,
    fontSize: 12,
    lineHeight: 18,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  runtimeMiniCard: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(110,168,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(110,168,255,0.16)",
  },
  runtimeMiniTitle: {
    color: BLUE,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  runtimeMiniSub: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  peopleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  personCard: {
    width: "47%",
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  personRole: {
    color: SOFT,
    fontSize: 12,
    lineHeight: 18,
  },

});
