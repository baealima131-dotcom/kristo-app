import React, { useEffect, useMemo, useRef, useState } from "react";
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
import type { PurchasesPackage } from "react-native-purchases";
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
  isPlanActive,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  describeCurrentOfferingPackages,
  setRevenueCatDebugRouteEnabled,
} from "../../../../src/lib/payments/mobileSubscriptions";
import { useKristoSession } from "../../../../src/lib/KristoSessionProvider";
import { isAppleReviewBypassEnabled } from "../../../../src/lib/subscriptionBypass";
import { SUBSCRIPTION_REVIEW_FALLBACK_MESSAGE } from "../../../../src/lib/subscriptionReviewFallback";

const PLAN_CARDS: {
  key: SubscriptionPlanKey;
  title: string;
  price: string;
  cycle: string;
  summary: string;
  points: string[];
  badge?: string;
  tone: "soft" | "gold" | "blue";
}[] = [
  {
    key: "monthly",
    title: "Premium Monthly",
    price: "$49.99",
    cycle: "/ month",
    summary: "Media + Church access.",
    points: ["Live", "Video", "Guests"],
    badge: "POPULAR",
    tone: "gold",
  },
  {
    key: "yearly",
    title: "Premium Yearly",
    price: "$499.99",
    cycle: "/ year",
    summary: "Best yearly value.",
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
  const [offersLoading, setOffersLoading] = useState(true);
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const scrollRef = useRef<RNScrollView | null>(null);
  const [draftCurrentPlan, setDraftCurrentPlan] = useState<SubscriptionPlanKey>(() => getPaymentsState().subscriptions.selectedPlan);

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

        const info = await getCustomerSubscriptionInfo();
        const effective = getEffectiveSubscriptionState(info);

        if (!alive) return;
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);

        setSubscriptionSelectedPlan(effective.selectedPlan);
        setSubscriptionPlanStatus(effective.planStatus);
      } catch (error: any) {
        if (!alive) return;
        const reviewBypass = isAppleReviewBypassEnabled();
        const errorMessage = formatSubscriptionSetupError(error);
        console.log("KRISTO_REVENUECAT_OFFERINGS_UNAVAILABLE", {
          screen: "subscriptions",
          reviewBypass,
          error: errorMessage,
        });
        console.log("KRISTO_SUBSCRIPTION_REVIEW_FALLBACK", {
          screen: "subscriptions",
          reviewBypass,
          error: errorMessage,
        });
        if (!reviewBypass) {
          setSubscriptionUnavailable(true);
        }
      } finally {
        if (alive) setOffersLoading(false);
      }
    }

    boot();
    return () => {
      alive = false;
    };
  }, [sessionLoading, session]);

  const currentPlan = paymentsState.subscriptions.selectedPlan;
  const planStatus = paymentsState.subscriptions.planStatus;

  useEffect(() => {
    setDraftCurrentPlan(currentPlan);
  }, [currentPlan, planStatus]);

  const currentPlanData = useMemo(() => {
    const base = PLAN_CARDS.find((item) => item.key === currentPlan) || PLAN_CARDS[0];

    if (currentPlan === "monthly") {
      return { ...base, price: formatPrice(monthlyPackage || undefined, base.price) };
    }

    if (currentPlan === "yearly") {
      return { ...base, price: formatPrice(yearlyPackage || undefined, base.price) };
    }

    return base;
  }, [currentPlan, monthlyPackage, yearlyPackage]);

  const statusTone =
    planStatus === "active"
      ? [s.statusBadge, s.statusBadgeActive]
      : [s.statusBadge, s.statusBadgeExpired];

  const statusText =
    planStatus === "active"
      ? "ACTIVE"
      : "AVAILABLE";

  const currentPlanIsActive = isPlanActive(currentPlan, planStatus);

  const draftPlanIsActive = draftCurrentPlan === currentPlan && currentPlanIsActive;

  return (
    <View style={s.screen}>
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 18,
          paddingBottom: insets.bottom + 140,
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
        {subscriptionUnavailable ? (
          <View style={s.reviewFallbackCard}>
            <Ionicons name="sparkles-outline" size={22} color="rgba(255,230,190,0.96)" />
            <Text style={s.reviewFallbackTitle}>Premium</Text>
            <Text style={s.reviewFallbackText}>{SUBSCRIPTION_REVIEW_FALLBACK_MESSAGE}</Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [s.reviewFallbackBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.reviewFallbackBtnText}>Continue using Kristo</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Choose</Text>
          <Text style={s.sectionSub}>Monthly or yearly church premium.</Text>
        </View>

        <View style={[s.planGrid, subscriptionUnavailable ? { opacity: 0.45 } : null]}>
          {PLAN_CARDS.map((item) => {
            const isCurrent = item.key === draftCurrentPlan;
            const toneStyle =
              item.tone === "gold"
                ? s.planCardGold
                : item.tone === "blue"
                ? s.planCardBlue
                : s.planCardSoft;

            const displayPrice =
              item.key === "monthly"
                ? formatPrice(monthlyPackage || undefined, item.price)
                : formatPrice(yearlyPackage || undefined, item.price);

            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setDraftCurrentPlan(item.key);
                }}
                style={({ pressed }) => [
                  s.planCard,
                  toneStyle,
                  isCurrent ? s.planCardCurrent : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <View style={s.planCardTop}>
                  <View style={s.planCardHead}>
                    {item.badge ? <Text style={s.planBadge}>{item.badge}</Text> : null}
                    <Text style={s.planCardTitle}>{item.title}</Text>
                  </View>

                  {isCurrent ? (
                    <View style={s.selectedDotWrap}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  ) : null}
                </View>

                <Text style={s.planCardPrice}>
                  {displayPrice}
                  <Text style={s.planCardCycle}>{item.cycle}</Text>
                </Text>

                <Text style={s.planCardSummary}>{item.summary}</Text>

                <View style={s.planPointList}>
                  {item.points.map((point) => (
                    <View key={point} style={s.planPointRow}>
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color="rgba(255,230,190,0.96)"
                      />
                      <Text style={s.planPointText}>{point}</Text>
                    </View>
                  ))}
                </View>

                <View style={s.planBtnRow}>
                  <Pressable
                    onPress={() => {
                      setDraftCurrentPlan(item.key);

                      const isSameActivePlan =
                        item.key === currentPlan && isPlanActive(currentPlan, planStatus);

                      if (isSameActivePlan) return;
                      if (subscriptionUnavailable) return;

                      setSubscriptionSelectedPlan(item.key);
                      router.push({
                        pathname: "/more/payments/checkout" as any,
                        params: { plan: item.key },
                      });
                    }}
                    style={({ pressed }) => [
                      s.planBtn,
                      isCurrent ? s.planBtnCurrent : null,
                      pressed ? s.pressed : null,
                    ]}
                  >
                    <Text style={[s.planBtnText, isCurrent ? s.planBtnTextCurrent : null]}>
                      {isCurrent && currentPlanIsActive ? "Active" : "Choose"}
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#070B14" },

  glowTopLeft: {
    position: "absolute",
    top: -110,
    left: -110,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.018)",
  },

  glowBottomRight: {
    position: "absolute",
    right: -110,
    bottom: 120,
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.016)",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    marginBottom: 20,
  },

  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },

  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
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
    color: "rgba(255,255,255,0.54)",
    fontSize: 12.5,
    fontWeight: "700",
  },

  reviewFallbackCard: {
    marginHorizontal: 18,
    marginBottom: 18,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 10,
  },
  reviewFallbackTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
  },
  reviewFallbackText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  reviewFallbackBtn: {
    marginTop: 6,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  reviewFallbackBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },

  hero: {
    marginHorizontal: 16,
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },

  heroGlow: {
    position: "absolute",
    top: -42,
    right: -38,
    width: 110,
    height: 110,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.02)",
  },

  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  heroIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  heroTitle: {
    marginTop: 0,
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.38,
    lineHeight: 27,
  },

  heroMiniPill: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.038)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },

  heroMiniPillText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 0.75,
  },

  heroText: {
    marginTop: 2,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13.5,
    lineHeight: 22,
    fontWeight: "600",
  },

  currentPlanCard: {
    marginTop: 14,
    marginHorizontal: 16,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: "rgba(4,9,20,0.94)",
    borderWidth: 1.3,
    borderColor: "rgba(244,201,93,0.30)",
    overflow: "hidden",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },

  currentPlanGlow: {
    position: "absolute",
    right: -42,
    bottom: -42,
    width: 110,
    height: 110,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.018)",
  },

  currentPlanTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  currentPlanLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },

  currentPlanTitle: {
    marginTop: 10,
    color: "#fff",
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 28,
  },

  currentPlanPrice: {
    marginTop: 10,
    color: "#fff",
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -1.2,
  },

  currentPlanCycle: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 14,
    fontWeight: "800",
  },

  currentPlanText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: "700",
  },

  summaryMeta: {
    marginTop: 6,
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
  },

  loadingText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12.5,
    fontWeight: "700",
  },

  statusBadge: {
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  statusBadgeTrial: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.10)",
  },

  statusBadgeActive: {
    backgroundColor: "rgba(34,197,94,0.18)",
    borderColor: "rgba(74,222,128,0.34)",
  },

  statusBadgeExpired: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderColor: "rgba(248,113,113,0.30)",
  },

  statusBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },

  primaryActionRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
  },

  primaryBtn: {
    minHeight: 62,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  primaryBtnMain: {
    flex: 1,
    backgroundColor: "#F8D15E",
    borderRadius: 24,
    shadowColor: "#F4C95D",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },

  primaryBtnTrialActive: {
    backgroundColor: "#22C55E",
  },

  primaryBtnText: {
    color: "#111",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  primaryBtnDisabled: {
    opacity: 0.72,
  },
  primaryBtnTextDisabled: {
    color: "rgba(17,24,39,0.78)",
  },

  cancelBtn: {
    minWidth: 110,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  cancelBtnText: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "900",
  },

  metaFoot: {
    marginTop: 13,
    color: "rgba(255,255,255,0.48)",
    fontSize: 11.5,
    fontWeight: "700",
  },

  sectionHead: {
    marginTop: 18,
    paddingHorizontal: 18,
  },

  sectionTitle: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  sectionSub: {
    marginTop: 5,
    color: "rgba(255,255,255,0.54)",
    fontSize: 12.5,
    fontWeight: "700",
  },

  planGrid: {
    paddingHorizontal: 16,
    marginTop: 12,
    gap: 12,
    paddingBottom: 280,
  },

  planCard: {
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 0,
  },

  planCardSoft: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: "rgba(255,255,255,0.12)",
  },

  planCardGold: {
    backgroundColor: "rgba(244,197,106,0.12)",
    borderColor: "rgba(244,197,106,0.42)",
  },

  planCardBlue: {
    backgroundColor: "rgba(45,74,115,0.25)",
    borderColor: "rgba(96,165,250,0.28)",
  },

  planCardCurrent: {
    borderColor: "rgba(244,201,93,0.70)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.22,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },

  planCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },

  planCardHead: {
    flex: 1,
  },

  planBadge: {
    color: "rgba(255,235,200,0.95)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginBottom: 6,
  },

  planCardTitle: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.35,
  },

  selectedDotWrap: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },

  planCardPrice: {
    marginTop: 7,
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -1,
  },

  planCardCycle: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 13,
    fontWeight: "800",
  },

  planCardSummary: {
    marginTop: 5,
    color: "rgba(255,255,255,0.60)",
    fontSize: 12.2,
    lineHeight: 17,
    fontWeight: "700",
  },

  planPointList: {
    marginTop: 8,
    gap: 5,
  },

  planPointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  planPointText: {
    color: "rgba(255,255,255,0.80)",
    fontSize: 12.4,
    fontWeight: "800",
    flex: 1,
  },

  planBtnRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
  },

  planBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8D15E",
    borderWidth: 1,
    borderColor: "rgba(255,240,190,0.75)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },

  planBtnCurrent: {
    backgroundColor: "rgba(34,197,94,0.95)",
    borderColor: "rgba(74,222,128,0.95)",
  },

  planBtnText: {
    color: "#111",
    fontSize: 13,
    fontWeight: "900",
  },

  planBtnTextCurrent: {
    color: "#06210F",
  },

  planCancelBtn: {
    flex: 0.55,
    minHeight: 46,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.065)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },

  planCancelText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },

  nextBlock: {
    marginTop: 18,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },

  nextIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  nextTitle: {
    marginTop: 10,
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },

  nextText: {
    marginTop: 7,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.8,
    lineHeight: 20,
    fontWeight: "600",
  },
});
