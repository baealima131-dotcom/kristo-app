/**
 * Kristo System Admin — Buyer Protection review labels (Stage 2).
 * Honest language only. Never claims escrow, guaranteed refunds, or SOKO payouts.
 */

export type SokoProtectionAdminFilter =
  | "all"
  | "awaiting_seller"
  | "evidence_review"
  | "resolution_recommended"
  | "external_refund_pending"
  | "closed"
  | "overdue";

export type SokoProtectionAdminAction =
  | "request_evidence"
  | "recommend_resolution"
  | "mark_external_refund_pending"
  | "report_external_refund_logged"
  | "close_case";

export type SokoProtectionResolutionCode =
  | "recommend_cancel_ok"
  | "recommend_return_ok"
  | "recommend_external_refund"
  | "recommend_seller_keep"
  | "recommend_no_action"
  | "dismiss_ineligible"
  | "dismiss_abusive";

export const SOKO_PROTECTION_ADMIN_RESOLUTION_CODES: SokoProtectionResolutionCode[] =
  [
    "recommend_cancel_ok",
    "recommend_return_ok",
    "recommend_external_refund",
    "recommend_seller_keep",
    "recommend_no_action",
    "dismiss_ineligible",
    "dismiss_abusive",
  ];

export const SOKO_PROTECTION_ADMIN_HONEST_DISCLAIMER =
  "SOKO Buyer Protection reviews evidence and may recommend a resolution. SOKO does not hold buyer funds, does not process refunds, and does not guarantee outcomes.";

const FORBIDDEN = [
  /guaranteed refund/i,
  /\bescrow\b/i,
  /SOKO refunded/i,
  /money held/i,
  /verified delivery/i,
];

export function protectionAdminForbiddenLanguageHits(text: string) {
  return FORBIDDEN.filter((pattern) => pattern.test(String(text || "")));
}

export function protectionCaseStateLabel(state: string) {
  const map: Record<string, string> = {
    cancellation_requested: "Cancellation requested",
    return_requested: "Return requested",
    dispute_opened: "Dispute opened",
    awaiting_seller_response: "Awaiting seller response",
    evidence_review: "Evidence under review",
    resolution_recommended: "Recommended resolution",
    refund_external_pending: "External refund pending",
    case_closed: "Closed",
  };
  return map[String(state || "")] || String(state || "Unknown");
}

export function protectionRequestTypeLabel(requestType: string) {
  const map: Record<string, string> = {
    cancellation: "Cancellation",
    return: "Return",
    dispute: "Dispute",
  };
  return map[String(requestType || "")] || String(requestType || "Case");
}

export function paymentVerificationKindLabel(kind: string) {
  const map: Record<string, string> = {
    provider_verified: "Provider-verified payment",
    seller_attested: "Seller-attested payment",
    unverified: "Payment not verified",
  };
  return map[String(kind || "")] || "Payment not verified";
}

export function paymentClaimLabelText(claim: string) {
  const map: Record<string, string> = {
    provider_verified_payment: "Provider-verified payment",
    seller_attested_payment: "Seller-attested payment",
    payment_submitted_claim: "Payment submitted — awaiting verification",
    payment_not_approved: "Payment not verified",
  };
  return map[String(claim || "")] || paymentVerificationKindLabel(claim);
}

export function protectionEventLabel(eventType: string) {
  const map: Record<string, string> = {
    case_opened: "Case opened",
    case_opened_awaiting_seller: "Seller response requested",
    seller_responded: "Seller responded",
    seller_deadline_missed: "Seller response deadline passed",
    evidence_added: "Evidence added",
    evidence_requested: "More evidence requested",
    resolution_recommended: "Recommended resolution",
    external_refund_pending: "External refund pending",
    external_refund_reported: "External refund reported",
    case_closed: "Case closed",
  };
  return map[String(eventType || "")] || String(eventType || "Event");
}

export function resolutionCodeLabel(code: string) {
  const map: Record<string, string> = {
    recommend_cancel_ok: "Recommend cancellation",
    recommend_return_ok: "Recommend return",
    recommend_external_refund: "Recommend external refund",
    recommend_seller_keep: "Recommend seller keep item/funds",
    recommend_no_action: "Recommend no further action",
    dismiss_ineligible: "Dismiss — ineligible",
    dismiss_abusive: "Dismiss — abusive",
  };
  return map[String(code || "")] || String(code || "Resolution");
}

export function adminActionLabel(action: SokoProtectionAdminAction) {
  const map: Record<SokoProtectionAdminAction, string> = {
    request_evidence: "Request more evidence",
    recommend_resolution: "Recommend a resolution",
    mark_external_refund_pending: "Mark external refund pending",
    report_external_refund_logged: "Record externally reported refund",
    close_case: "Close case",
  };
  return map[action];
}

/** Server-supported transitions mirrored for UI enablement only — server still decides. */
export function adminActionsForState(state: string): SokoProtectionAdminAction[] {
  switch (String(state || "")) {
    case "evidence_review":
      return ["request_evidence", "recommend_resolution", "close_case"];
    case "resolution_recommended":
      return ["mark_external_refund_pending", "close_case"];
    case "refund_external_pending":
      return ["report_external_refund_logged", "close_case"];
    default:
      return [];
  }
}

export function filterToApiState(
  filter: SokoProtectionAdminFilter
): string | null {
  if (filter === "awaiting_seller") return "awaiting_seller_response";
  if (filter === "evidence_review") return "evidence_review";
  if (filter === "resolution_recommended") return "resolution_recommended";
  if (filter === "external_refund_pending") return "refund_external_pending";
  if (filter === "closed") return "case_closed";
  return null;
}

export function isSellerResponseOverdue(input: {
  state: string;
  sellerResponseDeadline?: string | null;
  now?: Date;
}) {
  if (String(input.state || "") !== "awaiting_seller_response") return false;
  const raw = String(input.sellerResponseDeadline || "").trim();
  if (!raw) return false;
  const due = Date.parse(raw);
  if (!Number.isFinite(due)) return false;
  return due < (input.now || new Date()).getTime();
}

export function deadlineStatusLabel(input: {
  state: string;
  sellerResponseDeadline?: string | null;
  evidenceDeadline?: string | null;
  externalRefundDeadline?: string | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  if (isSellerResponseOverdue({ ...input, now })) {
    return "Overdue — seller response";
  }
  const candidates: Array<{ label: string; at: string | null | undefined }> = [
    {
      label: "Seller response by",
      at:
        input.state === "awaiting_seller_response"
          ? input.sellerResponseDeadline
          : null,
    },
    {
      label: "Evidence by",
      at: input.state === "evidence_review" ? input.evidenceDeadline : null,
    },
    {
      label: "External refund window by",
      at:
        input.state === "refund_external_pending"
          ? input.externalRefundDeadline
          : null,
    },
  ];
  for (const row of candidates) {
    const raw = String(row.at || "").trim();
    if (!raw) continue;
    const due = Date.parse(raw);
    if (!Number.isFinite(due)) continue;
    const when = new Date(due).toLocaleString();
    if (due < now.getTime()) return `Overdue — ${row.label} ${when}`;
    return `${row.label} ${when}`;
  }
  return "No active deadline";
}

export function frozenProductTitle(snapshot: Record<string, unknown> | null | undefined) {
  const root = snapshot && typeof snapshot === "object" ? snapshot : {};
  const product =
    root.product && typeof root.product === "object"
      ? (root.product as Record<string, unknown>)
      : root;
  const candidates = [
    product.title,
    product.name,
    product.productTitle,
    product.product_name,
    root.productTitle,
    root.title,
  ];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "Untitled product";
}

export const ORDER_AT_CASE_OPENING_LABEL = "Order at case opening";
export const CURRENT_ORDER_STATUS_LABEL = "Current order status";
export const CURRENT_ORDER_STATUS_UNAVAILABLE =
  "Current order status unavailable";

export function orderStatusAtOpen(snapshot: Record<string, unknown> | null | undefined) {
  const root = snapshot && typeof snapshot === "object" ? snapshot : {};
  return String(root.orderStatusAtOpen || "").trim();
}

/** Frozen snapshot status only. Never reads live order status. */
export function orderAtCaseOpeningDisplay(
  snapshot: Record<string, unknown> | null | undefined
) {
  const status = orderStatusAtOpen(snapshot);
  return status || "Unavailable";
}

/**
 * Live order status only. Never falls back to the immutable snapshot.
 */
export function currentOrderStatusDisplay(liveOrderStatus: unknown) {
  const live = String(liveOrderStatus ?? "").trim();
  if (!live || live === "null" || live === "undefined") {
    return CURRENT_ORDER_STATUS_UNAVAILABLE;
  }
  return live;
}

export function trimmedAdminNote(note: unknown) {
  return String(note ?? "").trim();
}

export function canConfirmAdminNote(note: unknown) {
  return trimmedAdminNote(note).length > 0;
}

/** Defensive submit gate. Throws on empty or whitespace-only notes. */
export function requireAdminActionNote(note: unknown) {
  const trimmed = trimmedAdminNote(note);
  if (!trimmed) {
    throw new Error("An admin note is required before confirming.");
  }
  return trimmed;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Awaiting payment",
  payment_submitted: "Payment submitted",
  payment_approved: "Payment approved",
  payment_rejected: "Payment rejected",
  preparing: "Preparing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  completed: "Completed",
  refunded: "Refunded outside this review",
};

export function paymentMethodLabel(method: string) {
  const map: Record<string, string> = {
    cash: "Cash",
    cash_app: "Cash App",
    mobile_money: "Mobile money",
    stripe_card: "Card",
  };
  const raw = String(method || "").trim();
  return map[raw] || (raw ? raw.replace(/_/g, " ") : "Unavailable");
}

export function paymentStatusChip(kind: string) {
  const map: Record<string, string> = {
    provider_verified: "Provider verified",
    seller_attested: "Seller attested",
    unverified: "Not verified",
  };
  return map[String(kind || "")] || "Not verified";
}

export function conciseOrderStatusPair(opening: string, current: string) {
  const left = String(opening || "").trim();
  const right = String(current || "").trim();
  if (left && right && left === right) {
    return { same: true as const, label: left };
  }
  return { same: false as const, opening: left, current: right };
}

export function buyerIssueSentence(input: {
  requestType: string;
  sellerResponded: boolean;
  sellerKind?: string;
}) {
  const request = protectionRequestTypeLabel(input.requestType).toLowerCase();
  const seller = !input.sellerResponded
    ? "Seller has not responded."
    : String(input.sellerKind || "") === "acknowledge"
      ? "Seller acknowledged the request."
      : "Seller responded.";
  return `Buyer requested ${request}. ${seller}`;
}

export function humanOrderStatusLabel(status: string) {
  const raw = String(status || "").trim();
  if (!raw || raw === "Unavailable" || raw === CURRENT_ORDER_STATUS_UNAVAILABLE) {
    return raw || "Unavailable";
  }
  return ORDER_STATUS_LABELS[raw] || raw.replace(/_/g, " ");
}

export function trustedHttpsImage(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^https:\/\/[^\s]{8,480}$/i.test(text)) return null;
  if (/base64/i.test(text) || text.startsWith("https://data:")) return null;
  return text;
}

function productRecord(snapshot: Record<string, unknown> | null | undefined) {
  const root = snapshot && typeof snapshot === "object" ? snapshot : {};
  const product =
    root.product && typeof root.product === "object"
      ? (root.product as Record<string, unknown>)
      : {};
  return { root, product };
}

export function frozenProductImageUrl(
  snapshot: Record<string, unknown> | null | undefined
) {
  const { product } = productRecord(snapshot);
  const photos = Array.isArray(product.photos) ? product.photos : [];
  const candidates = [product.image, ...photos];
  for (const value of candidates) {
    const url = trustedHttpsImage(value);
    if (url) return url;
  }
  return null;
}

export function frozenMoney(
  snapshot: Record<string, unknown> | null | undefined
) {
  const { product } = productRecord(snapshot);
  const totals =
    product.totals && typeof product.totals === "object"
      ? (product.totals as Record<string, unknown>)
      : {};
  const amount = Number(product.price ?? totals.itemPrice);
  const currency = String(product.currency || totals.currency || "").trim();
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: currency || null };
}

export function frozenQuantity(
  snapshot: Record<string, unknown> | null | undefined
) {
  const { product } = productRecord(snapshot);
  const inventory =
    product.inventory && typeof product.inventory === "object"
      ? (product.inventory as Record<string, unknown>)
      : {};
  const quantity = Number(inventory.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

export function frozenVariant(
  snapshot: Record<string, unknown> | null | undefined
) {
  const { product } = productRecord(snapshot);
  const value = product.variant ?? product.selectedVariant ?? product.option;
  const text = String(value || "").trim();
  return text || null;
}

export function deliveryMethodLabel(
  snapshot: Record<string, unknown> | null | undefined
) {
  const { product } = productRecord(snapshot);
  const delivery =
    product.delivery && typeof product.delivery === "object"
      ? (product.delivery as Record<string, unknown>)
      : {};
  const fulfillment =
    product.fulfillment && typeof product.fulfillment === "object"
      ? (product.fulfillment as Record<string, unknown>)
      : {};
  const service = String(delivery.service || "").trim();
  const type = String(delivery.type || fulfillment.type || "").trim();
  const typeLabel = type.replace(/_/g, " ");
  if (service && typeLabel) {
    const serviceKey = service.toLowerCase();
    const typeKey = typeLabel.toLowerCase();
    if (serviceKey === typeKey || serviceKey.includes(typeKey)) return service;
    return `${typeLabel} · ${service}`;
  }
  if (service) return service;
  if (typeLabel) return typeLabel;
  return "Delivery method unavailable";
}

/** City / region only. Never returns street, phone, or postal code. */
export function shippingAreaSummary(
  snapshot: Record<string, unknown> | null | undefined
) {
  const { product } = productRecord(snapshot);
  const details =
    product.deliveryDetails && typeof product.deliveryDetails === "object"
      ? (product.deliveryDetails as Record<string, unknown>)
      : {};
  const parts = [details.city, details.state, details.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export type AdminPartyView = {
  userId?: string;
  displayName?: string | null;
  kristoId?: string | null;
  avatarUrl?: string | null;
  profileStatus?: string | null;
};

export function trustedParty(input: {
  side: "buyer" | "seller";
  buyerUserId: string;
  sellerUserId: string;
  parties?: { buyer?: AdminPartyView | null; seller?: AdminPartyView | null } | null;
}) {
  const expected =
    input.side === "buyer" ? input.buyerUserId : input.sellerUserId;
  const party =
    input.side === "buyer" ? input.parties?.buyer : input.parties?.seller;
  if (!party || String(party.userId || "") !== String(expected || "")) {
    return {
      userId: String(expected || ""),
      displayName: null,
      kristoId: null,
      avatarUrl: null,
      profileStatus: null,
    };
  }
  return {
    userId: String(party.userId || expected || ""),
    displayName: String(party.displayName || "").trim() || null,
    kristoId: String(party.kristoId || "").trim() || null,
    avatarUrl: trustedHttpsImage(party.avatarUrl),
    profileStatus: String(party.profileStatus || "").trim() || null,
  };
}

export function partyPrimaryLabel(party: AdminPartyView) {
  const name = String(party.displayName || "").trim();
  if (name) return name;
  const kristoId = String(party.kristoId || "").trim();
  if (kristoId) return shortKristoId(kristoId);
  return shortUserRef(String(party.userId || ""));
}

export function shortKristoId(value: string) {
  const id = String(value || "").trim();
  if (!id) return "—";
  return id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function shortCaseRef(caseId: string) {
  const id = String(caseId || "").trim();
  if (!id) return "—";
  return id.length <= 12 ? id : `…${id.slice(-8)}`;
}

export function reasonPlainLabel(reasonCode: string) {
  const raw = String(reasonCode || "").trim();
  if (!raw) return "Reason not recorded";
  return raw.replace(/_/g, " ");
}

export function waitingSinceLabel(createdAt?: string | null, now = new Date()) {
  const opened = Date.parse(String(createdAt || ""));
  if (!Number.isFinite(opened)) return "Waiting time unavailable";
  const minutes = Math.max(0, Math.round((now.getTime() - opened) / 60000));
  if (minutes < 60) return `Waiting ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Waiting ${hours}h`;
  return `Waiting ${Math.round(hours / 24)}d`;
}

export function evidenceOwnerSide(input: {
  submittedByUserId: string;
  buyerUserId: string;
  sellerUserId: string;
}) {
  if (input.submittedByUserId && input.submittedByUserId === input.buyerUserId) {
    return "Buyer" as const;
  }
  if (input.submittedByUserId && input.submittedByUserId === input.sellerUserId) {
    return "Seller" as const;
  }
  return "System" as const;
}

export function evidenceSourceLabel(referenceType: string) {
  const map: Record<string, string> = {
    payment_proof: "Trusted payment-proof reference",
    order_legacy_payment_proof: "Trusted order proof reference",
    chat_message: "Trusted chat reference",
    none: "Note only",
  };
  return map[String(referenceType || "")] || "Reference";
}

export function adminActionEffect(action: SokoProtectionAdminAction) {
  const map: Record<SokoProtectionAdminAction, string> = {
    request_evidence:
      "The case remains open and no refund is initiated.",
    recommend_resolution:
      "This records a recommendation, not an automatic refund.",
    close_case:
      "This closes the review record and does not itself move money.",
    mark_external_refund_pending:
      "External refund pending means refund handling occurs outside SOKO and has not been confirmed complete.",
    report_external_refund_logged:
      "This records an external report only. It is not a completed payout and does not move funds.",
  };
  return map[action];
}

export function adminActionMeaning(action: SokoProtectionAdminAction) {
  const map: Record<SokoProtectionAdminAction, string> = {
    request_evidence:
      "Ask for more evidence. The review stays open.",
    recommend_resolution:
      "Choose an allowed resolution and write a clear summary.",
    close_case: "Close this review record without moving money.",
    mark_external_refund_pending:
      "Note that any refund is being handled outside SOKO.",
    report_external_refund_logged:
      "Record that an outside refund was reported. This is not a SOKO payout.",
  };
  return map[action];
}

export function canConfirmResolutionChoice(
  action: string | null,
  resolutionCode: string
) {
  if (action !== "recommend_resolution") return true;
  return SOKO_PROTECTION_ADMIN_RESOLUTION_CODES.includes(
    resolutionCode as SokoProtectionResolutionCode
  );
}

export function matchesProtectionSearch(
  row: {
    id: string;
    orderId: string;
    buyerUserId: string;
    sellerUserId: string;
    immutableOrderSnapshot?: Record<string, unknown> | null;
    parties?: { buyer?: AdminPartyView | null; seller?: AdminPartyView | null } | null;
  },
  query: string
) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const buyer = trustedParty({
    side: "buyer",
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
    parties: row.parties,
  });
  const seller = trustedParty({
    side: "seller",
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
    parties: row.parties,
  });
  const haystack = [
    row.id,
    row.orderId,
    frozenProductTitle(row.immutableOrderSnapshot),
    buyer.displayName,
    buyer.kristoId,
    buyer.userId,
    seller.displayName,
    seller.kristoId,
    seller.userId,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function shortUserRef(userId: string) {
  const id = String(userId || "").trim();
  if (!id) return "—";
  return id.length <= 12 ? id : `…${id.slice(-10)}`;
}

export function sortProtectionEventsChronologically<T extends { createdAt?: string }>(
  events: T[]
) {
  return [...(events || [])].sort((a, b) => {
    const left = Date.parse(String(a.createdAt || ""));
    const right = Date.parse(String(b.createdAt || ""));
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) {
      return left - right;
    }
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

export function evidenceBelongsToCase(
  evidence: { caseId?: string },
  caseId: string
) {
  return String(evidence?.caseId || "").trim() === String(caseId || "").trim();
}

export function filterAdminQueueRows<
  T extends {
    state: string;
    sellerResponseDeadline?: string | null;
  },
>(rows: T[], filter: SokoProtectionAdminFilter, now = new Date()) {
  if (filter === "all") return rows;
  if (filter === "overdue") {
    return rows.filter((row) =>
      isSellerResponseOverdue({
        state: row.state,
        sellerResponseDeadline: row.sellerResponseDeadline,
        now,
      })
    );
  }
  const state = filterToApiState(filter);
  if (!state) return rows;
  return rows.filter((row) => row.state === state);
}
