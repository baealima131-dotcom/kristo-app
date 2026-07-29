import "react-native-gesture-handler";
import "@/src/components/homeFeed/homeFeedRowsCache";
import "@/src/components/homeFeed/homeFeedDisplayOrderCache";
import { kickoffHomeFeedDisplayOrderCacheHydrate } from "@/src/components/homeFeed/homeFeedDisplayOrderCache";

kickoffHomeFeedDisplayOrderCacheHydrate();

import React, { useCallback, useLayoutEffect, useState } from "react";
import { Slot } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Cinzel_600SemiBold } from "@expo-google-fonts/cinzel/600SemiBold";
import { KristoSessionProvider, useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  ensurePurchasesConfigured,
  logAndroidBillingConfigDiagnostics,
  logRevenueCatException,
} from "@/src/lib/payments/mobileSubscriptions";
import { isRevenueCatPurchasingDisabled } from "@/src/lib/subscriptionBypass";
import { Platform } from "react-native";
import { runAfterHomeDeferredStartup } from "@/src/lib/homeFeedDeferredStartup";
import JujujuAnimatedSplash, { SPLASH_BG } from "@/src/components/JujujuAnimatedSplash";
import { HomeFeedVideoPrimer } from "@/src/components/homeFeed/HomeFeedVideoPrimer";
import { isHomeFeedInlineVideoAutoplayEnabled } from "@/src/lib/homeFeedVideoMode";
import { SafetyAccountEnforcementGate } from "@/src/components/SafetyAccountEnforcementGate";
import { CINZEL_SEMIBOLD_FAMILY } from "@/src/lib/cinzelFont";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RevenueCatBootstrap() {
  const { loading } = useKristoSession();
  const bypassRevenueCat = isRevenueCatPurchasingDisabled();

  React.useEffect(() => {
    if (bypassRevenueCat || loading) return;

    runAfterHomeDeferredStartup(() => {
      if (Platform.OS === "android") {
        logAndroidBillingConfigDiagnostics("app-boot");
      }
      ensurePurchasesConfigured().catch((error) => {
        logRevenueCatException("app-boot-configure", error);
      });
    }, { reason: "revenuecat-configure" });
  }, [bypassRevenueCat, loading]);

  return <Slot />;
}

export default function RootLayout() {
  const [splashFinished, setSplashFinished] = useState(false);
  const onSplashFinished = useCallback(() => setSplashFinished(true), []);
  const [fontsLoaded, fontError] = useFonts({
    [CINZEL_SEMIBOLD_FAMILY]: Cinzel_600SemiBold,
  });

  useLayoutEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useLayoutEffect(() => {
    if (fontsLoaded) {
      console.log("KRISTO_CINZEL_FONT_LOADED", { family: CINZEL_SEMIBOLD_FAMILY });
    } else if (fontError) {
      console.warn("KRISTO_CINZEL_FONT_LOAD_ERROR", {
        family: CINZEL_SEMIBOLD_FAMILY,
        message: String((fontError as any)?.message || fontError || "unknown"),
      });
    }
  }, [fontsLoaded, fontError]);

  // Hold splash until Cinzel registers — never render Watch with a system fallback.
  if (!fontsLoaded) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: SPLASH_BG }}>
        <JujujuAnimatedSplash onFinished={onSplashFinished} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: SPLASH_BG }}>
      {!splashFinished ? <JujujuAnimatedSplash onFinished={onSplashFinished} /> : null}
      <KristoSessionProvider>
        <RevenueCatBootstrap />
        <SafetyAccountEnforcementGate />
      </KristoSessionProvider>
      {/* Hidden primer — inline TikTok-style autoplay only. */}
      {isHomeFeedInlineVideoAutoplayEnabled() ? <HomeFeedVideoPrimer /> : null}
    </GestureHandlerRootView>
  );
}
