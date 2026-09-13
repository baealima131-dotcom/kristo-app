import React from "react";
import { StripeProvider } from "@stripe/stripe-react-native";

import {
  STRIPE_URL_SCHEME,
  getExpoStripePublishableKey,
  isExpoStripePublishableConfigured,
} from "@/src/lib/payments/stripeConfig";

export function SokoStripeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const publishableKey = getExpoStripePublishableKey();

  return (
    <StripeProvider
      publishableKey={
        isExpoStripePublishableConfigured()
          ? publishableKey
          : "pk_test_soko_card_checkout_unconfigured"
      }
      urlScheme={STRIPE_URL_SCHEME}
    >
      <>{children}</>
    </StripeProvider>
  );
}
