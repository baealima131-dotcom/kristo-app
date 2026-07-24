import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  type ScrollView as RNScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  INTRO_ELIGIBILITY_STATUS,
  type CustomerInfo,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from "react-native-purchases";
import {
  setPaymentsCurrentModule,
  setSubscriptionPlanStatus,
  setSubscriptionSelectedPlan,
  type SubscriptionPlanKey,
} from "../../../../src/store/paymentsStore";
import { SubscriptionLegalDisclosure } from "../../../../src/components/payments/SubscriptionLegalDisclosure";
import { IosChurchSubscriptionFiveSlotPaywall } from "../../../../src/components/payments/IosChurchSubscriptionFiveSlotPaywall";
import type { IosChurchSubscriptionSlotCardModel } from "../../../../src/components/payments/IosChurchSubscriptionFiveSlotPaywall";
import {
  configureChurchMobileSubscriptions,
  formatSubscriptionSetupError,
  formatPremiumRenewalDate,
  formatPremiumSubscriptionExpiryLabel,
  formatPremiumSubscriptionRenewalLabel,
  invalidateSubscriptionOfferingsCache,
  getSubscriptionOfferings,
  getCustomerSubscriptionInfo,
  hasPremiumEntitlement,
  isRevenueCatSandboxSubscriptionEnvironment,
  logEntitlementAudit,
  logInRevenueCatForChurchSubscription,
  logRevenueCatSubscriptionOwnershipDebug,
  getActiveEntitlementKeys,
  canOpenAndroidPlaySubscriptionManagement,
  hasActivePremiumProduct,
  isDeviceManageableAppStoreSubscription,
  logSubscriptionOwnershipChainDiag,
  resolveAppStoreBillingFooterText,
  resolveAppStoreManageFallbackMessage,
  resolveSubscriptionPackagesLoadingMessage,
  openSubscriptionManagement,
  purchaseSubscriptionPackage,
  purchaseSubscriptionProductId,
  refreshCustomerInfoUntilYearlyActive,
  resolveActiveSubscriptionPlan,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  resolveIosAssignedProductPurchasePath,
  packageMatchesAssignedProductId,
  IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE,
  collectDeviceOwnedPremiumProductIds,
  getOrCreateDevicePurchaseScope,
  getOrCreateIosPurchaseSessionId,
  clearIosPurchaseSessionId,
  enumerateIosRotationProductsInCustomerInfo,
  resolvePremiumSubscriptionBillingDetails,
  formatPremiumIntroTrialBillingLine,
  describeCurrentOfferingPackages,
  setRevenueCatDebugRouteEnabled,
  resolveYearlySavingsDisplay,
  monthlyPackageHasIntroOffer,
  resolveIntroTrialDays,
  resolveMonthlyProductIntro,
  fetchMonthlyIntroTrialEligibility,
  resolveMonthlyIntroTrialEligible,
  logAndroidBillingConfigDiagnostics,
  logAndroidPurchaseError,
  getRevenueCatPurchaseErrorDetail,
  getActivePremiumEntitlement,
  isExistingStoreSubscriptionError,
  loadIosPremiumPurchaseSlotStoreProducts,
  formatStoreProductDisplayPrice,
  EXISTING_STORE_SUBSCRIPTION_SYNC_TITLE,
  EXISTING_STORE_SUBSCRIPTION_SYNC_MESSAGE,
} from "../../../../src/lib/payments/mobileSubscriptions";
import {
  IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  PREMIUM_MONTHLY_PRODUCT_ID,
  isIosPremiumPurchaseSlotProductId,
  isIosPremiumRotationMonthlyProductId,
} from "../../../../src/lib/payments/churchPremiumRevenueCat";
import {
  areAllIosPremiumSlotsOccupied,
  iosPremiumSlotLabel,
  resolveAllIosPremiumSlotStatuses,
} from "../../../../src/lib/payments/iosPremiumSlotStatus";
import {
  fetchChurchMediaPremiumServerStatus,
  fetchChurchPurchaseProductAssignment,
  fetchChurchPurchaseProductSlotInspection,
  releaseChurchPurchaseProductReservation,
  isBackendManagedMediaPremiumStatus,
  isOfflineActivationMediaPremiumStatus,
  isPastorSessionRole,
  logChurchSubscriptionContext,
  recoverChurchSubscriptionFromExistingStore,
  resolvePrepurchaseOwnershipGateUiAction,
  resolveStoreNewPurchaseBlockedUntilExpiryMessage,
  runSubscriptionPrepurchaseOwnershipGate,
  shouldSkipExistingStoreRecoveryForCancelledOverlap,
  syncChurchSubscriptionAfterPurchase,
  type ChurchMediaPremiumServerStatus,
  type ChurchSubscriptionActivationSource,
  type SubscriptionPrepurchaseOwnershipResult,
} from "../../../../src/lib/churchSubscription";
import {
  isSubscriptionOwnershipLockBlockingActivation,
  isSubscriptionOwnershipLockBlockingPurchase,
  shouldFailClosedSubscriptionPurchase,
} from "../../../../src/lib/churchSubscriptionMediaSignals";
import { SubscriptionOwnershipLockCard } from "../../../../src/components/payments/SubscriptionOwnershipLockCard";
import {
  SubscriptionStoreConflictModal,
  type SubscriptionStoreConflictModalVariant,
} from "../../../../src/components/payments/SubscriptionStoreConflictModal";
import type { ChurchMediaSubscriptionOwnershipLock } from "../../../../src/lib/churchSubscriptionMediaSignals";
import { recoverChurchIdFromMembership } from "../../../../src/lib/churchLockedRecovery";
import { churchIdsMatch } from "../../../../src/lib/churchPremiumAccess";
import { onChurchPremiumAccessChanged } from "../../../../src/lib/kristoProfileEvents";
import { getKristoHeaders } from "../../../../src/lib/kristoHeaders";
import { getSessionSync } from "../../../../src/lib/kristoSession";
import { useKristoSession } from "../../../../src/lib/KristoSessionProvider";
import { isAppleReviewBypassEnabled } from "../../../../src/lib/subscriptionBypass";

const YEARLY_NOT_CONFIRMED_ALERT =
  "Apple may defer this plan change until your next renewal. Your monthly plan is still active. Manage the subscription in Apple Subscriptions if you need to complete the yearly upgrade.";

const LEGACY_PENDING_PLAN_SWITCH_PREFIX = "kristo_pending_plan_switch_v1";

const YEARLY_FEATURES = [
  "Best value for churches",
  "Priority support",
  "Full Media Premium access",
  "Annual billing",
] as const;

const YEARLY_UPSELL_PILLS = [
  "Priority support",
  "Full Media Premium access",
  "Annual billing",
] as const;

type SubscriptionScreenState = "none" | "monthly" | "yearly" | "offline";

const OFFLINE_ACTIVATION_MESSAGE =
  "This church was activated using an offline activation code. When access expires, contact an authorized Agent to activate the church again.";

const BACKEND_MANAGED_PREMIUM_MESSAGE =
  "Premium active — managed by church/backend activation. This access is not billed through the app store on this device and cannot be cancelled here. Contact your church or Kristo support if access should change.";

const KRISTO_MANAGED_ACCESS_ALERT_TITLE = "Subscription access";
const APP_STORE_MANAGE_ALERT_TITLE = "Manage / Cancel subscription";

const INACTIVE_INTRO_TRIAL = {
  isActive: false,
  badgeLabel: null,
  trialDays: null,
  trialEndsAt: null,
  firstPaymentAmount: null,
  periodType: null,
} as const;

function resolveMediaPremiumDisplayScreenState(
  status: ChurchMediaPremiumServerStatus | null
): SubscriptionScreenState {
  if (!status?.serverSubscriptionActive) return "none";
  if (isOfflineActivationMediaPremiumStatus(status)) return "offline";
  if (status.subscriptionPlan === "yearly") return "yearly";
  return "monthly";
}

function resolveMediaPremiumExpiryLabel(
  status: ChurchMediaPremiumServerStatus | null,
  customerInfo?: CustomerInfo | null
): string | null {
  if (!status?.serverSubscriptionActive || !status.subscriptionExpiresAt) return null;
  return formatPremiumSubscriptionExpiryLabel(new Date(status.subscriptionExpiresAt), {
    customerInfo,
  });
}

function resolveServerPremiumBillingDetails(
  status: ChurchMediaPremiumServerStatus | null
): ReturnType<typeof resolvePremiumSubscriptionBillingDetails> {
  if (!status?.serverSubscriptionActive) {
    return {
      status: "Inactive",
      autoRenew: "—",
      renewalDate: null,
      billingCycle: null,
      introTrial: { ...INACTIVE_INTRO_TRIAL },
    };
  }

  const renewalDate = status.subscriptionExpiresAt
    ? new Date(status.subscriptionExpiresAt)
    : null;

  return {
    status: "Active",
    autoRenew: "—",
    renewalDate,
    billingCycle:
      status.subscriptionPlan === "yearly"
        ? "Yearly"
        : status.subscriptionPlan === "monthly"
          ? "Monthly"
          : null,
    introTrial: { ...INACTIVE_INTRO_TRIAL },
  };
}

async function clearLegacyPendingPlanSwitchStorage(churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return;
  try {
    await AsyncStorage.removeItem(`${LEGACY_PENDING_PLAN_SWITCH_PREFIX}:${cid}`);
  } catch {
    // ignore
  }
}

function formatPrice(pkg?: PurchasesPackage, fallback?: string) {
  return pkg?.product.priceString || fallback || "";
}

function extractRevenueCatErrorCode(message: string | null): number | null {
  const raw = String(message || "");
  const match = raw.match(/\(code\s+(\d+)\)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatBillingMetaRow(
  billing: ReturnType<typeof resolvePremiumSubscriptionBillingDetails>,
  customerInfo?: CustomerInfo | null
): string {
  if (billing.introTrial.isActive) {
    const endsLabel = billing.introTrial.trialEndsAt
      ? formatPremiumRenewalDate(billing.introTrial.trialEndsAt)
      : null;
    const firstPaymentLine = formatPremiumIntroTrialBillingLine(billing.introTrial);
    const sandbox = isRevenueCatSandboxSubscriptionEnvironment(customerInfo);
    const parts = [
      endsLabel
        ? sandbox
          ? `Sandbox trial ends ${endsLabel}`
          : `Trial ends ${endsLabel}`
        : null,
      firstPaymentLine,
      billing.autoRenew !== "—" ? `Auto-renew ${billing.autoRenew}` : null,
    ].filter(Boolean);
    return parts.join("  •  ");
  }

  const parts = [
    `Status: ${billing.status}`,
    billing.renewalDate
      ? formatPremiumSubscriptionRenewalLabel(billing.renewalDate, { customerInfo })
      : null,
    billing.autoRenew !== "—" ? `Auto-renew ${billing.autoRenew}` : null,
  ].filter(Boolean);

  return parts.join("  •  ");
}

function StatusChip({ label, tone = "gold" }: { label: string; tone?: "gold" | "green" }) {
  return (
    <View style={[s.statusChip, tone === "green" ? s.statusChipGreen : s.statusChipGold]}>
      <Text style={[s.statusChipText, tone === "green" ? s.statusChipTextGreen : null]}>
        {label}
      </Text>
    </View>
  );
}

function GlassCard({
  children,
  highlighted,
  goldGlow,
  dimmed,
  compact,
}: {
  children: React.ReactNode;
  highlighted?: boolean;
  goldGlow?: boolean;
  dimmed?: boolean;
  compact?: boolean;
}) {
  return (
    <View
      style={[
        s.glassCardOuter,
        goldGlow ? s.glassCardOuterGold : null,
        dimmed ? s.glassCardDimmed : null,
      ]}
    >
      <LinearGradient
        colors={
          goldGlow
            ? ["rgba(196,171,114,0.10)", "rgba(255,255,255,0.04)", "rgba(10,14,24,0.96)"]
            : highlighted
              ? ["rgba(196,171,114,0.08)", "rgba(255,255,255,0.03)", "rgba(10,14,24,0.96)"]
              : ["rgba(255,255,255,0.05)", "rgba(255,255,255,0.02)", "rgba(10,14,24,0.98)"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          s.glassCard,
          compact ? s.glassCardCompact : null,
          highlighted ? s.glassCardHighlighted : null,
          goldGlow ? s.glassCardGold : null,
        ]}
      >
        <View pointerEvents="none" style={s.glassSheen} />
        {children}
      </LinearGradient>
    </View>
  );
}

function PlanHeader({
  icon,
  planName,
  description,
  price,
  period,
  subPrice,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  planName: string;
  description?: string;
  price: string;
  period: string;
  subPrice?: string;
}) {
  return (
    <View style={s.planHeaderRow}>
      <View style={s.planHeaderLeft}>
        <View style={s.planIconWrap}>
          <Ionicons name={icon} size={18} color="rgba(196,171,114,0.95)" />
        </View>
        <View style={s.planHeaderCopy}>
          <Text style={s.planTitle}>{planName}</Text>
          {description ? <Text style={s.planDescription}>{description}</Text> : null}
        </View>
      </View>
      <View style={s.planHeaderRight}>
        {subPrice ? (
          <View style={s.planPriceStack}>
            <Text style={s.planPrice}>{price}</Text>
            <Text style={s.planSubPrice}>{subPrice}</Text>
          </View>
        ) : (
          <>
            <Text style={s.planPrice}>{price}</Text>
            {period ? <Text style={s.planPeriod}>{period}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
}

function CompactMetaRow({ text }: { text: string }) {
  return (
    <View style={s.metaRow}>
      <Ionicons name="information-circle-outline" size={14} color="rgba(255,255,255,0.38)" />
      <Text style={s.metaRowText}>{text}</Text>
    </View>
  );
}

function FeaturePills({ items }: { items: readonly string[] }) {
  return (
    <View style={s.pillRow}>
      {items.map((item) => (
        <View key={item} style={s.featurePill}>
          <Text style={s.featurePillText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function PrimaryCta({
  label,
  onPress,
  loading,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [s.ctaOuter, pressed ? s.pressed : null, loading ? s.ctaDisabled : null]}
    >
      <LinearGradient
        colors={["#E8D4A8", "#C4AB72", "#A89258"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.ctaGradient}
      >
        {loading ? (
          <ActivityIndicator color="#1A1610" size="small" />
        ) : (
          <Text style={s.ctaText}>{label}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

/**
 * iOS-only Monthly Plan offer — presentation polish only.
 * Trial vs paid copy is supplied by existing eligibility props; no purchase logic here.
 */
const IOS_MONTHLY_MINISTRY_BENEFITS: ReadonlyArray<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  microLabel: string;
  support: string;
  index: string;
  accent: "gold" | "cyan" | "violet";
}> = [
  {
    icon: "radio-outline",
    title: "Serve God through media",
    microLabel: "MEDIA",
    support: "Sermons • Teachings • Church messages",
    index: "01",
    accent: "gold",
  },
  {
    icon: "people-outline",
    title: "Shepherd your flock",
    microLabel: "CARE",
    support: "Members • Ministries • Connection",
    index: "02",
    accent: "cyan",
  },
  {
    icon: "sparkles-outline",
    title: "Grow your church ministry",
    microLabel: "GROW",
    support: "Live streaming • Premium media tools",
    index: "03",
    accent: "violet",
  },
];

const IOS_MONTHLY_ACCENT = {
  gold: {
    iconBg: ["rgba(240,208,140,0.28)", "rgba(168,120,40,0.12)"] as const,
    iconBorder: "rgba(232,200,120,0.55)",
    iconColor: "rgba(242,220,160,1)",
    glow: "rgba(220,180,90,0.35)",
    cardBorder: "rgba(214,180,110,0.28)",
    cardBg: ["rgba(48,38,22,0.55)", "rgba(18,16,24,0.72)"] as const,
    micro: "rgba(232,208,150,0.88)",
    index: "rgba(232,208,150,0.55)",
    dot: "rgba(240,210,130,0.95)",
  },
  cyan: {
    iconBg: ["rgba(120,220,220,0.24)", "rgba(30,110,120,0.14)"] as const,
    iconBorder: "rgba(110,210,210,0.48)",
    iconColor: "rgba(170,240,235,1)",
    glow: "rgba(80,200,200,0.32)",
    cardBorder: "rgba(100,200,200,0.26)",
    cardBg: ["rgba(18,40,48,0.58)", "rgba(14,18,28,0.74)"] as const,
    micro: "rgba(150,230,225,0.86)",
    index: "rgba(150,230,225,0.52)",
    dot: "rgba(130,230,220,0.95)",
  },
  violet: {
    iconBg: ["rgba(180,150,255,0.24)", "rgba(80,60,160,0.16)"] as const,
    iconBorder: "rgba(170,140,245,0.48)",
    iconColor: "rgba(210,190,255,1)",
    glow: "rgba(140,110,230,0.34)",
    cardBorder: "rgba(160,130,235,0.28)",
    cardBg: ["rgba(36,28,58,0.58)", "rgba(16,14,28,0.74)"] as const,
    micro: "rgba(200,180,255,0.86)",
    index: "rgba(200,180,255,0.52)",
    dot: "rgba(180,160,255,0.95)",
  },
} as const;

function IosMonthlyPlanOfferCard({
  planName,
  description,
  displayPrice,
  showTrial,
  trialHeadline,
  trialThenLabel,
  trialBadge,
  ctaLabel,
  onPress,
  loading,
}: {
  planName: string;
  description: string;
  displayPrice: string;
  showTrial: boolean;
  trialHeadline?: string | null;
  trialThenLabel?: string | null;
  trialBadge?: string | null;
  ctaLabel: string;
  onPress: () => void;
  loading?: boolean;
}) {
  const priceAccessibilityLabel = showTrial
    ? `${trialHeadline || "Free trial"}. ${trialThenLabel || `Then ${displayPrice} per month`}`.trim()
    : `${displayPrice} per month`;

  const benefitsAccessibilityLabel = IOS_MONTHLY_MINISTRY_BENEFITS.map(
    (benefit) => `${benefit.index}. ${benefit.title}. ${benefit.support}`
  ).join(" ");

  return (
    <View style={s.iosMonthlyOuter}>
      {/* Outer ambient glows (static — reduced-motion safe) */}
      <View pointerEvents="none" style={s.iosMonthlyAmbientCyan} />
      <View pointerEvents="none" style={s.iosMonthlyAmbientViolet} />

      <View style={s.iosMonthlyShell}>
        <LinearGradient
          colors={[
            "rgba(28,42,72,0.92)",
            "rgba(16,22,38,0.96)",
            "rgba(10,12,22,0.98)",
            "rgba(8,10,18,0.99)",
          ]}
          locations={[0, 0.32, 0.7, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={s.iosMonthlyCard}
        >
          {/* Atmosphere layers */}
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(232,208,150,0.14)", "transparent", "transparent"]}
            locations={[0, 0.22, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={s.iosMonthlyAtmosphereTop}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[
              "transparent",
              "rgba(90,210,210,0.08)",
              "transparent",
              "rgba(150,120,240,0.07)",
              "transparent",
            ]}
            locations={[0, 0.28, 0.5, 0.72, 1]}
            start={{ x: 0, y: 0.15 }}
            end={{ x: 1, y: 0.9 }}
            style={s.iosMonthlyDiagonalSheen}
          />
          <View pointerEvents="none" style={s.iosMonthlyTopGloss} />
          <View pointerEvents="none" style={s.iosMonthlySheenBloom} />
          <View pointerEvents="none" style={s.iosMonthlyInnerBorder} />
          <View pointerEvents="none" style={s.iosMonthlyGoldEdge} />

          {/* Status + optional trial pill */}
          <View style={s.iosMonthlyStatusRow}>
            <View style={s.iosMonthlyStatusPill}>
              <LinearGradient
                colors={["rgba(232,208,150,0.22)", "rgba(80,200,200,0.12)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.iosMonthlyStatusPillFill}
              >
                <View style={s.iosMonthlyStatusDot} />
                <View style={s.iosMonthlyStatusCopy}>
                  <Text style={s.iosMonthlyStatusEyebrow} maxFontSizeMultiplier={1.15}>
                    MEDIA PREMIUM
                  </Text>
                  <Text style={s.iosMonthlyStatusSub} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                    Built for ministry growth
                  </Text>
                </View>
              </LinearGradient>
            </View>
            {showTrial && trialBadge ? (
              <View style={s.iosMonthlyTrialPill}>
                <Text style={s.iosMonthlyTrialPillText} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {trialBadge}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Header: plan + price tile */}
          <View style={s.iosMonthlyTopRow}>
            <View style={s.iosMonthlyLeft}>
              <View style={s.iosMonthlyIconTile}>
                <LinearGradient
                  colors={["rgba(250,230,180,0.38)", "rgba(180,140,60,0.16)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.iosMonthlyIconTileFill}
                >
                  <Ionicons name="calendar-outline" size={20} color="rgba(250,230,180,1)" />
                </LinearGradient>
              </View>
              <View style={s.iosMonthlyCopy}>
                <Text style={s.iosMonthlyTitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {planName}
                </Text>
                <Text style={s.iosMonthlySubtitle} numberOfLines={2} maxFontSizeMultiplier={1.25}>
                  {description}
                </Text>
              </View>
            </View>

            <View style={s.iosMonthlyHeaderDivider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />

            <View
              style={s.iosMonthlyPriceTile}
              accessible
              accessibilityLabel={priceAccessibilityLabel}
            >
              <LinearGradient
                colors={["rgba(255,255,255,0.1)", "rgba(20,24,36,0.55)"]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={s.iosMonthlyPriceTileFill}
              >
                {showTrial ? (
                  <>
                    <Text
                      style={s.iosMonthlyTrialPrice}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      maxFontSizeMultiplier={1.2}
                    >
                      {trialHeadline}
                    </Text>
                    <Text
                      style={s.iosMonthlyTrialThen}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.82}
                      maxFontSizeMultiplier={1.2}
                    >
                      Then {displayPrice}
                    </Text>
                    <Text style={s.iosMonthlyPeriod} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      per month
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      style={s.iosMonthlyPrice}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.82}
                      maxFontSizeMultiplier={1.2}
                    >
                      {displayPrice}
                    </Text>
                    <Text style={s.iosMonthlyPeriod} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      per month
                    </Text>
                  </>
                )}
              </LinearGradient>
            </View>
          </View>

          {/* Distinct benefit cards */}
          <View
            style={s.iosMonthlyBenefits}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={benefitsAccessibilityLabel}
          >
            {IOS_MONTHLY_MINISTRY_BENEFITS.map((benefit) => {
              const accent = IOS_MONTHLY_ACCENT[benefit.accent];
              return (
                <View
                  key={benefit.title}
                  style={[
                    s.iosMonthlyBenefitCard,
                    {
                      borderColor: accent.cardBorder,
                      shadowColor: accent.glow,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[...accent.cardBg]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.iosMonthlyBenefitCardFill}
                  >
                    <View style={s.iosMonthlyBenefitIndexCol}>
                      <Text style={[s.iosMonthlyBenefitIndex, { color: accent.index }]}>
                        {benefit.index}
                      </Text>
                      <View style={[s.iosMonthlyBenefitDot, { backgroundColor: accent.dot }]} />
                      <View style={[s.iosMonthlyBenefitConnector, { backgroundColor: accent.dot }]} />
                    </View>

                    <View
                      style={[
                        s.iosMonthlyBenefitIcon,
                        {
                          borderColor: accent.iconBorder,
                          shadowColor: accent.glow,
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={[...accent.iconBg]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={s.iosMonthlyBenefitIconFill}
                      >
                        <Ionicons name={benefit.icon} size={15} color={accent.iconColor} />
                      </LinearGradient>
                    </View>

                    <View style={s.iosMonthlyBenefitCopy}>
                      <View style={s.iosMonthlyBenefitTitleRow}>
                        <Text
                          style={s.iosMonthlyBenefitTitle}
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.2}
                        >
                          {benefit.title}
                        </Text>
                        <Text
                          style={[s.iosMonthlyBenefitMicro, { color: accent.micro }]}
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.1}
                        >
                          {benefit.microLabel}
                        </Text>
                      </View>
                      <Text
                        style={s.iosMonthlyBenefitDesc}
                        numberOfLines={2}
                        maxFontSizeMultiplier={1.25}
                      >
                        {benefit.support}
                      </Text>
                    </View>
                  </LinearGradient>
                </View>
              );
            })}
          </View>

          {/* CTA */}
          <Pressable
            onPress={onPress}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: !!loading, busy: !!loading }}
            style={({ pressed }) => [
              s.iosMonthlyCtaOuter,
              pressed ? s.iosMonthlyCtaPressed : null,
              loading ? s.iosMonthlyCtaDisabled : null,
            ]}
          >
            <LinearGradient
              colors={["#F6E6C0", "#E0C07A", "#C4A05A", "#B08A48"]}
              locations={[0, 0.35, 0.75, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.iosMonthlyCtaGradient}
            >
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.55)", "rgba(255,255,255,0.08)", "transparent"]}
                locations={[0, 0.35, 1]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={s.iosMonthlyCtaShine}
              />
              <View pointerEvents="none" style={s.iosMonthlyCtaTopHighlight} />
              {loading ? (
                <ActivityIndicator color="#1A1610" size="small" />
              ) : (
                <View style={s.iosMonthlyCtaContent}>
                  <Text
                    style={s.iosMonthlyCtaText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.86}
                    maxFontSizeMultiplier={1.2}
                  >
                    {ctaLabel}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color="#1A1610" />
                </View>
              )}
            </LinearGradient>
          </Pressable>
        </LinearGradient>
      </View>
    </View>
  );
}

function CompactSecondaryCta({
  label,
  onPress,
  loading,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        s.compactSecondaryCta,
        pressed ? s.pressed : null,
        loading ? s.ctaDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={s.compactSecondaryCtaText}>{label}</Text>
      )}
    </Pressable>
  );
}

function CurrentPlanCard({
  icon,
  planName,
  description,
  price,
  period,
  subPrice,
  billing,
  successMessage,
  trialBadge,
  customerInfo,
  subscribedChurchId,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  planName: string;
  description: string;
  price: string;
  period: string;
  subPrice?: string;
  billing: ReturnType<typeof resolvePremiumSubscriptionBillingDetails>;
  successMessage: string;
  trialBadge?: string | null;
  customerInfo?: CustomerInfo | null;
  /** Backend-mapped Church ID for the active product only. */
  subscribedChurchId?: string | null;
}) {
  return (
    <GlassCard highlighted>
      <View style={s.currentPlanChipRow}>
        <StatusChip label="CURRENT PLAN" />
        {trialBadge ? <StatusChip label={trialBadge} tone="green" /> : null}
      </View>
      <PlanHeader
        icon={icon}
        planName={planName}
        description={description}
        price={price}
        period={period}
        subPrice={subPrice}
      />
      {subscribedChurchId ? (
        <View style={s.subscribedChurchMeta}>
          <Text style={s.subscribedChurchLabel}>SUBSCRIBED CHURCH ID</Text>
          <Text style={s.subscribedChurchValue} selectable>
            {subscribedChurchId}
          </Text>
        </View>
      ) : null}
      <CompactMetaRow text={formatBillingMetaRow(billing, customerInfo)} />
      <View style={s.successNote}>
        <Ionicons name="shield-checkmark" size={14} color="rgba(120,220,160,0.95)" />
        <Text style={s.successNoteText}>{successMessage}</Text>
      </View>
    </GlassCard>
  );
}

function YearlyUpsellCard({
  price,
  period,
  savingsLabel,
  onSwitch,
  loading,
}: {
  price: string;
  period: string;
  savingsLabel: string;
  onSwitch: () => void;
  loading?: boolean;
}) {
  return (
    <GlassCard goldGlow>
      <View style={s.yearlyTopRow}>
        <StatusChip label={savingsLabel} tone="green" />
        <Text style={s.bestValueText}>Best value for churches</Text>
      </View>
      <PlanHeader
        icon="diamond-outline"
        planName="Yearly Plan"
        description="Full Media Premium access"
        price={price}
        period={period}
      />
      <FeaturePills items={YEARLY_UPSELL_PILLS} />
      <PrimaryCta label="Switch to Yearly" onPress={onSwitch} loading={loading} />
    </GlassCard>
  );
}

function PlanOfferCard({
  icon,
  planName,
  description,
  price,
  period,
  subPrice,
  trialBadge,
  savingsLabel,
  featurePills,
  ctaLabel,
  onPress,
  loading,
  goldGlow,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  planName: string;
  description: string;
  price: string;
  period: string;
  subPrice?: string;
  trialBadge?: string;
  savingsLabel?: string;
  featurePills?: readonly string[];
  ctaLabel: string;
  onPress: () => void;
  loading?: boolean;
  goldGlow?: boolean;
}) {
  return (
    <GlassCard goldGlow={goldGlow} highlighted={!goldGlow}>
      {trialBadge ? (
        <View style={s.yearlyTopRow}>
          <StatusChip label={trialBadge} tone="green" />
        </View>
      ) : savingsLabel ? (
        <View style={s.yearlyTopRow}>
          <StatusChip label={savingsLabel} tone="green" />
        </View>
      ) : null}
      <PlanHeader
        icon={icon}
        planName={planName}
        description={description}
        price={price}
        period={period}
        subPrice={subPrice}
      />
      {featurePills?.length ? <FeaturePills items={featurePills} /> : null}
      <PrimaryCta label={ctaLabel} onPress={onPress} loading={loading} />
    </GlassCard>
  );
}

function AvailablePlanCard({
  planName,
  price,
  period,
}: {
  planName: string;
  price: string;
  period: string;
}) {
  return (
    <GlassCard dimmed compact>
      <View style={s.availableRow}>
        <View style={s.planHeaderLeft}>
          <View style={[s.planIconWrap, s.planIconWrapMuted]}>
            <Ionicons name="calendar-outline" size={16} color="rgba(255,255,255,0.42)" />
          </View>
          <View style={s.planHeaderCopy}>
            <Text style={s.planTitleMuted}>{planName}</Text>
            <Text style={s.planDescriptionMuted}>Available</Text>
          </View>
        </View>
        <View style={s.planHeaderRight}>
          <Text style={s.planPriceMuted}>{price}</Text>
          <Text style={s.planPeriodMuted}>{period}</Text>
        </View>
      </View>
    </GlassCard>
  );
}

function ManageSubscriptionCard({
  onPress,
  loading,
}: {
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <GlassCard compact>
      <View style={s.manageRow}>
        <View style={s.manageIconWrap}>
          <Ionicons name="card-outline" size={18} color="rgba(196,171,114,0.95)" />
        </View>
        <View style={s.manageCopy}>
          <Text style={s.manageTitle}>Manage / Cancel Subscription</Text>
          <Text style={s.manageDescription} numberOfLines={2}>
            {Platform.OS === "android"
              ? "Open Google Play subscriptions to update billing or cancel."
              : "Open Apple Subscriptions to update billing or cancel."}
          </Text>
        </View>
      </View>
      <CompactSecondaryCta
        label="Manage / Cancel Subscription"
        onPress={onPress}
        loading={loading}
      />
    </GlassCard>
  );
}

function OfflineActivationSubscriptionCard({
  expiryLabel,
}: {
  expiryLabel: string | null;
}) {
  return (
    <GlassCard highlighted>
      <View style={s.currentPlanChipRow}>
        <StatusChip label="ACTIVE" />
        <StatusChip label="OFFLINE ACTIVATION" tone="green" />
      </View>
      <View style={s.planHeaderRow}>
        <View style={s.planHeaderLeft}>
          <View style={s.planIconWrap}>
            <Ionicons name="key-outline" size={18} color="rgba(196,171,114,0.95)" />
          </View>
          <View style={s.planHeaderCopy}>
            <Text style={s.planTitle}>Media Premium Access</Text>
            <Text style={s.planDescription}>Offline Activation / Activated by Agent</Text>
          </View>
        </View>
      </View>
      <CompactMetaRow
        text={["Status: Active", expiryLabel].filter(Boolean).join("  •  ")}
      />
      <CompactMetaRow text="Source: Offline Activation / Activated by Agent" />
      <View style={s.successNote}>
        <Ionicons name="information-circle-outline" size={14} color="rgba(196,171,114,0.95)" />
        <Text style={s.successNoteText}>{OFFLINE_ACTIVATION_MESSAGE}</Text>
      </View>
    </GlassCard>
  );
}

function BackendManagedPremiumNoteCard({
  expiryLabel,
}: {
  expiryLabel: string | null;
}) {
  return (
    <GlassCard highlighted>
      <View style={s.currentPlanChipRow}>
        <StatusChip label="ACTIVE" />
        <StatusChip label="CHURCH MANAGED" tone="green" />
      </View>
      <View style={s.planHeaderRow}>
        <View style={s.planHeaderLeft}>
          <View style={s.planIconWrap}>
            <Ionicons name="shield-checkmark-outline" size={18} color="rgba(196,171,114,0.95)" />
          </View>
          <View style={s.planHeaderCopy}>
            <Text style={s.planTitle}>Media Premium Access</Text>
            <Text style={s.planDescription}>Managed by church/backend activation</Text>
          </View>
        </View>
      </View>
      <CompactMetaRow
        text={["Status: Active", expiryLabel].filter(Boolean).join("  •  ")}
      />
      <View style={s.successNote}>
        <Ionicons name="information-circle-outline" size={14} color="rgba(196,171,114,0.95)" />
        <Text style={s.successNoteText}>{BACKEND_MANAGED_PREMIUM_MESSAGE}</Text>
      </View>
    </GlassCard>
  );
}

export default function PaymentsSubscriptionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading: sessionLoading, setSession } = useKristoSession();

  const [churchId, setChurchId] = useState("");
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [yearlyPackage, setYearlyPackage] = useState<PurchasesPackage | null>(null);
  const [assignedMonthlyProductId, setAssignedMonthlyProductId] = useState<string | null>(null);
  const [activeReservationId, setActiveReservationId] = useState<string | null>(null);
  const [purchaseSessionId, setPurchaseSessionId] = useState<string | null>(null);
  /** Session-accumulated Apple already-owned G2–G5 IDs (CustomerInfo can lag). */
  const [sessionBlockedProductIds, setSessionBlockedProductIds] = useState<string[]>([]);
  const [alreadyOwnedRecoveryCount, setAlreadyOwnedRecoveryCount] = useState(0);
  const [iosSlotCards, setIosSlotCards] = useState<IosChurchSubscriptionSlotCardModel[]>([]);
  const [iosAllSlotsOccupied, setIosAllSlotsOccupied] = useState(false);
  const [submittingProductId, setSubmittingProductId] = useState<string | null>(null);
  const [restoringPurchases, setRestoringPurchases] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [monthlyIntroEligibility, setMonthlyIntroEligibility] =
    useState<INTRO_ELIGIBILITY_STATUS | null>(null);
  const [mediaPremiumStatus, setMediaPremiumStatus] =
    useState<ChurchMediaPremiumServerStatus | null>(null);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [submittingPlan, setSubmittingPlan] = useState<SubscriptionPlanKey | "manage" | null>(
    null
  );
  const [storeConflictModalOpen, setStoreConflictModalOpen] = useState(false);
  const [storeConflictVariant, setStoreConflictVariant] =
    useState<SubscriptionStoreConflictModalVariant>("ownership_lock");
  const [storeConflictLock, setStoreConflictLock] = useState<ChurchMediaSubscriptionOwnershipLock | null>(
    null
  );
  const [managingStoreConflict, setManagingStoreConflict] = useState(false);
  const scrollRef = useRef<RNScrollView | null>(null);
  const suppressFocusServerRefreshRef = useRef(true);

  const sessionUserId = String((session as any)?.userId || "").trim();
  const sessionRole = String(
    (session as any)?.role || (session as any)?.churchRole || ""
  ).trim();

  useEffect(() => {
    setPaymentsCurrentModule("subscriptions");
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (isOfflineActivationMediaPremiumStatus(mediaPremiumStatus)) {
        setRevenueCatDebugRouteEnabled(false);
        return () => setRevenueCatDebugRouteEnabled(false);
      }
      setRevenueCatDebugRouteEnabled(true);
      return () => setRevenueCatDebugRouteEnabled(false);
    }, [mediaPremiumStatus])
  );

  useEffect(() => {
    if (sessionLoading) return;
    const sessionChurchId = String((session as any)?.churchId || "").trim();
    if (sessionChurchId) {
      setChurchId((current) => current || sessionChurchId);
    }
  }, [sessionLoading, session]);

  async function refreshMediaPremiumServerStatus(
    resolvedChurchId?: string,
    opts?: { bustCache?: boolean }
  ) {
    const cid = String(resolvedChurchId || churchId || (session as any)?.churchId || "").trim();
    if (!cid || !sessionUserId) return null;

    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId: cid,
    }) as Record<string, string>;

    const server = await fetchChurchMediaPremiumServerStatus(cid, headers, {
      bustCache: opts?.bustCache === true,
    });
    setMediaPremiumStatus(server);
    return server;
  }

  useEffect(() => {
    if (!churchId) return;
    return onChurchPremiumAccessChanged((payload) => {
      if (!churchIdsMatch(payload.churchId, churchId)) return;
      if (payload.backendSubscriptionActive === true || payload.subscriptionActive === true) {
        if (payload.subscriptionPlan === "monthly" || payload.subscriptionPlan === "yearly") {
          setSubscriptionSelectedPlan(payload.subscriptionPlan);
        }
        setSubscriptionPlanStatus("active");
        void refreshMediaPremiumServerStatus(churchId, { bustCache: true });
        return;
      }
      // Authoritative revoke / inactive — clear local Premium Active UI for this church only.
      void refreshMediaPremiumServerStatus(churchId, { bustCache: true });
    });
  }, [churchId, sessionUserId, sessionRole]);

  useFocusEffect(
    React.useCallback(() => {
      if (sessionLoading || !churchId) return;
      if (suppressFocusServerRefreshRef.current) return;
      void refreshMediaPremiumServerStatus(churchId);
    }, [sessionLoading, churchId, sessionUserId, sessionRole])
  );

  /**
   * Build the five monthly product cards from StoreKit/RevenueCat + backend slot inspection.
   * Runs for subscribed and unsubscribed churches so all five IAPs stay visible.
   */
  async function buildIosFiveSlotCards(args: {
    churchId: string;
    headers: Record<string, string>;
    devicePurchaseScope: string;
    purchaseSessionId: string | null;
    deviceOwnedProductIds: string[];
    currentChurchSubscribed: boolean;
  }): Promise<IosChurchSubscriptionSlotCardModel[]> {
    const [inspection, storeProducts] = await Promise.all([
      fetchChurchPurchaseProductSlotInspection({
        churchId: args.churchId,
        headers: args.headers,
        devicePurchaseScope: args.devicePurchaseScope,
        purchaseSessionId: args.purchaseSessionId,
        deviceOwnedProductIds: args.deviceOwnedProductIds,
      }),
      loadIosPremiumPurchaseSlotStoreProducts().catch((error) => {
        console.log("KRISTO_IOS_FIVE_SLOT_PRODUCTS_LOAD_FAILED", {
          churchId: args.churchId,
          error: error instanceof Error ? error.message : String(error),
        });
        return [] as PurchasesStoreProduct[];
      }),
    ]);

    const storeById = new Map(
      storeProducts.map((product) => [String(product.identifier || "").trim(), product] as const)
    );
    const appleAvailableProductIds = storeProducts
      .map((product) => String(product.identifier || "").trim())
      .filter((id) => id && isIosPremiumPurchaseSlotProductId(id));

    const ownershipInspectionOk = Boolean(inspection);
    const mappedByProductId = inspection?.mappedByProductId || {};
    const inspectionMappedByProductId: Record<string, string | null> = {};
    for (const slot of inspection?.slots || []) {
      const productId = String(slot.productId || "").trim();
      if (!productId) continue;
      inspectionMappedByProductId[productId] =
        String(slot.mappedChurchId || "").trim().toUpperCase() || null;
    }

    const merged = resolveAllIosPremiumSlotStatuses({
      appleAvailableProductIds,
      thisChurchProductIds: ownershipInspectionOk ? inspection?.thisChurchProductIds || [] : [],
      otherChurchProductIds: ownershipInspectionOk ? inspection?.otherChurchProductIds || [] : [],
      deviceOwnedProductIds: [
        ...args.deviceOwnedProductIds,
        ...(inspection?.deviceOwnedProductIds || []),
      ],
      blockedProductIds: [
        ...sessionBlockedProductIds,
        ...(ownershipInspectionOk ? inspection?.blockedProductIds || [] : []),
      ],
      currentChurchSubscribed: args.currentChurchSubscribed,
    });

    const cards: IosChurchSubscriptionSlotCardModel[] = merged.map((slot) => {
      const mappedFromInspect =
        inspectionMappedByProductId[slot.productId] ??
        (String(mappedByProductId[slot.productId] || "").trim().toUpperCase() || null);
      const mappedChurchId = ownershipInspectionOk ? mappedFromInspect : null;
      return {
        productId: slot.productId,
        slotLabel: slot.slotLabel,
        subscriptionGroupName: slot.subscriptionGroupName,
        status: slot.status,
        statusLabel: slot.statusLabel,
        purchaseEnabled: slot.purchaseEnabled,
        storeProduct: storeById.get(slot.productId) || null,
        mappedChurchId,
        ownershipInspectionOk,
      };
    });

    console.log(
      "KRISTO_IOS_FIVE_SLOT_CATALOG_LOADED",
      JSON.stringify({
        churchId: args.churchId,
        currentChurchSubscribed: args.currentChurchSubscribed,
        ownershipInspectionOk,
        slotCount: cards.length,
        productIds: cards.map((card) => card.productId),
        statuses: cards.map((card) => card.status),
        mappedChurchIds: cards.map((card) => card.mappedChurchId),
        purchasableCount: cards.filter((card) => card.purchaseEnabled).length,
        appleAvailableCount: appleAvailableProductIds.length,
      })
    );

    return cards;
  }

  async function loadSubscriptionPackages(
    resolvedChurchId: string,
    opts?: { forceOfferings?: boolean; serverSubscriptionActive?: boolean | null }
  ) {
    const { configured, customerInfo: configuredCustomerInfo } =
      await configureChurchMobileSubscriptions(resolvedChurchId, { syncPurchases: false });
    if (!configured) {
      throw new Error("RevenueCat is not configured yet.");
    }

    const devicePurchaseScope = await getOrCreateDevicePurchaseScope();
    const sessionId = await getOrCreateIosPurchaseSessionId(resolvedChurchId);
    setPurchaseSessionId(sessionId);

    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId: resolvedChurchId,
    }) as Record<string, string>;

    const deviceOwnedProductIds = [
      ...new Set([
        ...collectDeviceOwnedPremiumProductIds(configuredCustomerInfo),
        ...sessionBlockedProductIds,
      ]),
    ];

    // iOS: the five-product catalog is always built, subscribed or not, so App Review
    // can locate every In-App Purchase from this one screen.
    let builtIosSlotCards: IosChurchSubscriptionSlotCardModel[] = [];
    if (Platform.OS === "ios") {
      builtIosSlotCards = await buildIosFiveSlotCards({
        churchId: resolvedChurchId,
        headers,
        devicePurchaseScope,
        purchaseSessionId: sessionId,
        deviceOwnedProductIds,
        currentChurchSubscribed: opts?.serverSubscriptionActive === true,
      });
      setIosSlotCards(builtIosSlotCards);
      setIosAllSlotsOccupied(areAllIosPremiumSlotsOccupied(builtIosSlotCards));
    }

    // Unsubscribed iOS church: no reservation until a purchase tap on an available card.
    if (Platform.OS === "ios" && opts?.serverSubscriptionActive !== true) {
      setAssignedMonthlyProductId(null);
      setActiveReservationId(null);

      return {
        monthly: null,
        yearly: null,
        customerInfo: configuredCustomerInfo,
        assignedMonthlyProductId: null as string | null,
        iosSlotCards: builtIosSlotCards,
      };
    }

    // Android (and iOS subscribed Current Plan path): keep reserve/assignment behavior.
    const assignment = await fetchChurchPurchaseProductAssignment({
      churchId: resolvedChurchId,
      platform: Platform.OS === "android" ? "android" : "ios",
      headers,
      devicePurchaseScope,
      purchaseSessionId: sessionId,
      deviceOwnedProductIds,
    });
    const preferredMonthlyProductId = String(
      assignment?.monthlyProductId || assignment?.productId || ""
    ).trim();
    if (preferredMonthlyProductId) {
      setAssignedMonthlyProductId(preferredMonthlyProductId);
    }
    if (assignment?.reservationId) {
      setActiveReservationId(assignment.reservationId);
    }
    if (assignment?.purchaseSessionId) {
      setPurchaseSessionId(assignment.purchaseSessionId);
    }

    const offerings = await getSubscriptionOfferings({ force: opts?.forceOfferings === true });
    // iOS: product selection is server-authoritative. Do not fall back to premium_monthly
    // when reservation/assignment failed — that masks membership or API errors.
    const monthly =
      Platform.OS === "ios" && !preferredMonthlyProductId
        ? null
        : resolveMonthlyPackage(offerings, preferredMonthlyProductId || null);
    const yearly =
      Platform.OS === "ios"
        ? null
        : resolveYearlyPackage(
            offerings,
            Platform.OS === "android" ? assignment?.yearlyProductId || null : null
          );

    console.log("RevenueCat offerings packages:\n" + describeCurrentOfferingPackages(offerings));
    console.log("KRISTO_SUBSCRIPTIONS_ASSIGNED_PRODUCT", {
      churchId: resolvedChurchId,
      preferredMonthlyProductId: preferredMonthlyProductId || null,
      monthlyResolved: monthly?.product.identifier || null,
      yearlyResolved: yearly?.product.identifier || null,
      group: assignment?.group ?? null,
    });

    return {
      monthly,
      yearly,
      customerInfo: configuredCustomerInfo,
      assignedMonthlyProductId: preferredMonthlyProductId || null,
      iosSlotCards: builtIosSlotCards,
    };
  }

  function refreshOfferingsSilently() {
    void (async () => {
      try {
        const devicePurchaseScope = await getOrCreateDevicePurchaseScope();
        const sessionId =
          purchaseSessionId ||
          (churchId ? await getOrCreateIosPurchaseSessionId(churchId) : null);
        const headers = churchId
          ? (getKristoHeaders({
              userId: sessionUserId,
              role: sessionRole as any,
              churchId,
            }) as Record<string, string>)
          : undefined;
        const assignment = churchId
          ? await fetchChurchPurchaseProductAssignment({
              churchId,
              platform: Platform.OS === "android" ? "android" : "ios",
              headers,
              devicePurchaseScope,
              purchaseSessionId: sessionId,
              deviceOwnedProductIds: [
                ...new Set([
                  ...collectDeviceOwnedPremiumProductIds(customerInfo),
                  ...sessionBlockedProductIds,
                ]),
              ],
            })
          : null;
        const preferredMonthlyProductId = String(
          assignment?.monthlyProductId || assignment?.productId || assignedMonthlyProductId || ""
        ).trim();
        const offerings = await getSubscriptionOfferings({ force: true });
        const monthly =
          Platform.OS === "ios" && !preferredMonthlyProductId
            ? null
            : resolveMonthlyPackage(offerings, preferredMonthlyProductId || null);
        const yearly =
          Platform.OS === "ios"
            ? null
            : resolveYearlyPackage(
                offerings,
                Platform.OS === "android" ? assignment?.yearlyProductId || null : null
              );
        if (preferredMonthlyProductId) setAssignedMonthlyProductId(preferredMonthlyProductId);
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);
      } catch (error: any) {
        console.log("KRISTO_SUBSCRIPTIONS_OFFERINGS_BACKGROUND_REFRESH_FAILED", {
          message: formatSubscriptionSetupError(error),
        });
      }
    })();
  }

  function applySubscriptionBootState(args: {
    resolvedChurchId: string;
    server: ChurchMediaPremiumServerStatus;
    monthly: PurchasesPackage | null;
    yearly: PurchasesPackage | null;
    customerInfo: CustomerInfo | null;
  }) {
    const { resolvedChurchId, server, monthly, yearly, customerInfo: infoResult } = args;

    setMonthlyPackage(monthly);
    setYearlyPackage(yearly);
    setCustomerInfo(infoResult);

    console.log("KRISTO_SUBSCRIPTIONS_SERVER_STATUS", {
      churchId: resolvedChurchId,
      serverSubscriptionActive: server.serverSubscriptionActive,
      subscriptionPlan: server.subscriptionPlan,
      subscriptionExpiresAt: server.subscriptionExpiresAt,
      subscriptionSource: server.subscriptionSource,
      source: server.source,
    });

    const hasPremium = hasPremiumEntitlement(infoResult);
    if (server.serverSubscriptionActive && infoResult) {
      const activePlan = resolveActiveSubscriptionPlan(infoResult);
      if (activePlan) {
        setSubscriptionSelectedPlan(activePlan);
      }
      setSubscriptionPlanStatus(hasPremium ? "active" : "expired");
    } else {
      setSubscriptionPlanStatus("expired");
    }

    logChurchSubscriptionContext({
      screen: "subscriptions",
      churchId: resolvedChurchId,
      customerInfo: infoResult,
      churchSubscriptionActive: server.serverSubscriptionActive,
      canUseMediaTools: server.canUseMediaTools === true,
    });
    logEntitlementAudit({
      customerInfo: infoResult,
      churchId: resolvedChurchId,
      source: "subscriptions-boot",
    });
    logRevenueCatSubscriptionOwnershipDebug(infoResult, "subscriptions-boot", {
      churchId: resolvedChurchId,
    });

    if (!monthly && !yearly) {
      setSubscriptionError(resolveSubscriptionPackagesLoadingMessage());
    }
  }

  function logMissingIosMonthlyTrialDiagnostics(args: {
    churchId: string;
    monthlyProductId: string | null;
    hasIntroOffer: boolean;
    introEligibility: unknown;
  }) {
    if (Platform.OS !== "ios") return;
    if (args.hasIntroOffer) return;
    const productId = String(args.monthlyProductId || "").trim();
    // G2–G5 intentionally have no intro; only premium_monthly carries the 14-day trial.
    if (!productId || isIosPremiumRotationMonthlyProductId(productId)) return;
    if (productId !== PREMIUM_MONTHLY_PRODUCT_ID) return;
    console.log("KRISTO_IOS_MONTHLY_TRIAL_NOT_CONFIGURED", {
      churchId: args.churchId,
      monthlyProductId: productId,
      introEligibility: args.introEligibility ?? null,
      expectedTrial: "14-day free trial",
      expectedPostTrialPrice: "$49.99/month",
      action:
        "Configure an introductory free trial for premium_monthly in App Store Connect and attach it to the RevenueCat default offering.",
    });
  }

  useEffect(() => {
    let alive = true;

    async function boot() {
      if (sessionLoading) return;

      if (Platform.OS === "android") {
        logAndroidBillingConfigDiagnostics("subscriptions-screen");
      }

      suppressFocusServerRefreshRef.current = true;
      setPackagesLoading(true);
      setSubscriptionError(null);

      try {
        let resolvedChurchId = String((session as any)?.churchId || churchId || "").trim();
        if (!resolvedChurchId) {
          const recovered = await recoverChurchIdFromMembership(session, setSession);
          resolvedChurchId = recovered.churchId;
        }
        if (!resolvedChurchId) {
          throw new Error("Church id is required before loading subscription packages.");
        }

        const headers = getKristoHeaders({
          userId: sessionUserId,
          role: sessionRole as any,
          churchId: resolvedChurchId,
        }) as Record<string, string>;

        setChurchId(resolvedChurchId);
        await clearLegacyPendingPlanSwitchStorage(resolvedChurchId);

        const forceOfferingsReload = reloadToken > 0;
        const server = await fetchChurchMediaPremiumServerStatus(resolvedChurchId, headers);
        if (!alive) return;
        setMediaPremiumStatus(server);

        const packagesResult = await loadSubscriptionPackages(resolvedChurchId, {
          forceOfferings: forceOfferingsReload,
          serverSubscriptionActive: server.serverSubscriptionActive === true,
        }).catch((error) => ({ error } as const));

        if (!alive) return;

        if (isOfflineActivationMediaPremiumStatus(server)) {
          setMonthlyPackage(null);
          setYearlyPackage(null);
          setCustomerInfo(null);
          setSubscriptionPlanStatus(server.serverSubscriptionActive ? "active" : "expired");
          setSubscriptionError(null);

          console.log("KRISTO_SUBSCRIPTIONS_SERVER_STATUS", {
            churchId: resolvedChurchId,
            serverSubscriptionActive: server.serverSubscriptionActive,
            subscriptionPlan: server.subscriptionPlan,
            subscriptionExpiresAt: server.subscriptionExpiresAt,
            subscriptionSource: server.subscriptionSource,
            source: server.source,
            revenueCatBypass: true,
          });
          return;
        }

        if (packagesResult && "error" in packagesResult) {
          let fallbackInfo: CustomerInfo | null = null;
          try {
            fallbackInfo = await getCustomerSubscriptionInfo();
          } catch (infoError: any) {
            console.log("KRISTO_SUBSCRIPTIONS_CUSTOMER_INFO_FALLBACK_FAILED", {
              message: String(infoError?.message || infoError || ""),
            });
          }

          const entitlementActive = hasPremiumEntitlement(fallbackInfo);
          if (entitlementActive) {
            setCustomerInfo(fallbackInfo);
            setSubscriptionPlanStatus("active");
            setSubscriptionError(null);
            refreshOfferingsSilently();
            console.log("KRISTO_SUBSCRIPTIONS_OFFERINGS_ERROR_SUPPRESSED_ACTIVE_ENTITLEMENT", {
              churchId: resolvedChurchId,
              error: formatSubscriptionSetupError(packagesResult.error),
            });
            return;
          }

          throw packagesResult.error;
        }

        applySubscriptionBootState({
          resolvedChurchId,
          server,
          monthly: packagesResult.monthly,
          yearly: packagesResult.yearly,
          customerInfo: packagesResult.customerInfo,
        });

        try {
          const introEligibility = await fetchMonthlyIntroTrialEligibility(
            packagesResult.monthly?.product.identifier ||
              packagesResult.assignedMonthlyProductId ||
              null
          );
          if (!alive) return;
          setMonthlyIntroEligibility(introEligibility);
          logMissingIosMonthlyTrialDiagnostics({
            churchId: resolvedChurchId,
            monthlyProductId:
              packagesResult.monthly?.product.identifier ||
              packagesResult.assignedMonthlyProductId ||
              null,
            hasIntroOffer: monthlyPackageHasIntroOffer(packagesResult.monthly),
            introEligibility,
          });
        } catch {
          if (!alive) return;
          setMonthlyIntroEligibility(null);
          logMissingIosMonthlyTrialDiagnostics({
            churchId: resolvedChurchId,
            monthlyProductId: packagesResult.monthly?.product.identifier || null,
            hasIntroOffer: monthlyPackageHasIntroOffer(packagesResult.monthly),
            introEligibility: null,
          });
        }
      } catch (error: any) {
        if (!alive) return;
        const errorMessage = formatSubscriptionSetupError(error);
        console.log("KRISTO_REVENUECAT_OFFERINGS_UNAVAILABLE", {
          screen: "subscriptions",
          reviewBypass: isAppleReviewBypassEnabled(),
          error: errorMessage,
        });
        setSubscriptionPlanStatus("expired");
        setSubscriptionError(errorMessage);
      } finally {
        if (alive) {
          setPackagesLoading(false);
          suppressFocusServerRefreshRef.current = false;
        }
      }
    }

    boot();
    return () => {
      alive = false;
    };
  }, [sessionLoading, session, reloadToken, sessionRole, sessionUserId, setSession]);

  function retryLoadOfferings() {
    invalidateSubscriptionOfferingsCache();
    setSubscriptionError(null);
    setReloadToken((token) => token + 1);
  }

  async function refreshAfterCustomerInfoChange(info: CustomerInfo | null) {
    setCustomerInfo(info);

    if (!churchId) return;
    const server = await refreshMediaPremiumServerStatus(churchId, { bustCache: true });
    const serverActive = server?.serverSubscriptionActive === true;
    const hasPremium = hasPremiumEntitlement(info);
    if (serverActive && info) {
      const activePlan = resolveActiveSubscriptionPlan(info);
      if (activePlan) {
        setSubscriptionSelectedPlan(activePlan);
      }
      setSubscriptionPlanStatus(hasPremium ? "active" : "expired");
    } else {
      setSubscriptionPlanStatus("expired");
    }

    logChurchSubscriptionContext({
      screen: "subscriptions",
      churchId,
      customerInfo: info,
      churchSubscriptionActive: server?.serverSubscriptionActive,
      canUseMediaTools: server?.canUseMediaTools === true,
    });
    logRevenueCatSubscriptionOwnershipDebug(info, "subscriptions-refresh", { churchId });
  }

  async function maybeActivateChurchSubscription(
    resolvedPlan: SubscriptionPlanKey,
    opts: {
      activationSource: ChurchSubscriptionActivationSource;
      purchaseConfirmed?: boolean;
      initialCustomerInfo?: CustomerInfo | null;
    }
  ) {
    // Defense-in-depth: session pastor-role alone is not enough; server also requires
    // the singular canonical actual Pastor (isActualChurchPastor from media API).
    if (!isPastorSessionRole(sessionRole)) {
      return { activated: false, skipped: true as const, canUseMediaTools: false };
    }
    if (mediaPremiumStatus?.isActualChurchPastor === false) {
      console.log("KRISTO_SUBSCRIPTION_ACTIVATE_SKIPPED_NOT_CANONICAL_PASTOR", {
        churchId: String(churchId || "").trim() || null,
        sessionRole,
      });
      return { activated: false, skipped: true as const, canUseMediaTools: false };
    }

    const resolvedChurchId = String(
      churchId || (session as any)?.churchId || (session as any)?.activeChurchId || ""
    ).trim();
    if (!resolvedChurchId) {
      if (isAppleReviewBypassEnabled()) {
        return { activated: false, skipped: true as const, canUseMediaTools: false };
      }
      return { activated: false, skipped: false as const, canUseMediaTools: false };
    }

    if (isSubscriptionOwnershipLockBlockingActivation(mediaPremiumStatus?.subscriptionOwnershipLock)) {
      const lock = mediaPremiumStatus?.subscriptionOwnershipLock;
      console.log("KRISTO_SUBSCRIPTION_LOCK_BLOCKED_ACTIVATION", {
        churchId: resolvedChurchId,
        activationSource: opts.activationSource,
        lockedChurchId: lock?.lockedChurchId ?? null,
        lockedChurchName: lock?.lockedChurchName ?? null,
        expiresAt: lock?.expiresAt ?? null,
      });
      return {
        activated: false,
        skipped: false as const,
        entitlementActive: false,
        churchActivated: false,
        churchSubscriptionActive: false,
        canUseMediaTools: false,
        activationError: "This store subscription is locked to another church.",
      };
    }

    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId: resolvedChurchId,
    }) as Record<string, string>;

    const sync = await syncChurchSubscriptionAfterPurchase({
      churchId: resolvedChurchId,
      userId: sessionUserId,
      role: sessionRole,
      churchRole: String((session as any)?.churchRole || "").trim() || undefined,
      subscriptionPlan: resolvedPlan,
      headers,
      purchaseConfirmed: opts.purchaseConfirmed === true,
      activationSource: opts.activationSource,
      initialCustomerInfo: opts.initialCustomerInfo ?? null,
    });

    if (sync.storeOwnershipConflict) {
      setStoreConflictLock(sync.ownershipLock ?? null);
      setStoreConflictVariant("ownership_lock");
      setStoreConflictModalOpen(true);
    }

    if (sync.churchSubscriptionActive || sync.canUseMediaTools || sync.churchActivated) {
      await refreshMediaPremiumServerStatus(resolvedChurchId, { bustCache: true });
      setSubscriptionSelectedPlan(resolvedPlan);
      setSubscriptionPlanStatus("active");
    }

    return {
      activated: sync.churchActivated,
      skipped: false as const,
      canUseMediaTools: sync.canUseMediaTools,
      churchSubscriptionActive: sync.churchSubscriptionActive,
      featuresUnlocked: sync.featuresUnlocked === true,
      storeOwnershipConflict: sync.storeOwnershipConflict === true,
      activationError: sync.activationError || null,
    };
  }

  async function handleStoreConflictManageSubscription() {
    if (managingStoreConflict) return;
    setManagingStoreConflict(true);
    try {
      const manageResult = await openSubscriptionManagement(customerInfo, {
        allowGenericFallback: Platform.OS === "ios" || Platform.OS === "android",
        source: "subscription-store-conflict",
      });
      if (!manageResult.opened) {
        Alert.alert("Could not open subscriptions", resolveAppStoreManageFallbackMessage());
      }
    } catch (error: any) {
      Alert.alert(
        "Could not open subscriptions",
        String(error?.message || resolveAppStoreManageFallbackMessage())
      );
    } finally {
      setManagingStoreConflict(false);
    }
  }

  function openCheckoutFallback(plan: SubscriptionPlanKey) {
    if (Platform.OS === "ios" && plan === "yearly") {
      console.log("KRISTO_IOS_YEARLY_CHECKOUT_BLOCKED", { plan });
      return;
    }
    setSubscriptionSelectedPlan(plan);
    router.push({
      pathname: "/more/payments/checkout" as any,
      params: { plan },
    });
  }

  async function handleManageSubscription() {
    if (submittingPlan) return;

    const manageInfoRef = { current: customerInfo as CustomerInfo | null };

    const logManageDiag = (extra: Record<string, unknown> = {}) => {
      const info = manageInfoRef.current;
      const managementURL = String(info?.managementURL || "").trim();
      console.log("KRISTO_SUBSCRIPTION_MANAGE_DIAG", {
        platform: Platform.OS,
        hasCustomerInfo: !!info,
        managementURL: managementURL || null,
        activeEntitlementIds: getActiveEntitlementKeys(info),
        activeSubscriptionIds: [...(info?.activeSubscriptions || [])],
        resolvedPlan: info ? resolveActiveSubscriptionPlan(info) : null,
        subscriptionStatusSource: mediaPremiumStatus?.subscriptionSource ?? null,
        serverSubscriptionActive: mediaPremiumStatus?.serverSubscriptionActive === true,
        hasPlayPremiumOnDevice: hasActivePremiumProduct(info),
        ...extra,
      });
    };

    try {
      setSubmittingPlan("manage");

      if (!manageInfoRef.current) {
        try {
          manageInfoRef.current = await getCustomerSubscriptionInfo();
        } catch {
          manageInfoRef.current = null;
        }
      }

      const subscriptionStatusSource = mediaPremiumStatus?.subscriptionSource ?? null;

      if (subscriptionStatusSource === "offline_activation") {
        logManageDiag({ fallbackUsed: false, opened: false, gatedReason: "offline_activation" });
        Alert.alert(KRISTO_MANAGED_ACCESS_ALERT_TITLE, OFFLINE_ACTIVATION_MESSAGE);
        return;
      }

      if (
        subscriptionStatusSource === "backend_activation" ||
        subscriptionStatusSource === null
      ) {
        logManageDiag({
          fallbackUsed: false,
          opened: false,
          gatedReason: "backend_activation",
        });
        Alert.alert(KRISTO_MANAGED_ACCESS_ALERT_TITLE, BACKEND_MANAGED_PREMIUM_MESSAGE);
        return;
      }

      if (subscriptionStatusSource !== "app_store") {
        logManageDiag({
          fallbackUsed: false,
          opened: false,
          gatedReason: "non_app_store_source",
        });
        Alert.alert(KRISTO_MANAGED_ACCESS_ALERT_TITLE, BACKEND_MANAGED_PREMIUM_MESSAGE);
        return;
      }

      if (
        Platform.OS === "android" &&
        !canOpenAndroidPlaySubscriptionManagement(manageInfoRef.current)
      ) {
        logManageDiag({
          fallbackUsed: false,
          opened: false,
          gatedReason: "no_play_subscription_on_device",
        });
        Alert.alert(APP_STORE_MANAGE_ALERT_TITLE, resolveAppStoreManageFallbackMessage());
        return;
      }

      const manageResult = await openSubscriptionManagement(manageInfoRef.current, {
        allowGenericFallback: Platform.OS === "ios",
        source: "subscriptions",
      });
      logManageDiag({
        fallbackUsed: manageResult.fallbackUsed,
        opened: manageResult.opened,
        managePath: manageResult.path,
      });

      if (!manageResult.opened) {
        Alert.alert(APP_STORE_MANAGE_ALERT_TITLE, resolveAppStoreManageFallbackMessage());
        return;
      }

      const info = await getCustomerSubscriptionInfo();
      await refreshAfterCustomerInfoChange(info);
    } catch (error: any) {
      console.log("KRISTO_SUBSCRIPTION_MANAGE_FAILED", {
        message: String(error?.message || error || ""),
      });
      logManageDiag({ fallbackUsed: false, opened: false, error: String(error?.message || error || "") });
      Alert.alert("Could not open subscriptions", resolveAppStoreManageFallbackMessage());
    } finally {
      setSubmittingPlan(null);
    }
  }

  async function applyPrepurchaseOwnershipGate(
    prepurchase: SubscriptionPrepurchaseOwnershipResult
  ): Promise<"continue" | "handled"> {
    const action = await resolvePrepurchaseOwnershipGateUiAction({
      prepurchase,
      customerInfo,
    });

    if (action.type === "continue") {
      return "continue";
    }

    if (action.type === "modal") {
      setStoreConflictLock(action.ownershipLock);
      setStoreConflictVariant(action.variant);
      setStoreConflictModalOpen(true);
      return "handled";
    }

    setSubscriptionError(action.message);
    return "handled";
  }

  async function attemptExistingStoreSubscriptionRecovery(plan: SubscriptionPlanKey) {
    if (!churchId) return;

    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId,
    }) as Record<string, string>;

    const prepurchase = await runSubscriptionPrepurchaseOwnershipGate({
      churchId,
      headers,
    });
    if ((await applyPrepurchaseOwnershipGate(prepurchase)) === "handled") {
      return;
    }

    Alert.alert(EXISTING_STORE_SUBSCRIPTION_SYNC_TITLE, EXISTING_STORE_SUBSCRIPTION_SYNC_MESSAGE);

    const recovery = await recoverChurchSubscriptionFromExistingStore({
      churchId,
      userId: sessionUserId,
      role: sessionRole,
      churchRole: String((session as any)?.churchRole || "").trim() || undefined,
      headers,
      subscriptionPlan: plan,
    });

    if (recovery.customerInfo) {
      await refreshAfterCustomerInfoChange(recovery.customerInfo);
    }

    const { sync } = recovery;
    if (sync.storeOwnershipConflict) {
      setStoreConflictLock(sync.ownershipLock ?? null);
      setStoreConflictVariant("ownership_lock");
      setStoreConflictModalOpen(true);
      return;
    }
    if (
      sync.canUseMediaTools ||
      sync.churchSubscriptionActive ||
      sync.churchActivated ||
      sync.featuresUnlocked
    ) {
      const activePlan = sync.subscriptionPlan || plan;
      setSubscriptionSelectedPlan(activePlan);
      setSubscriptionPlanStatus("active");
      await refreshMediaPremiumServerStatus(churchId, { bustCache: true });
      Alert.alert(
        "Premium Active",
        "Your church subscription is active and Premium Media features are unlocked."
      );
      return;
    }

    if (recovery.churchScopedEntitlementActive || sync.entitlementActive) {
      Alert.alert(
        "Subscription not activated",
        String(
          sync.activationError ||
            "A store subscription was found, but the church could not be verified as Premium yet. No Premium features were unlocked."
        )
      );
      return;
    }

    Alert.alert(
      "Could not link subscription",
      "Apple reports an existing subscription, but it could not be linked to this church yet. Try again or manage subscriptions in Settings."
    );
  }

  async function refreshIosFiveSlotCards(resolvedChurchId: string) {
    const cid = String(resolvedChurchId || churchId || "").trim();
    if (!cid || Platform.OS !== "ios") return;
    const devicePurchaseScope = await getOrCreateDevicePurchaseScope();
    const sessionId =
      purchaseSessionId || (await getOrCreateIosPurchaseSessionId(cid));
    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId: cid,
    }) as Record<string, string>;
    const owned = [
      ...new Set([
        ...collectDeviceOwnedPremiumProductIds(customerInfo),
        ...sessionBlockedProductIds,
      ]),
    ];
    const cards = await buildIosFiveSlotCards({
      churchId: cid,
      headers,
      devicePurchaseScope,
      purchaseSessionId: sessionId,
      deviceOwnedProductIds: owned,
      currentChurchSubscribed: mediaPremiumStatus?.serverSubscriptionActive === true,
    });
    setIosSlotCards(cards);
    setIosAllSlotsOccupied(areAllIosPremiumSlotsOccupied(cards));
  }

  async function handleRestorePurchases() {
    if (restoringPurchases || submittingPlan || submittingProductId) return;
    if (!churchId) {
      Alert.alert("Church required", "Sign in with a church before restoring purchases.");
      return;
    }
    if (!isPastorSessionRole(sessionRole) || mediaPremiumStatus?.isActualChurchPastor === false) {
      Alert.alert(
        "Pastor only",
        "Only the church Pastor who manages this church can restore Church Subscription."
      );
      return;
    }

    setRestoringPurchases(true);
    try {
      const headers = getKristoHeaders({
        userId: sessionUserId,
        role: sessionRole as any,
        churchId,
      }) as Record<string, string>;

      // Restore only links a store subscription already mapped to THIS Church ID.
      // attemptExistingStoreSubscriptionRecovery runs prepurchase ownership + server bind.
      // Local UI state alone never transfers another church's subscription.
      await attemptExistingStoreSubscriptionRecovery("monthly");
      await refreshMediaPremiumServerStatus(churchId, { bustCache: true });
      if (Platform.OS === "ios") {
        await refreshIosFiveSlotCards(churchId);
      }
    } catch (error: any) {
      Alert.alert(
        "Restore failed",
        String(error?.message || "Could not restore purchases for this church.")
      );
    } finally {
      setRestoringPurchases(false);
    }
  }

  async function handlePurchaseIosSlot(productId: string) {
    if (submittingPlan || submittingProductId) return;
    const selectedProductId = String(productId || "").trim();
    if (!selectedProductId || !isIosPremiumPurchaseSlotProductId(selectedProductId)) return;

    if (!churchId) {
      openCheckoutFallback("monthly");
      return;
    }

    if (!isPastorSessionRole(sessionRole) || mediaPremiumStatus?.isActualChurchPastor === false) {
      Alert.alert(
        "Pastor only",
        "Only the church Pastor who manages this church can purchase Church Subscription."
      );
      return;
    }

    const selectedCard = iosSlotCards.find((card) => card.productId === selectedProductId);
    if (!selectedCard?.purchaseEnabled) {
      Alert.alert(
        "Slot unavailable",
        selectedCard?.statusLabel || "This monthly subscription slot is not available."
      );
      return;
    }

    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId,
    }) as Record<string, string>;

    const freshStatus = await fetchChurchMediaPremiumServerStatus(churchId, headers, {
      bustCache: true,
    });
    setMediaPremiumStatus(freshStatus);

    if (freshStatus.serverSubscriptionActive) {
      Alert.alert(
        "Already subscribed",
        "This Church ID already has an active subscription. Manage it from Current Plan."
      );
      setReloadToken((value) => value + 1);
      return;
    }

    if (shouldFailClosedSubscriptionPurchase({ status: freshStatus })) {
      setSubscriptionError("Subscription status is still loading. Try again in a moment.");
      return;
    }

    const ownershipLock = freshStatus.subscriptionOwnershipLock;
    if (isSubscriptionOwnershipLockBlockingPurchase(ownershipLock)) {
      if (ownershipLock?.message) setSubscriptionError(ownershipLock.message);
      return;
    }

    let localReservationId: string | null = null;

    try {
      const prepurchase = await runSubscriptionPrepurchaseOwnershipGate({
        churchId,
        headers,
      });
      if ((await applyPrepurchaseOwnershipGate(prepurchase)) === "handled") {
        return;
      }

      const devicePurchaseScope = await getOrCreateDevicePurchaseScope();
      const sessionId =
        purchaseSessionId || (await getOrCreateIosPurchaseSessionId(churchId));

      // Reserve the selected product for this Church ID before Apple's sheet.
      const assignment = await fetchChurchPurchaseProductAssignment({
        churchId,
        platform: "ios",
        headers,
        devicePurchaseScope,
        purchaseSessionId: sessionId,
        preferredProductId: selectedProductId,
        deviceOwnedProductIds: [
          ...new Set([
            ...collectDeviceOwnedPremiumProductIds(customerInfo),
            ...sessionBlockedProductIds,
          ]),
        ],
      });

      const reservedProductId = String(
        assignment?.productId || assignment?.monthlyProductId || ""
      ).trim();
      if (!assignment || reservedProductId !== selectedProductId) {
        Alert.alert(
          "Could not reserve slot",
          "That monthly subscription could not be reserved for this Church ID. Choose another available card."
        );
        await refreshIosFiveSlotCards(churchId);
        return;
      }

      localReservationId = String(assignment.reservationId || "").trim() || null;
      setAssignedMonthlyProductId(reservedProductId);
      setActiveReservationId(localReservationId);
      if (assignment.purchaseSessionId) setPurchaseSessionId(assignment.purchaseSessionId);

      const purchasePath = await resolveIosAssignedProductPurchasePath(reservedProductId);
      if (purchasePath.path === "unavailable") {
        if (localReservationId) {
          await releaseChurchPurchaseProductReservation({
            churchId,
            reservationId: localReservationId,
            headers,
          });
          setActiveReservationId(null);
        }
        setSubscriptionError(IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE);
        Alert.alert("Subscription unavailable", IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE);
        await refreshIosFiveSlotCards(churchId);
        return;
      }

      setSubmittingPlan("monthly");
      setSubmittingProductId(reservedProductId);

      const purchaseResult = await purchaseSubscriptionProductId(reservedProductId, {
        identityContext: {
          churchId,
          userId: sessionUserId,
          serverSubscriptionActive: freshStatus.serverSubscriptionActive,
        },
      });

      const info = purchaseResult.customerInfo;
      const activeBackendPlan = resolveActiveSubscriptionPlan(info) || "monthly";
      setSubscriptionSelectedPlan(activeBackendPlan);
      setSubscriptionPlanStatus("active");

      const activation = await maybeActivateChurchSubscription(activeBackendPlan, {
        activationSource: "purchase",
        purchaseConfirmed: true,
        initialCustomerInfo: info,
      });
      if (activation.storeOwnershipConflict) return;
      if (
        !activation.skipped &&
        !activation.activated &&
        !activation.churchSubscriptionActive &&
        !activation.canUseMediaTools
      ) {
        Alert.alert(
          "Subscription not activated",
          String(
            activation.activationError ||
              "Purchase succeeded, but the church could not be verified as Premium yet. No Premium features were unlocked."
          )
        );
        return;
      }

      await refreshAfterCustomerInfoChange(info);
      // Keep all five products visible; the purchased slot flips to "this church".
      await refreshIosFiveSlotCards(churchId);
      Alert.alert(
        "Premium Active",
        "Your church monthly subscription is now active. Premium Media features are unlocked."
      );
    } catch (error: any) {
      const detail = getRevenueCatPurchaseErrorDetail(error);
      const msg = String(detail.message || "");
      if (/cancel/i.test(msg) || detail.userCancelled) {
        if (localReservationId) {
          await releaseChurchPurchaseProductReservation({
            churchId,
            reservationId: localReservationId,
            headers,
          });
          setActiveReservationId(null);
        }
        Alert.alert("Purchase cancelled", "No charge was made.");
      } else if (isExistingStoreSubscriptionError(error)) {
        const failedProductId = selectedProductId;
        setSessionBlockedProductIds((prev) =>
          prev.includes(failedProductId) ? prev : [...prev, failedProductId]
        );
        if (localReservationId) {
          await releaseChurchPurchaseProductReservation({
            churchId,
            reservationId: localReservationId,
            headers,
          });
          setActiveReservationId(null);
        }
        await refreshIosFiveSlotCards(churchId);
        Alert.alert(
          "Slot already owned",
          "Apple reports this monthly product is already owned. Choose another available Church Subscription card."
        );
      } else {
        Alert.alert("Purchase failed", msg || "Could not complete subscription purchase.");
      }
    } finally {
      setSubmittingPlan(null);
      setSubmittingProductId(null);
    }
  }

  async function handlePurchasePlan(plan: SubscriptionPlanKey) {
    if (submittingPlan) return;

    // iOS: new purchases are monthly G2–G5 only — never start a yearly purchase.
    if (Platform.OS === "ios" && plan === "yearly") {
      console.log("KRISTO_IOS_YEARLY_PURCHASE_BLOCKED", { churchId, plan });
      return;
    }

    if (!churchId) {
      openCheckoutFallback(plan);
      return;
    }

    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId,
    }) as Record<string, string>;

    const freshStatus = await fetchChurchMediaPremiumServerStatus(churchId, headers, {
      bustCache: true,
    });
    setMediaPremiumStatus(freshStatus);

    if (shouldFailClosedSubscriptionPurchase({ status: freshStatus })) {
      setSubscriptionError("Subscription status is still loading. Try again in a moment.");
      return;
    }

    const ownershipLock = freshStatus.subscriptionOwnershipLock;
    if (isSubscriptionOwnershipLockBlockingPurchase(ownershipLock)) {
      console.log("KRISTO_SUBSCRIPTION_LOCK_BLOCKED_PURCHASE", {
        churchId,
        plan,
        lockedChurchId: ownershipLock?.lockedChurchId ?? null,
        lockedChurchName: ownershipLock?.lockedChurchName ?? null,
        expiresAt: ownershipLock?.expiresAt ?? null,
      });
      if (ownershipLock?.message) {
        setSubscriptionError(ownershipLock.message);
      }
      return;
    }

    const targetPackage = plan === "monthly" ? monthlyPackage : yearlyPackage;
    const assignedProductId = String(assignedMonthlyProductId || "").trim();
    const exactMonthlyPackage =
      plan === "monthly" && packageMatchesAssignedProductId(targetPackage, assignedProductId)
        ? targetPackage
        : plan === "monthly" && assignedProductId
          ? null
          : targetPackage;

    if (plan === "monthly" && !exactMonthlyPackage && !assignedProductId) {
      setSubscriptionError(resolveSubscriptionPackagesLoadingMessage());
      return;
    }
    if (plan === "yearly" && !targetPackage) {
      setSubscriptionError(resolveSubscriptionPackagesLoadingMessage());
      return;
    }

    if (!churchId) {
      openCheckoutFallback(plan);
      return;
    }

    const displayScreenState = resolveMediaPremiumDisplayScreenState(mediaPremiumStatus);
    const switchingFromMonthly = plan === "yearly" && displayScreenState === "monthly";
    const activeMonthlyProductId = String(
      getActivePremiumEntitlement(customerInfo)?.productIdentifier ||
        assignedMonthlyProductId ||
        ""
    ).trim();

    try {
      const prepurchase = await runSubscriptionPrepurchaseOwnershipGate({
        churchId,
        headers,
      });
      if ((await applyPrepurchaseOwnershipGate(prepurchase)) === "handled") {
        return;
      }

      if (Platform.OS === "ios" && plan === "monthly" && assignedProductId) {
        const purchasePath = await resolveIosAssignedProductPurchasePath(
          assignedProductId
        );
        if (purchasePath.path === "unavailable") {
          if (activeReservationId) {
            await releaseChurchPurchaseProductReservation({
              churchId,
              reservationId: activeReservationId,
              headers,
            });
            setActiveReservationId(null);
          }
          setSubscriptionError(IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE);
          Alert.alert("Subscription unavailable", IOS_ASSIGNED_PRODUCT_UNAVAILABLE_MESSAGE);
          return;
        }
      }

      setSubmittingPlan(plan);
      const purchaseResult =
        Platform.OS === "ios" && plan === "monthly" && assignedProductId
          ? await purchaseSubscriptionProductId(assignedProductId, {
              identityContext: {
                churchId,
                userId: sessionUserId,
                serverSubscriptionActive: freshStatus.serverSubscriptionActive,
              },
            })
          : plan === "monthly" && assignedProductId && !exactMonthlyPackage
            ? await purchaseSubscriptionProductId(assignedProductId, {
                identityContext: {
                  churchId,
                  userId: sessionUserId,
                  serverSubscriptionActive: freshStatus.serverSubscriptionActive,
                },
              })
            : await purchaseSubscriptionPackage(exactMonthlyPackage || targetPackage!, {
                upgradeFromProductId: switchingFromMonthly ? activeMonthlyProductId || null : null,
                identityContext: {
                  churchId,
                  userId: sessionUserId,
                  serverSubscriptionActive: freshStatus.serverSubscriptionActive,
                },
              });

      let info = purchaseResult.customerInfo;
      if (switchingFromMonthly) {
        const polled = await refreshCustomerInfoUntilYearlyActive(info);
        info = polled.info;
      }

      const activeBackendPlan = resolveActiveSubscriptionPlan(info);

      logEntitlementAudit({
        customerInfo: info,
        churchId,
        source: switchingFromMonthly ? "subscriptions-switch-yearly" : "subscriptions-purchase",
      });
      logRevenueCatSubscriptionOwnershipDebug(info, "subscriptions-after-purchase", {
        churchId,
        switchingFromMonthly,
        activeBackendPlan,
      });

      if (switchingFromMonthly) {
        if (activeBackendPlan === "yearly") {
          setSubscriptionSelectedPlan("yearly");
          setSubscriptionPlanStatus("active");
          const activation = await maybeActivateChurchSubscription("yearly", {
            activationSource: "purchase",
            purchaseConfirmed: true,
            initialCustomerInfo: info,
          });
          if (activation.storeOwnershipConflict) return;
          await refreshAfterCustomerInfoChange(info);
          Alert.alert("Yearly plan active", "Your church yearly subscription is now active.");
        } else {
          setSubscriptionSelectedPlan("monthly");
          setSubscriptionPlanStatus("active");
          logRevenueCatSubscriptionOwnershipDebug(info, "subscriptions-yearly-not-confirmed", {
            churchId,
            activeBackendPlan,
          });
          Alert.alert("Subscription upgrade", YEARLY_NOT_CONFIRMED_ALERT);
        }
        return;
      }

      if (activeBackendPlan) {
        setSubscriptionSelectedPlan(activeBackendPlan);
        setSubscriptionPlanStatus("active");
        const activation = await maybeActivateChurchSubscription(activeBackendPlan, {
          activationSource: "purchase",
          purchaseConfirmed: true,
          initialCustomerInfo: info,
        });
        if (activation.storeOwnershipConflict) return;
        if (
          !activation.skipped &&
          !activation.activated &&
          !activation.churchSubscriptionActive &&
          !activation.canUseMediaTools
        ) {
          Alert.alert(
            "Subscription not activated",
            String(
              activation.activationError ||
                "Purchase succeeded, but the church could not be verified as Premium yet. No Premium features were unlocked."
            )
          );
          return;
        }
        await refreshAfterCustomerInfoChange(info);
      } else if (plan === "monthly") {
        setSubscriptionPlanStatus("active");
        const activation = await maybeActivateChurchSubscription("monthly", {
          activationSource: "purchase",
          purchaseConfirmed: true,
          initialCustomerInfo: info,
        });
        if (activation.storeOwnershipConflict) return;
        if (
          !activation.skipped &&
          !activation.activated &&
          !activation.churchSubscriptionActive &&
          !activation.canUseMediaTools
        ) {
          Alert.alert(
            "Subscription not activated",
            String(
              activation.activationError ||
                "Purchase succeeded, but the church could not be verified as Premium yet. No Premium features were unlocked."
            )
          );
          return;
        }
        await refreshAfterCustomerInfoChange(info);
      }

      if (plan === "monthly") {
        Alert.alert(
          "Premium Active",
          "Your church monthly subscription is now active. Premium Media features are unlocked."
        );
      } else if (activeBackendPlan === "yearly") {
        Alert.alert(
          "Premium Active",
          "Your church yearly subscription is now active. Premium Media features are unlocked."
        );
      }
    } catch (error: any) {
      const detail = getRevenueCatPurchaseErrorDetail(error);
      const msg = String(detail.message || "");
      if (/cancel/i.test(msg) || detail.userCancelled) {
        Alert.alert("Purchase cancelled", "No charge was made.");
      } else if (isExistingStoreSubscriptionError(error)) {
        console.log("KRISTO_SUBSCRIPTION_ALREADY_OWNED", {
          plan,
          churchId,
          assignedProductId: assignedMonthlyProductId,
          reservationId: activeReservationId,
        });

        // iOS rotation: Apple already-subscribed on this group ≠ verified Apple ID.
        // Release the reservation, refresh owned products, ask for the next free slot.
        // Do NOT auto-retry purchase without user confirmation.
        if (Platform.OS === "ios" && plan === "monthly") {
          const failedProductId = String(
            assignedMonthlyProductId || targetPackage?.product.identifier || ""
          ).trim();
          const nextRecoveryCount = alreadyOwnedRecoveryCount + 1;
          if (nextRecoveryCount > IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS.length) {
            Alert.alert(
              "No free subscription group left",
              "We already tried every Kristo Premium monthly slot available for this purchase session. Manage subscriptions in Settings or wait for a period to end."
            );
            return;
          }
          setAlreadyOwnedRecoveryCount(nextRecoveryCount);

          if (activeReservationId) {
            await releaseChurchPurchaseProductReservation({
              churchId,
              reservationId: activeReservationId,
              headers,
            });
          }

          let refreshedInfo: CustomerInfo | null = customerInfo;
          try {
            refreshedInfo = await getCustomerSubscriptionInfo();
            setCustomerInfo(refreshedInfo);
          } catch {
            // keep prior customerInfo
          }

          const owned = new Set([
            ...collectDeviceOwnedPremiumProductIds(refreshedInfo),
            ...sessionBlockedProductIds,
          ]);
          if (failedProductId) owned.add(failedProductId);
          const nextSessionBlocked = [...owned].filter((id) =>
            (IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS as readonly string[]).includes(id)
          );
          setSessionBlockedProductIds(nextSessionBlocked);

          const devicePurchaseScope = await getOrCreateDevicePurchaseScope();
          const sessionId =
            purchaseSessionId || (await getOrCreateIosPurchaseSessionId(churchId));
          const nextAssignment = await fetchChurchPurchaseProductAssignment({
            churchId,
            platform: "ios",
            headers,
            devicePurchaseScope,
            purchaseSessionId: sessionId,
            deviceOwnedProductIds: [...owned],
          });

          if (nextAssignment?.productId) {
            setAssignedMonthlyProductId(nextAssignment.productId);
            setActiveReservationId(nextAssignment.reservationId || null);
            setPurchaseSessionId(nextAssignment.purchaseSessionId || sessionId);
            try {
              const offerings = await getSubscriptionOfferings({ force: true });
              setMonthlyPackage(
                resolveMonthlyPackage(offerings, nextAssignment.productId)
              );
            } catch {
              // offerings may lag; purchaseSubscriptionProductId can still resolve
            }

            const nextGroup = String(nextAssignment.group || "").toUpperCase() || "next";
            Alert.alert(
              "This subscription group is already active on Apple",
              `Apple reported that plan is already owned on this store account. We released it and reserved Kristo Premium ${nextGroup} (${nextAssignment.productId}) instead.\n\nTap Subscribe again when you are ready — we will not purchase automatically.`,
              [{ text: "OK" }]
            );
            return;
          }

          Alert.alert(
            "No free subscription group left",
            "This Apple ID / device already appears to own every Kristo Premium monthly slot we can assign. Manage subscriptions in Settings or wait for a period to end."
          );
          return;
        }

        const freshStatus = await fetchChurchMediaPremiumServerStatus(churchId, headers, {
          bustCache: true,
        }).catch(() => null);
        if (
          shouldSkipExistingStoreRecoveryForCancelledOverlap({
            customerInfo,
            ownershipLock: freshStatus?.subscriptionOwnershipLock ?? ownershipLock,
          })
        ) {
          console.log("KRISTO_SUBSCRIPTION_STORE_REFUSED_NEW_PURCHASE_UNTIL_EXPIRY", {
            churchId,
            plan,
            willRenew: getActivePremiumEntitlement(customerInfo)?.willRenew ?? null,
          });
          Alert.alert(
            "Store subscription still active",
            resolveStoreNewPurchaseBlockedUntilExpiryMessage({
              customerInfo,
              ownershipLock: freshStatus?.subscriptionOwnershipLock ?? ownershipLock,
            })
          );
          return;
        }
        try {
          await attemptExistingStoreSubscriptionRecovery(plan);
        } catch (recoverError: any) {
          logAndroidPurchaseError(recoverError, { plan, churchId, phase: "existing-store-recover" });
          console.log("KRISTO_SUBSCRIPTION_ALREADY_OWNED_RECOVER_FAILED", {
            plan,
            churchId,
            message: String(recoverError?.message || recoverError || ""),
          });
          Alert.alert(
            "Sync failed",
            String(recoverError?.message || "Could not sync your existing subscription with this church.")
          );
        }
      } else {
        logAndroidPurchaseError(error, { plan, churchId });
        console.log("KRISTO_SUBSCRIPTION_PURCHASE_FAILED", {
          plan,
          message: msg,
          code: detail.code,
          readableErrorCode: detail.readableErrorCode,
          underlyingErrorMessage: detail.underlyingErrorMessage,
        });
        Alert.alert("Purchase failed", msg || "Could not complete subscription purchase.");
      }
    } finally {
      setSubmittingPlan(null);
    }
  }

  const serverSubscriptionActive = mediaPremiumStatus?.serverSubscriptionActive === true;
  const displayedActive = serverSubscriptionActive;
  const isOfflineActivation = isOfflineActivationMediaPremiumStatus(mediaPremiumStatus);
  const isBackendManaged = isBackendManagedMediaPremiumStatus(mediaPremiumStatus);
  const isAppStoreSubscription =
    displayedActive && mediaPremiumStatus?.subscriptionSource === "app_store";
  const showManageSubscriptionAction = isAppStoreSubscription;
  const deviceCanOpenStoreManagement = isDeviceManageableAppStoreSubscription(customerInfo);
  const screenState = resolveMediaPremiumDisplayScreenState(mediaPremiumStatus);
  const ownershipLock = mediaPremiumStatus?.subscriptionOwnershipLock;
  const ownershipLockBlocksPurchase = isSubscriptionOwnershipLockBlockingPurchase(ownershipLock);
  const failClosedSubscriptionPurchase = shouldFailClosedSubscriptionPurchase({
    status: mediaPremiumStatus,
    packagesLoading,
  });
  const billing = resolveServerPremiumBillingDetails(mediaPremiumStatus);
  const expiryLabel = resolveMediaPremiumExpiryLabel(mediaPremiumStatus, customerInfo);
  /**
   * Subscribed iOS churches still list all five monthly IAPs (read-only) so Apple App
   * Review can inspect every product from this screen. Pastor/manager visibility only.
   */
  const showIosSubscribedCatalog =
    Platform.OS === "ios" &&
    screenState !== "none" &&
    iosSlotCards.length > 0 &&
    isPastorSessionRole(sessionRole) &&
    mediaPremiumStatus?.isActualChurchPastor !== false;
  const renewalLabel =
    isAppStoreSubscription && billing.renewalDate
      ? formatPremiumSubscriptionRenewalLabel(billing.renewalDate, { customerInfo })
      : null;

  useEffect(() => {
    if (!churchId || packagesLoading) return;

    const sessionSnapshot = getSessionSync() as any;
    const profile = sessionSnapshot?.mediaProfile;
    const sessionMediaProfileChurchId =
      String(profile?.churchId || profile?.churchID || "").trim() || null;
    const revenueCatEntitlementActive = hasPremiumEntitlement(customerInfo);
    const ignoredRevenueCatBecauseServerInactive =
      revenueCatEntitlementActive && !serverSubscriptionActive;
    const ignoredSessionMediaProfileBecauseWrongChurch = Boolean(
      sessionMediaProfileChurchId &&
        !churchIdsMatch(sessionMediaProfileChurchId, churchId) &&
        profile?.subscriptionActive === true
    );

    console.log("KRISTO_MEDIA_PREMIUM_SCREEN_STATUS", {
      churchId,
      displayedActive,
      subscriptionSource: mediaPremiumStatus?.subscriptionSource ?? null,
      isOfflineActivation,
      isBackendManaged,
      isAppStoreSubscription,
      showManageSubscriptionAction,
      deviceCanOpenStoreManagement,
      renewalLabel,
      expiryLabel,
      serverSubscriptionActive,
      source: mediaPremiumStatus?.source ?? "unknown",
      revenueCatEntitlementActive,
      ignoredRevenueCatBecauseServerInactive,
      sessionMediaProfileChurchId,
      ignoredSessionMediaProfileBecauseWrongChurch,
    });

    if (serverSubscriptionActive) {
      logSubscriptionOwnershipChainDiag({
        source: "subscriptions-screen-active",
        churchId,
        sessionUserId,
        mediaPremiumStatus,
        customerInfo,
      });
    }
  }, [
    churchId,
    sessionUserId,
    mediaPremiumStatus,
    customerInfo,
    packagesLoading,
    serverSubscriptionActive,
    displayedActive,
    isOfflineActivation,
    isBackendManaged,
    isAppStoreSubscription,
    showManageSubscriptionAction,
    deviceCanOpenStoreManagement,
    renewalLabel,
    expiryLabel,
  ]);

  const monthlyDisplayPrice = formatPrice(monthlyPackage || undefined, "$49.99");
  const yearlyDisplayPrice = formatPrice(yearlyPackage || undefined, "$499.99");
  const yearlySavings = resolveYearlySavingsDisplay(monthlyPackage, yearlyPackage);
  const tabBarClearance = 96;

  const churchSubscriptionActive = serverSubscriptionActive;
  // Prefer server assignment — never treat a non-matching package SKU as the assigned product.
  const assignedProductId = String(assignedMonthlyProductId || "").trim();
  const currentPlanProductId = String(
    assignedProductId ||
      getActivePremiumEntitlement(customerInfo)?.productIdentifier ||
      ""
  ).trim();
  const exactAssignedMonthlyPackage = packageMatchesAssignedProductId(
    monthlyPackage,
    assignedProductId
  )
    ? monthlyPackage
    : null;
  const monthlyTrialEligible = resolveMonthlyIntroTrialEligible(
    customerInfo,
    exactAssignedMonthlyPackage,
    monthlyIntroEligibility
  );
  const selectedProductHasOwnIntro = monthlyPackageHasIntroOffer(exactAssignedMonthlyPackage);
  // iOS: trial wording only for premium_monthly. G2–G5 never advertise a free trial.
  const iosAllowsTrialWording =
    Platform.OS !== "ios" ||
    (assignedProductId === PREMIUM_MONTHLY_PRODUCT_ID && selectedProductHasOwnIntro);
  const showMonthlyFreeTrial =
    !churchSubscriptionActive &&
    monthlyTrialEligible &&
    selectedProductHasOwnIntro &&
    iosAllowsTrialWording;
  const monthlyIntro = resolveMonthlyProductIntro(exactAssignedMonthlyPackage);
  const monthlyTrialDays = resolveIntroTrialDays(monthlyIntro) ?? 14;
  const monthlyTrialBadge = showMonthlyFreeTrial
    ? `${monthlyTrialDays}-DAY FREE TRIAL`
    : undefined;
  const monthlyPriceText = showMonthlyFreeTrial
    ? `${monthlyTrialDays} Days Free`
    : `${monthlyDisplayPrice}/month`;
  const monthlySubPriceText = showMonthlyFreeTrial
    ? `Then ${monthlyDisplayPrice}/month`
    : undefined;
  const monthlyCtaLabel = showMonthlyFreeTrial
    ? `Start ${monthlyTrialDays}-Day Free Trial`
    : "Subscribe Monthly";
  const monthlyPurchaseLoading = submittingPlan === "monthly";
  const yearlyPurchaseLoading = submittingPlan === "yearly";
  const revenueCatErrorCode = extractRevenueCatErrorCode(subscriptionError);
  const hasMonthlyPackage = Boolean(exactAssignedMonthlyPackage || (!assignedProductId && monthlyPackage));
  const hasOfferings =
    Platform.OS === "ios"
      ? Boolean(
          exactAssignedMonthlyPackage ||
            assignedMonthlyProductId ||
            iosSlotCards.length > 0 ||
            screenState !== "none"
        )
      : Boolean(monthlyPackage || yearlyPackage);
  const hasIntroOffer = selectedProductHasOwnIntro;

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (screenState !== "none") return;

    let reasonTrialHidden: string | null = null;
    if (!showMonthlyFreeTrial) {
      if (!hasMonthlyPackage) {
        reasonTrialHidden =
          revenueCatErrorCode != null
            ? `missing-package-offerings-error-${revenueCatErrorCode}`
            : "missing-package";
      } else if (isIosPremiumRotationMonthlyProductId(assignedProductId)) {
        // Policy: G2–G5 never advertise a free trial.
        reasonTrialHidden = "rotation-slot-no-trial-by-policy";
      } else if (!hasIntroOffer) {
        reasonTrialHidden = "missing-intro-offer";
      } else if (
        monthlyIntroEligibility ===
        INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE
      ) {
        reasonTrialHidden = "intro-eligibility-ineligible";
      } else if (
        monthlyIntroEligibility ===
        INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS
      ) {
        reasonTrialHidden = "intro-eligibility-no-offer";
      } else {
        reasonTrialHidden = "trial-not-eligible";
      }
    }

    console.log("KRISTO_IOS_TRIAL_UI_DECISION", {
      hasMonthlyPackage,
      hasOfferings,
      revenueCatErrorCode,
      introEligibilityStatus: monthlyIntroEligibility ?? "unknown",
      hasIntroOffer,
      ctaText: monthlyCtaLabel,
      reasonTrialHidden,
    });
  }, [
    screenState,
    hasMonthlyPackage,
    hasOfferings,
    revenueCatErrorCode,
    monthlyIntroEligibility,
    hasIntroOffer,
    monthlyCtaLabel,
    showMonthlyFreeTrial,
    assignedProductId,
  ]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!monthlyPackage) return;
    if (!monthlyPackageHasIntroOffer(monthlyPackage)) return;
    if (!showMonthlyFreeTrial) return;

    console.log("KRISTO_IOS_MONTHLY_TRIAL_ELIGIBLE", {
      productId: monthlyPackage.product.identifier || null,
      introEligibilityStatus: monthlyIntroEligibility ?? "unknown",
      trialDays: 14,
      postTrialPrice: `${monthlyDisplayPrice}/month`,
      ctaText: "Start 14-Day Free Trial",
    });
  }, [
    monthlyPackage,
    monthlyIntroEligibility,
    monthlyDisplayPrice,
    showMonthlyFreeTrial,
  ]);

  return (
    <View style={s.screen}>
      <LinearGradient
        colors={["#050814", "#0A1020", "#070B14"]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: insets.bottom + tabBarClearance,
        }}
      >
        <View style={s.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [s.backBtn, pressed ? s.pressed : null]}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={s.title}>Church Subscription</Text>
            <Text style={s.sub}>
              {isOfflineActivation || isBackendManaged
                ? "View your church subscription"
                : "Manage your church subscription"}
            </Text>
          </View>
        </View>

        {sessionLoading && !churchId ? (
          <View style={s.fallbackCard}>
            <ActivityIndicator color="rgba(196,171,114,0.72)" />
          </View>
        ) : (
          <View style={s.content}>
            {subscriptionError && hasOfferings ? (
              <View style={s.inlineErrorCard}>
                <Ionicons name="alert-circle-outline" size={18} color="rgba(196,171,114,0.72)" />
                <Text style={s.inlineErrorText}>{subscriptionError}</Text>
                <Pressable
                  onPress={retryLoadOfferings}
                  style={({ pressed }) => [s.inlineErrorBtn, pressed ? s.pressed : null]}
                >
                  <Text style={s.inlineErrorBtnText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            {ownershipLockBlocksPurchase && ownershipLock ? (
              <SubscriptionOwnershipLockCard lock={ownershipLock} />
            ) : null}

            {failClosedSubscriptionPurchase &&
            screenState === "none" &&
            !(ownershipLockBlocksPurchase && ownershipLock) ? (
              <View style={s.fallbackCard}>
                <ActivityIndicator color="rgba(196,171,114,0.72)" />
                <Text style={s.sectionSub}>Checking subscription status...</Text>
              </View>
            ) : null}

            {screenState === "offline" ? (
              <OfflineActivationSubscriptionCard expiryLabel={expiryLabel} />
            ) : null}

            {screenState === "monthly" && isBackendManaged ? (
              <BackendManagedPremiumNoteCard expiryLabel={expiryLabel} />
            ) : null}

            {screenState === "monthly" && !isBackendManaged ? (
              <>
                <CurrentPlanCard
                  icon="calendar-outline"
                  planName="Monthly Plan"
                  description={
                    Platform.OS === "ios" && currentPlanProductId
                      ? `Church Subscription · Slot ${iosPremiumSlotLabel(currentPlanProductId)} · ${currentPlanProductId}`
                      : "Media Premium for your church"
                  }
                  price={
                    Platform.OS === "ios"
                      ? formatStoreProductDisplayPrice(
                          iosSlotCards.find((card) => card.productId === currentPlanProductId)
                            ?.storeProduct
                        ) || monthlyDisplayPrice
                      : monthlyDisplayPrice
                  }
                  period="/month"
                  billing={billing}
                  customerInfo={customerInfo}
                  subscribedChurchId={
                    Platform.OS === "ios"
                      ? (() => {
                          const activeSlot = iosSlotCards.find(
                            (card) => card.productId === currentPlanProductId
                          );
                          if (!activeSlot) return churchId;
                          if (activeSlot.status === "purchased_for_this_church") {
                            return activeSlot.mappedChurchId || churchId;
                          }
                          return activeSlot.mappedChurchId;
                        })()
                      : churchId
                  }
                  successMessage="You have full access to Media Premium features."
                />
                {Platform.OS !== "ios" ? (
                  <YearlyUpsellCard
                    price={yearlyDisplayPrice}
                    period="/year"
                    savingsLabel={yearlySavings.percentLabel}
                    onSwitch={() => handlePurchasePlan("yearly")}
                    loading={submittingPlan === "yearly"}
                  />
                ) : null}
                {showManageSubscriptionAction ? (
                  <ManageSubscriptionCard
                    onPress={handleManageSubscription}
                    loading={submittingPlan === "manage"}
                  />
                ) : null}
              </>
            ) : null}

            {screenState === "yearly" && isBackendManaged ? (
              <BackendManagedPremiumNoteCard expiryLabel={expiryLabel} />
            ) : null}

            {screenState === "yearly" && !isBackendManaged ? (
              <>
                {Platform.OS !== "ios" ? (
                  <AvailablePlanCard
                    planName="Monthly Plan"
                    price={monthlyDisplayPrice}
                    period="/month"
                  />
                ) : null}
                <CurrentPlanCard
                  icon="diamond-outline"
                  planName="Yearly Plan"
                  description="Best value for churches"
                  price={yearlyDisplayPrice}
                  period="/year"
                  billing={billing}
                  customerInfo={customerInfo}
                  successMessage="You have full access to Media Premium features."
                />
                {showManageSubscriptionAction ? (
                  <ManageSubscriptionCard
                    onPress={handleManageSubscription}
                    loading={submittingPlan === "manage"}
                  />
                ) : null}
              </>
            ) : null}

            {/*
              App Review visibility: a subscribed Church ID still sees the full five-product
              catalog below Current Plan. Read-only — no purchase button for this Church ID.
            */}
            {showIosSubscribedCatalog ? (
              <IosChurchSubscriptionFiveSlotPaywall
                churchId={churchId}
                slots={iosSlotCards}
                mode="catalog"
                canPurchase={false}
                onPurchase={() => {}}
              />
            ) : null}

            {screenState === "none" && !failClosedSubscriptionPurchase && !ownershipLockBlocksPurchase ? (
              <>
                {Platform.OS === "ios" ? (
                  <IosChurchSubscriptionFiveSlotPaywall
                    churchId={churchId}
                    slots={iosSlotCards}
                    submittingProductId={submittingProductId}
                    allSlotsOccupied={iosAllSlotsOccupied}
                    canPurchase={
                      isPastorSessionRole(sessionRole) &&
                      mediaPremiumStatus?.isActualChurchPastor !== false
                    }
                    onPurchase={(productId) => {
                      void handlePurchaseIosSlot(productId);
                    }}
                    onRestore={() => {
                      void handleRestorePurchases();
                    }}
                    restoring={restoringPurchases}
                  />
                ) : (
                  <>
                    <Text style={s.sectionHeading}>Choose a plan</Text>
                    <Text style={s.sectionSub}>Premium ministries live access</Text>
                    <PlanOfferCard
                      icon="calendar-outline"
                      planName="Monthly Plan"
                      description="Flexible monthly billing"
                      price={monthlyPriceText}
                      period=""
                      subPrice={monthlySubPriceText}
                      trialBadge={monthlyTrialBadge}
                      ctaLabel={monthlyCtaLabel}
                      onPress={() => handlePurchasePlan("monthly")}
                      loading={monthlyPurchaseLoading}
                    />
                    <PlanOfferCard
                      icon="diamond-outline"
                      planName="Yearly Plan"
                      description="Best value for churches"
                      price={yearlyDisplayPrice}
                      period="/year"
                      savingsLabel={yearlySavings.percentLabel}
                      featurePills={YEARLY_FEATURES}
                      ctaLabel="Subscribe Yearly"
                      onPress={() => handlePurchasePlan("yearly")}
                      loading={yearlyPurchaseLoading}
                      goldGlow
                    />
                  </>
                )}
              </>
            ) : null}

            {showManageSubscriptionAction ? (
              <Text style={s.footer}>{resolveAppStoreBillingFooterText()}</Text>
            ) : null}

            <SubscriptionLegalDisclosure
              showAgreement={screenState === "none" || screenState === "monthly"}
            />
          </View>
        )}
      </ScrollView>

      <SubscriptionStoreConflictModal
        visible={storeConflictModalOpen}
        variant={storeConflictVariant}
        currentChurchId={churchId}
        lock={storeConflictLock}
        managing={managingStoreConflict}
        disabled={Boolean(submittingPlan)}
        onManageSubscription={() => {
          void handleStoreConflictManageSubscription();
        }}
        onNotNow={() => {
          if (managingStoreConflict) return;
          setStoreConflictModalOpen(false);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#070B14",
  },

  glowTopLeft: {
    position: "absolute",
    top: -90,
    left: -80,
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: "rgba(196, 171, 114, 0.05)",
  },

  glowBottomRight: {
    position: "absolute",
    right: -90,
    bottom: 60,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(72, 96, 140, 0.04)",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 20,
  },

  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.10)",
  },

  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },

  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.6,
    lineHeight: 30,
  },

  sub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.46)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  content: {
    paddingHorizontal: 20,
    gap: 14,
  },

  sectionHeading: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  sectionSub: {
    marginTop: -8,
    marginBottom: 2,
    color: "rgba(255,255,255,0.46)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  glassCardOuter: {
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  glassCardOuterGold: {
    shadowColor: "rgba(196,171,114,0.45)",
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },

  glassCardDimmed: {
    opacity: 0.76,
  },

  glassCard: {
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
    gap: 10,
  },

  glassCardCompact: {
    paddingVertical: 14,
    gap: 8,
  },

  glassCardHighlighted: {
    borderColor: "rgba(196,171,114,0.22)",
  },

  glassCardGold: {
    borderColor: "rgba(196,171,114,0.34)",
  },

  glassSheen: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  statusChip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },

  statusChipGold: {
    backgroundColor: "rgba(196,171,114,0.12)",
    borderColor: "rgba(196,171,114,0.28)",
  },

  statusChipGreen: {
    backgroundColor: "rgba(120,220,160,0.08)",
    borderColor: "rgba(120,220,160,0.22)",
  },

  statusChipText: {
    color: "rgba(196,171,114,0.98)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
  },

  statusChipTextGreen: {
    color: "rgba(120,220,160,0.98)",
  },

  yearlyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  currentPlanChipRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },

  subscribedChurchMeta: {
    marginTop: 4,
    marginBottom: 10,
    gap: 4,
  },
  subscribedChurchLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  subscribedChurchValue: {
    color: "rgba(232,208,150,0.95)",
    fontSize: 14,
    fontWeight: "900",
  },

  bestValueText: {
    color: "rgba(196,171,114,0.88)",
    fontSize: 12,
    fontWeight: "700",
  },

  planHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  planHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    minWidth: 0,
  },

  planHeaderRight: {
    alignItems: "flex-end",
    flexShrink: 0,
    maxWidth: "46%",
  },

  planPriceStack: {
    alignItems: "flex-end",
    gap: 4,
  },

  planSubPrice: {
    color: "rgba(232, 212, 168, 0.96)",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "right",
  },

  planHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },

  planIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196,171,114,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.18)",
  },

  planIconWrapMuted: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
  },

  planTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 22,
  },

  planTitleMuted: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },

  planDescription: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  planDescriptionMuted: {
    color: "rgba(255,255,255,0.38)",
    fontSize: 12,
    fontWeight: "600",
  },

  planPrice: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 24,
  },

  planPriceMuted: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },

  planPeriod: {
    marginTop: 2,
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    fontWeight: "700",
  },

  planPeriodMuted: {
    marginTop: 2,
    color: "rgba(255,255,255,0.34)",
    fontSize: 11,
    fontWeight: "700",
  },

  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingTop: 2,
  },

  metaRowText: {
    flex: 1,
    color: "rgba(255,255,255,0.56)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },

  successNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(120,220,160,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(120,220,160,0.14)",
  },

  successNoteText: {
    flex: 1,
    color: "rgba(210,240,220,0.92)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },

  featurePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(196,171,114,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.16)",
  },

  featurePillText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "700",
  },

  ctaOuter: {
    marginTop: 2,
    borderRadius: 14,
    overflow: "hidden",
  },

  ctaGradient: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },

  ctaDisabled: {
    opacity: 0.72,
  },

  ctaText: {
    color: "#1A1610",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.1,
  },

  iosMonthlyOuter: {
    position: "relative",
  },

  iosMonthlyAmbientCyan: {
    position: "absolute",
    top: 28,
    left: -10,
    width: 100,
    height: 100,
    borderRadius: 999,
    backgroundColor: "rgba(70,200,205,0.09)",
  },

  iosMonthlyAmbientViolet: {
    position: "absolute",
    right: -12,
    bottom: 48,
    width: 110,
    height: 110,
    borderRadius: 999,
    backgroundColor: "rgba(130,100,230,0.08)",
  },

  iosMonthlyShell: {
    borderRadius: 26,
    shadowColor: "rgba(196,160,90,0.65)",
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },

  iosMonthlyCard: {
    borderRadius: 26,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(214,190,130,0.42)",
    gap: 14,
  },

  iosMonthlyAtmosphereTop: {
    ...StyleSheet.absoluteFillObject,
  },

  iosMonthlyDiagonalSheen: {
    ...StyleSheet.absoluteFillObject,
  },

  iosMonthlyTopGloss: {
    position: "absolute",
    top: 0,
    left: 20,
    right: 20,
    height: 1.5,
    backgroundColor: "rgba(255,255,255,0.28)",
  },

  iosMonthlySheenBloom: {
    position: "absolute",
    top: -50,
    right: -20,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(232,208,150,0.08)",
  },

  iosMonthlyInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  iosMonthlyGoldEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(232,208,150,0.22)",
  },

  iosMonthlyStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },

  iosMonthlyStatusPill: {
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(214,190,130,0.38)",
    shadowColor: "rgba(120,210,210,0.45)",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },

  iosMonthlyStatusPillFill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
    backgroundColor: "rgba(12,18,30,0.55)",
  },

  iosMonthlyStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(130,230,220,0.95)",
  },

  iosMonthlyStatusCopy: {
    gap: 1,
    minWidth: 0,
  },

  iosMonthlyStatusEyebrow: {
    color: "rgba(232,208,150,0.95)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },

  iosMonthlyStatusSub: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: -0.1,
  },

  iosMonthlyTrialPill: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "rgba(196,171,114,0.16)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(232,208,150,0.45)",
    shadowColor: "rgba(220,180,90,0.55)",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },

  iosMonthlyTrialPillText: {
    color: "rgba(242,220,160,0.98)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  iosMonthlyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  iosMonthlyLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    minWidth: 0,
  },

  iosMonthlyIconTile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(240,220,160,0.55)",
    shadowColor: "rgba(220,180,90,0.7)",
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },

  iosMonthlyIconTileFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(24,20,14,0.55)",
  },

  iosMonthlyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },

  iosMonthlyTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.35,
    lineHeight: 22,
  },

  iosMonthlySubtitle: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  iosMonthlyHeaderDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: 6,
    backgroundColor: "rgba(232,208,150,0.28)",
  },

  iosMonthlyPriceTile: {
    flexShrink: 0,
    maxWidth: "38%",
    minWidth: 92,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "rgba(232,208,150,0.4)",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },

  iosMonthlyPriceTileFill: {
    paddingVertical: 8,
    paddingHorizontal: 9,
    alignItems: "flex-end",
    gap: 2,
    backgroundColor: "rgba(10,14,24,0.45)",
  },

  iosMonthlyPrice: {
    color: "#F6E6C0",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.55,
    lineHeight: 24,
    textAlign: "right",
    width: "100%",
  },

  iosMonthlyPeriod: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.15,
    lineHeight: 14,
    textAlign: "right",
  },

  iosMonthlyTrialPrice: {
    color: "#F6E6C0",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.3,
    lineHeight: 18,
    textAlign: "right",
    width: "100%",
  },

  iosMonthlyTrialThen: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
    textAlign: "right",
    width: "100%",
  },

  iosMonthlyBenefits: {
    gap: 8,
  },

  iosMonthlyBenefitCard: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },

  iosMonthlyBenefitCardFill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minWidth: 0,
  },

  iosMonthlyBenefitIndexCol: {
    width: 18,
    alignItems: "center",
    gap: 4,
  },

  iosMonthlyBenefitIndex: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },

  iosMonthlyBenefitDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
  },

  iosMonthlyBenefitConnector: {
    width: 1,
    height: 14,
    opacity: 0.35,
  },

  iosMonthlyBenefitIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  iosMonthlyBenefitIconFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  iosMonthlyBenefitCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },

  iosMonthlyBenefitTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },

  iosMonthlyBenefitTitle: {
    flex: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.96)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.2,
    lineHeight: 17,
  },

  iosMonthlyBenefitMicro: {
    flexShrink: 0,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
    opacity: 0.78,
  },

  iosMonthlyBenefitDesc: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },

  iosMonthlyCtaOuter: {
    marginTop: 2,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(246,230,192,0.5)",
    shadowColor: "rgba(220,180,90,0.75)",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  iosMonthlyCtaGradient: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    overflow: "hidden",
  },

  iosMonthlyCtaShine: {
    ...StyleSheet.absoluteFillObject,
  },

  iosMonthlyCtaTopHighlight: {
    position: "absolute",
    top: 0,
    left: 14,
    right: 14,
    height: 1.5,
    backgroundColor: "rgba(255,255,255,0.55)",
  },

  iosMonthlyCtaContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    maxWidth: "100%",
  },

  iosMonthlyCtaText: {
    color: "#1A1610",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.2,
    flexShrink: 1,
  },

  iosMonthlyCtaPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.982 }],
    shadowOpacity: 0.2,
  },

  iosMonthlyCtaDisabled: {
    opacity: 0.7,
    shadowOpacity: 0.12,
  },

  compactSecondaryCta: {
    minHeight: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },

  compactSecondaryCtaText: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 14,
    fontWeight: "800",
  },

  availableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  manageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  manageIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196,171,114,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.16)",
  },

  manageCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },

  manageTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },

  manageDescription: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  footer: {
    marginTop: 2,
    color: "rgba(255,255,255,0.32)",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
    textAlign: "center",
  },

  fallbackCard: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 10,
    alignItems: "center",
  },

  inlineErrorCard: {
    marginBottom: 14,
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.14)",
    gap: 8,
  },

  inlineErrorText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },

  inlineErrorBtn: {
    alignSelf: "flex-start",
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196,171,114,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.18)",
  },

  inlineErrorBtnText: {
    color: "rgba(196,171,114,0.92)",
    fontSize: 12,
    fontWeight: "700",
  },

  fallbackText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  fallbackBtn: {
    marginTop: 2,
    minHeight: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196,171,114,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.18)",
  },

  fallbackBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
  },
});
