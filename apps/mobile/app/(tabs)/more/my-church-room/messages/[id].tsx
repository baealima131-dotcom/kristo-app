import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Easing,
  Animated,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Image,
  ImageStyle,
  PanResponder,

  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import Slider from "@react-native-community/slider";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import {
  getCachedParticipant,
  markThreadReadOnce,
  messagesListSignature,
  paginateMessages,
  preloadLiveImages,
  setCachedParticipant,
  startAdaptiveLivePolling,
} from "@/src/lib/liveRealtime";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import * as DocumentPicker from "expo-document-picker";
import { ensureThread, sendMessage, setThreadMessages, deleteMessage, claimAssignmentCard, addAssignmentCardMusic, addAssignmentCardVideo, useThread, getSnapshot, type MsgAttachment, type MsgItem } from "@/src/lib/messagesStore";
import { getChurchProjectMcScheduleState } from "@/src/store/churchProjectMcScheduleStore";
import { apiGet, apiPatch, apiDelete, apiPost } from "@/src/lib/kristoApi";
import { hasRoomAccess } from "@/src/lib/roomAccess";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { requireActiveChurchSubscriptionForSchedule } from "@/src/lib/churchSubscription";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { LinearGradient } from "expo-linear-gradient";

const BG = "#0B0F17";
const TEXT = "rgba(255,255,255,0.94)";
const GOLD = "rgba(217,179,95,0.92)";
const GOLD_SOLID = "#D9B35F";
const PURPLE = "#8B5CF6";
const PAD = 16;

function chatMediaUrl(u: unknown) {
  const v = String(u || "").trim();
  if (!v) return "";
  if (/^data:image\//i.test(v) || /^https?:\/\//i.test(v) || v.startsWith("file://")) return v;

  const base = String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

function resolveThreadHeaderAvatar(args: {
  session: Record<string, any> | null | undefined;
  params: Record<string, any> | null | undefined;
  realMinistry: Record<string, any> | null | undefined;
  ministryAvatarFallback: string;
  routeAvatar: string;
}) {
  const sessionAny = (args.session || {}) as Record<string, any>;
  const paramsAny = (args.params || {}) as Record<string, any>;
  const ministry = args.realMinistry || {};
  const profileChurch = sessionAny?.church || paramsAny?.church || {};

  const candidates = [
    ministry.avatarUri,
    ministry.avatarUrl,
    ministry.imageUrl,
    args.ministryAvatarFallback,
    args.routeAvatar,
    paramsAny.avatar,
    paramsAny.profileImage,
    paramsAny.photoURL,
    paramsAny.churchAvatarUri,
    paramsAny.churchLogoUri,
    paramsAny.churchProfileImage,
    paramsAny.churchImage,
    sessionAny.profileImage,
    sessionAny.avatarUri,
    sessionAny.avatarUrl,
    sessionAny.photoURL,
    sessionAny.churchAvatarUri,
    sessionAny.churchLogoUri,
    sessionAny.churchProfileImage,
    sessionAny.churchImage,
    profileChurch.avatarUri,
    profileChurch.avatarUrl,
    profileChurch.logoUri,
  ];

  for (const raw of candidates) {
    const uri = chatMediaUrl(raw);
    if (uri) return uri;
  }

  return "";
}

function FadeInBubbleWrap({
  children,
  mine,
}: {
  children: React.ReactNode;
  mine?: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(mine ? 8 : 6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function ChatRoomBackdrop() {
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={["#060910", "#0B0F17", "#070B14", "#05080F"]}
        locations={[0, 0.38, 0.72, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={s.chatBeamLeft} />
      <View pointerEvents="none" style={s.chatBeamRight} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.05)", "transparent", "rgba(139,92,246,0.04)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.chatAmbientWash}
      />
      <View pointerEvents="none" style={s.chatNoiseOverlay} />
    </>
  );
}

function ChatEmptyWatermark({
  title,
  isAssignment,
}: {
  title: string;
  isAssignment: boolean;
}) {
  const label = isAssignment ? "Church Live Control" : String(title || "Ministry Room").trim();

  return (
    <View pointerEvents="none" style={s.chatEmptyWatermark}>
      <View style={s.chatEmptyWatermarkGlow} />
      <Ionicons name="infinite-outline" size={34} color="rgba(217,179,95,0.12)" />
      <Text style={s.chatEmptyWatermarkTitle} numberOfLines={2}>
        {label}
      </Text>
      <Text style={s.chatEmptyWatermarkSub}>Sacred communication hub</Text>
    </View>
  );
}

type MinistryRole = "pastor" | "admin" | "member";
type MembershipStatus = "active" | "suspended";

type MinistryPerson = {
  id: string;
  name: string;
  role: "Pastor" | "Admin" | "Member";
  status: "Active" | "Suspended";
  note?: string;
  avatarUri?: string;
};

type AssignmentVideoClip = {
  id: string;
  sourceType: "phone" | "ministry";
  title: string;
  uri?: string;
  sourceDurationSec: number;
  trimStartSec: number;
  trimEndSec: number;
};

type AssignmentVideoDraft = {
  visible: boolean;
  messageId: string;
  assignmentDurationMin: number;
  clips: AssignmentVideoClip[];
  activeClipId: string;
  loopToFill: boolean;
  previewSec: number;
  isPlaying: boolean;
  playbackRate: number;
};

function isAssignmentLive(card: any) {
  try {
    if (!card?.meetingDate) return false;

    const start = new Date(card.meetingDate).getTime();
    const durationMin = Number(card.durationMin || 0);
    const end = start + durationMin * 60 * 1000;
    const now = Date.now();

    return now >= start && now <= end;
  } catch {
    return false;
  }
}

function formatDurationLabel(totalSec: number) {
  const safe = Math.max(0, Math.round(totalSec || 0));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function makeAssignmentVideoClip(args: {
  sourceType: "phone" | "ministry";
  title: string;
  uri?: string;
  sourceDurationSec?: number;
}) {
  const sourceSec = Math.max(5, Math.round(args.sourceDurationSec || 0 || 5));
  return {
    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sourceType: args.sourceType,
    title: args.title,
    uri: args.uri || "",
    sourceDurationSec: sourceSec,
    trimStartSec: 0,
    trimEndSec: sourceSec,
  } as AssignmentVideoClip;
}

function clipTrimmedSec(clip?: AssignmentVideoClip | null) {
  if (!clip) return 0;
  return Math.max(1, Math.round(clip.trimEndSec - clip.trimStartSec));
}

function totalDraftTrimmedSec(draft: AssignmentVideoDraft) {
  return draft.clips.reduce((sum, clip) => sum + clipTrimmedSec(clip), 0);
}

function assignmentSlotSec(draft: AssignmentVideoDraft) {
  return Math.max(1, draft.assignmentDurationMin * 60);
}

function loopsNeededToFill(draft: AssignmentVideoDraft) {
  const total = Math.max(1, totalDraftTrimmedSec(draft));
  const slot = assignmentSlotSec(draft);
  return Math.max(1, Math.ceil(slot / total));
}

function getActiveAssignmentClip(draft: AssignmentVideoDraft) {
  return draft.clips.find((clip) => clip.id === draft.activeClipId) || draft.clips[0] || null;
}
function getClipPlaybackRate(
  draft: AssignmentVideoDraft,
  clip?: AssignmentVideoClip | null
) {
  return (clip as any)?.playbackRate || (draft as any).playbackRate || 1;
}

function applyAutoFlowToClips(clips: AssignmentVideoClip[]) {
  if (!clips.length) return clips;

  if (clips.length === 1) {
    return clips.map((clip) => ({
      ...clip,
      playbackRate: 1,
      autoRole: "main",
    }));
  }

  return clips.map((clip, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === clips.length - 1;

    let playbackRate = 1;
    let autoRole = "main";

    if (isFirst) {
      playbackRate = 0.5;
      autoRole = "intro";
    } else if (isLast) {
      playbackRate = clips.length >= 3 ? 1.25 : 1.1;
      autoRole = "lift";
    }

    return {
      ...clip,
      playbackRate,
      autoRole,
    };
  });
}

const MINISTRY_META: Record<string, { role: MinistryRole; status: MembershipStatus }> = {
  "m-prayer": { role: "pastor", status: "active" },
  "m-youth": { role: "admin", status: "active" },
  "m-worship": { role: "member", status: "active" },
  "m-outreach": { role: "admin", status: "active" },
  "m-ushering": { role: "member", status: "suspended" },
  "m-media": { role: "member", status: "active" },
  "m-children": { role: "member", status: "active" },
};

function ministryRoleInfo(threadId: string) {
  return MINISTRY_META[threadId] || { role: "member" as MinistryRole, status: "active" as MembershipStatus };
}

function pastorShortName(name?: string) {
  const clean = String(name || "").trim();
  if (!clean) return "Pastor";

  const parts = clean.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return `Pastor ${parts[0]}`;
  }

  return `Pastor ${parts[0]} ${parts[1][0]}.`;
}

function initials(name: string) {
  const s = (name || "?").trim();

  return (s[0] || "?").toUpperCase();
}

function formatMeetingInShort(diffMs: number) {
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(0, mins)}m`;
}

function formatTime(ts: number) {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

function headerAvatarLabel(threadId: string, title: string) {
  const safe = String(title || "").trim();
  if (safe) return safe.charAt(0).toUpperCase();

  if (threadId === "g3") return "P";
  if (threadId === "g5") return "N";
  if (threadId === "g1") return "H";
  return "M";
}

function headerPresence(threadId: string) {
  if (threadId === "g3") return { online: true, text: "online now" };
  if (threadId === "g5") return { online: true, text: "online now" };
  if (threadId === "g1") return { online: false, text: "last seen 2 min ago" };
  return { online: false, text: "last seen recently" };
}

function headerAvatarUri(threadId: string, routeAvatar?: string) {
  const fromRoute = String(routeAvatar || "").trim();

  if (fromRoute) {
    return fromRoute;
  }

  if (threadId === "g3") return "https://i.pravatar.cc/300?img=12";
  if (threadId === "g5") return "https://i.pravatar.cc/300?img=47";
  if (threadId === "g1") return "https://i.pravatar.cc/300?img=32";
  return "";
}

function profileFacts(threadId: string, headerTitle: string) {
  if (threadId === "g3") {
    return [
      { label: "MINISTRY", value: "Pastoral Care", pill: "Ministry", tone: "blue" },
      { label: "BAPTIZED", value: "12 Aug 2018", pill: "Faith", tone: "emerald" },
      { label: "CHURCH", value: "TLMC Central", pill: "Church", tone: "purple" },
      { label: "RATING", value: "4.9 / 5", pill: "Trusted", tone: "blue" },
    ];
  }

  if (threadId === "g1") {
    return [
      { label: "AGE", value: "27 years", pill: "Member", tone: "blue" },
      { label: "LAST SEEN", value: "2 min ago", pill: "Active", tone: "emerald" },
      { label: "CHURCH", value: "Pan Africa Church", pill: "Church", tone: "purple" },
      { label: "RATING", value: "4.7 / 5", pill: "Trusted", tone: "blue" },
    ];
  }

  if (threadId === "g5") {
    return [
      { label: "AGE", value: "24 years", pill: "Friend", tone: "purple" },
      { label: "BAPTIZED", value: "05 May 2021", pill: "Faith", tone: "emerald" },
      { label: "MINISTRY", value: "Worship Team", pill: "Service", tone: "blue" },
      { label: "RATING", value: "4.8 / 5", pill: "Warm", tone: "purple" },
    ];
  }

  return [];
}

function profileRouteParams(threadId: string, headerTitle: string, currentFact?: any, presence?: { online: boolean; text: string }) {
  const fallbackChurchName =
    threadId === "g1" ? "Pan Africa Church" :
    threadId === "g3" ? "TLMC Central" :
    "Kristo App";

  const factRole =
    currentFact?.pill === "Member" ? "Member" :
    currentFact?.pill === "Ministry" ? "Leader" :
    currentFact?.pill === "Service" ? "Leader" :
    currentFact?.pill === "Friend" ? "Member" :
    currentFact?.pill === "Church" ? "Member" :
    "Member";

  const factChurch =
    currentFact?.label === "CHURCH" && currentFact?.value ? String(currentFact.value) : fallbackChurchName;

  const status =
    presence?.online ? "Active" :
    String(currentFact?.pill || "").trim() === "Trusted" ? "Active" :
    "Active";

  const note =
    currentFact?.label === "LAST SEEN" ? `Last seen • ${String(currentFact?.value || "recently")}` :
    currentFact?.label === "AGE" ? `Age • ${String(currentFact?.value || "—")}` :
    currentFact?.label === "BAPTIZED" ? `Baptized • ${String(currentFact?.value || "—")}` :
    currentFact?.label === "MINISTRY" ? `Ministry • ${String(currentFact?.value || "—")}` :
    currentFact?.label === "RATING" ? `Rating • ${String(currentFact?.value || "—")}` :
    presence?.online ? "Online now" :
    String(presence?.text || "Active");

  return {
    userId: threadId || headerTitle.toLowerCase().replace(/\s+/g, "-"),
    churchId: "",
    churchName: factChurch,
    name: headerTitle || "Member",
    role: factRole,
    status,
    note,
  };
}

function PersonRow({ item }: { item: MinistryPerson }) {
  const roleStyle =
    item.role === "Pastor"
      ? s.memberRolePastor
      : item.role === "Admin"
        ? s.memberRoleAdmin
        : s.memberRoleMember;

  const roleTextStyle =
    item.role === "Pastor"
      ? t.memberRoleTextPastor
      : item.role === "Admin"
        ? t.memberRoleTextAdmin
        : t.memberRoleTextMember;

  const isLeader = item.role === "Pastor" || item.role === "Admin";

  return (
    <View style={[s.memberRow, isLeader ? s.memberRowLeader : null]}>
      <View style={[s.memberAvatar, isLeader ? s.memberAvatarLeader : s.memberAvatarMember]}>
        {item.avatarUri ? (
          <Image source={{ uri: item.avatarUri }} style={s.memberAvatarImage as any} />
        ) : (
          <Text style={t.memberAvatarText}>
            {initials(item.name)}
          </Text>
        )}

        {isLeader ? (
          <View style={s.memberCrownBadge}>
            <Ionicons name="star" size={11} color="#10151F" />
          </View>
        ) : null}
      </View>

      <View style={s.memberMain}>
        <View style={s.memberTopRow}>
          <Text style={t.memberName} numberOfLines={1}>
            {item.name}
          </Text>

          <View style={[s.memberRolePill, roleStyle]}>
            <Text style={[t.memberRoleText, roleTextStyle]}>
              {item.role}
            </Text>
          </View>
        </View>

        <View style={s.memberBottomRow}>
          <Text style={t.memberNote} numberOfLines={1}>
            {item.note}
          </Text>
        </View>
      </View>
    </View>
  );
}

function renderAssignmentCardBody(
  m: MsgItem,
  opts?: {
    canClaim?: boolean;
    onClaim?: () => void;
    canAdd?: boolean;
    onAdd?: () => void;
    canAddVideo?: boolean;
    onAddVideo?: () => void;
    currentUserId?: string;
  }
) {
  if (m.kind !== "assignment_card" || !m.card) return null;

  const card = m.card;
  const status = String(card.status || "open").toLowerCase();
  const isTaken = status === "taken";
  const isDone = status === "done";
  const isChoirCard = /choir/i.test(String(card.title || "")) || /choir/i.test(String(card.task || "")) || /choir/i.test(String(card.roleLabel || ""));

  const claimedBy = String(card.claimedByName || "").trim();
  const claimedByUserId = String((card as any).claimedByUserId || "").trim();
  const currentUserId = String(opts?.currentUserId || "").trim();
  const claimedByMe = !!claimedByUserId && !!currentUserId && claimedByUserId === currentUserId;
  const claimedDisplayName = claimedByMe ? "You" : (claimedBy || "Claimed");
  const claimedRole = String(card.claimedByRole || "Member").trim();
  const claimedAvatar = String(card.claimedByAvatar || "").trim();
  const videoItems = Array.isArray((card as any).videoItems)
    ? (card as any).videoItems
    : Array.isArray(card.musicItems)
      ? card.musicItems
      : [];

  const cleanTitle = String(card.title || "").trim();
  const cleanTask = String(card.task || "").trim();
  const cleanScript = String(card.script || "").trim();

  const normalizedTask =
    cleanTask &&
    cleanTask.toLowerCase() !== cleanTitle.toLowerCase() &&
    !/^(no topic|ready to execute)$/i.test(cleanTask)
      ? cleanTask
      : "";

  
  const topicTone = (() => {
    const t = String(card.title || "").toLowerCase();
    const r = String(card.roleKey || "").toLowerCase();

    if (t.includes("choir") || r === "choir") {
      return {
        bg: "rgba(56,189,248,0.16)",
        border: "rgba(56,189,248,0.34)",
        glow: "#38BDF8",
        label: "rgba(125,211,252,0.95)",
      };
    }

    if (t.includes("testimony")) {
      return {
        bg: "rgba(168,85,247,0.16)",
        border: "rgba(168,85,247,0.34)",
        glow: "#A855F7",
        label: "rgba(216,180,254,0.95)",
      };
    }

    if (t.includes("offering")) {
      return {
        bg: "rgba(16,185,129,0.16)",
        border: "rgba(16,185,129,0.34)",
        glow: "#10B981",
        label: "rgba(110,231,183,0.95)",
      };
    }

    if (t.includes("announcement") || r === "mc") {
      return {
        bg: "rgba(34,211,238,0.16)",
        border: "rgba(34,211,238,0.34)",
        glow: "#22D3EE",
        label: "rgba(165,243,252,0.95)",
      };
    }

    if (t.includes("prayer") || r === "leader") {
      return {
        bg: "rgba(217,179,95,0.16)",
        border: "rgba(217,179,95,0.32)",
        glow: "#D9B35F",
        label: "rgba(245,215,128,0.96)",
      };
    }

    return {
      bg: "rgba(56,189,248,0.14)",
      border: "rgba(56,189,248,0.24)",
      glow: "#38BDF8",
      label: "rgba(125,211,252,0.88)",
    };
  })();

const normalizedScript =
    cleanScript &&
    cleanScript.toLowerCase() !== cleanTitle.toLowerCase() &&
    !/^(no topic|ready to execute)$/i.test(cleanScript) &&
    !/^review detail:/i.test(cleanScript)
      ? cleanScript
      : "";

  const roleLine = String(card.roleLabel || card.subtitle || "").trim();
  const timeLine = String((card as any).timeLabel || "").trim();

  const meetingDateValue = String((card as any)?.meetingDate || "").trim();
  const liveDurationMin = Math.max(0, Number(card.durationMin || 0));
  const liveStartDate = meetingDateValue ? new Date(meetingDateValue) : null;
  const liveStartMs = liveStartDate && !Number.isNaN(liveStartDate.getTime())
    ? liveStartDate.getTime()
    : null;
  const liveEndMs = liveStartMs != null
    ? liveStartMs + (liveDurationMin * 60 * 1000)
    : null;
  const nowMs = Date.now();

  const formatCountdownShort = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const liveCountdownActive =
    liveStartMs != null &&
    liveEndMs != null &&
    nowMs >= liveStartMs &&
    nowMs < liveEndMs;

  const backstage30Active =
    liveStartMs != null &&
    nowMs >= (liveStartMs - 30 * 60 * 1000) &&
    nowMs < liveStartMs;

  const audienceWaiting5Active =
    liveStartMs != null &&
    nowMs >= (liveStartMs - 5 * 60 * 1000) &&
    nowMs < liveStartMs;

  const stageReady3Active =
    liveStartMs != null &&
    nowMs >= (liveStartMs - 3 * 60 * 1000) &&
    nowMs < liveStartMs;

  const pastorLiveUnlock3h =
    liveStartMs != null &&
    nowMs >= (liveStartMs - 3 * 60 * 60 * 1000);

  const pastorLiveLocked =
    liveStartMs != null &&
    nowMs < (liveStartMs - 3 * 60 * 60 * 1000);

  // claimedByMe is calculated by claimedByUserId above.

  const claimerBackstage15Active =
    claimedByMe &&
    liveStartMs != null &&
    nowMs >= (liveStartMs - 15 * 60 * 1000) &&
    nowMs < liveStartMs;

  const liveCountdownLabel =
    liveStartMs == null || liveEndMs == null
      ? ""
      : claimerBackstage15Active
        ? `BACKSTAGE OPEN • STARTS IN ${formatCountdownShort(liveStartMs - nowMs)}`
      : stageReady3Active && claimedByMe
        ? "GO STAGE READY"
      : audienceWaiting5Active
        ? `LIVE NOW • STARTS IN ${formatCountdownShort(liveStartMs - nowMs)}`
      : nowMs < liveStartMs
        ? pastorLiveLocked
          ? `LOCKED • OPENS 3H BEFORE`
          : `LIVE IN ${formatCountdownShort(liveStartMs - nowMs)}`
        : nowMs >= liveStartMs && nowMs < liveEndMs
          ? `LIVE NOW • ENDS IN ${formatCountdownShort(liveEndMs - nowMs)}`
          : "LIVE WINDOW ENDED";

  const claimExpired = liveEndMs != null ? nowMs >= liveEndMs : false;
  const canShowClaim = !!opts?.canClaim && !isTaken && !claimExpired;

  const canOpenScheduledLive =
    liveStartMs != null &&
    (
      (pastorLiveUnlock3h && claimedByMe)
      ||
      liveCountdownActive
      ||
      claimerBackstage15Active
      ||
      audienceWaiting5Active
      ||
      stageReady3Active
    );

  const slotLine = String((card as any).slotLabel || "").trim();

  return (
    <View
      style={{
        position: "relative",
        overflow: "hidden",
        borderWidth: 1,
        borderColor: isTaken
          ? "rgba(90,210,255,0.78)"
          : isDone
            ? "rgba(80,230,170,0.46)"
            : "rgba(245,215,128,0.36)",
        backgroundColor: isTaken
          ? "rgba(7,44,78,0.74)"
          : isDone
            ? "rgba(17,48,34,0.62)"
            : "rgba(33,24,10,0.36)",
        borderRadius: 22,
        paddingTop: 26,
        paddingHorizontal: 9,
        paddingBottom: 12,
        gap: 5,
        width: "100%",
        shadowColor: isTaken
          ? "#38BDF8"
          : isDone
            ? "#34D399"
            : "#D9B35F",
        shadowOpacity: isTaken ? 0.30 : isDone ? 0.22 : 0.24,
        shadowRadius: isTaken ? 22 : isDone ? 16 : 20,
        shadowOffset: { width: 0, height: 10 },
        elevation: isTaken ? 11 : isDone ? 7 : 8,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 54,
          backgroundColor: isTaken
            ? "rgba(255,255,255,0.035)"
            : "rgba(255,255,255,0.022)",
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
        }}
      />

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          right: -30,
          top: 28,
          width: 170,
          height: 170,
          borderRadius: 999,
          backgroundColor: isTaken
            ? "rgba(90,210,255,0.035)"
            : "rgba(245,215,128,0.028)",
        }}
      />

      <View
        style={{
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          {slotLine ? (
            <Text
              numberOfLines={1}
              style={{
                marginTop: 12,
                color: "rgba(245,215,128,0.92)",
                fontSize: 11,
                fontWeight: "900",
                letterSpacing: 0.8,
                marginBottom: 4,
              }}
            >
              {slotLine.toUpperCase()}
            </Text>
          ) : null}

          <Text
            numberOfLines={2}
            ellipsizeMode="tail"
            style={{
              flex: 1,
              minWidth: 0,
              color: "rgba(255,255,255,0.98)",
              fontSize: 16,
              fontWeight: "900",
              lineHeight: 20,
              paddingRight: 10,
            }}
          >
            {card.title || "Assignment"}
          </Text>
        </View>

        {card.durationMin ? (
          <View
            style={{
              flexShrink: 0,
              alignSelf: "flex-start",              marginRight: 6,
              paddingHorizontal: 14,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: "rgba(56,189,248,0.16)",
              borderWidth: 1,
              borderColor: "rgba(56,189,248,0.34)",
            }}
          >
            <Text
              style={{
                color: "rgba(125,211,252,0.96)",
                fontSize: 10,
                fontWeight: "900",
              }}
            >
              {card.durationMin} min
            </Text>
          </View>
        ) : null}
      </View>

      {isTaken && claimedBy ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderRadius: 20,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: "rgba(0,25,58,0.72)",
            borderWidth: 1,
            borderColor: "rgba(56,189,248,0.20)",
          }}
        >
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              flexShrink: 0,
            }}
          >
            {claimedAvatar ? (
              <Image
                source={{ uri: claimedAvatar }}
                style={{ width: "100%", height: "100%", borderRadius: 999 }}
              />
            ) : (
              <Text
                style={{
                  color: "rgba(125,211,252,0.98)",
                  fontSize: 22,
                  fontWeight: "800",
                }}
              >
                {initials(claimedBy)}
              </Text>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{
                color: "rgba(255,255,255,0.98)",
                fontSize: 13.5,
                fontWeight: "900",
              }}
            >
              {claimedBy === "You" ? "You" : claimedBy}
            </Text>

            <Text
              numberOfLines={1}
              style={{                color: "rgba(125,211,252,0.96)",
                fontSize: 10.5,
                fontWeight: "800",
              }}
            >
              {claimedRole} • ACTIVE
            </Text>
          </View>
        </View>
      ) : null}

      {roleLine ? (
        <Text
          numberOfLines={1}
          style={{
            color: "rgba(255,255,255,0.78)",
            fontSize: 12.5,
            fontWeight: "800",
            lineHeight: 16,
          }}
        >
          {roleLine}
        </Text>
      ) : null}

      {normalizedScript ? (
        <View
          style={{            width: "100%",
            paddingHorizontal: 14,
            paddingVertical: 14,
            borderRadius: 16,
            backgroundColor: topicTone.bg,
            borderWidth: 1.2,
            borderColor: topicTone.border,
            shadowColor: topicTone.glow,
            shadowOpacity: 0.24,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 5 },
          }}
        >
          <Text
            style={{
              color: topicTone.label,
              fontSize: 9.5,
              fontWeight: "900",
              letterSpacing: 1.5,
              marginBottom: 6,
              textShadowColor: "rgba(255,255,255,0.08)",
              textShadowRadius: 4,
            }}
          >
            TOPIC
          </Text>

          <Text
            style={{
              width: "100%",
              flexShrink: 1,
              flexWrap: "wrap",
              color: "rgba(255,255,255,0.98)",
              fontSize: 13.5,
              lineHeight: 20,
              fontWeight: "800",
              textAlign: "left",
              textShadowColor: "rgba(255,255,255,0.10)",
              textShadowRadius: 6,
            }}
          >
            {breakLongWords(normalizedScript)}
          </Text>
        </View>
      ) : null}

      {videoItems.length ? (
        (() => {
          const normalized = videoItems.map((video: any, idx: number) => {
            const raw = typeof video === "string" ? video : String(video?.title || `Clip ${idx + 1}`);
            const durationMatch = raw.match(/\b\d{1,2}:\d{2}\b/);
            return {
              raw,
              duration: durationMatch ? durationMatch[0] : null,
            };
          });

          const totalSec = normalized.reduce((sum: number, item: any) => {
            if (!item.duration) return sum;
            const [mm, ss] = String(item.duration).split(":").map((n: string) => Number(n || 0));
            return sum + (mm * 60) + ss;
          }, 0);

          const totalText = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
          const countText = normalized.length === 1 ? "1 clip" : `${normalized.length} clips`;
          const loopText = /loop/i.test(normalized.map((x: any) => x.raw).join(" "))
            ? "Loop"
            : "No loop";

          return (
            <View style={{ marginTop: 2 }}>
              <View
                style={{
                  paddingHorizontal: 4,
                  paddingVertical: 7,
                  borderRadius: 11,
                  backgroundColor: "rgba(56,189,248,0.18)",
                  borderWidth: 1,
                  borderColor: "rgba(56,189,248,0.34)",
                  shadowColor: "#38BDF8",
                  shadowOpacity: 0.18,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: "rgba(125,211,252,0.96)",
                    fontSize: 10,
                    lineHeight: 13,
                    fontWeight: "800",
                  }}
                >
                  ▶ {countText} • Total {totalText} • Slot {card.durationMin || 0} min • {loopText}
                </Text>
              </View>
            </View>
          );
        })()
      ) : null}

      {Array.isArray(card.notes) && card.notes.length ? (
        <View
          style={{            gap: 2,
          }}
        >
          {(() => {
            const rawNotes = Array.isArray(card.notes)
              ? card.notes.map((x) => String(x || "").trim()).filter(Boolean)
              : [];

            const meetingDateValue = String((card as any)?.meetingDate || "").trim();

            let realMeetingDay = "";
            if (meetingDateValue) {
              const parsed = new Date(meetingDateValue);
              if (!Number.isNaN(parsed.getTime())) {
                realMeetingDay = parsed.toLocaleDateString("en-US", {
                  month: "short",
                  day: "2-digit",
                  year: "numeric",
                });
              }
            }

            const audienceNote =
              rawNotes.find((x) => /^audience:/i.test(x)) || "";

            const reviewNote =
              rawNotes.find((x) => /^review detail:/i.test(x)) || "";

            const rawMeetingDayNote =
              rawNotes.find((x) => /^meeting day:/i.test(x)) || "";

            const meetingDayNote = realMeetingDay
              ? `Meeting day: ${realMeetingDay}`
              : rawMeetingDayNote;

            const allocatedNote =
              rawNotes.find((x) => /^allocated:/i.test(x)) || "";

            const splitNote =
              rawNotes.find((x) => /^split segment:/i.test(x)) || "";

            const finalAdjustedNote =
              rawNotes.find((x) => /^final adjusted/i.test(x)) || "";

            const noteList = [
              audienceNote,
            ].filter(Boolean);

            return (
              <>
                {meetingDayNote ? (
                  <Text
                    key={`${m.id}_meeting_day_fixed`}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                    style={{
                      color: "rgba(245,215,128,0.90)",
                      fontSize: 12,
                      lineHeight: 17,
                      fontWeight: "900",
                      marginTop: 4,
                    }}
                  >
                    {meetingDayNote}
                  </Text>
                ) : null}

                {noteList.map((rawNote, idx) => {
                  const noteText = String(rawNote || "").trim();

                  return (
                    <Text
                      key={`${m.id}_note_${idx}`}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                      style={{
                        color: /^review detail:/i.test(noteText)
                          ? "rgba(255,255,255,0.88)"
                          : /^audience:/i.test(noteText)
                            ? "rgba(125,211,252,0.92)"
                            : /^allocated:/i.test(noteText)
                              ? "rgba(255,255,255,0.84)"
                              : /^split segment:/i.test(noteText)
                                ? "rgba(255,255,255,0.72)"
                                : /^final adjusted/i.test(noteText)
                                  ? "rgba(245,215,128,0.82)"
                                  : "rgba(255,255,255,0.76)",
                        fontSize: /^review detail:/i.test(noteText) ? 11.5 : 11,
                        lineHeight: 15,
                        fontWeight: "800",
                      }}
                    >
                      {rawNote}
                    </Text>
                  );
                })}
              </>
            );
          })()}
        </View>
      ) : null}

      {(
        opts?.canClaim ||
        opts?.canAdd ||
        (isChoirCard && opts?.canAddVideo) ||
        isTaken ||
        isDone ||
        status === "open"
      ) ? (
        <View
          style={[
            s.assignmentActionRow,
            {              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 4,
            },
          ]}
        >
          <View
            style={{
              width: "100%",
              gap: 10,
            }}
          >
            {timeLine ? (
              <View
                style={{
                  width: "100%",
                  alignSelf: "stretch",
                  minHeight: 52,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: "rgba(217,179,95,0.16)",
                  borderWidth: 1.2,
                  borderColor: "rgba(245,215,128,0.58)",
                  shadowColor: "#F5D780",
                  shadowOpacity: 0.28,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 4 },
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: "rgba(245,215,128,0.98)",
                    fontSize: 12,
                    fontWeight: "900",
                    letterSpacing: 0.1,
                    lineHeight: 15,
                    textAlign: "center",
                  }}
                >
                  {timeLine}
                </Text>
              </View>
            ) : null}

            {liveCountdownLabel ? (
              <View
                style={{
                  width: "100%",
                  alignSelf: "stretch",
                  minHeight: 50,
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  borderRadius: 999,
                  backgroundColor: liveCountdownActive
                    ? "rgba(34,197,94,0.16)"
                    : "rgba(56,189,248,0.12)",
                  borderWidth: 1.2,
                  borderColor: liveCountdownActive
                    ? "rgba(34,197,94,0.42)"
                    : "rgba(56,189,248,0.34)",
                  shadowColor: liveCountdownActive || claimerBackstage15Active ? "#22c55e" : "#38BDF8",
                  shadowOpacity: 0.22,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 4 },
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: liveCountdownActive || claimerBackstage15Active
                      ? "rgba(134,239,172,0.98)"
                      : "rgba(125,211,252,0.98)",
                    fontSize: 12,
                    fontWeight: "900",
                    letterSpacing: 0.2,
                    lineHeight: 15,
                    textAlign: "center",
                  }}
                >
                  {liveCountdownLabel}
                </Text>
              </View>
            ) : null}

            {canShowClaim ? (
              <Pressable
                onPress={opts.onClaim}
                style={({ pressed }) => [
                  s.assignmentActionBtn,
                  s.assignmentActionBtnPrimary,
                  pressed ? s.assignmentActionBtnPressed : null,
                ]}
              >
                <Text style={t.assignmentActionTextPrimary}>CLAIM</Text>
              </Pressable>
            ) : null}

            {opts?.canAdd ? (
              <Pressable
                onPress={opts.onAdd}
                style={({ pressed }) => [
                  s.assignmentActionBtn,
                  s.assignmentActionBtnPrimary,
                  pressed ? s.assignmentActionBtnPressed : null,
                ]}
              >
                <Text style={t.assignmentActionTextGhost}>CLAIM</Text>
              </Pressable>
            ) : null}

            {isChoirCard && opts?.canAddVideo ? (
              <Pressable
                onPress={opts.onAddVideo}
                style={({ pressed }) => [
                  s.assignmentActionBtn,
                  s.assignmentActionBtnPrimary,
                  pressed ? s.assignmentActionBtnPressed : null,
                  {
                    borderColor: "rgba(56,189,248,0.35)",
                    backgroundColor: "rgba(56,189,248,0.10)",
                  },
                ]}
              >
                <Text
                  style={[
                    t.assignmentActionTextPrimary,
                    { color: "rgba(125,211,252,0.98)" },
                  ]}
                >
                  ADD VIDEO
                </Text>
              </Pressable>
            ) : null}
          </View>

          {(() => {
            const meetingDateValue = String((card as any)?.meetingDate || "").trim();
            const durationMin = Math.max(0, Number(card.durationMin || 0));
            const start = meetingDateValue ? new Date(meetingDateValue) : null;
            const valid = !!start && !Number.isNaN(start.getTime());
            const end = valid ? new Date(start.getTime() + durationMin * 60 * 1000) : null;

            const fmtTime = (d: Date) =>
              d.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              });

            if (!valid || !end) return null;

            return (
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor: "rgba(34,197,94,0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(34,197,94,0.30)",
                  }}
                >
                  <Text
                    style={{
                      color: "#22c55e",
                      fontSize: 7,
                      fontWeight: "900",
                      letterSpacing: 0.3,
                    }}
                  >
                    START {fmtTime(start)}
                  </Text>
                </View>

                <View
                  style={{
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor: "rgba(239,68,68,0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.30)",
                  }}
                >
                  <Text
                    style={{
                      color: "#ef4444",
                      fontSize: 6.5,
                      fontWeight: "900",
                      letterSpacing: 0.3,
                    }}
                  >
                    END {fmtTime(end)}
                  </Text>
                </View>
              </View>
            );
          })()}
        </View>
      ) : null}
    </View>
  );
}

function getAssignmentMeetingWindow(messages: MsgItem[]) {
  const rows = (messages || [])
    .filter((m) => m.kind === "assignment_card" && m.card?.meetingDate)
    .map((m) => {
      const startMs = new Date(String(m.card?.meetingDate || "")).getTime();
      const durationMin = Math.max(0, Number(m.card?.durationMin || 0));
      const endMs = startMs + durationMin * 60 * 1000;
      return Number.isFinite(startMs) ? { startMs, endMs } : null;
    })
    .filter(Boolean) as Array<{ startMs: number; endMs: number }>;

  if (!rows.length) {
    return { startMs: null as number | null, endMs: null as number | null };
  }

  rows.sort((a, b) => a.startMs - b.startMs);
  return {
    startMs: rows[0]?.startMs ?? null,
    endMs: rows.reduce((max, row) => Math.max(max, row.endMs), rows[0].endMs),
  };
}

function formatLiveCountdown(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const totalMin = Math.ceil(totalSec / 60);

  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h}H ${m}M` : `${h}H`;
  }

  return `${totalMin} MIN`;
}

const DEMO_MINISTRY_VIDEOS = [
  "Choir Entrance Video",
  "Jeje Choir Video",
  "Worship Session Clip",
  "Choir Finale Video",
];

function getAssignmentLiveCountdownMeta(card?: any) {
  const meetingDateValue = String(card?.meetingDate || "").trim();
  const durationMin = Math.max(0, Number(card?.durationMin || 0));

  if (!meetingDateValue) {
    return {
      valid: false,
      active: false,
      ended: false,
      canOpenLive: false,
      label: "",
      startMs: 0,
      endMs: 0,
      remainingMs: 0,
    };
  }

  const startMs = new Date(meetingDateValue).getTime();
  if (Number.isNaN(startMs)) {
    return {
      valid: false,
      active: false,
      ended: false,
      canOpenLive: false,
      label: "",
      startMs: 0,
      endMs: 0,
      remainingMs: 0,
    };
  }

  const endMs = startMs + durationMin * 60 * 1000;
  const now = Date.now();

  const fmt = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  if (now < startMs) {
    const remainingMs = startMs - now;
    return {
      valid: true,
      active: false,
      ended: false,
      canOpenLive: false,
      label: `LIVE IN ${fmt(remainingMs)}`,
      startMs,
      endMs,
      remainingMs,
    };
  }

  if (now >= startMs && now < endMs) {
    const remainingMs = endMs - now;
    return {
      valid: true,
      active: true,
      ended: false,
      canOpenLive: true,
      label: `LIVE NOW • ENDS IN ${fmt(remainingMs)}`,
      startMs,
      endMs,
      remainingMs,
    };
  }

  return {
    valid: true,
    active: false,
    ended: true,
    canOpenLive: false,
    label: "LIVE WINDOW ENDED",
    startMs,
    endMs,
    remainingMs: 0,
  };
}

function Bubble({
  m,
  showAvatar,
  onLongPress,
  canClaimAssignmentCard,
  canAddAssignmentCard,
  canAddVideoAssignmentCard,
  onClaimAssignmentCard,
  onAddAssignmentMember,
  onAddVideoAssignmentCard,
  onOpenScheduledLive,
}: {
  m: MsgItem;
  showAvatar?: boolean;
  onLongPress: () => void;
  canClaimAssignmentCard?: boolean;
  canAddAssignmentCard?: boolean;
  canAddVideoAssignmentCard?: boolean;
  onClaimAssignmentCard?: (messageId: string) => void;
  onAddAssignmentMember?: (messageId: string) => void;
  onAddVideoAssignmentCard?: (messageId: string) => void;
  onOpenScheduledLive?: (m: MsgItem) => void;
}) {
  const mine = m.sender === "me";
  const senderRoleGlobal = String((m as any).role || "").toLowerCase();
  const isPastorMineOrOther =
    senderRoleGlobal.includes("pastor") ||
    String((m as any).senderUserId || "") === "u_3cba06da2dc7c19df3cc074a" ||
    String(m.displayName || "").toLowerCase().includes("pastor");

  if (m.kind === "assignment_card") {
    const cardIndexMatch = String(m.card?.slotLabel || m.card?.cardId || m.id || "").match(/(\d+)/);
    const cardIndex =
      cardIndexMatch?.[1] ||
      String(((m.card as any)?.order ?? (m.card as any)?.slotNumber ?? "")).trim();
    const cardStatus = String(m.card?.status || "open").toLowerCase();
    const isTakenCard = cardStatus === "taken";
    const isDoneCard = cardStatus === "done";
    const liveMeta = getAssignmentLiveCountdownMeta(m.card);
    const canOpenThisScheduledLive = !!liveMeta.valid && !!liveMeta.canOpenLive;

    return (
      <Pressable
        // Slot card is view-only. Live opens only from the top LIVE button.
        onLongPress={onLongPress}
        delayLongPress={280}
        style={s.assignmentTimelineWrap}
      >
        <View style={s.assignmentTimelineRail}>
          
          <View
            style={[
              s.assignmentTimelineNode,
              isTakenCard
                ? s.assignmentTimelineNodeTaken
                : isDoneCard
                  ? s.assignmentTimelineNodeDone
                  : s.assignmentTimelineNodeOpen,
            ]}
          >
            <Text
              style={[
                t.assignmentTimelineNodeText,
                isTakenCard
                  ? t.assignmentTimelineNodeTextTaken
                  : isDoneCard
                    ? t.assignmentTimelineNodeTextDone
                    : t.assignmentTimelineNodeTextOpen,
              ]}
            >
              {cardIndex || initials(m.displayName || "A")}
            </Text>
          </View>
        </View>

        <View style={s.assignmentTimelineContent}>
          {renderAssignmentCardBody(m, {
            canClaim:
              !!canClaimAssignmentCard &&
              String(m.card?.status || "open").toLowerCase() === "open",
            onClaim: () => onClaimAssignmentCard?.(m.id),
            canAdd:
              !!canAddAssignmentCard &&
              String(m.card?.status || "open").toLowerCase() === "open",
            onAdd: () => onAddAssignmentMember?.(m.id),
            canAddVideo:
              !!canAddVideoAssignmentCard ||
              (
                String(m.card?.title || "").toLowerCase().includes("choir") &&
                String((m.card as any)?.claimedByUserId || "").trim() === String((getKristoHeaders() as any)?.["x-kristo-user-id"] || "").trim()
              ),
            onAddVideo: () => onAddVideoAssignmentCard?.(m.id),
            currentUserId: String((getKristoHeaders() as any)?.["x-kristo-user-id"] || "").trim(),
          })}
          <Text style={[t.msgTime, s.assignmentTime]}>{formatTime(m.createdAt)}</Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={280}
      style={[
        s.bubbleWrap,
        mine ? ({ alignSelf: "flex-end" } as ViewStyle) : ({ alignSelf: "flex-start" } as ViewStyle),
      ]}
    >
      <FadeInBubbleWrap mine={mine}>
      {mine ? (
        <View style={[s.bubble, s.bubbleMine, isPastorMineOrOther ? s.bubblePastor : null]}>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.18)", "rgba(255,255,255,0.05)", "transparent"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={s.bubbleMineSheen}
          />
          {m.text ? <Text style={t.msgText}>{m.text}</Text> : null}

          {m.attachments?.length ? (
            <View style={s.attachBlock}>
              {m.attachments.map((a) => (
                <View key={a.id} style={s.attachRow}>
                  <Ionicons
                    name={a.kind === "image" ? "image" : "document"}
                    size={16}
                    color="rgba(255,255,255,0.70)"
                  />
                  <Text style={t.attachName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={t.attachMeta} numberOfLines={1}>
                    {a.kind.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={s.msgMetaRow}>
            <Text style={t.msgTimeMine}>{formatTime(m.createdAt)}</Text>
            <View style={s.deliveredRow}>
              <Ionicons name="checkmark-done" size={11} color="rgba(196,181,253,0.88)" />
              <Text style={t.deliveredText}>Delivered</Text>
            </View>
          </View>
        </View>
      ) : (() => {
        const senderRole = String((m as any).role || "").toLowerCase();
        const isPastorMessage =
          senderRole.includes("pastor") ||
          String((m as any).senderUserId || "") === "u_3cba06da2dc7c19df3cc074a" ||
          String(m.displayName || "").toLowerCase().includes("pastor");

        return (
        <View style={s.otherRow}>
          {showAvatar ? (
            <View style={s.avatarMini}>
              {(m as any).avatarUri ? (
                <Image source={{ uri: String((m as any).avatarUri) }} style={s.avatarMiniImage as any} />
              ) : (
                <Text style={t.avatarMiniText}>{initials(m.displayName || "U")}</Text>
              )}
            </View>
          ) : (
            <View style={s.avatarSpacer} />
          )}

          <View
            style={[
              s.bubble,
              s.bubbleOther,
              s.bubbleOtherInline,
              isPastorMessage ? s.bubblePastor : null,
            ]}
          >
            {!!m.displayName && (
              <Text
                style={{
                  color: isPastorMessage ? "#F4D06F" : "#F4D06F",
                  fontSize: 11,
                  fontWeight: "800",
                  marginBottom: 6,
                  letterSpacing: 0.3,
                }}
              >
                {isPastorMessage
                  ? pastorShortName(String(m.displayName || ""))
                  : m.displayName}
              </Text>
            )}

            {m.text ? <Text style={t.msgText}>{m.text}</Text> : null}

            {m.attachments?.length ? (
              <View style={s.attachBlock}>
                {m.attachments.map((a) => (
                  <View key={a.id} style={s.attachRow}>
                    <Ionicons
                      name={a.kind === "image" ? "image" : "document"}
                      size={16}
                      color="rgba(255,255,255,0.70)"
                    />
                    <Text style={t.attachName} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text style={t.attachMeta} numberOfLines={1}>
                      {a.kind.toUpperCase()}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text
              style={[
                t.msgTimeOther,
                isPastorMessage ? { color: "rgba(244,208,111,0.86)" } : null,
              ]}
            >
              {formatTime(m.createdAt)}
            </Text>
          </View>
        </View>
        );
      })()}
      </FadeInBubbleWrap>
    </Pressable>
  );
}

function MenuRow({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.menuRow,
        danger ? s.menuRowDanger : null,
        pressed ? s.menuRowPressed : null,
      ]}
    >
      <View style={[s.menuIconWrap, danger ? s.menuIconWrapDanger : null]}>
        <Ionicons name={icon as any} size={19} color={danger ? "#FF6B72" : GOLD} />
      </View>

      <Text style={[t.menuRowText, s.menuRowTextStrong, danger ? t.menuRowTextDanger : null]} numberOfLines={1}>
        {label}
      </Text>

      <View style={[s.menuChevronWrap, danger ? s.menuChevronWrapDanger : null]}>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={danger ? "rgba(255,120,126,0.88)" : "rgba(255,255,255,0.42)"}
        />
      </View>
    </Pressable>
  );
}

function MenuTile({
  icon,
  label,
  danger,
  disabled,
  fullWidth,
  compact,
  ministryCompact,
  activeGlow,
  onPress,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  ministryCompact?: boolean;
  activeGlow?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.menuTile,
          activeGlow && !disabled ? s.menuTileActiveGlow : null,
        compact ? s.menuTileHalf : null,
        ministryCompact ? s.menuTileMinistryCompact : null,
        fullWidth ? s.menuTileFullWidth : null,
        danger ? s.menuTileDanger : null,
        disabled ? [s.menuTileDisabled, ({ opacity: 0.58 } as ViewStyle)] : null,
        pressed && !disabled ? s.menuTilePressed : null,
      ]}
    >
      <View style={s.menuTileTop}>
        <View style={[s.menuTileIconWrap, danger ? s.menuTileIconWrapDanger : null]}>
          <Ionicons name={icon as any} size={18} color={danger ? "#FF7D84" : GOLD} />
        </View>

        <View style={[s.menuTileChevronWrap, danger ? s.menuTileChevronWrapDanger : null]}>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={danger ? "rgba(255,125,132,0.92)" : "rgba(255,255,255,0.42)"}
          />
        </View>
      </View>

      <Text
        style={[
          s.menuTileLabel,
              activeGlow && !disabled ? s.menuTileLabelActive : null,
          danger ? s.menuTileLabelDanger : null,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type MinistryApiItem = {
  id: string;
  name: string;
  description?: string;
  avatarUri?: string;
  status?: "Active" | "Paused" | string;
  churchId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const breakLongWords = (text: string) => {
  if (!text) return text;
  return text.replace(/(.{18})/g, "$1 ");
};

export default function MessageThreadScreen() {
  const isFocused = useIsFocused();
  const kristoSession = useKristoSession() as any;
  const auth =
    kristoSession?.session ||
    kristoSession?.auth ||
    kristoSession?.user ||
    kristoSession?.profile ||
    kristoSession ||
    {};
  const churchId = String(
    auth?.churchId
  );
  const baseUrl = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  const effectiveAuthUserId = String(auth?.userId || "");
  const effectiveAuthRole = String(auth?.role || "Member");

  const insets = useSafeAreaInsets();
  const tabBarH = useBottomTabBarHeight();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string; sub?: string; openMenu?: string; returnToken?: string; tab?: string; source?: string; backTo?: string; missionTitle?: string; missionUnlocked?: string; missionLive?: string; roomKind?: string; assignmentTitle?: string; assignmentSubtitle?: string; assignmentRole?: string; assignmentStatus?: string; assignmentInitials?: string; avatar?: string }>();

  function handleThreadBack() {
    router.replace("/more/my-church-room/messages?tab=chats" as any);
  }

  const threadId = String(params.id || "");
  const routeAvatar = String((params as any)?.avatar || "").trim();
  const [ministryAvatarFallback, setMinistryAvatarFallback] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadMinistryAvatarFallback() {
      const needsFallback =
        !routeAvatar &&
        String((params as any)?.source || "").toLowerCase() === "ministry-live" &&
        String((params as any)?.id || "").startsWith("min_");

      if (!needsFallback) {
        if (alive) setMinistryAvatarFallback("");
        return;
      }

      try {
        const res = await apiGet<any>("/api/church/ministries", {
          headers: getKristoHeaders() as any,
        } as any);

        const rows = Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.ministries)
            ? res.ministries
            : [];

        const found = rows.find((m: any) => String(m?.id || "") === String((params as any)?.id || ""));
        const avatar =
          String(found?.avatarUri || found?.avatarUrl || found?.imageUrl || "").trim();

        if (alive) setMinistryAvatarFallback(avatar);
      } catch {
        if (alive) setMinistryAvatarFallback("");
      }
    }

    loadMinistryAvatarFallback();

    return () => {
      alive = false;
    };
  }, [routeAvatar, params]);

  useEffect(() => {
  }, [params]);

  const title = String(params.title || "Messages");
  const sub = String(params.sub || "Chat");
  const assignmentTitle = String((params as any)?.assignmentTitle || "").trim();
  const assignmentSubtitle = String((params as any)?.assignmentSubtitle || "").trim();
  const assignmentRole = String((params as any)?.role || (params as any)?.assignmentRole || "MEMBER").trim();
  const rawAssignmentStatus = String((params as any)?.status || (params as any)?.assignmentStatus || "").trim();
  const assignmentStatus = rawAssignmentStatus.toLowerCase() === "" ? "" : rawAssignmentStatus;
  const assignmentInitials = String((params as any)?.assignmentInitials || "A").trim();
  useEffect(() => {
    if (String((params as any)?.openMenu || "") !== "1") return;

    const timer = setTimeout(() => {
      setMenuOpen(true);
    }, 250);

    return () => clearTimeout(timer);
  }, [params]);

  const missionTitle = String((params as any)?.missionTitle || "").trim();
  const missionUnlocked = String((params as any)?.missionUnlocked || "") === "1";
  const missionLive = String((params as any)?.missionLive || "") === "1";
  const roomKind = String((params as any)?.roomKind || "").trim().toLowerCase();
  const assignmentTitleParam = String((params as any)?.assignmentTitle || title || "Assignment Room");
  const assignmentSubtitleParam = String((params as any)?.assignmentSubtitle || sub || "assignment room");
  const assignmentRoleParam = String((params as any)?.assignmentRole || "MEMBER");

  const isPastorAuthority =
    String(effectiveAuthRole || "").toLowerCase() === "pastor" ||
    String(assignmentRoleParam || "").toLowerCase() === "pastor" ||
    String(assignmentRole || "").toLowerCase() === "pastor";

  // STRICT LIVE AUTHORITY
  const isChurchMediaRoom =
    String(threadId || "").trim() === "church-media-room";

  const resolvedLiveRole =
    isPastorAuthority
      ? "Pastor"
      : String(effectiveAuthRole || assignmentRole || "Member");

  const resolvedCanPublish =
    isPastorAuthority || isChurchMediaRoom;

  const rawAssignmentStatusParam = String((params as any)?.status || (params as any)?.assignmentStatus || "").trim();
  const assignmentStatusParam = rawAssignmentStatusParam.toLowerCase() === "active member" ? "" : rawAssignmentStatusParam;
  const assignmentInitialsParam = String((params as any)?.assignmentInitials || "").trim();
  const effectiveHeaderAvatar = routeAvatar || ministryAvatarFallback;
  const normalizedRoomKind = String((params as any)?.roomKind || roomKind || "").trim().toLowerCase();

  const isAssignmentThread =
    normalizedRoomKind === "assignment" ||
    String(threadId || "") === "church-live-control";
  const isChurchLiveControlAssignment =
    isAssignmentThread &&
    (
      String((params as any)?.mediaScope || "").toLowerCase() === "church" ||
      String((params as any)?.source || "").toLowerCase().includes("church") ||
      String(threadId || "").toLowerCase().includes("church-live") ||
      String(title || "").toLowerCase().includes("church live control") ||
      String(assignmentTitleParam || "").toLowerCase().includes("church live control")
    );
  const isMediaRoomThread =
    String(threadId || "") === "media-schedule" ||
    String(threadId || "") === "church-media-room" ||
    String(threadId || "").startsWith("media-") ||
    String((params as any)?.source || "").toLowerCase() === "media" ||
    String((params as any)?.roomKind || "").toLowerCase() === "media";

  const isMinistryThread =
    String((params as any)?.roomKind || "") === "assignment"
      ? false
      : String(threadId || "") === "church-live-control"
        ? false
        : isMediaRoomThread
          ? false
          : !isAssignmentThread && (threadId.startsWith("m") || String(params.tab || "") === "ministries");
  const isStructuredRoom = isMinistryThread || isAssignmentThread;
  const routeMinistryId = String((params as any)?.ministryId || "").trim();

  const resolvedMinistryId =
    routeMinistryId ||
    (isMinistryThread ? String(threadId || "").trim() : "");

  const [realMinistry, setRealMinistry] = useState<MinistryApiItem | null>(null);
  const [actionLoading, setActionLoading] = useState<"pause" | "leave" | null>(null);
  const [mcHostsOpen, setMcHostsOpen] = useState(false);
  const [mcHostIds, setMcHostIds] = useState<string[]>([]);

  const [membershipAlive, setMembershipAlive] = useState(true);
  const membershipMissCountRef = useRef(0);
  const membershipEjectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;

    if (membershipEjectTimerRef.current) {
      clearTimeout(membershipEjectTimerRef.current);
      membershipEjectTimerRef.current = null;
    }
    membershipMissCountRef.current = 0;

    async function verifyMembershipLive() {
      try {
        const headers: any = getKristoHeaders();
        const selfId = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();

        const currentMinistryId = String(
          (params as any)?.ministryId ||
          resolvedMinistryId ||
          threadId ||
          ""
        ).trim();

        const authRole = String(headers?.["x-kristo-role"] || effectiveAuthRole || "").toLowerCase();
        const isChurchAuthority =
          authRole.includes("pastor") ||
          authRole.includes("church_admin") ||
          authRole.includes("admin");

        if (!selfId || !currentMinistryId || isChurchLiveControlAssignment || isChurchAuthority) {
          membershipMissCountRef.current = 0;
          if (alive) setMembershipAlive(true);
          return;
        }

        const res: any = await apiGet(
          `/api/church/ministry-members?ministryId=${encodeURIComponent(currentMinistryId)}`,
          { headers }
        );

        if (!res || res.ok === false || !Array.isArray(res?.data)) {
          membershipMissCountRef.current = 0;
          if (alive) setMembershipAlive(true);
          return;
        }

        const rows = res.data;
        const mine = rows.find((x: any) => {
          const possibleIds = [
            String(x?.userId || "").trim(),
            String(x?.id || "").trim(),
            String(x?.memberId || "").trim(),
            String(x?.user?.id || "").trim(),
          ].filter(Boolean);

          return possibleIds.includes(selfId);
        });

        if (mine && alive) {
          membershipMissCountRef.current = 0;
          if (membershipEjectTimerRef.current) {
            clearTimeout(membershipEjectTimerRef.current);
            membershipEjectTimerRef.current = null;
          }
          setMembershipAlive(true);
          return;
        }

        membershipMissCountRef.current += 1;

        if (membershipMissCountRef.current >= 4 && alive) {
          setMembershipAlive(false);
          console.log("KRISTO_MEMBERSHIP_STALE_BLOCKED_NO_EJECT", {
            ministryId: currentMinistryId,
            userId: selfId,
          });
        }
      } catch {
        membershipMissCountRef.current = 0;
        if (alive) setMembershipAlive(true);
      }
    }

    verifyMembershipLive();

    const stop = startAdaptiveLivePolling({
      screen: "MessageThreadMembership",
      enabled: isFocused,
      activeMs: 20000,
      idleMs: 45000,
      onTick: verifyMembershipLive,
    });

    return () => {
      alive = false;
      stop();
      if (membershipEjectTimerRef.current) {
        clearTimeout(membershipEjectTimerRef.current);
        membershipEjectTimerRef.current = null;
      }
    };
  }, [effectiveAuthUserId, effectiveAuthRole, resolvedMinistryId, isChurchLiveControlAssignment, threadId, (params as any)?.ministryId, isFocused]);

  const canEditMinistry =
    isMinistryThread &&
    ["System_Admin", "Church_Admin", "Pastor", "Ministry_Leader", "Leader", "Admin"].includes(
      String(effectiveAuthRole || "")
    );
  const assignmentRoleLower = String(assignmentRole || "member").trim().toLowerCase();
  const isAssignmentTlmc = isAssignmentThread && assignmentRoleLower === "tlmc";
  const isAssignmentLeader = isAssignmentThread && (isPastorAuthority || ["leader", "admin", "pastor", "church_admin"].includes(assignmentRoleLower));

  const canManageAssignmentMembers =
    ["leader", "admin", "pastor", "church_admin"].includes(
      String(assignmentRole || assignmentRoleParam || effectiveAuthRole || "").toLowerCase()
    );
  const canPastorStartChurchLive =
    isChurchLiveControlAssignment &&
    String(effectiveAuthRole || "").toLowerCase() === "pastor";

  const canEditStructuredProfile =
    isMinistryThread
      ? canEditMinistry
      : isAssignmentThread
        ? isAssignmentLeader
        : false;

  const canManageStructuredMembers =
    isMinistryThread
      ? canEditMinistry
      : isAssignmentThread
        ? isAssignmentLeader
        : false;

  const canInviteStructuredMembers =
    isMinistryThread
      ? canEditMinistry
      : isAssignmentThread
        ? isAssignmentLeader
        : false;

  const canOpenTlmcPanel =
    isAssignmentThread
      ? (isAssignmentTlmc || isAssignmentLeader)
      : false;

  const isSelectedMcHost = useMemo(() => {
    if (!isAssignmentThread) return false;

    const headerUserId = String((getKristoHeaders() as any)?.["x-kristo-user-id"] || "").trim();

    const selfIds = [
      headerUserId,
      String(effectiveAuthUserId || ""),
      String((params as any)?.userId || ""),
      String((params as any)?.memberId || ""),
      String((params as any)?.profileId || ""),
    ].filter(Boolean);

    return mcHostIds.some((id) => selfIds.includes(String(id)));
  }, [isAssignmentThread, effectiveAuthUserId, mcHostIds, params]);

  const canScheduleStructuredMeeting =
    __DEV__
      ? true
      : isAssignmentThread
        ? (isAssignmentTlmc || isSelectedMcHost)
        : false;

  const canPauseStructuredRoom =
    isMinistryThread
      ? canEditMinistry
      : isAssignmentThread
        ? isAssignmentLeader
        : false;

  const canRunAssignmentElection =
    isAssignmentThread
      ? (
          isAssignmentTlmc ||
          isAssignmentLeader ||
          effectiveAuthRole === "Church_Admin" ||
          effectiveAuthRole === "Pastor" ||
          effectiveAuthRole === "Leader" ||
          effectiveAuthRole === "Admin" ||
          assignmentRoleParam === "PASTOR" ||
          assignmentRoleParam === "LEADER" ||
          assignmentRoleParam === "ADMIN"
        )
      : false;

  const canSendTargetedAssignmentMessage =
    isAssignmentThread
      ? (isAssignmentTlmc || isAssignmentLeader)
      : false;

  const canManageAssignmentVisibility =
    isAssignmentThread
      ? (isAssignmentTlmc || isAssignmentLeader)
      : false;

  const canOpenAssignmentSchedule =
    isAssignmentThread
      ? (isAssignmentTlmc || isAssignmentLeader)
      : false;

  const showAssignmentLockedPreview =
    isAssignmentThread &&
    !isAssignmentTlmc &&
    !isAssignmentLeader;

  const canOpenAssignmentMembersBoard =
    isAssignmentThread
      ? true
      : false;

  const ministryInfo = useMemo(() => {
    if (isAssignmentThread) {
      const roleLower = String(assignmentRole || "MEMBER").toLowerCase();
      return {
        role:
          roleLower === "pastor"
            ? "pastor"
            : roleLower === "admin" || roleLower === "leader"
              ? "admin"
              : "member",
        status: String(assignmentStatus || "").toLowerCase().includes("suspend")
          ? "suspended"
          : "active",
      };
    }

    const fallback = ministryRoleInfo(threadId);

    if (!isMinistryThread) return fallback;

    const derivedRole =
      effectiveAuthRole === "Church_Admin" ||
      effectiveAuthRole === "Pastor" ||
      effectiveAuthRole === "Leader" ||
      effectiveAuthRole === "Admin"
        ? "leader"
        : fallback.role;

    const derivedStatus =
      String(realMinistry?.status || "").toLowerCase() === "paused"
        ? "suspended"
        : "active";

    return {
      role: derivedRole,
      status: derivedStatus,
    };
  }, [
    isAssignmentThread,
    assignmentRole,
    assignmentStatus,
    threadId,
    isMinistryThread,
    effectiveAuthRole,
    realMinistry,
  ]);

  const currentRole = ministryInfo.role;
  const isSuspended = ministryInfo.status === "suspended";

  useEffect(() => {
    if (!threadId) return;
    ensureThread(threadId, {
      title: isAssignmentThread
        ? String(assignmentTitleParam || title || "Ministry Assignment")
        : isMinistryThread
          ? String(realMinistry?.name || title)
          : title,
      sub: isAssignmentThread
        ? String(assignmentSubtitleParam || sub || "Ministry live & schedule room")
        : isMinistryThread
          ? String(realMinistry?.description || sub)
          : sub,
    });
  }, [threadId, title, sub, isAssignmentThread, assignmentTitleParam, assignmentSubtitleParam, isMinistryThread, realMinistry]);

  const { messages } = useThread(threadId);
  const visibleMessages = useMemo(() => paginateMessages(messages, 120), [messages]);
  const roomMessagesSigRef = useRef("");

  useEffect(() => {
    if (!threadId || !isFocused) return;
    markThreadReadOnce(threadId, () => {});
  }, [threadId, isFocused]);

  useEffect(() => {
    const uris = visibleMessages
      .flatMap((m: any) => [
        String(m?.avatarUri || "").trim(),
        ...(Array.isArray(m?.attachments) ? m.attachments.map((a: any) => String(a?.uri || "")) : []),
      ])
      .filter((u) => /^https?:\/\//i.test(u));
    preloadLiveImages(uris, 24);
  }, [visibleMessages]);

  useEffect(() => {
    if (!threadId || !isFocused) return;

    let alive = true;

    async function loadBackendRoomMessages() {
      const roomId = String((params as any)?.ministryId || (params as any)?.assignmentId || resolvedMinistryId || threadId || "").trim();
      if (!roomId) return;

      const headers: any = getKristoHeaders();
      const selfId = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();

      const res: any = await apiGet(
        `/api/church/room-messages?roomId=${encodeURIComponent(roomId)}&limit=120`,
        { headers },
        { screen: "MessageThread", throttleMs: 12000 }
      );

      const rows = Array.isArray(res?.data) ? res.data : [];
      if (!alive || !Array.isArray(rows)) return;

      const visibleRows = rows.filter((x: any) => {
        const isDraftCard =
          String(x?.kind || "") === "assignment_card" &&
          String(x?.card?.visibility || "published") === "draft";

        // Locked schedule cards are hidden from the chat room for everyone.
        // They remain editable in Schedule, and Publish can show them again.
        return !isDraftCard;
      });

      const mapped: MsgItem[] = visibleRows.map((x: any) => ({
        id: String(x.id || `backend_${x.createdAt || Date.now()}`),
        threadId,
        sender: String(x.senderUserId || "") === selfId ? "me" : "other",
        displayName: String(x.senderName || "Member"),
        role: String(x.senderRole || x.role || ""),
        senderUserId: String(x.senderUserId || ""),
        avatarUri: String(x.senderAvatar || "").startsWith("/")
          ? `${(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "")}${String(x.senderAvatar || "")}`
          : String(x.senderAvatar || ""),
        text: String(x.text || ""),
        attachments: Array.isArray(x.attachments) ? x.attachments : undefined,
        createdAt: Number(x.createdAt || Date.now()),
        kind: String(x.kind || "text") as any,
        card: x.card || undefined,
      }));

      const roomTitle = String(
        isAssignmentThread
          ? ((params as any)?.assignmentTitle || title || "Ministry Assignment")
          : isMinistryThread
            ? (realMinistry?.name || title || "Ministry Room")
            : (title || "Message Room")
      );

      const currentLocalMessages = getSnapshot().messages?.[threadId] || [];
      const localScheduleCards = currentLocalMessages.filter((m: any) =>
        String(m?.kind || "") === "assignment_card" &&
        String((m as any)?.card?.source || "") === "media-schedule"
      );

      const backendIds = new Set(mapped.map((m: any) => String(m.id || "")));
      const safeLocalScheduleCards = localScheduleCards.filter((m: any) => !backendIds.has(String(m.id || "")));
      const merged = [...safeLocalScheduleCards, ...mapped];
      const sig = messagesListSignature(merged);
      if (sig === roomMessagesSigRef.current) return;
      roomMessagesSigRef.current = sig;

      setThreadMessages(threadId, merged, { title: roomTitle, sub: String(sub || "") });
    }

    void loadBackendRoomMessages();

    const stop = startAdaptiveLivePolling({
      screen: "MessageThread",
      enabled: isFocused,
      activeMs: isChurchLiveControlAssignment ? 15000 : 30000,
      idleMs: isChurchLiveControlAssignment ? 45000 : 90000,
      onTick: loadBackendRoomMessages,
    });

    return () => {
      alive = false;
      stop();
    };
  }, [threadId, resolvedMinistryId, effectiveAuthUserId, title, sub, isAssignmentThread, isMinistryThread, isChurchLiveControlAssignment, realMinistry, (params as any)?.ministryId, (params as any)?.assignmentId, isFocused]);

  const listRef = useRef<any>(null);
  const inputRef = useRef<any>(null);

  const [draft, setDraft] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [pending, setPending] = useState<Array<{ id: string; name: string; kind: "image" | "file" }>>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const openedMenuFromParamRef = useRef(false);

  useEffect(() => {
    const shouldOpenMenu =
      String((params as any)?.openMenu || "") === "1" ||
      String((params as any)?.openSettings || "") === "1";

    if (!shouldOpenMenu || openedMenuFromParamRef.current) return;

    openedMenuFromParamRef.current = true;

    console.log("🧭 OPEN_MENU_PARAM_TRIGGERED_ONCE", {
      openMenu: String((params as any)?.openMenu || ""),
      openSettings: String((params as any)?.openSettings || ""),
      avatar: String((params as any)?.avatar || ""),
      id: String((params as any)?.id || ""),
      roomKind: String((params as any)?.roomKind || ""),
    });

    const timer = setTimeout(() => setMenuOpen(true), 350);
    return () => clearTimeout(timer);
  }, [params]);

  useEffect(() => {
  }, [menuOpen, isAssignmentThread, isMinistryThread]);

  const [membersOpen, setMembersOpen] = useState(false);
  const [memberBoardTab, setMemberBoardTab] =
    useState<"members" | "leaders" | "guests">("members");
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [suspendedOpen, setSuspendedOpen] = useState(false);

  const accessChecked = true;
  const accessAllowed = true;

  const headerTitle = useMemo(
    () =>
      isAssignmentThread
        ? String(assignmentTitleParam || title || "Ministry Assignment")
        : isMinistryThread
          ? String(realMinistry?.name || title || "Ministry Room")
          : String(title || "Message Room"),
    [isAssignmentThread, assignmentTitleParam, title, isMinistryThread, realMinistry]
  );

  
const assignmentDisplayTitle = isAssignmentThread
  ? `${headerTitle} • Live`
  : headerTitle;

const displayHeaderTitle = assignmentDisplayTitle;


  const headerAvatarSrc = useMemo(() => {
    return resolveThreadHeaderAvatar({
      session: kristoSession,
      params: params as any,
      realMinistry: realMinistry as any,
      ministryAvatarFallback,
      routeAvatar,
    });
  }, [kristoSession, params, realMinistry, ministryAvatarFallback, routeAvatar]);

  const presence = useMemo(
    () => ({
      online: !isSuspended,
      text: !isSuspended ? "online now" : "paused",
    }),
    [isSuspended]
  );

  const presenceMessages = useMemo(
    () =>
      isAssignmentThread
        ? ["online now", "assignment room active", "team connected"]
        : isMinistryThread
          ? [isSuspended ? "paused" : "online now", `${currentRole} access`, isSuspended ? "ministry paused" : "ministry active"]
          : ["online now", "member connected", "public profile"],
    [isAssignmentThread, isMinistryThread, isSuspended, currentRole]
  );

  const presenceIndex = 0;

  const assignmentLiveBadge = isAssignmentThread && true;

  const livePulse = useRef(new Animated.Value(1)).current;
  const [liveCountdownNow, setLiveCountdownNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveCountdownNow(Date.now());
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  const meetingScheduleKey = String(
    resolvedMinistryId ||
    (params as any)?.assignmentId ||
    threadId ||
    ""
  ).trim();

  const meetingScheduleState = useMemo(
    () => getChurchProjectMcScheduleState(meetingScheduleKey),
    [meetingScheduleKey]
  );

  const assignmentMeetingWindow = useMemo(
    () => getAssignmentMeetingWindow(messages),
    [messages]
  );

  const PRELIVE_TEAM_OPEN_MS = 30 * 60 * 1000;
  const PRELIVE_AUDIENCE_OPEN_MS = 3 * 60 * 1000;

  const liveCta = useMemo(() => {
    const cardsFromMessages = Array.isArray(messages)
      ? messages
          .map((m: any) => m?.card)
          .filter((card: any) => {
            if (!card) return false;
            const slotLabel = String(card?.slotLabel || "").trim();
            const timeLabel = String(card?.timeLabel || "").trim();
            return !!slotLabel || !!timeLabel;
          })
      : [];

    const startMs =
      typeof assignmentMeetingWindow.startMs === "number"
        ? assignmentMeetingWindow.startMs
        : Number(assignmentMeetingWindow.startMs || 0);

    const endMs =
      typeof assignmentMeetingWindow.endMs === "number"
        ? assignmentMeetingWindow.endMs
        : Number(assignmentMeetingWindow.endMs || 0);

    const scheduleStateAny = (meetingScheduleState || {}) as any;
    const scheduleSlots =
      Array.isArray(scheduleStateAny?.slots) ? scheduleStateAny.slots :
      Array.isArray(scheduleStateAny?.items) ? scheduleStateAny.items :
      Array.isArray(scheduleStateAny?.cards) ? scheduleStateAny.cards :
      Array.isArray(scheduleStateAny?.schedule) ? scheduleStateAny.schedule :
      Array.isArray(scheduleStateAny?.scheduleSlots) ? scheduleStateAny.scheduleSlots :
      [];

    const scheduleConfirmed =
      !!scheduleStateAny?.sentToMc ||
      !!scheduleStateAny?.published ||
      !!scheduleStateAny?.publishedAt ||
      !!scheduleStateAny?.sentAt ||
      !!scheduleStateAny?.meetingPlan?.sentToSchedule;

    const hasScheduleFromState =
      scheduleConfirmed &&
      (
        !!scheduleStateAny?.hasSchedule ||
        !!scheduleStateAny?.isScheduled ||
        !!scheduleStateAny?.firstStartAt ||
        !!scheduleStateAny?.startAt ||
        !!scheduleStateAny?.liveStartsAt ||
        scheduleSlots.length > 0
      );

    const hasUsableScheduleCards = cardsFromMessages.length > 0;
    const hasUsableScheduleTime = !!startMs;

    const hasSchedule =
      hasUsableScheduleCards ||
      hasUsableScheduleTime ||
      hasScheduleFromState;

    const now = liveCountdownNow;

    const claimedOrAssignedCards = cardsFromMessages.filter((card: any) => {
      const claimedByName = String(card?.claimedByName || "").trim().toLowerCase();
      const claimedByUserId = String(
        card?.claimedByUserId ||
        card?.claimedUserId ||
        card?.userId ||
        card?.assigneeUserId ||
        card?.assignedUserId ||
        card?.assignedToUserId ||
        ""
      ).trim();

      const assignedNames = [
        card?.assignedToName,
        card?.assigneeName,
        card?.memberName,
        card?.personName,
      ]
        .map((v: any) => String(v || "").trim().toLowerCase())
        .filter(Boolean);

      const assignedIds = [
        card?.assignedToUserId,
        card?.assignedUserId,
        card?.assigneeUserId,
        card?.memberUserId,
        card?.personUserId,
      ]
        .map((v: any) => String(v || "").trim())
        .filter(Boolean);

      return (
        claimedByName === "you" ||
        claimedByUserId === String((getKristoHeaders() as any)?.["x-kristo-user-id"] || "").trim() ||
        assignedNames.includes("you") ||
        assignedIds.includes(String((getKristoHeaders() as any)?.["x-kristo-user-id"] || "").trim())
      );
    });

    const viewerIsLeaderHost =
      !!isAssignmentLeader ||
      !!isAssignmentTlmc ||
      currentRole === "pastor" ||
      currentRole === "admin";

    const viewerCanEnterReadyRoom =
      viewerIsLeaderHost || claimedOrAssignedCards.length > 0;

    const hasAssignmentCards = messages.some((m: any) => String(m?.kind || "") === "assignment_card");
    const hasRealSchedule = !!hasSchedule && hasAssignmentCards;

    const canEnterEarlyReadyRoom =
      !!hasRealSchedule &&
      !!startMs &&
      now < startMs &&
      now >= startMs - PRELIVE_TEAM_OPEN_MS &&
      viewerCanEnterReadyRoom;

    const audienceWaitingOpen =
      !!hasRealSchedule &&
      !!startMs &&
      now < startMs &&
      now >= startMs - PRELIVE_AUDIENCE_OPEN_MS;

    const liveStarted = !!hasRealSchedule && !!startMs && now >= startMs;
    const liveStillActive = liveStarted && (!endMs || now <= endMs);

    const churchScheduleInside3h =
      !!isChurchLiveControlAssignment &&
      !!hasRealSchedule &&
      !!startMs &&
      now < startMs &&
      now >= startMs - 3 * 60 * 60 * 1000;

    const churchScheduleFarAway =
      !!isChurchLiveControlAssignment &&
      !!hasRealSchedule &&
      !!startMs &&
      now < startMs - 3 * 60 * 60 * 1000;

    if (!hasRealSchedule) {
      if (isChurchLiveControlAssignment) {
        return {
          label: "LIVE",
          tone: canPastorStartChurchLive ? "live" as const : "idle" as const,
          sublabel: canPastorStartChurchLive ? "Pastor live ready" : "Pastor only",
          canOpenLive: canPastorStartChurchLive,
          entryMode: canPastorStartChurchLive ? "live" as const : "none" as const,
        };
      }

      return {
        label: "LIVE",
        tone: "idle" as const,
        sublabel: "No schedule",
        canOpenLive: false,
        entryMode: "none" as const,
      };
    }

    if (liveStillActive) {
      return {
        label: "LIVE",
        tone: "live" as const,
        sublabel: "Live now",
        canOpenLive: true,
        entryMode: "live" as const,
      };
    }

    if (churchScheduleFarAway) {
      return {
        label: "LIVE",
        tone: "live" as const,
        sublabel: "Pastor live ready",
        canOpenLive: canPastorStartChurchLive,
        entryMode: "live" as const,
      };
    }

    if (churchScheduleInside3h) {
      return {
        label: "LIVE",
        tone: "scheduled" as const,
        sublabel: "Scheduled live open",
        canOpenLive: true,
        entryMode: "scheduled" as const,
      };
    }

    if (canEnterEarlyReadyRoom) {
      return {
        label: "LIVE",
        tone: "preview" as const,
        sublabel: audienceWaitingOpen ? "Backstage open" : "Ready room open",
        canOpenLive: true,
        entryMode: "backstage" as const,
      };
    }

    if (audienceWaitingOpen) {
      return {
        label: "LIVE",
        tone: "preview" as const,
        sublabel: "Audience waiting open",
        canOpenLive: true,
        entryMode: "waiting" as const,
      };
    }

    return {
      label: "LIVE",
      tone: "scheduled" as const,
      sublabel: "Schedule is ready",
      canOpenLive: false,
      entryMode: "none" as const,
    };
  }, [
    meetingScheduleState,
    assignmentMeetingWindow.startMs,
    assignmentMeetingWindow.endMs,
    liveCountdownNow,
    messages,
    effectiveAuthUserId,
    isAssignmentLeader,
    isAssignmentTlmc,
    currentRole,
    isChurchLiveControlAssignment,
    canPastorStartChurchLive,
  ]);

  const sheetLift = useRef(new Animated.Value(0)).current;
  const sheetScale = useRef(new Animated.Value(1)).current;
  const sheetDepthAnim = useRef(new Animated.Value(1)).current;
  const factCardOpacity = useRef(new Animated.Value(1)).current;
  const factCardTranslate = useRef(new Animated.Value(0)).current;

  const currentFact = useMemo(() => {
    const facts = profileFacts(threadId, headerTitle);
    return facts?.[0] || null;
  }, [threadId, headerTitle]);

  const [realMemberBoardPeople, setRealMemberBoardPeople] = useState<MinistryPerson[]>([]);

  const ministryMembers = useMemo<MinistryPerson[]>(() => {
    return isMinistryThread ? realMemberBoardPeople : [];
  }, [isMinistryThread, realMemberBoardPeople]);

  function openThreadMenu() {
    setMenuOpen(true);
  }

  function closeThreadMenu() {
    setMenuOpen(false);
  }

  function openProfileFromThread() {
    router.push({
      pathname: "/poster-profile" as any,
      params: profileRouteParams(threadId, headerTitle, currentFact, presence) as any,
    });
  }

  function confirmDelete(item: any) {
    Alert.alert("Delete message", "Connect delete flow next.");
  }

  function removePending(id: string) {
    setPending((prev) => prev.filter((x) => x.id !== id));
  }

  function pickImage() {
    const id = `img_${Date.now()}`;
    setPending((prev) => [...prev, { id, name: "image.jpg", kind: "image" }]);
  }

  function pickFile() {
    const id = `file_${Date.now()}`;
    setPending((prev) => [...prev, { id, name: "document.pdf", kind: "file" }]);
  }

  const canSend = useMemo(
    () => String(draft || "").trim().length > 0 || pending.length > 0,
    [draft, pending]
  );

  function onSend() {
    const text = String(draft || "").trim();
    const attachments: MsgAttachment[] = pending.map((a) => ({
      id: a.id,
      kind: a.kind,
      uri: "",
      name: a.name,
      mime: a.kind === "image" ? "image/jpeg" : "application/octet-stream",
    }));

    if (!text && attachments.length === 0) return;

    const roomId = String((params as any)?.ministryId || (params as any)?.assignmentId || resolvedMinistryId || threadId || "").trim();

    sendMessage(threadId, { text, attachments }, { disableAutoReply: true });

    const sendHeaders: any = getKristoHeaders();
    const senderName = String(
      sendHeaders?.["x-kristo-user-name"] ||
      sendHeaders?.["x-kristo-display-name"] ||
      sendHeaders?.["x-kristo-name"] ||
      "Member"
    ).trim();

    apiPost(
      "/api/church/room-messages",
      {
        roomId,
        roomKind: isAssignmentThread ? "assignment" : isMinistryThread ? "ministry" : "chat",
        senderName,
        text,
        attachments,
      },
      { headers: sendHeaders }
    );

    setDraft("");
    setPending([]);

    setTimeout(() => {
      listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 80);
  }

  function openScheduledLiveFromCard(m: MsgItem) {
    const card: any = m.card || {};
    const meta = getAssignmentLiveCountdownMeta(card);
    const now = Date.now();
    const mode =
      meta.active ? "live" :
      meta.valid && now >= meta.startMs - 30 * 60 * 1000 ? "backstage" :
      meta.valid && now >= meta.startMs - 5 * 60 * 1000 ? "waiting" :
      "scheduled";

    if (isChurchLiveControlAssignment && liveAssignmentCtaMeta.tone !== "scheduled" && !canPastorStartChurchLive) {
      Alert.alert("Pastor only", "Only the pastor can start Church Live.");
      return;
    }

    router.push({
      pathname: "/(tabs)/more/my-church-room/messages/live-room" as any,
      params: {
        source: "scheduled-live",
        liveMode: "scheduled",
        layout: "grid6",
        mode,
        entryMode: mode,
        // Do not let ministry scheduled lives fall into church/media control.
        room: String(threadId || "") === "church-media-room" ? "church" : "ministry",
        roomKind: String(threadId || "") === "church-media-room" ? "church-live-control" : "ministry-live",
        mediaScope: String(threadId || "") === "church-media-room" ? "church" : "ministry",
        roomId: String(threadId || resolvedMinistryId || ""),
        sourceRoomId: String(threadId || resolvedMinistryId || ""),
        assignmentId: String(card.cardId || card.id || m.id || ""),
        liveId: String(card.cardId || card.id || m.id || ""),
        title: String(card.title || headerTitle || "Scheduled Live"),
        subtitle: String(card.slotLabel || sub || "Scheduled Live"),
        liveStartMs: String(meta.startMs || ""),
        liveEndMs: String(meta.endMs || ""),
        claimedBy: String(card.claimedByName || ""),

        // Ministry live authority: pastor/ministry owner must not enter as normal viewer.
        role: resolvedLiveRole,
        canPublish: resolvedCanPublish ? "1" : "0",
        canPublishMic: resolvedCanPublish ? "1" : "0",
        canPublishCamera: resolvedCanPublish ? "1" : "0",
        pastorUserId: String(effectiveAuthUserId || ""),
        mediaOwnerPastorUserId: String(effectiveAuthUserId || ""),
        ministryId: String(resolvedMinistryId || threadId || ""),
      },
    });
  }

  async function openAssignmentToolScreen(tool: string) {
    const lockedTools = ["meeting", "schedule"];

    if (lockedTools.includes(String(tool))) {
      const cid = String(auth?.churchId || churchId || "").trim();
      const headers = getKristoHeaders({
        userId: effectiveAuthUserId,
        role: effectiveAuthRole as any,
        churchId: cid,
      }) as Record<string, string>;

      if (!(await requireActiveChurchSubscriptionForSchedule(cid, headers))) {
        return;
      }
    }

    if (isAssignmentThread && lockedTools.includes(String(tool)) && !canScheduleStructuredMeeting) {
      Alert.alert(
        "Access locked",
        "Only assignment leaders or selected MC+ Hosts can open Meeting and Schedule."
      );
      return;
    }

    const isChurchLiveControlTool =
      String(threadId || "") === "church-media-room" ||
      String((params as any)?.source || "") === "media" ||
      String(headerTitle || "").toLowerCase().includes("church live control");

    const targetRoomId = isChurchLiveControlTool
      ? "church-media-room"
      : String(threadId || (params as any)?.assignmentId || resolvedMinistryId || "");

    router.push({
      pathname: "/kingdom/church-project-tool/[assignmentId]/[tool]" as any,
      params: {
        assignmentId: targetRoomId,
        tool,
        title: isChurchLiveControlTool ? "Church Live Control" : headerTitle,
        subtitle: isChurchLiveControlTool ? "Church Media Schedule" : sub,
        source: isChurchLiveControlTool
          ? "church-live-control"
          : (String((params as any)?.source || "").trim() || "my_ministries"),
        mediaScope: isChurchLiveControlTool ? "church" : "ministry",
        roomId: targetRoomId,
        sourceRoomId: targetRoomId,
        role: assignmentRole || "leader",
        status: assignmentStatus || "",
        roomKind: isChurchLiveControlTool
          ? "church-live-control"
          : String((params as any)?.roomKind || "ministry"),
        mcAccess: canScheduleStructuredMeeting ? "1" : "0",
        avatar: routeAvatar || ministryAvatarFallback,
      },
    });
  }

  function onThreadMenuAction(action: string) {
    if (action === "members") {
      closeThreadMenu();
      setMembersOpen(true);
      return;
    }
    if (action === "admins") {
      closeThreadMenu();
      setAdminsOpen(true);
      return;
    }
    if (action === "suspended") {
      closeThreadMenu();
      setSuspendedOpen(true);
      return;
    }
    if (action === "profile") {
      closeThreadMenu();
      openProfileFromThread();
      return;
    }
    if (action === "leave") {
      closeThreadMenu();
      Alert.alert("Leave", isAssignmentThread ? "Leave assignment flow next." : "Quit ministry flow next.");
      return;
    }
    if (action === "meeting") {
      closeThreadMenu();
      openAssignmentToolScreen("meeting");
      return;
    }
    if (action === "schedule") {
      closeThreadMenu();
      openAssignmentToolScreen("schedule");
      return;
    }
    if (action === "mc_plus") {
      if (!canManageMcHosts && !isSelectedMcHost) {
        closeThreadMenu();
        Alert.alert("Access locked", "Only leaders or selected MC+ Hosts can open this card.");
        return;
      }

      closeThreadMenu();
      setMcHostsOpen(true);
      return;
    }
    if (action === "invite") {
      closeThreadMenu();

      if (!canAddMemberAuthority) {
        Alert.alert("Access locked", "Only leaders can add members to this room.");
        return;
      }

      setAddMemberMode("add");
      setSelectedAddMemberId("");
      setSelectedRemoveMemberId("");
      setAddMemberOpen(true);
      return;
    }

    if (action === "tlmc" || action === "election" || action === "targeted" || action === "visibility") {
      return;
    }

    if (action === "edit" || action === "pause" || action === "search" || action === "mute" || action === "block" || action === "report" || action === "clear" || action === "delete") {
      closeThreadMenu();
      Alert.alert("Coming next", `${action} flow will be connected next.`);
      return;
    }
    closeThreadMenu();
  }

  
type LiveAssignmentCtaMeta = {
  tone: "idle" | "scheduled" | "preview" | "live";
  label: string;
  sublabel: string;
  canOpenLive: boolean;
  entryMode: "none" | "backstage" | "waiting" | "live";
};

  const liveAssignmentCtaMeta = useMemo<LiveAssignmentCtaMeta>(() => {
    if (liveCta?.tone === "live") {
      return {
        tone: "live",
        label: "LIVE",
        sublabel: String(liveCta?.sublabel || "Live now"),
        canOpenLive: !!liveCta?.canOpenLive,
        entryMode: "live",
      };
    }

    if (liveCta?.tone === "preview") {
      return {
        tone: "preview",
        label: "LIVE",
        sublabel: String(liveCta?.sublabel || "Ready room open"),
        canOpenLive: !!liveCta?.canOpenLive,
        entryMode: liveCta?.entryMode === "backstage" ? "backstage" : "waiting",
      };
    }

    if (liveCta?.tone === "scheduled") {
      return {
        tone: "scheduled",
        label: "LIVE",
        sublabel: String(liveCta?.sublabel || "Schedule is ready"),
        canOpenLive: !!liveCta?.canOpenLive,
        entryMode: "none",
      };
    }

    return {
      tone: "idle",
      label: "LIVE",
      sublabel: "No schedule",
      canOpenLive: false,
      entryMode: "none",
    };
  }, [liveCta]);

const canViewerClaimAssignmentCard = useMemo(() => {
    if (!isAssignmentThread || isSuspended) return false;
    return !isAssignmentTlmc && !isAssignmentLeader;
  }, [isAssignmentThread, isSuspended, isAssignmentTlmc, isAssignmentLeader]);

  const canViewerAddToAssignmentCard = useMemo(() => {
    if (!isAssignmentThread || isSuspended) return false;
    return isAssignmentTlmc || isAssignmentLeader;
  }, [isAssignmentThread, isSuspended, isAssignmentTlmc, isAssignmentLeader]);

  const canViewerAddMusicAssignmentCard = useMemo(() => {
    if (isSuspended) return false;
    return currentRole === "admin" || currentRole === "pastor";
  }, [currentRole, isSuspended]);

  const [assignmentVideoDraft, setAssignmentVideoDraft] = useState<AssignmentVideoDraft>({
    visible: false,
    messageId: "",
    assignmentDurationMin: 0,
    clips: [],
    activeClipId: "",
    loopToFill: false,
    previewSec: 0,
    isPlaying: false,
    playbackRate: 1,
  } as any);

  const scrollRef = useRef(null);
  const assignmentVideoRef = useRef<VideoPlayer | null>(null);

  const activeAssignmentClip = useMemo(() => {
    return assignmentVideoDraft.clips.find((clip) => clip.id === assignmentVideoDraft.activeClipId) || null;
  }, [assignmentVideoDraft.clips, assignmentVideoDraft.activeClipId]);

  const assignmentVideoPlayer = useVideoPlayer(
    activeAssignmentClip?.uri ? { uri: activeAssignmentClip.uri } : null,
    (player) => {
      player.loop = !!assignmentVideoDraft.loopToFill;
      player.timeUpdateEventInterval = 0.1;
      player.playbackRate = getClipPlaybackRate(assignmentVideoDraft, activeAssignmentClip);
      player.currentTime = Number(activeAssignmentClip?.trimStartSec || 0);
      assignmentVideoRef.current = player;
    }
  );

  useEffect(() => {
    assignmentVideoRef.current = assignmentVideoPlayer || null;
  }, [assignmentVideoPlayer]);

  useEffect(() => {
    if (!assignmentVideoPlayer) return;
    assignmentVideoPlayer.loop = !!assignmentVideoDraft.loopToFill;
    assignmentVideoPlayer.playbackRate = getClipPlaybackRate(
      assignmentVideoDraft,
      activeAssignmentClip
    );
  }, [
    assignmentVideoPlayer,
    assignmentVideoDraft.loopToFill,
    assignmentVideoDraft.playbackRate,
    activeAssignmentClip?.id,
  ]);

  const TIMELINE_WIDTH = 320;
  const timelineDurationSec = Math.max(1, Number(activeAssignmentClip?.sourceDurationSec || 1));

  function secToTimelineX(sec: number) {
    return (Math.max(0, Math.min(timelineDurationSec, sec)) / timelineDurationSec) * TIMELINE_WIDTH;
  }

  function timelineXToSec(x: number) {
    return (Math.max(0, Math.min(TIMELINE_WIDTH, x)) / TIMELINE_WIDTH) * timelineDurationSec;
  }

  function seekAssignmentTimelineByRatio(ratio: number) {
    const clip = activeAssignmentClip;
    if (!clip) return;
    const rawSec = timelineDurationSec * Math.max(0, Math.min(1, ratio));
    const nextSec = clamp(rawSec, clip.trimStartSec, clip.trimEndSec);
    seekAssignmentVideoTo(nextSec);
  }

  function shouldIgnoreTimelineSeekTouch(x: number) {
    const clip = activeAssignmentClip;
    if (!clip) return false;

    const startX = secToTimelineX(clip.trimStartSec);
    const endX = secToTimelineX(clip.trimEndSec);
    const HANDLE_HIT_SLOP = 32;

    const touchingStartHandle = Math.abs(x - startX) <= HANDLE_HIT_SLOP;
    const touchingEndHandle = Math.abs(x - endX) <= HANDLE_HIT_SLOP;

    return touchingStartHandle || touchingEndHandle;
  }


  const [trimStartInput, setTrimStartInput] = useState("0");
  const [trimEndInput, setTrimEndInput] = useState("0");
  const [trimPickMode, setTrimPickMode] = useState<null | "start" | "end">(null);
  const [trimTrackWidth, setTrimTrackWidth] = useState(0);
  const [trimDragKind, setTrimDragKind] = useState<null | "start" | "end">(null);

  useEffect(() => {
    setTrimStartInput(String(Math.round(activeAssignmentClip?.trimStartSec || 0)));
    setTrimEndInput(String(Math.round(activeAssignmentClip?.trimEndSec || 0)));
  }, [activeAssignmentClip?.id, activeAssignmentClip?.trimStartSec, activeAssignmentClip?.trimEndSec]);

  const [activeEditorTool, setActiveEditorTool] = useState<"edit" | "sound" | "text" | "effects">("edit");

  const [editorSubPanelOpen, setEditorSubPanelOpen] = useState(false);
  const [activeEditAction, setActiveEditAction] = useState<null | "crop" | "split" | "replace" | "delete" | "speed" | "auto">(null);
  const splitScrollRef = useRef<ScrollView | null>(null);
  const splitTickWidth = 52;
  const splitTickCount = Math.max(
    2,
    Math.floor(Number(activeAssignmentClip?.sourceDurationSec || 0)) + 1
  );
  const splitStripWidth = Math.max(1, (splitTickCount - 1) * splitTickWidth);
  const [splitViewportWidth, setSplitViewportWidth] = useState(1);
  const splitSideInset = Math.max(0, splitViewportWidth / 2 - splitTickWidth / 2);
  const splitEdgeInset = Math.max(0, splitViewportWidth / 2 - splitTickWidth / 2);
  const [splitSelectionStartSec, setSplitSelectionStartSec] = useState<number | null>(null);
  const splitBlinkAnim = useRef(new Animated.Value(1)).current;
  const splitLastSeekMsRef = useRef(0);

  useEffect(() => {
    if (splitSelectionStartSec == null) {
      splitBlinkAnim.stopAnimation();
      splitBlinkAnim.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(splitBlinkAnim, {
          toValue: 0.25,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(splitBlinkAnim, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
      splitBlinkAnim.setValue(1);
    };
  }, [splitSelectionStartSec, splitBlinkAnim]);
  const [splitRailWidth, setSplitRailWidth] = useState(1);
  const trimDragStartPercentRef = useRef(0);
  const trimDragHandleRef = useRef<"left" | "right" | null>(null);

  const TRIM_HANDLE_TOUCH_SLOP = 28;

  function getNearestTrimHandleByX(x: number): "left" | "right" {
    const width = Math.max(1, splitRailWidth || 1);
    const percents = getTrimHandlePercents();
    const leftX = percents.startPercent * width;
    const rightX = percents.endPercent * width;

    const distLeft = Math.abs(x - leftX);
    const distRight = Math.abs(x - rightX);

    if (distLeft <= TRIM_HANDLE_TOUCH_SLOP && distLeft <= distRight) return "left";
    if (distRight <= TRIM_HANDLE_TOUCH_SLOP) return "right";

    return distLeft <= distRight ? "left" : "right";
  }

  const [activeTrimHandle, setActiveTrimHandle] = useState<"left" | "right" | null>(null);

  const splitRailPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const x = Number(e.nativeEvent.locationX || 0);
      const percent = splitRailWidth > 0 ? x / splitRailWidth : 0;
      const { startPercent, endPercent } = getTrimHandlePercents();

      const leftX = startPercent * splitRailWidth;
      const rightX = endPercent * splitRailWidth;
      const touchRadius = 24;

      if (Math.abs(x - leftX) <= touchRadius) {
        setActiveTrimHandle("left");
        updateTrimHandleByPercent("left", percent);
        return;
      }

      if (Math.abs(x - rightX) <= touchRadius) {
        setActiveTrimHandle("right");
        updateTrimHandleByPercent("right", percent);
        return;
      }

      setActiveTrimHandle(null);
      scrubSplitPreviewByOffset(
        splitPercentToSec(percent, Number(activeAssignmentClip?.sourceDurationSec || 0))
      );
    },
    onPanResponderMove: (e) => {
      const x = Number(e.nativeEvent.locationX || 0);
      const percent = splitRailWidth > 0 ? x / splitRailWidth : 0;

      if (activeTrimHandle === "left") {
        updateTrimHandleByPercent("left", percent);
        return;
      }

      if (activeTrimHandle === "right") {
        updateTrimHandleByPercent("right", percent);
        return;
      }

      scrubSplitPreviewByOffset(
        splitPercentToSec(percent, Number(activeAssignmentClip?.sourceDurationSec || 0))
      );
    },
    onPanResponderRelease: (e) => {
      const x = Number(e.nativeEvent.locationX || 0);
      const percent = splitRailWidth > 0 ? x / splitRailWidth : 0;

      if (activeTrimHandle === "left") {
        updateTrimHandleByPercent("left", percent);
      } else if (activeTrimHandle === "right") {
        updateTrimHandleByPercent("right", percent);
      } else {
        snapSplitPreviewToNearest(
          splitPercentToSec(percent, Number(activeAssignmentClip?.sourceDurationSec || 0))
        );
      }

      setActiveTrimHandle(null);
    },
  });

  const [cropRatioPreset, setCropRatioPreset] = useState<"9:16" | "1:1" | "16:9" | "3:4" | "4:3" | "free">("9:16");
  const [speedPanelOpen, setSpeedPanelOpen] = useState(false);
  const [clipsVisible, setClipsVisible] = useState(true);

  function openEditorTool(tool: "edit" | "sound" | "text" | "effects") {
    setActiveEditorTool(tool);
    if (tool === "edit") {
      setEditorSubPanelOpen(true);
      return;
    }
    setEditorSubPanelOpen(false);
    setActiveEditAction(null);
    setSpeedPanelOpen(false);
    Alert.alert("Coming next", `${tool} tools will be connected next.`);
  }

  async function applyCropPreset(mode: "fit" | "fill") {
    if (!assignmentVideoRef.current) return;
    setActiveEditAction("crop");
    setSpeedPanelOpen(false);
    Alert.alert(
      "Crop mode",
      mode === "fill"
        ? "Preview switched to fill-style view like short-video apps."
        : "Preview switched to fit-style view so full media is visible."
    );
  }

  async function splitCurrentClip() {
    const clip = activeAssignmentClip;
    if (!clip) return;

    setActiveEditAction("split");
    setSpeedPanelOpen(false);

    const splitAt = clamp(
      assignmentVideoDraft.previewSec || clip.trimStartSec,
      clip.trimStartSec + 0.1,
      clip.trimEndSec - 0.1
    );

    const leftDuration = splitAt - clip.trimStartSec;
    const rightDuration = clip.trimEndSec - splitAt;

    if (leftDuration <= 0.08 || rightDuration <= 0.08) {
      Alert.alert("Split unavailable", "Move the playhead away from the edge, then try split again.");
      return;
    }

    const leftClip = {
      ...clip,
      id: `${clip.id}-a-${Date.now()}`,
      title: clip.title,
      trimStartSec: clip.trimStartSec,
      trimEndSec: splitAt,
    };

    const rightClip = {
      ...clip,
      id: `${clip.id}-b-${Date.now()}`,
      title: clip.title,
      trimStartSec: splitAt,
      trimEndSec: clip.trimEndSec,
    };

    const currentIndex = assignmentVideoDraft.clips.findIndex((c) => c.id === clip.id);
    if (currentIndex < 0) return;

    const nextClips = [...assignmentVideoDraft.clips];
    nextClips.splice(currentIndex, 1, leftClip, rightClip);

    setAssignmentVideoDraft((prev) => ({
      ...prev,
      clips: nextClips,
      activeClipId: rightClip.id,
      previewSec: rightClip.trimStartSec,
      isPlaying: false,
    }));

    try {
      if (assignmentVideoRef.current) {
        assignmentVideoRef.current.pause();
        assignmentVideoRef.current.currentTime = rightClip.trimStartSec;
      }
    } catch {}
  }

  useEffect(() => {
    if (!assignmentVideoDraft.visible) {
      setAssignmentVideoDraft((prev) => ({
        ...prev,
        isPlaying: false,
        previewSec: 0,
      }));
    }
  }, [assignmentVideoDraft.visible]);

  useEffect(() => {
    if (!assignmentVideoDraft.visible || !activeAssignmentClip) return;
    setAssignmentVideoDraft((prev) => ({
      ...prev,
      previewSec: clamp(prev.previewSec, activeAssignmentClip.trimStartSec, activeAssignmentClip.trimEndSec),
      isPlaying: false,
    }));
  }, [assignmentVideoDraft.visible, activeAssignmentClip?.id]);

  async function syncPreviewTo(sec: number) {
    const clip = activeAssignmentClip;
    if (!clip) return;
    const nextSec = clamp(sec, clip.trimStartSec, clip.trimEndSec);
    setAssignmentVideoDraft((prev) => ({
      ...prev,
      previewSec: nextSec,
    }));
    if (clip.uri && assignmentVideoRef.current) {
      try {
        assignmentVideoRef.current.currentTime = nextSec;
      } catch {}
    }
  }
  async function splitActiveAssignmentClip() {
    const clip = activeAssignmentClip;
    if (!clip) return;

    const rawSec = assignmentVideoDraft.previewSec || clip.trimStartSec;
    const splitSec = Math.max(
      clip.trimStartSec + 0.25,
      Math.min(rawSec, clip.trimEndSec - 0.25)
    );

    if (splitSec <= clip.trimStartSec || splitSec >= clip.trimEndSec) return;

    const leftClip = {
      ...clip,
      id: `${clip.id}-left-${Date.now()}`,
      trimEndSec: splitSec,
    };

    const rightClip = {
      ...clip,
      id: `${clip.id}-right-${Date.now()}`,
      trimStartSec: splitSec,
    };

    const currentIndex = assignmentVideoDraft.clips.findIndex((c) => c.id === clip.id);
    if (currentIndex === -1) return;

    const nextClips = [...assignmentVideoDraft.clips];
    nextClips.splice(currentIndex, 1, leftClip, rightClip);

    setAssignmentVideoDraft((prev) => ({
      ...prev,
      clips: nextClips,
      activeClipId: rightClip.id,
      previewSec: rightClip.trimStartSec,
      isPlaying: false,
    }));

    if (assignmentVideoRef.current) {
      try {
        assignmentVideoRef.current.pause();
        assignmentVideoRef.current.currentTime = rightClip.trimStartSec;
      } catch {}
    }
  }

  

  function cropRatioValue(preset: "9:16" | "1:1" | "16:9" | "3:4" | "4:3" | "free") {
    if (preset === "9:16") return 9 / 16;
    if (preset === "1:1") return 1;
    if (preset === "16:9") return 16 / 9;
    if (preset === "3:4") return 3 / 4;
    if (preset === "4:3") return 4 / 3;
    return undefined;
  }

  function resetCropPreset() {
    setCropRatioPreset("9:16");
  }

  function runAssignmentAutoFlow() {
    const nextClips = applyAutoFlowToClips(assignmentVideoDraft.clips);
    const firstClip = nextClips[0];
    const nextRate = (firstClip as any)?.playbackRate || 1;

    setAssignmentVideoDraft((prev: any) => ({
      ...prev,
      clips: nextClips,
      activeClipId: firstClip?.id || prev.activeClipId,
      previewSec: firstClip?.trimStartSec || prev.previewSec,
      playbackRate: nextRate,
      isPlaying: false,
    }));

    if (assignmentVideoRef.current && firstClip) {
      assignmentVideoRef.current.pause();
      assignmentVideoRef.current.currentTime = (((firstClip.trimStartSec || 0) / 1000) * 1000);
      assignmentVideoRef.current.playbackRate = nextRate;
    }
  }

  async function onPressEditorAction(action: "crop" | "split" | "replace" | "delete" | "speed" | "auto") {
    setEditorSubPanelOpen(true);

    if (action === "crop") {
      setSpeedPanelOpen(false);
      setActiveEditAction("crop");
      return;
    }

    if (action === "auto") {
      setSpeedPanelOpen(false);
      setActiveEditAction("auto");
      runAssignmentAutoFlow();
      setTimeout(() => {
        setEditorSubPanelOpen(false);
        setActiveEditAction(null);
      }, 450);
      return;
    }

    if (action === "speed") {
      setActiveEditAction("speed");
      setSpeedPanelOpen(true);
      return;
    }

    setSpeedPanelOpen(false);
    setActiveEditAction(action);

    if (action === "split") {
      await splitActiveAssignmentClip();
      return;
    }

    if (action === "delete") {
      removeActiveAssignmentClip();
      return;
    }

    if (action === "replace") {
      appendPhoneClipToAssignmentDraft();
      return;
    }
  }

function formatSplitRealSec(sec: number) {
  const safe = Math.max(0, Number(sec || 0));
  return formatDurationLabel(Math.round(safe));
}

function getCurrentSplitSec() {
  const maxSec = Number(activeAssignmentClip?.sourceDurationSec || 0);
  const raw = Number((assignmentVideoDraft as any).previewSec || 0);
  return Math.max(0, Math.min(maxSec, raw));
}

function getSplitMomentTone() {
  const sec = getCurrentSplitSec();
  const halfStep = Math.round(sec * 2);

  if (halfStep % 9 === 0 && sec > 0) {
    return { label: "Golden moment", strong: true, golden: true };
  }

  if (halfStep % 5 === 0 && sec > 0) {
    return { label: "Strong cut", strong: false, golden: true };
  }

  return { label: "Soft cut", strong: false, golden: false };
}

function getSplitPreviewStats() {
  const full = Number(activeAssignmentClip?.sourceDurationSec || 0);
  const cut = Math.max(0, Math.min(full, getCurrentSplitSec()));

  return {
    leftSec: cut,
    rightSec: Math.max(0, full - cut),
    fullSec: full,
  };
}

function formatSplitRulerLabel(sec: number) {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildSplitRulerTicks() {
  const full = Math.max(1, Number(activeAssignmentClip?.sourceDurationSec || 0));
  const ticks = [];
  for (let sec = 0; sec <= full; sec += 1) {
    const major = sec % 5 === 0;
    const medium = !major && sec % 2 === 0;
    ticks.push({
      sec,
      major,
      medium,
      label: major ? formatSplitRulerLabel(sec) : "",
    });
  }
  return ticks;
}

function getSplitPreviewPercent() {
  const full = Math.max(1, Number(activeAssignmentClip?.sourceDurationSec || 0));
  return Math.max(0, Math.min(1, getCurrentSplitSec() / full));
}

function getSplitLockedRange() {
  const full = Math.max(1, Number(activeAssignmentClip?.sourceDurationSec || 0));
  if (splitSelectionStartSec == null) return null;

  const startSec = Math.max(0, Math.min(full, Number(splitSelectionStartSec || 0)));
  const currentSec = Math.max(0, Math.min(full, Number(getCurrentSplitSec() || 0)));

  const fromSec = Math.min(startSec, currentSec);
  const toSec = Math.max(startSec, currentSec);

  return {
    startPercent: (startSec / full) * 100,
    currentPercent: (currentSec / full) * 100,
    leftPercent: (fromSec / full) * 100,
    widthPercent: ((toSec - fromSec) / full) * 100,
  };
}

function getTrimHandlePercents() {
  const clip = activeAssignmentClip;
  const full = Math.max(1, Number(clip?.sourceDurationSec || 0));
  const start = Math.max(0, Math.min(full, Number(clip?.trimStartSec || 0)));
  const end = Math.max(start, Math.min(full, Number(clip?.trimEndSec || full)));
  return {
    startPercent: start / full,
    endPercent: end / full,
  };
}

function updateTrimHandleByPercent(handle: "left" | "right", percent: number) {
  const clip = activeAssignmentClip;
  if (!clip) return;

  const full = Math.max(1, Number(clip.sourceDurationSec || 0));
  const rawSec = splitPercentToSec(percent, full);
  const minGap = 1;

  let nextStart = Math.max(0, Number(clip.trimStartSec || 0));
  let nextEnd = Math.max(nextStart + minGap, Number(clip.trimEndSec || full));

  if (handle === "left") {
    nextStart = Math.max(0, Math.min(nextEnd - minGap, rawSec));
  } else {
    nextEnd = Math.min(full, Math.max(nextStart + minGap, rawSec));
  }

  setAssignmentVideoDraft((prev: any) => {
    const nextClips = (prev.clips || []).map((c: any) =>
      c.id === clip.id
        ? {
            ...c,
            trimStartSec: nextStart,
            trimEndSec: nextEnd,
          }
        : c
    );

    const nextPreview = Math.max(
      nextStart,
      Math.min(nextEnd, Number(prev.previewSec || nextStart))
    );

    return {
      ...prev,
      clips: nextClips,
      previewSec: nextPreview,
    };
  });

  if (assignmentVideoRef.current) {
    const seekSec = handle === "left" ? nextStart : nextEnd;
    assignmentVideoRef.current.currentTime = (seekSec );
  }
}

function splitPercentToSec(percent: number, full: number) {
  const safeFull = Math.max(1, Number(full || 0));
  const safePercent = Math.max(0, Math.min(1, Number(percent || 0)));
  return safePercent * safeFull;
}

function syncSplitStripToPreview(sec?: number) {
  const clip = activeAssignmentClip;
  if (!clip || !splitScrollRef.current) return;

  const maxSec = Number(clip.sourceDurationSec || 0);
  if (maxSec <= 0) return;

  const targetSec = Math.max(
    0,
    Math.min(maxSec, Number(sec ?? ((assignmentVideoDraft as any).previewSec || 0)))
  );
  const targetX = (targetSec / maxSec) * splitStripWidth;

  splitScrollRef.current.scrollTo({ x: targetX, animated: true });
}

function scrubSplitPreviewByOffset(offsetX: number) {
  const clip = activeAssignmentClip;
  if (!clip) return;

  const maxSec = Number(clip.sourceDurationSec || 0);
  if (maxSec <= 0) return;

  const safeX = Math.max(0, Math.min(splitStripWidth, offsetX));
  const rawSec = (safeX / Math.max(1, splitStripWidth)) * maxSec;
  const nextSec = Math.max(0, Math.min(maxSec, rawSec));

  setAssignmentVideoDraft((prev: any) => ({
    ...prev,
    previewSec: nextSec,
  }));

  const now = Date.now();
  if (assignmentVideoRef.current && now - splitLastSeekMsRef.current > 40) {
    splitLastSeekMsRef.current = now;
    assignmentVideoRef.current.currentTime = (nextSec );
  }
}

function snapSplitPreviewToNearest(offsetX: number) {
  const clip = activeAssignmentClip;
  if (!clip || !splitScrollRef.current) return;

  const maxSec = Number(clip.sourceDurationSec || 0);
  if (maxSec <= 0) return;

  const safeX = Math.max(0, Math.min(splitStripWidth, offsetX));
  const rawSec = (safeX / Math.max(1, splitStripWidth)) * maxSec;
  const targetSec = Math.max(0, Math.min(maxSec, Math.round(rawSec)));
  const targetX = (targetSec / maxSec) * splitStripWidth;

  setAssignmentVideoDraft((prev: any) => ({
    ...prev,
    previewSec: targetSec,
  }));

  splitScrollRef.current.scrollTo({ x: targetX, animated: true });
  if (assignmentVideoRef.current) assignmentVideoRef.current.currentTime = targetSec;
}

function applySplitAtCurrentTime() {
  const activeId = (assignmentVideoDraft as any).activeClipId || activeAssignmentClip?.id;
  const currentClip =
    ((assignmentVideoDraft as any).clips || []).find((c: any) => c?.id === activeId) || activeAssignmentClip;

  if (!currentClip) return;

  const maxSec = Number(currentClip.sourceDurationSec || 0);
  const currentSec = Math.max(0, Math.min(maxSec, getCurrentSplitSec()));

  // tap ya kwanza => start
  if (splitSelectionStartSec == null) {
    setSplitSelectionStartSec(currentSec);
    return;
  }

  // tap ya pili => end + keep selected piece only
  const startSec = Math.max(0, Math.min(splitSelectionStartSec, currentSec));
  const endSec = Math.max(splitSelectionStartSec, currentSec);

  if (endSec - startSec < 0.2) {
    setSplitSelectionStartSec(null);
    return;
  }

  const nextClip = {
    ...currentClip,
    id: `${currentClip.id || 'clip'}-segment-${Date.now()}`,
    startSec,
    endSec,
    sourceDurationSec: endSec - startSec,
    title: `${currentClip.title || 'Clip'} (${formatDurationLabel(startSec)} - ${formatDurationLabel(endSec)})`,
  };

  setAssignmentVideoDraft((prev: any) => ({
    ...prev,
    clips: [nextClip],
    activeClipId: nextClip.id,
    previewSec: 0,
    trimStartSec: 0,
    trimEndSec: endSec - startSec,
  }));

  setSplitSelectionStartSec(null);

  requestAnimationFrame(() => {
    syncSplitStripToPreview(0);
    if (assignmentVideoRef.current) assignmentVideoRef.current.currentTime = startSec;
  });
}

function setPreviewSpeed(nextSpeed: number) {
    setAssignmentVideoDraft((prev: any) => ({
      ...prev,
      playbackRate: nextSpeed,
      clips: prev.clips.map((clip: any) =>
        clip.id === prev.activeClipId ? { ...clip, playbackRate: nextSpeed } : clip
      ),
    }));

    if (assignmentVideoRef.current) {
      assignmentVideoRef.current.playbackRate = nextSpeed;
    }
  }

async function toggleAssignmentPreviewPlayback() {
    const clip = activeAssignmentClip;
    if (!clip) return;

    if (!clip.uri) {
      Alert.alert("Preview unavailable", "This ministry clip has no local video file yet, but trim and save still work.");
      return;
    }

    try {
      if (!assignmentVideoRef.current) return;

      if (assignmentVideoDraft.isPlaying) {
        assignmentVideoRef.current.pause();
        setAssignmentVideoDraft((prev) => ({ ...prev, isPlaying: false }));
        return;
      }

      const safeStart = clamp(
        assignmentVideoDraft.previewSec || clip.trimStartSec,
        clip.trimStartSec,
        Math.max(clip.trimStartSec, clip.trimEndSec - 0.05)
      );

      assignmentVideoRef.current.currentTime = safeStart;
      assignmentVideoRef.current.playbackRate = getClipPlaybackRate(assignmentVideoDraft, clip);
      assignmentVideoRef.current.play();
      setAssignmentVideoDraft((prev) => ({ ...prev, isPlaying: true }));
    } catch {
      Alert.alert("Playback error", "Failed to start video preview.");
    }
  }

  function openAssignmentVideoEditor(args: {
    messageId: string;
    sourceType: "phone" | "ministry";
    title: string;
    uri?: string;
    sourceDurationSec?: number;
  }) {
    const targetMsg = messages.find((x) => x.id === args.messageId);
    const durationMin = Math.max(1, Number(targetMsg?.card?.durationMin || 1));
    const firstClip = makeAssignmentVideoClip(args);

    setAssignmentVideoDraft({
      visible: true,
      messageId: args.messageId,
      assignmentDurationMin: durationMin,
      clips: [firstClip],
      activeClipId: firstClip.id,
      loopToFill: false,
      previewSec: firstClip.trimStartSec,
      isPlaying: false,
      playbackRate: 1,
    });
    setClipsVisible(true);
    setClipsVisible(true);
  }

  function closeAssignmentVideoEditor() {
    setAssignmentVideoDraft({
      visible: false,
      messageId: "",
      assignmentDurationMin: 0,
      clips: [],
      activeClipId: "",
      loopToFill: false,
      previewSec: 0,
      isPlaying: false,
      playbackRate: 1,
    });
  }

  function selectAssignmentClip(clipId: string) {
    const clip = assignmentVideoDraft.clips.find((x) => x.id === clipId);
    if (!clip) return;

    setAssignmentVideoDraft((prev: any) => ({
      ...prev,
      activeClipId: clipId,
      previewSec: clip.trimStartSec,
      playbackRate: (clip as any).playbackRate || prev.playbackRate || 1,
      isPlaying: false,
    }));

    if (assignmentVideoRef.current) {
      assignmentVideoRef.current.pause();
      assignmentVideoRef.current.currentTime = (clip.trimStartSec );
      assignmentVideoRef.current.playbackRate = (clip as any).playbackRate || 1;
    }
  }

  function updateActiveAssignmentClip(patch: Partial<AssignmentVideoClip>) {
    setAssignmentVideoDraft((prev) => ({
      ...prev,
      clips: prev.clips.map((clip) =>
        clip.id === prev.activeClipId ? { ...clip, ...patch } : clip
      ),
    }));
  }

  function setAssignmentTrimBoundary(kind: "start" | "end", nextValueSec: number) {
    const clip = activeAssignmentClip;
    if (!clip) return;

    const maxSec = Math.max(1, clip.sourceDurationSec);

    if (kind === "start") {
      const nextStart = clamp(nextValueSec, 0, Math.max(0, clip.trimEndSec - 1));
      updateActiveAssignmentClip({ trimStartSec: nextStart });
      setAssignmentVideoDraft((prev) => ({
        ...prev,
        previewSec: clamp(prev.previewSec, nextStart, clip.trimEndSec),
      }));
      return;
    }

    const nextEnd = clamp(nextValueSec, Math.min(maxSec, clip.trimStartSec + 1), maxSec);
    updateActiveAssignmentClip({ trimEndSec: nextEnd });
    setAssignmentVideoDraft((prev) => ({
      ...prev,
      previewSec: clamp(prev.previewSec, clip.trimStartSec, nextEnd),
    }));
  }

  function adjustAssignmentTrimBoundary(kind: "start" | "end", deltaSec: number) {
    const clip = activeAssignmentClip;
    if (!clip) return;

    const current = kind === "start" ? Number(clip.trimStartSec || 0) : Number(clip.trimEndSec || 0);
    setAssignmentTrimBoundary(kind, current + deltaSec);
  }

  function toggleAssignmentTopPreviewPlayback() {
    toggleAssignmentPreviewPlayback();
  }

  function addAssignmentClipFromEditor() {
    Alert.alert(
      "Add video",
      "Choose where to add the next clip from.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Phone video",
          onPress: () => {
            appendPhoneClipToAssignmentDraft();
          },
        },
        {
          text: "Ministry video",
          onPress: () => {
            appendMinistryClipToAssignmentDraft();
          },
        },
      ]
    );
  }

  
  function applyCurrentPreviewToTrimPick(kind: "start" | "end") {
    const sec = Math.max(
      0,
      Math.min(
        Math.round(assignmentVideoDraft.previewSec || 0),
        Math.round(activeAssignmentClip?.sourceDurationSec || 0),
      ),
    );

    setAssignmentTrimBoundary(kind, sec);

    if (kind === "start") {
      setTrimStartInput(String(sec));
      setTrimPickMode("end");
    } else {
      setTrimEndInput(String(sec));
      setTrimPickMode(null);
    }
  }

  
  function updateTrimBoundaryFromTrackX(kind: "start" | "end", x: number) {
    const duration = Math.max(0, Math.round(activeAssignmentClip?.sourceDurationSec || 0));
    if (!duration || trimTrackWidth <= 0) return;

    const clampedX = Math.max(0, Math.min(trimTrackWidth, x));
    const sec = Math.max(0, Math.min(duration, Math.round((clampedX / trimTrackWidth) * duration)));

    setAssignmentTrimBoundary(kind, sec);

    if (kind === "start") {
      setTrimStartInput(String(sec));
    } else {
      setTrimEndInput(String(sec));
    }
  }

  function onTrimTrackGrant(x: number) {
    const duration = Math.max(0, Math.round(activeAssignmentClip?.sourceDurationSec || 0));
    if (!duration || trimTrackWidth <= 0) return;

    const startSec = Math.max(0, Math.round(activeAssignmentClip?.trimStartSec || 0));
    const endSec = Math.max(0, Math.round(activeAssignmentClip?.trimEndSec || 0));

    const startX = (startSec / duration) * trimTrackWidth;
    const endX = (endSec / duration) * trimTrackWidth;

    const kind = Math.abs(x - startX) <= Math.abs(x - endX) ? "start" : "end";
    setTrimDragKind(kind);
    setTrimPickMode(kind);
    updateTrimBoundaryFromTrackX(kind, x);
  }

  function onTrimTrackMove(x: number) {
    if (!trimDragKind) return;
    updateTrimBoundaryFromTrackX(trimDragKind, x);
  }

  function onTrimTrackRelease() {
    setTrimDragKind(null);
  }

function startSplitPickMode() {
    setTrimPickMode("start");
  }

function deleteActiveAssignmentClipFromEditor() {
    removeActiveAssignmentClip();
  }

  function applyTypedTrimValue(kind: "start" | "end", rawValue: string) {
    const clip = activeAssignmentClip;
    if (!clip) return;

    const parsed = Number(String(rawValue).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(parsed)) {
      if (kind === "start") setTrimStartInput(String(Math.round(clip.trimStartSec)));
      else setTrimEndInput(String(Math.round(clip.trimEndSec)));
      return;
    }

    setAssignmentTrimBoundary(kind, parsed);

    const nextClip = activeAssignmentClip;
    if (nextClip) {
      if (kind === "start") setTrimStartInput(String(Math.round(Math.max(0, parsed))));
      else setTrimEndInput(String(Math.round(Math.max(0, parsed))));
    }
  }

  function shiftAssignmentVideoTrim(kind: "start" | "end", deltaSec: number) {
    const clip = activeAssignmentClip;
    if (!clip) return;
    if (kind === "start") {
      setAssignmentTrimBoundary("start", clip.trimStartSec + deltaSec);
      return;
    }
    setAssignmentTrimBoundary("end", clip.trimEndSec + deltaSec);
  }

  function fitAssignmentVideoToSlot() {
    const clip = activeAssignmentClip;
    if (!clip) return;
    const slotSec = assignmentSlotSec(assignmentVideoDraft);

    if (clip.sourceDurationSec <= slotSec) {
      updateActiveAssignmentClip({
        trimStartSec: 0,
        trimEndSec: clip.sourceDurationSec,
      });
      setAssignmentVideoDraft((prev) => ({
        ...prev,
        previewSec: 0,
      }));
      return;
    }

    updateActiveAssignmentClip({
      trimStartSec: 0,
      trimEndSec: slotSec,
    });
    setAssignmentVideoDraft((prev) => ({
      ...prev,
      previewSec: 0,
    }));
  }

  function resetAssignmentVideoTrim() {
    const clip = activeAssignmentClip;
    if (!clip) return;
    updateActiveAssignmentClip({
      trimStartSec: 0,
      trimEndSec: clip.sourceDurationSec,
    });
    setAssignmentVideoDraft((prev) => ({
      ...prev,
      previewSec: 0,
    }));
  }

  function toggleAssignmentLoopFill() {
    setAssignmentVideoDraft((prev) => ({
      ...prev,
      loopToFill: !prev.loopToFill,
    }));
  }

  async function appendPhoneClipToAssignmentDraft() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow gallery access to pick another choir video.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsMultipleSelection: false,
        quality: 1,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const rawDuration = Number((asset as any).duration || 0);
      const normalizedDurationSec =
        rawDuration > 1000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration);

      const clip = makeAssignmentVideoClip({
        sourceType: "phone",
        title: asset.fileName || asset.uri?.split("/").pop() || "Phone Choir Video",
        uri: asset.uri,
        sourceDurationSec: normalizedDurationSec,
      });

      setAssignmentVideoDraft((prev) => {
        if (prev.clips.length >= 3) return prev;
        return {
          ...prev,
          clips: [...prev.clips, clip],
          activeClipId: clip.id,
          previewSec: clip.trimStartSec,
          isPlaying: false,
        };
      });
    } catch {
      Alert.alert("Video picker error", "Failed to pick another video.");
    }
  }

  function appendMinistryClipToAssignmentDraft() {
    const DEMO_MINISTRY_VIDEOS = [
      { title: "Jeje Choir Video", durationSec: 180 },
      { title: "Upendo Choir Video", durationSec: 220 },
      { title: "Hosanna Praise Video", durationSec: 160 },
      { title: "Mataifa Worship Video", durationSec: 205 },
    ];

    Alert.alert(
      "Ministry videos",
      "Choose one more choir ministry video.",
      [
        { text: "Cancel", style: "cancel" },
        ...DEMO_MINISTRY_VIDEOS.map((item) => ({
          text: item.title,
          onPress: () => {
            const clip = makeAssignmentVideoClip({
              sourceType: "ministry",
              title: item.title,
              sourceDurationSec: item.durationSec,
            });

            setAssignmentVideoDraft((prev) => {
              if (prev.clips.length >= 3) return prev;
              return {
                ...prev,
                clips: [...prev.clips, clip],
                activeClipId: clip.id,
                previewSec: clip.trimStartSec,
                isPlaying: false,
              };
            });
          },
        })),
      ]
    );
  }

  function removeActiveAssignmentClip() {
    setAssignmentVideoDraft((prev) => {
      if (prev.clips.length <= 1) return prev;
      const nextClips = prev.clips.filter((clip) => clip.id !== prev.activeClipId);
      const nextActive = nextClips[0];
      return {
        ...prev,
        clips: nextClips,
        activeClipId: nextActive?.id || "",
        previewSec: nextActive?.trimStartSec || 0,
        isPlaying: false,
      };
    });
  }

  
  function seekAssignmentVideoTo(sec: number) {
    const clip = activeAssignmentClip;
    if (!clip) return;

    const nextSec = clamp(sec, clip.trimStartSec, clip.trimEndSec);

    setAssignmentVideoDraft((prev) => ({
      ...prev,
      previewSec: nextSec,
    }));

    if (clip.uri && assignmentVideoRef.current) {
      assignmentVideoRef.current.currentTime = (nextSec );
    }
  }

function saveAssignmentVideoTrim() {
    const totalSec = totalDraftTrimmedSec(assignmentVideoDraft);
    const sourceLabel = assignmentVideoDraft.loopToFill
      ? `Loop x${loopsNeededToFill(assignmentVideoDraft)}`
      : "No loop";

    const compactPieces = assignmentVideoDraft.clips.map((clip, idx) => {
      const source = clip.sourceType === "phone" ? "Phone" : "Ministry";
      const trimmedSec = Math.max(1, Math.round(clip.trimEndSec - clip.trimStartSec));
      return `${idx + 1}. ${source} ${formatDurationLabel(trimmedSec)}`;
    });

    const compactSummary =
      assignmentVideoDraft.clips.length <= 2
        ? compactPieces.join(" • ")
        : `${assignmentVideoDraft.clips.length} clips • ${compactPieces.slice(0, 2).join(" • ")} • +${assignmentVideoDraft.clips.length - 2} more`;

    addAssignmentCardVideo(
      threadId,
      assignmentVideoDraft.messageId,
      {
        uri: assignmentVideoDraft.clips[0]?.uri || "",
        title: `▶ ${compactSummary} • Total ${formatDurationLabel(totalSec)} • Slot ${assignmentVideoDraft.assignmentDurationMin} min • ${sourceLabel}`,
        kind: "upload",
      }
    );

    closeAssignmentVideoEditor();

    Alert.alert(
      "Saved to scheduled live",
      "Video imehifadhiwa kwenye assignment. Live itaonekana wakati muda wa assignment ukifika."
    );
  }

  function handleSmartLivePress() {
    if (isChurchLiveControlAssignment && liveAssignmentCtaMeta.canOpenLive) {
      router.push({
        pathname: "/(tabs)/more/my-church-room/messages/live-room" as any,
        params: {
          title: headerTitle,
          role: canPastorStartChurchLive ? "PASTOR" : (assignmentRoleParam || currentRole || "MEMBER"),
          layout: "grid6",
          membersCount: "26",
          leadersCount: "4",
          assignmentId: threadId,
          source: liveAssignmentCtaMeta.tone === "scheduled" ? "scheduled-live" : "church-live-control",
          liveMode: liveAssignmentCtaMeta.tone === "scheduled" ? "scheduled" : "instant",
          preview: liveAssignmentCtaMeta.tone === "scheduled" ? "1" : "0",
          entryMode: liveAssignmentCtaMeta.tone === "scheduled" ? "backstage" : liveAssignmentCtaMeta.entryMode,
          roomKind: "church-live-control",
          mediaScope: "church",
        },
      });
      return;
    }

    // If scheduled time is open, allow the scheduled/claimed member to enter.
    // If there is no scheduled live flow, only pastor can start Church Live.
    if (liveAssignmentCtaMeta.tone === "scheduled") {
      const scheduleCardIndexes = Array.isArray(messages)
        ? messages
            .map((m: any, index: number) => {
              const card = m?.card;
              const slotLabel = String(card?.slotLabel || "").trim();
              const timeLabel = String(card?.timeLabel || "").trim();
              return slotLabel || timeLabel ? index : -1;
            })
            .filter((index: number) => index >= 0)
        : [];

      const targetIndex =
        scheduleCardIndexes.length > 0
          ? scheduleCardIndexes[scheduleCardIndexes.length - 1]
          : -1;

      if (targetIndex >= 0) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex?.({
            index: targetIndex,
            animated: true,
            viewPosition: 0.08,
          });
        });
        return;
      }

      Alert.alert(
        "Schedule ready",
        "Schedule ipo lakini slot cards bado hazijaonekana kwenye room."
      );
      return;
    }

    if (
      (liveAssignmentCtaMeta.tone === "preview" || liveAssignmentCtaMeta.tone === "live") &&
      liveAssignmentCtaMeta.canOpenLive
    ) {
      const entryMode =
        liveAssignmentCtaMeta.tone === "live"
          ? "live"
          : liveAssignmentCtaMeta.entryMode === "backstage"
            ? "backstage"
            : "waiting";

      router.push({
        pathname: "/(tabs)/more/my-church-room/messages/live-room" as any,
        params: {
          title: headerTitle,
          role: isAssignmentThread ? assignmentRoleParam : currentRole,
          layout: "focus",
          membersCount: "26",
          leadersCount: "4",
          assignmentId: threadId,
          preview: liveAssignmentCtaMeta.tone === "preview" ? "1" : "0",
          entryMode,
        },
      });
      return;
    }

    if (liveAssignmentCtaMeta.tone === "preview" || liveAssignmentCtaMeta.tone === "live") {
      Alert.alert(
        "Live not open",
        "Bado hujaruhusiwa kuingia kwenye live window hii."
      );
      return;
    }

    Alert.alert(
      "No schedule",
      "Tuma schedule kwanza ili LIVE ionyeshe slot cards za ku-claim."
    );
  }

  async function handleClaimAssignmentMessage(messageId: string) {
    let profileRes: any = null;
    try {
      profileRes = await apiGet("/api/auth/profile", { headers: getKristoHeaders() as any });
    } catch {}

    const profileData =
      profileRes?.profile ||
      profileRes?.data?.profile ||
      profileRes?.user ||
      profileRes?.data?.user ||
      profileRes?.data ||
      {};

    const realDisplayName =
      String(
        profileData?.displayName ||
        profileData?.name ||
        profileData?.fullName ||
        (auth as any)?.displayName ||
        (auth as any)?.name ||
        "You"
      ).trim();

    const rawAvatar =
      String(
        profileData?.avatarUrl ||
        profileData?.avatarUri ||
        profileData?.avatar ||
        profileData?.photoUrl ||
        profileData?.imageUrl ||
        profileData?.profileImageUrl ||
        profileData?.picture ||
        (auth as any)?.avatarUrl ||
        (auth as any)?.avatarUri ||
        ""
      ).trim();

    const realAvatar = rawAvatar.startsWith("/")
      ? `${String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "")}${rawAvatar}`
      : rawAvatar;

    const realClaimRoleRaw = String(
      profileRes?.churchRole ||
      profileRes?.role ||
      profileRes?.activeMembership?.churchRole ||
      currentRole ||
      "Member"
    ).trim();

    const realClaimRole =
      realClaimRoleRaw === "Pastor"
        ? "Pastor"
        : realClaimRoleRaw === "Church_Admin" || realClaimRoleRaw === "Admin" || realClaimRoleRaw === "Leader"
          ? "Admin"
          : "Member";


    console.log("🧑 CLAIM_PROFILE_DEBUG", {
      profileRes,
      profileData,
      realDisplayName,
      rawAvatar,
      realAvatar,
    });

    const ok = claimAssignmentCard(threadId, messageId, {
      userId: effectiveAuthUserId,
      name: realDisplayName || "You",
      avatar: realAvatar,
      role: realClaimRole,
    });

    if (!ok) {
      Alert.alert("Already taken", "This assignment is no longer open.");
      return;
    }

    try {
      const targetMsg = messages.find((x) => String(x.id) === String(messageId));
      const claimRoomId = String((params as any)?.ministryId || (params as any)?.assignmentId || resolvedMinistryId || threadId || "").trim();

      apiPatch(
        "/api/church/room-messages",
        {
          roomId: claimRoomId,
          cardId: String((targetMsg?.card as any)?.cardId || messageId),
          patch: {
            status: "taken",
            claimedByUserId: effectiveAuthUserId,
            claimedByName: realDisplayName || "You",
            claimedByAvatar: realAvatar,
            claimedByRole: realClaimRole,
            claimedAt: Date.now(),
          },
        },
        { headers: getKristoHeaders() }
      ).catch((e) => console.log("CLAIM_BACKEND_FAILED", e));
    } catch {}
  }

  function handleAddAssignmentMember(messageId: string) {
    handleClaimAssignmentMessage(messageId);
  }
  function handleAddAssignmentVideo(messageId: string) {
    const DEMO_MINISTRY_VIDEOS = [
      { title: "Jeje Choir Video", durationSec: 180 },
      { title: "Upendo Choir Video", durationSec: 220 },
      { title: "Hosanna Praise Video", durationSec: 160 },
      { title: "Mataifa Worship Video", durationSec: 205 },
    ];

    Alert.alert(
      "Add choir video",
      "Choose where the live video should come from.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Pick from phone",
          onPress: async () => {
            try {
              const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (!perm.granted) {
                Alert.alert(
                  "Permission needed",
                  "Please allow gallery access to pick a choir video."
                );
                return;
              }

              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["videos"],
                allowsMultipleSelection: false,
                quality: 1,
              });

              if (result.canceled || !result.assets?.length) return;

              const asset = result.assets[0];
              const label =
                asset.fileName ||
                asset.uri?.split("/").pop() ||
                "Phone Choir Video";

              const rawDuration = Number((asset as any).duration || 0);
              const normalizedDurationSec =
                rawDuration > 1000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration);

              openAssignmentVideoEditor({
                messageId,
                sourceType: "phone",
                title: label,
                uri: asset.uri,
                sourceDurationSec: normalizedDurationSec,
              });
            } catch (error) {
              Alert.alert("Video picker error", "Failed to pick video from phone.");
            }
          },
        },
        {
          text: "Choose ministry video",
          onPress: () => {
            Alert.alert(
              "Ministry videos",
              "Choose one choir ministry video.",
              [
                { text: "Cancel", style: "cancel" },
                ...DEMO_MINISTRY_VIDEOS.map((item) => ({
                  text: item.title,
                  onPress: () =>
                    openAssignmentVideoEditor({
                      messageId,
                      sourceType: "ministry",
                      title: item.title,
                      sourceDurationSec: item.durationSec,
                    }),
                })),
              ]
            );
          },
        },
      ]
    );
  }

  
const assignmentMembers = useMemo<MinistryPerson[]>(() => {
  if (!isAssignmentThread) return [];

  return realMemberBoardPeople;
}, [isAssignmentThread, realMemberBoardPeople]);


  const assignmentStats = useMemo(() => {
    if (!isAssignmentThread) return null;

    const members = assignmentMembers.length;
    const admins = assignmentMembers.filter((x) => x.role === "Pastor" || x.role === "Admin").length;
    const paused = assignmentMembers.filter((x) => x.status === "Suspended").length;

    return { members, admins, paused };
  }, [isAssignmentThread, assignmentMembers]);

  const ministryAdmins = useMemo(
    () => ministryMembers.filter((x) => x.role === "Pastor" || x.role === "Admin"),
    [ministryMembers]
  );

  const ministryActiveCount = useMemo(
    () => ministryMembers.filter((x) => x.status === "Active").length,
    [ministryMembers]
  );

  const ministrySuspendedCount = useMemo(
    () => ministryMembers.filter((x) => x.status === "Suspended").length,
    [ministryMembers]
  );

  const ministrySuspendedMembers = useMemo(
    () => ministryMembers.filter((x) => x.status === "Suspended"),
    [ministryMembers]
  );

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [churchMemberPickerRows, setChurchMemberPickerRows] = useState<MinistryPerson[]>([]);
  const [selectedAddMemberId, setSelectedAddMemberId] = useState("");
  const [selectedRemoveMemberId, setSelectedRemoveMemberId] = useState("");
  const [addMemberMode, setAddMemberMode] = useState<"add" | "remove">("add");
  const [addingAssignmentMember, setAddingAssignmentMember] = useState(false);
  const [removingAssignmentMember, setRemovingAssignmentMember] = useState(false);

  const assignmentStatsSource =
    realMemberBoardPeople.length > 0 ? realMemberBoardPeople : assignmentMembers;

  const assignmentAdmins = useMemo(
    () => assignmentStatsSource.filter((x) => x.role === "Pastor" || x.role === "Admin"),
    [assignmentStatsSource]
  );

  const assignmentActiveCount = useMemo(
    () => assignmentStatsSource.filter((x) => x.status === "Active").length,
    [assignmentStatsSource]
  );

  const assignmentSuspendedMembers = useMemo(
    () => assignmentStatsSource.filter((x) => x.status === "Suspended"),
    [assignmentStatsSource]
  );

  useEffect(() => {
    let alive = true;

    async function loadRealBoardPeople() {
      if ((!isAssignmentThread && !isMinistryThread) || !String(threadId || "").trim()) {
        setRealMemberBoardPeople([]);
        return;
      }

      try {
        const targetMinistryId = String(
          resolvedMinistryId ||
          (params as any)?.assignmentId ||
          threadId ||
          ""
        );


        const endpoint = isChurchLiveControlAssignment
          ? "/api/church/members"
          : `/api/church/ministry-members?ministryId=${encodeURIComponent(targetMinistryId)}`;

        const res: any = await apiGet(
          endpoint,
          {
            headers: isChurchLiveControlAssignment
              ? ({ ...getKristoHeaders(), "x-kristo-role": "Pastor" } as any)
              : (getKristoHeaders() as any),
          }
        );

        const rows = Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.members)
            ? res.members
            : Array.isArray(res)
              ? res
              : [];
        const mapped = rows.map((x: any, index: number) => {
          const rawAvatar = String(x.avatarUrl || x.avatarUri || x.profileImage || "").trim();
          const avatarUri =
            rawAvatar.startsWith("/")
              ? `${(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "")}${rawAvatar}`
              : rawAvatar;

          const roleRaw = String(x.role || "Member");
          const role =
            /leader|admin/i.test(roleRaw) ? "Admin" :
            /pastor/i.test(roleRaw) ? "Pastor" :
            "Member";

          return {
            id: String(x.id || x.userId || `real_${index}`),
            ministryId: String(x.ministryId || resolvedMinistryId || (params as any)?.assignmentId || threadId || ""),
            userId: String(x.userId || ""),
            name: String(x.displayName || x.fullName || x.name || x.userId || "Member"),
            role,
            status: /paused|suspended/i.test(String(x.status || "")) ? "Suspended" : "Active",
            note: role === "Admin" ? "Ministry leader" : "Ministry member",
            avatarUri,
          } as MinistryPerson;
        });

        if (alive) setRealMemberBoardPeople(mapped);
      } catch {
        if (alive) setRealMemberBoardPeople([]);
      }
    }

    loadRealBoardPeople();

    return () => {
      alive = false;
    };
  }, [isAssignmentThread, threadId, resolvedMinistryId, (params as any)?.assignmentId]);

  useEffect(() => {
    let alive = true;

    async function loadChurchMemberPickerRows() {
      if (!addMemberOpen || (!isAssignmentThread && !isMinistryThread)) return;

      try {
        const res: any = await apiGet("/api/church/members?all=1", {
          headers: getKristoHeaders() as any,
        });

        const rows =
          Array.isArray(res?.data) ? res.data :
          Array.isArray(res?.members) ? res.members :
          Array.isArray(res) ? res :
          [];

        const existingIds = new Set(
          realMemberBoardPeople
            .map((x: any) => String(x.userId || x.id || "").trim())
            .filter(Boolean)
        );

        const mapped = rows
          .map((x: any, index: number) => {
            const userId = String(x.userId || x.id || x.memberUserId || "").trim();
            const rawAvatar = String(x.avatarUrl || x.avatarUri || x.profileImage || "").trim();
            const avatarUri =
              rawAvatar.startsWith("/")
                ? `${(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "")}${rawAvatar}`
                : rawAvatar;

            const roleRaw = String(x.role || x.churchRole || x.roleLabel || "Member");
            const role =
              /pastor/i.test(roleRaw) ? "Pastor" :
              /leader|admin/i.test(roleRaw) ? "Admin" :
              "Member";

            return {
              id: userId || String(x.id || `church_member_${index}`),
              userId,
              name: String(x.displayName || x.fullName || x.name || x.email || userId || "Member"),
              role,
              status: /paused|suspended/i.test(String(x.status || "")) ? "Suspended" : "Active",
              note: role === "Pastor" ? "Church pastor" : role === "Admin" ? "Church leader" : "Church member",
              avatarUri,
            } as MinistryPerson;
          })
          .filter((x: any) => String(x.userId || x.id || "").trim())
          .map((x: any) => ({
            ...x,
            alreadyAdded: existingIds.has(String(x.userId || x.id || "").trim()),
            note: existingIds.has(String(x.userId || x.id || "").trim()) ? "Already added" : x.note,
          }));

        if (alive) {
          setChurchMemberPickerRows(mapped);
          setSelectedAddMemberId((prev) =>
            prev && mapped.some((x: any) => String(x.userId || x.id) === prev) ? prev : ""
          );
        }
      } catch {
        if (alive) setChurchMemberPickerRows([]);
      }
    }

    loadChurchMemberPickerRows();

    return () => {
      alive = false;
    };
  }, [addMemberOpen, isAssignmentThread, isMinistryThread, realMemberBoardPeople]);

  async function addSelectedChurchMemberToAssignment() {
    const selected = churchMemberPickerRows.find(
      (x: any) => String(x.userId || x.id || "") === selectedAddMemberId
    );

    if (!selected || addingAssignmentMember) return;

    const assignmentId = String(resolvedMinistryId || (params as any)?.assignmentId || threadId || "").trim();
    const userId = String((selected as any).userId || selected.id || "").trim();

    if (!assignmentId || !userId) {
      Alert.alert("Missing info", "Assignment or member information is missing.");
      return;
    }

    try {
      setAddingAssignmentMember(true);

      const createdRes: any = await apiPost(
        "/api/church/ministry-members",
        {
          ministryId: assignmentId,
          userId,
          role: "Member",
        },
        { headers: getKristoHeaders() as any }
      );

      const createdId = String(createdRes?.data?.id || userId);

      setRealMemberBoardPeople((prev) => {
        const exists = prev.some((x: any) => String(x.userId || x.id || "") === userId);
        if (exists) return prev;
        return [
          ...prev,
          {
            ...selected,
            id: createdId,
            userId,
            role: "Member",
            status: "Active",
            note: "Assignment member",
          } as any,
        ];
      });

      setAddMemberOpen(false);
      setSelectedAddMemberId("");
      Alert.alert("Added", `${selected.name} has been added to this assignment.`);
    } catch (e: any) {
      Alert.alert("Could not add member", String(e?.message || "Please try again."));
    } finally {
      setAddingAssignmentMember(false);
    }
  }

  async function removeSelectedAssignmentMember() {
    const selected = realMemberBoardPeople.find(
      (x: any) => String(x.id || "") === selectedRemoveMemberId
    );

    if (!selected || removingAssignmentMember) return;

    const mmid = String((selected as any).id || "").trim();
    const currentMinistryId = String(resolvedMinistryId || (params as any)?.assignmentId || threadId || "").trim();
    const selectedMinistryId = String((selected as any).ministryId || "").trim();

    if (!mmid) {
      Alert.alert("Missing info", "Member record is missing.");
      return;
    }

    if (selectedMinistryId && currentMinistryId && selectedMinistryId !== currentMinistryId) {
      Alert.alert("Wrong room", "This member record belongs to another ministry room.");
      return;
    }

    try {
      setRemovingAssignmentMember(true);

      const res: any = await apiDelete(
        `/api/church/ministry-members?id=${encodeURIComponent(mmid)}`,
        { headers: getKristoHeaders() as any }
      );

      if (res && res.ok === false) {
        throw new Error(String(res.error || "Remove failed"));
      }

      setRealMemberBoardPeople((prev) =>
        prev.filter((x: any) => String(x.id || "") !== mmid)
      );
      setSelectedRemoveMemberId("");
      Alert.alert("Removed", `${selected.name} has been removed from this assignment.`);
    } catch (e: any) {
      Alert.alert("Could not remove member", String(e?.message || "Please try again."));
    } finally {
      setRemovingAssignmentMember(false);
    }
  }

  useEffect(() => {
    let alive = true;

    async function loadMcHosts() {
      if ((!isAssignmentThread && !isMinistryThread) || !String(threadId || "").trim()) {
        setMcHostIds([]);
        return;
      }

      const cacheKey = `mc-hosts:${threadId}:${resolvedMinistryId}:${String((params as any)?.assignmentId || "")}`;
      const cached = getCachedParticipant(cacheKey);
      if (cached && alive) {
        setMcHostIds(Array.isArray(cached) ? cached : []);
        return;
      }

      try {
        const keys = [
          String(resolvedMinistryId || ""),
          String((params as any)?.assignmentId || ""),
          String(threadId || ""),
        ]
          .map((x) => x.trim())
          .filter(Boolean)
          .filter((x, index, arr) => arr.indexOf(x) === index);

        let foundIds: string[] = [];

        for (const assignmentKey of keys) {
          const res: any = await apiGet(
            `/api/church/mc-hosts?assignmentId=${encodeURIComponent(assignmentKey)}`,
            { headers: { ...getKristoHeaders(), "x-kristo-role": "Member" } as any }
          );

          const ids = Array.isArray(res?.data?.hostUserIds) ? res.data.hostUserIds : [];
          const normalizedIds = ids
            .map((x: any) => String(x || "").trim())
            .filter((x: string) => x.startsWith("u_"))
            .filter((x: string, index: number, arr: string[]) => arr.indexOf(x) === index)
            .slice(0, 2);

          if (normalizedIds.length > 0) {
            foundIds = normalizedIds;
            break;
          }
        }

        if (alive) {
          setMcHostIds(foundIds);
          setCachedParticipant(cacheKey, foundIds);
        }
      } catch {
        if (alive) setMcHostIds([]);
      }
    }

    void loadMcHosts();

    const stop = startAdaptiveLivePolling({
      screen: "MessageThreadMcHosts",
      enabled: isFocused && isAssignmentThread,
      activeMs: 30000,
      idleMs: 120000,
      onTick: loadMcHosts,
    });

    return () => {
      alive = false;
      stop();
    };
  }, [isAssignmentThread, threadId, resolvedMinistryId, (params as any)?.assignmentId, isFocused]);

  const memberBoardSource =
    isAssignmentThread
      ? realMemberBoardPeople
      : ministryMembers;

  const memberBoardLeaders = useMemo(
    () =>
      memberBoardSource.filter((x) => {
        const r = String(x.role || "").toLowerCase();
        return r.includes("pastor") || r.includes("admin") || r.includes("leader");
      }),
    [memberBoardSource]
  );

  const memberBoardGuests = useMemo(
    () =>
      memberBoardSource.filter((x) => {
        const r = String(x.role || "").toLowerCase();
        const st = String(x.status || "").toLowerCase();
        return r.includes("guest") || st.includes("guest") || st.includes("pending");
      }),
    [memberBoardSource]
  );

  const memberBoardVisible = useMemo(() => {
    if (memberBoardTab === "leaders") return memberBoardLeaders;
    if (memberBoardTab === "guests") return memberBoardGuests;
    return memberBoardSource.filter((x) => {
      const r = String(x.role || "").toLowerCase();
      return !r.includes("pastor") && !r.includes("admin") && !r.includes("leader");
    });
  }, [memberBoardTab, memberBoardSource, memberBoardLeaders, memberBoardGuests]);

  const mcHostCandidates = useMemo(
    () => memberBoardSource.filter((x) => String(x.status || "").toLowerCase() !== "suspended"),
    [memberBoardSource]
  );

  const currentUserIdForMc = String((getKristoHeaders() as any)?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();

  const canAddMemberAuthority = useMemo(() => {
    const appRole = String(effectiveAuthRole || "").toLowerCase();
    if (appRole === "pastor") return true;

    const realSelf = realMemberBoardPeople.find((x: any) => String(x.userId || x.id || "") === currentUserIdForMc);
    const realRole = String((realSelf as any)?.role || "").toLowerCase();

    return realRole.includes("pastor") || realRole.includes("admin") || realRole.includes("leader");
  }, [effectiveAuthRole, realMemberBoardPeople, currentUserIdForMc]);

  const canManageMcHosts = useMemo(() => {
    const appRole = String(effectiveAuthRole || "").toLowerCase();
    if (isPastorAuthority || ["pastor", "church_admin", "system_admin"].includes(appRole)) return true;

    const realSelf = realMemberBoardPeople.find((x: any) => String(x.userId || x.id || "") === currentUserIdForMc);
    return /leader|admin|pastor/i.test(String((realSelf as any)?.role || ""));
  }, [effectiveAuthRole, realMemberBoardPeople, currentUserIdForMc]);


  const visibleMcHostCandidates = useMemo(() => {
    if (canManageMcHosts) return mcHostCandidates;

    if (!currentUserIdForMc || !mcHostIds.includes(currentUserIdForMc)) return [];

    const selfFromList = mcHostCandidates.find((x) => {
      const id = String((x as any).userId || x.id || "").trim();
      return id === currentUserIdForMc;
    });

    if (selfFromList) return [selfFromList];

    return [{
      id: currentUserIdForMc,
      userId: currentUserIdForMc,
      name: "You",
      role: "Member",
      status: "Active",
      note: "MC+ Host",
      avatarUri: "",
    } as any];
  }, [canManageMcHosts, mcHostCandidates, currentUserIdForMc, mcHostIds]);

  async function saveMcHosts(nextIds: string[]) {
    try {
      const assignmentKey = String(resolvedMinistryId || (params as any)?.assignmentId || threadId || "");
      const saved: any = await apiPost(
        "/api/church/mc-hosts",
        {
          assignmentId: assignmentKey,
          hostUserIds: nextIds
            .map((x) => String(x || "").trim())
            .filter((x) => x.startsWith("u_"))
            .filter((x, index, arr) => arr.indexOf(x) === index)
            .slice(0, 2),
        },
        { headers: { ...getKristoHeaders(), "x-kristo-role": "Pastor" } as any }
      );

      const savedIds = Array.isArray(saved?.data?.hostUserIds) ? saved.data.hostUserIds : nextIds;
      setMcHostIds(
        savedIds
          .map((x: any) => String(x || "").trim())
          .filter((x: string) => x.startsWith("u_"))
          .filter((x: string, index: number, arr: string[]) => arr.indexOf(x) === index)
          .slice(0, 2)
      );
    } catch {
      Alert.alert("Save failed", "MC+ Hosts could not be saved right now.");
    }
  }

  function toggleMcHost(person: MinistryPerson) {
    const personUserId = String((person as any).userId || "").trim();

    if (!canManageMcHosts) {
      if (personUserId && personUserId === currentUserIdForMc && mcHostIds.includes(personUserId)) {
        const next = mcHostIds.filter((id) => id !== personUserId);
        saveMcHosts(next);
        return;
      }

      Alert.alert("Leader only", "Only assignment leaders can choose or remove MC+ Hosts.");
      return;
    }

    setMcHostIds((prev) => {
      const id = String((person as any).userId || "").trim();

      if (!id || !id.startsWith("u_")) {
        Alert.alert("Missing user", "This member is missing a userId, so cannot be selected as MC+ Host.");
        return prev;
      }

      const cleanPrev = prev
        .map((x) => String(x || "").trim())
        .filter((x) => x.startsWith("u_"))
        .filter((x, index, arr) => arr.indexOf(x) === index);

      let next = cleanPrev;

      if (cleanPrev.includes(id)) {
        next = cleanPrev.filter((x) => x !== id);
      } else {
        if (cleanPrev.length >= 2) {
          Alert.alert("Limit reached", "You can choose only 2 MC+ Hosts.");
          return cleanPrev;
        }
        next = [...cleanPrev, id];
      }

      saveMcHosts(next);
      return next;
    });
  }

  const mcSelectedHosts = useMemo(
    () => mcHostCandidates.filter((x) => mcHostIds.includes(String((x as any).userId || x.id))),
    [mcHostCandidates, mcHostIds]
  );

  const ministryRoleLabel =
    currentRole === "pastor"
      ? "PASTOR"
      : currentRole === "admin"
        ? "ADMIN"
        : "MEMBER";

  const ministryRolePrettyLabel =
    currentRole === "pastor"
      ? "Pastor"
      : currentRole === "admin"
        ? "Admin"
        : "Member";

  if (!accessChecked) {
    return (
      <View style={[s.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Text style={t.emptyTitle}>Checking room access...</Text>
      </View>
    );
  }

  if (!accessAllowed) {
    return (
      <View style={[s.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Text style={t.emptyTitle}>Room locked</Text>
        <Text style={t.emptySub}>You do not have access to this room.</Text>
      </View>
    );
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 10, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => {
            const source = String((params as any)?.source || "");
            const tab = String((params as any)?.tab || "");

            if (
              source === "my_ministries" ||
              tab === "ministries" ||
              isMinistryThread ||
              isAssignmentThread
            ) {
              router.replace("/(tabs)/more/ministries" as any);
              return;
            }

            if (router.canGoBack()) {
              handleThreadBack();
              return;
            }

            router.replace("/(tabs)/profile/messages");
          }}
          style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}
        >
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <Pressable
          onPress={isMinistryThread || isAssignmentThread ? openThreadMenu : openProfileFromThread}
          hitSlop={8}
          style={({ pressed }) => [
            s.headerMain,
            pressed ? s.menuRowPressed : null,
          ]}
        >
          <View style={s.headerAvatarWrap}>
            <View pointerEvents="none" style={s.headerAvatarGlow} />
            <View style={s.headerAvatarRing}>
              <View style={s.headerAvatar}>
                {headerAvatarSrc ? (
                  <Image source={{ uri: headerAvatarSrc }} style={s.headerAvatarImg} />
                ) : (
                  <Text style={t.headerAvatarText}>{assignmentInitialsParam || headerAvatarLabel(threadId, headerTitle)}</Text>
                )}
              </View>
            </View>
          </View>

          <View style={s.headerTextWrap}>
            <View style={s.headerTitleClip}>
              <Text
                style={t.hTitle}
                numberOfLines={1}
                ellipsizeMode="clip"
              >
                {displayHeaderTitle || headerTitle}
              </Text>
            </View>

            <View style={s.presenceRow}>
              {presenceMessages[presenceIndex] === "online now" ? (
                <View style={s.presenceOnlineDot} />
              ) : null}
              <Text
                style={[
                  t.hSub,
                  presenceMessages[presenceIndex] === "online now" ? t.presenceOnline : null,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {presenceMessages[presenceIndex]}
              </Text>
            </View>

            <Text
              style={t.hSub}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {isAssignmentThread
                ? assignmentStatusParam
                  ? `${assignmentRoleParam} • ${assignmentStatusParam}`
                  : assignmentRoleParam
                : isMinistryThread
                  ? isSuspended ? `${currentRole.toUpperCase()} • suspended` : currentRole.toUpperCase()
                  : ""}
            </Text>
          </View>
        </Pressable>

        <View style={s.headerActions}>
                    {assignmentLiveBadge ? (
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Pressable
                onPress={handleSmartLivePress}
                style={({ pressed }) => [
                  s.liveBtn,
                  liveAssignmentCtaMeta.tone === "scheduled"
                    ? s.liveBtnScheduled
                    : liveAssignmentCtaMeta.tone === "preview"
                      ? s.liveBtnPreview
                      : liveAssignmentCtaMeta.tone === "live"
                        ? s.liveBtnLive
                        : s.liveBtnIdle,
                  pressed ? ({ opacity: 0.82, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                ]}
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={
                    liveAssignmentCtaMeta.tone === "live" || liveAssignmentCtaMeta.tone === "preview"
                      ? ["rgba(34,197,94,0.22)", "rgba(34,197,94,0.08)", "rgba(255,255,255,0.04)"]
                      : liveAssignmentCtaMeta.tone === "scheduled"
                        ? ["rgba(245,215,128,0.18)", "rgba(245,215,128,0.06)", "rgba(255,255,255,0.03)"]
                        : ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "transparent"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.liveBtnGlass}
                />
                <Animated.View
                  style={{
                    transform: [{ scale: livePulse }],
                    marginRight: 4,
                  }}
                >
                  <Ionicons
                    name="wifi-outline"
                    style={{ opacity: 0.95 }}
                    size={13}
                    color={
                      liveAssignmentCtaMeta.tone === "scheduled"
                        ? "#F5D780"
                        : liveAssignmentCtaMeta.tone === "preview"
                          ? "#22c55e"
                          : liveAssignmentCtaMeta.tone === "live"
                            ? "#22c55e"
                            : "rgba(255,255,255,0.72)"
                    }
                  />
                </Animated.View>

                <Text
                  style={[
                    t.liveBtnText,
                    liveAssignmentCtaMeta.tone === "scheduled"
                      ? t.liveBtnTextScheduled
                      : liveAssignmentCtaMeta.tone === "preview" || liveAssignmentCtaMeta.tone === "live"
                        ? t.liveBtnTextLive
                        : t.liveBtnTextIdle,
                  ]}
                >
                  LIVE
                </Text>
              </Pressable>

              {liveAssignmentCtaMeta.tone === "scheduled" ? (
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 11,
                    fontSize: 7,
                    lineHeight: 8,
                    fontWeight: "700",
                    color: "rgba(255,255,255,0.58)",
                    textAlign: "center",
                    maxWidth: 84,
                  }}
                >
                  {liveAssignmentCtaMeta.sublabel || "Live starts soon"}
                </Text>
              ) : liveAssignmentCtaMeta.tone === "preview" ? (
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 8,
                    fontSize: 7,
                    lineHeight: 8,
                    fontWeight: "700",
                    color: "rgba(134,239,172,0.84)",
                    textAlign: "center",
                    maxWidth: 92,
                  }}
                >
                  {liveAssignmentCtaMeta.sublabel || "Ready room open"}
                </Text>
              ) : liveAssignmentCtaMeta.tone === "live" ? (
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 1,
                    fontSize: 8,
                    lineHeight: 7,
                    fontWeight: "700",
                    color: "rgba(134,239,172,0.72)",
                    textAlign: "center",
                    maxWidth: 84,
                  }}
                >
                  {liveAssignmentCtaMeta.sublabel || "Live now"}
                </Text>
              ) : (
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 8,
                    fontSize: 7,
                    lineHeight: 8,
                    fontWeight: "700",
                    color: "rgba(248,113,113,0.88)",
                    textAlign: "center",
                    maxWidth: 72,
                    opacity: 0.95,
                  }}
                >
                  No schedule
                </Text>
              )}
            </View>
          ) : null}

          <Pressable
            onPress={openThreadMenu}
            style={({ pressed }) => [
              s.hBtn,
              s.hBtnGold,
              ({ marginTop: -2, marginLeft: -6 } as ViewStyle),
              pressed ? ({ opacity: 0.85, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
            ]}
          >
            <Ionicons name="ellipsis-vertical" size={22} color={GOLD} />
          </Pressable>
        </View>
      </View>

      {/* Frame */}
      <View style={s.frame}>
        <ChatRoomBackdrop />
        {!visibleMessages.length ? (
          <ChatEmptyWatermark title={headerTitle} isAssignment={isAssignmentThread} />
        ) : null}
        <FlatList
          ref={(r) => { listRef.current = r; }}
          data={visibleMessages}
          inverted
          keyExtractor={(m) => m.id}
          onScrollToIndexFailed={({ index }) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex?.({
                index,
                animated: true,
                viewPosition: 0.08,
              });
            }, 280);
          }}
          
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}
          renderItem={({ item, index }) => {
            const prev = messages[index + 1];
            const showAvatar = !prev || prev.sender !== item.sender;

            return (
              <Bubble
                m={item}
                showAvatar={showAvatar}
                onLongPress={() => confirmDelete(item)}
                canClaimAssignmentCard={canViewerClaimAssignmentCard}
                canAddAssignmentCard={canViewerAddToAssignmentCard}
                canAddVideoAssignmentCard={canViewerAddMusicAssignmentCard}
                onClaimAssignmentCard={handleClaimAssignmentMessage}
                onAddAssignmentMember={handleAddAssignmentMember}
                onAddVideoAssignmentCard={handleAddAssignmentVideo}
                onOpenScheduledLive={openScheduledLiveFromCard}
              />
            );
          }}
          ListEmptyComponent={
            <View style={s.chatEmptyList}>
              <Text style={t.emptyTitle}>No messages yet</Text>
              <Text style={t.emptySub}>
                {isAssignmentThread
                  ? "This assignment room is ready. Send the first assignment message."
                  : isMinistryThread
                    ? "This ministry space is ready. Send the first ministry message."
                    : "Send the first message."}
              </Text>
            </View>
          }
        />
      </View>

      {/* Composer */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
        {pending.length ? (
          <View style={s.pendingBar}>
            <Text style={t.pendingTitle}>Attachments</Text>
            <View style={s.pendingList}>
              {pending.map((a) => (
                <Pressable key={a.id} onPress={() => removePending(a.id)} style={({ pressed }) => [s.pendingPill, pressed ? ({ opacity: 0.9 } as ViewStyle) : null]}>
                  <Ionicons name={a.kind === "image" ? "image" : "document"} size={17} color="rgba(255,255,255,0.75)" />
                  <Text style={t.pendingName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Ionicons name="close" size={17} color="rgba(255,255,255,0.55)" />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={[s.composer, { marginBottom: tabBarH + 8 }]}>
          <Pressable onPress={pickImage} style={({ pressed }) => [s.cBtn, pressed ? s.cBtnPressed : null]}>
            <Ionicons name="image" size={18} color={GOLD_SOLID} />
          </Pressable>

          <Pressable onPress={pickFile} style={({ pressed }) => [s.cBtn, pressed ? s.cBtnPressed : null]}>
            <Ionicons name="attach" size={18} color={GOLD_SOLID} />
          </Pressable>

          <View style={[s.inputWrap, composerFocused ? s.inputWrapFocused : null]}>
            <TextInput
              ref={inputRef}
             
              onFocus={() => {
                setComposerFocused(true);
                try {
                  listRef.current?.scrollToEnd?.({ animated: true });
                } catch {}
              }}
              onBlur={() => setComposerFocused(false)}
              blurOnSubmit={false}
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message..."
              autoFocus={false}
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={t.input}
              multiline
              autoCorrect
            />
          </View>

          <Pressable
            onPress={onSend}
            disabled={!canSend || (isMinistryThread && isSuspended)}
            style={({ pressed }) => [
              s.sendBtn,
              !canSend || (isMinistryThread && isSuspended) ? s.sendBtnDisabled : null,
              canSend && !(isMinistryThread && isSuspended) ? s.sendBtnActive : null,
              pressed && canSend && !(isMinistryThread && isSuspended) ? ({ transform: [{ scale: 0.97 }], opacity: 0.94 } as ViewStyle) : null,
            ]}
          >
            <Ionicons name="send" size={16} color={canSend && !(isMinistryThread && isSuspended) ? "#FFFFFF" : "rgba(255,255,255,0.30)"} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>


      <Modal
        visible={membersOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMembersOpen(false)}
      >
        <View style={s.menuOverlay}>
          <Pressable style={s.menuBackdrop} onPress={() => setMembersOpen(false)} />
          <View style={s.memberSheet}>
            
            <View style={s.memberSheetHeader}>
              <Text style={t.menuTitle}>Members</Text>
              <Text style={t.menuSub}>{headerTitle}</Text>
            </View>

            <View style={s.memberBoardTabsRow}>
              {[
                { key: "members", label: "Members", count: memberBoardSource.length },
                { key: "leaders", label: "Leaders", count: memberBoardLeaders.length },
                { key: "guests", label: "Guests", count: memberBoardGuests.length },
              ].map((tab) => {
                const active = memberBoardTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setMemberBoardTab(tab.key as any)}
                    style={[s.memberBoardTabBtn, active && s.memberBoardTabBtnActive]}
                  >
                    <Text style={[s.memberBoardTabText, active && s.memberBoardTabTextActive]}>
                      {tab.label}
                    </Text>
                    <Text style={[s.memberBoardTabCount, active && s.memberBoardTabCountActive]}>
                      {tab.count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <FlatList
              data={memberBoardVisible}
              keyExtractor={(item) => item.id}
              contentContainerStyle={s.memberListContent}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              renderItem={({ item }) => <PersonRow item={item} />}
            />

            <Pressable
              onPress={() => setMembersOpen(false)}
              style={({ pressed }) => [s.menuCancelBtn, pressed ? ({ opacity: 0.9 } as ViewStyle) : null]}
            >
              <Text style={t.menuCancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={addMemberOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddMemberOpen(false)}
      >
        <View style={s.menuOverlay}>
          <Pressable style={s.menuBackdrop} onPress={() => setAddMemberOpen(false)} />
          <View style={s.memberSheet}>
            <View style={s.memberSheetHeader}>
              <Text style={t.menuTitle}>ADD & Remove</Text>
              <Text style={t.menuSub}>Manage members for {headerTitle}</Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14, marginBottom: 14 }}>
              {[
                { key: "add", label: "Add" },
                { key: "remove", label: "Remove" },
              ].map((tab: any) => {
                const active = addMemberMode === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => {
                      setAddMemberMode(tab.key);
                      setSelectedAddMemberId("");
                      setSelectedRemoveMemberId("");
                    }}
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: active ? GOLD : "rgba(255,255,255,0.12)",
                      backgroundColor: active ? "rgba(217,179,95,0.16)" : "rgba(255,255,255,0.05)",
                    }}
                  >
                    <Text style={{ color: active ? GOLD : "rgba(255,255,255,0.62)", fontWeight: "900" }}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <FlatList
              data={
                (addMemberMode === "add" ? churchMemberPickerRows : realMemberBoardPeople).filter((x: any) => {
                  const role = String(x.role || x.roleLabel || "").toLowerCase();
                  const note = String(x.note || "").toLowerCase();
                  const userId = String(x.userId || x.id || "").trim();
                  const selfId = String(effectiveAuthUserId || currentUserIdForMc || "").trim();

                  if (role.includes("pastor")) return false;
                  if (note.includes("pastor")) return false;
                  if (selfId && userId === selfId) return false;

                  return true;
                })
              }
              keyExtractor={(item: any) => String(item.userId || item.id)}
              contentContainerStyle={s.memberListContent}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              ListEmptyComponent={
                <View style={{ paddingVertical: 28, alignItems: "center" }}>
                  <Ionicons name={addMemberMode === "add" ? "people-outline" : "remove-circle-outline"} size={28} color={GOLD} />
                  <Text style={[t.memberEmptyTitle, { marginTop: 10 }]}>
                    {addMemberMode === "add" ? "No church members to add" : "No members to remove"}
                  </Text>
                  <Text style={t.menuSub}>
                    {addMemberMode === "add" ? "Everyone may already be in this assignment." : "This assignment has no removable members."}
                  </Text>
                </View>
              }
              renderItem={({ item }: any) => {
                const addKey = String(item.userId || item.id || "");
                const removeKey = String(item.id || "");
                const alreadyAdded = !!(item as any).alreadyAdded;
                const selected =
                  addMemberMode === "add"
                    ? selectedAddMemberId === addKey
                    : selectedRemoveMemberId === removeKey;

                return (
                  <Pressable
                    onPress={() => {
                      if (addMemberMode === "add") {
                        if (!alreadyAdded) setSelectedAddMemberId(addKey);
                      } else {
                        setSelectedRemoveMemberId(removeKey);
                      }
                    }}
                    style={({ pressed }) => [
                      s.memberRow,
                      selected ? { borderColor: GOLD, backgroundColor: "rgba(217,179,95,0.12)" } : null,
                      addMemberMode === "add" && alreadyAdded ? { opacity: 0.55 } : null,
                      pressed && !(addMemberMode === "add" && alreadyAdded) ? ({ opacity: 0.92 } as ViewStyle) : null,
                    ]}
                  >
                    <PersonRow item={item} />
                    <View style={{ marginLeft: 10 }}>
                      <Ionicons
                        name={
                          addMemberMode === "add" && alreadyAdded
                            ? "checkmark-done-circle"
                            : selected
                              ? "checkmark-circle"
                              : "ellipse-outline"
                        }
                        size={24}
                        color={
                          addMemberMode === "add" && alreadyAdded
                            ? "rgba(255,255,255,0.35)"
                            : selected
                              ? GOLD
                              : "rgba(255,255,255,0.35)"
                        }
                      />
                    </View>
                  </Pressable>
                );
              }}
            />

            <Pressable
              onPress={addMemberMode === "add" ? addSelectedChurchMemberToAssignment : removeSelectedAssignmentMember}
              disabled={
                addMemberMode === "add"
                  ? !selectedAddMemberId || addingAssignmentMember
                  : !selectedRemoveMemberId || removingAssignmentMember
              }
              style={({ pressed }) => {
                const enabled = addMemberMode === "add" ? !!selectedAddMemberId : !!selectedRemoveMemberId;
                return [
                  s.menuCancelBtn,
                  {
                    backgroundColor: enabled ? GOLD : "rgba(255,255,255,0.08)",
                    borderColor: enabled ? GOLD : "rgba(255,255,255,0.12)",
                  },
                  pressed && enabled ? ({ opacity: 0.9 } as ViewStyle) : null,
                ];
              }}
            >
              <Text
                style={[
                  t.menuCancelText,
                  {
                    color:
                      (addMemberMode === "add" ? selectedAddMemberId : selectedRemoveMemberId)
                        ? "#0B0F17"
                        : "rgba(255,255,255,0.45)",
                  },
                ]}
              >
                {addMemberMode === "add"
                  ? addingAssignmentMember ? "Adding..." : "Add to assignment"
                  : removingAssignmentMember ? "Removing..." : "Remove from assignment"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setAddMemberOpen(false)}
              style={({ pressed }) => [s.menuCancelBtn, pressed ? ({ opacity: 0.9 } as ViewStyle) : null]}
            >
              <Text style={t.menuCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={mcHostsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMcHostsOpen(false)}
      >
        <View style={s.menuOverlay}>
          <Pressable style={s.menuBackdrop} onPress={() => setMcHostsOpen(false)} />
          <View style={s.memberSheet}>
            <View style={s.memberSheetHeader}>
              <Text style={t.menuTitle}>MC+ Hosts</Text>
              <Text style={t.menuSub}>Choose up to 2 hosts for this assignment</Text>
            </View>

            <View style={s.mcHostSummaryCard}>
              <Ionicons name="mic-outline" size={18} color="#D9B35F" />
              <Text style={s.mcHostSummaryText}>
                {mcSelectedHosts.length}/2 selected
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.memberListContent}>
              {visibleMcHostCandidates.map((person) => {
                const selected = mcHostIds.includes(String((person as any).userId || person.id));
                return (
                  <Pressable
                    key={person.id}
                    onPress={() => toggleMcHost(person)}
                    style={[s.mcHostRow, selected ? s.mcHostRowSelected : null]}
                  >
                    <View style={s.mcHostLeft}>
                      <View style={s.mcHostAvatar}>
                        {person.avatarUri ? (
                          <Image source={{ uri: person.avatarUri }} style={s.memberAvatarImage as any} />
                        ) : (
                          <Text style={t.memberAvatarText}>{initials(person.name)}</Text>
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={s.mcHostName} numberOfLines={1}>{person.name}</Text>
                        <Text style={s.mcHostMeta} numberOfLines={1}>
                          {!canManageMcHosts && selected ? "Tap to quit MC+ Host" : selected ? "MC+ Host selected" : "Tap to choose as host"}
                        </Text>
                      </View>
                    </View>

                    <View style={[s.mcHostCheck, selected ? s.mcHostCheckOn : null]}>
                      <Ionicons name={!canManageMcHosts && selected ? "exit-outline" : selected ? "checkmark" : "add"} size={18} color={selected ? "#07111F" : "#D9B35F"} />
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => setMcHostsOpen(false)}
              style={({ pressed }) => [s.menuCancelBtn, pressed ? ({ opacity: 0.9 } as ViewStyle) : null]}
            >
              <Text style={t.menuCancelText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={adminsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAdminsOpen(false)}
      >
        <View style={s.menuOverlay}>
          <Pressable style={s.menuBackdrop} onPress={() => setAdminsOpen(false)} />
          <View style={s.memberSheet}>
            
            <View style={s.memberSheetHeader}>
              <Text style={t.menuTitle}>Admins</Text>
              <Text style={t.menuSub}>{headerTitle}</Text>
            </View>

            <FlatList
              data={isAssignmentThread ? assignmentAdmins : ministryAdmins}
              keyExtractor={(item) => item.id}
              contentContainerStyle={s.memberListContent}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              ListEmptyComponent={
                <View style={s.memberEmpty}>
                  <Text style={t.memberEmptyTitle}>No admins found</Text>
                  <Text style={t.memberEmptySub}>{isAssignmentThread ? "No assignment leaders found right now." : "Connect ministry leadership data next."}</Text>
                </View>
              }
              renderItem={({ item }) => <PersonRow item={item} />}
            />

            <Pressable
              onPress={() => setAdminsOpen(false)}
              style={({ pressed }) => [s.menuCancelBtn, pressed ? ({ opacity: 0.9 } as ViewStyle) : null]}
            >
              <Text style={t.menuCancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={suspendedOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSuspendedOpen(false)}
      >
        <View style={s.menuOverlay}>
          <Pressable style={s.menuBackdrop} onPress={() => setSuspendedOpen(false)} />
          <View style={s.memberSheet}>
            
            <View style={s.memberSheetHeader}>
              <Text style={t.menuTitle}>Suspended</Text>
              <Text style={t.menuSub}>{headerTitle}</Text>
            </View>

            <FlatList
              data={isAssignmentThread ? assignmentSuspendedMembers : ministrySuspendedMembers}
              keyExtractor={(item) => item.id}
              contentContainerStyle={s.memberListContent}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              ListEmptyComponent={
                <View style={s.memberEmpty}>
                  <Text style={t.memberEmptyTitle}>No suspended members</Text>
                  <Text style={t.memberEmptySub}>{isAssignmentThread ? "Everyone in this assignment is active right now." : "Everyone in this ministry is active right now."}</Text>
                </View>
              }
              renderItem={({ item }) => <PersonRow item={item} />}
            />

            <Pressable
              onPress={() => setSuspendedOpen(false)}
              style={({ pressed }) => [s.menuCancelBtn, pressed ? ({ opacity: 0.9 } as ViewStyle) : null]}
            >
              <Text style={t.menuCancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {(() => {
        return null;
      })()}

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeThreadMenu}
      >
        <View style={s.menuOverlay}>
          <Pressable style={s.menuBackdrop} onPress={closeThreadMenu} />

          <View
            style={[
              s.menuSheet,
            ]}
          >
            <View style={s.menuSheetTop}>
              <View style={s.menuHeader}>
                <View style={s.menuHeaderRow}>
                  <View style={s.menuHeaderIdentity}>
                    <View style={s.menuHeaderAvatar}>
                      {headerAvatarSrc ? (
                        <Image source={{ uri: headerAvatarSrc }} style={s.menuHeaderAvatarImg} />
                      ) : (
                        <Text style={t.menuHeaderAvatarText}>
                          {assignmentInitialsParam || headerAvatarLabel(threadId, headerTitle)}
                        </Text>
                      )}
                    </View>

                    <View style={s.menuHeaderTextWrap}>
                      <Text style={t.menuTitle} numberOfLines={1}>
                        {headerTitle}
                      </Text>
                      <Text style={t.menuSub}>{isAssignmentThread ? "Assignment settings" : isMinistryThread ? "Ministry settings" : "Conversation settings"}</Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={closeThreadMenu}
                    style={({ pressed }) => [
                      s.menuCloseBtn,
                      pressed ? ({ opacity: 0.85 } as ViewStyle) : null,
                    ]}
                  >
                    <Ionicons name="close" size={18} color="rgba(255,255,255,0.82)" />
                  </Pressable>
                </View>
              </View>

              <Animated.View
                style={[
                  s.menuProfileCardFloatWrap,
                  {
                    transform: [{ translateY: sheetLift }, { scale: sheetScale }],
                    opacity: sheetDepthAnim,
                  },
                ]}
              >
                <View pointerEvents="box-none" style={s.menuProfileCard}>
                  <BlurView pointerEvents="none" intensity={32} tint="dark" style={s.menuProfileGlass} />
                  <View pointerEvents="none" style={s.menuProfileCardGlow} />

                  {isStructuredRoom ? (
                    <>
                      <View style={s.menuProfileHeroRow}>
                        <View>
                          <Text style={t.menuFactLabel} numberOfLines={1}>{isAssignmentThread ? "ASSIGNMENT ROOM" : "MINISTRY ROOM"}</Text>
                          <Text style={t.menuProfileName} numberOfLines={1}>{headerTitle}</Text>
                        </View>

                        <View
                          style={[
                            s.menuPresencePill,
                            isSuspended ? s.menuPresencePillPurple : s.menuPresencePillBlue,
                          ]}
                        >
                          <Text
                            style={[
                              t.menuPresencePillText,
                              isSuspended ? t.menuPresencePillTextPurple : t.menuPresencePillTextBlue,
                            ]}
                          >
                            {isSuspended ? "Suspended" : "Active"}
                          </Text>
                        </View>
                      </View>

                      <View pointerEvents="box-none" style={s.ministryStatsRow}>
                        <Pressable
                          onPress={() => onThreadMenuAction("members")}
                          style={({ pressed }) => [
                            s.menuFactCard,
                            s.menuFactCardEmerald,
                            s.ministryMiniCard,
                            pressed ? s.ministryMiniCardPressed : null,
                          ]}
                        >
                          <View style={[s.statCardIconWrap, s.statCardIconWrapEmerald]}>
                            <Ionicons name="people-outline" size={15} color="rgba(120,255,190,0.96)" />
                          </View>

                          <Text
                            style={[t.menuFactLabel, s.statCardLabelTextStack]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            MEMBERS
                          </Text>

                          <Text style={[t.menuStatValue, s.statCardValueText]} numberOfLines={1}>
                            {isAssignmentThread ? assignmentActiveCount : ministryMembers.length}
                          </Text>

                          <Text style={s.statCardHintText} numberOfLines={1}>
                            People
                          </Text>
                        </Pressable>

                        <Pressable
                          onPress={() => onThreadMenuAction("admins")}
                          style={({ pressed }) => [
                            s.menuFactCard,
                            s.menuFactCardPurple,
                            s.ministryMiniCard,
                            pressed ? s.ministryMiniCardPressed : null,
                          ]}
                        >
                          <View style={[s.statCardIconWrap, s.statCardIconWrapPurple]}>
                            <Ionicons name="shield-checkmark-outline" size={15} color="rgba(214,166,255,0.96)" />
                          </View>

                          <Text
                            style={[t.menuFactLabel, s.statCardLabelTextStack]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            ADMINS
                          </Text>

                          <Text style={[t.menuStatValue, s.statCardValueText]} numberOfLines={1}>
                            {isAssignmentThread ? assignmentAdmins.length : ministryAdmins.length}
                          </Text>

                          <Text style={s.statCardHintText} numberOfLines={1}>
                            Leaders
                          </Text>
                        </Pressable>

                        <Pressable
                          onPress={() => onThreadMenuAction("suspended")}
                          style={({ pressed }) => [
                            s.menuFactCard,
                            s.menuFactCardBlue,
                            s.ministryMiniCard,
                            pressed ? s.ministryMiniCardPressed : null,
                          ]}
                        >
                          <View style={[s.statCardIconWrap, s.statCardIconWrapBlue]}>
                            <Ionicons name="pause-circle-outline" size={15} color="rgba(120,185,255,0.96)" />
                          </View>

                          <Text
                            style={[t.menuFactLabel, s.statCardLabelTextStack]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            PAUSED
                          </Text>

                          <Text style={[t.menuStatValue, s.statCardValueText]} numberOfLines={1}>
                            {isAssignmentThread ? assignmentSuspendedMembers.length : ministrySuspendedCount}
                          </Text>

                          <Text style={s.statCardHintText} numberOfLines={1}>
                            Paused
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={s.menuProfileHeroRow}>
                        <View
                          style={[
                            s.menuPresencePill,
                            currentFact?.tone === "blue" ? s.menuPresencePillBlue : null,
                            currentFact?.tone === "emerald" ? s.menuPresencePillEmerald : null,
                            currentFact?.tone === "purple" ? s.menuPresencePillPurple : null,
                            !currentFact?.tone && (presence.online ? s.menuPresencePillOnline : null),
                          ]}
                        >
                          <Text
                            style={[
                              t.menuPresencePillText,
                              currentFact?.tone === "blue" ? t.menuPresencePillTextBlue : null,
                              currentFact?.tone === "emerald" ? t.menuPresencePillTextEmerald : null,
                              currentFact?.tone === "purple" ? t.menuPresencePillTextPurple : null,
                              !currentFact?.tone && (presence.online ? t.menuPresencePillTextOnline : null),
                            ]}
                          >
                            {currentFact?.pill || (presence.online ? "Online" : "Public")}
                          </Text>
                        </View>
                      </View>

                      <Animated.View
                        style={[
                          s.menuFactCard,
                          currentFact?.tone === "blue" ? s.menuFactCardBlue : null,
                          currentFact?.tone === "emerald" ? s.menuFactCardEmerald : null,
                          currentFact?.tone === "purple" ? s.menuFactCardPurple : null,
                          {
                            opacity: factCardOpacity,
                            transform: [{ translateY: factCardTranslate }],
                          },
                        ]}
                      >
                        <Text style={t.menuFactLabel} numberOfLines={1}>
                          {currentFact?.label || "PROFILE FACT"}
                        </Text>

                        <Text style={t.menuFactValue} numberOfLines={1}>
                          {currentFact?.value || "—"}
                        </Text>
                      </Animated.View>
                    </>
                  )}
                </View>
              </Animated.View>
            </View>

            <ScrollView
              style={s.menuBodyScroll}
              contentContainerStyle={s.menuScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {isStructuredRoom ? (
                <>
                  <View style={{ width: "100%" }}>
                    {isMinistryThread ? (
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <View style={{ flexBasis: "48%", flexGrow: 1 }}>
                          <MenuTile
                            ministryCompact
                            icon="people-outline"
                            label="Manage members"
                            activeGlow
                            disabled={actionLoading !== null}
                            onPress={() => onThreadMenuAction("members")}
                          />
                        </View>

                        <View style={{ flexBasis: "48%", flexGrow: 1 }}>
                          <MenuTile
                            ministryCompact
                            icon="create-outline"
                            label="Profile"
                            activeGlow
                            disabled={actionLoading !== null}
                            onPress={() => onThreadMenuAction("edit")}
                          />
                        </View>

                        <View style={{ flexBasis: "48%", flexGrow: 1 }}>
                          <MenuTile
                            ministryCompact
                            icon="person-add-outline"
                            label="ADD & Remove"
                            activeGlow
                            disabled={actionLoading !== null || !canAddMemberAuthority}
                            onPress={() => onThreadMenuAction("invite")}
                          />
                        </View>

                        <View style={{ flexBasis: "48%", flexGrow: 1 }}>
                          <MenuTile
                            ministryCompact
                            icon={actionLoading === "pause" ? "time-outline" : "pause-circle-outline"}
                            label={actionLoading === "pause" ? "Pausing..." : "Pause ministry"}
                            danger
                            disabled={actionLoading !== null || !canEditMinistry}
                            onPress={() => onThreadMenuAction("pause")}
                          />
                        </View>
                      </View>
                    ) : null}

                    {isAssignmentThread ? (
                      <View style={s.assignmentMenuColumns}>
                        <View style={s.assignmentMenuColumnLeft}>
                          <View style={[s.menuSectionBlock, { marginTop: 2 }]}>
                            <Text style={t.menuSection}>People</Text>
                            <View style={s.menuTileGrid}>
                              {canOpenAssignmentMembersBoard ? (
                                <MenuTile
                                  icon="people-outline"
                                  label="Members board" activeGlow
                                  compact
                                  disabled={actionLoading !== null}
                                  onPress={() => onThreadMenuAction("members")}
                                />
                              ) : null}

                              <MenuTile
                                icon="create-outline"
                                label="Profile" activeGlow
                                compact
                                disabled={actionLoading !== null}
                                onPress={() => onThreadMenuAction("edit")}
                              />

                              <MenuTile
                                icon="person-add-outline"
                                label="ADD & Remove" activeGlow
                                compact
                                disabled={actionLoading !== null || !canAddMemberAuthority}
                                onPress={() => onThreadMenuAction("invite")}
                              />

                              <MenuTile
                                icon="mic-outline"
                                label="MC+ Hosts" activeGlow
                                compact
                                disabled={actionLoading !== null || (!canManageMcHosts && !isSelectedMcHost)}
                                onPress={() => onThreadMenuAction("mc_plus")}
                              />
                            </View>
                          </View>

                          <View style={s.menuSectionBlock}>
                            <Text style={t.menuSection}>Communication</Text>
                            <View style={s.menuTileGrid}>
                              <MenuTile
                                icon="mail-outline"
                                label="V2 • Targeted msg"
                                disabled={true}
                                onPress={() => onThreadMenuAction("targeted")}
                              />

                              <MenuTile
                                icon="megaphone-outline"
                                label="V2 • Broadcast"
                                disabled={true}
                                onPress={() => openAssignmentToolScreen("broadcast")}
                              />
                            </View>
                          </View>
                        </View>

                        <View style={s.assignmentMenuColumnRight}>
                          <View style={s.menuSectionBlock}>
                            <Text style={t.menuSection}>TLMC system</Text>
                            <View style={s.menuTileGrid}>
                              <MenuTile
                                icon="sparkles-outline"
                                label="V2 • TLMC panel"
                                compact
                                disabled={true}
                                onPress={() => onThreadMenuAction("tlmc")}
                              />

                              <MenuTile
                                icon="checkbox-outline"
                                label="V2 • Election"
                                compact
                                disabled={true}
                                onPress={() => onThreadMenuAction("election")}
                              />
                            </View>
                          </View>

                          <View style={s.menuSectionBlock}>
                            <Text style={t.menuSection}>Scheduling</Text>
                            <View style={s.menuTileGrid}>
                              <MenuTile
                                icon="calendar-outline"
                                label="Meeting" activeGlow
                                disabled={actionLoading !== null || !canScheduleStructuredMeeting}
                                onPress={() => openAssignmentToolScreen("meeting")}
                              />

                              <MenuTile
                                icon="time-outline"
                                label="Schedule" activeGlow
                                disabled={actionLoading !== null || !canScheduleStructuredMeeting}
                                onPress={() => openAssignmentToolScreen("schedule")}
                              />
                            </View>
                          </View>

                          <View style={s.menuSectionBlock}>
                            <Text style={t.menuSection}>Control</Text>
                            <View style={s.menuTileGrid}>
                              <MenuTile
                                icon="eye-outline"
                                label="V2 • Visibility"
                                disabled={true}
                                onPress={() => onThreadMenuAction("visibility")}
                              />

                              <MenuTile
                                icon="shield-checkmark-outline"
                                label="V2 • Permissions"
                                disabled={true}
                                onPress={() => openAssignmentToolScreen("permissions")}
                              />

                              <MenuTile icon={actionLoading === "pause" ? "time-outline" : "pause-circle-outline"} label={actionLoading === "pause" ? "Pausing..." : "Pause assignment"} danger disabled={actionLoading !== null} onPress={() => onThreadMenuAction("pause")} />

                              <MenuTile icon={actionLoading === "leave" ? "time-outline" : "exit-outline"} label={actionLoading === "leave" ? "Leaving..." : isAssignmentThread ? "Leave assignment" : "Quit ministry"} danger disabled={actionLoading !== null} onPress={() => onThreadMenuAction("leave")} />
                            </View>
                          </View>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : (
                <>
                  <MenuRow icon="person-circle-outline" label="View profile" onPress={() => onThreadMenuAction("profile")} />
                  <MenuRow icon="search-outline" label="Search in conversation" onPress={() => onThreadMenuAction("search")} />
                  <MenuRow icon="notifications-off-outline" label="Mute notifications" onPress={() => onThreadMenuAction("mute")} />
                  <MenuRow icon="ban-outline" label="Block user" danger onPress={() => onThreadMenuAction("block")} />
                  <MenuRow icon="flag-outline" label="Report user" danger onPress={() => onThreadMenuAction("report")} />
                  <MenuRow icon="trash-bin-outline" label="Clear chat" danger onPress={() => onThreadMenuAction("clear")} />
                  <MenuRow icon="close-circle-outline" label="Delete conversation" danger onPress={() => onThreadMenuAction("delete")} />
                </>
              )}

            </ScrollView>
          </View>
        </View>

      </Modal>

      <Modal
        visible={assignmentVideoDraft.visible}
        transparent
        animationType="fade"
        onRequestClose={closeAssignmentVideoEditor}
      >
        <View style={s.videoEditorScreen}>
          <View style={s.videoEditorTopBar}>
            <Pressable
              onPress={closeAssignmentVideoEditor}
              style={({ pressed }) => [
                s.videoEditorTopBtn,
                pressed ? s.videoEditorBtnPressed : null,
              ]}
            >
              <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.96)" />
            </Pressable>

            <View style={s.videoEditorTopBarRight}>
              <Pressable
                onPress={toggleAssignmentTopPreviewPlayback}
                style={({ pressed }) => [
                  s.videoEditorMiniActionBtn,
                  pressed ? s.videoEditorBtnPressed : null,
                ]}
              >
                <Ionicons
                  name={assignmentVideoDraft.isPlaying ? "pause" : "play"}
                  size={17}
                  color="#fff"
                />
              </Pressable>

              <Pressable
                onPress={addAssignmentClipFromEditor}
                style={({ pressed }) => [
                  s.videoEditorMiniActionBtn,
                  pressed ? s.videoEditorBtnPressed : null,
                ]}
              >
                <Ionicons name="add" size={17} color="#fff" />
              </Pressable>

              <Pressable
                onPress={startSplitPickMode}
                style={({ pressed }) => [
                  s.videoEditorMiniActionBtn,
                  trimPickMode ? s.videoEditorMiniActionBtnActive : null,
                  pressed ? s.videoEditorBtnPressed : null,
                ]}
              >
                <Ionicons
                  name="cut-outline"
                  size={16}
                  color={trimPickMode ? "#FF6B74" : "#fff"}
                />
              </Pressable>

              <Pressable
                onPress={deleteActiveAssignmentClipFromEditor}
                style={({ pressed }) => [
                  s.videoEditorMiniDangerBtn,
                  pressed ? s.videoEditorBtnPressed : null,
                ]}
              >
                <Ionicons name="trash-outline" size={15} color="#FF6B74" />
              </Pressable>

              <Pressable
                onPress={saveAssignmentVideoTrim}
                style={({ pressed }) => [
                  s.videoEditorNextBtn,
                  pressed ? s.videoEditorBtnPressed : null,
                ]}
              >
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={s.videoEditorCenter}>
            <View style={s.videoEditorPreviewWrap}>
              {activeAssignmentClip?.uri ? (
                <VideoView
                  player={assignmentVideoPlayer}
                  style={s.videoEditorVideo}
                  contentFit="cover"
                  nativeControls={false}
                />
              ) : (
                <View style={s.videoEditorVideoFallback}>
                  <Ionicons name="videocam-outline" size={40} color="rgba(255,255,255,0.62)" />
                  <Text style={s.videoEditorVideoFallbackText}>Ministry clip preview</Text>
                </View>
              )}

              <Pressable
                onPress={() => {
                  if (assignmentVideoDraft.clips.length > 1) {
                    setClipsVisible((v) => !v);
                  }
                }}
                style={s.videoEditorPreviewTapLayer}
              />

              <View pointerEvents="none" style={s.videoEditorPreviewMetaLeft}>
                <Text style={s.videoEditorTimeText}>
                  {formatSplitRealSec(assignmentVideoDraft.previewSec)}/{formatSplitRealSec(activeAssignmentClip?.sourceDurationSec || 0)}
                </Text>
              </View>
            </View>

            {assignmentVideoDraft.clips.length > 1 && clipsVisible ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.videoEditorClipsScroll}
                style={s.videoEditorClipsWrap}
              >
                <View style={s.videoEditorClipsRow}>
                  {assignmentVideoDraft.clips.map((clip, idx) => {
                    const active = clip.id === assignmentVideoDraft.activeClipId;
                    const trimmedSec = Math.max(
                      1,
                      Math.round((clip.trimEndSec || 0) - (clip.trimStartSec || 0))
                    );

                    return (
                      <Pressable
                        key={clip.id}
                        onPress={() => {
                          setClipsVisible(true);
                          selectAssignmentClip(clip.id);
                        }}
                        style={({ pressed }) => [
                          s.videoEditorClipCard,
                          active ? s.videoEditorClipCardActive : null,
                          pressed ? ({ opacity: 0.9, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                        ]}
                      >
                        <View style={s.videoEditorClipTabTop}>
                          <View
                            style={[
                              s.videoEditorClipDot,
                              active ? s.videoEditorClipDotActive : null,
                            ]}
                          />
                          <Text
                            style={[s.videoEditorClipTitle, active ? s.videoEditorClipTitleActive : null]}
                            numberOfLines={1}
                          >
                            {idx + 1}. {clip.title}
                          </Text>
                        </View>

                        <View style={s.videoEditorClipThumb}>
                          {clip.uri ? (
                            <View style={s.videoEditorClipThumbFallback}>
                              <Ionicons
                                name="play-circle-outline"
                                size={18}
                                color="rgba(255,255,255,0.82)"
                              />
                            </View>
                          ) : (
                            <View style={s.videoEditorClipThumbFallback}>
                              <Ionicons
                                name={clip.sourceType === "phone" ? "phone-portrait-outline" : "library-outline"}
                                size={18}
                                color="rgba(255,255,255,0.82)"
                              />
                            </View>
                          )}
                        </View>

                        <Text style={s.videoEditorClipMeta} numberOfLines={1}>
                          {clip.sourceType === "phone" ? "Phone" : "Ministry"} • {formatDurationLabel(trimmedSec)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            ) : null}

            <View style={s.videoEditorTimelineWrap}>
              <View style={s.videoEditorSimpleTrimCard}>
                <View style={s.videoEditorSimpleTrimHeader}>
                  
                  
                </View>

                <View style={s.videoEditorSingleTrimRow}>
                  <Text style={[s.trimLabelStart, trimPickMode === "start" ? s.trimLabelStartActive : null]}>START</Text>

                  <TextInput
                    value={trimStartInput}
                    onChangeText={setTrimStartInput}
                    onBlur={() => applyTypedTrimValue("start", trimStartInput)}
                    onSubmitEditing={() => applyTypedTrimValue("start", trimStartInput)}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    placeholder="0"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                    style={[s.trimInput, trimPickMode === "start" ? s.trimInputActive : null]}
                  />

                  <Text style={s.trimDivider}>—</Text>

                  <Text style={[s.trimLabelEnd, trimPickMode === "end" ? s.trimLabelEndActive : null]}>END</Text>

                  <TextInput
                    value={trimEndInput}
                    onChangeText={setTrimEndInput}
                    onBlur={() => applyTypedTrimValue("end", trimEndInput)}
                    onSubmitEditing={() => applyTypedTrimValue("end", trimEndInput)}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    placeholder="0"
                    placeholderTextColor="rgba(255,77,77,0.35)"
                    style={[s.trimInputEnd, trimPickMode === "end" ? s.trimInputEndActive : null]}
                  />
                </View>

                <View style={s.videoEditorTrimTrackWrap}>
                  <View
                    style={s.videoEditorTrimTrackBox}
                    onLayout={(e) => setTrimTrackWidth(e.nativeEvent.layout.width)}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={(e) => onTrimTrackGrant(e.nativeEvent.locationX)}
                    onResponderMove={(e) => onTrimTrackMove(e.nativeEvent.locationX)}
                    onResponderRelease={onTrimTrackRelease}
                    onResponderTerminate={onTrimTrackRelease}
                  >
                    

                    <View
                      style={[
                        s.videoEditorTrimTrackActive,
                        (() => {
                          const duration = Math.max(
                            1,
                            Number(activeAssignmentClip?.sourceDurationSec || 1)
                          );
                          const startSec = Math.max(
                            0,
                            Number(activeAssignmentClip?.trimStartSec || 0)
                          );
                          const rawEndSec = Number(
                            activeAssignmentClip?.trimEndSec ||
                              activeAssignmentClip?.sourceDurationSec ||
                              duration
                          );
                          const endSec = Math.max(startSec, rawEndSec);
                          const left = (startSec / duration) * trimTrackWidth;
                          const width = Math.max(
                            0,
                            ((endSec - startSec) / duration) * trimTrackWidth
                          );
                          return { left, width } as ViewStyle;
                        })(),
                      ]}
                    />

                    <View
                      style={[
                        s.videoEditorTrimHandle,
                        s.videoEditorTrimHandleStart,
                        trimPickMode === "start" ? s.videoEditorTrimHandleActive : null,
                        (() => {
                          const duration = Math.max(1, Math.round(activeAssignmentClip?.sourceDurationSec || 1));
                          const startSec = Math.max(0, Math.round(activeAssignmentClip?.trimStartSec || 0));
                          return { left: `${(startSec / duration) * 100}%` };
                        })(),
                      ]}
                    />

                    <View
                      style={[
                        s.videoEditorTrimHandle,
                        s.videoEditorTrimHandleEnd,
                        trimPickMode === "end" ? s.videoEditorTrimHandleActiveEnd : null,
                        (() => {
                          const duration = Math.max(1, Math.round(activeAssignmentClip?.sourceDurationSec || 1));
                          const endSec = Math.max(0, Math.round(activeAssignmentClip?.trimEndSec || 0));
                          return { left: `${(endSec / duration) * 100}%` };
                        })(),
                      ]}
                    />
                  </View>

                  <View style={s.videoEditorTrimTrackTimeRow}>
                    <Text style={s.videoEditorTrimTrackTimeText}>
                      {formatSplitRealSec(activeAssignmentClip?.trimStartSec || 0)}
                    </Text>
                    
                    <Text style={s.videoEditorTrimTrackTimeTextEnd}>
                      {formatSplitRealSec(activeAssignmentClip?.trimEndSec || 0)}
                    </Text>
                  </View>
                </View>

<View style={s.videoEditorSimpleTrimBtnsRow}>
                  {[
                    { label: "S-5", onPress: () => adjustAssignmentTrimBoundary("start", -5) },
                    { label: "S-1", onPress: () => adjustAssignmentTrimBoundary("start", -1) },
                    { label: "E+1", onPress: () => adjustAssignmentTrimBoundary("end", 1) },
                    { label: "E+5", onPress: () => adjustAssignmentTrimBoundary("end", 5) },
                  ].map((item) => (
                    <Pressable
                      key={item.label}
                      onPress={item.onPress}
                      style={({ pressed }) => [
                        s.videoEditorSimpleTrimBtnMini,
                        pressed ? ({ opacity: 0.85, transform: [{ scale: 0.98 }] } as ViewStyle) : null,
                      ]}
                    >
                      <Text style={s.videoEditorSimpleTrimBtnMiniText}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

          </View>
        </View>
      </Modal>


    </View>
  );
}

const s = StyleSheet.create({

  topicTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },

  topicSub: {
    color: "#CFE8E8",
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.9,
  },

  videoEditorClipsWrap: {
    marginTop: 10,
    marginBottom: 8,
    minHeight: 86,
  } as ViewStyle,
  videoEditorClipsScroll: {
    paddingHorizontal: 5,
    paddingBottom: 2,
  } as ViewStyle,
  videoEditorClipsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  } as ViewStyle,
  videoEditorClipCard: {
    width: 148,
    borderRadius: 18,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 6,
  } as ViewStyle,
  videoEditorClipCardActive: {
    backgroundColor: "rgba(56,189,248,0.12)",
    borderColor: "rgba(56,189,248,0.34)",
  } as ViewStyle,
  videoEditorClipThumb: {
    height: 88,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  videoEditorClipThumbImage: {
    width: "100%",
    height: "100%",
  } as ImageStyle,
  videoEditorClipThumbFallback: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  videoEditorClipTitle: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: "800",
  } as TextStyle,
  videoEditorClipTitleActive: {
    color: "#fff",
  } as TextStyle,
  videoEditorClipMeta: {
  color: "rgba(255,255,255,0.58)",
  fontSize: 7,
  fontWeight: "700",
} as TextStyle,

  
  
  videoEditorScreen: {
    flex: 1,
    backgroundColor: "#000",
    paddingTop: 10,
    paddingBottom: 14,
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
    alignSelf: "center",
  } as ViewStyle,

  videoEditorScroll: {
    flex: 1,
  } as ViewStyle,

  videoEditorScrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
  } as ViewStyle,

  videoEditorTopBar: {
    position: "absolute",
    top: 56,
    left: 18,
    right: 18,
    zIndex: 50,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  } as ViewStyle,

  videoEditorTopBarSide: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 60,
  } as ViewStyle,

  videoEditorTopBarActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  } as ViewStyle,

  videoEditorMiniActionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,15,18,0.56)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  } as ViewStyle,

  videoEditorMiniActionBtnActive: {
    backgroundColor: "rgba(255,107,116,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,107,116,0.42)",
    shadowColor: "#FF6B74",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  } as ViewStyle,

  videoEditorMiniDangerBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,107,116,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,107,116,0.28)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  } as ViewStyle,

  videoEditorTopBarRight: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  } as ViewStyle,

  videoEditorTopBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,15,18,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  } as ViewStyle,

  videoEditorNextBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ff2d55",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#ff2d55",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  } as ViewStyle,

  videoEditorBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  } as ViewStyle,

  videoEditorCenter: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 96,
    width: "100%",
    maxWidth: "100%",
    overflow: "visible",
    alignSelf: "center",
  } as ViewStyle,

  videoEditorPreviewWrap: {
    width: "78%",
    maxWidth: 430,
    alignSelf: "center",
    aspectRatio: 9 / 16,
    flex: 0,
    minHeight: 410,
    borderRadius: 32,
    overflow: "hidden",
    backgroundColor: "#050505",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    marginTop: 18,
    marginBottom: 34,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  } as ViewStyle,

  videoEditorVideo: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  } as ViewStyle,

  videoEditorVideoFallback: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07111a",
    gap: 10,
  } as ViewStyle,

  videoEditorVideoFallbackText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13.5,
    fontWeight: "700",
  } as TextStyle,

  videoEditorPreviewShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.14)",
  } as ViewStyle,

  videoEditorPlayOverlay: {
    position: "absolute",
    bottom: 18,
    left: "50%",
    marginLeft: -26,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  } as ViewStyle,

  videoEditorPreviewTapLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  } as ViewStyle,

  videoEditorPreviewMetaLeft: {
    position: "absolute",
    left: 12,
    bottom: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    
    backgroundColor: "rgba(0,0,0,0.32)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorPreviewMetaRight: {
    position: "absolute",
    right: 10,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  } as ViewStyle,

  videoEditorMiniIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorTimeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.2,
    textShadowColor: "rgba(0,0,0,0.34)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  } as TextStyle,

  videoEditorMetaPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
    marginBottom: 14,
  } as ViewStyle,

  videoEditorMetaPill: {
    flex: 1,
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  } as ViewStyle,

  videoEditorMetaPillLabel: {
    color: "#7CC7FF",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 5,
  } as TextStyle,

  videoEditorMetaPillValue: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSectionTitle: {
    color: "rgba(255,255,255,0.96)",
    fontSize: 14,
    fontWeight: "900",
  } as TextStyle,

  videoEditorTrimBlock: {
    marginTop: 14,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  videoEditorTrimHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  } as ViewStyle,

  videoEditorTrimValue: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13.5,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSlider: {
    width: "100%",
    height: 34,
  } as ViewStyle,

  videoEditorTrimActions: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
  } as ViewStyle,

  videoEditorTrimBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorTrimBtnText: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  videoEditorTimelineWrap: {
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
  } as ViewStyle,

  videoEditorTimelineTrack: {
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    position: "relative",
    overflow: "hidden",
  
    pointerEvents: "box-none",} as ViewStyle,

  videoEditorTimelineSegment: {
    minWidth: 44,
    borderRadius: 14,
    marginRight: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorTimelineSegmentActive: {
    backgroundColor: "rgba(217,179,95,0.22)",
    borderColor: "rgba(217,179,95,0.34)",
  } as ViewStyle,

  videoEditorTimelineSegmentText: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoEditorPlayhead: {
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    marginLeft: -1.5,
    width: 3,
    backgroundColor: "#fff",
  } as ViewStyle,

  videoEditorLoopBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "rgba(0,0,0,0.46)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  } as ViewStyle,

  videoEditorLoopBadgeOn: {
    backgroundColor: "rgba(34,197,94,0.18)",
    borderColor: "rgba(34,197,94,0.32)",
  } as ViewStyle,

  videoEditorLoopBadgeText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSeekSlider: {
    width: "100%",
    height: 38,
    marginTop: 10,
  } as ViewStyle,

  videoEditorClipsHeader: {
    marginTop: 18,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as ViewStyle,

  videoEditorRemoveClipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  videoEditorRemoveClipText: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,
  videoEditorClipTabTop: {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: 4,
} as ViewStyle,
  videoEditorClipDot: {
  width: 5,
  height: 5,
  borderRadius: 999,
  marginRight: 4,
  backgroundColor: "rgba(255,255,255,0.24)",
} as ViewStyle,
  videoEditorClipDotActive: {
    backgroundColor: "#67C6FF",
  } as ViewStyle,

  videoEditorAddRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    marginBottom: 14,
  } as ViewStyle,

  videoEditorAddBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorAddBtnDisabled: {
    opacity: 0.45,
  } as ViewStyle,

  videoEditorAddBtnText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13.5,
    fontWeight: "900",
  } as TextStyle,
  videoEditorBodySpacer: {
    flex: 0,
    minHeight: 0,
  } as ViewStyle,

  videoEditorEditPanel: {
    marginTop: 18,
    marginBottom: 88,
    borderRadius: 26,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: "rgba(255,255,255,0.020)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  } as ViewStyle,

  videoEditorEditPanelCropMode: {
    marginTop: 34,
  } as ViewStyle,

  videoEditorEditPanelTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  } as ViewStyle,

  videoEditorEditPanelTitle: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  videoEditorEditPanelClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  } as ViewStyle,

  videoEditorEditGrid: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 6,
  } as ViewStyle,

  videoEditorEditToolCard: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.018)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  } as ViewStyle,

  videoEditorEditToolCardActive: {
    backgroundColor: "rgba(217,179,95,0.12)",
    borderColor: "rgba(255,224,140,0.28)",
    shadowColor: "#F2C96B",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  } as ViewStyle,

  videoEditorEditToolTextActive: {
    color: "#FFD978",
  } as TextStyle,

  videoEditorSpeedPanel: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
    marginBottom: -2,
  } as ViewStyle,

  videoEditorSpeedChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.020)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorSpeedChipActive: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(255,224,140,0.30)",
    shadowColor: "#F2C96B",
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  } as ViewStyle,

  videoEditorSpeedChipText: {
    color: "rgba(240,244,255,0.96)",
    fontSize: 10,
    fontWeight: "900",
  } as TextStyle,

  videoEditorSpeedChipTextActive: {
    color: "#FFE08A",
  } as TextStyle,

  videoEditorCropModeWrap: {
    marginTop: 2,
    marginBottom: 14,
    gap: 6,
  } as ViewStyle,

  videoEditorCropOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,

  videoEditorCropOverlayBox: {
    width: "76%",
    maxWidth: 260,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.95)",
    backgroundColor: "transparent",
  } as ViewStyle,

  videoEditorCropOverlayBoxFree: {
    aspectRatio: 9 / 16,
  } as ViewStyle,

  videoEditorCropGridV1: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "33.3333%",
    width: 1,
    backgroundColor: "rgba(255,255,255,0.28)",
  } as ViewStyle,

  videoEditorCropGridV2: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "66.6666%",
    width: 1,
    backgroundColor: "rgba(255,255,255,0.28)",
  } as ViewStyle,

  videoEditorCropGridH1: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "33.3333%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.28)",
  } as ViewStyle,

  videoEditorCropGridH2: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "66.6666%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.28)",
  } as ViewStyle,

  videoEditorCropCornerTL: {
    position: "absolute",
    top: -2,
    left: -2,
    width: 18,
    height: 32,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#fff",
  } as ViewStyle,

  videoEditorCropCornerTR: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: "#fff",
  } as ViewStyle,

  videoEditorCropCornerBL: {
    position: "absolute",
    bottom: -2,
    left: -2,
    width: 18,
    height: 18,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#fff",
  } as ViewStyle,

  videoEditorCropCornerBR: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: "#fff",
  } as ViewStyle,

  videoEditorCropRatioScroll: {
    width: "100%",
    marginTop: 2,
    marginBottom: 2,
  } as ViewStyle,

  videoEditorCropRatioScrollContent: {
    paddingRight: 12,
    alignItems: "center",
  } as ViewStyle,

  videoEditorCropRatioRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
  } as ViewStyle,

  videoEditorCropRatioChip: {
    minWidth: 66,
    paddingHorizontal: 14,
    minHeight: 38,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.020)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorCropRatioChipActive: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(255,224,140,0.30)",
  } as ViewStyle,

  videoEditorCropRatioChipText: {
    color: "rgba(240,244,255,0.94)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoEditorCropRatioChipTextActive: {
    color: "#FFE08A",
  } as TextStyle,

  videoEditorCropActionsSingle: {
    marginTop: 10,
    width: "100%",
    alignItems: "flex-end",
  } as ViewStyle,

  videoEditorCropActions: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  } as ViewStyle,

  videoEditorCropActionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.020)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorCropActionBtnPrimary: {
    backgroundColor: "rgba(255,224,140,0.96)",
    borderColor: "rgba(255,224,140,0.96)",
  } as ViewStyle,

  videoEditorCropApplyOnlyBtn: {
    minWidth: 124,
    height: 42,
    borderRadius: 13,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,224,140,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,224,140,0.96)",
  } as ViewStyle,

  videoEditorCropTopApplyWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -2,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "box-none",
  } as ViewStyle,

  videoEditorCropTopApplyBtn: {
    minWidth: 108,
    height: 22,
    
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,224,140,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,224,140,0.96)",
  } as ViewStyle,

  videoEditorCropTopApplyText: {
    color: "#111",
    fontSize: 10,
    fontWeight: "900",
  } as TextStyle,

  videoEditorCropActionText: {
    color: "rgba(240,244,255,0.94)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoEditorCropActionTextPrimary: {
    color: "#111",
    fontSize: 10,
    fontWeight: "900",
  } as TextStyle,

  videoEditorEditToolText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 8,
    fontWeight: "800",
  } as TextStyle,

  videoEditorTimelineMarksRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
    paddingHorizontal: 2,
  } as ViewStyle,

  videoEditorTimelineMarkText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 7,
    fontWeight: "800",
  } as TextStyle,

  videoEditorTimelineThumbRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  } as ViewStyle,

  videoEditorTimelineThumbCard: {
    flex: 1,
    height: 22,
    overflow: "hidden",
    paddingHorizontal: 0,
    paddingVertical: 0,
  
  } as ViewStyle,

  videoEditorTimelineThumbImage: {
    width: "100%",
    height: "100%",
  } as ImageStyle,

  videoEditorTimelineThumbFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,

  videoEditorTimelineAddBtn: {
    width: 38,
    minWidth: 38,
    height: 22,
    marginLeft: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.92)",
  } as ViewStyle,

  videoEditorSimpleTrimCard: {
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
    marginTop: 10,
  } as ViewStyle,

  videoEditorSimpleTrimHeader: {
    gap: 0,
    marginBottom: 0,
    paddingHorizontal: 0,
  } as ViewStyle,

  videoEditorSimpleTrimTitle: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "900",
    letterSpacing: 0,
  } as TextStyle,

  videoEditorSimpleTrimMeta: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 8,
    fontWeight: "700",
  } as TextStyle,

  videoEditorSimpleTrimLabel: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } as TextStyle,

  videoEditorSimpleTrimBtn: {
    minWidth: 62,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorSimpleTrimBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  videoEditorSimpleTrimWideBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.38)",
  } as ViewStyle,

  videoEditorSingleTrimRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginTop: 8,
  } as ViewStyle,

  trimLabelStart: {
    color: "#F5F7FA",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
  } as TextStyle,

  trimLabelEnd: {
    color: "#FF6B74",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
  } as TextStyle,

  trimInput: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    minWidth: 42,
    textAlign: "center",
    paddingVertical: 0,
    paddingHorizontal: 0,
  } as TextStyle,

  trimInputEnd: {
    color: "#FF6B74",
    fontSize: 18,
    fontWeight: "900",
    minWidth: 42,
    textAlign: "center",
    paddingVertical: 0,
    paddingHorizontal: 0,
  } as TextStyle,

  trimDivider: {
    color: "rgba(255,255,255,0.28)",
    fontSize: 12,
    fontWeight: "800",
    marginHorizontal: 1,
  } as TextStyle,

  trimLabelStartActive: {
    color: "#fff",
  } as TextStyle,

  trimLabelEndActive: {
    color: "#FF6B74",
  } as TextStyle,

  trimInputActive: {
    color: "#fff",
  } as TextStyle,

  trimInputEndActive: {
    color: "#FF6B74",
  } as TextStyle,

  videoEditorTrimTrackWrap: {
    marginTop: 6,
    marginBottom: 0,
    width: "100%",
  } as ViewStyle,

  videoEditorTrimTrackBox: {
    height: 42,
    justifyContent: "center",
    position: "relative",
    width: "100%",
    maxWidth: "100%",
    overflow: "visible",
  } as ViewStyle,

  videoEditorTrimTrackRail: {
    height: 7,
    
    backgroundColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorTrimTrackActive: {
    position: "absolute",
    top: 17.5,
    height: 7,
    
    backgroundColor: "rgba(255,77,77,0.82)",
    shadowColor: "#FF6B74",
    shadowOpacity: 0.10,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  } as ViewStyle,

  videoEditorTrimHandleStart: {
  } as ViewStyle,

  videoEditorTrimHandleEnd: {
  } as ViewStyle,

  videoEditorTrimHandleActive: {
    backgroundColor: "#fff",
    borderColor: "rgba(255,255,255,0.92)",
    transform: [{ scale: 1.08 }],
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  } as ViewStyle,

  videoEditorTrimHandleActiveEnd: {
    backgroundColor: "#FF6B74",
    borderColor: "rgba(255,77,77,0.96)",
    transform: [{ scale: 1.08 }],
    shadowColor: "#FF6B74",
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  } as ViewStyle,

  videoEditorTrimTrackTimeRow: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  } as ViewStyle,

  videoEditorTrimTrackTimeText: {
    color: "#F8FAFF",
    fontSize: 10,
    fontWeight: "900",
  } as TextStyle,

  videoEditorTrimTrackTimeTextEnd: {
    color: "#FF6B74",
    fontSize: 10,
    fontWeight: "900",
  } as TextStyle,

  videoEditorTrimTrackHint: {
    color: "rgba(255,255,255,0.26)",
    fontSize: 8,
    fontWeight: "700",
  } as TextStyle,

videoEditorSimpleTrimBtnsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  } as ViewStyle,

  videoEditorSimpleTrimBtnMini: {
    flex: 1,
    minHeight: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorSimpleTrimBtnMiniText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
  } as TextStyle,

  videoEditorSimpleTrimWideBtnText: {
    color: "#F6D98A",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  videoEditorBottomTools: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 14,
    gap: 6,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.015)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  } as ViewStyle,

  videoEditorBottomToolsScroll: {
    paddingHorizontal: 14,
    alignItems: "center",
  } as ViewStyle,

  videoEditorToolItem: {
    flex: 1,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.020)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  } as ViewStyle,

  videoEditorToolItemActive: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(255,224,140,0.32)",
    shadowColor: "#F2C96B",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  } as ViewStyle,

  videoEditorToolTextActive: {
    color: "#FFE08A",
  } as TextStyle,

  videoEditorToolText: {
    color: "rgba(240,244,255,0.96)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoEditorTimelineTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  } as ViewStyle,

  videoEditorTimelinePlayBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorPreviewWrapSplitMode: {
    minHeight: 392,
  } as ViewStyle,

  videoEditorEditPanelSplitMode: {
    marginTop: 18,
  } as ViewStyle,

  videoEditorSplitPreviewGuide: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,

  videoEditorSplitPreviewLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    
    backgroundColor: "rgba(255,224,140,0.96)",
  } as ViewStyle,

  videoEditorSplitPreviewHandle: {
    width: 28,
    height: 22,
    
    backgroundColor: "rgba(255,224,140,0.98)",
    borderWidth: 2,
    borderColor: "rgba(16,16,16,0.88)",
  } as ViewStyle,

  videoEditorSplitModeWrap: {
    marginTop: 2,
    gap: 4,
  } as ViewStyle,

  videoEditorSplitHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  } as ViewStyle,

  videoEditorSplitHintText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 16,
  } as TextStyle,

  videoEditorSplitSubHint: {
    marginTop: 10,
    color: "rgba(255,224,140,0.78)",
    fontSize: 10,
    fontWeight: "700",
  } as TextStyle,

  videoEditorSplitStatusRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  } as ViewStyle,

  videoEditorSplitStatusDot: {
    width: 8,
    height: 8,
    
    backgroundColor: "rgba(255,255,255,0.34)",
  } as ViewStyle,

  videoEditorSplitStatusDotGolden: {
    backgroundColor: "#D9B35F",
  } as ViewStyle,

  videoEditorSplitStatusDotStrong: {
    width: 10,
    height: 10,
    backgroundColor: "#FFE08A",
  } as ViewStyle,

  videoEditorSplitStatusText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSplitStatusTextGolden: {
    color: "#FFE08A",
  } as TextStyle,

  videoEditorSplitTimelineBadgeGolden: {
    backgroundColor: "#D9B35F",
    borderColor: "#FFE08A",
  } as ViewStyle,

  videoEditorSplitTimelineBadgeStrong: {
    transform: [{ scale: 1.06 }],
  } as ViewStyle,

  videoEditorSplitTimelineBadgeTextDark: {
    color: "#111",
  } as TextStyle,

  videoEditorSplitPartsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
  } as ViewStyle,

  videoEditorSplitPartCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  } as ViewStyle,

  videoEditorSplitPartCardLeft: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  videoEditorSplitPartCardRight: {
    backgroundColor: "rgba(217,179,95,0.10)",
    borderColor: "rgba(255,224,140,0.22)",
  } as ViewStyle,

  videoEditorSplitPartLabel: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  } as TextStyle,

  videoEditorSplitPartValue: {
    marginTop: 6,
    color: "rgba(255,255,255,0.96)",
    fontSize: 18,
    fontWeight: "900",
  } as TextStyle,

  videoEditorSplitPartMeta: {
    marginTop: 2,
    color: "rgba(255,255,255,0.56)",
    fontSize: 10,
    fontWeight: "700",
  } as TextStyle,

  videoEditorSplitLaneRow: {
    marginTop: 2,
    marginBottom: 8,
    flexDirection: "row",
    gap: 6,
  } as ViewStyle,

  videoEditorSplitLanePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    
    borderWidth: 1,
  } as ViewStyle,

  videoEditorSplitLanePillSoft: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorSplitLanePillStrong: {
    backgroundColor: "rgba(217,179,95,0.10)",
    borderColor: "rgba(217,179,95,0.24)",
  } as ViewStyle,

  videoEditorSplitLanePillGolden: {
    backgroundColor: "#D9B35F",
    borderColor: "#FFE08A",
  } as ViewStyle,

  videoEditorSplitLanePillText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  } as TextStyle,

  videoEditorSplitLanePillTextDark: {
    color: "#111",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  } as TextStyle,

  videoEditorSplitTimelineWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 2,
  } as ViewStyle,

  videoEditorSplitTimeLeft: {
    width: 32,
    color: "rgba(255,255,255,0.62)",
    fontSize: 8,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSplitTimeRight: {
    width: 32,
    textAlign: "right",
    color: "rgba(255,255,255,0.62)",
    fontSize: 8,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSplitRulerScroll: {
    width: "100%",
    minHeight: 82,
  } as ViewStyle,

  videoEditorSplitRulerContent: {
    alignItems: "flex-start",
    paddingTop: 18,
    paddingBottom: 22,
    paddingHorizontal: 0,
  } as ViewStyle,

  videoEditorSplitTickCol: {
    width: 44,
    alignItems: "center",
    justifyContent: "flex-start",
  } as ViewStyle,

  videoEditorSplitTick: {
    width: 2,
    
    backgroundColor: "rgba(255,255,255,0.88)",
  } as ViewStyle,

  videoEditorSplitTickMajor: {
    height: 34,
    backgroundColor: "rgba(246,220,140,0.98)",
  } as ViewStyle,

  videoEditorSplitTickMedium: {
    height: 22,
    backgroundColor: "rgba(255,255,255,0.88)",
  } as ViewStyle,

  videoEditorSplitTickMinor: {
    height: 16,
    backgroundColor: "rgba(255,255,255,0.40)",
  } as ViewStyle,

  videoEditorSplitTickLabel: {
    marginTop: 6,
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSplitTimelineTrack: {
    flex: 1,
    height: 46,
    justifyContent: "center",
  } as ViewStyle,

  videoEditorSplitTimelineLine: {
    height: 4,
    
    backgroundColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorSplitTimelineRail: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 18,
    height: 7,
    
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  } as ViewStyle,

  videoEditorTrimHandle: {
    position: "absolute",
    top: 9,
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: -11,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.16)",
    zIndex: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  } as ViewStyle,

  videoEditorTrimHandleLeft: {
  } as ViewStyle,

  videoEditorTrimHandleRight: {
  } as ViewStyle,

  videoEditorSplitTimelineRailFill: {
    height: "100%",
    
    backgroundColor: "rgba(255,224,140,0.96)",
  } as ViewStyle,

  videoEditorSplitSlider: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 8,
    height: 22,
    backgroundColor: "transparent",
  } as ViewStyle,

  videoEditorSplitTimelineCenter: {
    position: "absolute",
    left: "50%",
    top: -8,
    alignItems: "center",
    transform: [{ translateX: -1.5 }],
  } as ViewStyle,

  videoEditorSplitTimelineNeedle: {
    width: 3,
    height: 34,
    
    backgroundColor: "rgba(255,224,140,0.98)",
  } as ViewStyle,

  videoEditorSplitTimelineBadge: {
    marginTop: 6,
    minWidth: 60,
    paddingHorizontal: 10,
    height: 22,
    
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,224,140,0.96)",
  } as ViewStyle,

  
  videoEditorSplitStripContent: {
    paddingHorizontal: 88,
    alignItems: "center",
    gap: 1,
  } as ViewStyle,

  videoEditorSplitStripTick: {
    width: 9,
    height: 30,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
  } as ViewStyle,

  videoEditorSplitStripTickTall: {
    height: 30,
    backgroundColor: "rgba(255,255,255,0.24)",
  } as ViewStyle,

  videoEditorSplitStripGolden: {
    backgroundColor: "rgba(217,179,95,0.72)",
    opacity: 1,
  } as ViewStyle,

  videoEditorSplitStripStrong: {
    height: 30,
    backgroundColor: "rgba(255,224,140,0.92)",
  } as ViewStyle,

videoEditorSplitTimelineBadgeText: {
    color: "#111",
    fontSize: 8,
    fontWeight: "900",
  } as TextStyle,

  videoEditorSplitActionRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  } as ViewStyle,

  videoEditorSplitGhostBtn: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoEditorSplitGhostBtnText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "800",
  } as TextStyle,

  videoEditorSplitApplyBtn: {
    flex: 1.12,
    height: 42,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,224,140,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,224,140,0.96)",
  } as ViewStyle,

  videoEditorSplitApplyBtnText: {
    color: "#111",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  screen: { flex: 1, backgroundColor: BG, paddingHorizontal: PAD } as ViewStyle,

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 2,
    paddingBottom: 14,
    marginBottom: 2,
  } as ViewStyle,
  headerMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    marginRight: 8,
  } as ViewStyle,
  headerAvatarWrap: {
    width: 54,
    height: 54,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  headerAvatarGlow: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(217,179,95,0.16)",
    shadowColor: GOLD_SOLID,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  } as ViewStyle,
  headerAvatarRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    padding: 2,
    backgroundColor: "rgba(217,179,95,0.95)",
    shadowColor: GOLD_SOLID,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  } as ViewStyle,
  headerAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  } as ViewStyle,
  headerAvatarImg: {
    width: "100%",
    height: "100%",
  } as any,
  headerOnlineDot: {
    display: "none",
    width: 0,
    height: 0,
    opacity: 0,
  } as ViewStyle,
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 2,
    justifyContent: "center",
    gap: 2,
      } as ViewStyle,
  presenceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    flexWrap: "nowrap",
    gap: 6,
  } as ViewStyle,
  presenceOnlineDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#4ADE80",
    shadowColor: "#4ADE80",
    shadowOpacity: 0.85,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
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

  hBtnGold: {
    backgroundColor: "rgba(217,179,95,0.08)",
    borderColor: "rgba(217,179,95,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  } as ViewStyle,

  vipSubOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
  },
  vipSubBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,8,18,0.66)",
  },
  vipSubCard: {
    width: "100%",
    borderRadius: 32,
    padding: 22,
    overflow: "hidden",
    backgroundColor: "rgba(8,18,40,0.96)",
    borderWidth: 1.5,
    borderColor: "rgba(96,150,255,0.42)",
    shadowColor: "#5B8DFF",
    shadowOpacity: 0.28,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 30,
  },
  vipSubGlow: {
    position: "absolute",
    right: -70,
    top: -80,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "rgba(90,130,255,0.18)",
  },
  vipSubTopLine: {
    height: 1.4,
    borderRadius: 2,
    backgroundColor: "rgba(120,160,255,0.48)",
    marginBottom: 18,
  },
  vipSubIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    backgroundColor: "rgba(90,130,255,0.12)",
    borderWidth: 2,
    borderColor: "rgba(120,160,255,0.48)",
  },
  vipSubTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  vipSubText: {
    marginTop: 10,
    color: "rgba(226,234,255,0.76)",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "800",
  },
  vipSubBtn: {
    marginTop: 22,
    height: 58,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5B8DFF",
  },
  vipSubBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },

  menuOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.82)",
  } as ViewStyle,
  menuBodyScroll: {
    flex: 1,
  } as ViewStyle,

  menuSheetTop: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "rgba(2,6,23,0.96)",
    zIndex: 3,
  } as ViewStyle,

  menuScrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 34,
    flexGrow: 1,
  } as ViewStyle,
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
  } as ViewStyle,
  menuSheet: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
    paddingTop: 54,
    paddingHorizontal: 0,
    backgroundColor: "rgba(2,6,23,0.96)",
  } as ViewStyle,
  menuHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    
    backgroundColor: "rgba(255,255,255,0.14)",
    marginBottom: 8,
  } as ViewStyle,
  menuHeader: {
    paddingHorizontal: 2,
    paddingBottom: 10,
  } as ViewStyle,
  menuHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  } as ViewStyle,
  menuHeaderIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 10,
  } as ViewStyle,
  menuHeaderAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    overflow: "hidden",
  } as ViewStyle,
  menuHeaderAvatarImg: {
    width: "100%",
    height: "100%",
  } as any,
  menuHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  } as ViewStyle,
  menuCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  menuProfileCard: {
    marginTop: 10,
    marginBottom: 16,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 26,
    backgroundColor: "rgba(16,21,35,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    overflow: "hidden",
  } as ViewStyle,
  menuProfileGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.028)",
  } as ViewStyle,
  menuProfileTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as ViewStyle,

  menuProfileHeroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } as ViewStyle,

  menuProfileHeroText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
    minHeight: 1,
  } as ViewStyle,
  menuProfileCardFloatWrap: {
    marginTop: 2,
    marginBottom: 2,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  } as ViewStyle,
  menuProfileCardGlow: {
    position: "absolute",
    top: -30,
    right: -10,
    width: 220,
    height: 220,
    
    backgroundColor: "rgba(120,110,255,0.11)",
    opacity: 0.34,
  } as ViewStyle,
  menuFactCard: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: "rgba(58,38,92,0.56)",
    borderWidth: 1,
    justifyContent: "center",
    borderColor: "rgba(190,120,255,0.22)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    position: "relative",
    overflow: "hidden",
  } as ViewStyle,
  menuFactCardBlue: {
    backgroundColor: "rgba(65,145,255,0.08)",
    borderColor: "rgba(65,145,255,0.18)",
  } as ViewStyle,
  menuFactCardEmerald: {
    backgroundColor: "rgba(46,204,113,0.08)",
    borderColor: "rgba(46,204,113,0.18)",
  } as ViewStyle,
  menuFactCardPurple: {
    backgroundColor: "rgba(155,89,182,0.10)",
    borderColor: "rgba(155,89,182,0.18)",
  } as ViewStyle,
  menuProfileAvatarWrap: {
    width: 62,
    height: 62,
    marginRight: 14,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  menuProfileAvatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  } as ViewStyle,
  menuProfileOnlineDot: {
    position: "absolute",
    right: 3,
    bottom: 3,
    width: 13,
    height: 13,
    
    backgroundColor: "#35C759",
    borderWidth: 2,
    borderColor: "rgba(10,15,26,0.98)",
  } as ViewStyle,
  menuProfileTextWrap: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,
  menuPresencePill: {
    marginLeft: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  } as ViewStyle,
  menuPresencePillOnline: {
    backgroundColor: "rgba(53,199,89,0.10)",
    borderColor: "rgba(53,199,89,0.18)",
  } as ViewStyle,
  menuPresencePillBlue: {
    backgroundColor: "rgba(65,145,255,0.10)",
    borderColor: "rgba(65,145,255,0.16)",
  } as ViewStyle,
  menuPresencePillEmerald: {
    backgroundColor: "rgba(46,204,113,0.10)",
    borderColor: "rgba(46,204,113,0.16)",
  } as ViewStyle,
  menuPresencePillPurple: {
    backgroundColor: "rgba(155,89,182,0.12)",
    borderColor: "rgba(155,89,182,0.18)",
  } as ViewStyle,
  menuProfileInfoBlock: {
    marginTop: 10,
  } as ViewStyle,
  menuProfileInfoBlockCompact: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  } as ViewStyle,
  menuProfileTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
  } as ViewStyle,
  menuProfileTag: {
    marginRight: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.14)",
  } as ViewStyle,
  menuRow: {
    minHeight: 58,
    borderRadius: 20,
    paddingHorizontal: 15,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.052)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.085)",
  } as ViewStyle,
  menuRowDanger: {
    marginTop: 12,
    backgroundColor: "rgba(255,60,60,0.055)",
    borderColor: "rgba(255,60,60,0.16)",
  } as ViewStyle,
  menuIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  } as ViewStyle,
  menuIconWrapDanger: {
    backgroundColor: "rgba(255,90,95,0.08)",
    borderColor: "rgba(255,90,95,0.18)",
  } as ViewStyle,

  ministryStatsRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 2,
    alignItems: "stretch",
  } as ViewStyle,
  ministryMiniCard: {
    flex: 1,
    minHeight: 98,
    justifyContent: "flex-start",
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 12,
  } as ViewStyle,
  ministryMiniCardPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.985 }],
  } as ViewStyle,
  statCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  } as ViewStyle,
  statCardIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    borderWidth: 1,
  } as ViewStyle,
  statCardIconWrapEmerald: {
    backgroundColor: "rgba(46,204,113,0.10)",
    borderColor: "rgba(46,204,113,0.16)",
  } as ViewStyle,
  statCardIconWrapPurple: {
    backgroundColor: "rgba(155,89,182,0.12)",
    borderColor: "rgba(155,89,182,0.18)",
  } as ViewStyle,
  statCardIconWrapBlue: {
    backgroundColor: "rgba(65,145,255,0.10)",
    borderColor: "rgba(65,145,255,0.18)",
  } as ViewStyle,
  statCardLabelText: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.1,
  } as TextStyle,
  statCardLabelTextStack: {
    marginTop: 9,
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: 0.7,
  } as TextStyle,
  statCardValueText: {
    marginTop: 7,
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: -0.7,
  } as TextStyle,
  statCardHintText: {
    marginTop: 4,
    color: "rgba(255,255,255,0.52)",
    fontSize: 8.5,
    lineHeight: 10,
    fontWeight: "700",
  } as TextStyle,
  statusSummaryCard: {
    paddingTop: 10,
    paddingBottom: 14,
  } as ViewStyle,
  statusSummaryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as ViewStyle,
  statusSummaryLiveDot: {
    width: 8,
    height: 8,
    
    backgroundColor: "rgba(120,190,255,0.95)",
  } as ViewStyle,
  statusSummaryValue: {
    marginTop: 12,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "900",
    letterSpacing: -0.35,
  } as TextStyle,
  statusSummaryPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  } as ViewStyle,
  statusSummaryPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    
    borderWidth: 1,
  } as ViewStyle,
  statusSummaryPillNeutral: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  statusSummaryPillEmerald: {
    backgroundColor: "rgba(46,204,113,0.10)",
    borderColor: "rgba(46,204,113,0.18)",
  } as ViewStyle,
  statusSummaryPillBlue: {
    backgroundColor: "rgba(65,145,255,0.10)",
    borderColor: "rgba(65,145,255,0.18)",
  } as ViewStyle,
  statusSummaryPillText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
  } as TextStyle,
  menuRowPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.995 }],
  } as ViewStyle,
  menuRowTextStrong: {
    flex: 1,
    fontWeight: "800",
    letterSpacing: -0.1,
  } as TextStyle,
  menuChevronWrap: {
    width: 28,
    height: 22,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  } as ViewStyle,
  menuChevronWrapDanger: {
    backgroundColor: "rgba(255,90,95,0.05)",
    borderColor: "rgba(255,90,95,0.10)",
  } as ViewStyle,
  assignmentMenuColumns: {
    width: "100%",
    flexDirection: "column",
    gap: 18,
  } as ViewStyle,
  assignmentMenuColumnLeft: {
    width: "100%",
    gap: 18,
  } as ViewStyle,
  assignmentMenuColumnRight: {
    width: "100%",
    gap: 18,
  } as ViewStyle,

  menuSectionBlock: {
    marginBottom: 10,
  } as ViewStyle,

  menuTileGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 18,
    columnGap: 0,
  } as ViewStyle,
  menuTileActiveGlow: {
    borderColor: "rgba(244,208,111,0.58)",
    backgroundColor: "rgba(244,208,111,0.085)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  menuTileLabelActive: {
    color: "#FFFFFF",
    textShadowColor: "rgba(244,208,111,0.35)",
    textShadowRadius: 10,
  },

  menuTile: {
    width: "48%",
    minHeight: 132,
    height: 132,
    borderRadius: 28,
    padding: 16,
    backgroundColor: "rgba(18,22,34,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    justifyContent: "space-between",
  } as ViewStyle,
  menuTileFullWidth: {
    width: "100%",
    minHeight: 132,
    height: 132,
    marginRight: 0,
    marginBottom: 0,
  } as ViewStyle,
  menuTileHalf: {
    width: "48%",
    minHeight: 132,
    height: 132,
  } as ViewStyle,
  menuTileMinistryCompact: {
    width: "100%",
    minHeight: 132,
    height: 132,
  } as ViewStyle,
  menuTileDanger: {
    backgroundColor: "rgba(80,18,28,0.22)",
    borderColor: "rgba(255,90,95,0.24)",
  } as ViewStyle,

  menuTileDisabled: {
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(15,18,28,0.92)",
  } as ViewStyle,
  menuTilePressed: {
    opacity: 0.96,
    transform: [{ scale: 0.985 }],
  } as ViewStyle,
  menuTileTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  } as ViewStyle,
  menuTileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.09)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  } as ViewStyle,
  menuTileIconWrapDanger: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.20)",
  } as ViewStyle,
  menuTileChevronWrap: {
    width: 30,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  } as ViewStyle,
  menuTileChevronWrapDanger: {
    width: 30,
    height: 28,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.12)",
  } as ViewStyle,
  menuTileLabel: {
    marginTop: 14,
    color: "rgba(255,255,255,0.98)",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: -0.2,
  } as TextStyle,
  menuTileLabelDanger: {
    color: "#FF8A8F",
  } as TextStyle,
  menuDangerWide: {
    marginTop: 10,
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(80,18,28,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.24)",
  } as ViewStyle,
  menuDangerWideLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
  } as ViewStyle,
  menuDangerWideText: {
    color: "#FF8A8F",
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: -0.1,
    flex: 1,
  } as TextStyle,

  memberBoardTabsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
  },
  memberBoardTabBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.035)",
    alignItems: "center",
    justifyContent: "center",
  },
  memberBoardTabBtnActive: {
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.15)",
  },
  memberBoardTabText: {
    color: "rgba(255,255,255,0.60)",
    fontWeight: "900",
    fontSize: 11,
  },
  memberBoardTabTextActive: {
    color: "#FFFFFF",
  },
  memberBoardTabCount: {
    marginTop: 2,
    color: "rgba(255,255,255,0.42)",
    fontWeight: "900",
    fontSize: 10,
  },
  memberBoardTabCountActive: {
    color: "#D9B35F",
  },
  mcHostSummaryCard: {
    marginTop: 12,
    marginBottom: 10,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  } as ViewStyle,
  mcHostSummaryText: {
    color: "rgba(255,255,255,0.88)",
    fontWeight: "900",
    fontSize: 13,
  } as TextStyle,
  mcHostRow: {
    borderRadius: 22,
    padding: 12,
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  mcHostRowSelected: {
    backgroundColor: "rgba(217,179,95,0.075)",
    borderColor: "rgba(217,179,95,0.25)",
  } as ViewStyle,
  mcHostLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingRight: 12,
  } as ViewStyle,
  mcHostAvatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  } as ViewStyle,
  mcHostName: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  } as TextStyle,
  mcHostMeta: {
    marginTop: 4,
    color: "rgba(255,255,255,0.55)",
    fontWeight: "700",
    fontSize: 12,
  } as TextStyle,
  mcHostCheck: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,
  mcHostCheckOn: {
    backgroundColor: "#D9B35F",
    borderColor: "#D9B35F",
  } as ViewStyle,
  memberSheet: {
    marginTop: "auto",
    marginHorizontal: 10,
    marginBottom: 8,
    backgroundColor: "rgba(9,13,21,0.985)",
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    maxHeight: "82%",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
  } as ViewStyle,
  memberSheetHeader: {
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  memberListContent: {
    paddingTop: 8,
    paddingBottom: 12,
  } as ViewStyle,
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.075)",
  } as ViewStyle,
  memberRowLeader: {
    backgroundColor: "rgba(217,179,95,0.045)",
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,
  memberAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 24,
  },

  memberAvatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,
  memberAvatarLeader: {
    borderColor: "rgba(217,179,95,0.85)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  } as ViewStyle,
  memberAvatarMember: {
    borderColor: "rgba(38,207,113,0.45)",
  } as ViewStyle,
  memberCrownBadge: {
    position: "absolute",
    bottom: -3,
    right: -1,
    width: 21,
    height: 21,
    borderRadius: 10.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D9B35F",
    borderWidth: 2,
    borderColor: "#10151F",
  } as ViewStyle,
  memberBody: {
    flex: 1,
  } as ViewStyle,
  memberMain: {
    flex: 1,
    gap: 6,
  } as ViewStyle,
  memberTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  } as ViewStyle,
  memberBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  } as ViewStyle,
  memberMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  } as ViewStyle,
  memberRolePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
    borderWidth: 1,
  } as ViewStyle,
  memberRolePastor: {
    backgroundColor: "rgba(217,179,95,0.13)",
    borderColor: "rgba(217,179,95,0.42)",
  } as ViewStyle,
  memberRoleAdmin: {
    backgroundColor: "rgba(82,146,255,0.13)",
    borderColor: "rgba(82,146,255,0.40)",
  } as ViewStyle,
  memberRoleMember: {
    backgroundColor: "rgba(80,214,144,0.11)",
    borderColor: "rgba(80,214,144,0.36)",
  } as ViewStyle,
  memberStatusPill: {
    marginLeft: "auto",
    
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  } as ViewStyle,
  memberStatusActive: {
    backgroundColor: "rgba(120,235,170,0.10)",
    borderColor: "rgba(120,235,170,0.24)",
  } as ViewStyle,
  memberStatusSuspended: {
    backgroundColor: "rgba(210,170,255,0.10)",
    borderColor: "rgba(210,170,255,0.24)",
  } as ViewStyle,
  memberDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginLeft: 58,
  } as ViewStyle,
  memberEmpty: {
    paddingVertical: 24,
    alignItems: "center",
  } as ViewStyle,
  menuCancelBtn: {
    minHeight: 40,
    borderRadius: 18,
    marginTop: 7,
    marginBottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  frame: {
    flex: 1,
    borderRadius: 26,
    backgroundColor: "rgba(4,8,16,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  } as ViewStyle,

  chatBeamLeft: {
    position: "absolute",
    top: -40,
    left: "18%",
    width: 120,
    height: "120%",
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.035)",
    transform: [{ rotate: "-12deg" }],
  } as ViewStyle,
  chatBeamRight: {
    position: "absolute",
    top: -20,
    right: "8%",
    width: 90,
    height: "110%",
    borderRadius: 999,
    backgroundColor: "rgba(139,92,246,0.04)",
    transform: [{ rotate: "10deg" }],
  } as ViewStyle,
  chatAmbientWash: {
    ...StyleSheet.absoluteFillObject,
  } as ViewStyle,
  chatNoiseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.012)",
    opacity: 0.55,
  } as ViewStyle,
  chatEmptyWatermark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    zIndex: 0,
  } as ViewStyle,
  chatEmptyWatermarkGlow: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(217,179,95,0.05)",
  } as ViewStyle,
  chatEmptyWatermarkTitle: {
    marginTop: 12,
    color: "rgba(255,255,255,0.10)",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 1.4,
    textAlign: "center",
    textTransform: "uppercase",
  } as TextStyle,
  chatEmptyWatermarkSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.05)",
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.8,
    textAlign: "center",
  } as TextStyle,
  chatEmptyList: {
    padding: 24,
    alignItems: "center",
    opacity: 0.72,
  } as ViewStyle,

  bubbleWrap: { marginBottom: 16, maxWidth: "80%" } as ViewStyle,

  assignmentTimelineWrap: {
    flexDirection: "row",
    alignItems: "stretch",
    alignSelf: "flex-start",
    width: "100%",
    marginBottom: 18,
    paddingLeft: 6,
    paddingRight: 8,
  } as ViewStyle,

  assignmentTimelineRail: {
    width: 52,
    alignItems: "center",
    position: "relative",
    marginRight: 10,
  } as ViewStyle,

  assignmentTimelineLine: {
    position: "absolute",
    top: 0,
    bottom: -22,
    width: 3,
    
    backgroundColor: "rgba(56,230,200,0.42)",
  } as ViewStyle,

  assignmentTimelineLineOpen: {
    backgroundColor: "rgba(217,179,95,0.34)",
  } as ViewStyle,

  assignmentTimelineLineTaken: {
    backgroundColor: "rgba(56,189,248,0.52)",
  } as ViewStyle,

  assignmentTimelineLineDone: {
    backgroundColor: "rgba(52,211,153,0.48)",
  } as ViewStyle,

  assignmentTimelineNode: {
    marginTop: 62,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16,22,34,0.98)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 2,
  } as ViewStyle,

  assignmentTimelineNodeOpen: {
    backgroundColor: "rgba(28,24,16,0.98)",
    borderColor: "rgba(217,179,95,0.34)",
    shadowColor: "rgba(217,179,95,0.40)",
    shadowOpacity: 0.28,
  } as ViewStyle,

  assignmentTimelineNodeTaken: {
    backgroundColor: "rgba(10,28,52,0.98)",
    borderColor: "rgba(56,189,248,0.44)",
    shadowColor: "rgba(56,189,248,0.50)",
    shadowOpacity: 0.34,
    shadowRadius: 12,
  } as ViewStyle,

  assignmentTimelineNodeDone: {
    backgroundColor: "rgba(10,36,28,0.98)",
    borderColor: "rgba(52,211,153,0.38)",
    shadowColor: "rgba(52,211,153,0.44)",
    shadowOpacity: 0.30,
    shadowRadius: 10,
  } as ViewStyle,

  assignmentTimelineContent: {
    flex: 1,
    minWidth: 0,
    maxWidth: "96%",
    gap: 6,
    paddingTop: 1,
  } as ViewStyle,

  assignmentTime: {
    color: "rgba(255,255,255,0.34)",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  } as TextStyle,

  bubble: {
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 15,
    paddingVertical: 13,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  } as ViewStyle,

  assignmentActionRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } as ViewStyle,

  assignmentActionBtn: {
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 16,
    paddingVertical: 0,
    borderRadius: 999,
    borderWidth: 1.2,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,

  assignmentActionBtnPrimary: {
    backgroundColor: "rgba(217,179,95,0.30)",
    borderColor: "rgba(245,215,128,0.95)",
    shadowColor: "#F5D780",
    shadowOpacity: 0.46,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  } as ViewStyle,

  assignmentActionBtnGhost: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
  } as ViewStyle,

  assignmentActionBtnPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.982 }],
  } as ViewStyle,

  bubbleMine: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.38)",
    shadowColor: GOLD_SOLID,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  } as ViewStyle,
  bubbleMineSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 34,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  } as ViewStyle,
  msgMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
  } as ViewStyle,
  deliveredRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  } as ViewStyle,

  bubbleOther: {
    backgroundColor: "rgba(255,255,255,0.055)",
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  } as ViewStyle,

  otherRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  } as ViewStyle,
  avatarSpacer: {
    width: 44,
    flexShrink: 0,
  } as ViewStyle,
  bubblePastor: {
    backgroundColor: "rgba(88, 38, 138, 0.82)",
    borderColor: "rgba(196, 121, 255, 0.72)",
    borderWidth: 1.4,
    shadowColor: "#C084FC",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  bubbleOtherInline: {
    flexShrink: 1,
    maxWidth: "100%",
  } as ViewStyle,
  avatarMiniImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },
  avatarMini: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    marginTop: 10,
    marginRight: 10,
  } as ViewStyle,
  avatarMiniInline: {
    width: 22,
    height: 22,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    marginRight: 12,
    marginTop: 2,
    flexShrink: 0,
  } as ViewStyle,

  attachBlock: { marginTop: 8 } as ViewStyle,
  attachRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  composer: { marginTop: 12, marginBottom: 8, flexDirection: "row", alignItems: "flex-end", gap: 8 } as ViewStyle,
  cBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  } as ViewStyle,
  cBtnPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.97 }],
  } as ViewStyle,

  inputWrap: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  } as ViewStyle,
  inputWrapFocused: {
    borderColor: "rgba(139,92,246,0.48)",
    backgroundColor: "rgba(139,92,246,0.08)",
    shadowColor: PURPLE,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  } as ViewStyle,

  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  sendBtnActive: {
    backgroundColor: "rgba(139,92,246,0.96)",
    borderColor: "rgba(196,181,253,0.55)",
    shadowColor: PURPLE,
    shadowOpacity: 0.48,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  } as ViewStyle,
  sendBtnDisabled: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" } as ViewStyle,

  pendingBar: {
    marginTop: 10,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  pendingList: { marginTop: 10, flexDirection: "row", flexWrap: "wrap" } as ViewStyle,
  pendingPill: {
    marginRight: 8,
    marginBottom: 8,
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  headerTitleClip: {
    width: "100%",
    overflow: "hidden",
  } as ViewStyle,

  headerTitleAnimated: {
    includeFontPadding: false,
  } as TextStyle,

  headerActions: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingTop: 0,
  } as ViewStyle,

  videoEditCard: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 24,
    padding: 18,
    backgroundColor: "rgba(10,16,28,0.98)",
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.18)",
  } as ViewStyle,

  videoPreviewBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  videoPreviewBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(56,189,248,0.12)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.24)",
  } as ViewStyle,

  videoStatsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 14,
  } as ViewStyle,

  videoStatPill: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  trimEditorSection: {
    marginTop: 14,
    gap: 6,
  } as ViewStyle,

  trimBtnRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  } as ViewStyle,

  trimBtn: {
    minWidth: 68,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoFitInfo: {
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "rgba(56,189,248,0.08)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.18)",
  } as ViewStyle,

  videoQuickRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 14,
  } as ViewStyle,

  videoQuickBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoQuickBtnPrimary: {
    backgroundColor: "rgba(56,189,248,0.14)",
    borderColor: "rgba(56,189,248,0.30)",
  } as ViewStyle,

  videoFooterRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  } as ViewStyle,

  videoFooterBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  videoFooterBtnPrimary: {
    backgroundColor: "rgba(217,179,95,0.96)",
    borderColor: "rgba(217,179,95,0.24)",
  } as ViewStyle,

  liveBtn: {
    minWidth: 72,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    alignSelf: "center",
  } as ViewStyle,
  liveBtnGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  } as ViewStyle,
  liveBtnScheduled: {
    borderColor: "rgba(245,215,128,0.48)",
    shadowColor: GOLD_SOLID,
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  } as ViewStyle,
  liveBtnPreview: {
    borderColor: "rgba(34,197,94,0.42)",
    shadowColor: "#22C55E",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  } as ViewStyle,
  liveBtnLive: {
    borderColor: "rgba(34,197,94,0.58)",
    shadowColor: "#22C55E",
    shadowOpacity: 0.36,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  } as ViewStyle,
  liveBtnIdle: {
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  } as ViewStyle,

});

const t = StyleSheet.create({
  hTitle: {
    color: "rgba(255,255,255,0.98)",
    fontWeight: "900",
    fontSize: 15,
    letterSpacing: -0.2,
    lineHeight: 18,
  } as TextStyle,
  hSub: {
    color: "rgba(255,255,255,0.56)",
    fontWeight: "700",
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.15,
  } as TextStyle,

  videoEditTitle: {
    color: "rgba(255,255,255,0.98)",
    fontSize: 18,
    fontWeight: "900",
  } as TextStyle,

  videoEditSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.70)",
    fontSize: 12,
    lineHeight: 20,
  } as TextStyle,

  videoPreviewName: {
    color: "rgba(255,255,255,0.98)",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  } as TextStyle,

  videoPreviewMeta: {
    marginTop: 3,
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    lineHeight: 16,
  } as TextStyle,

  videoStatLabel: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  videoStatValue: {
    marginTop: 2,
    color: "rgba(255,255,255,0.96)",
    fontSize: 13.5,
    fontWeight: "900",
  } as TextStyle,

  trimSectionTitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  trimBtnText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  videoFitInfoText: {
    color: "rgba(125,211,252,0.96)",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 20,
  } as TextStyle,

  videoQuickBtnText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  videoQuickBtnPrimaryText: {
    color: "rgba(125,211,252,0.98)",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  videoFooterBtnText: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 13.5,
    fontWeight: "900",
  } as TextStyle,

  videoFooterBtnPrimaryText: {
    color: "rgba(20,16,8,0.98)",
    fontSize: 13.5,
    fontWeight: "900",
  } as TextStyle,

  liveBtnText: {
    color: "#D9B35F",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 1.1,
  } as TextStyle,
  liveBtnTextScheduled: {
    color: "rgba(245,215,128,0.98)",
  } as TextStyle,
  liveBtnTextLive: {
    color: "rgba(134,239,172,0.98)",
  } as TextStyle,
  liveBtnTextIdle: {
    color: "rgba(248,113,113,0.92)",
  } as TextStyle,

  headerAvatarText: { color: "rgba(217,179,95,0.98)", fontWeight: "900", fontSize: 17 } as TextStyle,
  presenceDivider: { marginHorizontal: 6, color: "rgba(255,255,255,0.35)", fontWeight: "800", fontSize: 12 } as TextStyle,
  presenceText: { color: "rgba(255,255,255,0.58)", fontWeight: "700", fontSize: 12 } as TextStyle,
  presenceOnline: {
    color: "#4ADE80",
    textShadowColor: "rgba(74,222,128,0.55)",
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 0 },
  } as TextStyle,

  senderName: { color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 } as TextStyle,
  msgText: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 14.5,
    lineHeight: 21,
    flexShrink: 1,
} as TextStyle,
  msgTimeMine: {
    color: "rgba(255,255,255,0.42)",
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 0.2,
  } as TextStyle,
  msgTimeOther: {
    marginTop: 8,
    color: "rgba(255,255,255,0.38)",
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 0.2,
    alignSelf: "flex-end",
  } as TextStyle,
  deliveredText: {
    color: "rgba(196,181,253,0.78)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.25,
  } as TextStyle,
  msgTime: { marginTop: 10, color: "rgba(255,255,255,0.45)", fontWeight: "800", fontSize: 8, alignSelf: "flex-end" } as TextStyle,

  avatarMiniText: { color: "rgba(217,179,95,0.95)", fontWeight: "900", fontSize: 11 } as TextStyle,

  assignmentClaimedBy: {
    marginTop: 2,
    color: "rgba(125,211,252,0.92)",
    fontSize: 10,
    fontWeight: "800",
  } as TextStyle,

  assignmentStatusText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  } as TextStyle,

  assignmentStatusTextOpen: {
    color: "rgba(217,179,95,0.98)",
  } as TextStyle,

  assignmentStatusTextTaken: {
    color: "rgba(125,211,252,0.98)",
  } as TextStyle,

  assignmentStatusTextDone: {
    color: "rgba(134,239,172,0.98)",
  } as TextStyle,

  assignmentActionTextPrimary: {
    color: "#161106",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  } as TextStyle,

  assignmentActionTextGhost: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
  } as TextStyle,

  assignmentTimelineNodeText: {
    color: "rgba(255,255,255,0.98)",
    fontWeight: "900",
    fontSize: 19,
    letterSpacing: -0.3,
  } as TextStyle,

  assignmentTimelineNodeTextOpen: {
    color: "rgba(255,236,179,0.98)",
  } as TextStyle,

  assignmentTimelineNodeTextTaken: {
    color: "rgba(125,211,252,0.98)",
  } as TextStyle,

  assignmentTimelineNodeTextDone: {
    color: "rgba(134,239,172,0.98)",
  } as TextStyle,

  attachName: { flex: 1, marginLeft: 8, color: "rgba(255,255,255,0.88)", fontWeight: "800", fontSize: 12 } as TextStyle,
  attachMeta: { marginLeft: 10, color: "rgba(255,255,255,0.50)", fontWeight: "800", fontSize: 10 } as TextStyle,

  input: { color: "white", fontWeight: "700", fontSize: 15, lineHeight: 21 } as TextStyle,

  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 } as TextStyle,
  emptySub: { marginTop: 6, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 12 } as TextStyle,

  pendingTitle: { color: "white", fontWeight: "900", fontSize: 12, letterSpacing: 0.2 } as TextStyle,
  pendingName: { marginLeft: 8, marginRight: 8, maxWidth: 180, color: "rgba(255,255,255,0.80)", fontWeight: "800", fontSize: 12 } as TextStyle,

  menuTitle: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.2, opacity: 0.96 } as TextStyle,
  menuSub: { marginTop: 2, color: "rgba(255,255,255,0.56)", fontWeight: "700", fontSize: 12, lineHeight: 16 } as TextStyle,
  menuHeaderAvatarText: { color: "rgba(217,179,95,0.98)", fontWeight: "900", fontSize: 24 } as TextStyle,
  menuSection: {
    marginTop: 18,
    marginBottom: 6,
    color: "rgba(217,179,95,0.92)",
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
  } as TextStyle,
  menuRowText: { flex: 1, color: "rgba(255,255,255,0.94)", fontWeight: "800", fontSize: 12 } as TextStyle,
  menuRowTextDanger: { color: "#FF8287" } as TextStyle,
  menuCancelText: { color: "white", fontWeight: "900", fontSize: 13 } as TextStyle,
  memberAvatarText: { color: "rgba(217,179,95,0.98)", fontWeight: "900", fontSize: 18 } as TextStyle,
  memberName: { color: "rgba(255,255,255,0.96)", fontWeight: "900", fontSize: 15 } as TextStyle,
  memberRoleText: { fontWeight: "900", fontSize: 10 } as TextStyle,
  memberRoleTextPastor: { color: "rgba(217,179,95,0.98)" } as TextStyle,
  memberRoleTextAdmin: { color: "rgba(120,185,255,0.98)" } as TextStyle,
  memberRoleTextMember: { color: "rgba(120,235,170,0.98)" } as TextStyle,
  memberStatusText: { fontWeight: "900", fontSize: 11 } as TextStyle,
  memberStatusTextActive: { color: "rgba(120,235,170,0.98)" } as TextStyle,
  memberStatusTextSuspended: { color: "rgba(210,170,255,0.98)" } as TextStyle,
  memberNote: { flex: 1, color: "rgba(255,255,255,0.60)", fontWeight: "700", fontSize: 12 } as TextStyle,
  memberEmptyTitle: { color: "rgba(255,255,255,0.94)", fontWeight: "900", fontSize: 15 } as TextStyle,
  memberEmptySub: { marginTop: 6, color: "rgba(255,255,255,0.58)", fontWeight: "700", fontSize: 12 } as TextStyle,

  menuProfileAvatarText: { color: "rgba(217,179,95,0.98)", fontWeight: "900", fontSize: 24 } as TextStyle,
  menuProfileName: { color: "rgba(255,255,255,0.96)", fontWeight: "900", fontSize: 18 } as TextStyle,
  menuProfileMeta: { marginTop: 2, color: "rgba(255,255,255,0.60)", fontWeight: "700", fontSize: 12 } as TextStyle,

  menuPresencePillText: { color: "rgba(255,255,255,0.88)", fontWeight: "900", fontSize: 12 } as TextStyle,
  menuPresencePillTextOnline: { color: "#35C759" } as TextStyle,
  menuPresencePillTextBlue: { color: "rgba(120,185,255,0.98)" } as TextStyle,
  menuPresencePillTextEmerald: { color: "rgba(120,235,170,0.98)" } as TextStyle,
  menuPresencePillTextPurple: { color: "rgba(210,170,255,0.98)" } as TextStyle,

  menuFactLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.66)",
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  } as TextStyle,
  menuFactValue: {
    marginTop: 10,
    color: "rgba(255,255,255,0.99)",
    fontWeight: "900",
    fontSize: 18,
    lineHeight: 27,
  } as TextStyle,
  menuStatValue: {
    color: "rgba(255,255,255,0.98)",
    fontWeight: "900",
    fontSize: 17,
    lineHeight: 22,
  } as TextStyle,
  menuProfileLead: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "900",
    fontSize: 15,
    marginBottom: 8,
  } as TextStyle,
  menuProfileAbout: { color: "rgba(255,255,255,0.78)", fontWeight: "800", fontSize: 13.5, lineHeight: 21 } as TextStyle,
  menuProfileTagText: { color: "rgba(217,179,95,0.96)", fontWeight: "900", fontSize: 12 } as TextStyle,

  headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

  liveBtn: {
    minWidth: 56,
    height: 34,
    paddingHorizontal: 8,
    
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(16,185,129,0.16)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.48)",
  },

  liveDot: {
    width: 8,
    height: 8,
    
    backgroundColor: "#34D399",
  },

});
