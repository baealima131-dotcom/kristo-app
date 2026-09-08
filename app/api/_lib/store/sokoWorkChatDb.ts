import { randomUUID } from "crypto";

import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
} from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type SokoWorkChatMessage = {
  id: string;

  sellerUserId: string;
  workerUserId: string;

  senderUserId: string;

  senderRole:
    | "seller_owner"
    | "supply_worker";

  text: string;

  taskId: string;

  createdAt: string;
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

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (
      async () => {
        const sql =
          getSql();

        await sql`
          CREATE TABLE IF NOT EXISTS
            soko_work_chat_messages (
              id TEXT PRIMARY KEY,

              seller_user_id
                TEXT NOT NULL,

              worker_user_id
                TEXT NOT NULL,

              sender_user_id
                TEXT NOT NULL,

              sender_role
                TEXT NOT NULL,

              text
                TEXT NOT NULL
                DEFAULT '',

              task_id
                TEXT NOT NULL
                DEFAULT '',

              created_at
                TIMESTAMPTZ NOT NULL
                DEFAULT NOW()
            )
        `;

        await sql`
          CREATE INDEX IF NOT EXISTS
            soko_work_chat_thread_idx

          ON soko_work_chat_messages (
            seller_user_id,
            worker_user_id,
            created_at ASC
          )
        `;

        await sql`
          CREATE INDEX IF NOT EXISTS
            soko_work_chat_sender_idx

          ON soko_work_chat_messages (
            sender_user_id,
            created_at DESC
          )
        `;
      }
    )().catch(
      (error) => {
        schemaReady = null;

        throw error;
      }
    );
  }

  await schemaReady;
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
    return String(
      value || ""
    );
  }
}

function fromRow(
  row: Record<string, any>
): SokoWorkChatMessage {
  return {
    id:
      String(
        row.id || ""
      ),

    sellerUserId:
      String(
        row.seller_user_id || ""
      ),

    workerUserId:
      String(
        row.worker_user_id || ""
      ),

    senderUserId:
      String(
        row.sender_user_id || ""
      ),

    senderRole:
      row.sender_role as
        | "seller_owner"
        | "supply_worker",

    text:
      String(
        row.text || ""
      ),

    taskId:
      String(
        row.task_id || ""
      ),

    createdAt:
      dateText(
        row.created_at
      ),
  };
}

export async function
dbListSokoWorkChatMessages(
  input: {
    sellerUserId: string;

    workerUserId: string;

    limit?: number;
  }
): Promise<SokoWorkChatMessage[]> {
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

  const limit =
    Math.max(
      1,
      Math.min(
        300,
        Number(
          input.limit || 150
        )
      )
    );

  if (
    !sellerUserId ||
    !workerUserId
  ) {
    return [];
  }

  const rows = (
    await sql`
      SELECT *

      FROM
        soko_work_chat_messages

      WHERE
        seller_user_id =
          ${sellerUserId}

        AND worker_user_id =
          ${workerUserId}

      ORDER BY
        created_at DESC

      LIMIT
        ${limit}
    `
  ) as Array<
    Record<string, any>
  >;

  return rows
    .map(fromRow)
    .reverse();
}

export async function
dbCreateSokoWorkChatMessage(
  input: {
    sellerUserId: string;

    workerUserId: string;

    senderUserId: string;

    senderRole:
      | "seller_owner"
      | "supply_worker";

    text: string;

    taskId?: string;
  }
): Promise<SokoWorkChatMessage> {
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

  const senderUserId =
    clean(
      input.senderUserId,
      180
    );

  const text =
    clean(
      input.text,
      4000
    );

  const taskId =
    clean(
      input.taskId,
      180
    );

  if (
    !sellerUserId ||
    !workerUserId ||
    !senderUserId
  ) {
    throw new Error(
      "Chat identity is incomplete"
    );
  }

  if (!text) {
    throw new Error(
      "Message is required"
    );
  }

  const id =
    `sokowm_${randomUUID()}`;

  const rows = (
    await sql`
      INSERT INTO
        soko_work_chat_messages (
          id,
          seller_user_id,
          worker_user_id,
          sender_user_id,
          sender_role,
          text,
          task_id
        )

      VALUES (
        ${id},
        ${sellerUserId},
        ${workerUserId},
        ${senderUserId},
        ${input.senderRole},
        ${text},
        ${taskId}
      )

      RETURNING *
    `
  ) as Array<
    Record<string, any>
  >;

  if (!rows[0]) {
    throw new Error(
      "Message could not be saved"
    );
  }

  return fromRow(
    rows[0]
  );
}
