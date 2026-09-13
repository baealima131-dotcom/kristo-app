export type CashAppPartnerEnvironment =
  | "sandbox"
  | "production";

export type CashAppPaymentStatusGroup =
  | "pending"
  | "captured"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "unknown";

export const CASH_APP_PAYMENT_STATUS_MAP = {
  pending: ["PENDING", "AUTHORIZED"],
  captured: ["CAPTURED", "COMPLETED"],
  failed: ["FAILED", "DECLINED"],
  cancelled: ["CANCELED", "CANCELLED"],
  expired: ["EXPIRED"],
  refunded: ["REFUNDED"],
} as const;

export type CashAppReconciliationReason =
  | "invalid_signature"
  | "environment_mismatch"
  | "recipient_mismatch"
  | "amount_mismatch"
  | "currency_mismatch"
  | "reference_mismatch"
  | "missing_reference"
  | "payment_id_reused"
  | "order_not_payable"
  | "duplicate_event_body_conflict"
  | "not_final_success";

export class SokoPaymentAccountMismatchError extends Error {
  readonly code = "PAYMENT_ACCOUNT_MISMATCH" as const;

  constructor() {
    super("PAYMENT_ACCOUNT_MISMATCH");
    this.name = "SokoPaymentAccountMismatchError";
  }
}

export function isApprovedCashAppHost(raw: string) {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === "cash.app" || host.endsWith(".cash.app");
  } catch {
    return false;
  }
}

export function isCashAppCashtagPrefillUrl(raw: string) {
  try {
    const url = new URL(String(raw || "").trim());
    return /^\/\$[A-Za-z0-9]+\/\d+(?:\.\d+)?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isCashAppPayPartnerSessionUrl(raw: string) {
  return (
    isApprovedCashAppHost(raw) &&
    !isCashAppCashtagPrefillUrl(raw)
  );
}

export function canAutomaticallyConfirmCashAppOrder(input: {
  hasPartnerMerchant: boolean;
  hasProviderPaymentId: boolean;
  isCashtagPrefillOnly: boolean;
}) {
  return (
    input.hasPartnerMerchant &&
    input.hasProviderPaymentId &&
    !input.isCashtagPrefillOnly
  );
}

export function normalizeCashTag(value: unknown) {
  return String(value || "")
    .replace(/^\$/, "")
    .trim()
    .toLowerCase();
}

export function classifyCashAppPaymentStatus(
  status: unknown
): CashAppPaymentStatusGroup {
  const normalized = String(status || "")
    .trim()
    .toUpperCase();

  for (const [group, values] of Object.entries(
    CASH_APP_PAYMENT_STATUS_MAP
  ) as Array<[CashAppPaymentStatusGroup, readonly string[]]>) {
    if (values.includes(normalized)) {
      return group;
    }
  }

  return "unknown";
}

export function isFinalSuccessfulCashAppPaymentStatus(
  status: unknown
) {
  return classifyCashAppPaymentStatus(status) === "captured";
}

export function isTerminalCashAppPaymentStatus(
  status: unknown
) {
  const group = classifyCashAppPaymentStatus(status);
  return (
    group === "captured" ||
    group === "failed" ||
    group === "cancelled" ||
    group === "expired" ||
    group === "refunded"
  );
}

export function isTerminalSokoOrderStatus(status: unknown) {
  return [
    "payment_approved",
    "preparing_shipment",
    "shipped",
    "delivered",
    "cancelled",
    "payment_rejected",
  ].includes(String(status || ""));
}

export function isPayableSokoOrderStatus(status: unknown) {
  return ["awaiting_payment", "payment_submitted"].includes(
    String(status || "")
  );
}

export function configuredCashAppPartnerEnvironment(
  sandboxFlag = process.env.CASH_APP_PARTNER_SANDBOX
): CashAppPartnerEnvironment {
  return String(sandboxFlag || "")
    .trim()
    .toLowerCase() === "true"
    ? "sandbox"
    : "production";
}

export function extractCashAppEventEnvironment(
  body: Record<string, unknown> | null | undefined
): CashAppPartnerEnvironment {
  const nested =
    body?.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : {};
  const event =
    body?.event && typeof body.event === "object"
      ? (body.event as Record<string, unknown>)
      : {};
  const raw = String(
    body?.environment ||
      nested.environment ||
      event.environment ||
      ""
  )
    .trim()
    .toLowerCase();

  if (
    raw.includes("sandbox") ||
    raw === "test" ||
    raw === "testing"
  ) {
    return "sandbox";
  }

  return "production";
}

export function cashAppWebhookEnvironmentMatches(input: {
  eventEnvironment: CashAppPartnerEnvironment;
  configuredEnvironment: CashAppPartnerEnvironment;
}) {
  return input.eventEnvironment === input.configuredEnvironment;
}

export function resolveApprovedCashAppRecipient(input: {
  listingCashTag: unknown;
  approvedCashTag: unknown;
  merchantId: unknown;
}):
  | {
      ok: true;
      cashTag: string;
      merchantId: string;
    }
  | {
      ok: false;
      code: "PAYMENT_ACCOUNT_MISMATCH" | "CASH_APP_SETUP_REQUIRED";
    } {
  const listingCashTag = normalizeCashTag(input.listingCashTag);
  const approvedCashTag = normalizeCashTag(input.approvedCashTag);
  const merchantId = String(input.merchantId || "").trim();

  if (approvedCashTag && listingCashTag && listingCashTag !== approvedCashTag) {
    return { ok: false, code: "PAYMENT_ACCOUNT_MISMATCH" };
  }

  if (!approvedCashTag && !merchantId) {
    return { ok: false, code: "CASH_APP_SETUP_REQUIRED" };
  }

  if (listingCashTag && !approvedCashTag) {
    /*
     * Listing cashtag is not proven against seller
     * payment configuration, so it cannot be used.
     * A verified merchant still allows partner-session checkout.
     */
    if (!merchantId) {
      return { ok: false, code: "CASH_APP_SETUP_REQUIRED" };
    }

    return {
      ok: true,
      cashTag: "",
      merchantId,
    };
  }

  return {
    ok: true,
    cashTag: approvedCashTag,
    merchantId,
  };
}

export function checkoutClientKeyForAttempt(input: {
  productId: string;
  rateId: string;
  postalCode: string;
  attemptId: string;
}) {
  const product = String(input.productId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 40);
  const rate = String(input.rateId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 40);
  const zip = String(input.postalCode || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 12);
  const attempt = String(input.attemptId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 16);

  return ("cashapp-" + product + "-" + rate + "-" + zip + "-" + attempt).slice(
    0,
    120
  );
}

export function shouldReuseCheckoutAttempt(input: {
  orderStatus: unknown;
}) {
  const status = String(input.orderStatus || "");
  return status === "awaiting_payment" || status === "payment_submitted";
}

export function shouldMintNewCheckoutAttempt(input: {
  orderStatus: unknown;
}) {
  return isTerminalSokoOrderStatus(input.orderStatus);
}

export function classifyCapturedWebhookMismatch(input: {
  expectedSellerUserId: string;
  actualSellerUserId: string;
  expectedAmountMinor: number;
  actualAmountMinor: number | null;
  expectedCurrency: string;
  actualCurrency: string;
  expectedReference: string;
  actualReference: string;
  payable: boolean;
  paymentIdConsumedByOtherOrder: boolean;
}): CashAppReconciliationReason | null {
  if (input.paymentIdConsumedByOtherOrder) {
    return "payment_id_reused";
  }

  if (!input.payable) {
    return "order_not_payable";
  }

  if (!String(input.actualReference || "").trim()) {
    return "missing_reference";
  }

  if (
    input.expectedReference &&
    input.actualReference !== input.expectedReference
  ) {
    return "reference_mismatch";
  }

  if (
    input.expectedSellerUserId &&
    input.actualSellerUserId &&
    input.expectedSellerUserId !== input.actualSellerUserId
  ) {
    return "recipient_mismatch";
  }

  if (
    input.actualAmountMinor === null ||
    input.actualAmountMinor !== input.expectedAmountMinor
  ) {
    return "amount_mismatch";
  }

  if (
    input.expectedCurrency.toUpperCase() !==
    input.actualCurrency.toUpperCase()
  ) {
    return "currency_mismatch";
  }

  return null;
}

export function cashAppCaptureAuditMetadata(input: {
  amountMinor: number;
  currency: string;
  eventType: string;
  paymentStatus: string;
}) {
  return {
    captured: true,
    amountMinor: input.amountMinor,
    currency: String(input.currency || "").toUpperCase(),
    eventType: String(input.eventType || "").slice(0, 120),
    paymentStatus: String(input.paymentStatus || "")
      .toUpperCase()
      .slice(0, 40),
    appliedAt: new Date().toISOString(),
  };
}
