import "react-native-gesture-handler";

import React, { useCallback, useLayoutEffect, useState } from "react";
import { Slot } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { KristoSessionProvider, useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  ensurePurchasesConfigured,
  prefetchSubscriptionOfferings,
  syncPurchasesAppUser,
} from "@/src/lib/payments/mobileSubscriptions";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";
import { deferStartupWorkAfterHomeFirstFrame } from "@/src/lib/firstPaint";
import JujujuAnimatedSplash, { SPLASH_BG } from "@/src/components/JujujuAnimatedSplash";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RevenueCatBootstrap() {
  const { session, loading } = useKristoSession();
  const bypassRevenueCat = isSubscriptionBypassEnabled();

  React.useEffect(() => {
    if (bypassRevenueCat) return;

    ensurePurchasesConfigured().catch((error) => {
      console.log("RevenueCat boot configure error", error);
    });
  }, [bypassRevenueCat]);

  React.useEffect(() => {
    if (bypassRevenueCat || loading) return;

    const appUserId = String(session?.userId || "").trim();
    if (!appUserId) return;

    syncPurchasesAppUser(appUserId)
      .then(() => {
        deferStartupWorkAfterHomeFirstFrame(
          async () => {
            await prefetchSubscriptionOfferings();
          },
          { reason: "revenuecat-offerings" }
        );
      })
      .catch((error) => {
        console.log("RevenueCat logIn error", error);
      });
  }, [bypassRevenueCat, loading, session?.userId]);

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
    </GestureHandlerRootView>
  );
}
