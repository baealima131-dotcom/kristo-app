import "react-native-gesture-handler";
import "@/src/components/homeFeed/homeFeedRowsCache";

import React, { useCallback, useLayoutEffect, useState } from "react";
import { Slot } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { KristoSessionProvider, useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  ensurePurchasesConfigured,
} from "@/src/lib/payments/mobileSubscriptions";
import { isRevenueCatPurchasingDisabled } from "@/src/lib/subscriptionBypass";
import JujujuAnimatedSplash, { SPLASH_BG } from "@/src/components/JujujuAnimatedSplash";
import { HomeFeedVideoPrimer } from "@/src/components/homeFeed/HomeFeedVideoPrimer";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RevenueCatBootstrap() {
  const { loading } = useKristoSession();
  const bypassRevenueCat = isRevenueCatPurchasingDisabled();

  React.useEffect(() => {
    if (bypassRevenueCat || loading) return;

    // SDK configure only — login/offerings wait until after first Home video frame.
    ensurePurchasesConfigured().catch((error) => {
      console.log("RevenueCat boot configure error", error);
    });
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
      {/* Hidden, attached VideoView that decode-primes the first Home Feed
          video before Home opens, then hands the decoded player to the row. */}
      <HomeFeedVideoPrimer />
    </GestureHandlerRootView>
  );
}
