import Stripe from "stripe";

import {
  cleanStripeText,
  stripeModeFromSecretKey,
  stripeModesMatch,
} from "./sokoStripeCheckout";

let stripeClient: Stripe | null = null;
let stripeClientKey = "";

export function getStripeSecretKey(
  env: NodeJS.ProcessEnv = process.env
) {
  return cleanStripeText(env.STRIPE_SECRET_KEY, 256);
}

export function getStripeWebhookSecret(
  env: NodeJS.ProcessEnv = process.env
) {
  return cleanStripeText(env.STRIPE_WEBHOOK_SECRET, 256);
}

export function getStripePublishableKeyFromServerEnv(
  env: NodeJS.ProcessEnv = process.env
) {
  return cleanStripeText(
    env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    256
  );
}

export function sokoStripeServerConfigured(
  env: NodeJS.ProcessEnv = process.env
) {
  const secret = getStripeSecretKey(env);
  const webhook = getStripeWebhookSecret(env);
  const publishable = getStripePublishableKeyFromServerEnv(env);
  const seller = cleanStripeText(env.SOKO_STRIPE_SELLER_USER_ID, 180);

  if (
    !stripeModeFromSecretKey(secret) ||
    !webhook ||
    !seller
  ) {
    return false;
  }

  if (publishable && !stripeModesMatch(publishable, secret)) {
    return false;
  }

  return true;
}

export function getStripeClient(
  env: NodeJS.ProcessEnv = process.env
) {
  const secret = getStripeSecretKey(env);
  if (!stripeModeFromSecretKey(secret)) {
    throw new Error("Card checkout is not configured yet.");
  }

  if (!stripeClient || stripeClientKey !== secret) {
    stripeClient = new Stripe(secret, {
      timeout: 25000,
      maxNetworkRetries: 1,
    });
    stripeClientKey = secret;
  }

  return stripeClient;
}

export function verifyStripeWebhookEvent(input: {
  rawBody: string;
  signature: string;
  webhookSecret?: string;
  stripe?: Stripe;
}) {
  const secret =
    input.webhookSecret || getStripeWebhookSecret();
  if (!secret) {
    throw new Error("Card checkout is not configured yet.");
  }

  const client = input.stripe || getStripeClient();
  return client.webhooks.constructEvent(
    input.rawBody,
    input.signature,
    secret
  );
}
