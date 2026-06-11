import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
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
  configureMobileSubscriptions,
  formatSubscriptionSetupError,
  getSubscriptionOfferings,
  getCustomerSubscriptionInfo,
  getEffectiveSubscriptionState,
  hasRealActiveEntitlement,
  isEligibleForMonthlyIntroTrial,
  MONTHLY_INTRO_TRIAL_DAYS,
  openSubscriptionManagement,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  describeCurrentOfferingPackages,
  setRevenueCatDebugRouteEnabled,
} from "../../../../src/lib/payments/mobileSubscriptions";
import { useKristoSession } from "../../../../src/lib/KristoSessionProvider";
import { isAppleReviewBypassEnabled } from "../../../../src/lib/subscriptionBypass";

const PLAN_CARDS: {
  key: SubscriptionPlanKey;
  title: string;
  price: string;
  cycle: string;
  points: string[];
  badge?: string;
  tone: "gold" | "blue";
}[] = [
  {
    key: "monthly",
    title: "Premium Monthly",
    price: "$49.99",
    cycle: "/month",
    points: ["Live", "Video", "Guests"],
    badge: "POPULAR",
    tone: "gold",
  },
  {
    key: "yearly",
    title: "Premium Yearly",
    price: "$499.99",
    cycle: "/year",
    points: ["Best value", "Media + Church", "Priority upgrades"],
    badge: "BEST VALUE",
    tone: "blue",
  },
];

function formatPrice(pkg?: PurchasesPackage, fallback?: string) {
  return pkg?.product.priceString || fallback || "";
}

export default function PaymentsSubscriptionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading: sessionLoading } = useKristoSession();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [yearlyPackage, setYearlyPackage] = useState<PurchasesPackage | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offersLoading, setOffersLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const scrollRef = useRef<RNScrollView | null>(null);
  const [draftCurrentPlan, setDraftCurrentPlan] = useState<SubscriptionPlanKey>(
    () => getPaymentsState().subscriptions.selectedPlan
  );

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
        const appUserID =
          String(
            (session as any)?.userId ||
              (session as any)?.id ||
              (session as any)?.profile?.userId ||
              ""
          ).trim();

        const configured = await configureMobileSubscriptions(appUserID);
        if (!configured) {
          throw new Error("RevenueCat is not configured yet.");
        }

        const offerings = await getSubscriptionOfferings();
        const monthly = resolveMonthlyPackage(offerings);
        const yearly = resolveYearlyPackage(offerings);

        console.log(
          "RevenueCat offerings packages:\n" + describeCurrentOfferingPackages(offerings)
        );

        if (!alive) return;
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);

        try {
          const info = await getCustomerSubscriptionInfo();
          const effective = getEffectiveSubscriptionState(info);
          if (!alive) return;
          setCustomerInfo(info);
          setSubscriptionSelectedPlan(effective.selectedPlan);
          setSubscriptionPlanStatus(hasRealActiveEntitlement(info) ? "active" : "expired");
        } catch {
          if (!alive) return;
          setCustomerInfo(null);
          setSubscriptionPlanStatus("expired");
        }

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
  }, [sessionLoading, session, reloadToken]);

  function retryLoadOfferings() {
    setReloadToken((token) => token + 1);
  }

  async function handleManageSubscription() {
    try {
      const opened = await openSubscriptionManagement(customerInfo);
      if (!opened) return;

      const info = await getCustomerSubscriptionInfo();
      setCustomerInfo(info);
      const effective = getEffectiveSubscriptionState(info);
      setSubscriptionSelectedPlan(effective.selectedPlan);
      setSubscriptionPlanStatus(hasRealActiveEntitlement(info) ? "active" : "expired");
    } catch (error: any) {
      console.log("KRISTO_SUBSCRIPTION_MANAGE_FAILED", {
        message: String(error?.message || error || ""),
      });
    }
  }

  const currentPlan = paymentsState.subscriptions.selectedPlan;
  const planStatus = paymentsState.subscriptions.planStatus;

  useEffect(() => {
    setDraftCurrentPlan(currentPlan);
  }, [currentPlan, planStatus]);

  const currentPlanIsActive = planStatus === "active";
  const monthlyTrialEligible = isEligibleForMonthlyIntroTrial(customerInfo);

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
            <Text style={s.sub}>Choose your access</Text>
          </View>
        </View>

        {offersLoading ? (
          <View style={s.reviewFallbackCard}>
            <ActivityIndicator color="rgba(196,171,114,0.72)" />
            <Text style={s.reviewFallbackText}>Loading App Store packages...</Text>
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
        ) : null}

        <View style={[s.planGrid, subscriptionError ? { opacity: 0.45 } : null]}>
          {PLAN_CARDS.map((item) => {
            const isSelected = item.key === draftCurrentPlan;
            const cardStyle = item.tone === "gold" ? s.planCardGold : s.planCardBlue;
            const planPackage = item.key === "monthly" ? monthlyPackage : yearlyPackage;
            const displayPrice = formatPrice(planPackage || undefined, item.price);
            const isActivePlan = item.key === currentPlan && currentPlanIsActive;

            return (
              <Pressable
                key={item.key}
                onPress={() => setDraftCurrentPlan(item.key)}
                style={({ pressed }) => [
                  s.planCard,
                  cardStyle,
                  isSelected ? s.planCardSelected : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <View style={s.planCardTop}>
                  <View style={s.planCardHead}>
                    {item.badge ? <Text style={s.planBadge}>{item.badge}</Text> : null}
                    <Text style={s.planCardTitle}>{item.title}</Text>
                  </View>

                  {isSelected ? (
                    <View style={s.selectedDotWrap}>
                      <Ionicons name="checkmark" size={12} color="rgba(196,171,114,0.95)" />
                    </View>
                  ) : null}
                </View>

                {item.key === "monthly" && monthlyTrialEligible ? (
                  <Text style={s.planTrialLine}>
                    {MONTHLY_INTRO_TRIAL_DAYS} Days Free Trial
                  </Text>
                ) : null}

                <Text
                  style={[
                    s.planCardPrice,
                    item.key === "monthly" && monthlyTrialEligible
                      ? s.planCardPriceAfterTrial
                      : null,
                  ]}
                >
                  {displayPrice}
                  <Text style={s.planCardCycle}>{item.cycle}</Text>
                </Text>

                <View style={s.planPointList}>
                  {item.points.map((point) => (
                    <View key={point} style={s.planPointRow}>
                      <View style={s.planPointDot} />
                      <Text style={s.planPointText}>{point}</Text>
                    </View>
                  ))}
                </View>

                <Pressable
                  onPress={() => {
                    setDraftCurrentPlan(item.key);

                    if (isActivePlan) {
                      void handleManageSubscription();
                      return;
                    }

                    if (!planPackage) {
                      setSubscriptionError(
                        "App Store packages are not available yet. Tap retry, then try again."
                      );
                      return;
                    }

                    setSubscriptionSelectedPlan(item.key);
                    router.push({
                      pathname: "/more/payments/checkout" as any,
                      params: { plan: item.key },
                    });
                  }}
                  style={({ pressed }) => [
                    s.planBtn,
                    isActivePlan ? s.planBtnManage : null,
                    pressed ? s.pressed : null,
                  ]}
                >
                  <Text style={[s.planBtnText, isActivePlan ? s.planBtnTextManage : null]}>
                    {isActivePlan ? "Manage / Cancel" : "Choose"}
                  </Text>
                </Pressable>
              </Pressable>
            );
          })}
        </View>
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

  planGrid: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 40,
  },

  planCard: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  planCardGold: {
    backgroundColor: "rgba(16, 18, 24, 0.96)",
    borderColor: "rgba(196, 171, 114, 0.14)",
  },

  planCardBlue: {
    backgroundColor: "rgba(12, 16, 26, 0.96)",
    borderColor: "rgba(88, 102, 128, 0.16)",
  },

  planCardSelected: {
    borderColor: "rgba(196, 171, 114, 0.28)",
    shadowColor: "rgba(196, 171, 114, 0.25)",
    shadowOpacity: 0.14,
    shadowRadius: 22,
  },

  planCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },

  planCardHead: {
    flex: 1,
  },

  planBadge: {
    color: "rgba(196, 171, 114, 0.65)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginBottom: 8,
  },

  planCardTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },

  planTrialLine: {
    marginTop: 10,
    color: "rgba(196, 171, 114, 0.78)",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.1,
  },

  selectedDotWrap: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 171, 114, 0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196, 171, 114, 0.22)",
  },

  planCardPrice: {
    marginTop: 12,
    color: "#fff",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
  },

  planCardPriceAfterTrial: {
    marginTop: 4,
  },

  planCardCycle: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 16,
    fontWeight: "700",
  },

  planPointList: {
    marginTop: 16,
    gap: 10,
  },

  planPointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  planPointDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(196, 171, 114, 0.55)",
  },

  planPointText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },

  planBtn: {
    marginTop: 20,
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 171, 114, 0.88)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(210, 188, 138, 0.30)",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },

  planBtnManage: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.12)",
    shadowOpacity: 0,
    elevation: 0,
  },

  planBtnText: {
    color: "#1A1610",
    fontSize: 15,
    fontWeight: "900",
  },

  planBtnTextManage: {
    color: "rgba(255,255,255,0.82)",
  },
});
