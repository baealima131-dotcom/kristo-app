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
const GOLD_BORDER = "rgba(247,211,106,0.38)";
const CARD_MIN_HEIGHT = Math.min(700, Math.max(620, Dimensions.get("window").height * 0.74));

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
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1200 })
      ),
      -1,
      false
    );
  }, [live, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: live ? 1 + pulse.value * 0.07 : 1 }],
    opacity: live ? 0.55 + pulse.value * 0.45 : 1,
  }));

  const outer = size + 14;
  const inner = size - 4;

  return (
    <View style={{ width: outer, height: outer, alignItems: "center", justifyContent: "center" }}>
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
          padding: 2,
        }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: inner, height: inner, borderRadius: inner / 2 }}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient
            colors={goldFallback ? ["#F7D36A", "#C8943A", "#7A5218"] : ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.06)"]}
            style={{
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: goldFallback ? "#1A1205" : "#FFF", fontSize: size * 0.38, fontWeight: "900" }}>
              {initial}
            </Text>
          </LinearGradient>
        )}
      </LinearGradient>
    </View>
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
};

function SocialActionRail({
  displayLiked,
  likeCount = 0,
  localSaved,
  onLike,
  onComment,
  onShare,
  onToggleSave,
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
    <View style={styles.actionRail}>
      <LinearGradient
        colors={["rgba(255,255,255,0.04)", "rgba(255,255,255,0.01)"]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.actionRailRow}>
        {items.map((item) => (
          <Pressable key={item.key} onPress={item.onPress} style={styles.actionRailItem} hitSlop={8}>
            <View style={styles.actionRailIconWrap}>
              <Ionicons name={item.icon} size={23} color={item.iconColor} />
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

  return (
    <Animated.View
      entering={FadeIn.duration(280)}
      style={[styles.frame, fullBleed && styles.frameFullBleed]}
    >
      <View
        style={[
          styles.card,
          fullBleed && styles.cardTall,
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
        <View pointerEvents="none" style={[styles.glowOrbTop, { backgroundColor: GOLD_SOFT }]} />
        <View pointerEvents="none" style={[styles.glowOrbBottom, { backgroundColor: theme.glow }]} />

        <View style={styles.cardInner}>
          <Animated.View entering={FadeInDown.duration(300)} style={styles.headerSection}>
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
                  <View style={[styles.liveSchedulePill, { borderColor: GOLD_BORDER, backgroundColor: GOLD_SOFT }]}>
                    <Ionicons name="radio" size={11} color={GOLD} />
                    <Text style={styles.liveSchedulePillText}>LIVE SCHEDULE</Text>
                  </View>
                  <View style={[styles.verifiedBadge, { borderColor: GOLD_BORDER, backgroundColor: "rgba(255,255,255,0.05)" }]}>
                    <Ionicons name="shield-checkmark" size={12} color={GOLD} />
                    <Text style={styles.verifiedBadgeText}>VERIFIED</Text>
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

          <View style={styles.bodySection}>
            <View style={styles.stateRow}>
              <View style={[styles.statePill, { borderColor: theme.border, backgroundColor: `${theme.accent}16` }]}>
                {phase === "live" ? <View style={[styles.liveDot, { backgroundColor: theme.accent }]} /> : null}
                <Text style={[styles.statePillText, { color: theme.accent }]}>{theme.label}</Text>
              </View>
            </View>

            <View style={styles.titleBlock}>
              <Text
                style={[styles.slotTitle, { fontSize: titleFontSize, lineHeight: titleLineHeight }]}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.68}
              >
                {slotTitle}
              </Text>
              {!!slotTopic ? (
                <Text style={styles.slotTopic} numberOfLines={2}>
                  {slotTopic}
                </Text>
              ) : null}
            </View>

            <View style={styles.metaRow}>
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

            <View style={styles.progressSection}>
              <View style={styles.progressTrack}>
                <LinearGradient
                  colors={[theme.accent, `${theme.accent}88`]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]}
                />
              </View>
              <View style={styles.progressFooter}>
                <Text style={styles.countdown}>{countdownLabel}</Text>
                <Text style={styles.progressSlotHint}>
                  Slot {slotFeedIndex + 1} of {slotFeedTotal}
                </Text>
              </View>
            </View>

            {claimed ? (
              <Animated.View
                entering={FadeInDown.duration(240)}
                style={[styles.hostSection, { borderColor: theme.border }]}
              >
                <View style={styles.hostHeaderRow}>
                  <Text style={[styles.hostKicker, { color: theme.accent }]}>
                    {phase === "live" ? "LIVE HOST" : "CLAIMED BY"}
                  </Text>
                  {phase === "live" ? (
                    <View style={[styles.liveBadge, { backgroundColor: `${theme.accent}28`, borderColor: theme.border }]}>
                      <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
                      <Text style={[styles.liveBadgeText, { color: theme.accent }]}>ON AIR</Text>
                    </View>
                  ) : (
                    <View style={[styles.claimedBadge, { borderColor: theme.border, backgroundColor: `${theme.accent}18` }]}>
                      <Text style={[styles.claimedBadgeText, { color: theme.accent }]}>CLAIMED</Text>
                    </View>
                  )}
                </View>
                <View style={styles.hostRow}>
                  <AvatarRing
                    uri={claimedAvatarUri}
                    initial={String(claimedBy?.name || "H").slice(0, 1).toUpperCase()}
                    size={48}
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
              </Animated.View>
            ) : (
              <View style={styles.openSpacer} />
            )}
          </View>

          <View style={styles.footerSection}>
            {showPrimaryClaim ? (
              <AnimatedPressable
                onPress={handleClaimPress}
                style={[styles.claimBtnPrimary, claimBtnStyle]}
              >
                <LinearGradient
                  colors={[GOLD, "#E7C46F", "#C8943A"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.claimBtnPrimaryGradient}
                >
                  <Ionicons name="hand-left-outline" size={24} color="#1A1205" />
                  <Text style={styles.claimBtnPrimaryText}>Claim This Live Slot</Text>
                </LinearGradient>
              </AnimatedPressable>
            ) : null}

            {showSecondaryClaim ? (
              <AnimatedPressable
                onPress={handleClaimPress}
                style={[
                  styles.claimBtnSecondary,
                  claimBtnStyle,
                  { borderColor: theme.border, backgroundColor: `${theme.accent}12` },
                ]}
              >
                {claimedByMe && phase === "live" ? (
                  <>
                    <Ionicons name="radio" size={22} color={theme.accent} />
                    <Text style={[styles.claimBtnSecondaryText, { color: theme.accent }]}>Enter Live Room</Text>
                  </>
                ) : claimedByMe ? (
                  <>
                    <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
                    <Text style={[styles.claimBtnSecondaryText, { color: theme.accent }]}>
                      Claimed • Tap to Release
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="people-outline" size={22} color={theme.accent} />
                    <Text style={[styles.claimBtnSecondaryText, { color: theme.accent }]}>Taken • Join Queue</Text>
                  </>
                )}
              </AnimatedPressable>
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
    paddingVertical: 18,
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
  cardInner: {
    flex: 1,
    minHeight: CARD_MIN_HEIGHT,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    justifyContent: "space-between",
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
  glowOrbBottom: {
    position: "absolute",
    bottom: -60,
    left: -20,
    width: 180,
    height: 180,
    borderRadius: 999,
    opacity: 0.28,
  },
  headerSection: {
    marginBottom: 22,
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
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginBottom: 3,
  },
  churchSubline: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  liveSchedulePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveSchedulePillText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  verifiedBadgeText: {
    color: GOLD,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
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
    flex: 1,
    justifyContent: "flex-start",
  },
  stateRow: {
    flexDirection: "row",
    marginBottom: 16,
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
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  titleBlock: {
    marginBottom: 18,
    minHeight: 88,
  },
  slotTitle: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: -0.7,
    marginBottom: 10,
  },
  slotTopic: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  metaText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  progressSection: {
    marginBottom: 18,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
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
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  progressSlotHint: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 11,
    fontWeight: "700",
  },
  openSpacer: {
    flex: 1,
    minHeight: 24,
  },
  hostSection: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  hostHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  hostKicker: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  hostTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  hostName: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "900",
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
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  claimedBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  claimedBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  footerSection: {
    marginTop: 16,
    gap: 12,
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
  claimBtnPrimaryGradient: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
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
  actionRail: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  actionRailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  actionRailItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 52,
  },
  actionRailIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  actionRailLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});
