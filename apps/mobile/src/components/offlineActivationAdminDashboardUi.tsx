import React from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

export const ADMIN_GOLD = "#F4D06F";
export const ADMIN_PURPLE = "#9C76FF";
export const ADMIN_PURPLE_GLOW = "rgba(156,118,255,0.42)";
export const ADMIN_RADIUS = 20;
export const ADMIN_RADIUS_SM = 16;
export const ADMIN_BLUR = 56;
export const ADMIN_GLASS_FILL = "rgba(255,255,255,0.045)";
export const ADMIN_GLASS_BORDER = "rgba(255,255,255,0.12)";
export const ADMIN_GLASS_BORDER_SOFT = "rgba(255,255,255,0.08)";

export type AdminMetricConfig = {
  key: string;
  label: string;
  helper: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  glow: string;
  value: number;
};

export function GlassSurface({
  children,
  style,
  intensity = ADMIN_BLUR,
  radius = ADMIN_RADIUS,
  borderColor = ADMIN_GLASS_BORDER,
  shadowColor = "#000",
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  radius?: number;
  borderColor?: string;
  shadowColor?: string;
}) {
  return (
    <View
      style={[
        adminStyles.glassOuter,
        { borderRadius: radius, borderColor, shadowColor },
        style,
      ]}
    >
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFillObject} />
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: ADMIN_GLASS_FILL, borderRadius: radius },
        ]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0.03)", "transparent"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.55 }}
        style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["transparent", "rgba(0,0,0,0.12)"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
      />
      {children}
    </View>
  );
}

export function BackgroundScene() {
  return (
    <>
      <LinearGradient
        colors={["#1A1238", "#0E1018", "#070C14", BG]}
        locations={[0, 0.28, 0.62, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={adminStyles.orbPurpleLarge} />
      <View pointerEvents="none" style={adminStyles.orbGoldLarge} />
      <View pointerEvents="none" style={adminStyles.orbPurpleMid} />
      <View pointerEvents="none" style={adminStyles.orbGoldMid} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(156,118,255,0.08)", "transparent", "rgba(244,208,111,0.05)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    </>
  );
}

export function LoadingShimmer() {
  const pulse = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });

  return (
    <View style={adminStyles.shimmerGrid}>
      {[0, 1, 2, 3].map((i) => (
        <Animated.View key={i} style={[adminStyles.shimmerCard, { opacity }]} />
      ))}
    </View>
  );
}

export function OfflineActivationHeroHeader({
  title,
  subtitle,
  badgeIcon,
  onBack,
  topInset,
  trailing,
}: {
  title: string;
  subtitle: string;
  badgeIcon: keyof typeof Ionicons.glyphMap;
  onBack: () => void;
  topInset: number;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={[adminStyles.headerWrap, { paddingTop: topInset + 12 }]}>
      <Pressable onPress={onBack} hitSlop={12} style={adminStyles.backBtn}>
        <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={adminStyles.backBtnInner}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </View>
      </Pressable>

      <GlassSurface style={adminStyles.headerGlass} radius={ADMIN_RADIUS} intensity={48} shadowColor={ADMIN_PURPLE}>
        <View style={adminStyles.headerRow}>
          <View style={adminStyles.headerCopy}>
            <Text style={adminStyles.title}>{title}</Text>
            <Text style={adminStyles.subtitle}>{subtitle}</Text>
          </View>
          <View style={adminStyles.headerBadgeOuter}>
            <View pointerEvents="none" style={adminStyles.headerBadgeGlow} />
            <GlassSurface
              style={adminStyles.headerBadge}
              radius={ADMIN_RADIUS_SM}
              intensity={36}
              borderColor="rgba(244,208,111,0.35)"
            >
              <Ionicons name={badgeIcon} size={24} color={ADMIN_GOLD} />
            </GlassSurface>
          </View>
          {trailing}
        </View>
      </GlassSurface>
    </View>
  );
}

export function PremiumMetricCard({ metric, index }: { metric: AdminMetricConfig; index: number }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const enter = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 380,
      delay: index * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, index]);

  const onPressIn = () => {
    Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, speed: 28, bounciness: 0 }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 5 }).start();
  };

  return (
    <Animated.View
      style={{
        width: "48.5%",
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          { scale },
        ],
      }}
    >
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
        <GlassSurface
          style={adminStyles.metricCardInner}
          radius={ADMIN_RADIUS}
          intensity={50}
          borderColor={`${metric.color}33`}
          shadowColor={metric.color}
        >
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.16)", "transparent"]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 0.35 }}
            style={[StyleSheet.absoluteFillObject, { height: "42%", borderRadius: ADMIN_RADIUS }]}
          />
          <View style={[adminStyles.metricIconWrap, { backgroundColor: metric.glow, borderColor: `${metric.color}44` }]}>
            <Ionicons name={metric.icon} size={18} color={metric.color} />
          </View>
          <Text style={[adminStyles.metricValue, { color: metric.color }]}>{metric.value}</Text>
          <Text style={adminStyles.metricLabel}>{metric.label}</Text>
          <Text style={adminStyles.metricHelper}>{metric.helper}</Text>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

export function HeroActionCard({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [adminStyles.heroPressable, pressed && adminStyles.pressedSoft]}
    >
      <GlassSurface
        style={adminStyles.heroCard}
        radius={ADMIN_RADIUS}
        intensity={62}
        borderColor="rgba(244,208,111,0.32)"
        shadowColor={ADMIN_GOLD}
      >
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(88,56,160,0.55)", "rgba(42,28,78,0.42)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(244,208,111,0.16)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.7 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={adminStyles.heroIconOuter}>
          <View pointerEvents="none" style={adminStyles.heroIconGlow} />
          <View style={adminStyles.heroIconWrap}>
            <Ionicons name={icon} size={22} color={ADMIN_GOLD} />
          </View>
        </View>
        <View style={adminStyles.heroCopy}>
          <Text style={adminStyles.heroTitle}>{title}</Text>
          <Text style={adminStyles.heroSub}>{subtitle}</Text>
        </View>
        <View style={adminStyles.heroActionOuter}>
          <View pointerEvents="none" style={adminStyles.heroActionGlow} />
          <LinearGradient
            colors={["#F8DC82", ADMIN_GOLD, "#D4A84A"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={adminStyles.heroAction}
          >
            <Ionicons name="arrow-forward" size={18} color="#07111F" />
          </LinearGradient>
        </View>
      </GlassSurface>
    </Pressable>
  );
}

export function SectionPanel({
  title,
  subtitle,
  badge,
  icon,
  actionLabel,
  onAction,
  onPress,
  children,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  icon: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const body = (
    <GlassSurface style={adminStyles.menuCard} radius={ADMIN_RADIUS} intensity={48} shadowColor="#000">
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(156,118,255,0.10)", "transparent", "rgba(244,208,111,0.06)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={adminStyles.menuGlowAccent}>
        <LinearGradient
          colors={[`${ADMIN_GOLD}AA`, `${ADMIN_GOLD}44`, "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>
      <View style={adminStyles.menuIconOuter}>
        <View pointerEvents="none" style={adminStyles.menuIconGlow} />
        <View style={adminStyles.menuIconWrap}>
          <Ionicons name={icon} size={20} color={ADMIN_GOLD} />
        </View>
      </View>
      <View style={adminStyles.menuCopy}>
        <View style={adminStyles.menuTitleRow}>
          <Text style={adminStyles.menuTitle}>{title}</Text>
          {badge ? (
            <View style={adminStyles.menuBadge}>
              <Text style={adminStyles.menuBadgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={adminStyles.menuSub}>{subtitle}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} style={adminStyles.menuActionWrap}>
          <Text style={adminStyles.menuActionText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={ADMIN_GOLD} />
        </Pressable>
      ) : onPress ? (
        <View style={adminStyles.menuChevronWrap}>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
        </View>
      ) : null}
      {children}
    </GlassSurface>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [adminStyles.menuPressable, pressed && adminStyles.pressedSoft]}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={adminStyles.menuPressable}>{body}</View>;
}

export function ActivitySectionPanel({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <GlassSurface style={adminStyles.activityPanel} radius={ADMIN_RADIUS} intensity={54} shadowColor={ADMIN_PURPLE}>
      <View style={adminStyles.activityHeader}>
        <View style={adminStyles.activityHeaderCopy}>
          <Text style={adminStyles.activityTitle}>{title}</Text>
          <Text style={adminStyles.activitySub}>{subtitle}</Text>
        </View>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} style={adminStyles.monthFilterPill}>
            <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
            <Text style={adminStyles.monthFilterText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </GlassSurface>
  );
}

export function InlineEmptyState({ message }: { message: string }) {
  return (
    <GlassSurface style={adminStyles.activityEmptyCard} radius={ADMIN_RADIUS_SM} intensity={40}>
      <Text style={adminStyles.activityEmptyTitle}>{message}</Text>
    </GlassSurface>
  );
}

export function AccessNotice({ title, message }: { title: string; message: string }) {
  return (
    <GlassSurface style={adminStyles.noticeCard}>
      <Ionicons name="lock-closed-outline" size={22} color={ADMIN_GOLD} />
      <Text style={adminStyles.noticeTitle}>{title}</Text>
      <Text style={adminStyles.noticeText}>{message}</Text>
    </GlassSurface>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={adminStyles.errorCard}>
      <Text style={adminStyles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={adminStyles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const adminStyles = StyleSheet.create({
  glassOuter: {
    overflow: "hidden",
    borderWidth: 1,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  orbPurpleLarge: {
    position: "absolute",
    top: -120,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: 999,
    backgroundColor: ADMIN_PURPLE_GLOW,
    opacity: 0.38,
  },
  orbGoldLarge: {
    position: "absolute",
    top: 180,
    left: -120,
    width: 280,
    height: 280,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.14)",
    opacity: 0.55,
  },
  orbPurpleMid: {
    position: "absolute",
    bottom: 120,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(156,118,255,0.18)",
    opacity: 0.45,
  },
  orbGoldMid: {
    position: "absolute",
    bottom: 40,
    left: 40,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.10)",
    opacity: 0.4,
  },
  headerWrap: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: ADMIN_RADIUS_SM,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: ADMIN_GLASS_BORDER_SOFT,
  },
  backBtnInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  headerGlass: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: TEXT, fontSize: 26, fontWeight: "900", letterSpacing: 0.3 },
  subtitle: { color: "rgba(244,208,111,0.88)", fontSize: 12, fontWeight: "700", letterSpacing: 0.35 },
  headerBadgeOuter: { position: "relative" },
  headerBadgeGlow: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.18)",
    opacity: 0.9,
  },
  headerBadge: { width: 52, height: 52, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  content: { paddingHorizontal: 16, paddingTop: 2 },
  shimmerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  shimmerCard: {
    width: "48.5%",
    height: 128,
    borderRadius: ADMIN_RADIUS,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: ADMIN_GLASS_BORDER_SOFT,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  metricCardInner: {
    minHeight: 132,
    paddingVertical: 16,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  metricIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
  },
  metricValue: { fontSize: 30, fontWeight: "900", letterSpacing: 0.3, lineHeight: 34 },
  metricLabel: { color: TEXT, fontSize: 12, fontWeight: "800", marginTop: 4 },
  metricHelper: { color: MUTED, fontSize: 10, marginTop: 4, fontWeight: "600" },
  heroPressable: {},
  heroCard: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    overflow: "hidden",
  },
  heroIconOuter: { position: "relative" },
  heroIconGlow: {
    position: "absolute",
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.20)",
  },
  heroIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.30)",
  },
  heroCopy: { flex: 1, minWidth: 0, gap: 4 },
  heroTitle: { color: TEXT, fontSize: 17, fontWeight: "900", letterSpacing: 0.2 },
  heroSub: { color: "rgba(255,255,255,0.74)", fontSize: 12, fontWeight: "600", lineHeight: 17 },
  heroActionOuter: { position: "relative" },
  heroActionGlow: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.35)",
  },
  heroAction: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  menuPressable: {},
  menuCard: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingRight: 16,
    paddingLeft: 12,
    gap: 14,
    overflow: "hidden",
    flexWrap: "wrap",
  },
  menuGlowAccent: {
    position: "absolute",
    left: 0,
    top: 12,
    bottom: 12,
    width: 3,
    borderRadius: 999,
    overflow: "hidden",
    opacity: 0.95,
  },
  menuIconOuter: { position: "relative" },
  menuIconGlow: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.14)",
  },
  menuIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  menuCopy: { flex: 1, minWidth: 0, gap: 5 },
  menuTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  menuTitle: { color: TEXT, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  menuBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(156,118,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(156,118,255,0.32)",
  },
  menuBadgeText: { color: "rgba(244,208,111,0.96)", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  menuSub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  menuChevronWrap: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  menuActionWrap: { flexDirection: "row", alignItems: "center", gap: 2 },
  menuActionText: { color: ADMIN_GOLD, fontSize: 11, fontWeight: "800" },
  activityPanel: { padding: 16, gap: 14, overflow: "hidden" },
  activityHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  activityHeaderCopy: { flex: 1, gap: 4 },
  activityTitle: { color: TEXT, fontSize: 18, fontWeight: "900", letterSpacing: 0.2 },
  activitySub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  monthFilterPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
    backgroundColor: "rgba(244,208,111,0.08)",
  },
  monthFilterText: { color: ADMIN_GOLD, fontSize: 11, fontWeight: "800" },
  activityEmptyCard: { padding: 18, alignItems: "center", overflow: "hidden" },
  activityEmptyTitle: { color: MUTED, fontSize: 13, fontWeight: "600", textAlign: "center" },
  pressedSoft: { opacity: 0.94, transform: [{ scale: 0.988 }] },
  errorCard: {
    padding: 12,
    borderRadius: ADMIN_RADIUS_SM,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  errorText: { color: "#FCA5A5", fontSize: 13 },
  retryText: { color: ADMIN_GOLD, fontSize: 12, fontWeight: "800", marginTop: 8 },
  noticeCard: { padding: 20, alignItems: "center", gap: 8, overflow: "hidden" },
  noticeTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
