import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GOLD = "#D9B35F";
const LABEL_GOLD = "rgba(217,179,95,0.82)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_MUTED = "rgba(255,255,255,0.62)";

type DeleteChurchSubscriptionModalProps = {
  visible: boolean;
  managing?: boolean;
  inlineStatusMessage?: string | null;
  paidAccessExpiresAtLabel?: string | null;
  disabled?: boolean;
  onManageSubscription: () => void;
  onNotNow: () => void;
};

function useModalEntrance(visible: boolean) {
  const scale = useRef(new Animated.Value(0.94)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0.94);
      fade.setValue(0);
      lift.setValue(14);
      return;
    }

    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }),
      Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }),
    ]).start();
  }, [visible, scale, fade, lift]);

  return { scale, fade, lift };
}

function useGoldGlowPulse(visible: boolean) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1900,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [visible, pulse]);

  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.62],
  });
  const glowScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.1],
  });

  return { glowOpacity, glowScale };
}

function PowerCardChrome() {
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.10)", "rgba(10,16,28,0.97)", "rgba(4,7,12,0.99)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={s.ambientGlowTop} />
      <View pointerEvents="none" style={s.ambientGlowBottom} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.55)", "rgba(217,179,95,0.12)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.topGoldLine}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.06)", "rgba(255,255,255,0.015)", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.5 }}
        style={s.powerSheen}
      />
    </>
  );
}

export function DeleteChurchSubscriptionModal({
  visible,
  managing,
  inlineStatusMessage,
  paidAccessExpiresAtLabel,
  disabled,
  onManageSubscription,
  onNotNow,
}: DeleteChurchSubscriptionModalProps) {
  const insets = useSafeAreaInsets();
  const { scale, fade, lift } = useModalEntrance(visible);
  const { glowOpacity, glowScale } = useGoldGlowPulse(visible);
  const storeLabel = Platform.OS === "ios" ? "Apple" : "Google Play";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onNotNow}
      accessibilityViewIsModal
    >
      <View style={[s.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={s.backdrop}
          onPress={disabled ? undefined : onNotNow}
          accessibilityLabel="Dismiss church delete subscription notice"
        />
        <Animated.View
          style={[s.powerCard, { opacity: fade, transform: [{ translateY: lift }, { scale }] }]}
          accessibilityRole="alert"
          accessibilityLabel="Active Media Premium subscription blocks church deletion"
        >
          <PowerCardChrome />
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            <View style={s.headerBlock}>
              <View style={s.iconOuter}>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    s.iconGlow,
                    { opacity: glowOpacity, transform: [{ scale: glowScale }] },
                  ]}
                />
                <View style={s.iconRing} pointerEvents="none" />
                <LinearGradient
                  colors={["#F2D792", GOLD, "#9A7428"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.iconTile}
                >
                  <Ionicons name="card-outline" size={24} color="#0A0E16" />
                </LinearGradient>
              </View>

              <View style={s.statusBadge}>
                <View style={s.statusBadgeDot} />
                <Text style={s.statusBadgeText}>Subscription Active</Text>
              </View>

              <Text style={s.powerEyebrow}>MEDIA PREMIUM</Text>
              <Text style={s.powerTitle}>Active Subscription</Text>
              <Text style={s.powerMessage}>
                This church still has active Media Premium. Cancel renewal first or wait until this
                paid period ends before deleting this church.
              </Text>
              {paidAccessExpiresAtLabel ? (
                <Text style={s.expiryText}>
                  Paid access remains until {paidAccessExpiresAtLabel}.
                </Text>
              ) : null}
              <Text style={s.storeHint}>
                Manage billing in {storeLabel} to turn off renewal and avoid losing paid access.
              </Text>
            </View>

            {inlineStatusMessage ? (
              <View
                style={s.inlineStatus}
                accessibilityRole="text"
                accessibilityLabel={inlineStatusMessage}
              >
                <Ionicons name="information-circle-outline" size={14} color={GOLD} />
                <Text style={s.inlineStatusText}>{inlineStatusMessage}</Text>
              </View>
            ) : null}

            <View style={s.actions}>
              <Pressable
                onPress={onManageSubscription}
                disabled={disabled || managing}
                accessibilityRole="button"
                accessibilityLabel="Manage church Media Premium subscription"
                style={({ pressed }) => [
                  s.goldCtaOuter,
                  pressed && !disabled && !managing ? s.ctaPressed : null,
                  (disabled || managing) && s.disabled,
                ]}
              >
                <LinearGradient
                  colors={["#F2D792", GOLD, "#A67C2E"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.goldCta}
                >
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(255,255,255,0.34)", "transparent"]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 0.55 }}
                    style={s.goldCtaShimmer}
                  />
                  {managing ? (
                    <ActivityIndicator size="small" color="#0B0F17" />
                  ) : (
                    <Text style={s.goldCtaText}>Manage Subscription</Text>
                  )}
                </LinearGradient>
              </Pressable>

              <Pressable
                onPress={onNotNow}
                disabled={disabled || managing}
                accessibilityRole="button"
                accessibilityLabel="Not now"
                style={({ pressed }) => [
                  s.notNowOuter,
                  pressed && !disabled && !managing ? s.ctaPressed : null,
                  (disabled || managing) && s.disabled,
                ]}
              >
                <View style={s.notNowPill}>
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(217,179,95,0.06)", "rgba(8,12,20,0.92)", "rgba(4,7,12,0.98)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(255,255,255,0.07)", "transparent"]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={s.optionHighlight}
                  />
                  <Text style={s.notNowText}>Not Now</Text>
                </View>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    backgroundColor: "rgba(1,6,18,0.88)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  powerCard: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 360,
    maxHeight: "90%",
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.36)",
    backgroundColor: "#060A12",
    shadowColor: GOLD,
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  ambientGlowTop: {
    position: "absolute",
    top: -28,
    right: -18,
    width: 110,
    height: 110,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  ambientGlowBottom: {
    position: "absolute",
    bottom: -32,
    left: -20,
    width: 90,
    height: 90,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  topGoldLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  powerSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 36,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 12,
  },
  headerBlock: {
    alignItems: "center",
    gap: 8,
  },
  iconOuter: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  iconGlow: {
    position: "absolute",
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(217,179,95,0.22)",
  },
  iconRing: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "rgba(217,179,95,0.55)",
  },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  statusBadgeText: {
    color: "rgba(240,214,147,0.94)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  powerEyebrow: {
    color: LABEL_GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  powerTitle: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.15,
    lineHeight: 24,
    textAlign: "center",
  },
  powerMessage: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    textAlign: "center",
  },
  expiryText: {
    color: "rgba(240,214,147,0.88)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "center",
  },
  storeHint: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
    textAlign: "center",
  },
  inlineStatus: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: "rgba(217,179,95,0.07)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  inlineStatusText: {
    flex: 1,
    color: "rgba(255,255,255,0.90)",
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  actions: {
    width: "100%",
    gap: 10,
    marginTop: 2,
  },
  goldCtaOuter: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  goldCta: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 16,
  },
  goldCtaShimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 22,
  },
  goldCtaText: {
    color: "#0B0F17",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.15,
  },
  notNowOuter: {
    alignSelf: "center",
    borderRadius: 16,
    shadowColor: GOLD,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  notNowPill: {
    minHeight: 42,
    minWidth: 140,
    paddingHorizontal: 22,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  optionHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 18,
  },
  notNowText: {
    color: LABEL_GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  ctaPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.55,
  },
});
