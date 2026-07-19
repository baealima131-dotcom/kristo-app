import React from "react";
import { Stack } from "expo-router";
import { MessagesLockGate } from "@/src/components/messageSettings/MessagesLockGate";

/**
 * Full Messages subtree gate: inbox, threads, calls, live-room,
 * settings, media-storage, appointments.
 */
export default function MessagesSubtreeLayout() {
  return (
    <MessagesLockGate>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "default",
          contentStyle: { backgroundColor: "#07090F" },
        }}
      />
    </MessagesLockGate>
  );
}
