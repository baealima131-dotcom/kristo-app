export const SOKO_SHIPPING_QUOTE_TTL_MS = 45 * 60 * 1000;

export type SokoCachedShippingQuote = {
  rateId: string;
  shipmentId: string;
  buyerUserId: string;
  productId: string;
  addressFp: string;
  originFp: string;
  amount: number;
  currency: string;
  provider: string;
  service: string;
  estimatedDays: number | null;
  fulfillmentType: string;
  expiresAtMs: number;
};

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

export function sokoShippingQuoteClean(value: unknown, max: number) {
  return clean(value, max);
}

export function canReuseSokoShippingQuote(input: {
  quote: SokoCachedShippingQuote | null;
  nowMs: number;
  buyerUserId: string;
  productId: string;
  rateId: string;
  shipmentId: string;
  addressFp: string;
  originFp: string;
}) {
  const quote = input.quote;
  if (!quote) {
    return { ok: false as const, reason: "missing" };
  }
  if (quote.buyerUserId !== clean(input.buyerUserId, 180)) {
    return { ok: false as const, reason: "buyer" };
  }
  if (quote.productId !== clean(input.productId, 100)) {
    return { ok: false as const, reason: "product" };
  }
  if (quote.rateId !== clean(input.rateId, 120)) {
    return { ok: false as const, reason: "rate" };
  }
  if (quote.shipmentId !== clean(input.shipmentId, 120)) {
    return { ok: false as const, reason: "shipment" };
  }
  if (quote.addressFp !== clean(input.addressFp, 80)) {
    return { ok: false as const, reason: "address" };
  }
  if (quote.originFp !== clean(input.originFp, 80)) {
    return { ok: false as const, reason: "origin" };
  }
  if (quote.expiresAtMs <= input.nowMs) {
    return { ok: false as const, reason: "expired" };
  }
  if (!Number.isFinite(quote.amount) || quote.amount <= 0) {
    return { ok: false as const, reason: "amount" };
  }
  if (!clean(quote.currency, 10)) {
    return { ok: false as const, reason: "currency" };
  }
  return { ok: true as const, quote };
}
