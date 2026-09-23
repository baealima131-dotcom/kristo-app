import { randomUUID } from "crypto";

import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
} from "@/app/api/_lib/store/authDb";

import {
  verifySokoImage,
} from "@/app/api/_lib/sokoProductImages";

neonConfig.fetchConnectionCache = true;

export type SokoProductStage =
  | "supply"
  | "setup"
  | "costing"
  | "payments"
  | "review";

export type SokoSupplyStatus =
  | "working"
  | "sent"
  | "returned";

export type SokoProductOperation = {
  id: string;

  sellerUserId: string;

  createdByUserId: string;
  updatedByUserId: string;

  supplierName: string;
  supplierContact: string;
  productName: string;
  supplierCode: string;

  quantity: number;
  unitCost: number;
  notes: string;

  currentStage: SokoProductStage;
  supplyStatus: SokoSupplyStatus;

  createdAt: string;
  updatedAt: string;
};

let sqlClient:
  | ReturnType<typeof neon>
  | null = null;

let schemaReady:
  | Promise<void>
  | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();

    if (!url) {
      throw new Error(
        "DATABASE_URL not configured"
      );
    }

    sqlClient = neon(url);
  }

  return sqlClient;
}

function clean(
  value: unknown,
  max = 500
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function numberValue(
  value: unknown
) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function dateText(
  value: unknown
) {
  if (!value) return "";

  try {
    return new Date(
      value as any
    ).toISOString();
  } catch {
    return String(value || "");
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS
          soko_product_operations (
            id TEXT PRIMARY KEY,

            seller_user_id TEXT NOT NULL,

            created_by_user_id TEXT NOT NULL,
            updated_by_user_id TEXT NOT NULL,

            supplier_name TEXT NOT NULL DEFAULT '',
            supplier_contact TEXT NOT NULL DEFAULT '',
            product_name TEXT NOT NULL DEFAULT '',
            supplier_code TEXT NOT NULL DEFAULT '',

            quantity NUMERIC NOT NULL DEFAULT 0,
            unit_cost NUMERIC NOT NULL DEFAULT 0,
            notes TEXT NOT NULL DEFAULT '',

            current_stage TEXT NOT NULL
              DEFAULT 'supply',

            supply_status TEXT NOT NULL
              DEFAULT 'working',

            deleted_at TIMESTAMPTZ,

            created_at TIMESTAMPTZ
              NOT NULL DEFAULT NOW(),

            updated_at TIMESTAMPTZ
              NOT NULL DEFAULT NOW()
          )
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          setup_status TEXT
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          listing_title TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          listing_model TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          listing_sku TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          listing_colors TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          listing_sizes TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          listing_description TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          setup_notes TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          setup_added_image_keys JSONB
            NOT NULL DEFAULT '[]'::jsonb
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          setup_photo_keys JSONB
            NOT NULL DEFAULT '[]'::jsonb
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          setup_main_image_key TEXT
            NOT NULL DEFAULT ''
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_product_operations_seller_idx
        ON soko_product_operations (
          seller_user_id,
          current_stage,
          updated_at DESC
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS
          soko_product_operation_events (
            id TEXT PRIMARY KEY,

            operation_id TEXT NOT NULL,
            seller_user_id TEXT NOT NULL,
            actor_user_id TEXT NOT NULL,

            action TEXT NOT NULL,
            from_stage TEXT,
            to_stage TEXT,

            created_at TIMESTAMPTZ
              NOT NULL DEFAULT NOW()
          )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_product_operation_events_op_idx
        ON soko_product_operation_events (
          operation_id,
          created_at DESC
        )
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  await schemaReady;
}

function fromRow(
  row: Record<string, any>
): SokoProductOperation {
  return {
    id:
      String(row.id || ""),

    sellerUserId:
      String(
        row.seller_user_id || ""
      ),

    createdByUserId:
      String(
        row.created_by_user_id || ""
      ),

    updatedByUserId:
      String(
        row.updated_by_user_id || ""
      ),

    supplierName:
      String(
        row.supplier_name || ""
      ),

    supplierContact:
      String(
        row.supplier_contact || ""
      ),

    productName:
      String(
        row.product_name || ""
      ),

    supplierCode:
      String(
        row.supplier_code || ""
      ),

    quantity:
      numberValue(row.quantity),

    unitCost:
      numberValue(row.unit_cost),

    notes:
      String(row.notes || ""),

    currentStage:
      row.current_stage as
        SokoProductStage,

    supplyStatus:
      row.supply_status as
        SokoSupplyStatus,

    createdAt:
      dateText(row.created_at),

    updatedAt:
      dateText(row.updated_at),
  };
}

async function addEvent(input: {
  operationId: string;
  sellerUserId: string;
  actorUserId: string;
  action: string;
  fromStage?: string;
  toStage?: string;
}) {
  const sql = getSql();

  await sql`
    INSERT INTO
      soko_product_operation_events (
        id,
        operation_id,
        seller_user_id,
        actor_user_id,
        action,
        from_stage,
        to_stage
      )
    VALUES (
      ${`sokoe_${randomUUID()}`},
      ${input.operationId},
      ${input.sellerUserId},
      ${input.actorUserId},
      ${input.action},
      ${input.fromStage || null},
      ${input.toStage || null}
    )
  `;
}

export async function
dbListSokoSupplyOperations(
  sellerUserId: string
): Promise<SokoProductOperation[]> {
  await ensureSchema();

  const sql = getSql();

  const sellerId =
    clean(sellerUserId, 180);

  if (!sellerId) return [];

  const rows = (await sql`
    SELECT *
    FROM soko_product_operations
    WHERE seller_user_id = ${sellerId}
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
  `) as Array<Record<string, any>>;

  return rows.map(fromRow);
}

export async function
dbSaveSokoSupplyOperation(
  input: {
    sellerUserId: string;
    actorUserId: string;

    operationId?: string;

    supplierName: string;
    supplierContact?: string;

    productName: string;
    supplierCode?: string;

    quantity?: number;
    unitCost?: number;

    notes?: string;

    mode:
      | "working"
      | "recommendation"
      | "verify_purchase"
      | "sent";
  }
) {
  await ensureSchema();

  const sql =
    getSql();

  /*
   * The smart-sourcing table may be upgraded
   * from either the task route or this route.
   */
  await sql`
    ALTER TABLE
      soko_product_operations
    ADD COLUMN IF NOT EXISTS
      worker_purchase_verified_at
      TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE
      soko_product_operations
    ADD COLUMN IF NOT EXISTS
      worker_purchase_verified_by_user_id
      TEXT
      NOT NULL DEFAULT ''
  `;

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const actorUserId =
    clean(
      input.actorUserId,
      180
    );

  const requestedSupplierName =
    clean(
      input.supplierName,
      240
    );

  const supplierContact =
    clean(
      input.supplierContact,
      500
    );

  const productName =
    clean(
      input.productName,
      240
    );

  const supplierCode =
    clean(
      input.supplierCode,
      240
    );

  const hasQuantity =
    input.quantity !== undefined &&
    input.quantity !== null &&
    Number.isFinite(
      Number(
        input.quantity
      )
    );

  const requestedQuantity =
    hasQuantity
      ? numberValue(
          input.quantity
        )
      : 0;

  const hasUnitCost =
    input.unitCost !== undefined &&
    input.unitCost !== null &&
    Number.isFinite(
      Number(
        input.unitCost
      )
    );

  const requestedUnitCost =
    hasUnitCost
      ? Math.max(
          0,
          numberValue(
            input.unitCost
          )
        )
      : 0;

  const notes =
    clean(
      input.notes,
      3000
    );

  const operationId =
    clean(
      input.operationId,
      240
    );

  if (
    !sellerUserId ||
    !actorUserId
  ) {
    throw new Error(
      "Seller and actor are required"
    );
  }

  /*
   * Legacy drafts may still be created,
   * but they cannot bypass the owner-controlled
   * purchase workflow and jump to Level 02.
   */
  if (!operationId) {
    if (
      input.mode !==
      "working"
    ) {
      throw new Error(
        "An assigned Level 01 task is required for this action."
      );
    }

    if (
      !requestedSupplierName ||
      !productName
    ) {
      throw new Error(
        "Supplier and product are required"
      );
    }

    const id =
      `sokoop_${randomUUID()}`;

    const rows = (await sql`
      INSERT INTO
        soko_product_operations (
          id,

          seller_user_id,

          created_by_user_id,
          updated_by_user_id,

          supplier_name,
          supplier_contact,

          product_name,
          supplier_code,

          quantity,
          unit_cost,

          notes,

          current_stage,
          supply_status
        )

      VALUES (
        ${id},

        ${sellerUserId},

        ${actorUserId},
        ${actorUserId},

        ${requestedSupplierName},
        ${supplierContact},

        ${productName},
        ${supplierCode},

        ${requestedQuantity},
        ${requestedUnitCost},

        ${notes},

        'supply',
        'working'
      )

      RETURNING *
    `) as Array<
      Record<string, any>
    >;

    await addEvent({
      operationId:
        id,

      sellerUserId,

      actorUserId,

      action:
        "SUPPLY_DRAFT_CREATED",

      fromStage:
        "supply",

      toStage:
        "supply",
    });

    return fromRow(
      rows[0]
    );
  }

  const existingRows = (await sql`
    SELECT *

    FROM
      soko_product_operations

    WHERE
      id =
        ${operationId}

      AND seller_user_id =
        ${sellerUserId}

      AND deleted_at
        IS NULL

    LIMIT 1
  `) as Array<
    Record<string, any>
  >;

  const existing =
    existingRows[0];

  if (!existing) {
    throw new Error(
      "SOKO product operation not found"
    );
  }

  if (
    String(
      existing.current_stage ||
        ""
    ) !== "supply" &&
    String(
      existing.supply_status ||
        ""
    ) !== "returned"
  ) {
    throw new Error(
      "This product has already moved beyond Level 01"
    );
  }

  const purchaseMode =
    existing.purchase_mode ===
    "already_purchased"
      ? "already_purchased"
      : "to_be_purchased";

  const purchaseStatus =
    String(
      existing.purchase_status ||
        "not_purchased"
    );

  const effectiveSupplierName =
    requestedSupplierName ||
    clean(
      existing.purchase_supplier_name,
      240
    ) ||
    clean(
      existing.supplier_name,
      240
    );

  const effectiveQuantity =
    hasQuantity &&
    requestedQuantity > 0
      ? requestedQuantity
      : (
          numberValue(
            existing.quantity
          ) > 0
            ? numberValue(
                existing.quantity
              )
            : numberValue(
                existing.target_quantity
              )
        );

  const effectiveUnitCost =
    hasUnitCost
      ? requestedUnitCost
      : (
          numberValue(
            existing.unit_cost
          ) > 0
            ? numberValue(
                existing.unit_cost
              )
            : numberValue(
                existing.actual_unit_cost
              )
        );

  if (
    input.mode ===
    "recommendation"
  ) {
    if (
      purchaseMode !==
      "to_be_purchased"
    ) {
      throw new Error(
        "This task was already purchased by the owner."
      );
    }

    if (
      purchaseStatus !==
        "not_purchased" &&
      purchaseStatus !==
        "recommendation_submitted"
    ) {
      throw new Error(
        "This recommendation can no longer be changed."
      );
    }

    if (!effectiveSupplierName) {
      throw new Error(
        "Choose a supplier before submitting the recommendation."
      );
    }

    if (
      effectiveQuantity <= 0
    ) {
      throw new Error(
        "Confirmed quantity is required."
      );
    }

    if (
      effectiveUnitCost < 0
    ) {
      throw new Error(
        "Supplier cost is required."
      );
    }

    const rows = (await sql`
      UPDATE
        soko_product_operations

      SET
        updated_by_user_id =
          ${actorUserId},

        supplier_name =
          ${effectiveSupplierName},

        supplier_contact =
          ${supplierContact},

        product_name =
          ${productName},

        supplier_code =
          ${supplierCode},

        quantity =
          ${effectiveQuantity},

        unit_cost =
          ${effectiveUnitCost},

        notes =
          ${notes},

        purchase_supplier_name =
          ${effectiveSupplierName},

        purchase_status =
          'recommendation_submitted',

        worker_purchase_verified_at =
          NULL,

        worker_purchase_verified_by_user_id =
          '',

        current_stage =
          'supply',

        supply_status =
          'working',

        updated_at =
          NOW()

      WHERE
        id =
          ${operationId}

      RETURNING *
    `) as Array<
      Record<string, any>
    >;

    await addEvent({
      operationId,

      sellerUserId,

      actorUserId,

      action:
        "PURCHASE_RECOMMENDATION_SUBMITTED",

      fromStage:
        "supply",

      toStage:
        "supply",
    });

    return fromRow(
      rows[0]
    );
  }

  if (
    input.mode ===
    "verify_purchase"
  ) {
    if (
      purchaseStatus !==
      "purchased"
    ) {
      throw new Error(
        "The owner must complete the purchase before Level 01 can verify it."
      );
    }

    if (!effectiveSupplierName) {
      throw new Error(
        "Purchase supplier is missing."
      );
    }

    const rows = (await sql`
      UPDATE
        soko_product_operations

      SET
        updated_by_user_id =
          ${actorUserId},

        supplier_name =
          ${effectiveSupplierName},

        supplier_contact =
          CASE
            WHEN ${supplierContact} <> ''
              THEN ${supplierContact}

            ELSE supplier_contact
          END,

        quantity =
          ${effectiveQuantity},

        unit_cost =
          ${effectiveUnitCost},

        notes =
          ${notes},

        worker_purchase_verified_at =
          NOW(),

        worker_purchase_verified_by_user_id =
          ${actorUserId},

        current_stage =
          'supply',

        supply_status =
          'working',

        updated_at =
          NOW()

      WHERE
        id =
          ${operationId}

      RETURNING *
    `) as Array<
      Record<string, any>
    >;

    await addEvent({
      operationId,

      sellerUserId,

      actorUserId,

      action:
        "PURCHASE_VERIFIED_BY_LEVEL01",

      fromStage:
        "supply",

      toStage:
        "supply",
    });

    return fromRow(
      rows[0]
    );
  }

  if (
    input.mode ===
    "sent"
  ) {
    if (
      purchaseStatus !==
      "purchased"
    ) {
      throw new Error(
        "The product cannot move to Level 02 until the purchase is complete."
      );
    }

    if (
      !existing
        .worker_purchase_verified_at
    ) {
      throw new Error(
        "Level 01 must verify the purchase before sending it to Level 02."
      );
    }

    if (!effectiveSupplierName) {
      throw new Error(
        "Purchase supplier is required."
      );
    }

    if (
      effectiveQuantity <= 0
    ) {
      throw new Error(
        "Confirmed quantity is required before Level 02."
      );
    }

    const rows = (await sql`
      UPDATE
        soko_product_operations

      SET
        updated_by_user_id =
          ${actorUserId},

        supplier_name =
          ${effectiveSupplierName},

        supplier_contact =
          CASE
            WHEN ${supplierContact} <> ''
              THEN ${supplierContact}

            ELSE supplier_contact
          END,

        product_name =
          ${productName},

        supplier_code =
          ${supplierCode},

        quantity =
          ${effectiveQuantity},

        unit_cost =
          ${effectiveUnitCost},

        notes =
          ${notes},

        current_stage =
          'setup',

        supply_status =
          'sent',

        updated_at =
          NOW()

      WHERE
        id =
          ${operationId}

      RETURNING *
    `) as Array<
      Record<string, any>
    >;

    await addEvent({
      operationId,

      sellerUserId,

      actorUserId,

      action:
        "SUPPLY_SENT_TO_SETUP",

      fromStage:
        "supply",

      toStage:
        "setup",
    });

    return fromRow(
      rows[0]
    );
  }

  /*
   * Normal draft save.
   */
  if (
    purchaseMode ===
      "to_be_purchased" &&
    !effectiveSupplierName
  ) {
    throw new Error(
      "Choose a supplier before saving sourcing work."
    );
  }

  const rows = (await sql`
    UPDATE
      soko_product_operations

    SET
      updated_by_user_id =
        ${actorUserId},

      supplier_name =
        ${effectiveSupplierName},

      supplier_contact =
        CASE
          WHEN ${supplierContact} <> ''
            THEN ${supplierContact}

          ELSE supplier_contact
        END,

      product_name =
        ${productName},

      supplier_code =
        ${supplierCode},

      quantity =
        ${effectiveQuantity},

      unit_cost =
        ${effectiveUnitCost},

      notes =
        ${notes},

      current_stage =
        'supply',

      supply_status =
        'working',

      updated_at =
        NOW()

    WHERE
      id =
        ${operationId}

    RETURNING *
  `) as Array<
    Record<string, any>
  >;

  await addEvent({
    operationId,

    sellerUserId,

    actorUserId,

    action:
      "SUPPLY_DRAFT_SAVED",

    fromStage:
      "supply",

    toStage:
      "supply",
  });

  return fromRow(
    rows[0]
  );
}

export async function
dbDeleteSokoSupplyDraft(input: {
  sellerUserId: string;
  actorUserId: string;
  operationId: string;
}) {
  await ensureSchema();

  const sql = getSql();

  const sellerUserId =
    clean(input.sellerUserId, 180);

  const actorUserId =
    clean(input.actorUserId, 180);

  const operationId =
    clean(input.operationId, 240);

  const rows = (await sql`
    UPDATE soko_product_operations
    SET
      deleted_at = NOW(),
      updated_by_user_id =
        ${actorUserId},
      updated_at = NOW()

    WHERE id = ${operationId}
      AND seller_user_id =
        ${sellerUserId}
      AND deleted_at IS NULL
      AND (
        supply_status = 'working'
        OR supply_status =
          'returned'
      )

    RETURNING *
  `) as Array<
    Record<string, any>
  >;

  if (!rows[0]) {
    throw new Error(
      "Only working or returned Level 01 items can be deleted"
    );
  }

  await addEvent({
    operationId,
    sellerUserId,
    actorUserId,
    action:
      "SUPPLY_DRAFT_DELETED",
    fromStage:
      String(
        rows[0].current_stage ||
          "supply"
      ),
  });

  return fromRow(rows[0]);
}


export type SokoSetupStatus =
  | ""
  | "working"
  | "sent"
  | "returned";

export type SokoSetupOperation =
  SokoProductOperation & {
    setupStatus:
      SokoSetupStatus;

    listingTitle:
      string;

    model:
      string;

    sku:
      string;

    colors:
      string;

    sizes:
      string;

    description:
      string;

    setupNotes:
      string;

    addedImageKeys:
      string[];

    photoKeys:
      string[];

    mainImageKey:
      string;
  };

function setupStringArray(
  value: unknown,
  limit = 20
) {
  let source:
    unknown[] = [];

  if (
    Array.isArray(value)
  ) {
    source =
      value;
  } else if (
    typeof value ===
      "string" &&
    value.trim()
  ) {
    try {
      const parsed =
        JSON.parse(value);

      if (
        Array.isArray(
          parsed
        )
      ) {
        source =
          parsed;
      }
    } catch {
      source = [];
    }
  }

  return [
    ...new Set(
      source
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

function setupFromRow(
  row: Record<
    string,
    any
  >
): SokoSetupOperation {
  return {
    ...fromRow(row),

    setupStatus:
      String(
        row.setup_status ||
          ""
      ) as SokoSetupStatus,

    listingTitle:
      String(
        row.listing_title ||
          ""
      ),

    model:
      String(
        row.listing_model ||
          ""
      ),

    sku:
      String(
        row.listing_sku ||
          ""
      ),

    colors:
      String(
        row.listing_colors ||
          ""
      ),

    sizes:
      String(
        row.listing_sizes ||
          ""
      ),

    description:
      String(
        row.listing_description ||
          ""
      ),

    setupNotes:
      String(
        row.setup_notes ||
          ""
      ),

    addedImageKeys:
      setupStringArray(
        row.setup_added_image_keys,
        20
      ),

    photoKeys:
      setupStringArray(
        row.setup_photo_keys,
        8
      ),

    mainImageKey:
      String(
        row.setup_main_image_key ||
          ""
      ),
  };
}

export async function
dbListSokoSetupOperations(
  sellerUserId: string
): Promise<
  SokoSetupOperation[]
> {
  await ensureSchema();

  const sql =
    getSql();

  const sellerId =
    clean(
      sellerUserId,
      180
    );

  if (!sellerId) {
    return [];
  }

  const rows =
    await sql`
      SELECT *
      FROM
        soko_product_operations
      WHERE
        seller_user_id =
          ${sellerId}
        AND deleted_at
          IS NULL
        AND (
          current_stage =
            'setup'
          OR setup_status
            IN (
              'sent',
              'returned'
            )
        )
      ORDER BY
        updated_at DESC
    ` as Array<
      Record<
        string,
        any
      >
    >;

  return rows.map(
    setupFromRow
  );
}

export async function
dbSaveSokoSetupOperation(
  input: {
    sellerUserId: string;

    actorUserId: string;

    operationId: string;

    listingTitle?: string;

    model?: string;

    sku?: string;

    colors?: string;

    sizes?: string;

    description?: string;

    setupNotes?: string;

    addedImageKeys?: string[];

    photoKeys?: string[];

    mainImageKey?: string;

    mode:
      | "working"
      | "sent";
  }
): Promise<
  SokoSetupOperation
> {
  await ensureSchema();

  const sql =
    getSql();

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const actorUserId =
    clean(
      input.actorUserId,
      180
    );

  const operationId =
    clean(
      input.operationId,
      240
    );

  const listingTitle =
    clean(
      input.listingTitle,
      240
    );

  const model =
    clean(
      input.model,
      240
    );

  const sku =
    clean(
      input.sku,
      240
    );

  const colors =
    clean(
      input.colors,
      1000
    );

  const sizes =
    clean(
      input.sizes,
      1000
    );

  const description =
    clean(
      input.description,
      5000
    );

  const setupNotes =
    clean(
      input.setupNotes,
      3000
    );

  const addedImageKeys =
    setupStringArray(
      input.addedImageKeys,
      20
    );

  const photoKeys =
    setupStringArray(
      input.photoKeys,
      8
    );

  const requestedMain =
    clean(
      input.mainImageKey,
      500
    );

  const mainImageKey =
    photoKeys.includes(
      requestedMain
    )
      ? requestedMain
      : (
          photoKeys[0] ||
          ""
        );

  if (
    !sellerUserId ||
    !actorUserId ||
    !operationId
  ) {
    throw new Error(
      "Seller, actor and Level 02 product are required"
    );
  }

  if (
    input.mode === "sent" &&
    listingTitle.length < 3
  ) {
    throw new Error(
      "Product title is required before sending to Level 03"
    );
  }

  if (
    input.mode === "sent" &&
    description.length < 10
  ) {
    throw new Error(
      "Product description is required before sending to Level 03"
    );
  }

  if (
    input.mode === "sent" &&
    (
      photoKeys.length < 1 ||
      photoKeys.length > 8
    )
  ) {
    throw new Error(
      "Choose 1–8 final product photos before sending to Level 03"
    );
  }

  for (
    const key of [
      ...new Set([
        ...addedImageKeys,
        ...photoKeys,
      ]),
    ]
  ) {
    await verifySokoImage(
      key,
      sellerUserId
    );
  }

  const existingRows =
    await sql`
      SELECT *
      FROM
        soko_product_operations
      WHERE
        id =
          ${operationId}
        AND seller_user_id =
          ${sellerUserId}
        AND deleted_at
          IS NULL
      LIMIT 1
    ` as Array<
      Record<
        string,
        any
      >
    >;

  const existing =
    existingRows[0];

  if (!existing) {
    throw new Error(
      "Level 02 product not found"
    );
  }

  if (
    String(
      existing.current_stage ||
        ""
    ) !== "setup"
  ) {
    throw new Error(
      "This product is not currently in Level 02"
    );
  }

  if (
    String(
      existing.setup_status ||
        ""
    ) === "sent"
  ) {
    throw new Error(
      "This product has already been sent to Level 03"
    );
  }

  const nextStage =
    input.mode === "sent"
      ? "costing"
      : "setup";

  const rows =
    await sql`
      UPDATE
        soko_product_operations
      SET
        updated_by_user_id =
          ${actorUserId},

        listing_title =
          ${listingTitle},

        listing_model =
          ${model},

        listing_sku =
          ${sku},

        listing_colors =
          ${colors},

        listing_sizes =
          ${sizes},

        listing_description =
          ${description},

        setup_notes =
          ${setupNotes},

        setup_added_image_keys =
          ${JSON.stringify(
            addedImageKeys
          )}::jsonb,

        setup_photo_keys =
          ${JSON.stringify(
            photoKeys
          )}::jsonb,

        setup_main_image_key =
          ${mainImageKey},

        setup_status =
          ${input.mode},

        current_stage =
          ${nextStage},

        updated_at =
          NOW()

      WHERE
        id =
          ${operationId}
        AND seller_user_id =
          ${sellerUserId}
        AND deleted_at
          IS NULL
        AND current_stage =
          'setup'

      RETURNING *
    ` as Array<
      Record<
        string,
        any
      >
    >;

  if (!rows[0]) {
    throw new Error(
      "Could not save Level 02 product"
    );
  }

  await addEvent({
    operationId,

    sellerUserId,

    actorUserId,

    action:
      input.mode === "sent"
        ? "SETUP_SENT_TO_COSTING"
        : "SETUP_DRAFT_SAVED",

    fromStage:
      "setup",

    toStage:
      nextStage,
  });

  return setupFromRow(
    rows[0]
  );
}
