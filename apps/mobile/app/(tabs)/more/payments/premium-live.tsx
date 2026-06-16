import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getPaymentsState,
  setPaymentsCurrentModule,
  setPremiumLiveActiveModule,
  setPremiumLiveEventType,
  setPremiumLiveGateState,
  setPremiumLiveTicketTier,
  subscribePayments,
  type EventType,
  type GateState,
  type PremiumLiveModuleKey,
  type PremiumLiveTicketTierKey,
} from "../../../../src/store/paymentsStore";

const MODULES: {
  key: PremiumLiveModuleKey;
  title: string;
  sub: string;
  badge: string;
  cta: string;
}[] = [
  {
    key: "tickets",
    title: "Paid Event Tickets",
    sub: "Special church events with ticket access before join",
    badge: "Tickets",
    cta: "Open tickets",
  },
  {
    key: "rooms",
    title: "Premium Rooms",
    sub: "Private live rooms for paid access and selected audience",
    badge: "Rooms",
    cta: "Open rooms",
  },
  {
    key: "access",
    title: "Access Check",
    sub: "Verify payment status before a user enters premium live",
    badge: "Access",
    cta: "Open check",
  },
];

const EVENT_TYPES: { key: EventType; title: string }[] = [
  { key: "service", title: "Service" },
  { key: "conference", title: "Conference" },
  { key: "concert", title: "Concert" },
];

const TICKET_TIERS: {
  key: PremiumLiveTicketTierKey;
  title: string;
  price: string;
  sub: string;
  tone: "soft" | "blue" | "cyan";
}[] = [
  {
    key: "standard",
    title: "Standard",
    price: "$5",
    sub: "Normal paid entry for most viewers",
    tone: "soft" as const,
  },
  {
    key: "vip",
    title: "VIP",
    price: "$15",
    sub: "Premium access with stronger privileges",
    tone: "blue" as const,
  },
  {
    key: "partner",
    title: "Partner",
    price: "$30",
    sub: "Support tier with premium church event access",
    tone: "cyan" as const,
  },
];

export default function PaymentsPremiumLiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());

  useEffect(() => {
    setPaymentsCurrentModule("premium_live");
    return subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });
  }, []);

  const eventType = paymentsState.premiumLive.eventType;
  const ticketTier = paymentsState.premiumLive.ticketTier;
  const gateState = paymentsState.premiumLive.gateState;
  const activeModule = paymentsState.premiumLive.activeModule;

  const selectedTier = useMemo(
    () => TICKET_TIERS.find((item) => item.key === ticketTier) || TICKET_TIERS[1],
    [ticketTier]
  );

  const currentEventLabel =
    eventType === "service"
      ? "Service"
      : eventType === "concert"
      ? "Concert"
      : "Conference";

  const gateTone =
    gateState === "open"
      ? [s.gateBadge, s.gateBadgeOpen]
      : gateState === "closed"
      ? [s.gateBadge, s.gateBadgeClosed]
      : [s.gateBadge, s.gateBadgePreview];

  const gateText =
    gateState === "open" ? "OPEN" : gateState === "closed" ? "CLOSED" : "PREVIEW";

  const activeModuleTitle =
    activeModule === "tickets"
      ? "Paid Event Tickets"
      : activeModule === "rooms"
      ? "Premium Rooms"
      : "Access Check";

  const activeModuleText =
    activeModule === "tickets"
      ? "Hapa tuna-control ticket tiers, paid event entry, na pricing ya premium live event."
      : activeModule === "rooms"
      ? "Hapa tuna-control private room access, selected audience, na premium room visibility."
      : "Hapa tuna-control verification flow kabla user hajaingia premium live room.";

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
            <Text style={s.title}>Premium Live</Text>
            <Text style={s.sub}>Paid live access • premium rooms • special events</Text>
          </View>
        </View>

        <View style={s.hero}>
          <View style={s.heroIconWrap}>
            <Ionicons name="radio" size={22} color="rgba(120,210,255,0.98)" />
          </View>

          <Text style={s.heroTitle}>Premium live access</Text>
          <Text style={s.heroText}>
            Hapa tutaweka ticketed live, exclusive broadcasts, premium rooms,
            paid special events, na access verification kabla user hajaingia.
          </Text>

          <View style={s.heroPillRow}>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Tickets</Text>
            </View>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Premium</Text>
            </View>
            <View style={s.heroPill}>
              <Text style={s.heroPillText}>Access</Text>
            </View>
          </View>
        </View>

        <View style={s.currentCard}>
          <View style={s.currentTop}>
            <Text style={s.currentLabel}>CURRENT PREMIUM EVENT</Text>
            <View style={gateTone}>
              <Text style={s.gateBadgeText}>{gateText}</Text>
            </View>
          </View>

          <Text style={s.currentTitle}>{currentEventLabel}</Text>
          <Text style={s.currentPrice}>
            {selectedTier.title} <Text style={s.currentCycle}>• {selectedTier.price}</Text>
          </Text>
          <Text style={s.currentText}>
            Current gate preview inaonyesha jinsi user ataonekana kabla ya kuingia
            premium live room.
          </Text>

          <View style={s.currentActionRow}>
            <Pressable
              onPress={() => setPremiumLiveGateState("closed")}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>Closed</Text>
            </Pressable>

            <Pressable
              onPress={() => setPremiumLiveGateState("preview")}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>Preview</Text>
            </Pressable>

            <Pressable
              onPress={() => setPremiumLiveGateState("open")}
              style={({ pressed }) => [s.smallActionBtn, pressed ? s.pressed : null]}
            >
              <Text style={s.smallActionBtnText}>Open</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Choose event type</Text>
          <Text style={s.sectionSub}>Select kind of premium live experience</Text>
        </View>

        <View style={s.typeRow}>
          {EVENT_TYPES.map((item) => {
            const active = item.key === eventType;
            return (
              <Pressable
                key={item.key}
                onPress={() => setPremiumLiveEventType(item.key)}
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
          <Text style={s.sectionTitle}>Ticket tiers</Text>
          <Text style={s.sectionSub}>Pick the paid tier to preview access</Text>
        </View>

        <View style={s.tierGrid}>
          {TICKET_TIERS.map((item) => {
            const active = item.key === ticketTier;
            const toneStyle =
              item.tone === "cyan"
                ? s.tierCardCyan
                : item.tone === "blue"
                ? s.tierCardBlue
                : s.tierCardSoft;

            return (
              <Pressable
                key={item.key}
                onPress={() => setPremiumLiveTicketTier(item.key)}
                style={({ pressed }) => [
                  s.tierCard,
                  toneStyle,
                  active ? s.tierCardSelected : null,
                  pressed ? s.pressed : null,
                ]}
              >
                <View style={s.tierCardTop}>
                  <Text style={s.tierTitle}>{item.title}</Text>
                  {active ? (
                    <View style={s.selectedDotWrap}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  ) : null}
                </View>

                <Text style={s.tierPrice}>{item.price}</Text>
                <Text style={s.tierSub}>{item.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Gate preview</Text>
          <Text style={s.sectionSub}>Simple demo of paid access states</Text>
        </View>

        <View style={s.gatePreviewCard}>
          <View style={s.gatePreviewRow}>
            <View style={s.gatePreviewDot} />
            <Text style={s.gatePreviewTitle}>Access state: {gateText}</Text>
          </View>

          <Text style={s.gatePreviewText}>
            {gateState === "open"
              ? "User mwenye ticket sahihi anaweza kuingia premium live room sasa hivi."
              : gateState === "closed"
              ? "Room imefungwa. User hataingia mpaka access ifunguliwe."
              : "Room iko preview mode. User anaweza kuona setup lakini access ya mwisho bado."}
          </Text>
        </View>

        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>3</Text>
            <Text style={s.statLabel}>Core live flows</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>1</Text>
            <Text style={s.statLabel}>Join gate</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>VIP</Text>
            <Text style={s.statLabel}>Experience</Text>
          </View>
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Premium live modules</Text>
          <Text style={s.sectionSub}>Core paid-live experiences to build</Text>
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
                      onPress={() => setPremiumLiveActiveModule(item.key)}
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
                        color="rgba(214,242,255,0.96)"
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
          <Text style={s.sectionSub}>Working area for the selected premium-live module</Text>
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

          {activeModule === "tickets" ? (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Standard / VIP / Partner ticket setup</Text>
              <Text style={s.detailItem}>• Paid event pricing per event type</Text>
              <Text style={s.detailItem}>• Ticket-based join access before live starts</Text>
            </View>
          ) : activeModule === "rooms" ? (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Private premium room visibility</Text>
              <Text style={s.detailItem}>• Selected audience access</Text>
              <Text style={s.detailItem}>• Premium-only room entry and control</Text>
            </View>
          ) : (
            <View style={s.detailList}>
              <Text style={s.detailItem}>• Payment verification before join</Text>
              <Text style={s.detailItem}>• Open / preview / closed gate states</Text>
              <Text style={s.detailItem}>• Access denial when user has no valid ticket</Text>
            </View>
          )}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Quick actions</Text>
        </View>

        <View style={s.quickRow}>
          <Pressable style={({ pressed }) => [s.quickCard, pressed ? s.pressed : null]}>
            <Ionicons name="ticket" size={16} color="rgba(120,210,255,0.98)" />
            <Text style={s.quickTitle}>Create paid event</Text>
            <Text style={s.quickSub}>Prepare a ticketed church live event</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [s.quickCard, pressed ? s.pressed : null]}>
            <Ionicons name="shield-checkmark" size={16} color="rgba(120,210,255,0.98)" />
            <Text style={s.quickTitle}>Gate room entry</Text>
            <Text style={s.quickSub}>Allow only verified paid members</Text>
          </Pressable>
        </View>

        <View style={s.nextBlock}>
          <Text style={s.nextTitle}>Next step</Text>
          <Text style={s.nextText}>
            Baada ya UI hii, tunaweza kupanga event tickets, paid/free gate logic,
            na verification flow kabla ya user kuingia premium live room.
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
    backgroundColor: "rgba(70,170,255,0.10)",
  },

  glowBottomRight: {
    position: "absolute",
    right: -50,
    bottom: 60,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(100,220,255,0.07)",
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
    backgroundColor: "rgba(18,54,84,0.40)",
    borderWidth: 1,
    borderColor: "rgba(120,210,255,0.24)",
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
    backgroundColor: "rgba(70,170,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(120,210,255,0.18)",
  },

  heroPillText: {
    color: "rgba(214,242,255,0.96)",
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

  gateBadge: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  gateBadgeOpen: {
    backgroundColor: "rgba(16,185,129,0.14)",
    borderColor: "rgba(16,185,129,0.24)",
  },

  gateBadgeClosed: {
    backgroundColor: "rgba(255,90,90,0.12)",
    borderColor: "rgba(255,90,90,0.22)",
  },

  gateBadgePreview: {
    backgroundColor: "rgba(70,170,255,0.12)",
    borderColor: "rgba(120,210,255,0.20)",
  },

  gateBadgeText: {
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

  currentPrice: {
    marginTop: 8,
    color: "rgba(214,242,255,0.98)",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.2,
  },

  currentCycle: {
    color: "rgba(214,242,255,0.72)",
    fontSize: 14,
    fontWeight: "700",
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
    backgroundColor: "rgba(70,170,255,0.12)",
    borderColor: "rgba(120,210,255,0.20)",
  },

  typePillText: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    fontWeight: "800",
  },

  typePillTextActive: {
    color: "#fff",
  },

  tierGrid: {
    paddingHorizontal: 16,
    gap: 12,
  },

  tierCard: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
  },

  tierCardSoft: {
    backgroundColor: "rgba(255,255,255,0.035)",
    borderColor: "rgba(255,255,255,0.07)",
  },

  tierCardBlue: {
    backgroundColor: "rgba(70,170,255,0.08)",
    borderColor: "rgba(120,210,255,0.16)",
  },

  tierCardCyan: {
    backgroundColor: "rgba(60,220,255,0.08)",
    borderColor: "rgba(120,230,255,0.16)",
  },

  tierCardSelected: {
    borderColor: "rgba(255,255,255,0.24)",
  },

  tierCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  tierTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },

  selectedDotWrap: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(120,210,255,0.28)",
  },

  tierPrice: {
    marginTop: 10,
    color: "rgba(214,242,255,0.98)",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.2,
  },

  tierSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
  },

  gatePreviewCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  gatePreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  gatePreviewDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(120,210,255,0.98)",
  },

  gatePreviewTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },

  gatePreviewText: {
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
    backgroundColor: "rgba(70,170,255,0.055)",
    borderColor: "rgba(120,210,255,0.16)",
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
    backgroundColor: "rgba(70,170,255,0.12)",
    borderColor: "rgba(120,210,255,0.20)",
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
    backgroundColor: "rgba(70,170,255,0.11)",
    borderWidth: 1,
    borderColor: "rgba(120,210,255,0.18)",
  },

  moduleBtnActive: {
    backgroundColor: "rgba(70,170,255,0.18)",
    borderColor: "rgba(120,210,255,0.28)",
  },

  moduleBtnText: {
    color: "rgba(214,242,255,0.96)",
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
    backgroundColor: "rgba(70,170,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(120,210,255,0.20)",
  },

  detailBadgeText: {
    color: "rgba(214,242,255,0.98)",
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
