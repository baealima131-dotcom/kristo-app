import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  CHURCH_SUBSCRIPTION_MINISTRY_MESSAGE,
  CHURCH_SUBSCRIPTION_PREMIUM_TITLE,
} from "@/src/lib/churchSubscription";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";

export function isMinistryCreationAllowed(
  subscriptionActive: boolean | null,
  canUseMediaTools?: boolean | null
): boolean {
  if (isSubscriptionBypassEnabled()) return true;
  if (canUseMediaTools === true) return true;
  return subscriptionActive === true;
}

export function isMinistryCreationBlocked(
  subscriptionActive: boolean | null,
  canUseMediaTools?: boolean | null
): boolean {
  return !isMinistryCreationAllowed(subscriptionActive, canUseMediaTools);
}

/** V1: lock premium ministry management when subscription is inactive or media tools are locked. */
export const isChurchPremiumManagementBlocked = isMinistryCreationBlocked;
export const isChurchPremiumManagementAllowed = isMinistryCreationAllowed;

type MinistryPremiumLockCardProps = {
  onSubscribe: () => void;
  style?: object;
};

export function ChurchMinistryPremiumLockCard({
  onSubscribe,
  style,
}: MinistryPremiumLockCardProps) {
  return (
    <View style={[lockCardStyles.card, style]}>
      <View style={lockCardStyles.headerRow}>
        <Ionicons name="lock-closed" size={14} color="#E8C872" />
        <Text style={lockCardStyles.title}>Media Premium required</Text>
      </View>
      <Text style={lockCardStyles.message}>
        Subscribe to create ministries and manage ministry live access.
      </Text>
      <Pressable
        onPress={onSubscribe}
        style={({ pressed }) => [lockCardStyles.btn, pressed && lockCardStyles.pressed]}
      >
        <Text style={lockCardStyles.btnText}>Subscribe</Text>
      </Pressable>
    </View>
  );
}

const lockCardStyles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(217,179,95,0.28)",
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.1,
  },
  message: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  btn: {
    alignSelf: "flex-start",
    marginTop: 2,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(217,179,95,0.34)",
  },
  btnText: {
    color: "#F0D693",
    fontSize: 13,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.9,
  },
});

type ChurchSubscriptionExpiredBadgeProps = {
  onSubscribe: () => void;
  style?: object;
};

/** Compact banner when subscription expired but existing ministry data stays visible. */
export function ChurchSubscriptionExpiredBadge({
  onSubscribe,
  style,
}: ChurchSubscriptionExpiredBadgeProps) {
  return (
    <View style={[expiredBadgeStyles.row, style]}>
      <Ionicons name="lock-closed" size={13} color="#E8C872" />
      <Text style={expiredBadgeStyles.label}>Subscription expired</Text>
      <Pressable
        onPress={onSubscribe}
        style={({ pressed }) => [expiredBadgeStyles.btn, pressed && expiredBadgeStyles.pressed]}
      >
        <Text style={expiredBadgeStyles.btnText}>Subscribe</Text>
      </Pressable>
    </View>
  );
}

const expiredBadgeStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(217,179,95,0.28)",
  },
  label: {
    flex: 1,
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.1,
  },
  btn: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(217,179,95,0.34)",
  },
  btnText: {
    color: "#F0D693",
    fontSize: 12,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.9,
  },
});

type Props = {
  visible: boolean;
  onClose: () => void;
  onViewSubscription?: () => void;
  title?: string;
  message?: string;
};

export function ChurchPremiumSubscriptionModal({
  visible,
  onClose,
  onViewSubscription,
  title = CHURCH_SUBSCRIPTION_PREMIUM_TITLE,
  message = CHURCH_SUBSCRIPTION_MINISTRY_MESSAGE,
}: Props) {
  const scale = useRef(new Animated.Value(0.9)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(22)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0.9);
      fade.setValue(0);
      lift.setValue(22);
      return;
    }

    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 7 }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 7 }),
    ]).start();
  }, [visible, scale, fade, lift]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <Animated.View
          style={[
            s.card,
            {
              opacity: fade,
              transform: [{ translateY: lift }, { scale }],
            },
          ]}
        >
          <LinearGradient
            colors={["#0C1829", "#07111F", "#050B14"]}
            locations={[0, 0.52, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={s.goldGlow} />
          <View style={s.goldGlowSoft} />
          <View style={s.goldGlowCenter} />
          <View style={s.topShine} />
          <View style={s.innerHighlight} />

          <View style={s.iconStack}>
            <LinearGradient
              colors={["rgba(240,214,147,0.22)", "rgba(217,181,109,0.10)", "rgba(196,154,69,0.06)"]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={s.iconRing}
            >
              <Ionicons name="diamond-outline" size={25} color="#F0D693" />
            </LinearGradient>
            <LinearGradient
              colors={["#F0D693", "#D9B56D", "#B8893F"]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.85, y: 1 }}
              style={s.lockBadge}
            >
              <Ionicons name="lock-closed" size={11} color="#07111F" />
            </LinearGradient>
          </View>

          <Text style={s.kicker}>KRISTO PREMIUM</Text>
          <Text style={s.title} numberOfLines={2}>
            {title}
          </Text>
          <View style={s.messageWrap}>
            <Text style={s.message}>{message}</Text>
          </View>

          <View style={s.pillRow}>
            <View style={[s.pill, s.pillLive]}>
              <Ionicons name="calendar-outline" size={12} color="#34D399" />
              <Text style={[s.pillText, s.pillTextLive]}>Live</Text>
            </View>
            <View style={[s.pill, s.pillMedia]}>
              <Ionicons name="videocam-outline" size={12} color="#5B8DEF" />
              <Text style={[s.pillText, s.pillTextMedia]}>Media</Text>
            </View>
            <View style={[s.pill, s.pillMinistry]}>
              <Ionicons name="people-outline" size={12} color="#E8C872" />
              <Text style={[s.pillText, s.pillTextMinistry]}>Ministry</Text>
            </View>
          </View>

          <View style={s.btnRow}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [s.secondaryBtn, pressed && s.pressed]}
            >
              <Text style={s.secondaryText}>Not now</Text>
            </Pressable>
            <Pressable
              onPress={onViewSubscription || onClose}
              style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
            >
              <LinearGradient
                colors={["#F3DEA8", "#D9B56D", "#B8893F"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.primaryGradient}
              />
              <Ionicons name="sparkles-outline" size={16} color="#07111F" />
              <Text style={s.primaryText}>View subscription</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "rgba(1,8,22,0.82)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 21,
    paddingBottom: 18,
    overflow: "hidden",
    backgroundColor: "#07111F",
    borderWidth: 1.4,
    borderColor: "#D9B56D",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 24,
  },
  goldGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    right: -95,
    top: -120,
    backgroundColor: "rgba(217,181,109,0.16)",
  },
  goldGlowSoft: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    left: -75,
    bottom: -90,
    backgroundColor: "rgba(240,214,147,0.08)",
  },
  goldGlowCenter: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    alignSelf: "center",
    top: 28,
    backgroundColor: "rgba(217,181,109,0.06)",
  },
  topShine: {
    position: "absolute",
    left: 20,
    right: 20,
    top: 12,
    height: 1.2,
    borderRadius: 2,
    backgroundColor: "rgba(240,214,147,0.55)",
  },
  innerHighlight: {
    position: "absolute",
    left: 1.4,
    right: 1.4,
    top: 1.4,
    bottom: 1.4,
    borderRadius: 28.6,
    borderWidth: 1,
    borderColor: "rgba(240,214,147,0.14)",
  },
  iconStack: {
    alignSelf: "center",
    marginBottom: 12,
  },
  iconRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.6,
    borderColor: "rgba(217,181,109,0.62)",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  lockBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#07111F",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  kicker: {
    color: "#F0D693",
    fontWeight: "800",
    letterSpacing: 3.4,
    fontSize: 11,
    textAlign: "center",
    marginBottom: 6,
    textShadowColor: "rgba(217,181,109,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20.5,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.25,
    lineHeight: 25,
    marginBottom: 9,
  },
  messageWrap: {
    alignSelf: "center",
    maxWidth: "88%",
    marginBottom: 14,
  },
  message: {
    color: "#D8DDE8",
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: "600",
    textAlign: "center",
  },
  pillRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 15,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
  },
  pillLive: {
    borderColor: "rgba(52,211,153,0.32)",
  },
  pillMedia: {
    borderColor: "rgba(91,141,239,0.32)",
  },
  pillMinistry: {
    borderColor: "rgba(232,200,114,0.32)",
  },
  pillText: {
    fontWeight: "700",
    fontSize: 12.5,
    letterSpacing: 0.2,
  },
  pillTextLive: {
    color: "#A7F3D0",
  },
  pillTextMedia: {
    color: "#BFDBFE",
  },
  pillTextMinistry: {
    color: "#F5E6B8",
  },
  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  secondaryBtn: {
    flex: 0.86,
    height: 47,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(192,198,210,0.28)",
  },
  secondaryText: {
    color: "rgba(216,221,232,0.88)",
    fontWeight: "700",
    fontSize: 13.5,
  },
  primaryBtn: {
    flex: 1.16,
    height: 47,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    overflow: "hidden",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 12,
  },
  primaryGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  primaryText: {
    color: "#07111F",
    fontWeight: "800",
    fontSize: 13.5,
  },
  pressed: {
    opacity: 0.88,
  },
});
