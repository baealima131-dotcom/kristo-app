import "server-only";

import {
  parseCashAppCustomerRequestResponse,
  type ParsedCashAppCustomerRequestResponse,
} from "@/app/api/_lib/cashAppPartnerClient";

import {
  dbRecordCashAppCustomerRequestResponse,
} from "@/app/api/_lib/store/sokoCashAppCustomerRequestsDb";

export type RecordVerifiedCashAppCustomerRequestResponseInput = {
  orderId: string;

  response: unknown;

  referenceId: string;

  merchantId: string;

  amountMinor: number;

  currency: string;
};

export type RecordedVerifiedCashAppCustomerRequestResponse = {
  providerRequestId: string;

  referenceId: string;

  status:
    ParsedCashAppCustomerRequestResponse["status"];

  expiresAt?: string;

  mobileUrl?: string;

  grantIds: string[];

  grants: Array<{
    grantId: string;
    customerId: string;
  }>;
};

/**
 * Provider-response persistence boundary.
 *
 * IMPORTANT:
 *
 * Provider JSON is untrusted until
 * parseCashAppCustomerRequestResponse()
 * verifies it against the immutable,
 * server-authoritative Kristo/SOKO
 * payment identity.
 *
 * Mobile does not supply merchant,
 * amount, currency, reference, or
 * provider request identity here.
 *
 * This helper does NOT call Cash App.
 */
export async function recordVerifiedCashAppCustomerRequestResponse(
  input: RecordVerifiedCashAppCustomerRequestResponseInput
): Promise<RecordedVerifiedCashAppCustomerRequestResponse> {
  const orderId =
    String(input.orderId || "")
      .trim();

  if (!orderId) {
    throw new Error(
      "Cash App Customer Request order ID is required."
    );
  }

  /*
   * SECURITY BOUNDARY:
   *
   * Nothing from the provider response is
   * persisted before this parser succeeds.
   */
  const parsed =
    parseCashAppCustomerRequestResponse({
      response:
        input.response,

      referenceId:
        input.referenceId,

      merchantId:
        input.merchantId,

      amountMinor:
        input.amountMinor,

      currency:
        input.currency,
    });

  /*
   * One Customer Request == one ONE_TIME_PAYMENT
   * action in our current Kristo/SOKO flow.
   *
   * Provider grant identity is accepted only
   * after the strict provider parser succeeds.
   */
  if (parsed.grants.length > 1) {
    throw new Error(
      "Cash App Customer Request returned multiple grants."
    );
  }

  const providerGrant =
    parsed.grants.length === 1
      ? parsed.grants[0]
      : undefined;

  if (
    parsed.status === "approved" &&
    !providerGrant
  ) {
    throw new Error(
      "Approved Cash App Customer Request is missing a grant."
    );
  }

  if (
    parsed.status !== "approved" &&
    providerGrant
  ) {
    throw new Error(
      "Unexpected Cash App grant before Customer Request approval."
    );
  }

  const recorded =
    await dbRecordCashAppCustomerRequestResponse({
      orderId,

      referenceId:
        parsed.referenceId,

      providerRequestId:
        parsed.providerRequestId,

      status:
        parsed.status,

      expiresAt:
        parsed.expiresAt || null,

      grantId:
        providerGrant?.grantId ||
        null,

      customerId:
        providerGrant?.customerId ||
        null,

      providerVerified:
        true,
    });

  /*
   * Defense in depth:
   *
   * The DB recorder itself enforces
   * provider-request identity and the
   * monotonic status state machine.
   */
  if (
    recorded.orderId !==
      orderId ||
    recorded.referenceId !==
      parsed.referenceId ||
    recorded.providerRequestId !==
      parsed.providerRequestId ||
    recorded.status !==
      parsed.status ||
    (
      providerGrant &&
      (
        recorded.providerGrantId !==
          providerGrant.grantId ||
        recorded.providerCustomerId !==
          providerGrant.customerId
      )
    ) ||
    (
      parsed.expiresAt &&
      recorded.expiresAt !==
        parsed.expiresAt
    )
  ) {
    throw new Error(
      "Cash App Customer Request persisted response mismatch."
    );
  }

  return {
    providerRequestId:
      parsed.providerRequestId,

    referenceId:
      parsed.referenceId,

    status:
      parsed.status,

    expiresAt:
      recorded.expiresAt,

    mobileUrl:
      parsed.mobileUrl,

    grantIds:
      parsed.grantIds,

    grants:
      parsed.grants,
  };
}
