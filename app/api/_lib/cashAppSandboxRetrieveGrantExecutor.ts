import "server-only";

import {
  buildSignedCashAppRetrieveGrantRequest,
  cashAppNetworkConfigured,
  getCashAppPartnerNetworkCredentials,
} from "@/app/api/_lib/cashAppPartnerClient";

import {
  recordVerifiedCashAppGrantResponse,
  type RecordedVerifiedCashAppGrant,
} from "@/app/api/_lib/cashAppVerifiedGrantResponse";

import {
  dbGetCashAppCustomerRequestForExecution,
} from "@/app/api/_lib/store/sokoCashAppCustomerRequestsDb";


export type ExecuteSandboxCashAppRetrieveGrantInput = {
  orderId: string;

  /*
   * All of these values are authoritative
   * Kristo/SOKO server values.
   *
   * grantId/customerId are intentionally NOT
   * accepted here. They come from the persisted
   * provider-approved Customer Request.
   */
  buyerUserId: string;
  sellerUserId: string;
  merchantId: string;
  referenceId: string;
  amountMinor: number;
  currency: string;
};


function requiredText(
  value: unknown,
  label: string,
  max = 512
) {
  const text =
    String(value || "")
      .trim();

  if (
    !text ||
    text.length > max
  ) {
    throw new Error(
      `Invalid Cash App ${label}.`
    );
  }

  return text;
}


function sandboxEnabled() {
  return (
    String(
      process.env
        .CASH_APP_PARTNER_SANDBOX || ""
    )
      .trim()
      .toLowerCase() ===
    "true"
  );
}


/**
 * DORMANT SANDBOX-ONLY EXECUTOR.
 *
 * SECURITY:
 *
 * - no mobile grant/customer identity;
 * - candidate grant/customer IDs come only
 *   from the verified Customer Request row;
 * - Customer Request must already be APPROVED;
 * - request ID must already be provider-issued;
 * - signed Network API GET is sandbox-only;
 * - provider response is parsed and verified
 *   before entering the verified grant store;
 * - this helper does not create a payment;
 * - this helper does not bind a provider payment;
 * - this helper does not approve an order.
 *
 * IMPORTANT:
 *
 * Keep this helper without a route caller until
 * its selective mocked runtime test passes.
 */
export async function executeSandboxCashAppRetrieveGrant(
  input: ExecuteSandboxCashAppRetrieveGrantInput
): Promise<RecordedVerifiedCashAppGrant> {

  if (!sandboxEnabled()) {
    throw new Error(
      "Cash App Retrieve Grant executor is sandbox-only."
    );
  }

  if (!cashAppNetworkConfigured()) {
    throw new Error(
      "Cash App Network API is not configured."
    );
  }

  const orderId =
    requiredText(
      input.orderId,
      "order ID",
      180
    );

  const buyerUserId =
    requiredText(
      input.buyerUserId,
      "buyer identity",
      180
    );

  const sellerUserId =
    requiredText(
      input.sellerUserId,
      "seller identity",
      180
    );

  const merchantId =
    requiredText(
      input.merchantId,
      "merchant identity",
      180
    );

  const referenceId =
    requiredText(
      input.referenceId,
      "reference identity",
      180
    );

  const amountMinor =
    input.amountMinor;

  const currency =
    String(input.currency || "")
      .trim()
      .toUpperCase();

  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(
      amountMinor
    ) ||
    amountMinor <= 0 ||
    currency !== "USD"
  ) {
    throw new Error(
      "Cash App Retrieve Grant payment identity is invalid."
    );
  }

  /*
   * Read the immutable Customer Request state.
   *
   * providerGrantId/providerCustomerId originate
   * from the parsed Cash App APPROVED response.
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
   * Full server-authoritative identity binding.
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
      "Cash App Retrieve Grant order identity mismatch."
    );
  }

  /*
   * Retrieve Grant must never execute from
   * PENDING/PREPARED/DECLINED/etc.
   */
  if (
    prepared.status !==
      "approved"
  ) {
    throw new Error(
      "Cash App Customer Request is not approved."
    );
  }

  if (
    prepared.environment !==
      "sandbox"
  ) {
    throw new Error(
      "Cash App Retrieve Grant request is not sandbox."
    );
  }

  const providerRequestId =
    requiredText(
      prepared.providerRequestId,
      "provider request ID",
      512
    );

  const providerGrantId =
    requiredText(
      prepared.providerGrantId,
      "provider grant ID",
      512
    );

  const providerCustomerId =
    requiredText(
      prepared.providerCustomerId,
      "provider customer ID",
      512
    );

  /*
   * These IDs are intentionally taken only
   * from the persisted provider response above.
   */
  const credentials =
    getCashAppPartnerNetworkCredentials();

  const signed =
    buildSignedCashAppRetrieveGrantRequest({
      customerId:
        providerCustomerId,

      grantId:
        providerGrantId,

      credentials,

      sandbox:
        true,
    });

  if (
    signed.method !== "GET" ||
    signed.host !==
      "sandbox.api.cash.app" ||
    signed.body !== "" ||
    !signed.path.startsWith(
      "/network/v1/customers/"
    ) ||
    !signed.path.endsWith(
      `/grants/${encodeURIComponent(
        providerGrantId
      )}`
    )
  ) {
    throw new Error(
      "Cash App Retrieve Grant signed request mismatch."
    );
  }

  if (
    "Content-Type" in
      signed.headers
  ) {
    throw new Error(
      "Cash App Retrieve Grant GET unexpectedly has Content-Type."
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      12_000
    );

  let response: Response;

  try {
    response =
      await fetch(
        `https://${signed.host}${signed.path}`,
        {
          method:
            signed.method,

          headers:
            signed.headers,

          signal:
            controller.signal,

          redirect:
            "error",

          cache:
            "no-store",
        }
      );
  } finally {
    clearTimeout(timeout);
  }

  const responseText =
    await response.text();

  if (
    responseText.length >
      256 * 1024
  ) {
    throw new Error(
      "Cash App Retrieve Grant response is too large."
    );
  }

  if (!response.ok) {
    throw new Error(
      `Cash App Retrieve Grant failed with status ${response.status}.`
    );
  }

  let providerJson: unknown;

  try {
    providerJson =
      JSON.parse(
        responseText
      );
  } catch {
    throw new Error(
      "Cash App Retrieve Grant returned invalid JSON."
    );
  }

  /*
   * SECURITY BOUNDARY:
   *
   * This helper performs the strict provider
   * response parse first. Only a response whose
   * grant/customer/request/merchant/amount/
   * currency/status/type/expiry all match can
   * enter the verified grant DB.
   */
  const verified =
    await recordVerifiedCashAppGrantResponse({
      buyerUserId,

      response:
        providerJson,

      grantId:
        providerGrantId,

      customerId:
        providerCustomerId,

      requestId:
        providerRequestId,

      referenceId,

      merchantId,

      amountMinor,

      currency,
    });

  /*
   * Defense in depth after persistence.
   */
  if (
    verified.grantId !==
      providerGrantId ||
    verified.customerId !==
      providerCustomerId ||
    verified.requestId !==
      providerRequestId ||
    verified.buyerUserId !==
      buyerUserId ||
    verified.referenceId !==
      referenceId ||
    verified.merchantId !==
      merchantId ||
    verified.amountMinor !==
      amountMinor ||
    verified.currency !==
      "USD" ||
    verified.status !==
      "ACTIVE"
  ) {
    throw new Error(
      "Cash App verified Retrieve Grant identity mismatch."
    );
  }

  return verified;
}
