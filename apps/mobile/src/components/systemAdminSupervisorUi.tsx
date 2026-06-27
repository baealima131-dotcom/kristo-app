import React from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { SupervisorSummary } from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const SA_GOLD = "#F4D06F";
export const SA_PURPLE = "#9C76FF";
export const SA_GREEN = "#6EE7A8";
export const SA_AMBER = "#FBBF24";
export const SA_RED = "#F87171";
export const SA_RADIUS = 16;
export const SA_BLUR = 88;

export function initialsFromName(name: string, fallback = "?"): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

export type StatusTone = "accepted" | "pending" | "revoked";

export function supervisorStatusTone(row: SupervisorSummary): StatusTone {
  if (row.invitationStatus === "accepted") return "accepted";
  if (row.invitationStatus === "pending") return "pending";
  return "revoked";
}

export function GlassCard({
  children,
  pad = 12,
  style,
  radius = SA_RADIUS,
}: {
  children: React.ReactNode;
  pad?: number;
  style?: object;
  radius?: number;
}) {
  return (
    <View style={[styles.glassWrap, { borderRadius: radius }, style]}>
      <BlurView intensity={SA_BLUR} tint="dark" style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={["rgba(255,255,255,0.11)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0.00)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
      />
      <View pointerEvents="none" style={[styles.glassSheen, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]} />
      <View style={{ padding: pad }}>{children}</View>
    </View>
  );
}

export function ContactAvatar({
  uri,
  name,
  fallbackId,
  size = 52,
  online = false,
}: {
  uri?: string;
  name: string;
  fallbackId?: string;
  size?: number;
  online?: boolean;
}) {
  const avatarUri = String(uri || "").trim();
  const initials = initialsFromName(name, fallbackId || "?");

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.avatarGlow,
          {
            top: -4,
            left: -4,
            right: -4,
            bottom: -4,
            borderRadius: size,
          },
        ]}
      />
      <View
        style={[
          styles.avatarRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={StyleSheet.absoluteFillObject} />
        ) : (
          <LinearGradient
            colors={["rgba(156,118,255,0.72)", "rgba(244,208,111,0.48)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          >
            <View style={styles.avatarCenter}>
              <Text style={[styles.avatarInitials, { fontSize: size * 0.32 }]}>{initials}</Text>
            </View>
          </LinearGradient>
        )}
      </View>
      {online ? (
        <View
          style={[
            styles.onlineDot,
            {
              width: Math.max(10, size * 0.2),
              height: Math.max(10, size * 0.2),
              borderRadius: 999,
              right: 1,
              bottom: 1,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export function StatusCapsule({ tone }: { tone: StatusTone }) {
  const config =
    tone === "accepted"
      ? {
          icon: "checkmark" as const,
          label: "Accepted",
          colors: ["rgba(110,231,168,0.28)", "rgba(110,231,168,0.10)"] as const,
          text: SA_GREEN,
          border: "rgba(110,231,168,0.35)",
        }
      : tone === "pending"
        ? {
            icon: "time" as const,
            label: "Pending",
            colors: ["rgba(251,191,36,0.28)", "rgba(251,191,36,0.08)"] as const,
            text: SA_AMBER,
            border: "rgba(251,191,36,0.32)",
          }
        : {
            icon: "close" as const,
            label: "Revoked",
            colors: ["rgba(248,113,113,0.28)", "rgba(248,113,113,0.08)"] as const,
            text: SA_RED,
            border: "rgba(248,113,113,0.32)",
          };

  return (
    <View style={[styles.statusCapsule, { borderColor: config.border }]}>
      <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
      <LinearGradient colors={[...config.colors]} style={StyleSheet.absoluteFillObject} />
      <Ionicons name={config.icon} size={10} color={config.text} />
      <Text style={[styles.statusCapsuleText, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

export function AnalyticsChip({
  dotColor,
  value,
  label,
  flex = 1,
}: {
  dotColor: string;
  value: number;
  label: string;
  flex?: number;
}) {
  return (
    <View style={[styles.analyticsChip, { flex }]}>
      <View style={styles.analyticsTop}>
        <View style={[styles.analyticsDot, { backgroundColor: dotColor }]} />
        <Text style={styles.analyticsValue}>{value}</Text>
      </View>
      <Text style={styles.analyticsLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function SpringPress({
  children,
  onPress,
  disabled,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: object;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
        }
        onPressOut={() =>
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start()
        }
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function GoldButton({ label, onPress, compact }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <SpringPress onPress={onPress}>
      <LinearGradient
        colors={["#F8DE8A", "#F4D06F", "#D4AF5A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.goldBtn, compact && styles.goldBtnCompact]}
      >
        <Text style={styles.goldBtnText}>{label}</Text>
      </LinearGradient>
    </SpringPress>
  );
}

export function GlassButton({ label, onPress, compact }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <SpringPress onPress={onPress}>
      <View style={[styles.glassBtn, compact && styles.glassBtnCompact]}>
        <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFillObject} />
        <Text style={styles.glassBtnText}>{label}</Text>
      </View>
    </SpringPress>
  );
}

export function DangerIconButton({
  onPress,
  loading,
  size = 34,
}: {
  onPress: () => void;
  loading?: boolean;
  size?: number;
}) {
  return (
    <SpringPress onPress={onPress} disabled={loading}>
      <View style={[styles.dangerBtn, { width: size, height: size, borderRadius: size / 2 }]}>
        {loading ? (
          <ActivityIndicator size="small" color={SA_RED} />
        ) : (
          <Ionicons name="trash-outline" size={16} color={SA_RED} />
        )}
      </View>
    </SpringPress>
  );
}

export function ShimmerBlock({ height = 96 }: { height?: number }) {
  const pulse = React.useRef(new Animated.Value(0.4)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.shimmer, { height, opacity: pulse }]}>
      <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFillObject} />
    </Animated.View>
  );
}

export function configureExpandAnimation() {
  LayoutAnimation.configureNext({
    duration: 260,
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.82 },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

const styles = StyleSheet.create({
  glassWrap: {
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.025)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.06)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  glassSheen: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  avatarGlow: {
    position: "absolute",
    backgroundColor: "rgba(244,208,111,0.14)",
  },
  avatarRing: {
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(244,208,111,0.42)",
  },
  avatarCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarInitials: { color: TEXT, fontWeight: "800" },
  onlineDot: {
    position: "absolute",
    backgroundColor: SA_GREEN,
    borderWidth: 2,
    borderColor: "#0B0F18",
  },
  statusCapsule: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusCapsuleText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  analyticsChip: {
    minWidth: 0,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.05)",
  },
  analyticsTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  analyticsDot: { width: 6, height: 6, borderRadius: 999 },
  analyticsValue: { color: TEXT, fontSize: 15, fontWeight: "800", letterSpacing: -0.3 },
  analyticsLabel: { color: MUTED, fontSize: 9, fontWeight: "700", marginTop: 2, letterSpacing: 0.2 },
  goldBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  goldBtnCompact: { paddingHorizontal: 11, paddingVertical: 6 },
  goldBtnText: { color: "#111827", fontSize: 12, fontWeight: "800" },
  glassBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  glassBtnCompact: { paddingHorizontal: 10, paddingVertical: 6 },
  glassBtnText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  dangerBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(248,113,113,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(248,113,113,0.28)",
  },
  shimmer: {
    borderRadius: SA_RADIUS,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.05)",
  },
});
