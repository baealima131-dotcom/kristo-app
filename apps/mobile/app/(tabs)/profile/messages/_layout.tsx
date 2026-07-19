import React from "react";
import { Stack } from "expo-router";
import { MessagesLockGate } from "@/src/components/messageSettings/MessagesLockGate";

/** Profile message aliases — same Kristo Message Lock gate as church-room tree. */
export default function ProfileMessagesLayout() {
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
