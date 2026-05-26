import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getPaymentsState,
  setPaymentsCurrentModule,
  subscribePayments,
  type PaymentMainModuleKey,
} from "../../../src/store/paymentsStore";

type PaymentCard = {
  key: PaymentMainModuleKey;
  title: string;
  sub: string;
  badge: string;
  cta: string;
  status: string;
  href: string;
  iconLib: "ion" | "mci";
  icon: any;
};

const PAYMENT_CARDS: PaymentCard[] = [
  {
    key: "subscriptions",
    title: "Subscriptions",
    sub: "Plans",
    badge: "Core",
    cta: "Open plans",
    status: "Open premium",
    href: "/more/payments/subscriptions",
    iconLib: "ion",
    icon: "diamond-outline",
  },
  {
    key: "billing",
    title: "Billing",
    sub: "Records",
    badge: "Records",
    cta: "Open",
    status: "Open records",
    href: "/more/payments/billing",
    iconLib: "ion",
    icon: "receipt-outline",
  },
];

export default function PaymentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());

  useEffect(() => {
    return subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });
  }, []);

  const currentModule = paymentsState.currentModule;

  const currentModuleTitle = useMemo(() => {
    return currentModule === "billing" ? "Billing" : "Subscriptions";
  }, [currentModule]);

  const currentModuleText = useMemo(() => {
    return currentModule === "billing"
      ? "Open records and plan status for V1."
      : "Church premium plans, free trial, monthly, and yearly access.";
  }, [currentModule]);

  return (
    <View style={s.screen}>
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 18,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={s.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              s.backBtn,
              pressed ? ({ opacity: 0.88, transform: [{ scale: 0.97 }] } as any) : null,
            ]}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>

          <View style={s.headerTextWrap}>
            <Text style={s.title}>V1 Payments</Text>
            <Text style={s.subtitle}>Subscriptions • Billing</Text>
          </View>
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Subscriptions</Text>
          <Text style={s.sectionSub}>Manage your V1 premium access</Text>
        </View>

        <View style={s.grid}>
          {PAYMENT_CARDS.map((item) => {
            const active = item.key === currentModule;

            return (
              <Pressable
                key={item.key}
                style={({ pressed }) => [
                  s.cardWrap,
                  pressed ? ({ opacity: 0.92, transform: [{ scale: 0.985 }] } as any) : null,
                ]}
              >
                <View style={[s.card, active ? s.cardActive : null]}>
                  <View style={s.cardTop}>
                    <View style={s.iconPill}>
                      <Ionicons name={item.icon} size={18} color="rgba(255,170,210,0.98)" />
                    </View>

                    <View style={[s.badge, active ? s.badgeActive : null]}>
                      <Text style={s.badgeText}>{item.badge}</Text>
                    </View>
                  </View>

                  <Text style={s.cardTitle}>{item.title}</Text>
                  
                  <Text style={s.cardSub}>
                    {item.key === "subscriptions" ? "Trial, monthly and yearly plans." : "Payment status and history."}
                  </Text>

                  <View style={s.cardFoot}>
                    <View style={s.divider} />

                    <Pressable
                      onPress={() => {
                        setPaymentsCurrentModule(item.key);
                        router.push(item.href as any);
                      }}
                      style={({ pressed }) => [
                        s.moduleBtn,
                        active ? s.moduleBtnActive : null,
                        pressed ? ({ opacity: 0.9, transform: [{ scale: 0.98 }] } as any) : null,
                      ]}
                    >
                      <Text style={s.moduleBtnText}>{active ? "Open" : item.cta}</Text>
                      <Ionicons name="arrow-forward" size={16} color="#111" />
                    </Pressable>

                    <Text style={s.cardHint}>{item.status}</Text>
                  </View>
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
  screen: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },

  glowTopLeft: {
    position: "absolute",
    top: -40,
    left: -30,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(255,120,190,0.10)",
  },

  glowBottomRight: {
    position: "absolute",
    right: -50,
    bottom: 60,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(120,80,255,0.08)",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    marginBottom: 26,
    gap: 12,
  },

  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  headerTextWrap: {
    flex: 1,
  },

  title: {
    color: "#fff",
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: -0.35,
  },

  subtitle: {
    marginTop: 2,
    color: "rgba(255,255,255,0.46)",
    fontSize: 11,
    fontWeight: "800",
  },

  heroCard: {
    marginHorizontal: 16,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  heroIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,120,190,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,170,210,0.20)",
  },

  heroTitle: {
    marginTop: 16,
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.24,
  },

  heroText: {
    marginTop: 9,
    color: "rgba(255,255,255,0.74)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },

  heroPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 16,
  },

  heroPill: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,120,190,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,170,210,0.16)",
  },

  heroPillText: {
    color: "rgba(255,214,234,0.96)",
    fontSize: 11,
    fontWeight: "800",
  },

  currentCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.085)",
  },

  currentTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  currentLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },

  currentBadge: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,120,190,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,170,210,0.18)",
  },

  currentBadgeText: {
    color: "rgba(255,214,234,0.98)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  currentTitle: {
    marginTop: 12,
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.24,
  },

  currentText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: "600",
  },

  sectionHead: {
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 12,
  },

  sectionTitle: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.28,
  },

  sectionSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.44)",
    fontSize: 11.5,
    fontWeight: "800",
  },

  grid: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 24,
  },

  cardWrap: {
    borderRadius: 28,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 9,
  },

  card: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 18,
    minHeight: 165,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.45)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },

  cardActive: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: "rgba(244,201,93,0.45)",
  },

  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  iconPill: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },

  badge: {
    minHeight: 28,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  badgeActive: {
    backgroundColor: "rgba(255,120,190,0.12)",
    borderColor: "rgba(255,170,210,0.20)",
  },

  badgeText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.55,
  },

  cardTitle: {
    marginTop: 14,
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  cardSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },

  cardFoot: {
    marginTop: 12,
  },

  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 14,
    marginTop: 6,
  },

  cardActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  moduleBtn: {
    minHeight: 50,
    paddingHorizontal: 22,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
    backgroundColor: "#F4C95D",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },

  moduleBtnActive: {
    opacity: 1,
  },

  moduleBtnText: {
    color: "#111",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.25,
  },

  cardHint: {
    display: "none",
  },
});
