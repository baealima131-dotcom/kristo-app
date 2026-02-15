import React from "react";
import { Stack } from "expo-router";
import { VIP } from "@/src/ui/vipTheme";

export default function MinistriesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: VIP.colors.bg },
      }}
    />
  );
}
