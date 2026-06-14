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
import type { CustomerInfo, INTRO_ELIGIBILITY_STATUS, PurchasesPackage } from "react-native-purchases";
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
  hasRealActiveEntitlement,
  fetchMonthlyIntroTrialEligibility,
  resolveMonthlyIntroTrialEligible,
  resolveMonthlyIntroTrialLabel,
  logMonthlyIntroOfferFromStoreKit,
  openSubscriptionManagement,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  describeCurrentOfferingPackages,
  setRevenueCatDebugRouteEnabled,
  getRevenueCatConfiguredAppUserId,
  resolvePremiumPlanFromCustomerInfo,
} from "../../../../src/lib/payments/mobileSubscriptions";
import {
  fetchChurchSubscriptionStatus,
  isPastorSessionRole,
  logChurchSubscriptionContext,
  syncChurchSubscriptionAfterPurchase,
  type ChurchSubscriptionServerStatus,
} from "../../../../src/lib/churchSubscription";
import { recoverChurchIdFromMembership } from "../../../../src/lib/churchLockedRecovery";
import { getKristoHeaders } from "../../../../src/lib/kristoHeaders";
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
  const [monthlyIntroEligibility, setMonthlyIntroEligibility] =
    useState<INTRO_ELIGIBILITY_STATUS | null>(null);
  const [offersLoading, setOffersLoading] = useState(true);
  const [submittingSync, setSubmittingSync] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const scrollRef = useRef<RNScrollView | null>(null);
  const [draftCurrentPlan, setDraftCurrentPlan] = useState<SubscriptionPlanKey>(
    () => getPaymentsState().subscriptions.selectedPlan
  );

  const sessionRole = String(
    (session as any)?.role || (session as any)?.churchRole || ""
  ).trim();
  const sessionUserId = String((session as any)?.userId || "").trim();
  const isPastor = isPastorSessionRole(sessionRole);

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

        let introEligibility: INTRO_ELIGIBILITY_STATUS | null = null;
        try {
          introEligibility = await fetchMonthlyIntroTrialEligibility();
        } catch {
          introEligibility = null;
        }

        if (!alive) return;

        setChurchId(resolvedChurchId);
        setServerStatus(server);
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);
        logMonthlyIntroOfferFromStoreKit(monthly);
        setCustomerInfo(infoResult);

        const hasRealEntitlement = hasRealActiveEntitlement(infoResult);
        if (infoResult) {
          const effective = getEffectiveSubscriptionState(infoResult);
          setSubscriptionSelectedPlan(effective.selectedPlan);
        }
        setSubscriptionPlanStatus(hasRealEntitlement ? "active" : "expired");
        setMonthlyIntroEligibility(introEligibility);

        logChurchSubscriptionContext({
          screen: "subscriptions",
          churchId: resolvedChurchId,
          customerInfo: infoResult,
          churchSubscriptionActive: server.subscriptionActive,
          canUseMediaTools: server.canUseMediaTools,
        });

        const showActive =
          server.subscriptionActive || hasRealEntitlement;
        setShowPlanPicker(!showActive);

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
        setShowPlanPicker(true);
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
    const hasRealEntitlement = hasRealActiveEntitlement(info);
    if (info) {
      const effective = getEffectiveSubscriptionState(info);
      setSubscriptionSelectedPlan(effective.selectedPlan);
    }
    setSubscriptionPlanStatus(hasRealEntitlement ? "active" : "expired");

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
      churchSubscriptionActive: server.subscriptionActive,
      canUseMediaTools: server.canUseMediaTools,
    });
  }

  async function handleManageSubscription() {
    try {
      const opened = await openSubscriptionManagement(customerInfo);
      if (!opened) {
        Alert.alert(
          "Manage subscription",
          "Subscriptions are managed through Apple.\n\nOpen Settings → Apple ID → Subscriptions to cancel or change your plan."
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
        "Open Settings → Apple ID → Subscriptions on your iPhone."
      );
    }
  }

  async function handleSyncPurchase() {
    if (!isPastor || submittingSync || !churchId) return;

    try {
      setSubmittingSync(true);

      let info = customerInfo;
      if (!info) {
        info = await getCustomerSubscriptionInfo();
        setCustomerInfo(info);
      }

      const resolvedPlan =
        resolvePremiumPlanFromCustomerInfo(info) ||
        getEffectiveSubscriptionState(info).selectedPlan ||
        paymentsState.subscriptions.selectedPlan ||
        "monthly";

      const headers = getKristoHeaders({
        userId: sessionUserId,
        role: sessionRole as any,
        churchId,
      }) as Record<string, string>;

      const sync = await syncChurchSubscriptionAfterPurchase({
        churchId,
        userId: sessionUserId,
        role: sessionRole,
        churchRole: String((session as any)?.churchRole || "").trim() || undefined,
        subscriptionPlan: resolvedPlan,
        headers,
        purchaseConfirmed: true,
        initialCustomerInfo: info,
      });

      const server = await fetchChurchSubscriptionStatus(headers);
      setServerStatus(server);

      logChurchSubscriptionContext({
        screen: "subscriptions-sync",
        churchId,
        customerInfo: info,
        churchSubscriptionActive: server.subscriptionActive,
        canUseMediaTools: sync.canUseMediaTools || server.canUseMediaTools,
      });

      if (sync.canUseMediaTools || server.subscriptionActive) {
        setShowPlanPicker(false);
        Alert.alert(
          "Subscription synced",
          "Church subscription is active. Media Studio is unlocked for this church."
        );
        return;
      }

      if (sync.churchActivated) {
        Alert.alert(
          "Church activated",
          "Server recorded your subscription. Open Media Studio to confirm tools are unlocked."
        );
        return;
      }

      Alert.alert(
        "Sync in progress",
        hasRealActiveEntitlement(info)
          ? "Your App Store purchase is active for this church. Server verification may take a moment — try again shortly."
          : "No active App Store entitlement found for this church yet. Complete a purchase for this church, or manage an existing subscription through Apple."
      );
    } catch (error: any) {
      Alert.alert(
        "Sync failed",
        String(error?.message || "Could not sync church subscription. Try again.")
      );
    } finally {
      setSubmittingSync(false);
    }
  }

  const currentPlan = paymentsState.subscriptions.selectedPlan;
  const hasRealEntitlement = hasRealActiveEntitlement(customerInfo);
  const revenueCatAppUserId = getRevenueCatConfiguredAppUserId();
  const churchSubscriptionActive =
    serverStatus.subscriptionActive || hasRealEntitlement;
  const showActivePrimaryScreen = churchSubscriptionActive && !showPlanPicker;

  useEffect(() => {
    setDraftCurrentPlan(currentPlan);
  }, [currentPlan]);

  const monthlyTrialEligible = resolveMonthlyIntroTrialEligible(
    customerInfo,
    monthlyPackage,
    monthlyIntroEligibility
  );
  const monthlyTrialLabel = monthlyTrialEligible
    ? resolveMonthlyIntroTrialLabel(monthlyPackage)
    : null;

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

        {churchId ? (
          <View style={s.churchContextCard}>
            <View style={s.churchContextRow}>
              <Ionicons name="business-outline" size={16} color="rgba(196,171,114,0.85)" />
              <Text style={s.churchContextLabel}>Current church</Text>
            </View>
            <Text style={s.churchContextId}>{churchId}</Text>
            <Text style={s.churchContextMeta}>
              RevenueCat subscriber: {revenueCatAppUserId || "—"}
              {revenueCatAppUserId && revenueCatAppUserId !== churchId
                ? " (mismatch — tap Sync purchase)"
                : ""}
            </Text>
            <Text style={s.churchContextNote}>
              Subscriptions are per church. A subscription on another church does not
              unlock Media Studio here.
            </Text>
          </View>
        ) : null}

        {offersLoading ? (
          <View style={s.reviewFallbackCard}>
            <ActivityIndicator color="rgba(196,171,114,0.72)" />
            <Text style={s.reviewFallbackText}>Loading subscription status...</Text>
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

        {showActivePrimaryScreen ? (
          <View style={s.activeCard}>
            <View style={s.activeHeaderRow}>
              <View style={s.activeIconWrap}>
                <Ionicons name="checkmark-circle" size={28} color="rgba(120,220,160,0.95)" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.activeTitle}>Church subscription active</Text>
                <Text style={s.activeSub}>
                  {serverStatus.canUseMediaTools || hasRealEntitlement
                    ? "Media Studio unlocked"
                    : "Sync purchase if Media Studio is still locked"}
                </Text>
              </View>
            </View>

            {serverStatus.subscriptionPlan ? (
              <Text style={s.activePlanLine}>
                Plan: {String(serverStatus.subscriptionPlan)}
              </Text>
            ) : null}

            <View style={s.activeActions}>
              {isPastor ? (
                <Pressable
                  onPress={handleSyncPurchase}
                  disabled={submittingSync}
                  style={({ pressed }) => [
                    s.primaryActionBtn,
                    submittingSync ? s.disabledBtn : null,
                    pressed ? s.pressed : null,
                  ]}
                >
                  {submittingSync ? (
                    <ActivityIndicator color="#1A1610" />
                  ) : (
                    <>
                      <Ionicons name="refresh-outline" size={18} color="#1A1610" />
                      <Text style={s.primaryActionBtnText}>Sync purchase</Text>
                    </>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                onPress={handleManageSubscription}
                disabled={submittingSync}
                style={({ pressed }) => [
                  isPastor ? s.secondaryActionBtn : s.primaryActionBtn,
                  submittingSync ? s.disabledBtn : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <Ionicons
                  name="logo-apple"
                  size={18}
                  color={isPastor ? "rgba(255,255,255,0.88)" : "#1A1610"}
                />
                <Text
                  style={isPastor ? s.secondaryActionBtnText : s.primaryActionBtnText}
                >
                  Manage subscription
                </Text>
              </Pressable>
            </View>

            <Text style={s.manageHint}>
              Cancel or change billing in Apple Subscriptions — not inside Kristo.
            </Text>

            <Pressable
              onPress={() => setShowPlanPicker(true)}
              style={({ pressed }) => [s.changePlanLink, pressed ? s.pressed : null]}
            >
              <Text style={s.changePlanLinkText}>View plans</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={s.notSubscribedBanner}>
              <Ionicons name="information-circle-outline" size={20} color="rgba(196,171,114,0.9)" />
              <Text style={s.notSubscribedText}>This church is not subscribed yet</Text>
            </View>

            <View style={[s.planGrid, subscriptionError ? { opacity: 0.45 } : null]}>
              {PLAN_CARDS.map((item) => {
                const isSelected = item.key === draftCurrentPlan;
                const cardStyle = item.tone === "gold" ? s.planCardGold : s.planCardBlue;
                const planPackage = item.key === "monthly" ? monthlyPackage : yearlyPackage;
                const displayPrice = formatPrice(planPackage || undefined, item.price);
                const isActivePlan =
                  hasRealEntitlement && item.key === currentPlan;

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

                    {item.key === "monthly" && monthlyTrialLabel ? (
                      <Text style={s.planTrialLine}>{monthlyTrialLabel}</Text>
                    ) : null}

                    <Text
                      style={[
                        s.planCardPrice,
                        item.key === "monthly" && monthlyTrialLabel
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

                        if (isActivePlan && isPastor) {
                          void handleSyncPurchase();
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
                        {isActivePlan ? "Sync purchase" : "Choose"}
                      </Text>
                    </Pressable>
                  </Pressable>
                );
              })}
            </View>

            {churchSubscriptionActive ? (
              <Pressable
                onPress={() => setShowPlanPicker(false)}
                style={({ pressed }) => [s.backToActiveLink, pressed ? s.pressed : null]}
              >
                <Text style={s.backToActiveLinkText}>Back to active subscription</Text>
              </Pressable>
            ) : null}
          </>
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

  churchContextCard: {
    marginHorizontal: 18,
    marginBottom: 14,
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.18)",
    gap: 6,
  },

  churchContextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  churchContextLabel: {
    color: "rgba(196,171,114,0.78)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  churchContextId: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  churchContextMeta: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },

  churchContextNote: {
    marginTop: 4,
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
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

  activeCard: {
    marginHorizontal: 18,
    marginBottom: 14,
    borderRadius: 24,
    padding: 20,
    backgroundColor: "rgba(16, 28, 22, 0.92)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(120, 220, 160, 0.22)",
    gap: 14,
  },

  activeHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  activeIconWrap: {
    marginTop: 2,
  },

  activeTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  activeSub: {
    marginTop: 4,
    color: "rgba(120,220,160,0.88)",
    fontSize: 14,
    fontWeight: "700",
  },

  activePlanLine: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "700",
  },

  activeActions: {
    gap: 10,
  },

  primaryActionBtn: {
    minHeight: 52,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(196, 171, 114, 0.88)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(210, 188, 138, 0.30)",
  },

  primaryActionBtnText: {
    color: "#1A1610",
    fontSize: 15,
    fontWeight: "900",
  },

  secondaryActionBtn: {
    minHeight: 52,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },

  secondaryActionBtnText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    fontWeight: "800",
  },

  disabledBtn: {
    opacity: 0.6,
  },

  manageHint: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center",
  },

  changePlanLink: {
    alignSelf: "center",
    paddingVertical: 8,
  },

  changePlanLinkText: {
    color: "rgba(196,171,114,0.78)",
    fontSize: 13,
    fontWeight: "800",
  },

  notSubscribedBanner: {
    marginHorizontal: 18,
    marginBottom: 14,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(196,171,114,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.18)",
  },

  notSubscribedText: {
    flex: 1,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },

  backToActiveLink: {
    alignSelf: "center",
    marginTop: 8,
    paddingVertical: 10,
  },

  backToActiveLinkText: {
    color: "rgba(120,220,160,0.88)",
    fontSize: 13,
    fontWeight: "800",
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
