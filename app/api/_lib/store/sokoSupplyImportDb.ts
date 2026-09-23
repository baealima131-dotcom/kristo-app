import {
  randomUUID,
} from "node:crypto";

import {
  neon,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
} from "./authDb";

import {
  sokoImageUrl,
} from "../sokoProductImages";

type ImportRow = {
  id: string;

  seller_user_id: string;

  task_id: string;

  actor_user_id: string;

  provider: string;

  provider_product_id: string;

  product_url: string;

  title: string;

  description: string;

  supplier_name: string;

  currency: string;

  price_min: number;

  price_max: number;

  moq: number;

  sku: string;

  image_keys: unknown;

  main_image_key: string;

  source_image_urls: unknown;

  specifications: unknown;

  variants: unknown;

  created_at: string | Date;

  updated_at: string | Date;
};

let ready:
  Promise<void> |
  null = null;

function sqlClient() {
  const url =
    getDatabaseUrl();

  if (!url) {
    throw new Error(
      "Database unavailable."
    );
  }

  return neon(url);
}

async function schema() {
  if (!ready) {
    ready = (async () => {
      const sql =
        sqlClient();

      await sql`
        CREATE TABLE IF NOT EXISTS soko_supply_imports (
          id TEXT PRIMARY KEY,
          seller_user_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_product_id TEXT NOT NULL DEFAULT '',
          product_url TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          supplier_name TEXT NOT NULL DEFAULT '',
          currency TEXT NOT NULL DEFAULT 'USD',
          price_min DOUBLE PRECISION NOT NULL DEFAULT 0,
          price_max DOUBLE PRECISION NOT NULL DEFAULT 0,
          moq INTEGER NOT NULL DEFAULT 0,
          sku TEXT NOT NULL DEFAULT '',
          image_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
          main_image_key TEXT NOT NULL DEFAULT '',
          source_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          specifications JSONB NOT NULL DEFAULT '[]'::jsonb,
          variants JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(seller_user_id, task_id)
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_supply_imports_seller_idx
        ON soko_supply_imports(
          seller_user_id,
          updated_at DESC
        )
      `;
    })().catch(
      (error) => {
        ready = null;
        throw error;
      }
    );
  }

  return ready;
}

function clean(
  value: unknown,
  maxLength: number
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}

function numberValue(
  value: unknown
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  ) &&
    number >= 0
    ? number
    : 0;
}

function stringArray(
  value: unknown,
  limit = 30
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            String(
              item || ""
            ).trim()
        )
        .filter(Boolean)
    ),
  ].slice(
    0,
    limit
  );
}

function recordArray(
  value: unknown,
  limit = 30
) {
  return Array.isArray(
    value
  )
    ? value.slice(
        0,
        limit
      )
    : [];
}

function publicImport(
  row: ImportRow
) {
  const imageKeys =
    stringArray(
      row.image_keys,
      30
    );

  const images =
    imageKeys.map(
      (key) =>
        sokoImageUrl(
          key
        )
    );

  const mainImageKey =
    clean(
      row.main_image_key,
      500
    ) ||
    imageKeys[0] ||
    "";

  return {
    id:
      row.id,

    sellerUserId:
      row.seller_user_id,

    taskId:
      row.task_id,

    actorUserId:
      row.actor_user_id,

    provider:
      row.provider,

    productId:
      row.provider_product_id,

    productUrl:
      row.product_url,

    title:
      row.title,

    description:
      row.description,

    supplierName:
      row.supplier_name,

    currency:
      row.currency,

    priceMin:
      Number(
        row.price_min || 0
      ),

    priceMax:
      Number(
        row.price_max || 0
      ),

    moq:
      Number(
        row.moq || 0
      ),

    sku:
      row.sku,

    imageKeys,

    mainImageKey,

    images,

    mainImage:
      mainImageKey
        ? sokoImageUrl(
            mainImageKey
          )
        : images[0] ||
          "",

    sourceImages:
      stringArray(
        row.source_image_urls,
        30
      ),

    specifications:
      recordArray(
        row.specifications,
        30
      ),

    variants:
      recordArray(
        row.variants,
        30
      ),

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}

export async function
dbGetSokoSupplyImport(
  sellerUserId: string,
  taskId: string
) {
  await schema();

  const sql =
    sqlClient();

  const rows =
    await sql`
      SELECT *
      FROM soko_supply_imports
      WHERE seller_user_id=${sellerUserId}
        AND task_id=${taskId}
      LIMIT 1
    ` as ImportRow[];

  return rows[0]
    ? publicImport(
        rows[0]
      )
    : null;
}

export async function
dbUpsertSokoSupplyImport(
  input: {
    sellerUserId: string;

    taskId: string;

    actorUserId: string;

    provider?: string;

    providerProductId?: string;

    productUrl: string;

    title?: string;

    description?: string;

    supplierName?: string;

    currency?: string;

    priceMin?: number;

    priceMax?: number;

    moq?: number;

    sku?: string;

    imageKeys: string[];

    mainImageKey?: string;

    sourceImageUrls?: string[];

    specifications?: unknown[];

    variants?: unknown[];
  }
) {
  await schema();

  const sellerUserId =
    clean(
      input.sellerUserId,
      200
    );

  const taskId =
    clean(
      input.taskId,
      200
    );

  const actorUserId =
    clean(
      input.actorUserId,
      200
    );

  const productUrl =
    clean(
      input.productUrl,
      3000
    );

  if (
    !sellerUserId ||
    !taskId ||
    !actorUserId ||
    !productUrl
  ) {
    throw new Error(
      "Missing imported product information."
    );
  }

  const imageKeys =
    stringArray(
      input.imageKeys,
      30
    );

  if (
    imageKeys.length < 1
  ) {
    throw new Error(
      "At least one imported product image is required."
    );
  }

  const mainImageKey =
    imageKeys.includes(
      clean(
        input.mainImageKey,
        500
      )
    )
      ? clean(
          input.mainImageKey,
          500
        )
      : imageKeys[0];

  const sql =
    sqlClient();

  const id =
    "soko-import-" +
    randomUUID();

  const rows =
    await sql`
      INSERT INTO soko_supply_imports(
        id,
        seller_user_id,
        task_id,
        actor_user_id,
        provider,
        provider_product_id,
        product_url,
        title,
        description,
        supplier_name,
        currency,
        price_min,
        price_max,
        moq,
        sku,
        image_keys,
        main_image_key,
        source_image_urls,
        specifications,
        variants
      )
      VALUES(
        ${id},
        ${sellerUserId},
        ${taskId},
        ${actorUserId},
        ${clean(input.provider || "alibaba", 40)},
        ${clean(input.providerProductId, 500)},
        ${productUrl},
        ${clean(input.title, 200)},
        ${clean(input.description, 5000)},
        ${clean(input.supplierName, 300)},
        ${clean(input.currency || "USD", 10)},
        ${numberValue(input.priceMin)},
        ${numberValue(input.priceMax)},
        ${Math.max(
          0,
          Math.round(
            numberValue(
              input.moq
            )
          )
        )},
        ${clean(input.sku, 300)},
        ${JSON.stringify(imageKeys)}::jsonb,
        ${mainImageKey},
        ${JSON.stringify(
          stringArray(
            input.sourceImageUrls,
            30
          )
        )}::jsonb,
        ${JSON.stringify(
          recordArray(
            input.specifications,
            30
          )
        )}::jsonb,
        ${JSON.stringify(
          recordArray(
            input.variants,
            30
          )
        )}::jsonb
      )
      ON CONFLICT(
        seller_user_id,
        task_id
      )
      DO UPDATE SET
        actor_user_id=
          EXCLUDED.actor_user_id,
        provider=
          EXCLUDED.provider,
        provider_product_id=
          EXCLUDED.provider_product_id,
        product_url=
          EXCLUDED.product_url,
        title=
          EXCLUDED.title,
        description=
          EXCLUDED.description,
        supplier_name=
          EXCLUDED.supplier_name,
        currency=
          EXCLUDED.currency,
        price_min=
          EXCLUDED.price_min,
        price_max=
          EXCLUDED.price_max,
        moq=
          EXCLUDED.moq,
        sku=
          EXCLUDED.sku,
        image_keys=
          EXCLUDED.image_keys,
        main_image_key=
          EXCLUDED.main_image_key,
        source_image_urls=
          EXCLUDED.source_image_urls,
        specifications=
          EXCLUDED.specifications,
        variants=
          EXCLUDED.variants,
        updated_at=NOW()
      RETURNING *
    ` as ImportRow[];

  if (!rows[0]) {
    throw new Error(
      "Could not save imported product."
    );
  }

  return publicImport(
    rows[0]
  );
}
