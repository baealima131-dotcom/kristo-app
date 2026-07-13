import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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
  Linking,
  PanResponder,

  StyleSheet,
  Share,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import { BlurView } from "expo-blur";
import Slider from "@react-native-community/slider";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import {
  getCachedParticipant,
  invalidateCachedParticipant,
  markThreadReadOnce,
  messagesListSignature,
  paginateMessages,
  preloadLiveImages,
  setCachedParticipant,
  startAdaptiveLivePolling,
  startMcHostsPolling,
  startRoomMessagesPolling,
} from "@/src/lib/liveRealtime";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import * as DocumentPicker from "expo-document-picker";
import { ensureThread, sendMessage, setThreadMessages, clearThreadMessages, deleteMessage, reconcileMessage, claimAssignmentCard, enrichAssignmentCardClaim, revertAssignmentCardClaim, addAssignmentCardMusic, addAssignmentCardVideo, useThread, getSnapshot, type MsgAttachment, type MsgItem } from "@/src/lib/messagesStore";
import { SharedContentCard } from "@/src/components/messages/SharedContentCard";
import { HomeLiveScheduleCard, ScheduleClaimAvatarRing } from "@/src/components/HomeLiveScheduleCard";
import {
  enterLiveRoomFromScheduleCard,
  navigateChurchLiveControlLiveRoomFromMessages,
} from "@/src/lib/enterLiveRoomNavigation";
import {
  buildChurchLiveControlScheduleRenderMap,
  type ChurchLiveControlHomeFeedScheduleModel,
} from "@/src/lib/churchLiveControlSchedule";
import { queueOpenSharedHomeFeedPost } from "@/src/lib/homeFeedOpenSharedPost";
import type { SharedContentPayload } from "@/src/lib/messagesStore";
import {
  extractApiErrorMessage,
  formatAttachmentMimeLabel,
  formatAttachmentSize,
  normalizeMsgAttachment,
  resolveMessageAttachmentUrl,
  uploadMessageAttachment,
  type PendingMessageAttachment,
} from "@/src/lib/messageAttachmentUpload";
import { compressRoomImage, ROOM_IMAGE_TOO_LARGE_MESSAGE } from "@/src/lib/roomImageCompress";
import { getChurchProjectMcScheduleState } from "@/src/store/churchProjectMcScheduleStore";
import { apiGet, apiPatch, apiDelete, apiPost } from "@/src/lib/kristoApi";
import {
  getLiveControlMembersCache,
  getMcHostsCache,
  getRoomMessagesCache,
  invalidateMcHostsCache,
  invalidateRoomMessagesCache,
  isChurchMediaRoomCacheFresh,
  liveControlMembersRawSignature,
  mcHostsSignature,
  peekLiveControlMembersCache,
  peekMcHostsCache,
  peekRoomMessagesCache,
  saveRoomMessagesCache,
} from "@/src/lib/churchMediaRoomCache";
import {
  CHURCH_MEDIA_ROOM_ID,
  mapLiveControlBoardPeople,
  refreshLiveControlMembersIfNeeded,
  refreshMcHostsIfNeeded,
  refreshRoomMessagesIfNeeded,
  resetRoomMessagesRefreshState,
} from "@/src/lib/churchMediaRoomRefresh";
import {
  consumeRoomMessagesForcePoll,
  consumeRoomMessagesForcePollAfterDelete,
  subscribeScheduleRoomDeleteInvalidation,
} from "@/src/lib/scheduleRoomMessageSync";
import { broadcastChurchLiveControlRoomSync, subscribeChurchLiveControlRoomSync } from "@/src/lib/churchLiveControlRoomSync";
import { persistPersonalTabRingClaimState } from "@/src/lib/homeFeedStore";
import { resolveRealSlotTopic } from "@/src/lib/slotTopicUtils";
import { logPersistedScheduleSlotDateDiag } from "@/src/lib/mediaScheduleSlotTimes";
import {
  isScheduleSlotExpired,
  parseSlotEndMs,
  parseSlotStartMs,
  resolveAssignmentCardAvatarRingDecision,
  resolveScheduleDisplayCalendarDate,
  resolveScheduleSlotVisualState,
  formatSlotDateLabel,
  toMediaSlotAbsoluteAvatarUri,
} from "@/src/lib/scheduleSlotUtils";
import { getApiBase } from "@/src/lib/kristoApi";
import { hasRoomAccess } from "@/src/lib/roomAccess";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  fetchDirectMessageConversationSettings,
  markDirectMessageThreadRead,
  reportDirectMessageConversation,
  updateDirectMessageConversationSetting,
  type DirectMessageConversationSettings,
} from "@/src/lib/directMessagesApi";
import { fetchChurchPastorUserId } from "@/src/lib/churchPastorResolver";
import { createPrivateCallToUser } from "@/src/lib/privateCallService";
import {
  applyPastorAuthorityToMinistryBoard,
  canOpenMinistryTool,
  isProtectedMinistryMember,
  logMinistryAuthority,
  logMinistryToolGate,
  ministryToolLockMessage,
  resolveMinistryAuthority,
  type MinistryToolKey,
} from "@/src/lib/ministryAuthority";
import { requireActiveChurchSubscriptionForSchedule } from "@/src/lib/churchSubscription";
import {
  buildMinistryLiveRoomRouteParams,
  extractAssignmentScheduleCards,
  logMinistryLiveActivationCheck,
  logMinistryLiveEnterRolePreserved,
  logMinistryLiveStartAttempt,
  resolveMinistryLiveActivationState,
  resolveMinistryLiveCameraForEntry,
  resolveMinistryLiveCanPublishForEntry,
  resolveMinistryLiveMicForEntry,
  viewerHasClaimedAnyAssignmentCard,
} from "@/src/lib/ministryLiveActivation";
import { pushLiveRoomWithSilentPreflight } from "@/src/lib/liveSilentPreflight";
import { parseLiveAllScheduleSlotsJson } from "@/src/lib/scheduleSlotUtils";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { LinearGradient } from "expo-linear-gradient";
import ImageViewing from "react-native-image-viewing";

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

function photoLibraryAccessAllowed(perm: ImagePicker.MediaLibraryPermissionResponse) {
  if (perm.granted) return true;
  const accessPrivileges = String((perm as any)?.accessPrivileges || "").toLowerCase();
  return accessPrivileges === "limited";
}

function alertPhotoLibraryPermissionNeeded() {
  Alert.alert(
    "Permission needed",
    "Please allow photo library access to send images.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Open Settings",
        onPress: () => {
          void Linking.openSettings();
        },
      },
    ]
  );
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
    const startMs = parseSlotStartMs(card);
    const endMs = parseSlotEndMs(card, startMs);
    if (!(startMs > 0 && endMs > startMs)) return false;
    const now = Date.now();
    return now >= startMs && now <= endMs;
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

function directRoomPeerUserId(
  roomIdValue: unknown,
  viewerUserIdValue: unknown
) {
  const roomId = String(
    roomIdValue || ""
  ).trim();

  const viewerUserId = String(
    viewerUserIdValue || ""
  ).trim();

  if (!roomId.startsWith("dm:")) {
    return "";
  }

  const participants = roomId
    .slice(3)
    .split("::")
    .map((value) => value.trim())
    .filter(Boolean);

  return (
    participants.find(
      (value) => value !== viewerUserId
    ) ||
    participants[0] ||
    ""
  );
}

function profileRouteParams(
  threadId: string,
  headerTitle: string,
  currentFact?: any,
  presence?: {
    online: boolean;
    text: string;
  },
  viewerUserId = ""
) {
  const peerUserId =
    directRoomPeerUserId(
      threadId,
      viewerUserId
    );

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
    userId:
      peerUserId ||
      threadId ||
      headerTitle
        .toLowerCase()
        .replace(/\s+/g, "-"),
    churchId: "",
    churchName: factChurch,
    name: headerTitle || "Member",
    role: factRole,
    status,
    note,
    profileMode: "external",
    source: "direct-message-profile",
    peerUserId,
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
    isClaiming?: boolean;
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

  const slotTopicResolved = resolveRealSlotTopic(card);
  const slotNumber = String(
    (card as any)?.slotNumber || (card as any)?.slotLabel || ""
  ).trim();

  console.log("KRISTO_SLOT_TOPIC_RESOLVE", {
    slotNumber,
    title: cleanTitle,
    slotTopic: String((card as any)?.slotTopic || "").trim() || null,
    resolvedTopic: slotTopicResolved.resolvedTopic,
    source: slotTopicResolved.source,
    parentTopic: slotTopicResolved.parentTopic,
    meetingType: slotTopicResolved.meetingType,
    rawSlotKeys: slotTopicResolved.rawSlotKeys,
  });

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

  const normalizedScript = slotTopicResolved.resolvedTopic || "";

  const roleLine = String(card.roleLabel || card.subtitle || "").trim();
  const timeLine = String((card as any).timeLabel || "").trim();

  const meetingDateValue = String((card as any)?.meetingDate || "").trim();
  const liveDurationMin = Math.max(0, Number(card.durationMin || 0));
  const liveStartMs = parseSlotStartMs(card);
  const liveEndMs = liveStartMs > 0 ? parseSlotEndMs(card, liveStartMs) : null;
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
          {(() => {
            const assignmentAvatarRingDecision = resolveAssignmentCardAvatarRingDecision({
              surface: "assignment-card-body",
              cardId: String(m.id || card.cardId || ""),
              slotId: String(card.cardId || slotNumber || ""),
              claimedByUserId,
              currentUserId,
              claimed: isTaken,
            });
            console.log(
              "KRISTO_ASSIGNMENT_CARD_AVATAR_RING_DECISION",
              assignmentAvatarRingDecision
            );
            const resolvedAvatarUri = claimedAvatar
              ? toMediaSlotAbsoluteAvatarUri(claimedAvatar, getApiBase())
              : "";
            return (
              <View style={{ flexShrink: 0, overflow: "visible" }}>
                <ScheduleClaimAvatarRing
                  uri={resolvedAvatarUri}
                  initial={initials(claimedBy)}
                  size={50}
                  accent="#38BDF8"
                  ownershipRing={assignmentAvatarRingDecision.ringMode}
                  forceShowImage={!!resolvedAvatarUri}
                  imageLogMeta={{
                    slotId: String(card.cardId || slotNumber || ""),
                    claimedByUserId,
                    kind: "claimed",
                  }}
                />
              </View>
            );
          })()}

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
              ? card.notes.map((x: any) => String(x || "").trim()).filter(Boolean)
              : [];

            const meetingDateValue = String((card as any)?.meetingDate || "").trim();

            let realMeetingDay = "";
            if (meetingDateValue) {
              realMeetingDay = formatSlotDateLabel(
                resolveScheduleDisplayCalendarDate(card),
                ""
              );
            }

            const audienceNote =
              rawNotes.find((x: any) => /^audience:/i.test(x)) || "";

            const reviewNote =
              rawNotes.find((x: any) => /^review detail:/i.test(x)) || "";

            const rawMeetingDayNote =
              rawNotes.find((x: any) => /^meeting day:/i.test(x)) || "";

            const meetingDayNote = realMeetingDay
              ? `Meeting day: ${realMeetingDay}`
              : rawMeetingDayNote;

            const allocatedNote =
              rawNotes.find((x: any) => /^allocated:/i.test(x)) || "";

            const splitNote =
              rawNotes.find((x: any) => /^split segment:/i.test(x)) || "";

            const finalAdjustedNote =
              rawNotes.find((x: any) => /^final adjusted/i.test(x)) || "";

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

            {canShowClaim || (!!opts?.isClaiming && !!opts?.canClaim) ? (
              <Pressable
                onPress={opts?.isClaiming ? undefined : opts.onClaim}
                disabled={!!opts?.isClaiming}
                style={({ pressed }) => [
                  s.assignmentActionBtn,
                  s.assignmentActionBtnPrimary,
                  opts?.isClaiming ? { opacity: 0.72 } : null,
                  pressed && !opts?.isClaiming ? s.assignmentActionBtnPressed : null,
                ]}
              >
                <Text style={t.assignmentActionTextPrimary}>
                  {opts?.isClaiming ? "Claiming..." : "CLAIM"}
                </Text>
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
            const startMs = parseSlotStartMs(card);
            const endMs = parseSlotEndMs(card, startMs);
            const valid = startMs > 0 && endMs > startMs;
            const start = valid ? new Date(startMs) : null;
            const end = valid ? new Date(endMs) : null;

            const fmtTime = (d: Date) =>
              d.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              });

            if (!valid || !start || !end) return null;

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

function getAssignmentMeetingWindow(messages: MsgItem[], nowMs = Date.now()) {
  const rows = (messages || [])
    .filter((m) => m.kind === "assignment_card" && m.card)
    .filter((m) => !isScheduleSlotExpired(m.card, nowMs))
    .map((m) => {
      const startMs = parseSlotStartMs(m.card);
      const endMs = parseSlotEndMs(m.card, startMs);
      return startMs > 0 && endMs > startMs ? { startMs, endMs } : null;
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
  const startMs = parseSlotStartMs(card);
  const endMs = parseSlotEndMs(card, startMs);
  const durationMin = Math.max(0, Number(card?.durationMin || 0));

  if (startMs <= 0 || endMs <= startMs) {
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

const GALLERY_SCREEN = Dimensions.get("window");
const GALLERY_W = GALLERY_SCREEN.width;
const GALLERY_H = GALLERY_SCREEN.height;

function collectRoomImageGalleryUris(messages: MsgItem[]): string[] {
  const sorted = [...messages].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const uris: string[] = [];

  for (const m of sorted) {
    for (const raw of m.attachments || []) {
      const a = normalizeMsgAttachment(raw);
      if (a.kind !== "image") continue;
      const uri = resolveMessageAttachmentUrl(a.imageUri || a.uri || a.url || "");
      if (uri && isGalleryPreviewSafeImageUri(uri)) uris.push(uri);
    }
  }

  return uris;
}

function findGalleryImageIndex(gallery: string[], uri: string) {
  const target = resolveMessageAttachmentUrl(uri);
  if (!target) return -1;
  const exact = gallery.indexOf(target);
  if (exact >= 0) return exact;
  return gallery.findIndex((u) => u === uri || u.endsWith(target) || target.endsWith(u));
}

function isGalleryPreviewSafeImageUri(uri: string) {
  const clean = String(uri || "").split("?")[0].toLowerCase();
  // Remote HEIC/HEIF can crash RN Image preview on some iOS/dev-client builds.
  // Keep bubble thumbnail/upload, but exclude from fullscreen gallery until converted.
  if (/\.(heic|heif)$/i.test(clean)) return false;
  return /\.(png|jpe?g|webp|gif)$/i.test(clean) || clean.startsWith("data:image/");
}


function MessageImageGalleryModal({
  open,
  uris,
  startIndex,
  onClose,
}: {
  open: boolean;
  uris: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const images = useMemo(() => uris.map((uri) => ({ uri })), [uris]);

  const safeIndex = Math.max(
    0,
    Math.min(startIndex || 0, Math.max(0, images.length - 1))
  );

  return (
    <ImageViewing
      images={images}
      imageIndex={safeIndex}
      visible={open && images.length > 0}
      onRequestClose={onClose}
      swipeToCloseEnabled
      doubleTapToZoomEnabled
      presentationStyle="fullScreen"
      backgroundColor="#000000"
      FooterComponent={({ imageIndex }) => (
        <View style={{ width: "100%", alignItems: "center", paddingBottom: 34 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "700", opacity: 0.92 }}>
            {(imageIndex || 0) + 1} / {images.length}
          </Text>
        </View>
      )}
    />
  );
}

function isAssignmentCardMessage(m: MsgItem) {
  return String(m.kind || "") === "assignment_card";
}

function isSharedContentMessage(m: MsgItem) {
  return String(m.kind || "") === "shared_content" && !!m.sharedContent;
}

function isAppointmentRequestMessage(m: MsgItem) {
  return (
    String(m.kind || "") === "appointment_request" &&
    String((m.card as any)?.type || "") === "appointment_request"
  );
}

function isAppointmentResponseMessage(m: MsgItem) {
  return (
    String(m.kind || "") === "appointment_response" &&
    String((m.card as any)?.type || "") === "appointment_response"
  );
}

function isAppointmentTimeProposalMessage(m: MsgItem) {
  return (
    String(m.kind || "") === "appointment_time_proposed" &&
    String((m.card as any)?.type || "") === "appointment_time_proposed"
  );
}

function isAppointmentConfirmedMessage(m: MsgItem) {
  return (
    String(m.kind || "") === "appointment_confirmed" &&
    String((m.card as any)?.type || "") === "appointment_confirmed"
  );
}

function appointmentClientId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
}

function shouldHideExpiredAssignmentCardInRoom(m: MsgItem, nowMs: number) {
  if (!isAssignmentCardMessage(m) || !m.card) return false;
  return isScheduleSlotExpired(m.card, nowMs);
}

function isOptimisticOutgoingMessage(m: MsgItem) {
  return !!m.pending || String(m.id || "").startsWith("local_");
}

function optimisticMessageMatchesBackend(opt: MsgItem, backend: MsgItem) {
  if (opt.sender !== "me" || backend.sender !== "me") return false;
  if (String(opt.text || "").trim() !== String(backend.text || "").trim()) return false;
  return Math.abs(Number(opt.createdAt || 0) - Number(backend.createdAt || 0)) < 120000;
}

function messageClientId(m: any): string {
  return String(m?.clientId || m?.localId || "").trim();
}

/**
 * Strong identity match between a local message and a server row. Prefers the
 * stable id / clientId so attachment- or card-only messages (empty text) are
 * never confused with each other.
 */
function backendMatchesLocal(local: MsgItem, backend: MsgItem): boolean {
  const lid = String(local.id || "");
  const bid = String(backend.id || "");
  if (lid && bid && lid === bid) return true;

  const lc = messageClientId(local);
  const bc = messageClientId(backend);
  if (lc && bc && lc === bc) return true;
  // The optimistic id often becomes the server row's clientId after reconcile.
  if (lid && bc && lid === bc) return true;
  if (bid && lc && bid === lc) return true;

  return false;
}

function localMessageHasAttachments(m: MsgItem): boolean {
  return Array.isArray(m.attachments) && m.attachments.length > 0;
}

/**
 * A local message is "covered" by the server once a matching row arrives. We
 * only fall back to the loose text+time heuristic for plain text messages that
 * predate clientId, so recently-sent images/files/cards are never dropped.
 */
function localMessageResolvedByBackend(local: MsgItem, mapped: MsgItem[]): boolean {
  return mapped.some((b) => {
    if (backendMatchesLocal(local, b)) return true;
    const hasText = String(local.text || "").trim().length > 0;
    const noAttachments = !localMessageHasAttachments(local);
    const notCard = String(local.kind || "") !== "assignment_card";
    if (hasText && noAttachments && notCard) return optimisticMessageMatchesBackend(local, b);
    return false;
  });
}

/**
 * When a server row matches a local message but is missing attachments/card
 * (e.g. an eventually-consistent store hasn't caught up yet), keep the local
 * preview so it doesn't flash and vanish after a poll.
 */
function preserveLocalRichFields(backend: MsgItem, local: MsgItem): MsgItem {
  let next = backend;
  if (!localMessageHasAttachments(backend) && localMessageHasAttachments(local)) {
    next = { ...next, attachments: local.attachments };
  }
  if (!backend.card && local.card) {
    next = { ...next, card: local.card, kind: next.kind || local.kind };
  }
  return next;
}

function isRecentOwnLocalMessage(m: MsgItem, windowMs = 10 * 60 * 1000): boolean {
  if (m.sender !== "me" && !isOptimisticOutgoingMessage(m)) return false;
  return Date.now() - Number(m.createdAt || 0) < windowMs;
}

type MessageAvatarSource =
  | "avatarUri"
  | "senderAvatar"
  | "senderAvatarUri"
  | "avatarUrl"
  | "profileImage"
  | "photoURL"
  | "image"
  | "user.avatarUri"
  | "profile.avatarUri"
  | null;

function resolveMessageSenderAvatar(m: MsgItem | Record<string, any>): {
  uri: string;
  source: MessageAvatarSource;
} {
  const raw = m as Record<string, any>;
  const candidates: Array<[MessageAvatarSource, unknown]> = [
    ["avatarUri", raw.avatarUri],
    ["senderAvatar", raw.senderAvatar],
    ["senderAvatarUri", raw.senderAvatarUri],
    ["avatarUrl", raw.avatarUrl],
    ["profileImage", raw.profileImage],
    ["photoURL", raw.photoURL],
    ["image", raw.image],
    ["user.avatarUri", raw.user?.avatarUri],
    ["profile.avatarUri", raw.profile?.avatarUri],
  ];

  for (const [source, value] of candidates) {
    const uri = chatMediaUrl(value);
    if (uri) return { uri, source };
  }

  return { uri: "", source: null };
}

function resolveSessionUserAvatar(
  session: Record<string, any> | null | undefined,
  auth: Record<string, any> | null | undefined
) {
  const sessionAny = (session || {}) as Record<string, any>;
  const authAny = (auth || {}) as Record<string, any>;
  const candidates = [
    sessionAny.avatarUri,
    sessionAny.avatarUrl,
    sessionAny.profileImage,
    sessionAny.photoURL,
    sessionAny.image,
    sessionAny.user?.avatarUri,
    sessionAny.user?.avatarUrl,
    sessionAny.profile?.avatarUri,
    sessionAny.profile?.avatarUrl,
    sessionAny.profile?.profileImage,
    authAny.avatarUri,
    authAny.avatarUrl,
    authAny.profileImage,
    authAny.photoURL,
    authAny.image,
  ];

  for (const raw of candidates) {
    const uri = chatMediaUrl(raw);
    if (uri) return uri;
  }

  return "";
}

function enrichMessageSenderAvatar(m: MsgItem, lookup: Map<string, string>): MsgItem {
  if (resolveMessageSenderAvatar(m).uri) return m;

  const uid = String(m.senderUserId || "").trim();
  const fallback = uid ? lookup.get(uid) : "";
  if (!fallback) return m;

  return {
    ...m,
    avatarUri: fallback,
    senderAvatar: fallback,
  };
}

function mapBackendRoomMessageRow(x: any, threadId: string, selfId: string, _apiBase: string): MsgItem {
  const senderRole = String(x.senderRole || x.role || "").trim();
  const churchRole = String(x.churchRole || x.senderRole || x.role || "").trim();
  const senderAvatar = resolveMessageSenderAvatar(x).uri;
  const sharedContent =
    x?.sharedContent && typeof x.sharedContent === "object"
      ? x.sharedContent
      : String(x?.kind || "") === "shared_content" && x?.payload && typeof x.payload === "object"
        ? x.payload
        : undefined;
  const kind = (sharedContent ? "shared_content" : String(x.kind || "text")) as MsgItem["kind"];

  return {
    id: String(x.id || `backend_${x.createdAt || Date.now()}`),
    clientId: String(x.clientId || x.localId || "").trim() || undefined,
    threadId,
    sender: String(x.senderUserId || "") === selfId ? "me" : "other",
    displayName: String(x.senderName || "Member"),
    senderUserId: String(x.senderUserId || ""),
    senderRole: senderRole || undefined,
    role: senderRole || churchRole || undefined,
    churchRole: churchRole || undefined,
    senderAvatar: senderAvatar || undefined,
    avatarUri: senderAvatar || undefined,
    text: String(x.text || ""),
    attachments: Array.isArray(x.attachments)
      ? x.attachments.map((att: any) => normalizeMsgAttachment(att))
      : undefined,
    createdAt: Number(x.createdAt || Date.now()),
    kind,
    sharedContent,
    card: x.card || undefined,
    viewerDeletedStorageItemIds:
      Array.isArray(
        x.viewerDeletedStorageItemIds
      )
        ? x.viewerDeletedStorageItemIds.map(
            String
          )
        : [],
  };
}

function isPastorMessage(m: MsgItem, opts?: { churchPastorUserId?: string }) {
  if (isAssignmentCardMessage(m)) return false;

  const roleTokens = [m.senderRole, m.role, m.churchRole]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  if (roleTokens.some((token) => token.includes("pastor"))) return true;

  const senderUserId = String(m.senderUserId || "").trim();
  const churchPastorUserId = String(opts?.churchPastorUserId || "").trim();
  if (senderUserId && churchPastorUserId && senderUserId === churchPastorUserId) return true;

  const displayName = String(m.displayName || "").trim().toLowerCase();
  if (displayName.includes("pastor")) return true;

  return false;
}

function pendingAttachmentsToOptimistic(items: PendingMessageAttachment[]): MsgAttachment[] {
  return items.map((p) => ({
    id: p.id,
    kind: p.kind,
    uri: p.localUri,
    url: p.localUri,
    name: p.name,
    mime: p.mime,
    size: p.size,
    imageUri: p.kind === "image" ? p.localUri : undefined,
    fileUri: p.kind === "file" ? p.localUri : undefined,
    fileName: p.name,
  }));
}

function isSelectableMessage(m: MsgItem) {
  return !isAssignmentCardMessage(m);
}

function canEditMessage(m: MsgItem) {
  return m.sender === "me" && isSelectableMessage(m) && String(m.text || "").trim().length > 0;
}

function canDeleteMessage(m: MsgItem) {
  return isSelectableMessage(m);
}

function buildMessageShareContent(m: MsgItem) {
  const parts: string[] = [];
  const text = String(m.text || "").trim();
  if (text) parts.push(text);
  for (const raw of m.attachments || []) {
    const a = normalizeMsgAttachment(raw);
    const url = resolveMessageAttachmentUrl(a.imageUri || a.fileUri || a.uri || a.url || "");
    if (url) parts.push(url);
    else {
      const name = String(a.fileName || a.name || "").trim();
      if (name) parts.push(name);
    }
  }
  return parts.join("\n").trim() || "Message";
}

function MessageBubbleAvatar({
  uri,
  label,
  show,
  side,
}: {
  uri: string;
  label: string;
  show: boolean;
  side: "left" | "right";
}) {
  if (!show) {
    return <View style={s.avatarSpacer} />;
  }

  return (
    <View style={side === "left" ? s.avatarMini : s.avatarMiniRight}>
      {uri ? (
        <Image source={{ uri }} style={s.avatarMiniImage as any} />
      ) : (
        <Text style={t.avatarMiniText}>{initials(label || "U")}</Text>
      )}
    </View>
  );
}

function MessageActionRow({
  icon,
  label,
  danger,
  divider,
  onPress,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  divider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.msgActionRow,
        divider ? s.msgActionRowDivider : null,
        danger ? s.msgActionRowDanger : null,
        pressed ? s.msgActionRowPressed : null,
      ]}
    >
      <View style={[s.msgActionIconWrap, danger ? s.msgActionIconWrapDanger : null]}>
        <Ionicons name={icon as any} size={19} color={danger ? "#FF6B72" : GOLD} />
      </View>
      <Text style={[t.msgActionRowText, danger ? t.msgActionRowTextDanger : null]}>{label}</Text>
    </Pressable>
  );
}

function MessageActionsSheet({
  open,
  message,
  showEdit,
  showDelete,
  deleteLabel,
  showDeleteForEveryone,
  onClose,
  onSelect,
  onDelete,
  onDeleteForEveryone,
  onEdit,
  onShare,
  onSelectAll,
}: {
  open: boolean;
  message: MsgItem | null;
  showEdit: boolean;
  showDelete: boolean;
  deleteLabel: string;
  showDeleteForEveryone: boolean;
  onClose: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onDeleteForEveryone: () => void;
  onEdit: () => void;
  onShare: () => void;
  onSelectAll: () => void;
}) {
  if (!open || !message) return null;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.msgActionsOverlay}>
        <Pressable style={s.msgActionsBackdrop} onPress={onClose} />
        <View style={s.msgActionsSheet}>
          <View style={s.msgActionsGlassOuter}>
            <View style={s.msgActionsTopGlow} pointerEvents="none" />
            <BlurView intensity={34} tint="dark" style={s.msgActionsGlass}>
              <View style={s.msgActionsHandle} />
              <Text style={t.msgActionsTitle}>Message actions</Text>
              <MessageActionRow icon="checkmark-circle-outline" label="Select message" divider onPress={onSelect} />
              {showDelete ? (
                <MessageActionRow icon="trash-outline" label={deleteLabel} danger divider onPress={onDelete} />
              ) : null}
              {showDeleteForEveryone ? (
                <MessageActionRow
                  icon="globe-outline"
                  label="Delete for everyone"
                  danger
                  divider
                  onPress={onDeleteForEveryone}
                />
              ) : null}
              {showEdit ? <MessageActionRow icon="create-outline" label="Edit" divider onPress={onEdit} /> : null}
              <MessageActionRow icon="share-outline" label="Share" divider onPress={onShare} />
              <MessageActionRow icon="albums-outline" label="Select All" divider onPress={onSelectAll} />
              <MessageActionRow icon="close-circle-outline" label="Cancel" onPress={onClose} />
            </BlurView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MessageAttachmentsBlock({
  attachments,
  onPreviewImage,
}: {
  attachments: MsgAttachment[];
  onPreviewImage?: (uri: string) => void;
}) {
  if (!attachments?.length) return null;

  async function openAttachmentFile(url: string) {
    const fileUrl = resolveMessageAttachmentUrl(url);
    if (!fileUrl) {
      Alert.alert("File unavailable", "This attachment does not have a reachable URL.");
      return;
    }

    try {
      const supported = await Linking.canOpenURL(fileUrl);
      if (!supported) {
        Alert.alert("Cannot open file", fileUrl);
        return;
      }
      await Linking.openURL(fileUrl);
    } catch (e: any) {
      Alert.alert("Cannot open file", String(e?.message || e || "Try again."));
    }
  }

  return (
    <>
      <View style={s.attachBlock}>
        {attachments.map((raw) => {
          const a = normalizeMsgAttachment(raw);
          const imageUri = resolveMessageAttachmentUrl(a.imageUri || (a.kind === "image" ? a.uri || a.url : ""));
          const fileUri = resolveMessageAttachmentUrl(a.fileUri || (a.kind === "file" ? a.uri || a.url : ""));
          const fileName = String(a.fileName || a.name || "attachment");
          const metaParts = [formatAttachmentMimeLabel(a.mimeType || a.mime), formatAttachmentSize(a.size)].filter(Boolean);
          const metaLabel = metaParts.join(" • ");

          if (a.kind === "image" && imageUri) {
            return (
              <Pressable
                key={a.id}
                onPress={() => onPreviewImage?.(imageUri)}
                style={({ pressed }) => [s.attachImageWrap, pressed ? ({ opacity: 0.92 } as ViewStyle) : null]}
              >
                <Image source={{ uri: imageUri }} style={s.attachImagePreview as ImageStyle} resizeMode="cover" />
                <View style={s.attachImageFooter}>
                  <Ionicons name="expand-outline" size={14} color="rgba(255,255,255,0.82)" />
                  <Text style={t.attachImageHint} numberOfLines={1}>
                    Tap to preview
                  </Text>
                </View>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={a.id}
              onPress={() => void openAttachmentFile(fileUri || a.uri || a.url || "")}
              style={({ pressed }) => [s.attachFileCard, pressed ? ({ opacity: 0.92 } as ViewStyle) : null]}
            >
              <View style={s.attachFileIconWrap}>
                <Ionicons name="document-text-outline" size={22} color="#F4D06F" />
              </View>
              <View style={s.attachFileCopy}>
                <Text style={t.attachFileName} numberOfLines={2} ellipsizeMode="middle">
                  {fileName}
                </Text>
                {metaLabel ? <Text style={t.attachFileMeta}>{metaLabel}</Text> : null}
              </View>
              <Ionicons name="open-outline" size={18} color="rgba(255,255,255,0.55)" />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}



const APPOINTMENT_VOICE_CACHE_DIRECTORY =
  FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}appointment-voice-cache/`
    : "";

const appointmentVoiceCacheJobs =
  new Map<string, Promise<string>>();

function appointmentVoiceCacheHash(
  value: string
) {
  let hash = 2166136261;

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0)
    .toString(16);
}

function appointmentVoiceCacheName(
  noteId: string,
  source: string
) {
  const cleanId = String(noteId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 90);

  const extensionMatch =
    source.match(
      /\.(m4a|mp4|aac|mp3|wav|caf)(?:$|\?)/i
    );

  const extension =
    extensionMatch?.[1]?.toLowerCase() ||
    "m4a";

  /*
   * The remote URL is the permanent identity of the uploaded
   * voice. A message/note ID may change after hydration, but
   * the uploaded source URL remains stable.
   */
  const sourceIdentity =
    `source_${appointmentVoiceCacheHash(
      source
    )}`;

  return `${sourceIdentity}.${extension}`;
}

async function resolvePersistentAppointmentVoiceSource(
  noteId: string,
  remoteSource: string
) {
  const source = String(
    remoteSource || ""
  ).trim();

  if (
    !source ||
    !/^https?:\/\//i.test(source) ||
    !APPOINTMENT_VOICE_CACHE_DIRECTORY
  ) {
    return source;
  }

  const destination =
    `${APPOINTMENT_VOICE_CACHE_DIRECTORY}${
      appointmentVoiceCacheName(
        noteId,
        source
      )
    }`;

  const existing =
    await FileSystem.getInfoAsync(
      destination
    ).catch(() => null);

  if (
    existing?.exists &&
    !(existing as any)?.isDirectory
  ) {
    console.log(
      "KRISTO_APPOINTMENT_VOICE_CACHE_HIT",
      {
        noteId,
        bytes:
          Number(
            (existing as any)?.size || 0
          ) || null,
        localUriEnd:
          destination.slice(-80),
        validation:
          "exists-not-directory",
      }
    );

    return destination;
  }

  /*
   * Compatibility with cache files created before the
   * source-hash filename was introduced.
   */
  const cleanLegacyId = String(
    noteId || ""
  )
    .trim()
    .replace(
      /[^a-zA-Z0-9_-]+/g,
      "_"
    )
    .slice(0, 90);

  const extensionMatch =
    source.match(
      /\.(m4a|mp4|aac|mp3|wav|caf)(?:$|\?)/i
    );

  const extension =
    extensionMatch?.[1]?.toLowerCase() ||
    "m4a";

  const legacyDestination =
    cleanLegacyId
      ? `${APPOINTMENT_VOICE_CACHE_DIRECTORY}${cleanLegacyId}.${extension}`
      : "";

  if (
    legacyDestination &&
    legacyDestination !== destination
  ) {
    const legacyExisting =
      await FileSystem.getInfoAsync(
        legacyDestination
      ).catch(() => null);

    if (
      legacyExisting?.exists &&
      !(legacyExisting as any)?.isDirectory
    ) {
      await FileSystem.copyAsync({
        from: legacyDestination,
        to: destination,
      }).catch(() => {});

      const migrated =
        await FileSystem.getInfoAsync(
          destination
        ).catch(() => null);

      if (
        migrated?.exists &&
        !(migrated as any)?.isDirectory
      ) {
        await FileSystem.deleteAsync(
          legacyDestination,
          {
            idempotent: true,
          }
        ).catch(() => {});

        console.log(
          "KRISTO_APPOINTMENT_VOICE_CACHE_MIGRATED",
          {
            noteId,
            fromEnd:
              legacyDestination.slice(-80),
            toEnd:
              destination.slice(-80),
          }
        );

        return destination;
      }

      /*
       * Even if migration failed, the legacy local file is
       * still valid and should be played without downloading.
       */
      console.log(
        "KRISTO_APPOINTMENT_VOICE_CACHE_LEGACY_HIT",
        {
          noteId,
          localUriEnd:
            legacyDestination.slice(-80),
        }
      );

      return legacyDestination;
    }
  }

  const currentJob =
    appointmentVoiceCacheJobs.get(
      destination
    );

  if (currentJob) {
    return currentJob;
  }

  const job = (
    async () => {
      try {
        await FileSystem.makeDirectoryAsync(
          APPOINTMENT_VOICE_CACHE_DIRECTORY,
          {
            intermediates: true,
          }
        );

        await FileSystem.deleteAsync(
          destination,
          {
            idempotent: true,
          }
        ).catch(() => {});

        console.log(
          "KRISTO_APPOINTMENT_VOICE_CACHE_DOWNLOAD_START",
          {
            noteId,
            remoteSourceEnd:
              source.slice(-80),
          }
        );

        const result =
          await FileSystem.downloadAsync(
            source,
            destination
          );

        const downloaded =
          await FileSystem.getInfoAsync(
            result.uri
          );

        if (
          !downloaded.exists ||
          (downloaded as any)?.isDirectory
        ) {
          throw new Error(
            "Downloaded voice cache file was not created."
          );
        }

        console.log(
          "KRISTO_APPOINTMENT_VOICE_CACHE_SAVED",
          {
            noteId,
            bytes: Number(
              (downloaded as any)?.size || 0
            ),
            localUriEnd:
              result.uri.slice(-80),
          }
        );

        return result.uri;
      } catch (error: any) {
        await FileSystem.deleteAsync(
          destination,
          {
            idempotent: true,
          }
        ).catch(() => {});

        console.warn(
          "KRISTO_APPOINTMENT_VOICE_CACHE_FAILED",
          {
            noteId,
            message: String(
              error?.message ||
                error ||
                "unknown"
            ),
          }
        );

        return source;
      } finally {
        appointmentVoiceCacheJobs.delete(
          destination
        );
      }
    }
  )();

  appointmentVoiceCacheJobs.set(
    destination,
    job
  );

  return job;
}

type AppointmentVoicePrecacheTask = {
  key: string;
  noteId: string;
  source: string;
};

const APPOINTMENT_VOICE_PRECACHE_CONCURRENCY =
  2;

const appointmentVoicePrecacheQueue:
  AppointmentVoicePrecacheTask[] = [];

const appointmentVoicePrecacheKnown =
  new Set<string>();

let appointmentVoicePrecacheActive = 0;

function drainAppointmentVoicePrecacheQueue() {
  while (
    appointmentVoicePrecacheActive <
      APPOINTMENT_VOICE_PRECACHE_CONCURRENCY &&
    appointmentVoicePrecacheQueue.length > 0
  ) {
    const task =
      appointmentVoicePrecacheQueue.shift();

    if (!task) {
      return;
    }

    appointmentVoicePrecacheActive += 1;

    void resolvePersistentAppointmentVoiceSource(
      task.noteId,
      task.source
    )
      .then((resolvedSource) => {
        const cached =
          !!resolvedSource &&
          resolvedSource !== task.source &&
          resolvedSource.startsWith(
            "file://"
          );

        console.log(
          cached
            ? "KRISTO_APPOINTMENT_VOICE_PRECACHE_READY"
            : "KRISTO_APPOINTMENT_VOICE_PRECACHE_REMOTE_FALLBACK",
          {
            noteId: task.noteId,
            sourceType: cached
              ? "persistent-local"
              : "remote",
            sourceEnd:
              String(
                resolvedSource ||
                  task.source
              ).slice(-80),
          }
        );

        /*
         * A remote fallback normally means the background
         * download failed. Allow a later retry.
         */
        if (!cached) {
          appointmentVoicePrecacheKnown.delete(
            task.key
          );
        }
      })
      .catch((error: any) => {
        appointmentVoicePrecacheKnown.delete(
          task.key
        );

        console.warn(
          "KRISTO_APPOINTMENT_VOICE_PRECACHE_FAILED",
          {
            noteId: task.noteId,
            message: String(
              error?.message ||
                error ||
                "unknown"
            ),
          }
        );
      })
      .finally(() => {
        appointmentVoicePrecacheActive =
          Math.max(
            0,
            appointmentVoicePrecacheActive - 1
          );

        drainAppointmentVoicePrecacheQueue();
      });
  }
}

function scheduleAppointmentVoicePrecache(
  noteIdValue: unknown,
  sourceValue: unknown
) {
  const noteId = String(
    noteIdValue || ""
  ).trim();

  const source = String(
    sourceValue || ""
  ).trim();

  if (
    !source ||
    !/^https?:\/\//i.test(source)
  ) {
    return;
  }

  const key = [
    noteId ||
      appointmentVoiceCacheHash(source),
    source,
  ].join("::");

  if (
    appointmentVoicePrecacheKnown.has(key)
  ) {
    return;
  }

  appointmentVoicePrecacheKnown.add(key);

  appointmentVoicePrecacheQueue.push({
    key,
    noteId:
      noteId ||
      `voice_${appointmentVoiceCacheHash(
        source
      )}`,
    source,
  });

  console.log(
    "KRISTO_APPOINTMENT_VOICE_PRECACHE_QUEUED",
    {
      noteId:
        noteId ||
        `voice_${appointmentVoiceCacheHash(
          source
        )}`,
      queueLength:
        appointmentVoicePrecacheQueue.length,
      active:
        appointmentVoicePrecacheActive,
      sourceEnd: source.slice(-80),
    }
  );

  drainAppointmentVoicePrecacheQueue();
}

type ActiveAppointmentVoicePlayback = {
  key: string;
  stop: () => void;
};

let activeAppointmentVoicePlayback:
  ActiveAppointmentVoicePlayback | null =
    null;

function claimAppointmentVoicePlayback(
  key: string,
  stop: () => void
) {
  const previous =
    activeAppointmentVoicePlayback;

  if (
    previous &&
    previous.key !== key
  ) {
    try {
      previous.stop();
    } catch {}
  }

  activeAppointmentVoicePlayback = {
    key,
    stop,
  };

  console.log(
    "KRISTO_APPOINTMENT_VOICE_GLOBAL_CLAIM",
    {
      key,
      stoppedPrevious:
        !!previous &&
        previous.key !== key,
      previousKey:
        previous?.key || "",
    }
  );
}

function releaseAppointmentVoicePlayback(
  key: string
) {
  if (
    activeAppointmentVoicePlayback?.key !==
    key
  ) {
    return;
  }

  activeAppointmentVoicePlayback = null;

  console.log(
    "KRISTO_APPOINTMENT_VOICE_GLOBAL_RELEASE",
    {
      key,
    }
  );
}

function formatAppointmentVoiceDuration(seconds: unknown) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

const CONVERSATION_MEDIA_HIDDEN_PREFIX =
  "kristo_conversation_media_hidden_v1";

function conversationMediaHiddenKey(
  threadId: string
) {
  return `${CONVERSATION_MEDIA_HIDDEN_PREFIX}:${threadId}`;
}

function appointmentVoiceStorageItemId(
  messageIdValue: unknown,
  noteIdValue: unknown,
  index: number
) {
  return [
    "appointment-audio",
    String(messageIdValue || "").trim(),
    String(noteIdValue || index).trim(),
  ].join(":");
}

function AppointmentDeletedVoiceChip({
  index,
}: {
  index: number;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 82,
        paddingHorizontal: 2,
        paddingVertical: 7,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          "rgba(255,107,114,0.055)",
        borderWidth: 1,
        borderColor:
          "rgba(255,107,114,0.20)",
        opacity: 0.82,
      }}
    >
      <Text
        style={{
          marginBottom: 4,
          color: "rgba(255,146,152,0.72)",
          fontSize: 9,
          fontWeight: "900",
        }}
      >
        {index + 1}
      </Text>

      <View
        style={{
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 31,
            height: 31,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              "rgba(255,107,114,0.10)",
            borderWidth: 1,
            borderColor:
              "rgba(255,107,114,0.24)",
          }}
        >
          <Ionicons
            name="trash-outline"
            size={15}
            color="#FF9298"
          />
        </View>
      </View>

      <Text
        numberOfLines={1}
        style={{
          marginTop: 4,
          color: "rgba(255,146,152,0.76)",
          fontSize: 8,
          fontWeight: "900",
        }}
      >
        Deleted
      </Text>
    </View>
  );
}

function AppointmentVoiceChip({
  note,
  index,
  active,
  onActivate,
}: {
  note: Record<string, any>;
  index: number;
  active: boolean;
  onActivate: (index: number) => void;
}) {
  const source = String(
    note?.source ||
      note?.url ||
      note?.uri ||
      note?.audioUrl ||
      note?.fileUrl ||
      ""
  ).trim();

  const playbackKey = [
    "appointment-voice",
    String(note?.id || ""),
    appointmentVoiceCacheHash(source),
  ].join(":");

  const player = useAudioPlayer(
    source ? { uri: source } : null,
    {
      updateInterval: 100,
    }
  );

  const status = useAudioPlayerStatus(player);

  const [completed, setCompleted] =
    React.useState(false);

  const [cacheBusy, setCacheBusy] =
    React.useState(false);

  const boundSourceRef =
    React.useRef(source);

  /*
   * Bind the player to the persistent local file immediately
   * after the chip mounts. This prevents a remote player from
   * showing loading again when the voice is already cached.
   */
  React.useEffect(() => {
    let cancelled = false;

    const noteId = String(
      note?.id ||
        `appointment_voice_${index}`
    ).trim();

    void resolvePersistentAppointmentVoiceSource(
      noteId,
      source
    ).then((resolvedSource) => {
      if (
        cancelled ||
        !resolvedSource ||
        boundSourceRef.current ===
          resolvedSource
      ) {
        return;
      }

      try {
        player.pause();
      } catch {}

      boundSourceRef.current =
        resolvedSource;

      player.replace({
        uri: resolvedSource,
      });

      console.log(
        "KRISTO_APPOINTMENT_VOICE_PLAYER_PREBOUND",
        {
          voiceIndex: index + 1,
          noteId,
          sourceType:
            resolvedSource.startsWith(
              "file://"
            )
              ? "persistent-local"
              : "remote-fallback",
          sourceEnd:
            resolvedSource.slice(-80),
        }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    index,
    note?.id,
    player,
    source,
  ]);

  const delayedPlayTimerRef =
    React.useRef<
      ReturnType<typeof setTimeout> | null
    >(null);

  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (
        delayedPlayTimerRef.current
      ) {
        clearTimeout(
          delayedPlayTimerRef.current
        );

        delayedPlayTimerRef.current =
          null;
      }

      try {
        player.pause();
      } catch {}

      releaseAppointmentVoicePlayback(
        playbackKey
      );
    };
  }, [
    playbackKey,
    player,
  ]);

  React.useEffect(() => {
    if (active || !status.playing) return;

    try {
      player.pause();
    } catch {}
  }, [
    active,
    player,
    status.playing,
  ]);

  React.useEffect(() => {
    if (!status.didJustFinish) return;

    setCompleted(true);

    releaseAppointmentVoicePlayback(
      playbackKey
    );

    console.log(
      "KRISTO_APPOINTMENT_VOICE_COMPLETED",
      {
        voiceIndex: index + 1,
      }
    );
  }, [
    index,
    playbackKey,
    status.didJustFinish,
  ]);

  const savedDuration = Number(
    note?.durationSec ||
      note?.duration ||
      0
  );

  const duration =
    Number(status.duration || 0) > 0
      ? Number(status.duration)
      : savedDuration;

  const currentTime = Number(
    status.currentTime || 0
  );

  const progress = completed
    ? 1
    : duration > 0
      ? Math.min(
          1,
          Math.max(
            0,
            currentTime / duration
          )
        )
      : 0;

  const loading =
    active &&
    (
      cacheBusy ||
      status.isBuffering
    );

  const playing =
    active && status.playing;

  async function toggleVoice() {
    if (!source || cacheBusy) return;

    if (
      active &&
      status.playing
    ) {
      try {
        player.pause();
      } catch {}

      releaseAppointmentVoicePlayback(
        playbackKey
      );

      return;
    }

    onActivate(index);
    setCacheBusy(true);

    const noteId = String(
      note?.id ||
        `appointment_voice_${index}`
    ).trim();

    try {
      const playbackSource =
        await resolvePersistentAppointmentVoiceSource(
          noteId,
          source
        );

      if (
        !mountedRef.current ||
        !playbackSource
      ) {
        return;
      }

      const sourceChanged =
        boundSourceRef.current !==
        playbackSource;

      if (sourceChanged) {
        try {
          player.pause();
        } catch {}

        boundSourceRef.current =
          playbackSource;

        player.replace({
          uri: playbackSource,
        });

        setCompleted(false);

        /*
         * replace() loads the source natively.
         * Give the local file a short load window before play,
         * avoiding the old replace-and-play race.
         */
        if (
          delayedPlayTimerRef.current
        ) {
          clearTimeout(
            delayedPlayTimerRef.current
          );
        }

        delayedPlayTimerRef.current =
          setTimeout(
            () => {
              if (!mountedRef.current) {
                return;
              }

              try {
                claimAppointmentVoicePlayback(
                  playbackKey,
                  () => {
                    try {
                      player.pause();
                    } catch {}
                  }
                );

                player.seekTo(0);
                player.play();

                console.log(
                  "KRISTO_APPOINTMENT_VOICE_LOCAL_PLAY",
                  {
                    voiceIndex:
                      index + 1,
                    noteId,
                    sourceType:
                      playbackSource.startsWith(
                        "file://"
                      )
                        ? "persistent-local"
                        : "remote-fallback",
                    sourceEnd:
                      playbackSource.slice(
                        -80
                      ),
                  }
                );
              } catch (
                error: any
              ) {
                console.warn(
                  "KRISTO_APPOINTMENT_VOICE_LOCAL_PLAY_FAILED",
                  {
                    voiceIndex:
                      index + 1,
                    noteId,
                    message: String(
                      error?.message ||
                        error ||
                        "unknown"
                    ),
                  }
                );
              }
            },
            180
          );

        return;
      }

      const durationValue =
        Number(status.duration || 0);

      const currentValue =
        Number(status.currentTime || 0);

      const finished =
        completed ||
        (
          durationValue > 0 &&
          currentValue >=
            durationValue - 0.1
        );

      if (finished) {
        player.seekTo(0);
      }

      setCompleted(false);

      claimAppointmentVoicePlayback(
        playbackKey,
        () => {
          try {
            player.pause();
          } catch {}
        }
      );

      player.play();

      console.log(
        "KRISTO_APPOINTMENT_VOICE_PLAY",
        {
          voiceIndex: index + 1,
          noteId,
          sourceType:
            playbackSource.startsWith(
              "file://"
            )
              ? "persistent-local"
              : "remote",
          sourceEnd:
            playbackSource.slice(-80),
          cacheReused:
            playbackSource !== source,
          restarted: finished,
        }
      );
    } catch (error: any) {
      console.warn(
        "KRISTO_APPOINTMENT_VOICE_PLAY_FAILED",
        {
          voiceIndex: index + 1,
          noteId: String(
            note?.id || ""
          ),
          message: String(
            error?.message ||
              error ||
              "unknown"
          ),
        }
      );
    } finally {
      if (mountedRef.current) {
        setCacheBusy(false);
      }
    }
  }

  const segmentCount = 16;
  const filledSegments = Math.round(
    progress * segmentCount
  );

  const ringSize = 44;
  const ringCenter = ringSize / 2;
  const ringRadius = 19;

  return (
    <Pressable
      onPress={toggleVoice}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 82,
        paddingHorizontal: 2,
        paddingVertical: 7,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active
          ? "rgba(217,179,95,0.11)"
          : "rgba(255,255,255,0.035)",
        borderWidth: 1,
        borderColor: active
          ? "rgba(217,179,95,0.40)"
          : "rgba(255,255,255,0.08)",
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <Text
        style={{
          marginBottom: 4,
          color:
            active || completed
              ? "#F4D06F"
              : "rgba(255,255,255,0.52)",
          fontSize: 9,
          fontWeight: "900",
        }}
      >
        {index + 1}
      </Text>

      <View
        style={{
          width: ringSize,
          height: ringSize,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {Array.from(
          { length: segmentCount },
          (_, segmentIndex) => {
            const angle =
              (
                segmentIndex /
                segmentCount
              ) *
                Math.PI *
                2 -
              Math.PI / 2;

            const dotWidth = 3;
            const dotHeight = 6;

            const left =
              ringCenter +
              Math.cos(angle) *
                ringRadius -
              dotWidth / 2;

            const top =
              ringCenter +
              Math.sin(angle) *
                ringRadius -
              dotHeight / 2;

            const filled =
              segmentIndex <
              filledSegments;

            return (
              <View
                key={`voice_ring_${index}_${segmentIndex}`}
                style={{
                  position: "absolute",
                  left,
                  top,
                  width: dotWidth,
                  height: dotHeight,
                  borderRadius: 3,
                  backgroundColor: filled
                    ? "#D9B35F"
                    : "rgba(255,255,255,0.12)",
                  transform: [
                    {
                      rotate:
                        `${
                          (
                            segmentIndex /
                            segmentCount
                          ) *
                          360
                        }deg`,
                    },
                  ],
                }}
              />
            );
          }
        )}

        <View
          style={{
            width: 31,
            height: 31,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: active
              ? "rgba(217,179,95,0.18)"
              : "rgba(255,255,255,0.055)",
          }}
        >
          {loading ? (
            <ActivityIndicator
              size="small"
              color={GOLD}
            />
          ) : (
            <Ionicons
              name={
                playing
                  ? "pause"
                  : completed
                    ? "checkmark"
                    : "play"
              }
              size={15}
              color={
                active || completed
                  ? GOLD
                  : "#FFFFFF"
              }
            />
          )}
        </View>
      </View>

      <Text
        numberOfLines={1}
        style={{
          marginTop: 4,
          color:
            "rgba(255,255,255,0.52)",
          fontSize: 8,
          fontWeight: "800",
          fontVariant: [
            "tabular-nums",
          ],
        }}
      >
        {formatAppointmentVoiceDuration(
          duration
        )}
      </Text>
    </Pressable>
  );
}

function AppointmentVoicePlaylist({
  voiceNotes,
  threadId,
  messageId,
  deletedStorageItemIds,
}: {
  voiceNotes: Array<Record<string, any>>;
  threadId: string;
  messageId: string;
  deletedStorageItemIds?: string[];
}) {
  const isFocused = useIsFocused();

  const notes = React.useMemo<
    Array<Record<string, any>>
  >(
    () =>
      (
        Array.isArray(voiceNotes)
          ? voiceNotes
          : []
      )
        .slice(0, 5)
        .map(
          (
            rawNote: Record<string, any>,
            index: number
          ) => {
            const source = String(
              rawNote?.source ||
                rawNote?.url ||
                rawNote?.uri ||
                rawNote?.audioUrl ||
                rawNote?.fileUrl ||
                ""
            ).trim();

            return {
              ...rawNote,
              voiceIndex: index,
              source,
              storageItemId:
                appointmentVoiceStorageItemId(
                  messageId,
                  rawNote?.id,
                  index
                ),
            };
          }
        )
        .filter(
          (note: Record<string, any>) =>
            !!String(
              note?.source || ""
            ).trim()
        ),
    [messageId, voiceNotes]
  );

  const hiddenAppointmentVoiceIds =
    React.useMemo(
      () =>
        new Set(
          Array.isArray(
            deletedStorageItemIds
          )
            ? deletedStorageItemIds.map(
                String
              )
            : []
        ),
      [deletedStorageItemIds]
    );

  const visibleNotes = React.useMemo(
    () =>
      notes.filter(
        (note: Record<string, any>) =>
          !hiddenAppointmentVoiceIds.has(
            String(
              note?.storageItemId || ""
            )
          )
      ),
    [
      hiddenAppointmentVoiceIds,
      notes,
    ]
  );

  const deletedCount =
    notes.length - visibleNotes.length;

  const [activeIndex, setActiveIndex] =
    React.useState<number | null>(null);

  React.useEffect(() => {
    if (activeIndex === null) return;

    const activeStillVisible =
      visibleNotes.some(
        (note: Record<string, any>) =>
          Number(note?.voiceIndex) ===
          activeIndex
      );

    if (!activeStillVisible) {
      setActiveIndex(null);
    }
  }, [
    activeIndex,
    visibleNotes,
  ]);

  React.useEffect(() => {
    console.log(
      "KRISTO_APPOINTMENT_VOICE_SOURCES",
      notes.map(
        (note: Record<string, any>) => {
          const noteSource = String(
            note?.source || ""
          );

          return {
            voiceIndex:
              Number(
                note?.voiceIndex || 0
              ) + 1,
            id: String(
              note?.id || ""
            ),
            storageItemId: String(
              note?.storageItemId || ""
            ),
            hidden:
              hiddenAppointmentVoiceIds.has(
                String(
                  note?.storageItemId || ""
                )
              ),
            sourceLength:
              noteSource.length,
            sourceStart:
              noteSource.slice(0, 48),
            sourceEnd:
              noteSource.slice(-32),
          };
        }
      )
    );
  }, [
    hiddenAppointmentVoiceIds,
    notes,
  ]);

  React.useEffect(() => {
    if (!visibleNotes.length) {
      return;
    }

    const timer = setTimeout(
      () => {
        visibleNotes.forEach(
          (
            note: Record<string, any>
          ) => {
            const noteSource = String(
              note?.source || ""
            ).trim();

            const originalIndex = Number(
              note?.voiceIndex || 0
            );

            const noteId = String(
              note?.id ||
                `appointment_voice_${originalIndex}`
            ).trim();

            scheduleAppointmentVoicePrecache(
              noteId,
              noteSource
            );
          }
        );
      },
      350
    );

    return () => {
      clearTimeout(timer);
    };
  }, [visibleNotes]);

  if (!notes.length) {
    return null;
  }

  return (
    <View
      style={{
        marginTop: 14,
      }}
    >
      <View
        style={{
          marginBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent:
            "space-between",
        }}
      >
        <Text
          style={{
            color:
              "rgba(255,255,255,0.72)",
            fontSize: 11,
            fontWeight: "900",
          }}
        >
          Voice messages
        </Text>

        <Text
          style={{
            color:
              "rgba(217,179,95,0.82)",
            fontSize: 10,
            fontWeight: "900",
          }}
        >
          {visibleNotes.length} /{" "}
          {notes.length}
        </Text>
      </View>

      <View
        style={{
          width: "100%",
          flexDirection: "row",
          gap: 6,
        }}
      >
        {notes.map(
          (note: Record<string, any>) => {
            const originalIndex = Number(
              note?.voiceIndex || 0
            );

            const hidden =
              hiddenAppointmentVoiceIds.has(
                String(
                  note?.storageItemId || ""
                )
              );

            if (hidden) {
              return (
                <AppointmentDeletedVoiceChip
                  key={[
                    "appointment_voice_deleted",
                    String(
                      note?.storageItemId ||
                        ""
                    ),
                  ].join(":")}
                  index={originalIndex}
                />
              );
            }

            return (
              <AppointmentVoiceChip
                key={[
                  "appointment_voice",
                  originalIndex,
                  String(
                    note?.id || ""
                  ),
                  String(
                    note?.source || ""
                  ),
                ].join(":")}
                note={note}
                index={originalIndex}
                active={
                  activeIndex ===
                  originalIndex
                }
                onActivate={
                  setActiveIndex
                }
              />
            );
          }
        )}
      </View>

      {deletedCount > 0 ? (
        <View
          style={{
            marginTop: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Ionicons
            name="trash-outline"
            size={11}
            color="rgba(255,146,152,0.72)"
          />

          <Text
            style={{
              color:
                "rgba(255,255,255,0.46)",
              fontSize: 9,
              fontWeight: "700",
            }}
          >
            {deletedCount} recording
            {deletedCount === 1
              ? ""
              : "s"}{" "}
            removed from your storage
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function AppointmentRequestVipCard({
  message,
  appointment,
  mine,
  senderName,
  senderAvatarUri,
  createdAt,
  currentUserId,
  busy,
  selected,
  onPress,
  onLongPress,
  onAccept,
  onReply,
  onReject,
  onSchedule,
}: {
  message: MsgItem;
  appointment: Record<string, any>;
  mine: boolean;
  senderName: string;
  senderAvatarUri: string;
  createdAt: number;
  currentUserId: string;
  busy: string | null;
  selected?: boolean;
  onPress?: () => void;
  onLongPress: () => void;
  onAccept: () => void;
  onReply: () => void;
  onReject: () => void;
  onSchedule: () => void;
}) {
  const [expanded, setExpanded] =
    React.useState(false);

  const status = String(
    appointment?.status || "pending"
  ).toLowerCase();

  const isPending =
    status === "pending";

  const isAccepted =
    status === "accepted_awaiting_time" ||
    status === "accepted";

  const isRejected =
    status === "rejected";

  const isCancelled =
    status === "cancelled";

  const isProposed =
    status === "time_proposed";

  const isConfirmed =
    status === "confirmed";

  const isReschedule =
    status === "reschedule_requested";

  const requestText = String(
    appointment?.originalMessage ||
      appointment?.message ||
      message.text ||
      ""
  ).trim();

  const workflowMessage = String(
    appointment?.message || ""
  ).trim();

  const voiceNotes = Array.isArray(
    appointment?.voiceNotes
  )
    ? appointment.voiceNotes.slice(0, 5)
    : [];

  const requesterId = String(
    appointment?.requesterId || ""
  ).trim();

  const recipientId = String(
    appointment?.recipientId || ""
  ).trim();

  const canRespond =
    !mine &&
    isPending &&
    currentUserId === recipientId;

  const canRespondToProposal =
    isProposed &&
    currentUserId === requesterId;

  const workflowSenderUserId = String(
    appointment?.workflowSenderUserId || ""
  ).trim();

  const receivedNegotiation =
    isReschedule &&
    !!currentUserId &&
    !!workflowSenderUserId &&
    currentUserId !== workflowSenderUserId;

  const canAcceptNegotiation =
    receivedNegotiation &&
    currentUserId === recipientId;

  const canReplyToNegotiation =
    receivedNegotiation;

  const canScheduleAccepted =
    isAccepted &&
    currentUserId === recipientId;

  const title = isCancelled
    ? "Appointment cancelled"
    : isRejected
      ? "Appointment rejected"
      : isConfirmed
        ? "Appointment confirmed"
        : isProposed
        ? "Appointment time proposed"
        : isAccepted
          ? "Appointment accepted"
          : isReschedule
            ? "New time requested"
            : "Appointment request";

  const accent = isCancelled
    ? "#FF6B72"
    : isRejected
      ? "#FF6B72"
      : isConfirmed || isAccepted
        ? "#4ADE80"
      : isProposed || isReschedule
        ? "#A78BFA"
        : "#F5BE41";

  const shadowColor = accent;

  const borderColor = isCancelled
    ? "rgba(239,68,68,0.62)"
    : isRejected
      ? "rgba(239,68,68,0.52)"
      : isConfirmed || isAccepted
        ? "rgba(34,197,94,0.52)"
      : isProposed || isReschedule
        ? "rgba(167,139,250,0.48)"
        : mine
          ? "rgba(217,179,95,0.48)"
          : "rgba(157,138,255,0.30)";

  const gradientColors = isCancelled
    ? [
        "rgba(92,22,32,0.98)",
        "rgba(46,19,28,0.99)",
        "rgba(18,16,24,0.99)",
      ]
    : isRejected
      ? [
          "rgba(76,18,29,0.97)",
          "rgba(38,17,26,0.99)",
          "rgba(18,16,24,0.99)",
        ]
      : isConfirmed || isAccepted
        ? [
          "rgba(18,68,45,0.96)",
          "rgba(16,39,32,0.99)",
          "rgba(13,20,25,0.99)",
        ]
      : isProposed || isReschedule
        ? [
            "rgba(59,42,91,0.96)",
            "rgba(29,28,49,0.99)",
            "rgba(14,18,29,0.99)",
          ]
        : mine
          ? [
              "rgba(79,59,21,0.94)",
              "rgba(33,28,35,0.98)",
              "rgba(17,20,31,0.99)",
            ]
          : [
              "rgba(29,35,51,0.99)",
              "rgba(18,22,35,0.99)",
              "rgba(13,16,27,0.99)",
            ];

  const footerLabel = isCancelled
    ? "Appointment cancelled"
    : isRejected
      ? "Request declined"
      : isConfirmed
        ? "Appointment ready"
      : isProposed
        ? canRespondToProposal
          ? "Review the proposed time"
          : "Waiting for time confirmation"
        : isAccepted
          ? "Waiting for date and time"
          : isReschedule
            ? canReplyToNegotiation
              ? "Respond to the negotiation"
              : "Waiting for a response"
            : mine
              ? "Waiting for response"
              : voiceNotes.length
                ? `${voiceNotes.length} voice ${
                    voiceNotes.length === 1
                      ? "message"
                      : "messages"
                  }`
                : "Review request";

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      style={[
        {
          width: "96%",
          maxWidth: 430,
          alignSelf: mine
            ? "flex-end"
            : "flex-start",
          marginVertical: 8,
          shadowColor,
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: {
            width: 0,
            height: 10,
          },
          elevation: 10,
        } as ViewStyle,
        selected
          ? s.bubbleSelectedGlow
          : null,
      ]}
    >
      <LinearGradient
        colors={gradientColors as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 27,
          overflow: "hidden",
          borderWidth: 1,
          borderColor,
        }}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[
            "rgba(255,255,255,0.16)",
            "rgba(255,255,255,0.035)",
            "transparent",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={
            StyleSheet.absoluteFillObject
          }
        />

        <View style={{ padding: 18 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 11,
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                padding: 2,
                backgroundColor:
                  `${accent}22`,
                borderWidth: 1,
                borderColor: `${accent}99`,
              }}
            >
              {senderAvatarUri ? (
                <Image
                  source={{
                    uri: senderAvatarUri,
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 22,
                  }}
                />
              ) : (
                <View
                  style={{
                    flex: 1,
                    borderRadius: 22,
                    alignItems: "center",
                    justifyContent:
                      "center",
                    backgroundColor:
                      "rgba(255,255,255,0.07)",
                  }}
                >
                  <Text
                    style={{
                      color: accent,
                      fontSize: 15,
                      fontWeight: "900",
                    }}
                  >
                    {initials(
                      senderName || "A"
                    )}
                  </Text>
                </View>
              )}
            </View>

            <View
              style={{
                flex: 1,
                minWidth: 0,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: "#FFFFFF",
                  fontSize: 17,
                  lineHeight: 22,
                  fontWeight: "900",
                  letterSpacing: -0.25,
                }}
              >
                {title}
              </Text>

              <Text
                numberOfLines={1}
                style={{
                  marginTop: 2,
                  color: accent,
                  fontSize: 11,
                  fontWeight: "800",
                }}
              >
                {mine
                  ? `To ${String(
                      appointment?.recipientName ||
                        "Member"
                    )}`
                  : `From ${senderName}`}
              </Text>
            </View>

            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor:
                  `${accent}20`,
                borderWidth: 1,
                borderColor: `${accent}66`,
                shadowColor: accent,
                shadowOpacity: 0.75,
                shadowRadius: 9,
                shadowOffset: {
                  width: 0,
                  height: 0,
                },
              }}
            >
              {isCancelled ? (
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={accent}
                />
              ) : isRejected ? (
                <Ionicons
                  name="close"
                  size={17}
                  color={accent}
                />
              ) : isConfirmed ||
                isAccepted ? (
                <Ionicons
                  name="checkmark"
                  size={17}
                  color={accent}
                />
              ) : isProposed ||
                isReschedule ? (
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={accent}
                />
              ) : (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor:
                      accent,
                  }}
                />
              )}
            </View>
          </View>

          {requestText ? (
            <View
              style={{
                marginTop: 16,
              }}
            >
              <Text
                numberOfLines={
                  expanded ? undefined : 3
                }
                style={{
                  color:
                    "rgba(255,255,255,0.88)",
                  fontSize: 14,
                  lineHeight: 21,
                  fontWeight: "700",
                }}
              >
                {requestText}
              </Text>

              {requestText.length > 115 ? (
                <Pressable
                  onPress={() =>
                    setExpanded(
                      (value) => !value
                    )
                  }
                  hitSlop={8}
                  style={{
                    alignSelf:
                      "flex-start",
                    marginTop: 7,
                  }}
                >
                  <Text
                    style={{
                      color: accent,
                      fontSize: 11,
                      fontWeight: "900",
                    }}
                  >
                    {expanded
                      ? "View less"
                      : "View more"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {voiceNotes.length ? (
            <AppointmentVoicePlaylist
              voiceNotes={voiceNotes}
              threadId={String(
                message.threadId || ""
              )}
              messageId={String(
                message.id || ""
              )}
              deletedStorageItemIds={
                message
                  .viewerDeletedStorageItemIds ||
                []
              }
            />
          ) : null}

          {isAccepted ? (
            <Pressable
              disabled={!canScheduleAccepted}
              onPress={onSchedule}
              style={({ pressed }) => [
                {
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 17,
                  backgroundColor:
                    canScheduleAccepted
                      ? "rgba(34,197,94,0.15)"
                      : "rgba(34,197,94,0.10)",
                  borderWidth: 1,
                  borderColor:
                    canScheduleAccepted
                      ? "rgba(74,222,128,0.48)"
                      : "rgba(34,197,94,0.28)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                },
                pressed &&
                canScheduleAccepted
                  ? {
                      opacity: 0.76,
                      transform: [
                        {
                          scale: 0.988,
                        },
                      ],
                    }
                  : null,
              ]}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor:
                    "rgba(74,222,128,0.13)",
                  borderWidth: 1,
                  borderColor:
                    "rgba(74,222,128,0.34)",
                }}
              >
                <Ionicons
                  name="calendar-outline"
                  size={19}
                  color="#86EFAC"
                />
              </View>

              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <Text
                  style={{
                    color: "#86EFAC",
                    fontSize: 12,
                    lineHeight: 18,
                    fontWeight: "900",
                  }}
                >
                  The request was accepted.
                </Text>

                <Text
                  style={{
                    marginTop: 2,
                    color:
                      "rgba(255,255,255,0.74)",
                    fontSize: 11,
                    lineHeight: 17,
                    fontWeight: "800",
                  }}
                >
                  {canScheduleAccepted
                    ? "Tap here to choose a date and time."
                    : "Waiting for the recipient to choose a date and time."}
                </Text>
              </View>

              {canScheduleAccepted ? (
                <Ionicons
                  name="chevron-forward"
                  size={19}
                  color="#86EFAC"
                />
              ) : null}
            </Pressable>
          ) : null}

          {isCancelled ? (
            <View
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 17,
                backgroundColor:
                  "rgba(239,68,68,0.12)",
                borderWidth: 1,
                borderColor:
                  "rgba(239,68,68,0.34)",
              }}
            >
              <Text
                style={{
                  color: "#FF9A9F",
                  fontSize: 11,
                  fontWeight: "900",
                  textTransform:
                    "uppercase",
                  letterSpacing: 0.7,
                }}
              >
                Appointment cancelled
              </Text>

              <Text
                style={{
                  marginTop: 7,
                  color:
                    "rgba(255,255,255,0.80)",
                  fontSize: 12,
                  lineHeight: 18,
                  fontWeight: "700",
                }}
              >
                This appointment has been cancelled and is no longer active.
              </Text>

              {workflowMessage &&
              workflowMessage !==
                "Appointment cancelled." ? (
                <Text
                  style={{
                    marginTop: 7,
                    color:
                      "rgba(255,255,255,0.68)",
                    fontSize: 11,
                    lineHeight: 17,
                    fontWeight: "700",
                  }}
                >
                  {workflowMessage}
                </Text>
              ) : null}
            </View>
          ) : null}

          {isRejected ? (
            <View
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 17,
                backgroundColor:
                  "rgba(239,68,68,0.09)",
                borderWidth: 1,
                borderColor:
                  "rgba(239,68,68,0.25)",
              }}
            >
              <Text
                style={{
                  color: "#FF9A9F",
                  fontSize: 11,
                  fontWeight: "900",
                  textTransform:
                    "uppercase",
                  letterSpacing: 0.7,
                }}
              >
                Appointment rejected
              </Text>

              {workflowMessage ? (
                <Text
                  style={{
                    marginTop: 7,
                    color:
                      "rgba(255,255,255,0.78)",
                    fontSize: 12,
                    lineHeight: 18,
                    fontWeight: "700",
                  }}
                >
                  {workflowMessage}
                </Text>
              ) : null}
            </View>
          ) : null}

          {isProposed || isConfirmed ? (
            <View
              style={{
                marginTop: 16,
                padding: 15,
                borderRadius: 18,
                backgroundColor:
                  isConfirmed
                    ? "rgba(34,197,94,0.10)"
                    : "rgba(167,139,250,0.10)",
                borderWidth: 1,
                borderColor:
                  isConfirmed
                    ? "rgba(34,197,94,0.30)"
                    : "rgba(167,139,250,0.30)",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Ionicons
                  name={
                    isConfirmed
                      ? "checkmark-circle"
                      : "calendar-outline"
                  }
                  size={19}
                  color={
                    isConfirmed
                      ? "#4ADE80"
                      : "#C4B5FD"
                  }
                />

                <Text
                  style={{
                    color:
                      isConfirmed
                        ? "#86EFAC"
                        : "#DDD6FE",
                    fontSize: 11,
                    fontWeight: "900",
                    textTransform:
                      "uppercase",
                    letterSpacing: 0.7,
                  }}
                >
                  {isConfirmed
                    ? "Confirmed time"
                    : "Proposed time"}
                </Text>
              </View>

              <Text
                style={{
                  marginTop: 12,
                  color: "#FFFFFF",
                  fontSize: 18,
                  fontWeight: "900",
                }}
              >
                {String(
                  appointment?.date ||
                    "Date pending"
                )}
              </Text>

              <Text
                style={{
                  marginTop: 5,
                  color: accent,
                  fontSize: 15,
                  fontWeight: "900",
                }}
              >
                {String(
                  appointment?.time ||
                    "Time pending"
                )}
                {"  •  "}
                {Number(
                  appointment?.durationMin ||
                    30
                )}{" "}
                min
              </Text>

              {String(
                appointment?.location || ""
              ).trim() ? (
                <View
                  style={{
                    marginTop: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <Ionicons
                    name="location-outline"
                    size={15}
                    color="rgba(255,255,255,0.66)"
                  />

                  <Text
                    style={{
                      flex: 1,
                      color:
                        "rgba(255,255,255,0.72)",
                      fontSize: 12,
                      fontWeight: "800",
                    }}
                  >
                    {String(
                      appointment.location
                    )}
                  </Text>
                </View>
              ) : null}

              {String(
                appointment?.note || ""
              ).trim() ? (
                <Text
                  style={{
                    marginTop: 9,
                    color:
                      "rgba(255,255,255,0.62)",
                    fontSize: 12,
                    lineHeight: 18,
                    fontWeight: "700",
                  }}
                >
                  {String(
                    appointment.note
                  )}
                </Text>
              ) : null}
            </View>
          ) : null}

          {isReschedule &&
          workflowMessage ? (
            <View
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 17,
                backgroundColor:
                  "rgba(167,139,250,0.09)",
                borderWidth: 1,
                borderColor:
                  "rgba(167,139,250,0.26)",
              }}
            >
              <Text
                style={{
                  color: "#DDD6FE",
                  fontSize: 11,
                  fontWeight: "900",
                  textTransform:
                    "uppercase",
                  letterSpacing: 0.7,
                }}
              >
                Negotiation message
              </Text>

              <Text
                style={{
                  marginTop: 7,
                  color:
                    "rgba(255,255,255,0.80)",
                  fontSize: 12,
                  lineHeight: 18,
                  fontWeight: "700",
                }}
              >
                {workflowMessage}
              </Text>
            </View>
          ) : null}

          {canRespond ? (
            <View
              style={{
                marginTop: 17,
                flexDirection: "row",
                gap: 7,
              }}
            >
              {[
                {
                  key: "accept",
                  label: "Accept",
                  color: "#86EFAC",
                  background:
                    "rgba(34,197,94,0.17)",
                  border:
                    "rgba(34,197,94,0.42)",
                  action: onAccept,
                },
                {
                  key: "reply",
                  label: "Reply",
                  color: GOLD,
                  background:
                    "rgba(217,179,95,0.12)",
                  border:
                    "rgba(217,179,95,0.34)",
                  action: onReply,
                },
                {
                  key: "reject",
                  label: "Reject",
                  color: "#FF8A8A",
                  background:
                    "rgba(239,68,68,0.11)",
                  border:
                    "rgba(239,68,68,0.34)",
                  action: onReject,
                },
              ].map((item) => (
                <Pressable
                  key={item.key}
                  disabled={busy !== null}
                  onPress={item.action}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 42,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent:
                      "center",
                    backgroundColor:
                      item.background,
                    borderWidth: 1,
                    borderColor:
                      item.border,
                    opacity:
                      pressed ? 0.78 : 1,
                  })}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: item.color,
                      fontSize: 11,
                      fontWeight: "900",
                    }}
                  >
                    {busy === item.key
                      ? "..."
                      : item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {canReplyToNegotiation ? (
            <View
              style={{
                marginTop: 16,
                flexDirection: "row",
                gap: 7,
              }}
            >
              {canAcceptNegotiation ? (
                <Pressable
                  disabled={busy !== null}
                  onPress={onSchedule}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      minHeight: 44,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor:
                        "rgba(34,197,94,0.18)",
                      borderWidth: 1,
                      borderColor:
                        "rgba(34,197,94,0.45)",
                    },
                    pressed
                      ? {
                          opacity: 0.78,
                          transform: [
                            {
                              scale: 0.985,
                            },
                          ],
                        }
                      : null,
                  ]}
                >
                  <Text
                    style={{
                      color: "#86EFAC",
                      fontSize: 11,
                      fontWeight: "900",
                    }}
                  >
                    Accept
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                disabled={busy !== null}
                onPress={onReply}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor:
                      "rgba(167,139,250,0.14)",
                    borderWidth: 1,
                    borderColor:
                      "rgba(167,139,250,0.38)",
                  },
                  pressed
                    ? {
                        opacity: 0.78,
                        transform: [
                          {
                            scale: 0.985,
                          },
                        ],
                      }
                    : null,
                ]}
              >
                <Text
                  style={{
                    color: "#DDD6FE",
                    fontSize: 11,
                    fontWeight: "900",
                  }}
                >
                  Reply
                </Text>
              </Pressable>

              <Pressable
                disabled={busy !== null}
                onPress={onReject}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor:
                      "rgba(239,68,68,0.12)",
                    borderWidth: 1,
                    borderColor:
                      "rgba(239,68,68,0.38)",
                  },
                  pressed
                    ? {
                        opacity: 0.78,
                        transform: [
                          {
                            scale: 0.985,
                          },
                        ],
                      }
                    : null,
                ]}
              >
                <Text
                  style={{
                    color: "#FF9298",
                    fontSize: 11,
                    fontWeight: "900",
                  }}
                >
                  Reject
                </Text>
              </Pressable>
            </View>
          ) : null}

          {canRespondToProposal ? (
            <View
              style={{
                marginTop: 16,
                flexDirection: "row",
                gap: 8,
              }}
            >
              <Pressable
                disabled={busy !== null}
                onPress={onAccept}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 45,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor:
                    "rgba(34,197,94,0.20)",
                  borderWidth: 1,
                  borderColor:
                    "rgba(34,197,94,0.45)",
                  opacity:
                    pressed ? 0.78 : 1,
                })}
              >
                <Text
                  style={{
                    color: "#86EFAC",
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {busy === "confirm"
                    ? "Confirming..."
                    : "Confirm"}
                </Text>
              </Pressable>

              <Pressable
                disabled={busy !== null}
                onPress={onReply}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 45,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor:
                    "rgba(167,139,250,0.13)",
                  borderWidth: 1,
                  borderColor:
                    "rgba(167,139,250,0.35)",
                  opacity:
                    pressed ? 0.78 : 1,
                })}
              >
                <Text
                  style={{
                    color: "#DDD6FE",
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {busy === "reschedule"
                    ? "Sending..."
                    : "Negotiate"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor:
                "rgba(255,255,255,0.08)",
              flexDirection: "row",
              alignItems: "center",
              justifyContent:
                "space-between",
            }}
          >
            <Text
              style={{
                color:
                  "rgba(255,255,255,0.52)",
                fontSize: 10,
                fontWeight: "800",
              }}
            >
              {footerLabel}
            </Text>

            <Text
              style={{
                color:
                  "rgba(255,255,255,0.42)",
                fontSize: 10,
                fontWeight: "800",
              }}
            >
              {formatTime(
                Number(
                  appointment?.workflowCreatedAt ||
                    createdAt
                )
              )}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function Bubble({
  m,
  showAvatar,
  onLongPress,
  onPress,
  selected,
  actionHighlighted,
  churchPastorUserId,
  canClaimAssignmentCard,
  canAddAssignmentCard,
  canAddVideoAssignmentCard,
  onClaimAssignmentCard,
  onAddAssignmentMember,
  onAddVideoAssignmentCard,
  onOpenScheduledLive,
  onPreviewImage,
  onOpenSharedPost,
  claimingAssignmentMessageIds,
  isChurchLiveControlRoom,
  churchLiveControlScheduleModel,
  liveScheduleNowMs,
  profileName,
  profileAvatarUri,
  onEnterLiveFromScheduleCard,
}: {
  m: MsgItem;
  showAvatar?: boolean;
  onLongPress: () => void;
  onPress?: () => void;
  selected?: boolean;
  actionHighlighted?: boolean;
  churchPastorUserId?: string;
  canClaimAssignmentCard?: boolean;
  canAddAssignmentCard?: boolean;
  canAddVideoAssignmentCard?: boolean;
  claimingAssignmentMessageIds?: Record<string, true>;
  onClaimAssignmentCard?: (messageId: string) => void;
  onAddAssignmentMember?: (messageId: string) => void;
  onAddVideoAssignmentCard?: (messageId: string) => void;
  onOpenScheduledLive?: (m: MsgItem) => void;
  onPreviewImage?: (uri: string) => void;
  onOpenSharedPost?: (shared: SharedContentPayload) => void;
  isChurchLiveControlRoom?: boolean;
  churchLiveControlScheduleModel?: ChurchLiveControlHomeFeedScheduleModel | null;
  liveScheduleNowMs?: number;
  profileName?: string;
  profileAvatarUri?: string;
  onEnterLiveFromScheduleCard?: (item: any, activeSlot: any) => void;
}) {
  const mine = m.sender === "me";
  const pastorMessage = isPastorMessage(m, { churchPastorUserId });
  const senderAvatar = resolveMessageSenderAvatar(m);
  const appointmentRouter = useRouter();
  const [appointmentBusy, setAppointmentBusy] = useState<string | null>(null);

  const [
    negotiationModalOpen,
    setNegotiationModalOpen,
  ] = useState(false);

  const [
    negotiationText,
    setNegotiationText,
  ] = useState("");

  const [
    negotiationProposal,
    setNegotiationProposal,
  ] = useState<any>(null);

  const appointmentCurrentUserId = String(
    (getKristoHeaders() as any)?.["x-kristo-user-id"] || ""
  ).trim();

  async function sendAppointmentWorkflowMessage(args: {
    kind:
      | "appointment_response"
      | "appointment_time_proposed"
      | "appointment_confirmed";
    text?: string;
    card: Record<string, any>;
  }) {
    const roomId = String(m.threadId || "").trim();
    const clientId = appointmentClientId(args.kind);

    if (!roomId) {
      throw new Error("Appointment conversation room is missing.");
    }

    const headers: Record<string, string> = {
      ...(getKristoHeaders() as Record<string, string>),
      "Content-Type": "application/json",
    };

    const response = await fetch(
      `${String(getApiBase() || "").replace(/\/+$/, "")}/api/church/room-messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          roomId,
          roomKind: "direct",
          kind: args.kind,
          text: String(args.text || "").trim(),
          attachments: [],
          clientId,
          card: args.card,
        }),
      }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.ok === false) {
      throw new Error(
        String(
          payload?.message ||
            payload?.error ||
            "Appointment action could not be completed."
        )
      );
    }

    sendMessage(
      roomId,
      {
        id: String(payload?.data?.id || `local_${clientId}`),
        clientId,
        text: String(args.text || "").trim(),
        attachments: [],
        createdAt: Number(payload?.data?.createdAt || Date.now()),
        pending: false,
        senderUserId: appointmentCurrentUserId,
        displayName: String(
          headers["x-kristo-user-name"] ||
            headers["x-kristo-display-name"] ||
            "Me"
        ),
        senderRole: String(headers["x-kristo-role"] || ""),
        kind: args.kind,
        card: args.card,
      },
      { disableAutoReply: true }
    );

    return payload;
  }

  function promptAppointmentReply(appointment: any) {
    const prompt = (Alert as any)?.prompt;

    if (typeof prompt !== "function") {
      Alert.alert(
        "Reply",
        "Text reply requires the input prompt on this device."
      );
      return;
    }

    prompt(
      "Reply to appointment",
      "Write a reply of up to 500 characters.",
      async (value: string) => {
        const reply = String(value || "").trim();

        if (!reply) return;

        if (reply.length > 500) {
          Alert.alert(
            "Reply too long",
            "Appointment replies cannot exceed 500 characters."
          );
          return;
        }

        setAppointmentBusy("reply");

        try {
          await sendAppointmentWorkflowMessage({
            kind: "appointment_response",
            text: reply,
            card: {
              type: "appointment_response",
              appointmentId: String(appointment?.appointmentId || ""),
              status: "reply",
              requesterId: String(appointment?.requesterId || ""),
              recipientId: String(appointment?.recipientId || ""),
              message: reply,
              createdAt: Date.now(),
            },
          });
        } catch (error: any) {
          Alert.alert(
            "Reply failed",
            String(error?.message || "Please try again.")
          );
        } finally {
          setAppointmentBusy(null);
        }
      }
    );
  }

  function rejectAppointmentRequest(appointment: any) {
    const prompt = (Alert as any)?.prompt;

    const submit = async (reason: string) => {
      setAppointmentBusy("reject");

      try {
        await sendAppointmentWorkflowMessage({
          kind: "appointment_response",
          text: String(reason || "").trim(),
          card: {
            type: "appointment_response",
            appointmentId: String(appointment?.appointmentId || ""),
            status: "rejected",
            requesterId: String(appointment?.requesterId || ""),
            recipientId: String(appointment?.recipientId || ""),
            message: String(reason || "").trim(),
            createdAt: Date.now(),
          },
        });
      } catch (error: any) {
        Alert.alert(
          "Reject failed",
          String(error?.message || "Please try again.")
        );
      } finally {
        setAppointmentBusy(null);
      }
    };

    if (typeof prompt === "function") {
      prompt(
        "Reject appointment?",
        "You may write a short reason.",
        (value: string) => void submit(value),
        "plain-text",
        ""
      );
      return;
    }

    Alert.alert(
      "Reject appointment?",
      "This request will be declined.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: () => void submit(""),
        },
      ]
    );
  }

  async function acceptAppointmentRequest(appointment: any) {
    setAppointmentBusy("accept");

    try {
      await sendAppointmentWorkflowMessage({
        kind: "appointment_response",
        card: {
          type: "appointment_response",
          appointmentId: String(appointment?.appointmentId || ""),
          status: "accepted_awaiting_time",
          requesterId: String(appointment?.requesterId || ""),
          recipientId: String(appointment?.recipientId || ""),
          message: "",
          createdAt: Date.now(),
        },
      });

      appointmentRouter.push({
        pathname:
          "/(tabs)/more/my-church-room/messages/appointment/schedule/[appointmentId]" as any,
        params: {
          appointmentId: String(appointment?.appointmentId || ""),
          roomId: String(m.threadId || ""),
          requesterId: String(appointment?.requesterId || ""),
          recipientId: String(appointment?.recipientId || ""),
          requesterName: String(
            appointment?.requesterName || m.displayName || "Member"
          ),
        },
      });
    } catch (error: any) {
      Alert.alert(
        "Accept failed",
        String(error?.message || "Please try again.")
      );
    } finally {
      setAppointmentBusy(null);
    }
  }

  async function confirmAppointmentProposal(
    proposal: any
  ) {
    setAppointmentBusy("confirm");

    try {
      await sendAppointmentWorkflowMessage({
        kind: "appointment_confirmed",
        card: {
          type: "appointment_confirmed",
          appointmentId: String(
            proposal?.appointmentId || ""
          ),
          status: "confirmed",
          requesterId: String(
            proposal?.requesterId || ""
          ),
          recipientId: String(
            proposal?.recipientId || ""
          ),
          date: String(
            proposal?.date || ""
          ),
          time: String(
            proposal?.time || ""
          ),
          durationMin: Number(
            proposal?.durationMin || 30
          ),
          location: String(
            proposal?.location || ""
          ),
          note: String(
            proposal?.note || ""
          ),
          confirmedAt: Date.now(),
          createdAt: Date.now(),
        },
      });
    } catch (error: any) {
      Alert.alert(
        "Confirmation failed",
        String(
          error?.message ||
            "Please try again."
        )
      );
    } finally {
      setAppointmentBusy(null);
    }
  }

  function closeAppointmentNegotiationModal() {
    if (
      appointmentBusy ===
      "reschedule"
    ) {
      return;
    }

    setNegotiationModalOpen(false);
    setNegotiationText("");
    setNegotiationProposal(null);
  }

  function negotiateAppointmentProposal(
    proposal: any
  ) {
    setNegotiationProposal(proposal);
    setNegotiationText("");
    setNegotiationModalOpen(true);
  }

  async function submitAppointmentNegotiation() {
    const message = String(
      negotiationText || ""
    )
      .trim()
      .slice(0, 45);

    if (!message) return;

    const proposal =
      negotiationProposal;

    if (!proposal) {
      Alert.alert(
        "Negotiation unavailable",
        "The appointment information could not be found."
      );
      return;
    }

    setAppointmentBusy("reschedule");

    try {
      await sendAppointmentWorkflowMessage({
        kind: "appointment_response",
        text: message,
        card: {
          type: "appointment_response",
          appointmentId: String(
            proposal?.appointmentId ||
              ""
          ),
          status:
            "reschedule_requested",
          senderUserId:
            appointmentCurrentUserId,
          requesterId: String(
            proposal?.requesterId ||
              ""
          ),
          recipientId: String(
            proposal?.recipientId ||
              ""
          ),
          message,
          createdAt: Date.now(),
        },
      });

      setNegotiationModalOpen(false);
      setNegotiationText("");
      setNegotiationProposal(null);
    } catch (error: any) {
      Alert.alert(
        "Negotiation failed",
        String(
          error?.message ||
            "Please try again."
        )
      );
    } finally {
      setAppointmentBusy(null);
    }
  }

  if (m.kind === "shared_content" && m.sharedContent) {
    const highlightStyle = selected || actionHighlighted ? s.bubbleSelectedGlow : null;

    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={280}
        style={[
          s.bubbleWrap,
          mine ? ({ alignSelf: "flex-end" } as ViewStyle) : ({ alignSelf: "flex-start" } as ViewStyle),
          highlightStyle,
        ]}
      >
        <SharedContentCard
          shared={m.sharedContent}
          mine={mine}
          senderLabel={!mine ? String(m.displayName || "") : undefined}
          onOpenPost={onOpenSharedPost}
        />
      </Pressable>
    );
  }

  if (isAppointmentRequestMessage(m)) {
    const appointment =
      (m.card || {}) as any;

    const appointmentStatus = String(
      appointment?.status || "pending"
    ).toLowerCase();

    const proposalActive =
      appointmentStatus ===
      "time_proposed";

    const negotiationActive =
      appointmentStatus ===
      "reschedule_requested";

    return (
      <>
        <AppointmentRequestVipCard
        message={m}
        appointment={appointment}
        mine={mine}
        senderName={String(
          m.displayName ||
            appointment?.requesterName ||
            "Member"
        )}
        senderAvatarUri={senderAvatar.uri}
        createdAt={m.createdAt}
        currentUserId={
          appointmentCurrentUserId
        }
        busy={appointmentBusy}
        selected={
          selected ||
          actionHighlighted
        }
        onPress={onPress}
        onLongPress={onLongPress}
        onAccept={() => {
          if (proposalActive) {
            void confirmAppointmentProposal(
              appointment
            );
            return;
          }

          void acceptAppointmentRequest(
            appointment
          );
        }}
        onReply={() => {
          if (
            proposalActive ||
            negotiationActive
          ) {
            negotiateAppointmentProposal(
              appointment
            );
            return;
          }

          promptAppointmentReply(
            appointment
          );
        }}
        onReject={() =>
          rejectAppointmentRequest(
            appointment
          )
        }
        onSchedule={() => {
          appointmentRouter.push({
            pathname:
              "/(tabs)/more/my-church-room/messages/appointment/schedule/[appointmentId]" as any,
            params: {
              appointmentId: String(
                appointment?.appointmentId ||
                  ""
              ),
              roomId: String(
                m.threadId || ""
              ),
              requesterId: String(
                appointment?.requesterId ||
                  ""
              ),
              recipientId: String(
                appointment?.recipientId ||
                  ""
              ),
              requesterName: String(
                appointment?.requesterName ||
                  m.displayName ||
                  "Member"
              ),
            },
          });
        }}
        />

        <Modal
          visible={negotiationModalOpen}
          transparent
          animationType="fade"
          onRequestClose={
            closeAppointmentNegotiationModal
          }
        >
          <KeyboardAvoidingView
            behavior={
              Platform.OS === "ios"
                ? "padding"
                : undefined
            }
            style={{
              flex: 1,
              justifyContent: "center",
              paddingHorizontal: 20,
            }}
          >
            <Pressable
              onPress={
                closeAppointmentNegotiationModal
              }
              style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor:
                  "rgba(0,0,0,0.76)",
              }}
            />

            <View
              style={{
                borderRadius: 24,
                padding: 18,
                backgroundColor:
                  "#151425",
                borderWidth: 1,
                borderColor:
                  "rgba(167,139,250,0.42)",
                shadowColor: "#8B5CF6",
                shadowOpacity: 0.28,
                shadowRadius: 28,
                shadowOffset: {
                  width: 0,
                  height: 12,
                },
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 11,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: "center",
                    justifyContent:
                      "center",
                    backgroundColor:
                      "rgba(167,139,250,0.14)",
                    borderWidth: 1,
                    borderColor:
                      "rgba(167,139,250,0.36)",
                  }}
                >
                  <Ionicons
                    name="time-outline"
                    size={21}
                    color="#C4B5FD"
                  />
                </View>

                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 17,
                      fontWeight: "900",
                    }}
                  >
                    Negotiate time
                  </Text>

                  <Text
                    style={{
                      marginTop: 3,
                      color:
                        "rgba(255,255,255,0.48)",
                      fontSize: 10,
                      fontWeight: "700",
                    }}
                  >
                    Write a short message
                  </Text>
                </View>

                <Text
                  style={{
                    color:
                      negotiationText.length >=
                      45
                        ? "#FF9298"
                        : "#C4B5FD",
                    fontSize: 11,
                    fontWeight: "900",
                    fontVariant: [
                      "tabular-nums",
                    ],
                  }}
                >
                  {negotiationText.length} / 45
                </Text>
              </View>

              <TextInput
                autoFocus
                value={negotiationText}
                onChangeText={(value) => {
                  setNegotiationText(
                    String(value || "").slice(
                      0,
                      45
                    )
                  );
                }}
                maxLength={45}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                placeholder="Which time works better?"
                placeholderTextColor="rgba(255,255,255,0.28)"
                returnKeyType="done"
                blurOnSubmit
                style={{
                  marginTop: 17,
                  minHeight: 104,
                  maxHeight: 130,
                  paddingHorizontal: 14,
                  paddingTop: 13,
                  paddingBottom: 13,
                  borderRadius: 17,
                  color: "#FFFFFF",
                  fontSize: 14,
                  lineHeight: 20,
                  fontWeight: "700",
                  backgroundColor:
                    "rgba(5,7,14,0.72)",
                  borderWidth: 1,
                  borderColor:
                    negotiationText.length >=
                    45
                      ? "rgba(255,107,114,0.50)"
                      : "rgba(167,139,250,0.25)",
                }}
              />

              <View
                style={{
                  marginTop: 16,
                  flexDirection: "row",
                  gap: 10,
                }}
              >
                <Pressable
                  disabled={
                    appointmentBusy ===
                    "reschedule"
                  }
                  onPress={
                    closeAppointmentNegotiationModal
                  }
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      minHeight: 48,
                      borderRadius: 15,
                      alignItems: "center",
                      justifyContent:
                        "center",
                      backgroundColor:
                        "rgba(255,255,255,0.055)",
                      borderWidth: 1,
                      borderColor:
                        "rgba(255,255,255,0.11)",
                    },
                    pressed
                      ? {
                          opacity: 0.72,
                        }
                      : null,
                  ]}
                >
                  <Text
                    style={{
                      color:
                        "rgba(255,255,255,0.70)",
                      fontSize: 12,
                      fontWeight: "900",
                    }}
                  >
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  disabled={
                    !negotiationText.trim() ||
                    appointmentBusy ===
                      "reschedule"
                  }
                  onPress={() => {
                    void submitAppointmentNegotiation();
                  }}
                  style={({ pressed }) => [
                    {
                      flex: 1.25,
                      minHeight: 48,
                      borderRadius: 15,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent:
                        "center",
                      gap: 8,
                      backgroundColor:
                        "#A78BFA",
                      borderWidth: 1,
                      borderColor:
                        "rgba(221,214,254,0.60)",
                    },
                    !negotiationText.trim() ||
                    appointmentBusy ===
                      "reschedule"
                      ? {
                          opacity: 0.36,
                        }
                      : null,
                    pressed &&
                    !!negotiationText.trim()
                      ? {
                          opacity: 0.82,
                          transform: [
                            {
                              scale: 0.988,
                            },
                          ],
                        }
                      : null,
                  ]}
                >
                  {appointmentBusy ===
                  "reschedule" ? (
                    <ActivityIndicator
                      size="small"
                      color="#16121F"
                    />
                  ) : (
                    <Ionicons
                      name="send"
                      size={16}
                      color="#16121F"
                    />
                  )}

                  <Text
                    style={{
                      color: "#16121F",
                      fontSize: 12,
                      fontWeight: "900",
                    }}
                  >
                    {appointmentBusy ===
                    "reschedule"
                      ? "Sending..."
                      : "Send"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </>
    );
  }

  if (isAppointmentResponseMessage(m)) {
    const responseCard = (m.card || {}) as any;
    const responseStatus = String(
      responseCard?.status || "reply"
    ).trim();

    const isRejected = responseStatus === "rejected";
    const isAccepted =
      responseStatus === "accepted_awaiting_time";
    const isReply = responseStatus === "reply";
    const isReschedule =
      responseStatus === "reschedule_requested";

    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={280}
        style={[
          s.bubbleWrap,
          mine
            ? ({ alignSelf: "flex-end" } as ViewStyle)
            : ({ alignSelf: "flex-start" } as ViewStyle),
        ]}
      >
        <View
          style={{
            width: 286,
            maxWidth: "88%",
            padding: 16,
            borderRadius: 21,
            backgroundColor: isRejected
              ? "rgba(48,12,20,0.96)"
              : "rgba(18,22,34,0.97)",
            borderWidth: 1,
            borderColor: isRejected
              ? "rgba(239,68,68,0.40)"
              : "rgba(217,179,95,0.28)",
          }}
        >
          <Text
            style={{
              color: isRejected ? "#FF8A8A" : GOLD,
              fontSize: 11,
              fontWeight: "900",
              textTransform: "uppercase",
              letterSpacing: 0.8,
            }}
          >
            {isRejected
              ? "Appointment declined"
              : isAccepted
                ? "Appointment accepted"
                : isReschedule
                  ? "Another time requested"
                  : "Appointment reply"}
          </Text>

          {String(responseCard?.message || m.text || "").trim() ? (
            <Text
              style={{
                marginTop: 10,
                color: "rgba(255,255,255,0.88)",
                fontSize: 13.5,
                lineHeight: 20,
                fontWeight: "700",
              }}
            >
              {String(responseCard?.message || m.text || "").trim()}
            </Text>
          ) : null}

          {isAccepted ? (
            <Text
              style={{
                marginTop: 10,
                color: "rgba(255,255,255,0.58)",
                fontSize: 11,
                lineHeight: 17,
                fontWeight: "800",
              }}
            >
              Waiting for the recipient to propose a date and time.
            </Text>
          ) : null}

          <Text style={[t.msgTime, { marginTop: 12 }]}>
            {formatTime(m.createdAt)}
          </Text>
        </View>
      </Pressable>
    );
  }

  if (isAppointmentTimeProposalMessage(m)) {
    const proposal = (m.card || {}) as any;
    const requesterCanRespond =
      appointmentCurrentUserId ===
      String(proposal?.requesterId || "").trim();

    async function confirmProposal() {
      setAppointmentBusy("confirm");

      try {
        await sendAppointmentWorkflowMessage({
          kind: "appointment_confirmed",
          card: {
            type: "appointment_confirmed",
            appointmentId: String(proposal?.appointmentId || ""),
            status: "confirmed",
            requesterId: String(proposal?.requesterId || ""),
            recipientId: String(proposal?.recipientId || ""),
            date: String(proposal?.date || ""),
            time: String(proposal?.time || ""),
            durationMin: Number(proposal?.durationMin || 30),
            location: String(proposal?.location || ""),
            note: String(proposal?.note || ""),
            confirmedAt: Date.now(),
            createdAt: Date.now(),
          },
        });
      } catch (error: any) {
        Alert.alert(
          "Confirmation failed",
          String(error?.message || "Please try again.")
        );
      } finally {
        setAppointmentBusy(null);
      }
    }

    function requestAnotherTime() {
      const prompt = (Alert as any)?.prompt;

      if (typeof prompt !== "function") return;

      prompt(
        "Request another time",
        "Explain which time would work better.",
        async (value: string) => {
          const message = String(value || "").trim();
          if (!message) return;

          setAppointmentBusy("reschedule");

          try {
            await sendAppointmentWorkflowMessage({
              kind: "appointment_response",
              text: message,
              card: {
                type: "appointment_response",
                appointmentId: String(proposal?.appointmentId || ""),
                status: "reschedule_requested",
                requesterId: String(proposal?.requesterId || ""),
                recipientId: String(proposal?.recipientId || ""),
                message,
                createdAt: Date.now(),
              },
            });
          } catch (error: any) {
            Alert.alert(
              "Request failed",
              String(error?.message || "Please try again.")
            );
          } finally {
            setAppointmentBusy(null);
          }
        }
      );
    }

    return (
      <View
        style={[
          s.bubbleWrap,
          mine
            ? ({ alignSelf: "flex-end" } as ViewStyle)
            : ({ alignSelf: "flex-start" } as ViewStyle),
        ]}
      >
        <View
          style={{
            width: 300,
            maxWidth: "90%",
            padding: 17,
            borderRadius: 22,
            backgroundColor: "rgba(17,28,34,0.98)",
            borderWidth: 1,
            borderColor: "rgba(34,197,94,0.36)",
          }}
        >
          <Text
            style={{
              color: "#86EFAC",
              fontSize: 11,
              fontWeight: "900",
              textTransform: "uppercase",
              letterSpacing: 0.8,
            }}
          >
            Appointment time proposed
          </Text>

          <Text
            style={{
              marginTop: 13,
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            {String(proposal?.date || "Date pending")}
          </Text>

          <Text
            style={{
              marginTop: 5,
              color: GOLD,
              fontSize: 16,
              fontWeight: "900",
            }}
          >
            {String(proposal?.time || "Time pending")}
            {"  •  "}
            {Number(proposal?.durationMin || 30)} min
          </Text>

          {String(proposal?.location || "").trim() ? (
            <Text
              style={{
                marginTop: 10,
                color: "rgba(255,255,255,0.72)",
                fontSize: 12,
                fontWeight: "800",
              }}
            >
              {String(proposal.location)}
            </Text>
          ) : null}

          {String(proposal?.note || "").trim() ? (
            <Text
              style={{
                marginTop: 9,
                color: "rgba(255,255,255,0.62)",
                fontSize: 12,
                lineHeight: 18,
                fontWeight: "700",
              }}
            >
              {String(proposal.note)}
            </Text>
          ) : null}

          {requesterCanRespond && !mine ? (
            <View style={{ marginTop: 16, gap: 9 }}>
              <Pressable
                disabled={appointmentBusy !== null}
                onPress={() => void confirmProposal()}
                style={{
                  minHeight: 45,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(34,197,94,0.20)",
                  borderWidth: 1,
                  borderColor: "rgba(34,197,94,0.45)",
                }}
              >
                <Text
                  style={{
                    color: "#86EFAC",
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {appointmentBusy === "confirm"
                    ? "Confirming..."
                    : "Accept time"}
                </Text>
              </Pressable>

              <Pressable
                disabled={appointmentBusy !== null}
                onPress={requestAnotherTime}
                style={{
                  minHeight: 43,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.04)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.10)",
                }}
              >
                <Text
                  style={{
                    color: "rgba(255,255,255,0.76)",
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  Request another time
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={[t.msgTime, { marginTop: 13 }]}>
            {formatTime(m.createdAt)}
          </Text>
        </View>
      </View>
    );
  }

  if (isAppointmentConfirmedMessage(m)) {
    const confirmed = (m.card || {}) as any;

    return (
      <View
        style={[
          s.bubbleWrap,
          mine
            ? ({ alignSelf: "flex-end" } as ViewStyle)
            : ({ alignSelf: "flex-start" } as ViewStyle),
        ]}
      >
        <View
          style={{
            width: 300,
            maxWidth: "90%",
            padding: 18,
            borderRadius: 22,
            backgroundColor: "rgba(11,38,27,0.97)",
            borderWidth: 1,
            borderColor: "rgba(34,197,94,0.50)",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
            }}
          >
            <Ionicons
              name="checkmark-circle"
              size={22}
              color="#4ADE80"
            />
            <Text
              style={{
                color: "#86EFAC",
                fontSize: 14,
                fontWeight: "900",
              }}
            >
              Appointment confirmed
            </Text>
          </View>

          <Text
            style={{
              marginTop: 14,
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            {String(confirmed?.date || "")}
          </Text>

          <Text
            style={{
              marginTop: 5,
              color: GOLD,
              fontSize: 16,
              fontWeight: "900",
            }}
          >
            {String(confirmed?.time || "")}
            {"  •  "}
            {Number(confirmed?.durationMin || 30)} min
          </Text>

          {String(confirmed?.location || "").trim() ? (
            <Text
              style={{
                marginTop: 10,
                color: "rgba(255,255,255,0.72)",
                fontSize: 12,
                fontWeight: "800",
              }}
            >
              {String(confirmed.location)}
            </Text>
          ) : null}

          <Text style={[t.msgTime, { marginTop: 13 }]}>
            {formatTime(m.createdAt)}
          </Text>
        </View>
      </View>
    );
  }

  if (m.kind === "assignment_card") {
    const highlightStyle = selected || actionHighlighted ? s.bubbleSelectedGlow : null;

    if (isChurchLiveControlRoom && churchLiveControlScheduleModel) {
      const { item, activeSlot, slotFeedIndex, slotFeedTotal } = churchLiveControlScheduleModel;
      const cardNowMs = Number(liveScheduleNowMs || Date.now());

      console.log("KRISTO_CHURCH_LIVE_CONTROL_CARD_RENDER", {
        roomMessageId: String(m.id || ""),
        slotId: String(activeSlot?.id || ""),
        mappedSlotCount: slotFeedTotal,
        slotFeedIndex,
        slotVisualExpired: resolveScheduleSlotVisualState(activeSlot, slotFeedIndex, cardNowMs, {
          slotId: String(activeSlot?.id || ""),
        })?.expired,
        renderPayload: {
          itemId: String(item?.id || ""),
          slotTitle: String(activeSlot?.name || activeSlot?.title || ""),
          startMs: Number(activeSlot?.startMs || 0) || null,
          endMs: Number(activeSlot?.endMs || 0) || null,
          startTime: String(activeSlot?.startTime || ""),
          endTime: String(activeSlot?.endTime || ""),
          meetingDate: String(activeSlot?.meetingDate || ""),
          durationMin: Number(activeSlot?.durationMin || 0),
        },
      });

      return (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={280}
          style={[s.churchLiveScheduleCardWrap, highlightStyle]}
        >
          <View style={s.churchLiveScheduleCardShell}>
            <HomeLiveScheduleCard
              item={item}
              activeSlot={activeSlot}
              slotFeedIndex={slotFeedIndex}
              slotFeedTotal={slotFeedTotal}
              nowMs={cardNowMs}
              isActive
              fullBleed
              embeddedInRoom
              disableSlotCarousel
              profileName={profileName}
              profileAvatarUri={profileAvatarUri}
              onOpenLiveRoom={() => onEnterLiveFromScheduleCard?.(item, activeSlot)}
              onClaimPress={
                canClaimAssignmentCard &&
                String(m.card?.status || "open").toLowerCase() === "open"
                  ? () => onClaimAssignmentCard?.(m.id)
                  : undefined
              }
            />
          </View>
          <Text style={[t.msgTime, s.assignmentTime]}>{formatTime(m.createdAt)}</Text>
        </Pressable>
      );
    }

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
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={280}
        style={[s.assignmentTimelineWrap, highlightStyle]}
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
            isClaiming: !!claimingAssignmentMessageIds?.[m.id],
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
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      style={[
        s.bubbleWrap,
        mine ? ({ alignSelf: "flex-end" } as ViewStyle) : ({ alignSelf: "flex-start" } as ViewStyle),
        selected || actionHighlighted ? s.bubbleWrapSelected : null,
      ]}
    >
      <FadeInBubbleWrap mine={mine}>
      {mine ? (
        <View style={s.mineRow}>
          <View
            style={[
              s.bubble,
              s.bubbleMineInline,
              pastorMessage ? s.bubblePastor : s.bubbleMine,
              selected || actionHighlighted ? s.bubbleSelectedGlow : null,
            ]}
          >
            {!pastorMessage ? (
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.18)", "rgba(255,255,255,0.05)", "transparent"]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={s.bubbleMineSheen}
              />
            ) : null}
            {m.text ? <Text style={t.msgText}>{m.text}</Text> : null}

            <MessageAttachmentsBlock attachments={m.attachments || []} onPreviewImage={onPreviewImage} />

            <View style={s.msgMetaRow}>
              <Text style={t.msgTimeMine}>{formatTime(m.createdAt)}</Text>
              <View style={s.deliveredRow}>
                <Ionicons name="checkmark-done" size={11} color="rgba(196,181,253,0.88)" />
                <Text style={t.deliveredText}>Delivered</Text>
              </View>
            </View>
          </View>

          <MessageBubbleAvatar
            uri={senderAvatar.uri}
            label={String(m.displayName || "Me")}
            show={true}
            side="right"
          />
        </View>
      ) : (
        <View style={s.otherRow}>
          <MessageBubbleAvatar
            uri={senderAvatar.uri}
            label={String(m.displayName || "U")}
            show={true}
            side="left"
          />

          <View
            style={[
              s.bubble,
              s.bubbleOther,
              s.bubbleOtherInline,
              pastorMessage ? s.bubblePastor : null,
              selected || actionHighlighted ? s.bubbleSelectedGlow : null,
            ]}
          >
            {!!m.displayName && (
              <Text
                style={{
                  color: "#F4D06F",
                  fontSize: 11,
                  fontWeight: "800",
                  marginBottom: 6,
                  letterSpacing: 0.3,
                }}
              >
                {pastorMessage
                  ? pastorShortName(String(m.displayName || ""))
                  : m.displayName}
              </Text>
            )}

            {m.text ? <Text style={t.msgText}>{m.text}</Text> : null}

            <MessageAttachmentsBlock attachments={m.attachments || []} onPreviewImage={onPreviewImage} />

            <Text
              style={[
                t.msgTimeOther,
                pastorMessage ? { color: "rgba(244,208,111,0.86)" } : null,
              ]}
            >
              {formatTime(m.createdAt)}
            </Text>
          </View>
        </View>
      )}
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
  locked,
  v2Restricted,
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
  locked?: boolean;
  v2Restricted?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  ministryCompact?: boolean;
  activeGlow?: boolean;
  onPress: () => void;
}) {
  const isV2Restricted = !!v2Restricted;
  const roleLocked = !!locked && !isV2Restricted;
  const busy = !!disabled && !isV2Restricted;

  const tileBody = (
    <View style={s.menuTileInner}>
      <View style={s.menuTileTop}>
        <View style={[s.menuTileIconWrap, danger ? s.menuTileIconWrapDanger : null]}>
          <Ionicons name={icon as any} size={18} color={danger ? "#FF7D84" : GOLD} />
        </View>

        {roleLocked ? (
          <View style={s.menuTileRedLockPill}>
            <Ionicons name="lock-closed" size={10} color="#FF8A8A" />
            <Text style={s.menuTileRedLockPillText}>Locked</Text>
          </View>
        ) : !isV2Restricted ? (
          <View style={[s.menuTileChevronWrap, danger ? s.menuTileChevronWrapDanger : null]}>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={danger ? "rgba(255,125,132,0.92)" : "rgba(255,255,255,0.42)"}
            />
          </View>
        ) : (
          <View style={s.menuTileTopSpacer} />
        )}
      </View>

      <View style={s.menuTileLabelWrap}>
        <Text
          style={[
            s.menuTileLabel,
            activeGlow && !roleLocked && !busy && !isV2Restricted ? s.menuTileLabelActive : null,
            danger ? s.menuTileLabelDanger : null,
            roleLocked ? s.menuTileLabelRoleLocked : null,
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </View>
    </View>
  );

  return (
    <Pressable
      disabled={isV2Restricted || busy}
      pointerEvents={isV2Restricted ? "none" : undefined}
      onPress={isV2Restricted ? undefined : onPress}
      style={({ pressed }) => [
        s.menuTile,
        compact ? s.menuTileHalf : null,
        ministryCompact ? s.menuTileMinistryCompact : null,
        fullWidth ? s.menuTileFullWidth : null,
        danger && !isV2Restricted ? s.menuTileDanger : null,
        isV2Restricted ? s.menuTileV2Premium : null,
        !isV2Restricted && activeGlow && !roleLocked && !busy ? s.menuTileActiveGlow : null,
        !isV2Restricted && roleLocked ? s.menuTileRoleLocked : null,
        !isV2Restricted && busy ? [s.menuTileDisabled, ({ opacity: 0.58 } as ViewStyle)] : null,
        !isV2Restricted && !roleLocked && pressed && !busy ? s.menuTilePressed : null,
        roleLocked && pressed && !busy ? s.menuTileRoleLockedPressed : null,
      ]}
    >
      {tileBody}
      {isV2Restricted ? (
        <View style={s.menuTileV2Seal} pointerEvents="none">
          <View style={s.menuTileV2SealRing}>
            <Ionicons name="lock-closed" size={18} color="#FF8A8A" />
          </View>
          <Text style={s.menuTileV2SealLabel}>COMING SOON</Text>
        </View>
      ) : null}
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
    router.replace("/(tabs)/profile/messages" as any);
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

  // STRICT LIVE AUTHORITY — resolvedLiveRole / resolvedCanPublish defined after ministryAuthority.

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

  const isPersonToPersonDm =
    normalizedRoomKind === "direct" ||
    normalizedRoomKind === "dm" ||
    normalizedRoomKind === "private" ||
    String(threadId || "").startsWith("dm:");

  const isMinistryThread =
    isPersonToPersonDm
      ? false
      : String((params as any)?.roomKind || "") === "assignment"
      ? false
      : String(threadId || "") === "church-live-control"
        ? false
        : isMediaRoomThread
          ? false
          : !isAssignmentThread && (threadId.startsWith("m") || String(params.tab || "") === "ministries");
  const isStructuredRoom = isMinistryThread || isAssignmentThread;

  // V1 messaging policy:
  // - Enabled: ministry chat, assignment / church-live control chat, person-to-person DMs.
  // - Disabled until V2: church room threads and non-DM private rooms.
  const isChurchRoomThread =
    normalizedRoomKind === "church-room" ||
    normalizedRoomKind === "church-thread" ||
    normalizedRoomKind === "thread";
  const isDirectOrPrivateRoom =
    normalizedRoomKind === "direct" ||
    normalizedRoomKind === "dm" ||
    normalizedRoomKind === "private";
  const hasDirectOrPrivateFlag =
    (params as any)?.isDirect === true ||
    (params as any)?.isPrivate === true ||
    (params as any)?.isChurchThread === true ||
    String((params as any)?.isDirect || "") === "1" ||
    String((params as any)?.isPrivate || "") === "1" ||
    String((params as any)?.isChurchThread || "") === "1";

  const isMessagingDisabledV1 =
    isChurchRoomThread ||
    ((isDirectOrPrivateRoom || hasDirectOrPrivateFlag) && !isPersonToPersonDm);

  // Precise roomKind sent to the backend so server-side V1 enforcement does not
  // depend on the frontend. Never send a generic "chat" for a disabled room.
  const resolvedSendRoomKind = (() => {
    const known = new Set([
      "ministry",
      "assignment",
      "church-live-control",
      "church-room",
      "church-thread",
      "thread",
      "direct",
      "dm",
      "private",
    ]);
    if (known.has(normalizedRoomKind)) return normalizedRoomKind;
    if (isAssignmentThread) return "church-live-control";
    if (isMinistryThread) return "ministry";
    if (isChurchRoomThread) return "church-room";
    if (isDirectOrPrivateRoom) return "direct";
    // Any remaining disabled room (e.g. flagged church-thread/private without an
    // explicit roomKind) must still report a disabled kind to the backend.
    if (isMessagingDisabledV1) return "church-room";
    return "chat";
  })();

  const routeMinistryId = String((params as any)?.ministryId || "").trim();

  const resolvedMinistryId =
    routeMinistryId ||
    (isMinistryThread ? String(threadId || "").trim() : "");

  const backendRoomId = useMemo(
    () =>
      String(
        (params as any)?.ministryId ||
          (params as any)?.assignmentId ||
          resolvedMinistryId ||
          threadId ||
          ""
      ).trim(),
    [threadId, resolvedMinistryId, (params as any)?.ministryId, (params as any)?.assignmentId]
  );

  const isChurchLiveControlRoom = useMemo(
    () => String(backendRoomId || "").trim() === "church-media-room",
    [backendRoomId]
  );

  useEffect(() => {
    if (!isPersonToPersonDm || !isFocused) return;
    const roomId = String(threadId || backendRoomId || "").trim();
    if (!roomId.startsWith("dm:") && !roomId.startsWith("dm_")) return;

    void markDirectMessageThreadRead({
      roomId,
      churchId: String((params as any)?.churchId || churchId || "").trim() || undefined,
    });
  }, [isPersonToPersonDm, isFocused, threadId, backendRoomId, churchId, (params as any)?.churchId]);

  const mediaRoomCacheFreshRef = useRef(false);
  const mediaRoomHydratedRef = useRef(false);
  const memberBoardSigRef = useRef("");
  const mcHostsSigRef = useRef("");

  const [realMinistry, setRealMinistry] = useState<MinistryApiItem | null>(null);
  const [actionLoading, setActionLoading] = useState<"pause" | "leave" | null>(null);
  const [mcHostsOpen, setMcHostsOpen] = useState(false);
  const [mcHostIds, setMcHostIds] = useState<string[]>([]);
  const [realMemberBoardPeople, setRealMemberBoardPeople] = useState<MinistryPerson[]>([]);
  const [churchPastorUserId, setChurchPastorUserId] = useState("");

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

        if (
          !selfId ||
          !currentMinistryId ||
          isPersonToPersonDm ||
          currentMinistryId.startsWith("dm:") ||
          currentMinistryId.startsWith("dm_") ||
          isChurchLiveControlAssignment ||
          isChurchAuthority
        ) {
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

  useEffect(() => {
    let alive = true;

    async function loadChurchPastorUserId() {
      const cid = String(churchId || getKristoHeaders()["x-kristo-church-id"] || "").trim();
      if (!cid) {
        if (alive) setChurchPastorUserId("");
        return;
      }

      try {
        const res = await fetchChurchPastorUserId(cid, getKristoHeaders() as any);
        if (alive) setChurchPastorUserId(String(res.actualChurchPastorUserId || "").trim());
      } catch {
        if (alive) setChurchPastorUserId("");
      }
    }

    void loadChurchPastorUserId();

    return () => {
      alive = false;
    };
  }, [churchId, effectiveAuthUserId]);

  const displayMemberBoardPeople = useMemo(
    () =>
      applyPastorAuthorityToMinistryBoard(realMemberBoardPeople as any[], {
        actualPastorUserId: churchPastorUserId,
        ministryId: resolvedMinistryId,
      }) as MinistryPerson[],
    [realMemberBoardPeople, churchPastorUserId, resolvedMinistryId]
  );

  const currentUserIdForAuthority = String(
    (getKristoHeaders() as any)?.["x-kristo-user-id"] || effectiveAuthUserId || ""
  ).trim();

  const selfMinistryMember = useMemo(
    () =>
      realMemberBoardPeople.find(
        (x: any) => String(x.userId || x.id || "").trim() === currentUserIdForAuthority
      ),
    [realMemberBoardPeople, currentUserIdForAuthority]
  );

  const isSelectedMcHost = useMemo(() => {
    if (!isStructuredRoom) return false;

    const selfIds = [
      currentUserIdForAuthority,
      String((params as any)?.userId || ""),
      String((params as any)?.memberId || ""),
      String((params as any)?.profileId || ""),
    ].filter(Boolean);

    return mcHostIds.some((id) => selfIds.includes(String(id)));
  }, [isStructuredRoom, currentUserIdForAuthority, mcHostIds, params]);

  const ministryAuthority = useMemo(() => {
    const authority = resolveMinistryAuthority({
      appRole: effectiveAuthRole,
      ministryRole: String(selfMinistryMember?.role || assignmentRole || assignmentRoleParam || ""),
      isChurchPastor:
        isPastorAuthority ||
        (!!churchPastorUserId && churchPastorUserId === currentUserIdForAuthority),
      isSelectedMcHost,
    });

    logMinistryAuthority(
      currentUserIdForAuthority,
      String(effectiveAuthRole || ""),
      String(selfMinistryMember?.role || assignmentRole || ""),
      authority
    );

    return authority;
  }, [
    effectiveAuthRole,
    selfMinistryMember?.role,
    assignmentRole,
    assignmentRoleParam,
    isPastorAuthority,
    churchPastorUserId,
    currentUserIdForAuthority,
    isSelectedMcHost,
  ]);

  const prevMcHostAccessRef = useRef<boolean | null>(null);
  useEffect(() => {
    const becameHost = isSelectedMcHost;
    if (prevMcHostAccessRef.current === null) {
      prevMcHostAccessRef.current = becameHost;
      return;
    }
    if (prevMcHostAccessRef.current !== becameHost) {
      console.log("[MinistryAuthority] recomputed", {
        userId: currentUserIdForAuthority,
        isSelectedMcHost: becameHost,
        tier: ministryAuthority.tier,
        canCreateMeeting: ministryAuthority.canCreateMeeting,
        canManageHosts: ministryAuthority.canManageHosts,
        trigger: "mc-host-ids-changed",
      });
      prevMcHostAccessRef.current = becameHost;
    }
  }, [
    isSelectedMcHost,
    ministryAuthority.tier,
    ministryAuthority.canCreateMeeting,
    ministryAuthority.canManageHosts,
    currentUserIdForAuthority,
  ]);

  const mcHostsCacheKey = useMemo(
    () => `mc-hosts:${threadId}:${resolvedMinistryId}:${String((params as any)?.assignmentId || "")}`,
    [threadId, resolvedMinistryId, (params as any)?.assignmentId]
  );

  const fetchMcHostsRef = useRef<
    ((opts?: { force?: boolean; reason?: string }) => Promise<boolean>) | null
  >(null);

  const reloadMemberBoardRef = useRef<((opts?: { force?: boolean }) => Promise<void>) | null>(null);

  const isAssignmentLeader =
    isAssignmentThread &&
    (ministryAuthority.tier === "pastor" || ministryAuthority.tier === "leader");

  const isAssignmentTlmc = isAssignmentThread && ministryAuthority.canOpenTlmcTools;

  const isChurchMediaRoom =
    String(threadId || "").trim() === "church-media-room";

  const resolvedLiveRole =
    isPastorAuthority || ministryAuthority.tier === "pastor"
      ? "Pastor"
      : ministryAuthority.tier === "leader"
        ? "Leader"
        : ministryAuthority.tier === "host"
          ? "Host"
          : String(effectiveAuthRole || assignmentRole || "Member");

  const canManageAssignmentMembers = ministryAuthority.canManageMembers;
  const canScheduleStructuredMeeting = ministryAuthority.canCreateMeeting;
  const canManageMcHosts = ministryAuthority.canManageHosts;
  const canAddMemberAuthority = ministryAuthority.canManageMembers;

  const canEditMinistry = isMinistryThread && ministryAuthority.canManageMembers;
  const canPastorStartChurchLive =
    isChurchLiveControlAssignment &&
    (ministryAuthority.tier === "pastor" || String(effectiveAuthRole || "").toLowerCase() === "pastor");

  const canEditStructuredProfile =
    isMinistryThread ? canEditMinistry : isAssignmentThread ? isAssignmentLeader : false;
  const canManageStructuredMembers = isMinistryThread
    ? canEditMinistry
    : isAssignmentThread
      ? isAssignmentLeader
      : false;
  const canInviteStructuredMembers = canManageStructuredMembers;
  const canOpenTlmcPanel = isAssignmentThread && ministryAuthority.canOpenTlmcTools;
  const canPauseStructuredRoom = canManageStructuredMembers;
  const canRunAssignmentElection = canOpenTlmcPanel;
  const canSendTargetedAssignmentMessage = canOpenTlmcPanel;
  const canManageAssignmentVisibility = isAssignmentLeader;
  const canOpenAssignmentSchedule = ministryAuthority.canCreateMeeting;
  const showAssignmentLockedPreview = isAssignmentThread && ministryAuthority.tier === "member";
  const assignmentToolRole =
    ministryAuthority.tier === "pastor"
      ? "pastor"
      : ministryAuthority.tier === "leader"
        ? "leader"
        : ministryAuthority.tier === "host"
          ? "host"
          : "member";

  const ministryToolGateOpts = useMemo(() => ({ isSelectedMcHost }), [isSelectedMcHost]);

  const ministryToolAccess = useMemo(() => {
    const keys: MinistryToolKey[] = [
      "members_board",
      "profile",
      "add_remove",
      "mc_hosts",
      "meeting",
      "schedule",
      "tlmc_panel",
      "election",
      "targeted_msg",
      "broadcast",
      "visibility",
      "permissions",
      "pause",
    ];
    return Object.fromEntries(
      keys.map((toolKey) => [
        toolKey,
        canOpenMinistryTool(toolKey, ministryAuthority, ministryToolGateOpts),
      ])
    ) as Record<MinistryToolKey, boolean>;
  }, [ministryAuthority, ministryToolGateOpts]);

  const resolvedMinistryRoleLabel = String(
    selfMinistryMember?.role || assignmentRole || assignmentRoleParam || ""
  );

  function gateMinistryTool(toolKey: MinistryToolKey, onAllowed: () => void) {
    const allowed = ministryToolAccess[toolKey];
    logMinistryToolGate({
      toolKey,
      allowed,
      ministryRole: resolvedMinistryRoleLabel,
      appRole: String(effectiveAuthRole || ""),
    });
    if (!allowed) {
      Alert.alert("Access locked", ministryToolLockMessage(toolKey));
      return;
    }
    onAllowed();
  }

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

  const isSelfLiveControlSuspended = useMemo(() => {
    if (!isChurchLiveControlRoom) return false;
    const self = realMemberBoardPeople.find(
      (x: any) => String(x.userId || x.id || "").trim() === currentUserIdForAuthority
    );
    return String(self?.status || "").toLowerCase() === "suspended";
  }, [isChurchLiveControlRoom, realMemberBoardPeople, currentUserIdForAuthority]);

  const isSuspended = ministryInfo.status === "suspended" || isSelfLiveControlSuspended;

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
  const cacheRenderedLoggedRef = useRef(false);

  const ministryViewerHasClaim = useMemo(
    () =>
      viewerHasClaimedAnyAssignmentCard(
        extractAssignmentScheduleCards(messages),
        effectiveAuthUserId
      ),
    [messages, effectiveAuthUserId]
  );

  const resolvedCanPublish =
    isPastorAuthority ||
    isChurchMediaRoom ||
    (isAssignmentThread &&
      !isChurchLiveControlAssignment &&
      resolveMinistryLiveCanPublishForEntry({
        viewerHasClaim: ministryViewerHasClaim,
        viewerIsPastor: isPastorAuthority || ministryAuthority.tier === "pastor",
        viewerIsHost: ministryAuthority.tier === "host" || isSelectedMcHost === true,
        isSelectedMcHost: isSelectedMcHost === true,
      }));

  // Log the instant render from the persisted local store (cached messages /
  // R2 image URLs appear immediately, before any background refresh).
  useEffect(() => {
    if (cacheRenderedLoggedRef.current) return;
    if (!threadId || messages.length === 0) return;
    cacheRenderedLoggedRef.current = true;
    console.log("KRISTO_ROOM_MESSAGES_CACHE_RENDERED", {
      roomId: backendRoomId,
      count: messages.length,
    });
  }, [threadId, backendRoomId, messages.length]);

  const [liveCountdownNow, setLiveCountdownNow] = useState(Date.now());

  useEffect(() => {
    const intervalMs = isStructuredRoom ? 10000 : 30000;
    const timer = setInterval(() => {
      setLiveCountdownNow(Date.now());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isStructuredRoom]);

  const visibleMessages = useMemo(() => {
    const workflowKinds = new Set([
      "appointment_response",
      "appointment_time_proposed",
      "appointment_confirmed",
    ]);

    const latestWorkflowByAppointmentId =
      new Map<string, MsgItem>();

    for (const message of messages) {
      const kind = String(message.kind || "");

      if (!workflowKinds.has(kind)) {
        continue;
      }

      const appointmentId = String(
        (message.card as any)?.appointmentId || ""
      ).trim();

      if (!appointmentId) continue;

      const current =
        latestWorkflowByAppointmentId.get(
          appointmentId
        );

      if (
        !current ||
        Number(message.createdAt || 0) >
          Number(current.createdAt || 0)
      ) {
        latestWorkflowByAppointmentId.set(
          appointmentId,
          message
        );
      }
    }

    const foldedMessages = messages
      .filter(
        (message) =>
          !workflowKinds.has(
            String(message.kind || "")
          )
      )
      .map((message) => {
        if (!isAppointmentRequestMessage(message)) {
          return message;
        }

        const requestCard =
          ((message.card || {}) as Record<
            string,
            any
          >);

        const appointmentId = String(
          requestCard.appointmentId || ""
        ).trim();

        if (!appointmentId) return message;

        const workflow =
          latestWorkflowByAppointmentId.get(
            appointmentId
          );

        if (!workflow?.card) return message;

        const workflowCard =
          workflow.card as Record<string, any>;

        const workflowKind = String(
          workflow.kind || ""
        );

        let status = String(
          workflowCard.status ||
            requestCard.status ||
            "pending"
        ).toLowerCase();

        if (
          workflowKind ===
          "appointment_time_proposed"
        ) {
          status = "time_proposed";
        }

        if (
          workflowKind ===
          "appointment_confirmed"
        ) {
          status = "confirmed";
        }

        return {
          ...message,
          card: {
            ...requestCard,
            ...workflowCard,
            type: "appointment_request",
            appointmentId,
            status,
            workflowKind,
            workflowCreatedAt:
              workflow.createdAt,
            workflowSenderUserId: String(
              workflow.senderUserId ||
                (workflow as any).senderId ||
                (workflow as any).userId ||
                (workflow.card as any)
                  ?.senderUserId ||
                ""
            ).trim(),
            originalMessage:
              requestCard.message ||
              message.text ||
              "",
            voiceNotes:
              requestCard.voiceNotes || [],
          },
        } as MsgItem;
      });

    const paginated = paginateMessages(
      foldedMessages,
      120
    );

    if (!isStructuredRoom) {
      return paginated;
    }

    return paginated.filter(
      (message) =>
        !shouldHideExpiredAssignmentCardInRoom(
          message,
          liveCountdownNow
        )
    );
  }, [
    messages,
    isStructuredRoom,
    liveCountdownNow,
  ]);

  const churchLiveControlScheduleRenderById = useMemo(
    () =>
      isChurchLiveControlRoom
        ? buildChurchLiveControlScheduleRenderMap(visibleMessages, {
            roomId: backendRoomId,
            churchId,
            churchName: String(
              auth?.churchName || auth?.churchLabel || title || "My Church"
            ).trim(),
            mediaName: String(sub || assignmentTitleParam || "Church Media").trim(),
            nowMs: liveCountdownNow,
          })
        : {},
    [
      isChurchLiveControlRoom,
      visibleMessages,
      backendRoomId,
      churchId,
      auth?.churchName,
      auth?.churchLabel,
      title,
      sub,
      assignmentTitleParam,
      liveCountdownNow,
    ]
  );

  const liveScheduleProfileName = String(
    auth?.displayName || auth?.name || auth?.fullName || "You"
  ).trim();
  const liveScheduleProfileAvatarUri = String(
    auth?.avatarUri || auth?.avatarUrl || auth?.profileImage || ""
  ).trim();

  const handleEnterLiveFromChurchScheduleCard = useCallback(
    (item: any, activeSlot: any) => {
      enterLiveRoomFromScheduleCard({
        router,
        item,
        activeSlot,
        viewerUserId: effectiveAuthUserId,
        viewerChurchId: churchId,
        nowMs: liveCountdownNow,
        source: "church-live-control-room-card",
      });
    },
    [router, effectiveAuthUserId, churchId, liveCountdownNow]
  );
  const roomImageGallery = useMemo(() => collectRoomImageGalleryUris(messages), [messages]);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  const roomMessagesSigRef = useRef("");
  const roomMessagesInflightRef = useRef(false);
  const allowEmptyRoomOverwriteRef = useRef(false);
  const memberAvatarByUserIdRef = useRef<Map<string, string>>(new Map());
  const reloadRoomMessagesRef = useRef<((opts?: { force?: boolean }) => Promise<boolean>) | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);

  const filterVisibleRoomMessageRows = useCallback((rows: any[]) => {
    return (Array.isArray(rows) ? rows : []).filter((x: any) => {
      const isDraftCard =
        String(x?.kind || "") === "assignment_card" &&
        String(x?.card?.visibility || "published") === "draft";
      return !isDraftCard;
    });
  }, []);

  const applyVisibleRoomMessageRows = useCallback(
    (visibleRows: any[]): boolean => {
      if (!threadId) return false;

      const headers: any = getKristoHeaders();
      const selfId = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();
      const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");
      const mapped: MsgItem[] = filterVisibleRoomMessageRows(visibleRows)
        .map((x: any) => mapBackendRoomMessageRow(x, threadId, selfId, apiBase))
        .map((m) => enrichMessageSenderAvatar(m, memberAvatarByUserIdRef.current));

      const roomTitle = String(
        isAssignmentThread
          ? ((params as any)?.assignmentTitle || title || "Ministry Assignment")
          : isMinistryThread
            ? (realMinistry?.name || title || "Ministry Room")
            : (title || "Message Room")
      );

      const currentLocalMessages = getSnapshot().messages?.[threadId] || [];

      // Preserve attachments / card on server rows that haven't fully caught up
      // (eventually-consistent store), so a sent image/file/card never flashes
      // and disappears after a poll.
      const enrichedMapped: MsgItem[] = mapped.map((b) => {
        const local = currentLocalMessages.find((l) => backendMatchesLocal(l, b));
        return local ? preserveLocalRichFields(b, local) : b;
      });

      // Keep local messages the server hasn't returned yet:
      //  - media-schedule assignment cards (live-control scheduling)
      //  - the user's own recently-sent / still-pending messages (text, image,
      //    file, card) — covers optimistic AND reconciled-but-not-yet-polled.
      const keptLocal = currentLocalMessages.filter((m: any) => {
        if (localMessageResolvedByBackend(m, enrichedMapped)) return false;

        const isScheduleCard =
          String(m?.kind || "") === "assignment_card" &&
          (String((m as any)?.card?.source || "") === "media-schedule" ||
            String((m as any)?.card?.source || "") === "church-live-control" ||
            String((m as any)?.card?.roomKind || "").includes("church-live-control"));

        return isScheduleCard || isRecentOwnLocalMessage(m);
      });

      const merged = [...keptLocal, ...enrichedMapped].sort(
        (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
      );
      const sig = messagesListSignature(merged);
      if (sig === roomMessagesSigRef.current) return false;

      roomMessagesSigRef.current = sig;
      if (merged.length > 0 || messages.length === 0 || allowEmptyRoomOverwriteRef.current) {
        setThreadMessages(threadId, merged, { title: roomTitle, sub: String(sub || "") });
        if (allowEmptyRoomOverwriteRef.current && merged.length === 0) {
          allowEmptyRoomOverwriteRef.current = false;
        }
        console.log("KRISTO_ROOM_MESSAGES_BACKGROUND_REFRESH", {
          roomId: backendRoomId,
          count: merged.length,
        });
        if (__DEV__) {
          const firstScheduleCard = merged.find(
            (m: any) => String(m?.kind || "") === "assignment_card" && m?.card
          )?.card;
          if (firstScheduleCard) {
            logPersistedScheduleSlotDateDiag("roomMessagesBackgroundRefresh.hydrated", {
              hydrated: firstScheduleCard,
            });
          }
        }
      } else {
        console.log("[RoomMessagesPoll] skip-empty-overwrite", { threadId, backendRoomId });
      }
      return true;
    },
    [
      threadId,
      effectiveAuthUserId,
      title,
      sub,
      isAssignmentThread,
      isMinistryThread,
      realMinistry,
      messages.length,
      filterVisibleRoomMessageRows,
      (params as any)?.assignmentTitle,
    ]
  );

  useEffect(() => {
    if (!isChurchLiveControlRoom || !isFocused) return;

    const cid = String(churchId || getKristoHeaders()["x-kristo-church-id"] || "").trim();
    const uid = String(effectiveAuthUserId || getKristoHeaders()["x-kristo-user-id"] || "").trim();
    if (!cid || !uid) return;

    const roomId = CHURCH_MEDIA_ROOM_ID;
    const assignmentId = CHURCH_MEDIA_ROOM_ID;

    const msgsPeek = peekRoomMessagesCache(cid, uid, roomId);
    const livePeek = peekLiveControlMembersCache(cid, uid, roomId);
    const hostsPeek = peekMcHostsCache(cid, uid, assignmentId);

    mediaRoomCacheFreshRef.current =
      Boolean(msgsPeek && isChurchMediaRoomCacheFresh(msgsPeek.updatedAt)) &&
      Boolean(livePeek && isChurchMediaRoomCacheFresh(livePeek.updatedAt)) &&
      Boolean(hostsPeek && isChurchMediaRoomCacheFresh(hostsPeek.updatedAt));

    let alive = true;

    (async () => {
      const [msgsCache, liveCache, hostsCache] = await Promise.all([
        msgsPeek ? Promise.resolve(msgsPeek) : getRoomMessagesCache(cid, uid, roomId),
        livePeek ? Promise.resolve(livePeek) : getLiveControlMembersCache(cid, uid, roomId),
        hostsPeek ? Promise.resolve(hostsPeek) : getMcHostsCache(cid, uid, assignmentId),
      ]);

      if (!alive) return;

      if (msgsCache?.rawRows?.length) {
        applyVisibleRoomMessageRows(msgsCache.rawRows as any[]);
      }

      if (liveCache?.rawRows) {
        const liveSig = liveControlMembersRawSignature(liveCache.rawRows);
        if (liveSig !== memberBoardSigRef.current) {
          memberBoardSigRef.current = liveSig;
          const targetMinistryId = String(
            resolvedMinistryId || (params as any)?.assignmentId || threadId || ""
          );
          setRealMemberBoardPeople(
            mapLiveControlBoardPeople(
              liveCache.rawRows as any[],
              targetMinistryId,
              String(threadId || ""),
              assignmentId
            ) as MinistryPerson[]
          );
        }
      }

      if (hostsCache?.hostUserIds?.length) {
        const hostSig = mcHostsSignature(hostsCache.hostUserIds);
        if (hostSig !== mcHostsSigRef.current) {
          mcHostsSigRef.current = hostSig;
          setMcHostIds(hostsCache.hostUserIds);
          setCachedParticipant(mcHostsCacheKey, hostsCache.hostUserIds);
        }
      }

      mediaRoomHydratedRef.current = true;

      const headers = getKristoHeaders() as Record<string, string>;
      void refreshRoomMessagesIfNeeded({
        churchId: cid,
        userId: uid,
        roomId,
        headers,
        cacheFresh: mediaRoomCacheFreshRef.current,
        source: "hydrate-background",
      }).then((refresh) => {
        if (!alive) return;
        // Apply even an empty result. applyVisibleRoomMessageRows itself guards
        // against wiping existing local messages with an empty cache, so a
        // cache:0 hydrate cannot erase a just-sent image/card.
        applyVisibleRoomMessageRows(refresh.rawRows || []);
        if (!refresh.skipped) mediaRoomCacheFreshRef.current = true;
      });

      void refreshLiveControlMembersIfNeeded({
        churchId: cid,
        userId: uid,
        roomId,
        headers: { ...headers, "x-kristo-role": "Pastor" },
        cacheFresh: mediaRoomCacheFreshRef.current,
        source: "hydrate-background",
      }).then((refresh) => {
        if (!alive || !refresh.rawRows?.length) return;
        const liveSig = liveControlMembersRawSignature(refresh.rawRows);
        if (liveSig === memberBoardSigRef.current) return;
        memberBoardSigRef.current = liveSig;
        const targetMinistryId = String(
          resolvedMinistryId || (params as any)?.assignmentId || threadId || ""
        );
        setRealMemberBoardPeople(
          mapLiveControlBoardPeople(
            refresh.rawRows,
            targetMinistryId,
            String(threadId || ""),
            assignmentId
          ) as MinistryPerson[]
        );
        if (!refresh.skipped) mediaRoomCacheFreshRef.current = true;
      });

      void refreshMcHostsIfNeeded({
        churchId: cid,
        userId: uid,
        assignmentId,
        headers,
        cacheFresh: mediaRoomCacheFreshRef.current,
        cacheKey: mcHostsCacheKey,
        source: "hydrate-background",
      }).then((refresh) => {
        if (!alive) return;
        const hostSig = mcHostsSignature(refresh.hostUserIds);
        if (hostSig === mcHostsSigRef.current) return;
        mcHostsSigRef.current = hostSig;
        setMcHostIds(refresh.hostUserIds);
        if (!refresh.skipped) mediaRoomCacheFreshRef.current = true;
      });
    })();

    return () => {
      alive = false;
    };
  }, [
    isChurchLiveControlRoom,
    isFocused,
    churchId,
    effectiveAuthUserId,
    threadId,
    resolvedMinistryId,
    mcHostsCacheKey,
    applyVisibleRoomMessageRows,
    (params as any)?.assignmentId,
  ]);

  useEffect(() => {
    if (!threadId || !isFocused) return;
    markThreadReadOnce(threadId, () => {});
  }, [threadId, isFocused]);

  useEffect(() => {
    const uris = visibleMessages
      .flatMap((m: any) => [
        String(m?.avatarUri || "").trim(),
        ...(Array.isArray(m?.attachments)
          ? m.attachments.map((a: any) =>
              resolveMessageAttachmentUrl(String(a?.uri || a?.imageUri || a?.fileUri || ""))
            )
          : []),
      ])
      .filter((u) => /^https?:\/\//i.test(u));
    preloadLiveImages(uris, 24);
  }, [visibleMessages]);

  useEffect(() => {
    if (!threadId || !isFocused) return;

    let alive = true;

    async function loadBackendRoomMessages(opts?: { force?: boolean }): Promise<boolean> {
      const roomId = backendRoomId;
      const forceAfterMutation =
        consumeRoomMessagesForcePoll(CHURCH_MEDIA_ROOM_ID) ||
        consumeRoomMessagesForcePollAfterDelete(CHURCH_MEDIA_ROOM_ID) ||
        consumeRoomMessagesForcePoll(String(roomId || "")) ||
        consumeRoomMessagesForcePollAfterDelete(String(roomId || ""));
      const force = !!opts?.force || forceAfterMutation;

      if (forceAfterMutation) {
        mediaRoomCacheFreshRef.current = false;
        roomMessagesSigRef.current = "";
        allowEmptyRoomOverwriteRef.current = true;
        console.log("KRISTO_ROOM_MESSAGES_POLL_FORCE_AFTER_MUTATION", {
          roomId: roomId || CHURCH_MEDIA_ROOM_ID,
        });
      }
      if (!roomId) return false;

      const headers: any = getKristoHeaders();
      const selfId = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();

      if (isChurchLiveControlRoom) {
        const cid = String(churchId || headers?.["x-kristo-church-id"] || "").trim();
        if (!cid || !selfId) return false;
        // A forced reload (e.g. right after a send) must not be blocked by an
        // in-flight poll, otherwise it returns the stale cache:0 snapshot.
        if (!force && roomMessagesInflightRef.current) return false;

        roomMessagesInflightRef.current = true;
        if (__DEV__) console.log("[RoomMessagesPoll] fetch-start", { backendRoomId: roomId, cached: !force, force });

        let count = 0;
        let updated = false;

        try {
          // FORCED reload: bypass refreshRoomMessagesIfNeeded / cache entirely
          // and always hit the network so a just-saved message can never be
          // hidden behind a cache-fresh skip.
          if (force) {
            console.log("[RoomMessagesFreshGET] start", { roomId: CHURCH_MEDIA_ROOM_ID });
            const res: any = await apiGet(
              `/api/church/room-messages?roomId=${encodeURIComponent(CHURCH_MEDIA_ROOM_ID)}&limit=120&t=${Date.now()}`,
              { headers },
              { screen: `RoomMessagesFreshGET:${CHURCH_MEDIA_ROOM_ID}`, throttleMs: 0, dedupe: false }
            );

            if (!alive) return false;

            const rawRows = Array.isArray(res?.data) ? res.data : [];
            const visibleRows = filterVisibleRoomMessageRows(rawRows);
            count = visibleRows.length;

            // Keep the cache consistent with the fresh truth so later polls agree.
            try {
              await saveRoomMessagesCache({
                churchId: cid,
                userId: selfId,
                roomId: CHURCH_MEDIA_ROOM_ID,
                rawRows: visibleRows as any[],
                updatedAt: Date.now(),
              });
              mediaRoomCacheFreshRef.current = true;
            } catch {}

            updated = applyVisibleRoomMessageRows(visibleRows);
            console.log("[RoomMessagesFreshGET] done", {
              roomId: CHURCH_MEDIA_ROOM_ID,
              rawCount: rawRows.length,
              mappedCount: count,
            });
            return updated;
          }

          // NON-FORCE poll: cache-aware path.
          const refresh = await refreshRoomMessagesIfNeeded({
            churchId: cid,
            userId: selfId,
            roomId: CHURCH_MEDIA_ROOM_ID,
            headers,
            force: false,
            cacheFresh: false,
            source: composerFocused ? "poll-active" : "poll",
          });

          if (!alive) return false;

          const visibleRows = filterVisibleRoomMessageRows(refresh.rawRows);
          count = visibleRows.length;
          if (!refresh.skipped) mediaRoomCacheFreshRef.current = true;
          updated = applyVisibleRoomMessageRows(visibleRows);
          return updated;
        } finally {
          roomMessagesInflightRef.current = false;
          if (__DEV__) console.log("[RoomMessagesPoll] fetch-done", { count, updated });
        }
      }

      if (!force && roomMessagesInflightRef.current) return false;

      roomMessagesInflightRef.current = true;
      if (__DEV__) console.log("[RoomMessagesPoll] fetch-start", { backendRoomId: roomId });

      let count = 0;
      let updated = false;

      try {
        const res: any = await apiGet(
          `/api/church/room-messages?roomId=${encodeURIComponent(roomId)}&limit=120&t=${Date.now()}`,
          { headers },
          { screen: `RoomMessagesPoll:${roomId}`, throttleMs: 0, dedupe: false }
        );

        const rows = Array.isArray(res?.data) ? res.data : [];
        if (!alive || !Array.isArray(rows)) return false;

        const visibleRows = filterVisibleRoomMessageRows(rows);
        count = visibleRows.length;
        updated = applyVisibleRoomMessageRows(visibleRows);
        return updated;
      } finally {
        roomMessagesInflightRef.current = false;
        if (__DEV__) console.log("[RoomMessagesPoll] fetch-done", { count, updated });
      }
    }

    reloadRoomMessagesRef.current = loadBackendRoomMessages;
    void loadBackendRoomMessages();

    const stop = startRoomMessagesPolling({
      roomId: backendRoomId,
      enabled: isFocused,
      onTick: loadBackendRoomMessages,
    });

    return () => {
      alive = false;
      stop();
    };
  }, [threadId, backendRoomId, effectiveAuthUserId, churchId, title, sub, isAssignmentThread, isMinistryThread, isChurchLiveControlAssignment, isChurchLiveControlRoom, realMinistry, (params as any)?.ministryId, (params as any)?.assignmentId, isFocused, composerFocused, applyVisibleRoomMessageRows, filterVisibleRoomMessageRows]);

  // Force a fresh room-messages GET that bypasses the media-room cache. Used
  // right after a successful send/reconcile/card mutation so the next poll
  // cannot return the stale cache:0 snapshot (CACHE_HIT / REFRESH_SKIPPED).
  const forceReloadRoomMessages = useCallback(() => {
    try {
      const headers: any = getKristoHeaders();
      const cid = String(churchId || headers?.["x-kristo-church-id"] || "").trim();
      const uid = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();
      if (cid && uid) {
        // Live-control room messages are cached under CHURCH_MEDIA_ROOM_ID.
        invalidateRoomMessagesCache(cid, uid, CHURCH_MEDIA_ROOM_ID);
        resetRoomMessagesRefreshState(cid, uid, CHURCH_MEDIA_ROOM_ID);
        if (backendRoomId && backendRoomId !== CHURCH_MEDIA_ROOM_ID) {
          invalidateRoomMessagesCache(cid, uid, backendRoomId);
          resetRoomMessagesRefreshState(cid, uid, backendRoomId);
        }
      }
    } catch {}
    mediaRoomCacheFreshRef.current = false;
    roomMessagesSigRef.current = "";
    void reloadRoomMessagesRef.current?.({ force: true });
  }, [churchId, effectiveAuthUserId, backendRoomId]);

  useEffect(() => {
    if (!isChurchLiveControlRoom) return;
    return subscribeChurchLiveControlRoomSync((payload) => {
      console.log("KRISTO_CHURCH_LIVE_CONTROL_ROOM_SYNC_RECEIVED", {
        threadId,
        backendRoomId,
        action: payload.action,
        reason: payload.reason || null,
      });
      forceReloadRoomMessages();
    });
  }, [isChurchLiveControlRoom, threadId, backendRoomId, forceReloadRoomMessages]);

  useEffect(() => {
    return subscribeScheduleRoomDeleteInvalidation((payload) => {
      const relevantIds = new Set(
        [
          threadId,
          backendRoomId,
          CHURCH_MEDIA_ROOM_ID,
          String((params as any)?.assignmentId || ""),
          String((params as any)?.ministryId || ""),
          String(resolvedMinistryId || ""),
        ]
          .map((x: any) => String(x || "").trim())
          .filter(Boolean)
      );

      const affected = [...(payload.threadIds || []), ...(payload.roomIds || [])].some((id) =>
        relevantIds.has(String(id || "").trim())
      );

      if (!affected) return;

      mediaRoomCacheFreshRef.current = false;
      roomMessagesSigRef.current = "";
      allowEmptyRoomOverwriteRef.current = true;

      console.log("KRISTO_ROOM_MESSAGES_FORCE_RELOAD_AFTER_DELETE", {
        threadId,
        backendRoomId,
        cardIds: payload.cardIds || [],
        clearAllAssignmentCards: !!payload.clearAllAssignmentCards,
        reason: payload.reason || null,
      });

      forceReloadRoomMessages();
    });
  }, [
    threadId,
    backendRoomId,
    forceReloadRoomMessages,
    resolvedMinistryId,
    (params as any)?.assignmentId,
    (params as any)?.ministryId,
  ]);

  const listRef = useRef<any>(null);
  const inputRef = useRef<any>(null);
  const claimInFlightRef = useRef<Set<string>>(new Set());
  const [claimingAssignmentMessageIds, setClaimingAssignmentMessageIds] = useState<
    Record<string, true>
  >({});

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessageAttachment[]>([]);
  const [attachUploading, setAttachUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dmConversationSettings, setDmConversationSettings] =
    useState<DirectMessageConversationSettings | null>(null);
  const [dmSettingsBusy, setDmSettingsBusy] = useState(false);
  const [privateCallStarting, setPrivateCallStarting] = useState(false);
  const [resolvedDmPastorUserId, setResolvedDmPastorUserId] = useState("");

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

  useEffect(() => {
    let alive = true;

    async function loadDmConversationSettings() {
      if (!isPersonToPersonDm || !backendRoomId) {
        if (alive) setDmConversationSettings(null);
        return;
      }

      try {
        const settings =
          await fetchDirectMessageConversationSettings({
            roomId: backendRoomId,
            churchId,
          });

        if (alive) {
          setDmConversationSettings(settings);
        }
      } catch (error: any) {
        console.log("KRISTO_DM_SETTINGS_LOAD_FAILED", {
          roomId: backendRoomId,
          error: String(error?.message || error),
        });
      }
    }

    void loadDmConversationSettings();

    return () => {
      alive = false;
    };
  }, [
    isPersonToPersonDm,
    backendRoomId,
    churchId,
    menuOpen,
  ]);

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

  const peerUserIdForPresence = String((params as any)?.peerUserId || "").trim();
  const [peerPresence, setPeerPresence] = useState<{ online: boolean; text: string; lastSeenAt?: number } | null>(null);

  useEffect(() => {
    let alive = true;

    async function resolveDmPastor() {
      if (!isPersonToPersonDm || !churchId) {
        if (alive) setResolvedDmPastorUserId("");
        return;
      }

      try {
        const result = await fetchChurchPastorUserId(
          String(churchId || "").trim(),
          getKristoHeaders() as any
        );

        if (!alive) return;

        setResolvedDmPastorUserId(
          String(result?.actualChurchPastorUserId || "").trim()
        );
      } catch {
        if (alive) setResolvedDmPastorUserId("");
      }
    }

    void resolveDmPastor();

    return () => {
      alive = false;
    };
  }, [isPersonToPersonDm, churchId]);

  const currentDmUserId = String(
    effectiveAuthUserId ||
      (kristoSession as any)?.userId ||
      ""
  ).trim();

  const currentDmRole = String(
    (kristoSession as any)?.churchRole ||
      (kristoSession as any)?.role ||
      currentRole ||
      ""
  )
    .trim()
    .toLowerCase();

  const currentUserIsPastor =
    currentDmRole === "pastor" ||
    (
      !!resolvedDmPastorUserId &&
      currentDmUserId === resolvedDmPastorUserId
    );

  const peerUserIsPastor =
    !!resolvedDmPastorUserId &&
    peerUserIdForPresence === resolvedDmPastorUserId;

  const canStartPastoralPrivateCall =
    isPersonToPersonDm &&
    !!peerUserIdForPresence &&
    peerUserIdForPresence !== currentDmUserId &&
    (currentUserIsPastor || peerUserIsPastor);

  const startPastoralPrivateCall = useCallback(async () => {
    if (
      !canStartPastoralPrivateCall ||
      !peerUserIdForPresence ||
      privateCallStarting
    ) {
      return;
    }

    setPrivateCallStarting(true);

    try {
      const result = await createPrivateCallToUser(
        peerUserIdForPresence
      );

      if (!result.ok) {
        Alert.alert(
          "Could not start call",
          result.message || "Please try again in a moment."
        );
        return;
      }

      console.log("KRISTO_DM_PRIVATE_CALL_STARTED", {
        callId: result.session.id,
        callerUserId: currentDmUserId,
        receiverUserId: peerUserIdForPresence,
        currentUserIsPastor,
        peerUserIsPastor,
      });

      router.push({
        pathname: "/(tabs)/more/private-call/[callId]",
        params: {
          callId: result.session.id,
          returnTo:
            `/(tabs)/more/my-church-room/messages/${encodeURIComponent(
              String(threadId || "")
            )}`,
        },
      } as any);
    } catch (error: any) {
      Alert.alert(
        "Could not start call",
        String(error?.message || "Please try again in a moment.")
      );
    } finally {
      setPrivateCallStarting(false);
    }
  }, [
    canStartPastoralPrivateCall,
    peerUserIdForPresence,
    privateCallStarting,
    currentDmUserId,
    currentUserIsPastor,
    peerUserIsPastor,
    router,
    threadId,
  ]);

  useEffect(() => {
    let alive = true;

    async function loadPeerPresence() {
      if (!isFocused || !isPersonToPersonDm || !peerUserIdForPresence) {
        if (alive) setPeerPresence(null);
        return;
      }

      try {
        const res: any = await apiGet(
          `/api/auth/presence?userId=${encodeURIComponent(peerUserIdForPresence)}&roomId=${encodeURIComponent(backendRoomId)}&heartbeat=1&t=${Date.now()}`,
          { headers: getKristoHeaders() as any },
          { screen: `DmPresence:${backendRoomId}`, throttleMs: 0, dedupe: false } as any
        );

        const data = res?.data || {};
        if (!alive) return;

        setPeerPresence({
          online: !!data.online,
          text: String(data.text || (data.online ? "online now" : "last seen recently")),
          lastSeenAt: Number(data.lastSeenAt || 0),
        });
      } catch {
        if (alive) setPeerPresence({ online: false, text: "last seen recently" });
      }
    }

    void loadPeerPresence();
    const timer = setInterval(loadPeerPresence, 5000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isPersonToPersonDm, peerUserIdForPresence, backendRoomId, isFocused]);

  const presence = useMemo(
    () => {
      if (isPersonToPersonDm) {
        return peerPresence || { online: false, text: "checking..." };
      }

      return {
        online: !isSuspended,
        text: !isSuspended ? "online now" : "paused",
      };
    },
    [isPersonToPersonDm, peerPresence, isSuspended]
  );

  const presenceMessages = useMemo(
    () =>
      isAssignmentThread
        ? ["online now", "assignment room active", "team connected"]
        : isMinistryThread
          ? [isSuspended ? "paused" : "online now", `${currentRole} access`, isSuspended ? "ministry paused" : "ministry active"]
          : [peerPresence ? presence.text : "checking...", "member connected", "public profile"],
    [isAssignmentThread, isMinistryThread, isSuspended, currentRole, presence.text]
  );

  const presenceIndex = 0;

  const assignmentLiveBadge = isAssignmentThread && true;

  const livePulse = useRef(new Animated.Value(1)).current;

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
    () => getAssignmentMeetingWindow(messages, liveCountdownNow),
    [messages, liveCountdownNow]
  );

  const PRELIVE_TEAM_OPEN_MS = 30 * 60 * 1000;
  const PRELIVE_AUDIENCE_OPEN_MS = 3 * 60 * 1000;

  const liveCta = useMemo(() => {
    const now = liveCountdownNow;

    const cardsFromMessages = Array.isArray(messages)
      ? messages
          .map((m: any) => m?.card)
          .filter((card: any) => {
            if (!card) return false;
            if (isScheduleSlotExpired(card, now)) return false;
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

    const hasAssignmentCards = messages.some(
      (m: any) =>
        String(m?.kind || "") === "assignment_card" &&
        m?.card &&
        !isScheduleSlotExpired(m.card, now)
    );
    const hasRealSchedule = !!hasSchedule && hasAssignmentCards;

    if (isAssignmentThread && !isChurchLiveControlAssignment) {
      const ministryActivation = resolveMinistryLiveActivationState({
        messages,
        nowMs: now,
        viewerUserId: effectiveAuthUserId,
        viewerIsLeader: !!isAssignmentLeader || !!isAssignmentTlmc,
        viewerIsHost: ministryAuthority.tier === "host" || isSelectedMcHost === true,
        viewerIsPastor:
          currentRole === "pastor" ||
          currentRole === "admin" ||
          ministryAuthority.tier === "pastor",
        preliveTeamOpenMs: PRELIVE_TEAM_OPEN_MS,
      });

      logMinistryLiveActivationCheck({
        roomId: String(threadId || ""),
        ministryId: String(resolvedMinistryId || threadId || ""),
        currentTime: now,
        viewerUserId: effectiveAuthUserId,
        ministryRole: resolvedMinistryRoleLabel,
        churchRole: String(effectiveAuthRole || currentRole || ""),
        viewerIsHost: ministryAuthority.tier === "host" || isSelectedMcHost === true,
        viewerIsLeader: !!isAssignmentLeader || !!isAssignmentTlmc,
        viewerIsPastor:
          currentRole === "pastor" ||
          currentRole === "admin" ||
          ministryAuthority.tier === "pastor",
        state: ministryActivation,
      });

      if (!ministryActivation.scheduleReady || !hasRealSchedule) {
        return {
          label: "LIVE",
          tone: "idle" as const,
          sublabel: "No schedule",
          canOpenLive: false,
          entryMode: "none" as const,
        };
      }

      if (ministryActivation.liveStillActive && ministryActivation.canEnterLive) {
        return {
          label: "LIVE",
          tone: "live" as const,
          sublabel: ministryActivation.canHostOrStartBroadcast ? "Live now" : "Watch live",
          canOpenLive: true,
          entryMode: "live" as const,
        };
      }

      if (ministryActivation.canEnterBackstage) {
        return {
          label: "LIVE",
          tone: "preview" as const,
          sublabel: "Ready room open",
          canOpenLive: true,
          entryMode: "backstage" as const,
        };
      }

      if (ministryActivation.liveEnded) {
        return {
          label: "LIVE",
          tone: "idle" as const,
          sublabel: "Live window ended",
          canOpenLive: false,
          entryMode: "none" as const,
        };
      }

      return {
        label: "LIVE",
        tone: "scheduled" as const,
        sublabel: "Schedule is ready",
        canOpenLive: false,
        entryMode: "none" as const,
      };
    }

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
    isAssignmentThread,
    resolvedMinistryId,
    threadId,
    effectiveAuthUserId,
    resolvedMinistryRoleLabel,
    ministryAuthority.tier,
    isSelectedMcHost,
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

  const [
    dmPeerMembershipProfile,
    setDmPeerMembershipProfile,
  ] = useState<any>(null);

  const [
    dmPeerMembershipLoading,
    setDmPeerMembershipLoading,
  ] = useState(false);

  const dmPeerUserId = useMemo(() => {
    const viewerUserId = String(
      effectiveAuthUserId || ""
    ).trim();

    const peerFromMessages = String(
      messages.find((message: any) => {
        const senderUserId = String(
          message?.senderUserId || ""
        ).trim();

        return (
          senderUserId &&
          senderUserId !== viewerUserId
        );
      })?.senderUserId || ""
    ).trim();

    return (
      peerFromMessages ||
      String(
        peerUserIdForPresence ||
          directRoomPeerUserId(
            threadId,
            viewerUserId
          ) ||
          ""
      ).trim()
    );
  }, [
    messages,
    effectiveAuthUserId,
    peerUserIdForPresence,
    threadId,
  ]);

  useEffect(() => {
    if (
      !menuOpen ||
      isStructuredRoom ||
      !dmPeerUserId
    ) {
      return;
    }

    let alive = true;

    setDmPeerMembershipLoading(true);

    void apiGet(
      `/api/users/${encodeURIComponent(
        dmPeerUserId
      )}/profile`,
      {
        headers:
          getKristoHeaders() as any,
      }
    )
      .then((response: any) => {
        if (!alive) {
          return;
        }

        setDmPeerMembershipProfile(
          response?.ok &&
            response?.profile
            ? response.profile
            : null
        );
      })
      .catch((error: any) => {
        if (!alive) {
          return;
        }

        setDmPeerMembershipProfile(null);

        console.log(
          "KRISTO_DM_MEMBERSHIP_LOOKUP_FAILED",
          {
            peerUserId:
              dmPeerUserId,
            error: String(
              error?.message ||
                error ||
                "unknown"
            ),
          }
        );
      })
      .finally(() => {
        if (alive) {
          setDmPeerMembershipLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [
    menuOpen,
    isStructuredRoom,
    dmPeerUserId,
  ]);

  const dmMembershipSummary = useMemo(() => {
    const profile =
      dmPeerMembershipProfile &&
      typeof dmPeerMembershipProfile ===
        "object"
        ? dmPeerMembershipProfile
        : {};

    const viewerChurchId = String(
      churchId ||
        getKristoHeaders()[
          "x-kristo-church-id"
        ] ||
        ""
    ).trim();

    const peerChurchId = String(
      profile.churchId ||
        profile.currentChurchId ||
        profile.activeMembership
          ?.churchId ||
        ""
    ).trim();

    const sameChurch =
      Boolean(viewerChurchId) &&
      Boolean(peerChurchId) &&
      viewerChurchId === peerChurchId;

    const verifiedRole = String(
      profile.churchRole ||
        profile.role ||
        profile.activeMembership
          ?.churchRole ||
        profile.activeMembership
          ?.role ||
        ""
    ).trim();

    const name =
      String(
        profile.fullName ||
          profile.name ||
          headerTitle ||
          "Member"
      ).trim() || "Member";

    return {
      name,

      role:
        sameChurch
          ? verifiedRole || "Member"
          : "Guest",

      status:
        dmPeerMembershipLoading
          ? "Checking church membership..."
          : sameChurch
            ? "Member of your church"
            : "Not a member of your church",

      pill:
        dmPeerMembershipLoading
          ? "Checking"
          : sameChurch
            ? verifiedRole || "Member"
            : "Guest",

      viewerChurchId,
      peerChurchId,
      sameChurch,
    };
  }, [
    dmPeerMembershipProfile,
    dmPeerMembershipLoading,
    churchId,
    headerTitle,
  ]);

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
    const viewerUserId = String(
      effectiveAuthUserId || ""
    ).trim();

    const messagePeerUserId = String(
      messages.find((message: any) => {
        const senderUserId = String(
          message?.senderUserId || ""
        ).trim();

        return (
          senderUserId &&
          senderUserId !== viewerUserId
        );
      })?.senderUserId || ""
    ).trim();

    const paramsForProfile =
      profileRouteParams(
        threadId,
        headerTitle,
        currentFact,
        presence,
        viewerUserId
      );

    const targetUserId =
      messagePeerUserId ||
      String(
        paramsForProfile.peerUserId ||
          paramsForProfile.userId ||
          ""
      ).trim();

    console.log(
      "KRISTO_EXTERNAL_PROFILE_NAVIGATE",
      {
        threadId,
        viewerUserId,
        messagePeerUserId:
          messagePeerUserId || null,
        targetUserId:
          targetUserId || null,
        headerTitle,
      }
    );

    router.push({
      pathname: "/(tabs)/profile" as any,
      params: {
        ...paramsForProfile,
        userId: targetUserId,
        peerUserId: targetUserId,
      } as any,
    });
  }

  const [messageActionsOpen, setMessageActionsOpen] = useState(false);
  const [messageActionsTarget, setMessageActionsTarget] = useState<MsgItem | null>(null);
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());

  const closeMessageActions = useCallback(() => {
    setMessageActionsOpen(false);
    setMessageActionsTarget(null);
  }, []);

  const exitMessageSelectionMode = useCallback(() => {
    setMessageSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, []);

  const openMessageActions = useCallback((item: MsgItem) => {
    console.log("[MessageActions] open", item.id);
    setMessageActionsTarget(item);
    setMessageActionsOpen(true);
  }, []);

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const performDeleteMessageIds = useCallback(
    (ids: string[], options?: { scope?: "local" | "everyone" }) => {
      const scope = options?.scope ?? "local";
      const logKey = scope === "everyone" ? "delete-everyone" : "delete";
      const deletable = ids.filter((id) => {
        const msg = messages.find((x: any) => x.id === id);
        return msg && canDeleteMessage(msg);
      });
      if (!deletable.length) {
        Alert.alert("Cannot delete", "Assignment cards cannot be deleted from here.");
        return;
      }
      const isEveryone = scope === "everyone";
      const title =
        isEveryone
          ? "Delete for everyone"
          : deletable.length > 1
            ? "Delete messages"
            : deletable.length === 1 && messages.find((x: any) => x.id === deletable[0])?.sender === "me"
              ? "Delete for me"
              : "Delete from my view";
      const body = isEveryone
        ? "Remove this message for everyone in the chat?"
        : deletable.length > 1
          ? `Delete ${deletable.length} selected messages from your view?`
          : deletable.length === 1 && messages.find((x: any) => x.id === deletable[0])?.sender === "me"
            ? "Remove this message from your view only?"
            : "Remove this message from your view?";
      Alert.alert(title, body, [
        { text: "Cancel", style: "cancel" },
        {
          text: isEveryone ? "Delete for everyone" : "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const headers: any = getKristoHeaders();
              const userId = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();
              const roomId = backendRoomId;
              let anySuccess = false;

              for (const id of deletable) {
                const msg = messages.find((x: any) => x.id === id);
                const senderUserId = String(msg?.senderUserId || "").trim();

                console.log(`[MessageActions] ${logKey}`, id);
                console.log("[RoomMessagesDelete] compare-owner", {
                  userId,
                  senderUserId,
                  messageId: id,
                  roomId,
                  scope,
                  sender: msg?.sender,
                });
                console.log("[MessageActions] delete backend request", {
                  messageId: id,
                  roomId,
                  scope,
                  userId,
                  senderUserId,
                });

                try {
                  const res: any = await apiPatch(
                    "/api/church/room-messages",
                    {
                      roomId,
                      messageId: id,
                      action: "delete",
                      scope,
                    },
                    { headers }
                  );

                  console.log("[MessageActions] delete backend result", {
                    messageId: id,
                    roomId,
                    scope,
                    userId,
                    senderUserId,
                    ok: res?.ok !== false,
                    res,
                  });

                  if (res?.ok === false) {
                    console.log("[MessageActions] delete backend rejected", {
                      messageId: id,
                      roomId,
                      scope,
                      userId,
                      senderUserId,
                      error: res?.error,
                    });
                    continue;
                  }

                  deleteMessage(threadId, id);
                  anySuccess = true;
                } catch (e: any) {
                  console.log("[MessageActions] delete backend result", {
                    messageId: id,
                    roomId,
                    scope,
                    userId,
                    senderUserId,
                    ok: false,
                    error: String(e?.message || e),
                  });
                }
              }

              if (anySuccess) {
                forceReloadRoomMessages();
              }

              exitMessageSelectionMode();
              closeMessageActions();
            })();
          },
        },
      ]);
    },
    [messages, threadId, backendRoomId, effectiveAuthUserId, exitMessageSelectionMode, closeMessageActions, forceReloadRoomMessages]
  );

  const handleMessageActionSelect = useCallback(() => {
    if (!messageActionsTarget) return;
    console.log("[MessageActions] select", messageActionsTarget.id);
    setMessageSelectionMode(true);
    setSelectedMessageIds(new Set([messageActionsTarget.id]));
    closeMessageActions();
  }, [messageActionsTarget, closeMessageActions]);

  const handleMessageActionDelete = useCallback(() => {
    if (!messageActionsTarget) return;
    performDeleteMessageIds([messageActionsTarget.id], { scope: "local" });
  }, [messageActionsTarget, performDeleteMessageIds]);

  const handleMessageActionDeleteForEveryone = useCallback(() => {
    if (!messageActionsTarget) return;
    if (messageActionsTarget.sender !== "me" || !canDeleteMessage(messageActionsTarget)) return;
    performDeleteMessageIds([messageActionsTarget.id], { scope: "everyone" });
  }, [messageActionsTarget, performDeleteMessageIds]);

  const handleMessageActionEdit = useCallback(() => {
    if (!messageActionsTarget || !canEditMessage(messageActionsTarget)) return;
    console.log("[MessageActions] edit", messageActionsTarget.id);
    setDraft(String(messageActionsTarget.text || ""));
    closeMessageActions();
    setTimeout(() => {
      try {
        inputRef.current?.focus?.();
      } catch {}
    }, 120);
  }, [messageActionsTarget, closeMessageActions]);

  const handleMessageActionShare = useCallback(() => {
    if (!messageActionsTarget) return;
    console.log("[MessageActions] share", messageActionsTarget.id);
    const payload = buildMessageShareContent(messageActionsTarget);
    closeMessageActions();
    void Share.share({ message: payload }).catch(() => {});
  }, [messageActionsTarget, closeMessageActions]);

  const handleOpenSharedPost = useCallback(
    (shared: SharedContentPayload) => {
      const queued = queueOpenSharedHomeFeedPost(shared);
      const postId = String(shared.postId || "").trim();
      console.log("KRISTO_SHARED_POST_OPEN_TAP", {
        postId,
        queued,
        hasVideoUri: Boolean(String(shared.videoUri || "").trim()),
      });

      router.replace({
        pathname: "/(tabs)/",
        params: postId ? { openPostId: postId } : {},
      } as any);
    },
    [router]
  );

  const handleMessageActionSelectAll = useCallback(() => {
    console.log("[MessageActions] select-all");
    const ids = visibleMessages.filter(isSelectableMessage).map((m) => m.id);
    setMessageSelectionMode(true);
    setSelectedMessageIds(new Set(ids));
    closeMessageActions();
  }, [visibleMessages, closeMessageActions]);

  function removePending(id: string) {
    setPending((prev) => prev.filter((x: any) => x.id !== id));
  }

  const openImagePreview = useCallback(
    (uri: string) => {
      const target = String(uri || "").trim();
      if (!target || !roomImageGallery.length) return;
      const idx = findGalleryImageIndex(roomImageGallery, target);
      setImagePreviewIndex(idx >= 0 ? idx : 0);
    },
    [roomImageGallery]
  );

  const closeImagePreview = useCallback(() => {
    setImagePreviewIndex(null);
  }, []);

  function pickImage() {
    void (async () => {
      try {
        console.log("[MessagesAttach] pick image");
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!photoLibraryAccessAllowed(perm)) {
          alertPhotoLibraryPermissionNeeded();
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: false,
          quality: 0.85,
        });

        if (result.canceled || !result.assets?.length) return;

        const asset = result.assets[0];
        const localUri = String(asset.uri || "").trim();
        if (!localUri) return;

        const rawName = String(asset.fileName || asset.uri?.split("/").pop() || `image_${Date.now()}.jpg`);

        // Compress/resize before queueing so we never ship a multi-MB iPhone
        // photo to the server (which would 413 on Vercel).
        let compressed;
        try {
          compressed = await compressRoomImage(localUri, asset.width, asset.height);
        } catch (compressErr: any) {
          Alert.alert(
            "Image too large",
            extractApiErrorMessage(compressErr, ROOM_IMAGE_TOO_LARGE_MESSAGE)
          );
          return;
        }

        const jpgName = rawName.replace(/\.[^.]+$/, "") + ".jpg";

        setPending((prev) => [
          ...prev,
          {
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            kind: "image",
            localUri: compressed.uri,
            name: jpgName,
            mime: "image/jpeg",
            size: compressed.size || (typeof asset.fileSize === "number" ? asset.fileSize : undefined),
          },
        ]);
      } catch (e: any) {
        Alert.alert("Image picker error", extractApiErrorMessage(e, "Could not pick image."));
      }
    })();
  }

  function pickFile() {
    void (async () => {
      try {
        console.log("[MessagesAttach] pick file");
        const result = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          multiple: false,
        });

        if (result.canceled || !result.assets?.length) return;

        const asset = result.assets[0];
        const localUri = String(asset.uri || "").trim();
        if (!localUri) return;

        const name = String(asset.name || `file_${Date.now()}`);
        const mime = String(asset.mimeType || "application/octet-stream");

        setPending((prev) => [
          ...prev,
          {
            id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            kind: "file",
            localUri,
            name,
            mime,
            size: typeof asset.size === "number" ? asset.size : undefined,
          },
        ]);
      } catch (e: any) {
        Alert.alert("File picker error", String(e?.message || e || "Could not pick file."));
      }
    })();
  }

  const canSend = useMemo(
    () => !attachUploading && (String(draft || "").trim().length > 0 || pending.length > 0),
    [draft, pending, attachUploading]
  );

  async function onSend() {
    if (attachUploading) return;
    if (isMessagingDisabledV1) return;

    const text = String(draft || "").trim();
    if (!text && pending.length === 0) return;

    const roomId = backendRoomId;
    const sendHeaders: any = getKristoHeaders();
    const selfId = String(sendHeaders?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();
    const authRole = String(sendHeaders?.["x-kristo-role"] || effectiveAuthRole || "").trim();
    const selfAvatarUri = resolveSessionUserAvatar(kristoSession, auth);
    const senderName = String(
      sendHeaders?.["x-kristo-user-name"] ||
      sendHeaders?.["x-kristo-display-name"] ||
      sendHeaders?.["x-kristo-name"] ||
      "Member"
    ).trim();

    const pendingSnapshot = [...pending];
    const optimisticId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const optimisticAttachments = pendingAttachmentsToOptimistic(pendingSnapshot);
    const optimisticCreatedAt = Date.now();

    console.log("[MessagesSend] optimistic", {
      optimisticId,
      roomId,
      text: text || "",
      attachmentCount: optimisticAttachments.length,
    });

    sendMessage(
      threadId,
      {
        id: optimisticId,
        clientId: optimisticId,
        text,
        attachments: optimisticAttachments.length ? optimisticAttachments : undefined,
        createdAt: optimisticCreatedAt,
        pending: true,
        senderUserId: selfId,
        displayName: senderName || "Member",
        senderRole: authRole,
        role: authRole,
        churchRole: authRole,
        avatarUri: selfAvatarUri || undefined,
        senderAvatar: selfAvatarUri || undefined,
      },
      { disableAutoReply: true }
    );

    setDraft("");
    setPending([]);

    setTimeout(() => {
      listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 0);

    setAttachUploading(true);

    try {
      const attachments: MsgAttachment[] = [];

      for (const item of pendingSnapshot) {
        const uploaded = await uploadMessageAttachment(item, sendHeaders);
        attachments.push(uploaded);
      }

      console.log("[MessagesAttach] send payload", {
        roomId,
        text: text || "",
        attachmentCount: attachments.length,
      });

      const postRes: any = await apiPost(
        "/api/church/room-messages",
        {
          roomId,
          roomKind: resolvedSendRoomKind,
          senderName,
          text,
          attachments,
          clientId: optimisticId,
        },
        { headers: sendHeaders }
      );

      if (!postRes?.ok) {
        throw new Error(String(postRes?.error || "Failed to send message"));
      }

      const backendRow = postRes?.data;
      const backendId = String(backendRow?.id || "");
      console.log("[MessagesSend] backend saved", { optimisticId, backendId, roomId });

      if (backendRow && backendId) {
        const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");
        const reconciled = mapBackendRoomMessageRow(backendRow, threadId, selfId, apiBase);
        console.log("[MessagesSend] reconcile", { optimisticId, backendId });
        reconcileMessage(threadId, optimisticId, reconciled);
      }

      // Bust the media-room cache and force a fresh GET so the just-saved
      // message isn't hidden by a stale cache:0 poll right after sending.
      forceReloadRoomMessages();
    } catch (e: any) {
      deleteMessage(threadId, optimisticId);

      // Keep the user's attachments (and text) so the preview doesn't silently
      // vanish — they can retry by tapping send again, or remove the chip.
      if (pendingSnapshot.length) {
        setPending((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          const restored = pendingSnapshot.filter((p) => !existing.has(p.id));
          return [...restored, ...prev];
        });
      }
      if (text && !String(draft || "").trim()) {
        setDraft(text);
      }

      Alert.alert(
        "Couldn't send",
        extractApiErrorMessage(e, "Could not send attachment message. Please try again.")
      );
    } finally {
      setAttachUploading(false);
    }
  }

  function buildMinistryLiveNavigationParams(
    ministryActivation: ReturnType<typeof resolveMinistryLiveActivationState>,
    entryMode: string,
    preview = entryMode !== "live"
  ) {
    const roomId = String(threadId || resolvedMinistryId || "");
    const ministryId = String(resolvedMinistryId || threadId || "");
    const scheduleStateAny = (meetingScheduleState || {}) as any;
    const meetingTopic = String(
      scheduleStateAny?.meetingPlan?.topic ||
        scheduleStateAny?.eventTitle ||
        headerTitle ||
        ""
    ).trim();
    const viewerIsPastor = isPastorAuthority || ministryAuthority.tier === "pastor";
    const viewerIsHost =
      ministryAuthority.tier === "host" || isSelectedMcHost === true;
    const viewerIsLeader = ministryAuthority.tier === "leader";
    const canPublishMic = resolveMinistryLiveMicForEntry({
      viewerHasClaim: ministryActivation.viewerHasClaim,
      viewerIsPastor,
      viewerIsHost,
      viewerIsLeader,
      isSelectedMcHost: isSelectedMcHost === true,
    });
    const canPublishCamera = resolveMinistryLiveCameraForEntry({
      viewerHasClaim: ministryActivation.viewerHasClaim,
    });
    const canPublish = canPublishMic || canPublishCamera;
    const enteredAsViewer = ministryActivation.canEnterLive && !canPublishMic && !canPublishCamera;

    logMinistryLiveEnterRolePreserved({
      userId: effectiveAuthUserId,
      ministryRole: resolvedMinistryRoleLabel,
      churchRole: String(effectiveAuthRole || currentRole || ""),
      enteredAsViewer,
      claimedByMe: ministryActivation.viewerHasClaim,
      canEnterLive: ministryActivation.canEnterLive,
      canUseMicCamera: canPublish,
      canHostOrStartBroadcast: ministryActivation.canHostOrStartBroadcast,
    });

    return buildMinistryLiveRoomRouteParams({
      messages,
      roomId,
      ministryId,
      threadId: String(threadId || ""),
      headerTitle,
      subtitle: sub,
      viewerUserId: effectiveAuthUserId,
      resolvedLiveRole,
      resolvedCanPublish: canPublish,
      resolvedCanPublishMic: canPublishMic,
      resolvedCanPublishCamera: canPublishCamera,
      entryMode,
      preview,
      ministryActivation,
      meetingTopic,
      churchId: String(auth?.churchId || churchId || ""),
      actualChurchPastorUserId: churchPastorUserId,
      enteredAsViewer,
      ministryAvatarUrl: String(effectiveHeaderAvatar || routeAvatar || "").trim(),
    });
  }

  function navigateMinistryLiveRoom(
    ministryActivation: ReturnType<typeof resolveMinistryLiveActivationState>,
    entryMode: string,
    preview = entryMode !== "live"
  ) {
    const params = buildMinistryLiveNavigationParams(
      ministryActivation,
      entryMode,
      preview
    ) as Record<string, string>;
    const slotCount = parseLiveAllScheduleSlotsJson(
      params.liveAllScheduleSlotsJson || ""
    ).length;
    pushLiveRoomWithSilentPreflight({
      router,
      params,
      viewerUserId: effectiveAuthUserId,
      viewerChurchId: String(auth?.churchId || churchId || ""),
      source: "ministry-live-thread",
      routeSlotCount: slotCount,
    });
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

    if (isChurchLiveControlAssignment) {
      const currentUserId = String(effectiveAuthUserId || "").trim();
      const claimedByUserId = String(
        card?.claimedByUserId ||
        card?.claimedUserId ||
        card?.assigneeUserId ||
        ""
      ).trim();
      const claimedByMe =
        !!claimedByUserId && !!currentUserId && claimedByUserId === currentUserId;

      const pastorCanOpenCard =
        canPastorStartChurchLive && meta.valid && !meta.ended;

      const claimerCanOpenCard =
        claimedByMe &&
        meta.valid &&
        !meta.ended &&
        (
          !!meta.active ||
          now >= meta.startMs - 3 * 60 * 60 * 1000
        );

      if (!pastorCanOpenCard && !claimerCanOpenCard) {
        Alert.alert("Pastor only", "Only the pastor can start Church Live.");
        return;
      }
    }

    if (!isChurchLiveControlAssignment) {
      const ministryActivation = resolveMinistryLiveActivationState({
        messages,
        nowMs: Date.now(),
        viewerUserId: effectiveAuthUserId,
        viewerIsLeader: !!isAssignmentLeader || !!isAssignmentTlmc,
        viewerIsHost: ministryAuthority.tier === "host" || isSelectedMcHost === true,
        viewerIsPastor:
          currentRole === "pastor" ||
          currentRole === "admin" ||
          ministryAuthority.tier === "pastor",
      });

      navigateMinistryLiveRoom(ministryActivation, mode, mode !== "live");
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
        ministryAvatarUrl: String(effectiveHeaderAvatar || routeAvatar || "").trim(),
        avatar: String(effectiveHeaderAvatar || routeAvatar || "").trim(),
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
      const toolKey = tool === "schedule" ? "schedule" : "meeting";
      const ministryToolAllowed = ministryToolAccess[toolKey] === true;
      const isPastorGate =
        ministryAuthority.tier === "pastor" ||
        String(effectiveAuthRole || "").toLowerCase().includes("pastor");
      const viewerIsHost =
        ministryAuthority.tier === "host" || isSelectedMcHost === true;

      if (
        !(await requireActiveChurchSubscriptionForSchedule(cid, headers, {
          isPastor: isPastorGate,
          isApprovedMediaHost: viewerIsHost,
          viewerIsHost,
          ministryRole: resolvedMinistryRoleLabel,
          ministryToolAllowed,
          toolKey,
          screen: "my-church-room.openAssignmentToolScreen",
          gate: `assignment-tool.${tool}`,
          onUpgrade: () => router.push("/more/payments/subscriptions" as any),
        }))
      ) {
        return;
      }
    }

    if (isAssignmentThread && lockedTools.includes(String(tool)) && !ministryToolAccess.meeting) {
      Alert.alert("Access locked", ministryToolLockMessage(tool === "schedule" ? "schedule" : "meeting"));
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
        role: assignmentToolRole,
        status: assignmentStatus || "",
        roomKind: isChurchLiveControlTool
          ? "church-live-control"
          : String((params as any)?.roomKind || "ministry"),
        mcAccess: canScheduleStructuredMeeting ? "1" : "0",
        ministryId: String(resolvedMinistryId || threadId || ""),
        avatar: routeAvatar || ministryAvatarFallback,
      },
    });
  }

  function onThreadMenuAction(action: string) {
    const toolKeyForAction: Partial<Record<string, MinistryToolKey>> = {
      members: "members_board",
      edit: "profile",
      invite: "add_remove",
      mc_plus: "mc_hosts",
      meeting: "meeting",
      schedule: "schedule",
      tlmc: "tlmc_panel",
      election: "election",
      targeted: "targeted_msg",
      broadcast: "broadcast",
      visibility: "visibility",
      permissions: "permissions",
      pause: "pause",
    };

    const mappedToolKey = toolKeyForAction[action];
    if (mappedToolKey) {
      gateMinistryTool(mappedToolKey, () => runThreadMenuAction(action));
      return;
    }

    runThreadMenuAction(action);
  }

  async function applyDmConversationSetting(
    action:
      | "mute"
      | "unmute"
      | "block"
      | "unblock"
      | "clear"
      | "delete"
  ) {
    if (!isPersonToPersonDm || !backendRoomId || dmSettingsBusy) {
      return;
    }

    setDmSettingsBusy(true);

    try {
      const settings =
        await updateDirectMessageConversationSetting({
          roomId: backendRoomId,
          churchId,
          action,
        });

      setDmConversationSettings(settings);

      console.log("KRISTO_DM_SETTING_APPLIED", {
        roomId: backendRoomId,
        action,
        muted: settings.muted,
        blocked: settings.blocked,
      });

      if (action === "clear") {
        clearThreadMessages(threadId);
        Alert.alert(
          "Chat cleared",
          "Messages were removed from your view."
        );
      }

      if (action === "delete") {
        clearThreadMessages(threadId);
        router.replace(
          "/(tabs)/more/my-church-room/messages" as any
        );
      }
    } catch (error: any) {
      Alert.alert(
        "Could not update conversation",
        String(error?.message || "Please try again.")
      );
    } finally {
      setDmSettingsBusy(false);
    }
  }

  function searchInsideConversation() {
    closeThreadMenu();

    const prompt = (Alert as any)?.prompt;

    if (typeof prompt !== "function") {
      Alert.alert(
        "Search",
        "Conversation search requires the search prompt on this device."
      );
      return;
    }

    prompt(
      "Search in conversation",
      "Enter a word or phrase.",
      (value: string) => {
        const query = String(value || "").trim().toLowerCase();
        if (!query) return;

        const index = visibleMessages.findIndex((message: any) => {
          const searchable = [
            message?.text,
            message?.displayName,
            message?.senderName,
            message?.card?.title,
            message?.card?.topic,
          ]
            .map((item) => String(item || "").toLowerCase())
            .join(" ");

          return searchable.includes(query);
        });

        if (index < 0) {
          Alert.alert(
            "No results",
            `No message contains “${value}”.`
          );
          return;
        }

        listRef.current?.scrollToIndex?.({
          index,
          animated: true,
          viewPosition: 0.35,
        });

        console.log("KRISTO_DM_SEARCH_RESULT_FOUND", {
          roomId: backendRoomId,
          query,
          index,
        });
      },
      "plain-text"
    );
  }

  function confirmMuteConversation() {
    closeThreadMenu();

    const currentlyMuted =
      dmConversationSettings?.muted === true;

    void applyDmConversationSetting(
      currentlyMuted ? "unmute" : "mute"
    );
  }

  function confirmBlockConversation() {
    closeThreadMenu();

    const blockedByMe =
      dmConversationSettings?.blockedByMe === true;

    Alert.alert(
      blockedByMe ? "Unblock user?" : "Block user?",
      blockedByMe
        ? `${headerTitle} will be able to message and call you again.`
        : `${headerTitle} will not be able to message or call you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: blockedByMe ? "Unblock" : "Block",
          style: blockedByMe ? "default" : "destructive",
          onPress: () => {
            void applyDmConversationSetting(
              blockedByMe ? "unblock" : "block"
            );
          },
        },
      ]
    );
  }

  function reportConversationUser() {
    closeThreadMenu();

    const submitReport = async (reason: string) => {
      try {
        await reportDirectMessageConversation({
          roomId: backendRoomId,
          churchId,
          reason,
        });

        Alert.alert(
          "Report sent",
          "Thank you. The report was submitted for review."
        );

        console.log("KRISTO_DM_REPORT_SUBMITTED", {
          roomId: backendRoomId,
          reason,
        });
      } catch (error: any) {
        Alert.alert(
          "Could not send report",
          String(error?.message || "Please try again.")
        );
      }
    };

    Alert.alert(
      `Report ${headerTitle}?`,
      "Choose the reason for your report.",
      [
        {
          text: "Spam",
          onPress: () => void submitReport("spam"),
        },
        {
          text: "Harassment",
          onPress: () => void submitReport("harassment"),
        },
        {
          text: "Fake account",
          onPress: () => void submitReport("fake_account"),
        },
        {
          text: "Cancel",
          style: "cancel",
        },
      ]
    );
  }

  function confirmClearConversation() {
    closeThreadMenu();

    Alert.alert(
      "Clear chat?",
      "Messages will be removed from your view only. The other person will still have their messages.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void applyDmConversationSetting("clear");
          },
        },
      ]
    );
  }

  function confirmDeleteConversation() {
    closeThreadMenu();

    Alert.alert(
      "Delete conversation?",
      "This conversation will be removed from your inbox. A new message can make it appear again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void applyDmConversationSetting("delete");
          },
        },
      ]
    );
  }

  function runThreadMenuAction(action: string) {
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

    if (action === "appointment") {
      closeThreadMenu();

      const appointmentRoomId = String(
        backendRoomId || threadId || ""
      ).trim();

      const appointmentSelfId = String(
        effectiveAuthUserId || ""
      ).trim();

      const appointmentRoomParticipants = appointmentRoomId
        .replace(/^dm[:_]/i, "")
        .split(/[:_]/)
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      const appointmentRecipientId = String(
        (params as any)?.recipientId ||
          (params as any)?.peerUserId ||
          (params as any)?.otherUserId ||
          (params as any)?.userId ||
          appointmentRoomParticipants.find(
            (value) => value !== appointmentSelfId
          ) ||
          ""
      ).trim();

      if (!appointmentRoomId || !appointmentRecipientId) {
        Alert.alert(
          "Appointment",
          "The other person in this conversation could not be identified."
        );

        console.log("KRISTO_DM_APPOINTMENT_RECIPIENT_MISSING", {
          roomId: appointmentRoomId,
          threadId,
          selfId: appointmentSelfId,
          participants: appointmentRoomParticipants,
        });

        return;
      }

      router.push({
        pathname:
          "/(tabs)/more/my-church-room/messages/appointment/[roomId]" as any,
        params: {
          roomId: appointmentRoomId,
          threadId: String(threadId || appointmentRoomId),
          recipientId: appointmentRecipientId,
          recipientName: String(headerTitle || "Member"),
          roomKind: "direct",
          churchId: String(churchId || ""),
          source: "direct-message",
        },
      });

      console.log("KRISTO_DM_APPOINTMENT_COMPOSER_OPENED", {
        roomId: appointmentRoomId,
        threadId,
        recipientId: appointmentRecipientId,
        recipientName: headerTitle,
      });

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
      closeThreadMenu();
      setMcHostsOpen(true);
      return;
    }
    if (action === "invite") {
      closeThreadMenu();
      setAddMemberMode("add");
      setSelectedAddMemberId("");
      setSelectedRemoveMemberId("");
      setAddMemberOpen(true);
      return;
    }

    if (action === "tlmc" || action === "election" || action === "targeted" || action === "visibility") {
      closeThreadMenu();
      Alert.alert("Coming next", `${action} flow will be connected next.`);
      return;
    }

    if (action === "broadcast") {
      closeThreadMenu();
      openAssignmentToolScreen("broadcast");
      return;
    }

    if (action === "permissions") {
      closeThreadMenu();
      openAssignmentToolScreen("permissions");
      return;
    }

    if (action === "media-storage") {
      closeThreadMenu();

      const mediaStorageThreadId = String(
        threadId || backendRoomId || ""
      ).trim();

      if (!mediaStorageThreadId) {
        Alert.alert(
          "Media storage",
          "This conversation could not be identified."
        );
        return;
      }

      router.push({
        pathname:
          "/(tabs)/more/my-church-room/messages/media-storage/[threadId]" as any,
        params: {
          threadId: mediaStorageThreadId,
          roomId: String(backendRoomId || mediaStorageThreadId),
          churchId: String(churchId || ""),
          title: String(headerTitle || "Conversation"),
        },
      });

      console.log("KRISTO_MEDIA_STORAGE_OPEN", {
        threadId: mediaStorageThreadId,
        roomId: String(backendRoomId || ""),
        source: "conversation-settings",
      });

      return;
    }

    if (action === "more-about") {
      closeThreadMenu();

      const moreAboutUserId = String(
        peerUserIdForPresence || ""
      ).trim();

      if (!moreAboutUserId) {
        Alert.alert(
          "More About",
          "This member could not be identified."
        );
        return;
      }

      router.push({
        pathname:
          "/member-more-about/[userId]" as any,
        params: {
          userId: moreAboutUserId,
          name: String(
            headerTitle || "Member"
          ),
          avatarUrl: String(
            effectiveHeaderAvatar ||
              routeAvatar ||
              ""
          ).trim(),
        },
      });

      console.log(
        "KRISTO_DM_MORE_ABOUT_OPEN",
        {
          targetUserId:
            moreAboutUserId,
          source:
            "conversation-settings",
        }
      );

      return;
    }

    if (action === "mute") {
      confirmMuteConversation();
      return;
    }

    if (action === "block") {
      confirmBlockConversation();
      return;
    }

    if (action === "report") {
      reportConversationUser();
      return;
    }

    if (action === "clear") {
      confirmClearConversation();
      return;
    }

    if (action === "delete") {
      confirmDeleteConversation();
      return;
    }

    if (action === "edit" || action === "pause") {
      closeThreadMenu();
      Alert.alert(
        "Coming next",
        `${action} flow will be connected next.`
      );
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
    const targetMsg = messages.find((x: any) => x.id === args.messageId);
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
    const clip = assignmentVideoDraft.clips.find((x: any) => x.id === clipId);
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
    // Evaluate eligibility FIRST: a claimed/active/live slot (or a pastor instant
    // start) already reports canOpenLive === true and must always be able to enter,
    // regardless of tone. Gating on tone before this caused LIVE NOW slots to be
    // rejected with "Schedule required".
    if (isChurchLiveControlAssignment && liveAssignmentCtaMeta.canOpenLive) {
      const navigated = navigateChurchLiveControlLiveRoomFromMessages({
        router,
        messages,
        viewerUserId: effectiveAuthUserId,
        viewerChurchId: churchId,
        nowMs: liveCountdownNow,
        assignmentId: threadId,
        title: headerTitle,
        role: canPastorStartChurchLive ? "PASTOR" : (assignmentRoleParam || currentRole || "MEMBER"),
        entryMode:
          liveAssignmentCtaMeta.tone === "scheduled"
            ? "backstage"
            : liveAssignmentCtaMeta.entryMode,
        source:
          liveAssignmentCtaMeta.tone === "scheduled" ? "scheduled-live" : "church-live-control",
        liveMode: liveAssignmentCtaMeta.tone === "scheduled" ? "scheduled" : "instant",
        preview: liveAssignmentCtaMeta.tone === "scheduled" ? "1" : "0",
      });
      if (navigated) return;
      Alert.alert(
        "Live unavailable",
        "Schedule slots could not be loaded. Pull to refresh and try again."
      );
      return;
    }

    // Only block with "Schedule required" once we know there is genuinely no
    // active/eligible slot to open. A "scheduled" tone still has slot cards to
    // surface below, so it is allowed through.
    if (isChurchLiveControlAssignment && liveAssignmentCtaMeta.tone !== "scheduled") {
      Alert.alert(
        "Schedule required",
        "Church Live depends on active schedule slots. Create a schedule first, then enter when the slot time arrives."
      );
      return;
    }

    if (isAssignmentThread && !isChurchLiveControlAssignment) {
      const ministryActivation = resolveMinistryLiveActivationState({
        messages,
        nowMs: liveCountdownNow,
        viewerUserId: effectiveAuthUserId,
        viewerIsLeader: !!isAssignmentLeader || !!isAssignmentTlmc,
        viewerIsHost: ministryAuthority.tier === "host" || isSelectedMcHost === true,
        viewerIsPastor:
          currentRole === "pastor" ||
          currentRole === "admin" ||
          ministryAuthority.tier === "pastor",
      });
      const roomId = String(threadId || resolvedMinistryId || "");
      const ministryId = String(resolvedMinistryId || threadId || "");

      if (ministryActivation.liveStillActive && ministryActivation.canEnterLive) {
        const entryMode = "live";
        logMinistryLiveStartAttempt({
          roomId,
          ministryId,
          activeSlotId: ministryActivation.activeSlotId,
          viewerUserId: effectiveAuthUserId,
          allowed: true,
          reason: ministryActivation.reason,
        });
        navigateMinistryLiveRoom(ministryActivation, entryMode, false);
        return;
      }

      if (ministryActivation.canHostOrStartBroadcast) {
        const entryMode = ministryActivation.canEnterBackstage
          ? "backstage"
          : "waiting";
        logMinistryLiveStartAttempt({
          roomId,
          ministryId,
          activeSlotId: ministryActivation.activeSlotId,
          viewerUserId: effectiveAuthUserId,
          allowed: true,
          reason: ministryActivation.reason,
        });
        navigateMinistryLiveRoom(ministryActivation, entryMode, true);
        return;
      }
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

      if (isAssignmentThread && !isChurchLiveControlAssignment) {
        const ministryActivation = resolveMinistryLiveActivationState({
          messages,
          nowMs: liveCountdownNow,
          viewerUserId: effectiveAuthUserId,
          viewerIsLeader: !!isAssignmentLeader || !!isAssignmentTlmc,
          viewerIsHost: ministryAuthority.tier === "host" || isSelectedMcHost === true,
          viewerIsPastor:
            currentRole === "pastor" ||
            currentRole === "admin" ||
            ministryAuthority.tier === "pastor",
        });
        navigateMinistryLiveRoom(
          ministryActivation,
          entryMode,
          liveAssignmentCtaMeta.tone === "preview"
        );
        return;
      }

      if (isChurchLiveControlAssignment) {
        const navigated = navigateChurchLiveControlLiveRoomFromMessages({
          router,
          messages,
          viewerUserId: effectiveAuthUserId,
          viewerChurchId: churchId,
          nowMs: liveCountdownNow,
          assignmentId: threadId,
          title: headerTitle,
          role: canPastorStartChurchLive ? "PASTOR" : (assignmentRoleParam || currentRole || "MEMBER"),
          entryMode,
          source: "church-live-control",
          liveMode: liveAssignmentCtaMeta.tone === "preview" ? "scheduled" : "instant",
          preview: liveAssignmentCtaMeta.tone === "preview" ? "1" : "0",
        });
        if (navigated) return;
        Alert.alert(
          "Live unavailable",
          "Schedule slots could not be loaded. Pull to refresh and try again."
        );
        return;
      }

      router.push({
        pathname: "/(tabs)/more/my-church-room/messages/live-room" as any,
        params: {
          title: headerTitle,
          role: isAssignmentThread ? assignmentRoleParam : currentRole,
          layout: "grid6",
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

  function resolveClaimActorFromSession() {
    const displayName = String(
      (auth as any)?.displayName ||
      (auth as any)?.name ||
      (auth as any)?.fullName ||
      "You"
    ).trim();

    const rawAvatar = String(
      (auth as any)?.avatarUrl ||
      (auth as any)?.avatarUri ||
      (auth as any)?.avatar ||
      (auth as any)?.photoUrl ||
      (auth as any)?.imageUrl ||
      ""
    ).trim();

    const avatar = rawAvatar.startsWith("/")
      ? `${String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "")}${rawAvatar}`
      : rawAvatar;

    const roleRaw = String(
      (auth as any)?.churchRole ||
      (auth as any)?.role ||
      currentRole ||
      "Member"
    ).trim();

    const role =
      roleRaw === "Pastor"
        ? "Pastor"
        : roleRaw === "Church_Admin" || roleRaw === "Admin" || roleRaw === "Leader"
          ? "Admin"
          : "Member";

    return {
      userId: effectiveAuthUserId,
      name: displayName || "You",
      avatar,
      role,
    };
  }

  function resolveClaimActorFromProfile(profileRes: any) {
    const profileData =
      profileRes?.profile ||
      profileRes?.data?.profile ||
      profileRes?.user ||
      profileRes?.data?.user ||
      profileRes?.data ||
      {};

    const sessionActor = resolveClaimActorFromSession();

    const displayName = String(
      profileData?.displayName ||
      profileData?.name ||
      profileData?.fullName ||
      sessionActor.name ||
      "You"
    ).trim();

    const rawAvatar = String(
      profileData?.avatarUrl ||
      profileData?.avatarUri ||
      profileData?.avatar ||
      profileData?.photoUrl ||
      profileData?.imageUrl ||
      profileData?.profileImageUrl ||
      profileData?.picture ||
      sessionActor.avatar ||
      ""
    ).trim();

    const avatar = rawAvatar.startsWith("/")
      ? `${String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "")}${rawAvatar}`
      : rawAvatar;

    const roleRaw = String(
      profileRes?.churchRole ||
      profileRes?.role ||
      profileRes?.activeMembership?.churchRole ||
      sessionActor.role ||
      "Member"
    ).trim();

    const role =
      roleRaw === "Pastor"
        ? "Pastor"
        : roleRaw === "Church_Admin" || roleRaw === "Admin" || roleRaw === "Leader"
          ? "Admin"
          : "Member";

    return {
      userId: effectiveAuthUserId,
      name: displayName || "You",
      avatar,
      role,
    };
  }

  function markClaimInFlight(messageId: string) {
    claimInFlightRef.current.add(messageId);
    setClaimingAssignmentMessageIds((prev) =>
      prev[messageId] ? prev : { ...prev, [messageId]: true }
    );
  }

  function clearClaimInFlight(messageId: string) {
    claimInFlightRef.current.delete(messageId);
    setClaimingAssignmentMessageIds((prev) => {
      if (!prev[messageId]) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }

  function persistMeTabRingFromRoomMessageClaim(args: {
    messageId: string;
    targetMsg?: MsgItem;
    userId: string;
    actor: { name?: string; role?: string; avatar?: string };
    churchId: string;
    scheduleModel?: ChurchLiveControlHomeFeedScheduleModel | null;
  }) {
    const card = args.targetMsg?.card as any;
    if (!card || typeof card !== "object") {
      console.log("KRISTO_ME_TAB_RING_CLAIM_SKIP", {
        reason: "no_assignment_card",
        source: "messages.handleClaimAssignmentMessage",
        messageId: args.messageId,
        userId: args.userId,
      });
      return false;
    }

    const scheduleModel = args.scheduleModel;
    const activeSlot = scheduleModel?.activeSlot || card;
    const item = scheduleModel?.item;

    const postId = String(
      item?.sourceScheduleId ||
        item?.parentScheduleId ||
        card?.sourceScheduleId ||
        card?.sourceFeedId ||
        card?.scheduleBatchId ||
        args.messageId
    ).trim();

    const ringSlotId = String(
      activeSlot?.id ||
        activeSlot?.slotId ||
        activeSlot?.cardId ||
        card?.cardId ||
        card?.id ||
        args.messageId
    ).trim();

    const startMs = Number(activeSlot?.startMs || parseSlotStartMs(card) || 0);
    const endMs = Number(activeSlot?.endMs || parseSlotEndMs(card, startMs) || 0);
    const slotNumber = Math.max(
      1,
      Number(
        activeSlot?.slotNumber ||
          activeSlot?.slot ||
          card?.slotNumber ||
          card?.order ||
          (typeof scheduleModel?.slotFeedIndex === "number"
            ? scheduleModel.slotFeedIndex + 1
            : 0) ||
          1
      )
    );

    console.log("KRISTO_ME_TAB_RING_CLAIM_ATTEMPT", {
      postId,
      slotId: ringSlotId,
      userId: args.userId,
      claimStartMs: startMs,
      claimEndMs: endMs,
      hasClaimSlot: true,
      source: "messages.handleClaimAssignmentMessage",
      roomMessageId: args.messageId,
      slotNumber,
    });

    if (!postId || !ringSlotId || !args.userId || !startMs || endMs <= 0) {
      console.log("KRISTO_ME_TAB_RING_CLAIM_SKIP", {
        reason: !startMs || endMs <= 0 ? "missing_time_window" : "invalid_args",
        source: "messages.handleClaimAssignmentMessage",
        postId,
        slotId: ringSlotId,
        messageId: args.messageId,
        userId: args.userId,
        startMs,
        endMs,
        slotNumber,
      });
      return false;
    }

    return persistPersonalTabRingClaimState({
      postId,
      slotId: ringSlotId,
      userId: args.userId,
      claim: {
        name: args.actor.name,
        role: args.actor.role,
        avatarUri: args.actor.avatar,
        churchId: args.churchId,
        slot: {
          ...activeSlot,
          id: ringSlotId,
          slotId: ringSlotId,
          startMs,
          endMs,
          slotNumber,
          slot: slotNumber,
          claimedByUserId: args.userId,
          claimedByName: args.actor.name,
          roomMessageId: args.messageId,
        },
        item:
          item ||
          ({
            id: postId,
            sourceScheduleId: postId,
            churchId: args.churchId,
            scheduleSlots: [
              {
                ...activeSlot,
                id: ringSlotId,
                slotId: ringSlotId,
                startMs,
                endMs,
                claimedByUserId: args.userId,
                roomMessageId: args.messageId,
              },
            ],
          } as any),
      },
      startMs,
      endMs,
      slotNumber,
      source: "messages.handleClaimAssignmentMessage",
    });
  }

  async function handleClaimAssignmentMessage(messageId: string) {
    const tapAt = Date.now();
    const slotId = String(messageId || "").trim();

    console.log("KRISTO_SLOT_CLAIM_TAP", {
      messageId: slotId,
      tapAt,
    });

    if (claimInFlightRef.current.has(slotId)) {
      console.log("KRISTO_SLOT_CLAIM_TAP", {
        messageId: slotId,
        ignored: true,
        reason: "in-flight",
      });
      return;
    }

    const targetMsg = messages.find((x: any) => String(x.id) === String(slotId));
    const existingOwner = String((targetMsg?.card as any)?.claimedByUserId || "").trim();
    const cardStatus = String((targetMsg?.card as any)?.status || "open").toLowerCase();
    if (
      (existingOwner && existingOwner !== effectiveAuthUserId) ||
      (cardStatus === "taken" && existingOwner && existingOwner !== effectiveAuthUserId)
    ) {
      console.log("KRISTO_CLAIM_OVERWRITE_BLOCKED", {
        slotId,
        existingClaimedByUserId: existingOwner,
        incomingUserId: effectiveAuthUserId,
        source: "messages.handleClaimAssignmentMessage",
      });
      Alert.alert("Slot already claimed", "This live slot is already taken.");
      return;
    }

    markClaimInFlight(slotId);

    const optimisticActor = resolveClaimActorFromSession();
    const ok = claimAssignmentCard(threadId, slotId, optimisticActor);

    console.log("KRISTO_SLOT_CLAIM_UI_UPDATED", {
      messageId: slotId,
      elapsedMs: Date.now() - tapAt,
      optimistic: true,
      ok,
    });

    if (!ok) {
      clearClaimInFlight(slotId);
      Alert.alert("Slot already claimed", "This live slot is already taken.");
      return;
    }

    const claimRoomId = String(
      (params as any)?.ministryId ||
      (params as any)?.assignmentId ||
      resolvedMinistryId ||
      threadId ||
      ""
    ).trim();

    try {
      console.log("KRISTO_SLOT_CLAIM_REQUEST_START", {
        messageId: slotId,
        elapsedMs: Date.now() - tapAt,
        roomId: claimRoomId,
      });

      let profileRes: any = null;
      try {
        profileRes = await apiGet("/api/auth/profile", { headers: getKristoHeaders() as any });
      } catch {}

      const actor = profileRes ? resolveClaimActorFromProfile(profileRes) : optimisticActor;
      enrichAssignmentCardClaim(threadId, slotId, actor);

      const patchRes = await apiPatch(
        "/api/church/room-messages",
        {
          roomId: claimRoomId,
          cardId: String((targetMsg?.card as any)?.cardId || slotId),
          patch: {
            status: "taken",
            claimedByUserId: effectiveAuthUserId,
            claimedByName: actor.name || "You",
            claimedByAvatar: actor.avatar,
            claimedByRole: actor.role,
            claimedAt: Date.now(),
          },
        },
        { headers: getKristoHeaders() }
      );

      console.log("KRISTO_SLOT_CLAIM_RESPONSE", {
        messageId: slotId,
        elapsedMs: Date.now() - tapAt,
        ok: !!patchRes?.ok,
        error: patchRes?.error || null,
      });

      if (!patchRes?.ok) {
        revertAssignmentCardClaim(threadId, slotId, effectiveAuthUserId);
        const patchError = String(patchRes?.error || "");
        if (patchError === "slot_already_claimed" || Number(patchRes?.status || 0) === 409) {
          Alert.alert("Slot already claimed", "This live slot is already taken.");
        } else {
          Alert.alert(
            "Claim failed",
            patchError || "Could not save your claim. Please try again."
          );
        }
        return;
      }

      broadcastChurchLiveControlRoomSync({
        action: "claim",
        churchId: String(churchId || getKristoHeaders()["x-kristo-church-id"] || "").trim(),
        userId: effectiveAuthUserId,
        messageId: slotId,
        cardId: String((targetMsg?.card as any)?.cardId || slotId),
        reason: "room-slot-claim",
      });

      persistMeTabRingFromRoomMessageClaim({
        messageId: slotId,
        targetMsg,
        userId: effectiveAuthUserId,
        actor,
        churchId: String(churchId || getKristoHeaders()["x-kristo-church-id"] || "").trim(),
        scheduleModel: churchLiveControlScheduleRenderById[slotId] || null,
      });

      forceReloadRoomMessages();
    } catch (e: any) {
      console.log("KRISTO_SLOT_CLAIM_RESPONSE", {
        messageId: slotId,
        elapsedMs: Date.now() - tapAt,
        ok: false,
        error: String(e?.message || e || "unknown"),
      });
      revertAssignmentCardClaim(threadId, slotId, effectiveAuthUserId);
      Alert.alert("Claim failed", "Could not save your claim. Please try again.");
    } finally {
      clearClaimInFlight(slotId);
    }
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
    const admins = assignmentMembers.filter((x: any) => x.role === "Pastor" || x.role === "Admin").length;
    const paused = assignmentMembers.filter((x: any) => x.status === "Suspended").length;

    return { members, admins, paused };
  }, [isAssignmentThread, assignmentMembers]);

  const ministryAdmins = useMemo(
    () => ministryMembers.filter((x: any) => x.role === "Pastor" || x.role === "Admin"),
    [ministryMembers]
  );

  const ministryActiveCount = useMemo(
    () => ministryMembers.filter((x: any) => x.status === "Active").length,
    [ministryMembers]
  );

  const ministrySuspendedCount = useMemo(
    () => ministryMembers.filter((x: any) => x.status === "Suspended").length,
    [ministryMembers]
  );

  const ministrySuspendedMembers = useMemo(
    () => ministryMembers.filter((x: any) => x.status === "Suspended"),
    [ministryMembers]
  );

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [churchMemberPickerRows, setChurchMemberPickerRows] = useState<MinistryPerson[]>([]);
  const [selectedAddMemberId, setSelectedAddMemberId] = useState("");
  const [selectedRemoveMemberId, setSelectedRemoveMemberId] = useState("");
  const [addMemberMode, setAddMemberMode] = useState<"add" | "remove" | "suspend">("add");
  const [addingAssignmentMember, setAddingAssignmentMember] = useState(false);
  const [removingAssignmentMember, setRemovingAssignmentMember] = useState(false);
  const [suspendingAssignmentMember, setSuspendingAssignmentMember] = useState(false);

  const selectedRemoveTarget = useMemo(() => {
    if (!selectedRemoveMemberId) return null;
    return (
      displayMemberBoardPeople.find(
        (x: any) =>
          String(x.id || "") === selectedRemoveMemberId ||
          String((x as any).ministryMemberId || "") === selectedRemoveMemberId
      ) || null
    );
  }, [displayMemberBoardPeople, selectedRemoveMemberId]);

  const selectedRemoveProtected = useMemo(
    () =>
      !!selectedRemoveTarget &&
      isProtectedMinistryMember({
        userId: (selectedRemoveTarget as any).userId || selectedRemoveTarget.id,
        actualPastorUserId: churchPastorUserId,
        isProtected: (selectedRemoveTarget as any).isProtected,
        isChurchPastor: (selectedRemoveTarget as any).isChurchPastor,
      }),
    [selectedRemoveTarget, churchPastorUserId]
  );

  const assignmentStatsSource =
    displayMemberBoardPeople.length > 0 ? displayMemberBoardPeople : assignmentMembers;

  const assignmentAdmins = useMemo(
    () => assignmentStatsSource.filter((x: any) => x.role === "Pastor" || x.role === "Admin"),
    [assignmentStatsSource]
  );

  const assignmentActiveCount = useMemo(
    () => assignmentStatsSource.filter((x: any) => x.status === "Active").length,
    [assignmentStatsSource]
  );

  const assignmentSuspendedMembers = useMemo(
    () => assignmentStatsSource.filter((x: any) => x.status === "Suspended"),
    [assignmentStatsSource]
  );

  useEffect(() => {
    let alive = true;

    async function reloadMemberBoard(opts?: { force?: boolean }) {
      if ((!isAssignmentThread && !isMinistryThread) || !String(threadId || "").trim()) {
        if (alive) setRealMemberBoardPeople([]);
        return;
      }

      try {
        const targetMinistryId = String(
          resolvedMinistryId ||
          (params as any)?.assignmentId ||
          threadId ||
          ""
        );

        if (isChurchLiveControlRoom) {
          const headers: any = getKristoHeaders();
          const cid = String(churchId || headers?.["x-kristo-church-id"] || "").trim();
          const uid = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();
          if (!cid || !uid) return;

          const refresh = await refreshLiveControlMembersIfNeeded({
            churchId: cid,
            userId: uid,
            roomId: CHURCH_MEDIA_ROOM_ID,
            headers: { ...headers, "x-kristo-role": "Pastor" },
            force: !!opts?.force,
            cacheFresh: !opts?.force && mediaRoomCacheFreshRef.current,
            source: opts?.force ? "manual" : "screen",
          });

          const rows = refresh.rawRows;
          const sig = liveControlMembersRawSignature(rows);
          if (sig === memberBoardSigRef.current) return;

          memberBoardSigRef.current = sig;
          const mapped = mapLiveControlBoardPeople(
            rows,
            targetMinistryId,
            String(threadId || ""),
            CHURCH_MEDIA_ROOM_ID
          ) as MinistryPerson[];

          if (alive) setRealMemberBoardPeople(mapped);
          if (!refresh.skipped) mediaRoomCacheFreshRef.current = true;
          return;
        }

        const endpoint = isChurchLiveControlAssignment
          ? "/api/church/members"
          : `/api/church/ministry-members?ministryId=${encodeURIComponent(targetMinistryId)}`;

        const res: any = await apiGet(
          endpoint,
          {
            headers: isChurchLiveControlAssignment
              ? ({ ...getKristoHeaders(), "x-kristo-role": "Pastor" } as any)
              : (getKristoHeaders() as any),
          },
          isChurchLiveControlAssignment
            ? undefined
            : { screen: `MinistryMembersBoard:${targetMinistryId}`, throttleMs: 0, dedupe: false }
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
            /pastor/i.test(roleRaw) ? "Pastor" :
            /^leader$/i.test(roleRaw) || /assistant/i.test(roleRaw) ? "Leader" :
            /host/i.test(roleRaw) ? "Host" :
            /admin/i.test(roleRaw) ? "Leader" :
            "Member";

          const ministryMemberId = String(x.id || "").trim();
          const userId = String(x.userId || "").trim();

          return {
            id: ministryMemberId.startsWith("mm_") ? ministryMemberId : userId || `real_${index}`,
            ministryMemberId: ministryMemberId.startsWith("mm_") ? ministryMemberId : "",
            ministryId: String(x.ministryId || targetMinistryId || (params as any)?.assignmentId || threadId || ""),
            userId,
            name: String(x.displayName || x.fullName || x.name || x.userId || "Member"),
            role,
            status: /paused|suspended/i.test(String(x.status || "")) ? "Suspended" : "Active",
            note:
              role === "Leader" ? "Ministry leader" :
              role === "Host" ? "Ministry host" :
              "Ministry member",
            avatarUri,
          } as MinistryPerson;
        });

        if (alive) setRealMemberBoardPeople(mapped);
      } catch {
        if (alive) setRealMemberBoardPeople([]);
      }
    }

    reloadMemberBoardRef.current = reloadMemberBoard;
    void reloadMemberBoard();

    return () => {
      alive = false;
      reloadMemberBoardRef.current = null;
    };
  }, [isAssignmentThread, isMinistryThread, isChurchLiveControlAssignment, isChurchLiveControlRoom, threadId, resolvedMinistryId, churchId, effectiveAuthUserId, (params as any)?.assignmentId]);

  useEffect(() => {
    const next = new Map<string, string>();

    for (const person of realMemberBoardPeople) {
      const uid = String((person as any).userId || person.id || "").trim();
      const uri = resolveMessageSenderAvatar(person as any).uri;
      if (uid && uri) next.set(uid, uri);
    }

    memberAvatarByUserIdRef.current = next;

    if (next.size > 0) {
      roomMessagesSigRef.current = "";
      void reloadRoomMessagesRef.current?.();
    }
  }, [realMemberBoardPeople]);

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
    const pickerSource = isChurchLiveControlRoom
      ? realMemberBoardPeople.filter(
          (x: any) => String(x.status || "").toLowerCase() === "suspended"
        )
      : churchMemberPickerRows;

    const selected = pickerSource.find(
      (x: any) => String(x.userId || x.id || "") === selectedAddMemberId
    );

    if (!selected || addingAssignmentMember) return;

    const userId = String((selected as any).userId || selected.id || "").trim();

    if (!userId) {
      Alert.alert("Missing info", "Member information is missing.");
      return;
    }

    if (isChurchLiveControlRoom) {
      try {
        setAddingAssignmentMember(true);

        console.log("[LiveControlMembers] suspend request", {
          action: "unsuspend",
          userId,
          roomId: "church-media-room",
        });

        const res: any = await apiPatch(
          "/api/church/live-control-members",
          {
            action: "unsuspend",
            userId,
            roomId: "church-media-room",
          },
          { headers: getKristoHeaders() as any }
        );

        if (!res || res.ok === false) {
          const errMsg = extractApiErrorMessage(res, "Restore failed");
          console.log("[LiveControlMembers] suspend failed", {
            action: "unsuspend",
            userId,
            error: errMsg,
            status: res?.status ?? null,
          });
          throw new Error(errMsg);
        }

        console.log("[LiveControlMembers] suspend success", {
          unsuspended: !!res.unsuspended,
          userId: res.userId || userId,
          roomId: res.roomId || "church-media-room",
        });

        setAddMemberOpen(false);
        setSelectedAddMemberId("");
        await reloadMemberBoardRef.current?.({ force: true });
        Alert.alert("Restored", `${selected.name} can access Church Live Control again.`);
      } catch (e: any) {
        console.log("[LiveControlMembers] suspend failed", {
          action: "unsuspend",
          userId,
          error: String(e?.message || e || "Please try again."),
        });
        Alert.alert(
          "Could not restore member",
          extractApiErrorMessage(e, String(e?.message || "Please try again."))
        );
      } finally {
        setAddingAssignmentMember(false);
      }
      return;
    }

    const assignmentId = String(resolvedMinistryId || (params as any)?.assignmentId || threadId || "").trim();

    if (!assignmentId) {
      Alert.alert("Missing info", "Assignment information is missing.");
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

  async function suspendSelectedAssignmentMember() {
    const selected = realMemberBoardPeople.find(
      (x: any) =>
        String(x.id || "") === selectedRemoveMemberId ||
        String((x as any).userId || "") === selectedRemoveMemberId
    );

    if (!selected || suspendingAssignmentMember) return;

    const targetUserId = String((selected as any).userId || selected.id || "").trim();

    if (!targetUserId) {
      Alert.alert("Missing info", "Member record is missing.");
      return;
    }

    console.log("[LiveControlMembers] suspend request", {
      action: "suspend",
      userId: targetUserId,
      roomId: "church-media-room",
    });

    try {
      setSuspendingAssignmentMember(true);

      const res: any = await apiPatch(
        "/api/church/live-control-members",
        {
          action: "suspend",
          userId: targetUserId,
          roomId: "church-media-room",
        },
        { headers: getKristoHeaders() as any }
      );

        if (!res || res.ok === false) {
          const errMsg = extractApiErrorMessage(res, "Suspend failed");
          console.log("[LiveControlMembers] suspend failed", {
            userId: targetUserId,
            error: errMsg,
            status: res?.status ?? null,
          });
          throw new Error(errMsg);
        }

      console.log("[LiveControlMembers] suspend success", {
        suspended: !!res.suspended,
        userId: res.userId || targetUserId,
        roomId: res.roomId || "church-media-room",
      });

      setSelectedRemoveMemberId("");
      await reloadMemberBoardRef.current?.({ force: true });

      if (targetUserId && mcHostIds.includes(targetUserId)) {
        const headers: any = getKristoHeaders();
        const cid = String(churchId || headers?.["x-kristo-church-id"] || "").trim();
        const uid = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();
        if (cid && uid) invalidateMcHostsCache(cid, uid, CHURCH_MEDIA_ROOM_ID);
        invalidateCachedParticipant(mcHostsCacheKey);
        mcHostsSigRef.current = "";
        void fetchMcHostsRef.current?.({ force: true, reason: "member-suspended-host" });
      }

      Alert.alert("Suspended", `${selected.name} no longer has Church Live Control access.`);
    } catch (e: any) {
      console.log("[LiveControlMembers] suspend failed", {
        userId: targetUserId,
        error: String(e?.message || e || "Please try again."),
      });
      Alert.alert(
        "Could not suspend member",
        extractApiErrorMessage(e, String(e?.message || "Please try again."))
      );
    } finally {
      setSuspendingAssignmentMember(false);
    }
  }

  async function removeSelectedAssignmentMember() {
    if (isChurchLiveControlRoom) {
      Alert.alert(
        "Use Suspend",
        "Church Live Control members cannot be removed. Suspend them instead."
      );
      return;
    }

    const selected = displayMemberBoardPeople.find(
      (x: any) =>
        String(x.id || "") === selectedRemoveMemberId ||
        String((x as any).ministryMemberId || "") === selectedRemoveMemberId
    );

    if (!selected || removingAssignmentMember) return;

    const ministryMemberId = String((selected as any).ministryMemberId || selected.id || "").trim();
    const targetUserId = String((selected as any).userId || "").trim();
    const currentMinistryId = String(resolvedMinistryId || (params as any)?.assignmentId || threadId || "").trim();
    const selectedMinistryId = String((selected as any).ministryId || "").trim();

    if (!ministryMemberId && !(targetUserId && currentMinistryId)) {
      Alert.alert("Missing info", "Member record is missing.");
      return;
    }

    if (selectedMinistryId && currentMinistryId && selectedMinistryId !== currentMinistryId) {
      Alert.alert("Wrong room", "This member record belongs to another ministry room.");
      return;
    }

    if (
      isProtectedMinistryMember({
        userId: targetUserId,
        actualPastorUserId: churchPastorUserId,
        isProtected: (selected as any).isProtected,
        isChurchPastor: (selected as any).isChurchPastor,
      })
    ) {
      Alert.alert("Pastor protected", "Pastor cannot be removed from a ministry.");
      return;
    }

    const deleteParams = new URLSearchParams();
    if (ministryMemberId.startsWith("mm_")) {
      deleteParams.set("id", ministryMemberId);
    }
    if (currentMinistryId) deleteParams.set("ministryId", currentMinistryId);
    if (targetUserId) deleteParams.set("userId", targetUserId);

    console.log("[MinistryMembers] remove request", {
      ministryMemberId,
      userId: targetUserId,
      ministryId: currentMinistryId,
    });

    try {
      setRemovingAssignmentMember(true);

      const res: any = await apiDelete(
        `/api/church/ministry-members?${deleteParams.toString()}`,
        { headers: getKristoHeaders() as any }
      );

      if (!res || res.ok === false) {
        console.log("[MinistryMembers] remove failed", {
          ministryMemberId,
          userId: targetUserId,
          error: String(res?.error || "Remove failed"),
        });
        throw new Error(String(res?.error || "Remove failed"));
      }

      console.log("[MinistryMembers] remove success", {
        removed: !!res.removed,
        ministryMemberId: res.ministryMemberId || ministryMemberId,
        userId: res.userId || targetUserId,
        ministryId: res.ministryId || currentMinistryId,
      });

      setSelectedRemoveMemberId("");
      await reloadMemberBoardRef.current?.();

      if (targetUserId && mcHostIds.includes(targetUserId)) {
        invalidateCachedParticipant(mcHostsCacheKey);
        void fetchMcHostsRef.current?.({ force: true, reason: "member-removed-host" });
      }

      Alert.alert("Removed", `${selected.name} has been removed from this assignment.`);
    } catch (e: any) {
      console.log("[MinistryMembers] remove failed", {
        ministryMemberId,
        userId: targetUserId,
        error: String(e?.message || e || "Please try again."),
      });
      Alert.alert("Could not remove member", String(e?.message || "Please try again."));
    } finally {
      setRemovingAssignmentMember(false);
    }
  }

  useEffect(() => {
    let alive = true;
    let prevSig = "";

    async function fetchMcHosts(opts?: { force?: boolean; reason?: string }): Promise<boolean> {
      if (!isStructuredRoom || !String(threadId || "").trim()) {
        if (alive) setMcHostIds([]);
        return false;
      }

      const cacheKey = mcHostsCacheKey;

      if (isChurchLiveControlRoom) {
        const headers: any = getKristoHeaders();
        const cid = String(churchId || headers?.["x-kristo-church-id"] || "").trim();
        const uid = String(headers?.["x-kristo-user-id"] || effectiveAuthUserId || "").trim();
        if (!cid || !uid) return false;

        if (!opts?.force) {
          const cached = getCachedParticipant(cacheKey);
          if (cached && alive) {
            const hostSig = mcHostsSignature(Array.isArray(cached) ? cached : []);
            if (hostSig !== mcHostsSigRef.current) {
              mcHostsSigRef.current = hostSig;
              setMcHostIds(Array.isArray(cached) ? cached : []);
            }
          }
        }

        try {
          const refresh = await refreshMcHostsIfNeeded({
            churchId: cid,
            userId: uid,
            assignmentId: CHURCH_MEDIA_ROOM_ID,
            headers,
            force: !!opts?.force,
            cacheFresh: !opts?.force && mediaRoomCacheFreshRef.current,
            source: opts?.reason || "poll",
            cacheKey,
          });

          const foundIds = refresh.hostUserIds;
          const sig = mcHostsSignature(foundIds);
          const changed = sig !== mcHostsSigRef.current;

          if (alive) {
            if (changed) {
              mcHostsSigRef.current = sig;
              setMcHostIds(foundIds);
            }
          }

          if (!refresh.skipped) mediaRoomCacheFreshRef.current = true;

          if (changed) {
            prevSig = sig;
            console.log("[McHostsPoll] updated", {
              cacheKey,
              hostUserIds: foundIds,
              reason: opts?.reason || "poll",
            });
            return true;
          }

          return false;
        } catch {
          if (alive && opts?.force) setMcHostIds([]);
          return false;
        }
      }

      if (!opts?.force) {
        const cached = getCachedParticipant(cacheKey);
        if (cached && alive) {
          setMcHostIds(Array.isArray(cached) ? cached : []);
        }
      }

      try {
        const keys = [
          String(resolvedMinistryId || ""),
          String((params as any)?.assignmentId || ""),
          String(threadId || ""),
        ]
          .map((x: any) => x.trim())
          .filter(Boolean)
          .filter((x, index, arr) => arr.indexOf(x) === index);

        let foundIds: string[] = [];

        for (const assignmentKey of keys) {
          console.log("[McHostsPoll] fetch-start", {
            assignmentKey,
            reason: opts?.reason || "poll",
            force: !!opts?.force,
          });

          const res: any = await apiGet(
            `/api/church/mc-hosts?assignmentId=${encodeURIComponent(assignmentKey)}&t=${Date.now()}`,
            { headers: { ...getKristoHeaders(), "x-kristo-role": "Member" } as any },
            { screen: `McHostsPoll:${cacheKey}`, throttleMs: 0, dedupe: false }
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

        const sig = foundIds.join("|");
        const changed = sig !== prevSig;

        if (alive) {
          setMcHostIds(foundIds);
          setCachedParticipant(cacheKey, foundIds);
        }

        if (changed) {
          prevSig = sig;
          console.log("[McHostsPoll] updated", {
            cacheKey,
            hostUserIds: foundIds,
            reason: opts?.reason || "poll",
          });
          return true;
        }

        return false;
      } catch {
        if (alive && opts?.force) setMcHostIds([]);
        return false;
      }
    }

    fetchMcHostsRef.current = fetchMcHosts;

    void fetchMcHosts({
      force: isChurchLiveControlRoom ? false : true,
      reason: "mount",
    });

    const stop = startMcHostsPolling({
      assignmentId: mcHostsCacheKey,
      enabled: isFocused && isStructuredRoom,
      onTick: () =>
        fetchMcHosts({
          force: false,
          reason: "poll",
        }),
    });

    return () => {
      alive = false;
      fetchMcHostsRef.current = null;
      stop();
    };
  }, [
    isStructuredRoom,
    isChurchLiveControlRoom,
    threadId,
    mcHostsCacheKey,
    churchId,
    effectiveAuthUserId,
    resolvedMinistryId,
    (params as any)?.assignmentId,
    isFocused,
  ]);

  const memberBoardSource =
    isAssignmentThread
      ? realMemberBoardPeople
      : ministryMembers;

  const memberBoardLeaders = useMemo(
    () =>
      memberBoardSource.filter((x: any) => {
        const r = String(x.role || "").toLowerCase();
        return (
          r.includes("pastor") ||
          r.includes("admin") ||
          r.includes("leader") ||
          r.includes("host")
        );
      }),
    [memberBoardSource]
  );

  const memberBoardGuests = useMemo(
    () =>
      memberBoardSource.filter((x: any) => {
        const r = String(x.role || "").toLowerCase();
        const st = String(x.status || "").toLowerCase();
        return r.includes("guest") || st.includes("guest") || st.includes("pending");
      }),
    [memberBoardSource]
  );

  const memberBoardVisible = useMemo(() => {
    if (memberBoardTab === "leaders") return memberBoardLeaders;
    if (memberBoardTab === "guests") return memberBoardGuests;
    return memberBoardSource.filter((x: any) => {
      const r = String(x.role || "").toLowerCase();
      return !r.includes("pastor") && !r.includes("admin") && !r.includes("leader");
    });
  }, [memberBoardTab, memberBoardSource, memberBoardLeaders, memberBoardGuests]);

  const mcHostCandidates = useMemo(
    () => memberBoardSource.filter((x: any) => String(x.status || "").toLowerCase() !== "suspended"),
    [memberBoardSource]
  );

  const currentUserIdForMc = currentUserIdForAuthority;

  const visibleMcHostCandidates = useMemo(() => {
    if (canManageMcHosts) return mcHostCandidates;

    if (!currentUserIdForMc || !mcHostIds.includes(currentUserIdForMc)) return [];

    const selfFromList = mcHostCandidates.find((x: any) => {
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
            .map((x: any) => String(x || "").trim())
            .filter((x: any) => x.startsWith("u_"))
            .filter((x, index, arr) => arr.indexOf(x) === index)
            .slice(0, 2),
        },
        { headers: { ...getKristoHeaders(), "x-kristo-role": "Pastor" } as any }
      );

      const savedIds = Array.isArray(saved?.data?.hostUserIds) ? saved.data.hostUserIds : nextIds;
      const normalizedSavedIds = savedIds
        .map((x: any) => String(x || "").trim())
        .filter((x: string) => x.startsWith("u_"))
        .filter((x: string, index: number, arr: string[]) => arr.indexOf(x) === index)
        .slice(0, 2);

      invalidateCachedParticipant(mcHostsCacheKey);
      setMcHostIds(normalizedSavedIds);
      setCachedParticipant(mcHostsCacheKey, normalizedSavedIds);

      console.log("[McHostsPoll] updated", {
        cacheKey: mcHostsCacheKey,
        hostUserIds: normalizedSavedIds,
        reason: "save-success",
      });

      void fetchMcHostsRef.current?.({ force: true, reason: "save-success" });
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
        .map((x: any) => String(x || "").trim())
        .filter((x: any) => x.startsWith("u_"))
        .filter((x, index, arr) => arr.indexOf(x) === index);

      let next = cleanPrev;

      if (cleanPrev.includes(id)) {
        next = cleanPrev.filter((x: any) => x !== id);
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
    () => mcHostCandidates.filter((x: any) => mcHostIds.includes(String((x as any).userId || x.id))),
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

            handleThreadBack();
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

          {canStartPastoralPrivateCall ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start voice call"
              onPress={startPastoralPrivateCall}
              disabled={privateCallStarting}
              style={({ pressed }) => [
                s.hBtn,
                s.hBtnGold,
                ({ marginTop: -2, marginRight: 2 } as ViewStyle),
                privateCallStarting
                  ? ({ opacity: 0.52 } as ViewStyle)
                  : null,
                pressed && !privateCallStarting
                  ? ({
                      opacity: 0.85,
                      transform: [{ scale: 0.96 }],
                    } as ViewStyle)
                  : null,
              ]}
            >
              <Ionicons
                name="call-outline"
                size={20}
                color={GOLD}
              />
            </Pressable>
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
            const prev = visibleMessages[index + 1];
            const showAvatar = true;
            const isSelected = selectedMessageIds.has(item.id);
            const isActionHighlighted = messageActionsOpen && messageActionsTarget?.id === item.id;

            return (
              <Bubble
                m={item}
                showAvatar={showAvatar}
                selected={isSelected}
                actionHighlighted={isActionHighlighted}
                churchPastorUserId={churchPastorUserId}
                onPress={
                  messageSelectionMode && isSelectableMessage(item)
                    ? () => toggleMessageSelection(item.id)
                    : undefined
                }
                onLongPress={() => openMessageActions(item)}
                canClaimAssignmentCard={canViewerClaimAssignmentCard}
                canAddAssignmentCard={canViewerAddToAssignmentCard}
                canAddVideoAssignmentCard={canViewerAddMusicAssignmentCard}
                claimingAssignmentMessageIds={claimingAssignmentMessageIds}
                onClaimAssignmentCard={handleClaimAssignmentMessage}
                onAddAssignmentMember={handleAddAssignmentMember}
                onAddVideoAssignmentCard={handleAddAssignmentVideo}
                onOpenScheduledLive={openScheduledLiveFromCard}
                onPreviewImage={openImagePreview}
                onOpenSharedPost={handleOpenSharedPost}
                isChurchLiveControlRoom={isChurchLiveControlRoom}
                churchLiveControlScheduleModel={
                  churchLiveControlScheduleRenderById[item.id] || null
                }
                liveScheduleNowMs={liveCountdownNow}
                profileName={liveScheduleProfileName}
                profileAvatarUri={liveScheduleProfileAvatarUri}
                onEnterLiveFromScheduleCard={handleEnterLiveFromChurchScheduleCard}
              />
            );
          }}
          ListEmptyComponent={
            <View style={s.chatEmptyList}>
              <Text style={t.emptyTitle}>No messages yet</Text>
              <Text style={t.emptySub}>
                {isMessagingDisabledV1
                  ? "Messages are coming in V2. For V1, communication happens through ministries, live control, and church updates."
                  : isAssignmentThread
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
        {messageSelectionMode ? (() => {
          const selectedMessages = messages.filter((m) => selectedMessageIds.has(m.id));
          const canDeleteEveryoneSelection =
            selectedMessages.length > 0 &&
            selectedMessages.every((m) => m.sender === "me" && canDeleteMessage(m));

          return (
            <View style={[s.messageSelectionBar, { marginBottom: tabBarH + 6 }]}>
              <Pressable onPress={exitMessageSelectionMode} style={({ pressed }) => [s.messageSelectionBtn, pressed ? s.messageSelectionBtnPressed : null]}>
                <Text style={t.messageSelectionBtnText}>Cancel</Text>
              </Pressable>

              <Text style={t.messageSelectionCount}>{selectedMessageIds.size} selected</Text>

              {canDeleteEveryoneSelection ? (
                <Pressable
                  onPress={() =>
                    performDeleteMessageIds(Array.from(selectedMessageIds), {
                      scope: "everyone",
                    })
                  }
                  disabled={selectedMessageIds.size === 0}
                  style={({ pressed }) => [
                    s.messageSelectionDeleteBtn,
                    selectedMessageIds.size === 0 ? s.messageSelectionDeleteBtnDisabled : null,
                    pressed && selectedMessageIds.size > 0 ? s.messageSelectionBtnPressed : null,
                  ]}
                >
                  <Ionicons name="trash-outline" size={15} color="#FF6B72" />
                  <Text style={t.messageSelectionDeleteText}>Everyone</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() =>
                  performDeleteMessageIds(Array.from(selectedMessageIds), {
                    scope: "local",
                  })
                }
                disabled={selectedMessageIds.size === 0}
                style={({ pressed }) => [
                  s.messageSelectionDeleteBtn,
                  selectedMessageIds.size === 0 ? s.messageSelectionDeleteBtnDisabled : null,
                  pressed && selectedMessageIds.size > 0 ? s.messageSelectionBtnPressed : null,
                ]}
              >
                <Ionicons name="trash-outline" size={15} color="#FF6B72" />
                <Text style={t.messageSelectionDeleteText}>Me</Text>
              </Pressable>
            </View>
          );
        })() : null}
        {pending.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={s.pendingStrip}
            contentContainerStyle={s.pendingStripContent}
          >
            {pending.map((a) => (
              <View key={a.id} style={s.pendingChip}>
                {a.kind === "image" ? (
                  <Image source={{ uri: a.localUri }} style={s.pendingChipThumb as ImageStyle} resizeMode="cover" />
                ) : (
                  <View style={s.pendingChipIcon}>
                    <Ionicons name="document-text-outline" size={18} color={GOLD_SOLID} />
                  </View>
                )}
                <Text style={t.pendingChipName} numberOfLines={1} ellipsizeMode="middle">
                  {a.name}
                </Text>
                <Pressable
                  onPress={() => removePending(a.id)}
                  hitSlop={8}
                  style={({ pressed }) => [s.pendingChipRemove, pressed ? ({ opacity: 0.72 } as ViewStyle) : null]}
                >
                  <Ionicons name="close" size={14} color="rgba(255,255,255,0.62)" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {isMessagingDisabledV1 ? (
          <View
            style={{
              marginBottom: tabBarH + 8,
              marginHorizontal: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.04)",
              borderWidth: 1,
              borderColor: "rgba(244,208,111,0.22)",
            }}
          >
            <Ionicons name="lock-closed-outline" size={20} color={GOLD_SOLID} />
            <Text
              style={{
                flex: 1,
                color: "rgba(255,255,255,0.78)",
                fontSize: 13,
                lineHeight: 19,
              }}
            >
              Messages are coming in V2. For V1, communication happens through
              ministries, live control, and church updates.
            </Text>
          </View>
        ) : (
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
              disabled={!canSend || (isMinistryThread && isSuspended) || attachUploading}
              style={({ pressed }) => [
                s.sendBtn,
                !canSend || (isMinistryThread && isSuspended) || attachUploading ? s.sendBtnDisabled : null,
                canSend && !(isMinistryThread && isSuspended) && !attachUploading ? s.sendBtnActive : null,
                pressed && canSend && !(isMinistryThread && isSuspended) && !attachUploading ? ({ transform: [{ scale: 0.97 }], opacity: 0.94 } as ViewStyle) : null,
              ]}
            >
              <Ionicons name="send" size={16} color={canSend && !(isMinistryThread && isSuspended) && !attachUploading ? "#FFFFFF" : "rgba(255,255,255,0.30)"} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      <MessageImageGalleryModal
        open={imagePreviewIndex != null && roomImageGallery.length > 0}
        uris={roomImageGallery}
        startIndex={imagePreviewIndex ?? 0}
        onClose={closeImagePreview}
      />

      <MessageActionsSheet
        open={messageActionsOpen}
        message={messageActionsTarget}
        showEdit={!!messageActionsTarget && canEditMessage(messageActionsTarget)}
        showDelete={!!messageActionsTarget && canDeleteMessage(messageActionsTarget)}
        deleteLabel={
          messageActionsTarget?.sender === "me" ? "Delete for me" : "Delete from my view"
        }
        showDeleteForEveryone={
          !!messageActionsTarget &&
          messageActionsTarget.sender === "me" &&
          canDeleteMessage(messageActionsTarget)
        }
        onClose={closeMessageActions}
        onSelect={handleMessageActionSelect}
        onDelete={handleMessageActionDelete}
        onDeleteForEveryone={handleMessageActionDeleteForEveryone}
        onEdit={handleMessageActionEdit}
        onShare={handleMessageActionShare}
        onSelectAll={handleMessageActionSelectAll}
      />

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
              <Text style={t.menuTitle}>{isChurchLiveControlRoom ? "ADD & Suspend" : "ADD & Remove"}</Text>
              <Text style={t.menuSub}>
                {isChurchLiveControlRoom
                  ? `Restore or suspend access for ${headerTitle}`
                  : `Manage members for ${headerTitle}`}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14, marginBottom: 14 }}>
              {(isChurchLiveControlRoom
                ? [
                    { key: "add", label: "Add" },
                    { key: "suspend", label: "Suspend" },
                  ]
                : [
                    { key: "add", label: "Add" },
                    { key: "remove", label: "Remove" },
                  ]
              ).map((tab: any) => {
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
                (addMemberMode === "add"
                  ? isChurchLiveControlRoom
                    ? realMemberBoardPeople.filter(
                        (x: any) => String(x.status || "").toLowerCase() === "suspended"
                      )
                    : churchMemberPickerRows
                  : displayMemberBoardPeople.filter(
                      (x: any) =>
                        addMemberMode === "suspend"
                          ? String(x.status || "").toLowerCase() !== "suspended"
                          : true
                    )
                ).filter((x: any) => {
                  const userId = String(x.userId || x.id || "").trim();
                  const selfId = String(effectiveAuthUserId || currentUserIdForMc || "").trim();
                  if (selfId && userId === selfId) return false;
                  return true;
                })
              }
              keyExtractor={(item: any) => String(item.userId || item.id)}
              contentContainerStyle={s.memberListContent}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              ListEmptyComponent={
                <View style={{ paddingVertical: 28, alignItems: "center" }}>
                  <Ionicons
                    name={
                      addMemberMode === "add"
                        ? "people-outline"
                        : addMemberMode === "suspend"
                          ? "pause-circle-outline"
                          : "remove-circle-outline"
                    }
                    size={28}
                    color={GOLD}
                  />
                  <Text style={[t.memberEmptyTitle, { marginTop: 10 }]}>
                    {addMemberMode === "add"
                      ? isChurchLiveControlRoom
                        ? "No suspended members to restore"
                        : "No church members to add"
                      : addMemberMode === "suspend"
                        ? "No members to suspend"
                        : "No members to remove"}
                  </Text>
                  <Text style={t.menuSub}>
                    {addMemberMode === "add"
                      ? isChurchLiveControlRoom
                        ? "Everyone with access is already active."
                        : "Everyone may already be in this assignment."
                      : addMemberMode === "suspend"
                        ? "Everyone currently has Church Live Control access."
                        : "This assignment has no removable members."}
                  </Text>
                </View>
              }
              renderItem={({ item }: any) => {
                const addKey = String(item.userId || item.id || "");
                const removeKey = String(
                  isChurchLiveControlRoom
                    ? item.userId || item.id || ""
                    : (item as any).ministryMemberId || item.id || ""
                );
                const alreadyAdded = !!(item as any).alreadyAdded;
                const isProtectedRow = isProtectedMinistryMember({
                  userId: item.userId || item.id,
                  actualPastorUserId: churchPastorUserId,
                  isProtected: (item as any).isProtected,
                  isChurchPastor: (item as any).isChurchPastor,
                });
                const selected =
                  addMemberMode === "add"
                    ? selectedAddMemberId === addKey
                    : selectedRemoveMemberId === removeKey;

                return (
                  <Pressable
                    onPress={() => {
                      if (addMemberMode === "add") {
                        if (!alreadyAdded || isChurchLiveControlRoom) setSelectedAddMemberId(addKey);
                      } else if (!isProtectedRow) {
                        setSelectedRemoveMemberId(removeKey);
                      }
                    }}
                    disabled={addMemberMode !== "add" && isProtectedRow}
                    style={({ pressed }) => [
                      s.memberRow,
                      selected ? { borderColor: GOLD, backgroundColor: "rgba(217,179,95,0.12)" } : null,
                      addMemberMode === "add" && alreadyAdded && !isChurchLiveControlRoom
                        ? { opacity: 0.55 }
                        : null,
                      isProtectedRow && addMemberMode !== "add" ? { opacity: 0.72 } : null,
                      pressed &&
                      !(addMemberMode === "add" && alreadyAdded && !isChurchLiveControlRoom) &&
                      !(addMemberMode !== "add" && isProtectedRow)
                        ? ({ opacity: 0.92 } as ViewStyle)
                        : null,
                    ]}
                  >
                    <PersonRow item={item} />
                    <View style={{ marginLeft: 10, alignItems: "flex-end", gap: 6 }}>
                      {isProtectedRow && addMemberMode !== "add" ? (
                        <View style={[s.memberRolePill, s.memberRolePastor]}>
                          <Text style={[t.memberRoleText, t.memberRoleTextPastor]}>Protected</Text>
                        </View>
                      ) : null}
                      <Ionicons
                        name={
                          addMemberMode === "add" && alreadyAdded && !isChurchLiveControlRoom
                            ? "checkmark-done-circle"
                            : selected
                              ? "checkmark-circle"
                              : "ellipse-outline"
                        }
                        size={24}
                        color={
                          addMemberMode === "add" && alreadyAdded && !isChurchLiveControlRoom
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
              onPress={
                addMemberMode === "add"
                  ? addSelectedChurchMemberToAssignment
                  : addMemberMode === "suspend"
                    ? suspendSelectedAssignmentMember
                    : removeSelectedAssignmentMember
              }
              disabled={
                addMemberMode === "add"
                  ? !selectedAddMemberId || addingAssignmentMember
                  : addMemberMode === "suspend"
                    ? !selectedRemoveMemberId || suspendingAssignmentMember
                    : !selectedRemoveMemberId || removingAssignmentMember || selectedRemoveProtected
              }
              style={({ pressed }) => {
                const enabled =
                  addMemberMode === "add"
                    ? !!selectedAddMemberId
                    : !!selectedRemoveMemberId && !selectedRemoveProtected;
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
                  ? addingAssignmentMember
                    ? isChurchLiveControlRoom
                      ? "Restoring..."
                      : "Adding..."
                    : isChurchLiveControlRoom
                      ? "Restore access"
                      : "Add to assignment"
                  : addMemberMode === "suspend"
                    ? suspendingAssignmentMember
                      ? "Suspending..."
                      : "Suspend member"
                    : removingAssignmentMember
                      ? "Removing..."
                      : selectedRemoveProtected
                        ? "Pastor protected"
                        : "Remove from assignment"}
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
                            dmMembershipSummary.role ===
                            "Guest"
                              ? s.menuPresencePillPurple
                              : s.menuPresencePillEmerald,
                          ]}
                        >
                          <Text
                            style={[
                              t.menuPresencePillText,
                              dmMembershipSummary.role ===
                              "Guest"
                                ? t.menuPresencePillTextPurple
                                : t.menuPresencePillTextEmerald,
                            ]}
                          >
                            {
                              dmMembershipSummary
                                .pill
                            }
                          </Text>
                        </View>
                      </View>

                      <Animated.View
                        style={[
                          s.menuFactCard,
                          dmMembershipSummary.role ===
                          "Guest"
                            ? s.menuFactCardPurple
                            : s.menuFactCardEmerald,
                          {
                            opacity: factCardOpacity,
                            transform: [
                              {
                                translateY:
                                  factCardTranslate,
                              },
                            ],
                          },
                        ]}
                      >
                        <Text
                          style={t.menuFactLabel}
                          numberOfLines={1}
                        >
                          CHURCH MEMBERSHIP
                        </Text>

                        <Text
                          style={t.menuFactValue}
                          numberOfLines={1}
                        >
                          {
                            dmMembershipSummary
                              .name
                          }
                        </Text>

                        <Text
                          style={t.menuPresencePillText}
                          numberOfLines={1}
                        >
                          {
                            dmMembershipSummary
                              .status
                          }
                          {"  •  Role: "}
                          {
                            dmMembershipSummary
                              .role
                          }
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
                            activeGlow={ministryToolAccess.members_board}
                            locked={!ministryToolAccess.members_board}
                            disabled={actionLoading !== null}
                            onPress={() => onThreadMenuAction("members")}
                          />
                        </View>

                        <View style={{ flexBasis: "48%", flexGrow: 1 }}>
                          <MenuTile
                            ministryCompact
                            icon="create-outline"
                            label="Profile"
                            activeGlow={ministryToolAccess.profile}
                            locked={!ministryToolAccess.profile}
                            disabled={actionLoading !== null}
                            onPress={() => onThreadMenuAction("edit")}
                          />
                        </View>

                        <View style={{ flexBasis: "48%", flexGrow: 1 }}>
                          <MenuTile
                            ministryCompact
                            icon="person-add-outline"
                            label="ADD & Remove"
                            activeGlow={ministryToolAccess.add_remove}
                            locked={!ministryToolAccess.add_remove}
                            disabled={actionLoading !== null}
                            onPress={() => onThreadMenuAction("invite")}
                          />
                        </View>

                        <View style={{ flexBasis: "48%", flexGrow: 1 }}>
                          <MenuTile
                            ministryCompact
                            icon={actionLoading === "pause" ? "time-outline" : "pause-circle-outline"}
                            label={actionLoading === "pause" ? "Pausing..." : "Pause ministry"}
                            danger
                            activeGlow={ministryToolAccess.pause}
                            locked={!ministryToolAccess.pause}
                            disabled={actionLoading !== null}
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
                              <MenuTile
                                icon="people-outline"
                                label="Members board"
                                activeGlow={ministryToolAccess.members_board}
                                locked={!ministryToolAccess.members_board}
                                compact
                                disabled={actionLoading !== null}
                                onPress={() => onThreadMenuAction("members")}
                              />

                              <MenuTile
                                icon="create-outline"
                                label="Profile"
                                activeGlow={ministryToolAccess.profile}
                                locked={!ministryToolAccess.profile}
                                compact
                                disabled={actionLoading !== null}
                                onPress={() => onThreadMenuAction("edit")}
                              />

                              <MenuTile
                                icon="person-add-outline"
                                label="ADD & Remove"
                                activeGlow={ministryToolAccess.add_remove}
                                locked={!ministryToolAccess.add_remove}
                                compact
                                disabled={actionLoading !== null}
                                onPress={() => onThreadMenuAction("invite")}
                              />

                              <MenuTile
                                icon="mic-outline"
                                label="MC+ Hosts"
                                activeGlow={ministryToolAccess.mc_hosts}
                                locked={!ministryToolAccess.mc_hosts}
                                compact
                                disabled={actionLoading !== null}
                                onPress={() => onThreadMenuAction("mc_plus")}
                              />
                            </View>
                          </View>
                        </View>

                        <View style={s.assignmentMenuColumnRight}>
                          <View style={s.menuSectionBlock}>
                            <Text style={t.menuSection}>Scheduling</Text>
                            <View style={s.menuTileGrid}>
                              <MenuTile
                                icon="calendar-outline"
                                label="Meeting"
                                activeGlow={ministryToolAccess.meeting}
                                locked={!ministryToolAccess.meeting}
                                disabled={actionLoading !== null}
                                onPress={() =>
                                  gateMinistryTool("meeting", () => {
                                    closeThreadMenu();
                                    openAssignmentToolScreen("meeting");
                                  })
                                }
                              />

                              <MenuTile
                                icon="time-outline"
                                label="Schedule"
                                activeGlow={ministryToolAccess.schedule}
                                locked={!ministryToolAccess.schedule}
                                disabled={actionLoading !== null}
                                onPress={() =>
                                  gateMinistryTool("schedule", () => {
                                    closeThreadMenu();
                                    openAssignmentToolScreen("schedule");
                                  })
                                }
                              />
                            </View>
                          </View>

                          <View style={s.menuSectionBlock}>
                            <Text style={t.menuSection}>Control</Text>
                            <View style={s.menuTileGrid}>
                              <MenuTile
                                icon={actionLoading === "pause" ? "time-outline" : "pause-circle-outline"}
                                label={actionLoading === "pause" ? "Pausing..." : "Pause assignment"}
                                danger
                                activeGlow={ministryToolAccess.pause}
                                locked={!ministryToolAccess.pause}
                                disabled={actionLoading !== null}
                                onPress={() => onThreadMenuAction("pause")}
                              />

                              <MenuTile icon={actionLoading === "leave" ? "time-outline" : "exit-outline"} label={actionLoading === "leave" ? "Leaving..." : isAssignmentThread ? "Leave assignment" : "Quit ministry"} danger disabled={actionLoading !== null} onPress={() => onThreadMenuAction("leave")} />
                            </View>
                          </View>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : (
                <View style={s.dmSettingsDashboard}>
                  <View style={s.menuSectionBlock}>
                    <Text style={t.menuSection}>General</Text>

                    <View style={s.menuTileGrid}>
                      <MenuTile
                        icon="person-circle-outline"
                        label="View profile"
                        onPress={() => onThreadMenuAction("profile")}
                      />

                      <MenuTile
                        icon="folder-open-outline"
                        label="Media storage"
                        onPress={() =>
                          onThreadMenuAction("media-storage")
                        }
                      />
                    </View>
                  </View>

                  <View style={s.menuSectionBlock}>
                    <Text style={t.menuSection}>Member</Text>

                    <View style={s.menuTileGrid}>
                      <MenuTile
                        icon="calendar-outline"
                        label="Appointment"
                        onPress={() => onThreadMenuAction("appointment")}
                      />

                      <MenuTile
                        icon="information-circle-outline"
                        label="More About"
                        onPress={() =>
                          onThreadMenuAction(
                            "more-about"
                          )
                        }
                      />
                    </View>
                  </View>

                  <View style={s.menuSectionBlock}>
                    <Text style={t.menuSection}>Safety</Text>

                    <View style={s.menuTileGrid}>
                      <MenuTile
                        icon={
                          dmConversationSettings?.blockedByMe
                            ? "checkmark-circle-outline"
                            : "ban-outline"
                        }
                        label={
                          dmConversationSettings?.blockedByMe
                            ? "Unblock user"
                            : "Block user"
                        }
                        danger={!dmConversationSettings?.blockedByMe}
                        onPress={() => onThreadMenuAction("block")}
                      />

                      <MenuTile
                        icon="flag-outline"
                        label="Report user"
                        danger
                        onPress={() => onThreadMenuAction("report")}
                      />
                    </View>
                  </View>

                  <View style={s.menuSectionBlock}>
                    <Text style={t.menuSection}>Danger zone</Text>

                    <View style={s.menuTileGrid}>
                      <MenuTile
                        icon="trash-bin-outline"
                        label="Clear chat"
                        danger
                        onPress={() => onThreadMenuAction("clear")}
                      />

                      <MenuTile
                        icon="close-circle-outline"
                        label="Delete conversation"
                        danger
                        onPress={() => onThreadMenuAction("delete")}
                      />
                    </View>
                  </View>
                </View>
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

  dmSettingsDashboard: {
    width: "100%",
    paddingBottom: 24,
  } as ViewStyle,

  menuTileGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
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
    minHeight: 136,
    height: 136,
    flexShrink: 0,
    flexGrow: 0,
    borderRadius: 28,
    padding: 14,
    backgroundColor: "rgba(18,22,34,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "visible",
  } as ViewStyle,
  menuTileInner: {
    flex: 1,
    justifyContent: "space-between",
  } as ViewStyle,
  menuTileFullWidth: {
    width: "100%",
    minHeight: 136,
    height: 136,
    marginRight: 0,
    marginBottom: 0,
  } as ViewStyle,
  menuTileHalf: {
    width: "48%",
    minHeight: 136,
    height: 136,
    flexShrink: 0,
    flexGrow: 0,
  } as ViewStyle,
  menuTileMinistryCompact: {
    width: "100%",
    minHeight: 136,
    height: 136,
    flexShrink: 0,
    flexGrow: 0,
  } as ViewStyle,
  menuTileDanger: {
    backgroundColor: "rgba(80,18,28,0.22)",
    borderColor: "rgba(255,90,95,0.24)",
  } as ViewStyle,

  menuTileDisabled: {
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(15,18,28,0.92)",
  } as ViewStyle,
  menuTileLocked: {
    borderColor: "rgba(255,255,255,0.07)",
    backgroundColor: "rgba(12,15,24,0.94)",
  } as ViewStyle,
  menuTileRoleLocked: {
    borderColor: "rgba(244,208,111,0.40)",
    backgroundColor: "rgba(18,22,34,0.96)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.10,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  } as ViewStyle,
  menuTileRoleLockedPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.985 }],
  } as ViewStyle,
  menuTileIconWrapLocked: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  menuTileIconWrapRoleLocked: {
    backgroundColor: "rgba(217,179,95,0.10)",
    borderColor: "rgba(217,179,95,0.28)",
  } as ViewStyle,
  menuTileLockBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  menuTileLockBadgeText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
  } as TextStyle,
  menuTileRedLockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(239,68,68,0.16)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.55)",
    shadowColor: "#EF4444",
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  } as ViewStyle,
  menuTileRedLockPillText: {
    color: "#FF8A8A",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.35,
  } as TextStyle,
  menuTileLabelLocked: {
    color: "rgba(255,255,255,0.58)",
  } as TextStyle,
  menuTileLabelRoleLocked: {
    color: "rgba(255,255,255,0.94)",
    fontWeight: "900",
  } as TextStyle,
  menuTileV2Premium: {
    minHeight: 136,
    height: 136,
    flexShrink: 0,
    flexGrow: 0,
    overflow: "visible",
    borderColor: "rgba(244,208,111,0.46)",
    backgroundColor: "rgba(18,22,34,0.96)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  } as ViewStyle,
  menuTileV2Seal: {
    position: "absolute",
    top: 6,
    right: 6,
    alignItems: "center",
    gap: 4,
    zIndex: 3,
  } as ViewStyle,
  menuTileV2SealRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.16)",
    borderWidth: 2,
    borderColor: "rgba(248,113,113,0.55)",
    shadowColor: "#EF4444",
    shadowOpacity: 0.38,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  } as ViewStyle,
  menuTileV2SealLabel: {
    color: "#FF8A8A",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.55,
    textTransform: "uppercase",
  } as TextStyle,
  menuTileTopSpacer: {
    width: 30,
    height: 28,
  } as ViewStyle,
  menuTileLabelWrap: {
    flex: 1,
    justifyContent: "flex-end",
    paddingTop: 6,
  } as ViewStyle,
  menuTilePressed: {
    opacity: 0.96,
    transform: [{ scale: 0.985 }],
  } as ViewStyle,
  menuTileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    minHeight: 40,
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

  bubbleWrap: { marginBottom: 16, maxWidth: "88%" } as ViewStyle,
  bubbleWrapSelected: {
    borderRadius: 20,
  } as ViewStyle,
  bubbleSelectedGlow: {
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.72)",
    shadowColor: "#C4B5FD",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  } as ViewStyle,
  msgActionsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.72)",
  } as ViewStyle,
  msgActionsBackdrop: {
    ...StyleSheet.absoluteFillObject,
  } as ViewStyle,
  msgActionsSheet: {
    paddingHorizontal: 14,
    paddingBottom: 22,
  } as ViewStyle,
  msgActionsGlassOuter: {
    borderRadius: 22,
    overflow: "hidden",
    shadowColor: "#D9B35F",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 14,
  } as ViewStyle,
  msgActionsTopGlow: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.72)",
    zIndex: 3,
    shadowColor: "#F4D06F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
  } as ViewStyle,
  msgActionsGlass: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    borderTopColor: "rgba(244,208,111,0.38)",
    backgroundColor: "rgba(10,16,28,0.94)",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  } as ViewStyle,
  msgActionsHandle: {
    alignSelf: "center",
    width: 34,
    height: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginBottom: 8,
  } as ViewStyle,
  msgActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
  } as ViewStyle,
  msgActionRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  } as ViewStyle,
  msgActionRowPressed: {
    backgroundColor: "rgba(255,255,255,0.04)",
  } as ViewStyle,
  msgActionRowDanger: {} as ViewStyle,
  msgActionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.09)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
  } as ViewStyle,
  msgActionIconWrapDanger: {
    backgroundColor: "rgba(255,107,114,0.10)",
    borderColor: "rgba(255,107,114,0.22)",
  } as ViewStyle,
  messageSelectionBar: {
    marginTop: 8,
    marginHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(10,16,28,0.94)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
  } as ViewStyle,
  messageSelectionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  } as ViewStyle,
  messageSelectionBtnPressed: {
    opacity: 0.82,
  } as ViewStyle,
  messageSelectionDeleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,107,114,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,107,114,0.22)",
  } as ViewStyle,
  messageSelectionDeleteBtnDisabled: {
    opacity: 0.45,
  } as ViewStyle,

  churchLiveScheduleCardWrap: {
    alignSelf: "stretch",
    width: "100%",
    marginTop: 4,
    marginBottom: 10,
    overflow: "visible",
  } as ViewStyle,

  churchLiveScheduleCardShell: {
    width: "100%",
    alignSelf: "stretch",
    overflow: "visible",
  } as ViewStyle,

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
    maxWidth: "100%",
  } as ViewStyle,
  mineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    maxWidth: "100%",
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
  bubbleMineInline: {
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
    flexShrink: 0,
    overflow: "hidden",
  } as ViewStyle,
  avatarMiniRight: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    marginTop: 10,
    marginLeft: 10,
    flexShrink: 0,
    overflow: "hidden",
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

  attachBlock: { marginTop: 6, gap: 6 } as ViewStyle,
  attachImageWrap: {
    marginTop: 4,
    width: "100%",
    maxWidth: 240,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  } as ViewStyle,
  attachImagePreview: {
    width: "100%",
    height: 188,
    backgroundColor: "rgba(255,255,255,0.06)",
  } as ImageStyle,
  attachImageFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.28)",
  } as ViewStyle,
  attachFileCard: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.24)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
  } as ViewStyle,
  attachFileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  } as ViewStyle,
  attachFileCopy: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,
  attachPreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.88)",
  } as ViewStyle,
  attachPreviewPage: {
    width: GALLERY_W,
    height: GALLERY_H,
    justifyContent: "center",
    alignItems: "center",
  } as ViewStyle,
  attachPreviewPageInner: {
    width: GALLERY_W,
    height: GALLERY_H,
    justifyContent: "center",
    alignItems: "center",
  } as ViewStyle,
  galleryPlainImage: {
    width: "92%",
    height: "72%",
    backgroundColor: "rgba(8,10,18,0.96)",
  } as ImageStyle,
  galleryPlainPlaceholder: {
    position: "absolute",
    width: "72%",
    height: "58%",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  attachPreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
  } as ViewStyle,
  attachPreviewFullscreen: {
    width: "92%",
    height: "72%",
  } as ImageStyle,
  attachPreviewCounter: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  } as ViewStyle,
  attachPreviewThumbStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    backgroundColor: "rgba(0,0,0,0.28)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  attachPreviewThumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
  } as ViewStyle,
  attachPreviewThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: "hidden",
  } as ViewStyle,
  attachPreviewThumbIdle: {
    opacity: 0.42,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  } as ViewStyle,
  attachPreviewThumbActive: {
    opacity: 1,
    borderWidth: 2,
    borderColor: "rgba(217,179,95,0.95)",
    shadowColor: "#C4B5FD",
    shadowOpacity: 0.72,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  } as ViewStyle,
  attachPreviewThumbImg: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.06)",
  } as ImageStyle,
  attachPreviewClose: {
    position: "absolute",
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  } as ViewStyle,
  galleryNavBtn: {
    position: "absolute",
    top: "50%",
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  } as ViewStyle,
  galleryNavBtnLeft: {
    left: 12,
  } as ViewStyle,
  galleryNavBtnRight: {
    right: 12,
  } as ViewStyle,
  galleryNavBtnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
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

  pendingStrip: {
    maxHeight: 48,
    marginBottom: 6,
  } as ViewStyle,
  pendingStripContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
  } as ViewStyle,
  pendingChip: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    maxWidth: 220,
    paddingRight: 4,
    paddingLeft: 0,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  } as ViewStyle,
  pendingChipThumb: {
    width: 44,
    height: 44,
    backgroundColor: "rgba(255,255,255,0.06)",
  } as ImageStyle,
  pendingChipIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  pendingChipRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
    backgroundColor: "rgba(255,255,255,0.06)",
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
  attachImageHint: { color: "rgba(255,255,255,0.72)", fontWeight: "700", fontSize: 11 } as TextStyle,
  msgActionsTitle: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 0.2,
    marginBottom: 2,
    paddingHorizontal: 6,
  } as TextStyle,
  msgActionRowText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "800",
    fontSize: 15,
  } as TextStyle,
  msgActionRowTextDanger: {
    color: "#FF6B72",
  } as TextStyle,
  messageSelectionBtnText: {
    color: "rgba(255,255,255,0.82)",
    fontWeight: "800",
    fontSize: 13,
  } as TextStyle,
  messageSelectionCount: {
    color: "#F4D06F",
    fontWeight: "800",
    fontSize: 13,
  } as TextStyle,
  messageSelectionDeleteText: {
    color: "#FF6B72",
    fontWeight: "800",
    fontSize: 13,
  } as TextStyle,
  attachPreviewCounterText: {
    color: "rgba(255,255,255,0.78)",
    fontWeight: "700",
    fontSize: 12,
    letterSpacing: 0.3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as TextStyle,
  attachFileName: { color: "rgba(255,255,255,0.94)", fontWeight: "800", fontSize: 13, lineHeight: 17 } as TextStyle,
  attachFileMeta: { marginTop: 3, color: "rgba(255,255,255,0.52)", fontWeight: "700", fontSize: 11 } as TextStyle,

  input: { color: "white", fontWeight: "700", fontSize: 15, lineHeight: 21 } as TextStyle,

  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 } as TextStyle,
  emptySub: { marginTop: 6, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 12 } as TextStyle,

  pendingChipName: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 8,
    color: "rgba(255,255,255,0.82)",
    fontWeight: "700",
    fontSize: 11,
  } as TextStyle,

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
