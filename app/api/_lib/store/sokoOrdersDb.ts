import { createHash, randomUUID } from "node:crypto";
import { getSokoNeonSql } from "./sokoNeon";
import { createCashAppServerReference } from "@/app/api/_lib/cashAppPartnerClient";
import { dbGetVerifiedSellerPaymentMerchant } from "@/app/api/_lib/store/sokoSellerPaymentAccountsDb";
import {
  SokoPaymentAccountMismatchError,
  cashAppCaptureAuditMetadata,
  isPayableSokoOrderStatus,
  resolveApprovedCashAppRecipient,
} from "@/app/api/_lib/cashAppPaymentConfirmation";
import {
  SOKO_STRIPE_PAYMENT_METHOD,
  SOKO_STRIPE_PROVIDER,
  assertSokoStripeSellerGate,
  configuredSokoStripeSellerUserId,
  toStripeAmountMinor,
} from "@/app/api/_lib/sokoStripeCheckout";
import { sokoCheckoutTimer } from "@/app/api/_lib/sokoCheckoutTiming";
import {
  findReusableSokoShippingQuote,
  sokoShippingAddressFingerprint,
  sokoShippingOriginFingerprint,
  verifyShippoParcelRate,
} from "@/app/api/_lib/sokoShippingQuotes";

export type SokoOrderStatus =
  | "awaiting_delivery_quote"
  | "delivery_quote_ready"
  | "awaiting_payment"
  | "payment_submitted"
  | "payment_approved"
  | "payment_rejected"
  | "preparing_shipment"
  | "shipped"
  | "delivered"
  | "cancelled";

type OrderRow = {
  id: string;
  product_id: string;
  buyer_user_id: string;
  seller_user_id: string;
  client_key: string;
  payment_method: string;
  status: SokoOrderStatus;
  snapshot: Record<string, any>;
  buyer_note: string;
  transaction_reference: string;
  payment_provider: string;
  provider_payment_id: string;
  provider_reference: string;
  payment_date: string | null;
  proof_key: string | null;
  proof_base64?: string | null;
  proof_mime?: string | null;
  seller_note: string;
  tracking_number: string;
  inventory_reserved: boolean;
  buyer_hidden: boolean;
  seller_hidden: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

let ready: Promise<void> | null = null;

type SchemaGate = {
  promise: Promise<void> | null;
};

function schemaGate(): SchemaGate {
  const globalState = globalThis as typeof globalThis & {
    __kristoSokoOrdersSchema?: SchemaGate;
  };
  if (!globalState.__kristoSokoOrdersSchema) {
    globalState.__kristoSokoOrdersSchema = { promise: null };
  }
  return globalState.__kristoSokoOrdersSchema;
}

function sqlClient() {
  return getSokoNeonSql();
}

async function runSokoOrdersSchema() {
  const sql = sqlClient();

  await sql`CREATE TABLE IF NOT EXISTS soko_orders (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        buyer_user_id TEXT NOT NULL,
        seller_user_id TEXT NOT NULL,
        client_key TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            'awaiting_delivery_quote',
            'delivery_quote_ready',
            'awaiting_payment',
            'payment_submitted',
            'payment_approved',
            'payment_rejected',
            'preparing_shipment',
            'shipped',
            'delivered',
            'cancelled'
          )
        ),
        snapshot JSONB NOT NULL,
        buyer_note TEXT NOT NULL DEFAULT '',
        transaction_reference TEXT NOT NULL DEFAULT '',
        payment_provider TEXT NOT NULL DEFAULT '',
        provider_payment_id TEXT NOT NULL DEFAULT '',
        provider_reference TEXT NOT NULL DEFAULT '',
        payment_date TIMESTAMPTZ,
        proof_key TEXT,
        seller_note TEXT NOT NULL DEFAULT '',
        tracking_number TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(buyer_user_id, client_key)
      )`;

  await Promise.all([
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS proof_base64 TEXT`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS proof_mime TEXT`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS payment_proof_sha256 TEXT NOT NULL DEFAULT ''`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS inventory_reserved BOOLEAN
        NOT NULL DEFAULT FALSE`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS buyer_hidden BOOLEAN
        NOT NULL DEFAULT FALSE`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS seller_hidden BOOLEAN
        NOT NULL DEFAULT FALSE`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS payment_provider TEXT
        NOT NULL DEFAULT ''`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS provider_payment_id TEXT
        NOT NULL DEFAULT ''`,
    sql`ALTER TABLE soko_orders
        ADD COLUMN IF NOT EXISTS provider_reference TEXT
        NOT NULL DEFAULT ''`,
  ]);

  await sql`CREATE TABLE IF NOT EXISTS soko_order_payment_proofs (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL
          REFERENCES soko_orders(id)
          ON DELETE CASCADE,
        buyer_user_id TEXT NOT NULL,
        seller_user_id TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        position INTEGER NOT NULL
          CHECK (position >= 0 AND position <= 4),
        proof_base64 TEXT NOT NULL,
        proof_mime TEXT NOT NULL,
        proof_sha256 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(order_id, position)
      )`;

  await sql`ALTER TABLE soko_orders
        DROP CONSTRAINT IF EXISTS soko_orders_status_check`;

  await sql`ALTER TABLE soko_orders
        ADD CONSTRAINT soko_orders_status_check CHECK (
          status IN (
            'awaiting_delivery_quote',
            'delivery_quote_ready',
            'awaiting_payment',
            'payment_submitted',
            'payment_approved',
            'payment_rejected',
            'preparing_shipment',
            'shipped',
            'delivered',
            'cancelled'
          )
        )`;

  await Promise.all([
    sql`CREATE INDEX IF NOT EXISTS
        soko_order_payment_proofs_order_idx
        ON soko_order_payment_proofs(
          order_id,
          position
        )`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS
        soko_order_payment_proofs_cashapp_sha256_uidx
        ON soko_order_payment_proofs(proof_sha256)
        WHERE payment_method='cash_app'`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS
        soko_orders_cash_app_proof_sha256_uidx
        ON soko_orders(payment_proof_sha256)
        WHERE payment_method='cash_app'
          AND payment_proof_sha256 <> ''`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS
        soko_orders_cash_app_transaction_reference_uidx
        ON soko_orders(
          seller_user_id,
          LOWER(BTRIM(transaction_reference))
        )
        WHERE payment_method='cash_app'
          AND BTRIM(transaction_reference) <> ''
          AND status IN (
            'payment_submitted',
            'payment_approved',
            'payment_rejected',
            'preparing_shipment',
            'shipped',
            'delivered'
          )`,
    sql`CREATE INDEX IF NOT EXISTS soko_orders_buyer_idx
        ON soko_orders(buyer_user_id, created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS soko_orders_seller_idx
        ON soko_orders(seller_user_id, created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS soko_orders_product_idx
        ON soko_orders(product_id, created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS soko_orders_provider_payment_idx
        ON soko_orders(
          payment_provider,
          provider_payment_id
        )
        WHERE provider_payment_id <> ''`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS
        soko_orders_provider_payment_uidx
        ON soko_orders(
          payment_provider,
          provider_payment_id
        )
        WHERE provider_payment_id <> ''`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS
        soko_orders_provider_reference_uidx
        ON soko_orders(
          payment_provider,
          provider_reference
        )
        WHERE provider_reference <> ''`,
  ]);
}

async function schema() {
  const gate = schemaGate();
  if (!gate.promise) {
    gate.promise = runSokoOrdersSchema().catch((error) => {
      gate.promise = null;
      throw error;
    });
  }
  ready = gate.promise;
  return gate.promise;
}

export function ensureSokoOrdersSchema() {
  return schema();
}

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function publicOrder(row: OrderRow) {
  const snapshot =
    row.snapshot && typeof row.snapshot === "object"
      ? { ...row.snapshot }
      : row.snapshot;
  const payment =
    snapshot &&
    typeof snapshot === "object" &&
    snapshot.payment &&
    typeof snapshot.payment === "object"
      ? { ...snapshot.payment }
      : null;

  if (payment) {
    delete payment.merchantId;
    delete payment.merchant_id;
    snapshot.payment = payment;
  }

  return {
    id: row.id,
    productId: row.product_id,
    buyerUserId: row.buyer_user_id,
    sellerUserId: row.seller_user_id,
    paymentMethod: row.payment_method,
    status: row.status,
    product: snapshot,
    buyerNote: row.buyer_note,
    transactionReference: row.transaction_reference,
    paymentDate: row.payment_date,
    hasPaymentProof: Boolean(row.proof_key),
    sellerNote: row.seller_note,
    trackingNumber: row.tracking_number,
    inventoryReserved: row.inventory_reserved,
    buyerHidden: row.buyer_hidden,
    sellerHidden: row.seller_hidden,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureSokoCashAppOrderReference(
  order: OrderRow
) {
  if (order.payment_method !== "cash_app") {
    return order;
  }

  const reference = createCashAppServerReference(order.id);

  if (clean(order.provider_reference, 180)) {
    return order;
  }

  const sql = sqlClient();
  const rows = await sql`
    UPDATE soko_orders
    SET
      payment_provider = 'cash_app',
      provider_reference = ${reference},
      updated_at = NOW()
    WHERE id = ${order.id}
      AND payment_method = 'cash_app'
      AND provider_reference = ''
    RETURNING *
  ` as OrderRow[];

  return rows[0] || order;
}

export async function createSokoOrder(args: {
  buyerUserId: string;
  buyerName: string | Promise<string>;
  productId: string;
  paymentMethod: string;
  clientKey: string;
  deliveryDetails: Record<string, unknown>;
  deliverySelection: Record<string, unknown>;
  requestDeliveryQuote?: boolean;
}) {
  const timer = sokoCheckoutTimer("createSokoOrder");
  await schema();
  timer.stage("schema");

  const sql = sqlClient();
  const productId = clean(args.productId, 100);
  const clientKey = clean(args.clientKey, 120);
  const paymentMethod = clean(args.paymentMethod, 40);
  const quoteRequested = args.requestDeliveryQuote === true;
  const deliveryInput =
    args.deliveryDetails &&
    typeof args.deliveryDetails === "object"
      ? args.deliveryDetails
      : {};

  const deliveryDetails = {
    fullName: clean(deliveryInput.fullName, 120),
    phone: clean(deliveryInput.phone, 30),
    country: clean(deliveryInput.country, 80),
    state: clean(deliveryInput.state, 100),
    city: clean(deliveryInput.city, 100),
    streetAddress: clean(deliveryInput.streetAddress, 240),
    postalCode: clean(deliveryInput.postalCode, 30),
    instructions: clean(deliveryInput.instructions, 500),
  };

  if (!productId || !/^[A-Za-z0-9_-]+$/.test(clientKey)) {
    throw new Error("Invalid order information.");
  }

  if (
    !["cash", "cash_app", "mobile_money", "stripe_card"].includes(
      paymentMethod
    )
  ) {
    throw new Error("Invalid payment method.");
  }

  if (
    deliveryDetails.fullName.length < 2 ||
    deliveryDetails.phone.length < 7 ||
    deliveryDetails.country.length < 2 ||
    deliveryDetails.state.length < 2 ||
    deliveryDetails.city.length < 2 ||
    deliveryDetails.streetAddress.length < 5 ||
    deliveryDetails.postalCode.length < 3
  ) {
    throw new Error(
      "Complete your name, phone and delivery address."
    );
  }

  const [existing, products, buyerName] = await Promise.all([
    sql`
      SELECT * FROM soko_orders
      WHERE buyer_user_id=${args.buyerUserId}
        AND client_key=${clientKey}
      LIMIT 1
    `,
    sql`
      SELECT id,seller_user_id,payload,status
      FROM soko_products
      WHERE id=${productId} AND status='Active'
      LIMIT 1
    `,
    Promise.resolve(args.buyerName).then((value) =>
      clean(value, 120) || "Kristo buyer"
    ),
  ]) as unknown as [
    OrderRow[],
    Array<{
      id: string;
      seller_user_id: string;
      payload: Record<string, any>;
      status: string;
    }>,
    string
  ];
  timer.stage("order_product_lookup", {
    existing: Boolean(existing[0]),
  });

  if (existing[0]) {
    const current = await ensureSokoCashAppOrderReference(
      existing[0] as OrderRow
    );
    timer.stage("existing_order");
    return publicOrder(current);
  }

  const product = products[0];

  if (!product) throw new Error("Product is unavailable.");
  if (product.seller_user_id === args.buyerUserId) {
    throw new Error("You cannot buy your own product.");
  }

  const methods = Array.isArray(product.payload?.paymentOptions?.methods)
    ? product.payload.paymentOptions.methods
    : [];

  if (paymentMethod === SOKO_STRIPE_PAYMENT_METHOD) {
    const stripeGate = assertSokoStripeSellerGate({
      sellerUserId: product.seller_user_id,
      buyerUserId: args.buyerUserId,
      productStatus: product.status,
      currency: clean(product.payload?.currency, 10),
      allowedSellerUserId: configuredSokoStripeSellerUserId(),
    });

    if (!stripeGate.ok) {
      throw new Error(stripeGate.error);
    }
  } else if (!methods.includes(paymentMethod)) {
    throw new Error("Seller does not accept this payment method.");
  }

  const fulfillment =
    product.payload?.fulfillmentOptions &&
    typeof product.payload.fulfillmentOptions === "object"
      ? product.payload.fulfillmentOptions
      : {};

  const fulfillmentType = clean(
    fulfillment.type ||
      (
        clean(product.payload?.category, 50) === "Vehicles"
          ? "freight"
          : ""
      ),
    30
  );

  // Freight prices are calculated automatically below.
  // The seller never supplies the delivery amount.

  const selection =
    args.deliverySelection &&
    typeof args.deliverySelection === "object"
      ? args.deliverySelection
      : {};

  let verifiedDelivery = {
    rateId: "",
    shipmentId: "",
    provider: "",
    service: "",
    amount: 0,
    currency: clean(product.payload?.currency, 10),
    estimatedDays: null as number | null,
    type: fulfillmentType,
  };

  if (
    fulfillmentType === "freight" ||
    clean(product.payload?.category, 50) === "Vehicles"
  ) {
    const from =
      fulfillment.addressFrom &&
      typeof fulfillment.addressFrom === "object"
        ? fulfillment.addressFrom
        : {};

    const fromZip = clean(from.zip, 5);
    const toZip = clean(deliveryDetails.postalCode, 5);
    const vehicleType = clean(
      fulfillment.vehicleType || "sedan",
      20
    ).toLowerCase();

    if (
      clean(product.payload?.currency, 10) !== "USD" ||
      !/^\d{5}$/.test(fromZip) ||
      !/^\d{5}$/.test(toZip) ||
      ![
        "sedan",
        "suv",
        "pickup",
        "truck",
        "van",
        "minivan",
      ].includes(vehicleType)
    ) {
      throw new Error(
        "Vehicle delivery information is incomplete."
      );
    }

    if (
      clean(selection.rateId, 120) !==
      "automatic-vehicle-transport"
    ) {
      throw new Error(
        "Calculate and select automatic vehicle delivery first."
      );
    }

    const addressFp = sokoShippingAddressFingerprint(deliveryDetails);
    const originFp = sokoShippingOriginFingerprint({
      fulfillmentType: "freight",
      from,
      vehicleType,
    });
    const reused = await findReusableSokoShippingQuote({
      buyerUserId: args.buyerUserId,
      productId,
      rateId: "automatic-vehicle-transport",
      shipmentId: "",
      addressFp,
      originFp,
    });

    if (reused.ok) {
      timer.stage("shipping_reuse", { kind: "freight" });
      verifiedDelivery = {
        ...verifiedDelivery,
        rateId: "automatic-vehicle-transport",
        shipmentId: "",
        provider: reused.quote.provider || "CarHauler247",
        service: reused.quote.service || "Open vehicle transport",
        amount: reused.quote.amount,
        currency: "USD",
        estimatedDays: reused.quote.estimatedDays,
        type: "freight",
      };
    } else {
      const vehicleResponse = await fetch(
        "https://carhauler247.com/api/public/v1/quote" +
          "?fromZip=" + encodeURIComponent(fromZip) +
          "&toZip=" + encodeURIComponent(toZip) +
          "&vehicleType=" + encodeURIComponent(vehicleType),
        {
          headers: {
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        }
      );

      const vehicleData = await vehicleResponse
        .json()
        .catch(() => ({}));

      const quote =
        vehicleData?.quote &&
        typeof vehicleData.quote === "object"
          ? vehicleData.quote
          : {};

      const amount = Number(quote.price);

      if (
        !vehicleResponse.ok ||
        vehicleData?.success !== true ||
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          "Automatic vehicle delivery quote is temporarily unavailable."
        );
      }

      timer.stage("shipping_revalidate", { kind: "freight" });
      verifiedDelivery = {
        ...verifiedDelivery,
        rateId: "automatic-vehicle-transport",
        shipmentId: "",
        provider: "CarHauler247",
        service: "Open vehicle transport",
        amount,
        currency: "USD",
        estimatedDays: null,
        type: "freight",
      };

      (verifiedDelivery as any).durationTerms = clean(
        quote.estimatedDays,
        240
      );

      (verifiedDelivery as any).distanceMiles =
        Number(quote.distance) > 0
          ? Number(quote.distance)
          : null;
    }

    (verifiedDelivery as any).timingNotice =
      "Transit estimate starts after vehicle pickup. Pickup scheduling is confirmed separately.";
  } else if (fulfillmentType === "pickup") {
    verifiedDelivery = {
      ...verifiedDelivery,
      rateId: "pickup",
      provider: "Seller",
      service: "Local pickup",
      amount: 0,
    };
  } else if (fulfillmentType === "local_delivery") {
    const amount = Number(fulfillment.flatFee);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Seller delivery fee is unavailable.");
    }

    verifiedDelivery = {
      ...verifiedDelivery,
      rateId: "seller-local-delivery",
      provider: "Seller",
      service: "Local delivery",
      amount,
      estimatedDays:
        Number(fulfillment.estimatedDays) > 0
          ? Number(fulfillment.estimatedDays)
          : null,
    };
  } else if (fulfillmentType === "parcel") {
    const rateId = clean(selection.rateId, 120);
    const shipmentId = clean(selection.shipmentId, 120);
    const token = clean(process.env.SHIPPO_API_TOKEN, 300);
    const from =
      fulfillment.addressFrom &&
      typeof fulfillment.addressFrom === "object"
        ? fulfillment.addressFrom
        : {};
    const parcel =
      fulfillment.parcel &&
      typeof fulfillment.parcel === "object"
        ? fulfillment.parcel
        : {};
    const addressFp = sokoShippingAddressFingerprint(deliveryDetails);
    const originFp = sokoShippingOriginFingerprint({
      fulfillmentType: "parcel",
      from,
      parcel,
    });

    if (!rateId || !token) {
      throw new Error(
        "Choose a verified carrier delivery rate."
      );
    }

    const reused = await findReusableSokoShippingQuote({
      buyerUserId: args.buyerUserId,
      productId,
      rateId,
      shipmentId,
      addressFp,
      originFp,
    });

    if (reused.ok) {
      timer.stage("shipping_reuse", { kind: "parcel" });
      verifiedDelivery = {
        rateId: reused.quote.rateId,
        shipmentId: reused.quote.shipmentId,
        provider: reused.quote.provider,
        service: reused.quote.service,
        amount: reused.quote.amount,
        currency: reused.quote.currency,
        estimatedDays: reused.quote.estimatedDays,
        type: "parcel",
      };
    } else {
      const rate = await verifyShippoParcelRate({
        rateId,
        shipmentId,
        token,
      });
      timer.stage("shipping_revalidate", { kind: "parcel" });
      verifiedDelivery = {
        rateId: rate.rateId,
        shipmentId: rate.shipmentId,
        provider: rate.provider,
        service: rate.service,
        amount: rate.amount,
        currency: rate.currency,
        estimatedDays: rate.estimatedDays,
        type: "parcel",
      };
    }
  } else {
    throw new Error(
      "Seller delivery method is incomplete."
    );
  }

  const itemPrice = Number(product.payload?.price || 0);
  const finalTotal = itemPrice + verifiedDelivery.amount;
  timer.stage("shipping_ready", {
    paymentMethod,
    amountMinor: Math.round(finalTotal * 100),
  });

  const snapshot = {
    title: clean(product.payload?.title, 120),
    price: Number(product.payload?.price || 0),
    currency: clean(product.payload?.currency, 10),
    image: clean(product.payload?.image, 1000),
    location: clean(product.payload?.location, 160),
    condition: clean(product.payload?.condition, 30),
    inventory: {
      quantity: 1,
      reserved: true,
    },
    buyerName,
    deliveryDetails,
    delivery: verifiedDelivery,
    fulfillment: {
      type: fulfillmentType,
      addressFrom:
        fulfillment.addressFrom &&
        typeof fulfillment.addressFrom === "object"
          ? fulfillment.addressFrom
          : {},
      parcel:
        fulfillment.parcel &&
        typeof fulfillment.parcel === "object"
          ? fulfillment.parcel
          : {},
    },
    totals: {
      itemPrice,
      deliveryPrice: verifiedDelivery.amount,
      finalTotal,
      currency: clean(product.payload?.currency, 10),
    },
    seller: {
      id: product.seller_user_id,
      kristoId: clean(product.payload?.seller?.kristoId, 80),
      name: clean(product.payload?.seller?.name, 120),
    },
    payment: {
      method: paymentMethod,
      cashTag: "",
      merchantId: "",
      mobileNetwork:
        paymentMethod === "mobile_money"
          ? clean(product.payload?.paymentOptions?.mobileNetwork, 80)
          : "",
      mobileNumber:
        paymentMethod === "mobile_money"
          ? clean(product.payload?.paymentOptions?.mobileNumber, 20)
          : "",
      recipientName:
        paymentMethod === "mobile_money"
          ? clean(product.payload?.paymentOptions?.recipientName, 120)
          : "",
    },
  };

  if (paymentMethod === "cash_app") {
    const sellerPayment = await dbGetVerifiedSellerPaymentMerchant({
      sellerUserId: product.seller_user_id,
      provider: "cash_app",
    });
    const recipient = resolveApprovedCashAppRecipient({
      listingCashTag: product.payload?.paymentOptions?.cashTag,
      approvedCashTag: sellerPayment?.cashTag || "",
      merchantId: sellerPayment?.externalMerchantId || "",
    });

    if (!recipient.ok) {
      if (recipient.code === "PAYMENT_ACCOUNT_MISMATCH") {
        throw new SokoPaymentAccountMismatchError();
      }
      throw new Error("Seller Cash App tag is unavailable.");
    }

    snapshot.payment.cashTag = recipient.cashTag;
    snapshot.payment.merchantId = recipient.merchantId;
  }

  if (!snapshot.title || !snapshot.price || !snapshot.currency) {
    throw new Error("Product payment information is incomplete.");
  }

  if (
    paymentMethod === "cash_app" &&
    !snapshot.payment.cashTag &&
    !snapshot.payment.merchantId
  ) {
    throw new Error("Seller Cash App tag is unavailable.");
  }

  const id = "order-" + randomUUID();
  const initialStatus: SokoOrderStatus = "awaiting_payment";

  const inserted = await sql`
    WITH reserved AS (
      UPDATE soko_products
      SET
        stock_available=stock_available-1,
        status=CASE
          WHEN stock_available-1 <= 0
            THEN 'Sold'
          ELSE status
        END,
        updated_at=NOW()
      WHERE id=${productId}
        AND status='Active'
        AND stock_available > 0
      RETURNING id
    ),
    inserted_order AS (
      INSERT INTO soko_orders(
        id,
        product_id,
        buyer_user_id,
        seller_user_id,
        client_key,
        payment_method,
        status,
        snapshot,
        inventory_reserved
      )
      SELECT
        ${id},
        ${productId},
        ${args.buyerUserId},
        ${product.seller_user_id},
        ${clientKey},
        ${paymentMethod},
        ${initialStatus},
        ${JSON.stringify(snapshot)}::jsonb,
        TRUE
      FROM reserved
      ON CONFLICT(buyer_user_id,client_key)
      DO NOTHING
      RETURNING *
    ),
    restored_duplicate AS (
      UPDATE soko_products
      SET
        stock_available=LEAST(
          stock_total,
          stock_available+1
        ),
        status=CASE
          WHEN status='Sold'
            THEN 'Active'
          ELSE status
        END,
        updated_at=NOW()
      WHERE id=${productId}
        AND EXISTS (
          SELECT 1 FROM reserved
        )
        AND NOT EXISTS (
          SELECT 1 FROM inserted_order
        )
      RETURNING id
    )
    SELECT * FROM inserted_order
  ` as OrderRow[];

  if (inserted[0]) {
    const current = await ensureSokoCashAppOrderReference(inserted[0]);
    timer.stage("order_inserted");
    return publicOrder(current);
  }

  const raced = await sql`
    SELECT * FROM soko_orders
    WHERE buyer_user_id=${args.buyerUserId}
      AND client_key=${clientKey}
    LIMIT 1
  ` as OrderRow[];

  if (!raced[0]) {
    throw new Error(
      "This product is sold out or no longer available."
    );
  }

  const current = await ensureSokoCashAppOrderReference(raced[0]);
  return publicOrder(current);
}

export async function listSokoOrders(userId: string, mode: string) {
  await schema();
  const sql = sqlClient();

  const rows =
    mode === "selling"
      ? await sql`
          SELECT * FROM soko_orders
          WHERE seller_user_id=${userId}
            AND seller_hidden=FALSE
          ORDER BY created_at DESC
          LIMIT 100
        ` as OrderRow[]
      : await sql`
          SELECT * FROM soko_orders
          WHERE buyer_user_id=${userId}
            AND buyer_hidden=FALSE
          ORDER BY created_at DESC
          LIMIT 100
        ` as OrderRow[];

  return rows.map(publicOrder);
}

export async function updateSokoOrder(args: {
  userId: string;
  orderId: string;
  action: string;
  note?: string;
  transactionReference?: string;
  paymentDate?: string;
  trackingNumber?: string;
  deliveryQuoteAmount?: number | string;
  deliveryQuoteEstimatedDays?: number | string;
}) {
  await schema();

  const sql = sqlClient();
  const orderId = clean(args.orderId, 100);

  const rows = await sql`
    SELECT * FROM soko_orders WHERE id=${orderId} LIMIT 1
  ` as OrderRow[];

  const order = rows[0];
  if (!order) throw new Error("Order not found.");

  const buyer = order.buyer_user_id === args.userId;
  const seller = order.seller_user_id === args.userId;

  if (!buyer && !seller) throw new Error("You cannot manage this order.");

  const action = clean(args.action, 50);

  if (action === "report_payment_issue") {
    if (!buyer) {
      throw new Error("Only the buyer can report a payment problem.");
    }

    if (
      ![
        "awaiting_payment",
        "payment_submitted",
        "payment_rejected"
      ].includes(order.status)
    ) {
      throw new Error(
        "A payment problem can only be reported while payment is pending."
      );
    }

    const note = clean(args.note, 500);

    if (note.length < 3) {
      throw new Error("Please describe the payment problem.");
    }

    const existingNote = clean(order.buyer_note, 1000);

    const combinedNote = existingNote
      ? `${existingNote}\n\nPAYMENT ISSUE: ${note}`
      : `PAYMENT ISSUE: ${note}`;

    const reported = await sql`
      UPDATE soko_orders
      SET
        buyer_note=${combinedNote},
        updated_at=NOW()
      WHERE id=${order.id}
        AND buyer_user_id=${args.userId}
      RETURNING *
    ` as OrderRow[];

    if (!reported[0]) {
      throw new Error("Payment problem could not be reported.");
    }

    return publicOrder(reported[0]);
  }

  if (action === "hide_from_seller") {
    if (!seller) {
      throw new Error(
        "Only the seller can remove this order from Seller Orders."
      );
    }

    if (!["delivered", "cancelled"].includes(order.status)) {
      throw new Error(
        "Only delivered or cancelled orders can be removed from Seller Orders."
      );
    }

    const hidden = await sql`
      UPDATE soko_orders
      SET
        seller_hidden=TRUE,
        updated_at=NOW()
      WHERE id=${order.id}
        AND seller_user_id=${args.userId}
      RETURNING *
    ` as OrderRow[];

    if (!hidden[0]) {
      throw new Error(
        "Order could not be removed from Seller Orders."
      );
    }

    return publicOrder(hidden[0]);
  }

  if (action === "hide_from_buyer") {
    if (!buyer) {
      throw new Error("Only the buyer can remove this order from Track Order.");
    }

    if (!["delivered", "cancelled"].includes(order.status)) {
      throw new Error(
        "Only delivered or cancelled orders can be removed from Track Order."
      );
    }

    const hidden = await sql`
      UPDATE soko_orders
      SET
        buyer_hidden=TRUE,
        updated_at=NOW()
      WHERE id=${order.id}
        AND buyer_user_id=${args.userId}
      RETURNING *
    ` as OrderRow[];

    if (!hidden[0]) {
      throw new Error("Order could not be removed from Track Order.");
    }

    return publicOrder(hidden[0]);
  }

  if (action === "create_shipping_label") {
    if (!seller) {
      throw new Error(
        "Only the seller can create the shipping label."
      );
    }

    if (
      !["payment_approved", "preparing_shipment"].includes(
        order.status
      )
    ) {
      throw new Error(
        "Payment must be approved before creating a label."
      );
    }

    const existingShipping =
      order.snapshot?.shipping &&
      typeof order.snapshot.shipping === "object"
        ? order.snapshot.shipping
        : {};

    if (
      existingShipping.labelUrl &&
      existingShipping.trackingNumber
    ) {
      return publicOrder(order);
    }

    const delivery =
      order.snapshot?.delivery &&
      typeof order.snapshot.delivery === "object"
        ? order.snapshot.delivery
        : {};

    if (clean(delivery.type, 30) !== "parcel") {
      throw new Error(
        "Automatic shipping labels are available for parcels only."
      );
    }

    const rateId = clean(delivery.rateId, 160);
    if (!rateId) {
      throw new Error("Selected carrier rate is missing.");
    }

    const token = clean(process.env.SHIPPO_API_TOKEN, 300);

    if (!token.startsWith("shippo_test_")) {
      throw new Error(
        "A Shippo TEST token is required for this label."
      );
    }

    const response = await fetch(
      "https://api.goshippo.com/transactions",
      {
        method: "POST",
        headers: {
          Authorization: `ShippoToken ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rate: rateId,
          label_file_type: "PDF",
          async: false,
        }),
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      }
    );

    const transaction: any = await response
      .json()
      .catch(() => ({}));

    const messages = Array.isArray(transaction?.messages)
      ? transaction.messages
          .map((message: any) =>
            clean(
              message?.text ||
                message?.message ||
                message?.code,
              240
            )
          )
          .filter(Boolean)
          .join(" ")
      : "";

    if (
      !response.ok ||
      transaction?.status !== "SUCCESS" ||
      !transaction?.object_id ||
      !transaction?.label_url ||
      !transaction?.tracking_number
    ) {
      throw new Error(
        messages ||
          clean(transaction?.detail, 240) ||
          "Shippo could not create this test label."
      );
    }

    const tracking = clean(
      transaction.tracking_number,
      160
    );

    const nextSnapshot = {
      ...order.snapshot,
      shipping: {
        mode: "test",
        transactionId: clean(
          transaction.object_id,
          160
        ),
        labelUrl: clean(transaction.label_url, 2000),
        trackingNumber: tracking,
        trackingUrl: clean(
          transaction.tracking_url_provider,
          2000
        ),
        provider: clean(delivery.provider, 100),
        service: clean(delivery.service, 160),
        createdAt: new Date().toISOString(),
      },
    };

    const labeled = await sql`
      UPDATE soko_orders
      SET
        status='preparing_shipment',
        tracking_number=${tracking},
        snapshot=${JSON.stringify(nextSnapshot)}::jsonb,
        updated_at=NOW()
      WHERE id=${order.id}
        AND seller_user_id=${args.userId}
        AND status IN ('payment_approved', 'preparing_shipment')
        AND COALESCE(
          snapshot->'shipping'->>'labelUrl',
          ''
        )=''
      RETURNING *
    ` as OrderRow[];

    if (!labeled[0]) {
      const current = await sql`
        SELECT * FROM soko_orders
        WHERE id=${order.id}
        LIMIT 1
      ` as OrderRow[];

      if (
        current[0]?.snapshot?.shipping?.labelUrl &&
        current[0]?.snapshot?.shipping?.trackingNumber
      ) {
        return publicOrder(current[0]);
      }

      throw new Error(
        "Order changed while creating the label."
      );
    }

    return publicOrder(labeled[0]);
  }

  let next: SokoOrderStatus | null = null;

  if (
    action === "provide_delivery_quote" &&
    seller &&
    order.status === "awaiting_delivery_quote"
  ) {
    next = "delivery_quote_ready";
  } else if (
    action === "accept_delivery_quote" &&
    buyer &&
    order.status === "delivery_quote_ready"
  ) {
    next = "awaiting_payment";
  } else if (
    action === "reject_delivery_quote" &&
    buyer &&
    order.status === "delivery_quote_ready"
  ) {
    next = "cancelled";
  } else if (
    action === "submit_payment" &&
    buyer &&
    ["awaiting_payment", "payment_rejected"].includes(order.status)
  ) {
    next = "payment_submitted";
  } else if (
    action === "cancel" &&
    buyer &&
    ["awaiting_payment", "payment_rejected"].includes(order.status)
  ) {
    next = "cancelled";
  } else if (
    action === "approve_payment" &&
    seller &&
    order.status === "payment_submitted"
  ) {
    next = "payment_approved";
  } else if (
    action === "reject_payment" &&
    seller &&
    order.status === "payment_submitted"
  ) {
    next = "payment_rejected";
  } else if (
    action === "prepare_shipment" &&
    seller &&
    order.status === "payment_approved"
  ) {
    next = "preparing_shipment";
  } else if (
    action === "mark_shipped" &&
    seller &&
    order.status === "preparing_shipment"
  ) {
    next = "shipped";
  } else if (
    action === "mark_delivered" &&
    buyer &&
    order.status === "shipped"
  ) {
    next = "delivered";
  }

  if (!next) throw new Error("This order action is not allowed.");

  const buyerNote = buyer ? clean(args.note, 500) : order.buyer_note;
  const sellerNote = seller ? clean(args.note, 500) : order.seller_note;
  const transactionReference = buyer
    ? clean(args.transactionReference, 120)
    : order.transaction_reference;
  const trackingNumber = seller
    ? clean(args.trackingNumber, 160)
    : order.tracking_number;

  const paymentDate =
    action === "submit_payment" && args.paymentDate
      ? new Date(args.paymentDate)
      : order.payment_date;

  let nextSnapshot = order.snapshot;

  if (action === "provide_delivery_quote") {
    const deliveryAmount = Number(args.deliveryQuoteAmount);
    const estimatedDays = Number(args.deliveryQuoteEstimatedDays);
    const itemPrice = Number(order.snapshot?.price || 0);
    const currency = clean(
      order.snapshot?.currency ||
      order.snapshot?.totals?.currency,
      10
    );

    if (
      !Number.isFinite(deliveryAmount) ||
      deliveryAmount <= 0 ||
      deliveryAmount > 1000000000
    ) {
      throw new Error("Enter a valid delivery price.");
    }

    if (
      !Number.isInteger(estimatedDays) ||
      estimatedDays < 1 ||
      estimatedDays > 365
    ) {
      throw new Error(
        "Estimated delivery days must be between 1 and 365."
      );
    }

    if (
      !Number.isFinite(itemPrice) ||
      itemPrice <= 0 ||
      !currency
    ) {
      throw new Error("Order price information is incomplete.");
    }

    const finalTotal = itemPrice + deliveryAmount;

    nextSnapshot = {
      ...order.snapshot,
      delivery: {
        ...(
          order.snapshot?.delivery &&
          typeof order.snapshot.delivery === "object"
            ? order.snapshot.delivery
            : {}
        ),
        rateId: "seller-freight-quote",
        shipmentId: "",
        provider: "Seller",
        service: "Freight delivery quote",
        amount: deliveryAmount,
        currency,
        estimatedDays,
        type: "freight",
      },
      totals: {
        itemPrice,
        deliveryPrice: deliveryAmount,
        finalTotal,
        currency,
      },
    };
  }

  if (
    action === "submit_payment" &&
    !order.proof_key
  ) {
    throw new Error("Upload payment screenshot first.");
  }

  if (
    action === "submit_payment" &&
    (!transactionReference || !paymentDate || Number.isNaN(new Date(paymentDate).getTime()))
  ) {
    throw new Error("Payment date and transaction reference are required.");
  }

  /*
   * KRISTO_SOKO_CASHAPP_DUPLICATE_REFERENCE_GUARD
   *
   * Manual Cash App proof is not provider-verified.
   * Prevent the same transaction reference from being
   * submitted against another order for the same seller.
   *
   * Current order is excluded so a rejected payment can
   * be corrected/resubmitted on that same order.
   */
  if (
    action === "submit_payment" &&
    order.payment_method === "cash_app"
  ) {
    const duplicatePaymentReference = await sql`
      SELECT id
      FROM soko_orders
      WHERE id <> ${order.id}
        AND seller_user_id = ${order.seller_user_id}
        AND payment_method = 'cash_app'
        AND proof_key IS NOT NULL
        AND BTRIM(transaction_reference) <> ''
        AND LOWER(BTRIM(transaction_reference)) =
          LOWER(BTRIM(${transactionReference}))
        AND status IN (
          'payment_submitted',
          'payment_approved',
          'payment_rejected',
          'preparing_shipment',
          'shipped',
          'delivered'
        )
      LIMIT 1
    ` as Array<{ id: string }>;

    if (duplicatePaymentReference[0]) {
      console.warn(
        "KRISTO_SOKO_CASHAPP_DUPLICATE_REFERENCE_BLOCKED",
        {
          orderId: order.id,
          sellerUserId: order.seller_user_id,
          buyerUserId: order.buyer_user_id,
        }
      );

      throw new Error(
        "This Cash App transaction reference has already been used for another order."
      );
    }
  }

  if (
    next === "cancelled" &&
    order.inventory_reserved
  ) {
    const cancelled = await sql`
      WITH cancelled_order AS (
        UPDATE soko_orders
        SET
          status=${next},
          buyer_note=${buyerNote},
          seller_note=${sellerNote},
          transaction_reference=${transactionReference},
          payment_date=${paymentDate},
          tracking_number=${trackingNumber},
          snapshot=${JSON.stringify(nextSnapshot)}::jsonb,
          inventory_reserved=FALSE,
          updated_at=NOW()
        WHERE id=${order.id}
          AND status=${order.status}
          AND inventory_reserved=TRUE
        RETURNING *
      ),
      restored_stock AS (
        UPDATE soko_products
        SET
          stock_available=LEAST(
            stock_total,
            stock_available+1
          ),
          status=CASE
            WHEN status='Sold'
              THEN 'Active'
            ELSE status
          END,
          updated_at=NOW()
        WHERE id=${order.product_id}
          AND EXISTS (
            SELECT 1 FROM cancelled_order
          )
        RETURNING id
      )
      SELECT * FROM cancelled_order
    ` as OrderRow[];

    if (!cancelled[0]) {
      throw new Error(
        "Order changed. Refresh and try again."
      );
    }

    return publicOrder(cancelled[0]);
  }

  let updated: OrderRow[];

  try {
    updated = await sql`
      UPDATE soko_orders
      SET
        status=${next},
        buyer_note=${buyerNote},
        seller_note=${sellerNote},
        transaction_reference=${transactionReference},
        payment_date=${paymentDate},
        tracking_number=${trackingNumber},
        snapshot=${JSON.stringify(nextSnapshot)}::jsonb,
        updated_at=NOW()
      WHERE id=${order.id}
        AND status=${order.status}
      RETURNING *
    ` as OrderRow[];
  } catch (error) {
    /*
     * KRISTO_SOKO_CASHAPP_REFERENCE_INDEX_COLLISION
     *
     * Application-level duplicate lookup handles the
     * normal path. The unique index handles concurrent
     * submissions that race each other.
     */
    const message = String(
      (error as Error)?.message ||
      error ||
      ""
    );

    if (
      action === "submit_payment" &&
      order.payment_method === "cash_app" &&
      (
        message.includes(
          "soko_orders_cash_app_transaction_reference_uidx"
        ) ||
        message.toLowerCase().includes("duplicate key")
      )
    ) {
      console.warn(
        "KRISTO_SOKO_CASHAPP_REFERENCE_INDEX_COLLISION",
        {
          orderId: order.id,
          sellerUserId: order.seller_user_id,
          buyerUserId: order.buyer_user_id,
        }
      );

      throw new Error(
        "This Cash App transaction reference has already been used for another order."
      );
    }

    throw error;
  }

  if (!updated[0]) {
    throw new Error("Order changed. Refresh and try again.");
  }

  /*
   * Seller approval finalizes public listing visibility.
   * The unit was reserved during order creation, therefore
   * inventory must not be deducted here a second time.
   */
  if (action === "approve_payment") {
    await sql`
      UPDATE soko_products
      SET
        status='Sold',
        updated_at=NOW()
      WHERE id=${order.product_id}
        AND stock_available <= 0
        AND status='Active'
    `;

    console.log(
      "KRISTO_SOKO_PAYMENT_APPROVED_INVENTORY_SYNC",
      {
        orderId: order.id,
        productId: order.product_id,
        sellerUserId: args.userId,
        inventoryDeductedAgain: false,
      }
    );
  }

  return publicOrder(updated[0]);
}


/*
 * KRISTO_SOKO_PAYMENT_PROOF_6MB_V1
 * Preserve full screenshot dimensions; allow up to 6 MB per image.
 */
export async function saveSokoPaymentProof(args: {
  userId: string;
  orderId: string;
  bytes: Buffer;
  mime: string;
}) {
  await schema();

  if (args.bytes.length < 1 || args.bytes.length > 6 * 1024 * 1024) {
    throw new Error("Payment screenshot must be 6 MB or smaller.");
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(args.mime)) {
    throw new Error("Use a JPEG, PNG or WebP screenshot.");
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT * FROM soko_orders
    WHERE id=${clean(args.orderId, 100)}
    LIMIT 1
  ` as OrderRow[];

  const order = rows[0];

  if (!order) throw new Error("Order not found.");
  if (order.buyer_user_id !== args.userId) {
    throw new Error("Only the buyer can upload payment proof.");
  }

  if (!["awaiting_payment", "payment_rejected"].includes(order.status)) {
    throw new Error("Payment proof cannot be changed at this stage.");
  }

  /*
   * KRISTO_SOKO_CASHAPP_DUPLICATE_PROOF_HASH_GUARD
   *
   * Hash the exact uploaded image bytes.
   * Never expose this fingerprint to mobile.
   */
  const paymentProofSha256 =
    createHash("sha256")
      .update(args.bytes)
      .digest("hex");

  if (order.payment_method === "cash_app") {
    const duplicateProof = await sql`
      SELECT id
      FROM soko_orders
      WHERE id <> ${order.id}
        AND payment_method = 'cash_app'
        AND payment_proof_sha256 =
          ${paymentProofSha256}
      LIMIT 1
    ` as Array<{ id: string }>;

    if (duplicateProof[0]) {
      console.warn(
        "KRISTO_SOKO_CASHAPP_DUPLICATE_PROOF_BLOCKED",
        {
          orderId: order.id,
          buyerUserId: order.buyer_user_id,
          sellerUserId: order.seller_user_id,
        }
      );

      throw new Error(
        "This payment screenshot has already been used for another order."
      );
    }
  }

  const proofBase64 = args.bytes.toString("base64");

  let proofUpdated: OrderRow[];

  try {
    proofUpdated = await sql`
    UPDATE soko_orders
    SET
      proof_key=${"private-db/" + order.id},
      proof_base64=${proofBase64},
      proof_mime=${args.mime},
      payment_proof_sha256=${paymentProofSha256},
      updated_at=NOW()
    WHERE id=${order.id}
      AND buyer_user_id=${args.userId}
      AND status=${order.status}
    RETURNING *
    ` as OrderRow[];
  } catch (error) {
    const message = String(
      (error as Error)?.message ||
      error ||
      ""
    );

    if (
      order.payment_method === "cash_app" &&
      (
        message.includes(
          "soko_orders_cash_app_proof_sha256_uidx"
        ) ||
        message.toLowerCase().includes(
          "duplicate key"
        )
      )
    ) {
      throw new Error(
        "This payment screenshot has already been used for another order."
      );
    }

    throw error;
  }

  if (!proofUpdated[0]) {
    throw new Error("Order changed. Refresh and try again.");
  }

  return publicOrder(proofUpdated[0]);
}

export async function getSokoPaymentProof(args: {
  userId: string;
  orderId: string;
}) {
  await schema();

  const sql = sqlClient();

  const rows = await sql`
    SELECT * FROM soko_orders
    WHERE id=${clean(args.orderId, 100)}
    LIMIT 1
  ` as OrderRow[];

  const order = rows[0];

  if (!order) throw new Error("Order not found.");

  if (
    order.buyer_user_id !== args.userId &&
    order.seller_user_id !== args.userId
  ) {
    throw new Error("You cannot view this payment proof.");
  }

  if (!order.proof_base64 || !order.proof_mime) {
    throw new Error("Payment proof has not been uploaded.");
  }

  return {
    bytes: Buffer.from(order.proof_base64, "base64"),
    mime: order.proof_mime,
  };
}



/*
 * KRISTO_SOKO_MULTI_PROOF_FUNCTIONS_V1
 *
 * Additive multi-screenshot helpers.
 *
 * Existing saveSokoPaymentProof/getSokoPaymentProof stay untouched,
 * so older clients continue to use the original single-proof flow.
 */

export async function saveSokoPaymentProofAtPosition(args: {
  userId: string;
  orderId: string;
  bytes: Buffer;
  mime: string;
  position: number;
  reset?: boolean;
}) {
  await schema();

  const position = Number(args.position);

  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > 4
  ) {
    throw new Error(
      "Payment screenshot position must be between 0 and 4."
    );
  }

  if (
    args.reset === true &&
    position !== 0
  ) {
    throw new Error(
      "A new payment screenshot set must start at position 0."
    );
  }

  /*
   * Keep the same limit as the current route for now.
   * Route/mobile size will be increased in a separate verified stage.
   */
  if (
    args.bytes.length < 1 ||
    args.bytes.length > 6 * 1024 * 1024
  ) {
    throw new Error(
      "Payment screenshot must be 6 MB or smaller."
    );
  }

  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
    ].includes(args.mime)
  ) {
    throw new Error(
      "Use a JPEG, PNG or WebP screenshot."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT *
    FROM soko_orders
    WHERE id=${clean(args.orderId, 100)}
    LIMIT 1
  ` as OrderRow[];

  const order = rows[0];

  if (!order) {
    throw new Error("Order not found.");
  }

  if (order.buyer_user_id !== args.userId) {
    throw new Error(
      "Only the buyer can upload payment proof."
    );
  }

  if (
    ![
      "awaiting_payment",
      "payment_rejected",
    ].includes(order.status)
  ) {
    throw new Error(
      "Payment proof cannot be changed at this stage."
    );
  }

  const proofSha256 =
    createHash("sha256")
      .update(args.bytes)
      .digest("hex");

  /*
   * Check old one-image orders too.
   */
  if (order.payment_method === "cash_app") {
    const legacyDuplicate = await sql`
      SELECT id
      FROM soko_orders
      WHERE id <> ${order.id}
        AND payment_method='cash_app'
        AND payment_proof_sha256=${proofSha256}
      LIMIT 1
    ` as Array<{ id: string }>;

    if (legacyDuplicate[0]) {
      console.warn(
        "KRISTO_SOKO_MULTI_PROOF_DUPLICATE_BLOCKED",
        {
          orderId: order.id,
          position,
          source: "legacy",
        }
      );

      throw new Error(
        "This payment screenshot has already been used for another order."
      );
    }

    const duplicateMulti =
      args.reset === true && position === 0
        ? await sql`
            SELECT order_id, position
            FROM soko_order_payment_proofs
            WHERE payment_method='cash_app'
              AND proof_sha256=${proofSha256}
              AND order_id <> ${order.id}
            LIMIT 1
          ` as Array<{
            order_id: string;
            position: number;
          }>
        : await sql`
            SELECT order_id, position
            FROM soko_order_payment_proofs
            WHERE payment_method='cash_app'
              AND proof_sha256=${proofSha256}
              AND NOT (
                order_id=${order.id}
                AND position=${position}
              )
            LIMIT 1
          ` as Array<{
            order_id: string;
            position: number;
          }>;

    if (duplicateMulti[0]) {
      if (
        duplicateMulti[0].order_id === order.id
      ) {
        throw new Error(
          "This screenshot is already attached to this order."
        );
      }

      console.warn(
        "KRISTO_SOKO_MULTI_PROOF_DUPLICATE_BLOCKED",
        {
          orderId: order.id,
          position,
          source: "multi",
        }
      );

      throw new Error(
        "This payment screenshot has already been used for another order."
      );
    }
  }

  const proofBase64 =
    args.bytes.toString("base64");

  /*
   * Position 0 remains mirrored through the existing legacy
   * function. That keeps:
   *   proof_key
   *   proof_base64
   *   proof_mime
   *   payment_proof_sha256
   * and the existing race-safe unique guard working.
   */
  let legacyUpdated:
    | ReturnType<typeof publicOrder>
    | null = null;

  if (position === 0) {
    legacyUpdated =
      await saveSokoPaymentProof({
        userId: args.userId,
        orderId: order.id,
        bytes: args.bytes,
        mime: args.mime,
      });

    if (args.reset === true) {
      await sql`
        DELETE FROM soko_order_payment_proofs
        WHERE order_id=${order.id}
      `;
    }
  } else {
    /*
     * Do not allow screenshot 2..5 before screenshot 1 exists.
     */
    const firstProof = await sql`
      SELECT position
      FROM soko_order_payment_proofs
      WHERE order_id=${order.id}
        AND position=0
      LIMIT 1
    ` as Array<{ position: number }>;

    if (
      !firstProof[0] &&
      !order.proof_key
    ) {
      throw new Error(
        "Upload the first payment screenshot before adding more."
      );
    }
  }

  try {
    await sql`
      INSERT INTO soko_order_payment_proofs (
        id,
        order_id,
        buyer_user_id,
        seller_user_id,
        payment_method,
        position,
        proof_base64,
        proof_mime,
        proof_sha256,
        created_at,
        updated_at
      )
      VALUES (
        ${order.id + ":" + position},
        ${order.id},
        ${order.buyer_user_id},
        ${order.seller_user_id},
        ${order.payment_method},
        ${position},
        ${proofBase64},
        ${args.mime},
        ${proofSha256},
        NOW(),
        NOW()
      )
      ON CONFLICT (order_id, position)
      DO UPDATE SET
        proof_base64=EXCLUDED.proof_base64,
        proof_mime=EXCLUDED.proof_mime,
        proof_sha256=EXCLUDED.proof_sha256,
        updated_at=NOW()
    `;
  } catch (error) {
    const message = String(
      (error as Error)?.message ||
      error ||
      ""
    );

    if (
      order.payment_method === "cash_app" &&
      (
        message.includes(
          "soko_order_payment_proofs_cashapp_sha256_uidx"
        ) ||
        message.toLowerCase().includes(
          "duplicate key"
        )
      )
    ) {
      throw new Error(
        "This payment screenshot has already been used for another order."
      );
    }

    throw error;
  }

  const countRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM soko_order_payment_proofs
    WHERE order_id=${order.id}
  ` as Array<{ count: number }>;

  const paymentProofCount = Math.max(
    1,
    Math.min(
      5,
      Number(countRows[0]?.count || 0)
    )
  );

  if (legacyUpdated) {
    return {
      ...legacyUpdated,
      paymentProofCount,
    };
  }

  const updatedRows = await sql`
    UPDATE soko_orders
    SET updated_at=NOW()
    WHERE id=${order.id}
      AND buyer_user_id=${args.userId}
      AND status=${order.status}
    RETURNING *
  ` as OrderRow[];

  if (!updatedRows[0]) {
    throw new Error(
      "Order changed. Refresh and try again."
    );
  }

  return {
    ...publicOrder(updatedRows[0]),
    paymentProofCount,
  };
}

export async function getSokoPaymentProofAtPosition(args: {
  userId: string;
  orderId: string;
  position: number;
}) {
  await schema();

  const position = Number(args.position);

  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > 4
  ) {
    throw new Error(
      "Payment screenshot position must be between 0 and 4."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT *
    FROM soko_orders
    WHERE id=${clean(args.orderId, 100)}
    LIMIT 1
  ` as OrderRow[];

  const order = rows[0];

  if (!order) {
    throw new Error("Order not found.");
  }

  if (
    order.buyer_user_id !== args.userId &&
    order.seller_user_id !== args.userId
  ) {
    throw new Error(
      "You cannot view this payment proof."
    );
  }

  const proofs = await sql`
    SELECT
      proof_base64,
      proof_mime
    FROM soko_order_payment_proofs
    WHERE order_id=${order.id}
      AND position=${position}
    LIMIT 1
  ` as Array<{
    proof_base64: string;
    proof_mime: string;
  }>;

  if (proofs[0]) {
    return {
      bytes: Buffer.from(
        proofs[0].proof_base64,
        "base64"
      ),
      mime: proofs[0].proof_mime,
    };
  }

  /*
   * Old orders had only the legacy proof.
   */
  if (position === 0) {
    return getSokoPaymentProof({
      userId: args.userId,
      orderId: order.id,
    });
  }

  throw new Error(
    "Payment screenshot has not been uploaded."
  );
}

export async function getSokoPaymentProofCount(args: {
  userId: string;
  orderId: string;
}) {
  await schema();

  const sql = sqlClient();

  const rows = await sql`
    SELECT *
    FROM soko_orders
    WHERE id=${clean(args.orderId, 100)}
    LIMIT 1
  ` as OrderRow[];

  const order = rows[0];

  if (!order) {
    throw new Error("Order not found.");
  }

  if (
    order.buyer_user_id !== args.userId &&
    order.seller_user_id !== args.userId
  ) {
    throw new Error(
      "You cannot view this payment proof."
    );
  }

  const countRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM soko_order_payment_proofs
    WHERE order_id=${order.id}
  ` as Array<{ count: number }>;

  const multiCount =
    Number(countRows[0]?.count || 0);

  if (multiCount > 0) {
    return Math.min(5, multiCount);
  }

  return order.proof_key ? 1 : 0;
}


/**
 * Trusted server/provider integration only.
 *
 * Bind the provider payment identity returned by Cash App
 * to an existing SOKO order.
 *
 * Never expose this as a buyer/mobile supplied mutation.
 */

/**
 * Server-only authoritative Cash App payment context.
 *
 * This helper deliberately ignores client-supplied amount,
 * currency, seller identity, CashTag, provider payment ID,
 * and provider reference.
 *
 * A future Cash App Partner payment-creation route should
 * load these values here before calling the provider API.
 */
export async function getSokoCashAppPaymentContext(args: {
  orderId: string;
  buyerUserId: string;
}) {
  await schema();

  const orderId = clean(args.orderId, 100);
  const buyerUserId = clean(args.buyerUserId, 180);

  if (!orderId || !buyerUserId) {
    throw new Error(
      "Valid order and buyer identity are required."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT *
    FROM soko_orders
    WHERE id = ${orderId}
      AND buyer_user_id = ${buyerUserId}
      AND payment_method = 'cash_app'
      AND status IN (
        'awaiting_payment',
        'payment_submitted',
        'payment_rejected'
      )
    LIMIT 1
  ` as OrderRow[];

  const order = rows[0];

  if (!order) {
    throw new Error(
      "Cash App payment is unavailable for this order."
    );
  }

  const totals =
    order.snapshot?.totals &&
    typeof order.snapshot.totals === "object"
      ? order.snapshot.totals
      : {};

  const amount = Number(totals.finalTotal);
  const amountMinor = Math.round(amount * 100);

  const currency = clean(
    totals.currency || order.snapshot?.currency,
    10
  ).toUpperCase();

  const cashTag = clean(
    order.snapshot?.payment?.cashTag,
    20
  );

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    !currency ||
    !order.seller_user_id
  ) {
    throw new Error(
      "Authoritative Cash App payment information is incomplete."
    );
  }

  return {
    orderId: order.id,
    buyerUserId: order.buyer_user_id,
    sellerUserId: order.seller_user_id,
    amountMinor,
    currency,
    cashTag,
    providerPaymentId:
      clean(order.provider_payment_id, 180),
    providerReference:
      clean(order.provider_reference, 180),
    status: order.status,
  };
}

export async function ensureSokoCashAppOrderReferenceById(
  orderId: string
) {
  await schema();
  const id = clean(orderId, 180);
  if (!id) return null;
  const sql = sqlClient();
  const rows = await sql`
    SELECT * FROM soko_orders
    WHERE id = ${id}
      AND payment_method = 'cash_app'
    LIMIT 1
  ` as OrderRow[];
  if (!rows[0]) return null;
  return ensureSokoCashAppOrderReference(rows[0]);
}

export async function bindSokoOrderProviderPayment(args: {
  orderId: string;
  sellerUserId: string;
  provider: "cash_app";
  providerPaymentId: string;
  providerReference?: string;
}) {
  await schema();

  const orderId = clean(
    args.orderId,
    180
  );

  const sellerUserId = clean(
    args.sellerUserId,
    180
  );

  const providerPaymentId = clean(
    args.providerPaymentId,
    180
  );

  const providerReference = clean(
    args.providerReference,
    180
  );

  if (
    !orderId ||
    !sellerUserId ||
    args.provider !== "cash_app" ||
    !providerPaymentId
  ) {
    throw new Error(
      "Valid trusted provider payment identity is required."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    UPDATE soko_orders
    SET
      payment_provider = 'cash_app',
      provider_payment_id =
        ${providerPaymentId},
      provider_reference = CASE
        WHEN provider_reference = ''
          THEN ${providerReference}
        ELSE provider_reference
      END,
      updated_at = NOW()
    WHERE id = ${orderId}
      AND seller_user_id = ${sellerUserId}
      AND payment_method = 'cash_app'
      AND status IN (
        'awaiting_payment',
        'payment_submitted',
        'payment_rejected'
      )
      AND (
        provider_payment_id = ''
        OR (
          payment_provider = 'cash_app'
          AND provider_payment_id =
            ${providerPaymentId}
        )
      )
      AND (
        provider_reference = ''
        OR ${providerReference} = ''
        OR provider_reference =
          ${providerReference}
      )
    RETURNING *
  ` as OrderRow[];

  if (!rows[0]) {
    throw new Error(
      "Order cannot be bound to this provider payment."
    );
  }

  return publicOrder(rows[0]);
}

export async function findSokoCashAppOrderMatch(args: {
  sellerUserId?: string;
  amountMinor: number | null;
  currency: string;
  providerPaymentId: string;
  providerReference?: string;
}) {
  await schema();

  const sellerUserId = clean(
    args.sellerUserId,
    180
  );

  const currency = clean(
    args.currency,
    10
  ).toUpperCase();

  const providerPaymentId = clean(
    args.providerPaymentId,
    180
  );

  const providerReference = clean(
    args.providerReference,
    180
  );

  /*
   * Security rule:
   * amount + currency alone must never identify an order.
   *
   * A trusted Cash App provider payment ID must already
   * have been bound to the order by server-side code.
   *
   * Provider reference is supplemental evidence only.
   */
  if (
    !currency ||
    typeof args.amountMinor !== "number" ||
    !Number.isInteger(args.amountMinor) ||
    args.amountMinor < 0 ||
    !providerPaymentId
  ) {
    return null;
  }

  const sql = sqlClient();

  const consumed = await sql`
    SELECT id, status
    FROM soko_orders
    WHERE payment_method = 'cash_app'
      AND payment_provider = 'cash_app'
      AND provider_payment_id = ${providerPaymentId}
      AND status IN (
        'payment_approved',
        'preparing_shipment',
        'shipped',
        'delivered'
      )
    LIMIT 1
  ` as Array<{ id: string; status: string }>;

  if (consumed[0]) {
    return null;
  }

  const boundRows = await sql`
    SELECT *
    FROM soko_orders
    WHERE payment_method = 'cash_app'
      AND (
        ${sellerUserId} = ''
        OR seller_user_id = ${sellerUserId}
      )
      AND status IN (
        'awaiting_payment',
        'payment_submitted'
      )
      AND UPPER(
        COALESCE(
          snapshot->'totals'->>'currency',
          snapshot->>'currency',
          ''
        )
      ) = ${currency}
      AND ROUND(
        (
          COALESCE(
            NULLIF(
              snapshot->'totals'->>'finalTotal',
              ''
            ),
            NULLIF(
              snapshot->>'price',
              ''
            )
          )
        )::numeric * 100
      )::bigint = ${args.amountMinor}
      AND payment_provider = 'cash_app'
      AND (
        ${providerPaymentId} = ''
        OR provider_payment_id = ${providerPaymentId}
      )
      AND (
        ${providerReference} = ''
        OR provider_reference = ${providerReference}
      )
      AND (
        ${providerPaymentId} <> ''
        OR ${providerReference} <> ''
      )
    ORDER BY created_at DESC
    LIMIT 2
  ` as OrderRow[];

  /*
   * Zero matches: no action.
   * Multiple matches: ambiguous, no action.
   */
  if (boundRows.length === 1) {
    return publicOrder(boundRows[0]);
  }

  if (boundRows.length > 1 || !providerReference) {
    return null;
  }

  const referenced = await sql`
    SELECT *
    FROM soko_orders
    WHERE payment_method = 'cash_app'
      AND payment_provider = 'cash_app'
      AND (
        ${sellerUserId} = ''
        OR seller_user_id = ${sellerUserId}
      )
      AND status IN (
        'awaiting_payment',
        'payment_submitted'
      )
      AND provider_reference = ${providerReference}
      AND UPPER(
        COALESCE(
          snapshot->'totals'->>'currency',
          snapshot->>'currency',
          ''
        )
      ) = ${currency}
      AND ROUND(
        (
          COALESCE(
            NULLIF(
              snapshot->'totals'->>'finalTotal',
              ''
            ),
            NULLIF(
              snapshot->>'price',
              ''
            )
          )
        )::numeric * 100
      )::bigint = ${args.amountMinor}
      AND (
        provider_payment_id = ''
        OR provider_payment_id = ${providerPaymentId}
      )
    ORDER BY created_at DESC
    LIMIT 2
  ` as OrderRow[];

  if (referenced.length !== 1) {
    return null;
  }

  return publicOrder(referenced[0]);
}

/**
 * Trusted server-only Cash App payment transition.
 *
 * IMPORTANT:
 * - Never expose this directly to buyer/mobile input.
 * - The payment must already be bound to this order by trusted server code.
 * - Provider identity + amount + currency are re-checked here even if
 *   a webhook matcher already found the order.
 * - This helper is idempotent for an already-approved matching payment.
 *
 * This helper is intentionally NOT wired to the webhook route yet.
 */
async function syncProviderApprovedProduct(args: {
  orderId: string;
  productId: string;
  sellerUserId: string;
}) {
  const sql = sqlClient();

  /*
   * Inventory was already reserved during order creation.
   * This only repairs/finalizes public listing visibility.
   * It never deducts stock again.
   */
  await sql`
    UPDATE soko_products
    SET
      status = 'Sold',
      updated_at = NOW()
    WHERE id = ${args.productId}
      AND stock_available <= 0
      AND status = 'Active'
  `;

  console.log(
    "KRISTO_SOKO_PROVIDER_PAYMENT_PRODUCT_SYNC",
    {
      orderId: args.orderId,
      productId: args.productId,
      sellerUserId: args.sellerUserId,
      inventoryDeductedAgain: false,
    }
  );
}

export async function applyCashAppCapturedPaymentToOrder(args: {
  orderId: string;
  amountMinor: number;
  currency: string;
  providerPaymentId: string;
  providerReference?: string;
  sellerUserId?: string;
}) {
  await schema();

  const orderId = clean(args.orderId, 100);
  const currency = clean(args.currency, 12).toUpperCase();
  const providerPaymentId = clean(
    args.providerPaymentId,
    180
  );
  const providerReference = clean(
    args.providerReference,
    180
  );
  const sellerUserId = clean(
    args.sellerUserId,
    180
  );

  if (
    !orderId ||
    !currency ||
    !Number.isInteger(args.amountMinor) ||
    args.amountMinor < 0 ||
    !providerPaymentId
  ) {
    throw new Error(
      "Provider payment verification data is incomplete."
    );
  }

  const sql = sqlClient();

  /*
   * First inspect the exact order.
   * This gives us a safe idempotent path if the same
   * verified provider payment already approved it.
   */
  const existingRows = await sql`
    SELECT *
    FROM soko_orders
    WHERE id = ${orderId}
      AND payment_method = 'cash_app'
      AND payment_provider = 'cash_app'
      AND (
        ${sellerUserId} = ''
        OR seller_user_id = ${sellerUserId}
      )
      AND UPPER(
        COALESCE(
          snapshot->'totals'->>'currency',
          snapshot->>'currency',
          ''
        )
      ) = ${currency}
      AND ROUND(
        (
          COALESCE(
            NULLIF(
              snapshot->'totals'->>'finalTotal',
              ''
            ),
            NULLIF(
              snapshot->>'price',
              ''
            )
          )
        )::numeric * 100
      )::bigint = ${args.amountMinor}
      AND (
        ${providerPaymentId} = ''
        OR provider_payment_id = ${providerPaymentId}
      )
      AND (
        ${providerReference} = ''
        OR provider_reference = ${providerReference}
      )
      AND (
        ${providerPaymentId} <> ''
        OR ${providerReference} <> ''
      )
    LIMIT 1
  ` as OrderRow[];

  const existing = existingRows[0];

  if (!existing) {
    throw new Error(
      "Provider payment does not match this order."
    );
  }

  if (
    [
      "payment_approved",
      "preparing_shipment",
      "shipped",
      "delivered",
    ].includes(existing.status)
  ) {
    await syncProviderApprovedProduct({
      orderId: existing.id,
      productId: existing.product_id,
      sellerUserId: existing.seller_user_id,
    });

    return {
      order: publicOrder(existing),
      applied: false,
      alreadyApplied: true,
    };
  }

  if (
    ![
      "awaiting_payment",
      "payment_submitted",
    ].includes(existing.status) ||
    !isPayableSokoOrderStatus(existing.status)
  ) {
    throw new Error(
      "Order is not eligible for provider payment approval."
    );
  }

  const captureAudit = cashAppCaptureAuditMetadata({
    amountMinor: args.amountMinor,
    currency,
    eventType: "payment.status.updated",
    paymentStatus: "CAPTURED",
  });

  /*
   * Atomic status transition.
   *
   * All authoritative provider checks are repeated in the
   * UPDATE so a concurrent order change cannot bypass them.
   */
  const approvedRows = await sql`
    UPDATE soko_orders
    SET
      status = 'payment_approved',
      payment_date = COALESCE(payment_date, NOW()),
      payment_provider = 'cash_app',
      provider_payment_id = CASE
        WHEN provider_payment_id = ''
          THEN ${providerPaymentId}
        ELSE provider_payment_id
      END,
      snapshot = jsonb_set(
        COALESCE(snapshot, '{}'::jsonb),
        '{payment,captureAudit}',
        ${JSON.stringify(captureAudit)}::jsonb
      ),
      updated_at = NOW()
    WHERE id = ${orderId}
      AND payment_method = 'cash_app'
      AND payment_provider = 'cash_app'
      AND status IN (
        'awaiting_payment',
        'payment_submitted'
      )
      AND (
        ${sellerUserId} = ''
        OR seller_user_id = ${sellerUserId}
      )
      AND UPPER(
        COALESCE(
          snapshot->'totals'->>'currency',
          snapshot->>'currency',
          ''
        )
      ) = ${currency}
      AND ROUND(
        (
          COALESCE(
            NULLIF(
              snapshot->'totals'->>'finalTotal',
              ''
            ),
            NULLIF(
              snapshot->>'price',
              ''
            )
          )
        )::numeric * 100
      )::bigint = ${args.amountMinor}
      AND (
        ${providerPaymentId} = ''
        OR provider_payment_id = ${providerPaymentId}
      )
      AND (
        ${providerReference} = ''
        OR provider_reference = ${providerReference}
      )
      AND (
        ${providerPaymentId} <> ''
        OR ${providerReference} <> ''
      )
    RETURNING *
  ` as OrderRow[];

  if (!approvedRows[0]) {
    /*
     * A concurrent request may have approved the same
     * provider payment between SELECT and UPDATE.
     */
    const currentRows = await sql`
      SELECT *
      FROM soko_orders
      WHERE id = ${orderId}
        AND payment_method = 'cash_app'
        AND payment_provider = 'cash_app'
        AND status IN (
          'payment_approved',
          'preparing_shipment',
          'shipped',
          'delivered'
        )
        AND (
          ${sellerUserId} = ''
          OR seller_user_id = ${sellerUserId}
        )
        AND UPPER(
          COALESCE(
            snapshot->'totals'->>'currency',
            snapshot->>'currency',
            ''
          )
        ) = ${currency}
        AND ROUND(
          (
            COALESCE(
              NULLIF(
                snapshot->'totals'->>'finalTotal',
                ''
              ),
              NULLIF(
                snapshot->>'price',
                ''
              )
            )
          )::numeric * 100
        )::bigint = ${args.amountMinor}
        AND (
          ${providerPaymentId} = ''
          OR provider_payment_id = ${providerPaymentId}
        )
        AND (
          ${providerReference} = ''
          OR provider_reference = ${providerReference}
        )
        AND (
          ${providerPaymentId} <> ''
          OR ${providerReference} <> ''
        )
      LIMIT 1
    ` as OrderRow[];

    if (currentRows[0]) {
      await syncProviderApprovedProduct({
        orderId: currentRows[0].id,
        productId: currentRows[0].product_id,
        sellerUserId: currentRows[0].seller_user_id,
      });

      return {
        order: publicOrder(currentRows[0]),
        applied: false,
        alreadyApplied: true,
      };
    }

    throw new Error(
      "Order changed before provider payment could be applied."
    );
  }

  const approved = approvedRows[0];

  /*
   * Same inventory-finalization semantics used by
   * seller manual payment approval.
   *
   * Inventory was already reserved at order creation,
   * therefore do not deduct inventory again.
   */
  await syncProviderApprovedProduct({
    orderId: approved.id,
    productId: approved.product_id,
    sellerUserId: approved.seller_user_id,
  });

  console.log(
    "KRISTO_SOKO_PROVIDER_PAYMENT_APPROVED",
    {
      orderId: approved.id,
      productId: approved.product_id,
      provider: "cash_app",
      sellerUserId: approved.seller_user_id,
      inventoryDeductedAgain: false,
    }
  );

  return {
    order: publicOrder(approved),
    applied: true,
    alreadyApplied: false,
  };
}

function stripeOrderAmountMinor(order: OrderRow) {
  const totals =
    order.snapshot?.totals &&
    typeof order.snapshot.totals === "object"
      ? order.snapshot.totals
      : {};

  return toStripeAmountMinor(
    Number(totals.finalTotal),
    clean(totals.currency || order.snapshot?.currency, 10)
  );
}

export async function getSokoStripePaymentContext(args: {
  orderId: string;
  buyerUserId: string;
}) {
  await schema();

  const orderId = clean(args.orderId, 100);
  const buyerUserId = clean(args.buyerUserId, 180);

  if (!orderId || !buyerUserId) {
    throw new Error("Valid order and buyer identity are required.");
  }

  const sql = sqlClient();
  const rows = await sql`
    SELECT *
    FROM soko_orders
    WHERE id = ${orderId}
      AND buyer_user_id = ${buyerUserId}
      AND payment_method = ${SOKO_STRIPE_PAYMENT_METHOD}
    LIMIT 1
  ` as OrderRow[];

  const order = rows[0];

  if (!order) {
    throw new Error("Card payment is unavailable for this order.");
  }

  if (order.buyer_user_id !== buyerUserId) {
    throw new Error("Card payment is unavailable for this order.");
  }

  const gate = assertSokoStripeSellerGate({
    sellerUserId: order.seller_user_id,
    buyerUserId,
    productStatus: "Active",
    currency: clean(
      order.snapshot?.totals?.currency || order.snapshot?.currency,
      10
    ),
    allowedSellerUserId: configuredSokoStripeSellerUserId(),
  });

  if (!gate.ok) {
    throw new Error(gate.error);
  }

  const amountMinor = stripeOrderAmountMinor(order);
  const currency = clean(
    order.snapshot?.totals?.currency || order.snapshot?.currency,
    10
  ).toUpperCase();

  if (!amountMinor || !currency) {
    throw new Error("Authoritative card payment information is incomplete.");
  }

  const retry = Number(
    order.snapshot?.payment?.stripeIdempotencyRetry || 0
  );

  return {
    order,
    orderId: order.id,
    buyerUserId: order.buyer_user_id,
    sellerUserId: order.seller_user_id,
    status: order.status,
    amountMinor,
    currency,
    providerPaymentId: clean(order.provider_payment_id, 180),
    retry: Number.isFinite(retry) && retry > 0 ? Math.trunc(retry) : 0,
    totals: {
      itemPrice: Number(order.snapshot?.totals?.itemPrice),
      deliveryPrice: Number(order.snapshot?.totals?.deliveryPrice),
      finalTotal: Number(order.snapshot?.totals?.finalTotal),
      currency,
    },
  };
}

export async function bindSokoStripePaymentIntent(args: {
  orderId: string;
  buyerUserId: string;
  paymentIntentId: string;
  replacePreviousId?: string;
  retry?: number;
}) {
  await schema();

  const orderId = clean(args.orderId, 180);
  const buyerUserId = clean(args.buyerUserId, 180);
  const paymentIntentId = clean(args.paymentIntentId, 180);
  const replacePreviousId = clean(args.replacePreviousId, 180);
  const retry =
    typeof args.retry === "number" && Number.isFinite(args.retry)
      ? Math.max(0, Math.trunc(args.retry))
      : 0;

  if (!orderId || !buyerUserId || !paymentIntentId) {
    throw new Error("Valid Stripe payment identity is required.");
  }

  const sql = sqlClient();
  const rows = await sql`
    UPDATE soko_orders
    SET
      payment_provider = ${SOKO_STRIPE_PROVIDER},
      provider_payment_id = ${paymentIntentId},
      provider_reference = CASE
        WHEN provider_reference = ''
          THEN ${paymentIntentId}
        ELSE provider_reference
      END,
      snapshot = jsonb_set(
        jsonb_set(
          COALESCE(snapshot, '{}'::jsonb),
          '{payment,stripePaymentIntentId}',
          ${JSON.stringify(paymentIntentId)}::jsonb
        ),
        '{payment,stripeIdempotencyRetry}',
        ${JSON.stringify(retry)}::jsonb
      ),
      updated_at = NOW()
    WHERE id = ${orderId}
      AND buyer_user_id = ${buyerUserId}
      AND seller_user_id = ${configuredSokoStripeSellerUserId()}
      AND payment_method = ${SOKO_STRIPE_PAYMENT_METHOD}
      AND status = 'awaiting_payment'
      AND (
        provider_payment_id = ''
        OR provider_payment_id = ${paymentIntentId}
        OR (
          ${replacePreviousId} <> ''
          AND payment_provider = ${SOKO_STRIPE_PROVIDER}
          AND provider_payment_id = ${replacePreviousId}
        )
      )
    RETURNING *
  ` as OrderRow[];

  if (!rows[0]) {
    throw new Error("Order cannot be bound to this card payment.");
  }

  return publicOrder(rows[0]);
}

export async function findSokoOrderByStripePaymentIntent(
  paymentIntentId: string
) {
  await schema();
  const id = clean(paymentIntentId, 180);
  if (!id) return null;
  const sql = sqlClient();
  const rows = await sql`
    SELECT *
    FROM soko_orders
    WHERE payment_provider = ${SOKO_STRIPE_PROVIDER}
      AND provider_payment_id = ${id}
    LIMIT 2
  ` as OrderRow[];
  return rows;
}

export async function applySokoStripeCapturedPaymentToOrder(args: {
  orderId: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  eventId: string;
  livemode: boolean;
}) {
  await schema();

  const orderId = clean(args.orderId, 180);
  const paymentIntentId = clean(args.paymentIntentId, 180);
  const currency = clean(args.currency, 10).toUpperCase();
  const eventId = clean(args.eventId, 180);
  const allowedSellerUserId = configuredSokoStripeSellerUserId();
  const amountMinor = Math.trunc(args.amountMinor);

  if (
    !orderId ||
    !paymentIntentId ||
    !currency ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    throw new Error("Valid Stripe capture is required.");
  }

  const sql = sqlClient();
  const existingRows = await sql`
    SELECT *
    FROM soko_orders
    WHERE id = ${orderId}
      AND payment_method = ${SOKO_STRIPE_PAYMENT_METHOD}
      AND payment_provider = ${SOKO_STRIPE_PROVIDER}
      AND provider_payment_id = ${paymentIntentId}
      AND seller_user_id = ${allowedSellerUserId}
    LIMIT 1
  ` as OrderRow[];

  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Provider payment does not match this order.");
  }

  if (
    [
      "payment_approved",
      "preparing_shipment",
      "shipped",
      "delivered",
    ].includes(existing.status)
  ) {
    await syncProviderApprovedProduct({
      orderId: existing.id,
      productId: existing.product_id,
      sellerUserId: existing.seller_user_id,
    });

    return {
      order: publicOrder(existing),
      applied: false,
      alreadyApplied: true,
    };
  }

  if (existing.status !== "awaiting_payment") {
    throw new Error("Order is not eligible for card payment approval.");
  }

  const captureAudit = {
    provider: SOKO_STRIPE_PROVIDER,
    paymentIntentId,
    eventId,
    amountMinor,
    currency,
    livemode: args.livemode === true,
    capturedAt: new Date().toISOString(),
  };

  const approvedRows = await sql`
    UPDATE soko_orders
    SET
      status = 'payment_approved',
      payment_date = COALESCE(payment_date, NOW()),
      payment_provider = ${SOKO_STRIPE_PROVIDER},
      provider_payment_id = ${paymentIntentId},
      snapshot = jsonb_set(
        COALESCE(snapshot, '{}'::jsonb),
        '{payment,stripeCaptureAudit}',
        ${JSON.stringify(captureAudit)}::jsonb
      ),
      updated_at = NOW()
    WHERE id = ${orderId}
      AND payment_method = ${SOKO_STRIPE_PAYMENT_METHOD}
      AND payment_provider = ${SOKO_STRIPE_PROVIDER}
      AND status = 'awaiting_payment'
      AND seller_user_id = ${allowedSellerUserId}
      AND provider_payment_id = ${paymentIntentId}
      AND UPPER(
        COALESCE(
          snapshot->'totals'->>'currency',
          snapshot->>'currency',
          ''
        )
      ) = ${currency}
      AND ROUND(
        (
          COALESCE(
            NULLIF(
              snapshot->'totals'->>'finalTotal',
              ''
            ),
            NULLIF(
              snapshot->>'price',
              ''
            )
          )
        )::numeric * 100
      )::bigint = ${amountMinor}
    RETURNING *
  ` as OrderRow[];

  if (!approvedRows[0]) {
    const currentRows = await sql`
      SELECT *
      FROM soko_orders
      WHERE id = ${orderId}
        AND payment_method = ${SOKO_STRIPE_PAYMENT_METHOD}
        AND payment_provider = ${SOKO_STRIPE_PROVIDER}
        AND provider_payment_id = ${paymentIntentId}
        AND status IN (
          'payment_approved',
          'preparing_shipment',
          'shipped',
          'delivered'
        )
      LIMIT 1
    ` as OrderRow[];

    if (currentRows[0]) {
      await syncProviderApprovedProduct({
        orderId: currentRows[0].id,
        productId: currentRows[0].product_id,
        sellerUserId: currentRows[0].seller_user_id,
      });

      return {
        order: publicOrder(currentRows[0]),
        applied: false,
        alreadyApplied: true,
      };
    }

    throw new Error(
      "Order changed before card payment could be applied."
    );
  }

  const approved = approvedRows[0];
  await syncProviderApprovedProduct({
    orderId: approved.id,
    productId: approved.product_id,
    sellerUserId: approved.seller_user_id,
  });

  console.log("KRISTO_SOKO_STRIPE_PAYMENT_APPROVED", {
    orderId: approved.id,
    productId: approved.product_id,
    provider: SOKO_STRIPE_PROVIDER,
    sellerUserId: approved.seller_user_id,
    inventoryDeductedAgain: false,
  });

  return {
    order: publicOrder(approved),
    applied: true,
    alreadyApplied: false,
  };
}
