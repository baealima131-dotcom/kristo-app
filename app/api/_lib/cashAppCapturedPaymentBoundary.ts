import "server-only";

import {
  getPaymentWebhookEvent,
  markPaymentWebhookOrderMatch,
  markPaymentWebhookProcessed,
} from "@/app/api/_lib/store/sokoPaymentWebhookDb";

import {
  findSokoCashAppOrderMatch,
  applyCashAppCapturedPaymentToOrder,
} from "@/app/api/_lib/store/sokoOrdersDb";
import {
  configuredCashAppPartnerEnvironment,
  isFinalSuccessfulCashAppPaymentStatus,
} from "@/app/api/_lib/cashAppPaymentConfirmation";

function clean(
  value: unknown,
  max = 512
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function safeAmountMinor(
  value: unknown
) {
  const number =
    typeof value === "number"
      ? value
      : value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      "Cash App captured payment amount is invalid."
    );
  }

  return number;
}

export type CashAppCapturedPaymentBoundaryResult = {
  eventId: string;
  orderId: string;
  providerPaymentId: string;
  providerReference: string;
  amountMinor: number;
  currency: "USD";
  applied: boolean;
  alreadyApplied: boolean;
  processed: true;
};

/**
 * Trusted server-only boundary for a Cash App
 * payment.status.updated CAPTURED event that has
 * ALREADY passed webhook signature verification
 * and has ALREADY been stored.
 *
 * IMPORTANT:
 *
 * - no raw/mobile payment identity is accepted;
 * - all provider identity is re-read from DB;
 * - event must be Cash App + CAPTURED;
 * - exact bound provider payment ID is mandatory;
 * - exact amount/currency/order match is mandatory;
 * - webhook event/order binding is immutable;
 * - order transition is atomic/idempotent;
 * - processed=true is written only after successful
 *   application/idempotent confirmation.
 *
 * This function has intentionally NO route caller yet.
 */
export async function applyStoredCashAppCapturedWebhook(
  input: {
    eventId: string;
  }
): Promise<CashAppCapturedPaymentBoundaryResult> {
  const eventId =
    clean(
      input.eventId,
      180
    );

  if (!eventId) {
    throw new Error(
      "Cash App webhook event ID is required."
    );
  }

  /*
   * Re-read first-seen provider evidence.
   * Never trust the current retry body here.
   */
  const stored =
    await getPaymentWebhookEvent({
      eventId,
      provider:
        "cash_app",
    });

  if (!stored) {
    throw new Error(
      "Stored Cash App webhook event was not found."
    );
  }

  const storedEventId =
    clean(
      stored.id,
      180
    );

  const provider =
    clean(
      stored.provider,
      40
    ).toLowerCase();

  const eventType =
    clean(
      stored.event_type,
      120
    ).toLowerCase();

  const paymentStatus =
    clean(
      stored.payment_status,
      80
    ).toUpperCase();

  const providerPaymentId =
    clean(
      stored.provider_payment_id,
      180
    );

  const providerReference =
    clean(
      stored.transaction_reference,
      180
    );

  const sellerUserId =
    clean(
      stored.seller_user_id,
      180
    );

  const currency =
    clean(
      stored.currency,
      12
    ).toUpperCase();

  const payloadDigest =
    clean(
      stored.payload_sha256,
      64
    ).toLowerCase();

  if (
    storedEventId !== eventId ||
    provider !== "cash_app"
  ) {
    throw new Error(
      "Cash App stored webhook identity mismatch."
    );
  }

  const eventEnvironment = clean(
    (stored as { event_environment?: string }).event_environment,
    20
  ).toLowerCase();
  const configuredEnvironment =
    configuredCashAppPartnerEnvironment();

  if (
    (eventEnvironment || "production") !==
    configuredEnvironment
  ) {
    throw new Error(
      "Cash App webhook environment mismatch."
    );
  }

  /*
   * Require the exact event family we know how to apply.
   * Case normalization is only for comparison.
   */
  if (
    eventType !==
      "payment.status.updated"
  ) {
    throw new Error(
      "Unsupported Cash App webhook event type."
    );
  }

  if (
    !isFinalSuccessfulCashAppPaymentStatus(
      paymentStatus
    )
  ) {
    throw new Error(
      "Cash App payment is not CAPTURED."
    );
  }

  /*
   * Provider payment identity must have already been
   * created by Cash App and bound to the order.
   */
  if (
    !providerPaymentId ||
    !providerPaymentId.startsWith(
      "PWC_"
    )
  ) {
    throw new Error(
      "Cash App captured provider payment ID is invalid."
    );
  }

  if (
    currency !== "USD"
  ) {
    throw new Error(
      "Cash App captured payment currency is invalid."
    );
  }

  /*
   * Require a digest from the signature-verified
   * first-seen payload. Legacy pre-digest rows are
   * deliberately not auto-approved.
   */
  if (
    !/^[0-9a-f]{64}$/.test(
      payloadDigest
    )
  ) {
    throw new Error(
      "Cash App webhook payload digest is unavailable."
    );
  }

  const amountMinor =
    safeAmountMinor(
      stored.amount_minor
    );

  /*
   * Match only against an order that already has the
   * exact trusted provider payment identity.
   */
  const matched =
    await findSokoCashAppOrderMatch({
      sellerUserId:
        sellerUserId ||
        undefined,

      amountMinor,

      currency,

      providerPaymentId,

      providerReference:
        providerReference ||
        undefined,
    });

  if (
    !matched ||
    !matched.id
  ) {
    throw new Error(
      "Cash App CAPTURED payment does not uniquely match an order."
    );
  }

  const orderId =
    clean(
      matched.id,
      180
    );

  if (!orderId) {
    throw new Error(
      "Cash App matched order identity is invalid."
    );
  }

  /*
   * If the event was previously matched, it must
   * point to this exact same order.
   */
  const previousMatchedOrderId =
    clean(
      stored.matched_order_id,
      180
    );

  if (
    previousMatchedOrderId &&
    previousMatchedOrderId !==
      orderId
  ) {
    throw new Error(
      "Cash App webhook event is already matched to another order."
    );
  }

  const marked =
    await markPaymentWebhookOrderMatch({
      eventId,
      orderId,
    });

  if (!marked) {
    throw new Error(
      "Cash App webhook/order match could not be persisted."
    );
  }

  /*
   * Atomic order transition.
   *
   * This helper independently re-checks:
   * order ID, seller, provider, PWC ID,
   * reference, amount, currency and status.
   */
  const transition =
    await applyCashAppCapturedPaymentToOrder({
      orderId,
      amountMinor,
      currency,
      providerPaymentId,
      providerReference:
        providerReference ||
        undefined,
      sellerUserId:
        sellerUserId ||
        undefined,
    });

  if (
    !transition ||
    (
      transition.applied !== true &&
      transition.alreadyApplied !== true
    )
  ) {
    throw new Error(
      "Cash App captured payment was not applied."
    );
  }

  /*
   * Only after successful/idempotent order application
   * may the webhook event become processed.
   */
  const processed =
    await markPaymentWebhookProcessed({
      eventId,
      orderId,
    });

  if (!processed) {
    throw new Error(
      "Cash App webhook could not be marked processed."
    );
  }

  return {
    eventId,
    orderId,
    providerPaymentId,
    providerReference,
    amountMinor,
    currency:
      "USD",
    applied:
      transition.applied ===
      true,
    alreadyApplied:
      transition.alreadyApplied ===
      true,
    processed:
      true,
  };
}
