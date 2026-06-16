import React, { useEffect, useState } from "react";
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
} from "../../../src/store/paymentsStore";

const SUBSCRIPTIONS_HREF = "/more/payments/subscriptions";

export default function PaymentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [paymentsState, setPaymentsState] = useState(() => getPaymentsState());

  useEffect(() => {
    return subscribePayments(() => {
      setPaymentsState(getPaymentsState());
    });
  }, []);

  const subscriptionsActive = paymentsState.currentModule === "subscriptions";

  const openSubscriptions = () => {
    setPaymentsCurrentModule("subscriptions");
    router.push(SUBSCRIPTIONS_HREF as any);
  };

  return (
    <View style={s.screen}>
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
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
            <Text style={s.subtitle}>Subscriptions</Text>
          </View>
        </View>

        <View style={s.contentWrap}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Subscriptions</Text>
            <Text style={s.sectionSub}>Manage your V1 premium access</Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              s.cardWrap,
              pressed ? ({ opacity: 0.92, transform: [{ scale: 0.985 }] } as any) : null,
            ]}
          >
            <View style={[s.card, subscriptionsActive ? s.cardActive : null]}>
              <View style={s.cardTop}>
                <View style={s.iconPill}>
                  <Ionicons name="diamond-outline" size={20} color="rgba(255,170,210,0.98)" />
                </View>

                <View style={[s.badge, subscriptionsActive ? s.badgeActive : null]}>
                  <Text style={s.badgeText}>Core</Text>
                </View>
              </View>

              <Text style={s.cardTitle}>Subscriptions</Text>
              <Text style={s.cardSub}>Trial, monthly and yearly plans.</Text>

              <View style={s.cardFoot}>
                <View style={s.divider} />

                <Pressable
                  onPress={openSubscriptions}
                  style={({ pressed }) => [
                    s.moduleBtn,
                    subscriptionsActive ? s.moduleBtnActive : null,
                    pressed ? ({ opacity: 0.9, transform: [{ scale: 0.98 }] } as any) : null,
                  ]}
                >
                  <Text style={s.moduleBtnText}>Open</Text>
                  <Ionicons name="arrow-forward" size={16} color="#111" />
                </Pressable>
              </View>
            </View>
          </Pressable>
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

  contentWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },

  sectionHead: {
    marginBottom: 16,
    alignItems: "center",
  },

  sectionTitle: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.28,
    textAlign: "center",
  },

  sectionSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.44)",
    fontSize: 11.5,
    fontWeight: "800",
    textAlign: "center",
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
    paddingHorizontal: 22,
    paddingVertical: 24,
    minHeight: 210,
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
    width: 48,
    height: 48,
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
    marginTop: 16,
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  cardSub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },

  cardFoot: {
    marginTop: 16,
  },

  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 16,
    marginTop: 8,
  },

  moduleBtn: {
    minHeight: 52,
    paddingHorizontal: 24,
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
});
