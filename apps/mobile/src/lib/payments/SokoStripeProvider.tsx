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

  if (!isExpoStripePublishableConfigured()) {
    return <>{children}</>;
  }

  return (
    <StripeProvider
      publishableKey={publishableKey}
      urlScheme={STRIPE_URL_SCHEME}
    >
      <>{children}</>
    </StripeProvider>
  );
}
