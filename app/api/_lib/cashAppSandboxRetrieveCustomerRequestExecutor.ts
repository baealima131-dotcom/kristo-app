import "server-only";

import {
  parseCashAppCustomerRequestResponse,
} from "@/app/api/_lib/cashAppPartnerClient";

import {
  recordVerifiedCashAppCustomerRequestResponse,
} from "@/app/api/_lib/cashAppCustomerRequestResponse";

import {
  dbGetCashAppCustomerRequestForExecution,
} from "@/app/api/_lib/store/sokoCashAppCustomerRequestsDb";

export type ExecuteSandboxCashAppRetrieveCustomerRequestInput = {
  orderId: string;
  buyerUserId: string;
  sellerUserId: string;
  merchantId: string;
  referenceId: string;
  amountMinor: number;
  currency: string;
};

export type ExecutedSandboxCashAppRetrieveCustomerRequest = {
  providerRequestId: string;
  referenceId: string;
  status:
    | "pending"
    | "approved"
    | "declined"
    | "expired"
    | "failed";
  expiresAt?: string;
  mobileUrl?: string;
  grantIds: string[];
  grants: Array<{
    grantId: string;
    customerId: string;
  }>;
};

function clean(
  value: unknown,
  max = 512
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function validProviderRequestId(
  value: unknown
) {
  const requestId =
    clean(value, 512);

  if (
    !requestId ||
    !requestId.startsWith("GRR_") ||
    requestId.includes("/") ||
    requestId.includes("\\")
  ) {
    throw new Error(
      "Cash App provider Customer Request ID is invalid."
    );
  }

  return requestId;
}

/**
 * SANDBOX-ONLY Retrieve Customer Request executor.
 *
 * IMPORTANT:
 *
 * - There is intentionally NO caller yet.
 * - Production is explicitly refused.
 * - The provider request ID comes only from the
 *   persisted server-side Customer Request row.
 * - Kristo mobile never supplies providerRequestId,
 *   merchant, amount, grant ID, or customer ID.
 * - Provider JSON is verified before persistence.
 * - APPROVED may persist only the provider candidate
 *   grant/customer pair. Retrieve Grant must still
 *   verify that pair afterward.
 */
export async function executeSandboxCashAppRetrieveCustomerRequest(
  input: ExecuteSandboxCashAppRetrieveCustomerRequestInput
): Promise<ExecutedSandboxCashAppRetrieveCustomerRequest> {
  const sandboxFlag =
    String(
      process.env
        .CASH_APP_PARTNER_SANDBOX ||
        ""
    )
      .trim()
      .toLowerCase();

  if (sandboxFlag !== "true") {
    throw new Error(
      "Cash App Retrieve Customer Request executor is sandbox-only."
    );
  }

  const clientId =
    clean(
      process.env
        .CASH_APP_PARTNER_CLIENT_ID,
      256
    );

  if (!clientId) {
    throw new Error(
      "Cash App sandbox client ID is not configured."
    );
  }

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

  const currency =
    clean(
      input.currency,
      12
    ).toUpperCase();

  const amountMinor =
    input.amountMinor;

  if (
    !orderId ||
    !buyerUserId ||
    !sellerUserId ||
    !merchantId ||
    !referenceId ||
    currency !== "USD" ||
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(
      amountMinor
    ) ||
    amountMinor <= 0
  ) {
    throw new Error(
      "Cash App Retrieve Customer Request identity is incomplete."
    );
  }

  /*
   * Read the immutable server-side Customer Request.
   */
  const prepared =
    await dbGetCashAppCustomerRequestForExecution({
      orderId,
    });

  if (!prepared) {
    throw new Error(
      "Cash App Customer Request was not found."
    );
  }

  /*
   * Exact order/payment identity binding.
   */
  if (
    prepared.orderId !==
      orderId ||
    prepared.buyerUserId !==
      buyerUserId ||
    prepared.sellerUserId !==
      sellerUserId ||
    prepared.merchantId !==
      merchantId ||
    prepared.referenceId !==
      referenceId
  ) {
    throw new Error(
      "Cash App Retrieve Customer Request order identity mismatch."
    );
  }

  /*
   * This executor can only retrieve a request that
   * was originally created in our sandbox flow.
   */
  if (
    prepared.environment !==
      "sandbox" ||
    prepared.requestHost !==
      "sandbox.api.cash.app" ||
    prepared.requestPath !==
      "/customer-request/v1/requests"
  ) {
    throw new Error(
      "Cash App Customer Request is not a valid sandbox request."
    );
  }

  /*
   * Polling begins only after Create Customer Request
   * has returned a provider request ID and status PENDING.
   *
   * APPROVED/DECLINED/EXPIRED/FAILED are terminal in
   * our stored state and must not be polled again here.
   */
  if (
    prepared.status !==
      "pending"
  ) {
    throw new Error(
      "Cash App Customer Request is not eligible for retrieval."
    );
  }

  /*
   * A pending row must not already contain a grant
   * candidate. Candidate identity appears only after
   * a strictly parsed APPROVED provider response.
   */
  if (
    prepared.providerGrantId ||
    prepared.providerCustomerId
  ) {
    throw new Error(
      "Pending Cash App Customer Request unexpectedly contains grant identity."
    );
  }

  const providerRequestId =
    validProviderRequestId(
      prepared.providerRequestId
    );

  /*
   * Verify the immutable persisted Create Request body
   * still represents this exact payment context.
   *
   * dbGetCashAppCustomerRequestForExecution() already
   * verifies its stored SHA-256 digest before returning.
   */
  let persistedPayload:
    any;

  try {
    persistedPayload =
      JSON.parse(
        prepared.requestBody
      );
  } catch {
    throw new Error(
      "Cash App persisted Customer Request body is invalid JSON."
    );
  }

  const persistedRequest =
    persistedPayload
      ?.request;

  const actions =
    persistedRequest
      ?.actions;

  if (
    persistedPayload?.idempotency_key !==
      prepared.idempotencyKey ||
    !Array.isArray(
      actions
    ) ||
    actions.length !== 1
  ) {
    throw new Error(
      "Cash App persisted Customer Request identity is invalid."
    );
  }

  const action =
    actions[0];

  if (
    persistedRequest.channel !==
      "IN_APP" ||
    persistedRequest.reference_id !==
      referenceId ||
    action?.type !==
      "ONE_TIME_PAYMENT" ||
    action?.scope_id !==
      merchantId ||
    typeof action?.amount !==
      "number" ||
    !Number.isSafeInteger(
      action.amount
    ) ||
    action.amount !==
      amountMinor ||
    String(
      action?.currency ||
      ""
    )
      .trim()
      .toUpperCase() !==
      currency
  ) {
    throw new Error(
      "Cash App persisted Customer Request payment context mismatch."
    );
  }

  const requestPath =
    `/customer-request/v1/requests/${encodeURIComponent(
      providerRequestId
    )}`;

  const url =
    `https://sandbox.api.cash.app${requestPath}`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      12_000
    );

  let response:
    Response;

  try {
    response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Client ${clientId}`,

            "User-Agent":
              "Kristo-App-SOKO/1.0",
          },

          signal:
            controller.signal,

          redirect:
            "error",

          cache:
            "no-store",
        }
      );
  } finally {
    clearTimeout(
      timeout
    );
  }

  const responseText =
    await response.text();

  if (
    responseText.length >
      256 * 1024
  ) {
    throw new Error(
      "Cash App Retrieve Customer Request response is too large."
    );
  }

  if (!response.ok) {
    /*
     * Do not include provider body, customer identity,
     * grant identity, or credentials in errors.
     */
    throw new Error(
      `Cash App sandbox Retrieve Customer Request failed with HTTP ${response.status}.`
    );
  }

  let providerJson:
    unknown;

  try {
    providerJson =
      JSON.parse(
        responseText
      );
  } catch {
    throw new Error(
      "Cash App sandbox Retrieve Customer Request returned invalid JSON."
    );
  }

  /*
   * SECURITY:
   *
   * Parse once BEFORE persistence so the response's
   * request ID must exactly equal the server-stored
   * providerRequestId we actually requested.
   */
  const parsed =
    parseCashAppCustomerRequestResponse({
      response:
        providerJson,

      referenceId,
      merchantId,
      amountMinor,
      currency,
    });

  if (
    parsed.providerRequestId !==
      providerRequestId
  ) {
    throw new Error(
      "Cash App Retrieve Customer Request provider identity mismatch."
    );
  }

  /*
   * Strict parser + safe DB persistence boundary.
   *
   * This may persist:
   * - PENDING state refresh, or
   * - APPROVED + provider candidate grant/customer pair,
   * - DECLINED / EXPIRED / FAILED.
   *
   * It does NOT create a verified grant.
   */
  const recorded =
    await recordVerifiedCashAppCustomerRequestResponse({
      orderId,

      response:
        providerJson,

      referenceId,
      merchantId,
      amountMinor,
      currency,
    });

  /*
   * Defense in depth after persistence.
   */
  if (
    recorded.providerRequestId !==
      providerRequestId ||
    recorded.referenceId !==
      referenceId
  ) {
    throw new Error(
      "Cash App Retrieve Customer Request persisted identity mismatch."
    );
  }

  return {
    providerRequestId:
      recorded.providerRequestId,

    referenceId:
      recorded.referenceId,

    status:
      recorded.status,

    expiresAt:
      recorded.expiresAt,

    mobileUrl:
      recorded.mobileUrl,

    grantIds:
      recorded.grantIds,

    grants:
      recorded.grants,
  };
}
