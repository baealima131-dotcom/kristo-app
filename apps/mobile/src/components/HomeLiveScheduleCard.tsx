import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Image, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
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

function userHasActiveChurchMembership(session?: { churchId?: string; activeChurchId?: string } | null) {
  return Boolean(String(session?.churchId || session?.activeChurchId || "").trim());
}

function AvatarRing({
  uri,
  initial,
  size,
  accent,
  live,
}: {
  uri?: string;
  initial: string;
  size: number;
  accent: string;
  live?: boolean;
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
    transform: [{ scale: live ? 1 + pulse.value * 0.08 : 1 }],
    opacity: live ? 0.6 + pulse.value * 0.4 : 1,
  }));

  const outer = size + 12;

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
            borderColor: accent,
            shadowColor: accent,
            shadowOpacity: 0.65,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
          },
          ringStyle,
        ]}
      />
      <LinearGradient
        colors={[`${accent}55`, `${accent}18`, "rgba(255,255,255,0.06)"]}
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
            style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width: size - 4,
              height: size - 4,
              borderRadius: (size - 4) / 2,
              backgroundColor: "rgba(255,255,255,0.1)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#FFF", fontSize: size * 0.36, fontWeight: "900" }}>{initial}</Text>
          </View>
        )}
      </LinearGradient>
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
          ? `${Math.floor(minutesToStart / 60)}h ${minutesToStart % 60}m`
          : minutesToStart > 1
            ? `${minutesToStart} min`
            : minutesToStart === 1
              ? "1 min"
              : "Starting now";

  const titleFontSize = slotTitle.length > 28 ? 24 : slotTitle.length > 18 ? 28 : 32;

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

  return (
    <Animated.View
      entering={FadeIn.duration(280)}
      style={[styles.frame, fullBleed && styles.frameFullBleed]}
    >
      <View style={[styles.card, { borderColor: theme.border, shadowColor: theme.glow }]}>
        <LinearGradient colors={theme.gradient} style={StyleSheet.absoluteFillObject} />
        <View pointerEvents="none" style={[styles.glowOrbTop, { backgroundColor: theme.glow }]} />
        <View pointerEvents="none" style={[styles.glowOrbBottom, { backgroundColor: theme.glow }]} />

        <BlurView intensity={fullBleed ? 44 : 32} tint="dark" style={[styles.glassPanel, fullBleed && styles.glassPanelFullBleed]}>
          {onLike || onComment || onShare || onToggleSave ? (
            <View style={styles.socialRow}>
              {onLike ? (
                <Pressable onPress={onLike} style={styles.socialBtn} hitSlop={8}>
                  <Ionicons
                    name={displayLiked ? "heart" : "heart-outline"}
                    size={22}
                    color={displayLiked ? "#FF4D6D" : "#FFF"}
                  />
                  <Text style={styles.socialCount}>{likeCount}</Text>
                </Pressable>
              ) : null}
              {onComment ? (
                <Pressable onPress={onComment} style={styles.socialBtn} hitSlop={8}>
                  <Ionicons name="chatbubble-outline" size={21} color="#FFF" />
                  <Text style={styles.socialLabel}>Chat</Text>
                </Pressable>
              ) : null}
              {onShare ? (
                <Pressable onPress={onShare} style={styles.socialBtn} hitSlop={8}>
                  <Ionicons name="arrow-redo-outline" size={21} color="#FFF" />
                  <Text style={styles.socialLabel}>Share</Text>
                </Pressable>
              ) : null}
              {onToggleSave ? (
                <Pressable onPress={onToggleSave} style={styles.socialBtn} hitSlop={8}>
                  <Ionicons
                    name={localSaved ? "bookmark" : "bookmark-outline"}
                    size={21}
                    color={localSaved ? "#F7D36A" : "#FFF"}
                  />
                  <Text style={styles.socialLabel}>Save</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Animated.View entering={FadeInDown.duration(300)} style={styles.broadcastHeaderWrap}>
            <LinearGradient
              colors={[`${theme.accent}28`, `${theme.accent}10`, "rgba(255,255,255,0.02)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.broadcastHeaderGradient}
            />
            <View style={styles.broadcastHeader}>
            <AvatarRing
              uri={avatarUri}
              initial={avatarInitial}
              size={fullBleed ? 54 : 56}
              accent={theme.accent}
              live={phase === "live"}
            />
            <View style={styles.broadcastText}>
              <View style={styles.broadcastTitleRow}>
                <View style={[styles.liveSchedulePill, { borderColor: theme.border, backgroundColor: `${theme.accent}24` }]}>
                  <Ionicons name="radio" size={11} color={theme.accent} />
                  <Text style={[styles.liveSchedulePillText, { color: theme.accent }]}>LIVE SCHEDULE</Text>
                </View>
                <View style={[styles.verifiedBadge, { borderColor: theme.border, backgroundColor: `${theme.accent}20` }]}>
                  <Ionicons name="shield-checkmark" size={12} color={theme.accent} />
                  <Text style={[styles.verifiedBadgeText, { color: theme.accent }]}>VERIFIED</Text>
                </View>
              </View>
              <Text style={styles.broadcastMediaName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                {mediaName}
              </Text>
              <Text style={styles.broadcastSubline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                {churchShort} • Church Media
              </Text>
            </View>
            <Pressable onPress={onSkipSlots} style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}>
              <Text style={styles.skipCount}>
                {slotFeedIndex + 1}/{slotFeedTotal}
              </Text>
              <Ionicons name="play-skip-forward" size={13} color="#FFF" />
            </Pressable>
            </View>
          </Animated.View>

          <View style={styles.stateRow}>
            <View style={[styles.statePill, { borderColor: theme.border, backgroundColor: `${theme.accent}18` }]}>
              {phase === "live" ? <View style={[styles.liveDot, { backgroundColor: theme.accent }]} /> : null}
              <Text style={[styles.statePillText, { color: theme.accent }]}>{theme.label}</Text>
            </View>
          </View>

          <Text
            style={[styles.slotTitle, { fontSize: titleFontSize, lineHeight: titleFontSize + 4 }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {slotTitle}
          </Text>

          <Text style={styles.slotTopic} numberOfLines={3}>
            {slotTopic}
          </Text>

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Ionicons name="calendar-outline" size={14} color={theme.accent} />
              <Text style={styles.metaText}>{formatSlotDateLabel(slot.meetingDate, slot.meetingDay)}</Text>
            </View>
            <View style={styles.metaChip}>
              <Ionicons name="time-outline" size={14} color={theme.accent} />
              <Text style={styles.metaText} numberOfLines={1}>
                {slot.startTime}
                {slot.endTime ? ` – ${slot.endTime}` : ""}
              </Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.accent }]}
            />
          </View>
          <Text style={styles.countdown}>{countdownLabel}</Text>

          {claimed ? (
            <Animated.View entering={FadeInDown.duration(240)} style={[styles.hostSection, { borderColor: theme.border }]}>
              <Text style={[styles.hostKicker, { color: theme.accent }]}>
                {phase === "live" && claimedByMe ? "LIVE HOST" : "CLAIMED BY"}
              </Text>
              <View style={styles.hostRow}>
                <AvatarRing
                  uri={claimedAvatarUri}
                  initial={String(claimedBy?.name || "H").slice(0, 1).toUpperCase()}
                  size={44}
                  accent={theme.accent}
                  live={phase === "live"}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.hostName} numberOfLines={1}>
                    {cleanFeedLabel(claimedBy?.name, "Host")}
                  </Text>
                  <Text style={styles.hostRole} numberOfLines={1}>
                    {String(claimedBy?.role || "Member").replaceAll("_", " ")}
                  </Text>
                </View>
                {phase === "live" ? (
                  <View style={[styles.liveBadge, { backgroundColor: `${theme.accent}33`, borderColor: theme.border }]}>
                    <Text style={[styles.liveBadgeText, { color: theme.accent }]}>ON AIR</Text>
                  </View>
                ) : null}
              </View>
            </Animated.View>
          ) : null}

          <AnimatedPressable
            onPress={handleClaimPress}
            disabled={phase === "ended"}
            style={[
              styles.claimBtn,
              claimBtnStyle,
              claimed
                ? { backgroundColor: `${theme.accent}18`, borderColor: theme.border }
                : { backgroundColor: theme.accent, borderColor: "rgba(255,255,255,0.75)" },
              phase === "ended" && styles.claimBtnDisabled,
            ]}
          >
            {!claimed ? (
              <>
                <Ionicons name="hand-left-outline" size={24} color="#06101E" />
                <Text style={styles.claimBtnTextOpen}>Claim This Live Slot</Text>
              </>
            ) : claimedByMe && phase === "live" ? (
              <>
                <Ionicons name="radio" size={22} color={theme.accent} />
                <Text style={[styles.claimBtnTextClaimed, { color: theme.accent }]}>Enter Live</Text>
              </>
            ) : claimedByMe ? (
              <>
                <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
                <Text style={[styles.claimBtnTextClaimed, { color: theme.accent }]}>Claimed • Tap to Release</Text>
              </>
            ) : (
              <>
                <Ionicons name="people-outline" size={22} color={theme.accent} />
                <Text style={[styles.claimBtnTextClaimed, { color: theme.accent }]}>Taken • Join Queue</Text>
              </>
            )}
          </AnimatedPressable>
        </BlurView>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  frame: {
    marginTop: 210,
    marginHorizontal: 10,
    borderRadius: 28,
    overflow: "hidden",
  },
  frameFullBleed: {
    flex: 1,
    marginTop: 0,
    marginHorizontal: 12,
    justifyContent: "center",
    paddingVertical: 8,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1.2,
    overflow: "hidden",
    shadowOpacity: 0.32,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  glowOrbTop: {
    position: "absolute",
    top: -36,
    right: -16,
    width: 120,
    height: 120,
    borderRadius: 999,
    opacity: 0.32,
  },
  glowOrbBottom: {
    position: "absolute",
    bottom: -44,
    left: -24,
    width: 140,
    height: 140,
    borderRadius: 999,
    opacity: 0.24,
  },
  glassPanel: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: "rgba(6,10,18,0.68)",
  },
  glassPanelFullBleed: {
    paddingTop: 8,
    paddingHorizontal: 14,
    backgroundColor: "rgba(4,8,16,0.74)",
  },
  socialRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 14,
    marginBottom: 10,
  },
  socialBtn: {
    alignItems: "center",
    gap: 2,
    minWidth: 44,
  },
  socialCount: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "800",
  },
  socialLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "700",
  },
  broadcastHeaderWrap: {
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  broadcastHeaderGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  broadcastHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  broadcastText: {
    flex: 1,
    minWidth: 0,
  },
  broadcastTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
    flexWrap: "wrap",
  },
  liveSchedulePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveSchedulePillText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  verifiedBadgeText: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  broadcastMediaName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  broadcastSubline: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 1,
  },
  skipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  skipCount: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "800",
  },
  stateRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  statePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statePillText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  slotTitle: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: -0.8,
    marginBottom: 4,
  },
  slotTopic: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  metaText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "800",
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    marginBottom: 5,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  countdown: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 10,
    textAlign: "center",
  },
  hostSection: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  hostKicker: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  hostName: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
  },
  hostRole: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
  liveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  claimBtn: {
    minHeight: 54,
    borderRadius: 999,
    borderWidth: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  claimBtnDisabled: {
    opacity: 0.45,
  },
  claimBtnTextOpen: {
    color: "#06101E",
    fontSize: 15,
    fontWeight: "900",
  },
  claimBtnTextClaimed: {
    fontSize: 14,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});
