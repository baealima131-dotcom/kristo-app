import Stripe from "stripe";

export const StripeService = {
  sdk: "stripe",
  versionPinnedInPackageJson: "22.6.2",
  note:
    "SOKO V1 card checkout uses the official Stripe Node SDK. Secrets stay server-side (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET).",
};

export { Stripe };
