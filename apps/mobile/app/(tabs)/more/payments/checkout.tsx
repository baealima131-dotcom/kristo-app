import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
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
  purchaseSubscriptionPackage,
  restoreSubscriptionPurchases,
  getCustomerSubscriptionInfo,
  getEffectiveSubscriptionState,
  hasActiveEntitlement,
  resolveMonthlyPackage,
  resolveYearlyPackage,
  describeCurrentOfferingPackages,
  setRevenueCatDebugRouteEnabled,
} from "../../../../src/lib/payments/mobileSubscriptions";
import {
  activateChurchSubscriptionForPastor,
  isPastorSessionRole,
} from "../../../../src/lib/churchSubscription";
import { recoverChurchIdFromMembership } from "../../../../src/lib/churchLockedRecovery";
import { getKristoHeaders } from "../../../../src/lib/kristoHeaders";
import { useKristoSession } from "../../../../src/lib/KristoSessionProvider";
import { isAppleReviewBypassEnabled } from "../../../../src/lib/subscriptionBypass";
import { SUBSCRIPTION_REVIEW_FALLBACK_MESSAGE } from "../../../../src/lib/subscriptionReviewFallback";

const PLAN_META: Record<
  SubscriptionPlanKey,
  {
    title: string;
    price: string;
    cycle: string;
    note: string;
  }
> = {
  monthly: {
    title: "Premium Monthly",
    price: "$49.99",
    cycle: "/ month",
    note: "Media tools for church growth.",
  },
  yearly: {
    title: "Premium Yearly",
    price: "$499.99",
    cycle: "/ year",
    note: "Best yearly value.",
  },
};

const extra =
  (Constants.expoConfig?.extra as Record<string, string | undefined> | undefined) || {};

const isTestStoreRevenueCat =
  /test/i.test(String(extra.revenuecatIosApiKey || "")) ||
  /test/i.test(String(extra.revenuecatAndroidApiKey || ""));

export default function PaymentsCheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ plan?: string }>();
  const { session, loading: sessionLoading, setSession } = useKristoSession();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [yearlyPackage, setYearlyPackage] = useState<PurchasesPackage | null>(null);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const didLoadPackagesRef = useRef(false);
  const didLogCheckoutPackagesRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutUnavailable, setCheckoutUnavailable] = useState(false);

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

  async function maybeActivateChurchSubscription(resolvedPlan: SubscriptionPlanKey) {
    if (!isPastorSessionRole(sessionRole)) {
      return { activated: false, skipped: true as const };
    }

    let churchId = sessionChurchId;
    if (!churchId) {
      const recovered = await recoverChurchIdFromMembership(session, setSession);
      churchId = recovered.churchId;
    }

    if (!churchId) {
      if (isAppleReviewBypassEnabled()) {
        return { activated: false, skipped: true as const };
      }
      return { activated: false, skipped: false as const };
    }

    const headers = getKristoHeaders({
      userId: sessionUserId,
      role: sessionRole as any,
      churchId,
    }) as Record<string, string>;

    const activated = await activateChurchSubscriptionForPastor(
      churchId,
      resolvedPlan,
      headers
    );

    return { activated, skipped: false as const };
  }

  useEffect(() => {
    let alive = true;

    async function loadPackages() {
      if (sessionLoading) return;
      if (didLoadPackagesRef.current) return;
      didLoadPackagesRef.current = true;

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

        if (!didLogCheckoutPackagesRef.current) {
          console.log(
            "RevenueCat checkout packages:\n" + describeCurrentOfferingPackages(offerings)
          );
          didLogCheckoutPackagesRef.current = true;
        }

        if (!alive) return;
        setMonthlyPackage(monthly);
        setYearlyPackage(yearly);
      } catch (error: any) {
        if (!alive) return;
        console.log("KRISTO_SUBSCRIPTION_REVIEW_FALLBACK", {
          screen: "checkout",
          reviewBypass: isAppleReviewBypassEnabled(),
          error: formatSubscriptionSetupError(error),
        });
        setCheckoutUnavailable(true);
      } finally {
        if (alive) setLoadingPackages(false);
      }
    }

    loadPackages();
    return () => {
      alive = false;
    };
  }, [sessionLoading, session]);

  const livePrice =
    safePlan === "monthly"
      ? monthlyPackage?.product.priceString || PLAN_META.monthly.price
      : yearlyPackage?.product.priceString || PLAN_META.yearly.price;

  const planData = useMemo(
    () => ({
      ...PLAN_META[safePlan],
      price: livePrice,
    }),
    [safePlan, livePrice]
  );

  const confirmLabel =
    safePlan === "monthly" ? "Subscribe Monthly" : "Subscribe Yearly";

  const targetPackage = safePlan === "monthly" ? monthlyPackage : yearlyPackage;

  async function handleConfirmCheckout() {
    if (submitting) return;

    if (!targetPackage) {
      if (checkoutUnavailable || isAppleReviewBypassEnabled()) {
        console.log("KRISTO_SUBSCRIPTION_REVIEW_FALLBACK", {
          screen: "checkout",
          reason: "package_missing",
          reviewBypass: isAppleReviewBypassEnabled(),
        });
        router.back();
        return;
      }
      Alert.alert(
        "Package missing",
        "Monthly or yearly package was not found from RevenueCat offerings. Check Metro logs for packageType, identifier, and productIdentifier."
      );
      return;
    }

    try {
      setSubmitting(true);

      await purchaseSubscriptionPackage(targetPackage);

      let info = await getCustomerSubscriptionInfo();
      let active = hasActiveEntitlement(info);

      for (let i = 0; i < 5 && !active; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        info = await getCustomerSubscriptionInfo();
        active = hasActiveEntitlement(info);
      }

      if (active) {
        const effective = getEffectiveSubscriptionState(info);
        const resolvedPlan = effective.selectedPlan;
        setSubscriptionSelectedPlan(resolvedPlan);
        setSubscriptionPlanStatus(effective.planStatus);

        const activation = await maybeActivateChurchSubscription(resolvedPlan);
        const successMessage =
          resolvedPlan === "monthly"
            ? "Monthly subscription is now active."
            : "Yearly subscription is now active.";
        const churchNote =
          activation.skipped
            ? ""
            : activation.activated
            ? " Church schedule access is now unlocked."
            : " Create your church media profile to unlock schedule access.";

        Alert.alert(
          "Success",
          `${successMessage}${churchNote}`,
          [{ text: "OK", onPress: () => router.back() }]
        );
      } else {
        Alert.alert(
          "Purchase syncing",
          "Purchase finished, but subscription sync is still completing. Please wait a moment and try again."
        );
      }
    } catch (error: any) {
      const msg = String(error?.message || "");
      if (/cancel/i.test(msg)) {
        Alert.alert("Cancel anytime • No charges todayled", "Purchase was cancelled.");
      } else {
        Alert.alert("Purchase failed", msg || "Could not complete subscription purchase.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestorePurchases() {
    if (submitting) return;

    try {
      setSubmitting(true);

      const restored = await restoreSubscriptionPurchases();
      const active = hasActiveEntitlement(restored);

      if (!active) {
        Alert.alert(
          "Nothing restored",
          "No active premium purchases were found for this account."
        );
        return;
      }

      const effective = getEffectiveSubscriptionState(restored);
      const resolvedPlan = effective.selectedPlan;

      setSubscriptionSelectedPlan(resolvedPlan);
      setSubscriptionPlanStatus(effective.planStatus);

      const activation = await maybeActivateChurchSubscription(resolvedPlan);
      const restoreMessage =
        resolvedPlan === "yearly"
          ? "Yearly subscription restored."
          : "Monthly subscription restored.";
      const churchNote =
        activation.skipped
          ? ""
          : activation.activated
          ? " Church schedule access is now unlocked."
          : " Create your church media profile to unlock schedule access.";

      Alert.alert(
        "Restored",
        `${restoreMessage}${churchNote}`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (error: any) {
      Alert.alert(
        "Restore failed",
        String(error?.message || "Could not restore purchases.")
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
          paddingTop: insets.top + 18,
          paddingBottom: insets.bottom + 150,
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
            <Text style={s.churchName}>GLORY CITY CHURCH</Text>
<Text style={s.title}>Confirm plan</Text>
            <Text style={s.sub}>Premium access for your church</Text>
          </View>
        </View>

        <View style={s.hero}>
          <View pointerEvents="none" style={s.heroGlow} />
          <View style={s.heroTopRow}>
            <View style={s.heroMiniLeft}>
              <View style={s.heroIconWrap}>
                <Ionicons name="card" size={18} color="rgba(255,215,145,0.98)" />
              </View>
              <View>
                <Text style={s.heroEyebrow}>SELECTED PLAN</Text>
                <Text style={s.heroTitle}>{planData.title}</Text>
              </View>
            </View>

            <View style={s.heroMiniPill}>
              <Text style={s.heroMiniPillText}>MEDIA</Text>
            </View>
          </View>

          <Text style={s.heroPrice}>
            {planData.price}
            <Text style={s.heroCycle}>{planData.cycle}</Text>
          </Text>

          <View style={s.heroDateRow}>
            <Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.72)" />
            <Text style={s.heroDateText}>Starts today</Text>
          </View>

          <Text style={s.heroText}>{planData.note}</Text>

          {loadingPackages ? (
            <View style={s.loadingRow}>
              <ActivityIndicator />
              <Text style={s.loadingText}>Loading checkout package...</Text>
            </View>
          ) : null}

          {checkoutUnavailable ? (
            <View style={s.reviewFallbackCard}>
              <Text style={s.reviewFallbackText}>{SUBSCRIPTION_REVIEW_FALLBACK_MESSAGE}</Text>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [s.reviewFallbackBtn, pressed ? s.pressed : null]}
              >
                <Text style={s.reviewFallbackBtnText}>Continue using Kristo</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={s.summaryCard}>
          <View pointerEvents="none" style={s.summaryGlow} />

          <View style={s.summaryTopRow}>
            <Text style={s.summaryLabel}>WHAT YOU UNLOCK</Text>
            <View style={s.summaryStatePill}>
              <Text style={s.summaryStatePillText}>READY</Text>
            </View>
          </View>
          <Text style={s.metaText}>
            Unlock Media Live, video posts, guest invites, and scheduled church media.
          </Text>

          <View style={s.actionRow}>
            <Pressable
              onPress={handleConfirmCheckout}
              disabled={submitting || loadingPackages || checkoutUnavailable}
              style={({ pressed }) => [
                s.primaryBtn,
                s.primaryBtnMain,
                (submitting || loadingPackages) ? s.disabledBtn : null,
                pressed ? s.pressed : null,
              ]}
            >
              {submitting ? (
                <ActivityIndicator />
              ) : (
                <Text style={s.primaryBtnText}>{confirmLabel}</Text>
              )}
            </Pressable>

            {!isTestStoreRevenueCat ? (
              <Pressable
                onPress={handleRestorePurchases}
                style={({ pressed }) => [
                  s.primaryBtn,
                  s.cancelBtn,
                  pressed ? s.pressed : null,
                ]}
              >
                <Text style={s.cancelBtnText}>Restore Purchases</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={s.footText}>
            {isTestStoreRevenueCat
              ? "Test Store mode • Restore disabled in development"
              : "No charges today • Cancel anytime • No charges today anytime"}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  churchName: {
    textAlign: "center",
    color: "#F4D06F",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 6,
  },
  screen: { flex: 1, backgroundColor: "#0B0F17" },

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
    right: -70,
    bottom: 100,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(255,220,120,0.05)",
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
    marginTop: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  reviewFallbackText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  reviewFallbackBtn: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
  },
  reviewFallbackBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },

  hero: {
    marginHorizontal: 16,
    borderRadius: 34,
    paddingHorizontal: 22,
    paddingVertical: 20,
    backgroundColor: "rgba(8,12,24,0.82)",
    borderWidth: 1.4,
    borderColor: "rgba(244,201,93,0.24)",
    overflow: "hidden",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  heroMiniLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    paddingRight: 10,
  },

  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  heroEyebrow: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },

  heroTitle: {
    marginTop: 4,
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
    lineHeight: 24,
  },

  heroMiniPill: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  heroMiniPillText: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
  },

  heroPrice: {
    marginTop: 18,
    color: "#fff",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: -1.4,
  },

  heroCycle: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 15,
    fontWeight: "800",
  },

  heroDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
  },

  heroDateText: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    fontWeight: "700",
  },

  heroText: {
    marginTop: 10,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13.5,
    lineHeight: 21,
    fontWeight: "600",
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },

  loadingText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12.5,
    fontWeight: "700",
  },

  summaryCard: {
    marginTop: 18,
    marginHorizontal: 16,
    borderRadius: 34,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 22,
    backgroundColor: "rgba(4,9,18,0.92)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.28)",
    overflow: "hidden",
  },

  summaryGlow: {
    position: "absolute",
    right: -42,
    bottom: -42,
    width: 110,
    height: 110,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.018)",
  },

  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  summaryLabel: {
    color: "rgba(255,220,150,0.72)",
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  summaryStatePill: {
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  summaryStatePillText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
  },

  priceSpotlight: {
    marginTop: 16,
  },

  priceSpotlightValue: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
  },

  priceSpotlightCycle: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "800",
  },

  priceSpotlightTitle: {
    marginTop: 5,
    color: "rgba(255,255,255,0.74)",
    fontSize: 13.5,
    fontWeight: "700",
  },

  summaryGrid: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
  },

  infoChip: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  infoChipLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },

  infoChipValue: {
    marginTop: 6,
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },

  divider: {
    marginTop: 16,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  metaText: {
    marginTop: 18,
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "800",
  },

  benefitLine: {
    marginTop: 12,
    color: "rgba(255,224,160,0.92)",
    fontSize: 13.2,
    lineHeight: 22,
    fontWeight: "900",
  },

  benefitGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 14,
  },

  benefitChip: {
    width: "48%",
    minHeight: 42,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(248,209,94,0.075)",
    borderWidth: 1,
    borderColor: "rgba(248,209,94,0.15)",
  },

  benefitText: {
    color: "#fff",
    fontSize: 12.5,
    fontWeight: "900",
  },

  cleanBenefits: {
    marginTop: 14,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "800",
  },

  safeRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 14,
  },

  safeItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },

  safeItemText: {
    color: "rgba(255,255,255,0.80)",
    fontSize: 12,
    fontWeight: "700",
  },

  primaryBtn: {
    minHeight: 58,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  primaryBtnSolo: {
    marginTop: 18,
    backgroundColor: "#F4C56A",
  },

  primaryBtnMain: {
    flex: 1,
    backgroundColor: "#F8D15E",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },

  disabledBtn: {
    opacity: 0.6,
  },

  primaryBtnText: {
    color: "#111",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  actionRow: {
    marginTop: 20,
  },

  cancelBtn: {
    flex: 0.75,
    minWidth: 96,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  cancelBtnText: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "900",
  },

  footText: {
    marginTop: 14,
    color: "rgba(255,255,255,0.38)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
});
