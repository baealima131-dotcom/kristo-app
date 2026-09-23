import { randomUUID } from "crypto";

import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
} from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type SokoWorkPlanStatus =
  | "planned"
  | "in_progress"
  | "completed";

export type SokoWorkPlanPriority =
  | "low"
  | "normal"
  | "high";

export type SokoWorkPlan = {
  id: string;
  sellerUserId: string;
  workerUserId: string;
  title: string;
  notes: string;
  status: SokoWorkPlanStatus;
  priority: SokoWorkPlanPriority;
  dueAt: string | null;
  taskId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

let sqlClient:
  | ReturnType<typeof neon>
  | null = null;

let schemaReady:
  | Promise<void>
  | null = null;

function clean(
  value: unknown,
  max = 4000
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function dateText(
  value: unknown
) {
  if (!value) {
    return "";
  }

  try {
    return new Date(
      value as any
    ).toISOString();
  } catch {
    return String(value || "");
  }
}

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

export function isSokoWorkPlanStatus(
  value: unknown
): value is SokoWorkPlanStatus {
  return (
    value === "planned" ||
    value === "in_progress" ||
    value === "completed"
  );
}

export function isSokoWorkPlanPriority(
  value: unknown
): value is SokoWorkPlanPriority {
  return (
    value === "low" ||
    value === "normal" ||
    value === "high"
  );
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (
      async () => {
        const sql =
          getSql();

        await sql`
          CREATE TABLE IF NOT EXISTS
            soko_work_plans (
              id TEXT PRIMARY KEY,

              seller_user_id
                TEXT NOT NULL,

              worker_user_id
                TEXT NOT NULL,

              title
                TEXT NOT NULL,

              notes
                TEXT NOT NULL
                DEFAULT '',

              status
                TEXT NOT NULL
                DEFAULT 'planned',

              priority
                TEXT NOT NULL
                DEFAULT 'normal',

              due_at
                TIMESTAMPTZ,

              task_id
                TEXT,

              created_by_user_id
                TEXT NOT NULL,

              created_at
                TIMESTAMPTZ NOT NULL
                DEFAULT NOW(),

              updated_at
                TIMESTAMPTZ NOT NULL
                DEFAULT NOW(),

              completed_at
                TIMESTAMPTZ
            )
        `;

        await sql`
          CREATE INDEX IF NOT EXISTS
            soko_work_plans_seller_worker_idx
          ON soko_work_plans (
            seller_user_id,
            worker_user_id,
            updated_at DESC
          )
        `;

        await sql`
          CREATE INDEX IF NOT EXISTS
            soko_work_plans_worker_status_idx
          ON soko_work_plans (
            worker_user_id,
            status,
            updated_at DESC
          )
        `;
      }
    )().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  await schemaReady;
}

function fromRow(
  row: Record<string, any>
): SokoWorkPlan {
  return {
    id: String(row.id || ""),

    sellerUserId: String(
      row.seller_user_id || ""
    ),

    workerUserId: String(
      row.worker_user_id || ""
    ),

    title: String(row.title || ""),

    notes: String(row.notes || ""),

    status:
      row.status as SokoWorkPlanStatus,

    priority:
      row.priority as SokoWorkPlanPriority,

    dueAt: row.due_at
      ? dateText(row.due_at)
      : null,

    taskId: row.task_id
      ? String(row.task_id)
      : null,

    createdByUserId: String(
      row.created_by_user_id || ""
    ),

    createdAt: dateText(
      row.created_at
    ),

    updatedAt: dateText(
      row.updated_at
    ),

    completedAt: row.completed_at
      ? dateText(row.completed_at)
      : null,
  };
}

export async function
dbVerifySokoSourcingTaskForSeller(
  input: {
    sellerUserId: string;
    taskId: string;
  }
): Promise<boolean> {
  await ensureSchema();

  const sql =
    getSql();

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const taskId =
    clean(
      input.taskId,
      220
    );

  if (
    !sellerUserId ||
    !taskId
  ) {
    return false;
  }

  const rows = (await sql`
    SELECT id
    FROM soko_product_operations
    WHERE id = ${taskId}
      AND seller_user_id = ${sellerUserId}
      AND deleted_at IS NULL
    LIMIT 1
  `) as Array<Record<string, any>>;

  return Boolean(rows[0]);
}

export async function
dbCreateSokoWorkPlan(
  input: {
    sellerUserId: string;
    workerUserId: string;
    title: string;
    notes?: string;
    priority?: SokoWorkPlanPriority;
    dueAt?: string;
    taskId?: string;
    createdByUserId: string;
  }
): Promise<SokoWorkPlan> {
  await ensureSchema();

  const sql =
    getSql();

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const workerUserId =
    clean(
      input.workerUserId,
      180
    );

  const title =
    clean(
      input.title,
      240
    );

  const notes =
    clean(
      input.notes,
      4000
    );

  const createdByUserId =
    clean(
      input.createdByUserId,
      180
    );

  const priority =
    isSokoWorkPlanPriority(
      input.priority
    )
      ? input.priority
      : "normal";

  const taskId =
    clean(
      input.taskId,
      220
    ) || null;

  const dueAtRaw =
    clean(
      input.dueAt,
      80
    );

  const dueAt =
    dueAtRaw || null;

  if (
    !sellerUserId ||
    !workerUserId ||
    !title ||
    !createdByUserId
  ) {
    throw new Error(
      "Seller, worker, title and creator are required"
    );
  }

  if (taskId) {
    const valid =
      await dbVerifySokoSourcingTaskForSeller(
        {
          sellerUserId,
          taskId,
        }
      );

    if (!valid) {
      throw new Error(
        "Linked sourcing task was not found for this store"
      );
    }
  }

  const id =
    `sokoplan_${randomUUID()}`;

  const rows = (await sql`
    INSERT INTO soko_work_plans (
      id,
      seller_user_id,
      worker_user_id,
      title,
      notes,
      status,
      priority,
      due_at,
      task_id,
      created_by_user_id
    ) VALUES (
      ${id},
      ${sellerUserId},
      ${workerUserId},
      ${title},
      ${notes},
      'planned',
      ${priority},
      ${dueAt},
      ${taskId},
      ${createdByUserId}
    )
    RETURNING *
  `) as Array<Record<string, any>>;

  return fromRow(rows[0]);
}

export async function
dbListSokoWorkPlans(
  input: {
    sellerUserId: string;
    workerUserId?: string;
  }
): Promise<SokoWorkPlan[]> {
  await ensureSchema();

  const sql =
    getSql();

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const workerUserId =
    clean(
      input.workerUserId,
      180
    );

  if (!sellerUserId) {
    return [];
  }

  const rows = workerUserId
    ? ((await sql`
        SELECT *
        FROM soko_work_plans
        WHERE seller_user_id = ${sellerUserId}
          AND worker_user_id = ${workerUserId}
        ORDER BY
          CASE status
            WHEN 'in_progress' THEN 1
            WHEN 'planned' THEN 2
            WHEN 'completed' THEN 3
            ELSE 4
          END,
          updated_at DESC
      `) as Array<Record<string, any>>)
    : ((await sql`
        SELECT *
        FROM soko_work_plans
        WHERE seller_user_id = ${sellerUserId}
        ORDER BY updated_at DESC
      `) as Array<Record<string, any>>);

  return rows.map(fromRow);
}

export async function
dbGetSokoWorkPlanById(
  planId: string
): Promise<SokoWorkPlan | null> {
  await ensureSchema();

  const sql =
    getSql();

  const id =
    clean(
      planId,
      240
    );

  if (!id) {
    return null;
  }

  const rows = (await sql`
    SELECT *
    FROM soko_work_plans
    WHERE id = ${id}
    LIMIT 1
  `) as Array<Record<string, any>>;

  return rows[0]
    ? fromRow(rows[0])
    : null;
}

export async function
dbUpdateSokoWorkPlan(
  input: {
    planId: string;
    sellerUserId: string;
    title?: string;
    notes?: string;
    status?: SokoWorkPlanStatus;
    priority?: SokoWorkPlanPriority;
    dueAt?: string | null;
    taskId?: string | null;
  }
): Promise<SokoWorkPlan> {
  await ensureSchema();

  const sql =
    getSql();

  const existing =
    await dbGetSokoWorkPlanById(
      input.planId
    );

  if (!existing) {
    throw new Error(
      "Work plan not found"
    );
  }

  if (
    existing.sellerUserId !==
    clean(
      input.sellerUserId,
      180
    )
  ) {
    throw Object.assign(
      new Error(
        "Work plan belongs to another store"
      ),
      { status: 403 }
    );
  }

  const title =
    input.title !== undefined
      ? clean(
          input.title,
          240
        )
      : existing.title;

  const notes =
    input.notes !== undefined
      ? clean(
          input.notes,
          4000
        )
      : existing.notes;

  const priority =
    input.priority !== undefined &&
    isSokoWorkPlanPriority(
      input.priority
    )
      ? input.priority
      : existing.priority;

  const status =
    input.status !== undefined &&
    isSokoWorkPlanStatus(
      input.status
    )
      ? input.status
      : existing.status;

  let dueAt:
    | string
    | null =
    existing.dueAt;

  if (
    input.dueAt !== undefined
  ) {
    dueAt =
      input.dueAt === null
        ? null
        : clean(
            input.dueAt,
            80
          ) || null;
  }

  let taskId:
    | string
    | null =
    existing.taskId;

  if (
    input.taskId !== undefined
  ) {
    taskId =
      input.taskId === null
        ? null
        : clean(
            input.taskId,
            220
          ) || null;
  }

  if (
    !title
  ) {
    throw new Error(
      "Plan title is required"
    );
  }

  if (taskId) {
    const valid =
      await dbVerifySokoSourcingTaskForSeller(
        {
          sellerUserId:
            existing.sellerUserId,
          taskId,
        }
      );

    if (!valid) {
      throw new Error(
        "Linked sourcing task was not found for this store"
      );
    }
  }

  const completedAt =
    status === "completed"
      ? existing.completedAt ||
        new Date().toISOString()
      : null;

  const rows = (await sql`
    UPDATE soko_work_plans
    SET
      title = ${title},
      notes = ${notes},
      status = ${status},
      priority = ${priority},
      due_at = ${dueAt},
      task_id = ${taskId},
      completed_at = ${completedAt},
      updated_at = NOW()
    WHERE id = ${existing.id}
      AND seller_user_id = ${existing.sellerUserId}
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!rows[0]) {
    throw new Error(
      "Work plan not found"
    );
  }

  return fromRow(rows[0]);
}

export async function
dbUpdateSokoWorkPlanStatusForWorker(
  input: {
    planId: string;
    sellerUserId: string;
    workerUserId: string;
    status: SokoWorkPlanStatus;
  }
): Promise<SokoWorkPlan> {
  await ensureSchema();

  const sql =
    getSql();

  const existing =
    await dbGetSokoWorkPlanById(
      input.planId
    );

  if (!existing) {
    throw new Error(
      "Work plan not found"
    );
  }

  if (
    existing.sellerUserId !==
      clean(
        input.sellerUserId,
        180
      ) ||
    existing.workerUserId !==
      clean(
        input.workerUserId,
        180
      )
  ) {
    throw Object.assign(
      new Error(
        "You do not have access to this work plan"
      ),
      { status: 403 }
    );
  }

  const nextStatus =
    input.status;

  if (
    !isSokoWorkPlanStatus(
      nextStatus
    )
  ) {
    throw new Error(
      "Invalid plan status"
    );
  }

  const allowed =
    (
      existing.status ===
        "planned" &&
      nextStatus ===
        "in_progress"
    ) ||
    (
      existing.status ===
        "in_progress" &&
      nextStatus ===
        "completed"
    ) ||
    existing.status ===
      nextStatus;

  if (!allowed) {
    throw new Error(
      "Plan status can only move planned → in_progress → completed"
    );
  }

  const completedAt =
    nextStatus === "completed"
      ? new Date().toISOString()
      : null;

  const rows = (await sql`
    UPDATE soko_work_plans
    SET
      status = ${nextStatus},
      completed_at = ${completedAt},
      updated_at = NOW()
    WHERE id = ${existing.id}
      AND seller_user_id = ${existing.sellerUserId}
      AND worker_user_id = ${existing.workerUserId}
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!rows[0]) {
    throw new Error(
      "Work plan not found"
    );
  }

  return fromRow(rows[0]);
}

export async function
dbDeleteSokoWorkPlan(
  input: {
    planId: string;
    sellerUserId: string;
  }
): Promise<string> {
  await ensureSchema();

  const sql =
    getSql();

  const planId =
    clean(
      input.planId,
      240
    );

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  const rows = (await sql`
    DELETE FROM soko_work_plans
    WHERE id = ${planId}
      AND seller_user_id = ${sellerUserId}
    RETURNING id
  `) as Array<Record<string, any>>;

  if (!rows[0]) {
    throw new Error(
      "Work plan not found"
    );
  }

  return String(rows[0].id);
}
