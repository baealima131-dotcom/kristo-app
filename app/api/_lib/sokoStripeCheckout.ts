import { createHash } from "node:crypto";

export const SOKO_STRIPE_PAYMENT_METHOD = "stripe_card" as const;
export const SOKO_STRIPE_PROVIDER = "stripe" as const;

const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

export type StripeKeyMode = "test" | "live";

export type SokoStripeSellerGateInput = {
  sellerUserId: string;
  buyerUserId: string;
  productStatus: string;
  stockAvailable?: number;
  currency: string;
  allowedSellerUserId: string;
  supportedCurrencies?: string[];
};

export type SokoStripeSellerGateResult =
  | { ok: true }
  | { ok: false; code: string; error: string };

export function cleanStripeText(value: unknown, max = 180) {
  return String(value || "").trim().slice(0, max);
}

export function configuredSokoStripeSellerUserId(
  env: NodeJS.ProcessEnv = process.env
) {
  return cleanStripeText(env.SOKO_STRIPE_SELLER_USER_ID, 180);
}

export function stripeModeFromSecretKey(secretKey: string): StripeKeyMode | null {
  const key = cleanStripeText(secretKey, 256);
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return null;
}

export function stripeModeFromPublishableKey(
  publishableKey: string
): StripeKeyMode | null {
  const key = cleanStripeText(publishableKey, 256);
  if (key.startsWith("pk_test_")) return "test";
  if (key.startsWith("pk_live_")) return "live";
  return null;
}

export function stripeModesMatch(
  publishableKey: string,
  secretKey: string
) {
  const publishableMode = stripeModeFromPublishableKey(publishableKey);
  const secretMode = stripeModeFromSecretKey(secretKey);
  return Boolean(
    publishableMode &&
    secretMode &&
    publishableMode === secretMode
  );
}

export function eventModeMatchesSecret(
  livemode: boolean,
  secretKey: string
) {
  const secretMode = stripeModeFromSecretKey(secretKey);
  if (!secretMode) return false;
  return livemode ? secretMode === "live" : secretMode === "test";
}

export function isSokoStripeSupportedCurrency(
  currency: string,
  supported = ["USD"]
) {
  const code = cleanStripeText(currency, 10).toUpperCase();
  return supported.includes(code);
}

export function toStripeAmountMinor(
  amountMajor: number,
  currency: string
) {
  const code = cleanStripeText(currency, 10).toUpperCase();
  if (!code || !Number.isFinite(amountMajor) || amountMajor <= 0) {
    return null;
  }

  const minor = ZERO_DECIMAL.has(code)
    ? Math.round(amountMajor)
    : Math.round(amountMajor * 100);

  if (!Number.isSafeInteger(minor) || minor <= 0) {
    return null;
  }

  return minor;
}

export function assertSokoStripeSellerGate(
  input: SokoStripeSellerGateInput
): SokoStripeSellerGateResult {
  const sellerUserId = cleanStripeText(input.sellerUserId, 180);
  const buyerUserId = cleanStripeText(input.buyerUserId, 180);
  const allowedSellerUserId = cleanStripeText(
    input.allowedSellerUserId,
    180
  );
  const productStatus = cleanStripeText(input.productStatus, 40);
  const currency = cleanStripeText(input.currency, 10).toUpperCase();
  const supported = input.supportedCurrencies?.length
    ? input.supportedCurrencies.map((item) =>
        cleanStripeText(item, 10).toUpperCase()
      )
    : ["USD"];

  if (!allowedSellerUserId) {
    return {
      ok: false,
      code: "STRIPE_SELLER_UNCONFIGURED",
      error: "Card checkout is not configured yet.",
    };
  }

  if (!sellerUserId || sellerUserId !== allowedSellerUserId) {
    return {
      ok: false,
      code: "STRIPE_SELLER_NOT_ALLOWED",
      error: "Card checkout is only available for this seller.",
    };
  }

  if (buyerUserId && sellerUserId === buyerUserId) {
    return {
      ok: false,
      code: "STRIPE_OWN_PRODUCT",
      error: "You cannot buy your own product.",
    };
  }

  if (productStatus !== "Active") {
    return {
      ok: false,
      code: "STRIPE_PRODUCT_UNAVAILABLE",
      error: "This product is no longer available.",
    };
  }

  if (
    typeof input.stockAvailable === "number" &&
    Number.isFinite(input.stockAvailable) &&
    input.stockAvailable <= 0
  ) {
    return {
      ok: false,
      code: "STRIPE_PRODUCT_UNAVAILABLE",
      error: "This product is no longer available.",
    };
  }

  if (!isSokoStripeSupportedCurrency(currency, supported)) {
    return {
      ok: false,
      code: "STRIPE_CURRENCY_UNSUPPORTED",
      error: "This currency cannot be charged on the configured card account.",
    };
  }

  return { ok: true };
}

export function sokoStripeCardAvailableOnListing(input: {
  serverConfigured: boolean;
  sellerUserId: string;
  productStatus: string;
  stockAvailable?: number;
  currency: string;
  allowedSellerUserId: string;
}) {
  if (!input.serverConfigured) {
    return false;
  }

  return assertSokoStripeSellerGate({
    sellerUserId: input.sellerUserId,
    buyerUserId: "",
    productStatus: input.productStatus,
    stockAvailable: input.stockAvailable,
    currency: input.currency,
    allowedSellerUserId: input.allowedSellerUserId,
  }).ok;
}

export function opaqueBuyerReference(buyerUserId: string) {
  const id = cleanStripeText(buyerUserId, 180);
  if (!id) return "";
  return createHash("sha256")
    .update(`soko-stripe-buyer:${id}`)
    .digest("hex")
    .slice(0, 24);
}

export function stripePaymentIntentIdempotencyKey(
  orderId: string,
  retry = 0
) {
  const id = cleanStripeText(orderId, 100);
  if (!id) {
    throw new Error("Stripe order ID is required.");
  }
  if (retry > 0) {
    return `soko-stripe-card:${id}:r${retry}`.slice(0, 255);
  }
  return `soko-stripe-card:${id}`.slice(0, 255);
}

export function isReusableStripePaymentIntentStatus(
  status: string
) {
  return [
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "processing",
  ].includes(cleanStripeText(status, 40));
}

export function isTerminalFailedStripePaymentIntentStatus(
  status: string
) {
  return ["canceled", "cancelled"].includes(
    cleanStripeText(status, 40).toLowerCase()
  );
}

export function canApproveSokoStripePayment(input: {
  orderStatus: string;
  orderPaymentMethod: string;
  orderProvider: string;
  storedPaymentIntentId: string;
  eventPaymentIntentId: string;
  metadataOrderId: string;
  orderId: string;
  amountReceived: number;
  orderAmountMinor: number;
  eventCurrency: string;
  orderCurrency: string;
  orderSellerUserId: string;
  allowedSellerUserId: string;
  livemode: boolean;
  secretKey: string;
  paymentIntentAlreadyUsedOnOtherOrder: boolean;
}) {
  if (input.paymentIntentAlreadyUsedOnOtherOrder) {
    return {
      ok: false as const,
      code: "STRIPE_PAYMENT_INTENT_REUSED",
      error: "This payment already belongs to another order.",
    };
  }

  if (
    input.orderPaymentMethod !== SOKO_STRIPE_PAYMENT_METHOD ||
    (input.orderProvider &&
      input.orderProvider !== SOKO_STRIPE_PROVIDER)
  ) {
    return {
      ok: false as const,
      code: "STRIPE_ORDER_METHOD_MISMATCH",
      error: "Order is not a card checkout.",
    };
  }

  if (input.orderStatus !== "awaiting_payment") {
    if (
      [
        "payment_approved",
        "preparing_shipment",
        "shipped",
        "delivered",
      ].includes(input.orderStatus)
    ) {
      return {
        ok: false as const,
        code: "STRIPE_ALREADY_APPROVED",
        error: "Order is already paid.",
        alreadyApproved: true,
      };
    }

    return {
      ok: false as const,
      code: "STRIPE_ORDER_NOT_AWAITING",
      error: "Order is not awaiting payment.",
    };
  }

  const stored = cleanStripeText(input.storedPaymentIntentId, 180);
  const eventPi = cleanStripeText(input.eventPaymentIntentId, 180);
  if (!stored || !eventPi || stored !== eventPi) {
    return {
      ok: false as const,
      code: "STRIPE_PAYMENT_INTENT_MISMATCH",
      error: "Payment does not match this order.",
    };
  }

  const metadataOrderId = cleanStripeText(input.metadataOrderId, 180);
  const orderId = cleanStripeText(input.orderId, 180);
  if (!metadataOrderId || metadataOrderId !== orderId) {
    return {
      ok: false as const,
      code: "STRIPE_METADATA_ORDER_MISMATCH",
      error: "Payment metadata does not match this order.",
    };
  }

  if (
    !Number.isSafeInteger(input.amountReceived) ||
    input.amountReceived !== input.orderAmountMinor
  ) {
    return {
      ok: false as const,
      code: "STRIPE_AMOUNT_MISMATCH",
      error: "Paid amount does not match the order.",
    };
  }

  const eventCurrency = cleanStripeText(input.eventCurrency, 10).toUpperCase();
  const orderCurrency = cleanStripeText(input.orderCurrency, 10).toUpperCase();
  if (!eventCurrency || eventCurrency !== orderCurrency) {
    return {
      ok: false as const,
      code: "STRIPE_CURRENCY_MISMATCH",
      error: "Paid currency does not match the order.",
    };
  }

  const sellerGate = assertSokoStripeSellerGate({
    sellerUserId: input.orderSellerUserId,
    buyerUserId: "",
    productStatus: "Active",
    currency: orderCurrency,
    allowedSellerUserId: input.allowedSellerUserId,
  });

  if (!sellerGate.ok) {
    return sellerGate;
  }

  if (!eventModeMatchesSecret(input.livemode, input.secretKey)) {
    return {
      ok: false as const,
      code: "STRIPE_MODE_MISMATCH",
      error: "Stripe test/live mode does not match this environment.",
    };
  }

  return { ok: true as const };
}

export function redactStripeKey(value: unknown) {
  const key = cleanStripeText(value, 256);
  if (!key) return "";
  const prefix = key.slice(0, 8);
  return `${prefix}…`;
}
