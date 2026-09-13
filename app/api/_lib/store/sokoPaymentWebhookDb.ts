import { neon } from "@neondatabase/serverless";
import { getDatabaseUrl } from "./authDb";

type PaymentWebhookProvider = "cash_app" | "square" | "stripe";

let ready: Promise<void> | null = null;

function sqlClient() {
  const url = getDatabaseUrl();
  if (!url) throw new Error("Database unavailable.");
  return neon(url);
}

async function schema() {
  if (!ready) {
    ready = (async () => {
      const sql = sqlClient();

      await sql`
        CREATE TABLE IF NOT EXISTS soko_payment_webhook_events (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          event_type TEXT NOT NULL DEFAULT '',
          provider_payment_id TEXT NOT NULL DEFAULT '',
          seller_external_id TEXT NOT NULL DEFAULT '',
          seller_user_id TEXT,
          amount_minor BIGINT,
          currency TEXT NOT NULL DEFAULT '',
          payment_status TEXT NOT NULL DEFAULT '',
          transaction_reference TEXT NOT NULL DEFAULT '',
          payload JSONB NOT NULL,
          payload_sha256 TEXT NOT NULL DEFAULT '',
          processed BOOLEAN NOT NULL DEFAULT FALSE,
          matched_order_id TEXT,
          event_environment TEXT NOT NULL DEFAULT '',
          reconciliation_status TEXT NOT NULL DEFAULT '',
          reconciliation_reason TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed_at TIMESTAMPTZ
        )
      `;

      await sql`
        ALTER TABLE soko_payment_webhook_events
        ADD COLUMN IF NOT EXISTS seller_user_id TEXT
      `;

      await sql`
        ALTER TABLE soko_payment_webhook_events
        ADD COLUMN IF NOT EXISTS payload_sha256 TEXT
        NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE soko_payment_webhook_events
        ADD COLUMN IF NOT EXISTS event_environment TEXT
        NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE soko_payment_webhook_events
        ADD COLUMN IF NOT EXISTS reconciliation_status TEXT
        NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE soko_payment_webhook_events
        ADD COLUMN IF NOT EXISTS reconciliation_reason TEXT
        NOT NULL DEFAULT ''
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_payment_webhook_seller_idx
        ON soko_payment_webhook_events(
          seller_user_id,
          created_at DESC
        )
        WHERE seller_user_id IS NOT NULL
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_payment_webhook_provider_payment_idx
        ON soko_payment_webhook_events(provider, provider_payment_id)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_payment_webhook_reference_idx
        ON soko_payment_webhook_events(transaction_reference)
      `;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }

  return ready;
}

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

export async function savePaymentWebhookEvent(args: {
  id: string;
  provider: PaymentWebhookProvider;
  eventType?: string;
  providerPaymentId?: string;
  sellerExternalId?: string;
  sellerUserId?: string | null;
  amountMinor?: number | null;
  currency?: string;
  paymentStatus?: string;
  transactionReference?: string;
  eventEnvironment?: string;
  payload: Record<string, unknown>;
  payloadSha256?: string;
}) {
  await schema();

  const sql = sqlClient();

  const id = clean(args.id, 180);
  if (!id) throw new Error("Webhook event id is required.");

  const amountMinor =
    typeof args.amountMinor === "number" &&
    Number.isFinite(args.amountMinor)
      ? Math.trunc(args.amountMinor)
      : null;

  const rows = await sql`
    INSERT INTO soko_payment_webhook_events (
      id,
      provider,
      event_type,
      provider_payment_id,
      seller_external_id,
      seller_user_id,
      amount_minor,
      currency,
      payment_status,
      transaction_reference,
      event_environment,
      payload,
      payload_sha256
    )
    VALUES (
      ${id},
      ${args.provider},
      ${clean(args.eventType, 120)},
      ${clean(args.providerPaymentId, 180)},
      ${clean(args.sellerExternalId, 180)},
      ${clean(args.sellerUserId, 180) || null},
      ${amountMinor},
      ${clean(args.currency, 12)},
      ${clean(args.paymentStatus, 80)},
      ${clean(args.transactionReference, 180)},
      ${clean(args.eventEnvironment, 20)},
      ${JSON.stringify(args.payload)}::jsonb,
      ${clean(args.payloadSha256, 64).toLowerCase()}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;

  return {
    inserted: rows.length > 0,
    eventId: id,
  };
}


export async function markPaymentWebhookOrderMatch(args: {
  eventId: string;
  orderId: string;
}) {
  await schema();

  const eventId = clean(args.eventId, 180);
  const orderId = clean(args.orderId, 180);

  if (!eventId || !orderId) {
    throw new Error(
      "Webhook event and order IDs are required."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    UPDATE soko_payment_webhook_events
    SET
      matched_order_id = ${orderId}
    WHERE id = ${eventId}
      AND (
        matched_order_id IS NULL
        OR matched_order_id = ${orderId}
      )
    RETURNING id
  `;

  return rows.length > 0;
}

/*
 * A matched webhook is not necessarily processed.
 *
 * "matched_order_id" means provider evidence was matched
 * to exactly one trusted order.
 *
 * "processed" is reserved for the later step where the
 * provider event has actually been applied successfully.
 */
export async function markPaymentWebhookProcessed(args: {
  eventId: string;
  orderId: string;
}) {
  await schema();

  const eventId = clean(args.eventId, 180);
  const orderId = clean(args.orderId, 180);

  if (!eventId || !orderId) {
    throw new Error(
      "Webhook event and order IDs are required."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    UPDATE soko_payment_webhook_events
    SET
      processed = TRUE,
      processed_at = COALESCE(processed_at, NOW())
    WHERE id = ${eventId}
      AND matched_order_id = ${orderId}
      AND processed = FALSE
    RETURNING id
  `;

  if (rows.length > 0) {
    return true;
  }

  /*
   * Idempotency:
   * if this exact event/order was already processed,
   * treat the repeated operation as success.
   */
  const existing = await sql`
    SELECT id
    FROM soko_payment_webhook_events
    WHERE id = ${eventId}
      AND matched_order_id = ${orderId}
      AND processed = TRUE
    LIMIT 1
  `;

  return existing.length === 1;
}

export async function getPaymentWebhookEvent(args: {
  eventId: string;
  provider: PaymentWebhookProvider;
}) {
  await schema();

  const eventId = clean(args.eventId, 180);

  if (!eventId) {
    return null;
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT
      id,
      provider,
      event_type,
      provider_payment_id,
      seller_external_id,
      seller_user_id,
      amount_minor,
      currency,
      payment_status,
      transaction_reference,
      payload_sha256,
      processed,
      matched_order_id,
      event_environment,
      reconciliation_status,
      reconciliation_reason,
      created_at,
      processed_at
    FROM soko_payment_webhook_events
    WHERE id = ${eventId}
      AND provider = ${args.provider}
    LIMIT 1
  `;

  return rows[0] || null;
}

export async function recordPaymentWebhookReconciliation(args: {
  eventId: string;
  provider: PaymentWebhookProvider;
  reason: string;
}) {
  await schema();

  const eventId = clean(args.eventId, 180);
  const reason = clean(args.reason, 80);

  if (!eventId || !reason) {
    return false;
  }

  const sql = sqlClient();

  const rows = await sql`
    UPDATE soko_payment_webhook_events
    SET
      reconciliation_status = 'mismatch',
      reconciliation_reason = ${reason}
    WHERE id = ${eventId}
      AND provider = ${args.provider}
      AND processed = FALSE
    RETURNING id
  `;

  return rows.length > 0;
}

