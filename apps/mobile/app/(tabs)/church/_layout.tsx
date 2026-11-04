import React, { useCallback } from "react";
import { Stack, useFocusEffect, usePathname } from "expo-router";
import { VIP } from "@/src/ui/vipTheme";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { runChurchTabPreload } from "@/src/lib/churchTabPreload";
import { isCreateMinistryRoute } from "@/src/lib/createMinistryNavigation";

// Church Overview is the first screen of the Church tab (the old post feed screen is gone).
export const unstable_settings = {
  initialRouteName: "overview",
};

export default function ChurchLayout() {
  const { session } = useKristoSession();
  const pathname = usePathname();

  useFocusEffect(
    useCallback(() => {
      // Opening Create Ministry must not kick a full church tab preload.
      if (isCreateMinistryRoute(pathname)) return;
      return runChurchTabPreload(session);
    }, [pathname, session?.churchId, session?.userId, session?.role, session?.churchRole])
  );

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: VIP.colors.bg },
      }}
    >
      <Stack.Screen name="overview" />
      <Stack.Screen name="index" />
      <Stack.Screen name="ministries" />
      <Stack.Screen name="followers" />
    </Stack>
  );
}
