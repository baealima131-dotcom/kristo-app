import { randomUUID } from "node:crypto";

import { getSokoNeonSql } from "./sokoNeon";
import {
  cleanSokoBuyerSellerText,
  validateSokoBuyerSellerMessageText,
} from "@/app/api/_lib/sokoBuyerSellerChatPolicy";

export {
  SOKO_BUYER_SELLER_MESSAGE_MAX,
  authorizeSokoConversationAccess,
  cleanSokoBuyerSellerText,
  conversationIdentityKey,
  evaluateOpenSokoBuyerSellerConversation,
  openConversationIdempotently,
  parseOpenSokoConversationBody,
  validateSokoBuyerSellerMessageText,
} from "@/app/api/_lib/sokoBuyerSellerChatPolicy";

export type SokoBuyerSellerConversation = {
  id: string;
  buyerUserId: string;
  sellerUserId: string;
  productId: string;
  productTitle: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  createdAt: string;
};

export type SokoBuyerSellerMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  text: string;
  createdAt: string;
};

type SchemaGate = {
  promise: Promise<void> | null;
};

function schemaGate(): SchemaGate {
  const globalState = globalThis as typeof globalThis & {
    __kristoSokoBuyerSellerChatSchema?: SchemaGate;
  };
  if (!globalState.__kristoSokoBuyerSellerChatSchema) {
    globalState.__kristoSokoBuyerSellerChatSchema = { promise: null };
  }
  return globalState.__kristoSokoBuyerSellerChatSchema;
}

function sqlClient() {
  return getSokoNeonSql();
}

function dateText(value: unknown) {
  if (!value) return "";
  try {
    return new Date(value as string | number | Date).toISOString();
  } catch {
    return String(value || "");
  }
}

function conversationFromRow(
  row: Record<string, any>
): SokoBuyerSellerConversation {
  return {
    id: String(row.id || ""),
    buyerUserId: String(row.buyer_user_id || ""),
    sellerUserId: String(row.seller_user_id || ""),
    productId: String(row.product_id || ""),
    productTitle: String(row.product_title || ""),
    lastMessagePreview: String(row.last_message_preview || ""),
    lastMessageAt: dateText(row.last_message_at || row.created_at),
    createdAt: dateText(row.created_at),
  };
}

function messageFromRow(row: Record<string, any>): SokoBuyerSellerMessage {
  return {
    id: String(row.id || ""),
    conversationId: String(row.conversation_id || ""),
    senderUserId: String(row.sender_user_id || ""),
    text: String(row.text || ""),
    createdAt: dateText(row.created_at),
  };
}

async function ensureSchema() {
  const gate = schemaGate();
  if (!gate.promise) {
    gate.promise = (async () => {
      const sql = sqlClient();
      await sql`
        CREATE TABLE IF NOT EXISTS soko_buyer_seller_conversations (
          id TEXT PRIMARY KEY,
          buyer_user_id TEXT NOT NULL,
          seller_user_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          product_title TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (buyer_user_id, seller_user_id, product_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS soko_buyer_seller_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          sender_user_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS soko_buyer_seller_inbox_idx
        ON soko_buyer_seller_conversations (buyer_user_id, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS soko_buyer_seller_seller_inbox_idx
        ON soko_buyer_seller_conversations (seller_user_id, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS soko_buyer_seller_messages_idx
        ON soko_buyer_seller_messages (conversation_id, created_at ASC)
      `;
    })().catch((error) => {
      gate.promise = null;
      throw error;
    });
  }
  await gate.promise;
}

export async function dbGetSokoBuyerSellerConversation(id: string) {
  await ensureSchema();
  const conversationId = cleanSokoBuyerSellerText(id, 80);
  if (!conversationId) return null;
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_buyer_seller_conversations
    WHERE id=${conversationId}
    LIMIT 1
  `) as Array<Record<string, any>>;
  return rows[0] ? conversationFromRow(rows[0]) : null;
}

export async function dbOpenSokoBuyerSellerConversation(input: {
  buyerUserId: string;
  sellerUserId: string;
  productId: string;
  productTitle: string;
}) {
  await ensureSchema();
  const buyerUserId = cleanSokoBuyerSellerText(input.buyerUserId, 180);
  const sellerUserId = cleanSokoBuyerSellerText(input.sellerUserId, 180);
  const productId = cleanSokoBuyerSellerText(input.productId, 100);
  const productTitle = cleanSokoBuyerSellerText(input.productTitle, 120);
  if (!buyerUserId || !sellerUserId || !productId) {
    throw new Error("Conversation identity is incomplete.");
  }

  const sql = sqlClient();
  const id = `sokobs_${randomUUID()}`;
  const rows = (await sql`
    INSERT INTO soko_buyer_seller_conversations (
      id,
      buyer_user_id,
      seller_user_id,
      product_id,
      product_title
    )
    VALUES (
      ${id},
      ${buyerUserId},
      ${sellerUserId},
      ${productId},
      ${productTitle}
    )
    ON CONFLICT (buyer_user_id, seller_user_id, product_id)
    DO UPDATE SET product_title = COALESCE(
      NULLIF(soko_buyer_seller_conversations.product_title, ''),
      EXCLUDED.product_title
    )
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!rows[0]) {
    throw new Error("Conversation could not be opened.");
  }
  return conversationFromRow(rows[0]);
}

export async function dbListSokoBuyerSellerConversations(viewerUserId: string) {
  await ensureSchema();
  const userId = cleanSokoBuyerSellerText(viewerUserId, 180);
  if (!userId) return [];
  const sql = sqlClient();
  const rows = (await sql`
    SELECT
      c.*,
      COALESCE(m.text, '') AS last_message_preview,
      COALESCE(m.created_at, c.created_at) AS last_message_at
    FROM soko_buyer_seller_conversations c
    LEFT JOIN LATERAL (
      SELECT text, created_at
      FROM soko_buyer_seller_messages
      WHERE conversation_id = c.id
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON TRUE
    WHERE c.buyer_user_id = ${userId}
       OR c.seller_user_id = ${userId}
    ORDER BY last_message_at DESC, c.id DESC
    LIMIT 100
  `) as Array<Record<string, any>>;
  return rows.map(conversationFromRow);
}

export async function dbListSokoBuyerSellerMessages(input: {
  conversationId: string;
  limit?: number;
}) {
  await ensureSchema();
  const conversationId = cleanSokoBuyerSellerText(input.conversationId, 80);
  const limit = Math.max(1, Math.min(200, Number(input.limit || 80)));
  if (!conversationId) return [];
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_buyer_seller_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as Array<Record<string, any>>;
  return rows.map(messageFromRow).reverse();
}

export async function dbCreateSokoBuyerSellerMessage(input: {
  conversationId: string;
  senderUserId: string;
  text: string;
}) {
  await ensureSchema();
  const conversationId = cleanSokoBuyerSellerText(input.conversationId, 80);
  const senderUserId = cleanSokoBuyerSellerText(input.senderUserId, 180);
  const validated = validateSokoBuyerSellerMessageText(input.text);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  if (!conversationId || !senderUserId) {
    throw new Error("Message identity is incomplete.");
  }

  const sql = sqlClient();
  const id = `sokobsm_${randomUUID()}`;
  const rows = (await sql`
    INSERT INTO soko_buyer_seller_messages (
      id,
      conversation_id,
      sender_user_id,
      text
    )
    VALUES (
      ${id},
      ${conversationId},
      ${senderUserId},
      ${validated.text}
    )
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!rows[0]) {
    throw new Error("Message could not be saved.");
  }
  return messageFromRow(rows[0]);
}
