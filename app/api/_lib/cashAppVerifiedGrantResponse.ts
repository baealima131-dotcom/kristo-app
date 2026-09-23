import "server-only";

import {
  parseCashAppCustomerGrantResponse,
  type ParsedCashAppCustomerGrant,
} from "@/app/api/_lib/cashAppPartnerClient";

import {
  dbSaveVerifiedCashAppGrant,
  dbGetVerifiedCashAppGrantForOrder,
} from "@/app/api/_lib/store/sokoCashAppCustomerGrantsDb";

export type RecordVerifiedCashAppGrantResponseInput = {
  buyerUserId: string;

  response: unknown;

  grantId: string;
  customerId: string;
  requestId: string;

  referenceId: string;
  merchantId: string;

  amountMinor: number;
  currency: string;
};

export type RecordedVerifiedCashAppGrant = {
  grantId: string;
  customerId: string;
  requestId: string;

  buyerUserId: string;

  referenceId: string;
  merchantId: string;

  actionType:
    "ONE_TIME_PAYMENT";

  amountMinor: number;
  currency: "USD";

  status:
    "ACTIVE";

  verifiedAt: string;

  expiresAt: string;
};

/**
 * Provider Retrieve Grant persistence boundary.
 *
 * SECURITY:
 *
 * 1. Provider JSON is unknown/untrusted.
 * 2. Parser verifies provider grant identity
 *    against server-authoritative values.
 * 3. Only the verified parser result is saved.
 * 4. DB resolver re-checks the complete
 *    order/payment identity after persistence.
 *
 * This helper DOES NOT call Cash App.
 */
export async function recordVerifiedCashAppGrantResponse(
  input: RecordVerifiedCashAppGrantResponseInput
): Promise<RecordedVerifiedCashAppGrant> {
  const buyerUserId =
    String(input.buyerUserId || "")
      .trim();

  const referenceId =
    String(input.referenceId || "")
      .trim();

  if (
    !buyerUserId ||
    !referenceId
  ) {
    throw new Error(
      "Cash App verified grant order identity is incomplete."
    );
  }

  /*
   * SECURITY BOUNDARY:
   *
   * Nothing from response is persisted
   * before this parser succeeds.
   */
  const parsed:
    ParsedCashAppCustomerGrant =
      parseCashAppCustomerGrantResponse({
        response:
          input.response,

        grantId:
          input.grantId,

        customerId:
          input.customerId,

        requestId:
          input.requestId,

        merchantId:
          input.merchantId,

        amountMinor:
          input.amountMinor,

        currency:
          input.currency,
      });

  await dbSaveVerifiedCashAppGrant({
    buyerUserId,

    grantId:
      parsed.grantId,

    customerId:
      parsed.customerId,

    requestId:
      parsed.requestId,

    referenceId,

    actionType:
      parsed.actionType,

    scopeId:
      parsed.merchantId,

    amountMinor:
      parsed.amountMinor,

    currency:
      parsed.currency,

    status:
      parsed.status,

    expiresAt:
      parsed.expiresAt,

    /*
     * Internal trust marker only.
     *
     * This becomes true only after the
     * strict provider-response parser above.
     */
    verified:
      true,
  });

  /*
   * Defense in depth:
   *
   * Re-read through the checkout resolver.
   * This proves the persisted grant matches
   * buyer + reference + seller merchant +
   * amount + currency and is still active
   * and unexpired.
   */
  const stored =
    await dbGetVerifiedCashAppGrantForOrder({
      buyerUserId,

      referenceId,

      merchantId:
        parsed.merchantId,

      amountMinor:
        parsed.amountMinor,

      currency:
        parsed.currency,
    });

  if (
    !stored ||

    stored.grantId !==
      parsed.grantId ||

    stored.customerId !==
      parsed.customerId ||

    stored.requestId !==
      parsed.requestId ||

    stored.buyerUserId !==
      buyerUserId ||

    stored.referenceId !==
      referenceId ||

    stored.merchantId !==
      parsed.merchantId ||

    stored.actionType !==
      "ONE_TIME_PAYMENT" ||

    stored.amountMinor !==
      parsed.amountMinor ||

    stored.currency !==
      "USD" ||

    stored.status !==
      "ACTIVE" ||

    !stored.verifiedAt ||

    stored.expiresAt !==
      parsed.expiresAt
  ) {
    throw new Error(
      "Cash App persisted grant verification mismatch."
    );
  }

  const verifiedAt = stored.verifiedAt;
  const expiresAt = stored.expiresAt;

  if (!verifiedAt || !expiresAt) {
    throw new Error(
      "Cash App persisted grant verification mismatch."
    );
  }

  return {
    grantId:
      stored.grantId,

    customerId:
      stored.customerId,

    requestId:
      stored.requestId,

    buyerUserId:
      stored.buyerUserId,

    referenceId:
      stored.referenceId,

    merchantId:
      stored.merchantId,

    actionType:
      "ONE_TIME_PAYMENT",

    amountMinor:
      stored.amountMinor,

    currency:
      "USD",

    status:
      "ACTIVE",

    verifiedAt,

    expiresAt,
  };
}
