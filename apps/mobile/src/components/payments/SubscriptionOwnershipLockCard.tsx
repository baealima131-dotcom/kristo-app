import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChurchMediaSubscriptionOwnershipLock } from "../../lib/churchSubscriptionMediaSignals";

type Props = {
  lock: ChurchMediaSubscriptionOwnershipLock;
};

export function SubscriptionOwnershipLockCard({ lock }: Props) {
  const message =
    String(lock.message || "").trim() ||
    "This Kristo ID already has an active subscription for another church.";

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.iconWrap}>
          <Ionicons name="lock-closed-outline" size={18} color="rgba(196,171,114,0.95)" />
        </View>
        <View style={s.headerCopy}>
          <Text style={s.title}>Subscription already active elsewhere</Text>
          <Text style={s.subtitle}>One store subscription per Kristo ID for Media Premium</Text>
        </View>
      </View>
      <Text style={s.message}>{message}</Text>
      <Text style={s.footerNote}>
        Creating a new church does not move your App Store or Google Play subscription.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(196,171,114,0.28)",
    backgroundColor: "rgba(18,16,12,0.88)",
    padding: 16,
    gap: 12,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196,171,114,0.12)",
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    lineHeight: 18,
  },
  message: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    lineHeight: 21,
  },
  footerNote: {
    color: "rgba(196,171,114,0.82)",
    fontSize: 12,
    lineHeight: 18,
  },
});
