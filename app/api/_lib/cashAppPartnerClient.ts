import crypto from "crypto";

/*
 * Cash App Pay Partner API — server-only foundation.
 *
 * SECURITY RULES:
 *
 * - Never import this module into mobile/client code.
 * - Never accept amount/currency/merchant identity from the buyer.
 * - merchantId must come from a verified seller payment connection.
 * - grantId must come from a verified Cash App customer request/grant flow.
 * - referenceId is generated/controlled by Kristo server.
 * - provider payment IDs must come only from Cash App responses.
 *
 * Network execution intentionally remains disabled.
 */

export type CashAppPartnerPaymentInput = {
  amountMinor: number;
  currency: string;
  merchantId: string;
  grantId: string;
  referenceId: string;
};

export type CashAppPartnerPaymentRequest = {
  idempotency_key: string;
  payment: {
    amount: number;
    currency: string;
    merchant_id: string;
    grant_id: string;
    reference_id: string;
    capture: true;
  };
};

function clean(
  value: unknown,
  max = 180
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

export function cashAppPartnerConfigured() {
  return Boolean(
    clean(
      process.env.CASH_APP_PARTNER_API_KEY,
      512
    ) &&
    clean(
      process.env.CASH_APP_PARTNER_API_SECRET,
      512
    )
  );
}

export function createCashAppServerReference(
  orderId: string
) {
  const id = clean(orderId, 100);

  if (!id) {
    throw new Error(
      "Cash App order ID is required."
    );
  }

  const digest = crypto
    .createHash("sha256")
    .update(id)
    .digest("hex")
    .slice(0, 24);

  return `kristo-${digest}`;
}

export function createCashAppIdempotencyKey(
  orderId: string
) {
  const id = clean(orderId, 100);

  if (!id) {
    throw new Error(
      "Cash App order ID is required."
    );
  }

  /*
   * Deterministic per order.
   *
   * A retry for the same order therefore uses
   * the same idempotency key instead of risking
   * a second payment.
   */
  const digest = crypto
    .createHash("sha256")
    .update(`cash-app-payment:${id}`)
    .digest("hex");

  return digest.slice(0, 64);
}

export function buildCashAppPartnerPaymentRequest(
  orderId: string,
  input: CashAppPartnerPaymentInput
): CashAppPartnerPaymentRequest {
  const amountMinor =
    Number(input.amountMinor);

  const currency =
    clean(input.currency, 10)
      .toUpperCase();

  const merchantId =
    clean(input.merchantId, 180);

  const grantId =
    clean(input.grantId, 512);

  const referenceId =
    clean(input.referenceId, 180);

  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    throw new Error(
      "Invalid Cash App payment amount."
    );
  }

  if (!currency) {
    throw new Error(
      "Cash App payment currency is required."
    );
  }

  if (!merchantId) {
    throw new Error(
      "Verified Cash App merchant ID is required."
    );
  }

  if (!grantId) {
    throw new Error(
      "Verified Cash App grant ID is required."
    );
  }

  if (!referenceId) {
    throw new Error(
      "Server Cash App reference is required."
    );
  }

  return {
    idempotency_key:
      createCashAppIdempotencyKey(orderId),

    payment: {
      amount: amountMinor,
      currency,
      merchant_id: merchantId,
      grant_id: grantId,
      reference_id: referenceId,
      capture: true,
    },
  };
}

/*
 * DO NOT add fetch() here yet.
 *
 * Before outbound payment creation we still need:
 *
 * 1. verified seller merchant mapping
 * 2. customer request + grant persistence
 * 3. exact Cash App request-signing implementation
 * 4. sandbox credentials
 * 5. sandbox signed request verification
 */

export type CashAppPartnerNetworkCredentials = {
  clientId: string;
  keyId: string;
  apiSecret: string;
  region: string;
};

export type CashAppSignedNetworkRequest = {
  method: "GET" | "POST";
  path: string;
  host: string;
  body: string;
  headers: {
    Accept: "application/json";
    Authorization: string;
    "Content-Type"?: "application/json";
    Host: string;
    "User-Agent": string;
    "X-Region": string;
    "X-Signature": string;
  };
};

function requirePartnerCredential(
  value: unknown,
  name: string,
  max = 512
) {
  const result = String(value || "")
    .trim()
    .slice(0, max);

  if (!result) {
    throw new Error(
      `Missing Cash App Partner ${name}.`
    );
  }

  return result;
}

function normalizeCashAppRegion(
  value: unknown
) {
  const region =
    requirePartnerCredential(
      value,
      "region",
      3
    ).toUpperCase();

  if (!/^[A-Z]{3}$/.test(region)) {
    throw new Error(
      "Invalid Cash App Partner region."
    );
  }

  return region;
}

/**
 * Reads server-only Network API credentials.
 *
 * CASH_APP_PARTNER_API_KEY is treated as the
 * Cash App API Key ID, not the API secret.
 *
 * Never expose this object to mobile/client code.
 */
/**
 * Customer Request API only requires the Cash App
 * Partner client ID.
 */
export function cashAppCustomerRequestConfigured() {
  return Boolean(
    String(
      process.env
        .CASH_APP_PARTNER_CLIENT_ID || ""
    ).trim()
  );
}

/**
 * Network API requires client ID + API key ID +
 * API secret + region.
 */
export function cashAppNetworkConfigured() {
  const environmentFlag =
    String(
      process.env
        .CASH_APP_PARTNER_SANDBOX || ""
    )
      .trim()
      .toLowerCase();

  const environmentConfigured =
    environmentFlag === "true" ||
    environmentFlag === "false";

  return Boolean(
    environmentConfigured &&
    String(
      process.env
        .CASH_APP_PARTNER_CLIENT_ID || ""
    ).trim() &&
    String(
      process.env
        .CASH_APP_PARTNER_API_KEY || ""
    ).trim() &&
    String(
      process.env
        .CASH_APP_PARTNER_API_SECRET || ""
    ).trim() &&
    String(
      process.env
        .CASH_APP_PARTNER_REGION || ""
    ).trim()
  );
}

export function getCashAppPartnerNetworkCredentials():
  CashAppPartnerNetworkCredentials {
  return {
    clientId:
      requirePartnerCredential(
        process.env
          .CASH_APP_PARTNER_CLIENT_ID,
        "client ID",
        256
      ),

    keyId:
      requirePartnerCredential(
        process.env
          .CASH_APP_PARTNER_API_KEY,
        "API key ID",
        256
      ),

    apiSecret:
      requirePartnerCredential(
        process.env
          .CASH_APP_PARTNER_API_SECRET,
        "API secret",
        512
      ),

    region:
      normalizeCashAppRegion(
        process.env
          .CASH_APP_PARTNER_REGION
      ),
  };
}

/**
 * Pure Cash App Network API request signer.
 *
 * IMPORTANT:
 *
 * `body` must be the exact string whose bytes
 * will later be sent over HTTPS.
 *
 * Do not JSON.stringify the request again after
 * this function returns.
 */
export function signCashAppNetworkRequest(
  input: {
    method: "GET" | "POST";
    path: string;
    host: string;
    body: string;
    userAgent: string;
    credentials:
      CashAppPartnerNetworkCredentials;
  }
): CashAppSignedNetworkRequest {
  const method = input.method;

  const path =
    requirePartnerCredential(
      input.path,
      "request path",
      1024
    );

  const host =
    requirePartnerCredential(
      input.host,
      "request host",
      256
    ).toLowerCase();

  const userAgent =
    requirePartnerCredential(
      input.userAgent,
      "User-Agent",
      256
    );

  const clientId =
    requirePartnerCredential(
      input.credentials.clientId,
      "client ID",
      256
    );

  const keyId =
    requirePartnerCredential(
      input.credentials.keyId,
      "API key ID",
      256
    );

  const apiSecret =
    requirePartnerCredential(
      input.credentials.apiSecret,
      "API secret",
      512
    );

  const region =
    normalizeCashAppRegion(
      input.credentials.region
    );

  if (!path.startsWith("/")) {
    throw new Error(
      "Cash App request path must begin with '/'."
    );
  }

  if (
    host !== "api.cash.app" &&
    host !== "sandbox.api.cash.app"
  ) {
    throw new Error(
      "Unsupported Cash App API host."
    );
  }

  const authorization =
    `Client ${clientId} ${keyId}`;

  const accept =
    "application/json";

  const contentType =
    input.body
      ? "application/json"
      : null;

  const bodyDigest =
    crypto
      .createHash("sha256")
      .update(
        Buffer.from(
          input.body,
          "utf8"
        )
      )
      .digest("hex")
      .toLowerCase();

  /*
   * Cash App documented canonical header order:
   *
   * accept
   * authorization
   * content-type
   * host
   */
  const canonicalHeaders = [
    `accept:${accept}`,
    `authorization:${authorization}`,
    ...(contentType
      ? [`content-type:${contentType}`]
      : []),
    `host:${host}`,
  ].join("\n");

  const canonicalRequest =
    `${method}\n` +
    `${path}\n` +
    `${canonicalHeaders}\n` +
    `${bodyDigest}`;

  const signature =
    crypto
      .createHmac(
        "sha256",
        apiSecret
      )
      .update(
        canonicalRequest,
        "utf8"
      )
      .digest("hex")
      .toLowerCase();

  return {
    method,
    path,
    host,
    body: input.body,

    headers: {
      Accept: accept,
      Authorization:
        authorization,
      ...(contentType
        ? {
            "Content-Type":
              contentType,
          }
        : {}),
      Host: host,
      "User-Agent":
        userAgent,
      "X-Region":
        region,
      "X-Signature":
        `V1 ${signature}`,
    },
  };
}

/**
 * Builds a signed Create Payment request,
 * but DOES NOT send it.
 */
export function buildSignedCashAppCreatePaymentRequest(
  input: {
    orderId: string;
    payment:
      CashAppPartnerPaymentInput;
    credentials:
      CashAppPartnerNetworkCredentials;
    sandbox: boolean;
  }
) {
  const request =
    buildCashAppPartnerPaymentRequest(
      input.orderId,
      input.payment
    );

  /*
   * This exact string must later be passed
   * unchanged to fetch() as the request body.
   */
  const body =
    JSON.stringify(request);

  const host =
    input.sandbox
      ? "sandbox.api.cash.app"
      : "api.cash.app";

  return signCashAppNetworkRequest({
    method: "POST",
    path:
      "/network/v1/payments",
    host,
    body,
    userAgent:
      "Kristo-App-SOKO/1.0",
    credentials:
      input.credentials,
  });
}


export type ParsedCashAppCustomerGrant = {
  grantId: string;
  customerId: string;
  requestId: string;
  actionType: "ONE_TIME_PAYMENT";
  merchantId: string;
  amountMinor: number;
  currency: "USD";
  status: "ACTIVE";
  grantType: "ONE_TIME";
  expiresAt: string;
};

function cashAppGrantRecord(
  value: unknown
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

function cashAppGrantString(
  value: unknown,
  label: string,
  max = 512
) {
  const text =
    typeof value === "string"
      ? value.trim()
      : "";

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

/**
 * Parse and verify a Cash App Network API
 * Retrieve Customer Grant response.
 *
 * IMPORTANT:
 * - response is untrusted provider JSON;
 * - expected identity is server-authoritative;
 * - this function does not write to DB;
 * - this function does not call Cash App.
 */
export function parseCashAppCustomerGrantResponse(
  input: {
    response: unknown;
    grantId: string;
    customerId: string;
    requestId: string;
    merchantId: string;
    amountMinor: number;
    currency: string;
  }
): ParsedCashAppCustomerGrant {
  const expectedGrantId =
    String(input.grantId || "")
      .trim();

  const expectedCustomerId =
    String(input.customerId || "")
      .trim();

  const expectedRequestId =
    String(input.requestId || "")
      .trim();

  const expectedMerchantId =
    String(input.merchantId || "")
      .trim();

  const expectedAmountMinor =
    input.amountMinor;

  const expectedCurrency =
    String(input.currency || "")
      .trim()
      .toUpperCase();

  if (
    !expectedGrantId ||
    !expectedCustomerId ||
    !expectedRequestId ||
    !expectedMerchantId ||
    typeof expectedAmountMinor !==
      "number" ||
    !Number.isSafeInteger(
      expectedAmountMinor
    ) ||
    expectedAmountMinor <= 0 ||
    expectedCurrency !== "USD"
  ) {
    throw new Error(
      "Cash App expected grant identity is invalid."
    );
  }

  const root =
    cashAppGrantRecord(
      input.response
    );

  const grant =
    cashAppGrantRecord(
      root?.grant
    );

  if (!root || !grant) {
    throw new Error(
      "Invalid Cash App grant response."
    );
  }

  const grantId =
    cashAppGrantString(
      grant.id,
      "grant ID"
    );

  const customerId =
    cashAppGrantString(
      grant.customer_id,
      "grant customer ID"
    );

  const requestId =
    cashAppGrantString(
      grant.request_id,
      "grant request ID"
    );

  /*
   * Current Cash App grant identifiers use
   * provider-specific prefixes. Exact expected
   * IDs still remain authoritative.
   */
  if (
    grantId !==
      expectedGrantId ||
    customerId !==
      expectedCustomerId ||
    requestId !==
      expectedRequestId
  ) {
    throw new Error(
      "Cash App grant provider identity mismatch."
    );
  }

  const action =
    cashAppGrantRecord(
      grant.action
    );

  if (!action) {
    throw new Error(
      "Invalid Cash App grant action."
    );
  }

  const actionType =
    cashAppGrantString(
      action.type,
      "grant action type",
      128
    );

  const merchantId =
    cashAppGrantString(
      action.scope_id,
      "grant merchant scope"
    );

  const amountMinor =
    action.amount;

  const currency =
    cashAppGrantString(
      action.currency,
      "grant currency",
      16
    ).toUpperCase();

  if (
    actionType !==
      "ONE_TIME_PAYMENT" ||
    merchantId !==
      expectedMerchantId ||
    typeof amountMinor !==
      "number" ||
    !Number.isSafeInteger(
      amountMinor
    ) ||
    amountMinor !==
      expectedAmountMinor ||
    currency !==
      expectedCurrency
  ) {
    throw new Error(
      "Cash App grant payment identity mismatch."
    );
  }

  const status =
    cashAppGrantString(
      grant.status,
      "grant status",
      40
    ).toUpperCase();

  if (status !== "ACTIVE") {
    throw new Error(
      "Cash App grant is not active."
    );
  }

  const grantType =
    cashAppGrantString(
      grant.type,
      "grant type",
      40
    ).toUpperCase();

  if (grantType !== "ONE_TIME") {
    throw new Error(
      "Cash App grant type mismatch."
    );
  }

  const expiresText =
    cashAppGrantString(
      grant.expires_at,
      "grant expiration",
      128
    );

  const expiresDate =
    new Date(expiresText);

  if (
    !Number.isFinite(
      expiresDate.getTime()
    ) ||
    expiresDate.getTime() <=
      Date.now()
  ) {
    throw new Error(
      "Cash App grant expiration is invalid or expired."
    );
  }

  return {
    grantId,
    customerId,
    requestId,

    actionType:
      "ONE_TIME_PAYMENT",

    merchantId,

    amountMinor:

      amountMinor as number,

    currency:
      "USD",

    status:
      "ACTIVE",

    grantType:
      "ONE_TIME",

    expiresAt:
      expiresDate.toISOString(),
  };
}


export type CashAppSignedRetrieveGrantRequest = {
  method: "GET";
  path: string;
  host: string;
  body: "";
  headers: {
    Accept: "application/json";
    Authorization: string;
    Host: string;
    "User-Agent": string;
    "X-Region": string;
    "X-Signature": string;
  };
};

/**
 * Builds a signed Network API request to retrieve
 * one Cash App customer grant.
 *
 * This function DOES NOT send the request.
 */
export function buildSignedCashAppRetrieveGrantRequest(
  input: {
    customerId: string;
    grantId: string;
    credentials:
      CashAppPartnerNetworkCredentials;
    sandbox: boolean;
  }
): CashAppSignedRetrieveGrantRequest {
  const customerId =
    String(input.customerId || "")
      .trim();

  const grantId =
    String(input.grantId || "")
      .trim();

  if (
    !customerId ||
    !grantId
  ) {
    throw new Error(
      "Cash App grant retrieval identity is required."
    );
  }

  if (
    customerId.includes("/") ||
    grantId.includes("/")
  ) {
    throw new Error(
      "Invalid Cash App grant retrieval identity."
    );
  }

  const path =
    `/network/v1/customers/${encodeURIComponent(
      customerId
    )}/grants/${encodeURIComponent(
      grantId
    )}`;

  const host =
    input.sandbox
      ? "sandbox.api.cash.app"
      : "api.cash.app";

  const signed =
    signCashAppNetworkRequest({
      method:
        "GET",
      path,
      host,
      body:
        "",
      userAgent:
        "Kristo-App-SOKO/1.0",
      credentials:
        input.credentials,
    });

  if (
    signed.method !==
      "GET" ||
    signed.path !==
      path ||
    signed.body !==
      ""
  ) {
    throw new Error(
      "Cash App signed grant retrieval request mismatch."
    );
  }

  if (
    "Content-Type" in
      signed.headers
  ) {
    throw new Error(
      "Cash App GET grant request must not include Content-Type."
    );
  }

  return signed as
    CashAppSignedRetrieveGrantRequest;
}

export type CashAppOneTimeCustomerRequestInput = {
  orderId: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
  redirectUrl: string;
};

export type CashAppOneTimeCustomerRequest = {
  idempotency_key: string;
  request: {
    actions: [
      {
        type: "ONE_TIME_PAYMENT";
        scope_id: string;
        amount: number;
        currency: string;
      }
    ];
    channel: "IN_APP";
    redirect_url: string;
    reference_id: string;
  };
};

/**
 * Builds the Customer Request used by a
 * Kristo App BUYER to authorize one payment.
 *
 * Seller merchant identity comes only from
 * the verified SOKO seller mapping.
 *
 * This function does NOT call Cash App.
 */
export function buildCashAppOneTimeCustomerRequest(
  input: CashAppOneTimeCustomerRequestInput
): CashAppOneTimeCustomerRequest {
  const orderId =
    String(input.orderId || "")
      .trim();

  const merchantId =
    String(input.merchantId || "")
      .trim();

  const currency =
    String(input.currency || "")
      .trim()
      .toUpperCase();

  const redirectUrl =
    String(input.redirectUrl || "")
      .trim();

  const amountMinor =
    Number(input.amountMinor);

  if (!orderId) {
    throw new Error(
      "Cash App customer request order ID is required."
    );
  }

  if (!merchantId) {
    throw new Error(
      "Cash App customer request merchant ID is required."
    );
  }

  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    throw new Error(
      "Cash App customer request amount is invalid."
    );
  }

  if (currency !== "USD") {
    throw new Error(
      "Cash App customer request currency must be USD."
    );
  }

  let parsedRedirect: URL;

  try {
    parsedRedirect =
      new URL(redirectUrl);
  } catch {
    throw new Error(
      "Cash App customer request redirect URL is invalid."
    );
  }

  if (
    parsedRedirect.protocol !== "https:"
  ) {
    throw new Error(
      "Cash App customer request redirect URL must use HTTPS."
    );
  }

  const referenceId =
    createCashAppServerReference(
      orderId
    );

  const idempotencyKey =
    createCashAppIdempotencyKey(
      `customer-request:${orderId}`
    );

  return {
    idempotency_key:
      idempotencyKey,

    request: {
      actions: [
        {
          type:
            "ONE_TIME_PAYMENT",

          scope_id:
            merchantId,

          amount:
            amountMinor,

          currency:
            currency,
        },
      ],

      /*
       * Kristo buyer is authorizing from the
       * native Kristo App, not a browser.
       */
      channel:
        "IN_APP",

      redirect_url:
        parsedRedirect.toString(),

      reference_id:
        referenceId,
    },
  };
}

export type CashAppCustomerRequestHttpRequest = {
  method: "POST";
  path: "/customer-request/v1/requests";
  host: string;
  body: string;
  headers: {
    Accept: "application/json";
    Authorization: string;
    "Content-Type": "application/json";
    "User-Agent": string;
  };
};

export type CashAppCustomerRequestAuthFlowTriggers = {
  qr_code_image_url?: string;
  qr_code_svg_url?: string;
  mobile_url?: string;
  desktop_url?: string;
  refreshes_at?: string;
};

export type CashAppCustomerRequestApiResponse = {
  request: {
    id: string;
    status: string;
    reference_id?: string;
    expires_at?: string;
    auth_flow_triggers?:
      CashAppCustomerRequestAuthFlowTriggers;
    grants?: Array<{
      id?: string;
      customer_id?: string;
    }>;
  };
};


export type ParsedCashAppCustomerRequestStatus =
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "failed";

export type ParsedCashAppCustomerRequestGrant = {
  grantId: string;
  customerId: string;
};

export type ParsedCashAppCustomerRequestResponse = {
  providerRequestId: string;
  referenceId: string;
  status: ParsedCashAppCustomerRequestStatus;
  expiresAt?: string;
  mobileUrl?: string;

  /*
   * Backward-compatible list used by the
   * existing dormant executor boundary.
   */
  grantIds: string[];

  /*
   * Provider-authoritative grant/customer
   * identity. Neither value comes from mobile.
   */
  grants: ParsedCashAppCustomerRequestGrant[];
};

function cashAppUnknownRecord(
  value: unknown
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

function cashAppRequiredString(
  value: unknown,
  label: string,
  maxLength = 1024
) {
  const text =
    typeof value === "string"
      ? value.trim()
      : "";

  if (
    !text ||
    text.length > maxLength
  ) {
    throw new Error(
      `Invalid Cash App ${label}.`
    );
  }

  return text;
}

function parseCashAppCustomerRequestStatus(
  value: unknown
): ParsedCashAppCustomerRequestStatus {
  const status =
    typeof value === "string"
      ? value.trim().toUpperCase()
      : "";

  if (status === "PENDING") {
    return "pending";
  }

  if (status === "APPROVED") {
    return "approved";
  }

  if (status === "DECLINED") {
    return "declined";
  }

  if (status === "EXPIRED") {
    return "expired";
  }

  if (status === "FAILED") {
    return "failed";
  }

  throw new Error(
    "Unsupported Cash App Customer Request status."
  );
}

function parseCashAppOptionalHttpsUrl(
  value: unknown,
  label: string
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const text =
    cashAppRequiredString(
      value,
      label,
      4096
    );

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    throw new Error(
      `Invalid Cash App ${label}.`
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `Invalid Cash App ${label}.`
    );
  }

  return url.toString();
}

/**
 * Parse and verify a Customer Request response
 * against the immutable server-authoritative
 * Kristo/SOKO payment identity.
 *
 * IMPORTANT:
 * - input.response is untrusted provider JSON.
 * - buyer/mobile values are not accepted here.
 * - this function does not write to the DB.
 * - this function does not call Cash App.
 */
export function parseCashAppCustomerRequestResponse(
  input: {
    response: unknown;
    referenceId: string;
    merchantId: string;
    amountMinor: number;
    currency: string;
  }
): ParsedCashAppCustomerRequestResponse {
  const expectedReferenceId =
    String(input.referenceId || "")
      .trim();

  const expectedMerchantId =
    String(input.merchantId || "")
      .trim();

  const expectedCurrency =
    String(input.currency || "")
      .trim()
      .toUpperCase();

  const expectedAmountMinor =
    Number(input.amountMinor);

  if (
    !expectedReferenceId ||
    !expectedMerchantId ||
    !Number.isSafeInteger(
      expectedAmountMinor
    ) ||
    expectedAmountMinor <= 0 ||
    expectedCurrency !== "USD"
  ) {
    throw new Error(
      "Cash App Customer Request expected identity is invalid."
    );
  }

  const root =
    cashAppUnknownRecord(
      input.response
    );

  const request =
    cashAppUnknownRecord(
      root?.request
    );

  if (!root || !request) {
    throw new Error(
      "Invalid Cash App Customer Request response."
    );
  }

  const providerRequestId =
    cashAppRequiredString(
      request.id,
      "Customer Request ID",
      512
    );

  if (
    !providerRequestId.startsWith(
      "GRR_"
    )
  ) {
    throw new Error(
      "Invalid Cash App Customer Request ID."
    );
  }

  const referenceId =
    cashAppRequiredString(
      request.reference_id,
      "Customer Request reference",
      512
    );

  if (
    referenceId !==
    expectedReferenceId
  ) {
    throw new Error(
      "Cash App Customer Request reference mismatch."
    );
  }

  const status =
    parseCashAppCustomerRequestStatus(
      request.status
    );

  const actions =
    Array.isArray(request.actions)
      ? request.actions
      : [];

  if (actions.length !== 1) {
    throw new Error(
      "Cash App Customer Request action count mismatch."
    );
  }

  const action =
    cashAppUnknownRecord(
      actions[0]
    );

  if (!action) {
    throw new Error(
      "Invalid Cash App Customer Request action."
    );
  }

  const actionType =
    cashAppRequiredString(
      action.type,
      "Customer Request action type",
      128
    );

  const scopeId =
    cashAppRequiredString(
      action.scope_id,
      "Customer Request merchant scope",
      512
    );

  const amount =
    action.amount;

  const currency =
    cashAppRequiredString(
      action.currency,
      "Customer Request currency",
      16
    ).toUpperCase();

  if (
    actionType !==
      "ONE_TIME_PAYMENT" ||
    scopeId !==
      expectedMerchantId ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount !==
      expectedAmountMinor ||
    currency !==
      expectedCurrency
  ) {
    throw new Error(
      "Cash App Customer Request payment identity mismatch."
    );
  }

  let expiresAt:
    | string
    | undefined;

  if (
    request.expires_at !==
      undefined &&
    request.expires_at !==
      null &&
    request.expires_at !== ""
  ) {
    const expiresText =
      cashAppRequiredString(
        request.expires_at,
        "Customer Request expiration",
        128
      );

    const expiresDate =
      new Date(expiresText);

    if (
      !Number.isFinite(
        expiresDate.getTime()
      )
    ) {
      throw new Error(
        "Invalid Cash App Customer Request expiration."
      );
    }

    expiresAt =
      expiresDate.toISOString();
  }

  const authFlow =
    cashAppUnknownRecord(
      request.auth_flow_triggers
    );

  const mobileUrl =
    authFlow
      ? parseCashAppOptionalHttpsUrl(
          authFlow.mobile_url,
          "Customer Request mobile URL"
        )
      : undefined;

  /*
   * A PENDING request must give the Kristo buyer
   * an authorization path before we can continue.
   */
  if (
    status === "pending" &&
    !mobileUrl
  ) {
    throw new Error(
      "Cash App pending Customer Request is missing mobile authorization URL."
    );
  }

  const rawGrants =
    Array.isArray(request.grants)
      ? request.grants
      : [];

  const grants =
    rawGrants.map(
      (value, index) => {
        const grant =
          cashAppUnknownRecord(
            value
          );

        if (!grant) {
          throw new Error(
            `Invalid Cash App grant at index ${index}.`
          );
        }

        const grantId =
          cashAppRequiredString(
            grant.id,
            "grant ID",
            512
          );

        /*
         * SECURITY:
         *
         * customer_id is accepted only from the
         * Cash App provider response. Kristo mobile
         * never supplies this identity.
         */
        const customerId =
          cashAppRequiredString(
            grant.customer_id,
            "grant customer ID",
            512
          );

        return {
          grantId,
          customerId,
        };
      }
    );

  const grantIds =
    grants.map(
      (grant) =>
        grant.grantId
    );

  if (
    new Set(grantIds).size !==
    grantIds.length
  ) {
    throw new Error(
      "Duplicate Cash App grant IDs."
    );
  }

  const grantIdentityKeys =
    grants.map(
      (grant) =>
        `${grant.customerId}\n${grant.grantId}`
    );

  if (
    new Set(grantIdentityKeys).size !==
    grantIdentityKeys.length
  ) {
    throw new Error(
      "Duplicate Cash App grant identities."
    );
  }

  return {
    providerRequestId,
    referenceId,
    status,
    expiresAt,
    mobileUrl,
    grantIds,
    grants,
  };
}

/**
 * Builds the exact Customer Request API HTTP request.
 *
 * Customer Request API authentication requires
 * only the Cash App client ID.
 *
 * This function DOES NOT send the request.
 */
export function buildCashAppCustomerRequestHttpRequest(
  input: {
    clientId: string;
    request: CashAppOneTimeCustomerRequest;
    sandbox: boolean;
  }
): CashAppCustomerRequestHttpRequest {
  const clientId =
    String(input.clientId || "")
      .trim();

  if (!clientId) {
    throw new Error(
      "Missing Cash App Partner client ID."
    );
  }

  const host =
    input.sandbox
      ? "sandbox.api.cash.app"
      : "api.cash.app";

  /*
   * Serialize once.
   * This exact string should later be sent
   * unchanged if network execution is enabled.
   */
  const body =
    JSON.stringify(input.request);

  return {
    method:
      "POST",

    path:
      "/customer-request/v1/requests",

    host,

    body,

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
  };
}
