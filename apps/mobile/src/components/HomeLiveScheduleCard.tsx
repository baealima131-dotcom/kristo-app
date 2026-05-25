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
  enrichScheduleSlot,
  formatSlotDateLabel,
  resolveAvatarUri,
  resolveSlotPhase,
  SLOT_STATE_THEMES,
  type EnrichedScheduleSlot,
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
      withSequence(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1200 })),
      -1,
      false
    );
  }, [live, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: live ? 1 + pulse.value * 0.06 : 1 }],
    opacity: live ? 0.55 + pulse.value * 0.45 : 1,
  }));

  return (
    <View style={{ width: size + 14, height: size + 14, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: size + 14,
            height: size + 14,
            borderRadius: (size + 14) / 2,
            borderWidth: 2.5,
            borderColor: accent,
            shadowColor: accent,
            shadowOpacity: 0.55,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 0 },
          },
          ringStyle,
        ]}
      />
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: "rgba(255,255,255,0.08)",
            borderWidth: 1.5,
            borderColor: accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#FFF", fontSize: size * 0.38, fontWeight: "900" }}>{initial}</Text>
        </View>
      )}
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
  profileName?: string;
  profileAvatarUri?: string;
  onSkipSlots?: () => void;
  onOpenLiveRoom?: () => void;
  onOptimisticClaim?: (params: {
    postId: string;
    slotId: string;
    claim: { userId: string; name: string; role: string; avatarUri: string };
  }) => void;
};

export const HomeLiveScheduleCard = memo(function HomeLiveScheduleCard({
  item,
  activeSlot,
  slotFeedIndex,
  slotFeedTotal,
  nowMs,
  isActive,
  profileName,
  profileAvatarUri,
  onSkipSlots,
  onOpenLiveRoom,
  onOptimisticClaim,
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

  const churchName = String(item?.churchName || item?.churchLabel || "MY CHURCH").trim();
  const mediaName = String(item?.mediaName || item?.actorLabel || "Church Media").trim();
  const slotTitle = String(slot?.name || slot?.slotLabel || "Live Slot").trim();
  const slotTopic = String(
    slot?.script || slot?.task || slot?.role || item?.topic || item?.body || "Live media topic"
  )
    .split("\n")
    .join(" ")
    .trim();

  const churchAvatarUri = resolveAvatarUri(
    String(
      item?.churchAvatarUri ||
      item?.churchAvatarUrl ||
      item?.actorAvatarUri ||
      item?.avatarUri ||
      ""
    ),
    apiBase
  );
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

    console.log("[ClaimSlot] optimistic", { postId, slotId, userId: currentUserId });

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
      .then((res: any) => {
        console.log("[ClaimSlot] backend sync result", {
          ok: res?.ok,
          postId,
          slotId,
        });
      })
      .catch((e) => {
        console.log("[ClaimSlot] backend sync error", e);
        setOptimisticClaim(null);
      })
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
    <Animated.View entering={FadeIn.duration(320)} style={styles.frame}>
      <LinearGradient colors={theme.gradient} style={StyleSheet.absoluteFillObject} />

      <View style={[styles.card, { borderColor: theme.border, shadowColor: theme.glow }]}>
        <View pointerEvents="none" style={[styles.glowOrbTop, { backgroundColor: theme.glow }]} />
        <View pointerEvents="none" style={[styles.glowOrbBottom, { backgroundColor: theme.glow }]} />

        <BlurView intensity={28} tint="dark" style={styles.glassPanel}>
          <View style={styles.topRow}>
            <View style={[styles.statePill, { borderColor: theme.border, backgroundColor: `${theme.accent}22` }]}>
              {phase === "live" ? (
                <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
              ) : null}
              <Text style={[styles.statePillText, { color: theme.accent }]}>{theme.label}</Text>
            </View>
            <Pressable onPress={onSkipSlots} style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}>
              <Text style={styles.skipCount}>
                {slotFeedIndex + 1}/{slotFeedTotal}
              </Text>
              <Ionicons name="play-skip-forward" size={14} color="#FFF" />
            </Pressable>
          </View>

          <Animated.View entering={FadeInDown.duration(380).delay(40)} style={styles.heroRow}>
            <AvatarRing
              uri={churchAvatarUri}
              initial={mediaName.slice(0, 1).toUpperCase() || "C"}
              size={72}
              accent={theme.accent}
              live={phase === "live"}
            />
            <View style={styles.heroText}>
              <Text style={styles.mediaKicker}>CHURCH MEDIA</Text>
              <Text style={styles.mediaName} numberOfLines={1}>
                {mediaName}
              </Text>
              <Text style={styles.churchName} numberOfLines={1}>
                {churchName}
              </Text>
            </View>
          </Animated.View>

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
              <Ionicons name="calendar-outline" size={15} color={theme.accent} />
              <Text style={styles.metaText}>{formatSlotDateLabel(slot.meetingDate, slot.meetingDay)}</Text>
            </View>
            <View style={styles.metaChip}>
              <Ionicons name="time-outline" size={15} color={theme.accent} />
              <Text style={styles.metaText}>
                {slot.startTime}
                {slot.endTime ? ` – ${slot.endTime}` : ""}
              </Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.accent }]} />
          </View>
          <Text style={styles.countdown}>{countdownLabel}</Text>

          {claimed ? (
            <Animated.View entering={FadeInDown.duration(260)} style={[styles.hostSection, { borderColor: theme.border }]}>
              <Text style={[styles.hostKicker, { color: theme.accent }]}>
                {phase === "live" && claimedByMe ? "LIVE HOST" : "CLAIMED BY"}
              </Text>
              <View style={styles.hostRow}>
                <AvatarRing
                  uri={claimedAvatarUri}
                  initial={String(claimedBy?.name || "H").slice(0, 1).toUpperCase()}
                  size={48}
                  accent={theme.accent}
                  live={phase === "live"}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.hostName} numberOfLines={1}>
                    {String(claimedBy?.name || "Host")}
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
    borderRadius: 32,
    overflow: "hidden",
  },
  card: {
    borderRadius: 32,
    borderWidth: 1.4,
    overflow: "hidden",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  glowOrbTop: {
    position: "absolute",
    top: -40,
    right: -20,
    width: 140,
    height: 140,
    borderRadius: 999,
    opacity: 0.35,
  },
  glowOrbBottom: {
    position: "absolute",
    bottom: -50,
    left: -30,
    width: 160,
    height: 160,
    borderRadius: 999,
    opacity: 0.28,
  },
  glassPanel: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    backgroundColor: "rgba(8,12,20,0.55)",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  statePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  statePillText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  skipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  skipCount: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  heroText: {
    flex: 1,
    minWidth: 0,
  },
  mediaKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.2,
  },
  mediaName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  churchName: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  slotTitle: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  slotTopic: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  metaText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    marginBottom: 6,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  countdown: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 12,
    textAlign: "center",
  },
  hostSection: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  hostKicker: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  hostName: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "900",
  },
  hostRole: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  liveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  claimBtn: {
    minHeight: 58,
    borderRadius: 999,
    borderWidth: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  claimBtnDisabled: {
    opacity: 0.45,
  },
  claimBtnTextOpen: {
    color: "#06101E",
    fontSize: 16,
    fontWeight: "900",
  },
  claimBtnTextClaimed: {
    fontSize: 15,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});
