import React, { useEffect, useMemo, useRef } from "react";
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

import type { ChurchMediaSubscriptionOwnershipLock } from "../../lib/churchSubscriptionMediaSignals";
import { formatPremiumRenewalDate } from "../../lib/payments/mobileSubscriptions";

const GOLD = "#D9B35F";
const LABEL_GOLD = "rgba(217,179,95,0.82)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_MUTED = "rgba(255,255,255,0.62)";

export type SubscriptionStoreConflictModalVariant =
  | "ownership_lock"
  | "existing_subscription"
  | "existing_subscription_cancelled_until_expiry";

type SubscriptionStoreConflictModalProps = {
  visible: boolean;
  currentChurchId?: string | null;
  variant?: SubscriptionStoreConflictModalVariant;
  lock?: ChurchMediaSubscriptionOwnershipLock | null;
  managing?: boolean;
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
    </>
  );
}

function resolveStoreSubscriptionLabel(lock?: ChurchMediaSubscriptionOwnershipLock | null): string {
  if (lock?.store === "play_store") return "Google Play subscription";
  if (lock?.store === "app_store") return "Apple Subscription";
  return Platform.OS === "android" ? "Google Play subscription" : "Apple Subscription";
}

function resolveManageSubscriptionLabel(lock?: ChurchMediaSubscriptionOwnershipLock | null): string {
  if (lock?.store === "play_store") return "Manage Google Play Subscription";
  if (lock?.store === "app_store") return "Manage Apple Subscription";
  return Platform.OS === "android"
    ? "Manage Google Play Subscription"
    : "Manage Apple Subscription";
}

function resolveExistingSubscriptionExpiryLabel(
  lock?: ChurchMediaSubscriptionOwnershipLock | null
): string | null {
  const label = String(lock?.expiresAtLabel || "").trim();
  if (label) {
    return label.replace(/^(Sandbox )?expires /i, "").trim() || null;
  }
  if (typeof lock?.expiresAt === "number" && Number.isFinite(lock.expiresAt)) {
    return formatPremiumRenewalDate(new Date(lock.expiresAt));
  }
  return null;
}

function buildExistingSubscriptionMessage(lock?: ChurchMediaSubscriptionOwnershipLock | null): string {
  const lockedChurchName = String(lock?.lockedChurchName || "").trim();
  const storeIsPlay = lock?.store === "play_store";
  const storeLabel = storeIsPlay ? "Google Play subscription" : "Apple subscription";
  const manageTarget = storeIsPlay ? "Google Play" : "Apple";

  const linkedLine = lockedChurchName
    ? `Your existing subscription is linked to ${lockedChurchName}.`
    : `We found an existing ${storeLabel} linked to a previous Kristo church or account.`;

  return `${linkedLine} To use Media Premium with this church, first manage and cancel the previous subscription in ${manageTarget}. After the previous paid period ends, you can subscribe for this church.`;
}

function buildCancelledUntilExpiryMessage(
  lock?: ChurchMediaSubscriptionOwnershipLock | null
): string {
  const storeIsPlay = lock?.store === "play_store";
  const storeLabel = storeIsPlay ? "Google Play" : "Apple";
  const expiryDate = resolveExistingSubscriptionExpiryLabel(lock);
  const expiryClause = expiryDate
    ? `paid access remains active until ${expiryDate}`
    : "paid access remains active for the rest of the current billing period";

  return (
    `Your previous ${storeLabel} subscription is cancelled, but ${expiryClause} on the previous church or account. ` +
    "You can try subscribing this church if the store allows a new purchase. " +
    "The previous subscription will not transfer to this church."
  );
}

function buildConflictMessage(
  lock?: ChurchMediaSubscriptionOwnershipLock | null,
  variant: SubscriptionStoreConflictModalVariant = "ownership_lock"
): string {
  if (variant === "existing_subscription_cancelled_until_expiry") {
    return buildCancelledUntilExpiryMessage(lock);
  }
  if (variant === "existing_subscription") {
    return buildExistingSubscriptionMessage(lock);
  }

  const churchLabel = String(lock?.lockedChurchName || "a previous church").trim();
  const expiryLabel = String(lock?.expiresAtLabel || "").trim();
  const storeLabel = resolveStoreSubscriptionLabel(lock);

  const intro = `Your ${storeLabel} is still linked to "${churchLabel}". It cannot be activated for this church while the previous subscription ownership lock is active.`;

  if (lock?.willRenew === true) {
    const renewalNote = expiryLabel
      ? `To prevent another renewal, manage the subscription and cancel auto-renewal first. Paid access for the previous church remains until ${expiryLabel}.`
      : "To prevent another renewal, manage the subscription and cancel auto-renewal first.";
    return `${intro}\n\n${renewalNote}`;
  }

  if (lock?.willRenew === false) {
    const expiryNote = expiryLabel
      ? `Renewal is already off. Paid access for the previous church remains until ${expiryLabel}. This subscription cannot be moved to another church before that period ends.`
      : "Renewal is already off. This subscription cannot be moved to another church before the current paid period ends.";
    return `${intro}\n\n${expiryNote}`;
  }

  const fallbackNote = expiryLabel
    ? `Paid access for the previous church remains until ${expiryLabel}.`
    : "Manage your store subscription to review billing before trying again.";
  return `${intro}\n\n${fallbackNote}`;
}

export function SubscriptionStoreConflictModal({
  visible,
  currentChurchId,
  variant = "ownership_lock",
  lock,
  managing,
  disabled,
  onManageSubscription,
  onNotNow,
}: SubscriptionStoreConflictModalProps) {
  const insets = useSafeAreaInsets();
  const { scale, fade, lift } = useModalEntrance(visible);
  const message = useMemo(() => buildConflictMessage(lock, variant), [lock, variant]);
  const manageLabel = useMemo(() => resolveManageSubscriptionLabel(lock), [lock]);
  const expiryLabel = String(lock?.expiresAtLabel || "").trim();
  const showExpiryBadge =
    variant === "ownership_lock" && Boolean(expiryLabel);
  const modalTitle =
    variant === "existing_subscription_cancelled_until_expiry"
      ? "Subscription Already Cancelled"
      : "Existing Subscription Found";
  const modalEyebrow =
    variant === "existing_subscription_cancelled_until_expiry"
      ? "CANCELLED SUBSCRIPTION"
      : variant === "existing_subscription"
        ? "EXISTING SUBSCRIPTION"
        : "SUBSCRIPTION LINKED";

  useEffect(() => {
    if (!visible) return;

    if (variant === "existing_subscription_cancelled_until_expiry") {
      console.log("KRISTO_SUBSCRIPTION_EXISTING_CANCELLED_UNTIL_EXPIRY_MODAL_OPENED", {
        currentChurchId: String(currentChurchId || "").trim() || null,
        lockedChurchId: lock?.lockedChurchId ?? null,
        lockedChurchName: lock?.lockedChurchName ?? null,
        store: lock?.store ?? null,
        willRenew: lock?.willRenew ?? null,
        expiresAt: lock?.expiresAt ?? null,
        expiresAtLabel: lock?.expiresAtLabel ?? null,
      });
      return;
    }

    if (variant === "existing_subscription") {
      console.log("KRISTO_SUBSCRIPTION_EXISTING_SUBSCRIPTION_MODAL_OPENED", {
        currentChurchId: String(currentChurchId || "").trim() || null,
        lockedChurchId: lock?.lockedChurchId ?? null,
        lockedChurchName: lock?.lockedChurchName ?? null,
        store: lock?.store ?? null,
        willRenew: lock?.willRenew ?? null,
        expiresAt: lock?.expiresAt ?? null,
      });
      return;
    }

    if (!lock?.blocked) return;

    console.log("KRISTO_SUBSCRIPTION_CONFLICT_MODAL_OPENED", {
      currentChurchId: String(currentChurchId || "").trim() || null,
      lockedChurchId: lock.lockedChurchId ?? null,
      lockedChurchName: lock.lockedChurchName ?? null,
      store: lock.store ?? null,
      willRenew: lock.willRenew ?? null,
      expiresAt: lock.expiresAt ?? null,
    });
  }, [visible, variant, lock, currentChurchId]);

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
          onPress={disabled || managing ? undefined : onNotNow}
          accessibilityLabel="Dismiss subscription conflict notice"
        />
        <Animated.View
          style={[s.powerCard, { opacity: fade, transform: [{ translateY: lift }, { scale }] }]}
          accessibilityRole="alert"
        >
          <PowerCardChrome />
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
            <View style={s.headerBlock}>
              <View style={s.iconOuter}>
                <View style={s.iconRing} pointerEvents="none" />
                <LinearGradient
                  colors={["#F2D792", GOLD, "#9A7428"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.iconTile}
                >
                  <Ionicons name="link-outline" size={24} color="#0A0E16" />
                </LinearGradient>
              </View>

              {showExpiryBadge ? (
                <View style={s.statusBadge}>
                  <View style={s.statusBadgeDot} />
                  <Text style={s.statusBadgeText}>Paid access until {expiryLabel}</Text>
                </View>
              ) : null}

              <Text style={s.powerEyebrow}>{modalEyebrow}</Text>
              <Text style={s.powerTitle}>{modalTitle}</Text>
              <Text style={s.powerMessage}>{message}</Text>
            </View>

            <View style={s.actions}>
              <Pressable
                onPress={onManageSubscription}
                disabled={disabled || managing}
                accessibilityRole="button"
                accessibilityLabel={manageLabel}
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
                  {managing ? (
                    <ActivityIndicator size="small" color="#0B0F17" />
                  ) : (
                    <Text style={s.goldCtaText}>{manageLabel}</Text>
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
  backdrop: { ...StyleSheet.absoluteFillObject },
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, gap: 12 },
  headerBlock: { alignItems: "center", gap: 8 },
  iconOuter: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
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
  actions: { width: "100%", gap: 10, marginTop: 2 },
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
    paddingHorizontal: 16,
  },
  goldCtaText: {
    color: "#0B0F17",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.15,
  },
  notNowOuter: { borderRadius: 16 },
  notNowPill: {
    minHeight: 46,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  notNowText: {
    color: LABEL_GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  ctaPressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.55 },
});
