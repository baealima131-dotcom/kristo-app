import React, { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
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
const PINK_SOFT = "#FFC8CE";

type DeleteChurchConfirmModalProps = {
  visible: boolean;
  churchName?: string | null;
  churchAvatarUrl?: string | null;
  deleting?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onKeepChurch: () => void;
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

function PowerCardChrome() {
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
    </>
  );
}

function isInternalChurchIdLabel(value: string | null | undefined): boolean {
  return /^CH7-/i.test(String(value || "").trim());
}

function resolveChurchDisplayName(
  churchName?: string | null,
  churchProfileName?: string | null
): string | null {
  for (const candidate of [churchName, churchProfileName]) {
    const label = String(candidate || "").trim();
    if (label && !isInternalChurchIdLabel(label)) return label;
  }
  return null;
}

function ChurchIdentityAvatar({
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
        style={s.identityAvatar}
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
      style={s.identityAvatarFallback}
    >
      <Ionicons name="business-outline" size={16} color="#0A0E16" />
    </LinearGradient>
  );
}

export function DeleteChurchConfirmModal({
  visible,
  churchName,
  churchAvatarUrl,
  deleting,
  disabled,
  onConfirm,
  onKeepChurch,
}: DeleteChurchConfirmModalProps) {
  const insets = useSafeAreaInsets();
  const { scale, fade, lift } = useModalEntrance(visible);
  const isDisabled = disabled || deleting;
  const displayName = useMemo(
    () => resolveChurchDisplayName(churchName, null),
    [churchName]
  );
  const avatarUrl = String(churchAvatarUrl || "").trim() || null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onKeepChurch}
      accessibilityViewIsModal
    >
      <View style={[s.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={s.backdrop}
          onPress={isDisabled ? undefined : onKeepChurch}
          accessibilityLabel="Dismiss church delete confirmation"
        />
        <Animated.View
          style={[s.powerCard, { opacity: fade, transform: [{ translateY: lift }, { scale }] }]}
          accessibilityRole="alert"
          accessibilityLabel="Delete your church confirmation"
        >
          <PowerCardChrome />
          <View style={s.content}>
            <View style={s.headerBlock}>
              <View style={s.iconOuter}>
                <View style={s.iconGlow} pointerEvents="none" />
                <View style={s.iconRing} pointerEvents="none" />
                <LinearGradient
                  colors={[
                    "rgba(120,28,48,0.95)",
                    "rgba(52,14,28,0.98)",
                    "rgba(12,6,10,0.99)",
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.iconTile}
                >
                  <Ionicons name="warning-outline" size={20} color={PINK_SOFT} />
                </LinearGradient>
              </View>

              <Text style={s.powerEyebrow}>DELETE CHURCH</Text>
              <Text style={s.powerTitle}>Delete your church?</Text>
              <Text style={s.powerMessage}>
                This permanently removes your church and its local church data from Kristo. This
                action cannot be undone.
              </Text>

              {displayName ? (
                <View style={s.identityRow}>
                  <ChurchIdentityAvatar churchName={displayName} churchAvatarUrl={avatarUrl} />
                  <Text style={s.identityName} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={s.actions}>
              <Pressable
                onPress={onKeepChurch}
                disabled={isDisabled}
                accessibilityRole="button"
                accessibilityLabel="Keep Church"
                style={({ pressed }) => [
                  s.keepOuter,
                  pressed && !isDisabled ? s.ctaPressed : null,
                  isDisabled && s.disabled,
                ]}
              >
                <View style={s.keepPill}>
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
                  <Text style={s.keepText}>Keep Church</Text>
                </View>
              </Pressable>

              <Pressable
                onPress={onConfirm}
                disabled={isDisabled}
                accessibilityRole="button"
                accessibilityLabel="Delete Church"
                style={({ pressed }) => [
                  s.deleteOuter,
                  pressed && !isDisabled ? s.ctaPressed : null,
                  isDisabled && s.disabled,
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
                  style={s.deletePill}
                >
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(255,140,155,0.14)", "transparent"]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={s.optionHighlight}
                  />
                  {deleting ? (
                    <View style={s.deleteLoading}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={s.deleteText}>Deleting...</Text>
                    </View>
                  ) : (
                    <Text style={s.deleteText}>Delete Church</Text>
                  )}
                </LinearGradient>
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
    paddingHorizontal: 20,
    backgroundColor: "rgba(1,6,18,0.88)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  powerCard: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 340,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.36)",
    backgroundColor: "#060A12",
    shadowColor: GOLD,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  ambientGlowTop: {
    position: "absolute",
    top: -24,
    right: -16,
    width: 96,
    height: 96,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  ambientGlowBottom: {
    position: "absolute",
    bottom: -28,
    left: -18,
    width: 80,
    height: 80,
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
    height: 32,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
  },
  headerBlock: {
    alignItems: "center",
    gap: 6,
  },
  iconOuter: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  iconGlow: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,100,120,0.12)",
  },
  iconRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "rgba(255,140,155,0.38)",
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
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
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 0.15,
    lineHeight: 23,
    textAlign: "center",
  },
  powerMessage: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 2,
  },
  identityRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "stretch",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(217,179,95,0.07)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
  },
  identityAvatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  identityAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  identityName: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  actions: {
    width: "100%",
    gap: 9,
    marginTop: 2,
  },
  keepOuter: {
    borderRadius: 15,
    shadowColor: GOLD,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  keepPill: {
    minHeight: 44,
    borderRadius: 15,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  keepText: {
    color: LABEL_GOLD,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  deleteOuter: {
    borderRadius: 15,
    overflow: "hidden",
    shadowColor: "#C44B62",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
  deletePill: {
    minHeight: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 16,
  },
  deleteLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deleteText: {
    color: "rgba(255,255,255,0.96)",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.15,
  },
  optionHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  ctaPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.55,
  },
});
