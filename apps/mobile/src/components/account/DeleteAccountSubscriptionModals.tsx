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

const GOLD = "#D9B56D";
const GOLD_SOFT = "#F0D693";
const MUTED = "rgba(255,255,255,0.66)";
const DANGER = "#FF5A5F";
const DANGER_SOFT = "#FFB4B8";

export type DeleteAccountChoiceOption = "cancel_subscription" | "delete_only";

export type DeleteAccountFinalConfirmVariant =
  | "after_cancel_subscription"
  | "delete_only"
  | "standard";

type ChoiceModalProps = {
  visible: boolean;
  inlineStatusMessage?: string | null;
  processingOption?: DeleteAccountChoiceOption | null;
  disabled?: boolean;
  onSelectOption: (option: DeleteAccountChoiceOption) => void;
  onNotNow: () => void;
};

type FinalConfirmModalProps = {
  visible: boolean;
  variant: DeleteAccountFinalConfirmVariant;
  deleting?: boolean;
  onConfirm: () => void;
  onNotNow: () => void;
};

function useModalEntrance(visible: boolean) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0.92);
      fade.setValue(0);
      lift.setValue(18);
      return;
    }

    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }),
    ]).start();
  }, [visible, scale, fade, lift]);

  return { scale, fade, lift };
}

function PremiumBadge({
  label,
  tone = "gold",
}: {
  label: string;
  tone?: "gold" | "neutral" | "danger";
}) {
  return (
    <View
      style={[
        s.badge,
        tone === "gold" ? s.badgeGold : null,
        tone === "neutral" ? s.badgeNeutral : null,
        tone === "danger" ? s.badgeDanger : null,
      ]}
    >
      <Text
        style={[
          s.badgeText,
          tone === "gold" ? s.badgeTextGold : null,
          tone === "neutral" ? s.badgeTextNeutral : null,
          tone === "danger" ? s.badgeTextDanger : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function OptionCard({
  title,
  subtitle,
  badge,
  icon,
  tone = "gold",
  loading,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle: string;
  badge: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "gold" | "danger";
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const borderColor = tone === "danger" ? "rgba(255,90,95,0.34)" : "rgba(217,179,95,0.30)";
  const iconColor = tone === "danger" ? DANGER_SOFT : GOLD_SOFT;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        s.optionOuter,
        disabled || loading ? s.optionDisabled : null,
        pressed && !disabled && !loading ? s.pressed : null,
      ]}
    >
      <LinearGradient
        colors={
          tone === "danger"
            ? ["rgba(255,90,95,0.10)", "rgba(255,255,255,0.03)", "rgba(10,14,24,0.96)"]
            : ["rgba(196,171,114,0.10)", "rgba(255,255,255,0.04)", "rgba(10,14,24,0.96)"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.optionCard, { borderColor }]}
      >
        <View style={s.optionTopRow}>
          <View
            style={[
              s.optionIconWrap,
              tone === "danger" ? s.optionIconWrapDanger : s.optionIconWrapGold,
            ]}
          >
            <Ionicons name={icon} size={18} color={iconColor} />
          </View>
          <View style={s.optionCopy}>
            <Text style={s.optionTitle}>{title}</Text>
            <PremiumBadge label={badge} tone={tone === "danger" ? "danger" : "gold"} />
          </View>
          {loading ? (
            <ActivityIndicator size="small" color={iconColor} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.28)" />
          )}
        </View>
        <Text style={s.optionSubtitle}>{subtitle}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function DeleteAccountSubscriptionChoiceModal({
  visible,
  inlineStatusMessage,
  processingOption,
  disabled,
  onSelectOption,
  onNotNow,
}: ChoiceModalProps) {
  const insets = useSafeAreaInsets();
  const { scale, fade, lift } = useModalEntrance(visible);
  const storeBadge = Platform.OS === "ios" ? "Apple Subscription" : "Google Play Subscription";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNotNow}>
      <View style={[s.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={s.backdrop}
          onPress={disabled ? undefined : onNotNow}
          accessibilityLabel="Dismiss delete account options"
        />
        <Animated.View
          style={[s.shell, { opacity: fade, transform: [{ translateY: lift }, { scale }] }]}
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
          <View style={s.topShine} />

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            <View style={s.headerIconStack}>
              <LinearGradient
                colors={["rgba(240,214,147,0.22)", "rgba(217,181,109,0.10)", "rgba(196,154,69,0.06)"]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={s.headerIconRing}
              >
                <Ionicons name="shield-half-outline" size={26} color={GOLD_SOFT} />
              </LinearGradient>
              <View style={s.headerBadgeDanger}>
                <Ionicons name="trash-outline" size={11} color="#fff" />
              </View>
            </View>

            <Text style={s.kicker}>ACCOUNT PROTECTION</Text>
            <Text style={s.title}>Delete Account</Text>
            <Text style={s.message}>
              Choose how to handle your church's Media Premium subscription before deleting your
              personal account.
            </Text>

            {inlineStatusMessage ? (
              <View style={s.inlineStatus}>
                <Ionicons name="information-circle-outline" size={16} color={GOLD_SOFT} />
                <Text style={s.inlineStatusText}>{inlineStatusMessage}</Text>
              </View>
            ) : null}

            <View style={s.optionsStack}>
              <OptionCard
                title="Delete Account + Cancel Subscription"
                subtitle="Stop future renewals, then delete your account. Paid church access remains available until the current billing period expires."
                badge={storeBadge}
                icon="card-outline"
                tone="danger"
                loading={processingOption === "cancel_subscription"}
                disabled={disabled || processingOption === "delete_only"}
                onPress={() => onSelectOption("cancel_subscription")}
                accessibilityLabel="Delete account and cancel subscription"
              />
              <OptionCard
                title="Delete Account Only"
                subtitle="Delete your personal account while keeping the church's already-paid Media Premium access available until the current subscription period expires."
                badge="Keep Access Until Expiry"
                icon="person-remove-outline"
                loading={processingOption === "delete_only"}
                disabled={disabled || processingOption === "cancel_subscription"}
                onPress={() => onSelectOption("delete_only")}
                accessibilityLabel="Delete account only and keep church access until expiry"
              />
            </View>

            <Pressable
              onPress={onNotNow}
              disabled={disabled || Boolean(processingOption)}
              accessibilityRole="button"
              accessibilityLabel="Not now"
              style={({ pressed }) => [
                s.notNowBtn,
                pressed && !disabled && !processingOption ? s.pressed : null,
                (disabled || processingOption) && s.optionDisabled,
              ]}
            >
              <Text style={s.notNowText}>Not Now</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function resolveFinalCopy(variant: DeleteAccountFinalConfirmVariant) {
  if (variant === "after_cancel_subscription") {
    return {
      kicker: "FINAL CONFIRMATION",
      title: "Delete your account?",
      message:
        "Your store subscription is set to end after this billing period. Deleting your personal Kristo account is permanent and cannot be undone.",
      confirmLabel: "Delete Account",
    };
  }

  if (variant === "delete_only") {
    return {
      kicker: "FINAL CONFIRMATION",
      title: "Delete account only?",
      message:
        "Your personal account will be permanently deleted. The church's paid Media Premium access will remain available until its existing expiry date. Store billing may continue unless you cancel separately.",
      confirmLabel: "Delete Account",
    };
  }

  return {
    kicker: "FINAL CONFIRMATION",
    title: "Delete your account?",
    message:
      "This permanently deletes your Kristo account and signs you out. This action cannot be undone.",
    confirmLabel: "Delete Account",
  };
}

export function DeleteAccountFinalConfirmModal({
  visible,
  variant,
  deleting,
  onConfirm,
  onNotNow,
}: FinalConfirmModalProps) {
  const insets = useSafeAreaInsets();
  const { scale, fade, lift } = useModalEntrance(visible);
  const copy = resolveFinalCopy(variant);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNotNow}>
      <View style={[s.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={s.backdrop}
          onPress={deleting ? undefined : onNotNow}
          accessibilityLabel="Dismiss final delete confirmation"
        />
        <Animated.View
          style={[
            s.shell,
            s.finalShell,
            { opacity: fade, transform: [{ translateY: lift }, { scale }] },
          ]}
        >
          <LinearGradient
            colors={["#1A1018", "#0B0F17", "#050B14"]}
            locations={[0, 0.55, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={s.dangerGlow} />
          <View style={s.topShine} />

          <View style={s.finalContent}>
            <View style={s.finalIconWrap}>
              <Ionicons name="warning-outline" size={24} color={DANGER_SOFT} />
            </View>
            <Text style={s.finalKicker}>{copy.kicker}</Text>
            <Text style={s.finalTitle}>{copy.title}</Text>
            <Text style={s.finalMessage}>{copy.message}</Text>

            <View style={s.finalActions}>
              <Pressable
                onPress={onNotNow}
                disabled={deleting}
                accessibilityRole="button"
                accessibilityLabel="Not now"
                style={({ pressed }) => [
                  s.finalSecondaryBtn,
                  pressed && !deleting ? s.pressed : null,
                  deleting && s.optionDisabled,
                ]}
              >
                <Text style={s.finalSecondaryText}>Not Now</Text>
              </Pressable>

              <Pressable
                onPress={onConfirm}
                disabled={deleting}
                accessibilityRole="button"
                accessibilityLabel={copy.confirmLabel}
                style={({ pressed }) => [
                  s.finalDeleteBtn,
                  pressed && !deleting ? s.pressed : null,
                  deleting && s.optionDisabled,
                ]}
              >
                {deleting ? (
                  <View style={s.finalDeleteLoading}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={s.finalDeleteText}>Deleting...</Text>
                  </View>
                ) : (
                  <Text style={s.finalDeleteText}>{copy.confirmLabel}</Text>
                )}
              </Pressable>
            </View>
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
    backgroundColor: "rgba(1,8,22,0.84)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  shell: {
    maxHeight: "92%",
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.42)",
    backgroundColor: "#07111F",
    shadowColor: "#D9B56D",
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  finalShell: {
    borderColor: "rgba(255,90,95,0.42)",
    shadowColor: "#FF5A5F",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    gap: 14,
  },
  goldGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -70,
    top: -100,
    backgroundColor: "rgba(217,181,109,0.14)",
  },
  goldGlowSoft: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    left: -60,
    bottom: -70,
    backgroundColor: "rgba(240,214,147,0.07)",
  },
  dangerGlow: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    right: -60,
    top: -80,
    backgroundColor: "rgba(255,90,95,0.10)",
  },
  topShine: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  headerIconStack: {
    alignSelf: "center",
    width: 72,
    height: 72,
    marginBottom: 4,
  },
  headerIconRing: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(217,179,95,0.34)",
  },
  headerBadgeDanger: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DANGER,
    borderWidth: 2,
    borderColor: "#07111F",
  },
  kicker: {
    color: "rgba(217,179,95,0.88)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textAlign: "center",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  message: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  inlineStatus: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(217,179,95,0.24)",
  },
  inlineStatusText: {
    flex: 1,
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  optionsStack: {
    gap: 12,
    marginTop: 4,
  },
  optionOuter: {
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  optionCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    overflow: "hidden",
  },
  optionTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  optionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  optionIconWrapGold: {
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(217,179,95,0.24)",
  },
  optionIconWrapDanger: {
    backgroundColor: "rgba(255,90,95,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,90,95,0.24)",
  },
  optionCopy: {
    flex: 1,
    gap: 8,
  },
  optionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    lineHeight: 21,
  },
  optionSubtitle: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeGold: {
    backgroundColor: "rgba(217,179,95,0.10)",
    borderColor: "rgba(217,179,95,0.28)",
  },
  badgeNeutral: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  badgeDanger: {
    backgroundColor: "rgba(255,90,95,0.10)",
    borderColor: "rgba(255,90,95,0.24)",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  badgeTextGold: { color: GOLD_SOFT },
  badgeTextNeutral: { color: "rgba(255,255,255,0.72)" },
  badgeTextDanger: { color: DANGER_SOFT },
  notNowBtn: {
    alignSelf: "center",
    minHeight: 44,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  notNowText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  optionDisabled: {
    opacity: 0.55,
  },
  finalContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 18,
    gap: 12,
  },
  finalIconWrap: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,90,95,0.28)",
  },
  finalKicker: {
    color: "rgba(255,180,184,0.92)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textAlign: "center",
  },
  finalTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  finalMessage: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
  },
  finalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  finalSecondaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  finalSecondaryText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
  finalDeleteBtn: {
    flex: 1.15,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.92)",
  },
  finalDeleteText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },
  finalDeleteLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
