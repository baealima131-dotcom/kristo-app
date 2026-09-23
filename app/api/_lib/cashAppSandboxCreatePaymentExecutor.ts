import "server-only";

import {
  buildSignedCashAppCreatePaymentRequest,
  cashAppNetworkConfigured,
  getCashAppPartnerNetworkCredentials,
} from "@/app/api/_lib/cashAppPartnerClient";

import {
  parseCashAppCreatePaymentResponse,
  type ParsedCashAppCreatePaymentResponse,
} from "@/app/api/_lib/cashAppCreatePaymentResponse";

import {
  getSokoCashAppPaymentContext,
} from "@/app/api/_lib/store/sokoOrdersDb";

import {
  dbGetVerifiedCashAppGrantForOrder,
} from "@/app/api/_lib/store/sokoCashAppCustomerGrantsDb";

import {
  bindVerifiedCashAppCreatePaymentResponse,
} from "@/app/api/_lib/cashAppVerifiedPaymentBinding";

export type ExecuteSandboxCashAppCreatePaymentInput = {
  orderId: string;
  buyerUserId: string;
  sellerUserId: string;
  merchantId: string;
  referenceId: string;
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
 * SANDBOX-ONLY Create Payment execution boundary.
 *
 * IMPORTANT:
 *
 * - There is intentionally NO caller yet.
 * - Production is explicitly refused.
 * - Amount/currency are reloaded from the order DB.
 * - Grant/customer identity is reloaded from the
 *   provider-verified grant store.
 * - Provider response is strictly parsed.
 * - This executor does NOT bind the provider payment.
 * - This executor does NOT approve the order.
 */
export async function executeSandboxCashAppCreatePayment(
  input: ExecuteSandboxCashAppCreatePaymentInput
): Promise<ParsedCashAppCreatePaymentResponse> {
  const sandboxFlag =
    String(
      process.env
        .CASH_APP_PARTNER_SANDBOX ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    sandboxFlag !==
      "true"
  ) {
    throw new Error(
      "Cash App Create Payment executor is sandbox-only."
    );
  }

  if (
    !cashAppNetworkConfigured()
  ) {
    throw new Error(
      "Cash App Network API is not configured."
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

  if (
    !orderId ||
    !buyerUserId ||
    !sellerUserId ||
    !merchantId ||
    !referenceId
  ) {
    throw new Error(
      "Cash App Create Payment identity is incomplete."
    );
  }

  /*
   * Reload authoritative order totals and seller.
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
      "Cash App Create Payment order identity mismatch."
    );
  }

  /*
   * Reload the already provider-verified
   * ONE_TIME_PAYMENT grant.
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
      "Verified Cash App grant is unavailable."
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
      "Cash App verified grant identity mismatch."
    );
  }

  const credentials =
    getCashAppPartnerNetworkCredentials();

  /*
   * Build exact signed provider request.
   */
  const request =
    buildSignedCashAppCreatePaymentRequest({
      orderId,
      payment: {
        amountMinor:
          context.amountMinor,
        currency:
          context.currency,
        merchantId,
        grantId:
          grant.grantId,
        referenceId,
      },
      credentials,
      sandbox:
        true,
    });

  if (
    request.method !==
      "POST" ||
    request.host !==
      "sandbox.api.cash.app" ||
    request.path !==
      "/network/v1/payments" ||
    request.headers.Host !==
      "sandbox.api.cash.app" ||
    request.headers.Accept !==
      "application/json" ||
    request.headers[
      "Content-Type"
    ] !==
      "application/json" ||
    !request.headers.Authorization ||
    !request.headers[
      "X-Region"
    ] ||
    !request.headers[
      "X-Signature"
    ]?.startsWith(
      "V1 "
    )
  ) {
    throw new Error(
      "Cash App signed Create Payment request is invalid."
    );
  }

  /*
   * Verify exact signed body before sending.
   */
  let signedBody:
    any;

  try {
    signedBody =
      JSON.parse(
        request.body
      );
  } catch {
    throw new Error(
      "Cash App signed Create Payment body is invalid."
    );
  }

  if (
    !signedBody
      ?.idempotency_key ||
    signedBody
      ?.payment
      ?.amount !==
        context.amountMinor ||
    signedBody
      ?.payment
      ?.currency !==
        context.currency.toUpperCase() ||
    signedBody
      ?.payment
      ?.merchant_id !==
        merchantId ||
    signedBody
      ?.payment
      ?.grant_id !==
        grant.grantId ||
    signedBody
      ?.payment
      ?.reference_id !==
        referenceId ||
    signedBody
      ?.payment
      ?.capture !==
        true
  ) {
    throw new Error(
      "Cash App signed payment body identity mismatch."
    );
  }

  const url =
    `https://${request.host}${request.path}`;

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
            request.method,

          headers:
            request.headers,

          /*
           * Exact signed bytes.
           */
          body:
            request.body,

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
      "Cash App Create Payment response is too large."
    );
  }

  if (!response.ok) {
    throw new Error(
      `Cash App sandbox Create Payment failed with HTTP ${response.status}.`
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
      "Cash App sandbox Create Payment returned invalid JSON."
    );
  }

  /*
   * STRICT provider boundary.
   *
   * No provider payment ID is trusted before this.
   */
  const parsed =
    parseCashAppCreatePaymentResponse({
      response:
        providerJson,
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
   * Safe provider-payment binding.
   *
   * The response has already passed the strict parser above.
   * The binding boundary deliberately receives the original
   * provider JSON and independently reloads/revalidates:
   *
   * - authoritative order identity;
   * - seller identity;
   * - amount/currency;
   * - provider-verified grant/customer;
   * - merchant/reference;
   * - provider payment response.
   *
   * It may bind the trusted PWC_* provider payment identity,
   * but it MUST NOT mark the order paid.
   *
   * CAPTURED approval remains a separate signed-webhook path.
   */
  const binding =
    await bindVerifiedCashAppCreatePaymentResponse({
      orderId,
      buyerUserId,
      sellerUserId,
      merchantId,
      referenceId,
      response:
        providerJson,
    });

  if (
    binding.orderId !==
      orderId ||
    binding.providerPaymentId !==
      parsed.providerPaymentId ||
    binding.providerReference !==
      referenceId
  ) {
    throw new Error(
      "Cash App persisted provider payment identity mismatch."
    );
  }

  return parsed;
}
