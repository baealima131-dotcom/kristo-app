/**
 * SOKO Buyer Protection — Stage 0 policy / state machine.
 *
 * Honest language: SOKO does not hold funds. Cases mediate evidence and
 * recommend resolutions. Refunds between parties remain external.
 */

export const SOKO_PROTECTION_ENFORCEMENT_OBSERVE = "observe" as const;
export const SOKO_PROTECTION_ENFORCEMENT_REQUIRE = "require" as const;

export type SokoProtectionEnforcementMode =
  | typeof SOKO_PROTECTION_ENFORCEMENT_OBSERVE
  | typeof SOKO_PROTECTION_ENFORCEMENT_REQUIRE;

export type SokoProtectionRequestType =
  | "cancellation"
  | "return"
  | "dispute";

export type SokoProtectionCaseState =
  | "cancellation_requested"
  | "return_requested"
  | "dispute_opened"
  | "awaiting_seller_response"
  | "evidence_review"
  | "resolution_recommended"
  | "refund_external_pending"
  | "case_closed";

export type SokoProtectionActorRole =
  | "buyer"
  | "seller"
  | "admin"
  | "system";

export type SokoPaymentVerificationKind =
  | "provider_verified"
  | "seller_attested"
  | "unverified";

/** Public payment claim labels — never conflate with escrow or SOKO custody. */
export type SokoPaymentClaimLabel =
  | "payment_submitted_claim"
  | "seller_attested_payment"
  | "provider_verified_payment"
  | "payment_not_approved";

export type SokoProtectionResolutionCode =
  | "recommend_cancel_ok"
  | "recommend_return_ok"
  | "recommend_external_refund"
  | "recommend_seller_keep"
  | "recommend_no_action"
  | "dismiss_ineligible"
  | "dismiss_abusive";

export type SokoProtectionAdminAction =
  | "request_evidence"
  | "recommend_resolution"
  | "mark_external_refund_pending"
  | "report_external_refund_logged"
  | "close_case";

export type SokoProtectionSellerResponseKind =
  | "acknowledge"
  | "counter_evidence"
  | "decline_request";

export type SokoProtectionEvidenceType =
  | "payment_proof"
  | "chat_message"
  | "order_legacy_payment_proof"
  | "caption_note"
  | "shipping_note";

export type SokoProtectionTrustedReferenceType =
  | "payment_proof"
  | "order_legacy_payment_proof"
  | "chat_message"
  | "none";

/** Client fields that must never authorize identity, money, or outcome. */
export const SOKO_PROTECTION_CLIENT_SPOOF_KEYS = [
  "buyerId",
  "buyerUserId",
  "sellerId",
  "sellerUserId",
  "amount",
  "currency",
  "productId",
  "productIdentity",
  "paymentStatus",
  "paymentMethod",
  "deliveryState",
  "orderStatus",
  "shipmentStatus",
  "resolutionCode",
  "resolution_code",
  "outcome",
  "state",
  "paymentVerificationKind",
  "immutableOrderSnapshot",
  "immutableSnapshotHash",
] as const;

export type SokoProtectionEligibilityConfig = {
  sellerResponseHours: number;
  evidenceResponseHours: number;
  externalRefundWindowDays: number;
  returnWindowDaysAfterDelivery: number;
  returnWindowDaysAfterShippedIfUnconfirmed: number;
  disputeWindowDaysAfterDelivery: number;
  disputeWindowDaysAfterShippedIfUnconfirmed: number;
  /** Days after payment_approved when return/dispute still allowed before ship. */
  postPaymentWindowDaysBeforeShip: number;
};

export const SOKO_PROTECTION_DEFAULT_ELIGIBILITY: SokoProtectionEligibilityConfig =
  {
    sellerResponseHours: 48,
    evidenceResponseHours: 48,
    externalRefundWindowDays: 7,
    returnWindowDaysAfterDelivery: 14,
    returnWindowDaysAfterShippedIfUnconfirmed: 21,
    disputeWindowDaysAfterDelivery: 30,
    disputeWindowDaysAfterShippedIfUnconfirmed: 30,
    postPaymentWindowDaysBeforeShip: 30,
  };

const OPEN_CASE_STATES: ReadonlySet<SokoProtectionCaseState> = new Set([
  "cancellation_requested",
  "return_requested",
  "dispute_opened",
  "awaiting_seller_response",
  "evidence_review",
  "resolution_recommended",
  "refund_external_pending",
]);

const PRE_SHIP_STATUSES = new Set([
  "awaiting_delivery_quote",
  "delivery_quote_ready",
  "awaiting_payment",
  "payment_submitted",
  "payment_approved",
  "payment_rejected",
  "preparing_shipment",
]);

const PAID_OR_LATER = new Set([
  "payment_approved",
  "preparing_shipment",
  "shipped",
  "delivered",
]);

const PROVIDER_PAYMENT_METHODS = new Set(["stripe_card"]);
const PROVIDER_PAYMENT_PROVIDERS = new Set(["stripe", "cash_app"]);

export function sokoProtectionEnforcementMode(): SokoProtectionEnforcementMode {
  const raw = String(process.env.SOKO_PROTECTION_ENFORCEMENT || "")
    .trim()
    .toLowerCase();
  return raw === SOKO_PROTECTION_ENFORCEMENT_REQUIRE
    ? SOKO_PROTECTION_ENFORCEMENT_REQUIRE
    : SOKO_PROTECTION_ENFORCEMENT_OBSERVE;
}

/**
 * Stage 0: observe mode never blocks order fulfillment.
 * Require mode is reserved for a later rollout; do not wire Production env yet.
 */
export function protectionBlocksOrderFulfillment(
  mode: SokoProtectionEnforcementMode = sokoProtectionEnforcementMode()
) {
  return mode === SOKO_PROTECTION_ENFORCEMENT_REQUIRE;
}

export function cleanSokoProtectionText(value: unknown, max = 80) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

export function isOpenProtectionCaseState(state: string) {
  return OPEN_CASE_STATES.has(state as SokoProtectionCaseState);
}

export function initialStateForRequestType(
  requestType: SokoProtectionRequestType
): SokoProtectionCaseState {
  if (requestType === "cancellation") return "cancellation_requested";
  if (requestType === "return") return "return_requested";
  return "dispute_opened";
}

export function classifyPaymentVerification(input: {
  orderStatus: string;
  paymentMethod: string;
  paymentProvider?: string | null;
  providerPaymentId?: string | null;
}): SokoPaymentVerificationKind {
  const status = cleanSokoProtectionText(input.orderStatus, 40);
  const method = cleanSokoProtectionText(input.paymentMethod, 40);
  const provider = cleanSokoProtectionText(input.paymentProvider, 40);
  const providerPaymentId = cleanSokoProtectionText(
    input.providerPaymentId,
    180
  );

  const paidOrLater = PAID_OR_LATER.has(status);
  if (!paidOrLater) return "unverified";

  const providerVerified =
    Boolean(providerPaymentId) &&
    (PROVIDER_PAYMENT_METHODS.has(method) ||
      PROVIDER_PAYMENT_PROVIDERS.has(provider) ||
      method === "cash_app");

  if (providerVerified) return "provider_verified";
  return "seller_attested";
}

export function paymentClaimLabel(input: {
  orderStatus: string;
  verificationKind: SokoPaymentVerificationKind;
}): SokoPaymentClaimLabel {
  const status = cleanSokoProtectionText(input.orderStatus, 40);
  if (status === "payment_submitted") return "payment_submitted_claim";
  if (input.verificationKind === "provider_verified") {
    return "provider_verified_payment";
  }
  if (input.verificationKind === "seller_attested") {
    return "seller_attested_payment";
  }
  return "payment_not_approved";
}

export function daysBetween(fromIso: string, to: Date = new Date()) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return Number.POSITIVE_INFINITY;
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
}

export function evaluateProtectionCaseEligibility(input: {
  requestType: SokoProtectionRequestType;
  orderStatus: string;
  paymentApprovedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  now?: Date;
  config?: Partial<SokoProtectionEligibilityConfig>;
}): { ok: true } | { ok: false; error: string; code: string } {
  const config = {
    ...SOKO_PROTECTION_DEFAULT_ELIGIBILITY,
    ...(input.config || {}),
  };
  const now = input.now || new Date();
  const status = cleanSokoProtectionText(input.orderStatus, 40);

  if (status === "cancelled") {
    return {
      ok: false,
      error: "This order is already cancelled.",
      code: "order_cancelled",
    };
  }

  if (input.requestType === "cancellation") {
    if (!PRE_SHIP_STATUSES.has(status)) {
      return {
        ok: false,
        error: "Cancellation is only available before the order is shipped.",
        code: "cancellation_not_eligible",
      };
    }
    return { ok: true };
  }

  if (!PAID_OR_LATER.has(status)) {
    return {
      ok: false,
      error:
        "Return and dispute cases require a seller-attested or provider-verified payment approval.",
      code: "payment_not_approved",
    };
  }

  const windowDays =
    input.requestType === "return"
      ? status === "delivered"
        ? config.returnWindowDaysAfterDelivery
        : status === "shipped"
          ? config.returnWindowDaysAfterShippedIfUnconfirmed
          : config.postPaymentWindowDaysBeforeShip
      : status === "delivered"
        ? config.disputeWindowDaysAfterDelivery
        : status === "shipped"
          ? config.disputeWindowDaysAfterShippedIfUnconfirmed
          : config.postPaymentWindowDaysBeforeShip;

  const anchor =
    status === "delivered" && input.deliveredAt
      ? input.deliveredAt
      : status === "shipped" && input.shippedAt
        ? input.shippedAt
        : input.paymentApprovedAt || null;

  if (anchor && daysBetween(anchor, now) > windowDays) {
    return {
      ok: false,
      error: `The ${input.requestType} window for this order has closed.`,
      code: "window_closed",
    };
  }

  return { ok: true };
}

export type ProtectionTransition =
  | {
      from: SokoProtectionCaseState;
      to: SokoProtectionCaseState;
      actor: SokoProtectionActorRole;
      eventType: string;
    };

const TRANSITIONS: ProtectionTransition[] = [
  {
    from: "cancellation_requested",
    to: "awaiting_seller_response",
    actor: "system",
    eventType: "case_opened_awaiting_seller",
  },
  {
    from: "return_requested",
    to: "awaiting_seller_response",
    actor: "system",
    eventType: "case_opened_awaiting_seller",
  },
  {
    from: "dispute_opened",
    to: "awaiting_seller_response",
    actor: "system",
    eventType: "case_opened_awaiting_seller",
  },
  {
    from: "awaiting_seller_response",
    to: "evidence_review",
    actor: "seller",
    eventType: "seller_responded",
  },
  {
    from: "awaiting_seller_response",
    to: "evidence_review",
    actor: "system",
    eventType: "seller_deadline_missed",
  },
  {
    from: "evidence_review",
    to: "evidence_review",
    actor: "admin",
    eventType: "evidence_requested",
  },
  {
    from: "evidence_review",
    to: "resolution_recommended",
    actor: "admin",
    eventType: "resolution_recommended",
  },
  {
    from: "evidence_review",
    to: "case_closed",
    actor: "admin",
    eventType: "case_closed",
  },
  {
    from: "resolution_recommended",
    to: "refund_external_pending",
    actor: "admin",
    eventType: "external_refund_pending",
  },
  {
    from: "resolution_recommended",
    to: "case_closed",
    actor: "admin",
    eventType: "case_closed",
  },
  {
    from: "refund_external_pending",
    to: "case_closed",
    actor: "admin",
    eventType: "case_closed",
  },
  {
    from: "refund_external_pending",
    to: "case_closed",
    actor: "admin",
    eventType: "external_refund_reported",
  },
];

export function listProtectionTransitions() {
  return TRANSITIONS.slice();
}

export function canTransitionProtectionCase(input: {
  from: SokoProtectionCaseState;
  to: SokoProtectionCaseState;
  actor: SokoProtectionActorRole;
  eventType?: string;
}) {
  return TRANSITIONS.some(
    (row) =>
      row.from === input.from &&
      row.to === input.to &&
      row.actor === input.actor &&
      (!input.eventType || row.eventType === input.eventType)
  );
}

export function assertPartyCannotSetOutcome(input: {
  actorRole: SokoProtectionActorRole;
  resolutionCode?: unknown;
  outcome?: unknown;
  closeCase?: unknown;
  markExternalRefundCompleted?: unknown;
}) {
  if (input.actorRole === "admin" || input.actorRole === "system") {
    return { ok: true as const };
  }
  if (
    input.resolutionCode != null ||
    input.outcome != null ||
    input.closeCase === true ||
    input.markExternalRefundCompleted === true
  ) {
    return {
      ok: false as const,
      error:
        "Buyers and sellers cannot set case outcomes, close cases administratively, or claim an external refund completed for the other party.",
      code: "outcome_forbidden",
    };
  }
  return { ok: true as const };
}

export function stripProtectionClientSpoof(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {} as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
  };
  for (const key of SOKO_PROTECTION_CLIENT_SPOOF_KEYS) {
    delete next[key];
  }
  return next;
}

export function parseOpenProtectionCaseBody(body: unknown) {
  const cleaned = stripProtectionClientSpoof(body);
  const orderId = cleanSokoProtectionText(cleaned.orderId, 100);
  const requestTypeRaw = cleanSokoProtectionText(cleaned.requestType, 40);
  const reasonCode = cleanSokoProtectionText(cleaned.reasonCode, 80);
  const description = cleanSokoProtectionText(cleaned.description, 2000);
  const requestType =
    requestTypeRaw === "cancellation" ||
    requestTypeRaw === "return" ||
    requestTypeRaw === "dispute"
      ? requestTypeRaw
      : "";

  if (!orderId) {
    return {
      ok: false as const,
      status: 400,
      error: "orderId is required.",
      code: "missing_order_id",
    };
  }
  if (!requestType) {
    return {
      ok: false as const,
      status: 400,
      error: "requestType must be cancellation, return, or dispute.",
      code: "invalid_request_type",
    };
  }
  if (!reasonCode) {
    return {
      ok: false as const,
      status: 400,
      error: "reasonCode is required.",
      code: "missing_reason_code",
    };
  }

  return {
    ok: true as const,
    orderId,
    requestType,
    reasonCode,
    description,
  };
}

export function deadlineEscalationTarget(input: {
  state: SokoProtectionCaseState;
  sellerResponseDeadline?: string | null;
  now?: Date;
}): SokoProtectionCaseState | null {
  const now = input.now || new Date();
  if (input.state !== "awaiting_seller_response") return null;
  if (!input.sellerResponseDeadline) return null;
  const due = new Date(input.sellerResponseDeadline);
  if (Number.isNaN(due.getTime()) || due.getTime() > now.getTime()) {
    return null;
  }
  // Missed seller SLA escalates to evidence review — never auto-refund.
  return "evidence_review";
}

export function hoursFromNow(hours: number, now: Date = new Date()) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function daysFromNow(days: number, now: Date = new Date()) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function publicProtectionCaseLanguage(input: {
  state: SokoProtectionCaseState;
  paymentClaim: SokoPaymentClaimLabel;
  resolutionCode?: string | null;
}) {
  const resolutionNotice =
    input.state === "resolution_recommended"
      ? "resolution_recommended"
      : input.state === "refund_external_pending"
        ? "external_refund_pending"
        : input.state === "case_closed" &&
            input.resolutionCode === "recommend_external_refund"
          ? "external_refund_reported"
          : null;

  return {
    paymentClaim: input.paymentClaim,
    caseState: input.state,
    resolutionNotice,
    /** Explicit non-claims for clients / copy checks. */
    isEscrow: false,
    isGuaranteedRefund: false,
    isVerifiedDelivery: false,
    holdsBuyerFunds: false,
    summary:
      "SOKO Buyer Protection reviews evidence and may recommend a resolution. SOKO does not hold buyer funds and does not process refunds.",
  };
}

export function forbiddenHonestLanguagePatterns() {
  return [
    /SOKO refunded/i,
    /guaranteed refund/i,
    /\bescrow\b/i,
    /verified delivery/i,
  ];
}
