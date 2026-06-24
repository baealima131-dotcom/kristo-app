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
  type ScrollView as RNScrollView,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";
import {
  setPaymentsCurrentModule,
  setSubscriptionPlanStatus,
  setSubscriptionSelectedPlan,
  type SubscriptionPlanKey,
} from "../../../../src/store/paymentsStore";
import {
  PREMIUM_MONTHLY_PRODUCT_ID,
  configureChurchMobileSubscriptions,
  formatSubscriptionSetupError,
  getSubscriptionOfferings,
  getCustomerSubscriptionInfo,
  hasPremiumEntitlement,
  logEntitlementAudit,
  logInRevenueCatForChurchSubscription,
  logRevenueCatSubscriptionOwnershipDebug,
  purchaseSubscriptionPackage,
  refreshCustomerInfoUntilYearlyActive,
  resolveActiveSubscriptionPlan,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  describeCurrentOfferingPackages,
  setRevenueCatDebugRouteEnabled,
  resolveYearlySavingsDisplay,
  resolveMediaPremiumPlanUiState,
} from "../../../../src/lib/payments/mobileSubscriptions";
import {
  fetchChurchSubscriptionStatus,
  isPastorSessionRole,
  logChurchSubscriptionContext,
  syncChurchSubscriptionAfterPurchase,
} from "../../../../src/lib/churchSubscription";
import { recoverChurchIdFromMembership } from "../../../../src/lib/churchLockedRecovery";
import { getKristoHeaders } from "../../../../src/lib/kristoHeaders";
import { useKristoSession } from "../../../../src/lib/KristoSessionProvider";
import { isAppleReviewBypassEnabled } from "../../../../src/lib/subscriptionBypass";

const YEARLY_NOT_CONFIRMED_ALERT =
  "Apple may defer this plan change until your next renewal. Your monthly plan is still active. Manage the subscription in Apple Subscriptions if you need to complete the yearly upgrade.";

const LEGACY_PENDING_PLAN_SWITCH_PREFIX = "kristo_pending_plan_switch_v1";

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

type PlanCardProps = {
  planLabel: string;
  priceLine: string;
  statusLine?: string;
  statusTone?: "success" | "muted" | "accent";
  actionLabel?: string;
  onAction?: () => void;
  actionLoading?: boolean;
  dimmed?: boolean;
};

function PlanCard({
  planLabel,
  priceLine,
  statusLine,
  statusTone = "success",
  actionLabel,
  onAction,
  actionLoading,
  dimmed,
}: PlanCardProps) {
  const statusStyle =
    statusTone === "muted"
      ? s.statusMuted
      : statusTone === "accent"
        ? s.statusAccent
        : s.statusSuccess;

  return (
    <View style={[s.planCard, dimmed ? s.planCardDimmed : null]}>
      <Text style={s.planLabel}>{planLabel}</Text>
      <Text style={s.planPrice}>{priceLine}</Text>

      {statusLine ? (
        <View style={s.statusRow}>
          {statusTone === "success" ? (
            <Ionicons name="checkmark" size={16} color="rgba(120,220,160,0.95)" />
          ) : null}
          <Text style={statusStyle}>{statusLine}</Text>
        </View>
      ) : null}

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          disabled={actionLoading}
          style={({ pressed }) => [
            s.planActionBtn,
            s.planActionBtnPrimary,
            pressed ? s.pressed : null,
            actionLoading ? s.planActionBtnDisabled : null,
          ]}
        >
          {actionLoading ? (
            <ActivityIndicator color="#1A1610" size="small" />
          ) : (
            <Text style={s.planActionBtnText}>{actionLabel}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export default function PaymentsSubscriptionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading: sessionLoading, setSession } = useKristoSession();

  const [churchId, setChurchId] = useState("");
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [yearlyPackage, setYearlyPackage] = useState<PurchasesPackage | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offersLoading, setOffersLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [submittingPlan, setSubmittingPlan] = useState<SubscriptionPlanKey | null>(null);
  const scrollRef = useRef<RNScrollView | null>(null);

  const sessionUserId = String((session as any)?.userId || "").trim();
  const sessionRole = String(
    (session as any)?.role || (session as any)?.churchRole || ""
  ).trim();

  useEffect(() => {
    setPaymentsCurrentModule("subscriptions");
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      setRevenueCatDebugRouteEnabled(true);
      return () => setRevenueCatDebugRouteEnabled(false);
    }, [])
  );

  useEffect(() => {
    let alive = true;

    async function boot() {
      if (sessionLoading) return;

      setOffersLoading(true);
      setSubscriptionError(null);

      try {
        let resolvedChurchId = String((session as any)?.churchId || "").trim();
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

        const configured = await configureChurchMobileSubscriptions(resolvedChurchId);
        if (!configured) {
          throw new Error("RevenueCat is not configured yet.");
        }

        const [offerings, server, infoResult] = await Promise.all([
          getSubscriptionOfferings(),
          fetchChurchSubscriptionStatus(headers),
          getCustomerSubscriptionInfo().catch(() => null),
        ]);

        const monthly = resolveMonthlyPackage(offerings);
        const yearly = resolveYearlyPackage(offerings);

        console.log(
          "RevenueCat offerings packages:\n" + describeCurrentOfferingPackages(offerings)
        );

        if (!alive) return;

        await clearLegacyPendingPlanSwitchStorage(resolvedChurchId);

        setChurchId(resolvedChurchId);
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);
        setCustomerInfo(infoResult);

        const hasPremium = hasPremiumEntitlement(infoResult);
        if (infoResult) {
          const activePlan = resolveActiveSubscriptionPlan(infoResult);
          if (activePlan) {
            setSubscriptionSelectedPlan(activePlan);
          }
        }
        setSubscriptionPlanStatus(hasPremium ? "active" : "expired");

        logChurchSubscriptionContext({
          screen: "subscriptions",
          churchId: resolvedChurchId,
          customerInfo: infoResult,
          churchSubscriptionActive: server.subscriptionActive ?? undefined,
          canUseMediaTools: server.canUseMediaTools ?? undefined,
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
          setSubscriptionError(
            "App Store packages are still loading. Tap retry in a moment."
          );
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
        if (alive) setOffersLoading(false);
      }
    }

    boot();
    return () => {
      alive = false;
    };
  }, [sessionLoading, session, reloadToken, sessionRole, sessionUserId, setSession]);

  function retryLoadOfferings() {
    setReloadToken((token) => token + 1);
  }

  async function refreshAfterCustomerInfoChange(info: CustomerInfo | null) {
    setCustomerInfo(info);
    const hasPremium = hasPremiumEntitlement(info);
    if (info) {
      const activePlan = resolveActiveSubscriptionPlan(info);
      if (activePlan) {
        setSubscriptionSelectedPlan(activePlan);
      }
    }
    setSubscriptionPlanStatus(hasPremium ? "active" : "expired");

    if (!churchId) return;
    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId,
    }) as Record<string, string>;
    const server = await fetchChurchSubscriptionStatus(headers);
    logChurchSubscriptionContext({
      screen: "subscriptions",
      churchId,
      customerInfo: info,
      churchSubscriptionActive: server.subscriptionActive ?? undefined,
      canUseMediaTools: server.canUseMediaTools ?? undefined,
    });
    logRevenueCatSubscriptionOwnershipDebug(info, "subscriptions-refresh", { churchId });
  }

  async function maybeActivateChurchSubscription(
    resolvedPlan: SubscriptionPlanKey,
    initialCustomerInfo?: CustomerInfo | null
  ) {
    if (!isPastorSessionRole(sessionRole)) {
      return { activated: false, skipped: true as const, canUseMediaTools: false };
    }

    let resolvedChurchId = churchId || String((session as any)?.churchId || "").trim();
    if (!resolvedChurchId) {
      const recovered = await recoverChurchIdFromMembership(session, setSession);
      resolvedChurchId = recovered.churchId;
    }

    if (!resolvedChurchId) {
      if (isAppleReviewBypassEnabled()) {
        return { activated: false, skipped: true as const, canUseMediaTools: false };
      }
      return { activated: false, skipped: false as const, canUseMediaTools: false };
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
      purchaseConfirmed: true,
      initialCustomerInfo: initialCustomerInfo ?? null,
    });

    return {
      activated: sync.churchActivated,
      skipped: false as const,
      canUseMediaTools: sync.canUseMediaTools,
      churchSubscriptionActive: sync.churchSubscriptionActive,
    };
  }

  function openCheckoutFallback(plan: SubscriptionPlanKey) {
    setSubscriptionSelectedPlan(plan);
    router.push({
      pathname: "/more/payments/checkout" as any,
      params: { plan },
    });
  }

  async function handlePurchasePlan(plan: SubscriptionPlanKey) {
    if (submittingPlan) return;

    const targetPackage = plan === "monthly" ? monthlyPackage : yearlyPackage;
    if (!targetPackage) {
      setSubscriptionError("Plans are still loading. Tap retry, then try again.");
      return;
    }

    if (!churchId) {
      openCheckoutFallback(plan);
      return;
    }

    const switchingFromMonthly =
      plan === "yearly" && customerInfo && resolveActiveSubscriptionPlan(customerInfo) === "monthly";

    try {
      setSubmittingPlan(plan);
      await logInRevenueCatForChurchSubscription(churchId);

      const purchaseResult = await purchaseSubscriptionPackage(targetPackage, {
        upgradeFromProductId: switchingFromMonthly ? PREMIUM_MONTHLY_PRODUCT_ID : null,
      });

      let info = purchaseResult.customerInfo;
      if (switchingFromMonthly) {
        const polled = await refreshCustomerInfoUntilYearlyActive(info);
        info = polled.info;
      }

      await refreshAfterCustomerInfoChange(info);

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
          await maybeActivateChurchSubscription("yearly", info);
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
        await maybeActivateChurchSubscription(activeBackendPlan, info);
      } else if (plan === "monthly") {
        setSubscriptionPlanStatus("active");
      }

      if (plan === "monthly") {
        Alert.alert("Monthly plan active", "Your church monthly subscription is now active.");
      } else if (activeBackendPlan === "yearly") {
        Alert.alert("Yearly plan active", "Your church yearly subscription is now active.");
      }
    } catch (error: any) {
      const msg = String(error?.message || "");
      if (/cancel/i.test(msg)) {
        Alert.alert("Purchase cancelled", "No charge was made.");
      } else {
        console.log("KRISTO_SUBSCRIPTION_PURCHASE_FAILED", {
          plan,
          message: msg,
        });
        Alert.alert("Purchase failed", msg || "Could not complete subscription purchase.");
      }
    } finally {
      setSubmittingPlan(null);
    }
  }

  const planUi = resolveMediaPremiumPlanUiState(customerInfo);
  const hasPremium = planUi.hasPremium;

  const monthlyDisplayPrice = formatPrice(monthlyPackage || undefined, "$49.99");
  const yearlyDisplayPrice = formatPrice(yearlyPackage || undefined, "$499.99");
  const yearlySavings = resolveYearlySavingsDisplay(monthlyPackage, yearlyPackage);

  const monthlyPriceLine = `${monthlyDisplayPrice}/month`;
  const yearlyPriceLine = `${yearlyDisplayPrice}/year`;

  let monthlyStatusLine: string | undefined;
  let monthlyStatusTone: PlanCardProps["statusTone"] = "success";
  let monthlyActionLabel: string | undefined;
  let monthlyOnAction: (() => void) | undefined;
  let monthlyDimmed = false;

  let yearlyStatusLine: string | undefined;
  let yearlyStatusTone: PlanCardProps["statusTone"] = "accent";
  let yearlyActionLabel: string | undefined;
  let yearlyOnAction: (() => void) | undefined;

  if (!hasPremium) {
    monthlyActionLabel = "Subscribe";
    monthlyOnAction = () => handlePurchasePlan("monthly");
    yearlyStatusLine = yearlySavings.percentLabel;
    yearlyActionLabel = "Subscribe";
    yearlyOnAction = () => handlePurchasePlan("yearly");
  } else if (planUi.activeMonthly) {
    monthlyStatusLine = "Current Plan";
    yearlyStatusLine = yearlySavings.percentLabel;
    yearlyActionLabel = "Switch to Yearly";
    yearlyOnAction = () => handlePurchasePlan("yearly");
  } else if (planUi.activeYearly) {
    monthlyStatusLine = "Available";
    monthlyStatusTone = "muted";
    monthlyDimmed = true;
    yearlyStatusLine = "Current Plan";
    yearlyStatusTone = "success";
  }

  return (
    <View style={s.screen}>
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 18,
          paddingBottom: insets.bottom + 40,
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
            <Text style={s.sub}>Manage your church subscription</Text>
          </View>
        </View>

        {offersLoading ? (
          <View style={s.fallbackCard}>
            <ActivityIndicator color="rgba(196,171,114,0.72)" />
            <Text style={s.fallbackText}>Loading...</Text>
          </View>
        ) : subscriptionError ? (
          <View style={s.fallbackCard}>
            <Ionicons name="alert-circle-outline" size={22} color="rgba(196,171,114,0.72)" />
            <Text style={s.fallbackText}>{subscriptionError}</Text>
            <Pressable
              onPress={retryLoadOfferings}
              style={({ pressed }) => [s.fallbackBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.fallbackBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.content}>
            <PlanCard
              planLabel="MONTHLY PLAN"
              priceLine={monthlyPriceLine}
              statusLine={monthlyStatusLine}
              statusTone={monthlyStatusTone}
              actionLabel={monthlyActionLabel}
              onAction={monthlyOnAction}
              actionLoading={submittingPlan === "monthly"}
              dimmed={monthlyDimmed}
            />

            <PlanCard
              planLabel="YEARLY PLAN"
              priceLine={yearlyPriceLine}
              statusLine={yearlyStatusLine}
              statusTone={yearlyStatusTone}
              actionLabel={yearlyActionLabel}
              onAction={yearlyOnAction}
              actionLoading={submittingPlan === "yearly"}
            />

            <Text style={s.footer}>Billing is managed by your app store.</Text>
          </View>
        )}
      </ScrollView>
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
    top: -110,
    left: -110,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(196, 171, 114, 0.05)",
  },

  glowBottomRight: {
    position: "absolute",
    right: -110,
    bottom: 120,
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: "rgba(72, 96, 140, 0.04)",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    marginBottom: 28,
  },

  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.10)",
  },

  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },

  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.6,
    lineHeight: 32,
  },

  sub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.42)",
    fontSize: 13,
    fontWeight: "600",
  },

  content: {
    paddingHorizontal: 20,
    gap: 20,
  },

  planCard: {
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 10,
  },

  planCardDimmed: {
    opacity: 0.72,
  },

  planLabel: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },

  planPrice: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    lineHeight: 34,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },

  statusSuccess: {
    color: "rgba(120,220,160,0.95)",
    fontSize: 15,
    fontWeight: "800",
  },

  statusMuted: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 15,
    fontWeight: "700",
  },

  statusAccent: {
    color: "rgba(196,171,114,0.95)",
    fontSize: 15,
    fontWeight: "800",
  },

  planActionBtn: {
    marginTop: 14,
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  planActionBtnPrimary: {
    backgroundColor: "rgba(196, 171, 114, 0.92)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(210, 188, 138, 0.30)",
  },

  planActionBtnDisabled: {
    opacity: 0.7,
  },

  planActionBtnText: {
    color: "#1A1610",
    fontSize: 16,
    fontWeight: "900",
  },

  footer: {
    marginTop: 8,
    color: "rgba(255,255,255,0.36)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center",
  },

  fallbackCard: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },

  fallbackText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },

  fallbackBtn: {
    marginTop: 4,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196,171,114,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.22)",
  },

  fallbackBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
});
