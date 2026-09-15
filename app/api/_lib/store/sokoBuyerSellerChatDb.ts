import { randomUUID } from "node:crypto";

import { getSokoNeonSql } from "./sokoNeon";
import {
  cleanSokoBuyerSellerText,
  conversationIdentityKey,
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
  productImage: string;
  productPrice: string;
  productCurrency: string;
  productQuantity: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
};

export type SokoBuyerSellerProductShare = {
  productId: string;
  title: string;
  image: string;
  price: string;
  currency: string;
  status: string;
  quantity: string;
};

export type SokoBuyerSellerMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  text: string;
  createdAt: string;
  type: "text" | "product_share";
  clientMessageId: string;
  product: SokoBuyerSellerProductShare | null;
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
    productImage: String(row.product_image || ""),
    productPrice: String(row.product_price || ""),
    productCurrency: String(row.product_currency || ""),
    productQuantity: String(row.product_quantity || ""),
    lastMessagePreview: String(row.last_message_preview || ""),
    lastMessageAt: dateText(row.last_message_at || row.created_at),
    unreadCount: Math.max(0, Number(row.unread_count || 0) || 0),
    createdAt: dateText(row.created_at),
  };
}

function messageFromRow(row: Record<string, any>): SokoBuyerSellerMessage {
  const type =
    String(row.message_type || "").trim() === "product_share"
      ? "product_share"
      : "text";
  const productId = String(row.share_product_id || "").trim();
  return {
    id: String(row.id || ""),
    conversationId: String(row.conversation_id || ""),
    senderUserId: String(row.sender_user_id || ""),
    text: String(row.text || ""),
    createdAt: dateText(row.created_at),
    type,
    clientMessageId: String(row.client_message_id || "").trim(),
    product:
      type === "product_share" && productId
        ? {
            productId,
            title: String(row.share_product_title || ""),
            image: String(row.share_product_image || ""),
            price: String(row.share_product_price || ""),
            currency: String(row.share_product_currency || ""),
            status: String(row.share_product_status || ""),
            quantity: String(row.share_product_quantity || ""),
          }
        : null,
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
      await sql`
        ALTER TABLE soko_buyer_seller_conversations
          ADD COLUMN IF NOT EXISTS product_image TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_conversations
          ADD COLUMN IF NOT EXISTS product_price TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_conversations
          ADD COLUMN IF NOT EXISTS product_currency TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_conversations
          ADD COLUMN IF NOT EXISTS product_quantity TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS soko_buyer_seller_reads (
          conversation_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (conversation_id, user_id)
        )
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS client_message_id TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS share_product_id TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS share_product_title TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS share_product_image TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS share_product_price TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS share_product_currency TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS share_product_status TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE soko_buyer_seller_messages
          ADD COLUMN IF NOT EXISTS share_product_quantity TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS soko_buyer_seller_messages_idempotency_idx
        ON soko_buyer_seller_messages (conversation_id, sender_user_id, client_message_id)
        WHERE client_message_id <> ''
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
  productImage?: string;
  productPrice?: string;
  productCurrency?: string;
  productQuantity?: string;
}) {
  await ensureSchema();
  const buyerUserId = cleanSokoBuyerSellerText(input.buyerUserId, 180);
  const sellerUserId = cleanSokoBuyerSellerText(input.sellerUserId, 180);
  const productId = cleanSokoBuyerSellerText(input.productId, 100);
  const productTitle = cleanSokoBuyerSellerText(input.productTitle, 120);
  const productImage = cleanSokoBuyerSellerText(input.productImage, 500);
  const productPrice = cleanSokoBuyerSellerText(input.productPrice, 40);
  const productCurrency = cleanSokoBuyerSellerText(input.productCurrency, 8);
  const productQuantity = cleanSokoBuyerSellerText(input.productQuantity, 40);
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
      product_title,
      product_image,
      product_price,
      product_currency,
      product_quantity
    )
    VALUES (
      ${id},
      ${buyerUserId},
      ${sellerUserId},
      ${productId},
      ${productTitle},
      ${productImage},
      ${productPrice},
      ${productCurrency},
      ${productQuantity}
    )
    ON CONFLICT (buyer_user_id, seller_user_id, product_id)
    DO UPDATE SET
      product_title = COALESCE(
        NULLIF(EXCLUDED.product_title, ''),
        soko_buyer_seller_conversations.product_title
      ),
      product_image = COALESCE(
        NULLIF(EXCLUDED.product_image, ''),
        soko_buyer_seller_conversations.product_image
      ),
      product_price = COALESCE(
        NULLIF(EXCLUDED.product_price, ''),
        soko_buyer_seller_conversations.product_price
      ),
      product_currency = COALESCE(
        NULLIF(EXCLUDED.product_currency, ''),
        soko_buyer_seller_conversations.product_currency
      ),
      product_quantity = COALESCE(
        NULLIF(EXCLUDED.product_quantity, ''),
        soko_buyer_seller_conversations.product_quantity
      )
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!rows[0]) {
    throw new Error("Conversation could not be opened.");
  }
  return conversationFromRow(rows[0]);
}

export async function dbListSokoBuyerSellerConversations(
  viewerUserId: string,
  input?: { limit?: number }
) {
  await ensureSchema();
  const userId = cleanSokoBuyerSellerText(viewerUserId, 180);
  if (!userId) return [];
  const limit = Math.max(1, Math.min(100, Number(input?.limit || 40) || 40));
  const sql = sqlClient();
  const rows = (await sql`
    SELECT
      c.*,
      COALESCE(m.text, '') AS last_message_preview,
      COALESCE(m.created_at, c.created_at) AS last_message_at,
      COALESCE(u.unread_count, 0)::int AS unread_count
    FROM soko_buyer_seller_conversations c
    LEFT JOIN LATERAL (
      SELECT text, created_at
      FROM soko_buyer_seller_messages
      WHERE conversation_id = c.id
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS unread_count
      FROM soko_buyer_seller_messages msg
      LEFT JOIN soko_buyer_seller_reads r
        ON r.conversation_id = c.id
       AND r.user_id = ${userId}
      WHERE msg.conversation_id = c.id
        AND msg.sender_user_id <> ${userId}
        AND msg.created_at > COALESCE(r.last_read_at, TIMESTAMPTZ '1970-01-01')
    ) u ON TRUE
    WHERE c.buyer_user_id = ${userId}
       OR c.seller_user_id = ${userId}
    ORDER BY last_message_at DESC, c.id DESC
    LIMIT ${limit}
  `) as Array<Record<string, any>>;
  return rows.map(conversationFromRow);
}

export async function dbListSokoBuyerSellerMessages(input: {
  conversationId: string;
  limit?: number;
  before?: string;
}) {
  await ensureSchema();
  const conversationId = cleanSokoBuyerSellerText(input.conversationId, 80);
  const limit = Math.max(1, Math.min(200, Number(input.limit || 40)));
  const before = cleanSokoBuyerSellerText(input.before, 40);
  if (!conversationId) return [];
  const sql = sqlClient();
  const rows = before
    ? ((await sql`
        SELECT *
        FROM soko_buyer_seller_messages
        WHERE conversation_id = ${conversationId}
          AND created_at < ${before}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as Array<Record<string, any>>)
    : ((await sql`
        SELECT *
        FROM soko_buyer_seller_messages
        WHERE conversation_id = ${conversationId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as Array<Record<string, any>>);
  return rows.map(messageFromRow).reverse();
}

export async function dbGetSokoBuyerSellerMessageByClientId(input: {
  conversationId: string;
  senderUserId: string;
  clientMessageId: string;
}) {
  await ensureSchema();
  const conversationId = cleanSokoBuyerSellerText(input.conversationId, 80);
  const senderUserId = cleanSokoBuyerSellerText(input.senderUserId, 180);
  const clientMessageId = cleanSokoBuyerSellerText(input.clientMessageId, 80);
  if (!conversationId || !senderUserId || !clientMessageId) return null;
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_buyer_seller_messages
    WHERE conversation_id = ${conversationId}
      AND sender_user_id = ${senderUserId}
      AND client_message_id = ${clientMessageId}
    LIMIT 1
  `) as Array<Record<string, any>>;
  return rows[0] ? messageFromRow(rows[0]) : null;
}

export async function dbCreateSokoBuyerSellerMessage(input: {
  conversationId: string;
  senderUserId: string;
  text: string;
  type?: "text" | "product_share";
  clientMessageId?: string;
  product?: SokoBuyerSellerProductShare | null;
}) {
  await ensureSchema();
  const conversationId = cleanSokoBuyerSellerText(input.conversationId, 80);
  const senderUserId = cleanSokoBuyerSellerText(input.senderUserId, 180);
  const type =
    input.type === "product_share" ? "product_share" : "text";
  const clientMessageId = cleanSokoBuyerSellerText(input.clientMessageId, 80);
  const product = input.product;
  const validated = validateSokoBuyerSellerMessageText(input.text);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  if (!conversationId || !senderUserId) {
    throw new Error("Message identity is incomplete.");
  }

  if (clientMessageId) {
    const existing = await dbGetSokoBuyerSellerMessageByClientId({
      conversationId,
      senderUserId,
      clientMessageId,
    });
    if (existing) return existing;
  }

  const sql = sqlClient();
  const id = `sokobsm_${randomUUID()}`;
  try {
    const rows = (await sql`
      INSERT INTO soko_buyer_seller_messages (
        id,
        conversation_id,
        sender_user_id,
        text,
        message_type,
        client_message_id,
        share_product_id,
        share_product_title,
        share_product_image,
        share_product_price,
        share_product_currency,
        share_product_status,
        share_product_quantity
      )
      VALUES (
        ${id},
        ${conversationId},
        ${senderUserId},
        ${validated.text},
        ${type},
        ${clientMessageId},
        ${cleanSokoBuyerSellerText(product?.productId, 100)},
        ${cleanSokoBuyerSellerText(product?.title, 120)},
        ${cleanSokoBuyerSellerText(product?.image, 500)},
        ${cleanSokoBuyerSellerText(product?.price, 40)},
        ${cleanSokoBuyerSellerText(product?.currency, 8)},
        ${cleanSokoBuyerSellerText(product?.status, 32)},
        ${cleanSokoBuyerSellerText(product?.quantity, 40)}
      )
      RETURNING *
    `) as Array<Record<string, any>>;

    if (!rows[0]) {
      throw new Error("Message could not be saved.");
    }
    return messageFromRow(rows[0]);
  } catch (error) {
    if (clientMessageId) {
      const existing = await dbGetSokoBuyerSellerMessageByClientId({
        conversationId,
        senderUserId,
        clientMessageId,
      });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function dbMarkSokoBuyerSellerRead(input: {
  conversationId: string;
  userId: string;
}) {
  await ensureSchema();
  const conversationId = cleanSokoBuyerSellerText(input.conversationId, 80);
  const userId = cleanSokoBuyerSellerText(input.userId, 180);
  if (!conversationId || !userId) return;
  const sql = sqlClient();
  await sql`
    INSERT INTO soko_buyer_seller_reads (
      conversation_id,
      user_id,
      last_read_at
    )
    VALUES (
      ${conversationId},
      ${userId},
      NOW()
    )
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET last_read_at = NOW()
  `;
}

export async function dbLatestOrderStatusForConversations(
  conversations: Array<{
    buyerUserId: string;
    sellerUserId: string;
    productId: string;
  }>
) {
  if (!conversations.length) return new Map<string, string>();
  const keys = conversations.map((row) =>
    conversationIdentityKey(row.buyerUserId, row.sellerUserId, row.productId)
  );
  const buyers = [
    ...new Set(conversations.map((row) => row.buyerUserId).filter(Boolean)),
  ];
  const sellers = [
    ...new Set(conversations.map((row) => row.sellerUserId).filter(Boolean)),
  ];
  const products = [
    ...new Set(conversations.map((row) => row.productId).filter(Boolean)),
  ];
  if (!buyers.length || !sellers.length || !products.length) {
    return new Map<string, string>();
  }

  const sql = sqlClient();
  let rows: Array<Record<string, any>> = [];
  try {
    rows = (await sql`
      SELECT DISTINCT ON (buyer_user_id, seller_user_id, product_id)
        buyer_user_id,
        seller_user_id,
        product_id,
        status
      FROM soko_orders
      WHERE buyer_user_id = ANY(${buyers})
        AND seller_user_id = ANY(${sellers})
        AND product_id = ANY(${products})
      ORDER BY buyer_user_id, seller_user_id, product_id, updated_at DESC
    `) as Array<Record<string, any>>;
  } catch {
    return new Map<string, string>();
  }

  const next = new Map<string, string>();
  for (const row of rows) {
    const key = conversationIdentityKey(
      String(row.buyer_user_id || ""),
      String(row.seller_user_id || ""),
      String(row.product_id || "")
    );
    if (keys.includes(key)) {
      next.set(key, String(row.status || ""));
    }
  }
  return next;
}

