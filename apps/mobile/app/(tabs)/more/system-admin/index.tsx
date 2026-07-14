import React from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  hasOfflineActivationRole,
  logOfflineCodesRouteOpened,
} from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  fetchActivationDashboard,
  fetchActivationChurchActivity,
  currentActivationMonthKey,
  type ActivationDashboardStats,
  type ActivationChurchActivityRow,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const GOLD = "#F4D06F";
const GOLD_SOFT = "rgba(244,208,111,0.16)";
const PURPLE = "#9C76FF";
const PURPLE_GLOW = "rgba(156,118,255,0.42)";
const RADIUS = 20;
const RADIUS_SM = 16;
const BLUR = 56;
const GLASS_FILL = "rgba(255,255,255,0.045)";
const GLASS_BORDER = "rgba(255,255,255,0.12)";
const GLASS_BORDER_SOFT = "rgba(255,255,255,0.08)";

const layoutSpring = {
  duration: 260,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.spring, springDamping: 0.82 },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

type SectionLink = {
  key: string;
  title: string;
  subtitle: string;
  badge: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: string;
};

function formatMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = String(monthKey || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatActivationDate(value: string): string {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type MetricConfig = {
  key: string;
  label: string;
  helper: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  glow: string;
  value: number;
};

function GlassSurface({
  children,
  style,
  intensity = BLUR,
  radius = RADIUS,
  borderColor = GLASS_BORDER,
  shadowColor = "#000",
}: {
  children: React.ReactNode;
  style?: object;
  intensity?: number;
  radius?: number;
  borderColor?: string;
  shadowColor?: string;
}) {
  return (
    <View
      style={[
        styles.glassOuter,
        {
          borderRadius: radius,
          borderColor,
          shadowColor,
        },
        style,
      ]}
    >
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFillObject} />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: GLASS_FILL, borderRadius: radius }]} />
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

function BackgroundScene() {
  return (
    <>
      <LinearGradient
        colors={["#1A1238", "#0E1018", "#070C14", BG]}
        locations={[0, 0.28, 0.62, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={styles.orbPurpleLarge} />
      <View pointerEvents="none" style={styles.orbGoldLarge} />
      <View pointerEvents="none" style={styles.orbPurpleMid} />
      <View pointerEvents="none" style={styles.orbGoldMid} />
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

function LoadingShimmer() {
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
    <View style={styles.shimmerGrid}>
      {[0, 1, 2, 3].map((i) => (
        <Animated.View key={i} style={[styles.shimmerCard, { opacity }]} />
      ))}
    </View>
  );
}

export default function SystemAdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const userId = String(session?.userId || "").trim();
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [stats, setStats] = React.useState<ActivationDashboardStats | null>(null);
  const [activityMonth] = React.useState(() => currentActivationMonthKey());
  const [activityLoading, setActivityLoading] = React.useState(true);
  const [activityError, setActivityError] = React.useState("");
  const [churchActivity, setChurchActivity] = React.useState<ActivationChurchActivityRow[]>([]);
  const [expandedChurches, setExpandedChurches] = React.useState<Record<string, boolean>>({});

  const contentFade = React.useRef(new Animated.Value(0)).current;
  const contentSlide = React.useRef(new Animated.Value(16)).current;

  const loadDashboard = React.useCallback(async (fresh = true) => {
    if (!allowed) {
      setLoading(false);
      setActivityLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetchActivationDashboard({ fresh });
      setStats(res.stats);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load dashboard"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  const loadChurchActivity = React.useCallback(async () => {
    if (!allowed) {
      setActivityLoading(false);
      return;
    }
    setActivityError("");
    setActivityLoading(true);
    try {
      const res = await fetchActivationChurchActivity(activityMonth);
      setChurchActivity(res.churches);
    } catch (e: any) {
      setActivityError(String(e?.message || "Failed to load church activity"));
      setChurchActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, [allowed, activityMonth]);

  useFocusEffect(
    React.useCallback(() => {
      if (allowed) logOfflineCodesRouteOpened("system-admin", platformRole || "", userId);
      loadDashboard(true);
      loadChurchActivity();
    }, [allowed, loadDashboard, loadChurchActivity, platformRole, userId])
  );

  React.useEffect(() => {
    if (loading || !allowed) return;
    contentFade.setValue(0);
    contentSlide.setValue(16);
    Animated.parallel([
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(contentSlide, {
        toValue: 0,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [loading, allowed, contentFade, contentSlide]);

  const metrics: MetricConfig[] = stats
    ? [
        {
          key: "total",
          label: "Total Codes",
          helper: "All time generated",
          icon: "layers-outline",
          color: GOLD,
          glow: "rgba(244,208,111,0.24)",
          value: stats.totalCodes,
        },
        {
          key: "available",
          label: "Available",
          helper: "Ready to assign",
          icon: "sparkles-outline",
          color: "#6EE7A8",
          glow: "rgba(110,231,168,0.22)",
          value: stats.availableUnassigned,
        },
        {
          key: "supervisors",
          label: "With Supervisors",
          helper: "Assigned to team",
          icon: "people-outline",
          color: "#93C5FD",
          glow: "rgba(147,197,253,0.22)",
          value: stats.assignedToSupervisors,
        },
        {
          key: "redeemed",
          label: "Redeemed",
          helper: "Successfully used",
          icon: "checkmark-done-outline",
          color: "#FCA5A5",
          glow: "rgba(252,165,165,0.20)",
          value: stats.redeemed,
        },
      ]
    : [];

  const sections: SectionLink[] = [
    {
      key: "subscription_codes",
      title: "Subscription Activation Codes",
      subtitle: "Generate batches and view platform codes.",
      badge: "MANAGE",
      icon: "ticket-outline",
      href: "/more/system-admin/subscription-codes",
    },
    {
      key: "supervisors",
      title: "Supervisors",
      subtitle: `${stats?.supervisorCount ?? 0} supervisors • assign codes securely`,
      badge: "MANAGE",
      icon: "people-circle-outline",
      href: "/more/system-admin/supervisors",
    },
    {
      key: "report_center",
      title: "Report Center",
      subtitle:
        "Safety reports, moderation and supervisor assignments.",
      badge: "OPEN",
      icon: "shield-checkmark-outline",
      href: "/more/system-admin/report-center",
    },
  ];

  const toggleChurchExpanded = React.useCallback((churchId: string) => {
    LayoutAnimation.configureNext(layoutSpring);
    setExpandedChurches((prev) => ({
      ...prev,
      [churchId]: !prev[churchId],
    }));
  }, []);

  return (
    <View style={styles.screen}>
      <BackgroundScene />

      <View style={[styles.headerWrap, { paddingTop: insets.top + 12 }]}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.backBtn}
          >
            <BlurView
              intensity={42}
              tint="dark"
              style={StyleSheet.absoluteFillObject}
            />

            <View style={styles.backBtnInner}>
              <Ionicons
                name="chevron-back"
                size={24}
                color="#FFFFFF"
              />
            </View>
          </Pressable>

          <View
            style={{
              flex: 1,
              flexDirection: "row",
              gap: 8,
            }}
          >
            <View
              style={{
                flex: 1,
                minHeight: 48,
                overflow: "hidden",
                borderRadius: 16,
                borderWidth: 1,
                borderColor:
                  "rgba(244,208,111,0.42)",
                backgroundColor:
                  "rgba(244,208,111,0.13)",
              }}
            >
              <BlurView
                intensity={40}
                tint="dark"
                style={StyleSheet.absoluteFillObject}
              />

              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  paddingHorizontal: 10,
                }}
              >
                <Ionicons
                  name="business-outline"
                  size={17}
                  color={GOLD}
                />

                <Text
                  numberOfLines={1}
                  style={{
                    color: "#F8E7A5",
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  Church Activation
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Report Center"
              onPress={() =>
                router.push(
                  "/more/system-admin/report-center" as any
                )
              }
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                overflow: "hidden",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: pressed
                  ? "rgba(167,139,250,0.72)"
                  : "rgba(167,139,250,0.42)",
                backgroundColor: pressed
                  ? "rgba(139,92,246,0.24)"
                  : "rgba(139,92,246,0.12)",
              })}
            >
              <BlurView
                intensity={40}
                tint="dark"
                style={StyleSheet.absoluteFillObject}
              />

              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  paddingHorizontal: 10,
                }}
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={17}
                  color="#C4B5FD"
                />

                <Text
                  numberOfLines={1}
                  style={{
                    color: "#DDD6FE",
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  Report Center
                </Text>
              </View>
            </Pressable>
          </View>
        </View>

        <GlassSurface style={styles.headerGlass} radius={RADIUS} intensity={48} shadowColor={PURPLE}>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>System Admin</Text>
              <Text style={styles.subtitle}>Offline Activation Control Center</Text>
            </View>
            <View style={styles.headerBadgeOuter}>
              <View pointerEvents="none" style={styles.headerBadgeGlow} />
              <GlassSurface style={styles.headerBadge} radius={RADIUS_SM} intensity={36} borderColor="rgba(244,208,111,0.35)">
                <MaterialCommunityIcons name="shield-crown-outline" size={24} color={GOLD} />
              </GlassSurface>
            </View>
          </View>
        </GlassSurface>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <GlassSurface style={styles.noticeCard}>
            <Ionicons name="lock-closed-outline" size={22} color={GOLD} />
            <Text style={styles.noticeTitle}>Access restricted</Text>
            <Text style={styles.noticeText}>
              This screen is available only for the System Admin platform role.
            </Text>
          </GlassSurface>
        ) : (
          <Animated.View
            style={{
              gap: 16,
              opacity: contentFade,
              transform: [{ translateY: contentSlide }],
            }}
          >
            {loading ? <LoadingShimmer /> : null}

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {stats && !loading ? (
              <View style={styles.statsGrid}>
                {metrics.map((metric, index) => (
                  <PremiumMetricCard key={metric.key} metric={metric} index={index} />
                ))}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add Supervisor"
              onPress={() => router.push("/more/system-admin/supervisors?add=1" as any)}
              style={({ pressed }) => [styles.heroPressable, pressed && styles.pressedSoft]}
            >
              <GlassSurface
                style={styles.supervisorHero}
                radius={RADIUS}
                intensity={62}
                borderColor="rgba(244,208,111,0.32)"
                shadowColor={GOLD}
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
                <View style={styles.supervisorHeroIconOuter}>
                  <View pointerEvents="none" style={styles.supervisorHeroIconGlow} />
                  <View style={styles.supervisorHeroIconWrap}>
                    <Ionicons name="person-add" size={22} color={GOLD} />
                  </View>
                </View>
                <View style={styles.supervisorHeroCopy}>
                  <Text style={styles.supervisorHeroTitle}>Add Supervisor</Text>
                  <Text style={styles.supervisorHeroSub}>Invite and empower trusted supervisors</Text>
                </View>
                <View style={styles.supervisorHeroActionOuter}>
                  <View pointerEvents="none" style={styles.supervisorHeroActionGlow} />
                  <LinearGradient
                    colors={["#F8DC82", GOLD, "#D4A84A"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.supervisorHeroAction}
                  >
                    <Ionicons name="arrow-forward" size={18} color="#07111F" />
                  </LinearGradient>
                </View>
              </GlassSurface>
            </Pressable>

            {sections.map((section) => (
              <MenuCard
                key={section.key}
                section={section}
                onPress={() => {
                  if (section.href) router.push(section.href as any);
                }}
              />
            ))}

            <GlassSurface style={styles.activityPanel} radius={RADIUS} intensity={54} shadowColor={PURPLE}>
              <View style={styles.activityHeader}>
                <View style={styles.activityHeaderCopy}>
                  <Text style={styles.activityTitle}>Activation Church Activity</Text>
                  <Text style={styles.activitySub}>Track offline subscription activations</Text>
                  <Text style={styles.activityMonthLabel}>{formatMonthLabel(activityMonth)}</Text>
                </View>
                <View style={styles.monthFilterPill}>
                  <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
                  <Text style={styles.monthFilterText}>This Month</Text>
                </View>
              </View>

              {activityLoading ? (
                <View style={styles.activityLoadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : null}

              {activityError ? (
                <View style={styles.errorCardInline}>
                  <Text style={styles.errorText}>{activityError}</Text>
                </View>
              ) : null}

              {!activityLoading && !activityError && churchActivity.length === 0 ? (
                <GlassSurface style={styles.activityEmptyCard} radius={RADIUS_SM} intensity={40}>
                  <Ionicons name="business-outline" size={28} color={GOLD} />
                  <Text style={styles.activityEmptyTitle}>No offline church activations yet.</Text>
                  <Text style={styles.activityEmptyText}>
                    Redeemed activation codes will appear here grouped by church.
                  </Text>
                </GlassSurface>
              ) : null}

              {!activityLoading && !activityError
                ? churchActivity.map((row) => (
                    <ChurchActivityRow
                      key={row.churchId}
                      row={row}
                      expanded={!!expandedChurches[row.churchId]}
                      onToggle={() => toggleChurchExpanded(row.churchId)}
                    />
                  ))
                : null}
            </GlassSurface>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

function PremiumMetricCard({ metric, index }: { metric: MetricConfig; index: number }) {
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
          {
            translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
          },
          { scale },
        ],
      }}
    >
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
        <GlassSurface
          style={styles.metricCardInner}
          radius={RADIUS}
          intensity={50}
          borderColor={`${metric.color}33`}
          shadowColor={metric.color}
        >
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.16)", "transparent"]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 0.35 }}
            style={[StyleSheet.absoluteFillObject, { height: "42%", borderRadius: RADIUS }]}
          />
          <View style={[styles.metricIconWrap, { backgroundColor: metric.glow, borderColor: `${metric.color}44` }]}>
            <Ionicons name={metric.icon} size={18} color={metric.color} />
          </View>
          <Text style={[styles.metricValue, { color: metric.color }]}>{metric.value}</Text>
          <Text style={styles.metricLabel}>{metric.label}</Text>
          <Text style={styles.metricHelper}>{metric.helper}</Text>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

function MenuCard({ section, onPress }: { section: SectionLink; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={section.title}
      onPress={onPress}
      style={({ pressed }) => [styles.menuPressable, pressed && styles.pressedSoft]}
    >
      <GlassSurface style={styles.menuCard} radius={RADIUS} intensity={48} shadowColor="#000">
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(156,118,255,0.10)", "transparent", "rgba(244,208,111,0.06)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.menuGlowAccent}>
          <LinearGradient
            colors={[`${GOLD}AA`, `${GOLD}44`, "transparent"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
        <View style={styles.menuIconOuter}>
          <View pointerEvents="none" style={styles.menuIconGlow} />
          <View style={styles.menuIconWrap}>
            <Ionicons name={section.icon} size={20} color={GOLD} />
          </View>
        </View>
        <View style={styles.menuCopy}>
          <View style={styles.menuTitleRow}>
            <Text style={styles.menuTitle}>{section.title}</Text>
            <View style={styles.menuBadge}>
              <Text style={styles.menuBadgeText}>{section.badge}</Text>
            </View>
          </View>
          <Text style={styles.menuSub}>{section.subtitle}</Text>
        </View>
        <View style={styles.menuChevronWrap}>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
        </View>
      </GlassSurface>
    </Pressable>
  );
}

function ChurchActivityRow({
  row,
  expanded,
  onToggle,
}: {
  row: ActivationChurchActivityRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const trendUp = typeof row.trendPercent === "number" && row.trendPercent > 0;
  const trendDown = typeof row.trendPercent === "number" && row.trendPercent < 0;
  const latestDate = row.activations[0]?.redeemedAt || "";

  return (
    <GlassSurface style={styles.churchRowCard} radius={RADIUS_SM} intensity={44} shadowColor="#000">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.churchName} activations`}
        onPress={onToggle}
        style={({ pressed }) => [styles.churchRowHeader, pressed && styles.pressedSoft]}
      >
        <View style={styles.churchRowIcon}>
          <Ionicons name="business-outline" size={18} color={GOLD} />
        </View>
        <View style={styles.churchRowCopy}>
          <Text style={styles.churchRowTitle} numberOfLines={1}>
            {row.churchName}
          </Text>
          <Text style={styles.churchRowMeta}>
            {formatMonthLabel(row.month)}
            {latestDate ? ` • ${formatActivationDate(latestDate)}` : ""}
          </Text>
          <Text style={styles.churchRowCount}>{row.usedCount} codes used</Text>
        </View>
        <View style={styles.churchRowSide}>
          {typeof row.trendPercent === "number" ? (
            <View
              style={[
                styles.trendPill,
                trendUp && styles.trendPillUp,
                trendDown && styles.trendPillDown,
              ]}
            >
              <Ionicons
                name={trendUp ? "trending-up" : trendDown ? "trending-down" : "remove-outline"}
                size={12}
                color={trendUp ? "#6EE7A8" : trendDown ? "#FCA5A5" : MUTED}
              />
              <Text
                style={[
                  styles.trendText,
                  trendUp && styles.trendTextUp,
                  trendDown && styles.trendTextDown,
                ]}
              >
                {row.trendPercent > 0 ? "+" : ""}
                {row.trendPercent}%
              </Text>
            </View>
          ) : null}
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color="rgba(255,255,255,0.5)"
          />
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.churchDetails}>
          {row.activations.map((activation) => (
            <View key={`${row.churchId}-${activation.code}`} style={styles.activationDetailCard}>
              <View style={styles.activationDetailRow}>
                <Text style={styles.activationDetailLabel}>Date used</Text>
                <Text style={styles.activationDetailValue}>
                  {formatActivationDate(activation.redeemedAt)}
                </Text>
              </View>
              <View style={styles.activationDetailRow}>
                <Text style={styles.activationDetailLabel}>Code</Text>
                <Text style={styles.activationDetailValueMono}>{activation.code}</Text>
              </View>
              <View style={styles.activationDetailRow}>
                <Text style={styles.activationDetailLabel}>From Supervisor</Text>
                <Text style={styles.activationDetailValue}>
                  {activation.supervisorName || activation.supervisorUserId || "—"}
                </Text>
              </View>
              <View style={styles.activationDetailRow}>
                <Text style={styles.activationDetailLabel}>From Agent</Text>
                <Text style={styles.activationDetailValue}>
                  {activation.agentName || activation.agentUserId || "—"}
                </Text>
              </View>
              <View style={styles.activationDetailRow}>
                <Text style={styles.activationDetailLabel}>Code type</Text>
                <Text style={styles.activationDetailValue}>{activation.durationLabel}</Text>
              </View>
              <View style={styles.activationDetailRow}>
                <Text style={styles.activationDetailLabel}>Status</Text>
                <Text style={styles.activationDetailStatus}>{activation.status}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  orbPurpleLarge: {
    position: "absolute",
    top: -120,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: 999,
    backgroundColor: PURPLE_GLOW,
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
  headerWrap: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: RADIUS_SM,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
  },
  backBtnInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  headerGlass: {
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  title: {
    color: TEXT,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  subtitle: {
    color: "rgba(244,208,111,0.88)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.35,
  },
  headerBadgeOuter: {
    position: "relative",
  },
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
  headerBadge: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
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
    borderRadius: RADIUS,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
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
  glassOuter: {
    overflow: "hidden",
    borderWidth: 1,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  heroPressable: {},
  supervisorHero: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    overflow: "hidden",
  },
  supervisorHeroIconOuter: { position: "relative" },
  supervisorHeroIconGlow: {
    position: "absolute",
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.20)",
  },
  supervisorHeroIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.30)",
  },
  supervisorHeroCopy: { flex: 1, minWidth: 0, gap: 4 },
  supervisorHeroTitle: { color: TEXT, fontSize: 17, fontWeight: "900", letterSpacing: 0.2 },
  supervisorHeroSub: { color: "rgba(255,255,255,0.74)", fontSize: 12, fontWeight: "600", lineHeight: 17 },
  supervisorHeroActionOuter: { position: "relative" },
  supervisorHeroActionGlow: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.35)",
  },
  supervisorHeroAction: {
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
  menuBadgeText: {
    color: "rgba(244,208,111,0.96)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  menuSub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  menuChevronWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  activityPanel: {
    padding: 16,
    gap: 14,
    overflow: "hidden",
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  activityHeaderCopy: { flex: 1, gap: 4 },
  activityTitle: { color: TEXT, fontSize: 18, fontWeight: "900", letterSpacing: 0.2 },
  activitySub: { color: MUTED, fontSize: 12, lineHeight: 17 },
  activityMonthLabel: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  monthFilterPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
    backgroundColor: "rgba(244,208,111,0.08)",
  },
  monthFilterText: { color: GOLD, fontSize: 11, fontWeight: "800" },
  activityLoadingWrap: { paddingVertical: 18, alignItems: "center" },
  activityEmptyCard: {
    padding: 22,
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  activityEmptyTitle: { color: TEXT, fontSize: 15, fontWeight: "800", textAlign: "center" },
  activityEmptyText: { color: MUTED, fontSize: 12, textAlign: "center", lineHeight: 18 },
  churchRowCard: {
    overflow: "hidden",
    marginTop: 2,
  },
  churchRowHeader: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  churchRowIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
  },
  churchRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  churchRowTitle: { color: TEXT, fontSize: 15, fontWeight: "800" },
  churchRowMeta: { color: MUTED, fontSize: 11, fontWeight: "600" },
  churchRowCount: { color: "rgba(244,208,111,0.90)", fontSize: 11, fontWeight: "800", marginTop: 2 },
  churchRowSide: { alignItems: "flex-end", justifyContent: "center", gap: 8, minHeight: 44 },
  trendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  trendPillUp: {
    backgroundColor: "rgba(110,231,168,0.10)",
    borderColor: "rgba(110,231,168,0.25)",
  },
  trendPillDown: {
    backgroundColor: "rgba(252,165,165,0.10)",
    borderColor: "rgba(252,165,165,0.25)",
  },
  trendText: { color: MUTED, fontSize: 10, fontWeight: "800" },
  trendTextUp: { color: "#6EE7A8" },
  trendTextDown: { color: "#FCA5A5" },
  churchDetails: {
    borderTopWidth: 1,
    borderTopColor: GLASS_BORDER_SOFT,
    padding: 12,
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.14)",
  },
  activationDetailCard: {
    borderRadius: RADIUS_SM,
    padding: 12,
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
  },
  activationDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  activationDetailLabel: { color: MUTED, fontSize: 11, fontWeight: "700", flex: 1 },
  activationDetailValue: {
    color: TEXT,
    fontSize: 11,
    fontWeight: "700",
    flex: 1.2,
    textAlign: "right",
  },
  activationDetailValueMono: {
    color: TEXT,
    fontSize: 11,
    fontWeight: "800",
    flex: 1.2,
    textAlign: "right",
    letterSpacing: 0.3,
  },
  activationDetailStatus: {
    color: "#6EE7A8",
    fontSize: 11,
    fontWeight: "800",
    flex: 1.2,
    textAlign: "right",
  },
  pressedSoft: { opacity: 0.94, transform: [{ scale: 0.988 }] },
  loadingWrap: { paddingVertical: 12, alignItems: "center" },
  errorCard: {
    padding: 12,
    borderRadius: RADIUS_SM,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  errorCardInline: {
    padding: 12,
    borderRadius: RADIUS_SM,
    backgroundColor: "rgba(239,68,68,0.10)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.28)",
  },
  errorText: { color: "#FCA5A5", fontSize: 13 },
  noticeCard: {
    padding: 20,
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  noticeTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
