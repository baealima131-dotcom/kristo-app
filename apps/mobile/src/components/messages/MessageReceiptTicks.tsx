import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Delivery state of one of the viewer's own messages, from what the server confirmed only:
 * Sending (not yet saved), Sent (saved), Delivered (the peer's app fetched it), Read (the peer
 * read the chat after it, only when both users allow read receipts).
 */
export type MessageReceiptStatus = "Sending" | "Sent" | "Delivered" | "Read";

export const MESSAGE_TICK_GRAY = "rgba(255,255,255,0.55)";
export const MESSAGE_TICK_READ = "#53BDEB";

export function resolveMessageReceiptStatus(input: {
  pending?: boolean;
  createdAt: number;
  peerDeliveredAt?: number;
  peerReadAt?: number;
  showReadReceipts?: boolean;
}): MessageReceiptStatus {
  if (input.pending) return "Sending";
  const createdAt = Number(input.createdAt || 0) || 0;
  if (input.showReadReceipts && createdAt > 0 && createdAt <= Number(input.peerReadAt || 0)) {
    return "Read";
  }
  if (createdAt > 0 && createdAt <= Number(input.peerDeliveredAt || 0)) return "Delivered";
  return "Sent";
}

/** WhatsApp-style ticks: clock = sending, one gray = sent, two gray = delivered, two blue = read. */
export function MessageReceiptTicks({
  status,
  size = 15,
}: {
  status: MessageReceiptStatus;
  size?: number;
}) {
  return (
    <View accessible accessibilityLabel={status}>
      <Ionicons
        name={status === "Sending" ? "time-outline" : status === "Sent" ? "checkmark" : "checkmark-done"}
        size={size}
        color={status === "Read" ? MESSAGE_TICK_READ : MESSAGE_TICK_GRAY}
      />
    </View>
  );
}
