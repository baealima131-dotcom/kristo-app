import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getPaymentsState,
  setDonationActiveModule,
  setDonationCustomAmount,
  setDonationGivingType,
  setDonationSelectedAmount,
  setPaymentsCurrentModule,
  subscribePayments,
  type DonationModuleKey,
  type GivingType,
} from "../../../../src/store/paymentsStore";

const MODULES: {
  key: DonationModuleKey;
  title: string;
  sub: string;
  badge: string;
  cta: string;
}[] = [
  {
    key: "tithes",
    title: "Tithes",
    sub: "Personal tithe giving flow with simple confirmation",
    badge: "Tithe",
    cta: "Open tithe",
  },
  {
    key: "offerings",
    title: "Offerings",
    sub: "General offerings for church meetings and services",
    badge: "Offer",
    cta: "Open offering",
  },
  {
    key: "campaigns",
    title: "Campaigns",
    sub: "Mission support • special fundraising • urgent needs",
    badge: "Support",
    cta: "Open campaign",
  },
];

const GIVING_TYPES: { key: GivingType; title: string }[] = [
  { key: "tithe", title: "Tithe" },
  { key: "offering", title: "Offering" },
  { key: "support", title: "Support" },
];

const AMOUNT_PRESETS = [5, 10, 25, 50, 100, 250];


export default function PaymentsDonationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());

  useEffect(() => {
    setPaymentsCurrentModule("donations");
    return subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });
  }, []);

  const givingType = paymentsState.donations.givingType;
  const selectedAmount = paymentsState.donations.selectedAmount;
  const customAmount = paymentsState.donations.customAmount;
  const activeModule = paymentsState.donations.activeModule;

  const currentLabel = useMemo(() => {
    return givingType === "tithe"
      ? "Tithe"
      : givingType === "offering"
      ? "Offering"
      : "Support";
  }, [givingType]);

  const finalAmount = useMemo(() => {
    return selectedAmount === -1 ? customAmount : selectedAmount;
  }, [selectedAmount, customAmount]);

  const activeModuleTitle =
    activeModule === "tithes"
      ? "Tithes"
      : activeModule === "offerings"
      ? "Offerings"
      : "Campaigns";

  const activeModuleText =
    activeModule === "tithes"
      ? "Hapa tuna-focus flow ya tithe, confirmation, na simple giving steps kwa user."
      : activeModule === "offerings"
      ? "Hapa tuna-focus general offering flow ya services, meetings, na church moments."
      : "Hapa tuna-focus support campaigns, mission goals, na special fundraising structure.";


  return (
    <View style={s.screen}>
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 18,
          paddingBottom: insets.bottom + 28,
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
            <Text style={s.title}>Donations</Text>
            <Text style={s.sub}>Tithes • offerings • support campaigns</Text>
          </View>
        </View>

        <View style={s.hero}>
          <View style={s.heroIconWrap}>
            <Ionicons name="heart" size={22} color="rgba(255,170,210,0.98)" />
          </View>

          <Text style={s.heroTitle}>Giving center</Text>
          <Text style={s.heroText}>
            Hapa tutaweka tithes, offerings, mission support, special campaigns,
            receipts, na donation flows safi za church ndani ya Kristo App.
          </Text>

          <View style={s.heroPillRow}>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Tithe</Text>
            </View>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Offering</Text>
            </View>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Support</Text>
            </View>
          </View>
        </View>

        <View style={s.currentGivingCard}>
          <View style={s.currentGivingTop}>
            <Text style={s.currentGivingLabel}>CURRENT GIVING</Text>
            <View style={s.liveBadge}>
              <Text style={s.liveBadgeText}>{currentLabel}</Text>
            </View>
          </View>

          <Text style={s.currentGivingAmount}>${finalAmount}</Text>
          <Text style={s.currentGivingText}>
            Selected flow: {currentLabel}. Hii ni preview ya amount ambayo user
            anaenda kutoa kwenye giving flow.
          </Text>
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Choose giving type</Text>
          <Text style={s.sectionSub}>User anaweza kubadili aina ya kutoa hapa</Text>
        </View>

        <View style={s.typeRow}>
          {GIVING_TYPES.map((item) => {
            const active = item.key === givingType;
            return (
              <Pressable
                key={item.key}
                onPress={() => setDonationGivingType(item.key)}
                style={({ pressed }) => [
                  s.typePill,
                  active ? s.typePillActive : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <Text style={[s.typePillText, active ? s.typePillTextActive : null]}>
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Quick amounts</Text>
          <Text style={s.sectionSub}>Preset cards za haraka kwa giving flow</Text>
        </View>

        <View style={s.amountGrid}>
          {AMOUNT_PRESETS.map((amount) => {
            const active = selectedAmount === amount;
            return (
              <Pressable
                key={amount}
                onPress={() => setDonationSelectedAmount(amount)}
                style={({ pressed }) => [
                  s.amountCard,
                  active ? s.amountCardActive : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <Text style={[s.amountCardValue, active ? s.amountCardValueActive : null]}>
                  ${amount}
                </Text>
                <Text style={[s.amountCardSub, active ? s.amountCardSubActive : null]}>
                  Quick give
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Custom amount preview</Text>
          <Text style={s.sectionSub}>Temporary demo controls without input field</Text>
        </View>

        <View style={s.customCard}>
          <Text style={s.customTitle}>Custom amount</Text>
          <Text style={s.customAmount}>${customAmount}</Text>
          <Text style={s.customSub}>
            Hapa baadaye tunaweza kuweka real input ya user kuandika amount yake.
          </Text>

          <View style={s.customActionRow}>
            <Pressable
              onPress={() => {
                setDonationSelectedAmount(-1);
                setDonationCustomAmount(25);
              }}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>$25</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setDonationSelectedAmount(-1);
                setDonationCustomAmount(75);
              }}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>$75</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setDonationSelectedAmount(-1);
                setDonationCustomAmount(150);
              }}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>$150</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>3</Text>
            <Text style={s.statLabel}>Giving flows</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>1</Text>
            <Text style={s.statLabel}>History center</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>∞</Text>
            <Text style={s.statLabel}>Campaign ideas</Text>
          </View>
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Donation modules</Text>
          <Text style={s.sectionSub}>Core giving experiences we can build</Text>
        </View>

        <View style={s.grid}>
          {MODULES.map((item) => {
            const active = item.key === activeModule;
            return (
              <View key={item.key} style={s.cardWrap}>
                <View style={[s.card, active ? s.cardActive : null]}>
                  <View style={s.cardTop}>
                    <View style={[s.badge, active ? s.badgeActive : null]}>
                      <Text style={s.badgeText}>{item.badge}</Text>
                    </View>
                  </View>

                  <Text style={s.cardTitle}>{item.title}</Text>
                  <Text style={s.cardSub}>{item.sub}</Text>

                  <View style={s.cardFoot}>
                    <View style={s.divider} />
                    <Pressable
                      onPress={() => setDonationActiveModule(item.key)}
                      style={({ pressed }) => [
                        s.moduleBtn,
                        active ? s.moduleBtnActive : null,
                        pressed ? s.pressed : null,
                      ]}
                    >
                      <Text style={s.moduleBtnText}>{active ? "Opened" : item.cta}</Text>
                      <Ionicons
                        name={active ? "checkmark-circle" : "arrow-forward"}
                        size={14}
                        color="rgba(255,214,234,0.96)"
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Module detail</Text>
          <Text style={s.sectionSub}>Working area for the selected giving module</Text>
        </View>

        <View style={s.detailCard}>
          <View style={s.detailTop}>
            <Text style={s.detailLabel}>ACTIVE MODULE</Text>
            <View style={s.detailBadge}>
              <Text style={s.detailBadgeText}>{activeModuleTitle}</Text>
            </View>
          </View>

          <Text style={s.detailTitle}>{activeModuleTitle}</Text>
          <Text style={s.detailText}>{activeModuleText}</Text>

          {activeModule === "tithes" ? (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Tithe confirmation flow</Text>
              <Text style={s.detailItem}>• Repeat giving support</Text>
              <Text style={s.detailItem}>• Clean success receipt after payment</Text>
            </View>
          ) : activeModule === "offerings" ? (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Service offering flow</Text>
              <Text style={s.detailItem}>• Fast amount pick for members</Text>
              <Text style={s.detailItem}>• Offering history and summary</Text>
            </View>
          ) : (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Campaign goal card</Text>
              <Text style={s.detailItem}>• Mission and urgent support buckets</Text>
              <Text style={s.detailItem}>• Progress and supporter visibility</Text>
            </View>
          )}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Quick actions</Text>
        </View>

        <View style={s.quickRow}>
          <Pressable style={({ pressed }) => [s.quickCard, pressed ? s.pressed : null]}>
            <Ionicons name="wallet" size={16} color="rgba(255,170,210,0.98)" />
            <Text style={s.quickTitle}>Start church giving</Text>
            <Text style={s.quickSub}>Prepare a clean tithe and offering flow</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [s.quickCard, pressed ? s.pressed : null]}>
            <Ionicons name="receipt" size={16} color="rgba(255,170,210,0.98)" />
            <Text style={s.quickTitle}>Enable receipts</Text>
            <Text style={s.quickSub}>Track donations and payment confirmations</Text>
          </Pressable>
        </View>

        <View style={s.nextBlock}>
          <Text style={s.nextTitle}>Next step</Text>
          <Text style={s.nextText}>
            Baada ya UI hii, tunaweza kuunganisha real amount input, payment
            submit flow, receipt generation, na donation history.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B0F17" },

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
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 18,
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

  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },

  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.4,
  },

  sub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
  },

  hero: {
    marginHorizontal: 16,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },

  heroIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(72,28,54,0.40)",
    borderWidth: 1,
    borderColor: "rgba(228,120,176,0.24)",
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
    backgroundColor: "rgba(255,120,190,0.11)",
    borderWidth: 1,
    borderColor: "rgba(228,120,176,0.18)",
  },

  heroPillText: {
    color: "rgba(255,214,234,0.96)",
    fontSize: 11,
    fontWeight: "800",
  },

  currentGivingCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.085)",
  },

  currentGivingTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  currentGivingLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },

  liveBadge: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,120,190,0.12)",
    borderWidth: 1,
    borderColor: "rgba(228,120,176,0.22)",
  },

  liveBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  currentGivingAmount: {
    marginTop: 12,
    color: "rgba(255,214,234,0.98)",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  currentGivingText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
  },

  sectionHead: {
    paddingHorizontal: 16,
    marginTop: 22,
    marginBottom: 14,
  },

  sectionTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.18,
  },

  sectionSub: {
    marginTop: 5,
    color: "rgba(255,255,255,0.58)",
    fontSize: 11.5,
    fontWeight: "700",
  },

  typeRow: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  typePill: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  typePillActive: {
    backgroundColor: "rgba(255,120,190,0.12)",
    borderColor: "rgba(228,120,176,0.22)",
  },

  typePillText: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    fontWeight: "800",
  },

  typePillTextActive: {
    color: "#fff",
  },

  amountGrid: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },

  amountCard: {
    width: "30.8%",
    minHeight: 88,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.034)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  amountCardActive: {
    backgroundColor: "rgba(255,120,190,0.11)",
    borderColor: "rgba(228,120,176,0.20)",
  },

  amountCardValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.18,
  },

  amountCardValueActive: {
    color: "rgba(255,214,234,0.98)",
  },

  amountCardSub: {
    marginTop: 5,
    color: "rgba(255,255,255,0.56)",
    fontSize: 10.5,
    fontWeight: "700",
  },

  amountCardSubActive: {
    color: "rgba(255,214,234,0.82)",
  },

  customCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  customTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },

  customAmount: {
    marginTop: 10,
    color: "rgba(255,214,234,0.98)",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.24,
  },

  customSub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
  },

  customActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },

  smallActionBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  smallActionBtnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },

  statsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 16,
  },

  statCard: {
    flex: 1,
    minHeight: 84,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.034)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  statValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
  },

  statLabel: {
    marginTop: 6,
    color: "rgba(255,255,255,0.58)",
    fontSize: 10.5,
    fontWeight: "700",
    textAlign: "center",
  },

  grid: {
    paddingHorizontal: 16,
    gap: 15,
    paddingBottom: 6,
  },

  cardWrap: {
    borderRadius: 26,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 9,
  },

  card: {
    minHeight: 164,
    borderRadius: 26,
    paddingHorizontal: 17,
    paddingVertical: 17,
    backgroundColor: "rgba(255,255,255,0.034)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.075)",
  },

  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  badge: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  badgeText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.55,
  },

  cardTitle: {
    marginTop: 15,
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.18,
  },

  cardSub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
  },

  cardFoot: {
    marginTop: "auto",
  },

  divider: {
    marginTop: 15,
    marginBottom: 10,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.065)",
  },

  moduleBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,120,190,0.11)",
    borderWidth: 1,
    borderColor: "rgba(228,120,176,0.18)",
  },

  moduleBtnText: {
    color: "rgba(255,214,234,0.96)",
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.15,
  },

  quickRow: {
    paddingHorizontal: 16,
    gap: 12,
  },

  quickCard: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "rgba(255,255,255,0.034)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  quickTitle: {
    marginTop: 10,
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },

  quickSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },

  nextBlock: {
    marginTop: 18,
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  nextTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 8,
  },

  nextText: {
    color: "rgba(255,255,255,0.70)",
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: "600",
  },

  cardActive: {
    backgroundColor: "rgba(255,120,190,0.05)",
    borderColor: "rgba(228,120,176,0.16)",
  },

  badgeActive: {
    backgroundColor: "rgba(255,120,190,0.12)",
    borderColor: "rgba(228,120,176,0.20)",
  },

  moduleBtnActive: {
    backgroundColor: "rgba(255,120,190,0.16)",
    borderColor: "rgba(228,120,176,0.24)",
  },

  detailCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  detailTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  detailLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },

  detailBadge: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,120,190,0.12)",
    borderWidth: 1,
    borderColor: "rgba(228,120,176,0.20)",
  },

  detailBadgeText: {
    color: "rgba(255,214,234,0.98)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  detailTitle: {
    marginTop: 12,
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.18,
  },

  detailText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: "600",
  },

  detailList: {
    marginTop: 14,
    gap: 8,
  },

  detailItem: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
  },
});
