import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  INTRO_ELIGIBILITY_STATUS,
  type CustomerInfo,
  type PurchasesPackage,
} from "react-native-purchases";
import {
  getPaymentsState,
  setPaymentsCurrentModule,
  setSubscriptionPlanStatus,
  setSubscriptionSelectedPlan,
  subscribePayments,
  type SubscriptionPlanKey,
} from "../../../../src/store/paymentsStore";
import { SubscriptionLegalDisclosure } from "../../../../src/components/payments/SubscriptionLegalDisclosure";
import {
  configureChurchMobileSubscriptions,
  formatMonthlySubscriptionPrice,
  formatSubscriptionSetupError,
  formatYearlySubscriptionPrice,
  getSubscriptionOfferings,
  getCustomerSubscriptionInfo,
  getEffectiveSubscriptionState,
  hasPremiumEntitlement,
  logEntitlementAudit,
  logInRevenueCatForChurchSubscription,
  resolvePremiumPlanFromCustomerInfo,
  fetchMonthlyIntroTrialEligibility,
  resolveMonthlyIntroTrialEligible,
  openSubscriptionManagement,
  purchaseSubscriptionPackage,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  describeCurrentOfferingPackages,
  logMonthlyIntroOfferFromStoreKit,
  setRevenueCatDebugRouteEnabled,
} from "../../../../src/lib/payments/mobileSubscriptions";
import {
  isPastorSessionRole,
  syncChurchSubscriptionAfterPurchase,
  fetchChurchSubscriptionStatus,
  logChurchSubscriptionContext,
  type ChurchSubscriptionActivationSource,
} from "../../../../src/lib/churchSubscription";
import { recoverChurchIdFromMembership } from "../../../../src/lib/churchLockedRecovery";
import { getKristoHeaders } from "../../../../src/lib/kristoHeaders";
import { useKristoSession } from "../../../../src/lib/KristoSessionProvider";
import { isAppleReviewBypassEnabled } from "../../../../src/lib/subscriptionBypass";

const PLAN_META: Record<
  SubscriptionPlanKey,
  {
    title: string;
    fallbackPrice: string;
    benefits: string[];
  }
> = {
  monthly: {
    title: "Premium Monthly",
    fallbackPrice: "$49.99",
    benefits: ["Media Live streaming", "Video posts & scheduling", "Guest invites"],
  },
  yearly: {
    title: "Premium Yearly",
    fallbackPrice: "$499.99",
    benefits: ["Everything in Monthly", "Best yearly value", "Priority media upgrades"],
  },
};

function extractRevenueCatErrorCode(message: string | null): number | null {
  const raw = String(message || "");
  const match = raw.match(/\(code\s+(\d+)\)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function PaymentsCheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ plan?: string }>();
  const { session, loading: sessionLoading, setSession } = useKristoSession();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [yearlyPackage, setYearlyPackage] = useState<PurchasesPackage | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [monthlyIntroEligibility, setMonthlyIntroEligibility] =
    useState<INTRO_ELIGIBILITY_STATUS | null>(null);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const didLogCheckoutPackagesRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [checkoutChurchId, setCheckoutChurchId] = useState("");
  const [serverSubscriptionActive, setServerSubscriptionActive] = useState(false);

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

  const paramPlan = params.plan;
  const safePlan: SubscriptionPlanKey =
    paramPlan === "monthly" || paramPlan === "yearly"
      ? paramPlan
      : paymentsState.subscriptions.selectedPlan;

  const sessionRole = String(
    (session as any)?.role || (session as any)?.churchRole || ""
  ).trim();
  const sessionChurchId = String((session as any)?.churchId || "").trim();
  const sessionUserId = String((session as any)?.userId || "").trim();

  async function resolveCheckoutChurchId(): Promise<string> {
    let churchId = sessionChurchId;
    if (!churchId) {
      const recovered = await recoverChurchIdFromMembership(session, setSession);
      churchId = recovered.churchId;
    }
    return String(churchId || "").trim();
  }

  async function maybeActivateChurchSubscription(
    resolvedPlan: SubscriptionPlanKey,
    opts: {
      activationSource: ChurchSubscriptionActivationSource;
      purchaseConfirmed?: boolean;
      initialCustomerInfo?: CustomerInfo | null;
    }
  ) {
    if (!isPastorSessionRole(sessionRole)) {
      return { activated: false, skipped: true as const, canUseMediaTools: false };
    }

    const churchId = String(
      checkoutChurchId || sessionChurchId || (session as any)?.activeChurchId || ""
    ).trim();
    if (!churchId) {
      if (isAppleReviewBypassEnabled()) {
        return { activated: false, skipped: true as const, canUseMediaTools: false };
      }
      return { activated: false, skipped: false as const, canUseMediaTools: false };
    }

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
      purchaseConfirmed: opts.purchaseConfirmed === true,
      activationSource: opts.activationSource,
      initialCustomerInfo: opts.initialCustomerInfo ?? null,
    });

    return {
      activated: sync.churchActivated,
      skipped: false as const,
      canUseMediaTools: sync.canUseMediaTools,
      churchSubscriptionActive: sync.churchSubscriptionActive,
    };
  }

  useEffect(() => {
    let alive = true;

    async function loadPackages() {
      if (sessionLoading) return;

      setLoadingPackages(true);
      setPackagesError(null);

      try {
        const churchId = await resolveCheckoutChurchId();
        if (!churchId) {
          throw new Error("Church id is required before loading subscription packages.");
        }

        const headers = getKristoHeaders({
          userId: sessionUserId,
          role: sessionRole as any,
          churchId,
        }) as Record<string, string>;

        const { configured, customerInfo: configuredCustomerInfo } =
          await configureChurchMobileSubscriptions(churchId, { syncPurchases: false });
        if (!configured) {
          throw new Error("RevenueCat is not configured yet.");
        }

        const offerings = await getSubscriptionOfferings();
        const monthly = resolveMonthlyPackage(offerings);
        const yearly = resolveYearlyPackage(offerings);

        if (!didLogCheckoutPackagesRef.current) {
          console.log(
            "RevenueCat checkout packages:\n" + describeCurrentOfferingPackages(offerings)
          );
          didLogCheckoutPackagesRef.current = true;
        }

        let info: CustomerInfo | null = configuredCustomerInfo;
        if (!info) {
          try {
            info = await getCustomerSubscriptionInfo();
          } catch {
            info = null;
          }
        }

        const server = await fetchChurchSubscriptionStatus(headers);

        if (!alive) return;
        setCheckoutChurchId(churchId);
        setServerSubscriptionActive(!!server.subscriptionActive);
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);
        setCustomerInfo(info);
        logMonthlyIntroOfferFromStoreKit(monthly);
        setSubscriptionPlanStatus(hasPremiumEntitlement(info) ? "active" : "expired");

        logChurchSubscriptionContext({
          screen: "checkout",
          churchId,
          customerInfo: info,
          churchSubscriptionActive: server.subscriptionActive ?? undefined,
          canUseMediaTools: server.canUseMediaTools ?? undefined,
        });
        logEntitlementAudit({
          customerInfo: info,
          churchId,
          source: "checkout-boot",
        });

        try {
          const introEligibility = await fetchMonthlyIntroTrialEligibility();
          if (!alive) return;
          setMonthlyIntroEligibility(introEligibility);
        } catch {
          if (!alive) return;
          setMonthlyIntroEligibility(null);
        }

        const planPackage = safePlan === "monthly" ? monthly : yearly;
        if (!planPackage && !hasPremiumEntitlement(info)) {
          setPackagesError(
            "App Store packages are still loading. Tap retry in a moment."
          );
        }
      } catch (error: any) {
        if (!alive) return;
        const errorMessage = formatSubscriptionSetupError(error);
        console.log("KRISTO_REVENUECAT_OFFERINGS_UNAVAILABLE", {
          screen: "checkout",
          reviewBypass: isAppleReviewBypassEnabled(),
          error: errorMessage,
        });
        setPackagesError(errorMessage);
      } finally {
        if (alive) setLoadingPackages(false);
      }
    }

    loadPackages();
    return () => {
      alive = false;
    };
  }, [sessionLoading, session, safePlan, reloadToken]);

  function retryLoadPackages() {
    setReloadToken((token) => token + 1);
  }

 
  const hasPremium = hasPremiumEntitlement(customerInfo);
  const isSubscribedForCurrentChurch = hasPremium || serverSubscriptionActive;
  const activePlan =
    resolvePremiumPlanFromCustomerInfo(customerInfo) || safePlan;
  const displayPlan = isSubscribedForCurrentChurch ? activePlan : safePlan;
  const targetPackage = safePlan === "monthly" ? monthlyPackage : yearlyPackage;
  const displayPackage = displayPlan === "monthly" ? monthlyPackage : yearlyPackage;
  const planMeta = PLAN_META[displayPlan];
  const livePrice =
    displayPackage?.product.priceString || planMeta.fallbackPrice;
  const monthlyTrialEligible =
    safePlan === "monthly" &&
    resolveMonthlyIntroTrialEligible(customerInfo, monthlyPackage, monthlyIntroEligibility);
 
  const isPastor = isPastorSessionRole(sessionRole);

  useEffect(() => {
    console.log("KRISTO_CHECKOUT_SUBSCRIBED_STATE", {
      checkoutChurchId,
      isSubscribedForCurrentChurch,
      hasPremiumEntitlement: hasPremium,
      serverSubscriptionActive,
      isPastor,
    });
  }, [
    checkoutChurchId,
    isSubscribedForCurrentChurch,
    hasPremium,
    serverSubscriptionActive,
    isPastor,
  ]);

  const priceLine = useMemo(() => {
    if (displayPlan === "monthly") {
      return formatMonthlySubscriptionPrice(livePrice, monthlyPackage, monthlyTrialEligible);
    }
    return formatYearlySubscriptionPrice(livePrice, displayPackage);
  }, [displayPlan, livePrice, monthlyTrialEligible, monthlyPackage, displayPackage]);

  const confirmLabel =
    safePlan === "monthly"
      ? monthlyTrialEligible
        ? "Start 14-Day Free Trial"
        : "Subscribe Monthly"
      : "Subscribe Yearly";
  const revenueCatErrorCode = extractRevenueCatErrorCode(packagesError);
  const hasMonthlyPackage = Boolean(monthlyPackage);
  const hasOfferings = Boolean(monthlyPackage || yearlyPackage);
  const hasIntroOffer = Boolean(
    monthlyPackage?.product?.introPrice || monthlyPackage?.product?.introductoryPrice
  );

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (safePlan !== "monthly") return;
    if (isSubscribedForCurrentChurch) return;

    let reasonTrialHidden: string | null = null;
    if (!monthlyTrialEligible) {
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
      ctaText: confirmLabel,
      reasonTrialHidden,
    });
  }, [
    safePlan,
    isSubscribedForCurrentChurch,
    monthlyTrialEligible,
    hasMonthlyPackage,
    hasOfferings,
    revenueCatErrorCode,
    monthlyIntroEligibility,
    hasIntroOffer,
    confirmLabel,
  ]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (safePlan !== "monthly") return;
    if (!monthlyPackage) return;
    if (isSubscribedForCurrentChurch) return;

    const hasIntroOfferConfigured = Boolean(
      monthlyPackage.product.introPrice || monthlyPackage.product.introductoryPrice
    );
    if (!hasIntroOfferConfigured || !monthlyTrialEligible) return;

    console.log("KRISTO_IOS_MONTHLY_TRIAL_ELIGIBLE", {
      productId: monthlyPackage.product.identifier || null,
      introEligibilityStatus: monthlyIntroEligibility ?? "unknown",
      trialDays: 14,
      postTrialPrice: "$49.99/month",
      ctaText: "Start 14-Day Free Trial",
    });
  }, [
    safePlan,
    monthlyPackage,
    isSubscribedForCurrentChurch,
    monthlyTrialEligible,
    monthlyIntroEligibility,
  ]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (safePlan !== "monthly") return;
    if (loadingPackages || isSubscribedForCurrentChurch) return;
    if (monthlyTrialEligible) return;

    const hasIntroOffer = Boolean(monthlyPackage?.product?.introPrice || monthlyPackage?.product?.introductoryPrice);
    if (hasIntroOffer) return;

    console.log("KRISTO_IOS_MONTHLY_TRIAL_NOT_CONFIGURED", {
      checkoutChurchId: checkoutChurchId || null,
      monthlyProductId: monthlyPackage?.product.identifier || null,
      introEligibility: monthlyIntroEligibility ?? null,
      expectedTrial: "14-day free trial",
      expectedPostTrialPrice: "$49.99/month",
      action:
        "Configure an introductory free trial for premium_monthly in App Store Connect and attach it to the active RevenueCat offering.",
    });
  }, [
    safePlan,
    loadingPackages,
    isSubscribedForCurrentChurch,
    monthlyTrialEligible,
    monthlyPackage,
    monthlyIntroEligibility,
    checkoutChurchId,
  ]);

  function churchActivationNote(activation: {
    skipped?: boolean;
    canUseMediaTools?: boolean;
    churchSubscriptionActive?: boolean;
    activated?: boolean;
  }) {
    if (activation.skipped) return "";
    if (activation.canUseMediaTools) return " Media tools are now unlocked.";
    if (activation.churchSubscriptionActive || activation.activated) {
      return " Church subscription synced. Open Media to refresh if tools are still locked.";
    }
    return " Church subscription sync is still completing. Open Media again in a moment.";
  }

  async function handleSyncMediaTools() {
    if (submitting || !isPastor) return;
    if (!isSubscribedForCurrentChurch) return;

    try {
      setSubmitting(true);

      let info = customerInfo;
      if (!info) {
        info = await getCustomerSubscriptionInfo();
        setCustomerInfo(info);
      }

      const resolvedPlan =
        getEffectiveSubscriptionState(info).selectedPlan ||
        resolvePremiumPlanFromCustomerInfo(info) ||
        safePlan;
      setSubscriptionSelectedPlan(resolvedPlan);
      setSubscriptionPlanStatus("active");

      const activation = await maybeActivateChurchSubscription(resolvedPlan, {
        activationSource: "explicit_sync",
        initialCustomerInfo: info,
      });
      const churchNote = churchActivationNote(activation);

      if (activation.canUseMediaTools) {
        Alert.alert("Media tools unlocked", `Your church subscription is synced.${churchNote}`, [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }

      Alert.alert(
        activation.activated || activation.churchSubscriptionActive
          ? "Subscription synced"
          : "Sync in progress",
        activation.activated || activation.churchSubscriptionActive
          ? `Your active subscription is linked to church media.${churchNote}`
          : `Your subscription is active, but church sync is still completing.${churchNote}`
      );
    } catch (error: any) {
      Alert.alert(
        "Sync failed",
        String(error?.message || "Could not sync church subscription. Try again.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCheckout() {
    if (submitting || isSubscribedForCurrentChurch) return;

    if (!targetPackage) {
      setPackagesError(
        "App Store packages are not available yet. Tap retry, then try again."
      );
      return;
    }

    try {
      setSubmitting(true);

      const churchId = await resolveCheckoutChurchId();
      if (!churchId) {
        setPackagesError("Church id is required before purchasing church premium.");
        return;
      }

      await logInRevenueCatForChurchSubscription(churchId);
      const purchaseResult = await purchaseSubscriptionPackage(targetPackage);
      const initialInfo = purchaseResult.customerInfo;
      setCustomerInfo(initialInfo);

      const resolvedPlan =
        getEffectiveSubscriptionState(initialInfo).selectedPlan || safePlan;
      setSubscriptionSelectedPlan(resolvedPlan);
      setSubscriptionPlanStatus("active");

      const activation = await maybeActivateChurchSubscription(resolvedPlan, {
        activationSource: "purchase",
        purchaseConfirmed: true,
        initialCustomerInfo: initialInfo,
      });

      if (hasPremiumEntitlement(initialInfo)) {
        setSubscriptionPlanStatus("active");
      } else if (activation.canUseMediaTools || activation.churchSubscriptionActive) {
        setSubscriptionPlanStatus("active");
      }

      logEntitlementAudit({
        customerInfo: initialInfo,
        churchId,
        source: "checkout-purchase-success",
      });

      const successMessage =
        resolvedPlan === "monthly"
          ? "Monthly subscription is now active."
          : "Yearly subscription is now active.";
      const churchNote = churchActivationNote(activation);

      Alert.alert("Success", `${successMessage}${churchNote}`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error: any) {
      const msg = String(error?.message || "");
      if (/cancel/i.test(msg)) {
        Alert.alert("Purchase cancelled", "No charge was made.");
      } else {
        Alert.alert("Purchase failed", msg || "Could not complete subscription purchase.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManageSubscription() {
    if (submitting) return;

    try {
      setSubmitting(true);
      const manageResult = await openSubscriptionManagement(customerInfo);
      if (!manageResult.opened) {
        Alert.alert(
          "Manage subscription",
          "Open Settings → Apple ID → Subscriptions to manage or cancel your plan."
        );
        return;
      }

      const info = await getCustomerSubscriptionInfo();
      setCustomerInfo(info);
      const effective = getEffectiveSubscriptionState(info);
      setSubscriptionSelectedPlan(effective.selectedPlan);
      setSubscriptionPlanStatus(hasPremiumEntitlement(info) ? "active" : "expired");
    } catch (error: any) {
      Alert.alert(
        "Could not open subscriptions",
        String(error?.message || "Try again from Settings → Subscriptions.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={s.screen}>
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: insets.bottom + 28,
          paddingHorizontal: 16,
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
            <Text style={s.title}>Confirm plan</Text>
            <Text style={s.sub}>Media Premium for your church</Text>
          </View>
        </View>

        <View style={s.confirmCard}>
          <View pointerEvents="none" style={s.cardGlow} />

          <View style={s.cardTopRow}>
            <View style={s.planBadge}>
              <Ionicons name="diamond-outline" size={16} color="#F4D06F" />
              <Text style={s.planBadgeText}>SELECTED</Text>
            </View>
            {isSubscribedForCurrentChurch ? (
              <View style={s.activePill}>
                <Text style={s.activePillText}>ACTIVE</Text>
              </View>
            ) : null}
          </View>

          {checkoutChurchId ? (
            <View style={s.churchContextCard}>
              <Text style={s.churchContextTitle}>Subscribing church: {checkoutChurchId}</Text>
              <Text style={s.churchContextSub}>
                {isSubscribedForCurrentChurch
                  ? "This church has an active subscription."
                  : "This church is not subscribed yet. Purchases apply to this church only."}
              </Text>
            </View>
          ) : null}

          <Text style={s.planTitle}>{planMeta.title}</Text>
          <Text style={s.priceLine}>{priceLine}</Text>
          {!isSubscribedForCurrentChurch && safePlan === "monthly" && monthlyTrialEligible ? (
            <Text style={s.trialThenPrice}>Then $49.99/month</Text>
          ) : null}
          {isSubscribedForCurrentChurch ? (
            <Text style={s.activePlanNote}>
              {displayPlan === "monthly" ? "Current active plan" : "Yearly plan active"}
            </Text>
          ) : null}

          {monthlyTrialEligible ? (
            <Text style={s.trialNote}>Free trial for new subscribers. Cancel anytime.</Text>
          ) : null}

          <View style={s.benefitsBlock}>
            <Text style={s.benefitsLabel}>INCLUDED</Text>
            {planMeta.benefits.map((benefit) => (
              <View key={benefit} style={s.benefitRow}>
                <Ionicons name="checkmark-circle" size={15} color="#F4C95D" />
                <Text style={s.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>

          {loadingPackages ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color="#F4C95D" />
              <Text style={s.loadingText}>Loading plan details...</Text>
            </View>
          ) : null}

          {!loadingPackages && packagesError ? (
            <View style={s.errorCard}>
              <Text style={s.errorText}>{packagesError}</Text>
              <Pressable
                onPress={retryLoadPackages}
                style={({ pressed }) => [s.retryBtn, pressed ? s.pressed : null]}
              >
                <Text style={s.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={s.ctaBlock}>
            {isSubscribedForCurrentChurch ? (
              <>
                <Pressable
                  onPress={handleManageSubscription}
                  disabled={submitting}
                  style={({ pressed }) => [
                    isPastor ? s.secondaryBtn : s.primaryBtn,
                    submitting ? s.disabledBtn : null,
                    pressed ? s.pressed : null,
                  ]}
                >
                  {submitting && !isPastor ? (
                    <ActivityIndicator color="#111" />
                  ) : (
                    <>
                      <Ionicons
                        name="settings-outline"
                        size={18}
                        color={isPastor ? "#F4C95D" : "#111"}
                      />
                      <Text style={isPastor ? s.secondaryBtnText : s.primaryBtnText}>
                        Manage / Cancel Subscription
                      </Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={handleConfirmCheckout}
                disabled={submitting || loadingPackages || !targetPackage}
                style={({ pressed }) => [
                  s.primaryBtn,
                  (submitting || loadingPackages || !targetPackage) ? s.disabledBtn : null,
                  pressed ? s.pressed : null,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <Text style={s.primaryBtnText}>
                    {loadingPackages ? "Loading..." : confirmLabel}
                  </Text>
                )}
              </Pressable>
            )}

            <Text style={s.footText}>
              {isSubscribedForCurrentChurch
                ? "Billing is managed by your app store. Changes apply on your next billing date."
                : monthlyTrialEligible
                ? "No charge during the free trial. Cancel anytime in Apple Subscriptions."
                : "Secure checkout through Apple. Cancel anytime."}
            </Text>

            <SubscriptionLegalDisclosure showAgreement={!isSubscribedForCurrentChurch} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B0F17" },

  glowTopLeft: {
    position: "absolute",
    top: -90,
    left: -90,
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: "rgba(244,201,93,0.08)",
  },

  glowBottomRight: {
    position: "absolute",
    right: -60,
    bottom: 80,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(120,80,255,0.06)",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },

  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },

  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.5,
  },

  sub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.52)",
    fontSize: 12.5,
    fontWeight: "700",
  },

  confirmCard: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: "rgba(6,10,20,0.94)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.32)",
    overflow: "hidden",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },

  cardGlow: {
    position: "absolute",
    top: -50,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: "rgba(244,201,93,0.10)",
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(244,201,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.24)",
  },

  planBadgeText: {
    color: "#F4D06F",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  activePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.16)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.34)",
  },

  activePillText: {
    color: "#86EFAC",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  planTitle: {
    marginTop: 14,
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },

  churchContextCard: {
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(196,171,114,0.18)",
    gap: 4,
  },

  churchContextTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },

  churchContextSub: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },

  activePlanNote: {
    marginTop: 8,
    color: "#7BE495",
    fontSize: 16,
    fontWeight: "900",
  },
  priceLine: {
    marginTop: 8,
    color: "#F8E6B0",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
  },

  trialNote: {
    marginTop: 6,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "700",
  },
  trialThenPrice: {
    marginTop: 6,
    color: "#F8E6B0",
    fontSize: 14,
    fontWeight: "800",
  },

  benefitsBlock: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    gap: 8,
  },

  benefitsLabel: {
    color: "rgba(255,220,150,0.72)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 2,
  },

  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  benefitText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontSize: 13.5,
    fontWeight: "700",
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },

  loadingText: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    fontWeight: "700",
  },

  errorCard: {
    marginTop: 14,
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },

  errorText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13.5,
    fontWeight: "700",
    lineHeight: 19,
  },

  retryBtn: {
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
  },

  retryBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 13,
  },

  ctaBlock: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },

  primaryBtn: {
    minHeight: 54,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    backgroundColor: "#F4C95D",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },

  disabledBtn: {
    opacity: 0.58,
  },

  primaryBtnText: {
    color: "#111",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.15,
  },

  secondaryBtn: {
    minHeight: 54,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.28)",
  },

  secondaryBtnText: {
    color: "#F4C95D",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.1,
  },

  footText: {
    marginTop: 12,
    color: "rgba(255,255,255,0.42)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});
