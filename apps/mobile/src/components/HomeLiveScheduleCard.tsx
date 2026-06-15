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
import { resolveHomeFeedScheduleSlotLabels } from "@/src/lib/slotTopicUtils";
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
const VIP_GOLD_LIGHT = "#F6D77A";
const VIP_GOLD_MID = "#D9A441";
const VIP_GOLD_DEEP = "#A97018";
const VIP_GOLD_GLOW = "rgba(246,215,122,0.38)";
const LIVE_PINK = "#FF375F";
const LIVE_BURGUNDY = "#7A263A";
const LIVE_BURGUNDY_SOFT = "rgba(122,38,58,0.14)";
const LIVE_ROSE_GOLD = "#C9A08A";
const CARD_MIN_HEIGHT = Math.min(790, Math.max(720, Dimensions.get("window").height * 0.86));

function phaseEdgeTint(phase: string, claimed: boolean, isUnclaimedLiveOpen?: boolean) {
  if (isUnclaimedLiveOpen) return "rgba(122,38,58,0.09)";
  if (phase === "live") return "rgba(255,55,95,0.13)";
  if (claimed) return "rgba(167,139,250,0.11)";
  return "rgba(247,211,106,0.11)";
}

function PremiumSectionDivider({
  unclaimed,
  claimedCompact,
}: {
  unclaimed?: boolean;
  claimedCompact?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.sectionDividerWrap,
        unclaimed && styles.sectionDividerWrapUnclaimed,
        claimedCompact && styles.sectionDividerWrapClaimedLive,
      ]}
    >
      <LinearGradient
        colors={
          unclaimed
            ? [
                "transparent",
                "rgba(246,215,122,0.08)",
                "rgba(255,255,255,0.14)",
                "rgba(217,164,65,0.10)",
                "transparent",
              ]
            : [
                "transparent",
                "rgba(247,211,106,0.05)",
                "rgba(255,255,255,0.07)",
                "rgba(247,211,106,0.05)",
                "transparent",
              ]
        }
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.sectionDividerGradient}
      />
      <View style={[styles.sectionDividerGlowCore, unclaimed && styles.sectionDividerGlowCoreUnclaimed]} />
    </View>
  );
}

function PremiumUnclaimedCardAura({ liveOpen }: { liveOpen?: boolean }) {
  return (
    <>
      <View
        pointerEvents="none"
        style={[styles.vipRadialGlow, liveOpen && styles.vipRadialGlowLiveOpen]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={
          liveOpen
            ? ["rgba(122,38,58,0.045)", "transparent", "rgba(246,215,122,0.03)"]
            : ["rgba(246,215,122,0.07)", "rgba(169,112,24,0.03)", "transparent"]
        }
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.vipVerticalWash}
      />
      <View pointerEvents="none" style={[styles.vipAbstractOrbA, liveOpen && styles.vipAbstractOrbALiveOpen]} />
      <View pointerEvents="none" style={styles.vipAbstractOrbB} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.08)", "transparent", "rgba(0,0,0,0.06)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.vipGlassSheen}
      />
    </>
  );
}

function ClaimButtonPremiumShimmer() {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.quad) }),
      -1,
      false
    );
  }, [shimmer]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: 0.08 + shimmer.value * 0.22,
    transform: [{ translateX: -72 + shimmer.value * 144 }, { skewX: "-16deg" }],
  }));

  return (
    <>
      <View pointerEvents="none" style={styles.claimBtnVipTopHighlight} />
      <Animated.View pointerEvents="none" style={[styles.claimBtnVipShimmer, shimmerStyle]} />
    </>
  );
}

function ProgressBarPremiumShimmer() {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [shimmer]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + shimmer.value * 0.35,
    transform: [{ translateX: -18 + shimmer.value * 36 }],
  }));

  return <Animated.View pointerEvents="none" style={[styles.progressShimmer, shimmerStyle]} />;
}

function userHasActiveChurchMembership(session?: { churchId?: string; activeChurchId?: string } | null) {
  return Boolean(String(session?.churchId || session?.activeChurchId || "").trim());
}

function resolveTitleFontSize(title: string) {
  const len = title.length;
  let base = 34;
  if (len > 52) base = 22;
  else if (len > 38) base = 25;
  else if (len > 28) base = 28;
  else if (len > 18) base = 31;
  return Math.max(16, Math.round(base * 0.7));
}

function AvatarRing({
  uri,
  initial,
  size,
  accent,
  live,
  goldFallback,
  premiumEmblem,
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
  premiumEmblem?: boolean;
  forceShowImage?: boolean;
  allowDataUrl?: boolean;
  imageLogMeta?: {
    slotId?: string;
    claimedByUserId?: string;
    kind?: "live-host" | "claimed" | "church-header";
  };
}) {
  const pulse = useSharedValue(0);
  const emblemPulse = useSharedValue(0);
  const [imageError, setImageError] = useState(false);

  const safeUri = useMemo(() => {
    const trimmed = String(uri || "").trim();
    if (!trimmed) return "";
    if (!allowDataUrl && isClaimSlotDataUrlAvatar(trimmed)) {
      return "";
    }
    return trimmed;
  }, [uri, allowDataUrl, imageLogMeta?.kind]);

  useEffect(() => {
    setImageError(false);
  }, [safeUri]);

  useEffect(() => {
    if (!live && !premiumEmblem) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: live ? 1400 : 2200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: live ? 1400 : 2200 })
      ),
      -1,
      false
    );
  }, [live, premiumEmblem, pulse]);

  useEffect(() => {
    if (!premiumEmblem) return;
    emblemPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 2600 })
      ),
      -1,
      false
    );
  }, [premiumEmblem, emblemPulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: live || premiumEmblem ? 1 + pulse.value * (live ? 0.06 : 0.04) : 1 }],
    opacity: live ? 0.45 + pulse.value * 0.4 : premiumEmblem ? 0.72 + pulse.value * 0.22 : 0.85,
  }));

  const outerRingStyle = useAnimatedStyle(() => ({
    opacity: premiumEmblem ? 0.28 + emblemPulse.value * 0.32 : 0,
    transform: [{ scale: premiumEmblem ? 1.06 + emblemPulse.value * 0.05 : 1 }],
  }));

  const liveHaloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: live || premiumEmblem ? 1.04 + pulse.value * 0.1 : 1 }],
    opacity: live ? 0.12 + pulse.value * 0.22 : premiumEmblem ? 0.08 + pulse.value * 0.16 : 0,
  }));

  const outer = size + (premiumEmblem ? 20 : 14);
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
      {premiumEmblem ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: outer + 12,
              height: outer + 12,
              borderRadius: (outer + 12) / 2,
              borderWidth: 1.5,
              borderColor: "rgba(246,215,122,0.22)",
              shadowColor: VIP_GOLD_LIGHT,
              shadowOpacity: 0.45,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 0 },
            },
            outerRingStyle,
          ]}
        />
      ) : null}
      {live || premiumEmblem ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: outer + (premiumEmblem ? 8 : 10),
              height: outer + (premiumEmblem ? 8 : 10),
              borderRadius: (outer + (premiumEmblem ? 8 : 10)) / 2,
              backgroundColor: premiumEmblem ? VIP_GOLD_GLOW : accent,
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
            borderWidth: premiumEmblem ? 2.5 : 2,
            borderColor: goldFallback || premiumEmblem ? VIP_GOLD_LIGHT : accent,
            shadowColor: goldFallback || premiumEmblem ? VIP_GOLD_MID : accent,
            shadowOpacity: premiumEmblem ? 0.72 : 0.55,
            shadowRadius: premiumEmblem ? 20 : 16,
            shadowOffset: { width: 0, height: 0 },
          },
          ringStyle,
        ]}
      />
      {premiumEmblem ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: outer - 5,
              height: outer - 5,
              borderRadius: (outer - 5) / 2,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.28)",
            },
            ringStyle,
          ]}
        />
      ) : null}
      <LinearGradient
        colors={
          goldFallback || premiumEmblem
            ? !safeUri
              ? [VIP_GOLD_LIGHT, VIP_GOLD_MID, VIP_GOLD_DEEP]
              : [VIP_GOLD_LIGHT, VIP_GOLD_MID, "rgba(255,255,255,0.10)"]
            : [`${accent}55`, `${accent}18`, "rgba(255,255,255,0.06)"]
        }
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          padding: premiumEmblem ? 3 : 2.5,
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
            style={({ pressed }) => [
              styles.actionRailItem,
              blendUnclaimed && styles.actionRailItemUnclaimed,
              pressed && styles.pressed,
            ]}
            hitSlop={6}
          >
            <View style={styles.actionRailIconWrap}>
              <LinearGradient
                colors={
                  blendUnclaimed
                    ? ["rgba(255,255,255,0.20)", "rgba(246,215,122,0.10)", "rgba(0,0,0,0.32)"]
                    : ["rgba(255,255,255,0.16)", "rgba(255,255,255,0.05)", "rgba(0,0,0,0.28)"]
                }
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View
                pointerEvents="none"
                style={[styles.actionRailIconRing, blendUnclaimed && styles.actionRailIconRingUnclaimed]}
              />
              {blendUnclaimed ? (
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.18)", "transparent"]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 0.42 }}
                  style={styles.actionRailIconTopSheen}
                />
              ) : null}
              <Ionicons name={item.icon} size={22} color={item.iconColor} />
            </View>
            <Text style={[styles.actionRailLabel, blendUnclaimed && styles.actionRailLabelUnclaimed]} numberOfLines={1}>
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

    const avatarUri =
      sanitizePersistedClaimAvatarUri(optimisticClaim.claimedByAvatarUri, "optimistic-claim") ||
      sanitizePersistedClaimAvatarUri(optimisticClaim.claimedByAvatar, "optimistic-claim") ||
      sanitizePersistedClaimAvatarUri(optimisticClaim.claimedByPhotoUrl, "optimistic-claim") ||
      sanitizePersistedClaimAvatarUri(optimisticClaim.avatarUri, "optimistic-claim") ||
      sanitizePersistedClaimAvatarUri(optimisticClaim.avatarUrl, "optimistic-claim") ||
      persistedAvatar;
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
  const claimedLiveLayout = claimed && phase === "live";
  const claimedPreLiveLayout = claimed && phase !== "live" && phase !== "ended";
  const claimedCompactLayout = claimedLiveLayout || claimedPreLiveLayout;
  const canEnterLiveRoom = claimedByMe && isLiveWindow && phase !== "ended";
  const visualTheme = isUnclaimedLiveOpen ? { ...theme, label: "LIVE NOW • OPEN" } : theme;

  useEffect(() => {
    console.log("KRISTO_HOME_SLOT_VISUAL_STATE", {
      slotId: slot?.id,
      slotNumber: Number((slot as any)?.slot || (slot as any)?.slotNumber || slotFeedIndex + 1),
      startMs: slotVisual?.startMs ?? slot?.startMs,
      endMs: slotVisual?.endMs ?? slot?.endMs,
      currentUserId,
      claimedByUserId: claimUserId,
      claimed,
      claimedByMe,
      claimedByOther,
      phase,
      isLiveWindow,
      isUnclaimedLiveOpen,
      canEnterLiveRoom,
      hasOptimisticClaim: !!optimisticClaim,
      activeSlotClaimedByUserId: String(activeSlot?.claimedByUserId || activeSlot?.claimedBy?.userId || ""),
    });
  }, [
    slot?.id,
    slotFeedIndex,
    claimed,
    claimedByMe,
    claimedByOther,
    claimUserId,
    currentUserId,
    phase,
    isLiveWindow,
    isUnclaimedLiveOpen,
    canEnterLiveRoom,
    optimisticClaim,
    activeSlot?.claimedByUserId,
    activeSlot?.claimedBy?.userId,
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

  const { title: slotTitle, subtitle: slotTopic } = useMemo(
    () => resolveHomeFeedScheduleSlotLabels(item, slot),
    [item, slot]
  );

  const programOptionLabel = useMemo(() => {
    const label = String(slot?.name || slot?.slotLabel || "").trim();
    if (!label) return "";
    const norm = (value: string) => value.trim().toLowerCase();
    if (norm(label) === norm(slotTitle)) return "";
    if (slotTopic && norm(label) === norm(slotTopic)) return "";
    return label;
  }, [slot?.name, slot?.slotLabel, slotTitle, slotTopic]);

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

  const claimCtaText = canEnterLiveRoom
    ? "Enter Live Room"
    : isUnclaimedLiveOpen
      ? "Claim & Go Live"
      : "Claim This Live Slot";

  const showPrimaryClaim = !claimed && phase !== "ended" && !isClaimInFlight;
  const showEnterLivePrimary = canEnterLiveRoom && !isClaimInFlight;
  const showSecondaryClaim = claimed && phase !== "ended";
  const compactOpenCard = !claimed && phase !== "ended";
  const edgeTint = phaseEdgeTint(phase, claimed, isUnclaimedLiveOpen);

  const liveRoomNavigationTarget = useMemo(() => {
    const seedId = baseFeedId(String(item?.sourceScheduleId || item?.id || ""));
    return {
      pathname: "/(tabs)/more/my-church-room/messages/live-room",
      feedId: seedId,
      sourceScheduleId: seedId,
      scheduleType: String(item?.scheduleType || "media-live-slots"),
    };
  }, [item?.sourceScheduleId, item?.id, item?.scheduleType]);

  useEffect(() => {
    const ctaText = showEnterLivePrimary
      ? "Enter Live Room"
      : showPrimaryClaim
        ? claimCtaText
        : showSecondaryClaim
          ? canEnterLiveRoom
            ? "Enter Live Room"
            : claimedByMe
              ? "Claimed • Tap to Release"
              : "Taken • Join Queue"
          : "(hidden)";

    const navigationTarget = canEnterLiveRoom
      ? liveRoomNavigationTarget
      : showPrimaryClaim
        ? "claim-action"
        : claimedByMe
          ? "unclaim-or-hold"
          : claimedByOther
            ? "join-queue"
            : "none";

    console.log("KRISTO_HOME_SLOT_CTA_STATE", {
      slotId: String(slot?.id || activeSlot?.id || ""),
      currentUserId,
      claimedByUserId: claimUserId,
      claimed,
      claimedByMe,
      claimedByOther,
      phase,
      isLiveWindow,
      isUnclaimedLiveOpen,
      canEnterLiveRoom,
      showPrimaryClaim,
      showEnterLivePrimary,
      showSecondaryClaim,
      ctaText,
      navigationTarget,
      hasOptimisticClaim: !!optimisticClaim,
      activeSlotClaimedByUserId: String(activeSlot?.claimedByUserId || activeSlot?.claimedBy?.userId || ""),
    });
  }, [
    slot?.id,
    activeSlot?.id,
    currentUserId,
    claimUserId,
    claimed,
    claimedByMe,
    claimedByOther,
    phase,
    isLiveWindow,
    isUnclaimedLiveOpen,
    canEnterLiveRoom,
    showPrimaryClaim,
    showEnterLivePrimary,
    showSecondaryClaim,
    claimCtaText,
    liveRoomNavigationTarget,
    optimisticClaim,
    activeSlot?.claimedByUserId,
    activeSlot?.claimedBy?.userId,
  ]);

  const titleFontSize = useMemo(() => resolveTitleFontSize(slotTitle), [slotTitle]);
  const titleLineHeight = compactUnclaimedLayout ? titleFontSize + 4 : titleFontSize + 6;
  const headerAvatarSize = compactUnclaimedLayout ? 63 : claimedCompactLayout ? 64 : 68;
  const hostAvatarSize = claimedCompactLayout ? 54 : 58;

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

    const beforeClaimAvatar = await ensureProfileAvatarUploadedBeforeClaim({
      userId: currentUserId,
      session,
      profileAvatarUri,
      memberAvatarUri: memberAvatarByUserId[currentUserId],
    });
    const uploadedClaimAvatar = beforeClaimAvatar.uploadedUrl;

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

    const claimAvatarUri = uploadedClaimAvatar
      ? uploadedClaimAvatar
      : sanitizePersistedClaimAvatarUri(memberAvatarByUserId[currentUserId], "claim-member-cache") || "";
    const claim = {
      slotId,
      userId: currentUserId,
      name: String(
        session?.displayName || session?.fullName || session?.name || profileName || (isPastorClaim ? "Pastor" : "Church Member")
      ).trim(),
      role: isPastorClaim ? "Pastor" : String(session?.role || "Member"),
      avatarUri: claimAvatarUri,
      avatarUrl: claimAvatarUri,
      claimedByAvatarUri: claimAvatarUri,
      claimedByAvatar: claimAvatarUri,
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
          canEnterLiveRoom:
            Number(slot.startMs || 0) > 0 &&
            Number(slot.startMs || 0) <= Date.now() &&
            Number(slot.endMs || 0) > Date.now(),
        });

        const backendSlot = res?.slot;
        const backendAvatar =
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedByAvatarUri, "claim-api-slot") ||
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedByAvatar, "claim-api-slot") ||
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedByPhotoUrl, "claim-api-slot") ||
          sanitizePersistedClaimAvatarUri(backendSlot?.claimedBy?.avatarUri, "claim-api-slot") ||
          uploadedClaimAvatar ||
          claimAvatarUri ||
          "";
        if (backendAvatar) {
          feedClaimSchedule(seedId, {
            ...claim,
            avatarUri: backendAvatar,
            avatarUrl: backendAvatar,
            claimedByAvatarUri: backendAvatar,
            claimedByAvatar: backendAvatar,
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
    console.log("KRISTO_HOME_SLOT_CTA_PRESS", {
      slotId: String(slot?.id || activeSlot?.id || ""),
      currentUserId,
      claimedByUserId: claimUserId,
      claimed,
      claimedByMe,
      canEnterLiveRoom,
      hasOnOpenLiveRoom: typeof onOpenLiveRoom === "function",
    });

    if (canEnterLiveRoom) {
      console.log("KRISTO_HOME_SLOT_CTA_NAV", {
        action: "enter-live",
        slotId: String(slot?.id || activeSlot?.id || ""),
        currentUserId,
        claimedByUserId: claimUserId,
        navigationTarget: liveRoomNavigationTarget,
        hasOnOpenLiveRoom: typeof onOpenLiveRoom === "function",
      });
      if (!onOpenLiveRoom) {
        console.log("KRISTO_HOME_SLOT_CTA_NAV_BLOCKED", {
          reason: "missing-onOpenLiveRoom",
          slotId: String(slot?.id || activeSlot?.id || ""),
        });
        return;
      }
      onOpenLiveRoom();
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
    canEnterLiveRoom,
    claimedByMe,
    claimedByOther,
    onOpenLiveRoom,
    item,
    slot?.id,
    activeSlot?.id,
    slot.id,
    currentUserId,
    claimUserId,
    liveRoomNavigationTarget,
    profileName,
    profileAvatarUri,
    session?.role,
    claimThisSlot,
  ]);

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
        fullBleed && compactUnclaimedLayout && styles.frameFullBleedUnclaimed,
        fullBleed && claimedCompactLayout && styles.frameFullBleedClaimedLive,
      ]}
    >
      <View
        style={[
          styles.card,
          fullBleed && (compactOpenCard ? styles.cardCompact : styles.cardTall),
          claimedCompactLayout && styles.cardClaimedLive,
          compactUnclaimedLayout && styles.cardVipUnclaimed,
          { borderColor: visualTheme.border, shadowColor: visualTheme.glow },
        ]}
      >
        {compactUnclaimedLayout ? (
          <LinearGradient
            pointerEvents="none"
            colors={[VIP_GOLD_LIGHT, VIP_GOLD_MID, VIP_GOLD_DEEP, VIP_GOLD_MID, VIP_GOLD_LIGHT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardVipMetallicBorder}
          />
        ) : null}
        <LinearGradient
          colors={
            compactUnclaimedLayout
              ? ["#05070D", "#0E1018", "#12141E", "#080A10"]
              : ["#080A10", "#111520", "#070910"]
          }
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          colors={[visualTheme.gradient[0], visualTheme.gradient[1], visualTheme.gradient[2]]}
          style={[StyleSheet.absoluteFillObject, { opacity: compactUnclaimedLayout ? 0.58 : 0.72 }]}
        />
        <LinearGradient
          colors={
            compactUnclaimedLayout
              ? ["rgba(246,215,122,0.18)", "rgba(169,112,24,0.09)", "rgba(255,255,255,0.04)"]
              : ["rgba(247,211,106,0.08)", "transparent", "rgba(255,255,255,0.02)"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        {compactUnclaimedLayout ? <PremiumUnclaimedCardAura liveOpen={isUnclaimedLiveOpen} /> : null}
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
            { backgroundColor: isUnclaimedLiveOpen ? LIVE_BURGUNDY_SOFT : visualTheme.glow },
          ]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0.02)", "transparent"]}
          style={styles.cardTopSheen}
        />
        <View pointerEvents="none" style={[styles.cardInnerRim, compactUnclaimedLayout && styles.cardInnerRimVip]} />
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

        <View
          style={[
            styles.cardInner,
            compactOpenCard && styles.cardInnerCompact,
            claimedCompactLayout && styles.cardInnerClaimedLive,
          ]}
        >
          <View style={[compactOpenCard && styles.cardUpperBlockCompact]}>
          <Animated.View
            entering={FadeInDown.duration(300)}
            style={[
              styles.headerSection,
              compactUnclaimedLayout && styles.headerSectionUnclaimed,
              claimedCompactLayout && styles.headerSectionClaimedLive,
            ]}
          >
            <View style={styles.headerTopRow}>
              <AvatarRing
                uri={churchHeaderAvatar.uri}
                initial={churchHeaderInitial}
                size={headerAvatarSize}
                accent={visualTheme.accent}
                live={phase === "live"}
                goldFallback={!isUnclaimedLiveOpen}
                premiumEmblem={compactUnclaimedLayout}
                allowDataUrl
                forceShowImage={churchHeaderAvatar.hasAvatar}
                imageLogMeta={{ kind: "church-header" }}
              />
              <View style={styles.headerTextBlock}>
                <Text
                  style={[styles.mediaName, compactUnclaimedLayout && styles.mediaNameVip]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {churchShort}
                </Text>
                <Text
                  style={[styles.churchSubline, compactUnclaimedLayout && styles.churchSublineVip]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {mediaSubtitle}
                </Text>
              </View>
              {disableSlotCarousel ? (
                <View style={[styles.slotCounter, compactUnclaimedLayout && styles.slotCounterVip]}>
                  <LinearGradient
                    colors={[VIP_GOLD_LIGHT, VIP_GOLD_MID, VIP_GOLD_DEEP]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View pointerEvents="none" style={styles.slotCounterVipSheen} />
                  <Text style={styles.slotCounterTextVip}>
                    Slot {slotFeedIndex + 1}/{slotFeedTotal}
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={onSkipSlots}
                  style={({ pressed }) => [
                    styles.slotCounter,
                    compactUnclaimedLayout && styles.slotCounterVip,
                    pressed && styles.pressed,
                  ]}
                >
                  {compactUnclaimedLayout ? (
                    <>
                      <LinearGradient
                        colors={[VIP_GOLD_LIGHT, VIP_GOLD_MID, VIP_GOLD_DEEP]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                      <View pointerEvents="none" style={styles.slotCounterVipSheen} />
                    </>
                  ) : null}
                  <Text style={compactUnclaimedLayout ? styles.slotCounterTextVip : styles.slotCounterText}>
                    {slotFeedIndex + 1}/{slotFeedTotal}
                  </Text>
                  <Ionicons name="play-skip-forward" size={14} color={compactUnclaimedLayout ? "#1A1205" : GOLD} />
                </Pressable>
              )}
            </View>
          </Animated.View>

          <PremiumSectionDivider unclaimed={compactUnclaimedLayout} claimedCompact={claimedCompactLayout} />

          <View
            style={[
              styles.bodySection,
              compactUnclaimedLayout && styles.bodySectionUnclaimed,
              claimedCompactLayout && styles.bodySectionClaimedLive,
            ]}
          >
            <View
              style={[
                styles.stateRow,
                compactUnclaimedLayout && styles.stateRowUnclaimed,
                claimedCompactLayout && styles.stateRowClaimedLive,
              ]}
            >
              <View
                style={[
                  styles.statePill,
                  isUnclaimedLiveOpen && styles.statePillLiveOpen,
                  isUnclaimedLiveOpen && compactUnclaimedLayout && styles.statePillLiveOpenVip,
                  compactUnclaimedLayout && styles.statePillVip,
                  {
                    borderColor: isUnclaimedLiveOpen
                      ? compactUnclaimedLayout
                        ? "rgba(122,38,58,0.38)"
                        : "rgba(255,120,150,0.45)"
                      : compactUnclaimedLayout
                        ? "rgba(246,215,122,0.42)"
                        : "rgba(255,255,255,0.08)",
                    backgroundColor: isUnclaimedLiveOpen
                      ? compactUnclaimedLayout
                        ? "rgba(122,38,58,0.10)"
                        : `${visualTheme.accent}14`
                      : compactUnclaimedLayout
                        ? "rgba(246,215,122,0.12)"
                        : `${visualTheme.accent}14`,
                  },
                ]}
              >
                {compactUnclaimedLayout ? (
                  <LinearGradient
                    pointerEvents="none"
                    colors={
                      isUnclaimedLiveOpen
                        ? ["rgba(246,215,122,0.08)", "transparent", "rgba(122,38,58,0.10)"]
                        : ["rgba(255,255,255,0.10)", "transparent", "rgba(0,0,0,0.12)"]
                    }
                    style={StyleSheet.absoluteFillObject}
                  />
                ) : null}
                {phase === "live" ? (
                  <View
                    style={[
                      styles.liveDot,
                      {
                        backgroundColor: isUnclaimedLiveOpen && compactUnclaimedLayout ? LIVE_ROSE_GOLD : visualTheme.accent,
                      },
                    ]}
                  />
                ) : null}
                <Text
                  style={[
                    styles.statePillText,
                    compactUnclaimedLayout && styles.statePillTextVip,
                    {
                      color: isUnclaimedLiveOpen
                        ? compactUnclaimedLayout
                          ? LIVE_ROSE_GOLD
                          : visualTheme.accent
                        : compactUnclaimedLayout
                          ? VIP_GOLD_LIGHT
                          : visualTheme.accent,
                    },
                  ]}
                >
                  {visualTheme.label}
                </Text>
              </View>
              {!!programOptionLabel ? (
                <View
                  style={[
                    styles.programOptionChip,
                    compactUnclaimedLayout && styles.programOptionChipVip,
                    claimedCompactLayout && styles.programOptionChipClaimedLive,
                  ]}
                >
                  <Text
                    style={[
                      styles.programOptionChipText,
                      compactUnclaimedLayout && styles.programOptionChipTextVip,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {programOptionLabel.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>

            <View
              style={[
                styles.titleBlock,
                compactUnclaimedLayout && styles.titleBlockUnclaimed,
                claimedCompactLayout && styles.titleBlockClaimedLive,
              ]}
            >
              <Text
                style={[
                  styles.slotTitle,
                  compactUnclaimedLayout && styles.slotTitleVip,
                  { fontSize: titleFontSize, lineHeight: titleLineHeight },
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {slotTitle}
              </Text>
              {!!slotTopic ? (
                <Text style={[styles.slotTopic, compactUnclaimedLayout && styles.slotTopicVip]} numberOfLines={2}>
                  {slotTopic}
                </Text>
              ) : null}
            </View>

            <View
              style={[
                styles.metaRow,
                compactUnclaimedLayout && styles.metaRowUnclaimed,
                claimedCompactLayout && styles.metaRowClaimedLive,
              ]}
            >
              <View style={[styles.metaChip, compactUnclaimedLayout && styles.metaChipVip, claimedCompactLayout && styles.metaChipClaimedLive]}>
                <Ionicons
                  name="calendar-outline"
                  size={15}
                  color={compactUnclaimedLayout ? VIP_GOLD_LIGHT : visualTheme.accent}
                />
                <Text style={[styles.metaText, compactUnclaimedLayout && styles.metaTextVip]}>
                  {formatSlotDateLabel(slot.meetingDate, slot.meetingDay)}
                </Text>
              </View>
              <View style={[styles.metaChip, compactUnclaimedLayout && styles.metaChipVip, claimedCompactLayout && styles.metaChipClaimedLive]}>
                <Ionicons
                  name="time-outline"
                  size={15}
                  color={compactUnclaimedLayout ? VIP_GOLD_LIGHT : visualTheme.accent}
                />
                <Text style={[styles.metaText, compactUnclaimedLayout && styles.metaTextVip]} numberOfLines={1}>
                  {slot.startTime}
                  {slot.endTime ? ` – ${slot.endTime}` : ""}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.progressSection,
                compactUnclaimedLayout && styles.progressSectionUnclaimed,
                claimedCompactLayout && styles.progressSectionClaimedLive,
              ]}
            >
              {compactUnclaimedLayout ? (
                <View pointerEvents="none" style={styles.progressAmbientGlow}>
                  <LinearGradient
                    colors={
                      isUnclaimedLiveOpen
                        ? ["transparent", "rgba(122,38,58,0.04)", "transparent"]
                        : ["transparent", "rgba(247,211,106,0.04)", "transparent"]
                    }
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                </View>
              ) : null}
              <View style={[styles.progressCluster, compactUnclaimedLayout && styles.progressClusterVip]}>
              <View
                style={[
                  styles.progressTrack,
                  compactUnclaimedLayout && styles.progressTrackVip,
                  { shadowColor: compactUnclaimedLayout ? VIP_GOLD_MID : visualTheme.accent },
                ]}
              >
                <View
                  style={[
                    styles.progressFillGlow,
                    compactUnclaimedLayout && styles.progressFillGlowVip,
                    {
                      width: `${Math.round(progress * 100)}%`,
                      shadowColor: compactUnclaimedLayout ? VIP_GOLD_LIGHT : visualTheme.accent,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={
                      compactUnclaimedLayout
                        ? ["#FFF4C9", VIP_GOLD_LIGHT, VIP_GOLD_MID, VIP_GOLD_DEEP]
                        : ["rgba(255,255,255,0.22)", visualTheme.accent, `${visualTheme.accent}CC`, visualTheme.accent]
                    }
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.progressFill}
                  />
                  {compactUnclaimedLayout ? <ProgressBarPremiumShimmer /> : null}
                </View>
              </View>
              <View style={[styles.progressFooter, compactUnclaimedLayout && styles.progressFooterVip]}>
                <Text
                  style={[
                    styles.countdown,
                    compactUnclaimedLayout && styles.countdownVip,
                    isUnclaimedLiveOpen && styles.countdownLiveOpen,
                  ]}
                >
                  {countdownLabel}
                </Text>
                <Text style={[styles.progressSlotHint, compactUnclaimedLayout && styles.progressSlotHintVip]}>
                  Slot {slotFeedIndex + 1} of {slotFeedTotal}
                </Text>
              </View>
              </View>
            </View>

            {claimed ? (
              <View style={[styles.hostSectionWrap, claimedCompactLayout && styles.hostSectionWrapClaimedLive]}>
                <View pointerEvents="none" style={[styles.hostSectionGlow, { backgroundColor: theme.glow }]} />
                <Animated.View
                  entering={FadeInDown.duration(240)}
                  style={[styles.hostSection, claimedCompactLayout && styles.hostSectionClaimedLive]}
                >
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.06)", "transparent"]}
                  style={styles.hostSectionTopSheen}
                />
                <View style={[styles.hostHeaderRow, claimedCompactLayout && styles.hostHeaderRowClaimedLive]}>
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
                <View style={[styles.hostRow, claimedCompactLayout && styles.hostRowClaimedLive]}>
                  <AvatarRing
                    uri={resolvedClaimedAvatarUri}
                    initial={String(
                      claimedBy?.name || slot?.claimedByName || activeSlot?.claimedByName || "H"
                    )
                      .slice(0, 1)
                      .toUpperCase()}
                    size={hostAvatarSize}
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
                      claimedCompactLayout && styles.hostEnterButtonClaimedLive,
                      claimBtnStyle,
                      { borderColor: theme.border, shadowColor: theme.glow },
                    ]}
                  >
                    <LinearGradient
                      colors={[`${theme.accent}F0`, `${theme.accent}BB`, `${theme.accent}88`, "rgba(255,255,255,0.12)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[
                        styles.hostEnterButtonGradient,
                        claimedCompactLayout && styles.hostEnterButtonGradientClaimedLive,
                      ]}
                    >
                      <EnterLiveButtonGloss />
                      {claimedByMe && canEnterLiveRoom ? (
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
          </View>

          <View
            style={[
              styles.footerSection,
              compactUnclaimedLayout && styles.footerSectionUnclaimed,
              claimedCompactLayout && styles.footerSectionClaimedLive,
            ]}
          >
            {showEnterLivePrimary ? (
              <AnimatedPressable
                onPress={handleClaimPress}
                style={[
                  styles.claimBtnPrimary,
                  styles.claimBtnPrimaryLiveOpen,
                  claimBtnStyle,
                ]}
              >
                <LinearGradient
                  colors={["#FF3B63", "#D81B60", "#9C1748"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.claimBtnPrimaryGradient}
                >
                  <Ionicons name="radio" size={24} color="#FFF" />
                  <Text style={[styles.claimBtnPrimaryText, { color: "#FFF" }]}>Enter Live Room</Text>
                </LinearGradient>
              </AnimatedPressable>
            ) : null}

            {showPrimaryClaim ? (
              <View style={[compactUnclaimedLayout ? styles.claimBtnPrimaryWrapUnclaimed : undefined]}>
                {compactUnclaimedLayout ? (
                  <>
                    <View
                      pointerEvents="none"
                      style={[styles.claimBtnPrimaryBloomOuter, isUnclaimedLiveOpen && styles.claimBtnPrimaryBloomOuterLiveOpen]}
                    />
                    <View
                      pointerEvents="none"
                      style={[styles.claimBtnPrimaryBloom, isUnclaimedLiveOpen && styles.claimBtnPrimaryBloomLiveOpen]}
                    />
                  </>
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
                        ? [VIP_GOLD_LIGHT, VIP_GOLD_MID, VIP_GOLD_DEEP, "#8B5E14"]
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
                        <ClaimButtonPremiumShimmer />
                        <LinearGradient
                          pointerEvents="none"
                          colors={["transparent", "rgba(0,0,0,0.10)", "rgba(0,0,0,0.20)"]}
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
                    <Text style={[styles.claimBtnPrimaryText, compactUnclaimedLayout && styles.claimBtnPrimaryTextVip]}>
                      {claimCtaText}
                    </Text>
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
    overflow: "visible",
  },
  frameFullBleedCompact: {
    paddingTop: 22,
    paddingBottom: 14,
  },
  frameFullBleedUnclaimed: {
    paddingTop: 18,
    paddingBottom: 12,
  },
  frameFullBleedClaimedLive: {
    paddingTop: 34,
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
  cardVipUnclaimed: {
    borderWidth: 1.1,
    borderColor: "rgba(246,215,122,0.38)",
    shadowColor: VIP_GOLD_MID,
    shadowOpacity: 0.34,
    shadowRadius: 38,
    shadowOffset: { width: 0, height: 16 },
    elevation: 20,
  },
  cardVipMetallicBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    opacity: 0.58,
  },
  vipRadialGlow: {
    position: "absolute",
    top: "18%",
    alignSelf: "center",
    width: 250,
    height: 250,
    borderRadius: 999,
    backgroundColor: "rgba(246,215,122,0.05)",
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.22,
    shadowRadius: 52,
    shadowOffset: { width: 0, height: 0 },
  },
  vipRadialGlowLiveOpen: {
    backgroundColor: "rgba(122,38,58,0.06)",
    shadowColor: LIVE_BURGUNDY,
  },
  vipVerticalWash: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.58,
  },
  vipAbstractOrbA: {
    position: "absolute",
    top: 120,
    right: -36,
    width: 118,
    height: 118,
    borderRadius: 999,
    backgroundColor: "rgba(246,215,122,0.024)",
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.12,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    transform: [{ rotate: "18deg" }],
  },
  vipAbstractOrbALiveOpen: {
    backgroundColor: "rgba(122,38,58,0.025)",
    shadowColor: LIVE_BURGUNDY,
  },
  vipAbstractOrbB: {
    position: "absolute",
    bottom: 140,
    left: -28,
    width: 92,
    height: 92,
    borderRadius: 999,
    backgroundColor: "rgba(169,112,24,0.032)",
    shadowColor: VIP_GOLD_DEEP,
    shadowOpacity: 0.10,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  vipGlassSheen: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.32,
  },
  cardTall: {
    minHeight: CARD_MIN_HEIGHT,
  },
  cardClaimedLive: {
    minHeight: 0,
    alignSelf: "stretch",
  },
  cardCompact: {
    alignSelf: "stretch",
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
    flex: 0,
    minHeight: 0,
    justifyContent: "flex-start",
    paddingTop: 20,
    paddingBottom: 14,
  },
  cardInnerClaimedLive: {
    flex: 0,
    minHeight: 0,
    justifyContent: "flex-start",
    paddingTop: 18,
    paddingBottom: 12,
  },
  cardUpperBlockCompact: {
    flexShrink: 0,
    flexGrow: 0,
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
    opacity: 0.48,
    width: 158,
    height: 158,
    top: -50,
    right: 16,
  },
  glowOrbTopLiveOpen: {
    opacity: 0.30,
    backgroundColor: "rgba(122,38,58,0.08)",
    width: 168,
    height: 168,
    top: -52,
    right: 10,
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
  cardInnerRimVip: {
    backgroundColor: "rgba(246,215,122,0.14)",
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
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
    width: "86%",
    height: 1,
    marginBottom: 10,
    justifyContent: "center",
    overflow: "visible",
  },
  sectionDividerWrapUnclaimed: {
    marginTop: 6,
    marginBottom: 14,
    width: "82%",
    opacity: 0.88,
  },
  sectionDividerWrapClaimedLive: {
    marginBottom: 6,
  },
  sectionDividerGradient: {
    height: 1,
    borderRadius: 999,
    opacity: 0.45,
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
  sectionDividerGlowCoreUnclaimed: {
    backgroundColor: "rgba(246,215,122,0.18)",
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.42,
    shadowRadius: 12,
  },
  headerSection: {
    marginBottom: 10,
  },
  headerSectionUnclaimed: {
    marginBottom: 2,
  },
  headerSectionClaimedLive: {
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
  mediaNameVip: {
    color: "#FFFFFF",
    fontSize: 25,
    letterSpacing: -0.6,
    textShadowColor: "rgba(246,215,122,0.28)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  churchSubline: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
    marginBottom: 6,
  },
  churchSublineVip: {
    color: "rgba(255,255,255,0.68)",
    letterSpacing: 0.2,
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 5,
    maxWidth: "100%",
  },
  badgeRowVip: {
    marginTop: 2,
    gap: 6,
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
  liveSchedulePillVip: {
    borderColor: "rgba(246,215,122,0.48)",
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.38,
    shadowRadius: 10,
    paddingHorizontal: 7,
    gap: 4,
  },
  liveSchedulePillTextVip: {
    color: VIP_GOLD_LIGHT,
    fontSize: 8,
    letterSpacing: 1,
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
  verifiedBadgeVip: {
    borderColor: "rgba(246,215,122,0.44)",
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.32,
    shadowRadius: 8,
    paddingHorizontal: 6,
  },
  verifiedBadgeTextVip: {
    color: VIP_GOLD_LIGHT,
    fontSize: 8,
    letterSpacing: 1,
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
  slotCounterVip: {
    borderWidth: 1.1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "transparent",
    overflow: "hidden",
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: VIP_GOLD_DEEP,
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  slotCounterVipSheen: {
    position: "absolute",
    top: 1,
    left: 10,
    right: 10,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.42)",
    borderRadius: 999,
  },
  slotCounterTextVip: {
    color: "#1A1205",
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 0.25,
    zIndex: 1,
  },
  bodySection: {
    flex: 0,
    justifyContent: "flex-start",
  },
  bodySectionUnclaimed: {
    flex: 0,
    paddingTop: 2,
  },
  bodySectionClaimedLive: {
    flex: 0,
    paddingTop: 0,
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
    marginTop: 0,
  },
  stateRowUnclaimed: {
    marginBottom: 12,
    marginTop: 0,
  },
  stateRowClaimedLive: {
    marginBottom: 8,
  },
  statePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  statePillVip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  statePillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  statePillTextVip: {
    fontSize: 10.5,
    letterSpacing: 1.4,
    fontWeight: "900",
  },
  statePillLiveOpen: {
    borderWidth: 1.2,
    shadowColor: LIVE_PINK,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  statePillLiveOpenVip: {
    shadowColor: LIVE_BURGUNDY,
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
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
    marginBottom: 12,
    minHeight: 0,
    paddingTop: 2,
  },
  titleBlockClaimedLive: {
    marginBottom: 10,
    minHeight: 78,
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
  slotTitleVip: {
    color: "#FFFFFF",
    letterSpacing: -0.6,
    marginBottom: 10,
    textShadowColor: "rgba(246,215,122,0.32)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },
  slotTopic: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: 0.15,
    marginTop: 2,
  },
  slotTopicVip: {
    color: "rgba(255,255,255,0.58)",
    lineHeight: 21,
    letterSpacing: 0.18,
    marginTop: 4,
  },
  programOptionChip: {
    flexShrink: 1,
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(110,168,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(110,168,255,0.42)",
  },
  programOptionChipVip: {
    backgroundColor: "rgba(139,159,217,0.18)",
    borderColor: "rgba(139,159,217,0.48)",
  },
  programOptionChipClaimedLive: {
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  programOptionChipText: {
    color: "#B8CBFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.85,
  },
  programOptionChipTextVip: {
    color: "#C9D8FF",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  metaRowUnclaimed: {
    marginTop: 6,
    marginBottom: 12,
    gap: 10,
  },
  metaRowClaimedLive: {
    marginBottom: 11,
    gap: 8,
  },
  progressAmbientGlow: {
    position: "absolute",
    top: -10,
    left: 0,
    right: 0,
    height: 36,
    overflow: "hidden",
    opacity: 0.7,
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
  metaChipVip: {
    backgroundColor: "rgba(246,215,122,0.06)",
    borderColor: "rgba(246,215,122,0.18)",
  },
  metaChipClaimedLive: {
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  metaText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  metaTextVip: {
    color: "rgba(255,255,255,0.96)",
    letterSpacing: 0.15,
  },
  progressSection: {
    marginBottom: 14,
  },
  progressSectionUnclaimed: {
    marginTop: 2,
    marginBottom: 4,
    position: "relative",
  },
  progressSectionClaimedLive: {
    marginBottom: 8,
  },
  progressCluster: {
    width: "100%",
  },
  progressClusterVip: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: "rgba(246,215,122,0.04)",
    borderWidth: 1,
    borderColor: "rgba(246,215,122,0.08)",
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
  progressTrackVip: {
    height: 10,
    backgroundColor: "rgba(246,215,122,0.08)",
    borderWidth: 1,
    borderColor: "rgba(246,215,122,0.14)",
    marginBottom: 6,
  },
  progressFillGlow: {
    height: "100%",
    borderRadius: 999,
    overflow: "hidden",
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  progressFillGlowVip: {
    shadowOpacity: 0.72,
    shadowRadius: 14,
  },
  progressShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 28,
    backgroundColor: "rgba(255,255,255,0.42)",
    borderRadius: 999,
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
  progressFooterVip: {
    alignItems: "baseline",
    paddingTop: 0,
    minHeight: 18,
  },
  countdown: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
    lineHeight: 16,
  },
  countdownVip: {
    color: VIP_GOLD_LIGHT,
    fontWeight: "900",
    fontSize: 13,
    lineHeight: 16,
    textShadowColor: "rgba(246,215,122,0.18)",
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 0 },
  },
  countdownLiveOpen: {
    color: LIVE_ROSE_GOLD,
  },
  progressSlotHint: {
    color: "rgba(255,255,255,0.38)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.15,
  },
  progressSlotHintVip: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  openSpacer: {
    minHeight: 12,
  },
  hostSectionWrap: {
    position: "relative",
    marginTop: 4,
  },
  hostSectionWrapClaimedLive: {
    marginTop: 2,
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
  hostSectionClaimedLive: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
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
  hostHeaderRowClaimedLive: {
    marginBottom: 7,
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
  hostRowClaimedLive: {
    gap: 12,
    marginBottom: 10,
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
    flexShrink: 0,
    marginTop: 6,
    gap: 8,
    paddingTop: 0,
    paddingBottom: 4,
  },
  footerSectionClaimedLive: {
    flexShrink: 0,
    marginTop: 8,
    gap: 8,
    paddingBottom: 2,
  },
  claimBtnPrimaryWrap: {
    position: "relative",
  },
  claimBtnPrimaryWrapUnclaimed: {
    position: "relative",
    marginTop: 2,
  },
  claimBtnPrimaryBloomOuter: {
    position: "absolute",
    top: -4,
    left: 4,
    right: 4,
    bottom: -4,
    borderRadius: 999,
    backgroundColor: "rgba(246,215,122,0.14)",
    shadowColor: VIP_GOLD_LIGHT,
    shadowOpacity: 0.38,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  claimBtnPrimaryBloomOuterLiveOpen: {
    backgroundColor: "rgba(122,38,58,0.08)",
    shadowColor: LIVE_BURGUNDY,
    shadowOpacity: 0.24,
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
  claimBtnVipTopHighlight: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.55)",
    borderRadius: 999,
  },
  claimBtnVipShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 56,
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  claimBtnPrimaryBloomLiveOpen: {
    backgroundColor: "rgba(122,38,58,0.10)",
    shadowColor: LIVE_BURGUNDY,
    shadowOpacity: 0.22,
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
    shadowOpacity: 0.72,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
    shadowColor: VIP_GOLD_MID,
  },
  claimBtnPrimaryLiveOpen: {
    shadowColor: LIVE_BURGUNDY,
    shadowOpacity: 0.26,
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
    minHeight: 56,
    paddingVertical: 2,
    gap: 8,
    borderRadius: 999,
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
  claimBtnPrimaryTextVip: {
    fontSize: 16.5,
    letterSpacing: 0.2,
    textShadowColor: "rgba(255,255,255,0.18)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
  hostEnterButtonClaimedLive: {
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
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
  hostEnterButtonGradientClaimedLive: {
    minHeight: 52,
    gap: 8,
    paddingHorizontal: 16,
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
    borderColor: "rgba(246,215,122,0.12)",
    backgroundColor: "rgba(8,10,16,0.78)",
    shadowColor: VIP_GOLD_DEEP,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    paddingVertical: 11,
    paddingHorizontal: 10,
    marginTop: 0,
    marginBottom: 0,
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
  actionRailItemUnclaimed: {
    minHeight: 56,
    gap: 5,
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
  actionRailIconRingUnclaimed: {
    borderColor: "rgba(246,215,122,0.18)",
  },
  actionRailIconTopSheen: {
    position: "absolute",
    top: 0,
    left: 6,
    right: 6,
    height: 14,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  actionRailLabel: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.15,
  },
  actionRailLabelUnclaimed: {
    color: "rgba(255,255,255,0.78)",
    letterSpacing: 0.2,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});
