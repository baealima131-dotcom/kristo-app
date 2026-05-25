import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Image, Pressable, StyleSheet, Dimensions } from "react-native";
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
import { apiPost } from "@/src/lib/kristoApi";
import { feedClaimSchedule, feedJoinSlotQueue, feedUnclaimSchedule } from "@/src/lib/homeFeedStore";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  baseFeedId,
  cleanFeedLabel,
  enrichScheduleSlot,
  formatSlotDateLabel,
  resolveAvatarUri,
  resolveScheduleAvatarUri,
  resolveSlotPhase,
  SLOT_STATE_THEMES,
} from "@/src/lib/scheduleSlotUtils";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const GOLD = "#F7D36A";
const GOLD_SOFT = "rgba(247,211,106,0.22)";
const GOLD_BORDER = "rgba(247,211,106,0.42)";
const GOLD_GLASS = "rgba(247,211,106,0.14)";
const LIVE_PINK = "#FF375F";
const CARD_MIN_HEIGHT = Math.min(790, Math.max(720, Dimensions.get("window").height * 0.86));
const CARD_MIN_HEIGHT_COMPACT = Math.min(600, Math.max(520, Dimensions.get("window").height * 0.58));

function phaseEdgeTint(phase: string, claimed: boolean) {
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
}: {
  uri?: string;
  initial: string;
  size: number;
  accent: string;
  live?: boolean;
  goldFallback?: boolean;
}) {
  const pulse = useSharedValue(0);

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
          goldFallback && !uri
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
        {uri ? (
          <View style={{ width: inner, height: inner, borderRadius: inner / 2, overflow: "hidden" }}>
            <Image
              source={{ uri }}
              style={{ width: inner, height: inner, borderRadius: inner / 2 }}
              resizeMode="cover"
            />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(255,255,255,0.12)", "transparent", "rgba(0,0,0,0.18)"]}
              style={StyleSheet.absoluteFillObject}
            />
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
  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
  const session = getSessionSync() as any;
  const currentUserId = String(session?.userId || "");

  const slot = useMemo(
    () => enrichScheduleSlot(activeSlot, slotFeedIndex, nowMs),
    [activeSlot, slotFeedIndex, nowMs]
  );

  const [optimisticClaim, setOptimisticClaim] = useState<any>(null);
  const claimingSlotRef = useRef<string | null>(null);
  const claimPress = useSharedValue(1);

  const claimedBy =
    optimisticClaim ||
    slot?.claimedBy ||
    (slot?.claimedByUserId
      ? {
          userId: slot.claimedByUserId,
          name: slot.claimedByName || "Host",
          role: "Member",
          avatarUri: slot.claimedByAvatar || "",
        }
      : null);

  const claimUserId = String(claimedBy?.userId || slot?.claimedByUserId || "").trim();
  const claimed = Boolean(claimUserId || optimisticClaim);
  const claimedByMe = !!claimUserId && claimUserId === currentUserId;
  const claimedByOther = !!claimUserId && claimUserId !== currentUserId;

  const phase = resolveSlotPhase(slot, claimed);
  const theme = SLOT_STATE_THEMES[phase];

  const mediaName = cleanFeedLabel(item?.mediaName || item?.actorLabel, "Church Media");
  const churchName = cleanFeedLabel(item?.churchName || item?.churchLabel, "MY CHURCH");
  const churchShort = churchName.replace(/\s+CHURCH$/i, "").trim() || churchName;

  const slotTitle = String(slot?.name || slot?.slotLabel || "Live Slot").trim();
  const slotTopic = cleanFeedLabel(
    slot?.script || slot?.task || slot?.role || item?.topic || item?.body,
    "Live media topic"
  )
    .split("\n")
    .join(" ")
    .trim();

  const avatarUri = resolveScheduleAvatarUri(item, apiBase);
  const avatarInitial = mediaName.slice(0, 1).toUpperCase() || churchShort.slice(0, 1).toUpperCase() || "C";
  const claimedAvatarUri = resolveAvatarUri(String(claimedBy?.avatarUri || slot?.claimedByAvatar || ""), apiBase);

  const msUntilStart = slot.startMs > 0 ? slot.startMs - nowMs : null;
  const minutesToStart = msUntilStart !== null ? Math.ceil(msUntilStart / 60000) : null;
  const msRemaining = slot.endMs > nowMs ? slot.endMs - nowMs : 0;
  const progress =
    slot.startMs > 0 && slot.endMs > slot.startMs
      ? Math.max(0, Math.min(1, (nowMs - slot.startMs) / (slot.endMs - slot.startMs)))
      : 0;

  const countdownLabel =
    phase === "live"
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

  const titleFontSize = useMemo(() => resolveTitleFontSize(slotTitle), [slotTitle]);
  const titleLineHeight = titleFontSize + 6;

  const claimBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: claimPress.value }],
  }));

  const claimThisSlot = useCallback(() => {
    if (!userHasActiveChurchMembership(session)) return;
    if (claimed || !slot?.id) return;
    if (claimingSlotRef.current === slot.id) return;

    claimingSlotRef.current = String(slot.id);
    claimPress.value = withSequence(withSpring(0.94), withSpring(1));

    const postId = baseFeedId(String(item?.sourceScheduleId || item?.id || ""));
    const slotId = String(slot.id);
    const claim = {
      slotId,
      userId: currentUserId,
      name: String(
        session?.displayName || session?.fullName || session?.name || profileName || "Church Member"
      ).trim(),
      role: String(session?.role || "Member"),
      avatarUri: String(
        session?.avatarUri || session?.avatarUrl || session?.profileImage || profileAvatarUri || ""
      ).trim(),
    };

    setOptimisticClaim(claim);
    feedClaimSchedule(postId, claim);
    onOptimisticClaim?.({ postId, slotId, claim });

    void apiPost(
      "/api/church/feed",
      { action: "claim_schedule_slot", postId, slotId, claim },
      {
        headers: getKristoHeaders({
          userId: session?.userId || "",
          role: (session?.role || "Member") as any,
          churchId: session?.churchId || "",
        }),
      }
    )
      .catch(() => setOptimisticClaim(null))
      .finally(() => {
        claimingSlotRef.current = null;
      });
  }, [
    session,
    claimed,
    slot?.id,
    item,
    currentUserId,
    profileName,
    profileAvatarUri,
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

  const showPrimaryClaim = !claimed && phase !== "ended";
  const showSecondaryClaim = claimed && phase !== "ended";
  const isUnclaimedOpen = !claimed && (phase === "open" || phase === "upcoming");
  const compactOpenCard = !claimed && phase !== "ended";
  const edgeTint = phaseEdgeTint(phase, claimed);

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
          { borderColor: theme.border, shadowColor: theme.glow },
        ]}
      >
        <LinearGradient colors={["#080A10", "#111520", "#070910"]} style={StyleSheet.absoluteFillObject} />
        <LinearGradient
          colors={[theme.gradient[0], theme.gradient[1], theme.gradient[2]]}
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
          ]}
        />
        <View pointerEvents="none" style={[styles.glowOrbBottom, { backgroundColor: theme.glow }]} />
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
            style={[styles.headerSection, isUnclaimedOpen && styles.headerSectionUnclaimed]}
          >
            <View style={styles.headerTopRow}>
              <AvatarRing
                uri={avatarUri}
                initial={avatarInitial}
                size={68}
                accent={theme.accent}
                live={phase === "live"}
                goldFallback
              />
              <View style={styles.headerTextBlock}>
                <Text style={styles.mediaName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {mediaName}
                </Text>
                <Text style={styles.churchSubline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                  {churchShort} • Church Media
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
              <Pressable onPress={onSkipSlots} style={({ pressed }) => [styles.slotCounter, pressed && styles.pressed]}>
                <Text style={styles.slotCounterText}>
                  {slotFeedIndex + 1}/{slotFeedTotal}
                </Text>
                <Ionicons name="play-skip-forward" size={14} color={GOLD} />
              </Pressable>
            </View>
          </Animated.View>

          <PremiumSectionDivider unclaimed={isUnclaimedOpen} />

          <View style={[styles.bodySection, isUnclaimedOpen && styles.bodySectionUnclaimed]}>
            <View style={[styles.stateRow, isUnclaimedOpen && styles.stateRowUnclaimed]}>
              <View style={[styles.statePill, { borderColor: "rgba(255,255,255,0.08)", backgroundColor: `${theme.accent}14` }]}>
                {phase === "live" ? <View style={[styles.liveDot, { backgroundColor: theme.accent }]} /> : null}
                <Text style={[styles.statePillText, { color: theme.accent }]}>{theme.label}</Text>
              </View>
            </View>

            <View style={[styles.titleBlock, isUnclaimedOpen && styles.titleBlockUnclaimed]}>
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

            <View style={[styles.metaRow, isUnclaimedOpen && styles.metaRowUnclaimed]}>
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

            {isUnclaimedOpen ? (
              <View pointerEvents="none" style={styles.contentAmbientGlow}>
                <LinearGradient
                  colors={["transparent", "rgba(247,211,106,0.06)", "transparent"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFillObject}
                />
              </View>
            ) : null}

            <View style={[styles.progressSection, isUnclaimedOpen && styles.progressSectionUnclaimed]}>
              <View style={[styles.progressTrack, { shadowColor: theme.accent }]}>
                <View style={[styles.progressFillGlow, { width: `${Math.round(progress * 100)}%`, shadowColor: theme.accent }]}>
                  <LinearGradient
                    colors={["rgba(255,255,255,0.22)", theme.accent, `${theme.accent}CC`, theme.accent]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.progressFill}
                  />
                </View>
              </View>
              <View style={styles.progressFooter}>
                <Text style={styles.countdown}>{countdownLabel}</Text>
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
                    uri={claimedAvatarUri}
                    initial={String(claimedBy?.name || "H").slice(0, 1).toUpperCase()}
                    size={58}
                    accent={theme.accent}
                    live={phase === "live"}
                  />
                  <View style={styles.hostTextWrap}>
                    <Text style={styles.hostName} numberOfLines={1}>
                      {cleanFeedLabel(claimedBy?.name, "Host")}
                    </Text>
                    <Text style={styles.hostRole} numberOfLines={1}>
                      {String(claimedBy?.role || "Member").replaceAll("_", " ")}
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
            ) : isUnclaimedOpen ? null : (
              <View style={styles.openSpacer} />
            )}
          </View>

          <View style={[styles.footerSection, isUnclaimedOpen && styles.footerSectionUnclaimed]}>
            {showPrimaryClaim ? (
              <View style={isUnclaimedOpen ? styles.claimBtnPrimaryWrap : undefined}>
                {isUnclaimedOpen ? (
                  <View pointerEvents="none" style={styles.claimBtnPrimaryBloom} />
                ) : null}
                <AnimatedPressable
                  onPress={handleClaimPress}
                  style={[
                    styles.claimBtnPrimary,
                    isUnclaimedOpen && styles.claimBtnPrimaryUnclaimed,
                    claimBtnStyle,
                  ]}
                >
                  <LinearGradient
                    colors={
                      isUnclaimedOpen
                        ? ["#FFE08A", "#F7D36A", "#E7C46F", "#B8862E", "#8B5E14"]
                        : [GOLD, "#E7C46F", "#C8943A"]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[
                      styles.claimBtnPrimaryGradient,
                      isUnclaimedOpen && styles.claimBtnPrimaryGradientUnclaimed,
                    ]}
                  >
                    {isUnclaimedOpen ? (
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
                    <Ionicons name="hand-left-outline" size={isUnclaimedOpen ? 22 : 24} color="#1A1205" />
                    <Text style={styles.claimBtnPrimaryText}>Claim This Live Slot</Text>
                  </LinearGradient>
                </AnimatedPressable>
              </View>
            ) : null}

            {phase === "ended" ? (
              <View style={[styles.claimBtnSecondary, styles.claimBtnDisabled, { borderColor: theme.border }]}>
                <Text style={[styles.claimBtnSecondaryText, { color: theme.accent }]}>Slot Ended</Text>
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
              blendUnclaimed={isUnclaimedOpen}
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
