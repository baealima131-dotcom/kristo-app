import "react-native-gesture-handler";
import "@/src/components/homeFeed/homeFeedRowsCache";
import "@/src/components/homeFeed/homeFeedDisplayOrderCache";
import { kickoffHomeFeedDisplayOrderCacheHydrate } from "@/src/components/homeFeed/homeFeedDisplayOrderCache";

kickoffHomeFeedDisplayOrderCacheHydrate();

import React, { useCallback, useLayoutEffect, useState } from "react";
import { Slot } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
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

  useLayoutEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: SPLASH_BG }}>
      {!splashFinished ? <JujujuAnimatedSplash onFinished={onSplashFinished} /> : null}
      <KristoSessionProvider>
        <RevenueCatBootstrap />
      </KristoSessionProvider>
      {/* Hidden primer — inline TikTok-style autoplay only. */}
      {isHomeFeedInlineVideoAutoplayEnabled() ? <HomeFeedVideoPrimer /> : null}
    </GestureHandlerRootView>
  );
}
