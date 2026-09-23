import {
  randomUUID,
} from "crypto";

import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
} from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export const
SOKO_SOURCING_CATEGORIES = [
  "Clothing & Fashion",
  "Shoes",
  "Beauty & Personal Care",
  "Electronics",
  "Home & Kitchen",
  "Food & Grocery",
  "Baby & Kids",
  "Sports & Fitness",
  "Auto & Parts",
  "Jewelry & Accessories",
  "Office & Business",
  "Other",
] as const;

export type SokoSourcingPriority =
  | "low"
  | "normal"
  | "high"
  | "urgent";

export type SokoPurchaseMode =
  | "to_be_purchased"
  | "already_purchased";

export type SokoPurchaseStatus =
  | "not_purchased"
  | "recommendation_submitted"
  | "approved"
  | "purchased";


export type SokoSourcingTask = {
  id: string;

  sellerUserId: string;

  productName: string;
  category: string;

  targetQuantity: number;
  targetUnitCost: number;

  priority:
    SokoSourcingPriority;

  neededBy:
    string | null;

  taskNotes: string;

  purchaseMode:
    SokoPurchaseMode;

  purchaseStatus:
    SokoPurchaseStatus;

  purchaseSupplierName: string;

  actualUnitCost: number;

  totalPaid: number;

  purchaseDate:
    string | null;

  purchaseOrderReference: string;

  purchaseTrackingNumber: string;

  ownerPurchaseApprovedAt:
    string | null;

  workerPurchaseVerifiedAt:
    string | null;

  workerPurchaseVerifiedByUserId:
    string;

  selectedSupplierId:
    string | null;

  supplierName: string;
  supplierContact: string;
  supplierCode: string;

  quantity: number;
  unitCost: number;

  sourcingNotes: string;

  currentStage:
    | "supply"
    | "setup"
    | "costing"
    | "payments"
    | "review";

  supplyStatus:
    | "working"
    | "sent"
    | "returned";

  createdAt: string;
  updatedAt: string;
};

export type SokoSupplier = {
  id: string;

  sellerUserId: string;

  name: string;
  category: string;

  websiteUrl: string;

  searchUrlTemplate:
    string;

  availabilityUrlTemplate:
    string;

  country: string;
  contact: string;

  moq: number;

  leadTime: string;

  verified: boolean;
  active: boolean;

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
    const url =
      getDatabaseUrl();

    if (!url) {
      throw new Error(
        "DATABASE_URL not configured"
      );
    }

    sqlClient =
      neon(url);
  }

  return sqlClient;
}

function clean(
  value: unknown,
  max = 600
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function numberValue(
  value: unknown
) {
  const n =
    Number(value);

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
    return String(
      value || ""
    );
  }
}

function nullableDateText(
  value: unknown
) {
  if (!value) return null;

  try {
    return new Date(
      value as any
    ).toISOString();
  } catch {
    return null;
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql =
        getSql();

      /*
       * Extend the existing shared product
       * operations table. Existing rows stay valid.
       */

      await sql`
        ALTER TABLE
          soko_product_operations

        ADD COLUMN IF NOT EXISTS
          task_category TEXT
          NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations

        ADD COLUMN IF NOT EXISTS
          target_quantity NUMERIC
          NOT NULL DEFAULT 0
      `;

      await sql`
        ALTER TABLE
          soko_product_operations

        ADD COLUMN IF NOT EXISTS
          target_unit_cost NUMERIC
          NOT NULL DEFAULT 0
      `;

      await sql`
        ALTER TABLE
          soko_product_operations

        ADD COLUMN IF NOT EXISTS
          sourcing_priority TEXT
          NOT NULL DEFAULT 'normal'
      `;

      await sql`
        ALTER TABLE
          soko_product_operations

        ADD COLUMN IF NOT EXISTS
          needed_by DATE
      `;

      await sql`
        ALTER TABLE
          soko_product_operations

        ADD COLUMN IF NOT EXISTS
          task_notes TEXT
          NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations

        ADD COLUMN IF NOT EXISTS
          selected_supplier_id TEXT
      `;

      
      /*
       * SOKO Level 01 purchase workflow.
       *
       * to_be_purchased:
       * worker researches and recommends,
       * owner controls actual spending.
       *
       * already_purchased:
       * owner records an existing purchase
       * before Level 01 continues processing.
       */
      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          purchase_mode TEXT
          NOT NULL
          DEFAULT 'to_be_purchased'
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          purchase_status TEXT
          NOT NULL
          DEFAULT 'not_purchased'
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          purchase_supplier_name TEXT
          NOT NULL
          DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          actual_unit_cost NUMERIC
          NOT NULL
          DEFAULT 0
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          total_paid NUMERIC
          NOT NULL
          DEFAULT 0
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          purchase_date DATE
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          purchase_order_reference TEXT
          NOT NULL
          DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          purchase_tracking_number TEXT
          NOT NULL
          DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_product_operations
        ADD COLUMN IF NOT EXISTS
          owner_purchase_approved_at
          TIMESTAMPTZ
      `;


      /*
       * Level 01 purchase verification.
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

/*
       * Reusable supplier directory.
       */

      await sql`
        CREATE TABLE IF NOT EXISTS
          soko_supplier_directory (
            id TEXT PRIMARY KEY,

            seller_user_id
              TEXT NOT NULL,

            name
              TEXT NOT NULL,

            category
              TEXT NOT NULL DEFAULT '',

            website_url
              TEXT NOT NULL DEFAULT '',

            search_url_template
              TEXT NOT NULL DEFAULT '',

            availability_url_template
              TEXT NOT NULL DEFAULT '',

            country
              TEXT NOT NULL DEFAULT '',

            contact
              TEXT NOT NULL DEFAULT '',

            moq
              NUMERIC NOT NULL DEFAULT 0,

            lead_time
              TEXT NOT NULL DEFAULT '',

            verified
              BOOLEAN NOT NULL DEFAULT FALSE,

            active
              BOOLEAN NOT NULL DEFAULT TRUE,

            created_by_user_id
              TEXT NOT NULL,

            created_at
              TIMESTAMPTZ
              NOT NULL DEFAULT NOW(),

            updated_at
              TIMESTAMPTZ
              NOT NULL DEFAULT NOW()
          )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_supplier_directory_seller_category_idx

        ON soko_supplier_directory (
          seller_user_id,
          category,
          active,
          updated_at DESC
        )
      `;
    })().catch(
      (error) => {
        schemaReady = null;
        throw error;
      }
    );
  }

  await schemaReady;
}

function taskFromRow(
  row: Record<
    string,
    any
  >
): SokoSourcingTask {
  return {
    id:
      String(
        row.id || ""
      ),

    sellerUserId:
      String(
        row.seller_user_id ||
          ""
      ),

    productName:
      String(
        row.product_name ||
          ""
      ),

    category:
      String(
        row.task_category ||
          ""
      ),

    targetQuantity:
      numberValue(
        row.target_quantity ||
          row.quantity
      ),

    targetUnitCost:
      numberValue(
        row.target_unit_cost
      ),

    priority:
      String(
        row.sourcing_priority ||
          "normal"
      ) as
        SokoSourcingPriority,

    neededBy:
      nullableDateText(
        row.needed_by
      ),

    taskNotes:
      String(
        row.task_notes ||
          ""
      ),

    purchaseMode:
      row.purchase_mode ===
      "already_purchased"
        ? "already_purchased"
        : "to_be_purchased",

    purchaseStatus:
      (
        row.purchase_status ===
          "recommendation_submitted" ||
        row.purchase_status ===
          "approved" ||
        row.purchase_status ===
          "purchased"
      )
        ? row.purchase_status
        : "not_purchased",

    purchaseSupplierName:
      String(
        row.purchase_supplier_name ||
          ""
      ),

    actualUnitCost:
      numberValue(
        row.actual_unit_cost
      ),

    totalPaid:
      numberValue(
        row.total_paid
      ),

    purchaseDate:
      nullableDateText(
        row.purchase_date
      ),

    purchaseOrderReference:
      String(
        row.purchase_order_reference ||
          ""
      ),

    purchaseTrackingNumber:
      String(
        row.purchase_tracking_number ||
          ""
      ),

    ownerPurchaseApprovedAt:
      nullableDateText(
        row.owner_purchase_approved_at
      ),

    workerPurchaseVerifiedAt:
      nullableDateText(
        row.worker_purchase_verified_at
      ),

    workerPurchaseVerifiedByUserId:
      String(
        row.worker_purchase_verified_by_user_id ||
          ""
      ),

    selectedSupplierId:
      row.selected_supplier_id
        ? String(
            row.selected_supplier_id
          )
        : null,

    supplierName:
      String(
        row.supplier_name ||
          ""
      ),

    supplierContact:
      String(
        row.supplier_contact ||
          ""
      ),

    supplierCode:
      String(
        row.supplier_code ||
          ""
      ),

    quantity:
      numberValue(
        row.quantity
      ),

    unitCost:
      numberValue(
        row.unit_cost
      ),

    sourcingNotes:
      String(
        row.notes || ""
      ),

    currentStage:
      row.current_stage,

    supplyStatus:
      row.supply_status,

    createdAt:
      dateText(
        row.created_at
      ),

    updatedAt:
      dateText(
        row.updated_at
      ),
  };
}

function supplierFromRow(
  row: Record<
    string,
    any
  >
): SokoSupplier {
  return {
    id:
      String(
        row.id || ""
      ),

    sellerUserId:
      String(
        row.seller_user_id ||
          ""
      ),

    name:
      String(
        row.name || ""
      ),

    category:
      String(
        row.category || ""
      ),

    websiteUrl:
      String(
        row.website_url ||
          ""
      ),

    searchUrlTemplate:
      String(
        row.search_url_template ||
          ""
      ),

    availabilityUrlTemplate:
      String(
        row.availability_url_template ||
          ""
      ),

    country:
      String(
        row.country || ""
      ),

    contact:
      String(
        row.contact || ""
      ),

    moq:
      numberValue(
        row.moq
      ),

    leadTime:
      String(
        row.lead_time ||
          ""
      ),

    verified:
      Boolean(
        row.verified
      ),

    active:
      Boolean(
        row.active
      ),

    createdAt:
      dateText(
        row.created_at
      ),

    updatedAt:
      dateText(
        row.updated_at
      ),
  };
}

export async function
dbCreateSokoSourcingTask(
  input: {
    sellerUserId: string;
    actorUserId: string;

    productName: string;
    category: string;

    targetQuantity: number;

    targetUnitCost?: number;

    priority?:
      SokoSourcingPriority;

    neededBy?: string;

    taskNotes?: string;

    purchaseMode?:
      SokoPurchaseMode;

    purchaseSupplierName?: string;

    actualUnitCost?: number;

    totalPaid?: number;

    purchaseDate?: string;

    purchaseOrderReference?: string;

    purchaseTrackingNumber?: string;
  }
): Promise<SokoSourcingTask> {
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

  const productName =
    clean(
      input.productName,
      240
    );

  const category =
    clean(
      input.category,
      160
    );

  const targetQuantity =
    numberValue(
      input.targetQuantity
    );

  const targetUnitCost =
    numberValue(
      input.targetUnitCost
    );

  const priority =
    (
      input.priority === "low" ||
      input.priority === "high" ||
      input.priority === "urgent"
    )
      ? input.priority
      : "normal";

  const neededBy =
    clean(
      input.neededBy,
      40
    );

  const taskNotes =
    clean(
      input.taskNotes,
      3000
    );

  const purchaseMode:
    SokoPurchaseMode =
      input.purchaseMode ===
      "already_purchased"
        ? "already_purchased"
        : "to_be_purchased";

  const purchaseStatus:
    SokoPurchaseStatus =
      purchaseMode ===
      "already_purchased"
        ? "purchased"
        : "not_purchased";

  const purchaseSupplierName =
    clean(
      input.purchaseSupplierName,
      300
    );

  const actualUnitCost =
    Math.max(
      0,
      numberValue(
        input.actualUnitCost
      )
    );

  const requestedTotalPaid =
    Math.max(
      0,
      numberValue(
        input.totalPaid
      )
    );

  const totalPaid =
    requestedTotalPaid > 0
      ? requestedTotalPaid
      : (
          purchaseMode ===
            "already_purchased" &&
          actualUnitCost > 0
            ? actualUnitCost *
              targetQuantity
            : 0
        );

  const purchaseDate =
    clean(
      input.purchaseDate,
      40
    );

  const purchaseOrderReference =
    clean(
      input.purchaseOrderReference,
      300
    );

  const purchaseTrackingNumber =
    clean(
      input.purchaseTrackingNumber,
      300
    );

  if (
    !sellerUserId ||
    !actorUserId
  ) {
    throw new Error(
      "Seller and actor are required"
    );
  }

  if (!productName) {
    throw new Error(
      "Product task name is required"
    );
  }

  if (!category) {
    throw new Error(
      "Choose a sourcing category"
    );
  }

  if (
    targetQuantity <= 0
  ) {
    throw new Error(
      "Target quantity must be greater than zero"
    );
  }

  const id =
    `sokotask_${randomUUID()}`;

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
        supply_status,

        task_category,

        target_quantity,
        target_unit_cost,

        sourcing_priority,

        needed_by,

        task_notes,

        purchase_mode,
        purchase_status,

        purchase_supplier_name,

        actual_unit_cost,
        total_paid,

        purchase_date,

        purchase_order_reference,
        purchase_tracking_number,

        owner_purchase_approved_at
      )

    VALUES (
      ${id},

      ${sellerUserId},

      ${actorUserId},
      ${actorUserId},

      '',
      '',

      ${productName},
      '',

      ${targetQuantity},
      0,

      '',

      'supply',
      'working',

      ${category},

      ${targetQuantity},
      ${targetUnitCost},

      ${priority},

      ${
        neededBy
          ? neededBy
          : null
      },

      ${taskNotes},

      ${purchaseMode},
      ${purchaseStatus},

      ${purchaseSupplierName},

      ${actualUnitCost},
      ${totalPaid},

      ${
        purchaseDate
          ? purchaseDate
          : null
      },

      ${purchaseOrderReference},
      ${purchaseTrackingNumber},

      ${
        purchaseMode ===
        "already_purchased"
          ? new Date().toISOString()
          : null
      }
    )

    RETURNING *
  `) as Array<
    Record<
      string,
      any
    >
  >;

  return taskFromRow(
    rows[0]
  );
}


export async function
dbUpdateSokoSourcingTask(
  input: {
    sellerUserId: string;
    actorUserId: string;
    taskId: string;
    productName: string;
    category: string;
    targetQuantity: number;
    targetUnitCost?: number;
    priority?:
      SokoSourcingPriority;
    neededBy?: string;
    taskNotes?: string;
  }
): Promise<SokoSourcingTask> {
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

  const taskId =
    clean(
      input.taskId,
      220
    );

  const productName =
    clean(
      input.productName,
      240
    );

  const category =
    clean(
      input.category,
      160
    );

  const targetQuantity =
    numberValue(
      input.targetQuantity
    );

  const targetUnitCost =
    numberValue(
      input.targetUnitCost
    );

  const priority =
    (
      input.priority === "low" ||
      input.priority === "high" ||
      input.priority === "urgent"
    )
      ? input.priority
      : "normal";

  const neededBy =
    clean(
      input.neededBy,
      40
    );

  const taskNotes =
    clean(
      input.taskNotes,
      3000
    );

  if (
    !sellerUserId ||
    !actorUserId ||
    !taskId
  ) {
    throw new Error(
      "Seller, actor and task are required"
    );
  }

  if (!productName) {
    throw new Error(
      "Product task name is required"
    );
  }

  if (!category) {
    throw new Error(
      "Choose a sourcing category"
    );
  }

  if (
    targetQuantity <= 0
  ) {
    throw new Error(
      "Target quantity must be greater than zero"
    );
  }

  const rows = (await sql`
    UPDATE
      soko_product_operations

    SET
      product_name =
        ${productName},

      task_category =
        ${category},

      target_quantity =
        ${targetQuantity},

      target_unit_cost =
        ${targetUnitCost},

      sourcing_priority =
        ${priority},

      needed_by =
        ${
          neededBy
            ? neededBy
            : null
        },

      task_notes =
        ${taskNotes},

      updated_by_user_id =
        ${actorUserId},

      updated_at =
        NOW()

    WHERE
      id =
        ${taskId}

      AND seller_user_id =
        ${sellerUserId}

      AND deleted_at
        IS NULL

      AND current_stage =
        'supply'

      AND supply_status
        IN (
          'working',
          'returned'
        )

    RETURNING *
  `) as Array<
    Record<string, any>
  >;

  if (!rows[0]) {
    throw new Error(
      "Only open Level 01 sourcing tasks can be edited."
    );
  }

  return taskFromRow(
    rows[0]
  );
}


export async function
dbApproveSokoPurchaseRecommendation(
  input: {
    sellerUserId: string;
    actorUserId: string;
    taskId: string;
  }
): Promise<SokoSourcingTask> {
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

  const taskId =
    clean(
      input.taskId,
      220
    );

  const rows = (await sql`
    UPDATE
      soko_product_operations

    SET
      purchase_status =
        'approved',

      owner_purchase_approved_at =
        NOW(),

      worker_purchase_verified_at =
        NULL,

      worker_purchase_verified_by_user_id =
        '',

      updated_by_user_id =
        ${actorUserId},

      updated_at =
        NOW()

    WHERE
      id =
        ${taskId}

      AND seller_user_id =
        ${sellerUserId}

      AND deleted_at
        IS NULL

      AND current_stage =
        'supply'

      AND purchase_mode =
        'to_be_purchased'

      AND purchase_status =
        'recommendation_submitted'

    RETURNING *
  `) as Array<
    Record<string, any>
  >;

  if (!rows[0]) {
    throw new Error(
      "This recommendation is not waiting for owner approval."
    );
  }

  return taskFromRow(
    rows[0]
  );
}


export async function
dbMarkSokoPurchasePurchased(
  input: {
    sellerUserId: string;
    actorUserId: string;
    taskId: string;

    purchaseSupplierName?: string;

    actualUnitCost?: number;

    totalPaid?: number;

    purchaseDate?: string;

    purchaseOrderReference?: string;

    purchaseTrackingNumber?: string;
  }
): Promise<SokoSourcingTask> {
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

  const taskId =
    clean(
      input.taskId,
      220
    );

  const purchaseSupplierName =
    clean(
      input.purchaseSupplierName,
      300
    );

  const actualUnitCost =
    input.actualUnitCost === undefined ||
    input.actualUnitCost === null
      ? -1
      : Math.max(
          0,
          numberValue(
            input.actualUnitCost
          )
        );

  const totalPaid =
    input.totalPaid === undefined ||
    input.totalPaid === null
      ? -1
      : Math.max(
          0,
          numberValue(
            input.totalPaid
          )
        );

  const purchaseDate =
    clean(
      input.purchaseDate,
      40
    );

  const purchaseOrderReference =
    clean(
      input.purchaseOrderReference,
      300
    );

  const purchaseTrackingNumber =
    clean(
      input.purchaseTrackingNumber,
      300
    );

  const rows = (await sql`
    UPDATE
      soko_product_operations

    SET
      purchase_status =
        'purchased',

      purchase_supplier_name =
        CASE
          WHEN ${purchaseSupplierName} <> ''
            THEN ${purchaseSupplierName}

          WHEN purchase_supplier_name <> ''
            THEN purchase_supplier_name

          ELSE supplier_name
        END,

      supplier_name =
        CASE
          WHEN ${purchaseSupplierName} <> ''
            THEN ${purchaseSupplierName}

          ELSE supplier_name
        END,

      actual_unit_cost =
        CASE
          WHEN ${actualUnitCost} >= 0
            THEN ${actualUnitCost}

          WHEN actual_unit_cost > 0
            THEN actual_unit_cost

          ELSE unit_cost
        END,

      unit_cost =
        CASE
          WHEN ${actualUnitCost} >= 0
            THEN ${actualUnitCost}

          ELSE unit_cost
        END,

      total_paid =
        CASE
          WHEN ${totalPaid} >= 0
            THEN ${totalPaid}

          ELSE total_paid
        END,

      purchase_date =
        CASE
          WHEN ${purchaseDate} <> ''
            THEN ${purchaseDate}::date

          WHEN purchase_date IS NULL
            THEN CURRENT_DATE

          ELSE purchase_date
        END,

      purchase_order_reference =
        CASE
          WHEN ${purchaseOrderReference} <> ''
            THEN ${purchaseOrderReference}

          ELSE purchase_order_reference
        END,

      purchase_tracking_number =
        CASE
          WHEN ${purchaseTrackingNumber} <> ''
            THEN ${purchaseTrackingNumber}

          ELSE purchase_tracking_number
        END,

      owner_purchase_approved_at =
        COALESCE(
          owner_purchase_approved_at,
          NOW()
        ),

      worker_purchase_verified_at =
        NULL,

      worker_purchase_verified_by_user_id =
        '',

      updated_by_user_id =
        ${actorUserId},

      updated_at =
        NOW()

    WHERE
      id =
        ${taskId}

      AND seller_user_id =
        ${sellerUserId}

      AND deleted_at
        IS NULL

      AND current_stage =
        'supply'

      AND (
        purchase_status =
          'approved'

        OR purchase_mode =
          'already_purchased'

        OR purchase_status =
          'purchased'
      )

    RETURNING *
  `) as Array<
    Record<string, any>
  >;

  if (!rows[0]) {
    throw new Error(
      "This purchase cannot be marked purchased yet."
    );
  }

  return taskFromRow(
    rows[0]
  );
}


export async function
dbDeleteSokoSourcingTask(
  input: {
    sellerUserId: string;
    actorUserId: string;
    taskId: string;
  }
): Promise<string> {
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

  const taskId =
    clean(
      input.taskId,
      220
    );

  if (
    !sellerUserId ||
    !actorUserId ||
    !taskId
  ) {
    throw new Error(
      "Seller, actor and task are required"
    );
  }

  const rows = (await sql`
    UPDATE
      soko_product_operations

    SET
      deleted_at =
        NOW(),

      updated_by_user_id =
        ${actorUserId},

      updated_at =
        NOW()

    WHERE
      id =
        ${taskId}

      AND seller_user_id =
        ${sellerUserId}

      AND deleted_at
        IS NULL

      AND current_stage =
        'supply'

      AND supply_status
        IN (
          'working',
          'returned'
        )

    RETURNING id
  `) as Array<{
    id: string;
  }>;

  if (!rows[0]?.id) {
    throw new Error(
      "Only open Level 01 sourcing tasks can be deleted."
    );
  }

  return String(
    rows[0].id
  );
}

export async function
dbListSokoSourcingTasks(
  sellerUserId: string
): Promise<
  SokoSourcingTask[]
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

  const rows = (await sql`
    SELECT *
    FROM
      soko_product_operations

    WHERE
      seller_user_id =
        ${sellerId}

      AND deleted_at
        IS NULL

    ORDER BY
      CASE
        sourcing_priority
        WHEN 'urgent'
          THEN 1
        WHEN 'high'
          THEN 2
        WHEN 'normal'
          THEN 3
        ELSE 4
      END,

      updated_at DESC
  `) as Array<
    Record<
      string,
      any
    >
  >;

  return rows.map(
    taskFromRow
  );
}

export async function
dbListSokoSuppliers(
  input: {
    sellerUserId: string;
    category?: string;
  }
): Promise<
  SokoSupplier[]
> {
  await ensureSchema();

  const sql =
    getSql();

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const category =
    clean(
      input.category,
      160
    );

  if (!sellerUserId) {
    return [];
  }

  const rows = (await sql`
    SELECT *
    FROM
      soko_supplier_directory

    WHERE
      seller_user_id =
        ${sellerUserId}

      AND active = TRUE

      AND (
        ${category} = ''
        OR category =
          ${category}
        OR category = 'Other'
      )

    ORDER BY
      verified DESC,
      name ASC
  `) as Array<
    Record<
      string,
      any
    >
  >;

  return rows.map(
    supplierFromRow
  );
}

export async function
dbCreateSokoSupplier(
  input: {
    sellerUserId: string;
    actorUserId: string;

    name: string;
    category: string;

    websiteUrl?: string;

    searchUrlTemplate?: string;

    availabilityUrlTemplate?: string;

    country?: string;
    contact?: string;

    moq?: number;

    leadTime?: string;
  }
): Promise<SokoSupplier> {
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

  const name =
    clean(
      input.name,
      240
    );

  const category =
    clean(
      input.category,
      160
    );

  const websiteUrl =
    clean(
      input.websiteUrl,
      1000
    );

  const searchUrlTemplate =
    clean(
      input.searchUrlTemplate,
      1500
    );

  const availabilityUrlTemplate =
    clean(
      input.availabilityUrlTemplate,
      1500
    );

  const country =
    clean(
      input.country,
      160
    );

  const contact =
    clean(
      input.contact,
      500
    );

  const moq =
    numberValue(
      input.moq
    );

  const leadTime =
    clean(
      input.leadTime,
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

  if (!name) {
    throw new Error(
      "Supplier name is required"
    );
  }

  if (!category) {
    throw new Error(
      "Supplier category is required"
    );
  }

  const id =
    `sokosupplier_${randomUUID()}`;

  const rows = (await sql`
    INSERT INTO
      soko_supplier_directory (
        id,

        seller_user_id,

        name,
        category,

        website_url,

        search_url_template,

        availability_url_template,

        country,
        contact,

        moq,

        lead_time,

        verified,
        active,

        created_by_user_id
      )

    VALUES (
      ${id},

      ${sellerUserId},

      ${name},
      ${category},

      ${websiteUrl},

      ${searchUrlTemplate},

      ${availabilityUrlTemplate},

      ${country},
      ${contact},

      ${moq},

      ${leadTime},

      FALSE,
      TRUE,

      ${actorUserId}
    )

    RETURNING *
  `) as Array<
    Record<
      string,
      any
    >
  >;

  return supplierFromRow(
    rows[0]
  );
}
