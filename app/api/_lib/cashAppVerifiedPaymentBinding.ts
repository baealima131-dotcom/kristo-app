import "server-only";

import {
  parseCashAppCreatePaymentResponse,
  type ParsedCashAppCreatePaymentStatus,
} from "@/app/api/_lib/cashAppCreatePaymentResponse";

import {
  bindSokoOrderProviderPayment,
  getSokoCashAppPaymentContext,
} from "@/app/api/_lib/store/sokoOrdersDb";

import {
  dbGetVerifiedCashAppGrantForOrder,
} from "@/app/api/_lib/store/sokoCashAppCustomerGrantsDb";

export type VerifiedCashAppPaymentBindingResult = {
  orderId: string;
  sellerUserId: string;
  providerPaymentId: string;
  providerReference: string;
  providerStatus:
    ParsedCashAppCreatePaymentStatus;
};

function clean(
  value: unknown,
  max = 512
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

/**
 * Trusted server-only boundary.
 *
 * Raw Cash App Create Payment JSON enters here.
 *
 * Security chain:
 *
 * 1. reload authoritative order;
 * 2. reload provider-verified grant/customer;
 * 3. strictly parse provider response;
 * 4. reject conflicting existing provider identity;
 * 5. bind trusted PWC identity;
 * 6. re-read DB and verify exact persisted identity.
 *
 * IMPORTANT:
 *
 * This DOES NOT mark the order paid.
 * This DOES NOT process CAPTURED webhook.
 * This DOES NOT decrement inventory.
 * This has no public/mobile route caller.
 */
export async function bindVerifiedCashAppCreatePaymentResponse(
  input: {
    orderId: string;
    buyerUserId: string;
    sellerUserId: string;
    merchantId: string;
    referenceId: string;
    response: unknown;
  }
): Promise<VerifiedCashAppPaymentBindingResult> {
  const orderId =
    clean(
      input.orderId,
      180
    );

  const buyerUserId =
    clean(
      input.buyerUserId,
      180
    );

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const merchantId =
    clean(
      input.merchantId,
      180
    );

  const referenceId =
    clean(
      input.referenceId,
      180
    );

  if (
    !orderId ||
    !buyerUserId ||
    !sellerUserId ||
    !merchantId ||
    !referenceId
  ) {
    throw new Error(
      "Cash App provider binding identity is incomplete."
    );
  }

  /*
   * Re-load authoritative order data.
   */
  const context =
    await getSokoCashAppPaymentContext({
      orderId,
      buyerUserId,
    });

  if (
    context.orderId !==
      orderId ||
    context.buyerUserId !==
      buyerUserId ||
    context.sellerUserId !==
      sellerUserId ||
    context.currency
      .toUpperCase() !==
      "USD" ||
    !Number.isSafeInteger(
      context.amountMinor
    ) ||
    context.amountMinor <= 0
  ) {
    throw new Error(
      "Cash App provider binding order identity mismatch."
    );
  }

  /*
   * Re-load provider-verified ONE_TIME_PAYMENT grant.
   */
  const grant =
    await dbGetVerifiedCashAppGrantForOrder({
      buyerUserId,
      referenceId,
      merchantId,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
    });

  if (!grant) {
    throw new Error(
      "Verified Cash App grant is unavailable for provider binding."
    );
  }

  if (
    grant.buyerUserId !==
      buyerUserId ||
    grant.referenceId !==
      referenceId ||
    grant.merchantId !==
      merchantId ||
    grant.amountMinor !==
      context.amountMinor ||
    grant.currency !==
      context.currency.toUpperCase() ||
    grant.actionType !==
      "ONE_TIME_PAYMENT" ||
    grant.status !==
      "ACTIVE" ||
    !grant.grantId ||
    !grant.customerId
  ) {
    throw new Error(
      "Cash App provider binding grant identity mismatch."
    );
  }

  /*
   * Raw provider JSON remains untrusted until here.
   */
  const parsed =
    parseCashAppCreatePaymentResponse({
      response:
        input.response,

      amountMinor:
        context.amountMinor,

      currency:
        context.currency,

      merchantId,

      grantId:
        grant.grantId,

      customerId:
        grant.customerId,

      referenceId,
    });

  /*
   * If this order already has a provider payment,
   * it must be exactly the same provider identity.
   *
   * This prevents rebinding an order from PWC_A
   * to PWC_B.
   */
  if (
    context.providerPaymentId &&
    context.providerPaymentId !==
      parsed.providerPaymentId
  ) {
    throw new Error(
      "Cash App order is already bound to a different provider payment."
    );
  }

  if (
    context.providerReference &&
    context.providerReference !==
      parsed.referenceId
  ) {
    throw new Error(
      "Cash App order is already bound to a different provider reference."
    );
  }

  /*
   * This is the ONLY trusted mutation here.
   *
   * It stores payment identity only.
   * It does NOT approve payment.
   */
  await bindSokoOrderProviderPayment({
    orderId,
    sellerUserId,
    provider:
      "cash_app",
    providerPaymentId:
      parsed.providerPaymentId,
    providerReference:
      parsed.referenceId,
  });

  /*
   * Re-read authoritative DB state after mutation.
   */
  const after =
    await getSokoCashAppPaymentContext({
      orderId,
      buyerUserId,
    });

  if (
    after.orderId !==
      orderId ||
    after.buyerUserId !==
      buyerUserId ||
    after.sellerUserId !==
      sellerUserId ||
    after.providerPaymentId !==
      parsed.providerPaymentId ||
    after.providerReference !==
      parsed.referenceId ||
    after.amountMinor !==
      context.amountMinor ||
    after.currency
      .toUpperCase() !==
      context.currency.toUpperCase()
  ) {
    throw new Error(
      "Cash App provider payment binding verification failed."
    );
  }

  return {
    orderId,
    sellerUserId,
    providerPaymentId:
      parsed.providerPaymentId,
    providerReference:
      parsed.referenceId,
    providerStatus:
      parsed.status,
  };
}
