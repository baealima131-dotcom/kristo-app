import React from "react";
import { Stack } from "expo-router";
import { VIP } from "@/src/ui/vipTheme";

export default function ChurchLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: VIP.colors.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="ministries" />
    </Stack>
  );
}
