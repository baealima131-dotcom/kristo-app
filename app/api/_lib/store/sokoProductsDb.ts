import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { getDatabaseUrl } from "./authDb";
import { ensureSokoSellerAccessSchema, dbGetSokoSellerAccess } from "./sokoSellerAccessDb";
import { ensureSokoSafetySchema, dbGetSokoEnforcementStatus } from "./sokoSafetyDb";
import {
  isolateSokoCatalogProducts,
  resolveSokoCatalogPhotos,
  verifySokoImage,
} from "../sokoProductImages";
import {
  configuredSokoStripeSellerUserId,
  sokoStripeCardAvailableOnListing,
} from "@/app/api/_lib/sokoStripeCheckout";
import { sokoStripeServerConfigured } from "@/app/api/_lib/sokoStripeServer";
type Row = {
  id: string;
  seller_user_id: string;
  client_key: string;
  payload: Record<string, any>;
  status: string;
  stock_total: number;
  stock_available: number;
  created_at: string | Date;
};
let ready: Promise<void> | null = null;
function sqlClient() { const url = getDatabaseUrl(); if (!url) throw new Error("Database unavailable."); return neon(url); }
async function schema() {
  if (!ready) ready = (async () => {
    await ensureSokoSellerAccessSchema(); await ensureSokoSafetySchema();
    const sql = sqlClient();
    await sql`CREATE TABLE IF NOT EXISTS soko_products (
      id TEXT PRIMARY KEY, seller_user_id TEXT NOT NULL, client_key TEXT NOT NULL,
      payload JSONB NOT NULL, status TEXT NOT NULL CHECK (status IN ('Active','Draft','Sold','Deleted')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(seller_user_id, client_key)
    )`;
    await sql`ALTER TABLE soko_products
      ADD COLUMN IF NOT EXISTS stock_total INTEGER NOT NULL DEFAULT 1`;

    await sql`ALTER TABLE soko_products
      ADD COLUMN IF NOT EXISTS stock_available INTEGER NOT NULL DEFAULT 1`;

    await sql`UPDATE soko_products
      SET
        stock_total=GREATEST(1,stock_total),
        stock_available=GREATEST(
          0,
          LEAST(stock_total,stock_available)
        )`;

    await sql`CREATE INDEX IF NOT EXISTS soko_products_feed_idx ON soko_products(status, created_at DESC, id DESC)`;
  })().catch(error => { ready = null; throw error; });
  return ready;
}
function text(value: unknown, min: number, max: number) {
  if (typeof value !== "string") throw new Error("Missing product information.");
  const result = value.trim();
  if (result.length < min || result.length > max) throw new Error("Invalid product information length.");
  return result;
}
export async function assertSokoPublisher(userId: string, kristoId: string, productId?: string) {
  const access = await dbGetSokoSellerAccess({ userId, kristoId });
  if (!access.approved) throw new Error("Active SOKO seller access is required.");
  const state = await dbGetSokoEnforcementStatus({ sellerUserIds: [userId], productIds: productId ? [productId] : [] });
  if ((state.sellerStatus[userId] || "active") !== "active" || (productId && state.hiddenProductIds.includes(productId))) throw new Error("This seller or product is restricted.");
}
function listingStripeCardAvailable(
  row: Row,
  payload: Record<string, any>,
  stockAvailable: number
) {
  return sokoStripeCardAvailableOnListing({
    serverConfigured: sokoStripeServerConfigured(),
    sellerUserId: row.seller_user_id,
    productStatus: row.status,
    stockAvailable,
    currency: String(payload.currency || ""),
    allowedSellerUserId: configuredSokoStripeSellerUserId(),
    category: String(payload.category || ""),
  });
}

function publicProduct(row: Row) {
  const { imageKeys, ...payload } = row.payload || {};
  const photos = resolveSokoCatalogPhotos(imageKeys);
  const stockTotal = Math.max(
    1,
    Number(row.stock_total || 1)
  );

  const stockAvailable = Math.max(
    0,
    Number(row.stock_available || 0)
  );

  const paymentOptions =
    payload.paymentOptions &&
    typeof payload.paymentOptions === "object"
      ? { ...payload.paymentOptions }
      : {};

  paymentOptions.stripeCardAvailable = listingStripeCardAvailable(
    row,
    payload,
    stockAvailable
  );

  return {
    ...payload,
    paymentOptions,
    id: row.id,
    photos,
    image: photos[0] || "",
    serverId: row.id,
    status: row.status,
    stockTotal,
    stockAvailable,
    soldOut:
      row.status === "Sold" ||
      stockAvailable <= 0,
    createdAt: row.created_at,
  };
}
function publicProductWithoutImages(row: Row) {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? { ...row.payload }
      : {};
  delete (payload as { imageKeys?: unknown }).imageKeys;
  const stockTotal = Math.max(1, Number(row.stock_total || 1));
  const stockAvailable = Math.max(0, Number(row.stock_available || 0));
  const paymentOptions =
    payload.paymentOptions && typeof payload.paymentOptions === "object"
      ? { ...payload.paymentOptions }
      : {};
  paymentOptions.stripeCardAvailable = listingStripeCardAvailable(
    row,
    payload,
    stockAvailable
  );
  return {
    ...payload,
    paymentOptions,
    id: row.id,
    photos: [] as string[],
    image: "",
    serverId: row.id,
    status: row.status,
    stockTotal,
    stockAvailable,
    soldOut: row.status === "Sold" || stockAvailable <= 0,
    createdAt: row.created_at,
  };
}
export async function publishSokoProduct(userId: string, kristoId: string, displayName: string, input: Record<string, unknown>) {
  await schema();
  await assertSokoPublisher(userId, kristoId);
  const clientKey = text(input.clientKey, 3, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(clientKey)) throw new Error("Invalid publish key.");
  const sql = sqlClient();
  const existing = await sql`SELECT * FROM soko_products WHERE seller_user_id=${userId} AND client_key=${clientKey}` as Row[];
  if (existing[0]) {
    await assertSokoPublisher(userId, kristoId, existing[0].id);
    if (existing[0].status !== "Active") throw new Error("This listing already exists. Change its status in My Listings.");
    return publicProduct(existing[0]);
  }
  const title = text(input.title, 3, 120), location = text(input.location, 2, 160);
  const category = text(input.category, 1, 50), description = text(input.description ?? "", 0, 3000);
  if (!["TZS", "BIF", "USD"].includes(String(input.currency)) || !["New", "Used"].includes(String(input.condition))) throw new Error("Invalid currency or condition.");
  if (typeof input.price !== "number" || !Number.isFinite(input.price) || input.price <= 0 || input.price > 1e12) throw new Error("Invalid price.");
  if (!Array.isArray(input.imageKeys) || input.imageKeys.length < 1 || input.imageKeys.length > 8 || input.imageKeys.some(key => typeof key !== "string")) throw new Error("Choose 1–8 images.");
  const imageKeys = [...new Set(input.imageKeys as string[])];
  for (const key of imageKeys) await verifySokoImage(key, userId);
  const payment = input.paymentOptions as Record<string, unknown> | undefined;
  const methods = payment?.methods;
  if (!Array.isArray(methods) || !methods.length || methods.some(m => !["cash", "cash_app", "mobile_money"].includes(m))) throw new Error("Choose a payment method.");
  const cashTag = methods.includes("cash_app") ? text(payment?.cashTag, 1, 20) : "";
  if (cashTag && !/^(?=.*[A-Za-z])[A-Za-z0-9]{1,20}$/.test(cashTag)) throw new Error("Invalid Cash App tag.");
  const mobileNetwork = methods.includes("mobile_money") ? text(payment?.mobileNetwork, 2, 80) : "";
  const mobileNumber = methods.includes("mobile_money") ? text(payment?.mobileNumber, 7, 16) : "";
  if (mobileNumber && !/^\+?[0-9]{7,15}$/.test(mobileNumber)) throw new Error("Invalid mobile money number.");
  const recipientName = methods.includes("mobile_money") ? text(payment?.recipientName, 2, 120) : "";

  const fulfillmentInput =
    input.fulfillmentOptions &&
    typeof input.fulfillmentOptions === "object" &&
    !Array.isArray(input.fulfillmentOptions)
      ? input.fulfillmentOptions as Record<string, unknown>
      : {};

  const requestedType = text(
    fulfillmentInput.type || "",
    1,
    30
  );

  const fulfillmentType =
    category === "Vehicles"
      ? "freight"
      : requestedType;

  if (
    ![
      "pickup",
      "local_delivery",
      "parcel",
      "freight",
    ].includes(fulfillmentType)
  ) {
    throw new Error("Choose a delivery method.");
  }

  const flatFee =
    fulfillmentType === "local_delivery"
      ? Number(fulfillmentInput.flatFee)
      : 0;

  const estimatedDays =
    fulfillmentType === "local_delivery"
      ? Number(fulfillmentInput.estimatedDays)
      : 0;

  if (
    fulfillmentType === "local_delivery" &&
    (
      !Number.isFinite(flatFee) ||
      flatFee <= 0 ||
      flatFee > 1e9
    )
  ) {
    throw new Error(
      "Enter a valid local delivery fee."
    );
  }

  const addressInput =
    fulfillmentInput.addressFrom &&
    typeof fulfillmentInput.addressFrom === "object" &&
    !Array.isArray(fulfillmentInput.addressFrom)
      ? fulfillmentInput.addressFrom as Record<string, unknown>
      : {};

  const parcelInput =
    fulfillmentInput.parcel &&
    typeof fulfillmentInput.parcel === "object" &&
    !Array.isArray(fulfillmentInput.parcel)
      ? fulfillmentInput.parcel as Record<string, unknown>
      : {};

  const addressFrom = {
    name: fulfillmentType === "parcel"
      ? text(addressInput.name, 2, 120)
      : "",
    phone: fulfillmentType === "parcel"
      ? text(addressInput.phone ?? "", 0, 30)
      : "",
    street1: fulfillmentType === "parcel"
      ? text(addressInput.street1, 5, 240)
      : "",
    city: fulfillmentType === "parcel"
      ? text(addressInput.city, 2, 100)
      : "",
    state: fulfillmentType === "parcel"
      ? text(addressInput.state, 2, 100)
      : "",
    zip:
      fulfillmentType === "parcel" ||
      fulfillmentType === "freight"
        ? text(addressInput.zip, 3, 30)
        : "",
    country: fulfillmentType === "parcel"
      ? text(addressInput.country, 2, 80)
      : "",
  };

  const vehicleType =
    fulfillmentType === "freight"
      ? text(fulfillmentInput.vehicleType || "sedan", 3, 20)
          .toLowerCase()
      : "";

  if (
    fulfillmentType === "freight" &&
    (
      !/^\d{5}$/.test(addressFrom.zip) ||
      ![
        "sedan",
        "suv",
        "pickup",
        "truck",
        "van",
        "minivan",
      ].includes(vehicleType)
    )
  ) {
    throw new Error(
      "Enter a valid vehicle pickup ZIP and vehicle type."
    );
  }

  if (
    fulfillmentType === "freight" &&
    String(input.currency) !== "USD"
  ) {
    throw new Error(
      "Automatic vehicle delivery currently requires USD."
    );
  }

  const parcel = {
    length: fulfillmentType === "parcel"
      ? Number(parcelInput.length)
      : 0,
    width: fulfillmentType === "parcel"
      ? Number(parcelInput.width)
      : 0,
    height: fulfillmentType === "parcel"
      ? Number(parcelInput.height)
      : 0,
    weight: fulfillmentType === "parcel"
      ? Number(parcelInput.weight)
      : 0,
    distanceUnit:
      String(parcelInput.distanceUnit) === "cm"
        ? "cm"
        : "in",
    massUnit:
      String(parcelInput.massUnit) === "kg"
        ? "kg"
        : "lb",
  };

  if (
    fulfillmentType === "parcel" &&
    (
      !addressFrom.name ||
      !addressFrom.street1 ||
      !addressFrom.city ||
      !addressFrom.state ||
      !addressFrom.zip ||
      !addressFrom.country ||
      !Number.isFinite(parcel.length) ||
      parcel.length <= 0 ||
      !Number.isFinite(parcel.width) ||
      parcel.width <= 0 ||
      !Number.isFinite(parcel.height) ||
      parcel.height <= 0 ||
      !Number.isFinite(parcel.weight) ||
      parcel.weight <= 0
    )
  ) {
    throw new Error(
      "Complete the shipping address, weight and dimensions."
    );
  }

  const quantity = Number(input.quantity);

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 100000
  ) {
    throw new Error(
      "Quantity must be a whole number between 1 and 100,000."
    );
  }

  const fulfillmentOptions = {
    type: fulfillmentType,
    vehicleType,
    flatFee:
      fulfillmentType === "local_delivery"
        ? flatFee
        : 0,
    estimatedDays:
      fulfillmentType === "local_delivery" &&
      Number.isFinite(estimatedDays)
        ? Math.max(
            1,
            Math.min(60, Math.round(estimatedDays))
          )
        : 0,
    addressFrom,
    parcel,
  };

  const payload = {
    title,
    location,
    category,
    description,
    price: input.price,
    currency: input.currency,
    condition: input.condition,
    quantity,
    imageKeys,
    paymentOptions: {
      methods: [...new Set(methods)],
      cashTag,
      mobileNetwork,
      mobileNumber,
      recipientName,
    },
    fulfillmentOptions,
    seller: {
      id: userId,
      kristoId,
      name: displayName,
      verified: true,
      church: "Kristo seller account",
    },
  };
  const id = "soko-" + randomUUID();
  const inserted = await sql`
    INSERT INTO soko_products(
      id,
      seller_user_id,
      client_key,
      payload,
      status,
      stock_total,
      stock_available
    )
    VALUES(
      ${id},
      ${userId},
      ${clientKey},
      ${JSON.stringify(payload)}::jsonb,
      'Active',
      ${quantity},
      ${quantity}
    )
    ON CONFLICT(seller_user_id,client_key)
    DO NOTHING
    RETURNING *
  ` as Row[];
  const rows = inserted.length ? inserted : await sql`SELECT * FROM soko_products WHERE seller_user_id=${userId} AND client_key=${clientKey}` as Row[];
  if (!rows[0] || rows[0].status !== "Active") throw new Error("Listing status changed. Refresh My Listings.");
  await assertSokoPublisher(userId, kristoId, rows[0].id);
  return publicProduct(rows[0]);
}
export async function listSokoProducts(before = "", sellerId = "") {
  await schema(); const sql = sqlClient();
  // Apply all visibility rules BEFORE the page limit; never rely on client filtering.
  const rows = await sql`SELECT p.* FROM soko_products p
    JOIN soko_seller_accounts a ON a.user_id=p.seller_user_id AND a.status='active'
    JOIN soko_seller_applications app ON app.id=a.application_id AND app.user_id=a.user_id AND app.status='approved'
    WHERE p.status='Active'
      AND p.stock_available > 0
      AND (${sellerId}='' OR p.seller_user_id=${sellerId})
      AND (${before}='' OR (p.created_at,p.id) < (SELECT created_at,id FROM soko_products WHERE id=${before}))
      AND NOT EXISTS (SELECT 1 FROM soko_safety_actions s WHERE s.status='applied' AND (s.expires_at IS NULL OR s.expires_at>NOW())
        AND ((s.product_id=p.id AND s.action_type='remove_product') OR (s.seller_user_id=p.seller_user_id AND s.action_type IN ('pause_seller','suspend_seller','ban_seller'))))
    ORDER BY p.created_at DESC,p.id DESC LIMIT 21` as Row[];
  const page = rows.slice(0,20);
  return {
    products: isolateSokoCatalogProducts(page, publicProduct, publicProductWithoutImages),
    nextCursor: rows.length > 20 ? page[page.length-1].id : null,
  };
}
export async function updateSokoProductInventory(
  userId: string,
  kristoId: string,
  id: string,
  requestedTotal: number
) {
  await schema();

  const productId = text(id, 3, 100);
  const total = Number(requestedTotal);

  if (
    !Number.isInteger(total) ||
    total < 0 ||
    total > 100000
  ) {
    throw new Error(
      "Inventory must be a whole number between 0 and 100,000."
    );
  }

  await assertSokoPublisher(
    userId,
    kristoId,
    productId
  );

  const sql = sqlClient();

  const rows = await sql`
    WITH current_stock AS (
      SELECT
        id,
        stock_total,
        stock_available,
        GREATEST(
          0,
          stock_total-stock_available
        ) AS committed_units
      FROM soko_products
      WHERE id=${productId}
        AND seller_user_id=${userId}
        AND status<>'Deleted'
      LIMIT 1
    )
    UPDATE soko_products AS product
    SET
      stock_total=${total},
      stock_available=GREATEST(
        0,
        ${total}-current_stock.committed_units
      ),
      payload=jsonb_set(
        product.payload,
        '{quantity}',
        to_jsonb(${total}::integer),
        true
      ),
      status=CASE
        WHEN
          ${total}-current_stock.committed_units <= 0
          AND product.status='Active'
          THEN 'Sold'
        WHEN
          ${total}-current_stock.committed_units > 0
          AND product.status='Sold'
          THEN 'Active'
        ELSE product.status
      END,
      updated_at=NOW()
    FROM current_stock
    WHERE product.id=current_stock.id
      AND ${total}>=current_stock.committed_units
    RETURNING product.*
  ` as Row[];

  if (!rows[0]) {
    const existing = await sql`
      SELECT
        stock_total,
        stock_available
      FROM soko_products
      WHERE id=${productId}
        AND seller_user_id=${userId}
        AND status<>'Deleted'
      LIMIT 1
    ` as Array<{
      stock_total: number;
      stock_available: number;
    }>;

    if (!existing[0]) {
      throw new Error("Listing not found.");
    }

    const committed = Math.max(
      0,
      Number(existing[0].stock_total || 0) -
        Number(existing[0].stock_available || 0)
    );

    throw new Error(
      "Inventory cannot be lower than " +
        committed +
        " reserved or sold unit" +
        (committed === 1 ? "." : "s.")
    );
  }

  return publicProduct(rows[0]);
}

export async function changeSokoProduct(userId: string, kristoId: string, id: string, status: string) {
  if (!["Active", "Draft", "Sold", "Deleted"].includes(status)) throw new Error("Invalid listing status.");
  await schema();
  if (status === "Active") await assertSokoPublisher(userId, kristoId, id);
  const sql = sqlClient();
  const rows = await sql`UPDATE soko_products SET status=${status},updated_at=NOW()
    WHERE id=${id} AND seller_user_id=${userId} AND (status<>'Deleted' OR ${status}='Deleted') RETURNING id` as {id:string}[];
  if (!rows.length) throw new Error("Listing not found or already deleted.");
}

export async function listShareableSokoProductsForOwner(userId: string) {
  await schema();
  const sellerUserId = String(userId || "").trim();
  if (!sellerUserId) return [];
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_products
    WHERE seller_user_id = ${sellerUserId}
      AND status IN ('Active', 'Sold')
    ORDER BY created_at DESC, id DESC
    LIMIT 80
  `) as Row[];
  return rows.map((row) => {
    const product = publicProduct(row);
    return {
      id: String(product.id || ""),
      title: String((product as { title?: unknown }).title || ""),
      image: String(product.image || ""),
      price: (product as { price?: unknown }).price,
      currency: String((product as { currency?: unknown }).currency || ""),
      quantity: String(
        (product as { quantity?: unknown }).quantity ??
          product.stockAvailable ??
          ""
      ),
      status: String(product.status || ""),
      soldOut: Boolean(product.soldOut),
      stockAvailable: product.stockAvailable,
    };
  });
}

export type SokoTrustedProduct = {
  id: string;
  title: string;
  price: number;
  currency: string;
  image: string;
  sellerUserId: string;
  status: string;
  photos: string[];
  serverId: string;
  stockTotal: number;
  stockAvailable: number;
  soldOut: boolean;
  createdAt: string | Date;
  paymentOptions: Record<string, unknown>;
};

export async function getSokoProductById(id: string): Promise<SokoTrustedProduct | null> {
  await schema();
  const productId = String(id || "").trim();
  if (!productId || productId.length > 100) return null;
  const sql = sqlClient();
  const rows = await sql`SELECT * FROM soko_products WHERE id=${productId} LIMIT 1` as Row[];
  const row = rows[0];
  if (!row) return null;
  const product = publicProduct(row);
  const payload = row.payload || {};
  return {
    id: row.id,
    title: String(payload.title || ""),
    price: Number(payload.price ?? 0),
    currency: String(payload.currency || ""),
    image: product.image,
    sellerUserId: String(row.seller_user_id || "").trim(),
    status: row.status,
    photos: product.photos,
    serverId: product.serverId,
    stockTotal: product.stockTotal,
    stockAvailable: product.stockAvailable,
    soldOut: product.soldOut,
    createdAt: product.createdAt,
    paymentOptions: product.paymentOptions,
  };
}
