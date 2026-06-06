import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Image, Pressable, StyleSheet, Dimensions, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { apiPost, getApiBase } from "@/src/lib/kristoApi";
import {
  feedClaimSchedule,
  feedJoinSlotQueue,
  feedUnclaimSchedule,
  isPastorClaimActor,
  resolveClaimFeedTarget,
} from "@/src/lib/homeFeedStore";
import { persistClaimToLiveRequest } from "@/src/lib/liveBridge";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  baseFeedId,
  cleanFeedLabel,
  formatSlotDateLabel,
  patchMediaSlotClaimAvatarFields,
  isClaimSlotDataUrlAvatar,
  resolveChurchHeaderAvatarUri,
  resolveClaimedUserAvatarUri,
  resolvePersistedClaimAvatarUri,
  resolveScheduleSlotVisualState,
  sanitizePersistedClaimAvatarUri,
  SLOT_STATE_THEMES,
} from "@/src/lib/scheduleSlotUtils";
import { loadProfileDraft } from "@/src/lib/profileStore";
import { fetchChurchMembers } from "@/src/lib/churchMembersApi";
import { ensureProfileAvatarUploadedBeforeClaim } from "@/src/lib/ensureProfileAvatarForClaim";
import {
  notifySlotClaimChanged,
  refreshSlotAfterClaimConflict,
} from "@/src/lib/slotClaimApply";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const GOLD = "#F7D36A";
const GOLD_SOFT = "rgba(247,211,106,0.22)";
const GOLD_BORDER = "rgba(247,211,106,0.42)";
const GOLD_GLASS = "rgba(247,211,106,0.14)";
const LIVE_PINK = "#FF375F";
const CARD_MIN_HEIGHT = Math.min(790, Math.max(720, Dimensions.get("window").height * 0.86));
const CARD_MIN_HEIGHT_COMPACT = Math.min(600, Math.max(520, Dimensions.get("window").height * 0.58));

function phaseEdgeTint(phase: string, claimed: boolean, isUnclaimedLiveOpen?: boolean) {
  if (isUnclaimedLiveOpen) return "rgba(255,55,95,0.13)";
  if (phase === "live") return "rgba(255,55,95,0.13)";
  if (claimed) return "rgba(167,139,250,0.11)";
  return "rgba(247,211,106,0.11)";
}

function PremiumSectionDivider({ unclaimed }: { unclaimed?: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.sectionDividerWrap, unclaimed && styles.sectionDividerWrapUnclaimed]}>
      <LinearGradient
        colors={[
          "transparent",
          "rgba(247,211,106,0.05)",
          "rgba(255,255,255,0.07)",
          "rgba(247,211,106,0.05)",
          "transparent",
        ]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.sectionDividerGradient}
      />
      <View style={styles.sectionDividerGlowCore} />
    </View>
  );
}

function userHasActiveChurchMembership(session?: { churchId?: string; activeChurchId?: string } | null) {
  return Boolean(String(session?.churchId || session?.activeChurchId || "").trim());
}

function resolveTitleFontSize(title: string) {
  const len = title.length;
  if (len > 52) return 22;
  if (len > 38) return 25;
  if (len > 28) return 28;
  if (len > 18) return 31;
  return 34;
}

function AvatarRing({
  uri,
  initial,
  size,
  accent,
  live,
  goldFallback,
  forceShowImage,
  allowDataUrl,
  imageLogMeta,
}: {
  uri?: string;
  initial: string;
  size: number;
  accent: string;
  live?: boolean;
  goldFallback?: boolean;
  forceShowImage?: boolean;
  allowDataUrl?: boolean;
  imageLogMeta?: {
    slotId?: string;
    claimedByUserId?: string;
    kind?: "live-host" | "claimed" | "church-header";
  };
}) {
  const pulse = useSharedValue(0);
  const [imageError, setImageError] = useState(false);

  const safeUri = useMemo(() => {
    const trimmed = String(uri || "").trim();
    if (!trimmed) return "";
    if (!allowDataUrl && isClaimSlotDataUrlAvatar(trimmed)) {
      if (trimmed && isClaimSlotDataUrlAvatar(trimmed)) {
        console.log("KRISTO_CLAIMED_SLOT_AVATAR_DATA_URL_REJECTED", {
          context: "AvatarRing-render",
          kind: imageLogMeta?.kind,
          byteLen: trimmed.length,
        });
      }
      return "";
    }
    return trimmed;
  }, [uri, allowDataUrl, imageLogMeta?.kind]);

  useEffect(() => {
    setImageError(false);
  }, [safeUri]);

  useEffect(() => {
    if (!live) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1400 })
      ),
      -1,
      false
    );
  }, [live, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: live ? 1 + pulse.value * 0.06 : 1 }],
    opacity: live ? 0.45 + pulse.value * 0.4 : 0.85,
  }));

  const liveHaloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: live ? 1.04 + pulse.value * 0.1 : 1 }],
    opacity: live ? 0.12 + pulse.value * 0.22 : 0,
  }));

  const outer = size + 14;
  const inner = size - 4;
  const imageLoadedEvent =
    imageLogMeta?.kind === "live-host"
      ? "KRISTO_LIVE_HOST_AVATAR_LOADED"
      : "KRISTO_CLAIMED_SLOT_AVATAR_IMAGE_LOADED";
  const imageErrorEvent =
    imageLogMeta?.kind === "live-host"
      ? "KRISTO_LIVE_HOST_AVATAR_ERROR"
      : "KRISTO_CLAIMED_SLOT_AVATAR_IMAGE_ERROR";
  const shouldRenderImage = Boolean(safeUri) && (!forceShowImage || !imageError);
  const showInitialFallback = Boolean(forceShowImage && imageError);
  const showInitialOnly = !safeUri && !forceShowImage;

  return (
    <View style={{ width: outer + (live ? 8 : 0), height: outer + (live ? 8 : 0), alignItems: "center", justifyContent: "center" }}>
      {live ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: outer + 10,
              height: outer + 10,
              borderRadius: (outer + 10) / 2,
              backgroundColor: accent,
            },
            liveHaloStyle,
          ]}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: 2,
            borderColor: goldFallback ? GOLD_BORDER : accent,
            shadowColor: goldFallback ? GOLD : accent,
            shadowOpacity: 0.55,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 0 },
          },
          ringStyle,
        ]}
      />
      <LinearGradient
        colors={
          goldFallback && !safeUri
            ? ["#F7D36A", "#D4A843", "#9A6B1F"]
            : [`${accent}55`, `${accent}18`, "rgba(255,255,255,0.06)"]
        }
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          padding: 2.5,
        }}
      >
        {shouldRenderImage ? (
          <View style={{ width: inner, height: inner, borderRadius: inner / 2, overflow: "hidden" }}>
            <Image
              source={{ uri: safeUri }}
              style={{ width: inner, height: inner, borderRadius: inner / 2 }}
              resizeMode="cover"
              onLoad={() => {
                if (!imageLogMeta) return;
                console.log(imageLoadedEvent, {
                  slotId: String(imageLogMeta.slotId || ""),
                  claimedByUserId: String(imageLogMeta.claimedByUserId || ""),
                  avatarUri: safeUri,
                });
              }}
              onError={() => {
                setImageError(true);
                if (!imageLogMeta) return;
                console.log(imageErrorEvent, {
                  slotId: String(imageLogMeta.slotId || ""),
                  claimedByUserId: String(imageLogMeta.claimedByUserId || ""),
                  avatarUri: safeUri,
                });
              }}
            />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(255,255,255,0.12)", "transparent", "rgba(0,0,0,0.18)"]}
              style={StyleSheet.absoluteFillObject}
            />
          </View>
        ) : showInitialFallback || showInitialOnly ? (
          <View
            style={{
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              backgroundColor: `${accent}33`,
            }}
          >
            <Text style={{ color: "#FFF", fontSize: size * 0.38, fontWeight: "900" }}>
              {initial}
            </Text>
          </View>
        ) : (
          <LinearGradient
            colors={
              goldFallback
                ? ["#FFE08A", "#F7D36A", "#C8943A", "#7A5218"]
                : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.08)", "rgba(0,0,0,0.12)"]
            }
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={{
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(255,255,255,0.28)", "transparent"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 0.45 }}
              style={StyleSheet.absoluteFillObject}
            />
            <Text style={{ color: goldFallback ? "#1A1205" : "#FFF", fontSize: size * 0.38, fontWeight: "900" }}>
              {initial}
            </Text>
          </LinearGradient>
        )}
      </LinearGradient>
    </View>
  );
}

function EnterLiveButtonGloss() {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [shimmer]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: 0.1 + shimmer.value * 0.16,
    transform: [{ translateX: -28 + shimmer.value * 56 }],
  }));

  return (
    <>
      <View pointerEvents="none" style={styles.hostEnterButtonTopSheen} />
      <Animated.View pointerEvents="none" style={[styles.hostEnterButtonShimmer, shimmerStyle]} />
    </>
  );
}

type SocialRailProps = {
  displayLiked?: boolean;
  likeCount?: number;
  localSaved?: boolean;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onToggleSave?: () => void;
  blendUnclaimed?: boolean;
};

function SocialActionRail({
  displayLiked,
  likeCount = 0,
  localSaved,
  onLike,
  onComment,
  onShare,
  onToggleSave,
  blendUnclaimed = false,
}: SocialRailProps) {
  if (!onLike && !onComment && !onShare && !onToggleSave) return null;

  const items = [
    onLike
      ? {
          key: "like",
          onPress: onLike,
          icon: displayLiked ? "heart" : "heart-outline",
          iconColor: displayLiked ? "#FF4D6D" : "#FFFFFF",
          label: String(likeCount || 0),
        }
      : null,
    onComment
      ? {
          key: "chat",
          onPress: onComment,
          icon: "chatbubble-outline",
          iconColor: "#FFFFFF",
          label: "Chat",
        }
      : null,
    onShare
      ? {
          key: "share",
          onPress: onShare,
          icon: "arrow-redo-outline",
          iconColor: "#FFFFFF",
          label: "Share",
        }
      : null,
    onToggleSave
      ? {
          key: "save",
          onPress: onToggleSave,
          icon: localSaved ? "bookmark" : "bookmark-outline",
          iconColor: localSaved ? GOLD : "#FFFFFF",
          label: "Save",
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    onPress: () => void;
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    label: string;
  }>;

  return (
    <View style={[styles.actionRail, blendUnclaimed && styles.actionRailUnclaimed]}>
      <LinearGradient
        colors={
          blendUnclaimed
            ? ["rgba(10,12,18,0.82)", "rgba(8,10,16,0.78)", "rgba(6,8,14,0.84)"]
            : ["rgba(18,20,28,0.92)", "rgba(10,12,18,0.88)", "rgba(6,8,14,0.94)"]
        }
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={
          blendUnclaimed
            ? ["rgba(255,255,255,0.05)", "rgba(247,211,106,0.04)", "transparent"]
            : ["rgba(255,255,255,0.06)", "transparent", "rgba(247,211,106,0.04)"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={[styles.actionRailHighlight, blendUnclaimed && styles.actionRailHighlightUnclaimed]} />
      {blendUnclaimed ? (
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,255,255,0.04)", "transparent"]}
          style={styles.actionRailAmbientReflection}
        />
      ) : null}
      {blendUnclaimed ? (
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", "rgba(0,0,0,0.08)"]}
          style={styles.actionRailEdgeFadeUnclaimed}
        />
      ) : null}
      <View style={[styles.actionRailRow, blendUnclaimed && styles.actionRailRowUnclaimed]}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            style={({ pressed }) => [styles.actionRailItem, pressed && styles.pressed]}
            hitSlop={6}
          >
            <View style={styles.actionRailIconWrap}>
              <LinearGradient
                colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0.05)", "rgba(0,0,0,0.28)"]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View pointerEvents="none" style={styles.actionRailIconRing} />
              <Ionicons name={item.icon} size={22} color={item.iconColor} />
            </View>
            <Text style={styles.actionRailLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export type HomeLiveScheduleCardProps = {
  item: any;
  activeSlot: any;
  slotFeedIndex: number;
  slotFeedTotal: number;
  nowMs: number;
  isActive: boolean;
  fullBleed?: boolean;
  profileName?: string;
  profileAvatarUri?: string;
  onSkipSlots?: () => void;
  /** Home Feed expanded slot cards — scroll feed instead of in-card carousel. */
  disableSlotCarousel?: boolean;
  onOpenLiveRoom?: () => void;
  onOptimisticClaim?: (params: {
    postId: string;
    slotId: string;
    claim: { userId: string; name: string; role: string; avatarUri: string };
  }) => void;
  displayLiked?: boolean;
  likeCount?: number;
  localSaved?: boolean;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onToggleSave?: () => void;
};

export const HomeLiveScheduleCard = memo(function HomeLiveScheduleCard({
  item,
  activeSlot,
  slotFeedIndex,
  slotFeedTotal,
  nowMs,
  fullBleed = false,
  profileName,
  profileAvatarUri,
  onSkipSlots,
  disableSlotCarousel = false,
  onOpenLiveRoom,
  onOptimisticClaim,
  displayLiked,
  likeCount = 0,
  localSaved,
  onLike,
  onComment,
  onShare,
  onToggleSave,
}: HomeLiveScheduleCardProps) {
  const apiBase = getApiBase();
  const session = getSessionSync() as any;
  const currentUserId = String(session?.userId || "");

  const [optimisticClaim, setOptimisticClaim] = useState<any>(null);
  const [isClaimInFlight, setIsClaimInFlight] = useState(false);
  const claimingSlotRef = useRef<string | null>(null);
  const claimPress = useSharedValue(1);
  const [memberAvatarByUserId, setMemberAvatarByUserId] = useState<Record<string, string>>({});
  const [claimerProfileAvatar, setClaimerProfileAvatar] = useState("");

  const slotVisual = useMemo(
    () =>
      resolveScheduleSlotVisualState(activeSlot, slotFeedIndex, nowMs, {
        optimisticClaim,
        slotId: String(activeSlot?.id || ""),
      }),
    [activeSlot, slotFeedIndex, nowMs, optimisticClaim]
  );

  const slot = slotVisual?.enriched || (activeSlot as any);
  const claimed = Boolean(slotVisual?.claimed);
  const phase = slotVisual?.phase || "open";

  useEffect(() => {
    let alive = true;
    fetchChurchMembers()
      .then((members) => {
        if (!alive || !Array.isArray(members)) return;
        const map: Record<string, string> = {};
        for (const member of members) {
          const userId = String(member?.userId || member?.id || "").trim();
          const avatar = String(
            member?.avatarUri ||
              member?.avatarUrl ||
              member?.profileImage ||
              member?.photoURL ||
              member?.image ||
              ""
          ).trim();
          if (userId && avatar) {
            const sanitized = sanitizePersistedClaimAvatarUri(avatar, "home-live-member-cache");
            if (sanitized) map[userId] = sanitized;
          }
        }
        setMemberAvatarByUserId(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const claimedBy =
    optimisticClaim ||
    slot?.claimedBy ||
    activeSlot?.claimedBy ||
    (slot?.claimedByUserId || activeSlot?.claimedByUserId
      ? {
          userId: slot?.claimedByUserId || activeSlot?.claimedByUserId,
          name: slot?.claimedByName || activeSlot?.claimedByName || "Host",
          role: "Member",
          avatarUri:
            activeSlot?.claimedByAvatarUri ||
            activeSlot?.claimedByAvatar ||
            activeSlot?.claimedByPhotoUrl ||
            slot?.claimedByAvatarUri ||
            slot?.claimedByAvatar ||
            slot?.claimedByPhotoUrl ||
            slot?.claimedBy?.avatarUri ||
            activeSlot?.claimedBy?.avatarUri ||
            "",
        }
      : null);

  const claimUserId = String(
    claimedBy?.userId || slot?.claimedByUserId || activeSlot?.claimedByUserId || ""
  ).trim();

  useEffect(() => {
    let alive = true;
    if (!claimUserId) {
      setClaimerProfileAvatar("");
      return () => {
        alive = false;
      };
    }
    loadProfileDraft(claimUserId)
      .then((draft) => {
        if (!alive) return;
        setClaimerProfileAvatar(
          sanitizePersistedClaimAvatarUri(draft?.avatarUri, "claimer-profile-draft")
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [claimUserId]);

  const slotForAvatar = useMemo(() => {
    const claimedByObj =
      typeof activeSlot?.claimedBy === "object" && activeSlot?.claimedBy
        ? activeSlot.claimedBy
        : typeof slot?.claimedBy === "object" && slot?.claimedBy
          ? slot.claimedBy
          : null;
    const mergedBase = {
      ...(activeSlot || {}),
      ...(slot || {}),
      claimedByUserId:
        claimUserId ||
        slot?.claimedByUserId ||
        activeSlot?.claimedByUserId ||
        claimedByObj?.userId ||
        "",
      claimedByName:
        claimedBy?.name ||
        slot?.claimedByName ||
        activeSlot?.claimedByName ||
        "",
      claimedBy:
        claimedBy ||
        claimedByObj ||
        (claimUserId
          ? {
              userId: claimUserId,
              name: claimedBy?.name || slot?.claimedByName || "Host",
              role: claimedBy?.role || "Member",
              avatarUri:
                activeSlot?.claimedByAvatarUri ||
                activeSlot?.claimedByAvatar ||
                activeSlot?.claimedByPhotoUrl ||
                slot?.claimedByAvatarUri ||
                slot?.claimedByAvatar ||
                slot?.claimedByPhotoUrl ||
                claimedBy?.avatarUri ||
                claimedByObj?.avatarUri ||
                "",
            }
          : null),
    };
    const persistedAvatar =
      resolvePersistedClaimAvatarUri(activeSlot) ||
      resolvePersistedClaimAvatarUri(slot) ||
      resolvePersistedClaimAvatarUri(mergedBase) ||
      (claimUserId ? memberAvatarByUserId[claimUserId] : "") ||
      claimerProfileAvatar ||
      "";

    if (!optimisticClaim) {
      return patchMediaSlotClaimAvatarFields(mergedBase, persistedAvatar);
    }

    const avatarUri = String(optimisticClaim.avatarUri || persistedAvatar || "").trim();
    return patchMediaSlotClaimAvatarFields(
      {
        ...mergedBase,
        claimedByUserId: optimisticClaim.userId,
        claimedByName: optimisticClaim.name,
        claimedBy: optimisticClaim,
      },
      avatarUri
    );
  }, [
    activeSlot,
    slot,
    optimisticClaim,
    claimUserId,
    claimedBy,
    memberAvatarByUserId,
    claimerProfileAvatar,
  ]);

  const claimedAvatarResolution = useMemo(
    () =>
      resolveClaimedUserAvatarUri({
        slot: slotForAvatar,
        slotId: String(slot?.id || activeSlot?.id || ""),
        apiBase,
        profileAvatarByUserId:
          claimUserId && claimerProfileAvatar ? { [claimUserId]: claimerProfileAvatar } : {},
        memberAvatarByUserId,
        sessionAvatarUri:
          sanitizePersistedClaimAvatarUri(session?.avatarUrl, "claimed-session-url") ||
          sanitizePersistedClaimAvatarUri(session?.avatarUri, "claimed-session-uri") ||
          sanitizePersistedClaimAvatarUri(session?.profileImage, "claimed-session-profileImage") ||
          sanitizePersistedClaimAvatarUri(profileAvatarUri, "claimed-profile-prop") ||
          "",
        sessionUserId: currentUserId,
      }),
    [
      slotForAvatar,
      slot?.id,
      activeSlot?.id,
      apiBase,
      claimUserId,
      claimerProfileAvatar,
      memberAvatarByUserId,
      session,
      profileAvatarUri,
      currentUserId,
    ]
  );

  const resolvedClaimedAvatarUri = claimedAvatarResolution.uri;
  const liveHostHasAvatar = claimedAvatarResolution.hasAvatar;

  useEffect(() => {
    if (!claimed) return;

    console.log("KRISTO_CLAIMED_HOST_AVATAR_RENDER", {
      slotId: String(slot?.id || activeSlot?.id || ""),
      claimedByUserId: claimUserId,
      claimedByName: String(
        claimedBy?.name || slot?.claimedByName || activeSlot?.claimedByName || ""
      ),
      avatarUri: resolvedClaimedAvatarUri,
      hasAvatar: liveHostHasAvatar,
      isAbsolute: /^https?:\/\//i.test(resolvedClaimedAvatarUri),
      phase,
      source: claimedAvatarResolution.source,
    });
  }, [
    claimed,
    slot?.id,
    activeSlot?.id,
    claimUserId,
    claimedBy?.name,
    slot?.claimedByName,
    activeSlot?.claimedByName,
    claimedAvatarResolution.source,
    resolvedClaimedAvatarUri,
    liveHostHasAvatar,
    phase,
  ]);

  useEffect(() => {
    if (!claimed || !liveHostHasAvatar) return;

    const rawAvatarUri = String(claimedAvatarResolution.uri || "").trim();
    const avatarUri = String(resolvedClaimedAvatarUri || rawAvatarUri).trim();

    console.log("KRISTO_CLAIMED_SLOT_AVATAR_IMAGE_RENDER", {
      slotId: String(slot?.id || activeSlot?.id || ""),
      claimedByUserId: claimUserId,
      avatarUri,
      rawAvatarUri,
      isAbsolute: /^https?:\/\//i.test(avatarUri),
      startsWithUploads: /^\/?uploads\//i.test(rawAvatarUri),
      source: claimedAvatarResolution.source,
      hasAvatar: liveHostHasAvatar,
    });
  }, [
    claimed,
    liveHostHasAvatar,
    slot?.id,
    activeSlot?.id,
    claimUserId,
    claimedAvatarResolution.uri,
    claimedAvatarResolution.source,
    resolvedClaimedAvatarUri,
  ]);

  const claimedByMe = !!claimUserId && claimUserId === currentUserId;
  const claimedByOther = !!claimUserId && claimUserId !== currentUserId;

  const theme = SLOT_STATE_THEMES[phase];

  const isLiveWindow = slot.startMs > 0 && slot.startMs <= nowMs && slot.endMs > nowMs;
  const isUnclaimedLiveOpen = isLiveWindow && !claimed;
  const isUnclaimedOpen = !claimed && (phase === "open" || phase === "upcoming");
  const compactUnclaimedLayout = isUnclaimedOpen || isUnclaimedLiveOpen;
  const visualTheme = isUnclaimedLiveOpen ? { ...theme, label: "LIVE NOW • OPEN" } : theme;

  useEffect(() => {
    if (!__DEV__) return;
    console.log("KRISTO_HOME_SLOT_VISUAL_STATE", {
      slotId: slot?.id,
      slotNumber: Number((slot as any)?.slot || (slot as any)?.slotNumber || slotFeedIndex + 1),
      startMs: slotVisual?.startMs ?? slot?.startMs,
      endMs: slotVisual?.endMs ?? slot?.endMs,
      claimed,
      phase,
      isLiveWindow,
      isUnclaimedLiveOpen,
    });
  }, [
    slot?.id,
    slotFeedIndex,
    claimed,
    phase,
    isLiveWindow,
    isUnclaimedLiveOpen,
    slot,
    slotVisual?.startMs,
    slotVisual?.endMs,
  ]);

  const mediaName = cleanFeedLabel(item?.mediaName || item?.actorLabel, "Kristo Media");
  const churchName = cleanFeedLabel(item?.churchName || item?.churchLabel, "MY CHURCH");
  const churchShort = churchName.replace(/\s+CHURCH$/i, "").trim() || churchName;
  const mediaSubtitle = `${mediaName} • Church Media`;

  const churchHeaderAvatar = useMemo(
    () =>
      resolveChurchHeaderAvatarUri(item, apiBase, {
        sessionChurchAvatarUri: String(
          session?.churchAvatarUri || session?.churchAvatarUrl || ""
        ).trim(),
      }),
    [item, apiBase, session?.churchAvatarUri, session?.churchAvatarUrl]
  );
  const churchHeaderInitial =
    churchShort.slice(0, 1).toUpperCase() || churchName.slice(0, 1).toUpperCase() || "C";

  useEffect(() => {
    console.log("KRISTO_MEDIA_CARD_AVATAR_RENDER", {
      churchName: churchShort,
      mediaName,
      avatarUri: churchHeaderAvatar.uri,
      source: churchHeaderAvatar.source,
      hasAvatar: churchHeaderAvatar.hasAvatar,
      isDataUrl: isClaimSlotDataUrlAvatar(churchHeaderAvatar.uri),
    });
  }, [churchShort, mediaName, churchHeaderAvatar.uri, churchHeaderAvatar.source, churchHeaderAvatar.hasAvatar]);

  const slotTitle = String(slot?.name || slot?.slotLabel || "Live Slot").trim();
  const slotTopic = cleanFeedLabel(
    slot?.script || slot?.task || slot?.role || item?.topic || item?.body,
    "Live media topic"
  )
    .split("\n")
    .join(" ")
    .trim();

  const msUntilStart = slot.startMs > 0 ? slot.startMs - nowMs : null;
  const minutesToStart = msUntilStart !== null ? Math.ceil(msUntilStart / 60000) : null;
  const msRemaining = slot.endMs > nowMs ? slot.endMs - nowMs : 0;
  const progress =
    slot.startMs > 0 && slot.endMs > slot.startMs
      ? Math.max(0, Math.min(1, (nowMs - slot.startMs) / (slot.endMs - slot.startMs)))
      : 0;

  const countdownLabel = isUnclaimedLiveOpen
    ? msRemaining > 60000
      ? `Ends in ${Math.ceil(msRemaining / 60000)}m`
      : msRemaining > 0
        ? "Live now"
        : "Ending soon"
    : phase === "live"
      ? msRemaining > 60000
        ? `${Math.ceil(msRemaining / 60000)}m left`
        : "Ending soon"
      : minutesToStart === null
        ? "Ready"
        : minutesToStart > 60
          ? `${Math.floor(minutesToStart / 60)}h ${minutesToStart % 60}m left`
          : minutesToStart > 1
            ? `${minutesToStart}m left`
            : minutesToStart === 1
              ? "1m left"
              : "Starting now";

  const claimCtaText = isUnclaimedLiveOpen ? "Claim & Go Live" : "Claim This Live Slot";

  const titleFontSize = useMemo(() => resolveTitleFontSize(slotTitle), [slotTitle]);
  const titleLineHeight = titleFontSize + 6;

  const claimBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: claimPress.value }],
  }));

  const claimThisSlot = useCallback(async () => {
    if (!userHasActiveChurchMembership(session)) return;
    if (claimed || !slot?.id) return;
    if (claimingSlotRef.current === slot.id || isClaimInFlight) return;

    claimingSlotRef.current = String(slot.id);
    setIsClaimInFlight(true);
    claimPress.value = withSequence(withSpring(0.94), withSpring(1));

    const uploadedClaimAvatar = await ensureProfileAvatarUploadedBeforeClaim({
      userId: currentUserId,
      session,
      profileAvatarUri,
    });

    const seedId = baseFeedId(String(item?.sourceScheduleId || item?.id || ""));
    const claimTarget = resolveClaimFeedTarget(seedId);
    const slotId = String(slot.id);
    const slotNumber = Number((slot as any)?.slot || (slot as any)?.slotNumber || (slot as any)?.order || 0);
    const isPastorClaim = isPastorClaimActor(currentUserId, item);

    if (isPastorClaim) {
      console.log("KRISTO_PASTOR_CLAIM_ALLOWED", {
        seedId: claimTarget.seedId,
        apiFeedId: claimTarget.apiFeedId,
        slotId,
        userId: currentUserId,
      });
    }

    const claimAvatarUri =
      uploadedClaimAvatar ||
      sanitizePersistedClaimAvatarUri(memberAvatarByUserId[currentUserId], "claim-member-cache") ||
      sanitizePersistedClaimAvatarUri(profileAvatarUri, "claim-profile-prop") ||
      sanitizePersistedClaimAvatarUri(session?.avatarUrl, "claim-session-url") ||
      sanitizePersistedClaimAvatarUri(session?.avatarUri, "claim-session-uri") ||
      sanitizePersistedClaimAvatarUri(session?.profileImage, "claim-session-profileImage") ||
      "";
    const claim = {
      slotId,
      userId: currentUserId,
      name: String(
        session?.displayName || session?.fullName || session?.name || profileName || (isPastorClaim ? "Pastor" : "Church Member")
      ).trim(),
      role: isPastorClaim ? "Pastor" : String(session?.role || "Member"),
      avatarUri: claimAvatarUri,
      claimedByAvatarUri: claimAvatarUri,
      claimedByPhotoUrl: claimAvatarUri,
      startMs: Number(slot.startMs || 0),
      endMs: Number(slot.endMs || 0),
      slotNumber: slotNumber || Number((slot as any).slot || (slot as any).slotNumber || 0),
      churchId: String(item?.churchId || session?.churchId || ""),
      slot,
      item,
    };

    setOptimisticClaim(claim);
    feedClaimSchedule(seedId, claim);
    onOptimisticClaim?.({ postId: claimTarget.apiFeedId, slotId, claim });

    const claimHeaders = getKristoHeaders({
      userId: session?.userId || "",
      role: (session?.role || "Member") as any,
      churchId: session?.churchId || "",
    }) as Record<string, string>;

    if (!isPastorClaim) {
      void persistClaimToLiveRequest({
        liveId: claimTarget.liveBridgeId,
        slotId,
        slot: slotNumber || undefined,
        userId: currentUserId,
        name: claim.name,
        avatar: claimAvatarUri || claim.name.slice(0, 1).toUpperCase(),
        headers: claimHeaders,
      }).catch(() => {});
    }

    void apiPost(
      "/api/church/feed",
      { action: "claim_schedule_slot", postId: claimTarget.apiFeedId, slotId, claim },
      {
        headers: claimHeaders,
      }
    )
      .then(async (res: any) => {
        const churchId = String(item?.churchId || session?.churchId || "").trim();
        const isConflict =
          Number(res?.status || 0) === 409 ||
          String(res?.error || "")
            .toLowerCase()
            .includes("already claimed");

        if (isConflict) {
          setOptimisticClaim(null);
          feedUnclaimSchedule(seedId, {
            slotId,
            userId: currentUserId,
            skipBackendSync: true,
          });
          Alert.alert(
            "Slot already claimed",
            "Slot already claimed by another member"
          );
          if (churchId) {
            await refreshSlotAfterClaimConflict({
              churchId,
              postId: claimTarget.apiFeedId,
              slotId,
            });
          }
          return;
        }

        if (res?.ok === false || res?.error) {
          throw new Error(String(res?.error || "claim failed"));
        }

        if (isPastorClaim) {
          console.log("KRISTO_PASTOR_CLAIM_PERSISTED", {
            seedId: claimTarget.seedId,
            apiFeedId: claimTarget.apiFeedId,
            slotId,
            userId: currentUserId,
            ok: res?.ok !== false,
          });
        } else {
          console.log("KRISTO_MEDIA_CLAIM_PERSISTED", {
            seedId: claimTarget.seedId,
            apiFeedId: claimTarget.apiFeedId,
            slotId,
            userId: currentUserId,
            ok: res?.ok !== false,
          });
        }

        console.log("KRISTO_SLOT_CLAIM_SUCCESS", {
          stage: "backend-persisted",
          churchId,
          postId: claimTarget.apiFeedId,
          slotId,
          userId: currentUserId,
        });

        const backendSlot = res?.slot;
        const backendAvatar =
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedByAvatarUri, "claim-api-slot") ||
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedByAvatar, "claim-api-slot") ||
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedByPhotoUrl, "claim-api-slot") ||
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedBy?.avatarUri, "claim-api-slot") ||
          "";
        if (backendAvatar) {
          feedClaimSchedule(seedId, {
            ...claim,
            avatarUri: backendAvatar,
            claimedByAvatarUri: backendAvatar,
            claimedByPhotoUrl: backendAvatar,
          });
        }

        if (churchId) {
          notifySlotClaimChanged(
            {
              churchId,
              postId: claimTarget.apiFeedId,
              slotId,
              action: "claim",
              userId: currentUserId,
              source: "claim-api-success",
            },
            { fastSync: true }
          );
        }
      })
      .catch((error) => {
        console.log("KRISTO_CLAIM_BACKEND_SYNC_ERROR", {
          seedId: claimTarget.seedId,
          apiFeedId: claimTarget.apiFeedId,
          localAliasId: claimTarget.localAliasId,
          slotId,
          userId: currentUserId,
          isPastorClaim,
          keepLocalClaim: true,
          error: String((error as any)?.message || error),
        });
      })
      .finally(() => {
        claimingSlotRef.current = null;
        setIsClaimInFlight(false);
      });
  }, [
    session,
    claimed,
    isClaimInFlight,
    slot?.id,
    item,
    currentUserId,
    profileName,
    profileAvatarUri,
    memberAvatarByUserId,
    onOptimisticClaim,
    claimPress,
  ]);

  const handleClaimPress = useCallback(() => {
    if (phase === "live" && claimedByMe) {
      onOpenLiveRoom?.();
      return;
    }
    if (claimedByOther) {
      feedJoinSlotQueue(baseFeedId(String(item?.sourceScheduleId || item?.id || "")), {
        slotId: slot.id,
        userId: currentUserId,
        name: profileName || "Member",
        role: session?.role || "Member",
        avatarUri: profileAvatarUri || "",
      });
      return;
    }
    if (claimedByMe) {
      feedUnclaimSchedule(baseFeedId(String(item?.sourceScheduleId || item?.id || "")), {
        slotId: slot.id,
        userId: currentUserId,
      });
      setOptimisticClaim(null);
      return;
    }
    claimThisSlot();
  }, [
    phase,
    claimedByMe,
    claimedByOther,
    onOpenLiveRoom,
    item,
    slot.id,
    currentUserId,
    profileName,
    profileAvatarUri,
    session?.role,
    claimThisSlot,
  ]);

  const showPrimaryClaim = !claimed && phase !== "ended" && !isClaimInFlight;
  const showSecondaryClaim = claimed && phase !== "ended";
  const compactOpenCard = !claimed && phase !== "ended";
  const edgeTint = phaseEdgeTint(phase, claimed, isUnclaimedLiveOpen);

  if (!slotVisual || slotVisual.expired) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeIn.duration(280)}
      style={[
        styles.frame,
        fullBleed && styles.frameFullBleed,
        fullBleed && compactOpenCard && styles.frameFullBleedCompact,
      ]}
    >
      <View
        style={[
          styles.card,
          fullBleed && (compactOpenCard ? styles.cardCompact : styles.cardTall),
          { borderColor: visualTheme.border, shadowColor: visualTheme.glow },
        ]}
      >
        <LinearGradient colors={["#080A10", "#111520", "#070910"]} style={StyleSheet.absoluteFillObject} />
        <LinearGradient
          colors={[visualTheme.gradient[0], visualTheme.gradient[1], visualTheme.gradient[2]]}
          style={[StyleSheet.absoluteFillObject, { opacity: 0.72 }]}
        />
        <LinearGradient
          colors={["rgba(247,211,106,0.08)", "transparent", "rgba(255,255,255,0.02)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          pointerEvents="none"
          style={[
            styles.glowOrbTop,
            { backgroundColor: GOLD_SOFT },
            isUnclaimedOpen && styles.glowOrbTopUnclaimed,
            isUnclaimedLiveOpen && styles.glowOrbTopLiveOpen,
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.glowOrbBottom,
            { backgroundColor: isUnclaimedLiveOpen ? "rgba(255,55,95,0.32)" : visualTheme.glow },
          ]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0.02)", "transparent"]}
          style={styles.cardTopSheen}
        />
        <View pointerEvents="none" style={styles.cardInnerRim} />
        <View pointerEvents="none" style={styles.cardEdgeGlowLayer}>
          <LinearGradient
            colors={[edgeTint, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardEdgeGlowTL}
          />
          <LinearGradient
            colors={[edgeTint, "transparent"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.cardEdgeGlowTR}
          />
          <LinearGradient
            colors={[edgeTint, "transparent"]}
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 0 }}
            style={styles.cardEdgeGlowBL}
          />
          <LinearGradient
            colors={[edgeTint, "transparent"]}
            start={{ x: 1, y: 1 }}
            end={{ x: 0, y: 0 }}
            style={styles.cardEdgeGlowBR}
          />
        </View>

        <View style={[styles.cardInner, compactOpenCard && styles.cardInnerCompact]}>
          <Animated.View
            entering={FadeInDown.duration(300)}
            style={[styles.headerSection, compactUnclaimedLayout && styles.headerSectionUnclaimed]}
          >
            <View style={styles.headerTopRow}>
              <AvatarRing
                uri={churchHeaderAvatar.uri}
                initial={churchHeaderInitial}
                size={68}
                accent={visualTheme.accent}
                live={phase === "live"}
                goldFallback={!isUnclaimedLiveOpen}
                allowDataUrl
                forceShowImage={churchHeaderAvatar.hasAvatar}
                imageLogMeta={{ kind: "church-header" }}
              />
              <View style={styles.headerTextBlock}>
                <Text style={styles.mediaName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {churchShort}
                </Text>
                <Text style={styles.churchSubline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                  {mediaSubtitle}
                </Text>
                <View style={styles.badgeRow}>
                  <View style={styles.liveSchedulePill}>
                    <LinearGradient
                      colors={[GOLD_GLASS, "rgba(255,255,255,0.05)", "rgba(0,0,0,0.12)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <Ionicons name="radio" size={10} color={GOLD} />
                    <Text style={styles.liveSchedulePillText} numberOfLines={1} ellipsizeMode="tail">
                      LIVE SCHEDULE
                    </Text>
                  </View>
                  <View style={styles.verifiedBadge}>
                    <LinearGradient
                      colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.02)", "rgba(0,0,0,0.14)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <Ionicons name="shield-checkmark" size={10} color={GOLD} />
                    <Text style={styles.verifiedBadgeText} numberOfLines={1}>
                      VERIFIED
                    </Text>
                  </View>
                </View>
              </View>
              {disableSlotCarousel ? (
                <View style={styles.slotCounter}>
                  <Text style={styles.slotCounterText}>
                    Slot {slotFeedIndex + 1}/{slotFeedTotal}
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={onSkipSlots}
                  style={({ pressed }) => [styles.slotCounter, pressed && styles.pressed]}
                >
                  <Text style={styles.slotCounterText}>
                    {slotFeedIndex + 1}/{slotFeedTotal}
                  </Text>
                  <Ionicons name="play-skip-forward" size={14} color={GOLD} />
                </Pressable>
              )}
            </View>
          </Animated.View>

          <PremiumSectionDivider unclaimed={compactUnclaimedLayout} />

          <View style={[styles.bodySection, compactUnclaimedLayout && styles.bodySectionUnclaimed]}>
            <View style={[styles.stateRow, compactUnclaimedLayout && styles.stateRowUnclaimed]}>
              <View
                style={[
                  styles.statePill,
                  isUnclaimedLiveOpen && styles.statePillLiveOpen,
                  {
                    borderColor: isUnclaimedLiveOpen ? "rgba(255,120,150,0.45)" : "rgba(255,255,255,0.08)",
                    backgroundColor: `${visualTheme.accent}14`,
                  },
                ]}
              >
                {phase === "live" ? <View style={[styles.liveDot, { backgroundColor: visualTheme.accent }]} /> : null}
                <Text style={[styles.statePillText, { color: visualTheme.accent }]}>{visualTheme.label}</Text>
              </View>
            </View>

            <View style={[styles.titleBlock, compactUnclaimedLayout && styles.titleBlockUnclaimed]}>
              <Text
                style={[styles.slotTitle, { fontSize: titleFontSize, lineHeight: titleLineHeight }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {slotTitle}
              </Text>
              {!!slotTopic ? (
                <Text style={styles.slotTopic} numberOfLines={2}>
                  {slotTopic}
                </Text>
              ) : null}
            </View>

            <View style={[styles.metaRow, compactUnclaimedLayout && styles.metaRowUnclaimed]}>
              <View style={styles.metaChip}>
                <Ionicons name="calendar-outline" size={15} color={GOLD} />
                <Text style={styles.metaText}>{formatSlotDateLabel(slot.meetingDate, slot.meetingDay)}</Text>
              </View>
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={15} color={GOLD} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {slot.startTime}
                  {slot.endTime ? ` – ${slot.endTime}` : ""}
                </Text>
              </View>
            </View>

            {compactUnclaimedLayout ? (
              <View pointerEvents="none" style={styles.contentAmbientGlow}>
                <LinearGradient
                  colors={
                    isUnclaimedLiveOpen
                      ? ["transparent", "rgba(255,55,95,0.08)", "transparent"]
                      : ["transparent", "rgba(247,211,106,0.06)", "transparent"]
                  }
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFillObject}
                />
              </View>
            ) : null}

            <View style={[styles.progressSection, compactUnclaimedLayout && styles.progressSectionUnclaimed]}>
              <View style={[styles.progressTrack, { shadowColor: visualTheme.accent }]}>
                <View style={[styles.progressFillGlow, { width: `${Math.round(progress * 100)}%`, shadowColor: visualTheme.accent }]}>
                  <LinearGradient
                    colors={["rgba(255,255,255,0.22)", visualTheme.accent, `${visualTheme.accent}CC`, visualTheme.accent]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.progressFill}
                  />
                </View>
              </View>
              <View style={styles.progressFooter}>
                <Text style={[styles.countdown, isUnclaimedLiveOpen && styles.countdownLiveOpen]}>{countdownLabel}</Text>
                <Text style={styles.progressSlotHint}>
                  Slot {slotFeedIndex + 1} of {slotFeedTotal}
                </Text>
              </View>
            </View>

            {claimed ? (
              <View style={styles.hostSectionWrap}>
                <View pointerEvents="none" style={[styles.hostSectionGlow, { backgroundColor: theme.glow }]} />
                <Animated.View entering={FadeInDown.duration(240)} style={styles.hostSection}>
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.06)", "transparent"]}
                  style={styles.hostSectionTopSheen}
                />
                <View style={styles.hostHeaderRow}>
                  <Text style={[styles.hostKicker, { color: theme.accent }]}>
                    {phase === "live" ? "LIVE HOST" : "CLAIMED BY"}
                  </Text>
                  {phase === "live" ? (
                    <View style={[styles.liveBadge, { shadowColor: LIVE_PINK }]}>
                      <LinearGradient
                        colors={["rgba(255,55,95,0.55)", "rgba(255,55,95,0.28)", "rgba(255,255,255,0.10)"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                      <View style={[styles.liveDot, { backgroundColor: "#FFF" }]} />
                      <Text style={styles.liveBadgeText}>ON AIR</Text>
                    </View>
                  ) : (
                    <View style={[styles.claimedBadge, { borderColor: theme.border }]}>
                      <LinearGradient
                        colors={[`${theme.accent}28`, `${theme.accent}12`, "rgba(0,0,0,0.18)"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                      <Text style={[styles.claimedBadgeText, { color: theme.accent }]}>CLAIMED</Text>
                    </View>
                  )}
                </View>
                <View style={styles.hostRow}>
                  <AvatarRing
                    uri={resolvedClaimedAvatarUri}
                    initial={String(
                      claimedBy?.name || slot?.claimedByName || activeSlot?.claimedByName || "H"
                    )
                      .slice(0, 1)
                      .toUpperCase()}
                    size={58}
                    accent={theme.accent}
                    live={phase === "live"}
                    forceShowImage={liveHostHasAvatar}
                    imageLogMeta={{
                      slotId: String(slot?.id || activeSlot?.id || ""),
                      claimedByUserId: claimUserId,
                      kind: "live-host",
                    }}
                  />
                  <View style={styles.hostTextWrap}>
                    <Text style={styles.hostName} numberOfLines={1}>
                      {cleanFeedLabel(
                        claimedBy?.name || slot?.claimedByName || activeSlot?.claimedByName,
                        "Host"
                      )}
                    </Text>
                    <Text style={styles.hostRole} numberOfLines={1}>
                      {String(
                        claimedBy?.role || slot?.claimedByRole || activeSlot?.claimedByRole || "Member"
                      ).replaceAll("_", " ")}
                    </Text>
                  </View>
                </View>

                {showSecondaryClaim ? (
                  <AnimatedPressable
                    onPress={handleClaimPress}
                    style={[
                      styles.hostEnterButton,
                      claimBtnStyle,
                      { borderColor: theme.border, shadowColor: theme.glow },
                    ]}
                  >
                    <LinearGradient
                      colors={[`${theme.accent}F0`, `${theme.accent}BB`, `${theme.accent}88`, "rgba(255,255,255,0.12)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.hostEnterButtonGradient}
                    >
                      <EnterLiveButtonGloss />
                      {claimedByMe && phase === "live" ? (
                        <>
                          <Ionicons name="radio" size={24} color="#FFF" />
                          <Text style={styles.hostEnterButtonText}>Enter Live Room</Text>
                          <Ionicons name="arrow-forward" size={22} color="#FFF" />
                        </>
                      ) : claimedByMe ? (
                        <>
                          <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                          <Text style={styles.hostEnterButtonText}>Claimed • Tap to Release</Text>
                        </>
                      ) : (
                        <>
                          <Ionicons name="people-outline" size={22} color="#FFF" />
                          <Text style={styles.hostEnterButtonText}>Taken • Join Queue</Text>
                        </>
                      )}
                    </LinearGradient>
                  </AnimatedPressable>
                ) : null}
                </Animated.View>
              </View>
            ) : null}
          </View>

          <View style={[styles.footerSection, compactUnclaimedLayout && styles.footerSectionUnclaimed]}>
            {showPrimaryClaim ? (
              <View style={compactUnclaimedLayout ? styles.claimBtnPrimaryWrap : undefined}>
                {compactUnclaimedLayout ? (
                  <View
                    pointerEvents="none"
                    style={[styles.claimBtnPrimaryBloom, isUnclaimedLiveOpen && styles.claimBtnPrimaryBloomLiveOpen]}
                  />
                ) : null}
                <AnimatedPressable
                  onPress={handleClaimPress}
                  style={[
                    styles.claimBtnPrimary,
                    compactUnclaimedLayout && styles.claimBtnPrimaryUnclaimed,
                    isUnclaimedLiveOpen && styles.claimBtnPrimaryLiveOpen,
                    claimBtnStyle,
                  ]}
                >
                  <LinearGradient
                    colors={
                      compactUnclaimedLayout
                        ? ["#FFE08A", "#F7D36A", "#E7C46F", "#B8862E", "#8B5E14"]
                        : [GOLD, "#E7C46F", "#C8943A"]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[
                      styles.claimBtnPrimaryGradient,
                      compactUnclaimedLayout && styles.claimBtnPrimaryGradientUnclaimed,
                    ]}
                  >
                    {compactUnclaimedLayout ? (
                      <>
                        <View pointerEvents="none" style={styles.claimBtnPrimaryTopSheen} />
                        <LinearGradient
                          pointerEvents="none"
                          colors={["transparent", "rgba(0,0,0,0.12)", "rgba(0,0,0,0.22)"]}
                          start={{ x: 0.5, y: 0 }}
                          end={{ x: 0.5, y: 1 }}
                          style={styles.claimBtnPrimaryInnerShadow}
                        />
                      </>
                    ) : null}
                    <Ionicons
                      name={isUnclaimedLiveOpen ? "radio" : "hand-left-outline"}
                      size={compactUnclaimedLayout ? 22 : 24}
                      color="#1A1205"
                    />
                    <Text style={styles.claimBtnPrimaryText}>{claimCtaText}</Text>
                  </LinearGradient>
                </AnimatedPressable>
              </View>
            ) : null}

            {phase === "ended" ? (
              <View style={[styles.claimBtnSecondary, styles.claimBtnDisabled, { borderColor: visualTheme.border }]}>
                <Text style={[styles.claimBtnSecondaryText, { color: visualTheme.accent }]}>Slot Ended</Text>
              </View>
            ) : null}

            <SocialActionRail
              displayLiked={displayLiked}
              likeCount={likeCount}
              localSaved={localSaved}
              onLike={onLike}
              onComment={onComment}
              onShare={onShare}
              onToggleSave={onToggleSave}
              blendUnclaimed={compactUnclaimedLayout}
            />
          </View>
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  frame: {
    marginTop: 210,
    marginHorizontal: 10,
    borderRadius: 30,
    overflow: "hidden",
  },
  frameFullBleed: {
    flex: 1,
    marginTop: 0,
    marginHorizontal: 14,
    justifyContent: "center",
    paddingTop: 42,
    paddingBottom: 18,
  },
  frameFullBleedCompact: {
    paddingTop: 22,
    paddingBottom: 14,
  },
  card: {
    borderRadius: 30,
    borderWidth: 1.2,
    overflow: "hidden",
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  cardTall: {
    minHeight: CARD_MIN_HEIGHT,
  },
  cardCompact: {
    minHeight: CARD_MIN_HEIGHT_COMPACT,
  },
  cardInner: {
    flex: 1,
    minHeight: CARD_MIN_HEIGHT,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 16,
    justifyContent: "space-between",
  },
  cardInnerCompact: {
    minHeight: CARD_MIN_HEIGHT_COMPACT,
    justifyContent: "flex-start",
    paddingTop: 18,
    paddingBottom: 14,
  },
  glowOrbTop: {
    position: "absolute",
    top: -48,
    right: 24,
    width: 160,
    height: 160,
    borderRadius: 999,
    opacity: 0.45,
  },
  glowOrbTopUnclaimed: {
    opacity: 0.62,
    width: 190,
    height: 190,
    top: -56,
    right: 12,
  },
  glowOrbTopLiveOpen: {
    opacity: 0.52,
    backgroundColor: "rgba(255,55,95,0.14)",
    width: 200,
    height: 200,
    top: -60,
    right: 8,
  },
  glowOrbBottom: {
    position: "absolute",
    bottom: -60,
    left: -20,
    width: 180,
    height: 180,
    borderRadius: 999,
    opacity: 0.28,
  },
  cardTopSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  cardInnerRim: {
    position: "absolute",
    top: 1,
    left: 14,
    right: 14,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 999,
  },
  cardEdgeGlowLayer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 30,
    overflow: "hidden",
  },
  cardEdgeGlowTL: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 88,
    height: 88,
    borderTopLeftRadius: 30,
  },
  cardEdgeGlowTR: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 88,
    height: 88,
    borderTopRightRadius: 30,
  },
  cardEdgeGlowBL: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 72,
    height: 72,
    borderBottomLeftRadius: 30,
  },
  cardEdgeGlowBR: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 72,
    height: 72,
    borderBottomRightRadius: 30,
  },
  sectionDividerWrap: {
    alignSelf: "center",
    width: "90%",
    height: 2,
    marginBottom: 10,
    justifyContent: "center",
    overflow: "visible",
  },
  sectionDividerWrapUnclaimed: {
    marginBottom: 4,
  },
  sectionDividerGradient: {
    height: 1,
    borderRadius: 999,
    opacity: 0.55,
  },
  sectionDividerGlowCore: {
    position: "absolute",
    alignSelf: "center",
    width: "38%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.10)",
    shadowColor: GOLD,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    borderRadius: 999,
  },
  headerSection: {
    marginBottom: 10,
  },
  headerSectionUnclaimed: {
    marginBottom: 6,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
  },
  mediaName: {
    color: "#FAFAFA",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 3,
  },
  churchSubline: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 5,
    maxWidth: "100%",
  },
  liveSchedulePill: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    minWidth: 0,
  },
  liveSchedulePillText: {
    color: GOLD,
    fontSize: 7.5,
    fontWeight: "900",
    letterSpacing: 0.8,
    flexShrink: 1,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  verifiedBadgeText: {
    color: GOLD,
    fontSize: 7.5,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  slotCounter: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    minWidth: 52,
  },
  slotCounterText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },
  bodySection: {
    flex: 0,
    justifyContent: "flex-start",
  },
  bodySectionUnclaimed: {
    flex: 0,
  },
  stateRow: {
    flexDirection: "row",
    marginBottom: 12,
    marginTop: 0,
  },
  stateRowUnclaimed: {
    marginBottom: 4,
    marginTop: 0,
  },
  statePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  statePillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  statePillLiveOpen: {
    borderWidth: 1.2,
    shadowColor: LIVE_PINK,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  titleBlock: {
    marginBottom: 16,
    minHeight: 92,
    justifyContent: "center",
  },
  titleBlockUnclaimed: {
    marginBottom: 8,
    minHeight: 0,
  },
  slotTitle: {
    color: "#FAFAFA",
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  slotTopic: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: 0.15,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  metaRowUnclaimed: {
    marginBottom: 4,
  },
  contentAmbientGlow: {
    height: 1,
    marginBottom: 6,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  metaText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  progressSection: {
    marginBottom: 14,
  },
  progressSectionUnclaimed: {
    marginTop: -12,
    marginBottom: 2,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
    marginBottom: 8,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  progressFillGlow: {
    height: "100%",
    borderRadius: 999,
    overflow: "hidden",
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  progressFill: {
    flex: 1,
    height: "100%",
    borderRadius: 999,
  },
  progressFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  countdown: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  countdownLiveOpen: {
    color: LIVE_PINK,
  },
  progressSlotHint: {
    color: "rgba(255,255,255,0.38)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.15,
  },
  openSpacer: {
    minHeight: 12,
  },
  hostSectionWrap: {
    position: "relative",
    marginTop: 4,
  },
  hostSectionGlow: {
    position: "absolute",
    top: 8,
    left: 20,
    right: 20,
    bottom: 8,
    borderRadius: 28,
    opacity: 0.22,
    transform: [{ scale: 1.02 }],
  },
  hostSection: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: "rgba(0,0,0,0.28)",
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
    overflow: "hidden",
  },
  hostSectionTopSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 48,
  },
  hostHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  hostKicker: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  hostTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  hostName: {
    color: "#FFF",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  hostRole: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,120,150,0.65)",
    overflow: "hidden",
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  liveBadgeText: {
    color: "#FFFFFF",
    fontSize: 7.5,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  claimedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  claimedBadgeText: {
    fontSize: 7.5,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  footerSection: {
    marginTop: 14,
    gap: 11,
  },
  footerSectionUnclaimed: {
    marginTop: "auto",
    gap: 9,
    paddingTop: 8,
  },
  claimBtnPrimaryWrap: {
    position: "relative",
  },
  claimBtnPrimaryBloom: {
    position: "absolute",
    top: 3,
    left: 12,
    right: 12,
    bottom: -4,
    borderRadius: 999,
    backgroundColor: "rgba(247,211,106,0.20)",
    shadowColor: GOLD,
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  claimBtnPrimaryBloomLiveOpen: {
    backgroundColor: "rgba(255,55,95,0.14)",
    shadowColor: LIVE_PINK,
    shadowOpacity: 0.32,
  },
  claimBtnPrimary: {
    borderRadius: 999,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  claimBtnPrimaryUnclaimed: {
    shadowOpacity: 0.52,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  claimBtnPrimaryLiveOpen: {
    shadowColor: LIVE_PINK,
    shadowOpacity: 0.38,
  },
  claimBtnPrimaryGradient: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
    overflow: "hidden",
  },
  claimBtnPrimaryGradientUnclaimed: {
    minHeight: 52,
    paddingVertical: 2,
    gap: 9,
  },
  claimBtnPrimaryTopSheen: {
    position: "absolute",
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.42)",
    borderRadius: 999,
  },
  claimBtnPrimaryInnerShadow: {
    ...StyleSheet.absoluteFillObject,
  },
  claimBtnPrimaryText: {
    color: "#1A1205",
    fontSize: 16,
    fontWeight: "900",
  },
  claimBtnSecondary: {
    minHeight: 54,
    borderRadius: 999,
    borderWidth: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  claimBtnSecondaryText: {
    fontSize: 14,
    fontWeight: "900",
  },
  claimBtnDisabled: {
    opacity: 0.5,
  },
  hostEnterButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  hostEnterButtonGradient: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
    overflow: "hidden",
  },
  hostEnterButtonTopSheen: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.35)",
    borderRadius: 999,
  },
  hostEnterButtonShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 48,
    backgroundColor: "rgba(255,255,255,0.18)",
    transform: [{ skewX: "-18deg" }],
  },
  hostEnterButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.15,
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  actionRail: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(247,211,106,0.16)",
    overflow: "hidden",
    backgroundColor: "rgba(6,8,14,0.82)",
    shadowColor: "#000",
    shadowOpacity: 0.48,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  actionRailUnclaimed: {
    borderColor: "rgba(247,211,106,0.07)",
    backgroundColor: "rgba(8,10,16,0.72)",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    paddingVertical: 13,
    paddingHorizontal: 10,
    marginTop: 1,
  },
  actionRailHighlight: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
  },
  actionRailHighlightUnclaimed: {
    backgroundColor: "rgba(255,255,255,0.10)",
    shadowColor: GOLD,
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  actionRailAmbientReflection: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  actionRailEdgeFadeUnclaimed: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  actionRailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  actionRailRowUnclaimed: {
    paddingHorizontal: 2,
  },
  actionRailItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 64,
  },
  actionRailIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.38,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  actionRailIconRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  actionRailLabel: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.15,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});
