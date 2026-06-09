import { useLayoutEffect } from "react";
import { Stack } from "expo-router";
import { markMoreTabFirstPaint } from "@/src/lib/refreshCoordinator";

export default function MoreLayout() {
  useLayoutEffect(() => {
    markMoreTabFirstPaint();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
