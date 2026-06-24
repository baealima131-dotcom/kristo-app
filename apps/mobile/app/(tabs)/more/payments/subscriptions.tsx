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
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";
import {
  getPaymentsState,
  setPaymentsCurrentModule,
  setSubscriptionPlanStatus,
  setSubscriptionSelectedPlan,
  subscribePayments,
  type SubscriptionPlanKey,
} from "../../../../src/store/paymentsStore";
import {
  configureChurchMobileSubscriptions,
  formatSubscriptionSetupError,
  getSubscriptionOfferings,
  getCustomerSubscriptionInfo,
  getEffectiveSubscriptionState,
  hasPremiumEntitlement,
  logEntitlementAudit,
  openSubscriptionManagement,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  describeCurrentOfferingPackages,
  setRevenueCatDebugRouteEnabled,
  resolvePremiumPlanFromCustomerInfo,
  resolveYearlySavingsDisplay,
} from "../../../../src/lib/payments/mobileSubscriptions";
import {
  fetchChurchSubscriptionStatus,
  logChurchSubscriptionContext,
  type ChurchSubscriptionServerStatus,
} from "../../../../src/lib/churchSubscription";
import { recoverChurchIdFromMembership } from "../../../../src/lib/churchLockedRecovery";
import { getKristoHeaders } from "../../../../src/lib/kristoHeaders";
import { useKristoSession } from "../../../../src/lib/KristoSessionProvider";
import { isAppleReviewBypassEnabled } from "../../../../src/lib/subscriptionBypass";

function formatPrice(pkg?: PurchasesPackage, fallback?: string) {
  return pkg?.product.priceString || fallback || "";
}

export default function PaymentsSubscriptionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading: sessionLoading, setSession } = useKristoSession();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());
  const [churchId, setChurchId] = useState("");
  const [serverStatus, setServerStatus] = useState<ChurchSubscriptionServerStatus>({
    subscriptionActive: false,
    canUseMediaTools: false,
    subscriptionPlan: null,
  });
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [yearlyPackage, setYearlyPackage] = useState<PurchasesPackage | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offersLoading, setOffersLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const scrollRef = useRef<RNScrollView | null>(null);

  const sessionUserId = String((session as any)?.userId || "").trim();
  const sessionRole = String(
    (session as any)?.role || (session as any)?.churchRole || ""
  ).trim();

  useEffect(() => {
    setPaymentsCurrentModule("subscriptions");
    return subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });
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

        setChurchId(resolvedChurchId);
        setServerStatus(server);
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);
        setCustomerInfo(infoResult);

        const hasPremium = hasPremiumEntitlement(infoResult);
        if (infoResult) {
          const effective = getEffectiveSubscriptionState(infoResult);
          setSubscriptionSelectedPlan(effective.selectedPlan);
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
      const effective = getEffectiveSubscriptionState(info);
      setSubscriptionSelectedPlan(effective.selectedPlan);
    }
    setSubscriptionPlanStatus(hasPremium ? "active" : "expired");

    if (!churchId) return;
    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId,
    }) as Record<string, string>;
    const server = await fetchChurchSubscriptionStatus(headers);
    setServerStatus(server);
    logChurchSubscriptionContext({
      screen: "subscriptions",
      churchId,
      customerInfo: info,
      churchSubscriptionActive: server.subscriptionActive ?? undefined,
      canUseMediaTools: server.canUseMediaTools ?? undefined,
    });
  }

  async function handleManageSubscription() {
    try {
      const opened = await openSubscriptionManagement(customerInfo);
      if (!opened) {
        Alert.alert(
          "Manage subscription",
          Platform.OS === "android"
            ? "Open Google Play → Payments & subscriptions → Subscriptions to manage or cancel your plan."
            : "Open Settings → Apple ID → Subscriptions to manage or cancel your plan."
        );
        return;
      }

      const info = await getCustomerSubscriptionInfo();
      await refreshAfterCustomerInfoChange(info);
    } catch (error: any) {
      console.log("KRISTO_SUBSCRIPTION_MANAGE_FAILED", {
        message: String(error?.message || error || ""),
      });
      Alert.alert(
        "Could not open subscriptions",
        Platform.OS === "android"
          ? "Try Google Play → Payments & subscriptions → Subscriptions."
          : "Try Settings → Apple ID → Subscriptions."
      );
    }
  }

  const currentPlan = paymentsState.subscriptions.selectedPlan;
  const hasPremium = hasPremiumEntitlement(customerInfo);
  const churchSubscriptionActive =
    serverStatus.subscriptionActive || hasPremium;
  const showActivePrimaryScreen = churchSubscriptionActive;

  const activePlanKey: SubscriptionPlanKey = (() => {
    const activeProducts = [
      ...(customerInfo?.activeSubscriptions || []),
      ...(customerInfo?.allPurchasedProductIdentifiers || []),
    ].map((id) => String(id || "").toLowerCase());

    if (activeProducts.some((id) => /premium_yearly|yearly|annual|\\$rc_annual/.test(id))) {
      return "yearly";
    }

    if (activeProducts.some((id) => /premium_monthly|monthly|\\$rc_monthly/.test(id))) {
      return "monthly";
    }

    const fromRc = resolvePremiumPlanFromCustomerInfo(customerInfo);
    if (fromRc) return fromRc;

    const fromServer = String(serverStatus.subscriptionPlan || "").trim().toLowerCase();
    if (fromServer === "yearly" || fromServer === "monthly") return fromServer;

    return currentPlan;
  })();

  console.log("KRISTO_SUBSCRIPTION_UI_PLAN_RESOLVED", {
    revenueCatPlan: resolvePremiumPlanFromCustomerInfo(customerInfo),
    activeSubscriptions: customerInfo?.activeSubscriptions || [],
    allPurchasedProductIdentifiers: customerInfo?.allPurchasedProductIdentifiers || [],
    backendPlan: serverStatus.subscriptionPlan,
    displayedPlan: activePlanKey,
  });
  const isYearlyPlan = activePlanKey === "yearly";
  const isMonthlyPlan = activePlanKey === "monthly";
  const monthlyDisplayPrice = formatPrice(monthlyPackage || undefined, "$49.99");
  const yearlyDisplayPrice = formatPrice(yearlyPackage || undefined, "$499.99");
  const yearlySavings = resolveYearlySavingsDisplay(monthlyPackage, yearlyPackage);

  function openCheckout(plan: SubscriptionPlanKey) {
    const planPackage = plan === "monthly" ? monthlyPackage : yearlyPackage;
    if (!planPackage) {
      setSubscriptionError("Plans are still loading. Tap retry, then try again.");
      return;
    }
    setSubscriptionSelectedPlan(plan);
    router.push({
      pathname: "/more/payments/checkout" as any,
      params: { plan },
    });
  }

  function handleUpgradeToYearly() {
    openCheckout("yearly");
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
          paddingBottom: insets.bottom + 120,
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
              {showActivePrimaryScreen
                ? "Church subscription active"
                : "Subscribe this church"}
            </Text>
          </View>
        </View>

        {offersLoading ? (
          <View style={s.reviewFallbackCard}>
            <ActivityIndicator color="rgba(196,171,114,0.72)" />
            <Text style={s.reviewFallbackText}>Loading...</Text>
          </View>
        ) : subscriptionError ? (
          <View style={s.reviewFallbackCard}>
            <Ionicons name="alert-circle-outline" size={22} color="rgba(196,171,114,0.72)" />
            <Text style={s.reviewFallbackText}>{subscriptionError}</Text>
            <Pressable
              onPress={retryLoadOfferings}
              style={({ pressed }) => [s.reviewFallbackBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.reviewFallbackBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : showActivePrimaryScreen ? (
          <View style={s.simpleContent}>
            <View style={[s.simplePlanCard, isYearlyPlan ? s.simplePlanCardDimmed : null]}>
              <Text style={s.simplePlanTitle}>Monthly Plan</Text>
              <Text style={s.simplePlanPrice}>
                {monthlyDisplayPrice} / month
              </Text>
              {isMonthlyPlan ? (
                <Text style={s.simplePlanStatus}>Status: ACTIVE</Text>
              ) : null}
            </View>

            <View style={s.simplePlanCard}>
              <Text style={s.simplePlanTitle}>Yearly Plan</Text>
              <Text style={s.simplePlanPrice}>
                {yearlyDisplayPrice} / year
              </Text>
              <Text style={s.simplePlanSavings}>{yearlySavings.percentLabel}</Text>
              {isYearlyPlan ? (
                <Text style={s.simplePlanStatus}>Status: ACTIVE</Text>
              ) : isMonthlyPlan ? (
                <Pressable
                  onPress={handleUpgradeToYearly}
                  style={({ pressed }) => [s.simpleUpgradeBtn, pressed ? s.pressed : null]}
                >
                  <Text style={s.simpleUpgradeBtnText}>Upgrade</Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              onPress={handleManageSubscription}
              style={({ pressed }) => [s.manageCancelBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.manageCancelBtnText}>Manage / Cancel Subscription</Text>
            </Pressable>

            <Text style={s.simpleFooter}>Billing is managed by your app store.</Text>
          </View>
        ) : (
          <View style={s.simpleContent}>
            <View style={s.simplePlanCard}>
              <Text style={s.simplePlanTitle}>Monthly Plan</Text>
              <Text style={s.simplePlanPrice}>
                {monthlyDisplayPrice} / month
              </Text>
              <Pressable
                onPress={() => openCheckout("monthly")}
                style={({ pressed }) => [s.simpleUpgradeBtn, pressed ? s.pressed : null]}
              >
                <Text style={s.simpleUpgradeBtnText}>Subscribe</Text>
              </Pressable>
            </View>

            <View style={s.simplePlanCard}>
              <Text style={s.simplePlanTitle}>Yearly Plan</Text>
              <Text style={s.simplePlanPrice}>
                {yearlyDisplayPrice} / year
              </Text>
              <Text style={s.simplePlanSavings}>{yearlySavings.percentLabel}</Text>
              <Pressable
                onPress={() => openCheckout("yearly")}
                style={({ pressed }) => [s.simpleUpgradeBtn, pressed ? s.pressed : null]}
              >
                <Text style={s.simpleUpgradeBtnText}>Subscribe</Text>
              </Pressable>
            </View>

            <Text style={s.simpleFooter}>Billing is managed by your app store.</Text>
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
    paddingHorizontal: 18,
    marginBottom: 16,
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
    fontSize: 12.5,
    fontWeight: "700",
  },

  reviewFallbackCard: {
    marginHorizontal: 18,
    marginBottom: 14,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },

  reviewFallbackText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },

  reviewFallbackBtn: {
    marginTop: 4,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196,171,114,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.22)",
  },

  reviewFallbackBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },

  simpleContent: {
    paddingHorizontal: 18,
    gap: 14,
  },

  simplePlanCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 8,
  },

  simplePlanCardDimmed: {
    opacity: 0.55,
  },

  simplePlanTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
  },

  simplePlanPrice: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 16,
    fontWeight: "700",
  },

  simplePlanStatus: {
    marginTop: 4,
    color: "rgba(120,220,160,0.95)",
    fontSize: 14,
    fontWeight: "800",
  },

  simplePlanSavings: {
    color: "rgba(196,171,114,0.95)",
    fontSize: 14,
    fontWeight: "800",
  },

  simpleUpgradeBtn: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 171, 114, 0.88)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(210, 188, 138, 0.30)",
  },

  simpleUpgradeBtnText: {
    color: "#1A1610",
    fontSize: 15,
    fontWeight: "900",
  },

  manageCancelBtn: {
    marginTop: 8,
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },

  manageCancelBtnText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    fontWeight: "800",
  },

  simpleFooter: {
    marginTop: 4,
    color: "rgba(255,255,255,0.38)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center",
  },
});
