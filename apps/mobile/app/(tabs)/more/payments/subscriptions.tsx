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
} from "react-native-purchases";
import {
  setPaymentsCurrentModule,
  setSubscriptionPlanStatus,
  setSubscriptionSelectedPlan,
  type SubscriptionPlanKey,
} from "../../../../src/store/paymentsStore";
import { SubscriptionLegalDisclosure } from "../../../../src/components/payments/SubscriptionLegalDisclosure";
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
  EXISTING_STORE_SUBSCRIPTION_SYNC_TITLE,
  EXISTING_STORE_SUBSCRIPTION_SYNC_MESSAGE,
} from "../../../../src/lib/payments/mobileSubscriptions";
import {
  IOS_PREMIUM_PURCHASE_SLOT_PRODUCT_IDS,
  PREMIUM_MONTHLY_PRODUCT_ID,
  isIosPremiumRotationMonthlyProductId,
} from "../../../../src/lib/payments/churchPremiumRevenueCat";
import {
  fetchChurchMediaPremiumServerStatus,
  fetchChurchPurchaseProductAssignment,
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

  return (
    <View style={s.iosMonthlyOuter}>
      <LinearGradient
        colors={[
          "rgba(214,190,130,0.16)",
          "rgba(255,255,255,0.05)",
          "rgba(12,16,28,0.94)",
          "rgba(8,11,20,0.98)",
        ]}
        locations={[0, 0.18, 0.55, 1]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={s.iosMonthlyCard}
      >
        <View pointerEvents="none" style={s.iosMonthlyTopGloss} />
        <View pointerEvents="none" style={s.iosMonthlySheen} />
        <View pointerEvents="none" style={s.iosMonthlyInnerBorder} />

        {trialBadge ? (
          <View style={s.iosMonthlyBadgeRow}>
            <StatusChip label={trialBadge} tone="green" />
          </View>
        ) : null}

        <View style={s.iosMonthlyTopRow}>
          <View style={s.iosMonthlyLeft}>
            <View style={s.iosMonthlyIconTile}>
              <LinearGradient
                colors={["rgba(232,212,168,0.22)", "rgba(196,171,114,0.08)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.iosMonthlyIconTileFill}
              >
                <Ionicons name="calendar-outline" size={20} color="rgba(232,212,168,0.98)" />
              </LinearGradient>
            </View>
            <View style={s.iosMonthlyCopy}>
              <Text style={s.iosMonthlyTitle} numberOfLines={1}>
                {planName}
              </Text>
              <Text style={s.iosMonthlySubtitle} numberOfLines={2}>
                {description}
              </Text>
            </View>
          </View>

          <View
            style={s.iosMonthlyPriceCol}
            accessible
            accessibilityLabel={priceAccessibilityLabel}
          >
            {showTrial ? (
              <>
                <Text
                  style={s.iosMonthlyTrialPrice}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {trialHeadline}
                </Text>
                <Text
                  style={s.iosMonthlyTrialThen}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  Then {displayPrice}
                </Text>
                <Text style={s.iosMonthlyPeriod} numberOfLines={1}>
                  per month
                </Text>
              </>
            ) : (
              <>
                <Text
                  style={s.iosMonthlyPrice}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {displayPrice}
                </Text>
                <Text style={s.iosMonthlyPeriod} numberOfLines={1}>
                  per month
                </Text>
              </>
            )}
          </View>
        </View>

        <Pressable
          onPress={onPress}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ disabled: !!loading, busy: !!loading }}
          style={({ pressed }) => [
            s.iosMonthlyCtaOuter,
            pressed ? s.iosMonthlyCtaPressed : null,
            loading ? s.ctaDisabled : null,
          ]}
        >
          <LinearGradient
            colors={["#F0E0B8", "#D4B878", "#B89858"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.iosMonthlyCtaGradient}
          >
            <View pointerEvents="none" style={s.iosMonthlyCtaTopHighlight} />
            {loading ? (
              <ActivityIndicator color="#1A1610" size="small" />
            ) : (
              <Text
                style={s.iosMonthlyCtaText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.88}
              >
                {ctaLabel}
              </Text>
            )}
          </LinearGradient>
        </Pressable>
      </LinearGradient>
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
      if (payload.backendSubscriptionActive !== true) return;
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

  async function loadSubscriptionPackages(
    resolvedChurchId: string,
    opts?: { forceOfferings?: boolean }
  ) {
    const { configured, customerInfo: configuredCustomerInfo } =
      await configureChurchMobileSubscriptions(resolvedChurchId, { syncPurchases: false });
    if (!configured) {
      throw new Error("RevenueCat is not configured yet.");
    }

    const devicePurchaseScope = await getOrCreateDevicePurchaseScope();
    const sessionId = await getOrCreateIosPurchaseSessionId(resolvedChurchId);
    setPurchaseSessionId(sessionId);

    const assignment = await fetchChurchPurchaseProductAssignment({
      churchId: resolvedChurchId,
      platform: Platform.OS === "android" ? "android" : "ios",
      devicePurchaseScope,
      purchaseSessionId: sessionId,
      deviceOwnedProductIds: [
        ...new Set([
          ...collectDeviceOwnedPremiumProductIds(configuredCustomerInfo),
          ...sessionBlockedProductIds,
        ]),
      ],
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
    const monthly = resolveMonthlyPackage(offerings, preferredMonthlyProductId || null);
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
    };
  }

  function refreshOfferingsSilently() {
    void (async () => {
      try {
        const devicePurchaseScope = await getOrCreateDevicePurchaseScope();
        const sessionId =
          purchaseSessionId ||
          (churchId ? await getOrCreateIosPurchaseSessionId(churchId) : null);
        const assignment = churchId
          ? await fetchChurchPurchaseProductAssignment({
              churchId,
              platform: Platform.OS === "android" ? "android" : "ios",
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
        const monthly = resolveMonthlyPackage(offerings, preferredMonthlyProductId || null);
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
    console.log("KRISTO_IOS_MONTHLY_TRIAL_NOT_CONFIGURED", {
      churchId: args.churchId,
      monthlyProductId: args.monthlyProductId,
      introEligibility: args.introEligibility ?? null,
      expectedTrial: "14-day free trial",
      expectedPostTrialPrice: "$49.99/month",
      action:
        "Configure an introductory free trial for the assigned church_premium_monthly_g2…g5 product in App Store Connect and attach it to a RevenueCat offering.",
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
        const [server, packagesResult] = await Promise.all([
          fetchChurchMediaPremiumServerStatus(resolvedChurchId, headers),
          loadSubscriptionPackages(resolvedChurchId, {
            forceOfferings: forceOfferingsReload,
          }).catch((error) => ({ error } as const)),
        ]);

        if (!alive) return;

        setMediaPremiumStatus(server);

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
        entitlementActive: false,
        churchActivated: false,
        churchSubscriptionActive: false,
        canUseMediaTools: false,
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

    if (sync.churchSubscriptionActive || sync.canUseMediaTools) {
      await refreshMediaPremiumServerStatus(resolvedChurchId, { bustCache: true });
    }

    return {
      activated: sync.churchActivated,
      skipped: false as const,
      canUseMediaTools: sync.canUseMediaTools,
      churchSubscriptionActive: sync.churchSubscriptionActive,
      storeOwnershipConflict: sync.storeOwnershipConflict === true,
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
    if (sync.canUseMediaTools || sync.churchSubscriptionActive) {
      const activePlan = sync.subscriptionPlan || plan;
      setSubscriptionSelectedPlan(activePlan);
      setSubscriptionPlanStatus("active");
      Alert.alert(
        "Subscription synced",
        "Your church subscription is active and media tools are unlocked."
      );
      return;
    }

    if (recovery.churchScopedEntitlementActive || sync.entitlementActive) {
      Alert.alert(
        "Sync in progress",
        "Subscription found on this device. Church sync is still completing — open Media again in a moment."
      );
      return;
    }

    Alert.alert(
      "Could not link subscription",
      "Apple reports an existing subscription, but it could not be linked to this church yet. Try again or manage subscriptions in Settings."
    );
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
    if (plan === "monthly" && !targetPackage && !assignedProductId) {
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

      setSubmittingPlan(plan);
      const purchaseResult =
        plan === "monthly" && assignedProductId && !targetPackage
          ? await purchaseSubscriptionProductId(assignedProductId, {
              identityContext: {
                churchId,
                userId: sessionUserId,
                serverSubscriptionActive: freshStatus.serverSubscriptionActive,
              },
            })
          : await purchaseSubscriptionPackage(targetPackage!, {
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
        await refreshAfterCustomerInfoChange(info);
      } else if (plan === "monthly") {
        setSubscriptionPlanStatus("active");
        const activation = await maybeActivateChurchSubscription("monthly", {
          activationSource: "purchase",
          purchaseConfirmed: true,
          initialCustomerInfo: info,
        });
        if (activation.storeOwnershipConflict) return;
        await refreshAfterCustomerInfoChange(info);
      }

      if (plan === "monthly") {
        Alert.alert("Monthly plan active", "Your church monthly subscription is now active.");
      } else if (activeBackendPlan === "yearly") {
        Alert.alert("Yearly plan active", "Your church yearly subscription is now active.");
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
  const assignedProductId = String(
    assignedMonthlyProductId || monthlyPackage?.product.identifier || ""
  ).trim();
  const monthlyTrialEligible = resolveMonthlyIntroTrialEligible(
    customerInfo,
    monthlyPackage,
    monthlyIntroEligibility
  );
  const selectedProductHasOwnIntro = monthlyPackageHasIntroOffer(monthlyPackage);
  // iOS: trial wording only for premium_monthly (when eligible), or G2–G5 when
  // that exact selected product has its own StoreKit/RC intro offer.
  const iosAllowsTrialWording =
    Platform.OS !== "ios" ||
    assignedProductId === PREMIUM_MONTHLY_PRODUCT_ID ||
    (isIosPremiumRotationMonthlyProductId(assignedProductId) && selectedProductHasOwnIntro);
  const showMonthlyFreeTrial =
    !churchSubscriptionActive &&
    monthlyTrialEligible &&
    selectedProductHasOwnIntro &&
    iosAllowsTrialWording;
  const monthlyIntro = resolveMonthlyProductIntro(monthlyPackage);
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
  const hasMonthlyPackage = Boolean(monthlyPackage);
  const hasOfferings =
    Platform.OS === "ios"
      ? Boolean(monthlyPackage || assignedMonthlyProductId)
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
            <Text style={s.title}>Media Premium</Text>
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
                  description="Media Premium for your church"
                  price={monthlyDisplayPrice}
                  period="/month"
                  billing={billing}
                  customerInfo={customerInfo}
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

            {screenState === "none" && !failClosedSubscriptionPurchase && !ownershipLockBlocksPurchase ? (
              <>
                <Text style={s.sectionHeading}>
                  {Platform.OS === "ios" ? "Start your free trial" : "Choose a plan"}
                </Text>
                <Text style={s.sectionSub}>
                  {Platform.OS === "ios"
                    ? "Unlock Media Premium for your church"
                    : "Premium ministries live access"}
                </Text>
                {Platform.OS === "ios" ? (
                  <IosMonthlyPlanOfferCard
                    planName="Monthly Plan"
                    description="Flexible monthly billing"
                    displayPrice={monthlyDisplayPrice}
                    showTrial={showMonthlyFreeTrial}
                    trialHeadline={
                      showMonthlyFreeTrial ? `${monthlyTrialDays} Days Free` : null
                    }
                    trialThenLabel={monthlySubPriceText}
                    trialBadge={monthlyTrialBadge}
                    ctaLabel={monthlyCtaLabel}
                    onPress={() => handlePurchasePlan("monthly")}
                    loading={monthlyPurchaseLoading}
                  />
                ) : (
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
                )}
                {Platform.OS !== "ios" ? (
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
                ) : null}
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
    borderRadius: 24,
    shadowColor: "rgba(196,171,114,0.55)",
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  iosMonthlyCard: {
    borderRadius: 24,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(214,190,130,0.34)",
    gap: 12,
  },

  iosMonthlyTopGloss: {
    position: "absolute",
    top: 0,
    left: 18,
    right: 18,
    height: 1.5,
    backgroundColor: "rgba(255,255,255,0.22)",
  },

  iosMonthlySheen: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "rgba(232,212,168,0.07)",
  },

  iosMonthlyInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  iosMonthlyBadgeRow: {
    marginBottom: -2,
  },

  iosMonthlyTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 2,
  },

  iosMonthlyLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    minWidth: 0,
  },

  iosMonthlyIconTile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(214,190,130,0.36)",
    shadowColor: "rgba(196,171,114,0.4)",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },

  iosMonthlyIconTileFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,22,34,0.55)",
  },

  iosMonthlyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    paddingTop: 2,
  },

  iosMonthlyTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 23,
  },

  iosMonthlySubtitle: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  iosMonthlyPriceCol: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    flexShrink: 0,
    maxWidth: "40%",
    minWidth: 96,
    paddingTop: 1,
    gap: 2,
  },

  iosMonthlyPrice: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.6,
    lineHeight: 26,
    textAlign: "right",
    width: "100%",
  },

  iosMonthlyPeriod: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.1,
    lineHeight: 15,
    textAlign: "right",
  },

  iosMonthlyTrialPrice: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.35,
    lineHeight: 20,
    textAlign: "right",
    width: "100%",
  },

  iosMonthlyTrialThen: {
    color: "rgba(232,212,168,0.95)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
    textAlign: "right",
    width: "100%",
  },

  iosMonthlyCtaOuter: {
    marginTop: 2,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(240,224,184,0.35)",
  },

  iosMonthlyCtaGradient: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    overflow: "hidden",
  },

  iosMonthlyCtaTopHighlight: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.45)",
  },

  iosMonthlyCtaText: {
    color: "#1A1610",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.2,
  },

  iosMonthlyCtaPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
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
