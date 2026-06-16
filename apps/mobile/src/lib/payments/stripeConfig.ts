import Constants from "expo-constants";

const extra =
  (Constants.expoConfig?.extra as Record<string, string | undefined> | undefined) || {};

export const STRIPE_PUBLISHABLE_KEY = extra.stripePublishableKey || "";
export const STRIPE_MERCHANT_IDENTIFIER =
  extra.stripeMerchantIdentifier || "merchant.com.princefariji.kristoapp";
