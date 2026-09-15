import { createHash } from "node:crypto";

export type SokoProtectionOrderFacts = {
  id: string;
  productId: string;
  buyerUserId: string;
  sellerUserId: string;
  paymentMethod: string;
  status: string;
  snapshot: Record<string, unknown> | null;
  buyerNote: string;
  sellerNote: string;
  transactionReference: string;
  paymentProvider: string;
  providerPaymentId: string;
  providerReference: string;
  paymentDate: string | null;
  trackingNumber: string;
  createdAt: string;
  updatedAt: string;
};

function clean(value: unknown, max = 80) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

/**
 * Freeze checkout / payment / shipping facts at case open.
 * Strips mutable merchant secrets; keeps product identity from the order row.
 */
export function buildImmutableProtectionOrderSnapshot(
  order: SokoProtectionOrderFacts
) {
  const snapshot =
    order.snapshot && typeof order.snapshot === "object"
      ? cloneJson(order.snapshot)
      : {};

  if (
    snapshot &&
    typeof snapshot === "object" &&
    snapshot.payment &&
    typeof snapshot.payment === "object"
  ) {
    const payment = { ...(snapshot.payment as Record<string, unknown>) };
    delete payment.merchantId;
    delete payment.merchant_id;
    (snapshot as Record<string, unknown>).payment = payment;
  }

  const frozen = {
    frozenAt: new Date().toISOString(),
    orderId: clean(order.id, 100),
    productId: clean(order.productId, 100),
    buyerUserId: clean(order.buyerUserId, 180),
    sellerUserId: clean(order.sellerUserId, 180),
    paymentMethod: clean(order.paymentMethod, 40),
    orderStatusAtOpen: clean(order.status, 40),
    transactionReference: clean(order.transactionReference, 120),
    paymentProvider: clean(order.paymentProvider, 40),
    providerPaymentId: clean(order.providerPaymentId, 180),
    providerReference: clean(order.providerReference, 180),
    paymentDate: order.paymentDate || null,
    trackingNumber: clean(order.trackingNumber, 160),
    buyerNote: clean(order.buyerNote, 1000),
    sellerNote: clean(order.sellerNote, 1000),
    orderCreatedAt: order.createdAt || null,
    orderUpdatedAt: order.updatedAt || null,
    product: snapshot,
  };

  // Hash excludes frozenAt so re-hashing the same facts stays stable in tests
  // that rebuild from the stored product payload without the wall-clock stamp.
  const hashPayload = { ...frozen, frozenAt: null };
  const hash = createHash("sha256")
    .update(stableStringify(hashPayload))
    .digest("hex");

  return {
    snapshot: frozen,
    hash,
  };
}

export function hashProtectionJson(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/**
 * Recompute hash from a stored immutable snapshot (including frozenAt nulling).
 */
export function hashImmutableProtectionSnapshot(
  snapshot: Record<string, unknown>
) {
  const hashPayload = { ...snapshot, frozenAt: null };
  return createHash("sha256")
    .update(stableStringify(hashPayload))
    .digest("hex");
}
