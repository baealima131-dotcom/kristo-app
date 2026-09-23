import "server-only";

import crypto from "node:crypto";

import {
  dbGetCashAppCustomerRequestForExecution,
} from "@/app/api/_lib/store/sokoCashAppCustomerRequestsDb";

import {
  recordVerifiedCashAppCustomerRequestResponse,
} from "@/app/api/_lib/cashAppCustomerRequestResponse";

export type ExecuteSandboxCashAppCustomerRequestInput = {
  orderId: string;

  buyerUserId: string;
  sellerUserId: string;

  merchantId: string;
  referenceId: string;

  amountMinor: number;
  currency: string;
};

export type ExecutedSandboxCashAppCustomerRequest = {
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

function sha256(
  value: string
) {
  return crypto
    .createHash("sha256")
    .update(
      value,
      "utf8"
    )
    .digest("hex")
    .toLowerCase();
}

/**
 * SANDBOX-ONLY provider execution boundary.
 *
 * This function intentionally refuses production.
 *
 * It reads the exact persisted Customer Request
 * body/host/path, validates it against authoritative
 * Kristo/SOKO order identity, then performs one
 * Cash App SANDBOX Customer Request API call.
 *
 * There is intentionally NO caller yet.
 */
export async function executeSandboxCashAppCustomerRequest(
  input: ExecuteSandboxCashAppCustomerRequestInput
): Promise<ExecutedSandboxCashAppCustomerRequest> {
  const environmentFlag =
    String(
      process.env
        .CASH_APP_PARTNER_SANDBOX ||
        ""
    )
      .trim()
      .toLowerCase();

  /*
   * Fail closed.
   *
   * Only literal "true" is accepted here.
   * Production can never execute through
   * this helper.
   */
  if (
    environmentFlag !==
      "true"
  ) {
    throw new Error(
      "Cash App sandbox execution is disabled."
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
    typeof amountMinor !==
      "number" ||
    !Number.isSafeInteger(
      amountMinor
    ) ||
    amountMinor <= 0
  ) {
    throw new Error(
      "Cash App sandbox execution identity is incomplete."
    );
  }

  const prepared =
    await dbGetCashAppCustomerRequestForExecution({
      orderId,
    });

  if (!prepared) {
    throw new Error(
      "Cash App prepared Customer Request was not found."
    );
  }

  /*
   * Exact server-authoritative identity match.
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
      "Cash App prepared Customer Request identity mismatch."
    );
  }

  /*
   * Sandbox-only persisted identity.
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
   * Retrying PREPARED or PENDING is allowed.
   *
   * The same persisted body contains the same
   * idempotency key, so a timeout can be retried
   * without inventing a new Customer Request.
   */
  if (
    prepared.status !==
      "prepared" &&
    prepared.status !==
      "pending"
  ) {
    throw new Error(
      "Cash App Customer Request is not eligible for sandbox execution."
    );
  }

  if (
    sha256(
      prepared.requestBody
    ) !==
      prepared.requestBodySha256
  ) {
    throw new Error(
      "Cash App persisted Customer Request digest mismatch."
    );
  }

  /*
   * Parse the exact persisted body only to verify
   * that it still contains the authoritative
   * merchant/amount/currency/reference.
   *
   * The parsed object is NEVER reserialized for
   * the outbound request.
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

  if (
    persistedPayload?.idempotency_key !==
      prepared.idempotencyKey
  ) {
    throw new Error(
      "Cash App persisted Customer Request idempotency mismatch."
    );
  }

  const request =
    persistedPayload
      ?.request;

  const actions =
    request?.actions;

  if (
    !Array.isArray(
      actions
    ) ||
    actions.length !== 1
  ) {
    throw new Error(
      "Cash App persisted Customer Request action mismatch."
    );
  }

  const action =
    actions[0];

  if (
    request.channel !==
      "IN_APP" ||

    request.reference_id !==
      referenceId ||

    action?.type !==
      "ONE_TIME_PAYMENT" ||

    action?.scope_id !==
      merchantId ||

    typeof action?.amount !==
      "number" ||

    action.amount !==
      amountMinor ||

    String(
      action?.currency || ""
    ).toUpperCase() !==
      currency
  ) {
    throw new Error(
      "Cash App persisted Customer Request payment context mismatch."
    );
  }

  const url =
    `https://${prepared.requestHost}${prepared.requestPath}`;

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
            "POST",

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Client ${clientId}`,

            "Content-Type":
              "application/json",

            "User-Agent":
              "Kristo-App-SOKO/1.0",
          },

          /*
           * CRITICAL:
           *
           * Send the exact persisted bytes.
           * Do NOT JSON.stringify again.
           */
          body:
            prepared.requestBody,

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
      "Cash App sandbox response is too large."
    );
  }

  if (!response.ok) {
    /*
     * Do not include provider body or credentials
     * in this error. Keep logs free of sensitive
     * provider/customer details.
     */
    throw new Error(
      `Cash App sandbox Customer Request failed with HTTP ${response.status}.`
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
      "Cash App sandbox returned invalid JSON."
    );
  }

  /*
   * Strict parser + DB persistence boundary.
   *
   * Provider JSON cannot directly write to DB.
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
