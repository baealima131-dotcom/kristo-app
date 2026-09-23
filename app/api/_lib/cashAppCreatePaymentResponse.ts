import "server-only";

export type ParsedCashAppCreatePaymentStatus =
  | "AUTHORIZED"
  | "CAPTURED";

export type ParsedCashAppCreatePaymentResponse = {
  providerPaymentId: string;
  amountMinor: number;
  currency: "USD";
  customerId: string;
  merchantId: string;
  grantId: string;
  referenceId: string;
  status: ParsedCashAppCreatePaymentStatus;
  createdAt?: string;
  updatedAt?: string;
};

function record(
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

function requiredString(
  value: unknown,
  label: string,
  max = 1024
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

function optionalDate(
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
    requiredString(
      value,
      label,
      128
    );

  const date =
    new Date(text);

  if (
    !Number.isFinite(
      date.getTime()
    )
  ) {
    throw new Error(
      `Invalid Cash App ${label}.`
    );
  }

  return date.toISOString();
}

/**
 * Strict Create Payment provider-response parser.
 *
 * Provider JSON is untrusted until every payment
 * identity matches server-authoritative data.
 *
 * This function:
 * - does NOT write to DB;
 * - does NOT bind an order;
 * - does NOT approve an order;
 * - does NOT call Cash App.
 */
export function parseCashAppCreatePaymentResponse(
  input: {
    response: unknown;
    amountMinor: number;
    currency: string;
    merchantId: string;
    grantId: string;
    customerId: string;
    referenceId: string;
  }
): ParsedCashAppCreatePaymentResponse {
  const expectedAmount =
    input.amountMinor;

  const expectedCurrency =
    String(
      input.currency || ""
    )
      .trim()
      .toUpperCase();

  const expectedMerchantId =
    String(
      input.merchantId || ""
    ).trim();

  const expectedGrantId =
    String(
      input.grantId || ""
    ).trim();

  const expectedCustomerId =
    String(
      input.customerId || ""
    ).trim();

  const expectedReferenceId =
    String(
      input.referenceId || ""
    ).trim();

  if (
    typeof expectedAmount !==
      "number" ||
    !Number.isSafeInteger(
      expectedAmount
    ) ||
    expectedAmount <= 0 ||
    expectedCurrency !== "USD" ||
    !expectedMerchantId ||
    !expectedGrantId ||
    !expectedCustomerId ||
    !expectedReferenceId
  ) {
    throw new Error(
      "Cash App expected payment identity is invalid."
    );
  }

  const root =
    record(
      input.response
    );

  const payment =
    record(
      root?.payment
    );

  if (
    !root ||
    !payment
  ) {
    throw new Error(
      "Invalid Cash App Create Payment response."
    );
  }

  const providerPaymentId =
    requiredString(
      payment.id,
      "payment ID",
      512
    );

  if (
    !providerPaymentId.startsWith(
      "PWC_"
    )
  ) {
    throw new Error(
      "Invalid Cash App payment ID."
    );
  }

  const amountMinor =
    payment.amount;

  if (
    typeof amountMinor !==
      "number" ||
    !Number.isSafeInteger(
      amountMinor
    ) ||
    amountMinor !==
      expectedAmount
  ) {
    throw new Error(
      "Cash App payment amount mismatch."
    );
  }

  const currency =
    requiredString(
      payment.currency,
      "payment currency",
      16
    ).toUpperCase();

  if (
    currency !==
      expectedCurrency
  ) {
    throw new Error(
      "Cash App payment currency mismatch."
    );
  }

  const customerId =
    requiredString(
      payment.customer_id,
      "payment customer ID",
      512
    );

  if (
    customerId !==
      expectedCustomerId
  ) {
    throw new Error(
      "Cash App payment customer mismatch."
    );
  }

  const merchantId =
    requiredString(
      payment.merchant_id,
      "payment merchant ID",
      512
    );

  if (
    merchantId !==
      expectedMerchantId
  ) {
    throw new Error(
      "Cash App payment merchant mismatch."
    );
  }

  const grantId =
    requiredString(
      payment.grant_id,
      "payment grant ID",
      512
    );

  if (
    grantId !==
      expectedGrantId
  ) {
    throw new Error(
      "Cash App payment grant mismatch."
    );
  }

  const referenceId =
    requiredString(
      payment.reference_id,
      "payment reference",
      512
    );

  if (
    referenceId !==
      expectedReferenceId
  ) {
    throw new Error(
      "Cash App payment reference mismatch."
    );
  }

  const rawStatus =
    requiredString(
      payment.status,
      "payment status",
      64
    ).toUpperCase();

  /*
   * Fail closed.
   *
   * For our current create+capture flow we only
   * accept a successful provider payment state.
   * Other states can be added only after their
   * exact provider semantics are reviewed.
   */
  if (
    rawStatus !==
      "AUTHORIZED" &&
    rawStatus !==
      "CAPTURED"
  ) {
    throw new Error(
      "Unsupported Cash App Create Payment status."
    );
  }

  const status =
    rawStatus as
      ParsedCashAppCreatePaymentStatus;

  return {
    providerPaymentId,
    amountMinor,
    currency:
      "USD",
    customerId,
    merchantId,
    grantId,
    referenceId,
    status,
    createdAt:
      optionalDate(
        payment.created_at,
        "payment created timestamp"
      ),
    updatedAt:
      optionalDate(
        payment.updated_at,
        "payment updated timestamp"
      ),
  };
}
