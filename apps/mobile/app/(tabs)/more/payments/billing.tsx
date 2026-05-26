import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getPaymentsState,
  setBillingActiveModule,
  setBillingFinanceMode,
  setBillingFinanceStatus,
  setPaymentsCurrentModule,
  subscribePayments,
  type BillingModuleKey,
  type FinanceMode,
  type FinanceStatus,
} from "../../../../src/store/paymentsStore";

const MODULES: {
  key: BillingModuleKey;
  title: string;
  sub: string;
  badge: string;
  cta: string;
}[] = [
  {
    key: "transactions",
    title: "Transactions",
    sub: "See payment history, records, and finance activity",
    badge: "History",
    cta: "Open history",
  },
  {
    key: "invoices",
    title: "Invoices",
    sub: "Church invoices, billing references, and payment documents",
    badge: "Invoice",
    cta: "Open invoices",
  },
  {
    key: "payouts",
    title: "Payouts",
    sub: "Track outgoing funds, payout status, and settlement flow",
    badge: "Payout",
    cta: "Open payouts",
  },
];

const FINANCE_MODES: { key: FinanceMode; title: string }[] = [
  { key: "transactions", title: "Transactions" },
  { key: "invoices", title: "Invoices" },
  { key: "payouts", title: "Payouts" },
];

const SUMMARY_CARDS = [
  {
    key: "income",
    title: "Income",
    value: "$4,250",
    sub: "This month",
    tone: "blue" as const,
  },
  {
    key: "fees",
    title: "Fees",
    value: "$185",
    sub: "Processing + platform",
    tone: "soft" as const,
  },
  {
    key: "payout",
    title: "Next payout",
    value: "$2,900",
    sub: "Scheduled Friday",
    tone: "violet" as const,
  },
];

export default function PaymentsBillingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());

  useEffect(() => {
    setPaymentsCurrentModule("billing");
    return subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });
  }, []);

  const financeMode = paymentsState.billing.financeMode;
  const financeStatus = paymentsState.billing.financeStatus;
  const activeModule = paymentsState.billing.activeModule;

  const currentTitle =
    financeMode === "transactions"
      ? "Transactions"
      : financeMode === "invoices"
      ? "Invoices"
      : "Payouts";

  const currentText = useMemo(() => {
    if (financeMode === "transactions") {
      return "Hapa tuna-preview payment history, records, na total finance activity.";
    }
    if (financeMode === "invoices") {
      return "Hapa tuna-preview invoice references, billing documents, na receipt structure.";
    }
    return "Hapa tuna-preview payout tracking, settlement state, na outgoing money flow.";
  }, [financeMode]);

  const statusTone =
    financeStatus === "healthy"
      ? [s.statusBadge, s.statusBadgeHealthy]
      : financeStatus === "delayed"
      ? [s.statusBadge, s.statusBadgeDelayed]
      : [s.statusBadge, s.statusBadgeReview];

  const statusText =
    financeStatus === "healthy"
      ? "HEALTHY"
      : financeStatus === "delayed"
      ? "DELAYED"
      : "REVIEW";

  const activeModuleTitle =
    activeModule === "transactions"
      ? "Transactions"
      : activeModule === "invoices"
      ? "Invoices"
      : "Payouts";

  const activeModuleText =
    activeModule === "transactions"
      ? "Hapa tuna-control history ya malipo, finance activity, na records za kila transaction."
      : activeModule === "invoices"
      ? "Hapa tuna-control invoice references, billing documents, receipts, na payment paperwork."
      : "Hapa tuna-control payout tracking, settlement state, na outgoing money flow.";

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
            <Text style={s.title}>Billing</Text>
            <Text style={s.sub}>Payouts • invoices • transaction history</Text>
          </View>
        </View>

        <View style={s.hero}>
          <View style={s.heroIconWrap}>
            <Ionicons name="receipt" size={22} color="rgba(176,198,255,0.98)" />
          </View>

          <Text style={s.heroTitle}>Billing and records</Text>
          <Text style={s.heroText}>
            Hapa tutaweka transaction history, invoices, receipts, payout
            tracking, financial summary, na records zote za payment system.
          </Text>

          <View style={s.heroPillRow}>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>History</Text>
            </View>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Invoices</Text>
            </View>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Payouts</Text>
            </View>
          </View>
        </View>

        <View style={s.currentCard}>
          <View style={s.currentTop}>
            <Text style={s.currentLabel}>CURRENT FINANCE VIEW</Text>
            <View style={statusTone}>
              <Text style={s.statusBadgeText}>{statusText}</Text>
            </View>
          </View>

          <Text style={s.currentTitle}>{currentTitle}</Text>
          <Text style={s.currentText}>{currentText}</Text>

          <View style={s.currentActionRow}>
            <Pressable
              onPress={() => setBillingFinanceStatus("healthy")}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>Healthy</Text>
            </Pressable>

            <Pressable
              onPress={() => setBillingFinanceStatus("review")}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>Review</Text>
            </Pressable>

            <Pressable
              onPress={() => setBillingFinanceStatus("delayed")}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>Delayed</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Finance summary</Text>
          <Text style={s.sectionSub}>Top overview cards for billing dashboard</Text>
        </View>

        <View style={s.summaryGrid}>
          {SUMMARY_CARDS.map((item) => {
            const toneStyle =
              item.tone === "violet"
                ? s.summaryCardViolet
                : item.tone === "blue"
                ? s.summaryCardBlue
                : s.summaryCardSoft;

            return (
              <View key={item.key} style={[s.summaryCard, toneStyle]}>
                <Text style={s.summaryTitle}>{item.title}</Text>
                <Text style={s.summaryValue}>{item.value}</Text>
                <Text style={s.summarySub}>{item.sub}</Text>
              </View>
            );
          })}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Choose finance mode</Text>
          <Text style={s.sectionSub}>Switch between billing sections</Text>
        </View>

        <View style={s.modeRow}>
          {FINANCE_MODES.map((item) => {
            const active = item.key === financeMode;
            return (
              <Pressable
                key={item.key}
                onPress={() => setBillingFinanceMode(item.key)}
                style={({ pressed }) => [
                  s.modePill,
                  active ? s.modePillActive : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <Text style={[s.modePillText, active ? s.modePillTextActive : null]}>
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Finance preview</Text>
          <Text style={s.sectionSub}>Demo box for selected finance mode</Text>
        </View>

        <View style={s.previewCard}>
          <View style={s.previewRow}>
            <View style={s.previewDot} />
            <Text style={s.previewTitle}>{currentTitle}</Text>
          </View>
          <Text style={s.previewText}>{currentText}</Text>
        </View>

        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>3</Text>
            <Text style={s.statLabel}>Finance modules</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>1</Text>
            <Text style={s.statLabel}>Summary layer</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>24/7</Text>
            <Text style={s.statLabel}>Tracking</Text>
          </View>
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Billing modules</Text>
          <Text style={s.sectionSub}>Core finance views we can build next</Text>
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
                      onPress={() => setBillingActiveModule(item.key)}
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
                        color="rgba(224,232,255,0.96)"
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
          <Text style={s.sectionSub}>Working area for the selected billing module</Text>
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

          {activeModule === "transactions" ? (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Full transaction history and activity list</Text>
              <Text style={s.detailItem}>• Filters by date, type, and church event</Text>
              <Text style={s.detailItem}>• Clean total summary for incoming payments</Text>
            </View>
          ) : activeModule === "invoices" ? (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Invoice number and reference flow</Text>
              <Text style={s.detailItem}>• Receipt and billing document storage</Text>
              <Text style={s.detailItem}>• Printable finance proof for records</Text>
            </View>
          ) : (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Payout status tracking</Text>
              <Text style={s.detailItem}>• Settlement timeline and delay states</Text>
              <Text style={s.detailItem}>• Outgoing money visibility per payout</Text>
            </View>
          )}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Quick actions</Text>
        </View>

        <View style={s.quickRow}>
          <Pressable style={({ pressed }) => [s.quickCard, pressed ? s.pressed : null]}>
            <Ionicons name="document-text" size={16} color="rgba(176,198,255,0.98)" />
            <Text style={s.quickTitle}>Open billing summary</Text>
            <Text style={s.quickSub}>See receipts, invoices, and totals</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [s.quickCard, pressed ? s.pressed : null]}>
            <Ionicons name="swap-horizontal" size={16} color="rgba(176,198,255,0.98)" />
            <Text style={s.quickTitle}>Track payouts</Text>
            <Text style={s.quickSub}>Follow outgoing money and payout state</Text>
          </Pressable>
        </View>

        <View style={s.nextBlock}>
          <Text style={s.nextTitle}>Next step</Text>
          <Text style={s.nextText}>
            Baada ya UI hii, tunaweza kupanga transaction model, invoice fields,
            receipt format, na payout tracking logic.
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
    backgroundColor: "rgba(126,146,255,0.10)",
  },

  glowBottomRight: {
    position: "absolute",
    right: -50,
    bottom: 60,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(120,160,255,0.08)",
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
    backgroundColor: "rgba(34,40,92,0.40)",
    borderWidth: 1,
    borderColor: "rgba(176,198,255,0.24)",
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
    backgroundColor: "rgba(126,146,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(176,198,255,0.18)",
  },

  heroPillText: {
    color: "rgba(224,232,255,0.96)",
    fontSize: 11,
    fontWeight: "800",
  },

  currentCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
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

  statusBadge: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  statusBadgeHealthy: {
    backgroundColor: "rgba(16,185,129,0.14)",
    borderColor: "rgba(16,185,129,0.24)",
  },

  statusBadgeReview: {
    backgroundColor: "rgba(245,158,11,0.14)",
    borderColor: "rgba(245,158,11,0.24)",
  },

  statusBadgeDelayed: {
    backgroundColor: "rgba(255,90,90,0.12)",
    borderColor: "rgba(255,90,90,0.22)",
  },

  statusBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  currentTitle: {
    marginTop: 12,
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.24,
  },

  currentText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
  },

  currentActionRow: {
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

  summaryGrid: {
    paddingHorizontal: 16,
    gap: 12,
  },

  summaryCard: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
  },

  summaryCardSoft: {
    backgroundColor: "rgba(255,255,255,0.035)",
    borderColor: "rgba(255,255,255,0.07)",
  },

  summaryCardBlue: {
    backgroundColor: "rgba(126,146,255,0.08)",
    borderColor: "rgba(176,198,255,0.16)",
  },

  summaryCardViolet: {
    backgroundColor: "rgba(160,120,255,0.08)",
    borderColor: "rgba(200,180,255,0.16)",
  },

  summaryTitle: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 12,
    fontWeight: "800",
  },

  summaryValue: {
    marginTop: 10,
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.24,
  },

  summarySub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.60)",
    fontSize: 12,
    fontWeight: "600",
  },

  modeRow: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  modePill: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  modePillActive: {
    backgroundColor: "rgba(126,146,255,0.12)",
    borderColor: "rgba(176,198,255,0.20)",
  },

  modePillText: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    fontWeight: "800",
  },

  modePillTextActive: {
    color: "#fff",
  },

  previewCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  previewDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(176,198,255,0.98)",
  },

  previewTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },

  previewText: {
    marginTop: 10,
    color: "rgba(255,255,255,0.70)",
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: "600",
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

  cardActive: {
    backgroundColor: "rgba(126,146,255,0.055)",
    borderColor: "rgba(176,198,255,0.16)",
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

  badgeActive: {
    backgroundColor: "rgba(126,146,255,0.12)",
    borderColor: "rgba(176,198,255,0.20)",
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
    backgroundColor: "rgba(126,146,255,0.11)",
    borderWidth: 1,
    borderColor: "rgba(176,198,255,0.18)",
  },

  moduleBtnActive: {
    backgroundColor: "rgba(126,146,255,0.18)",
    borderColor: "rgba(176,198,255,0.28)",
  },

  moduleBtnText: {
    color: "rgba(224,232,255,0.96)",
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

  detailCard: {
    marginTop: 2,
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 18,
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
    backgroundColor: "rgba(126,146,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(176,198,255,0.20)",
  },

  detailBadgeText: {
    color: "rgba(224,232,255,0.98)",
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
});
