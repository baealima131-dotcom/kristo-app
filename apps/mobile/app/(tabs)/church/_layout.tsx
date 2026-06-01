import React, { useCallback } from "react";
import { Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import { VIP } from "@/src/ui/vipTheme";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { runChurchTabPreload } from "@/src/lib/churchTabPreload";

export default function ChurchLayout() {
  const { session } = useKristoSession();

  useFocusEffect(
    useCallback(() => {
      return runChurchTabPreload(session);
    }, [session?.churchId, session?.userId, session?.role, session?.churchRole])
  );

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
