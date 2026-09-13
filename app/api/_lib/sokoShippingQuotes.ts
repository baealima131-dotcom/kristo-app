import { createHash } from "node:crypto";
import { getSokoNeonSql } from "@/app/api/_lib/store/sokoNeon";
import {
  SOKO_SHIPPING_QUOTE_TTL_MS,
  canReuseSokoShippingQuote,
  sokoShippingQuoteClean as clean,
  type SokoCachedShippingQuote,
} from "@/app/api/_lib/sokoShippingQuotePolicy";

export {
  SOKO_SHIPPING_QUOTE_TTL_MS,
  canReuseSokoShippingQuote,
  type SokoCachedShippingQuote,
};

let ready: Promise<void> | null = null;

type QuoteSchemaGate = {
  promise: Promise<void> | null;
};

function quoteSchemaGate(): QuoteSchemaGate {
  const globalState = globalThis as typeof globalThis & {
    __kristoSokoShippingQuotesSchema?: QuoteSchemaGate;
  };
  if (!globalState.__kristoSokoShippingQuotesSchema) {
    globalState.__kristoSokoShippingQuotesSchema = { promise: null };
  }
  return globalState.__kristoSokoShippingQuotesSchema;
}

function sqlClient() {
  return getSokoNeonSql();
}

async function schema() {
  const gate = quoteSchemaGate();
  if (!gate.promise) {
    gate.promise = (async () => {
      const sql = sqlClient();
      await sql`
        CREATE TABLE IF NOT EXISTS soko_shipping_quotes (
          buyer_user_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          rate_id TEXT NOT NULL,
          shipment_id TEXT NOT NULL DEFAULT '',
          address_fp TEXT NOT NULL,
          origin_fp TEXT NOT NULL,
          amount DOUBLE PRECISION NOT NULL,
          currency TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          service TEXT NOT NULL DEFAULT '',
          estimated_days INTEGER,
          fulfillment_type TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (
            buyer_user_id,
            product_id,
            rate_id,
            shipment_id,
            address_fp,
            origin_fp
          )
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS soko_shipping_quotes_lookup_idx
        ON soko_shipping_quotes (
          buyer_user_id,
          product_id,
          expires_at
        )
      `;
    })().catch((error) => {
      gate.promise = null;
      throw error;
    });
  }
  ready = gate.promise;
  return gate.promise;
}

export function sokoShippingAddressFingerprint(input: {
  fullName: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  streetAddress: string;
  postalCode: string;
}) {
  return createHash("sha256")
    .update(
      [
        clean(input.fullName, 120).toLowerCase(),
        clean(input.phone, 30),
        clean(input.country, 80).toUpperCase(),
        clean(input.state, 100).toUpperCase(),
        clean(input.city, 100).toLowerCase(),
        clean(input.streetAddress, 240).toLowerCase(),
        clean(input.postalCode, 30).toUpperCase(),
      ].join("\n")
    )
    .digest("hex");
}

export function sokoShippingOriginFingerprint(input: {
  fulfillmentType: string;
  from?: Record<string, unknown>;
  parcel?: Record<string, unknown>;
  vehicleType?: string;
}) {
  const from = input.from && typeof input.from === "object" ? input.from : {};
  const parcel =
    input.parcel && typeof input.parcel === "object" ? input.parcel : {};
  return createHash("sha256")
    .update(
      [
        clean(input.fulfillmentType, 30),
        clean(from.name, 120).toLowerCase(),
        clean(from.street1, 240).toLowerCase(),
        clean(from.city, 100).toLowerCase(),
        clean(from.state, 100).toUpperCase(),
        clean(from.zip, 30).toUpperCase(),
        clean(from.country, 80).toUpperCase(),
        clean(parcel.length, 20),
        clean(parcel.width, 20),
        clean(parcel.height, 20),
        clean(parcel.weight, 20),
        clean(parcel.distanceUnit, 5),
        clean(parcel.massUnit, 5),
        clean(input.vehicleType, 20).toLowerCase(),
      ].join("\n")
    )
    .digest("hex");
}

function mapRow(row: Record<string, unknown>): SokoCachedShippingQuote {
  const expires = row.expires_at;
  const expiresAtMs =
    expires instanceof Date
      ? expires.getTime()
      : Date.parse(String(expires || ""));
  return {
    rateId: clean(row.rate_id, 120),
    shipmentId: clean(row.shipment_id, 120),
    buyerUserId: clean(row.buyer_user_id, 180),
    productId: clean(row.product_id, 100),
    addressFp: clean(row.address_fp, 80),
    originFp: clean(row.origin_fp, 80),
    amount: Number(row.amount),
    currency: clean(row.currency, 10),
    provider: clean(row.provider, 80),
    service: clean(row.service, 120),
    estimatedDays:
      Number(row.estimated_days) > 0 ? Number(row.estimated_days) : null,
    fulfillmentType: clean(row.fulfillment_type, 30),
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : 0,
  };
}

export async function saveSokoShippingQuotes(
  quotes: Array<Omit<SokoCachedShippingQuote, "expiresAtMs"> & { expiresAtMs?: number }>,
  nowMs = Date.now()
) {
  await schema();
  const sql = sqlClient();
  const expires = new Date(nowMs + SOKO_SHIPPING_QUOTE_TTL_MS).toISOString();

  await Promise.all(
    quotes.map((quote) => {
      const amount = Number(quote.amount);
      if (!quote.rateId || !Number.isFinite(amount) || amount <= 0) {
        return Promise.resolve();
      }
      return sql`
        INSERT INTO soko_shipping_quotes (
          buyer_user_id,
          product_id,
          rate_id,
          shipment_id,
          address_fp,
          origin_fp,
          amount,
          currency,
          provider,
          service,
          estimated_days,
          fulfillment_type,
          expires_at
        )
        VALUES (
          ${clean(quote.buyerUserId, 180)},
          ${clean(quote.productId, 100)},
          ${clean(quote.rateId, 120)},
          ${clean(quote.shipmentId, 120)},
          ${clean(quote.addressFp, 80)},
          ${clean(quote.originFp, 80)},
          ${amount},
          ${clean(quote.currency, 10)},
          ${clean(quote.provider, 80)},
          ${clean(quote.service, 120)},
          ${quote.estimatedDays},
          ${clean(quote.fulfillmentType, 30)},
          ${expires}::timestamptz
        )
        ON CONFLICT (
          buyer_user_id,
          product_id,
          rate_id,
          shipment_id,
          address_fp,
          origin_fp
        )
        DO UPDATE SET
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          provider = EXCLUDED.provider,
          service = EXCLUDED.service,
          estimated_days = EXCLUDED.estimated_days,
          fulfillment_type = EXCLUDED.fulfillment_type,
          expires_at = EXCLUDED.expires_at
      `;
    })
  );
}

export async function findReusableSokoShippingQuote(input: {
  buyerUserId: string;
  productId: string;
  rateId: string;
  shipmentId: string;
  addressFp: string;
  originFp: string;
  nowMs?: number;
}) {
  await schema();
  const sql = sqlClient();
  const rows = await sql`
    SELECT *
    FROM soko_shipping_quotes
    WHERE buyer_user_id = ${clean(input.buyerUserId, 180)}
      AND product_id = ${clean(input.productId, 100)}
      AND rate_id = ${clean(input.rateId, 120)}
      AND shipment_id = ${clean(input.shipmentId, 120)}
      AND address_fp = ${clean(input.addressFp, 80)}
      AND origin_fp = ${clean(input.originFp, 80)}
      AND expires_at > NOW()
    LIMIT 1
  ` as Array<Record<string, unknown>>;

  return canReuseSokoShippingQuote({
    quote: rows[0] ? mapRow(rows[0]) : null,
    nowMs: input.nowMs ?? Date.now(),
    buyerUserId: input.buyerUserId,
    productId: input.productId,
    rateId: input.rateId,
    shipmentId: input.shipmentId,
    addressFp: input.addressFp,
    originFp: input.originFp,
  });
}

export async function listReusableSokoShippingQuotes(input: {
  buyerUserId: string;
  productId: string;
  addressFp: string;
  originFp: string;
  fulfillmentType: string;
}) {
  await schema();
  const sql = sqlClient();
  const rows = await sql`
    SELECT *
    FROM soko_shipping_quotes
    WHERE buyer_user_id = ${clean(input.buyerUserId, 180)}
      AND product_id = ${clean(input.productId, 100)}
      AND address_fp = ${clean(input.addressFp, 80)}
      AND origin_fp = ${clean(input.originFp, 80)}
      AND fulfillment_type = ${clean(input.fulfillmentType, 30)}
      AND expires_at > NOW()
    ORDER BY amount ASC
    LIMIT 10
  ` as Array<Record<string, unknown>>;

  return rows.map(mapRow).filter((quote) => quote.amount > 0 && quote.rateId);
}

export async function verifyShippoParcelRate(input: {
  rateId: string;
  shipmentId: string;
  token: string;
}) {
  const rateId = clean(input.rateId, 120);
  const shipmentId = clean(input.shipmentId, 120);
  const token = clean(input.token, 300);
  if (!rateId || !token) {
    throw new Error("Choose a verified carrier delivery rate.");
  }

  const response = await fetch(
    "https://api.goshippo.com/rates/" + encodeURIComponent(rateId),
    {
      headers: {
        Authorization: `ShippoToken ${token}`,
      },
      signal: AbortSignal.timeout(15000),
    }
  );
  const rate = await response.json().catch(() => ({}));
  if (!response.ok || !rate || typeof rate !== "object") {
    throw new Error("Carrier delivery rate could not be verified.");
  }

  const amount = Number(rate.amount);
  const rateCurrency = clean(rate.currency, 10);
  const shippoShipment = clean(rate.shipment, 120);
  if (shipmentId && shippoShipment && shippoShipment !== shipmentId) {
    throw new Error("Carrier delivery rate could not be verified.");
  }
  if (!Number.isFinite(amount) || amount <= 0 || !rateCurrency) {
    throw new Error("Carrier returned an invalid rate.");
  }

  const provider =
    rate.provider && typeof rate.provider === "object"
      ? clean(rate.provider.name, 80)
      : clean(rate.provider, 80);
  const service =
    clean(rate.servicelevel_name, 120) ||
    (rate.servicelevel && typeof rate.servicelevel === "object"
      ? clean(rate.servicelevel.name, 120)
      : "");

  return {
    rateId,
    shipmentId: shipmentId || shippoShipment,
    provider,
    service,
    amount,
    currency: rateCurrency,
    estimatedDays:
      Number(rate.estimated_days) > 0 ? Number(rate.estimated_days) : null,
  };
}
