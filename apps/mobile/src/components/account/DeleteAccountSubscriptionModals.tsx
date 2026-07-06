import React, { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
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
const GOLD_BRIGHT = "#F0D48A";
const LABEL_GOLD = "rgba(217,179,95,0.82)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_MUTED = "rgba(255,255,255,0.62)";
const PINK_SOFT = "#FFC8CE";
const WINE_ACCENT = "#FF8A96";

export type DeleteAccountChoiceOption = "cancel_subscription" | "delete_only";

export type DeleteAccountFinalConfirmVariant =
  | "after_cancel_subscription"
  | "delete_only"
  | "lock_holder"
  | "member"
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
  const scale = useRef(new Animated.Value(0.96)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0.96);
      fade.setValue(0);
      lift.setValue(12);
      return;
    }

    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 5 }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 5 }),
    ]).start();
  }, [visible, scale, fade, lift]);

  return { scale, fade, lift };
}

function PowerCardChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={["#0B1220", "#060A12", "#020408"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.07)", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.35 }}
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
      {children}
    </>
  );
}

function PremiumBadge({
  label,
  tone = "gold",
}: {
  label: string;
  tone?: "gold" | "pink";
}) {
  return (
    <View
      style={[
        s.badge,
        tone === "gold" ? s.badgeGold : null,
        tone === "pink" ? s.badgePink : null,
      ]}
    >
      <Text
        style={[
          s.badgeText,
          tone === "gold" ? s.badgeTextGold : null,
          tone === "pink" ? s.badgeTextPink : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function ActionIconRing({
  icon,
  iconColor,
  glowColor,
  ringColor,
  tileColors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  glowColor: string;
  ringColor: string;
  tileColors: [string, string, ...string[]];
}) {
  return (
    <View style={s.actionIconOuter}>
      <View style={[s.actionIconGlow, { backgroundColor: glowColor }]} pointerEvents="none" />
      <View style={[s.actionIconRing, { borderColor: ringColor }]} pointerEvents="none" />
      <LinearGradient
        colors={tileColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.actionIconTile}
      >
        <Ionicons name={icon} size={22} color={iconColor} />
      </LinearGradient>
    </View>
  );
}

function WineGlassOptionCard({
  title,
  subtitle,
  badge,
  loading,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle: string;
  badge: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        s.wineOptionOuter,
        disabled || loading ? s.optionDisabled : null,
        pressed && !disabled && !loading ? s.pressed : null,
      ]}
    >
      <View style={s.wineOptionCard}>
        <LinearGradient
          pointerEvents="none"
          colors={[
            "rgba(88,24,42,0.42)",
            "rgba(36,12,22,0.88)",
            "rgba(8,6,12,0.98)",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,140,155,0.10)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,255,255,0.07)", "transparent"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={s.optionHighlight}
        />
        <View style={s.optionRow}>
          <ActionIconRing
            icon="remove-circle-outline"
            iconColor={PINK_SOFT}
            glowColor="rgba(255,100,120,0.22)"
            ringColor="rgba(255,140,155,0.42)"
            tileColors={[
              "rgba(120,28,48,0.95)",
              "rgba(52,14,28,0.98)",
              "rgba(12,6,10,0.99)",
            ]}
          />
          <View style={s.optionCopy}>
            <Text style={s.optionTitle}>{title}</Text>
            <PremiumBadge label={badge} tone="pink" />
            <Text style={s.optionSubtitle}>{subtitle}</Text>
          </View>
          <View style={s.optionTrailing}>
            {loading ? (
              <ActivityIndicator size="small" color={GOLD} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={GOLD} />
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function GoldGlassOptionCard({
  title,
  subtitle,
  badge,
  loading,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle: string;
  badge: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        s.goldGlassOuter,
        disabled || loading ? s.optionDisabled : null,
        pressed && !disabled && !loading ? s.pressed : null,
      ]}
    >
      <View style={s.goldGlassCard}>
        <LinearGradient
          pointerEvents="none"
          colors={[
            "rgba(217,179,95,0.16)",
            "rgba(18,14,10,0.92)",
            "rgba(4,7,12,0.98)",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(240,212,138,0.08)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,255,255,0.08)", "transparent"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={s.optionHighlight}
        />
        <View style={s.optionRow}>
          <ActionIconRing
            icon="person-remove-outline"
            iconColor={GOLD_BRIGHT}
            glowColor="rgba(217,179,95,0.28)"
            ringColor="rgba(217,179,95,0.50)"
            tileColors={[
              "rgba(48,38,18,0.96)",
              "rgba(22,18,10,0.98)",
              "rgba(8,8,12,0.99)",
            ]}
          />
          <View style={s.optionCopy}>
            <Text style={s.optionTitle}>{title}</Text>
            <PremiumBadge label={badge} tone="gold" />
            <Text style={s.optionSubtitle}>{subtitle}</Text>
          </View>
          <View style={s.optionTrailing}>
            {loading ? (
              <ActivityIndicator size="small" color={GOLD} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={GOLD} />
            )}
          </View>
        </View>
      </View>
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
      <View style={[s.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={s.backdrop}
          onPress={disabled ? undefined : onNotNow}
          accessibilityLabel="Dismiss delete account options"
        />
        <Animated.View
          style={[s.powerCard, { opacity: fade, transform: [{ translateY: lift }, { scale }] }]}
        >
          <PowerCardChrome>
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={s.scrollContent}
            >
              <View style={s.powerTop}>
                <View style={s.headerIconOuter}>
                  <View style={s.headerIconGlow} pointerEvents="none" />
                  <View style={s.headerIconRing} pointerEvents="none" />
                  <LinearGradient
                    colors={["#F2D792", GOLD, "#9A7428"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.headerIconTile}
                  >
                    <Ionicons name="shield-half-outline" size={22} color="#0A0E16" />
                  </LinearGradient>
                  <View style={s.headerBadgeDanger}>
                    <Ionicons name="trash-outline" size={9} color="#fff" />
                  </View>
                </View>
                <View style={s.headerCopy}>
                  <Text style={s.powerEyebrow}>ACCOUNT PROTECTION</Text>
                  <Text style={s.powerTitle}>Delete Account</Text>
                  <Text style={s.powerMessage}>
                    Choose what happens to your church subscription when deleting your personal
                    account.
                  </Text>
                </View>
              </View>

              {inlineStatusMessage ? (
                <View style={s.inlineStatus}>
                  <Ionicons name="information-circle-outline" size={14} color={GOLD} />
                  <Text style={s.inlineStatusText}>{inlineStatusMessage}</Text>
                </View>
              ) : null}

              <View style={s.optionsStack}>
                <WineGlassOptionCard
                  title="Delete Account + Cancel Subscription"
                  subtitle="Cancel future renewals, then delete your account. Church access continues until the paid period ends."
                  badge={storeBadge}
                  loading={processingOption === "cancel_subscription"}
                  disabled={disabled || processingOption === "delete_only"}
                  onPress={() => onSelectOption("cancel_subscription")}
                  accessibilityLabel="Delete account and cancel subscription"
                />
                <GoldGlassOptionCard
                  title="Delete Account Only"
                  subtitle="Delete your personal account while the church keeps its paid Media Premium access until expiry."
                  badge="Keep Access Until Expiry"
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
                  s.notNowOuter,
                  pressed && !disabled && !processingOption ? s.pressed : null,
                  (disabled || processingOption) && s.optionDisabled,
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
            </ScrollView>
          </PowerCardChrome>
        </Animated.View>
      </View>
    </Modal>
  );
}

type LockHolderModalProps = {
  visible: boolean;
  disabled?: boolean;
  managing?: boolean;
  inlineStatusMessage?: string | null;
  onManageSubscription: () => void;
  onDeleteAccount: () => void;
  onNotNow: () => void;
};

type PastorOwnsChurchModalProps = {
  visible: boolean;
  churches: Array<{ churchId: string; churchName: string | null }>;
  sessionChurchId?: string | null;
  sessionChurchName?: string | null;
  sessionChurchAvatarUrl?: string | null;
  disabled?: boolean;
  onGoToChurch: () => void;
  onNotNow: () => void;
};

function isInternalChurchIdLabel(value: string | null | undefined): boolean {
  return /^CH7-/i.test(String(value || "").trim());
}

function resolvePastorOwnedChurchDisplay(args: {
  churches: Array<{ churchId: string; churchName: string | null }>;
  sessionChurchId?: string | null;
  sessionChurchName?: string | null;
  sessionChurchAvatarUrl?: string | null;
}): { churchName: string; churchAvatarUrl: string | null } {
  const sessionChurchId = String(args.sessionChurchId || "").trim();
  const matched =
    (sessionChurchId
      ? args.churches.find(
          (row) =>
            String(row.churchId || "")
              .trim()
              .toUpperCase() === sessionChurchId.toUpperCase()
        )
      : null) || args.churches[0];

  const sessionName = String(args.sessionChurchName || "").trim();
  const apiName = String(matched?.churchName || "").trim();

  let churchName = "Your church";
  if (apiName && !isInternalChurchIdLabel(apiName)) {
    churchName = apiName;
  } else if (sessionName && !isInternalChurchIdLabel(sessionName)) {
    churchName = sessionName;
  }

  const matchedChurchId = String(matched?.churchId || sessionChurchId || "").trim();
  const avatarFromSession = String(args.sessionChurchAvatarUrl || "").trim() || null;
  const churchAvatarUrl =
    sessionChurchId &&
    matchedChurchId &&
    sessionChurchId.toUpperCase() === matchedChurchId.toUpperCase()
      ? avatarFromSession
      : null;

  return { churchName, churchAvatarUrl };
}

function PastorChurchAvatar({
  churchName,
  churchAvatarUrl,
}: {
  churchName: string;
  churchAvatarUrl: string | null;
}) {
  if (churchAvatarUrl) {
    return (
      <Image
        source={{ uri: churchAvatarUrl }}
        style={s.pastorChurchAvatarImage}
        resizeMode="cover"
        accessibilityLabel={`${churchName} church logo`}
      />
    );
  }

  return (
    <LinearGradient
      colors={["#F2D792", GOLD, "#9A7428"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.pastorChurchAvatarFallback}
    >
      <Ionicons name="business-outline" size={22} color="#0A0E16" />
    </LinearGradient>
  );
}

export function DeleteAccountPastorOwnsChurchModal({
  visible,
  churches,
  sessionChurchId,
  sessionChurchName,
  sessionChurchAvatarUrl,
  disabled,
  onGoToChurch,
  onNotNow,
}: PastorOwnsChurchModalProps) {
  const insets = useSafeAreaInsets();
  const { scale, fade, lift } = useModalEntrance(visible);
  const displayChurch = useMemo(
    () =>
      resolvePastorOwnedChurchDisplay({
        churches,
        sessionChurchId,
        sessionChurchName,
        sessionChurchAvatarUrl,
      }),
    [churches, sessionChurchAvatarUrl, sessionChurchId, sessionChurchName]
  );

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
          accessibilityLabel="Dismiss delete account church ownership notice"
        />
        <Animated.View
          style={[s.powerCard, { opacity: fade, transform: [{ translateY: lift }, { scale }] }]}
          accessibilityRole="alert"
        >
          <PowerCardChrome />
          <View style={s.pastorChurchModalContent}>
            <View style={s.pastorChurchHeader}>
              <Text style={s.powerEyebrow}>CHURCH STILL ACTIVE</Text>
              <Text style={s.pastorChurchTitle}>Delete your church first</Text>
              <Text style={s.pastorChurchIntro}>
                Before deleting your Kristo account, you must first delete the church you manage.
              </Text>
            </View>

            <View style={s.pastorChurchIdentityRow}>
              <View style={s.pastorChurchAvatarOuter}>
                <View style={s.pastorChurchAvatarRing} pointerEvents="none" />
                <PastorChurchAvatar
                  churchName={displayChurch.churchName}
                  churchAvatarUrl={displayChurch.churchAvatarUrl}
                />
              </View>
              <View style={s.pastorChurchIdentityCopy}>
                <Text style={s.pastorChurchName} numberOfLines={2}>
                  {displayChurch.churchName}
                </Text>
                <Text style={s.pastorChurchManagedLabel}>Managed by you</Text>
              </View>
            </View>

            <Text style={s.pastorChurchPremiumNote}>
              If Media Premium is active, cancel renewal first. Then go to Church Settings and
              delete the church before returning to delete your account.
            </Text>

            <View style={s.pastorChurchActions}>
              <Pressable
                onPress={onGoToChurch}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Go to church settings"
                style={({ pressed }) => [
                  s.pastorChurchGoldCtaOuter,
                  pressed && !disabled ? s.pressed : null,
                  disabled && s.optionDisabled,
                ]}
              >
                <LinearGradient
                  colors={["#F2D792", GOLD, "#A67C2E"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.pastorChurchGoldCta}
                >
                  <Text style={s.pastorChurchGoldCtaText}>Go to Church Settings</Text>
                </LinearGradient>
              </Pressable>

              <Pressable
                onPress={onNotNow}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Not now"
                style={({ pressed }) => [
                  s.pastorChurchNotNowOuter,
                  pressed && !disabled ? s.pressed : null,
                  disabled && s.optionDisabled,
                ]}
              >
                <View style={s.pastorChurchNotNowPill}>
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(217,179,95,0.06)", "rgba(8,12,20,0.92)", "rgba(4,7,12,0.98)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <Text style={s.pastorChurchNotNowText}>Not Now</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function DeleteAccountLockHolderModal({
  visible,
  disabled,
  managing,
  inlineStatusMessage,
  onManageSubscription,
  onDeleteAccount,
  onNotNow,
}: LockHolderModalProps) {
  const insets = useSafeAreaInsets();
  const { scale, fade, lift } = useModalEntrance(visible);
  const storeLabel = Platform.OS === "ios" ? "Apple" : "Google";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNotNow}>
      <View style={[s.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={s.backdrop}
          onPress={disabled ? undefined : onNotNow}
          accessibilityLabel="Dismiss subscription linked delete account options"
        />
        <Animated.View
          style={[s.lockHolderCard, { opacity: fade, transform: [{ translateY: lift }, { scale }] }]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={["#0B1220", "#060A12", "#020408"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(217,179,95,0.45)", "rgba(217,179,95,0.10)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.topGoldLine}
          />

          <View style={s.lockHolderContent}>
            <View style={s.lockHolderIconWrap}>
              <Ionicons name="card-outline" size={22} color={GOLD} />
            </View>
            <Text style={s.lockHolderKicker}>SUBSCRIPTION LINKED</Text>
            <Text style={s.lockHolderTitle}>Delete Account</Text>
            <Text style={s.lockHolderMessage}>
              This account is linked to a store subscription for this church. Deleting your account
              will not automatically cancel {storeLabel} billing.
            </Text>

            {inlineStatusMessage ? (
              <View style={s.inlineStatus}>
                <Ionicons name="information-circle-outline" size={14} color={GOLD} />
                <Text style={s.inlineStatusText}>{inlineStatusMessage}</Text>
              </View>
            ) : null}

            <View style={s.lockHolderActions}>
              <Pressable
                onPress={onManageSubscription}
                disabled={disabled || managing}
                accessibilityRole="button"
                accessibilityLabel="Manage subscription"
                style={({ pressed }) => [
                  s.lockHolderManageBtn,
                  pressed && !disabled && !managing ? s.pressed : null,
                  (disabled || managing) && s.optionDisabled,
                ]}
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(217,179,95,0.10)", "rgba(8,12,20,0.94)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                {managing ? (
                  <ActivityIndicator size="small" color={GOLD} />
                ) : (
                  <Text style={s.lockHolderManageText}>Manage Subscription</Text>
                )}
              </Pressable>

              <Pressable
                onPress={onDeleteAccount}
                disabled={disabled || managing}
                accessibilityRole="button"
                accessibilityLabel="Delete account"
                style={({ pressed }) => [
                  s.lockHolderDeleteBtn,
                  pressed && !disabled && !managing ? s.pressed : null,
                  (disabled || managing) && s.optionDisabled,
                ]}
              >
                <Text style={s.lockHolderDeleteText}>Delete Account</Text>
              </Pressable>

              <Pressable
                onPress={onNotNow}
                disabled={disabled || managing}
                accessibilityRole="button"
                accessibilityLabel="Not now"
                style={({ pressed }) => [
                  s.lockHolderNotNowBtn,
                  pressed && !disabled && !managing ? s.pressed : null,
                  (disabled || managing) && s.optionDisabled,
                ]}
              >
                <Text style={s.lockHolderNotNowText}>Not Now</Text>
              </Pressable>
            </View>
          </View>
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

  if (variant === "member") {
    return {
      kicker: "FINAL CONFIRMATION",
      title: "Delete your account?",
      message:
        "Your personal account will be deleted. Your church's subscription is managed by the church owner and will not be changed.",
      confirmLabel: "Delete Account",
    };
  }

  if (variant === "lock_holder") {
    return {
      kicker: "FINAL CONFIRMATION",
      title: "Delete your account?",
      message:
        "This permanently deletes your Kristo account. Your store subscription may continue billing until you cancel it in Apple or Google settings.",
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
      <View style={[s.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={s.backdrop}
          onPress={deleting ? undefined : onNotNow}
          accessibilityLabel="Dismiss final delete confirmation"
        />
        <Animated.View
          style={[
            s.powerCard,
            s.finalCard,
            { opacity: fade, transform: [{ translateY: lift }, { scale }] },
          ]}
        >
          <PowerCardChrome>
            <View style={s.finalContent}>
              <View style={s.powerTop}>
                <View style={s.headerIconOuter}>
                  <View style={[s.headerIconGlow, s.finalHeaderGlow]} pointerEvents="none" />
                  <View style={[s.headerIconRing, s.finalHeaderRing]} pointerEvents="none" />
                  <LinearGradient
                    colors={[
                      "rgba(120,28,48,0.95)",
                      "rgba(52,14,28,0.98)",
                      "rgba(12,6,10,0.99)",
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.headerIconTile}
                  >
                    <Ionicons name="warning-outline" size={22} color={PINK_SOFT} />
                  </LinearGradient>
                </View>
                <View style={s.headerCopy}>
                  <Text style={[s.powerEyebrow, s.finalEyebrow]}>{copy.kicker}</Text>
                  <Text style={s.powerTitle}>{copy.title}</Text>
                  <Text style={s.powerMessage}>{copy.message}</Text>
                </View>
              </View>

              <View style={s.finalActions}>
                <Pressable
                  onPress={onNotNow}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel="Not now"
                  style={({ pressed }) => [
                    s.finalSecondaryOuter,
                    pressed && !deleting ? s.pressed : null,
                    deleting && s.optionDisabled,
                  ]}
                >
                  <View style={s.finalSecondaryBtn}>
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(217,179,95,0.05)", "rgba(8,12,20,0.92)"]}
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
                    <Text style={s.finalSecondaryText}>Not Now</Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={onConfirm}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel={copy.confirmLabel}
                  style={({ pressed }) => [
                    s.finalDeleteWrap,
                    pressed && !deleting ? s.pressed : null,
                    deleting && s.optionDisabled,
                  ]}
                >
                  <LinearGradient
                    colors={[
                      "rgba(140,32,48,0.96)",
                      "rgba(100,22,36,0.98)",
                      "rgba(52,10,20,0.99)",
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.finalDeleteBtn}
                  >
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,140,155,0.12)", "transparent"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={s.optionHighlight}
                    />
                    {deleting ? (
                      <View style={s.finalDeleteLoading}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={s.finalDeleteText}>Deleting...</Text>
                      </View>
                    ) : (
                      <Text style={s.finalDeleteText}>{copy.confirmLabel}</Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </PowerCardChrome>
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
  finalCard: {
    borderColor: "rgba(217,179,95,0.32)",
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
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
  },
  powerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  headerIconOuter: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconGlow: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(217,179,95,0.20)",
  },
  finalHeaderGlow: {
    backgroundColor: "rgba(255,100,120,0.14)",
  },
  headerIconRing: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.55)",
  },
  finalHeaderRing: {
    borderColor: "rgba(255,140,155,0.38)",
  },
  headerIconTile: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBadgeDanger: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(180,36,52,0.95)",
    borderWidth: 2,
    borderColor: "#060A12",
  },
  headerCopy: {
    flex: 1,
    gap: 4,
    paddingTop: 4,
  },
  powerEyebrow: {
    color: LABEL_GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  finalEyebrow: {
    color: "rgba(255,180,190,0.90)",
  },
  powerTitle: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.15,
    lineHeight: 21,
  },
  powerMessage: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
    marginTop: 1,
  },
  inlineStatus: {
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
  optionsStack: {
    gap: 10,
  },
  wineOptionOuter: {
    borderRadius: 16,
    shadowColor: WINE_ACCENT,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  wineOptionCard: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,130,145,0.26)",
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  goldGlassOuter: {
    borderRadius: 16,
    shadowColor: GOLD,
    shadowOpacity: 0.26,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  goldGlassCard: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.38)",
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  optionHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 20,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionIconOuter: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconGlow: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  actionIconRing: {
    position: "absolute",
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
  },
  actionIconTile: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  optionCopy: {
    flex: 1,
    gap: 5,
  },
  optionTrailing: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.1,
    lineHeight: 17,
  },
  optionSubtitle: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  badgeGold: {
    backgroundColor: "rgba(217,179,95,0.10)",
    borderColor: "rgba(217,179,95,0.28)",
  },
  badgePink: {
    backgroundColor: "rgba(255,130,145,0.10)",
    borderColor: "rgba(255,150,165,0.24)",
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  badgeTextGold: { color: "rgba(240,214,147,0.94)" },
  badgeTextPink: { color: "rgba(255,200,208,0.94)" },
  notNowOuter: {
    alignSelf: "center",
    marginTop: 2,
    borderRadius: 16,
    shadowColor: GOLD,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
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
    borderColor: "rgba(217,179,95,0.32)",
  },
  notNowText: {
    color: LABEL_GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  optionDisabled: {
    opacity: 0.55,
  },
  finalContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 14,
  },
  finalActions: {
    flexDirection: "row",
    gap: 8,
  },
  finalSecondaryOuter: {
    flex: 1,
    borderRadius: 16,
    shadowColor: GOLD,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  finalSecondaryBtn: {
    minHeight: 46,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  finalSecondaryText: {
    color: TEXT_PRIMARY,
    fontWeight: "800",
    fontSize: 12,
  },
  finalDeleteWrap: {
    flex: 1.1,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: WINE_ACCENT,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  finalDeleteBtn: {
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,130,145,0.28)",
    overflow: "hidden",
  },
  finalDeleteText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 12,
  },
  finalDeleteLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  lockHolderCard: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 340,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "#060A12",
    shadowColor: GOLD,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  lockHolderContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 10,
    alignItems: "center",
  },
  lockHolderIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  lockHolderKicker: {
    color: LABEL_GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  lockHolderTitle: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.1,
    lineHeight: 24,
    textAlign: "center",
  },
  lockHolderMessage: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 4,
  },
  lockHolderActions: {
    width: "100%",
    gap: 8,
    marginTop: 4,
  },
  lockHolderManageBtn: {
    minHeight: 46,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
  },
  lockHolderManageText: {
    color: GOLD_BRIGHT,
    fontSize: 14,
    fontWeight: "800",
  },
  lockHolderDeleteBtn: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,130,145,0.28)",
    backgroundColor: "rgba(255,90,95,0.08)",
  },
  lockHolderDeleteText: {
    color: "#FFB4B8",
    fontSize: 14,
    fontWeight: "800",
  },
  lockHolderNotNowBtn: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  lockHolderNotNowText: {
    color: LABEL_GOLD,
    fontSize: 12,
    fontWeight: "800",
  },
  pastorChurchModalContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 12,
  },
  pastorChurchHeader: {
    alignItems: "center",
    gap: 6,
  },
  pastorChurchTitle: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.12,
    lineHeight: 24,
    textAlign: "center",
  },
  pastorChurchIntro: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    textAlign: "center",
  },
  pastorChurchIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(217,179,95,0.06)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  pastorChurchAvatarOuter: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  pastorChurchAvatarRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.45)",
  },
  pastorChurchAvatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pastorChurchAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  pastorChurchIdentityCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  pastorChurchName: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 19,
  },
  pastorChurchManagedLabel: {
    color: LABEL_GOLD,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.15,
  },
  pastorChurchPremiumNote: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
    textAlign: "center",
  },
  pastorChurchActions: {
    width: "100%",
    gap: 8,
    marginTop: 2,
  },
  pastorChurchGoldCtaOuter: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pastorChurchGoldCta: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  pastorChurchGoldCtaText: {
    color: "#0B0F17",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.15,
  },
  pastorChurchNotNowOuter: {
    borderRadius: 16,
  },
  pastorChurchNotNowPill: {
    minHeight: 44,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  pastorChurchNotNowText: {
    color: LABEL_GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
